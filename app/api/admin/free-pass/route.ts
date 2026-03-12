import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/free-pass
 * Grant or revoke a free pass for a user by email.
 *
 * Body: { email: string, action: 'grant' | 'revoke', plan?: string, note?: string, secret?: string }
 *
 * Auth: Must be authenticated as an existing user OR provide the admin secret.
 * Admin secret: process.env.ADMIN_SECRET || 'solarpro-admin-2024'
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, action = 'grant', plan = 'contractor', note = 'Free pass granted by admin', secret } = body;

    // Auth: either logged-in user or valid admin secret
    const sessionUser = getUserFromRequest(req);
    const adminSecret = process.env.ADMIN_SECRET;
    const validSecret = adminSecret ? secret === adminSecret : false;

    if (!sessionUser && !validSecret) {
      return NextResponse.json({ success: false, error: 'Authentication required. Provide admin secret or be logged in.' }, { status: 401 });
    }

    if (!email) {
      return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    }

    const sql = await getDbReady();

    if (action === 'grant') {
      // Check if user exists
      const existing = await sql`SELECT id, email, name FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`;

      if (existing.length > 0) {
        // Update existing user
        await sql`
          UPDATE users SET
            plan = ${plan},
            subscription_status = 'free_pass',
            is_free_pass = true,
            free_pass_note = ${note},
            trial_ends_at = '2099-12-31 23:59:59+00',
            updated_at = NOW()
          WHERE email = ${email.toLowerCase()}
        `;
        return NextResponse.json({
          success: true,
          action: 'granted',
          email,
          plan,
          note,
          message: `✅ Free pass granted to existing user: ${email}`,
        });
      } else {
        // Create placeholder account — user can reset password via login
        const bcrypt = await import('bcryptjs');
        const placeholderHash = await bcrypt.hash('ChangeMe123!', 10);
        const name = email.split('@')[0];
        await sql`
          INSERT INTO users (name, email, password_hash, role, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at)
          VALUES (
            ${name}, ${email.toLowerCase()}, ${placeholderHash},
            'user', ${plan}, 'free_pass', true, ${note},
            '2099-12-31 23:59:59+00'
          )
          ON CONFLICT (email) DO UPDATE SET
            plan = ${plan},
            subscription_status = 'free_pass',
            is_free_pass = true,
            free_pass_note = ${note},
            trial_ends_at = '2099-12-31 23:59:59+00',
            updated_at = NOW()
        `;
        return NextResponse.json({
          success: true,
          action: 'created',
          email,
          plan,
          note,
          message: `✅ Free pass account created: ${email} (temp password: ChangeMe123!)`,
        });
      }
    } else if (action === 'revoke') {
      await sql`
        UPDATE users SET
          is_free_pass = false,
          free_pass_note = NULL,
          subscription_status = 'trialing',
          plan = 'starter',
          trial_ends_at = NOW() + INTERVAL '3 days',
          updated_at = NOW()
        WHERE email = ${email.toLowerCase()}
      `;
      return NextResponse.json({
        success: true,
        action: 'revoked',
        email,
        message: `✅ Free pass revoked for: ${email}. User is now on Starter trial.`,
      });
    } else if (action === 'list') {
      // List all free pass users
      const freePassUsers = await sql`
        SELECT id, name, email, company, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at, created_at
        FROM users
        WHERE is_free_pass = true OR subscription_status = 'free_pass'
        ORDER BY created_at DESC
      `;
      return NextResponse.json({
        success: true,
        count: freePassUsers.length,
        users: freePassUsers,
      });
    } else if (action === 'delete') {
      // Permanently delete a user account (admin only)
      if (!validSecret) return NextResponse.json({ success: false, error: 'Admin secret required to delete users' }, { status: 403 });
      await sql`DELETE FROM users WHERE email = ${email.toLowerCase()} AND email != 'raymond.obrian@yahoo.com'`;
      return NextResponse.json({ success: true, action: 'deleted', email, message: `🗑️ User deleted: ${email}` });
    } else if (action === 'search') {
      // Search users by email pattern or name
      const query = email || body.query || '';
      if (!query) return NextResponse.json({ success: false, error: 'Provide email or query to search' }, { status: 400 });
      const results = await sql`
        SELECT id, name, email, company, plan, subscription_status, is_free_pass, trial_ends_at, created_at
        FROM users
        WHERE email ILIKE ${'%' + query + '%'} OR name ILIKE ${'%' + query + '%'} OR company ILIKE ${'%' + query + '%'}
        ORDER BY created_at DESC
        LIMIT 20
      `;
      return NextResponse.json({ success: true, count: results.length, users: results });
    } else {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}. Use 'grant', 'revoke', or 'list'.` }, { status: 400 });
    }

  } catch (error: unknown) {
    return handleRouteDbError('[Free pass API err]', error);
  }
}

/**
 * GET /api/admin/free-pass?secret=...
 * List all free pass users
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const adminSecret = process.env.ADMIN_SECRET;
  const validSecret = adminSecret ? secret === adminSecret : false;
  const sessionUser = getUserFromRequest(req);

  if (!sessionUser && !validSecret) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const sql = await getDbReady();
    const freePassUsers = await sql`
      SELECT id, name, email, company, plan, subscription_status, is_free_pass, free_pass_note, trial_ends_at, created_at
      FROM users
      WHERE is_free_pass = true OR subscription_status = 'free_pass'
      ORDER BY created_at DESC
    `;
    return NextResponse.json({
      success: true,
      count: freePassUsers.length,
      users: freePassUsers,
    });
  } catch (error: unknown) {
    return handleRouteDbError('[app/api/admin/free-pass/route.ts]', error);
  }
}