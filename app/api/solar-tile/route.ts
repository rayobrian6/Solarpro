/**
 * /api/solar-tile — Server-side proxy for Google Solar GeoTIFF tile downloads.
 *
 * Google Solar dataLayers URLs embed the API key as a query parameter.
 * This route strips and re-adds the key server-side so it is never exposed
 * to the browser.
 *
 * Usage:
 *   GET /api/solar-tile?url=<encoded-google-solar-tile-url>
 *
 * The `url` parameter should be the raw URL returned by the dataLayers API
 * (annualFluxUrl, maskUrl, dsmUrl, etc.). This proxy:
 *   1. Validates the URL is a google.apis.com / solar.googleapis.com origin
 *   2. Strips any existing `key=` parameter
 *   3. Re-adds the server-side API key
 *   4. Streams the GeoTIFF bytes back to the browser
 */

export const dynamic  = 'force-dynamic';
export const runtime  = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';

const API_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY  ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const ALLOWED_HOSTS = [
  'solar.googleapis.com',
  'earthengine.googleapis.com',
  'storage.googleapis.com',
  'solarstorage.googleapis.com',
];

export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user (same as /api/solar)
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
  }

  // Security: only allow Google Solar / Earth Engine origins
  if (!ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    return NextResponse.json({ error: 'URL origin not allowed' }, { status: 403 });
  }

  if (!API_KEY) {
    return NextResponse.json({ error: 'Solar API key not configured' }, { status: 503 });
  }

  // Strip any existing key, add ours
  parsed.searchParams.delete('key');
  parsed.searchParams.set('key', API_KEY);

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { 'Accept': 'image/tiff, application/octet-stream, */*' },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Google upstream error: ${upstream.status}`, detail: text.slice(0, 300) },
        { status: upstream.status },
      );
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'image/tiff',
        'Content-Length': buf.byteLength.toString(),
        'Cache-Control': 'private, max-age=86400',  // cache tiles for 24h
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'Proxy fetch failed', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
