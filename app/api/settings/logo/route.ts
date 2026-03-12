import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

// Max logo size: 2MB
const MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp', 'image/gif'];

export async function POST(req: NextRequest) {
  try {
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
        { success: false, error: 'Invalid file type. Please upload PNG, JPG, SVG, or WebP.' },
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