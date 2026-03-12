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
 * 1. getDbWithRetry()  — wraps any DB query in up to 3 attempts with
 *    exponential backoff (1s → 2s → 4s). Transient cold-start errors are
 *    retried automatically; env-var/config errors are thrown immediately.
 *
 * 2. probeDbReady()    — fires a lightweight SELECT 1 probe to wake the
 *    Neon compute before the real query runs.
 *
 * 3. isTransientDbError() — classifies errors as transient (retry) vs
 *    fatal (throw immediately). Uses a WHITELIST-FATAL approach: only
 *    explicitly known fatal errors are non-retryable. Everything else is
 *    treated as transient to prevent cold-start errors from being
 *    mis-classified as configuration failures.
 *
 * LOG CODES (searchable in Vercel logs)
 * ──────────────────────────────────────────────────────────────────────────────
 *   AUTH_DB_STARTING     — transient connection failure, retry in progress
 *   AUTH_DB_CONFIG_ERROR — DATABASE_URL missing or invalid, non-retryable
 *   AUTH_DB_QUERY_ERROR  — query succeeded but returned unexpected data
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Concrete type for a default neon() sql executor (no array mode, no full results)
type SqlExecutor = NeonQueryFunction<false, false>;

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s for attempts 0, 1, 2

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns the DATABASE_URL or throws a clear, non-retryable error.
 * This is the single place where the env var is checked.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
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
  return url;
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
 *   - PostgreSQL authentication failure (wrong password)
 *   - PostgreSQL role does not exist (wrong connection string)
 *   - Permission denied (wrong database user)
 *
 * Transient (retryable) patterns — everything else, including:
 *   - Neon cold start: "endpoint is starting", "compute is starting"
 *   - Network errors: ECONNRESET, ECONNREFUSED, ETIMEDOUT
 *   - HTTP transport errors: "fetch failed", "failed to fetch", "network error"
 *   - Connection drops: "connection terminated", "connection closed", "socket hang up"
 *   - Unknown Neon infrastructure errors (treated as transient by default)
 */
export function isTransientDbError(err: unknown): boolean {
  // DbConfigError is always fatal — DATABASE_URL missing, retrying won't help
  if (err instanceof DbConfigError) return false;

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // ── WHITELIST: explicitly fatal errors ────────────────────────────────────
  // Only these specific patterns are treated as non-retryable.

  // PostgreSQL auth failure — wrong password or user
  if (msg.includes('password authentication failed')) return false;

  // PostgreSQL role missing — wrong DATABASE_URL user component
  if (msg.includes('role') && msg.includes('does not exist')) return false;

  // PostgreSQL permission denied — insufficient privileges
  if (msg.includes('permission denied') && !msg.includes('permission denied to')) return false;

  // Database does not exist — wrong database name in URL
  if (msg.includes('database') && msg.includes('does not exist')) return false;

  // ── Everything else is transient ──────────────────────────────────────────
  // Neon cold-start errors, network errors, HTTP transport errors, and
  // any unknown error from Neon infrastructure are all treated as transient.
  // This is the safe default — a brief retry delay is far better than
  // incorrectly showing "Database not configured" to the user.
  return true;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Returns a Neon SQL executor, retrying up to MAX_RETRIES times with
 * exponential backoff if the connection fails on a cold start.
 *
 * For Neon serverless the sql`` executor itself doesn't connect — the
 * actual connection happens when you run the first query. So this function
 * returns the executor and wraps a probe query to verify connectivity.
 *
 * @throws DbConfigError if DATABASE_URL is missing (non-retryable)
 * @throws Error after MAX_RETRIES if all attempts fail (transient error)
 */
export async function getDbWithRetry(): Promise<SqlExecutor> {
  const url = getDatabaseUrl(); // throws DbConfigError immediately if missing
  const sql = neon(url) as SqlExecutor;

  // Verify connectivity with a lightweight probe (with retry)
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await sql`SELECT 1 AS db_ready`;
      return sql; // Connection verified — return the executor
    } catch (err: unknown) {
      lastError = err;

      if (!isTransientDbError(err)) {
        // Fatal error — don't retry
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AUTH_DB_CONFIG_ERROR] Non-retryable DB error on attempt ${attempt + 1}: ${msg}`);
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[AUTH_DB_STARTING] DB connection attempt ${attempt + 1}/${MAX_RETRIES} failed` +
        ` — retrying in ${delay}ms. Error: ${msg}`
      );
      await sleep(delay);
    }
  }

  // All retries exhausted — still transient, caller decides how to handle
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(`[AUTH_DB_STARTING] All ${MAX_RETRIES} DB connection attempts failed. Last error: ${msg}`);
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
 * Use this for routes where you want manual retry control, or where a
 * failed query is already handled by the caller.
 *
 * @throws DbConfigError if DATABASE_URL is missing
 */
export function getDbDirect(): SqlExecutor {
  const url = getDatabaseUrl();
  return neon(url) as SqlExecutor;
}