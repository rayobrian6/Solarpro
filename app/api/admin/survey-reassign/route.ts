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

    // Find all survey projects owned by the default user that have a
    // solarpro_user_id claim pointing to a valid user.
    const candidates = await sql`
      SELECT p.id          AS project_id,
             p.name,
             p.address,
             p.user_id     AS current_owner_id,
             p.survey_meta->>'solarpro_user_id' AS claimed_user_id,
             u.email       AS claimed_user_email,
             u.name        AS claimed_user_name
        FROM projects p
        JOIN users u ON u.id = (p.survey_meta->>'solarpro_user_id')
       WHERE p.user_id  = ${defaultOwnerId}
         AND p.origin   = 'survey'
         AND p.survey_meta->>'solarpro_user_id' IS NOT NULL
         AND p.deleted_at IS NULL
    `;

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: 0,
        skipped: 0,
        message: 'No misowned survey projects found. All surveys are correctly assigned.',
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

    // Bulk reassign
    let fixed = 0;
    const errors: string[] = [];

    for (const c of candidates as Record<string, unknown>[]) {
      try {
        await sql`
          UPDATE projects
             SET user_id    = ${c.claimed_user_id as string},
                 updated_at = now(),
                 survey_meta = COALESCE(survey_meta, '{}'::jsonb) ||
                   ${JSON.stringify({ owner_source: 'claim', owner_fixed_by_admin: true, owner_fixed_at: new Date().toISOString() })}::jsonb
           WHERE id = ${c.project_id as string}
             AND user_id = ${defaultOwnerId}
        `;
        console.log(
          `[SURVEY REASSIGN BULK] admin=${admin.email ?? 'admin'} projectId=${c.project_id} ` +
          `from=${c.current_owner_id} to=${c.claimed_user_id} (${c.claimed_user_email})`,
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
      skipped: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Reassigned ${fixed} of ${candidates.length} survey project(s) to their correct owners.`,
    });
  }

  return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
}