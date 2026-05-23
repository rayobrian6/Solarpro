# Open-Source Assisted Evidence Integration Program V1 Master Plan

## Executive Summary

This program establishes the controlled architecture required before SolarPro introduces any open-source OCR, computer-vision, image-processing, metadata-extraction, or model-assisted evidence tooling. The current baseline already contains Assisted Evidence Sandbox V1 under `lib/assistedEvidence/`, including deterministic candidate creation, review-required lifecycle states, reviewed projections, deterministic hashing, sandbox guardrails, review-only admin surfacing, and validation scripts. This plan extends that baseline into a full governance and runtime-containment program without adding any runtime OCR/CV/image-processing dependency in this phase.

The governing invariant is that open-source runtime output must remain non-authoritative, quarantined, review-required, projection-only, and incapable of mutating canonical engineering truth. The required data path remains `open-source runtime -> normalized candidate -> createCandidate() -> review_required`. The forbidden path remains `open-source runtime -> canonical evidence`, including any direct influence on survey evidence manifests, engineering requirements, CAD readiness, recommendation systems, workflow orchestration, project mutation, or engineering calculations.

This is not a feature sprint. It is a staged governance program intended to prove that SolarPro can safely accept probabilistic assistance while preserving deterministic engineering boundaries.

## Architectural North Star

The open-source assisted evidence architecture should be organized as a layered containment system. Open-source tools are not trusted participants in canonical engineering logic. They are external evidence assistants whose only allowed output is normalized metadata converted into assisted evidence candidates. Candidates remain non-authoritative and review-required. Human review may accept specific fields into reviewed projections. Reviewed projections remain projection records only until a future explicit mapping layer, separately approved and separately guarded, maps them into canonical evidence or survey metadata.

```text
Raw upload / source file
  -> registered open-source tool runner or fixture runner
  -> raw runtime output
  -> deterministic adapter normalization
  -> assisted evidence candidate input
  -> createCandidate()
  -> markReviewRequired()
  -> review queue
  -> reviewer accept/reject/invalidate/supersede
  -> reviewed projection when accepted
  -> future explicit mapping layer only after separate approval
```

The architecture should make bypassing review harder than following the safe path. Runtime packages, native binaries, model weights, and adapters should be isolated from canonical modules by import rules, registry rules, validation scripts, and test coverage.

## Phase 0 — Governance Baseline and Decision Packet

### Goals

Phase 0 establishes the decision framework for any open-source intake. It defines the first pilot target, risk posture, license posture, runtime category, allowed candidate types, and no-go constraints before any dependency is installed.

### Scope

The phase is documentation, inventory, and approval only. It may add reports, checklists, and decision templates under `outputs/real-survey-data-validation/`. It must not add runtime OCR/CV/image-processing dependencies.

### Risk Level

Low. This phase changes no runtime behavior and introduces no tool execution.

### Dependencies

Phase 0 depends on the existing Assisted Evidence Sandbox V1 reports and `lib/assistedEvidence/` candidate model. It also depends on the current validation scripts remaining green.

### Deliverables

The deliverables are an implementation decision packet, source candidate inventory template, license intake checklist, risk matrix, and pilot recommendation. The packet should identify exactly one first pilot category and record why more capable categories are deferred.

### Validation Requirements

Validation should include document existence checks, `git diff --check`, and the standard repository validation suite when implementation files are touched. If only markdown reports are added, at minimum run `git diff --check` and, when practical, the boundary checks.

### Rollback Considerations

Rollback is trivial because Phase 0 produces planning artifacts only. Reverting the reports removes the phase.

### Success Criteria

Success means SolarPro has a written policy for evaluating candidate tools before intake, a risk-ranked first pilot recommendation, and a clear record that no runtime OCR/CV/image-processing dependency was added.

## Phase 1 — Open-Source Tool Registry and Adapter Contracts

### Goals

Phase 1 creates the code-level governance surface: a registry schema, tool registration validation, adapter contract interfaces, runtime trust-level definitions, and candidate type allowlists. It still does not add real OCR/CV runtime code.

### Scope

Add a new namespace such as `lib/assistedEvidenceRuntime/` or `lib/assistedEvidenceSources/` containing registry types, adapter contracts, fixture runner interfaces, validation helpers, and test fixtures. The implementation must depend on `lib/assistedEvidence/` only for candidate creation and types. It must not import canonical survey evidence, engineering intelligence evaluators, CAD readiness, recommendations, workflow orchestration, or database mutation modules.

### Risk Level

Low to moderate. The code introduces integration surfaces but not real probabilistic runtime execution.

### Dependencies

Phase 1 depends on Phase 0 governance decisions and the Assisted Evidence Sandbox V1 candidate/review model.

### Deliverables

