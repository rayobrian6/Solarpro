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

export type PlanId = 'starter' | 'professional' | 'contractor' | 'enterprise' | 'free_pass';

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price: number | null;       // null = custom
  priceLabel: string;
  priceId: string | null;     // null = no Stripe checkout
  interval: 'month' | null;
  badge?: string;
  trialDays: number;          // 0 = no trial
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
      price: 79,
      priceLabel: '$79/month',
      priceId: process.env.STRIPE_PRICE_STARTER || null,
      interval: 'month',
      trialDays: 3,
      features: [
        'Basic 3D Solar Design Studio',
        'Up to 2 active projects',
        'Up to 5 clients',
        'Preview proposals only',
        'Production analysis (NREL PVWatts)',
        'Google Solar API integration',
        'Utility rate calculators',
        'Email support',
      ],
      notIncluded: [
        'Engineering calculations (SLD)',
        'Permit packet generation',
        'Structural calculations',
        'BOM generation',
        'Proposal e-signing',
        'White-label branding',
        'Sol Fence design',
        'API access',
      ],
      cta: 'Start Free Trial',
      ctaStyle: 'outline',
      checkoutType: 'trial',
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 149,
      priceLabel: '$149/month',
      priceId: process.env.STRIPE_PRICE_PROFESSIONAL || null,
      interval: 'month',
      badge: 'Most Popular',
      trialDays: 0,
      features: [
        'Everything in Starter',
        'Unlimited projects & clients',
        'Full engineering calculations (SLD)',
        'Permit packet generation',
        'Structural calculations',
        'BOM generation',
        'Proposal e-signing',
        'White-label branding',
        'Battery system design',
        'Priority support',
      ],
      cta: 'Subscribe',
      ctaStyle: 'primary',
      checkoutType: 'stripe',
    },
    {
      id: 'contractor',
      name: 'Contractor',
      price: 250,
      priceLabel: '$250/month',
      priceId: process.env.STRIPE_PRICE_CONTRACTOR || null,
      interval: 'month',
      badge: 'Best Value',
      trialDays: 0,
      features: [
        'Everything in Professional',
        'Unlimited team members',
        'Bulk proposal generation',
        'Advanced automation tools',
        'Custom proposal templates',
        'Sol Fence design',
        'API access',
        'Dedicated onboarding',
        'SLA support',
      ],
      cta: 'Subscribe',
      ctaStyle: 'secondary',
      checkoutType: 'stripe',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: null,
      priceLabel: 'Custom pricing',
      priceId: null,
      interval: null,
      trialDays: 0,
      features: [
        'Everything in Contractor',
        'Multi-company accounts',
        'Custom integrations',
        'Private API access',
        'Enterprise security controls',
        'Dedicated account manager',
        'Custom SLA',
        'On-premise deployment option',
        'Volume discounts',
        'White-glove onboarding',
      ],
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
        teamMembers: 3,
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
        teamMembers: null,
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
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return { url: null, error: error.message };
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
  } catch (error: any) {
    return { url: null, error: error.message };
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