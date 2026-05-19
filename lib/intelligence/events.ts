/**
 * lib/intelligence/events.ts
 *
 * Canonical Intelligence Event Envelope adapters.
 *
 * IMPORTANT ARCHITECTURE RULES:
 * - This module does NOT create a new event source of truth.
 * - This module does NOT write to network_events, intake_events, project_activity,
 *   webhook_ingestion_log, or admin_activity_log.
 * - This module only adapts existing log rows into a typed envelope so downstream
 *   intelligence code can reason about events consistently.
 * - Existing logs remain authoritative for their domains.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Canonical event types
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_EVENT_SCHEMA_VERSION = 'canonical-event.v1' as const

export type CanonicalEventSchemaVersion = typeof CANONICAL_EVENT_SCHEMA_VERSION

export type CanonicalEventEntityType =
  | 'opportunity'
  | 'project'
  | 'contractor'
  | 'client'
  | 'utility'
  | 'ahj'
  | 'campaign'
  | 'assignment'
  | 'webhook'
  | 'admin'
  | 'system'

export type CanonicalEventActorType =
  | 'system'
  | 'admin'
  | 'contractor'
  | 'homeowner'
  | 'webhook'
  | 'cron'
  | 'unknown'

export type CanonicalEventSourceLog =
  | 'network_events'
  | 'intake_events'
  | 'webhook_ingestion_log'
  | 'project_activity'
  | 'admin_activity_log'

export interface CanonicalEventEnvelope<Payload extends Record<string, unknown> = Record<string, unknown>> {
  event_id: string
  event_type: string
  event_category: string
  entity_type: CanonicalEventEntityType
  entity_id: string | null
  actor_type: CanonicalEventActorType
  actor_id: string | null
  source_log: CanonicalEventSourceLog
  source_system: string
  occurred_at: string
  correlation_id: string | null
  causation_id: string | null
  idempotency_key: string | null
  from_state: string | null
  to_state: string | null
  payload: Payload
  schema_version: CanonicalEventSchemaVersion
  original: Record<string, unknown>
}

export interface EventAdapterOptions {
  /** Optional correlation ID supplied by caller when adapting a batch/replay. */
  correlation_id?: string | null
  /** Optional causation ID supplied by caller when adapting from another event. */
  causation_id?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback
}

