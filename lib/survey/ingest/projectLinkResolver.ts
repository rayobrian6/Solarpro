// ============================================================================
// v47.438 - Survey Ingest: Project Link Resolver
//
// Determines WHERE in SolarPro a survey delivery should be written.
//
// Resolution priority (highest to lowest):
//
//   1. selectedProjectId (v47.438) — field worker picked an existing project
//      on-device via the standalone survey picker. Attach directly to it.
//
//   2. selectedClientId (v47.438) — field worker picked a client on-device.
//      Create a new project under that client (create_under_client action).
//      The ingest pipeline will also check if the field worker selected an
//      existing project from that client's list (handled by selectedProjectId).
//
//   3. partnerProjectId — JWT had a project_id (PM-initiated flow, unchanged).
//      Attach to that project.
//
//   4. No project reference — create orphan (existing fallback, unchanged).
//
//   TRIAGE_QUEUE env override — bypasses all per-event routing.
//
// This function is PURE with respect to the DB — it does not query anything.
// All DB operations are performed in ingestPipeline.ts after receiving the
// LinkResolution.
// ============================================================================

import type {
  IngestContext,
  LinkResolution,
  SurveyProjectLinkStrategy,
} from './types';
import {
  SURVEY_PROJECT_LINK_STRATEGIES,
  DEFAULT_SURVEY_PROJECT_LINK_STRATEGY,
} from './types';
import { isValidUUID } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// resolveProjectLinkStrategy — reads env var, validates, returns strategy.
// ---------------------------------------------------------------------------
export function resolveProjectLinkStrategy(): SurveyProjectLinkStrategy {
  const raw = process.env.SURVEY_PROJECT_LINK_STRATEGY?.trim().toUpperCase();
  if (!raw) return DEFAULT_SURVEY_PROJECT_LINK_STRATEGY;

  if ((SURVEY_PROJECT_LINK_STRATEGIES as readonly string[]).includes(raw)) {
    return raw as SurveyProjectLinkStrategy;
  }

  console.warn(
    `[projectLinkResolver] Unknown SURVEY_PROJECT_LINK_STRATEGY="${raw}". ` +
    `Falling back to default "${DEFAULT_SURVEY_PROJECT_LINK_STRATEGY}". ` +
    `Valid values: ${SURVEY_PROJECT_LINK_STRATEGIES.join(', ')}`,
  );
  return DEFAULT_SURVEY_PROJECT_LINK_STRATEGY;
}

// ---------------------------------------------------------------------------
// resolveProjectLink — main entry point.
//
// Accepts the full IngestContext so each strategy branch has access to
// event fields, partnerProjectId, selectedProjectId, selectedClientId,
// ownerId, and traceId.
// ---------------------------------------------------------------------------
export function resolveProjectLink(
  context: IngestContext,
  strategy?: SurveyProjectLinkStrategy,
): LinkResolution {
  const effectiveStrategy = strategy ?? resolveProjectLinkStrategy();
  const {
    event,
    partnerProjectId,
    selectedProjectId,
    selectedClientId,
    traceId,
  } = context;

  // TRIAGE_QUEUE is an ops-level override — park everything for manual review
  // regardless of any per-event routing.
  if (effectiveStrategy === 'TRIAGE_QUEUE') {
    console.log(
      `[projectLinkResolver] TRIAGE_QUEUE override active — triaging survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'triage',
      surveyExternalId: event.survey_id,
      reason:
        'TRIAGE_QUEUE strategy is configured. All survey deliveries require ' +
        'manual ops review before project linkage.',
    };
  }

  // -------------------------------------------------------------------------
  // Per-event routing (priority order)
  // -------------------------------------------------------------------------

  // Priority 1 (v47.438): On-device picker — field worker selected an
  // existing project. Attach directly to it.
  if (selectedProjectId && isValidUUID(selectedProjectId)) {
    console.log(
      `[projectLinkResolver] Strategy: attach (on-device project pick) ` +
      `projectId=${selectedProjectId} survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'attach',
      projectId: selectedProjectId,
    };
  }

  // Priority 2 (v47.438): On-device picker — field worker selected a client.
  // Create a new project under that client.
  if (selectedClientId && isValidUUID(selectedClientId)) {
    console.log(
      `[projectLinkResolver] Strategy: create_under_client (on-device client pick) ` +
      `clientId=${selectedClientId} survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'create_under_client',
      clientId: selectedClientId,
      surveyExternalId: event.survey_id,
    };
  }

  // Priority 3: PM-initiated flow — JWT had project_id. Attach to it.
  if (partnerProjectId) {
    console.log(
      `[projectLinkResolver] Strategy: attach (JWT project_id) ` +
      `projectId=${partnerProjectId} survey_id=${event.survey_id} traceId=${traceId}`,
    );
    return {
      action: 'attach',
      projectId: partnerProjectId,
    };
  }

  // Priority 4: No project reference — auto-create orphan under SSO user.
  console.log(
    `[projectLinkResolver] Strategy: create orphan ` +
    `survey_id=${event.survey_id} traceId=${traceId}`,
  );
  return {
    action: 'create',
    surveyExternalId: event.survey_id,
    strategy: 'CREATE_ORPHAN',
  };
}