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
// Security: MIME type validated against magic bytes to prevent content-type
// spoofing attacks. Client-supplied file.type is never trusted alone.
//
// Pure ASCII, no Unicode.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '../../../../lib/survey/handoff/tokenMinter';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

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
// Magic byte validation
// Checks binary file signature against declared MIME type.
// HEIC/HEIF use ISO Base Media File Format (ftyp box at offset 4).
// ---------------------------------------------------------------------------
function validateMagicBytes(header: Uint8Array, mimeType: string): boolean {
  // JPEG: FF D8 FF
  const isJpeg = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng  = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  const isWebP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
                 header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
  // GIF: GIF87a or GIF89a
  const isGif  = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
  // HEIC/HEIF: ISO Base Media File Format — 'ftyp' at bytes 4-7, then brand
  // Brands: heic, heix, hevc, hevx, heim, heis, hevm, hevs, mif1, msf1
  const hasFtyp = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
  const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
  const brand = String.fromCharCode(header[8], header[9], header[10], header[11]);
  const isHeic = hasFtyp && heicBrands.includes(brand);

  const mt = mimeType.replace('image/jpg', 'image/jpeg');
  switch (mt) {
    case 'image/jpeg': return isJpeg;
    case 'image/png':  return isPng;
    case 'image/webp': return isWebP;
    case 'image/gif':  return isGif;
    case 'image/heic':
    case 'image/heif': return isHeic;
    default:           return false;
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── Rate limiting ────────────────────────────────────────────────────────
    const rl = await checkRateLimit('survey', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

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

    // Validate declared MIME type against allowlist
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

    // ── Magic byte validation ────────────────────────────────────────────────
    // Read first 12 bytes to check binary signature against declared MIME type.
    // Prevents content-type spoofing (e.g., HTML/JS disguised as JPEG).
    const bytes = await file.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    if (!validateMagicBytes(header, mimeType)) {
      return NextResponse.json(
        { error: 'File content does not match declared type.' },
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