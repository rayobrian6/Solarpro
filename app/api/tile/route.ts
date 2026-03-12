export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

let cachedSession: { token: string; expiry: number } | null = null;

async function getSessionToken(): Promise<string> {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const z = searchParams.get('z');
  const x = searchParams.get('x');
  const y = searchParams.get('y');

  if (!z || !x || !y) {
    return new NextResponse('Missing z/x/y', { status: 400 });
  }

  try {
    const session = await getSessionToken();
    // Use Google Maps 2D satellite tiles (high quality, same projection as 3D)
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${session}&key=${GOOGLE_MAPS_API_KEY}`;
    
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
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e: any) {
    return new NextResponse('Proxy error', { status: 500 });
  }
}