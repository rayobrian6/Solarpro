import { NextRequest, NextResponse } from 'next/server';
import { clearPortalCookie } from '@/lib/portalAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.headers.set('Set-Cookie', clearPortalCookie());
  return res;
}