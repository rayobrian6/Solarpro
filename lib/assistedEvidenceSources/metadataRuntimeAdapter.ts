import sharp from 'sharp';
import { createHash } from 'crypto';
import { deterministicHash } from '@/lib/assistedEvidence';
import { createReviewRequiredCandidates } from './candidateNormalization';
import { normalizeCandidateConfidence, preserveLowestConfidence } from './candidateConfidenceRules';
import { getRegisteredOpenSourceTool } from './openSourceToolRegistry';
import type { CandidateAdapterInput, MetadataRuntimePayload, MetadataRuntimeSignal } from './candidateAdapterTypes';
import type { MetadataCandidateRuntimeAdapter } from './candidateAdapterContracts';

const TOOL_NAME = 'sharp-metadata-runtime';
const TOOL_VERSION = '0.34.5';
const LARGE_IMAGE_BYTES = 8 * 1024 * 1024;
const LOW_RESOLUTION_PIXELS = 1024 * 768;

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileSizeBucket(byteLength: number): MetadataRuntimePayload['fileSizeBucket'] {
  if (byteLength <= 0) return 'empty';
  if (byteLength < 100 * 1024) return 'small';
  if (byteLength > LARGE_IMAGE_BYTES) return 'large';
  return 'normal';
}

function orientationLabel(width: number | null, height: number | null, orientation: number | null): string {
  if (orientation && orientation >= 5 && orientation <= 8) return 'exif-rotated';
  if (!width || !height || width <= 0 || height <= 0) return 'unknown';
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function normalizedMetadataHash(payload: Omit<MetadataRuntimePayload, 'runtimePayloadHash'>): string {
  return deterministicHash(payload);
}

function buildSignals(payload: Omit<MetadataRuntimePayload, 'runtimePayloadHash' | 'derivedSignals'>): MetadataRuntimeSignal[] {
  const signals: MetadataRuntimeSignal[] = [];
  const width = payload.width;
  const height = payload.height;
  const pixelCount = width && height ? width * height : 0;

  signals.push({
    signalId: 'metadata-runtime-orientation',
    field: 'possible_image_orientation',
    value: orientationLabel(width, height, payload.orientation),
    confidence: width && height ? 0.78 : 0.2,
    limitationRefs: ['metadata-only', 'no-image-understanding'],
  });

  if (!width || !height || width <= 0 || height <= 0) {
    signals.push({
      signalId: 'metadata-runtime-invalid-dimensions',
      field: 'possible_invalid_photo_dimensions',
      value: `${width ?? 'unknown'}x${height ?? 'unknown'}`,
      confidence: 0.82,
      limitationRefs: ['metadata-only', 'dimensions-missing-or-invalid'],
    });
  }

  if (pixelCount > 0 && pixelCount < LOW_RESOLUTION_PIXELS) {
    signals.push({
      signalId: 'metadata-runtime-low-resolution',
      field: 'possible_low_resolution_photo',
      value: `${width}x${height}`,
      confidence: 0.67,
      limitationRefs: ['metadata-only', 'resolution-threshold-only'],
    });
  }

  if (!payload.hasExifMetadata) {
    signals.push({
      signalId: 'metadata-runtime-missing-exif',
      field: 'possible_missing_exif_metadata',
      value: true,
      confidence: 0.58,
      limitationRefs: ['metadata-only', 'exif-presence-only'],
    });
  }

  if (payload.fileSizeBucket === 'large') {
    signals.push({
      signalId: 'metadata-runtime-large-file',
      field: 'possible_large_image_file',
      value: payload.inputByteLength,
      confidence: 0.64,
      limitationRefs: ['metadata-only', 'file-size-threshold-only'],
    });
  }

  signals.push({
    signalId: 'metadata-runtime-duplicate-fingerprint',
    field: 'possible_duplicate_photo',
    value: deterministicHash({ width, height, format: payload.format, orientation: payload.orientation, inputByteLength: payload.inputByteLength }),
    confidence: 0.31,
    limitationRefs: ['metadata-only', 'not-perceptual-hash', 'not-image-comparison'],
  });

  return signals.sort((a, b) => a.signalId.localeCompare(b.signalId));
}

function candidateTypeForSignal(signal: MetadataRuntimeSignal) {
  if (signal.field === 'possible_image_orientation') return 'orientation_candidate' as const;
  if (signal.field === 'possible_duplicate_photo') return 'duplicate_similarity_candidate' as const;
  return 'photo_quality_candidate' as const;
}

function candidateCategoryForSignal(signal: MetadataRuntimeSignal) {
  if (signal.field === 'possible_image_orientation') return 'orientation' as const;
  if (signal.field === 'possible_duplicate_photo') return 'duplicate_hygiene' as const;
  return 'quality' as const;
}

export const metadataRuntimeAdapter: MetadataCandidateRuntimeAdapter = {
  adapterId: 'metadata-runtime-adapter-v1',
  adapterVersion: '1.0.0',
  toolName: TOOL_NAME,
  toolVersion: TOOL_VERSION,
  async extractRuntimePayload(imageBytes) {
    const metadata = await sharp(imageBytes, { failOn: 'none' }).metadata();
    const basePayload = {
      inputByteLength: imageBytes.byteLength,
      format: metadata.format ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      orientation: metadata.orientation ?? null,
      density: metadata.density ?? null,
      hasExifMetadata: Boolean(metadata.exif),
      hasProfile: Boolean(metadata.icc || metadata.iccProfile),
      hasAlpha: Boolean(metadata.hasAlpha),
      pages: metadata.pages ?? null,
      fileSizeBucket: fileSizeBucket(imageBytes.byteLength),
    } satisfies Omit<MetadataRuntimePayload, 'runtimePayloadHash' | 'derivedSignals'>;
    const derivedSignals = buildSignals(basePayload);
    return {
      ...basePayload,
      derivedSignals,
      runtimePayloadHash: normalizedMetadataHash({ ...basePayload, derivedSignals }),
    };
  },
  normalize(input) {
    const runtimeInputHash = input.rawPayload.runtimePayloadHash || sha256Bytes(new TextEncoder().encode(JSON.stringify(input.rawPayload)));
    return [...input.rawPayload.derivedSignals]
      .sort((a, b) => a.signalId.localeCompare(b.signalId))
      .map(signal => ({
        candidateType: candidateTypeForSignal(signal),
        candidateCategory: candidateCategoryForSignal(signal),
        candidateConfidence: preserveLowestConfidence([signal.confidence, normalizeCandidateConfidence(signal.confidence)]),
        candidatePayload: {
          field: signal.field,
          value: signal.value,
          runtimePayloadHash: runtimeInputHash,
          runtimeSource: TOOL_NAME,
          runtimeVersion: TOOL_VERSION,
          inputByteLength: input.rawPayload.inputByteLength,
          format: input.rawPayload.format,
          width: input.rawPayload.width,
          height: input.rawPayload.height,
          orientation: input.rawPayload.orientation,
          density: input.rawPayload.density,
          hasExifMetadata: input.rawPayload.hasExifMetadata,
          hasProfile: input.rawPayload.hasProfile,
          hasAlpha: input.rawPayload.hasAlpha,
          fileSizeBucket: input.rawPayload.fileSizeBucket,
          runtimePilot: true,
          runtimeLabel: 'RUNTIME DATA',
        },
        candidateSummary: `Runtime metadata signal ${signal.field}: ${String(signal.value)}`,
        candidateClaims: [
          {
            claimId: signal.signalId,
            field: signal.field,
            value: signal.value,
            confidence: signal.confidence,
            limitationRefs: signal.limitationRefs,
          },
        ],
        candidateLimitations: [...signal.limitationRefs, 'runtime-metadata-only', 'no-ocr-runtime', 'no-cv-runtime', 'no-engineering-authority'],
        deterministicInputRefs: ['runtime-metadata-payload', runtimeInputHash, signal.signalId],
      }));
  },
  generateCandidates(input) {
    return createReviewRequiredCandidates(input.tool, input.sourceContext, this.normalize(input));
  },
};

export async function generateMetadataRuntimeCandidates(
  sourceContext: CandidateAdapterInput<MetadataRuntimePayload>['sourceContext'],
  imageBytes: Uint8Array,
) {
  const tool = getRegisteredOpenSourceTool(TOOL_NAME, TOOL_VERSION);
  const rawPayload = await metadataRuntimeAdapter.extractRuntimePayload(imageBytes);
  return metadataRuntimeAdapter.generateCandidates({ tool, sourceContext, rawPayload });
}
