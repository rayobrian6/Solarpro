import { NextRequest, NextResponse } from 'next/server';
import { calculateSystemSize } from '@/lib/autoSizing';
import { geocodeAddress } from '@/lib/locationEngine';
import { getUserFromRequest } from '@/lib/auth';

// POST /api/auto-size — calculate recommended system size from consumption data
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      annualKwh,
      monthlyKwh,
      address,
      lat,
      lng,
      stateCode,
      offsetPercent = 100,
      tilt = 20,
      azimuth = 180,
    } = body;

    // Resolve annual kWh
    const resolvedAnnualKwh = annualKwh || (monthlyKwh ? monthlyKwh * 12 : null);
    if (!resolvedAnnualKwh || resolvedAnnualKwh <= 0) {
      return NextResponse.json({
        success: false,
        error: 'annualKwh or monthlyKwh required',
      }, { status: 400 });
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

    const result = await calculateSystemSize({
      annualKwh: resolvedAnnualKwh,
      lat: resolvedLat,
      lng: resolvedLng,
      stateCode: resolvedState,
      offsetPercent,
      tilt,
      azimuth,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[auto-size]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}