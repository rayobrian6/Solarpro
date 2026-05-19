/**
 * homeownerQualification.ts
 *
 * SolarPro post-submit homeowner qualification intelligence.
 *
 * This module intentionally does not replace the low-friction homeowner intake.
 * It derives a second-stage qualification layer that can be persisted as a
 * lifecycle event in intake_events and reused by scoring, matching, enrichment,
 * and marketplace intelligence.
 */

export const HOMEOWNER_QUALIFICATION_EVENT_TYPE = 'homeowner_qualification'
export const HOMEOWNER_QUALIFICATION_SCHEMA_VERSION = 'homeowner-qualification.v1'

export const PURCHASE_INTENTS = ['financing', 'cash', 'not_sure'] as const
export const ESTIMATED_CREDIT_BANDS = ['720_plus', '680_719', '640_679', 'below_640', 'unsure'] as const
export const ESTIMATED_INCOME_BANDS = ['under_50k', '50k_100k', '100k_150k', '150k_plus', 'prefer_not_to_say'] as const
export const PROPERTY_TYPES = ['single_family', 'farm', 'mobile_home', 'duplex', 'commercial'] as const
export const ELECTRICAL_PANEL_SIZES = ['100a', '150a', '200a_plus', 'unsure'] as const
export const SUNLIGHT_CONFIDENCES = ['full_sun', 'partial_shade', 'heavy_shade', 'unsure'] as const
export const PRIOR_QUOTES = ['yes', 'no'] as const

export type PurchaseIntent = typeof PURCHASE_INTENTS[number]
export type EstimatedCreditBand = typeof ESTIMATED_CREDIT_BANDS[number]
export type EstimatedIncomeBand = typeof ESTIMATED_INCOME_BANDS[number]
export type PropertyType = typeof PROPERTY_TYPES[number]
export type ElectricalPanelSize = typeof ELECTRICAL_PANEL_SIZES[number]
export type SunlightConfidence = typeof SUNLIGHT_CONFIDENCES[number]
export type PriorQuotes = typeof PRIOR_QUOTES[number]

export type QualificationStatus =
  | 'unqualified'
  | 'lightly_qualified'
  | 'finance_qualified'
  | 'battery_ready'
  | 'high_intent'
  | 'commercial'
  | 'cash_buyer'

export type LeadGrade = 'A' | 'B' | 'C' | 'D'

export interface HomeownerQualificationInput {
  purchase_intent?: PurchaseIntent | null
  estimated_credit_band?: EstimatedCreditBand | null
  estimated_income_band?: EstimatedIncomeBand | null
  property_type?: PropertyType | null
  electrical_panel_size?: ElectricalPanelSize | null
  sunlight_confidence?: SunlightConfidence | null
  prior_quotes?: PriorQuotes | null
}

export interface HomeownerQualificationContext {
  monthly_bill_amount?: number | string | null
  homeowner_status?: string | null
  battery_interest?: string | boolean | null
  timeline?: string | null
  utility_provider?: string | null
  roof_age?: string | number | null
}

export interface QualificationScorerInput {
  credit_tier?: string | null
  median_income?: number | null
  finance_eligible?: boolean | null
  financing_preference?: string | null
  structure_type?: string | null
  usable_roof_pct?: number | null
  intent_score?: number | null
  form_completeness?: number | null
  battery_interest?: boolean | null
}

export interface QualificationMatcherInput {
  battery_interest?: boolean | null
  structure_type?: string | null
  qualification_status?: QualificationStatus | null
  lead_grade?: LeadGrade | null
}

export interface HomeownerQualificationIntelligence {
  schema_version: typeof HOMEOWNER_QUALIFICATION_SCHEMA_VERSION
  qualification_status: QualificationStatus
  qualification_statuses: QualificationStatus[]
  lead_grade: LeadGrade
  lead_score: number
  finance_readiness: boolean
  battery_readiness: boolean
  high_intent: boolean
  cash_buyer: boolean
  commercial: boolean
  normalized: Required<HomeownerQualificationInput>
  labels: Record<string, string>
  contractor_summary: string
  score_factors: Record<string, number>
  scoring_input: QualificationScorerInput
  matcher_input: QualificationMatcherInput
  enrichment: Record<string, unknown>
  generated_at: string
}

type OptionSet = readonly string[]

function normalizeOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return (allowed as OptionSet).includes(normalized) ? normalized as T : fallback
}

