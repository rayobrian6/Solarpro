import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";
import {
  boolValue,
  displayText,
  normalizedText,
  pushUnique,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
} from "@/lib/network/intelligenceUtils";
import type { MarketplaceRevenueProjectionResult } from "@/lib/network/marketplaceRevenueProjection";
import type { PurchaseProfileResult } from "@/lib/network/purchaseProfile";

export type PurchaseBehaviorTag =
  | "premium homeowner"
  | "cash-friendly"
  | "financing-friendly"
  | "payment-sensitive"
  | "PPA candidate"
  | "lease-friendly"
  | "battery-ready"
  | "resilience-motivated"
  | "resilience-focused"
  | "fast-close"
  | "premium-upgrade candidate";

export interface PurchaseBehaviorInput {
  releaseGate: MarketplaceReleaseGateResult;
  purchaseProfile: PurchaseProfileResult;
  revenueProjection?: MarketplaceRevenueProjectionResult | null;
  purchaseIntent?: string | null;
  financingPreference?: string | null;
  timeline?: string | null;
  batteryInterest?: string | boolean | null;
  batteryCandidate?: boolean | null;
  monthlyBillAmount?: number | null;
  annualUsageKwh?: number | null;
  utilityRatePerKwh?: number | null;
  estimatedCreditBand?: string | null;
  estimatedIncomeBand?: string | null;
  qualificationStatus?: string | null;
  leadGrade?: string | null;
}

