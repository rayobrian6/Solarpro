// ============================================================================
// POST /api/site-surveys/[surveyId]/unified-geometry/canonical-model
//
// Build a CanonicalBuildingModel from promoted artifacts.
//
// This is the ONLY legal way to construct a CanonicalBuildingModel that
// feeds into the CAD engine. Only promoted_canonical or cad_safe artifacts
// are accepted. Mock artifacts are always rejected.
//
// Request body (optional — defaults to using all promoted_canonical+ artifacts):
//   {
//     artifactIds?: string[],          // specific artifact IDs to include
//     config?: {
//       defaultEaveSetbackM?: number,  // default: 0.35
//       defaultRidgeSetbackM?: number, // default: 0.15
//       defaultRakeSetbackM?: number,  // default: 0.20
//     }
//   }
//
// The CanonicalBuildingModel is then consumed by canonicalBridge.canonicalToCADInputs()
// to produce CAD-safe inputs for the CAD engine.
//
// ARTIFACT SOURCE:
//   PRIMARY:   unified_geometry_artifacts table (via unifiedArtifactStore)
//   FALLBACK:  On-the-fly adaptation from Pipeline A + Pipeline B source tables
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import {
  buildCanonicalModel,
  CanonicalBuilderError,
} from '@/lib/siteSurveys/unifiedGeometry';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';
import { getUnifiedArtifactsForSurvey } from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';

export async function POST(
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

    // ── Parse request body ──────────────────────────────────────────────
    let body: {
      artifactIds?: string[];
      config?: {
        defaultEaveSetbackM?: number;
        defaultRidgeSetbackM?: number;
        defaultRakeSetbackM?: number;
      };
    } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine — we'll use all promoted artifacts
    }

    // ── Fetch artifacts: PRIMARY unified table, FALLBACK on-the-fly ─────
    let allArtifacts: UnifiedGeometryArtifact[] = [];

    // PRIMARY: Query unified_geometry_artifacts directly
    const unifiedArtifacts = await getUnifiedArtifactsForSurvey(surveyId);
    if (unifiedArtifacts.length > 0) {
      allArtifacts = unifiedArtifacts;
    } else {
      // FALLBACK: On-the-fly adaptation from source tables
      console.info(
        `[POST /unified-geometry/canonical-model] No artifacts in unified table for survey ${surveyId}, falling back to on-the-fly adaptation`,
      );

      const { getOpenSourcePhotoVisionCandidatesBySurvey } = await import('@/lib/db/openSourcePhotoVision');
      const { getArtifactsBySurvey } = await import('@/lib/db/geometryReconstruction');
      const { buildUnifiedEvidenceBundle } = await import('@/lib/siteSurveys/unifiedGeometry');

      const [photoVisionBundle, geometryReconResult] = await Promise.all([
        getOpenSourcePhotoVisionCandidatesBySurvey(surveyId, user.id).catch(() => null),
        getArtifactsBySurvey(surveyId, user.id).catch(() => null),
      ]);

      const bundle = buildUnifiedEvidenceBundle(
        surveyId,
        photoVisionBundle?.candidates ?? [],
        geometryReconResult?.artifacts ?? [],
        { includeMocks: false, minConfidence: 0 }, // exclude mocks from canonical model
      );

      allArtifacts = bundle.artifacts;
    }

    // ── Filter to promoted_canonical or cad_safe artifacts ──────────────
    let eligibleArtifacts = allArtifacts.filter(
      a => a.authority.state === 'promoted_canonical' || a.authority.state === 'cad_safe',
    );

    // If specific artifact IDs were requested, filter to those
    if (body.artifactIds && body.artifactIds.length > 0) {
      const requestedIds = new Set(body.artifactIds);
      eligibleArtifacts = eligibleArtifacts.filter(a => requestedIds.has(a.id));
    }

    if (eligibleArtifacts.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No promoted_canonical or cad_safe artifacts found. Promote artifacts through the review workflow first.',
        hint: 'POST /api/site-surveys/[surveyId]/unified-geometry/promote',
      }, { status: 422 });
    }

    // ── Build the CanonicalBuildingModel ─────────────────────────────────
    const model = buildCanonicalModel(
      surveyId,
      eligibleArtifacts,
      [], // promotion record IDs — would need to be fetched from DB
      body.config,
    );

    return NextResponse.json({
      success: true,
      model,
      summary: {
        surveyId,
        roofPlaneCount: model.roofPlanes.length,
        wallPlaneCount: model.wallPlanes.length,
        obstructionCount: model.obstructions.length,
        electricalNodeCount: model.electricalNodes.length,
        structuralLineCount: model.structuralLines.length,
        authority: model.authority.state,
        artifactCount: eligibleArtifacts.length,
      },
    });
  } catch (err) {
    if (err instanceof CanonicalBuilderError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 422 });
    }

    console.error('[POST /unified-geometry/canonical-model] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
