// ============================================================================
// GET /api/site-surveys/[surveyId]/unified-geometry/bundle
//
// Fetch the unified geometry evidence bundle for a survey.
//
// PRIMARY PATH:  Query `unified_geometry_artifacts` table directly.
//   This table is populated by Migration 080 backfill and kept current by
//   the promote route's upsert. It is the canonical source of truth.
//
// FALLBACK PATH: If the unified table has no artifacts for this survey
//   (e.g., backfill hasn't run yet), fall back to on-the-fly adaptation
//   from Pipeline A (Photo Vision) + Pipeline B (Geometry Reconstruction)
//   source tables.
//
// This is the single endpoint for the UI to display all geometry artifacts
// in a unified panel — no more split Pipeline A/B views.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
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

    // ── PRIMARY: Query unified_geometry_artifacts directly ──────────────
    // This table is the canonical source of truth. If it has artifacts
    // for this survey, we build the bundle from them directly — no
    // on-the-fly adaptation needed.
    const unifiedArtifacts = await getUnifiedArtifactsForSurvey(surveyId);

    if (unifiedArtifacts.length > 0) {
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
    // The unified table has no artifacts for this survey. This can happen
    // if Migration 080 backfill hasn't run yet. Fall back to querying
    // Pipeline A + Pipeline B source tables and adapting on the fly.
    console.info(
      `[GET /unified-geometry/bundle] No artifacts in unified table for survey ${surveyId}, falling back to on-the-fly adaptation`,
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

    const bundle = new BundleBuilder({
      surveyId,
      includeMocks: true,
      minConfidence: 0,
    })
      .addPhotoVisionCandidates(
        (photoVisionCandidates?.candidates ?? []) as any[],
      )
      .addGeometryReconArtifacts(
        (geometryReconResult?.artifacts ?? []) as any[],
      )
      .build();

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
