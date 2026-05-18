import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  deriveConfidence,
  produceAhjCorrectionObservations,
  produceContractorPerformanceObservations,
  produceFailureIntelligenceObservations,
  produceHomeownerEngagementObservations,
  produceOpportunityLifecycleObservations,
  produceUtilityBehaviorObservations,
} from './producers'
import { validateObservationDraft } from './observations'

describe('intelligence producers', () => {
  it('generates contractor performance observations attached to contractor canonical entity', () => {
    const obs = produceContractorPerformanceObservations('user-1', [
      { id: 'a1', contractor_id: 'user-1', opportunity_id: 'opp-1', offered_at: '2025-01-01T00:00:00Z', claimed_at: '2025-01-01T01:00:00Z', first_contact_at: '2025-01-01T03:00:00Z', proposal_at: '2025-01-03T00:00:00Z', status: 'won', close_status: 'won', closed_at: '2025-01-15T00:00:00Z' },
      { id: 'a2', contractor_id: 'user-1', opportunity_id: 'opp-2', offered_at: '2025-01-02T00:00:00Z', claimed_at: '2025-01-02T03:00:00Z', first_contact_at: '2025-01-03T03:00:00Z', status: 'lost', close_status: 'lost', lost_reason: 'homeowner_declined' },
    ], { observed_at: '2025-02-01T00:00:00Z', window: { start: '2025-01-01', end: '2025-02-01' } })

    expect(obs.length).toBeGreaterThanOrEqual(4)
    expect(obs.every(o => o.entity_type === 'contractor' && o.entity_id === 'user-1')).toBe(true)
    expect(obs.map(o => o.observation_type)).toContain('contractor_response_speed')
    expect(obs.every(o => validateObservationDraft(o).valid)).toBe(true)
    expect(obs.every(o => o.idempotency_key?.startsWith('producer:contractor_performance:user-1'))).toBe(true)
  })

  it('generates homeowner engagement observations from project/client events and never uses homeowner entity type', () => {
    const obs = produceHomeownerEngagementObservations({ client_id: 'client-1', project_id: 'project-1' }, [
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e1', event_type: 'portal_login', occurred_at: '2025-01-01T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e2', event_type: 'proposal_viewed', occurred_at: '2025-01-02T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e3', event_type: 'financing_click', occurred_at: '2025-01-03T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e4', event_type: 'utility_bill_upload', occurred_at: '2025-01-04T00:00:00Z' },
    ], { observed_at: '2025-01-05T00:00:00Z' })

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('client')
    expect(obs[0].entity_type).not.toBe('homeowner')
    expect(obs[0].observation_type).toBe('homeowner_engagement_score')
    expect(obs[0].payload.buying_intent).toBeTruthy()
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('returns no homeowner engagement observation if no canonical attachment is provided', () => {
    const obs = produceHomeownerEngagementObservations({}, [
      { project_id: 'project-1', event_id: 'e1', event_type: 'portal_login', occurred_at: '2025-01-01T00:00:00Z' },
    ])
    expect(obs).toEqual([])
  })

  it('captures AHJ primary and secondary matches for ambiguous text', () => {
    const obs = produceAhjCorrectionObservations([
      { id: 'ahj-event-1', project_id: 'project-1', ahj_name: 'Phoenix AHJ', event_type: 'permit_redline', occurred_at: '2025-01-01T00:00:00Z', details: 'Battery fire setback pathway needs conduit revision and resubmit' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('ahj')
    expect(obs[0].observation_type).toBe('ahj_fire_setback_pattern')
    expect(obs[0].payload.secondary_matches).toEqual(expect.arrayContaining(['ahj_battery_restriction', 'ahj_conduit_requirement', 'ahj_plan_revision_pattern']))
    expect(obs[0].derivation.factors.matched_patterns).toEqual(expect.arrayContaining(['ahj_fire_setback_pattern', 'ahj_battery_restriction']))
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('captures utility primary and secondary matches for PTO plus transformer upgrade text', () => {
    const obs = produceUtilityBehaviorObservations([
      { id: 'util-event-1', project_id: 'project-1', utility_id: 'PGE_CA', utility_name: 'PG&E', event_type: 'interconnection_delay', occurred_at: '2025-01-01T00:00:00Z', details: 'PTO delayed pending transformer upgrade interconnection study and export review' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('utility')
    expect(obs[0].entity_id).toBe('PGE_CA')
    expect(obs[0].observation_type).toBe('utility_pto_delay_pattern')
    expect(obs[0].payload.secondary_matches).toEqual(expect.arrayContaining(['utility_export_behavior', 'utility_interconnection_complexity']))
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('generates stable opportunity lifecycle idempotency keys without observed_at', () => {
    const opportunity = { id: 'opp-1', status: 'live', intake_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-09T00:00:00Z', opportunity_score: 82, enrichment_status: 'completed', duplicate_flag: false, spam_flag: false, validation_errors: [] }
    const assignments = [{ id: 'a1', contractor_id: 'user-1', opportunity_id: 'opp-1', offered_at: '2025-01-05T00:00:00Z', claimed_at: '2025-01-05T06:00:00Z', proposal_at: '2025-01-07T00:00:00Z' }]
    const first = produceOpportunityLifecycleObservations(opportunity, assignments)
    const second = produceOpportunityLifecycleObservations(opportunity, assignments)

    expect(first.map(o => o.idempotency_key)).toEqual(second.map(o => o.idempotency_key))
    expect(first.map(o => o.idempotency_key).join('|')).toContain('updated:2025-01-09T00:00:00Z')
    expect(first.every(o => o.entity_type === 'opportunity' && o.entity_id === 'opp-1')).toBe(true)
    expect(first.every(o => validateObservationDraft(o).valid)).toBe(true)
  })

  it('uses stable snapshot hash fallback for lifecycle replay with omitted observed_at and no updated_at', () => {
    const opportunity = { id: 'opp-snapshot', status: 'intake', intake_at: '2025-01-01T00:00:00Z', opportunity_score: 50 }
    const first = produceOpportunityLifecycleObservations(opportunity, [])
    const second = produceOpportunityLifecycleObservations(opportunity, [])
    expect(first.map(o => o.idempotency_key)).toEqual(second.map(o => o.idempotency_key))
    expect(first.map(o => o.idempotency_key).join('|')).toContain('snapshot:')
  })

  it('classifies inspection/failure intelligence with secondary root-cause detail', () => {
    const obs = produceFailureIntelligenceObservations([
      { id: 'failure-1', entity_type: 'project', entity_id: 'project-1', failure_type: 'inspection_failed', occurred_at: '2025-01-01T00:00:00Z', details: 'Inspection failed due to conduit labeling issue requiring redesign' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('project')
    expect(obs[0].observation_type).toBe('inspection_failure_pattern')
    expect(obs[0].payload.secondary_matches).toEqual(expect.arrayContaining(['redesign_root_cause']))
    expect(obs[0].derivation.method).toBe('failure_intelligence.keyword_classifier')
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('keeps confidence values bounded for every producer', () => {
    const all = [
      ...produceContractorPerformanceObservations('contractor-1', [{ id: 'a1', contractor_id: 'contractor-1' }]),
      ...produceHomeownerEngagementObservations({ client_id: 'client-1' }, [{ project_id: 'p1', client_id: 'client-1', event_id: 'e1', event_type: 'portal_login', occurred_at: '2025-01-01T00:00:00Z' }]),
      ...produceAhjCorrectionObservations([{ id: 'ahj1', ahj_name: 'AHJ', event_type: 'note', occurred_at: '2025-01-01T00:00:00Z', details: 'unknown note' }]),
      ...produceUtilityBehaviorObservations([{ id: 'u1', utility_id: 'PGE_CA', event_type: 'note', occurred_at: '2025-01-01T00:00:00Z', details: 'unknown note' }]),
      ...produceOpportunityLifecycleObservations({ id: 'opp-1', status: 'intake' }, []),
      ...produceFailureIntelligenceObservations([{ id: 'f1', entity_type: 'project', entity_id: 'p1', failure_type: 'unknown', occurred_at: '2025-01-01T00:00:00Z' }]),
    ]

    expect(deriveConfidence({ sampleSize: 100, sourceReliability: 1, explicitness: 1, metadataRichness: 1, recency: 1, classificationStrength: 1, corroboratingSignals: 10 })).toBeLessThanOrEqual(1)
    expect(all.length).toBeGreaterThan(0)
    for (const o of all) {
      expect(o.confidence).toBeGreaterThanOrEqual(0)
      expect(o.confidence).toBeLessThanOrEqual(1)
      expect(validateObservationDraft(o).valid).toBe(true)
    }
  })

  it('producer module remains observation-only with no DB writer/import side effects or canonical lifecycle mutation', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/intelligence/producers.ts'), 'utf8')
    expect(src).not.toMatch(/from ['"]@neondatabase\/serverless['"]|from ['"]@\/lib\/db-neon['"]|getDbReady|fetch\(/)
    expect(src).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|CREATE TABLE|ALTER TABLE/)
    expect(src).not.toMatch(/project_status\s*=|network_opportunities\s+SET|contractor_profiles\s+SET|utility_policies\s+SET/)
    expect(src).not.toMatch(/entity_type:\s*['"]homeowner['"]/) 
  })
})
