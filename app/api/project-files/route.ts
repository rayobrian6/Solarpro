// ============================================================
// /api/project-files — Client File Storage for Engineering Tab
// Stores utility bills, engineering packets, proposals, photos, permits
// All files stored in SolarPro DB linked to project_id + client_id
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// SECURITY: Allowlist of safe MIME types accepted for storage.
// Mirrors the allowlist in project-files/download/route.ts — both must stay in sync.
// Any MIME type not on this list is stored as application/octet-stream.
const SAFE_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function sanitizeMimeType(raw: string | undefined | null): string {
  if (!raw) return 'application/octet-stream';
  const lower = raw.trim().toLowerCase();
  return SAFE_UPLOAD_MIME_TYPES.has(lower) ? lower : 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Magic byte validation
// Verifies binary file signature matches declared MIME type.
// Prevents content-type spoofing (HTML/JS disguised as PDF/image).
// ---------------------------------------------------------------------------
function validateMagicBytes(header: Uint8Array, mimeType: string): boolean {
  const mt = mimeType.replace('image/jpg', 'image/jpeg');

  // JPEG: FF D8 FF
  if (mt === 'image/jpeg') {
    return header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (mt === 'image/png') {
    return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  }
  // WebP: RIFF....WEBP
  if (mt === 'image/webp') {
    return header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
           header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
  }
  // GIF: GIF87a or GIF89a
  if (mt === 'image/gif') {
    return header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
  }
  // HEIC/HEIF: ISO Base Media File Format — 'ftyp' at bytes 4-7
  if (mt === 'image/heic' || mt === 'image/heif') {
    const hasFtyp = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
    const brand = String.fromCharCode(header[8], header[9], header[10], header[11]);
    const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
    return hasFtyp && heicBrands.includes(brand);
  }
  // PDF: %PDF
  if (mt === 'application/pdf') {
    return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  }
  // Office Open XML (DOCX/XLSX): PK zip magic (50 4B 03 04)
  if (mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04;
  }
  // Legacy Office (XLS/DOC): D0 CF 11 E0
  if (mt === 'application/vnd.ms-excel' || mt === 'application/msword') {
    return header[0] === 0xD0 && header[1] === 0xCF && header[2] === 0x11 && header[3] === 0xE0;
  }
  // SVG and CSV are text — no reliable binary magic; allow through (MIME already sanitized)
  if (mt === 'image/svg+xml' || mt === 'text/csv') {
    return true;
  }
  // application/octet-stream (fallback from sanitizeMimeType) — no magic check
  if (mt === 'application/octet-stream') {
    return true;
  }
  return false;
}

// File type categories
function categorizeFileType(mimeType: string, fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.includes('bill') || name.includes('utility') || name.includes('electric')) return 'utility_bill';
  if (name.includes('permit')) return 'permit';
  if (name.includes('proposal')) return 'proposal';
  if (name.includes('engineering') || name.includes('sld') || name.includes('bom') || name.includes('prelim')) return 'engineering';
  if (name.includes('photo') || name.includes('site') || name.includes('roof')) return 'site_photo';
  if (mimeType.startsWith('image/')) return 'site_photo';
  if (mimeType === 'application/pdf') return 'document';
  return 'other';
}

// ── GET /api/project-files?projectId=xxx ─────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });

    const sql = await getDbReady();

    // Verify user owns this project
    const projectCheck = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const files = await sql`
      SELECT
        id, project_id, client_id, file_name, file_type, file_size,
        mime_type, file_url, notes, upload_date, created_at, engineering_run_id
      FROM project_files
      WHERE project_id = ${projectId} AND user_id = ${user.id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ success: true, data: files });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/project-files]', err);
  }
}

// ── POST /api/project-files ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const contentType = req.headers.get('content-type') || '';
    const sql = await getDbReady();

    // Handle JSON (for saving generated engineering packets as text/base64)
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const { projectId, clientId, fileName, fileType, mimeType, fileData, notes } = body;

      if (!projectId || !fileName) {
        return NextResponse.json({ success: false, error: 'projectId and fileName required' }, { status: 400 });
      }

      // Verify ownership
      const projectCheck = await sql`
        SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
      `;
      if (projectCheck.length === 0) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      }

      // SECURITY: Sanitize MIME type before storage — prevents stored XSS via MIME type
      const safeMimeType = sanitizeMimeType(mimeType);
      const fileSize = fileData ? Buffer.byteLength(fileData, 'base64') : 0;
      const resolvedType = fileType || categorizeFileType(safeMimeType, fileName);
      const fileBuffer = fileData ? Buffer.from(fileData, 'base64') : null;

      // ── Magic byte validation for base64-decoded content ───────────────────
      if (fileBuffer && fileBuffer.length >= 4) {
        const header = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, Math.min(12, fileBuffer.length));
        if (!validateMagicBytes(header, safeMimeType)) {
          return NextResponse.json(
            { success: false, error: 'File content does not match declared type.' },
            { status: 400 },
          );
        }
      }

      const rows = await sql`
        INSERT INTO project_files (
          project_id, client_id, user_id, file_name, file_type,
          file_size, mime_type, file_data, notes
        ) VALUES (
          ${projectId}, ${clientId || null}, ${user.id}, ${fileName},
          ${resolvedType}, ${fileSize}, ${safeMimeType},
          ${fileBuffer}, ${notes || null}
        )
        RETURNING id, project_id, client_id, file_name, file_type, file_size, mime_type, notes, upload_date, created_at
      `;

      return NextResponse.json({ success: true, data: rows[0] });
    }

    // Handle multipart form upload
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const clientId = formData.get('clientId') as string | null;
    const notes = formData.get('notes') as string | null;

    if (!file || !projectId) {
      return NextResponse.json({ success: false, error: 'file and projectId required' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large. Maximum 10MB.' }, { status: 413 });
    }

    // Verify ownership
    const projectCheck = await sql`
      SELECT id, client_id FROM projects WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // SECURITY: Sanitize MIME type before storage — prevents stored XSS via MIME type
    const safeMimeType = sanitizeMimeType(file.type);
    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Magic byte validation ────────────────────────────────────────────────
    // Verify binary signature matches declared MIME type to prevent spoofing.
    if (buffer.length >= 4) {
      const header = new Uint8Array(buffer.buffer, buffer.byteOffset, Math.min(12, buffer.length));
      if (!validateMagicBytes(header, safeMimeType)) {
        return NextResponse.json(
          { success: false, error: 'File content does not match declared type.' },
          { status: 400 },
        );
      }
    }

    const resolvedClientId = clientId || projectCheck[0].client_id || null;
    const fileType = categorizeFileType(safeMimeType, file.name);

    const rows = await sql`
      INSERT INTO project_files (
        project_id, client_id, user_id, file_name, file_type,
        file_size, mime_type, file_data, notes
      ) VALUES (
        ${projectId}, ${resolvedClientId}, ${user.id}, ${file.name},
        ${fileType}, ${file.size}, ${safeMimeType},
        ${buffer}, ${notes || null}
      )
      RETURNING id, project_id, client_id, file_name, file_type, file_size, mime_type, notes, upload_date, created_at
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/project-files]', err);
  }
}

// ── DELETE /api/project-files?id=xxx ─────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('id');
    if (!fileId) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const sql = await getDbReady();
    const result = await sql`
      DELETE FROM project_files
      WHERE id = ${fileId} AND user_id = ${user.id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/project-files]', err);
  }
}