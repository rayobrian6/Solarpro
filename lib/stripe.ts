/**
 * lib/stripe.ts
 * Stripe integration for SolarPro subscription payments.
 * 
 * REQUIRED ENVIRONMENT VARIABLES:
 * - STRIPE_SECRET_KEY: Your Stripe secret key (sk_test_... or sk_live_...)
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret (whsec_...)
 * - NEXT_PUBLIC_BASE_URL: Your app's base URL (e.g., https://solarpro.app)
 * 
 * OPTIONAL (for price IDs):
 * - STRIPE_PRICE_STARTER: Price ID for Starter plan
 * - STRIPE_PRICE_PROFESSIONAL: Price ID for Professional plan  
 * - STRIPE_PRICE_CONTRACTOR: Price ID for Contractor plan
 */

import Stripe from 'stripe';
import { getDb } from './db-neon';

// Initialize Stripe with secret key (lazy init to avoid build-time errors)
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set. Please add it to your .env file or deployment environment.');
    }
    _stripe = new Stripe(key, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });
  }
  return _stripe;
}

// Export for convenience (will throw at runtime if not configured)
export const stripe = new Proxy({} as Stripe, {
  get(target, prop) {
    return getStripe()[prop as keyof Stripe];
  }
});

// ============================================================
// SUBSCRIPTION PLAN CONFIGURATION
// ============================================================

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  priceId: string;
  interval: 'month';
  features: string[];
  badge?: string;
}

export function getSubscriptionPlans(): SubscriptionPlan[] {
  return [
    {
      id: 'starter',
      name: 'Starter',
      price: 79,
      priceId: process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder',
      interval: 'month',
      features: [
        '3D Design Studio',
        'Proposal generation',
        'NEC-compliant engineering',
        '19 utility rate calculators',
        'Email support',
      ],
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 149,
      priceId: process.env.STRIPE_PRICE_PROFESSIONAL || 'price_professional_placeholder',
      interval: 'month',
      badge: 'Most Popular',
      features: [
        'Everything in Starter',
        'Sol Fence designs',
        'Single-line diagrams',
        'Structural calculations',
        'Priority support',
      ],
    },
    {
      id: 'contractor',
      name: 'Contractor',
      price: 249,
      priceId: process.env.STRIPE_PRICE_CONTRACTOR || 'price_contractor_placeholder',
      interval: 'month',
      features: [
        'Everything in Professional',
        'White-label proposals',
        'Custom branding',
        'API access',
        'Dedicated support',
      ],
    },
  ];
}

// ============================================================
// CUSTOMER MANAGEMENT
// ============================================================

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  name: string,
  companyName?: string
): Promise<string> {
  const sql = getDb();

  const rows = await sql`
    SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
  `;

  if (rows.length > 0 && rows[0].stripe_customer_id) {
    return rows[0].stripe_customer_id as string;
  }

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      userId,
      company: companyName || '',
    },
  });

  await sql`
    UPDATE users 
    SET stripe_customer_id = ${customer.id}, updated_at = NOW()
    WHERE id = ${userId}
  `;

  return customer.id;
}

// ============================================================
// CHECKOUT SESSION
// ============================================================

export async function createCheckoutSession(
  userId: string,
  email: string,
  name: string,
  planId: string,
  companyName?: string
): Promise<{ url: string | null; error?: string }> {
  try {
    const plans = getSubscriptionPlans();
    const plan = plans.find(p => p.id === planId);

    if (!plan) {
      return { url: null, error: 'Invalid plan selected.' };
    }

    if (!plan.priceId || plan.priceId.includes('placeholder')) {
      return { url: null, error: 'Payment processing not yet configured. Please contact support.' };
    }

    const customerId = await getOrCreateStripeCustomer(userId, email, name, companyName);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/dashboard?subscription=success`,
      cancel_url: `${baseUrl}/auth/subscribe?canceled=true`,
      metadata: {
        userId,
        planId,
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
        },
      },
    });

    return { url: session.url };
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return { url: null, error: error.message || 'Failed to create checkout session.' };
  }
}

// ============================================================
// CUSTOMER PORTAL
// ============================================================

export async function createPortalSession(
  userId: string
): Promise<{ url: string | null; error?: string }> {
  try {
    const sql = getDb();

    const rows = await sql`
      SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
    `;

    if (rows.length === 0 || !rows[0].stripe_customer_id) {
      return { url: null, error: 'No subscription found.' };
    }

    const customerId = rows[0].stripe_customer_id as string;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings`,
    });

    return { url: session.url };
  } catch (error: any) {
    console.error('Stripe portal error:', error);
    return { url: null, error: error.message || 'Failed to create portal session.' };
  }
}

// ============================================================
// WEBHOOK HANDLING
// ============================================================

export async function handleWebhookEvent(
  event: Stripe.Event
): Promise<{ success: boolean; message: string }> {
  const sql = getDb();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;

      if (!userId) {
        return { success: false, message: 'No userId in session metadata.' };
      }

      await sql`
        UPDATE users SET
          plan = ${planId || 'starter'},
          subscription_status = 'active',
          stripe_customer_id = ${customerId},
          stripe_subscription_id = ${subscriptionId},
          updated_at = NOW()
        WHERE id = ${userId}
      `;

      return { success: true, message: `Subscription activated for user ${userId}.` };
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const subscriptionId = subscription.id;
      const status = subscription.status;

      const rows = await sql`
        SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1
      `;

      if (rows.length === 0) {
        return { success: false, message: `No user found for customer ${customerId}.` };
      }

      const userId = rows[0].id;

      let ourStatus = 'trialing';
      if (status === 'active') ourStatus = 'active';
      else if (status === 'past_due') ourStatus = 'past_due';
      else if (status === 'canceled' || status === 'unpaid') ourStatus = 'canceled';

      const priceId = subscription.items.data[0]?.price.id;
      const plans = getSubscriptionPlans();
      const plan = plans.find(p => p.priceId === priceId);

      await sql`
        UPDATE users SET
          plan = ${plan?.id || 'starter'},
          subscription_status = ${ourStatus},
          stripe_subscription_id = ${subscriptionId},
          updated_at = NOW()
        WHERE id = ${userId}
      `;

      return { success: true, message: `Subscription ${subscriptionId} updated to ${ourStatus}.` };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const rows = await sql`
        SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1
      `;

      if (rows.length === 0) {
        return { success: false, message: `No user found for customer ${customerId}.` };
      }

      const userId = rows[0].id;

      await sql`
        UPDATE users SET
          plan = 'starter',
          subscription_status = 'canceled',
          updated_at = NOW()
        WHERE id = ${userId}
      `;

      return { success: true, message: `Subscription canceled for user ${userId}.` };
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const rows = await sql`
        SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1
      `;

      if (rows.length > 0) {
        await sql`
          UPDATE users SET
            subscription_status = 'active',
            updated_at = NOW()
          WHERE id = ${rows[0].id} AND is_free_pass = false
        `;
      }

      return { success: true, message: 'Payment succeeded.' };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const rows = await sql`
        SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1
      `;

      if (rows.length > 0) {
        await sql`
          UPDATE users SET
            subscription_status = 'past_due',
            updated_at = NOW()
          WHERE id = ${rows[0].id} AND is_free_pass = false
        `;
      }

      return { success: true, message: 'Payment failed, marked past_due.' };
    }

    default:
      return { success: true, message: `Unhandled event type: ${event.type}` };
  }
}
