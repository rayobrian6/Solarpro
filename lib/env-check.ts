/**
 * lib/env-check.ts — Startup Environment Validation
 *
 * Validates that all required environment variables are present before
 * the application can serve requests. Called at module load time from
 * critical API routes (bill-upload, system-size, auth routes).
 *
 * In production (Vercel), missing env vars indicate a misconfigured
 * deployment and should fail loudly rather than silently serving broken responses.
 *
 * Usage:
 *   import '@/lib/env-check';   // throws on missing vars (side-effect import)
 *   // OR
 *   import { assertEnv, validateEnv } from '@/lib/env-check';
 */

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
  details: Record<string, boolean>;
}

/**
 * Required env vars — app CANNOT function without these.
 * Missing any of these should block deployment / fail fast.
 *
 *   DATABASE_URL    — Neon PostgreSQL connection string
 *   JWT_SECRET      — JWT session signing secret (32+ chars)
 */
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
] as const;

/**
 * Recommended env vars — missing these degrades specific features.
 * App boots but affected features will silently fail or degrade.
 *
 *   OPENAI_API_KEY        — AI bill extraction (falls back to Tesseract OCR)
 *   GOOGLE_MAPS_API_KEY   — Geocoding + utility rate detection
 *   RESEND_API_KEY        — Transactional email (password reset, etc.)
 *                           Without this, emails fall back to console.log only
 *   NEXT_PUBLIC_BASE_URL  — Production base URL for email links + Stripe callbacks
 *                           Without this, reset links may point to a preview URL
 */
const RECOMMENDED_VARS = [
  'OPENAI_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'RESEND_API_KEY',
  'NEXT_PUBLIC_BASE_URL',
] as const;

/**
 * Validate all environment variables.
 * Returns a structured result — does NOT throw.
 * Use assertEnv() if you want to throw on failure.
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const details: Record<string, boolean> = {};

  for (const varName of REQUIRED_VARS) {
    const val = process.env[varName];
    const present = !!val && val !== 'YOUR_NEON_DATABASE_URL_HERE';
    details[varName] = present;
    if (!present) missing.push(varName);
  }

  for (const varName of RECOMMENDED_VARS) {
    const val = process.env[varName];
    const present = !!val
      && val !== 're_YOUR_RESEND_API_KEY_HERE'
      && val !== 'YOUR_GOOGLE_MAPS_KEY_HERE'
      && val !== 'sk-YOUR_OPENAI_KEY_HERE';
    details[varName] = present;
    if (!present) {
      warnings.push(`${varName} not set — ${getVarWarning(varName)}`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    details,
  };
}

/**
 * Assert all required env vars are present.
 * Throws a descriptive error if any are missing.
 * Call at the top of critical API route handlers.
 */
export function assertEnv(): void {
  const result = validateEnv();

  if (!result.valid) {
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║           ENV VALIDATION FAILED — DEPLOYMENT BROKEN          ║',
      '╚══════════════════════════════════════════════════════════════╝',
      `Missing: ${result.missing.join(', ')}`,
      '',
      'Set these in your Vercel project → Settings → Environment Variables:',
      ...result.missing.map(v => `  → ${v}: ${getVarDescription(v)}`),
      '',
    ];
    console.error(lines.join('\n'));
    throw new Error(`Deployment configuration error: missing ${result.missing.join(', ')}`);
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`[ENV_CHECK] Warning: ${w}`);
    }
  }
}

/**
 * Log env status at startup without throwing.
 * Called once per cold start for observability.
 * Emits a structured log line that is easy to grep in Vercel logs.
 */
export function logEnvStatus(routeLabel: string): void {
  const result = validateEnv();

  // Single searchable line with all key vars
  const keyVars = ['DATABASE_URL', 'JWT_SECRET', 'OPENAI_API_KEY', 'GOOGLE_MAPS_API_KEY', 'RESEND_API_KEY', 'NEXT_PUBLIC_BASE_URL'];
  const statusStr = keyVars.map(v => `${v}=${result.details[v] ? '✓' : '✗'}`).join(' ');
  console.log(`[ENV_STATUS] route=${routeLabel} ${statusStr} valid=${result.valid}`);

  if (!result.valid) {
    console.error(
      `[ENV_MISSING] CRITICAL: ${result.missing.join(', ')} not set` +
      ` — route=${routeLabel} will fail on DB/auth operations`
    );
  }
  if (result.warnings.length > 0) {
    console.warn(`[ENV_WARNINGS] route=${routeLabel} ${result.warnings.join(' | ')}`);
  }
}

/**
 * Get all currently missing vars (required + recommended) for diagnostics.
 * Used by /api/health to surface degraded state.
 */
export function getMissingVars(): { required: string[]; recommended: string[] } {
  const result = validateEnv();
  const recommendedMissing = RECOMMENDED_VARS.filter(v => !result.details[v]);
  return {
    required: result.missing,
    recommended: recommendedMissing,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getVarDescription(varName: string): string {
  const descriptions: Record<string, string> = {
    DATABASE_URL:           'Neon PostgreSQL connection string (postgresql://...)',
    JWT_SECRET:             'Secret key for JWT session signing (random 32+ char string)',
    OPENAI_API_KEY:         'OpenAI API key for AI bill extraction (sk-...)',
    GOOGLE_MAPS_API_KEY:    'Google Maps API key for geocoding + utility rate detection',
    RESEND_API_KEY:         'Resend API key for transactional email (re_...)',
    NEXT_PUBLIC_BASE_URL:   'Production base URL, e.g. https://solarpro-v31.vercel.app',
  };
  return descriptions[varName] ?? 'Required for app functionality';
}

function getVarWarning(varName: string): string {
  const warnings: Record<string, string> = {
    OPENAI_API_KEY:         'AI bill extraction fallback disabled (Tesseract OCR only)',
    GOOGLE_MAPS_API_KEY:    'Geocoding and utility rate detection disabled',
    RESEND_API_KEY:         'Transactional email disabled — password reset emails will NOT be sent',
    NEXT_PUBLIC_BASE_URL:   'Email reset links may point to wrong URL — set to production domain',
  };
  return warnings[varName] ?? 'functionality degraded';
}