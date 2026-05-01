/**
 * /api/projects/[id]/operations
 * 
 * GET   — Fetch operations data (status, scheduling, costs)
 * PATCH — Update operations fields (install_date, crew, costs, etc.)
 * 
 * v47.350: Operations Pipeline
 * v47.350-h: Hardened — standardized { success, data } response, input validation
 * v47.351: Fixed getDbReady + column existence fallback
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID} from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/** Safely run a SQL statement, returning false if it fails (e.g. missing column) */
async function safeExec(sql: any, query: Promise<any>): Promise<boolean> {
  try { await query; return true; } catch { return false; }
}

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
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing project id' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Try full query with operations columns
    try {
      const rows = await sql`
        SELECT id, name, address, system_size_kw, client_id,
               project_status, contract_signed_at, install_date,
               estimated_completion, actual_completion, crew_assigned,
               labor_hours, labor_cost, material_cost
        FROM projects
        WHERE id = ${projectId} AND user_id = ${user.id}
      `;

      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      }

      const row = rows[0];
      const operations = {
        ...row,
        project_status: row.project_status || 'lead',
        labor_hours: Number(row.labor_hours) || 0,
        labor_cost: Number(row.labor_cost) || 0,
        material_cost: Number(row.material_cost) || 0,
      };

      return NextResponse.json({ success: true, data: { operations } });
    } catch (fullErr) {
      // Fallback: operations columns may not exist
      const rows = await sql`
        SELECT id, name, address, system_size_kw, status
        FROM projects
        WHERE id = ${projectId} AND user_id = ${user.id}
      `;
      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        data: {
          operations: {
            ...rows[0],
            project_status: rows[0].status || 'lead',
            labor_hours: 0, labor_cost: 0, material_cost: 0,
          },
        },
      });
    }

  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/operations]', error);
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
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Missing project id' }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Request body must be an object' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership
    const project = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const {
      install_date,
      estimated_completion,
      crew_assigned,
      labor_hours,
      labor_cost,
      material_cost,
    } = body;

    // Each update is wrapped in try/catch — if the column doesn't exist, skip it
    const results: string[] = [];

    if (install_date !== undefined) {
      try {
        await sql`UPDATE projects SET install_date = ${install_date || null} WHERE id = ${projectId}`;
        results.push('install_date');
      } catch (e) { console.warn('[ops PATCH] install_date column missing:', e); }
    }
    if (estimated_completion !== undefined) {
      try {
        await sql`UPDATE projects SET estimated_completion = ${estimated_completion || null} WHERE id = ${projectId}`;
        results.push('estimated_completion');
      } catch (e) { console.warn('[ops PATCH] estimated_completion column missing:', e); }
    }
    if (crew_assigned !== undefined) {
      try {
        await sql`UPDATE projects SET crew_assigned = ${crew_assigned || null} WHERE id = ${projectId}`;
        results.push('crew_assigned');
      } catch (e) { console.warn('[ops PATCH] crew_assigned column missing:', e); }
    }
    if (labor_hours !== undefined) {
      try {
        await sql`UPDATE projects SET labor_hours = ${Number(labor_hours) || 0} WHERE id = ${projectId}`;
        results.push('labor_hours');
      } catch (e) { console.warn('[ops PATCH] labor_hours column missing:', e); }
    }
    if (labor_cost !== undefined) {
      try {
        await sql`UPDATE projects SET labor_cost = ${Number(labor_cost) || 0} WHERE id = ${projectId}`;
        results.push('labor_cost');
      } catch (e) { console.warn('[ops PATCH] labor_cost column missing:', e); }
    }
    if (material_cost !== undefined) {
      try {
        await sql`UPDATE projects SET material_cost = ${Number(material_cost) || 0} WHERE id = ${projectId}`;
        results.push('material_cost');
      } catch (e) { console.warn('[ops PATCH] material_cost column missing:', e); }
    }

    // Always bump updated_at
    await sql`UPDATE projects SET updated_at = NOW() WHERE id = ${projectId}`;

    // If no fields were actually updated and body had fields, the columns likely don't exist
    const requestedFields = Object.keys(body).filter(k => body[k] !== undefined);
    if (requestedFields.length > 0 && results.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Operations columns not available. Please run database migration first.',
      }, { status: 422 });
    }

    // Return updated operations data
    try {
      const updated = await sql`
        SELECT id, name, address, system_size_kw,
               project_status, contract_signed_at, install_date,
               estimated_completion, actual_completion, crew_assigned,
               labor_hours, labor_cost, material_cost
        FROM projects WHERE id = ${projectId}
      `;

      const row = updated[0] || {};
      const operations = {
        ...row,
        project_status: row.project_status || 'lead',
        labor_hours: Number(row.labor_hours) || 0,
        labor_cost: Number(row.labor_cost) || 0,
        material_cost: Number(row.material_cost) || 0,
      };

      return NextResponse.json({ success: true, data: { operations, updatedFields: results } });
    } catch {
      // Columns don't exist for SELECT — return minimal success
      return NextResponse.json({ success: true, data: { operations: {}, updatedFields: results } });
    }

  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/projects/[id]/operations]', error);
  }
}