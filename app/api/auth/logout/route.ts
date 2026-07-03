export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  try {
    const response = NextResponse.json({ success: true });

    // Use response.cookies.set() — same pattern as login for consistency.
    // Deleting with maxAge=0 is the reliable way to clear an httpOnly cookie.
    response.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   0,
    });

    return response;
  } catch (err: unknown) {
    console.error(`[API_ERROR] /api/auth/logout: ${(err as Error).message}`);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}