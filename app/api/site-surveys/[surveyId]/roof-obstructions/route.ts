// ============================================================================
// GET /api/site-surveys/[surveyId]/roof-obstructions
// Read-only query for roof obstruction data registered on roof_plane photos.
// Phase 3B: Returns CAD-readiness fields, review status, priority, source photo traceability.
//
// No DB writes, no CAD mutation, no solver execution, no permit trigger.
// Review-only evidence refinement.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getSiteSurveyById, getSiteSurveyFiles, isValidUUID, getDbReady } from '@/lib/db-neon';
import type { SiteSurveyFile } from '@/lib/db/surveys';
import { inferSurveyEvidenceCategoryFromText } from '@/lib/survey/evidence/manifest';
import type { SurveyEvidenceObstructionData } from '@/lib/survey/evidence/manifest';

export async function GET(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
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

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // Fetch all photo files for this survey
    const files = (await getSiteSurveyFiles(surveyId)).filter(
      (file) => file.fileType === 'photo',
    );

    // Identify roof_plane files (by label or filename inference)
    const roofPlaneFiles = files.filter((file) => {
      const category = inferSurveyEvidenceCategoryFromText(
        file.label ?? file.filename ?? file.fileUrl,
      );
      return category === 'roof_plane';
    });

    if (roofPlaneFiles.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          schemaVersion: 'roof_obstruction_query_v2_phase3b',
          surveyId,
          roofPhotoCount: 0,
          roofPhotosWithObstructions: 0,
          totalObstructions: 0,
          aggregateStats: emptyAggregateStats(),
          photos: [],
          note: 'No roof_plane photos found for this survey. Obstruction data requires roof_plane classified photos with vision pipeline candidates.',
        },
      });
    }

    // Query obstruction_data from site_survey_files for roof_plane filenames
    const roofFilenames = [...new Set(roofPlaneFiles.map((f) => f.filename).filter(Boolean))] as string[];
    const obstructionDataByFilename = await queryObstructionData(surveyId, roofFilenames);

    // Build URL lookup for source photo traceability
    const fileUrlByFilename = new Map<string, string>();
    const fileIdByFilename = new Map<string, string>();
    for (const file of roofPlaneFiles) {
      if (file.filename) {
        fileUrlByFilename.set(file.filename, file.fileUrl);
        if (!fileIdByFilename.has(file.filename)) {
          fileIdByFilename.set(file.filename, file.id);
        }
      }
    }

    // Build per-photo obstruction summaries (Phase 3B enriched)
    const photos = roofFilenames.map((filename) => {
      const obstructionData = obstructionDataByFilename.get(filename) ?? null;
      const filesForFilename = roofPlaneFiles.filter((f) => f.filename === filename);
      const representativeFile = filesForFilename[0];

      return {
        filename,
        fileId: representativeFile?.id ?? null,
        fileUrl: representativeFile?.fileUrl ?? null,
        label: representativeFile?.label ?? null,
        obstructionCount: obstructionData?.obstructionCount ?? 0,
        avgConfidence: obstructionData?.avgConfidence ?? 0,
        reviewed: obstructionData?.reviewed ?? false,
        sizeDistribution: obstructionData?.sizeDistribution ?? {
          tiny: 0, small: 0, medium: 0, large: 0, huge: 0,
        },
        obstructions: (obstructionData?.obstructions ?? []).map(enrichObstructionForApi),
      };
    });

    // Compute aggregate summary (Phase 3B extended)
    const photosWithObstructions = photos.filter(
      (p) => p.obstructionCount > 0,
    );
    const allObstructions = photosWithObstructions.flatMap((p) => p.obstructions);
    const totalObstructions = allObstructions.length;

    const typeDistribution: Record<string, number> = {};
    const priorityDistribution = { high: 0, medium: 0, low: 0 };
    const reviewStateDistribution = { review_required: 0, accepted: 0, rejected: 0 };
    let highImpactCount = 0;
    let missingClassificationCount = 0;
    let totalConfidence = 0;
    let totalWithGeometry = 0;
    const byPhoto: Record<string, number> = {};

    for (const obs of allObstructions) {
      // Type distribution
      const type = (obs.obstructionType ?? 'unknown_obstruction') as string;
      typeDistribution[type] = (typeDistribution[type] ?? 0) + 1;

      // Priority distribution
      if (obs.priority === 'high') {
        priorityDistribution.high++;
        highImpactCount++;
      } else if (obs.priority === 'medium') {
        priorityDistribution.medium++;
      } else {
        priorityDistribution.low++;
      }

      // Review state distribution
      if (obs.reviewState === 'accepted') {
        reviewStateDistribution.accepted++;
      } else if (obs.reviewState === 'rejected') {
        reviewStateDistribution.rejected++;
      } else {
        reviewStateDistribution.review_required++;
      }

      // Missing classification
      if (!obs.obstructionType || obs.obstructionType === 'unknown_obstruction' || obs.obstructionType === 'unknown') {
        missingClassificationCount++;
      }

      totalConfidence += (obs.confidence as number) ?? 0;
      if (obs.center) totalWithGeometry++;
    }

    for (const photo of photosWithObstructions) {
      byPhoto[photo.filename] = photo.obstructionCount;
    }

    // CAD readiness quality score
    const classificationCompleteness = totalObstructions > 0
      ? ((totalObstructions - missingClassificationCount) / totalObstructions) * 40 : 0;
    const geometryCompleteness = totalObstructions > 0
      ? (totalWithGeometry / totalObstructions) * 30 : 0;
    const confidenceScore = totalObstructions > 0
      ? (totalConfidence / totalObstructions / 100) * 30 : 0;
    const cadReadinessQualityScore = Math.round(classificationCompleteness + geometryCompleteness + confidenceScore);

    const reviewedObstructions = reviewStateDistribution.accepted;

    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: 'roof_obstruction_query_v2_phase3b',
        surveyId,
        roofPhotoCount: roofFilenames.length,
        roofPhotosWithObstructions: photosWithObstructions.length,
        totalObstructions,
        aggregateStats: {
          reviewedObstructions,
          obstructionTypeDistribution: typeDistribution,
          obstructionPriorityDistribution: priorityDistribution,
          obstructionReviewStateDistribution: reviewStateDistribution,
          obstructionsByPhoto: byPhoto,
          highImpactObstructionCount: highImpactCount,
          cadReadinessQualityScore,
          missingClassificationCount,
        },
        photos,
        note: photosWithObstructions.length === 0
          ? 'Roof_plane photos were found but no obstruction data has been registered yet. Run the photo vision pipeline (open-source-photo-vision-pass) to generate obstruction candidates, then the obstruction registration step will populate this data.'
          : undefined,
      },
    });
  } catch (err) {
    console.error('[GET /api/site-surveys/[surveyId]/roof-obstructions]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to query roof obstruction data',
        detail: safeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}

/**
 * Enrich an obstruction record for API response with CAD impact badges.
 * Adds computed badges for front-end display.
 */
function enrichObstructionForApi(obs: Record<string, unknown>): Record<string, unknown> {
  const badges: string[] = [];

  // Priority badge
  if (obs.priority === 'high') badges.push('high_priority');
  if (obs.priority === 'medium') badges.push('medium_priority');

  // CAD impact badges
  if (obs.canAffectPanelPlacement) badges.push('affects_panels');
  if (obs.canAffectFirePathway) badges.push('affects_fire_path');
  if (obs.canAffectConduitPath) badges.push('affects_conduit');
  if (obs.canAffectStructuralAttachment) badges.push('affects_structural');

  // Review badge
  if (obs.reviewState === 'review_required') badges.push('needs_review');
  if (obs.reviewState === 'accepted') badges.push('reviewed_accepted');

  // Type badge
  if (obs.obstructionType && obs.obstructionType !== 'unknown_obstruction') {
    badges.push('classified');
  } else {
    badges.push('unclassified');
  }

  return {
    ...obs,
    cadImpactBadges: badges,
    // Ensure source photo traceability
    sourcePhotoLink: obs.sourcePhotoUrl ?? null,
  };
}

/**
 * Empty aggregate stats for when no roof photos exist.
 */
function emptyAggregateStats() {
  return {
    reviewedObstructions: 0,
    obstructionTypeDistribution: {},
    obstructionPriorityDistribution: { high: 0, medium: 0, low: 0 },
    obstructionReviewStateDistribution: { review_required: 0, accepted: 0, rejected: 0 },
    obstructionsByPhoto: {},
    highImpactObstructionCount: 0,
    cadReadinessQualityScore: 0,
    missingClassificationCount: 0,
  };
}

/**
 * Query obstruction_data JSONB column from site_survey_files for the given
 * roof_plane filenames. Returns a Map keyed by filename.
 */
async function queryObstructionData(
  surveyId: string,
  filenames: string[],
): Promise<Map<string, SurveyEvidenceObstructionData>> {
  const result = new Map<string, SurveyEvidenceObstructionData>();

  if (filenames.length === 0) return result;

  try {
    const sql = await getDbReady();

    // Check if obstruction_data column exists
    const columnCheck = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'site_survey_files'
        AND column_name = 'obstruction_data'
    `;

    if (columnCheck.length === 0) {
      return result;
    }

    // Query obstruction data for roof_plane files
    const rows = await sql`
      SELECT DISTINCT ON (filename)
        filename,
        obstruction_data
      FROM site_survey_files
      WHERE survey_id = ${surveyId}
        AND filename = ANY(${filenames})
        AND obstruction_data IS NOT NULL
      ORDER BY filename, created_at DESC
    `;

    for (const row of rows as Array<{ filename: string; obstruction_data: unknown }>) {
      if (row.filename && row.obstruction_data) {
        try {
          const data = typeof row.obstruction_data === 'string'
            ? JSON.parse(row.obstruction_data)
            : row.obstruction_data;
          if (data && typeof data === 'object' && 'obstructionCount' in data) {
            result.set(row.filename, data as SurveyEvidenceObstructionData);
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err) {
    console.error('[queryObstructionData] Failed to query obstruction data:', err);
  }

  return result;
}

function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'unknown error';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key[=:]\s*[^\s,;]+/gi, 'api_key=[redacted]')
    .slice(0, 500);
}
