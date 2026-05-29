# SolarPro CAD Visual Recovery — Final Report

## 1. Audit Findings

### Candidate Generation (96×96 Edge Detection)
The open-source photo vision pipeline in `openSourcePhotoVisionWorker.ts` resizes all photos to 96×96 pixels (`EDGE_SIZE = 96`) before performing Sobel-like gradient computation. The `denseRegions()` function then groups edge pixels into 16×16 grid cells at that reduced resolution. This means each "candidate region" originates from a 6×6 pixel block in the 96×96 space, which maps back to extremely coarse spatial units in the original image. At 4000×3000 source resolution, each grid cell represents approximately a 417×312 pixel area — far too imprecise for CAD-quality geometry.

### Candidate Filtering and Suppression
Prior to this work, the 4-stage geometry refinement pipeline in `geometryRefinement.ts` applied noise filtering, IoU deduplication at 0.35 threshold, heuristic classification, and deterministic scoring. However, it had no mechanism to cap candidate counts, gate on confidence or geometry score thresholds, or perform proper Non-Maximum Suppression. A photo with dense edge activity could produce 20–40+ candidates that would all be rendered as overlays, creating visual noise and user confusion.

### Candidate Type Assignment
Candidate classification is driven by simple index parity: `index % 2 === 0` assigns `rectangular_region_candidate` versus `obstruction_candidate`. The subsequent classification heuristics in `geometryRefinement.ts` refine these into `RefinedGeometryClass` values (roof, wall, equipment, obstruction, ground_noise, text_label, unknown) based on region position, area, and aspect ratio. These heuristics are fragile — a region at the top of the image is classified as roof regardless of actual content.

### Fabricated Confidence Scores
Confidence values are not produced by any statistical model. They are computed deterministically as `clamp(34 + denseRegionCount * 4 - index * 3, 18, 68)`. This means confidence is purely a function of edge density and enumeration order, not evidence quality. Two candidates with identical geometry but different enumeration indices receive different confidence scores by construction.

### Overlay Rendering (SVG Rect-Only)
`PhotoVisionOverlayRenderer.tsx` renders regions exclusively as `<rect>` elements with axis-aligned coordinates. There is no `<polygon>` or `<path>` support, meaning rotated or irregular roof planes cannot be accurately represented. All overlays are normalized to the `normalized_image_0_1000` coordinate system, and the renderer simply maps (x, y, width, height) to SVG rect attributes. Every candidate with `disposition: 'trusted'` (previously all candidates) was rendered with equal visual weight.

### Data Shapes
The core geometry type is `NormalizedRegion` with `{x, y, width, height, coordinateSystem: 'normalized_image_0_1000'}`. Refined candidates carry a `RefinedGeometryClass`, a fabricated confidence score, a geometry score, and the normalized region. The `RefinedGeometryBundle` groups candidates by file. Prior to this work, there was no `disposition` field and no suppression metadata.

---

## 2. Ranked To-Do List

### Immediate Fixes (Completed in This PR)
1. ✅ **Candidate suppression pipeline** — NMS, confidence gating, geometry score gating, top-K per class, global cap
2. ✅ **Debug/trusted overlay separation** — suppressed candidates hidden by default, visible with debug toggle
3. ✅ **Suppression warning banner** — UI shows count of hidden candidates when suppression is active
4. ✅ **Per-class count targets** — roof ≤4, obstruction ≤8, equipment ≤4, total ≤16 per photo
5. ✅ **Comprehensive test coverage** — 26 unit tests + 8 integration tests for suppression behavior

### Near-Term Geometry Fixes (Not in This PR)
6. **Replace 96×96 edge detection** with a higher-resolution pipeline (minimum 512×512) or a proper segmentation model
7. **Replace index-parity classification** with a trained classifier or at minimum a richer heuristic feature set
8. **Replace fabricated confidence scores** with calibrated probabilities from a real model
9. **Add polygon/path overlay rendering** for rotated and irregular roof planes
10. **Integrate depth/normal maps** for 3D-informed candidate generation

