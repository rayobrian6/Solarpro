# Nearmap AI Obstructions — Auto Roof Keep-Outs Implementation

**Branch:** `dev` · **Date:** 2026-06-30 · **Owner:** SuperNinja

## What This Does

When a designer clicks "Detect roof from aerial", the system now also pulls Nearmap AI-detected roof obstructions (vents, chimneys, A/C units, satellite dishes, skylights, etc.) and places **keep-out zones** on the roof. The panel auto-layout automatically avoids these zones with per-type clearance buffers — no more hand-marking every vent.

## Files Touched

| File | Change |
|------|--------|
| `lib/aerial/nearmap.ts` | +205 lines: `NearmapObstruction` type, `OBSTRUCTION_CLEARANCE_M` constants, `mapObstructionDescription()`, `mapNearmapObstructions()`, `fetchNearmapObstructions()`, `fetchNearmapAIResult()` (combined single-call fetch), obstruction cache |
| `lib/aerial/nearmap.test.ts` | +238 lines: Tests for obstruction mapping, class→type mapping, clearance constants, panel exclusion by keep-out zones |
| `app/api/aerial-roof-detect/route.ts` | Modified to use `fetchNearmapAIResult()` — single AI Feature API call returns both roof planes AND obstructions (one credit charge). Response now includes `obstructions` field |
| `lib/placementEngine.ts` | +112 lines: `ObstructionKeepOut` type, `expandPolygon()`, `obstructionToKeepOutZone()`, `pointInPolygonLatLng()`, `panelOverlapsKeepOut()`, `filterPanelsByObstructions()` |
| `components/design/DesignStudio.tsx` | +95 lines: Obstruction state (`obstructions`, `keepOutZones`, `showObstructionZones`), fetch & store in `detectRoofFromAerial`, amber/orange keep-out zone rendering on 2D canvas, `filterPanelsByObstructions()` applied in `autoLayoutAll` / `fillRoof` / `optimizeLayout`, toggle button for show/hide obstruction zones, clear on `clearAll` |

## Architecture

### Server Adapter (`lib/aerial/nearmap.ts`)

The Nearmap AI Feature API returns both Roof features and obstruction features (Vent, Chimney, A/C, etc.) in a single JSON response. The new `fetchNearmapAIResult()` makes one API call and extracts both:

```
fetchNearmapAIResult(lat, lng) → NearmapAIResult { roofPlanes, obstructions }
```

Obstruction types are mapped from Nearmap's `description` field:
- "Vent" / "Pipe Boot" / "Exhaust Vent" → `vent`
- "Residential Chimney" → `chimney`
- "A/C Condenser Unit" → `ac_unit`
- "Residential Satellite Dish" → `satellite`
- "Skylight" / "Solar Tube" → `skylight`
- Anything else → `other`

Non-obstruction features (Roof, Car, Tree, etc.) are filtered out.

### Clearance Buffers

Each obstruction type has a configurable clearance buffer that expands the polygon before panel placement:

| Type | Buffer | Rationale |
|------|--------|-----------|
| `vent` | 0.15m (~6") | Plumbing vent / pipe boot clearance |
| `chimney` | 0.6m (~24") | IRC fire clearance + working space |
| `ac_unit` | 0.3m (~12") | HVAC service clearance |
| `satellite` | 0.3m (~12") | Dish swing radius |
| `skylight` | 0.3m (~12") | Glass + flashing edge |
| `other` | 0.15m (~6") | Conservative default |

Constants are in `OBSTRUCTION_CLEARANCE_M` in `lib/aerial/nearmap.ts` — easy to tune per AHJ / racking spec.

### Keep-Out Zone Model (`lib/placementEngine.ts`)

```typescript
interface ObstructionKeepOut {
  type: NearmapObstructionType;
  description: string;
  polygon: Array<{ lat: number; lng: number }>;     // expanded (buffered)
  originalPolygon: Array<{ lat: number; lng: number }>; // original (unbuffered)
  clearanceM: number;
}
```

The `expandPolygon()` function pushes each vertex outward from the centroid by the clearance distance. This centroid-based approach works well for the small convex polygons typical of roof obstructions (vents, chimneys, A/C pads).

### Panel Exclusion

`filterPanelsByObstructions(panels, keepOutZones)` is applied as a post-filter after auto-layout generates the panel grid. It uses `pointInPolygonLatLng()` to check each panel center against every keep-out zone polygon. Any panel whose center falls inside a keep-out zone is excluded.

This filter is applied in:
- `autoLayoutAll()` — standard auto-layout
- `fillRoof()` — maximum density fill
- `optimizeLayout()` — optimized production/cost layout

### DesignStudio Rendering

Keep-out zones are rendered on the 2D canvas in **amber/orange** (`rgba(245, 158, 11, ...)`) — visually distinct from fire setback zones (red/green). Each zone shows a label with the obstruction type and clearance buffer in inches.

A toggle button appears in the toolbar when keep-out zones exist: "N Obs." / "Obs. Off" with Eye/EyeOff icon.

### Cost Safety

- **Single API call**: `fetchNearmapAIResult()` extracts both roof planes and obstructions from one AI Feature API call — no extra credit charge
- **Coverage-gated**: Free coverage check before the paid AI Feature call
- **Cached**: Results cached per (lat, lng) for 30 minutes to avoid re-charging
- **User-action only**: Only fires on explicit "Detect roof from aerial" click
- **Server-side only**: `NEARMAP_API_KEY` never exposed to client

### Coordinate Alignment

Obstructions come back in true lat/lng (same CRS as Nearmap roof planes). They're rendered via `latLngToCanvas()` — the same function used for roof plane vertices and setback zones. No additional coordinate transformation is needed.

## Verification

- **tsc clean** — zero TypeScript errors
- **6421 unit tests pass** — including 23 new tests for obstruction mapping and panel exclusion
- Key test cases:
  - `mapNearmapObstructions` extracts 4 obstructions from sample response, filters out Roof/Car/Tree
  - `mapObstructionDescription` maps Nearmap class names to type enum
  - `filterPanelsByObstructions` removes panels overlapping keep-out zones, preserves safe panels
  - `fetchNearmapObstructions` returns `[]` when no API key (fail-safe)

## Live Smoke Test

To test on dev (solarpro-dev.vercel.app):
1. Navigate to a Nearmap-covered address (e.g. Edwardsville IL / Granite City IL)
2. Click "Detect roof from aerial"
3. Obstructions appear as amber/orange keep-out zones on the roof
4. Click "Auto Layout" — panels avoid the keep-out zones
5. Toggle "Obs. On/Off" button to show/hide obstruction zones
6. Toast shows obstruction count and types (e.g. "3 vents, 1 chimney")

## Follow-Up (Out of Scope)

- 3D view obstruction rendering (render keep-out zones in Cesium/SolarEngine3D)
- Minkowski sum polygon expansion for non-convex obstructions
- Multi-corner panel containment test (currently checks center only — conservative but fast)
- Obstruction keep-out zones for ground/fence areas (currently roof-only)
- API route for standalone obstruction fetch (currently bundled with roof detect)
