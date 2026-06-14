// ============================================================================
// v47.440 - POST /api/satellite/lookup-business
//
// Business registry lookup endpoint that searches public corporate
// registries (OpenCorporates) and infers company data from email domain
// to auto-fill the onboarding wizard's Company Info step.
//
// Input:  { email?, companyName?, phone? }
// Output: { companyName, companyPhone, companyAddress, companyWebsite,
//           registryId, jurisdiction, method }
//
// Called by the onboarding page when the user reaches Step 2.
// Results carry confidence + source for ConfidenceBadge UX.
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { lookupBusiness } from '@/lib/satellite/businessRegistry';
import type { BusinessRegistryResult } from '@/lib/satellite/types';

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req);
  if (_auth.response) return _auth.response;

  // RATE LIMIT: Business registry lookups involve external API calls
  const _rl = await checkRateLimit('satellite', getClientIp(req));
  if (!_rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const { email, companyName, phone } = body as {
      email?: string;
      companyName?: string;
      phone?: string;
    };

    // At least one lookup parameter is required
    if (!email && !companyName) {
      return NextResponse.json(
        { success: false, error: 'email or companyName is required' },
        { status: 400 },
      );
    }

    const result: BusinessRegistryResult = await lookupBusiness({
      email,
      companyName,
      phone,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[business-lookup] Lookup failed: ${msg}`);
    return NextResponse.json(
      { success: false, error: 'Business lookup failed. Please try again.' },
      { status: 500 },
    );
  }
}
