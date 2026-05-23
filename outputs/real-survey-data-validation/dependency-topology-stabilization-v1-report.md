# Dependency Topology Stabilization v1 Report

## Executive Summary

Dependency topology stabilization was completed on branch `dependency-topology-stabilization-v1` from safe baseline commit `9cebc3b` (`Fix survey evidence audit regressions`). Work was intentionally limited to surgical dependency-boundary changes. No engineering sizing calculations, canonical evidence truth behavior, CAD solver logic, CV/OCR/image-byte/AI runtime logic, or feature behavior were changed.

The baseline `madge` scan found 9 circular dependencies across BOM, CAD/drafting, and survey evidence/provenance modules. After moving shared DTO/type contracts into neutral leaf modules and tightening a small set of internal runtime imports away from high-level barrels, the final `madge` scan reports `No circular dependency found!` across `app` and `lib`.

A topology guard was added as `scripts/check-dependency-topology.js` and exposed through `npm run check:topology`. The guard scans static runtime import/export/require edges under `app` and `lib`, fails protected-area circular dependencies, and fails hard upward imports from lower-level architecture layers into rendering/UI route layers. It also reports non-blocking directional warnings for known architectural seams that remain deterministic and acyclic.

## Directional Architecture Rule

The stabilized directional architecture rule is:

`survey ingestion/history → canonical evidence → requirement registry/evaluation → provenance/traceability → document provenance/bindings → engineering decision provenance → state invalidation/regeneration planning → render context/document rendering → UI/routes`.

The intended invariant is that lower-level modules do not import higher-level rendering, UI, or route code. Shared DTOs and type contracts that cross layer boundaries should live in leaf modules or be imported with type-only syntax. Runtime builders should import concrete lower-level modules instead of high-level barrels when the barrel also re-exports upward dependencies.

## Cycles Found and Classification

| # | Baseline cycle | Risk | Resolution |
|---|---|---|---|
| 1 | `lib/bom-engine-v4.ts > lib/bom-system-profiles.ts` | Medium-risk | Fixed by moving `BOMStageId`, `BOMLineItemV4`, and `BOMSystemType` into neutral `lib/bom-types-v4.ts`; public re-exports preserved. |
| 2 | `lib/cad/adapter.ts > lib/drafting/index.ts > lib/drafting/composers/index.ts` | High-risk | Fixed by moving `PermitInputShape` into neutral `lib/drafting/permitInputShape.ts`; CAD imports no longer reference the drafting barrel. |
| 3 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/fence/fenceCAD.ts` | High-risk | Fixed by redirecting CAD/fence type imports to `permitInputShape.ts`. |
| 4 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/ground/groundCAD.ts` | High-risk | Fixed by redirecting CAD/ground type imports to `permitInputShape.ts`. |
| 5 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/roof/roofCAD.ts` | High-risk | Fixed by redirecting CAD/roof type imports to `permitInputShape.ts`. |
| 6 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts` | High-risk | Fixed by removing CAD engine dependency on high-level drafting barrel type export. |
| 7 | `lib/drafting/index.ts > lib/drafting/composers/index.ts` | High-risk | Fixed by making drafting composers import `PermitInputShape` from the neutral leaf module instead of the high-level drafting index. |
| 8 | `lib/survey/evidence/engineeringBridge.ts > lib/survey/evidence/engineeringRequirements.ts > lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts` | High-risk | Fixed by moving shared session/duplicate DTOs into `lib/survey/evidence/sessionTypes.ts`; provenance no longer imports the higher-level session grouping builder. |
| 9 | `lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts` | High-risk | Fixed by the same `sessionTypes.ts` leaf DTO extraction. |

No blockers remain from the baseline cycle set. The high-risk classification was applied to cycles that crossed CAD/drafting execution boundaries or survey evidence/provenance/requirement boundaries because those layers directly affect deterministic render context, document provenance, and canonical evidence traceability. The BOM cycle was medium-risk because it was a type-contract loop between BOM profile and engine modules, not a canonical evidence or rendering truth boundary, but it was still fixed.

## Surgical Fixes Applied

### Neutral leaf type modules

Three neutral leaf modules were introduced:

- `lib/bom-types-v4.ts` for BOM V4 shared stage, line item, and system type contracts.
- `lib/drafting/permitInputShape.ts` for the CAD/drafting shared `PermitInputShape` contract.
- `lib/survey/evidence/sessionTypes.ts` for survey session and duplicate DTO contracts shared between provenance and session grouping.

Existing public API compatibility was preserved by re-exporting moved types from prior public modules where appropriate.

### Import boundary cleanup

CAD modules now import `PermitInputShape` from the neutral leaf module rather than `lib/drafting/index.ts`. Survey provenance imports session DTOs from `sessionTypes.ts`. BOM engine/profile modules import shared BOM contracts from `bom-types-v4.ts`.

A small set of internal runtime imports was also narrowed away from high-level barrels:

- `lib/documentProvenance/builders.ts` imports the engineering decision builder from `lib/engineeringDecisionProvenance/evaluator.ts` and its DTO from `lib/engineeringDecisionProvenance/types.ts`.
- `lib/engineering/surveyEvidence.ts` imports document/decision builders from concrete builder/evaluator modules and DTOs from type modules.
- `lib/engineeringDecisionProvenance/evaluator.ts` imports document provenance DTOs from `lib/documentProvenance/types.ts`.
- `lib/engineeringDecisionProvenance/types.ts` imports stale state DTOs from `lib/engineeringStateInvalidation/types.ts` and document truth DTOs from `lib/documentProvenance/types.ts`.

