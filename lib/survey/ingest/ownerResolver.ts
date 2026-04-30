// ============================================================================
// F-06 — Survey Ingest Owner Resolver
//
// resolveIngestOwner() determines which SolarPro user should own the project
// created or updated by the ingest pipeline.
//
// Resolution order:
//   1. solarpro_user_id (UUID claim) — if present AND exists in users table
//      → ownerSource = 'claim'
//   2. solarpro_email — if present AND matches a user by email (LOWER)
//      → ownerSource = 'claim_email'
//      (handles the case where partner UUIDs don't match SolarPro users because
//       the partner wiped his own user DB and now uses SolarPro's PostgreSQL)
//   3. solarpro_project_id — if present AND project exists in SolarPro DB,
//      use that project's current user_id as the owner
//      → ownerSource = 'project'
//      (the project was created via the handoff flow and already has the correct
//       owner set — this is the permanent scale solution for the partner case)
//   4. SURVEY_INGEST_DEFAULT_USER_ID fallback
//      → ownerSource = 'default'
//
// Returns null if SURVEY_INGEST_DEFAULT_USER_ID is also unset — the caller
// should return 500 and let the partner retry.
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

export interface OwnerResolution {
  ownerId: string;
  ownerSource: 'claim' | 'claim_email' | 'project' | 'default';
}

/**
 * Resolve the SolarPro owner for an inbound survey event.
 *
 * @param solarpro_user_id    - UUID claim from the webhook payload (may be null/undefined)
 * @param traceId             - for log correlation
 * @param solarpro_email      - email claim from the webhook payload (may be null/undefined)
 * @param solarpro_project_id - project ID claim from the webhook payload (may be null/undefined)
 * @returns OwnerResolution | null  (null = no valid owner available)
 */
export async function resolveIngestOwner(
  solarpro_user_id:     string | null | undefined,
  traceId:              string,
  solarpro_email?:      string | null,
  solarpro_project_id?: string | null,
): Promise<OwnerResolution | null> {
  const defaultOwnerId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() ?? '';

  // Lazily obtain the DB connection once and reuse across all strategies
  let sql: Awaited<ReturnType<typeof getDbReady>> | null = null;
  const getSql = async () => {
    if (!sql) sql = await getDbReady();
    return sql;
  };

  // ── Strategy 1: UUID claim ──────────────────────────────────────────────────
  if (solarpro_user_id) {
    try {
      const db = await getSql();
      // NOTE: users table does NOT have a soft-delete column.
      // Do NOT add `AND deleted_at IS NULL` — that column doesn't exist.
      const rows = await db`
        SELECT id FROM users
         WHERE id = ${solarpro_user_id}
         LIMIT 1
      `;

      if (rows.length > 0) {
        console.log(
          `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim ownerId=${solarpro_user_id}`,
        );
        return { ownerId: solarpro_user_id, ownerSource: 'claim' };
      }

      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_miss ` +
        `solarpro_user_id=${solarpro_user_id} not found in users table — trying email`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_error ` +
        `DB lookup failed for solarpro_user_id=${solarpro_user_id}: ${msg} — trying email`,
      );
    }
  }

  // ── Strategy 2: Email claim ─────────────────────────────────────────────────
  if (solarpro_email) {
    try {
      const db = await getSql();
      const rows = await db`
        SELECT id FROM users
         WHERE LOWER(email) = LOWER(${solarpro_email})
         LIMIT 1
      `;

      if (rows.length > 0) {
        const ownerId = rows[0].id as string;
        console.log(
          `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_email ` +
          `email=${solarpro_email} ownerId=${ownerId}`,
        );
        return { ownerId, ownerSource: 'claim_email' };
      }

      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_email_miss ` +
        `solarpro_email=${solarpro_email} not found in users table — trying project`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_email_error ` +
        `DB lookup failed for solarpro_email=${solarpro_email}: ${msg} — trying project`,
      );
    }
  }

  // ── Strategy 3: Project-based resolution ────────────────────────────────────
  // The handoff JWT contains the SolarPro project ID. That project was created
  // by the real user during the handoff flow, so its user_id IS the correct owner.
  // This is the permanent scale solution: even if partner sends no user claims,
  // we can always recover the owner from the project that triggered the survey.
  if (solarpro_project_id) {
    try {
      const db = await getSql();
      const rows = await db`
        SELECT p.user_id, u.id AS user_exists
          FROM projects p
          JOIN users u ON u.id = p.user_id
         WHERE p.id = ${solarpro_project_id}
         LIMIT 1
      `;

      if (rows.length > 0) {
        const ownerId = rows[0].user_id as string;
        console.log(
          `[INGEST OWNER RESOLVED] traceId=${traceId} source=project ` +
          `solarpro_project_id=${solarpro_project_id} ownerId=${ownerId}`,
        );
        return { ownerId, ownerSource: 'project' };
      }

      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=project_miss ` +
        `solarpro_project_id=${solarpro_project_id} not found in projects table — using default`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=project_error ` +
        `DB lookup failed for solarpro_project_id=${solarpro_project_id}: ${msg} — using default`,
      );
    }
  }

  // ── Strategy 4: Default fallback ────────────────────────────────────────────
  if (!defaultOwnerId) {
    console.error(
      `[INGEST OWNER RESOLVED] traceId=${traceId} source=none ` +
      `All resolution strategies exhausted and SURVEY_INGEST_DEFAULT_USER_ID is not set`,
    );
    return null;
  }

  console.log(
    `[INGEST OWNER RESOLVED] traceId=${traceId} source=default ownerId=${defaultOwnerId}` +
    (solarpro_user_id    ? ` (uid claim present but invalid: ${solarpro_user_id})`           : '') +
    (solarpro_email      ? ` (email claim present but no match: ${solarpro_email})`          : '') +
    (solarpro_project_id ? ` (project claim present but not found: ${solarpro_project_id})` : ''),
  );
  return { ownerId: defaultOwnerId, ownerSource: 'default' };
}