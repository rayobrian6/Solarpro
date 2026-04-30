// ============================================================================
// POST /api/admin/survey-reassign
//
// v58.20 — Admin endpoint to fix surveys incorrectly owned by the fallback
// default user (SURVEY_INGEST_DEFAULT_USER_ID) that should belong to the
// actual submitting user based on survey_meta.solarpro_user_id.
//
// Two operations:
//
//   action = 'fix-one'
//     Reassign a single project (by project id) to the user stored in
//     survey_meta.solarpro_user_id.  Requires: { action, projectId }
//
//   action = 'fix-all-defaults'
//     Find ALL projects where:
//       - user_id = SURVEY_INGEST_DEFAULT_USER_ID  (current fallback owner)
//       - origin  = 'survey'
//       - survey_meta->>'solarpro_user_id' IS NOT NULL
//       - that user exists in the users table
//     Reassign each one to the correct user.  Dry-run supported via dryRun=true.
//
// Auth: admin only.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, projectId, dryRun } = body as {
    action?: string;
    projectId?: string;
    dryRun?: boolean;
  };

  if (!action) {
    return NextResponse.json({ success: false, error: 'Missing action' }, { status: 400 });
  }

  let sql;
  try {
    sql = await getDbReady();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `DB unavailable: ${msg}` }, { status: 500 });
  }

  // ── fix-one ────────────────────────────────────────────────────────────────
  if (action === 'fix-one') {
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }

    // Load the project and its survey_meta
    const rows = await sql`
      SELECT id, user_id, name, address, origin,
             survey_meta->>'solarpro_user_id' AS claimed_user_id
        FROM projects
       WHERE id = ${projectId}
         AND deleted_at IS NULL
       LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const project = rows[0];
    const claimedUserId = project.claimed_user_id as string | null;

    if (!claimedUserId) {
      return NextResponse.json({
        success: false,
        error: 'Project has no survey_meta.solarpro_user_id claim — cannot determine correct owner.',
        projectId,
        currentOwnerId: project.user_id,
      }, { status: 422 });
    }

    // Verify the claimed user exists
    const userRows = await sql`
      SELECT id, email, name FROM users WHERE id = ${claimedUserId} LIMIT 1
    `;

    if (userRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `solarpro_user_id ${claimedUserId} does not exist in users table`,
        projectId,
        claimedUserId,
        currentOwnerId: project.user_id,
      }, { status: 422 });
    }

    const targetUser = userRows[0];

    if (project.user_id === claimedUserId) {
      return NextResponse.json({
        success: true,
        alreadyCorrect: true,
        projectId,
        ownerId: claimedUserId,
        ownerEmail: targetUser.email,
        message: 'Project already owned by the correct user.',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        projectId,
        currentOwnerId: project.user_id,
        targetOwnerId: claimedUserId,
        targetOwnerEmail: targetUser.email,
        projectName: project.name,
        message: 'Dry run — no changes made.',
      });
    }

    // Reassign
    await sql`
      UPDATE projects
         SET user_id    = ${claimedUserId},
             updated_at = now(),
             survey_meta = COALESCE(survey_meta, '{}'::jsonb) ||
               ${JSON.stringify({ owner_source: 'claim', owner_fixed_by_admin: true, owner_fixed_at: new Date().toISOString() })}::jsonb
       WHERE id = ${projectId}
    `;

    console.log(
      `[SURVEY REASSIGN] admin=${admin.email ?? 'admin'} projectId=${projectId} ` +
      `from=${project.user_id} to=${claimedUserId} (${targetUser.email})`,
    );

    return NextResponse.json({
      success: true,
      projectId,
      previousOwnerId: project.user_id,
      newOwnerId: claimedUserId,
      newOwnerEmail: targetUser.email,
      newOwnerName: targetUser.name,
      projectName: project.name,
      message: `Project reassigned to ${targetUser.email}`,
    });
  }

  // ── fix-all-defaults ────────────────────────────────────────────────────────
  if (action === 'fix-all-defaults') {
    const defaultOwnerId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim();
    if (!defaultOwnerId) {
      return NextResponse.json({
        success: false,
        error: 'SURVEY_INGEST_DEFAULT_USER_ID env var is not set — cannot identify default-owned surveys',
      }, { status: 500 });
    }

    // Find all survey projects owned by the default user.
    // Match to a SolarPro user via:
    //   1. survey_meta.solarpro_user_id (UUID) — works for surveys submitted via handoff JWT
    //   2. survey_meta.solarpro_email — fallback for surveys where partner used their own user IDs
    const candidates = await sql`
      SELECT p.id          AS project_id,
             p.name,
             p.address,
             p.user_id     AS current_owner_id,
             p.survey_meta->>'solarpro_user_id'    AS claimed_user_id,
             p.survey_meta->>'solarpro_email'       AS claimed_email,
             uid_user.id    AS uid_match_id,
             uid_user.email AS uid_match_email,
             uid_user.name  AS uid_match_name,
             email_user.id    AS email_match_id,
             email_user.email AS email_match_email,
             email_user.name  AS email_match_name
        FROM projects p
        LEFT JOIN users uid_user
               ON uid_user.id = (p.survey_meta->>'solarpro_user_id')
        LEFT JOIN users email_user
               ON LOWER(email_user.email) = LOWER(p.survey_meta->>'solarpro_email')
       WHERE p.user_id  = ${defaultOwnerId}
         AND p.origin   = 'survey'
         AND p.deleted_at IS NULL
         AND (
           uid_user.id IS NOT NULL
           OR email_user.id IS NOT NULL
         )
    `;

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        skipped: 0,
        total: 0,
        message: 'No misowned survey projects found with resolvable owners. ' +
                 'Either all surveys are correctly assigned, or the solarpro_user_id / ' +
                 'solarpro_email claims do not match any SolarPro users. ' +
                 'Use "✎ Reassign to Email…" on individual cards to fix manually.',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldFix: candidates.length,
        candidates: candidates.map((c: Record<string, unknown>) => ({
          projectId:        c.project_id,
          projectName:      c.name,
          currentOwnerId:   c.current_owner_id,
          targetOwnerId:    c.claimed_user_id,
          targetOwnerEmail: c.claimed_user_email,
        })),
        message: `Dry run — would reassign ${candidates.length} survey project(s).`,
      });
    }

    // Bulk reassign — prefer uid match, fall back to email match
    let fixed = 0;
    const errors: string[] = [];

    for (const c of candidates as Record<string, unknown>[]) {
      // Prefer UUID match (most authoritative), fall back to email match
      const targetId    = (c.uid_match_id    ?? c.email_match_id)    as string | null;
      const targetEmail = (c.uid_match_email ?? c.email_match_email) as string | null;
      const matchMethod = c.uid_match_id ? 'uid' : 'email';

      if (!targetId) continue; // safety — shouldn't happen given the WHERE clause above

      try {
        await sql`
          UPDATE projects
             SET user_id    = ${targetId},
                 updated_at = now(),
                 survey_meta = COALESCE(survey_meta, '{}'::jsonb) ||
                   ${JSON.stringify({
                     owner_source:         'claim',
                     owner_fixed_by_admin: true,
                     owner_fix_method:     `fix_all_defaults_${matchMethod}`,
                     owner_fixed_at:       new Date().toISOString(),
                   })}::jsonb
           WHERE id = ${c.project_id as string}
             AND user_id = ${defaultOwnerId}
        `;
        console.log(
          `[SURVEY REASSIGN BULK] admin=${admin.email ?? 'admin'} projectId=${c.project_id} ` +
          `from=${c.current_owner_id} to=${targetId} (${targetEmail}) via=${matchMethod}`,
        );
        fixed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.project_id}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      fixed,
      total: candidates.length,
      skipped: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Reassigned ${fixed} of ${candidates.length} survey project(s) to their correct owners.`,
    });
  }

  // ── fix-from-webhook-log ────────────────────────────────────────────────────
  // Backfills survey_meta.solarpro_user_id from webhook_deliveries.raw_body
  // for projects that were ingested before the F-06 pipeline fix.
  //
  // Workflow:
  //   1. Find survey projects that have owner_source='default' in survey_meta
  //      (or no owner_source at all) — these are misowned candidates.
  //   2. For each, look up the most recent webhook_deliveries row (by project_id)
  //      and parse raw_body for solarpro_user_id.
  //   3. If found and valid, patch survey_meta and (if dryRun=false) reassign.
  //
  if (action === 'fix-from-webhook-log') {
    const defaultOwnerId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim();

    // Find all survey projects currently owned by default user
    // OR that have owner_source='default' in survey_meta (belt + suspenders)
    const misownedQuery = defaultOwnerId
      ? await sql`
          SELECT p.id AS project_id, p.name, p.user_id AS current_owner_id,
                 p.survey_meta
            FROM projects p
           WHERE p.origin = 'survey'
             AND (p.user_id = ${defaultOwnerId}
                  OR p.survey_meta->>'owner_source' = 'default')
             AND (p.survey_meta->>'solarpro_user_id' IS NULL
                  OR p.survey_meta->>'solarpro_user_id' = '')
             AND p.deleted_at IS NULL
        `
      : await sql`
          SELECT p.id AS project_id, p.name, p.user_id AS current_owner_id,
                 p.survey_meta
            FROM projects p
           WHERE p.origin = 'survey'
             AND p.survey_meta->>'owner_source' = 'default'
             AND (p.survey_meta->>'solarpro_user_id' IS NULL
                  OR p.survey_meta->>'solarpro_user_id' = '')
             AND p.deleted_at IS NULL
        `;

    if (misownedQuery.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        message: 'No misowned surveys missing solarpro_user_id found.',
      });
    }

    const projectIds = misownedQuery.map((r: Record<string, unknown>) => r.project_id as string);

    // Fetch most recent webhook delivery for each project
    const deliveries = await sql`
      SELECT DISTINCT ON (project_id)
             project_id, raw_body, received_at
        FROM webhook_deliveries
       WHERE project_id = ANY(${projectIds})
         AND raw_body IS NOT NULL
         AND status IN ('ingested', 'verified', 'replayed')
       ORDER BY project_id, received_at DESC
    `;

    // Build a map: project_id → { uid, email } from raw_body
    const claimMap = new Map<string, { uid: string | null; email: string | null }>();
    for (const d of deliveries as Record<string, unknown>[]) {
      try {
        const body = JSON.parse(d.raw_body as string) as Record<string, unknown>;
        const uid   = (body.solarpro_user_id as string | null | undefined)?.trim() ?? null;
        const email = (body.solarpro_email   as string | null | undefined)?.trim().toLowerCase() ?? null;
        // Store if we have at least a valid UUID or an email
        if ((uid && isValidUUID(uid)) || email) {
          claimMap.set(d.project_id as string, {
            uid:   uid && isValidUUID(uid) ? uid : null,
            email: email || null,
          });
        }
      } catch {
        // malformed raw_body — skip
      }
    }

    if (claimMap.size === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        scanned: misownedQuery.length,
        message:
          'Scanned webhook_deliveries for all misowned surveys but found no ' +
          'solarpro_user_id or solarpro_email claims in any raw_body. ' +
          'Use "✎ Reassign to Email…" on individual cards to fix manually.',
      });
    }

    // Validate: try UUID match first, then email match
    const claimedIds    = Array.from(claimMap.values()).map(c => c.uid).filter(Boolean) as string[];
    const claimedEmails = Array.from(claimMap.values()).map(c => c.email).filter(Boolean) as string[];

    const uidUsers = claimedIds.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE id = ANY(${claimedIds})`
      : [];
    const emailUsers = claimedEmails.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE LOWER(email) = ANY(${claimedEmails})`
      : [];

    const userByUid   = new Map<string, { id: string; email: string; name: string }>();
    const userByEmail = new Map<string, { id: string; email: string; name: string }>();
    for (const u of uidUsers   as Record<string, unknown>[]) {
      userByUid.set(u.id as string, { id: u.id as string, email: u.email as string, name: u.name as string });
    }
    for (const u of emailUsers as Record<string, unknown>[]) {
      userByEmail.set((u.email as string).toLowerCase(), { id: u.id as string, email: u.email as string, name: u.name as string });
    }

    const candidates: Array<{
      projectId: string; projectName: string;
      currentOwnerId: string; targetOwnerId: string; targetOwnerEmail: string; matchMethod: string;
    }> = [];

    for (const [pid, claim] of claimMap) {
      // Prefer UUID match, fall back to email match
      const match = (claim.uid ? userByUid.get(claim.uid) : null)
                 ?? (claim.email ? userByEmail.get(claim.email) : null);
      if (!match) continue; // neither matched a SolarPro user
      const proj = (misownedQuery as Record<string, unknown>[]).find(r => r.project_id === pid);
      if (!proj) continue;
      candidates.push({
        projectId:        pid,
        projectName:      proj.name as string,
        currentOwnerId:   proj.current_owner_id as string,
        targetOwnerId:    match.id,
        targetOwnerEmail: match.email,
        matchMethod:      claim.uid && userByUid.has(claim.uid) ? 'uid' : 'email',
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        scanned: misownedQuery.length,
        claimsFound: claimMap.size,
        message:
          'Found claims in webhook log but none matched valid SolarPro users. ' +
          'The partner may be using their own user IDs (not SolarPro IDs). ' +
          'Use "✎ Reassign to Email…" on individual cards to fix manually.',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldFix: candidates.length,
        candidates,
        message: `Dry run — would reassign ${candidates.length} survey project(s) from webhook log claims.`,
      });
    }

    let fixed = 0;
    const errors: string[] = [];
    for (const c of candidates) {
      try {
        await sql`
          UPDATE projects
             SET user_id    = ${c.targetOwnerId},
                 updated_at = now(),
                 survey_meta = COALESCE(survey_meta, '{}'::jsonb) ||
                   ${JSON.stringify({
                     solarpro_user_id:     c.targetOwnerId,
                     owner_source:         'claim',
                     owner_fixed_by_admin: true,
                     owner_fix_method:     `webhook_log_backfill_${c.matchMethod}`,
                     owner_fixed_at:       new Date().toISOString(),
                   })}::jsonb
           WHERE id = ${c.projectId}
        `;
        console.log(
          `[SURVEY REASSIGN WEBHOOK] admin=${admin.email ?? 'admin'} ` +
          `projectId=${c.projectId} from=${c.currentOwnerId} to=${c.targetOwnerId} (${c.targetOwnerEmail}) via=${c.matchMethod}`,
        );
        fixed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.projectId}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      fixed,
      total: candidates.length,
      skipped: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Backfilled + reassigned ${fixed} of ${candidates.length} survey project(s) from webhook delivery log.`,
    });
  }

  // ── reassign-to-email ───────────────────────────────────────────────────────
  // Manually reassign a single project to a user identified by email address.
  // Used by the admin UI when no solarpro_user_id claim is available.
  //
  // Requires: { action, projectId, targetEmail }
  //
  if (action === 'reassign-to-email') {
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }
    const targetEmail = (body as { targetEmail?: string }).targetEmail?.trim().toLowerCase();
    if (!targetEmail) {
      return NextResponse.json({ success: false, error: 'Missing targetEmail' }, { status: 400 });
    }

    // Look up user by email
    const userRows = await sql`
      SELECT id, email, name FROM users WHERE LOWER(email) = ${targetEmail} LIMIT 1
    `;
    if (userRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No SolarPro user found with email: ${targetEmail}`,
      }, { status: 422 });
    }
    const targetUser = userRows[0];

    // Load the project
    const projRows = await sql`
      SELECT id, user_id, name FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1
    `;
    if (projRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    const proj = projRows[0];

    if (proj.user_id === targetUser.id) {
      return NextResponse.json({
        success: true,
        alreadyCorrect: true,
        message: `Project already owned by ${targetUser.email}`,
      });
    }

    await sql`
      UPDATE projects
         SET user_id    = ${targetUser.id as string},
             updated_at = now(),
             survey_meta = COALESCE(survey_meta, '{}'::jsonb) ||
               ${JSON.stringify({
                 owner_source:         'manual_admin',
                 owner_fixed_by_admin: true,
                 owner_fix_method:     'reassign_to_email',
                 owner_fixed_at:       new Date().toISOString(),
               })}::jsonb
       WHERE id = ${projectId}
    `;

    console.log(
      `[SURVEY REASSIGN EMAIL] admin=${admin.email ?? 'admin'} projectId=${projectId} ` +
      `from=${proj.user_id} to=${targetUser.id} (${targetUser.email})`,
    );

    return NextResponse.json({
      success: true,
      projectId,
      previousOwnerId: proj.user_id,
      newOwnerId:      targetUser.id,
      newOwnerEmail:   targetUser.email,
      newOwnerName:    targetUser.name,
      projectName:     proj.name,
      message:         `Project reassigned to ${targetUser.email}`,
    });
  }

  return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
}