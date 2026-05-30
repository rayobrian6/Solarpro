// ============================================================================
// lib/siteSurveys/googleSolarApi/__tests__/integration.test.ts
//
// Integration tests for Pipeline C — real Google Solar API calls.
//
// These tests require a valid GOOGLE_SOLAR_API_KEY environment variable.
// They are automatically skipped when no key is present, so they never
// fail in CI or local development without a key.
//
// To run manually:
//   GOOGLE_SOLAR_API_KEY=your-key npx vitest run lib/siteSurveys/googleSolarApi/__tests__/integration.test.ts
//
// The test location is a well-known address near Google HQ in Mountain View, CA
// that has Solar API coverage. If coverage changes, the lat/lng may need updating.
// ============================================================================

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  fetchBuildingInsights,
} from '../client';
import {
  adaptBuildingInsightsToUnifiedArtifacts,
  adaptPipelineCResult,
} from '../adapter';
import {
  getCachedBuildingInsights,
  clearCache,
  getCacheStats,
} from '../cache';
import type { PipelineCResult } from '../types';

// ── Skip logic ──────────────────────────────────────────────────────────────

const apiKey =
  process.env.GOOGLE_SOLAR_API_KEY ??
  process.env.GOOGLE_MAPS_API_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  '';

const hasApiKey = apiKey.length > 0;

// A known location near Google HQ in Mountain View with Solar API coverage.
const TEST_LAT = 37.422;
const TEST_LNG = -122.0841;
const TEST_SURVEY_ID = 'integration-test-mv-001';

// ── Integration test suite ─────────────────────────────────────────────────

