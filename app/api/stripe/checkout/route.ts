export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { createCheckoutSession, getSubscriptionPlans } from '@/lib/stripe';
import { getDbReady , handleRouteDbError} from '@/lib/db-neon';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ success: false, error: 'Plan ID is required' }, { status: 400 });
    }

    // Validate plan
    const plans = getSubscriptionPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Invalid plan selected' }, { status: 400 });
    }

    // Get user details from DB
    const sql = await getDbReady();
    const rows = await sql`
      SELECT email, name, company FROM users WHERE id = ${user.id} LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const dbUser = rows[0];

    // Create checkout session
    const result = await createCheckoutSession(
      user.id,
      dbUser.email as string,
      dbUser.name as string,
      planId,
      dbUser.company as string | undefined
    );

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/stripe/checkout/route.ts', error);
  }
}
