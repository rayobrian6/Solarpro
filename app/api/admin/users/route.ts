import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// GET /api/admin/users?search=&page=&limit=
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const page   = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') || '25'));
  const offset = (page - 1) * limit;

  try {
    const sql = getDb();
    const pattern = `%${search}%`;

    const [rows, countRows] = await Promise.all([
      sql`
        SELECT id, name, email, company, role, plan, subscription_status,
               is_free_pass, free_pass_note, trial_ends_at, created_at, updated_at
        FROM users
        WHERE name ILIKE ${pattern} OR email ILIKE ${pattern} OR company ILIKE ${pattern}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*) AS total FROM users
        WHERE name ILIKE ${pattern} OR email ILIKE ${pattern} OR company ILIKE ${pattern}
      `,
    ]);

    return NextResponse.json({
      success: true,
      users: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PATCH /api/admin/users — actions: grant_free_pass, suspend, unsuspend, reset_trial, set_role, set_plan, update
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = getDb();
    const body = await req.json();
    const { id, action } = body;
    if (!id || !action) return NextResponse.json({ success: false, error: 'Missing id or action' }, { status: 400 });

    if (action === 'grant_free_pass') {
      await sql`UPDATE users SET is_free_pass = true, plan = 'contractor', subscription_status = 'free_pass',
                trial_ends_at = '2099-12-31 23:59:59+00', free_pass_note = ${body.note || 'Granted by admin'}, updated_at = NOW()
                WHERE id = ${id}`;
    } else if (action === 'revoke_free_pass') {
      await sql`UPDATE users SET is_free_pass = false, subscription_status = 'trialing', updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'suspend') {
      await sql`UPDATE users SET subscription_status = 'suspended', updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'unsuspend') {
      await sql`UPDATE users SET subscription_status = 'trialing', updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'reset_trial') {
      await sql`UPDATE users SET subscription_status = 'trialing', trial_ends_at = NOW() + INTERVAL '3 days', updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'set_role') {
      const role = body.role;
      if (!['user', 'admin', 'super_admin'].includes(role))
        return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
      // Only super_admin can set roles
      if (admin.role !== 'super_admin')
        return NextResponse.json({ success: false, error: 'Only super_admin can set roles' }, { status: 403 });
      await sql`UPDATE users SET role = ${role}, updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'set_plan') {
      await sql`UPDATE users SET plan = ${body.plan}, updated_at = NOW() WHERE id = ${id}`;
    } else if (action === 'update') {
      const { name, company, role, plan } = body;
      if (role && !['user', 'admin', 'super_admin'].includes(role))
        return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
      await sql`UPDATE users SET
        name    = COALESCE(${name    ?? null}, name),
        company = COALESCE(${company ?? null}, company),
        role    = COALESCE(${role    ?? null}, role),
        plan    = COALESCE(${plan    ?? null}, plan),
        updated_at = NOW()
        WHERE id = ${id}`;
    } else {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Return the updated user record — normalized to camelCase so frontend can use directly
    const updated = await sql`
      SELECT id, name, email, company, role, plan, subscription_status, is_free_pass,
             free_pass_note, trial_ends_at, created_at
      FROM users WHERE id = ${id} LIMIT 1
    `;
    const raw = updated[0] ?? null;
    const normalizedUser = raw ? {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      company: raw.company,
      role: raw.role,
      plan: raw.plan,
      // camelCase — used by frontend UserContext / hasPlatformAccess
      subscriptionStatus: raw.subscription_status,
      isFreePass: raw.is_free_pass,
      freePassNote: raw.free_pass_note,
      trialEndsAt: raw.trial_ends_at,
      createdAt: raw.created_at,
      // snake_case — kept for admin UI tables that read raw DB fields
      subscription_status: raw.subscription_status,
      is_free_pass: raw.is_free_pass,
      free_pass_note: raw.free_pass_note,
      trial_ends_at: raw.trial_ends_at,
    } : null;
    return NextResponse.json({ success: true, user: normalizedUser });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// DELETE /api/admin/users — super_admin only
export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  if (admin.role !== 'super_admin') return NextResponse.json({ success: false, error: 'Only super_admin can delete users' }, { status: 403 });

  try {
    const sql = getDb();
    // Support both query param (?id=...) and JSON body ({ id: ... })
    const urlId = req.nextUrl.searchParams.get('id');
    let id = urlId;
    if (!id) {
      try { const body = await req.json(); id = body.id; } catch {}
    }
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    await sql`DELETE FROM users WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}