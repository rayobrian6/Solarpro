// ============================================================================
// v47.435 Stage 9.2 — Survey Ingest Pipeline: Core Types
//
// These types define the internal contract for the ingest pipeline.
// They are NOT part of the external wire contract (that lives in
// lib/survey/types.ts). These are SolarPro-internal domain types.
//
// Design principles:
//   - No field assumptions about the full survey payload (Q3 pending).
//   - Project-linkage strategy is an abstraction (Q8 pending).
//   - Every ingest attempt produces a structured IngestResult — callers
//     never need to catch exceptions from runIngestPipeline().
//   - All DB writes go through the pipeline; the route only reads the result.
// ============================================================================

import type { SurveyCompletedEvent } from '@/lib/survey/types';

// ---------------------------------------------------------------------------
// IngestStatus — terminal states produced by runIngestPipeline().
//
// Mirrors the WebhookDeliveryStatus subset that the pipeline can produce:
//   'ingested' — full pipeline succeeded; project created/updated.
//   'failed'   — pipeline encountered an unrecoverable error.
//
// Note: 'verified', 'duplicate', 'received', 'replayed' are set upstream
// (in the route handler before runIngestPipeline is called). The pipeline
// only ever produces 'ingested' | 'failed'.
// ---------------------------------------------------------------------------
export type IngestStatus = 'ingested' | 'failed';

// ---------------------------------------------------------------------------
// IngestContext — everything the pipeline needs to run.
//
// The route handler builds this after HMAC verification and delivery INSERT,
// then passes it into runIngestPipeline(). The pipeline does not touch
// NextRequest or the DB delivery row — it receives a clean context object.
// ---------------------------------------------------------------------------
export interface IngestContext {
  /** The verified, parsed thin-event envelope. */
  event: SurveyCompletedEvent;

  /** The webhook_deliveries row ID that was just inserted (status='verified').
   *  Pipeline will UPDATE this row's status + processed_at + error_message. */
  deliveryId: string;

  /** The user ID that should OWN survey-origin projects.
   *  Source: resolved by F-06 owner resolver from solarpro_user_id claim;
   *  falls back to SURVEY_INGEST_DEFAULT_USER_ID if claim is absent or invalid.
   *  Required. Pipeline returns 'failed' if this is missing. */
  ownerId: string;

  /** F-06: Source of the ownerId.
   *  'claim'       - resolved from solarpro_user_id UUID match
   *  'claim_email' - resolved from solarpro_email match
   *  'project'     - resolved from solarpro_project_id project lookup
   *  'default'     - fell back to SURVEY_INGEST_DEFAULT_USER_ID */
  ownerSource: 'claim' | 'claim_email' | 'project' | 'default';

  /** Optional: the partner-supplied project_id from the webhook headers or
   *  a future fat-event field. Used by the link resolver (Q8 strategy).
   *  Null when the thin event carries no project reference. */
  partnerProjectId: string | null;

  /** ISO-8601 timestamp when the route received the request.
   *  Used to set processed_at on the delivery row. */
  receivedAt: string;

  /** Tracing correlation ID — equals deliveryId for v47.435.
   *  Surfaced in all log lines for cross-system trace linking. */
  traceId: string;
}

// ---------------------------------------------------------------------------
// IngestResult — returned by runIngestPipeline() in all cases (never throws).
// ---------------------------------------------------------------------------
export type IngestResult =
  | IngestResultSuccess
  | IngestResultFailure;

export interface IngestResultSuccess {
  status: 'ingested';
  /** The SolarPro project ID that was created or updated. */
  projectId: string;
  /** Whether a new project was created (true) or an existing one updated (false). */
  created: boolean;
  /** Summary of what the transform layer produced (for logging). */
  transformSummary: TransformSummary;
  /** Milliseconds elapsed inside runIngestPipeline(). */
  durationMs: number;
}

export interface IngestResultFailure {
  status: 'failed';
  /** Human-readable error message. Stored in webhook_deliveries.error_message. */
  error: string;
  /** Error code for programmatic handling. */
  code: IngestErrorCode;
  /** Milliseconds elapsed before failure. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// IngestErrorCode — closed enum of pipeline error categories.
//
// These codes are stored in webhook_deliveries.error_message as a prefix
// (e.g. "MISSING_OWNER_ID: SURVEY_INGEST_DEFAULT_USER_ID not set") so ops
// can filter the admin log by error category.
// ---------------------------------------------------------------------------
export type IngestErrorCode =
  | 'MISSING_OWNER_ID'        // SURVEY_INGEST_DEFAULT_USER_ID env var not set
  | 'LINK_RESOLUTION_FAILED'  // projectLinkResolver could not determine a project target
  | 'TRANSFORM_FAILED'        // transformLayer.transform() threw
  | 'DB_WRITE_FAILED'         // project upsert or file insert failed
  | 'DELIVERY_UPDATE_FAILED'  // could not mark delivery as ingested/failed in DB
  | 'UNKNOWN';                // catch-all for unexpected errors

// ---------------------------------------------------------------------------
// SurveyProjectLinkStrategy — Q8 abstraction.
//
// Q8: "What should we do when the thin event carries no project_id?"
// We know three plausible answers from the scoping doc:
//   ATTACH_TO_EXISTING — look up an existing project by survey_external_id
//   CREATE_ORPHAN      — create a new unlinked project, mark origin='survey'
//   TRIAGE_QUEUE       — defer: create a triage record for ops to resolve
//
// The strategy is read from SURVEY_PROJECT_LINK_STRATEGY env var (default:
// CREATE_ORPHAN until Q8 is answered). The projectLinkResolver selects the
// correct strategy at runtime. No hard-coded logic in the pipeline.
// ---------------------------------------------------------------------------
export type SurveyProjectLinkStrategy =
  | 'ATTACH_TO_EXISTING'
  | 'CREATE_ORPHAN'
  | 'TRIAGE_QUEUE';

export const SURVEY_PROJECT_LINK_STRATEGIES: readonly SurveyProjectLinkStrategy[] = [
  'ATTACH_TO_EXISTING',
  'CREATE_ORPHAN',
  'TRIAGE_QUEUE',
] as const;

export const DEFAULT_SURVEY_PROJECT_LINK_STRATEGY: SurveyProjectLinkStrategy = 'CREATE_ORPHAN';

// ---------------------------------------------------------------------------
// LinkResolution — output of projectLinkResolver.resolveProjectLink().
// ---------------------------------------------------------------------------
export type LinkResolution =
  | LinkResolutionAttach
  | LinkResolutionCreate
  | LinkResolutionTriage
  | LinkResolutionError;

export interface LinkResolutionAttach {
  action: 'attach';
  /** Existing SolarPro project ID to attach this survey to. */
  projectId: string;
}

