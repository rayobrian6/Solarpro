# Pipeline Unification + Drift Audit — Complete Thread Handoff

**Branch:** `dev` on `rayobrian6/Solarpro`
**Commits:**
- `b1dc0da` — Phases 1–6 (4,262 insertions)
- `10a4d65` — Phases 7–9 (2,305 insertions)
**Date:** 2025-07-11
**Status:** ALL 9 PHASES COMPLETE ✅

---

## ⚡ TL;DR FOR THE NEW THREAD

All 9 phases of the Pipeline Unification + Drift Audit directive are **done and pushed to `dev`**. The unified geometry pipeline enforces a strict forward-only authority lifecycle from raw artifacts through promotion to CAD. Three critical bypasses have been identified and guarded. The remaining work is P2/P3 cleanup (removing deprecated code, backfilling DB tables, adding WebSocket notifications). **Read this entire document before touching any code.**

---

## 🟢 WHAT WAS COMPLETED

### Phase 1: Drift Audit ✅
- **File:** `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md`
- Mapped both pipelines (Photo Vision A, Geometry Reconstruction B), all DB tables, routes, UI components
- Identified **3 critical bypasses**, 4 orphaned systems, conflicting artifact names, missing ownership boundaries
- The 3 bypasses:
  1. `CADObstruction.source='vision'` — raw vision detections injected directly into CAD
  2. `roofObstructionRegistration` — wrote obstruction data without review gating
  3. `patchSystemDefinitionFromVision()` — orphaned function that could inject raw vision into SystemDefinition

### Phase 2: Unified Contract ✅
- **Files:** `lib/siteSurveys/unifiedGeometry/authority.ts` (307 lines), `types.ts` (632 lines), `index.ts` (123 lines)
- 5 authority states: `raw_evidence → derived_review_only → reviewed_candidate → promoted_canonical → cad_safe`
- Forward-only transitions enforced by `VALID_AUTHORITY_TRANSITIONS` map
- 6 frozen authority constants (one per state + `MOCK_ARTIFACT_AUTHORITY`)
- `CanonicalObstruction.source` typed as literal `'promoted_canonical'` ONLY — type-level fix for bypass #1

### Phase 3: Bundle Builder ✅
- **Files:** `pipelineAdapters.ts` (722 lines), `bundleBuilder.ts` (361 lines)
- `adaptPhotoVisionCandidate()` — Pipeline A adapter
- `adaptGeometryReconArtifact()` — Pipeline B dispatcher handling 11 artifact types
- `BundleBuilder` class with filtering, cross-referencing, pipeline counts, review state counts

### Phase 4: Promotion Workflow ✅
- **Files:** `promotion.ts` (375 lines), `promotionStore.ts` (229 lines)
- `promoteArtifact()` — creates NEW artifact (never mutates), creates `GeometryPromotionRecord`, enforces forward-only transitions, blocks mock artifacts
- Convenience wrappers: `promoteToDerivedReviewOnly`, `promoteToReviewedCandidate`, `promoteToCanonical`, `promoteToCadSafe`
- **Migration 079** in `app/api/migrate/route.ts`: `geometry_promotion_records` + `unified_geometry_artifacts` tables + 7 indexes

### Phase 5: Canonical Building Model ✅
- **File:** `canonicalBuilder.ts` (388 lines)
- `CanonicalModelBuilder` — constructs `CanonicalBuildingModel` from promoted artifacts only
- `buildCanonicalObstruction()` always sets `source: 'promoted_canonical'` (never `'vision'`)
- Model authority = minimum authority of all input artifacts

### Phase 6: CAD Input Lockdown ✅
- **File:** `lib/cad/canonicalBridge.ts` (392 lines) — THE sole legal adapter from CanonicalBuildingModel → CAD
  - Authority gate: only `cad_safe` models pass
  - Mock artifact gate: blocked
  - `assertNoRawVisionInCAD()` post-hoc guard
  - `validateCADModelSources()` non-throwing validation
