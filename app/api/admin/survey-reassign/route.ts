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
  // Comprehensive one-pass fix for all surveys owned by the fallback default user.
  // Resolution order per survey (mirrors ownerResolver.ts strategies):
  //   1. survey_meta.solarpro_user_id UUID → users table
  //   2. survey_meta.solarpro_email → users LOWER() match
  //   3. survey_meta.solarpro_project_id → existing project's user_id
  //   4. webhook_deliveries.raw_body claims (backfill for pre-fix surveys):
  //        4a. raw_body.solarpro_user_id UUID → users table
  //        4b. raw_body.solarpro_email → users LOWER() match
  //        4c. raw_body.solarpro_project_id → existing project's user_id
  if (action === 'fix-all-defaults') {
    const defaultOwnerId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim();
    if (!defaultOwnerId) {
      return NextResponse.json({
        success: false,
        error: 'SURVEY_INGEST_DEFAULT_USER_ID env var is not set — cannot identify default-owned surveys',
      }, { status: 500 });
    }

    // Step 1: Load all survey projects currently owned by the fallback default user
    const misowned = await sql`
      SELECT p.id          AS project_id,
             p.name,
             p.address,
             p.user_id     AS current_owner_id,
             p.survey_meta->>'solarpro_user_id'    AS claimed_uid,
             p.survey_meta->>'solarpro_email'       AS claimed_email,
             p.survey_meta->>'solarpro_project_id'  AS claimed_project_id,
             p.survey_external_id
        FROM projects p
       WHERE p.user_id   = ${defaultOwnerId}
         AND p.origin    = 'survey'
         AND p.deleted_at IS NULL
    `;

    if (misowned.length === 0) {
      return NextResponse.json({
        success: true, fixed: 0, skipped: 0, total: 0,
        message: 'No surveys are currently owned by the fallback default user.',
      });
    }

    // Step 2: For surveys that have no claims in survey_meta, try to backfill
    // claims from webhook_deliveries.raw_body (covers pre-fix surveys)
    const missingClaims = (misowned as Record<string,unknown>[]).filter(
      r => !r.claimed_uid && !r.claimed_email && !r.claimed_project_id
    );
    const projectIds = (misowned as Record<string,unknown>[]).map(r => r.project_id as string);

    // Fetch most recent webhook delivery for each misowned project
    const deliveries = missingClaims.length > 0
      ? await sql`
          SELECT DISTINCT ON (project_id)
                 project_id, raw_body
            FROM webhook_deliveries
           WHERE project_id = ANY(${projectIds})
             AND raw_body IS NOT NULL
           ORDER BY project_id, received_at DESC
        `
      : [];

    // Build a map of webhook-sourced claims for projects missing survey_meta claims
    const webhookClaimMap = new Map<string, { uid: string|null; email: string|null; projectId: string|null }>();
    for (const d of deliveries as Record<string,unknown>[]) {
      try {
        const body = JSON.parse(d.raw_body as string) as Record<string,unknown>;
        const uid   = (body.solarpro_user_id    as string|null|undefined)?.trim() || null;
        const email = (body.solarpro_email       as string|null|undefined)?.trim().toLowerCase() || null;
        const pid   = (body.solarpro_project_id  as string|null|undefined)?.trim() || null;
        if (uid || email || pid) {
          webhookClaimMap.set(d.project_id as string, { uid: uid || null, email: email || null, projectId: pid || null });
        }
      } catch { /* malformed raw_body — skip */ }
    }

    // Merge webhook claims into misowned rows for surveys that had no survey_meta claims
    const enrichedMisowned = (misowned as Record<string,unknown>[]).map(r => {
      const wc = webhookClaimMap.get(r.project_id as string);
      return {
        project_id:          r.project_id as string,
        name:                r.name as string,
        current_owner_id:    r.current_owner_id as string,
        claimed_uid:         (r.claimed_uid as string|null) || wc?.uid || null,
        claimed_email:       (r.claimed_email as string|null) || wc?.email || null,
        claimed_project_id:  (r.claimed_project_id as string|null) || wc?.projectId || null,
        claim_source:        (r.claimed_uid || r.claimed_email || r.claimed_project_id) ? 'survey_meta' : (wc ? 'webhook_log' : 'none'),
      };
    });

    // Step 3: Batch-fetch users and projects for all claims
    const allUids       = [...new Set(enrichedMisowned.map(r => r.claimed_uid).filter(Boolean))] as string[];
    const allEmails     = [...new Set(enrichedMisowned.map(r => r.claimed_email?.toLowerCase()).filter(Boolean))] as string[];
    const allProjIds    = [...new Set(enrichedMisowned.map(r => r.claimed_project_id).filter(Boolean))] as string[];

    const uidUserRows = allUids.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE id::text = ANY(${allUids})`
      : [];
    const emailUserRows = allEmails.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE LOWER(email) = ANY(${allEmails})`
      : [];
    const projectOwnerRows = allProjIds.length > 0
      ? await sql`
          SELECT p.id AS project_id, p.user_id, u.email, u.name
            FROM projects p
            JOIN users u ON u.id = p.user_id
           WHERE p.id = ANY(${allProjIds})
             AND p.deleted_at IS NULL
        `
      : [];

    const userByUid       = new Map<string, { id: string; email: string; name: string }>();
    const userByEmail     = new Map<string, { id: string; email: string; name: string }>();
    const userByProjectId = new Map<string, { id: string; email: string; name: string }>();

    for (const u of uidUserRows as Record<string,unknown>[]) {
      userByUid.set(u.id as string, { id: u.id as string, email: u.email as string, name: u.name as string });
    }
    for (const u of emailUserRows as Record<string,unknown>[]) {
      userByEmail.set((u.email as string).toLowerCase(), { id: u.id as string, email: u.email as string, name: u.name as string });
    }
    for (const r of projectOwnerRows as Record<string,unknown>[]) {
      userByProjectId.set(r.project_id as string, { id: r.user_id as string, email: r.email as string, name: r.name as string });
    }

    // Step 4: Resolve each misowned project
    type Candidate = {
      projectId: string; projectName: string; currentOwnerId: string;
      targetOwnerId: string; targetOwnerEmail: string; matchMethod: string; claimSource: string;
    };
    const candidates: Candidate[] = [];

    for (const row of enrichedMisowned) {
      let match: { id: string; email: string; name: string } | undefined;
      let matchMethod = '';

      if (row.claimed_uid) {
        match = userByUid.get(row.claimed_uid);
        if (match) matchMethod = 'uid';
      }
      if (!match && row.claimed_email) {
        match = userByEmail.get(row.claimed_email.toLowerCase());
        if (match) matchMethod = 'email';
      }
      if (!match && row.claimed_project_id) {
        match = userByProjectId.get(row.claimed_project_id);
        if (match) matchMethod = 'project';
      }

      if (!match) continue;

      candidates.push({
        projectId:        row.project_id,
        projectName:      row.name,
        currentOwnerId:   row.current_owner_id,
        targetOwnerId:    match.id,
        targetOwnerEmail: match.email,
        matchMethod,
        claimSource:      row.claim_source,
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0, skipped: 0, total: 0,
        scanned: misowned.length,
        message: 'No misowned surveys could be resolved. ' +
                 'The surveys have no solarpro_user_id, solarpro_email, or solarpro_project_id ' +
                 'in survey_meta or webhook_deliveries. ' +
                 'Use "✎ Reassign to Email…" on individual cards to fix manually.',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true, dryRun: true,
        wouldFix: candidates.length,
        candidates,
        message: `Dry run — would reassign ${candidates.length} survey project(s).`,
      });
    }

    // Step 5: Bulk reassign
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
                     owner_source:         'claim',
                     owner_fixed_by_admin: true,
                     owner_fix_method:     `fix_all_defaults_${c.matchMethod}_from_${c.claimSource}`,
                     owner_fixed_at:       new Date().toISOString(),
                   })}::jsonb
           WHERE id = ${c.projectId}
             AND user_id = ${defaultOwnerId}
        `;
        console.log(
          `[SURVEY REASSIGN BULK] admin=${(admin as {email?:string}).email ?? 'admin'} ` +
          `projectId=${c.projectId} from=${c.currentOwnerId} to=${c.targetOwnerId} ` +
          `(${c.targetOwnerEmail}) via=${c.matchMethod} src=${c.claimSource}`,
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
      scanned: misowned.length,
      skipped: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Reassigned ${fixed} of ${candidates.length} resolvable surveys (scanned ${misowned.length} total).`,
    });
  }

  // ── fix-from-webhook-log ────────────────────────────────────────────────────
  // Backfills ownership for surveys that were ingested before the F-06 pipeline
  // fix and have no claims stored in survey_meta.
  //
  // For each misowned survey, parses webhook_deliveries.raw_body and tries
  // the same 3-strategy chain as ownerResolver.ts:
  //   1. raw_body.solarpro_user_id UUID → users table
  //   2. raw_body.solarpro_email → users LOWER() match
  //   3. raw_body.solarpro_project_id → existing project's user_id
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

    // Build a map: project_id → { uid, email, projectId } from raw_body
    const claimMap = new Map<string, { uid: string | null; email: string | null; projectId: string | null }>();
    for (const d of deliveries as Record<string, unknown>[]) {
      try {
        const body = JSON.parse(d.raw_body as string) as Record<string, unknown>;
        const uid     = (body.solarpro_user_id    as string | null | undefined)?.trim() ?? null;
        const email   = (body.solarpro_email       as string | null | undefined)?.trim().toLowerCase() ?? null;
        const projId  = (body.solarpro_project_id  as string | null | undefined)?.trim() ?? null;
        if ((uid && isValidUUID(uid)) || email || (projId && isValidUUID(projId))) {
          claimMap.set(d.project_id as string, {
            uid:       uid && isValidUUID(uid) ? uid : null,
            email:     email || null,
            projectId: projId && isValidUUID(projId) ? projId : null,
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
          'solarpro_user_id, solarpro_email, or solarpro_project_id claims in any raw_body. ' +
          'Use "✎ Reassign to Email…" on individual cards to fix manually.',
      });
    }

    // Batch-fetch all possible matches
    const claimedIds    = Array.from(claimMap.values()).map(c => c.uid).filter(Boolean) as string[];
    const claimedEmails = Array.from(claimMap.values()).map(c => c.email).filter(Boolean) as string[];
    const claimedProjIds = Array.from(claimMap.values()).map(c => c.projectId).filter(Boolean) as string[];

    const uidUsers = claimedIds.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE id::text = ANY(${claimedIds})`
      : [];
    const emailUsers = claimedEmails.length > 0
      ? await sql`SELECT id, email, name FROM users WHERE LOWER(email) = ANY(${claimedEmails})`
      : [];
    // Strategy 3: look up projects by solarpro_project_id and get their owner
    const projectOwnerRows = claimedProjIds.length > 0
      ? await sql`
          SELECT p.id AS project_id, p.user_id, u.email, u.name
            FROM projects p
            JOIN users u ON u.id = p.user_id
           WHERE p.id = ANY(${claimedProjIds})
             AND p.deleted_at IS NULL
        `
      : [];

    const userByUid       = new Map<string, { id: string; email: string; name: string }>();
    const userByEmail     = new Map<string, { id: string; email: string; name: string }>();
    const userByProjectId = new Map<string, { id: string; email: string; name: string }>();

    for (const u of uidUsers as Record<string, unknown>[]) {
      userByUid.set(u.id as string, { id: u.id as string, email: u.email as string, name: u.name as string });
    }
    for (const u of emailUsers as Record<string, unknown>[]) {
      userByEmail.set((u.email as string).toLowerCase(), { id: u.id as string, email: u.email as string, name: u.name as string });
    }
    for (const r of projectOwnerRows as Record<string, unknown>[]) {
      userByProjectId.set(r.project_id as string, { id: r.user_id as string, email: r.email as string, name: r.name as string });
    }

    const candidates: Array<{
      projectId: string; projectName: string;
      currentOwnerId: string; targetOwnerId: string; targetOwnerEmail: string; matchMethod: string;
    }> = [];

    for (const [pid, claim] of claimMap) {
      // Strategy 1: UUID, 2: email, 3: project
      const match = (claim.uid       ? userByUid.get(claim.uid)                       : null)
                 ?? (claim.email     ? userByEmail.get(claim.email)                    : null)
                 ?? (claim.projectId ? userByProjectId.get(claim.projectId)            : null);
      if (!match) continue;

      const matchMethod = claim.uid && userByUid.has(claim.uid) ? 'uid'
                        : claim.email && userByEmail.has(claim.email) ? 'email'
                        : 'project';

      const proj = (misownedQuery as Record<string, unknown>[]).find(r => r.project_id === pid);
      if (!proj) continue;
      candidates.push({
        projectId:        pid,
        projectName:      proj.name as string,
        currentOwnerId:   proj.current_owner_id as string,
        targetOwnerId:    match.id,
        targetOwnerEmail: match.email,
        matchMethod,
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        scanned: misownedQuery.length,
        claimsFound: claimMap.size,
        message:
          'Found claims in webhook log but none matched valid SolarPro users or projects. ' +
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
          `[SURVEY REASSIGN WEBHOOK] admin=${(admin as {email?:string}).email ?? 'admin'} ` +
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
      scanned: misownedQuery.length,
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

  // ── debug-claims ──────────────────────────────────────────────────────────
  // Returns the raw claims from webhook_deliveries.raw_body for a given project.
  // Used to diagnose why a survey isn't auto-resolving.
  if (action === 'debug-claims') {
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid projectId' }, { status: 400 });
    }

    // Get project details
    const projRows = await sql`
      SELECT id, name, user_id, origin, survey_external_id, survey_meta
        FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1
    `;
    if (projRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    const proj = projRows[0];

    // Get all webhook deliveries for this project
    const deliveries = await sql`
      SELECT id, project_id, raw_body, status, received_at
        FROM webhook_deliveries
       WHERE project_id = ${projectId}
       ORDER BY received_at DESC
       LIMIT 5
    `;

    // Parse claims from each delivery
    const parsed = (deliveries as Record<string,unknown>[]).map(d => {
      let claims: Record<string,unknown> = {};
      try {
        const body = JSON.parse(d.raw_body as string) as Record<string,unknown>;
        // Extract all top-level keys for full diagnostic view
        const allKeys = Object.keys(body);
        const fullBody: Record<string,unknown> = {};
        for (const k of allKeys) {
          // Truncate long values (e.g. photos arrays)
          const v = body[k];
          if (Array.isArray(v)) {
            fullBody[k] = `[Array(${(v as unknown[]).length})]`;
          } else if (typeof v === 'object' && v !== null) {
            fullBody[k] = `[Object(${Object.keys(v as object).length} keys)]`;
          } else {
            fullBody[k] = v ?? null;
          }
        }
        claims = {
          // Key ownership fields first
          solarpro_user_id:    body.solarpro_user_id    ?? null,
          solarpro_email:      body.solarpro_email       ?? null,
          solarpro_project_id: body.solarpro_project_id ?? null,
          // Partner-side fields that might help identify the owner
          project_id:          body.project_id          ?? null,
          project_name:        body.project_name        ?? null,
          site_name:           body.site_name           ?? null,
          inspector_name:      body.inspector_name      ?? null,
          inspector_email:     body.inspector_email     ?? null,
          user_email:          body.user_email          ?? null,
          user_id:             body.user_id             ?? null,
          // All other fields for full diagnosis
          allFields: fullBody,
        };
      } catch { claims = { parseError: 'malformed JSON' }; }
      return {
        deliveryId: d.id,
        status:     d.status,
        receivedAt: d.received_at,
        claims,
      };
    });

    return NextResponse.json({
      success: true,
      project: {
        id:              proj.id,
        name:            proj.name,
        userId:          proj.user_id,
        origin:          proj.origin,
        surveyExternalId: proj.survey_external_id,
        surveyMeta:      proj.survey_meta,
      },
      webhookDeliveries: parsed,
      deliveryCount:     parsed.length,
    });
  }

  return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
}