export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

/**
 * PATCH /api/commands/[id] — Complete or snooze a command
 * Body: { action: 'complete' | 'snooze', snooze_days?: number }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('commands', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // SECURITY: UUID validation — prevent injection via route parameter
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid command ID.' }, { status: 400 });
    }

    const body = await req.json();
    const { action, snooze_days } = body;

    // SECURITY: action allowlist
    if (!action || !['complete', 'snooze'].includes(action)) {
      return NextResponse.json({ error: 'action must be "complete" or "snooze"' }, { status: 400 });
    }

    const sql = await getDbReady();

    if (action === 'complete') {
      const [row] = await sql`
        UPDATE command_center_actions
        SET status = 'completed', completed_at = NOW()
        WHERE id = ${id} AND user_id = ${user.id}
        RETURNING *
      `;
      if (!row) return NextResponse.json({ error: 'Command not found' }, { status: 404 });
      return NextResponse.json({ command: row });
    }

    // Snooze: push due_date forward — snooze_days clamped [1, 30]
    const days = Math.min(Math.max(snooze_days || 1, 1), 30);
    const [row] = await sql`
      UPDATE command_center_actions
      SET due_date = COALESCE(due_date, CURRENT_DATE) + ${days}
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING *
    `;
    if (!row) return NextResponse.json({ error: 'Command not found' }, { status: 404 });
    return NextResponse.json({ command: row });
  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/commands/[id]]', error);
  }
}

/**
 * DELETE /api/commands/[id] — Delete a command
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('commands', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // SECURITY: UUID validation — prevent injection via route parameter
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid command ID.' }, { status: 400 });
    }

    const sql = await getDbReady();

    const [row] = await sql`
      DELETE FROM command_center_actions
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;
    if (!row) return NextResponse.json({ error: 'Command not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return handleRouteDbError('[DELETE /api/commands/[id]]', error);
  }
}