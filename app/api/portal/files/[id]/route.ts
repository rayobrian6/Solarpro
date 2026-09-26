// ============================================================================
// GET /api/portal/files/[id]
//
// Serves ONE of the homeowner's own documents to the homeowner, for the portal's
// document vault.
//
// 🚨 THE OWNERSHIP CHECK IS THE ENTIRE POINT OF THIS FILE.
//
// The vault used to render a download glyph that was not a control: no href, no
// handler, and no endpoint behind it. The homeowner clicked it and nothing
// happened. This endpoint exists so that glyph can be a real link — and an
// endpoint like this one, written without the ownership check, would be strictly
// worse than the dead icon it replaces: any authenticated homeowner could read
// any other homeowner's uploaded documents by guessing a file id. That is a P0
// data leak, not a UX bug.
//
// So the check is not "is this a valid portal session"; it is "does the project
// this file belongs to belong to THIS session's client". It is one SQL predicate
// and it is enforced IN the query rather than after it, so no code path can
// return a row it has not authorised. A negative case — another client's file
// must not be served — is pinned in tests/portalFileAccessIsScoped.postgres.test.ts.
//
// TWO further restrictions, both deliberate:
//
//   • `file_type IN ('utility_bill','portal_upload')` — the same allowlist the
//     portal's read route uses. Internal ops artefacts (permit packets, BOM,
//     SLD, engineering reports, survey photos, client profile) are deliberately
//     not homeowner-visible, and an id-addressable endpoint must not become the
//     back door around that decision. A homeowner who owns the project is still
//     not entitled to the installer's internal file set through here.
//   • The MIME type from the database is never echoed back unvalidated, and
//     everything is served as an attachment. Stored bytes are attacker-supplied
//     by definition — the homeowner uploaded them — so an `image/svg+xml`
//     rendered inline on this origin would be stored XSS against the portal.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { getPortalSession } from '@/lib/portalAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/** The only file types the homeowner portal ever exposes. */
const PORTAL_FILE_TYPES = ['utility_bill', 'portal_upload'] as const;

/**
 * Content types served with their own MIME. Anything else becomes
 * `application/octet-stream` — including SVG, which is a script container.
 */
const SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/json',
  'text/plain',
  'text/csv',
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await checkRateLimit('portal_read', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const session = getPortalSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated', code: 'PORTAL_AUTH_REQUIRED' },
      { status: 401 },
    );
  }

  const { id: fileId } = await params;
  if (!isValidUUID(fileId)) {
    return NextResponse.json({ success: false, error: 'Invalid file ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // 🚨 OWNERSHIP IS A JOIN PREDICATE, NOT A POST-HOC `if`.
    //
    // `pf.id = <file>` alone would serve any file in the database. The file is
    // reachable only through a project whose `client_id` IS this session's
    // client, so a file belonging to another homeowner produces zero rows and is
    // indistinguishable from a file that does not exist — which is what it
    // should look like from outside.
    const rows = await sql`
      SELECT pf.file_name, pf.mime_type, pf.file_data, pf.file_url
      FROM project_files pf
      JOIN projects p ON p.id = pf.project_id
      WHERE pf.id        = ${fileId}
        AND p.client_id  = ${session.clientId}
        AND p.deleted_at IS NULL
        AND pf.file_type = ANY(${PORTAL_FILE_TYPES as unknown as string[]})
        AND (pf.file_data IS NOT NULL OR pf.file_url IS NOT NULL)
        AND COALESCE(pf.status, '') <> 'failed'
      LIMIT 1
    `;

    // Deliberately 404, never 403: a 403 would confirm the file exists and
    // belongs to someone else, which is information this caller has no claim to.
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const row = rows[0] as {
      file_name: string | null;
      mime_type: string | null;
      file_data: Buffer | Uint8Array | null;
      file_url:  string | null;
    };

    const rawName  = (row.file_name ?? 'document').trim() || 'document';
    const safeName = rawName.replace(/[^\w\s.\-()]/g, '_');

    if (row.file_data) {
      const buffer = Buffer.isBuffer(row.file_data)
        ? row.file_data
        : Buffer.from(row.file_data);

      const declared  = (row.mime_type ?? '').trim().toLowerCase();
      const safeMime  = SAFE_MIME_TYPES.has(declared) ? declared : 'application/octet-stream';

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type':           safeMime,
          // Always an attachment. See the header note on stored XSS.
          'Content-Disposition':    `attachment; filename="${encodeURIComponent(safeName)}"`,
          'Content-Length':         String(buffer.length),
          'Cache-Control':          'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // Blob-stored file: hand back the storage URL rather than proxying it. The
    // scheme is checked because this value comes from the database and a
    // `javascript:`/`data:` redirect target would be an open redirect at best.
    const url = (row.file_url ?? '').trim();
    if (/^https:\/\//i.test(url) || /^\/[^/\\]/.test(url)) {
      return NextResponse.redirect(new URL(url, req.nextUrl.origin), 302);
    }

    return NextResponse.json({ success: false, error: 'File not available' }, { status: 404 });
  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/files/[id]]', e);
  }
}
