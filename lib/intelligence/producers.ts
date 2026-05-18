/**
 * lib/intelligence/producers.ts
 *
 * First real intelligence producers for observation-driven learning.
 *
 * Producers consume canonical rows/events and return IntelligenceObservationDraft[]
 * only. They never mutate lifecycle/source-of-truth tables and never become
 * operational authority.
 */

import { createObservationDraft, type IntelligenceObservationDraft, type ObservationDerivation } from './observations'

export interface ProducerWindow { start: string; end: string }

export interface ProducerContext {
  observed_at?: string
  window?: ProducerWindow
  correlation_id?: string | null
  /** Stable upstream event/replay ID. Preferred for idempotency when available. */
  source_event_id?: string | null
}

export interface AssignmentOutcomeRow {
  id: string
  opportunity_id?: string | null
  contractor_id: string
  status?: string | null
  offered_at?: string | null
  claimed_at?: string | null
  first_contact_at?: string | null
  proposal_at?: string | null
  closed_at?: string | null
  close_status?: string | null
  lost_reason?: string | null
  dispute_filed_at?: string | null
  refund_at?: string | null
  quality_score?: number | null
  system_size_kw?: number | null
  financing_offered?: string | null
}

export interface ProjectActivityRow {
  id: string
  project_id: string
  user_id?: string | null
  type?: string | null
  title?: string | null
  details?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export interface HomeownerEngagementRow {
  project_id: string
  client_id?: string | null
  opportunity_id?: string | null
  event_id: string
  event_type: string
  occurred_at: string
  metadata?: Record<string, unknown>
}

export interface OpportunityLifecycleRow {
  id: string
  status?: string | null
  intake_at?: string | null
  live_at?: string | null
  claimed_at?: string | null
  closed_at?: string | null
  expires_at?: string | null
  updated_at?: string | null
  opportunity_score?: number | null
  source_type?: string | null
  enrichment_status?: string | null
  duplicate_flag?: boolean | null
  spam_flag?: boolean | null
  validation_errors?: unknown
}

export interface UtilityEventRow {
  id: string
  project_id?: string | null
  opportunity_id?: string | null
  utility_id?: string | null
  utility_name?: string | null
  event_type: string
  occurred_at: string
  details?: string | null
  metadata?: Record<string, unknown> | null
}

export interface AhjEventRow {
  id: string
  project_id?: string | null
  ahj_id?: string | null
  ahj_name?: string | null
  event_type: string
  occurred_at: string
  details?: string | null
  metadata?: Record<string, unknown> | null
}

export interface FailureEventRow {
  id: string
  entity_type: 'project' | 'opportunity' | 'contractor' | 'utility' | 'ahj'
  entity_id: string
  failure_type: string
  occurred_at: string
  details?: string | null
  metadata?: Record<string, unknown> | null
}

export interface ConfidenceInput {
  sampleSize?: number
  sourceReliability?: number
  explicitness?: number
  metadataRichness?: number
  recency?: number
  classificationStrength?: number
  corroboratingSignals?: number
  maxConfidence?: number
}

interface ClassificationResult {
  primary: string
  secondary_matches: string[]
  matched_patterns: string[]
  classification_notes: string[]
  strength: number
}

function now(ctx?: ProducerContext): string { return ctx?.observed_at ?? new Date().toISOString() }

function hoursBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null
  const start = new Date(a).getTime()
  const end = new Date(b).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, (end - start) / 36e5)
}

