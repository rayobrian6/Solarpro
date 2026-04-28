/**
 * GET /api/admin/feedback/screenshot?id=xxx
 * Returns the screenshot binary for a feedback entry (admin only).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Feedback ID required' }, { status: 400 });
    }

    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid feedback ID format.' }, { status: 400 });
    }

    const sql = await getDbReady();
    const rows = await sql`
      SELECT screenshot_data, screenshot_name, screenshot_mime
      FROM feedback
      WHERE id = ${id} AND screenshot_data IS NOT NULL
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
    }

    const { screenshot_data, screenshot_name, screenshot_mime } = rows[0];
    const buffer = Buffer.isBuffer(screenshot_data) ? screenshot_data : Buffer.from(screenshot_data);

    // Sanitize filename — strip control chars and special chars that could inject headers
    const rawName = (screenshot_name as string) || 'screenshot.png';
    const safeScreenshotName = rawName.replace(/[^\w\s.\-()]/g, '_').replace(/[\r\n]/g, '').substring(0, 200);

    // Sanitize MIME type — allowlist only known image types
    const ALLOWED_SCREENSHOT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const safeMime = ALLOWED_SCREENSHOT_MIME.has(screenshot_mime as string) ? screenshot_mime : 'image/png';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': safeMime as string,
        'Content-Disposition': `inline; filename="${encodeURIComponent(safeScreenshotName)}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    console.error('[GET /api/admin/feedback/screenshot]', (err as Error).message);
    return NextResponse.json({ success: false, error: 'Failed to load screenshot' }, { status: 500 });
  }
}