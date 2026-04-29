export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

const MAX_CONFIG_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      console.error('[save-config] FAIL: no user session');
      return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const rawBody = await req.text();
    if (rawBody.length > MAX_CONFIG_BYTES) {
      console.error('[save-config] FAIL: payload too large', rawBody.length);
      return NextResponse.json({ success: false, error: 'Config payload too large (max 256 KB).' }, { status: 413 });
    }

    let body: { projectId?: unknown; config?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[save-config] FAIL: invalid JSON');
      return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const { projectId, config } = body;

    if (!projectId || typeof projectId !== 'string' || !isValidUUID(projectId)) {
      console.error('[save-config] FAIL: invalid projectId', projectId);
      return NextResponse.json({ success: false, error: 'Invalid or missing projectId.' }, { status: 400 });
    }

    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config as object).length === 0) {
      console.error('[save-config] FAIL: invalid config', typeof config);
      return NextResponse.json({ success: false, error: 'Config must be a non-empty object.' }, { status: 400 });
    }

    const configJson = JSON.stringify(config);
    console.info('[save-config] attempting save', { projectId, userId: user.id, configBytes: configJson.length });

    // ── Ensure column exists, then save ──────────────────────────────────────
    const sql = await getDbReady();

    // Always ensure columns exist (idempotent, fast no-op if already there)
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`;
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`;
    } catch (alterErr: unknown) {
      console.warn('[save-config] ALTER TABLE warning (non-fatal):', (alterErr as Error)?.message);
    }

    // Save
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
      console.error('[save-config] FAIL: project not found or ownership mismatch', { projectId, userId: user.id });
      return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });
    }

    console.info('[save-config] SUCCESS', { projectId, savedAt: result[0].engineering_updated_at });
    return NextResponse.json({ success: true, savedAt: result[0].engineering_updated_at });

  } catch (err: unknown) {
    console.error('[save-config] UNHANDLED ERROR:', (err as Error)?.message, err);
    return handleRouteDbError('[POST /api/engineering/save-config]', err);
  }
}