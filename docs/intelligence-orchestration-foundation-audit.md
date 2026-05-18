# Intelligence Orchestration Foundation Audit

**Scope:** Audit only. No endpoint, dashboard, scheduler, projection, lifecycle mutation, or new migration was implemented.

## 1. PASS / FAIL Summary

**Final recommendation: APPROVE WITH FIXES before endpoint exposure.**

The orchestration foundation is directionally correct and preserves the core architecture: it is dry-run capable, observation-only, replay-aware, deterministic enough for controlled execution, and does not mutate canonical source-of-truth systems. Existing targeted tests pass.

However, before exposing an admin-safe trigger endpoint, several issues should be fixed: DB-level idempotent collision reporting is not available in summaries, missing idempotency keys are not treated as validation failures by the runner, registry supported entity types are metadata-only and not enforced against generated observations, validation failure producer attribution can be inaccurate, and non-dry-run without a writer throws instead of returning a structured failure summary.

## 2. Architectural Concerns

The foundation correctly avoids building dashboards, schedules, endpoints, projections, lifecycle mutations, and event ledgers. The runner accepts producer jobs and inputs and delegates to the registry. It validates observations and deduplicates by idempotency key within a run.

Main concerns are endpoint-readiness, not architecture direction:

1. The runner currently detects only in-run duplicate idempotency keys. It cannot distinguish an already-existing observation in the database from a newly inserted one when using the current `NeonObservationWriter` contract.
2. `idempotency_key` is optional in the core observation type and validation helper. The producers generate keys, but the runner does not enforce idempotency as a hard orchestration requirement.
3. Registry metadata declares supported entity types, but the runner does not verify that generated observations match the producer metadata.
4. Validation failure attribution attempts to infer producer name from `source_system`, which can be wrong for names like `ahj_correction_producer` vs registry name `ahj_corrections`.
5. `dry_run=false` without a writer throws and does not return a structured summary. This is acceptable for library misuse, but admin endpoint integration will be safer if it returns a structured write failure.

## 3. Dry-Run Safety Findings

**Status: PASS.**

Dry-run mode executes producers, validates observations, returns a structured summary, and does not call the writer. The test `dry-run executes producers, validates observations, and performs zero writes` proves a writer can be provided and receives zero calls when `dry_run=true`.

Dry-run summary behavior:

- `observations_generated` counts producer output.
- `observations_validated` counts valid observations.
- `observations_written` is zero.
- `observations_skipped` counts observations not written due to dry-run plus in-run collisions.

This is safe for future admin tooling.

## 4. Idempotency Findings

**Status: APPROVE WITH FIXES.**

The runner deduplicates observations by `idempotency_key` within a single run. This prevents duplicate writes when overlapping jobs produce the same observation during one execution.

The actual DB writer uses `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key`, which prevents duplicate rows but does not currently expose whether the write was a new insert or a replay collision. Therefore, `idempotent_collisions` in the runner summary only reflects in-run duplicates, not DB-level replay collisions.

Required fix before endpoint exposure:

- Either extend the writer contract to return `{ observation, inserted | existing }`, or add a preflight/check mechanism for idempotency keys.
- Enforce `idempotency_key` as required in orchestration even if the base observation model allows optional keys.

## 5. Replay Stability Findings

**Status: PASS with minor caution.**

`normalizeExecutionContext` is deterministic when provided the same `observed_at`, replay window, scope, source event ID, and correlation ID. If omitted, `observed_at` falls back to the replay window end or `1970-01-01T00:00:00.000Z`, which avoids wall-clock instability.

`replayBoundaryKey` is stable and prioritizes source event ID, replay window, entity scope, opportunity scope, project scope, then deterministic hash fallback.

Minor caution: `duration_ms` uses `Date.now()`, so the execution summary is not fully deterministic, though this is acceptable as runtime telemetry and not an idempotency input.

## 6. Registry Safety Findings

**Status: APPROVE WITH FIXES.**

Only registered producers can run through `getProducer`. Unknown names throw and are isolated by the runner if passed at runtime. Registry metadata includes name, version, description, supported entity types, replay capabilities, dry-run support, and observation-only flag.

