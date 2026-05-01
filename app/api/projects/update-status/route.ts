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

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { isValidStage, type PipelineStage } from '@/lib/operations/pipeline';
import { generateTasksForStage } from '@/lib/operations/generateTasksForStage';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

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

    // Update project status — try operations column first, fall back to legacy status
    let usedOpsColumn = false;
    try {
      if (status === 'contract_signed') {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              contract_signed_at = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      } else if (status === 'complete') {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              actual_completion = NOW(),
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      } else {
        await sql`
          UPDATE projects
          SET project_status = ${status},
              updated_at = NOW()
          WHERE id = ${projectId}
        `;
      }
      usedOpsColumn = true;
    } catch (opsErr) {
      // project_status column doesn't exist — update legacy status field instead
      console.warn('[update-status] project_status column missing, using legacy status:', opsErr);
      // Map pipeline stages back to legacy status values
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