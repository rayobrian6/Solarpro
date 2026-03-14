// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.55';
export const APP_VERSION       = BUILD_VERSION; // alias used by health route
export const BUILD_DATE        = '2026-06-09';
export const BUILD_DESCRIPTION = 'v47.55: Auth root cause fix — remove Cache-Control: no-store catch-all from vercel.json and next.config.js headers that was stripping Set-Cookie on login response. Add Phase 1-8 auth diagnostics.';
export const BUILD_FEATURES    = [
  // v47.55 -- Auth server-side investigation and fix
  'AUTH FIX: Remove "source":"/(.*)" Cache-Control: no-store from vercel.json — this header rule applied to /api/auth/login and caused Vercel edge proxy to strip Set-Cookie on login response',
  'AUTH FIX: Remove catch-all "/(.*)" from next.config.js async headers() — changed to "/((?!api|_next/static|_next/image|favicon.ico).*)" to exclude /api routes',
  'PHASE 1: Login route — AUTH_COOKIE_SET structured log: cookieName, hasSetCookieHeader, setCookiePreview, secure, sameSite, path, domain, maxAge, nodeEnv',
  'PHASE 2: Middleware — AUTH_REQUEST_COOKIES log: path, rawCookieHeaderPresent, rawCookiePreview, parsedCookieNames, expectedCookieName, hasExpectedCookie',
  'PHASE 2: Middleware — AUTH_SESSION_VALIDATION log: path, hasCookie, tokenParsed, tokenValid, userId, email',
  'PHASE 3: Cookie name confirmed — COOKIE_NAME="solarpro_session" used consistently in login route, middleware, /api/auth/me, and debug endpoint',
  'PHASE 4: Cookie config in production — secure=true (NODE_ENV=production), sameSite=lax, path=/, domain=omitted, maxAge=30days',
  'PHASE 5: AUTH_SECRET_FINGERPRINT log in login route — len, head[4], tail[4], charSum mod 9999 (no secret exposed) — confirms JWT_SECRET stability across deployments',
  'PHASE 6: GET /api/debug/auth — safe diagnostic endpoint: cookie presence, all cookie names, expected name, session validity, secret fingerprint, env. Added to PUBLIC_PATHS.',
  'PHASE 7: Preview deployment to verify before production push',
  'PHASE 8: Login page — after 200 OK, verify /api/debug/auth shows hasAuthCookie=true. If false, show "Authentication cookie was not issued" error instead of silently redirecting to broken session.',
  // v47.54 -- Full system audit
  'AUDIT: 10-phase full system audit (SYSTEM_AUDIT_v47.54.md)',
  'WORKFLOW: Fix design/engineering step checks to use layout.panels.length > 0',
  'PERMIT: ENGINEERING_MODEL_STALE guard + remove 9.6kW/24-panel silent defaults',
  // v47.53 -- Auth fix attempt 1
  'AUTH: response.cookies.set() replaces raw Set-Cookie header',
  'AUTH: removed vercel.json /api cache header override (partial — was only /api pattern, missed /(.*) catch-all)',
  'AUTH: removed router.refresh() race condition',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}