export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// GET /api/network/my-claims
// Opportunities the current user has claimed.
// Includes full address since they're the claimer.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20'));
  const offset = (page - 1) * limit;

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        o.*,
        c.id            AS claim_id,
        c.status        AS claim_status,
        c.price_paid,
        c.contractor_notes,
        c.outcome,
        c.outcome_notes,
        c.outcome_at,
        c.first_contact_at,
        c.claim_expires_at,
        c.created_at    AS claimed_at
      FROM opportunity_claims c
      JOIN opportunities o ON o.id = c.opportunity_id
      WHERE c.claimed_by_user_id = ${user.id}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const assignmentRows = await sql`
      SELECT
        no.id,
        no.source_type AS source,
        no.status,
        NULL::text AS site_name,
        no.address,
        no.location_city AS city,
        no.location_state AS state_code,
        no.location_zip AS zip,
        no.estimated_system_size_kw AS system_size_kw,
        no.annual_usage_kwh AS annual_kwh,
        no.monthly_usage_avg_kwh AS monthly_kwh_avg,
        no.utility_provider AS utility_name,
        no.utility_rate_per_kwh,
        no.estimated_project_value AS estimated_system_cost,
        no.estimated_payback_yrs,
        no.roof_material,
        no.roof_pitch,
        no.roof_condition,
        no.roof_age_years,
        no.stories,
        no.structure_type,
        no.roof_usable_pct AS usable_roof_pct,
        no.battery_candidate,
        no.steep_roof_flag AS steep_roof,
        (COALESCE(no.ahj_complexity_score, 0) >= 70) AS complex_ahj,
        no.ahj_name,
        NULL::text AS equipment_ecosystem,
        no.asking_price,
        no.screening_notes AS listing_notes,
        no.expires_at,
        no.created_at,
        oa.id AS claim_id,
        oa.status AS claim_status,
        oa.claim_amount AS price_paid,
        NULL::text AS contractor_notes,
        oa.close_status AS outcome,
        oa.lost_reason AS outcome_notes,
        oa.closed_at AS outcome_at,
        oa.first_contact_at,
        oa.offer_expires_at AS claim_expires_at,
        oa.claimed_at AS claimed_at
      FROM opportunity_assignments oa
      JOIN network_opportunities no ON no.id = oa.opportunity_id
      WHERE oa.contractor_id = ${user.id}
        AND oa.status IN ('claimed','contacted','appointment','proposal','won')
      ORDER BY oa.claimed_at DESC NULLS LAST, oa.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*) AS total
        FROM opportunity_claims
       WHERE claimed_by_user_id = ${user.id}
    `;

    const assignmentCountRows = await sql`
      SELECT COUNT(*) AS total
      FROM opportunity_assignments
      WHERE contractor_id = ${user.id}
        AND status IN ('claimed','contacted','appointment','proposal','won')
    `;

    const legacyTotal = parseInt(String(countRows[0]?.total ?? '0'));
    const assignmentTotal = parseInt(String(assignmentCountRows[0]?.total ?? '0'));

    return NextResponse.json({
      success: true,
      claims: [...assignmentRows, ...rows],
      total: legacyTotal + assignmentTotal,
      page,
      limit,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/network/my-claims]', err);
  }
}
