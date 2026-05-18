/**
 * contractorMatcher.ts
 *
 * SolarPro Network Intelligence OS — Contractor Matching Engine
 *
 * Given a network_opportunity, finds and ranks all eligible contractors
 * using a multi-factor fit score. Returns an ordered list with explanations.
 *
 * Matching Factors (weighted):
 *   Geographic Coverage    30%  — does contractor serve this state?
 *   System Size Fit        20%  — does their typical job size match?
 *   Service Offerings      15%  — residential solar / battery / etc.
 *   Performance Metrics    20%  — close rate, response time, rating
 *   Capacity / Bandwidth   15%  — how busy are they right now?
 */

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ContractorProfile {
  user_id: string
  company_name?: string | null
  service_states?: string[] | null
  min_system_size_kw?: number | null
  max_system_size_kw?: number | null
  services_offered?: string[] | null
  avg_close_rate?: number | null   // 0.0 – 1.0
  avg_response_hours?: number | null
  avg_rating?: number | null       // 1.0 – 5.0
  total_claims?: number | null
  active_claims?: number | null
  max_active_claims?: number | null
  is_active?: boolean | null
  is_verified?: boolean | null
  tier?: string | null             // standard | preferred | elite
}

export interface OpportunityForMatching {
  id: string
  state?: string | null
  estimated_system_size_kw?: number | null
  battery_interest?: boolean | null
  structure_type?: string | null
  opportunity_score?: number | null
}

export interface ContractorMatchScore {
  contractor_id: string
  company_name: string
  overall_score: number         // 0-100
  geo_score: number
  size_fit_score: number
  service_score: number
  performance_score: number
  capacity_score: number
  match_reasons: string[]       // why this is a good match
  match_concerns: string[]      // potential issues
  tier_bonus: number            // bonus for preferred/elite contractors
  recommended: boolean          // top-tier recommendation
}

export interface MatchingResult {
  opportunity_id: string
  total_eligible: number
  matches: ContractorMatchScore[]
  top_match: ContractorMatchScore | null
  matched_at: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Scoring Functions
// ──────────────────────────────────────────────────────────────────────────────

function scoreGeo(
  contractor: ContractorProfile,
  opportunity: OpportunityForMatching
): { score: number; reasons: string[] } {
  const reasons: string[] = []

  if (!opportunity.state) return { score: 75, reasons: ['no_state_on_opportunity'] }

  const served = contractor.service_states ?? []
  const stateUpper = opportunity.state.toUpperCase()

  if (served.includes(stateUpper)) {
    reasons.push(`serves_${stateUpper}`)
    return { score: 100, reasons }
  }

  return { score: 0, reasons: ['does_not_serve_state'] }
}

function scoreSizeFit(
  contractor: ContractorProfile,
  opportunity: OpportunityForMatching
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const estKw = opportunity.estimated_system_size_kw

  if (!estKw) return { score: 80, reasons: ['no_system_size_estimate'] }

  const min = contractor.min_system_size_kw ?? 2
  const max = contractor.max_system_size_kw ?? 25

  if (estKw >= min && estKw <= max) {
    reasons.push('system_size_in_range')
    // Bonus for being well within range (not at edges)
    const rangePct = (estKw - min) / (max - min)
    const score = rangePct > 0.2 && rangePct < 0.8 ? 100 : 85
    return { score, reasons }
  }

  if (estKw < min) {
    const gap = min - estKw
    reasons.push('system_below_minimum')
    return { score: Math.max(20, 70 - gap * 5), reasons }
  }

  // estKw > max
  const gap = estKw - max
  reasons.push('system_above_maximum')
  return { score: Math.max(20, 70 - gap * 3), reasons }
}

function scoreServices(
  contractor: ContractorProfile,
  opportunity: OpportunityForMatching
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const services = contractor.services_offered ?? []
  let score = 60

  // Must have residential solar
  if (services.includes('residential_solar') || services.includes('solar')) {
    score += 25
    reasons.push('offers_residential_solar')
  } else {
    return { score: 20, reasons: ['no_residential_solar'] }
  }

  // Battery match
  if (opportunity.battery_interest && services.includes('battery_storage')) {
    score += 15
    reasons.push('offers_battery_storage')
  }

  // Structure type
  if (opportunity.structure_type === 'commercial' && services.includes('commercial_solar')) {
    score += 10
    reasons.push('offers_commercial_solar')
  }

  return { score: Math.min(100, score), reasons }
}

function scorePerformance(
  contractor: ContractorProfile
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const weights: Array<[number, number]> = []

  // Close rate (40% of performance)
  if (contractor.avg_close_rate != null) {
    const rate = contractor.avg_close_rate  // 0.0 – 1.0
    const s = Math.round(rate * 100)
    weights.push([s, 0.40])
    if (rate >= 0.5) reasons.push('high_close_rate')
  }

  // Response time (30% of performance) — faster = better
  if (contractor.avg_response_hours != null) {
    const h = contractor.avg_response_hours
    const s = h <= 1 ? 100 : h <= 4 ? 90 : h <= 12 ? 75 : h <= 24 ? 60 : h <= 48 ? 40 : 20
    weights.push([s, 0.30])
    if (h <= 4) reasons.push('fast_response_time')
  }

  // Rating (30% of performance)
  if (contractor.avg_rating != null) {
    const s = Math.round(((contractor.avg_rating - 1) / 4) * 100)
    weights.push([s, 0.30])
    if (contractor.avg_rating >= 4.5) reasons.push('highly_rated')
  }

  if (weights.length === 0) return { score: 65, reasons: ['no_performance_data'] }

  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0)
  const score = Math.round(weights.reduce((sum, [s, w]) => sum + s * w, 0) / totalWeight)

