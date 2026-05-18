/**
 * /api/admin/network/intake/route.ts
 *
 * Admin API — Intake Feed Dashboard
 *
 * GET — Intake feed with filters + aggregate stats:
 *   ?status=           filter by opportunity status
 *   ?source_system=    filter by source system
 *   ?source_channel=   filter by source channel
 *   ?from=             ISO date range start
 *   ?to=               ISO date range end
 *   ?search=           search name/email/phone/address
 *   ?page=             pagination (default 1)
 *   ?limit=            page size (default 25, max 100)
 *
 * Returns:
 *   - opportunities with intake_events, enrichment status, duplicate flags
 *   - aggregate stats: today's intake count, conversion rate, top sources,
 *     validation failure rate
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();
  const { searchParams } = new URL(req.url);

  const status = searchParams.get('status') || null;
  const source_system = searchParams.get('source_system') || null;
  const source_channel = searchParams.get('source_channel') || null;
  const from = searchParams.get('from') || null;
  const to = searchParams.get('to') || null;
  const search = searchParams.get('search') || null;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
  const offset = (page - 1) * limit;

  try {
    // ── Build filter conditions dynamically
    // We'll use a JSONB filter approach to avoid complex dynamic SQL
    const whereClauses: string[] = ['1=1'];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    if (status) {
      whereClauses.push(`no.status = $${paramIdx++}`);
      params.push(status);
    }
    if (source_system) {
      whereClauses.push(`no.source_system = $${paramIdx++}`);
      params.push(source_system);
    }
    if (source_channel) {
      whereClauses.push(`no.source_channel = $${paramIdx++}`);
      params.push(source_channel);
    }
    if (from) {
      whereClauses.push(`no.created_at >= $${paramIdx++}`);
      params.push(from);
    }
    if (to) {
      whereClauses.push(`no.created_at <= $${paramIdx++}`);
      params.push(to + 'T23:59:59Z');
    }
    if (search) {
      const like = `%${search}%`;
      whereClauses.push(`(
        no.first_name ILIKE $${paramIdx} OR no.last_name ILIKE $${paramIdx} OR
        no.email ILIKE $${paramIdx} OR no.phone ILIKE $${paramIdx} OR
        no.address_line1 ILIKE $${paramIdx} OR no.city ILIKE $${paramIdx}
      )`);
      params.push(like);
      paramIdx++;
    }

    const whereStr = whereClauses.join(' AND ');

    // ── Main query
    const opportunities = await sql`
      SELECT
        no.id,
        no.status,
        no.first_name,
        no.last_name,
        no.email,
        no.phone,
        no.address_line1,
        no.city,
        no.state,
        no.zip,
        no.source_system,
        no.source_channel,
        no.monthly_bill_amount,
        no.utm_source,
        no.utm_medium,
        no.utm_campaign,
        no.is_duplicate_flagged,
        no.duplicate_score,
        no.duplicate_of_id,
        no.opportunity_score,
        no.opportunity_grade,
        no.consent_given,
        no.created_at,
        no.updated_at,
        -- Enrichment status
        eq.status              AS enrichment_status,
        eq.property_status,
        eq.solar_status,
        eq.utility_status,
        eq.completed_at        AS enrichment_completed_at,
        eq.duration_ms         AS enrichment_duration_ms,
        -- Solar enrichment highlights
        no.peak_sun_hours_daily,
        no.recommended_system_kw,
        no.annual_savings_year1,
        no.estimated_system_cost_net,
        no.payback_period_years,
        -- Utility highlights
        no.utility_name,
        no.electricity_rate_kwh,
        no.net_metering_available,
        -- Recent intake event
        (SELECT action FROM intake_events
         WHERE opportunity_id = no.id
         ORDER BY occurred_at DESC LIMIT 1) AS last_event_action,
        (SELECT occurred_at FROM intake_events
         WHERE opportunity_id = no.id
         ORDER BY occurred_at DESC LIMIT 1) AS last_event_at
      FROM network_opportunities no
      LEFT JOIN enrichment_queue eq ON eq.opportunity_id = no.id
      WHERE no.source_system IS NOT NULL  -- only intake-sourced opportunities
        AND (${status}::text IS NULL OR no.status = ${status})
        AND (${source_system}::text IS NULL OR no.source_system = ${source_system})
        AND (${source_channel}::text IS NULL OR no.source_channel = ${source_channel})
        AND (${from}::text IS NULL OR no.created_at >= ${from}::timestamptz)
        AND (${to}::text IS NULL OR no.created_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
        AND (${search}::text IS NULL OR (
          no.first_name ILIKE ('%' || ${search} || '%') OR
          no.last_name ILIKE ('%' || ${search} || '%') OR
          no.email ILIKE ('%' || ${search} || '%') OR
          no.phone ILIKE ('%' || ${search} || '%') OR
          no.address_line1 ILIKE ('%' || ${search} || '%')
        ))
      ORDER BY no.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // ── Count total
    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM network_opportunities no
      WHERE no.source_system IS NOT NULL
        AND (${status}::text IS NULL OR no.status = ${status})
        AND (${source_system}::text IS NULL OR no.source_system = ${source_system})
        AND (${source_channel}::text IS NULL OR no.source_channel = ${source_channel})
        AND (${from}::text IS NULL OR no.created_at >= ${from}::timestamptz)
        AND (${to}::text IS NULL OR no.created_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
        AND (${search}::text IS NULL OR (
          no.first_name ILIKE ('%' || ${search} || '%') OR
          no.last_name ILIKE ('%' || ${search} || '%') OR
          no.email ILIKE ('%' || ${search} || '%') OR
          no.phone ILIKE ('%' || ${search} || '%') OR
          no.address_line1 ILIKE ('%' || ${search} || '%')
        ))
    `;
    const total = Number(countResult[0]?.total) || 0;

    // ── Aggregate stats
    const statsResult = await sql`
      SELECT
        -- Today's intake
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', NOW())) AS week_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) AS month_count,
        -- Duplicate rates
        COUNT(*) FILTER (WHERE is_duplicate_flagged = true) AS flagged_duplicates,
        COUNT(*) FILTER (WHERE duplicate_score >= 0.90) AS blocked_duplicates,
        -- Top sources
        COUNT(*) AS total_all_time
      FROM network_opportunities
      WHERE source_system IS NOT NULL
    `;

    // Today's intake events by action
    const todayEvents = await sql`
      SELECT action, COUNT(*) AS count
      FROM intake_events
      WHERE occurred_at >= CURRENT_DATE
      GROUP BY action
      ORDER BY count DESC
    `;

    // Top source systems (last 30 days)
    const topSources = await sql`
      SELECT
        source_system,
        source_channel,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE is_duplicate_flagged = false OR is_duplicate_flagged IS NULL) AS clean_count
      FROM network_opportunities
      WHERE source_system IS NOT NULL
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY source_system, source_channel
      ORDER BY count DESC
      LIMIT 10
    `;

    // Validation failure rate (last 7 days)
    const validationStats = await sql`
      SELECT
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE action = 'validation_failed') AS validation_failures,
        COUNT(*) FILTER (WHERE action = 'created') AS created,
        COUNT(*) FILTER (WHERE action = 'duplicate_blocked') AS blocked,
        COUNT(*) FILTER (WHERE action = 'duplicate_flagged') AS flagged
      FROM intake_events
      WHERE occurred_at >= NOW() - INTERVAL '7 days'
    `;

    const vs = validationStats[0] || {};
    const totalEvents = Number(vs.total_events) || 0;

    return NextResponse.json({
      opportunities,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        has_prev: page > 1,
      },
      stats: {
        ...statsResult[0],
        today_events: todayEvents,
        top_sources: topSources,
        validation_failure_rate: totalEvents > 0
          ? Math.round((Number(vs.validation_failures) / totalEvents) * 100) / 100
          : 0,
        conversion_rate: totalEvents > 0
          ? Math.round((Number(vs.created) / totalEvents) * 100) / 100
          : 0,
        ...vs,
      },
    });
  } catch (err) {
    console.error('[GET /api/admin/network/intake] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
