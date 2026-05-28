# Pipeline Unification — Handoff Document

**Branch:** `feature/pipeline-unification-phases-1-6` (merged to `dev`)  
**Commit:** `b1dc0da` — 17 files changed, 4,262 insertions  
**Date:** 2025-07-11  
**Status:** Phases 1–6 COMPLETE. Phases 7–9 remaining.

---

## What Was Done (Phases 1–6)

### Phase 1: Drift Audit ✅
- **File:** `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md`
- Maps both pipelines (Photo Vision A, Geometry Reconstruction B), all DB tables, routes, UI components
- Identified 3 critical bypasses, 4 orphaned systems, conflicting artifact names, missing ownership boundaries
- Priority fixes rated P0–P3

### Phase 2: Unified Contract ✅
- **Files:** `lib/siteSurveys/unifiedGeometry/authority.ts`, `types.ts`, `index.ts`
- 5 authority states: `raw_evidence` → `derived_review_only` → `reviewed_candidate` → `promoted_canonical` → `cad_safe`
- Forward-only transitions enforced by `VALID_AUTHORITY_TRANSITIONS` map
- Frozen authority constants: `RAW_EVIDENCE_AUTHORITY`, `DERIVED_REVIEW_ONLY_AUTHORITY`, etc.
- Canonical geometry types: `UnifiedGeometryArtifact`, `CanonicalBuildingModel`, `CanonicalRoofPlane`, `CanonicalObstruction`, etc.
- `CanonicalObstruction.source` typed as literal `'promoted_canonical'` ONLY (fixes bypass #1)

### Phase 3: Bundle Builder ✅
- **Files:** `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts`, `bundleBuilder.ts`
- `adaptPhotoVisionCandidate()` — Pipeline A adapter
- `adaptGeometryReconArtifact()` — Pipeline B dispatcher (11 artifact types)
- `BundleBuilder` class with filtering (minConfidence, mock exclusion), cross-referencing (by source file, geometry class, authority state), pipeline counts, review state counts
- All adapted artifacts start at `raw_evidence` authority

### Phase 4: Promotion Workflow ✅
- **Files:** `lib/siteSurveys/unifiedGeometry/promotion.ts`, `promotionStore.ts`
- `promoteArtifact()` — creates NEW artifact (never mutates), creates `GeometryPromotionRecord`, enforces forward-only transitions, blocks mock artifacts
- Convenience functions: `promoteToDerivedReviewOnly`, `promoteToReviewedCandidate`, `promoteToCanonical`, `promoteToCadSafe`
- `reviewArtifact()` — review without promotion
- Guards: `assertCadConsumable()`, `assertCanonicalEligible()`, `canPromote()`
- **Migration 079** in `app/api/migrate/route.ts`:
  - 079a: `geometry_promotion_records` table with 3 indexes
  - 079b: `unified_geometry_artifacts` table with 4 indexes
- `promotionStore.ts` — DB persistence with TEXT[] handling for `intelligence_warnings` (Neon serverless quirk: pass JS arrays directly, NOT JSON.stringify'd)

### Phase 5: Canonical Building Model ✅
- **File:** `lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts`
- `CanonicalModelBuilder` class — constructs `CanonicalBuildingModel` from promoted artifacts
- `addArtifact()` validates authority via `assertCanonicalEligible()` — only `promoted_canonical` or `cad_safe`
- `build()` groups by geometry class, constructs canonical types
- `buildCanonicalObstruction()` — `source: 'promoted_canonical'` ONLY (fixes bypass #1)
- `buildCanonicalElectricalNode()` — `source: 'promoted_canonical'` ONLY
- `buildCanonicalRoofPlane()` with setback defaults
- `buildCanonicalModel()` convenience factory
- Model authority = minimum authority of all input artifacts

### Phase 6: CAD Input Lockdown ✅
- **File:** `lib/cad/canonicalBridge.ts` — THE sole legal adapter from CanonicalBuildingModel → CAD
  - Authority gate: only `cad_safe` models pass through
  - Mock artifact gate: blocked
  - Output `source='promoted_canonical'` — NEVER `'vision'`
  - `assertNoRawVisionInCAD()` post-hoc guard for CAD models
  - `validateCADModelSources()` non-throwing validation
  - `canonicalToCADInputs()` main bridge function with world projection support
- **File:** `lib/cad/types.ts` — `CADObstruction.source` / `CADElectricalNode.source` widened to include `'promoted_canonical'`
- **File:** `lib/cad/roof/roofCAD.ts` — bypass guard in `buildCADObstructions()` and `buildCADElectricalNodes()` that `console.warn` + filter out `source='vision'` entries from raw `SysDefObstruction`
- **File:** `lib/system/systemDefinition.ts` — `SysDefObstruction.source` / `SysDefElectricalNode.source` widened to include `'promoted_canonical'`
- **File:** `lib/system/visionPatch.ts` — `patchSystemDefinitionFromVision()` marked `@deprecated` with runtime `console.warn`
- **File:** `lib/assistedEvidenceSources/roofObstructionRegistration.ts` — review-only enforcement guard log added to `registerObstructionsForSurvey()`

---

## Key Architecture Decisions

1. **Promotion creates NEW artifacts** — never mutates the original. Every promotion creates a fresh `UnifiedGeometryArtifact` with updated authority and a `GeometryPromotionRecord` for audit.
2. **Forward-only transitions** — `VALID_AUTHORITY_TRANSITIONS` map prevents backward transitions. `isValidAuthorityTransition()` is the gate.
3. **`CanonicalObstruction.source` = `'promoted_canonical'` ONLY** — the type system itself prevents `'vision'` from ever being set. This is the type-level fix for bypass #1.
4. **CAD bypass guard in roofCAD.ts** — even if someone wires raw `SysDefObstruction` with `source='vision'` into CAD, the guard filters it out at the engine boundary.
5. **`canonicalBridge.ts` is the SOLE legal path** — no other module should convert geometry data into CAD inputs. All other paths are either deprecated or guarded.
6. **Neon serverless quirk** — TEXT[] columns receive JS arrays directly, NOT JSON.stringify'd arrays. All `promotionStore.ts` insert functions handle this.

---

## What Remains (Phases 7–9)

### Phase 7: UI Unification
**Goal:** Replace the split Pipeline A/B UI with a single unified flow showing authority state labels.

**Current state (split):**
- `components/PhotoVisionOverlayRenderer.tsx` (620 lines) — Pipeline A overlay renderer
- `components/GeometryReconstructionPreview.tsx` (971 lines) — Pipeline B artifact preview
- `app/projects/[id]/survey/[surveyId]/page.tsx` imports both separately

**What to build:**
1. **`components/UnifiedGeometryPanel.tsx`** — New unified component that:
   - Shows ALL geometry artifacts in one panel (from both pipelines)
   - Displays authority state badges: `raw_evidence` (gray), `derived_review_only` (yellow), `reviewed_candidate` (blue), `promoted_canonical` (green), `cad_safe` (emerald)
   - Mock artifact badges: `MOCK` (red, with strikethrough)
   - Promote/Review buttons per artifact (calls promotion API)
   - "Promote to CAD" bulk action for `reviewed_candidate` → `promoted_canonical`
   - "Lock for CAD" action for `promoted_canonical` → `cad_safe`
2. **Update `app/projects/[id]/survey/[surveyId]/page.tsx`** to:
   - Replace `PhotoVisionOverlayRenderer` + `GeometryReconstructionPreview` with `UnifiedGeometryPanel`
   - Keep old components imported but wrapped in a "Legacy" collapsible section during transition
3. **API routes needed:**
   - `POST /api/site-surveys/[surveyId]/unified-geometry/promote` — promotion endpoint
   - `GET /api/site-surveys/[surveyId]/unified-geometry/bundle` — fetch the unified evidence bundle
   - `POST /api/site-surveys/[surveyId]/unified-geometry/canonical-model` — build canonical model

### Phase 8: Tests (14 Required Test Cases)
**File:** `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts`

The 14 test cases from the directive:

1. **Authority forward-only** — `raw_evidence` → `derived_review_only` → `reviewed_candidate` → `promoted_canonical` → `cad_safe` each succeeds; backward transitions each throw
2. **Authority skip rejected** — `raw_evidence` → `promoted_canonical` directly throws (must go through each step)
3. **Mock artifact blocked from promotion** — artifact with `mockArtifact: true` throws on any promotion attempt
4. **Bundle builder cross-references** — BundleBuilder produces correct `bySourceFile`, `byGeometryClass`, `byAuthorityState` cross-references
5. **Bundle builder mock exclusion** — With `excludeMock: true`, mock artifacts are filtered from the bundle
6. **Pipeline A adapter** — `adaptPhotoVisionCandidate` produces correct `UnifiedGeometryArtifact` with `raw_evidence` authority
7. **Pipeline B adapter** — `adaptGeometryReconArtifact` dispatches correctly for each of the 11 artifact types
8. **Promotion creates new artifact** — `promoteArtifact` returns a NEW object; original is unchanged
9. **Promotion record created** — Each promotion creates a `GeometryPromotionRecord` with correct `fromState`, `toState`, `promotedBy`, timestamp
10. **Canonical builder rejects unpromoted** — `CanonicalModelBuilder.addArtifact()` throws for `raw_evidence` artifacts
11. **Canonical obstruction source** — `buildCanonicalObstruction` always sets `source: 'promoted_canonical'`, never `'vision'`
12. **CAD bridge authority gate** — `canonicalToCADInputs` throws `CanonicalBridgeError` for non-cad_safe models
13. **CAD bridge mock gate** — `canonicalToCADInputs` throws for models with `mockArtifact: true`
14. **No raw vision in CAD guard** — `assertNoRawVisionInCAD` throws when given obstructions with `source='vision'`

**Additional tests worth adding:**
- `validateCADModelSources` returns `valid: true` for `source='promoted_canonical'` and `source='manual'`
- `validateCADModelSources` returns `valid: false` for `source='vision'`
- `promotionStore` TEXT[] handling for `intelligence_warnings`
- `CanonicalModelBuilder` survey ID consistency check

### Phase 9: Completion Roadmap
**File:** `docs/CAD_ENGINE_COMPLETION_ROADMAP.md`

Should contain:
1. Summary of what the unified pipeline replaces (the 2 split pipelines)
2. Architecture diagram: Survey Photos → Evidence Manifest → Pipeline Adapters → Bundle Builder → Promotion → Canonical Model → CAD Bridge → CAD Engine
3. Remaining work items with priority:
   - P0: API routes for promotion + bundle fetch (Phase 7 dependency)
   - P0: Test suite (Phase 8)
   - P1: UI unification (Phase 7)
   - P2: Remove `patchSystemDefinitionFromVision()` entirely (currently deprecated, not removed)
   - P2: Remove `source='vision'` from `CADObstruction` / `CADElectricalNode` union type entirely (currently allowed but guarded)
   - P3: Migration to populate `unified_geometry_artifacts` from existing `open_source_photo_vision_candidates` rows
   - P3: Real geometry reconstruction worker (currently mock-only)
4. DB migration checklist
5. Non-negotiable rules preserved for reference

---

## File Map (New Files Created)

```
docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md          — Phase 1 drift audit
lib/siteSurveys/unifiedGeometry/authority.ts    — Authority states, transitions, helpers
lib/siteSurveys/unifiedGeometry/types.ts        — All canonical geometry types
lib/siteSurveys/unifiedGeometry/index.ts        — Barrel export (single import point)
lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts — Pipeline A + B artifact adapters
lib/siteSurveys/unifiedGeometry/bundleBuilder.ts   — Cross-referencing bundle builder
lib/siteSurveys/unifiedGeometry/promotion.ts    — Promotion workflow + guards
lib/siteSurveys/unifiedGeometry/promotionStore.ts  — DB persistence for promotion records
lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts — CanonicalBuildingModel builder
lib/cad/canonicalBridge.ts                      — Sole legal CanonicalModel → CAD adapter
```

## Files Modified

```
app/api/migrate/route.ts                        — Migration 079 (2 tables, 7 indexes)
lib/cad/types.ts                                — CADObstruction/CADElectricalNode source widened
lib/cad/roof/roofCAD.ts                         — Bypass guard blocks source='vision'
lib/system/systemDefinition.ts                  — SysDefObstruction/SysDefElectricalNode source widened
lib/system/visionPatch.ts                       — @deprecated + runtime warning
lib/assistedEvidenceSources/roofObstructionRegistration.ts — Review-only guard log
```

## Quick Reference: Import Path

All downstream consumers import from:
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
  insertPromotionRecord,
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
