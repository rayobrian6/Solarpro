import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";
import {
  boundedRange,
  formatRange,
  numberValue,
  pushUnique,
  type IntelligenceEvidenceNote,
  type IntelligenceRange,
} from "@/lib/network/intelligenceUtils";

export interface ProjectValueInput {
  releaseGate: MarketplaceReleaseGateResult;
  estimatedProjectValue?: number | null;
  estimatedAnnualSavings?: number | null;
  estimatedSystemSizeKw?: number | null;
  monthlyBillAmount?: number | null;
  annualUsageKwh?: number | null;
  utilityRatePerKwh?: number | null;
  estimatedOffsetPct?: number | null;
}

export interface ProjectValueResult {
  project_value_range: IntelligenceRange | null;
  gross_revenue_range: IntelligenceRange | null;
  annual_savings_range: IntelligenceRange | null;
  value_label: string;
  revenue_label: string;
  basis: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
}

export function deriveProjectValue(
  input: ProjectValueInput,
): ProjectValueResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const missing: string[] = [];
  const parsedBill = input.releaseGate.evidence.parsed_bill;
  const value = numberValue(input.estimatedProjectValue);
  const savings = numberValue(input.estimatedAnnualSavings);
  const systemSize = numberValue(
    input.estimatedSystemSizeKw ?? parsedBill.estimated_system_size_kw,
  );
  const monthlyBill = numberValue(
    input.monthlyBillAmount ??
      input.releaseGate.evidence.homeowner_intake.monthly_bill_amount,
  );
  const annualUsage = numberValue(
    input.annualUsageKwh ?? parsedBill.annual_usage_kwh,
  );
  const rate = numberValue(
    input.utilityRatePerKwh ?? parsedBill.utility_rate_per_kwh,
  );
  const offset = numberValue(input.estimatedOffsetPct);

  if (value)
    evidence.push({
      label: "Estimated project value",
      value: `$${Math.round(value).toLocaleString("en-US")}`,
      source: "estimated",
    });
  else pushUnique(missing, "Project value estimate unavailable");
  if (systemSize)
    evidence.push({
      label: "Estimated system size",
      value: `${systemSize >= 10 ? Math.round(systemSize) : systemSize.toFixed(1)} kW`,
      source:
        systemSize === parsedBill.estimated_system_size_kw
          ? "parsed_bill"
          : "estimated",
    });
  else pushUnique(missing, "System size estimate unavailable");
  if (annualUsage)
    evidence.push({
      label: "Annual usage",
      value: `${Math.round(annualUsage).toLocaleString("en-US")} kWh`,
      source:
        annualUsage === parsedBill.annual_usage_kwh
          ? "parsed_bill"
          : "estimated",
    });
  if (monthlyBill)
    evidence.push({
      label: "Monthly bill",
      value: `$${Math.round(monthlyBill).toLocaleString("en-US")}`,
      source: "homeowner_entered",
    });
  if (rate)
    evidence.push({
      label: "Utility rate",
      value: `${(rate * 100).toFixed(1)}¢/kWh`,
      source:
        rate === parsedBill.utility_rate_per_kwh ? "parsed_bill" : "estimated",
    });
  if (offset)
    evidence.push({
      label: "Estimated offset",
      value: `${Math.round(offset)}%`,
      source: "estimated",
    });

  const spread = input.releaseGate.evidence.parsed_bill.has_real_parser_output
    ? 0.1
    : 0.18;
  const projectValueRange = value
    ? boundedRange(value, spread, "usd", "Estimated project value range")
    : null;
  const grossRevenueRange = value
    ? boundedRange(value, spread, "usd", "Likely gross contract revenue range")
    : null;
  const annualSavingsRange = savings
    ? boundedRange(savings, 0.12, "usd", "Estimated annual savings range")
    : null;

  if (!annualSavingsRange)
    pushUnique(missing, "Annual savings estimate unavailable");

  const basisParts: string[] = [];
  if (value) basisParts.push("stored project value estimate");
  if (systemSize) basisParts.push("system size");
  if (annualUsage) basisParts.push("usage intelligence");
  if (rate) basisParts.push("utility rate");

  return {
    project_value_range: projectValueRange,
    gross_revenue_range: grossRevenueRange,
    annual_savings_range: annualSavingsRange,
    value_label: formatRange(
      projectValueRange,
      "Project value awaiting validation",
    ),
    revenue_label: formatRange(
      grossRevenueRange,
      "Revenue potential awaiting project estimate",
    ),
    basis: basisParts.length
      ? `Derived from ${basisParts.join(", ")}.`
      : "Limited bill intelligence; no deterministic value basis yet.",
    evidence,
    missing,
  };
}
