// ============================================================================
// /api/projects/[id]/survey-handoff — DISABLED
//
// This route previously minted a handoff JWT to initiate a survey from SolarPro.
// Per MASTER DIRECTIVE (field-first architecture), SolarPro does NOT initiate
// surveys. Surveys are initiated exclusively by the mobile app.
//
// This route now returns 410 Gone so any stale callers get a clear signal.
// The route file is retained (not deleted) to prevent Next.js 404 noise on
// any cached/bookmarked calls during the transition period.
// ============================================================================

export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Survey initiation from SolarPro is no longer supported. ' +
             'Surveys are started from the mobile field app. ' +
             'Survey data is received via webhook and displayed here automatically.',
      code: 'SURVEY_INITIATION_DISABLED',
    },
    { status: 410 },
  );
}