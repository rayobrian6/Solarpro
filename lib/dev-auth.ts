// ============================================================
// lib/dev-auth.ts
// Development Authentication Bypass — v47.59
//
// PURPOSE:
//   Every Vercel preview deployment triggers a fresh serverless
//   instance. If JWT_SECRET is not configured in Vercel Settings
//   for the Preview environment (separate from Production), every
//   request appears unauthenticated and the developer is stuck in
//   a login loop.
//
//   This module provides a safe, explicit opt-in bypass so
//   developers can work without re-authenticating after every
//   preview deployment.
//
// ────────────────────────────────────────────────────────────
// CRITICAL FIX (v47.59): NODE_ENV IS NOT RELIABLE ON VERCEL
// ────────────────────────────────────────────────────────────
//   Vercel sets NODE_ENV=production for ALL deployment types:
//     - Production deployments  (VERCEL_ENV=production)
//     - Preview deployments     (VERCEL_ENV=preview)
//     - Development CLI         (VERCEL_ENV=development)
//
//   The v47.57 guard `NODE_ENV !== 'production'` permanently
//   blocked dev auth on ALL Vercel deployments including preview.
//   DEV_AUTH_BYPASS=true had zero effect on Vercel preview.
//
//   CORRECT GUARD: Use VERCEL_ENV, not NODE_ENV.
//     VERCEL_ENV=production  → ALWAYS block (production deploy)
//     VERCEL_ENV=preview     → Allow if DEV_AUTH_BYPASS=true
//     VERCEL_ENV=development → Allow if DEV_AUTH_BYPASS=true
//     VERCEL_ENV not set     → Local dev → Allow if DEV_AUTH_BYPASS=true
//
// ────────────────────────────────────────────────────────────
// ACTIVATION (ALL conditions must pass):
//   1. VERCEL_ENV !== 'production'  — never on prod Vercel deploy
//   2. DEV_AUTH_BYPASS=true in env  — explicit opt-in
//
// PRODUCTION HARD-BLOCK:
//   If VERCEL_ENV === 'production', isDevAuthAllowed() returns
//   false regardless of everything else. This is the ONLY guard
//   that matters on Vercel — NODE_ENV is unreliable.
//
// LOG CODE: [DEV_AUTH_ACTIVE]
//   Search Vercel function logs for this code to confirm/deny
//   whether dev auth is being used for a given request.
//
// SETUP — Vercel Dashboard:
//   Project → Settings → Environment Variables
//   Add DEV_AUTH_BYPASS with value "true"
//   Set environment scope to: Preview ✓  Development ✓
//   Leave Production UNCHECKED — bypass must never reach prod.
//
// SETUP — Local dev (.env.local — never commit):
//   DEV_AUTH_BYPASS=true
//   DEV_AUTH_USER_ID=dev-user-001          # optional
//   DEV_AUTH_USER_EMAIL=dev@localhost      # optional
//   DEV_AUTH_USER_NAME=Dev User            # optional
//
// ============================================================

import type { SessionUser } from '@/lib/auth';

// ── Constants ─────────────────────────────────────────────────────────────────

/** The fixed dev session user returned when bypass is active. */
export const DEV_SESSION_USER: SessionUser = {
  id:      process.env.DEV_AUTH_USER_ID    || 'dev-user-bypass-001',
  name:    process.env.DEV_AUTH_USER_NAME  || 'Dev User (Bypass)',
  email:   process.env.DEV_AUTH_USER_EMAIL || 'dev@localhost',
  company: 'SolarPro Dev',
};

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Returns true ONLY if all production guards pass.
 *
 * v47.59 FIX: Uses VERCEL_ENV (not NODE_ENV) as the production gate.
 * NODE_ENV is 'production' on ALL Vercel deployments (including preview),
 * making it useless for distinguishing preview from production.
 * VERCEL_ENV is the authoritative signal:
 *   'production'  → block (production Vercel deploy)
 *   'preview'     → allow if DEV_AUTH_BYPASS=true
 *   'development' → allow if DEV_AUTH_BYPASS=true
 *   undefined     → local dev → allow if DEV_AUTH_BYPASS=true
 */
export function isDevAuthAllowed(): boolean {
  // Hard block — production Vercel deployments can never use dev auth
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
 */
export function getDevSessionUser(
  headers?: Headers | { get(name: string): string | null } | null
): SessionUser | null {
  if (!isDevAuthAllowed()) return null;

  // When isDevAuthAllowed() returns true, DEV_AUTH_BYPASS=true is confirmed
  // and VERCEL_ENV is not 'production'. Log and return dev user.
  const headerBypass = headers ? requestHasDevAuthHeader(headers) : false;

  console.log('[DEV_AUTH_ACTIVE]', JSON.stringify({
    userId:    DEV_SESSION_USER.id,
    email:     DEV_SESSION_USER.email,
    nodeEnv:   process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? 'not-set (local)',
    via:       headerBypass ? 'header(X-Dev-Auth)' : 'env(DEV_AUTH_BYPASS)',
  }));
  return DEV_SESSION_USER;
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

// ── Dev user response shape (for /api/auth/me) ────────────────────────────────

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
      freePassNote:       'Dev auth bypass — preview/local only',
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