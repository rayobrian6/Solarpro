# Engineering Dependency Graph v1 Report

## Scope

Engineering Dependency Graph v1 is a deterministic mapping graph that links engineering requirements, canonical evidence, document sections, SLD sections, BOM/document placeholders, CAD/layout primitives, render contexts, and engineering assumptions. It is not an AI reasoning system and does not perform CV, OCR, YOLO, semantic inference, image-byte inspection, perceptual hashing, CAD generation, geometry extraction, or engineering sizing changes.

## Structures added

`EngineeringDependencyGraph` contains `graphId`, `generatedAt`, sorted `nodes`, sorted `edges`, a deterministic hash, and deterministic notes. Nodes and edges are keyed by stable ids and sorted before hashing. This makes repeated builds over the same registry/provenance/document inputs produce the same graph hash.

`EngineeringDependencyNode` supports node types for `engineering_requirement`, `canonical_evidence`, `permit_section`, `sld_section`, `bom_row`, `cad_layout_primitive`, `render_context`, and `engineering_assumption`. The current integration emits requirement nodes, canonical evidence nodes, document/SLD/permit section nodes from bindings, render-context nodes, and CAD/layout primitive wrapper nodes.

`EngineeringDependencyEdge` supports deterministic relationships such as `satisfies_requirement`, `binds_requirement_to_document`, `feeds_render_context`, `supports_geometry_assumption`, `supports_electrical_assumption`, `supports_structural_assumption`, and `documents_missing_requirement`.

## Deterministic graph construction

`buildEngineeringDependencyGraph()` consumes registry evaluations, canonical evidence ids, section-level document provenance, optional CAD model primitives, and render-context metadata. It produces stable graph nodes and edges by:

1. Creating one requirement node for every registry evaluation.
2. Creating canonical evidence nodes for de-duplicated canonical ids only.
3. Linking canonical evidence to the requirements it satisfies.
4. Creating document section nodes from requirement-document bindings.
5. Linking requirements to the sections that render or document them.
6. Creating evidence-backed geometry wrapper nodes when deterministic evidence and CAD primitives are available.
7. Creating a render-context node that carries provenance metadata across rendering.
8. Sorting all nodes and edges before computing a deterministic hash.

Duplicate raw uploads are represented through provenance records and duplicate group sizes, not through additional evidence nodes. This preserves the canonical evidence truth boundary.

## EvidenceBackedGeometryInput

`EvidenceBackedGeometryInput` wraps future geometry inputs with provenance metadata. It links roof/site evidence, electrical equipment evidence, structural access evidence, and CAD primitive ids without extracting geometry or generating CAD. Current wrappers include `geometry:roof-layout-context`, `geometry:electrical-equipment-context`, `geometry:structural-access-context`, and `geometry:cad-model-summary` when supported by available registry evaluations and CAD data.

The wrapper records linked requirement ids, canonical evidence ids, originating survey ids, CAD primitive ids, render context ids, truth source, and deterministic notes. It is designed as the future boundary between canonical evidence and CAD/layout assumptions, while explicitly avoiding geometry hallucination and image-byte logic.

## Current document dependency coverage

The graph currently covers permit package provenance, permit validation, electrical/interconnection sections, utility meter sections, roof/site/layout verification sections, structural review sections, ESS location context, inactive future requirement flags, SLD placeholder bindings, render contexts, and CAD primitive wrappers. BOM rows, standalone SLD route internals, standalone plan-set route internals, engineering report paragraphs, and proposal sections are not fully integrated yet. Their node types are defined so future deterministic integrations can bind rows/sections to requirement ids and canonical evidence without changing the graph contract.

## Auditability outcomes

The dependency graph gives downstream systems a stable way to answer which canonical evidence satisfied a requirement, which document sections are bound to that requirement, which sections carry missing/informational status, which CAD/layout wrappers are linked as provenance metadata, and whether render contexts preserved the graph. The deterministic hash provides a compact regression signal for ordering and graph stability.

## Validation status

Focused regression tests passed with `1 passed` test file and `6 passed` tests using `npx vitest run lib/documentProvenance/documentProvenance.test.ts --reporter=verbose` with exit code `0`. `npm run type-check` passed with exit code `0`. `npm run build` passed with exit code `0`. The prohibited-boundary scan found no runtime implementation of OpenCV, OCR, YOLO, semantic inference, CAD generation, image-byte inspection, perceptual hashing, geometry hallucination, or engineering sizing changes. Remaining matches were explicit report/todo boundary-confirmation language only.
