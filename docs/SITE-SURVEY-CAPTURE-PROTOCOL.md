# Site Survey Capture Protocol & App Spec
### For the field-survey app — to make ground photos reconstructable into a roof (photogrammetry-ready)

**Audience:** the developer modifying the site-survey app.
**Goal:** capture site-survey photos that a Structure-from-Motion (SfM) engine can turn into a clean, metric 3D roof — then a permit planset. Today's captures can't (proven below); this spec fixes the capture, not the engine.

---

## 0. Why this exists (the evidence)

We ran a real SfM engine (feature tracking → camera-pose recovery → bundle adjustment) on an actual completed survey (1010 Franklin St). It reconstructed only **3 of 22 photos** into one model. Three independent checks showed the same root cause — **the capture, not the software:**

1. **Overlap:** at a reliable match strength the 22 photos fragment into ~10 disconnected "islands." SfM needs every photo chained into ONE connected graph; these were shot ~30–40° apart (too far).
2. **Angle:** the roof surface is only seen at a grazing angle from the ground, heavily occluded by trees/vehicles. Few photos actually image each facet.
3. **Scale:** GPS was OFF in 0/22 photos and there was no measured reference — so even a good reconstruction would float at an unknown size.
4. **Duplication bug:** the "142 photos" were really **22 unique images each uploaded 7× (byte-identical)**. Duplicates add zero reconstruction value and inflate every survey.

**The engine works** — it reconstructed every photo that overlapped its neighbor. The job is to feed it dense, overlapping, well-angled, scaled photos. That's everything below.

---

## PART A — The Roof Scan (the core new capture)

This is the one genuinely new thing the app must guide. Think of it as a deliberate **orbit** of the building, not a handful of snapshots.

### A1. The geometry (angle optimization) — the non-negotiables
- **Full 360° orbit** of the structure. No side skipped.
- **≥70% overlap** between consecutive photos → in practice, **a photo every ~10–15° of the orbit** (one every couple of walking steps). This is the single most important rule. Sparse = fragments.
- **Two passes (rings) minimum:**
  - **Ring 1 — "context loop":** stand back far enough that the **whole house + roof + a strip of ground** is in frame (roughly 1.5–2× the eave height back from the wall, ~20–30 ft for a single story). Eye level, slight upward tilt. ~**28–32 photos** for the full circle.
  - **Ring 2 — "roof loop":** closer, tilt **up ~30°**, framing the **roof + top of the walls**. ~**24–28 photos**.
- **Corner shots:** at **each building corner** (where two roof facets meet), take **2 extra photos** angled to see *both* adjoining facets. Corners are the highest-value tie points. (~8–12 photos.)
- **Elevation boost (high impact, optional):** a handful of photos from *any* height aimed **down** at the roof — truck bed, step stool, a slight rise, a ladder. Even 4–6 elevated shots dramatically improve roof-surface reconstruction, because ground-only sees the roof edge-on.
- **Keep continuity:** move **slowly and steadily**; never "jump" to a new spot. Each photo must share most of its content with the previous one.

**Target total: ~60–80 photos** of the roof/building. With auto-capture this is **~3–4 minutes** of walking.

### A2. Scale reference (do BOTH; either alone is enough)
- **Object:** lay a **clearly-marked measuring stick or tape, extended to a known length (e.g., 8 ft / 2 m)**, flat on the driveway, **visible in ≥5 of the orbit photos.**
- **Measurement:** have the tech **measure one real roof dimension** (one eave length is ideal) with a tape/laser and **type it in.**

One real length anchors the entire 3D model to true feet. Without it, the geometry is shape-only.

### A3. Photo quality rules (enforce in-app)
- **Lock zoom at 1×** for the whole scan (zoom changes break the camera model).
- **No motion blur** — steady hands, good light; reject blurry frames.
- **Sun behind the tech** where possible; avoid shooting into the sun.
- **Always keep ground/wall context** in frame — never crop to pure sky (sky has no features to match).
- **Work around occluders** — move so trees/vehicles don't block the roof; take extra angles past them.

---

## PART B — App user flow (guided capture)

The app should make the geometry above **impossible to get wrong**, not leave it to the tech's judgment.

