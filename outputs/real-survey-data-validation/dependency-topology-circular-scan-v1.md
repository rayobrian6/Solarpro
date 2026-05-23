# Dependency Topology Circular Scan v1

## Scan Scope

Repository: `rayobrian6/Solarpro`

Branch: `dependency-topology-stabilization-v1`

Baseline commit: `9cebc3b Fix survey evidence audit regressions`

Command used for both baseline and final scan:

```sh
npx madge --circular --extensions ts,tsx app lib
```

The scan intentionally covers both `app` and `lib` and does not exclude protected architecture directories.

## Baseline Scan Result

Log: `outputs/real-survey-data-validation/dependency-topology-madge-before.log`

Exit: `1` because cycles were present.

Summary:

```text
Processed 820 files (9.2s) (271 warnings)

✖ Found 9 circular dependencies!
```

Baseline cycles:

```text
1) lib/bom-engine-v4.ts > lib/bom-system-profiles.ts
2) lib/cad/adapter.ts > lib/drafting/index.ts > lib/drafting/composers/index.ts
3) lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/fence/fenceCAD.ts
4) lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/ground/groundCAD.ts
5) lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/roof/roofCAD.ts
6) lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts
7) lib/drafting/index.ts > lib/drafting/composers/index.ts
8) lib/survey/evidence/engineeringBridge.ts > lib/survey/evidence/engineeringRequirements.ts > lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts
9) lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts
```

## Cycle Classification

| # | Cycle | Area | Classification | Rationale |
|---|---|---|---|---|
| 1 | `lib/bom-engine-v4.ts > lib/bom-system-profiles.ts` | BOM metadata/profile engine | Medium-risk | Type-contract loop between BOM engine and profile builders could destabilize BOM metadata imports, but did not cross canonical evidence or UI route boundaries. |
| 2 | `lib/cad/adapter.ts > lib/drafting/index.ts > lib/drafting/composers/index.ts` | CAD/drafting render path | High-risk | CAD adapter imported the high-level drafting barrel while drafting composers imported CAD runtime, creating a solver/render coupling loop. |
| 3 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/fence/fenceCAD.ts` | CAD/drafting fence path | High-risk | Fence CAD leaf imported back through drafting types, coupling CAD leaf solvers to render assembly. |
| 4 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/ground/groundCAD.ts` | CAD/drafting ground path | High-risk | Ground CAD leaf imported back through drafting types, coupling CAD leaf solvers to render assembly. |
| 5 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts > lib/cad/roof/roofCAD.ts` | CAD/drafting roof path | High-risk | Roof CAD leaf imported back through drafting types, coupling CAD leaf solvers to render assembly. |
| 6 | `lib/drafting/index.ts > lib/drafting/composers/index.ts > lib/cad/cadEngine.ts` | CAD/drafting engine path | High-risk | CAD engine and drafting composers formed a runtime render/solver loop. |
| 7 | `lib/drafting/index.ts > lib/drafting/composers/index.ts` | Drafting barrel/composer path | High-risk | Drafting composer imported the high-level drafting barrel, making public index and implementation mutually dependent. |
| 8 | `lib/survey/evidence/engineeringBridge.ts > lib/survey/evidence/engineeringRequirements.ts > lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts` | Survey evidence / registry / provenance / hygiene grouping | High-risk | Crossed requirement registry/provenance/session grouping boundaries; could make canonical evidence traceability and hygiene grouping order-dependent. |
| 9 | `lib/survey/evidence/provenance.ts > lib/survey/evidence/sessionGrouping.ts` | Survey evidence provenance/session grouping | High-risk | Provenance depended on the higher-level session grouping builder for DTOs while grouping depends on provenance output. |

No cycle was classified as blocker because the previous full regression baseline was safe and all 4,828 tests passed before this task. The high-risk cycles were nevertheless fixed before new engineering-state/UI work because they touched protected deterministic topology areas.

## Fix Strategy

The cycle-breaking strategy was intentionally narrow:

1. Extract shared type contracts into neutral leaf modules.
2. Keep public type re-exports where callers may depend on existing module APIs.
3. Convert internal CAD/provenance/BOM imports away from high-level barrels.
4. Avoid changing builder logic, solver logic, engineering sizing calculations, or canonical evidence truth semantics.
5. Add a guard script to prevent reintroducing protected topology cycles.

## Fixed Cycles

All 9 baseline cycles were fixed.

### BOM cycle

Introduced `lib/bom-types-v4.ts` with shared BOM stage/system/line item types. Updated `lib/bom-engine-v4.ts` and `lib/bom-system-profiles.ts` to import shared types from that leaf module.

### CAD/drafting cycles

Introduced `lib/drafting/permitInputShape.ts` with the shared `PermitInputShape` type. Updated CAD adapter/engine/roof/ground/fence modules and drafting composers to import this neutral type instead of importing from `lib/drafting/index.ts`.

### Survey evidence/provenance cycles

Introduced `lib/survey/evidence/sessionTypes.ts` with session and duplicate DTOs. Updated `lib/survey/evidence/provenance.ts` and `lib/engineering/surveyEvidence.ts` to import DTOs from the leaf module instead of the higher-level session grouping builder. `ProjectSurveyEvidenceHygieneManifest` remains in `sessionGrouping.ts` because it is a higher-level grouping result that references builder outputs.

## Final Scan Result

Log: `outputs/real-survey-data-validation/dependency-topology-madge-after.log`

Exit: `0`.

Summary:

```text
Processed 823 files (9s) (277 warnings)

