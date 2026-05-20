import { deriveConfidence } from '@/lib/intelligence/producers'
import { logNetworkEvent } from '@/lib/network/attributionTracker'

export const OPPORTUNITY_ENRICHMENT_VERSION = 'opportunity-enrichment.v1' as const

export interface OpportunityEnrichmentInput {
  opportunity: Record<string, unknown>
  intelligence?: Record<string, unknown> | null
  assignments?: Array<Record<string, unknown>>
  screening?: Record<string, unknown> | null
  observed_at?: string
}

export interface EnrichedField<T = unknown> {
  value: T | null
  confidence: number
  factors: string[]
  notes?: string[]
  warnings?: string[]
  missing_data?: string[]
}

export interface OpportunityEnrichmentPayload {
  schema_version: typeof OPPORTUNITY_ENRICHMENT_VERSION
  generated_at: string
  core: Record<string, EnrichedField>
  homeowner_sales: Record<string, EnrichedField>
  roof_install: Record<string, EnrichedField>
  territory_utility: Record<string, EnrichedField>
  marketplace: Record<string, EnrichedField>
  risk: Record<string, EnrichedField>
  completeness: number
  warnings: string[]
  missing_data: string[]
  derivation: {
    method: string
    version: typeof OPPORTUNITY_ENRICHMENT_VERSION
    inputs: string[]
    notes: string[]
  }
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (['true', 'yes', '1'].includes(value.toLowerCase())) return true
    if (['false', 'no', '0'].includes(value.toLowerCase())) return false
  }
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(clamp01(value) * 10000) / 10000
}

function scoreTo01(value: unknown): number | null {
  const n = num(value)
  if (n == null) return null
  return clamp01(n > 1 ? n / 100 : n)
}

function confidence(args: {
  fields: unknown[]
  factors: string[]
  explicitness?: number
  sourceReliability?: number
  maxConfidence?: number
}): number {
  const present = args.fields.filter((v) => v !== null && v !== undefined && v !== '').length
  return deriveConfidence({
    sampleSize: present,
    sourceReliability: args.sourceReliability ?? 0.74,
    explicitness: args.explicitness ?? (present > 0 ? 0.68 : 0.22),
    metadataRichness: args.fields.length ? present / args.fields.length : 0,
    classificationStrength: args.factors.length ? Math.min(1, 0.48 + args.factors.length * 0.12) : 0.25,
    corroboratingSignals: args.factors.length,
    maxConfidence: args.maxConfidence ?? 0.88,
  })
}

function field<T>(value: T | null, opts: {
  confidence: number
  factors?: string[]
  notes?: string[]
  warnings?: string[]
  missing_data?: string[]
}): EnrichedField<T> {
  return {
    value,
    confidence: round4(opts.confidence),
    factors: opts.factors ?? [],
    ...(opts.notes?.length ? { notes: opts.notes } : {}),
    ...(opts.warnings?.length ? { warnings: opts.warnings } : {}),
    ...(opts.missing_data?.length ? { missing_data: opts.missing_data } : {}),
  }
}

function pushMissing(globalMissing: string[], local: string[], name: string, value: unknown) {
  if (value === null || value === undefined || value === '') {
    local.push(name)
    globalMissing.push(name)
  }
}

function complexityLabel(score: number | null, low = 35, high = 70): 'low' | 'medium' | 'high' | null {
  if (score == null) return null
  if (score >= high) return 'high'
  if (score >= low) return 'medium'
  return 'low'
}

function priorityLabel(score: number | null): 'low' | 'standard' | 'high' | 'urgent' | null {
  if (score == null) return null
  if (score >= 85) return 'urgent'
  if (score >= 70) return 'high'
  if (score >= 45) return 'standard'
  return 'low'
}

