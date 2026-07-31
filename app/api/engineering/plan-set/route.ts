// ============================================================
// /api/engineering/plan-set — RETIRED (W4 §6)
//
// This route was a SECOND, snapshot-blind planset generator: it built its
// own G-1/E-1/E-2/S-1/A-1/M-1/C-1 sheets and independently declared
// structuralStatus / overallCompliance without ever consuming or validating a
// canonical PermitDesignSnapshot. W3.1 §3 contained it (fail-closed to a
// LEGACY — NOT FOR PERMIT state); W4 §6 removes it permanently.
//
// There is exactly ONE production planset authority now:
//   POST /api/engineering/permit  (lib/permit/generatePermit.ts → PermitDesignSnapshot)
//
// The dead sheet builders (cover-sheet, electrical-sheet, structural-sheet,
// equipment-schedule, site-layout-sheet, mounting-details-sheet,
// compliance-sheet, title-block) and the interim legacy-path-guard have been
// deleted. Nothing may generate a permit artifact from this path again. Any
// caller must migrate to /api/engineering/permit.
//
// The route is retained ONLY as an explicit HTTP 410 Gone tombstone so a stale
// caller receives a self-documenting pointer instead of an opaque 404, and so
// the retirement is directly testable.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GONE_BODY = {
  success: false,
  error: 'GONE',
  code: 'PLAN_SET_ROUTE_RETIRED',
  message:
    'The legacy /api/engineering/plan-set generator has been retired (W4 §6). ' +
    'Use POST /api/engineering/permit — the single canonical permit/planset generator.',
  canonicalRoute: '/api/engineering/permit',
} as const;

function gone(): NextResponse {
  return NextResponse.json(GONE_BODY, {
    status: 410,
    headers: {
      'X-Plan-Set-Retired': 'true',
      'X-Canonical-Route': '/api/engineering/permit',
    },
  });
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return gone();
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  return gone();
}
