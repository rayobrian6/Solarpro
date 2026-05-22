import {
  deriveReleaseReadiness,
  safeOperationalLog,
  stateFromPipelineResult,
  type ReleaseReadiness,
} from "@/lib/intake/operationalLifecycle";

export interface MarketplaceGateRow {
  id?: unknown;
  status?: unknown;
  screening_status?: unknown;
  auto_decision?: unknown;
  override_decision?: unknown;
  intake_metadata?: unknown;
  raw_payload?: unknown;
  qualification_intelligence?: unknown;
  marketplace_status?: unknown;
}

type ParsedBillSource = "payload.bill_intelligence" | "intake_metadata.bill_intelligence" | "none";

export interface MarketplaceReleaseGateEvidence {
  homeowner_intake: {
    present: boolean;
    monthly_bill_amount: number | null;
    utility_provider: string | null;
    timeline: string | null;
    financing_interest: boolean;
    source: "raw_payload" | "intake_metadata" | "none";
  };
  bill_evidence: {
    stored_attachment: boolean;
    storage_status: string | null;
    filename: string | null;
    storage_provider: string | null;
  };
  parsed_bill: {
    status: string | null;
    has_real_parser_output: boolean;
    utility_provider: string | null;
    monthly_usage_avg_kwh: number | null;
    annual_usage_kwh: number | null;
    utility_rate_per_kwh: number | null;
    estimated_system_size_kw: number | null;
    total_amount: number | null;
    source: "payload.bill_intelligence" | "intake_metadata.bill_intelligence" | "none";
  };
  qualification: {
    present: boolean;
    status: string | null;
    lead_grade: string | null;
    finance_readiness: boolean;
    purchase_intent: string | null;
  };
  operator_review: {
    contacted: boolean;
    qualified: boolean;
    financing_ready: boolean;
    approved_for_marketplace: boolean;
  };
  screening: {
    approved: boolean;
    screening_status: string | null;
    auto_decision: string | null;
    override_decision: string | null;
  };
  source_separation: {
    homeowner_values_preserved: true;
    parsed_bill_values_do_not_overwrite_homeowner_intake: true;
  };
}

export interface MarketplaceReleaseGateResult {
  approvedScreening: boolean;
  releaseReadiness: ReleaseReadiness;
  ok: boolean;
  missing: string[];
  blockers: string[];
  warnings: string[];
  evidence: MarketplaceReleaseGateEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "yes", "1", "y", "on"].includes(value.toLowerCase());
  }
  return false;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const string = stringValue(value);
    if (string) return string;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null) return number;
  }
  return null;
}

function recordAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return isRecord(source[key]) ? source[key] : {};
}

function parserBillData(billIntelligence: Record<string, unknown>): Record<string, unknown> {
  const parserResult = recordAt(billIntelligence, "parser_result");
  return recordAt(parserResult, "billData");
}

function hasRealParserOutput(billIntelligence: Record<string, unknown>): boolean {
  const parserResult = recordAt(billIntelligence, "parser_result");
  const extraction = recordAt(billIntelligence, "extraction");
  const billData = parserBillData(billIntelligence);
  const bill = recordAt(billIntelligence, "bill");
  const projection = recordAt(billIntelligence, "marketplace_projection");
  const monthlyHistory = Array.isArray(billData.monthlyUsageHistory)
    ? billData.monthlyUsageHistory
    : [];
  const extractedFields = Array.isArray(billData.extractedFields)
    ? billData.extractedFields
    : Array.isArray(extraction.extracted_fields)
      ? extraction.extracted_fields
      : [];
  return !!(
    Object.keys(parserResult).length > 0 ||
    Object.keys(extraction).length > 0 ||
    Object.keys(billData).length > 0 ||
    Object.keys(bill).length > 0 ||
    Object.keys(projection).length > 0 ||
    extractedFields.length > 0 ||
    monthlyHistory.some((value) => numberValue(value) !== null)
  );
}

function monthlyAverageFromHistory(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const months = value
    .map((month) => numberValue(month))
    .filter((month): month is number => month !== null && month > 0);
  if (!months.length) return null;
  return Math.round((months.reduce((sum, month) => sum + month, 0) / months.length) * 10) / 10;
}

