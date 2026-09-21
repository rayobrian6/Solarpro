# SolarPro 3D — geometry provider audit

**Date:** 2026-09-21 · **Branch:** dev · Read-only trace plus the fixes that followed.

SolarPro 3D is **one** environment (`components/3d/SolarEngine3D.tsx`, a Cesium
viewer). Inside it there is a fallback chain of geometry providers:

| | |
|---|---|
| **Preferred** | Google / native — the Photorealistic 3D Tiles mesh, plus Google Solar roof segments converted by `lib/3d/laneA.ts` and stamped `source: 'solar_api'`. |
| **Fallback** | The hand-modelled building and roof — 3D point-tracing (`finalizePlane3D` → `buildRoofPlane3D`), 2D "Tag This Roof Plane", Square Up, Stitch. Stamped `source: 'manual'`. |

This is **not** "2D mode" and **not** a 2D → 3D conversion. The custom path is a
fallback *provider* for sites where the normal 3D source is unavailable,
incomplete, inaccurate or otherwise unusable.

---

## 1. There is no provider authority. ARCHITECTURAL FINDING.

Searched for `activeGeometryProvider`, `geometryProvider`, `activeProvider`,
`roofProvider`, `geometrySource` across the repo. **Not found.** (The
`AerialGeometryProvider` in `lib/siteSurveys/aerialGeometry/` is a separate
pipeline that does not feed SolarEngine3D.)

What exists instead:

* **`RoofPlane.source`** (`types/index.ts:408`) — per-plane provenance, optional.
  Preserved correctly through every persistence hop, and read by almost nothing:
  five UI/de-dup call sites, and **zero** in placement, rendering, production or
  the permit snapshot. `lib/permit/snapshot/build.ts` reduces a plane to
  `{ planeId, pitchDeg, azimuthDeg, moduleCount }` — a permit cannot tell a
  machine detection from a hand trace.
* **`solarApiStatus`** (`components/design/DesignStudio.tsx:634`) — drives
  sidebar copy only.
* **`resolvePlaneGeometry(...).source`** (`lib/surfaceGeometry3D.ts:507`) —
  `'own-frame-and-polygon' | 'own-frame-synthesised-polygon' | 'legacy-2d'`.
  This is *geometry completeness*, not provenance. Do not read it as provider.

**The active provider is emergent, not decided.** There is one *refusal* gate —
`shouldRunLaneA` (`lib/3d/laneA.ts`) — with **one** caller,
`maybeRunLaneA('address-change')` at `SolarEngine3D.tsx:2843`. The boot sequence
loads the twin, resolves ground elevation and reaches `stage: 'done'` **without
ever calling it**. So a project opened at its stored coordinates never
re-evaluates Google geometry at all; the address-change effect returns early
when the coordinates move less than ~11 m.

## 2. "Google data is INACCURATE" is not representable

Only "absent" is. Nothing in the SolarEngine3D path reads any Google confidence,
quality or imagery-date field — `quality=MEDIUM` is requested
(`lib/digitalTwin.ts`) and never inspected. Segments are rejected only for
geometric degeneracy (no hull, <3 points, invalid centre, under
`MIN_FACE_EXTENT_M`).

The judgement "this Google roof is wrong" lives entirely in the user's head and
is expressed by deleting planes (`DesignStudio.tsx:6127`, `:6181`). **Nothing
records that it was made**, so nothing downstream — the planset, the PE reviewer,
the next session — can know the fallback was a decision rather than an accident.

## 3. One stale plane pins a project to the fallback path, permanently

`lib/3d/laneA.ts`:

```ts
if (i.existingPlaneCount !== 0) return false;
```

fed from a bare `roofPlanesRef.current.length`. It does not look at `source`,
`confirmed`, age, or whether the plane is junk. A project with perfect Google
coverage opens on the custom path for ever if the layout row holds **one** stale
hand-built plane for the same site.

The refusal itself is correct and deliberate — a detection merged beside a
person's traced roof would be persisted by the next autosave. What is missing is
any way back: the user must delete every plane **and** produce a >11 m coordinate
change, and `laneARanForRef` then blocks a repeat for the same site key in that
session.

## 4. Ground elevation: the failure only hurts the fallback provider — FIXED

Six layers turned "elevation unknown" into `0`, ending in
`cesiumGroundElevResolvedRef.current = true` stamped unconditionally beneath a
`?? 0`. Measured through the real production functions
(`tests/groundElevationAuthority.test.ts`):

