// ============================================================================
// lib/siteSurveys/unifiedGeometry/unifiedArtifactStore.ts
//
// Unified Artifact Store — the primary persistence layer for querying
// UnifiedGeometryArtifact instances from the `unified_geometry_artifacts` table.
//
// This module is the preferred way to fetch artifacts for a survey.
// Routes should call getUnifiedArtifactsForSurvey() first, and only fall
// back to on-the-fly adaptation from source tables if the unified table
// has no data for the survey (e.g., migration 080 backfill hasn't run yet).
//
// ARCHITECTURE:
//   PRIMARY:   unified_geometry_artifacts table (this module)
//   FALLBACK:  On-the-fly adaptation from Pipeline A + Pipeline B source tables
//
// MIGRATION DRIFT GUARD:
//   The `obstruction_metadata` column was added in Migration 081, after the
//   base table was created in Migration 079b. If 079b was applied but 081
//   was not, SELECT queries referencing `obstruction_metadata` will fail with
//   "column does not exist". To prevent this, both query functions check for
//   the column's existence before including it in the SELECT. If the column
//   is absent, the query omits it and obstructionMetadata defaults to null.
//
// NEON DRIVER QUIRKS:
//   - Must use RETURNING on all UPDATE queries
//   - TEXT[] columns receive JS arrays directly, NOT JSON.stringify'd arrays
//   - JSONB columns return parsed objects
// ============================================================================

import { getDbReady } from '@/lib/db/core';
import type { UnifiedGeometryArtifact, UnifiedGeometryClass, GeometrySourcePipeline, ObstructionMetadata } from './types';
import type { UnifiedGeometryAuthorityState } from './authority';
import { getAuthorityForState } from './authority';

// ────────────────────────────────────────────────────────────────────────────
// DB Row Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Base row type — columns present since Migration 079b.
 * Used when the `obstruction_metadata` column does not yet exist (pre-081).
 */
interface UnifiedArtifactBaseRow {
  id: string;
  survey_id: string;
  geometry_class: string;
  authority_state: string;
  authority: unknown;       // JSONB → parsed object
  provenance: unknown;      // JSONB → parsed object
  confidence: number;
  label: string;
  limitations: unknown;     // TEXT[] → JS array
  geometry_data: unknown;   // JSONB → parsed UnifiedGeometryArtifact
  review_state: string;
  review_notes: string | null;
  priority: string;
  mock_artifact: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Full row type — includes obstruction_metadata column (Migration 081).
 * Used when the column existence check passes.
 */
interface UnifiedArtifactRow extends UnifiedArtifactBaseRow {
  obstruction_metadata: unknown;  // JSONB → parsed ObstructionMetadata | null
}

// ────────────────────────────────────────────────────────────────────────────
// Column Existence Check — Migration Drift Guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether the `obstruction_metadata` column exists on the
 * `unified_geometry_artifacts` table. This column is added by Migration 081.
 *
 * If the table was created (079b) but the column hasn't been added yet,
 * SELECT queries that reference it will fail with "column does not exist".
 * This check allows us to degrade gracefully by omitting the column from
 * the SELECT when it's not yet present.
 *
 * Results are cached for the lifetime of the serverless function invocation
 * to avoid repeated information_schema queries on every call.
 */
let _obstructionMetadataColumnExists: boolean | null = null;

async function checkObstructionMetadataColumn(
  sql: ReturnType<typeof import('@neondatabase/serverless')['neon']>,
): Promise<boolean> {
  // Return cached result if available
  if (_obstructionMetadataColumnExists !== null) {
    return _obstructionMetadataColumnExists;
  }

  try {
    const result = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'unified_geometry_artifacts'
        AND column_name = 'obstruction_metadata'
    `;
    _obstructionMetadataColumnExists = Array.isArray(result) && result.length > 0;
  } catch {
    // If the check fails (e.g., permission issue), assume column doesn't exist
    _obstructionMetadataColumnExists = false;
  }

  return _obstructionMetadataColumnExists;
}

/**
 * Reset the cached column existence check. Exposed for testing.
 */
export function _resetObstructionMetadataColumnCache(): void {
  _obstructionMetadataColumnExists = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Query: Get all unified artifacts for a survey
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get all UnifiedGeometryArtifact instances for a survey from the
 * unified_geometry_artifacts table.
 *
 * Returns an empty array if:
 *   - The table doesn't exist yet
 *   - There are no artifacts for the given survey
 *
 * The `geometry_data` JSONB column stores the full artifact as JSON.
 * If `geometry_data` is null (e.g., from backfill that only stored metadata),
 * the artifact is reconstructed from the row columns.
 *
 * MIGRATION DRIFT GUARD: If the `obstruction_metadata` column does not exist
 * (Migration 081 not yet applied), the SELECT omits it and
 * obstructionMetadata defaults to null on each artifact. This prevents
 * runtime errors when the table exists but the column hasn't been added yet.
 */
export async function getUnifiedArtifactsForSurvey(
  surveyId: string,
): Promise<UnifiedGeometryArtifact[]> {
  try {
    const sql = await getDbReady();

    // Check if the table exists first (graceful degradation)
    const tableCheck = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'unified_geometry_artifacts'
    `;
    if (tableCheck.length === 0) {
      return [];
    }

    // Check if the obstruction_metadata column exists (Migration 081 guard)
    const hasObstructionColumn = await checkObstructionMetadataColumn(sql);

    if (hasObstructionColumn) {
      const rows = await sql`
        SELECT
          id, survey_id, geometry_class, authority_state, authority,
          provenance, confidence, label, limitations, geometry_data,
          obstruction_metadata,
          review_state, review_notes, priority, mock_artifact,
          created_at, updated_at
        FROM unified_geometry_artifacts
        WHERE survey_id = ${surveyId}
        ORDER BY created_at ASC
      `;
      return (rows as UnifiedArtifactRow[]).map(rowToArtifact);
    } else {
      const rows = await sql`
        SELECT
          id, survey_id, geometry_class, authority_state, authority,
          provenance, confidence, label, limitations, geometry_data,
          review_state, review_notes, priority, mock_artifact,
          created_at, updated_at
        FROM unified_geometry_artifacts
        WHERE survey_id = ${surveyId}
        ORDER BY created_at ASC
      `;
      return (rows as UnifiedArtifactBaseRow[]).map(rowToArtifactBase);
    }
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to query unified_geometry_artifacts:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry Data Sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a geometry_data JSONB value before it's used to reconstruct an
 * artifact. This prevents malformed string values (unescaped newlines,
 * backslashes, control characters) from breaking JSON serialization when
 * the bundle is sent as an HTTP response.
 *
 * The root cause of "Unterminated string in JSON at position 33M" errors is
 * that some geometry_data JSONB fields contain string values with characters
 * that are invalid in JSON strings (raw newlines \n, tabs \t, or unescaped
 * backslashes). While PostgreSQL JSONB stores these fine, JavaScript's
 * JSON.stringify() will produce malformed output if the JS string contains
 * such characters outside of proper JSON escape sequences.
 *
 * This function walks the object recursively and sanitizes all string values.
 */
function sanitizeGeometryData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Replace characters that break JSON string serialization
    // eslint-disable-next-line no-control-regex
    return obj
      .replace(/\\/g, '\\\\')     // escape backslashes first
      .replace(/"/g, '\\"')       // escape double quotes
      .replace(/\n/g, '\\n')      // escape newlines
      .replace(/\r/g, '\\r')      // escape carriage returns
      .replace(/\t/g, '\\t')      // escape tabs
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]/g, (ch) => {
        // Replace other control characters with Unicode escape
        const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
        return `\\u${hex}`;
      });
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeGeometryData);
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = sanitizeGeometryData(value);
    }
    return result;
  }
  // Numbers, booleans — pass through unchanged
  return obj;
}

