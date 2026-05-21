import { deriveMarketplaceBadges, type MarketplaceBadge } from "@/lib/network/marketplaceBadges";
import { deriveMarketplaceConfidence, type MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";
import { buildMarketplaceNarrative, type MarketplaceNarrativeResult } from "@/lib/network/marketplaceNarratives";
import {
  evaluateMarketplaceReleaseGate,
  type MarketplaceReleaseGateEvidence,
  type MarketplaceReleaseGateResult,
} from "@/lib/network/marketplaceReleaseGate";

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

export interface MarketplaceRevenueIntelligence {
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
}

export interface MarketplaceEvidenceSummary {
  homeowner_intake: MarketplaceReleaseGateEvidence["homeowner_intake"];
  bill_evidence: MarketplaceReleaseGateEvidence["bill_evidence"];
  parsed_bill: MarketplaceReleaseGateEvidence["parsed_bill"];
  qualification: MarketplaceReleaseGateEvidence["qualification"];
  operator_review: MarketplaceReleaseGateEvidence["operator_review"];
  screening: MarketplaceReleaseGateEvidence["screening"];
  source_separation: MarketplaceReleaseGateEvidence["source_separation"];
}

export interface MarketplaceReleaseSummary {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  missing: string[];
}

export interface MarketplaceIntelligenceProjection {
  confidence: MarketplaceConfidenceResult;
  badges: MarketplaceBadge[];
  narrative: MarketplaceNarrativeResult;
  revenue: MarketplaceRevenueIntelligence;
  evidence: MarketplaceEvidenceSummary;
  release: MarketplaceReleaseSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "n", "off"].includes(normalized)) return false;
  }
  return null;
}

function field<T>(value: T | null, source: MarketplaceValueSource, label: string): MarketplaceSourcedValue<T> | null {
  return value == null ? null : { value, source, label };
}

function normalizedOffset(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric == null || numeric <= 0) return null;
  return numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric);
}

function buildReleaseGate(row: Record<string, unknown>): MarketplaceReleaseGateResult {
  return evaluateMarketplaceReleaseGate({
    id: row.id,
    status: row.marketplace_lifecycle_status ?? row.status,
    screening_status: row.marketplace_screening_status,
    auto_decision: row.marketplace_auto_decision,
    override_decision: row.marketplace_override_decision,
    intake_metadata: row.marketplace_intake_metadata,
    raw_payload: row.marketplace_raw_payload,
  });
}

function enrichmentField<T = unknown>(row: Record<string, unknown>, group: string, key: string): T | null {
  const payload = row.enrichment_payload;
  if (!isRecord(payload)) return null;
  const groupRecord = payload[group];
  if (!isRecord(groupRecord)) return null;
  const fieldRecord = groupRecord[key];
  if (isRecord(fieldRecord) && "value" in fieldRecord) return fieldRecord.value as T;
  return null;
}

