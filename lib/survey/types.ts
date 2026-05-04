// ============================================================================
// v47.434 Stage 9.1 — Survey Ingest Type Contract (v1.0 FROZEN)
//
// This file defines the wire-level contract between the in-house survey tool
// and SolarPro. Once v47.434 ships, these types are a public contract:
// breaking changes require a schema version bump (v1.0 -> v1.1 or v2.0) and
// parallel-run support on both sides.
//
// ARCHITECTURE (per partner doc + user approval):
//
//   Survey tool POSTs a THIN EVENT webhook on survey.completed:
//     → headers: X-Survey-Signature, X-Survey-Timestamp, X-Survey-Event-Id
//     → body:    { event, event_id, survey_id, completed_at, survey_url? }
//
//   SolarPro verifies HMAC-SHA256 signature, records delivery, and (in v47.435+)
//   GETs the full payload from survey_url or `${SURVEY_BACKEND_URL}/api/surveys/{survey_id}`,
//   transforms it, and writes to projects/layouts/project_files.
//
// v47.434 SCOPE: types + HMAC verify + 501 stub + admin log. No GET client, no
//                transform layer. Those ship in v47.435+.
// ============================================================================

// ---------------------------------------------------------------------------
// Schema version — FROZEN for v1 contract.
// Bumping this requires: (1) new types SchemaVersion = '1.0' | '1.1', (2) parallel
// handler branches, (3) survey team coordinated release.
//
// v47.434a WIRE NOTE: the partner's actual producer does NOT echo schemaVersion
// in the webhook body. The validator accepts an absent schemaVersion and treats
// it as CURRENT_SCHEMA_VERSION. If a future producer sends a non-matching
// schemaVersion explicitly, the validator still rejects it — the forward-compat
// signal is preserved.
// ---------------------------------------------------------------------------
export type SchemaVersion = '1.0' | '2.0';
export const CURRENT_SCHEMA_VERSION: SchemaVersion = '1.0';
export const SURVEY_V2_SCHEMA_VERSION: SchemaVersion = '2.0';

// ---------------------------------------------------------------------------
// Supported inbound event types. CLOSED enum.
// Adding an event type is a contract change — must also extend the verifier
// and the webhook_deliveries.event_type documentation.
// ---------------------------------------------------------------------------
export type SurveyEventType = 'survey.completed';
export const SUPPORTED_SURVEY_EVENT_TYPES: readonly SurveyEventType[] = ['survey.completed'] as const;

// ---------------------------------------------------------------------------
// Thin-event webhook body.
//
// Per partner doc (and v47.434 approved scope), survey backend posts a THIN
// envelope and SolarPro fetches the full payload separately in v47.435. This
// keeps retries cheap (small body) and decouples delivery from data transfer.
//
// If the survey team later confirms a FAT-event shape, we extend this with a
// discriminated union on `schemaVersion` + event_type. No existing producers
// break because v1.0 remains valid forever.
// ---------------------------------------------------------------------------
export interface SurveyCompletedEvent {
  /** Literal discriminator. Must equal 'survey.completed' for v1. */
  event: SurveyEventType;
  /** Frozen contract version. Must equal '1.0' for v1. */
  schemaVersion: SchemaVersion;
  /** Stable idempotency key. Duplicates return 200 no-op. */
  event_id: string;
  /** Survey tool's canonical UUID for the survey record. Used as projects.survey_external_id. */
  survey_id: string;
  /** ISO-8601 timestamp when the surveyor marked the survey complete. */
  completed_at: string;
  /** Optional direct URL to the full survey payload. If absent, SolarPro derives from SURVEY_BACKEND_URL + survey_id. */
  survey_url?: string;
  // ── F-06: Ownership routing ─────────────────────────────────────────────────
  // Populated when the survey was initiated from a SolarPro handoff JWT.
  // Null/absent for surveys created without a handoff (e.g. standalone mobile).
  // SolarPro ingest validates solarpro_user_id against its own users table;
  // on validation failure it falls back to SURVEY_INGEST_DEFAULT_USER_ID.
  /** SolarPro user UUID from the handoff JWT. */
  solarpro_user_id?: string | null;
  /** SolarPro project UUID from the handoff JWT (= the project that initiated the survey). */
  solarpro_project_id?: string | null;
  /** SolarPro user email from the handoff JWT (for audit / fallback lookup). */
  solarpro_email?: string | null;
  // ── F-06b: Inspector identity ───────────────────────────────────────────────
  // Sent by the partner as top-level fields in the webhook body.
  // Used as fallback resolution when no SolarPro ownership claims are present.
  /** Inspector name as entered in the partner app. Used for name-based owner resolution. */
  inspector_name?: string | null;
  /** Inspector email if sent by the partner app. Used for email-based owner resolution. */
  inspector_email?: string | null;
  // -- v47.438: On-device picker selections (standalone surveys only) ---------
  // Set when the field worker used the client/project picker on Step 1.
  // Null/absent for project-specific surveys (project_id was in the JWT).
  /** SolarPro project UUID selected by the field worker on-device. When present,
   *  ingest attaches the survey directly to this project. */
  solarpro_selected_project_id?: string | null;
  /** SolarPro client UUID selected by the field worker on-device. When present
   *  (and solarpro_selected_project_id is absent), ingest creates a new project
   *  under this client and attaches the survey to it. */
  solarpro_selected_client_id?: string | null;
}

// ---------------------------------------------------------------------------
// HMAC verification result.
//
// verifyWebhookSignature() returns this so callers can log BOTH valid and
// invalid attempts to webhook_deliveries (invalid deliveries are recorded so
// ops can see attack attempts / misconfigurations).
// ---------------------------------------------------------------------------
export interface WebhookSignatureVerification {
  valid: boolean;
  /** Present when valid=false; explains WHY the signature failed. */
  reason?:
    | 'MISSING_SIGNATURE_HEADER'
    | 'MISSING_TIMESTAMP_HEADER'
    | 'TIMESTAMP_OUT_OF_TOLERANCE'
    | 'SIGNATURE_MISMATCH'
    | 'MALFORMED_TIMESTAMP';
  /** Seconds between request timestamp and server time. Negative = future. */
  timestampSkewSeconds?: number;
}

// ---------------------------------------------------------------------------
// webhook_deliveries row shape (TypeScript mirror of the DB table).
// See migrations/011_survey_ingest.sql for the canonical schema.
// ---------------------------------------------------------------------------
export type WebhookDeliveryStatus =
  | 'received'    // row inserted, before any verification
  | 'verified'    // HMAC + timestamp passed; v47.434 terminal state
  | 'duplicate'   // event_id already existed; returned 200 no-op
  | 'ingested'    // (v47.435+) full pipeline succeeded, project created/updated
  | 'failed'      // (v47.435+) ingest raised an error after successful HMAC
  | 'replayed';   // (v47.437+) admin manually re-triggered ingest

export interface WebhookDelivery {
  id: string;
  source: 'survey';           // room for other sources later; v1 is just survey
  event_type: SurveyEventType;
  event_id: string;
  signature_header: string | null;
  timestamp_header: string | null;
  signature_valid: boolean;
  raw_body: string | null;
  status: WebhookDeliveryStatus;
  error_message: string | null;
  project_id: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Project origin taxonomy. CLOSED enum locked by the drift-guard.
// ---------------------------------------------------------------------------
export type ProjectOrigin = 'manual' | 'bill_upload' | 'survey' | 'api';
export const PROJECT_ORIGIN_VALUES: readonly ProjectOrigin[] = [
  'manual',
  'bill_upload',
  'survey',
  'api',
] as const;