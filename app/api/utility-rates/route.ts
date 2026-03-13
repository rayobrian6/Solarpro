// ============================================================
// GET /api/utility-rates?address=...&zip=...&lat=...&lon=...
// NREL Utility Rate Database (URDB) proxy
// Docs: https://openei.org/services/doc/rest/util_rates
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NREL_API_KEY = process.env.NREL_API_KEY || 'DEMO_KEY';
const URDB_URL = 'https://api.openei.org/utility_rates';

export interface UtilityRateResult {
  utilityName: string;
  rateName: string;
  rateId: string;
  sector: string;           // 'Residential' | 'Commercial' | 'Industrial'
  flatRate: number;         // $/kWh flat rate (best estimate)
  avgMonthlyFixed: number;  // Fixed monthly charge ($)
  hasTOU: boolean;
  hasTiered: boolean;
  hasDemandCharge: boolean;
  touPeakRate?: number;
  touOffPeakRate?: number;
  tier1Rate?: number;
  tier2Rate?: number;
  tier1Limit?: number;      // kWh threshold for tier 1
  demandCharge?: number;    // $/kW demand charge
  source: 'urdb' | 'fallback';
  state?: string;
  zip?: string;
}

// State-level fallback rates (EIA 2024 averages)
const STATE_FALLBACK_RATES: Record<string, number> = {
  AL: 0.127, AK: 0.224, AZ: 0.128, AR: 0.110, CA: 0.271,
  CO: 0.136, CT: 0.248, DE: 0.131, FL: 0.133, GA: 0.126,
  HI: 0.386, ID: 0.104, IL: 0.138, IN: 0.131, IA: 0.118,
  KS: 0.127, KY: 0.115, LA: 0.107, ME: 0.198, MD: 0.148,
  MA: 0.248, MI: 0.175, MN: 0.138, MS: 0.118, MO: 0.119,
  MT: 0.115, NE: 0.115, NV: 0.118, NH: 0.228, NJ: 0.178,
  NM: 0.128, NY: 0.218, NC: 0.124, ND: 0.108, OH: 0.138,
  OK: 0.108, OR: 0.118, PA: 0.148, RI: 0.238, SC: 0.128,
  SD: 0.118, TN: 0.118, TX: 0.128, UT: 0.108, VT: 0.198,
  VA: 0.128, WA: 0.108, WV: 0.118, WI: 0.148, WY: 0.108,
  DC: 0.158,
};

function extractFlatRate(rateData: any): number {
  // Try energyratestructure first
  try {
    const structure = rateData.energyratestructure;
    if (Array.isArray(structure) && structure.length > 0) {
      const firstPeriod = structure[0];
      if (Array.isArray(firstPeriod) && firstPeriod.length > 0) {
        const rate = firstPeriod[0]?.rate;
        if (typeof rate === 'number' && rate > 0) return rate;
      }
    }
  } catch {}

  // Try flatdemandstructure
  try {
    const flat = rateData.flatdemandstructure;
    if (Array.isArray(flat) && flat.length > 0) {
      const r = flat[0]?.[0]?.rate;
      if (typeof r === 'number' && r > 0) return r;
    }
  } catch {}

  return 0;
}

function extractTieredRates(rateData: any): { tier1Rate?: number; tier2Rate?: number; tier1Limit?: number } {
  try {
    const structure = rateData.energyratestructure;
    if (Array.isArray(structure) && structure.length > 0) {
      const period = structure[0];
      if (Array.isArray(period) && period.length >= 2) {
        return {
          tier1Rate: period[0]?.rate,
          tier2Rate: period[1]?.rate,
          tier1Limit: period[0]?.max,
        };
      }
    }
  } catch {}
  return {};
}

