export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError, isValidUUID } from '@/lib/db-neon';

export async function PUT(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const {
      companyName,
      companyLogoUrl,
      companyWebsite,
      companyAddress,
      companyPhone,
      brandPrimaryColor,
      brandSecondaryColor,
      proposalFooterText,
    } = body;

    const sql = await getDbReady();

    await sql`
      UPDATE users SET
        company               = ${companyName?.trim() || null},
        company_logo_url      = ${companyLogoUrl?.trim() || null},
        company_website       = ${companyWebsite?.trim() || null},
        company_address       = ${companyAddress?.trim() || null},
        company_phone         = ${companyPhone?.trim() || null},
        brand_primary_color   = ${brandPrimaryColor?.trim() || '#f59e0b'},
        brand_secondary_color = ${brandSecondaryColor?.trim() || '#0f172a'},
        proposal_footer_text  = ${proposalFooterText?.trim() || null},
        updated_at            = NOW()
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ success: true, message: 'Branding updated.' });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/settings/branding/route.ts', error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const proposalId = searchParams.get('proposalId');

    const sql = await getDbReady();

    // ── Public access path: look up branding via proposalId ──────────────────
    // Used by the public share-link page (/proposals/view/[id]) which is
    // accessed by homeowners with no auth session. We look up the installer's
    // user record via the proposal → project → user_id join so no credentials
    // are needed and no private user data is exposed.
    if (proposalId) {
      if (!isValidUUID(proposalId)) {
        return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
      }

      const rows = await sql`
        SELECT
          u.company               AS "companyName",
          u.company_logo_url      AS "companyLogoUrl",
          u.company_website       AS "companyWebsite",
          u.company_address       AS "companyAddress",
          u.company_phone         AS "companyPhone",
          u.brand_primary_color   AS "brandPrimaryColor",
          u.brand_secondary_color AS "brandSecondaryColor",
          u.proposal_footer_text  AS "proposalFooterText"
        FROM proposals p
        JOIN projects  pr ON pr.id = p.project_id
        JOIN users     u  ON u.id  = pr.user_id
        WHERE p.id = ${proposalId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        // Proposal not found — return safe defaults so the page still renders
        return NextResponse.json({
          success: true,
          data: {
            companyName: 'SolarPro',
            companyLogoUrl: null,
            companyWebsite: null,
            companyAddress: null,
            companyPhone: null,
            brandPrimaryColor: '#f59e0b',
            brandSecondaryColor: '#0f172a',
            proposalFooterText: null,
          },
        });
      }

      return NextResponse.json({ success: true, data: rows[0] });
    }

    // ── Authenticated path: return the current user's own branding ────────────
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const rows = await sql`
      SELECT
        company               AS "companyName",
        company_logo_url      AS "companyLogoUrl",
        company_website       AS "companyWebsite",
        company_address       AS "companyAddress",
        company_phone         AS "companyPhone",
        brand_primary_color   AS "brandPrimaryColor",
        brand_secondary_color AS "brandSecondaryColor",
        proposal_footer_text  AS "proposalFooterText"
      FROM users WHERE id = ${user.id} LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/settings/branding/route.ts', error);
  }
}