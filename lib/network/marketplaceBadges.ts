import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";
import type { MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";

export type MarketplaceBadgeTone = "emerald" | "amber" | "blue" | "violet" | "orange" | "rose" | "slate";

export interface MarketplaceBadgeInput {
  releaseGate?: MarketplaceReleaseGateResult | null;
  confidence?: MarketplaceConfidenceResult | null;
  leadGrade?: string | null;
  qualificationStatus?: string | null;
  financeReadiness?: boolean | null;
  purchaseIntent?: string | null;
  homeownerStatus?: string | null;
  timeline?: string | null;
  batteryCandidate?: boolean | null;
  batteryInterest?: string | null;
  sunlightConfidence?: string | null;
  monthlyUsageKwh?: number | null;
  annualUsageKwh?: number | null;
  utilityRatePerKwh?: number | null;
  createdAt?: string | null;
  releasedAt?: string | null;
  claimMode?: string | null;
  claimCount?: number | null;
  maxClaims?: number | null;
}

export interface MarketplaceBadge {
  label: string;
  tone: MarketplaceBadgeTone;
  reason: string;
  source: "release_gate" | "bill" | "qualification" | "homeowner" | "marketplace" | "enrichment" | "opportunity";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function truthyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function isFastTimeline(value: unknown): boolean {
  const timeline = truthyString(value);
  return !!timeline && ["asap", "now", "immediate", "0_1_month", "1_3_months", "30_days"].some(token => timeline.includes(token));
}

function isOwnerOccupied(value: unknown): boolean {
  const normalized = truthyString(value);
  return !!normalized && ["own", "owner", "owner_occupied", "owned"].includes(normalized);
}

function isPositiveInterest(value: unknown): boolean {
  const normalized = truthyString(value);
  return !!normalized && ["yes", "true", "interested", "battery", "backup", "likely"].some(token => normalized.includes(token));
}

function isPpaOrLeasePreference(value: unknown): boolean {
  const normalized = truthyString(value);
  return !!normalized && ["ppa_or_lease", "ppa", "lease"].includes(normalized);
}

function hoursSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 36e5);
}

export function deriveMarketplaceBadges(input: MarketplaceBadgeInput): MarketplaceBadge[] {
  const evidence = input.releaseGate?.evidence;
  const badges: MarketplaceBadge[] = [];
  const push = (badge: MarketplaceBadge) => {
    if (!badges.some(existing => existing.label === badge.label)) badges.push(badge);
  };

  if (evidence?.bill_evidence.stored_attachment) {
    push({ label: "Verified Bill", tone: "emerald", reason: "Stored utility bill attachment is present", source: "release_gate" });
  }

  if (evidence?.parsed_bill.has_real_parser_output) {
    push({ label: "Bill Parsed", tone: "blue", reason: "Parsed bill intelligence is available", source: "bill" });
  }

  if (evidence?.parsed_bill.utility_provider || input.releaseGate?.evidence.homeowner_intake.utility_provider) {
    push({ label: "Utility Verified", tone: "blue", reason: "Utility provider is present from intake or parsed bill evidence", source: "bill" });
  }

  const grade = truthyString(input.leadGrade ?? evidence?.qualification.lead_grade);
  const qualificationStatus = truthyString(input.qualificationStatus ?? evidence?.qualification.status);
  if (["a", "a+", "high_intent", "qualified", "approved"].some(token => grade === token || qualificationStatus === token)) {
    push({ label: "AI Qualified", tone: "violet", reason: "Qualification intelligence marks the lead as strong", source: "qualification" });
  }

  const ppaOrLeasePreference = isPpaOrLeasePreference(input.purchaseIntent ?? evidence?.qualification.purchase_intent);
  if (ppaOrLeasePreference) {
    push({ label: "PPA/Lease Preference", tone: "blue", reason: "Qualification captured a third-party-owned system preference", source: "qualification" });
  } else if (input.financeReadiness === true || evidence?.qualification.finance_readiness || evidence?.operator_review.financing_ready) {
    push({ label: "Financing Ready", tone: "emerald", reason: "Financing readiness is present in qualification or operator review", source: "qualification" });
  }

  if (isFastTimeline(input.timeline ?? evidence?.homeowner_intake.timeline)) {
    push({ label: "Fast Timeline", tone: "orange", reason: "Homeowner timeline indicates near-term intent", source: "homeowner" });
    push({ label: "High Intent", tone: "emerald", reason: "Homeowner timeline supports high intent", source: "homeowner" });
  }

  const monthlyUsage = numeric(input.monthlyUsageKwh ?? evidence?.parsed_bill.monthly_usage_avg_kwh);
  const annualUsage = numeric(input.annualUsageKwh ?? evidence?.parsed_bill.annual_usage_kwh);
  if ((monthlyUsage ?? 0) >= 1200 || (annualUsage ?? 0) >= 14400) {
    push({ label: "High Usage", tone: "violet", reason: "Usage is above high-consumption threshold", source: "bill" });
  }

  const rate = numeric(input.utilityRatePerKwh ?? evidence?.parsed_bill.utility_rate_per_kwh);
  if ((rate ?? 0) >= 0.18) {
    push({ label: "Premium Rate", tone: "emerald", reason: "Utility rate is at or above 18 cents/kWh", source: "bill" });
  }

  if (isOwnerOccupied(input.homeownerStatus)) {
    push({ label: "Owner Occupied", tone: "blue", reason: "Homeowner ownership status indicates owner occupancy", source: "homeowner" });
  }

  if (input.batteryCandidate === true || isPositiveInterest(input.batteryInterest)) {
    push({ label: "Battery Ready", tone: "amber", reason: "Battery candidate flag or homeowner battery interest is present", source: "opportunity" });
  }

  const sunlight = truthyString(input.sunlightConfidence);
  if (sunlight && ["high", "full_sun", "good", "strong"].some(token => sunlight.includes(token))) {
    push({ label: "Full Sun", tone: "amber", reason: "Sunlight confidence indicates strong solar access", source: "qualification" });
  }

  if (input.confidence?.level === "high") {
    push({ label: "High Confidence", tone: "emerald", reason: "Confidence model rates this opportunity high", source: "marketplace" });
  }

  const releaseAgeHours = hoursSince(input.releasedAt ?? input.createdAt ?? null);
  if (releaseAgeHours != null && releaseAgeHours <= 24) {
    push({ label: "Recently Released", tone: "orange", reason: "Marketplace release timestamp is within the last 24 hours", source: "marketplace" });
  }

  if (input.claimMode === "exclusive") {
    push({ label: "Exclusive Claim", tone: "rose", reason: "Opportunity is configured for exclusive claiming", source: "marketplace" });
  } else if (input.claimMode === "shared" && numeric(input.maxClaims) != null) {
    const remaining = Math.max(0, Number(input.maxClaims) - Number(input.claimCount ?? 0));
    push({ label: `${remaining} Shared Slots`, tone: remaining <= 1 ? "orange" : "slate", reason: "Shared claim capacity comes from marketplace inventory", source: "marketplace" });
  }

  return badges.slice(0, 10);
}
