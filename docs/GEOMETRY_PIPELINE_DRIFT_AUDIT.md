# Geometry Pipeline Drift Audit — SolarPro

**Date**: 2025-01-29  
**Scope**: All geometry-related files, routes, DB tables, APIs, UI components  
**Status**: Phase 1 Deliverable  

---

## 1. Executive Summary

SolarPro currently has **two partially overlapping geometry-related pipelines** that must not remain split:

1. **Open-Source Photo Vision Pipeline** (Pipeline A) — OpenCV, YOLO, OCR, raw candidates, refined overlays, roof edge candidates, obstruction candidates
2. **Geometry Reconstruction Pipeline** (Pipeline B) — segmentation, mask cleanup, line extraction, vanishing points, plane extraction, depth estimation, multi-photo fusion, async jobs, geometry preview artifacts

The audit reveals **3 critical bypasses**, **4 orphaned systems**, **6 duplicate concepts**, and **2 conflicting artifact naming schemes**. The current architecture allows raw vision artifacts to reach CAD without review-state enforcement, violating the non-negotiable rule that only promoted canonical geometry can feed CAD.

---

## 2. Current Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SURVEY PHOTOS (Upload)                          │
│                           site_survey_files                            │
└────────────┬──────────────────────────────────┬────────────────────────┘
             │                                  │
    ┌────────▼─────────┐              ┌─────────▼──────────┐
    │   PIPELINE A     │              │    PIPELINE B      │
    │  Photo Vision    │              │  Geometry Recon    │
    │                  │              │                    │
    │ OpenCV contours  │              │ Segmentation masks │
    │ YOLO detections  │              │ Line extraction    │
    │ OCR text extract │              │ Vanishing points   │
    │ Raw candidates   │              │ Plane extraction   │
    │ Refined overlays │              │ Depth estimation   │
    │ Obstruction reg  │              │ Multi-photo fusion │
    │                  │              │ Async job queue    │
    └──┬──────┬───────┘              └────────┬───────────┘
       │      │                               │
       │      │ (BYPASS PATH ⚠️)              │
       │      ▼                               │
       │  site_survey_files                  │
       │  .obstruction_data                  │
       │      │                               │
       │      ▼                               │
       │  Evidence Manifest                  │
       │  .obstructionData                   │
       │      │                               │
       │      ▼                               │
       │  permitIntegration()                │
       │  engineeringBridge                  │
       │      │                               │
       │      ▼                               │
       │  CAD Engine (via                    │
       │  CADObstruction.source              │
       │  = 'vision') ⚠️                     │
       │                                     │
       │                              ┌──────▼──────────┐
       │                              │  MOCK ONLY      │
       │                              │  No real worker │
       │                              │  Review-only    │
       │                              │  artifacts in   │
       │                              │  DB table       │
       │                              └─────────────────┘
       │
       │  (ORPHANED PATH — defined, never called)
       │      ▼
       │  patchSystemDefinitionFromVision()
       │  → SystemDefinition.obstructions[]
       │  → SystemDefinition.electricalNodes[]
       │  → CAD Engine (if ever wired)
       │
       ▼
  open_source_photo_vision_candidates
  (DB table — review-only)
