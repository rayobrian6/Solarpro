# Roof-Line Overlay Regression Report

**Date:** 2025-06-02  
**Branch:** dev  
**Fix commits:** Pending push (2 modified files, unstaged)  
**Status:** ✅ Fixed — TypeScript 0 errors, 6171 tests pass

---

## 1. Problem Statement

After recent changes, the roof-line overlay on survey photos showed **thick yellow bars** obscuring the underlying imagery instead of thin, review-friendly evidence lines. The symptoms were:

- **Roof line count: 135** (rake ~48, eave ~67, wall_vertical ~20)
- **Roof plane count: 0**
- Every rake/eave/wall_vertical line rendered as a thick colored bar covering large portions of the photo
- No way to toggle between review mode and debug/all-candidates mode
- No deduplication of near-duplicate lines across segmentation masks
- No cap on displayed roof lines per photo in default view

## 2. Root Cause Analysis

### 2.1 Thick Yellow Bars

The `ROOF_LINE_SUBTYPE_STYLES` constant defined `strokeWidth` values of 1.5–2.5 for roof line subtypes. In the SVG overlay, the coordinate system uses `viewBox="0 0 100 100"`, meaning strokeWidth values represent **percentages of the image width**. A strokeWidth of 2.5 equals 2.5% of the image width per line — with 135 lines stacked on top of each other, this creates an impenetrable wall of color.

Additionally, an outer glow effect added +1.0 to the visual width, making each line effectively 2.5–3.5% of the image width.

**Root cause:** strokeWidth values were calibrated for a pixel-coordinate system, not a percentage-based SVG viewBox.

### 2.2 135 Roof Lines with 0 Planes

The line extraction worker (`runLineExtractionWorker.ts`) extracts **every polygon edge** from roof/wall segmentation masks produced by SAM2. Since SAM2 polygons have many vertices, each mask produces many edges, each of which becomes a roof_line candidate.

Meanwhile, the pipeline runs stages sequentially: Stage 2 (line extraction) completes before Stage 5 (plane extraction) begins. With `PIPELINE_TIMEOUT_MS = 270_000` (4.5 minutes), if the pipeline times out after Stage 2 but before Stage 5, the result is many lines but zero planes.

**Root cause:** Pipeline timeout skips plane extraction after line extraction completes, combined with no default-mode filtering to hide low-confidence or duplicate lines.

### 2.3 No Cross-Mask Deduplication

The collinear merge step in `runLineExtractionWorker.ts` only merges edges from the **same source mask**. If two different SAM2 masks both produce a line along the same roof edge (e.g., two adjacent roof plane masks sharing an eave), both lines survive as separate artifacts. With 135 lines, many are near-duplicates from overlapping masks.

**Root cause:** Collinear merge is intra-mask only; no cross-mask deduplication existed.

### 2.4 No Debug Toggle

The overlay renderer had a single rendering mode with no way to switch between "show only trusted lines" and "show all candidates for debugging." Reviewers saw the same thick, cluttered view as developers debugging the pipeline.

**Root cause:** No debug/default mode separation in the overlay component.

## 3. Changes Made

### 3.1 `components/UnifiedGeometryOverlayRenderer.tsx`

**Style constants — dual tables:**

| Constant | Old Value | New Value (Default) | New Value (Debug) |
|---|---|---|---|
| Ridge strokeWidth | 2.5 | 0.4 | 1.5 |
| Eave strokeWidth | 2.0 | 0.35 | 1.2 |
| Rake strokeWidth | 1.5 | 0.3 | 1.0 |
| Hip strokeWidth | 2.0 | 0.4 | 1.2 |
| Valley strokeWidth | 1.5 | 0.35 | 1.0 |
| Wall vertical strokeWidth | 1.5 | 0.3 | 1.0 |
| Default fallback strokeWidth | 1.5 | 0.3 | 1.0 |

Created `ROOF_LINE_SUBTYPE_STYLES_DEFAULT` (thin, review-friendly) and `ROOF_LINE_SUBTYPE_STYLES_DEBUG` (thick, for debugging). The component selects the active table based on the `showDebugRoofLines` prop.

**Confidence thresholds:**

| Constant | Value | Mode |
|---|---|---|
| `MIN_ROOF_LINE_CONFIDENCE` | 40 | Debug (show all candidates) |
| `MIN_ROOF_LINE_CONFIDENCE_DEFAULT_MODE` | 60 | Default (only trusted lines) |

**Line caps per file:**

| Constant | Value | Mode |
|---|---|---|
| `MAX_ROOF_LINES_PER_FILE_DEFAULT` | 20 | Default |
| `MAX_ROOF_LINES_PER_FILE_DEBUG` | 100 | Debug |

**Near-duplicate detection:**

Added `DUPLICATE_LINE_MIN_DISTANCE = 40` and `DUPLICATE_LINE_MIN_ANGLE_DIFF = 15` (in normalized 0–1000 coordinate units and degrees respectively).

Added helper functions:
- `lineMidpoint(a)` — computes midpoint of a line segment artifact
- `lineAngleDeg(a)` — computes angle of a line segment in degrees
- `pointDistance(a, b)` — Euclidean distance between two points
- `deduplicateRoofLines(lines)` — removes near-duplicate lines: if two lines of the same subtype have midpoints within 40 units and angle difference within 15°, the lower-confidence line is dropped. Only active in default mode.

**Component prop:**