### B1. "Roof Scan" guided mode
1. **Start:** tech stands at the front, frames the whole house, taps **Start Scan**.
2. **Auto-capture orbit:** as the tech walks a slow circle, the app **auto-captures** on an interval (driven by device motion / step cadence / GPS), guaranteeing spacing. On-screen:
   - A **ring/compass dial** that **fills in as the orbit completes** — the tech sees exactly which angles are still missing.
   - **Live coaching:** "Slow down," "Keep the whole roof in frame," "Tilt up," "Overlap ✓ / overlap low — move closer."
   - The app **won't allow finish until the ring is complete** (no angular gap > ~20°).
3. **Roof loop prompt:** repeat closer, tilted up (Ring 2).
4. **Corner prompt:** "Photograph each corner (both sides)" with a counter.
5. **Elevation prompt (optional):** "Any height available? Shoot the roof from above the eave."
6. **Scale step:** "Lay the measuring stick in view **or** measure one eave and enter the length."

### B2. Real-time overlap validation (on-device)
- Run **lightweight feature matching (ORB) between each new frame and the previous** on-device. If shared features drop below a threshold → **prompt the tech to back up and re-walk that gap** before continuing. This is the live guarantee that the graph stays connected.

### B3. Acceptance criteria — the app's "good capture" gate
A roof scan is **accepted** only if:
- ✅ **≥45 photos** covering a **full 360°**, no angular gap **> 20°**.
- ✅ **Consecutive-frame overlap ≥ 60–70%** (on-device ORB match count).
- ✅ **Roof present in ≥ 60%** of frames.
- ✅ **Scale present:** reference object detected **or** one measurement entered.
- ✅ **EXIF intact + GPS ON** (see Part D).

If any fail, the app tells the tech *exactly what's missing* and lets them top up — before they leave the site.

---

## PART C — Full site survey walkthrough (everything a planset needs)

The roof scan gives geometry. A permit planset needs more. Walk the tech through these, in order:

1. **Setup** — confirm address (geocodes to lat/lng — required to place the 3D model in the world), date, tech name.
2. **Roof scan** — Part A. *(geometry)*
3. **Roof detail & condition** — close-ups of: each facet surface, ridges, eaves, valleys, rakes; **roof material** (shingle/metal/tile), approximate **age**, **damage/moss/algae**. *(condition + material for structural sheet)*
4. **Obstructions** — photograph **each** roof obstruction (vent, AC condenser, skylight, chimney, satellite, pipe) up close, and note its rough location. *(setbacks / keep-outs)*
5. **Electrical** — main **service panel** (door closed showing rating, door open showing breakers/busbar), the **meter**, the **main breaker** and **busbar rating** label, **interconnection point**, any **sub-panels**. *(SLD + interconnection)*
6. **Structural / attic** (if accessible) — **rafter/truss size & spacing**, **sheathing**, attic access. *(structural calcs)*
7. **Site & access** — property setbacks, access path for install, ground conditions, **shading** (trees, tall structures), a street-front photo. *(site plan)*

---

## PART D — Critical app fixes (do these regardless)

1. **Turn GPS/location ON during capture and write it to EXIF.** The Franklin photos had GPS off (0/22). On-phone GPS (~3–5 m) won't set precise scale, but it **initializes the reconstruction's position and orientation** and is a free safety net.
2. **Stop stripping EXIF.** Keep focal length, camera model, GPS — the engine uses them for the camera model.
3. **Fix the 7× duplicate upload.** Each photo is currently stored 7 times, byte-identical. This wastes storage, inflates counts (makes "22" look like "142"), and adds zero value. **De-duplicate on upload (one row per unique image).**
4. **Upload at high resolution** (don't aggressively recompress) — feature detail drives reconstruction quality. Balance against upload size; ~1600–2000 px long edge is plenty.

---

## Appendix — why these numbers (the rationale)

SfM recovers each camera's position **from overlapping features shared between photos**, then triangulates 3D points. Two requirements:
- **Connectivity:** every photo must share enough features with neighbors to form ONE connected graph. ~70% overlap ⇒ photos every ~10–15° ⇒ ~24–30 per 360° ring. Below that, the graph fragments (exactly what killed Franklin).
- **Parallax + angle diversity:** each roof facet must be seen from **≥3 photos at different angles** to triangulate its plane. Ground-only grazing views are weak, so we add a closer tilted ring, corner shots, and any elevation.
- **Scale:** SfM reconstructs shape up to an unknown scale factor. **One known real-world length** fixes it to true feet.

Get those three right and the engine we already built reconstructs the roof. The capture is the whole ballgame.
