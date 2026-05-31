# Solarpro — Full System Audit (2025-01)

## Bottom Line

**The SAM2 roof-fix is HALF deployed.** The TypeScript safety-net filter is live on Vercel and working. The Python-side smart classification + roof-only filtering — the REAL fix — is sitting on master in GitHub but is **NOT running on Render**. Render is still executing the old code from ~5 hours ago. No amount of git pushing will change that. It requires a manual deploy from the Render dashboard.

---

## 1. Code State — What's Where

| Location | Branch | Latest Commit | Status |
|---|---|---|---|
| **GitHub origin/master** | master | `5f96610` (Merge PR #11) | Contains ALL changes — Python + TypeScript |
| **GitHub origin/dev** | dev | `77b816e` | Identical content to master (0 diff after PR #11 merge) |
| **Local dev** | dev | `77b816e` | Synced with origin/dev |
| **Local master** | master | `d90846e` | BEHIND origin/master by 2 commits (merge commit + one other) |

**What this means:** All code is on GitHub. Nothing is stuck locally. `origin/master` has the complete fix.

---

## 2. Deployment State — What's Actually Live

### Vercel (Next.js frontend + API routes) — ✅ LIVE AND CURRENT

- **Production URL:** `solarpro-dev.vercel.app` (confusing name, but it's production)
- **Preview URL:** `solarpro-v31.vercel.app`
- **Deployed commit:** `5f96610`
- **Auto-deploys from:** `dev` branch (which is identical to master after PR #11)
- **Last deployment:** Successful, no errors
- **What's live:**
  - `ROOF_RELEVANT_SEGMENTATION_CLASSES` TypeScript filter ✅
  - `roof_only=true` query param sent to Render ✅
  - `minAreaFraction=0.05` default ✅
  - Per-photo segmentation status panel ✅
  - Pipeline B artifact deletion fix ✅
  - SAM2 time budget (5 photos, 120s warm-up cap) ✅
  - All logging improvements ✅

### Render — SAM2 Python Service — ❌ RUNNING OLD CODE

- **URL:** `https://sam2-segmentation.onrender.com`
- **Service ID:** `srv-d8dj4mv7f7vs73ca0gtg`
- **Dashboard:** `https://dashboard.render.com/web/srv-d8dj4mv7f7vs73ca0gtg`
- **Config:** `sam2-service/render.yaml` — branch: `master`, Docker runtime
- **Deployed commit:** UNKNOWN (old — pre-PR #11 merge, likely `d90846e` or earlier)
- **Uptime:** ~16,950 seconds (~4.7 hours) — **NO RESTART since before the merge**
- **Health check:** Returns `{"status":"ready"}` but service is running old code
- **Model:** `facebook/sam2.1-hiera-tiny` on CPU

**What's NOT live on Render (but IS on master):**
- ❌ `roof_only` query parameter — COMPLETELY IGNORED by current Render deploy
- ❌ `ROOF_RELEVANT_CLASSES` Python-side filtering
- ❌ `_compute_green_ratio()` — green ratio computation for vegetation detection
- ❌ "tree" as a distinct classification class
- ❌ Smarter `classify_mask_region()` with green ratio + improved heuristics
- ❌ `min_area_fraction` default raised from 0.02 → 0.05
- ❌ Any of the Python-side roof-only logic

**What IS live on Render (old code):**
- Basic SAM2 AMG inference
- Naive mask classification (no green ratio, no tree class)
- `min_area_fraction` at 0.02 (lets through tiny ground patches)
- No roof-only filtering — returns ALL masks including sky, ground, trees

**Confirmed by testing:** Sent `roof_only=true` to the live Render service. It returned a `ground` mask. The parameter was ignored because the old code doesn't have it.

### Render — OpenCV Photo Vision Service — STATUS UNKNOWN

- **Config:** `render.yaml` (root) — branch: `dev`, Docker runtime, standard plan
- This is the YOLO + Tesseract OCR service, separate from SAM2
- Not part of the current issue, not investigated

---

## 3. The SAM2 Roof Problem — Multi-Layer Fix Status

### The Original Problem
SAM 2 Automatic Mask Generation is class-agnostic. It finds ALL visually distinct regions in an image. Trees, ground, and sky are often more visually prominent than roofs, so they dominate the mask output. The result: segmentation lines trace tree canopies and ground edges instead of roof geometry.

### Fix Architecture (3 Layers)

| Layer | Description | Status | Where |
|---|---|---|---|
| **Layer 1: Python** | Smart classification + green ratio + roof-only filtering + tree class | ❌ **NOT DEPLOYED** | `sam2-service/main.py` on master, not on Render |
| **Layer 2: TypeScript** | Double-filter — `ROOF_RELEVANT_SEGMENTATION_CLASSES` set blocks non-roof masks | ✅ **LIVE** | `runSegmentationWorker.ts` + `sam2Client.ts` on Vercel |
| **Layer 3: Future** | Switch from AMG to SAM2ImagePredictor with point prompts | 🔲 **NOT STARTED** | Would require new endpoint + UI changes |

### How the Layers Interact

**Current situation (Layer 2 only):**
1. User triggers segmentation
2. Vercel sends `roof_only=true` to Render
3. Render ignores it (old code) — returns ALL masks with naive class hints
4. Old Python code classifies trees as "obstruction" (not "tree" — that class doesn't exist in old code)
5. TypeScript filter sees `classHint="obstruction"` → maps to `segmentationClass="obstruction"` → `ROOF_RELEVANT_SEGMENTATION_CLASSES.has("obstruction")` is **TRUE** → **tree mask PASSES through**
6. Result: Trees can still get through if the old Python code misclassifies them

**After Layer 1 is deployed (Layer 1 + Layer 2):**
1. User triggers segmentation
2. Vercel sends `roof_only=true` to Render
3. Render processes it — green ratio detects trees → classifies as "tree" → filters out on Python side
4. Only roof-relevant masks (`roof`, `wall`, `equipment`, `obstruction`) returned
5. TypeScript filter as safety net catches anything Python misses
6. Result: Trees and ground are filtered at BOTH layers

### The Critical Gap

**The TypeScript filter alone is INSUFFICIENT** because:
- Old Python code doesn't have a "tree" class — trees get classified as "obstruction"
- "obstruction" IS in `ROOF_RELEVANT_SEGMENTATION_CLASSES` — it passes through
- The green ratio computation that would correctly identify trees doesn't exist on Render
- Only deploying Layer 1 to Render will close this gap

---

## 4. What Needs to Happen — In Order

### Immediate (UNBLOCKS THE FIX)

1. **Manual deploy on Render** — This is the ONLY blocker.
   - Go to: `https://dashboard.render.com/web/srv-d8dj4mv7f7vs73ca0gtg`
   - Click "Manual Deploy" → "Deploy latest commit"
   - Wait for deploy to complete (2-5 minutes)
   - Verify: `curl https://sam2-segmentation.onrender.com/health` — check that uptime resets to near 0
   - Verify: Send a test image with `roof_only=true` — should NOT return ground/tree masks

### After Deploy (VERIFICATION)

2. **End-to-end test** — Trigger segmentation on a real survey with tree-heavy photos
   - Check Vercel logs for `filtered N non-roof` messages
   - Check that mask lines follow roof edges, not tree canopies
   - If trees still get through, the green ratio threshold (0.35) may need tuning

3. **Sync local master** — `git pull origin master` to bring local master up to `5f96610`

### Future (IMPROVEMENT)

4. **Layer 3: SAM2ImagePredictor** — Replace AMG with prompt-based segmentation
   - Point prompts on roof regions would guarantee roof-focused output
   - Requires new `/segment-prompts` endpoint
   - Requires UI for clicking roof points (or automatic roof-point detection)
   - This is the real long-term fix but is a significant engineering effort

5. **Render auto-deploy** — Consider enabling auto-deploy on Render to prevent this situation in the future
   - Currently Render only deploys when manually triggered
   - Risk: broken master could auto-deploy and break production
   - Mitigation: CI checks before merge to master

---

## 5. Known Issues

| Issue | Severity | Status |
|---|---|---|
| Render running old SAM2 code | **CRITICAL** — trees/ground get through | Requires manual deploy |
| Render 502 errors (OOM) | HIGH — service crashes under load | Starter plan RAM limit; mitigated by CPU optimizations |
| `render.yaml` has `SAM2_MIN_MASK_AREA_FRACTION: "0.02"` | MEDIUM — overrides the new 0.05 default | Update render.yaml env var to "0.05" after deploy |
| Local master behind origin/master | LOW — no functional impact | `git pull origin master` to sync |
| TypeScript "obstruction" class lets trees through | MEDIUM — only fixed when Python deploys | Resolved by Layer 1 deploy |

---

## 6. File Map — What Changed and Where

### Python (sam2-service/main.py) — on master, NOT on Render

```
Lines 247-349:  classify_mask_region() — rewritten with green_ratio param
Lines 353-410:  _compute_green_ratio() — NEW function
Line 412:       ROOF_RELEVANT_CLASSES — NEW constant
Lines 473-478:  roof_only: bool = Query(default=True) — NEW param
Lines 592-605:  roof_only filtering logic — NEW
```

### TypeScript — on master AND on Vercel ✅

```
sam2Client.ts:
  Line 505:  url.searchParams.set('roof_only', 'true')
  Line 612:  ROOF_RELEVANT_SEGMENTATION_CLASSES constant

runSegmentationWorker.ts:
  Line 49:   Import ROOF_RELEVANT_SEGMENTATION_CLASSES
  Lines 437-453: Roof-relevant filter in mask processing loop
  Line 486:  Updated log with filteredNonRoof count
```

### Other files (deployed, not related to this fix)

```
render.yaml (root):        OpenCV photo vision service config
sam2-service/render.yaml:  SAM2 service config (branch: master)
vercel.json:               Next.js build config
```

---

## 7. Render Dashboard Access

The Render deploy MUST be done by someone with dashboard access. I cannot access the Render dashboard from this environment. The steps are:

1. Open `https://dashboard.render.com/web/srv-d8dj4mv7f7vs73ca0gtg`
2. Scroll to "Manual Deploy" section
3. Click "Deploy latest commit" (this pulls the latest master commit `5f96610`)
4. Wait for the build + deploy to complete
5. The service will restart — uptime will reset to ~0
6. The new code with roof_only, green ratio, tree class will be live

**Alternatively**, you can update the `SAM2_MIN_MASK_AREA_FRACTION` env var from "0.02" to "0.05" in the Render dashboard at the same time, which will also trigger a redeploy AND fix the env var override issue.
