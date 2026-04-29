// ============================================================================
// F-06 — Survey Ingest Owner Resolver
//
// resolveIngestOwner() determines which SolarPro user should own the project
// created or updated by the ingest pipeline.
//
// Resolution order:
//   1. If event.solarpro_user_id is present AND that user exists in the
//      SolarPro users table → use that user ID. ownerSource = 'claim'.
//   2. Otherwise fall back to SURVEY_INGEST_DEFAULT_USER_ID.
//      ownerSource = 'default'.
//
// Why we validate against the DB:
//   The solarpro_user_id claim originates from a SolarPro-signed HS256 JWT,
//   so it cannot be forged by the partner.  However the user could have been
//   deleted after the JWT was issued, so we validate existence before use.
//
// Returns null if SURVEY_INGEST_DEFAULT_USER_ID is also unset — the caller
// should return 500 and let the partner retry.
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

export interface OwnerResolution {
  ownerId: string;
  ownerSource: 'claim' | 'default';
}

/**
 * Resolve the SolarPro owner for an inbound survey event.
 *
 * @param solarpro_user_id  - claim from the webhook payload (may be null/undefined)
 * @param traceId           - for log correlation
 * @returns OwnerResolution | null  (null = no valid owner available)
 */
export async function resolveIngestOwner(
  solarpro_user_id: string | null | undefined,
  traceId: string,
): Promise<OwnerResolution | null> {
  const defaultOwnerId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() ?? '';

  // ── Attempt claim-based resolution ──────────────────────────────────────
  if (solarpro_user_id) {
    try {
      const sql = await getDbReady();
      // NOTE: The public.users table does NOT currently have a soft-delete
      // column. Earlier versions of this query included `AND deleted_at IS NULL`
      // which caused every lookup to throw (column does not exist), land in the
      // catch block below, and fall back to SURVEY_INGEST_DEFAULT_USER_ID —
      // which routed EVERY survey to a single account regardless of claim.
      //
      // This query is intentionally minimal. If/when users.deleted_at is
      // introduced, add the filter AND update this comment.
      const rows = await sql`
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

      // User not found — log and fall through to default
      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_fallback ` +
        `solarpro_user_id=${solarpro_user_id} not found in users table — using default`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[INGEST OWNER RESOLVED] traceId=${traceId} source=claim_error ` +
        `DB lookup failed for solarpro_user_id=${solarpro_user_id}: ${msg} — using default`,
      );
    }
  }

  // ── Fall back to default ─────────────────────────────────────────────────
  if (!defaultOwnerId) {
    console.error(
      `[INGEST OWNER RESOLVED] traceId=${traceId} source=none ` +
      `No solarpro_user_id claim and SURVEY_INGEST_DEFAULT_USER_ID is not set`,
    );
    return null;
  }

  console.log(
    `[INGEST OWNER RESOLVED] traceId=${traceId} source=default ownerId=${defaultOwnerId}` +
    (solarpro_user_id ? ` (claim present but invalid: ${solarpro_user_id})` : ' (no claim)'),
  );
  return { ownerId: defaultOwnerId, ownerSource: 'default' };
}