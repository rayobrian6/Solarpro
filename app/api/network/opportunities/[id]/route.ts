export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

type Params = { params: { id: string } };

// ---------------------------------------------------------------------------
// GET /api/network/opportunities/[id]
// Full opportunity detail.
// Pre-claim: address is hidden. Post-claim (by claimer): full address shown.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT o.*,
             u.company AS creator_company,
             u.name    AS creator_name,
             c.id      AS claim_id,
             c.status  AS claim_status,
             c.claimed_by_user_id
        FROM opportunities o
        JOIN users u ON u.id = o.created_by_user_id
        LEFT JOIN opportunity_claims c
          ON c.opportunity_id = o.id
         AND c.status NOT IN ('released', 'expired')
       WHERE o.id = ${id}
       LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    const opp = rows[0] as Record<string, unknown>;

    // Determine if caller has claimed this or is the creator
    const isClaimer = opp.claimed_by_user_id === user.id;
    const isCreator = opp.created_by_user_id === user.id;
    const canSeeAddress = isClaimer || isCreator;

    // Scrub address if not entitled
    if (!canSeeAddress) {
      delete opp.address;
      delete opp.lat;
      delete opp.lng;
    }

    return NextResponse.json({
      success: true,
      opportunity: opp,
      viewer: {
        is_creator: isCreator,
        is_claimer: isClaimer,
        can_claim: opp.status === 'open' && !isCreator && !opp.claim_id,
      },
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/network/opportunities/:id]', err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/network/opportunities/[id]
// Creator can update listing_notes, asking_price, or withdraw the opportunity.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const sql = await getDbReady();
    const body = await req.json();

    // Verify ownership
    const owns = await sql`
      SELECT id, status FROM opportunities
       WHERE id = ${id} AND created_by_user_id = ${user.id}
       LIMIT 1
    `;
    if (!owns.length) {
      return NextResponse.json({ error: 'Not found or not yours' }, { status: 404 });
    }

    const current = owns[0] as Record<string, unknown>;
    if (!['open', 'claimed'].includes(current.status as string)) {
      return NextResponse.json({ error: 'Cannot edit a closed or withdrawn opportunity' }, { status: 400 });
    }

    const { listing_notes, asking_price, withdraw } = body;

    if (withdraw === true) {
      const [updated] = await sql`
        UPDATE opportunities
           SET status = 'withdrawn', updated_at = NOW()
         WHERE id = ${id}
         RETURNING id, status
      `;
      return NextResponse.json({ success: true, opportunity: updated });
    }

    const [updated] = await sql`
      UPDATE opportunities
         SET listing_notes = COALESCE(${listing_notes ?? null}, listing_notes),
             asking_price  = COALESCE(${asking_price ?? null}, asking_price),
             updated_at    = NOW()
       WHERE id = ${id}
       RETURNING *
    `;

    return NextResponse.json({ success: true, opportunity: updated });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/network/opportunities/:id]', err);
  }
}
