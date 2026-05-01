export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security';

/**
 * GET /api/solardog/debug
 *
 * Diagnostic endpoint for the SolarDog memory system.
 * Returns:
 *   - Whether the solardog_conversations table exists
 *   - Row count for the authenticated user
 *   - Last 5 turns (redacted to 80 chars)
 *   - DB connection status
 *
 * Only accessible to authenticated users. Intended for debugging
 * "no previous conversations" issues.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.response) return auth.response;
  const user = auth.user!;

  const results: Record<string, unknown> = {
    userId: user.id,
    timestamp: new Date().toISOString(),
  };

  try {
    // Dynamically import to avoid breaking at build time if DB is unavailable
    const { getDbReady } = await import('@/lib/db-neon');
    const sql = await getDbReady();
    results.dbConnected = true;

    // Check if table exists
    try {
      const tableCheck = await sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'solardog_conversations'
        ) AS exists
      `;
      results.tableExists = (tableCheck[0] as any)?.exists === true;
    } catch (e) {
      results.tableExists = false;
      results.tableCheckError = (e as Error)?.message;
    }

    if (results.tableExists) {
      // Row count for this user
      try {
        const countRows = await sql`
          SELECT COUNT(*)::int AS cnt
          FROM solardog_conversations
          WHERE user_id = ${user.id}
        `;
        results.userRowCount = (countRows[0] as any)?.cnt ?? 0;
      } catch (e) {
        results.userRowCountError = (e as Error)?.message;
      }

      // Total row count
      try {
        const totalRows = await sql`
          SELECT COUNT(*)::int AS cnt FROM solardog_conversations
        `;
        results.totalRowCount = (totalRows[0] as any)?.cnt ?? 0;
      } catch (e) {
        results.totalRowCountError = (e as Error)?.message;
      }

      // Last 5 turns for this user (truncated content)
      try {
        const history = await sql`
          SELECT id, project_id, page, role, LEFT(content, 80) AS content_preview, created_at
          FROM solardog_conversations
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
          LIMIT 5
        `;
        results.lastTurns = history.map((r: any) => ({
          id:       r.id,
          page:     r.page,
          role:     r.role,
          preview:  r.content_preview,
          created:  r.created_at,
        }));
      } catch (e) {
        results.lastTurnsError = (e as Error)?.message;
      }
    }

  } catch (e) {
    results.dbConnected = false;
    results.dbError = (e as Error)?.message ?? String(e);
  }

  return NextResponse.json({ success: true, debug: results });
}