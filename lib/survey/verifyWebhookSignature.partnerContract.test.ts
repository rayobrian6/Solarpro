// ============================================================================
// v47.434a — Partner wire-contract compatibility tests.
//
// Reproduces the EXACT wire format emitted by the partner's webhook sender at
// github.com/kilby8/site_survey-app commit 2cc3537f :
//   - X-Survey-Timestamp: ISO-8601 from `new Date().toISOString()`
//   - X-Survey-Signature: `sha256=<hex digest>`
//   - Signed string:      `${timestamp}.${payloadText}`
//
// Each test invokes the real sender's signing primitive (inlined below,
// character-identical to webhookService.ts:159-163) and feeds the output into
// our verifier. A passing test here is a live-wire compatibility guarantee.
//
// These tests are ADDITIVE to verifyWebhookSignature.test.ts, which continues
// to lock the legacy Unix-epoch + raw-hex contract for internal/future signers.
// ============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyWebhookSignature,
  parseTimestampHeaderToSeconds,
  normaliseSignatureHeader,
  TIMESTAMP_TOLERANCE_SECONDS,
} from './verifyWebhookSignature';

// ---------------------------------------------------------------------------
// Partner signing primitive (copied verbatim from their webhookService.ts).
// DO NOT refactor — this is the contract-under-test.
// ---------------------------------------------------------------------------
function partnerBuildSignature(payloadText: string, timestamp: string, secret: string): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadText}`)
    .digest('hex');
  return `sha256=${digest}`;
}

const SECRET = 'partner-contract-test-secret';

// A realistic partner payload (fatter than the thin-event spec).
const PARTNER_PAYLOAD = JSON.stringify({
  event: 'survey.completed',
  event_id: '7c6f2e2e-9b4a-4d1f-8a1c-0123456789ab',
  occurred_at: '2026-04-23T18:25:43.000Z',
  survey_id: 'a1b2c3d4-5e6f-7890-abcd-ef0123456789',
  status: 'submitted',
  project_id: '11111111-2222-3333-4444-555555555555',
  project_name: 'Smith Residence',
  inspector_name: 'Jane Doe',
  site_name: '123 Solar Way, Austin TX',
  completed_at: '2026-04-23T18:25:43.000Z',
});

// A fixed "now" so timestamp math is deterministic.
// Corresponds to 2026-04-23T18:25:43.000Z.
const NOW_SECONDS = Math.floor(Date.parse('2026-04-23T18:25:43.000Z') / 1000);

describe('verifyWebhookSignature — partner wire-contract (v47.434a)', () => {
  // ─── Happy paths ──────────────────────────────────────────────────────

  it('accepts partner-signed webhook (ISO timestamp + sha256= prefix)', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, SECRET);

    // Sanity check the sender shape.
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signature.length).toBe('sha256='.length + 64);

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.timestampSkewSeconds).toBe(0);
  });

  it('accepts partner webhook within the 5-minute tolerance window (past)', () => {
    const timestamp = '2026-04-23T18:21:43.000Z'; // 4 min before NOW
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, SECRET);

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
    expect(result.timestampSkewSeconds).toBe(4 * 60);
  });

  it('accepts partner webhook within the 5-minute tolerance window (future)', () => {
    const timestamp = '2026-04-23T18:29:43.000Z'; // 4 min after NOW
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, SECRET);

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
    expect(result.timestampSkewSeconds).toBe(-4 * 60);
  });

  // ─── Rejection paths (real-world attack / misconfig scenarios) ────────

  it('rejects partner webhook with stale ISO timestamp (replay defence)', () => {
    const timestamp = '2026-04-23T18:20:00.000Z'; // ~5m43s before NOW, outside tolerance
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, SECRET);

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    expect(result.timestampSkewSeconds).toBeGreaterThan(TIMESTAMP_TOLERANCE_SECONDS);
  });

  it('rejects partner webhook when body is tampered with after signing', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, SECRET);

    // Attacker appends whitespace — HMAC must reject (byte-exactness).
    const tamperedBody = PARTNER_PAYLOAD + ' ';

    const result = verifyWebhookSignature({
      rawBody: tamperedBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects partner webhook when signed with a different secret', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, timestamp, 'wrong-secret');

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects partner-format signature replayed against a different timestamp', () => {
    // Sign with timestamp A.
    const signingTs = '2026-04-23T18:25:43.000Z';
    const signature = partnerBuildSignature(PARTNER_PAYLOAD, signingTs, SECRET);

    // Attacker presents the same signature with a different (but in-tolerance) timestamp.
    const replayedTs = '2026-04-23T18:26:43.000Z';

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: signature,
      timestampHeader: replayedTs,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  // ─── Cross-format interop — legacy internal signers still work ────────

  it('still accepts legacy raw-hex signature with Unix epoch timestamp (internal signer)', () => {
    const epochTs = String(NOW_SECONDS);
    const signedString = `${epochTs}.${PARTNER_PAYLOAD}`;
    const rawHex = crypto
      .createHmac('sha256', SECRET)
      .update(signedString, 'utf8')
      .digest('hex');

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: rawHex, // NO prefix
      timestampHeader: epochTs, // Unix epoch seconds
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
    expect(result.timestampSkewSeconds).toBe(0);
  });

  it('accepts raw-hex signature with ISO timestamp (hybrid signer)', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';
    const signedString = `${timestamp}.${PARTNER_PAYLOAD}`;
    const rawHex = crypto
      .createHmac('sha256', SECRET)
      .update(signedString, 'utf8')
      .digest('hex');

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: rawHex, // raw hex, no prefix
      timestampHeader: timestamp, // ISO
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
  });

  it('accepts sha256=-prefixed signature with Unix epoch timestamp (hybrid signer)', () => {
    const epochTs = String(NOW_SECONDS);
    const signedString = `${epochTs}.${PARTNER_PAYLOAD}`;
    const prefixed =
      'sha256=' +
      crypto.createHmac('sha256', SECRET).update(signedString, 'utf8').digest('hex');

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: prefixed,
      timestampHeader: epochTs,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
  });

  it('accepts case-insensitive SHA256= prefix (defensive against sender casing drift)', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';
    const signedString = `${timestamp}.${PARTNER_PAYLOAD}`;
    const hex = crypto
      .createHmac('sha256', SECRET)
      .update(signedString, 'utf8')
      .digest('hex');

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: `SHA256=${hex}`, // upper-case prefix
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(true);
  });

  // ─── Malformed-input hardening ────────────────────────────────────────

  it('rejects prefix-only signature header (sha256= with no hex)', () => {
    const timestamp = '2026-04-23T18:25:43.000Z';

    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: 'sha256=',
      timestampHeader: timestamp,
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MISSING_SIGNATURE_HEADER');
  });

  it('rejects ISO timestamp that Date.parse() cannot understand', () => {
    const result = verifyWebhookSignature({
      rawBody: PARTNER_PAYLOAD,
      signatureHeader: 'sha256=' + 'a'.repeat(64),
      timestampHeader: 'not-a-timestamp',
      secret: SECRET,
      nowSeconds: NOW_SECONDS,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MALFORMED_TIMESTAMP');
  });
});

describe('parseTimestampHeaderToSeconds — format coverage', () => {
  it('parses Unix epoch seconds integer string', () => {
    expect(parseTimestampHeaderToSeconds('1745432743')).toBe(1745432743);
  });

  it('parses negative epoch (pre-1970) integers', () => {
    expect(parseTimestampHeaderToSeconds('-1')).toBe(-1);
  });

  it('parses ISO-8601 with milliseconds and Z suffix', () => {
    const iso = '2026-04-23T18:25:43.000Z';
    expect(parseTimestampHeaderToSeconds(iso)).toBe(
      Math.floor(Date.parse(iso) / 1000),
    );
  });

  it('parses ISO-8601 without milliseconds', () => {
    const iso = '2026-04-23T18:25:43Z';
    expect(parseTimestampHeaderToSeconds(iso)).toBe(
      Math.floor(Date.parse(iso) / 1000),
    );
  });

  it('parses ISO-8601 with explicit UTC offset', () => {
    const iso = '2026-04-23T14:25:43-04:00';
    expect(parseTimestampHeaderToSeconds(iso)).toBe(
      Math.floor(Date.parse(iso) / 1000),
    );
  });

  it('returns null for float-looking numeric strings (prevents ambiguous parse)', () => {
    expect(parseTimestampHeaderToSeconds('1.5e3')).toBeNull();
    expect(parseTimestampHeaderToSeconds('1745432743.5')).toBeNull();
  });

  it('returns null for empty / whitespace / null inputs', () => {
    expect(parseTimestampHeaderToSeconds(null)).toBeNull();
    expect(parseTimestampHeaderToSeconds(undefined)).toBeNull();
    expect(parseTimestampHeaderToSeconds('')).toBeNull();
    expect(parseTimestampHeaderToSeconds('   ')).toBeNull();
  });

  it('returns null for arbitrary alphabetic garbage', () => {
    expect(parseTimestampHeaderToSeconds('not-a-timestamp')).toBeNull();
    expect(parseTimestampHeaderToSeconds('abc123')).toBeNull();
  });

  it('tolerates surrounding whitespace in ISO values', () => {
    const iso = '  2026-04-23T18:25:43.000Z  ';
    expect(parseTimestampHeaderToSeconds(iso)).toBe(
      Math.floor(Date.parse('2026-04-23T18:25:43.000Z') / 1000),
    );
  });
});

describe('normaliseSignatureHeader — prefix handling', () => {
  it('strips lowercase sha256= prefix', () => {
    expect(normaliseSignatureHeader('sha256=abc123')).toBe('abc123');
  });

  it('strips uppercase SHA256= prefix', () => {
    expect(normaliseSignatureHeader('SHA256=abc123')).toBe('abc123');
  });

  it('strips mixed-case Sha256= prefix', () => {
    expect(normaliseSignatureHeader('Sha256=abc123')).toBe('abc123');
  });

  it('passes through raw hex unchanged when no prefix is present', () => {
    expect(normaliseSignatureHeader('abc123')).toBe('abc123');
  });

  it('trims surrounding whitespace before checking for prefix', () => {
    expect(normaliseSignatureHeader('  sha256=abc123  ')).toBe('abc123');
  });

  it('returns null for null/undefined/empty inputs', () => {
    expect(normaliseSignatureHeader(null)).toBeNull();
    expect(normaliseSignatureHeader(undefined)).toBeNull();
    expect(normaliseSignatureHeader('')).toBeNull();
    expect(normaliseSignatureHeader('   ')).toBeNull();
  });
});