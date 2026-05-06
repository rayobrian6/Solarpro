// ============================================================================
// v47.434a — Survey webhook envelope validator (extracted from route.ts).
//
// Moved out of the Next.js route file because Next.js disallows arbitrary
// exports from app/api route modules (only the reserved route-handler and
// config symbols are permitted). Pure function, fully testable in isolation.
//
// See docs/stage9_v47434a-contract-delta-map.md for the partner-wire context.
// ============================================================================

import {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SURVEY_EVENT_TYPES,
  type SurveyCompletedEvent,
  type SurveyEventType,
} from './types';

export type EnvelopeOk = { ok: true; event: SurveyCompletedEvent; error?: undefined };
export type EnvelopeErr = { ok: false; error: string; event?: undefined };
export type EnvelopeResult = EnvelopeOk | EnvelopeErr;

/**
 * Validate an inbound survey webhook envelope.
 *
 * Behaviour (v47.434a):
 *   - schemaVersion absent → accept, coerce to CURRENT_SCHEMA_VERSION
 *   - schemaVersion present but != CURRENT_SCHEMA_VERSION → reject
 *   - event / event_id / survey_id / completed_at must be non-empty strings
 *   - survey_url optional; if present must be a string
 *   - extra fields are silently dropped (partner's producer sends
 *     project_id / project_name / inspector_name / site_name / status /
 *     occurred_at which v47.435+ will extract through a separate code path)
 */
export function validateEnvelope(raw: unknown): EnvelopeResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Body is not a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  // v47.434a — schemaVersion is OPTIONAL on the wire. When absent, we treat
  // the event as the current schema version (v1.0) because:
  //   1. The partner's producer does NOT echo schemaVersion in the payload.
  //   2. The inbound contract is still frozen at v1.0 — bumping it requires a
  //      coordinated release on both sides.
  //   3. If/when a future producer sends a different schemaVersion, we still
  //      reject it explicitly (preserves forward-compat signalling).
  if (r.schemaVersion !== undefined && r.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported schemaVersion: ${String(r.schemaVersion)}. Expected '${CURRENT_SCHEMA_VERSION}' or absent.`,
    };
  }
  if (typeof r.event !== 'string' || !(SUPPORTED_SURVEY_EVENT_TYPES as readonly string[]).includes(r.event)) {
    return { ok: false, error: `Unsupported event type: ${String(r.event)}` };
  }
  if (typeof r.event_id !== 'string' || r.event_id.length === 0) {
    return { ok: false, error: 'Missing or invalid event_id' };
  }
  if (typeof r.survey_id !== 'string' || r.survey_id.length === 0) {
    return { ok: false, error: 'Missing or invalid survey_id' };
  }
  if (typeof r.completed_at !== 'string' || r.completed_at.length === 0) {
    return { ok: false, error: 'Missing or invalid completed_at' };
  }
  if (r.survey_url !== undefined && typeof r.survey_url !== 'string') {
    return { ok: false, error: 'survey_url must be a string if present' };
  }

  // F-06: Ownership routing fields — optional, pass through if present as strings.
  // Validate type only; null/absent is acceptable (legacy surveys without handoff).
  const solarpro_user_id =
    typeof r.solarpro_user_id === 'string' ? r.solarpro_user_id : null;
  const solarpro_project_id =
    typeof r.solarpro_project_id === 'string' ? r.solarpro_project_id : null;
  const solarpro_email =
    typeof r.solarpro_email === 'string' ? r.solarpro_email : null;

  // F-06b: Inspector identity fields — sent by partner as top-level webhook fields.
  // Used as fallback owner resolution when no SolarPro JWT claims are present.
  const inspector_name =
    typeof r.inspector_name === 'string' && r.inspector_name.trim()
      ? r.inspector_name.trim() : null;
  const inspector_email =
    typeof r.inspector_email === 'string' && r.inspector_email.trim()
      ? r.inspector_email.trim().toLowerCase() : null;

  // Survey naming fields — sent by partner in the thin event body.
  // These are used as fallback project name in degraded mode (when
  // fetchFullPayload returns null and we would otherwise fall back to
  // "Survey <uuid>"). Silently ignored if absent.
  const project_name =
    typeof r.project_name === 'string' && r.project_name.trim()
      ? r.project_name.trim() : null;
  const site_name =
    typeof r.site_name === 'string' && r.site_name.trim()
      ? r.site_name.trim() : null;

  // v47.438: On-device picker selections — forwarded by /api/survey/submit from
  // the SurveyV2Payload. These determine which project/client the survey lands on.
  // MUST be passed through here or they are silently dropped before reaching
  // the ingest context, causing surveys to create orphan projects instead of
  // attaching to the field worker's selected project.
  const solarpro_selected_project_id =
    typeof r.solarpro_selected_project_id === 'string' && r.solarpro_selected_project_id.trim()
      ? r.solarpro_selected_project_id.trim() : null;
  const solarpro_selected_client_id =
    typeof r.solarpro_selected_client_id === 'string' && r.solarpro_selected_client_id.trim()
      ? r.solarpro_selected_client_id.trim() : null;

  return {
    ok: true,
    event: {
      event: r.event as SurveyEventType,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      event_id: r.event_id,
      survey_id: r.survey_id,
      completed_at: r.completed_at,
      survey_url: r.survey_url as string | undefined,
      // F-06: Ownership claims (null when not from a SolarPro handoff)
      solarpro_user_id,
      solarpro_project_id,
      solarpro_email,
      // F-06b: Inspector identity (from partner webhook body)
      inspector_name,
      inspector_email,
      // v47.438: On-device picker selections (null for PM-initiated surveys)
      solarpro_selected_project_id,
      solarpro_selected_client_id,
      // Survey naming fallback (used in degraded mode when full payload fetch fails)
      project_name,
      site_name,
    },
  };
}