# SolarPro — Pass 3D Handoff: Rogue Lines Fix

## PROMPT FOR NEXT THREAD

You are continuing work on the SolarPro codebase, specifically Pipeline B (AI-driven roof geometry reconstruction from photos). All work goes to the `dev` branch. Read `HANDOFF_PASS3C.md` for full architecture, standing rules, and pass history. This document focuses on the NEW issue: **rogue lines in the line extraction output**.

---

## THE PROBLEM: ROGUE LINES

After Pass 3C deployment, the user provided 4 screenshots showing the rendered geometry overlay on site photos. The surreal polygon artifacts (trees growing from roof, neon cat shapes) from Pass 3C Bug #3 are now fixed. However, **rogue structural lines** are being detected and rendered where no structural line should exist. Specifically:

### What the screenshots show:
1. **Screenshot 1** (truck scene): A white truck with equipment on a rural property. The Hough line detector is picking up edges from non-structural elements (equipment edges, truck body lines, ground texture) and classifying them as structural lines (eave, ridge, rake, wall_vertical).

2. **Screenshot 2** (house with turquoise triangle): The most striking artifact — a bright turquoise/cyan triangle rendered from the upper-left corner diagonally across the image. This is a **spurious valley/hip/rake line** that was detected on non-roof edges (possibly tree branches or shadows) and rendered as a structural line overlay. There's also a neon pink circular outline at the bottom.

3. **Screenshot 3** (house with red tree): Lines being drawn on vegetation/tree edges and non-structural surfaces. The `lineOverlapsMask` function's bounding-box proximity fallback (30% tolerance) is likely letting lines on tree shadows or texture pass as "overlapping" structural masks.

4. **Screenshot 4** (yellow mobile home with tree): Lines being detected on the large tree in front of the house. The tree's edges (trunk, canopy boundary) are producing Hough lines that then get loosely classified as structural because of the proximity tolerance in `lineOverlapsMask`.

### Root Cause Analysis — 4 Likely Bugs:

**Bug A: `lineOverlapsMask` proximity fallback too loose (30% tolerance)**
- File: `runLineExtractionWorker.ts`, lines 792-810
- The fallback checks if a line passes within 30% of a mask's dimension of the mask's bounding box. For a large roof mask (say 500px wide), that's 150px tolerance. A line on a tree 100px away from the roof edge would pass this check and be considered "overlapping" the roof.
- This is the #1 source of rogue lines — lines on vegetation, vehicles, and ground features that happen to be NEAR a roof/wall mask get through the filter.

**Bug B: `classifyLine` falls through to "anything on a structure class = structural line"**
- File: `runLineExtractionWorker.ts`, lines 930-940
- The final fallback in `classifyLine` says: "if overlappingClasses.size > 0, classify as eave/rake/wall_vertical depending on angle." This means ANY line that overlaps ANY structure mask (even just barely via the proximity fallback) gets classified as a structural line. There is no minimum overlap threshold.
- A line that grazes the edge of a roof mask with 1 out of 20 sample points should NOT be classified as a structural line.

**Bug C: `REJECTED_CLASSES` does not include enough non-structure classes**
- File: `runLineExtractionWorker.ts`, lines 93-106
- Current rejected classes: sky, tree, trees, grass, ground, driveway, gravel, sidewalk, car, truck, equipment, unknown
- Missing: bushes, fence, vegetation_touching_structure, porch, deck, steps, railing, trash_can, person, ladder, tools, temporary_materials, ac_unit, existing_solar_panel, moss, algae
- Lines detected on these classes' edges pass through the structure filter because they're not in REJECTED_CLASSES. But they shouldn't produce structural lines either.

**Bug D: Multi-scale Canny picking up too many edges in vegetation/texture regions**
- File: `runLineExtractionWorker.ts`, lines 393-410
- The `CANNY_SCALE_HIGH` sensitivity (low=20, high=60) picks up extremely faint edges, including tree bark texture, leaf edges, and grass texture. These produce Hough line segments that shouldn't exist.
- The `strengthenEdgesInMaskRegions` function (lines 410-475) amplifies edges inside structure mask regions — but it doesn't SUPPRESS edges outside structure masks. So vegetation/ground texture edges are still fully present when Hough runs.

### Secondary Issues:
- **`MAX_LINES_PER_PHOTO = 30`** may be too high — even with good filtering, 30 lines per photo creates visual clutter. Most roof scenes have 5-10 meaningful structural lines.
- **`MIN_CONFIDENCE = 35`** may be too low — lines with 35% confidence are noise.
- **No deduplication of near-parallel lines** — the Hough detector often finds 2-3 nearly identical parallel lines along the same edge. They should be merged into one.
- **Worker version string** still says `'3.1.0-tuning-pass-3b'` — update to `'3.1.0-tuning-pass-3d'`.

---

## APPROVED FIXES (Suggested — Confirm with User)

### Fix A: Tighten `lineOverlapsMask` proximity tolerance
- Reduce proximity tolerance from 30% to **10%** of mask dimension
- Require **minimum 3 sample hits** (not 2) for the polygon interior test — this ensures the line actually passes through the mask, not just grazes it
- For the proximity fallback, require **minimum 5 sample hits** in the tolerance zone (currently requires 0)

### Fix B: Add minimum overlap threshold to `classifyLine`
- If fewer than 3 out of 20 sample points hit the mask polygon interior, reject the line (return null)
- Remove the final catch-all fallback that classifies ANY overlapping line as structural

