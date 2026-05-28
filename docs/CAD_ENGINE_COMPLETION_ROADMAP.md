# CAD Engine Completion Roadmap — SolarPro

**Date**: 2025-01-29
**Scope**: Unified geometry pipeline, promotion workflow, CAD input lockdown
**Status**: Phases 1–8 Complete · Phase 9 Deliverable

---

## 1. Executive Summary

SolarPro's geometry pipeline has been unified from two split pipelines (Photo Vision and Geometry Reconstruction) into a single authoritative path. Before this work, raw vision artifacts could reach the CAD engine without review-state enforcement through three critical bypass paths. This roadmap documents the completed unification work and the remaining tasks needed to fully harden and operationalize the unified pipeline.

The unified pipeline enforces a strict forward-only authority lifecycle: every geometry artifact must pass through promotion gates before it can influence CAD outputs. Mock artifacts are visibly labeled and blocked from CAD promotion. The canonical bridge is the sole legal adapter from the CanonicalBuildingModel to CAD inputs.

---

## 2. What the Unified Pipeline Replaces

### Before: Two Split Pipelines

The pre-unification architecture had two partially overlapping geometry pipelines that operated independently:

**Pipeline A — Open-Source Photo Vision** produced raw candidates (OpenCV contours, YOLO detections, OCR text, edge maps, obstruction candidates) that were stored in `open_source_photo_vision_candidates`. These artifacts carried a `reviewOnly` authority envelope but three bypass paths allowed them to reach CAD without promotion:

1. **Bypass #1**: `CADObstruction.source = 'vision'` — raw vision detections could be directly injected into the CAD engine's obstruction array, bypassing all review gates.
2. **Bypass #2**: `roofObstructionRegistration` wrote obstruction data into the evidence manifest without any review gating, allowing unreviewed vision data to flow into engineering workflows.
3. **Bypass #3**: `patchSystemDefinitionFromVision()` was an orphaned function (defined but never called) that could have injected raw vision data directly into the SystemDefinition, which feeds the CAD engine.

**Pipeline B — Geometry Reconstruction** produced segmentation masks, depth maps, point clouds, plane candidates, line candidates, vanishing points, and consensus planes. These were stored in `geometry_reconstruction_artifacts` with authority envelopes but had no promotion workflow — they were permanently stuck at `raw_evidence` authority with no path to CAD consumability.

### After: Single Unified Authority Path

Both pipelines now feed into a single unified system where every artifact must pass through the same authority lifecycle:

```
raw_evidence → derived_review_only → reviewed_candidate → promoted_canonical → cad_safe
```

Only artifacts at `promoted_canonical` or `cad_safe` authority can feed the CanonicalBuildingModel, and only `cad_safe` models can be converted to CAD inputs via the canonical bridge.

---

## 3. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      SURVEY PHOTOS (Upload)                     │
│                         site_survey_files                        │
└───────────────────────┬─────────────────────┬───────────────────┘
                        │                     │
           ┌────────────▼─────────┐  ┌────────▼──────────────────┐
           │    PIPELINE A        │  │     PIPELINE B             │
           │   Photo Vision       │  │   Geometry Recon           │
           │                      │  │                             │
           │  OpenCV contours     │  │  Segmentation masks         │
           │  YOLO detections     │  │  Line extraction            │
           │  OCR text extract    │  │  Vanishing points           │
           │  Raw candidates      │  │  Plane extraction           │
           │  Refined overlays    │  │  Depth estimation           │
           │  Obstruction reg     │  │  Multi-photo fusion         │
           └────────┬─────────────┘  └────────┬───────────────────┘
                    │                          │
                    │  adaptPhotoVision         │  adaptGeometryRecon
                    │  Candidate()              │  Artifact()
                    │                          │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   UNIFIED GEOMETRY      │
                    │   EVIDENCE BUNDLE       │
                    │                         │
                    │  BundleBuilder          │
                    │  - Cross-references     │
                    │  - Pipeline counts      │
                    │  - Review state counts  │
                    │  - Mock exclusion       │
                    │                         │
                    │  All artifacts at        │
                    │  raw_evidence authority  │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   PROMOTION WORKFLOW    │
                    │                         │
                    │  promoteArtifact()      │
                    │  Forward-only gates:    │
                    │  raw_evidence           │
                    │    → derived_review_only│
                    │    → reviewed_candidate │
                    │    → promoted_canonical │
                    │    → cad_safe           │
                    │                         │
                    │  Audit trail in         │
                    │  geometry_promotion_    │
                    │  records table          │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │  CANONICAL BUILDING     │
                    │  MODEL                  │
                    │                         │
                    │  CanonicalModelBuilder  │
                    │  - Only accepts         │
                    │    promoted_canonical+  │
                    │  - Mock artifacts       │
                    │    rejected             │
                    │  - source is always     │
                    │    'promoted_canonical' │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   CANONICAL BRIDGE      │
                    │   (sole legal adapter)  │
                    │                         │
                    │  canonicalToCADInputs() │
                    │  - Authority gate:      │
                    │    cad_safe required    │
                    │  - Mock gate:           │
                    │    mockArtifact blocked │
                    │  - Post-hoc guard:      │
                    │    assertNoRawVision    │
                    │    InCAD()              │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │      CAD ENGINE         │
                    │                         │
                    │  All inputs guaranteed  │
                    │  source='promoted_      │
                    │  canonical' or          │
                    │  source='manual'        │
                    └─────────────────────────┘
