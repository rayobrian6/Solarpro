import crypto from 'crypto';
import type { SiteSurveyFile } from '@/lib/db/surveys';

export type PhotoQualityStatus = 'good' | 'review_required' | 'poor' | 'unavailable';

export interface SurveyPhotoOpenSourceAnalysis {
  fileId: string;
  filename: string | null;
  fileUrl: string;
  analyzed: boolean;
  exactHash: string | null;
  perceptualHash: string | null;
  widthPx: number | null;
  heightPx: number | null;
  format: string | null;
  byteSize: number | null;
  sharpnessScore: number | null;
  brightnessScore: number | null;
  qualityScore: number;
  qualityStatus: PhotoQualityStatus;
  qualityFlags: string[];
  duplicateGroupId: string | null;
  duplicateRank: number | null;
  duplicateGroupSize: number;
  isDuplicateRepresentative: boolean;
  analysisError: string | null;
}

interface InternalAnalysis extends SurveyPhotoOpenSourceAnalysis {
  originalIndex: number;
}

const DEFAULT_TIMEOUT_MS = 9_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function analyzeSurveyPhotosOpenSource(files: SiteSurveyFile[]): Promise<SurveyPhotoOpenSourceAnalysis[]> {
  const analyses = await Promise.all(files.map((file, index) => analyzeOnePhoto(file, index)));
  assignDuplicateGroups(analyses);
  return analyses.map(({ originalIndex: _originalIndex, ...analysis }) => analysis);
}

async function analyzeOnePhoto(file: SiteSurveyFile, originalIndex: number): Promise<InternalAnalysis> {
  try {
    const buffer = await fetchImageBuffer(file.fileUrl);
    // Dynamic import — sharp has native bindings, keep out of client-side webpack bundle
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;
    const exactHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const { perceptualHash, sharpnessScore, brightnessScore } = await analyzePixels(buffer);
    const quality = scoreQuality({ width, height, sharpnessScore, brightnessScore, byteSize: buffer.length });

    return {
      fileId: file.id,
      filename: file.filename,
      fileUrl: file.fileUrl,
      analyzed: true,
      exactHash,
      perceptualHash,
      widthPx: width,
      heightPx: height,
      format: metadata.format ?? null,
      byteSize: buffer.length,
      sharpnessScore,
      brightnessScore,
      qualityScore: quality.score,
      qualityStatus: quality.status,
      qualityFlags: quality.flags,
      duplicateGroupId: null,
      duplicateRank: null,
      duplicateGroupSize: 1,
      isDuplicateRepresentative: true,
      analysisError: null,
      originalIndex,
    };
  } catch (err) {
    return {
      fileId: file.id,
      filename: file.filename,
      fileUrl: file.fileUrl,
      analyzed: false,
      exactHash: null,
      perceptualHash: null,
      widthPx: null,
      heightPx: null,
      format: null,
      byteSize: null,
      sharpnessScore: null,
      brightnessScore: null,
      qualityScore: 0,
      qualityStatus: 'unavailable',
      qualityFlags: ['analysis_unavailable'],
      duplicateGroupId: null,
      duplicateRank: null,
      duplicateGroupSize: 1,
      isDuplicateRepresentative: false,
      analysisError: err instanceof Error ? err.message.slice(0, 300) : 'Photo analysis failed',
      originalIndex,
    };
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Photo fetch failed: ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`Photo exceeds ${MAX_IMAGE_BYTES} byte analysis limit`);
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzePixels(buffer: Buffer): Promise<{ perceptualHash: string; sharpnessScore: number; brightnessScore: number }> {
  // Dynamic import — sharp has native bindings, keep out of client-side webpack bundle
  const sharp = (await import('sharp')).default;
  const size = 32;
  const raw = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  let sum = 0;
  for (const value of raw) sum += value;
  const average = sum / raw.length;

  let bits = '';
  for (const value of raw) bits += value >= average ? '1' : '0';
  const perceptualHash = binaryToHex(bits);

  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const center = raw[i];
      const laplacian = Math.abs((4 * center) - raw[i - 1] - raw[i + 1] - raw[i - size] - raw[i + size]);
      edgeTotal += laplacian;
      edgeCount += 1;
    }
  }

  return {
    perceptualHash,
    sharpnessScore: clamp(Math.round((edgeTotal / Math.max(edgeCount, 1)) * 4), 0, 100),
    brightnessScore: clamp(Math.round((average / 255) * 100), 0, 100),
  };
}

