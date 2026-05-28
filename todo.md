# PIPELINE UNIFICATION + DRIFT AUDIT — Task Tracker

## Phase 1: Drift Audit ✅
- [x] Map all geometry-related files, routes, DB tables, APIs, UI components
- [x] Identify duplicates/orphans/bypasses
- [x] Produce `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md`

## Phase 2: Define Unified Contract ✅
- [x] Create `lib/siteSurveys/unifiedGeometry/authority.ts` — unified authority states, envelopes, helpers
- [x] Create `lib/siteSurveys/unifiedGeometry/types.ts` — canonical geometry types, bundle, building model
- [x] Create `lib/siteSurveys/unifiedGeometry/index.ts` — barrel export
- [x] Verify TypeScript compilation

## Phase 3: Build Unified Geometry Evidence Bundle ✅
- [x] Create `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts` — adapters for Pipeline A + B artifacts
- [x] Create `lib/siteSurveys/unifiedGeometry/bundleBuilder.ts` — unifier consuming both pipelines
- [x] Verify cross-referencing by source photo / geometry class / authority state
- [x] Update `index.ts` barrel exports
- [x] Verify TypeScript compilation

## Phase 4: Create Promotion Workflow ✅
- [x] Create `lib/siteSurveys/unifiedGeometry/promotion.ts` — promotion bridge functions
- [x] Create `lib/siteSurveys/unifiedGeometry/promotionStore.ts` — authority transition storage
- [x] Enforce forward-only transitions with audit trail
- [x] Add Migration 079 for geometry_promotion_records and unified_geometry_artifacts tables
- [x] Update index.ts barrel exports
- [x] Verify TypeScript compilation

## Phase 5: Canonical Building Model ✅
- [x] Create `lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts` — builder from promoted artifacts
- [x] Validate only promoted_canonical+ artifacts feed the builder
- [x] Wire CanonicalBuildingModel into CAD input path (barrel export + TS verified)

## Phase 6: CAD Input Lockdown ✅
- [x] Create `lib/cad/canonicalBridge.ts` — sole legal adapter from CanonicalBuildingModel → CAD inputs
- [x] Narrow `CADObstruction.source` / `CADElectricalNode.source` types to include `'promoted_canonical'`
- [x] Add guard in `roofCAD.ts` — reject `source='vision'` from raw SysDefObstruction
- [x] Add guard in `roofObstructionRegistration.ts` — enforce review-only, no direct CAD mutation
- [x] Deprecate `patchSystemDefinitionFromVision()` — mark as orphaned, add @deprecated + guard
- [x] Update SysDefObstruction/SysDefElectricalNode source types to include `'promoted_canonical'`
- [x] Verify TypeScript compilation — 0 errors

## Phase 7: UI Unification
- [ ] Refactor page organization into unified flow
- [ ] Add authority state labels
- [ ] Replace split Pipeline A/B components with unified view

## Phase 8: Tests
- [ ] Write 14 required test cases (listed in directive)
- [ ] Run full test suite

## Phase 9: Completion Roadmap
- [ ] Create `docs/CAD_ENGINE_COMPLETION_ROADMAP.md`
