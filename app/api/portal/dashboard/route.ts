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
    // Also pull owner contact info (company_phone, email) for the portal contact section
    const projects = await sql`
      SELECT
        p.id,
        p.name,
        p.address,
        p.system_size_kw,
        p.homeowner_stage,
        p.monitoring_platform AS "monitoringPlatform",
        p.monitoring_url      AS "monitoringUrl",
        p.updated_at,
        p.created_at,
        u.name           AS owner_name,
        u.company_phone  AS owner_phone,
        u.email          AS owner_email,
        u.company        AS owner_company
      FROM projects p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.client_id = ${session.clientId}
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
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

    // Fetch documents — HOMEOWNER-SAFE ONLY
    // Only surfaces files the homeowner uploaded themselves:
    //   utility_bill  — their uploaded electric bill
    //   portal_upload — anything they submitted via the portal
    // Internal ops files (permit packets, BOM, SLD, engineering reports,
    // site survey photos, client profile, etc.) are intentionally excluded.
    let documents: {
      project_id: string;
      doc_type: string;
      label: string;
      uploaded_at: string;
    }[] = [];

    if (projectIds.length > 0) {
      const pfRows = await sql`
        SELECT
          project_id::text,
          'project_file'           AS doc_type,
          file_type::text          AS file_type,
          COALESCE(file_name, file_type, 'Document') AS label,
          created_at::text         AS uploaded_at
        FROM project_files
        WHERE project_id = ANY(${projectIds})
          AND file_type IN ('utility_bill', 'portal_upload')
          AND (file_url IS NOT NULL OR file_data IS NOT NULL)
          AND status != 'failed'
        ORDER BY created_at DESC
      `;

      documents = pfRows.map((r: Record<string, unknown>) => ({
        project_id:  String(r.project_id),
        doc_type:    String(r.doc_type),
        file_type:   r.file_type ? String(r.file_type) : undefined,
        label:       normalizeDocumentLabel(String(r.label)),
        uploaded_at: String(r.uploaded_at),
      }));
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

    // Derive owner contact info from the first project's owner (most recent project)
    const firstProject = projects[0] as Record<string, unknown> | undefined;
    const ownerName    = firstProject?.owner_name    ? String(firstProject.owner_name)    : null;
    const ownerPhone   = firstProject?.owner_phone   ? String(firstProject.owner_phone)   : null;
    const ownerEmail   = firstProject?.owner_email   ? String(firstProject.owner_email)   : null;
    const ownerCompany = firstProject?.owner_company ? String(firstProject.owner_company) : null;

    // Fetch proposals for all client projects (share_token + metadata for portal CTA)
    // Only return proposals that have a share_token and haven't expired.
    let proposals: {
      id: string;
      project_id: string;
      name: string;
      share_token: string;
      share_expires_at: string | null;
      signed_at: string | null;
    }[] = [];

    if (projectIds.length > 0) {
      try {
        const propRows = await sql`
          SELECT
            id::text,
            project_id::text,
            COALESCE(name, 'Solar Proposal') AS name,
            share_token,
            share_expires_at::text,
            signed_at::text
          FROM proposals
          WHERE project_id = ANY(${projectIds})
            AND share_token IS NOT NULL
            AND (share_expires_at IS NULL OR share_expires_at > NOW())
          ORDER BY created_at DESC
        `;
        proposals = propRows.map((r: Record<string, unknown>) => ({
          id:               String(r.id),
          project_id:       String(r.project_id),
          name:             String(r.name),
          share_token:      String(r.share_token),
          share_expires_at: r.share_expires_at ? String(r.share_expires_at) : null,
          signed_at:        r.signed_at        ? String(r.signed_at)        : null,
        }));
      } catch {
        // proposals table may be missing share_token in older DBs — non-fatal
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
      owner: {
        name:    ownerName,
        phone:   ownerPhone,
        email:   ownerEmail,
        company: ownerCompany,
      },
      projects,
      stageHistory,
      microStages,
      documents,
      proposals,
    });
  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/dashboard]', e);
  }
}