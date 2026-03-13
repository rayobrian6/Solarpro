import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { DbConfigError, isTransientDbError } from '@/lib/db-ready';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// v47.9: Explicit maxDuration prevents Vercel from killing this function during
// DB cold-start retries. /api/auth/me is called on mount/focus/tab-switch.
// Without maxDuration, Vercel Hobby (10s default) can kill during retry loop.
export const maxDuration = 30;

/**
 * GET /api/auth/me
 *
 * JWT is used ONLY to extract the user ID.
 * ALL user data (role, plan, is_free_pass, subscription_status) comes from the DB.
 * Role is NEVER read from the JWT payload.
 *
 * ERROR CODE CONTRACT (used by UserContext and login page):
 *   401                      -- not authenticated (no cookie / expired JWT)
 *   503 + DB_STARTING        -- DB temporarily unreachable (cold start), client MUST retry
 *   503 + DB_CONFIG_ERROR    -- DATABASE_URL missing (genuine misconfiguration)
 *   500 + DB_QUERY_ERROR     -- query ran but returned unexpected results
 *
 * CRITICAL: Only 401 means "log the user out". All other errors mean "wait and retry."
 *
 * LOG CODES (searchable in Vercel function logs):
 *   [AUTH_COOKIE_PRESENT]   -- session cookie found, JWT verification proceeding
 *   [AUTH_COOKIE_MISSING]   -- no session cookie, returning 401
 *   [AUTH_SESSION_CHECK]    -- JWT verified, proceeding to DB fetch
 *   [DATABASE_URL_PRESENT]  -- DATABASE_URL presence logged at cold start
 *   [JWT_SECRET_PRESENT]    -- JWT_SECRET presence logged at cold start
 *   [AUTH_DB_STARTING]      -- transient connection failure
 *   [AUTH_DB_CONFIG_ERROR]  -- DATABASE_URL missing
 *   [AUTH_DB_QUERY_ERROR]   -- unexpected query error
 */
