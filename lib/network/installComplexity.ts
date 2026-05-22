import {
  capitalizeLabel,
  boolValue,
  clampScore,
  displayText,
  normalizedText,
  numberValue,
  pushUnique,
  stringValue,
  type IntelligenceEvidenceNote,
  type IntelligenceLevel,
} from "@/lib/network/intelligenceUtils";

export interface InstallComplexityInput {
  roofMaterial?: string | null;
  roofPitch?: string | null;
  roofCondition?: string | null;
  roofAgeYears?: number | null;
  stories?: number | null;
  structureType?: string | null;
  usableRoofPct?: number | null;
  steepRoof?: boolean | null;
  complexAhj?: boolean | null;
  ahjName?: string | null;
  batteryCandidate?: boolean | null;
}

export interface InstallComplexityResult {
  level: IntelligenceLevel;
  label: string;
  score: number;
  profitability_signal: "favorable" | "standard" | "margin_watch" | "unknown";
  profitability_label: string;
  evidence: IntelligenceEvidenceNote[];
  risks: string[];
  missing: string[];
}

export function deriveInstallComplexity(
  input: InstallComplexityInput,
): InstallComplexityResult {
  const evidence: IntelligenceEvidenceNote[] = [];
  const risks: string[] = [];
  const missing: string[] = [];
  let score = 25;

  const roofMaterial = stringValue(input.roofMaterial);
  const roofPitch = stringValue(input.roofPitch);
  const roofCondition = normalizedText(input.roofCondition);
  const roofAge = numberValue(input.roofAgeYears);
  const stories = numberValue(input.stories);
  const usableRoofPct = numberValue(input.usableRoofPct);
  const steepRoof = boolValue(input.steepRoof);
  const complexAhj = boolValue(input.complexAhj);
  const battery = boolValue(input.batteryCandidate);

  if (roofMaterial)
    evidence.push({
      label: "Roof material",
      value: displayText(roofMaterial) ?? roofMaterial,
      source: "homeowner",
    });
  else pushUnique(missing, "Roof material pending");
  if (roofPitch)
    evidence.push({
      label: "Roof pitch",
      value: displayText(roofPitch) ?? roofPitch,
      source: "homeowner",
    });
  else pushUnique(missing, "Roof pitch pending");
  if (roofCondition)
    evidence.push({
      label: "Roof condition",
      value: displayText(input.roofCondition) ?? roofCondition,
      source: "homeowner",
    });
  else pushUnique(missing, "Roof condition pending");
  if (roofAge !== null)
    evidence.push({
      label: "Roof age",
      value: `${Math.round(roofAge)} years`,
      source: "homeowner",
    });
  if (stories !== null)
    evidence.push({
      label: "Stories",
      value: `${Math.round(stories)}`,
      source: "homeowner",
    });
  if (usableRoofPct !== null)
    evidence.push({
      label: "Usable roof",
      value: `${Math.round(usableRoofPct)}%`,
      source: "estimated",
    });
  if (input.ahjName)
    evidence.push({
      label: "AHJ",
      value: input.ahjName,
      source: "marketplace",
    });

  if (steepRoof === true) {
    score += 20;
    risks.push("Steep roof flag present");
  }
  if (complexAhj === true) {
    score += 18;
    risks.push("Complex AHJ flag present");
  }
  if (battery === true) {
    score += 8;
    risks.push("Battery attachment may add design/install scope");
  }
  if (roofAge !== null && roofAge >= 20) {
    score += 12;
    risks.push("Older roof may require closer review");
  }
  if (
    roofCondition &&
    ["poor", "fair", "needs_repair", "unknown"].some((token) =>
      roofCondition.includes(token),
    )
  ) {
    score += 12;
    risks.push("Roof condition may affect install readiness");
  }
  if (stories !== null && stories >= 2) {
    score += 6;
    risks.push("Multi-story structure may increase install complexity");
  }
  if (usableRoofPct !== null && usableRoofPct < 55) {
    score += 10;
    risks.push("Limited usable roof area");
  }

  const boundedScore = clampScore(score);
  const level: IntelligenceLevel =
    boundedScore >= 70
      ? "high"
      : boundedScore >= 45
        ? "medium"
        : boundedScore > 25
          ? "low"
          : missing.length >= 3
            ? "unknown"
            : "low";
  const profitabilitySignal =
    level === "high"
      ? "margin_watch"
      : level === "medium"
        ? "standard"
        : level === "low"
          ? "favorable"
          : "unknown";

  return {
    level,
    label:
      level === "unknown"
        ? "Install complexity awaiting site validation"
        : `${capitalizeLabel(level)} install complexity`,
    score: boundedScore,
    profitability_signal: profitabilitySignal,
    profitability_label:
      profitabilitySignal === "margin_watch"
        ? "Margin watch: complexity signals present"
        : profitabilitySignal === "favorable"
          ? "Install profile appears favorable from available signals"
          : profitabilitySignal === "standard"
            ? "Standard install review recommended"
            : "Profitability awaiting install evidence",
    evidence,
    risks,
    missing,
  };
}
