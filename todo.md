# Real Geometry Reconstruction Worker — Task Tracker

## Phase 1: Semantic Segmentation Layer ✅
- [x] Extend types.ts with SemanticSegmentationMask (polygon-based, class labels)
- [x] Extend types.ts with SegmentationClass, NormalizedPoint, StructuralLineType
- [x] Extend types.ts with StructuralLineCandidate, VanishingPointArtifact, ConsensusPlaneCandidate
- [x] Extend types.ts ARTIFACT_TYPE_DISCRIMINATORS with new discriminators
- [x] Extend types.ts GeometryReconstructionArtifact union with new types
- [x] Extend types.ts pipeline type with new pipeline names
- [x] Add validators in schemas.ts for 4 new artifact types
- [x] Update schemas.ts VALIDATOR_MAP with new discriminators
- [x] Update index.ts barrel exports for new types/validators
- [x] Create workers/segmentation/runSegmentationWorker.ts
- [x] Create workers/segmentation/index.ts
- [x] Create __tests__/segmentationWorker.test.ts (57 tests)
- [x] Run jest + tsc (217 pass, tsc clean)
- [x] Commit: `feat: segmentation worker — polygon mask extraction` (b5452e9)

## Phase 2: Mask Cleanup
- [ ] Create workers/segmentation/maskCleanup.ts
- [ ] Implement hole filling, tiny region removal, island removal, contour smoothing
- [ ] Create __tests__/maskCleanup.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: mask cleanup — hole fill, island removal, smoothing`

## Phase 3: Line Extraction
- [ ] Create workers/lineExtraction/runLineExtractionWorker.ts
- [ ] Implement Hough transform, line clustering, ridge/eave/rake detection
- [ ] Add validators in schemas.ts (already have StructuralLineCandidate type)
- [ ] Create __tests__/lineExtractionWorker.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: line extraction — Hough, ridge/eave/rake/wall_vertical`

## Phase 4: Vanishing Points
- [ ] Create workers/perspective/estimateVanishingPoints.ts
- [ ] Implement RANSAC-based VP estimation (X, Y, vertical)
- [ ] Add validators in schemas.ts (already have VanishingPointArtifact type)
- [ ] Create __tests__/vanishingPointEstimation.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: vanishing point estimation — RANSAC X/Y/vertical`

## Phase 5: Plane Extraction
- [ ] Create workers/planeExtraction/runPlaneExtractionWorker.ts
- [ ] Implement roof plane extraction (roof mask + supporting lines)
- [ ] Implement wall plane extraction (wall mask + vertical support)
- [ ] Add validators in schemas.ts (already have ConsensusPlaneCandidate type)
- [ ] Create __tests__/planeExtractionWorker.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: plane extraction — roof/wall from masks + lines`

## Phase 6: Depth Estimation
- [ ] Create workers/depth/runDepthWorker.ts
- [ ] Integrate depth as support-only (not override segmentation)
- [ ] Create __tests__/depthWorker.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: depth estimation — support-only depth worker`

## Phase 7: Multi-Photo Fusion
- [ ] Create workers/multiViewFusion/runMultiViewFusion.ts
- [ ] Implement ORB feature matching, homography estimation
- [ ] Implement consensus plane merging
- [ ] Create __tests__/multiViewFusionWorker.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: multi-photo fusion — consensus plane merging`

## Phase 8: UI Preview Updates
- [ ] Add toggle: Masks / Lines / Planes / Depth / Consensus
- [ ] Display pitch, azimuth, confidence, provenance
- [ ] Update GeometryReconstructionPreview.tsx
- [ ] Create __tests__/geometryReconstructionPreviewV2.test.tsx
- [ ] Run jest + tsc
- [ ] Commit: `feat: geometry preview V2 — toggles, provenance, masks/lines/planes`

## Phase 9: Performance / Async / Heartbeat
- [ ] Add heartbeat column to jobs table (migration)
- [ ] Add stage_timings + worker_version columns to artifacts table
- [ ] Implement async job execution with heartbeat updates
- [ ] Create __tests__/jobHeartbeat.test.ts
- [ ] Run jest + tsc
- [ ] Commit: `feat: async jobs with heartbeat support`

## Phase 10: Regression
- [ ] Run full jest suite
- [ ] Run tsc --noEmit
- [ ] Verify no regressions
- [ ] Push to GitHub
