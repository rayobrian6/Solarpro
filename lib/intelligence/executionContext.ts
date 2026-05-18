/**
 * Deterministic execution context for intelligence producer orchestration.
 * No lifecycle authority, no DB access, no wall-clock dependency required.
 */

import type { ObservationEntityType } from './observations'
import type { ProducerContext, ProducerWindow } from './producers'

export const DEFAULT_DETERMINISTIC_OBSERVED_AT = '1970-01-01T00:00:00.000Z'

export interface IntelligenceExecutionScope {
  entity_type?: ObservationEntityType
  entity_id?: string
  producer_name?: string
  source_event_id?: string
  opportunity_id?: string
  project_id?: string
}

export interface IntelligenceExecutionContext extends ProducerContext {
  dry_run: boolean
  run_id: string
  observed_at: string
  window?: ProducerWindow
  scope?: IntelligenceExecutionScope
  execution_metadata: Record<string, unknown>
}

export interface NormalizeExecutionContextInput {
  dry_run?: boolean
  observed_at?: string
  window?: ProducerWindow
  scope?: IntelligenceExecutionScope
  source_event_id?: string | null
  correlation_id?: string | null
  execution_metadata?: Record<string, unknown>
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function deterministicHash(value: unknown): string {
  const str = stableStringify(value)
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function normalizeExecutionContext(input: NormalizeExecutionContextInput = {}): IntelligenceExecutionContext {
  const observed_at = input.observed_at
    ?? input.window?.end
    ?? DEFAULT_DETERMINISTIC_OBSERVED_AT

  const seed = {
    observed_at,
    window: input.window ?? null,
    scope: input.scope ?? null,
    source_event_id: input.source_event_id ?? null,
    correlation_id: input.correlation_id ?? null,
  }

  return {
    dry_run: input.dry_run ?? true,
    run_id: `intel-run-${deterministicHash(seed)}`,
    observed_at,
    window: input.window,
    scope: input.scope,
    source_event_id: input.source_event_id ?? null,
    correlation_id: input.correlation_id ?? null,
    execution_metadata: input.execution_metadata ?? {},
  }
}

export function toProducerContext(ctx: IntelligenceExecutionContext): ProducerContext {
  return {
    observed_at: ctx.observed_at,
    window: ctx.window,
    correlation_id: ctx.correlation_id,
    source_event_id: ctx.source_event_id,
  }
}
