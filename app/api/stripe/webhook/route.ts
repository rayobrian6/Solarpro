import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import Stripe from 'stripe';
import { stripe, handleWebhookEvent } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    // Verify webhook signature
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      // SECURITY: Reject all webhook events if the secret is not configured —
      // an empty/missing secret would allow unsigned events to be accepted.
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured. Rejecting event.');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );
    } catch (err: unknown) {
      console.error('Webhook signature verification failed:', (err as Error).message);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    // Handle the event
    const result = await handleWebhookEvent(event);

    console.log(`[Stripe Webhook] ${event.type}: ${result.message}`);

    return NextResponse.json({ received: true, ...result });
  } catch (error: unknown) {
    return handleRouteDbError('[Webh]', error);
  }
}