### Fix C: Expand `REJECTED_CLASSES` to cover all non-structural classes
- Add: bushes, fence, vegetation_touching_structure, porch, deck, steps, railing, trash_can, person, ladder, tools, temporary_materials, ac_unit, existing_solar_panel, moss, algae
- These classes should never produce structural lines — they are occluders, site context, or condition flags

### Fix D: Suppress edges outside structure mask regions
- After `strengthenEdgesInMaskRegions`, add a step that zeros out (suppresses) edges that are NOT within or adjacent to a structure mask region
- This prevents Hough from finding lines in vegetation, ground texture, vehicle edges, etc.
- Approach: Create a "structure region" mask (dilated by ~20px to catch edges at mask boundaries), then AND the edge map with this mask. Only edges within structure regions survive.

### Fix E: Reduce `MAX_LINES_PER_PHOTO` from 30 to 15
- Most roof scenes have 5-10 meaningful lines; 30 creates visual clutter

### Fix F: Raise `MIN_CONFIDENCE` from 35 to 45
- Lines below 45% confidence are typically noise or very weak edges

### Fix G: Add near-parallel line deduplication
- After classification and scoring, merge lines that are:
  - Same lineType
  - Within 10 normalized units of each other (start/end points)
  - Within 5° of each other in angle
- Keep the higher-confidence line, discard duplicates

### Fix H: Update worker version string
- `'3.1.0-tuning-pass-3b'` → `'3.1.0-tuning-pass-3d'`

---

## STANDING RULES (MUST FOLLOW)

1. **ALWAYS push to `dev` branch**
2. **Do NOT modify**: CAD generation, permit generation, canonical builder, promotion logic, worker architecture (polling/queue infrastructure)
3. **Do NOT add new semantic classes** — the taxonomy is locked
4. **Do NOT broaden thresholds** to create more lines — bias toward fewer, higher-quality lines
5. **Do NOT treat SAM2 masks as geometry** — masks are class-agnostic region hints
6. **NormalizedPoint** requires `{x, y, coordinateSystem: 'normalized_image_0_1000'}` — MANDATORY
7. **LineSegment** requires `{start: NormalizedPoint, end: NormalizedPoint, length, angleDeg}` — ALL required
8. **Bias toward false negatives** — a missing line is better than a rogue line
9. **Must include unit tests** for any changes to filtering, classification, or overlap logic
10. **Must verify**: TypeScript compiles, Python syntax valid, no restricted-area changes

---

## KEY FILE: `runLineExtractionWorker.ts`

This is the primary file to modify. Key sections:

| Lines | Section | What to Change |
|-------|---------|---------------|
| 56-60 | `MIN_CONFIDENCE = 35` | Raise to 45 (Fix F) |
| 60-62 | `MAX_LINES_PER_PHOTO = 30` | Lower to 15 (Fix E) |
| 40 | `WORKER_VERSION` string | Update to pass-3d (Fix H) |
| 93-106 | `REJECTED_CLASSES` | Expand to include all non-structural classes (Fix C) |
| 393-410 | Multi-scale Canny + `strengthenEdgesInMaskRegions` | Add edge suppression outside structure masks (Fix D) |
| 764-827 | `lineOverlapsMask` | Tighten proximity tolerance to 10%, require 3+ hits (Fix A) |
| 830-940 | `classifyLine` | Add minimum overlap threshold, remove catch-all fallback (Fix B) |
| 1290-1300 | Post-classification scoring/capping | Add near-parallel deduplication (Fix G) |

---

## HOW TO DEPLOY

```bash
# Push to dev
git push https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git dev

# Trigger manual deploy (if auto-deploy doesn't fire)
curl -X POST -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg/deploys" -d '{}'

# Check deploy status
curl -s -H "Authorization: Bearer rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz" \
  "https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg/deploys?limit=1" | \
  python3 -c "import sys,json; ds=json.load(sys.stdin); print(ds[0]['deploy']['status'])"
```

**Note**: Only the geometry worker needs redeployment for line extraction changes. The SAM2 service does NOT need redeployment unless `main.py` is changed.

---

## TEST REQUIREMENTS

Add to `runLineExtractionWorker.test.ts`:
1. **Unit test**: Line on tree mask does NOT pass `lineOverlapsMask` for roof mask (proximity fallback rejection)
2. **Unit test**: Line with < 3 polygon hits is NOT classified (minimum overlap threshold)
3. **Unit test**: Rejected classes (bushes, fence, etc.) do NOT produce structural lines
4. **Unit test**: Near-parallel duplicate lines are merged into one
5. **Unit test**: Line from edge suppression — edges outside structure masks produce no Hough lines

---

## DELIVER CHECKLIST

- [ ] Files changed (with line-level diff summary)
- [ ] Root cause confirmed for each rogue line source
- [ ] Before/after: line count per photo (expect significant reduction)
- [ ] Before/after: screenshots showing no rogue lines
- [ ] TypeScript compiles (tsc --noEmit = 0 errors)
- [ ] All unit tests pass
- [ ] Worker version string updated
- [ ] No CAD/permit/canonical/promotion/worker architecture changes
- [ ] Deployed to Render (geometry worker only)
- [ ] Pushed to dev branch

---

*Document generated for Pass 3D rogue lines fix. Read `HANDOFF_PASS3C.md` for full architecture and pass history context.*
