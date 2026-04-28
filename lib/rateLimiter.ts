// lib/rateLimiter.ts
// Phase 27/27b: Full rate limiting coverage for all 149 mutation routes.
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
// Auth / identity — tight limits, brute-force sensitive
const _loginLimiter          = makeLimiter(5,  '60 s');  // brute-force protection
const _registerLimiter       = makeLimiter(3,  '60 s');  // prevent mass account creation
const _passwordResetLimiter  = makeLimiter(3,  '60 s');  // prevent reset abuse
const _deleteAccountLimiter  = makeLimiter(3,  '60 m');  // destructive — very tight
const _mobileSessionLimiter  = makeLimiter(10, '60 s');  // SSO token minting

// AI / compute — expensive operations
const _billUploadLimiter     = makeLimiter(5,  '30 s');  // Claude + OCR calls
const _engineeringLimiter    = makeLimiter(10, '30 s');  // heavy compute + external APIs
const _ocrLimiter            = makeLimiter(10, '60 s');  // CPU-intensive Tesseract
const _autoDesignLimiter     = makeLimiter(10, '60 s');  // AI layout generation
const _pipelineLimiter       = makeLimiter(5,  '60 s');  // full engineering pipeline
const _systemSizeLimiter     = makeLimiter(20, '60 s');  // system sizing calculations
const _systemCapabilitiesLimiter = makeLimiter(20, '60 s');

// External API proxies
const _solarApiLimiter       = makeLimiter(20, '60 s');  // Google Solar API proxy
const _geoLimiter            = makeLimiter(30, '60 s');  // geocode/elevation/dsm
const _utilityDetectLimiter  = makeLimiter(20, '60 s');  // utility detection
const _utilityRatesLimiter   = makeLimiter(20, '60 s');  // utility rates lookup
const _mapsSessionLimiter    = makeLimiter(20, '60 s');  // Maps API session tokens
const _productionLimiter     = makeLimiter(20, '60 s');  // production estimates
const _topographyLimiter     = makeLimiter(20, '60 s');  // topography data
const _tileLimiter           = makeLimiter(60, '60 s');  // map tiles — higher volume OK

// Standard CRUD — normal user mutation rate
const _standardLimiter       = makeLimiter(30, '60 s');  // projects, clients, etc.
const _adminLimiter          = makeLimiter(30, '60 s');  // admin panel actions
const _feedbackLimiter       = makeLimiter(10, '60 s');  // feedback submissions
const _enterpriseContactLimiter = makeLimiter(5, '60 m'); // enterprise contact — anti-spam
const _tosLimiter            = makeLimiter(10, '60 s');  // ToS acceptance
const _statsLimiter          = makeLimiter(30, '60 s');  // stats/reporting
const _activityLimiter       = makeLimiter(30, '60 s');  // activity log
const _commandsLimiter       = makeLimiter(30, '60 s');  // commands/tasks
const _hardwareLimiter       = makeLimiter(30, '60 s');  // hardware catalog
const _incentivesLimiter     = makeLimiter(30, '60 s');  // incentives
const _surveyLimiter         = makeLimiter(20, '60 s');  // survey upload/submit
const _settingsLimiter       = makeLimiter(20, '60 s');  // profile/branding/logo
const _stripeLimiter         = makeLimiter(5,  '60 m');  // Stripe checkout/portal — costly op
const _migrateLimiter        = makeLimiter(2,  '60 m');  // DB migrations — extremely tight

// ── LimiterKey union ─────────────────────────────────────────────────────────
export type LimiterKey =
  // Auth
  | 'login'
  | 'register'
  | 'password-reset'
  | 'delete-account'
  | 'mobile-session'
  // AI / compute
  | 'bill-upload'
  | 'engineering'
  | 'ocr'
  | 'auto-design'
  | 'pipeline'
  | 'system-size'
  | 'system-capabilities'
  // External APIs
  | 'solar-api'
  | 'geo'
  | 'utility-detect'
  | 'utility-rates'
  | 'maps-session'
  | 'production'
  | 'topography'
  | 'tile'
  // Standard CRUD
  | 'standard'
  | 'admin'
  | 'feedback'
  | 'enterprise-contact'
  | 'tos'
  | 'stats'
  | 'activity'
  | 'commands'
  | 'hardware'
  | 'incentives'
  | 'survey'
  | 'settings'
  | 'stripe'
  | 'migrate';

const LIMITERS: Record<LimiterKey, Ratelimit | null> = {
  // Auth
  'login':                  _loginLimiter,
  'register':               _registerLimiter,
  'password-reset':         _passwordResetLimiter,
  'delete-account':         _deleteAccountLimiter,
  'mobile-session':         _mobileSessionLimiter,
  // AI / compute
  'bill-upload':            _billUploadLimiter,
  'engineering':            _engineeringLimiter,
  'ocr':                    _ocrLimiter,
  'auto-design':            _autoDesignLimiter,
  'pipeline':               _pipelineLimiter,
  'system-size':            _systemSizeLimiter,
  'system-capabilities':    _systemCapabilitiesLimiter,
  // External APIs
  'solar-api':              _solarApiLimiter,
  'geo':                    _geoLimiter,
  'utility-detect':         _utilityDetectLimiter,
  'utility-rates':          _utilityRatesLimiter,
  'maps-session':           _mapsSessionLimiter,
  'production':             _productionLimiter,
  'topography':             _topographyLimiter,
  'tile':                   _tileLimiter,
  // Standard CRUD
  'standard':               _standardLimiter,
  'admin':                  _adminLimiter,
  'feedback':               _feedbackLimiter,
  'enterprise-contact':     _enterpriseContactLimiter,
  'tos':                    _tosLimiter,
  'stats':                  _statsLimiter,
  'activity':               _activityLimiter,
  'commands':               _commandsLimiter,
  'hardware':               _hardwareLimiter,
  'incentives':             _incentivesLimiter,
  'survey':                 _surveyLimiter,
  'settings':               _settingsLimiter,
  'stripe':                 _stripeLimiter,
  'migrate':                _migrateLimiter,
};

// ── Public check function ─────────────────────────────────────────────────────
// Returns true  → request allowed
// Returns false → request should be rejected with 429
// SAFETY: always returns true if Redis is unavailable or throws

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