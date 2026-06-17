/**
 * webhookVerifier.ts
 *
 * SolarPro Intake & Acquisition Infrastructure — HMAC Signature Verification
 *
 * Provides HMAC-SHA256 signature verification for all inbound webhooks:
 *   - Meta (Facebook) Lead Ads: X-Hub-Signature-256 header
 *   - TikTok Lead Gen:          X-TikTok-Signature header
 *   - Google Lead Form:         X-Google-Key literal comparison
 *   - Generic partners:         X-Webhook-Signature header
 *
 * Also provides idempotency key generation from payload hashes.
 */

import { createHmac, timingSafeEqual, createHash } from 'crypto'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface VerificationResult {
  verified: boolean
  method: string
  reason?: string
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) {
      // Length-safe compare: compare against a known-length buffer to avoid timing leak
      timingSafeEqual(bufA, bufA)
      return false
    }
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

// ────────────────────────────────────────────────────────────────────────────
// Meta (Facebook) Lead Ads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies X-Hub-Signature-256: sha256=<hmac>
 * Meta signs with APP_SECRET (not page access token).
 */
export function verifyMetaWebhook(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string
): VerificationResult {
  if (!signatureHeader) {
    return { verified: false, method: 'meta_hmac', reason: 'Missing X-Hub-Signature-256 header' }
  }

  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) {
    return { verified: false, method: 'meta_hmac', reason: 'Signature header must start with sha256=' }
  }

  const receivedSig = signatureHeader.slice(prefix.length)
  const expectedSig = hmacSha256Hex(appSecret, rawBody)

  if (!safeCompare(receivedSig, expectedSig)) {
    return { verified: false, method: 'meta_hmac', reason: 'Signature mismatch' }
  }

  return { verified: true, method: 'meta_hmac' }
}

// ────────────────────────────────────────────────────────────────────────────
// TikTok Lead Gen
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies X-TikTok-Signature: sha256=<hmac>
 * TikTok signs the raw body with the app secret.
 */
export function verifyTikTokWebhook(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string
): VerificationResult {
  if (!signatureHeader) {
    return { verified: false, method: 'tiktok_hmac', reason: 'Missing X-TikTok-Signature header' }
  }

  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) {
    return { verified: false, method: 'tiktok_hmac', reason: 'Signature header must start with sha256=' }
  }

  const receivedSig = signatureHeader.slice(prefix.length)
  const expectedSig = hmacSha256Hex(appSecret, rawBody)

  if (!safeCompare(receivedSig, expectedSig)) {
    return { verified: false, method: 'tiktok_hmac', reason: 'Signature mismatch' }
  }

  return { verified: true, method: 'tiktok_hmac' }
}

// ────────────────────────────────────────────────────────────────────────────
// Google Lead Form
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies X-Google-Key: <literal_key>
 * Google sends the configured webhook key as a literal header value.
 */
export function verifyGoogleWebhook(
  googleKeyHeader: string | null | undefined,
  configuredKey: string
): VerificationResult {
  if (!googleKeyHeader) {
    return { verified: false, method: 'google_key', reason: 'Missing X-Google-Key header' }
  }

  if (!safeCompare(googleKeyHeader, configuredKey)) {
    return { verified: false, method: 'google_key', reason: 'Key mismatch' }
  }

  return { verified: true, method: 'google_key' }
}

// ────────────────────────────────────────────────────────────────────────────
// Generic partner webhooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies X-Webhook-Signature: sha256=<hmac>
 * Uses partner-specific secret from env, falls back to WEBHOOK_SECRET_GENERIC.
 */
export function verifyGenericWebhook(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): VerificationResult {
  if (!signatureHeader) {
    return { verified: false, method: 'generic_hmac', reason: 'Missing X-Webhook-Signature header' }
  }

  const prefix = 'sha256='
  const sig = signatureHeader.startsWith(prefix)
    ? signatureHeader.slice(prefix.length)
    : signatureHeader  // some partners omit the prefix

  const expectedSig = hmacSha256Hex(secret, rawBody)

  if (!safeCompare(sig, expectedSig)) {
    return { verified: false, method: 'generic_hmac', reason: 'Signature mismatch' }
  }

  return { verified: true, method: 'generic_hmac' }
}

// ────────────────────────────────────────────────────────────────────────────
// Idempotency key generation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates a deterministic idempotency key from request metadata.
 * Useful when the platform provides a request ID.
 */
export function generateIdempotencyKey(parts: (string | null | undefined)[]): string {
  const combined = parts.filter(Boolean).join(':')
  return createHash('sha256').update(combined).digest('hex').slice(0, 64)
}

/**
 * Recursively serialize a value with object keys sorted at every level, so the
 * output is deterministic regardless of property insertion order. Unlike passing
 * an array as JSON.stringify's 2nd arg (a REPLACER ALLOWLIST applied recursively,
 * which collapsed nested objects to `{}`), this preserves all content.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/**
 * Generates a deterministic idempotency key from payload content.
 * Falls back when no platform-provided ID is available.
 */
export function generatePayloadIdempotencyKey(payload: unknown): string {
  const json = stableStringify(payload)
  return createHash('sha256').update(json).digest('hex').slice(0, 64)
}
