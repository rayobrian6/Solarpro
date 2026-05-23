# Engineering Decision Provenance v1

## Setup
- [x] Verify branch/status and inspect existing document provenance, dependency graph, render, permit, BOM, and SLD integration points
- [x] Inventory current tests and validation command patterns

## Implementation
- [x] Add EngineeringDecisionProvenanceRecord normalized structures
- [x] Add deterministic Engineering Decision Registry definitions
- [x] Add deterministic Decision Evaluation Engine
- [x] Extend dependency graph so decisions are first-class nodes
- [x] Extend render/document contexts with decision provenance support
- [x] Expand audit guards for undocumented defaults, missing lineage, and missing governing rules
- [x] Integrate decision provenance into permit validation, summaries, render contexts, readiness summaries, and selected calculation/BOM/SLD metadata where safe

## Tests and Reports
- [x] Add regression tests for lineage retention, deterministic decision graph nodes, surfaced fallbacks, duplicate upload stability, render survival, and missing-lineage audit failures
- [x] Create engineering decision provenance v1 report
- [x] Create engineering decision dependency graph v1 report

## Validation and Delivery
- [x] Run focused tests
- [x] Run npm run type-check
- [x] Run npm run build
- [x] Run prohibited boundary scan
- [ ] Commit and push changes
- [ ] Final summary with structures, registry, dependency graph integrations, render/document integrations, guards, tests, validation, decision-aware outputs, and no CV/OCR/CAD/image-byte confirmation
