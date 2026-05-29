/**
 * Candidate suppression pipeline for geometry refinement.
 *
 * This module runs AFTER the existing 4-stage refinement pipeline
 * (noise filter → IoU dedup → classify → score) and applies additional
 * gating/suppression to prevent candidate explosion in the UI.
 *
 * Pipeline stages:
 *   1. NMS (Non-Maximum Suppression) — remove overlapping lower-scored candidates
 *   2. Confidence gating — per-class minimum confidence thresholds
 *   3. Geometry score gating — per-class minimum geometry score thresholds
 *   4. Top-K per class — keep only the top-K candidates per geometry class per file
 *   5. Global cap — enforce maximum total candidates per file
 *
 * IMPORTANT: This module does NOT mutate input arrays. It returns new arrays
 * and annotations. Suppressed candidates are preserved for debug visibility.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { NormalizedRegion } from './overlayCoordinateConversion';
import { computeIoU } from './geometryRefinement';

/* ── Types ────────────────────────────────────────────────────────────────── */

/** A candidate that can be evaluated for suppression. */
export interface SuppressibleCandidate {
  id: string;
  fileId: string;
  geometryClass: string;
  geometryScore: number;
  confidence: number;
  region: NormalizedRegion;
}

/** Configuration for the suppression pipeline. */
export interface SuppressionConfig {
  /** IoU threshold for NMS. Candidates overlapping above this threshold are suppressed. Default 0.45. */
  nmsIouThreshold: number;
  /** Which score to rank by for NMS: 'geometryScore' or 'confidence'. Default 'geometryScore'. */
  nmsRankBy: 'geometryScore' | 'confidence';
  /** Per-class minimum confidence thresholds. Candidates below are suppressed. */
  confidenceThresholds: Record<string, number>;
  /** Per-class minimum geometry score thresholds. Candidates below are suppressed. */
  geometryScoreThresholds: Record<string, number>;
  /** Maximum candidates per (fileId, geometryClass) group. */
  topKPerClass: Record<string, number>;
  /** Maximum total candidates per fileId across all classes. Default 16. */
  maxTotalPerFile: number;
}

/** Whether a candidate is trusted or suppressed. */
export type CandidateDisposition = 'trusted' | 'suppressed';

/** A candidate annotated with its suppression disposition. */
export interface SuppressedCandidate {
  candidate: SuppressibleCandidate;
  disposition: CandidateDisposition;
  /** Human-readable reason if suppressed. Empty string if trusted. */
  suppressionReason: string;
}

/** The full output of the suppression pipeline. */
export interface SuppressionResult {
  schemaVersion: 'candidate_suppression_v1';
  /** All entries, both trusted and suppressed. */
  entries: SuppressedCandidate[];
  /** Only trusted candidates. */
  trusted: SuppressibleCandidate[];
  /** Only suppressed candidates. */
  suppressed: SuppressibleCandidate[];
  /** Total input count. */
  inputCount: number;
  /** Trusted count. */
  trustedCount: number;
  /** Suppressed count. */
  suppressedCount: number;
  /** Per-file trusted counts. */
  perFileCounts: Record<string, { trusted: number; suppressed: number }>;
  /** The config used for this suppression run. */
  config: SuppressionConfig;
  /** Whether any candidates were suppressed (for UI warning). */
  hasSuppressedCandidates: boolean;
}

/* ── Default config ───────────────────────────────────────────────────────── */

export const DEFAULT_SUPPRESSION_CONFIG: SuppressionConfig = {
  nmsIouThreshold: 0.45,
  nmsRankBy: 'geometryScore',
  confidenceThresholds: {
    probable_roof_plane: 25,
    probable_wall_plane: 25,
    probable_equipment: 20,
    probable_obstruction: 20,
    probable_text_label: 30,
    // ground_noise: always suppress (confidence=100 means nothing passes)
    probable_ground_noise: 100,
    unknown: 30,
  },
  geometryScoreThresholds: {
    probable_roof_plane: 0.15,
    probable_wall_plane: 0.15,
    probable_equipment: 0.10,
    probable_obstruction: 0.10,
    probable_text_label: 0.10,
    // ground_noise: always suppress (1.0 means nothing passes)
    probable_ground_noise: 1.0,
    unknown: 0.20,
  },
  topKPerClass: {
    probable_roof_plane: 4,
    probable_wall_plane: 4,
    probable_equipment: 4,
    probable_obstruction: 8,
    probable_text_label: 2,
    probable_ground_noise: 0,
    unknown: 2,
  },
  maxTotalPerFile: 16,
};

/* ── Pipeline entry point ─────────────────────────────────────────────────── */

