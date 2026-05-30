// ============================================================================
// lib/siteSurveys/googleSolarApi/client.ts
//
// Google Solar API client — fetches buildingInsights data for a given
// lat/lng and returns structured roof plane geometry.
//
// This is Pipeline C in the roof geometry extraction system. Unlike
// Pipeline A (photo vision) and Pipeline B (geometry reconstruction),
// Pipeline C queries Google's pre-computed roof geometry, which provides:
//
//   - Real polygon outlines for each roof plane (not bounding boxes!)
//   - Accurate pitch and azimuth per plane
//   - Area per plane in square meters
//   - Building bounding box and imagery metadata
//
// API pricing: $0.015 per buildingInsights call.
// API coverage: ~40 countries (US, most of Europe, parts of Asia/Australia).
//
// API docs: https://developers.google.com/maps/documentation/solar
// ============================================================================

import type {
  BuildingInsightsResponse,
  GoogleSolarApiConfig,
  PipelineCResult,
} from './types';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://solar.googleapis.com';
const BUILDING_INSIGHTS_PATH = '/v1/buildingInsights:findClosest';

/** Minimum confidence for Google Solar API data — it's authoritative. */
const GOOGLE_SOLAR_API_CONFIDENCE = 95;

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Get the Google Solar API configuration from environment variables.
 *
 * Env var resolution order matches the existing 3D design pipeline
 * (app/api/solar/route.ts, app/api/solar-tile/route.ts, app/api/dsm/route.ts):
 *
 *   1. GOOGLE_SOLAR_API_KEY       (preferred, server-side only)
 *   2. GOOGLE_MAPS_API_KEY        (fallback — same key works for Solar API)
 *   3. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY  (last resort — client-exposed)
 *
 * ISOLATION NOTE: This client is used ONLY by Pipeline C (roof geometry
 * overlays on site survey photos). The 3D design pipeline uses its own
 * route at /api/solar which reads the SAME env vars independently. The two
 * pipelines never share runtime state, request objects, or DB tables.
 */
function getConfig(): GoogleSolarApiConfig {
  const apiKey =
    process.env.GOOGLE_SOLAR_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';

  return {
    apiKey,
    baseUrl: process.env.GOOGLE_SOLAR_API_BASE_URL ?? DEFAULT_BASE_URL,
  };
}

/**
 * Check whether the Google Solar API is configured (API key present).
 *
 * This is used by the UI to decide whether to show the Pipeline C button.
 * If no API key is configured, the button is disabled with a hint.
 */
export function isGoogleSolarApiConfigured(): boolean {
  const config = getConfig();
  return config.apiKey.length > 0;
}

/**
 * Fetch buildingInsights from the Google Solar API for a given location.
 *
 * This is the core Pipeline C operation. It takes a latitude and longitude,
 * calls the Google Solar API's buildingInsights endpoint, and returns the
 * full response including roof plane polygons, pitch, azimuth, and area.
 *
 * The API finds the closest building to the given lat/lng and returns its
 * pre-computed solar/roof data. If no building is found within a reasonable
 * radius, the API returns an error.
 *
 * @param latitude  - Latitude of the building location
 * @param longitude - Longitude of the building location
 * @param config    - Optional configuration override (for testing)
 * @returns PipelineCResult with the buildingInsights response or error
 */
