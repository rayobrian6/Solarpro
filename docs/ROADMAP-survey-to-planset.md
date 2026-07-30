# Roadmap: Site Survey → Professional Permit Planset

**Status:** Active design — supersedes the ad-hoc "fix the overlay" work.
**Owner:** Ray
**Last updated:** 2026-06-06

---

## 1. Mission

Take **any** site survey (a field tech's phone photos + address, often imperfect) and
produce a **professional-grade, permit-ready solar planset** (CAD drawings) with a light
operator review step. The differentiator is the *integrated, reliable pipeline* — phone
survey to permit set in minutes — not computer-vision magic on photos.

---

## 2. The architectural truth (why prior work stalled)

We have **two systems glued at the wrong seam**, and effort went into the wrong one.

- **System A — the planset generator — already works.** `lib/permit/generatePermit.ts`
  + `lib/drafting/renderPlanSet.ts` produce a real 16-sheet permit set (cover, site
  plan, array plan PV-2, structural PV-3, NEC PV-4, conductor schedule, ASCE 7-22
  structural calcs, SLD E-1, PE letter, equipment schedule) → HTML → PDF.
  Its roof-geometry input contract is clean (`lib/permit/types.ts:70`,
  `lib/cad/types.ts:36`): **planes with `vertices` (lat/lng), `pitch`, `azimuth`,
  `area`, `edgeTypes`** → it solves panel layout, setbacks, and dimensions.

- **There is a real authoritative geometry source — and it is NOT ground photos.**
  Google Solar API ("Pipeline C", `lib/siteSurveys/googleSolarApi/adapter.ts`) returns
  **metric roof planes: real polygons, pitch, azimuth, area, confidence 92.** That is
  CAD-grade. Ground photos cannot match it (no camera poses, no triangulation, no scale).

- **The right abstraction already exists in the middle but is a dead end.**
  `CanonicalBuildingModel` (`lib/siteSurveys/unifiedGeometry/types.ts:787`) is a clean,
  metric, authoritative roof model with an authority state machine
  (`raw_evidence → … → promoted_canonical → cad_safe`) and a synthetic-artifact firewall.
  **It is built (`canonicalBuilder.ts`) but never persisted and never consumed.**

### The single root cause
1. `CanonicalBuildingModel` is **never persisted** (no table) and **never read**.
2. The planset reads roof geometry from the **Design Studio frontend layout**
   (`layout.geometry.roofPlanes`), *not* the survey/canonical model. The plan-set route
   (`app/api/engineering/plan-set/route.ts`) makes **zero survey queries** and falls back
   to hardcoded `roofWidthFt=30, roofLengthFt=20`.
3. The ground-photo geometry track (the "43 outlines") is **firewalled by design** — its
   `heuristic` limitation auto-marks it synthetic, so it can never reach canonical.

**Conclusion:** the overlay chaos was never on the path to the planset. Patching it felt
endless because it has no destination. We stop polishing it and wire the real spine.

---

## 3. Decisions (locked 2026-06-06)

| # | Decision | Choice |
|---|----------|--------|
| Automation | Target level | **Auto-draft + operator approval.** System generates a draft planset; operator reviews/approves before final. (Matches Aurora/EagleView-class tools.) |
| Rural geometry | Source where Google Solar has no coverage | **Site-survey-authoritative via captured measurements + operator satellite trace** — NOT CV polygon extraction. Combine survey `roof_pitch_degrees`/dimensions (`project_physical_data`) with an operator-traced roof outline on free satellite imagery → metric planes. Paid aerial (EagleView/Nearmap/Hover) is an optional future upgrade. |
| Ground-photo geometry | Keep / demote / remove | **Demote to non-authoritative review aid** (hidden by default; stop investing in quality). **Keep** the SAM2 + SegFormer classifier scaffolding — repurpose it for the enrichment layer (obstructions, electrical, roof condition). |

---

## 4. Target architecture

```
Address + photos
   │
   ├─► GEOCODE ─► ROOF GEOMETRY RESOLVER  (authoritative, metric)
   │         Tier 1: Google Solar API           (covered areas)
   │         Tier 2: site-survey trace          (rural: operator traces outline on
   │                 + captured measurements      satellite + survey pitch/dimensions)
   │         Tier 3 (optional/future): aerial provider API
   │                        │
   │                        ▼
   │            CanonicalBuildingModel  ◄── PERSIST (new table)  [THE SPINE]
   │            metric planes: vertices, pitch, azimuth, area, edges
   │                        │
   │              operator review / approve  ◄── promotion gate (already built)
   │                        │
   └─► GROUND PHOTOS ──► ENRICHMENT / QA  ──────┤  obstructions (vents/AC/skylights),
       (SAM2 + SegFormer)  verify, don't define  │  electrical (panel/meter/rating),
                                                  │  roof condition (moss/damage)
                                                  ▼
                                    planset generator (ALREADY WORKS)
                                                  ▼
                                        permit PDF (16 sheets)
```

**Principle:** Aerial/trace **defines** roof geometry. Ground photos **verify and enrich**
it. Nothing heuristic ever becomes authoritative — the existing firewall stays.

---

## 5. The spine: the canonical contract everything feeds

Everything upstream must converge on **one** structure, then the working planset consumes it.

- Authoritative model: `CanonicalBuildingModel` (`types.ts:787`) — `roofPlanes`,
  `wallPlanes`, `obstructions`, `electricalNodes`, `structuralLines`, in **metric local
  meters**, authority `promoted_canonical`/`cad_safe`.
- Planset input: `PermitInput.layout.geometry.roofPlanes` (`lib/permit/types.ts:288`) /
  `CADModel.roof.planes[]` (`lib/cad/types.ts:36`) — planes with lat/lng vertices, pitch,
  azimuth, area, edgeTypes.
- Bridge: `lib/cad/canonicalBridge.ts` (`canonicalToCADInputs`) **exists but is unwired** —
  Phase 1 wires it.

Known gap to resolve in Phase 1: the canonical builder assumes `local_meters_xy` but Solar
API artifacts arrive in image/normalized space. The resolver must emit **metric lat/lng**
planes (Solar API already has them; the adapter currently normalizes to image space for
overlays — we add a metric path for canonical).

---

## 6. Phased roadmap

### Phase 0 — Scope & decide  ✅ (this document)
- Decisions locked (§3). Architecture agreed (§4). Demote-not-delete the chaos.

### Phase 1 — Wire the spine (covered sites end-to-end)
**Goal:** an address with Google Solar coverage produces a draft planset from survey data.
1. **Persist the canonical model.** New `canonical_building_model` table + migration;
   write on build; `GET .../canonical-building-model` to read.
2. **Solar API → metric canonical.** Add a metric (lat/lng) plane path from
   `googleSolarApi/adapter.ts` into `CanonicalBuildingModel` (bypass the image-space
   normalization used for overlays).
3. **Consume canonical in planset/permit.** Add `surveyId` to
   `app/api/engineering/plan-set/route.ts`; fetch canonical; map planes →
   `layout.geometry.roofPlanes` via `canonicalBridge`. Graceful fallback to Design Studio
   layout if absent.
4. **Authority gate.** Planset refuses to treat anything below `promoted_canonical` as
   geometry (warn + require approval).
**Acceptance:** test survey at a *covered* address → operator approves → 16-sheet PDF with
roof planes/pitch/azimuth/area from Solar API, not hardcoded 30×20.

### Phase 2 — Rural fallback (site-survey-authoritative)
**Goal:** the rural test site (1010 Franklin St, Pocahontas IL) produces a draft planset.
1. **Operator roof-trace tool:** satellite/aerial imagery (Google/Esri tiles) with a
   polygon-tracing UI; operator outlines each roof plane.
2. **Measurement binding:** pull `roof_pitch_degrees`, dimensions, material from
   `project_physical_data`; assign pitch/azimuth per traced plane; compute area metrically
   from the trace scale.
3. **Emit canonical** identical in shape to the Solar API path (same spine).
**Acceptance:** rural survey → operator traces + confirms pitch → same planset output path.

### Phase 3 — Enrichment layer (repurpose the vision)
**Goal:** ground photos add value to the planset, as review-only enrichment.
1. **Obstructions:** SAM2 + classifier detect vents/AC/skylights → `obstructions` on the
   canonical roof planes → drive setbacks/keep-outs in CAD.
2. **Electrical:** classify/OCR panel & meter photos → panel rating, meter, interconnection
   → feed the SLD / electrical sheets.
3. **Roof condition:** moss/algae/damage flags → site notes / conditions sheet.
All review-only; operator confirms before it influences the stamped set.
**Acceptance:** a detected roof AC unit becomes a keep-out in PV-2; a panel photo populates
the main-panel rating.

### Phase 4 — Quarantine the chaos
1. Mark ground-photo plane/line extraction non-authoritative; hide by default in the UI
   (keep behind a debug/dev flag for inspection).
2. Stop optimizing its geometry quality. Redirect its segmentation output to Phase 3.
**Acceptance:** default survey view no longer shows the 43-outline clutter.

---

## 7. What we explicitly STOP doing
- Tuning the ground-photo plane/line overlay for "readability."
- Treating per-photo 2D heuristic polygons as candidate roof geometry.
- Threshold-chasing on consensus/wall-plane proliferation.
- Any attempt to derive metric 3D roof geometry from ground photos via CV.

---

## 8. Risks & open questions
- **Coordinate transform** (image-space ↔ metric) must be correct for canonical; Solar API
  gives metric directly, the trace tool computes scale from imagery zoom/lat.
- **Trace tool effort** is the main net-new build (Phase 2); everything else is wiring.
- **Operator review UX** must be fast or the "auto-draft + approve" promise erodes.
- **Pitch from survey:** depends on techs capturing it; need a capture-quality check and a
  sensible default + warning when missing.

---

## 9. Pointers (entry files)
- Planset generator: `lib/permit/generatePermit.ts`, `lib/drafting/renderPlanSet.ts`
- Planset input contract: `lib/permit/types.ts:70,288`, `lib/cad/types.ts:36`
- Canonical model: `lib/siteSurveys/unifiedGeometry/{types.ts:787,canonicalBuilder.ts,promotion.ts,authority.ts}`
- Unwired bridge: `lib/cad/canonicalBridge.ts`
- Solar API source: `lib/siteSurveys/googleSolarApi/{client.ts,adapter.ts,types.ts}`
- Plan-set route (needs surveyId + canonical read): `app/api/engineering/plan-set/route.ts`
- Permit route (already survey-aware, partial): `app/api/engineering/permit/route.ts`
- Survey structured fields: `project_physical_data` (migrations 013/017)
- Ground-photo track to demote: `lib/siteSurveys/geometryReconstruction/**`, overlay in
  `components/UnifiedGeometryOverlayRenderer.tsx`