function extractTOURates(rateData: any): { touPeakRate?: number; touOffPeakRate?: number } {
  try {
    const structure = rateData.energyratestructure;
    if (Array.isArray(structure) && structure.length >= 2) {
      const rates = structure.map((p: any) => Array.isArray(p) ? p[0]?.rate : null).filter(Boolean);
      if (rates.length >= 2) {
        return {
          touPeakRate: Math.max(...rates),
          touOffPeakRate: Math.min(...rates),
        };
      }
    }
  } catch {}
  return {};
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get('address') || '';
  const zip = searchParams.get('zip') || '';
  const lat = searchParams.get('lat') || '';
  const lon = searchParams.get('lon') || '';
  const sector = searchParams.get('sector') || 'Residential';

  // Build URDB query
  const params = new URLSearchParams({
    version: '7',
    format: 'json',
    api_key: NREL_API_KEY,
    sector,
    limit: '5',
    detail: 'full',
  });

  if (lat && lon) {
    params.set('lat', lat);
    params.set('lon', lon);
  } else if (zip) {
    params.set('zip', zip);
  } else if (address) {
    // Extract zip from address if possible
    const zipMatch = address.match(/\b(\d{5})\b/);
    if (zipMatch) params.set('zip', zipMatch[1]);
    else params.set('address', address);
  }

  try {
    const urdbRes = await fetch(`${URDB_URL}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!urdbRes.ok) throw new Error(`URDB returned ${urdbRes.status}`);

    const urdbData = await urdbRes.json();
    const items: any[] = urdbData?.items || [];

    if (items.length === 0) {
      // Fallback to state average
      return buildFallbackResponse(address, zip, lat, lon);
    }

    // Find best residential rate (prefer "Residential" sector, avoid "Commercial")
    const residential = items.filter(r =>
      r.sector?.toLowerCase().includes('residential') ||
      r.name?.toLowerCase().includes('residential')
    );
    const best = residential.length > 0 ? residential[0] : items[0];

    const flatRate = extractFlatRate(best);
    const tiered = extractTieredRates(best);
    const tou = extractTOURates(best);
    const hasTOU = Array.isArray(best.energyratestructure) && best.energyratestructure.length > 1;
    const hasTiered = !!(tiered.tier1Rate && tiered.tier2Rate);
    const hasDemandCharge = !!(best.flatdemandstructure || best.demandratestructure);

    // Fixed monthly charge
    const fixedMonthly = best.fixedmonthlycharge || best.minmonthlycharge || 0;

    // Best rate estimate
    const bestRate = flatRate > 0 ? flatRate :
      (tiered.tier1Rate || tou.touOffPeakRate || 0.13);

    const result: UtilityRateResult = {
      utilityName: best.utility || best.utilityname || 'Unknown Utility',
      rateName: best.name || 'Standard Residential',
      rateId: best.label || best.eiaid || '',
      sector: best.sector || sector,
      flatRate: Math.round(bestRate * 1000) / 1000,
      avgMonthlyFixed: Math.round(fixedMonthly * 100) / 100,
      hasTOU,
      hasTiered,
      hasDemandCharge,
      ...(hasTOU ? tou : {}),
      ...(hasTiered ? tiered : {}),
      ...(hasDemandCharge && best.flatdemandstructure?.[0]?.[0]?.rate
        ? { demandCharge: best.flatdemandstructure[0][0].rate }
        : {}),
      source: 'urdb',
      zip: zip || '',
    };

    // Also return all available rates for UI selection
    const allRates = items.slice(0, 5).map(r => ({
      rateId: r.label || r.eiaid || '',
      rateName: r.name || 'Unknown',
      utilityName: r.utility || r.utilityname || '',
      sector: r.sector || '',
      flatRate: Math.round((extractFlatRate(r) || 0.13) * 1000) / 1000,
    }));

    return NextResponse.json({
      success: true,
      primary: result,
      allRates,
      source: 'urdb',
    });

  } catch (err: any) {
    console.warn('URDB lookup failed, using fallback:', err.message);
    return buildFallbackResponse(address, zip, lat, lon);
  }
}

function buildFallbackResponse(address: string, zip: string, lat: string, lon: string) {
  // Detect state from address
  const stateMatch = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?$/);
  const stateCode = stateMatch?.[1] || 'TX';
  const fallbackRate = STATE_FALLBACK_RATES[stateCode] || 0.13;

  const result: UtilityRateResult = {
    utilityName: 'Local Utility',
    rateName: `${stateCode} State Average`,
    rateId: '',
    sector: 'Residential',
    flatRate: fallbackRate,
    avgMonthlyFixed: 10,
    hasTOU: false,
    hasTiered: false,
    hasDemandCharge: false,
    source: 'fallback',
    state: stateCode,
    zip,
  };

  return NextResponse.json({
    success: true,
    primary: result,
    allRates: [{ rateId: '', rateName: `${stateCode} State Average`, utilityName: 'Local Utility', sector: 'Residential', flatRate: fallbackRate }],
    source: 'fallback',
    note: 'Using state average rate — URDB lookup unavailable',
  });
}