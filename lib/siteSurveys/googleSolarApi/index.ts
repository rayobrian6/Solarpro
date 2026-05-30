// ============================================================================
// lib/siteSurveys/googleSolarApi/index.ts
//
// Barrel export for the Google Solar API Pipeline C module.
//
// This is the single entry point for all Pipeline C types, client, and
// adapter functions.
// ============================================================================

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  SolarLatLng,
  SolarApiPixelPoint,
  SolarRoofPlane,
  SolarPixelBoundingBox,
  SolarPixelOutline,
  BuildingInsightsResponse,
  SolarDate,
  GoogleSolarApiConfig,
  PipelineCResult,
} from './types';

// ─── Client ──────────────────────────────────────────────────────────────────
export {
  isGoogleSolarApiConfigured,
  fetchBuildingInsights,
} from './client';

// ─── Cache ───────────────────────────────────────────────────────────────────────────
export {
  getCachedBuildingInsights,
  setCachedBuildingInsights,
  isValidBuildingInsightsData,
  getCacheStats,
  clearCache,
  sweepExpiredEntries,
} from './cache';

// ─── Adapter ─────────────────────────────────────────────────────────────────
export {
  adaptBuildingInsightsToUnifiedArtifacts,
  adaptPipelineCResult,
} from './adapter';
