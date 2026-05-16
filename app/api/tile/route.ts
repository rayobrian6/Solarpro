export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';

// SECURITY: Read key from env var only — never hardcoded in source.
const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

let cachedSession: { token: string; expiry: number } | null = null;

async function getSessionToken(): Promise<string> {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY not configured');
  const now = Math.floor(Date.now() / 1000);
  if (cachedSession && cachedSession.expiry > now + 300) {
    return cachedSession.token;
  }
  const res = await fetch(
    `https://tile.googleapis.com/v1/createSession?key=${GOOGLE_MAPS_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
    }
  );
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  const data = await res.json();
  cachedSession = { token: data.session, expiry: parseInt(data.expiry) };
  return data.session;
}

// GET /api/tile?z=&x=&y= → proxies satellite tile
// SECURITY: Requires authentication — prevents unauthenticated quota abuse.
export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  const { searchParams } = new URL(req.url);
  const zRaw = searchParams.get('z');
  const xRaw = searchParams.get('x');
  const yRaw = searchParams.get('y');

  if (!zRaw || !xRaw || !yRaw) {
    return new NextResponse('Missing z/x/y', { status: 400 });
  }

  // BUG-21-07 FIX: Validate z/x/y as non-negative integers before interpolating into URL
  const z = parseInt(zRaw, 10);
  const x = parseInt(xRaw, 10);
  const y = parseInt(yRaw, 10);
  if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0 || z > 22) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  try {
    const session = await getSessionToken();
    // Use validated integer tile coordinates — no injection possible
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarProDesign/1.0' },
    });

    if (!res.ok) {
      // Fallback to ArcGIS if Google fails
      const fallbackUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      const fallback = await fetch(fallbackUrl);
      if (!fallback.ok) return new NextResponse('Tile fetch failed', { status: fallback.status });
      const buf = await fallback.arrayBuffer();
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          // BUG-21-07 FIX: Removed CORS wildcard — endpoint requires auth, must not allow cross-origin access
        },
      });
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        // BUG-21-07 FIX: Removed CORS wildcard — endpoint requires auth, must not allow cross-origin access
      },
    });
  } catch (e: unknown) {
    return new NextResponse('Proxy error', { status: 500 });
  }
}