export function releaseGateMetadata(row: MarketplaceGateRow) {
  const intakeMetadata = isRecord(row.intake_metadata)
    ? row.intake_metadata
    : {};
  const rawPayload = isRecord(row.raw_payload) ? row.raw_payload : {};
  const operationalSource = isRecord(intakeMetadata.operational)
    ? intakeMetadata.operational
    : isRecord(rawPayload.operational)
      ? rawPayload.operational
      : {};
  const qualification = isRecord(row.qualification_intelligence)
    ? row.qualification_intelligence
    : isRecord(intakeMetadata.qualification)
      ? intakeMetadata.qualification
      : isRecord(rawPayload.qualification)
        ? rawPayload.qualification
        : {};
  const billMetadata = isRecord(rawPayload.bill_metadata)
    ? rawPayload.bill_metadata
    : isRecord(intakeMetadata.bill_metadata)
      ? intakeMetadata.bill_metadata
      : {};
  const billIntelligence = isRecord(rawPayload.bill_intelligence)
    ? rawPayload.bill_intelligence
    : isRecord(intakeMetadata.bill_intelligence)
      ? intakeMetadata.bill_intelligence
      : {};
  const billProjection = isRecord(rawPayload.bill_marketplace_projection)
    ? rawPayload.bill_marketplace_projection
    : isRecord(intakeMetadata.bill_marketplace_projection)
      ? intakeMetadata.bill_marketplace_projection
      : recordAt(billIntelligence, "marketplace_projection");
  const billIntelligenceSource: ParsedBillSource = isRecord(rawPayload.bill_intelligence)
    ? "payload.bill_intelligence"
    : isRecord(intakeMetadata.bill_intelligence)
      ? "intake_metadata.bill_intelligence"
      : "none";

  return {
    intakeMetadata,
    rawPayload,
    operational: stateFromPipelineResult({ operational: operationalSource }),
    qualification,
    billMetadata,
    billIntelligence,
    billProjection,
    billIntelligenceSource,
  };
}

