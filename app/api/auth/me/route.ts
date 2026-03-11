import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const sql = getDb();

    // First try full query with all new columns (post-migration-006)
    let rows: any[] = [];
    let useFallback = false;

    try {
      rows = await sql`
        SELECT
          id, name, email, company, phone, role, email_verified, created_at,
          plan, subscription_status, trial_starts_at, trial_ends_at,
          is_free_pass, free_pass_note,
          company_logo_url, company_website, company_address, company_phone,
          brand_primary_color, brand_secondary_color, proposal_footer_text
        FROM users WHERE id = ${user.id} LIMIT 1
      `;
    } catch (colErr: any) {
      // New columns don't exist yet (migration 006 not run) — fall back to base columns
      console.warn('Auth me: falling back to base columns (migration 006 pending):', colErr.message);
      useFallback = true;
      rows = await sql`
        SELECT id, name, email, company, phone, role, email_verified, created_at
        FROM users WHERE id = ${user.id} LIMIT 1
      `;
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const dbUser = rows[0];

    // Determine if user has active access — mirrors hasPlatformAccess() from lib/permissions.ts
    // Admin roles always have access regardless of subscription state
    const now = new Date();
    const trialEnd = !useFallback && dbUser.trial_ends_at ? new Date(dbUser.trial_ends_at) : null;
    const role = (dbUser.role || '').toLowerCase();
    const hasAccess = useFallback
      ? true  // if migration hasn't run yet, allow access so users aren't locked out
      : (role === 'super_admin' ||
         role === 'admin' ||
         dbUser.is_free_pass === true ||
         dbUser.subscription_status === 'active' ||
         dbUser.subscription_status === 'free_pass' ||   // set by admin grant_free_pass
         (dbUser.subscription_status === 'trialing' && trialEnd && trialEnd > now));

    return NextResponse.json({
      success: true,
      data: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        company: dbUser.company,
        phone: dbUser.phone,
        role: dbUser.role,
        emailVerified: dbUser.email_verified,
        createdAt: dbUser.created_at,
        // Subscription (defaults if migration not yet run)
        plan: dbUser.plan || 'starter',
        subscriptionStatus: dbUser.subscription_status || 'trialing',
        trialStartsAt: dbUser.trial_starts_at || null,
        trialEndsAt: dbUser.trial_ends_at || null,
        isFreePass: dbUser.is_free_pass || false,
        freePassNote: dbUser.free_pass_note || null,
        hasAccess,
        // Branding (defaults if migration not yet run)
        companyLogoUrl: dbUser.company_logo_url || null,
        companyWebsite: dbUser.company_website || null,
        companyAddress: dbUser.company_address || null,
        companyPhone: dbUser.company_phone || null,
        brandPrimaryColor: dbUser.brand_primary_color || '#f59e0b',
        brandSecondaryColor: dbUser.brand_secondary_color || '#0f172a',
        proposalFooterText: dbUser.proposal_footer_text || null,
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      }
    });

  } catch (error: any) {
    console.error('Auth me error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get user' }, { status: 500 });
  }
}