import { NextRequest, NextResponse } from 'next/server';
import { getDevSessionUserFromRequest } from '@/lib/dev-auth';

const COOKIE_NAME = 'solarpro_session';

// Public paths that never require auth
// ── Public Paths ────────────────────────────────────────────────────
// SECURITY AUDIT: Only truly public endpoints belong here.
// Everything else requires a valid session cookie.
const PUBLIC_PATHS = [
  // ── Marketing / Legal pages ──
  '/auth/login',
  '/auth/register',
  '/auth/subscribe',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/subscribe',
  '/enterprise',
  '/terms',

  // ── Auth API (must be public for login/register flow) ──
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',

  // ── Safe public endpoints ──
  '/api/tos-accept',
  '/api/pricing',
  '/api/version',
  '/api/health',              // health checks (no secrets exposed)
  '/api/system/health',       // infrastructure health (no secrets)
  '/api/enterprise/contact',  // enterprise contact form

  // ── External webhooks (validated internally via signature) ──
  '/api/stripe/webhook',
  '/api/webhooks/survey-complete',  // site-survey partner webhook (HMAC-signed)

  // ── DB migrations (validated internally via MIGRATE_SECRET) ──
  '/api/migrate',

  // ── REMOVED from public (now require auth): ──────────────────
  // '/api/auth/debug-password-reset',  — debug route, guarded in prod
  // '/api/auth/debug-login',           — debug route, guarded in prod
  // '/api/debug/auth',                 — debug route, guarded in prod
  // '/api/engineering/sld',            — engineering endpoint, requires auth
  // '/api/engineering/sld/test',       — engineering endpoint, requires auth
  // '/api/system/env',                 — exposes env var status, requires auth
  // '/api/migrate',                    — DB migration, uses MIGRATE_SECRET
  // '/api/ocr',                        — computation endpoint, requires auth
  // '/api/admin/free-pass',            — admin action, requires admin role
  // '/api/enterprise',                 — ambiguous, narrowed to /contact only
];

/**
 * Decode JWT payload without verification.
 * Middleware only checks: is the token structurally valid and not expired?
 * Role is NOT checked here -- that is handled by requireAdmin() in server components
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
    // Public path — no logging needed
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

  // ── CSRF Protection ─────────────────────────────────────────────────────────
  // Verify Origin header on state-changing methods (POST, PUT, PATCH, DELETE).
  // Prevents cross-site form submissions against cookie-authenticated endpoints.
  // Safe: GET/HEAD/OPTIONS are read-only and always allowed through.
  // Webhook endpoints (Stripe) are excluded — they use signature verification.
  const method = req.method.toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  // Exclude HMAC-signed webhooks from CSRF check — they use signature verification instead.
  // Both are also in PUBLIC_PATHS so they bypass auth entirely; this is belt-and-suspenders.
  const isWebhook = pathname.startsWith('/api/stripe/webhook') ||
                    pathname.startsWith('/api/webhooks/survey-complete');

  if (isStateChanging && pathname.startsWith('/api/') && !isWebhook) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');

    // In production, require Origin to match Host
    // In development, allow localhost origins
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        // SECURITY: Origin must exactly match Host. The previous broad
          // .vercel.app wildcard allowed any attacker-controlled Vercel app to make
          // authenticated cross-origin requests against this app.
          const hostsMatch = originHost === host
          || originHost === 'localhost:3000'
          || originHost === 'localhost:3008';

        if (!hostsMatch) {
          console.warn(`[CSRF_BLOCKED] origin=${origin} host=${host} path=${pathname}`);
          return NextResponse.json(
            { success: false, error: 'Cross-origin request blocked' },
            { status: 403 }
          );
        }
      } catch {
        // Malformed origin header — block request
        console.warn(`[CSRF_BLOCKED] malformed origin=${origin} path=${pathname}`);
        return NextResponse.json(
          { success: false, error: 'Invalid request origin' },
          { status: 403 }
        );
      }
    }
    // If no Origin header is present, the request likely came from the same origin
    // (browsers always send Origin on cross-origin POST requests)
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── Dev auth bypass (non-production only) ──────────────────────────────────
  // Active when: VERCEL_ENV !== 'production' AND DEV_AUTH_BYPASS=true in env
  //              NOTE: NODE_ENV is always 'production' on Vercel (v47.59 fix)
  // Logs [DEV_AUTH_ACTIVE] so it is visible in function logs.
  // Production builds always skip this block — isDevAuthAllowed() hard-blocks.
  const devUser = getDevSessionUserFromRequest(req);
  if (devUser) {
    // Pass through with forwarded identity headers so API routes can read them
    const res = NextResponse.next();
    res.headers.set('x-dev-auth-user-id',    devUser.id);
    res.headers.set('x-dev-auth-user-email', devUser.email);
    return res;
  }
  // ──────────────────────────────────────────────────────────────────────────

  // PHASE 2: Structured cookie diagnostic log
  const rawCookieHeader = req.headers.get('cookie') || '';
  const allCookieNames  = rawCookieHeader
    .split(';')
    .map(c => c.trim().split('=')[0].trim())
    .filter(Boolean);

  // Check for valid session cookie (authentication only -- no role check)
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user  = token ? decodeJwtPayload(token) : null;

  // SECURITY: Minimal auth logging — no cookie content, no email in logs
  if (!token) {
    console.debug('[AUTH_MW]', JSON.stringify({ path: pathname, hasCookie: false }));
  }

  if (!user) {
    // API routes -> 401 JSON
    if (pathname.startsWith('/api/')) {
      console.debug(`[AUTH_MW_BLOCKED] path=${pathname}`);
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    // Page routes -> redirect to login
    console.debug(`[AUTH_MW_REDIRECT] path=${pathname}`);
    const loginUrl = new URL('/auth/login', req.url);
    if (pathname !== '/' && !pathname.startsWith('/auth')) {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated -- pass through.
  // /admin role authorization is handled by:
  //   - app/admin/layout.tsx -> requireAdmin() -> queries DB for role
  //   - /api/admin/* routes  -> requireAdminApi() -> queries DB for role
  // Middleware does NOT check role -- DB is the single source of truth.
  // Authenticated — pass through (no verbose logging)
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|public).*)',
  ],
};