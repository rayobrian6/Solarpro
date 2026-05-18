import { describe, expect, it } from 'vitest'
import {
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

  it('generates homeowner engagement observations from project/client events', () => {
    const obs = produceHomeownerEngagementObservations({ client_id: 'client-1', project_id: 'project-1' }, [
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e1', event_type: 'portal_login', occurred_at: '2025-01-01T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e2', event_type: 'proposal_viewed', occurred_at: '2025-01-02T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e3', event_type: 'financing_click', occurred_at: '2025-01-03T00:00:00Z' },
      { project_id: 'project-1', client_id: 'client-1', event_id: 'e4', event_type: 'utility_bill_upload', occurred_at: '2025-01-04T00:00:00Z' },
    ], { observed_at: '2025-01-05T00:00:00Z' })

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('client')
    expect(obs[0].observation_type).toBe('homeowner_engagement_score')
    expect(obs[0].payload.buying_intent).toBeTruthy()
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('classifies AHJ correction patterns without modifying engineering rules', () => {
    const obs = produceAhjCorrectionObservations([
      { id: 'ahj-event-1', project_id: 'project-1', ahj_name: 'Phoenix AHJ', event_type: 'permit_redline', occurred_at: '2025-01-01T00:00:00Z', details: 'Fire setback pathway needs revision and resubmit' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('ahj')
    expect(obs[0].entity_id).toBe('Phoenix AHJ')
    expect(obs[0].observation_type).toBe('ahj_fire_setback_pattern')
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('classifies utility behavior attached to canonical utility entity strings', () => {
    const obs = produceUtilityBehaviorObservations([
      { id: 'util-event-1', project_id: 'project-1', utility_id: 'PGE_CA', utility_name: 'PG&E', event_type: 'interconnection_delay', occurred_at: '2025-01-01T00:00:00Z', details: 'PTO delayed pending transformer upgrade study' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('utility')
    expect(obs[0].entity_id).toBe('PGE_CA')
    expect(obs[0].observation_type).toBe('utility_pto_delay_pattern')
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })

  it('generates opportunity lifecycle intelligence without owning lifecycle state', () => {
    const obs = produceOpportunityLifecycleObservations({
      id: 'opp-1', status: 'live', intake_at: '2025-01-01T00:00:00Z', opportunity_score: 82, enrichment_status: 'completed', duplicate_flag: false, spam_flag: false, validation_errors: [],
    }, [
      { id: 'a1', contractor_id: 'user-1', opportunity_id: 'opp-1', offered_at: '2025-01-05T00:00:00Z', claimed_at: '2025-01-05T06:00:00Z', proposal_at: '2025-01-07T00:00:00Z' },
    ], { observed_at: '2025-01-10T00:00:00Z' })

    expect(obs.map(o => o.observation_type)).toEqual(expect.arrayContaining(['opportunity_risk_score', 'opportunity_claim_heat', 'opportunity_conversion_probability']))
    expect(obs.every(o => o.entity_type === 'opportunity' && o.entity_id === 'opp-1')).toBe(true)
    expect(obs.every(o => validateObservationDraft(o).valid)).toBe(true)
    expect(obs.every(o => !('status' in o && (o as any).status === 'authority'))).toBe(true)
  })

  it('classifies inspection/failure intelligence with explainable derivation', () => {
    const obs = produceFailureIntelligenceObservations([
      { id: 'failure-1', entity_type: 'project', entity_id: 'project-1', failure_type: 'inspection_failed', occurred_at: '2025-01-01T00:00:00Z', details: 'Inspection failed due to conduit labeling issue' },
    ])

    expect(obs).toHaveLength(1)
    expect(obs[0].entity_type).toBe('project')
    expect(obs[0].observation_type).toBe('inspection_failure_pattern')
    expect(obs[0].derivation.method).toBe('failure_intelligence.keyword_classifier')
    expect(validateObservationDraft(obs[0]).valid).toBe(true)
  })
})
