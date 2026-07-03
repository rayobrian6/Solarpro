import { NextRequest, NextResponse } from 'next/server';
import { clearPortalCookie } from '@/lib/portalAuth';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
  const rlGuard = await rateLimitGuard(_req, 'portal_read');
  if (rlGuard.blocked) return rlGuard.response;

  const res = NextResponse.json({ success: true });
  res.headers.append('Set-Cookie', clearPortalCookie());
  return res;
}