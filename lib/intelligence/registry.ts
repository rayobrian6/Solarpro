/**
 * Canonical intelligence producer registry.
 * Metadata and lookup only. Does not hardcode runner control flow into callers.
 */

import type { ObservationEntityType } from './observations'
import type { IntelligenceObservationDraft } from './observations'
import type { ProducerContext } from './producers'
import {
  produceAhjCorrectionObservations,
  produceContractorPerformanceObservations,
  produceFailureIntelligenceObservations,
  produceHomeownerEngagementObservations,
  produceOpportunityLifecycleObservations,
  produceUtilityBehaviorObservations,
  type AhjEventRow,
  type AssignmentOutcomeRow,
  type FailureEventRow,
  type HomeownerEngagementRow,
  type OpportunityLifecycleRow,
  type UtilityEventRow,
} from './producers'

export type ProducerName =
  | 'contractor_performance'
  | 'homeowner_engagement'
  | 'ahj_corrections'
  | 'utility_behavior'
  | 'opportunity_lifecycle'
  | 'inspection_failures'

export type ProducerInput =
  | { producer: 'contractor_performance'; contractor_id: string; assignments: AssignmentOutcomeRow[] }
  | { producer: 'homeowner_engagement'; entity: { client_id?: string | null; project_id?: string | null; opportunity_id?: string | null }; events: HomeownerEngagementRow[] }
  | { producer: 'ahj_corrections'; events: AhjEventRow[] }
  | { producer: 'utility_behavior'; events: UtilityEventRow[] }
  | { producer: 'opportunity_lifecycle'; opportunity: OpportunityLifecycleRow; assignments?: AssignmentOutcomeRow[] }
  | { producer: 'inspection_failures'; events: FailureEventRow[] }

export interface ProducerMetadata {
  name: ProducerName
  version: string
  description: string
  supported_entity_types: ObservationEntityType[]
  replay_capabilities: Array<'entity' | 'window' | 'source_event' | 'opportunity' | 'project'>
  dry_run_supported: true
  observation_only: true
}

export interface RegisteredProducer extends ProducerMetadata {
  run(input: ProducerInput, ctx: ProducerContext): IntelligenceObservationDraft[]
}

export const PRODUCER_REGISTRY: Record<ProducerName, RegisteredProducer> = {
  contractor_performance: {
    name: 'contractor_performance', version: 'v1', description: 'Derives contractor response, close, dispute/refund, and battery experience observations.', supported_entity_types: ['contractor'], replay_capabilities: ['entity', 'window'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'contractor_performance') throw new Error('Invalid input for contractor_performance')
      return produceContractorPerformanceObservations(input.contractor_id, input.assignments, ctx)
    },
  },
  homeowner_engagement: {
    name: 'homeowner_engagement', version: 'v1', description: 'Derives homeowner/client engagement observations from canonical engagement events.', supported_entity_types: ['client', 'project', 'opportunity'], replay_capabilities: ['entity', 'window', 'opportunity', 'project'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'homeowner_engagement') throw new Error('Invalid input for homeowner_engagement')
      return produceHomeownerEngagementObservations(input.entity, input.events, ctx)
    },
  },
  ahj_corrections: {
    name: 'ahj_corrections', version: 'v1', description: 'Derives AHJ correction/redline pattern observations.', supported_entity_types: ['ahj', 'project'], replay_capabilities: ['entity', 'window', 'source_event', 'project'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'ahj_corrections') throw new Error('Invalid input for ahj_corrections')
      return produceAhjCorrectionObservations(input.events, ctx)
    },
  },
  utility_behavior: {
    name: 'utility_behavior', version: 'v1', description: 'Derives utility PTO/export/interconnection behavior observations.', supported_entity_types: ['utility', 'project', 'opportunity'], replay_capabilities: ['entity', 'window', 'source_event', 'project', 'opportunity'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'utility_behavior') throw new Error('Invalid input for utility_behavior')
      return produceUtilityBehaviorObservations(input.events, ctx)
    },
  },
  opportunity_lifecycle: {
    name: 'opportunity_lifecycle', version: 'v1', description: 'Derives opportunity risk, claim heat, and conversion probability observations.', supported_entity_types: ['opportunity'], replay_capabilities: ['entity', 'window', 'source_event', 'opportunity'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'opportunity_lifecycle') throw new Error('Invalid input for opportunity_lifecycle')
      return produceOpportunityLifecycleObservations(input.opportunity, input.assignments ?? [], ctx)
    },
  },
  inspection_failures: {
    name: 'inspection_failures', version: 'v1', description: 'Derives inspection, permit, financing, utility rejection, and redesign failure observations.', supported_entity_types: ['project', 'opportunity', 'contractor', 'utility', 'ahj'], replay_capabilities: ['entity', 'window', 'source_event', 'project', 'opportunity'], dry_run_supported: true, observation_only: true,
    run(input, ctx) {
      if (input.producer !== 'inspection_failures') throw new Error('Invalid input for inspection_failures')
      return produceFailureIntelligenceObservations(input.events, ctx)
    },
  },
}

export function listProducers(): ProducerMetadata[] {
  return Object.values(PRODUCER_REGISTRY).map(({ run: _run, ...meta }) => meta)
}

export function getProducer(name: ProducerName): RegisteredProducer {
  const producer = PRODUCER_REGISTRY[name]
  if (!producer) throw new Error(`Unknown intelligence producer: ${name}`)
  return producer
}
