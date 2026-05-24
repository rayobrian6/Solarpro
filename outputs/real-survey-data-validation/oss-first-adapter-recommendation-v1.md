# First OSS Adapter Recommendation v1 — Isolated Geometry Predicate/Topology Cross-Check

## Recommendation

The first safe OSS adapter candidate should be a narrow, non-authoritative geometry predicate/topology cross-check adapter using `polygon-clipping` as the preferred candidate package. This recommendation does not integrate `polygon-clipping` and does not add it to the production dependency graph. It only recommends the shape and safety criteria for a future adapter spike.

The proposed adapter should be named along the lines of `GeometryTopologyReviewAdapter` or `GeometryPredicateAdapter`. Its purpose should be limited to review-only polygon checks and deterministic fixture comparisons, such as detecting overlap/intersection behavior, validating obstruction subtraction experiments, and cross-checking SolarPro’s native polygon validity logic against an independent implementation. The adapter must never become SolarPro geometry authority.

## Why This Is the First Candidate

The expanded professional survey fixtures uncovered the highest-value near-term parser risks in local polygon and readiness behavior: self-intersecting roof polygons must block, zero-area or unusable roof polygons must block, duplicate roof planes are currently retained without de-duplication or warning, mixed area unit strings can normalize to zero and block, and normalized-only geometry can be canonical-ready while still lacking an enriched CAD preview. These are geometry-readiness and operator-review problems, not drawing-export, OCR, computer vision, or spatial-indexing problems.

`polygon-clipping` is a better first candidate than broader geometry frameworks because it is focused on polygon boolean operations, has an MIT license, is JavaScript/Node suitable, and can be wrapped behind a small interface. It is also safer than adopting a monolithic CAD or solar design framework because it does not define SolarPro’s domain model, does not solve CAD, and does not require production geometry authority if used only as a review utility.

## Required Adapter Boundary

A future adapter spike should accept only SolarPro-owned DTOs or simple local polygon arrays derived from SolarPro-owned DTOs. It should emit a versioned, non-authoritative result object. It should include deterministic input and output hashes. It should avoid database writes, CAD solver calls, CAD mutations, engineering calculations, BOM calculations, permit package writes, and canonical geometry persistence.

A suitable result object would contain fields such as `schemaVersion`, `adapterName`, `adapterVersion`, `sourceGeometryHash`, `inputHash`, `resultHash`, `checks`, `warnings`, `blockingSuggestions`, and `authorityFlags`. The authority flags must be false for persistence, solver execution, CAD mutation, canonical geometry mutation, engineering authority, NEC authority, BOM authority, permit authority, and downstream authority.

The adapter should report suggestions, not truth. For example, it may return `possibleSelfIntersection`, `possibleOverlap`, `possibleInvalidRing`, or `booleanOperationFailed`, but SolarPro’s existing parser/readiness pipeline must decide whether a survey is blocked, review-required, geometry-ready, or CAD-preview-ready.

## Minimum Acceptance Criteria Before Integration

A future implementation should only proceed if all of the following are true. The package license remains MIT or otherwise approved by legal/compliance review. The adapter is isolated in a small module with no UI, endpoint, database, or CAD mutation side effects. The adapter is optional and can be disabled without breaking parser readiness. The parser’s current native checks remain in place and continue to be tested. The adapter outputs are labeled preview-only, parser-derived, and non-authoritative. The adapter has deterministic hash tests and fixture coverage for clean rectangles, bow-tie polygons, duplicate/overlapping roof planes, holes if supported, obstruction subtraction candidates, zero-area polygons, tiny polygons, reversed winding, and malformed coordinates. The adapter must not promote any survey to `cad_preview_ready`; it can only add review context or warnings. Type-check and focused parser/readiness tests must remain clean.

## Explicit Non-Goals

This adapter must not replace SolarPro geometry authority. It must not repair canonical roof geometry and persist the repaired result. It must not mutate production CAD. It must not trigger `buildCADFromSurvey` or any future CAD solver. It must not compute engineering, NEC, BOM, utility, interconnection, or permit authority. It must not import a broad CAD framework. It must not run in an operator endpoint unless the endpoint remains GET-only/read-only and returns preview metadata only.

## Rejected First-Adapter Alternatives

`@turf/turf` is useful but should not be the first adapter because it is geospatial/GeoJSON-oriented and may blur local roof-plane XY semantics with geodesic map semantics. It remains a later candidate for map-facing measurements and geospatial helpers.

`jsts` is technically powerful but is not the first candidate because of EDL/EPL licensing complexity and a broader geometry API surface. It should receive legal review before any production consideration.

`rbush` and `flatbush` are low-risk spatial indexing utilities but should wait until snapping, obstruction lookup, or viewport query requirements are concrete.

`dxf-writer`, `svg-pathdata`, and `makerjs` should wait for a drawing-preview/export phase. They do not directly address parser-readiness gaps.

`tesseract.js`, `sharp`, and `opencv.js` belong to OCR/CV/document phases. Existing `sharp`, `tesseract.js`, and `pdf-parse` should be wrapped and provenance-tested before adding heavier CV workflows. `opencv.js` should remain rejected for core parser/app use until an out-of-process worker plan exists.

## Next Phase Recommendation

The next phase should integrate only a test-scoped or preview-only `GeometryPredicateAdapter` spike if the team accepts the above boundaries. The adapter should start in tests and offline fixture analysis, not in the operator endpoint. If the team prefers to avoid new OSS immediately, the safer alternative is native hardening: add duplicate roof-plane detection, explicit missing pitch/azimuth provenance warnings before normalization defaults erase the distinction, structured mixed-unit parsing, utility/provider evidence fields, and panel-count conflict detection from notes/documents.

The recommended path is to do one small geometry adapter spike in parallel with native hardening, but keep native SolarPro checks authoritative until adapter results demonstrate clear, deterministic value across the expanded fixture set.
