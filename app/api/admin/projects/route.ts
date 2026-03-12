import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// GET /api/admin/projects?search=&page=&limit=
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const page   = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') || '25'));
  const offset = (page - 1) * limit;

  try {
    const sql = await getDbReady();
    const pattern = `%${search}%`;

    const [rows, countRows] = await Promise.all([
      sql`
        SELECT p.id, p.name, p.address, p.system_size_kw, p.created_at,
               u.name AS owner_name, u.email AS owner_email,
               c.name AS client_name
        FROM projects p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.name ILIKE ${pattern}
           OR p.address ILIKE ${pattern}
           OR u.name ILIKE ${pattern}
           OR u.email ILIKE ${pattern}
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*) AS total FROM projects p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.name ILIKE ${pattern}
           OR p.address ILIKE ${pattern}
           OR u.name ILIKE ${pattern}
           OR u.email ILIKE ${pattern}
      `,
    ]);

    return NextResponse.json({
      success: true,
      projects: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/projects/route.ts]', e);
  }
}

// PATCH /api/admin/projects
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const { id, action, userId } = await req.json();
    if (!id || !action) return NextResponse.json({ success: false, error: 'Missing id or action' }, { status: 400 });

    if (action === 'delete') {
      await sql`DELETE FROM projects WHERE id = ${id}`;
    } else if (action === 'reassign') {
      if (!userId) return NextResponse.json({ success: false, error: 'Missing userId for reassign' }, { status: 400 });
      await sql`UPDATE projects SET user_id = ${userId} WHERE id = ${id}`;
    } else {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/projects/route.ts]', e);
  }
}