# Document Provenance + Requirement Binding Foundation v1

## Setup
- [x] Verify branch/status and existing provenance, registry, render, permit architecture
- [x] Inventory current test structure and target integration points

## Implementation
- [x] Add DocumentProvenanceBundle normalized structures
- [x] Add deterministic RequirementDocumentBinding registry
- [x] Add EngineeringDependencyGraph structures/builders
- [x] Add EvidenceBackedGeometryInput wrappers without geometry extraction
- [x] Extend RenderContext/document contexts with provenance support
- [x] Add route-level audit guards for registry/provenance/raw-truth boundaries
- [x] Integrate binding layer into permit generation, permit validation, render contexts, and document summaries where safe

## Tests and Reports
- [x] Add focused regression tests for duplicate provenance collapse, section evidence linkage, render-context survival, registry bypass guards, raw truth guard, and deterministic dependency graph
- [x] Create document provenance binding v1 report
- [x] Create engineering dependency graph v1 report

## Validation and Delivery
- [x] Run focused tests
- [x] Run npm run type-check
- [x] Run npm run build
- [x] Run prohibited boundary scan
- [ ] Commit and push changes
- [ ] Final summary with structures, bindings, dependency graph, integrations, guards, tests, validation, provenance-aware generators, and no CV/OCR/CAD/image-byte confirmation
