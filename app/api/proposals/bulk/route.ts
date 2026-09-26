export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ── Issued-artifact rule ─────────────────────────────────────────────────────
// Mirrors app/api/proposals/[id]/route.ts. A signed proposal is an executed
// contract; `status` is checked alongside `signed_at` so a database predating
// migration 020 is still covered.
const TERMINAL_STATUSES = new Set(['accepted', 'signed']);

function isIssued(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.signed_at) return true;
  return typeof row.status === 'string' && TERMINAL_STATUSES.has(row.status);
}

// POST /api/proposals/bulk
// Body: { action: 'delete' | 'archive' | 'status' | 'clear_test', ids?: string[], status?: string }
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      action: 'delete' | 'archive' | 'status' | 'clear_test';
      ids?: string[];
      status?: string;
    };

    const { action, ids, status } = body;
    const sql = await getDbReady();

    // ── clear_test: delete all proposals with viewCount = 0 owned by user ──
    if (action === 'clear_test') {
      const result = await sql`
        DELETE FROM proposals
        WHERE user_id = ${user.id}
          AND (data_json->>'viewCount')::int = 0
        RETURNING id
      `;
      return NextResponse.json({ success: true, deleted: result.length });
    }

    // All other actions require ids
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400 });
    }

    // Validate all IDs — filter out anything that isn't a valid UUID
    const validIds = ids.filter(isValidUUID);
    if (validIds.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid UUIDs provided' }, { status: 400 });
    }

    // Safety cap — prevent runaway requests (ownership check is the real guard)
    if (validIds.length > 200) {
      return NextResponse.json({ success: false, error: 'Maximum 200 proposals per bulk action' }, { status: 400 });
    }

    if (action === 'delete') {
      // Delete one-by-one to avoid driver issues with large UUID arrays
      // Ownership is checked on every row — safe against cross-user attacks
      let deleted = 0;
      for (const id of validIds) {
        const result = await sql`
          DELETE FROM proposals
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id
        `;
        if (result.length > 0) deleted++;
      }
      return NextResponse.json({ success: true, deleted });
    }

    if (action === 'archive') {
      // ── Archiving is FILING, not a content change ────────────────────────
      //
      // 🚨 THIS BRANCH USED TO OVERWRITE `data_json.status` WITH 'archived' ON
      // ANY ROW, INCLUDING AN EXECUTED CONTRACT. `rowToProposal`
      // (app/api/proposals/route.ts) reads a proposal's status from that field
      // and nowhere else, so a signed contract read "Archived" on every screen
      // in the website, and the value it replaced was not recorded anywhere —
      // un-archiving was a guess.
      //
      // Refusing to archive a signed proposal would be the wrong fix: "I am done
      // looking at this" is a statement about the user's list, not about the
      // agreement, and the signed ones are exactly what an installer most wants
      // out of the way. So the filing fact moves OFF the status field:
      //
      //   • `archivedAt` is written on every archive — one place, both kinds.
      //   • `status` is additionally set only when the row is NOT an executed
      //     contract, which is byte-for-byte what those rows did before.
      //
      // The response names the rows whose status was preserved so the client can
      // paint what actually changed instead of assuming.
      //
      // 🚨 OPEN, and deliberately not fixed from here: `rowToProposal` does not
      // map `archivedAt` and `Proposal` (types/index.ts) has no field for it, so
      // an archived executed contract still appears in the active list after a
      // reload — it genuinely is still 'accepted'. Surfacing `archivedAt` there
      // is the follow-up. Erasing the contract status to make the row vanish is
      // what this change exists to stop.
      const archivedAtJson       = JSON.stringify(new Date().toISOString());
      const archivedIds: string[]         = [];
      const statusPreservedIds: string[]  = [];
      for (const id of validIds) {
        // Queried per id with the same `.catch()` fallback the status branch
        // uses, so a database predating migration 020 (no `signed_at`) archives
        // rather than 503-ing the whole batch.
        const guard = await sql`
          SELECT id, status, signed_at FROM proposals
          WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
        `.catch(() => sql`
          SELECT id, status FROM proposals
          WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
        `);
        const row = (guard as Array<Record<string, unknown>>)[0];
        if (!row) continue;   // not found, or not this user's — ownership stands

        const issued = isIssued(row);
        const result = issued
          ? await sql`
              UPDATE proposals
              SET data_json  = jsonb_set(data_json, '{archivedAt}', ${archivedAtJson}::jsonb),
                  updated_at = NOW()
              WHERE id = ${id} AND user_id = ${user.id}
              RETURNING id
            `
          : await sql`
              UPDATE proposals
              SET data_json  = jsonb_set(
                    jsonb_set(data_json, '{archivedAt}', ${archivedAtJson}::jsonb),
                    '{status}', '"archived"'),
                  updated_at = NOW()
              WHERE id = ${id} AND user_id = ${user.id}
              RETURNING id
            `;
        if ((result as unknown[]).length > 0) {
          archivedIds.push(id);
          if (issued) statusPreservedIds.push(id);
        }
      }
      return NextResponse.json({
        success:            true,
        updated:            archivedIds.length,
        archivedIds,
        statusPreserved:    statusPreservedIds.length,
        statusPreservedIds,
        ...(statusPreservedIds.length > 0
          ? { statusPreservedReason: 'Archived, but the status was kept — these are signed proposals.' }
          : {}),
      });
    }

    if (action === 'status') {
      const allowedStatuses = ['draft', 'sent', 'viewed', 'signed', 'accepted', 'rejected', 'archived'];
      if (!status || !allowedStatuses.includes(status)) {
        return NextResponse.json({ success: false, error: 'Invalid status value' }, { status: 400 });
      }
      const safeStatus = JSON.stringify(status);
      // 🚨 THE IDS, NOT ONLY THE COUNTS. `{ updated: 2, skipped: 1 }` tells the
      // client that something in its selection did not move but not WHICH, so the
      // page had no way to repaint honestly and painted everything — a signed
      // proposal visibly became a draft until the next reload. The ids are
      // already in hand, one per iteration.
      const updatedIds: string[] = [];
      const skippedIds: string[] = [];
      for (const id of validIds) {
        // An executed contract's status is frozen — a bulk selection must not
        // be able to set a signed proposal back to draft. Skipped rather than
        // failing the whole batch, so selecting one signed proposal among
        // twenty drafts still does the useful work; the count reports it.
        // Queried per id, matching the one-by-one shape the delete branch
        // already uses to avoid driver trouble with large UUID arrays.
        const guard = await sql`
          SELECT id, status, signed_at FROM proposals
          WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
        `.catch(() => sql`
          SELECT id, status FROM proposals
          WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
        `);
        if (isIssued((guard as Array<Record<string, unknown>>)[0])) {
          skippedIds.push(id);
          continue;
        }

        const result = await sql`
          UPDATE proposals
          SET data_json = jsonb_set(data_json, '{status}', ${safeStatus}::jsonb),
              updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id
        `;
        if (result.length > 0) updatedIds.push(id);
      }
      return NextResponse.json({
        success: true,
        updated: updatedIds.length,
        skipped: skippedIds.length,
        updatedIds,
        skippedIds,
        // The page has to put something in front of the user, and "1 skipped" is
        // not a sentence anyone can act on.
        ...(skippedIds.length > 0
          ? { skippedReason: 'Signed proposals keep their status — an executed contract cannot be restatused.' }
          : {}),
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/proposals/bulk]', err);
  }
}