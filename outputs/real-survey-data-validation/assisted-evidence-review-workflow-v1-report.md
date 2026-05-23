# Assisted Evidence Review Workflow V1 Report

Generated: 2026-05-23T19:53:12.499Z

## Review objective

The review workflow must convert non-authoritative candidate metadata into explicit reviewer decisions without allowing hidden state mutation. Assistance can reduce reviewer effort by surfacing quality problems and likely evidence categories, but a human must decide whether any candidate becomes canonical metadata, a rejected hint, a request for additional field evidence, or a note with no engineering effect.

## Required workflow states

The workflow should begin when a raw upload exists and the candidate sandbox emits candidate_generated records. Every candidate immediately enters review_required. A reviewer can mark it accepted_by_reviewer, rejected_by_reviewer, needs_recapture, duplicate_candidate_only, informational_only, or superseded. Only accepted_by_reviewer may create or update an explicit reviewed metadata record, and that reviewed record must preserve the candidate id and reviewer id in provenance. Rejected, informational, and duplicate-only candidates must never influence requirement satisfaction.

## Reviewer UI requirements

The UI should show the raw image/file reference, candidate type, candidate confidence label, tool version, source file id, candidate age, invalidation status, and exactly which engineering requirement or capture category would remain blocked unless a reviewer acts. It should not show candidates as truth. The wording should use candidate, hint, possible, needs review, and not verified. It must avoid confirmed, detected, measured, code compliant, CAD ready, engineering approved, or satisfied unless the value comes from reviewed canonical evidence.

## Canonical influence rules

Reviewer acceptance may create explicit metadata such as reviewed category, reviewed quality flag, reviewed duplicate relation, reviewed text-region-present flag, or reviewed recapture request. Reviewer acceptance must not fabricate roof planes, meter ratings, panel ratings, breaker sizes, route lengths, set-back dimensions, structural spans, or CAD geometry. If a candidate suggests a requirement may be satisfied, the requirement remains missing or review_required until canonical evidence metadata and any required explicit survey fields are present.

## Workflow orchestration impact

Deterministic workflow orchestration may queue a human review action when candidate metadata exists, candidate quality is poor, a required evidence category remains missing, or an invalidated candidate needs re-review. It must not queue autonomous CAD regeneration, automatic permitting updates, automatic requirement satisfaction, or hidden evidence promotion. The workflow action should name the candidate ids and blocked requirements, not mutate them.

## Audit trail

Every reviewer action must append immutable provenance containing reviewer id, timestamp, source candidate id, previous status, new status, reason, and any canonical evidence id affected. The review trail must be visible in Engineering Intelligence and report exports. Candidate-to-canonical mappings must be diffable and invalidatable so a later source-file or tool-version change can show why a prior decision remains valid or must be reviewed again.