### Open-Source Replacement Options (Not in This PR)
11. **Replace entire vision pipeline** with Segment Anything Model (SAM) or similar foundation model
12. **Integrate a solar-specific detection model** fine-tuned on rooftop imagery
13. **Add monocular depth estimation** (MiDaS, DepthAnything) for geometric priors
14. **Implement multi-view consistency** across photo sets for the same property
15. **Connect to canonicalBridge** for CAD-quality geometry production

---

## 3. Files Changed

| File | Action | Lines Changed |
|------|--------|---------------|
| `lib/assistedEvidenceSources/candidateSuppression.ts` | **Created** | 384 new |
| `lib/assistedEvidenceSources/candidateSuppression.test.ts` | **Created** | ~400 new |
| `lib/assistedEvidenceSources/beforeAfterEvidence.ts` | **Created** | ~220 new |
| `lib/assistedEvidenceSources/geometryRefinement.ts` | **Modified** | ~50 added |
| `components/PhotoVisionOverlayRenderer.tsx` | **Modified** | ~80 added |
| `__tests__/geometryRefinement.test.ts` | **Modified** | ~150 added |
| `vitest.config.ts` | **Modified** | 2 lines changed |

---

## 4. Exact Implementation

### `candidateSuppression.ts` — Core Suppression Module

**Interfaces:**
- `SuppressibleCandidate`: `{id, fileId, geometryClass, geometryScore, confidence, region}`
- `SuppressionConfig`: Full configuration object with per-class thresholds, top-K limits, and global cap
- `DEFAULT_SUPPRESSION_CONFIG`: Sensible defaults — ground_noise always suppressed (confidence=100, geometryScore=1.0, topK=0), roof topK=4, obstruction topK=8, equipment topK=4, maxTotalPerFile=16
- `CandidateDisposition`: `'trusted' | 'suppressed'`
- `SuppressedCandidate`: `{candidate, disposition, suppressionReason}`
- `SuppressionResult`: Full result with trusted/suppressed arrays, per-file counts, and `hasSuppressedCandidates` flag

**5-Stage Pipeline (`suppressCandidates()`):**
1. **NMS (`applyNMS`)** — Groups candidates by fileId, sorts by ranking score (default: geometryScore), suppresses overlapping lower-scored candidates within the same geometryClass when IoU ≥ 0.45
2. **Confidence Gate (`applyConfidenceGate`)** — Per-class minimum confidence thresholds (roof: 25, obstruction: 20, equipment: 25, wall: 25, ground_noise: 100, text_label: 30, unknown: 30)
3. **Geometry Score Gate (`applyGeometryScoreGate`)** — Per-class minimum geometry score thresholds (ground_noise: 1.0, all others: 0.1)
4. **Top-K Per Class (`applyTopKPerClass`)** — Per (fileId, geometryClass) group, keep only the top-K candidates by geometryScore
5. **Global Cap (`applyGlobalCap`)** — Enforce maxTotalPerFile (default 16) per file, keeping the highest-scored candidates regardless of class

All functions are pure with zero side effects. Input arrays are never mutated.

### `geometryRefinement.ts` — Stage 5 Integration

Added `disposition: CandidateDisposition` and `suppressionReason: string` fields to `RefinedCandidate`. Added `suppression?: Partial<SuppressionConfig>` to `RefinementConfig` and `suppressionResult: SuppressionResult | null` to `RefinedGeometryBundle`. When suppression is configured, Stage 5 converts refined candidates to `SuppressibleCandidate[]`, runs `suppressCandidates()`, and annotates each `RefinedCandidate` with its disposition and reason. All candidates default to `disposition: 'trusted'` and `suppressionReason: ''` when suppression is not configured, ensuring full backward compatibility.

### `PhotoVisionOverlayRenderer.tsx` — Debug/Trusted Visual Separation

