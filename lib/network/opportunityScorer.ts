/**
 * opportunityScorer.ts
 *
 * SolarPro Network Intelligence OS — Scoring Engine
 *
 * Computes an overall score (0-100) and grade (A+/A/B/C/D/F) for each
 * network_opportunity using 5 weighted dimensions:
 *
 *   Property Quality     25%   — home value, roof, structure type
 *   Solar Opportunity    25%   — irradiance, system size, savings potential
 *   Financial Fit        20%   — credit proxy, equity, income, finance eligibility
 *   Market Opportunity   15%   — utility rates, NEM, state incentives, competition
 *   Lead Intent          15%   — form quality, source type, engagement signals
 *
 * Grades:
 *   A+  ≥ 90
 *   A   ≥ 80
 *   B   ≥ 65
 *   C   ≥ 50
 *   D   ≥ 35
 *   F   < 35
 */

import { observationFromOpportunityScore, type IntelligenceObservationDraft } from '@/lib/intelligence/observations'
import type { HomeownerQualificationIntelligence } from '@/lib/intake/homeownerQualification'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface OpportunityInput {
  // Property
  home_value?: number | null
  roof_age_years?: number | null
  structure_type?: string | null
  usable_roof_pct?: number | null   // 0.0 – 1.0
  stories?: number | null

  // Solar
  peak_sun_hours?: number | null    // e.g. 5.4
  annual_kwh_m2?: number | null     // irradiance kWh/m²/year
  estimated_system_size_kw?: number | null
  monthly_bill?: number | null
  annual_usage_kwh?: number | null

  // Financial
  credit_tier?: string | null       // excellent | good | fair | poor
  median_income?: number | null
  assessed_value?: number | null
  mortgage_balance_proxy?: number | null
  finance_eligible?: boolean | null

  // Market
  avg_rate_kwh?: number | null      // utility rate $/kWh
  net_metering?: boolean | null
  nem_type?: string | null          // NEM 2.0 | NEM 3.0 | VNEM | AVOIDED_COST
  state?: string | null
  active_contractors_nearby?: number | null

  // Intent
  source_type?: string | null       // google_ads | facebook_ads | seo | contractor_shared | etc.
  form_completeness?: number | null  // 0.0 – 1.0
  intent_score?: number | null       // 0-100 from screening step 9
  battery_interest?: boolean | null
  financing_preference?: string | null

  // Optional second-stage qualification intelligence. This is merged into the
  // existing canonical scorer dimensions instead of creating a parallel score.
  qualification_intelligence?: HomeownerQualificationIntelligence | Record<string, unknown> | null
}

export interface DimensionScore {
  score: number          // 0-100
  weight: number         // e.g. 0.25
  factors: Record<string, unknown>
}

export interface ScoringResult {
  overall_score: number   // 0-100, two decimal places
  overall_grade: string   // A+ | A | B | C | D | F
  property: DimensionScore
  solar: DimensionScore
  financial: DimensionScore
  market: DimensionScore
  intent: DimensionScore
  risk_flags: string[]
  opportunity_highlights: string[]
  executive_summary: string
  score_version: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const SCORE_VERSION = 'v1.1-qualification'

// Grade thresholds
const GRADES: Array<{ min: number; grade: string }> = [
  { min: 90, grade: 'A+' },
  { min: 80, grade: 'A'  },
  { min: 65, grade: 'B'  },
  { min: 50, grade: 'C'  },
  { min: 35, grade: 'D'  },
  { min: 0,  grade: 'F'  },
]

// States with strong solar incentives (bonus applied)
const STRONG_INCENTIVE_STATES = new Set([
  'CA', 'MA', 'NY', 'NJ', 'CT', 'MD', 'CO', 'IL', 'MN', 'OR', 'WA',
  'AZ', 'NV', 'NC', 'TX', 'FL', 'HI', 'RI', 'VT', 'ME', 'NH',
])

// Source type quality weights (higher = better quality lead)
const SOURCE_QUALITY: Record<string, number> = {
  homeowner_direct:   92,
  google_ads:         82,
  facebook_ads:       74,
  tiktok:             66,
  seo:                88,
  referral:           90,
  partner:            80,
  contractor_shared:  70,
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────────────────────────────────

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val))
}