function buildGateEvidence(
  row: MarketplaceGateRow,
  metadata: ReturnType<typeof releaseGateMetadata>,
  approvedScreening: boolean,
): MarketplaceReleaseGateEvidence {
  const billData = parserBillData(metadata.billIntelligence);
  const bill = recordAt(metadata.billIntelligence, "bill");
  const extraction = recordAt(metadata.billIntelligence, "extraction");
  const homeownerSource = Object.keys(metadata.rawPayload).length > 0
    ? "raw_payload"
    : Object.keys(metadata.intakeMetadata).length > 0
      ? "intake_metadata"
      : "none";
  const monthlyUsage = firstNumber(
    metadata.billProjection.monthly_usage_avg_kwh,
    metadata.billProjection.monthly_kwh,
    bill.monthly_kwh,
    billData.monthlyKwh,
    monthlyAverageFromHistory(billData.monthlyUsageHistory),
  );
  const annualUsage = firstNumber(
    metadata.billProjection.annual_usage_kwh,
    metadata.billProjection.annual_kwh,
    bill.annual_kwh,
    billData.annualKwh,
  );
  const rate = firstNumber(
    metadata.billProjection.utility_rate_per_kwh,
    metadata.billProjection.electricity_rate_kwh,
    bill.cost_per_kwh,
    billData.costPerKwh,
  );
  const totalAmount = firstNumber(
    bill.total_amount,
    billData.totalAmount,
    billData.amountDue,
    metadata.billProjection.total_amount,
  );

  return {
    homeowner_intake: {
      present: Object.keys(metadata.rawPayload).length > 0 || Object.keys(metadata.intakeMetadata).length > 0,
      monthly_bill_amount: firstNumber(
        metadata.rawPayload.monthly_bill_amount,
        metadata.rawPayload.average_monthly_bill,
        metadata.intakeMetadata.monthly_bill_amount,
        metadata.intakeMetadata.average_monthly_bill,
      ),
      utility_provider: firstString(
        metadata.rawPayload.utility_provider,
        metadata.intakeMetadata.utility_provider,
      ),
      timeline: firstString(metadata.rawPayload.timeline, metadata.intakeMetadata.timeline),
      financing_interest: boolValue(metadata.rawPayload.financing_interest) || boolValue(metadata.rawPayload.homeowner_financing_interest) || boolValue(metadata.intakeMetadata.financing_interest) || boolValue(metadata.intakeMetadata.homeowner_financing_interest),
      source: homeownerSource,
    },
    bill_evidence: {
      stored_attachment: metadata.billMetadata.storage_status === "stored",
      storage_status: stringValue(metadata.billMetadata.storage_status),
      filename: firstString(metadata.billMetadata.filename, metadata.billMetadata.file_name),
      storage_provider: stringValue(metadata.billMetadata.storage_provider),
    },
    parsed_bill: {
      status: firstString(
        recordAt(metadata.rawPayload, "pipeline_result").bill_intelligence,
        recordAt(metadata.intakeMetadata, "pipeline_result").bill_intelligence,
        recordAt(metadata.billIntelligence, "status").status,
      ) ?? stringValue(extraction.status),
      has_real_parser_output: hasRealParserOutput(metadata.billIntelligence),
      utility_provider: firstString(
        metadata.billProjection.utility_provider,
        bill.utility_provider,
        billData.utilityName,
        billData.utilityProvider,
      ),
      monthly_usage_avg_kwh: monthlyUsage,
      annual_usage_kwh: annualUsage,
      utility_rate_per_kwh: rate,
      estimated_system_size_kw: firstNumber(metadata.billProjection.estimated_system_size_kw),
      total_amount: totalAmount,
      source: metadata.billIntelligenceSource,
    },
    qualification: {
      present: Object.keys(metadata.qualification).length > 0,
      status: firstString(metadata.qualification.qualification_status, metadata.qualification.status),
      lead_grade: stringValue(metadata.qualification.lead_grade),
      finance_readiness: boolValue(metadata.qualification.finance_readiness),
      purchase_intent: firstString(
        recordAt(metadata.qualification, "normalized").purchase_intent,
        metadata.qualification.purchase_intent,
        metadata.qualification.financing_preference,
      ),
    },
    operator_review: {
      contacted: metadata.operational.contacted === true,
      qualified: metadata.operational.qualified === true,
      financing_ready: metadata.operational.financing_ready === true,
      approved_for_marketplace: metadata.operational.approved_for_marketplace === true,
    },
    screening: {
      approved: approvedScreening,
      screening_status: stringValue(row.screening_status),
      auto_decision: stringValue(row.auto_decision),
      override_decision: stringValue(row.override_decision),
    },
    source_separation: {
      homeowner_values_preserved: true,
      parsed_bill_values_do_not_overwrite_homeowner_intake: true,
    },
  };
}

function billWarnings(evidence: MarketplaceReleaseGateEvidence): string[] {
  const warnings: string[] = [];
  const homeownerUtility = evidence.homeowner_intake.utility_provider?.toLowerCase();
  const parsedUtility = evidence.parsed_bill.utility_provider?.toLowerCase();
  if (homeownerUtility && parsedUtility && homeownerUtility !== parsedUtility) {
    warnings.push("parsed_bill_utility_differs_from_homeowner_utility");
  }

  const homeownerBill = evidence.homeowner_intake.monthly_bill_amount;
  const parsedTotal = evidence.parsed_bill.total_amount;
  if (homeownerBill !== null && parsedTotal !== null && homeownerBill > 0) {
    const pctDelta = Math.abs(parsedTotal - homeownerBill) / homeownerBill;
    if (pctDelta >= 0.35) warnings.push("parsed_bill_amount_challenges_homeowner_monthly_bill");
    else warnings.push("parsed_bill_amount_supports_homeowner_monthly_bill");
  }

  if (!evidence.bill_evidence.stored_attachment) {
    warnings.push("stored_bill_evidence_missing");
  }

  if (!evidence.parsed_bill.has_real_parser_output) {
    warnings.push("parsed_bill_intelligence_missing");
  }

  if (evidence.homeowner_intake.monthly_bill_amount !== null && evidence.parsed_bill.monthly_usage_avg_kwh !== null) {
    warnings.push("homeowner_bill_amount_and_parsed_usage_kept_as_separate_sources");
  }

  return warnings;
}

