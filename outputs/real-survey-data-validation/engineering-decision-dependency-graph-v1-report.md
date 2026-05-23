# Engineering Decision Dependency Graph v1 Report

Generated: 2026-05-23T10:00:00.000Z

## Scope

Engineering Decision Dependency Graph v1 extends the existing deterministic `EngineeringDependencyGraph` so engineering decisions become first-class graph nodes connected to requirements, canonical evidence, calculations, document sections, BOM-related outputs, SLD-related outputs, CAD/layout metadata wrappers, render contexts, and render outputs.

## Node Integration

`EngineeringDependencyNodeType` now supports engineering decision, calculation, and render output style provenance nodes. Decision records with calculation categories are emitted as calculation nodes; all other decision records are emitted as engineering decision nodes. Existing requirement, canonical evidence, document section, geometry wrapper, and render context nodes remain deterministic and sorted.

## Edge Integration

Decision graph edges include `decision_uses_requirement`, `decision_uses_evidence`, `decision_feeds_document`, `decision_feeds_bom`, `decision_feeds_sld`, and `decision_feeds_render_output`. These edges explain which requirements and evidence influenced each decision and which downstream sections or render contexts carry the decision provenance.

## Placeholder Section Completeness

When a decision references a stable output section that is not already emitted by the requirement-document binding registry, the graph creates a deterministic decision-linked `documentSection:*` node before adding edges. This prevents graph edges from pointing to absent BOM, SLD, ESS, or metadata section nodes.

## Determinism

Nodes and edges are sorted by stable IDs before hashing. Decision bundles sort records by stable decision ID and dependency graph hashes are generated from stable node and edge fields. Duplicate raw upload counts do not feed the graph hash; canonical evidence IDs and registry evaluations remain the evidence truth boundary.

## Focused Test Coverage

The dedicated decision provenance suite asserts that graph hashes are deterministic across identical inputs, decision nodes such as `decision:conductor_sizing` are present, decision-linked output nodes such as `documentSection:BOM.equipment-schedule` are present, and decision requirement/render edges are emitted.

## Validation Results

- Focused graph test: included in `npx vitest run lib/engineeringDecisionProvenance/engineeringDecisionProvenance.test.ts --reporter=verbose` — PASS, graph determinism and decision node assertions passed.
- Type-check: `npm run type-check` — PASS, exit code 0.
- Build: `npm run build` — PASS, exit code 0.
- Prohibited boundary scan: PASS, runtime exit code 0. Pattern scan found only the pre-existing `generateCADLayout` permit orchestration reference; no new CV/OCR/YOLO/semantic inference/image-byte runtime logic was introduced.

## Boundary Confirmation

The graph is a deterministic mapping graph, not an AI reasoning graph. No computer vision, OCR, semantic inference, CAD generation, image-byte inspection, or hidden engineering reasoning was added.
