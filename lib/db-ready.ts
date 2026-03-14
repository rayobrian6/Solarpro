/**
 * lib/db-ready.ts
 *
 * Database readiness guard for Neon serverless PostgreSQL.
 *
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────────
 * Neon uses HTTP-based serverless Postgres — there is no persistent TCP
 * connection pool to "warm up". However, Neon compute nodes auto-suspend
 * after ~5 minutes of inactivity. The first query after a cold start wakes
 * the compute node, which takes 500ms–3s. During that window the query can
 * fail with a network timeout, ECONNRESET, or a Neon-specific "endpoint is
 * starting" error.
 *
 * On Vercel, a deployment creates new serverless function instances that
 * are also cold — so the first login attempt immediately after a deploy
 * can hit this Neon cold-start window and return an error, which without
 * this guard would be mis-classified as "Database not configured."
 *
 * HOW THIS FIXES IT
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. Module-level Neon singleton — neon(url) is called ONCE per function
 *    instance (cold start), not once per request. The executor is cached in
 *    module scope so subsequent calls to getDbReady() on warm instances are
 *    instant with no client object creation overhead.
 *
 * 2. Warm-cache flag — after a successful SELECT 1 probe, a module-level
 *    boolean is set so subsequent getDbReady() calls skip the probe entirely
 *    and return the cached executor immediately (~0ms overhead on warm paths).
 *    Flag resets on any connection error so the next call re-probes.
 *
 * 3. getDbWithRetry() — retries SELECT 1 probe up to MAX_RETRIES times with
 *    SHORT exponential backoff (300ms/600ms/1200ms/2400ms/4800ms) so that:
 *    a) Total retry budget is ~9s, well under Vercel Pro 60s limit
 *    b) Individual delays are short enough that Neon wakes before retry 2-3
 *    c) maxDuration=30 on auth routes gives the full retry budget room to work
 *
 * 4. isTransientDbError() — WHITELIST-FATAL approach: only explicitly known
 *    fatal errors are non-retryable. Everything else is treated as transient
 *    to prevent cold-start errors from being mis-classified as config failures.
 *    Specifically: "SCRAM authentication" / "channel binding" errors are now
 *    treated as transient (they can occur during Neon proxy cold starts too).
 *
 * LOG CODES (searchable in Vercel logs)
 * ──────────────────────────────────────────────────────────────────────────────
 *   SERVER_INSTANCE_STARTED  — module first loaded on a new function instance
 *   ENV_DATABASE_URL_STATUS  — DATABASE_URL presence logged at cold start
 *   DB_CLIENT_INIT           — neon() singleton created
 *   DB_CONNECTION_ATTEMPT    — SELECT 1 probe starting
 *   DB_CONNECTION_SUCCESS    — probe succeeded
 *   DB_CONNECTION_FAILED     — probe failed (with error + attempt number)
 *   AUTH_DB_STARTING         — transient connection failure, retry in progress
 *   AUTH_DB_CONFIG_ERROR     — DATABASE_URL missing or invalid, non-retryable
 *   AUTH_DB_QUERY_ERROR      — query succeeded but returned unexpected data
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Concrete type for a default neon() sql executor (no array mode, no full results)
type SqlExecutor = NeonQueryFunction<false, false>;

// ─── Config ──────────────────────────────────────────────────────────────────

// v47.9: Reduced from 3 retries (1s/2s/4s = 7s) to 5 retries (300ms/600ms/1200ms/2400ms/4800ms = 9.1s)
// Shorter initial delays mean Neon wakes before retry 2 in most cases.
// Total budget ~9s fits within maxDuration=30 on auth routes with room for the actual query.
const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 300;  // 300ms, 600ms, 1200ms, 2400ms, 4800ms

// ─── Module-level singleton ───────────────────────────────────────────────────
//
// v47.9: Cache the Neon executor and warm state at module level.
//
// On Vercel serverless, module-level code runs ONCE per function instance cold
// start. The same module is reused across multiple requests to the same warm
// function instance. By caching the executor here:
//   - neon(url) is called exactly once per cold start (not per request)
//   - The warm flag means SELECT 1 probe is skipped on all subsequent requests
//     to the same warm instance (~0ms overhead vs ~200ms per probe)
//   - DATABASE_URL is read and validated once per instance
//
// The singleton is intentionally NOT globalThis-based because Vercel Next.js
// serverless functions DO isolate module scope per function bundle — global
// singletons across bundles cause more problems than they solve with Neon's
// HTTP driver (which has no persistent connection to share anyway).

let _cachedSql: SqlExecutor | null = null;
let _instanceWarm = false;  // true after first successful SELECT 1 on this instance

// Log server instance start (appears once per cold start in Vercel logs)
console.log('[SERVER_INSTANCE_STARTED] db-ready.ts module loaded on new function instance');

// Log full env status at module load time so every cold start shows env health
// in Vercel logs — search for [ENV_COLD_START] to find these entries.
{
  const _dbUrl  = process.env.DATABASE_URL;
  const _jwtSec = process.env.JWT_SECRET;
  const _dbOk   = !!(_dbUrl && _dbUrl !== 'YOUR_NEON_DATABASE_URL_HERE');
  const _jwtOk  = !!(_jwtSec && _jwtSec.length > 10);
  const _icon   = (!_dbOk || !_jwtOk) ? '🔴' : '✅';
  console.log(
    `[ENV_COLD_START] ${_icon}` +
    ` DATABASE_URL=${_dbOk} (len=${_dbUrl?.length ?? 0})` +
    ` JWT_SECRET=${_jwtOk} (len=${_jwtSec?.length ?? 0})` +
    ` GOOGLE_MAPS=${!!process.env.GOOGLE_MAPS_API_KEY}` +
    ` NODE_ENV=${process.env.NODE_ENV ?? 'unknown'}` +
    ` VERCEL_ENV=${process.env.VERCEL_ENV ?? 'local'}`
  );
  if (!_dbOk) {
    console.error(
      '\n[ENV_COLD_START] ❌ DATABASE_URL is not set!\n' +
      '  → Vercel Dashboard → Project → Settings → Environment Variables\n' +
      '  → Add: DATABASE_URL = <your Neon connection string>\n' +
      '  → Then redeploy. Env vars are NOT hot-reloaded.\n'
    );
  }
  if (!_jwtOk) {
    console.error(
      '\n[ENV_COLD_START] ❌ JWT_SECRET is not set!\n' +
      '  → Vercel Dashboard → Project → Settings → Environment Variables\n' +
      '  → Add: JWT_SECRET = <any random 32+ character string>\n' +
      '  → Then redeploy.\n'
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns the DATABASE_URL or throws a clear, non-retryable error.
 * This is the single place where the env var is checked.
 * Logs ENV_DATABASE_URL_STATUS on every call for Vercel log visibility.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  // v47.9: Log env var status for Vercel deployment diagnostics
  console.log(`[ENV_DATABASE_URL_STATUS] DATABASE_URL exists: ${!!url} length: ${url?.length ?? 0}`);

  if (!url || url === 'YOUR_NEON_DATABASE_URL_HERE') {
    console.error(
      '\n[AUTH_DB_CONFIG_ERROR] DATABASE_URL is not configured.\n' +
      '  -> Add DATABASE_URL to your Vercel project environment variables.\n' +
      '  -> Get it from: https://console.neon.tech -> your project -> Connection string\n'
    );
    throw new DbConfigError(
      'DATABASE_URL is not set. Add it to your Vercel environment variables.'
    );
  }

  // v47.9: CRITICAL — strip channel_binding=require from DATABASE_URL.
  //
  // channel_binding=require forces SCRAM-SHA-256-PLUS SSL channel binding.
  // During Neon proxy cold starts, the proxy may not have its SSL context
  // ready, causing channel binding negotiation to fail with errors like:
  //   "SCRAM authentication failed: server did not support channel binding"
  //   "SSL connection error: channel binding required"
  //
  // isTransientDbError() now treats these as transient, but avoiding the
  // error entirely is better. channel_binding=disable uses standard SCRAM
  // without channel binding — still secure, vastly more reliable.
  //
  // This sanitization handles Vercel env vars that still have the old value.
  // Update your Vercel project env var to use channel_binding=disable to
  // permanently fix this without needing the runtime strip.
  const safeUrl = url
    .replace('channel_binding=require', 'channel_binding=disable')
    .replace('channel_binding=prefer', 'channel_binding=disable');

  if (safeUrl !== url) {
    console.warn('[ENV_DATABASE_URL_STATUS] Sanitized channel_binding=require → channel_binding=disable in DATABASE_URL');
  }

  return safeUrl;
}

/**
 * Returns or creates the module-level Neon SQL executor singleton.
 * Logs DB_CLIENT_INIT on first creation for cold-start tracing.
 */
