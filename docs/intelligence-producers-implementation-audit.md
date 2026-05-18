# Intelligence Producer Implementation Audit

**Scope:** Audit only. No orchestration, runners, endpoints, dashboards, projections, or migrations were implemented.

## 1. PASS / FAIL Summary

**Overall recommendation: APPROVE WITH FIXES before orchestration.**

The producer layer is architecturally sound in the most important ways: it introduces no duplicate source-of-truth systems, producers are observation-only, outputs attach to canonical entities, observations are explainable, and targeted tests pass. However, several issues should be fixed before building the orchestration runner, mainly around idempotency stability, confidence derivation consistency, brittle classification ordering, and missing negative/edge-case tests.

## 2. No Duplicate Source-of-Truth Systems

**Status: PASS.**

Static inspection of `lib/intelligence/producers.ts`, `lib/intelligence/events.ts`, `lib/intelligence/observations.ts`, `lib/intelligence/bridges.ts`, and migrations confirms no new duplicate systems were introduced. The implementation does not create new utility, opportunity lifecycle, contractor, project lifecycle, event ledger, or marketplace state systems. The only DB writer remains the approved `NeonObservationWriter`, which writes exclusively to `intelligence_observations`.

## 3. Producers Are Observation-Only

**Status: PASS.**

The producers in `lib/intelligence/producers.ts` are pure functions returning `IntelligenceObservationDraft[]`. They do not import Neon, `getDbReady`, `fetch`, or route utilities. They do not issue `INSERT`, `UPDATE`, `DELETE`, or lifecycle mutations. They do not write to `network_opportunities`, `projects`, `contractor_profiles`, `utility_policies`, or `project_status`.

## 4. Canonical Attachment Rules

**Status: PASS with one caution.**

Producer outputs attach to approved entity types: `contractor`, `client`, `project`, `opportunity`, `ahj`, and `utility`. The failure producer accepts only `project | opportunity | contractor | utility | ahj`, which is valid. The homeowner producer chooses `client` first, then `project`, then `opportunity`.

Caution: the directive uses “client/homeowner,” while the approved observation type is `client`. This is correct with current code, but documentation and future runner naming should consistently call this `client` to avoid introducing a `homeowner` entity type later.

## 5. Explainability

**Status: PASS.**

Every generated observation uses `createObservationDraft`, which injects and validates `schema_version`. Required fields are present: `source_system`, `observed_at`, `confidence`, `derivation`, factor breakdown via `derivation.factors`, `payload`, and `idempotency_key`. The producers include method names and versions in derivation.

## 6. Idempotency

**Status: APPROVE WITH FIXES.**

Most producers use stable replay-safe keys based on entity, window, metric, pattern, and source event IDs. Good examples include contractor, homeowner, AHJ, utility, and failure producers.

Concern: `produceOpportunityLifecycleObservations` uses `observedAt` directly in idempotency keys. If a future runner uses current time by default, replaying the same opportunity snapshot will create duplicate observations. This is acceptable only if the runner always supplies a stable snapshot timestamp or window. Before orchestration, either require `ctx.observed_at` for lifecycle replay or change lifecycle idempotency to use a deterministic replay boundary such as `window.start/window.end`, `opportunity.updated_at`, or a hash of source event IDs.

Additional concern: `NeonObservationWriter` uses `ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key`. This is effectively no-op and prevents duplicates, but returns the existing row as an update. That is acceptable, but should be documented as an idempotent replay behavior. It does technically perform an UPDATE against `intelligence_observations`, but not history mutation of payload/derivation.

## 7. Confidence Scoring

**Status: APPROVE WITH FIXES.**

Confidence values are bounded by validation. Contractor and homeowner use sample-size-based confidence. Classification producers use conservative fixed values: around `0.42–0.45` for general matches and `0.76–0.80` for specific keyword matches.

Concern: opportunity lifecycle confidence is partially hardcoded (`0.82`, `0.72`) and not fully derived from evidence completeness. AHJ/utility/failure confidence is conservative but still fixed by classification category rather than event quality, repeated pattern count, or metadata richness. Before orchestration, confidence should be centralized in helper functions so future producers follow a shared rationale: sample size, explicitness, source reliability, metadata completeness, and recency.

## 8. Classification Quality