Added `showSuppressed?: boolean` prop (default `false`) to the renderer. In refined mode, only `trusted` candidates are shown by default. When `showSuppressed=true`, suppressed candidates are rendered with dashed borders (`strokeDasharray: '1,1'`), lower opacity, and reduced stroke opacity. A warning banner appears when candidates are suppressed: "⚠ High raw candidate count suppressed. Showing top trusted candidates only. (N candidates hidden)". Hover tooltips show "SUPPRESSED" badge (red) for suppressed candidates with the suppression reason, and "REFINED" badge (green) for trusted candidates.

---

## 5. Candidate Counts Before/After

### Mock Candidate Set (21 candidates across 1 photo)

| Class | Before | After | Suppressed |
|-------|--------|-------|------------|
| probable_roof_plane | 11 | 4 | 7 |
| probable_obstruction | 4 | 4 | 0 |
| probable_equipment | 2 | 2 | 0 |
| probable_ground_noise | 2 | 0 | 2 |
| unknown | 2 | 0 | 2 |
| **Total** | **21** | **10** | **11** |

### Visual Target Compliance

| Target | Limit | Actual | Status |
|--------|-------|--------|--------|
| Roof | ≤4 | 4 | ✅ PASS |
| Obstruction | ≤8 | 4 | ✅ PASS |
| Equipment | ≤4 | 2 | ✅ PASS |
| Total per photo | ≤16 | 10 | ✅ PASS |

### Suppression Reasons Breakdown
- **NMS overlap**: 2 candidates (dense-2, line-d1) — high IoU with higher-scored same-class candidate
- **Top-K limit**: 3 candidates (dense-4, line-h3, line-v2) — exceeded per-class limit of 4 for roof
- **Low confidence**: 4 candidates (dense-6, line-d2, noise-0, noise-1, unknown-0, unknown-1) — below per-class confidence threshold

---

## 6. Tests Run

### `candidateSuppression.test.ts` — 26 tests, all passing

**NMS (4 tests):**
- Overlapping same-class candidates suppress lower-scored
- Non-overlapping candidates both kept
- Cross-class candidates do not suppress each other
- Cross-file candidates are isolated

**Confidence Gating (3 tests):**
- Per-class confidence thresholds applied correctly
- Unknown class uses default threshold of 30
- Ground noise always suppressed (threshold 100)

**Geometry Score Gating (2 tests):**
- Per-class geometry score thresholds applied correctly
- Ground noise always suppressed (threshold 1.0)

**Top-K Per Class (3 tests):**
- Top-K enforcement keeps only highest-scored K per class
- Below-limit groups kept entirely
- Top-K applied independently per class

**Global Cap (2 tests):**
- Max total per file enforced, highest-scored kept
- Global cap independent per file

**Full Pipeline Integration (7 tests):**
- Realistic mixed candidate set produces correct trusted/suppressed split
- `hasSuppressedCandidates=false` when nothing suppressed
- Input array not mutated
- Human-readable suppression reasons
- Empty input produces empty output
- Stages apply in correct order
- Per-file counts accurate

**DEFAULT_SUPPRESSION_CONFIG (5 tests):**
- Ground noise confidence threshold is 100
- Ground noise geometryScore threshold is 1.0
- Ground noise topK is 0
- maxTotalPerFile is 16
- Obstruction topK is 8, roof topK is 4, equipment topK is 4

### `geometryRefinement.test.ts` — 64 tests (8 new suppression integration), all passing

- Disposition annotations applied when suppression configured
- Low-confidence candidates suppressed
- No disposition without suppression config (backward compatibility)
- suppressionResult populated on bundle
- Ground noise always suppressed
- Custom config overrides respected
- Top-K per class limits enforced
- Global cap of 16 per file enforced

---

## 7. TypeScript / Build Result

- **`npx tsc --noEmit`**: ✅ Clean — zero errors
- **`npx next build`**: ✅ Successful — all routes compiled, no warnings related to changed files
- **`npx vitest run`**: ✅ 90 tests passing (26 suppression + 64 geometry refinement)

---

## 8. What Remains Unfixed

