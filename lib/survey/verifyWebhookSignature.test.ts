// ============================================================================
// v47.434 Stage 9.1 — verifyWebhookSignature unit tests
//
// Pure-function tests. No DB, no network. Covers:
//   - Valid signatures with various tolerance cases
//   - All failure reason codes
//   - Constant-time compare edge cases (length-mismatch short-circuit)
//   - Deterministic behaviour with injected nowSeconds
// ============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyWebhookSignature,
  TIMESTAMP_TOLERANCE_SECONDS,
} from './verifyWebhookSignature';

const SECRET = 'test-survey-webhook-secret-abc123';
const NOW = 1735689600; // 2025-01-01T00:00:00Z

function signForTest(rawBody: string, timestampSeconds: number, secret: string = SECRET): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
}

const RAW_BODY = JSON.stringify({
  event: 'survey.completed',
  schemaVersion: '1.0',
  event_id: 'evt_123',
  survey_id: 'srv_abc',
  completed_at: '2025-01-01T00:00:00Z',
});

describe('verifyWebhookSignature — valid path', () => {
  it('accepts a correctly signed request at exactly now', () => {
    const sig = signForTest(RAW_BODY, NOW);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.timestampSkewSeconds).toBe(0);
  });

  it('accepts a request within the tolerance window (back)', () => {
    const eventTs = NOW - (TIMESTAMP_TOLERANCE_SECONDS - 1);
    const sig = signForTest(RAW_BODY, eventTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(eventTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a request within the tolerance window (forward, clock-skewed sender)', () => {
    const eventTs = NOW + (TIMESTAMP_TOLERANCE_SECONDS - 1);
    const sig = signForTest(RAW_BODY, eventTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(eventTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(true);
  });
});

describe('verifyWebhookSignature — missing headers', () => {
  it('rejects null signature header', () => {
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: null,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MISSING_SIGNATURE_HEADER');
  });

  it('rejects empty-string signature header', () => {
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: '',
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MISSING_SIGNATURE_HEADER');
  });

  it('rejects missing timestamp header', () => {
    const sig = signForTest(RAW_BODY, NOW);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: null,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MISSING_TIMESTAMP_HEADER');
  });
});

describe('verifyWebhookSignature — timestamp problems', () => {
  it('rejects a malformed timestamp (non-numeric)', () => {
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: 'deadbeef'.repeat(8),
      timestampHeader: 'not-a-number',
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MALFORMED_TIMESTAMP');
  });

  it('rejects a malformed timestamp (floating point)', () => {
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: 'deadbeef'.repeat(8),
      timestampHeader: '1735689600.5',
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MALFORMED_TIMESTAMP');
  });

  it('rejects a stale timestamp (outside tolerance, past)', () => {
    const staleTs = NOW - (TIMESTAMP_TOLERANCE_SECONDS + 1);
    const sig = signForTest(RAW_BODY, staleTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(staleTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    expect(result.timestampSkewSeconds).toBe(TIMESTAMP_TOLERANCE_SECONDS + 1);
  });

  it('rejects a future timestamp (outside tolerance, forward)', () => {
    const futureTs = NOW + (TIMESTAMP_TOLERANCE_SECONDS + 1);
    const sig = signForTest(RAW_BODY, futureTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(futureTs),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });
});

describe('verifyWebhookSignature — signature mismatch', () => {
  it('rejects a signature generated with a different secret', () => {
    const badSig = signForTest(RAW_BODY, NOW, 'different-secret');
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: badSig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a signature computed over a different body', () => {
    const sig = signForTest('{"event":"survey.completed"}', NOW);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY, // different body than what was signed
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a signature with the wrong length (length-mismatch short-circuit)', () => {
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: 'abc123', // too short
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a signature computed with a different timestamp (replay defence)', () => {
    const sig = signForTest(RAW_BODY, NOW - 60);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(NOW), // attacker tries to present a fresh timestamp
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });
});

describe('verifyWebhookSignature — determinism + skew reporting', () => {
  it('reports exact skew on out-of-tolerance rejections', () => {
    const eventTs = NOW - 1000;
    const sig = signForTest(RAW_BODY, eventTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(eventTs),
      secret: SECRET,
      nowSeconds: NOW,
      toleranceSeconds: 60,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    expect(result.timestampSkewSeconds).toBe(1000);
  });

  it('accepts within a custom (larger) tolerance window', () => {
    const eventTs = NOW - 1000;
    const sig = signForTest(RAW_BODY, eventTs);
    const result = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(eventTs),
      secret: SECRET,
      nowSeconds: NOW,
      toleranceSeconds: 2000,
    });
    expect(result.valid).toBe(true);
    expect(result.timestampSkewSeconds).toBe(1000);
  });

  it('is deterministic across calls (same inputs → same output)', () => {
    const sig = signForTest(RAW_BODY, NOW);
    const a = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    const b = verifyWebhookSignature({
      rawBody: RAW_BODY,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(a).toEqual(b);
  });
});

describe('verifyWebhookSignature — byte-exactness', () => {
  it('signature is sensitive to whitespace in the body (bytes-exact contract)', () => {
    const tightBody = '{"a":1}';
    const loosBody = '{ "a" : 1 }';
    const sig = signForTest(tightBody, NOW);

    const good = verifyWebhookSignature({
      rawBody: tightBody,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    const bad = verifyWebhookSignature({
      rawBody: loosBody,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(good.valid).toBe(true);
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe('SIGNATURE_MISMATCH');
  });
});