describe.skipIf(!hasApiKey)('Pipeline C integration (real API)', () => {
  // Clear cache between tests so each test starts fresh
  afterEach(() => {
    clearCache();
  });

  // ── fetchBuildingInsights ──────────────────────────────────────────────

  describe('fetchBuildingInsights', () => {
    it('fetches building insights for a known location', async () => {
      const result = await fetchBuildingInsights(TEST_LAT, TEST_LNG);

      expect(result.success).toBe(true);
      expect(result.buildingInsights).not.toBeNull();
      expect(result.error).toBeNull();
      expect(result.roofPlaneCount).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('returns a well-formed BuildingInsightsResponse', async () => {
      const result = await fetchBuildingInsights(TEST_LAT, TEST_LNG);

      expect(result.success).toBe(true);
      const insights = result.buildingInsights!;

      // The API should return at least name and center
      expect(insights.name).toBeDefined();
      expect(insights.center).toBeDefined();
      expect(insights.center!.latitude).toBeCloseTo(TEST_LAT, 1);
      expect(insights.center!.longitude).toBeCloseTo(TEST_LNG, 1);

      // Roof planes should exist
      expect(insights.roofPlanes).toBeDefined();
      expect(insights.roofPlanes!.length).toBeGreaterThan(0);
    });
  });

  // ── Cache behavior ─────────────────────────────────────────────────────

  describe('cache behavior', () => {
    it('caches the response after first fetch', async () => {
      // Ensure cache is empty
      clearCache();

      // First fetch — should hit the API
      const result = await fetchBuildingInsights(TEST_LAT, TEST_LNG);
      expect(result.success).toBe(true);

      // Check cache now has an entry
      const stats = getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      // Look up the same location in cache
      const cached = getCachedBuildingInsights(TEST_LAT, TEST_LNG);
      expect(cached.hit).toBe(true);
      expect(cached.data).toBeDefined();
      expect(cached.data!.roofPlanes!.length).toBe(
        result.buildingInsights!.roofPlanes!.length,
      );
    });
  });

  // ── adaptBuildingInsightsToUnifiedArtifacts ─────────────────────────────

  describe('adaptBuildingInsightsToUnifiedArtifacts', () => {
    let result: PipelineCResult;

    beforeAll(async () => {
      result = await fetchBuildingInsights(TEST_LAT, TEST_LNG);
      expect(result.success).toBe(true);
    });

    it('converts real API data to unified artifacts', () => {
      const artifacts = adaptBuildingInsightsToUnifiedArtifacts(
        result.buildingInsights!,
        TEST_SURVEY_ID,
      );

      expect(artifacts.length).toBeGreaterThan(0);

      // Should have at least roof planes
      const roofPlanes = artifacts.filter(
        (a) => a.geometryClass === 'roof_plane',
      );
      expect(roofPlanes.length).toBeGreaterThan(0);

      // Should have roof lines (inferred between planes)
      const roofLines = artifacts.filter(
        (a) => a.geometryClass === 'roof_line',
      );
      // At least some roof lines should be inferred for multi-plane roofs
      if (result.buildingInsights!.roofPlanes!.length > 1) {
        expect(roofLines.length).toBeGreaterThan(0);
      }
    });

    it('produces artifacts with valid coordinate ranges', () => {
      const artifacts = adaptBuildingInsightsToUnifiedArtifacts(
        result.buildingInsights!,
        TEST_SURVEY_ID,
      );

      for (const artifact of artifacts) {
        // All artifacts should have a surveyId
        expect(artifact.surveyId).toBe(TEST_SURVEY_ID);

        // Confidence should be 0–100
        expect(artifact.confidence).toBeGreaterThanOrEqual(0);
        expect(artifact.confidence).toBeLessThanOrEqual(100);

        // Check polygon coordinates if present
        if (artifact.polygon) {
          for (const vertex of artifact.polygon.vertices) {
            // Normalized image coordinates should be 0–1000
            expect(vertex.x).toBeGreaterThanOrEqual(0);
            expect(vertex.x).toBeLessThanOrEqual(1000);
            expect(vertex.y).toBeGreaterThanOrEqual(0);
            expect(vertex.y).toBeLessThanOrEqual(1000);
          }
        }

        // Check line segment coordinates if present
        if (artifact.lineSegment) {
          const { start, end } = artifact.lineSegment;
          for (const pt of [start, end]) {
            expect(pt.x).toBeGreaterThanOrEqual(0);
            expect(pt.x).toBeLessThanOrEqual(1000);
            expect(pt.y).toBeGreaterThanOrEqual(0);
            expect(pt.y).toBeLessThanOrEqual(1000);
          }
        }
      }
    });

    it('assigns correct geometryClass to each artifact', () => {
      const artifacts = adaptBuildingInsightsToUnifiedArtifacts(
        result.buildingInsights!,
        TEST_SURVEY_ID,
      );

      const validClasses = ['roof_plane', 'roof_line'];
      for (const artifact of artifacts) {
        expect(validClasses).toContain(artifact.geometryClass);
      }
    });

    it('populates plane-specific fields for roof_plane artifacts', () => {
      const artifacts = adaptBuildingInsightsToUnifiedArtifacts(
        result.buildingInsights!,
        TEST_SURVEY_ID,
      );

      const roofPlanes = artifacts.filter(
        (a) => a.geometryClass === 'roof_plane',
      );

      for (const plane of roofPlanes) {
        // Pitch should be 0–90 degrees
        expect(plane.pitchDegrees).not.toBeNull();
        expect(plane.pitchDegrees!).toBeGreaterThanOrEqual(0);
        expect(plane.pitchDegrees!).toBeLessThanOrEqual(90);

        // Azimuth should be 0–360 degrees
        expect(plane.azimuthDegrees).not.toBeNull();
        expect(plane.azimuthDegrees!).toBeGreaterThanOrEqual(0);
        expect(plane.azimuthDegrees!).toBeLessThanOrEqual(360);

        // Area should be positive
        expect(plane.areaSqM).not.toBeNull();
        expect(plane.areaSqM!).toBeGreaterThan(0);

        // Should have a polygon
        expect(plane.polygon).not.toBeNull();
        expect(plane.polygon!.vertices.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // ── adaptPipelineCResult convenience wrapper ───────────────────────────

  describe('adaptPipelineCResult', () => {
    it('returns empty array for failed result', () => {
      const failedResult: PipelineCResult = {
        success: false,
        buildingInsights: null,
        error: 'No API key',
        warnings: [],
        roofPlaneCount: 0,
        durationMs: 100,
      };

      const artifacts = adaptPipelineCResult(failedResult, TEST_SURVEY_ID);
      expect(artifacts).toEqual([]);
    });

    it('returns artifacts for successful result', async () => {
      const result = await fetchBuildingInsights(TEST_LAT, TEST_LNG);
      expect(result.success).toBe(true);

      const artifacts = adaptPipelineCResult(result, TEST_SURVEY_ID);
      expect(artifacts.length).toBeGreaterThan(0);

      // All artifacts should have the correct survey ID
      for (const artifact of artifacts) {
        expect(artifact.surveyId).toBe(TEST_SURVEY_ID);
      }
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error for out-of-range coordinates', async () => {
      const result = await fetchBuildingInsights(999, 999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Latitude out of range');
    });

    it('returns error for location with no buildings', async () => {
      // Middle of the ocean — very unlikely to have buildings
      const result = await fetchBuildingInsights(0, 0);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
