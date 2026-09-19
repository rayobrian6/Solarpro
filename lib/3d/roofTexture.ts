/**
 * lib/3d/roofTexture.ts
 *
 * Drape the real aerial image onto the 3D roof — the thing Aurora does that
 * makes their model look like the actual house instead of a coloured polygon.
 *
 * Ray: "Aurora, when they pull up their built 3D, it overlays the google image
 * on the roof."
 *
 * HOW IT WORKS
 * ------------
 * A traced roof face is the PLAN VIEW of that face, lifted along its slope
 * (lib/3d/footprintToRoofPlane.ts). So the patch of aerial imagery we want is
 * exactly the face's lat/lng bounding box, seen from above. We fetch the web-
 * mercator tiles covering that box, compose them into a canvas cropped to the
 * box, and hand it to Cesium as the polygon's material image.
 *
 * Cesium assigns polygon texture coordinates across the polygon's bounding
 * RECTANGLE in lat/lng, so a canvas covering exactly that rectangle lines up
 * with no custom st coordinates and no shader work.
 *
 * WHY ESRI AND NOT GOOGLE SOLAR
 * -----------------------------
 * /api/solar-rgb returns beautiful 10 cm imagery — and 404s on rural addresses,
 * which is precisely where this whole feature exists to work. ESRI World
 * Imagery needs no key, covers the globe, and is the same source the 2D canvas
 * already falls back to. Google tiles remain available through the existing
 * /api/maps-session proxy for anyone who has a key configured.
 *
 * MERCATOR vs GEODETIC: tiles are web mercator; Cesium maps st linearly in
 * geodetic lat/lng. Across a roof (tens of metres) the divergence is well under
 * a centimetre, so it is ignored deliberately rather than overlooked.
 */

const TILE_PX = 256;

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// ── Pure web-mercator math (no DOM, fully testable) ──────────────────────────

/** Fractional tile X for a longitude at zoom z. */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * Math.pow(2, z);
}

/** Fractional tile Y for a latitude at zoom z (web mercator). */
export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin(clamped * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
}

/** The inclusive integer tile range covering `bounds` at zoom z. */
export function tileRangeForBounds(bounds: LatLngBounds, z: number): {
  x0: number; x1: number; y0: number; y1: number;
} {
  const x0 = Math.floor(lngToTileX(bounds.west, z));
  const x1 = Math.floor(lngToTileX(bounds.east, z));
  // Y is inverted: north is the SMALLER tile index.
  const y0 = Math.floor(latToTileY(bounds.north, z));
  const y1 = Math.floor(latToTileY(bounds.south, z));
  return { x0, x1, y0, y1 };
}

/**
 * Choose the highest zoom that covers `bounds` without exceeding `maxTiles`
 * tiles, capped at `maxZoom`.
 *
 * Sharpness matters here — a blurry roof texture is the complaint this feature
 * exists to answer — but an unbounded zoom on a large building would fire off
 * hundreds of tile requests. 24 tiles covers a house at full detail.
 */
export function pickZoomForBounds(bounds: LatLngBounds, maxZoom = 19, maxTiles = 24): number {
  for (let z = maxZoom; z >= 1; z--) {
    const { x0, x1, y0, y1 } = tileRangeForBounds(bounds, z);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count <= maxTiles) return z;
  }
  return 1;
}

/** ESRI World Imagery tile URL. Note the {z}/{y}/{x} order — y before x. */
export function esriTileUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * Pixel rect, within the composed tile mosaic, that corresponds to `bounds`.
 * This is the crop that makes the canvas line up with Cesium's st mapping.
 */
export function cropRectForBounds(bounds: LatLngBounds, z: number): {
  sx: number; sy: number; sw: number; sh: number; mosaicW: number; mosaicH: number;
} {
  const { x0, x1, y0, y1 } = tileRangeForBounds(bounds, z);
  const mosaicW = (x1 - x0 + 1) * TILE_PX;
  const mosaicH = (y1 - y0 + 1) * TILE_PX;
  const sx = (lngToTileX(bounds.west, z) - x0) * TILE_PX;
  const sy = (latToTileY(bounds.north, z) - y0) * TILE_PX;
  const sw = (lngToTileX(bounds.east, z) - lngToTileX(bounds.west, z)) * TILE_PX;
  const sh = (latToTileY(bounds.south, z) - latToTileY(bounds.north, z)) * TILE_PX;
  return { sx, sy, sw, sh, mosaicW, mosaicH };
}

/** Bounding box of a lat/lng ring, padded outward by `padFrac` of its size. */
export function boundsOf(
  ring: ReadonlyArray<{ lat: number; lng: number }>,
  padFrac = 0.02,
): LatLngBounds | null {
  if (!ring || ring.length < 3) return null;
  let north = -Infinity, south = Infinity, east = -Infinity, west = Infinity;
  for (const v of ring) {
    if (!isFinite(v.lat) || !isFinite(v.lng)) return null;
    if (v.lat > north) north = v.lat;
    if (v.lat < south) south = v.lat;
    if (v.lng > east) east = v.lng;
    if (v.lng < west) west = v.lng;
  }
  const dLat = (north - south) * padFrac;
  const dLng = (east - west) * padFrac;
  // A degenerate box would make the crop zero-width and the texture undefined.
  if (!(north - south > 1e-9) || !(east - west > 1e-9)) return null;
  return { north: north + dLat, south: south - dLat, east: east + dLng, west: west - dLng };
}

// ── Browser-side compositing ─────────────────────────────────────────────────

const textureCache = new Map<string, HTMLCanvasElement>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // required or the canvas is tainted and unusable as a texture
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a missing tile leaves a gap, never rejects
    img.src = url;
  });
}

/**
 * Compose an aerial texture for one roof face.
 *
 * Returns null rather than throwing when the face is degenerate or every tile
 * fails — the caller then falls back to a flat colour, so a texture problem
 * degrades the look instead of breaking the scene.
 */
export async function composeRoofTexture(
  ring: ReadonlyArray<{ lat: number; lng: number }>,
  opts: { maxZoom?: number; tileUrl?: (z: number, x: number, y: number) => string } = {},
): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null;
  const bounds = boundsOf(ring);
  if (!bounds) return null;

  const z = pickZoomForBounds(bounds, opts.maxZoom ?? 19);
  const urlFor = opts.tileUrl ?? esriTileUrl;
  const key = `${z}|${bounds.north.toFixed(7)}|${bounds.south.toFixed(7)}|${bounds.east.toFixed(7)}|${bounds.west.toFixed(7)}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const { x0, x1, y0, y1 } = tileRangeForBounds(bounds, z);
  const { sx, sy, sw, sh, mosaicW, mosaicH } = cropRectForBounds(bounds, z);
  if (!(sw > 1) || !(sh > 1)) return null;

  const mosaic = document.createElement('canvas');
  mosaic.width = mosaicW;
  mosaic.height = mosaicH;
  const mctx = mosaic.getContext('2d');
  if (!mctx) return null;

  const jobs: Array<Promise<void>> = [];
  let loaded = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(loadImage(urlFor(z, x, y)).then(img => {
        if (!img) return;
        mctx.drawImage(img, (x - x0) * TILE_PX, (y - y0) * TILE_PX, TILE_PX, TILE_PX);
        loaded++;
      }));
    }
  }
  await Promise.all(jobs);
  if (loaded === 0) return null;

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, out.width, out.height);

  textureCache.set(key, out);
  return out;
}

/** Drop cached textures — call when the address changes. */
export function clearRoofTextureCache(): void {
  textureCache.clear();
}
