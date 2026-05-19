/**
 * lib/intelligence/bridges.ts
 *
 * Bridge existing event-like logs into intelligence observation drafts.
 *
 * This module does NOT replace existing logs. It reads/adapts rows from existing
 * logs and produces observation drafts that can be validated or written by an
 * ObservationWriter.
 */

import {
  adaptExistingLogEvent,
  type CanonicalEventSourceLog,
  type EventAdapterOptions,
} from './events'
import {
  observationsFromExistingEvent,
  type IntelligenceObservationDraft,
  type ObservationWriter,
} from './observations'

export interface BridgeExistingLogOptions extends EventAdapterOptions {
  /** If true, return no observations for unsupported source/event combinations. */
  skipUnsupported?: boolean
}

export function bridgeExistingLogRowToObservations(
  sourceLog: CanonicalEventSourceLog,
  row: Record<string, unknown>,
  opts: BridgeExistingLogOptions = {},
): IntelligenceObservationDraft[] {
  const event = adaptExistingLogEvent(sourceLog, row, opts)
  return observationsFromExistingEvent(event)
}

export async function writeObservationsForExistingLogRow(
  writer: ObservationWriter,
  sourceLog: CanonicalEventSourceLog,
  row: Record<string, unknown>,
  opts: BridgeExistingLogOptions = {},
): Promise<number> {
  const observations = bridgeExistingLogRowToObservations(sourceLog, row, opts)
  if (observations.length === 0) return 0
  const results = await writer.writeObservations(observations)
  return results.filter(r => r.status === 'inserted').length
}

export function bridgeExistingLogRowsToObservations(
  rows: Array<{ sourceLog: CanonicalEventSourceLog; row: Record<string, unknown> }>,
  opts: BridgeExistingLogOptions = {},
): IntelligenceObservationDraft[] {
  return rows.flatMap(({ sourceLog, row }) => bridgeExistingLogRowToObservations(sourceLog, row, opts))
}
