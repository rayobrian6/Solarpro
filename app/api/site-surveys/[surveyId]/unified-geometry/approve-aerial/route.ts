// ============================================================================
// POST /api/site-surveys/[surveyId]/unified-geometry/approve-aerial
//
// Operator-approval action for authoritative aerial roof geometry (Roadmap
// Phase 1 — survey→canonical→planset spine). One call:
//   1. Promotes the survey's google_solar_api roof_plane artifacts from
//      raw_evidence → promoted_canonical (each step validated; synthetic/mock
//      artifacts still blocked).
//   2. Builds the CanonicalBuildingModel from the promoted artifacts.
//   3. Persists it (canonical_building_model table) so the permit planset reads
//      authoritative roof geometry instead of placeholder planes.
//
// This is the backend of the "approve aerial geometry" operator action. No UI is
// wired here. Run the Google Solar fetch first so the aerial artifacts exist.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, getSiteSurveyById } from '@/lib/db-neon';
import {
  getUnifiedArtifactsForSurvey,
  upsertUnifiedArtifact,
} from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';
import { promoteToCanonicalChain } from '@/lib/siteSurveys/unifiedGeometry/aerialApproval';
import { insertPromotionRecords } from '@/lib/siteSurveys/unifiedGeometry/promotionStore';
import { buildCanonicalModel } from '@/lib/siteSurveys/unifiedGeometry';
import { writeCanonicalModel } from '@/lib/siteSurveys/unifiedGeometry/canonicalModelStore';
import { canonicalToPermitRoofPlanes } from '@/lib/siteSurveys/unifiedGeometry/canonicalToPermit';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';
import type { GeometryPromotionRecord } from '@/lib/siteSurveys/unifiedGeometry/types';

const CANONICAL_STATES = new Set(['promoted_canonical', 'cad_safe']);
const isAerialRoofPlane = (a: UnifiedGeometryArtifact) =>
  a.provenance.sourcePipeline === 'google_solar_api' && a.geometryClass === 'roof_plane';

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

    // ── Ownership gate — only the survey's owner may promote/persist geometry ──
    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    const all = await getUnifiedArtifactsForSurvey(surveyId);
    const aerialRoofPlanes = all.filter(isAerialRoofPlane);

    if (aerialRoofPlanes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No aerial (google_solar_api) roof planes found for this survey. Run the Google Solar fetch first.',
          code: 'NO_AERIAL_GEOMETRY',
        },
        { status: 422 },
      );
    }

    // Promote each pre-canonical aerial roof plane to promoted_canonical.
    const promotedFinals: UnifiedGeometryArtifact[] = [];
    const alreadyCanonical: UnifiedGeometryArtifact[] = [];
    const records: GeometryPromotionRecord[] = [];
    const failed: Array<{ artifactId: string; error: string }> = [];
    let promotedCount = 0;

    for (const art of aerialRoofPlanes) {
      if (CANONICAL_STATES.has(art.authority.state)) {
        alreadyCanonical.push(art);
        continue;
      }
      try {
        const { finalArtifact, results } = promoteToCanonicalChain(art, user.id, {
          notes: 'Operator-approved authoritative aerial roof geometry',
        });
        for (const r of results) {
          await upsertUnifiedArtifact(r.promotedArtifact);
          records.push(r.promotionRecord);
        }
        promotedFinals.push(finalArtifact);
        promotedCount++;
      } catch (err) {
        failed.push({
          artifactId: art.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (records.length > 0) {
      try {
        await insertPromotionRecords(records, surveyId);
      } catch (err) {
        // Non-fatal: promotion + upsert already happened; audit records are best-effort.
        console.warn(
          `[approve-aerial] Failed to persist promotion records for survey ${surveyId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const canonicalInputs = [...alreadyCanonical, ...promotedFinals].filter((a) =>
      CANONICAL_STATES.has(a.authority.state),
    );

    if (canonicalInputs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No aerial roof planes could be promoted to canonical.',
          failed,
        },
        { status: 422 },
      );
    }

    // Build + persist the CanonicalBuildingModel from the promoted roof planes.
    const model = buildCanonicalModel(
      surveyId,
      canonicalInputs,
      records.map((r) => r.id),
    );
    let persisted = false;
    try {
      await writeCanonicalModel(model);
      persisted = true;
    } catch (err) {
      console.warn(
        `[approve-aerial] Failed to persist canonical model for survey ${surveyId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    return NextResponse.json({
      success: true,
      persisted,
      summary: {
        aerialRoofPlanesFound: aerialRoofPlanes.length,
        promotedThisCall: promotedCount,
        alreadyCanonical: alreadyCanonical.length,
        canonicalRoofPlanes: model.roofPlanes.length,
        permitReadyRoofPlanes: canonicalToPermitRoofPlanes(model).length,
        modelAuthority: model.authority.state,
        failed: failed.length,
      },
      failed,
    });
  } catch (err) {
    console.error('[approve-aerial] Error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
