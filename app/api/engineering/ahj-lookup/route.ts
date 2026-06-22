// ============================================================
// GET /api/engineering/ahj-lookup
// National AHJ lookup — search by state, city, county, address, or text
// Returns AHJ info including permit requirements, fees, NEC version,
// wind/snow loads, fire setbacks, and plan set requirements
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import {
  searchAhj,
  getAhjById,
  getAhjByAddress,
  getAhjsByState,
  getStatesSummary,
  getTotalAhjCount,
  type AhjRecord,
} from '@/lib/jurisdictions/ahj-national';
import { lookupAhjFromRegistry } from '@/lib/jurisdictions/ahjRegistry';
import { enrichWithSolarTrace } from '@/lib/jurisdictions/solartraceOverlay';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);

    const id        = searchParams.get('id');
    const stateCode = searchParams.get('state') || searchParams.get('stateCode');
    const city      = searchParams.get('city');
    const county    = searchParams.get('county');
    const address   = searchParams.get('address');
    const latRaw    = searchParams.get('lat');
    const lngRaw    = searchParams.get('lng');
    const lat       = latRaw != null ? Number(latRaw) : undefined;
    const lng       = lngRaw != null ? Number(lngRaw) : undefined;
    const text      = searchParams.get('q') || searchParams.get('text');
    const summary   = searchParams.get('summary') === 'true';

    // Return database summary
    if (summary) {
      return NextResponse.json({
        success: true,
        totalAhjs: getTotalAhjCount(),
        states: getStatesSummary(),
      });
    }

    // Lookup by ID
    if (id) {
      const ahj = getAhjById(id);
      if (!ahj) {
        return NextResponse.json({ success: false, error: `AHJ not found: ${id}` }, { status: 404 });
      }
      return NextResponse.json({ success: true, ahj: enrichWithSolarTrace(ahj), count: 1 });
    }

    // Lookup by address or lat/lng (most common use case).
    // Try the live SunSpec/Orange Button AHJ Registry first (real, maintained data);
    // it returns null when no token is configured or on any error, so we fall back
    // to the static curated + code-logic database.
    if (address || (lat != null && !Number.isNaN(lat) && lng != null && !Number.isNaN(lng))) {
      const live = await lookupAhjFromRegistry({
        address: address || undefined,
        lat: Number.isNaN(lat as number) ? undefined : lat,
        lng: Number.isNaN(lng as number) ? undefined : lng,
        stateCode: stateCode || undefined,
      });
      if (live) {
        return NextResponse.json({ success: true, ahj: enrichWithSolarTrace(live), count: 1, source: 'registry_live' });
      }
      if (address) {
        const ahj = getAhjByAddress(address);
        if (ahj) {
          return NextResponse.json({ success: true, ahj: enrichWithSolarTrace(ahj), count: 1, source: 'address' });
        }
      }
      // Fall through to state-level search
    }

    // Search by state/city/county/text
    if (stateCode || city || county || text) {
      const results = searchAhj({ stateCode: stateCode || undefined, city: city || undefined, county: county || undefined, text: text || undefined }).map(enrichWithSolarTrace);
      return NextResponse.json({
        success: true,
        ahjs: results,
        count: results.length,
        // Return first result as primary AHJ
        ahj: results[0] || null,
      });
    }

    // Return all AHJs for a state
    if (stateCode) {
      const results = getAhjsByState(stateCode).map(enrichWithSolarTrace);
      return NextResponse.json({
        success: true,
        ahjs: results,
        count: results.length,
        ahj: results[0] || null,
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Provide one of: id, address, state, city, county, or q (text search)',
    }, { status: 400 });

  } catch (err: unknown) {
    return handleRouteDbError('[ahj-l', err);
  }
}