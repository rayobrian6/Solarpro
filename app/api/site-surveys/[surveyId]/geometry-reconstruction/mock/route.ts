/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/mock
 *
 * Convenience endpoint that runs the mock adapter, persists output,
 * and returns the result. Used for testing without the start/poll workflow.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getSiteSurveyById, getSiteSurveyFiles } from '@/lib/db-neon';
import {
  insertReconstructionJob,
  updateReconstructionJobStatus,
  insertReconstructionArtifact,
} from '@/lib/db/geometryReconstruction';
import { generateMockArtifacts } from '@/lib/siteSurveys/geometryReconstruction/mockAdapter';
import type { GeometryReconstructionInput, SourcePhoto } from '@/lib/siteSurveys/geometryReconstruction/types';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const surveyId = params?.surveyId ?? 'unknown';
  console.log(`[POST geometry-reconstruction/mock] surveyId=${surveyId}`);

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

    // Build source photos from survey files
    const files = await getSiteSurveyFiles(surveyId);
    const sourcePhotos: SourcePhoto[] = files.map((f: { id: string; url?: string; originalName?: string }) => ({
      fileId: f.id,
      fileUrl: f.url ?? '',
      filename: f.originalName ?? null,
    }));

    const input: GeometryReconstructionInput = {
      surveyId,
      sourcePhotos,
      pipeline: 'mock',
    };

    // Create job row
    const job = await insertReconstructionJob(surveyId, user.id, 'mock', input);

    // Generate mock artifacts
    const artifacts = generateMockArtifacts(input);

    // Persist each artifact
    for (const artifact of artifacts) {
      await insertReconstructionArtifact(job.id, surveyId, user.id, artifact, 'mock');
    }

    // Mark job as completed
    const completedJob = await updateReconstructionJobStatus(job.id, 'completed');

    // Build result
    const result = {
      schemaVersion: 'geometry_reconstruction_result_v1' as const,
      job: completedJob ?? { ...job, status: 'completed' as const, artifacts },
      artifactCount: artifacts.length,
      artifacts,
      authority: {
        reviewOnly: true as const,
        nonAuthoritative: true as const,
        cadMutationAllowed: false as const,
        permitGenerationAllowed: false as const,
        bomMutationAllowed: false as const,
      },
      limitations: [
        'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
        'MOCK DATA — NOT FROM REAL GEOMETRY PIPELINE',
      ],
    };

    // Grouped counts for frontend
    const grouped: Record<string, number> = {};
    for (const artifact of artifacts) {
      grouped[artifact.artifactType] = (grouped[artifact.artifactType] ?? 0) + 1;
    }

    return NextResponse.json({
      success: true,
      ...result,
      groupedArtifactCounts: grouped,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST geometry-reconstruction/mock] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
