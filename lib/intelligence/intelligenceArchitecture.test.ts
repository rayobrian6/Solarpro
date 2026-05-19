import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  adaptIntakeEvent,
  adaptNetworkEvent,
  adaptProjectActivity,
} from './events'
import {
  APPROVED_OBSERVATION_ENTITY_TYPES,
  INTELLIGENCE_OBSERVATION_SCHEMA_VERSION,
  createObservationDraft,
  observationFromIntakeEvent,
  observationFromNetworkEvent,
  validateObservationDraft,
} from './observations'
import { scoreOpportunity, createOpportunityScoreObservation } from '@/lib/network/opportunityScorer'

const repoRoot = process.cwd()

function readIfExists(rel: string): string {
  const full = path.join(repoRoot, rel)
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : ''
}

describe('canonical intelligence architecture guardrails', () => {
  it('does not introduce duplicate utility source-of-truth tables', () => {
    const migration = readIfExists('lib/migrations/061_intelligence_observations.sql')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS intelligence_observations')
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+utility_/i)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+.*utility.*scor/i)
    expect(migration).not.toMatch(/utility_v2|utility_master|utility_profiles/i)
  })

  it('does not introduce a duplicate opportunity lifecycle table', () => {
    const migration = readIfExists('lib/migrations/061_intelligence_observations.sql')
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+.*opportunit.*lifecycle/i)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+lead_lifecycle/i)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+marketplace_lifecycle/i)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+intake_lifecycle/i)
  })

  it('adds opportunity enrichment as an opportunity_intelligence projection, not a duplicate table', () => {
    const migration = readIfExists('lib/migrations/070_opportunity_intelligence_enrichment.sql')
    expect(migration).toContain('ALTER TABLE opportunity_intelligence')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS enrichment_payload JSONB')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS enrichment_completeness')
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+.*opportunit.*enrichment/i)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+.*opportunit.*intelligence/i)
  })

  it('observations attach only to approved canonical entity types', () => {
    expect(APPROVED_OBSERVATION_ENTITY_TYPES).toEqual([
      'opportunity',
      'project',
      'contractor',
      'client',
      'utility',
      'ahj',
      'campaign',
      'assignment',
      'user',
    ])

    const valid = createObservationDraft({
      entity_type: 'opportunity',
      entity_id: 'opp-1',
      observation_type: 'test.observation',
      source_system: 'system',
      confidence: 0.75,
      observed_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      derivation: {
        method: 'unit_test',
        version: 'v1',
        inputs: { a: 1 },
        factors: { b: 2 },
      },
      payload: { ok: true },
    })

    expect(valid.schema_version).toBe(INTELLIGENCE_OBSERVATION_SCHEMA_VERSION)
    expect(validateObservationDraft(valid).valid).toBe(true)

    const invalid = {
      ...valid,
      entity_type: 'utility_master',
    } as any
    expect(validateObservationDraft(invalid).valid).toBe(false)
  })

  it('event adapters preserve existing logs as source_log and do not create new event authority', () => {
    const network = adaptNetworkEvent({
      id: 'row-1',
      event_id: 'NET-1',
      event_type: 'opportunity.status_changed',
      event_category: 'opportunity',
      opportunity_id: 'opp-1',
      triggered_by: 'system',
      from_status: 'intake',
      to_status: 'screening',
      data: { reason: 'validation_passed' },
      occurred_at: '2025-01-01T00:00:00.000Z',
    })

    expect(network.source_log).toBe('network_events')
    expect(network.entity_type).toBe('opportunity')
    expect(network.entity_id).toBe('opp-1')
    expect(network.from_state).toBe('intake')
    expect(network.to_state).toBe('screening')

    const intake = adaptIntakeEvent({
      id: 'intake-row-1',
      event_id: 'INTAKE-1',
      opportunity_id: 'opp-1',
      event_type: 'intake.created',
      source_system: 'google_ads',
      action: 'created',
      occurred_at: '2025-01-01T01:00:00.000Z',
      payload: { email: 'a@example.com' },
      validation_result: { valid: true },
      duplicate_result: { is_duplicate: false },
      pipeline_result: { status: 'created' },
    })

    expect(intake.source_log).toBe('intake_events')
    expect(intake.entity_type).toBe('opportunity')

    const project = adaptProjectActivity({
      id: 'pa-1',
      project_id: 'proj-1',
      user_id: 'user-1',
      type: 'stage_change',
      title: 'Moved to Engineering',
      metadata: { from: 'contract_signed', to: 'engineering' },
      created_at: '2025-01-01T02:00:00.000Z',
    })

    expect(project.source_log).toBe('project_activity')
    expect(project.entity_type).toBe('project')
    expect(project.from_state).toBe('contract_signed')
    expect(project.to_state).toBe('engineering')
  })

  it('bridges intake and network events into observations without replacing logs', () => {
    const intakeEvent = adaptIntakeEvent({
      id: 'intake-row-2',
      event_id: 'INTAKE-2',
      opportunity_id: 'opp-2',
      event_type: 'intake.created',
      source_system: 'meta',
      source_channel: 'facebook_ads',
      action: 'created',
      idempotency_key: 'idem-2',
      occurred_at: '2025-01-01T01:00:00.000Z',
      validation_result: { valid: true },
      duplicate_result: { is_duplicate: false },
      pipeline_result: { status: 'created' },
    })

    const intakeObs = observationFromIntakeEvent(intakeEvent)
    expect(intakeObs).not.toBeNull()
    expect(intakeObs?.entity_type).toBe('opportunity')
    expect(intakeObs?.entity_id).toBe('opp-2')
    expect(intakeObs?.source_system).toBe('intake_pipeline')
    expect(intakeObs?.derivation.upstream_event_ids).toEqual(['INTAKE-2'])

    const networkEvent = adaptNetworkEvent({
      id: 'network-row-2',
      event_id: 'NET-2',
      event_type: 'opportunity.scored',
      event_category: 'opportunity',
      opportunity_id: 'opp-2',
      data: { overall_score: 88 },
      occurred_at: '2025-01-01T02:00:00.000Z',
    })

    const networkObs = observationFromNetworkEvent(networkEvent)
    expect(networkObs).not.toBeNull()
    expect(networkObs?.source_system).toBe('network_events')
    expect(networkObs?.observation_type).toBe('network.opportunity.scored')
  })

  it('opportunity scoring remains explainable and observation-compatible', () => {
    const result = scoreOpportunity({
      home_value: 500000,
      roof_age_years: 8,
      structure_type: 'single_family',
      usable_roof_pct: 0.78,
      peak_sun_hours: 5.4,
      estimated_system_size_kw: 8.2,
      monthly_bill: 280,
      avg_rate_kwh: 0.24,
      net_metering: true,
      nem_type: 'NEM 2.0',
      state: 'CA',
      source_type: 'google_ads',
      form_completeness: 0.9,
    })

    expect(result.score_version).toBeTruthy()
    expect(result.property.factors).toBeTruthy()
    expect(result.solar.factors).toBeTruthy()
    expect(result.financial.factors).toBeTruthy()
    expect(result.market.factors).toBeTruthy()
    expect(result.intent.factors).toBeTruthy()

    const obs = createOpportunityScoreObservation('opp-score-1', result, {
      confidence: 0.91,
      scored_at: '2025-01-01T03:00:00.000Z',
    })

    expect(obs.entity_type).toBe('opportunity')
    expect(obs.entity_id).toBe('opp-score-1')
    expect(obs.observation_type).toBe('opportunity.score.explainable')
    expect(obs.source_system).toBe('opportunity_scorer')
    expect(obs.confidence).toBe(0.91)
    expect(obs.derivation.version).toBe(result.score_version)
    expect(obs.derivation.factors.property).toBeTruthy()
    expect(obs.payload.overall_score).toBe(result.overall_score)
    expect(validateObservationDraft(obs).valid).toBe(true)
  })
})
