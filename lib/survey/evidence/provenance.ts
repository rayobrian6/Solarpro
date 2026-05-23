import type { SurveyEvidenceCategory, SurveyEvidenceItem, SurveyEvidenceManifest } from './manifest';
import {
  REQUIRED_SURVEY_EVIDENCE_CATEGORIES,
  getSurveyEvidenceCategoryDefinition,
  getSurveyEvidenceLabel,
} from './manifest';
import type { EvidenceDuplicateGroup, SurveySessionSummary } from './sessionGrouping';

export type EvidenceTruthSource = 'canonical_manifest_v1' | 'legacy_raw_photos_fallback';
export type RequirementConfidenceSource = 'canonical_manifest_summary' | 'canonical_evidence_confidence' | 'missing_requirement';

export interface EvidenceMetadataCompleteness {
  hasFileUrl: boolean;
  hasFilename: boolean;
  hasMimeType: boolean;
  hasCaptureTimestamp: boolean;
  hasSubmittedCategory: boolean;
  hasSiteSurveyFileId: boolean;
  hasSurveyTechnician: boolean;
}

export interface CanonicalEvidenceProvenanceRecord {
  canonicalEvidenceId: string;
  originatingSurveyId: string;
  originatingSurveyCreatedAt: string | null;
  evidenceCategory: SurveyEvidenceCategory;
  evidenceCategoryLabel: string;
  duplicateGroupSize: number;
  selectionReason: string;
  evidenceTruthSource: EvidenceTruthSource;
  requirementSatisfied: boolean;
  requirementConfidenceSource: RequirementConfidenceSource;
  metadataCompleteness: EvidenceMetadataCompleteness;
  evidenceSource: SurveyEvidenceItem['evidenceSource'];
  evidenceConfidence: SurveyEvidenceItem['evidenceConfidence'];
  fileUrl: string;
  filename: string | null;
  sceneGroup: string | null;
}

export interface RequirementEvidenceTraceabilityRecord {
  requirementCategory: SurveyEvidenceCategory;
  requirementLabel: string;
  requirementDomain: ReturnType<typeof getSurveyEvidenceCategoryDefinition>['domain'];
  engineeringBucket: ReturnType<typeof getSurveyEvidenceCategoryDefinition>['engineeringBucket'];
  requirementSatisfied: boolean;
  canonicalEvidenceId: string | null;
  originatingSurveyId: string | null;
  originatingSurveyCreatedAt: string | null;
  evidenceCategory: SurveyEvidenceCategory;
  duplicateGroupSize: number;
  selectionReason: string;
  evidenceTruthSource: EvidenceTruthSource;
  requirementConfidenceSource: RequirementConfidenceSource;
  metadataCompleteness: EvidenceMetadataCompleteness | null;
  deterministicReasoningPath: string[];
}

export interface SurveyLineageTraceRecord {
  surveyId: string;
  submittedAt: string | null;
  technician: string | null;
  duplicateStatus: string;
  rawPhotoCount: number;
  canonicalEvidenceCount: number;
  categoryCoverage: SurveyEvidenceCategory[];
  isCanonical: boolean;
}

export interface SurveyEvidenceTraceabilityBundle {
  evidenceTruthSource: EvidenceTruthSource;
  requirements: RequirementEvidenceTraceabilityRecord[];
  canonicalEvidence: CanonicalEvidenceProvenanceRecord[];
  surveyLineage: SurveyLineageTraceRecord[];
  missingRequirements: RequirementEvidenceTraceabilityRecord[];
}

export interface BuildSurveyEvidenceTraceabilityInput {
  canonicalManifest: SurveyEvidenceManifest | null | undefined;
  evidenceTruthSource?: EvidenceTruthSource;
  evidenceDuplicateGroups?: EvidenceDuplicateGroup[];
  sessions?: SurveySessionSummary[];
}

