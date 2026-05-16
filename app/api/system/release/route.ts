// ============================================================================
// v47.434c Stage 9.1c — Release History Endpoint
//
// GET /api/system/release?limit=N
//
// Public, unauthenticated release-history endpoint. Serves a structured view
// over lib/version.ts → BUILD_FEATURES[] so the partner (and any integrator)
// can poll us to see recent SolarPro releases without reading source code.
//
// Query parameters:
//   limit : optional integer 1..BUILD_FEATURES.length (default: 10)
//
// Non-goals:
//   - Not a deploy-event push (pull-based only; outbound release webhook is
//     designed in the v47.435 scoping doc and deferred until partner exposes
//     a receiver).
//   - Not a capabilities negotiation (see GET /api/system/capabilities for
//     the wire contract).
//
// Implementation: lib/system/releaseHistory.ts (Next.js disallows non-reserved
// exports from app/api route files).
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { BUILD_VERSION } from '@/lib/version';
import { buildReleaseHistory } from '@/lib/system/releaseHistory';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
  const payload = buildReleaseHistory(limit);

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Producer-Version': BUILD_VERSION,
    },
  });
}