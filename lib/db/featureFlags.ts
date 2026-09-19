/**
 * lib/db/featureFlags.ts
 * Runtime feature-flag DB layer — extracted as a separate module so the layout
 * can read flags without pulling in the rest of lib/db-neon.
 *
 * Precedence (per James 2026-08-25 ask_user): DB row if present → env var → off.
 * The env var is the deploy default; the DB row is the runtime override.
 */

import { getDbReady, handleRouteDbError } from './core';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DbFeatureFlag {
  id:                string;
  flagKey:           string;
  description:       string;
  enabled:           boolean;
  updatedAt:         string;
  updatedByUserId:   string | null;
  createdAt:         string;
}

interface FlagRow extends Record<string, unknown> {
  id:                  string;
  flag_key:            string;
  description:         string;
  enabled:             boolean;
  updated_at:          Date | string;
  updated_by_user_id:  string | null;
  created_at:          Date | string;
}

function rowToFlag(row: Record<string, unknown>): DbFeatureFlag {
  const r = row as unknown as FlagRow;
  return {
    id:              r.id,
    flagKey:         r.flag_key,
    description:     r.description,
    enabled:         Boolean(r.enabled),
    updatedAt:       typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
    updatedByUserId: r.updated_by_user_id,
    createdAt:       typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

// ─── Hot-path cache ─────────────────────────────────────────────────────────

/**
 * How long a resolved flag value is reused before the next call re-reads it.
 *
 * WHAT WAS WRONG (fixed 2026-09-18). app/layout.tsx is the ROOT layout: it
 * renders for EVERY request to EVERY page, and it awaited getSolarDogEnabled()
 * directly. That put a Neon round-trip on the critical path of every page load
 * in production — and while app_feature_flags is absent (migration 121 is
 * written but not registered with the runner, so it has never been applied)
 * it put a FAILING connection plus a console.warn there instead, once per
 * request. The helper's doc comment even said "the layout calls this on every
 * page render", and the SQL file's index comment calls it "the hot path",
 * which is exactly the thing that should never have been uncached.
 *
 * WHY A TTL MEMO AND NOT next/cache. The value has to stay flippable from
 * /admin/system-tools without a redeploy, so it cannot be resolved at build
 * time; and this module is imported by a Server Component, by a route handler
 * and by unit tests alike, so it must not require a Next request/render
 * context to work. A module-level memo with a short TTL satisfies both: on
 * Vercel it lives for the lifetime of one lambda instance, so an admin flip
 * becomes visible everywhere within FLAG_CACHE_TTL_MS with no deploy, and the
 * per-request DB cost collapses to at most one read per key per TTL.
 */
export const FLAG_CACHE_TTL_MS = 30_000;

type FlagResolution = { enabled: boolean; source: 'db' | 'env' | 'default' };

/** The PROMISE is memoised, not the resolved value, so N concurrent renders
 *  during a cold start share ONE query instead of stampeding the pool. */
const flagCache = new Map<string, { expiresAtMs: number; value: Promise<FlagResolution> }>();

/**
 * Drop a cached flag (or the whole cache). Called by setFeatureFlag so an
 * admin's own flip is reflected immediately in the instance that served the
 * write, rather than up to FLAG_CACHE_TTL_MS later. Also the seam the tests
 * use to get a clean cache between cases.
 */
export function invalidateFeatureFlagCache(flagKey?: string): void {
  if (flagKey === undefined) flagCache.clear();
  else flagCache.delete(flagKey);
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Read a single flag's effective value. Resolution order:
 *   1. DB row (if it exists) — runtime override
 *   2. Env var resolver (if the flag has one)
 *   3. false (fail-safe off)
 *
 * FAIL-SAFE: if the DB is unreachable (build-time pre-render with no
 * live connection, or a transient outage), we fall through to the env
 * var resolver or default-off rather than throwing. The layout calls
 * this on every page render — a throw here would crash the whole page
 * tree at build time. The runtime cost is one extra try/catch on the
 * happy path (zero overhead when the DB returns).
 *
 * Returns { enabled, source } so the caller can render which one won.
 *
 * CACHED: this is a thin TTL memo over resolveFeatureFlag below — see
 * FLAG_CACHE_TTL_MS for why. The resolution logic itself is untouched, so the
 * fail-closed order (DB row → env → off) is exactly what it always was; the
 * only change is how often it is actually recomputed. `envResolver` is
 * therefore assumed to be stable for a given flagKey (it is a deploy-time env
 * read, and each key has exactly one call site) — the cache is keyed by
 * flagKey alone, so two callers passing DIFFERENT resolvers for the SAME key
 * would share one answer.
 */
export async function getFeatureFlag(
  flagKey: string,
  envResolver?: () => boolean,
): Promise<FlagResolution> {
  const now = Date.now();
  const hit = flagCache.get(flagKey);
  if (hit && hit.expiresAtMs > now) return hit.value;

  const value = resolveFeatureFlag(flagKey, envResolver);
  flagCache.set(flagKey, { expiresAtMs: now + FLAG_CACHE_TTL_MS, value });
  // A rejected lookup must not be pinned for the whole TTL. resolveFeatureFlag
  // does not reject today — it catches internally and falls through to
  // env/default — and this guard is what keeps a future change from turning
  // one transient failure into 30 seconds of a stuck rejected promise.
  value.catch(() => {
    if (flagCache.get(flagKey)?.value === value) flagCache.delete(flagKey);
  });
  return value;
}

/** The uncached resolution — the original getFeatureFlag body, unchanged.
 *  Note the cache above stores the FALLBACK result exactly like a DB hit, on
 *  purpose: collapsing the per-request failed connection and its warn line
 *  while app_feature_flags is missing is half of what the cache is for. */
async function resolveFeatureFlag(
  flagKey: string,
  envResolver?: () => boolean,
): Promise<FlagResolution> {
  try {
    const sql = await getDbReady();

    const rows = (await sql`
      SELECT id, flag_key, description, enabled, updated_at, updated_by_user_id, created_at
        FROM app_feature_flags
       WHERE flag_key = ${flagKey}
       LIMIT 1
    `) as unknown as FlagRow[];

    if (rows.length > 0) {
      return { enabled: Boolean(rows[0].enabled), source: 'db' };
    }
  } catch (e) {
    // DB unreachable or query failed — fall through to env/default.
    // Logged once at warn level so a sustained outage shows up in observability.
    console.warn(
      `[featureFlags] getFeatureFlag(${flagKey}) DB lookup failed; falling back to env/default. Error: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (envResolver) {
    return { enabled: envResolver(), source: 'env' };
  }

  return { enabled: false, source: 'default' };
}

/**
 * Resolve SOLARDOG_ENABLED with the canonical precedence:
 *   DB row → process.env.SOLARDOG_ENABLED === 'true' → false.
 *
 * Used by app/layout.tsx. Keep this tight — the layout calls it on every
 * page render.
 */
export async function getSolarDogEnabled(): Promise<boolean> {
  const result = await getFeatureFlag('solardog_enabled', () => process.env.SOLARDOG_ENABLED === 'true');
  return result.enabled;
}

/**
 * List every flag in app_feature_flags, ordered by flag_key. Used by the
 * admin /api/admin/feature-flags endpoint.
 */
export async function listFeatureFlags(): Promise<DbFeatureFlag[]> {
  const sql = await getDbReady();
  const rows = (await sql`
    SELECT id, flag_key, description, enabled, updated_at, updated_by_user_id, created_at
      FROM app_feature_flags
     ORDER BY flag_key ASC
  `) as unknown as FlagRow[];
  return rows.map(rowToFlag);
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Upsert a flag. Inserts with a slug id derived from flag_key, or updates the
 * existing row's enabled + audit columns. Returns the post-update row.
 */
export async function setFeatureFlag(
  flagKey: string,
  enabled: boolean,
  updatedByUserId: string,
  description?: string,
): Promise<DbFeatureFlag> {
  const sql = await getDbReady();
  const id = flagKey; // 1:1 — id is the flag key itself
  const desc = description ?? '';

  const rows = (await sql`
    INSERT INTO app_feature_flags (id, flag_key, description, enabled, updated_at, updated_by_user_id, created_at)
    VALUES (${id}, ${flagKey}, ${desc}, ${enabled}, NOW(), ${updatedByUserId}, NOW())
    ON CONFLICT (flag_key) DO UPDATE SET
      enabled            = EXCLUDED.enabled,
      description        = COALESCE(NULLIF(EXCLUDED.description, ''), app_feature_flags.description),
      updated_at         = NOW(),
      updated_by_user_id = EXCLUDED.updated_by_user_id
    RETURNING id, flag_key, description, enabled, updated_at, updated_by_user_id, created_at
  `) as unknown as FlagRow[];

  if (rows.length === 0) {
    // Should not happen — INSERT ... ON CONFLICT ... RETURNING always returns the row
    throw new Error('setFeatureFlag: UPSERT returned no row');
  }

  // Drop the memo for this key so the admin who just flipped it sees the new
  // value on their very next render instead of up to FLAG_CACHE_TTL_MS later.
  // Other instances still converge on the TTL — that is the documented bound.
  invalidateFeatureFlagCache(flagKey);

  return rowToFlag(rows[0]);
}

// ─── Schema probe (used by the admin UI to surface "table missing" cleanly) ─

/**
 * Returns true if the app_feature_flags table exists. Used by the admin UI to
 * render a friendly "migration not applied" message instead of a 500.
 */
export async function featureFlagsTableExists(): Promise<boolean> {
  try {
    const sql = await getDbReady();
    const rows = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'app_feature_flags'
      ) AS exists
    `) as unknown as Array<{ exists: boolean }>;
    return rows[0]?.exists === true;
  } catch (e) {
    handleRouteDbError('[lib/db/featureFlags.ts] featureFlagsTableExists', e);
    return false;
  }
}
