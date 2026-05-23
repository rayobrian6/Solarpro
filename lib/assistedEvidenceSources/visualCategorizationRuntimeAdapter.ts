import { createHash } from 'crypto';
import { createReviewRequiredCandidates } from './candidateNormalization';
import type { CandidateAdapterInput, CandidateAdapterResult, NormalizedCandidatePayload, RuntimeCandidateAdapter } from './candidateAdapterTypes';
import type { VisualCategorizationExtractionInput, VisualCategorizationLabel, VisualCategorizationRuntimePayload, VisualCategorizationSignal } from './visualCategorizationRuntimeTypes';
import { ALLOWED_VISUAL_CATEGORIZATION_LABELS, VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME, VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION } from './visualCategorizationRuntimeTypes';

const LIMITATIONS = [
  'visual_categorization_candidate_only',
  'non_authoritative_review_required',
  'no_object_detection',
  'no_segmentation',
  'no_geometry_extraction',
  'no_engineering_inference',
  'no_cad_or_workflow_influence',
  'no_canonical_mutation',
] as const;

const LABEL_TO_CATEGORY: Record<VisualCategorizationLabel, NormalizedCandidatePayload['candidateCategory']> = {
  possible_roof_photo: 'roof_context',
  possible_attic_photo: 'structure_context',
  possible_msp_photo: 'electrical_context',
  possible_inverter_photo: 'electrical_context',
  possible_meter_photo: 'electrical_context',
  possible_equipment_label_photo: 'field_context',
  possible_utility_bill_photo: 'field_context',
  possible_site_overview_photo: 'field_context',
  possible_obstruction_photo: 'roof_context',
};

const TEXT_RULES: readonly { label: VisualCategorizationLabel; terms: readonly string[]; confidence: number }[] = [
  { label: 'possible_utility_bill_photo', terms: ['utility_bill', 'utility bill', 'bill', 'invoice', 'account'], confidence: 0.62 },
  { label: 'possible_equipment_label_photo', terms: ['equipment_label', 'equipment label', 'label', 'nameplate', 'placard'], confidence: 0.6 },
  { label: 'possible_msp_photo', terms: ['main_service_panel', 'main service panel', 'msp', 'main_panel', 'main panel', 'service_panel', 'service panel', 'breaker'], confidence: 0.61 },
  { label: 'possible_inverter_photo', terms: ['inverter', 'gateway'], confidence: 0.58 },
  { label: 'possible_meter_photo', terms: ['meter'], confidence: 0.59 },
  { label: 'possible_attic_photo', terms: ['attic', 'rafter', 'rafters'], confidence: 0.57 },
  { label: 'possible_obstruction_photo', terms: ['obstruction', 'chimney', 'skylight', 'vent'], confidence: 0.55 },
  { label: 'possible_roof_photo', terms: ['roof', 'shingle', 'tile'], confidence: 0.56 },
  { label: 'possible_site_overview_photo', terms: ['overview', 'site', 'exterior', 'front', 'side', 'back'], confidence: 0.54 },
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

function createSignal(label: VisualCategorizationLabel, confidence: number, evidenceBasis: readonly string[]): VisualCategorizationSignal {
  return {
    signalId: `visual_${stableHash({ label, confidence, evidenceBasis }).slice(0, 16)}`,
    label,
    confidence: clampConfidence(confidence),
    evidenceBasis,
    limitationRefs: LIMITATIONS,
  };
}

function deriveSignals(byteSignature: string, sourceContextText: string | null | undefined): VisualCategorizationSignal[] {
  const normalized = normalizeText(sourceContextText);
  const matched = new Map<VisualCategorizationLabel, VisualCategorizationSignal>();

  if (normalized) {
    for (const rule of TEXT_RULES) {
      const hit = rule.terms.find(term => normalized.includes(normalizeText(term)));
      if (hit) matched.set(rule.label, createSignal(rule.label, rule.confidence, [`source_context_text:${hit}`]));
    }
  }

  if (matched.size === 0) {
    const index = Number.parseInt(byteSignature.slice(0, 8), 16) % ALLOWED_VISUAL_CATEGORIZATION_LABELS.length;
    const label = ALLOWED_VISUAL_CATEGORIZATION_LABELS[index];
    matched.set(label, createSignal(label, 0.21, ['byte_hash_stable_low_confidence_fallback']));
  }

  return [...matched.values()].sort((a, b) => `${a.label}:${a.signalId}`.localeCompare(`${b.label}:${b.signalId}`));
}

export class VisualCategorizationRuntimeAdapter implements RuntimeCandidateAdapter<VisualCategorizationRuntimePayload> {
  adapterId = 'visual-categorization-runtime-adapter-v1';
  adapterVersion = '1.0.0';
  toolName = VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME;
  toolVersion = VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION;

  async extractRuntimePayload(input: Uint8Array | VisualCategorizationExtractionInput): Promise<VisualCategorizationRuntimePayload> {
    const imageBytes = input instanceof Uint8Array ? input : input.imageBytes;
    const sourceContextText = input instanceof Uint8Array ? null : input.sourceContextText;
    const byteSignature = createHash('sha256').update(imageBytes).digest('hex');
    const sourceContextTextHash = stableHash(normalizeText(sourceContextText));
    const derivedSignals = deriveSignals(byteSignature, sourceContextText);
    const confidence = derivedSignals.length === 0 ? 0 : clampConfidence(Math.max(...derivedSignals.map(signal => signal.confidence)));
    const runtimePayloadHash = stableHash({
      inputByteLength: imageBytes.byteLength,
      byteSignature,
      sourceContextTextHash,
      derivedSignals,
      method: 'deterministic_source_context_and_byte_hash',
    });

    return {
      runtimePayloadHash,
      inputByteLength: imageBytes.byteLength,
      method: 'deterministic_source_context_and_byte_hash',
      sourceContextTextHash,
      byteSignature,
      confidence,
      derivedSignals,
    };
  }

  normalize(input: CandidateAdapterInput<VisualCategorizationRuntimePayload>): NormalizedCandidatePayload[] {
    return input.rawPayload.derivedSignals.map(signal => ({
      candidateType: 'visual_category_candidate',
      candidateCategory: LABEL_TO_CATEGORY[signal.label],
      candidateConfidence: signal.confidence,
      candidatePayload: {
        label: signal.label,
        runtimePayloadHash: input.rawPayload.runtimePayloadHash,
        method: input.rawPayload.method,
        evidenceBasis: [...signal.evidenceBasis],
        nonSpatial: true,
        nonGeometric: true,
        nonAuthoritative: true,
        reviewRequired: true,
        forbiddenUses: ['engineering_fact', 'geometry_truth', 'equipment_confirmation', 'cad_input', 'workflow_trigger', 'canonical_mutation'],
      },
      candidateSummary: `Review-required possible photo category: ${signal.label}.`,
      candidateClaims: [
        {
          claimId: signal.signalId,
          field: 'possible_photo_category',
          value: signal.label,
          confidence: signal.confidence,
          limitationRefs: [...signal.limitationRefs],
        },
      ],
      candidateLimitations: [...signal.limitationRefs],
      deterministicInputRefs: [input.rawPayload.runtimePayloadHash, input.rawPayload.byteSignature, input.rawPayload.sourceContextTextHash],
    }));
  }

  generateCandidates(input: CandidateAdapterInput<VisualCategorizationRuntimePayload>): CandidateAdapterResult {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  }
}

export const visualCategorizationRuntimeAdapter = new VisualCategorizationRuntimeAdapter();
