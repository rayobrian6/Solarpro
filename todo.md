# SolarPro CAD Visual Recovery — Implementation Plan

## Part 1: Create candidateSuppression.ts
- [x] Create `lib/assistedEvidenceSources/candidateSuppression.ts` with NMS, confidence gating, geometry score gating, top-K per class, global cap

## Part 2: Integrate suppression into geometryRefinement.ts
- [x] Add import of suppression types/functions
- [x] Add `disposition` and `suppressionReason` fields to `RefinedCandidate`
- [x] Add `SuppressionConfig` to `RefinementConfig`
- [x] Add Stage 5: suppression after scoring
- [x] Extend `RefinedGeometryBundle` with suppression summary fields

## Part 3: Update PhotoVisionOverlayRenderer.tsx
- [x] Add `showSuppressed` debug toggle prop
- [x] Default to showing only `trusted` candidates in refined mode
- [x] When debug toggle is on, show suppressed candidates with dashed styling
- [x] Add suppression warning banner when candidates are suppressed

## Part 4: Write suppression tests
- [x] Create `lib/assistedEvidenceSources/candidateSuppression.test.ts` covering NMS, confidence gating, top-K, global cap
- [x] Add suppression integration tests to existing geometryRefinement test file

## Part 5: Validation
- [x] Run `npx vitest run` — 90 tests pass (26 suppression + 64 geometry refinement)
- [x] Run `npx tsc --noEmit` — clean, zero errors
- [x] Build — `npx next build` succeeds

## Part 6: Before/after evidence
- [x] Run beforeAfterEvidence.ts: 21 → 10 candidates, all visual targets pass (roof ≤4, obstruction ≤8, equipment ≤4, total ≤16)

## Part 7: Write final report (10 sections)
- [x] Written to CAD_VISUAL_RECOVERY_REPORT.md

## Part 8: Push to GitHub
- [x] Pushed commit d57b7b1 to dev branch
