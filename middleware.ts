import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'solarpro_session';

// Public paths that never require auth
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/subscribe',
  '/subscribe',
  '/enterprise',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/pricing',
  '/api/version',
  '/api/engineering/sld',
  '/api/engineering/sld/test',
  '/api/enterprise',
  '/api/stripe/webhook',
  '/api/migrate',
  '/api/admin/free-pass',
  '/api/admin/set-roles',
  '/api/admin/debug-role',
  '/api/admin/fix-raymond',
  '/api/admin/check-raymond',
  '/api/admin/reset-raymond',
  '/api/admin/me-debug',
];

/**
 * Decode JWT payload without verification.
 * Middleware only checks: is the token structurally valid and not expired?
 * Role is NOT checked here — that is handled by requireAdmin() in server components
 * and requireAdminApi() in API routes, both of which query the DB.
 */
function decodeJwtPayload(token: string): { id: string; email: string; exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(base64));
    // Check expiry
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    // Must have id and email (identity fields)
    if (!data.id || !data.email) return null;
    return data;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icons/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for valid session cookie (authentication only — no role check)
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user  = token ? decodeJwtPayload(token) : null;

  if (!user) {
    // API routes → 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    // Page routes → redirect to login
    const loginUrl = new URL('/auth/login', req.url);
    if (pathname !== '/' && !pathname.startsWith('/auth')) {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — pass through.
  // /admin role authorization is handled by:
  //   - app/admin/layout.tsx → requireAdmin() → queries DB for role
  //   - /api/admin/* routes  → requireAdminApi() → queries DB for role
  // Middleware does NOT check role — DB is the single source of truth.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|public).*)',
  ],
};