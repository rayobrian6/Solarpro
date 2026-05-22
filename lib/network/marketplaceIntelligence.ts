import {
  deriveMarketplaceBadges,
  type MarketplaceBadge,
} from "@/lib/network/marketplaceBadges";
import {
  deriveMarketplaceConfidence,
  type MarketplaceConfidenceResult,
} from "@/lib/network/marketplaceConfidence";
import {
  buildMarketplaceNarrative,
  type MarketplaceNarrativeResult,
} from "@/lib/network/marketplaceNarratives";
import {
  deriveFinancingIntelligence,
  type FinancingIntelligenceResult,
} from "@/lib/network/financingIntelligence";
import {
  deriveInstallComplexity,
  type InstallComplexityResult,
} from "@/lib/network/installComplexity";
import {
  deriveOpportunityScore,
  type OpportunityScoreResult,
} from "@/lib/network/opportunityScore";
import {
  deriveProjectValue,
  type ProjectValueResult,
} from "@/lib/network/projectValue";
import {
  deriveMarketplaceRevenueProjection,
  type MarketplaceRevenueProjectionResult,
} from "@/lib/network/marketplaceRevenueProjection";
import {
  derivePurchaseBehavior,
  type PurchaseBehaviorResult,
} from "@/lib/network/purchaseBehavior";
import {
  deriveMarketplaceExperience,
  type MarketplaceExperienceProjection,
} from "@/lib/network/marketplaceExperience";
import {
  derivePurchaseProfile,
  type PurchaseProfileResult,
} from "@/lib/network/purchaseProfile";
import {
  deriveSalesComplexity,
  type SalesComplexityResult,
} from "@/lib/network/salesComplexity";
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
  projection: MarketplaceRevenueProjectionResult;
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
  purchase_profile: PurchaseProfileResult;
  purchase_behavior: PurchaseBehaviorResult;
  project_value: ProjectValueResult;
  financing: FinancingIntelligenceResult;
  sales_complexity: SalesComplexityResult;
  install_complexity: InstallComplexityResult;
  opportunity_score: OpportunityScoreResult;
  experience: MarketplaceExperienceProjection;
  bill_visuals: MarketplaceBillVisualsProjection;
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

function recordAt(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return isRecord(source[key]) ? source[key] : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => numberValue(item))
    .filter((item): item is number => item !== null && item > 0);
}

function firstStringFrom(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = stringValue(value);
    if (resolved) return resolved;
  }
  return null;
}

function firstNumberFrom(...values: unknown[]): number | null {
  for (const value of values) {
    const resolved = numberValue(value);
    if (resolved !== null) return resolved;
  }
  return null;
}

function buildBillVisuals(
  row: Record<string, unknown>,
): MarketplaceBillVisualsProjection {
  const rawPayload = isRecord(row.marketplace_raw_payload)
    ? row.marketplace_raw_payload
    : {};
  const intakeMetadata = isRecord(row.marketplace_intake_metadata)
    ? row.marketplace_intake_metadata
    : {};
  const billIntelligence = isRecord(rawPayload.bill_intelligence)
    ? rawPayload.bill_intelligence
    : isRecord(intakeMetadata.bill_intelligence)
      ? intakeMetadata.bill_intelligence
      : {};
  const parserResult = recordAt(billIntelligence, "parser_result");
  const billData = recordAt(parserResult, "billData");
  const bill = recordAt(billIntelligence, "bill");
  const extraction = recordAt(billIntelligence, "extraction");
  const metadata = recordAt(parserResult, "metadata");

  const parserMonthlyUsageHistory = numberArray(billData.monthlyUsageHistory);
  const billMonthlyUsageHistory = numberArray(bill.monthly_usage_history);
  const monthlyUsageHistory = parserMonthlyUsageHistory.length
    ? parserMonthlyUsageHistory
    : billMonthlyUsageHistory;
  const parserExtractedFields = stringArray(billData.extractedFields);
  const extractionExtractedFields = stringArray(extraction.extracted_fields);
  const extractedFields = parserExtractedFields.length
    ? parserExtractedFields
    : extractionExtractedFields;

  return {
    status: firstStringFrom(extraction.status, billIntelligence.status),
    confidence_label: firstStringFrom(
      extraction.confidence_label,
      billData.confidence,
    ),
    confidence_score: firstNumberFrom(
      extraction.confidence,
      billData.confidenceScore,
    ),
    parser_method: firstStringFrom(
      extraction.method,
      metadata.parserMethod,
      parserResult.parserMethod,
    ),
    parser_model: firstStringFrom(
      metadata.claudeModel,
      metadata.model,
      parserResult.model,
    ),
    parser_input: firstStringFrom(
      metadata.inputType,
      metadata.input,
      extraction.parser_path,
    ),
    months_found: monthlyUsageHistory.length,
    monthly_usage_history: monthlyUsageHistory,
    extracted_fields: extractedFields,
    bill_type: firstStringFrom(bill.bill_type, billData.billType),
  };
}

