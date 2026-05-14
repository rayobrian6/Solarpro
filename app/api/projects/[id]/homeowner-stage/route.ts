/**
 * GET  /api/projects/[id]/homeowner-stage  — returns current stage for installer's project
 * PATCH /api/projects/[id]/homeowner-stage — set stage; writes history + micro-stage
 *
 * Access: project must belong to the authenticated user (installer).
 * Never called by the portal (portal is read-only; stages advance automatically
 * on share/sign, or manually here by the installer).
 */

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

type HomeownerStage = typeof HOMEOWNER_STAGES[number];

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT homeowner_stage
      FROM   projects
      WHERE  id      = ${projectId}
        AND  user_id = ${user.id}
        AND  deleted_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      stage: (rows[0].homeowner_stage as string | null) ?? null,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/homeowner-stage]', err);
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  let body: { stage?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const stage = body?.stage as HomeownerStage | undefined;
  if (!stage || !(HOMEOWNER_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json(
      { success: false, error: `Invalid stage. Must be one of: ${HOMEOWNER_STAGES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const sql = await getDbReady();

    // Verify project belongs to this user
    const rows = await sql`
      SELECT id, homeowner_stage
      FROM projects
      WHERE id = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    const previousStage = rows[0].homeowner_stage as string | null;

    // Update homeowner_stage
    await sql`
      UPDATE projects
      SET homeowner_stage = ${stage},
          updated_at      = NOW()
      WHERE id = ${projectId}
        AND user_id = ${user.id}
    `;

    // Write stage history row
    try {
      await sql`
        INSERT INTO project_homeowner_stage_history (project_id, stage, changed_by, note)
        VALUES (${projectId}, ${stage}, ${user.id}, ${body.note ?? null})
      `;
    } catch {
      // Table may not exist — non-fatal
    }

    // Write micro-stage event (stage_advanced for generic stage changes)
    // Also write specific milestone micro-stages for meaningful transitions
    const STAGE_MICRO_MAP: Partial<Record<HomeownerStage, string>> = {
      proposal:      'proposal_sent',
      installation:  'contract_signed',
      completed:     'installation_complete',
    };
    const microKey = STAGE_MICRO_MAP[stage];
    if (microKey) {
      try {
        await sql`
          INSERT INTO project_micro_stages (project_id, micro_stage)
          VALUES (${projectId}, ${microKey})
          ON CONFLICT (project_id, micro_stage) DO UPDATE SET created_at = NOW()
        `;
      } catch {
        // Non-fatal
      }
    }

    console.log(
      '[homeowner-stage] project=%s user=%s %s → %s',
      projectId, user.id, previousStage ?? 'null', stage
    );

    return NextResponse.json({
      success:       true,
      stage,
      previousStage: previousStage ?? null,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/projects/[id]/homeowner-stage]', err);
  }
}