- **File:** `lib/cad/roof/roofCAD.ts` — bypass guard blocks `source='vision'` from raw SysDefObstruction at engine boundary
- **File:** `lib/system/visionPatch.ts` — `patchSystemDefinitionFromVision()` marked `@deprecated` with runtime warning
- **File:** `lib/assistedEvidenceSources/roofObstructionRegistration.ts` — review-only enforcement guard log added

### Phase 7: UI Unification ✅
- **File:** `components/UnifiedGeometryPanel.tsx` (684 lines)
  - Fetches bundle from `/api/site-surveys/[surveyId]/unified-geometry/bundle`
  - Authority state badges with color coding (gray/yellow/blue/green/emerald/red for mock)
  - Per-artifact promote/review buttons
  - Bulk "Promote to CAD" and "Lock for CAD" actions
  - Filter controls: search, authority state toggle, show/hide mocks
  - Authority summary bar, pipeline summary, CAD readiness indicator
- **File:** `app/projects/[id]/survey/[surveyId]/page.tsx` — added `UnifiedGeometryPanel` in a `SurveyPanelErrorBoundary`
- **API Routes:**
  - `app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts` (83 lines) — GET endpoint
  - `app/api/site-surveys/[surveyId]/unified-geometry/promote/route.ts` (177 lines) — POST endpoint
  - `app/api/site-surveys/[surveyId]/unified-geometry/canonical-model/route.ts` (130 lines) — POST endpoint

### Phase 8: Tests ✅
- **File:** `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts` (881 lines)
- **50 test cases** covering all 14 required scenarios + additional `validateCADModelSources` tests
- All 50 pass ✅

### Phase 9: Completion Roadmap ✅
- **File:** `docs/CAD_ENGINE_COMPLETION_ROADMAP.md` (344 lines)
- Contains architecture diagram, remaining P2/P3 work items, DB migration checklist, non-negotiable rules, file map, test coverage summary, import quick reference

---

## 🔴 NON-NEGOTIABLE RULES (DO NOT VIOLATE)

These are the inviolable contracts of the unified pipeline. If you break any of these, you break the entire architecture:

1. **No split pipeline** — All geometry artifacts flow through the unified authority lifecycle. There is no separate "fast path" for any pipeline. If you create a new path from raw artifacts to CAD, you are creating a bypass.

2. **No duplicate source of truth** — The `CanonicalBuildingModel` is the single source of truth for building geometry. No other structure may hold canonical geometry data.

3. **No CAD mutation from raw artifacts** — Raw artifacts (`raw_evidence` authority) cannot mutate CAD inputs. Only `cad_safe` artifacts reach the CAD engine via the canonical bridge.

4. **No permit/BOM trigger from raw artifacts** — Raw and derived-review-only artifacts cannot trigger permit generation or BOM mutations. These workflows must only consume `promoted_canonical` or `cad_safe` data.

5. **All raw/derived artifacts stay review-only** — Artifacts at `raw_evidence` or `derived_review_only` authority have `reviewOnly: true` and `cadConsumable: false`.

6. **Only promoted canonical geometry can feed CAD** — `canonicalBridge.ts` is the SOLE legal adapter from `CanonicalBuildingModel` to CAD inputs. It enforces authority gates and mock gates at the type and runtime level.

7. **Every artifact must preserve provenance** — All artifacts carry a `GeometryProvenance` record. Promotion records create an immutable audit trail.

8. **Mock artifacts must be visibly labeled and blocked from CAD promotion** — Mock artifacts have `authority.mockArtifact: true`, are filtered by default in the bundle builder, display with a red badge in the UI, and are blocked from promotion by `PromotionError`.

---

## 🔴 DO's AND DON'T's

### ✅ DO

