/**
 * lib/pricing.config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all SolarPro subscription plan pricing.
 *
 * Every pricing page, subscribe page, landing page, and billing component
 * MUST import from here. Never hardcode prices elsewhere.
 *
 * Stripe price IDs are resolved from environment variables at runtime in
 * lib/stripe.ts — this file is UI-safe (no server-only imports).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Plan IDs ────────────────────────────────────────────────────────────────

export type PlanId = 'starter' | 'professional' | 'contractor' | 'enterprise' | 'free_pass';

// ─── Core pricing config ─────────────────────────────────────────────────────

export interface PlanPricingConfig {
  price: number | null;          // null = custom / contact sales
  usersIncluded: number | null;  // null = unlimited
  extraSeatPrice: number | null; // null = not applicable
  custom?: true;                 // true = enterprise / no self-serve checkout
}

export const PRICING_PLANS: Record<Exclude<PlanId, 'free_pass'>, PlanPricingConfig> = {
  starter: {
    price: 75,
    usersIncluded: 1,
    extraSeatPrice: null,
  },
  professional: {
    price: 150,
    usersIncluded: 3,
    extraSeatPrice: 29,
  },
  contractor: {
    price: 249,
    usersIncluded: null,
    extraSeatPrice: 29,
  },
  enterprise: {
    price: null,
    usersIncluded: null,
    extraSeatPrice: null,
    custom: true,
  },
};

// ─── Display helpers ──────────────────────────────────────────────────────────

/** Returns "$75/mo", "Custom pricing", etc. */
export function formatPlanPrice(planId: Exclude<PlanId, 'free_pass'>): string {
  const cfg = PRICING_PLANS[planId];
  if (!cfg.price) return 'Custom pricing';
  return `$${cfg.price}/mo`;
}

/** Returns "$75/month", "Custom", etc. — for longer displays */
export function formatPlanPriceLong(planId: Exclude<PlanId, 'free_pass'>): string {
  const cfg = PRICING_PLANS[planId];
  if (!cfg.price) return 'Custom';
  return `$${cfg.price}/month`;
}

/** Returns "1 user", "Up to 2 users", "Unlimited users" */
export function formatSeatLimit(planId: Exclude<PlanId, 'free_pass'>): string {
  const cfg = PRICING_PLANS[planId];
  if (cfg.usersIncluded === null) return 'Unlimited users';
  if (cfg.usersIncluded === 1)    return '1 user included';
  return `Up to ${cfg.usersIncluded} users included`;
}

/** Returns extra seat messaging or null if not applicable */
export function formatExtraSeatMsg(planId: Exclude<PlanId, 'free_pass'>): string | null {
  const cfg = PRICING_PLANS[planId];
  if (!cfg.extraSeatPrice) return null;
  return `+$${cfg.extraSeatPrice}/mo per additional user`;
}

// ─── Feature matrix (for comparison table) ───────────────────────────────────

export type FeatureStatus = 'yes' | 'no' | 'partial' | string;

export interface ComparisonFeature {
  label: string;
  starter: FeatureStatus;
  professional: FeatureStatus;
  contractor: FeatureStatus;
}

export const COMPARISON_TABLE: ComparisonFeature[] = [
  { label: '3D Design Studio',          starter: 'yes',       professional: 'yes',       contractor: 'yes'       },
  { label: 'Projects',                  starter: '10',        professional: 'Unlimited', contractor: 'Unlimited' },
  { label: 'Clients',                   starter: '25',        professional: 'Unlimited', contractor: 'Unlimited' },
  { label: 'Electrical Engineering (SLD)', starter: 'no',     professional: 'yes',       contractor: 'yes'       },
  { label: 'Sol Fence Design',          starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'BOM + Structural Calcs',    starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'Permit Packages',           starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'Proposal E-Signing',        starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'White-Label Branding',      starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'Team Members',             starter: 'no',        professional: 'Up to 3',   contractor: 'Unlimited' },
  { label: 'Priority Support',          starter: 'no',        professional: 'yes',       contractor: 'yes'       },
  { label: 'Dedicated Onboarding',      starter: 'no',        professional: 'no',        contractor: 'yes'       },
  { label: 'SLA Support',               starter: 'no',        professional: 'no',        contractor: 'yes'       },
];

// ─── Plan display metadata (UI-only, not billing) ────────────────────────────

export interface PlanDisplayMeta {
  id: Exclude<PlanId, 'free_pass'>;
  name: string;
  tagline: string;
  badge: string | null;
  badgeStyle: 'amber' | 'orange' | 'blue' | 'purple' | null;
  highlight: boolean;  // highlighted / featured card
  ctaLabel: string;
  checkoutType: 'trial' | 'stripe' | 'contact';
}

export const PLAN_DISPLAY: PlanDisplayMeta[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For solo installers getting started',
    badge: null,
    badgeStyle: null,
    highlight: false,
    ctaLabel: 'Start Free Trial',
    checkoutType: 'trial',
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'For growing installers running real volume',
    badge: null,
    badgeStyle: null,
    highlight: false,
    ctaLabel: 'Get Started',
    checkoutType: 'stripe',
  },
  {
    id: 'contractor',
    name: 'Contractor',
    tagline: 'Full platform for serious solar companies',
    badge: 'Most Popular',
    badgeStyle: 'amber',
    highlight: true,
    ctaLabel: 'Get Started',
    checkoutType: 'stripe',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large teams and multi-location companies',
    badge: 'Custom',
    badgeStyle: 'purple',
    highlight: false,
    ctaLabel: 'Contact Sales',
    checkoutType: 'contact',
  },
];

// ─── Plan features list (per plan card) ──────────────────────────────────────

export const PLAN_FEATURES: Record<Exclude<PlanId, 'free_pass'>, { included: string[]; notIncluded: string[] }> = {
  starter: {
    included: [
      '3D design studio',
      'Up to 10 projects',
      'Up to 25 clients',
      'Production analysis (NREL PVWatts)',
      'Google Solar API integration',
      'Utility rate calculators',
      'Proposal generation (preview)',
      'Email support',
    ],
    notIncluded: [
      'Electrical engineering (SLD)',
      'BOM + structural calcs',
      'Permit packages',
      'Sol Fence design',
      'Proposal e-signing',
      'White-label branding',
      'Team members',
      'Priority support',
    ],
  },
  professional: {
    included: [
      'Everything in Starter',
      'Advanced design tools',
      'Full proposal engine with e-signing',
      'Unlimited projects & clients',
      'Electrical engineering (SLD)',
      'BOM + structural calcs',
      'Permit packages',
      'Sol Fence design',
      'Site survey integration',
      'Homeowner portal',
      'White-label branding',
      'Up to 3 team members',
      'Priority support',
    ],
    notIncluded: [],
  },
  contractor: {
    included: [
      'Everything in Professional',
      'Unlimited team members',
      'Operations dashboard',
      'API access',
      'Dedicated onboarding',
      'SLA support',
    ],
    notIncluded: [],
  },
  enterprise: {
    included: [
      'Everything in Contractor',
      'Unlimited users',
      'Multi-company support',
      'Custom integrations',
      'Private API access',
      'Enterprise security controls',
      'Dedicated account manager',
      'Custom SLA',
      'Volume discounts',
      'White-glove onboarding',
    ],
    notIncluded: [],
  },
};
