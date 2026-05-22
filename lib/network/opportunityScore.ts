import type { MarketplaceConfidenceResult } from "@/lib/network/marketplaceConfidence";
import type { FinancingIntelligenceResult } from "@/lib/network/financingIntelligence";
import type { InstallComplexityResult } from "@/lib/network/installComplexity";
import type { ProjectValueResult } from "@/lib/network/projectValue";
import type { MarketplaceRevenueProjectionResult } from "@/lib/network/marketplaceRevenueProjection";
import type { PurchaseProfileResult } from "@/lib/network/purchaseProfile";
import type { SalesComplexityResult } from "@/lib/network/salesComplexity";
import { clampScore } from "@/lib/network/intelligenceUtils";

export interface OpportunityScoreInput {
  confidence: MarketplaceConfidenceResult;
  purchaseProfile: PurchaseProfileResult;
  projectValue: ProjectValueResult;
  financing: FinancingIntelligenceResult;
  salesComplexity: SalesComplexityResult;
  installComplexity: InstallComplexityResult;
  revenueProjection?: MarketplaceRevenueProjectionResult | null;
  batteryCandidate?: boolean | null;
  releaseOk?: boolean;
}

export interface OpportunityScoreResult {
  score: number;
  label: string;
  tier: "elite" | "strong" | "developing" | "limited";
  reasons: string[];
  cautions: string[];
}

export function deriveOpportunityScore(
  input: OpportunityScoreInput,
): OpportunityScoreResult {
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 20;

  score += Math.round(input.confidence.score * 0.25);
  reasons.push(`${input.confidence.label} contributes evidence quality`);

  if (input.projectValue.project_value_range) {
    score += 18;
    reasons.push("Project value range available");
  } else if (input.revenueProjection?.project_value_range) {
    score += 16;
    reasons.push("Revenue projection value range available");
  } else cautions.push("Project value unavailable");

  if (input.revenueProjection) {
    score += Math.round(
      input.revenueProjection.opportunity_score_contribution * 0.45,
    );
    if (input.revenueProjection.gross_opportunity_tier !== "unknown")
      reasons.push(input.revenueProjection.gross_opportunity_label);
    if (!input.revenueProjection.project_value_range)
      cautions.push("Revenue projection awaiting system size");
  }

  if (
    input.purchaseProfile.homeowner_seriousness === "urgent" ||
    input.purchaseProfile.homeowner_seriousness === "high"
  ) {
    score += 14;
    reasons.push(input.purchaseProfile.seriousness_label);
  } else if (input.purchaseProfile.homeowner_seriousness === "unknown")
    cautions.push("Homeowner seriousness awaiting validation");

  if (input.financing.likelihood === "high") {
    score += 12;
    reasons.push(input.financing.likelihood_label);
  } else if (input.financing.likelihood === "medium") {
    score += 8;
    reasons.push(input.financing.likelihood_label);
  } else cautions.push(input.financing.likelihood_label);

  if (input.salesComplexity.level === "low") {
    score += 10;
    reasons.push("Lower sales complexity");
  } else if (input.salesComplexity.level === "medium") score += 4;
  else cautions.push("Sales complexity requires attention");

  if (input.installComplexity.level === "low") {
    score += 8;
    reasons.push("Favorable install complexity signal");
  } else if (input.installComplexity.level === "medium") score += 3;
  else if (input.installComplexity.level === "high")
    cautions.push("Install complexity may pressure margin");

  if (input.batteryCandidate === true) {
    score += 4;
    reasons.push("Battery attachment signal present");
  }
  if (input.releaseOk === false) {
    score -= 18;
    cautions.push("Release readiness has blockers or warnings");
  }

  const boundedScore = clampScore(score);
  const tier =
    boundedScore >= 82
      ? "elite"
      : boundedScore >= 65
        ? "strong"
        : boundedScore >= 45
          ? "developing"
          : "limited";

  return {
    score: boundedScore,
    label: `${boundedScore}/100 opportunity score`,
    tier,
    reasons: Array.from(new Set(reasons)).slice(0, 6),
    cautions: Array.from(new Set(cautions)).slice(0, 6),
  };
}