function field<T>(
  value: T | null,
  source: MarketplaceValueSource,
  label: string,
): MarketplaceSourcedValue<T> | null {
  return value == null ? null : { value, source, label };
}

function normalizedOffset(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric == null || numeric <= 0) return null;
  return numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric);
}

function buildReleaseGate(
  row: Record<string, unknown>,
): MarketplaceReleaseGateResult {
  return evaluateMarketplaceReleaseGate({
    id: row.id,
    status: row.marketplace_lifecycle_status ?? row.status,
    marketplace_status: row.marketplace_status,
    screening_status: row.marketplace_screening_status,
    auto_decision: row.marketplace_auto_decision,
    override_decision: row.marketplace_override_decision,
    intake_metadata: row.marketplace_intake_metadata,
    raw_payload: row.marketplace_raw_payload,
  });
}

function enrichmentField<T = unknown>(
  row: Record<string, unknown>,
  group: string,
  key: string,
): T | null {
  const payload = row.enrichment_payload;
  if (!isRecord(payload)) return null;
  const groupRecord = payload[group];
  if (!isRecord(groupRecord)) return null;
  const fieldRecord = groupRecord[key];
  if (isRecord(fieldRecord) && "value" in fieldRecord)
    return fieldRecord.value as T;
  return null;
}

