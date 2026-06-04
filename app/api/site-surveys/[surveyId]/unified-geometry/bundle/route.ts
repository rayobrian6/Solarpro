// ============================================================================
// GET /api/site-surveys/[surveyId]/unified-geometry/bundle
//
// Fetch the unified geometry evidence bundle for a survey.
//
// QUERY PARAMETERS:
//   ?mode=stats    (default) — Strips polygon.vertices from segmentation_mask
//                  artifacts to keep the response under Vercel's 4.5MB
//                  serverless function body limit. Stats, counts, and bbox
//                  data are all preserved. The overlay renderer will render
//                  segmentation masks as bounding-box rectangles instead of
//                  detailed polygon shapes.
//   ?mode=overlay  — Includes full polygon vertex data for all artifacts.
//                  When used with ?fileId=, only returns polygon data for
//                  artifacts associated with that specific photo — keeping
//                  the response well under 4.5MB (~1-2MB per photo).
//                  WARNING: Without ?fileId=, can exceed Vercel's 4.5MB
//                  response limit for surveys with many segmentation masks.
//   ?mode=full     — Alias for overlay (backward compat).
//   ?fileId=       — Filter artifacts to only those whose provenance.sourceFileIds
//                  includes the given file ID. This is the key to making overlay
//                  mode safe: per-photo overlay requests are ~1-2MB instead of
//                  ~33MB for all photos combined. When fileId is specified and
//                  mode is not explicitly set, mode defaults to 'overlay' (since
//                  the per-photo response is small enough).
//
// PRIMARY PATH:  Query `unified_geometry_artifacts` table directly.
//   This table is populated by Migration 080 backfill and kept current by
//   the promote route's upsert. It is the canonical source of truth.
//   HOWEVER: We only use the PRIMARY path if it contains artifacts from
//   photo_vision or geometry_recon pipelines. If it only has
//   obstruction_registration artifacts, we still fall through to the
//   FALLBACK path so Pipeline A/B candidates get included.
//
// FALLBACK PATH: If the unified table has no pipeline artifacts for this
//   survey (e.g., backfill hasn't run yet, or only obstruction_registration
//   artifacts exist), fall back to on-the-fly adaptation from Pipeline A
//   (Photo Vision) + Pipeline B (Geometry Reconstruction) source tables.
//   Any existing unified table artifacts (like obstruction_registration)
//   are ALSO included in the bundle alongside the adapted candidates.
//
// This is the single endpoint for the UI to display all geometry artifacts
// in a unified panel — no more split Pipeline A/B views.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, getSiteSurveyById, GetSiteSurveyByIdOptions } from '@/lib/db-neon';
import { getUnifiedArtifactsForSurvey } from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';
import {
  BundleBuilder,
  buildUnifiedEvidenceBundle,
} from '@/lib/siteSurveys/unifiedGeometry';
import { isGoogleSolarApiConfigured } from '@/lib/siteSurveys/googleSolarApi/client';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';

// ── Bundle mode types ────────────────────────────────────────────────────────

type BundleMode = 'stats' | 'overlay' | 'full';

/**
 * Strips polygon vertex arrays from segmentation_mask artifacts to dramatically
 * reduce bundle size. Segmentation masks (typically 150+ per survey) carry the
 * bulk of the data — each mask can have hundreds of polygon vertices. In stats
 * mode, the overlay renderer falls back to rendering bounding-box rectangles
 * for these masks instead of detailed polygon shapes.
 *
 * This function does NOT strip vertices from roof_plane, wall_plane,
 * consensus_plane, or other geometry classes — those have much smaller polygon
 * counts and are essential for the overlay renderer.
 *
 * Returns a new array; does not mutate the input.
 */
function stripSegmentationMaskVertices(artifacts: UnifiedGeometryArtifact[]): UnifiedGeometryArtifact[] {
  return artifacts.map(artifact => {
    // Only strip vertices from segmentation_mask artifacts that have a polygon
    if (artifact.geometryClass !== 'segmentation_mask' || !artifact.polygon) {
      return artifact;
    }

    // Strip vertices but keep the polygon shell (with coordinateSystem) so the
    // frontend knows a polygon WAS present. The overlay renderer will see
    // polygon.vertices === [] and fall back to bbox rendering.
    return {
      ...artifact,
      polygon: {
        vertices: [],
        coordinateSystem: artifact.polygon.coordinateSystem,
      },
    };
  });
}

/**
 * Filter artifacts to only those associated with a specific file ID.
 * Uses the provenance.sourceFileIds array on each artifact.
 *
 * When ?fileId= is specified, this dramatically reduces the response size
 * because only artifacts for one photo are returned (~8-15 segmentation masks
 * instead of 150+). This is the key mechanism for making overlay mode safe
 * under Vercel's 4.5MB serverless function response limit.
 *
 * Some artifacts (e.g., consensus_plane, roof_line) may span multiple files
 * or have empty sourceFileIds. These are included when fileId is specified
 * ONLY if their sourceFileIds array is empty (meaning they're survey-level,
 * not photo-level). If sourceFileIds is non-empty but doesn't include the
 * requested fileId, the artifact is excluded.
 */
