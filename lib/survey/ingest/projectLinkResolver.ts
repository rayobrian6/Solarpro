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

  switch (effectiveStrategy) {
    case 'CREATE_ORPHAN': {
      // Default strategy (pre-Q8): always create (or upsert) a SolarPro project
      // keyed on survey_external_id = event.survey_id. No partner project linkage.
      return {
        action: 'create',
        surveyExternalId: event.survey_id,
        strategy: 'CREATE_ORPHAN',
      };
    }

    case 'ATTACH_TO_EXISTING': {
      // Q8 answered: partner guarantees project_id will be present.
      // If partnerProjectId is null, we cannot attach — fall through to triage.
      if (partnerProjectId) {
        return {
          action: 'attach',
          projectId: partnerProjectId,
        };
      }
      // partnerProjectId unexpectedly absent — degrade gracefully to triage
      // rather than silently creating orphans when ATTACH was the intent.
      console.warn(
        `[projectLinkResolver] ATTACH_TO_EXISTING strategy selected but ` +
        `partnerProjectId is null. Falling back to TRIAGE_QUEUE. ` +
        `traceId=${traceId} survey_id=${event.survey_id}`,
      );
      return {
        action: 'triage',
        surveyExternalId: event.survey_id,
        reason:
          'ATTACH_TO_EXISTING strategy is configured but no partner project_id ' +
          'was supplied in this delivery. Manual linkage required.',
      };
    }

    case 'TRIAGE_QUEUE': {
      // Q8 answered: all survey deliveries require manual ops triage.
      // Create a triage record for ops to resolve. The pipeline will create a
      // placeholder project with status='triage' (to be implemented when Q8
      // is answered and triage semantics are agreed with partner).
      return {
        action: 'triage',
        surveyExternalId: event.survey_id,
        reason:
          'TRIAGE_QUEUE strategy is configured. All survey deliveries require ' +
          'manual ops review before project linkage.',
      };
    }

    default: {
      // TypeScript exhaustiveness guard — should never reach here.
      const exhaustiveCheck: never = effectiveStrategy;
      return {
        action: 'error',
        error: `Unhandled link strategy: ${String(exhaustiveCheck)}`,
      };
    }
  }
}