export function evaluateMarketplaceReleaseGate(row: MarketplaceGateRow): MarketplaceReleaseGateResult {
  const metadata = releaseGateMetadata(row);
  const isLiveMarketplaceInventory = row.status === "live" && row.marketplace_status === "live";
  const approvedScreening =
    row.screening_status === "approved" ||
    row.auto_decision === "pass" ||
    row.override_decision === "pass" ||
    isLiveMarketplaceInventory;
  const operational = metadata.operational;
  const archivedOrRejected = !!(operational.archived || operational.rejected || row.status === "archived" || row.status === "rejected");
  const testOrSimulated = !!(metadata.intakeMetadata.is_test || metadata.intakeMetadata.is_simulated || metadata.rawPayload.is_test || metadata.rawPayload.is_simulated);
  const releaseReadiness = deriveReleaseReadiness({
    operational: metadata.operational,
    intake: metadata.intakeMetadata,
    qualification: metadata.qualification,
    validation: metadata.intakeMetadata.validation,
    screening: {
      screening_status: row.screening_status,
      auto_decision: row.auto_decision,
      override_decision: row.override_decision,
    },
  });
  const evidence = buildGateEvidence(row, metadata, approvedScreening);
  const missing = isLiveMarketplaceInventory ? [] : [...releaseReadiness.missing];
  if (!approvedScreening) missing.push("screening_approved");
  if (archivedOrRejected) missing.push("active_not_archived_or_rejected");
  if (testOrSimulated) missing.push("not_test_or_simulated");
  if (!isLiveMarketplaceInventory && !evidence.homeowner_intake.present) missing.push("homeowner_intake_present");
  if (!isLiveMarketplaceInventory && !evidence.qualification.present) missing.push("qualification_present");
  if (!isLiveMarketplaceInventory && !(evidence.operator_review.financing_ready || evidence.qualification.finance_readiness)) missing.push("financing_readiness");

  const blockers = Array.from(new Set(missing));
  const warnings = billWarnings(evidence);
  return {
    approvedScreening,
    releaseReadiness,
    ok: blockers.length === 0,
    missing: blockers,
    blockers,
    warnings,
    evidence,
  };
}

export function marketplaceGateError(row: MarketplaceGateRow): string {
  const gate = evaluateMarketplaceReleaseGate(row);
  if (gate.ok) return "";
  return `Marketplace release blocked: ${gate.missing.join(", ") || "release gate incomplete"}`;
}

export function marketplaceVisibilitySqlCondition(alias = "no"): string {
  return `
    ${alias}.intake_metadata->'operational'->>'approved_for_marketplace' = 'true'
    AND COALESCE((${alias}.intake_metadata->'operational'->>'archived')::boolean, false) = false
    AND COALESCE((${alias}.intake_metadata->'operational'->>'rejected')::boolean, false) = false
    AND COALESCE((${alias}.intake_metadata->>'is_test')::boolean, false) = false
    AND COALESCE((${alias}.intake_metadata->>'is_simulated')::boolean, false) = false
  `;
}

export function logMarketplaceGate(
  tag:
    | "[MARKETPLACE RELEASE GATE]"
    | "[MARKETPLACE VISIBILITY]"
    | "[CONTRACTOR CLAIM FLOW]",
  row: MarketplaceGateRow,
  action?: string,
) {
  const gate = evaluateMarketplaceReleaseGate(row);
  console.info(tag, {
    ...safeOperationalLog({
      opportunityId: stringValue(row.id),
      action,
      fromStatus: stringValue(row.status),
      toStatus: gate.ok ? "release_gate_passed" : "release_gate_blocked",
      releaseReadiness: gate.releaseReadiness,
    }),
    approved_screening: gate.approvedScreening,
    blockers: gate.blockers,
    warnings: gate.warnings,
    evidence: gate.evidence,
  });
  return gate;
}
