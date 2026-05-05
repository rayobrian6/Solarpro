export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

type Params = { params: { id: string } };

// ---------------------------------------------------------------------------
// POST /api/admin/leads/[id]/convert
//
// Converts a lead to a client + project.
//
// Logic:
//   1. Load lead — must exist and not already be converted.
//   2. Create client (using lead name/email/phone/address) if not exists.
//      Uses lead.email as dedup key within the same user_id.
//   3. Create project (using lead address as name, linked to client).
//   4. Update lead: status=converted, converted_client_id, converted_project_id,
//      converted_at.
//
// Returns: { success, clientId, projectId }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // 1. Load lead
    const leadRows = await sql`
      SELECT * FROM leads WHERE id = ${id} LIMIT 1
    `;
    if (!leadRows.length) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    const lead = leadRows[0] as Record<string, unknown>;

    if (lead.status === 'converted') {
      return NextResponse.json({
        success: false,
        error: 'Lead is already converted',
        clientId: lead.converted_client_id,
        projectId: lead.converted_project_id,
      }, { status: 409 });
    }

    // Lead must have a user_id to convert — client and project both require an owner
    if (!lead.user_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Lead has no assigned owner. Please assign a user before converting to project.',
          code: 'LEAD_NO_OWNER',
        },
        { status: 400 }
      );
    }
    const userId = String(lead.user_id);

    // 2. Create or find client
    // Dedup: if a non-deleted client with same email already exists for this user, reuse it.
    let clientId: string;

    const existingClient = lead.email
      ? await sql`
          SELECT id FROM clients
           WHERE user_id = ${userId}
             AND LOWER(email) = LOWER(${String(lead.email)})
             AND deleted_at IS NULL
           LIMIT 1
        `
      : [];

    if (existingClient.length > 0) {
      clientId = String(existingClient[0].id);
    } else {
      const clientRows = await sql`
        INSERT INTO clients (
          user_id, name, email, phone, address,
          city, state, zip
        ) VALUES (
          ${userId},
          ${String(lead.name)},
          ${lead.email ? String(lead.email).toLowerCase() : ''},
          ${lead.phone ? String(lead.phone) : ''},
          ${lead.address ? String(lead.address) : ''},
          '', '', ''
        )
        RETURNING id
      `;
      clientId = String(clientRows[0].id);
    }

    // 3. Create project
    const projectName = lead.address
      ? String(lead.address)
      : `${String(lead.name)} — Solar`;

    const projectRows = await sql`
      INSERT INTO projects (
        user_id, client_id, name, status, system_type, notes, address, origin
      ) VALUES (
        ${userId},
        ${clientId},
        ${projectName},
        'lead',
        'roof',
        ${lead.notes ? String(lead.notes) : ''},
        ${lead.address ? String(lead.address) : ''},
        'lead'
      )
      RETURNING id
    `;
    const projectId = String(projectRows[0].id);

    // 4. Update lead
    await sql`
      UPDATE leads SET
        status                = 'converted',
        converted_client_id   = ${clientId}::uuid,
        converted_project_id  = ${projectId}::uuid,
        converted_at          = now(),
        updated_at            = now()
      WHERE id = ${id}
    `;

    return NextResponse.json({ success: true, clientId, projectId });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/admin/leads/:id/convert]', err);
  }
}