export interface PurchaseBehaviorResult {
  tags: PurchaseBehaviorTag[];
  primary_behavior: PurchaseBehaviorTag | "undetermined";
  behavior_label: string;
  confidence: IntelligenceLevel;
  sales_fit_score: number;
  closeability_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

function addTag(target: PurchaseBehaviorTag[], tag: PurchaseBehaviorTag) {
  if (!target.includes(tag)) target.push(tag);
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizedTimelineUrgent(
  timeline: string | null | undefined,
): boolean {
  const normalized = normalizedText(timeline);
  return (
    !!normalized &&
    ["asap", "now", "immediate", "0_1", "30_days", "1_3", "soon"].some(
      (token) => normalized.includes(token),
    )
  );
}

function selectedBattery(value: string | boolean | null | undefined): boolean {
  if (boolValue(value) === true) return true;
  const normalized = normalizedText(value);
  return (
    !!normalized &&
    ["battery", "backup", "resilience", "storage", "outage"].some((token) =>
      normalized.includes(token),
    )
  );
}

function scoreFromTags(
  tags: PurchaseBehaviorTag[],
  confidence: IntelligenceLevel,
): number {
  let score = tags.length * 9;
  if (tags.includes("fast-close")) score += 14;
  if (tags.includes("premium-upgrade candidate")) score += 12;
  if (tags.includes("battery-ready")) score += 8;
  if (tags.includes("cash-friendly") || tags.includes("financing-friendly"))
    score += 7;
  if (confidence === "high") score += 12;
  else if (confidence === "medium") score += 7;
  else if (confidence === "low") score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function labelFor(tag: PurchaseBehaviorTag | "undetermined"): string {
  switch (tag) {
    case "premium homeowner":
      return "Premium homeowner acquisition signal";
    case "cash-friendly":
      return "Cash-friendly acquisition path";
    case "financing-friendly":
      return "Financing-friendly acquisition path";
    case "payment-sensitive":
      return "Payment-sensitive homeowner";
    case "PPA candidate":
      return "PPA candidate";
    case "lease-friendly":
      return "Lease-friendly homeowner";
    case "battery-ready":
      return "Battery-ready opportunity";
    case "resilience-motivated":
      return "Resilience-motivated homeowner";
    case "fast-close":
      return "Fast-close opportunity";
    case "premium-upgrade candidate":
      return "Premium upgrade candidate";
    default:
      return "Purchase behavior awaiting more evidence";
  }
}

function closeability(score: number): string {
  if (score >= 72) return "High closeability signal";
  if (score >= 50) return "Moderate closeability signal";
  if (score > 0) return "Early closeability signal";
  return "Closeability awaiting qualification evidence";
}

export function derivePurchaseBehavior(
  input: PurchaseBehaviorInput,
): PurchaseBehaviorResult {
  const tags: PurchaseBehaviorTag[] = [];
  const evidence: IntelligenceEvidenceNote[] = [];
  const missing: string[] = [];
  const gateEvidence = input.releaseGate.evidence;
  const purchaseIntent = normalizedText(
    input.purchaseIntent ??
      input.financingPreference ??
      gateEvidence.qualification.purchase_intent,
  );
  const timeline = input.timeline ?? gateEvidence.homeowner_intake.timeline;
  const monthlyBill = positive(
    input.monthlyBillAmount ??
      gateEvidence.homeowner_intake.monthly_bill_amount,
  );
  const annualUsage = positive(
    input.annualUsageKwh ?? gateEvidence.parsed_bill.annual_usage_kwh,
  );
  const utilityRate = positive(
    input.utilityRatePerKwh ?? gateEvidence.parsed_bill.utility_rate_per_kwh,
  );
  const battery =
    selectedBattery(input.batteryInterest) || input.batteryCandidate === true;
  const qualified = [
    normalizedText(
      input.qualificationStatus ?? gateEvidence.qualification.status,
    ),
    normalizedText(input.leadGrade ?? gateEvidence.qualification.lead_grade),
  ].some(
    (value) =>
      !!value &&
      ["qualified", "approved", "a", "a+", "high_intent"].includes(value),
  );
  const financeSignal =
    input.purchaseProfile.likely_purchase_method === "loan" ||
    input.purchaseProfile.likely_purchase_method === "financing_likely" ||
    gateEvidence.qualification.finance_readiness ||
    gateEvidence.operator_review.financing_ready;

  if (purchaseIntent) {
    evidence.push({
      label: "Purchase preference",
      value:
        displayText(
          input.purchaseIntent ?? input.financingPreference ?? purchaseIntent,
        ) ?? purchaseIntent,
      source: "qualification",
    });
  } else pushUnique(missing, "Purchase preference pending");

  if (timeline) {
    evidence.push({
      label: "Timeline",
      value: displayText(timeline) ?? timeline,
      source: "homeowner",
    });
  } else pushUnique(missing, "Timeline pending");

  if (monthlyBill) {
    evidence.push({
      label: "Monthly utility spend",
      value: `$${Math.round(monthlyBill).toLocaleString("en-US")}/mo`,
      source: "homeowner",
    });
  } else pushUnique(missing, "Monthly utility spend pending");

  if (annualUsage) {
    evidence.push({
      label: "Annual usage",
      value: `${Math.round(annualUsage).toLocaleString("en-US")} kWh`,
      source: gateEvidence.parsed_bill.annual_usage_kwh ? "bill" : "derived",
    });
  }

  if (purchaseIntent === "cash") addTag(tags, "cash-friendly");
  if (
    purchaseIntent === "financing" ||
    purchaseIntent === "loan" ||
    financeSignal
  )
    addTag(tags, "financing-friendly");
  if (purchaseIntent === "ppa_or_lease" || purchaseIntent === "ppa")
    addTag(tags, "PPA candidate");
  if (purchaseIntent === "ppa_or_lease" || purchaseIntent === "lease")
    addTag(tags, "lease-friendly");

  if (
    (monthlyBill && monthlyBill >= 175) ||
    (utilityRate && utilityRate >= 0.17)
  )
    addTag(tags, "payment-sensitive");
  if (battery) {
    addTag(tags, "battery-ready");
    evidence.push({
      label: "Battery signal",
      value: "Battery/resilience interest present",
      source: "homeowner",
    });
  }
  const batteryText = normalizedText(input.batteryInterest);
  if (
    batteryText &&
    ["backup", "resilience", "outage"].some((token) =>
      batteryText.includes(token),
    )
  )
    addTag(tags, "resilience-motivated");
  if (normalizedTimelineUrgent(timeline) && qualified)
    addTag(tags, "fast-close");
  if (input.revenueProjection?.gross_opportunity_tier === "premium")
    addTag(tags, "premium homeowner");
  if (
    input.revenueProjection?.gross_opportunity_tier === "premium" ||
    input.revenueProjection?.battery_attachment_value ||
    (annualUsage && annualUsage >= 15000)
  )
    addTag(tags, "premium-upgrade candidate");
  if (tags.includes("resilience-motivated")) addTag(tags, "resilience-focused");

  if (!annualUsage) pushUnique(missing, "Annual usage pending");
  if (!utilityRate) pushUnique(missing, "Utility rate pending");

  const confidence: IntelligenceLevel =
    tags.length >= 4 && qualified
      ? "high"
      : tags.length >= 2
        ? "medium"
        : tags.length === 1
          ? "low"
          : "unknown";
  const salesFitScore = scoreFromTags(tags, confidence);
  const primary = tags[0] ?? "undetermined";

  return {
    tags,
    primary_behavior: primary,
    behavior_label: labelFor(primary),
    confidence,
    sales_fit_score: salesFitScore,
    closeability_label: closeability(salesFitScore),
    evidence,
    missing,
    disclaimers: [
      "Purchase behavior is sales/acquisition intelligence only; it is not credit underwriting or financing approval.",
      "Behavior tags should be validated by contractor discovery and homeowner consented follow-up.",
    ],
  };
}
