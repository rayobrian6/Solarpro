import type { MarketplaceReleaseGateResult } from "@/lib/network/marketplaceReleaseGate";
import {
  capitalizeLabel,
  clampScore,
  displayText,
  normalizedText,
  numberValue,
  pushUnique,
  stringValue,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
} from "@/lib/network/intelligenceUtils";

export interface FinancingIntelligenceInput {
  releaseGate: MarketplaceReleaseGateResult;
  financeReadiness?: boolean | null;
  estimatedIncomeBand?: string | null;
  estimatedCreditBand?: string | null;
  monthlyBillAmount?: number | null;
  estimatedProjectValue?: number | null;
  purchaseIntent?: string | null;
  qualificationStatus?: string | null;
  leadGrade?: string | null;
}

export interface FinancingIntelligenceResult {
  likelihood: IntelligenceLevel;
  likelihood_label: string;
  score: number;
  payment_readiness_label: string;
  evidence: IntelligenceEvidenceNote[];
  missing: string[];
  disclaimers: string[];
}

export function deriveFinancingIntelligence(
  input: FinancingIntelligenceInput,
): FinancingIntelligenceResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const missing: string[] = [];
  const disclaimers = [
    "Financing result is a deterministic readiness signal, not a credit approval or loan quote.",
  ];
  const gateEvidence = input.releaseGate.evidence;
  const purchaseIntent = normalizedText(
    input.purchaseIntent ?? gateEvidence.qualification.purchase_intent,
  );
  const ppaOrLeasePreference =
    purchaseIntent === "ppa_or_lease" || purchaseIntent === "ppa" || purchaseIntent === "lease";
  const financeReady =
    !ppaOrLeasePreference &&
    (input.financeReadiness === true ||
      gateEvidence.qualification.finance_readiness ||
      gateEvidence.operator_review.financing_ready ||
      gateEvidence.homeowner_intake.financing_interest);
  const incomeBand = stringValue(input.estimatedIncomeBand);
  const creditBand = stringValue(input.estimatedCreditBand);
  const monthlyBill = numberValue(
    input.monthlyBillAmount ??
      gateEvidence.homeowner_intake.monthly_bill_amount,
  );
  const projectValue = numberValue(input.estimatedProjectValue);
  const qualification = normalizedText(
    input.qualificationStatus ?? gateEvidence.qualification.status,
  );
  const grade = normalizedText(
    input.leadGrade ?? gateEvidence.qualification.lead_grade,
  );

  if (ppaOrLeasePreference) {
    return {
      likelihood: "medium",
      likelihood_label: "PPA/lease preference selected",
      score: 55,
      payment_readiness_label: "Third-party ownership path selected",
      evidence: [
        {
          label: "System ownership preference",
          value: displayText(purchaseIntent) ?? purchaseIntent ?? "PPA/lease",
          source: "qualification",
        },
      ],
      missing,
      disclaimers,
    };
  }

  let score = 25;
  if (financeReady) {
    score += 30;
    evidence.push({
      label: "Financing readiness",
      value: "Interest/readiness present",
      source: "qualification",
    });
  } else {
    pushUnique(missing, "Financing interest not confirmed");
  }

  if (creditBand) {
    evidence.push({
      label: "Credit band",
      value: displayText(creditBand) ?? creditBand,
      source: "qualification",
    });
    if (
      ["excellent", "good", "prime", "high"].some((token) =>
        normalizedText(creditBand)?.includes(token),
      )
    )
      score += 18;
    else if (
      ["fair", "average"].some((token) =>
        normalizedText(creditBand)?.includes(token),
      )
    )
      score += 8;
  } else pushUnique(missing, "Credit band unavailable");

  if (incomeBand) {
    evidence.push({
      label: "Income band",
      value: displayText(incomeBand) ?? incomeBand,
      source: "qualification",
    });
    score += 8;
  } else pushUnique(missing, "Income band unavailable");

  if (monthlyBill) {
    evidence.push({
      label: "Monthly bill",
      value: `$${Math.round(monthlyBill).toLocaleString("en-US")}`,
      source: "homeowner_entered",
    });
    if (monthlyBill >= 200) score += 8;
  }

  if (projectValue)
    evidence.push({
      label: "Project value",
      value: `$${Math.round(projectValue).toLocaleString("en-US")}`,
      source: "estimated",
    });
  if (
    ["qualified", "approved", "high_intent"].some(
      (token) =>
        qualification === token ||
        grade === token ||
        grade === "a" ||
        grade === "a+",
    )
  )
    score += 10;

  const boundedScore = clampScore(score);
  const likelihood: IntelligenceLevel =
    boundedScore >= 75
      ? "high"
      : boundedScore >= 50
        ? "medium"
        : boundedScore >= 35
          ? "low"
          : "unknown";

  return {
    likelihood,
    likelihood_label:
      likelihood === "unknown"
        ? "Financing likelihood awaiting validation"
        : `${capitalizeLabel(likelihood)} financing likelihood`,
    score: boundedScore,
    payment_readiness_label: financeReady
      ? "Payment path signal present"
      : "Payment path not yet validated",
    evidence,
    missing,
    disclaimers,
  };
}