```

---

## 4. Remaining Work Items

### P0 — Critical (Completed ✅)

These items were completed as part of Phases 7–8:

- [x] API routes for promotion and bundle fetch (`/api/site-surveys/[surveyId]/unified-geometry/bundle`, `promote`, `canonical-model`)
- [x] Test suite — 14 required test cases + additional validateCADModelSources tests (50 total, all passing)

### P1 — High Priority (Completed ✅)

- [x] UI unification — `UnifiedGeometryPanel` component with authority state badges, promotion controls, and CAD readiness indicators

### P2 — Medium Priority (Pending)

These items clean up the guard infrastructure from Phase 6:

- [ ] **Remove `patchSystemDefinitionFromVision()` entirely** — Currently deprecated with `@deprecated` JSDoc and a runtime warning, but the function still exists in `lib/system/visionPatch.ts`. It should be deleted and all imports removed. The unified pipeline makes this function unnecessary.

- [ ] **Remove `source='vision'` from `CADObstruction` / `CADElectricalNode` union types entirely** — Currently allowed in the type union but guarded at runtime by `assertNoRawVisionInCAD()` in the canonical bridge and by the guard in `roofCAD.ts`. Once all existing `source='vision'` data has been migrated or confirmed absent, the literal `'vision'` should be removed from the source type unions, making the type system enforce what the runtime guards currently check.

### P3 — Lower Priority (Future Work)

- [ ] **Migration to populate `unified_geometry_artifacts` from existing `open_source_photo_vision_candidates` rows** — Migration 079 created the `unified_geometry_artifacts` table, but existing photo vision candidates in the database have not been backfilled into it. A one-time migration script should iterate over `open_source_photo_vision_candidates` rows, adapt each via `adaptPhotoVisionCandidate()`, and insert the resulting `UnifiedGeometryArtifact` records. This would give the unified bundle endpoint a single table to query instead of aggregating from two tables at request time.

- [ ] **Real geometry reconstruction worker** — The Pipeline B worker is currently mock-only. When a real worker is implemented, it will produce `GeometryReconstructionArtifact` instances that are already adapted into the unified pipeline via `adaptGeometryReconArtifact()`. No pipeline changes are needed — the adapter and promotion workflow handle any `GeometryReconstructionArtifact` regardless of whether it came from a mock or real worker.

- [ ] **Unified artifact persistence** — Currently the bundle endpoint fetches from both `open_source_photo_vision_candidates` and `geometry_reconstruction_artifacts` tables and adapts them on the fly. Once the `unified_geometry_artifacts` table is populated (P3 item above), the bundle endpoint should be updated to query the unified table directly, simplifying the data flow and improving query performance.

- [ ] **Promotion persistence in promote route** — The promote route currently persists `GeometryPromotionRecord` entries but does not update the `unified_geometry_artifacts` table with the new authority state. After promotion, the promoted artifact should be upserted into the unified table so that subsequent bundle fetches reflect the updated authority without re-adapting from the source tables.

- [ ] **WebSocket/SSE notifications for promotion state changes** — When multiple users are reviewing and promoting artifacts, real-time updates would prevent stale UI state. This is a UX enhancement, not a correctness requirement, since the promote endpoint already re-fetches the bundle for freshness before each promotion.

---

## 5. DB Migration Checklist

| Migration | Description | Status |
|-----------|-------------|--------|
| 079 | `geometry_promotion_records` table + `unified_geometry_artifacts` table + 7 indexes | ✅ Created |
| (pending) | Backfill `unified_geometry_artifacts` from `open_source_photo_vision_candidates` | P3 |
| (pending) | Backfill `unified_geometry_artifacts` from `geometry_reconstruction_artifacts` | P3 |
| (pending) | Remove `source='vision'` from `CADObstruction.source` / `CADElectricalNode.source` columns after type narrowing | P2 (post-cleanup) |

### Migration 079 Schema

**`geometry_promotion_records`** — audit trail for every authority transition:
- `id` UUID PK
- `artifact_id` UUID FK → `unified_geometry_artifacts.id`
- `survey_id` UUID FK → `site_surveys.id`
- `from_state` TEXT (authority state before promotion)
- `to_state` TEXT (authority state after promotion)
- `promoted_by` UUID (user who promoted)
- `promoted_at` TIMESTAMPTZ
- `notes` TEXT (optional)
- `intelligence_validated` BOOLEAN
- `intelligence_warnings` TEXT[]

**`unified_geometry_artifacts`** — canonical storage for unified artifacts:
- `id` UUID PK
- `survey_id` UUID FK
- `geometry_class` TEXT
- `authority_state` TEXT
- `authority_json` JSONB
- `provenance_json` JSONB
- `artifact_json` JSONB (full artifact data)
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

**Indexes**: `idx_gpr_artifact_id`, `idx_gpr_survey_id`, `idx_gpr_promoted_by`, `idx_uga_survey_id`, `idx_uga_geometry_class`, `idx_uga_authority_state`, `idx_uga_created_at`

---

## 6. Non-Negotiable Rules (Preserved for Reference)

These rules are the contract that the unified pipeline enforces. They must never be violated:

1. **No split pipeline** — All geometry artifacts flow through the unified authority lifecycle. There is no separate "fast path" for any pipeline.

2. **No duplicate source of truth** — The `CanonicalBuildingModel` is the single source of truth for building geometry. No other structure may hold canonical geometry data.

3. **No CAD mutation from raw artifacts** — Raw artifacts (`raw_evidence` authority) cannot mutate CAD inputs. Only `cad_safe` artifacts reach the CAD engine via the canonical bridge.

4. **No permit/BOM trigger from raw artifacts** — Raw and derived-review-only artifacts cannot trigger permit generation or BOM mutations. These workflows must only consume `promoted_canonical` or `cad_safe` data.

5. **All raw/derived artifacts stay review-only** — Artifacts at `raw_evidence` or `derived_review_only` authority have `reviewOnly: true` and `cadConsumable: false`. They may be displayed in the UI for review but cannot influence engineering workflows.

6. **Only promoted canonical geometry can feed CAD** — The `canonicalBridge.ts` is the sole legal adapter from `CanonicalBuildingModel` to CAD inputs. It enforces authority gates and mock gates at the type and runtime level.

7. **Every artifact must preserve provenance** — All artifacts carry a `GeometryProvenance` record that traces the source pipeline, tool name, tool version, run hash, source file IDs, and derived-from artifact IDs. Promotion records create an immutable audit trail.

8. **Mock artifacts must be visibly labeled and blocked from CAD promotion** — Mock artifacts have `authority.mockArtifact: true`, are filtered by default in the bundle builder, display with a red badge and strikethrough in the UI, and are blocked from promotion by `PromotionError`.

---

## 7. File Map

### New Files Created (Phases 2–8)

| File | Phase | Description |
|------|-------|-------------|
| `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md` | 1 | Drift audit identifying 3 bypasses, 4 orphans, 6 duplicates |
| `docs/PIPELINE_UNIFICATION_HANDOFF.md` | 1 | Comprehensive handoff document for session continuation |
| `lib/siteSurveys/unifiedGeometry/authority.ts` | 2 | Authority states, transitions, helpers, frozen constants |
| `lib/siteSurveys/unifiedGeometry/types.ts` | 2 | All canonical geometry types, bundle, building model |
| `lib/siteSurveys/unifiedGeometry/index.ts` | 2 | Barrel export (single import point) |
| `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts` | 3 | Pipeline A + B artifact adapters |
| `lib/siteSurveys/unifiedGeometry/bundleBuilder.ts` | 3 | Cross-referencing bundle builder |
| `lib/siteSurveys/unifiedGeometry/promotion.ts` | 4 | Promotion workflow + guards |
| `lib/siteSurveys/unifiedGeometry/promotionStore.ts` | 4 | DB persistence for promotion records |
| `lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts` | 5 | CanonicalBuildingModel builder |
| `lib/cad/canonicalBridge.ts` | 6 | Sole legal CanonicalModel → CAD adapter |
| `app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts` | 7 | GET endpoint for unified evidence bundle |
| `app/api/site-surveys/[surveyId]/unified-geometry/promote/route.ts` | 7 | POST endpoint for artifact promotion |
| `app/api/site-surveys/[surveyId]/unified-geometry/canonical-model/route.ts` | 7 | POST endpoint for canonical model building |
| `components/UnifiedGeometryPanel.tsx` | 7 | React component with authority badges and promotion controls |
| `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts` | 8 | 50 test cases covering all 14 required scenarios |
| `docs/CAD_ENGINE_COMPLETION_ROADMAP.md` | 9 | This document |

### Files Modified (Phases 4–7)

| File | Phase | Change |
|------|-------|--------|
| `app/api/migrate/route.ts` | 4 | Migration 079 (2 tables, 7 indexes) |
| `lib/cad/types.ts` | 6 | `CADObstruction`/`CADElectricalNode` source widened to include `'promoted_canonical'` |
| `lib/cad/roof/roofCAD.ts` | 6 | Bypass guard blocks `source='vision'` from raw SysDefObstruction |
| `lib/system/systemDefinition.ts` | 6 | `SysDefObstruction`/`SysDefElectricalNode` source types widened |
| `lib/system/visionPatch.ts` | 6 | `@deprecated` + runtime warning on `patchSystemDefinitionFromVision()` |
| `lib/assistedEvidenceSources/roofObstructionRegistration.ts` | 6 | Review-only guard log added |
| `app/projects/[id]/survey/[surveyId]/page.tsx` | 7 | Integrated `UnifiedGeometryPanel` alongside legacy components |

---

## 8. Test Coverage Summary

The test suite in `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts` contains 50 test cases covering all 14 required scenarios:

| # | Test Case | Assertions |
|---|-----------|------------|
| 1 | Authority forward-only transitions succeed; backward throw | 5 tests |
| 2 | Authority skip rejected (raw→promoted_canonical throws) | 4 tests |
| 3 | Mock artifact blocked from promotion | 3 tests |
| 4 | Bundle builder cross-references correct | 2 tests |
| 5 | Bundle builder mock exclusion | 2 tests |
| 6 | Pipeline A adapter produces correct UnifiedGeometryArtifact | 1 test |
| 7 | Pipeline B adapter dispatches correctly for 11 artifact types | 11 tests |
| 8 | Promotion creates new artifact; original unchanged | 2 tests |
| 9 | Promotion record created with correct fields | 1 test |
| 10 | Canonical builder rejects unpromoted artifacts | 6 tests |
| 11 | Canonical obstruction source always 'promoted_canonical' | 2 tests |
| 12 | CAD bridge authority gate throws for non-cad_safe | 2 tests |
| 13 | CAD bridge mock gate throws for mock artifacts | 1 test |
| 14 | assertNoRawVisionInCAD throws for source='vision' | 5 tests |
| + | validateCADModelSources additional tests | 3 tests |

All 50 tests pass. TypeScript compilation is clean (0 errors).

---

## 9. Import Quick Reference

All downstream consumers import from the barrel:

```typescript
import {
  // Authority
  UnifiedGeometryAuthorityState,
  isCadConsumable,
  assertNoCadMutation,

  // Types
  UnifiedGeometryArtifact,
  CanonicalBuildingModel,
  CanonicalObstruction,

  // Adapters
  adaptPhotoVisionCandidate,
  adaptGeometryReconArtifact,

  // Bundle
  BundleBuilder,
  buildUnifiedEvidenceBundle,

  // Promotion
  promoteArtifact,
  promoteToCanonical,
  assertCanonicalEligible,

  // Canonical Builder
  CanonicalModelBuilder,
  buildCanonicalModel,

  // Store
  insertPromotionRecords,
  getPromotionHistoryForArtifact,
} from '@/lib/siteSurveys/unifiedGeometry';
```

CAD bridge import:

```typescript
import {
  canonicalToCADInputs,
  assertNoRawVisionInCAD,
  validateCADModelSources,
  CanonicalBridgeError,
} from '@/lib/cad/canonicalBridge';
```
