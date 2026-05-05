// ============================================================================
// /api/auth/mobile-session — DISABLED
//
// This route previously minted a short-lived SSO JWT so SolarPro could log
// the user into the mobile app via sitesurvey://login?token=<jwt>.
// Per MASTER DIRECTIVE (field-first architecture), SolarPro does NOT control
// mobile app authentication. The mobile app manages its own auth.
//
// Returns 410 Gone to signal stale callers clearly.
// ============================================================================

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Mobile SSO from SolarPro is no longer supported. ' +
             'The mobile app manages its own authentication.',
      code: 'MOBILE_SSO_DISABLED',
    },
    { status: 410 },
  );
}