export function buildOpportunityEnrichment(input: OpportunityEnrichmentInput): OpportunityEnrichmentPayload {
  const opp = input.opportunity
  const intel = input.intelligence ?? {}
  const assignments = input.assignments ?? []
  const screening = input.screening ?? {}
  const generatedAt = input.observed_at ?? new Date().toISOString()
  const missing: string[] = []
  const warnings: string[] = []

  const systemSizeKw = num(opp.estimated_system_size_kw)
  const annualUsage = num(opp.annual_usage_kwh)
  const peakSunHours = num(opp.peak_sun_hours_annual)
  const projectValue = num(opp.estimated_project_value)
  const utilityRate = num(opp.utility_rate_per_kwh)
  const monthlyUsage = num(opp.monthly_usage_avg_kwh)
  const roofAge = num(opp.roof_age_years)
  const roofUsablePct = num(opp.roof_usable_pct ?? opp.usable_roof_pct)
  const roofMaterial = str(opp.roof_material)
  const roofPitch = str(opp.roof_pitch)
  const shadingScore = num(opp.shading_score)
  const ahjComplexity = num(opp.ahj_complexity_score)
  const utilityComplexity = num(opp.utility_complexity_score)
  const opportunityScore = num(opp.opportunity_score ?? intel.overall_score)
  const homeownerTimeline = str(opp.homeowner_timeline)
  const financingInterest = str(opp.homeowner_financing_interest)
  const batteryCandidate = bool(opp.battery_candidate)
  const batteryReason = str(opp.battery_reason)
  const sourceType = str(opp.source_type)
  const state = str(opp.location_state ?? opp.state)
  const spam = bool(opp.spam_flag) === true
  const duplicate = bool(opp.duplicate_flag) === true
  const invalidUtility = bool(opp.invalid_utility_flag) === true
  const topMatchScore = num(intel.top_match_score)
  const eligibleContractors = num(intel.total_eligible_contractors)
  const screeningFailures = arr(screening.step10_fail_reasons).map(String)
  const qualification = (intel.enrichment_payload && typeof intel.enrichment_payload === 'object'
    ? (intel.enrichment_payload as Record<string, unknown>).qualification
    : null) as Record<string, unknown> | null
  const qualificationStatus = str(qualification?.qualification_status)
  const qualificationGrade = str(qualification?.lead_grade)
  const qualificationSummary = str(qualification?.contractor_summary)
  const qualificationScore = num(qualification?.lead_score)
  const qualificationFinanceReady = bool(qualification?.finance_readiness)
  const qualificationBatteryReady = bool(qualification?.battery_readiness)

  const productionMissing: string[] = []
  pushMissing(missing, productionMissing, 'estimated_system_size_kw', systemSizeKw)
  pushMissing(missing, productionMissing, 'peak_sun_hours_annual', peakSunHours)
  const annualProduction = systemSizeKw == null
    ? null
    : Math.round(systemSizeKw * (peakSunHours ?? 4.5) * 365 * 0.78)
  const productionFactors = ['system size estimate']
  if (peakSunHours != null) productionFactors.push('annual peak sun hours')
  else productionFactors.push('regional fallback production factor')

  const epcCost = systemSizeKw == null ? null : round2(systemSizeKw * 1000 * 2.25)
  const margin = projectValue == null || epcCost == null ? null : round2(projectValue - epcCost)

  const intentBase = scoreTo01(opp.score_homeowner ?? intel.intent_score) ?? 0.45
  const intentFactors: string[] = []
  let intent = intentBase
  if (homeownerTimeline) {
    intentFactors.push(`timeline:${homeownerTimeline}`)
    if (/immediate|asap|now|30/i.test(homeownerTimeline)) intent += 0.22
    else if (/60|90/i.test(homeownerTimeline)) intent += 0.10
  }
  if (sourceType) intentFactors.push(`source:${sourceType}`)
  if (financingInterest) intentFactors.push(`financing:${financingInterest}`)
  const homeownerIntentScore = round4(intent)

  const financingFactors: string[] = []
  let financingProbability = 0.42
  if (financingInterest) {
    financingFactors.push(`homeowner financing interest:${financingInterest}`)
    if (/loan|finance|monthly|yes/i.test(financingInterest)) financingProbability += 0.28
    if (/cash|no/i.test(financingInterest)) financingProbability -= 0.18
  }
  if (qualificationFinanceReady === true) { financingProbability += 0.18; financingFactors.push('qualification finance readiness') }
  if ((projectValue ?? 0) >= 30000) { financingProbability += 0.08; financingFactors.push('larger project value') }
  if ((utilityRate ?? 0) >= 0.16) { financingProbability += 0.05; financingFactors.push('higher utility rate savings pressure') }

  const batteryFactors: string[] = []
  let batteryLikelihood = qualificationBatteryReady ? 0.82 : batteryCandidate ? 0.72 : 0.34
  if (qualificationBatteryReady) batteryFactors.push('qualification battery readiness')
  if (batteryCandidate) batteryFactors.push('battery candidate flag')
  if (batteryReason) batteryFactors.push(batteryReason)
  if ((utilityRate ?? 0) >= 0.18) { batteryLikelihood += 0.08; batteryFactors.push('high utility rates') }
  if (state && ['TX', 'CA', 'HI', 'FL'].includes(state.toUpperCase())) { batteryLikelihood += 0.05; batteryFactors.push(`${state.toUpperCase()} market`) }
  if ((monthlyUsage ?? 0) >= 1200) { batteryLikelihood += 0.05; batteryFactors.push('high monthly usage') }

  const urgencyFactors: string[] = []
  let urgency = 0.38
  if (homeownerTimeline) {
    urgencyFactors.push(`timeline:${homeownerTimeline}`)
    if (/immediate|asap|now/i.test(homeownerTimeline)) urgency = 0.86
    else if (/30/i.test(homeownerTimeline)) urgency = 0.72
    else if (/60|90/i.test(homeownerTimeline)) urgency = 0.55
  }
  if ((utilityRate ?? 0) >= 0.18) { urgency += 0.05; urgencyFactors.push('high utility rate') }

  const roofFactors: string[] = []
  let roofComplexityScore = 30
  if (roofAge != null) { roofFactors.push(`roof age:${roofAge}`); if (roofAge > 20) roofComplexityScore += 20; else if (roofAge > 12) roofComplexityScore += 10 }
  if (roofUsablePct != null) { roofFactors.push(`usable roof:${roofUsablePct}%`); if (roofUsablePct < 55) roofComplexityScore += 20; else if (roofUsablePct < 75) roofComplexityScore += 10 }
  if (roofPitch) { roofFactors.push(`roof pitch:${roofPitch}`); if (/steep|9\/12|10\/12|11\/12|12\/12/i.test(roofPitch)) roofComplexityScore += 15 }
  if (roofMaterial) { roofFactors.push(`roof material:${roofMaterial}`); if (/tile|slate|metal/i.test(roofMaterial)) roofComplexityScore += 12 }
  const steepRoof = bool(opp.steep_roof_flag) === true
  if (steepRoof) { roofComplexityScore += 15; roofFactors.push('steep roof flag') }
  roofComplexityScore = Math.min(100, roofComplexityScore)
  const roofComplexity = complexityLabel(roofComplexityScore)

  const shadingRiskScore = shadingScore == null ? null : 100 - shadingScore
  const installDifficultyScore = Math.min(100, roofComplexityScore * 0.55 + (ahjComplexity ?? 40) * 0.25 + (shadingRiskScore ?? 35) * 0.20)
  const electricalUpgradeLikelihood = round4(((opp.main_panel_amps ? (num(opp.main_panel_amps)! < 200 ? 0.68 : 0.25) : 0.42) + ((systemSizeKw ?? 0) >= 10 ? 0.12 : 0)))

  const utilityScoreRaw = utilityComplexity == null ? (utilityRate != null ? 65 : null) : 100 - utilityComplexity
  const permitComplexityRaw = ahjComplexity ?? null
  const territoryFactors = [state ? `state:${state}` : null, str(opp.utility_provider) ? `utility:${str(opp.utility_provider)}` : null].filter((v): v is string => !!v)
  const serviceAreaConfidence = confidence({ fields: [state, opp.location_zip, opp.location_city, opp.lat, opp.lng], factors: territoryFactors, explicitness: state ? 0.78 : 0.30, maxConfidence: 0.9 })

  const activeOffers = assignments.filter((a) => ['offered', 'viewed'].includes(String(a.status))).length
  const claimedAssignments = assignments.filter((a) => ['claimed', 'contacted', 'appointment', 'proposal', 'won'].includes(String(a.status))).length
  const contractorFitScore = topMatchScore ?? num(assignments[0]?.match_score) ?? null
  const liquidityScore = Math.round(clamp01(((eligibleContractors ?? activeOffers) / 5) * 0.55 + ((opportunityScore ?? 50) / 100) * 0.30 + (activeOffers > 0 ? 0.15 : 0)) * 100)
  const closeProbability = round4(((opportunityScore ?? 50) / 100) * 0.46 + homeownerIntentScore * 0.30 + liquidityScore / 100 * 0.16 + (duplicate || spam ? -0.18 : 0.08))
  const marketplacePriorityScore = Math.round(clamp01(((opportunityScore ?? 50) / 100) * 0.38 + closeProbability * 0.28 + liquidityScore / 100 * 0.20 + (1 - (installDifficultyScore / 100)) * 0.14) * 100)

  const riskFactors: string[] = []
  if (spam) riskFactors.push('spam flag')
  if (duplicate) riskFactors.push('duplicate flag')
  if (invalidUtility) riskFactors.push('invalid utility flag')
  if (screeningFailures.length) riskFactors.push('screening failure reasons present')
  const fraudRisk = round4((spam ? 0.72 : 0.16) + (duplicate ? 0.12 : 0))
  const invalidDataRisk = round4((invalidUtility ? 0.55 : 0.14) + (missing.length > 8 ? 0.18 : 0) + (screeningFailures.length ? 0.15 : 0))
  const lowQualityReason = riskFactors.length ? riskFactors.join('; ') : opportunityScore != null && opportunityScore < 45 ? 'low opportunity score' : null

  if (missing.length) warnings.push(`Missing data reduced enrichment confidence: ${Array.from(new Set(missing)).slice(0, 8).join(', ')}`)
  if (screeningFailures.length) warnings.push('Screening failure reasons are present')
  if (duplicate || spam || invalidUtility) warnings.push('Risk flags are present on canonical opportunity')

  const core = {
    estimated_system_size_kw: field(systemSizeKw, { confidence: confidence({ fields: [systemSizeKw], factors: ['network_opportunities.estimated_system_size_kw'], maxConfidence: 0.94 }), factors: ['network_opportunities.estimated_system_size_kw'], missing_data: systemSizeKw == null ? ['estimated_system_size_kw'] : [] }),
    estimated_annual_production_kwh: field(annualProduction, { confidence: confidence({ fields: [systemSizeKw, peakSunHours], factors: productionFactors, explicitness: peakSunHours != null ? 0.72 : 0.45, maxConfidence: peakSunHours != null ? 0.86 : 0.66 }), factors: productionFactors, missing_data: productionMissing }),
    estimated_project_value: field(projectValue, { confidence: confidence({ fields: [projectValue], factors: ['network_opportunities.estimated_project_value'], maxConfidence: 0.88 }), factors: ['network_opportunities.estimated_project_value'], missing_data: projectValue == null ? ['estimated_project_value'] : [] }),
    estimated_margin: field(margin, { confidence: confidence({ fields: [projectValue, epcCost], factors: ['estimated project value', 'EPC cost heuristic'], explicitness: projectValue != null && systemSizeKw != null ? 0.62 : 0.28, maxConfidence: 0.72 }), factors: ['estimated project value', 'EPC cost heuristic'], warnings: ['Margin is directional and not a bid-level estimate'], missing_data: [projectValue == null ? 'estimated_project_value' : null, systemSizeKw == null ? 'estimated_system_size_kw' : null].filter((v): v is string => !!v) }),
    estimated_epc_cost: field(epcCost, { confidence: confidence({ fields: [systemSizeKw], factors: ['system size', 'standard EPC cost heuristic'], explicitness: 0.48, maxConfidence: 0.64 }), factors: ['system size', 'standard EPC cost heuristic'], warnings: ['EPC cost is heuristic until contractor-specific costing is available'], missing_data: systemSizeKw == null ? ['estimated_system_size_kw'] : [] }),
  }

  const homeowner_sales = {
    homeowner_intent_score: field(homeownerIntentScore, { confidence: confidence({ fields: [opp.score_homeowner, intel.intent_score, homeownerTimeline, sourceType], factors: intentFactors, maxConfidence: 0.82 }), factors: intentFactors }),
    financing_probability: field(round4(financingProbability), { confidence: confidence({ fields: [financingInterest, projectValue, utilityRate], factors: financingFactors, maxConfidence: 0.78 }), factors: financingFactors, missing_data: financingInterest ? [] : ['homeowner_financing_interest'] }),
    battery_likelihood: field(round4(batteryLikelihood), { confidence: confidence({ fields: [batteryCandidate, batteryReason, utilityRate, state, monthlyUsage], factors: batteryFactors, maxConfidence: 0.82 }), factors: batteryFactors, missing_data: batteryCandidate == null ? ['battery_candidate'] : [] }),
    upsell_opportunities: field([batteryLikelihood >= 0.55 ? 'battery_storage' : null, financingProbability >= 0.55 ? 'financing' : null, (systemSizeKw ?? 0) >= 8 ? 'premium_monitoring' : null].filter(Boolean), { confidence: confidence({ fields: [batteryLikelihood, financingProbability, systemSizeKw], factors: ['battery likelihood', 'financing probability', 'system size'], maxConfidence: 0.76 }), factors: ['battery likelihood', 'financing probability', 'system size'] }),
    urgency_score: field(round4(urgency), { confidence: confidence({ fields: [homeownerTimeline, utilityRate], factors: urgencyFactors, maxConfidence: 0.78 }), factors: urgencyFactors, missing_data: homeownerTimeline ? [] : ['homeowner_timeline'] }),
    close_probability: field(closeProbability, { confidence: confidence({ fields: [opportunityScore, homeownerIntentScore, liquidityScore, spam, duplicate], factors: ['opportunity score', 'homeowner intent', 'lead liquidity', 'risk flags'], maxConfidence: 0.78 }), factors: ['opportunity score', 'homeowner intent', 'lead liquidity', 'risk flags'], warnings: ['Probability is rules-based until enough marketplace outcomes exist'] }),
  }

  const roof_install = {
    roof_complexity: field(roofComplexity, { confidence: confidence({ fields: [roofAge, roofUsablePct, roofPitch, roofMaterial, steepRoof], factors: roofFactors, maxConfidence: 0.84 }), factors: roofFactors }),
    install_difficulty: field(complexityLabel(installDifficultyScore), { confidence: confidence({ fields: [roofComplexityScore, ahjComplexity, shadingRiskScore], factors: ['roof complexity', 'AHJ complexity', 'shading risk'], maxConfidence: 0.80 }), factors: ['roof complexity', 'AHJ complexity', 'shading risk'] }),
    roof_material: field(roofMaterial, { confidence: confidence({ fields: [roofMaterial], factors: ['network_opportunities.roof_material'], maxConfidence: 0.88 }), factors: ['network_opportunities.roof_material'], missing_data: roofMaterial ? [] : ['roof_material'] }),
    shading_risk: field(complexityLabel(shadingRiskScore, 30, 65), { confidence: confidence({ fields: [shadingScore], factors: ['network_opportunities.shading_score'], maxConfidence: 0.82 }), factors: ['network_opportunities.shading_score'], missing_data: shadingScore == null ? ['shading_score'] : [] }),
    battery_readiness: field(batteryCandidate === true ? 'ready' : batteryLikelihood >= 0.55 ? 'likely_candidate' : 'unknown', { confidence: confidence({ fields: [batteryCandidate, batteryLikelihood], factors: batteryFactors, maxConfidence: 0.76 }), factors: batteryFactors }),
    electrical_upgrade_likelihood: field(electricalUpgradeLikelihood, { confidence: confidence({ fields: [opp.main_panel_amps, systemSizeKw], factors: ['main panel amps if present', 'system size'], explicitness: opp.main_panel_amps ? 0.72 : 0.34, maxConfidence: opp.main_panel_amps ? 0.78 : 0.54 }), factors: ['main panel amps if present', 'system size'], missing_data: opp.main_panel_amps ? [] : ['main_panel_amps'] }),
  }

  const territory_utility = {
    utility_score: field(utilityScoreRaw == null ? null : Math.round(utilityScoreRaw), { confidence: confidence({ fields: [utilityComplexity, utilityRate], factors: ['utility complexity', 'utility rate'], maxConfidence: 0.78 }), factors: ['utility complexity', 'utility rate'] }),
    permit_complexity: field(complexityLabel(permitComplexityRaw), { confidence: confidence({ fields: [permitComplexityRaw], factors: ['AHJ complexity score'], maxConfidence: 0.78 }), factors: ['AHJ complexity score'], missing_data: permitComplexityRaw == null ? ['ahj_complexity_score'] : [] }),
    ahj_complexity: field(complexityLabel(ahjComplexity), { confidence: confidence({ fields: [ahjComplexity, opp.ahj_name], factors: ['AHJ complexity score', 'AHJ name'], maxConfidence: 0.80 }), factors: ['AHJ complexity score', 'AHJ name'], missing_data: ahjComplexity == null ? ['ahj_complexity_score'] : [] }),
    territory_heat: field(priorityLabel(liquidityScore), { confidence: confidence({ fields: [eligibleContractors, activeOffers, opportunityScore], factors: ['eligible contractors', 'active offers', 'opportunity score'], maxConfidence: 0.78 }), factors: ['eligible contractors', 'active offers', 'opportunity score'] }),
    service_area_confidence: field(serviceAreaConfidence, { confidence: serviceAreaConfidence, factors: territoryFactors, missing_data: [state ? null : 'location_state', opp.location_zip ? null : 'location_zip'].filter((v): v is string => !!v) }),
  }

  const qualificationProjection = qualification ? {
    qualification_status: field(qualificationStatus, { confidence: confidence({ fields: [qualificationStatus, qualificationScore], factors: ['post-submit qualification event'], maxConfidence: 0.92 }), factors: ['post-submit qualification event'] }),
    lead_grade: field(qualificationGrade, { confidence: confidence({ fields: [qualificationGrade, qualificationScore], factors: ['qualification lead grading'], maxConfidence: 0.92 }), factors: ['qualification lead grading'] }),
    contractor_summary: field(qualificationSummary, { confidence: confidence({ fields: [qualificationSummary], factors: ['contractor-facing qualification summary'], maxConfidence: 0.9 }), factors: ['contractor-facing qualification summary'] }),
    finance_readiness: field(qualificationFinanceReady, { confidence: confidence({ fields: [qualificationFinanceReady], factors: ['qualification finance readiness'], maxConfidence: 0.9 }), factors: ['qualification finance readiness'] }),
    battery_readiness: field(qualificationBatteryReady, { confidence: confidence({ fields: [qualificationBatteryReady], factors: ['qualification battery readiness'], maxConfidence: 0.9 }), factors: ['qualification battery readiness'] }),
  } : {}

  const marketplace = {
    ...qualificationProjection,
    contractor_fit_score: field(contractorFitScore, { confidence: confidence({ fields: [contractorFitScore, eligibleContractors], factors: ['top match score', 'eligible contractor count'], maxConfidence: 0.82 }), factors: ['top match score', 'eligible contractor count'], missing_data: contractorFitScore == null ? ['top_match_score'] : [] }),
    lead_liquidity_score: field(liquidityScore, { confidence: confidence({ fields: [eligibleContractors, activeOffers, opportunityScore], factors: ['eligible contractors', 'active offers', 'opportunity score'], maxConfidence: 0.82 }), factors: ['eligible contractors', 'active offers', 'opportunity score'] }),
    marketplace_priority: field(priorityLabel(marketplacePriorityScore), { confidence: confidence({ fields: [opportunityScore, closeProbability, liquidityScore, installDifficultyScore], factors: ['opportunity score', 'close probability', 'lead liquidity', 'install difficulty'], maxConfidence: 0.80 }), factors: ['opportunity score', 'close probability', 'lead liquidity', 'install difficulty'] }),
    assignment_priority: field(priorityLabel(Math.max(marketplacePriorityScore, activeOffers ? 70 : 0)), { confidence: confidence({ fields: [marketplacePriorityScore, activeOffers, claimedAssignments], factors: ['marketplace priority', 'assignment activity'], maxConfidence: 0.76 }), factors: ['marketplace priority', 'assignment activity'] }),
    exclusivity_recommendation: field(closeProbability >= 0.72 || contractorFitScore != null && contractorFitScore >= 85 ? 'exclusive_offer' : liquidityScore >= 55 ? 'limited_marketplace' : 'standard_marketplace', { confidence: confidence({ fields: [closeProbability, contractorFitScore, liquidityScore], factors: ['close probability', 'contractor fit score', 'lead liquidity'], maxConfidence: 0.78 }), factors: ['close probability', 'contractor fit score', 'lead liquidity'] }),
  }

  const risk = {
    fraud_risk: field(fraudRisk, { confidence: confidence({ fields: [spam, duplicate], factors: riskFactors, maxConfidence: 0.78 }), factors: riskFactors }),
    invalid_data_risk: field(invalidDataRisk, { confidence: confidence({ fields: [invalidUtility, missing.length, screeningFailures.length], factors: ['invalid utility flag', 'missing data count', 'screening failures'], maxConfidence: 0.78 }), factors: ['invalid utility flag', 'missing data count', 'screening failures'] }),
    low_quality_reason: field(lowQualityReason, { confidence: confidence({ fields: [lowQualityReason, opportunityScore, spam, duplicate], factors: riskFactors, maxConfidence: 0.76 }), factors: riskFactors }),
    screening_failure_reasons: field(screeningFailures, { confidence: confidence({ fields: [screeningFailures.length, screening.auto_decision, screening.override_decision], factors: ['screening queue fail reasons', 'screening decision'], maxConfidence: 0.88 }), factors: ['screening queue fail reasons', 'screening decision'] }),
  }

  const allFields = [...Object.values(core), ...Object.values(homeowner_sales), ...Object.values(roof_install), ...Object.values(territory_utility), ...Object.values(marketplace), ...Object.values(risk)]
  const populated = allFields.filter((f) => f.value !== null && !(Array.isArray(f.value) && f.value.length === 0)).length
  const completeness = round4(populated / allFields.length)

  return {
    schema_version: OPPORTUNITY_ENRICHMENT_VERSION,
    generated_at: generatedAt,
    core,
    homeowner_sales,
    roof_install,
    territory_utility,
    marketplace,
    risk,
    completeness,
    warnings: Array.from(new Set(warnings)),
    missing_data: Array.from(new Set(missing)),
    derivation: {
      method: 'rules_based_projection_from_canonical_opportunity_score_screening_assignment',
      version: OPPORTUNITY_ENRICHMENT_VERSION,
      inputs: ['network_opportunities', 'opportunity_intelligence', 'opportunity_assignments', 'opportunity_screening_queue', 'intake_events.homeowner_qualification'],
      notes: ['Deterministic enrichment projection; not a duplicate scoring system and not ML output.', 'Post-submit homeowner qualification is included when projected into opportunity_intelligence.enrichment_payload.'],
    },
  }
}

