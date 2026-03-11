// ============================================================
// GET /api/engineering/ahj-lookup
// National AHJ lookup — search by state, city, county, address, or text
// Returns AHJ info including permit requirements, fees, NEC version,
// wind/snow loads, fire setbacks, and plan set requirements
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  searchAhj,
  getAhjById,
  getAhjByAddress,
  getAhjsByState,
  getStatesSummary,
  getTotalAhjCount,
  type AhjRecord,
} from '@/lib/jurisdictions/ahj-national';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const id        = searchParams.get('id');
    const stateCode = searchParams.get('state') || searchParams.get('stateCode');
    const city      = searchParams.get('city');
    const county    = searchParams.get('county');
    const address   = searchParams.get('address');
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
      return NextResponse.json({ success: true, ahj, count: 1 });
    }

    // Lookup by address (most common use case)
    if (address) {
      const ahj = getAhjByAddress(address);
      if (ahj) {
        return NextResponse.json({ success: true, ahj, count: 1, source: 'address' });
      }
      // Fall through to state-level search
    }

    // Search by state/city/county/text
    if (stateCode || city || county || text) {
      const results = searchAhj({ stateCode: stateCode || undefined, city: city || undefined, county: county || undefined, text: text || undefined });
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
      const results = getAhjsByState(stateCode);
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

  } catch (err: any) {
    console.error('[ahj-lookup] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}