function getSqlSingleton(): SqlExecutor {
  if (!_cachedSql) {
    const url = getDatabaseUrl();
    console.log('[DB_CLIENT_INIT] Creating Neon SQL executor singleton');
    _cachedSql = neon(url) as SqlExecutor;
    console.log('[DB_CLIENT_INIT] Neon SQL executor created successfully');
  }
  return _cachedSql;
}

// ─── Error Classes ────────────────────────────────────────────────────────────

/**
 * A non-retryable configuration error.
 * Thrown when DATABASE_URL is missing — retrying won't help.
 * Routes must check for this specifically and return DB_CONFIG_ERROR to the client.
 */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

// ─── Error Classification ─────────────────────────────────────────────────────

/**
 * Classifies a DB error as transient (should retry) or fatal (throw immediately).
 *
 * DESIGN: Uses a WHITELIST-FATAL approach.
 * Only explicitly known fatal error patterns are classified as non-retryable.
 * ALL other errors (including unknown Neon errors) are treated as transient.
 *
 * This prevents Neon cold-start errors with unusual messages from being
 * mis-classified as configuration failures and shown to the user as
 * "Database not configured."
 *
 * Fatal (non-retryable) patterns:
 *   - Missing DATABASE_URL (DbConfigError)
 *   - PostgreSQL authentication failure (wrong password) — but NOT channel binding
 *   - PostgreSQL role does not exist (wrong connection string)
 *   - Permission denied (wrong database user)
 *   - Database does not exist (wrong database name)
 *
 * Transient (retryable) patterns — everything else, including:
 *   - Neon cold start: "endpoint is starting", "compute is starting"
 *   - Network errors: ECONNRESET, ECONNREFUSED, ETIMEDOUT
 *   - HTTP transport errors: "fetch failed", "failed to fetch", "network error"
 *   - Connection drops: "connection terminated", "connection closed", "socket hang up"
 *   - SSL/TLS handshake during Neon proxy cold start (channel binding, SCRAM)
 *   - Unknown Neon infrastructure errors (treated as transient by default)
 *
 * v47.9: SCRAM/channel binding errors are now explicitly TRANSIENT.
 * These can occur when the Neon proxy itself is cold-starting — the proxy
 * hasn't established its SSL context yet and rejects channel binding even
 * though DATABASE_URL is correct. Treating them as fatal caused "Database
 * not configured" banners even when the DB was healthy.
 */
