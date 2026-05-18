/**
 * lib/intelligence/observations.ts
 *
 * Canonical Intelligence Observations.
 *
 * Observations are derived, explainable facts attached to canonical entities.
 * They are NOT lifecycle authority and they do NOT replace existing source of
 * truth tables such as network_opportunities, projects, users, contractor_profiles,
 * utility_policies, or existing event logs.
 */

import { neon } from '@neondatabase/serverless'
import type { CanonicalEventEnvelope, CanonicalEventEntityType } from './events'

// ─────────────────────────────────────────────────────────────────────────────
// Constants + types
// ─────────────────────────────────────────────────────────────────────────────

export const INTELLIGENCE_OBSERVATION_SCHEMA_VERSION = 'intelligence-observation.v1' as const

export type IntelligenceObservationSchemaVersion = typeof INTELLIGENCE_OBSERVATION_SCHEMA_VERSION

export type ObservationEntityType = Exclude<CanonicalEventEntityType, 'webhook' | 'admin' | 'system'> | 'user'

export const APPROVED_OBSERVATION_ENTITY_TYPES = [
  'opportunity',
  'project',
  'contractor',
  'client',
  'utility',
  'ahj',
  'campaign',
  'assignment',
  'user',
] as const satisfies readonly ObservationEntityType[]

export const OBSERVATION_SOURCES = [
  'intake_pipeline',
  'network_events',
  'project_activity',
  'webhook_ingestion_log',
  'admin_activity_log',
  'opportunity_scorer',
  'contractor_matcher',
  'enrichment_orchestrator',
  'property_enricher',
  'solar_enricher',
  'utility_enricher',
  'ahj_lookup',
  'utility_matcher',
  'proposal_utility_truth_engine',
  'incentive_engine',
  'survey_ingest_pipeline',
  'permit_engine',
  'operations_pipeline',
  'system',
] as const

export type ObservationSourceSystem = typeof OBSERVATION_SOURCES[number] | (string & {})

export interface ObservationDerivation {
  method: string
  version: string
  inputs: Record<string, unknown>
  factors: Record<string, unknown>
  upstream_event_ids?: string[]
  formula?: string
  notes?: string
}

export interface IntelligenceObservationDraft<Payload extends Record<string, unknown> = Record<string, unknown>> {
  entity_type: ObservationEntityType
  entity_id: string
  observation_type: string
  source_system: ObservationSourceSystem
  confidence: number
  observed_at: string
  derivation: ObservationDerivation
  payload: Payload
  schema_version: IntelligenceObservationSchemaVersion
  correlation_id?: string | null
  causation_id?: string | null
  idempotency_key?: string | null
}

export interface IntelligenceObservation<Payload extends Record<string, unknown> = Record<string, unknown>> extends IntelligenceObservationDraft<Payload> {
  id: string
  created_at: string
}

export interface ObservationValidationResult {
  valid: boolean
  errors: string[]
}

export type ObservationWriteStatus = 'inserted' | 'skipped_existing' | 'failed'

export interface ObservationWriteResult {
  status: ObservationWriteStatus
  observation?: IntelligenceObservation
  error?: string
}

