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
import { generateTasksForStage } from '@/lib/operations/generateTasksForStage';
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

    // Verify project belongs to user
    const existing = await sql`
      SELECT id, user_id FROM projects WHERE id = ${projectId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    if (existing[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    // Map the pipeline stage back to a legacy status value so the legacy
    // `status` column stays in sync with `project_status` (rowToProject and
    // older list/detail views still read `status`).
    const STAGE_TO_LEGACY: Record<string, string> = {
      lead: 'lead',
      site_assessment: 'design',
      design_complete: 'design',
      proposal_sent: 'proposal',
      contract_signed: 'approved',
      engineering: 'approved',
      permit_submitted: 'approved',
      permit_approved: 'approved',
      install_scheduled: 'approved',
      installation: 'approved',
      inspection: 'approved',
      pto: 'approved',
      complete: 'installed',
    };
    const legacyStatus = STAGE_TO_LEGACY[status] || 'lead';

    // Update project status — try operations column first, fall back to legacy status.
    // BUGFIX: also write the legacy `status` column so it never goes stale.
    let usedOpsColumn = false;
    try {
      if (status === 'contract_signed') {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              status = ${legacyStatus},
              contract_signed_at = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      } else if (status === 'complete') {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              status = ${legacyStatus},
              actual_completion = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      } else {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              status = ${legacyStatus},
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      }
      usedOpsColumn = true;
    } catch (opsErr) {
      // project_status column doesn't exist — update legacy status field instead
      console.warn('[update-status] project_status column missing, using legacy status:', opsErr);
      await sql`
        UPDATE projects
        SET status = ${legacyStatus},
            updated_at = NOW()
        WHERE id = ${projectId}
      `;
    }

    // Auto-generate tasks for the new stage (non-fatal)
    let tasksGenerated = 0;
    try {
      const taskResult = await generateTasksForStage(projectId, status as PipelineStage);
      tasksGenerated = taskResult.inserted;
    } catch (taskErr) {
      console.warn('[update-status] task generation failed:', taskErr);
    }

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
      data: { project, tasksGenerated },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/update-status]', error);
  }
}