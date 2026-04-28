// ============================================================
// /api/project-files — Client File Storage for Engineering Tab
// Stores utility bills, engineering packets, proposals, photos, permits
// All files stored in SolarPro DB linked to project_id + client_id
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

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

// ── GET /api/project-files?projectId=xxx ──────────────────────────────────────
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

      const fileSize = fileData ? Buffer.byteLength(fileData, 'base64') : 0;
      const resolvedType = fileType || categorizeFileType(mimeType || '', fileName);
      const fileBuffer = fileData ? Buffer.from(fileData, 'base64') : null;
      // SECURITY: Sanitize MIME type before storage — prevents stored XSS via MIME type
      const safeMimeType = sanitizeMimeType(mimeType);

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

    const resolvedClientId = clientId || projectCheck[0].client_id || null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = categorizeFileType(file.type, file.name);
    // SECURITY: Sanitize MIME type before storage — prevents stored XSS via MIME type
    const safeMimeType = sanitizeMimeType(file.type);

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