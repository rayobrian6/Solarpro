/**
 * /api/admin/network/campaigns/route.ts
 *
 * Admin API — Acquisition Campaigns CRUD
 *
 * GET    — list all campaigns with stats + funnel name
 *   ?status=        filter by status (draft|active|paused|completed|archived)
 *   ?platform=      filter by platform
 *   ?page=          pagination (default 1)
 *   ?limit=         page size (default 25)
 *
 * POST   — create a new campaign
 *   Body: { name, description?, campaign_type, platform?, funnel_id?,
 *           daily_budget_cents?, monthly_budget_cents?, total_budget_cents?,
 *           cost_per_lead_target_cents?, leads_target?,
 *           utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?,
 *           geo_targeting?, start_date?, end_date?, notes? }
 *
 * PATCH  — update an existing campaign
 *   Body: { id, ...same fields as POST, status? }
 *
 * DELETE — archive a campaign (soft delete — sets status = 'archived')
 *   Body: { id }
 */
export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady }     from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();
  const { searchParams } = new URL(req.url);

  const status   = searchParams.get('status')   || null;
  const platform = searchParams.get('platform') || null;
  const page     = Math.max(1, parseInt(searchParams.get('page')  || '1'));
  const limit    = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
  const offset   = (page - 1) * limit;

  try {
    // Build WHERE
    const conditions: string[] = ['1=1'];
    const params: (string | number | null)[] = [];
    let p = 1;

    if (status)   { conditions.push(`ac.status = $${p++}`);   params.push(status); }
    if (platform) { conditions.push(`ac.platform = $${p++}`); params.push(platform); }

    const where = conditions.join(' AND ');

    // Campaign rows
    const rawCampaigns = await sql(
      `SELECT
         ac.id,
         ac.name,
         ac.description,
         ac.campaign_type,
         ac.status,
         ac.platform,
         ac.funnel_id,
         inf.name                           AS funnel_name,
         inf.slug                           AS funnel_slug,
         ac.daily_budget_cents,
         ac.monthly_budget_cents,
         ac.total_budget_cents,
         ac.cost_per_lead_target_cents,
         ac.leads_target,
         ac.leads_received,
         ac.leads_qualified,
         ac.leads_converted,
         ac.total_spend_cents,
         ac.utm_source,
         ac.utm_medium,
         ac.utm_campaign,
         ac.utm_content,
         ac.utm_term,
         ac.geo_targeting,
         ac.audience_targeting,
         ac.start_date,
         ac.end_date,
         ac.notes,
         ac.created_at,
         ac.updated_at,
         -- Derived metrics
         CASE
           WHEN ac.leads_received > 0
           THEN ROUND((ac.total_spend_cents::numeric / ac.leads_received), 0)
           ELSE NULL
         END                                AS actual_cpl_cents,
         CASE
           WHEN ac.leads_received > 0
           THEN ROUND((ac.leads_converted::numeric / ac.leads_received) * 100, 1)
           ELSE 0
         END                                AS conversion_rate_pct,
         CASE
           WHEN ac.leads_received > 0
           THEN ROUND((ac.leads_qualified::numeric / ac.leads_received) * 100, 1)
           ELSE 0
         END                                AS qualification_rate_pct
       FROM acquisition_campaigns ac
       LEFT JOIN intake_funnels inf ON inf.id = ac.funnel_id
       WHERE ${where}
       ORDER BY ac.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset]
    );

    // Total count
    const countRows = await sql(
      `SELECT COUNT(*) AS total
       FROM acquisition_campaigns ac
       WHERE ${where}`,
      params
    );
    const total = parseInt(String((countRows[0] as { total: string })?.total ?? '0'));

    // Platform breakdown
    const platformStats = await sql`
      SELECT
        COALESCE(platform, 'unset') AS platform,
        COUNT(*)                    AS count,
        SUM(leads_received)         AS leads,
        SUM(total_spend_cents)      AS spend_cents
      FROM acquisition_campaigns
      WHERE status NOT IN ('archived')
      GROUP BY platform
      ORDER BY count DESC
    `;

    // Status breakdown
    const statusStats = await sql`
      SELECT status, COUNT(*) AS count
      FROM acquisition_campaigns
      GROUP BY status
      ORDER BY count DESC
    `;

    // Total active budget
    const budgetRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')   AS active_count,
        SUM(daily_budget_cents) FILTER (WHERE status = 'active') AS active_daily_budget_cents,
        SUM(leads_received)                          AS total_leads,
        SUM(leads_converted)                         AS total_conversions,
        SUM(total_spend_cents)                       AS total_spend_cents
      FROM acquisition_campaigns
    `;

    const summaryRow = budgetRows[0] as Record<string, string | null>;

    return NextResponse.json({
      success: true,
      campaigns: rawCampaigns,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        active_count:             parseInt(summaryRow.active_count  ?? '0'),
        active_daily_budget_cents: parseInt(summaryRow.active_daily_budget_cents ?? '0'),
        total_leads:              parseInt(summaryRow.total_leads   ?? '0'),
        total_conversions:        parseInt(summaryRow.total_conversions ?? '0'),
        total_spend_cents:        parseInt(summaryRow.total_spend_cents ?? '0'),
      },
      platform_stats: platformStats,
      status_stats:   statusStats,
    });
  } catch (err: unknown) {
    console.error('[GET /api/admin/network/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── POST (create) ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { name, description, campaign_type, status, platform, funnel_id,
          daily_budget_cents, monthly_budget_cents, total_budget_cents,
          cost_per_lead_target_cents, leads_target,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          geo_targeting, audience_targeting, start_date, end_date, notes } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 422 });
  }

  try {
    const rows = await sql`
      INSERT INTO acquisition_campaigns (
        name, description, campaign_type, status, platform, funnel_id,
        daily_budget_cents, monthly_budget_cents, total_budget_cents,
        cost_per_lead_target_cents, leads_target,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        geo_targeting, audience_targeting,
        start_date, end_date,
        created_by, notes
      ) VALUES (
        ${name as string},
        ${(description as string | null) ?? null},
        ${(campaign_type as string) || 'paid_search'},
        ${(status as string) || 'draft'},
        ${(platform as string | null) ?? null},
        ${(funnel_id as string | null) ?? null},
        ${(daily_budget_cents as number | null) ?? null},
        ${(monthly_budget_cents as number | null) ?? null},
        ${(total_budget_cents as number | null) ?? null},
        ${(cost_per_lead_target_cents as number | null) ?? null},
        ${(leads_target as number | null) ?? null},
        ${(utm_source as string | null) ?? null},
        ${(utm_medium as string | null) ?? null},
        ${(utm_campaign as string | null) ?? null},
        ${(utm_content as string | null) ?? null},
        ${(utm_term as string | null) ?? null},
        ${geo_targeting ? JSON.stringify(geo_targeting) : '{}'},
        ${audience_targeting ? JSON.stringify(audience_targeting) : '{}'},
        ${(start_date as string | null) ?? null},
        ${(end_date as string | null) ?? null},
        ${admin.id},
        ${(notes as string | null) ?? null}
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, campaign: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    console.error('[POST /api/admin/network/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── PATCH (update) ────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { id, ...fields } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 422 });
  }

  // Build dynamic SET clause
  const allowed = [
    'name','description','campaign_type','status','platform','funnel_id',
    'daily_budget_cents','monthly_budget_cents','total_budget_cents',
    'cost_per_lead_target_cents','leads_target',
    'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
    'geo_targeting','audience_targeting',
    'start_date','end_date','notes',
    'leads_received','leads_qualified','leads_converted','total_spend_cents',
  ];

  const setClauses: string[] = [];
  const params: unknown[]    = [];
  let p = 1;

  for (const key of allowed) {
    if (key in fields) {
      const val = fields[key];
      if (key === 'geo_targeting' || key === 'audience_targeting') {
        setClauses.push(`${key} = $${p++}`);
        params.push(val ? JSON.stringify(val) : '{}');
      } else {
        setClauses.push(`${key} = $${p++}`);
        params.push(val ?? null);
      }
    }
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 422 });
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const rows = await sql(
      `UPDATE acquisition_campaigns
       SET ${setClauses.join(', ')}
       WHERE id = $${p}
       RETURNING *`,
      params
    );

    if (!rows.length) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign: rows[0] });
  } catch (err: unknown) {
    console.error('[PATCH /api/admin/network/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── DELETE (archive) ──────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { id } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 422 });
  }

  try {
    const rows = await sql`
      UPDATE acquisition_campaigns
      SET status = 'archived', updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, status
    `;

    if (!rows.length) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign: rows[0] });
  } catch (err: unknown) {
    console.error('[DELETE /api/admin/network/campaigns]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
