# SuperNinja Task — Auto roof keep-outs from Nearmap AI obstructions

**Owner:** SuperNinja · **Branch:** `dev` (auto-deploys to solarpro-dev.vercel.app)
**Date handed off:** 2026-06-30

## Goal
When a designer detects a roof from aerial, **automatically pull Nearmap's AI-detected roof
obstructions** (vents, chimneys, A/C units, satellite dishes, skylights) and place **keep-out
zones** on the roof so the panel auto-layout avoids them — no more hand-marking every vent.

We confirmed (live probe, 2026-06-30) that this account's Nearmap AI Feature API returns these
obstruction classes for a typical roof, with real lat/lng polygon geometry + confidence:
- **`Vent`** (the big one — 40 on one test roof)
- **`Residential Chimney`**
- **`A/C Condenser Unit`**
- **`Residential Satellite Dish`**
- (skylights/other roof clutter may appear as additional classes — handle any obstruction-type
  class generically, don't hardcode only these four)

## How Nearmap is called (already in the codebase)
- Adapter: **`lib/aerial/nearmap.ts`** (SERVER-ONLY, reads `process.env.NEARMAP_API_KEY`). It
  already calls Coverage (free) + the AI Feature API:
  - Coverage:  `GET https://api.nearmap.com/coverage/v2/point/{lon},{lat}?apikey=KEY`
  - AI Feature: `GET https://api.nearmap.com/ai/features/v4/features.json?polygon={lon,lat,...}&apikey=KEY`
  - Each AI-Feature call **costs credits** → always coverage-check first (free), and **cache** the
    result per (lat,lng,survey) so re-detecting the same roof doesn't re-charge.
  - The AI response is GeoJSON-ish: `features[]` each with `description` (class name, e.g. "Vent"),
    `classId`, `confidence`, and `geometry` (Polygon, real lon/lat). Filter by `description`.
- The existing roof-detect path: **`app/api/aerial-roof-detect/route.ts`**, called from
  `components/design/DesignStudio.tsx:~1347` (`fetch('/api/aerial-roof-detect?lat=&lng=')`). Model
  the obstruction fetch on this — either extend that route to also return obstructions, or add a
  sibling route `/api/aerial-obstructions`. (Server can call Nearmap directly; the deployed dev env
  has `NEARMAP_API_KEY`, so it works live on dev — your local tsc/tests won't have the key, so
  unit-test the PARSING with mock JSON.)

## Build it

1. **Server adapter — `lib/aerial/nearmap.ts`**: add `fetchNearmapObstructions(lat, lng)` →
   returns `NearmapObstruction[]` where each has `{ type: 'vent'|'chimney'|'ac_unit'|'satellite'|'skylight'|'other', polygon: {lat,lng}[], confidence, captureDate }`. Reuse the existing
   coverage-check + AOI polygon helpers (`aoiPolygonAround`). Map Nearmap `description` → your type
   enum. Fail-safe to `[]` on no key / no coverage / error.

2. **API route**: extend `aerial-roof-detect` (or new route) to return `obstructions` alongside the
   roof planes. Keep it a user-action (it costs credits).

3. **Keep-out data model + exclusion logic** (the important part): obstructions become exclusion
   zones the panel layout must avoid, exactly like fire setbacks already do.
   - There's already a `setbackZones` concept: `DesignStudio.tsx:801` (`setSetbackZones`), rendered
     at ~2083 (`showSetbackZones`), and the auto-layout already excludes panels via point-in-polygon
     + the "firewalk filter" (see the racking/mid-clamp note at ~4536). **Reuse this machinery** —
     add the obstruction polygons (with a per-type clearance buffer, see below) as keep-out zones so
     the existing panel-placement exclusion drops any panel overlapping them.
   - Point-in-polygon helpers exist: `lib/cad/geometry.ts:111 pointInPolygon`,
     `lib/3d/controlLayer.ts pointInPolygonLatLng`. Don't write a new one.
   - **Clearance buffer per type** (configurable defaults; a panel is excluded if it overlaps the
     obstruction polygon expanded by this margin): vent/pipe ~0.15 m, satellite ~0.3 m, A/C ~0.3 m,
     chimney ~0.6 m, skylight ~0.3 m. Make these constants, easy to tune.

4. **DesignStudio wiring**: surface the obstructions on the roof (render the keep-out polygons,
   distinct style from fire setbacks), fold the fetch into the existing "Detect roof from aerial"
   action (or a separate "Detect obstructions" button), and ensure the auto-layout re-runs with the
   new keep-outs so panels avoid them. A toggle to show/hide obstruction zones is nice.

5. **Coordinate alignment**: obstructions come back in true lat/lng (same as Nearmap roof geometry).
   Project them into the design's coordinate space the SAME way the detected roof planes are, so they
   land in the right spot. (Follow how `aerial-roof-detect` planes are projected/placed.)

## Cost / safety
- AI Feature calls cost Nearmap credits → **coverage-check first (free)**, **cache per survey**, and
  only fetch on an explicit user action. Don't auto-fire on every pan.
- Read the key from `process.env.NEARMAP_API_KEY` only (server-side). Never log or expose it.

## Verify
- tsc clean; unit-test the adapter's class→type mapping + the keep-out exclusion (panel-overlaps-
  obstruction → excluded) with **mock Nearmap JSON** (no live key needed). Add tests under `tests/`.
- Live smoke on dev (which has the key): detect a roof at a covered address (e.g. Edwardsville/
  Granite City IL), confirm vents/chimney show as keep-outs and panels avoid them.

## Coordination
- This lives mostly in `lib/aerial/nearmap.ts`, a new/extended API route, and `DesignStudio.tsx`.
  Claude's recent DesignStudio changes (Nearmap tile layer, 2D pan, ESRI zoom) are already pushed —
  **pull latest `dev` first**, keep your DesignStudio edits additive, and you own the obstruction
  feature. Claude + Ray are working the 3D→2D roof re-anchoring + aerial geocode (permit route /
  roofGeometry) — stay out of those.
- Bump `PLANSET_ENGINE_VERSION` only if you change planset output (this is Design-Studio side, so
  probably not needed).

## Definition of done
- "Detect roof from aerial" (or a dedicated button) also pulls Nearmap obstructions and renders them
  as keep-out zones; the panel auto-layout avoids them with per-type clearance buffers.
- Coverage-checked + cached + user-action-gated (credit-safe).
- tsc clean, unit tests for parsing + exclusion green, live screenshot on dev showing panels routing
  around real vents/chimney. List every file touched + a short demo writeup for Ray.
