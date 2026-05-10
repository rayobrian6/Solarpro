/**
 * geotiffDecoder.ts — Fetch and decode Google Solar API GeoTIFF layers
 *
 * Uses the `geotiff` npm package (already in package.json) to parse the
 * binary GeoTIFF files returned by the Google Solar dataLayers endpoint.
 *
 * API flow:
 *   1. Call /api/solar?endpoint=dataLayers&lat=X&lng=Y&radiusMeters=50
 *   2. Response contains { annualFluxUrl, maskUrl, ... }
 *   3. Fetch each URL through /api/solar-tile?url=<encoded> (keeps API key server-side)
 *   4. Decode the GeoTIFF bytes into Float32Array / Uint8Array pixel grids
 *   5. Return LayerData for use by irradianceColormap.ts
 */

import type { LayerData } from './irradianceColormap';

/** Minimal subset of the Solar dataLayers API response we use */
export interface DataLayersResponse {
  imageryDate?:    { year: number; month: number; day: number };
  imageryQuality?: string;
  annualFluxUrl?:  string;
  maskUrl?:        string;
  dsmUrl?:         string;
  boundingBox?: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
}

/** Simple in-memory cache: lat/lng key → LayerData */
const _cache = new Map<string, LayerData>();

function cacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Fetch data layer metadata from our /api/solar proxy.
 * Returns null if the building is outside Google Solar coverage.
 */
export async function fetchDataLayers(
  lat: number,
  lng: number,
  radiusMeters = 50,
): Promise<DataLayersResponse | null> {
  const url =
    `/api/solar?endpoint=dataLayers&lat=${lat}&lng=${lng}` +
    `&radiusMeters=${radiusMeters}&quality=HIGH`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  // Solar API returns error body with `error` key when outside coverage
  if (json?.error) return null;
  return json as DataLayersResponse;
}

/**
 * Fetch a GeoTIFF from a Google Solar tile URL (via our server-side proxy
 * so the API key is never exposed to the browser).
 */
