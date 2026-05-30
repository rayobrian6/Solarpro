// ============================================================================
// GET /api/site-surveys/[surveyId]/unified-geometry/bundle
//
// Fetch the unified geometry evidence bundle for a survey.
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

    // Verify survey ownership (dev bypass user skips ownership check)
    const survey = await getSiteSurveyById(surveyId, user.id, {
      bypassOwnershipCheck: user.id === 'dev-user-bypass-001',
    } as GetSiteSurveyByIdOptions);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // ── PRIMARY: Query unified_geometry_artifacts directly ──────────────
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

      return NextResponse.json({
        success: true,
        bundle,
        source: 'unified_table', // informational — tells the caller which path was used
      });
    }

    // ── FALLBACK: On-the-fly adaptation from source tables ──────────────
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

    return NextResponse.json({
      success: true,
      bundle,
      source: 'fallback_adaptation', // informational — tells the caller backfill hasn't run
    });
  } catch (err) {
    console.error('[GET /unified-geometry/bundle] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
