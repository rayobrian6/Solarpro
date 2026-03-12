import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const fileType = searchParams.get('fileType') || '';
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit    = Math.min(100, parseInt(searchParams.get('limit') || '25'));
  const offset   = (page - 1) * limit;

  try {
    const sql = await getDbReady();

    const [storageStats] = await Promise.all([
      sql`SELECT COUNT(*) AS total_files, COALESCE(SUM(file_size), 0) AS total_bytes FROM project_files`,
    ]);

    const rows = fileType
      ? await sql`
          SELECT pf.id, pf.file_name, pf.file_type, pf.file_size, pf.mime_type,
                 pf.upload_date, pf.notes,
                 u.name AS owner_name, u.email AS owner_email,
                 p.name AS project_name
          FROM project_files pf
          LEFT JOIN users u ON u.id = pf.user_id
          LEFT JOIN projects p ON p.id = pf.project_id
          WHERE pf.file_type = ${fileType}
          ORDER BY pf.upload_date DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT pf.id, pf.file_name, pf.file_type, pf.file_size, pf.mime_type,
                 pf.upload_date, pf.notes,
                 u.name AS owner_name, u.email AS owner_email,
                 p.name AS project_name
          FROM project_files pf
          LEFT JOIN users u ON u.id = pf.user_id
          LEFT JOIN projects p ON p.id = pf.project_id
          ORDER BY pf.upload_date DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    const countRow = fileType
      ? await sql`SELECT COUNT(*) AS total FROM project_files WHERE file_type = ${fileType}`
      : await sql`SELECT COUNT(*) AS total FROM project_files`;

    return NextResponse.json({
      success: true,
      files: rows,
      total: Number(countRow[0]?.total ?? 0),
      page,
      limit,
      storage: {
        totalFiles: Number(storageStats[0]?.total_files ?? 0),
        totalBytes: Number(storageStats[0]?.total_bytes ?? 0),
      },
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/files/route.ts]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    await sql`DELETE FROM project_files WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/files/route.ts]', e);
  }
}