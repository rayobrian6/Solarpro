// ============================================================================
// lib/siteSurveys/googleSolarApi/types.ts
//
// TypeScript types for the Google Solar API buildingInsights response.
//
// These types model the subset of the Google Solar API response that we
// actually use for roof geometry extraction. The full API response contains
// many more fields (solar potential, financial analysis, panel configs, etc.)
// but we only care about the roof geometry: plane polygons, pitch, azimuth,
// and bounding box.
//
// API docs: https://developers.google.com/maps/documentation/solar
// ============================================================================

// ─── Coordinate Types ───────────────────────────────────────────────────────

/** A lat/lng pair from the Google Solar API. */
export interface SolarLatLng {
  latitude: number;
  longitude: number;
}

/**
 * A 2D point in the Solar API's "normalized image" coordinate system.
 *
 * The Solar API provides roof plane outlines as pixel coordinates relative
 * to the center of the aerial imagery. These are in a coordinate system
 * where (0, 0) is the center of the image, and units are pixels at the
 * imagery's native resolution.
 *
 * We need to convert these to our `normalized_image_0_1000` system for
 * compatibility with UnifiedGeometryArtifact.
 */
export interface SolarApiPixelPoint {
  x: number;
  y: number;
}

// ─── Roof Plane ─────────────────────────────────────────────────────────────

/**
 * A single roof plane from the Google Solar API.
 *
 * Each plane has:
 *   - A bounding box (pixel coordinates, relative to image center)
 *   - A polygon outline (pixel coordinates, relative to image center)
 *   - Pitch angle in degrees
 *   - Azimuth in degrees (clockwise from north)
 *   - Area in square meters
 *   - A unique index within the building
 */
export interface SolarRoofPlane {
  /** Bounding box of this roof plane in pixel coordinates. */
  boundingBox: SolarPixelBoundingBox;

  /** Polygon outline of this roof plane in pixel coordinates. */
  planeOutline: SolarPixelOutline;

  /** Pitch angle in degrees. 0 = flat, 90 = vertical. */
  roofPitch: number;

  /** Azimuth in degrees clockwise from north. 0 = north, 90 = east, etc. */
  azimuth: number;

  /** Area of this roof plane in square meters. */
  areaSqMeters: number;

  /** Index of this plane within the building (0-based). */
  planeIndex: number;

  /** Segmentation mask for this plane (optional, not always present). */
  segmentationMask?: SolarPixelOutline;
}

// ─── Bounding Box & Outline ─────────────────────────────────────────────────

/**
 * Axis-aligned bounding box in pixel coordinates.
 * Origin is the center of the aerial imagery.
 */
export interface SolarPixelBoundingBox {
  /** X coordinate of the top-left corner. */
  x: number;
  /** Y coordinate of the top-left corner. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * A polygon outline in pixel coordinates.
 * The polygon is defined by a list of vertices that form a closed shape.
 */
export interface SolarPixelOutline {
  /** Vertices of the polygon in pixel coordinates. */
  vertices: SolarApiPixelPoint[];
}

// ─── Building Insights Response ─────────────────────────────────────────────

/**
 * The full buildingInsights response from the Google Solar API.
 *
 * We only model the fields we use. The actual API response has many more
 * fields (solarPotential, financialAnalysis, panelConfigs, etc.) that we
 * ignore because our pipeline only cares about roof geometry.
 *
 * Response reference:
 * https://developers.google.com/maps/documentation/solar/reference/rest/v1/buildingInsights
 */
export interface BuildingInsightsResponse {
  /** Resource name (e.g., "buildings/12345"). */
  name?: string;

  /** Center of the building. */
  center?: SolarLatLng;

  /** Bounding box of the building in pixel coordinates. */
  boundingBox?: SolarPixelBoundingBox;

  /** URL of the aerial imagery used for analysis. */
  imageryUrl?: string;

  /** Date the imagery was acquired (e.g., "2023-06"). */
  imageryDate?: SolarDate;

  /** Date the building was last processed (e.g., "2024-01"). */
  imageryProcessedDate?: SolarDate;

  /** List of roof planes detected by the Solar API. */
  roofPlanes?: SolarRoofPlane[];

  // ─── Fields we intentionally ignore ────────────────────────────────
  // solarPotential, financialAnalysis, panelConfigs, etc.
  // We don't model these because our pipeline only uses roof geometry.
}

/** A date in YYYY-MM format as returned by the Solar API. */
export interface SolarDate {
  year: number;
  month: number;
  day?: number;
}

// ─── Pipeline C Configuration ───────────────────────────────────────────────

/** Configuration for the Google Solar API Pipeline C client. */
export interface GoogleSolarApiConfig {
  /** Google Maps API key with Solar API enabled. */
  apiKey: string;

  /**
   * Optional base URL override for testing.
   * Defaults to https://solar.googleapis.com
   */
  baseUrl?: string;
}

// ─── Pipeline C Result ──────────────────────────────────────────────────────

/**
 * Result of a Pipeline C (Google Solar API) run.
 *
 * Contains the raw BuildingInsightsResponse (if successful) and any
 * error or warning information.
 */
export interface PipelineCResult {
  /** Whether the pipeline ran successfully. */
  success: boolean;

  /** The raw BuildingInsights response, if successful. */
  buildingInsights: BuildingInsightsResponse | null;

  /** Error message, if unsuccessful. */
  error: string | null;

  /** Warnings encountered during the pipeline run. */
  warnings: string[];

  /** Number of roof planes extracted (0 if unsuccessful). */
  roofPlaneCount: number;

  /** Duration of the API call in milliseconds. */
  durationMs: number;
}
