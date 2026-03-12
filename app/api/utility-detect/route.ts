export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';

// POST /api/utility-detect — detect utility from address or lat/lng
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, lat, lng, stateCode, city } = body;

    let resolvedLat = lat;
    let resolvedLng = lng;
    let resolvedState = stateCode;
    let resolvedCity = city;

    // If no coordinates, geocode the address first
    if ((!resolvedLat || !resolvedLng) && address) {
      const geo = await geocodeAddress(address);
      if (!geo.success || !geo.location) {
        return NextResponse.json({ success: false, error: 'Could not geocode address' }, { status: 400 });
      }
      resolvedLat = geo.location.lat;
      resolvedLng = geo.location.lng;
      resolvedState = geo.location.stateCode;
      resolvedCity = geo.location.city;
    }

    if (!resolvedLat || !resolvedLng || !resolvedState) {
      return NextResponse.json({ success: false, error: 'lat/lng/state required' }, { status: 400 });
    }

    const result = await detectUtility(resolvedLat, resolvedLng, resolvedState, resolvedCity);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return handleRouteDbError('[app/api/utility-detect/route.ts]', err);
  }
}

// GET /api/utility-detect?address=...
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') || '';
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') || '0');
  const lng = parseFloat(req.nextUrl.searchParams.get('lng') || '0');
  const stateCode = req.nextUrl.searchParams.get('state') || '';

  if (!address && (!lat || !lng || !stateCode)) {
    return NextResponse.json({ success: false, error: 'address or lat/lng/state required' }, { status: 400 });
  }

  let resolvedLat = lat;
  let resolvedLng = lng;
  let resolvedState = stateCode;

  if (address && (!lat || !lng)) {
    const geo = await geocodeAddress(address);
    if (!geo.success || !geo.location) {
      return NextResponse.json({ success: false, error: 'Could not geocode address' }, { status: 400 });
    }
    resolvedLat = geo.location.lat;
    resolvedLng = geo.location.lng;
    resolvedState = geo.location.stateCode;
  }

  const result = await detectUtility(resolvedLat, resolvedLng, resolvedState);
  return NextResponse.json(result);
}