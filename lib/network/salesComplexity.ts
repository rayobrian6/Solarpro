import type { MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";
import type { FinancingIntelligenceResult } from "@/lib/network/financingIntelligence";
import type { InstallComplexityResult } from "@/lib/network/installComplexity";
import type { PurchaseProfileResult } from "@/lib/network/purchaseProfile";
import {
  capitalizeLabel,
  clampScore,
  normalizedText,
  numberValue,
  pushUnique,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
} from "@/lib/network/intelligenceUtils";

export interface SalesComplexityInput {
  purchaseProfile: PurchaseProfileResult;
  financing: FinancingIntelligenceResult;
  installComplexity: InstallComplexityResult;
  confidence: MarketplaceConfidenceResult;
  monthlyBillAmount?: number | null;
  utilityRatePerKwh?: number | null;
  timeline?: string | null;
  leadGrade?: string | null;
  qualificationStatus?: string | null;
  releaseWarnings?: string[];
}

export interface SalesComplexityResult {
  level: IntelligenceLevel;
  label: string;
  closing_difficulty: IntelligenceLevel;
  closing_difficulty_label: string;
  score: number;
  evidence: IntelligenceEvidenceNote[];
  risks: string[];
  missing: string[];
}

export function deriveSalesComplexity(
  input: SalesComplexityInput,
): SalesComplexityResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const risks: string[] = [];
  const missing: string[] = [];
  let score = 45;
  const timeline = normalizedText(input.timeline);
  const grade = normalizedText(input.leadGrade);
  const status = normalizedText(input.qualificationStatus);
  const monthlyBill = numberValue(input.monthlyBillAmount);
  const rate = numberValue(input.utilityRatePerKwh);

  if (input.confidence.level === "high") {
    score -= 10;
    evidence.push({
      label: "Confidence",
      value: input.confidence.label,
      source: "marketplace",
    });
  }
  if (input.confidence.level === "low") {
    score += 12;
    risks.push("Low marketplace confidence");
  }

  if (
    input.purchaseProfile.homeowner_seriousness === "urgent" ||
    input.purchaseProfile.homeowner_seriousness === "high"
  ) {
    score -= 12;
    evidence.push({
      label: "Homeowner seriousness",
      value: input.purchaseProfile.seriousness_label,
      source: "homeowner",
    });
  } else if (input.purchaseProfile.homeowner_seriousness === "unknown") {
    score += 8;
    pushUnique(missing, "Homeowner seriousness pending");
  }

  if (
    input.financing.likelihood === "high" ||
    input.financing.likelihood === "medium"
  ) {
    score -= 6;
    evidence.push({
      label: "Financing",
      value: input.financing.likelihood_label,
      source: "qualification",
    });
  } else if (input.financing.likelihood === "unknown") {
    score += 6;
    pushUnique(missing, "Financing path pending");
  }

  if (input.installComplexity.level === "high") {
    score += 14;
    risks.push("Install complexity may extend sale/design review");
  } else if (input.installComplexity.level === "medium") score += 6;

  if (monthlyBill && monthlyBill >= 200) {
    score -= 5;
    evidence.push({
      label: "Bill motivation",
      value: `$${Math.round(monthlyBill).toLocaleString("en-US")}/mo bill`,
      source: "homeowner_entered",
    });
  }
  if (rate && rate >= 0.18) {
    score -= 4;
    evidence.push({
      label: "Rate motivation",
      value: `${(rate * 100).toFixed(1)}¢/kWh`,
      source: "parsed_bill",
    });
  }
  if (
    ["asap", "immediate", "0_1_month", "1_3_months"].some((token) =>
      timeline?.includes(token),
    )
  )
    score -= 6;
  if (
    ["a", "a+", "qualified", "approved", "high_intent"].some(
      (token) => grade === token || status === token,
    )
  )
    score -= 8;

  const warningCount = input.releaseWarnings?.length ?? 0;
  if (warningCount >= 3) {
    score += 8;
    risks.push("Multiple release/bill warnings need review");
  }

  const boundedScore = clampScore(score);
  const level: IntelligenceLevel =
    boundedScore >= 70
      ? "high"
      : boundedScore >= 45
        ? "medium"
        : boundedScore >= 25
          ? "low"
          : "low";
  return {
    level,
    label: `${capitalizeLabel(level)} sales complexity`,
    closing_difficulty: level,
    closing_difficulty_label: `${capitalizeLabel(level)} closing difficulty`,
    score: boundedScore,
    evidence,
    risks,
    missing,
  };
}