/**
 * Run the full candidate suppression pipeline on refined candidates.
 *
 * IMPORTANT: This function does NOT mutate the input array. It returns a new
 * result with disposition annotations. All input candidates are preserved.
 */
export function suppressCandidates(
  candidates: SuppressibleCandidate[],
  config: Partial<SuppressionConfig> = {},
): SuppressionResult {
  const cfg: SuppressionConfig = { ...DEFAULT_SUPPRESSION_CONFIG, ...config };

  // Merge partial sub-configs
  if (config.confidenceThresholds) {
    cfg.confidenceThresholds = { ...DEFAULT_SUPPRESSION_CONFIG.confidenceThresholds, ...config.confidenceThresholds };
  }
  if (config.geometryScoreThresholds) {
    cfg.geometryScoreThresholds = { ...DEFAULT_SUPPRESSION_CONFIG.geometryScoreThresholds, ...config.geometryScoreThresholds };
  }
  if (config.topKPerClass) {
    cfg.topKPerClass = { ...DEFAULT_SUPPRESSION_CONFIG.topKPerClass, ...config.topKPerClass };
  }

  // Stage 1: NMS
  const afterNms = applyNMS(candidates, cfg);

  // Stage 2: Confidence gating
  const afterConfidence = applyConfidenceGate(afterNms, cfg);

  // Stage 3: Geometry score gating
  const afterGeoScore = applyGeometryScoreGate(afterConfidence, cfg);

  // Stage 4: Top-K per class
  const afterTopK = applyTopKPerClass(afterGeoScore, cfg);

  // Stage 5: Global cap
  const final = applyGlobalCap(afterTopK, cfg);

  // Build result
  const trusted = final.filter((e) => e.disposition === 'trusted').map((e) => e.candidate);
  const suppressed = final.filter((e) => e.disposition === 'suppressed').map((e) => e.candidate);

  const perFileCounts: Record<string, { trusted: number; suppressed: number }> = {};
  for (const entry of final) {
    if (!perFileCounts[entry.candidate.fileId]) {
      perFileCounts[entry.candidate.fileId] = { trusted: 0, suppressed: 0 };
    }
    if (entry.disposition === 'trusted') {
      perFileCounts[entry.candidate.fileId].trusted++;
    } else {
      perFileCounts[entry.candidate.fileId].suppressed++;
    }
  }

  return {
    schemaVersion: 'candidate_suppression_v1',
    entries: final,
    trusted,
    suppressed,
    inputCount: candidates.length,
    trustedCount: trusted.length,
    suppressedCount: suppressed.length,
    perFileCounts,
    config: cfg,
    hasSuppressedCandidates: suppressed.length > 0,
  };
}

/* ── Stage 1: NMS ─────────────────────────────────────────────────────────── */

function applyNMS(
  candidates: SuppressibleCandidate[],
  cfg: SuppressionConfig,
): SuppressedCandidate[] {
  // Group by fileId — NMS only applies within the same image
  const byFile = new Map<string, SuppressibleCandidate[]>();
  for (const c of candidates) {
    if (!byFile.has(c.fileId)) byFile.set(c.fileId, []);
    byFile.get(c.fileId)!.push(c);
  }

  const result: SuppressedCandidate[] = [];
  for (const [, fileCandidates] of byFile) {
    // Sort by ranking score descending
    const sorted = [...fileCandidates].sort((a, b) => {
      const scoreA = cfg.nmsRankBy === 'geometryScore' ? a.geometryScore : a.confidence;
      const scoreB = cfg.nmsRankBy === 'geometryScore' ? b.geometryScore : b.confidence;
      return scoreB - scoreA;
    });

    const suppressedIds = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      if (suppressedIds.has(sorted[i].id)) continue;

      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressedIds.has(sorted[j].id)) continue;

        // Only apply NMS within the same geometry class
        if (sorted[i].geometryClass !== sorted[j].geometryClass) continue;

        const iou = computeIoU(sorted[i].region, sorted[j].region);
        if (iou >= cfg.nmsIouThreshold) {
          suppressedIds.add(sorted[j].id);
        }
      }
    }

    for (const c of sorted) {
      if (suppressedIds.has(c.id)) {
        result.push({ candidate: c, disposition: 'suppressed', suppressionReason: `NMS: IoU≥${cfg.nmsIouThreshold} with higher-scored candidate` });
      } else {
        result.push({ candidate: c, disposition: 'trusted', suppressionReason: '' });
      }
    }
  }

  return result;
}

/* ── Stage 2: Confidence gating ───────────────────────────────────────────── */

