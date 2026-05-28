// ============================================================================
// GET /api/site-surveys/[surveyId]/unified-geometry/bundle
//
// Fetch the unified geometry evidence bundle for a survey. This pulls
// artifacts from BOTH pipelines (Photo Vision + Geometry Reconstruction),
// adapts them into the unified type system, and returns a cross-referenced
// UnifiedGeometryEvidenceBundle.
//
// This is the single endpoint for the UI to display all geometry artifacts
// in a unified panel — no more split Pipeline A/B views.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getOpenSourcePhotoVisionCandidatesBySurvey } from '@/lib/db/openSourcePhotoVision';
import type { StoredOpenSourcePhotoVisionCandidate } from '@/lib/db/openSourcePhotoVision';
import { getArtifactsBySurvey } from '@/lib/db/geometryReconstruction';
import {
  BundleBuilder,
  buildUnifiedEvidenceBundle,
} from '@/lib/siteSurveys/unifiedGeometry';
import type { OpenSourcePhotoVisionCandidate } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import type { GeometryReconstructionArtifact } from '@/lib/siteSurveys/geometryReconstruction/types';

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

    // ── Fetch Pipeline A artifacts (Photo Vision) ────────────────────────
    let photoVisionCandidates: Awaited<ReturnType<typeof getOpenSourcePhotoVisionCandidatesBySurvey>> | null = null;
    try {
      photoVisionCandidates = await getOpenSourcePhotoVisionCandidatesBySurvey(surveyId, user.id);
    } catch (err) {
      console.warn(
        '[GET /unified-geometry/bundle] Photo vision candidates unavailable:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Fetch Pipeline B artifacts (Geometry Reconstruction) ─────────────
    let geometryReconResult: Awaited<ReturnType<typeof getArtifactsBySurvey>> | null = null;
    try {
      geometryReconResult = await getArtifactsBySurvey(surveyId, user.id);
    } catch (err) {
      console.warn(
        '[GET /unified-geometry/bundle] Geometry reconstruction artifacts unavailable:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Build unified evidence bundle ────────────────────────────────────
    const bundle = buildUnifiedEvidenceBundle(
      surveyId,
      (photoVisionCandidates?.candidates ?? []) as unknown as OpenSourcePhotoVisionCandidate[],
      (geometryReconResult?.artifacts ?? []) as unknown as GeometryReconstructionArtifact[],
      {
        includeMocks: true, // UI should see mocks so they can be labeled
        minConfidence: 0,
      },
    );

    return NextResponse.json({
      success: true,
      bundle,
    });
  } catch (err) {
    console.error('[GET /unified-geometry/bundle] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