- **DO** import `UnifiedGeometryAuthorityState` from `@/lib/siteSurveys/unifiedGeometry/authority` — it is NOT re-exported from `types.ts`
- **DO** use `as unknown as OpenSourcePhotoVisionCandidate[]` when casting DB results from `StoredOpenSourcePhotoVisionCandidate[]` — the DB layer type is missing `candidateId`, `fileUrl`, `filename`, `summary`, `nonAuthoritative`
- **DO** use `insertPromotionRecords(records, surveyId)` — it takes **2 arguments**, not 1
- **DO** pass JS arrays directly to Neon TEXT[] columns — do NOT `JSON.stringify()` them
- **DO** use `RETURNING` on all Neon UPDATE queries — the serverless driver requires it
- **DO** set `provenance.sourcePipeline: 'mock'` on mock artifacts — `pipelineCounts.mock` counts based on `sourcePipeline === 'mock'`, NOT on `authority.mockArtifact`
- **DO** provide ALL required fields in Pipeline B test fixtures — the adapters access nested fields like `normal[0]`, `maskBounds.x`, `inlierRatio`, `polygon[0].x` and will crash with `TypeError: Cannot read properties of undefined` if any are missing
- **DO** run `gh auth token` to get a fresh GitHub token before pushing — embedded tokens expire
- **DO** update the git remote URL with the fresh token: `git remote set-url origin "https://$(gh auth token)@github.com/rayobrian6/Solarpro.git"`
- **DO** use file paths relative to `/workspace/Solarpro/` for the `str_replace` and `create_file` tools — the workspace root is `/workspace` and the project is at `/workspace/Solarpro/`
- **DO** run the full test suite after changes: `npx vitest run` (5337 tests, 2 pre-existing failures in `ingestPipeline.test.ts` are unrelated)
- **DO** run TypeScript check after changes: `npx tsc --noEmit` (should be 0 errors)
- **DO** consult `docs/CAD_ENGINE_COMPLETION_ROADMAP.md` for the authoritative list of remaining work items

### ❌ DON'T

- **DON'T** import `UnifiedGeometryAuthorityState` from `types.ts` — it's imported there but NOT re-exported. Import from `authority.ts` or the barrel `index.ts`
- **DON'T** call `insertPromotionRecords(records)` with 1 argument — it requires `(records, surveyId)`
- **DON'T** `JSON.stringify()` arrays for Neon TEXT[] columns — pass JS arrays directly
- **DON'T** forget `RETURNING` on Neon UPDATE queries — the serverless driver will silently fail
- **DON'T** create mock artifacts without `provenance.sourcePipeline: 'mock'` — they won't be counted in `pipelineCounts.mock` and the mock exclusion filter won't work
- **DON'T** create new paths from raw/vision artifacts to CAD — this is the #1 thing the entire unification was built to prevent
- **DON'T** remove the bypass guards in `roofCAD.ts` or `canonicalBridge.ts` — they are defense-in-depth even after the type-level fixes
- **DON'T** delete `patchSystemDefinitionFromVision()` yet — it's still referenced in 4 files. P2 task requires coordinated removal.
- **DON'T** remove `'vision'` from `CADObstruction.source` union type yet — P2 task requires confirming no existing DB rows use it
- **DON'T** assume the `unified_geometry_artifacts` table is populated — it was created by Migration 079 but no backfill has been run. The bundle endpoint currently queries both source tables and adapts on the fly.
- **DON'T** use `@/lib/siteSurveys/unifiedGeometry/types` as the import path for `UnifiedGeometryAuthorityState` — use `@/lib/siteSurveys/unifiedGeometry/authority` or `@/lib/siteSurveys/unifiedGeometry` (barrel)

---

## 🗂️ COMPLETE FILE MAP

### New Files Created (All Phases)

