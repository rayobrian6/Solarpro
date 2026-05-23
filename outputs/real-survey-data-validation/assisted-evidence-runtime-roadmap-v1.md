# Assisted Evidence Runtime Roadmap V1

## Purpose

This roadmap translates the Open-Source Assisted Evidence Integration Program V1 into implementable phases and TODOs. The roadmap assumes the existing `lib/assistedEvidence/` sandbox remains the canonical quarantine destination for all open-source-derived metadata. The roadmap does not authorize adding OpenCV, OCR runtime, YOLO, TensorFlow, object detection, segmentation, geometry extraction, autonomous engineering logic, canonical evidence mutation, CAD influence, recommendation influence, or workflow influence in the current planning phase.

## Core Flow to Preserve

```text
open-source runtime or fixture
  -> raw output envelope
  -> adapter normalization
  -> candidate input
  -> createCandidate()
  -> markReviewRequired()
  -> review queue
  -> reviewer decision
  -> reviewed projection only when accepted
```

The forbidden flow remains:

```text
runtime output -> canonical evidence / requirements / CAD / recommendations / workflows
```

## Phase 0 TODO — Governance Baseline

- [ ] Create candidate open-source tool inventory template.
- [ ] Create license intake checklist.
- [ ] Create dependency risk checklist.
- [ ] Select first pilot category.
- [ ] Record why higher-risk categories are deferred.
- [ ] Confirm no runtime dependency is added.
- [ ] Run document integrity checks.

Success criteria: the team can evaluate a candidate tool before adding code or packages.

Rollback: remove planning artifacts.

## Phase 1 TODO — Registry and Contracts

- [ ] Add `lib/assistedEvidenceRuntime/openSourceToolTypes.ts`.
- [ ] Define runtime categories and trust levels.
- [ ] Define tool registration schema.
- [ ] Define registry validator.
- [ ] Define adapter contract interface.
- [ ] Define normalized output envelope.
- [ ] Define runtime failure envelope.
- [ ] Define deterministic replay metadata structure.
- [ ] Add tests for registry rejection cases.
- [ ] Expand `check:assisted-evidence-boundaries` to scan the new runtime namespace.

Success criteria: unsafe or incomplete tool registrations fail closed.

Rollback: remove runtime namespace and tests.

## Phase 2 TODO — Fixture-Only Adapters

- [ ] Add fixture-only image metadata raw payload.
- [ ] Add fixture-only OCR-like raw payload.
- [ ] Add metadata fixture adapter.
- [ ] Add OCR fixture adapter.
- [ ] Normalize fixture output into candidate inputs.
- [ ] Call `createCandidate()` and `markReviewRequired()` only.
- [ ] Add deterministic replay tests.
- [ ] Add confidence normalization tests.
- [ ] Add provenance preservation tests.
- [ ] Add review acceptance/rejection tests.
- [ ] Confirm no runtime image bytes are processed.

Success criteria: simulated open-source output produces review-required candidates and reviewed projections only after reviewer acceptance.

Rollback: remove fixture adapters and tests.

## Phase 3 TODO — Review Queue Operational UX

- [ ] Define review queue states.
- [ ] Define reviewer action model.
- [ ] Display candidate source, tool, version, confidence, claims, limitations, and provenance.
- [ ] Display clear non-authoritative warnings.
- [ ] Support accept selected fields.
- [ ] Support reject candidate.
- [ ] Support invalidate candidate.
- [ ] Support supersede candidate.
- [ ] Display projection-only semantics for accepted candidates.
- [ ] Avoid verified/autonomous language.

Success criteria: reviewers understand candidates are suggestions, not truth.

Rollback: remove UI additions without changing backend candidate records.

## Phase 4 TODO — Runtime Harness Without First Dependency

- [ ] Define runner interface.
- [ ] Define timeout policy.
- [ ] Define file-size policy.
- [ ] Define supported input type policy.
- [ ] Define runtime error envelope.
- [ ] Define malformed output handling.
- [ ] Define output schema validation.
- [ ] Define runtime metrics events.
- [ ] Ensure CI can run fixture mode without runtime dependencies.
- [ ] Add tests proving runtime failures cannot produce canonical mutation.

