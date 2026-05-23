import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import type { AssistedEvidenceSourceContext, CandidateAdapterResult } from './candidateAdapterTypes';
import { assertToolCanEmitCandidateType, getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import { geometryCandidateRuntimeAdapter } from './geometryCandidateRuntimeAdapter';
import { GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME, GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION } from './geometryCandidateTypes';

export interface GeometryCandidateRuntimeBridgeInput {
  imageBytes: Uint8Array;
  sourceContext: AssistedEvidenceSourceContext;
  sourceContextText?: string | null;
}

export interface GeometryCandidateRuntimeBridgeResult extends CandidateAdapterResult {
  candidates: AssistedEvidenceCandidate[];
}

export async function createGeometryCandidateCandidates(input: GeometryCandidateRuntimeBridgeInput): Promise<GeometryCandidateRuntimeBridgeResult> {
  const tool = getRegisteredOpenSourceTool(GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME, GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION);
  assertToolCanEmitCandidateType(tool, 'possible_obstruction_candidate');

  const rawPayload = await geometryCandidateRuntimeAdapter.extractRuntimePayload({
    imageBytes: input.imageBytes,
    sourceContextText: input.sourceContextText,
  });

  return geometryCandidateRuntimeAdapter.generateCandidates({
    tool,
    sourceContext: input.sourceContext,
    rawPayload,
  });
}


const GEOMETRY_CANDIDATE_DEMO_IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

export interface GeometryCandidateDemoRuntimeBridgeInput {
  sourceContext: AssistedEvidenceSourceContext;
  sourceContextText?: string | null;
}

export async function createGeometryCandidateDemoCandidates(input: GeometryCandidateDemoRuntimeBridgeInput): Promise<GeometryCandidateRuntimeBridgeResult> {
  return createGeometryCandidateCandidates({
    imageBytes: GEOMETRY_CANDIDATE_DEMO_IMAGE_BYTES,
    sourceContext: input.sourceContext,
    sourceContextText: input.sourceContextText,
  });
}
