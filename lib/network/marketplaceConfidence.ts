import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";

export type MarketplaceConfidenceLevel = "high" | "medium" | "low";

export interface MarketplaceConfidenceInput {
  releaseGate?: MarketplaceReleaseGateResult | null;
  annualUsageKwh?: number | null;
  utilityProvider?: string | null;
  utilityRatePerKwh?: number | null;
  enrichmentCompleteness?: number | string | null;
  enrichmentWarnings?: unknown;
}

export interface MarketplaceConfidenceResult {
  level: MarketplaceConfidenceLevel;
  score: number;
  label: "High Confidence" | "Medium Confidence" | "Low Confidence";
  reasons: string[];
  warnings: string[];
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return [value];
    }
    return [value];
  }
  return [];
}

function completenessToScore(value: unknown): number | null {
  const raw = numeric(value);
  if (raw == null) return null;
  const normalized = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

export function deriveMarketplaceConfidence(input: MarketplaceConfidenceInput): MarketplaceConfidenceResult {
  const evidence = input.releaseGate?.evidence;
  const reasons: string[] = [];
  const warnings = Array.from(new Set([...(input.releaseGate?.warnings ?? []), ...stringArray(input.enrichmentWarnings)]));
  let score = 20;

  if (evidence?.bill_evidence.stored_attachment) {
    score += 22;
    reasons.push("Verified stored utility bill evidence");
  } else {
    warnings.push("No stored bill evidence available to contractor feed");
  }

  if (evidence?.parsed_bill.has_real_parser_output) {
    score += 22;
    reasons.push("Real parsed bill intelligence available");
  }

  if ((evidence?.parsed_bill.annual_usage_kwh ?? input.annualUsageKwh ?? null) != null) {
    score += 10;
    reasons.push("Annual usage is present");
  }

  if ((evidence?.parsed_bill.utility_provider ?? input.utilityProvider ?? null)) {
    score += 8;
    reasons.push("Utility provider is known");
  }

  if ((evidence?.parsed_bill.utility_rate_per_kwh ?? input.utilityRatePerKwh ?? null) != null) {
    score += 8;
    reasons.push("Utility rate is available");
  }

  if (evidence?.qualification.present) {
    score += 10;
    reasons.push("Qualification intelligence is present");
  }

  if (evidence?.operator_review.approved_for_marketplace) {
    score += 8;
    reasons.push("Operator approved for marketplace release");
  }

  const enrichmentCompleteness = completenessToScore(input.enrichmentCompleteness);
  if (enrichmentCompleteness != null) {
    score += Math.round(Math.min(12, enrichmentCompleteness / 10));
    reasons.push(`Enrichment completeness ${enrichmentCompleteness}%`);
  }

  if (warnings.length >= 3) score -= 8;
  if (input.releaseGate && !input.releaseGate.ok) score -= 20;

  const boundedScore = Math.max(0, Math.min(100, score));
  const level: MarketplaceConfidenceLevel = boundedScore >= 75 ? "high" : boundedScore >= 45 ? "medium" : "low";
  return {
    level,
    score: boundedScore,
    label: level === "high" ? "High Confidence" : level === "medium" ? "Medium Confidence" : "Low Confidence",
    reasons: Array.from(new Set(reasons)).slice(0, 5),
    warnings: Array.from(new Set(warnings)).slice(0, 5),
  };
}
