# Engineering State Invalidation + Selective Regeneration v1

## Setup
- [x] Verify branch/status and inspect existing provenance, dependency graph, render, permit, BOM, SLD, and decision modules
- [x] Inventory current type surfaces for safe invalidation integration

## Implementation
- [x] Add normalized Engineering State Registry structures
- [x] Add deterministic dependency-aware invalidation engine
- [x] Add deterministic selective regeneration planning structures
- [x] Add stale-state detection and audit guards
- [x] Extend render/document provenance contexts with state invalidation metadata
- [x] Integrate state tracking into permit validation, dependency graph, selected SLD/BOM metadata, and selected decision outputs

## Tests and Reports
- [x] Add regression tests for targeted invalidation, unaffected preservation, duplicate upload stability, render survival, deterministic plans, and audit failures
- [x] Create engineering state invalidation v1 report
- [x] Create selective regeneration planning v1 report

## Validation and Delivery
- [x] Run focused tests
- [x] Run npm run type-check
- [x] Run npm run build
- [x] Run prohibited boundary scan
- [ ] Commit and push meaningful implementation changes
- [ ] Final summary with structures, engine, planning, integrations, guards, tests, validation, invalidation-aware outputs, and no CV/OCR/CAD/image-byte confirmation