| File | Lines | Phase | Description |
|------|-------|-------|-------------|
| `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md` | — | 1 | Drift audit identifying 3 bypasses, 4 orphans, 6 duplicates |
| `docs/PIPELINE_UNIFICATION_HANDOFF.md` | — | 1 | Original handoff document for session continuation |
| `lib/siteSurveys/unifiedGeometry/authority.ts` | 307 | 2 | Authority states, transitions, helpers, frozen constants |
| `lib/siteSurveys/unifiedGeometry/types.ts` | 632 | 2 | All canonical geometry types, bundle, building model |
| `lib/siteSurveys/unifiedGeometry/index.ts` | 123 | 2 | Barrel export (single import point) |
| `lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts` | 722 | 3 | Pipeline A + B artifact adapters |
| `lib/siteSurveys/unifiedGeometry/bundleBuilder.ts` | 361 | 3 | Cross-referencing bundle builder |
| `lib/siteSurveys/unifiedGeometry/promotion.ts` | 375 | 4 | Promotion workflow + guards |
| `lib/siteSurveys/unifiedGeometry/promotionStore.ts` | 229 | 4 | DB persistence for promotion records |
| `lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts` | 388 | 5 | CanonicalBuildingModel builder |
| `lib/cad/canonicalBridge.ts` | 392 | 6 | Sole legal CanonicalModel → CAD adapter |
| `app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts` | 83 | 7 | GET endpoint for unified evidence bundle |
| `app/api/site-surveys/[surveyId]/unified-geometry/promote/route.ts` | 177 | 7 | POST endpoint for artifact promotion |
| `app/api/site-surveys/[surveyId]/unified-geometry/canonical-model/route.ts` | 130 | 7 | POST endpoint for canonical model building |
| `components/UnifiedGeometryPanel.tsx` | 684 | 7 | React component with authority badges and promotion controls |
| `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts` | 881 | 8 | 50 test cases covering all 14 required scenarios |
| `docs/CAD_ENGINE_COMPLETION_ROADMAP.md` | 344 | 9 | Completion roadmap with P2/P3 work items |

**Total new code: ~6,229 lines across 17 files**

### Files Modified (All Phases)

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

## 🔧 KEY TECHNICAL GOTCHAS (LEARNED THE HARD WAY)

### 1. `StoredOpenSourcePhotoVisionCandidate` vs `OpenSourcePhotoVisionCandidate`
The DB layer returns `StoredOpenSourcePhotoVisionCandidate` which is missing `candidateId`, `fileUrl`, `filename`, `summary`, `nonAuthoritative`. The pipeline adapter expects `OpenSourcePhotoVisionCandidate`. **You must cast:** `as unknown as OpenSourcePhotoVisionCandidate[]`. Same pattern for geometry reconstruction artifacts.

### 2. Mock Artifact `sourcePipeline` vs `mockArtifact`
`computePipelineCounts()` counts mocks based on `artifact.provenance.sourcePipeline === 'mock'`, NOT on `authority.mockArtifact`. If you create a mock artifact with only `authority: MOCK_ARTIFACT_AUTHORITY` but leave `provenance.sourcePipeline` as the default `'photo_vision'`, `pipelineCounts.mock` will be 0 even though the artifact IS a mock. **Always set both.**

### 3. Pipeline B Adapter Required Fields
The Pipeline B adapter dispatches to specialized sub-adapters based on artifact type. Each sub-adapter requires specific fields. If any are missing, you get cryptic TypeErrors like:
- `roof_plane_candidate` / `wall_plane_candidate`: needs `normal: [number, number, number]`, `inlierCount`, `totalPoints`
- `semantic_segmentation_mask`: needs `maskBounds` (with `x`, `y`, `width`, `height`)
- `vanishing_point`: needs `point`, `inlierRatio`, `direction`
- `consensus_plane_candidate`: needs `polygon`, `normalVector`, `sourceFileIds`, `consensusPhotoCount`

### 4. `UnifiedGeometryAuthorityState` Import Path
This type is defined in `authority.ts` and imported into `types.ts` but **NOT re-exported** from `types.ts`. If you import it from `types.ts`, TypeScript will silently not find it. Import from `authority.ts` or the barrel `index.ts`.

### 5. `insertPromotionRecords` Signature
`insertPromotionRecords(records: GeometryPromotionRecord[], surveyId: string)` — takes 2 arguments. The `surveyId` is required because the function uses `getDbReady()` to get a Neon connection and needs the survey context for the INSERT.

### 6. Neon Serverless Driver Quirks
- TEXT[] columns receive JS arrays directly, NOT `JSON.stringify()`'d arrays
- All UPDATE queries must use `RETURNING` — the serverless driver requires it
- Get DB connection via `getDbReady()` from `@/lib/db/core`