✔ No circular dependency found!
```

## Topology Guard Result

Command:

```sh
npm run check:topology
```

Exit: `0`.

Summary:

```text
Dependency topology guard scanned 713 source files.
Circular dependencies: 1
1) [unprotected] lib/utilityDetector.ts > lib/proposalTruthEngine.ts > lib/utilityDetector.ts
Directional architecture warnings: 3
Hard directional violations: 0
Dependency topology guard passed.
```

The custom guard detects one unprotected, unrelated runtime cycle outside the protected stabilization areas. It does not block this task because the required `madge` scan over `app` and `lib` reports no circular dependencies, and the guard's protected-area cycle count and hard upward rendering/UI violation count are both zero.

## Deferred Findings

Three non-blocking directional warnings remain for future cleanup:

```text
1) lib/documentProvenance/builders.ts (document-provenance-bindings) -> lib/engineeringDecisionProvenance/evaluator.ts (engineering-decision-provenance)
2) lib/engineeringDecisionProvenance/evaluator.ts (engineering-decision-provenance) -> lib/engineeringStateInvalidation/hash.ts (state-invalidation-regeneration)
3) lib/survey/evidence/engineeringRequirements.ts (requirement-registry-evaluation) -> lib/survey/evidence/provenance.ts (provenance-traceability)
```

They are acyclic and deterministic after this stabilization. Fixing them would require broader architectural extraction of builder orchestration and shared helper modules, which was intentionally deferred to avoid broad rewrites or behavior changes.

## Validation Cross-Reference

Validation evidence is captured in the following logs:

- `outputs/real-survey-data-validation/dependency-topology-madge-before.log`
- `outputs/real-survey-data-validation/dependency-topology-madge-after.log`
- `outputs/real-survey-data-validation/dependency-topology-guard.log`
- `outputs/real-survey-data-validation/dependency-topology-focused-tests.log`
- `outputs/real-survey-data-validation/dependency-topology-typecheck.log`
- `outputs/real-survey-data-validation/dependency-topology-npm-test.log`
- `outputs/real-survey-data-validation/dependency-topology-build.log`
- `outputs/real-survey-data-validation/dependency-topology-lint.log`
- `outputs/real-survey-data-validation/dependency-topology-prohibited-boundary-scan.log`
