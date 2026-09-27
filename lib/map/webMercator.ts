// ═══════════════════════════════════════════════════════════════════════════
// WEB MERCATOR — ONE PROJECTION, SHARED BY THE SERVER AND THE BROWSER.
//
// 🚨 WHY THIS FILE EXISTS. This arithmetic was inside `lib/aerial/nearmap.ts`, which is marked
// SERVER-ONLY at the top of the file and builds `Buffer`s. The 3D studio needs the SAME maths in
// the browser — to place an already-fetched tile on the ground under the geometry — and the only
// two ways to get it there are to import a server module into a client bundle or to write the
// projection out a second time. The second is how a codebase ends up with an imagery layer that
// disagrees with the imagery fetcher about where a photo is, which would put a reference photo
// metres from the house drawn on it.
//
// So the projection moved here and `lib/aerial/nearmap.ts` re-exports it. There is still exactly
// one implementation, and tests/nearmapImageBounds.test.ts still proves it through its original
// import path.
//
// Standard XYZ / EPSG:3857 with 256 px tiles: Google, ESRI, OSM and Nearmap Vert all share it,
// which is what makes a Nearmap tile and a Google tile interchangeable at the same z/x/y.
// ═══════════════════════════════════════════════════════════════════════════

export const TILE_SIZE = 256;

/** Global pixel X of a longitude at zoom z (0 … 256·2^z). */
export function lngToGlobalPx(lng: number, z: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** z;
}

/** Global pixel Y of a latitude at zoom z. */
export function latToGlobalPx(lat: number, z: number): number {
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_SIZE * 2 ** z;
}

/** Longitude of a global pixel X at zoom z — the inverse of {@link lngToGlobalPx}. */
export function globalPxToLng(px: number, z: number): number {
  return (px / (TILE_SIZE * 2 ** z)) * 360 - 180;
}

/** Latitude of a global pixel Y at zoom z — the inverse of {@link latToGlobalPx}. */
export function globalPxToLat(py: number, z: number): number {
  const y = 0.5 - py / (TILE_SIZE * 2 ** z);
  return (Math.atan(Math.sinh(y * 2 * Math.PI)) * 180) / Math.PI;
}

/** A geographic rectangle, in degrees. */
export interface ImageBounds { north: number; south: number; east: number; west: number; }

/**
 * THE GROUND RECTANGLE A STITCHED AERIAL COVERS.
 *
 * 🚨 WHY THIS EXISTS. An already-acquired Nearmap orthophoto is stored per project (the permit
 * route writes the whole permit input to `project_files` as `permit_input.json`, and its
 * `aerialData` carries the stitched JPEG plus the centre lat/lng, the zoom and the pixel size).
 * That image is PAID FOR and, until recently, read back by nothing. To show it as a georeferenced
 * reference layer in the 3D studio it needs a rectangle, and the rectangle is recoverable from
 * exactly those four numbers — the image is W x H pixels centred on (lat, lng) at zoom z, which
 * is the same construction `nearmapTileGrid` crops to.
 *
 * So the reference layer costs nothing: no tile request, no credit, no second acquisition path.
 *
 * Pure, and tested in tests/nearmapImageBounds.test.ts — a wrong rectangle would put the imagery
 * metres away from the geometry drawn on top of it, which is worse than showing no imagery.
 */
export function nearmapImageBounds(
  lat: number, lng: number, z: number, widthPx: number, heightPx: number,
): ImageBounds | null {
  if (![lat, lng, z, widthPx, heightPx].every(n => Number.isFinite(n))) return null;
  if (!(widthPx > 0) || !(heightPx > 0) || z < 0 || z > 24) return null;
  if (Math.abs(lat) > 85) return null;
  const cx = lngToGlobalPx(lng, z), cy = latToGlobalPx(lat, z);
  return {
    west:  globalPxToLng(cx - widthPx / 2, z),
    east:  globalPxToLng(cx + widthPx / 2, z),
    north: globalPxToLat(cy - heightPx / 2, z),   // smaller pixel Y is further north
    south: globalPxToLat(cy + heightPx / 2, z),
  };
}

