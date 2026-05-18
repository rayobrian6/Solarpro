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
  entity_type: string | null
  entity_id: string | null
  observation_type: string | null
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

interface GeneratedObservation {
  producer_name: ProducerName
  observation: IntelligenceObservationDraft
}

function monotonicStartedAt(ctx: IntelligenceExecutionContext): string { return ctx.observed_at }
function finishTimestamp(ctx: IntelligenceExecutionContext): string { return ctx.observed_at }

function uniqueEntityList(observations: IntelligenceObservationDraft[]): Array<{ entity_type: string; entity_id: string }> {
  const m = new Map<string, { entity_type: string; entity_id: string }>()
  for (const o of observations) m.set(`${o.entity_type}:${o.entity_id}`, { entity_type: o.entity_type, entity_id: o.entity_id })
  return [...m.values()]
}

function validationFailure(producerName: ProducerName, obs: Partial<IntelligenceObservationDraft>, errors: string[]): ObservationValidationFailure {
  return {
    producer_name: producerName,
    entity_type: typeof obs.entity_type === 'string' ? obs.entity_type : null,
    entity_id: typeof obs.entity_id === 'string' ? obs.entity_id : null,
    observation_type: typeof obs.observation_type === 'string' ? obs.observation_type : null,
    idempotency_key: obs.idempotency_key ?? null,
    errors,
  }
}

function dedupeByIdempotency(items: GeneratedObservation[]): { unique: GeneratedObservation[]; collisions: number } {
  const seen = new Set<string>()
  const unique: GeneratedObservation[] = []
  let collisions = 0

  for (const item of items) {
    const key = item.observation.idempotency_key
    // Missing keys are rejected before dedupe; keep this guard defensive.
    if (!key) {
      collisions++
      continue
    }
    if (seen.has(key)) {
      collisions++
      continue
    }
    seen.add(key)
    unique.push(item)
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
  const generated: GeneratedObservation[] = []

  for (const job of options.jobs) {
    try {
      const producer = getProducer(job.producer_name)
      const drafts = producer.run(job.input, toProducerContext(context))
      producersExecuted.push(job.producer_name)
      generated.push(...drafts.map(observation => ({ producer_name: job.producer_name, observation })))
    } catch (err: unknown) {
      producerFailures.push({ producer_name: job.producer_name, message: (err as Error).message })
    }
  }

  const validItems: GeneratedObservation[] = []
  for (const item of generated) {
    const { producer_name, observation } = item
    const producer = getProducer(producer_name)
    const validation = validateObservationDraft(observation)
    const errors = [...validation.errors]

    if (!observation.idempotency_key) errors.push('idempotency_key is required for orchestration writes')
    if (!producer.supported_entity_types.includes(observation.entity_type)) {
      errors.push(`entity_type ${observation.entity_type} is not supported by producer ${producer_name}`)
    }

    if (errors.length > 0) {
      validationFailures.push(validationFailure(producer_name, observation, errors))
      continue
    }
    validItems.push(item)
  }

  const { unique, collisions: inRunCollisions } = dedupeByIdempotency(validItems)
  const written: IntelligenceObservation[] = []
  let dbCollisions = 0
  let skipped = inRunCollisions + validationFailures.length

  if (!context.dry_run) {
    if (!options.writer) {
      writeFailures.push('writer_required_for_non_dry_run')
      skipped += unique.length
    } else {
      for (const item of unique) {
        const obs = item.observation
        try {
          assertValidObservationDraft(obs)
          const result = await options.writer.writeObservation(obs)
          if (result.status === 'inserted' && result.observation) {
            written.push(result.observation)
          } else if (result.status === 'skipped_existing') {
            dbCollisions++
            skipped++
          } else {
            writeFailures.push(result.error ?? 'observation_write_failed')
            skipped++
          }
        } catch (err: unknown) {
          writeFailures.push((err as Error).message)
          skipped++
        }
      }
    }
  } else {
    skipped += unique.length
  }

  const durationMs = Math.max(0, Date.now() - startedMs)
  const uniqueObservations = unique.map(i => i.observation)
  const summary: IntelligenceRunSummary = {
    run_id: context.run_id,
    dry_run: context.dry_run,
    started_at: startedAt,
    finished_at: finishTimestamp(context),
    duration_ms: durationMs,
    replay_boundary: replayBoundary,
    producers_requested: options.jobs.map(j => j.producer_name),
    producers_executed: producersExecuted,
    entities_processed: uniqueEntityList(uniqueObservations),
    observations_generated: generated.length,
    observations_validated: validItems.length,
    observations_written: written.length,
    observations_skipped: skipped,
    idempotent_collisions: inRunCollisions + dbCollisions,
    validation_failures: validationFailures,
    producer_failures: producerFailures,
    write_failures: writeFailures,
  }

  return { context, summary, observations: uniqueObservations, written }
}
