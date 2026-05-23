import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import { createReviewRequiredCandidates } from './candidateNormalization';
import { preserveLowestConfidence } from './candidateConfidenceRules';
import type { CandidateAdapterInput, NormalizedCandidatePayload, OcrFixturePayload } from './candidateAdapterTypes';
import type { OcrCandidateFixtureAdapter } from './candidateAdapterContracts';

const TOOL_NAME = 'fixture-ocr-text-adapter';
const TOOL_VERSION = '1.0.0';

export const ocrFixtureAdapter: OcrCandidateFixtureAdapter = {
  adapterId: 'ocr-fixture-adapter-v1',
  adapterVersion: '1.0.0',
  toolName: TOOL_NAME,
  toolVersion: TOOL_VERSION,
  normalize(input: CandidateAdapterInput<OcrFixturePayload>): NormalizedCandidatePayload[] {
    return [...input.rawPayload.signals]
      .sort((a, b) => a.signalId.localeCompare(b.signalId))
      .map(signal => ({
        candidateType: 'text_region_candidate',
        candidateCategory: signal.field === 'possible_equipment_label_text' ? 'electrical_context' : 'field_context',
        candidateConfidence: preserveLowestConfidence([signal.confidence]),
        candidatePayload: {
          fixtureId: input.rawPayload.fixtureId,
          field: signal.field,
          possibleText: signal.text,
          textRegionCount: input.rawPayload.textRegionCount,
          fixtureOnly: true,
        },
        candidateSummary: `Fixture OCR-like text candidate for ${signal.field}; not extracted by runtime OCR.`,
        candidateClaims: [{
          claimId: signal.signalId,
          field: signal.field,
          value: signal.text,
          confidence: signal.confidence,
          limitationRefs: signal.limitationRefs,
        }],
        candidateLimitations: [...signal.limitationRefs, 'no-ocr-runtime', 'text-fixture-only', 'review-required'],
        deterministicInputRefs: ['fixtureId', 'signalId', 'sourceContext', 'registryMetadata'],
      }));
  },
  generateCandidates(input: CandidateAdapterInput<OcrFixturePayload>) {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  },
};

export function generateOcrFixtureCandidates(sourceContext: CandidateAdapterInput<OcrFixturePayload>['sourceContext'], rawPayload: OcrFixturePayload) {
  const tool = getRegisteredOpenSourceTool(TOOL_NAME, TOOL_VERSION);
  return ocrFixtureAdapter.generateCandidates({ tool, sourceContext, rawPayload });
}