export function buildSurveyEvidenceTraceability(
  input: BuildSurveyEvidenceTraceabilityInput,
): SurveyEvidenceTraceabilityBundle {
  const evidenceTruthSource = input.evidenceTruthSource ?? 'canonical_manifest_v1';
  const manifest = input.canonicalManifest ?? null;
  const items = [...(manifest?.items ?? [])].sort(compareEvidenceDeterministically);
  const duplicateGroups = input.evidenceDuplicateGroups ?? [];
  const sessions = input.sessions ?? [];

  const canonicalEvidence = items.map(item => buildCanonicalEvidenceProvenance({
    item,
    evidenceTruthSource,
    duplicateGroups,
    sessions,
  }));

  const canonicalByCategory = new Map<SurveyEvidenceCategory, CanonicalEvidenceProvenanceRecord>();
  for (const record of canonicalEvidence) {
    if (!canonicalByCategory.has(record.evidenceCategory)) canonicalByCategory.set(record.evidenceCategory, record);
  }

  const requirements = REQUIRED_SURVEY_EVIDENCE_CATEGORIES.map(requirementCategory => {
    const definition = getSurveyEvidenceCategoryDefinition(requirementCategory);
    const record = canonicalByCategory.get(requirementCategory) ?? null;
    if (record) {
      return {
        requirementCategory,
        requirementLabel: definition.label,
        requirementDomain: definition.domain,
        engineeringBucket: definition.engineeringBucket,
        requirementSatisfied: true,
        canonicalEvidenceId: record.canonicalEvidenceId,
        originatingSurveyId: record.originatingSurveyId,
        originatingSurveyCreatedAt: record.originatingSurveyCreatedAt,
        evidenceCategory: record.evidenceCategory,
        duplicateGroupSize: record.duplicateGroupSize,
        selectionReason: record.selectionReason,
        evidenceTruthSource,
        requirementConfidenceSource: record.requirementConfidenceSource,
        metadataCompleteness: record.metadataCompleteness,
        deterministicReasoningPath: [
          `Requirement ${definition.label} maps to canonical category ${requirementCategory}.`,
          `canonicalManifest contains canonical evidence ${record.canonicalEvidenceId} in category ${record.evidenceCategory}.`,
          `Representative originated from survey ${record.originatingSurveyId}${record.originatingSurveyCreatedAt ? ` submitted ${record.originatingSurveyCreatedAt}` : ''}.`,
          record.duplicateGroupSize > 1
            ? `Duplicate hygiene collapsed ${record.duplicateGroupSize} metadata-matched raw upload(s) into this canonical representative.`
            : 'No duplicate group was required for this canonical evidence item.',
          `Selection reason: ${record.selectionReason}`,
          `Confidence provenance: ${record.requirementConfidenceSource}; no CV/OCR/CAD/image-byte inference is used.`,
        ],
      } satisfies RequirementEvidenceTraceabilityRecord;
    }

    return {
      requirementCategory,
      requirementLabel: definition.label,
      requirementDomain: definition.domain,
      engineeringBucket: definition.engineeringBucket,
      requirementSatisfied: false,
      canonicalEvidenceId: null,
      originatingSurveyId: null,
      originatingSurveyCreatedAt: null,
      evidenceCategory: requirementCategory,
      duplicateGroupSize: 0,
      selectionReason: 'canonicalManifest requiredMissing includes this category or no canonical representative exists',
      evidenceTruthSource,
      requirementConfidenceSource: 'missing_requirement',
      metadataCompleteness: null,
      deterministicReasoningPath: [
        `Requirement ${definition.label} maps to canonical category ${requirementCategory}.`,
        'canonicalManifest has no canonical evidence item in this category.',
        'Requirement remains missing deterministically; raw upload history is not counted as satisfaction.',
        'Confidence provenance: missing_requirement; no fake confidence is generated.',
      ],
    } satisfies RequirementEvidenceTraceabilityRecord;
  });

  const surveyLineage = sessions.map(session => ({
    surveyId: session.surveyId,
    submittedAt: session.submittedAt,
    technician: session.technician,
    duplicateStatus: session.surveySessionDuplicateStatus,
    rawPhotoCount: session.rawPhotoCount,
    canonicalEvidenceCount: session.canonicalEvidenceCount,
    categoryCoverage: session.categoryCoverage,
    isCanonical: session.isCanonical,
  } satisfies SurveyLineageTraceRecord));

  return {
    evidenceTruthSource,
    requirements,
    canonicalEvidence,
    surveyLineage,
    missingRequirements: requirements.filter(requirement => !requirement.requirementSatisfied),
  };
}