export function isTransientDbError(err: unknown): boolean {
  // DbConfigError is always fatal — DATABASE_URL missing, retrying won't help
  if (err instanceof DbConfigError) return false;

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // ── WHITELIST: explicitly fatal errors ────────────────────────────────────
  // Only these specific patterns are treated as non-retryable.
  // All other errors default to transient below.

  // PostgreSQL auth failure — wrong password (not channel binding, which is transient)
  // Note: "scram" alone is NOT fatal — only "password authentication failed" is
  if (msg.includes('password authentication failed')) return false;

  // PostgreSQL role missing — wrong DATABASE_URL user component
  if (msg.includes('role') && msg.includes('does not exist')) return false;

  // PostgreSQL permission denied — insufficient privileges
  // NARROW match: exclude "permission denied to" which can occur on cold-start proxy errors
  if (msg.includes('permission denied') && !msg.includes('permission denied to')) return false;

  // Database does not exist — wrong database name in URL
  if (msg.includes('database') && msg.includes('does not exist')) return false;

  // ── Everything else is transient ──────────────────────────────────────────
  // Neon cold-start errors, network errors, HTTP transport errors,
  // SSL/channel binding errors from proxy cold start, and any unknown
  // error from Neon infrastructure are all treated as transient.
  // This is the safe default — a brief retry delay is far better than
  // incorrectly showing "Database not configured" to the user.
  return true;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Returns a Neon SQL executor, retrying up to MAX_RETRIES times with
 * short exponential backoff if the connection fails on a cold start.
 *
 * v47.9 changes:
 * - Uses module-level singleton (neon(url) called once per cold start)
 * - Warm-cache flag: skips SELECT 1 probe on warm instances (~0ms overhead)
 * - Reduced delays: 300ms/600ms/1200ms/2400ms/4800ms (was 1s/2s/4s)
 * - Logs DB_CONNECTION_ATTEMPT / DB_CONNECTION_SUCCESS / DB_CONNECTION_FAILED
 *
 * @throws DbConfigError if DATABASE_URL is missing (non-retryable)
 * @throws Error after MAX_RETRIES if all attempts fail (transient error)
 */
export async function getDbWithRetry(): Promise<SqlExecutor> {
  const sql = getSqlSingleton(); // throws DbConfigError if DATABASE_URL missing

  // If this function instance already has a verified connection, skip the probe
  if (_instanceWarm) {
    return sql;
  }

  // Verify connectivity with a lightweight probe (with retry)
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const attemptLabel = `${attempt + 1}/${MAX_RETRIES}`;
    console.log(`[DB_CONNECTION_ATTEMPT] SELECT 1 probe attempt ${attemptLabel}`);
    try {
      await sql`SELECT 1 AS db_ready`;
      _instanceWarm = true; // Mark instance as warm — skip probe on next call
      console.log(`[DB_CONNECTION_SUCCESS] DB probe succeeded on attempt ${attemptLabel}`);
      return sql; // Connection verified — return the executor
    } catch (err: unknown) {
      lastError = err;

      if (!isTransientDbError(err)) {
        // Fatal error — don't retry
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AUTH_DB_CONFIG_ERROR] Non-retryable DB error on attempt ${attemptLabel}: ${msg}`);
        // Reset singleton so next call retries getDatabaseUrl() check
        _cachedSql = null;
        _instanceWarm = false;
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 300ms, 600ms, 1200ms, 2400ms, 4800ms
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DB_CONNECTION_FAILED] [AUTH_DB_STARTING] probe attempt ${attemptLabel} failed` +
        ` — retrying in ${delay}ms. Error: ${msg}`
      );

      if (attempt < MAX_RETRIES - 1) {
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — still transient, caller decides how to handle
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(`[AUTH_DB_STARTING] All ${MAX_RETRIES} DB connection attempts failed. Last error: ${msg}`);
  // Reset warm flag so next request will re-probe
  _instanceWarm = false;
  throw lastError;
}

/**
 * Fires a lightweight SELECT 1 probe to wake the Neon compute node before
 * a real query runs. Returns true if DB is reachable, false otherwise.
 *
 * Does NOT throw — designed to be called speculatively before auth queries.
 * Uses the same retry logic as getDbWithRetry().
 */
export async function probeDbReady(): Promise<boolean> {
  try {
    await getDbWithRetry();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a raw Neon SQL executor WITHOUT the probe/retry overhead.
 * Uses the module-level singleton.
 * Use this for routes where you want manual retry control, or where a
 * failed query is already handled by the caller.
 *
 * @throws DbConfigError if DATABASE_URL is missing
 */
export function getDbDirect(): SqlExecutor {
  return getSqlSingleton();
}