/**
 * Re-serialize and re-parse geometry_data to guarantee valid JSON.
 *
 * If geometry_data contains string values with characters that would break
 * JSON.stringify(), this function catches the error and falls back to a
 * recursive sanitization pass, then tries again.
 *
 * Returns the parsed object if successful, or null if the data is
 * fundamentally unparseable (in which case the artifact is reconstructed
 * from row columns instead).
 */
function safeReconstructGeometryData(geometryData: unknown): Record<string, unknown> | null {
  if (!geometryData || typeof geometryData !== 'object') return null;

  // First, try a round-trip: JSON.stringify → JSON.parse.
  // If the data is already clean (the common case), this is fast.
  try {
    const serialized = JSON.stringify(geometryData);
    const reparsed = JSON.parse(serialized);
    return reparsed as Record<string, unknown>;
  } catch {
    // stringify failed — the data has malformed string values.
    // Sanitize and retry.
    console.warn(
      '[unifiedArtifactStore] geometry_data round-trip failed, sanitizing...',
    );
  }

  try {
    const sanitized = sanitizeGeometryData(geometryData);
    const serialized = JSON.stringify(sanitized);
    const reparsed = JSON.parse(serialized);
    return reparsed as Record<string, unknown>;
  } catch (err) {
    console.error(
      '[unifiedArtifactStore] geometry_data sanitization failed, discarding:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}


// ────────────────────────────────────────────────────────────────────────────
// Row → Artifact Conversion
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a database row (WITH obstruction_metadata) to a UnifiedGeometryArtifact.
 *
 * If `geometry_data` is populated (preferred), it contains the full artifact
 * stored as JSONB — this is the most accurate representation since it preserves
 * all nested fields (authority, provenance, geometry fields, etc.).
 *
 * If `geometry_data` is null (e.g., from Migration 080 backfill that only stored
 * metadata), we reconstruct from the row columns.
 *
 * IMPORTANT: geometry_data is sanitized via safeReconstructGeometryData() to
 * prevent malformed string values (unescaped newlines, backslashes, etc.) from
 * breaking JSON serialization when the bundle is sent as an HTTP response.
 */
function rowToArtifact(row: UnifiedArtifactRow): UnifiedGeometryArtifact {
  // Preferred path: full artifact stored in geometry_data (with safe reconstruction)
  const stored = safeReconstructGeometryData(row.geometry_data);
  if (stored) {
    // The stored artifact should have all the fields we need.
    // Ensure critical fields are present and consistent.
    return {
      id: (stored.id as string) ?? row.id,
      surveyId: (stored.surveyId as string) ?? row.survey_id,
      geometryClass: (stored.geometryClass as UnifiedGeometryClass) ?? row.geometry_class as UnifiedGeometryClass,
      authority: (stored.authority as UnifiedGeometryArtifact['authority']) ??
        rowToAuthority(row),
      provenance: (stored.provenance as UnifiedGeometryArtifact['provenance']) ??
        rowToProvenance(row),
      confidence: (stored.confidence as number) ?? row.confidence,
      label: (stored.label as string) ?? row.label,
      limitations: Array.isArray(stored.limitations)
        ? stored.limitations as string[]
        : row.limitations as string[] ?? [],
      bbox: (stored.bbox as UnifiedGeometryArtifact['bbox']) ?? null,
      polygon: (stored.polygon as UnifiedGeometryArtifact['polygon']) ?? null,
      lineSegment: (stored.lineSegment as UnifiedGeometryArtifact['lineSegment']) ?? null,
      center: (stored.center as UnifiedGeometryArtifact['center']) ?? null,
      planeType: (stored.planeType as UnifiedGeometryArtifact['planeType']) ?? null,
      pitchDegrees: (stored.pitchDegrees as number | null) ?? null,
      azimuthDegrees: (stored.azimuthDegrees as number | null) ?? null,
      normalVector: (stored.normalVector as UnifiedGeometryArtifact['normalVector']) ?? null,
      areaSqM: (stored.areaSqM as number | null) ?? null,
      inlierCount: (stored.inlierCount as number | null) ?? null,
      totalPoints: (stored.totalPoints as number | null) ?? null,
      lineSubtype: (stored.lineSubtype as UnifiedGeometryArtifact['lineSubtype']) ?? null,
      estimatedLengthM: (stored.estimatedLengthM as number | null) ?? null,
      obstructionSubtype: (stored.obstructionSubtype as UnifiedGeometryArtifact['obstructionSubtype']) ?? null,
      radiusM: (stored.radiusM as number | null) ?? null,
      setbackM: (stored.setbackM as number | null) ?? null,
      heightFt: (stored.heightFt as number | null) ?? null,
      roofPlaneId: (stored.roofPlaneId as string | null) ?? null,
      cadImpact: (stored.cadImpact as UnifiedGeometryArtifact['cadImpact']) ?? null,
      electricalSubtype: (stored.electricalSubtype as UnifiedGeometryArtifact['electricalSubtype']) ?? null,
      story: (stored.story as number | null) ?? null,
      isPrimaryInterconnect: (stored.isPrimaryInterconnect as boolean | null) ?? null,
      depthResolution: (stored.depthResolution as UnifiedGeometryArtifact['depthResolution']) ?? null,
      depthMetric: (stored.depthMetric as string | null) ?? null,
      consensusPhotoCount: (stored.consensusPhotoCount as number | null) ?? null,
      segmentationClass: (stored.segmentationClass as string | null) ?? null,
      segmentationBackend: (stored.segmentationBackend as UnifiedGeometryArtifact["segmentationBackend"]) ?? null,
      facadeSubtype: (stored.facadeSubtype as UnifiedGeometryArtifact["facadeSubtype"]) ?? null,
      siteContextSubtype: (stored.siteContextSubtype as UnifiedGeometryArtifact["siteContextSubtype"]) ?? null,
      conditionFlags: (stored.conditionFlags as UnifiedGeometryArtifact["conditionFlags"]) ?? null,
      isOccluder: (stored.isOccluder as UnifiedGeometryArtifact["isOccluder"]) ?? null,
      reviewState: (stored.reviewState as UnifiedGeometryArtifact['reviewState']) ?? rowToReviewState(row),
      reviewNotes: (stored.reviewNotes as string | null) ?? row.review_notes ?? null,
      priority: (stored.priority as UnifiedGeometryArtifact['priority']) ?? rowToPriority(row),
      stageTimings: (stored.stageTimings as Record<string, number> | null) ?? null,
      isSynthetic: (stored.isSynthetic as boolean) ?? false,
      obstructionMetadata: (stored.obstructionMetadata as ObstructionMetadata | null) ??
        (row.obstruction_metadata as ObstructionMetadata | null) ?? null,
    };
  }

  // Fallback path: reconstruct from row columns
  // This happens for backfilled rows where geometry_data may contain only
  // metadata (originalCandidateId, candidateType, etc.), not a full artifact.
  return {
    id: row.id,
    surveyId: row.survey_id,
    geometryClass: row.geometry_class as UnifiedGeometryClass,
    authority: rowToAuthority(row),
    provenance: rowToProvenance(row),
    confidence: row.confidence,
    label: row.label,
    limitations: Array.isArray(row.limitations) ? row.limitations as string[] : [],
    bbox: null,
    polygon: null,
    lineSegment: null,
    center: null,
    planeType: null,
    pitchDegrees: null,
    azimuthDegrees: null,
    normalVector: null,
    areaSqM: null,
    inlierCount: null,
    totalPoints: null,
    lineSubtype: null,
    estimatedLengthM: null,
    obstructionSubtype: null,
    radiusM: null,
    setbackM: null,
    heightFt: null,
    roofPlaneId: null,
    cadImpact: null,
    electricalSubtype: null,
    story: null,
    isPrimaryInterconnect: null,
    depthResolution: null,
    depthMetric: null,
    consensusPhotoCount: null,
    segmentationClass: null,
    segmentationBackend: null,
    facadeSubtype: null,
    siteContextSubtype: null,
    conditionFlags: null,
    isOccluder: null,
    reviewState: rowToReviewState(row),
    reviewNotes: row.review_notes ?? null,
    priority: rowToPriority(row),
    stageTimings: null,
    isSynthetic: false,
    obstructionMetadata: (row.obstruction_metadata as ObstructionMetadata | null) ?? null,
  };
}

/**
 * Convert a database row (WITHOUT obstruction_metadata) to a UnifiedGeometryArtifact.
 * Used when the obstruction_metadata column doesn't exist yet (pre-Migration 081).
 * obstructionMetadata is always null in this path.
 *
 * IMPORTANT: geometry_data is sanitized via safeReconstructGeometryData() to
 * prevent malformed string values from breaking JSON serialization.
 */
function rowToArtifactBase(row: UnifiedArtifactBaseRow): UnifiedGeometryArtifact {
  // Preferred path: full artifact stored in geometry_data (with safe reconstruction)
  const stored = safeReconstructGeometryData(row.geometry_data);
  if (stored) {

    // geometry_data may contain obstructionMetadata embedded in the JSONB
    // (e.g., from a backfill that stored the full artifact). Use it if present.
    return {
      id: (stored.id as string) ?? row.id,
      surveyId: (stored.surveyId as string) ?? row.survey_id,
      geometryClass: (stored.geometryClass as UnifiedGeometryClass) ?? row.geometry_class as UnifiedGeometryClass,
      authority: (stored.authority as UnifiedGeometryArtifact['authority']) ??
        rowToAuthorityBase(row),
      provenance: (stored.provenance as UnifiedGeometryArtifact['provenance']) ??
        rowToProvenanceBase(row),
      confidence: (stored.confidence as number) ?? row.confidence,
      label: (stored.label as string) ?? row.label,
      limitations: Array.isArray(stored.limitations)
        ? stored.limitations as string[]
        : row.limitations as string[] ?? [],
      bbox: (stored.bbox as UnifiedGeometryArtifact['bbox']) ?? null,
      polygon: (stored.polygon as UnifiedGeometryArtifact['polygon']) ?? null,
      lineSegment: (stored.lineSegment as UnifiedGeometryArtifact['lineSegment']) ?? null,
      center: (stored.center as UnifiedGeometryArtifact['center']) ?? null,
      planeType: (stored.planeType as UnifiedGeometryArtifact['planeType']) ?? null,
      pitchDegrees: (stored.pitchDegrees as number | null) ?? null,
      azimuthDegrees: (stored.azimuthDegrees as number | null) ?? null,
      normalVector: (stored.normalVector as UnifiedGeometryArtifact['normalVector']) ?? null,
      areaSqM: (stored.areaSqM as number | null) ?? null,
      inlierCount: (stored.inlierCount as number | null) ?? null,
      totalPoints: (stored.totalPoints as number | null) ?? null,
      lineSubtype: (stored.lineSubtype as UnifiedGeometryArtifact['lineSubtype']) ?? null,
      estimatedLengthM: (stored.estimatedLengthM as number | null) ?? null,
      obstructionSubtype: (stored.obstructionSubtype as UnifiedGeometryArtifact['obstructionSubtype']) ?? null,
      radiusM: (stored.radiusM as number | null) ?? null,
      setbackM: (stored.setbackM as number | null) ?? null,
      heightFt: (stored.heightFt as number | null) ?? null,
      roofPlaneId: (stored.roofPlaneId as string | null) ?? null,
      cadImpact: (stored.cadImpact as UnifiedGeometryArtifact['cadImpact']) ?? null,
      electricalSubtype: (stored.electricalSubtype as UnifiedGeometryArtifact['electricalSubtype']) ?? null,
      story: (stored.story as number | null) ?? null,
      isPrimaryInterconnect: (stored.isPrimaryInterconnect as boolean | null) ?? null,
      depthResolution: (stored.depthResolution as UnifiedGeometryArtifact['depthResolution']) ?? null,
      depthMetric: (stored.depthMetric as string | null) ?? null,
      consensusPhotoCount: (stored.consensusPhotoCount as number | null) ?? null,
      segmentationClass: (stored.segmentationClass as string | null) ?? null,
      segmentationBackend: (stored.segmentationBackend as UnifiedGeometryArtifact["segmentationBackend"]) ?? null,
      facadeSubtype: (stored.facadeSubtype as UnifiedGeometryArtifact["facadeSubtype"]) ?? null,
      siteContextSubtype: (stored.siteContextSubtype as UnifiedGeometryArtifact["siteContextSubtype"]) ?? null,
      conditionFlags: (stored.conditionFlags as UnifiedGeometryArtifact["conditionFlags"]) ?? null,
      isOccluder: (stored.isOccluder as UnifiedGeometryArtifact["isOccluder"]) ?? null,
      reviewState: (stored.reviewState as UnifiedGeometryArtifact['reviewState']) ?? rowToReviewStateBase(row),
      reviewNotes: (stored.reviewNotes as string | null) ?? row.review_notes ?? null,
      priority: (stored.priority as UnifiedGeometryArtifact['priority']) ?? rowToPriorityBase(row),
      stageTimings: (stored.stageTimings as Record<string, number> | null) ?? null,
      isSynthetic: (stored.isSynthetic as boolean) ?? false,
      // No obstruction_metadata column — fall back to embedded data in geometry_data
      obstructionMetadata: (stored.obstructionMetadata as ObstructionMetadata | null) ?? null,
    };
  }

  // Fallback path: reconstruct from row columns (no obstruction_metadata available)
  return {
    id: row.id,
    surveyId: row.survey_id,
    geometryClass: row.geometry_class as UnifiedGeometryClass,
    authority: rowToAuthorityBase(row),
    provenance: rowToProvenanceBase(row),
    confidence: row.confidence,
    label: row.label,
    limitations: Array.isArray(row.limitations) ? row.limitations as string[] : [],
    bbox: null,
    polygon: null,
    lineSegment: null,
    center: null,
    planeType: null,
    pitchDegrees: null,
    azimuthDegrees: null,
    normalVector: null,
    areaSqM: null,
    inlierCount: null,
    totalPoints: null,
    lineSubtype: null,
    estimatedLengthM: null,
    obstructionSubtype: null,
    radiusM: null,
    setbackM: null,
    heightFt: null,
    roofPlaneId: null,
    cadImpact: null,
    electricalSubtype: null,
    story: null,
    isPrimaryInterconnect: null,
    depthResolution: null,
    depthMetric: null,
    consensusPhotoCount: null,
    segmentationClass: null,
    segmentationBackend: null,
    facadeSubtype: null,
    siteContextSubtype: null,
    conditionFlags: null,
    isOccluder: null,
    reviewState: rowToReviewStateBase(row),
    reviewNotes: row.review_notes ?? null,
    priority: rowToPriorityBase(row),
    stageTimings: null,
    isSynthetic: false,
    obstructionMetadata: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Row Sub-field Reconstruction
// ────────────────────────────────────────────────────────────────────────────

function rowToAuthority(row: UnifiedArtifactRow): UnifiedGeometryArtifact['authority'] {
  const authorityObj = row.authority as Record<string, unknown> | null;
  const state = (authorityObj?.state as UnifiedGeometryAuthorityState) ?? row.authority_state as UnifiedGeometryAuthorityState;
  const isMock = (authorityObj?.mockArtifact as boolean) ?? row.mock_artifact;

  // Start from the canonical authority envelope for this state, then overlay
  // any stored values. This ensures all required fields are present.
  const base = getAuthorityForState(state, isMock);
  return {
    ...base,
    ...(authorityObj ? {
      state: (authorityObj.state as UnifiedGeometryAuthorityState) ?? base.state,
      reviewOnly: (authorityObj.reviewOnly as boolean) ?? base.reviewOnly,
      nonAuthoritative: (authorityObj.nonAuthoritative as boolean) ?? base.nonAuthoritative,
      cadMutationAllowed: (authorityObj.cadMutationAllowed as boolean) ?? base.cadMutationAllowed,
      permitGenerationAllowed: (authorityObj.permitGenerationAllowed as boolean) ?? base.permitGenerationAllowed,
      bomMutationAllowed: (authorityObj.bomMutationAllowed as boolean) ?? base.bomMutationAllowed,
      canonicalMutationAllowed: (authorityObj.canonicalMutationAllowed as boolean) ?? base.canonicalMutationAllowed,
      engineeringWorkflowMutationAllowed: (authorityObj.engineeringWorkflowMutationAllowed as boolean) ?? base.engineeringWorkflowMutationAllowed,
      mockArtifact: (authorityObj.mockArtifact as boolean) ?? base.mockArtifact,
      cadConsumable: (authorityObj.cadConsumable as boolean) ?? base.cadConsumable,
    } : {}),
  };
}

/** Base-row variant of rowToAuthority (no obstruction_metadata column). */
function rowToAuthorityBase(row: UnifiedArtifactBaseRow): UnifiedGeometryArtifact['authority'] {
  const authorityObj = row.authority as Record<string, unknown> | null;
  const state = (authorityObj?.state as UnifiedGeometryAuthorityState) ?? row.authority_state as UnifiedGeometryAuthorityState;
  const isMock = (authorityObj?.mockArtifact as boolean) ?? row.mock_artifact;
  const base = getAuthorityForState(state, isMock);
  return {
    ...base,
    ...(authorityObj ? {
      state: (authorityObj.state as UnifiedGeometryAuthorityState) ?? base.state,
      reviewOnly: (authorityObj.reviewOnly as boolean) ?? base.reviewOnly,
      nonAuthoritative: (authorityObj.nonAuthoritative as boolean) ?? base.nonAuthoritative,
      cadMutationAllowed: (authorityObj.cadMutationAllowed as boolean) ?? base.cadMutationAllowed,
      permitGenerationAllowed: (authorityObj.permitGenerationAllowed as boolean) ?? base.permitGenerationAllowed,
      bomMutationAllowed: (authorityObj.bomMutationAllowed as boolean) ?? base.bomMutationAllowed,
      canonicalMutationAllowed: (authorityObj.canonicalMutationAllowed as boolean) ?? base.canonicalMutationAllowed,
      engineeringWorkflowMutationAllowed: (authorityObj.engineeringWorkflowMutationAllowed as boolean) ?? base.engineeringWorkflowMutationAllowed,
      mockArtifact: (authorityObj.mockArtifact as boolean) ?? base.mockArtifact,
      cadConsumable: (authorityObj.cadConsumable as boolean) ?? base.cadConsumable,
    } : {}),
  };
}

function rowToProvenance(row: UnifiedArtifactRow): UnifiedGeometryArtifact['provenance'] {
  const provObj = row.provenance as Record<string, unknown> | null;
  return {
    sourcePipeline: (provObj?.sourcePipeline as GeometrySourcePipeline) ?? 'unknown' as GeometrySourcePipeline,
    toolName: (provObj?.toolName as string) ?? 'unknown',
    toolVersion: (provObj?.toolVersion as string) ?? '1.0.0',
    runHash: (provObj?.runHash as string) ?? 'unknown',
    sourceFileIds: Array.isArray(provObj?.sourceFileIds) ? provObj!.sourceFileIds as string[] : [],
    derivedFromArtifactIds: Array.isArray(provObj?.derivedFromArtifactIds) ? provObj!.derivedFromArtifactIds as string[] : [],
    createdAt: (provObj?.createdAt as string) ?? row.created_at,
    reviewedBy: (provObj?.reviewedBy as string | null) ?? null,
    reviewedAt: (provObj?.reviewedAt as string | null) ?? null,
    workerVersion: (provObj?.workerVersion as string | null) ?? null,
  };
}

/** Base-row variant of rowToProvenance (no obstruction_metadata column). */
function rowToProvenanceBase(row: UnifiedArtifactBaseRow): UnifiedGeometryArtifact['provenance'] {
  const provObj = row.provenance as Record<string, unknown> | null;
  return {
    sourcePipeline: (provObj?.sourcePipeline as GeometrySourcePipeline) ?? 'unknown' as GeometrySourcePipeline,
    toolName: (provObj?.toolName as string) ?? 'unknown',
    toolVersion: (provObj?.toolVersion as string) ?? '1.0.0',
    runHash: (provObj?.runHash as string) ?? 'unknown',
    sourceFileIds: Array.isArray(provObj?.sourceFileIds) ? provObj!.sourceFileIds as string[] : [],
    derivedFromArtifactIds: Array.isArray(provObj?.derivedFromArtifactIds) ? provObj!.derivedFromArtifactIds as string[] : [],
    createdAt: (provObj?.createdAt as string) ?? row.created_at,
    reviewedBy: (provObj?.reviewedBy as string | null) ?? null,
    reviewedAt: (provObj?.reviewedAt as string | null) ?? null,
    workerVersion: (provObj?.workerVersion as string | null) ?? null,
  };
}

function rowToReviewState(row: UnifiedArtifactRow): UnifiedGeometryArtifact['reviewState'] {
  switch (row.review_state) {
    case 'accepted': return 'accepted';
    case 'rejected': return 'rejected';
    default: return 'review_required';
  }
}

function rowToReviewStateBase(row: UnifiedArtifactBaseRow): UnifiedGeometryArtifact['reviewState'] {
  switch (row.review_state) {
    case 'accepted': return 'accepted';
    case 'rejected': return 'rejected';
    default: return 'review_required';
  }
}

function rowToPriority(row: UnifiedArtifactRow): UnifiedGeometryArtifact['priority'] {
  switch (row.priority) {
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}

function rowToPriorityBase(row: UnifiedArtifactBaseRow): UnifiedGeometryArtifact['priority'] {
  switch (row.priority) {
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Write: Persist an obstruction as a unified geometry artifact
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a single obstruction record as a unified geometry artifact.
 *
 * This is the dual-write target for Phase B of the obstruction_data migration.
 * It creates a new row in unified_geometry_artifacts with:
 *   - geometryClass = 'obstruction'
 *   - obstruction_metadata = full ObstructionMetadata JSONB blob
 *   - authority = SYNTHETIC_ARTIFACT_AUTHORITY (heuristic origin)
 *   - All geometry fields populated from the metadata where available
 *
 * Uses ON CONFLICT DO NOTHING to be idempotent — if the artifact already
 * exists (by id), the write is silently skipped.
 *
 * NOTE: This function requires the obstruction_metadata column to exist
 * (Migration 081). It is only called when OBSTRUCTION_UNIFIED_WRITE_ENABLED
 * is true (default OFF), so the column should always be present by the time
 * this is enabled.
 *
 * @param surveyId - The site survey ID
 * @param obstructionMeta - The full ObstructionMetadata blob
 * @returns true if the row was inserted, false if it already existed or on error
 */
export async function writeObstructionArtifact(
  surveyId: string,
  obstructionMeta: ObstructionMetadata,
): Promise<boolean> {
  try {
    const sql = await getDbReady();

    const authority = getAuthorityForState('derived_review_only', false);
    // Mark as synthetic since obstruction registration is heuristic-based
    const syntheticAuthority = {
      ...authority,
      state: 'derived_review_only' as UnifiedGeometryAuthorityState,
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      canonicalMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
      cadConsumable: false,
      mockArtifact: false,
    };

    const provenance = {
      sourcePipeline: 'obstruction_registration' as GeometrySourcePipeline,
      toolName: 'roofObstructionRegistration',
      toolVersion: '1.0.0',
      runHash: obstructionMeta.sourceFileId ?? 'unknown',
      sourceFileIds: obstructionMeta.sourceFileId ? [obstructionMeta.sourceFileId] : [] as string[],
      derivedFromArtifactIds: [] as string[],
      createdAt: new Date().toISOString(),
      synthetic: true,
      disclaimer: 'Heuristic-generated obstruction from roofObstructionRegistration pipeline',
      backfilledFrom: null as string | null,
    };

    // Derive UnifiedGeometryArtifact fields from ObstructionMetadata
    const label = obstructionMeta.obstructionType ?? 'unknown_obstruction';
    const confidence01 = Math.min(1, Math.max(0, obstructionMeta.confidence / 100));

    // Build geometry_data JSONB — the full artifact stored as JSON
    const geometryData: Record<string, unknown> = {
      id: obstructionMeta.id,
      surveyId,
      geometryClass: 'obstruction',
      authority: syntheticAuthority,
      provenance,
      confidence: confidence01,
      label,
      limitations: obstructionMeta.limitations ?? [],
      bbox: {
        x: obstructionMeta.region.x,
        y: obstructionMeta.region.y,
        width: obstructionMeta.region.width,
        height: obstructionMeta.region.height,
        coordinateSystem: 'normalized_image_0_1000',
      },
      polygon: null,
      lineSegment: null,
      center: {
        x: obstructionMeta.center.x,
        y: obstructionMeta.center.y,
        coordinateSystem: 'normalized_image_0_1000',
      },
      planeType: null,
      pitchDegrees: null,
      azimuthDegrees: null,
      normalVector: null,
      areaSqM: obstructionMeta.areaNormalized,
      inlierCount: null,
      totalPoints: null,
      lineSubtype: null,
      estimatedLengthM: null,
      obstructionSubtype: mapObstructionTypeToSubtype(obstructionMeta.obstructionType),
      radiusM: null,
      setbackM: null,
      heightFt: null,
      roofPlaneId: null,
      cadImpact: {
        canAffectPanelPlacement: obstructionMeta.canAffectPanelPlacement,
        canAffectFirePathway: obstructionMeta.canAffectFirePathway,
        canAffectConduitPath: obstructionMeta.canAffectConduitPath,
        canAffectStructuralAttachment: obstructionMeta.canAffectStructuralAttachment,
        layoutAvoidancePriority: obstructionMeta.priority,
        cadBlockHint: obstructionMeta.cadBlockHint,
        obstructionFootprintHint: obstructionMeta.obstructionFootprintHint,
        clearanceRadiusHint: obstructionMeta.clearanceRadiusHint,
      },
      electricalSubtype: null,
      story: null,
      isPrimaryInterconnect: null,
      depthResolution: null,
      depthMetric: null,
      consensusPhotoCount: null,
      segmentationClass: null,
      segmentationBackend: null,
      facadeSubtype: null,
      siteContextSubtype: null,
      conditionFlags: null,
      isOccluder: null,
      reviewState: obstructionMeta.reviewState === 'accepted' ? 'accepted' as const
        : obstructionMeta.reviewState === 'rejected' ? 'rejected' as const
        : 'review_required' as const,
      reviewNotes: null,
      priority: obstructionMeta.priority,
      stageTimings: null,
      isSynthetic: true,
      obstructionMetadata: obstructionMeta,
    };

    const result = await sql`
      INSERT INTO unified_geometry_artifacts (
        id, survey_id, geometry_class, authority_state, authority,
        provenance, confidence, label, limitations, geometry_data,
        obstruction_metadata,
        review_state, priority, mock_artifact, created_at, updated_at
      ) VALUES (
        ${obstructionMeta.id},
        ${surveyId},
        'obstruction',
        'derived_review_only',
        ${JSON.stringify(syntheticAuthority)}::jsonb,
        ${JSON.stringify(provenance)}::jsonb,
        ${confidence01},
        ${label},
        ${obstructionMeta.limitations ?? []}::text[],
        ${JSON.stringify(geometryData)}::jsonb,
        ${JSON.stringify(obstructionMeta)}::jsonb,
        ${obstructionMeta.reviewState},
        ${obstructionMeta.priority},
        FALSE,
        NOW()::timestamptz,
        NOW()::timestamptz
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    return result.length > 0;
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to write obstruction artifact:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Map a RoofObstructionType string to the canonical ObstructionSubtype.
 * This is a best-effort mapping; unknown types fall through to 'other'.
 */
function mapObstructionTypeToSubtype(obstructionType: string | null): string {
  if (!obstructionType) return 'other';
  const mapping: Record<string, string> = {
    plumbing_vent: 'vent',
    exhaust_vent: 'vent',
    ridge_vent: 'vent',
    chimney: 'chimney',
    skylight: 'skylight',
    pipe_boot: 'vent',
    satellite_dish: 'satellite_dish',
    roof_hvac: 'hvac',
    solar_tube: 'skylight',
    flashing: 'other',
    dormer: 'dormer',
    antenna: 'antenna',
    roof_jack: 'vent',
    unknown_obstruction: 'other',
  };
  return mapping[obstructionType] ?? 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Write: Persist any UnifiedGeometryArtifact to the unified table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a single UnifiedGeometryArtifact to the unified_geometry_artifacts table.
 *
 * This is the general-purpose write function for persisting adapted artifacts
 * from Pipeline A (Photo Vision) or Pipeline B (Geometry Reconstruction) into
 * the unified table. It stores the full artifact as `geometry_data` JSONB, and
 * also populates the top-level columns for querying/indexing.
 *
 * Uses ON CONFLICT (id) DO NOTHING to be idempotent — if the artifact already
 * exists (by id), the write is silently skipped.
 *
 * @param artifact - The fully-populated UnifiedGeometryArtifact to persist
 * @returns true if the row was inserted, false if it already existed or on error
 */
export async function writeUnifiedArtifact(
  artifact: UnifiedGeometryArtifact,
): Promise<boolean> {
  try {
    const sql = await getDbReady();

    // Derive the authority_state from the artifact's authority
    const authorityState = artifact.authority.state;

    // Derive mock_artifact flag from the authority
    const mockArtifact = artifact.authority.mockArtifact ?? false;

    // Serialize authority and provenance as JSONB
    const authorityJson = JSON.stringify(artifact.authority);
    const provenanceJson = JSON.stringify(artifact.provenance);

    // Serialize the full artifact as geometry_data JSONB
    const geometryDataJson = JSON.stringify(artifact);

    // Serialize limitations as text[]
    const limitationsArray = Array.isArray(artifact.limitations)
      ? artifact.limitations
      : [];

    // Serialize obstruction_metadata if present
    const obstructionMetaJson = artifact.obstructionMetadata
      ? JSON.stringify(artifact.obstructionMetadata)
      : null;

    // Build the INSERT statement — with or without obstruction_metadata column
    const hasObstructionColumn = await checkObstructionMetadataColumn(sql);

    let result;
    if (hasObstructionColumn && obstructionMetaJson) {
      result = await sql`
        INSERT INTO unified_geometry_artifacts (
          id, survey_id, geometry_class, authority_state, authority,
          provenance, confidence, label, limitations, geometry_data,
          obstruction_metadata,
          review_state, review_notes, priority, mock_artifact, created_at, updated_at
        ) VALUES (
          ${artifact.id},
          ${artifact.surveyId},
          ${artifact.geometryClass},
          ${authorityState},
          ${authorityJson}::jsonb,
          ${provenanceJson}::jsonb,
          ${artifact.confidence},
          ${artifact.label},
          ${limitationsArray}::text[],
          ${geometryDataJson}::jsonb,
          ${obstructionMetaJson}::jsonb,
          ${artifact.reviewState},
          ${artifact.reviewNotes},
          ${artifact.priority},
          ${mockArtifact},
          NOW()::timestamptz,
          NOW()::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
    } else if (hasObstructionColumn) {
      // Column exists but no obstruction metadata — insert with NULL
      result = await sql`
        INSERT INTO unified_geometry_artifacts (
          id, survey_id, geometry_class, authority_state, authority,
          provenance, confidence, label, limitations, geometry_data,
          obstruction_metadata,
          review_state, review_notes, priority, mock_artifact, created_at, updated_at
        ) VALUES (
          ${artifact.id},
          ${artifact.surveyId},
          ${artifact.geometryClass},
          ${authorityState},
          ${authorityJson}::jsonb,
          ${provenanceJson}::jsonb,
          ${artifact.confidence},
          ${artifact.label},
          ${limitationsArray}::text[],
          ${geometryDataJson}::jsonb,
          NULL::jsonb,
          ${artifact.reviewState},
          ${artifact.reviewNotes},
          ${artifact.priority},
          ${mockArtifact},
          NOW()::timestamptz,
          NOW()::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
    } else {
      // No obstruction_metadata column — omit it
      result = await sql`
        INSERT INTO unified_geometry_artifacts (
          id, survey_id, geometry_class, authority_state, authority,
          provenance, confidence, label, limitations, geometry_data,
          review_state, review_notes, priority, mock_artifact, created_at, updated_at
        ) VALUES (
          ${artifact.id},
          ${artifact.surveyId},
          ${artifact.geometryClass},
          ${authorityState},
          ${authorityJson}::jsonb,
          ${provenanceJson}::jsonb,
          ${artifact.confidence},
          ${artifact.label},
          ${limitationsArray}::text[],
          ${geometryDataJson}::jsonb,
          ${artifact.reviewState},
          ${artifact.reviewNotes},
          ${artifact.priority},
          ${mockArtifact},
          NOW()::timestamptz,
          NOW()::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
    }

    return result.length > 0;
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to write unified artifact:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Write multiple UnifiedGeometryArtifact instances to the unified table.
 * Uses ON CONFLICT (id) DO NOTHING for idempotency.
 *
 * @param artifacts - Array of artifacts to persist
 * @returns Object with counts of inserted, skipped, and failed writes
 */
export async function writeUnifiedArtifacts(
  artifacts: UnifiedGeometryArtifact[],
): Promise<{ inserted: number; skipped: number; failed: number }> {
  if (artifacts.length === 0) {
    return { inserted: 0, skipped: 0, failed: 0 };
  }

  // Process artifacts in concurrent batches for much better throughput
  // than sequential INSERTs. Each batch runs up to CONCURRENCY INSERTs
  // in parallel, and we process BATCH_SIZE artifacts at a time.
  const CONCURRENCY = 20;
  const BATCH_SIZE = 500;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let offset = 0; offset < artifacts.length; offset += BATCH_SIZE) {
    const batch = artifacts.slice(offset, offset + BATCH_SIZE);

    // Process this batch in chunks of CONCURRENCY
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (artifact) => {
          try {
            const result = await writeUnifiedArtifact(artifact);
            return result ? 'inserted' : 'skipped';
          } catch {
            return 'failed';
          }
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value === 'inserted') totalInserted++;
          else if (r.value === 'skipped') totalSkipped++;
          else totalFailed++;
        } else {
          totalFailed++;
        }
      }
    }
  }

  return { inserted: totalInserted, skipped: totalSkipped, failed: totalFailed };
}

/**
 * Delete all unified geometry artifacts for a survey that match a specific
 * source pipeline. Used to clean up before re-writing artifacts from a
 * pipeline re-run.
 *
 * @param surveyId - The survey ID
 * @param sourcePipeline - Only delete artifacts from this source pipeline
 * @returns Number of deleted rows
 */
export async function deleteUnifiedArtifactsByPipeline(
  surveyId: string,
  sourcePipeline: string,
): Promise<number> {
  try {
    const sql = await getDbReady();

    const result = await sql`
      DELETE FROM unified_geometry_artifacts
      WHERE survey_id = ${surveyId}
        AND provenance->>'sourcePipeline' = ${sourcePipeline}
      RETURNING id
    `;

    return result.length;
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to delete artifacts by pipeline:',
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

/**
 * Delete ALL unified geometry artifacts for a survey, regardless of source pipeline.
 *
 * Used when Pipeline B (geometry_recon) re-runs to ensure that stale artifacts
 * from previous Pipeline A (photo_vision) or Pipeline C (google_solar_api) runs
 * don't coexist with new SAM 2 masks. Without this, old Canny-based artifacts
 * from Pipeline A persist and appear alongside new SAM 2 masks in the overlay,
 * making it look like "Canny is still there" even after the no-fallback fix.
 *
 * SECURITY: Requires ownerId to verify that the requesting user owns the survey.
 * Prevents any authenticated user from deleting another user's survey artifacts.
 *
 * @param surveyId - The survey ID whose artifacts should be deleted
 * @param ownerId  - The user ID of the requesting user (must own the survey)
 * @returns Number of artifacts deleted
 * @throws Error if the user does not own the survey
 */
export async function deleteUnifiedArtifactsBySurvey(
  surveyId: string,
  ownerId: string,
): Promise<number> {
  try {
    const sql = await getDbReady();

    // Verify ownership: the requesting user must own the survey
    const surveyCheck = await sql`
      SELECT project_id FROM site_surveys
      WHERE id = ${surveyId}
    `;

    if (surveyCheck.length === 0) {
      console.warn(
        '[unifiedArtifactStore] deleteUnifiedArtifactsBySurvey: survey not found:',
        surveyId,
      );
      return 0;
    }

    // Verify the user owns the project this survey belongs to
    const projectId = surveyCheck[0].project_id;
    const ownershipCheck = await sql`
      SELECT 1 FROM projects
      WHERE id = ${projectId}
        AND user_id = ${ownerId}
    `;

    if (ownershipCheck.length === 0) {
      throw new Error(
        `[unifiedArtifactStore] deleteUnifiedArtifactsBySurvey: user ${ownerId} does not own survey ${surveyId} (project ${projectId})`,
      );
    }

    const result = await sql`
      DELETE FROM unified_geometry_artifacts
      WHERE survey_id = ${surveyId}
      RETURNING id
    `;

    return result.length;
  } catch (err) {
    // Re-throw ownership violations so callers can surface 403 errors
    if (err instanceof Error && err.message.includes('does not own')) {
      throw err;
    }
    console.warn(
      '[unifiedArtifactStore] Failed to delete artifacts by survey:',
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}
