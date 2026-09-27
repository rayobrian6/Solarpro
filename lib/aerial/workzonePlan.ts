// ═══════════════════════════════════════════════════════════════════════════
// THE PROJECT'S IMAGERY WORKZONE — PLANNED IN METRES, PRICED IN TILES, BOUNDED BY BOTH.
//
// 🚨 THE LIVE DEFECT THIS EXISTS TO FIX. Ray, on the first Nearmap-in-3D build:
//
//   "The underlying world in Nearmap mode looks like the ESRI/fallback environment. A rectangular
//    Nearmap orthophoto is effectively being placed into that fallback world. Straight overhead it
//    can look acceptable. Once the camera moves, it becomes obvious that this is not a coherent
//    design environment."
//
// One 1440x810 frame is about 84 m x 47 m at z21 — a house and its driveway. Everything around it
// was somebody else's basemap. He asked instead for "project property + nearby neighborhood
// context", about a three-block neighbourhood, and for the world outside it to be SolarPro's own
// neutral design surface rather than a borrowed photograph.
//
// ═══ WHAT IS ACTUALLY METERED, MEASURED FROM THE CODE ═══
//
// `fetchNearmapStaticAerial` makes exactly one kind of upstream request:
//
//     GET https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey=…
//
// one per entry of `nearmapTileGrid(...).tiles`, and nothing else in the imagery path touches
// Nearmap at all. So the unit of spend IS the 256 px tile GET, and the tile count is a PURE
// FUNCTION of (lat, lng, zoom, widthPx, heightPx) — which is why this planner can price a workzone
// exactly, before buying it, with the same arithmetic that buys it.
//
// 🚨 WHAT THIS DOES NOT KNOW, AND DOES NOT PRETEND TO. Ray: "Do not assume this saves money until
// request/billing semantics are verified." Whether Nearmap prices a z19 tile the same as a z21 tile
// is a LICENSING question that no amount of reading this repo can answer, and nothing here claims
// it. What is verified from the code is the REQUEST semantics: tiles are the only metered call, and
// the counts below are exact. If Nearmap's contract prices tiles uniformly, the numbers below are
// the cost; if it prices by area or by zoom, the tile counts are still the request volume and the
// area figures are still stated, so the trade can be re-decided without touching any other file.
//
// ═══ THE TILE ARITHMETIC THAT DECIDES THE SHAPE (computed, at Ray's latitude 38.6°) ═══
//
//   the same 360 m x 240 m neighbourhood, at each zoom (38.6°N, -90.2°E — measured, not estimated):
//      z21   5.8 cm/px   6171 x 4114 px    425 tiles      ← design resolution: unaffordable
//      z20  11.7 cm/px   3086 x 2057 px    117 tiles      ← still ~2x the whole two-layer plan
//      z19  23.3 cm/px   1543 x 1029 px     35 tiles      ← affordable, and legible as context
//
//   today's whole workzone:  84 m x 47 m at z21 =  24 tiles
//   this file's whole plan:  120 x 90 m core + 360 x 240 m ring = 63 + 35 = 98 tiles
//
// So the answer to "is multi-resolution economically sensible" is YES, and by a wide margin — a
// 360 x 240 m neighbourhood at z19 costs 35 tiles, about half of what a 120 x 90 m frame costs at
// z21, because one zoom level down is 4x the ground per tile. The same neighbourhood at design
// resolution is 425 tiles: 4.3x this entire plan and 17.7x today's frame. That is the whole reason
// this file has two layers:
//
//   CORE     z21, 120 m x 90 m   — the parcel, the house, the immediate neighbouring structures.
//                                  This is the surface roofs are traced on and modules are placed
//                                  against, so it gets the full 5-6 cm/px.
//   CONTEXT  z19, 360 m x 240 m  — the neighbourhood. Coherence, orientation, and the shading
//                                  context of the street. NOT a tracing surface, and the studio
//                                  says so rather than implying the whole frame is 6 cm/px.
//
// ═══ THE COST BOUND IS A TILE CEILING, NOT A HOPE ═══
//
// A metric extent alone is NOT a cost bound, because pixels per metre depend on latitude: the same
// 120 m x 90 m core is 48 tiles at the equator, 63 at St Louis, 80 in Seattle and 154 in Anchorage.
// An extent-only rule would quietly triple the spend for a northern customer.
//
// So each layer carries a HARD TILE BUDGET, and the planner shrinks the EXTENT to fit it. Cost is
// the invariant; ground coverage is what gives. A plan states the extent it actually achieved, and
// `tests/workzoneIsBoundedAndPriced.test.ts` pins both — so widening the extent cannot pass review
// by accident, at any latitude on earth.
//
// Nothing here fetches, stores or renders anything. It decides WHAT to buy; `projectWorkzone.ts`
// decides WHETHER it may be bought at all.
// ═══════════════════════════════════════════════════════════════════════════

