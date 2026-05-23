import { createCandidate, deterministicHash, markReviewRequired } from '@/lib/assistedEvidence';
import type { AssistedEvidenceCandidate, CreateAssistedEvidenceCandidateInput } from '@/lib/assistedEvidence';
import { assertToolCanEmitCandidateType } from './openSourceToolRegistry';
import { normalizeCandidateConfidence } from './candidateConfidenceRules';
import type { AssistedEvidenceSourceContext, CandidateAdapterResult, NormalizedCandidatePayload } from './candidateAdapterTypes';
import type { ValidatedOpenSourceToolDefinition } from './openSourceToolTypes';

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function runtimeProvenanceNote(tool: ValidatedOpenSourceToolDefinition): string {
  if (tool.runtimeCategory === 'fixture_only') return 'Fixture-only adapter output; no runtime OCR/CV/image processing executed.';
  if (tool.runtimeCategory === 'ocr_text_candidate') return 'Controlled OCR runtime pilot output; text extraction only, no semantic image understanding or engineering inference executed.';
  if (tool.runtimeCategory === 'visual_categorization_candidate') return 'Controlled visual categorization runtime pilot output; possible photo-category candidates only, no object detection, geometry extraction, engineering inference, CAD influence, workflow influence, or canonical mutation executed.';
  return 'Controlled metadata runtime pilot output; no OCR/CV/semantic image understanding executed.';
}

export function normalizeCandidatePayload(payload: NormalizedCandidatePayload): NormalizedCandidatePayload {
  return {
    ...payload,
    candidateConfidence: normalizeCandidateConfidence(payload.candidateConfidence),
    candidateClaims: [...payload.candidateClaims]
      .map(claim => ({ ...claim, confidence: normalizeCandidateConfidence(claim.confidence), limitationRefs: sortedUnique(claim.limitationRefs) }))
      .sort((a, b) => a.claimId.localeCompare(b.claimId)),
    candidateLimitations: sortedUnique(payload.candidateLimitations),
    deterministicInputRefs: sortedUnique(payload.deterministicInputRefs),
  };
}

export function toCreateCandidateInput(
  tool: ValidatedOpenSourceToolDefinition,
  sourceContext: AssistedEvidenceSourceContext,
  payload: NormalizedCandidatePayload,
): CreateAssistedEvidenceCandidateInput {
  assertToolCanEmitCandidateType(tool, payload.candidateType);
  const normalized = normalizeCandidatePayload(payload);
  const registryHash = deterministicHash({
    toolName: tool.toolName,
    toolVersion: tool.toolVersion,
    license: tool.license,
    runtimeCategory: tool.runtimeCategory,
    allowedRuntimeBoundary: tool.allowedRuntimeBoundary,
  });

  return {
    sourceFileId: sourceContext.sourceFileId,
    sourceUploadKey: sourceContext.sourceUploadKey,
    projectId: sourceContext.projectId,
    surveyId: sourceContext.surveyId,
    candidateType: normalized.candidateType,
    candidateCategory: normalized.candidateCategory,
    candidateConfidence: normalized.candidateConfidence,
    toolName: tool.toolName,
    toolVersion: tool.toolVersion,
    toolRunId: sourceContext.toolRunId,
    toolConfigHash: sourceContext.toolConfigHash,
    sourceMetadataHash: sourceContext.sourceMetadataHash,
    candidatePayload: {
      ...normalized.candidatePayload,
      registryHash,
      runtimeCategory: tool.runtimeCategory,
      allowedRuntimeBoundary: tool.allowedRuntimeBoundary,
      fixtureOnly: tool.runtimeCategory === 'fixture_only',
    },
    candidateSummary: normalized.candidateSummary,
    candidateClaims: normalized.candidateClaims,
    candidateLimitations: sortedUnique([
      ...normalized.candidateLimitations,
      tool.runtimeCategory === 'fixture_only' ? 'fixture-only' : 'runtime-pilot',
      'non-authoritative',
      'review-required',
    ]),
    createdAt: sourceContext.createdAt,
    provenance: {
      source: 'future_assisted_tool_placeholder',
      createdBy: sourceContext.createdBy,
      deterministicInputs: sortedUnique([
        'registered-open-source-tool',
        tool.runtimeCategory === 'fixture_only' ? 'fixture-payload' : 'runtime-payload',
        'source-context',
        ...normalized.deterministicInputRefs,
      ]),
      notes: sortedUnique([
        runtimeProvenanceNote(tool),
        `Registered source tool ${tool.toolName}@${tool.toolVersion}.`,
        `License posture ${tool.licensePosture}.`,
      ]),
    },
  };
}

export function createReviewRequiredCandidates(
  tool: ValidatedOpenSourceToolDefinition,
  sourceContext: AssistedEvidenceSourceContext,
  normalizedCandidates: NormalizedCandidatePayload[],
): CandidateAdapterResult {
  const candidateInputs = normalizedCandidates
    .map(payload => toCreateCandidateInput(tool, sourceContext, payload))
    .sort((a, b) => `${a.candidateType}:${a.candidateSummary}`.localeCompare(`${b.candidateType}:${b.candidateSummary}`));
  const candidates: AssistedEvidenceCandidate[] = candidateInputs.map(input => markReviewRequired(createCandidate(input)));
  return { normalizedCandidates: normalizedCandidates.map(normalizeCandidatePayload), candidateInputs, candidates };
}
