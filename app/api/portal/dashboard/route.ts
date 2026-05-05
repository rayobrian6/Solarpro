import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { getPortalSession } from '@/lib/portalAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── GET /api/portal/dashboard ──────────────────────────────────────────────
// Returns client info + their projects (homeowner_stage only — NOT project_status)
export async function GET(req: NextRequest) {
  // Rate limit
  const rl = await checkRateLimit('portal_read', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  // Auth — portal session cookie only
  const session = getPortalSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated', code: 'PORTAL_AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  try {
    const sql = await getDbReady();

    // Fetch client record
    const clients = await sql`
      SELECT id, name, email, phone, address, city, state, zip
      FROM clients
      WHERE id = ${session.clientId}
        AND LOWER(email) = ${session.email.toLowerCase()}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Account not found.', code: 'CLIENT_NOT_FOUND' },
        { status: 404 }
      );
    }

    const client = clients[0];

    // Fetch projects for this client — ONLY homeowner_stage, NOT project_status
    // Read-only fields: id, name, address, system_size_kw, homeowner_stage, updated_at, created_at
    const projects = await sql`
      SELECT
        id,
        name,
        address,
        system_size_kw,
        homeowner_stage,
        updated_at,
        created_at
      FROM projects
      WHERE client_id = ${session.clientId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      success: true,
      client: {
        id:      client.id,
        name:    client.name,
        email:   client.email,
        phone:   client.phone || null,
        address: client.address || null,
        city:    client.city || null,
        state:   client.state || null,
        zip:     client.zip || null,
      },
      projects,
    });
  } catch (e: unknown) {
    return handleRouteDbError('[api/portal/dashboard]', e);
  }
}