Added `showDebugRoofLines?: boolean` (default `false`) to `UnifiedGeometryOverlayRenderer`. Controls:
- Style table selection (thin vs thick)
- Confidence threshold (60 vs 40)
- Line cap (20 vs 100)
- Deduplication (on vs off)
- Outer glow effect (off vs on)
- Debug indicator label in legend area

**Outer glow:**

Made the outer glow SVG element conditional on `showDebugRoofLines`. In default mode, lines are rendered with just the main colored stroke — no glow — keeping the overlay clean and unobtrusive.

**Bug fix:**

Fixed a block-comment syntax error where `/* function PhotoWithUnifiedOverlays({` was intended to comment out the function but the `*/` in the nested JSDoc `/** Whether to use thick debug rendering for roof lines. */` prematurely closed the block comment, causing TypeScript compilation errors (TS1109, TS1128). Restored the function definition to active code.

### 3.2 `components/RoofGeometrySection.tsx`

Added debug toggle UI:
- `showDebugRoofLines` state: `const [showDebugRoofLines, setShowDebugRoofLines] = useState(false);`
- Toggle button before the overlay renderer with descriptive labels and tooltips
- Passes `showDebugRoofLines` prop to `UnifiedGeometryOverlayRenderer`

The toggle button shows:
- **Default mode:** "📋 Review: Trusted lines only" (slate/gray styling)
- **Debug mode:** "🔍 Debug: All line candidates" (amber/highlighted styling)

## 4. What Was NOT Changed

Per the user's constraints, the following were **not modified**:

- **Geometry reconstruction pipeline** (`runFullPipeline.ts`, `runLineExtractionWorker.ts`) — No changes to line extraction, collinear merge, or stage ordering. The 135-line / 0-plane condition is a pipeline timing issue to be addressed separately.
- **CAD/permit/canonical/promotion logic** — No changes to geometry promotion authority ladder, CAD-safe generation, or permit workers.
- **Pipeline adapters** (`pipelineAdapters.ts`) — No changes. Confirmed that semantic segmentation masks are always mapped to `geometryClass = 'segmentation_mask'`, never to `roof_line`.
- **SAM2 mask rendering** — Segmentation mask overlays remain fully visible with no changes to their rendering.
- **No new segmentation classes** — No semantic classes added.
- **No semantic roadmap work** — No continuation of the semantic item detection feature.

## 5. Verification

| Check | Result |
|---|---|
| TypeScript compilation (`npx tsc --noEmit`) | ✅ 0 errors |
| Test suite (`npx vitest run`) | ✅ 213 files, 6171 tests pass, 11 skipped |
| `pipelineAdapters.ts` audit — semantic masks → `segmentation_mask` only | ✅ Confirmed |
| `deduplicateRoofLines` only active in default mode | ✅ Confirmed |
| Outer glow only in debug mode | ✅ Confirmed |
| Max 20 lines in default mode, 100 in debug | ✅ Confirmed |
| Min confidence 60 in default mode, 40 in debug | ✅ Confirmed |
| `showDebugRoofLines` prop defaults to `false` | ✅ Confirmed |

## 6. Before/After Visual Description

### Before (Regression)

- 135 roof lines drawn with strokeWidth 1.5–2.5 in SVG viewBox 0–100 coordinates
- Each line occupied 1.5–2.5% of the image width, plus +1.0 outer glow
- Stacked lines created thick yellow bars obscuring the entire photo
- No way to hide low-confidence or duplicate lines
- No debug toggle available

### After (Fix — Default Mode)

- Roof lines rendered with strokeWidth 0.3–0.4 (thin evidence lines)
- Only lines with confidence ≥ 60 shown (higher-quality subset)
- Near-duplicate lines removed via `deduplicateRoofLines()`
- Maximum 20 lines per photo in default view
- No outer glow — clean, unobtrusive overlay
- SAM2 segmentation masks remain fully visible underneath

### After (Fix — Debug Mode)

- Toggle button switches to thick rendering (strokeWidth 1.0–1.5)
- All lines with confidence ≥ 40 shown
- No deduplication — all candidates visible
- Up to 100 lines per photo
- Outer glow enabled for visibility on any background
- Amber "🔍 Debug: All line candidates" indicator shown
- "Thick lines = debug mode. Low-conf & duplicates visible." hint text

## 7. Files Modified

| File | Change Summary |
|---|---|
| `components/UnifiedGeometryOverlayRenderer.tsx` | Dual style tables (thin default + thick debug), confidence thresholds, line caps, dedup logic, showDebugRoofLines prop, conditional outer glow, debug indicator |
| `components/RoofGeometrySection.tsx` | Added showDebugRoofLines state, toggle button UI, prop passing |

## 8. Known Remaining Issues

1. **Pipeline timeout → 0 planes:** When `PIPELINE_TIMEOUT_MS` is exceeded after Stage 2 (line extraction) but before Stage 5 (plane extraction), the result is lines with no planes. This is a pipeline timing issue not addressed by this overlay fix. A separate investigation should consider: reordering stages, increasing timeout, or making plane extraction independent.

2. **Intra-mask edge proliferation:** SAM2 polygons with many vertices produce many edges, each becoming a roof_line candidate. The line extraction worker could be improved to merge more aggressively (e.g., approximate collinear chains rather than exact collinear merge only). This is a pipeline-side improvement, not an overlay concern.

3. **Confidence calibration:** The default confidence threshold of 60 is a reasonable starting point but may need adjustment based on real-world feedback. The line extraction worker assigns confidence based on edge length and polygon area; short edges from SAM2 mask noise may have confidence in the 25–50 range.
