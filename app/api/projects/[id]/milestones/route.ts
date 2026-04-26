/**
 * /api/projects/[id]/milestones
 * 
 * GET   — Fetch all milestones for a project
 * POST  — Create a new milestone
 * PATCH — Update a milestone status/date
 * 
 * v47.350: Operations Pipeline
 * v47.350-h: Hardened — standardized { success, data } response
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

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

    const milestones = await sql`
      SELECT id, project_id, name, due_date, status, created_at
      FROM project_milestones
      WHERE project_id = ${projectId}
      ORDER BY due_date ASC NULLS LAST, created_at ASC
    `;

    return NextResponse.json({
      success: true,
      data: {
        milestones: milestones || [],
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/milestones]', error);
  }
}

export async function POST(
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = body?.name;
    const due_date = body?.due_date;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing or invalid field: name' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership
    const project = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const result = await sql`
      INSERT INTO project_milestones (project_id, name, due_date, status)
      VALUES (${projectId}, ${name}, ${due_date || null}, 'pending')
      RETURNING id, project_id, name, due_date, status, created_at
    `;

    return NextResponse.json({
      success: true,
      data: {
        milestone: result[0] || null,
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/[id]/milestones]', error);
  }
}

export async function PATCH(
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const milestoneId = body?.milestoneId;
    const status = body?.status;
    const due_date = body?.due_date;

    if (!milestoneId || typeof milestoneId !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing or invalid field: milestoneId' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership
    const project = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Build update — only update fields that are provided
    if (status && due_date) {
      await sql`
        UPDATE project_milestones
        SET status = ${status}, due_date = ${due_date}
        WHERE id = ${milestoneId} AND project_id = ${projectId}
      `;
    } else if (status) {
      await sql`
        UPDATE project_milestones
        SET status = ${status}
        WHERE id = ${milestoneId} AND project_id = ${projectId}
      `;
    } else if (due_date) {
      await sql`
        UPDATE project_milestones
        SET due_date = ${due_date}
        WHERE id = ${milestoneId} AND project_id = ${projectId}
      `;
    }

    // Return updated milestones list
    const milestones = await sql`
      SELECT id, project_id, name, due_date, status, created_at
      FROM project_milestones
      WHERE project_id = ${projectId}
      ORDER BY due_date ASC NULLS LAST, created_at ASC
    `;

    return NextResponse.json({
      success: true,
      data: {
        milestones: milestones || [],
      },
    });

  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/projects/[id]/milestones]', error);
  }
}