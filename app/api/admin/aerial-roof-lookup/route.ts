// ============================================================
// GET /api/admin/aerial-roof-lookup?address=... (or ?lat=&lng=)
// Admin-only. Geocodes the address, checks Nearmap coverage, and (where covered)
// returns real roof planes from the Nearmap AI Feature API. Proves the aerial
// geometry pipeline end-to-end on screen. Each covered lookup costs Nearmap
// credits, so it is admin-gated + rate-limited.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { geocodeAddress } from '@/lib/geocode';
import {
  nearmapConfigured,
  checkNearmapCoverage,
} from '@/lib/aerial/nearmap';
import { getNearmapRoofPlanesCached } from '@/lib/aerial/nearmapCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests — slow down.' }, { status: 429 });
  }

  if (!nearmapConfigured()) {
    return NextResponse.json({
      success: false,
      error: 'Nearmap not configured. Set the NEARMAP_API_KEY environment variable (Vercel → Settings → Environment Variables) and redeploy.',
      configured: false,
    }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const address = (searchParams.get('address') || '').trim();
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');

  let lat: number | null = latRaw != null ? Number(latRaw) : null;
  let lng: number | null = lngRaw != null ? Number(lngRaw) : null;
  let resolvedAddress: string | null = null;

  try {
    if ((lat == null || Number.isNaN(lat) || lng == null || Number.isNaN(lng)) && address) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        return NextResponse.json({ success: false, error: `Could not geocode "${address}".` }, { status: 404 });
      }
      lat = geo.lat; lng = geo.lng;
      resolvedAddress = (geo as { matchedAddress?: string; displayName?: string }).matchedAddress
        ?? (geo as { displayName?: string }).displayName ?? address;
    }

    if (lat == null || Number.isNaN(lat) || lng == null || Number.isNaN(lng)) {
      return NextResponse.json({ success: false, error: 'Provide an address, or lat + lng.' }, { status: 400 });
    }

    const coverage = await checkNearmapCoverage(lat, lng);
    if (!coverage?.covered) {
      return NextResponse.json({
        success: true,
        covered: false,
        coverage,
        resolved: { lat, lng, address: resolvedAddress },
        planes: [],
        message: 'No Nearmap coverage at this location (common for deep-rural sites). Fall back to LIDAR / survey geometry.',
      });
    }

    // Durable DB cache (fail-closed) — never re-bills a property already fetched.
    const planes = await getNearmapRoofPlanesCached(lat, lng);
    return NextResponse.json({
      success: true,
      covered: true,
      coverage,
      resolved: { lat, lng, address: resolvedAddress },
      planes,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: `Lookup failed: ${(err as Error).message}` }, { status: 500 });
  }
}
