# OSS Infrastructure Audit v1 — Geometry, CAD, OCR, CV, Spatial, DXF/SVG, Snapping

## Audit Scope

This audit evaluates open-source infrastructure that may support future SolarPro geometry, CAD, OCR, computer vision, spatial indexing, DXF/SVG, and snapping/constraint phases. This is an audit only. No new OSS library was integrated into the production path during this phase.

SolarPro remains the orchestration authority, engineering authority, geometry authority, readiness authority, and validation authority. OSS packages should be treated as isolated utilities behind adapters, never as replacement authorities or monolithic CAD systems.

## Current SolarPro Package Surface

The current project already includes several relevant packages: `sharp` for image processing, `tesseract.js` for OCR, `three` for 3D visualization primitives, `cesium` for geospatial/3D map capabilities, `pdf-parse` for PDF text extraction, and `geotiff` for raster/geospatial input handling. This means the first future phases should prefer adapter hardening around existing dependencies before adding heavy new libraries.

## Candidate Categories and Findings

### 1. Polygon Boolean Operations and Geometry Normalization

`polygon-clipping` is an MIT-licensed JavaScript package for polygon and multipolygon boolean operations including intersection, union, difference, and xor. It is a strong candidate for a future isolated polygon boolean adapter because it is focused, Node-compatible, and avoids a monolithic CAD dependency. Recommended use is limited to deterministic preview utilities such as polygon clipping, obstacle subtraction experiments, and fixture-tested geometry normalization. It should not become geometry authority without a SolarPro validation layer.

`martinez-polygon-clipping` is also MIT-licensed and implements Martinez polygon clipping. It may be useful as a cross-check or fallback candidate, but the package version is older than `polygon-clipping`, so it should be treated as a secondary option unless benchmarks and maintenance review justify adoption.

`jsts` provides spatial predicates and geometry processing in JavaScript under EDL/EPL licensing. It is broader and potentially useful for validation predicates, topology operations, and GeoJSON-like geometry reasoning. Its license is more complex than MIT/Apache packages and should receive legal review before production use. Recommended use is experimental/offline adapter only until license and bundle-size implications are reviewed.

`@turf/turf` is MIT-licensed and widely used for GeoJSON geospatial operations. It fits well for geospatial measurement, buffers, point-in-polygon checks, and map-facing utility calculations. Turf should be used for geospatial helper operations, not CAD authority or roof-plane canonicalization authority.

### 2. Spatial Indexing

`rbush` is MIT-licensed and provides a high-performance R-tree index for rectangles. It is a strong fit for future obstruction lookup, roof-plane bounding-box queries, snapping candidate search, and viewport-level spatial filtering.

`flatbush` is ISC-licensed and provides a fast static spatial index. It is useful when geometry is built once and queried many times, such as a frozen preview artifact or review-session geometry cache. It should be wrapped behind the same `SpatialIndexAdapter` interface as `rbush` so SolarPro can switch implementations by workload.

### 3. DXF/SVG/CAD Preview Tooling

`makerjs` is Apache-2.0 licensed and generates parametric 2D line drawings for CNC/laser workflows. It can export drawings and may be useful for future 2D preview artifacts or engineering review diagrams. However, it should not become the production CAD engine. Recommended boundary: a `DrawingPreviewAdapter` that accepts SolarPro-owned canonical review geometry and emits non-authoritative SVG/DXF preview artifacts.

`dxf-writer` is MIT-licensed and describes itself as a simple 2D DXF writer. It is a good candidate for minimal DXF export of review geometry, especially if SolarPro only needs line/polyline/layer export for human review. It should be easier to isolate than a full CAD framework.

`svg-pathdata` is MIT-licensed and can parse/manipulate SVG path data. It is useful for SVG import/export cleanup and path normalization, but should be treated as a file-format utility rather than geometry truth.

Large CAD systems such as FreeCAD/OpenCascade-style workflows should remain out-of-process worker candidates only. They are powerful but introduce heavy runtime, deployment, and authority risks. SolarPro should not adopt a monolithic CAD framework in the Next.js app runtime.

