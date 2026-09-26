/**
 * POST /api/projects/update-status
 * 
 * Updates a project's pipeline status and triggers task auto-generation.
 * v47.350: Operations Pipeline
 * v47.350-h: Hardened — standardized response shape
 * v47.351: Fixed getDbReady + column existence fallback
 * 
 * Body: { projectId: string, status: PipelineStage }
 * Response: { success: true, data: { project, tasksGenerated } }
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { isValidStage, type PipelineStage } from '@/lib/operations/pipeline';
// 🚨 The columns, the AUDIT ROW and the task generation are one operation now.
// They were three things five callers each had to remember, and four of the five
// forgot the audit row. See lib/operations/stageChange.ts.
import { applyStageChange } from '@/lib/operations/stageChange';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
// 🚨 The customer-facing half of a stage change. See the block that calls these:
// they used to be reachable ONLY from a route with no UI callers.
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const projectId = body?.projectId;
    const status = body?.status;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: projectId' },
        { status: 400 }
      );
    }

    // SECURITY: UUID validation for projectId
    const { isValidUUID } = await import('@/lib/db-neon');
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid projectId format.' }, { status: 400 });
    }

    if (!status || typeof status !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: status' },
        { status: 400 }
      );
    }

    if (!isValidStage(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid pipeline stage: ${status}` },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // Verify project belongs to user.
    //
    // ══ 🚨 THE STAGE IT IS LEAVING IS READ HERE, AND PASSED ON ════════════════
    //
    // This SELECT already had to happen for the ownership check, and it is the
    // only place in the request that can observe the stage the project is in
    // BEFORE the update. So it reads it, and hands it to the writer.
    //
    // The alternative — each caller telling the audit trail where the project
    // came from — is what shipped, and it produced a fabricated `from_stage`:
    // `components/commands/EngineeringReviewModal.tsx` logged the literal
    // `'contract_signed'` for every move into engineering, whatever stage the
    // project was actually in. A `from_stage` that is asserted rather than
    // observed is worse than an absent one, because it reads as evidence.
    //
    // `project_status` may not exist on a database built from the scanned
    // migration set (it is created only by the locked inline DDL in
    // app/api/migrate/route.ts), so the read degrades to the legacy column.
    let existing: Record<string, unknown>[];
    try {
      existing = await sql`
        SELECT id, user_id, status, project_status FROM projects WHERE id = ${projectId}
      `;
    } catch {
      existing = await sql`
        SELECT id, user_id, status FROM projects WHERE id = ${projectId}
      `;
    }
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    if (existing[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    const prevStage = String(existing[0].project_status || existing[0].status || 'lead');

    // ══ 🚨 COLUMNS + AUDIT ROW + TASKS, IN ONE WRITER ═════════════════════════
    //
    // This route used to inline the column writes, carry its own second copy of
    // the stage→legacy-status table, generate the tasks — and write NO activity
    // row at all. The admin project timeline therefore showed nothing for the
    // majority of stage transitions in the product, because four of the five
    // surfaces that call this route wrote no row of their own either.
    //
    // `applyStageChange` is the one writer. Its `milestones` metadata carries the
    // modal's contextual toggles, which this route previously accepted and
    // discarded.
    const applied = await applyStageChange({
      projectId,
      toStage: status as PipelineStage,
      userId: user.id ?? null,
      source: 'update-status',
      prevStage,
      extraMetadata: Array.isArray(body?.milestones) && body.milestones.length > 0
        ? { milestones: body.milestones.filter((m: unknown) => typeof m === 'string').slice(0, 20) }
        : undefined,
    });
    const tasksGenerated = applied.tasksGenerated;

    // ══ 🚨 THE CUSTOMER-FACING STAGE ADVANCES TOO ═════════════════════════════
    //
    // It did not, and that was a whole-pipeline lost handoff. `syncHomeownerStage`
    // and `writeMicroStage` were called from ONE place —
    // `app/api/projects/transition/route.ts`, whose docblock calls itself the
    // authorised path and which has **ZERO UI callers** (verified: the only
    // reference to `projects/transition` anywhere in app/, lib/, components/ or
    // hooks/ is a comment). Every real stage change in the product arrives here,
    // and this route wrote `project_status` and the legacy `status` and stopped.
    //
    // So an operator moved a job to `permit_submitted` and the homeowner's portal
    // — which renders `homeowner_stage` and the `project_micro_stages` log, and
    // deliberately never reads `project_status` — went on saying whatever it last
    // said. The internal pipeline and the customer's view of it were two separate
    // stories, and only one of them was being told.
    //
    // BOTH CALLS ARE NON-FATAL, deliberately. `homeowner_stage` and
    // `project_micro_stages` are created only by migrations in the directory the
    // runner does not scan, so on a database built from the scanned set these
    // tables may not exist at all. `writeMicroStage` already swallows and logs;
    // `syncHomeownerStage` is wrapped here the same way the transition route
    // wraps it. A stage change must never fail because the customer view could
    // not be updated — but it must also never silently skip trying, which is
    // what it did before.
    try {
      await syncHomeownerStage(projectId, status, user.id ?? null);
    } catch {
      // Non-fatal — handled inside syncHomeownerStage.
    }
    const mappedMicro = microStageForPipelineStage(status);
    if (mappedMicro) {
      await writeMicroStage(projectId, mappedMicro, user.id ?? null, {
        source: 'update-status',
        to_stage: status,
      });
    }

    // Fetch updated project — try full ops columns, fall back to basic
    let project: any = null;
    try {
      const updated = await sql`
        SELECT id, project_status, contract_signed_at, install_date,
               estimated_completion, actual_completion, crew_assigned,
               labor_hours, labor_cost, material_cost
        FROM projects WHERE id = ${projectId}
      `;
      project = updated[0] || null;
    } catch {
      const updated = await sql`
        SELECT id, status, updated_at FROM projects WHERE id = ${projectId}
      `;
      project = updated[0] || null;
    }

    return NextResponse.json({
      success: true,
      // `prevStage` / `activityId` are reported so a caller can tell a recorded
      // move from an unrecorded one instead of assuming. `activityId: null`
      // means the audit row did not land — see applyStageChange's docblock.
      data: {
        project,
        tasksGenerated,
        prevStage: applied.prevStage,
        newStage: applied.toStage,
        activityId: applied.activityId,
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/update-status]', error);
  }
}