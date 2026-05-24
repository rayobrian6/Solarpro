# Plan-Set CAD Appendix Preview V1 Todo

## Phase 1 — Audit First
- [x] Confirm existing feature branch and clean baseline
- [x] Audit renderPlanSet, validation, permit generation, sheet registration/render helpers, CAD export bundle, and SVG artifact DTO
- [x] Generate required audit artifact before implementation

## Phase 2 — Appendix DTO
- [x] Add deterministic CAD appendix preview sheet DTO module
- [x] Preserve JSON-safe, replay-safe, non-persistent, non-authoritative semantics

## Phase 3 — Plan-Set Wiring
- [x] Add explicit disabled-by-default feature flag path
- [x] Wire appendix sheet additively without replacing PV-2/PV-3 or rerunning solver
- [x] Fail closed for invalid CAD export/artifact inputs

## Phase 4 — Validation + Reports
- [x] Add targeted appendix DTO and renderPlanSet tests
- [x] Generate implementation, boundary, and validation reports
- [x] Run targeted tests and required validation commands
- [x] Confirm validation results are clean or only existing warnings

## Phase 5 — Delivery
- [x] Stage intended artifacts only
- [ ] Commit once on existing feature branch
- [ ] Push existing feature branch once
- [ ] Provide final safety summary and next handoff
