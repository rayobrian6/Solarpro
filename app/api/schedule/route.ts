export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/**
 * GET /api/schedule — Get upcoming schedule items
 * Query params: ?days=30&limit=20
 */
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const days = Math.min(parseInt(req.nextUrl.searchParams.get('days') || '30', 10), 90);
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 100);

    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        s.id, s.project_id, s.type, s.date, s.crew_id, s.notes, s.created_at,
        p.name AS project_name,
        c.name AS client_name,
        cr.name AS crew_name,
        cr.color AS crew_color
      FROM project_schedule s
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN crews cr ON cr.id = s.crew_id
      WHERE s.user_id = ${user.id}
        AND s.date >= CURRENT_DATE
        AND s.date <= CURRENT_DATE + ${days}
      ORDER BY s.date ASC, s.created_at ASC
      LIMIT ${limit}
    `;

    return NextResponse.json({ schedule: rows });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/schedule]', error);
  }
}

/**
 * POST /api/schedule — Create a schedule item
 * Body: { project_id, type, date, crew_id?, notes? }
 */
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { project_id, type, date, crew_id, notes } = body;

    if (!project_id || !type || !date) {
      return NextResponse.json({ error: 'project_id, type, and date are required' }, { status: 400 });
    }

    // SECURITY: field length caps + date format validation
    if (typeof type  === 'string' && type.length  > 50)   return NextResponse.json({ error: 'type too long (max 50).'   }, { status: 400 });
    if (typeof notes === 'string' && notes.length > 2000) return NextResponse.json({ error: 'notes too long (max 2000).'}, { status: 400 });
    // SECURITY: date format validation — only allow YYYY-MM-DD to prevent injection
    if (typeof date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be in YYYY-MM-DD format.' }, { status: 400 });
    }

    const sql = await getDbReady();

    const [row] = await sql`
      INSERT INTO project_schedule
        (project_id, user_id, type, date, crew_id, notes)
      VALUES
        (${project_id}, ${user.id}, ${type}, ${date}, ${crew_id || null}, ${notes || null})
      RETURNING *
    `;

    return NextResponse.json({ item: row }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/schedule]', error);
  }
}