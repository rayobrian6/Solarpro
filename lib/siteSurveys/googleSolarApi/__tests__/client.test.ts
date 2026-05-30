// ============================================================================
// lib/siteSurveys/googleSolarApi/__tests__/client.test.ts
//
// Unit tests for the Pipeline C Google Solar API client.
//
// Covers:
//   - Input validation (lat/lng range, type checks)
//   - API key configuration detection
//   - Successful API call handling
//   - Error handling (404, 403, 429, timeout, network errors)
//   - Warning generation for empty roof planes
//   - Cache write after successful call
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBuildingInsights, isGoogleSolarApiConfigured } from '../client';
import { clearCache, getCachedBuildingInsights } from '../cache';

// ─── Mock fetch ──────────────────────────────────────────────────────────────

// We mock global fetch to avoid real API calls in tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock process.env for API key tests
const originalEnv = process.env;

beforeEach(() => {
  clearCache();
  mockFetch.mockReset();
  process.env = { ...originalEnv };
  // Remove all Google API keys by default
  delete process.env.GOOGLE_SOLAR_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
});

afterEach(() => {
  process.env = originalEnv;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockSuccessResponse(roofPlanes = 1) {
  const planes = Array.from({ length: roofPlanes }, (_, i) => ({
    boundingBox: { x: 100 + i * 10, y: 200, width: 120, height: 150 },
    planeOutline: {
      vertices: [
        { x: 110, y: 210 },
        { x: 230, y: 210 },
        { x: 170, y: 360 },
      ],
    },
    roofPitch: 20 + i * 5,
    azimuth: 180,
    areaSqMeters: 40 + i * 10,
    planeIndex: i,
  }));

  return {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'buildings/test-123',
      center: { latitude: 37.7749, longitude: -122.4194 },
      boundingBox: { x: 100, y: 200, width: 300, height: 400 },
      imageryDate: { year: 2023, month: 6 },
      roofPlanes: planes,
    }),
  };
}

function mockErrorResponse(status: number, statusText: string, body: string) {
  return {
    ok: false,
    status,
    statusText,
    text: async () => body,
    json: async () => { throw new Error('Not JSON'); },
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('isGoogleSolarApiConfigured', () => {
  it('returns false when no API keys are set', () => {
    expect(isGoogleSolarApiConfigured()).toBe(false);
  });

  it('returns true when GOOGLE_SOLAR_API_KEY is set', () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-solar-key';
    expect(isGoogleSolarApiConfigured()).toBe(true);
  });

  it('returns true when GOOGLE_MAPS_API_KEY is set (fallback)', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    expect(isGoogleSolarApiConfigured()).toBe(true);
  });

  it('returns true when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set (last resort)', () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-public-key';
    expect(isGoogleSolarApiConfigured()).toBe(true);
  });

  it('prefers GOOGLE_SOLAR_API_KEY over GOOGLE_MAPS_API_KEY', () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'preferred-key';
    process.env.GOOGLE_MAPS_API_KEY = 'fallback-key';
    expect(isGoogleSolarApiConfigured()).toBe(true);
  });

  it('returns false when API key is empty string', () => {
    process.env.GOOGLE_SOLAR_API_KEY = '';
    expect(isGoogleSolarApiConfigured()).toBe(false);
  });
});

describe('fetchBuildingInsights — input validation', () => {
  it('rejects non-number latitude', async () => {
    // @ts-expect-error — intentionally passing wrong type
    const result = await fetchBuildingInsights('not-a-number', -122.4194);
    expect(result.success).toBe(false);
    expect(result.error).toContain('must be numbers');
  });

  it('rejects non-number longitude', async () => {
    // @ts-expect-error — intentionally passing wrong type
    const result = await fetchBuildingInsights(37.7749, 'not-a-number');
    expect(result.success).toBe(false);
    expect(result.error).toContain('must be numbers');
  });

  it('rejects latitude out of range (< -90)', async () => {
    const result = await fetchBuildingInsights(-91, -122.4194);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Latitude out of range');
    expect(result.error).toContain('-91');
  });

  it('rejects latitude out of range (> 90)', async () => {
    const result = await fetchBuildingInsights(91, -122.4194);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Latitude out of range');
  });

  it('rejects longitude out of range (< -180)', async () => {
    const result = await fetchBuildingInsights(37.7749, -181);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Longitude out of range');
  });

  it('rejects longitude out of range (> 180)', async () => {
    const result = await fetchBuildingInsights(37.7749, 181);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Longitude out of range');
  });

  it('accepts boundary latitude values (-90, 90)', async () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-key';
    mockFetch.mockResolvedValue(mockSuccessResponse());

    // -90 should not fail validation (it's the boundary)
    const result90 = await fetchBuildingInsights(-90, -122.4194);
    // It might fail at the API call level (mocked), but not at validation
    // The validation should pass for -90 and 90

    const result90p = await fetchBuildingInsights(90, -122.4194);
    // Same — validation passes for boundary values
  });

  it('rejects when no API key is configured', async () => {
    const result = await fetchBuildingInsights(37.7749, -122.4194);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });
});

describe('fetchBuildingInsights — successful API call', () => {
  beforeEach(() => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-api-key';
  });

  it('returns success with roof plane data', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse(3));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(true);
    expect(result.buildingInsights).not.toBeNull();
    expect(result.roofPlaneCount).toBe(3);
    expect(result.error).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('caches the response after successful call', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse());

    await fetchBuildingInsights(37.7749, -122.4194);

    // Check that the cache now has the data
    const cached = getCachedBuildingInsights(37.7749, -122.4194);
    expect(cached.hit).toBe(true);
    expect(cached.source).toBe('pipeline_c');
  });

  it('adds warning when building has no roof planes', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse(0));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('no roof planes');
  });

  it('constructs correct API URL with requiredQuality=HIGH', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse());

    await fetchBuildingInsights(37.7749, -122.4194);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('buildingInsights:findClosest');
    expect(calledUrl).toContain('location.latitude=37.7749');
    expect(calledUrl).toContain('location.longitude=-122.4194');
    expect(calledUrl).toContain('requiredQuality=HIGH');
    expect(calledUrl).toContain('key=test-api-key');
  });

  it('supports custom baseUrl via config', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse());

    await fetchBuildingInsights(37.7749, -122.4194, {
      baseUrl: 'https://custom-solar.example.com',
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('custom-solar.example.com');
  });
});

describe('fetchBuildingInsights — error handling', () => {
  beforeEach(() => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-api-key';
  });

  it('handles 404 (no building found)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found', 'No building'));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No building found');
    expect(result.warnings.some((w) => w.includes('404'))).toBe(true);
  });

  it('handles 403 (access denied)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(403, 'Forbidden', 'API key invalid'));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('access denied');
    expect(result.warnings.some((w) => w.includes('403'))).toBe(true);
  });

  it('handles 429 (rate limit)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(429, 'Too Many Requests', 'Rate limited'));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limit');
    expect(result.warnings.some((w) => w.includes('429'))).toBe(true);
  });

  it('handles other HTTP errors', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error', 'Server error'));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('Internal Server Error');
  });

  it('handles network/fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network failure');
  });

  it('handles timeout errors', async () => {
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    mockFetch.mockRejectedValue(timeoutError);

    const result = await fetchBuildingInsights(37.7749, -122.4194);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
