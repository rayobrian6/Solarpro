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
import { nearmapConfigured, checkNearmapCoverage, type NearmapObstruction } from '@/lib/aerial/nearmap';
import { getNearmapAIResultCached } from '@/lib/aerial/nearmapCache';
import { nearmapPlanesToRoofPlanes } from '@/lib/aerial/nearmapToRoofPlane';
import { cropToSubjectBuilding, cropObstructionsToPlanes } from '@/lib/aerial/subjectBuildingCrop';

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

    // Durable DB cache (fail-closed) — every Design Studio detect click on a
    // cold serverless instance used to bill a fresh AI Features call.
    const { roofPlanes: raw, obstructions: rawObs } = await getNearmapAIResultCached(lat, lng);

    // Crop the whole-block AI result down to just the subject building under the
    // detect point (map centre / geocode). Nearmap returns every roof in the
    // ~45m AOI; we keep only the facet cluster the user is designing on so
    // "Detect from aerial" doesn't grab the entire neighbourhood. `?crop=false`
    // disables it for debugging (returns the raw block).
    const doCrop = searchParams.get('crop') !== 'false';
    const crop = doCrop ? cropToSubjectBuilding(raw, { lat, lng }) : null;
    const croppedPlanes = crop ? crop.planes : raw;
    const obstructions = crop
      ? cropObstructionsToPlanes(rawObs, croppedPlanes, { lat, lng })
      : rawObs;

    const planes = nearmapPlanesToRoofPlanes(croppedPlanes, () => crypto.randomUUID());
    return NextResponse.json({
      success: true, covered: true, coverage,
      resolved: { lat, lng, address: resolvedAddress }, planes, obstructions,
      crop: crop
        ? { applied: crop.cropped, planesBefore: raw.length, planesKept: crop.planes.length,
            obstructionsBefore: rawObs.length, obstructionsKept: obstructions.length }
        : { applied: false, planesBefore: raw.length, planesKept: raw.length,
            obstructionsBefore: rawObs.length, obstructionsKept: rawObs.length },
    });
  } catch (err) {
    return NextResponse.json({ success: false, covered: false, planes: [],
      error: `Aerial detection failed: ${(err as Error).message}` }, { status: 500 });
  }
}
