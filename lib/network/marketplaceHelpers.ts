/**
 * Marketplace shared types and helper functions.
 * Used by network/page.tsx and extracted marketplace components.
 */

import {
  formatDisplayValue,
  type EnrichmentCarrier,
  stateTone,
  type EnrichmentChip,
} from "@/lib/network/opportunityEnrichmentDisplay";

// Re-export for downstream consumers
export {
  formatDisplayValue,
  stateTone,
  type EnrichmentCarrier,
  type EnrichmentChip,
} from "@/lib/network/opportunityEnrichmentDisplay";

export type MarketplaceValueSource =
  | "homeowner_entered"
  | "parsed_bill"
  | "estimated"
  | "qualification"
  | "operator_review"
  | "release_gate"
  | "marketplace";

export interface MarketplaceSourcedValue<T> {
  value: T;
  source: MarketplaceValueSource;
  label: string;
}

export interface MarketplaceBadge {
  label: string;
  tone: "emerald" | "amber" | "blue" | "violet" | "orange" | "rose" | "slate";
  reason: string;
  source: string;
}

export interface MarketplaceConfidenceProjection {
  level: "high" | "medium" | "low";
  score: number;
  label: string;
  reasons: string[];
  warnings: string[];
}

export interface MarketplaceNarrativeProjection {
  headline: string;
  summary: string;
  bullets: string[];
  source_note: string;
}

export interface MarketplaceBillVisualsProjection {
  status: string | null;
  confidence_label: string | null;
  confidence_score: number | null;
  parser_method: string | null;
  parser_model: string | null;
  parser_input: string | null;
  months_found: number;
  monthly_usage_history: number[];
  extracted_fields: string[];
  bill_type: string | null;
}

export type IntelligenceLevel = "high" | "medium" | "low" | "unknown";

export interface IntelligenceRange {
  min: number;
  max: number;
  midpoint: number;
  unit: "usd" | "percent" | "score" | "kw" | "kwh";
  label: string;
}

export interface IntelligenceEvidenceNote {
  label: string;
  value: string;
  source: string;
}

export interface PurchaseProfileProjection {
  likely_purchase_method: string;
  purchase_method_label: string;
  homeowner_seriousness: string;
  seriousness_label: string;
  urgency: IntelligenceLevel;
  urgency_label: string;
  readiness_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
}

export interface ProjectValueProjection {
  project_value_range: IntelligenceRange | null;
  gross_revenue_range: IntelligenceRange | null;
  annual_savings_range: IntelligenceRange | null;
  value_label: string;
  revenue_label: string;
  basis: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
}

