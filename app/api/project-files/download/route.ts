// ============================================================
// GET /api/project-files/download?id=xxx
// Serves stored file bytes from the database
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('id');
    if (!fileId) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const sql = await getDbReady();

    const rows = await sql`
      SELECT file_name, mime_type, file_data
      FROM project_files
      WHERE id = ${fileId} AND user_id = ${user.id}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const { file_name, mime_type, file_data } = rows[0];

    if (!file_data) {
      return NextResponse.json({ success: false, error: 'No file data stored' }, { status: 404 });
    }

    const buffer = Buffer.isBuffer(file_data) ? file_data : Buffer.from(file_data);

    // BUG-21-05 FIX: Sanitize mime_type from DB — never trust it directly.
    // Allowlist safe types; default to octet-stream for anything not recognised.
    // Use 'attachment' disposition to force download instead of inline render,
    // preventing XSS via stored HTML/SVG content.
    const SAFE_MIME_TYPES = new Set([
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'image/svg+xml',
      'application/json',
      'text/plain',
      'text/csv',
      'application/zip',
      'application/octet-stream',
    ]);
    const safeMimeType = SAFE_MIME_TYPES.has(mime_type) ? mime_type : 'application/octet-stream';
    // Always use attachment — never inline — to prevent browser rendering of untrusted content
    const safeFileName = file_name.replace(/[^\w\s.\-()]/g, '_');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': safeMimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFileName)}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/project-files/download]', err);
  }
}