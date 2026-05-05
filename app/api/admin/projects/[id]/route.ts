import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { writeMicroStage } from '@/lib/microStage';

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

    const [rows, historyRows, fileRows, microRows] = await Promise.all([
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
      sql`
        SELECT
          file_name,
          file_type,
          COALESCE(file_name, file_type, 'Document') AS label,
          created_at::text AS uploaded_at
        FROM project_files
        WHERE project_id = ${id}
          AND (file_url IS NOT NULL OR file_data IS NOT NULL)
          AND status != 'failed'
        ORDER BY created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT
          micro_stage,
          created_at::text AS created_at,
          created_by::text AS created_by
        FROM project_micro_stages
        WHERE project_id = ${id}
        ORDER BY created_at ASC
      `,
    ]);

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Normalize document labels for display
    const documents = fileRows.map((r: Record<string, unknown>) => ({
      file_type:   r.file_type ? String(r.file_type) : undefined,
      label:       String(r.label ?? r.file_name ?? 'Document'),
      uploaded_at: String(r.uploaded_at),
    }));

    const microStages = microRows.map((r: Record<string, unknown>) => ({
      micro_stage: String(r.micro_stage),
      created_at:  String(r.created_at),
    }));

    return NextResponse.json({
      success: true,
      project: rows[0],
      stageHistory: historyRows,
      documents,
      microStages,
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

      // Forward-only guard: prevent backward stage movement unless force=true
      const force = body.force === true;
      if (!force) {
        const current = await sql`
          SELECT homeowner_stage FROM projects WHERE id = ${id} LIMIT 1
        `;
        const currentStage = current[0]?.homeowner_stage as HomeownerStage | null;
        if (currentStage) {
          const currentIdx = HOMEOWNER_STAGES.indexOf(currentStage);
          const newIdx = HOMEOWNER_STAGES.indexOf(stage as HomeownerStage);
          if (newIdx < currentIdx) {
            return NextResponse.json(
              {
                success: false,
                error: `Cannot move stage backward from '${currentStage}' to '${stage}'. Pass force=true to override.`,
                currentStage,
                requestedStage: stage,
              },
              { status: 409 }
            );
          }
        }
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

      // ── Write micro stage for admin-set homeowner_stage (non-fatal, fire-and-forget) ─
      // Maps homeowner_stage → representative micro stage so the audit log
      // reflects the manual override with consistent granularity.
      const HOMEOWNER_TO_MICRO_OVERRIDE: Partial<Record<string, import('@/lib/microStage').MicroStage>> = {
        lead_submitted:  'lead_created',
        under_review:    'bill_uploaded',
        site_survey:     'survey_submitted',
        design:          'layout_completed',
        proposal:        'proposal_sent',
        installation:    'install_started',
        completed:       'system_live',
      };
      const microOverride = HOMEOWNER_TO_MICRO_OVERRIDE[stage as string];
      if (microOverride) {
        void writeMicroStage(id, microOverride, adminId, {
          source: 'admin_set_stage',
          stage,
          note: safeNote,
        });
      }

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