  return { score: Math.min(100, Math.max(0, score)), reasons }
}

function scoreCapacity(
  contractor: ContractorProfile
): { score: number; reasons: string[] } {
  const reasons: string[] = []

  const active = contractor.active_claims ?? 0
  const max = contractor.max_active_claims ?? 10

  if (max === 0) return { score: 0, reasons: ['contractor_at_capacity'] }

  const utilization = active / max

  if (utilization >= 1.0) {
    return { score: 0, reasons: ['at_capacity'] }
  }

  let score: number
  if (utilization <= 0.3) {
    score = 100
    reasons.push('high_availability')
  } else if (utilization <= 0.6) {
    score = 80
    reasons.push('good_availability')
  } else if (utilization <= 0.8) {
    score = 55
  } else {
    score = 30
    reasons.push('limited_availability')
  }

  return { score, reasons }
}

function getTierBonus(tier?: string | null): number {
  if (tier === 'elite')     return 10
  if (tier === 'preferred') return 5
  return 0
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Export: matchContractors
// ──────────────────────────────────────────────────────────────────────────────

export async function matchContractors(
  opportunityId: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<MatchingResult> {
  const { limit = 10, minScore = 30 } = options

  // Fetch opportunity
  const oppRows = await sql`
    SELECT id, state, battery_interest, structure_type, opportunity_score,
           scoring_data->>'estimated_system_size_kw' as estimated_system_size_kw
    FROM network_opportunities
    WHERE id = ${opportunityId}
    LIMIT 1
  `
  const opp = (oppRows[0] as OpportunityForMatching | undefined)
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`)

  // Fetch all active contractors
  const contractorRows = await sql`
    SELECT
      cp.user_id,
      cp.company_name,
      cp.service_states,
      cp.min_system_size_kw,
      cp.max_system_size_kw,
      cp.services_offered,
      cp.avg_close_rate,
      cp.avg_response_hours,
      cp.avg_rating,
      cp.total_claims,
      cp.active_claims,
      cp.max_active_claims,
      cp.is_active,
      cp.is_verified,
      cp.tier
    FROM contractor_profiles cp
    WHERE cp.is_active = true
    ORDER BY cp.avg_rating DESC NULLS LAST
  `
  const contractors = contractorRows as ContractorProfile[]

  const matches: ContractorMatchScore[] = []

  for (const contractor of contractors) {
    const geo        = scoreGeo(contractor, opp)
    const sizeFit    = scoreSizeFit(contractor, opp)
    const services   = scoreServices(contractor, opp)
    const performance = scorePerformance(contractor)
    const capacity   = scoreCapacity(contractor)
    const tierBonus  = getTierBonus(contractor.tier)

    // Skip if geo fails — contractor doesn't serve this state
    if (geo.score === 0) continue

    // Skip if at capacity
    if (capacity.score === 0) continue

    // Weighted overall
    const overall = Math.min(100, Math.round(
      geo.score        * 0.30 +
      sizeFit.score    * 0.20 +
      services.score   * 0.15 +
      performance.score * 0.20 +
      capacity.score   * 0.15 +
      tierBonus
    ))

    if (overall < minScore) continue

    const match_reasons = [
      ...geo.reasons,
      ...sizeFit.reasons,
      ...services.reasons,
      ...performance.reasons,
      ...capacity.reasons,
    ].filter(r => !r.includes('no_') && !r.includes('does_not') && !r.includes('below') && !r.includes('above'))

    const match_concerns = [
      ...sizeFit.reasons.filter(r => r.includes('below') || r.includes('above')),
      ...capacity.reasons.filter(r => r.includes('limited') || r.includes('capacity')),
    ]

    matches.push({
      contractor_id: contractor.user_id,
      company_name: contractor.company_name ?? 'Unknown Contractor',
      overall_score: overall,
      geo_score: geo.score,
      size_fit_score: sizeFit.score,
      service_score: services.score,
      performance_score: performance.score,
      capacity_score: capacity.score,
      match_reasons,
      match_concerns,
      tier_bonus: tierBonus,
      recommended: overall >= 75 && match_concerns.length === 0,
    })
  }

  // Sort by score descending
  matches.sort((a, b) => b.overall_score - a.overall_score)
  const topMatches = matches.slice(0, limit)

  const result: MatchingResult = {
    opportunity_id: opportunityId,
    total_eligible: matches.length,
    matches: topMatches,
    top_match: topMatches[0] ?? null,
    matched_at: new Date().toISOString(),
  }

  // Persist top match summary to opportunity_intelligence
  if (topMatches.length > 0) {
    const matchSummary = topMatches.slice(0, 5).map(m => ({
      contractor_id: m.contractor_id,
      company_name: m.company_name,
      score: m.overall_score,
      recommended: m.recommended,
    }))

    await sql`
      INSERT INTO opportunity_intelligence (
        opportunity_id,
        total_eligible_contractors,
        top_match_contractor_id,
        top_match_score,
        match_summary,
        overall_score,
        overall_grade
      )
      VALUES (
        ${opportunityId},
        ${matches.length},
        ${topMatches[0].contractor_id},
        ${topMatches[0].overall_score},
        ${JSON.stringify(matchSummary)},
        ${opp.opportunity_score ?? 0},
        'C'
      )
      ON CONFLICT (opportunity_id) DO UPDATE SET
        total_eligible_contractors = ${matches.length},
        top_match_contractor_id    = ${topMatches[0].contractor_id},
        top_match_score            = ${topMatches[0].overall_score},
        match_summary              = ${JSON.stringify(matchSummary)},
        updated_at                 = NOW()
    `
  }

  return result
}

/**
 * isContractorEligible
 * Quick check: can this contractor see/claim this opportunity?
 */
export async function isContractorEligible(
  contractorId: string,
  opportunityId: string
): Promise<{ eligible: boolean; reason?: string }> {
  const contractorRows2 = await sql`
    SELECT service_states, is_active FROM contractor_profiles WHERE user_id = ${contractorId} LIMIT 1
  `
  const contractor = contractorRows2[0] as ContractorProfile | undefined
  if (!contractor) return { eligible: false, reason: 'no_contractor_profile' }
  if (!contractor.is_active) return { eligible: false, reason: 'contractor_inactive' }

  const oppRows2 = await sql`
    SELECT state FROM network_opportunities WHERE id = ${opportunityId} LIMIT 1
  `
  const opp = oppRows2[0] as { state: string } | undefined
  if (!opp) return { eligible: false, reason: 'opportunity_not_found' }

  const served = contractor.service_states ?? []
  if (!served.includes(opp.state?.toUpperCase() ?? '')) {
    return { eligible: false, reason: 'state_not_covered' }
  }

  return { eligible: true }
}
