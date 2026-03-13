// ============================================================
// POST /api/engineering/pvwatts
// NREL PVWatts V6 proxy — solar production modeling
// Docs: https://developer.nrel.gov/docs/solar/pvwatts/v6/
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NREL_API_KEY = process.env.NREL_API_KEY || 'DEMO_KEY';
const PVWATTS_URL = 'https://developer.nrel.gov/api/pvwatts/v6.json';

export interface PVWattsRequest {
  systemCapacityKw: number;    // DC system size in kW
  moduleType?: 0 | 1 | 2;     // 0=Standard, 1=Premium, 2=Thin film
  losses?: number;             // System losses % (default 14.08)
  arrayType?: 0 | 1 | 2 | 3 | 4; // 0=Fixed open rack, 1=Fixed roof mount, 2=1-axis, 3=1-axis backtrack, 4=2-axis
  tilt?: number;               // Tilt angle (degrees)
  azimuth?: number;            // Azimuth angle (degrees, 180=south)
  lat?: number;                // Latitude
  lon?: number;                // Longitude
  address?: string;            // Address (alternative to lat/lon)
  radius?: number;             // Search radius for TMY station (miles)
  timeframe?: 'monthly' | 'hourly'; // Output timeframe
  dcAcRatio?: number;          // DC-to-AC ratio (default 1.2)
  gcr?: number;                // Ground coverage ratio (default 0.4)
  bifaciality?: number;        // Bifacial module factor (0-1)
}

export interface PVWattsResponse {
  success: boolean;
  annualProduction?: number;       // kWh/year
  monthlyProduction?: number[];    // kWh per month [Jan..Dec]
  capacityFactor?: number;         // %
  solradAnnual?: number;           // kWh/m²/day
  acAnnual?: number;               // AC energy kWh/year
  dcAnnual?: number;               // DC energy kWh/year
  stationInfo?: {
    lat: number;
    lon: number;
    elev: number;
    timezone: number;
    location: string;
    city: string;
    state: string;
    distance: number;
    stationId: string;
  };
  inputs?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
  error?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: PVWattsRequest = await req.json();

    // Validate required fields
    if (!body.systemCapacityKw || body.systemCapacityKw <= 0) {
      return NextResponse.json({
        success: false,
        error: 'systemCapacityKw is required and must be > 0',
      }, { status: 400 });
    }

    if (!body.lat && !body.lon && !body.address) {
      return NextResponse.json({
        success: false,
        error: 'Either lat/lon or address is required',
      }, { status: 400 });
    }

    // Build NREL API query params
    const params = new URLSearchParams({
      api_key:          NREL_API_KEY,
      system_capacity:  String(body.systemCapacityKw),
      module_type:      String(body.moduleType ?? 1),       // 1 = Premium (default for residential)
      losses:           String(body.losses ?? 14.08),
      array_type:       String(body.arrayType ?? 1),        // 1 = Fixed roof mount
      tilt:             String(body.tilt ?? 20),
      azimuth:          String(body.azimuth ?? 180),
      dc_ac_ratio:      String(body.dcAcRatio ?? 1.2),
      gcr:              String(body.gcr ?? 0.4),
      timeframe:        body.timeframe ?? 'monthly',
    });

    if (body.lat !== undefined && body.lon !== undefined) {
      params.set('lat', String(body.lat));
      params.set('lon', String(body.lon));
    } else if (body.address) {
      params.set('address', body.address);
    }

    if (body.radius !== undefined) {
      params.set('radius', String(body.radius));
    }

    if (body.bifaciality !== undefined) {
      params.set('bifaciality', String(body.bifaciality));
    }

    const url = `${PVWATTS_URL}?${params.toString()}`;

    const nrelRes = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    });

    if (!nrelRes.ok) {
      const errText = await nrelRes.text();
      return NextResponse.json({
        success: false,
        error: `NREL API error ${nrelRes.status}: ${errText}`,
      }, { status: nrelRes.status });
    }

    const data = await nrelRes.json();

    // Check for NREL-level errors
    if (data.errors && data.errors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: data.errors,
        error: data.errors.join('; '),
      }, { status: 422 });
    }

    const outputs = data.outputs ?? {};
    const station = data.station_info ?? {};

    const response: PVWattsResponse = {
      success: true,
      annualProduction:  outputs.ac_annual,
      monthlyProduction: outputs.ac_monthly,
      capacityFactor:    outputs.capacity_factor,
      solradAnnual:      outputs.solrad_annual,
      acAnnual:          outputs.ac_annual,
      dcAnnual:          outputs.dc_annual,
      stationInfo: station.lat !== undefined ? {
        lat:       station.lat,
        lon:       station.lon,
        elev:      station.elev,
        timezone:  station.tz,
        location:  station.location ?? '',
        city:      station.city ?? '',
        state:     station.state ?? '',
        distance:  station.distance ?? 0,
        stationId: station.station_id ?? '',
      } : undefined,
      inputs:   data.inputs,
      warnings: data.warnings,
    };

    return NextResponse.json(response);

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/pvwatts/route.ts]', err);
  }
}

// GET handler for simple queries
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const systemCapacityKw = parseFloat(searchParams.get('systemCapacityKw') ?? '0');
  const lat = parseFloat(searchParams.get('lat') ?? '0');
  const lon = parseFloat(searchParams.get('lon') ?? '0');
  const address = searchParams.get('address') ?? '';

  if (!systemCapacityKw) {
    return NextResponse.json({ success: false, error: 'systemCapacityKw required' }, { status: 400 });
  }

  const body: PVWattsRequest = {
    systemCapacityKw,
    lat: lat || undefined,
    lon: lon || undefined,
    address: address || undefined,
    moduleType: 1,
    arrayType: 1,
    tilt: parseFloat(searchParams.get('tilt') ?? '20'),
    azimuth: parseFloat(searchParams.get('azimuth') ?? '180'),
    losses: parseFloat(searchParams.get('losses') ?? '14.08'),
  };

  // Reuse POST handler
  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

  return POST(mockReq);
}