Missing before endpoint exposure:

- Add a test for unknown producer names.
- Enforce or validate that generated observations attach only to entity types listed in the producer metadata.
- Optionally validate that requested scope entity type is compatible with the producer metadata.

## 7. Failure Isolation Findings

**Status: PASS with one fix recommended.**

Producer failures are isolated. A producer throwing does not halt unrelated producers. Validation failures are collected and do not halt execution. Writer failures are captured per observation and do not halt remaining writes.

Recommended fix: handle missing writer in non-dry-run mode as a structured `write_failure` summary rather than throwing before returning a result. This will make the future admin endpoint easier to reason about.

## 8. Observation Validation Findings

**Status: PASS at base layer, APPROVE WITH FIXES at runner layer.**

`validateObservationDraft` enforces approved entity types, required fields, confidence bounds, derivation method/version/inputs/factors, payload object, observed_at timestamp, and schema version.

But `idempotency_key` is not required by base validation. For the orchestration layer, idempotency must be mandatory. The runner should treat missing idempotency keys as validation failures rather than falling back to a synthetic key.

## 9. Source-of-Truth Protection Findings

**Status: PASS.**

Static inspection found no imports or writes to canonical truth systems from orchestration files. The orchestration foundation does not import DB clients and does not write to `projects`, `network_opportunities`, `contractor_profiles`, `utility_policies`, AHJ systems, or `opportunity_intelligence`.

## 10. Event-System Protection Findings

**Status: PASS.**

No new event ledger or lifecycle event system was created. Orchestration uses producer inputs and existing observation writer contracts only. It does not create or mutate `network_events`, `intake_events`, `webhook_ingestion_log`, `project_activity`, or admin activity logs.

## 11. Execution Summary Completeness

**Status: PASS.**

The summary includes all requested fields:

- `run_id`
- `dry_run`
- `replay_boundary`
- `producers_requested`
- `producers_executed`
- `entities_processed`
- `observations_generated`
- `observations_validated`
- `observations_written`
- `observations_skipped`
- `idempotent_collisions`
- `validation_failures`
- `producer_failures`
- `write_failures`
- `duration_ms`
- `started_at`
- `finished_at`

Future endpoint may also want `scope` echoed in the summary, but the current result includes context separately.

## 12. Test Quality

**Status: PASS with missing endpoint-readiness tests.**

Current tests prove architectural behavior, not just existence. Covered:

- dry-run zero writes
- non-dry-run writer path
- duplicate idempotency collision within one run
- replay stability
- failed producer isolation
- deterministic context
- no event ledger creation
- no lifecycle/source-of-truth mutation

Missing before endpoint exposure:

1. Unknown producer safety test.
2. Invalid observation validation through runner.
3. Missing `idempotency_key` rejection at runner layer.
4. Writer failure isolation test.
5. Registry supported entity type enforcement test.
6. Non-dry-run without writer structured failure behavior.
7. DB-level idempotent replay collision reporting, if writer contract is extended.

## 13. Documentation / Code Mismatch

**Status: PASS.**

Comments and tests do not overstate scheduled execution, automatic learning, projection mutation, dashboard visibility, or event-ledger ownership. The runner file explicitly states execution infrastructure only. No docs claim endpoint exposure has been built.

## 14. Required Fixes Before Endpoint Exposure

1. Require `idempotency_key` in the runner validation path.
2. Improve writer contract to identify inserted vs existing observations, or otherwise accurately report DB-level idempotent collisions.
3. Validate producer output entity types against registry metadata.
4. Add unknown producer test.
5. Add invalid observation / missing idempotency test.
6. Add writer failure isolation test.
7. Consider returning structured failure summary when `dry_run=false` and no writer is supplied.

## 15. Final Recommendation

**APPROVE WITH FIXES.**

Do not expose an admin trigger endpoint yet. The foundation is strong and canonical, but endpoint exposure should wait until the runner enforces orchestration-level idempotency, reports replay collisions more accurately, validates registry entity compatibility, and has the missing failure-path tests.
