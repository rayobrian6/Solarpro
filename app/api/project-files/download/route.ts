// ============================================================
// GET /api/project-files/download?id=xxx[&inline=1]
// Serves stored file bytes from the database.
//
// ?inline=1  — safe images (jpeg/png/gif/webp) are served with
//              Content-Disposition: inline so <img> tags can display
//              them as thumbnails.  SVG is always forced to attachment
//              (XSS risk).  All other types are forced to attachment
//              regardless of the inline flag.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// MIME types that are safe to display inline (no scripting risk)
const INLINE_SAFE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

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

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('id');
    const wantInline = searchParams.get('inline') === '1';

    if (!fileId) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    if (!isValidUUID(fileId)) {
      return NextResponse.json({ success: false, error: 'Invalid file ID format.' }, { status: 400 });
    }

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
    const safeMimeType = SAFE_MIME_TYPES.has(mime_type) ? mime_type : 'application/octet-stream';
    const safeFileName = file_name.replace(/[^\w\s.\-()]/g, '_');

    // Use inline disposition only for safe image types when requested.
    // SVG, PDF, and everything else always forces a download (XSS prevention).
    const useInline = wantInline && INLINE_SAFE_MIME_TYPES.has(safeMimeType);
    const disposition = useInline
      ? `inline; filename="${encodeURIComponent(safeFileName)}"`
      : `attachment; filename="${encodeURIComponent(safeFileName)}"`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': safeMimeType,
        'Content-Disposition': disposition,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/project-files/download]', err);
  }
}
