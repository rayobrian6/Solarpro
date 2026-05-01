// ============================================================================
// /api/organizations
//
// GET  — return current user's org (or null)
// POST — create a new org (user becomes owner)
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT o.id, o.name, o.plan, o.created_at,
             u.org_role,
             (SELECT COUNT(*) FROM users m WHERE m.org_id = o.id) AS member_count,
             (SELECT json_agg(json_build_object(
               'id', m.id, 'name', m.name, 'email', m.email, 'org_role', m.org_role
             )) FROM users m WHERE m.org_id = o.id) AS members,
             (SELECT json_agg(json_build_object(
               'id', i.id, 'invited_email', i.invited_email, 'created_at', i.created_at,
               'expires_at', i.expires_at, 'accepted_at', i.accepted_at
             )) FROM org_invites i WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.expires_at > now()) AS pending_invites
        FROM organizations o
        JOIN users u ON u.id = ${user.id}
       WHERE u.org_id = o.id
       LIMIT 1
    `;
    return NextResponse.json({ success: true, org: rows[0] ?? null });
  } catch (e) {
    return handleRouteDbError('[GET /api/organizations]', e);
  }
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ success: false, error: 'Organization name required' }, { status: 400 });

    const sql = await getDbReady();

    // Check user isn't already in an org
    const existing = await sql`SELECT org_id FROM users WHERE id = ${user.id} LIMIT 1`;
    if (existing[0]?.org_id) {
      return NextResponse.json({ success: false, error: 'You are already part of an organization' }, { status: 409 });
    }

    // Create org
    const orgRows = await sql`
      INSERT INTO organizations (name, owner_id)
      VALUES (${name.trim()}, ${user.id})
      RETURNING id, name, created_at
    `;
    const org = orgRows[0];

    // Link user as owner
    await sql`
      UPDATE users SET org_id = ${org.id}, org_role = 'owner' WHERE id = ${user.id}
    `;

    return NextResponse.json({ success: true, org });
  } catch (e) {
    return handleRouteDbError('[POST /api/organizations]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbReady();
    const userRow = await sql`SELECT org_id, org_role FROM users WHERE id = ${user.id} LIMIT 1`;
    if (!userRow[0]?.org_id) return NextResponse.json({ success: false, error: 'Not in an org' }, { status: 400 });
    if (userRow[0].org_role !== 'owner') return NextResponse.json({ success: false, error: 'Only the owner can delete the org' }, { status: 403 });

    // Remove all members from org first
    await sql`UPDATE users SET org_id = NULL, org_role = 'owner' WHERE org_id = ${userRow[0].org_id}`;
    // Delete org (cascades invites)
    await sql`DELETE FROM organizations WHERE id = ${userRow[0].org_id}`;

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteDbError('[DELETE /api/organizations]', e);
  }
}