function filterArtifactsByFileId(
  artifacts: UnifiedGeometryArtifact[],
  fileId: string,
): UnifiedGeometryArtifact[] {
  return artifacts.filter(artifact => {
    const sourceFileIds = artifact.provenance?.sourceFileIds;
    // If no sourceFileIds at all (shouldn't happen but defensive), include it
    if (!sourceFileIds || !Array.isArray(sourceFileIds) || sourceFileIds.length === 0) {
      return true; // survey-level artifact (e.g., consensus planes from merged data)
    }
    return sourceFileIds.includes(fileId);
  });
}

/**
 * Estimate the JSON byte size of the response payload.
 * Used to log a warning when the response may exceed Vercel's 4.5MB limit.
 */
function estimateJsonByteSize(obj: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf-8');
  } catch {
    return -1;
  }
}

const VERCEL_RESPONSE_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4.5MB

export async function GET(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    // ── Parse ?mode= and ?fileId= query parameters ────────────────────────────
    const modeParam = req.nextUrl.searchParams.get('mode');
    const fileIdParam = req.nextUrl.searchParams.get('fileId');

    // When fileId is specified without an explicit mode, default to overlay
    // (per-photo overlay responses are small enough to stay under 4.5MB)
    let mode: BundleMode;
    if (modeParam === 'overlay' || modeParam === 'full') {
      mode = modeParam;
    } else if (!modeParam && fileIdParam) {
      mode = 'overlay'; // auto-upgrade to overlay when filtering by photo
    } else {
      mode = 'stats';
    }

    // Validate fileId if provided
    if (fileIdParam && !isValidUUID(fileIdParam)) {
      return NextResponse.json(
        { success: false, error: 'Invalid fileId parameter. Must be a valid UUID.' },
        { status: 400 },
      );
    }

    // Verify survey ownership (dev bypass user skips ownership check)
    const survey = await getSiteSurveyById(surveyId, user.id, {
      bypassOwnershipCheck: user.id === 'dev-user-bypass-001',
    } as GetSiteSurveyByIdOptions);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // ── PRIMARY: Query unified_geometry_artifacts directly ────────────────
    // This table is the canonical source of truth. If it has pipeline
    // artifacts (photo_vision or geometry_recon) for this survey, we
    // build the bundle from them directly — no on-the-fly adaptation needed.
    const unifiedArtifacts = await getUnifiedArtifactsForSurvey(surveyId);

    // Check whether we have any pipeline artifacts (photo_vision or geometry_recon).
    // If we only have obstruction_registration (or other non-pipeline) artifacts,
    // we still need to fall through to the fallback path to include Pipeline A/B data.
    const hasPipelineArtifacts = unifiedArtifacts.some(
      a => a.provenance.sourcePipeline === 'photo_vision' || a.provenance.sourcePipeline === 'geometry_recon' || a.provenance.sourcePipeline === 'google_solar_api',
    );

    if (unifiedArtifacts.length > 0 && hasPipelineArtifacts) {
      // Build the bundle from unified table artifacts directly
      const bundle = new BundleBuilder({
        surveyId,
        includeMocks: true, // UI should see mocks so they can be labeled
        minConfidence: 0,
      })
        .addUnifiedArtifacts(unifiedArtifacts)
        .build();

      // ── Filter by fileId if specified ───────────────────────────────────
      const fileIdFilteredArtifacts = fileIdParam
        ? filterArtifactsByFileId(bundle.artifacts, fileIdParam)
        : bundle.artifacts;

      // ── Apply mode-based vertex stripping ─────────────────────────────
      const processedArtifacts = mode === 'stats'
        ? stripSegmentationMaskVertices(fileIdFilteredArtifacts)
        : fileIdFilteredArtifacts;

      const responsePayload = {
        success: true,
        bundle: {
          ...bundle,
          artifacts: processedArtifacts,
        },
        source: 'unified_table', // informational — tells the caller which path was used
        mode, // echo back the mode so the frontend knows
        fileId: fileIdParam ?? null, // echo back the fileId filter (null if not specified)
        pipelineConfig: {
          googleSolarApi: isGoogleSolarApiConfigured(),
        },
      };

      // ── Size guard for overlay/full mode ────────────────────────────
      // If the response would exceed Vercel's 4.5MB serverless function limit,
      // return a 413 error instead of sending truncated data.
      if (mode !== 'stats') {
        const estimatedSize = estimateJsonByteSize(responsePayload);
        if (estimatedSize > VERCEL_RESPONSE_LIMIT_BYTES) {
          console.warn(
            `[GET /unified-geometry/bundle] BLOCKED: Response for survey ${surveyId} ` +
            `in mode=${mode} is ~${(estimatedSize / 1024 / 1024).toFixed(1)}MB, ` +
            `which exceeds Vercel's 4.5MB limit. Returning 413 instead of truncated data. ` +
            `Use ?mode=stats for the stats panel, or fetch per-photo overlay data with ?fileId=.`
          );
          return NextResponse.json(
            {
              success: false,
              error: `Response would exceed 4.5MB limit (${(estimatedSize / 1024 / 1024).toFixed(1)}MB). Use ?mode=stats for overview, or add ?fileId= to fetch per-photo overlay data.`,
            },
            { status: 413 }
          );
        }
      }

      return NextResponse.json(responsePayload);
    }

    // ── FALLBACK: On-the-fly adaptation from source tables ────────────────
    // Either the unified table is empty, or it only contains non-pipeline
    // artifacts (like obstruction_registration). Fall back to querying
    // Pipeline A + Pipeline B source tables and adapting on the fly.
    // We ALSO include any existing unified table artifacts (e.g., obstruction_registration)
    // alongside the adapted Pipeline A/B candidates so the bundle is complete.
    console.info(
      `[GET /unified-geometry/bundle] No pipeline artifacts in unified table for survey ${surveyId} (total=${unifiedArtifacts.length}, hasPipeline=${hasPipelineArtifacts}), falling back to on-the-fly adaptation`,
    );

    const { getOpenSourcePhotoVisionCandidatesBySurvey } = await import('@/lib/db/openSourcePhotoVision');
    const { getArtifactsBySurvey } = await import('@/lib/db/geometryReconstruction');

    let photoVisionCandidates: Awaited<ReturnType<typeof getOpenSourcePhotoVisionCandidatesBySurvey>> | null = null;
    try {
      photoVisionCandidates = await getOpenSourcePhotoVisionCandidatesBySurvey(surveyId, user.id);
    } catch (err) {
      console.warn(
        '[GET /unified-geometry/bundle] Photo vision candidates unavailable:',
        err instanceof Error ? err.message : String(err),
      );
    }

    let geometryReconResult: Awaited<ReturnType<typeof getArtifactsBySurvey>> | null = null;
    try {
      geometryReconResult = await getArtifactsBySurvey(surveyId, user.id);
    } catch (err) {
      console.warn(
        '[GET /unified-geometry/bundle] Geometry reconstruction artifacts unavailable:',
        err instanceof Error ? err.message : String(err),
      );
    }

    const { adaptPhotoVisionBundle, adaptGeometryReconBundle } = await import('@/lib/siteSurveys/unifiedGeometry/pipelineAdapters');

    const builder = new BundleBuilder({
      surveyId,
      includeMocks: true,
      minConfidence: 0,
    });

    // Add any existing unified table artifacts (e.g., obstruction_registration)
    // so they're not lost when we build the fallback bundle
    if (unifiedArtifacts.length > 0) {
      builder.addUnifiedArtifacts(unifiedArtifacts);
    }

    // Add adapted Pipeline A candidates
    builder.addPhotoVisionCandidates(
      (photoVisionCandidates?.candidates ?? []) as any[],
    );

    // Add adapted Pipeline B artifacts
    builder.addGeometryReconArtifacts(
      (geometryReconResult?.artifacts ?? []) as any[],
    );

    const bundle = builder.build();

    // ── Filter by fileId if specified ───────────────────────────────────
    const fileIdFilteredArtifacts = fileIdParam
      ? filterArtifactsByFileId(bundle.artifacts, fileIdParam)
      : bundle.artifacts;

    // ── Apply mode-based vertex stripping ─────────────────────────────
    const processedArtifacts = mode === 'stats'
      ? stripSegmentationMaskVertices(fileIdFilteredArtifacts)
      : fileIdFilteredArtifacts;

    const responsePayload = {
      success: true,
      bundle: {
        ...bundle,
        artifacts: processedArtifacts,
      },
      source: 'fallback_adaptation', // informational — tells the caller backfill hasn't run
      mode,
      fileId: fileIdParam ?? null, // echo back the fileId filter (null if not specified)
      pipelineConfig: {
        googleSolarApi: isGoogleSolarApiConfigured(),
      },
    };

    // ── Size guard for overlay/full mode (fallback path) ──────────────────
    if (mode !== 'stats') {
      const estimatedSize = estimateJsonByteSize(responsePayload);
      if (estimatedSize > VERCEL_RESPONSE_LIMIT_BYTES) {
        console.warn(
          `[GET /unified-geometry/bundle] BLOCKED: Fallback response for survey ${surveyId} ` +
          `in mode=${mode} is ~${(estimatedSize / 1024 / 1024).toFixed(1)}MB, ` +
          `which exceeds Vercel's 4.5MB limit. Returning 413 instead of truncated data. ` +
          `Use ?mode=stats for the stats panel, or fetch per-photo overlay data with ?fileId=.`
        );
        return NextResponse.json(
          {
            success: false,
            error: `Response would exceed 4.5MB limit (${(estimatedSize / 1024 / 1024).toFixed(1)}MB). Use ?mode=stats for overview, or add ?fileId= to fetch per-photo overlay data.`,
          },
          { status: 413 }
        );
      }
    }

    return NextResponse.json(responsePayload);
  } catch (err) {
    console.error('[GET /unified-geometry/bundle] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
