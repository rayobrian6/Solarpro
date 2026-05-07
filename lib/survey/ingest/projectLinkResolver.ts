// ============================================================================
// v47.440 — Survey Ingest: Project Link Resolver
//
// Determines HOW to find the existing SolarPro project for a survey delivery.
//
// This function is PURE with respect to the DB — it does not query anything.
// All DB resolution is performed in ingestPipeline._resolveExistingProjectId().
//
// Resolution priority (returned as LinkResolution action):
//
//   1. selectedProjectId (on-device picker) — field worker picked an existing
//      project on-device. action='attach', method='selected_project'.
//
//   2. partnerProjectId (JWT handoff) — PM-initiated flow. JWT contained a
//      SolarPro project UUID. action='attach', method='direct_id'.
//
//   3. No direct UUID — action='resolve_existing'. Pipeline will look up:
//      B) survey_external_id (= event.survey_id) → find project by
//         survey_external_id column.
//      C) client_id + normalized address → find project by client+address.
//      If none found → CRITICAL error, ingest stops.
//
// AUTO-CREATE IS PROHIBITED. Surveys must attach to existing projects.
// ============================================================================

import type {
  IngestContext,
  LinkResolution,
} from './types';
import { isValidUUID } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// resolveProjectLink — main entry point.
// ---------------------------------------------------------------------------
export function resolveProjectLink(
  context: IngestContext,
): LinkResolution {
  const {
    event,
    partnerProjectId,
    selectedProjectId,
    selectedClientId,
    traceId,
  } = context;

  // Priority 1: On-device picker — field worker selected an existing project.
  if (selectedProjectId && isValidUUID(selectedProjectId)) {
    console.log(
      `[projectLinkResolver] action=attach method=selected_project ` +
      `projectId=${selectedProjectId} survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'attach',
      projectId: selectedProjectId,
      method: 'selected_project',
    };
  }

  // Priority 2: PM-initiated flow — JWT had a SolarPro project UUID.
  if (partnerProjectId && isValidUUID(partnerProjectId)) {
    console.log(
      `[projectLinkResolver] action=attach method=direct_id ` +
      `projectId=${partnerProjectId} survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'attach',
      projectId: partnerProjectId,
      method: 'direct_id',
    };
  }

  // Priority 3: No direct UUID — resolve by survey_external_id or client+address.
  // Pass client/address hints so the pipeline resolver can try Priority C.
  console.log(
    `[projectLinkResolver] action=resolve_existing ` +
    `survey_id=${event.survey_id} ` +
    `selectedClientId=${selectedClientId ?? 'null'} traceId=${traceId}`,
  );
  return {
    action: 'resolve_existing',
    surveyExternalId: event.survey_id,
    clientId: selectedClientId ?? null,
    address: null, // filled by transform layer output in pipeline
  };
}