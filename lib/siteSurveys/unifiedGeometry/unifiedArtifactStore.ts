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
// NEON DRIVER QUIRKS:
//   - Must use RETURNING on all UPDATE queries
//   - TEXT[] columns receive JS arrays directly, NOT JSON.stringify'd arrays
//   - JSONB columns return parsed objects
// ============================================================================

import { getDbReady } from '@/lib/db/core';
import type { UnifiedGeometryArtifact, UnifiedGeometryClass, GeometrySourcePipeline } from './types';
import type { UnifiedGeometryAuthorityState } from './authority';
import { getAuthorityForState } from './authority';

// ─────────────────────────────────────────────────────────────────────────────
// DB Row Type
// ─────────────────────────────────────────────────────────────────────────────

interface UnifiedArtifactRow {
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

// ─────────────────────────────────────────────────────────────────────────────
// Query: Get all unified artifacts for a survey
// ─────────────────────────────────────────────────────────────────────────────

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

    return rows.map(rowToArtifact);
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to query unified_geometry_artifacts:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query: Get specific artifacts by ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get specific UnifiedGeometryArtifact instances by their IDs.
 * Useful when a promotion request specifies particular artifact IDs.
 */
export async function getUnifiedArtifactsByIds(
  artifactIds: string[],
): Promise<UnifiedGeometryArtifact[]> {
  if (artifactIds.length === 0) return [];

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id, survey_id, geometry_class, authority_state, authority,
        provenance, confidence, label, limitations, geometry_data,
        review_state, review_notes, priority, mock_artifact,
        created_at, updated_at
      FROM unified_geometry_artifacts
      WHERE id = ANY(${artifactIds})
      ORDER BY created_at ASC
    `;

    return rows.map(rowToArtifact);
  } catch (err) {
    console.warn(
      '[unifiedArtifactStore] Failed to query unified_geometry_artifacts by IDs:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query: Check if the unified table has data for a survey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether the unified_geometry_artifacts table has any artifacts
 * for the given survey. Returns true if at least one artifact exists.
 *
 * This is used to decide whether to query the unified table directly
 * or fall back to on-the-fly adaptation from source tables.
 */
export async function hasUnifiedArtifactsForSurvey(
  surveyId: string,
): Promise<boolean> {
  try {
    const sql = await getDbReady();

    const tableCheck = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'unified_geometry_artifacts'
    `;
    if (tableCheck.length === 0) {
      return false;
    }

    const result = await sql`
      SELECT 1 FROM unified_geometry_artifacts
      WHERE survey_id = ${surveyId}
      LIMIT 1
    `;
    return result.length > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → Artifact Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a database row to a UnifiedGeometryArtifact.
 *
 * If `geometry_data` is populated (preferred), it contains the full artifact
 * stored as JSONB — this is the most accurate representation since it preserves
 * all nested fields (authority, provenance, geometry fields, etc.).
 *
 * If `geometry_data` is null (e.g., from Migration 080 backfill that only stored
 * metadata), we reconstruct from the row columns with sensible defaults.
 */
function rowToArtifact(row: UnifiedArtifactRow): UnifiedGeometryArtifact {
  // Preferred path: full artifact stored in geometry_data
  if (row.geometry_data && typeof row.geometry_data === 'object') {
    const stored = row.geometry_data as Record<string, unknown>;

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
      reviewState: (stored.reviewState as UnifiedGeometryArtifact['reviewState']) ?? rowToReviewState(row),
      reviewNotes: (stored.reviewNotes as string | null) ?? row.review_notes ?? null,
      priority: (stored.priority as UnifiedGeometryArtifact['priority']) ?? rowToPriority(row),
      stageTimings: (stored.stageTimings as Record<string, number> | null) ?? null,
      isSynthetic: (stored.isSynthetic as boolean) ?? false,
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
    reviewState: rowToReviewState(row),
    reviewNotes: row.review_notes ?? null,
    priority: rowToPriority(row),
    stageTimings: null,
    isSynthetic: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row Sub-field Reconstruction
// ─────────────────────────────────────────────────────────────────────────────

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

function rowToReviewState(row: UnifiedArtifactRow): UnifiedGeometryArtifact['reviewState'] {
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