```

---

## 3. File Inventory

### 3.1 Pipeline A — Photo Vision (Open-Source)

| File | Purpose | Authority |
|------|---------|-----------|
| `lib/db/openSourcePhotoVision.ts` | DB persistence for vision candidates | Review-only envelope |
| `lib/assistedEvidenceSources/roofObstructionRegistration.ts` | Register obstructions → `site_survey_files.obstruction_data` | ⚠️ BYPASS — writes to JSONB without review state |
| `lib/assistedEvidenceSources/geometryRefinement.ts` | Noise filter → IoU dedup → classify → score | Review-only, never mutates raw |
| `lib/assistedEvidenceSources/overlayCoordinateConversion.ts` | `normalized_image_0_1000` → SVG percent | Review-only |
| `lib/assistedEvidenceSources/geometryCandidateTypes.ts` | Geometry candidate boundary types, limitations | Review-only, 20 limitations |
| `lib/assistedEvidenceSources/candidateAdapterTypes.ts` | Adapter pattern for assisted evidence sources | Review-only |
| `app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/route.ts` | POST start job, GET poll, DELETE cancel | Review-only meta |
| `app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/process/route.ts` | Backward compat process endpoint | Review-only meta |
| `app/api/site-surveys/[surveyId]/open-source-photo-vision-pass/finalize/route.ts` | 6-stage post-processing, CAS lock | Review-only — but stage 3 calls `registerObstructionsForSurvey()` ⚠️ |
| `app/api/site-surveys/[surveyId]/run-cv-worker-pass/route.ts` | Alias for photo-vision-pass | Review-only |
| `app/api/site-surveys/[surveyId]/roof-obstructions/route.ts` | GET query obstruction data from JSONB | Read-only query |
| `app/api/site-surveys/[surveyId]/photo-classification-preview/route.ts` | Vision classification preview | Read-only, no authority |
| `app/api/site-surveys/[surveyId]/photo-classification-preview/apply/route.ts` | Apply operator-reviewed labels | Label-only mutation, no CAD |
| `components/PhotoVisionOverlayRenderer.tsx` | SVG overlay renderer (raw + refined modes) | Review-only UI |

### 3.2 Pipeline B — Geometry Reconstruction

| File | Purpose | Authority |
|------|---------|-----------|
| `lib/siteSurveys/geometryReconstruction/types.ts` | 13 artifact types, authority envelope | Review-only envelope |
| `lib/siteSurveys/geometryReconstruction/mockAdapter.ts` | Mock artifact generator | MOCK ONLY |
| `lib/siteSurveys/geometryReconstruction/index.ts` | Public API re-exports | — |
| `lib/db/geometryReconstruction.ts` | Job + artifact DB persistence | Review-only disclaimer |
| `app/api/site-surveys/[surveyId]/geometry-reconstruction/start/route.ts` | Start job (mock or queued) | Review-only, mock only currently |
| `app/api/site-surveys/[surveyId]/geometry-reconstruction/mock/route.ts` | Convenience mock endpoint | Review-only + MOCK DATA label |
| `app/api/site-surveys/[surveyId]/geometry-reconstruction/artifacts/route.ts` | GET artifacts by survey | Review-only |
| `components/GeometryReconstructionPreview.tsx` | V2 research-spike UI with filters | Review-only badges |

### 3.3 Orphaned Systems (Defined, Never Consumed)

| File | Type | Status |
|------|------|--------|
| `lib/siteSurvey/evidenceDerivedCadReconstruction.ts` | `EvidenceDerivedCadReconstructionV1` + `EvidenceReconstructionNoAuthorityV1` | ORPHANED — not consumed downstream |
| `lib/siteSurvey/geometryIntelligence.ts` | `GeometryIntelligenceReportV1` with risk scores | ORPHANED — not wired |
| `lib/siteSurvey/geometryReviewWorkflow.ts` | `GeometryReviewLifecycleStateV1` + recommendations | ORPHANED — not wired |
| `lib/system/visionPatch.ts` | `patchSystemDefinitionFromVision()` | ORPHANED — defined but never called from any route |

### 3.4 Shared Infrastructure

| File | Purpose |
|------|---------|
| `lib/survey/evidence/manifest.ts` | `SurveyEvidenceManifest` — canonical evidence builder |
| `lib/survey/evidence/provenance.ts` | `SurveyEvidenceTraceabilityBundle` — provenance tracking |
| `lib/survey/evidence/engineeringBridge.ts` | `SurveyEvidenceEngineeringBridge` — readiness + requirements |
| `lib/survey/evidence/categoryRegistry.ts` | `SurveyEvidenceCategory` + domain + engineering bucket |
| `lib/survey/evidence/engineeringRequirements.ts` | Engineering requirement evaluation |
| `lib/survey/evidence/fieldOrchestration.ts` | Field orchestration flow |
| `lib/survey/evidence/sessionGrouping.ts` | Session grouping for duplicate dedup |
| `lib/siteSurvey/sourceOfTruthCadRender.ts` | `SourceOfTruthCadRenderContextV1` — review-only CAD render context |
| `lib/siteSurvey/planSetRenderOutput.ts` | `PlanSetRenderPackageV1` — SVG plan set preview |
| `lib/siteSurvey/permitIntegration.ts` | `permitIntegration()` — survey → PermitInputPatch |
| `lib/siteSurvey/professionalSurveyReadinessReport.ts` | Readiness report builder |
| `lib/cad/types.ts` | `CADModel`, `CADObstruction`, `CADElectricalNode` |
| `lib/cad/buildCADFromSurvey.ts` | `buildCADFromSurvey()` — EnrichedSiteSurvey → SurveyCADInputs |
| `lib/cad/cadEngine.ts` | CAD solver engine |
| `lib/cad/roof/roofCAD.ts` | Roof-specific CAD logic |
| `app/api/site-surveys/[surveyId]/cad-render-preview/route.ts` | Read-only CAD/SVG preview |
| `app/api/site-surveys/[surveyId]/professional-readiness/route.ts` | Read-only readiness report |
| `app/api/site-surveys/[surveyId]/route.ts` | GET survey detail + evidence manifest |

---

## 4. Duplicate Concepts

| Concept | Pipeline A Location | Pipeline B Location | Conflict |
|---------|-------------------|-------------------|----------|
| **Roof plane candidates** | `refinedCandidate.geometryClass = 'probable_roof_plane'` in `geometryRefinement.ts` | `RoofPlaneCandidate` in `geometryReconstruction/types.ts` | Different type shapes, no shared interface |
| **Obstruction candidates** | `obstruction_candidate` from vision pipeline → `roofObstructionRegistration.ts` | `VanishingPointArtifact`, obstruction-like detection | Pipeline B has no explicit obstruction type but could detect them |
| **Line candidates** | `roof_edge_candidate` from vision → `normalized_image_0_1000` lines | `LineCandidate`, `StructuralLineCandidate` in Pipeline B | Pipeline B has structured line types (ridge/eave/rake); Pipeline A has unstructured edge candidates |
| **Authority envelope** | `OpenSourcePhotoVisionStoredBundle.authority` — `{ reviewOnly, nonAuthoritative, cadMutationAllowed, canonicalMutationAllowed }` | `GeometryReconstructionAuthority` — `{ reviewOnly, nonAuthoritative, cadMutationAllowed, permitGenerationAllowed, bomMutationAllowed }` | **Field names differ**: `canonicalMutationAllowed` vs `permitGenerationAllowed`/`bomMutationAllowed` |
| **Coordinate system** | `normalized_image_0_1000` (0-1000) in `overlayCoordinateConversion.ts` | `normalized_image_0_1000` in Pipeline B types | Same coordinate system — good, but no shared type definition |
| **Obstruction data on evidence** | `SurveyEvidenceItem.obstructionData` (from JSONB) | No obstruction data in Pipeline B | Only Pipeline A populates obstructions on evidence items |

---

## 5. Critical Bypasses

### 5.1 ⚠️ BYPASS: `CADObstruction.source = 'vision'`

**File**: `lib/cad/types.ts:167`

```typescript
export interface CADObstruction {
  source: 'vision' | 'manual' | 'merged';
  // ...
}
```

**Impact**: Raw vision artifacts CAN reach CAD through this type. The `source: 'vision'` enum value signals that a CAD obstruction was sourced from the vision pipeline, but there is no guarantee that the obstruction passed through a review/promotion step. Any code that creates a `CADObstruction` with `source: 'vision'` bypasses the canonical geometry promotion flow.

**Same issue**: `CADElectricalNode.source: 'vision' | 'manual' | 'merged'` at line 182.

**Fix Required**: Remove `'vision'` from the source enum. Replace with `'promoted_canonical'` to indicate the obstruction came from a promoted canonical geometry artifact, not raw vision.

### 5.2 ⚠️ BYPASS: `roofObstructionRegistration` → `site_survey_files.obstruction_data`

**File**: `lib/assistedEvidenceSources/roofObstructionRegistration.ts`

**Flow**:
1. Photo vision finalize (stage 3) calls `registerObstructionsForSurvey()`
2. This writes obstruction records to `site_survey_files.obstruction_data` JSONB column
3. The evidence manifest reads `obstruction_data` into `SurveyEvidenceItem.obstructionData`
4. `permitIntegration()` consumes evidence manifest data
5. Engineering bridge surfaces obstruction evidence to downstream

**Impact**: Obstruction data flows from raw vision candidates → JSONB → evidence manifest → permit integration without any review-state enforcement. The `review_required` status on obstruction records is purely advisory — nothing gates downstream consumption based on review state.

**Fix Required**: Add review-state gating to the obstruction data consumption path. Only obstructions with `reviewState: 'accepted'` should flow to permit/CAD.

### 5.3 ⚠️ BYPASS: `patchSystemDefinitionFromVision()` (Latent)

**File**: `lib/system/visionPatch.ts`

**Status**: Currently orphaned — defined but never called from any route or component.

**Impact**: If this function is ever wired, it would directly merge raw vision obstructions and electrical nodes into `SystemDefinition`, which feeds the CAD engine. The confidence gates (0.55 for obstructions, 0.65 for electrical) are not equivalent to human review. This would create a parallel path around the canonical geometry promotion flow.

**Fix Required**: If this function is to be used, it must ONLY accept `promoted_canonical` authority artifacts, not raw vision results.

---

## 6. Orphaned Systems — Detailed

### 6.1 `EvidenceDerivedCadReconstructionV1`

**File**: `lib/siteSurvey/evidenceDerivedCadReconstruction.ts`

Defines:
- `EvidenceReconstructionNoAuthorityV1` — extremely restrictive (readOnly, reviewOnly, all mutation flags false)
- `EvidencePhotoFrameV1` — photo-aligned spatial frame
- `EvidenceDerivedCandidateV1` — individual spatial candidate with confidence and source photo
- `buildEvidenceDerivedCadReconstruction()` — builder function

**Why orphaned**: This type was designed to be the bridge between evidence manifest and CAD reconstruction, but no downstream system imports or consumes it. The `planSetRenderOutput.ts` calls `buildEvidenceDerivedCadReconstruction()` but only to populate `SourceOfTruthDesignHandoffV1.candidates` which is also review-only and unconsumed by CAD.

### 6.2 `GeometryIntelligenceReportV1`

**File**: `lib/siteSurvey/geometryIntelligence.ts`

Defines:
- `GeometryIntelligenceReportV1` with quality scores, risk signals, discrepancy clusters
- `noAuthorityEnforcement` block
- `buildGeometryIntelligenceReport()` — builder function

**Why orphaned**: Designed to assess geometry quality and surface risk signals, but no route or component calls the builder. The report would be valuable for the review/promotion workflow but is not wired.

### 6.3 `GeometryReviewWorkflow`

**File**: `lib/siteSurvey/geometryReviewWorkflow.ts`

Defines:
- `GeometryReviewLifecycleStateV1` — lifecycle states (raw, reviewed, promoted, rejected)
- `GeometryReviewRecommendationV1` — review recommendations based on intelligence reports
- `noAuthorityEnforcement` block

**Why orphaned**: This is exactly the review/promotion system that the unified pipeline needs, but it's defined and never consumed. The Phase 4 promotion workflow should build on this foundation.

### 6.4 `patchSystemDefinitionFromVision()`

**File**: `lib/system/visionPatch.ts`

Maps `VisionAggregationResult → SystemDefinition` with:
- Obstruction confidence gate (0.55)
- Electrical node confidence gate (0.65)
- Plane correction confidence gate (0.70)
- Audit logging with `[SYSDEF PATCH]` prefix

**Why orphaned**: The vision aggregator pipeline was built but the final step — patching SystemDefinition — was never wired into any route. This is a safety-critical gap because wiring it without review gating would create a raw-vision-to-CAD bypass.

---

## 7. Conflicting Artifact Names

| Pipeline A Name | Pipeline B Name | Semantic Meaning |
|----------------|----------------|------------------|
| `obstruction_candidate` | No equivalent | Obstruction detected by vision |
| `roof_edge_candidate` | `ridge_line_candidate`, `eave_line_candidate`, `rake_line_candidate` | Roof structural lines |
| `rectangular_region_candidate` | `segmentation_mask`, `semantic_segmentation_mask` | Segmented regions |
| `probable_roof_plane` (refined) | `roof_plane_candidate` | Roof plane with geometry |
| `probable_wall_plane` (refined) | `wall_plane_candidate` | Wall plane with geometry |
| `probable_obstruction` (refined) | No equivalent | Refined obstruction |
| No equivalent | `depth_map` | Depth estimation |
| No equivalent | `sfm_point_cloud` | Structure from Motion |
| No equivalent | `consensus_plane_candidate` | Multi-photo consensus |
| No equivalent | `vanishing_point` | Vanishing point detection |
| No equivalent | `structural_line_candidate` | Structured line with type |

**Issue**: The same geometric concept (roof plane, wall plane, roof line) has different type names and shapes across pipelines. The unified contract must define canonical names.

---

## 8. DB Tables and Relationships

```
site_surveys
  ├── site_survey_files
  │     ├── .obstruction_data JSONB ⚠️ (written by Pipeline A, no review gate)
  │     ├── .label TEXT (written by apply route)
  │     └── FK → site_surveys.id
  ├── open_source_photo_vision_candidates (Pipeline A)
  │     ├── id TEXT PK
  │     ├── survey_id UUID FK → site_surveys.id
  │     ├── file_id UUID FK → site_survey_files.id
  │     ├── tool_name, tool_version, run_hash
  │     ├── candidate_type, candidate_category
  │     ├── payload JSONB
  │     ├── confidence NUMERIC (0-100)
  │     ├── limitations JSONB
  │     ├── review_status TEXT (review_required | accepted_review_reference | rejected)
  │     ├── deterministic_hash TEXT
  │     └── thumbnail_data_url TEXT
  ├── site_survey_geometry_reconstruction_jobs (Pipeline B)
  │     ├── id UUID PK
  │     ├── survey_id UUID FK → site_surveys.id
  │     ├── client_id UUID
  │     ├── pipeline TEXT
  │     ├── status TEXT (queued | running | completed | failed | cancelled)
  │     ├── input JSONB
  │     ├── current_stage TEXT
  │     ├── last_heartbeat_at TIMESTAMPTZ
  │     └── worker_version TEXT
  └── site_survey_geometry_reconstruction_artifacts (Pipeline B)
        ├── id UUID PK
        ├── job_id UUID FK → site_survey_geometry_reconstruction_jobs.id
        ├── survey_id UUID FK → site_surveys.id
        ├── artifact_type TEXT
        ├── artifact_data JSONB
        ├── authority JSONB (review-only envelope)
        ├── stage_timings JSONB
        ├── worker_version TEXT
        └── source_file_ids TEXT[]