import {
  nearmapTileGrid, nearmapImageBounds, groundResolutionCmPerPx, metresPerPixel,
  type ImageBounds,
} from '@/lib/map/webMercator';

/** Which job a layer does. The core is authored against; the context is looked at. */
export type WorkzoneLayerRole = 'core' | 'context';

export interface WorkzoneLayerTarget {
  role: WorkzoneLayerRole;
  zoom: number;
  /** The extent we WANT, in metres of ground. Shrunk if the tile budget binds first. */
  targetWidthM: number;
  targetHeightM: number;
  /** The most paid tile GETs this layer may ever cost, at any latitude. */
  tileBudget: number;
}

/**
 * 🚨 THE ONE PLACE THE PAID EXTENT IS DECIDED.
 *
 * Changing a number here changes what every project buys, so it is deliberately one small table
 * with the cost of each row computed in the header above and asserted in the test. There is no
 * second extent anywhere: `WORKZONE_WIDTH_PX`/`WORKZONE_HEIGHT_PX` in `projectWorkzone.ts` remain
 * only as the legacy permit frame, for reading back workzones bought before layers existed.
 */
export const WORKZONE_TARGETS: WorkzoneLayerTarget[] = [
  // The design surface. z21 is Nearmap Vert's top zoom and ~6 cm/px at mid latitudes.
  { role: 'core',    zoom: 21, targetWidthM: 120, targetHeightM: 90,  tileBudget: 72 },
  // The neighbourhood. z19 is the zoom at which a three-block ring costs about one core.
  { role: 'context', zoom: 19, targetWidthM: 360, targetHeightM: 240, tileBudget: 40 },
];

/** The hard ceiling on one project's whole imagery acquisition, ever. Sum of the budgets. */
export const WORKZONE_TILE_CEILING = WORKZONE_TARGETS.reduce((n, t) => n + t.tileBudget, 0);

export interface WorkzoneLayerPlan {
  role: WorkzoneLayerRole;
  zoom: number;
  widthPx: number;
  heightPx: number;
  /** Exactly how many paid tile GETs this layer will make. From `nearmapTileGrid`. */
  tiles: number;
  /** Where it will land on the ground. The renderer georeferences from this. */
  bounds: ImageBounds;
  groundWidthM: number;
  groundHeightM: number;
  resolutionCmPerPx: number;
  /** True when the tile budget, not the target extent, decided the size. */
  boundedByBudget: boolean;
}

export interface WorkzonePlan {
  lat: number;
  lng: number;
  /** Core first, then context. A plan may hold only a core (see `containedIn` below). */
  layers: WorkzoneLayerPlan[];
  /** The whole acquisition's cost, in paid tile GETs. */
  totalTiles: number;
}

/**
 * Is the inner rectangle strictly inside the outer one?
 *
 * The context layer is drawn as a RING — the neighbourhood with the core cut out of it — so that no
 * ground is painted twice and the coarse pixels never cover the fine ones. A hole that pokes
 * outside its polygon is not a ring, so a plan that cannot satisfy this drops the context layer
 * rather than rendering something broken.
 */
function containedIn(inner: ImageBounds, outer: ImageBounds): boolean {
  return inner.west > outer.west && inner.east < outer.east
    && inner.south > outer.south && inner.north < outer.north;
}

