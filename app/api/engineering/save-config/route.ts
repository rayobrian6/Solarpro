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
 *
 * Self-healing:
 *   - If engineering_config column is missing (migration not run), this route
 *     adds the column automatically and retries the save. No manual migration needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const MAX_CONFIG_BYTES = 256 * 1024; // 256 KB — well above any realistic config

async function doSave(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  projectId: string,
  userId: string,
  configJson: string,
) {
  return sql`
    UPDATE projects
    SET
      engineering_config     = ${configJson}::jsonb,
      engineering_updated_at = NOW()
    WHERE id      = ${projectId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id, engineering_updated_at
  `;
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

    // ── Serialize config ──────────────────────────────────────────────────────
    // Neon tagged-template driver does not auto-serialize complex objects as
    // JSONB. Must JSON.stringify + ::jsonb cast — same pattern used by every
    // other JSONB column in this codebase (proposals, engineering_seed, etc.)
    const configJson = JSON.stringify(config);

    // ── Save with self-healing column creation ────────────────────────────────
    // If the migration has not been run yet, the first attempt throws
    // "column engineering_config does not exist". We catch that specific error,
    // add the columns inline, then retry — no manual /api/migrate call needed.
    const sql = await getDbReady();
    let result;
    try {
      result = await doSave(sql, projectId, user.id, configJson);
    } catch (firstErr: unknown) {
      const msg = (firstErr as Error)?.message ?? '';
      if (msg.includes('engineering_config') || msg.includes('column') || msg.includes('does not exist')) {
        // Column missing — add it now and retry
        console.warn('[save-config] engineering_config column missing — auto-migrating...');
        try {
          await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`;
          await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`;
          console.log('[save-config] Auto-migration complete — retrying save');
        } catch (migErr: unknown) {
          console.error('[save-config] Auto-migration failed:', migErr);
          // Migration itself failed — fall through to original error
          throw firstErr;
        }
        // Retry the save after adding the column
        result = await doSave(sql, projectId, user.id, configJson);
      } else {
        throw firstErr;
      }
    }

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
    console.error('[POST /api/engineering/save-config] Unhandled error:', err);
    return handleRouteDbError('[POST /api/engineering/save-config]', err);
  }
}