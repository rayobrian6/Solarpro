export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/**
 * GET /api/activity — Get recent activity log
 * Query params: ?project_id=uuid&limit=30
 */
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const projectId = req.nextUrl.searchParams.get('project_id');
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '30', 10), 100);

    if (projectId && !isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project_id format.' }, { status: 400 });
    }

    const sql = await getDbReady();

    const rows = projectId
      ? await sql`
          SELECT a.id, a.project_id, a.type, a.title, a.details, a.metadata, a.created_at,
                 p.name AS project_name
          FROM project_activity a
          JOIN projects p ON p.id = a.project_id
          WHERE a.user_id = ${user.id} AND a.project_id = ${projectId}
          ORDER BY a.created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT a.id, a.project_id, a.type, a.title, a.details, a.metadata, a.created_at,
                 p.name AS project_name
          FROM project_activity a
          JOIN projects p ON p.id = a.project_id
          WHERE a.user_id = ${user.id}
          ORDER BY a.created_at DESC
          LIMIT ${limit}
        `;

    return NextResponse.json({ activity: rows });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/activity]', error);
  }
}

/**
 * POST /api/activity — Log an activity
 * Body: { project_id, type, title, details?, metadata? }
 */
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('activity', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { project_id, type, title, details, metadata } = body;

    if (!project_id || !type || !title) {
      return NextResponse.json({ error: 'project_id, type, and title are required' }, { status: 400 });
    }
    if (!isValidUUID(project_id)) {
      return NextResponse.json({ error: 'Invalid project_id format.' }, { status: 400 });
    }

    // SECURITY: field length caps
    if (typeof type    === 'string' && type.length    > 50)   return NextResponse.json({ error: 'type too long.'    }, { status: 400 });
    if (typeof title   === 'string' && title.length   > 500)  return NextResponse.json({ error: 'title too long.'   }, { status: 400 });
    if (typeof details === 'string' && details.length > 2000) return NextResponse.json({ error: 'details too long.' }, { status: 400 });

    const sql = await getDbReady();

    const [row] = await sql`
      INSERT INTO project_activity
        (project_id, user_id, type, title, details, metadata)
      VALUES
        (${project_id}, ${user.id}, ${type}, ${title},
         ${details || null}, ${metadata ? JSON.stringify(metadata) : null})
      RETURNING *
    `;

    return NextResponse.json({ activity: row }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/activity]', error);
  }
}