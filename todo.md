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
- [x] Run `npx vitest run` — 26 suppression tests + 64 geometry refinement tests pass
- [x] Run `npx tsc --noEmit` — clean, no errors
- [ ] Build if renderer/UI code changed

## Part 6: Before/after evidence
- [ ] Run beforeAfterEvidence.ts and document before/after candidate counts

## Part 7: Write final report (10 sections)
- [ ] Audit findings, ranked to-do, files changed, implementation details, candidate counts, tests, typecheck, what remains, visual safety, mergeability

## Part 8: Push to GitHub
- [ ] `git push` to dev branch
