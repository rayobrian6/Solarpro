/**
 * Before/After Evidence: Candidate Suppression Pipeline
 *
 * This script demonstrates the effect of the suppression pipeline
 * on a realistic mock candidate set that mirrors what the 96×96
 * edge detection worker would produce.
 *
 * Run: npx tsx lib/assistedEvidenceSources/beforeAfterEvidence.ts
 */

import {
  suppressCandidates,
  DEFAULT_SUPPRESSION_CONFIG,
  type SuppressibleCandidate,
} from './candidateSuppression';

/* ── Mock candidate set (what openSourcePhotoVisionWorker produces) ──────── */

const REGION = (x: number, y: number, w: number, h: number) =>
  ({ x, y, width: w, height: h, coordinateSystem: 'normalized_image_0_1000' as const });

/**
 * Typical output from openSourcePhotoVisionWorker for a single photo:
 * - 8 dense regions (alternating rectangular_region / obstruction by index parity)
 * - 3-8 dominant lines (top rows, columns, diagonals)
 * - Various fabricated confidence scores (18-68)
 */
const mockCandidates: SuppressibleCandidate[] = [
  // Dense regions from edge detection (typical output)
  { id: 'dense-0', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.42, confidence: 38, region: REGION(0, 0, 400, 300) },
  { id: 'dense-1', fileId: 'photo-1', geometryClass: 'probable_obstruction', geometryScore: 0.31, confidence: 34, region: REGION(100, 100, 200, 150) },
  { id: 'dense-2', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.35, confidence: 42, region: REGION(50, 50, 350, 280) },
  { id: 'dense-3', fileId: 'photo-1', geometryClass: 'probable_obstruction', geometryScore: 0.22, confidence: 26, region: REGION(300, 200, 100, 80) },
  { id: 'dense-4', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.28, confidence: 30, region: REGION(200, 150, 250, 200) },
  { id: 'dense-5', fileId: 'photo-1', geometryClass: 'probable_obstruction', geometryScore: 0.18, confidence: 22, region: REGION(400, 300, 80, 60) },
  { id: 'dense-6', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.15, confidence: 18, region: REGION(100, 200, 300, 250) },
  { id: 'dense-7', fileId: 'photo-1', geometryClass: 'probable_obstruction', geometryScore: 0.12, confidence: 20, region: REGION(500, 400, 60, 50) },

  // Dominant lines classified as roof_plane
  { id: 'line-h1', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.38, confidence: 44, region: REGION(0, 100, 600, 20) },
  { id: 'line-h2', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.32, confidence: 38, region: REGION(0, 200, 500, 15) },
  { id: 'line-h3', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.25, confidence: 32, region: REGION(100, 300, 400, 12) },
  { id: 'line-v1', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.29, confidence: 36, region: REGION(200, 0, 15, 400) },
  { id: 'line-v2', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.21, confidence: 28, region: REGION(400, 50, 12, 350) },
  { id: 'line-d1', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.19, confidence: 24, region: REGION(0, 0, 500, 400) },
  { id: 'line-d2', fileId: 'photo-1', geometryClass: 'probable_roof_plane', geometryScore: 0.14, confidence: 20, region: REGION(200, 0, 400, 500) },

  // Equipment anchors (low confidence from filename regex)
  { id: 'equip-0', fileId: 'photo-1', geometryClass: 'probable_equipment', geometryScore: 0.25, confidence: 30, region: REGION(250, 150, 100, 80) },
  { id: 'equip-1', fileId: 'photo-1', geometryClass: 'probable_equipment', geometryScore: 0.15, confidence: 22, region: REGION(450, 250, 60, 40) },

  // Ground noise (bottom of image)
  { id: 'noise-0', fileId: 'photo-1', geometryClass: 'probable_ground_noise', geometryScore: 0.10, confidence: 18, region: REGION(300, 800, 100, 80) },
  { id: 'noise-1', fileId: 'photo-1', geometryClass: 'probable_ground_noise', geometryScore: 0.08, confidence: 15, region: REGION(500, 850, 80, 60) },

  // Unknown class (edge map summary, etc.)
  { id: 'unknown-0', fileId: 'photo-1', geometryClass: 'unknown', geometryScore: 0.05, confidence: 12, region: REGION(100, 400, 200, 150) },
  { id: 'unknown-1', fileId: 'photo-1', geometryClass: 'unknown', geometryScore: 0.03, confidence: 8, region: REGION(400, 500, 150, 100) },
];

/* ── Run suppression ─────────────────────────────────────────────────────── */

console.log('═══════════════════════════════════════════════════════════════');
console.log('  BEFORE/AFTER EVIDENCE: Candidate Suppression Pipeline');
console.log('═══════════════════════════════════════════════════════════════');
console.log();

// BEFORE: all candidates pass through unchecked
console.log(`BEFORE (no suppression):`);
console.log(`  Total candidates: ${mockCandidates.length}`);
const beforeByClass = new Map<string, number>();
for (const c of mockCandidates) {
  beforeByClass.set(c.geometryClass, (beforeByClass.get(c.geometryClass) ?? 0) + 1);
}
for (const [cls, count] of beforeByClass) {
  console.log(`  ${cls}: ${count}`);
}
console.log();

// AFTER: with suppression
const result = suppressCandidates(mockCandidates);

console.log(`AFTER (with suppression):`);
console.log(`  Total trusted: ${result.trustedCount}`);
console.log(`  Total suppressed: ${result.suppressedCount}`);
console.log();

const afterByClass = new Map<string, { trusted: number; suppressed: number }>();
for (const entry of result.entries) {
  const existing = afterByClass.get(entry.candidate.geometryClass) ?? { trusted: 0, suppressed: 0 };
  if (entry.disposition === 'trusted') existing.trusted++;
  else existing.suppressed++;
  afterByClass.set(entry.candidate.geometryClass, existing);
}

console.log('  By class:');
for (const [cls, counts] of afterByClass) {
  console.log(`    ${cls}: ${counts.trusted} trusted, ${counts.suppressed} suppressed`);
}
console.log();

console.log('  Suppression reasons:');
for (const entry of result.entries) {
  if (entry.disposition === 'suppressed') {
    console.log(`    ${entry.candidate.id}: ${entry.suppressionReason}`);
  }
}
console.log();

console.log('  Per-file counts:');
for (const [fileId, counts] of Object.entries(result.perFileCounts)) {
  console.log(`    ${fileId}: ${counts.trusted} trusted, ${counts.suppressed} suppressed`);
}
console.log();

// Visual targets check
const targets: Record<string, number> = {
  probable_roof_plane: 4,
  probable_obstruction: 8,
  probable_equipment: 4,
};
console.log('  Visual target check:');
for (const [cls, target] of Object.entries(targets)) {
  const actual = afterByClass.get(cls)?.trusted ?? 0;
  const status = actual <= target ? '✓ PASS' : '✗ FAIL';
  console.log(`    ${cls}: ${actual} ≤ ${target} ${status}`);
}
const totalTrusted = result.trustedCount;
const totalStatus = totalTrusted <= 16 ? '✓ PASS' : '✗ FAIL';
console.log(`    TOTAL: ${totalTrusted} ≤ 16 ${totalStatus}`);
console.log();

console.log('═══════════════════════════════════════════════════════════════');