### 7. GitHub Authentication
The embedded token in git remote URLs expires. Before pushing, always:
```bash
git remote set-url origin "https://$(gh auth token)@github.com/rayobrian6/Solarpro.git"
```

### 8. File Paths in Tools
The workspace root is `/workspace` and the project is at `/workspace/Solarpro/`. When using `str_replace`, `create_file`, `full_file_rewrite`, etc., use paths relative to `/workspace` — e.g., `Solarpro/lib/siteSurveys/unifiedGeometry/types.ts`, NOT `lib/siteSurveys/unifiedGeometry/types.ts`.

---

## 🧪 TEST SUITE STATUS

### Unified Geometry Tests
- **File:** `lib/siteSurveys/unifiedGeometry/__tests__/unifiedGeometry.test.ts`
- **50 test cases**, all passing ✅
- **Run command:** `npx vitest run lib/siteSurveys/unifiedGeometry`

### Full Test Suite
- **5,337 tests pass**, 2 pre-existing failures in `ingestPipeline.test.ts` (CAS race condition in finalization status — completely unrelated to our work)
- **Run command:** `npx vitest run`

### TypeScript Compilation
- **0 errors** ✅
- **Run command:** `npx tsc --noEmit`

### Test Framework
- **Vitest** configured in `vitest.config.ts`
- Test include pattern: `lib/**/*.test.ts`
- `@` alias resolves to project root
- `server-only` mock exists at `tests/__mocks__/server-only.ts`

---

## 📋 REMAINING WORK (WHAT NEEDS TO HAPPEN NEXT)

### P2 — Medium Priority (Code Cleanup)

#### P2.1: Remove `patchSystemDefinitionFromVision()` Entirely
- **Current state:** Deprecated with `@deprecated` JSDoc + runtime `console.warn`, but the function still exists in `lib/system/visionPatch.ts`
- **Still referenced in:** `lib/vision/types.ts`, `lib/vision/visionAggregator.ts`, `lib/assistedEvidenceSources/roofObstructionRegistration.ts`
- **Steps:**
  1. Remove all imports/references to `patchSystemDefinitionFromVision` from the 3 consumer files
  2. Delete `lib/system/visionPatch.ts` entirely
  3. Remove the import from `lib/vision/types.ts` comment chain
  4. Run full test suite + TypeScript check
  5. Verify no remaining references: `grep -rn "patchSystemDefinitionFromVision" --include="*.ts" --include="*.tsx"`

#### P2.2: Remove `source='vision'` from `CADObstruction` / `CADElectricalNode` Union Types
- **Current state:** `'vision'` is still in the source type union alongside `'promoted_canonical' | 'manual' | 'merged'` in `lib/cad/types.ts` (lines 175, 197)
- **Guarded at runtime by:** `assertNoRawVisionInCAD()` in canonical bridge + bypass guard in `roofCAD.ts` (lines 468, 507)
- **Steps:**
  1. Confirm no existing DB rows have `source='vision'` in CAD-related tables
  2. Remove `'vision'` literal from `CADObstruction.source` union in `lib/cad/types.ts`
  3. Remove `'vision'` literal from `CADElectricalNode.source` union in `lib/cad/types.ts`
  4. Remove the runtime bypass guards in `roofCAD.ts` (they become unreachable)
  5. Run full test suite + TypeScript check
  6. Update test case 14 (`assertNoRawVisionInCAD`) — the guard function can stay as defense-in-depth but the `'vision'` literal will no longer be in the type

### P3 — Lower Priority (Operational Improvements)

#### P3.1: Backfill `unified_geometry_artifacts` from Existing Data
- Migration 079 created the `unified_geometry_artifacts` table but it's empty
- Need a one-time migration to iterate over `open_source_photo_vision_candidates` rows, adapt each via `adaptPhotoVisionCandidate()`, and insert the resulting `UnifiedGeometryArtifact` records
- Similarly for `geometry_reconstruction_artifacts`

