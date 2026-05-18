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
    price: 79,
    usersIncluded: 1,
    extraSeatPrice: null,
  },
  professional: {
    price: 149,
    usersIncluded: 2,
    extraSeatPrice: 29,
  },
  contractor: {
    price: 249,
    usersIncluded: 2,
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

/** Returns "$79/mo", "Custom pricing", etc. */
export function formatPlanPrice(planId: Exclude<PlanId, 'free_pass'>): string {
  const cfg = PRICING_PLANS[planId];
  if (!cfg.price) return 'Custom pricing';
  return `$${cfg.price}/mo`;
}

/** Returns "$79/month", "Custom", etc. — for longer displays */
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
  return `${cfg.usersIncluded} users included`;
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
  { label: 'System Design Engine',       starter: 'yes',       professional: 'yes',     contractor: 'yes'     },
  { label: 'Proposal Generation',        starter: 'Preview',   professional: 'yes',     contractor: 'yes'     },
  { label: 'Permit Plan Sets',           starter: 'no',        professional: 'partial', contractor: 'yes'     },
  { label: 'Single-Line Diagram (SLD)',  starter: 'no',        professional: 'partial', contractor: 'yes'     },
  { label: 'Bill of Materials (BOM)',    starter: 'no',        professional: 'partial', contractor: 'yes'     },
  { label: 'CRM & Pipeline',            starter: 'no',        professional: 'partial', contractor: 'yes'     },
  { label: 'Team Collaboration',         starter: 'no',        professional: 'yes',     contractor: 'yes'     },
  { label: 'Engineering Automation',     starter: 'no',        professional: 'partial', contractor: 'yes'     },
  { label: 'Site Survey Integration',    starter: 'no',        professional: 'yes',     contractor: 'yes'     },
  { label: 'Homeowner Portal',           starter: 'no',        professional: 'yes',     contractor: 'yes'     },
  { label: 'Sol Fence Design',           starter: 'no',        professional: 'no',      contractor: 'yes'     },
  { label: 'API Access',                 starter: 'no',        professional: 'no',      contractor: 'yes'     },
  { label: 'Team Members',              starter: '1 user',    professional: 'Up to 2', contractor: '2 + add-ons' },
  { label: 'Active Projects',            starter: 'Limited',   professional: 'Unlimited', contractor: 'Unlimited' },
  { label: 'Support',                    starter: 'Email',     professional: 'Priority', contractor: 'Dedicated' },
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
      'Up to 2 projects',
      'Up to 5 clients',
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
      'Unlimited projects & clients',
      'Advanced design tools',
      'Full proposal engine with e-signing',
      'Electrical engineering (SLD)',
      'BOM + structural calcs',
      'Permit packages',
      'Battery system design',
      'Site survey integration',
      'Homeowner portal',
      'White-label branding',
      '2 team members (+$29/mo each)',
      'Priority support',
    ],
    notIncluded: [],
  },
  contractor: {
    included: [
      'Everything in Professional',
      'Sol Fence design',
      'CRM + pipeline tracking',
      'Bulk proposals',
      'Operations dashboard',
      'API access',
      '2 team members (+$29/mo each)',
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
