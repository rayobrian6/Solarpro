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
 *   Performance Metrics    20%  — close rate and response time  ⚠️ SEE BELOW
 *   Capacity / Bandwidth   15%  — how busy are they right now?
 *
 * 🚨 PERFORMANCE IS NOT MEASURED YET, AND THIS COMMENT USED TO PRETEND IT WAS.
 *
 * `scorePerformance` reads `avg_close_rate` and `avg_response_hours` off
 * `contractor_profiles`. Both columns are real. **Neither has a writer anywhere
 * in app/ or lib/** — the only mutations the contractor-facing Network API
 * offers are profile edits, listing, checkout, claim, unclaim and a listing
 * patch, and not one records an outcome. So both are NULL for every contractor
 * and always have been.
 *
 * What that means for the score, precisely — and it is NOT what it looks like:
 *
 *   • `scorePerformance` normalises over the factors that ACTUALLY contributed
 *     (`totalWeight`), so an absent factor does not drag the sub-score down.
 *   • With nothing to measure it returns a flat 65 and says so
 *     (`no_performance_data`).
 *   • 65 x 0.20 = a constant 13 points added to EVERY contractor.
 *
 * A constant cannot change the ORDER, so matching is not silently mis-ranking
 * anyone. What it does is inflate every absolute score by 13 — and the absolute
 * score is load-bearing twice: `overall < minScore` drops a contractor, and
 * `recommended` is `overall >= 75`. That is why the weight is still 0.20 here
 * and has NOT been quietly removed: deleting it would move every score by ~13
 * points and flip `recommended` for a whole band of contractors. That is a
 * product decision about who gets offered leads, not a tidy-up.
 *
 * So instead the placeholder is made VISIBLE — `performance_measured` on every
 * match, and `no_performance_data` is no longer filtered out of the reasons.
 * See tests/contractorPerformanceIsUnmeasured.test.ts.
 */

import { getDbReady } from '@/lib/db-neon'

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
  // Both read from contractor_profiles. Real columns, no writer yet — see the
  // file header. Kept because they have a home to be written to.
  avg_close_rate?: number | null   // 0.0 – 1.0
  avg_response_hours?: number | null
  // 🚨 `avg_rating` WAS HERE AND IS GONE. It was not merely unwritten: there is
  // no `avg_rating` COLUMN in migration 044, in the 068 repair, or in the
  // legacy inline DDL — the field had nowhere to come from, and both SQL sites
  // that claimed to supply it selected the literal `NULL::numeric AS avg_rating`.
  // So the branch that scored it, and the `highly_rated` reason it could award,
  // were unreachable for every contractor in every code path since they were
  // written. Removing them changes no score. A dormant factor waiting on a
  // writer is worth keeping; a factor with no column is a decoration that makes
  // the engine look like it does something it cannot.
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
  qualification_status?: string | null
  lead_grade?: string | null
  contractor_summary?: string | null
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
  /**
   * 🚨 FALSE MEANS `performance_score` IS A PLACEHOLDER, NOT A MEASUREMENT.
   *
   * It is false for every contractor today, because nothing writes the outcome
   * columns it would be computed from. Exposed so a consumer can say "no
   * performance history" instead of presenting 65 as if it were earned.
   */
  performance_measured: boolean
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

/** The score used when nothing about performance can be measured. */
export const UNMEASURED_PERFORMANCE_SCORE = 65

