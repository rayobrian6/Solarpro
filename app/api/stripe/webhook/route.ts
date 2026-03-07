import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe, handleWebhookEvent } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    // Handle the event
    const result = await handleWebhookEvent(event);

    console.log(`[Stripe Webhook] ${event.type}: ${result.message}`);

    return NextResponse.json({ received: true, ...result });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message || 'Webhook handler failed' }, { status: 500 });
  }
}
