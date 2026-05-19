export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { runScreeningPipeline } from '@/lib/network/screeningPipeline'
import { scoreOpportunity, scoreToListingPrice } from '@/lib/network/opportunityScorer'
import { matchContractors } from '@/lib/network/contractorMatcher'
import { logNetworkEvent } from '@/lib/network/attributionTracker'

type OpportunityType = 'solar' | 'roofing' | 'battery' | 'service_call'
type LeadQuality = 'high' | 'medium' | 'low' | 'bad'
type SimulatorStage = 'auth' | 'request_parse' | 'db_connect' | 'opportunity_insert' | 'intake_events_insert' | 'network_events_insert' | 'screening_call' | 'scoring_call' | 'release_update' | 'matching_call' | 'archive_update' | 'delete_update' | 'response_build'

function jsonError(error: string, status = 400, details?: unknown) { return NextResponse.json({ success: false, error, details }, { status }) }
function eventId(prefix = 'sim') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` }

function simulatorError(stage: SimulatorStage, error: unknown) {
  const err = error as { message?: string; code?: string; detail?: string; constraint?: string; column?: string }
  return NextResponse.json({
    success: false,
    error: 'Simulator create failed',
    stage,
    message: err?.message ?? String(error),
    code: err?.code,
    details: { detail: err?.detail, constraint: err?.constraint, column: err?.column },
  }, { status: 500 })
}

function logStage(stage: SimulatorStage, data: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console -- temporary structured admin debug logging, no secrets emitted
  console.info('[network-simulator]', { stage, ...data })
}

function toPostgresTextArray(values: string[]) {
  return `{${values.map((value) => `\"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}\"`).join(',')}}`
}

function defaults(type: OpportunityType, quality: LeadQuality) {
  const base = { monthly_bill: type === 'service_call' ? 90 : 260, estimated_project_value: type === 'battery' ? 42000 : type === 'roofing' ? 28000 : type === 'service_call' ? 1800 : 36000, battery_interest: type === 'battery', roof_age_years: type === 'roofing' ? 24 : 8, structure_type: 'single_family' }
  if (quality === 'high') return { ...base, monthly_bill: Math.max(base.monthly_bill, 340), roof_age_years: 4 }
  if (quality === 'low') return { ...base, monthly_bill: 95, roof_age_years: 18 }
  if (quality === 'bad') return { ...base, monthly_bill: 40, roof_age_years: 30 }
  return base
}

async function requireSuperAdmin(req: NextRequest) {
  const admin = await requireAdminApi(req)
  if (!admin) return { ok: false as const, response: jsonError('Forbidden', 403) }
  if (admin.role !== 'super_admin') return { ok: false as const, response: jsonError('Only super_admin can use the intake simulator', 403) }
  return { ok: true as const, admin }
}

async function scoreAndPersist(sql: Awaited<ReturnType<typeof getDbReady>>, opportunityId: string, adminId: string) {
  const rows = await sql`SELECT * FROM network_opportunities WHERE id = ${opportunityId} LIMIT 1`
  const opp = rows[0] as Record<string, unknown> | undefined
  if (!opp) throw new Error('Opportunity not found')
  const scored = scoreOpportunity({
    monthly_bill: (opp.monthly_bill ?? opp.monthly_usage_avg_kwh) as number,
    state: (opp.state ?? opp.location_state) as string,
    roof_age_years: opp.roof_age_years as number,
    structure_type: opp.structure_type as string,
    usable_roof_pct: (opp.usable_roof_pct ?? opp.roof_usable_pct) as number,
    stories: opp.stories as number,
    source_type: opp.source_type as string,
    estimated_system_size_kw: opp.estimated_system_size_kw as number,
    annual_usage_kwh: opp.annual_usage_kwh as number,
    battery_interest: (opp.battery_interest ?? opp.battery_candidate) as boolean,
  })
  const pricing = scoreToListingPrice(scored.overall_score, scored.overall_grade)
  const networkGrade = ['A+', 'A', 'B', 'C'].includes(scored.overall_grade) ? scored.overall_grade : null
  const networkScore = Math.round(scored.overall_score)
  await sql`UPDATE network_opportunities SET opportunity_score = ${networkScore}, opportunity_grade = ${networkGrade}, asking_price = COALESCE(asking_price, ${pricing.price}), scored_at = COALESCE(scored_at, NOW()), updated_at = NOW() WHERE id = ${opportunityId}`
  await sql`INSERT INTO opportunity_intelligence (opportunity_id, overall_score, overall_grade, property_score, solar_score, financial_score, market_score, intent_score, market_price, price_min, price_max, pricing_rationale, risk_flags, opportunity_highlights, executive_summary) VALUES (${opportunityId}, ${scored.overall_score}, ${scored.overall_grade}, ${scored.property.score}, ${scored.solar.score}, ${scored.financial.score}, ${scored.market.score}, ${scored.intent.score}, ${pricing.price}, ${pricing.min}, ${pricing.max}, ${pricing.rationale}, CAST(${toPostgresTextArray(scored.risk_flags)} AS text[]), CAST(${toPostgresTextArray(scored.opportunity_highlights)} AS text[]), ${scored.executive_summary}) ON CONFLICT (opportunity_id) DO UPDATE SET overall_score = EXCLUDED.overall_score, overall_grade = EXCLUDED.overall_grade, property_score = EXCLUDED.property_score, solar_score = EXCLUDED.solar_score, financial_score = EXCLUDED.financial_score, market_score = EXCLUDED.market_score, intent_score = EXCLUDED.intent_score, market_price = EXCLUDED.market_price, price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max, pricing_rationale = EXCLUDED.pricing_rationale, risk_flags = EXCLUDED.risk_flags, opportunity_highlights = EXCLUDED.opportunity_highlights, executive_summary = EXCLUDED.executive_summary, updated_at = NOW()`
  return { scored, pricing }
}

async function loadSimulated(sql: Awaited<ReturnType<typeof getDbReady>>) {
  return sql`WITH assignment_summary AS (SELECT opportunity_id, COUNT(*)::int AS assignment_count FROM opportunity_assignments GROUP BY opportunity_id), event_summary AS (SELECT opportunity_id, COUNT(*)::int AS event_count, MAX(occurred_at) AS last_event_at FROM network_events GROUP BY opportunity_id) SELECT no.id, no.status, no.source_type, no.source_channel, no.location_city AS city, no.location_state AS state, no.homeowner_name, no.created_at, no.live_at, no.screening_status, no.raw_payload, no.intake_metadata, oi.overall_score, oi.overall_grade, oi.executive_summary, osq.auto_decision, osq.auto_decision_reason, osq.override_decision, osq.override_reason, osq.confidence_score, osq.step10_fail_reasons, COALESCE(asg.assignment_count, 0) AS assignment_count, COALESCE(evt.event_count, 0) AS event_count, evt.last_event_at FROM network_opportunities no LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id LEFT JOIN assignment_summary asg ON asg.opportunity_id = no.id LEFT JOIN event_summary evt ON evt.opportunity_id = no.id WHERE (no.raw_payload->>'simulated' = 'true' OR no.intake_metadata->>'simulated' = 'true' OR no.source_channel = 'simulator') AND no.status <> 'withdrawn' ORDER BY no.created_at DESC LIMIT 100`
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (!auth.ok) return auth.response
  const sql = await getDbReady()
  return NextResponse.json({ success: true, opportunities: await loadSimulated(sql) })
}

export async function POST(req: NextRequest) {
  let stage: SimulatorStage = 'auth'
  try {
    logStage(stage)
    const auth = await requireSuperAdmin(req)
    if (!auth.ok) return auth.response
    const admin = auth.admin

    stage = 'db_connect'
    logStage(stage)
    const sql = await getDbReady()

    stage = 'request_parse'
    logStage(stage)
    const body = await req.json()
    const action = body.action as string
    const opportunityId = body.opportunity_id as string | undefined

    if (action === 'archive') {
      if (!opportunityId) return jsonError('opportunity_id is required', 400)
      stage = 'archive_update'
      logStage(stage, { opportunityId })
      await sql`UPDATE network_opportunities SET status = 'withdrawn', live_at = NULL, updated_at = NOW() WHERE id = ${opportunityId} AND (raw_payload->>'simulated' = 'true' OR intake_metadata->>'simulated' = 'true' OR source_channel = 'simulator')`
      stage = 'network_events_insert'
      await logNetworkEvent({ event_type: 'simulation.archived', event_category: 'admin', opportunity_id: opportunityId, admin_user_id: admin.id, data: { simulated: true }, triggered_by: 'admin' })
      stage = 'response_build'
      return NextResponse.json({ success: true, action, opportunities: await loadSimulated(sql) })
    }

    if (action === 'delete') {
      if (!opportunityId) return jsonError('opportunity_id is required', 400)
      stage = 'delete_update'
      logStage(stage, { opportunityId })
      await sql`DELETE FROM network_events ne USING network_opportunities no WHERE ne.opportunity_id = no.id AND no.id = ${opportunityId} AND (no.raw_payload->>'simulated' = 'true' OR no.intake_metadata->>'simulated' = 'true' OR no.source_channel = 'simulator')`
      const deleted = await sql`DELETE FROM network_opportunities WHERE id = ${opportunityId} AND (raw_payload->>'simulated' = 'true' OR intake_metadata->>'simulated' = 'true' OR source_channel = 'simulator') RETURNING id`
      stage = 'response_build'
      return NextResponse.json({ success: true, action, deleted: deleted.length, opportunities: await loadSimulated(sql) })
    }

    if (['screen', 'score', 'release', 'match'].includes(action)) {
      if (!opportunityId) return jsonError('opportunity_id is required', 400)
      if (action === 'screen') { stage = 'screening_call'; logStage(stage, { opportunityId }); await runScreeningPipeline(opportunityId) }
      if (action === 'score') { stage = 'scoring_call'; logStage(stage, { opportunityId }); await scoreAndPersist(sql, opportunityId, admin.id); await sql`UPDATE network_opportunities SET status = 'scored', screening_status = CASE WHEN screening_status = 'pending' THEN 'approved' ELSE screening_status END, updated_at = NOW() WHERE id = ${opportunityId}` }
      if (action === 'release') { stage = 'scoring_call'; logStage(stage, { opportunityId }); await scoreAndPersist(sql, opportunityId, admin.id); stage = 'release_update'; await sql`UPDATE network_opportunities SET status = 'live', screening_status = 'approved', live_at = COALESCE(live_at, NOW()), updated_at = NOW() WHERE id = ${opportunityId}` }
      if (action === 'match') { stage = 'matching_call'; logStage(stage, { opportunityId }); const matchResult = await matchContractors(opportunityId, { limit: 10, minScore: 30 }); stage = 'network_events_insert'; await logNetworkEvent({ event_type: 'simulation.match_generated', event_category: 'assignment', opportunity_id: opportunityId, admin_user_id: admin.id, data: { simulated: true, total_eligible: matchResult.total_eligible, returned: matchResult.matches.length }, triggered_by: 'admin' }); stage = 'response_build'; return NextResponse.json({ success: true, action, match_result: matchResult, opportunities: await loadSimulated(sql) }) }
      stage = 'network_events_insert'
      await logNetworkEvent({ event_type: `simulation.${action}`, event_category: 'admin', opportunity_id: opportunityId, admin_user_id: admin.id, data: { simulated: true }, triggered_by: 'admin' })
      stage = 'response_build'
      return NextResponse.json({ success: true, action, opportunities: await loadSimulated(sql) })
    }

    if (action !== 'create') return jsonError('Unsupported simulator action', 400)
    const opportunityType = (body.opportunity_type ?? 'solar') as OpportunityType
    const leadQuality = (body.lead_quality ?? 'medium') as LeadQuality
    const leadKind = (body.lead_kind ?? 'homeowner') as string
    const urgency = (body.urgency ?? '30_days') as string
    const d = defaults(opportunityType, leadQuality)
    const simulatedPayload = { simulated: true, simulator_version: 'v1', opportunity_type: opportunityType, lead_quality: leadQuality, lead_kind: leadKind, urgency, intentionally_bad: leadQuality === 'bad', campaign_attribution: body.campaign_attribution ?? null, created_by_admin_id: admin.id }
    const homeownerName = leadKind === 'commercial' ? `SimCo ${opportunityType}` : `Simulated ${opportunityType.replace('_', ' ')} ${leadQuality}`

    stage = 'opportunity_insert'
    logStage(stage, { opportunityType, leadQuality, leadKind })
    const rows = await sql`INSERT INTO network_opportunities (source_type, source_channel, status, homeowner_name, homeowner_email, homeowner_phone, address, location_city, location_state, location_zip, monthly_usage_avg_kwh, utility_provider, roof_age_years, structure_type, stories, estimated_project_value, battery_candidate, listing_notes, raw_payload, intake_metadata) VALUES (${body.source_type ?? 'homeowner_direct'}, 'simulator', 'intake', ${leadQuality === 'bad' ? null : homeownerName}, ${leadQuality === 'bad' ? 'bad-email' : `sim-${eventId('lead')}@example.test`}, ${leadQuality === 'bad' ? '5555555555' : '5558675309'}, ${body.address ?? '100 Simulator Way'}, ${body.city ?? 'Austin'}, ${body.state ?? 'TX'}, ${body.zip ?? '78701'}, ${body.monthly_bill ?? d.monthly_bill}, ${body.utility_name ?? 'Austin Energy'}, ${d.roof_age_years}, ${d.structure_type}, ${leadKind === 'commercial' ? '2' : '1'}, ${body.estimated_value ?? d.estimated_project_value}, ${d.battery_interest}, ${`Simulated ${opportunityType} ${leadKind} lead (${leadQuality}, ${urgency})`}, ${JSON.stringify(simulatedPayload)}, ${JSON.stringify(simulatedPayload)}) RETURNING id`
    const id = rows[0]?.id as string

    stage = 'intake_events_insert'
    logStage(stage, { opportunityId: id })
    await sql`INSERT INTO intake_events (event_id, opportunity_id, event_type, event_source, source_system, source_channel, payload, pipeline_result, action) VALUES (${eventId('intake')}, ${id}, 'simulation.intake_created', 'admin_simulator', 'admin_simulator', 'simulator', ${JSON.stringify(simulatedPayload)}, ${JSON.stringify({ action: 'created', opportunity_id: id })}, 'created')`

    stage = 'network_events_insert'
    logStage(stage, { opportunityId: id })
    await logNetworkEvent({ event_type: 'opportunity.created', event_category: 'opportunity', opportunity_id: id, admin_user_id: admin.id, data: simulatedPayload, triggered_by: 'admin' })

    if (body.run_screening) { stage = 'screening_call'; logStage(stage, { opportunityId: id }); await runScreeningPipeline(id) }
    if (body.run_scoring) { stage = 'scoring_call'; logStage(stage, { opportunityId: id }); await scoreAndPersist(sql, id, admin.id) }
    if (body.release_to_marketplace) { stage = 'scoring_call'; await scoreAndPersist(sql, id, admin.id); stage = 'release_update'; await sql`UPDATE network_opportunities SET status = 'live', screening_status = 'approved', live_at = COALESCE(live_at, NOW()), updated_at = NOW() WHERE id = ${id}` }
    let matchResult = null
    if (body.generate_matches) { stage = 'matching_call'; logStage(stage, { opportunityId: id }); matchResult = await matchContractors(id, { limit: 10, minScore: 30 }) }

    stage = 'response_build'
    logStage(stage, { opportunityId: id })
    return NextResponse.json({ success: true, action, opportunity_id: id, match_result: matchResult, opportunities: await loadSimulated(sql) })
  } catch (error) {
    console.error('[POST /api/admin/network/simulator]', { stage, error })
    return simulatorError(stage, error)
  }
}
