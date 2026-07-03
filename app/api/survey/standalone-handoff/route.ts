// ============================================================================
// /api/survey/standalone-handoff — DISABLED
//
// This route previously minted a standalone survey JWT for field workers to
// self-initiate surveys from SolarPro. Per MASTER DIRECTIVE (field-first
// architecture), SolarPro does NOT initiate surveys. The mobile app owns the
// full survey flow including standalone initiation.
//
// Returns 410 Gone to signal stale callers clearly.
// ============================================================================

export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Standalone survey initiation from SolarPro is no longer supported. ' +
             'The mobile app handles survey initiation and client/project selection.',
      code: 'SURVEY_INITIATION_DISABLED',
    },
    { status: 410 },
  );
}