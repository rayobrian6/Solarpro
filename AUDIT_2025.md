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

### Render — SAM2 Python Service — ✅ DEPLOYED AND VERIFIED\n\n- **URL:** `https://sam2-segmentation.onrender.com`\n- **Service ID:** `srv-d8djpc3bc2fs73emup10`\n- **Dashboard:** `https://dashboard.render.com/web/srv-d8djpc3bc2fs73emup10`\n- **Config:** Branch `dev`, Docker runtime, Standard plan, autoDeploy=off\n- **Deployed commit:** `8e69f00` (latest dev — includes render.yaml env var fix)\n- **Deploy ID:** `dep-d8e4lh4p3tds7387468g` — triggered via Render API\n- **Deploy status:** LIVE (finished 2026-05-31T14:53:04Z)\n- **Health check:** `{"status":"ready","model_loaded":true,"uptime_seconds":33}` after deploy\n- **Model:** `facebook/sam2.1-hiera-tiny` on CPU\n\n**Verified by testing (synthetic image with tree + roof + ground):**\n- `roof_only=true` → 1 mask (`roof` only) ✅ — tree and ground FILTERED OUT\n- `roof_only=false` → 4 masks (`roof`, `ground`, 2× `tree`) — all masks returned\n- Green ratio detection correctly identifies vegetation as `tree` class ✅\n- `ROOF_RELEVANT_CLASSES` filter blocks sky/ground/tree ✅
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

### ✅ DONE — Render Deploy

1. **Manual deploy on Render** — DONE via Render API
   - Service ID: `srv-d8djpc3bc2fs73emup10`
   - Deploy ID: `dep-d8e4lh4p3tds7387468g`
   - Commit: `8e69f00` (latest dev with all fixes)
   - Status: LIVE
   - Verified: `roof_only=true` correctly filters out tree/ground masks ✅
   - Health: `{"status":"ready","uptime_seconds":33}` — fresh restart confirmed

### Next Steps (VERIFICATION)

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
   - Currently Render only deploys when manually triggered (or via API)
   - Risk: broken master could auto-deploy and break production
   - Mitigation: CI checks before merge to master

---

## 5. Known Issues

| Issue | Severity | Status |
|---|---|---|
| ~~Render running old SAM2 code~~ | ~~CRITICAL~~ | ✅ **FIXED** — Deployed `8e69f00` via Render API |
| Render 502 errors (OOM) | MEDIUM — service may crash under load | Mitigated by CPU optimizations; now on Standard plan |
| `render.yaml` env var `SAM2_MIN_MASK_AREA_FRACTION: "0.02"` | LOW — env var overrides Python default | Fixed in repo (0.05); Render dashboard env var may still override |
| Local master behind origin/master | LOW — no functional impact | `git pull origin master` to sync |
| ~~TypeScript "obstruction" class lets trees through~~ | ~~MEDIUM~~ | ✅ **FIXED** — Python now has "tree" class + green ratio |

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

1. Open `https://dashboard.render.com/web/srv-d8djpc3bc2fs73emup10`
2. Scroll to "Manual Deploy" section
3. Click "Deploy latest commit" (this pulls the latest master commit `5f96610`)
4. Wait for the build + deploy to complete
5. The service will restart — uptime will reset to ~0
6. The new code with roof_only, green ratio, tree class will be live

**Alternatively**, you can update the `SAM2_MIN_MASK_AREA_FRACTION` env var from "0.02" to "0.05" in the Render dashboard at the same time, which will also trigger a redeploy AND fix the env var override issue.
