import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 *
 * JWT is used ONLY to extract the user ID.
 * ALL user data (role, plan, is_free_pass, subscription_status) comes from the DB.
 * Role is NEVER read from the JWT payload.
 *
 * Uses getDbReady() with cold-start retry so that a Vercel deployment cold start
 * does NOT cause UserContext to see null (which looks like logout to the user).
 */
export async function GET(req: NextRequest) {
  try {
    // Step 1: Extract user ID from JWT — nothing else is trusted from the token
    const session = getUserFromRequest(req);
    if (!session?.id) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const userId = session.id;

    // Step 2: Get DB with cold-start retry (handles Vercel deployment cold starts)
    const sql = await getDbReady();

    // Step 3: Fetch ALL user data from DB — this is the single source of truth
    let rows: any[] = [];
    let useFallback = false;

    try {
      // NOTE: Query formatting intentionally differs from other routes to avoid
      // Neon prepared statement cache collisions (different template = different PS key)
      rows = await sql`
        SELECT id, name, email, company, phone,
          role, email_verified, created_at,
          plan, subscription_status,
          trial_starts_at, trial_ends_at,
          is_free_pass, free_pass_note,
          company_logo_url, company_website,
          company_address, company_phone,
          brand_primary_color, brand_secondary_color,
          proposal_footer_text
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    } catch (colErr: any) {
      // New columns don't exist yet (migration not run) — fall back to base columns
      console.warn('Auth me: falling back to base columns:', colErr.message);
      useFallback = true;
      rows = await sql`
        SELECT id, name, email,
          company, phone, role,
          email_verified, created_at
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const db = rows[0];

    // Step 4: Compute hasAccess from DB fields only — mirrors hasPlatformAccess()
    const now = new Date();
    const trialEnd = !useFallback && db.trial_ends_at ? new Date(db.trial_ends_at) : null;
    const role = (db.role || '').toLowerCase();
    const hasAccess = useFallback
      ? true  // migration not run yet — allow access so users aren't locked out
      : (role === 'super_admin' ||
         role === 'admin' ||
         db.is_free_pass === true ||
         db.subscription_status === 'active' ||
         db.subscription_status === 'free_pass' ||
         (db.subscription_status === 'trialing' && trialEnd && trialEnd > now));

    // Step 5: Return normalized user object
    // camelCase fields for frontend; snake_case fields kept for compatibility
    return NextResponse.json({
      success: true,
      data: {
        // Identity
        id:            db.id,
        name:          db.name,
        email:         db.email,
        company:       db.company   || null,
        phone:         db.phone     || null,
        emailVerified: db.email_verified || false,
        createdAt:     db.created_at || null,

        // Role — ALWAYS from DB, never from JWT
        role: db.role || 'user',

        // Subscription — camelCase (frontend canonical)
        plan:               db.plan               || 'starter',
        subscriptionStatus: db.subscription_status || 'trialing',
        trialStartsAt:      db.trial_starts_at    || null,
        trialEndsAt:        db.trial_ends_at       || null,
        isFreePass:         db.is_free_pass        === true,
        freePassNote:       db.free_pass_note      || null,
        hasAccess,

        // Subscription — snake_case (kept for any legacy consumers)
        subscription_status: db.subscription_status || 'trialing',
        is_free_pass:        db.is_free_pass        === true,
        trial_ends_at:       db.trial_ends_at       || null,

        // Branding
        companyLogoUrl:      db.company_logo_url    || null,
        companyWebsite:      db.company_website     || null,
        companyAddress:      db.company_address     || null,
        companyPhone:        db.company_phone       || null,
        brandPrimaryColor:   db.brand_primary_color   || '#f59e0b',
        brandSecondaryColor: db.brand_secondary_color || '#0f172a',
        proposalFooterText:  db.proposal_footer_text  || null,
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma':        'no-cache',
        'Expires':       '0',
      }
    });

  } catch (error: any) {
    // ── Config error: DATABASE_URL missing ────────────────────────────────────
    // This is a genuine misconfiguration — return a clear code but NOT 401.
    // UserContext must NOT treat this as "logged out".
    if (error instanceof DbConfigError) {
      console.error('[/api/auth/me] DATABASE_URL not configured:', error.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error. Please contact your administrator.',
          code: 'DB_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // ── Transient error: cold start / network timeout ─────────────────────────
    // getDbReady() already retried 3x — if we still land here, DB is temporarily
    // unreachable. Return DB_STARTING so UserContext can retry instead of logging out.
    if (isTransientDbError(error)) {
      console.warn('[/api/auth/me] DB temporarily unreachable after retries:', error.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Server is starting up — please wait a moment.',
          code: 'DB_STARTING',
          retryAfterMs: 3000,
        },
        {
          status: 503,
          headers: { 'Retry-After': '3' },
        }
      );
    }

    // ── Unexpected error ──────────────────────────────────────────────────────
    console.error('[/api/auth/me] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get user' },
      { status: 500 }
    );
  }
}