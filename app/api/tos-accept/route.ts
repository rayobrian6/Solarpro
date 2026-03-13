export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// Current ToS version — bump this string whenever the document is materially revised
// NOTE: not exported at module level (Next.js route files only allow HTTP method exports)
const CURRENT_TOS_VERSION = 'v1.0';

// ─── POST /api/tos-accept ─────────────────────────────────────────────────────
// Records acceptance of the current ToS/NDA for the authenticated user.
// Body: { version?: string }   (optional — defaults to CURRENT_TOS_VERSION)
// Response: { success: true, tos_accepted_at, tos_version }
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const version: string = body?.version || CURRENT_TOS_VERSION;

    const sql = await getDbReady();

    const rows = await sql`
      UPDATE users
      SET
        tos_accepted_at = NOW(),
        tos_version     = ${version},
        updated_at      = NOW()
      WHERE id = ${user.id}
      RETURNING tos_accepted_at, tos_version
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User not found.' },
        { status: 404 }
      );
    }

    console.log(
      `[TOS_ACCEPTED] userId=${user.id} email=${user.email} version=${rows[0].tos_version} at=${rows[0].tos_accepted_at}`
    );

    return NextResponse.json({
      success:        true,
      tos_accepted_at: rows[0].tos_accepted_at,
      tos_version:    rows[0].tos_version,
    });
  } catch (error: any) {
    return handleRouteDbError('/api/tos-accept POST', error);
  }
}

// ─── GET /api/tos-accept ──────────────────────────────────────────────────────
// Returns the current user's ToS acceptance status.
// Response: { success: true, accepted: bool, tos_accepted_at, tos_version, current_version, needs_reaccept }
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  try {
    const sql = await getDbReady();

    // Try to select tos columns — if Migration 010 hasn't run yet,
    // columns won't exist; catch the error and return accepted=false gracefully.
    let tos_accepted_at: Date | null = null;
    let tos_version: string | null = null;
    try {
      const rows = await sql`
        SELECT tos_accepted_at, tos_version
        FROM users
        WHERE id = ${user.id}
        LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'User not found.' },
          { status: 404 }
        );
      }
      tos_accepted_at = rows[0].tos_accepted_at ?? null;
      tos_version     = rows[0].tos_version ?? null;
    } catch (colErr: any) {
      // Migration 010 not yet run — columns missing. Return not-accepted gracefully.
      console.warn('[/api/tos-accept GET] tos columns not yet available:', colErr?.message);
    }

    const accepted      = !!tos_accepted_at;
    const needsReaccept = accepted && tos_version !== CURRENT_TOS_VERSION;

    return NextResponse.json({
      success:         true,
      accepted,
      needs_reaccept:  needsReaccept,
      tos_accepted_at: tos_accepted_at ?? null,
      tos_version:     tos_version ?? null,
      current_version: CURRENT_TOS_VERSION,
    });
  } catch (error: any) {
    return handleRouteDbError('/api/tos-accept GET', error);
  }
}