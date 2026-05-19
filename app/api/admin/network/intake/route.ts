/**
 * /api/admin/network/intake/route.ts
 *
 * Admin API — Intake Feed Dashboard
 *
 * GET — Intake feed with filters + aggregate stats:
 *   ?status=           filter by opportunity/event review status
 *   ?source_system=    filter by source system
 *   ?source_channel=   filter by source channel
 *   ?from=             ISO date range start
 *   ?to=               ISO date range end
 *   ?search=           search name/email/phone/address/operational fields
 *   ?debug=1           include hidden/failed/malformed event rows for admins
 *   ?page=             pagination (default 1)
 *   ?limit=            page size (default 25, max 100)
 *
 * Returns one canonical Intake Feed composed from:
 *   - network_opportunities that already came through canonical intake, and
 *   - review-first intake_events rows with opportunity_id IS NULL.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';

type IntakeFeedStage = 'auth' | 'db_connect' | 'request_parse' | 'feed_query' | 'stats_query' | 'today_events_query' | 'top_sources_query' | 'validation_stats_query';

function intakeFeedError(stage: IntakeFeedStage, error: unknown) {
  const err = error as { message?: string; code?: string; detail?: string; constraint?: string; column?: string };
  return NextResponse.json({
    success: false,
    error: 'Intake Feed failed',
    stage,
    message: err?.message ?? String(error),
    code: err?.code,
    details: {
      detail: err?.detail,
      constraint: err?.constraint,
      column: err?.column,
    },
  }, { status: 500 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let stage: IntakeFeedStage = 'auth';

  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    stage = 'db_connect';
    const sql = await getDbReady();

    stage = 'request_parse';
    const { searchParams } = new URL(req.url);

    const status = searchParams.get('status') || null;
    const source_system = searchParams.get('source_system') || null;
    const source_channel = searchParams.get('source_channel') || null;
    const from = searchParams.get('from') || null;
    const to = searchParams.get('to') || null;
    const search = searchParams.get('search') || null;
    const includeDebug = ['1', 'true', 'yes'].includes((searchParams.get('debug') || '').toLowerCase());
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
    const offset = (page - 1) * limit;

    stage = 'feed_query';
    const feedRows = await sql`
      WITH opportunity_rows AS (
        SELECT
          no.id::text AS id,
          'opportunity'::text AS intake_record_type,
          no.id::text AS opportunity_id,
          NULL::text AS event_id,
          no.status::text AS status,
          no.first_name,
          no.last_name,
          no.email,
          no.phone,
          no.address_line1,
          no.location_city AS city,
          no.location_state AS state,
          COALESCE(no.location_zip, no.zip) AS zip,
          no.source_system,
          no.source_channel,
          no.monthly_bill_amount,
          no.utm_source,
          no.utm_medium,
          no.utm_campaign,
          no.utm_content,
          no.utm_term,
          no.gclid,
          no.fbclid,
          no.duplicate_flag AS is_duplicate,
          no.duplicate_flag AS is_duplicate_flagged,
          no.duplicate_score,
          no.duplicate_of_id::text AS duplicate_of_id,
          no.opportunity_score,
          no.opportunity_grade,
          false AS consent_given,
          no.created_at,
          no.updated_at,
          eq.status AS enrichment_status,
          eq.property_status,
          eq.solar_status,
          eq.utility_status,
          eq.completed_at AS enrichment_completed_at,
          eq.duration_ms AS enrichment_duration_ms,
          CASE WHEN no.peak_sun_hours_annual IS NOT NULL THEN ROUND((no.peak_sun_hours_annual / 365.0)::numeric, 2) ELSE NULL::numeric END AS peak_sun_hours_daily,
          no.estimated_system_size_kw AS recommended_system_kw,
          no.estimated_annual_savings AS annual_savings_year1,
          no.estimated_project_value AS estimated_system_cost_net,
          no.estimated_payback_yrs AS payback_period_years,
          no.utility_provider AS utility_name,
          no.utility_rate_per_kwh AS electricity_rate_kwh,
          NULL::boolean AS net_metering_available,
          (SELECT action FROM intake_events WHERE opportunity_id = no.id ORDER BY occurred_at DESC LIMIT 1) AS last_event_action,
          (SELECT occurred_at FROM intake_events WHERE opportunity_id = no.id ORDER BY occurred_at DESC LIMIT 1) AS last_event_at,
          NULL::text AS error_code,
          NULL::text AS error_message,
          '{}'::jsonb AS validation_result,
          '{}'::jsonb AS duplicate_result,
          '{}'::jsonb AS pipeline_result,
          '{}'::jsonb AS intake_metadata,
          '{}'::jsonb AS qualification_payload,
          '{}'::jsonb AS qualification_intelligence,
          NULL::text AS qualification_event_id,
          NULL::text AS qualification_status,
          NULL::text AS lead_grade,
          NULL::boolean AS finance_readiness,
          NULL::boolean AS battery_readiness,
          NULL::text AS estimated_income_band,
          NULL::text AS estimated_credit_band,
          NULL::text AS sunlight_confidence,
          NULL::text AS property_type,
          NULL::text AS utility_provider,
          NULL::text AS battery_interest,
          no.home_ownership::text AS homeowner_status,
          NULL::text AS preferred_contact_method,
          NULL::text AS timeline,
          no.roof_age_years::text AS roof_age,
          '{}'::jsonb AS bill_metadata,
          false AS debug_visible
        FROM network_opportunities no
        LEFT JOIN enrichment_queue eq ON eq.opportunity_id = no.id
        WHERE no.source_system IS NOT NULL
      ),
      event_rows AS (
        SELECT
          ie.event_id AS id,
          'intake_event'::text AS intake_record_type,
          NULL::text AS opportunity_id,
          ie.event_id,
          CASE
            WHEN ie.action = 'pending_review' THEN 'pending_review'
            WHEN ie.action IN ('validation_failed', 'malformed', 'error') THEN ie.action
            ELSE COALESCE(ie.action, 'pending_review')
          END AS status,
          ie.payload->>'first_name' AS first_name,
          ie.payload->>'last_name' AS last_name,
          ie.payload->>'email' AS email,
          ie.payload->>'phone' AS phone,
          COALESCE(ie.payload->>'address_line1', ie.payload->>'property_address') AS address_line1,
          ie.payload->>'city' AS city,
          ie.payload->>'state' AS state,
          ie.payload->>'zip' AS zip,
          ie.source_system,
          ie.source_channel,
          CASE
            WHEN COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill')::numeric
            ELSE NULL
          END AS monthly_bill_amount,
          ie.utm_source,
          ie.utm_medium,
          ie.utm_campaign,
          ie.utm_content,
          ie.utm_term,
          ie.gclid,
          ie.fbclid,
          false AS is_duplicate,
          false AS is_duplicate_flagged,
          CASE
            WHEN COALESCE(ie.duplicate_result->>'score', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (ie.duplicate_result->>'score')::numeric
            ELSE NULL
          END AS duplicate_score,
          ie.duplicate_result->>'match_id' AS duplicate_of_id,
          NULL::numeric AS opportunity_score,
          NULL::text AS opportunity_grade,
          COALESCE((ie.payload->>'consent_given')::boolean, false) AS consent_given,
          ie.occurred_at AS created_at,
          ie.created_at AS updated_at,
          'pending_review'::text AS enrichment_status,
          NULL::text AS property_status,
          NULL::text AS solar_status,
          NULL::text AS utility_status,
          NULL::timestamptz AS enrichment_completed_at,
          NULL::integer AS enrichment_duration_ms,
          NULL::numeric AS peak_sun_hours_daily,
          NULL::numeric AS recommended_system_kw,
          NULL::numeric AS annual_savings_year1,
          NULL::numeric AS estimated_system_cost_net,
          NULL::numeric AS payback_period_years,
          ie.payload->>'utility_provider' AS utility_name,
          NULL::numeric AS electricity_rate_kwh,
          NULL::boolean AS net_metering_available,
          ie.action AS last_event_action,
          ie.occurred_at AS last_event_at,
          ie.error_code,
          ie.error_message,
          ie.validation_result,
          ie.duplicate_result,
          ie.pipeline_result,
          ie.payload AS intake_metadata,
          COALESCE(q.payload, '{}'::jsonb) AS qualification_payload,
          COALESCE(q.payload->'intelligence', '{}'::jsonb) AS qualification_intelligence,
          q.event_id AS qualification_event_id,
          q.payload->'intelligence'->>'qualification_status' AS qualification_status,
          q.payload->'intelligence'->>'lead_grade' AS lead_grade,
          CASE
            WHEN q.payload->'intelligence' ? 'finance_readiness'
              THEN (q.payload->'intelligence'->>'finance_readiness')::boolean
            ELSE NULL
          END AS finance_readiness,
          CASE
            WHEN q.payload->'intelligence' ? 'battery_readiness'
              THEN (q.payload->'intelligence'->>'battery_readiness')::boolean
            ELSE NULL
          END AS battery_readiness,
          COALESCE(q.payload->'intelligence'->'normalized'->>'estimated_income_band', q.payload->'qualification'->>'estimated_income_band') AS estimated_income_band,
          COALESCE(q.payload->'intelligence'->'normalized'->>'estimated_credit_band', q.payload->'qualification'->>'estimated_credit_band') AS estimated_credit_band,
          COALESCE(q.payload->'intelligence'->'normalized'->>'sunlight_confidence', q.payload->'qualification'->>'sunlight_confidence') AS sunlight_confidence,
          COALESCE(q.payload->'intelligence'->'normalized'->>'property_type', q.payload->'qualification'->>'property_type') AS property_type,
          ie.payload->>'utility_provider' AS utility_provider,
          ie.payload->>'battery_interest' AS battery_interest,
          COALESCE(ie.payload->>'homeowner_status', ie.payload->>'home_ownership') AS homeowner_status,
          ie.payload->>'preferred_contact_method' AS preferred_contact_method,
          ie.payload->>'timeline' AS timeline,
          COALESCE(ie.payload->>'roof_age', ie.payload->>'roof_age_years') AS roof_age,
          COALESCE(ie.payload->'bill_metadata', '{}'::jsonb) AS bill_metadata,
          ie.action IN ('validation_failed', 'malformed', 'error') AS debug_visible
        FROM intake_events ie
        LEFT JOIN LATERAL (
          SELECT qie.event_id, qie.payload, qie.occurred_at
          FROM intake_events qie
          WHERE qie.event_type = 'homeowner_qualification'
            AND (
              qie.original_event_id = ie.event_id OR
              qie.payload->>'original_event_id' = ie.event_id
            )
          ORDER BY qie.occurred_at DESC
          LIMIT 1
        ) q ON true
        WHERE ie.opportunity_id IS NULL
          AND ie.event_type = 'homeowner_intake'
      ),
      combined AS (
        SELECT * FROM opportunity_rows
        UNION ALL
        SELECT * FROM event_rows
      ),
      filtered AS (
        SELECT * FROM combined c
        WHERE (${includeDebug}::boolean OR COALESCE(c.debug_visible, false) = false)
          AND (${status}::text IS NULL OR c.status = ${status})
          AND (${source_system}::text IS NULL OR c.source_system = ${source_system})
          AND (${source_channel}::text IS NULL OR c.source_channel = ${source_channel})
          AND (${from}::text IS NULL OR c.created_at >= ${from}::timestamptz)
          AND (${to}::text IS NULL OR c.created_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
          AND (${search}::text IS NULL OR (
            c.first_name ILIKE ('%' || ${search} || '%') OR
            c.last_name ILIKE ('%' || ${search} || '%') OR
            c.email ILIKE ('%' || ${search} || '%') OR
            c.phone ILIKE ('%' || ${search} || '%') OR
            c.address_line1 ILIKE ('%' || ${search} || '%') OR
            c.city ILIKE ('%' || ${search} || '%') OR
            c.utility_provider ILIKE ('%' || ${search} || '%') OR
            c.battery_interest ILIKE ('%' || ${search} || '%') OR
            c.timeline ILIKE ('%' || ${search} || '%')
          ))
      )
      SELECT *, COUNT(*) OVER() AS __total
      FROM filtered
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = Number(feedRows[0]?.__total) || 0;
    const opportunities = feedRows.map((row: Record<string, unknown>) => {
      const { __total, ...rest } = row;
      return rest;
    });

    stage = 'stats_query';
    const statsResult = await sql`
      WITH combined AS (
        SELECT
          no.source_system,
          no.source_channel,
          no.created_at,
          no.duplicate_flag AS is_duplicate_flagged,
          no.duplicate_score,
          'created'::text AS action,
          false AS debug_visible
        FROM network_opportunities no
        WHERE no.source_system IS NOT NULL
        UNION ALL
        SELECT
          ie.source_system,
          ie.source_channel,
          ie.occurred_at AS created_at,
          false AS is_duplicate_flagged,
          CASE
            WHEN COALESCE(ie.duplicate_result->>'score', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (ie.duplicate_result->>'score')::numeric
            ELSE NULL
          END AS duplicate_score,
          ie.action,
          ie.action IN ('validation_failed', 'malformed', 'error') AS debug_visible
        FROM intake_events ie
        WHERE ie.opportunity_id IS NULL
          AND ie.event_type = 'homeowner_intake'
      )
      SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND (${includeDebug}::boolean OR debug_visible = false)) AS today_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', NOW()) AND (${includeDebug}::boolean OR debug_visible = false)) AS week_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) AND (${includeDebug}::boolean OR debug_visible = false)) AS month_count,
        COUNT(*) FILTER (WHERE is_duplicate_flagged = true AND (${includeDebug}::boolean OR debug_visible = false)) AS flagged_duplicates,
        COUNT(*) FILTER (WHERE duplicate_score >= 0.90 AND (${includeDebug}::boolean OR debug_visible = false)) AS blocked_duplicates,
        COUNT(*) FILTER (WHERE ${includeDebug}::boolean OR debug_visible = false) AS total_all_time,
        COUNT(*) FILTER (WHERE debug_visible = true) AS debug_hidden_count,
        COUNT(*) FILTER (WHERE action = 'pending_review') AS pending_review_count
      FROM combined
    `;

    stage = 'today_events_query';
    const todayEvents = await sql`
      SELECT action, COUNT(*) AS count
      FROM intake_events
      WHERE occurred_at >= CURRENT_DATE
      GROUP BY action
      ORDER BY count DESC
    `;

    stage = 'top_sources_query';
    const topSources = await sql`
      WITH combined AS (
        SELECT source_system, source_channel, created_at, false AS debug_visible
        FROM network_opportunities
        WHERE source_system IS NOT NULL
        UNION ALL
        SELECT source_system, source_channel, occurred_at AS created_at, action IN ('validation_failed', 'malformed', 'error') AS debug_visible
        FROM intake_events
        WHERE opportunity_id IS NULL
          AND event_type = 'homeowner_intake'
      )
      SELECT
        source_system,
        source_channel,
        CONCAT(COALESCE(source_system, 'unknown'), '/', COALESCE(source_channel, 'unknown')) AS source,
        COUNT(*) AS count,
        COUNT(*) AS clean_count
      FROM combined
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND (${includeDebug}::boolean OR debug_visible = false)
      GROUP BY source_system, source_channel
      ORDER BY count DESC
      LIMIT 10
    `;

    stage = 'validation_stats_query';
    const validationStats = await sql`
      SELECT
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE action = 'validation_failed') AS validation_failures,
        COUNT(*) FILTER (WHERE action IN ('created', 'pending_review')) AS created,
        COUNT(*) FILTER (WHERE action = 'duplicate_blocked') AS blocked,
        COUNT(*) FILTER (WHERE action = 'duplicate_flagged') AS flagged,
        COUNT(*) FILTER (WHERE action = 'malformed') AS malformed,
        COUNT(*) FILTER (WHERE action = 'error') AS errors
      FROM intake_events
      WHERE occurred_at >= NOW() - INTERVAL '7 days'
    `;

    const vs = validationStats[0] || {};
    const totalEvents = Number(vs.total_events) || 0;

    return NextResponse.json({
      success: true,
      opportunities,
      total,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        has_prev: page > 1,
      },
      stats: {
        ...(statsResult[0] || {}),
        total,
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
    console.error(`[GET /api/admin/network/intake] stage=${stage} Error:`, err);
    return intakeFeedError(stage, err);
  }
}
