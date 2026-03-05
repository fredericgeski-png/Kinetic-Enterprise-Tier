/**
 * @fileoverview Kinetic v1.1 - Cryptographic Signing Service Tests
 * @module crypto/tests
 *
 * Covers: key generation, payload signing, signature verification,
 * tamper detection, key rotation, and registry behaviour.
 *
 * Run: jest src/crypto/tests.js --coverage
 */

'use strict';

const cryptoNative = require('crypto');

// Re-require after each test so module state is reset via jest.resetModules()
let cryptoService;

beforeEach(() => {
  jest.resetModules();
  cryptoService = require('./service');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: Initialisation
// ─────────────────────────────────────────────────────────────────────────────

describe('initialise()', () => {
  test('generates a key pair in development environment', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    delete process.env.KINETIC_SIGNING_PRIVATE_KEY;
    delete process.env.KINETIC_SIGNING_SECRET_ARN;

    const result = await cryptoService.initialise();

    expect(result).toHaveProperty('keyId');
    expect(result).toHaveProperty('publicKeyPem');
    expect(result.keyId).toMatch(/^key_/);
    expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');

    process.env.NODE_ENV = original;
  });

  test('loads key from KINETIC_SIGNING_PRIVATE_KEY environment variable', async () => {
    const { privateKey, publicKey } = cryptoNative.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.KINETIC_SIGNING_PRIVATE_KEY = privateKey;
    const result = await cryptoService.initialise();
    expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    delete process.env.KINETIC_SIGNING_PRIVATE_KEY;
  });

  test('throws in production without KINETIC_SIGNING_SECRET_ARN', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.KINETIC_SIGNING_SECRET_ARN;
    delete process.env.KINETIC_SIGNING_PRIVATE_KEY;
    await expect(cryptoService.initialise()).rejects.toThrow('KINETIC_SIGNING_SECRET_ARN');
    process.env.NODE_ENV = original;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: Sign → Verify Round Trip
// ─────────────────────────────────────────────────────────────────────────────

describe('signPayload() + verifySignature()', () => {
  let publicKeyPem;

  beforeEach(async () => {
    const result = await cryptoService._generateAndActivateKeyPair();
    publicKeyPem = result.publicKeyPem;
  });

  test('sign → verify round-trip returns true for unmodified payload', async () => {
    const payload = '{"action":"kill_agent","agent_id":"SIM_01","timestamp":"2026-03-05T14:00:00.000Z"}';
    const { signature } = await cryptoService.signPayload(payload);
    const valid = cryptoService.verifySignature(payload, signature, publicKeyPem);
    expect(valid).toBe(true);
  });

  test('verification returns false when payload is modified after signing', async () => {
    const payload   = '{"action":"kill_agent","entropy":0.95}';
    const tampered  = '{"action":"kill_agent","entropy":0.01}';
    const { signature } = await cryptoService.signPayload(payload);
    expect(cryptoService.verifySignature(tampered, signature, publicKeyPem)).toBe(false);
  });

  test('verification returns false with a different key', async () => {
    const payload = '{"action":"safe_mode"}';
    const { signature } = await cryptoService.signPayload(payload);
    const { publicKey: otherPublicKey } = cryptoNative.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(cryptoService.verifySignature(payload, signature, otherPublicKey)).toBe(false);
  });

  test('verification returns false for a corrupted base64 signature', async () => {
    const payload = '{"action":"approve_kill"}';
    await cryptoService.signPayload(payload);
    const corrupted = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    expect(cryptoService.verifySignature(payload, corrupted, publicKeyPem)).toBe(false);
  });

  test('verification returns false for empty signature', async () => {
    expect(cryptoService.verifySignature('{}', '', publicKeyPem)).toBe(false);
  });

  test('throws when signPayload is called before initialisation', async () => {
    jest.resetModules();
    const uninitialised = require('./service');
    await expect(uninitialised.signPayload('test')).rejects.toThrow('not initialised');
  });

  test('produces different signatures for different payloads', async () => {
    const sig1 = (await cryptoService.signPayload('{"a":1}')).signature;
    const sig2 = (await cryptoService.signPayload('{"a":2}')).signature;
    expect(sig1).not.toBe(sig2);
  });

  test('signature is deterministic for the same payload and key', async () => {
    // RSA-PKCS1 is deterministic (unlike OAEP); same input = same signature
    const payload = '{"event":"test","ts":"fixed"}';
    const sig1 = (await cryptoService.signPayload(payload)).signature;
    const sig2 = (await cryptoService.signPayload(payload)).signature;
    expect(sig1).toBe(sig2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: Key Rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateKey()', () => {
  test('assigns a new active key ID after rotation', async () => {
    await cryptoService._generateAndActivateKeyPair();
    const keyId1 = cryptoService.getActiveKeyId();
    await cryptoService.rotateKey();
    const keyId2 = cryptoService.getActiveKeyId();
    expect(keyId2).not.toBe(keyId1);
  });

  test('historical events signed with old key remain verifiable after rotation', async () => {
    const first = await cryptoService._generateAndActivateKeyPair();
    const payload = '{"action":"kill_agent","ts":"before_rotation"}';
    const { signature } = await cryptoService.signPayload(payload);

    // Rotate to new key
    await cryptoService.rotateKey();
    const newKeyId = cryptoService.getActiveKeyId();
    expect(newKeyId).not.toBe(first.keyId);

    // Old signature should still verify against the original public key
    expect(cryptoService.verifySignature(payload, signature, first.publicKeyPem)).toBe(true);
  });

  test('new key ID is returned with its public key PEM', async () => {
    const result = await cryptoService.rotateKey();
    expect(result.keyId).toBeTruthy();
    expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: Key Registry
// ─────────────────────────────────────────────────────────────────────────────

describe('registerPublicKey()', () => {
  test('registered keys are accessible for verification', async () => {
    const { publicKey, privateKey } = cryptoNative.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    cryptoService.registerPublicKey('external_key_01', publicKey);

    const sign = cryptoNative.createSign('RSA-SHA256');
    sign.update('test payload');
    const sig = sign.sign(privateKey, 'base64');

    expect(cryptoService.verifySignature('test payload', sig, publicKey)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: verifyEvent() End-to-End
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyEvent()', () => {
  test('returns valid=true for an unmodified signed event', async () => {
    const { keyId, publicKeyPem } = await cryptoService._generateAndActivateKeyPair();

    const eventFields = {
      action: 'kill_agent', agent_id: 'SIM_01', approval_event_id: null,
      event_id: 'evt_aabbccdd11223344aabbccdd11223344',
      execution_status: 'success',
      post_state: { entropy: null, status: 'terminated' },
      pre_state:  { entropy: 0.95, status: 'active' },
      reason: 'entropy_exceeded_threshold',
      session_id: 'sess_test', timestamp: '2026-03-05T14:00:00.000Z',
      triggered_by: 'test@kinetic.io', user_role: 'admin',
    };

    const sortKeys = (o) => typeof o === 'object' && o !== null && !Array.isArray(o)
      ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortKeys(o[k]); return a; }, {})
      : o;
    const canonical = JSON.stringify(sortKeys(eventFields));
    const payloadHash = '0x' + cryptoNative.createHash('sha256').update(canonical).digest('hex');
    const { signature } = await cryptoService.signPayload(canonical);

    const event = { ...eventFields, payload_hash: payloadHash, signature, signing_key_id: keyId };
    const getKeyFn = async () => ({ public_key_pem: publicKeyPem });
    const result = await cryptoService.verifyEvent(event, getKeyFn);

    expect(result.valid).toBe(true);
    expect(result.checksum_valid).toBe(true);
  });

  test('returns valid=false when payload_hash is tampered', async () => {
    await cryptoService._generateAndActivateKeyPair();
    const event = {
      action: 'kill_agent', agent_id: 'X', approval_event_id: null,
      event_id: 'evt_aabbccdd11223344aabbccdd11223344',
      execution_status: 'success',
      post_state: {}, pre_state: {}, reason: 'test',
      session_id: 's', timestamp: '2026-01-01T00:00:00.000Z',
      triggered_by: 'x@y.com', user_role: 'admin',
      payload_hash: '0xdeadbeef_tampered',
      signature: 'fakesig', signing_key_id: 'k',
    };
    const result = await cryptoService.verifyEvent(event, async () => null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('hash mismatch');
  });
});
