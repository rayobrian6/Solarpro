/**
 * GET /api/admin/debug/owner-resolver-probe?user_id=<uuid>
 *
 * Admin-gated. Calls the REAL resolveIngestOwner() with the given user_id
 * and reports what it would return. Used to diagnose "projects end up under
 * default user instead of claimed user" bugs without needing to actually
 * send a webhook.
 *
 * Also surfaces deleted_at and role so we can see WHY a claim might be
 * rejected by the resolver's "AND deleted_at IS NULL" filter.
 *
 * GATE: requireAdminApi() - session cookie + DB-role=admin/super_admin
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady } from '@/lib/db-neon';
import { resolveIngestOwner } from '@/lib/survey/ingest/ownerResolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const userId = req.nextUrl.searchParams.get('user_id')?.trim() || '';
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'Valid ?user_id= query param required' },
      { status: 400 }
    );
  }

  // 1. Raw DB row inspection — what does the `users` table actually say?
  let rawRow: Record<string, unknown> | null = null;
  let rawError: string | null = null;
  try {
    const sql = await getDbReady();
    const colRows = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `;
    const cols = new Set<string>(
      (colRows as Array<{ column_name: string }>).map((r) => r.column_name)
    );
    const hasDeletedAt = cols.has('deleted_at');

    // Full-row select without filtering — bypasses the resolver's "deleted_at IS NULL"
    // so we can see WHY the resolver might reject it.
    const rows = hasDeletedAt
      ? await sql`
          SELECT id, email, role, created_at, updated_at, deleted_at
          FROM users
          WHERE id = ${userId}
          LIMIT 1
        `
      : await sql`
          SELECT id, email, role, created_at, updated_at,
                 NULL::timestamptz AS deleted_at
          FROM users
          WHERE id = ${userId}
          LIMIT 1
        `;
    if (rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      rawRow = {
        id: row.id,
        email_masked: typeof row.email === 'string' ? row.email.replace(/(.).*@/, '$1***@') : null,
        role: row.role,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        is_soft_deleted: row.deleted_at !== null && row.deleted_at !== undefined,
      };
    }
  } catch (err) {
    rawError = err instanceof Error ? err.message : String(err);
  }

  // 2. Actually call the resolver and see what it returns
  const traceId = `probe-${Date.now()}`;
  let resolution: unknown = null;
  let resolverError: string | null = null;
  try {
    resolution = await resolveIngestOwner(userId, traceId);
  } catch (err) {
    resolverError = err instanceof Error ? err.message : String(err);
  }

  const defaultUserId = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() || null;

  return NextResponse.json({
    ok: true,
    probe: {
      queried_user_id: userId,
      traceId,
    },
    raw_users_row: rawRow,
    raw_error: rawError,
    resolver_result: resolution,
    resolver_error: resolverError,
    env: {
      default_user_id_set: !!defaultUserId,
      default_user_id_matches_admin: defaultUserId === admin.id,
      default_user_id_matches_queried: defaultUserId === userId,
    },
    verdict:
      resolution && typeof resolution === 'object' && 'ownerSource' in resolution
        ? (resolution as { ownerSource: string }).ownerSource === 'claim'
          ? '✅ claim honored — project would be owned by queried user'
          : `⚠️ fell back to ${(resolution as { ownerSource: string }).ownerSource} — project would NOT be owned by queried user`
        : '❌ resolver returned null or errored — see resolver_error',
    caller: {
      admin_id: admin.id,
      admin_role: admin.role,
    },
  });
}