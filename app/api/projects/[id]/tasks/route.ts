/**
 * /api/projects/[id]/tasks
 * 
 * GET  — Fetch all tasks for a project
 * PATCH — Update a task (complete/uncomplete)
 * 
 * v47.350: Operations Pipeline
 * v47.350-h: Hardened — standardized { success, data } response
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const projectId = params.id;
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing project id' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership
    const project = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const tasks = await sql`
      SELECT id, project_id, title, description, status, stage, created_at, completed_at
      FROM project_tasks
      WHERE project_id = ${projectId}
      ORDER BY stage ASC, created_at ASC
    `;

    const total = tasks.length;
    const completed = tasks.filter((t: any) => t.status === 'completed').length;

    return NextResponse.json({
      success: true,
      data: {
        tasks: tasks || [],
        stats: { total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 },
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/tasks]', error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const projectId = params.id;
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing project id' }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const taskId = body?.taskId;
    const status = body?.status;

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid field: taskId' },
        { status: 400 }
      );
    }

    // SECURITY: UUID validation for taskId
    if (!isValidUUID(taskId)) {
      return NextResponse.json({ success: false, error: 'Invalid taskId format.' }, { status: 400 });
    }

    if (status !== 'pending' && status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Status must be "pending" or "completed"' },
        { status: 400 }
      );
    }

    const sql = await getDbReady();

    // Verify project ownership
    const project = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Update task
    if (status === 'completed') {
      await sql`
        UPDATE project_tasks
        SET status = 'completed', completed_at = NOW()
        WHERE id = ${taskId} AND project_id = ${projectId}
      `;
    } else {
      await sql`
        UPDATE project_tasks
        SET status = 'pending', completed_at = NULL
        WHERE id = ${taskId} AND project_id = ${projectId}
      `;
    }

    // Return updated task list + completion stats
    const tasks = await sql`
      SELECT id, project_id, title, description, status, stage, created_at, completed_at
      FROM project_tasks
      WHERE project_id = ${projectId}
      ORDER BY stage ASC, created_at ASC
    `;

    const total = tasks.length;
    const completed_count = tasks.filter((t: any) => t.status === 'completed').length;

    return NextResponse.json({
      success: true,
      data: {
        tasks: tasks || [],
        stats: { total, completed: completed_count, percent: total > 0 ? Math.round((completed_count / total) * 100) : 0 },
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/projects/[id]/tasks]', error);
  }
}