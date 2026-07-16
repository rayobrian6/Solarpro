// ============================================================================
// /api/organizations/features
//
// Phase 1B — Organization Authority Foundation
//
// GET — returns which enterprise organization authority features are enabled.
//
// This endpoint exposes server-side feature flag states to the client so
// the UI can conditionally render the new organization authority interface.
// The flags themselves remain server-side (never exposed as NEXT_PUBLIC
// env vars). This endpoint is the only way the client learns about them.
//
// All flags default to false (disabled). The UI should gracefully fall
// back to the legacy organization panel when all flags are off.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isOrgFeatureEnabled } from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    features: {
      orgAuthority: isOrgFeatureEnabled('ENTERPRISE_ORG_AUTHORITY_ENABLED'),
      membershipWrite: isOrgFeatureEnabled('ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED'),
      activeOrgContext: isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED'),
      authzEnforcement: isOrgFeatureEnabled('ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED'),
    },
  });
}