**Status: APPROVE WITH FIXES.**

Classification is transparent, conservative, and easy to extend because it is regex-based with explicit pattern maps. It is not a black box.

Weaknesses:

- AHJ classifier checks fire/setback before battery; a phrase like “battery fire setback” becomes `ahj_fire_setback_pattern`, not battery restriction.
- Utility classifier checks PTO delay before interconnection; “PTO delayed pending transformer upgrade” becomes `utility_pto_delay_pattern`, not interconnection complexity.
- Failure classifier checks inspection before conduit/redesign; “inspection failed due to conduit labeling” becomes inspection failure, which may be fine, but loses root-cause detail.
- No multi-label output. Current classification returns one pattern only.
- No negative tests for ambiguous text or general fallback.

This is acceptable for first producer layer but should be improved before orchestration if observations will be replayed broadly.

## 9. Tests Are Meaningful

**Status: PASS with missing edge coverage.**

Existing tests prove meaningful architecture behavior, not just file existence. They validate canonical attachments, schema validation, classification, and explainability. The architecture tests also prove no duplicate utility/opportunity lifecycle tables in migration 061 and verify event adapters preserve source logs.

Missing tests before orchestration:

- idempotency stability on repeated runs with the same input
- lifecycle producer duplicate risk when `observed_at` is omitted
- invalid homeowner entity input when no client/project/opportunity ID is supplied
- confidence bounds for every producer under empty/minimal inputs
- ambiguous classifier cases
- no direct DB writer/import in producer module
- no unsupported `homeowner` entity type leakage

## 10. Documentation Matches Code

**Status: MOSTLY PASS.**

`docs/intelligence-producers-audit.md` aligns with implemented producers. The six required producers exist. The doc claims confidence may use repeated pattern frequency for AHJ/utility, but the code currently uses per-event fixed classifier confidence and does not aggregate repeated patterns. That is a mismatch to address before orchestration if the runner is expected to produce pattern-level aggregate learning.

The doc also mentions attaching homeowner engagement to `network_opportunities`; code can attach to opportunity only if no client or project is provided. That is acceptable but should be documented more explicitly.

## 11. Orchestration Readiness

**Status: APPROVE WITH FIXES.**

Ready aspects:

- Clear input shapes
- Deterministic outputs when `ctx.observed_at` and `ctx.window` are supplied
- No side effects
- Producers return observation drafts only
- Inputs and outputs are testable
- Idempotency exists for all observations
- Predictable behavior for empty lists in most producers

Fix before orchestration:

1. Make lifecycle idempotency deterministic without relying on wall-clock time.
2. Add a shared confidence helper and use it consistently.
3. Add negative/edge-case tests.
4. Document the observation writer replay behavior.
5. Decide whether classifiers should remain single-label for v1 runner or support secondary factors in payload.

## 12. Final Recommendation

**APPROVE WITH FIXES.**

Do not block the architecture. The implementation respects canonical boundaries and is observation-only. However, I recommend applying the fixes above before building the orchestration foundation, especially lifecycle idempotency and confidence consistency, because orchestration will multiply any replay/idempotency weakness.

---

## Post-Audit Hardening Status

The audit findings above were addressed in the producer hardening pass:

1. Opportunity lifecycle idempotency no longer uses wall-clock `observed_at` as the primary replay component. The producer now uses the preferred stability order: source event ID, replay window, canonical `updated_at`, assignment source IDs, then deterministic snapshot hash.
2. Confidence now flows through shared helper utilities using sample size, source reliability, explicitness, metadata richness, recency, classification strength, and corroborating signals.
3. Classifiers remain primary-label for v1 but now include `secondary_matches`, `matched_patterns`, and `classification_notes` in payload and derivation.
4. Tests were hardened for repeated-run idempotency, omitted observed_at lifecycle replay, invalid client attachment input, confidence bounds, ambiguous classifier behavior, no DB writer/import side effects, no homeowner entity leakage, and no lifecycle mutation.
5. Documentation now states repeated-pattern aggregation is future orchestration/aggregation work, not a per-event producer responsibility.

Updated recommendation after hardening: ready for orchestration foundation, provided the future runner preserves dry-run mode, scoped replay, idempotent writes, and no projection mutation.