export async function fetchBuildingInsights(
  latitude: number,
  longitude: number,
  config?: Partial<GoogleSolarApiConfig>,
): Promise<PipelineCResult> {
  const startMs = Date.now();
  const warnings: string[] = [];

  // ─── Validate inputs ───────────────────────────────────────────────────
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return {
      success: false,
      buildingInsights: null,
      error: 'Latitude and longitude must be numbers',
      warnings,
      roofPlaneCount: 0,
      durationMs: Date.now() - startMs,
    };
  }

  if (latitude < -90 || latitude > 90) {
    return {
      success: false,
      buildingInsights: null,
      error: `Latitude out of range: ${latitude} (must be -90 to 90)`,
      warnings,
      roofPlaneCount: 0,
      durationMs: Date.now() - startMs,
    };
  }

  if (longitude < -180 || longitude > 180) {
    return {
      success: false,
      buildingInsights: null,
      error: `Longitude out of range: ${longitude} (must be -180 to 180)`,
      warnings,
      roofPlaneCount: 0,
      durationMs: Date.now() - startMs,
    };
  }

  // ─── Get configuration ─────────────────────────────────────────────────
  const fullConfig = { ...getConfig(), ...config };

  if (!fullConfig.apiKey) {
    return {
      success: false,
      buildingInsights: null,
      error: 'Google Solar API key not configured. Set GOOGLE_SOLAR_API_KEY, GOOGLE_MAPS_API_KEY, or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY environment variable.',
      warnings,
      roofPlaneCount: 0,
      durationMs: Date.now() - startMs,
    };
  }

  // ─── Call the API ──────────────────────────────────────────────────────
  const url = `${fullConfig.baseUrl}${BUILDING_INSIGHTS_PATH}?location.latitude=${latitude}&location.longitude=${longitude}&requiredQuality=HIGH&key=${fullConfig.apiKey}`;

  try {
    console.info(
      `[Pipeline C] Fetching buildingInsights for lat=${latitude}, lng=${longitude}`,
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // Timeout after 30 seconds
      signal: AbortSignal.timeout(30_000),
    });

    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      const statusText = response.statusText ?? 'Unknown error';
      let errorBody = '';

      try {
        const body = await response.text();
        errorBody = body;
      } catch {
        // Ignore body read errors
      }

      // 404 means no building found near this location
      if (response.status === 404) {
        return {
          success: false,
          buildingInsights: null,
          error: 'No building found near this location in the Google Solar API database. The API may not have coverage for this area.',
          warnings: [...warnings, `API returned 404: ${errorBody}`],
          roofPlaneCount: 0,
          durationMs,
        };
      }

      // 403 means API key issue
      if (response.status === 403) {
        return {
          success: false,
          buildingInsights: null,
          error: 'Google Solar API access denied. Check that your API key has the Solar API enabled and billing is active.',
          warnings: [...warnings, `API returned 403: ${errorBody}`],
          roofPlaneCount: 0,
          durationMs,
        };
      }

      // 429 means rate limited
      if (response.status === 429) {
        return {
          success: false,
          buildingInsights: null,
          error: 'Google Solar API rate limit exceeded. Please wait and try again.',
          warnings: [...warnings, `API returned 429: ${errorBody}`],
          roofPlaneCount: 0,
          durationMs,
        };
      }

      return {
        success: false,
        buildingInsights: null,
        error: `Google Solar API returned ${response.status} ${statusText}`,
        warnings: [...warnings, `API error body: ${errorBody}`],
        roofPlaneCount: 0,
        durationMs,
      };
    }

    // Parse the JSON response
    const data = await response.json() as BuildingInsightsResponse;

    // Validate that we got roof plane data
    const roofPlaneCount = data.roofPlanes?.length ?? 0;

    if (roofPlaneCount === 0) {
      warnings.push(
        'Google Solar API returned a building with no roof planes. The building may not have roof geometry data available.',
      );
    }

    console.info(
      `[Pipeline C] buildingInsights success: ${roofPlaneCount} roof planes, ${durationMs}ms`,
    );

    return {
      success: true,
      buildingInsights: data,
      error: null,
      warnings,
      roofPlaneCount,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Distinguish timeout errors from other network errors
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return {
        success: false,
        buildingInsights: null,
        error: 'Google Solar API request timed out after 30 seconds.',
        warnings,
        roofPlaneCount: 0,
        durationMs,
      };
    }

    return {
      success: false,
      buildingInsights: null,
      error: `Google Solar API request failed: ${errorMessage}`,
      warnings,
      roofPlaneCount: 0,
      durationMs,
    };
  }
}
