# SolarPro — Complete Engineering Handoff

**Date:** 2026-06-12. **Owner:** Ray (rayobrian6@gmail.com). **Audience:** a coding agent/team with ZERO prior context.
**Mission:** SolarPro turns a solar site survey (phone photos by a technician) into a permit-ready 16-sheet plan set, with as little human intervention as possible. Long-term goal: beat Aurora Solar on rural coverage and survey-to-permit automation.

---

## 1. Environment & access

- **Repo:** `C:\Users\Ray\Solarpro Claude\repo` — Next.js (App Router) + TypeScript. Work on branch `dev` (never directly on master). Master was promoted 2026-06-10 (prod Vercel project `solarpro-v31`).
- **Frontend hosting:** Vercel — `solarpro-dev` auto-deploys on push to dev.
- **Workers/Python services:** Render — `geometry-reconstruction-worker` (Node, `worker/`), `sam2-segmentation` (`sam2-service/`, SAM2 + SegFormer classifier). Worker deploys are MANUAL via Render API. CPU-only (no GPU).
- **Database:** Neon Postgres. A plaintext connection string lives at `C:\Users\Ray\Solarpro Claude\.db_url` (OUTSIDE the repo). **CRITICAL:** that file has a UTF-8 BOM — strip it before use (`fs.readFileSync(p,'utf8').replace(/^﻿/,'').trim()` in Node; `.strip()` after explicit decode in Python). Delete/rotate when done.
- **Migrations:** SQL files in `lib/migrations/*.sql`, run via Admin → System Tools UI (`app/admin/system-tools` → `/api/admin/system-tools` `run_migration`), idempotent. Migration `087_canonical_building_model.sql` is already applied.
- **SECURITY DEBT:** GitHub (`ghp_…`), Render (`rnd_…`), Vercel (`vcp_…`) tokens were pasted in an earlier chat transcript and MUST be rotated. Do not commit secrets.
- Agent/CLI cannot call authenticated app endpoints (no session); the operator (Ray) triggers UI actions, agents verify via direct DB queries.

## 2. Core architecture — "the rail" (NON-NEGOTIABLE)

