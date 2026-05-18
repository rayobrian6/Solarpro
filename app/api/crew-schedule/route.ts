/**
 * GET /api/crew-schedule
 *
 * Returns all project installs for the authenticated user that have both
 * an install_date and a crew_assigned value, for a given date range.
 *
 * Query params:
 *   from  — ISO date string, start of range (inclusive), defaults to today - 7d
 *   to    — ISO date string, end of range (inclusive), defaults to today + 60d
 *
 * Response:
 *   { events: ScheduleEvent[] }
 *
 * ScheduleEvent:
 *   { id, projectId, projectName, address, crewAssigned, installDate, systemSizeKw, status }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/** Validate that a string is a valid ISO date (YYYY-MM-DD) */
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawFrom = searchParams.get('from') ?? '';
    const rawTo   = searchParams.get('to')   ?? '';

    // Default: 7 days in the past through 60 days in the future
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 7);
    const defaultTo = new Date(now);
    defaultTo.setDate(defaultTo.getDate() + 60);

    const fromStr = isIsoDate(rawFrom) ? rawFrom : defaultFrom.toISOString().slice(0, 10);
    const toStr   = isIsoDate(rawTo)   ? rawTo   : defaultTo.toISOString().slice(0, 10);

    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id,
        name          AS project_name,
        address,
        crew_assigned,
        install_date,
        system_size_kw,
        project_status
      FROM projects
      WHERE user_id       = ${user.id}
        AND deleted_at    IS NULL
        AND install_date  IS NOT NULL
        AND crew_assigned IS NOT NULL
        AND install_date BETWEEN ${fromStr}::date AND ${toStr}::date
      ORDER BY install_date ASC, crew_assigned ASC
    `;

    const events = rows.map((r: any) => ({
      id:            r.id,
      projectId:     r.id,
      projectName:   r.project_name ?? 'Unnamed project',
      address:       r.address ?? '',
      crewAssigned:  r.crew_assigned,
      // Normalise to YYYY-MM-DD string regardless of DB type
      installDate:   typeof r.install_date === 'string'
                       ? r.install_date.slice(0, 10)
                       : r.install_date instanceof Date
                         ? r.install_date.toISOString().slice(0, 10)
                         : null,
      systemSizeKw:  r.system_size_kw ?? null,
      status:        r.project_status ?? 'lead',
    }));

    return NextResponse.json({ events });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/crew-schedule]', err);
  }
}
