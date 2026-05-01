import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import crypto from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/users?search=&page=&limit=
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const searchRaw = searchParams.get('search') || '';
  // Length cap — prevent excessively long ILIKE patterns causing slow DB queries
  const search = searchRaw.slice(0, 200);
  const page   = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') || '25'));
  const offset = (page - 1) * limit;

  try {
    const sql = await getDbReady();
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
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/users/route.ts]', e);
  }
}

// PATCH /api/admin/users — all user actions with activity logging
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
        const rl = await checkRateLimit('admin', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const sql = await getDbReady();
    const body = await req.json();
    const { id, action } = body;
    if (!id || !action) return NextResponse.json({ success: false, error: 'Missing id or action' }, { status: 400 });

    // SECURITY: UUID validation for target user id
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid user ID format.' }, { status: 400 });

    // SECURITY: field length caps
    if (typeof action       === 'string' && action.length       > 50)  return NextResponse.json({ success: false, error: 'action too long (max 50).'       }, { status: 400 });
    if (body.note    && typeof body.note    === 'string' && body.note.length    > 500) return NextResponse.json({ success: false, error: 'note too long (max 500).'    }, { status: 400 });
    if (body.name    && typeof body.name    === 'string' && body.name.length    > 200) return NextResponse.json({ success: false, error: 'name too long (max 200).'    }, { status: 400 });
    if (body.company && typeof body.company === 'string' && body.company.length > 200) return NextResponse.json({ success: false, error: 'company too long (max 200).' }, { status: 400 });

    // Fetch target user info for logging
    const targetRows = await sql`SELECT id, name, email, company, role FROM users WHERE id = ${id} LIMIT 1`;
    const targetUser = targetRows[0] ?? null;

    if (action === 'grant_free_pass') {
      await sql`UPDATE users SET is_free_pass = true, plan = 'contractor', subscription_status = 'free_pass',
                trial_ends_at = '2099-12-31 23:59:59+00', free_pass_note = ${body.note || 'Granted by admin'}, updated_at = NOW()
                WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'grant_free_pass', targetUserId: id, targetCompany: targetUser?.company, metadata: { note: body.note || 'Granted by admin', targetEmail: targetUser?.email } });

    } else if (action === 'revoke_free_pass') {
      await sql`UPDATE users SET is_free_pass = false, subscription_status = 'trialing', updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'revoke_free_pass', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email } });

    } else if (action === 'suspend') {
      await sql`UPDATE users SET subscription_status = 'suspended', updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'suspend_user', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email } });

    } else if (action === 'unsuspend') {
      await sql`UPDATE users SET subscription_status = 'trialing', updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'unsuspend_user', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email } });

    } else if (action === 'reset_trial') {
      await sql`UPDATE users SET subscription_status = 'trialing', trial_ends_at = NOW() + INTERVAL '14 days', updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'reset_trial', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email } });

    } else if (action === 'reset_password') {
      // SECURITY FIX: Use crypto.randomBytes instead of Math.random() for temp password
      // Math.random() is not cryptographically secure — crypto.randomBytes gives 48 bits of entropy
      const { randomBytes } = await import('crypto');
      const tempPassword = 'TempPass' + randomBytes(6).toString('hex').toUpperCase() + '!';
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(tempPassword, 10);
      await sql`UPDATE users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'reset_password', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email } });
      // Return the temp password so admin can share it
      return NextResponse.json({ success: true, tempPassword, message: `Password reset. Temporary password: ${tempPassword}` });

    } else if (action === 'set_role') {
      const role = body.role;
      if (!['user', 'admin', 'super_admin'].includes(role))
        return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
      if (admin.role !== 'super_admin')
        return NextResponse.json({ success: false, error: 'Only super_admin can set roles' }, { status: 403 });
      await sql`UPDATE users SET role = ${role}, updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'set_role', targetUserId: id, targetCompany: targetUser?.company, metadata: { newRole: role, previousRole: targetUser?.role, targetEmail: targetUser?.email } });

    } else if (action === 'set_plan') {
      const VALID_PLANS = ['starter', 'professional', 'contractor', 'free_pass'];
      if (!body.plan || !VALID_PLANS.includes(body.plan)) {
        return NextResponse.json({ success: false, error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` }, { status: 400 });
      }
      await sql`UPDATE users SET plan = ${body.plan}, updated_at = NOW() WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'set_plan', targetUserId: id, targetCompany: targetUser?.company, metadata: { newPlan: body.plan, targetEmail: targetUser?.email } });

    } else if (action === 'update') {
      const { name, company, role, plan } = body;
      if (role && !['user', 'admin', 'super_admin'].includes(role))
        return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
      const VALID_PLANS = ['starter', 'professional', 'contractor', 'free_pass'];
      if (plan && !VALID_PLANS.includes(plan))
        return NextResponse.json({ success: false, error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` }, { status: 400 });
      await sql`UPDATE users SET
        name    = COALESCE(${name    ?? null}, name),
        company = COALESCE(${company ?? null}, company),
        role    = COALESCE(${role    ?? null}, role),
        plan    = COALESCE(${plan    ?? null}, plan),
        updated_at = NOW()
        WHERE id = ${id}`;
      await logAdminAction({ adminId: admin.id, action: 'update_user', targetUserId: id, targetCompany: company ?? targetUser?.company, metadata: { changes: { name, company, role, plan }, targetEmail: targetUser?.email } });

    } else if (action === 'impersonate') {
      // Only super_admin can impersonate
      if (admin.role !== 'super_admin')
        return NextResponse.json({ success: false, error: 'Only super_admin can impersonate users' }, { status: 403 });
      if (!targetUser)
        return NextResponse.json({ success: false, error: 'Target user not found' }, { status: 404 });

      // Generate a secure one-time token
      const token = crypto.randomBytes(48).toString('hex');
      await sql`
        INSERT INTO admin_impersonation_tokens (admin_id, target_id, token, expires_at)
        VALUES (${admin.id}, ${id}, ${token}, NOW() + INTERVAL '5 minutes')
      `;
      await logAdminAction({ adminId: admin.id, action: 'impersonate_user', targetUserId: id, targetCompany: targetUser?.company, metadata: { targetEmail: targetUser?.email, targetName: targetUser?.name } });
      return NextResponse.json({ success: true, token, targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email } });

    } else {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Return the updated user record
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
      subscriptionStatus: raw.subscription_status,
      isFreePass: raw.is_free_pass,
      freePassNote: raw.free_pass_note,
      trialEndsAt: raw.trial_ends_at,
      createdAt: raw.created_at,
      subscription_status: raw.subscription_status,
      is_free_pass: raw.is_free_pass,
      free_pass_note: raw.free_pass_note,
      trial_ends_at: raw.trial_ends_at,
    } : null;
    return NextResponse.json({ success: true, user: normalizedUser });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/users/route.ts]', e);
  }
}

// DELETE /api/admin/users — super_admin only
export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  if (admin.role !== 'super_admin') return NextResponse.json({ success: false, error: 'Only super_admin can delete users' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const urlId = req.nextUrl.searchParams.get('id');
    let id = urlId;
    if (!id) {
      try { const body = await req.json(); id = body.id; } catch {}
    }
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });

    // SECURITY: Validate UUID format to prevent malformed IDs reaching the DB
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid user id format.' }, { status: 400 });
    }

    // SECURITY: Prevent admin from deleting their own account via this endpoint
    if (id === admin.id) {
      return NextResponse.json({ success: false, error: 'Cannot delete your own account via this endpoint.' }, { status: 400 });
    }

    const targetRows = await sql`SELECT email, company FROM users WHERE id = ${id} LIMIT 1`;
    if (!targetRows[0]) return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
    await sql`DELETE FROM users WHERE id = ${id}`;
    await logAdminAction({ adminId: admin.id, action: 'delete_user', targetUserId: id, targetCompany: targetRows[0]?.company, metadata: { targetEmail: targetRows[0]?.email } });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/users/route.ts]', e);
  }
}