export interface LinkResolutionCreate {
  action: 'create';
  /** survey_external_id to use as the idempotency key on INSERT. */
  surveyExternalId: string;
  /** The strategy that decided to create (for logging). */
  strategy: 'CREATE_ORPHAN';
}

export interface LinkResolutionTriage {
  action: 'triage';
  /** survey_external_id to store on a triage record. */
  surveyExternalId: string;
  /** Reason ops needs to resolve this manually. */
  reason: string;
}

export interface LinkResolutionError {
  action: 'error';
  /** Why link resolution failed. */
  error: string;
}

// ---------------------------------------------------------------------------
// SurveyRawPayload — the untyped full survey payload.
//
// In v47.435 the ingest pipeline does NOT know the final shape of the full
// payload (Q3 pending). The transform layer receives this opaque record
// and is expected to extract fields defensively.
//
// When Q3 is answered, create a typed SurveyFullPayload interface and
// replace SurveyRawPayload with it. The transform layer is the only place
// that touches the field names, so the change is isolated.
// ---------------------------------------------------------------------------
export type SurveyRawPayload = Record<string, unknown>;

// ---------------------------------------------------------------------------
// TransformInput — what the transform layer receives.
// ---------------------------------------------------------------------------
export interface TransformInput {
  /** The verified thin-event envelope. */
  event: SurveyCompletedEvent;
  /** The full survey payload fetched from the survey backend (null in v47.435
   *  stub — fetch client is blocked on Q2). */
  rawPayload: SurveyRawPayload | null;
  /** The link resolution that determined where to write. */
  linkResolution: LinkResolution;
  /** Ingest context (for ownerId, traceId, etc.). */
  context: IngestContext;
}

// ---------------------------------------------------------------------------
// PhysicalDataOutput — structured physical + electrical field data
// extracted from SurveyV2Payload, written to project_physical_data table.
//
// Every field maps directly to a column in project_physical_data.
// Engineering reads this table instead of using hardcoded defaults.
// ---------------------------------------------------------------------------
export interface PhysicalDataOutput {
  // Structure / Roof
  roof_material:           string | null;
  roof_pitch:              string | null;
  rafter_spacing_in:       number | null;
  roof_condition:          string | null;
  roof_age_years:          number | null;
  attic_access:            boolean | null;

  // Electrical
  panel_brand:             string | null;
  panel_rating_amps:       number | null;
  available_breaker_slots: string | null;
  meter_socket_type:       string | null;
  interconnection_point:   string | null;
  service_entrance_type:   string | null;
  has_sub_panel:           boolean | null;
  sub_panel_rating_amps:   number | null;

  // Constraints
  obstructions:            unknown[];
  usable_roof_pct:         number | null;

  // Survey metadata
  inspector_name:          string | null;
  surveyed_at:             string | null;
  access_notes:            string | null;
  mounting_notes:          string | null;
  electrical_notes:        string | null;

  // Site overview
  structure_type:          string | null;
  stories:                 string | null;
}

// ---------------------------------------------------------------------------
// TransformOutput — what the transform layer produces.
// ---------------------------------------------------------------------------
export interface TransformOutput {
  /** Project name derived from siteOverview.projectName. */
  projectName: string;
  /** Site address from siteOverview.siteAddress. */
  address: string | null;
  /** Latitude from siteOverview. */
  lat: number | null;
  /** Longitude from siteOverview. */
  lng: number | null;
  /** Audit/provenance metadata stored in projects.survey_meta JSONB. */
  surveyMeta: Record<string, unknown>;
  /** Photo files to insert into project_files. */
  files: TransformFile[];
  /**
   * Structured physical + electrical data written to project_physical_data.
   * NULL when payload is unavailable (degraded mode).
   */
  physicalData: PhysicalDataOutput | null;
}

export interface TransformFile {
  /** Stable external ID for idempotent file upsert. */
  externalId: string;
  /** File name. */
  name: string;
  /** URL to fetch the file from. TODO(Q3): confirm photo URL scheme (Q3). */
  url: string;
  /** MIME type guess. */
  mimeType: string;
}

// ---------------------------------------------------------------------------
// TransformSummary — logged to IngestResultSuccess and delivery row.
// ---------------------------------------------------------------------------
export interface TransformSummary {
  projectName: string;
  hasAddress: boolean;
  fileCount: number;
  hasSurveyMeta: boolean;
  /** Whether physical data (project_physical_data) was populated. */
  hasPhysicalData: boolean;
  /** Panel rating in amps if captured — null otherwise. */
  panelRatingAmps: number | null;
  /** Roof material if captured — null otherwise. */
  roofMaterial: string | null;
  /** Rafter spacing in inches if captured — null otherwise. */
  rafterSpacingIn: number | null;
}