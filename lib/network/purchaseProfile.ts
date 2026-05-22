import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";
import {
  capitalizeLabel,
  boolValue,
  displayText,
  normalizedText,
  pushUnique,
  stringValue,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
} from "@/lib/network/intelligenceUtils";

export type PurchaseMethod =
  | "cash"
  | "loan"
  | "lease_or_ppa"
  | "financing_likely"
  | "undetermined";
export type HomeownerSeriousness =
  | "urgent"
  | "high"
  | "medium"
  | "early"
  | "unknown";

export interface PurchaseProfileInput {
  releaseGate: MarketplaceReleaseGateResult;
  financeReadiness?: boolean | null;
  timeline?: string | null;
  leadGrade?: string | null;
  qualificationStatus?: string | null;
  homeownerStatus?: string | null;
  batteryInterest?: string | null;
  preferredContactMethod?: string | null;
}

export interface PurchaseProfileResult {
  likely_purchase_method: PurchaseMethod;
  purchase_method_label: string;
  homeowner_seriousness: HomeownerSeriousness;
  seriousness_label: string;
  urgency: IntelligenceLevel;
  urgency_label: string;
  readiness_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
}

function timelineUrgency(
  timeline: string | null | undefined,
): HomeownerSeriousness {
  const normalized = normalizedText(timeline);
  if (!normalized) return "unknown";
  if (
    ["asap", "now", "immediate", "0_1_month", "30_days"].some((token) =>
      normalized.includes(token),
    )
  )
    return "urgent";
  if (
    ["1_3_month", "one_three", "soon"].some((token) =>
      normalized.includes(token),
    )
  )
    return "high";
  if (
    ["3_6_month", "six", "this_year"].some((token) =>
      normalized.includes(token),
    )
  )
    return "medium";
  return "early";
}

function purchaseLabel(method: PurchaseMethod): string {
  switch (method) {
    case "cash":
      return "Cash possible";
    case "loan":
      return "Loan likely";
    case "lease_or_ppa":
      return "Lease/PPA possible";
    case "financing_likely":
      return "Financing likely";
    default:
      return "Purchase method undetermined";
  }
}

export function derivePurchaseProfile(
  input: PurchaseProfileInput,
): PurchaseProfileResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const missing: string[] = [];
  const gateEvidence = input.releaseGate.evidence;
  const financeReady =
    input.financeReadiness === true ||
    gateEvidence.qualification.finance_readiness ||
    gateEvidence.operator_review.financing_ready ||
    gateEvidence.homeowner_intake.financing_interest;
  const timeline =
    stringValue(input.timeline) ?? gateEvidence.homeowner_intake.timeline;
  const grade = normalizedText(
    input.leadGrade ?? gateEvidence.qualification.lead_grade,
  );
  const status = normalizedText(
    input.qualificationStatus ?? gateEvidence.qualification.status,
  );
  const homeownerStatus = normalizedText(input.homeownerStatus);
  const batteryInterest = normalizedText(input.batteryInterest);
  const contact = displayText(input.preferredContactMethod);

  if (financeReady)
    evidence.push({
      label: "Financing signal",
      value: "Financing interest/readiness present",
      source: "qualification",
    });
  else pushUnique(missing, "Financing preference not validated");

  if (timeline)
    evidence.push({
      label: "Timeline",
      value: displayText(timeline) ?? timeline,
      source: "homeowner",
    });
  else pushUnique(missing, "Homeowner timeline pending");

  if (grade || status)
    evidence.push({
      label: "Qualification",
      value:
        displayText(
          input.leadGrade ??
            input.qualificationStatus ??
            gateEvidence.qualification.lead_grade ??
            gateEvidence.qualification.status,
        ) ?? "Qualification present",
      source: "qualification",
    });
  else pushUnique(missing, "Qualification grade pending");

  if (homeownerStatus)
    evidence.push({
      label: "Ownership",
      value: displayText(input.homeownerStatus) ?? homeownerStatus,
      source: "homeowner",
    });
  if (batteryInterest)
    evidence.push({
      label: "Battery interest",
      value: displayText(input.batteryInterest) ?? batteryInterest,
      source: "homeowner",
    });
  if (contact)
    evidence.push({
      label: "Preferred contact",
      value: contact,
      source: "homeowner",
    });

  let likelyPurchaseMethod: PurchaseMethod = "undetermined";
  if (financeReady) likelyPurchaseMethod = "financing_likely";
  const explicitFinance = boolValue(input.financeReadiness);
  if (explicitFinance === true) likelyPurchaseMethod = "loan";

  const seriousness = timelineUrgency(timeline);
  const qualified = ["a", "a+", "qualified", "approved", "high_intent"].some(
    (token) => grade === token || status === token,
  );
  const homeownerSeriousness: HomeownerSeriousness =
    seriousness !== "unknown"
      ? seriousness
      : qualified
        ? "high"
        : gateEvidence.operator_review.contacted ||
            gateEvidence.operator_review.qualified
          ? "medium"
          : "unknown";
  const urgency: IntelligenceLevel =
    homeownerSeriousness === "urgent" || homeownerSeriousness === "high"
      ? "high"
      : homeownerSeriousness === "medium"
        ? "medium"
        : homeownerSeriousness === "early"
          ? "low"
          : "unknown";

  const readinessParts: string[] = [];
  if (qualified) readinessParts.push("qualified");
  if (financeReady) readinessParts.push("financing signal present");
  if (timeline)
    readinessParts.push(`${displayText(timeline) ?? timeline} timeline`);

  return {
    likely_purchase_method: likelyPurchaseMethod,
    purchase_method_label: purchaseLabel(likelyPurchaseMethod),
    homeowner_seriousness: homeownerSeriousness,
    seriousness_label:
      homeownerSeriousness === "unknown"
        ? "Homeowner seriousness awaiting validation"
        : `${homeownerSeriousness.charAt(0).toUpperCase()}${homeownerSeriousness.slice(1)} homeowner seriousness`,
    urgency,
    urgency_label:
      urgency === "unknown"
        ? "Urgency awaiting timeline validation"
        : `${capitalizeLabel(urgency)} urgency`,
    readiness_label: readinessParts.length
      ? `Readiness: ${readinessParts.join(" · ")}`
      : "Readiness awaiting qualification evidence",
    evidence,
    missing,
  };
}
