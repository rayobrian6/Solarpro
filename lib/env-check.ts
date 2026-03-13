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
 *   import '@/lib/env-check';   // throws on missing vars
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
 */
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
] as const;

/**
 * Optional but strongly recommended env vars.
 * Missing these degrades functionality but doesn't block the app.
 */
const RECOMMENDED_VARS = [
  'OPENAI_API_KEY',       // AI bill extraction fallback
  'GOOGLE_MAPS_API_KEY',  // Geocoding + utility detection
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
    const present = !!process.env[varName] && process.env[varName] !== 'YOUR_NEON_DATABASE_URL_HERE';
    details[varName] = present;
    if (!present) missing.push(varName);
  }

  for (const varName of RECOMMENDED_VARS) {
    const present = !!process.env[varName];
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
    const msg = [
      `[ENV_CHECK] Missing required environment variables: ${result.missing.join(', ')}`,
      `This deployment is misconfigured. Set these in your Vercel project environment settings:`,
      ...result.missing.map(v => `  -> ${v}: ${getVarDescription(v)}`),
    ].join('\n');
    console.error(msg);
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
 */
export function logEnvStatus(routeLabel: string): void {
  const result = validateEnv();
  console.log(`[ENV_STATUS] route=${routeLabel} DATABASE_URL=${result.details['DATABASE_URL']} JWT_SECRET=${result.details['JWT_SECRET']} OPENAI_API_KEY=${result.details['OPENAI_API_KEY']} GOOGLE_MAPS_API_KEY=${result.details['GOOGLE_MAPS_API_KEY']} valid=${result.valid}`);
  if (!result.valid) {
    console.error(`[ENV_MISSING] CRITICAL: ${result.missing.join(', ')} not set — route will fail on DB/auth operations`);
  }
}

function getVarDescription(varName: string): string {
  const descriptions: Record<string, string> = {
    DATABASE_URL: 'Neon PostgreSQL connection string (postgresql://...)',
    JWT_SECRET: 'Secret key for JWT session signing (random 32+ char string)',
    OPENAI_API_KEY: 'OpenAI API key for AI bill extraction (sk-...)',
    GOOGLE_MAPS_API_KEY: 'Google Maps API key for geocoding',
  };
  return descriptions[varName] ?? 'Required for app functionality';
}

function getVarWarning(varName: string): string {
  const warnings: Record<string, string> = {
    OPENAI_API_KEY: 'AI bill extraction fallback disabled (Tesseract only)',
    GOOGLE_MAPS_API_KEY: 'Geocoding and utility detection disabled',
  };
  return warnings[varName] ?? 'functionality degraded';
}