export function buildMarketplaceIntelligence(
  row: Record<string, unknown>,
): MarketplaceIntelligenceProjection {
  const releaseGate = buildReleaseGate(row);
  const evidence = releaseGate.evidence;
  const billVisuals = buildBillVisuals(row);

  const estimatedProjectValue = numberValue(
    row.estimated_system_cost ??
      enrichmentField(row, "core", "estimated_project_value"),
  );
  const estimatedSystemSize = numberValue(
    row.system_size_kw ??
      evidence.parsed_bill.estimated_system_size_kw ??
      enrichmentField(row, "core", "estimated_system_size_kw"),
  );
  const monthlyBill = numberValue(
    row.monthly_bill_amount ?? evidence.homeowner_intake.monthly_bill_amount,
  );
  const annualUsage = numberValue(
    row.annual_kwh ?? evidence.parsed_bill.annual_usage_kwh,
  );
  const monthlyUsage = numberValue(
    row.monthly_kwh_avg ?? evidence.parsed_bill.monthly_usage_avg_kwh,
  );
  const utilityRate = numberValue(
    row.utility_rate_per_kwh ?? evidence.parsed_bill.utility_rate_per_kwh,
  );
  const utilityProvider = stringValue(
    row.utility_name ??
      evidence.homeowner_intake.utility_provider ??
      evidence.parsed_bill.utility_provider,
  );
  const estimatedAnnualSavings = numberValue(
    row.estimated_annual_savings ??
      enrichmentField(row, "core", "estimated_annual_savings"),
  );
  const estimatedOffset = normalizedOffset(
    row.estimated_offset_pct ??
      enrichmentField(row, "core", "estimated_offset_pct"),
  );
  const estimatedPayback = numberValue(row.estimated_payback_yrs);
  const purchaseIntent = stringValue(row.purchase_intent);

  const confidence = deriveMarketplaceConfidence({
    releaseGate,
    annualUsageKwh: annualUsage,
    utilityProvider,
    utilityRatePerKwh: utilityRate,
    enrichmentCompleteness: row.enrichment_completeness as
      | number
      | string
      | null
      | undefined,
    enrichmentWarnings: row.enrichment_warnings,
  });

  const badges = deriveMarketplaceBadges({
    releaseGate,
    confidence,
    leadGrade: stringValue(row.lead_grade),
    qualificationStatus: stringValue(row.qualification_status),
    financeReadiness: boolValue(row.finance_readiness),
    purchaseIntent,
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

  const purchaseProfile = derivePurchaseProfile({
    releaseGate,
    financeReadiness: boolValue(row.finance_readiness),
    timeline: stringValue(row.timeline),
    leadGrade: stringValue(row.lead_grade),
    qualificationStatus: stringValue(row.qualification_status),
    homeownerStatus: stringValue(row.homeowner_status),
    batteryInterest: stringValue(row.battery_interest),
    preferredContactMethod: stringValue(row.preferred_contact_method),
    purchaseIntent: stringValue(row.purchase_intent),
  });

  const projectValue = deriveProjectValue({
    releaseGate,
    estimatedProjectValue,
    estimatedAnnualSavings,
    estimatedSystemSizeKw: estimatedSystemSize,
    monthlyBillAmount: monthlyBill,
    annualUsageKwh: annualUsage,
    utilityRatePerKwh: utilityRate,
    estimatedOffsetPct: estimatedOffset,
  });

  const installComplexity = deriveInstallComplexity({
    roofMaterial: stringValue(row.roof_material),
    roofPitch: stringValue(row.roof_pitch),
    roofCondition: stringValue(row.roof_condition),
    roofAgeYears: numberValue(row.roof_age_years),
    stories: numberValue(row.stories),
    structureType: stringValue(row.structure_type),
    usableRoofPct: numberValue(row.usable_roof_pct),
    steepRoof: boolValue(row.steep_roof),
    complexAhj: boolValue(row.complex_ahj),
    ahjName: stringValue(row.ahj_name),
    batteryCandidate: boolValue(row.battery_candidate),
  });

  const revenueProjection = deriveMarketplaceRevenueProjection({
    stateCode: stringValue(row.state_code),
    estimatedSystemSizeKw: estimatedSystemSize,
    batteryInterest: stringValue(row.battery_interest),
    batteryCandidate: boolValue(row.battery_candidate),
    purchaseIntent,
    financingPreference: purchaseIntent,
    utilityProvider,
    utilityRatePerKwh: utilityRate,
    monthlyBillAmount: monthlyBill,
    annualUsageKwh: annualUsage,
    estimatedOffsetPct: estimatedOffset,
    estimatedAnnualSavings,
    verifiedProjectValue: estimatedProjectValue,
    installComplexityLevel: installComplexity.level,
    installProfitabilitySignal: installComplexity.profitability_signal,
  });

  const financing = deriveFinancingIntelligence({
    releaseGate,
    financeReadiness: boolValue(row.finance_readiness),
    estimatedIncomeBand: stringValue(row.estimated_income_band),
    estimatedCreditBand: stringValue(row.estimated_credit_band),
    monthlyBillAmount: monthlyBill,
    estimatedProjectValue,
    purchaseIntent,
    qualificationStatus: stringValue(row.qualification_status),
    leadGrade: stringValue(row.lead_grade),
  });

  const purchaseBehavior = derivePurchaseBehavior({
    releaseGate,
    purchaseProfile,
    revenueProjection,
    purchaseIntent,
    financingPreference: purchaseIntent,
    timeline: stringValue(row.timeline),
    batteryInterest: stringValue(row.battery_interest),
    batteryCandidate: boolValue(row.battery_candidate),
    monthlyBillAmount: monthlyBill,
    annualUsageKwh: annualUsage,
    utilityRatePerKwh: utilityRate,
    estimatedCreditBand: stringValue(row.estimated_credit_band),
    estimatedIncomeBand: stringValue(row.estimated_income_band),
    qualificationStatus: stringValue(row.qualification_status),
    leadGrade: stringValue(row.lead_grade),
  });

  const salesComplexity = deriveSalesComplexity({
    purchaseProfile,
    financing,
    installComplexity,
    confidence,
    monthlyBillAmount: monthlyBill,
    utilityRatePerKwh: utilityRate,
    timeline: stringValue(row.timeline),
    leadGrade: stringValue(row.lead_grade),
    qualificationStatus: stringValue(row.qualification_status),
    releaseWarnings: releaseGate.warnings,
  });

  const opportunityScore = deriveOpportunityScore({
    confidence,
    purchaseProfile,
    projectValue,
    financing,
    salesComplexity,
    installComplexity,
    revenueProjection,
    batteryCandidate: boolValue(row.battery_candidate),
    releaseOk: releaseGate.ok,
  });

  const experience = deriveMarketplaceExperience({
    revenueProjection,
    confidence,
    badges,
    opportunityScore,
    purchaseProfile,
    purchaseBehavior,
    financing,
    installComplexity,
    billVisuals,
    evidence: {
      homeowner_intake: evidence.homeowner_intake,
      bill_evidence: evidence.bill_evidence,
      parsed_bill: evidence.parsed_bill,
      qualification: evidence.qualification,
      operator_review: evidence.operator_review,
      screening: evidence.screening,
      source_separation: evidence.source_separation,
    },
    estimatedSystemSizeKw: estimatedSystemSize,
    monthlyBillAmount: monthlyBill,
    annualUsageKwh: annualUsage,
    utilityRatePerKwh: utilityRate,
    estimatedAnnualSavings,
    estimatedOffsetPct: estimatedOffset,
    utilityProvider,
    timeline: stringValue(row.timeline),
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
    purchaseIntent,
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
      estimated_project_value: field(
        estimatedProjectValue,
        "estimated",
        "Estimated project value",
      ),
      estimated_system_size_kw: field(
        estimatedSystemSize,
        estimatedSystemSize === evidence.parsed_bill.estimated_system_size_kw
          ? "parsed_bill"
          : "estimated",
        "Estimated system size",
      ),
      monthly_bill_amount: field(
        monthlyBill,
        "homeowner_entered",
        "Homeowner-entered monthly bill",
      ),
      annual_usage_kwh: field(
        annualUsage,
        annualUsage === evidence.parsed_bill.annual_usage_kwh
          ? "parsed_bill"
          : "estimated",
        "Annual usage",
      ),
      monthly_usage_avg_kwh: field(
        monthlyUsage,
        monthlyUsage === evidence.parsed_bill.monthly_usage_avg_kwh
          ? "parsed_bill"
          : "estimated",
        "Monthly usage average",
      ),
      utility_rate_per_kwh: field(
        utilityRate,
        utilityRate === evidence.parsed_bill.utility_rate_per_kwh
          ? "parsed_bill"
          : "estimated",
        "Utility rate",
      ),
      estimated_annual_savings: field(
        estimatedAnnualSavings,
        "estimated",
        "Estimated annual savings",
      ),
      estimated_offset_pct: field(
        estimatedOffset,
        "estimated",
        "Estimated offset",
      ),
      estimated_payback_yrs: field(
        estimatedPayback,
        "estimated",
        "Estimated payback",
      ),
      utility_provider: field(
        utilityProvider,
        utilityProvider === evidence.parsed_bill.utility_provider
          ? "parsed_bill"
          : "homeowner_entered",
        "Utility provider",
      ),
      projection: revenueProjection,
    },
    purchase_profile: purchaseProfile,
    purchase_behavior: purchaseBehavior,
    project_value: projectValue,
    financing,
    sales_complexity: salesComplexity,
    install_complexity: installComplexity,
    opportunity_score: opportunityScore,
    experience,
    bill_visuals: billVisuals,
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
