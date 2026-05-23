import type { AssistedEvidenceCandidate } from '@/lib/assistedEvidence';
import type { AssistedEvidenceSourceContext, CandidateAdapterResult } from './candidateAdapterTypes';
import { assertToolCanEmitCandidateType, getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import { visualCategorizationRuntimeAdapter } from './visualCategorizationRuntimeAdapter';
import { VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION } from './visualCategorizationRuntimeTypes';

export interface VisualCategorizationRuntimeBridgeInput {
  imageBytes: Uint8Array;
  sourceContext: AssistedEvidenceSourceContext;
  sourceContextText?: string | null;
}

export interface VisualCategorizationRuntimeBridgeResult extends CandidateAdapterResult {
  candidates: AssistedEvidenceCandidate[];
}

export async function createVisualCategorizationCandidates(input: VisualCategorizationRuntimeBridgeInput): Promise<VisualCategorizationRuntimeBridgeResult> {
  const tool = getRegisteredOpenSourceTool(VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION);
  assertToolCanEmitCandidateType(tool, 'visual_category_candidate');

  const rawPayload = await visualCategorizationRuntimeAdapter.extractRuntimePayload({
    imageBytes: input.imageBytes,
    sourceContextText: input.sourceContextText,
  });

  return visualCategorizationRuntimeAdapter.generateCandidates({
    tool,
    sourceContext: input.sourceContext,
    rawPayload,
  });
}