Deliverables include `openSourceToolRegistry.ts`, `openSourceToolTypes.ts`, `adapterContracts.ts`, `sourceExecutionGuards.ts`, targeted tests, and an expanded boundary validation script.

### Validation Requirements

Validation must include registry tests, adapter contract tests, boundary script tests, deterministic hashing tests, and the full suite: `npm run check:engineering-boundaries`, `npm run check:topology`, `npm run check:assisted-evidence-boundaries`, `npm run type-check`, `npm test`, `npm run build`, and `npm run lint`.

### Rollback Considerations

Rollback removes the registry namespace and tests. Because no runtime dependencies are added, rollback does not require dependency cleanup.

### Success Criteria

Success means unregistered tools cannot be represented as approved, tools cannot declare canonical mutation, every tool has license metadata and candidate allowlists, and adapter outputs can only become review-required candidates.

## Phase 2 — Fixture-Only Adapter Integration

### Goals

Phase 2 proves the data flow from simulated open-source output into assisted evidence candidates without installing or executing real OCR/CV/image-processing libraries.

### Scope

Create fixture adapters for selected pilot categories. Recommended fixtures include image metadata output and OCR-like text-region output. Fixtures must be deterministic, replayable, and small. They should simulate raw outputs that a future runtime might produce, then normalize them into candidate inputs and mark them review-required.

### Risk Level

Low. No image bytes are processed by runtime libraries; fixture payloads are static test data.

### Dependencies

Phase 2 depends on Phase 1 registry and adapter contracts.

### Deliverables

Deliverables include fixture payloads, fixture adapter implementations, tests proving candidate generation, deterministic replay, confidence clamping, provenance preservation, and review-required enforcement.

### Validation Requirements

Validation must prove that fixture adapter outputs always call `createCandidate()` and `markReviewRequired()`, never direct canonical modules. Tests should confirm rejected candidates create no projections, accepted candidates create reviewed projections only, invalidated candidates cannot project, and hash stability survives key ordering differences.

### Rollback Considerations

Rollback removes fixture adapters and tests. No runtime dependencies are affected.

### Success Criteria

Success means the full candidate-review-projection flow works from simulated open-source output, and all boundaries remain green.

## Phase 3 — Review Queue and Operational Semantics

### Goals

Phase 3 expands review-only operational handling so reviewers can inspect, accept, reject, invalidate, and supersede assisted candidates safely.

### Scope

Build or extend admin UI surfaces to show source references, tool provenance, candidate confidence, limitations, claims, review status, accepted/rejected fields, projection status, and warnings. The UI must not present candidates as facts. It must present them as non-authoritative assistance.

### Risk Level

Moderate, because UI language can create operational misunderstanding even when technical boundaries are intact.

### Dependencies

Phase 3 depends on the existing review-only panel and Phase 2 fixture candidate generation.

### Deliverables

Deliverables include review queue wireframes or UI implementation, review semantics documentation, reviewer action tests if applicable, and updated admin documentation.

### Validation Requirements

Validation must include type-check, tests for review-state semantics, accessibility or render tests where available, and boundary checks confirming no canonical mutation.

### Rollback Considerations

Rollback removes review UI additions while leaving candidate data and backend contracts intact.

### Success Criteria

Success means reviewers can clearly distinguish candidate suggestions from canonical evidence, accepted projections from canonical mutations, and rejected/invalidation outcomes from active evidence.

## Phase 4 — Runtime Containment Harness

### Goals

Phase 4 creates the harness required to execute a real open-source tool safely, but still may use stubbed execution in CI. The harness defines process boundaries, failure handling, timeout handling, input limits, output schemas, and deterministic provenance capture.

### Scope

Add runtime wrapper boundaries, tool execution metadata, timeout policies, file-size limits, output validators, and error normalization. The harness must support disabling runtime execution in CI and falling back to fixture-only tests. This phase may prepare for runtime but should still avoid adding the actual high-risk tool unless explicitly approved.

### Risk Level

Moderate. Even without real OCR/CV libraries, the harness defines how such libraries will execute.

### Dependencies

Phase 4 depends on Phases 1 and 2.

### Deliverables

Deliverables include runtime execution interfaces, error envelope types, sandbox limit configuration, output schema validation, failure metrics, and boundary tests.

### Validation Requirements

Validation must prove runtime failures do not produce canonical mutations, failed tools create either no candidate or a clearly invalidated/error candidate, and all outputs remain review-required.

### Rollback Considerations

Rollback removes runtime harness code and leaves fixture adapters intact.

### Success Criteria

Success means SolarPro can represent safe runtime execution boundaries without executing unapproved OCR/CV/image-processing code.

## Phase 5 — First Runtime Pilot Under Candidate-Only Mode

### Goals

Phase 5 introduces exactly one approved open-source runtime under strict candidate-only mode.

### Scope

