// ============================================================
// lib/dev-auth.ts
// Development Authentication Bypass — v47.57
//
// PURPOSE:
//   Every Vercel preview deployment gets a new URL and a fresh
//   cold-start instance. When JWT_SECRET is missing or mismatched
//   between preview and production, verifyToken() returns null,
//   every request looks unauthenticated, and the developer is
//   stuck in a login loop.
//
//   This module provides a safe, explicit opt-in bypass so
//   developers can work without re-authenticating after every
//   preview deployment.
//
// ACTIVATION (ALL three conditions must be true simultaneously):
//   1. NODE_ENV !== 'production'          — never in prod builds
//   2. VERCEL_ENV !== 'production'        — never on prod Vercel
//   3. DEV_AUTH_BYPASS=true in .env.local — explicit opt-in
//
//   OR: request carries header  X-Dev-Auth: bypass
//       AND the same env-level guards pass (1 + 2)
//
// PRODUCTION HARD-BLOCK:
//   If NODE_ENV === 'production' OR VERCEL_ENV === 'production',
//   isDevAuthAllowed() returns false regardless of anything else.
//   The bypass CANNOT activate in production builds.
//
// LOG CODE: [DEV_AUTH_ACTIVE]
//   Search Vercel function logs for this code to confirm/deny
//   whether dev auth is being used for a given request.
//
// SETUP (.env.local — never commit):
//   DEV_AUTH_BYPASS=true
//   DEV_AUTH_USER_ID=dev-user-001          # optional, default used
//   DEV_AUTH_USER_EMAIL=dev@localhost      # optional, default used
//   DEV_AUTH_USER_NAME=Dev User            # optional, default used
//
// ============================================================

import type { SessionUser } from '@/lib/auth';

// ── Constants ────────────────────────────────────────────────

/** The fixed dev session user returned when bypass is active. */
export const DEV_SESSION_USER: SessionUser = {
  id:      process.env.DEV_AUTH_USER_ID    || 'dev-user-bypass-001',
  name:    process.env.DEV_AUTH_USER_NAME  || 'Dev User (Bypass)',
  email:   process.env.DEV_AUTH_USER_EMAIL || 'dev@localhost',
  company: 'SolarPro Dev',
};

// ── Guards ───────────────────────────────────────────────────

/**
 * Returns true ONLY if all production guards pass.
 * This is the single authoritative gate — called by every
 * bypass check point in the application.
 *
 * NEVER returns true when NODE_ENV === 'production' or
 * VERCEL_ENV === 'production'.
 */
export function isDevAuthAllowed(): boolean {
  // Hard block — production environments can never use dev auth
  if (process.env.NODE_ENV === 'production')   return false;
  if (process.env.VERCEL_ENV === 'production') return false;

  // Explicit opt-in required
  return process.env.DEV_AUTH_BYPASS === 'true';
}

/**
 * Returns true if the given request carries the dev auth header.
 * Header:  X-Dev-Auth: bypass
 *
 * The header alone is not sufficient — isDevAuthAllowed() must
 * also return true.  Both checks are always AND-gated.
 */
export function requestHasDevAuthHeader(
  headers: Headers | { get(name: string): string | null }
): boolean {
  const val = headers.get('x-dev-auth');
  return val !== null && val.toLowerCase() === 'bypass';
}

/**
 * Primary entry point.
 *
 * Returns the dev SessionUser if bypass should be applied to
 * this request, or null if normal auth should proceed.
 *
 * Logic:
 *   - If isDevAuthAllowed() is false → always null (production)
 *   - If DEV_AUTH_BYPASS=true AND isDevAuthAllowed() → return dev user
 *   - If X-Dev-Auth: bypass header AND isDevAuthAllowed() → return dev user
 *   - Otherwise → null (normal auth)
 */
export function getDevSessionUser(
  headers?: Headers | { get(name: string): string | null } | null
): SessionUser | null {
  if (!isDevAuthAllowed()) return null;

  // Env-var bypass: DEV_AUTH_BYPASS=true is already confirmed by isDevAuthAllowed()
  // so if we get here, bypass is active globally — return dev user unconditionally.
  // (The header variant is an alternative that also requires isDevAuthAllowed().)
  const headerBypass = headers ? requestHasDevAuthHeader(headers) : false;

  // Both paths are valid when isDevAuthAllowed() is true:
  //   Path A: env-var opt-in (DEV_AUTH_BYPASS=true) — applies to ALL requests
  //   Path B: per-request header (X-Dev-Auth: bypass) — selective override
  //
  // Since isDevAuthAllowed() already confirms DEV_AUTH_BYPASS=true,
  // env-var path is always active when we reach here.
  const active = true; // isDevAuthAllowed() already gated this

  if (active || headerBypass) {
    console.log('[DEV_AUTH_ACTIVE]', JSON.stringify({
      userId:  DEV_SESSION_USER.id,
      email:   DEV_SESSION_USER.email,
      env:     process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV ?? 'not-set',
      via:     headerBypass ? 'header(X-Dev-Auth)' : 'env(DEV_AUTH_BYPASS)',
    }));
    return DEV_SESSION_USER;
  }

  return null;
}

/**
 * Variant for middleware — takes a NextRequest-compatible object.
 * Returns the dev user or null.
 */
export function getDevSessionUserFromRequest(req: {
  headers: { get(name: string): string | null };
}): SessionUser | null {
  return getDevSessionUser(req.headers);
}

// ── Dev user response shape (for /api/auth/me) ───────────────

/**
 * Returns the full /api/auth/me response body for the dev bypass user.
 * Mirrors the shape of the real /api/auth/me response so UserContext
 * and all consumers receive a correctly typed object.
 */
export function getDevMeResponse(): object {
  return {
    success: true,
    data: {
      // Identity
      id:            DEV_SESSION_USER.id,
      name:          DEV_SESSION_USER.name,
      email:         DEV_SESSION_USER.email,
      company:       DEV_SESSION_USER.company ?? 'SolarPro Dev',
      phone:         null,
      emailVerified: true,
      createdAt:     new Date().toISOString(),

      // Role — dev gets super_admin so no feature gates block development
      role: 'super_admin',

      // Subscription — full access, no expiry
      plan:               'pro',
      subscriptionStatus: 'active',
      trialStartsAt:      null,
      trialEndsAt:        null,
      isFreePass:         true,
      freePassNote:       'Dev auth bypass — local/preview only',
      hasAccess:          true,

      // Legacy snake_case aliases
      subscription_status: 'active',
      is_free_pass:        true,
      trial_ends_at:       null,

      // Branding defaults
      companyLogoUrl:      null,
      companyWebsite:      null,
      companyAddress:      null,
      companyPhone:        null,
      brandPrimaryColor:   '#f59e0b',
      brandSecondaryColor: '#0f172a',
      proposalFooterText:  null,
    },
  };
}