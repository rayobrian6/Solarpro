// ============================================================
// Debug endpoint: GET /api/debug/aerial?address=...
// Tests the full aerial data pipeline and returns JSON results
// for inspection without generating a full permit PDF.
// RESTRICTED: requires authenticated session (non-production debug only)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Require authenticated session — this is a diagnostic route, not public
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const address = req.nextUrl.searchParams.get('address') || '123 Main St, Franklin, TN 37064';
  const latParam = req.nextUrl.searchParams.get('lat');
  const lngParam = req.nextUrl.searchParams.get('lng');
  const lat = latParam ? parseFloat(latParam) : undefined;
  const lng = lngParam ? parseFloat(lngParam) : undefined;

  // Use environment variable only — no hardcoded fallback
  const GKEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GKEY) {
    return NextResponse.json({
      success: false,
      error: 'GOOGLE_MAPS_API_KEY is not configured in environment variables',
    }, { status: 503 });
  }

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    env: {
      GOOGLE_MAPS_API_KEY: 'SET',
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET',
      runtime: typeof Buffer !== 'undefined' ? 'nodejs (Buffer available)' : 'edge (no Buffer)',
      AbortSignalTimeout: typeof AbortSignal?.timeout === 'function' ? 'available' : 'NOT AVAILABLE',
    },
    input: { address, lat, lng },
  };

  // ── Step 1: Geocode ──────────────────────────────────────────────────────────
  let finalLat = lat;
  let finalLng = lng;
  const geocodeStart = Date.now();

  if ((!finalLat || !finalLng) && address) {
    try {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`;
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
      const geoData = await geoRes.json() as Record<string, unknown>;
      const geoResults = geoData.results as Array<Record<string, unknown>> | undefined;
      const firstResult = geoResults?.[0] as Record<string, unknown> | undefined;
      const geometry = firstResult?.geometry as Record<string, unknown> | undefined;
      const location = geometry?.location as { lat?: number; lng?: number } | undefined;
      results.geocode = {
        status_code: geoRes.status,
        api_status: geoData.status,
        error_message: geoData.error_message || null,
        results_count: geoResults?.length ?? 0,
        first_formatted_address: (firstResult?.formatted_address as string) || null,
        lat: location?.lat || null,
        lng: location?.lng || null,
        duration_ms: Date.now() - geocodeStart,
      };
      if (location?.lat && location?.lng) {
        finalLat = location.lat;
        finalLng = location.lng;
      }
    } catch(e: unknown) {
      results.geocode = { error: e instanceof Error ? e.message : String(e), duration_ms: Date.now() - geocodeStart };
    }
  } else {
    results.geocode = { skipped: 'lat/lng already provided', lat: finalLat, lng: finalLng };
  }

  // ── Step 2: Google Solar API ─────────────────────────────────────────────────
  const solarStart = Date.now();
  if (finalLat && finalLng) {
    try {
      const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${finalLat}&location.longitude=${finalLng}&requiredQuality=LOW&key=${GKEY}`;
      const solarRes = await fetch(solarUrl, { signal: AbortSignal.timeout(10000) });
      const solarData = await solarRes.json() as Record<string, unknown>;
      const solarPotential = solarData.solarPotential as Record<string, unknown> | undefined;
      const segs = (solarPotential?.roofSegmentStats as unknown[]) || [];
      const firstSeg = segs[0] as Record<string, unknown> | undefined;
      const firstSegStats = firstSeg?.stats as Record<string, unknown> | undefined;
      results.solar_api = {
        status_code: solarRes.status,
        error: (solarData.error as string) || null,
        roof_segments_count: segs.length,
        max_array_panels: solarPotential?.maxArrayPanelsCount || null,
        max_array_area_m2: solarPotential?.maxArrayAreaMeters2 || null,
        building_stats: solarPotential?.wholeRoofStats || null,
        first_segment: firstSeg ? {
          pitchDegrees: firstSeg.pitchDegrees,
          azimuthDegrees: firstSeg.azimuthDegrees,
          areaM2: firstSegStats?.areaMeters2,
          center: firstSeg.center,
        } : null,
        duration_ms: Date.now() - solarStart,
      };
    } catch(e: unknown) {
      results.solar_api = { error: e instanceof Error ? e.message : String(e), duration_ms: Date.now() - solarStart };
    }
  } else {
    results.solar_api = { skipped: 'no lat/lng available after geocode' };
  }

  // ── Step 3: Static Maps ──────────────────────────────────────────────────────
  const staticStart = Date.now();
  if (finalLat && finalLng) {
    try {
      const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${finalLat},${finalLng}&zoom=20&size=640x640&maptype=satellite&scale=2&key=${GKEY}`;
      const imgRes = await fetch(staticUrl, { signal: AbortSignal.timeout(12000) });
      const ct = imgRes.headers.get('content-type') || '';
      const isImage = ct.startsWith('image/');
      let imageSizeBytes = 0;
      let base64Length = 0;
      let base64Preview = '';
      let errorBody = '';

      if (isImage) {
        const buf = await imgRes.arrayBuffer();
        imageSizeBytes = buf.byteLength;
        const b64 = Buffer.from(buf).toString('base64');
        base64Length = b64.length + 22; // data:image/png;base64, prefix
        base64Preview = 'data:' + ct + ';base64,' + b64.substring(0, 30) + '...';
      } else {
        errorBody = await imgRes.text().catch(() => '');
      }

      results.satellite_image = {
        status_code: imgRes.status,
        content_type: ct,
        is_image: isImage,
        image_size_bytes: imageSizeBytes,
        base64_total_length: base64Length,
        base64_preview: base64Preview,
        error_body: errorBody ? errorBody.substring(0, 300) : null,
        duration_ms: Date.now() - staticStart,
      };
    } catch(e: unknown) {
      results.satellite_image = { error: e instanceof Error ? e.message : String(e), duration_ms: Date.now() - staticStart };
    }
  } else {
    results.satellite_image = { skipped: 'no lat/lng available' };
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const geocodeResult = results.geocode as Record<string, unknown> | undefined;
  const solarResult = results.solar_api as Record<string, unknown> | undefined;
  const satelliteResult = results.satellite_image as Record<string, unknown> | undefined;
  results.summary = {
    geocode_ok: !!(geocodeResult?.lat),
    solar_segments: (solarResult?.roof_segments_count as number) ?? 0,
    satellite_image_ok: !!(satelliteResult?.is_image),
    satellite_bytes: (satelliteResult?.image_size_bytes as number) ?? 0,
    base64_length: (satelliteResult?.base64_total_length as number) ?? 0,
    aerial_would_render: !!(geocodeResult?.lat || (lat && lng)) && !!(satelliteResult?.is_image),
    total_ms: ((geocodeResult?.duration_ms as number) || 0)
      + ((solarResult?.duration_ms as number) || 0)
      + ((satelliteResult?.duration_ms as number) || 0),
  };

  return NextResponse.json(results, {
    headers: { 'Content-Type': 'application/json' },
  });
}