### 4. OCR and Document Parsing

`tesseract.js` is already present and Apache-2.0 licensed. It is a good fit for client/server OCR experiments on labels, panel stickers, meter data, and document images. Recommended boundary: `OCRExtractionAdapter` that emits low-confidence evidence candidates requiring human review. OCR output must never directly satisfy engineering requirements without evidence confidence rules and reviewer traceability.

`pdf-parse` is already present and useful for text extraction from uploaded PDFs. For production document parsing, SolarPro should maintain deterministic extraction logs, source hashes, and page-level provenance.

### 5. Computer Vision and Image Processing

`sharp` is already present and Apache-2.0 licensed. It is the safest first layer for image resizing, EXIF-aware transformations, thumbnail generation, and deterministic preprocessing before OCR/CV workers.

`opencv.js` is BSD-3-Clause licensed and may support future browser/server image processing experiments. It should be isolated due to bundle/runtime size and should not be placed directly in core survey parsing. Recommended boundary: external worker or optional CV preprocessing adapter that emits review-only features such as edges, contours, blur metrics, or candidate roof outline hints.

YOLO, segmentation, and roof extraction models should remain separate model-worker integrations with versioned model metadata, reproducibility controls, and human review. Model output should be evidence suggestions, not geometry authority.

### 6. Snapping and Constraint Systems

No single package should be adopted as a SolarPro constraint authority in this phase. Future snapping should likely begin with small SolarPro-owned primitives: point-to-segment distance, angular snapping, grid snapping, nearest-neighbor lookup via `rbush`/`flatbush`, and deterministic tolerance policies. External packages can assist with indexing or primitive geometry math, but SolarPro should own the constraint semantics.

## Recommended Adapter Boundaries

Future OSS integrations should use narrow adapters:

- `GeometryBooleanAdapter` for clipping/union/difference experiments.
- `GeometryPredicateAdapter` for self-intersection, containment, and validity cross-checks.
- `SpatialIndexAdapter` for nearest-neighbor and bounding-box lookup.
- `DrawingPreviewAdapter` for SVG/DXF review artifact generation.
- `OCRExtractionAdapter` for text candidates with page/photo provenance.
- `CVPreprocessingAdapter` for image features, contours, and quality signals.
- `SnappingCandidateAdapter` for review-only snap suggestions.

Each adapter should accept SolarPro-owned DTOs, emit versioned non-authoritative artifacts, include deterministic input/output hashes, and remain covered by fixtures and golden-output tests.

## License Safety Notes

MIT, Apache-2.0, BSD-3-Clause, and ISC candidates are generally lower friction for commercial SaaS usage, subject to standard notice compliance. `jsts` uses EDL/EPL licensing and should receive legal review before production integration. Any native, GPL, AGPL, or server-process dependency should be rejected or isolated pending legal approval.

## Maintenance and Integration Risk

Low-to-moderate risk candidates for future adapter spikes are `polygon-clipping`, `@turf/turf`, `rbush`, `flatbush`, `dxf-writer`, `svg-pathdata`, and existing `sharp`/`tesseract.js`. Moderate-risk candidates include `makerjs` because it can encourage CAD-like coupling if not kept to preview export, and `opencv.js` because of runtime/bundle complexity. Higher-risk candidates include broad CAD kernels and model-driven roof extraction stacks unless isolated out-of-process with strong review controls.

## Recommended Future Phasing

Phase A should harden existing `sharp`, `tesseract.js`, `pdf-parse`, and parser DTO provenance for review-only document/photo extraction. Phase B should add a tiny `GeometryPredicateAdapter` spike using `polygon-clipping` or `@turf/turf` only in tests and preview utilities. Phase C should add `SpatialIndexAdapter` benchmarks using `rbush` or `flatbush`. Phase D can evaluate `dxf-writer` or `makerjs` for non-authoritative drawing export. Phase E can evaluate OpenCV/model workers out-of-process for roof outline suggestions.

No future phase should promote OSS output to engineering, NEC, BOM, permit, production CAD, or canonical geometry authority without a dedicated authority-promotion design.