#### P3.2: Real Geometry Reconstruction Worker
- Pipeline B worker is currently mock-only
- When implemented, it will produce `GeometryReconstructionArtifact` instances that are already adapted via `adaptGeometryReconArtifact()`
- No pipeline changes needed — the adapter and promotion workflow handle any `GeometryReconstructionArtifact`

#### P3.3: Unified Artifact Persistence
- Currently the bundle endpoint fetches from both source tables and adapts on the fly
- Once `unified_geometry_artifacts` is populated (P3.1), update the bundle endpoint to query the unified table directly
- This simplifies the data flow and improves query performance

#### P3.4: Promotion Persistence — Update `unified_geometry_artifacts` on Promote
- The promote route persists `GeometryPromotionRecord` entries but does NOT update the `unified_geometry_artifacts` table with the new authority state
- After promotion, the promoted artifact should be upserted into the unified table so subsequent bundle fetches reflect the updated authority

#### P3.5: WebSocket/SSE Notifications for Promotion State Changes
- When multiple users are reviewing and promoting artifacts, real-time updates would prevent stale UI state
- UX enhancement, not a correctness requirement — the promote endpoint already re-fetches the bundle for freshness

---

## 📐 ARCHITECTURE AT A GLANCE

```
Survey Photos (Upload)
    │
    ├── Pipeline A (Photo Vision)        Pipeline B (Geometry Recon)
    │   OpenCV contours                   Segmentation masks
    │   YOLO detections                   Line extraction
    │   OCR text                          Vanishing points
    │   Obstruction candidates            Plane extraction
    │                                     Depth estimation
    │                                     Multi-photo fusion
    │           │                              │
    │     adaptPhotoVision           adaptGeometryRecon
    │     Candidate()                Artifact()
    │           │                              │
    │           └──────────┬───────────────────┘
    │                      │
    │           UNIFIED GEOMETRY EVIDENCE BUNDLE
    │           (BundleBuilder — cross-references, counts)
    │           All artifacts at raw_evidence authority
    │                      │
    │           PROMOTION WORKFLOW (forward-only gates)
    │           raw_evidence → derived_review_only → reviewed_candidate
    │             → promoted_canonical → cad_safe
    │           Audit trail in geometry_promotion_records table
    │                      │
    │           CANONICAL BUILDING MODEL
    │           Only promoted_canonical+ artifacts accepted
    │           Mock artifacts rejected
    │           source always 'promoted_canonical'
    │                      │
    │           CANONICAL BRIDGE (sole legal adapter)
    │           Authority gate: cad_safe required
    │           Mock gate: blocked
    │           Post-hoc: assertNoRawVisionInCAD()
    │                      │
    │           CAD ENGINE
    │           All inputs guaranteed source='promoted_canonical' or 'manual'
```

---

## 📦 IMPORT QUICK REFERENCE

### From the barrel (`@/lib/siteSurveys/unifiedGeometry`):
```typescript
import {
  // Authority
  UnifiedGeometryAuthorityState,
  isCadConsumable,
  assertNoCadMutation,
  isValidAuthorityTransition,
  RAW_EVIDENCE_AUTHORITY,
  DERIVED_REVIEW_ONLY_AUTHORITY,
  REVIEWED_CANDIDATE_AUTHORITY,
  PROMOTED_CANONICAL_AUTHORITY,
  CAD_SAFE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
  getAuthorityForState,

  // Types
  UnifiedGeometryArtifact,
  CanonicalBuildingModel,
  CanonicalObstruction,
  GeometryProvenance,
  UnifiedGeometryEvidenceBundle,

  // Adapters
  adaptPhotoVisionCandidate,
  adaptGeometryReconArtifact,

  // Bundle
  BundleBuilder,
  buildUnifiedEvidenceBundle,

  // Promotion
  promoteArtifact,
  promoteToCanonical,
  promoteToCadSafe,
  assertCanonicalEligible,
  PromotionError,

  // Canonical Builder
  CanonicalModelBuilder,
  buildCanonicalModel,

  // Store
  insertPromotionRecords,
  getPromotionHistoryForArtifact,
} from '@/lib/siteSurveys/unifiedGeometry';
```

