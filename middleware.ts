import { NextRequest, NextResponse } from 'next/server';
import { getDevSessionUserFromRequest } from '@/lib/dev-auth';

const COOKIE_NAME = 'solarpro_session';

// ── Session timeout enforcement per POL-SEC-009 ──────────────────────────
// Admin sessions expire after 8 hours of inactivity.
// Regular user sessions expire after 24 hours of inactivity.
// The JWT itself has a 30-day max lifetime, but the middleware enforces
// shorter inactivity windows for compliance (SOC 2 CC6.1, ISO 27001 A.9.4.2).
const SESSION_TIMEOUT_MS: Record<string, number> = {
  super_admin:  8 * 60 * 60 * 1000,   // 8 hours
  admin:        8 * 60 * 60 * 1000,   // 8 hours
  staff:        8 * 60 * 60 * 1000,   // 8 hours
  crew_member: 24 * 60 * 60 * 1000,  // 24 hours
  homeowner:   24 * 60 * 60 * 1000,  // 24 hours
  user:        24 * 60 * 60 * 1000,  // 24 hours (default/fallback)
};
const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// Public paths that never require auth
// ── Public Paths ────────────────────────────────────────────────────
// SECURITY AUDIT: Only truly public endpoints belong here.
// Everything else requires a valid session cookie.
const PUBLIC_PATHS = [
  // ── Marketing / Legal pages ──
  '/',
  '/auth/login',
  '/auth/register',
  '/auth/subscribe',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/mfa/enroll',  // MFA enrollment page (uses enrollment pending cookie, not session)
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
  '/api/auth/mfa/verify',  // MFA verify uses MFA pending cookie, not session cookie
  '/api/auth/mfa/setup',   // MFA setup uses session cookie (requires auth)

  // ── SSO authorize (OAuth-style entry point for mobile/external apps) ──
  // This endpoint is intentionally public: unauthenticated users get
  // redirected to /auth/login?next=<this-url> by the route handler itself.
  // Blocking it here with 401 would break the entire SSO flow.
  '/api/auth/authorize',

  // ── Safe public endpoints ──
  '/api/tos-accept',
  '/api/pricing',
  '/api/version',
  '/api/health',              // health checks (no secrets exposed)
  '/api/system/health',       // infrastructure health (no secrets)
  '/api/enterprise/contact',  // enterprise contact form

  // -- Homeowner portal (own auth, own cookie) --
  '/portal',
  '/api/portal/login',
  '/api/portal/logout',

  // -- Public lead capture (no auth, rate-limited) --
  '/get-a-quote',
  '/api/leads/public',

  // ── Mobile app endpoints (validated internally via Bearer JWT) ──
  // Middleware only understands session cookies. The mobile field app sends
  // a Bearer token (SOLARPRO_HANDOFF_SECRET-signed JWT). Let requests through
  // here — the route handlers verify the Bearer token themselves.
  '/api/mobile/',

  // ── External webhooks (validated internally via signature) ──
  '/api/stripe/webhook',
  '/api/webhooks/survey-complete',  // site-survey partner webhook (HMAC-signed)

  // ── DB migrations (validated internally via MIGRATE_SECRET) ──
  '/api/migrate',

  // ── Lockout-safe account diagnostic (validated internally via ADMIN_SECRET) ──
  // Allows diagnosing a locked-out account without needing to be logged in.
  // NOTE: productionGuard() inside the route blocks this entirely in production.
  // The PUBLIC_PATHS entry is kept so middleware doesn't redirect before the
  // route handler can return its own 404 — avoiding a confusing redirect loop.
  '/api/admin/debug/account-state',

  // ── Emergency account repair (validated internally via ADMIN_SECRET) ──
  '/api/admin/repair-account',

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
function decodeJwtPayload(token: string): { id: string; email: string; exp?: number; iat?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(base64));
    // Check expiry
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    // Must have id and email (identity fields)
    if (!data.id || !data.email) return null;
    return {
      id: String(data.id),
      email: String(data.email),
      exp: data.exp,
      iat: data.iat,
    };
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── CORS OPTIONS preflight for cross-origin API paths ──────────────────
  // SECURITY FIX: These CORS handlers must run BEFORE the PUBLIC_PATHS check,
  // because PUBLIC_PATHS returns NextResponse.next() which skips all CORS logic.
  // Without this fix, OPTIONS preflight from trusted origins (e.g., Render mobile
  // backend) gets no Access-Control-Allow-Origin header, breaking cross-origin flows.
  const TRUSTED_API_ORIGINS = [
    'site-survey-api-bpyz.onrender.com',  // Mobile field app backend (Render)
  ];

  if (pathname.startsWith('/api/mobile/') && req.method === 'OPTIONS') {
    const origin = req.headers.get('origin') ?? '';
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* no origin header */ }
    const isTrustedOrigin = TRUSTED_API_ORIGINS.includes(originHost)
      || originHost === 'localhost:3000'
      || originHost === 'localhost:3008';
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  isTrustedOrigin ? origin : '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
        'Access-Control-Max-Age':       '86400',
      },
    });
  }

  const isAuthorize = pathname === '/api/auth/authorize';
  if (isAuthorize && req.method === 'OPTIONS') {
    const origin = req.headers.get('origin') ?? '';
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* no origin header */ }
    const isTrustedOrigin = TRUSTED_API_ORIGINS.includes(originHost)
      || originHost === 'localhost:3000'
      || originHost === 'localhost:3008';
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  isTrustedOrigin ? origin : '',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age':       '86400',
      },
    });
  }

  // Allow public paths — with CORS headers for cross-origin API routes
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const res = NextResponse.next();

    // ── Attach CORS response headers for cross-origin public API paths ──
    // OPTIONS preflight is already handled above; this adds headers on
    // actual GET/POST responses so the browser allows the cross-origin read.
    const isMobileApi = pathname.startsWith('/api/mobile/');
    const isAuthorize = pathname === '/api/auth/authorize';

    if (isMobileApi || isAuthorize) {
      const origin = req.headers.get('origin') ?? '';
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* no origin header */ }

      const isTrustedOrigin = TRUSTED_API_ORIGINS.includes(originHost)
        || originHost === 'localhost:3000'
        || originHost === 'localhost:3008';

      if (isTrustedOrigin) {
        res.headers.set('Access-Control-Allow-Origin', origin);
        if (isMobileApi) {
          res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
        } else {
          res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        }
      }
    }

    return res;
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

  // /api/mobile/* routes are Bearer-JWT authenticated — CSRF does not apply.
  // Allow trusted API origins through without CSRF check.
  const isMobileApi = pathname.startsWith('/api/mobile/');

  if (isStateChanging && pathname.startsWith('/api/') && !isWebhook && !isMobileApi) {
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
          || originHost === 'localhost:3008'
          || TRUSTED_API_ORIGINS.includes(originHost);

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


  // ── CORS for cross-origin API paths (non-OPTIONS) ──────────────────────
  // NOTE: /api/mobile/* and /api/auth/authorize are in PUBLIC_PATHS and are
  // handled above (with CORS headers attached). This section handles non-public
  // cross-origin paths that pass auth — currently none need CORS.
  // The dead CORS code for PUBLIC_PATHS was removed in the security audit fix.

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

  // ── Session timeout enforcement per POL-SEC-009 ────────────────────────
  // Check if the session has exceeded the maximum inactivity window.
  // Admin paths (/admin, /api/admin) use the 8-hour timeout.
  // All other paths use the 24-hour timeout.
  // The JWT's iat (issued-at) is the proxy for "last authentication time".
  if (user.iat) {
    const nowMs = Date.now();
    const iatMs = user.iat * 1000; // Convert seconds to ms
    const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
    const maxSessionMs = isAdminPath
      ? SESSION_TIMEOUT_MS['admin']
      : DEFAULT_SESSION_TIMEOUT_MS;

    if (nowMs - iatMs > maxSessionMs) {
      // Session has exceeded the maximum duration — require re-authentication
      console.log(`[SESSION_TIMEOUT] path=${pathname} iat=${user.iat} maxHours=${maxSessionMs / 3600000}`);

      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
          { status: 401 }
        );
      }

      // Page routes -> redirect to login with session expired message
      const loginUrl = new URL('/auth/login', req.url);
      loginUrl.searchParams.set('reason', 'session_expired');
      if (pathname !== '/' && !pathname.startsWith('/auth')) {
        loginUrl.searchParams.set('redirect', pathname);
      }
      const redirectResponse = NextResponse.redirect(loginUrl);
      // Clear the expired session cookie
      redirectResponse.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
      return redirectResponse;
    }
  }

  // Authenticated — pass through.
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