function scorePerformance(
  contractor: ContractorProfile
): { score: number; reasons: string[]; measured: boolean } {
  const reasons: string[] = []
  const weights: Array<[number, number]> = []

  // Close rate (57% of performance once the rating factor was removed —
  // the ratio between close rate and response time is unchanged at 40:30).
  if (contractor.avg_close_rate != null) {
    const rate = contractor.avg_close_rate  // 0.0 – 1.0
    const s = Math.round(rate * 100)
    weights.push([s, 0.40])
    if (rate >= 0.5) reasons.push('high_close_rate')
  }

  // Response time (43%) — faster = better
  if (contractor.avg_response_hours != null) {
    const h = contractor.avg_response_hours
    const s = h <= 1 ? 100 : h <= 4 ? 90 : h <= 12 ? 75 : h <= 24 ? 60 : h <= 48 ? 40 : 20
    weights.push([s, 0.30])
    if (h <= 4) reasons.push('fast_response_time')
  }

  // 🚨 THIS IS THE LIVE PATH FOR EVERY CONTRACTOR TODAY. Neither column above
  // has a writer, so `weights` is always empty and this always returns. The
  // score normalises over contributing factors, so the flat 65 is a deliberate
  // neutral prior rather than a zero — but it is a PLACEHOLDER, and `measured`
  // is what lets a caller tell the difference between "scored 65" and "not
  // scored". Without it a placeholder is indistinguishable from a measurement.
  if (weights.length === 0) {
    return { score: UNMEASURED_PERFORMANCE_SCORE, reasons: ['no_performance_data'], measured: false }
  }

  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0)
  const score = Math.round(weights.reduce((sum, [s, w]) => sum + s * w, 0) / totalWeight)

  return { score: Math.min(100, Math.max(0, score)), reasons, measured: true }
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
  const sql = await getDbReady()
  const { limit = 10, minScore = 30 } = options

  // Fetch opportunity plus canonical qualification intelligence projection when available.
  const oppRows = await sql`
    SELECT
      no.id,
      UPPER(no.location_state) AS state,
      COALESCE(
        (oi.enrichment_payload->'qualification'->>'battery_readiness')::boolean,
        (oi.enrichment_payload->'qualification'->'matcher_input'->>'battery_interest')::boolean,
        no.battery_candidate
      ) AS battery_interest,
      COALESCE(
        oi.enrichment_payload->'qualification'->'matcher_input'->>'structure_type',
        oi.enrichment_payload->'qualification'->>'property_type',
        no.structure_type
      ) AS structure_type,
      no.opportunity_score,
      no.estimated_system_size_kw,
      oi.enrichment_payload->'qualification'->>'qualification_status' AS qualification_status,
      oi.enrichment_payload->'qualification'->>'lead_grade' AS lead_grade,
      oi.enrichment_payload->'qualification'->>'contractor_summary' AS contractor_summary
    FROM network_opportunities no
    LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
    WHERE no.id = ${opportunityId}
    LIMIT 1
  `
  const opp = (oppRows[0] as OpportunityForMatching | undefined)
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`)

  // Fetch all active contractors
  const contractorRows = await sql`
    SELECT
      cp.user_id,
      COALESCE(NULLIF(u.company, ''), NULLIF(u.name, ''), NULLIF(u.email, ''), 'Unknown Contractor') AS company_name,
      cp.service_states,
      cp.min_project_kw AS min_system_size_kw,
      cp.max_project_kw AS max_system_size_kw,
      ARRAY_REMOVE(ARRAY[
        'residential_solar',
        CASE WHEN cp.battery_certified THEN 'battery_storage' END,
        CASE WHEN cp.commercial_capable THEN 'commercial_solar' END,
        CASE WHEN cp.roofing_capable THEN 'roofing' END,
        CASE WHEN cp.ev_charger_capable THEN 'ev_charger' END,
        CASE WHEN cp.generator_capable THEN 'generator' END
      ], NULL) AS services_offered,
      CASE WHEN cp.avg_close_rate_pct IS NULL THEN NULL ELSE cp.avg_close_rate_pct / 100.0 END AS avg_close_rate,
      cp.avg_response_hours,
      -- A hardcoded null rating column was selected here and has been removed.
      -- It was not a placeholder waiting on data: no such column exists in any
      -- migration, so there was nothing for it to be filled from, ever.
      -- Selecting a literal null under a column alias is how a field that can
      -- NEVER exist gets read as one that merely has no value yet.
      -- (Deliberately worded without the identifier: this is a SQL comment
      --  inside a template literal, which a JS comment stripper cannot see
      --  into, so naming it here would trip the guard that forbids it.)
      COALESCE(claim_counts.total_claims, 0) AS total_claims,
      COALESCE(claim_counts.active_claims, 0) AS active_claims,
      10 AS max_active_claims,
      cp.network_active AS is_active,
      cp.profile_complete AS is_verified,
      CASE WHEN cp.profile_complete THEN 'preferred' ELSE 'standard' END AS tier
    FROM contractor_profiles cp
    JOIN users u ON u.id = cp.user_id
    LEFT JOIN (
      SELECT
        contractor_id,
        COUNT(*)::int AS total_claims,
        COUNT(*) FILTER (WHERE status IN ('offered','viewed','claimed','contacted','appointment','proposal'))::int AS active_claims
      FROM opportunity_assignments
      GROUP BY contractor_id
    ) claim_counts ON claim_counts.contractor_id = cp.user_id
    WHERE cp.network_active = true
    ORDER BY cp.profile_complete DESC, cp.inspection_pass_rate DESC NULLS LAST, cp.avg_response_hours ASC NULLS LAST
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
      opp.qualification_status ? `qualification_${opp.qualification_status}` : null,
      opp.lead_grade ? `lead_grade_${opp.lead_grade}` : null,
    ].filter((r): r is string =>
      // 🚨 `no_performance_data` IS EXEMPT FROM THE `no_` FILTER.
      //
      // The filter strips negative reasons so `match_reasons` reads as a list
      // of positives — sensible for `no_states_configured` and the like. But it
      // also swallowed the ONE marker that says the 20% performance factor was
      // a placeholder, and that marker is true for every contractor. So the
      // engine knew it had no performance history, said so internally, and then
      // deleted the sentence on the way out. The operator saw a score with no
      // indication that a fifth of it was invented.
      !!r && (r === 'no_performance_data'
        || (!r.includes('no_') && !r.includes('does_not') && !r.includes('below') && !r.includes('above'))))

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
      performance_measured: performance.measured,
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
  const sql = await getDbReady()

  const contractorRows2 = await sql`
    SELECT service_states, network_active AS is_active FROM contractor_profiles WHERE user_id = ${contractorId} LIMIT 1
  `
  const contractor = contractorRows2[0] as ContractorProfile | undefined
  if (!contractor) return { eligible: false, reason: 'no_contractor_profile' }
  if (!contractor.is_active) return { eligible: false, reason: 'contractor_inactive' }

  const oppRows2 = await sql`
    SELECT UPPER(location_state) AS state FROM network_opportunities WHERE id = ${opportunityId} LIMIT 1
  `
  const opp = oppRows2[0] as { state: string | null } | undefined
  if (!opp) return { eligible: false, reason: 'opportunity_not_found' }

  const served = contractor.service_states ?? []
  if (!served.includes(opp.state?.toUpperCase() ?? '')) {
    return { eligible: false, reason: 'state_not_covered' }
  }

  return { eligible: true }
}