function isoTimestamp(value: unknown): string {
  const raw = stringOrNull(value)
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function inferActorType(raw: unknown): CanonicalEventActorType {
  const s = stringOrNull(raw)?.toLowerCase()
  if (s === 'system' || s === 'admin' || s === 'contractor' || s === 'homeowner' || s === 'webhook' || s === 'cron') return s
  return 'unknown'
}

function inferNetworkEntity(row: Record<string, unknown>): { entity_type: CanonicalEventEntityType; entity_id: string | null } {
  const opportunityId = stringOrNull(row.opportunity_id)
  if (opportunityId) return { entity_type: 'opportunity', entity_id: opportunityId }

  const assignmentId = stringOrNull(row.assignment_id)
  if (assignmentId) return { entity_type: 'assignment', entity_id: assignmentId }

  const contractorId = stringOrNull(row.contractor_id)
  if (contractorId) return { entity_type: 'contractor', entity_id: contractorId }

  const adminId = stringOrNull(row.admin_user_id)
  if (adminId) return { entity_type: 'admin', entity_id: adminId }

  return { entity_type: 'system', entity_id: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapters for existing logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adapt a row from network_events into the canonical envelope.
 * network_events remains the authoritative marketplace/opportunity event log.
 */
export function adaptNetworkEvent(
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  const entity = inferNetworkEntity(row)
  const data = asRecord(row.data)

  return {
    event_id: stringOr(row.event_id, stringOr(row.id, `network_events:${Date.now()}`)),
    event_type: stringOr(row.event_type, 'network.unknown'),
    event_category: stringOr(row.event_category, 'network'),
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    actor_type: inferActorType(row.triggered_by),
    actor_id: stringOrNull(row.admin_user_id) ?? stringOrNull(row.contractor_id),
    source_log: 'network_events',
    source_system: 'network_events',
    occurred_at: isoTimestamp(row.occurred_at ?? row.created_at),
    correlation_id: opts.correlation_id ?? stringOrNull(data.correlation_id),
    causation_id: opts.causation_id ?? stringOrNull(data.causation_id),
    idempotency_key: stringOrNull(data.idempotency_key),
    from_state: stringOrNull(row.from_status),
    to_state: stringOrNull(row.to_status),
    payload: data,
    schema_version: CANONICAL_EVENT_SCHEMA_VERSION,
    original: row,
  }
}

/**
 * Adapt a row from intake_events into the canonical envelope.
 * intake_events remains the authoritative intake pipeline event log.
 */
export function adaptIntakeEvent(
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  const payload = {
    payload: asRecord(row.payload),
    validation_result: asRecord(row.validation_result),
    duplicate_result: asRecord(row.duplicate_result),
    pipeline_result: asRecord(row.pipeline_result),
    action: stringOrNull(row.action),
    error_code: stringOrNull(row.error_code),
    error_message: stringOrNull(row.error_message),
    source_system: stringOrNull(row.source_system),
    source_channel: stringOrNull(row.source_channel),
    funnel_id: stringOrNull(row.funnel_id),
    campaign_id: stringOrNull(row.campaign_id),
  }

  return {
    event_id: stringOr(row.event_id, stringOr(row.id, `intake_events:${Date.now()}`)),
    event_type: stringOr(row.event_type, 'intake.unknown'),
    event_category: 'intake',
    entity_type: 'opportunity',
    entity_id: stringOrNull(row.opportunity_id),
    actor_type: 'webhook',
    actor_id: null,
    source_log: 'intake_events',
    source_system: stringOr(row.source_system, 'intake_pipeline'),
    occurred_at: isoTimestamp(row.occurred_at ?? row.created_at),
    correlation_id: opts.correlation_id ?? stringOrNull(row.event_id),
    causation_id: opts.causation_id ?? stringOrNull(row.original_event_id),
    idempotency_key: stringOrNull(row.idempotency_key),
    from_state: null,
    to_state: stringOrNull(row.action),
    payload,
    schema_version: CANONICAL_EVENT_SCHEMA_VERSION,
    original: row,
  }
}

/**
 * Adapt webhook_ingestion_log rows. The canonical entity is webhook unless the
 * row already links to an opportunity.
 */
export function adaptWebhookIngestionEvent(
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  const opportunityId = stringOrNull(row.opportunity_id)

  return {
    event_id: stringOr(row.event_id, stringOr(row.id, `webhook_ingestion_log:${Date.now()}`)),
    event_type: `webhook.${stringOr(row.status, 'received')}`,
    event_category: 'webhook',
    entity_type: opportunityId ? 'opportunity' : 'webhook',
    entity_id: opportunityId ?? stringOrNull(row.id),
    actor_type: 'webhook',
    actor_id: null,
    source_log: 'webhook_ingestion_log',
    source_system: stringOr(row.platform, 'webhook'),
    occurred_at: isoTimestamp(row.received_at ?? row.created_at),
    correlation_id: opts.correlation_id ?? stringOrNull(row.idempotency_key),
    causation_id: opts.causation_id ?? stringOrNull(row.original_log_id),
    idempotency_key: stringOrNull(row.idempotency_key),
    from_state: null,
    to_state: stringOrNull(row.status),
    payload: {
      platform: stringOrNull(row.platform),
      status: stringOrNull(row.status),
      signature_verified: row.signature_verified === true,
      payload: asRecord(row.payload),
      headers: asRecord(row.headers),
      error_code: stringOrNull(row.error_code),
      error_message: stringOrNull(row.error_message),
      is_replay: row.is_replay === true,
    },
    schema_version: CANONICAL_EVENT_SCHEMA_VERSION,
    original: row,
  }
}

/**
 * Adapt project_activity rows. project_activity remains authoritative for
 * project activity; the envelope only standardizes downstream consumption.
 */
export function adaptProjectActivity(
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  const metadata = asRecord(row.metadata)

  return {
    event_id: stringOr(row.id, `project_activity:${Date.now()}`),
    event_type: `project.${stringOr(row.type, 'activity')}`,
    event_category: 'project',
    entity_type: 'project',
    entity_id: stringOrNull(row.project_id),
    actor_type: stringOrNull(row.user_id) ? 'contractor' : 'system',
    actor_id: stringOrNull(row.user_id),
    source_log: 'project_activity',
    source_system: 'project_activity',
    occurred_at: isoTimestamp(row.created_at ?? row.occurred_at),
    correlation_id: opts.correlation_id ?? stringOrNull(metadata.correlation_id),
    causation_id: opts.causation_id ?? stringOrNull(metadata.causation_id),
    idempotency_key: stringOrNull(metadata.idempotency_key),
    from_state: stringOrNull(metadata.from),
    to_state: stringOrNull(metadata.to),
    payload: {
      title: stringOrNull(row.title),
      description: stringOrNull(row.description),
      metadata,
    },
    schema_version: CANONICAL_EVENT_SCHEMA_VERSION,
    original: row,
  }
}

/**
 * Adapt admin_activity_log rows where relevant. Existing admin log remains
 * authoritative for admin auditing.
 */
export function adaptAdminActivity(
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  const metadata = asRecord(row.metadata)

  return {
    event_id: stringOr(row.id, `admin_activity_log:${Date.now()}`),
    event_type: `admin.${stringOr(row.action, 'activity')}`,
    event_category: 'admin',
    entity_type: 'admin',
    entity_id: stringOrNull(row.admin_id) ?? stringOrNull(row.user_id),
    actor_type: 'admin',
    actor_id: stringOrNull(row.admin_id) ?? stringOrNull(row.user_id),
    source_log: 'admin_activity_log',
    source_system: 'admin_activity_log',
    occurred_at: isoTimestamp(row.created_at ?? row.occurred_at),
    correlation_id: opts.correlation_id ?? stringOrNull(metadata.correlation_id),
    causation_id: opts.causation_id ?? stringOrNull(metadata.causation_id),
    idempotency_key: stringOrNull(metadata.idempotency_key),
    from_state: stringOrNull(metadata.from_status),
    to_state: stringOrNull(metadata.to_status),
    payload: metadata,
    schema_version: CANONICAL_EVENT_SCHEMA_VERSION,
    original: row,
  }
}

/**
 * Route adapter helper when the caller only knows the source log name.
 */
export function adaptExistingLogEvent(
  sourceLog: CanonicalEventSourceLog,
  row: Record<string, unknown>,
  opts: EventAdapterOptions = {},
): CanonicalEventEnvelope {
  switch (sourceLog) {
    case 'network_events': return adaptNetworkEvent(row, opts)
    case 'intake_events': return adaptIntakeEvent(row, opts)
    case 'webhook_ingestion_log': return adaptWebhookIngestionEvent(row, opts)
    case 'project_activity': return adaptProjectActivity(row, opts)
    case 'admin_activity_log': return adaptAdminActivity(row, opts)
    default: {
      const neverSource: never = sourceLog
      throw new Error(`Unsupported source log: ${neverSource}`)
    }
  }
}