### Still Present in the Codebase (Out of Scope for This PR)

1. **96×96 edge detection resolution** — All candidate generation still operates at 96×96, producing coarse geometry. The suppression pipeline limits the visual damage but does not improve spatial accuracy.

2. **Fabricated confidence scores** — Confidence values remain deterministic functions of edge density and enumeration order. They are useful for relative ranking within a class but carry no probabilistic meaning.

3. **Index-parity classification** — Candidate type assignment still uses `index % 2 === 0`. The geometry refinement heuristics provide some improvement, but the underlying signal is weak.

4. **SVG rect-only rendering** — No polygon or path support. Rotated roof planes and irregular obstructions cannot be accurately depicted.

5. **Segmentation worker `NOT_IMPLEMENTED`** — The segmentation worker still throws `NOT_IMPLEMENTED`. It is not called in the current pipeline.

6. **`maskCleanup` dead code** — The `maskCleanup.ts` module remains unused and untested.

7. **No real ML model** — The entire vision pipeline is heuristic. No trained model validates candidate quality.

8. **Single-photo analysis only** — No multi-view consistency across a photo set for the same property.

### What This PR Does Address
- Excessive candidate counts rendering as visual noise → **Fixed** by 5-stage suppression
- No way to hide low-quality candidates → **Fixed** by confidence/geometry score gating
- No per-class limits → **Fixed** by top-K per class with configurable limits
- No global cap → **Fixed** by maxTotalPerFile (default 16)
- No visual distinction between good and bad candidates → **Fixed** by trusted/suppressed rendering with dashed borders and warning banner
- No debug capability for raw candidates → **Fixed** by `showSuppressed` toggle

---

## 9. Are Visuals Now Safer?

**Yes.** The overlay rendering is now significantly safer for end-user consumption:

- **Before**: A photo with dense edge activity could produce 20–40+ overlay rectangles, many overlapping, all rendered with equal visual weight, including ground noise and unknown-class candidates. This created a chaotic, unprofessional appearance that could mislead users into treating spurious detections as meaningful.

- **After**: The same photo shows at most 16 well-separated, class-limited overlays. Ground noise is always hidden. Low-confidence candidates are gated out. Overlapping duplicates are suppressed by NMS. A warning banner informs users when suppression is active, and a debug toggle allows inspection of raw candidates for development purposes.

The visual targets (roof ≤4, obstruction ≤8, equipment ≤4, total ≤16) are met and enforced by default. The suppression pipeline is pure, well-tested, and backward-compatible — when suppression is not configured, behavior is identical to the pre-PR code.

---

## 10. Is This Mergeable?

**Yes, with confidence.** This PR is safe to merge because:

1. **Backward compatible** — All changes are additive. When suppression is not configured, `geometryRefinement.ts` produces identical output to the pre-PR version. The `showSuppressed` prop defaults to `false`, requiring no changes to calling code.

2. **Well-tested** — 34 new tests (26 unit + 8 integration) cover every stage of the suppression pipeline, edge cases, configuration overrides, and integration with the existing refinement pipeline.

3. **Type-safe** — `npx tsc --noEmit` passes with zero errors. All new types are explicit and documented.

4. **Build-clean** — `npx next build` succeeds with no warnings related to changed files.

5. **Pure functions** — The suppression pipeline has zero side effects, no mutations, and no external dependencies. It can be reverted by removing the suppression config from `RefinementConfig`.

6. **Visual targets met** — Before/after evidence demonstrates that candidate counts meet the specified limits (roof ≤4, obstruction ≤8, equipment ≤4, total ≤16).

7. **No scope creep** — Only the six allowed immediate fixes were implemented. No permit generation, canonicalBridge, world projection, migration, promotion/review, P0.3/P1 roadmap, plan set generation, pipeline orchestration, or architecture cleanup changes were made.

**Merge recommendation**: Merge to `dev`. Monitor overlay rendering in staging to confirm visual improvement with real photo data. Consider enabling `showSuppressed` by default in dev/test environments for ongoing debugging.
