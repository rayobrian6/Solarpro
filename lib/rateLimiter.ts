// lib/rateLimiter.ts
// v48.6: Rate limiting for critical AI/API cost routes.
// Falls back to ALLOW on any Redis error — never blocks normal usage due to infra issues.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ── Redis client ──────────────────────────────────────────────────────────────
// Lazily constructed so missing env vars don't crash the module at import time.
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── Limiter factory ───────────────────────────────────────────────────────────
function makeLimiter(requests: number, window: `${number} s` | `${number} m`): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, window),
      analytics: false,
      prefix: 'solarpro_rl',
    });
  } catch {
    return null;
  }
}

// ── Route-specific limiters ───────────────────────────────────────────────────
// bill-upload: 5 req / 30s — expensive Claude + OCR calls
const _billUploadLimiter   = makeLimiter(5,  '30 s');
// login: 5 req / 60s — brute-force protection
const _loginLimiter        = makeLimiter(5,  '60 s');
// engineering: 10 req / 30s — heavy compute + external API calls
const _engineeringLimiter  = makeLimiter(10, '30 s');
// register: 3 req / 60s — prevent mass account creation
const _registerLimiter     = makeLimiter(3,  '60 s');
// password-reset: 3 req / 60s — prevent reset abuse
const _passwordResetLimiter = makeLimiter(3, '60 s');
// ocr: 10 req / 60s — Tesseract is CPU-intensive; prevent compute abuse
const _ocrLimiter           = makeLimiter(10, '60 s');
const _autoDesignLimiter    = makeLimiter(10, '60 s');  // AI layout generation
const _pipelineLimiter      = makeLimiter(5,  '60 s');  // full engineering pipeline
const _solarApiLimiter      = makeLimiter(20, '60 s');  // Google Solar API proxy
const _geoLimiter           = makeLimiter(30, '60 s');  // geocode/elevation/dsm
const _systemSizeLimiter    = makeLimiter(20, '60 s');  // system sizing calculations

// ── Public check function ─────────────────────────────────────────────────────
// Returns true  → request allowed
// Returns false → request should be rejected with 429
// SAFETY: always returns true if Redis is unavailable or throws

type LimiterKey = 'bill-upload' | 'login' | 'register' | 'password-reset' | 'engineering' | 'enterprise-contact' | 'ocr' | 'auto-design' | 'pipeline' | 'solar-api' | 'geo' | 'system-size';

const LIMITERS: Record<LimiterKey, Ratelimit | null> = {
  'bill-upload':         _billUploadLimiter,
  'login':               _loginLimiter,
  'register':            _registerLimiter,
  'password-reset':      _passwordResetLimiter,
  'engineering':         _engineeringLimiter,
  'enterprise-contact':  _registerLimiter,   // 5 req/60s — reuse register limiter config
  'ocr':                 _ocrLimiter,        // 10 req/60s — CPU-intensive Tesseract
  'auto-design':         _autoDesignLimiter, // 10 req/60s — AI layout generation
  'pipeline':            _pipelineLimiter,   // 5 req/60s  — full engineering pipeline
  'solar-api':           _solarApiLimiter,   // 20 req/60s — Google Solar API proxy
  'geo':                 _geoLimiter,        // 30 req/60s — geocode/elevation/dsm
  'system-size':         _systemSizeLimiter, // 20 req/60s — system sizing
};

export async function checkRateLimit(
  key: LimiterKey,
  identifier: string,
): Promise<{ allowed: boolean; remaining?: number; reset?: number }> {
  const limiter = LIMITERS[key];

  // No Redis configured — fail open (allow all)
  if (!limiter) return { allowed: true };

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed:   result.success,
      remaining: result.remaining,
      reset:     result.reset,
    };
  } catch {
    // Redis error — fail open, never block real users due to infra issues
    return { allowed: true };
  }
}

// ── IP extraction helper ──────────────────────────────────────────────────────
// Resolves best-effort client IP from Next.js request headers.
// Falls back to 'anonymous' — still rate-limited as a group (safe for most cases).
export function getClientIp(req: Request | import('next/server').NextRequest): string {
  const forwarded = (req.headers as Headers).get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for may be comma-separated list; first entry is the client
    return forwarded.split(',')[0].trim();
  }
  const realIp = (req.headers as Headers).get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'anonymous';
}