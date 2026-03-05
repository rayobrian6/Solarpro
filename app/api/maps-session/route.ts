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

// GET /api/maps-session → returns { session, key }
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionToken();
    return NextResponse.json({ session, key: GOOGLE_MAPS_API_KEY });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET /api/maps-session/tile?z=&x=&y= → proxies satellite tile
export async function POST(req: NextRequest) {
  try {
    const { z, x, y } = await req.json();
    const session = await getSessionToken();
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${session}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return new NextResponse('Tile error', { status: res.status });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e: any) {
    return new NextResponse('Error', { status: 500 });
  }
}