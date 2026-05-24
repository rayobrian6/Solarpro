# Native vs OSS Geometry Comparison Report v1

## Purpose

This report summarizes what the isolated `polygon-clipping` comparison adapter revealed when evaluated against native SolarPro geometry behavior and dedicated geometry stress fixtures. The adapter remains non-authoritative. Native SolarPro geometry and readiness logic continue to decide parser status and CAD preview eligibility.

## Native Strengths Confirmed

Native SolarPro logic correctly blocks self-intersecting roof polygons before CAD readiness. The adapter agreed with native self-intersection detection on the bow-tie fixture, which increases confidence that the current native segment-intersection logic is effective for this class of invalid roof geometry.

Native readiness also correctly preserves the difference between parser readiness and CAD preview generation. The broader fixture suite continues to verify that review-required surveys may build preview inputs without being promoted to `cad_preview_ready`, and normalized-only geometry can be canonical-ready while CAD preview remains unavailable.

## OSS Improvements Observed

The adapter improved detection in three important areas.

First, it detected overlapping roof planes through actual polygon intersection area. Native parser/readiness currently does not treat duplicate or overlapping roof planes as a warning or blocking condition when each individual plane is otherwise valid. The adapter found overlap and emitted review-only clipping observations without changing readiness.

Second, it detected duplicate edge/path degradation in a local polygon where native parser has no explicit duplicate-edge authority check today. This is useful because duplicated path segments can hide field-capture mistakes even when a simplistic area or vertex-count check appears acceptable.

Third, it surfaced projected near-zero area topology as an adapter-only integrity degradation. In the stress fixture, native readiness remained `cad_ready` because source area was positive and the tiny floating-point projected area did not trigger native blocking. The adapter used a practical minimum meaningful area threshold and flagged the polygon as invalid for review. This is a useful native hardening signal.

## False Positive Reduction Observed

The adapter reduced a false positive that a coarse native-style bounding-box overlap heuristic would create. In the L-shaped polygon vs corner-gap rectangle test, bounding boxes overlapped, but `polygon-clipping` produced no actual intersection area. The adapter report captured `nativeOverlapExpected: true` and `ossOverlaps: false`, demonstrating value for separating bounding-box proximity from real polygon intersection.

## False Positives and Risks

The adapter can create review noise if its tolerance policy is too aggressive. The new `MIN_MEANINGFUL_AREA_M2` threshold intentionally treats sub-microsquare-meter projected area as invalid, which is appropriate for roof-plane review but must remain configurable or well documented before any broader use. Polygon boolean libraries can also produce unexpected results on malformed rings, repeated vertices, or coordinate precision extremes. Therefore adapter observations should remain warnings, not automatic blocks.

The adapter may also identify overlap between roof planes that is legitimate in unusual survey representations, such as intentionally duplicated source candidates from separate documents. In those cases, the report should prompt human review rather than force readiness downgrade.

## False Negatives and Native-Superior Areas

The adapter does not understand SolarPro domain semantics such as roof pitch, azimuth, setback rules, electrical completeness, system type, enrichment state, CAD preview availability, AHJ/NEC needs, or permit/BOM authority. Native SolarPro logic remains superior for domain readiness and downstream safety.

The adapter also does not inspect obstruction geometry as polygons because the current normalized obstruction model stores position and dimensions rather than polygon rings. Malformed obstruction polygon coverage is therefore represented as a corrupted/missing source-note fixture and should be expanded only after SolarPro defines obstruction polygon DTOs.

## Disagreement Summary

Meaningful disagreements found during this spike include native-ready but adapter-invalid projected near-zero geometry, native-no-warning but adapter-warning overlapping roof planes, native-no-warning but adapter-warning duplicate edges, and bounding-box overlap heuristic positive but adapter polygon-intersection negative. These disagreements are valuable because they identify where native hardening can improve without giving the OSS adapter authority.

## Recommendation

The adapter should remain in the codebase as a comparison-only geometry intelligence boundary. It should not expand into production authority. The next safe expansion would be to wire it into offline fixture replay or a read-only developer/admin report, not into automatic parser readiness decisions. Native SolarPro geometry logic should remain primary and should absorb the lessons through explicit native checks for duplicate roof planes, duplicate edges, practical projected-area thresholds, and review warnings for overlap candidates.
