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

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import {
  DEAL_TRANSITIONS,
  stageToSimpleStatus,
  type DealDecisionAction,
} from '@/lib/deals/transitions';
import { isValidStage } from '@/lib/operations/pipeline';
import { generateTasksForStage } from '@/lib/operations/generateTasksForStage';

export async function POST(req: NextRequest) {
  try {
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

    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: action' },
        { status: 400 }
      );
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
    const simpleStatus = stageToSimpleStatus(newStage);

    // ── Apply stage transition ─────────────────────────────────────────────
    // Try full ops columns first; fall back to legacy status only
    let updatedProject: any = null;
    try {
      if (newStage === 'contract_signed') {
        const [row] = await sql`
          UPDATE projects
          SET project_status  = ${newStage},
              status          = ${simpleStatus},
              contract_signed_at = NOW(),
              updated_at      = NOW()
          WHERE id = ${projectId}
          RETURNING id, project_status, status, updated_at
        `;
        updatedProject = row;
      } else if (newStage === 'complete') {
        const [row] = await sql`
          UPDATE projects
          SET project_status  = ${newStage},
              status          = ${simpleStatus},
              actual_completion = NOW(),
              updated_at      = NOW()
          WHERE id = ${projectId}
          RETURNING id, project_status, status, updated_at
        `;
        updatedProject = row;
      } else if (action === 'schedule_install' && date) {
        // Also persist install_date when scheduling
        const [row] = await sql`
          UPDATE projects
          SET project_status  = ${newStage},
              status          = ${simpleStatus},
              install_date    = ${date},
              updated_at      = NOW()
          WHERE id = ${projectId}
          RETURNING id, project_status, status, updated_at
        `;
        updatedProject = row;
      } else {
        const [row] = await sql`
          UPDATE projects
          SET project_status  = ${newStage},
              status          = ${simpleStatus},
              updated_at      = NOW()
          WHERE id = ${projectId}
          RETURNING id, project_status, status, updated_at
        `;
        updatedProject = row;
      }
    } catch (opsErr) {
      // project_status column doesn't exist — update legacy status only
      console.warn('[transition] project_status column missing, using legacy status:', opsErr);
      const [row] = await sql`
        UPDATE projects
        SET status     = ${simpleStatus},
            updated_at = NOW()
        WHERE id = ${projectId}
        RETURNING id, status, updated_at
      `;
      updatedProject = row;
    }

    // ── Log to project_activity ────────────────────────────────────────────
    const activityTitle = notes
      ? `${transition.activityTitle} — ${notes}`
      : transition.activityTitle;

    const activityMetadata = {
      action,
      from_stage: prevStage,
      to_stage: newStage,
      stalls: transition.stalls ?? false,
      terminal: transition.terminal ?? false,
      next_action: transition.nextAction ?? null,
      ...(date ? { date } : {}),
      ...(notes ? { notes } : {}),
    };

    let activityId: string | null = null;
    try {
      const [actRow] = await sql`
        INSERT INTO project_activity
          (project_id, user_id, type, title, details, metadata)
        VALUES
          (${projectId}, ${user.id}, ${transition.activityType},
           ${activityTitle},
           ${notes || null},
           ${JSON.stringify(activityMetadata)})
        RETURNING id
      `;
      activityId = actRow?.id ?? null;
    } catch (logErr) {
      // Activity log failure is non-fatal — transition already persisted
      console.warn('[transition] activity log failed:', logErr);
    }

    // ── Auto-generate tasks for new stage (non-fatal) ──────────────────────
    if (isValidStage(newStage)) {
      try {
        await generateTasksForStage(projectId, newStage);
      } catch (taskErr) {
        console.warn('[transition] task generation failed:', taskErr);
      }
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