export interface ObservationWriter {
  writeObservation(observation: IntelligenceObservationDraft): Promise<ObservationWriteResult>
  writeObservations(observations: IntelligenceObservationDraft[]): Promise<ObservationWriteResult[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isApprovedObservationEntityType(value: string): value is ObservationEntityType {
  return (APPROVED_OBSERVATION_ENTITY_TYPES as readonly string[]).includes(value)
}

export function validateObservationDraft(observation: IntelligenceObservationDraft): ObservationValidationResult {
  const errors: string[] = []

  if (!observation || typeof observation !== 'object') errors.push('observation is required')
  if (!isApprovedObservationEntityType(observation.entity_type)) errors.push(`entity_type is not approved: ${String(observation.entity_type)}`)
  if (!observation.entity_id || typeof observation.entity_id !== 'string') errors.push('entity_id is required')
  if (!observation.observation_type || typeof observation.observation_type !== 'string') errors.push('observation_type is required')
  if (!observation.source_system || typeof observation.source_system !== 'string') errors.push('source_system is required')
  if (typeof observation.confidence !== 'number' || Number.isNaN(observation.confidence)) errors.push('confidence must be a number')
  if (observation.confidence < 0 || observation.confidence > 1) errors.push('confidence must be between 0 and 1')
  if (!observation.observed_at || Number.isNaN(new Date(observation.observed_at).getTime())) errors.push('observed_at must be a valid timestamp')
  if (observation.schema_version !== INTELLIGENCE_OBSERVATION_SCHEMA_VERSION) errors.push(`schema_version must be ${INTELLIGENCE_OBSERVATION_SCHEMA_VERSION}`)

  if (!observation.derivation || typeof observation.derivation !== 'object') {
    errors.push('derivation is required')
  } else {
    if (!observation.derivation.method) errors.push('derivation.method is required')
    if (!observation.derivation.version) errors.push('derivation.version is required')
    if (!observation.derivation.inputs || typeof observation.derivation.inputs !== 'object') errors.push('derivation.inputs is required')
    if (!observation.derivation.factors || typeof observation.derivation.factors !== 'object') errors.push('derivation.factors is required')
  }

  if (!observation.payload || typeof observation.payload !== 'object' || Array.isArray(observation.payload)) {
    errors.push('payload must be an object')
  }

  return { valid: errors.length === 0, errors }
}

export function assertValidObservationDraft(observation: IntelligenceObservationDraft): void {
  const result = validateObservationDraft(observation)
  if (!result.valid) {
    throw new Error(`Invalid intelligence observation: ${result.errors.join('; ')}`)
  }
}

export function createObservationDraft<Payload extends Record<string, unknown>>(input: Omit<IntelligenceObservationDraft<Payload>, 'schema_version'>): IntelligenceObservationDraft<Payload> {
  const draft: IntelligenceObservationDraft<Payload> = {
    ...input,
    schema_version: INTELLIGENCE_OBSERVATION_SCHEMA_VERSION,
  }
  assertValidObservationDraft(draft)
  return draft
}

// ─────────────────────────────────────────────────────────────────────────────
// DB writer
// ─────────────────────────────────────────────────────────────────────────────

export class NeonObservationWriter implements ObservationWriter {
  private sql = neon(process.env.DATABASE_URL!)

  async writeObservation(observation: IntelligenceObservationDraft): Promise<ObservationWriteResult> {
    assertValidObservationDraft(observation)

    try {
      const rows = await this.sql`
        WITH inserted AS (
          INSERT INTO intelligence_observations (
            entity_type,
            entity_id,
            observation_type,
            source_system,
            confidence,
            observed_at,
            derivation,
            payload,
            schema_version,
            correlation_id,
            causation_id,
            idempotency_key
          ) VALUES (
            ${observation.entity_type},
            ${observation.entity_id},
            ${observation.observation_type},
            ${observation.source_system},
            ${observation.confidence},
            ${observation.observed_at},
            ${JSON.stringify(observation.derivation)},
            ${JSON.stringify(observation.payload)},
            ${observation.schema_version},
            ${observation.correlation_id ?? null},
            ${observation.causation_id ?? null},
            ${observation.idempotency_key ?? null}
          )
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING
            id, entity_type, entity_id, observation_type, source_system, confidence,
            observed_at, derivation, payload, schema_version, correlation_id,
            causation_id, idempotency_key, created_at, true AS inserted
        ), existing AS (
          SELECT
            id, entity_type, entity_id, observation_type, source_system, confidence,
            observed_at, derivation, payload, schema_version, correlation_id,
            causation_id, idempotency_key, created_at, false AS inserted
          FROM intelligence_observations
          WHERE idempotency_key = ${observation.idempotency_key ?? null}
            AND ${observation.idempotency_key ?? null} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM inserted)
          LIMIT 1
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT * FROM existing
        LIMIT 1
      `

      const row = rows[0] as (IntelligenceObservation & { inserted?: boolean }) | undefined
      if (!row) return { status: 'failed', error: 'observation_write_returned_no_row' }
      const { inserted: wasInserted, ...obs } = row
      return { status: wasInserted ? 'inserted' : 'skipped_existing', observation: obs as IntelligenceObservation }
    } catch (err: unknown) {
      return { status: 'failed', error: (err as Error).message }
    }
  }

  async writeObservations(observations: IntelligenceObservationDraft[]): Promise<ObservationWriteResult[]> {
    const results: ObservationWriteResult[] = []
    for (const observation of observations) {
      results.push(await this.writeObservation(observation))
    }
    return results
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event → observation bridge helpers
// ─────────────────────────────────────────────────────────────────────────────

export function observationFromIntakeEvent(event: CanonicalEventEnvelope): IntelligenceObservationDraft | null {
  if (event.source_log !== 'intake_events') return null
  if (event.entity_type !== 'opportunity' || !event.entity_id) return null

  const payload = event.payload as Record<string, unknown>
  const validation = (payload.validation_result && typeof payload.validation_result === 'object')
    ? payload.validation_result as Record<string, unknown>
    : {}
  const duplicate = (payload.duplicate_result && typeof payload.duplicate_result === 'object')
    ? payload.duplicate_result as Record<string, unknown>
    : {}

  return createObservationDraft({
    entity_type: 'opportunity',
    entity_id: event.entity_id,
    observation_type: 'intake.pipeline_event',
    source_system: 'intake_pipeline',
    confidence: 1,
    observed_at: event.occurred_at,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    idempotency_key: event.idempotency_key ? `obs:intake:${event.idempotency_key}` : `obs:intake:${event.event_id}`,
    derivation: {
      method: 'event_adapter.intake_events',
      version: 'v1',
      inputs: {
        event_id: event.event_id,
        source_log: event.source_log,
        event_type: event.event_type,
      },
      factors: {
        action: payload.action,
        validation_passed: validation.valid,
        duplicate_detected: duplicate.is_duplicate,
      },
      upstream_event_ids: [event.event_id],
    },
    payload: {
      event_type: event.event_type,
      action: payload.action,
      source_system: payload.source_system,
      source_channel: payload.source_channel,
      funnel_id: payload.funnel_id,
      campaign_id: payload.campaign_id,
      validation_result: validation,
      duplicate_result: duplicate,
      pipeline_result: payload.pipeline_result,
      error_code: payload.error_code,
      error_message: payload.error_message,
    },
  })
}

export function observationFromNetworkEvent(event: CanonicalEventEnvelope): IntelligenceObservationDraft | null {
  if (event.source_log !== 'network_events') return null
  if (!event.entity_id) return null
  if (!isApprovedObservationEntityType(event.entity_type)) return null

  return createObservationDraft({
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    observation_type: `network.${event.event_type}`,
    source_system: 'network_events',
    confidence: 1,
    observed_at: event.occurred_at,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    idempotency_key: event.idempotency_key ? `obs:network:${event.idempotency_key}` : `obs:network:${event.event_id}`,
    derivation: {
      method: 'event_adapter.network_events',
      version: 'v1',
      inputs: {
        event_id: event.event_id,
        source_log: event.source_log,
        event_type: event.event_type,
        from_state: event.from_state,
        to_state: event.to_state,
      },
      factors: {
        event_category: event.event_category,
        actor_type: event.actor_type,
        source_system: event.source_system,
      },
      upstream_event_ids: [event.event_id],
    },
    payload: {
      event_type: event.event_type,
      event_category: event.event_category,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      from_state: event.from_state,
      to_state: event.to_state,
      data: event.payload,
    },
  })
}

export function observationsFromExistingEvent(event: CanonicalEventEnvelope): IntelligenceObservationDraft[] {
  const observations: Array<IntelligenceObservationDraft | null> = [
    observationFromIntakeEvent(event),
    observationFromNetworkEvent(event),
  ]
  return observations.filter((o): o is IntelligenceObservationDraft => o !== null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity scoring observation helper
// ─────────────────────────────────────────────────────────────────────────────

export interface ExplainableScoreInput {
  opportunity_id: string
  score_version: string
  source_system?: ObservationSourceSystem
  confidence?: number
  scored_at?: string
  result: {
    overall_score: number
    overall_grade: string
    property?: Record<string, unknown>
    solar?: Record<string, unknown>
    financial?: Record<string, unknown>
    market?: Record<string, unknown>
    intent?: Record<string, unknown>
    risk_flags?: string[]
    opportunity_highlights?: string[]
    executive_summary?: string
  }
}

export function observationFromOpportunityScore(input: ExplainableScoreInput): IntelligenceObservationDraft {
  const scoredAt = input.scored_at ?? new Date().toISOString()
  const sourceSystem = input.source_system ?? 'opportunity_scorer'
  const confidence = input.confidence ?? 0.9

  return createObservationDraft({
    entity_type: 'opportunity',
    entity_id: input.opportunity_id,
    observation_type: 'opportunity.score.explainable',
    source_system: sourceSystem,
    confidence,
    observed_at: scoredAt,
    idempotency_key: `obs:opportunity_score:${input.opportunity_id}:${input.score_version}:${scoredAt}`,
    derivation: {
      method: 'weighted_dimension_score',
      version: input.score_version,
      inputs: {
        opportunity_id: input.opportunity_id,
      },
      factors: {
        property: input.result.property,
        solar: input.result.solar,
        financial: input.result.financial,
        market: input.result.market,
        intent: input.result.intent,
      },
      formula: 'overall_score = sum(dimension.score * dimension.weight) / sum(weights)',
    },
    payload: {
      overall_score: input.result.overall_score,
      overall_grade: input.result.overall_grade,
      score_version: input.score_version,
      scored_at: scoredAt,
      source_system: sourceSystem,
      confidence,
      dimensions: {
        property: input.result.property,
        solar: input.result.solar,
        financial: input.result.financial,
        market: input.result.market,
        intent: input.result.intent,
      },
      risk_flags: input.result.risk_flags ?? [],
      opportunity_highlights: input.result.opportunity_highlights ?? [],
      executive_summary: input.result.executive_summary ?? null,
    },
  })
}
