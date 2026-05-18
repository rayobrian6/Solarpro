export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type Params = { params: { id: string } };

// ---------------------------------------------------------------------------
// POST /api/network/opportunities/[id]/claim
// Exclusively claim an opportunity.
// DB-level UNIQUE index prevents race conditions — two contractors hitting
// this simultaneously will result in one 409 and one 201.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const { id } = params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const sql = await getDbReady();

    // Load the opportunity
    const oppRows = await sql`
      SELECT id, status, created_by_user_id, asking_price, site_name, state_code, system_size_kw
        FROM opportunities
       WHERE id = ${id}
       LIMIT 1
    `;

    if (!oppRows.length) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    const opp = oppRows[0] as Record<string, unknown>;

    if (opp.created_by_user_id === user.id) {
      return NextResponse.json({ error: 'You cannot claim your own opportunity.' }, { status: 400 });
    }

    if (opp.status !== 'open') {
      return NextResponse.json({
        error: opp.status === 'claimed'
          ? 'This opportunity has already been claimed by another contractor.'
          : `This opportunity is ${opp.status} and no longer available.`,
      }, { status: 409 });
    }

    // Attempt exclusive claim — UNIQUE index will reject a concurrent claim
    let claim: Record<string, unknown>;
    try {
      const claimRows = await sql`
        INSERT INTO opportunity_claims (
          opportunity_id, claimed_by_user_id, price_paid,
          claim_expires_at
        ) VALUES (
          ${id},
          ${user.id},
          ${opp.asking_price as number | null},
          NOW() + INTERVAL '7 days'
        )
        RETURNING *
      `;
      claim = claimRows[0] as Record<string, unknown>;
    } catch (insertErr: unknown) {
      // Unique constraint violation = race condition, someone beat us
      const msg = (insertErr as Error)?.message ?? '';
      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
        return NextResponse.json({
          error: 'This opportunity was just claimed by another contractor.',
        }, { status: 409 });
      }
      throw insertErr;
    }

    // Mark opportunity as claimed
    await sql`
      UPDATE opportunities
         SET status = 'claimed', updated_at = NOW()
       WHERE id = ${id}
    `;

    // Return claim with full opportunity details (including address — they've claimed it)
    const fullOpp = await sql`
      SELECT * FROM opportunities WHERE id = ${id} LIMIT 1
    `;

    return NextResponse.json({
      success: true,
      claim,
      opportunity: fullOpp[0],
      message: `You have exclusively claimed this opportunity. The homeowner's full address is now visible.`,
    }, { status: 201 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/network/opportunities/:id/claim]', err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/network/opportunities/[id]/claim
// Release a claim — puts the opportunity back to open.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const sql = await getDbReady();

    const updated = await sql`
      UPDATE opportunity_claims
         SET status = 'released', updated_at = NOW()
       WHERE opportunity_id = ${id}
         AND claimed_by_user_id = ${user.id}
         AND status = 'pending'
       RETURNING id
    `;

    if (!updated.length) {
      return NextResponse.json({ error: 'No active claim found for this opportunity.' }, { status: 404 });
    }

    // Reopen the opportunity
    await sql`
      UPDATE opportunities
         SET status = 'open', updated_at = NOW()
       WHERE id = ${id}
    `;

    return NextResponse.json({ success: true, message: 'Claim released. Opportunity is now available again.' });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/network/opportunities/:id/claim]', err);
  }
}
