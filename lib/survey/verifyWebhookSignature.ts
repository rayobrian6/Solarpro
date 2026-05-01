// ============================================================================
// v47.434 Stage 9.1 — Survey Webhook HMAC Signature Verifier
// v47.434a — wire-format compatibility patch (backwards-compatible):
//   (a) Accept BOTH Unix epoch seconds AND ISO-8601 in X-Survey-Timestamp.
//   (b) Accept BOTH `sha256=<hex>` prefixed AND raw `<hex>` in X-Survey-Signature.
//   (c) schemaVersion-absent handling is in the envelope validator, not here.
//
// Verifies X-Survey-Signature against HMAC-SHA256(timestamp + '.' + rawBody,
// key = SURVEY_WEBHOOK_SECRET), per partner doc.
//
// IMPORTANT: the HMAC is computed over the timestamp AS RECEIVED in the header
// (original string form), not over the normalised epoch seconds. This is
// mandatory for byte-equality with the sender — the sender signs with whatever
// timestamp string it emits.
//
// DESIGN RULES:
//   1. Constant-time comparison (crypto.timingSafeEqual) — defends against
//      timing-leak attacks on the signature compare.
//   2. Timestamp tolerance: 5 minutes. Rejects stale replays captured by a
//      network observer; also rejects clock-skewed senders that would otherwise
//      succeed but indicate misconfiguration.
//   3. NEVER logs the raw secret. error messages reveal only failure category.
//   4. Pure function — no DB writes, no network calls. Caller decides what to
//      persist to webhook_deliveries based on the result.
// ============================================================================

import crypto from 'crypto';
import type { WebhookSignatureVerification } from './types';

/** Maximum acceptable clock skew between survey backend and SolarPro. */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60; // 5 minutes

/** Prefix used by the partner's webhook sender on X-Survey-Signature. */
const SIGNATURE_PREFIX = 'sha256=';

export interface VerifyWebhookSignatureInput {
  /** Raw request body as a UTF-8 string (MUST be the exact bytes the sender signed, not the JSON-parsed object). */
  rawBody: string;
  /** Value of X-Survey-Signature header (hex-encoded HMAC-SHA256, optionally `sha256=`-prefixed). */
  signatureHeader: string | null | undefined;
  /** Value of X-Survey-Timestamp header. Accepts Unix epoch seconds as string OR ISO-8601. */
  timestampHeader: string | null | undefined;
  /** Shared secret (process.env.SURVEY_WEBHOOK_SECRET). */
  secret: string;
  /**
   * Override "now" for deterministic tests. Defaults to Date.now() / 1000.
   * Unit = Unix epoch seconds.
   */
  nowSeconds?: number;
  /** Override the tolerance window (seconds). Defaults to TIMESTAMP_TOLERANCE_SECONDS. */
  toleranceSeconds?: number;
}

/**
 * Parse the X-Survey-Timestamp header into Unix epoch seconds.
 * Accepts:
 *   (1) Integer seconds as string, e.g. "1745432743"
 *   (2) ISO-8601 as produced by `new Date().toISOString()`, e.g. "2026-04-23T18:25:43.000Z"
 * Returns null if neither format parses.
 *
 * NOTE: this is ONLY used for tolerance math. The HMAC payload still uses the
 * raw header string verbatim, because the sender signs the string they sent.
 */
export function parseTimestampHeaderToSeconds(
  raw: string | null | undefined,
): number | null {
  if (!raw || raw.length === 0) return null;
  const trimmed = raw.trim();

  // Path 1: integer-looking → Unix epoch seconds.
  // We require it to look like an integer (optional minus, digits only) so we
  // don't accidentally Number("2026") an ISO year prefix.
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n) && Number.isInteger(n)) {
      return n;
    }
    return null;
  }

  // Path 2: ISO-8601 (or any Date-parseable string). Must contain a letter
  // (T / Z / +/- timezone / GMT / am/pm etc.) — guards against weird
  // non-integer numerics like "1.5e3" slipping through.
  if (/[A-Za-z]/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) {
      return Math.floor(ms / 1000);
    }
  }

  return null;
}

/**
 * Normalise the signature header: strip optional `sha256=` prefix (case-insensitive).
 * Returns the raw hex portion. If the input has no prefix, returns it unchanged.
 */
export function normaliseSignatureHeader(
  raw: string | null | undefined,
): string | null {
  if (!raw || raw.length === 0) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)) {
    return trimmed.slice(SIGNATURE_PREFIX.length);
  }
  return trimmed;
}

/**
 * Verify an inbound survey webhook signature.
 *
 * Returns { valid: true } on success, { valid: false, reason } on failure.
 * Callers should record the result (including failures) to webhook_deliveries
 * for audit visibility.
 */
export function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): WebhookSignatureVerification {
  const {
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = TIMESTAMP_TOLERANCE_SECONDS,
  } = input;

  // ── Presence checks ──────────────────────────────────────────────────
  if (!signatureHeader || signatureHeader.length === 0) {
    return { valid: false, reason: 'MISSING_SIGNATURE_HEADER' };
  }
  if (!timestampHeader || timestampHeader.length === 0) {
    return { valid: false, reason: 'MISSING_TIMESTAMP_HEADER' };
  }

  // ── Timestamp format + tolerance ─────────────────────────────────────
  // Accept both Unix epoch seconds (legacy / internal signers) and ISO-8601
  // (partner's wire format from `new Date().toISOString()`).
  const timestampSeconds = parseTimestampHeaderToSeconds(timestampHeader);
  if (timestampSeconds === null) {
    return { valid: false, reason: 'MALFORMED_TIMESTAMP' };
  }
  const skew = nowSeconds - timestampSeconds;
  if (Math.abs(skew) > toleranceSeconds) {
    return {
      valid: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
      timestampSkewSeconds: skew,
    };
  }

  // ── Normalise signature header (strip optional `sha256=` prefix) ─────
  const rawHexSignature = normaliseSignatureHeader(signatureHeader);
  if (rawHexSignature === null || rawHexSignature.length === 0) {
    // Header was whitespace-only or prefix-only with no hex; treat as missing.
    return { valid: false, reason: 'MISSING_SIGNATURE_HEADER' };
  }

  // ── Compute expected signature ───────────────────────────────────────
  // Signed string format per partner doc: `${timestamp}.${rawBody}`
  // The timestamp here is the RAW HEADER STRING (not the parsed seconds) —
  // the sender signs with whatever string they emit, and byte-equality is
  // mandatory for the HMAC to match.
  const signedString = `${timestampHeader}.${rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(signedString, 'utf8')
    .digest('hex');

  // ── Constant-time compare ────────────────────────────────────────────
  // timingSafeEqual requires equal-length buffers; if the normalised header
  // is a different length, short-circuit to mismatch (not a timing leak
  // because length-mismatch is disclosed by the header presence, not by the
  // secret).
  if (expectedHex.length !== rawHexSignature.length) {
    return {
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
      timestampSkewSeconds: skew,
    };
  }

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const actualBuf = Buffer.from(rawHexSignature, 'utf8');
  const match = crypto.timingSafeEqual(expectedBuf, actualBuf);
  if (!match) {
    return {
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
      timestampSkewSeconds: skew,
    };
  }

  return { valid: true, timestampSkewSeconds: skew };
}