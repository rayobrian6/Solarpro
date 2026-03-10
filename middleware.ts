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
  '/api/admin/debug',
];

// Simple JWT decode without verification (verification happens in API routes / server components)
// For middleware we just check if a token exists, is structurally valid, and not expired
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const data = JSON.parse(json);
    // Check expiry
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    // Check required fields
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

  // Check for session cookie
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user  = token ? decodeJwtPayload(token) : null;

  // Not authenticated
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/auth/login', req.url);
    if (pathname !== '/' && !pathname.startsWith('/auth')) {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // /admin routes — middleware does a quick JWT role check as first gate.
  // The server component layout (requireAdmin) does the authoritative DB check.
  // NOTE: JWT role may be stale — requireAdmin() always re-fetches from DB.
  // We allow through here if JWT has admin/super_admin OR if JWT has no role
  // (stale token) — requireAdmin() will do the real check.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const role = user.role ?? '';
    // If JWT explicitly has a non-admin role, block early
    if (role && role !== 'admin' && role !== 'super_admin') {
      if (pathname.startsWith('/api/admin')) {
        return NextResponse.json(
          { success: false, error: 'Forbidden — admin access required' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    // Otherwise let through — requireAdmin() / requireAdminApi() will do DB check
  }

  // Authenticated — pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|public).*)',
  ],
};