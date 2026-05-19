/**
 * /api/admin/network/screening
 *
 * Screening queue management for the Admin Control Center.
 *
 * GET  /api/admin/network/screening  — list screening queue
 * POST /api/admin/network/screening  — trigger screening for an opportunity
 * PATCH /api/admin/network/screening — override screening decision
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { runScreeningPipeline } from '@/lib/network/screeningPipeline'
import { logNetworkEvent } from '@/lib/network/attributionTracker'
import { scoreOpportunity, scoreToListingPrice } from '@/lib/network/opportunityScorer'

// ── GET: Screening queue ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const { searchParams } = new URL(req.url)
    const pipelineStatus = searchParams.get('status')   // pending | running | completed | failed
    const autoDecision   = searchParams.get('decision') // pass | fail | needs_review
    const page  = parseInt(searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '25'), 100)
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        osq.*,
        no.homeowner_first_name,
        no.homeowner_last_name,
        no.homeowner_phone,
        no.address,
        no.city,
        no.state,
        no.source_type,
        no.status AS opportunity_status,
        no.created_at AS opportunity_created_at
      FROM opportunity_screening_queue osq
      JOIN network_opportunities no ON no.id = osq.opportunity_id
      WHERE
        (${pipelineStatus ?? null} IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ''})
        AND (${autoDecision ?? null} IS NULL OR osq.auto_decision = ${autoDecision ?? ''})
      ORDER BY osq.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const countRows = await sql`
      SELECT COUNT(*)::int as total
      FROM opportunity_screening_queue osq
      WHERE
        (${pipelineStatus ?? null} IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ''})
        AND (${autoDecision ?? null} IS NULL OR osq.auto_decision = ${autoDecision ?? ''})
    `
    const countResult = countRows[0] as Record<string, unknown>

    const statsRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE pipeline_status = 'pending')      AS pending,
        COUNT(*) FILTER (WHERE pipeline_status = 'running')      AS running,
        COUNT(*) FILTER (WHERE pipeline_status = 'completed')    AS completed,
        COUNT(*) FILTER (WHERE pipeline_status = 'failed')       AS failed,
        COUNT(*) FILTER (WHERE auto_decision = 'pass')           AS auto_passed,
        COUNT(*) FILTER (WHERE auto_decision = 'fail')           AS auto_failed,
        COUNT(*) FILTER (WHERE auto_decision = 'needs_review')   AS needs_review,
        COUNT(*) FILTER (WHERE override_decision IS NOT NULL)    AS overridden,
        AVG(duration_ms)                                         AS avg_duration_ms
      FROM opportunity_screening_queue
    `
    const stats = statsRows[0] as Record<string, unknown>

    return NextResponse.json({
      success: true,
      queue: rows,
      pagination: {
        page,
        limit,
        total: countResult.total,
        pages: Math.ceil((countResult.total as number) / limit),
      },
      stats,
    })
  } catch (error) {
    console.error('[GET /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST: Trigger screening ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { opportunity_id } = body

    if (!opportunity_id) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    // Run the pipeline
    const result = await runScreeningPipeline(opportunity_id)

    await logNetworkEvent({
      event_type: 'opportunity.screening_started',
      event_category: 'opportunity',
      opportunity_id,
      admin_user_id: admin.id,
      data: { triggered_by_admin: true, decision: result.auto_decision },
      triggered_by: 'admin',
    })

    return NextResponse.json({
      success: true,
      result: {
        opportunity_id: result.opportunity_id,
        decision: result.auto_decision,
        decision_reason: result.auto_decision_reason,
        confidence: result.confidence_score,
        duration_ms: result.duration_ms,
        fail_reasons: result.fail_reasons,
        review_flags: result.review_flags,
      },
    })
  } catch (error) {
    console.error('[POST /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


async function scoreAndPersistOpportunity(sql: Awaited<ReturnType<typeof getDbReady>>, opportunity_id: string, adminId: string) {
  const rows = await sql`SELECT * FROM network_opportunities WHERE id = ${opportunity_id} LIMIT 1`
  const opp = rows[0] as Record<string, unknown> | undefined
  if (!opp) throw new Error('Opportunity not found')

  const scored = scoreOpportunity({
    monthly_bill: opp.monthly_bill as number,
    state: (opp.state ?? opp.location_state) as string,
    roof_age_years: opp.roof_age_years as number,
    structure_type: opp.structure_type as string,
    usable_roof_pct: (opp.usable_roof_pct ?? opp.roof_usable_pct) as number,
    stories: opp.stories as number,
    source_type: opp.source_type as string,
    peak_sun_hours: opp.peak_sun_hours_annual as number,
    estimated_system_size_kw: opp.estimated_system_size_kw as number,
    annual_usage_kwh: opp.annual_usage_kwh as number,
    battery_interest: (opp.battery_interest ?? opp.battery_candidate) as boolean,
    avg_rate_kwh: opp.utility_rate_per_kwh as number,
    net_metering: opp.net_metering_type ? true : null,
  })
  const pricing = scoreToListingPrice(scored.overall_score, scored.overall_grade)
  const networkOpportunityGrade = ['A+', 'A', 'B', 'C'].includes(scored.overall_grade) ? scored.overall_grade : null

  await sql`
    UPDATE network_opportunities SET
      opportunity_score = ${scored.overall_score},
      opportunity_grade = ${networkOpportunityGrade},
      listing_price = ${pricing.price},
      asking_price = COALESCE(asking_price, ${pricing.price}),
      scoring_data = ${JSON.stringify(scored)},
      scored_at = COALESCE(scored_at, NOW()),
      updated_at = NOW()
    WHERE id = ${opportunity_id}
  `

  await sql`
    INSERT INTO opportunity_intelligence (
      opportunity_id, overall_score, overall_grade,
      property_score, solar_score, financial_score, market_score, intent_score,
      market_price, price_min, price_max, pricing_rationale,
      risk_flags, opportunity_highlights, executive_summary
    ) VALUES (
      ${opportunity_id}, ${scored.overall_score}, ${scored.overall_grade},
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
      price_min = EXCLUDED.price_min,
      price_max = EXCLUDED.price_max,
      pricing_rationale = EXCLUDED.pricing_rationale,
      risk_flags = EXCLUDED.risk_flags,
      opportunity_highlights = EXCLUDED.opportunity_highlights,
      executive_summary = EXCLUDED.executive_summary,
      updated_at = NOW()
  `

  return { scored, pricing }
}

// ── PATCH: Override screening decision ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const body = await req.json()
    const { opportunity_id, action, decision, reason } = body as {
      opportunity_id: string
      action?: 'approve' | 'reject' | 'request_more_info' | 'release_to_marketplace'
      decision?: 'pass' | 'fail' | 'hold'
      reason?: string
    }

    if (!opportunity_id) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    const normalizedAction = action ?? (
      decision === 'pass' ? 'approve' :
      decision === 'fail' ? 'reject' :
      decision === 'hold' ? 'request_more_info' : undefined
    )

    if (!normalizedAction) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 })
    }

    const oppRows = await sql`
      SELECT no.id, no.status, no.screening_status, osq.auto_decision, osq.override_decision
      FROM network_opportunities no
      LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
      WHERE no.id = ${opportunity_id}
      LIMIT 1
    `
    const opp = oppRows[0] as Record<string, unknown> | undefined
    if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    let newStatus = String(opp.status ?? 'screening')
    let screeningStatus = String(opp.screening_status ?? 'pending')
    let overrideDecision: 'pass' | 'fail' | 'hold' | null = null
    let eventType = 'screening.override'
    let responsePayload: Record<string, unknown> = {}

    if (normalizedAction === 'approve') {
      overrideDecision = 'pass'
      screeningStatus = 'approved'
      newStatus = 'scored'
      await scoreAndPersistOpportunity(sql, opportunity_id, admin.id)
      responsePayload = { action: normalizedAction, screening_status: screeningStatus, new_status: newStatus }
    } else if (normalizedAction === 'reject') {
      overrideDecision = 'fail'
      screeningStatus = 'rejected'
      newStatus = 'rejected'
      responsePayload = { action: normalizedAction, screening_status: screeningStatus, new_status: newStatus }
    } else if (normalizedAction === 'request_more_info') {
      overrideDecision = 'hold'
      screeningStatus = 'escalated'
      newStatus = 'screening'
      responsePayload = { action: normalizedAction, screening_status: 'needs_more_info', stored_screening_status: screeningStatus, new_status: newStatus }
    } else if (normalizedAction === 'release_to_marketplace') {
      const approved = opp.screening_status === 'approved' || opp.override_decision === 'pass' || opp.auto_decision === 'pass'
      if (!approved) {
        return NextResponse.json({ error: 'Opportunity must be approved by screening before marketplace release' }, { status: 409 })
      }
      const { scored, pricing } = await scoreAndPersistOpportunity(sql, opportunity_id, admin.id)
      overrideDecision = 'pass'
      screeningStatus = 'approved'
      newStatus = 'live'
      eventType = 'opportunity.published'
      responsePayload = {
        action: normalizedAction,
        screening_status: screeningStatus,
        new_status: newStatus,
        score: scored.overall_score,
        grade: scored.overall_grade,
        market_price: pricing.price,
      }
    }

    await sql`
      UPDATE opportunity_screening_queue SET
        override_decision = ${overrideDecision},
        override_by       = ${admin.id},
        override_reason   = ${reason ?? null},
        override_at       = NOW(),
        updated_at        = NOW()
      WHERE opportunity_id = ${opportunity_id}
    `

    await sql`
      UPDATE network_opportunities SET
        status = ${newStatus},
        screening_status = ${screeningStatus},
        screened_by_admin_id = ${admin.id},
        screening_notes = ${reason ?? null},
        screened_at = COALESCE(screened_at, NOW()),
        live_at = CASE WHEN ${newStatus} = 'live' THEN COALESCE(live_at, NOW()) ELSE live_at END,
        expires_at = CASE WHEN ${newStatus} = 'live' THEN GREATEST(expires_at, NOW() + INTERVAL '30 days') ELSE expires_at END,
        updated_at = NOW()
      WHERE id = ${opportunity_id}
    `

    await logNetworkEvent({
      event_type: eventType,
      event_category: normalizedAction === 'release_to_marketplace' ? 'opportunity' : 'screening',
      opportunity_id,
      admin_user_id: admin.id,
      data: { action: normalizedAction, reason, ...responsePayload },
      from_status: String(opp.status ?? ''),
      to_status: newStatus,
      triggered_by: 'admin',
    })

    return NextResponse.json({ success: true, ...responsePayload })
  } catch (error) {
    console.error('[PATCH /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
