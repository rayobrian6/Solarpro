/**
 * lib/stripe.ts
 * Stripe integration for SolarPro subscription payments.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - STRIPE_PRICE_STARTER
 * - STRIPE_PRICE_PROFESSIONAL
 * - STRIPE_PRICE_CONTRACTOR
 * - NEXT_PUBLIC_BASE_URL
 */

import Stripe from 'stripe';
import { getDbReady } from './db-neon';
import { getBaseUrl } from '@/lib/env';

// ============================================================
// LAZY STRIPE INIT (prevents build-time errors)
// ============================================================
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover', typescript: true });
  }
  return _stripe;
}

export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) { return getStripe()[prop as keyof Stripe]; }
});

// ============================================================
// PLAN DEFINITIONS
// ============================================================

// Re-export PlanId from pricing.config so the rest of the codebase
// can import from either place — stripe.ts remains the canonical
// server-side import for billing logic.
export type { PlanId } from '@/lib/pricing.config';
import type { PlanId } from '@/lib/pricing.config';
import { PRICING_PLANS, PLAN_FEATURES } from '@/lib/pricing.config';

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price: number | null;       // null = custom
  priceLabel: string;
  priceId: string | null;     // null = no Stripe checkout
  interval: 'month' | null;
  badge?: string;
  trialDays: number;          // 0 = no trial
  usersIncluded: number | null;
  extraSeatPrice: number | null;
  features: string[];
  notIncluded?: string[];
  cta: string;
  ctaStyle: 'primary' | 'secondary' | 'outline' | 'enterprise';
  checkoutType: 'trial' | 'stripe' | 'contact' | 'none';
}

export function getSubscriptionPlans(): SubscriptionPlan[] {
  return [
    {
      id: 'starter',
      name: 'Starter',
      price: PRICING_PLANS.starter.price,
      priceLabel: `$${PRICING_PLANS.starter.price}/month`,
      priceId: process.env.STRIPE_PRICE_STARTER || null,
      interval: 'month',
      trialDays: 3,
      usersIncluded: PRICING_PLANS.starter.usersIncluded,
      extraSeatPrice: PRICING_PLANS.starter.extraSeatPrice,
      features: PLAN_FEATURES.starter.included,
      notIncluded: PLAN_FEATURES.starter.notIncluded,
      cta: 'Start Free Trial',
      ctaStyle: 'outline',
      checkoutType: 'trial',
    },
    {
      id: 'professional',
      name: 'Professional',
      price: PRICING_PLANS.professional.price,
      priceLabel: `$${PRICING_PLANS.professional.price}/month`,
      priceId: process.env.STRIPE_PRICE_PROFESSIONAL || null,
      interval: 'month',
      trialDays: 0,
      usersIncluded: PRICING_PLANS.professional.usersIncluded,
      extraSeatPrice: PRICING_PLANS.professional.extraSeatPrice,
      features: PLAN_FEATURES.professional.included,
      notIncluded: PLAN_FEATURES.professional.notIncluded,
      cta: 'Get Started',
      ctaStyle: 'primary',
      checkoutType: 'stripe',
    },
    {
      id: 'contractor',
      name: 'Contractor',
      price: PRICING_PLANS.contractor.price,
      priceLabel: `$${PRICING_PLANS.contractor.price}/month`,
      priceId: process.env.STRIPE_PRICE_CONTRACTOR || null,
      interval: 'month',
      trialDays: 0,
      usersIncluded: PRICING_PLANS.contractor.usersIncluded,
      extraSeatPrice: PRICING_PLANS.contractor.extraSeatPrice,
      features: PLAN_FEATURES.contractor.included,
      notIncluded: PLAN_FEATURES.contractor.notIncluded,
      cta: 'Get Started',
      ctaStyle: 'secondary',
      checkoutType: 'stripe',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: PRICING_PLANS.enterprise.price,
      priceLabel: 'Custom pricing',
      priceId: null,
      interval: null,
      trialDays: 0,
      usersIncluded: PRICING_PLANS.enterprise.usersIncluded,
      extraSeatPrice: PRICING_PLANS.enterprise.extraSeatPrice,
      features: PLAN_FEATURES.enterprise.included,
      notIncluded: PLAN_FEATURES.enterprise.notIncluded,
      cta: 'Contact Sales',
      ctaStyle: 'enterprise',
      checkoutType: 'contact',
    },
  ];
}

// ============================================================
// PLAN PERMISSIONS
// ============================================================

export interface PlanPermissions {
  maxProjects: number | null;       // null = unlimited
  maxClients: number | null;
  engineering: boolean;
  permitPackets: boolean;
  structuralCalcs: boolean;
  solFence: boolean;
  bom: boolean;
  whiteLabelBranding: boolean;
  proposalEsigning: boolean;
  proposalPreviewOnly: boolean;
  batteryDesign: boolean;
  teamMembers: number | null;       // null = unlimited
  bulkProposals: boolean;
  apiAccess: boolean;
  multiCompany: boolean;
}

