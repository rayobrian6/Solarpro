# Isolated Geometry OSS Adapter Evaluation v1

## Scope

This report evaluates the isolated `polygon-clipping` geometry adapter spike added for comparison-only topology intelligence. The adapter is observational only. It does not replace SolarPro native geometry logic, does not mutate canonical geometry, does not mutate CAD preview inputs, does not persist geometry authority, does not trigger CAD solving, and does not promote engineering, NEC, BOM, permit, or production CAD authority.

## Implemented Adapter Boundary

The implementation is isolated in:

```text
lib/siteSurvey/geometryComparisonAdapter.ts
```

The module is the only new application module that imports `polygon-clipping`. Parser DTO construction, canonical geometry construction, CAD readiness construction, CAD preview bridging, database functions, API routes, and operator UI are not modified to depend on the adapter. This preserves the adapter as an explicit comparison/reporting layer rather than an authority path.

The report DTO is `GeometryComparisonReportV1` with `mode: comparison_only`. It includes native geometry result metadata, OSS comparison result metadata, topology comparisons, pairwise clipping/intersection comparisons, discrepancy observations, deterministic hashes, execution time, and explicit no-authority flags.

## Capabilities Covered

The adapter currently supports polygon topology comparison, self-intersection verification, duplicate edge/path detection, duplicate vertex detection, polygon validity comparison, pairwise polygon intersection/overlap checks through `polygon-clipping`, clipping/intersection discrepancy observations, and topology confidence degradation warnings. It emits structured observations using the required categories: overlap mismatch, self-intersection disagreement, clipping disagreement, polygon validity disagreement, duplicate edge disagreement, and topology confidence degradation.

## Safety Enforcement

The adapter accepts canonical geometry as input and copies the polygon coordinates before analysis. Tests assert that canonical geometry and CAD readiness JSON remain unchanged after adapter execution. The adapter emits no canonical geometry replacement, no CAD input replacement, and no readiness state replacement. Its authority flags are false for persistence, solver execution, CAD mutation, canonical geometry mutation, engineering authority, NEC authority, BOM authority, permit authority, and downstream authority.

## Package and Bundle Impact

The spike added `polygon-clipping@0.15.7` to the package manifests. Measured installed package footprint in this sandbox was:

```text
868K node_modules/polygon-clipping
136K node_modules/splaytree
340K node_modules/robust-predicates
```

Measured distributed file sizes were:

```text
62557 bytes polygon-clipping.cjs.js
55040 bytes polygon-clipping.esm.js
29106 bytes polygon-clipping.umd.min.js
```

Because the adapter is not imported into client UI code, the expected client bundle impact is zero unless a future phase explicitly imports it into a browser bundle. The current architectural fit is server/test-side comparison reporting or explicit offline review utilities.

## Performance

A sandbox benchmark ran `buildGeometryComparisonReport()` 500 times on a three-roof-plane fixture with pairwise comparisons and one overlapping pair. Observed result:

```text
iterations: 500
totalMs: 258.702
averageMs: 0.5174
last resultHash: 68174403
```

This is acceptable for review/report generation and fixture analysis. It should still remain outside hot interactive rendering loops unless future profiling confirms acceptable behavior at larger roof-plane counts.

## TypeScript Compatibility

`polygon-clipping` ships a declaration file under `dist/polygon-clipping.d.ts`, and the adapter compiles through the project type-check after wrapping package input/output in local SolarPro-owned types. The adapter avoids leaking package-specific types into parser/readiness DTOs.

## Determinism Stability

The adapter computes deterministic `inputHash` and `resultHash` values using stable stringification and excludes timing from the result hash. Tests assert repeated report generation returns the same hashes. Execution time remains present as an observation metric but is intentionally excluded from deterministic report identity.

## Testability

Focused tests were added in:

```text
lib/siteSurvey/geometryComparisonAdapter.test.ts
```

Coverage includes clean geometry determinism, no-authority flags, no mutation of canonical geometry/readiness, overlapping roof-plane detection, native self-intersection agreement, duplicate edge/path degradation, bounding-box false positive reduction through polygon clipping, and projected zero-area topology degradation that native readiness currently does not block.

## Maintainability and Long-Term Fit

The adapter is maintainable if it remains narrow and comparison-only. Its strongest architectural fit is as a geometry intelligence layer that helps SolarPro identify suspicious topology before future CAD/topology phases. Its risk increases if imported directly into parser authority, canonical geometry mutation, CAD generation, or endpoint mutation paths. Future work should keep this module behind an adapter interface and treat all observations as review hints until a separate authority-promotion design exists.

## Evaluation Conclusion

The adapter should remain as a comparison-only spike. It demonstrated meaningful value for overlap detection, duplicate-edge/path degradation, local near-zero area detection, and polygon-clipping-based false-positive reduction compared with a coarse bounding-box heuristic. SolarPro native geometry logic remains primary and should be hardened with lessons from the adapter rather than replaced by it.