export interface MarketplaceRevenueProjectionDetail {
  pricing_assumption: {
    state_code: string;
    low_price_per_watt: number;
    market_price_per_watt: number;
    premium_price_per_watt: number;
    source_label: string;
  };
  project_value_range: IntelligenceRange | null;
  low_install_estimate: number | null;
  market_average_estimate: number | null;
  premium_install_estimate: number | null;
  financed_payment_range: IntelligenceRange | null;
  ppa_lease_payment_range: IntelligenceRange | null;
  battery_attachment_value: IntelligenceRange | null;
  battery_inclusive_value_range: IntelligenceRange | null;
  install_complexity_modifier: {
    factor: number;
    label: string;
    applied: boolean;
  };
  project_value_display_label: string;
  battery_inclusive_display_label: string;
  financed_payment_label: string;
  ppa_lease_payment_label: string;
  payment_replacement_label: string;
  utility_arbitrage_label: string;
  estimated_monthly_utility_reduction: number | null;
  gross_opportunity_tier:
    | "premium"
    | "high"
    | "standard"
    | "developing"
    | "unknown";
  gross_opportunity_label: string;
  opportunity_score_contribution: number;
  payment_profile_label: string;
  basis: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

export interface PurchaseBehaviorProjection {
  tags: string[];
  primary_behavior: string;
  behavior_label: string;
  confidence: IntelligenceLevel;
  sales_fit_score: number;
  closeability_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

export interface FinancingIntelligenceProjection {
  likelihood: IntelligenceLevel;
  likelihood_label: string;
  score: number;
  payment_readiness_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

export interface ComplexityProjection {
  level: IntelligenceLevel;
  label: string;
  score: number;
  evidence: IntelligenceEvidenceNote[];
  risks?: string[];
  missing: string[];
  closing_difficulty?: IntelligenceLevel;
  closing_difficulty_label?: string;
  profitability_signal?: string;
  profitability_label?: string;
}

export interface OpportunityScoreProjection {
  score: number;
  label: string;
  tier: "elite" | "strong" | "developing" | "limited";
  reasons: string[];
  cautions: string[];
}

export interface MarketplaceHeroMetricProjection {
  key:
    | "project_value"
    | "payment_estimate"
    | "system_size"
    | "opportunity_score";
  label: string;
  value: string;
  subtext: string;
  tone: MarketplaceBadge["tone"];
  priority: number;
}

export interface MarketplaceTrustSignalProjection {
  label: string;
  verified: boolean;
  tone: MarketplaceBadge["tone"];
  reason: string;
  source: string;
}

export interface MarketplacePaymentPathProjection {
  key: "financed" | "lease_ppa" | "utility_replacement";
  label: string;
  value: string;
  sales_copy: string;
  tone: MarketplaceBadge["tone"];
}

export interface MarketplaceExperienceProjection {
  hero_metrics: MarketplaceHeroMetricProjection[];
  trust_signals: MarketplaceTrustSignalProjection[];
  why_this_scores_high: string[];
  economic_story: string[];
  payment_paths: MarketplacePaymentPathProjection[];
  acquisition_tags: string[];
  deal_attractiveness: string[];
  liquidity_label: string;
  confidence_story: string;
  source_note: string;
}

export interface MarketplaceIntelligenceProjection {
  confidence: MarketplaceConfidenceProjection;
  badges: MarketplaceBadge[];
  narrative: MarketplaceNarrativeProjection;
  revenue: {
    estimated_project_value: MarketplaceSourcedValue<number> | null;
    estimated_system_size_kw: MarketplaceSourcedValue<number> | null;
    monthly_bill_amount: MarketplaceSourcedValue<number> | null;
    annual_usage_kwh: MarketplaceSourcedValue<number> | null;
    monthly_usage_avg_kwh: MarketplaceSourcedValue<number> | null;
    utility_rate_per_kwh: MarketplaceSourcedValue<number> | null;
    estimated_annual_savings: MarketplaceSourcedValue<number> | null;
    estimated_offset_pct: MarketplaceSourcedValue<number> | null;
    estimated_payback_yrs: MarketplaceSourcedValue<number> | null;
    utility_provider: MarketplaceSourcedValue<string> | null;
    projection?: MarketplaceRevenueProjectionDetail;
  };
  purchase_profile?: PurchaseProfileProjection;
  purchase_behavior?: PurchaseBehaviorProjection;
  project_value?: ProjectValueProjection;
  financing?: FinancingIntelligenceProjection;
  sales_complexity?: ComplexityProjection;
  install_complexity?: ComplexityProjection;
  opportunity_score?: OpportunityScoreProjection;
  experience?: MarketplaceExperienceProjection;
  bill_visuals?: MarketplaceBillVisualsProjection;
  evidence: {
    homeowner_intake: Record<string, unknown>;
    bill_evidence: Record<string, unknown>;
    parsed_bill: Record<string, unknown>;
    qualification: Record<string, unknown>;
    operator_review: Record<string, unknown>;
    screening: Record<string, unknown>;
    source_separation: Record<string, unknown>;
  };
  release: {
    ok: boolean;
    blockers: string[];
    warnings: string[];
    missing: string[];
  };
}

export interface Opportunity extends EnrichmentCarrier {
  id: string;
  source: "contractor_shared" | "solarpro_generated";
  status: string;
  site_name: string | null;
  city: string | null;
  state_code: string | null;
  zip: string | null;
  system_size_kw: number | null;
  annual_kwh: number | null;
  monthly_kwh_avg: number | null;
  utility_name: string | null;
  utility_rate_per_kwh: number | null;
  estimated_system_cost: number | null;
  estimated_payback_yrs: number | null;
  monthly_bill_amount?: number | null;
  homeowner_status?: string | null;
  timeline?: string | null;
  finance_readiness?: boolean | null;
  lead_grade?: string | null;
  qualification_status?: string | null;
  estimated_income_band?: string | null;
  estimated_credit_band?: string | null;
  sunlight_confidence?: string | null;
  property_type?: string | null;
  battery_interest?: string | null;
  preferred_contact_method?: string | null;
  roof_material: string | null;
  roof_pitch: string | null;
  roof_condition: string | null;
  roof_age_years: number | null;
  stories: string | null;
  structure_type: string | null;
  usable_roof_pct: number | null;
  battery_candidate: boolean;
  steep_roof: boolean;
  complex_ahj: boolean;
  ahj_name: string | null;
  equipment_ecosystem: string | null;
  asking_price: number | null;
  listing_notes: string | null;
  expires_at: string;
  created_at: string;
  creator_company: string | null;
  // after claim:
  address?: string;
  claim_id?: string;
  claim_status?: string;
  homeowner_name?: string | null;
  homeowner_email?: string | null;
  homeowner_phone?: string | null;
  claimed_by_user_id?: string;
  marketplace_status?: string;
  claim_mode?: "exclusive" | "shared" | string;
  claim_count?: number;
  max_claims?: number;
  released_at?: string | null;
  estimated_annual_savings?: number | null;
  estimated_offset_pct?: number | null;
  marketplace_intelligence?: MarketplaceIntelligenceProjection | null;
}

export interface ContractorProfile {
  battery_certified: boolean;
  commercial_capable: boolean;
  roofing_capable: boolean;
  steep_roof_capable: boolean;
  ev_charger_capable: boolean;
  generator_capable: boolean;
  service_states: string[];
  service_zips: string[];
  travel_radius_miles: number;
  equipment_ecosystems: string[];
  min_project_kw: number | null;
  max_project_kw: number | null;
  network_active: boolean;
  profile_complete: boolean;
}

export type Tab = "discover" | "my-shared" | "my-claims" | "profile";

export function fmtKw(kw: number | null) {
  if (!kw) return "—";
  return kw >= 10 ? `${Math.round(kw)} kW` : `${kw.toFixed(1)} kW`;
}
export function fmtCurrency(n: number | null) {
  if (!n) return "—";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function fmtRate(r: number | null) {
  if (!r) return "—";
  return `${(r * 100).toFixed(1)}¢/kWh`;
}
export function fmtBool(value: boolean | null | undefined) {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}
export function daysLeft(expires: string) {
  const d = Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
  return d <= 0 ? "Expired" : d === 1 ? "1 day left" : `${d} days left`;
}
export function contractorToneClasses(
  tone: EnrichmentChip["tone"] | ReturnType<typeof stateTone>,
) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/40 bg-amber-500/15 text-amber-400",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    slate: "border-slate-700 bg-slate-800/70 text-slate-400",
  };
  return tones[tone] ?? tones.slate;
}

export function sourceLabel(source: MarketplaceValueSource | string | undefined) {
  const labels: Record<string, string> = {
    homeowner_entered: "Homeowner-entered",
    parsed_bill: "Parsed bill",
    estimated: "Estimated",
    qualification: "Qualification",
    operator_review: "Operator-reviewed",
    release_gate: "Release gate",
    marketplace: "Marketplace",
  };
  return source
    ? (labels[source] ?? source.replace(/_/g, " "))
    : "Available data";
}

export function sourcedNumber(
  value: MarketplaceSourcedValue<number> | null | undefined,
  formatter: (n: number | null) => string,
  fallback = "Awaiting validation",
) {
  return value ? formatter(value.value) : fallback;
}

export function fmtKwh(n: number | null | undefined) {
  if (!n) return "—";
  return Math.round(n).toLocaleString("en-US") + " kWh";
}

export function fmtPct(n: number | null | undefined) {
  if (!n) return "—";
  return Math.round(n) + "%";
}

export function moneyRange(
  range: IntelligenceRange | null | undefined,
  fallback = "Awaiting validation",
) {
  if (!range) return fallback;
  const min =
    "$" + range.min.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const max =
    "$" + range.max.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return range.min === range.max ? min : `${min}–${max}`;
}

export function compactRange(
  range: IntelligenceRange | null | undefined,
  fallback = "Awaiting validation",
) {
  return moneyRange(range, fallback).replace(/,000/g, "k").replace(/000/g, "k");
}

export function intelligenceTone(level: IntelligenceLevel | string | undefined) {
  if (level === "high" || level === "elite" || level === "strong")
    return "text-emerald-300";
  if (level === "medium" || level === "developing") return "text-amber-300";
  if (level === "low") return "text-slate-300";
  return "text-slate-500";
}

export function graceful(
  value: string | null | undefined,
  fallback = "Awaiting validation",
) {
  return value && value !== "—" ? value : fallback;
}

export function intelligenceBadgeTone(tone: MarketplaceBadge["tone"]) {
  return contractorToneClasses(tone);
}

export function confidenceClasses(
  level: MarketplaceConfidenceProjection["level"] | undefined,
) {
  if (level === "high")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (level === "medium")
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-slate-700 bg-slate-800/70 text-slate-300";
}

export function evidenceValue(value: unknown) {
  if (value == null || value === "" || value === "\u2014")
    return "Awaiting validation";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return formatDisplayValue(String(value));
}
