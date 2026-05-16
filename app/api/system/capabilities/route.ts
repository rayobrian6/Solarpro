// ============================================================================
// v47.434c Stage 9.1c — Cross-System Capabilities Endpoint
//
// GET /api/system/capabilities
//
// Public, unauthenticated contract-introspection endpoint.
//
// Purpose: give the partner (and any future integrator) a pull-based way to
// discover SolarPro's current wire contract without reading our source code.
// Designed to be polled on a cron or per-webhook-delivery, with ETag support
// so well-behaved clients can short-circuit unchanged state.
//
// Non-goals:
//   - Not a deploy notification channel (no push; use GET /api/system/release
//     for release history polling).
//   - Not a secret-bearing endpoint (all fields are public-safe; no HMAC
//     secrets, no URLs containing tokens, no JWT private keys).
//   - Not versioned independently — version is pinned to BUILD_VERSION.
//     Breaking changes to this response shape require a release-level bump.
//
// v47.435 will extend this with outbound handoff JWT config (algorithm, TTL,
//   issuer claim) once that work ships.
// v47.436+ may add an outbound webhook section (the partner will then know
//   which events we emit back to them).
//
// Implementation lives in lib/system/capabilities.ts (Next.js disallows
// non-reserved exports from app/api route files).
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { BUILD_VERSION, BUILD_FEATURES } from '@/lib/version';
import {
  buildCapabilitiesPayload,
  buildCapabilitiesEtag,
} from '@/lib/system/capabilities';

export async function GET(req: Request): Promise<NextResponse> {
  const payload = buildCapabilitiesPayload();
  const etag = buildCapabilitiesEtag(payload);

  // Conditional GET support — 304 on match.
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
    });
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      ETag: etag,
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Producer-Version': BUILD_VERSION,
      'X-Feature-Count': String(BUILD_FEATURES.length),
    },
  });
}