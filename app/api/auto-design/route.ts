import { NextRequest, NextResponse } from 'next/server';
import { generateAutoDesign } from '@/lib/autoDesign';
import { geocodeAddress } from '@/lib/locationEngine';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

// POST /api/auto-design — generate initial solar layout from system size + location
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      systemKw,
      address,
      lat,
      lng,
      stateCode,
      roofType = 'gable',
      roofPitch,
      roofAzimuth,
      roofAreaSqFt,
      panelWatts = 430,
      offsetPercent = 100,
    } = body;

    if (!systemKw || systemKw <= 0) {
      return NextResponse.json({ success: false, error: 'systemKw required' }, { status: 400 });
    }

    // Resolve coordinates
    let resolvedLat = lat;
    let resolvedLng = lng;
    let resolvedState = stateCode;

    if ((!resolvedLat || !resolvedLng) && address) {
      const geo = await geocodeAddress(address);
      if (geo.success && geo.location) {
        resolvedLat = geo.location.lat;
        resolvedLng = geo.location.lng;
        resolvedState = geo.location.stateCode;
      }
    }

    if (!resolvedLat || !resolvedLng || !resolvedState) {
      return NextResponse.json({
        success: false,
        error: 'Location required: provide address or lat/lng/stateCode',
      }, { status: 400 });
    }

    const result = await generateAutoDesign({
      systemKw,
      lat: resolvedLat,
      lng: resolvedLng,
      stateCode: resolvedState,
      roofType,
      roofPitch,
      roofAzimuth,
      roofAreaSqFt,
      panelWatts,
      optimizeTilt: true,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    return handleRouteDbError('[a', err);
  }
}