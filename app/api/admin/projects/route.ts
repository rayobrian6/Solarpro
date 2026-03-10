import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const page   = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;

  const sql = getDb();

  const [rows, countRows] = await Promise.all([
    search
      ? sql`SELECT p.id, p.name, p.address, p.status, p.system_type, p.system_size_kw,
                   p.created_at, p.deleted_at,
                   u.name AS owner_name, u.email AS owner_email, u.company AS owner_company,
                   c.name AS client_name
            FROM projects p
            LEFT JOIN users u ON u.id = p.user_id
            LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.name ILIKE ${'%'+search+'%'} OR p.address ILIKE ${'%'+search+'%'}
               OR u.name ILIKE ${'%'+search+'%'} OR u.email ILIKE ${'%'+search+'%'}
               OR c.name ILIKE ${'%'+search+'%'}
            ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`
      : sql`SELECT p.id, p.name, p.address, p.status, p.system_type, p.system_size_kw,
                   p.created_at, p.deleted_at,
                   u.name AS owner_name, u.email AS owner_email, u.company AS owner_company,
                   c.name AS client_name
            FROM projects p
            LEFT JOIN users u ON u.id = p.user_id
            LEFT JOIN clients c ON c.id = p.client_id
            ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    search
      ? sql`SELECT COUNT(*)::int AS total FROM projects p
            LEFT JOIN users u ON u.id = p.user_id
            LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.name ILIKE ${'%'+search+'%'} OR p.address ILIKE ${'%'+search+'%'}
               OR u.name ILIKE ${'%'+search+'%'} OR u.email ILIKE ${'%'+search+'%'}
               OR c.name ILIKE ${'%'+search+'%'}`
      : sql`SELECT COUNT(*)::int AS total FROM projects`,
  ]);

  return NextResponse.json({ success: true, data: rows, total: countRows[0].total, page, limit });
}

export async function PATCH(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { projectId, action, newOwnerId } = await req.json();
  if (!projectId) return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });

  const sql = getDb();

  if (action === 'reassign' && newOwnerId) {
    await sql`UPDATE projects SET user_id=${newOwnerId}, updated_at=NOW() WHERE id=${projectId}`;
  } else if (action === 'restore') {
    await sql`UPDATE projects SET deleted_at=NULL, updated_at=NOW() WHERE id=${projectId}`;
  } else if (action === 'delete') {
    await sql`UPDATE projects SET deleted_at=NOW() WHERE id=${projectId}`;
  }

  return NextResponse.json({ success: true });
}
