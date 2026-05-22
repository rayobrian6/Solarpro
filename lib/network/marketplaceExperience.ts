import type { MarketplaceBadge } from "@/lib/network/marketplaceBadges";
import type {
  MarketplaceBillVisualsProjection,
  MarketplaceEvidenceSummary,
} from "@/lib/network/marketplaceIntelligence";
import type { MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";
import type { FinancingIntelligenceResult } from "@/lib/network/financingIntelligence";
import type { InstallComplexityResult } from "@/lib/network/installComplexity";
import type { OpportunityScoreResult } from "@/lib/network/opportunityScore";
import type { MarketplaceRevenueProjectionResult } from "@/lib/network/marketplaceRevenueProjection";
import type { PurchaseBehaviorResult } from "@/lib/network/purchaseBehavior";
import type { PurchaseProfileResult } from "@/lib/network/purchaseProfile";
import type { IntelligenceLevel } from "@/lib/network/intelligenceUtils";

export type MarketplaceExperienceTone =
  | "emerald"
  | "amber"
  | "blue"
  | "violet"
  | "orange"
  | "rose"
  | "slate";

export interface MarketplaceHeroMetric {
  key:
    | "project_value"
    | "payment_estimate"
    | "system_size"
    | "opportunity_score";
  label: string;
  value: string;
  subtext: string;
  tone: MarketplaceExperienceTone;
  priority: number;
}

export interface MarketplaceTrustSignal {
  label: string;
  verified: boolean;
  tone: MarketplaceExperienceTone;
  reason: string;
  source:
    | "bill"
    | "release_gate"
    | "qualification"
    | "operator_review"
    | "marketplace";
}

export interface MarketplacePaymentPath {
  key: "financed" | "lease_ppa" | "utility_replacement";
  label: string;
  value: string;
  sales_copy: string;
  tone: MarketplaceExperienceTone;
}

export interface MarketplaceExperienceProjection {
  hero_metrics: MarketplaceHeroMetric[];
  trust_signals: MarketplaceTrustSignal[];
  why_this_scores_high: string[];
  economic_story: string[];
  payment_paths: MarketplacePaymentPath[];
  acquisition_tags: string[];
  deal_attractiveness: string[];
  liquidity_label: string;
  confidence_story: string;
  source_note: string;
}

export interface MarketplaceExperienceInput {
  revenueProjection: MarketplaceRevenueProjectionResult;
  confidence: MarketplaceConfidenceResult;
  badges: MarketplaceBadge[];
  opportunityScore: OpportunityScoreResult;
  purchaseProfile: PurchaseProfileResult;
  purchaseBehavior: PurchaseBehaviorResult;
  financing: FinancingIntelligenceResult;
  installComplexity: InstallComplexityResult;
  billVisuals: MarketplaceBillVisualsProjection;
  evidence: MarketplaceEvidenceSummary;
  estimatedSystemSizeKw?: number | null;
  monthlyBillAmount?: number | null;
  annualUsageKwh?: number | null;
  utilityRatePerKwh?: number | null;
  estimatedAnnualSavings?: number | null;
  estimatedOffsetPct?: number | null;
  utilityProvider?: string | null;
  timeline?: string | null;
}

function compactMoney(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  const rounded = Math.round(value / 1000);
  return `$${rounded}k`;
}

function money(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function moneyRange(
  range: MarketplaceRevenueProjectionResult["project_value_range"],
): string | null {
  if (!range) return null;
  const min = compactMoney(range.min);
  const max = compactMoney(range.max);
  if (!min || !max) return null;
  return `${min}–${max}`;
}

function monthlyRange(
  range: MarketplaceRevenueProjectionResult["financed_payment_range"],
): string | null {
  if (!range) return null;
  const min = money(range.min);
  const max = money(range.max);
  if (!min || !max) return null;
  return `${min}–${max}/mo`;
}

function kw(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} kW`;
}

function pct(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function rate(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return `${(value * 100).toFixed(1)}¢/kWh`;
}

function pushUnique(target: string[], value: string | null | undefined) {
  if (value && !target.includes(value)) target.push(value);
}

function hasBadge(badges: MarketplaceBadge[], label: string): boolean {
  return badges.some(
    (badge) => badge.label.toLowerCase() === label.toLowerCase(),
  );
}

function normalizeTag(tag: string): string {
  return tag.replace(/-/g, " ").replace(/PPA/g, "PPA");
}

function timelineFast(value: string | null | undefined): boolean {
  const normalized = value?.toLowerCase() ?? "";
  return ["asap", "now", "immediate", "0_1", "30_days", "1_3", "soon"].some(
    (token) => normalized.includes(token),
  );
}

function trustSignal(
  label: string,
  verified: boolean,
  source: MarketplaceTrustSignal["source"],
  reason: string,
): MarketplaceTrustSignal {
  return {
    label,
    verified,
    source,
    reason,
    tone: verified ? "emerald" : "slate",
  };
}

function confidenceStory(
  input: MarketplaceExperienceInput,
  verifiedCount: number,
): string {
  if (input.confidence.level === "high") {
    return `${verifiedCount} verified evidence signals support ${input.confidence.score}/100 marketplace confidence.`;
  }
  if (input.confidence.level === "medium") {
    return `${verifiedCount} evidence signals are present; contractor should validate remaining missing fields.`;
  }
  return "Confidence remains limited until bill, utility, qualification, or operator evidence improves.";
}

export function deriveMarketplaceExperience(
  input: MarketplaceExperienceInput,
): MarketplaceExperienceProjection {
  const revenue = input.revenueProjection;
  const projectValue =
    moneyRange(revenue.battery_inclusive_value_range) ??
    moneyRange(revenue.project_value_range) ??
    "Value awaiting sizing";
  const paymentEstimate =
    monthlyRange(revenue.financed_payment_range) ??
    monthlyRange(revenue.ppa_lease_payment_range) ??
    "Payment path pending";
  const systemSize = kw(input.estimatedSystemSizeKw) ?? "System size pending";

  const hero_metrics: MarketplaceHeroMetric[] = [
    {
      key: "project_value",
      label: revenue.battery_inclusive_value_range
        ? "Project value with battery"
        : "Project value",
      value: projectValue,
      subtext: revenue.project_value_display_label,
      tone: revenue.gross_opportunity_tier === "premium" ? "emerald" : "amber",
      priority: 1,
    },
    {
      key: "payment_estimate",
      label: "Payment estimate",
      value: paymentEstimate,
      subtext: revenue.payment_replacement_label,
      tone:
        input.purchaseProfile.likely_purchase_method === "lease_or_ppa"
          ? "blue"
          : "emerald",
      priority: 2,
    },
    {
      key: "system_size",
      label: "System size",
      value: systemSize,
      subtext: input.annualUsageKwh
        ? `${Math.round(input.annualUsageKwh).toLocaleString("en-US")} kWh/yr load profile`
        : "Awaiting annual usage evidence",
      tone: "amber",
      priority: 3,
    },
    {
      key: "opportunity_score",
      label: "Opportunity score",
      value: `${input.opportunityScore.score}/100`,
      subtext: `${input.opportunityScore.tier} acquisition signal`,
      tone:
        input.opportunityScore.tier === "elite" ||
        input.opportunityScore.tier === "strong"
          ? "emerald"
          : "slate",
      priority: 4,
    },
  ];

  const trust_signals: MarketplaceTrustSignal[] = [
    trustSignal(
      "VERIFIED BILL",
      !!input.evidence.bill_evidence.stored_attachment,
      "release_gate",
      "Stored utility bill attachment is present.",
    ),
    trustSignal(
      "12-MONTH HISTORY",
      input.billVisuals.months_found >= 12,
      "bill",
      `${input.billVisuals.months_found} bill-history month${input.billVisuals.months_found === 1 ? "" : "s"} found.`,
    ),
    trustSignal(
      "UTILITY VERIFIED",
      !!(
        input.evidence.parsed_bill.utility_provider ||
        input.evidence.homeowner_intake.utility_provider ||
        input.utilityProvider
      ),
      "bill",
      "Utility provider is present from parsed bill or homeowner intake.",
    ),
    trustSignal(
      "AI QUALIFIED",
      hasBadge(input.badges, "AI Qualified"),
      "qualification",
      "Qualification intelligence marks the lead as strong.",
    ),
    trustSignal(
      "OPERATOR VERIFIED",
      !!input.evidence.operator_review.approved_for_marketplace,
      "operator_review",
      "Operator review approved marketplace release.",
    ),
    trustSignal(
      "BILL PARSED",
      !!input.evidence.parsed_bill.has_real_parser_output,
      "bill",
      "Real parser output is available.",
    ),
    trustSignal(
      "STORED ATTACHMENT VERIFIED",
      !!input.evidence.bill_evidence.stored_attachment,
      "release_gate",
      "Bill file storage evidence is present.",
    ),
  ];

  const why: string[] = [];
  if (input.evidence.bill_evidence.stored_attachment)
    pushUnique(why, "Verified utility bill evidence");
  if (input.billVisuals.months_found >= 12)
    pushUnique(why, "Verified 12-month utility history");
  if ((input.utilityRatePerKwh ?? 0) >= 0.18)
    pushUnique(why, "High utility inflation territory");
  if ((input.estimatedOffsetPct ?? 0) >= 90)
    pushUnique(why, "Large offset opportunity");
  if (input.purchaseBehavior.tags.includes("financing-friendly"))
    pushUnique(why, "Financing-friendly homeowner");
  if (revenue.battery_attachment_value)
    pushUnique(why, "Battery attachment signal");
  if (input.installComplexity.level === "low")
    pushUnique(why, "Low install complexity");
  if (timelineFast(input.timeline)) pushUnique(why, "Fast homeowner timeline");
  if (input.billVisuals.months_found > 0 && input.billVisuals.months_found < 12)
    pushUnique(
      why,
      `${input.billVisuals.months_found}-month bill history parsed`,
    );
  input.opportunityScore.reasons.forEach((reason) => pushUnique(why, reason));

  const economic_story: string[] = [];
  if (input.estimatedAnnualSavings)
    pushUnique(
      economic_story,
      `${money(input.estimatedAnnualSavings)} estimated annual homeowner savings`,
    );
  if (revenue.estimated_monthly_utility_reduction)
    pushUnique(
      economic_story,
      `${money(revenue.estimated_monthly_utility_reduction)}/mo estimated homeowner utility reduction`,
    );
  if (input.utilityRatePerKwh && input.utilityRatePerKwh >= 0.18)
    pushUnique(
      economic_story,
      `${rate(input.utilityRatePerKwh)} utility rate creates strong utility arbitrage pressure`,
    );
  if (input.monthlyBillAmount && revenue.financed_payment_range)
    pushUnique(economic_story, revenue.payment_replacement_label);
  if (input.estimatedOffsetPct)
    pushUnique(
      economic_story,
      `${pct(input.estimatedOffsetPct)} estimated offset economics`,
    );
  pushUnique(economic_story, revenue.utility_arbitrage_label);

  const payment_paths: MarketplacePaymentPath[] = [
    {
      key: "financed",
      label: "FINANCED PMT",
      value:
        monthlyRange(revenue.financed_payment_range) ??
        "Financing estimate pending",
      sales_copy: revenue.financed_payment_label,
      tone: input.financing.likelihood === "high" ? "emerald" : "slate",
    },
    {
      key: "lease_ppa",
      label: "PPA / LEASE",
      value:
        monthlyRange(revenue.ppa_lease_payment_range) ??
        "PPA/lease estimate pending",
      sales_copy: revenue.ppa_lease_payment_label,
      tone:
        input.purchaseProfile.likely_purchase_method === "lease_or_ppa"
          ? "blue"
          : "slate",
    },
    {
      key: "utility_replacement",
      label: "UTILITY REPLACEMENT",
      value: input.monthlyBillAmount
        ? `${money(input.monthlyBillAmount)}/mo current bill`
        : "Utility bill pending",
      sales_copy: revenue.payment_replacement_label,
      tone: "amber",
    },
  ];

  const acquisitionTags: string[] = [];
  input.purchaseBehavior.tags.forEach((tag) =>
    pushUnique(acquisitionTags, normalizeTag(tag)),
  );
  if (revenue.gross_opportunity_tier === "premium")
    pushUnique(acquisitionTags, "premium homeowner");
  if (input.installComplexity.level === "low")
    pushUnique(acquisitionTags, "low-friction install");
  if (
    (input.monthlyBillAmount ?? 0) >= 225 ||
    (input.utilityRatePerKwh ?? 0) >= 0.18
  )
    pushUnique(acquisitionTags, "high utility pain");
  if (input.purchaseBehavior.tags.includes("resilience-motivated"))
    pushUnique(acquisitionTags, "resilience-focused");
  if (revenue.battery_attachment_value)
    pushUnique(acquisitionTags, "battery-ready");

  const dealAttractiveness: string[] = [];
  pushUnique(dealAttractiveness, revenue.gross_opportunity_label);
  pushUnique(dealAttractiveness, revenue.battery_inclusive_display_label);
  why.slice(0, 4).forEach((reason) => pushUnique(dealAttractiveness, reason));
  economic_story
    .slice(0, 3)
    .forEach((line) => pushUnique(dealAttractiveness, line));
  if (input.purchaseBehavior.closeability_label)
    pushUnique(dealAttractiveness, input.purchaseBehavior.closeability_label);

  const verifiedCount = trust_signals.filter(
    (signal) => signal.verified,
  ).length;
  const liquidity_label =
    input.opportunityScore.tier === "elite"
      ? "High-liquidity claim opportunity"
      : input.opportunityScore.tier === "strong"
        ? "Strong marketplace claim signal"
        : "Marketplace liquidity developing";

  return {
    hero_metrics,
    trust_signals,
    why_this_scores_high: why.slice(0, 7),
    economic_story: economic_story.slice(0, 6),
    payment_paths,
    acquisition_tags: acquisitionTags.slice(0, 10),
    deal_attractiveness: dealAttractiveness.slice(0, 8),
    liquidity_label,
    confidence_story: confidenceStory(input, verifiedCount),
    source_note:
      "Experience intelligence is deterministic and derived from canonical marketplaceRevenueProjection plus verified release, bill, qualification, scoring, and complexity signals.",
  };
}
