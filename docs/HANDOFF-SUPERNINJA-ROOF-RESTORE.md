# SuperNinja Task — Roof plane outlines + stitch wireframe vanish on reload

**Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev` (never master) · Next.js + TS + CesiumJS.
**Scope:** ONLY `components/3d/SolarEngine3D.tsx` and `components/design/DesignStudio.tsx`. Do NOT touch any `lib/permit/*`, `lib/system/*`, `app/engineering/*`, `lib/electrical-calc.ts`, `lib/jurisdiction.ts`, `lib/cad/*` — recent fixes live there.

## Symptom (reproduced by the user)
Trace roof planes in the 3D Design Studio → **Stitch** → place panels → save → **reload the project**. On reload the **panels are still there**, but the **roof plane outlines and the stitched roof-model wireframe are GONE**. The roof model has to be re-traced from scratch.

## Root cause (confirmed in code)
The 3D roof-plane **outline entities** (`plane3DEntityMap`) and the **stitch wireframe** are only ever built from a USER ACTION this session — never restored from saved state on load:
- Trace path: `SolarEngine3D.tsx:6458-6502` (`buildRoofPlane3D` → `renderPlane3DEntity` → `plane3DEntityMap.current.set` → `onRoofPlaneCreated`).
- Stitch: `SolarEngine3D.tsx:3004-3005`. Selection re-render: `:900-901` (reads existing maps; doesn't create them).
- Auto-roof: `:7546`.

There is **NO effect that rebuilds plane outlines from the `roofPlanes` prop on mount/load.** Compare: **panels DO restore** via their own effect (`:772` `panelsRef`/`renderAllPanels`), and **fences restore** (`:774` "Rebuild fence sections from loaded panels"). Roof-plane outlines have no equivalent. So after reload `plane3DEntityMap`/`plane3DFrameMap`/`plane3DCesiumPtsMap` are EMPTY, the roofPlanes-change effects (`:796` setback, `:806` `renderRoofWireframe`) render from those empty maps → nothing draws. The geometry data is fine in `roofPlanes` state (that's why panels still sit correctly) — it's purely a **render-on-load gap**.

The saved planes carry exact 3D geometry to rebuild from (no terrain sampling needed) — `types/index.ts` RoofPlane:
- `polygon3D?: {x,y,z}[]` — ECEF corners (the actual 3D roof boundary)
- `origin3D`, `normal3D`, `localFrame3D {u,v,n}`, `createdFrom3D`.

## ⚠ Subtlety you MUST handle — stitched geometry vs stale `polygon3D`
The recent Stitch fix (commits `1802105d`, `845cb116`) writes the stitched corners back into `roofPlanes` as `vertices` (lat/lng) + `localFrame3D`, via the `onRoofPlanesStitched` prop (`SolarEngine3D.tsx` `stitchRoofVertices`) and the handler in `DesignStudio.tsx` (~`onRoofPlanesStitched={(updates)=>...}`). **It does NOT update `polygon3D`.** So after a stitch+save, `polygon3D` is the PRE-stitch ECEF corners — if the restore blindly uses `polygon3D`, the roof reloads UN-stitched. Two-part fix:

### Part A — persist the stitched 3D corners
In `SolarEngine3D.tsx` `stitchRoofVertices`, the loop already has the stitched ECEF corners as `projected` (C.Cartesian3[]). Extend the `onRoofPlanesStitched` update objects to ALSO carry `polygon3D: projected.map(p=>({x:p.x,y:p.y,z:p.z}))` (and optionally `origin3D`/`normal3D` from `frame`). Widen the prop type + the `stitchUpdates` array type (currently `{id, vertices, localFrame3D}`) to include `polygon3D`. In `DesignStudio.tsx`'s `onRoofPlanesStitched` handler, set `polygon3D` (and origin3D/normal3D) on the plane alongside `vertices`/`localFrame3D`, so the persisted plane's 3D geometry IS the stitched geometry.

### Part B — restore the roof model on load
Add a `useEffect` in `SolarEngine3D.tsx` that, once the viewer + tiles are ready, rebuilds the 3D roof model from the `roofPlanes` prop for any plane NOT already present in `plane3DEntityMap` (so it never double-builds planes traced/stitched this session). For each such plane:
1. Get ECEF corners: prefer `plane.polygon3D` (after Part A this is the stitched geometry). Fallback for 2D-only legacy planes (no polygon3D): project `plane.vertices` (lat/lng) to ECEF via `C.Cartesian3.fromDegrees(lng, lat, alt)` using the ground elevation ref (`cesiumGroundElevRef`/`cesiumGroundElevResolvedRef`) + the plane's roof height — mirror however the trace path obtains height; if unavailable, sample terrain. (Flag legacy planes without polygon3D as the harder case.)
2. Build the frame: reuse `computePlaneFromPoints3D(cartPts)` (as the trace + stitch paths do) → `frame.projectedPts` → `renderPlane3DEntity(viewer, C, projected, plane.id, frame, isSelected, markOnly)`. Mirror the trace path `:6458-6502` exactly, but starting from the saved corners instead of picked points.
3. Populate ALL three maps consistently: `plane3DEntityMap`, `plane3DFrameMap`, `plane3DCesiumPtsMap` — the setback/wireframe/selection effects all read these.
4. Respect `markOnlyPlaneIdsRef`: a plane with panels renders as a panel plane; a mark-only plane renders as an outline. Determine mark-only from saved state (planes with no panels assigned, or a persisted flag if one exists).
5. After rebuilding, set `setShowRoofModel(true)` (if there are planes) and call `renderRoofWireframe` + (if `showSetbackZones`) `renderFireSetbackZones`, so the stitched wireframe + setbacks reappear.

Guard the effect so it runs after load and is idempotent (skip planes already in `plane3DEntityMap`; don't fight the trace/stitch paths).

## DO NOT REGRESS (this session fixed a lot here)
- Stitch write-back (`onRoofPlanesStitched`), `ENABLE_TRACE_SNAP=false` (free marking — do NOT re-enable), `ENABLE_PANEL_SNAP=false`, the Auto-Layout frame hand-back (`localFrame3D`), the string/equipment viz rebuild guard, and the fire-setback miter clamp — all must keep working.
- Panel restore-on-load (`:772`) and fence restore (`:774`) must be unaffected — your new effect rebuilds ONLY roof-plane outlines/wireframe, never panels.
- Don't double-render: planes traced/stitched in the CURRENT session are already in `plane3DEntityMap`; skip them.

## Verification
1. Manual: trace ≥2 planes → Stitch (corners meet) → place panels → Save → reload → **roof outlines + stitched wireframe + panels all present and stitched**; then Auto Layout still fills on the stitched roof.
2. Add an assertion to the existing Playwright harness (`e2e/design-studio.spec.ts`) if feasible: after the trace→stitch→save flow, reload and assert the roof-model entities exist (via the `window.__solarE2E` hook — extend it to expose `plane3DEntityMap.size` / a `roofModelEntityCount`).
3. `npx tsc --noEmit` clean; `npm test` green; `NODE_OPTIONS=--max-old-space-size=4096 npm run build` (the bigger heap avoids the sandbox OOM).

## Files
- `components/3d/SolarEngine3D.tsx` — Part A (stitch emits polygon3D) + Part B (restore effect).
- `components/design/DesignStudio.tsx` — Part A handler (persist polygon3D on stitch).
- (optional) `e2e/design-studio.spec.ts` + the `window.__solarE2E` hook — reload regression test.
