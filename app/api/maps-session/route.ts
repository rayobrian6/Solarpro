export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// SECURITY: Read key from env var only — never hardcoded in source.
// Set GOOGLE_MAPS_API_KEY (server-side) or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env
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

// GET /api/maps-session → returns { session }
// SECURITY: Requires authentication — prevents unauthenticated quota abuse.
// Client reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from process.env directly;
// the key is NOT returned in this response body.
export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    const session = await getSessionToken();
    // Return session only — do NOT expose key in response body
    return NextResponse.json({ session });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/maps-session/route.ts]', e);
  }
}

// POST /api/maps-session → proxies satellite tile
// SECURITY: Requires authentication — prevents unauthenticated tile scraping.
export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    // Use the 'tile' rate limiter (60/60s) for tile proxy requests — higher volume OK
    const rl = await checkRateLimit('tile', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const body = await req.json();
    // BUG-21-08 FIX: Validate z/x/y as non-negative integers before interpolating into URL
    const z = parseInt(String(body.z), 10);
    const x = parseInt(String(body.x), 10);
    const y = parseInt(String(body.y), 10);
    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0 || z > 22) {
      return new NextResponse('Invalid tile coordinates', { status: 400 });
    }
    const session = await getSessionToken();
    // BUG-21-08 FIX: Use validated integers and encodeURIComponent on token/key — no injection possible
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) return new NextResponse('Tile error', { status: res.status });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        // BUG-21-08 FIX: Removed CORS wildcard — endpoint requires auth, must not allow cross-origin access
      },
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/maps-session/route.ts]', e);
  }
}