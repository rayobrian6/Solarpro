// ============================================================
// GET /api/admin/nearmap-tile/{z}/{x}/{y}
// Admin-only proxy for Nearmap Vert imagery tiles. Keeps NEARMAP_API_KEY
// server-side (Leaflet requests these from the browser without ever seeing the key).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: { z: string; x: string; y: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await requireAdminApi(req);
  if (!admin) return new NextResponse('Forbidden', { status: 403 });

  const key = process.env.NEARMAP_API_KEY;
  if (!key) return new NextResponse('Nearmap not configured', { status: 503 });

  const { z, x, y } = params;
  if (![z, x, y].every(v => /^\d{1,3}$/.test(v))) {
    return new NextResponse('Bad tile coordinate', { status: 400 });
  }

  try {
    const url = `https://api.nearmap.com/tiles/v3/Vert/${z}/${x}/${y}.jpg?apikey=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return new NextResponse('Tile fetch failed', { status: 502 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch {
    return new NextResponse('Tile error', { status: 502 });
  }
}
