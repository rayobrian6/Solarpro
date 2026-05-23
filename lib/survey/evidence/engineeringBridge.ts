import {
  getSurveyEvidenceCategoryDefinition,
  getSurveyEvidenceLabel,
} from './categoryRegistry';
import type { SurveyEvidenceManifest, SurveyEvidenceItem } from './manifest';
import {
  buildEngineeringRequirementEvaluation,
  type EngineeringRequirementEvaluationSummary,
} from './engineeringRequirements';
import {
  buildSurveyEvidenceTraceability,
  type RequirementEvidenceTraceabilityRecord,
  type SurveyEvidenceTraceabilityBundle,
} from './provenance';

export interface SurveyEvidenceEngineeringBridge {
  readiness: 'blocked' | 'needs_review' | 'ready_for_engineering';
  electricalEvidence: string[];
  structuralEvidence: string[];
  roofLayoutEvidence: string[];
  sitePlanEvidence: string[];
  requirementTraceability: RequirementEvidenceTraceabilityRecord[];
  missingRequirementTraceability: RequirementEvidenceTraceabilityRecord[];
  requirementEvaluation: EngineeringRequirementEvaluationSummary;
  permitWarnings: string[];
  cadAutomationStatus: 'not_started';
}

export interface SurveyEvidenceEngineeringBridgeCounts {
  electricalEvidenceCount: number;
  structuralEvidenceCount: number;
  roofLayoutEvidenceCount: number;
  sitePlanEvidenceCount: number;
}

export function buildSurveyEvidenceEngineeringBridge(
  manifest: SurveyEvidenceManifest | null | undefined,
  traceabilityOverride?: SurveyEvidenceTraceabilityBundle | null,
): SurveyEvidenceEngineeringBridge {
  const traceability = traceabilityOverride ?? buildSurveyEvidenceTraceability({
    canonicalManifest: manifest,
    evidenceTruthSource: 'canonical_manifest_v1',
  });
  const requirementEvaluation = buildEngineeringRequirementEvaluation({
    canonicalManifest: manifest,
    traceability,
  });

  if (!manifest || manifest.summary.totalItems === 0) {
    return {
      readiness: requirementEvaluation.readiness,
      electricalEvidence: [],
      structuralEvidence: [],
      roofLayoutEvidence: [],
      sitePlanEvidence: [],
      requirementTraceability: traceability.requirements,
      missingRequirementTraceability: traceability.missingRequirements,
      requirementEvaluation,
      permitWarnings: ['No structured survey photo evidence manifest is available.'],
      cadAutomationStatus: 'not_started',
    };
  }

  const electricalEvidence: string[] = [];
  const structuralEvidence: string[] = [];
  const roofLayoutEvidence: string[] = [];
  const sitePlanEvidence: string[] = [];

  for (const item of manifest.items) {
    const message = evidenceMessage(item);
    const bucket = getSurveyEvidenceCategoryDefinition(item.category).engineeringBucket;
    if (bucket === 'electricalEvidence') electricalEvidence.push(message);
    if (bucket === 'structuralEvidence') structuralEvidence.push(message);
    if (bucket === 'roofLayoutEvidence') roofLayoutEvidence.push(message);
    if (bucket === 'sitePlanEvidence') sitePlanEvidence.push(message);
  }

  return {
    readiness: requirementEvaluation.readiness,
    electricalEvidence,
    structuralEvidence,
    roofLayoutEvidence,
    sitePlanEvidence,
    requirementTraceability: traceability.requirements,
    missingRequirementTraceability: traceability.missingRequirements,
    requirementEvaluation,
    permitWarnings: registryPermitWarnings(requirementEvaluation, manifest.warnings),
    cadAutomationStatus: 'not_started',
  };
}

export function summarizeSurveyEvidenceEngineeringBridge(
  bridge: SurveyEvidenceEngineeringBridge,
): SurveyEvidenceEngineeringBridgeCounts {
  return {
    electricalEvidenceCount: bridge.electricalEvidence.length,
    structuralEvidenceCount: bridge.structuralEvidence.length,
    roofLayoutEvidenceCount: bridge.roofLayoutEvidence.length,
    sitePlanEvidenceCount: bridge.sitePlanEvidence.length,
  };
}

function evidenceMessage(item: SurveyEvidenceItem): string {
  const label = getSurveyEvidenceLabel(item.category);
  const source = item.evidenceSource === 'site_survey_files'
    ? 'persisted survey file'
    : item.evidenceSource === 'survey_payload'
      ? 'survey payload gap-recovery item'
      : item.evidenceSource;
  return `${label} photo evidence available from ${source} for ${item.domain} review traceability.`;
}

function registryPermitWarnings(
  evaluation: EngineeringRequirementEvaluationSummary,
  manifestWarnings: string[],
): string[] {
  const registryWarnings = [
    ...evaluation.blockedRequirements.map(requirement => `Blocked engineering requirement: ${requirement.humanLabel} (${requirement.status}).`),
    ...evaluation.missingRequirements
      .filter(requirement => requirement.missingSeverity === 'warning')
      .map(requirement => `Missing review requirement: ${requirement.humanLabel}.`),
    ...evaluation.partiallySatisfiedRequirements.map(requirement => `Partial requirement satisfaction: ${requirement.humanLabel} (${requirement.status}).`),
  ];
  return [...manifestWarnings, ...registryWarnings];
}
