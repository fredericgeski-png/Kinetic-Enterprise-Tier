/**
 * @fileoverview Kinetic v1.1 - Application Entry Point & Architecture Documentation
 * @module app
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KINETIC v1.1 ENTERPRISE — BACKEND ARCHITECTURE OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This document describes the security architecture, cryptographic guarantees,
 * immutability model, and operational procedures for the Kinetic v1.1
 * enterprise audit and compliance subsystem.
 *
 * ─── MODULE INVENTORY ────────────────────────────────────────────────────────
 *
 *  src/audit/
 *    db.js       PostgreSQL schema with write-once immutability triggers,
 *                ENUM types, composite indexes, and integrity views.
 *    service.js  Business logic: event creation, signing integration, RBAC
 *                scoping, CSV/JSON export, and chain-checksum integrity checks.
 *    api.js      Express routes: paginated log access, single-event retrieval,
 *                signature verification endpoint, bulk export (compliance_officer+).
 *    tests.js    Unit tests for serialization, hashing, formatting, RBAC,
 *                and CSV conversion (Jest, >90% coverage target).
 *
 *  src/crypto/
 *    service.js  RSA-2048/SHA-256 signing and verification. Key initialisation
 *                from AWS Secrets Manager (prod) or environment variables (dev).
 *                Key rotation with backwards-compatible public key registry.
 *    api.js      Routes: active public key retrieval, off-system verification,
 *                admin-gated key rotation with audit logging.
 *    tests.js    Unit tests for sign→verify round-trips, tamper detection,
 *                rotation, registry behaviour, and failure modes.
 *
 *  src/approval/
 *    service.js  Human-in-the-loop approval workflow: token issuance,
 *                CSRF-resistant confirmation, dual signed-event creation
 *                (approve_kill + kill_agent), and denial logging.
 *                Express router co-located for reference per spec.
 *
 *  src/rbac/
 *    middleware.js  requireAuth, requireRole, requirePermission Express
 *                   middleware. Role hierarchy: admin > compliance_officer >
 *                   audit_viewer > agent_owner. Compliance API routes for
 *                   framework status, data residency, and report generation.
 *
 *  src/tests/
 *    integration.js  End-to-end tests covering the full stack via supertest:
 *                    event lifecycle, approval workflow, RBAC enforcement,
 *                    compliance endpoints, and pagination/filtering.
 *
 *  app.js (this file)
 *    Application entry point, startup sequence, and architecture documentation.
 *
 * ─── IMMUTABILITY GUARANTEES ─────────────────────────────────────────────────
 *
 *  Layer 1 — Database triggers:
 *    The PostgreSQL trigger `trg_audit_immutability` fires BEFORE UPDATE OR
 *    DELETE on the `audit_log` table and raises a `restrict_violation` error,
 *    aborting any modification attempt regardless of the calling user or role.
 *    Even the database superuser cannot bypass a BEFORE trigger without
 *    explicitly dropping it — which is itself a logged, observable operation.
 *
 *  Layer 2 — Application validation:
 *    The service layer does not expose any update or delete methods for audit
 *    events. All writes flow through `createAuditEvent()`, which is the single
 *    entry point. There is no code path that calls UPDATE or DELETE on audit_log.
 *
 *  Layer 3 — Per-row checksum:
 *    Each row carries a SHA-256 checksum computed from its key fields
 *    (event_id, timestamp, action, agent_id, triggered_by, payload_hash).
 *    The `computeChainChecksum()` function accumulates these across a sequence
 *    range to detect gaps, re-ordering, or storage-layer interference.
 *
 *  Layer 4 — Cryptographic signature:
 *    Each event is signed with RSA-2048/SHA-256 before persistence. Any
 *    modification to any field of the canonical payload invalidates the
 *    signature, which is re-verified on every read via `verifyEventSignature()`.
 *
 * ─── CRYPTOGRAPHIC VERIFICATION PROCESS ─────────────────────────────────────
 *
 *  1. EVENT CREATION
 *     The canonical JSON is constructed by `canonicalizeEvent()`, which
 *     sorts all object keys alphabetically and strips whitespace. This
 *     produces a deterministic byte sequence regardless of the runtime
 *     environment or JavaScript engine version.
 *
 *  2. PAYLOAD HASH
 *     SHA-256(canonicalJson) → hex string prefixed with "0x".
 *     Stored in the `payload_hash` column. On retrieval, this hash is
 *     recomputed and compared before the RSA signature is checked.
 *
 *  3. RSA SIGNATURE
 *     createSign('RSA-SHA256').update(canonicalJson).sign(privateKey, 'base64')
 *     PKCS#1 v1.5 padding. Stored in the `signature` column as base64.
 *     The `signing_key_id` column identifies which key was used.
 *
 *  4. VERIFICATION (on every read)
 *     a. Reconstruct canonicalJson from stored field values.
 *     b. Recompute SHA-256(canonicalJson) and compare to stored payload_hash.
 *        If they differ, the event data has been altered — return invalid.
 *     c. Look up the public key by signing_key_id (supports post-rotation reads).
 *     d. createVerify('RSA-SHA256').verify(publicKey, signature, 'base64').
 *
 *  5. KEY ROTATION
 *     rotateKey() deactivates the current private key and generates a new
 *     RSA-2048 pair. The previous PUBLIC key is retained in the in-memory
 *     registry and in the signing_keys database table so that events signed
 *     before rotation remain fully verifiable. Private key material is
 *     never stored in the database.
 *
 * ─── APPROVAL WORKFLOW ───────────────────────────────────────────────────────
 *
 *  Every kill action follows a mandatory two-step workflow:
 *
 *  1. INITIATE  →  POST /agents/:id/kill/initiate
 *     Returns a 32-byte (64-hex-char) cryptographically random approval token
 *     with a 5-minute TTL. The token is session-bound and agent-bound.
 *
 *  2. CONFIRM   →  POST /agents/:id/kill/confirm  { approval_token }
 *     a. Token is validated: existence, expiry, session match, agent match.
 *     b. Token is consumed immediately (single-use; replay impossible).
 *     c. Signed APPROVE event is created and persisted.
 *     d. Agent termination is executed.
 *     e. Signed EXECUTION event is created, with `approval_event_id` set to
 *        the APPROVE event's ID, forming a cryptographic chain.
 *
 *  The confirmation endpoint validates agent ID server-side, so a UI that
 *  sends the wrong agent ID (including attempts at parameter substitution)
 *  receives APPROVAL_MISMATCH and the action is not executed.
 *
 * ─── ROLE-BASED ACCESS CONTROL ───────────────────────────────────────────────
 *
 *  Role              Level  Permitted operations
 *  ────────────────  ─────  ──────────────────────────────────────────────────
 *  admin               4    All operations including key rotation and RBAC mgmt
 *  compliance_officer  3    Read logs, export logs, generate compliance reports
 *  audit_viewer        2    Read logs, view compliance status
 *  agent_owner         1    Read own logs (scoped to email), approve own kills
 *
 *  Enforcement occurs in two places:
 *  - API layer: requireRole() middleware returns 403 before the handler runs.
 *  - Service layer: applyRbacScope() narrows database queries for agent_owner.
 *
 * ─── KEY OPERATIONAL PROCEDURES ──────────────────────────────────────────────
 *
 *  Annual key rotation:
 *    POST /api/v1/crypto/rotate-keys  (admin only, rate-limited to 5/hour)
 *    The new key ID and public key are persisted to the signing_keys table.
 *    Historical events signed with the previous key remain verifiable.
 *
 *  Integrity audit:
 *    GET /api/v1/audit-logs/integrity/report  (compliance_officer+)
 *    Runs a batch signature re-verification and computes the chain checksum
 *    across a configurable sequence range. Output is suitable for inclusion
 *    in SOC 2 or ISO 27001 evidence packages.
 *
 *  Compliance export:
 *    POST /api/v1/audit-logs/export  { format: 'json' | 'csv' }  (compliance_officer+)
 *    Exports all matching events with full cryptographic metadata.
 *    The export action itself is audit-logged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const db            = require('./src/audit/db');
const cryptoService = require('./src/crypto/service');
const auditRouter   = require('./src/audit/api');
const cryptoRouter  = require('./src/crypto/api');
const approvalSvc   = require('./src/approval/service');
const { complianceRouter } = require('./src/rbac/middleware');

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
      },
    },
  }));

  app.use(cors({
    origin:      process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));

  // Health check (unauthenticated)
  app.get('/health', (req, res) => {
    res.json({
      status:  'ok',
      version: '1.1.0',
      signing_key_id: cryptoService.getActiveKeyId(),
      timestamp: new Date().toISOString(),
    });
  });

  // Mount enterprise feature routers
  app.use('/api/v1/audit-logs', auditRouter);
  app.use('/api/v1/crypto',     cryptoRouter);
  app.use('/api/v1/compliance', complianceRouter);
  app.use('/api/v1',            approvalSvc.router);

  // Structured error handler
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    console.error(`[App] ${req.method} ${req.path} → ${status}:`, err.message);
    res.status(status).json({
      error:   err.message || 'Internal server error',
      path:    req.path,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

async function start() {
  try {
    console.info('[Kinetic] Starting Kinetic v1.1 Enterprise Backend…');

    // 1. Run database migrations (idempotent)
    await db.runMigrations();
    console.info('[Kinetic] Database migrations complete.');

    // 2. Initialise cryptographic signing service
    const { keyId, publicKeyPem } = await cryptoService.initialise();
    console.info(`[Kinetic] Signing service ready. Active key: ${keyId}`);

    // 3. Register the public key in the database for historical verification
    await db.storeSigningKey(keyId, publicKeyPem, 'system_startup');

    // 4. Load all existing public keys into the in-memory registry
    //    so that events signed before a process restart remain verifiable
    const activeKey = await db.getActiveSigningKey();
    if (activeKey) {
      cryptoService.registerPublicKey(activeKey.key_id, activeKey.public_key_pem);
    }

    // 5. Start Express server
    const app  = createApp();
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
      console.info(`[Kinetic] Server listening on port ${PORT}`);
      console.info('[Kinetic] Enterprise audit subsystem active.');
    });

  } catch (err) {
    console.error('[Kinetic] Startup failed:', err.message);
    process.exit(1);
  }
}

// Guard against accidental execution during tests
if (require.main === module) {
  start();
}

module.exports = { createApp, start };
