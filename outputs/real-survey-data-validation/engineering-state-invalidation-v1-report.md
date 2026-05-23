# Engineering State Invalidation v1 Report

## Scope

Engineering State Invalidation v1 adds deterministic stale-state tracking for engineering outputs produced from canonical evidence, requirement evaluations, document provenance, dependency graph nodes, and engineering decision provenance. This layer does not perform autonomous regeneration and does not modify engineering sizing, layout, CAD, or document generation logic. It records which outputs are current or stale, why a state became stale, which deterministic dependency triggered invalidation, and which downstream outputs are impacted.

## State Registry Structures

The new `lib/engineeringStateInvalidation` module defines `EngineeringStateRecord`, `EngineeringStateRegistry`, `EngineeringInvalidationTrigger`, `EngineeringInvalidationEvent`, `EngineeringInvalidationResult`, `SelectiveRegenerationPlan`, `EngineeringStaleStateMetadata`, and `EngineeringInvalidationLineageMetadata`. State records track `stateId`, `stateType`, `stateCategory`, `documentType`, optional `renderContextId`, `dependencyNodeIds`, `requirementIds`, `decisionIds`, `canonicalEvidenceIds`, `originatingSurveyIds`, normalized generation inputs, `generationHash`, `provenanceHash`, `dependencyHash`, stale status, invalidation reason/timestamps, truth source, and deterministic notes.

The registry derives state from document sections, dependency graph nodes, engineering decisions and calculations, render contexts, selected BOM metadata, and selected SLD metadata. Hashes are stable and based only on canonical/provenance/dependency identifiers, not raw upload counts.

## Dependency-Aware Invalidation Engine

`invalidateEngineeringState` accepts explicit deterministic triggers for canonical evidence, requirements, decisions, dependency nodes, provenance hash changes, or generation hash changes. It computes affected state records through direct lineage and bounded graph reachability. Decision and calculation records are invalidated by direct requirement/evidence/decision lineage, while document/render/BOM/SLD/layout outputs can be invalidated by downstream graph propagation. This prevents unrelated decisions from becoming stale through shared render context or broad document-section nodes.

Examples covered by implementation and tests include MSP evidence invalidating conductor sizing, interconnection assumptions, SLD/BOM-linked outputs, and preserving roof-only decisions; utility meter evidence invalidating interconnection/SLD metadata while preserving setback assumptions; and roof overview evidence invalidating layout primitives and geometry-backed outputs.

## Stale-State Detection

Invalidation events expose stale reason, triggering dependency IDs, triggering requirement IDs, triggering decision IDs, triggering canonical evidence IDs, last valid generation hash, last valid provenance hash, invalidation timestamp, and impacted downstream state IDs. `staleMetadataForState` converts records and events into render-safe stale metadata.

## Initial Safe Integrations

The registry is attached in the permit generation flow after document provenance, decision provenance, BOM metadata, and SLD metadata are available. `DocumentProvenanceBundle`, `RenderContext`, and `PermitInput` now carry optional state registry and invalidation lineage metadata. Permit validation exposes registry hashes, stale counts, audit guard results, and a bounded list of state records. Decision-aware readiness, BOM, and SLD metadata now include state IDs and state hashes.

## Audit Guards

`runEngineeringStateAuditGuards` prevents rendering from stale dependencies, regeneration without provenance lineage, regeneration from raw upload inputs, orphaned document sections, decision outputs missing invalidation tracking hashes, and hidden dependency propagation. The guards are deterministic and inspect only state records and invalidation events.

## Validation Status

Final validation completed successfully for this implementation. The focused regression command `npx vitest run lib/engineeringStateInvalidation/engineeringStateInvalidation.test.ts --reporter=verbose` exited `0` with `Test Files 1 passed (1)` and `Tests 6 passed (6)`, covering targeted invalidation, unrelated output preservation, duplicate raw upload stability, stale metadata render survival, deterministic regeneration plans, and stale-lineage audit failures. The TypeScript command `npm run type-check` exited `0`. The production command `npm run build` exited `0`; the build log includes existing runtime-environment warnings for missing `DATABASE_URL`, `JWT_SECRET`, and related optional service variables, but compilation, static page generation, and build finalization completed successfully. The prohibited boundary scan completed with matches only in explicit boundary-confirmation text and deterministic notes stating that autonomous regeneration and CV/OCR/CAD/image-byte logic are not performed; no prohibited runtime implementation was introduced.

Validation artifacts were captured under `outputs/real-survey-data-validation/`: `state-invalidation-focused-tests-final.log`, `state-invalidation-focused-tests-final.exit`, `state-invalidation-typecheck-final.log`, `state-invalidation-typecheck-final.exit`, `state-invalidation-build-final.log`, `state-invalidation-build-final.exit`, `state-invalidation-boundary-scan-final.log`, and `state-invalidation-boundary-scan-final.exit`.

## Boundary Confirmation

No OpenCV, OCR, YOLO, semantic inference, autonomous regeneration, CAD generation, or image-byte inspection logic was added. The invalidation layer is deterministic metadata and planning infrastructure only.