function scoreQuality(input: { width: number | null; height: number | null; sharpnessScore: number; brightnessScore: number; byteSize: number }) {
  const flags: string[] = [];
  const shortSide = Math.min(input.width ?? 0, input.height ?? 0);
  const longSide = Math.max(input.width ?? 0, input.height ?? 0);
  let score = 100;

  if (!input.width || !input.height) {
    flags.push('missing_dimensions');
    score -= 35;
  } else {
    if (shortSide < 720) {
      flags.push('low_resolution');
      score -= shortSide < 480 ? 35 : 20;
    }
    if (longSide < 1200) {
      flags.push('limited_detail');
      score -= 10;
    }
  }

  if (input.sharpnessScore < 18) {
    flags.push('likely_blurry');
    score -= 35;
  } else if (input.sharpnessScore < 30) {
    flags.push('soft_focus_review');
    score -= 15;
  }

  if (input.brightnessScore < 18) {
    flags.push('too_dark');
    score -= 25;
  } else if (input.brightnessScore > 88) {
    flags.push('possibly_overexposed');
    score -= 15;
  }

  if (input.byteSize < 50_000) {
    flags.push('very_small_file');
    score -= 15;
  }

  const finalScore = clamp(score, 0, 100);
  return {
    score: finalScore,
    status: finalScore >= 72 ? 'good' as const : finalScore >= 45 ? 'review_required' as const : 'poor' as const,
    flags,
  };
}

function assignDuplicateGroups(analyses: InternalAnalysis[]) {
  const groups: InternalAnalysis[][] = [];
  const assigned = new Set<string>();

  for (const analysis of analyses) {
    if (!analysis.analyzed || assigned.has(analysis.fileId)) continue;
    const group = analyses.filter(candidate => {
      if (!candidate.analyzed || assigned.has(candidate.fileId)) return false;
      if (candidate.exactHash && analysis.exactHash && candidate.exactHash === analysis.exactHash) return true;
      if (candidate.perceptualHash && analysis.perceptualHash) return hammingDistance(candidate.perceptualHash, analysis.perceptualHash) <= 24;
      return false;
    });
    for (const member of group) assigned.add(member.fileId);
    groups.push(group);
  }

  groups.forEach((group, groupIndex) => {
    const ranked = [...group].sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      const bPixels = (b.widthPx ?? 0) * (b.heightPx ?? 0);
      const aPixels = (a.widthPx ?? 0) * (a.heightPx ?? 0);
      if (bPixels !== aPixels) return bPixels - aPixels;
      return a.originalIndex - b.originalIndex;
    });
    const groupId = ranked.length > 1 ? `dup-${groupIndex + 1}` : null;
    ranked.forEach((member, rankIndex) => {
      member.duplicateGroupId = groupId;
      member.duplicateRank = ranked.length > 1 ? rankIndex + 1 : null;
      member.duplicateGroupSize = ranked.length;
      member.isDuplicateRepresentative = rankIndex === 0;
      if (ranked.length > 1 && rankIndex > 0 && !member.qualityFlags.includes('near_duplicate')) {
        member.qualityFlags.push('near_duplicate');
      }
    });
  });
}

function binaryToHex(bits: string): string {
  let hex = '';
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4).padEnd(4, '0'), 2).toString(16);
  }
  return hex;
}

function hammingDistance(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  let distance = Math.abs(a.length - b.length) * 4;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const av = Number.parseInt(a[index], 16);
    const bv = Number.parseInt(b[index], 16);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      distance += 4;
    } else {
      distance += bitCount(av ^ bv);
    }
  }
  return distance + Math.max(0, max - Math.min(a.length, b.length)) * 4;
}

function bitCount(value: number): number {
  let count = 0;
  let next = value;
  while (next) {
    count += next & 1;
    next >>= 1;
  }
  return count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