The recommended first pilot is image metadata/photo quality extraction. OCR may be considered second. Visual categorization and geometry detection should remain deferred. The pilot must register the tool, pin versions, record license metadata, run through the adapter contract, emit review-required candidates, and produce metrics.

### Risk Level

Moderate for image metadata, moderate-high for OCR, high for visual categorization, and very high for geometry detection.

### Dependencies

Phase 5 depends on explicit approval after Phases 0 through 4.

### Deliverables

Deliverables include the runtime dependency, adapter, tests, validation logs, license report, operational report, and rollback plan.

### Validation Requirements

The full validation suite is mandatory. Additional runtime-specific tests must cover malformed input, empty output, low confidence, timeout, oversized file, unsupported file type, and deterministic provenance.

### Rollback Considerations

Rollback must remove the runtime dependency, lockfile changes, adapter implementation, registry entry, and any runtime-specific tests or scripts. Candidate records already generated in production should be preserved as auditable rejected or invalidated records rather than deleted.

### Success Criteria

Success means the runtime produces useful review-required candidates without any boundary violation, canonical influence, or reviewer confusion.

## Phase 6 — Pilot Evaluation and Metrics Gate

### Goals

Phase 6 evaluates whether the first runtime pilot is operationally useful enough to continue.

### Scope

Collect candidate volume, acceptance rate, rejection rate, false-positive categories, correction rate, boundary violations, runtime failures, review-time reduction, and reviewer usefulness scoring.

### Risk Level

Moderate. The primary risk is over-trusting preliminary metrics.

### Dependencies

Phase 6 depends on candidate-only runtime pilot data from Phase 5.

### Deliverables

Deliverables include a pilot evaluation report, metrics dashboard or export, and go/no-go recommendation.

### Validation Requirements

Validation must confirm metrics are observational only and do not modify canonical logic.

### Rollback Considerations

If the pilot fails, disable the registry entry, reject or invalidate active candidates as appropriate, and remove runtime execution from operational paths.

### Success Criteria

Success means the pilot shows measurable review value, low boundary risk, explainable failure modes, and no canonical contamination.

## Phase 7 — Future Explicit Mapping Design

### Goals

Phase 7 designs the future bridge from reviewed projections to canonical evidence. This phase must not be assumed approved by prior phases.

### Scope

Design a separate mapping layer with explicit human action, mapping provenance, canonical participation status transitions, and rollback/invalidation behavior. This is the earliest point where reviewed projections may be considered for canonical evidence, and only after separate approval.

### Risk Level

High, because this phase begins the path toward canonical truth.

### Dependencies

Phase 7 depends on successful reviewed projection metrics and explicit approval.

### Deliverables

Deliverables include mapping architecture, boundary guard updates, tests, UI review/confirmation flow, and canonical rollback semantics.

### Validation Requirements

Validation must prove no unreviewed candidate can map, no runtime output can map directly, mapping requires a reviewed projection, and every canonical mutation carries reviewer and source provenance.

### Rollback Considerations

Rollback must support removing mapped evidence, invalidating downstream engineering state, and tracing all affected requirements, CAD readiness, recommendations, and workflow items.

### Success Criteria

Success means only explicitly reviewed, explicitly mapped projections can influence canonical evidence, and all downstream effects are traceable and reversible.

## Open-Source Tool Governance Architecture

The governance architecture should define a tool registry where every tool is declared before execution. Registration should include tool id, name, version, package name, source URL, license, license evidence URL, runtime category, runtime trust level, allowed candidate types, output schema version, whether image bytes are processed, whether OCR is performed, whether model weights are required, whether native binaries are required, supported environments, version pinning, dependency isolation notes, deterministic replay support, review requirement, canonical mutation permission, and deprecation status.

Canonical mutation permission must be permanently false for the assisted evidence runtime registry. If a future mapping layer is approved, it should be modeled as a different reviewed mapping component, not as a runtime tool capability.

Approved license posture should prefer MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, and similarly permissive licenses after verification. High-risk or blocked licenses include AGPL, GPL, LGPL when dynamic-linking obligations are unclear, SSPL, Commons Clause, non-commercial licenses, research-only licenses, custom model licenses with field-of-use restrictions, and packages without a verifiable license.

Native binaries should be blocked by default. They may be considered only with explicit approval, reproducible installation steps, platform support documentation, security review, and a rollback plan. Model weights should be blocked by default unless the license, source, checksum, version, and storage policy are approved. Browser runtimes should be blocked from accessing canonical application state. Server runtimes should execute behind wrapper boundaries with file-size, timeout, and output validation limits.

## Adapter Architecture

Adapters should convert raw tool output into deterministic candidate input. They should not know how to mutate canonical evidence. Each adapter should have a stable adapter id, supported tool ids, supported candidate types, input schema, output schema, normalization version, confidence policy, provenance policy, and deterministic hashing policy.

