export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// Max logo size: 2MB
const MAX_SIZE = 2 * 1024 * 1024;
// SECURITY: SVG excluded — SVG files can contain embedded JavaScript and cause stored XSS
// when rendered as a data URL. Only rasterized formats are accepted.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('settings', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided.' }, { status: 400 });
    }

    // Validate type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Please upload PNG, JPG, WebP, or GIF.' },
        { status: 400 }
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 2MB.' },
        { status: 400 }
      );
    }

    // Convert to base64 data URL for storage
    // In production, you'd upload to S3/Cloudflare R2/Vercel Blob and return a CDN URL
    const arrayBuffer = await file.arrayBuffer();

    // SECURITY: Magic byte validation — reject files whose binary signature
    // doesn't match the declared MIME type. This prevents attackers from
    // uploading malicious files (e.g. PHP shells, HTML with JS) disguised
    // as images by setting a fake Content-Type.
    const header = new Uint8Array(arrayBuffer.slice(0, 12));
    const isPng  = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    const isJpeg = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
    const isWebp = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    const isGif  = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;

    const magicValid =
      (file.type === 'image/png'  && isPng)  ||
      (file.type === 'image/jpeg' && isJpeg) ||
      (file.type === 'image/webp' && isWebp) ||
      (file.type === 'image/gif'  && isGif);

    if (!magicValid) {
      return NextResponse.json(
        { success: false, error: 'File content does not match declared type.' },
        { status: 400 }
      );
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Save to database
    const sql = await getDbReady();
    await sql`
      UPDATE users SET
        company_logo_url = ${dataUrl},
        updated_at       = NOW()
      WHERE id = ${user.id}
    `;

    return NextResponse.json({
      success: true,
      url: dataUrl,
      message: 'Logo uploaded successfully.',
    });

  } catch (error: unknown) {
    return handleRouteDbError('app/api/settings/logo/route.ts', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = await getDbReady();
    await sql`
      UPDATE users SET
        company_logo_url = NULL,
        updated_at       = NOW()
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ success: true, message: 'Logo removed.' });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/settings/logo/route.ts', error);
  }
}