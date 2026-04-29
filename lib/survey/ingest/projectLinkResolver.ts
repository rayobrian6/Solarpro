// ============================================================================
// v47.435 Stage 9.2 — Survey Ingest: Project Link Resolver
//
// Determines WHERE in SolarPro a survey delivery should be written.
//
// Q8 (BLOCKING): "What should we do when the thin event carries no
// project_id?" — answered via SURVEY_PROJECT_LINK_STRATEGY env var.
//
// Until Q8 is answered the default strategy is CREATE_ORPHAN:
//   - Every new survey creates a new SolarPro project with origin='survey'
//     and survey_external_id=event.survey_id for idempotency.
//   - If a project with that survey_external_id already exists for the owner,
//     the pipeline updates it (idempotency guarantee from the
//     idx_projects_survey_external_id_user unique index).
//
// When Q8 is answered, switch SURVEY_PROJECT_LINK_STRATEGY to the chosen
// value and implement the ATTACH_TO_EXISTING / TRIAGE_QUEUE branches below.
// The pipeline calls this resolver and acts on the returned LinkResolution —
// zero changes to runIngestPipeline() are needed for strategy changes.
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

// ---------------------------------------------------------------------------
// resolveProjectLinkStrategy — reads env var, validates, returns strategy.
//
// Exported separately so tests can verify strategy resolution without a
// full IngestContext.
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
// event fields, partnerProjectId, ownerId, and traceId.
//
// This function is PURE with respect to the DB — it does not query anything.
// The pipeline orchestrator (ingestPipeline.ts) performs any required DB
// lookups AFTER receiving the resolution. This keeps the resolver fast,
// synchronous, and easily testable.
//
// Exception: ATTACH_TO_EXISTING will need a DB lookup to verify the project
// exists and belongs to ownerId. That lookup is done in the pipeline using
// the returned projectId hint. The resolver just decides the action and
// provides the necessary identifiers.
// ---------------------------------------------------------------------------
export function resolveProjectLink(
  context: IngestContext,
  strategy?: SurveyProjectLinkStrategy,
): LinkResolution {
  const effectiveStrategy = strategy ?? resolveProjectLinkStrategy();
  const { event, partnerProjectId, traceId } = context;

  // Q8 ANSWERED (v60.5): per-event routing.
  //   Case 1 — event carries solarpro_project_id (partnerProjectId):
  //            ATTACH to that project. This is the "Start Survey from project"
  //            flow - JWT had project_id.
  //   Case 2 — event carries NO solarpro_project_id:
  //            CREATE a new project automatically under the SSO user's
  //            account. This is the "user logs into app and starts a
  //            survey from scratch" flow. The owner is already resolved
  //            upstream via resolveIngestOwner(solarpro_user_id).
  //
  // The env-configured strategy is honoured as an OVERRIDE only when it is
  // TRIAGE_QUEUE (ops wants manual review of everything). Otherwise per-event
  // routing is the default behaviour.
  if (effectiveStrategy !== 'TRIAGE_QUEUE') {
    if (partnerProjectId) {
      return {
        action: 'attach',
        projectId: partnerProjectId,
      };
    }
    // No project_id on the event — auto-create under the SSO user.
    return {
      action: 'create',
      surveyExternalId: event.survey_id,
      strategy: 'CREATE_ORPHAN',
    };
  }

  // At this point effectiveStrategy === 'TRIAGE_QUEUE' by the guard above.
  // (The other two enum values are handled by per-event routing.)
  //
  // TRIAGE_QUEUE is an ops-level "pause the world" switch: every survey is
  // parked for manual review regardless of whether partnerProjectId is set.
  // We explicitly log traceId so ops can correlate triage rows back to the
  // originating webhook delivery.
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