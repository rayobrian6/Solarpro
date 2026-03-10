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
  const page  = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;
  const fileType = searchParams.get('fileType') || '';

  const sql = getDb();

  const [rows, countRows, sizeRow] = await Promise.all([
    fileType
      ? sql`SELECT pf.id, pf.project_id, pf.file_name, pf.file_type, pf.file_size,
                   pf.mime_type, pf.notes, pf.upload_date,
                   u.name AS owner_name, u.email AS owner_email,
                   p.name AS project_name
            FROM project_files pf
            LEFT JOIN users u ON u.id = pf.user_id
            LEFT JOIN projects p ON p.id = pf.project_id
            WHERE pf.file_type = ${fileType}
            ORDER BY pf.upload_date DESC LIMIT ${limit} OFFSET ${offset}`
      : sql`SELECT pf.id, pf.project_id, pf.file_name, pf.file_type, pf.file_size,
                   pf.mime_type, pf.notes, pf.upload_date,
                   u.name AS owner_name, u.email AS owner_email,
                   p.name AS project_name
            FROM project_files pf
            LEFT JOIN users u ON u.id = pf.user_id
            LEFT JOIN projects p ON p.id = pf.project_id
            ORDER BY pf.upload_date DESC LIMIT ${limit} OFFSET ${offset}`,
    fileType
      ? sql`SELECT COUNT(*)::int AS total FROM project_files WHERE file_type=${fileType}`
      : sql`SELECT COUNT(*)::int AS total FROM project_files`,
    sql`SELECT COALESCE(SUM(file_size),0)::bigint AS total_bytes,
               COUNT(*)::int AS total_files,
               COUNT(DISTINCT project_id)::int AS projects_with_files
        FROM project_files`,
  ]);

  return NextResponse.json({
    success: true,
    data: rows,
    total: countRows[0].total,
    storage: sizeRow[0],
    page,
    limit,
  });
}

export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('id');
  if (!fileId) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

  const sql = getDb();
  await sql`DELETE FROM project_files WHERE id=${fileId}`;
  return NextResponse.json({ success: true });
}
