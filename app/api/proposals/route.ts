export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30; // Proposal generation: getProjectWithDetails + snapshot needs headroom

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID, getProjectWithDetails, getPricingConfig, handleRouteDbError } from '@/lib/db-neon';
import { v4 as uuidv4 } from 'uuid';
import type { Proposal } from '@/types';
import { fetchProposalUtilityRate } from '@/lib/proposal/buildCanonicalProposal';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
// v48.5: fetchProposalUtilityRate called ONLY at POST (creation) — cached in data_json.dbUtilityRate. GET reads cache, no N+2.

// ── Map a raw DB row → typed Proposal object ──────────────────────────────
function rowToProposal(row: Record<string, unknown>, project?: import('@/types').Project): Proposal {
  // data_json holds: { status, title, preparedBy, preparedDate, validUntil, viewCount,
  //                    project (snapshot), pricingSnapshot, snapshotAt }
  const dj = (row.data_json as Record<string, unknown>) || {};
  // FIX v47.224: use project from snapshot when available (v47.222+),
  // fall back to live project passed as argument (for list API enrichment).
  const snapshotProject = dj.project as import('@/types').Project | undefined;
  return {
    id:              row.id as string,
    projectId:       row.project_id as string,
    // Prefer snapshot project (immutable) over live project (may have drifted)
    project:         snapshotProject ?? project,
    status:          (dj.status as Proposal['status']) || 'draft',
    title:           (dj.title as string) || (row.name as string) || 'Solar Proposal',
    preparedBy:      (dj.preparedBy as string) || 'SolarPro Design Team',
    preparedDate:    (dj.preparedDate as string) || (row.created_at as string),
    validUntil:      (dj.validUntil as string) || new Date(Date.now() + 30 * 86400000).toISOString(),
    shareToken:      row.share_token as string | undefined,
    viewCount:       (dj.viewCount as number) || 0,
    createdAt:       row.created_at as string,
    updatedAt:       row.updated_at as string,
    pricingSnapshot: (dj.pricingSnapshot as Record<string, unknown>) ?? null,
    snapshotAt:      (dj.snapshotAt as string) ?? undefined,
    // v48.5: read cached DB rate from data_json (set at proposal creation)
    dbUtilityRate:   typeof dj.dbUtilityRate === 'number' ? dj.dbUtilityRate : null,
    // v48.36: read cached stateCode from data_json (set at proposal creation)
    stateCode:       typeof dj.stateCode === 'string' ? dj.stateCode : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    const sql = await getDbReady();
    let rows: Record<string, unknown>[];

    if (projectId) {
      if (!isValidUUID(projectId)) {
        return NextResponse.json({ success: true, data: [] });
      }
      rows = await sql`
        SELECT * FROM proposals
        WHERE user_id = ${user.id}
          AND project_id = ${projectId}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM proposals
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    }

    // For list view, enrich each proposal with full project details + v48.3 DB rate
    const proposals = await Promise.all(
      rows.map(async (row) => {
        const pid = row.project_id as string;
        const project = isValidUUID(pid) ? await getProjectWithDetails(pid, user.id) ?? undefined : undefined;
        // v48.5: dbUtilityRate now read from data_json cache inside rowToProposal
        return rowToProposal(row, project);
      })
    );

    return NextResponse.json({ success: true, data: proposals });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/proposals]', error);
  }
}

export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const { projectId, title, preparedBy, validDays = 30 } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid projectId format' }, { status: 400 });
    }

    // SECURITY: field length caps + validDays range check
    if (title      && typeof title      === 'string' && title.length      > 200) return NextResponse.json({ success: false, error: 'title too long (max 200).'      }, { status: 400 });
    if (preparedBy && typeof preparedBy === 'string' && preparedBy.length > 200) return NextResponse.json({ success: false, error: 'preparedBy too long (max 200).' }, { status: 400 });
    if (typeof validDays !== 'number' || !Number.isFinite(validDays) || validDays < 1 || validDays > 365) {
      return NextResponse.json({ success: false, error: 'validDays must be a number between 1 and 365.' }, { status: 400 });
    }

    // Fetch full project with layout + client + production
    const project = await getProjectWithDetails(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    // FIX v47.223: also snapshot pricingCfg at creation so proposal financials are immutable
    // even if admin changes pricing config after the proposal is sent.
    let pricingSnapshot: unknown = null;
    try {
      pricingSnapshot = await getPricingConfig();
    } catch {
      // Non-fatal — proposal still created, just won't have frozen pricing
    }

    const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
    const shareToken = uuidv4().replace(/-/g, '').substring(0, 16);
    const proposalName = title || `Solar Proposal - ${project.name}`;
    const preparedByName = preparedBy || 'SolarPro Design Team';

    const sql = await getDbReady();
    // FIX v47.222: persist full project snapshot in data_json so the public view
    // page can load all computed values (production, savings, layout, etc.) without
    // a live re-fetch. Older proposals without this field fall back gracefully.
    // FIX v47.223: also snapshot pricingCfg so financials remain immutable after admin changes.
    const snapshotAt = new Date().toISOString();

    // v48.5: fetch dbUtilityRate once at creation and cache in data_json — eliminates N+2 on list API
    const dbUtilityRate = await fetchProposalUtilityRate(
      (project as any).utilityName ?? null,
      (project as any).stateCode   ?? null
    ).catch(() => null);

    // v48.36: extract and cache stateCode at snapshot time so ICA/PTO works even when
    // client.state is missing from the live DB later. Fallback chain: project.stateCode
    // → client.state → regex on address.
    const _extractStateCode = (addr?: string): string => {
      if (!addr) return '';
      const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    };
    const snapshotStateCode = (
      (project as any).stateCode ??
      (project as any).client?.state ??
      _extractStateCode((project as any).address ?? '')
    ) || null;

    const dataJson = JSON.stringify({
      status: 'draft',
      title: proposalName,
      preparedBy: preparedByName,
      preparedDate: snapshotAt,
      validUntil,
      viewCount: 0,
      project,                    // full Project snapshot (layout + production + costEstimate + client)
      pricingSnapshot,            // frozen pricing config at time of generation
      snapshotAt,
      dbUtilityRate,              // v48.5: cached at creation — no live re-fetch on reads
      stateCode: snapshotStateCode, // v48.36: explicit state code for ICA/PTO lookup
    });

    const rows = await sql`
      INSERT INTO proposals (user_id, project_id, name, share_token, data_json)
      VALUES (
        ${user.id},
        ${projectId},
        ${proposalName},
        ${shareToken},
        ${dataJson}::jsonb
      )
      RETURNING *
    `;

    // Update project status to proposal
    await sql`
      UPDATE projects SET status = 'proposal', updated_at = NOW()
      WHERE id = ${projectId} AND user_id = ${user.id}
    `;

    console.log('[POST /api/proposals] Saved proposal data snapshot:', {
      proposalId: (rows[0] as Record<string, unknown>).id,
      projectId,
      hasLayout: !!project.layout,
      hasProduction: !!project.production,
      hasCostEstimate: !!project.costEstimate,
      panelCount: project.layout?.totalPanels ?? 0,
      systemSizeKw: project.layout?.systemSizeKw ?? 0,
      snapshotAt: new Date().toISOString(),
    });

    const proposal = rowToProposal(rows[0] as Record<string, unknown>, project);

    return NextResponse.json(
      { success: true, data: proposal },
      { status: 201 }
    );
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/proposals]', error);
  }
}