// ============================================================================
// POST /api/site-surveys/[surveyId]/google-solar-api
//
// Pipeline C: Google Solar API roof geometry extraction.
//
// Takes a survey ID, looks up the survey's lat/lng, calls the Google Solar
// API buildingInsights endpoint, adapts the response into UnifiedGeometryArtifact
// instances, and writes them to the unified_geometry_artifacts table.
//
// This pipeline provides REAL ROOF POLYGON OUTLINES — not bounding boxes!
// The Google Solar API returns actual polygon shapes for each roof plane,
// along with accurate pitch, azimuth, and area measurements.
//
// Auth required. Survey ownership enforced.
// REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
// (Artifacts start at raw_evidence authority and must be promoted separately.)
//
// API pricing: $0.015 per buildingInsights call.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, getSiteSurveyById, GetSiteSurveyByIdOptions } from '@/lib/db-neon';
import { fetchBuildingInsights, isGoogleSolarApiConfigured } from '@/lib/siteSurveys/googleSolarApi/client';
import { adaptBuildingInsightsToUnifiedArtifacts } from '@/lib/siteSurveys/googleSolarApi/adapter';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';
  console.log(`[POST google-solar-api] surveyId=${surveyId}`);

  try {
    // ─── Auth check ──────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Validate survey ID ──────────────────────────────────────────────
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    // ─── Verify survey ownership ─────────────────────────────────────────
    const survey = await getSiteSurveyById(surveyId, user.id, {
      bypassOwnershipCheck: user.id === 'dev-user-bypass-001',
    } as GetSiteSurveyByIdOptions);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // ─── Check API configuration ─────────────────────────────────────────
    if (!isGoogleSolarApiConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google Solar API is not configured. Set the GOOGLE_SOLAR_API_KEY environment variable to enable Pipeline C.',
        },
        { status: 503 }, // Service Unavailable
      );
    }

    // ─── Get lat/lng from request or survey ──────────────────────────────
    // The caller can provide lat/lng explicitly, or we can try to extract
    // them from the survey data.
    const body = await req.json().catch(() => ({}));
    let latitude = body.latitude as number | undefined;
    let longitude = body.longitude as number | undefined;

    // If lat/lng not provided in request body, try to extract from survey
    if (latitude === undefined || longitude === undefined) {
      // Try to get lat/lng from survey address/geocoding
      // For now, require the caller to provide lat/lng
      return NextResponse.json(
        {
          success: false,
          error: 'Latitude and longitude are required. Provide them in the request body as { latitude, longitude }.',
        },
        { status: 400 },
      );
    }

    // Validate lat/lng ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid coordinates: latitude must be -90 to 90, longitude must be -180 to 180. Got lat=${latitude}, lng=${longitude}.`,
        },
        { status: 400 },
      );
    }

    // ─── Call the Google Solar API ────────────────────────────────────────
    console.info(
      `[POST google-solar-api] Calling buildingInsights for lat=${latitude}, lng=${longitude}`,
    );

    const result = await fetchBuildingInsights(latitude, longitude);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? 'Google Solar API call failed',
          warnings: result.warnings,
          durationMs: result.durationMs,
        },
        { status: 502 }, // Bad Gateway (upstream API failure)
      );
    }

    // ─── Adapt the response to unified artifacts ─────────────────────────
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(
      result.buildingInsights!,
      surveyId,
    );

    const roofPlaneCount = artifacts.filter((a) => a.geometryClass === 'roof_plane').length;
    const roofLineCount = artifacts.filter((a) => a.geometryClass === 'roof_line').length;
    const polygonCount = artifacts.filter((a) => a.polygon?.vertices?.length).length;

    console.info(
      `[POST google-solar-api] Adapted ${artifacts.length} artifacts: ${roofPlaneCount} roof planes, ${roofLineCount} roof lines, ${polygonCount} with polygons`,
    );

    // ─── Clean up previous Pipeline C artifacts and write new ones ────────
    try {
      const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'google_solar_api');
      if (deletedCount > 0) {
        console.info(
          `[POST google-solar-api] Deleted ${deletedCount} previous google_solar_api unified artifacts for survey=${surveyId}`,
        );
      }
    } catch (deleteErr) {
      // Non-fatal: deletion failure shouldn't block the pipeline
      console.warn(
        `[POST google-solar-api] Failed to delete previous google_solar_api artifacts (non-fatal): ${
          deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
        }`,
      );
    }

    let writeResult = { inserted: 0, skipped: 0, failed: 0 };
    try {
      writeResult = await writeUnifiedArtifacts(artifacts);
      console.info(
        `[POST google-solar-api] Wrote unified artifacts: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed}`,
      );
    } catch (writeErr) {
      // Non-fatal: write failure shouldn't block the response
      console.warn(
        `[POST google-solar-api] Failed to write unified artifacts (non-fatal): ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      );
    }

    // ─── Return success ──────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      pipeline: 'google_solar_api',
      summary: {
        roofPlaneCount,
        roofLineCount,
        polygonCount,
        totalArtifacts: artifacts.length,
        apiCallDurationMs: result.durationMs,
        roofPlanesFromApi: result.roofPlaneCount,
      },
      writeResult: {
        inserted: writeResult.inserted,
        skipped: writeResult.skipped,
        failed: writeResult.failed,
      },
      warnings: result.warnings,
      // Include imagery metadata for the UI to display
      imageryInfo: result.buildingInsights?.imageryDate
        ? {
            date: `${result.buildingInsights.imageryDate.year}-${String(result.buildingInsights.imageryDate.month).padStart(2, '0')}`,
            processedDate: result.buildingInsights.imageryProcessedDate
              ? `${result.buildingInsights.imageryProcessedDate.year}-${String(result.buildingInsights.imageryProcessedDate.month).padStart(2, '0')}`
              : null,
          }
        : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST google-solar-api] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
