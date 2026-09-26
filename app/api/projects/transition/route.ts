/**
 * POST /api/projects/transition
 *
 * The ONLY authorised path for changing a project's pipeline stage.
 * No UI component may call update-status or updateProject directly
 * for stage changes — all stage mutations go through this endpoint.
 *
 * Request body:
 * {
 *   projectId: string;
 *   action: DealDecisionAction;
 *   notes?: string;        // required for some actions
 *   date?: string;         // ISO date string (e.g. install date)
 * }
 *
 * Response:
 * {
 *   success: true;
 *   data: {
 *     project: { id, project_status, status, updated_at };
 *     transition: TransitionResult;
 *     activityId: string;
 *   }
 * }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import {
  DEAL_TRANSITIONS,
  type DealDecisionAction,
} from '@/lib/deals/transitions';
import { isValidStage } from '@/lib/operations/pipeline';
// 🚨 ONE WRITER. This route used to carry its own copy of the column writes, the
// activity INSERT and the task generation — the same five steps
// `app/api/projects/update-status` carried separately, which is how the two
// drifted apart (only one of them wrote an audit row).
import { applyStageChange } from '@/lib/operations/stageChange';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { syncHomeownerStage } from '@/lib/homeownerStageSync';
import { writeMicroStage } from '@/lib/microStage';
import { microStageForPipelineStage } from '@/lib/operations/pipelineMicroStage';

export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    let body: {
      projectId?: string;
      action?: string;
      notes?: string;
      date?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { projectId, action, notes, date } = body ?? {};

    // ── Validate inputs ────────────────────────────────────────────────────
    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: projectId' },
        { status: 400 }
      );
    }
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid projectId format.' }, { status: 400 });
    }

    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: action' },
        { status: 400 }
      );
    }

    // SECURITY: field length caps + date format validation
    if (typeof notes === 'string' && notes.length > 2000) {
      return NextResponse.json({ success: false, error: 'notes too long (max 2000).' }, { status: 400 });
    }
    if (typeof date === 'string' && date.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'date must be in YYYY-MM-DD format.' }, { status: 400 });
    }

    const transition = DEAL_TRANSITIONS[action as DealDecisionAction];
    if (!transition) {
      return NextResponse.json(
        { success: false, error: `Unknown decision action: ${action}` },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // ── Verify project ownership ───────────────────────────────────────────
    const existing = await sql`
      SELECT id, user_id, name, status, project_status, updated_at
      FROM projects
      WHERE id = ${projectId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    if (existing[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    const prevStage = existing[0].project_status || existing[0].status || 'lead';
    const newStage = transition.newStage;

    if (!isValidStage(newStage)) {
      return NextResponse.json(
        { success: false, error: `Decision '${action}' targets a stage that is not in the pipeline: ${newStage}` },
        { status: 500 },
      );
    }

    // ── Apply the stage change: columns, audit row, tasks ──────────────────
    //
    // 🚨 THROUGH THE SHARED WRITER, not a second copy. This block used to be ~90
    // lines duplicating `app/api/projects/update-status` — the same four UPDATE
    // shapes, the same fallback, the same activity INSERT, the same task call.
    // The duplication is exactly how the two drifted: update-status wrote no
    // activity row at all, and this route (the one with no UI callers) was the
    // only place in the product where a stage change left a trace.
    //
    // The DECISION vocabulary stays here — `DEAL_TRANSITIONS` decides which
    // stage an action means, and its `activityType`/`activityTitle`/`stalls`/
    // `terminal`/`nextAction` travel into the row's metadata. What moved is the
    // WRITING, not the deciding.
    const applied = await applyStageChange({
      projectId,
      toStage: newStage,
      userId: user.id ?? null,
      source: 'transition',
      prevStage,
      notes: notes || null,
      installDate: action === 'schedule_install' && date ? date : null,
      activityType: transition.activityType,
      activityTitle: notes ? `${transition.activityTitle} — ${notes}` : transition.activityTitle,
      extraMetadata: {
        action,
        stalls: transition.stalls ?? false,
        terminal: transition.terminal ?? false,
        next_action: transition.nextAction ?? null,
        ...(date ? { date } : {}),
      },
    });
    const activityId = applied.activityId;

    // The shape this route has always returned.
    let updatedProject: any = null;
    try {
      const [row] = await sql`
        SELECT id, project_status, status, updated_at FROM projects WHERE id = ${projectId}
      `;
      updatedProject = row ?? null;
    } catch {
      const [row] = await sql`
        SELECT id, status, updated_at FROM projects WHERE id = ${projectId}
      `;
      updatedProject = row ?? null;
    }

    // ── Auto-advance homeowner_stage (non-fatal) ──────────────────────
    try {
      await syncHomeownerStage(projectId, newStage, user.id ?? null);
    } catch {
      // Non-fatal — handled inside syncHomeownerStage
    }

    // ── Write micro stage (non-fatal, fire-and-forget) ────────────────────────
    // Maps DEAL_TRANSITIONS newStage values to the corresponding micro stage.
    // Only fires for forward-moving, meaningful pipeline events.
    // The map now lives in lib/operations/pipelineMicroStage.ts, because this
    // route is no longer its only reader: app/api/projects/update-status
    // — the route the UI actually calls — needs the same mapping, and a copied
    // table is how this codebase grew five copies of NEC 310.16. The
    // `inspection` omission and its reasoning travelled with it.
    const mappedMicro = microStageForPipelineStage(newStage);
    if (mappedMicro) {
      await writeMicroStage(projectId, mappedMicro, user.id ?? null, {
        action,
        from_stage: prevStage,
        to_stage: newStage,
      });
    }

    // ── Re-generate commands for this project (non-fatal) ─────────────────
    try {
      await fetch(`${req.nextUrl.origin}/api/commands/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
        body: JSON.stringify({ project_id: projectId }),
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      data: {
        project: updatedProject,
        transition,
        activityId,
        prevStage,
        newStage,
      },
    });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/transition]', error);
  }
}