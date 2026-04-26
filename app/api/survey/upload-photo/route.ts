// ============================================================================
// v47.437 - Survey V2: POST /api/survey/upload-photo
//
// Accepts a multipart form upload with:
//   - file:     the image file
//   - category: PhotoCategory string
//   - token:    the handoff JWT (used to derive the survey ID / project ID)
//
// Validates the JWT, validates file type/size, then uploads to Vercel Blob
// storage (or local /public/uploads fallback in development).
//
// Returns: { url, uploadKey }
//
// Auth: JWT token in request body (no session cookie required - this is
// accessed from a mobile field device).
//
// Pure ASCII, no Unicode.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '../../../../lib/survey/handoff/tokenMinter';

// ---------------------------------------------------------------------------
// Allowed MIME types
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Parse multipart form data
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 });
    }

    const file = form.get('file');
    const category = form.get('category');
    const token = form.get('token');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    if (typeof category !== 'string' || !category) {
      return NextResponse.json({ error: 'Missing category' }, { status: 400 });
    }

    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Verify JWT
    const claims = verifyHandoffToken(token);
    if (!claims) {
      return NextResponse.json(
        { error: 'Invalid or expired survey token' },
        { status: 401 },
      );
    }

    // Validate file type
    const mimeType = file.type.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `File type not allowed: ${mimeType}. Use JPEG, PNG, WEBP, or HEIC.` },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return NextResponse.json(
        { error: `File too large: ${mb}MB. Maximum is 15MB.` },
        { status: 400 },
      );
    }

    // Build upload key: surveys/{projectId}/{jti}/{category}/{timestamp}.{ext}
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const ts = Date.now();
    const uploadKey = `surveys/${claims.project_id}/${claims.jti}/${category}/${ts}.${ext}`;

    // ---------------------------------------------------------------------------
    // Upload to Vercel Blob (if configured) or fallback to /tmp
    // ---------------------------------------------------------------------------
    let publicUrl: string;

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      // Vercel Blob storage
      const { put } = await import('@vercel/blob');
      const bytes = await file.arrayBuffer();
      const blob = await put(uploadKey, Buffer.from(bytes), {
        access: 'public',
        contentType: mimeType,
        token: blobToken,
      });
      publicUrl = blob.url;
    } else {
      // Development fallback: save to public/uploads
      const { writeFile, mkdir } = await import('fs/promises');
      const { join } = await import('path');
      const uploadsDir = join(process.cwd(), 'public', 'uploads', 'surveys');
      await mkdir(uploadsDir, { recursive: true });
      const fileName = `${claims.project_id}_${category}_${ts}.${ext}`;
      const filePath = join(uploadsDir, fileName);
      const bytes = await file.arrayBuffer();
      await writeFile(filePath, Buffer.from(bytes));
      publicUrl = `/uploads/surveys/${fileName}`;
    }

    return NextResponse.json(
      { url: publicUrl, uploadKey },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('[upload-photo] error:', msg);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}