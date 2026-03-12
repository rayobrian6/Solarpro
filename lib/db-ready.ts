/**
 * lib/db-ready.ts
 *
 * Database readiness guard for Neon serverless PostgreSQL.
 *
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * Neon uses HTTP-based serverless Postgres — there is no persistent TCP
 * connection pool to "warm up". However, Neon compute nodes auto-suspend
 * after ~5 minutes of inactivity. The first query after a cold start wakes
 * the compute node, which takes 500ms–3s. During that window the query can
 * fail with a network timeout, ECONNRESET, or a Neon-specific "endpoint is
 * starting" error.
 *
 * On Vercel, a deployment creates new serverless function instances that
 * are also cold — so the first login attempt immediately after a deploy
 * can hit this Neon cold-start window and return an error, which the old
 * login route mis-classified as "Database not configured."
 *
 * HOW THIS FIXES IT
 * ──────────────────────────────────────────────────────────────────────────
 * 1. getDbWithRetry()  — wraps any DB query in up to 3 attempts with
 *    exponential backoff (1s → 2s → 4s). Transient cold-start errors are
 *    retried automatically; env-var/config errors are thrown immediately.
 *
 * 2. probeDbReady()    — fires a lightweight SELECT 1 probe to wake the
 *    Neon compute before the real query runs. Called by login so the auth
 *    query lands on an already-warm connection.
 *
 * 3. isTransientDbError() — classifies errors as transient (retry) vs
 *    fatal (throw immediately). Prevents retrying on misconfiguration.
 *
 * USAGE
 * ──────────────────────────────────────────────────────────────────────────
 *   import { getDbWithRetry, probeDbReady } from '@/lib/db-ready';
 *
 *   // Probe first (optional — warms the compute node):
 *   await probeDbReady();
 *
 *   // Then run queries with automatic retry:
 *   const sql = await getDbWithRetry();
 *   const rows = await sql`SELECT ...`;
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Concrete type for a default neon() sql executor (no array mode, no full results)
type SqlExecutor = NeonQueryFunction<false, false>;

// ─── Config ────────────────────────────────────────────────────────────────

const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s for attempts 0, 1, 2

// ─── Helpers ───────────────────────────────────────────────────────────────

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
      '\n[db-ready] DATABASE_URL is not configured.\n' +
      '  -> Add DATABASE_URL to your Vercel project environment variables.\n' +
      '  -> Get it from: https://console.neon.tech -> your project -> Connection string\n'
    );
    throw new DbConfigError(
      'DATABASE_URL is not set. Add it to your Vercel environment variables.'
    );
  }
  return url;
}

/**
 * A non-retryable configuration error.
 * Thrown when DATABASE_URL is missing — retrying won't help.
 */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

/**
 * Classifies a DB error as transient (should retry) or fatal (throw immediately).
 *
 * Transient errors: network timeouts, ECONNRESET, Neon cold-start,
 * connection refused on first wake-up.
 *
 * Fatal errors: missing env var, auth failure, invalid SQL.
 */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof DbConfigError) return false;

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Fatal: env/config errors — retrying won't help
  if (msg.includes('database_url') || msg.includes('not set') ||
      msg.includes('not configured')) {
    return false;
  }

  // Fatal: auth/permission errors
  if (msg.includes('password authentication') ||
      msg.includes('role') && msg.includes('does not exist') ||
      msg.includes('permission denied')) {
    return false;
  }

  // Transient: known Neon cold-start / network errors
  if (msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('timeout') ||
      msg.includes('starting') ||           // "endpoint is starting"
      msg.includes('connection terminated') ||
      msg.includes('connection closed') ||
      msg.includes('socket hang up') ||
      msg.includes('network error') ||
      msg.includes('fetch failed') ||
      msg.includes('failed to fetch')) {
    return true;
  }

  // Default: treat unknown DB errors as transient on first occurrence
  return true;
}

// ─── Core API ──────────────────────────────────────────────────────────────

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
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
      console.warn(
        `[db-ready] DB connection attempt ${attempt + 1}/${MAX_RETRIES} failed` +
        ` — retrying in ${delay}ms. Error: ${err instanceof Error ? err.message : err}`
      );
      await sleep(delay);
    }
  }

  // All retries exhausted
  console.error('[db-ready] All DB connection attempts failed.');
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