import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { getPortalSession } from '@/lib/portalAuth';
import { normalizeDocumentLabel } from '@/lib/normalizeDocumentLabel';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── GET /api/portal/dashboard ──────────────────────────────────────────────
// Returns client info + their projects (homeowner_stage only — NOT project_status)
export async function GET(req: NextRequest) {
  // Rate limit
  const rl = await checkRateLimit('portal_read', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  // Auth — portal session cookie only
  const session = getPortalSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated', code: 'PORTAL_AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  try {
    const sql = await getDbReady();

    // Fetch client record
    const clients = await sql`
      SELECT id, name, email, phone, address, city, state, zip
      FROM clients
      WHERE id = ${session.clientId}
        AND LOWER(email) = ${session.email.toLowerCase()}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Account not found.', code: 'CLIENT_NOT_FOUND' },
        { status: 404 }
      );
    }

    const client = clients[0];

    // Fetch projects for this client — ONLY homeowner_stage, NOT project_status
    const projects = await sql`
      SELECT
        id,
        name,
        address,
        system_size_kw,
        homeowner_stage,
        updated_at,
        created_at
      FROM projects
      WHERE client_id = ${session.clientId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;

    // Fetch stage history for all client projects (homeowner-safe: stage + date only)
    const projectIds = projects.map((p: { id: string }) => p.id);
    let stageHistory: { project_id: string; stage: string; created_at: string }[] = [];
    if (projectIds.length > 0) {
      const historyRows = await sql`
        SELECT project_id, stage, created_at
        FROM project_homeowner_stage_history
        WHERE project_id = ANY(${projectIds})
        ORDER BY created_at DESC
        LIMIT 20
      `;
      stageHistory = historyRows.map((r: Record<string, unknown>) => ({
        project_id: r.project_id as string,
        stage: r.stage as string,
        created_at: r.created_at as string,
      }));
    }

    // Fetch documents for all client projects (project_files + site_survey_files)
    let documents: {
      project_id: string;
      doc_type: string;
      label: string;
      uploaded_at: string;
    }[] = [];

    if (projectIds.length > 0) {
      // project_files (utility bills, portal uploads, survey documents)
      // file_url = external URL (survey photo fetch); file_data = inline binary (portal uploads)
      const pfRows = await sql`
        SELECT
          project_id::text,
          'project_file'           AS doc_type,
          file_type::text          AS file_type,
          COALESCE(file_name, file_type, 'Document') AS label,
          created_at::text         AS uploaded_at
        FROM project_files
        WHERE project_id = ANY(${projectIds})
          AND (file_url IS NOT NULL OR file_data IS NOT NULL)
          AND status != 'failed'
        ORDER BY created_at DESC
      `;

      // site_survey_files (photos from field survey)
      const ssfRows = await sql`
        SELECT
          ss.project_id::text,
          'site_survey_file' AS doc_type,
          COALESCE(ssf.label, ssf.filename, 'Site Survey Photo') AS label,
          ssf.created_at::text AS uploaded_at
        FROM site_survey_files ssf
        JOIN site_surveys ss ON ss.id = ssf.survey_id
        WHERE ss.project_id = ANY(${projectIds})
        ORDER BY ssf.created_at DESC
      `;

      documents = [
        ...pfRows.map((r: Record<string, unknown>) => ({
          project_id:  String(r.project_id),
          doc_type:    String(r.doc_type),
          file_type:   r.file_type ? String(r.file_type) : undefined,
          label:       normalizeDocumentLabel(String(r.label)),
          uploaded_at: String(r.uploaded_at),
        })),
        ...ssfRows.map((r: Record<string, unknown>) => ({
          project_id:  String(r.project_id),
          doc_type:    String(r.doc_type),
          label:       normalizeDocumentLabel(String(r.label)),
          uploaded_at: String(r.uploaded_at),
        })),
      ].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    }

    // Fetch micro stages for all client projects (internal progress events)
    let microStages: { project_id: string; micro_stage: string; created_at: string }[] = [];
    if (projectIds.length > 0) {
      try {
        const microRows = await sql`
          SELECT
            project_id::text,
            micro_stage::text,
            created_at::text
          FROM project_micro_stages
          WHERE project_id = ANY(${projectIds})
          ORDER BY created_at ASC
        `;
        microStages = microRows.map((r: Record<string, unknown>) => ({
          project_id:  String(r.project_id),
          micro_stage: String(r.micro_stage),
          created_at:  String(r.created_at),
        }));
      } catch {
        // project_micro_stages may not exist yet — non-fatal
      }
    }

    return NextResponse.json({
      success: true,
      client: {
        id:      client.id,
        name:    client.name,
        email:   client.email,
        phone:   client.phone || null,
        address: client.address || null,
        city:    client.city || null,
        state:   client.state || null,
        zip:     client.zip || null,
      },
      projects,
      stageHistory,
      microStages,
      documents,
    });
  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/dashboard]', e);
  }
}