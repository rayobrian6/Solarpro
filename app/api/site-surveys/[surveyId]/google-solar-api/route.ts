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
// ISOLATION NOTE: This route is COMPLETELY INDEPENDENT from the 3D design
// pipeline's /api/solar route. They share the same Google Solar API and the
// same env vars (GOOGLE_SOLAR_API_KEY || GOOGLE_MAPS_API_KEY || NEXT_PUBLIC_…)
// but make separate API calls, use different data models, and write to
// different DB tables:
//
//   - Pipeline C writes to   → unified_geometry_artifacts (overlay rendering)
//   - 3D design writes to    → project layout data (via DesignStudio save)
//   - Pipeline C coordinates → normalized_image_0_1000 (SVG overlays)
//   - 3D design coordinates  → lat/lng (Cesium 3D rendering)
//
// These pipelines MUST remain isolated. Do NOT share request objects
// or DB writes between them. (A shared process-level CACHE is used for cost
// optimization — it avoids duplicate API calls but does NOT share processing
// state or DB writes. Both pipelines still adapt and store data independently.)
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
import { getProjectById } from '@/lib/db/projects';
import { fetchBuildingInsights, isGoogleSolarApiConfigured } from '@/lib/siteSurveys/googleSolarApi/client';
import type { BuildingInsightsResponse } from '@/lib/siteSurveys/googleSolarApi/types';
import { adaptBuildingInsightsToUnifiedArtifacts, adaptSolarRoofSegmentsToWorldArtifacts } from '@/lib/siteSurveys/googleSolarApi/adapter';
import type { RoofSegmentStat } from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';
import {
  getCachedBuildingInsights,
  setCachedBuildingInsights,
  isValidBuildingInsightsData,
} from '@/lib/siteSurveys/googleSolarApi/cache';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

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
          error: 'Google Solar API is not configured. Set GOOGLE_SOLAR_API_KEY, GOOGLE_MAPS_API_KEY, or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable Pipeline C.',
        },
        { status: 503 }, // Service Unavailable
      );
    }

    // ─── Get lat/lng: auto-resolve from project if not provided ──────────
    // The caller can provide lat/lng explicitly in the request body.
    // If not provided, we auto-resolve from the survey's project data,
    // which stores geocoded lat/lng from the address lookup.
    // This eliminates the need for the frontend to prompt the user.
    const body = await req.json().catch(() => ({}));
    let latitude = body.latitude as number | undefined;
    let longitude = body.longitude as number | undefined;

    // If lat/lng not in request body, try to auto-resolve from project
    if (latitude === undefined || longitude === undefined) {
      if (survey.projectId) {
        try {
          const project = await getProjectById(survey.projectId, user.id);
          if (project && project.lat != null && project.lng != null) {
            latitude = project.lat;
            longitude = project.lng;
            console.info(
              `[POST google-solar-api] Auto-resolved lat/lng from project ${project.id}: lat=${latitude}, lng=${longitude}`,
            );
          }
        } catch (projErr) {
          console.warn(
            `[POST google-solar-api] Could not look up project for lat/lng: ${
              projErr instanceof Error ? projErr.message : String(projErr)
            }`,
          );
        }
      }
    }

    // If we still don't have coordinates, return a helpful error
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: survey.projectId
            ? 'No coordinates found. The project for this survey does not have geocoded latitude/longitude. Enter the project address first to geocode it, then retry Pipeline C.'
            : 'No coordinates found. This survey is not attached to a project with geocoded coordinates. Either attach it to a project with an address, or provide latitude/longitude in the request body.',
          code: 'NO_COORDINATES',
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

    // ─── Resolve buildingInsights data: pre-fetched → cache → API ──────────
    // Cost optimization: avoid duplicate $0.015/call to Google Solar API.
    //
    // 1. If the request body includes `buildingInsightsData`, use it directly
    //    (the frontend already has this data from the 3D design pipeline).
    // 2. If the process-level cache has data for this lat/lng, reuse it
    //    (the 3D design pipeline or a previous Pipeline C call cached it).
    // 3. Fall back to calling the Google Solar API (paid call).

    let buildingInsightsData: BuildingInsightsResponse | null = null;
    let dataSource: 'pre_fetched' | 'cache' | 'api' = 'api';
    let apiCallDurationMs = 0;
    let apiWarnings: string[] = [];

    // ─── Option 1: Pre-fetched data from request body ────────────────
    const preFetchedData = body.buildingInsightsData as unknown;
    if (preFetchedData && isValidBuildingInsightsData(preFetchedData)) {
      buildingInsightsData = preFetchedData as BuildingInsightsResponse;
      dataSource = 'pre_fetched';
      console.info(
        `[POST google-solar-api] Using pre-fetched buildingInsights data from request body for lat=${latitude}, lng=${longitude}`,
      );
      // Also cache it for future reuse
      setCachedBuildingInsights(latitude, longitude, buildingInsightsData, 'pre_fetched');
    }

    // ─── Option 2: Check process-level cache ─────────────────────────
    if (!buildingInsightsData) {
      const cached = getCachedBuildingInsights(latitude, longitude);
      if (cached.hit && cached.data) {
        buildingInsightsData = cached.data;
        dataSource = 'cache';
        console.info(
          `[POST google-solar-api] Cache HIT for lat=${latitude}, lng=${longitude} (age=${cached.ageMs ? (cached.ageMs / 1000).toFixed(0) + 's' : 'unknown'}, source=${cached.source})`,
        );
      }
    }

    // ─── Option 3: Call the Google Solar API (paid call) ─────────────
    if (!buildingInsightsData) {
      console.info(
        `[POST google-solar-api] Cache MISS — calling buildingInsights API for lat=${latitude}, lng=${longitude}`,
      );
      const result = await fetchBuildingInsights(latitude, longitude);

      if (!result.success) {
        // Distinguish "no coverage" (404 from Google) from other API failures.
        // A 404 from the Solar API means no building was found near the
        // requested location — this is expected for areas without coverage.
        // We return HTTP 404 with a structured code so the frontend can
        // show a clear "no coverage" panel instead of a generic error.
        const isNoCoverage =
          result.error?.includes('No building found') ||
          result.error?.includes('no coverage') ||
          result.error?.includes('may not have coverage');

        if (isNoCoverage) {
          return NextResponse.json(
            {
              success: false,
              error: result.error,
              code: 'NO_COVERAGE',
              guidance: 'The Google Solar API does not have aerial roof data for this location. This is common in rural areas or regions outside the US/EU. You can still use Pipeline B ("Generate Roof Geometry") to extract roof shapes from your survey photos.',
              warnings: result.warnings,
              durationMs: result.durationMs,
            },
            { status: 404 },
          );
        }

        // Other API errors (403, 429, timeout, etc.) — return as 502
        return NextResponse.json(
          {
            success: false,
            error: result.error ?? 'Google Solar API call failed',
            code: 'API_ERROR',
            warnings: result.warnings,
            durationMs: result.durationMs,
          },
          { status: 502 },
        );
      }

      buildingInsightsData = result.buildingInsights!;
      apiCallDurationMs = result.durationMs;
      apiWarnings = result.warnings ?? [];
      // Note: fetchBuildingInsights already writes to the cache internally,
      // so we don't need to call setCachedBuildingInsights here.
    }

    // ─── Adapt the response to unified artifacts ──────────────────────────
    const pixelArtifacts = adaptBuildingInsightsToUnifiedArtifacts(
      buildingInsightsData,
      surveyId,
    );
    // Phase 1 spine: AUTHORITATIVE lat/lng roof planes (worldPolygon) from the
    // raw `solarPotential.roofSegmentStats`. The pixel `roofPlanes` path above is
    // overlay-only and is empty for real Google responses; the world path is the
    // authoritative source the canonical model + permit planset consume. We drop
    // any pixel roof_plane duplicates so the world planes are the single source.
    const roofSegmentStats =
      (buildingInsightsData as unknown as {
        solarPotential?: { roofSegmentStats?: RoofSegmentStat[] };
      }).solarPotential?.roofSegmentStats ?? [];
    const worldRoofArtifacts = adaptSolarRoofSegmentsToWorldArtifacts(
      roofSegmentStats,
      surveyId,
      buildingInsightsData.name,
      buildingInsightsData.imageryDate
        ? `${buildingInsightsData.imageryDate.year}-${String(buildingInsightsData.imageryDate.month).padStart(2, '0')}`
        : undefined,
    );
    const artifacts = [
      ...pixelArtifacts.filter((a) => a.geometryClass !== 'roof_plane'),
      ...worldRoofArtifacts,
    ];
    console.info(
      `[POST google-solar-api] World roof planes from roofSegmentStats: ${worldRoofArtifacts.length} ` +
      `(raw segments=${roofSegmentStats.length}); pixel non-roof artifacts kept=${pixelArtifacts.filter((a) => a.geometryClass !== 'roof_plane').length}`,
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
        apiCallDurationMs: dataSource === 'api' ? apiCallDurationMs : 0,
        roofPlanesFromApi: buildingInsightsData.roofPlanes?.length ?? 0,
        dataSource, // 'pre_fetched' | 'cache' | 'api' — tells UI if data was fresh or reused
        cacheHit: dataSource !== 'api', // convenience boolean
      },
      writeResult: {
        inserted: writeResult.inserted,
        skipped: writeResult.skipped,
        failed: writeResult.failed,
      },
      warnings: apiWarnings,
      // Include imagery metadata for the UI to display
      imageryInfo: buildingInsightsData.imageryDate
        ? {
            date: `${buildingInsightsData.imageryDate.year}-${String(buildingInsightsData.imageryDate.month).padStart(2, '0')}`,
            processedDate: buildingInsightsData.imageryProcessedDate
              ? `${buildingInsightsData.imageryProcessedDate.year}-${String(buildingInsightsData.imageryProcessedDate.month).padStart(2, '0')}`
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
