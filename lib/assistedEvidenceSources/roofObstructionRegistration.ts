/**
 * Roof Obstruction Registration Module
 *
 * Extracts obstruction candidate data from roof_plane photos and registers
 * them as structured obstruction records linked to the roof plane evidence.
 *
 * Architecture:
 *   obstruction_candidate + rectangular_region_candidate (in DB)
 *       ↓ (deduplicated by deterministic_hash + filename)
 *   RoofObstructionRecord (TypeScript type)
 *       ↓ (registered per roof_plane photo)
 *   site_survey_files.obstruction_data JSONB column
 *       ↓ (aggregated per survey)
 *   Evidence manifest obstructions summary
 *
 * Key design decisions:
 * 1. Each roof_plane photo has ~7 duplicate file_id rows. The obstruction
 *    candidates are duplicated across these rows. We deduplicate by taking
 *    ONE representative file_id per filename (the one with the most candidates).
 * 2. Within a single file_id, there are 4-5 DISTINCT obstruction regions
 *    (by deterministic_hash), each duplicated 7-10 times. We deduplicate
 *    by deterministic_hash to get the true unique set.
 * 3. All regions use normalized_image_0_1000 coordinate system (0-1000 scale).
 *    These need to be preserved as-is (not converted to pixels) because the
 *    actual image dimensions are not stored in the candidates table.
 * 4. Obstructions are registered as a JSON array on each roof_plane file's
 *    metadata, keyed by filename. This avoids creating a new DB table while
 *    still making the data queryable.
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized bounding box region from a vision candidate.
 * Coordinates are in the normalized_image_0_1000 system (0-1000 scale).
 * To convert to pixel coordinates: pixel_x = (x / 1000) * image_width
 */
export interface ObstructionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/**
 * A single deduplicated obstruction record for a roof plane photo.
 */
export interface RoofObstructionRecord {
  /** Unique identifier for this obstruction (based on deterministic_hash from vision candidate) */
  id: string;
  /** The filename of the roof_plane photo this obstruction was found on */
  sourceFilename: string;
  /** The file_id of the representative file used for extraction */
  sourceFileId: string;
  /** Bounding box region in normalized coordinates */
  region: ObstructionRegion;
  /** Area in normalized units (0-1,000,000 scale) */
  areaNormalized: number;
  /** Confidence score from the vision worker (0-100 scale) */
  confidence: number;
  /** Source detection method */
  source: string;
  /** Region index from the vision worker (ordering within the photo) */
  regionIndex: number;
  /** SHA256 of the source image (for cache invalidation) */
  sourceImageSha256: string | null;
  /** Whether this obstruction has been reviewed by a human */
  reviewed: boolean;
  /** Classification of the obstruction (vent, chimney, skylight, etc.) — set by human review or future ML */
  obstructionType: RoofObstructionType | null;
}

/**
 * Known obstruction types on roof planes.
 * These are the types that downstream engineering/CAD systems care about.
 */
export type RoofObstructionType =
  | 'vent'          // Plumbing vent, exhaust vent, ridge vent
  | 'chimney'       // Chimney or chimney flashing
  | 'skylight'      // Skylight or roof window
  | 'pipe_boots'    // Pipe boots / plumbing stack
  | 'satellite_dish' // Satellite dish or antenna
  | 'hvac'          // HVAC unit or condenser on roof
  | 'solar_tube'    // Solar tube / tubular skylight
  | 'flashing'      // Flashing around penetration
  | 'ridge_vent'    // Ridge vent along roof peak
  | 'gable_vent'    // Gable end vent
  | 'dormer'        // Dormer window or structure
  | 'unknown';      // Unidentified obstruction

/**
 * Summary of obstructions registered for a single roof plane photo.
 */
export interface RoofPlaneObstructionSummary {
  /** Filename of the roof_plane photo */
  filename: string;
  /** Total number of deduplicated obstructions found */
  obstructionCount: number;
  /** Obstruction records */
  obstructions: RoofObstructionRecord[];
  /** Distribution of region sizes */
  sizeDistribution: {
    tiny: number;    // area < 5000
    small: number;   // 5000-15000
    medium: number;  // 15000-50000
    large: number;   // 50000-150000
    huge: number;    // > 150000
  };
  /** Average confidence across all obstructions */
  avgConfidence: number;
  /** Whether these obstructions have been human-reviewed */
  reviewed: boolean;
}