These import changes reduce runtime barrel coupling while preserving behavior.

## Topology Guard Added

Added `scripts/check-dependency-topology.js` and package script:

```json
"check:topology": "node scripts/check-dependency-topology.js"
```

Guard behavior:

- Scans source files under `app` and `lib`.
- Resolves relative and `@/` imports to local files.
- Tracks static runtime import/export/require edges while avoiding TypeScript type-only imports and test files.
- Detects circular dependencies.
- Fails any cycle touching protected areas: survey evidence, engineering survey evidence, requirement/provenance/document provenance, engineering decision provenance, state invalidation, permit/drafting/rendering, CAD, and key engineering/project route surfaces.
- Fails hard upward imports from lower-level architecture layers into rendering/UI route layers.
- Reports non-blocking directional warnings for deterministic, acyclic seams that should be addressed in a future architecture cleanup.

Final guard result:

```text
Dependency topology guard scanned 713 source files.
Circular dependencies: 1
1) [unprotected] lib/utilityDetector.ts > lib/proposalTruthEngine.ts > lib/utilityDetector.ts
Directional architecture warnings: 3
Hard directional violations: 0
Dependency topology guard passed.
```

The remaining cycle is outside the protected stabilization scope and is not part of survey evidence, registry, provenance, document rendering, state invalidation, CAD/drafting, or project route topology.

## Deferred / Non-blocking Issues

The topology guard reports three directional warnings, all acyclic after the stabilization fixes:

1. `lib/documentProvenance/builders.ts` imports `lib/engineeringDecisionProvenance/evaluator.ts`.
2. `lib/engineeringDecisionProvenance/evaluator.ts` imports `lib/engineeringStateInvalidation/hash.ts`.
3. `lib/survey/evidence/engineeringRequirements.ts` imports `lib/survey/evidence/provenance.ts`.

These are not circular blockers after the import cleanup and are preserved to avoid broad rewrites or behavior changes. They should be considered candidates for future architectural split work if the team wants strict one-way layering across all provenance/state modules, for example by moving shared hash helpers or traceability DTOs into lower neutral leaf modules.

The prohibited-boundary scan still reports existing textual hits for documented future-only OCR/CV/CAD capability flags, `revision` strings, existing CAD solver names, and tests proving vision/CV is not executed. No new CV/OCR/CAD/image-byte/AI runtime logic was added.

## Validation Results

| Validation | Command | Result |
|---|---|---|
| Baseline circular scan | `npx madge --circular --extensions ts,tsx app lib` | Exit `1`; 9 circular dependencies found; expected baseline failure. |
| Final circular scan | `npx madge --circular --extensions ts,tsx app lib` | Exit `0`; processed 823 files; no circular dependency found. |
| Topology guard | `npm run check:topology` | Exit `0`; protected cycles 0; hard directional violations 0. |
| Focused tests | `npx vitest run lib/survey/evidence/sessionGrouping.test.ts lib/survey/evidence/engineeringRequirements.test.ts lib/engineering/surveyEvidence.test.ts lib/bom-master-task.test.ts lib/permit/permit-bom-integration.test.ts lib/system/bomIntegration.test.ts` | Exit `0`; 5 files, 47 tests passed. |
| Type-check | `npm run type-check` | Exit `0`. |
| Full tests | `npm test` | Exit `0`; 140 files, 4,828 tests passed. |
| Build | `npm run build` | Exit `0`; compiled successfully. Known missing runtime env warnings for `DATABASE_URL` and `JWT_SECRET` were emitted but build continued and succeeded. |
| Lint | `npm run lint` | Exit `0`; existing `no-console` warnings emitted, no lint failure. |
| Prohibited-boundary scan | `bash scripts/full-system-regression-audit-scans.sh` | Exit `0`; review hits documented above. |

## Files Changed

Source and config changes:

- `lib/bom-engine-v4.ts`
- `lib/bom-system-profiles.ts`
- `lib/bom-types-v4.ts`
- `lib/cad/adapter.ts`
- `lib/cad/cadEngine.ts`
- `lib/cad/fence/fenceCAD.ts`
- `lib/cad/ground/groundCAD.ts`
- `lib/cad/roof/roofCAD.ts`
- `lib/documentProvenance/builders.ts`
- `lib/drafting/composers/index.ts`
- `lib/drafting/index.ts`
- `lib/drafting/permitInputShape.ts`
- `lib/engineering/surveyEvidence.ts`
- `lib/engineeringDecisionProvenance/evaluator.ts`
- `lib/engineeringDecisionProvenance/types.ts`
- `lib/survey/evidence/provenance.ts`
- `lib/survey/evidence/sessionGrouping.ts`
- `lib/survey/evidence/sessionTypes.ts`
- `package.json`
- `scripts/check-dependency-topology.js`
- `todo.md`

Required reports:

- `outputs/real-survey-data-validation/dependency-topology-stabilization-v1-report.md`
- `outputs/real-survey-data-validation/dependency-topology-circular-scan-v1.md`

## Safety Status

`dev` baseline `9cebc3b` remains safe for the audited scope, and the stabilization branch is safe to review/merge for dependency topology stabilization. All original `madge` cycles were removed, validation passed, and no prohibited runtime feature work was added.
