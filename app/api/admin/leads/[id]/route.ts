export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

type Params = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/admin/leads/[id]
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT l.*,
             u.name  AS owner_name,
             u.email AS owner_email,
             p.name  AS project_name,
             p.id    AS project_id,
             c.name  AS client_name
        FROM leads l
        LEFT JOIN users    u ON u.id = l.user_id
        LEFT JOIN projects p ON p.id = l.converted_project_id
        LEFT JOIN clients  c ON c.id = l.converted_client_id
       WHERE l.id = ${id}
       LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, lead: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/admin/leads/:id]', err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/leads/[id] — update status and/or notes
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { status, notes, name, phone, email, address } = body;

    const validStatuses = ['new', 'contacted', 'qualified', 'converted', 'closed'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json({ success: false, error: `Invalid status: ${status}` }, { status: 400 });
    }

    const sql = await getDbReady();

    // Build update — only set fields that were provided
    const rows = await sql`
      UPDATE leads SET
        status     = COALESCE(${status ?? null}, status),
        notes      = COALESCE(${notes  ?? null}, notes),
        name       = COALESCE(${name   ? name.trim()  : null}, name),
        phone      = COALESCE(${phone  ?? null}, phone),
        email      = COALESCE(${email  ? email.trim().toLowerCase() : null}, email),
        address    = COALESCE(${address ?? null}, address),
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, lead: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/admin/leads/:id]', err);
  }
}