function buildCanonicalEvidenceProvenance(input: {
  item: SurveyEvidenceItem;
  evidenceTruthSource: EvidenceTruthSource;
  duplicateGroups: EvidenceDuplicateGroup[];
  sessions: SurveySessionSummary[];
}): CanonicalEvidenceProvenanceRecord {
  const { item, evidenceTruthSource, duplicateGroups, sessions } = input;
  const group = duplicateGroups.find(candidate => candidate.canonicalEvidenceId === item.evidenceId || candidate.evidenceIds.includes(item.evidenceId));
  const originatingSurvey = sessions.find(session => session.surveyId === item.surveyId) ?? null;
  const metadataCompleteness = metadataCompletenessFor(item);

  return {
    canonicalEvidenceId: item.evidenceId,
    originatingSurveyId: item.surveyId,
    originatingSurveyCreatedAt: originatingSurvey?.submittedAt ?? item.captureTimestamp ?? null,
    evidenceCategory: item.category,
    evidenceCategoryLabel: getSurveyEvidenceLabel(item.category),
    duplicateGroupSize: group?.rawUploadCount ?? 1,
    selectionReason: selectionReasonFor(item, group),
    evidenceTruthSource,
    requirementSatisfied: REQUIRED_SURVEY_EVIDENCE_CATEGORIES.includes(item.category),
    requirementConfidenceSource: item.evidenceConfidence === 'unknown'
      ? 'canonical_manifest_summary'
      : 'canonical_evidence_confidence',
    metadataCompleteness,
    evidenceSource: item.evidenceSource,
    evidenceConfidence: item.evidenceConfidence,
    fileUrl: item.fileUrl,
    filename: item.filename,
    sceneGroup: item.sceneGroup,
  };
}

function selectionReasonFor(item: SurveyEvidenceItem, group: EvidenceDuplicateGroup | undefined): string {
  const reasons: string[] = [];
  if (group) {
    reasons.push(`duplicate collapse representative from group ${group.evidenceDuplicateGroupId}`);
    reasons.push(`${group.rawUploadCount} metadata-matched raw upload(s)`);
  } else {
    reasons.push('unique canonical evidence item');
  }
  if (item.category !== 'uncategorized') reasons.push('categorized evidence outranks uncategorized evidence');
  if (item.siteSurveyFileId) reasons.push('site_survey_files record present');
  if (item.filename) reasons.push('filename metadata present');
  if (item.mimeType) reasons.push('MIME type metadata present');
  if (item.captureTimestamp) reasons.push('capture/submission timestamp available; newest timestamp wins after metadata score ties');
  reasons.push('deterministic tie-break order uses stable evidence id after score/timestamp comparison');
  return reasons.join('; ');
}

function metadataCompletenessFor(item: SurveyEvidenceItem): EvidenceMetadataCompleteness {
  return {
    hasFileUrl: Boolean(item.fileUrl),
    hasFilename: Boolean(item.filename),
    hasMimeType: Boolean(item.mimeType),
    hasCaptureTimestamp: Boolean(item.captureTimestamp),
    hasSubmittedCategory: Boolean(item.submittedCategory),
    hasSiteSurveyFileId: Boolean(item.siteSurveyFileId),
    hasSurveyTechnician: Boolean(item.surveyTechnician),
  };
}

function compareEvidenceDeterministically(a: SurveyEvidenceItem, b: SurveyEvidenceItem): number {
  const category = a.category.localeCompare(b.category);
  if (category !== 0) return category;
  const aTime = timestamp(a.captureTimestamp);
  const bTime = timestamp(b.captureTimestamp);
  if (aTime !== bTime) return bTime - aTime;
  return a.evidenceId.localeCompare(b.evidenceId);
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