export function getPlanPermissions(plan: PlanId): PlanPermissions {
  switch (plan) {
    case 'starter':
      return {
        maxProjects: 2,
        maxClients: 5,
        engineering: false,
        permitPackets: false,
        structuralCalcs: false,
        solFence: false,
        bom: false,
        whiteLabelBranding: false,
        proposalEsigning: false,
        proposalPreviewOnly: true,
        batteryDesign: false,
        teamMembers: 1,
        bulkProposals: false,
        apiAccess: false,
        multiCompany: false,
      };
    case 'professional':
      return {
        maxProjects: null,
        maxClients: null,
        engineering: true,
        permitPackets: true,
        structuralCalcs: true,
        solFence: false,
        bom: true,
        whiteLabelBranding: true,
        proposalEsigning: true,
        proposalPreviewOnly: false,
        batteryDesign: true,
        teamMembers: 2,         // 2 included; additional seats at +$29/mo
        bulkProposals: false,
        apiAccess: false,
        multiCompany: false,
      };
    case 'contractor':
      return {
        maxProjects: null,
        maxClients: null,
        engineering: true,
        permitPackets: true,
        structuralCalcs: true,
        solFence: true,
        bom: true,
        whiteLabelBranding: true,
        proposalEsigning: true,
        proposalPreviewOnly: false,
        batteryDesign: true,
        teamMembers: 2,         // 2 included; additional seats at +$29/mo
        bulkProposals: true,
        apiAccess: true,
        multiCompany: false,
      };
    case 'enterprise':
    case 'free_pass':
    default:
      return {
        maxProjects: null,
        maxClients: null,
        engineering: true,
        permitPackets: true,
        structuralCalcs: true,
        solFence: true,
        bom: true,
        whiteLabelBranding: true,
        proposalEsigning: true,
        proposalPreviewOnly: false,
        batteryDesign: true,
        teamMembers: null,
        bulkProposals: true,
        apiAccess: true,
        multiCompany: true,
      };
  }
}

// ============================================================
// CUSTOMER MANAGEMENT
// ============================================================

export async function getOrCreateStripeCustomer(
  userId: string, email: string, name: string, companyName?: string
): Promise<string> {
  const sql = await getDbReady();
  const rows = await sql`SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1`;
  if (rows.length > 0 && rows[0].stripe_customer_id) return rows[0].stripe_customer_id as string;

  const customer = await getStripe().customers.create({
    email, name,
    metadata: { userId, company: companyName || '' },
  });

  await sql`UPDATE users SET stripe_customer_id = ${customer.id}, updated_at = NOW() WHERE id = ${userId}`;
  return customer.id;
}

// ============================================================
// CHECKOUT SESSION
// ============================================================

