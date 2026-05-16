export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/clients/[id]/notes — list notes for a client */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = await getDbReady();

    // Verify ownership
    const clientRows = await sql`SELECT id FROM clients WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL LIMIT 1`;
    if (!clientRows[0]) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const notes = await sql`
      SELECT id, client_id, note, created_at
      FROM client_notes
      WHERE client_id = ${id} AND user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ success: true, data: notes });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/clients/[id]/notes]', err);
  }
}

/** POST /api/clients/[id]/notes — add a note */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length < 1) {
      return NextResponse.json({ success: false, error: 'Note cannot be empty' }, { status: 400 });
    }
    if (note.length > 2000) {
      return NextResponse.json({ success: false, error: 'Note too long (max 2000 chars)' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership
    const clientRows = await sql`SELECT id FROM clients WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL LIMIT 1`;
    if (!clientRows[0]) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const [created] = await sql`
      INSERT INTO client_notes (client_id, user_id, note)
      VALUES (${id}, ${user.id}, ${note})
      RETURNING id, client_id, note, created_at
    `;
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/clients/[id]/notes]', err);
  }
}

/** DELETE /api/clients/[id]/notes?noteId=uuid — delete a note */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const noteId = req.nextUrl.searchParams.get('noteId');
    if (!noteId || !isValidUUID(noteId)) {
      return NextResponse.json({ success: false, error: 'Valid noteId query param required' }, { status: 400 });
    }

    const sql = await getDbReady();
    const result = await sql`
      DELETE FROM client_notes
      WHERE id = ${noteId} AND client_id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;
    if (!result[0]) return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/clients/[id]/notes]', err);
  }
}