/**
 * The rectangle a WHOLE-TILE range covers, exactly.
 *
 * Tile edges are exact in this projection — no crop offset, no rounding — so a composite built
 * out of complete tiles can state its own bounds without any of the quantisation the centred
 * crop above has to live with.
 */
export function tileRangeBounds(
  z: number, tx0: number, ty0: number, txCount: number, tyCount: number,
): ImageBounds | null {
  if (![z, tx0, ty0, txCount, tyCount].every(n => Number.isFinite(n))) return null;
  if (!(txCount > 0) || !(tyCount > 0) || z < 0 || z > 24) return null;
  return {
    west:  globalPxToLng(tx0 * TILE_SIZE, z),
    east:  globalPxToLng((tx0 + txCount) * TILE_SIZE, z),
    north: globalPxToLat(ty0 * TILE_SIZE, z),
    south: globalPxToLat((ty0 + tyCount) * TILE_SIZE, z),
  };
}

export interface TilePlacement { z: number; x: number; y: number; left: number; top: number; }
export interface TileGrid {
  tiles: TilePlacement[];       // tile coords + composite offset within the full tile canvas
  tx0: number; ty0: number;     // top-left tile index of the canvas
  canvasW: number; canvasH: number;
  cropLeft: number; cropTop: number;   // where to extract the centred WxH image
  W: number; H: number;
}

/**
 * Tiles needed to render a W×H image centred on (lat,lng) at zoom z, plus the crop offset into the
 * whole-tile canvas. Pure — no I/O.
 *
 * 🚨 THIS FUNCTION IS ALSO THE COST MODEL, WHICH IS WHY IT LIVES HERE AND NOT IN THE SERVER-ONLY
 * FETCHER. `tiles.length` is exactly the number of paid GETs an acquisition will make — one
 * `api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg` request per entry, and nothing else in the
 * Nearmap imagery path is metered. `lib/aerial/workzonePlan.ts` therefore prices a workzone by
 * calling this, and `lib/aerial/nearmap.ts` re-exports it so every existing importer is unchanged.
 * One implementation: the thing that PLANS the spend and the thing that SPENDS cannot disagree.
 */
export function nearmapTileGrid(lat: number, lng: number, z: number, W: number, H: number): TileGrid {
  const cx = lngToGlobalPx(lng, z), cy = latToGlobalPx(lat, z);
  const left = cx - W / 2, top = cy - H / 2;
  const tx0 = Math.floor(left / TILE_SIZE), ty0 = Math.floor(top / TILE_SIZE);
  const tx1 = Math.floor((left + W - 1) / TILE_SIZE), ty1 = Math.floor((top + H - 1) / TILE_SIZE);
  const tiles: TilePlacement[] = [];
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      tiles.push({ z, x, y, left: (x - tx0) * TILE_SIZE, top: (y - ty0) * TILE_SIZE });
    }
  }
  return {
    tiles, tx0, ty0,
    canvasW: (tx1 - tx0 + 1) * TILE_SIZE, canvasH: (ty1 - ty0 + 1) * TILE_SIZE,
    cropLeft: Math.round(left - tx0 * TILE_SIZE), cropTop: Math.round(top - ty0 * TILE_SIZE),
    W, H,
  };
}

/** Metres of ground per image pixel at a latitude and zoom. The basis of every extent below. */
export function metresPerPixel(lat: number, z: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(z) || Math.abs(lat) > 85) return null;
  const m = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  return m > 0 ? m : null;
}

/**
 * Ground resolution of an image, centimetres per pixel, at its own centre latitude.
 *
 * 🚨 COMPUTED, NEVER ASSERTED FROM A BRAND. The plan set prints "Nearmap HD aerial · 7.5 cm/px
 * orthophoto" as a fixed string, and the ruling on that is explicit: "do not print a hard-coded
 * 7.5 cm/px Nearmap claim unless that resolution is actually known for the selected imagery."
 * This is derivable from the zoom and the latitude, so it can be stated truthfully.
 */
export function groundResolutionCmPerPx(lat: number, z: number): number | null {
  const m = metresPerPixel(lat, z);
  return m === null ? null : m * 100;
}