There is exactly ONE path for geometry to reach a permit. No parallel pipelines, ever (hard requirement from Ray's business partner):

```
Evidence source → UnifiedGeometryArtifact (worldPolygon, confidence, provenance)
  → operator review/approval → promotion chain (raw_evidence → … → promoted_canonical)
  → CanonicalBuildingModel (persisted, table canonical_building_model)
  → permit generator (16-sheet plan set)
```

Key code:
- `lib/permit/generatePermit.ts` + `lib/drafting/renderPlanSet.ts` — the WORKING 16-sheet permit generator. Input contract: `roofPlanes{vertices(lat/lng), pitch, azimuth, area, edgeTypes}` (`lib/permit/types.ts:70,288`; `lib/cad/types.ts:36`).
- `app/api/engineering/permit/route.ts` — permit route; at ~line 673-695 it resolves projectId → latest survey → `getCanonicalModel`; authoritative override only when authority ≥ promoted_canonical (`lib/.../canonicalToPermit.ts`: `isCanonicalUsableForPlanset` + mapper). **KNOWN BUG (formalization fix #1):** `canonicalToPermitRoofPlanes` hard-stamps `source:'aerial'` — it must preserve true provenance (e.g. `evidence_fusion`) end-to-end.
- `CanonicalBuildingModel` (`types.ts:787`, `canonicalBuilder.ts`), persisted via `canonicalModelStore` (migration 087). `CanonicalRoofPlane.worldPolygon{lat,lng}[]` is the universal spine field.
- Promotion: `aerialApproval.ts` `promoteToCanonicalChain`, `unifiedArtifactStore.upsertUnifiedArtifact`, endpoint `POST /api/site-surveys/[surveyId]/unified-geometry/approve-aerial`.
- The OTHER plan-set route (`/api/engineering/plan-set`, 7-sheet G-set) still has a hardcoded 30×20 fallback — not the target.

Governing principles (operator-locked, treat as law):
1. "Evidence Fusion generates recommendations. Operators approve. Canonical remains the only authority."
2. Provenance = chain of custody. Attribution must survive every hop (evidence → artifact → canonical → permit). A wrong source stamp is a broken audit trail, not a cosmetic bug.
3. Operator Adjust is never an override — it is evidence (provenance-bearing) flowing through the same rail.
4. Operator-confirmed facts are PINNED: no downstream process may reinterpret/move them. Only the operator can change them.
5. Review UI = exception report: collapse high-confidence fields, expand low-confidence ones with evidence + assumption + score + challenge affordance; verbs are Approve / Adjust / Reject.
6. Autonomy mechanism = convergence gating: when independent evidence sources agree (e.g., LIDAR pitch 21.5° vs gauge photo 22°), auto-promote; on divergence, flag for review. Exception rate is the KPI driven toward zero; corrections become labeled training data.

## 3. Immediate pending milestone — "Proof #5" (the rail proof)

Project **"Ray Test New - Roof Mount"** `bebdc2af-0a00-41cf-9318-7d9b2b271760`, survey `be8b2f62-f891-4889-8365-516d76aa4a0e`, address 1010 Franklin Street, Pocahontas, IL 62275 (pin 38.8903, -89.5710 — verified correct vs Census TIGER, ~35 m).
A canonical model (2 planes, az 90/270, pitch 22°, ~50×70 ft, authority promoted_canonical, artifacts d34a95e4/854e2c66) is persisted from the manual Evidence-Fusion run. Pre-flight (`_tmp_franklin/preflight_permit.mjs`) replayed route selection against live DB: the permit route WILL select this canonical; zero competing sources.

**Status: Ray has NOT yet clicked Generate Permit** (as of 2026-06-12; `project_files` for the project is empty). When generated, verify IN ORDER:
1. Permit route selected survey be8b2f62.
2. Canonical model with 2 promoted planes was loaded (log line `[permit/canonical] project.roofPlanes set from CanonicalBuildingModel`).
3. No fallback geometry path executed (no placeholders / canonical_snapshot / stale layout).
4. PV-2 geometry numerically matches canonical (N-S ridge, 2 E/W facets, 22°, ~50×70 ft).
5. Saved artifact (project_files, plan_set/permit HTML) contains expected ridge/facet structure.
6. Provenance check — expect the `source:'aerial'` mis-stamp; record it, not a blocker.
Standard of proof: evidence the renderer CONSUMED canonical (from the generating request), not merely that canonical existed.
**Important nuance:** this proves the RAIL. The canonical CONTENT is now known-imperfect (see §5) and must be revised through the Adjust path AFTER the proof.

## 4. The strategic pivot history (why things are the way they are)

- Ground-photo CV reconstruction was tried and disproven: per-photo 2D heuristics produced garbage (the "43 outlines"); a real SfM pipeline (built from scratch, SIFT→essential→PnP→BA) registered only 3/22 then 7/77 cameras on real survey captures — capture density, not engine, is the wall. Ground photos are DEMOTED to verification/obstructions/electrical/condition. Never primary geometry.
- Google Solar API: works where covered (already wired: `adaptSolarRoofSegmentsToWorldArtifacts` reads raw `roofSegmentStats`), but buildingInsights has no facet polygons (only attributes) and rural test sites have NO_COVERAGE.
- **Evidence Fusion** (current product direction): multiple evidence sources each contribute what they know, with per-field provenance + confidence; fused recommendation goes to operator review then canonical. Manual end-to-end run completed for the test site (footprint from satellite + operator nudge, pitch 22° from gauge photo, sun-position math, scale check). Build order locked by partner: auto-footprint, gauge OCR, fusion layer, confidence scoring, recommended planes, approval workflow, promotion into existing canonical.
- **Aurora-parity insight:** Aurora/EagleView build geometry from overhead data that already contains 3D (licensed HD stereo aerial + LIDAR DSMs) + AI plane fitting + designer review. Nobody parses contractor ground photos into geometry. SolarPro's rural equivalent is FREE USGS 3DEP LIDAR (see §6).

## 5. Test-property ground truth — 1010 Franklin (operator-verified; use as regression fixture)

House (anchored at pin; +x=east, +z=north, feet):
- Simple gable, ridge N-S, ridge height 17.3 ft (LIDAR), ridge ~26 ft from west edge of the ~60 (E-W) × 70 (N-S) rectangle (LIDAR; canonical's 50 ft width is WRONG — cut off the low section).
- West facet ≈17.9°, east facet ≈22.2° (asymmetric! the 22° gauge measurement was the EAST slope). LIDAR + gauge agree.
- East ~20 ft of the footprint = LOW-SLOPE SHINGLED section (~9.6 ft) at a DIFFERENT LEVEL, joined with a step + STEP FLASHING (photos seq_052/056/057; missing-shingle repair strip on it = condition note).
- House is ELEVATED on block crawlspace (~3 ft visible block all around). Windows/doors high; exterior stairs at doors.
- COVERED PORCH: RECESSED under the continuous main roofline ("attached into the roof"), west side south portion; deck ~3 ft on block; posts + wood railing at the outer plane; wood stairs w/ railing at the SOUTH end → walkway.
- MUD ROOM: INSIDE the NW corner of the rectangle (does NOT extend the footprint — modeling it as a projection was wrong); exterior wood stairs up to its door at the north wall west end.
- North gable: window + window AC; north wall of low section: door at the EAST end, window WEST of it (order matters; was once modeled inverted).
- South gable: plain (no window confirmed at left/center; one high window east portion).
- Roof: 2 vent stacks near ridge; satellite dish; weathered red-brown asphalt, patch repairs.
- Yard: corner lot (N-S road west, E-W road south), gravel drive full east side, big trees west/southwest lawn, rusty-roof shed SW, white cargo trailer parked east side, trampoline north yard, rabbit hutches near west wall.

Apartment + garage building (~35-40 ft north of house, long E-W, ~84×36 ft):
- **Slight SPLIT-LEVEL (operator-confirmed, LOCKED): garage half (east) sits LOWER than apartment half (west)** — stepped rooflines, eave ~7.2 vs ~9 ft, visible siding step at the junction. Facets ~22.5° (segmenter).
- South wall: apartment windows + apartment door; **utility METER + MAIN + disconnect + 3 conduits going UNDERGROUND** (seq_094/096 are THIS building's south wall, NOT the house); service pad + water barrels below; **man door immediately WEST (left) of the garage double door; ONE double-car door** (not two singles).
- Power flow: service lands at the APARTMENT building; buried feeder runs SOUTH to the house (house has a sub-panel — survey photo `electrical-sub-panel`). Point of interconnection for the solar design = verify with operator, likely the apartment main. The concrete between buildings traces the buried feeder.
- Concrete network (operator says prior models were ~100% wrong; latest attempt unverified): porch stairs → walk south to road; branch along south face; mud-room landing → walk between buildings → pad along apartment south wall (under meter) → gravel apron at garage doors. CONFIRM WITH OPERATOR.

Outstanding model errors at handoff (operator's last grading): mud room placement still off; apartment door/window positions off; concrete still mostly wrong. The interactive 3D model iterations (v1–v20) were chat-rendered prototypes only — nothing committed to the repo.

## 6. Proven standalone components (working code, in `repo/_tmp_franklin/`)

All run with Python 3.13 + `pip install laspy lazrs pyproj numpy scipy pillow`:
- **Pin verification:** forward/reverse geocode cross-check via Census TIGER (`geocoding.geo.census.gov/geocoder/locations/onelineaddress`). Rural Nominatim reverse is unreliable (false "wrong village" alarm happened — TIGER settled it). MAKE THIS A MANDATORY PRE-FUSION GATE.
- **LIDAR fetch:** USGS 3DEP via TNM API (`tnmaccess.nationalmap.gov/api/v1/products?datasets=Lidar Point Cloud (LPC)&bbox=…`, flaky — retry). Test-site tile: `USGS_LPC_IL_SouthCentral_2021_D21_2467_8110.laz` (33 MB, rockyweb.usgs.gov, saved as `parcel_lidar.laz`). CRS = NAD83(2011) Illinois West ftUS (parse from LAZ header; pyproj transform from EPSG:4326).
- **Height grid / surface:** `lidar_roof.py`, `lidar_roof2.py` (grid, NaN-fill, hillshade, cross-section). Outputs: `lidar_grid2.npy`, `lidar_surface.png`.
- **Multi-plane segmentation + obstruction hints:** `lidar_segment.py` — blob labeling (veg classes 3/4/5 excluded; "building" = class1 > 4 ft), iterative RANSAC planes, above-plane residual clusters (vent stacks show as 1-4 pt clusters at QL2 — LIDAR hints, photo detector must confirm). Found the apartment's lower plane and fully segmented a NEIGHBOR'S complex roof untouched (replicability demo). **KNOWN BUG: azimuth output sign-flipped — fix + add unit test before productionizing.**
- **Fusion prototype:** `auto_footprint3.py` (satellite footprint + operator nudge), `sun_calc.py` (timestamp+latlng → sun az/elev; used to verify photo bearings), `fusion_roof_franklin.json` (spine-format fused output with per-field provenance/confidence), `push_fusion.ts`/`approve_fusion.ts` (artifacts → promote → canonical; run with tsx; remember the BOM), `preflight_permit.mjs`, `verify_fusion.mjs`, `check_permit.mjs`, `check_address.mjs`.
- **Photo tooling (`repo/_tmp_franklin2/`):** the survey's 77 unique photos as `seq_###_label.jpg` (manifest.json maps to original structured filenames: `walk-around-east/north`, `roof-plane-pitch-azimuth-obstructions`, `utility-…`, etc. — the labels are free ground truth for detectors); `sheets.py` builds labeled contact sheets (`sheets/` holds orbit/onroof/porch/apt/roof sheets). Note: `seq_200_walk.jpg` is actually an MP4 (upload bug).

Production slot for all of the above: each becomes a worker job emitting `UnifiedGeometryArtifacts` with worldPolygon + confidence into the EXISTING rail. No LLM in the geometry loop.

## 7. THE GAP TO BRIDGE — photo-feature placement (the actual ask)

Empirical finding (20 model iterations, operator-graded): LLM vision reliably identifies WHAT is in survey photos but NOT WHERE in world coordinates. Every placement error traced to camera-pose/bearing ambiguity (frame-left = east when looking south, = west when looking north, etc.). **The gap is pose, not perception.** The bridge, in priority order:

1. **Capture-time pose (highest leverage, app-side):** log ARCore/ARKit 6-DOF camera pose + intrinsics per photo in the partner's survey app. Every detection then becomes a world-space ray; two views of a feature triangulate it deterministically. (Also solves SCALE — already on the roadmap.) Also fix: enable EXIF GPS+heading (currently 0/101 photos), stop duplicate uploads (each asset stored under 2+ filenames; historical 7× byte-identical bug), stop storing video as .jpg, fix blob-upload 500s that require manual resync.
2. **Pose recovery for EXISTING photos — model-based localization ("render-and-compare"):** the LIDAR massing model is known; render silhouettes/edges from candidate poses, match against photo edges (line features), solve camera pose; then project photo detections onto the known wall/roof planes. Established CV (PnP against a known model), deterministic. Coarse pose priors from: walk-around direction labels, capture-sequence ordering (orbit), and sun/shadow direction (`sun_calc.py`).
3. **Detection layer:** fine-tuned detector (YOLO-class or GroundingDINO-class) for the survey vocabulary — door, window, meter, panel, conduit, stairs, porch post, vent, chimney, AC unit, garage door, step flashing. Training labels: the app's structured photo names + operator corrections (the entire correction log from these sessions is labeled data).
4. **Fusion & gating:** detections-with-poses become artifacts with confidence; convergence across sources auto-promotes; divergence flags for the exception-report review UI. RULE: every evidence claim must cite a fresh read of the source (image/file), never a recollection; bearings resolved BEFORE feature placement, always.

Capture protocol spec for the partner already exists: `repo/docs/SITE-SURVEY-CAPTURE-PROTOCOL.md` (dense roof orbit, overlap targets, scale reference, acceptance gates). The one field fix that matters most: the walk-around must capture the ROOF (stand back 20–30 ft, tilt up, slow lap) — the current close wall-walk video never sees it.

## 8. Roadmap (post-proof), in order

1. Verify Proof #5 (six steps, §3) the moment the operator clicks Generate.
2. Fix `canonicalToPermit.ts` provenance stamp; add `evidence_fusion` as a typed GeometrySourcePipeline.
3. Productionize LIDAR: fetch + plane-fit worker job (fix az sign; multi-plane RANSAC from `lidar_segment.py`) → artifacts → rail. Revise the test-site canonical via the Adjust path to the measured 3-facet roof (west 17.9°, east 22.2°, low section 9.6 ft) — replaces the wrong symmetric 2-plane model.
4. Pin-verification gate (TIGER cross-check) before any fusion run.
5. Pose logging in the survey app (partner) + photo-bearing module for legacy photos.
6. Obstruction/feature detector fine-tune; project detections via poses onto LIDAR planes.
7. Review UI (exception-report layout, Approve/Adjust/Reject, per-field source+confidence ledger, Adjust-as-evidence).
8. Confidence/convergence model; exception-rate dashboard.
9. Optional: licensed HD aerial (Nearmap-class) when revenue justifies.

## 9. Hard-won rules (violate at your peril)

- Bearing-first: establish camera azimuth before mapping any photo feature to world coordinates.
- One source of truth per fact tier: measurements beat interpretation; operator statements beat everything and are immutable except by the operator.
- Never silently drop a previously confirmed feature when switching evidence sources (a real mud room got deleted that way); fuse, don't replace.
- Un-corrected ≠ correct. Verification must be intrinsic (cross-source convergence), not "nobody complained."
- LIDAR cannot see vent pipes (~2 pts/m²); obstructions come from roof photos. Aerial sources can't see meters/conduits; electrical comes from ground photos. Each layer has exactly one competent source — design to that.
- Geocoders lie in rural areas; TIGER is the arbiter. Esri z19 is the rural imagery ceiling; USGS imagery 404s at z18+; OSM/Overpass rate-limits from local machines.
- TNM API times out routinely — retry with backoff.
- The `.db_url` file has a BOM. It will bite you. Strip it.

## 10. Other open items

- Rotate the three leaked tokens (GitHub/Render/Vercel) — highest priority hygiene.
- Survey-app upload bugs (partner): duplicate filenames, video-as-jpg, blob 500s, EXIF GPS off.
- Pre-existing flaky test failures (crew-calendar, security-debug-routes, depth/lineExtraction workers, ocr/metadata adapters) — unrelated to the rail work, verified zero coupling.
- `_tmp_franklin*` directories are git-excluded diagnostics — keep until the LIDAR/fusion components are productionized; they are the working prototypes.
