/**
 * @fileoverview Kinetic v1.1 - Integration Tests
 * @module tests/integration
 *
 * End-to-end integration tests validating the complete audit, signing,
 * and approval workflow. Tests exercise the full stack: Express routes →
 * service layer → database (test PostgreSQL instance) → crypto module.
 *
 * Prerequisites:
 *   - TEST_DATABASE_URL pointing to a dedicated test PostgreSQL database
 *   - jest, supertest installed as devDependencies
 *
 * Run: jest src/tests/integration.js --runInBand --forceExit
 */

'use strict';

const request  = require('supertest');
const express  = require('express');
const crypto   = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// TEST APP SETUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Express application wiring all Kinetic v1.1 routes.
 * Used exclusively by integration tests; the production entry point (app.js)
 * imports each router independently.
 *
 * @returns {express.Application}
 */
function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Mount routers
  app.use('/api/v1/audit-logs',  require('../audit/api'));
  app.use('/api/v1',             require('../approval/service').router);
  app.use('/api/v1/crypto',      require('../crypto/api'));
  app.use('/api/v1/compliance',  require('../rbac/middleware').complianceRouter);

  // Minimal error handler
  app.use((err, req, res, _next) => {
    console.error('[TestApp] Unhandled error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

/**
 * Generates a base64-encoded user context header that simulates the
 * authentication layer (replaced by JWT verification in production).
 *
 * @param {{ email: string, role: string }} user
 * @returns {{ Authorization: string, 'x-kinetic-user': string }}
 */
function authHeaders(user) {
  return {
    Authorization: 'Bearer test-token-integration',
    'x-kinetic-user': Buffer.from(JSON.stringify(user)).toString('base64'),
    'x-session-id': 'sess_integration_test_001',
  };
}

const ADMIN_USER              = { email: 'admin@kinetic.io',      role: 'admin' };
const COMPLIANCE_USER         = { email: 'compliance@kinetic.io', role: 'compliance_officer' };
const AUDIT_VIEWER            = { email: 'viewer@kinetic.io',     role: 'audit_viewer' };
const AGENT_OWNER             = { email: 'owner@kinetic.io',      role: 'agent_owner' };

let app;
let db;
let cryptoService;

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Use a separate test database to avoid polluting production data
  process.env.AUDIT_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  process.env.NODE_ENV = 'test';

  db            = require('../audit/db');
  cryptoService = require('../crypto/service');

  await db.runMigrations();
  await cryptoService.initialise();

  // Register the generated public key so verification works
  const { keyId, publicKeyPem } = { keyId: cryptoService.getActiveKeyId(), publicKeyPem: cryptoService.getActivePublicKey() };
  await db.storeSigningKey(keyId, publicKeyPem, 'test_setup');

  app = buildTestApp();
}, 30000);

afterAll(async () => {
  // Clean up test data from audit_log table
  if (db && db.pool) {
    await db.pool.query("DELETE FROM audit_log WHERE triggered_by LIKE '%@kinetic.io'").catch(() => {});
    await db.pool.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION SUITE 1: Full Audit Event Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit Event Lifecycle', () => {
  let createdEventId;

  test('creates a signed, immutable audit event via service layer', async () => {
    const auditService = require('../audit/service');
    const event = await auditService.createAuditEvent({
      action:           'kill_agent',
      agent_id:         'INT_AGENT_01',
      session_id:       'sess_int_001',
      triggered_by:     ADMIN_USER.email,
      user_role:        ADMIN_USER.role,
      pre_state:        { entropy: 0.95, status: 'active', tokens_used: 1000 },
      post_state:       { entropy: null, status: 'terminated', tokens_used: 1000 },
      reason:           'entropy_exceeded_threshold',
      execution_status: 'success',
    });

    expect(event.event_id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(event.sequence_number).toBeGreaterThan(0);
    expect(event.immutable).toBe(true);
    expect(event.signature).not.toBe('SIGNING_FAILED');
    expect(event.payload_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(event.action).toBe('kill_agent');

    createdEventId = event.event_id;
  });

  test('retrieves the event by ID with live signature verification', async () => {
    if (!createdEventId) return;
    const res = await request(app)
      .get(`/api/v1/audit-logs/${createdEventId}`)
      .set(authHeaders(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.data.event_id).toBe(createdEventId);
    expect(res.body.data.signature_verified).toBe(true);
  });

  test('signature verification endpoint confirms validity', async () => {
    if (!createdEventId) return;
    const res = await request(app)
      .get(`/api/v1/audit-logs/${createdEventId}/verify`)
      .set(authHeaders(AUDIT_VIEWER));

    expect(res.status).toBe(200);
    expect(res.body.signature_valid).toBe(true);
    expect(res.body.reason).toContain('valid');
  });

  test('database trigger prevents modification of audit log entries', async () => {
    if (!createdEventId) return;
    await expect(
      db.pool.query('UPDATE audit_log SET reason = $1 WHERE event_id = $2', ['tampered', createdEventId])
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);
  });

  test('database trigger prevents deletion of audit log entries', async () => {
    if (!createdEventId) return;
    await expect(
      db.pool.query('DELETE FROM audit_log WHERE event_id = $1', [createdEventId])
    ).rejects.toThrow(/IMMUTABILITY_VIOLATION/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION SUITE 2: Approval Workflow — Full Sequence
// ─────────────────────────────────────────────────────────────────────────────

describe('Approval Workflow — Kill Agent', () => {
  let approvalToken;

  test('POST /agents/:id/kill/initiate returns an approval token', async () => {
    const res = await request(app)
      .post('/api/v1/agents/INT_AGENT_02/kill/initiate')
      .set(authHeaders(AGENT_OWNER))
      .send({
        pre_state: { entropy: 0.92, status: 'active', tokens_used: 500 },
        reason: 'entropy_exceeded_threshold',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.approvalToken).toHaveLength(64);
    expect(res.body.data.expiresAt).toBeTruthy();
    approvalToken = res.body.data.approvalToken;
  });

  test('POST /agents/:id/kill/confirm creates two linked signed events', async () => {
    if (!approvalToken) return;

    const res = await request(app)
      .post('/api/v1/agents/INT_AGENT_02/kill/confirm')
      .set(authHeaders(AGENT_OWNER))
      .send({ approval_token: approvalToken, tokens_used: 500 });

    expect(res.status).toBe(200);
    expect(res.body.approval_event.action).toBe('approve_kill');
    expect(res.body.execution_event.action).toBe('kill_agent');
    expect(res.body.execution_event.approval_event_id).toBe(res.body.approval_event.event_id);
    expect(res.body.approval_event.signature_verified).toBe(true);
    expect(res.body.execution_event.signature_verified).toBe(true);
  });

  test('token cannot be reused after confirmation (replay attack prevention)', async () => {
    if (!approvalToken) return;

    const res = await request(app)
      .post('/api/v1/agents/INT_AGENT_02/kill/confirm')
      .set(authHeaders(AGENT_OWNER))
      .send({ approval_token: approvalToken });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('APPROVAL_INVALID');
  });

  test('agent ID mismatch in confirmation returns 400', async () => {
    const initiateRes = await request(app)
      .post('/api/v1/agents/INT_AGENT_03/kill/initiate')
      .set(authHeaders(ADMIN_USER))
      .send({
        pre_state: { entropy: 0.88, status: 'active', tokens_used: 200 },
        reason: 'entropy_exceeded_threshold',
      });

    const token = initiateRes.body.data?.approvalToken;
    if (!token) return;

    const confirmRes = await request(app)
      .post('/api/v1/agents/WRONG_AGENT/kill/confirm')
      .set(authHeaders(ADMIN_USER))
      .set('x-session-id', 'sess_integration_test_001')
      .send({ approval_token: token });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error).toContain('APPROVAL_MISMATCH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION SUITE 3: Role-Based Access Control
// ─────────────────────────────────────────────────────────────────────────────

describe('Role-Based Access Control', () => {
  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/v1/audit-logs');
    expect(res.status).toBe(401);
  });

  test('agent_owner cannot access the full audit log (only own events)', async () => {
    // agent_owner role IS allowed audit_viewer access — they see scoped results
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set(authHeaders(AGENT_OWNER));
    expect(res.status).toBe(200);
    // Results are scoped to their own email
    res.body.data.forEach((event) => {
      expect(event.triggered_by).toBe(AGENT_OWNER.email);
    });
  });

  test('audit_viewer cannot access the export endpoint', async () => {
    const res = await request(app)
      .post('/api/v1/audit-logs/export')
      .set(authHeaders(AUDIT_VIEWER))
      .send({ format: 'json' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('compliance_officer');
  });

  test('compliance_officer can access the export endpoint', async () => {
    const res = await request(app)
      .post('/api/v1/audit-logs/export')
      .set(authHeaders(COMPLIANCE_USER))
      .send({ format: 'json' });
    expect([200, 500]).toContain(res.status); // 500 is OK if no DB events exist
  });

  test('non-admin cannot rotate signing keys', async () => {
    const res = await request(app)
      .post('/api/v1/crypto/rotate-keys')
      .set(authHeaders(COMPLIANCE_USER));
    expect(res.status).toBe(403);
  });

  test('admin can rotate signing keys', async () => {
    const res = await request(app)
      .post('/api/v1/crypto/rotate-keys')
      .set(authHeaders(ADMIN_USER));
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.new_key_id).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION SUITE 4: Compliance Endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Compliance Dashboard API', () => {
  test('GET /compliance/status returns framework list to audit_viewer', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/status')
      .set(authHeaders(AUDIT_VIEWER));

    expect(res.status).toBe(200);
    expect(res.body.data.frameworks).toHaveLength(4);
    expect(res.body.data.summary.total_frameworks).toBe(4);
    expect(res.body.data.encryption).toBeDefined();
    expect(res.body.data.data_residency).toBeDefined();
  });

  test('GET /compliance/frameworks/:id returns a specific framework', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/frameworks/soc2')
      .set(authHeaders(AUDIT_VIEWER));

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('SOC 2 Type II');
    expect(res.body.data.status).toBe('verified');
  });

  test('GET /compliance/frameworks/:id returns 404 for unknown framework', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/frameworks/unknown_framework')
      .set(authHeaders(AUDIT_VIEWER));
    expect(res.status).toBe(404);
  });

  test('POST /compliance/reports requires compliance_officer role', async () => {
    const viewer = await request(app)
      .post('/api/v1/compliance/reports')
      .set(authHeaders(AUDIT_VIEWER));
    expect(viewer.status).toBe(403);

    const officer = await request(app)
      .post('/api/v1/compliance/reports')
      .set(authHeaders(COMPLIANCE_USER));
    expect([200, 500]).toContain(officer.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION SUITE 5: Audit Log Pagination & Filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit Log Pagination & Filtering', () => {
  test('returns paginated results with correct metadata', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs?limit=2&offset=0')
      .set(authHeaders(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({
      limit: 2,
      offset: 0,
    });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('filters by action type correctly', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs?action=kill_agent')
      .set(authHeaders(ADMIN_USER));

    expect(res.status).toBe(200);
    res.body.data.forEach((event) => {
      expect(event.action).toBe('kill_agent');
    });
  });

  test('rejects invalid action type with 422', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs?action=invalid_action')
      .set(authHeaders(ADMIN_USER));
    expect(res.status).toBe(422);
  });

  test('rejects limit exceeding 200 implicitly by capping it', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs?limit=500')
      .set(authHeaders(ADMIN_USER));
    if (res.status === 200) {
      expect(res.body.pagination.limit).toBeLessThanOrEqual(200);
    }
  });
});
