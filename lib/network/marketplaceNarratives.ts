import type { MarketplaceBadge } from "@/lib/network/marketplaceBadges";
import type { MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";
import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";

export interface MarketplaceNarrativeInput {
  city?: string | null;
  stateCode?: string | null;
  estimatedProjectValue?: number | null;
  estimatedSystemSizeKw?: number | null;
  annualUsageKwh?: number | null;
  monthlyBillAmount?: number | null;
  utilityProvider?: string | null;
  utilityRatePerKwh?: number | null;
  estimatedAnnualSavings?: number | null;
  estimatedOffsetPct?: number | null;
  financeReadiness?: boolean | null;
  batteryCandidate?: boolean | null;
  timeline?: string | null;
  leadGrade?: string | null;
  badges?: MarketplaceBadge[];
  confidence?: MarketplaceConfidenceResult | null;
  releaseGate?: MarketplaceReleaseGateResult | null;
}

export interface MarketplaceNarrativeResult {
  headline: string;
  summary: string;
  bullets: string[];
  source_note: string;
}

function money(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : null;
}

function kw(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} kW`
    : null;
}

function usage(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${Math.round(value).toLocaleString("en-US")} kWh/yr`
    : null;
}

function rate(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${(value * 100).toFixed(1)}¢/kWh`
    : null;
}

function offset(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}% offset`;
}

function display(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/_/g, " ") : null;
}

export function buildMarketplaceNarrative(input: MarketplaceNarrativeInput): MarketplaceNarrativeResult {
  const badges = input.badges ?? [];
  const badgeLabels = new Set(badges.map(badge => badge.label));
  const parts: string[] = [];
  const bullets: string[] = [];

  const value = money(input.estimatedProjectValue);
  const system = kw(input.estimatedSystemSizeKw);
  const annualUsage = usage(input.annualUsageKwh ?? input.releaseGate?.evidence.parsed_bill.annual_usage_kwh);
  const utility = display(input.utilityProvider ?? input.releaseGate?.evidence.parsed_bill.utility_provider ?? input.releaseGate?.evidence.homeowner_intake.utility_provider);
  const utilityRate = rate(input.utilityRatePerKwh ?? input.releaseGate?.evidence.parsed_bill.utility_rate_per_kwh);
  const monthlyBill = money(input.monthlyBillAmount ?? input.releaseGate?.evidence.homeowner_intake.monthly_bill_amount);
  const savings = money(input.estimatedAnnualSavings);
  const offsetPct = offset(input.estimatedOffsetPct);
  const timeline = display(input.timeline ?? input.releaseGate?.evidence.homeowner_intake.timeline);
  const grade = display(input.leadGrade ?? input.releaseGate?.evidence.qualification.lead_grade);

  if (value) parts.push(`${value} estimated project`);
  if (system) parts.push(`${system} install potential`);
  if (annualUsage) parts.push(`${annualUsage} usage profile`);
  if (utilityRate) parts.push(`${utilityRate} utility rate`);

  if (badgeLabels.has("Verified Bill")) bullets.push("Stored utility bill evidence supports the marketplace projection.");
  if (badgeLabels.has("Bill Parsed")) bullets.push("Bill intelligence is parsed and available for contractor review.");
  if (input.financeReadiness || input.releaseGate?.evidence.qualification.finance_readiness || input.releaseGate?.evidence.operator_review.financing_ready) bullets.push("Financing readiness is present in qualification or operator review evidence.");
  if (input.batteryCandidate || badgeLabels.has("Battery Ready")) bullets.push("Battery attachment is supported by candidate flags or homeowner interest.");
  if (timeline) bullets.push(`Homeowner timeline: ${timeline}.`);
  if (monthlyBill) bullets.push(`Homeowner-entered monthly bill: ${monthlyBill}.`);
  if (utility) bullets.push(`Utility provider: ${utility}.`);
  if (savings) bullets.push(`Estimated annual savings: ${savings}.`);
  if (offsetPct) bullets.push(`Estimated production coverage: ${offsetPct}.`);
  if (grade) bullets.push(`Qualification grade/status: ${grade}.`);

  const location = [input.city, input.stateCode].filter(Boolean).join(", ");
  const headline = badgeLabels.has("High Intent")
    ? "High-intent revenue opportunity"
    : badgeLabels.has("High Usage")
      ? "High-usage solar opportunity"
      : badgeLabels.has("Verified Bill")
        ? "Verified bill-backed opportunity"
        : "Marketplace opportunity intelligence";

  const summary = parts.length
    ? `${location ? `${location}: ` : ""}${parts.slice(0, 3).join(" • ")}.`
    : `${location ? `${location}: ` : ""}Available contractor opportunity with only verified marketplace fields shown.`;

  const confidenceSentence = input.confidence
    ? `${input.confidence.label} based on ${input.confidence.reasons.length ? input.confidence.reasons[0].toLowerCase() : "available evidence"}.`
    : null;

  return {
    headline,
    summary: confidenceSentence ? `${summary} ${confidenceSentence}` : summary,
    bullets: Array.from(new Set(bullets)).slice(0, 6),
    source_note: "Narrative is deterministic and derived from marketplace, release gate, qualification, bill, and enrichment fields only.",
  };
}
