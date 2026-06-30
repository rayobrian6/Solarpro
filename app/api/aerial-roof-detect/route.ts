// ============================================================
// GET /api/aerial-roof-detect?lat=&lng=  (or ?address=)
// ============================================================
// Authenticated, rate-limited. Detects real roof planes from Nearmap AI aerial
// imagery and returns them in the canonical RoofPlane shape that Design Studio's
// 3D scene + CAD/permit rail consume. Coverage-gated (free check first) so the
// paid AI-Feature call only fires where Nearmap actually flies, and only on an
// explicit user action in Design Studio (never auto on load) so credits burn on
// intent. Fails safe → covered:false (caller falls back to manual/Solar API).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { geocodeAddress } from '@/lib/geocode';
import { nearmapConfigured, checkNearmapCoverage, fetchNearmapAIResult, type NearmapObstruction } from '@/lib/aerial/nearmap';
import { nearmapPlanesToRoofPlanes } from '@/lib/aerial/nearmapToRoofPlane';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;

  const rl = await checkRateLimit('solar-api', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests — slow down.' }, { status: 429 });
  }

  if (!nearmapConfigured()) {
    return NextResponse.json({ success: false, configured: false, covered: false, planes: [],
      error: 'Aerial detection is not configured for this environment.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const address = (searchParams.get('address') || '').trim();
  let lat = searchParams.get('lat') != null ? Number(searchParams.get('lat')) : NaN;
  let lng = searchParams.get('lng') != null ? Number(searchParams.get('lng')) : NaN;
  let resolvedAddress: string | null = null;

  try {
    if ((Number.isNaN(lat) || Number.isNaN(lng)) && address) {
      const geo = await geocodeAddress(address);
      if (!geo) return NextResponse.json({ success: false, error: `Could not geocode "${address}".` }, { status: 404 });
      lat = geo.lat; lng = geo.lng;
      resolvedAddress = (geo as { matchedAddress?: string; displayName?: string }).matchedAddress
        ?? (geo as { displayName?: string }).displayName ?? address;
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return NextResponse.json({ success: false, error: 'Provide an address, or lat + lng.' }, { status: 400 });
    }

    const coverage = await checkNearmapCoverage(lat, lng);
    if (!coverage?.covered || !coverage.hasAiFeatures) {
      return NextResponse.json({
        success: true, covered: false, coverage,
        resolved: { lat, lng, address: resolvedAddress }, planes: [],
        message: 'No Nearmap aerial coverage here — fall back to Solar API or draw the roof manually.',
      });
    }

    const { roofPlanes: raw, obstructions } = await fetchNearmapAIResult(lat, lng, { radiusM: 45, skipCoverageCheck: true });
    const planes = nearmapPlanesToRoofPlanes(raw, () => crypto.randomUUID());
    return NextResponse.json({
      success: true, covered: true, coverage,
      resolved: { lat, lng, address: resolvedAddress }, planes, obstructions,
    });
  } catch (err) {
    return NextResponse.json({ success: false, covered: false, planes: [],
      error: `Aerial detection failed: ${(err as Error).message}` }, { status: 500 });
  }
}