| path | error when the elevation lookup fails |
|---|---|
| Google / Lane A | **0.0000 m** — `heightAboveGround` absorbs exactly what the datum loses |
| hand-modelled 2D | **−80.0 m** — the face lands 80 m below the real roof |
| bare `groundElevM = 0` sentinel | **−47.9 m** |

So the preferred provider is immune and the fallback is not, which is precisely
backwards from where the user is standing when they need the fallback.

`resolveGroundDatum(orthometricM | null, lat)` in `lib/geodeticDatum.ts` is now
the single place the value and the "do we know it?" flag are decided together.
`shouldRunLaneA` already refused on `!groundElevResolved`; that refusal is now
reachable. `0` is treated as a real elevation — the old `> 0` guard silently
flattened Imperial Valley, New Orleans and the Salton Sea.

## 5. A Google detection was masquerading as a hand trace — FIXED

`buildRoofPlane3D` hardcodes `createdFrom3D: true`, Lane A builds through it,
and `stampDetectedProvenance` deliberately does **not** clear the flag —
clearing it would push every Google face onto the legacy 2D placement branch
(`lib/surfaceGeometry3D.ts:918-920` gates the exact-ECEF path on it), which is a
real regression on the preferred provider.

Four call sites read `source === 'manual' || createdFrom3D === true` as "a person
made this". So `dropDetectedPlanesOverlappingManual` — whose whole purpose is
"the same roof captured twice was double-filling; the manual trace wins" —
returned `true` on its first line for the detection too, and dropped nothing. It
worked for `aerial_nearmap` and was **inert for Google**.

The inert case is the fallback workflow itself: Google produces a roof, the
person judges it wrong and traces over it, Auto Layout fills both.

`isHandModelledFace()` in `lib/3d/laneA.ts` now answers authorship from `source`,
keeping a `createdFrom3D` fallback only for pre-provenance faces that record no
`source` at all. Authorship is `source`; geometry is `createdFrom3D`.

## 6. Face selection: the renderer honoured a state with no producer — FIXED

Three breaks stacked:

1. A face marked but not panelled renders through the `outlineOnly` branch of
   `renderPlane3DEntity` (`lib/roofPlane3D.ts:795-809`), which adds **one
   polyline** and returns. No polygon — nothing under the cursor to hit.
2. Every `[PLANE3D-*]` entity carries its plane id only inside `entity.name`;
   `entity.id` is a Cesium GUID, and there is no `properties:` on any of them.
   **No pick path in the repo parses those names.** The one face pick that exists
   matches `[BUILD3D-ROOF]`, a different entity family produced only while the
   Building extrusion is on — which is off by default.
3. `onRoofPlaneSelect` and `selectedRoofPlaneId` were declared, destructured and
   **never called or passed**. All seven styling comparisons were
   `undefined === <id>`.

So there were two parallel selection universes and the renderer honoured the dead
one.

**The fix does not add anything to the scene.** `lib/3d/faceHitTest.ts`
intersects the camera ray with each face's own plane and tests containment
against the polygon that was actually drawn. That matters beyond elegance:
`getWorldPosition` — the function the entire roof-*tracing* workflow depends on —
opens with `scene.pick()` and then reads `scene.pickPosition()`, so an invisible
pick body over every roof could have moved where a traced corner lands. Fixing
selection by perturbing tracing is not a fix.

`activeFaceId` collapses the two states. The engine owns the selection; the
`selectedRoofPlaneId` prop remains an optional parent override, and DesignStudio
mirrors the reported id read-only rather than feeding it back.

---

## Still open

* **No provider provenance authority** (§1) and **no "Google is wrong" state**
  (§2). Both need a product decision before code: what should be recorded when a
  person rejects the detected roof, and should a provider choice be persisted at
  all.
* **`existingPlaneCount` has no recovery path** (§3).
* **Lane A never runs at boot** (§1) — a project opened at its stored coordinates
  cannot acquire Google geometry without a >11 m address move.
* **`handleAutoRoof` calls `detectPlanesFromTwin` ungated**
  (`SolarEngine3D.tsx:11273`), bypassing `restoreResolved`, `groundElevResolved`
  and `lastRanSiteKey`.
* **Provenance does not reach the permit snapshot** (§1).

## What could not be tested here

No live Google-3D-backed project was exercised: the E2E environment has no Google
Maps key, so the Photorealistic tileset and the Solar API never load. Every
Google-path claim in this document is from source plus unit tests driving the
real conversion functions — **not** from a browser with Google data on screen.
That gap is stated rather than papered over.
