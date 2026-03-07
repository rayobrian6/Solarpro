import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'solarpro_session';
const JWT_SECRET = process.env.JWT_SECRET || 'solarpro-secret-key-change-in-production-2024';

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
];

// Simple JWT decode without verification (verification happens in API routes)
// For middleware we just check if a token exists and is structurally valid
function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url decode
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
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

  // Allow public auth paths
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
  const user = token ? decodeJwtPayload(token) : null;

  if (!user) {
    // API routes → return 401 JSON
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

  // Authenticated — pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|public).*)',
  ],
};