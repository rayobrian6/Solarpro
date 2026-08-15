// ============================================================================
// GET   /api/site-surveys/[surveyId]  — survey detail + files
// PATCH /api/site-surveys/[surveyId]  — update (attach project, status, notes)
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyById,
  getSiteSurveyFiles,
  updateSiteSurvey,
  isValidUUID,
  getOpenSourcePhotoVisionCandidatesBySurvey,
} from '@/lib/db-neon';
import { buildSurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import { buildSurveyEvidenceTraceability } from '@/lib/survey/evidence/provenance';
import { buildSurveyEvidenceEngineeringBridge } from '@/lib/survey/evidence/engineeringBridge';
import { getProjectSurveyContext } from '@/lib/survey/getProjectSurveyContext';
import { analyzeSurveyPhotosOpenSource } from '@/lib/siteSurvey/photoIntelligence';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

// ---------------------------------------------------------------------------
// GET — survey detail + all files
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id);

    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // Authorization must happen before file/evidence loading. getSiteSurveyById
    // is user-scoped; only after it succeeds do we load survey files and derive
    // the manifest for the authorized survey.
    const files = await getSiteSurveyFiles(surveyId);
    let photoAnalysis: Awaited<ReturnType<typeof analyzeSurveyPhotosOpenSource>> = [];
    try {
      photoAnalysis = await analyzeSurveyPhotosOpenSource(files.filter(file => file.fileType === 'photo'));
    } catch (paErr) {
      // Photo analysis depends on sharp and image fetching — degrade gracefully
      // rather than failing the entire survey page.
      console.warn('[GET /api/site-surveys/[surveyId]] photo analysis unavailable:', paErr instanceof Error ? paErr.message : String(paErr));
    }
    const evidenceManifest = buildSurveyEvidenceManifest({ survey, files, photoAnalysis });
    let projectContext: Awaited<ReturnType<typeof getProjectSurveyContext>> | null = null;
    if (survey.projectId) {
      try {
        projectContext = await getProjectSurveyContext(survey.projectId, user.id);
      } catch (pcErr) {
        console.warn('[GET /api/site-surveys/[surveyId]] project survey context unavailable:', pcErr instanceof Error ? pcErr.message : String(pcErr));
      }
    }

    const evidenceHygiene = projectContext?.evidenceHygiene ?? null;
    // The survey detail endpoint must surface the freshly computed manifest.
    // Project hygiene manifests may be useful for historical duplicate/session
    // context, but they can be stale and must not mask current photo quality or
    // duplicate analysis in the survey workbench.
    const evidenceTraceability = buildSurveyEvidenceTraceability({
      canonicalManifest: evidenceManifest,
      evidenceTruthSource: 'canonical_manifest_v1',
    });
    const evidenceBridge = buildSurveyEvidenceEngineeringBridge(evidenceManifest, evidenceTraceability);
    let openSourcePhotoVision = null;
    try {
      openSourcePhotoVision = await getOpenSourcePhotoVisionCandidatesBySurvey(surveyId, user.id);
    } catch (ossErr) {
      // Review-only feature — must not block the survey page from loading.
      // The open_source_photo_vision_candidates table may not exist yet if
      // migration 023 has not been run, or the query may fail for other reasons.
      // Log and degrade gracefully instead of failing the entire GET.
      console.warn('[GET /api/site-surveys/[surveyId]] open-source photo vision candidates unavailable:', ossErr instanceof Error ? ossErr.message : String(ossErr));
    }

    return NextResponse.json({
      success: true,
      data: {
        survey,
        files,
        evidenceManifest,
        photoAnalysisSummary: summarizePhotoAnalysis(photoAnalysis),
        evidenceHygiene,
        evidenceTraceability,
        evidenceBridge,
        openSourcePhotoVision,
      },
    });
  } catch (err) {
    console.error('[GET /api/site-surveys/[surveyId]]', err);
    return NextResponse.json({ success: false, error: 'Failed to load survey' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — partial update (attach to project, change status, add notes)
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    // Validate projectId if provided
    if (body.projectId && !isValidUUID(body.projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    const validStatuses = ['draft', 'completed', 'reviewed'];
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const updated = await updateSiteSurvey(surveyId, user.id, {
      projectId:       body.projectId,
      status:          body.status,
      addressSnapshot: body.addressSnapshot,
      surveyData:      body.surveyData,
      notes:           body.notes,
      inspectorName:   body.inspectorName,
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Survey not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[PATCH /api/site-surveys/[surveyId]]', err);
    return NextResponse.json({ success: false, error: 'Failed to update survey' }, { status: 500 });
  }
}

function summarizePhotoAnalysis(photoAnalysis: Awaited<ReturnType<typeof analyzeSurveyPhotosOpenSource>>) {
  return {
    schemaVersion: 'survey_photo_open_source_analysis_summary_v1' as const,
    engine: 'sharp_sha256_perceptual_hash_laplacian_v1' as const,
    attemptedPhotoCount: photoAnalysis.length,
    analyzedPhotoCount: photoAnalysis.filter(item => item.analyzed).length,
    unavailablePhotoCount: photoAnalysis.filter(item => !item.analyzed).length,
    duplicateGroupCount: new Set(photoAnalysis.map(item => item.duplicateGroupId).filter(Boolean)).size,
    duplicatePhotoCount: photoAnalysis.filter(item => item.duplicateGroupSize > 1 && !item.isDuplicateRepresentative).length,
    qualityReviewRequiredCount: photoAnalysis.filter(item => item.qualityStatus !== 'good').length,
  };
}
