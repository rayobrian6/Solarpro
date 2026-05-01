export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/**
 * GET /api/crews — List crews for current user
 */
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sql = await getDbReady();

    const rows = await sql`
      SELECT id, name, color, created_at
      FROM crews
      WHERE user_id = ${user.id}
      ORDER BY name ASC
    `;

    return NextResponse.json({ crews: rows });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/crews]', error);
  }
}

/**
 * POST /api/crews — Create a new crew
 * Body: { name, color? }
 */
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, color } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // SECURITY: field length caps
    if (name.trim().length > 100) return NextResponse.json({ error: 'name too long (max 100).'  }, { status: 400 });
    if (color && typeof color === 'string' && color.length > 20) return NextResponse.json({ error: 'color too long (max 20).' }, { status: 400 });

    const sql = await getDbReady();

    const [row] = await sql`
      INSERT INTO crews (user_id, name, color)
      VALUES (${user.id}, ${name.trim()}, ${color || null})
      RETURNING *
    `;

    return NextResponse.json({ crew: row }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/crews]', error);
  }
}

/**
 * DELETE /api/crews — Delete a crew by id (passed as query param)
 * Query: ?id=uuid
 */
export async function DELETE(req: NextRequest) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    // SECURITY: UUID validation
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid crew ID.' }, { status: 400 });

    const sql = await getDbReady();

    const [row] = await sql`
      DELETE FROM crews
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;
    if (!row) return NextResponse.json({ error: 'Crew not found' }, { status: 404 });

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return handleRouteDbError('[DELETE /api/crews]', error);
  }
}