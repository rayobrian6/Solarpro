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
    },
  };
}