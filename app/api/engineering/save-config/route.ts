export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * POST /api/engineering/save-config
 *
 * Persists the full engineering workspace config for a project so the
 * engineering page can restore it exactly on reload, navigation, or return.
 *
 * Body: { projectId: string; config: Record<string, unknown> }
 *
 * Security:
 *   - Requires authenticated session (getUserFromRequest)
 *   - Validates project ownership (WHERE user_id = userId) — no IDOR
 *   - Rate limited (light — 60 req/min per IP)
 *   - Rejects payloads > 256 KB
 *   - Rejects empty configs (prevents accidental blank overwrites)
 *   - UUID validation on projectId
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const MAX_CONFIG_BYTES = 256 * 1024; // 256 KB — well above any realistic config

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit (light) ──────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    // ── Body size guard ─────────────────────────────────────────────────────
    const rawBody = await req.text();
    if (rawBody.length > MAX_CONFIG_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Config payload too large (max 256 KB).' },
        { status: 413 }
      );
    }

    // ── Parse JSON ──────────────────────────────────────────────────────────
    let body: { projectId?: unknown; config?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    // ── Validate projectId ──────────────────────────────────────────────────
    const { projectId, config } = body;
    if (!projectId || typeof projectId !== 'string' || !isValidUUID(projectId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing projectId.' },
        { status: 400 }
      );
    }

    // ── Validate config ─────────────────────────────────────────────────────
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      Object.keys(config as object).length === 0
    ) {
      return NextResponse.json(
        { success: false, error: 'Config must be a non-empty object.' },
        { status: 400 }
      );
    }

    // ── Save (ownership enforced by WHERE user_id = userId) ─────────────────
    const sql = await getDbReady();
    const result = await sql`
      UPDATE projects
      SET
        engineering_config     = ${config as Record<string, unknown>},
        engineering_updated_at = NOW()
      WHERE id      = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      RETURNING id, engineering_updated_at
    `;

    if (result.length === 0) {
      // Either project doesn't exist or belongs to another user — same 404 response
      // (don't reveal which, prevents enumeration)
      return NextResponse.json(
        { success: false, error: 'Project not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      savedAt: result[0].engineering_updated_at,
    });

  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/engineering/save-config]', err);
  }
}