Success criteria: the application has a safe harness ready for a separately approved first runtime.

Rollback: remove harness code while retaining registry and fixtures.

## Phase 5 TODO — First Runtime Pilot: Image Metadata / Photo Quality

- [ ] Select candidate package after license review.
- [ ] Verify license and source URL.
- [ ] Confirm no unapproved native binary or model weight.
- [ ] Pin exact dependency version.
- [ ] Add registry entry.
- [ ] Add runtime adapter behind harness.
- [ ] Emit only photo quality, orientation, or metadata candidates.
- [ ] Mark every candidate review-required.
- [ ] Add malformed file tests.
- [ ] Add unsupported file tests.
- [ ] Add timeout/failure tests.
- [ ] Add rollback instructions.
- [ ] Generate runtime pilot report and validation logs.

Success criteria: image metadata runtime produces useful candidate-only outputs with no canonical influence.

Rollback: remove dependency, lockfile changes, registry entry, adapter, tests, and operational enablement.

## Phase 6 TODO — OCR Candidate Pilot

- [ ] Reassess after Phase 5 metrics.
- [ ] Select OCR package only after license and runtime review.
- [ ] Decide browser/server execution boundary.
- [ ] Define text redaction policy if needed.
- [ ] Emit only text-region or OCR candidate types.
- [ ] Preserve raw-output summary hash or secure raw output reference.
- [ ] Require field-level reviewer acceptance.
- [ ] Prevent OCR text from satisfying requirements automatically.
- [ ] Add OCR false-positive fixture tests.
- [ ] Add review UI language checks.

Success criteria: OCR accelerates review without becoming validated field data.

Rollback: disable registry entry, remove runtime dependency, preserve/reject/invalidate existing candidates as audit records.

## Phase 7 TODO — Visual Categorization Candidate Pilot

- [ ] Reassess after OCR metrics.
- [ ] Select model/package only after license/model-weight review.
- [ ] Emit possible scene/context candidates only.
- [ ] Avoid deterministic engineering labels such as verified roof, verified MSP, verified obstruction.
- [ ] Add reviewer-bias mitigation in UI.
- [ ] Track false-positive categories.
- [ ] Prevent import into context resolution and recommendations.

Success criteria: visual categorization improves triage without influencing engineering state.

Rollback: disable registry entry and invalidate/reject generated candidates where needed.

## Phase 8 TODO — Future Geometry Constraints Only

- [ ] Do not implement geometry runtime without new approval.
- [ ] Design geometry-specific review overlays.
- [ ] Design uncertainty and measurement provenance model.
- [ ] Design downstream invalidation model.
- [ ] Design CAD isolation validation.
- [ ] Design engineering signoff requirements.
- [ ] Require separate explicit mapping approval.

Success criteria: geometry remains blocked until a future safety architecture exists.

Rollback: not applicable because implementation is blocked in this roadmap.

## Adapter Contract Sketch

A future adapter contract should resemble:

```ts
interface AssistedEvidenceRuntimeAdapter<RawOutput> {
  adapterId: string;
  adapterVersion: string;
  supportedToolIds: string[];
  supportedCandidateTypes: AssistedEvidenceCandidateType[];
  normalize(input: RuntimeAdapterInput<RawOutput>): NormalizedCandidateInput[];
}
```

The adapter should return normalized candidate inputs, not candidates directly unless the calling layer immediately routes through `createCandidate()` and `markReviewRequired()`. This separation allows validation of normalized output before candidate creation.

## Normalization Rules

- Sort arrays by stable keys.
- Stable-stringify objects before hashing.
- Clamp confidence into `0 <= confidence <= 1`.
- Round confidence according to policy, such as four decimal places.
- Preserve limitations.
- Preserve tool id, version, run id, adapter id, and adapter version.
- Include source file id, upload key, project id, and survey id.
- Do not store large raw outputs in candidates unless approved.
- Store raw-output hashes or references for replay.
- Use caller-supplied timestamps for deterministic test replay.

