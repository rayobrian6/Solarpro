"use client";
import React, { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/ui/AppShell";
import dynamic from "next/dynamic";
import {
  Network,
  Zap,
  Battery,
  Home,
  AlertTriangle,
  MapPin,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  ArrowRight,
  Loader2,
  RefreshCw,
  X,
  Settings2,
  Shield,
  Star,
  Sparkles,
} from "lucide-react";
import {
  buildEnrichmentChips,
  buildEnrichmentDetailGroups,
  fieldValue,
  formatConfidence,
  formatDisplayValue,
  getEnrichmentPayload,
  stateTone,
  type EnrichmentCarrier,
  type EnrichmentChip,
} from "@/lib/network/opportunityEnrichmentDisplay";

// ─── Types ──────────────────────────────────────────────────────────────────

type MarketplaceValueSource =
  | "homeowner_entered"
  | "parsed_bill"
  | "estimated"
  | "qualification"
  | "operator_review"
  | "release_gate"
  | "marketplace";

interface MarketplaceSourcedValue<T> {
  value: T;
  source: MarketplaceValueSource;
  label: string;
}

interface MarketplaceBadge {
  label: string;
  tone: "emerald" | "amber" | "blue" | "violet" | "orange" | "rose" | "slate";
  reason: string;
  source: string;
}

interface MarketplaceConfidenceProjection {
  level: "high" | "medium" | "low";
  score: number;
  label: string;
  reasons: string[];
  warnings: string[];
}

interface MarketplaceNarrativeProjection {
  headline: string;
  summary: string;
  bullets: string[];
  source_note: string;
}

interface MarketplaceBillVisualsProjection {
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

type IntelligenceLevel = "high" | "medium" | "low" | "unknown";

interface IntelligenceRange {
  min: number;
  max: number;
  midpoint: number;
  unit: "usd" | "percent" | "score" | "kw" | "kwh";
  label: string;
}

interface IntelligenceEvidenceNote {
  label: string;
  value: string;
  source: string;
}

interface PurchaseProfileProjection {
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

interface ProjectValueProjection {
  project_value_range: IntelligenceRange | null;
  gross_revenue_range: IntelligenceRange | null;
  annual_savings_range: IntelligenceRange | null;
  value_label: string;
  revenue_label: string;
  basis: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
}

interface MarketplaceRevenueProjectionDetail {
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

interface PurchaseBehaviorProjection {
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

interface FinancingIntelligenceProjection {
  likelihood: IntelligenceLevel;
  likelihood_label: string;
  score: number;
  payment_readiness_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

interface ComplexityProjection {
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

interface OpportunityScoreProjection {
  score: number;
  label: string;
  tier: "elite" | "strong" | "developing" | "limited";
  reasons: string[];
  cautions: string[];
}

interface MarketplaceHeroMetricProjection {
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

interface MarketplaceTrustSignalProjection {
  label: string;
  verified: boolean;
  tone: MarketplaceBadge["tone"];
  reason: string;
  source: string;
}

interface MarketplacePaymentPathProjection {
  key: "financed" | "lease_ppa" | "utility_replacement";
  label: string;
  value: string;
  sales_copy: string;
  tone: MarketplaceBadge["tone"];
}

interface MarketplaceExperienceProjection {
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

interface MarketplaceIntelligenceProjection {
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

interface Opportunity extends EnrichmentCarrier {
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

interface ContractorProfile {
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

type Tab = "discover" | "my-shared" | "my-claims" | "profile";

// ─── Constants ──────────────────────────────────────────────────────────────

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
];
const MARKETPLACE_CARD_INTELLIGENCE_BUILD = "network-card-purchase-revenue-v2";
const CARD_RENDERER_MARKER = "canonical-marketplace-purchase-revenue-v2";
const ECOSYSTEMS = [
  "enphase",
  "solaredge",
  "tesla",
  "franklin",
  "sungrow",
  "goodwe",
  "generac",
  "sol-ark",
  "ecoflow",
  "other",
];
const ECOSYSTEM_LABELS: Record<string, string> = {
  enphase: "Enphase",
  solaredge: "SolarEdge",
  tesla: "Tesla / Powerwall",
  franklin: "Franklin WH",
  sungrow: "Sungrow",
  goodwe: "GoodWe",
  generac: "Generac PWRcell",
  "sol-ark": "Sol-Ark",
  ecoflow: "EcoFlow",
  other: "Other",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtKw(kw: number | null) {
  if (!kw) return "—";
  return kw >= 10 ? `${Math.round(kw)} kW` : `${kw.toFixed(1)} kW`;
}
function fmtCurrency(n: number | null) {
  if (!n) return "—";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtRate(r: number | null) {
  if (!r) return "—";
  return `${(r * 100).toFixed(1)}¢/kWh`;
}
function fmtBool(value: boolean | null | undefined) {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}
function daysLeft(expires: string) {
  const d = Math.ceil((new Date(expires).getTime() - Date.now()) / 86400000);
  return d <= 0 ? "Expired" : d === 1 ? "1 day left" : `${d} days left`;
}
function contractorToneClasses(
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

function sourceLabel(source: MarketplaceValueSource | string | undefined) {
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

function sourcedNumber(
  value: MarketplaceSourcedValue<number> | null | undefined,
  formatter: (n: number | null) => string,
  fallback = "Awaiting validation",
) {
  return value ? formatter(value.value) : fallback;
}

function fmtKwh(n: number | null | undefined) {
  if (!n) return "—";
  return Math.round(n).toLocaleString("en-US") + " kWh";
}

function fmtPct(n: number | null | undefined) {
  if (!n) return "—";
  return Math.round(n) + "%";
}

function moneyRange(
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

function compactRange(
  range: IntelligenceRange | null | undefined,
  fallback = "Awaiting validation",
) {
  return moneyRange(range, fallback).replace(/,000/g, "k").replace(/000/g, "k");
}

function intelligenceTone(level: IntelligenceLevel | string | undefined) {
  if (level === "high" || level === "elite" || level === "strong")
    return "text-emerald-300";
  if (level === "medium" || level === "developing") return "text-amber-300";
  if (level === "low") return "text-slate-300";
  return "text-slate-500";
}

function graceful(
  value: string | null | undefined,
  fallback = "Awaiting validation",
) {
  return value && value !== "—" ? value : fallback;
}

function intelligenceBadgeTone(tone: MarketplaceBadge["tone"]) {
  return contractorToneClasses(tone);
}

function confidenceClasses(
  level: MarketplaceConfidenceProjection["level"] | undefined,
) {
  if (level === "high")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (level === "medium")
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-slate-700 bg-slate-800/70 text-slate-300";
}

function RevenueMetric({
  label,
  value,
  source,
  accent,
}: {
  label: string;
  value: string;
  source?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/35 p-3">
      <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={`font-black text-lg tabular-nums ${accent ?? "text-white"}`}
      >
        {value}
      </div>
      {source && (
        <div className="mt-1 text-[10px] text-slate-500">{source}</div>
      )}
    </div>
  );
}

function evidenceValue(value: unknown) {
  if (value == null || value === "" || value === "—")
    return "Awaiting validation";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return formatDisplayValue(String(value));
}

function EvidencePanel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: { label: string; value: unknown; accent?: string }[];
}) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
      <div className="mb-3">
        <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black">
          {title}
        </p>
        {subtitle && (
          <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="rounded-xl bg-slate-900/55 border border-slate-800/80 p-3"
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
              {item.label}
            </div>
            <div
              className={`font-semibold text-sm ${item.accent ?? "text-white"}`}
            >
              {evidenceValue(item.value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BillVisualsPanel({
  visuals,
}: {
  visuals?: MarketplaceBillVisualsProjection | null;
}) {
  if (
    !visuals ||
    (!visuals.monthly_usage_history.length &&
      !visuals.extracted_fields.length &&
      !visuals.confidence_label &&
      !visuals.parser_method)
  )
    return null;
  const maxUsage = Math.max(...visuals.monthly_usage_history, 1);

  return (
    <section className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-amber-300 text-[10px] uppercase tracking-[0.2em] font-black">
            Enhanced bill visuals
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Contractor-safe parser output projected from the released
            marketplace payload.
          </p>
        </div>
        {visuals.confidence_label && (
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-300">
            {visuals.confidence_label}
          </span>
        )}
      </div>

      {visuals.monthly_usage_history.length ? (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>Monthly usage history</span>
            <span>{visuals.months_found} months</span>
          </div>
          <div className="space-y-1.5">
            {visuals.monthly_usage_history.slice(0, 12).map((kwh, index) => (
              <div
                key={`marketplace-usage-${index}`}
                className="flex items-center gap-2"
              >
                <span className="w-8 text-[10px] text-slate-500">
                  M{index + 1}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400"
                    style={{
                      width: `${Math.max(6, Math.round((kwh / maxUsage) * 100))}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-right text-[10px] font-semibold tabular-nums text-slate-300">
                  {Math.round(kwh).toLocaleString()} kWh
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Parser", value: visuals.parser_method },
          { label: "Model", value: visuals.parser_model },
          { label: "Input", value: visuals.parser_input },
          { label: "Bill Type", value: visuals.bill_type },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl bg-slate-900/55 border border-slate-800/80 p-3"
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
              {item.label}
            </div>
            <div className="font-semibold text-sm text-white truncate">
              {evidenceValue(item.value)}
            </div>
          </div>
        ))}
      </div>

      {visuals.extracted_fields.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visuals.extracted_fields.slice(0, 12).map((field) => (
            <span
              key={field}
              className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300"
            >
              {formatDisplayValue(field)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ContractorEnrichmentChips({ chips }: { chips: EnrichmentChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${contractorToneClasses(chip.tone)}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
function ContractorEnrichmentDetails({ opp }: { opp: Opportunity }) {
  const groups = buildEnrichmentDetailGroups(opp);
  if (!groups.length) return null;
  return (
    <section className="mb-5">
      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">
        Enriched Opportunity Factors
      </p>
      <div className="space-y-3">
        {groups.map((group) => (
          <div
            key={group.title}
            className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-3"
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {group.items.slice(0, 4).map((item) => (
                <div
                  key={`${group.title}-${item.label}`}
                  className="rounded-lg bg-slate-800/50 p-2"
                >
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
                    {item.label}
                  </div>
                  <div className="font-semibold text-sm text-white">
                    {item.value}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    Confidence {formatConfidence(item.confidence)}
                  </div>
                  {item.warnings.length ? (
                    <div className="mt-1 text-[10px] text-amber-300">
                      {item.warnings.join(", ")}
                    </div>
                  ) : null}
                  {item.missing.length ? (
                    <div className="mt-1 text-[10px] text-rose-300">
                      Missing: {item.missing.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Opportunity Card ────────────────────────────────────────────────────────

function OpportunityCard({
  opp,
  onClaim,
  onViewDetail,
  claimed,
}: {
  opp: Opportunity;
  onClaim: (id: string) => void;
  onViewDetail: (opp: Opportunity) => void;
  claimed: boolean;
}) {
  const expiry = daysLeft(opp.expires_at);
  const isUrgent = expiry.includes("day") && parseInt(expiry) <= 3;
  const pitchNum = opp.roof_pitch ? parseInt(opp.roof_pitch) : 0;
  const isSteep = !isNaN(pitchNum) && pitchNum >= 6;
  const payload = getEnrichmentPayload(opp);
  const enrichmentChips = buildEnrichmentChips(opp, "contractor");
  const intelligence = opp.marketplace_intelligence;
  const revenue = intelligence?.revenue;
  const enrichedSystemSize =
    fieldValue<number>(payload, "core", "estimated_system_size_kw") ??
    opp.system_size_kw;
  const enrichedProjectValue =
    fieldValue<number>(payload, "core", "estimated_project_value") ??
    opp.estimated_system_cost;
  const projectValue =
    revenue?.estimated_project_value ??
    (enrichedProjectValue
      ? {
          value: enrichedProjectValue,
          source: "estimated" as const,
          label: "Estimated project value",
        }
      : null);
  const systemSize =
    revenue?.estimated_system_size_kw ??
    (enrichedSystemSize
      ? {
          value: enrichedSystemSize,
          source: "estimated" as const,
          label: "Estimated system size",
        }
      : null);
  const annualUsage =
    revenue?.annual_usage_kwh ??
    (opp.annual_kwh
      ? {
          value: opp.annual_kwh,
          source: "estimated" as const,
          label: "Annual usage",
        }
      : null);
  const monthlyBill =
    revenue?.monthly_bill_amount ??
    (opp.monthly_bill_amount
      ? {
          value: opp.monthly_bill_amount,
          source: "homeowner_entered" as const,
          label: "Homeowner-entered monthly bill",
        }
      : null);
  const rate =
    revenue?.utility_rate_per_kwh ??
    (opp.utility_rate_per_kwh
      ? {
          value: opp.utility_rate_per_kwh,
          source: "estimated" as const,
          label: "Utility rate",
        }
      : null);
  const savings =
    revenue?.estimated_annual_savings ??
    (opp.estimated_annual_savings
      ? {
          value: opp.estimated_annual_savings,
          source: "estimated" as const,
          label: "Estimated annual savings",
        }
      : null);
  const offset =
    revenue?.estimated_offset_pct ??
    (opp.estimated_offset_pct
      ? {
          value: opp.estimated_offset_pct,
          source: "estimated" as const,
          label: "Estimated offset",
        }
      : null);
  const utility = revenue?.utility_provider?.value ?? opp.utility_name;
  const confidence = intelligence?.confidence;
  const revenueProjection = revenue?.projection;
  const purchaseProfile = intelligence?.purchase_profile;
  const purchaseBehavior = intelligence?.purchase_behavior;
  const projectIntelligence = intelligence?.project_value;
  const financing = intelligence?.financing;
  const salesComplexity = intelligence?.sales_complexity;
  const installComplexity = intelligence?.install_complexity;
  const opportunityScore = intelligence?.opportunity_score;
  const experience = intelligence?.experience;
  const heroMetrics = experience?.hero_metrics ?? [];
  const projectHero = heroMetrics.find(
    (metric) => metric.key === "project_value",
  );
  const paymentHero = heroMetrics.find(
    (metric) => metric.key === "payment_estimate",
  );
  const systemHero = heroMetrics.find((metric) => metric.key === "system_size");
  const scoreHero = heroMetrics.find(
    (metric) => metric.key === "opportunity_score",
  );
  const verifiedTrust =
    experience?.trust_signals?.filter((signal) => signal.verified) ?? [];
  const marketplaceBadges = intelligence?.badges ?? [];
  const visibleBadges = marketplaceBadges.length
    ? marketplaceBadges.slice(0, 6)
    : enrichmentChips.slice(0, 5).map((chip) => ({
        label: chip.label,
        tone: chip.tone,
        reason: "Derived from opportunity enrichment data",
        source: "enrichment",
      }));
  const headline =
    intelligence?.narrative?.headline ??
    (opp.source === "solarpro_generated"
      ? "Marketplace opportunity intelligence"
      : "Contractor-shared opportunity");
  const summary = intelligence?.narrative?.summary;

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-700/60 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.13),transparent_34%),#0f1623] shadow-xl shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/35 hover:shadow-emerald-950/25 cursor-pointer"
      onClick={() => onViewDetail(opp)}
    >
      <div
        className={`h-1.5 w-full ${confidence?.level === "high" ? "bg-gradient-to-r from-emerald-400 via-amber-300 to-emerald-500" : opp.battery_candidate ? "bg-gradient-to-r from-amber-500 to-orange-400" : "bg-gradient-to-r from-slate-600 to-emerald-600"}`}
      />
      <div
        className="border-b border-slate-800/70 px-5 py-1 text-[10px] font-mono text-slate-600"
        data-card-renderer-marker
      >
        Card renderer: {CARD_RENDERER_MARKER}
      </div>

      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">
              <Sparkles size={12} /> Purchase + revenue intelligence
            </div>
            <h3 className="text-white font-black text-xl leading-tight truncate">
              {opp.city && opp.state_code
                ? `${opp.city}, ${opp.state_code}`
                : opp.state_code || "Location Pending"}
            </h3>
            <p className="mt-1 text-xs text-slate-400 line-clamp-2">
              {headline}
            </p>
          </div>
          {confidence && (
            <div
              className={`rounded-2xl border px-3 py-2 text-right ${confidenceClasses(confidence.level)}`}
            >
              <div className="text-xl font-black tabular-nums">
                {confidence.score}
              </div>
              <div className="text-[9px] font-bold uppercase tracking-widest">
                Confidence
              </div>
            </div>
          )}
        </div>

        {summary && (
          <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/35 p-3 text-xs leading-relaxed text-slate-300">
            {summary}
          </p>
        )}

        <div className="mb-4 rounded-3xl border border-emerald-400/25 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.24),transparent_36%),rgba(6,78,59,0.16)] p-4 shadow-lg shadow-emerald-950/20">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">
              {projectHero?.label ?? "Project value"}
            </div>
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-200">
              {experience?.liquidity_label ?? "Marketplace claim signal"}
            </div>
          </div>
          <div className="text-4xl font-black leading-none tracking-tight text-white tabular-nums">
            {projectHero?.value ??
              projectIntelligence?.value_label ??
              compactRange(
                revenueProjection?.project_value_range,
                sourcedNumber(projectValue, fmtCurrency, "Value pending"),
              )}
          </div>
          <div className="mt-2 text-xs font-semibold text-emerald-100/80">
            {projectHero?.subtext ??
              revenueProjection?.project_value_display_label ??
              "Estimated marketplace value only"}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <RevenueMetric
            label={paymentHero?.label ?? "Payment estimate"}
            value={
              paymentHero?.value ??
              compactRange(
                revenueProjection?.financed_payment_range,
                financing?.likelihood_label ?? "Payment pending",
              )
            }
            source={
              paymentHero?.subtext ?? revenueProjection?.financed_payment_label
            }
            accent="text-emerald-300"
          />
          <RevenueMetric
            label={systemHero?.label ?? "System size"}
            value={
              systemHero?.value ??
              sourcedNumber(systemSize, fmtKw, "System pending")
            }
            source={systemHero?.subtext ?? sourceLabel(systemSize?.source)}
            accent="text-amber-300"
          />
          <RevenueMetric
            label={scoreHero?.label ?? "Opportunity score"}
            value={
              scoreHero?.value ?? opportunityScore?.label ?? "Score pending"
            }
            source={scoreHero?.subtext ?? opportunityScore?.tier}
            accent={intelligenceTone(opportunityScore?.tier)}
          />
        </div>

        {experience?.payment_paths?.length ? (
          <div className="mb-4 grid grid-cols-3 gap-2">
            {experience.payment_paths.slice(0, 3).map((path) => (
              <RevenueMetric
                key={path.key}
                label={path.label}
                value={path.value}
                source={path.sales_copy}
                accent={
                  intelligenceBadgeTone(path.tone).includes("blue")
                    ? "text-blue-300"
                    : path.tone === "amber"
                      ? "text-amber-300"
                      : path.tone === "emerald"
                        ? "text-emerald-300"
                        : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <RevenueMetric
              label="Financed pmt"
              value={compactRange(
                revenueProjection?.financed_payment_range,
                financing?.likelihood_label ?? "Financing awaiting validation",
              )}
              source={revenueProjection?.financed_payment_label}
              accent={intelligenceTone(financing?.likelihood)}
            />
            <RevenueMetric
              label="PPA / Lease"
              value={compactRange(
                revenueProjection?.ppa_lease_payment_range,
                "PPA/lease estimate pending",
              )}
              source={revenueProjection?.ppa_lease_payment_label}
              accent={
                purchaseProfile?.likely_purchase_method === "lease_or_ppa"
                  ? "text-blue-300"
                  : undefined
              }
            />
            <RevenueMetric
              label="Offset"
              value={
                offset ? fmtPct(offset.value) : "Offset awaiting validation"
              }
              source={
                offset ? sourceLabel(offset.source) : "Derived estimate pending"
              }
            />
          </div>
        )}

        {experience && (
          <div className="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                Why this scores high
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {experience.confidence_story}
              </div>
            </div>
            <div className="grid gap-1.5">
              {experience.why_this_scores_high.slice(0, 4).map((reason) => (
                <div
                  key={reason}
                  className="flex items-start gap-2 text-slate-200"
                >
                  <CheckCircle
                    size={12}
                    className="mt-0.5 flex-shrink-0 text-emerald-300"
                  />
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(experience?.acquisition_tags?.length ||
          revenueProjection ||
          purchaseBehavior) && (
          <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs">
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
              Estimated acquisition fit
            </div>
            <div className="font-semibold text-white">
              {revenueProjection?.gross_opportunity_label ??
                purchaseBehavior?.behavior_label ??
                "Opportunity economics awaiting validation"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(experience?.acquisition_tags ?? purchaseBehavior?.tags ?? [])
                .slice(0, 6)
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-200"
                  >
                    {tag}
                  </span>
                ))}
            </div>
          </div>
        )}

        {verifiedTrust.length ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {verifiedTrust.slice(0, 5).map((signal) => (
              <span
                key={signal.label}
                title={signal.reason}
                className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-200"
              >
                {signal.label}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
              Sales complexity
            </div>
            <div
              className={`font-semibold ${intelligenceTone(salesComplexity?.level)}`}
            >
              {salesComplexity?.label ?? "Sales complexity awaiting validation"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
              Install complexity
            </div>
            <div
              className={`font-semibold ${intelligenceTone(installComplexity?.level)}`}
            >
              {installComplexity?.label ??
                "Install complexity awaiting validation"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {visibleBadges.map((badge) => (
            <span
              key={`${badge.source}-${badge.label}`}
              title={badge.reason}
              className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide ${intelligenceBadgeTone(badge.tone as MarketplaceBadge["tone"])}`}
            >
              {badge.label}
            </span>
          ))}
          {opp.battery_candidate &&
            !visibleBadges.some((badge) =>
              badge.label.toLowerCase().includes("battery"),
            ) && (
              <span className="flex items-center gap-1 px-2 py-1 bg-amber-500/15 border border-amber-500/40 rounded-lg text-amber-400 text-[10px] font-black uppercase tracking-wide">
                <Battery size={9} /> Battery
              </span>
            )}
          {isSteep && (
            <span className="px-2 py-1 bg-rose-500/15 border border-rose-500/30 rounded-lg text-rose-400 text-[10px] font-black uppercase tracking-wide">
              Steep roof
            </span>
          )}
          {opp.complex_ahj && (
            <span className="px-2 py-1 bg-orange-500/15 border border-orange-500/30 rounded-lg text-orange-400 text-[10px] font-black uppercase tracking-wide">
              Complex AHJ
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-slate-950/30 border border-slate-800/80 p-3">
            <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
              Utility
            </div>
            <div className="font-semibold text-white truncate">
              {utility || "—"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-950/30 border border-slate-800/80 p-3">
            <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
              Timeline
            </div>
            <div className="font-semibold text-white truncate">
              {purchaseProfile?.urgency_label ??
                graceful(formatDisplayValue(opp.timeline), "Timeline pending")}
            </div>
          </div>
        </div>

        {opp.listing_notes && (
          <p className="text-slate-500 text-xs mt-4 italic line-clamp-1">
            &quot;{opp.listing_notes}&quot;
          </p>
        )}
      </div>

      <div className="px-5 pb-4 pt-0">
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-800/80">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {opp.asking_price ? (
                <span className="text-emerald-300 font-black">
                  {fmtCurrency(opp.asking_price)}
                </span>
              ) : (
                <span className="text-slate-500 text-xs font-medium">
                  Price on claim
                </span>
              )}
              <span
                className={`text-xs flex items-center gap-1 ${isUrgent ? "text-orange-300" : "text-slate-500"}`}
              >
                <Clock size={10} />
                {expiry}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-slate-600">
              {intelligence?.evidence?.source_separation
                ? "Homeowner and parsed-bill sources kept separate"
                : `Shared by ${opp.creator_company || "SolarPro contractor"}`}
            </div>
          </div>

          <div
            className="flex gap-2 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {!claimed ? (
              <button
                onClick={() => onClaim(opp.id)}
                className="px-4 py-2 text-xs font-black text-slate-950 bg-emerald-300 hover:bg-emerald-200 rounded-xl transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-950/30"
              >
                Pay &amp; claim <ArrowRight size={12} />
              </button>
            ) : (
              <span className="px-3 py-2 text-xs font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-1.5">
                <CheckCircle size={12} /> Claimed
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Claim Modal ─────────────────────────────────────────────────────────────

function ClaimModal({
  opp,
  onConfirm,
  onCancel,
  loading,
}: {
  opp: Opportunity;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">
              Claim This Opportunity
            </h2>
            <button
              onClick={onCancel}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              {
                label: "Location",
                value:
                  opp.city && opp.state_code
                    ? `${opp.city}, ${opp.state_code}`
                    : opp.state_code || "—",
              },
              {
                label: "System Size",
                value: fmtKw(opp.system_size_kw),
                highlight: true,
              },
              {
                label: "Annual Usage",
                value: opp.annual_kwh
                  ? `${Math.round(opp.annual_kwh).toLocaleString()} kWh`
                  : "—",
              },
              {
                label: "Utility Rate",
                value: fmtRate(opp.utility_rate_per_kwh),
              },
            ].map((item) => (
              <div key={item.label} className="bg-slate-800/60 rounded-xl p-3">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
                  {item.label}
                </div>
                <div
                  className={`font-semibold text-sm ${item.highlight ? "text-amber-400" : "text-white"}`}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 bg-emerald-500/8 border border-emerald-500/25 rounded-xl p-3.5 mb-5">
            <Shield
              size={15}
              className="text-emerald-400 flex-shrink-0 mt-0.5"
            />
            <p className="text-emerald-300 text-xs leading-relaxed">
              <strong>
                {opp.claim_mode === "shared"
                  ? "Shared claim."
                  : "Exclusive claim."}
              </strong>{" "}
              {opp.claim_mode === "shared"
                ? "Once claimed, this opportunity moves to My Claims for you while remaining available until shared capacity is full."
                : "Once claimed, this opportunity is removed from the discovery feed. Only you will see the homeowner's full address and contact details."}
            </p>
          </div>

          {opp.asking_price && (
            <div className="flex items-center justify-between mb-5 px-1">
              <span className="text-slate-400 text-sm">Opportunity price</span>
              <span className="text-emerald-400 font-bold text-xl">
                {fmtCurrency(opp.asking_price)}
              </span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle size={15} />
              )}
              {loading ? "Starting checkout…" : "Pay & claim"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({
  opp,
  onClaim,
  onClose,
  isClaimed,
}: {
  opp: Opportunity;
  onClaim: (id: string) => void;
  onClose: () => void;
  isClaimed: boolean;
}) {
  const intelligence = opp.marketplace_intelligence;
  const revenue = intelligence?.revenue;
  const confidence = intelligence?.confidence;
  const evidence = intelligence?.evidence;
  const release = intelligence?.release;
  const narrative = intelligence?.narrative;
  const billVisuals = intelligence?.bill_visuals;
  const revenueProjection = revenue?.projection;
  const purchaseProfile = intelligence?.purchase_profile;
  const purchaseBehavior = intelligence?.purchase_behavior;
  const projectIntelligence = intelligence?.project_value;
  const financing = intelligence?.financing;
  const salesComplexity = intelligence?.sales_complexity;
  const installComplexity = intelligence?.install_complexity;
  const opportunityScore = intelligence?.opportunity_score;
  const experience = intelligence?.experience;
  const revenueItems = [
    {
      label: "Project Value",
      value: revenue?.estimated_project_value
        ? fmtCurrency(revenue.estimated_project_value.value)
        : fmtCurrency(opp.estimated_system_cost),
      accent: "text-emerald-300",
      source: sourceLabel(
        revenue?.estimated_project_value?.source ?? "estimated",
      ),
    },
    {
      label: "System Size",
      value: revenue?.estimated_system_size_kw
        ? fmtKw(revenue.estimated_system_size_kw.value)
        : fmtKw(opp.system_size_kw),
      accent: "text-amber-300",
      source: sourceLabel(
        revenue?.estimated_system_size_kw?.source ?? "estimated",
      ),
    },
    {
      label: "Monthly Bill",
      value: revenue?.monthly_bill_amount
        ? fmtCurrency(revenue.monthly_bill_amount.value)
        : fmtCurrency(opp.monthly_bill_amount ?? null),
      source: sourceLabel(
        revenue?.monthly_bill_amount?.source ?? "homeowner_entered",
      ),
    },
    {
      label: "Annual Usage",
      value: revenue?.annual_usage_kwh
        ? fmtKwh(revenue.annual_usage_kwh.value)
        : fmtKwh(opp.annual_kwh),
      source: sourceLabel(revenue?.annual_usage_kwh?.source ?? "estimated"),
    },
    {
      label: "Utility Rate",
      value: revenue?.utility_rate_per_kwh
        ? fmtRate(revenue.utility_rate_per_kwh.value)
        : fmtRate(opp.utility_rate_per_kwh),
      accent: "text-emerald-300",
      source: sourceLabel(revenue?.utility_rate_per_kwh?.source ?? "estimated"),
    },
    {
      label: "Annual Savings",
      value: revenue?.estimated_annual_savings
        ? fmtCurrency(revenue.estimated_annual_savings.value)
        : fmtCurrency(opp.estimated_annual_savings ?? null),
      source: "Estimated",
    },
    {
      label: "Offset",
      value: revenue?.estimated_offset_pct
        ? fmtPct(revenue.estimated_offset_pct.value)
        : fmtPct(opp.estimated_offset_pct),
      source: "Estimated",
    },
    {
      label: "Payback",
      value: revenue?.estimated_payback_yrs
        ? `${revenue.estimated_payback_yrs.value.toFixed(1)} yrs`
        : opp.estimated_payback_yrs
          ? `${opp.estimated_payback_yrs.toFixed(1)} yrs`
          : "Payback awaiting validation",
      source: "Estimated",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-3xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">
                <Sparkles size={12} /> Mini deal room
              </div>
              <h2 className="text-white font-black text-2xl leading-tight">
                {narrative?.headline ?? "Opportunity Intelligence"}
              </h2>
              <p className="text-slate-500 text-xs mt-1">
                {opp.city && opp.state_code
                  ? `${opp.city}, ${opp.state_code}`
                  : "Full address revealed after claim"}
              </p>
            </div>
            <div className="flex items-start gap-3">
              {confidence && (
                <div
                  className={`rounded-2xl border px-3 py-2 text-right ${confidenceClasses(confidence.level)}`}
                >
                  <div className="text-xl font-black tabular-nums">
                    {confidence.score}
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-widest">
                    {confidence.label}
                  </div>
                </div>
              )}
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {narrative?.summary && (
            <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
              <p className="text-sm leading-relaxed text-slate-200">
                {narrative.summary}
              </p>
              {narrative.bullets.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {narrative.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="flex items-start gap-2 text-xs text-slate-300"
                    >
                      <CheckCircle
                        size={12}
                        className="mt-0.5 flex-shrink-0 text-emerald-300"
                      />
                      {bullet}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] text-slate-600">
                {narrative.source_note}
              </p>
            </div>
          )}

          {experience?.deal_attractiveness?.length ? (
            <section className="mb-4 rounded-2xl border border-emerald-400/25 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_36%),rgba(16,185,129,0.08)] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-emerald-300 text-[10px] uppercase tracking-[0.2em] font-black">
                    Why this deal is attractive
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Canonical acquisition story derived from verified evidence
                    and estimated marketplaceRevenueProjection outputs.
                  </p>
                </div>
                <span className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-200">
                  {experience.liquidity_label}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {experience.deal_attractiveness.map((reason) => (
                  <div
                    key={reason}
                    className="flex items-start gap-2 rounded-xl border border-slate-800/70 bg-slate-950/30 p-3 text-xs text-slate-200"
                  >
                    <CheckCircle
                      size={13}
                      className="mt-0.5 flex-shrink-0 text-emerald-300"
                    />
                    {reason}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-600">
                {experience.source_note}
              </p>
            </section>
          ) : null}

          {experience?.trust_signals?.length ? (
            <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
              <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Verified trust system
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {experience.trust_signals.map((signal) => (
                  <div
                    key={signal.label}
                    className={`rounded-xl border p-3 ${signal.verified ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-800 bg-slate-900/50"}`}
                  >
                    <div
                      className={`text-[10px] font-black uppercase tracking-wider ${signal.verified ? "text-emerald-300" : "text-slate-500"}`}
                    >
                      {signal.label}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {signal.reason}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-600">
                {experience.confidence_story}
              </p>
            </section>
          ) : null}

          <section className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
            <p className="text-emerald-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
              AI-ranked acquisition snapshot
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <RevenueMetric
                label="Opportunity score"
                value={opportunityScore?.label ?? "Score awaiting validation"}
                source={
                  opportunityScore
                    ? `${opportunityScore.tier} opportunity`
                    : "Requires release and bill evidence"
                }
                accent={
                  opportunityScore
                    ? intelligenceTone(opportunityScore.tier)
                    : "text-slate-500"
                }
              />
              <RevenueMetric
                label="Project value range"
                value={moneyRange(
                  revenueProjection?.project_value_range ??
                    projectIntelligence?.project_value_range,
                  "Project value awaiting validation",
                )}
                source={
                  revenueProjection?.basis ??
                  projectIntelligence?.basis ??
                  "No fake economics shown"
                }
                accent="text-emerald-300"
              />
              <RevenueMetric
                label="Purchase profile"
                value={
                  purchaseProfile?.purchase_method_label ??
                  "Purchase method undetermined"
                }
                source={
                  purchaseProfile?.readiness_label ?? "Qualification pending"
                }
              />
              <RevenueMetric
                label="Urgency"
                value={purchaseProfile?.urgency_label ?? "Timeline pending"}
                source={purchaseProfile?.seriousness_label}
                accent={intelligenceTone(purchaseProfile?.urgency)}
              />
            </div>
            {opportunityScore?.reasons?.length ? (
              <div className="mt-3 grid gap-1.5 text-xs text-emerald-100/80">
                {opportunityScore.reasons.slice(0, 4).map((reason) => (
                  <div key={reason} className="flex items-center gap-2">
                    <CheckCircle size={12} className="text-emerald-300" />{" "}
                    {reason}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <EvidencePanel
            title="Estimated revenue projection"
            subtitle="ESTIMATED only: state pricing assumptions, payment ranges, and opportunity attractiveness. Not a proposal, quote, lender offer, or profit model."
            items={[
              {
                label: "Project Value",
                value: moneyRange(
                  revenueProjection?.project_value_range,
                  "Project value awaiting system size",
                ),
                accent: "text-emerald-300",
              },
              {
                label: "Financed Payment",
                value: moneyRange(
                  revenueProjection?.financed_payment_range,
                  "Financed payment awaiting project value",
                ),
              },
              {
                label: "PPA / Lease Payment",
                value: moneyRange(
                  revenueProjection?.ppa_lease_payment_range,
                  "PPA/lease payment awaiting bill data",
                ),
                accent: "text-blue-300",
              },
              {
                label: "Battery Attachment",
                value: moneyRange(
                  revenueProjection?.battery_attachment_value,
                  "Battery attachment not signaled",
                ),
                accent: "text-amber-300",
              },
              {
                label: "Value With Battery",
                value:
                  revenueProjection?.battery_inclusive_display_label ??
                  "Battery-inclusive range not signaled",
                accent: "text-emerald-300",
              },
              {
                label: "Install Modifier",
                value:
                  revenueProjection?.install_complexity_modifier?.label ??
                  "Install complexity awaiting site validation",
              },
              {
                label: "Gross Opportunity",
                value:
                  revenueProjection?.gross_opportunity_label ??
                  "Opportunity tier awaiting sizing",
                accent: intelligenceTone(
                  revenueProjection?.gross_opportunity_tier,
                ),
              },
              {
                label: "Score Contribution",
                value: revenueProjection
                  ? `${revenueProjection.opportunity_score_contribution}/22 estimated`
                  : "Awaiting revenue projection",
              },
              {
                label: "Pricing Basis",
                value:
                  revenueProjection?.pricing_assumption?.source_label ??
                  "State assumption unavailable",
              },
              {
                label: "Payment Basis",
                value:
                  revenueProjection?.payment_profile_label ??
                  "Payment profile awaiting evidence",
              },
              {
                label: "Payment Replacement",
                value:
                  revenueProjection?.payment_replacement_label ??
                  "Payment replacement awaiting evidence",
                accent: "text-blue-300",
              },
              {
                label: "Utility Arbitrage",
                value:
                  revenueProjection?.utility_arbitrage_label ??
                  "Utility arbitrage awaiting rate evidence",
                accent: "text-amber-300",
              },
            ]}
          />

          {experience?.economic_story?.length ||
          experience?.payment_paths?.length ? (
            <section className="mb-4 rounded-2xl border border-blue-500/20 bg-blue-500/8 p-4">
              <p className="text-blue-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Economic storytelling + payment paths
              </p>
              {experience?.economic_story?.length ? (
                <div className="mb-3 grid gap-2">
                  {experience.economic_story.map((line) => (
                    <div
                      key={line}
                      className="flex items-start gap-2 text-xs text-slate-200"
                    >
                      <TrendingUp
                        size={12}
                        className="mt-0.5 flex-shrink-0 text-blue-300"
                      />
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
              {experience?.payment_paths?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {experience.payment_paths.map((path) => (
                    <RevenueMetric
                      key={path.key}
                      label={path.label}
                      value={path.value}
                      source={path.sales_copy}
                      accent={
                        path.tone === "blue"
                          ? "text-blue-300"
                          : path.tone === "amber"
                            ? "text-amber-300"
                            : path.tone === "emerald"
                              ? "text-emerald-300"
                              : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <EvidencePanel
            title="Purchase behavior"
            subtitle="Sales/acquisition intelligence only. Behavior tags are not underwriting and must be validated in contractor discovery."
            items={[
              {
                label: "Primary Behavior",
                value:
                  purchaseBehavior?.behavior_label ??
                  "Purchase behavior awaiting evidence",
                accent: intelligenceTone(purchaseBehavior?.confidence),
              },
              {
                label: "Behavior Tags",
                value: purchaseBehavior?.tags?.length
                  ? purchaseBehavior.tags.join(" · ")
                  : "No behavior tags validated yet",
              },
              {
                label: "Sales Fit",
                value: purchaseBehavior
                  ? `${purchaseBehavior.sales_fit_score}/100`
                  : "Sales fit awaiting evidence",
              },
              {
                label: "Closeability",
                value:
                  purchaseBehavior?.closeability_label ??
                  "Closeability awaiting qualification evidence",
              },
            ]}
          />

          <EvidencePanel
            title="Purchase intelligence"
            subtitle="Deterministic purchase-readiness signals from intake, qualification, and operator review only."
            items={[
              {
                label: "Likely Purchase Method",
                value:
                  purchaseProfile?.purchase_method_label ??
                  "Purchase method undetermined",
              },
              {
                label: "Homeowner Seriousness",
                value:
                  purchaseProfile?.seriousness_label ??
                  "Homeowner seriousness awaiting validation",
              },
              {
                label: "Urgency",
                value: purchaseProfile?.urgency_label ?? "Timeline pending",
              },
              {
                label: "Readiness",
                value:
                  purchaseProfile?.readiness_label ?? "Qualification pending",
              },
            ]}
          />

          <EvidencePanel
            title="Financing intelligence"
            subtitle="This is not a credit approval or loan quote; it is a deterministic readiness signal."
            items={[
              {
                label: "Likelihood",
                value:
                  financing?.likelihood_label ??
                  "Financing likelihood awaiting validation",
                accent: intelligenceTone(financing?.likelihood),
              },
              {
                label: "Readiness Score",
                value: financing
                  ? `${financing.score}/100`
                  : "Financing score awaiting validation",
              },
              {
                label: "Payment Path",
                value:
                  financing?.payment_readiness_label ??
                  "Payment path not yet validated",
              },
              {
                label: "Disclaimer",
                value:
                  financing?.disclaimers?.[0] ??
                  "No financing terms are invented.",
              },
            ]}
          />

          <EvidencePanel
            title="Sales and install complexity"
            subtitle="Complexity is derived from known sales, bill, qualification, roof, AHJ, and install signals."
            items={[
              {
                label: "Sales Complexity",
                value:
                  salesComplexity?.label ??
                  "Sales complexity awaiting validation",
                accent: intelligenceTone(salesComplexity?.level),
              },
              {
                label: "Closing Difficulty",
                value:
                  salesComplexity?.closing_difficulty_label ??
                  "Closing difficulty awaiting validation",
              },
              {
                label: "Install Complexity",
                value:
                  installComplexity?.label ??
                  "Install complexity awaiting validation",
                accent: intelligenceTone(installComplexity?.level),
              },
              {
                label: "Profitability",
                value:
                  installComplexity?.profitability_label ??
                  "Profitability awaiting install evidence",
              },
            ]}
          />

          <section className="mb-4">
            <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
              Revenue intelligence
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {revenueItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"
                >
                  <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
                    {item.label}
                  </div>
                  <div
                    className={`font-black text-lg tabular-nums ${item.accent ?? "text-white"}`}
                  >
                    {item.value}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-600">
                    {item.source}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {intelligence?.badges?.length ? (
            <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
              <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Intelligence badges
              </p>
              <div className="flex flex-wrap gap-2">
                {intelligence.badges.map((badge) => (
                  <span
                    key={`${badge.source}-${badge.label}`}
                    title={badge.reason}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide ${intelligenceBadgeTone(badge.tone)}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <EvidencePanel
            title="Homeowner intake"
            subtitle="Homeowner-entered values are shown as their own source and are not overwritten by parsed bill data."
            items={[
              {
                label: "Intake Present",
                value: evidence?.homeowner_intake?.present,
              },
              {
                label: "Monthly Bill",
                value: evidence?.homeowner_intake?.monthly_bill_amount
                  ? fmtCurrency(
                      Number(evidence.homeowner_intake.monthly_bill_amount),
                    )
                  : fmtCurrency(opp.monthly_bill_amount ?? null),
                accent: "text-emerald-300",
              },
              {
                label: "Utility",
                value:
                  evidence?.homeowner_intake?.utility_provider ??
                  opp.utility_name,
              },
              {
                label: "Timeline",
                value: evidence?.homeowner_intake?.timeline ?? opp.timeline,
              },
              {
                label: "Financing Interest",
                value:
                  evidence?.homeowner_intake?.financing_interest ??
                  opp.finance_readiness,
              },
              {
                label: "Source",
                value: evidence?.homeowner_intake?.source ?? "opportunity",
              },
            ]}
          />

          <BillVisualsPanel visuals={billVisuals} />

          <EvidencePanel
            title="Bill intelligence"
            subtitle="Parsed bill values support or challenge intake values, but do not silently replace homeowner-entered truth."
            items={[
              {
                label: "Stored Bill",
                value: evidence?.bill_evidence?.stored_attachment,
              },
              {
                label: "Storage Status",
                value: evidence?.bill_evidence?.storage_status,
              },
              {
                label: "Bill Parsed",
                value: evidence?.parsed_bill?.has_real_parser_output,
              },
              {
                label: "Parsed Utility",
                value: evidence?.parsed_bill?.utility_provider,
              },
              {
                label: "Parsed Annual Usage",
                value: evidence?.parsed_bill?.annual_usage_kwh
                  ? fmtKwh(Number(evidence.parsed_bill.annual_usage_kwh))
                  : "—",
              },
              {
                label: "Parsed Rate",
                value: evidence?.parsed_bill?.utility_rate_per_kwh
                  ? fmtRate(Number(evidence.parsed_bill.utility_rate_per_kwh))
                  : "—",
              },
              {
                label: "Parsed Bill Total",
                value: evidence?.parsed_bill?.total_amount
                  ? fmtCurrency(Number(evidence.parsed_bill.total_amount))
                  : "—",
              },
              { label: "Parsed Source", value: evidence?.parsed_bill?.source },
            ]}
          />

          <EvidencePanel
            title="Qualification and financing"
            items={[
              {
                label: "Lead Grade",
                value: evidence?.qualification?.lead_grade ?? opp.lead_grade,
                accent: "text-amber-300",
              },
              {
                label: "Qualification",
                value:
                  evidence?.qualification?.status ?? opp.qualification_status,
              },
              {
                label: "Finance Ready",
                value:
                  evidence?.qualification?.finance_readiness ??
                  opp.finance_readiness,
              },
              { label: "Income Band", value: opp.estimated_income_band },
              { label: "Credit Band", value: opp.estimated_credit_band },
              { label: "Sunlight", value: opp.sunlight_confidence },
              { label: "Owner Status", value: opp.homeowner_status },
              { label: "Battery Interest", value: opp.battery_interest },
            ]}
          />

          <EvidencePanel
            title="Operator review and release readiness"
            items={[
              {
                label: "Contacted",
                value: evidence?.operator_review?.contacted,
              },
              {
                label: "Qualified",
                value: evidence?.operator_review?.qualified,
              },
              {
                label: "Financing Ready",
                value: evidence?.operator_review?.financing_ready,
              },
              {
                label: "Marketplace Approved",
                value: evidence?.operator_review?.approved_for_marketplace,
              },
              {
                label: "Screening Approved",
                value: evidence?.screening?.approved,
              },
              {
                label: "Release Gate",
                value: release
                  ? release.ok
                    ? "Passed"
                    : "Warnings / blockers"
                  : "—",
                accent: release?.ok ? "text-emerald-300" : "text-amber-300",
              },
              { label: "Claim Mode", value: opp.claim_mode ?? "—" },
              {
                label: "Claim Capacity",
                value: opp.max_claims
                  ? `${opp.claim_count ?? 0}/${opp.max_claims}`
                  : "—",
              },
            ]}
          />

          {release?.warnings?.length ||
          release?.blockers?.length ||
          confidence?.warnings?.length ? (
            <section className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
              <p className="text-amber-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Evidence warnings
              </p>
              <div className="space-y-1.5">
                {[
                  ...(release?.warnings ?? []),
                  ...(release?.blockers ?? []),
                  ...(confidence?.warnings ?? []),
                ]
                  .slice(0, 8)
                  .map((warning) => (
                    <div
                      key={warning}
                      className="text-xs text-amber-100/80 flex items-center gap-2"
                    >
                      <AlertTriangle size={12} className="text-amber-300" />
                      {formatDisplayValue(warning)}
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <EvidencePanel
            title="Roof and fit signals"
            items={[
              { label: "Material", value: opp.roof_material },
              {
                label: "Pitch",
                value: opp.roof_pitch,
                accent: opp.steep_roof ? "text-rose-300" : undefined,
              },
              { label: "Condition", value: opp.roof_condition },
              {
                label: "Age",
                value: opp.roof_age_years ? `${opp.roof_age_years} yrs` : "—",
              },
              { label: "Structure", value: opp.structure_type },
              {
                label: "Usable Roof",
                value: opp.usable_roof_pct ? `${opp.usable_roof_pct}%` : "—",
              },
              { label: "Battery Candidate", value: opp.battery_candidate },
              {
                label: "Complex AHJ",
                value: opp.complex_ahj ? opp.ahj_name || "Yes" : false,
              },
            ]}
          />

          <ContractorEnrichmentDetails opp={opp} />

          {opp.address && (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">
                Full Address
              </p>
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 font-medium text-sm">
                <MapPin size={13} />
                {opp.address}
              </div>
            </section>
          )}

          {opp.listing_notes && (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">
                Notes
              </p>
              <p className="text-slate-300 text-sm italic bg-slate-800/50 rounded-lg p-3">
                &quot;{opp.listing_notes}&quot;
              </p>
            </section>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Close
            </button>
            {!isClaimed ? (
              <button
                onClick={() => {
                  onClose();
                  onClaim(opp.id);
                }}
                className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle size={15} />{" "}
                {opp.claim_mode === "shared"
                  ? "Pay & Claim Shared Lead"
                  : opp.claim_mode === "exclusive"
                    ? "Pay & Claim Exclusively"
                    : "Pay & Claim Lead"}
              </button>
            ) : (
              <span className="flex-1 py-2.5 text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2">
                <CheckCircle size={15} />{" "}
                {opp.claim_mode === "shared"
                  ? "Claimed by You"
                  : opp.claim_mode === "exclusive"
                    ? "You Own This"
                    : "Claimed by You"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab({
  profile,
  onSave,
}: {
  profile: ContractorProfile;
  onSave: (p: Partial<ContractorProfile>) => Promise<void>;
}) {
  const [form, setForm] = useState<ContractorProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof ContractorProfile) =>
    setForm((f) => ({ ...f, [key]: !f[key as keyof ContractorProfile] }));

  const toggleState = (s: string) =>
    setForm((f) => ({
      ...f,
      service_states: f.service_states.includes(s)
        ? f.service_states.filter((x) => x !== s)
        : [...f.service_states, s],
    }));

  const toggleEco = (e: string) =>
    setForm((f) => ({
      ...f,
      equipment_ecosystems: f.equipment_ecosystems.includes(e)
        ? f.equipment_ecosystems.filter((x) => x !== e)
        : [...f.equipment_ecosystems, e],
    }));

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h3 className="text-white font-semibold mb-1">Capabilities</h3>
        <p className="text-slate-500 text-sm mb-4">
          Tell the network what types of projects you handle. This determines
          which opportunities surface for you.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              [
                "battery_certified",
                "🔋 Battery Certified",
                "Battery storage installs",
              ],
              [
                "commercial_capable",
                "🏢 Commercial",
                "Commercial & industrial",
              ],
              ["roofing_capable", "🏠 Roofing", "Full roof replacement"],
              ["steep_roof_capable", "📐 Steep Roof", "6:12 pitch and above"],
              [
                "ev_charger_capable",
                "⚡ EV Chargers",
                "Level 2 / DCFC install",
              ],
              [
                "generator_capable",
                "⚙️ Generators",
                "Standby generator installs",
              ],
            ] as [keyof ContractorProfile, string, string][]
          ).map(([key, label, sub]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                form[key]
                  ? "bg-emerald-500/10 border-emerald-500/40 text-white"
                  : "bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600"
              }`}
            >
              <div
                className={`w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                  form[key]
                    ? "bg-emerald-500 border-emerald-500 text-slate-900"
                    : "border-slate-600"
                }`}
              >
                {form[key] && "✓"}
              </div>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">Service States</h3>
        <p className="text-slate-500 text-sm mb-4">
          Opportunities outside your selected states won't appear in your feed.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {US_STATES.map((s) => (
            <button
              key={s}
              onClick={() => toggleState(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                form.service_states.includes(s)
                  ? "bg-amber-500 text-slate-900"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">Equipment Ecosystems</h3>
        <p className="text-slate-500 text-sm mb-4">
          Opportunities matched to your preferred brands will be highlighted.
        </p>
        <div className="flex flex-wrap gap-2">
          {ECOSYSTEMS.map((e) => (
            <button
              key={e}
              onClick={() => toggleEco(e)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                form.equipment_ecosystems.includes(e)
                  ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
              }`}
            >
              {ECOSYSTEM_LABELS[e]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">
          Project Size Preference
        </h3>
        <p className="text-slate-500 text-sm mb-4">
          Leave blank to see all sizes.
        </p>
        <div className="flex gap-4">
          {[
            {
              label: "Min kW",
              key: "min_project_kw" as keyof ContractorProfile,
              ph: "e.g. 5",
            },
            {
              label: "Max kW",
              key: "max_project_kw" as keyof ContractorProfile,
              ph: "e.g. 50",
            },
            {
              label: "Travel Radius (mi)",
              key: "travel_radius_miles" as keyof ContractorProfile,
              ph: "50",
            },
          ].map((field) => (
            <div key={field.key} className="flex-1">
              <label className="block text-xs text-slate-500 mb-1.5">
                {field.label}
              </label>
              <input
                type="number"
                value={(form[field.key] as number | null) ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [field.key]: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  }))
                }
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 transition-colors"
                placeholder={field.ph}
              />
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        {saved ? "✓ Saved" : saving ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const UsLeadMap = dynamic(() => import("./UsLeadMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">
      Loading territory map…
    </div>
  ),
});

export default function NetworkPage() {
  const [tab, setTab] = useState<Tab>("discover");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [mapCounts, setMapCounts] = useState<Record<string, number>>({});
  const [mapOpps, setMapOpps] = useState<Opportunity[]>([]);
  const [myShared, setMyShared] = useState<Opportunity[]>([]);
  const [myClaims, setMyClaims] = useState<Opportunity[]>([]);
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimTarget, setClaimTarget] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [detailOpp, setDetailOpp] = useState<Opportunity | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [filterState, setFilterState] = useState("");
  const [filterBattery, setFilterBattery] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    console.info(
      `MARKETPLACE_CARD_INTELLIGENCE_BUILD=${MARKETPLACE_CARD_INTELLIGENCE_BUILD}`,
    );
  }, []);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/network/contractor-profile");
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
    }
  }, []);

  const loadDiscover = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterState) params.set("state", filterState);
    if (filterBattery) params.set("battery", "1");
    const res = await fetch(`/api/network/opportunities?${params}`);
    if (res.ok) {
      const d = await res.json();
      setOpportunities(d.opportunities || []);
      setTotal(d.total || 0);
    }
  }, [filterState, filterBattery]);

  const loadMyShared = useCallback(async () => {
    const res = await fetch("/api/network/my-opportunities");
    if (res.ok) {
      const d = await res.json();
      setMyShared(d.opportunities || []);
    }
  }, []);

  const loadMyClaims = useCallback(async () => {
    const res = await fetch("/api/network/my-claims");
    if (res.ok) {
      const d = await res.json();
      setMyClaims(d.claims || []);
      setClaimedIds(new Set((d.claims || []).map((c: Opportunity) => c.id)));
    }
  }, []);

  // Unfiltered eligible feed, grouped by state, to drive the map heat counts.
  const loadMapCounts = useCallback(async () => {
    const res = await fetch("/api/network/opportunities?limit=50");
    if (res.ok) {
      const d = await res.json();
      const counts: Record<string, number> = {};
      for (const o of (d.opportunities || []) as Opportunity[]) {
        const rec = o as unknown as Record<string, unknown>;
        const s = String(rec.state_code ?? rec.state ?? "").toUpperCase();
        if (s) counts[s] = (counts[s] ?? 0) + 1;
      }
      setMapCounts(counts);
      setMapOpps((d.opportunities || []) as Opportunity[]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([
        loadProfile(),
        loadDiscover(),
        loadMyShared(),
        loadMyClaims(),
        loadMapCounts(),
      ]);
      setLoading(false);
    })();
  }, [loadProfile, loadDiscover, loadMyShared, loadMyClaims, loadMapCounts]);

  useEffect(() => {
    if (!loading) loadDiscover();
  }, [filterState, filterBattery]); // eslint-disable-line

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchased")) {
      showToast(
        "Payment received — lead unlocked. See My Claims for the full address.",
      );
      window.history.replaceState({}, "", "/network");
    } else if (params.get("canceled")) {
      showToast("Checkout canceled — you were not charged.", "error");
      window.history.replaceState({}, "", "/network");
    }
  }, []); // eslint-disable-line

  const confirmClaim = async () => {
    if (!claimTarget) return;
    setClaimLoading(true);
    try {
      // Pay-to-claim: start a Stripe checkout for this lead. The claim is
      // finalized by the Stripe webhook once payment completes, and the
      // homeowner's address unlocks on return (?purchased=<id>).
      const res = await fetch(
        `/api/network/opportunities/${claimTarget}/checkout`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url as string;
        return;
      }
      showToast(data.error || "Could not start checkout.", "error");
    } finally {
      setClaimLoading(false);
      setClaimTarget(null);
    }
  };

  const saveProfile = async (updates: Partial<ContractorProfile>) => {
    const res = await fetch("/api/network/contractor-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
    }
  };

  const claimOppForModal = claimTarget
    ? (opportunities.find((o) => o.id === claimTarget) ??
      mapOpps.find((o) => o.id === claimTarget) ??
      null)
    : null;

  const TABS: {
    id: Tab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    {
      id: "discover",
      label: "Discover",
      icon: <Sparkles size={14} />,
      count: total || undefined,
    },
    {
      id: "my-shared",
      label: "My Shared",
      icon: <ArrowRight size={14} />,
      count: myShared.length || undefined,
    },
    {
      id: "my-claims",
      label: "My Claims",
      icon: <CheckCircle size={14} />,
      count: myClaims.length || undefined,
    },
    { id: "profile", label: "My Profile", icon: <Settings2 size={14} /> },
  ];

  return (
    <AppShell>
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base, #0b1120)" }}
      >
        {/* ── Hero Header ─────────────────────────────────────────────────── */}
        <div className="relative border-b border-slate-800">

          <div className="relative max-w-6xl mx-auto px-6 py-8">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              {/* Title block */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 text-xs font-semibold uppercase tracking-widest">
                    Live Marketplace
                  </span>
                </div>
                <h1 className="text-white font-bold text-3xl lg:text-4xl mb-2 tracking-tight">
                  SolarPro Network
                </h1>
                <p className="text-slate-400 text-sm max-w-lg leading-relaxed">
                  Exclusive, pre-analyzed solar opportunities — matched to your
                  capabilities, your territory, your equipment.
                </p>
                <p
                  className="mt-2 text-[10px] font-mono text-slate-600"
                  data-marketplace-build-marker
                >
                  MARKETPLACE_CARD_INTELLIGENCE_BUILD=
                  {MARKETPLACE_CARD_INTELLIGENCE_BUILD}
                </p>
              </div>

              {/* Stats cards */}
              {!loading && (
                <div className="flex gap-3 flex-shrink-0">
                  {[
                    {
                      label: "Available Now",
                      value: total,
                      color: "text-emerald-400",
                      bg: "bg-emerald-500/10 border-emerald-500/20",
                      icon: <Sparkles size={14} />,
                    },
                    {
                      label: "My Shared",
                      value: myShared.length,
                      color: "text-amber-400",
                      bg: "bg-amber-500/10 border-amber-500/20",
                      icon: <ArrowRight size={14} />,
                    },
                    {
                      label: "My Claims",
                      value: myClaims.length,
                      color: "text-blue-400",
                      bg: "bg-blue-500/10 border-blue-500/20",
                      icon: <CheckCircle size={14} />,
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className={`flex flex-col items-center justify-center px-5 py-3 rounded-xl border ${s.bg} min-w-[90px]`}
                    >
                      <div className={`${s.color} mb-0.5`}>{s.icon}</div>
                      <div
                        className={`text-2xl font-bold tabular-nums ${s.color}`}
                      >
                        {s.value}
                      </div>
                      <div className="text-slate-500 text-[10px] font-medium uppercase tracking-wide mt-0.5">
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
        <div className="border-b border-slate-800 bg-[#0d1525]/80">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex gap-0">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-all relative ${
                    tab === t.id
                      ? "border-emerald-400 text-white"
                      : "border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        tab === t.id
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-700 text-slate-400"
                      }`}
                    >
                      {t.count > 99 ? "99+" : t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="max-w-6xl mx-auto px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <div className="text-center">
                <Loader2
                  size={32}
                  className="animate-spin text-emerald-500 mx-auto mb-3"
                />
                <p className="text-slate-500 text-sm">Loading opportunities…</p>
              </div>
            </div>
          ) : (
            <>
              {/* DISCOVER */}
              {tab === "discover" && (
                <div>
                  {/* Territory map */}
                  <div className="mb-6 rounded-2xl border border-slate-700/60 bg-[#0b111d] p-3">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="text-sm font-medium text-white">
                        Your territory
                      </div>
                      <div className="text-xs text-slate-500">
                        Hover a state for your lead count · click to filter
                      </div>
                    </div>
                    <UsLeadMap
                      counts={mapCounts}
                      leads={mapOpps.map((o) => {
                        const r = o as unknown as Record<string, unknown>;
                        return {
                          id: String(r.id ?? ""),
                          state: String(
                            r.state_code ?? r.state ?? "",
                          ).toUpperCase(),
                          lat:
                            r.lat != null && r.lat !== ""
                              ? Number(r.lat)
                              : null,
                          lng:
                            r.lng != null && r.lng !== ""
                              ? Number(r.lng)
                              : null,
                          city: r.city ? String(r.city) : "",
                          grade: r.lead_grade ? String(r.lead_grade) : "",
                          kw:
                            r.system_size_kw != null
                              ? Number(r.system_size_kw)
                              : null,
                        };
                      })}
                      selected={filterState}
                      onSelect={(c) => setFilterState(c)}
                      onSelectLead={(id) => setClaimTarget(id)}
                    />
                  </div>
                  {/* Filter bar */}
                  <div className="flex items-center gap-3 mb-6 flex-wrap">
                    <select
                      value={filterState}
                      onChange={(e) => setFilterState(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 transition-colors"
                    >
                      <option value="">All States</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setFilterBattery((f) => !f)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                        filterBattery
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
                      }`}
                    >
                      <Battery size={14} /> Battery Only
                    </button>
                    <button
                      onClick={loadDiscover}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all"
                    >
                      <RefreshCw size={14} /> Refresh
                    </button>
                    {total > 0 && (
                      <span className="text-slate-500 text-sm ml-auto">
                        {total} {total === 1 ? "opportunity" : "opportunities"}
                      </span>
                    )}
                  </div>

                  {opportunities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <Network size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">
                        No opportunities right now
                      </h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        {profile?.service_states?.length === 0
                          ? "Set up your service states in My Profile to see relevant opportunities in your territory."
                          : "New opportunities appear here when contractors share projects they can't service. Check back soon."}
                      </p>
                      {profile?.service_states?.length === 0 && (
                        <button
                          onClick={() => setTab("profile")}
                          className="mt-4 px-4 py-2 text-sm font-medium text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/15 transition-colors"
                        >
                          Set Up My Profile →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {opportunities.map((opp) => (
                        <OpportunityCard
                          key={opp.id}
                          opp={opp}
                          onClaim={setClaimTarget}
                          onViewDetail={setDetailOpp}
                          claimed={claimedIds.has(opp.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MY SHARED */}
              {tab === "my-shared" && (
                <div>
                  {myShared.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <ArrowRight size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">
                        Nothing shared yet
                      </h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        Have a project outside your territory or capacity? Share
                        it to the network from the project detail page and let
                        another contractor handle it.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myShared.map((opp) => (
                        <div
                          key={opp.id}
                          className="bg-[#0f1623] border border-slate-700/60 rounded-xl p-4 flex items-center justify-between hover:border-slate-600 transition-colors"
                        >
                          <div>
                            <div className="text-white font-medium text-sm">
                              {opp.site_name ||
                                `${opp.city}, ${opp.state_code}`}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-slate-500 text-xs">
                                {fmtKw(opp.system_size_kw)}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  opp.status === "open"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : opp.status === "claimed"
                                      ? "bg-amber-500/15 text-amber-400"
                                      : "bg-slate-700/60 text-slate-400"
                                }`}
                              >
                                {opp.status}
                              </span>
                              {(opp as unknown as Record<string, unknown>)
                                .claimer_company && (
                                <span className="text-slate-500 text-xs flex items-center gap-1">
                                  <ArrowRight size={10} />
                                  {
                                    (opp as unknown as Record<string, unknown>)
                                      .claimer_company as string
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-slate-600 text-xs">
                            {daysLeft(opp.expires_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MY CLAIMS */}
              {tab === "my-claims" && (
                <div>
                  {myClaims.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-28 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
                        <CheckCircle size={28} className="text-slate-600" />
                      </div>
                      <h3 className="text-white font-semibold text-lg mb-2">
                        No claimed opportunities yet
                      </h3>
                      <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                        Browse the Discover tab to find eligible marketplace
                        opportunities in your territory.
                      </p>
                      <button
                        onClick={() => setTab("discover")}
                        className="mt-4 px-4 py-2 text-sm font-medium text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/15 transition-colors"
                      >
                        Browse Discover →
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myClaims.map((opp) => {
                        const isOpen = expandedClaim === opp.id;
                        const rec = opp as unknown as Record<
                          string,
                          unknown
                        >;
                        const detail: [string, string | null][] = [
                          [
                            "Annual usage",
                            rec.annual_kwh
                              ? `${Math.round(Number(rec.annual_kwh)).toLocaleString()} kWh`
                              : null,
                          ],
                          [
                            "Utility rate",
                            rec.utility_rate_per_kwh
                              ? `${(Number(rec.utility_rate_per_kwh) * 100).toFixed(1)}¢/kWh`
                              : null,
                          ],
                          [
                            "Est. project value",
                            rec.estimated_system_cost
                              ? fmtCurrency(Number(rec.estimated_system_cost))
                              : null,
                          ],
                          [
                            "Payback",
                            rec.estimated_payback_yrs
                              ? `${rec.estimated_payback_yrs} yrs`
                              : null,
                          ],
                          [
                            "Roof",
                            [
                              rec.roof_material,
                              rec.roof_age_years
                                ? `${rec.roof_age_years} yr`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || null,
                          ],
                          [
                            "Monthly bill",
                            rec.monthly_bill_amount != null
                              ? `${fmtCurrency(Number(rec.monthly_bill_amount))}/mo`
                              : null,
                          ],
                          [
                            "Timeline",
                            rec.homeowner_timeline
                              ? String(rec.homeowner_timeline).replace(
                                  /_/g,
                                  " ",
                                )
                              : null,
                          ],
                          [
                            "Battery interest",
                            rec.battery_candidate
                              ? rec.battery_reason
                                ? String(rec.battery_reason)
                                : "Yes"
                              : null,
                          ],
                          [
                            "Wants financing",
                            rec.homeowner_financing_interest ? "Yes" : null,
                          ],
                          [
                            "You paid",
                            rec.price_paid != null
                              ? fmtCurrency(Number(rec.price_paid))
                              : null,
                          ],
                        ];
                        const qualMeta =
                          rec.intake_metadata &&
                          typeof rec.intake_metadata === "object"
                            ? ((
                                rec.intake_metadata as Record<string, unknown>
                              ).qualification as
                                | Record<string, unknown>
                                | undefined)
                            : undefined;
                        const qualFacts = qualMeta
                          ? Object.entries(qualMeta)
                              .filter(
                                ([k, v]) =>
                                  (typeof v === "string" ||
                                    typeof v === "number" ||
                                    typeof v === "boolean") &&
                                  v !== "" &&
                                  v !== "unknown" &&
                                  !/_id$|_at$|^id$|timestamp|event|score$/i.test(
                                    k,
                                  ),
                              )
                              .slice(0, 8)
                          : [];
                        const operatorNotes = [
                          rec.listing_notes,
                          rec.routing_notes,
                        ].filter(
                          (n) => typeof n === "string" && n.trim(),
                        ) as string[];
                        return (
                          <div
                            key={opp.id}
                            onClick={() =>
                              setExpandedClaim(isOpen ? null : opp.id)
                            }
                            className="cursor-pointer bg-[#0f1623] border border-slate-700/60 rounded-xl p-4 hover:border-slate-600 transition-colors"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium text-sm">
                                  {opp.homeowner_name ||
                                    opp.site_name ||
                                    "Unnamed Project"}
                                </div>
                                {opp.address && (
                                  <div className="flex items-center gap-1.5 mt-1 text-emerald-400 text-xs">
                                    <MapPin size={11} />
                                    {opp.address}
                                  </div>
                                )}
                                {(opp.homeowner_phone ||
                                  opp.homeowner_email) && (
                                  <div className="flex flex-wrap items-center gap-3 mt-1.5">
                                    {opp.homeowner_phone && (
                                      <a
                                        href={`tel:${opp.homeowner_phone}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-sky-300 text-xs hover:underline"
                                      >
                                        {opp.homeowner_phone}
                                      </a>
                                    )}
                                    {opp.homeowner_email && (
                                      <a
                                        href={`mailto:${opp.homeowner_email}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-sky-300 text-xs hover:underline"
                                      >
                                        {opp.homeowner_email}
                                      </a>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-3 mt-2">
                                  <span className="text-slate-500 text-xs">
                                    {fmtKw(opp.system_size_kw)}
                                  </span>
                                  {opp.utility_name && (
                                    <span className="text-slate-500 text-xs">
                                      {opp.utility_name}
                                    </span>
                                  )}
                                  {opp.battery_candidate && (
                                    <span className="text-amber-400 text-xs flex items-center gap-1">
                                      <Battery size={10} /> Battery
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400 ml-3 flex-shrink-0">
                                {(rec.claim_status as string) || "active"}
                              </span>
                            </div>
                            {isOpen && (
                              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-700/60 pt-3">
                                {detail
                                  .filter(([, v]) => v)
                                  .map(([label, v]) => (
                                    <div key={label} className="text-xs">
                                      <span className="text-slate-500">
                                        {label}:{" "}
                                      </span>
                                      <span className="text-slate-300">
                                        {v}
                                      </span>
                                    </div>
                                  ))}
                                {!opp.homeowner_phone &&
                                  !opp.homeowner_email && (
                                    <div className="col-span-2 text-xs text-amber-400">
                                      No contact info stored on this lead yet.
                                    </div>
                                  )}
                                {(qualFacts.length > 0 ||
                                  operatorNotes.length > 0) && (
                                  <div className="col-span-2 mt-2 border-t border-slate-700/60 pt-2">
                                    <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1.5">
                                      Vetting — already done for you
                                    </div>
                                    {qualFacts.length > 0 && (
                                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                                        {qualFacts.map(([k, v]) => (
                                          <span
                                            key={k}
                                            className="text-xs text-slate-300"
                                          >
                                            <span className="text-slate-500">
                                              {k
                                                .replace(/_/g, " ")
                                                .replace(/^\w/, (c) =>
                                                  c.toUpperCase(),
                                                )}
                                              :{" "}
                                            </span>
                                            {String(v)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {operatorNotes.map((n, i) => (
                                      <div
                                        key={i}
                                        className="mt-1.5 text-xs text-slate-300 whitespace-pre-wrap"
                                      >
                                        <span className="text-slate-500">
                                          Operator note:{" "}
                                        </span>
                                        {n}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* PROFILE */}
              {tab === "profile" && profile && (
                <ProfileTab profile={profile} onSave={saveProfile} />
              )}
            </>
          )}
        </div>

        {/* ── Toast ────────────────────────────────────────────────────────── */}
        {toast && (
          <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border ${
              toast.type === "success"
                ? "bg-slate-900 border-emerald-500/40 text-emerald-400"
                : "bg-slate-900 border-rose-500/40 text-rose-400"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle size={16} />
            ) : (
              <AlertTriangle size={16} />
            )}
            {toast.msg}
          </div>
        )}

        {/* ── Modals ───────────────────────────────────────────────────────── */}
        {claimOppForModal && (
          <ClaimModal
            opp={claimOppForModal}
            onConfirm={confirmClaim}
            onCancel={() => setClaimTarget(null)}
            loading={claimLoading}
          />
        )}
        {detailOpp && (
          <DetailModal
            opp={detailOpp}
            onClaim={setClaimTarget}
            onClose={() => setDetailOpp(null)}
            isClaimed={claimedIds.has(detailOpp.id)}
          />
        )}
      </div>
    </AppShell>
  );
}