export function buildMarketplaceIntelligence(row: Record<string, unknown>): MarketplaceIntelligenceProjection {
  const releaseGate = buildReleaseGate(row);
  const evidence = releaseGate.evidence;

  const estimatedProjectValue = numberValue(row.estimated_system_cost ?? enrichmentField(row, "core", "estimated_project_value"));
  const estimatedSystemSize = numberValue(row.system_size_kw ?? evidence.parsed_bill.estimated_system_size_kw ?? enrichmentField(row, "core", "estimated_system_size_kw"));
  const monthlyBill = numberValue(row.monthly_bill_amount ?? evidence.homeowner_intake.monthly_bill_amount);
  const annualUsage = numberValue(row.annual_kwh ?? evidence.parsed_bill.annual_usage_kwh);
  const monthlyUsage = numberValue(row.monthly_kwh_avg ?? evidence.parsed_bill.monthly_usage_avg_kwh);
  const utilityRate = numberValue(row.utility_rate_per_kwh ?? evidence.parsed_bill.utility_rate_per_kwh);
  const utilityProvider = stringValue(row.utility_name ?? evidence.homeowner_intake.utility_provider ?? evidence.parsed_bill.utility_provider);
  const estimatedAnnualSavings = numberValue(row.estimated_annual_savings ?? enrichmentField(row, "core", "estimated_annual_savings"));
  const estimatedOffset = normalizedOffset(row.estimated_offset_pct ?? enrichmentField(row, "core", "estimated_offset_pct"));
  const estimatedPayback = numberValue(row.estimated_payback_yrs);

  const confidence = deriveMarketplaceConfidence({
    releaseGate,
    annualUsageKwh: annualUsage,
    utilityProvider,
    utilityRatePerKwh: utilityRate,
    enrichmentCompleteness: row.enrichment_completeness as number | string | null | undefined,
    enrichmentWarnings: row.enrichment_warnings,
  });

  const badges = deriveMarketplaceBadges({
    releaseGate,
    confidence,
    leadGrade: stringValue(row.lead_grade),
    qualificationStatus: stringValue(row.qualification_status),
    financeReadiness: boolValue(row.finance_readiness),
    homeownerStatus: stringValue(row.homeowner_status),
    timeline: stringValue(row.timeline),
    batteryCandidate: boolValue(row.battery_candidate),
    batteryInterest: stringValue(row.battery_interest),
    sunlightConfidence: stringValue(row.sunlight_confidence),
    monthlyUsageKwh: monthlyUsage,
    annualUsageKwh: annualUsage,
    utilityRatePerKwh: utilityRate,
    createdAt: stringValue(row.created_at),
    releasedAt: stringValue(row.released_at),
    claimMode: stringValue(row.claim_mode),
    claimCount: numberValue(row.claim_count),
    maxClaims: numberValue(row.max_claims),
  });

  const narrative = buildMarketplaceNarrative({
    city: stringValue(row.city),
    stateCode: stringValue(row.state_code),
    estimatedProjectValue,
    estimatedSystemSizeKw: estimatedSystemSize,
    annualUsageKwh: annualUsage,
    monthlyBillAmount: monthlyBill,
    utilityProvider,
    utilityRatePerKwh: utilityRate,
    estimatedAnnualSavings,
    estimatedOffsetPct: estimatedOffset,
    financeReadiness: boolValue(row.finance_readiness),
    batteryCandidate: boolValue(row.battery_candidate),
    timeline: stringValue(row.timeline),
    leadGrade: stringValue(row.lead_grade ?? row.qualification_status),
    badges,
    confidence,
    releaseGate,
  });

  return {
    confidence,
    badges,
    narrative,
    revenue: {
      estimated_project_value: field(estimatedProjectValue, "estimated", "Estimated project value"),
      estimated_system_size_kw: field(estimatedSystemSize, estimatedSystemSize === evidence.parsed_bill.estimated_system_size_kw ? "parsed_bill" : "estimated", "Estimated system size"),
      monthly_bill_amount: field(monthlyBill, "homeowner_entered", "Homeowner-entered monthly bill"),
      annual_usage_kwh: field(annualUsage, annualUsage === evidence.parsed_bill.annual_usage_kwh ? "parsed_bill" : "estimated", "Annual usage"),
      monthly_usage_avg_kwh: field(monthlyUsage, monthlyUsage === evidence.parsed_bill.monthly_usage_avg_kwh ? "parsed_bill" : "estimated", "Monthly usage average"),
      utility_rate_per_kwh: field(utilityRate, utilityRate === evidence.parsed_bill.utility_rate_per_kwh ? "parsed_bill" : "estimated", "Utility rate"),
      estimated_annual_savings: field(estimatedAnnualSavings, "estimated", "Estimated annual savings"),
      estimated_offset_pct: field(estimatedOffset, "estimated", "Estimated offset"),
      estimated_payback_yrs: field(estimatedPayback, "estimated", "Estimated payback"),
      utility_provider: field(utilityProvider, utilityProvider === evidence.parsed_bill.utility_provider ? "parsed_bill" : "homeowner_entered", "Utility provider"),
    },
    evidence: {
      homeowner_intake: evidence.homeowner_intake,
      bill_evidence: evidence.bill_evidence,
      parsed_bill: evidence.parsed_bill,
      qualification: evidence.qualification,
      operator_review: evidence.operator_review,
      screening: evidence.screening,
      source_separation: evidence.source_separation,
    },
    release: {
      ok: releaseGate.ok,
      blockers: releaseGate.blockers,
      warnings: releaseGate.warnings,
      missing: releaseGate.missing,
    },
  };
}