function toGrade(score: number): string {
  for (const { min, grade } of GRADES) {
    if (score >= min) return grade
  }
  return 'F'
}

function weightedAverage(scores: Array<[number, number]>): number {
  const totalWeight = scores.reduce((sum, [, w]) => sum + w, 0)
  const weightedSum = scores.reduce((sum, [s, w]) => sum + s * w, 0)
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

// ──────────────────────────────────────────────────────────────────────────────
// Dimension 1: Property Quality (weight 25%)
// ──────────────────────────────────────────────────────────────────────────────


function qualificationScoringInput(input: OpportunityInput): Partial<OpportunityInput> {
  const intelligence = input.qualification_intelligence
  if (!intelligence || typeof intelligence !== 'object') return {}
  const scoring = (intelligence as { scoring_input?: unknown }).scoring_input
  if (!scoring || typeof scoring !== 'object') return {}
  const q = scoring as Partial<OpportunityInput>
  return {
    credit_tier: q.credit_tier ?? undefined,
    median_income: q.median_income ?? undefined,
    finance_eligible: q.finance_eligible ?? undefined,
    financing_preference: q.financing_preference ?? undefined,
    structure_type: q.structure_type ?? undefined,
    usable_roof_pct: q.usable_roof_pct ?? undefined,
    intent_score: q.intent_score ?? undefined,
    form_completeness: q.form_completeness ?? undefined,
    battery_interest: q.battery_interest ?? undefined,
  }
}

export function mergeQualificationIntoOpportunityInput(input: OpportunityInput): OpportunityInput {
  const q = qualificationScoringInput(input)
  return {
    ...input,
    credit_tier: input.credit_tier ?? q.credit_tier,
    median_income: input.median_income ?? q.median_income,
    finance_eligible: input.finance_eligible ?? q.finance_eligible,
    financing_preference: input.financing_preference ?? q.financing_preference,
    structure_type: input.structure_type ?? q.structure_type,
    usable_roof_pct: input.usable_roof_pct ?? q.usable_roof_pct,
    intent_score: input.intent_score ?? q.intent_score,
    form_completeness: input.form_completeness ?? q.form_completeness,
    battery_interest: input.battery_interest ?? q.battery_interest,
  }
}

function scoreProperty(input: OpportunityInput): DimensionScore {
  const factors: Record<string, unknown> = {}
  const componentScores: Array<[number, number]> = []

  // Home value (weight 30% of dimension)
  if (input.home_value != null) {
    let s = 0
    if      (input.home_value >= 600000) s = 95
    else if (input.home_value >= 400000) s = 88
    else if (input.home_value >= 250000) s = 78
    else if (input.home_value >= 150000) s = 62
    else if (input.home_value >= 80000)  s = 45
    else                                  s = 25
    factors.home_value = s
    factors.home_value_raw = input.home_value
    componentScores.push([s, 0.30])
  }

  // Roof age (weight 25% of dimension)
  if (input.roof_age_years != null) {
    let s = 0
    if      (input.roof_age_years <= 2)  s = 98
    else if (input.roof_age_years <= 5)  s = 92
    else if (input.roof_age_years <= 10) s = 82
    else if (input.roof_age_years <= 15) s = 70
    else if (input.roof_age_years <= 20) s = 52
    else if (input.roof_age_years <= 25) s = 35
    else                                  s = 15
    factors.roof_age = s
    factors.roof_age_raw = input.roof_age_years
    componentScores.push([s, 0.25])
  }

  // Structure type (weight 20% of dimension)
  if (input.structure_type != null) {
    const typeScores: Record<string, number> = {
      single_family:  95,
      townhouse:      75,
      condo:          50,
      manufactured:   45,
      multi_family:   40,
      commercial:     60,
    }
    const s = typeScores[input.structure_type.toLowerCase()] ?? 55
    factors.structure_type = s
    factors.structure_type_raw = input.structure_type
    componentScores.push([s, 0.20])
  }

  // Usable roof (weight 15% of dimension)
  if (input.usable_roof_pct != null) {
    const pct = input.usable_roof_pct
    let s = 0
    if      (pct >= 0.80) s = 96
    else if (pct >= 0.65) s = 84
    else if (pct >= 0.50) s = 70
    else if (pct >= 0.35) s = 52
    else                   s = 30
    factors.usable_roof = s
    factors.usable_roof_pct = pct
    componentScores.push([s, 0.15])
  }

  // Stories (weight 10% of dimension) — fewer stories = easier install
  if (input.stories != null) {
    const s = input.stories === 1 ? 90 : input.stories === 2 ? 75 : 55
    factors.stories = s
    factors.stories_raw = input.stories
    componentScores.push([s, 0.10])
  }

  const score = componentScores.length > 0
    ? clamp(Math.round(weightedAverage(componentScores) * 100) / 100)
    : 60  // neutral default if no data

  return { score, weight: 0.25, factors }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dimension 2: Solar Opportunity (weight 25%)
// ──────────────────────────────────────────────────────────────────────────────

function scoreSolar(input: OpportunityInput): DimensionScore {
  const factors: Record<string, unknown> = {}
  const componentScores: Array<[number, number]> = []

  // Peak sun hours / irradiance (weight 30%)
  const psh = input.peak_sun_hours ?? (input.annual_kwh_m2 ? input.annual_kwh_m2 / 365 : null)
  if (psh != null) {
    let s = 0
    if      (psh >= 6.0) s = 98
    else if (psh >= 5.5) s = 92
    else if (psh >= 5.0) s = 84
    else if (psh >= 4.5) s = 74
    else if (psh >= 4.0) s = 62
    else if (psh >= 3.5) s = 48
    else                  s = 30
    factors.irradiance = s
    factors.peak_sun_hours = psh
    componentScores.push([s, 0.30])
  }

  // System size (weight 25%)
  if (input.estimated_system_size_kw != null) {
    const kw = input.estimated_system_size_kw
    let s = 0
    if      (kw >= 12) s = 95
    else if (kw >= 8)  s = 86
    else if (kw >= 5)  s = 74
    else if (kw >= 3)  s = 58
    else               s = 38
    factors.system_size = s
    factors.est_size_kw = kw
    componentScores.push([s, 0.25])
  }

  // Monthly electric bill (weight 25%)
  if (input.monthly_bill != null) {
    const bill = input.monthly_bill
    let s = 0
    if      (bill >= 400) s = 98
    else if (bill >= 300) s = 92
    else if (bill >= 200) s = 84
    else if (bill >= 150) s = 74
    else if (bill >= 100) s = 60
    else if (bill >= 75)  s = 45
    else                   s = 25
    factors.bill_size = s
    factors.monthly_bill = bill
    componentScores.push([s, 0.25])
  }

  // Battery interest bonus (weight 10% — minor signal of serious intent)
  if (input.battery_interest != null) {
    const s = input.battery_interest ? 85 : 50
    factors.battery_interest = s
    factors.battery_interest_raw = input.battery_interest
    componentScores.push([s, 0.10])
  }

  // Offset potential — how much of their bill can solar cover
  if (input.annual_usage_kwh != null && input.estimated_system_size_kw != null && psh != null) {
    const annualProduction = input.estimated_system_size_kw * psh * 365 * 0.8  // 80% efficiency
    const offset = Math.min(1.0, annualProduction / input.annual_usage_kwh)
    let s = 0
    if      (offset >= 0.95) s = 98
    else if (offset >= 0.80) s = 86
    else if (offset >= 0.65) s = 74
    else if (offset >= 0.50) s = 58
    else                      s = 40
    factors.offset_potential = s
    factors.est_offset_pct = offset
    componentScores.push([s, 0.10])
  }

  const score = componentScores.length > 0
    ? clamp(Math.round(weightedAverage(componentScores) * 100) / 100)
    : 60

  return { score, weight: 0.25, factors }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dimension 3: Financial Fit (weight 20%)
// ──────────────────────────────────────────────────────────────────────────────

function scoreFinancial(input: OpportunityInput): DimensionScore {
  const factors: Record<string, unknown> = {}
  const componentScores: Array<[number, number]> = []

  // Credit tier proxy (weight 35%)
  if (input.credit_tier != null) {
    const tierScores: Record<string, number> = {
      excellent: 95,
      good:      78,
      fair:      56,
      poor:      28,
    }
    const s = tierScores[input.credit_tier.toLowerCase()] ?? 55
    factors.credit_tier = s
    factors.credit_tier_raw = input.credit_tier
    componentScores.push([s, 0.35])
  }

  // Finance eligibility (weight 20%)
  if (input.finance_eligible != null) {
    const s = input.finance_eligible ? 90 : 35
    factors.finance_eligible = s
    factors.eligible = input.finance_eligible
    componentScores.push([s, 0.20])
  }

  // Median income proxy (weight 25%)
  if (input.median_income != null) {
    const income = input.median_income
    let s = 0
    if      (income >= 150000) s = 96
    else if (income >= 100000) s = 86
    else if (income >= 75000)  s = 74
    else if (income >= 55000)  s = 60
    else if (income >= 40000)  s = 44
    else                        s = 28
    factors.income_proxy = s
    factors.median_income = income
    componentScores.push([s, 0.25])
  }

  // Home equity proxy (weight 20%)
  if (input.home_value != null && input.assessed_value != null) {
    const equity = input.home_value > 0
      ? Math.max(0, input.home_value - (input.mortgage_balance_proxy ?? 0)) / input.home_value
      : 0.5
    let s = 0
    if      (equity >= 0.75) s = 96
    else if (equity >= 0.50) s = 82
    else if (equity >= 0.30) s = 68
    else if (equity >= 0.15) s = 50
    else                      s = 30
    factors.home_equity = s
    factors.equity_pct = equity
    componentScores.push([s, 0.20])
  }

  const score = componentScores.length > 0
    ? clamp(Math.round(weightedAverage(componentScores) * 100) / 100)
    : 60

  return { score, weight: 0.20, factors }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dimension 4: Market Opportunity (weight 15%)
// ──────────────────────────────────────────────────────────────────────────────

function scoreMarket(input: OpportunityInput): DimensionScore {
  const factors: Record<string, unknown> = {}
  const componentScores: Array<[number, number]> = []

  // Utility rate (weight 35%)
  if (input.avg_rate_kwh != null) {
    const rate = input.avg_rate_kwh
    let s = 0
    if      (rate >= 0.25) s = 98
    else if (rate >= 0.20) s = 88
    else if (rate >= 0.16) s = 76
    else if (rate >= 0.12) s = 60
    else if (rate >= 0.09) s = 42
    else                    s = 24
    factors.utility_rates = s
    factors.avg_rate_kwh = rate
    componentScores.push([s, 0.35])
  }

  // Net metering (weight 30%)
  if (input.net_metering != null) {
    const nemTypeBonus: Record<string, number> = {
      'NEM 2.0':      90,
      'NEM 3.0':      60,
      'VNEM':         70,
      'AVOIDED_COST': 45,
    }
    let s = input.net_metering
      ? (input.nem_type ? (nemTypeBonus[input.nem_type] ?? 80) : 80)
      : 20
    factors.net_metering = s
    factors.nem_type = input.nem_type
    componentScores.push([s, 0.30])
  }

  // State incentives (weight 20%)
  if (input.state != null) {
    const s = STRONG_INCENTIVE_STATES.has(input.state.toUpperCase()) ? 88 : 55
    factors.state_incentives = s
    factors.state = input.state
    componentScores.push([s, 0.20])
  }

  // Competition (weight 15%) — fewer nearby contractors = better for matcher
  if (input.active_contractors_nearby != null) {
    const n = input.active_contractors_nearby
    let s = 0
    if      (n === 0) s = 98  // unclaimed territory — very attractive
    else if (n <= 2)  s = 82
    else if (n <= 5)  s = 68
    else if (n <= 10) s = 52
    else               s = 36
    factors.competition = s
    factors.contractors_in_area = n
    componentScores.push([s, 0.15])
  }

  const score = componentScores.length > 0
    ? clamp(Math.round(weightedAverage(componentScores) * 100) / 100)
    : 62

  return { score, weight: 0.15, factors }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dimension 5: Lead Intent (weight 15%)
// ──────────────────────────────────────────────────────────────────────────────

function scoreIntent(input: OpportunityInput): DimensionScore {
  const factors: Record<string, unknown> = {}
  const componentScores: Array<[number, number]> = []

  // Source quality (weight 30%)
  if (input.source_type != null) {
    const s = SOURCE_QUALITY[input.source_type] ?? 65
    factors.source_quality = s
    factors.source = input.source_type
    componentScores.push([s, 0.30])
  }

  // Form completeness (weight 30%)
  if (input.form_completeness != null) {
    const s = clamp(Math.round(input.form_completeness * 100))
    factors.form_completeness = s
    componentScores.push([s, 0.30])
  }

  // Intent score from screening pipeline step 9 (weight 40%)
  if (input.intent_score != null) {
    const s = clamp(Math.round(input.intent_score))
    factors.nlp_intent = s
    componentScores.push([s, 0.40])
  }

  // Financing preference signal (bonus)
  if (input.financing_preference != null) {
    const prefScores: Record<string, number> = {
      cash:    92,
      loan:    80,
      lease:   65,
      ppa:     60,
      unknown: 55,
    }
    const s = prefScores[input.financing_preference.toLowerCase()] ?? 55
    factors.financing_intent = s
    // Only used if no intent_score yet
    if (input.intent_score == null) {
      componentScores.push([s, 0.40])
    }
  }

  const score = componentScores.length > 0
    ? clamp(Math.round(weightedAverage(componentScores) * 100) / 100)
    : 65

  return { score, weight: 0.15, factors }
}

// ──────────────────────────────────────────────────────────────────────────────
// Risk Flags & Highlights
// ──────────────────────────────────────────────────────────────────────────────

function computeFlags(
  input: OpportunityInput,
  dimensions: { property: DimensionScore; solar: DimensionScore; financial: DimensionScore; market: DimensionScore; intent: DimensionScore }
): { risk_flags: string[]; opportunity_highlights: string[] } {
  const risks: string[] = []
  const highlights: string[] = []

  // Risks
  if (input.roof_age_years != null && input.roof_age_years > 20) risks.push('old_roof')
  if (input.usable_roof_pct != null && input.usable_roof_pct < 0.40) risks.push('shading_concern')
  if (input.estimated_system_size_kw != null && input.estimated_system_size_kw < 3) risks.push('small_system')
  if (input.credit_tier === 'poor') risks.push('low_credit_proxy')
  if (input.net_metering === false) risks.push('no_net_metering')
  if (input.avg_rate_kwh != null && input.avg_rate_kwh < 0.10) risks.push('low_utility_rates')
  if (input.active_contractors_nearby != null && input.active_contractors_nearby > 8) risks.push('high_competition')
  if (input.structure_type === 'condo') risks.push('hoa_restriction')
  if (dimensions.financial.score < 40) risks.push('financing_unlikely')

  // Highlights
  if (input.monthly_bill != null && input.monthly_bill >= 300) highlights.push('high_electric_bill')
  if (input.roof_age_years != null && input.roof_age_years <= 5) highlights.push('new_roof')
  if (input.peak_sun_hours != null && input.peak_sun_hours >= 5.5) highlights.push('excellent_irradiance')
  if (input.estimated_system_size_kw != null && input.estimated_system_size_kw >= 10) highlights.push('large_system')
  if (input.credit_tier === 'excellent') highlights.push('excellent_credit')
  if (input.net_metering && input.nem_type === 'NEM 2.0') highlights.push('strong_nem')
  if (input.active_contractors_nearby === 0) highlights.push('unclaimed_territory')
  if (input.home_value != null && input.home_value >= 500000) highlights.push('high_value_home')
  if (input.battery_interest) highlights.push('battery_add_on_opportunity')

  return { risk_flags: risks, opportunity_highlights: highlights }
}

// ──────────────────────────────────────────────────────────────────────────────
// Executive Summary
// ──────────────────────────────────────────────────────────────────────────────

function buildSummary(
  input: OpportunityInput,
  overall_score: number,
  overall_grade: string,
  highlights: string[],
  risks: string[]
): string {
  const parts: string[] = []

  const grade = overall_grade === 'A+' ? 'exceptional' :
                overall_grade === 'A'  ? 'high-quality' :
                overall_grade === 'B'  ? 'solid' :
                overall_grade === 'C'  ? 'moderate-quality' : 'low-quality'

  parts.push(`Grade ${overall_grade} (${overall_score.toFixed(0)}/100) — ${grade} solar opportunity.`)

  if (input.state && input.monthly_bill) {
    parts.push(`${input.state} homeowner paying $${input.monthly_bill}/mo in electricity.`)
  }

  if (highlights.length > 0) {
    const top = highlights.slice(0, 3).map(h => h.replace(/_/g, ' '))
    parts.push(`Key strengths: ${top.join(', ')}.`)
  }

  if (risks.length > 0) {
    const top = risks.slice(0, 2).map(r => r.replace(/_/g, ' '))
    parts.push(`Considerations: ${top.join(', ')}.`)
  }

  return parts.join(' ')
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Export: scoreOpportunity
// ──────────────────────────────────────────────────────────────────────────────

export function scoreOpportunity(input: OpportunityInput): ScoringResult {
  input = mergeQualificationIntoOpportunityInput(input)
  const property  = scoreProperty(input)
  const solar     = scoreSolar(input)
  const financial = scoreFinancial(input)
  const market    = scoreMarket(input)
  const intent    = scoreIntent(input)

  // Weighted overall score
  const raw = weightedAverage([
    [property.score,  property.weight],
    [solar.score,     solar.weight],
    [financial.score, financial.weight],
    [market.score,    market.weight],
    [intent.score,    intent.weight],
  ])

  const overall_score = Math.round(raw * 100) / 100
  const overall_grade = toGrade(overall_score)

  const { risk_flags, opportunity_highlights } = computeFlags(input, { property, solar, financial, market, intent })
  const executive_summary = buildSummary(input, overall_score, overall_grade, opportunity_highlights, risk_flags)

  return {
    overall_score,
    overall_grade,
    property,
    solar,
    financial,
    market,
    intent,
    risk_flags,
    opportunity_highlights,
    executive_summary,
    score_version: SCORE_VERSION,
  }
}

/**
 * createOpportunityScoreObservation
 *
 * Converts a ScoringResult into a canonical intelligence observation draft.
 * This does not replace opportunity_intelligence; that table remains the
 * canonical score projection. The observation is append-friendly derivation
 * evidence for replay/audit/explainability.
 */
export function createOpportunityScoreObservation(
  opportunityId: string,
  result: ScoringResult,
  opts: { confidence?: number; scored_at?: string } = {},
): IntelligenceObservationDraft {
  return observationFromOpportunityScore({
    opportunity_id: opportunityId,
    score_version: result.score_version,
    confidence: opts.confidence ?? 0.9,
    scored_at: opts.scored_at,
    result: {
      overall_score: result.overall_score,
      overall_grade: result.overall_grade,
      property: result.property as unknown as Record<string, unknown>,
      solar: result.solar as unknown as Record<string, unknown>,
      financial: result.financial as unknown as Record<string, unknown>,
      market: result.market as unknown as Record<string, unknown>,
      intent: result.intent as unknown as Record<string, unknown>,
      risk_flags: result.risk_flags,
      opportunity_highlights: result.opportunity_highlights,
      executive_summary: result.executive_summary,
    },
  })
}

/**
 * scoreToListingPrice
 *
 * Converts an opportunity score into a recommended listing price.
 * Base price is $149. Higher grades command a premium.
 * Configurable via priceConfig override.
 */
export function scoreToListingPrice(
  score: number,
  grade: string,
  priceConfig?: { base?: number; premiumMultiplier?: number }
): { price: number; min: number; max: number; rationale: string } {
  const base = priceConfig?.base ?? 149

  const multipliers: Record<string, number> = {
    'A+': 2.50,
    'A':  1.90,
    'B':  1.40,
    'C':  1.00,
    'D':  0.70,
    'F':  0.50,
  }

  const mult = multipliers[grade] ?? 1.0
  const price = Math.round(base * mult)
  const variance = Math.round(price * 0.15)

  return {
    price,
    min: price - variance,
    max: price + variance,
    rationale: `Grade ${grade} (${score.toFixed(0)}/100) × ${mult.toFixed(2)} multiplier on $${base} base price`,
  }
}