export async function createCheckoutSession(
  userId: string, email: string, name: string, planId: PlanId, companyName?: string
): Promise<{ url: string | null; error?: string }> {
  try {
    const plans = getSubscriptionPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return { url: null, error: 'Invalid plan.' };
    if (!plan.priceId) return { url: null, error: 'Payment not configured for this plan.' };

    const customerId = await getOrCreateStripeCustomer(userId, email, name, companyName);
    const baseUrl = getBaseUrl();

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard?subscription=success`,
      cancel_url: `${baseUrl}/subscribe?canceled=true`,
      metadata: { userId, planId },
      subscription_data: { metadata: { userId, planId } },
    });

    return { url: session.url };
  } catch (error: unknown) {
    console.error('Stripe checkout error:', error);
    return { url: null, error: (error as Error).message };
  }
}

// ============================================================
// CUSTOMER PORTAL
// ============================================================

export async function createPortalSession(userId: string): Promise<{ url: string | null; error?: string }> {
  try {
    const sql = await getDbReady();
    const rows = await sql`SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1`;
    if (!rows[0]?.stripe_customer_id) return { url: null, error: 'No subscription found.' };

    const baseUrl = getBaseUrl();
    const session = await getStripe().billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id as string,
      return_url: `${baseUrl}/account/billing`,
    });

    return { url: session.url };
  } catch (error: unknown) {
    return { url: null, error: (error as Error).message };
  }
}

// ============================================================
// WEBHOOK HANDLING
// ============================================================

export async function handleWebhookEvent(event: Stripe.Event): Promise<{ success: boolean; message: string }> {
  const sql = await getDbReady();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId;
      if (!userId) return { success: false, message: 'No userId in metadata.' };

      await sql`
        UPDATE users SET
          plan = ${planId || 'starter'},
          subscription_status = 'active',
          stripe_customer_id = ${session.customer as string},
          stripe_subscription_id = ${session.subscription as string},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      return { success: true, message: `Activated ${planId} for ${userId}` };
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${sub.customer as string} LIMIT 1`;
      if (!rows[0]) return { success: false, message: 'User not found.' };

      const statusMap: Record<string, string> = {
        active: 'active', past_due: 'past_due',
        canceled: 'canceled', unpaid: 'canceled',
        trialing: 'trialing', incomplete: 'requires_payment',
      };
      const ourStatus = statusMap[sub.status] || 'trialing';
      const priceId = sub.items.data[0]?.price.id;
      const plan = getSubscriptionPlans().find(p => p.priceId === priceId);

      await sql`
        UPDATE users SET
          plan = ${plan?.id || 'starter'},
          subscription_status = ${ourStatus},
          stripe_subscription_id = ${sub.id},
          updated_at = NOW()
        WHERE id = ${rows[0].id}
      `;
      return { success: true, message: `Updated to ${ourStatus}` };
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${sub.customer as string} LIMIT 1`;
      if (!rows[0]) return { success: false, message: 'User not found.' };

      await sql`
        UPDATE users SET plan = 'starter', subscription_status = 'canceled', updated_at = NOW()
        WHERE id = ${rows[0].id}
      `;
      return { success: true, message: 'Subscription canceled.' };
    }

    case 'invoice.payment_succeeded': {
      const inv = event.data.object as Stripe.Invoice;
      const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${inv.customer as string} LIMIT 1`;
      if (rows[0]) {
        await sql`UPDATE users SET subscription_status = 'active', updated_at = NOW() WHERE id = ${rows[0].id} AND is_free_pass = false`;
      }
      return { success: true, message: 'Payment succeeded.' };
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${inv.customer as string} LIMIT 1`;
      if (rows[0]) {
        await sql`UPDATE users SET subscription_status = 'past_due', updated_at = NOW() WHERE id = ${rows[0].id} AND is_free_pass = false`;
      }
      return { success: true, message: 'Payment failed, marked past_due.' };
    }

    default:
      return { success: true, message: `Unhandled: ${event.type}` };
  }
}
// ============================================================
// SEAT BILLING — sync extra-seat quantity on the org owner's subscription
// ============================================================
// Billable seats = (# users in the org) − (users included in the owner's plan).
// Charged via the Stripe "Additional Seat" recurring price (STRIPE_PRICE_EXTRA_SEAT),
// added as a second line item on the owner's subscription with quantity = extras.
// Call this whenever org membership changes (invite accepted, member removed).
// Fully defensive: no-ops (never throws) if anything's missing so membership
// changes never break.
export async function syncSeatsForOrg(
  orgId: string,
): Promise<{ ok: boolean; extraSeats?: number; reason?: string }> {
  try {
    const seatPrice = process.env.STRIPE_PRICE_EXTRA_SEAT;
    if (!seatPrice) return { ok: false, reason: 'STRIPE_PRICE_EXTRA_SEAT not set' };

    const sql = await getDbReady();
    const ownerRows = await sql`
      SELECT u.id, u.plan, u.stripe_subscription_id
      FROM organizations o JOIN users u ON u.id = o.owner_id
      WHERE o.id = ${orgId} LIMIT 1
    `;
    const owner = ownerRows[0] as { plan?: string; stripe_subscription_id?: string } | undefined;
    if (!owner) return { ok: false, reason: 'org owner not found' };
    if (!owner.stripe_subscription_id) return { ok: false, reason: 'owner has no active subscription' };

    const plan = (owner.plan as PlanId) || 'starter';
    const cfg = PRICING_PLANS[plan as Exclude<PlanId, 'free_pass'>];
    // Unlimited / custom plans (enterprise) don't meter seats
    if (!cfg || cfg.usersIncluded === null) return { ok: true, extraSeats: 0, reason: 'plan does not meter seats' };

    const cntRows = await sql`SELECT COUNT(*)::int AS n FROM users WHERE org_id = ${orgId}`;
    const total = (cntRows[0]?.n as number) ?? 1;
    const extra = Math.max(0, total - cfg.usersIncluded);

    const s = getStripe();
    const sub = await s.subscriptions.retrieve(owner.stripe_subscription_id);
    const seatItem = sub.items.data.find((it) => it.price.id === seatPrice);

    if (extra > 0) {
      if (seatItem) {
        await s.subscriptionItems.update(seatItem.id, { quantity: extra, proration_behavior: 'create_prorations' });
      } else {
        await s.subscriptionItems.create({ subscription: owner.stripe_subscription_id, price: seatPrice, quantity: extra, proration_behavior: 'create_prorations' });
      }
    } else if (seatItem) {
      await s.subscriptionItems.del(seatItem.id, { proration_behavior: 'create_prorations' });
    }

    return { ok: true, extraSeats: extra };
  } catch (e) {
    console.error('[syncSeatsForOrg]', (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
}