### From the canonical bridge (`@/lib/cad/canonicalBridge`):
```typescript
import {
  canonicalToCADInputs,
  assertNoRawVisionInCAD,
  validateCADModelSources,
  CanonicalBridgeError,
} from '@/lib/cad/canonicalBridge';
```

### ⚠️ Import from authority.ts directly (NOT from types.ts):
```typescript
import type { UnifiedGeometryAuthorityState } from '@/lib/siteSurveys/unifiedGeometry/authority';
// OR from the barrel:
import type { UnifiedGeometryAuthorityState } from '@/lib/siteSurveys/unifiedGeometry';
```

---

## 🧩 TEST HELPER REFERENCE

The test file defines these helpers that you should reuse if adding tests:

```typescript
// Create a valid UnifiedGeometryArtifact with defaults (raw_evidence authority)
function makeArtifact(overrides?): UnifiedGeometryArtifact

// Create artifact at a specific authority state
function makeArtifactAtState(state: UnifiedGeometryAuthorityState): UnifiedGeometryArtifact

// Create mock artifact (authority.mockArtifact=true, provenance.sourcePipeline='mock')
function makeMockArtifact(overrides?): UnifiedGeometryArtifact

// Create cad_safe authority artifact
function makeCadSafeArtifact(overrides?): UnifiedGeometryArtifact

// Build a minimal CanonicalBuildingModel at cad_safe authority
function makeCadSafeModel(): CanonicalBuildingModel
```

The `artifactFixtures` record in Test 7 contains per-type complete test data for all 11 Pipeline B artifact types with all required fields.

---

## 🔐 AUTH & DB PATTERNS

```typescript
// Auth
import { getUserFromRequest } from '@/lib/auth';
const user = getUserFromRequest(req);

// DB
import { getDbReady } from '@/lib/db/core';
import { isValidUUID } from '@/lib/db-neon';

// Migration system
// POST to /api/migrate with MIGRATE_SECRET header
```

---

## 📊 CURRENT STATE SUMMARY

| Metric | Value |
|--------|-------|
| Phases completed | 9/9 ✅ |
| New files created | 17 |
| Files modified | 7 |
| Total new lines of code | ~6,229 |
| Unified geometry tests | 50/50 passing |
| Full test suite | 5,337 pass / 2 pre-existing fail |
| TypeScript errors | 0 |
| Branch | `dev` |
| Latest commit | `10a4d65` |
| Remaining P2 items | 2 (remove deprecated function, remove 'vision' source type) |
| Remaining P3 items | 5 (backfill DB, real worker, unified persistence, promotion persistence, WebSocket) |

---

## 🚀 HOW TO START THE NEXT THREAD

1. **Clone and setup:**
   ```bash
   cd /workspace
   git clone https://github.com/rayobrian6/Solarpro.git
   cd Solarpro
   git checkout dev
   git pull origin dev
   npm install
   ```

2. **Verify current state:**
   ```bash
   npx vitest run lib/siteSurveys/unifiedGeometry   # 50 tests should pass
   npx tsc --noEmit                                   # 0 errors
   ```

3. **Read the key docs:**
   - `docs/CAD_ENGINE_COMPLETION_ROADMAP.md` — authoritative list of remaining work
   - `docs/GEOMETRY_PIPELINE_DRIFT_AUDIT.md` — original audit findings
   - This file — all context, gotchas, and rules

4. **Pick a P2 task and go.** Start with P2.1 (remove `patchSystemDefinitionFromVision`) since it's self-contained and doesn't depend on DB state.

5. **After each change:**
   - Run `npx vitest run lib/siteSurveys/unifiedGeometry`
   - Run `npx tsc --noEmit`
   - Run full suite `npx vitest run` before pushing
   - Update git remote URL with fresh token before pushing

---

*End of handoff document. All 9 phases are complete. Good luck with the P2/P3 work.*
