import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

type HomeownerStage = typeof HOMEOWNER_STAGES[number];

// ─── GET /api/admin/projects/[id] ───────────────────────────────────────────
// Returns project detail including homeowner_stage and stage history
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    const [rows, historyRows] = await Promise.all([
      sql`
        SELECT
          p.id, p.name, p.address, p.system_size_kw, p.status,
          p.origin, p.deleted_at, p.created_at, p.updated_at,
          p.homeowner_stage,
          u.name  AS owner_name,
          u.email AS owner_email,
          u.id    AS owner_id,
          c.name  AS client_name,
          c.email AS client_email,
          c.id    AS client_id
        FROM projects p
        LEFT JOIN users   u ON u.id = p.user_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ${id}
        LIMIT 1
      `,
      sql`
        SELECT
          h.id, h.stage, h.note, h.created_at,
          a.name  AS changed_by_name,
          a.email AS changed_by_email
        FROM project_homeowner_stage_history h
        LEFT JOIN users a ON a.id = h.changed_by
        WHERE h.project_id = ${id}
        ORDER BY h.created_at DESC
        LIMIT 50
      `,
    ]);

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
    });
  } catch (e: unknown) {
    return handleRouteDbError('[api/admin/projects/[id]] GET', e);
  }
}

// ─── PATCH /api/admin/projects/[id] ─────────────────────────────────────────
// action: 'set-stage' — update homeowner_stage and log to history
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();
    const body = await req.json();
    const { action, stage, note } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: 'Missing action' }, { status: 400 });
    }

    if (action === 'set-stage') {
      if (!stage || !HOMEOWNER_STAGES.includes(stage as HomeownerStage)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid stage. Must be one of: ${HOMEOWNER_STAGES.join(', ')}`,
          },
          { status: 400 }
        );
      }

      // Update homeowner_stage on the project
      const updated = await sql`
        UPDATE projects
        SET homeowner_stage = ${stage}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, homeowner_stage, updated_at
      `;

      if (updated.length === 0) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      }

      // Log to history — use admin id from session if available, else null
      const adminId = (admin as any)?.id ?? (admin as any)?.userId ?? null;
      const safeNote = typeof note === 'string' ? note.slice(0, 500) : null;

      await sql`
        INSERT INTO project_homeowner_stage_history
          (project_id, stage, changed_by, note)
        VALUES
          (${id}, ${stage}, ${adminId}, ${safeNote})
      `;

      return NextResponse.json({
        success: true,
        project: updated[0],
      });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: unknown) {
    return handleRouteDbError('[api/admin/projects/[id]] PATCH', e);
  }
}