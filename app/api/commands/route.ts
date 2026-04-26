export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

/**
 * GET /api/commands — List pending commands for current user
 * Query params: ?status=pending|completed&limit=20
 */
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const status = req.nextUrl.searchParams.get('status') || 'pending';
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 100);

    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        a.id, a.project_id, a.title, a.description, a.type,
        a.priority, a.status, a.due_date, a.created_at,
        a.completed_at, a.auto_generated,
        p.name AS project_name,
        p.project_status,
        c.name AS client_name
      FROM command_center_actions a
      JOIN projects p ON p.id = a.project_id
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE a.user_id = ${user.id}
        AND a.status = ${status}
      ORDER BY
        CASE a.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END ASC,
        a.due_date ASC NULLS LAST,
        a.created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({ commands: rows });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/commands]', error);
  }
}

/**
 * POST /api/commands — Create a new command action
 * Body: { project_id, title, description?, type, priority, due_date? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { project_id, title, description, type, priority, due_date } = body;

    if (!project_id || !title || !type) {
      return NextResponse.json({ error: 'project_id, title, and type are required' }, { status: 400 });
    }

    const sql = await getDbReady();

    const [row] = await sql`
      INSERT INTO command_center_actions
        (project_id, user_id, title, description, type, priority, due_date, auto_generated)
      VALUES
        (${project_id}, ${user.id}, ${title}, ${description || null},
         ${type}, ${priority || 'medium'}, ${due_date || null}, false)
      RETURNING *
    `;

    return NextResponse.json({ command: row }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/commands]', error);
  }
}