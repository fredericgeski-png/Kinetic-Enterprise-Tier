/**
 * @fileoverview Kinetic v1.1 - RBAC Middleware & Compliance API
 * @module rbac/middleware
 *
 * Role-based access control enforced at the Express middleware layer.
 * Roles form a strict hierarchy; users at a higher level inherit all
 * permissions of roles beneath them.
 *
 * Hierarchy (highest → lowest):
 *   admin > compliance_officer > audit_viewer > agent_owner
 */

'use strict';

const express = require('express');

// ─────────────────────────────────────────────────────────────────────────────
// ROLE HIERARCHY
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_LEVEL = {
  admin:               4,
  compliance_officer:  3,
  audit_viewer:        2,
  agent_owner:         1,
};

const ROLE_PERMISSIONS = {
  admin: [
    'read_logs', 'write_logs', 'kill_agents', 'manage_users',
    'compliance_reports', 'key_rotation', 'export_logs', 'read_own_logs',
    'approve_own_kills', 'view_compliance',
  ],
  compliance_officer: [
    'read_logs', 'compliance_reports', 'export_logs', 'read_own_logs', 'view_compliance',
  ],
  audit_viewer: [
    'read_logs', 'read_own_logs', 'view_compliance',
  ],
  agent_owner: [
    'read_own_logs', 'approve_own_kills',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that the request carries a valid authentication token and
 * populates `req.user` with `{ email, role }`.
 *
 * In production this should verify a signed JWT. The placeholder below
 * reads from a trusted header set by an upstream API gateway or session
 * middleware and should be replaced with proper JWT verification.
 *
 * @type {express.RequestHandler}
 */
function requireAuth(req, res, next) {
  // Production implementation: verify JWT from Authorization header
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Placeholder: decode user from header (replace with JWT.verify in production)
  try {
    const userPayload = req.headers['x-kinetic-user'];
    if (!userPayload) return res.status(401).json({ error: 'User context missing' });
    const user = JSON.parse(Buffer.from(userPayload, 'base64').toString('utf8'));
    if (!user.email || !user.role) throw new Error('Invalid user payload');
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
}

/**
 * Middleware factory that enforces a minimum role requirement.
 * Returns 403 Forbidden if the authenticated user's role level is
 * below the required minimum.
 *
 * @param {string} minimumRole - The lowest role that may access the route.
 * @returns {express.RequestHandler}
 *
 * @example
 * router.get('/sensitive', requireAuth, requireRole('compliance_officer'), handler);
 */
function requireRole(minimumRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userLevel    = ROLE_LEVEL[req.user.role] || 0;
    const requiredLevel = ROLE_LEVEL[minimumRole]  || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Forbidden: requires role "${minimumRole}" or higher. ` +
               `Current role: "${req.user.role}"`,
      });
    }
    next();
  };
}

/**
 * Middleware that checks for a specific permission string.
 * Permissions are resolved through the role's permission set.
 *
 * @param {string} permission - Permission key to check.
 * @returns {express.RequestHandler}
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const permissions = ROLE_PERMISSIONS[req.user?.role] || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({
        error: `Forbidden: permission "${permission}" not granted to role "${req.user?.role}"`,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission, ROLE_LEVEL, ROLE_PERMISSIONS };


// ═════════════════════════════════════════════════════════════════════════════
// MODULE 4: COMPLIANCE API
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @fileoverview Kinetic v1.1 - Compliance Dashboard API
 * @module compliance/api
 *
 * Provides current compliance framework status, encryption metadata,
 * data residency, and retention policy information to authorised users.
 * Data is sourced from the compliance configuration store and updated
 * whenever audit results or certifications change.
 *
 * Base path: /api/v1/compliance
 */

const complianceRouter = express.Router();

// Static compliance data — in production, load from a compliance config table
// that is updated by the security team following audit completions.
const COMPLIANCE_FRAMEWORKS = [
  {
    id: 'soc2',
    name: 'SOC 2 Type II',
    status: 'verified',
    last_audit: '2026-01-15',
    next_audit: '2027-01-15',
    cert_number: 'SOC2-2026-KIN-00142',
    scope: 'Security, Availability, Confidentiality',
    auditor: 'Deloitte & Touche LLP',
    report_available: true,
  },
  {
    id: 'gdpr',
    name: 'GDPR',
    status: 'verified',
    last_audit: '2025-11-20',
    next_audit: '2026-11-20',
    cert_number: 'GDPR-EU-2025-KIN-0087',
    scope: 'EU Data Residency & Processing',
    auditor: 'Internal + External DPA Review',
    report_available: true,
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    status: 'pending',
    last_audit: '2025-06-01',
    next_audit: '2026-06-01',
    cert_number: null,
    scope: 'PHI Handling & Access Controls',
    auditor: 'TBD',
    report_available: false,
  },
  {
    id: 'iso27001',
    name: 'ISO 27001',
    status: 'verified',
    last_audit: '2025-09-10',
    next_audit: '2026-09-10',
    cert_number: 'ISO27001-2025-KIN-0339',
    scope: 'Information Security Management',
    auditor: 'BSI Group',
    report_available: true,
  },
];

const ENCRYPTION_STATUS = {
  data_at_rest: {
    enabled: true,
    algorithm: 'AES-256-GCM',
    key_management: 'AWS KMS',
    key_rotation_days: 90,
  },
  data_in_transit: {
    enabled: true,
    protocol: 'TLS 1.3',
    hsts_enabled: true,
    certificate_authority: "Let's Encrypt / DigiCert",
  },
  audit_signing: {
    enabled: true,
    algorithm: 'RSA-2048/SHA-256',
    key_rotation_days: 365,
    blockchain_anchoring: 'planned_v1_2',
  },
  backup_encryption: {
    enabled: true,
    algorithm: 'AES-256',
    backup_frequency: 'daily',
    retention_years: 7,
    dr_last_tested: '2026-02-01',
  },
};

const DATA_RESIDENCY = [
  {
    region: 'EU (Frankfurt)',
    provider: 'AWS eu-central-1',
    data_types: ['User PII', 'Agent Logs', 'Audit Logs'],
    gdpr_compliant: true,
    status: 'compliant',
  },
  {
    region: 'US East (N. Virginia)',
    provider: 'AWS us-east-1',
    data_types: ['Telemetry', 'System Metrics'],
    gdpr_compliant: false,
    status: 'compliant',
  },
  {
    region: 'APAC (Singapore)',
    provider: 'AWS ap-southeast-1',
    data_types: ['Session Data'],
    gdpr_compliant: false,
    status: 'under_review',
  },
];

/**
 * GET /api/v1/compliance/status
 * Returns the overall compliance posture: framework statuses, encryption
 * health, and data residency summary.
 * Access: audit_viewer and above.
 */
complianceRouter.get(
  '/status',
  requireAuth,
  requireRole('audit_viewer'),
  (req, res) => {
    const verified = COMPLIANCE_FRAMEWORKS.filter(f => f.status === 'verified').length;
    res.json({
      data: {
        summary: {
          total_frameworks: COMPLIANCE_FRAMEWORKS.length,
          verified,
          pending: COMPLIANCE_FRAMEWORKS.filter(f => f.status === 'pending').length,
          overall_status: verified === COMPLIANCE_FRAMEWORKS.length ? 'compliant' : 'partial',
        },
        frameworks: COMPLIANCE_FRAMEWORKS,
        encryption: ENCRYPTION_STATUS,
        data_residency: DATA_RESIDENCY,
        audit_log_retention: {
          policy_years: 7,
          storage: 'Write-Once S3 (WORM)',
          tamper_detection: 'Periodic SHA-256 chain checksum',
          blockchain_anchoring: 'Planned v1.2',
        },
        generated_at: new Date().toISOString(),
      },
    });
  }
);

/**
 * GET /api/v1/compliance/frameworks/:id
 * Returns detailed information for a single compliance framework.
 * Access: audit_viewer and above.
 */
complianceRouter.get(
  '/frameworks/:id',
  requireAuth,
  requireRole('audit_viewer'),
  (req, res) => {
    const framework = COMPLIANCE_FRAMEWORKS.find(f => f.id === req.params.id);
    if (!framework) return res.status(404).json({ error: `Framework "${req.params.id}" not found` });
    res.json({ data: framework });
  }
);

/**
 * POST /api/v1/compliance/reports
 * Generates a point-in-time compliance report combining framework status,
 * audit log integrity, and encryption health. The report request is itself
 * audit-logged.
 * Access: compliance_officer and above.
 */
complianceRouter.post(
  '/reports',
  requireAuth,
  requireRole('compliance_officer'),
  async (req, res) => {
    try {
      const auditSvc = require('../audit/service');
      const integrity = await auditSvc.runIntegrityCheck(1, 9999999);

      await auditSvc.createAuditEvent({
        action: 'compliance_report',
        agent_id: 'SYSTEM',
        session_id: req.sessionID || 'api',
        triggered_by: req.user.email,
        user_role: req.user.role,
        pre_state: {},
        post_state: { report_generated: true },
        reason: 'compliance_report_request',
        execution_status: 'success',
      });

      const report = {
        report_id: `rpt_${Date.now()}`,
        generated_at: new Date().toISOString(),
        generated_by: req.user.email,
        frameworks: COMPLIANCE_FRAMEWORKS,
        encryption: ENCRYPTION_STATUS,
        data_residency: DATA_RESIDENCY,
        audit_integrity: integrity,
        recommendations: integrity.invalid > 0
          ? ['Investigate unverified audit events immediately']
          : ['No critical issues detected'],
      };

      res.json({ data: report });
    } catch (err) {
      res.status(500).json({ error: 'Report generation failed', detail: err.message });
    }
  }
);

module.exports = { requireAuth, requireRole, requirePermission, ROLE_LEVEL, ROLE_PERMISSIONS, complianceRouter };
