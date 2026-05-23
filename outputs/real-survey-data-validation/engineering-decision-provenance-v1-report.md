# Engineering Decision Provenance v1 Report

Generated: 2026-05-23T10:00:00.000Z

## Scope

Engineering Decision Provenance v1 adds deterministic explainability infrastructure for engineering outputs. It records why deterministic engineering values and assumptions were used, which requirements and canonical evidence influenced them, which governing rules apply, and where fallback/default behavior occurred. This report documents additive provenance infrastructure only; it does not add AI reasoning, semantic inference, OCR, computer vision, CAD generation, image-byte inspection, or new engineering sizing behavior.

## Normalized Structures Added

The new `lib/engineeringDecisionProvenance` module defines `EngineeringDecisionProvenanceRecord` with normalized fields for `decisionId`, `decisionType`, `decisionCategory`, `engineeringDomain`, `selectedValue`, `alternativeValuesConsidered`, `decisionReason`, `decisionInputs`, `requirementIds`, `canonicalEvidenceIds`, `originatingSurveyIds`, `dependencyNodeIds`, `documentSectionIds`, `renderContextIds`, `governingRules`, `equipmentConstraints`, `utilityConstraints`, `geometryAssumptions`, `confidenceSource`, `truthSource`, `derivedFrom`, `deterministicNotes`, and `generatedAt`.

The module also defines `EngineeringDecisionEvaluationBundle`, `EngineeringDecisionDefinition`, `EngineeringDecisionInputRef`, `EngineeringRuleReference`, `EngineeringDecisionAuditGuardResult`, `DecisionAwareReadinessSummary`, `DecisionAwareBOMMetadata`, and `DecisionAwareSLDMetadata`.

## Decision Registry

`decisionRegistry.ts` centralizes deterministic definitions for conductor sizing, breaker sizing, OCPD selection, string topology selection, MPPT assignment, inverter selection, ESS placement, rapid shutdown placement, utility interconnection assumptions, setback assumptions, conduit routing assumptions, grounding/bonding assumptions, placard requirements, layout orientation assumptions, BOM derivation, and SLD metadata. Each registry definition includes governing rule references, engineering dependencies, required inputs, optional inputs, affected document sections, downstream impacts, missing-input behavior, confidence policy, and deterministic evaluation notes.

## Evaluation Engine

`evaluator.ts` builds deterministic decision bundles by walking the registry, selecting existing permit/CAD/system metadata or explicit defaults, linking available Engineering Requirement Registry evaluations, linking canonical evidence IDs and originating survey IDs, generating dependency IDs, sorting records by stable `decisionId`, and computing a deterministic hash. Fallback/default records are explicitly categorized as `fallback_default` and include fallback/default input roles.

## Audit Guards

`guards.ts` adds deterministic audit guards for decision lineage, governing-rule linkage, fallback/default documentation, calculation dependency lineage, and render output decision provenance. Guard failures throw `EngineeringDecisionProvenanceAuditError` via `assertEngineeringDecisionProvenanceGuards()`.

## Integrated Outputs

Decision provenance is now exposed through permit input metadata, survey evidence metadata, document provenance bundles, dependency graphs, render contexts, plan-set render options, permit generation orchestration, VAL-1 validation summary sections, decision-aware readiness summaries, selected BOM row metadata, and selected SLD metadata.

## Tests Added

`lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts` covers lineage retention, deterministic graph decision nodes, explicit fallback/default surfacing, duplicate upload stability, render-context survival, and audit guard failure when lineage is missing.

## Validation Results

- Focused tests: `npx vitest run lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts --reporter=verbose` — PASS, 1 file passed, 6 tests passed.
- Type-check: `npm run type-check` — PASS, exit code 0.
- Build: `npm run build` — PASS, exit code 0.
- Prohibited boundary scan: PASS, runtime exit code 0. Pattern scan found only the pre-existing `generateCADLayout` permit orchestration reference; no new CV/OCR/YOLO/semantic inference/image-byte runtime logic was introduced.

## Boundary Confirmation

No OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, or hallucinated engineering reasoning was introduced by Engineering Decision Provenance v1. The implementation is metadata/provenance infrastructure around existing deterministic inputs and outputs.
