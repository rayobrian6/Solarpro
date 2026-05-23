import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import { createReviewRequiredCandidates } from './candidateNormalization';
import { preserveLowestConfidence } from './candidateConfidenceRules';
import type { CandidateAdapterInput, MetadataFixturePayload, NormalizedCandidatePayload } from './candidateAdapterTypes';
import type { MetadataCandidateFixtureAdapter } from './candidateAdapterContracts';

const TOOL_NAME = 'fixture-image-metadata-adapter';
const TOOL_VERSION = '1.0.0';

function typeForField(field: string) {
  if (field === 'possible_image_orientation') return { candidateType: 'orientation_candidate' as const, candidateCategory: 'orientation' as const };
  if (field === 'possible_duplicate_photo') return { candidateType: 'duplicate_similarity_candidate' as const, candidateCategory: 'duplicate_hygiene' as const };
  return { candidateType: 'photo_quality_candidate' as const, candidateCategory: 'quality' as const };
}

export const metadataFixtureAdapter: MetadataCandidateFixtureAdapter = {
  adapterId: 'metadata-fixture-adapter-v1',
  adapterVersion: '1.0.0',
  toolName: TOOL_NAME,
  toolVersion: TOOL_VERSION,
  normalize(input: CandidateAdapterInput<MetadataFixturePayload>): NormalizedCandidatePayload[] {
    return [...input.rawPayload.signals]
      .sort((a, b) => a.signalId.localeCompare(b.signalId))
      .map(signal => {
        const typed = typeForField(signal.field);
        return {
          ...typed,
          candidateConfidence: preserveLowestConfidence([signal.confidence]),
          candidatePayload: {
            fixtureId: input.rawPayload.fixtureId,
            field: signal.field,
            value: signal.value,
            imageWidth: input.rawPayload.imageWidth,
            imageHeight: input.rawPayload.imageHeight,
            orientationHint: input.rawPayload.orientationHint,
            duplicateGroupHint: input.rawPayload.duplicateGroupHint,
          },
          candidateSummary: `Fixture metadata candidate for ${signal.field}.`,
          candidateClaims: [{
            claimId: signal.signalId,
            field: signal.field,
            value: signal.value,
            confidence: signal.confidence,
            limitationRefs: signal.limitationRefs,
          }],
          candidateLimitations: [...signal.limitationRefs, 'no-image-bytes-inspected', 'metadata-fixture-only'],
          deterministicInputRefs: ['fixtureId', 'signalId', 'sourceContext', 'registryMetadata'],
        };
      });
  },
  generateCandidates(input: CandidateAdapterInput<MetadataFixturePayload>) {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  },
};

export function generateMetadataFixtureCandidates(sourceContext: CandidateAdapterInput<MetadataFixturePayload>['sourceContext'], rawPayload: MetadataFixturePayload) {
  const tool = getRegisteredOpenSourceTool(TOOL_NAME, TOOL_VERSION);
  return metadataFixtureAdapter.generateCandidates({ tool, sourceContext, rawPayload });
}
