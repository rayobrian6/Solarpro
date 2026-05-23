import { createHash } from 'crypto';
import { createReviewRequiredCandidates } from './candidateNormalization';
import type { CandidateAdapterInput, CandidateAdapterResult, NormalizedCandidatePayload, RuntimeCandidateAdapter } from './candidateAdapterTypes';
import {
  GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION,
  GEOMETRY_CANDIDATE_LIMITATIONS,
  GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME,
  GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION,
} from './geometryCandidateTypes';
import type { GeometryCandidateExtractionInput, GeometryCandidateRuntimePayload, GeometryCandidateSignal } from './geometryCandidateTypes';

const OBSTRUCTION_TERMS = [
  'obstruction',
  'chimney',
  'skylight',
  'vent',
  'pipe',
  'satellite',
  'dish',
  'hvac',
  'roof jack',
] as const;

const FORBIDDEN_USES = [
  'canonical_geometry',
  'canonical_roof_plane',
  'cad_input',
  'cad_obstruction',
  'drafting_input',
  'layout_input',
  'panel_filter',
  'setback_authority',
  'engineering_fact',
  'nec_authority',
  'routing_authority',
  'conductor_sizing',
  'structural_authority',
  'production_estimate',
  'bom_input',
  'plan_set_input',
  'readiness_state',
  'workflow_trigger',
  'recommendation_trigger',
  'canonical_mutation',
] as const;

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(4))));
}

function sourceContextMatches(normalizedText: string): string[] {
  if (!normalizedText) return [];
  return OBSTRUCTION_TERMS.filter(term => normalizedText.includes(normalizeText(term)));
}

function createObstructionSignal(sourceImageByteHash: string, sourceContextTextHash: string, hits: string[]): GeometryCandidateSignal {
  const confidence = clampConfidence(0.33 + Math.min(hits.length, 3) * 0.07);
  return {
    signalId: `geometry_${stableHash({ label: 'possible_obstruction_candidate', sourceImageByteHash, sourceContextTextHash, hits, confidence }).slice(0, 16)}`,
    label: 'possible_obstruction_candidate',
    confidence,
    sourceImageLineageRef: sourceImageByteHash,
    reviewRegionDescriptor: 'coarse_source_image_context',
    evidenceBasis: hits.map(hit => `source_context_text:${hit}`).sort((a, b) => a.localeCompare(b)),
    limitationRefs: [...GEOMETRY_CANDIDATE_LIMITATIONS],
  };
}

export class GeometryCandidateRuntimeAdapter implements RuntimeCandidateAdapter<GeometryCandidateRuntimePayload> {
  adapterId = 'geometry-candidate-runtime-adapter-v1';
  adapterVersion = '1.0.0';
  toolName = GEOMETRY_CANDIDATE_RUNTIME_TOOL_NAME;
  toolVersion = GEOMETRY_CANDIDATE_RUNTIME_TOOL_VERSION;

  async extractRuntimePayload(input: Uint8Array | GeometryCandidateExtractionInput): Promise<GeometryCandidateRuntimePayload> {
    const imageBytes = input instanceof Uint8Array ? input : input.imageBytes;
    const sourceContextText = input instanceof Uint8Array ? null : input.sourceContextText;
    const normalizedText = normalizeText(sourceContextText);
    const sourceImageByteHash = createHash('sha256').update(imageBytes).digest('hex');
    const sourceContextTextHash = stableHash(normalizedText);
    const hits = sourceContextMatches(normalizedText);
    const derivedSignals = hits.length > 0 ? [createObstructionSignal(sourceImageByteHash, sourceContextTextHash, hits)] : [];
    const confidence = derivedSignals.length === 0 ? 0 : clampConfidence(Math.max(...derivedSignals.map(signal => signal.confidence)));
    const runtimePayloadHash = stableHash({
      inputByteLength: imageBytes.byteLength,
      sourceImageByteHash,
      sourceContextTextHash,
      boundaryPolicyVersion: GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION,
      derivedSignals,
      method: 'deterministic_source_context_obstruction_terms_and_byte_hash',
    });

    return {
      runtimePayloadHash,
      inputByteLength: imageBytes.byteLength,
      method: 'deterministic_source_context_obstruction_terms_and_byte_hash',
      boundaryPolicyVersion: GEOMETRY_CANDIDATE_BOUNDARY_POLICY_VERSION,
      sourceContextTextHash,
      sourceImageByteHash,
      confidence,
      derivedSignals,
      stalePropagation: {
        candidateOnly: true,
        allowedStaleClasses: ['candidate_source_stale', 'candidate_runtime_stale', 'candidate_policy_stale', 'candidate_review_stale'],
        forbiddenStaleClasses: ['canonical_geometry_stale', 'cad_output_stale', 'engineering_output_stale', 'route_output_stale', 'bom_output_stale', 'plan_set_output_stale'],
      },
    };
  }

  normalize(input: CandidateAdapterInput<GeometryCandidateRuntimePayload>): NormalizedCandidatePayload[] {
    return input.rawPayload.derivedSignals.map(signal => ({
      candidateType: 'possible_obstruction_candidate',
      candidateCategory: 'roof_context',
      candidateConfidence: signal.confidence,
      candidatePayload: {
        label: signal.label,
        runtimePayloadHash: input.rawPayload.runtimePayloadHash,
        method: input.rawPayload.method,
        boundaryPolicyVersion: input.rawPayload.boundaryPolicyVersion,
        sourceImageLineageRef: signal.sourceImageLineageRef,
        reviewRegionDescriptor: signal.reviewRegionDescriptor,
        evidenceBasis: [...signal.evidenceBasis],
        stalePropagation: input.rawPayload.stalePropagation,
        nonAuthoritative: true,
        reviewRequired: true,
        candidateOnly: true,
        projectionOnlyOnReview: true,
        forbiddenUses: [...FORBIDDEN_USES],
      },
      candidateSummary: 'Review-required possible obstruction candidate from source image context. Not CAD input, not canonical geometry, and not engineering authority.',
      candidateClaims: [
        {
          claimId: signal.signalId,
          field: 'possible_obstruction_candidate',
          value: 'source_image_review_context_only',
          confidence: signal.confidence,
          limitationRefs: [...signal.limitationRefs],
        },
      ],
      candidateLimitations: [...signal.limitationRefs],
      deterministicInputRefs: [
        input.rawPayload.runtimePayloadHash,
        input.rawPayload.sourceImageByteHash,
        input.rawPayload.sourceContextTextHash,
        input.rawPayload.boundaryPolicyVersion,
      ],
    }));
  }

  generateCandidates(input: CandidateAdapterInput<GeometryCandidateRuntimePayload>): CandidateAdapterResult {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  }
}

export const geometryCandidateRuntimeAdapter = new GeometryCandidateRuntimeAdapter();