```

**Key observations**:
1. Pipeline A candidates have a `review_status` CHECK constraint, but it's only advisory — nothing gates downstream consumption
2. Pipeline B artifacts have an `authority` JSONB field with the review-only envelope
3. `site_survey_files.obstruction_data` is a JSONB column added via ALTER TABLE (not in original schema), written by Pipeline A's registration step without review gating
4. Pipeline B has no real worker — all artifacts are mock-generated
5. There is NO unified table or cross-reference linking Pipeline A candidates to Pipeline B artifacts for the same source photo

---

## 9. UI Component Audit

| Component | Pipeline | Data Source | Authority Display |
|-----------|----------|-------------|-------------------|
| `PhotoVisionOverlayRenderer` | A | `open_source_photo_vision_candidates` | "REVIEW-ONLY / NON-AUTHORITATIVE" in tooltips |
| `GeometryReconstructionPreview` | B | `geometry-reconstruction/artifacts` API | ReviewOnlyBadge, NonAuthoritativeBadge, NoCadMutationBadge |
| `components/survey/ui/ObstructionMap` | A | obstruction data from evidence | Part of survey steps |
| `components/survey/StepObstructions` | A | obstruction data | Part of survey wizard |
| Survey detail page (`route.ts`) | A | `openSourcePhotoVision` field in GET response | Implicit — no badge |

**Issue**: Two separate UI components with no unified flow. A user must navigate between Pipeline A overlays and Pipeline B reconstruction preview separately. There is no unified geometry review workbench.

---

## 10. Missing Ownership Boundaries

| Boundary | Current State | Required State |
|----------|--------------|----------------|
| **CAD input authority** | `CADObstruction.source = 'vision'` allows raw artifacts | Only `source = 'promoted_canonical'` should be accepted |
| **Obstruction data flow** | JSONB written without review gate | Review state must gate downstream flow |
| **Pipeline cross-reference** | No link between Pipeline A and B artifacts for same photo | Unified evidence bundle must link by source photo |
| **Promotion workflow** | Orphaned `GeometryReviewWorkflow` never consumed | Must be the mandatory gate between review and CAD |
| **Canonical geometry model** | Does not exist | `CanonicalBuildingModel` must be the single source of truth |
| **Mock artifact labeling** | Mock artifacts have authority envelope but no visual blocking | Must be visibly labeled and blocked from CAD promotion |

---

## 11. Recommended Unified Architecture

```
Survey Photos
    │
    ▼