function daysBetween(a?: string | null, b?: string | null): number | null {
  const h = hoursBetween(a, b)
  return h == null ? null : h / 24
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)) }
function round4(n: number): number { return Math.round(clamp01(n) * 10000) / 10000 }
function pct(n: number, d: number): number { return d > 0 ? n / d : 0 }
function avg(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }
function normalizedIdPart(v: string): string { return v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown' }

export function deriveConfidence(input: ConfidenceInput): number {
  const sampleComponent = Math.min(1, Math.log10((input.sampleSize ?? 0) + 1) / 2)
  const signalComponent = Math.min(1, (input.corroboratingSignals ?? 0) / 5)
  const raw =
    sampleComponent * 0.22 +
    clamp01(input.sourceReliability ?? 0.65) * 0.18 +
    clamp01(input.explicitness ?? 0.50) * 0.20 +
    clamp01(input.metadataRichness ?? 0.35) * 0.12 +
    clamp01(input.recency ?? 0.60) * 0.08 +
    clamp01(input.classificationStrength ?? 0.50) * 0.14 +
    signalComponent * 0.06

  return round4(Math.min(input.maxConfidence ?? 0.92, raw))
}

function sampleConfidence(sampleSize: number, maxConfidence = 0.92): number {
  return deriveConfidence({ sampleSize, sourceReliability: 0.75, explicitness: sampleSize > 0 ? 0.75 : 0.20, metadataRichness: 0.55, classificationStrength: sampleSize > 0 ? 0.70 : 0.20, corroboratingSignals: sampleSize, maxConfidence })
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function stableHash(value: unknown): string {
  const str = stableStringify(value)
  let hash = 5381
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  return (hash >>> 0).toString(16)
}

function replayBoundary(ctx: ProducerContext, fallback: { updated_at?: string | null; sourceIds?: string[]; snapshot: unknown }): string {
  if (ctx.source_event_id) return `event:${ctx.source_event_id}`
  if (ctx.window) return `window:${ctx.window.start}:${ctx.window.end}`
  if (fallback.updated_at) return `updated:${fallback.updated_at}`
  if (fallback.sourceIds?.length) return `sources:${fallback.sourceIds.slice().sort().join(',')}`
  return `snapshot:${stableHash(fallback.snapshot)}`
}

function observedAtForOpportunity(opportunity: OpportunityLifecycleRow, ctx: ProducerContext): string {
  return ctx.observed_at ?? ctx.window?.end ?? opportunity.updated_at ?? opportunity.closed_at ?? opportunity.claimed_at ?? opportunity.live_at ?? opportunity.intake_at ?? new Date().toISOString()
}

function derivation(method: string, version: string, inputs: Record<string, unknown>, factors: Record<string, unknown>, upstream_event_ids?: string[]): ObservationDerivation {
  return { method, version, inputs, factors, upstream_event_ids }
}

function classifyPatterns(text: string, patterns: Record<string, RegExp>): ClassificationResult {
  const matched = Object.entries(patterns).filter(([, rx]) => rx.test(text)).map(([key]) => key)
  const primary = matched[0] ?? 'general_pattern'
  const secondary = matched.slice(1)
  return {
    primary,
    secondary_matches: secondary,
    matched_patterns: matched,
    classification_notes: matched.length > 1
      ? [`Multiple evidence patterns detected: ${matched.join(', ')}`]
      : matched.length === 1
        ? [`Single evidence pattern detected: ${primary}`]
        : ['No specific classifier matched; conservative general pattern used'],
    strength: matched.length === 0 ? 0.25 : Math.min(1, 0.62 + matched.length * 0.10),
  }
}

export function produceContractorPerformanceObservations(contractorId: string, assignments: AssignmentOutcomeRow[], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  const observedAt = now(ctx)
  const total = assignments.length
  if (total === 0) return []

  const responseHours = assignments.map(a => hoursBetween(a.claimed_at ?? a.offered_at, a.first_contact_at)).filter((v): v is number => v != null)
  const avgResponseHours = avg(responseHours)
  const proposals = assignments.filter(a => !!a.proposal_at).length
  const won = assignments.filter(a => a.status === 'won' || a.close_status === 'won').length
  const lost = assignments.filter(a => a.status === 'lost' || a.close_status === 'lost').length
  const refunded = assignments.filter(a => !!a.refund_at || a.status === 'refunded').length
  const disputed = assignments.filter(a => !!a.dispute_filed_at).length
  const batteryProjects = assignments.filter(a => (a.financing_offered ?? '').toLowerCase().includes('battery') || ((a.system_size_kw ?? 0) > 0 && JSON.stringify(a).toLowerCase().includes('battery')))
  const confidence = sampleConfidence(total)
  const base = { contractor_id: contractorId, sample_size: total, window: ctx.window ?? null }
  const ids = assignments.map(a => a.id)

  return [
    createObservationDraft({ entity_type: 'contractor', entity_id: contractorId, observation_type: 'contractor_response_speed', source_system: 'contractor_performance_producer', confidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:contractor_performance:${contractorId}:${ctx.window?.start ?? 'all'}:${ctx.window?.end ?? 'all'}:response_speed`, derivation: derivation('contractor_performance.response_speed', 'v1', base, { response_hours: responseHours, avg_response_hours: avgResponseHours, confidence_factors: { sample_size: total } }, ids), payload: { avg_response_hours: avgResponseHours, response_sample_size: responseHours.length, rating: avgResponseHours == null ? 'unknown' : avgResponseHours <= 4 ? 'fast' : avgResponseHours <= 24 ? 'normal' : 'slow' } }),
    createObservationDraft({ entity_type: 'contractor', entity_id: contractorId, observation_type: 'contractor_close_rate', source_system: 'contractor_performance_producer', confidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:contractor_performance:${contractorId}:${ctx.window?.start ?? 'all'}:${ctx.window?.end ?? 'all'}:close_rate`, derivation: derivation('contractor_performance.close_rate', 'v1', base, { won, lost, proposals, total, close_rate: pct(won, Math.max(1, won + lost)), confidence_factors: { sample_size: total } }, ids), payload: { won, lost, proposals, total_assignments: total, close_rate: pct(won, Math.max(1, won + lost)), proposal_acceptance_rate: pct(won, Math.max(1, proposals)) } }),
    createObservationDraft({ entity_type: 'contractor', entity_id: contractorId, observation_type: 'contractor_cancellation_dispute_frequency', source_system: 'contractor_performance_producer', confidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:contractor_performance:${contractorId}:${ctx.window?.start ?? 'all'}:${ctx.window?.end ?? 'all'}:cancellation_dispute`, derivation: derivation('contractor_performance.cancellation_dispute_frequency', 'v1', base, { refunded, disputed, total, confidence_factors: { sample_size: total } }, ids), payload: { refunded, disputed, refund_rate: pct(refunded, total), dispute_rate: pct(disputed, total) } }),
    createObservationDraft({ entity_type: 'contractor', entity_id: contractorId, observation_type: 'contractor_battery_experience', source_system: 'contractor_performance_producer', confidence: sampleConfidence(batteryProjects.length), observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:contractor_performance:${contractorId}:${ctx.window?.start ?? 'all'}:${ctx.window?.end ?? 'all'}:battery_experience`, derivation: derivation('contractor_performance.battery_experience', 'v1', base, { battery_project_count: batteryProjects.length, total, confidence_factors: { sample_size: batteryProjects.length } }, batteryProjects.map(a => a.id)), payload: { battery_project_count: batteryProjects.length, battery_experience_level: batteryProjects.length >= 10 ? 'strong' : batteryProjects.length >= 3 ? 'emerging' : 'limited' } }),
  ]
}

export function produceHomeownerEngagementObservations(entity: { client_id?: string | null; project_id?: string | null; opportunity_id?: string | null }, events: HomeownerEngagementRow[], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  if (events.length === 0) return []
  const attachment = entity.client_id ? { entity_type: 'client' as const, entity_id: entity.client_id } : entity.project_id ? { entity_type: 'project' as const, entity_id: entity.project_id } : entity.opportunity_id ? { entity_type: 'opportunity' as const, entity_id: entity.opportunity_id } : null
  if (!attachment) return []

  const observedAt = now(ctx)
  const types = events.map(e => e.event_type)
  const typeSet = new Set(types)
  const proposalViews = types.filter(t => /proposal.*view/i.test(t)).length
  const financingClicks = types.filter(t => /financ/i.test(t)).length
  const billUploads = types.filter(t => /bill.*upload|utility_bill/i.test(t)).length
  const surveyCompletions = types.filter(t => /survey.*complete/i.test(t)).length
  const communication = types.filter(t => /message|email|sms|call|communication/i.test(t)).length
  const score = Math.round(clamp01((typeSet.size / 8) * 0.35 + Math.min(events.length, 20) / 20 * 0.35 + (proposalViews + financingClicks + billUploads + surveyCompletions) / 8 * 0.30) * 100)
  const confidence = deriveConfidence({ sampleSize: events.length, sourceReliability: 0.72, explicitness: 0.70, metadataRichness: typeSet.size / 8, classificationStrength: score / 100, corroboratingSignals: typeSet.size })

  return [createObservationDraft({
    ...attachment, observation_type: 'homeowner_engagement_score', source_system: 'homeowner_engagement_producer', confidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null,
    idempotency_key: `producer:homeowner_engagement:${attachment.entity_type}:${attachment.entity_id}:${ctx.window?.start ?? 'all'}:${ctx.window?.end ?? 'all'}:engagement_score`,
    derivation: derivation('homeowner_engagement.weighted_event_score', 'v1', { entity, event_count: events.length, window: ctx.window ?? null }, { unique_event_types: typeSet.size, proposalViews, financingClicks, billUploads, surveyCompletions, communication, score, confidence_factors: { sample_size: events.length, unique_event_types: typeSet.size } }, events.map(e => e.event_id)),
    payload: { engagement_score: score, buying_intent: score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low', proposal_views: proposalViews, financing_clicks: financingClicks, bill_uploads: billUploads, survey_completions: surveyCompletions, communication_events: communication, event_count: events.length },
  })]
}

export function produceAhjCorrectionObservations(events: AhjEventRow[], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  return events.flatMap(e => {
    const ahjId = e.ahj_id ?? e.ahj_name
    if (!ahjId) return []
    const text = `${e.event_type} ${e.details ?? ''} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase()
    const classification = classifyPatterns(text, {
      ahj_fire_setback_pattern: /fire|setback|pathway|access/i,
      ahj_battery_restriction: /battery|ess|storage/i,
      ahj_conduit_requirement: /conduit|raceway|wireway|label/i,
      ahj_plan_revision_pattern: /revision|redline|resubmit|correction/i,
    })
    const confidence = deriveConfidence({ sampleSize: 1, sourceReliability: 0.70, explicitness: classification.primary === 'general_pattern' ? 0.30 : 0.78, metadataRichness: e.metadata ? 0.65 : 0.35, classificationStrength: classification.strength, corroboratingSignals: classification.matched_patterns.length, maxConfidence: 0.82 })
    return createObservationDraft({
      entity_type: 'ahj', entity_id: ahjId, observation_type: classification.primary, source_system: 'ahj_correction_producer', confidence, observed_at: e.occurred_at || now(ctx), correlation_id: ctx.correlation_id ?? null,
      idempotency_key: `producer:ahj_correction:${normalizedIdPart(ahjId)}:${e.project_id ?? 'no_project'}:${classification.primary}:${e.id}`,
      derivation: derivation('ahj_correction.keyword_classifier', 'v1', { event_id: e.id, project_id: e.project_id, ahj_id: ahjId }, { matched_pattern: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, text_excerpt: text.slice(0, 500), confidence_factors: { classification_strength: classification.strength } }, [e.id]),
      payload: { pattern: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, project_id: e.project_id ?? null, ahj_name: e.ahj_name ?? null, details: e.details ?? null, metadata: e.metadata ?? {} },
    })
  })
}

export function produceUtilityBehaviorObservations(events: UtilityEventRow[], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  return events.flatMap(e => {
    const utilityId = e.utility_id ?? e.utility_name
    if (!utilityId) return []
    const text = `${e.event_type} ${e.details ?? ''} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase()
    const classification = classifyPatterns(text, {
      utility_pto_delay_pattern: /pto|permission to operate|delay|waiting/i,
      utility_battery_restriction: /battery|export.*restriction|non.?export/i,
      utility_export_behavior: /export|net metering|nem|buyback/i,
      utility_interconnection_complexity: /interconnection|transformer|upgrade|study|application/i,
    })
    const confidence = deriveConfidence({ sampleSize: 1, sourceReliability: 0.72, explicitness: classification.primary === 'general_pattern' ? 0.28 : 0.76, metadataRichness: e.metadata ? 0.65 : 0.35, classificationStrength: classification.strength, corroboratingSignals: classification.matched_patterns.length, maxConfidence: 0.82 })
    return createObservationDraft({
      entity_type: 'utility', entity_id: utilityId, observation_type: classification.primary, source_system: 'utility_behavior_producer', confidence, observed_at: e.occurred_at || now(ctx), correlation_id: ctx.correlation_id ?? null,
      idempotency_key: `producer:utility_behavior:${normalizedIdPart(utilityId)}:${e.project_id ?? e.opportunity_id ?? 'no_entity'}:${classification.primary}:${e.id}`,
      derivation: derivation('utility_behavior.keyword_classifier', 'v1', { event_id: e.id, project_id: e.project_id, opportunity_id: e.opportunity_id, utility_id: utilityId }, { matched_pattern: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, text_excerpt: text.slice(0, 500), confidence_factors: { classification_strength: classification.strength } }, [e.id]),
      payload: { pattern: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, project_id: e.project_id ?? null, opportunity_id: e.opportunity_id ?? null, utility_name: e.utility_name ?? null, details: e.details ?? null, metadata: e.metadata ?? {} },
    })
  })
}

export function produceOpportunityLifecycleObservations(opportunity: OpportunityLifecycleRow, assignments: AssignmentOutcomeRow[] = [], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  const observedAt = observedAtForOpportunity(opportunity, ctx)
  const sourceIds = assignments.map(a => a.id)
  const boundary = replayBoundary(ctx, { updated_at: opportunity.updated_at, sourceIds, snapshot: { opportunity, assignments } })
  const ageDays = daysBetween(opportunity.intake_at, observedAt)
  const claimLatencies = assignments.map(a => hoursBetween(a.offered_at, a.claimed_at)).filter((v): v is number => v != null)
  const claimLatencyHours = claimLatencies.length ? Math.min(...claimLatencies) : null
  const proposalCount = assignments.filter(a => !!a.proposal_at).length
  const won = assignments.some(a => a.close_status === 'won' || a.status === 'won')
  const lost = assignments.some(a => a.close_status === 'lost' || a.status === 'lost')
  const errors = Array.isArray(opportunity.validation_errors) ? opportunity.validation_errors.length : 0
  const riskScore = Math.round(clamp01((ageDays ?? 0) / 45 * 0.35 + (opportunity.duplicate_flag ? 0.25 : 0) + (opportunity.spam_flag ? 0.25 : 0) + Math.min(errors, 5) / 5 * 0.15) * 100)
  const heat = Math.round(clamp01((assignments.length / 5) * 0.45 + (claimLatencyHours == null ? 0 : Math.max(0, 1 - claimLatencyHours / 72) * 0.35) + (proposalCount > 0 ? 0.2 : 0)) * 100)
  const conversionProbability = won ? 100 : lost ? 5 : Math.round(clamp01(((opportunity.opportunity_score ?? 50) / 100) * 0.55 + heat / 100 * 0.30 + (riskScore < 40 ? 0.15 : 0)) * 100)
  const lifecycleConfidence = deriveConfidence({ sampleSize: assignments.length, sourceReliability: 0.78, explicitness: opportunity.status ? 0.70 : 0.40, metadataRichness: [opportunity.intake_at, opportunity.updated_at, opportunity.opportunity_score].filter(Boolean).length / 3, classificationStrength: 0.65, corroboratingSignals: assignments.length, maxConfidence: 0.86 })
  const heatConfidence = deriveConfidence({ sampleSize: assignments.length, sourceReliability: 0.74, explicitness: assignments.length ? 0.72 : 0.30, metadataRichness: claimLatencyHours == null ? 0.35 : 0.70, classificationStrength: heat / 100, corroboratingSignals: assignments.length, maxConfidence: 0.84 })

  return [
    createObservationDraft({ entity_type: 'opportunity', entity_id: opportunity.id, observation_type: 'opportunity_risk_score', source_system: 'opportunity_lifecycle_producer', confidence: lifecycleConfidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:opportunity_lifecycle:${opportunity.id}:${boundary}:risk`, derivation: derivation('opportunity_lifecycle.risk_score', 'v1', { opportunity_id: opportunity.id, status: opportunity.status, replay_boundary: boundary }, { ageDays, duplicate_flag: opportunity.duplicate_flag, spam_flag: opportunity.spam_flag, validation_error_count: errors, riskScore, confidence_factors: { assignment_count: assignments.length, has_updated_at: !!opportunity.updated_at } }, sourceIds), payload: { risk_score: riskScore, age_days: ageDays, status: opportunity.status, enrichment_status: opportunity.enrichment_status } }),
    createObservationDraft({ entity_type: 'opportunity', entity_id: opportunity.id, observation_type: 'opportunity_claim_heat', source_system: 'opportunity_lifecycle_producer', confidence: heatConfidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:opportunity_lifecycle:${opportunity.id}:${boundary}:claim_heat`, derivation: derivation('opportunity_lifecycle.claim_heat', 'v1', { opportunity_id: opportunity.id, replay_boundary: boundary }, { assignment_count: assignments.length, claimLatencyHours, proposalCount, heat, confidence_factors: { assignment_count: assignments.length, has_claim_latency: claimLatencyHours != null } }, sourceIds), payload: { claim_heat: heat, assignment_count: assignments.length, claim_latency_hours: claimLatencyHours, proposal_count: proposalCount } }),
    createObservationDraft({ entity_type: 'opportunity', entity_id: opportunity.id, observation_type: 'opportunity_conversion_probability', source_system: 'opportunity_lifecycle_producer', confidence: lifecycleConfidence, observed_at: observedAt, correlation_id: ctx.correlation_id ?? null, idempotency_key: `producer:opportunity_lifecycle:${opportunity.id}:${boundary}:conversion_probability`, derivation: derivation('opportunity_lifecycle.conversion_probability', 'v1', { opportunity_id: opportunity.id, replay_boundary: boundary }, { opportunity_score: opportunity.opportunity_score, heat, riskScore, won, lost, conversionProbability, confidence_factors: { assignment_count: assignments.length, has_score: opportunity.opportunity_score != null } }, sourceIds), payload: { conversion_probability: conversionProbability, won, lost, opportunity_score: opportunity.opportunity_score ?? null } }),
  ]
}

export function produceFailureIntelligenceObservations(events: FailureEventRow[], ctx: ProducerContext = {}): IntelligenceObservationDraft[] {
  return events.map(e => {
    const text = `${e.failure_type} ${e.details ?? ''} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase()
    const classification = classifyPatterns(text, {
      inspection_failure_pattern: /inspection|inspector|failed inspection/i,
      permit_failure_pattern: /permit|redline|revision|resubmit/i,
      financing_failure_reason: /finance|credit|loan|lender/i,
      utility_rejection_pattern: /utility|interconnection|pto|export|transformer/i,
      redesign_root_cause: /redesign|layout|roof|structural|setback|conduit|label/i,
    })
    const confidence = deriveConfidence({ sampleSize: 1, sourceReliability: 0.70, explicitness: classification.primary === 'general_pattern' ? 0.30 : 0.78, metadataRichness: e.metadata ? 0.65 : 0.35, classificationStrength: classification.strength, corroboratingSignals: classification.matched_patterns.length, maxConfidence: 0.84 })
    return createObservationDraft({
      entity_type: e.entity_type, entity_id: e.entity_id, observation_type: classification.primary, source_system: 'failure_intelligence_producer', confidence, observed_at: e.occurred_at || now(ctx), correlation_id: ctx.correlation_id ?? null,
      idempotency_key: `producer:failure:${e.entity_type}:${e.entity_id}:${classification.primary}:${e.id}`,
      derivation: derivation('failure_intelligence.keyword_classifier', 'v1', { event_id: e.id, entity_type: e.entity_type, entity_id: e.entity_id, failure_type: e.failure_type }, { rootCause: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, text_excerpt: text.slice(0, 500), confidence_factors: { classification_strength: classification.strength } }, [e.id]),
      payload: { root_cause: classification.primary, secondary_matches: classification.secondary_matches, matched_patterns: classification.matched_patterns, classification_notes: classification.classification_notes, failure_type: e.failure_type, details: e.details ?? null, metadata: e.metadata ?? {} },
    })
  })
}
