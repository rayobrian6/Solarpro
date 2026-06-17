/**
 * /api/solar-rgb — High-resolution aerial imagery from the Google Solar API
 * Data Layers (RGB layer, ~10 cm/px where covered).
 *
 * Free tier: 1,000 Data Layers calls / month. Returns a PNG plus its WGS84
 * lat/lng bounds so the Design Studio canvas can draw it georeferenced as a
 * high-res backdrop — sharp enough to see and tag roof vents/obstructions,
 * unlike the ~0.3 m ESRI / awful-rural Google base tiles.
 *
 * Covered (most suburban/urban) addresses only. Rural NO_COVERAGE returns 404
 * and the client keeps the base tiles.
 *
 * GET /api/solar-rgb?lat=&lng=  →  { imageDataUrl, bounds:{north,south,east,west}, pixelSizeMeters }
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const GOOGLE_SOLAR_API_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const PIXEL_SIZE = 0.1;   // 10 cm/px — vent-level detail
const RADIUS_M   = 50;    // covers a residential roof + yard

// ── UTM → WGS84 (mirrors /api/dsm) ──────────────────────────────────────────
function utmToLatLng(easting: number, northing: number, zone: number): { lat: number; lng: number } {
  const k0 = 0.9996, a = 6378137.0, e = 0.0818191908;
  const e2 = e*e, e4 = e2*e2, e6 = e2*e4;
  const x = easting - 500000.0, y = northing;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const M = y / k0;
  const mu = M / (a * (1 - e2/4 - 3*e4/64 - 5*e6/256));
  const e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
  const phi1 = mu + (3*e1/2 - 27*e1**3/32)*Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32)*Math.sin(4*mu)
    + (151*e1**3/96)*Math.sin(6*mu)
    + (1097*e1**4/512)*Math.sin(8*mu);
  const N1 = a / Math.sqrt(1 - e2*Math.sin(phi1)**2);
  const T1 = Math.tan(phi1)**2;
  const C1 = e2*Math.cos(phi1)**2 / (1-e2);
  const R1 = a*(1-e2) / (1-e2*Math.sin(phi1)**2)**1.5;
  const D = x / (N1*k0);
  const lat = phi1 - (N1*Math.tan(phi1)/R1) * (D**2/2
    - (5+3*T1+10*C1-4*C1**2-9*e2)*D**4/24
    + (61+90*T1+298*C1+45*T1**2-252*e2-3*C1**2)*D**6/720);
  const lon = lon0 + (D - (1+2*T1+C1)*D**3/6
    + (5-2*C1+28*T1-3*C1**2+8*e2+24*T1**2)*D**5/120) / Math.cos(phi1);
  return { lat: lat * 180/Math.PI, lng: lon * 180/Math.PI };
}
function utmZone(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

export async function GET(req: NextRequest) {
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  const rl = await checkRateLimit('geo', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  if (!lat || !lng) return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  if (!GOOGLE_SOLAR_API_KEY) return NextResponse.json({ error: 'Solar API key not configured' }, { status: 503 });

  try {
    // 1. Ask the Solar API for the imagery layers (RGB lives here).
    const dlUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${RADIUS_M}&view=IMAGERY_LAYERS&requiredQuality=HIGH&pixelSizeMeters=${PIXEL_SIZE}&key=${GOOGLE_SOLAR_API_KEY}`;
    const dlRes = await fetch(dlUrl);
    if (!dlRes.ok) {
      // 404 = no coverage for this address — client keeps base tiles.
      return NextResponse.json({ error: `dataLayers: ${dlRes.status}`, covered: false }, { status: dlRes.status === 404 ? 404 : 502 });
    }
    const dlData = await dlRes.json();
    if (dlData.error || !dlData.rgbUrl) {
      return NextResponse.json({ error: dlData.error?.message || 'No RGB layer', covered: false }, { status: 404 });
    }

    // 2. Download the RGB GeoTIFF (key appended server-side).
    const rgbUrl = `${dlData.rgbUrl}&key=${GOOGLE_SOLAR_API_KEY}`;
    const tiffRes = await fetch(rgbUrl);
    if (!tiffRes.ok) throw new Error(`RGB download: ${tiffRes.status}`);
    const arrayBuffer = await tiffRes.arrayBuffer();

    // 3. Decode the GeoTIFF → interleaved RGB pixels.
    const geotiff = await import('geotiff');
    const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters({ interleave: true }) as unknown as Uint8Array;

    // 4. Encode to PNG (sharp). RGB GeoTIFF = 3 channels, 8-bit.
    const sharp = (await import('sharp')).default;
    const pngBuf = await sharp(Buffer.from(rasters.buffer, rasters.byteOffset, rasters.byteLength), {
      raw: { width, height, channels: 3 },
    }).png().toBuffer();

    // 5. Geographic bounds: GeoTIFF bbox is in UTM; convert all 4 corners → WGS84 min/max.
    const [west, south, east, north] = image.getBoundingBox();   // UTM meters
    const zone = utmZone(lng);
    const corners = [
      utmToLatLng(west, south, zone), utmToLatLng(east, south, zone),
      utmToLatLng(east, north, zone), utmToLatLng(west, north, zone),
    ];
    const bounds = {
      north: Math.max(...corners.map(c => c.lat)),
      south: Math.min(...corners.map(c => c.lat)),
      east:  Math.max(...corners.map(c => c.lng)),
      west:  Math.min(...corners.map(c => c.lng)),
    };

    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${pngBuf.toString('base64')}`,
      bounds,
      pixelSizeMeters: PIXEL_SIZE,
      width,
      height,
      covered: true,
    }, { headers: { 'Cache-Control': 'private, max-age=86400' } });

  } catch (err: unknown) {
    console.error('[solar-rgb] error:', err);
    return NextResponse.json({ error: (err as Error).message, covered: false }, { status: 500 });
  }
}
