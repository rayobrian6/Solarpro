import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

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
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = await getDbReady();
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