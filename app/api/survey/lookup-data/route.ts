// ============================================================================
// /api/survey/lookup-data — DISABLED
//
// This route previously served client/project lists to the on-device picker
// in SolarPro-initiated standalone surveys (via handoff JWT).
// Per MASTER DIRECTIVE (field-first architecture), the mobile app owns
// client/project selection. Use GET /api/mobile/clients and
// GET /api/mobile/clients/:clientId/projects instead.
//
// Returns 410 Gone to signal stale callers clearly.
// ============================================================================

export const maxDuration = 30;

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is no longer active. ' +
             'Use GET /api/mobile/clients and GET /api/mobile/clients/:clientId/projects ' +
             'for client/project lookup from the mobile app.',
      code: 'ENDPOINT_DISABLED',
    },
    { status: 410 },
  );
}