export async function GET(req: NextRequest) {
  // -- Startup env guard (logged once per cold start) --------------------------
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasJwtSecret   = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length > 10;
  console.log(`[DATABASE_URL_PRESENT] present=${hasDatabaseUrl} length=${process.env.DATABASE_URL?.length ?? 0}`);
  console.log(`[JWT_SECRET_PRESENT] present=${hasJwtSecret} length=${process.env.JWT_SECRET?.length ?? 0}`);

  console.log('[AUTH_SESSION_CHECK] GET /api/auth/me received');

  // -- Step 1: Cookie check + JWT validation -----------------------------------
  // No DB needed. If no valid cookie -> 401 (definitive "not authenticated").
  const sessionCookie = req.cookies.get('solarpro_session');
  if (sessionCookie) {
    console.log('[AUTH_COOKIE_PRESENT] Session cookie found, verifying JWT');
  } else {
    console.log('[AUTH_COOKIE_MISSING] No session cookie present, returning 401');
  }

  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const userId = session.id;
  console.log(`[AUTH_SESSION_CHECK] JWT verified, userId=${userId}, fetching from DB`);

  // -- Step 2: Get DB with cold-start retry ------------------------------------
  // getDbReady() fires a SELECT 1 probe with up to 5 retries (300ms/600ms/1200ms/2400ms/4800ms backoff).
  // On genuine config error (missing DATABASE_URL) -> throws DbConfigError.
  // On transient error (cold start / network) -> throws last error after retries.
  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch (err: unknown) {
    return handleDbError(err, 'getDbReady');
  }

  // -- Step 3: Fetch user data -------------------------------------------------
  // Try full column set first. If new columns don't exist (migration pending),
  // fall back to base columns. Both queries wrapped individually so a connection
  // error in either path is correctly classified and returned as DB_STARTING.
  let rows: any[] = [];
  let useFallback = false;

  try {
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
  } catch (fullErr: unknown) {
    // Check if this is a missing-column error (migration not yet run)
    const fullMsg = (fullErr instanceof Error ? fullErr.message : String(fullErr)).toLowerCase();
    const isMissingColumn = fullMsg.includes('column') && (
      fullMsg.includes('does not exist') ||
      fullMsg.includes('undefined') ||
      fullMsg.includes('unknown')
    );

    if (isMissingColumn) {
      // Migration not run yet -- try base columns
      console.warn('[AUTH_DB_QUERY_ERROR] Full query failed (missing columns), trying fallback:', fullMsg);
      useFallback = true;
      try {
        rows = await sql`
          SELECT id, name, email,
            company, phone, role,
            email_verified, created_at
          FROM users WHERE id = ${userId} LIMIT 1
        `;
      } catch (fallbackErr: unknown) {
        // Fallback query also failed -- could be connection error during cold start
        return handleDbError(fallbackErr, 'fallback-query');
      }
    } else {
      // Not a missing-column error -- could be connection error, classify properly
      return handleDbError(fullErr, 'full-query');
    }
  }

  // -- Step 4: User not found --------------------------------------------------
  if (rows.length === 0) {
    // The user ID from JWT has no matching row -- deleted account or stale token
    return NextResponse.json(
      { success: false, error: 'User not found' },
      { status: 404 }
    );
  }

  const db = rows[0];

  // -- Step 5: Compute hasAccess -----------------------------------------------
  const now = new Date();
  const trialEnd = !useFallback && db.trial_ends_at ? new Date(db.trial_ends_at) : null;
  const role = (db.role || '').toLowerCase();
  const hasAccess = useFallback
    ? true  // migration not run yet -- allow access so users aren't locked out
    : (role === 'super_admin' ||
       role === 'admin' ||
       db.is_free_pass === true ||
       db.subscription_status === 'active' ||
       db.subscription_status === 'free_pass' ||
       (db.subscription_status === 'trialing' && trialEnd && trialEnd > now));

  // -- Step 6: Return normalized user object -----------------------------------
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

      // Role -- ALWAYS from DB, never from JWT
      role: db.role || 'user',

      // Subscription -- camelCase (frontend canonical)
      plan:               db.plan               || 'starter',
      subscriptionStatus: db.subscription_status || 'trialing',
      trialStartsAt:      db.trial_starts_at    || null,
      trialEndsAt:        db.trial_ends_at       || null,
      isFreePass:         db.is_free_pass        === true,
      freePassNote:       db.free_pass_note      || null,
      hasAccess,

      // Subscription -- snake_case (kept for any legacy consumers)
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
}

/**
 * Centralised DB error handler for /api/auth/me.
 *
 * CRITICAL CONTRACT:
 *   - DbConfigError        -> 503 DB_CONFIG_ERROR (genuine misconfiguration)
 *   - isTransientDbError() -> 503 DB_STARTING     (cold start / network)
 *   - Everything else      -> 503 DB_STARTING     (SAFE DEFAULT -- never 500)
 *
 * We default to DB_STARTING (not 500) because:
 *   1. Neon can throw unusual error messages during cold start that don't
 *      match any known pattern. Treating them as transient is always safer
 *      than showing "Database not configured" to a logged-in user.
 *   2. UserContext retries on DB_STARTING -- it does NOT retry on 500.
 *   3. The only true fatal condition is missing DATABASE_URL (DbConfigError).
 */
function handleDbError(err: unknown, stage: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);

  // Genuine misconfiguration -- DATABASE_URL missing
  if (err instanceof DbConfigError) {
    console.error(`[AUTH_DB_CONFIG_ERROR] [stage=${stage}] DATABASE_URL not configured: ${msg}`);
    return NextResponse.json(
      {
        success: false,
        error: 'Server configuration error. Please contact your administrator.',
        code: 'DB_CONFIG_ERROR',
      },
      { status: 503 }
    );
  }

  // Transient or unknown error -- always return DB_STARTING so client retries
  // isTransientDbError() check is informational only -- we return DB_STARTING regardless
  const classified = isTransientDbError(err) ? 'transient' : 'unknown-defaulting-to-transient';
  console.warn(`[AUTH_DB_STARTING] [stage=${stage}] [classified=${classified}] DB error: ${msg}`);
  return NextResponse.json(
    {
      success: false,
      error: 'Server is starting up -- please wait a moment.',
      code: 'DB_STARTING',
      retryAfterMs: 2000,
    },
    {
      status: 503,
      headers: { 'Retry-After': '2' },
    }
  );
}