Evidence Manifest (SurveyEvidenceManifest — existing, enhanced)
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
Photo Vision Artifacts              Geometry Reconstruction Artifacts
(Pipeline A — raw_evidence)        (Pipeline B — raw_evidence)
    │                                      │
    │    (unifiedGeometry/                  │
    │     UnifiedGeometryEvidenceBundle)    │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    Unified Geometry Evidence Bundle
    (links artifacts by source photo / geometry class)
    authority: derived_review_only
                   │
                   ▼
    Human Review / Promotion Workflow
    (GeometryReviewWorkflow — currently orphaned, must be wired)
                   │
                   ▼ (promoted)
    Canonical Building Model (CanonicalBuildingModel — NEW)
    authority: promoted_canonical / cad_safe
                   │
                   ▼
    CAD Renderer (only consumes CanonicalBuildingModel)
                   │
                   ▼
    Permit Plan Set
```

---

## 12. Priority Fixes

### P0 — Critical (Must fix before any unification)

1. **Remove `source: 'vision'` from `CADObstruction` and `CADElectricalNode`** — Replace with `'promoted_canonical'` to enforce that only reviewed geometry reaches CAD
2. **Gate obstruction data flow** — Add review-state enforcement to `roofObstructionRegistration` consumption path; only `reviewState: 'accepted'` obstructions should flow to permit/CAD
3. **Block `patchSystemDefinitionFromVision` from raw vision input** — If ever wired, must only accept promoted canonical artifacts

### P1 — High (Must fix during unification)

4. **Unify authority envelope types** — Create a single `UnifiedGeometryAuthority` type that replaces both `OpenSourcePhotoVisionStoredBundle.authority` and `GeometryReconstructionAuthority`
5. **Wire `GeometryReviewWorkflow`** — This orphaned system is exactly what the unified pipeline needs for the promotion gate
6. **Wire `GeometryIntelligenceReport`** — Surface risk signals to the review workflow so reviewers have quality context
7. **Create `CanonicalBuildingModel`** — New type that is the single source of truth for CAD consumption

### P2 — Medium (Should fix during unification)

8. **Unify artifact type names** — Create canonical names for overlapping concepts (roof plane, wall plane, lines, obstructions)
9. **Create unified geometry evidence bundle** — New type `UnifiedGeometryEvidenceBundle` that links Pipeline A and B artifacts by source photo
10. **Add cross-pipeline DB references** — Link Pipeline A candidates to Pipeline B artifacts for the same source photo
11. **Add mock artifact visual blocking** — Mock artifacts must be visibly labeled and blocked from CAD promotion in UI

### P3 — Low (Can fix after unification)

12. **Unify UI components** — One geometry review workbench instead of two separate components
13. **Clean up `evidenceDerivedCadReconstruction`** — Either wire it properly or remove it
14. **Add unified geometry tests** — 14 required test cases as specified in the directive

---

## 13. Summary of Findings

| Category | Count | Severity |
|----------|-------|----------|
| Critical bypasses | 3 | P0 — Raw artifacts can reach CAD |
| Orphaned systems | 4 | P1 — Defined but unconsumed, including review workflow |
| Duplicate concepts | 6 | P2 — Same geometry with different type names |
| Conflicting artifact names | 11 | P2 — No unified naming |
| Missing ownership boundaries | 6 | P1 — No gate between raw and canonical |
| DB tables with review-only enforcement | 2 of 3 | P0 — `obstruction_data` JSONB has no review gate |
| Mock-only pipeline | 1 | P2 — Pipeline B has no real worker |
| UI components needing unification | 2+ | P3 — Separate flows for same data |

**Overall Assessment**: The two pipelines were built independently with compatible review-only authority envelopes, but the lack of a unified contract, promotion workflow, and canonical geometry model creates dangerous gaps where raw vision artifacts can bypass review and reach CAD/permit systems. The orphaned `GeometryReviewWorkflow` and `GeometryIntelligenceReport` are exactly the building blocks needed for unification — they just need to be wired.
