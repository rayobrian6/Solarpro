import type { AssistedEvidenceCandidate, AssistedEvidenceCandidateCategory, AssistedEvidenceCandidateClaim, AssistedEvidenceCandidateType, CreateAssistedEvidenceCandidateInput } from '@/lib/assistedEvidence';
import type { ValidatedOpenSourceToolDefinition } from './openSourceToolTypes';

export interface AssistedEvidenceSourceContext {
  sourceFileId: string;
  sourceUploadKey: string;
  projectId: string;
  surveyId: string;
  toolRunId: string;
  toolConfigHash: string;
  sourceMetadataHash: string;
  createdAt: string;
  createdBy: string;
}

export interface NormalizedCandidatePayload {
  candidateType: AssistedEvidenceCandidateType;
  candidateCategory: AssistedEvidenceCandidateCategory;
  candidateConfidence: number;
  candidatePayload: Record<string, unknown>;
  candidateSummary: string;
  candidateClaims: AssistedEvidenceCandidateClaim[];
  candidateLimitations: string[];
  deterministicInputRefs: string[];
}

export interface CandidateAdapterInput<RawFixturePayload> {
  tool: ValidatedOpenSourceToolDefinition;
  sourceContext: AssistedEvidenceSourceContext;
  rawPayload: RawFixturePayload;
}

export interface CandidateAdapterResult {
  normalizedCandidates: NormalizedCandidatePayload[];
  candidateInputs: CreateAssistedEvidenceCandidateInput[];
  candidates: AssistedEvidenceCandidate[];
}

export interface FixtureCandidateAdapter<RawFixturePayload> {
  adapterId: string;
  adapterVersion: string;
  toolName: string;
  toolVersion: string;
  normalize(input: CandidateAdapterInput<RawFixturePayload>): NormalizedCandidatePayload[];
  generateCandidates(input: CandidateAdapterInput<RawFixturePayload>): CandidateAdapterResult;
}

export interface MetadataFixtureSignal {
  signalId: string;
  field: 'possible_image_orientation' | 'possible_low_resolution_photo' | 'possible_duplicate_photo';
  value: string | number | boolean;
  confidence: number;
  limitationRefs: string[];
}

export interface MetadataFixturePayload {
  fixtureId: string;
  imageWidth: number;
  imageHeight: number;
  orientationHint: string;
  duplicateGroupHint: string | null;
  signals: MetadataFixtureSignal[];
}

export interface OcrFixtureSignal {
  signalId: string;
  field: 'possible_meter_label_text' | 'possible_equipment_label_text';
  text: string;
  confidence: number;
  limitationRefs: string[];
}

export interface OcrFixturePayload {
  fixtureId: string;
  textRegionCount: number;
  signals: OcrFixtureSignal[];
}
