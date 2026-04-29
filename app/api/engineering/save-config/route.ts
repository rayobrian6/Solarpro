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

const MAX_CONFIG_BYTES = 256 * 1024; // 256 KB

// Track whether we've verified the columns exist in this function instance.
// ALTER TABLE IF NOT EXISTS is a no-op when column exists, but we only want
// to pay that cost once per cold start, not once per request.
let columnsVerified = false;

async function ensureColumns(sql: Awaited<ReturnType<typeof getDbReady>>) {
  if (columnsVerified) return;
  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`;
    columnsVerified = true;
    console.log('[save-config] engineering_config columns verified/created');
  } catch (e: unknown) {
    // Non-fatal: if ALTER fails for any reason, attempt the UPDATE anyway.
    // The UPDATE will give a clear error if the column truly doesn't exist.
    console.warn('[save-config] ensureColumns warning:', (e as Error)?.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    // ── Body size guard ───────────────────────────────────────────────────────
    const rawBody = await req.text();
    if (rawBody.length > MAX_CONFIG_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Config payload too large (max 256 KB).' },
        { status: 413 }
      );
    }

    // ── Parse JSON ────────────────────────────────────────────────────────────
    let body: { projectId?: unknown; config?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    // ── Validate projectId ────────────────────────────────────────────────────
    const { projectId, config } = body;
    if (!projectId || typeof projectId !== 'string' || !isValidUUID(projectId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing projectId.' },
        { status: 400 }
      );
    }

    // ── Validate config ───────────────────────────────────────────────────────
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

    // ── Serialize ─────────────────────────────────────────────────────────────
    // Neon tagged-template driver requires JSON.stringify + ::jsonb cast for
    // JSONB columns — same pattern as proposals, engineering_seed, etc.
    const configJson = JSON.stringify(config);

    // ── Ensure columns exist (self-healing, once per cold start) ──────────────
    const sql = await getDbReady();
    await ensureColumns(sql);

    // ── Save ──────────────────────────────────────────────────────────────────
    const result = await sql`
      UPDATE projects
      SET
        engineering_config     = ${configJson}::jsonb,
        engineering_updated_at = NOW()
      WHERE id      = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      RETURNING id, engineering_updated_at
    `;

    if (result.length === 0) {
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
    console.error('[POST /api/engineering/save-config] Error:', err);
    return handleRouteDbError('[POST /api/engineering/save-config]', err);
  }
}