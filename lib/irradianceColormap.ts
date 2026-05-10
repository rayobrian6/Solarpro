/**
 * irradianceColormap.ts — GeoTIFF pixel data → RGBA canvas
 *
 * Converts a Float32Array of irradiance values (from the Google Solar API
 * annualFlux GeoTIFF) into a coloured, masked HTMLCanvasElement that Cesium
 * can use as a billboard / rectangle texture.
 *
 * Colormap (solar industry standard — matches Aurora Solar / Helios):
 *   Low  (0.00–0.40) → blue  (#3b82f6) to purple (#8b5cf6)
 *   Mid  (0.40–0.70) → purple to yellow (#facc15)
 *   High (0.70–1.00) → yellow to red    (#ef4444)
 */

/** Raw decoded layer data returned by decodeGeotiff() in lib/geotiffDecoder.ts */
export interface LayerData {
  /** Float32Array of per-pixel irradiance values (kWh/m²/yr) */
  flux: Float32Array;
  /** Uint8Array of per-pixel mask values (0 = off-roof, 255 = on-roof) */
  mask: Uint8Array | null;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Bounding box from the GeoTIFF / API response */
  bounds: { west: number; south: number; east: number; north: number };
  /** Min irradiance value across the flux tile */
  minVal: number;
  /** Max irradiance value across the flux tile */
  maxVal: number;
}

// ── Colormap stops: [normalised 0–1, R, G, B] ─────────────────────────────
const STOPS: [number, number, number, number][] = [
  [0.00,  30, 100, 255],  // blue
  [0.25,  80,  50, 220],  // blue-purple
  [0.45, 140,  30, 190],  // purple
  [0.60, 240, 180,  20],  // yellow
  [0.80, 255, 110,   0],  // orange
  [1.00, 220,  20,  20],  // red
];

function lerpColor(t: number): [number, number, number] {
  // clamp
  t = Math.max(0, Math.min(1, t));
  // find surrounding stops
  let lo = STOPS[0], hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (t >= STOPS[i][0] && t <= STOPS[i + 1][0]) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const f    = span < 1e-6 ? 0 : (t - lo[0]) / span;
  return [
    Math.round(lo[1] + f * (hi[1] - lo[1])),
    Math.round(lo[2] + f * (hi[2] - lo[2])),
    Math.round(lo[3] + f * (hi[3] - lo[3])),
  ];
}

/**
 * Render a LayerData into an HTMLCanvasElement with the solar colormap applied.
 * Off-roof pixels (mask = 0) are fully transparent.
 * The canvas is ready for use as a Cesium material image.
 */
export function renderIrradianceCanvas(layer: LayerData): HTMLCanvasElement {
  const { flux, mask, width, height, minVal, maxVal } = layer;

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const range = maxVal - minVal;

  for (let i = 0; i < width * height; i++) {
    const masked = mask ? mask[i] === 0 : false;
    if (masked) {
      data[i * 4 + 3] = 0; // fully transparent
      continue;
    }
    const t   = range > 0 ? (flux[i] - minVal) / range : 0.5;
    const [r, g, b] = lerpColor(t);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 210; // slight transparency so terrain shows through
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Generate a gradient legend canvas (horizontal, 256×20 px).
 * Useful for rendering a colourbar in the UI.
 */
export function renderLegendCanvas(width = 256, height = 16): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < width; x++) {
    const [r, g, b] = lerpColor(x / (width - 1));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, height);
  }
  return canvas;
}
