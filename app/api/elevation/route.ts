export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// SECURITY: Read key from env var only — never hardcoded in source.
const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

    const rl = await checkRateLimit('geo', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  // Length caps — prevent oversized values being forwarded to Google Maps elevation API
  const lat = (searchParams.get('lat') || '').slice(0, 30) || null;
  const lng = (searchParams.get('lng') || '').slice(0, 30) || null;
  const locationsRaw = searchParams.get('locations'); // pipe-separated for grid
  // Pipe-separated lat/lng pairs: limit to 512 pairs max (each ~20 chars = ~10KB)
  const locations = locationsRaw ? locationsRaw.slice(0, 10240) : null;

  try {
    let locStr: string;
    if (locations) {
      locStr = locations;
    } else if (lat && lng) {
      locStr = `${lat},${lng}`;
    } else {
      return NextResponse.json({ error: 'lat/lng or locations required' }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(locStr)}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (locations) {
      // Return full results array for grid
      return NextResponse.json({ results: data.results ?? [] });
    } else {
      // Return single elevation
      if (data.results?.[0]) {
        return NextResponse.json({ elevation: data.results[0].elevation });
      }
      return NextResponse.json({ elevation: 0 });
    }
  } catch (err: unknown) {
    return NextResponse.json({ elevation: 0, error: (err as Error).message }, { status: 500 });
  }
}