export function normalizeQualificationInput(input: Record<string, unknown> | HomeownerQualificationInput): Required<HomeownerQualificationInput> {
  return {
    purchase_intent: normalizeOption(input.purchase_intent, PURCHASE_INTENTS, 'not_sure'),
    estimated_credit_band: normalizeOption(input.estimated_credit_band, ESTIMATED_CREDIT_BANDS, 'unsure'),
    estimated_income_band: normalizeOption(input.estimated_income_band, ESTIMATED_INCOME_BANDS, 'prefer_not_to_say'),
    property_type: normalizeOption(input.property_type, PROPERTY_TYPES, 'single_family'),
    electrical_panel_size: normalizeOption(input.electrical_panel_size, ELECTRICAL_PANEL_SIZES, 'unsure'),
    sunlight_confidence: normalizeOption(input.sunlight_confidence, SUNLIGHT_CONFIDENCES, 'unsure'),
    prior_quotes: normalizeOption(input.prior_quotes, PRIOR_QUOTES, 'no'),
  }
}

export function parseMonthlyBill(value: HomeownerQualificationContext['monthly_bill_amount']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function isHomeowner(value?: string | null): boolean {
  if (!value) return false
  return ['own', 'owner', 'homeowner', 'homeowner_occupied', 'owner_occupied', 'yes'].includes(value.toLowerCase())
}

export function isBatteryInterested(value?: string | boolean | null): boolean {
  if (typeof value === 'boolean') return value
  if (!value) return false
  return ['yes', 'true', 'interested', 'battery', 'backup', 'backup_power'].includes(String(value).toLowerCase())
}

function timelineScore(value?: string | null): number {
  if (!value) return 6
  const normalized = value.toLowerCase()
  if (['asap', 'immediately', 'now', '0_1_month', '1_month', 'within_30_days'].includes(normalized)) return 14
  if (['1_3_months', '1-3 months', 'soon', '30_90_days', 'next_3_months'].includes(normalized)) return 12
  if (['3_6_months', '3-6 months', 'this_year'].includes(normalized)) return 8
  if (['researching', 'not_sure', 'just_browsing'].includes(normalized)) return 4
  return 6
}

function creditScore(value: EstimatedCreditBand): number {
  switch (value) {
    case '720_plus': return 16
    case '680_719': return 13
    case '640_679': return 8
    case 'below_640': return 2
    case 'unsure': return 6
  }
}

function incomeScore(value: EstimatedIncomeBand): number {
  switch (value) {
    case '150k_plus': return 12
    case '100k_150k': return 10
    case '50k_100k': return 7
    case 'under_50k': return 3
    case 'prefer_not_to_say': return 5
  }
}

function sunlightScore(value: SunlightConfidence): number {
  switch (value) {
    case 'full_sun': return 12
    case 'partial_shade': return 7
    case 'unsure': return 5
    case 'heavy_shade': return 1
  }
}

function financingScore(input: Required<HomeownerQualificationInput>): number {
  if (input.purchase_intent === 'cash') return 12
  if (input.purchase_intent !== 'financing') return input.estimated_credit_band === 'unsure' ? 5 : 7
  if (input.estimated_credit_band === '720_plus') return 14
  if (input.estimated_credit_band === '680_719') return 13
  if (input.estimated_credit_band === '640_679') return 8
  if (input.estimated_credit_band === 'below_640') return 2
  return 6
}

function billScore(monthlyBill: number | null): number {
  if (monthlyBill == null) return 6
  if (monthlyBill >= 350) return 18
  if (monthlyBill >= 250) return 15
  if (monthlyBill >= 175) return 11
  if (monthlyBill >= 125) return 8
  if (monthlyBill >= 75) return 5
  return 2
}

function gradeFromScore(score: number): LeadGrade {
  if (score >= 78) return 'A'
  if (score >= 62) return 'B'
  if (score >= 44) return 'C'
  return 'D'
}

function creditTier(value: EstimatedCreditBand): string | null {
  switch (value) {
    case '720_plus': return 'excellent'
    case '680_719': return 'good'
    case '640_679': return 'fair'
    case 'below_640': return 'poor'
    case 'unsure': return null
  }
}

function incomeProxy(value: EstimatedIncomeBand): number | null {
  switch (value) {
    case '150k_plus': return 175000
    case '100k_150k': return 125000
    case '50k_100k': return 75000
    case 'under_50k': return 40000
    case 'prefer_not_to_say': return null
  }
}

function structureType(value: PropertyType): string {
  switch (value) {
    case 'mobile_home': return 'manufactured'
    case 'duplex': return 'multi_family'
    case 'commercial': return 'commercial'
    case 'farm': return 'single_family'
    case 'single_family': return 'single_family'
  }
}

function usableRoofPct(value: SunlightConfidence): number | null {
  switch (value) {
    case 'full_sun': return 0.85
    case 'partial_shade': return 0.55
    case 'heavy_shade': return 0.25
    case 'unsure': return null
  }
}

function financeReady(input: Required<HomeownerQualificationInput>): boolean {
  if (input.purchase_intent === 'cash') return true
  if (input.purchase_intent !== 'financing') return false
  return ['720_plus', '680_719', '640_679'].includes(input.estimated_credit_band)
}

function humanLabels(input: Required<HomeownerQualificationInput>): Record<string, string> {
  const labels: Record<string, Record<string, string>> = {
    purchase_intent: { financing: 'financing ready', cash: 'cash buyer', not_sure: 'purchase path not sure' },
    estimated_credit_band: { '720_plus': '720+ estimated credit', '680_719': '680–719 estimated credit', '640_679': '640–679 estimated credit', below_640: 'below 640 estimated credit', unsure: 'credit range unsure' },
    estimated_income_band: { under_50k: 'under $50k household income', '50k_100k': '$50k–$100k household income', '100k_150k': '$100k–$150k household income', '150k_plus': '$150k+ household income', prefer_not_to_say: 'income not disclosed' },
    property_type: { single_family: 'single-family property', farm: 'farm/rural property', mobile_home: 'mobile home', duplex: 'duplex', commercial: 'commercial property' },
    electrical_panel_size: { '100a': '100A panel', '150a': '150A panel', '200a_plus': 'likely 200A+ panel', unsure: 'panel size unsure' },
    sunlight_confidence: { full_sun: 'full sun confidence', partial_shade: 'partial shade', heavy_shade: 'heavy shade risk', unsure: 'sun exposure unsure' },
    prior_quotes: { yes: 'has prior solar quotes', no: 'no prior solar quotes' },
  }

  return {
    purchase_intent: labels.purchase_intent[input.purchase_intent],
    estimated_credit_band: labels.estimated_credit_band[input.estimated_credit_band],
    estimated_income_band: labels.estimated_income_band[input.estimated_income_band],
    property_type: labels.property_type[input.property_type],
    electrical_panel_size: labels.electrical_panel_size[input.electrical_panel_size],
    sunlight_confidence: labels.sunlight_confidence[input.sunlight_confidence],
    prior_quotes: labels.prior_quotes[input.prior_quotes],
  }
}

function qualificationStatuses(input: Required<HomeownerQualificationInput>, context: HomeownerQualificationContext, leadScore: number): QualificationStatus[] {
  const statuses = new Set<QualificationStatus>()
  const bill = parseMonthlyBill(context.monthly_bill_amount)
  const battery = isBatteryInterested(context.battery_interest)
  const homeowner = isHomeowner(context.homeowner_status)
  const ready = financeReady(input)

  if (input.property_type === 'commercial') statuses.add('commercial')
  if (input.purchase_intent === 'cash') statuses.add('cash_buyer')
  if (ready && input.purchase_intent === 'financing') statuses.add('finance_qualified')
  if (battery && input.electrical_panel_size === '200a_plus') statuses.add('battery_ready')
  if ((input.prior_quotes === 'yes' || timelineScore(context.timeline) >= 12) && bill != null && bill >= 175 && homeowner) statuses.add('high_intent')
  if (leadScore >= 44 || homeowner || bill != null || input.sunlight_confidence !== 'unsure') statuses.add('lightly_qualified')
  if (statuses.size === 0 || input.sunlight_confidence === 'heavy_shade' || (!homeowner && input.property_type !== 'commercial')) statuses.add('unqualified')

  return Array.from(statuses)
}

function primaryStatus(statuses: QualificationStatus[]): QualificationStatus {
  const priority: QualificationStatus[] = ['commercial', 'cash_buyer', 'high_intent', 'battery_ready', 'finance_qualified', 'lightly_qualified', 'unqualified']
  return priority.find(status => statuses.includes(status)) ?? 'unqualified'
}

export function buildContractorQualificationSummary(
  grade: LeadGrade,
  input: Required<HomeownerQualificationInput>,
  context: HomeownerQualificationContext,
  labels = humanLabels(input),
): string {
  const bill = parseMonthlyBill(context.monthly_bill_amount)
  const homeowner = isHomeowner(context.homeowner_status)
  const battery = isBatteryInterested(context.battery_interest)
  const timeline = context.timeline ? context.timeline.replace(/_/g, '–').replace('months', 'month timeline') : null
  const lines = [
    `${grade}-Grade Opportunity`,
    '',
    bill != null ? `• $${Math.round(bill)} utility bill` : null,
    homeowner ? '• homeowner occupied' : context.homeowner_status ? `• ${context.homeowner_status.replace(/_/g, ' ')} occupancy` : null,
    `• ${labels.purchase_intent}`,
    `• ${labels.estimated_credit_band}`,
    battery ? '• battery interested' : null,
    `• ${labels.sunlight_confidence}`,
    timeline ? `• ${timeline}` : null,
    `• ${labels.electrical_panel_size}`,
  ].filter(Boolean)

  return lines.join('\n')
}

export function deriveQualificationIntelligence(
  qualification: Record<string, unknown> | HomeownerQualificationInput,
  context: HomeownerQualificationContext = {},
  generatedAt = new Date().toISOString(),
): HomeownerQualificationIntelligence {
  const normalized = normalizeQualificationInput(qualification)
  const monthlyBill = parseMonthlyBill(context.monthly_bill_amount)
  const homeowner = isHomeowner(context.homeowner_status)
  const battery = isBatteryInterested(context.battery_interest)
  const ready = financeReady(normalized)

  const score_factors: Record<string, number> = {
    utility_bill: billScore(monthlyBill),
    homeowner_status: homeowner ? 12 : 0,
    battery_interest: battery ? 8 : 0,
    timeline: timelineScore(context.timeline),
    income_band: incomeScore(normalized.estimated_income_band),
    credit_band: creditScore(normalized.estimated_credit_band),
    sunlight_confidence: sunlightScore(normalized.sunlight_confidence),
    financing_readiness: financingScore(normalized),
    prior_quotes: normalized.prior_quotes === 'yes' ? 6 : 0,
    property_type: normalized.property_type === 'commercial' ? 8 : normalized.property_type === 'mobile_home' ? 1 : 6,
  }

  const lead_score = Math.max(0, Math.min(100, Math.round(Object.values(score_factors).reduce((sum, value) => sum + value, 0))))
  const lead_grade = gradeFromScore(lead_score)
  const statuses = qualificationStatuses(normalized, context, lead_score)
  const labels = humanLabels(normalized)
  const scoring_input: QualificationScorerInput = {
    credit_tier: creditTier(normalized.estimated_credit_band),
    median_income: incomeProxy(normalized.estimated_income_band),
    finance_eligible: ready,
    financing_preference: normalized.purchase_intent,
    structure_type: structureType(normalized.property_type),
    usable_roof_pct: usableRoofPct(normalized.sunlight_confidence),
    intent_score: lead_score,
    form_completeness: 0.95,
    battery_interest: battery,
  }
  const matcher_input: QualificationMatcherInput = {
    battery_interest: battery,
    structure_type: structureType(normalized.property_type),
    qualification_status: primaryStatus(statuses),
    lead_grade,
  }

  return {
    schema_version: HOMEOWNER_QUALIFICATION_SCHEMA_VERSION,
    qualification_status: primaryStatus(statuses),
    qualification_statuses: statuses,
    lead_grade,
    lead_score,
    finance_readiness: ready,
    battery_readiness: battery && normalized.electrical_panel_size === '200a_plus',
    high_intent: statuses.includes('high_intent'),
    cash_buyer: statuses.includes('cash_buyer'),
    commercial: statuses.includes('commercial'),
    normalized,
    labels,
    contractor_summary: buildContractorQualificationSummary(lead_grade, normalized, context, labels),
    score_factors,
    scoring_input,
    matcher_input,
    enrichment: {
      qualification_status: primaryStatus(statuses),
      qualification_statuses: statuses,
      lead_grade,
      lead_score,
      finance_readiness: ready,
      battery_readiness: battery && normalized.electrical_panel_size === '200a_plus',
      income_band: normalized.estimated_income_band,
      estimated_credit_band: normalized.estimated_credit_band,
      sunlight_confidence: normalized.sunlight_confidence,
      property_type: normalized.property_type,
      electrical_panel_size: normalized.electrical_panel_size,
      prior_quotes: normalized.prior_quotes,
      contractor_summary: buildContractorQualificationSummary(lead_grade, normalized, context, labels),
    },
    generated_at: generatedAt,
  }
}
