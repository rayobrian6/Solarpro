import { deterministicHash } from '@/lib/assistedEvidence';
import { createReviewRequiredCandidates } from './candidateNormalization';
import { normalizeCandidateConfidence, preserveLowestConfidence } from './candidateConfidenceRules';
import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import type { CandidateAdapterInput, OcrRuntimeField, OcrRuntimePayload, OcrRuntimeSignal } from './candidateAdapterTypes';
import type { OcrCandidateRuntimeAdapter } from './candidateAdapterContracts';

const TOOL_NAME = 'tesseract-js-ocr-runtime';
const TOOL_VERSION = '7.0.0';
const DEFAULT_FIELD: OcrRuntimeField = 'possible_equipment_label_text';
const MAX_TEXT_CHARS = 4000;

function normalizeOcrRuntimeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function normalizeOcrConfidence(confidence: number): number {
  return normalizeCandidateConfidence(confidence > 1 ? confidence / 100 : confidence);
}

function buildRuntimePayloadHash(payload: Omit<OcrRuntimePayload, 'runtimePayloadHash'>): string {
  return deterministicHash(payload);
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').filter(line => line.trim()).length;
}

function buildSignals(payload: Omit<OcrRuntimePayload, 'runtimePayloadHash' | 'derivedSignals'>): OcrRuntimeSignal[] {
  if (!payload.text.trim()) return [];
  return [{
    signalId: 'ocr-runtime-text-region-1',
    field: DEFAULT_FIELD,
    text: payload.text,
    confidence: payload.confidence,
    limitationRefs: ['ocr-text-only', 'field-label-default-review-required', 'no-engineering-fact-inference'],
  }];
}

function categoryForField(field: OcrRuntimeField) {
  return field === 'possible_service_panel_rating_text'
    || field === 'possible_breaker_rating_text'
    || field === 'possible_equipment_label_text'
    || field === 'possible_nameplate_text'
    ? 'electrical_context' as const
    : 'field_context' as const;
}

export const ocrRuntimeAdapter: OcrCandidateRuntimeAdapter = {
  adapterId: 'ocr-runtime-adapter-v1',
  adapterVersion: '1.0.0',
  toolName: TOOL_NAME,
  toolVersion: TOOL_VERSION,
  async extractRuntimePayload(imageBytes) {
    if (imageBytes.byteLength === 0) {
      const basePayload = {
        inputByteLength: 0,
        method: 'none' as const,
        confidence: 0,
        text: '',
        textLength: 0,
        textLineCount: 0,
        derivedSignals: [] as OcrRuntimeSignal[],
      };
      return { ...basePayload, runtimePayloadHash: buildRuntimePayloadHash(basePayload) };
    }

    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(Buffer.from(imageBytes));
      const text = normalizeOcrRuntimeText(data.text ?? '');
      const confidence = normalizeOcrConfidence(Math.round(data.confidence ?? 0));
      const basePayload = {
        inputByteLength: imageBytes.byteLength,
        method: text ? 'tesseract-js' as const : 'none' as const,
        confidence: text ? confidence : 0,
        text,
        textLength: text.length,
        textLineCount: lineCount(text),
      };
      const derivedSignals = buildSignals(basePayload);
      return {
        ...basePayload,
        derivedSignals,
        runtimePayloadHash: buildRuntimePayloadHash({ ...basePayload, derivedSignals }),
      };
    } finally {
      await worker.terminate();
    }
  },
  normalize(input: CandidateAdapterInput<OcrRuntimePayload>) {
    const runtimeInputHash = input.rawPayload.runtimePayloadHash || deterministicHash(input.rawPayload);
    return [...input.rawPayload.derivedSignals]
      .filter(signal => signal.text.trim().length > 0)
      .sort((a, b) => a.signalId.localeCompare(b.signalId))
      .map(signal => ({
        candidateType: 'text_region_candidate' as const,
        candidateCategory: categoryForField(signal.field),
        candidateConfidence: preserveLowestConfidence([signal.confidence, input.rawPayload.confidence]),
        candidatePayload: {
          field: signal.field,
          possibleText: signal.text,
          runtimePayloadHash: runtimeInputHash,
          runtimeSource: TOOL_NAME,
          runtimeVersion: TOOL_VERSION,
          runtimeMethod: input.rawPayload.method,
          inputByteLength: input.rawPayload.inputByteLength,
          textLength: signal.text.length,
          textLineCount: input.rawPayload.textLineCount,
          runtimePilot: true,
          runtimeLabel: 'OCR RUNTIME TEXT',
          canonicalMutationAllowed: false,
          textOnlyEvidence: true,
        },
        candidateSummary: `Runtime OCR text candidate for ${signal.field}; review required before any use.`,
        candidateClaims: [{
          claimId: signal.signalId,
          field: signal.field,
          value: signal.text,
          confidence: signal.confidence,
          limitationRefs: signal.limitationRefs,
        }],
        candidateLimitations: [
          ...signal.limitationRefs,
          'runtime-ocr-text-only',
          'review-required',
          'non-authoritative',
          'no-engineering-authority',
          'no-canonical-mutation',
          'does-not-confirm-panel-rating',
          'does-not-set-breaker-size',
          'does-not-satisfy-requirements',
        ],
        deterministicInputRefs: ['runtime-ocr-payload', runtimeInputHash, signal.signalId],
      }));
  },
  generateCandidates(input) {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  },
};

export async function generateOcrRuntimeCandidates(
  sourceContext: CandidateAdapterInput<OcrRuntimePayload>['sourceContext'],
  imageBytes: Uint8Array,
) {
  const tool = getRegisteredOpenSourceTool(TOOL_NAME, TOOL_VERSION);
  const rawPayload = await ocrRuntimeAdapter.extractRuntimePayload(imageBytes);
  return ocrRuntimeAdapter.generateCandidates({ tool, sourceContext, rawPayload });
}