/**
 * The largest whole-pixel size at this zoom, in this aspect, whose tile grid fits the budget.
 *
 * Scans down from the target in 1% steps rather than solving it: tile counts are step functions of
 * the centre's alignment within a tile, so the closed form would be wrong at some centres and this
 * is exact at every centre. Pure, deterministic, and bounded at 100 iterations.
 */
function fitToBudget(
  lat: number, lng: number, zoom: number, wantW: number, wantH: number, budget: number,
): { widthPx: number; heightPx: number; tiles: number; boundedByBudget: boolean } | null {
  for (let step = 0; step <= 99; step++) {
    const scale = 1 - step / 100;
    const w = Math.max(256, Math.round(wantW * scale));
    const h = Math.max(256, Math.round(wantH * scale));
    const tiles = nearmapTileGrid(lat, lng, zoom, w, h).tiles.length;
    if (tiles <= budget) {
      return { widthPx: w, heightPx: h, tiles, boundedByBudget: step > 0 };
    }
    if (w === 256 && h === 256) break;   // cannot get smaller than one tile
  }
  return null;
}

/**
 * Plan this project's imagery workzone: what to buy, where it lands, and what it costs.
 *
 * Pure. No key, no network, no database — so the cost of a workzone is provable without spending
 * anything, which is the only way a cost invariant can be regression-tested.
 *
 * @param only  plan just these roles. Used by the explicit "Expand imagery area" action, which
 *              buys a layer a project does not have yet and must not re-buy the ones it does.
 */
export function planWorkzone(
  lat: number, lng: number, only?: readonly WorkzoneLayerRole[],
): WorkzonePlan | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;

  const wanted = WORKZONE_TARGETS.filter(t => !only || only.includes(t.role));
  const layers: WorkzoneLayerPlan[] = [];
  let core: WorkzoneLayerPlan | null = null;

  for (const t of wanted) {
    const mpp = metresPerPixel(lat, t.zoom);
    if (!mpp) return null;
    const fit = fitToBudget(
      lat, lng, t.zoom,
      Math.round(t.targetWidthM / mpp), Math.round(t.targetHeightM / mpp),
      t.tileBudget,
    );
    if (!fit) continue;
    const bounds = nearmapImageBounds(lat, lng, t.zoom, fit.widthPx, fit.heightPx);
    const res = groundResolutionCmPerPx(lat, t.zoom);
    if (!bounds || res === null) continue;
    const plan: WorkzoneLayerPlan = {
      role: t.role, zoom: t.zoom,
      widthPx: fit.widthPx, heightPx: fit.heightPx,
      tiles: fit.tiles,
      bounds,
      groundWidthM: fit.widthPx * mpp,
      groundHeightM: fit.heightPx * mpp,
      resolutionCmPerPx: res,
      boundedByBudget: fit.boundedByBudget,
    };
    if (t.role === 'core') core = plan;
    layers.push(plan);
  }

  // A context ring that does not enclose the core is not a ring. Drop it; keep the design surface.
  const usable = layers.filter(l => l.role !== 'context' || !core || containedIn(core.bounds, l.bounds));
  if (usable.length === 0) return null;

  return {
    lat, lng,
    layers: usable,
    totalTiles: usable.reduce((n, l) => n + l.tiles, 0),
  };
}

/**
 * What a plan is about to spend, as one line for a log or a control.
 *
 * Ray asked for "bounded and predictable paid imagery usage". Predictable means SAID OUT LOUD
 * before the money is spent, in the units that are actually metered.
 */
export function describeWorkzoneCost(plan: WorkzonePlan | null): string {
  if (!plan) return 'no workzone can be planned for this location';
  const parts = plan.layers.map(l =>
    `${l.role} z${l.zoom} ${Math.round(l.groundWidthM)}x${Math.round(l.groundHeightM)}m `
    + `@${l.resolutionCmPerPx.toFixed(1)}cm/px = ${l.tiles} tiles`
    + (l.boundedByBudget ? ' (extent reduced to stay inside the tile budget)' : ''));
  return `${plan.totalTiles} paid tile GETs — ${parts.join('; ')}`;
}
