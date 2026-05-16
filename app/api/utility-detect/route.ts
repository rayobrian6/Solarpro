export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { geocodeAddress } from '@/lib/locationEngine';
import { detectUtility } from '@/lib/utilityDetector';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// POST /api/utility-detect — detect utility from address or lat/lng
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const rl = await checkRateLimit('utility-detect', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const body = await req.json();
    const { address: addressRaw, lat, lng, stateCode: stateCodeRaw, city: cityRaw } = body;
    // Length caps — prevent oversized values being forwarded to third-party geocoding APIs
    const address   = typeof addressRaw   === 'string' ? addressRaw.slice(0, 500)   : addressRaw;
    const stateCode = typeof stateCodeRaw === 'string' ? stateCodeRaw.slice(0, 10)  : stateCodeRaw;
    const city      = typeof cityRaw      === 'string' ? cityRaw.slice(0, 100)      : cityRaw;

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
  // Length caps — prevent oversized values being forwarded to third-party geocoding APIs
  const address = (req.nextUrl.searchParams.get('address') || '').slice(0, 500);
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') || '0');
  const lng = parseFloat(req.nextUrl.searchParams.get('lng') || '0');
  const stateCode = (req.nextUrl.searchParams.get('state') || '').slice(0, 10);

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