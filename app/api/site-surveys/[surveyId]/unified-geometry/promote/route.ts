// ============================================================================
// POST /api/site-surveys/[surveyId]/unified-geometry/promote
//
// Promote one or more geometry artifacts through the authority lifecycle.
//
// Request body:
//   {
//     artifactIds: string[],
//     targetState: 'derived_review_only' | 'reviewed_candidate' | 'promoted_canonical' | 'cad_safe',
//     notes?: string,
//     intelligenceValidated?: boolean,
//     intelligenceWarnings?: string[],
//   }
//
// Promotion is forward-only and one-step-at-a-time. Each promotion creates
// a NEW artifact (never mutates the original) and an audit trail record.
//
// NON-NEGOTIABLE:
//   - Mock artifacts CANNOT be promoted
//   - Rejected artifacts CANNOT be promoted
//   - Only promoted_canonical+ artifacts can feed the CanonicalBuildingModel
//
// ARTIFACT SOURCE:
//   PRIMARY:   unified_geometry_artifacts table (via unifiedArtifactStore)
//   FALLBACK:  On-the-fly adaptation from Pipeline A + Pipeline B source tables
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, getSiteSurveyById } from '@/lib/db-neon';
import {
  promoteArtifact,
  promoteToDerivedReviewOnly,
  promoteToReviewedCandidate,
  promoteToCanonical,
  promoteToCadSafe,
  type PromotionResult,
  type BatchPromotionResult,
  PromotionError,
} from '@/lib/siteSurveys/unifiedGeometry';
import type { UnifiedGeometryAuthorityState } from '@/lib/siteSurveys/unifiedGeometry';
import { insertPromotionRecords } from '@/lib/siteSurveys/unifiedGeometry/promotionStore';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';
import { getUnifiedArtifactsForSurvey } from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    // ── Ownership gate — only the survey's owner may mutate its geometry ──
    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // ── Parse request body ──────────────────────────────────────────────
    const body = await req.json();
    const { artifactIds, targetState, notes, intelligenceValidated, intelligenceWarnings } = body as {
      artifactIds: string[];
      targetState: UnifiedGeometryAuthorityState;
      notes?: string;
      intelligenceValidated?: boolean;
      intelligenceWarnings?: string[];
    };

    if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'artifactIds must be a non-empty array' },
        { status: 400 },
      );
    }

    const validTargetStates: UnifiedGeometryAuthorityState[] = [
      'derived_review_only',
      'reviewed_candidate',
      'promoted_canonical',
      'cad_safe',
    ];
    if (!validTargetStates.includes(targetState)) {
      return NextResponse.json(
        { success: false, error: `targetState must be one of: ${validTargetStates.join(', ')}` },
        { status: 400 },
      );
    }

    // ── Fetch artifacts: PRIMARY unified table, FALLBACK on-the-fly ─────
    let artifacts: UnifiedGeometryArtifact[] = [];

    // PRIMARY: Query unified_geometry_artifacts directly
    const unifiedArtifacts = await getUnifiedArtifactsForSurvey(surveyId);
    if (unifiedArtifacts.length > 0) {
      artifacts = unifiedArtifacts;
    } else {
      // FALLBACK: On-the-fly adaptation from source tables
      console.info(
        `[POST /unified-geometry/promote] No artifacts in unified table for survey ${surveyId}, falling back to on-the-fly adaptation`,
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
        { includeMocks: true, minConfidence: 0 },
      );

      artifacts = bundle.artifacts;
    }

    // Build a lookup of current artifacts by ID
    const artifactLookup = new Map<string, UnifiedGeometryArtifact>();
    for (const artifact of artifacts) {
      artifactLookup.set(artifact.id, artifact);
    }

    // ── Promote each artifact ───────────────────────────────────────────
    const successful: PromotionResult[] = [];
    const failed: Array<{ artifactId: string; error: string }> = [];

    for (const artifactId of artifactIds) {
      const artifact = artifactLookup.get(artifactId);
      if (!artifact) {
        failed.push({ artifactId, error: `Artifact ${artifactId} not found in current bundle` });
        continue;
      }

      try {
        const result = promoteArtifact(artifact, targetState, user.id, {
          notes,
          intelligenceValidated,
          intelligenceWarnings,
        });
        successful.push(result);
      } catch (err) {
        if (err instanceof PromotionError) {
          failed.push({ artifactId, error: err.message });
        } else {
          failed.push({ artifactId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // ── Persist promotion records ───────────────────────────────────────
    if (successful.length > 0) {
      try {
        await insertPromotionRecords(successful.map(r => r.promotionRecord), surveyId);
      } catch (err) {
        console.warn(
          '[POST /unified-geometry/promote] Failed to persist some promotion records:',
          err instanceof Error ? err.message : String(err),
        );
        // Don't fail the request — the promotion still happened in memory.
        // The records can be reconstructed from the audit trail.
      }

      // ── Upsert promoted artifacts into unified_geometry_artifacts ──────
      // After promotion, the promoted artifact should be reflected in the
      // unified table so subsequent bundle fetches reflect the updated authority.
      try {
        const { getDbReady } = await import('@/lib/db/core');
        const db = await getDbReady();
        for (const result of successful) {
          const art = result.promotedArtifact;
          await db`
            INSERT INTO unified_geometry_artifacts (
              id, survey_id, geometry_class, authority_state, authority,
              provenance, confidence, label, limitations, geometry_data,
              review_state, priority, mock_artifact, created_at, updated_at
            ) VALUES (
              ${art.id},
              ${art.surveyId},
              ${art.geometryClass},
              ${art.authority.state},
              ${JSON.stringify(art.authority)}::jsonb,
              ${JSON.stringify(art.provenance)}::jsonb,
              ${art.confidence},
              ${art.label},
              ${art.limitations ?? []}::text[],
              ${JSON.stringify(art)}::jsonb,
              ${art.reviewState ?? 'review_required'},
              ${art.priority ?? 'medium'},
              ${art.authority.mockArtifact ?? false},
              NOW()::timestamptz,
              NOW()::timestamptz
            )
            ON CONFLICT (id) DO UPDATE SET
              authority_state = EXCLUDED.authority_state,
              authority = EXCLUDED.authority,
              provenance = EXCLUDED.provenance,
              confidence = EXCLUDED.confidence,
              review_state = EXCLUDED.review_state,
              mock_artifact = EXCLUDED.mock_artifact,
              geometry_data = EXCLUDED.geometry_data,
              updated_at = NOW()::timestamptz
          `;
        }
      } catch (err) {
        console.warn(
          '[POST /unified-geometry/promote] Failed to upsert promoted artifacts into unified table:',
          err instanceof Error ? err.message : String(err),
        );
        // Don't fail the request — the in-memory promotion is still valid.
        // The unified table will be consistent on next backfill.
      }
    }

    return NextResponse.json({
      success: true,
      promoted: successful.map(r => ({
        artifactId: r.promotedArtifact.id,
        originalArtifactId: r.originalArtifact.id,
        fromState: r.originalArtifact.authority.state,
        toState: r.promotedArtifact.authority.state,
        promotionRecordId: r.promotionRecord.id,
      })),
      failed,
      summary: {
        total: artifactIds.length,
        promoted: successful.length,
        failed: failed.length,
      },
    });
  } catch (err) {
    console.error('[POST /unified-geometry/promote] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
