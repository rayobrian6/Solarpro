import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';

export const dynamic = 'force-dynamic';

// GET /api/admin/companies?company=<name>
// Returns detailed info about a specific company or all companies
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const companyName = searchParams.get('company') || '';

  try {
    const sql = await getDbReady();

    if (companyName) {
      // Detailed view for a single company
      const [users, projectCount] = await Promise.all([
        sql`
          SELECT id, name, email, role, plan, subscription_status, is_free_pass,
                 free_pass_note, trial_ends_at, created_at
          FROM users
          WHERE company = ${companyName}
          ORDER BY created_at ASC
        `,
        sql`SELECT COUNT(*) AS c FROM projects WHERE company = ${companyName}`.catch(() => [{ c: 0 }]),
      ]);

      const hasFreePass  = users.some((u: any) => u.is_free_pass);
      const plans        = [...new Set(users.map((u: any) => u.plan))];
      const owner        = users.find((u: any) => u.role === 'super_admin' || u.role === 'admin') || users[0];

      return NextResponse.json({
        success: true,
        company: {
          name:         companyName,
          users,
          userCount:    users.length,
          projectCount: Number(projectCount[0]?.c ?? 0),
          plans,
          hasFreePass,
          owner: owner ? { id: owner.id, name: owner.name, email: owner.email, role: owner.role } : null,
        },
      });
    }

    // List all companies (aggregated)
    const rows = await sql`
      SELECT
        company,
        COUNT(*) AS user_count,
        BOOL_OR(is_free_pass) AS has_free_pass,
        array_agg(DISTINCT plan) AS plans,
        MIN(created_at) AS first_joined
      FROM users
      WHERE company IS NOT NULL AND company != ''
      GROUP BY company
      ORDER BY user_count DESC
    `;

    return NextResponse.json({ success: true, companies: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/companies/route.ts]', e);
  }
}

// PATCH /api/admin/companies — company-level actions
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const body = await req.json();
    const { company, action } = body;
    if (!company || !action)
      return NextResponse.json({ success: false, error: 'Missing company or action' }, { status: 400 });

    switch (action) {

      case 'grant_free_pass': {
        await sql`
          UPDATE users
          SET is_free_pass = true, plan = 'contractor', subscription_status = 'free_pass',
              trial_ends_at = '2099-12-31 23:59:59+00',
              free_pass_note = ${body.note || 'Company free pass granted by admin'},
              updated_at = NOW()
          WHERE company = ${company}
        `;
        await logAdminAction({ adminId: admin.id, action: 'company_grant_free_pass', targetCompany: company, metadata: { note: body.note } });
        return NextResponse.json({ success: true, message: `Free pass granted to all users in ${company}` });
      }

      case 'revoke_free_pass': {
        await sql`
          UPDATE users
          SET is_free_pass = false, subscription_status = 'trialing', updated_at = NOW()
          WHERE company = ${company}
        `;
        await logAdminAction({ adminId: admin.id, action: 'company_revoke_free_pass', targetCompany: company, metadata: {} });
        return NextResponse.json({ success: true, message: `Free pass revoked for all users in ${company}` });
      }

      case 'change_plan': {
        const plan = body.plan;
        if (!['starter', 'contractor', 'pro', 'enterprise'].includes(plan))
          return NextResponse.json({ success: false, error: 'Invalid plan' }, { status: 400 });
        await sql`UPDATE users SET plan = ${plan}, updated_at = NOW() WHERE company = ${company}`;
        await logAdminAction({ adminId: admin.id, action: 'company_change_plan', targetCompany: company, metadata: { newPlan: plan } });
        return NextResponse.json({ success: true, message: `Plan changed to ${plan} for all users in ${company}` });
      }

      case 'disable_company': {
        if (admin.role !== 'super_admin')
          return NextResponse.json({ success: false, error: 'Only super_admin can disable companies' }, { status: 403 });
        await sql`UPDATE users SET subscription_status = 'suspended', updated_at = NOW() WHERE company = ${company}`;
        await logAdminAction({ adminId: admin.id, action: 'company_disabled', targetCompany: company, metadata: {} });
        return NextResponse.json({ success: true, message: `All users in ${company} have been suspended` });
      }

      case 'enable_company': {
        await sql`UPDATE users SET subscription_status = 'trialing', updated_at = NOW() WHERE company = ${company} AND subscription_status = 'suspended'`;
        await logAdminAction({ adminId: admin.id, action: 'company_enabled', targetCompany: company, metadata: {} });
        return NextResponse.json({ success: true, message: `All suspended users in ${company} have been re-enabled` });
      }

      case 'add_company_admin': {
        const userId = body.userId;
        if (!userId)
          return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
        if (admin.role !== 'super_admin')
          return NextResponse.json({ success: false, error: 'Only super_admin can promote to admin' }, { status: 403 });
        await sql`UPDATE users SET role = 'admin', updated_at = NOW() WHERE id = ${userId} AND company = ${company}`;
        await logAdminAction({ adminId: admin.id, action: 'company_add_admin', targetUserId: userId, targetCompany: company, metadata: {} });
        return NextResponse.json({ success: true, message: `User promoted to admin in ${company}` });
      }

      case 'transfer_ownership': {
        const newOwnerId = body.newOwnerId;
        if (!newOwnerId)
          return NextResponse.json({ success: false, error: 'Missing newOwnerId' }, { status: 400 });
        if (admin.role !== 'super_admin')
          return NextResponse.json({ success: false, error: 'Only super_admin can transfer ownership' }, { status: 403 });
        // Demote all current super_admins in company to admin, then promote new owner
        await sql`UPDATE users SET role = 'admin', updated_at = NOW() WHERE company = ${company} AND role = 'super_admin'`;
        await sql`UPDATE users SET role = 'super_admin', updated_at = NOW() WHERE id = ${newOwnerId} AND company = ${company}`;
        await logAdminAction({ adminId: admin.id, action: 'company_transfer_ownership', targetUserId: newOwnerId, targetCompany: company, metadata: {} });
        return NextResponse.json({ success: true, message: `Ownership transferred in ${company}` });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/companies/route.ts]', e);
  }
}