export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// GET /api/stripe/customer-status
// Returns whether the authenticated user has a Stripe customer ID on file.
// Used by the billing page to decide whether to show the "Manage Billing" portal button.
// Does NOT expose the actual Stripe customer ID to the client.
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const sql = await getDbReady();
    const rows = await sql`
      SELECT stripe_customer_id IS NOT NULL AND stripe_customer_id != '' AS has_stripe
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;

    const hasStripe = rows.length > 0 ? (rows[0].has_stripe as boolean) : false;

    return NextResponse.json({ success: true, hasStripe });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/stripe/customer-status]', err);
  }
}