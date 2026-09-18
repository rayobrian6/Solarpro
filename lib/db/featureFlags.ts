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
 */
export async function getFeatureFlag(
  flagKey: string,
  envResolver?: () => boolean,
): Promise<{ enabled: boolean; source: 'db' | 'env' | 'default' }> {
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