The normalized candidate output should include source file id, source upload key, project id, survey id, candidate type, candidate category, candidate confidence, tool name, tool version, tool run id, tool config hash, source metadata hash, candidate payload, candidate summary, candidate claims, candidate limitations, created timestamp, and provenance. The adapter should sort lists, normalize keys, clamp confidence into an approved range, record limitations, and avoid non-deterministic fields unless explicitly passed as inputs.

OCR adapters should emit text-region or document-text candidates only. Image metadata adapters should emit photo-quality, orientation, or duplicate metadata candidates. Visual categorization adapters should emit possible scene/context candidates only. Future geometry adapters must remain blocked from CAD readiness, engineering calculation, or roof design influence unless future explicit approval creates additional guardrails.

## Execution Boundary Plan

The execution boundary must prevent runtime code and adapters from importing canonical survey evidence modules, engineering requirement modules, CAD readiness modules, recommendation modules, workflow orchestration modules, direct project mutation modules, and engineering calculation systems. Boundary validation should scan import graphs and prohibited symbol usage. Registry enforcement should reject tools that claim canonical authority, omit license metadata, omit candidate allowlists, or fail to require review.

Guardrail failure behavior should be fail-closed. A failed registry validation, adapter output validation, boundary check, runtime timeout, license verification failure, or unsupported file input must prevent candidate promotion. Depending on the failure, the system may record an auditable runtime failure event, but it must not create authoritative evidence.

## Fixture-First Integration Strategy

Fixture-first integration is mandatory. Fixture-only adapters should simulate OCR payloads, image metadata payloads, candidate generation, review acceptance, review rejection, invalidation, supersession, and deterministic replay. Fixtures must be small, deterministic, and source-controlled. The purpose is to prove architecture before runtime dependencies. Runtime packages are allowed only after fixture tests prove that the path into `createCandidate()` and `markReviewRequired()` is stable and that no direct canonical path exists.

## Review Workflow Plan

The review workflow should start with generated candidates in `review_required` status. Reviewers see candidate claims, confidence, source references, tool provenance, limitations, and warnings. Reviewers may accept specific fields, reject the candidate, invalidate the candidate, or supersede it with a newer candidate. Acceptance creates a reviewed projection only. Rejection creates no projection. Invalidation blocks projection. Supersession preserves the original candidate history while linking to replacement candidate ids. Reviewer id, reviewed timestamp, accepted fields, rejected fields, review notes, source candidate hash, and projection hash must be preserved.

The UI must emphasize non-authoritative, assisted-only, human-reviewed, and review-required semantics. Labels such as `AI found`, `detected`, or `verified` should be avoided for unreviewed candidates. Safer labels include `candidate`, `suggested`, `possible`, `requires review`, and `not canonical`.

## Metrics and Observability Plan

The system should track candidate generation volume, candidates per tool, candidates per project/survey, reviewer acceptance rate, reviewer rejection rate, false-positive category, low-confidence category, reviewer correction rate, invalidation rate, supersession rate, boundary violations, runtime failures, timeout rate, unsupported input rate, usefulness scoring, and review-time reduction. Metrics must remain observational and must not influence canonical engineering logic.

## Validation and Test Strategy

Validation must cover deterministic hashing, replay stability, review-required enforcement, registry enforcement, forbidden imports, forbidden mutations, confidence stability, canonical isolation, workflow isolation, CAD isolation, recommendation isolation, and runtime failure behavior. The standard command suite remains mandatory whenever implementation files change: `npm run check:engineering-boundaries`, `npm run check:topology`, `npm run check:assisted-evidence-boundaries`, `npm run type-check`, `npm test`, `npm run build`, and `npm run lint`.

## Initial Pilot Recommendation

The safest first runtime pilot is image metadata/photo quality extraction. It has the lowest semantic risk, the easiest containment boundary, high operational value for survey completeness and review prioritization, and minimal engineering risk because it does not attempt to understand roof geometry, electrical design, or CAD state. OCR is useful but riskier because text can be mistaken for validated field data. Visual categorization is more useful for triage but carries semantic classification risk. Geometry detection is the highest risk and should remain deferred until the system has proven review metrics and explicit mapping safety.

## Future CAD and Engineering Safety Plan

Future geometry extraction, roof interpretation, obstruction detection, CAD assistance, and engineering suggestion systems must remain non-autonomous until separately approved. They must never autonomously create CAD geometry, satisfy engineering requirements, determine structural/electrical feasibility, generate recommendations, create workflow items, trigger regeneration, or mutate canonical evidence without explicit human review and a separately guarded mapping/action layer. Any future CAD assistance must carry source provenance, confidence, limitations, reviewer attribution, invalidation behavior, and downstream impact tracing.
