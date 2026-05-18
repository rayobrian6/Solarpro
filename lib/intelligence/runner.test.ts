import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { runIntelligenceProducers } from './runner'
import { normalizeExecutionContext } from './executionContext'
import type { IntelligenceObservation, IntelligenceObservationDraft, ObservationWriter } from './observations'

class MemoryWriter implements ObservationWriter {
  writes: IntelligenceObservationDraft[] = []
  async writeObservation(observation: IntelligenceObservationDraft): Promise<IntelligenceObservation> {
    this.writes.push(observation)
    return { ...observation, id: `mem-${this.writes.length}`, created_at: observation.observed_at }
  }
  async writeObservations(observations: IntelligenceObservationDraft[]): Promise<IntelligenceObservation[]> {
    const out: IntelligenceObservation[] = []
    for (const obs of observations) out.push(await this.writeObservation(obs))
    return out
  }
}

describe('intelligence producer orchestration foundation', () => {
  it('dry-run executes producers, validates observations, and performs zero writes', async () => {
    const writer = new MemoryWriter()
    const result = await runIntelligenceProducers({
      dry_run: true,
      observed_at: '2025-01-10T00:00:00.000Z',
      writer,
      jobs: [{
        producer_name: 'opportunity_lifecycle',
        input: { producer: 'opportunity_lifecycle', opportunity: { id: 'opp-1', status: 'live', updated_at: '2025-01-09T00:00:00Z', opportunity_score: 80 }, assignments: [] },
      }],
      replay_scope: { entity_type: 'opportunity', entity_id: 'opp-1' },
    })

    expect(result.summary.dry_run).toBe(true)
    expect(result.summary.observations_generated).toBe(3)
    expect(result.summary.observations_written).toBe(0)
    expect(writer.writes).toHaveLength(0)
  })

  it('non-dry-run writes idempotent unique observations through provided writer', async () => {
    const writer = new MemoryWriter()
    const result = await runIntelligenceProducers({
      dry_run: false,
      observed_at: '2025-01-10T00:00:00.000Z',
      writer,
      jobs: [{
        producer_name: 'utility_behavior',
        input: { producer: 'utility_behavior', events: [{ id: 'u1', utility_id: 'PGE_CA', event_type: 'pto_delay', occurred_at: '2025-01-01T00:00:00Z', details: 'PTO delayed' }] },
      }],
      replay_scope: { entity_type: 'utility', entity_id: 'PGE_CA', source_event_id: 'u1' },
    })

    expect(result.summary.observations_written).toBe(1)
    expect(writer.writes).toHaveLength(1)
    expect(result.written).toHaveLength(1)
  })

  it('replay produces stable idempotency keys and deterministic run id for same context', async () => {
    const opts = {
      dry_run: true,
      window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-31T00:00:00.000Z' },
      jobs: [{
        producer_name: 'opportunity_lifecycle' as const,
        input: { producer: 'opportunity_lifecycle' as const, opportunity: { id: 'opp-stable', status: 'live', opportunity_score: 77 }, assignments: [{ id: 'a1', contractor_id: 'c1', offered_at: '2025-01-02T00:00:00Z', claimed_at: '2025-01-02T04:00:00Z' }] },
      }],
      replay_scope: { entity_type: 'opportunity' as const, entity_id: 'opp-stable', window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-31T00:00:00.000Z' } },
    }
    const first = await runIntelligenceProducers(opts)
    const second = await runIntelligenceProducers(opts)

    expect(first.context.run_id).toBe(second.context.run_id)
    expect(first.observations.map(o => o.idempotency_key)).toEqual(second.observations.map(o => o.idempotency_key))
    expect(first.summary.replay_boundary).toBe('window:2025-01-01T00:00:00.000Z:2025-01-31T00:00:00.000Z')
  })

  it('deduplicates duplicate observations within a run and reports idempotent collisions', async () => {
    const duplicateEvent = { id: 'u1', utility_id: 'PGE_CA', event_type: 'pto_delay', occurred_at: '2025-01-01T00:00:00Z', details: 'PTO delayed' }
    const result = await runIntelligenceProducers({
      dry_run: true,
      observed_at: '2025-01-10T00:00:00.000Z',
      jobs: [
        { producer_name: 'utility_behavior', input: { producer: 'utility_behavior', events: [duplicateEvent] } },
        { producer_name: 'utility_behavior', input: { producer: 'utility_behavior', events: [duplicateEvent] } },
      ],
      replay_scope: { entity_type: 'utility', entity_id: 'PGE_CA', source_event_id: 'u1' },
    })

    expect(result.summary.observations_generated).toBe(2)
    expect(result.summary.idempotent_collisions).toBe(1)
    expect(result.observations).toHaveLength(1)
  })

  it('isolates producer failures and continues unrelated producers', async () => {
    const result = await runIntelligenceProducers({
      dry_run: true,
      observed_at: '2025-01-10T00:00:00.000Z',
      jobs: [
        { producer_name: 'contractor_performance', input: { producer: 'utility_behavior', events: [] } as any },
        { producer_name: 'utility_behavior', input: { producer: 'utility_behavior', events: [{ id: 'u1', utility_id: 'PGE_CA', event_type: 'pto_delay', occurred_at: '2025-01-01T00:00:00Z', details: 'PTO delayed' }] } },
      ],
    })

    expect(result.summary.producer_failures).toHaveLength(1)
    expect(result.summary.producers_executed).toContain('utility_behavior')
    expect(result.summary.observations_generated).toBe(1)
  })

  it('normalizes deterministic execution context without uncontrolled observed_at', () => {
    const a = normalizeExecutionContext({ dry_run: true, window: { start: '2025-01-01T00:00:00Z', end: '2025-01-31T00:00:00Z' }, scope: { entity_type: 'project', entity_id: 'p1' } })
    const b = normalizeExecutionContext({ dry_run: true, window: { start: '2025-01-01T00:00:00Z', end: '2025-01-31T00:00:00Z' }, scope: { entity_type: 'project', entity_id: 'p1' } })
    expect(a.observed_at).toBe('2025-01-31T00:00:00Z')
    expect(a.run_id).toBe(b.run_id)
  })

  it('orchestration files do not create event ledgers or mutate canonical lifecycle/source-of-truth tables', () => {
    const files = ['lib/intelligence/runner.ts', 'lib/intelligence/registry.ts', 'lib/intelligence/replay.ts', 'lib/intelligence/executionContext.ts']
    const src = files.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')).join('\n')
    expect(src).not.toMatch(/CREATE TABLE|ALTER TABLE|network_events\s*\(|project_activity\s*\(|webhook_ingestion_log\s*\(/i)
    expect(src).not.toMatch(/UPDATE\s+projects|UPDATE\s+network_opportunities|UPDATE\s+contractor_profiles|UPDATE\s+utility_policies|project_status\s*=/i)
    expect(src).not.toMatch(/setInterval|setTimeout\(|cron\(|scheduleJob|app\/admin|projection_writer|updateProjection/i)
  })
})