async function fetchTileBytes(tileUrl: string): Promise<ArrayBuffer> {
  const proxied = `/api/solar-tile?url=${encodeURIComponent(tileUrl)}`;
  const res = await fetch(proxied);
  if (!res.ok) throw new Error(`Tile fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Decode a GeoTIFF ArrayBuffer into a typed array of pixel values.
 * Returns null if geotiff is not available (SSR / test environments).
 */
async function decodeGeoTiffBuffer(
  buf: ArrayBuffer,
): Promise<{ data: Float32Array | Uint8Array; width: number; height: number }> {
  // Dynamic import keeps geotiff out of the server bundle for non-node pages
  const { fromArrayBuffer } = await import('geotiff');
  const tiff  = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  // interleave:false returns one TypedArray per band (band 0 = the data we want)
  const rasters = await image.readRasters({ interleave: false });
  const raw = rasters[0] as Float32Array | Uint8Array | Int16Array | Int32Array;
  const width  = image.getWidth();
  const height = image.getHeight();

  // Use BYTES_PER_ELEMENT to reliably detect type regardless of realm/wrapper.
  // Mask GeoTIFFs are 1 byte/px (Uint8); flux GeoTIFFs are 4 bytes/px (Float32).
  let data: Float32Array | Uint8Array;
  if ((raw as any).BYTES_PER_ELEMENT === 1) {
    // Uint8 — copy into a plain Uint8Array (avoids any geotiff wrapper issues)
    data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = (raw as any)[i];
  } else {
    // Float32 / Int16 / Int32 — normalise to Float32
    data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = (raw as any)[i];
  }
  return { data, width, height };
}

/**
 * Main entry point. Fetches + decodes the annualFlux and mask tiles for a
 * given lat/lng and returns a LayerData ready for irradianceColormap.
 *
 * Results are cached in memory — toggling the heatmap on/off is free.
 */
export async function loadIrradianceLayer(
  lat: number,
  lng: number,
): Promise<LayerData | null> {
  const key = cacheKey(lat, lng);
  if (_cache.has(key)) return _cache.get(key)!;

  // ── 1. Fetch layer metadata ──────────────────────────────────────────────
  const meta = await fetchDataLayers(lat, lng);
  if (!meta?.annualFluxUrl) return null;

  // ── 2. Bounding box ──────────────────────────────────────────────────────
  const bb = meta.boundingBox;
  const bounds = bb
    ? {
        west:  bb.sw.longitude,
        south: bb.sw.latitude,
        east:  bb.ne.longitude,
        north: bb.ne.latitude,
      }
    : { west: lng - 0.001, south: lat - 0.001, east: lng + 0.001, north: lat + 0.001 };

  // ── 3. Decode flux tile ──────────────────────────────────────────────────
  let fluxBuf: ArrayBuffer;
  try {
    fluxBuf = await fetchTileBytes(meta.annualFluxUrl);
  } catch {
    return null;
  }
  const fluxDecoded = await decodeGeoTiffBuffer(fluxBuf);
  const flux = fluxDecoded.data instanceof Uint8Array
    ? (() => { const f = new Float32Array(fluxDecoded.data.length); fluxDecoded.data.forEach((v, i) => { f[i] = v; }); return f; })()
    : fluxDecoded.data as Float32Array;

  // ── 4. Decode mask tile (optional) ─────────────────────────────────────
  let mask: Uint8Array | null = null;
  if (meta.maskUrl) {
    try {
      const maskBuf = await fetchTileBytes(meta.maskUrl);
      const maskDecoded = await decodeGeoTiffBuffer(maskBuf);
      // Use BYTES_PER_ELEMENT to reliably detect type (avoids instanceof realm issues)
      if (maskDecoded.data.BYTES_PER_ELEMENT === 1) {
        mask = maskDecoded.data as Uint8Array;
      } else {
        mask = new Uint8Array(maskDecoded.data.length);
        for (let i = 0; i < maskDecoded.data.length; i++) {
          mask[i] = (maskDecoded.data as Float32Array)[i] > 0 ? 255 : 0;
        }
      }
      let onRoof = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] > 0) onRoof++;
      console.log('[Irradiance] Mask: ' + maskDecoded.width + 'x' + maskDecoded.height + ', on-roof pixels: ' + onRoof + '/' + mask.length + ' (' + (onRoof/mask.length*100).toFixed(1) + '%)');
    } catch (e) {
      console.warn('[Irradiance] Mask decode failed (overlay will show full bbox):', (e as Error).message);
    }
  } else {
    console.warn('[Irradiance] No maskUrl in dataLayers response — overlay shows full bbox');
  }

  // ── 5. Compute min/max for normalisation ─────────────────────────────────
  let minVal = Infinity, maxVal = -Infinity;
  for (let i = 0; i < flux.length; i++) {
    const v = flux[i];
    // Ignore nodata values (Google uses 0 or negative for nodata in flux tiles)
    if (!mask || mask[i] > 0) {
      if (v > 0) { if (v < minVal) minVal = v; if (v > maxVal) maxVal = v; }
    }
  }
  if (!isFinite(minVal)) minVal = 0;
  if (!isFinite(maxVal)) maxVal = 2000;

  const layer: LayerData = {
    flux,
    mask,
    width:  fluxDecoded.width,
    height: fluxDecoded.height,
    bounds,
    minVal,
    maxVal,
  };

  _cache.set(key, layer);
  return layer;
}

/** Clear the cache (e.g. when user switches to a new address) */
export function clearIrradianceCache() {
  _cache.clear();
}

/**
 * Load the irradiance layer WITHOUT the roof mask applied.
 * Used for ground-mount and fence-mount overlays where we want to show
 * solar flux across an arbitrary area (not just roof pixels).
 * Returns the same cached LayerData but with mask set to null.
 */
export async function loadIrradianceLayerUnmasked(
  lat: number,
  lng: number,
): Promise<LayerData | null> {
  const layer = await loadIrradianceLayer(lat, lng);
  if (!layer) return null;
  // Return a copy with mask = null so renderIrradianceCanvas colours every pixel
  return { ...layer, mask: null };
}
