/**
 * GET /api/site-surveys/[surveyId]/geometry-reconstruction/artifacts
 *
 * Get all geometry reconstruction artifacts for a survey.
 * Returns grouped artifact response with counts.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getSiteSurveyById } from '@/lib/db-neon';
import { getArtifactsBySurvey } from '@/lib/db/geometryReconstruction';

export async function GET(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const surveyId = params?.surveyId ?? 'unknown';
  console.log(`[GET geometry-reconstruction/artifacts] surveyId=${surveyId}`);

  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    const result = await getArtifactsBySurvey(surveyId, user.id);

    // Group artifacts by type for easier frontend consumption
    const grouped: Record<string, number> = {};
    for (const artifact of result.artifacts) {
      grouped[artifact.artifactType] = (grouped[artifact.artifactType] ?? 0) + 1;
    }

    return NextResponse.json({
      success: true,
      ...result,
      groupedArtifactCounts: grouped,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[GET geometry-reconstruction/artifacts] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
