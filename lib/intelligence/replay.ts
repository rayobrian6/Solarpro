/**
 * Replay controls for intelligence orchestration.
 * Pure helpers only: no DB, no event-ledger creation, no lifecycle mutation.
 */

import type { ObservationEntityType } from './observations'
import type { ProducerWindow } from './producers'
import { deterministicHash } from './executionContext'

export interface ReplayScope {
  entity_type?: ObservationEntityType
  entity_id?: string
  producer_name?: string
  window?: ProducerWindow
  source_event_id?: string
  opportunity_id?: string
  project_id?: string
}

export function replayBoundaryKey(scope: ReplayScope): string {
  if (scope.source_event_id) return `event:${scope.source_event_id}`
  if (scope.window) return `window:${scope.window.start}:${scope.window.end}`
  if (scope.entity_type && scope.entity_id) return `entity:${scope.entity_type}:${scope.entity_id}`
  if (scope.opportunity_id) return `opportunity:${scope.opportunity_id}`
  if (scope.project_id) return `project:${scope.project_id}`
  return `scope:${deterministicHash(scope)}`
}

export function assertReplayScope(scope: ReplayScope): void {
  if (scope.window) {
    const start = new Date(scope.window.start).getTime()
    const end = new Date(scope.window.end).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('Invalid replay window timestamps')
    if (end < start) throw new Error('Replay window end must be >= start')
  }
}
