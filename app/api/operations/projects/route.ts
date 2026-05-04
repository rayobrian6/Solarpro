export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError, getDbReady } from '@/lib/db-neon';

/**
 * GET /api/operations/projects
 * 
 * Returns project data for the Operations dashboard.
 * Gracefully handles missing operations columns (pre-migration 016).
 * Auto-backfills project_status from legacy status when possible.
 */
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const sql = await getDbReady();

    // Try the full query with operations columns first.
    // If it fails (columns don't exist), fall back to base query.
    try {
      // Backfill project_status from legacy status where missing
      await sql`
        UPDATE projects
        SET project_status = CASE status
          WHEN 'lead'      THEN 'lead'
          WHEN 'design'    THEN 'design_complete'
          WHEN 'proposal'  THEN 'proposal_sent'
          WHEN 'approved'  THEN 'contract_signed'
          WHEN 'installed' THEN 'complete'
          ELSE 'lead'
        END
        WHERE user_id = ${user.id}
          AND deleted_at IS NULL
          AND (project_status IS NULL OR project_status = '')
      `.catch(() => { /* non-fatal */ });

      const rows = await sql`
        SELECT
          p.id,
          p.name,
          p.status,
          p.address,
          p.system_size_kw,
          p.updated_at,
          p.created_at,
          p.project_status,
          p.install_date,
          p.crew_assigned,
          p.labor_hours,
          p.labor_cost,
          p.material_cost,
          p.contract_signed_at,
          p.estimated_completion,
          p.actual_completion,
          c.name AS client_name
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.user_id = ${user.id}
          AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
      `;

      return NextResponse.json({ success: true, data: { projects: rows } });
    } catch (fullQueryErr) {
      console.warn('[operations/projects] full query failed, trying fallback:', fullQueryErr);

      // Fallback: no operations columns — use base columns only
      try {
        const rows = await sql`
          SELECT
            p.id,
            p.name,
            p.status,
            p.address,
            p.system_size_kw,
            p.updated_at,
            p.created_at,
            c.name AS client_name
          FROM projects p
          LEFT JOIN clients c ON c.id = p.client_id
          WHERE p.user_id = ${user.id}
            AND p.deleted_at IS NULL
          ORDER BY p.updated_at DESC
        `;

        return NextResponse.json({ success: true, data: { projects: rows } });
      } catch (fallbackErr) {
        console.warn('[operations/projects] fallback with JOIN failed, trying bare query:', fallbackErr);

        // Last resort: no JOIN at all
        const rows = await sql`
          SELECT
            id, name, status, address, system_size_kw,
            updated_at, created_at
          FROM projects
          WHERE user_id = ${user.id}
            AND deleted_at IS NULL
          ORDER BY updated_at DESC
        `;

        return NextResponse.json({ success: true, data: { projects: rows } });
      }
    }
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/operations/projects]', err);
  }
}