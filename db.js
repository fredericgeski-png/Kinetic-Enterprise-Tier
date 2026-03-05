/**
 * @fileoverview Kinetic v1.1 - Audit Log Database Schema & Migrations
 * @module audit/db
 *
 * Implements PostgreSQL schema with write-once immutability constraints,
 * database-level triggers that reject UPDATE/DELETE operations, and
 * composite indexes optimized for compliance query patterns.
 */

'use strict';

const { Pool } = require('pg');

/**
 * PostgreSQL connection pool configured via environment variables.
 * For audit workloads, point AUDIT_DATABASE_URL at a read replica
 * to isolate compliance queries from the operational database.
 */
const pool = new Pool({
  connectionString: process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('[AuditDB] Unexpected pool error:', err.message);
});

// ─────────────────────────────────────────────────────────────────────────────
// DDL: SCHEMA MIGRATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQL migrations executed in order. Each migration is idempotent.
 * Run via `runMigrations()` during application startup.
 */
const MIGRATIONS = [

  // ── 001: Custom ENUM types ──────────────────────────────────────────────
  `
  DO $$ BEGIN
    CREATE TYPE audit_action_type AS ENUM (
      'kill_agent',
      'kill_all',
      'safe_mode',
      'approve_kill',
      'deny_kill',
      'key_rotation',
      'role_change',
      'login',
      'logout',
      'export_logs',
      'compliance_report'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  `,

  `
  DO $$ BEGIN
    CREATE TYPE audit_execution_status AS ENUM (
      'success',
      'failed',
      'pending',
      'cancelled'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  `,

  `
  DO $$ BEGIN
    CREATE TYPE agent_status_type AS ENUM (
      'active',
      'terminated',
      'safe_mode',
      'pending_kill',
      'error'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  `,

  // ── 002: Core audit_log table ───────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS audit_log (
    -- Identity
    event_id              TEXT          PRIMARY KEY,
    sequence_number       BIGSERIAL     UNIQUE NOT NULL,

    -- Temporal
    timestamp             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Action context
    action                audit_action_type NOT NULL,
    agent_id              TEXT          NOT NULL,
    session_id            TEXT          NOT NULL,

    -- Actor
    triggered_by          TEXT          NOT NULL,
    user_role             TEXT          NOT NULL,

    -- State snapshots (JSONB for flexibility, validated at app layer)
    pre_state             JSONB         NOT NULL DEFAULT '{}',
    post_state            JSONB         NOT NULL DEFAULT '{}',

    -- Outcome
    reason                TEXT          NOT NULL,
    execution_status      audit_execution_status NOT NULL,

    -- Cryptographic integrity
    payload_hash          TEXT          NOT NULL,
    signature             TEXT          NOT NULL,
    signature_algorithm   TEXT          NOT NULL DEFAULT 'RSA-SHA256',
    signature_verified    BOOLEAN       NOT NULL DEFAULT FALSE,
    signing_key_id        TEXT,

    -- Immutability markers
    immutable             BOOLEAN       NOT NULL DEFAULT TRUE,
    checksum              TEXT          NOT NULL,

    -- Optional blockchain anchoring (v1.2+)
    blockchain_hash       TEXT,
    blockchain_anchored_at TIMESTAMPTZ,

    -- Workflow linkage
    approval_event_id     TEXT          REFERENCES audit_log(event_id),

    CONSTRAINT event_id_format CHECK (event_id ~ '^evt_[0-9a-f]{32}$'),
    CONSTRAINT triggered_by_email CHECK (triggered_by ~ '^[^@]+@[^@]+\.[^@]+$'),
    CONSTRAINT payload_hash_format CHECK (payload_hash ~ '^0x[0-9a-f]+$')
  );
  `,

  // ── 003: Indexes for common compliance query patterns ───────────────────
  `CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp      ON audit_log (timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_agent_id       ON audit_log (agent_id, timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_triggered_by   ON audit_log (triggered_by, timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_action         ON audit_log (action, timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_session        ON audit_log (session_id);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_sequence       ON audit_log (sequence_number);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_unverified     ON audit_log (signature_verified) WHERE signature_verified = FALSE;`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_pre_state      ON audit_log USING GIN (pre_state);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_post_state     ON audit_log USING GIN (post_state);`,

  // ── 004: Immutability trigger — rejects UPDATE and DELETE ───────────────
  `
  CREATE OR REPLACE FUNCTION enforce_audit_immutability()
  RETURNS TRIGGER AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION
        'IMMUTABILITY_VIOLATION: audit_log entry "%" cannot be modified after creation. '
        'Attempted operation: UPDATE by session user "%".',
        OLD.event_id, session_user
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'IMMUTABILITY_VIOLATION: audit_log entry "%" cannot be deleted. '
        'Attempted operation: DELETE by session user "%".',
        OLD.event_id, session_user
        USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  `,

  `
  DROP TRIGGER IF EXISTS trg_audit_immutability ON audit_log;
  CREATE TRIGGER trg_audit_immutability
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION enforce_audit_immutability();
  `,

  // ── 005: Checksum integrity function ────────────────────────────────────
  `
  CREATE OR REPLACE FUNCTION compute_audit_checksum(
    p_event_id    TEXT,
    p_timestamp   TIMESTAMPTZ,
    p_action      TEXT,
    p_agent_id    TEXT,
    p_triggered_by TEXT,
    p_payload_hash TEXT
  ) RETURNS TEXT AS $$
  BEGIN
    RETURN encode(
      digest(
        p_event_id || '|' ||
        p_timestamp::TEXT || '|' ||
        p_action || '|' ||
        p_agent_id || '|' ||
        p_triggered_by || '|' ||
        p_payload_hash,
        'sha256'
      ),
      'hex'
    );
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;
  `,

  // ── 006: Periodic tamper-detection view ─────────────────────────────────
  `
  CREATE OR REPLACE VIEW audit_integrity_report AS
  SELECT
    DATE_TRUNC('day', timestamp) AS audit_date,
    COUNT(*)                     AS total_events,
    SUM(CASE WHEN signature_verified THEN 1 ELSE 0 END) AS verified_events,
    SUM(CASE WHEN NOT signature_verified THEN 1 ELSE 0 END) AS unverified_events,
    SUM(CASE WHEN blockchain_hash IS NOT NULL THEN 1 ELSE 0 END) AS anchored_events,
    MIN(sequence_number)         AS first_sequence,
    MAX(sequence_number)         AS last_sequence
  FROM audit_log
  GROUP BY DATE_TRUNC('day', timestamp)
  ORDER BY audit_date DESC;
  `,

  // ── 007: Signing keys registry ──────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS signing_keys (
    key_id          TEXT        PRIMARY KEY,
    public_key_pem  TEXT        NOT NULL,
    algorithm       TEXT        NOT NULL DEFAULT 'RSA-2048',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at      TIMESTAMPTZ,
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by      TEXT        NOT NULL
  );
  `,

  `CREATE INDEX IF NOT EXISTS idx_signing_keys_active ON signing_keys (active) WHERE active = TRUE;`,

  // ── 008: Role assignments table ─────────────────────────────────────────
  `
  DO $$ BEGIN
    CREATE TYPE kinetic_role AS ENUM (
      'admin',
      'compliance_officer',
      'audit_viewer',
      'agent_owner'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  `,

  `
  CREATE TABLE IF NOT EXISTS user_roles (
    email         TEXT          NOT NULL,
    role          kinetic_role  NOT NULL,
    granted_by    TEXT          NOT NULL,
    granted_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ,
    active        BOOLEAN       NOT NULL DEFAULT TRUE,
    PRIMARY KEY (email, role)
  );
  `,

  `CREATE INDEX IF NOT EXISTS idx_user_roles_email  ON user_roles (email) WHERE active = TRUE;`,
  `CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles (active) WHERE active = TRUE;`,
];

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION RUNNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes all DDL migrations in sequence within a single transaction.
 * Safe to run on every application startup — all statements are idempotent.
 *
 * @returns {Promise<void>}
 * @throws {Error} If any migration fails; the transaction is rolled back.
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[AuditDB] Running migrations…');
    for (let i = 0; i < MIGRATIONS.length; i++) {
      await client.query(MIGRATIONS[i]);
    }
    await client.query('COMMIT');
    console.log(`[AuditDB] ${MIGRATIONS.length} migration steps applied successfully.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[AuditDB] Migration failed, transaction rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA ACCESS LAYER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a single audit log entry. The database trigger prevents any
 * subsequent modification. The application checksum is computed before
 * insert for additional tamper detection.
 *
 * @param {Object} entry - Fully-formed signed audit event.
 * @param {import('pg').PoolClient} [client] - Optional existing client (for transactions).
 * @returns {Promise<Object>} The persisted row including sequence_number.
 */
async function insertAuditLog(entry, client) {
  const db = client || pool;
  const sql = `
    INSERT INTO audit_log (
      event_id, timestamp, action, agent_id, session_id,
      triggered_by, user_role, pre_state, post_state,
      reason, execution_status,
      payload_hash, signature, signature_algorithm, signature_verified, signing_key_id,
      immutable, checksum,
      blockchain_hash, approval_event_id
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11,
      $12, $13, $14, $15, $16,
      TRUE, $17,
      $18, $19
    )
    RETURNING *, sequence_number;
  `;
  const values = [
    entry.event_id,
    entry.timestamp,
    entry.action,
    entry.agent_id,
    entry.session_id,
    entry.triggered_by,
    entry.user_role,
    JSON.stringify(entry.pre_state),
    JSON.stringify(entry.post_state),
    entry.reason,
    entry.execution_status,
    entry.payload_hash,
    entry.signature,
    entry.signature_algorithm || 'RSA-SHA256',
    entry.signature_verified || false,
    entry.signing_key_id || null,
    entry.checksum,
    entry.blockchain_hash || null,
    entry.approval_event_id || null,
  ];
  const result = await db.query(sql, values);
  return result.rows[0];
}

/**
 * Retrieves a single audit log entry by event ID.
 *
 * @param {string} eventId - UUID-format event identifier.
 * @returns {Promise<Object|null>}
 */
async function getAuditLogById(eventId) {
  const result = await pool.query(
    'SELECT * FROM audit_log WHERE event_id = $1',
    [eventId]
  );
  return result.rows[0] || null;
}

/**
 * Paginated query for audit logs with optional filtering.
 * All filters are additive (AND logic). Results are ordered by timestamp DESC.
 *
 * @param {Object} filters
 * @param {string}  [filters.action]      - Exact action type.
 * @param {string}  [filters.agent_id]    - Exact agent identifier.
 * @param {string}  [filters.triggered_by] - Email of the actor.
 * @param {string}  [filters.from]        - ISO 8601 start date (inclusive).
 * @param {string}  [filters.to]          - ISO 8601 end date (inclusive).
 * @param {boolean} [filters.verified_only] - Restrict to verified events.
 * @param {number}  [filters.limit=50]    - Page size (max 200).
 * @param {number}  [filters.offset=0]    - Pagination offset.
 * @returns {Promise<{rows: Object[], total: number}>}
 */
async function queryAuditLogs(filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.action) {
    conditions.push(`action = $${idx++}`);
    params.push(filters.action);
  }
  if (filters.agent_id) {
    conditions.push(`agent_id = $${idx++}`);
    params.push(filters.agent_id);
  }
  if (filters.triggered_by) {
    conditions.push(`triggered_by = $${idx++}`);
    params.push(filters.triggered_by);
  }
  if (filters.from) {
    conditions.push(`timestamp >= $${idx++}`);
    params.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    conditions.push(`timestamp <= $${idx++}`);
    params.push(new Date(filters.to).toISOString());
  }
  if (filters.verified_only) {
    conditions.push('signature_verified = TRUE');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(parseInt(filters.limit) || 50, 200);
  const offset = parseInt(filters.offset) || 0;

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) FROM audit_log ${where}`, params),
  ]);

  return {
    rows: dataResult.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}

/**
 * Fetches all audit logs for bulk export (streams up to retention limit).
 * Intended for compliance team use; enforced at the API layer by role check.
 *
 * @param {Object} filters - Same filter shape as queryAuditLogs.
 * @returns {Promise<Object[]>}
 */
async function exportAuditLogs(filters = {}) {
  const { rows } = await queryAuditLogs({ ...filters, limit: 10000, offset: 0 });
  return rows;
}

/**
 * Stores a public signing key for later signature verification.
 *
 * @param {string} keyId        - Unique key identifier.
 * @param {string} publicKeyPem - PEM-encoded RSA public key.
 * @param {string} createdBy    - Email of the admin who registered the key.
 * @returns {Promise<Object>}
 */
async function storeSigningKey(keyId, publicKeyPem, createdBy) {
  const result = await pool.query(
    `INSERT INTO signing_keys (key_id, public_key_pem, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key_id) DO NOTHING
     RETURNING *`,
    [keyId, publicKeyPem, createdBy]
  );
  return result.rows[0];
}

/**
 * Retrieves the currently active signing public key.
 *
 * @returns {Promise<Object|null>}
 */
async function getActiveSigningKey() {
  const result = await pool.query(
    'SELECT * FROM signing_keys WHERE active = TRUE ORDER BY created_at DESC LIMIT 1'
  );
  return result.rows[0] || null;
}

/**
 * Retrieves a signing key by ID (supports historical verification after rotation).
 *
 * @param {string} keyId
 * @returns {Promise<Object|null>}
 */
async function getSigningKeyById(keyId) {
  const result = await pool.query(
    'SELECT * FROM signing_keys WHERE key_id = $1',
    [keyId]
  );
  return result.rows[0] || null;
}

/**
 * Rotates signing keys: deactivates the current key and registers the new one.
 * Both operations occur within a single transaction.
 *
 * @param {string} newKeyId       - Identifier for the new key.
 * @param {string} newPublicKeyPem - PEM-encoded RSA public key.
 * @param {string} rotatedBy      - Email of the admin performing rotation.
 * @returns {Promise<Object>} The newly registered key record.
 */
async function rotateSigningKey(newKeyId, newPublicKeyPem, rotatedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE signing_keys SET active = FALSE, rotated_at = NOW() WHERE active = TRUE'
    );
    const result = await client.query(
      `INSERT INTO signing_keys (key_id, public_key_pem, created_by, active)
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [newKeyId, newPublicKeyPem, rotatedBy]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Computes a chain checksum across a sequence range to detect gaps or
 * out-of-order insertions — a lightweight tamper detection mechanism
 * that supplements the per-row cryptographic signatures.
 *
 * @param {number} fromSeq - Start sequence number (inclusive).
 * @param {number} toSeq   - End sequence number (inclusive).
 * @returns {Promise<{count: number, chain_hash: string}>}
 */
async function computeChainChecksum(fromSeq, toSeq) {
  const result = await pool.query(
    `SELECT COUNT(*) AS count,
            encode(digest(string_agg(checksum, '' ORDER BY sequence_number), 'sha256'), 'hex') AS chain_hash
     FROM audit_log
     WHERE sequence_number BETWEEN $1 AND $2`,
    [fromSeq, toSeq]
  );
  return result.rows[0];
}

module.exports = {
  pool,
  runMigrations,
  insertAuditLog,
  getAuditLogById,
  queryAuditLogs,
  exportAuditLogs,
  storeSigningKey,
  getActiveSigningKey,
  getSigningKeyById,
  rotateSigningKey,
  computeChainChecksum,
};
