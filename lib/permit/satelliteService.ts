// ============================================================
// lib/permit/satelliteService.ts
// Standalone Google Maps satellite image service.
//
// Extracted from app/api/engineering/permit/route.ts so it can be
// called from syncProjectPipeline() during the load_project stage.
//
// Usage:
//   const result = await fetchSatelliteImage({ address, lat, lng });
//   if (!result.error) {
//     snapshot.satelliteImageBase64 = result.imageBase64;
//   }
// ============================================================

import type { SatelliteImageResult } from './types';

const GKEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

// Satellite image dimensions — matches what wkhtmltopdf renders at 380px height
const IMG_WIDTH  = 1200;
const IMG_HEIGHT = 800;

export interface FetchSatelliteOptions {
  address?: string;
  lat?: number;
  lng?: number;
  zoom?: number;    // default 20, fallback 18, 17
  width?: number;   // default 1200
  height?: number;  // default 800
}

/**
 * Fetch a Google Maps satellite image for the given address or coordinates.
 * Returns a base64-encoded JPEG data URI suitable for embedding in HTML.
 *
 * Multi-zoom fallback: tries zoom=20 → 18 → 17, rejects blank tiles (<8KB).
 */
export async function fetchSatelliteImage(
  opts: FetchSatelliteOptions
): Promise<SatelliteImageResult> {
  const { address = '', zoom: requestedZoom } = opts;
  const w = opts.width  ?? IMG_WIDTH;
  const h = opts.height ?? IMG_HEIGHT;

  try {
    // ── Step 1: Geocode if no lat/lng provided ──────────────────────────────
    let lat = opts.lat;
    let lng = opts.lng;

    if ((!lat || !lng) && address) {
      try {
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`;
        const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.results?.[0]?.geometry?.location) {
            lat = geoData.results[0].geometry.location.lat;
            lng = geoData.results[0].geometry.location.lng;
          }
        }
      } catch (geoErr: unknown) {
        console.warn('[satelliteService] Geocode failed:', (geoErr as Error)?.message);
      }
    }

    if (!lat || !lng) {
      return {
        imageBase64: '',
        imageUrl: '',
        lat: 0,
        lng: 0,
        zoom: 0,
        widthPx: w,
        heightPx: h,
        error: 'Could not geocode address — no lat/lng available',
      };
    }

    // ── Step 2: Try satellite image at multiple zoom levels ─────────────────
    const zoomLevels = requestedZoom
      ? [requestedZoom]
      : [20, 18, 17];

    const MIN_BYTES = 8000; // blank/gray tiles are <8KB

    for (const zoom of zoomLevels) {
      // Try satellite maptype first
      for (const maptype of ['satellite', 'hybrid'] as const) {
        const url =
          `https://maps.googleapis.com/maps/api/staticmap` +
          `?center=${lat},${lng}` +
          `&zoom=${zoom}` +
          `&size=${w}x${h}` +
          `&maptype=${maptype}` +
          `&key=${GKEY}`;

        try {
          const imgRes = await fetch(url, { signal: AbortSignal.timeout(12000) });
          if (!imgRes.ok) continue;

          const buf = await imgRes.arrayBuffer();
          const bytes = buf.byteLength;

          if (bytes < MIN_BYTES) {
            console.warn(`[satelliteService] Tile too small (${bytes}B) at zoom=${zoom} maptype=${maptype} — skipping`);
            continue;
          }

          const b64 = Buffer.from(buf).toString('base64');
          const mime = imgRes.headers.get('content-type') || 'image/jpeg';
          const dataUri = `data:${mime};base64,${b64}`;

          console.log(`[satelliteService] ✓ Got satellite image: zoom=${zoom} maptype=${maptype} size=${bytes}B`);
          return {
            imageBase64: dataUri,
            imageUrl: url,
            lat,
            lng,
            zoom,
            widthPx: w,
            heightPx: h,
          };
        } catch (fetchErr: unknown) {
          console.warn(`[satelliteService] Fetch failed at zoom=${zoom} maptype=${maptype}:`, (fetchErr as Error)?.message);
          continue;
        }
      }
    }

    return {
      imageBase64: '',
      imageUrl: '',
      lat,
      lng,
      zoom: 0,
      widthPx: w,
      heightPx: h,
      error: 'All zoom levels / maptypes failed',
    };

  } catch (err: unknown) {
    console.error('[satelliteService] Unexpected error:', (err as Error)?.message);
    return {
      imageBase64: '',
      imageUrl: '',
      lat: opts.lat ?? 0,
      lng: opts.lng ?? 0,
      zoom: 0,
      widthPx: w,
      heightPx: h,
      error: (err as Error)?.message ?? 'Unknown error',
    };
  }
}

/**
 * Quick check: does a project already have a valid satellite image cached?
 */
export function isSatelliteImageValid(base64?: string): boolean {
  if (!base64) return false;
  // Must be a data URI with meaningful content (>8KB base64 = ~6KB binary)
  return base64.startsWith('data:image/') && base64.length > 10000;
}