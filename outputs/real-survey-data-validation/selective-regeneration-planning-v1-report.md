# Selective Regeneration Planning v1 Report

## Scope

Selective Regeneration Planning v1 creates deterministic plans describing what would need regeneration after an engineering state invalidation event. It does not regenerate files, recalculate engineering values, alter sizing logic, or invoke CAD/layout generation. It produces bounded plan metadata from state records, invalidation events, and dependency graph lineage.

## Planning Structures

`SelectiveRegenerationPlan` includes the plan ID, trigger ID, generated timestamp, affected document sections, affected engineering decisions, affected render contexts, affected BOM rows, affected SLD sections, affected layout primitives, blocked regeneration dependencies, regeneration order, unchanged preserved outputs, stale state IDs, deterministic hash, and deterministic notes.

## Regeneration Ordering

Plans sort stale states by explicit state-type precedence: requirement evaluations and dependency graph nodes first, then decisions/calculations, layout primitives, BOM rows, SLD sections, document sections, render contexts, and render outputs. Within each class, stable state IDs determine order. This makes plans deterministic across repeated runs and prevents opportunistic or heuristic ordering.

## Preservation of Unchanged Outputs

The invalidation result separates affected and unaffected state IDs. The plan carries `unchangedPreservedOutputs` directly from unaffected state IDs, proving that unrelated outputs are preserved. Regression coverage verifies unrelated roof-only decisions remain current when MSP or utility-meter evidence changes.

## Blocked Dependencies

Blocked regeneration dependencies are listed when stale state records lack provenance hashes, dependency hashes, or dependency node lineage. This provides a deterministic guardrail against regenerating from incomplete lineage.

## Render and Metadata Survival

Render context integration carries the state registry, invalidation lineage, and stale-state metadata as additive metadata. Decision-aware BOM and SLD metadata include state IDs and dependency/generation hashes so selected downstream outputs can participate in invalidation planning without refactoring all generators.

## Validation Status

Final validation completed successfully for this implementation. The focused regression command `npx vitest run lib/engineeringStateInvalidation/engineeringStateInvalidation.test.ts --reporter=verbose` exited `0` with `Test Files 1 passed (1)` and `Tests 6 passed (6)`. The plan-specific coverage verifies deterministic selective regeneration plans, stable repeated plan hashes, affected layout primitive reporting, blocked lineage audit behavior, and preservation of unchanged outputs. The TypeScript command `npm run type-check` exited `0`. The production command `npm run build` exited `0`; the build log includes existing runtime-environment warnings for missing `DATABASE_URL`, `JWT_SECRET`, and related optional service variables, but compilation, static page generation, and build finalization completed successfully. The prohibited boundary scan completed with matches only in explicit boundary-confirmation text and deterministic notes stating that autonomous regeneration and CV/OCR/CAD/image-byte logic are not performed; no prohibited runtime implementation was introduced.

Validation artifacts were captured under `outputs/real-survey-data-validation/`: `state-invalidation-focused-tests-final.log`, `state-invalidation-focused-tests-final.exit`, `state-invalidation-typecheck-final.log`, `state-invalidation-typecheck-final.exit`, `state-invalidation-build-final.log`, `state-invalidation-build-final.exit`, `state-invalidation-boundary-scan-final.log`, and `state-invalidation-boundary-scan-final.exit`.

## Boundary Confirmation

The planning layer performs no autonomous regeneration and introduces no CV/OCR/YOLO/semantic inference/CAD generation/image-byte runtime logic. It is deterministic dependency-aware planning metadata only.
