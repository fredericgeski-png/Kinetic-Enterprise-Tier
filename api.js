/**
 * @fileoverview Kinetic v1.1 - Cryptographic Signing API Routes
 * @module crypto/api
 *
 * Exposes key management and signature verification endpoints.
 * Key rotation and public key inspection are admin-only operations.
 *
 * Base path: /api/v1/crypto
 */

'use strict';

const express  = require('express');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const cryptoService = require('./service');
const auditService  = require('../audit/service');
const db            = require('../audit/db');
const { requireAuth, requireRole } = require('../rbac/middleware');

const router = express.Router();

const strictRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Key rotation rate limit: maximum 5 rotations per hour.' },
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crypto/rotate-keys
 * Rotates the active RSA-2048 signing key. The new public key is persisted
 * to the signing_keys table. The rotation event is itself audit-logged.
 * Access: admin only.
 */
router.post(
  '/rotate-keys',
  requireAuth,
  requireRole('admin'),
  strictRateLimit,
  async (req, res) => {
    try {
      const { keyId, publicKeyPem } = await cryptoService.rotateKey();

      // Persist new public key
      await db.rotateSigningKey(keyId, publicKeyPem, req.user.email);

      // Audit the rotation
      await auditService.createAuditEvent({
        action: 'key_rotation',
        agent_id: 'SYSTEM',
        session_id: req.sessionID || 'admin_action',
        triggered_by: req.user.email,
        user_role: req.user.role,
        pre_state: { previous_key_id: req.body.previous_key_id || 'unknown' },
        post_state: { new_key_id: keyId },
        reason: 'manual_key_rotation',
        execution_status: 'success',
      });

      res.json({
        message: 'Key rotation successful',
        new_key_id: keyId,
        rotated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[CryptoAPI] Key rotation failed:', err.message);
      res.status(500).json({ error: 'Key rotation failed', detail: err.message });
    }
  }
);

/**
 * GET /api/v1/crypto/public-key
 * Returns the currently active public key in PEM format.
 * This endpoint is used by external compliance tools to independently verify
 * signature authenticity without accessing the private key.
 * Access: audit_viewer and above.
 */
router.get(
  '/public-key',
  requireAuth,
  requireRole('audit_viewer'),
  async (req, res) => {
    const keyId     = cryptoService.getActiveKeyId();
    const publicKey = cryptoService.getActivePublicKey();

    if (!keyId || !publicKey) {
      return res.status(503).json({ error: 'Signing service not initialised' });
    }

    res.json({
      key_id:     keyId,
      public_key: publicKey,
      algorithm:  'RSA-2048',
      format:     'PEM/SPKI',
    });
  }
);

/**
 * POST /api/v1/crypto/verify
 * Accepts a raw canonical JSON payload and signature for off-system verification.
 * Enables compliance teams to verify event authenticity without database access.
 * Access: audit_viewer and above.
 *
 * Body: { canonical_json: string, signature: string, key_id?: string }
 */
router.post(
  '/verify',
  requireAuth,
  requireRole('audit_viewer'),
  [
    body('canonical_json').isString().notEmpty().withMessage('canonical_json is required'),
    body('signature').isString().notEmpty().withMessage('signature is required'),
    body('key_id').optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { canonical_json, signature, key_id } = req.body;

    let publicKeyPem;
    if (key_id) {
      const keyRecord = await db.getSigningKeyById(key_id);
      if (!keyRecord) return res.status(404).json({ error: `Key "${key_id}" not found` });
      publicKeyPem = keyRecord.public_key_pem;
    } else {
      publicKeyPem = cryptoService.getActivePublicKey();
      if (!publicKeyPem) return res.status(503).json({ error: 'No active signing key available' });
    }

    const valid = cryptoService.verifySignature(canonical_json, signature, publicKeyPem);
    res.json({
      valid,
      reason: valid ? 'Signature cryptographically valid' : 'Signature invalid or payload modified',
      key_id: key_id || cryptoService.getActiveKeyId(),
      verified_at: new Date().toISOString(),
    });
  }
);

module.exports = router;
