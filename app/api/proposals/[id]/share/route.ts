export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError, getProjectWithDetails, getPricingConfig, isValidUUID } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { getBaseUrl } from '@/lib/env';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// POST /api/proposals/[id]/share — generate a shareable token for a proposal
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Rate limiting (applies to all callers, not just unauthenticated) ──
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: proposalId } = await params;
    const sql = await getDbReady();

    // Verify proposal belongs to this user
    const rows = await sql`
      SELECT p.id, p.title, p.project_id
      FROM proposals p
      JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    // Generate share token
    const shareToken = uuidv4().replace(/-/g, '').substring(0, 16);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // FIX v47.222: refresh project snapshot in data_json so the public view page
    // always gets current production/savings data even if design changed after proposal creation.
    const projectId = rows[0].project_id as string;
    let snapshotUpdate: Record<string, unknown> = {};
    if (isValidUUID(projectId)) {
      try {
        const [freshProject, freshPricing] = await Promise.all([
          getProjectWithDetails(projectId, user.id),
          getPricingConfig().catch(() => null),
        ]);
        if (freshProject) {
          // Merge snapshot into existing data_json (preserves title, viewCount, etc.)
          const existingRow = await sql`SELECT data_json FROM proposals WHERE id = ${proposalId} LIMIT 1`;
          const existingData = (existingRow[0]?.data_json as Record<string, unknown>) || {};
          snapshotUpdate = {
            ...existingData,
            project: freshProject,
            pricingSnapshot: freshPricing ?? existingData.pricingSnapshot ?? null,
            snapshotAt: new Date().toISOString(),
          };
          console.log('[share] Refreshed project snapshot:', {
            proposalId,
            hasLayout: !!freshProject.layout,
            hasProduction: !!freshProject.production,
            hasPricingSnapshot: !!freshPricing,
            panelCount: freshProject.layout?.totalPanels ?? 0,
          });
        }
      } catch (snapshotErr) {
        // Non-fatal — share URL still works, proposal view falls back to live fetch
        console.warn('[share] Could not refresh project snapshot:', snapshotErr);
      }
    }

    // Try to update share_token column if it exists
    try {
      if (Object.keys(snapshotUpdate).length > 0) {
        // Update share token + refresh snapshot in one write
        await sql`
          UPDATE proposals
          SET share_token = ${shareToken},
              share_expires_at = ${expiresAt.toISOString()},
              data_json = ${JSON.stringify(snapshotUpdate)}::jsonb,
              updated_at = NOW()
          WHERE id = ${proposalId}
        `;
      } else {
        await sql`
          UPDATE proposals 
          SET share_token = ${shareToken}, share_expires_at = ${expiresAt.toISOString()}
          WHERE id = ${proposalId}
        `;
      }
    } catch {
      // Column may not exist yet — still return a usable URL
    }

    const baseUrl = getBaseUrl();
    const shareUrl = `${baseUrl}/proposals/view/${proposalId}?token=${shareToken}`;

    // Auto-advance homeowner stage to 'proposal' when a proposal is first shared,
    // so the homeowner portal immediately shows the View & Sign CTA.
    // Only advances if the current stage is BEFORE 'proposal' (lead/under_review/site_survey/design).
    // Never downgrades a stage that's already at 'proposal', 'installation', or 'completed'.
    const PRE_PROPOSAL_STAGES = new Set(['lead_submitted', 'under_review', 'site_survey', 'design', null]);
    try {
      const projRows = await sql`
        SELECT homeowner_stage FROM projects WHERE id = ${projectId} LIMIT 1
      `;
      const currentStage = projRows[0]?.homeowner_stage ?? null;
      if (PRE_PROPOSAL_STAGES.has(currentStage as string | null)) {
        await sql`
          UPDATE projects
          SET homeowner_stage = 'proposal', updated_at = NOW()
          WHERE id = ${projectId}
        `;
        // Write micro-stage event for audit trail
        try {
          await sql`
            INSERT INTO project_micro_stages (project_id, micro_stage)
            VALUES (${projectId}, 'proposal_sent')
            ON CONFLICT (project_id, micro_stage) DO UPDATE SET created_at = NOW()
          `;
        } catch {
          // micro_stages constraint may not exist — non-fatal
        }
        console.log('[share] Auto-advanced homeowner_stage to proposal for project', projectId);
      }
    } catch (stageErr) {
      // Non-fatal — homeowner_stage column may not exist yet
      console.warn('[share] Could not advance homeowner_stage:', stageErr);
    }

    return NextResponse.json({
      success: true,
      shareUrl,
      shareToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: unknown) {
    // Previously this fabricated a fallback token that was never persisted —
    // the share URL would 404 while the UI reported success. Surface a real error.
    return handleRouteDbError('[share proposal]', err);
  }
}

// GET /api/proposals/[id]/share — get existing share link
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: proposalId } = await params;
    const sql = await getDbReady();

    const rows = await sql`
      SELECT p.id, p.share_token, p.share_expires_at
      FROM proposals p
      JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const row = rows[0];
    if (!row.share_token) {
      return NextResponse.json({ success: true, shareUrl: null });
    }

    const baseUrl = getBaseUrl();
    const shareUrl = `${baseUrl}/proposals/view/${proposalId}?token=${row.share_token}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      shareToken: row.share_token,
      expiresAt: row.share_expires_at,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/proposals/[id]/share]', err);
  }
}