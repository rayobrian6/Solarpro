/**
 * /api/admin/network/opportunities
 *
 * Live opportunity feed for the Admin Control Center.
 *
 * GET   — list opportunities with filters + pagination
 * POST  — manually create an opportunity
 * PATCH — bulk action (publish / reject / score / set_status)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';
import { scoreOpportunity, scoreToListingPrice } from '@/lib/network/opportunityScorer';
import { logNetworkEvent } from '@/lib/network/attributionTracker';

// ── GET: List opportunities ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status');
    const source  = searchParams.get('source');
    const state   = searchParams.get('state');
    const grade   = searchParams.get('grade');
    const search  = searchParams.get('search');
    const page    = parseInt(searchParams.get('page') ?? '1');
    const limit   = Math.min(parseInt(searchParams.get('limit') ?? '25'), 100);
    const offset  = (page - 1) * limit;

    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        no.*,
        oi.overall_score,
        oi.overall_grade,
        oi.property_score,
        oi.solar_score,
        oi.financial_score,
        oi.market_score,
        oi.intent_score      AS oi_intent_score,
        oi.market_price,
        oi.risk_flags,
        oi.opportunity_highlights,
        oi.executive_summary,
        oi.total_eligible_contractors,
        osq.pipeline_status,
        osq.auto_decision,
        osq.confidence_score,
        os.source_type       AS attr_source_type,
        os.platform,
        os.utm_campaign,
        os.cost_per_lead
      FROM network_opportunities no
      LEFT JOIN opportunity_intelligence    oi  ON oi.opportunity_id  = no.id
      LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
      LEFT JOIN opportunity_sources         os  ON os.opportunity_id  = no.id
      WHERE
        (${status ?? null} IS NULL OR no.status = ${status ?? ''})
        AND (${source ?? null} IS NULL OR no.source_type = ${source ?? ''})
        AND (${state ?? null} IS NULL OR no.state = ${state ?? ''})
        AND (${grade ?? null} IS NULL OR oi.overall_grade = ${grade ?? ''})
        AND (
          ${search ?? null} IS NULL
          OR no.homeowner_first_name ILIKE ${'%' + (search ?? '') + '%'}
          OR no.homeowner_last_name  ILIKE ${'%' + (search ?? '') + '%'}
          OR no.homeowner_phone      ILIKE ${'%' + (search ?? '') + '%'}
          OR no.address              ILIKE ${'%' + (search ?? '') + '%'}
          OR no.city                 ILIKE ${'%' + (search ?? '') + '%'}
        )
      ORDER BY no.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [countRow] = await sql`
      SELECT COUNT(*)::int as total
      FROM network_opportunities no
      LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
      WHERE
        (${status ?? null} IS NULL OR no.status = ${status ?? ''})
        AND (${source ?? null} IS NULL OR no.source_type = ${source ?? ''})
        AND (${state ?? null} IS NULL OR no.state = ${state ?? ''})
        AND (${grade ?? null} IS NULL OR oi.overall_grade = ${grade ?? ''})
    `;

    const [stats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE no.status = 'live')    AS live_count,
        COUNT(*) FILTER (WHERE no.status = 'screening') AS screening_count,
        COUNT(*) FILTER (WHERE no.status = 'scored')  AS scored_count,
        COUNT(*) FILTER (WHERE no.status = 'claimed') AS claimed_count,
        COUNT(*) FILTER (WHERE no.status = 'rejected') AS rejected_count,
        COUNT(*) FILTER (WHERE no.created_at > NOW() - INTERVAL '24 hours') AS last_24h,
        AVG(oi.overall_score) AS avg_score,
        COUNT(*) FILTER (WHERE oi.overall_grade IN ('A+','A')) AS high_grade_count
      FROM network_opportunities no
      LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
    `;

    return NextResponse.json({
      success: true,
      opportunities: rows,
      pagination: {
        page,
        limit,
        total: countRow.total,
        pages: Math.ceil(countRow.total / limit),
      },
      stats,
    });
  } catch (error: unknown) {
    console.error('[GET /api/admin/network/opportunities]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST: Manually create opportunity ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const {
      homeowner_first_name, homeowner_last_name,
      homeowner_email, homeowner_phone,
      address, city, state, zip,
      monthly_bill, utility_name,
      roof_age_years, structure_type, stories,
      source_type = 'homeowner_direct',
      intake_notes,
    } = body;

    if (!homeowner_phone || !state) {
      return NextResponse.json({ error: 'phone and state are required' }, { status: 400 });
    }

    const sql = await getDbReady();
    const [created] = await sql`
      INSERT INTO network_opportunities (
        source_type, status,
        homeowner_first_name, homeowner_last_name,
        homeowner_email, homeowner_phone,
        address, city, state, zip,
        monthly_bill, utility_name,
        roof_age_years, structure_type, stories,
        intake_notes
      ) VALUES (
        ${source_type}, 'intake',
        ${homeowner_first_name ?? null}, ${homeowner_last_name ?? null},
        ${homeowner_email ?? null}, ${homeowner_phone},
        ${address ?? null}, ${city ?? null}, ${state}, ${zip ?? null},
        ${monthly_bill ?? null}, ${utility_name ?? null},
        ${roof_age_years ?? null}, ${structure_type ?? null}, ${stories ?? null},
        ${intake_notes ?? null}
      )
      RETURNING id
    `;

    await logNetworkEvent({
      event_type: 'opportunity.created',
      event_category: 'opportunity',
      opportunity_id: created.id as string,
      admin_user_id: admin.id,
      data: { source_type, state, created_by: 'admin' },
      triggered_by: 'admin',
    });

    return NextResponse.json({ success: true, id: created.id });
  } catch (error: unknown) {
    console.error('[POST /api/admin/network/opportunities]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH: Bulk actions ───────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const { action, opportunity_ids, data: actionData } = body as {
      action: 'publish' | 'reject' | 'score' | 'set_status';
      opportunity_ids: string[];
      data?: Record<string, unknown>;
    };

    if (!action || !opportunity_ids?.length) {
      return NextResponse.json({ error: 'action and opportunity_ids required' }, { status: 400 });
    }

    const sql = await getDbReady();
    const results: string[] = [];

    for (const id of opportunity_ids) {
      if (action === 'publish') {
        const gateRows = await sql`
          SELECT no.status, no.screening_status, osq.auto_decision, osq.override_decision, oi.overall_score
          FROM network_opportunities no
          LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
          LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
          WHERE no.id = ${id}
          LIMIT 1
        `;
        const gate = gateRows[0] as Record<string, unknown> | undefined;
        const screeningApproved = gate?.screening_status === 'approved' || gate?.override_decision === 'pass' || gate?.auto_decision === 'pass';
        const scored = gate?.overall_score != null || gate?.status === 'scored' || gate?.status === 'routed' || gate?.status === 'live';
        if (!screeningApproved || !scored) {
          results.push(`Blocked publish: ${id} requires approved screening and scoring`);
          continue;
        }

        await sql`
          UPDATE network_opportunities SET
            status = 'live',
            published_at = NOW(),
            live_at = COALESCE(live_at, NOW()),
            expires_at = NOW() + INTERVAL '30 days',
            updated_at = NOW()
          WHERE id = ${id}
        `;
        results.push(`Published: ${id}`);

      } else if (action === 'reject') {
        await sql`
          UPDATE network_opportunities SET status = 'rejected', updated_at = NOW()
          WHERE id = ${id}
        `;
        results.push(`Rejected: ${id}`);

      } else if (action === 'score') {
        const rows = await sql`SELECT * FROM network_opportunities WHERE id = ${id} LIMIT 1`;
        const opp = rows[0] as Record<string, unknown> | undefined;
        if (opp) {
          const scored = scoreOpportunity({
            monthly_bill: opp.monthly_bill as number,
            state: opp.state as string,
            roof_age_years: opp.roof_age_years as number,
            structure_type: opp.structure_type as string,
            usable_roof_pct: opp.usable_roof_pct as number,
            stories: opp.stories as number,
            source_type: opp.source_type as string,
          });
          const pricing = scoreToListingPrice(scored.overall_score, scored.overall_grade);
          const networkScore = Math.round(scored.overall_score);

          await sql`
            UPDATE network_opportunities SET
              opportunity_score = ${networkScore},
              listing_price = ${pricing.price},
              scoring_data = ${JSON.stringify(scored)},
              updated_at = NOW()
            WHERE id = ${id}
          `;

          await sql`
            INSERT INTO opportunity_intelligence (
              opportunity_id, overall_score, overall_grade,
              property_score, solar_score, financial_score, market_score, intent_score,
              market_price, price_min, price_max, pricing_rationale,
              risk_flags, opportunity_highlights, executive_summary
            ) VALUES (
              ${id}, ${scored.overall_score}, ${scored.overall_grade},
              ${scored.property.score}, ${scored.solar.score},
              ${scored.financial.score}, ${scored.market.score}, ${scored.intent.score},
              ${pricing.price}, ${pricing.min}, ${pricing.max}, ${pricing.rationale},
              ${JSON.stringify(scored.risk_flags)}, ${JSON.stringify(scored.opportunity_highlights)},
              ${scored.executive_summary}
            )
            ON CONFLICT (opportunity_id) DO UPDATE SET
              overall_score = EXCLUDED.overall_score,
              overall_grade = EXCLUDED.overall_grade,
              property_score = EXCLUDED.property_score,
              solar_score = EXCLUDED.solar_score,
              financial_score = EXCLUDED.financial_score,
              market_score = EXCLUDED.market_score,
              intent_score = EXCLUDED.intent_score,
              market_price = EXCLUDED.market_price,
              risk_flags = EXCLUDED.risk_flags,
              opportunity_highlights = EXCLUDED.opportunity_highlights,
              executive_summary = EXCLUDED.executive_summary,
              updated_at = NOW()
          `;
          results.push(`Scored ${id}: ${scored.overall_grade} (${scored.overall_score})`);
        }

      } else if (action === 'set_status') {
        const newStatus = actionData?.status as string;
        if (newStatus) {
          await sql`
            UPDATE network_opportunities SET status = ${newStatus}, updated_at = NOW()
            WHERE id = ${id}
          `;
          results.push(`Status updated: ${id} → ${newStatus}`);
        }
      }
    }

    await logNetworkEvent({
      event_type: 'admin.bulk_action',
      event_category: 'admin',
      admin_user_id: admin.id,
      data: { action, count: opportunity_ids.length, results },
      triggered_by: 'admin',
    });

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error('[PATCH /api/admin/network/opportunities]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
