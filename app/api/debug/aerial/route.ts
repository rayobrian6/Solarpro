// ============================================================
// Debug endpoint: GET /api/debug/aerial?address=...
// Tests the full aerial data pipeline and returns JSON results
// for inspection without generating a full permit PDF.
// REMOVE OR RESTRICT IN PRODUCTION
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') || '123 Main St, Franklin, TN 37064';
  const latParam = req.nextUrl.searchParams.get('lat');
  const lngParam = req.nextUrl.searchParams.get('lng');
  const lat = latParam ? parseFloat(latParam) : undefined;
  const lng = lngParam ? parseFloat(lngParam) : undefined;

  const GKEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';
  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    env: {
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ? 'SET' : 'NOT SET (using hardcoded fallback)',
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET',
      runtime: typeof Buffer !== 'undefined' ? 'nodejs (Buffer available)' : 'edge (no Buffer)',
      AbortSignalTimeout: typeof AbortSignal?.timeout === 'function' ? 'available' : 'NOT AVAILABLE',
    },
    input: { address, lat, lng },
  };

  // ── Step 1: Geocode ──────────────────────────────────────────────────────
  let finalLat = lat;
  let finalLng = lng;
  const geocodeStart = Date.now();

  if ((!finalLat || !finalLng) && address) {
    try {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`;
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
      const geoData = await geoRes.json();
      results.geocode = {
        status_code: geoRes.status,
        api_status: geoData.status,
        error_message: geoData.error_message || null,
        results_count: geoData.results?.length ?? 0,
        first_formatted_address: geoData.results?.[0]?.formatted_address || null,
        lat: geoData.results?.[0]?.geometry?.location?.lat || null,
        lng: geoData.results?.[0]?.geometry?.location?.lng || null,
        duration_ms: Date.now() - geocodeStart,
      };
      if (geoData.results?.[0]?.geometry?.location) {
        finalLat = geoData.results[0].geometry.location.lat;
        finalLng = geoData.results[0].geometry.location.lng;
      }
    } catch(e: any) {
      results.geocode = { error: e.message, duration_ms: Date.now() - geocodeStart };
    }
  } else {
    results.geocode = { skipped: 'lat/lng already provided', lat: finalLat, lng: finalLng };
  }

  // ── Step 2: Google Solar API ─────────────────────────────────────────────
  const solarStart = Date.now();
  if (finalLat && finalLng) {
    try {
      const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${finalLat}&location.longitude=${finalLng}&requiredQuality=LOW&key=${GKEY}`;
      const solarRes = await fetch(solarUrl, { signal: AbortSignal.timeout(10000) });
      const solarData = await solarRes.json();
      const segs = solarData.solarPotential?.roofSegmentStats || [];
      results.solar_api = {
        status_code: solarRes.status,
        error: solarData.error || null,
        roof_segments_count: segs.length,
        max_array_panels: solarData.solarPotential?.maxArrayPanelsCount || null,
        max_array_area_m2: solarData.solarPotential?.maxArrayAreaMeters2 || null,
        building_stats: solarData.solarPotential?.wholeRoofStats || null,
        first_segment: segs[0] ? {
          pitchDegrees: segs[0].pitchDegrees,
          azimuthDegrees: segs[0].azimuthDegrees,
          areaM2: segs[0].stats?.areaMeters2,
          center: segs[0].center,
        } : null,
        duration_ms: Date.now() - solarStart,
      };
    } catch(e: any) {
      results.solar_api = { error: e.message, duration_ms: Date.now() - solarStart };
    }
  } else {
    results.solar_api = { skipped: 'no lat/lng available after geocode' };
  }

  // ── Step 3: Static Maps ──────────────────────────────────────────────────
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
    } catch(e: any) {
      results.satellite_image = { error: e.message, duration_ms: Date.now() - staticStart };
    }
  } else {
    results.satellite_image = { skipped: 'no lat/lng available' };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  results.summary = {
    geocode_ok: !!(results.geocode?.lat),
    solar_segments: results.solar_api?.roof_segments_count ?? 0,
    satellite_image_ok: !!(results.satellite_image?.is_image),
    satellite_bytes: results.satellite_image?.image_size_bytes ?? 0,
    base64_length: results.satellite_image?.base64_total_length ?? 0,
    aerial_would_render: !!(results.geocode?.lat || (lat && lng)) && !!(results.satellite_image?.is_image),
    total_ms: (results.geocode?.duration_ms || 0) + (results.solar_api?.duration_ms || 0) + (results.satellite_image?.duration_ms || 0),
  };

  return NextResponse.json(results, {
    headers: { 'Content-Type': 'application/json' },
  });
}
