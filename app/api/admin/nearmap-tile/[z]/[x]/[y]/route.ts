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
  // Tile coords at z20–21 are 5–7 digit numbers (x/y up to 2^z-1), so the old
  // 1–3 digit guard rejected EVERY real tile → gray map. Validate by range instead.
  const zi = Number(z), xi = Number(x), yi = Number(y);
  const valid =
    [z, x, y].every(v => /^\d{1,8}$/.test(v)) &&
    zi >= 0 && zi <= 24 &&
    xi >= 0 && xi < 2 ** zi &&
    yi >= 0 && yi < 2 ** zi;
  if (!valid) {
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
