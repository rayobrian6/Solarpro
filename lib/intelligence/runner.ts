/**
 * Intelligence producer orchestration foundation.
 * Execution infrastructure only: no dashboards, no schedulers, no source-of-truth mutation.
 */

import {
  assertValidObservationDraft,
  validateObservationDraft,
  type IntelligenceObservation,
  type IntelligenceObservationDraft,
  type ObservationWriter,
} from './observations'
import { getProducer, type ProducerInput, type ProducerName } from './registry'
import { normalizeExecutionContext, toProducerContext, type IntelligenceExecutionContext, type NormalizeExecutionContextInput } from './executionContext'
import { assertReplayScope, replayBoundaryKey, type ReplayScope } from './replay'

export interface ProducerRunJob {
  producer_name: ProducerName
  input: ProducerInput
}

export interface ProducerExecutionFailure {
  producer_name: ProducerName
  message: string
}

export interface ObservationValidationFailure {
  producer_name: ProducerName
  idempotency_key: string | null
  errors: string[]
}

export interface IntelligenceRunSummary {
  run_id: string
  dry_run: boolean
  started_at: string
  finished_at: string
  duration_ms: number
  replay_boundary: string
  producers_requested: ProducerName[]
  producers_executed: ProducerName[]
  entities_processed: Array<{ entity_type: string; entity_id: string }>
  observations_generated: number
  observations_validated: number
  observations_written: number
  observations_skipped: number
  idempotent_collisions: number
  validation_failures: ObservationValidationFailure[]
  producer_failures: ProducerExecutionFailure[]
  write_failures: string[]
}

export interface IntelligenceRunResult {
  context: IntelligenceExecutionContext
  summary: IntelligenceRunSummary
  observations: IntelligenceObservationDraft[]
  written: IntelligenceObservation[]
}

export interface RunIntelligenceProducersOptions extends NormalizeExecutionContextInput {
  jobs: ProducerRunJob[]
  writer?: ObservationWriter
  replay_scope?: ReplayScope
}

function monotonicStartedAt(ctx: IntelligenceExecutionContext): string {
  return ctx.observed_at
}

function finishTimestamp(ctx: IntelligenceExecutionContext): string {
  return ctx.observed_at
}

function uniqueEntityList(observations: IntelligenceObservationDraft[]): Array<{ entity_type: string; entity_id: string }> {
  const m = new Map<string, { entity_type: string; entity_id: string }>()
  for (const o of observations) m.set(`${o.entity_type}:${o.entity_id}`, { entity_type: o.entity_type, entity_id: o.entity_id })
  return [...m.values()]
}

function dedupeByIdempotency(observations: IntelligenceObservationDraft[]): { unique: IntelligenceObservationDraft[]; collisions: number } {
  const seen = new Set<string>()
  const unique: IntelligenceObservationDraft[] = []
  let collisions = 0

  for (const obs of observations) {
    const key = obs.idempotency_key ?? `${obs.entity_type}:${obs.entity_id}:${obs.observation_type}:${obs.observed_at}`
    if (seen.has(key)) {
      collisions++
      continue
    }
    seen.add(key)
    unique.push(obs)
  }

  return { unique, collisions }
}

export async function runIntelligenceProducers(options: RunIntelligenceProducersOptions): Promise<IntelligenceRunResult> {
  const context = normalizeExecutionContext(options)
  const replayScope = options.replay_scope ?? { ...options.scope, window: options.window, source_event_id: options.source_event_id ?? undefined }
  assertReplayScope(replayScope)
  const replayBoundary = replayBoundaryKey(replayScope)

  const startedAt = monotonicStartedAt(context)
  const startedMs = Date.now()
  const producerFailures: ProducerExecutionFailure[] = []
  const validationFailures: ObservationValidationFailure[] = []
  const writeFailures: string[] = []
  const producersExecuted: ProducerName[] = []
  const generated: IntelligenceObservationDraft[] = []

  for (const job of options.jobs) {
    try {
      const producer = getProducer(job.producer_name)
      const drafts = producer.run(job.input, toProducerContext(context))
      producersExecuted.push(job.producer_name)
      generated.push(...drafts)
    } catch (err: unknown) {
      producerFailures.push({ producer_name: job.producer_name, message: (err as Error).message })
    }
  }

  const valid: IntelligenceObservationDraft[] = []
  for (const obs of generated) {
    const validation = validateObservationDraft(obs)
    if (!validation.valid) {
      validationFailures.push({ producer_name: options.jobs.find(j => j.producer_name === obs.source_system.replace('_producer', '') as ProducerName)?.producer_name ?? 'opportunity_lifecycle', idempotency_key: obs.idempotency_key ?? null, errors: validation.errors })
      continue
    }
    valid.push(obs)
  }

  const { unique, collisions } = dedupeByIdempotency(valid)
  const written: IntelligenceObservation[] = []

  if (!context.dry_run) {
    if (!options.writer) throw new Error('Observation writer is required when dry_run=false')
    for (const obs of unique) {
      try {
        assertValidObservationDraft(obs)
        written.push(await options.writer.writeObservation(obs))
      } catch (err: unknown) {
        writeFailures.push((err as Error).message)
      }
    }
  }

  const durationMs = Math.max(0, Date.now() - startedMs)
  const summary: IntelligenceRunSummary = {
    run_id: context.run_id,
    dry_run: context.dry_run,
    started_at: startedAt,
    finished_at: finishTimestamp(context),
    duration_ms: durationMs,
    replay_boundary: replayBoundary,
    producers_requested: options.jobs.map(j => j.producer_name),
    producers_executed: producersExecuted,
    entities_processed: uniqueEntityList(unique),
    observations_generated: generated.length,
    observations_validated: valid.length,
    observations_written: written.length,
    observations_skipped: context.dry_run ? unique.length + collisions : collisions,
    idempotent_collisions: collisions,
    validation_failures: validationFailures,
    producer_failures: producerFailures,
    write_failures: writeFailures,
  }

  return { context, summary, observations: unique, written }
}