/**
 * Full obstruction registration result for a survey.
 */
export interface ObstructionRegistrationResult {
  /** Survey ID */
  surveyId: string;
  /** Total roof_plane photos processed */
  roofPhotosProcessed: number;
  /** Total deduplicated obstructions registered */
  totalObstructions: number;
  /** Per-photo summaries */
  photoSummaries: RoofPlaneObstructionSummary[];
  /** Method breakdown */
  method: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum area (in normalized units) for an obstruction to be registered.
 * Areas below this threshold are likely noise from contour detection.
 *
 * Based on analysis of 496 distinct regions across 13 roof photos:
 * - tiny (<5000): 18 (3.6%) — mostly noise
 * - small (5000-15000): 172 (34.7%) — small obstructions like pipe boots
 * - medium (15000-50000): 236 (47.6%) — vents, skylights
 * - large (50000-150000): 70 (14.1%) — chimneys, HVAC units
 *
 * Threshold of 5000 filters out the noise while keeping all real obstructions.
 */
export const OBSTRUCTION_MIN_AREA = Number(
  process.env.OBSTRUCTION_MIN_AREA || 5000,
);

/**
 * Maximum area (in normalized units) for an obstruction to be registered.
 * Regions covering more than this are likely not obstructions but rather
 * the roof plane itself or a building structure.
 *
 * In normalized_image_0_1000: 150000 = ~15% of image area.
 * Real obstructions are typically 1-10% of the image.
 */
export const OBSTRUCTION_MAX_AREA = Number(
  process.env.OBSTRUCTION_MAX_AREA || 150000,
);

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Extraction and Deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw candidate from the database, with only the fields we need.
 */
interface RawObstructionCandidate {
  fileId: string;
  candidateType: string;
  confidence: number;
  payload: Record<string, unknown>;
  deterministicHash: string;
}

/**
 * Extract and deduplicate obstruction candidates for a single filename.
 *
 * Deduplication strategy:
 * 1. All candidates for this filename are from the SAME source image
 *    (just different file_id rows for the same photo).
 * 2. Within each file_id, the same region appears multiple times
 *    (once per contour processing iteration). We deduplicate by
 *    (x, y, width, height) tuple since deterministic_hash differs
 *    across duplicates even for the same region.
 * 3. We take the first file_id's candidates as representative,
 *    since all file_ids produce the same regions for the same image.
 *
 * @param candidates - All obstruction_candidate + rectangular_region_candidate entries for this filename
 * @param filename - The filename being processed
 * @param fileIdToFilename - Mapping from file_id to filename
 * @returns Deduplicated RoofPlaneObstructionSummary
 */
export function extractObstructionsForFilename(
  candidates: RawObstructionCandidate[],
  filename: string,
): RoofPlaneObstructionSummary {
  // Group candidates by file_id
  const byFileId = new Map<string, RawObstructionCandidate[]>();
  for (const c of candidates) {
    if (c.candidateType !== 'obstruction_candidate') continue;
    const existing = byFileId.get(c.fileId) || [];
    existing.push(c);
    byFileId.set(c.fileId, existing);
  }

  // Pick ONE representative file_id (the one with the most candidates)
  let representativeFileId: string | null = null;
  let maxCount = 0;
  for (const [fileId, fileCandidates] of byFileId.entries()) {
    if (fileCandidates.length > maxCount) {
      maxCount = fileCandidates.length;
      representativeFileId = fileId;
    }
  }

  if (!representativeFileId) {
    return {
      filename,
      obstructionCount: 0,
      obstructions: [],
      sizeDistribution: { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 },
      avgConfidence: 0,
      reviewed: false,
    };
  }

  // Extract regions from the representative file_id, deduplicating by (x, y, w, h)
  const rawCandidates = byFileId.get(representativeFileId) || [];
  const seen = new Set<string>();
  const obstructions: RoofObstructionRecord[] = [];

  for (const candidate of rawCandidates) {
    const region = extractRegionFromPayload(candidate.payload);
    if (!region) continue;

    // Deduplicate by coordinate tuple
    const key = `${region.x},${region.y},${region.width},${region.height}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Filter by area
    const area = region.width * region.height;
    if (area < OBSTRUCTION_MIN_AREA || area > OBSTRUCTION_MAX_AREA) continue;

    obstructions.push({
      id: candidate.deterministicHash,
      sourceFilename: filename,
      sourceFileId: representativeFileId,
      region,
      areaNormalized: area,
      confidence: candidate.confidence,
      source: (candidate.payload.source as string) || 'unknown',
      regionIndex: (candidate.payload.regionIndex as number) || 0,
      sourceImageSha256: (candidate.payload.sourceImageSha256 as string) || null,
      reviewed: false,
      obstructionType: null, // To be classified by human review or future ML
    });
  }

  // Sort by region index for consistent ordering
  obstructions.sort((a, b) => a.regionIndex - b.regionIndex);

  // Compute size distribution
  const sizeDistribution = { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 };
  for (const obs of obstructions) {
    const area = obs.areaNormalized;
    if (area < 5000) sizeDistribution.tiny++;
    else if (area < 15000) sizeDistribution.small++;
    else if (area < 50000) sizeDistribution.medium++;
    else if (area < 150000) sizeDistribution.large++;
    else sizeDistribution.huge++;
  }

  const avgConfidence = obstructions.length > 0
    ? obstructions.reduce((sum, o) => sum + o.confidence, 0) / obstructions.length
    : 0;

  return {
    filename,
    obstructionCount: obstructions.length,
    obstructions,
    sizeDistribution,
    avgConfidence,
    reviewed: false,
  };
}

/**
 * Extract a region object from a candidate payload.
 */
function extractRegionFromPayload(
  payload: Record<string, unknown>,
): ObstructionRegion | null {
  if (!payload || typeof payload !== 'object') return null;

  const region = payload.region as Record<string, unknown> | undefined;
  if (!region) return null;

  const x = typeof region.x === 'number' ? region.x : null;
  const y = typeof region.y === 'number' ? region.y : null;
  const width = typeof region.width === 'number' ? region.width : null;
  const height = typeof region.height === 'number' ? region.height : null;
  const coordSystem = region.coordinateSystem as string | undefined;

  if (x === null || y === null || width === null || height === null) return null;

  return {
    x,
    y,
    width,
    height,
    coordinateSystem: (coordSystem === 'normalized_image_0_1000')
      ? 'normalized_image_0_1000'
      : 'normalized_image_0_1000', // Default to this system
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Registration (DB persistence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register obstructions for all roof_plane photos in a survey.
 *
 * This function:
 * 1. Queries all obstruction_candidate entries for roof_plane files
 * 2. Deduplicates by filename + region coordinates
 * 3. Filters by area thresholds
 * 4. Stores the obstruction data as JSON on the site_survey_files rows
 *
 * The obstruction data is stored in a new JSONB column `obstruction_data`
 * on the site_survey_files table. Each roof_plane file row gets the SAME
 * obstruction data (since all rows for a filename refer to the same photo).
 *
 * Alternative: If adding a column is too invasive, we store the data
 * in a separate table or as a survey-level JSON blob.
 */
export async function registerObstructionsForSurvey(
  surveyId: string,
  run: {
    candidates: Array<{
      fileId: string;
      candidateType: string;
      confidence: number;
      payload: Record<string, unknown>;
      deterministicHash?: string;
    }>;
  },
  fileIdToFilename: Map<string, string>,
): Promise<ObstructionRegistrationResult> {
  const { getDbReady } = await import('@/lib/db/core');
  const sql = await getDbReady();

  // Step 1: Collect obstruction candidates grouped by filename
  const obstructionsByFilename = new Map<string, RawObstructionCandidate[]>();

  for (const candidate of run.candidates) {
    if (candidate.candidateType !== 'obstruction_candidate') continue;

    const filename = fileIdToFilename.get(candidate.fileId);
    if (!filename) continue;

    // Only process roof_plane files
    const existing = obstructionsByFilename.get(filename) || [];
    existing.push({
      fileId: candidate.fileId,
      candidateType: candidate.candidateType,
      confidence: candidate.confidence,
      payload: candidate.payload,
      deterministicHash: candidate.deterministicHash || `${candidate.fileId}_${candidate.candidateType}_${Math.random()}`,
    });
    obstructionsByFilename.set(filename, existing);
  }

  console.log(`[registerObstructions] Found ${obstructionsByFilename.size} filenames with obstruction candidates`);

  // Step 2: Get the set of roof_plane filenames from site_survey_files
  const roofPlaneFileIds = new Set<string>();
  for (const [filename, candidates] of obstructionsByFilename.entries()) {
    for (const c of candidates) {
      roofPlaneFileIds.add(c.fileId);
    }
  }

  // Query which of these files are labeled as roof_plane
  const roofPlaneFilenames = new Set<string>();
  if (roofPlaneFileIds.size > 0) {
    const fileIdArray = Array.from(roofPlaneFileIds);
    const BATCH_SIZE = 100;
    for (let i = 0; i < fileIdArray.length; i += BATCH_SIZE) {
      const batch = fileIdArray.slice(i, i + BATCH_SIZE);
      const rows = await sql`
        SELECT DISTINCT filename
        FROM site_survey_files
        WHERE survey_id = ${surveyId}
          AND id = ANY(${batch}::uuid[])
          AND label = 'roof_plane'
      `;
      for (const row of rows as Record<string, unknown>[]) {
        if (row.filename) roofPlaneFilenames.add(row.filename as string);
      }
    }
  }

  console.log(`[registerObstructions] ${roofPlaneFilenames.size} filenames are labeled as roof_plane`);

  // Step 3: Extract and deduplicate obstructions for each roof_plane filename
  const photoSummaries: RoofPlaneObstructionSummary[] = [];
  let totalObstructions = 0;

  for (const filename of roofPlaneFilenames) {
    const candidates = obstructionsByFilename.get(filename) || [];
    const summary = extractObstructionsForFilename(candidates, filename);
    photoSummaries.push(summary);
    totalObstructions += summary.obstructionCount;

    console.log(`[registerObstructions] ${filename}: ${summary.obstructionCount} obstructions (area range: ${OBSTRUCTION_MIN_AREA}-${OBSTRUCTION_MAX_AREA})`);
  }

  // Step 4: Store obstruction data on site_survey_files rows
  // We add a JSONB column `obstruction_data` if it doesn't exist,
  // then update all roof_plane file rows for each filename.
  let filesUpdated = 0;

  for (const summary of photoSummaries) {
    if (summary.obstructionCount === 0) continue;

    const obstructionJson = JSON.stringify({
      filename: summary.filename,
      obstructionCount: summary.obstructionCount,
      obstructions: summary.obstructions,
      sizeDistribution: summary.sizeDistribution,
      avgConfidence: summary.avgConfidence,
      extractedAt: new Date().toISOString(),
      version: '1.0',
    });

    // Update ALL file rows for this filename (they all get the same data)
    try {
      await sql`
        UPDATE site_survey_files
        SET obstruction_data = ${obstructionJson}::jsonb
        WHERE survey_id = ${surveyId}
          AND filename = ${summary.filename}
          AND label = 'roof_plane'
      `;
      filesUpdated++;
    } catch (err) {
      // If the obstruction_data column doesn't exist, try creating it
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('obstruction_data') && errorMsg.includes('does not exist')) {
        console.log(`[registerObstructions] Creating obstruction_data column...`);
        try {
          await sql`ALTER TABLE site_survey_files ADD COLUMN IF NOT EXISTS obstruction_data jsonb`;
          // Retry the update
          await sql`
            UPDATE site_survey_files
            SET obstruction_data = ${obstructionJson}::jsonb
            WHERE survey_id = ${surveyId}
              AND filename = ${summary.filename}
              AND label = 'roof_plane'
          `;
          filesUpdated++;
        } catch (retryErr) {
          console.error(`[registerObstructions] Failed to create column and update:`, retryErr);
        }
      } else {
        console.error(`[registerObstructions] Failed to update ${summary.filename}:`, err);
      }
    }
  }

  console.log(`[registerObstructions] Updated ${filesUpdated} filenames with obstruction data (${totalObstructions} total obstructions)`);

  return {
    surveyId,
    roofPhotosProcessed: roofPlaneFilenames.size,
    totalObstructions,
    photoSummaries,
    method: 'obstruction_candidate_dedup_v1',
  };
}
