// ============================================================================
// GET /api/site-surveys/[surveyId]/roof-obstructions
// Read-only query for roof obstruction data registered on roof_plane photos.
// No DB writes, no CAD mutation, no solver execution, no permit trigger.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getSiteSurveyById, getSiteSurveyFiles, isValidUUID, getDbReady } from '@/lib/db-neon';
import type { SiteSurveyFile } from '@/lib/db/surveys';
import { inferSurveyEvidenceCategoryFromText } from '@/lib/survey/evidence/manifest';
import type { SurveyEvidenceObstructionData } from '@/lib/survey/evidence/manifest';

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
          schemaVersion: 'roof_obstruction_query_v1',
          surveyId,
          roofPhotoCount: 0,
          roofPhotosWithObstructions: 0,
          totalObstructions: 0,
          photos: [],
          note: 'No roof_plane photos found for this survey. Obstruction data requires roof_plane classified photos with vision pipeline candidates.',
        },
      });
    }

    // Query obstruction_data from site_survey_files for roof_plane filenames
    const roofFilenames = [...new Set(roofPlaneFiles.map((f) => f.filename).filter(Boolean))] as string[];
    const obstructionDataByFilename = await queryObstructionData(surveyId, roofFilenames);

    // Build per-photo obstruction summaries
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
          tiny: 0,
          small: 0,
          medium: 0,
          large: 0,
          huge: 0,
        },
        obstructions: obstructionData?.obstructions ?? [],
      };
    });

    // Compute aggregate summary
    const photosWithObstructions = photos.filter(
      (p) => p.obstructionCount > 0,
    );
    const totalObstructions = photosWithObstructions.reduce(
      (sum, p) => sum + p.obstructionCount,
      0,
    );
    const reviewedObstructions = photosWithObstructions.reduce(
      (sum, p) => sum + p.obstructions.filter((o) => o.reviewed).length,
      0,
    );
    const typeDistribution: Record<string, number> = {};
    for (const photo of photosWithObstructions) {
      for (const obs of photo.obstructions) {
        const type = obs.obstructionType ?? 'unknown';
        typeDistribution[type] = (typeDistribution[type] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: 'roof_obstruction_query_v1',
        surveyId,
        roofPhotoCount: roofFilenames.length,
        roofPhotosWithObstructions: photosWithObstructions.length,
        totalObstructions,
        reviewedObstructions,
        obstructionTypeDistribution: typeDistribution,
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
 * Query obstruction_data JSONB column from site_survey_files for the given
 * roof_plane filenames. Returns a Map keyed by filename.
 *
 * The obstruction_data column is populated by the roof obstruction registration
 * pipeline (Step 7 in asyncPhotoVisionJobManager). If the column doesn't exist
 * yet (i.e., the pipeline hasn't run), returns an empty Map.
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
      // Column doesn't exist yet — pipeline hasn't run
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
          // obstruction_data is stored as JSONB, parsed automatically by neon
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
    // Return whatever we have (may be partial)
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