## Runtime Boundary Checklist

- [ ] Runtime namespace does not import canonical survey evidence.
- [ ] Runtime namespace does not import engineering requirement evaluation.
- [ ] Runtime namespace does not import CAD readiness.
- [ ] Runtime namespace does not import recommendation engine.
- [ ] Runtime namespace does not import workflow orchestration.
- [ ] Runtime namespace does not write project state directly.
- [ ] Runtime namespace does not write canonical evidence directly.
- [ ] Runtime namespace emits candidates only.
- [ ] Candidates are non-authoritative.
- [ ] Candidates are review-required.
- [ ] Accepted candidates produce reviewed projections only.

## Validation Expansion Checklist

The existing validation suite must continue:

- [ ] `npm run check:engineering-boundaries`
- [ ] `npm run check:topology`
- [ ] `npm run check:assisted-evidence-boundaries`
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run lint`

Additional future validation should include:

- [ ] Registry rejects missing license metadata.
- [ ] Registry rejects unpinned versions.
- [ ] Registry rejects canonical mutation permission.
- [ ] Registry rejects blocked runtime categories.
- [ ] Registry rejects unapproved native binaries.
- [ ] Registry rejects unapproved model weights.
- [ ] Adapter output schema validation fails closed.
- [ ] Adapter confidence normalization is stable.
- [ ] Adapter replay hash is stable.
- [ ] Runtime failure cannot create canonical evidence.
- [ ] Runtime timeout cannot create canonical evidence.
- [ ] OCR output cannot satisfy requirements.
- [ ] Visual category output cannot influence context resolution directly.
- [ ] Geometry candidates cannot influence CAD readiness.
- [ ] Recommendation and workflow isolation remain intact.

## Metrics Checklist

- [ ] Candidate generation volume.
- [ ] Candidate generation by tool.
- [ ] Candidate generation by candidate type.
- [ ] Reviewer acceptance rate.
- [ ] Reviewer rejection rate.
- [ ] Reviewer correction rate.
- [ ] Invalidated candidate rate.
- [ ] Superseded candidate rate.
- [ ] False-positive category.
- [ ] Low-confidence category.
- [ ] Runtime failure rate.
- [ ] Runtime timeout rate.
- [ ] Unsupported input rate.
- [ ] Boundary violation count.
- [ ] Review-time reduction estimate.
- [ ] Reviewer usefulness score.

## Dependency Intake Checklist

- [ ] Package name.
- [ ] Package version.
- [ ] Source URL.
- [ ] License identifier.
- [ ] License URL.
- [ ] License verification timestamp.
- [ ] License verification owner.
- [ ] Runtime category.
- [ ] Trust level.
- [ ] Native binary status.
- [ ] Model-weight status.
- [ ] Browser/server runtime location.
- [ ] Expected package size.
- [ ] Expected model size if any.
- [ ] Known CVEs or security notes.
- [ ] Maintenance status.
- [ ] Last release date.
- [ ] Supported platforms.
- [ ] Candidate types emitted.
- [ ] Adapter id.
- [ ] Rollback steps.

## Future CAD and Engineering Prohibitions

The following must never become autonomous without future explicit approval:

- roof geometry extraction into CAD geometry.
- obstruction detection into setbacks or design constraints.
- pitch, azimuth, or plane inference into engineering state.
- service equipment recognition into electrical design decisions.
- trench/routing interpretation into workflow or design tasks.
- ESS location interpretation into code compliance decisions.
- requirement satisfaction from OCR or CV output.
- CAD readiness changes from assisted candidates.
- recommendation generation from assisted candidates.
- workflow creation from assisted candidates.
- autonomous regeneration triggered by assisted candidates.

## Immediate Next Implementation Recommendation

The next implementation task after this planning phase should be Phase 1: build the open-source tool registry and adapter contract with tests, still without runtime OCR/CV/image-processing dependencies. Phase 2 should then add fixture-only adapters. Only after those phases pass should SolarPro consider the first runtime pilot, recommended as image metadata/photo quality extraction.
