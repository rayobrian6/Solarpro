// ============================================================================
// POST /api/survey/standalone-handoff
//
// v47.438 - Mints a standalone survey handoff JWT for field workers who need
// to start a survey without a project pre-selected.
//
// This is the "self-initiated" survey entry point. The field worker is already
// authenticated via the mobile SSO flow (/api/auth/mobile-session +
// sitesurvey://login?token=<jwt>). Their session cookie is included in the
// request automatically.
//
// The returned JWT contains:
//   project_id: "__standalone__"
//   standalone: true
//   solarpro_user_id: the authenticated user's ID
//   inspector_name: body.inspectorName or user.name
//   exp: now + STANDALONE_HANDOFF_TTL_SECONDS (default 24h)
//
// The survey app receives this JWT, opens /survey/<token>, sees standalone=true
// in the claims, and presents a client/project picker on Step 1 before the
// field worker can advance.
//
// Auth: Session cookie required (getUserFromRequest).
// Rate limit: standard.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { mintHandoffToken, buildStandaloneDeepLink } from '@/lib/survey/handoff/tokenMinter';
import { STANDALONE_PROJECT_ID } from '@/lib/survey/v2/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function POST(req: NextRequest) {
  // -- Rate limit ------------------------------------------------------------
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  // -- Auth ------------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 },
    );
  }

  // -- Body (optional) -------------------------------------------------------
  let inspectorName: string = user.name ?? '';
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.inspectorName === 'string' && body.inspectorName.trim()) {
      inspectorName = body.inspectorName.trim();
    }
  } catch {
    // body is optional — no-op
  }

  // -- Mint token ------------------------------------------------------------
  const result = mintHandoffToken({
    project_id: STANDALONE_PROJECT_ID,
    standalone: true,
    solarpro_user_id: user.id,
    solarpro_email: user.email,
    solarpro_name: user.name ?? '',
    inspector_name: inspectorName || undefined,
  });

  if (!result.ok) {
    const errResult = result as { ok: false; error: string };
    console.error(`[standalone-handoff] mint failed: ${errResult.error}`);
    return NextResponse.json(
      { success: false, error: 'Failed to mint survey token. Check server configuration.' },
      { status: 500 },
    );
  }

  const deepLink = buildStandaloneDeepLink(result.token);

  console.log(
    `[standalone-handoff] minted token for userId=${user.id} jti=${result.jti} exp=${result.exp}`,
  );

  return NextResponse.json(
    {
      success: true,
      token: result.token,
      deepLink,
      jti: result.jti,
      exp: result.exp,
    },
    { status: 200 },
  );
}