export async function enrichAndPersistOpportunity(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>,
  opportunityId: string,
  opts: { adminUserId?: string | null; triggeredBy?: 'system' | 'admin'; logEvent?: boolean } = {},
): Promise<OpportunityEnrichmentPayload> {
  const opportunityRows = await sql`SELECT * FROM network_opportunities WHERE id = ${opportunityId} LIMIT 1`
  const opportunity = opportunityRows[0]
  if (!opportunity) throw new Error('Opportunity not found')

  const intelligenceRows = await sql`SELECT * FROM opportunity_intelligence WHERE opportunity_id = ${opportunityId} LIMIT 1`
  const assignmentRows = await sql`SELECT id, status, match_score, match_factors, offered_at, claimed_at, proposal_at, closed_at, close_status FROM opportunity_assignments WHERE opportunity_id = ${opportunityId}`
  const screeningRows = await sql`SELECT auto_decision, override_decision, confidence_score, step10_fail_reasons, step10_review_flags AS review_flags FROM opportunity_screening_queue WHERE opportunity_id = ${opportunityId} LIMIT 1`

  const payload = buildOpportunityEnrichment({
    opportunity,
    intelligence: intelligenceRows[0] ?? null,
    assignments: assignmentRows,
    screening: screeningRows[0] ?? null,
  })

  await sql`
    INSERT INTO opportunity_intelligence (
      opportunity_id,
      overall_score,
      overall_grade,
      enrichment_version,
      enriched_at,
      enrichment_payload,
      enrichment_completeness,
      enrichment_warnings
    ) VALUES (
      ${opportunityId},
      ${num(intelligenceRows[0]?.overall_score ?? opportunity.opportunity_score) ?? 0},
      ${str(intelligenceRows[0]?.overall_grade ?? opportunity.opportunity_grade) ?? 'C'},
      ${OPPORTUNITY_ENRICHMENT_VERSION},
      NOW(),
      ${JSON.stringify(payload)},
      ${payload.completeness},
      ${JSON.stringify(payload.warnings)}
    )
    ON CONFLICT (opportunity_id) DO UPDATE SET
      enrichment_version = EXCLUDED.enrichment_version,
      enriched_at = EXCLUDED.enriched_at,
      enrichment_payload = EXCLUDED.enrichment_payload,
      enrichment_completeness = EXCLUDED.enrichment_completeness,
      enrichment_warnings = EXCLUDED.enrichment_warnings,
      updated_at = NOW()
  `

  if (opts.logEvent !== false) {
    await logNetworkEvent({
      event_type: 'opportunity.enriched',
      event_category: 'opportunity',
      opportunity_id: opportunityId,
      admin_user_id: opts.adminUserId ?? undefined,
      data: {
        enrichment_version: OPPORTUNITY_ENRICHMENT_VERSION,
        completeness: payload.completeness,
        warnings: payload.warnings,
        missing_data_count: payload.missing_data.length,
      },
      triggered_by: opts.triggeredBy ?? 'system',
    })
  }

  return payload
}