function applyConfidenceGate(
  entries: SuppressedCandidate[],
  cfg: SuppressionConfig,
): SuppressedCandidate[] {
  return entries.map((entry) => {
    // Already suppressed — keep as-is
    if (entry.disposition === 'suppressed') return entry;

    const threshold = cfg.confidenceThresholds[entry.candidate.geometryClass]
      ?? cfg.confidenceThresholds['unknown']
      ?? 0;

    if (entry.candidate.confidence < threshold) {
      return {
        ...entry,
        disposition: 'suppressed' as const,
        suppressionReason: `Confidence ${entry.candidate.confidence.toFixed(0)} below threshold ${threshold} for class ${entry.candidate.geometryClass}`,
      };
    }

    return entry;
  });
}

/* ── Stage 3: Geometry score gating ───────────────────────────────────────── */

function applyGeometryScoreGate(
  entries: SuppressedCandidate[],
  cfg: SuppressionConfig,
): SuppressedCandidate[] {
  return entries.map((entry) => {
    if (entry.disposition === 'suppressed') return entry;

    const threshold = cfg.geometryScoreThresholds[entry.candidate.geometryClass]
      ?? cfg.geometryScoreThresholds['unknown']
      ?? 0;

    if (entry.candidate.geometryScore < threshold) {
      return {
        ...entry,
        disposition: 'suppressed' as const,
        suppressionReason: `Geometry score ${entry.candidate.geometryScore.toFixed(3)} below threshold ${threshold} for class ${entry.candidate.geometryClass}`,
      };
    }

    return entry;
  });
}

/* ── Stage 4: Top-K per class ─────────────────────────────────────────────── */

function applyTopKPerClass(
  entries: SuppressedCandidate[],
  cfg: SuppressionConfig,
): SuppressedCandidate[] {
  // Group by (fileId, geometryClass) among currently trusted
  const groups = new Map<string, SuppressedCandidate[]>();
  for (const entry of entries) {
    if (entry.disposition !== 'trusted') continue;
    const key = `${entry.candidate.fileId}::${entry.candidate.geometryClass}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const toSuppress = new Set<string>();

  for (const [key, group] of groups) {
    const geometryClass = key.split('::')[1];
    const k = cfg.topKPerClass[geometryClass] ?? cfg.topKPerClass['unknown'] ?? 2;

    if (group.length <= k) continue;

    // Sort by geometry score descending, keep top-K
    const sorted = [...group].sort((a, b) => b.candidate.geometryScore - a.candidate.geometryScore);
    const kept = new Set(sorted.slice(0, k).map((e) => e.candidate.id));

    for (const entry of group) {
      if (!kept.has(entry.candidate.id)) {
        toSuppress.add(entry.candidate.id);
      }
    }
  }

  return entries.map((entry) => {
    if (entry.disposition === 'suppressed') return entry;
    if (toSuppress.has(entry.candidate.id)) {
      return {
        ...entry,
        disposition: 'suppressed' as const,
        suppressionReason: `Top-K: exceeded per-class limit for ${entry.candidate.geometryClass}`,
      };
    }
    return entry;
  });
}

/* ── Stage 5: Global cap ──────────────────────────────────────────────────── */

function applyGlobalCap(
  entries: SuppressedCandidate[],
  cfg: SuppressionConfig,
): SuppressedCandidate[] {
  // Group trusted by fileId
  const byFile = new Map<string, SuppressedCandidate[]>();
  for (const entry of entries) {
    if (entry.disposition !== 'trusted') continue;
    if (!byFile.has(entry.candidate.fileId)) byFile.set(entry.candidate.fileId, []);
    byFile.get(entry.candidate.fileId)!.push(entry);
  }

  const toSuppress = new Set<string>();

  for (const [, fileEntries] of byFile) {
    if (fileEntries.length <= cfg.maxTotalPerFile) continue;

    // Sort by geometry score descending, keep top maxTotalPerFile
    const sorted = [...fileEntries].sort((a, b) => b.candidate.geometryScore - a.candidate.geometryScore);
    const kept = new Set(sorted.slice(0, cfg.maxTotalPerFile).map((e) => e.candidate.id));

    for (const entry of fileEntries) {
      if (!kept.has(entry.candidate.id)) {
        toSuppress.add(entry.candidate.id);
      }
    }
  }

  return entries.map((entry) => {
    if (entry.disposition === 'suppressed') return entry;
    if (toSuppress.has(entry.candidate.id)) {
      return {
        ...entry,
        disposition: 'suppressed' as const,
        suppressionReason: `Global cap: exceeded max ${cfg.maxTotalPerFile} candidates per file`,
      };
    }
    return entry;
  });
}
