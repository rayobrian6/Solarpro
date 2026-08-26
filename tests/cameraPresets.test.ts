/**
 * tests/cameraPresets.test.ts
 *
 * Unit tests for lib/3d/cameraPresets.ts.
 *
 * What this guards:
 *   - TILTED_AERIAL_VIEW has the right Aurora-parity pose (45° pitch, north-look)
 *   - TOP_DOWN_VIEW is the right pose for orthographic-style layout work
 *   - computeRangeFromBounds matches the existing fitCameraToRoofPlanes formula
 *   - flyToPreset mutates the orbit state in place and triggers applyOrbit
 *   - buildCesiumCameraView gives a sensible Cesium Camera.setView input
 *
 * No Cesium, no DOM — pure math, runs in the node test environment.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TILTED_AERIAL_VIEW,
  TOP_DOWN_VIEW,
  computeRangeFromBounds,
  flyToPreset,
  buildCesiumCameraView,
  MIN_RANGE_M,
  RANGE_PADDING_FACTOR,
  type OrbitStateLike,
  type CameraPreset,
} from '@/lib/3d/cameraPresets';

// ─── Preset constants ───────────────────────────────────────────────────

describe('cameraPresets — TILTED_AERIAL_VIEW (Aurora parity)', () => {
  it('pitch is exactly -π/4 (45° down)', () => {
    // Aurora's 3D view is pitched at ~45° — AURORA_ANALYSIS §4. This is the
    // single most important assertion: the default camera angle matches Aurora.
    expect(TILTED_AERIAL_VIEW.pitch).toBeCloseTo(-Math.PI / 4, 10);
  });

  it('heading is π (camera south of target → look direction faces north)', () => {
    // Matches the existing convention in SolarEngine3D.tsx (line 522, 1371, 2006).
    // "look north" = the roof's typical 2D plan view in Cesium's WGS84 frame.
    expect(TILTED_AERIAL_VIEW.heading).toBeCloseTo(Math.PI, 10);
  });

  it('range is positive and within a sensible framing window (50–1000m)', () => {
    expect(TILTED_AERIAL_VIEW.range).toBeGreaterThan(0);
    expect(TILTED_AERIAL_VIEW.range).toBeLessThan(1000);
  });

  it('label is human-readable', () => {
    expect(TILTED_AERIAL_VIEW.label).toMatch(/Tilted Aerial/i);
  });
});

describe('cameraPresets — TOP_DOWN_VIEW', () => {
  it('pitch is -π/2 (straight down)', () => {
    expect(TOP_DOWN_VIEW.pitch).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('heading is 0 (camera north → look south)', () => {
    expect(TOP_DOWN_VIEW.heading).toBeCloseTo(0, 10);
  });

  it('range is positive', () => {
    expect(TOP_DOWN_VIEW.range).toBeGreaterThan(0);
  });
});

// ─── Range computation ──────────────────────────────────────────────────

describe('cameraPresets — computeRangeFromBounds', () => {
  it('exposes the tuning constants', () => {
    expect(MIN_RANGE_M).toBe(50);
    expect(RANGE_PADDING_FACTOR).toBe(1.4);
  });

  it('a sub-meter building still gets the 50m minimum', () => {
    expect(computeRangeFromBounds(0)).toBe(50);
    expect(computeRangeFromBounds(1)).toBe(50);
    expect(computeRangeFromBounds(10)).toBe(50);
  });

  it('a 20m building gets 20 * 1.4 = 28m, clamped up to 50m minimum', () => {
    // The MIN_RANGE clamp should win here — 20m is too small to use as-is.
    expect(computeRangeFromBounds(20)).toBe(50);
  });

  it('a 50m building gets 50 * 1.4 = 70m', () => {
    expect(computeRangeFromBounds(50)).toBe(70);
  });

  it('a 100m building gets 100 * 1.4 = 140m', () => {
    expect(computeRangeFromBounds(100)).toBe(140);
  });

  it('a very large building (500m) still gets a bounded range', () => {
    const r = computeRangeFromBounds(500);
    expect(r).toBe(500 * 1.4);
    expect(r).toBeLessThan(2000);
  });

  it('rejects non-finite or negative input by returning the minimum', () => {
    // Defensive: garbage in → 50m minimum out. Never NaN, never Infinity.
    expect(computeRangeFromBounds(-1)).toBe(50);
    expect(computeRangeFromBounds(NaN)).toBe(50);
    expect(computeRangeFromBounds(Infinity)).toBe(50);
    expect(computeRangeFromBounds(-Infinity)).toBe(50);
  });

  it('matches the existing fitCameraToRoofPlanes formula in SolarEngine3D', () => {
    // The existing formula is `Math.max(50, spanM * 1.4)` (line 2244).
    // This test pins our helper to that exact formula so callers can swap
    // between them without changing behavior.
    for (const span of [0, 5, 20, 30, 50, 75, 100, 250]) {
      const legacy = Math.max(50, span * 1.4);
      expect(computeRangeFromBounds(span)).toBe(legacy);
    }
  });
});

// ─── flyToPreset ────────────────────────────────────────────────────────

describe('cameraPresets — flyToPreset', () => {
  function makeOrbit(): OrbitStateLike {
    return {
      targetLat: 0,
      targetLng: 0,
      targetAlt: 0,
      heading: 0,
      pitch: 0,
      radius: 0,
    };
  }

  it('mutates the orbit state to the preset values', () => {
    const orbit = makeOrbit();
    const apply = vi.fn();
    flyToPreset(orbit, apply, TILTED_AERIAL_VIEW, {
      target: { lat: 38.818, lng: -77.082, height: 50 },
    });
    expect(orbit.heading).toBeCloseTo(Math.PI, 10);
    expect(orbit.pitch).toBeCloseTo(-Math.PI / 4, 10);
    expect(orbit.radius).toBe(TILTED_AERIAL_VIEW.range);
  });

  it('updates the target lat/lng/height from the option', () => {
    const orbit = makeOrbit();
    const apply = vi.fn();
    flyToPreset(orbit, apply, TILTED_AERIAL_VIEW, {
      target: { lat: 40.0, lng: -74.0, height: 25 },
    });
    expect(orbit.targetLat).toBe(40.0);
    expect(orbit.targetLng).toBe(-74.0);
    expect(orbit.targetAlt).toBe(25);
  });

  it('leaves the target untouched when no target is supplied', () => {
    const orbit = { ...makeOrbit(), targetLat: 12, targetLng: 34, targetAlt: 56 };
    flyToPreset(orbit, () => {}, TILTED_AERIAL_VIEW);
    expect(orbit.targetLat).toBe(12);
    expect(orbit.targetLng).toBe(34);
    expect(orbit.targetAlt).toBe(56);
  });

  it('calls applyOrbit exactly once', () => {
    const orbit = makeOrbit();
    const apply = vi.fn();
    flyToPreset(orbit, apply, TOP_DOWN_VIEW);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('rangeOverride wins over the preset range', () => {
    const orbit = makeOrbit();
    flyToPreset(orbit, () => {}, TILTED_AERIAL_VIEW, {
      rangeOverride: 87.5,
    });
    expect(orbit.radius).toBe(87.5);
  });

  it('computeRangeFromBounds output plugs into rangeOverride', () => {
    // Sanity: the documented integration pattern (compute range, pass it in)
    // works end-to-end.
    const orbit = makeOrbit();
    const range = computeRangeFromBounds(50);  // 70
    flyToPreset(orbit, () => {}, TILTED_AERIAL_VIEW, { rangeOverride: range });
    expect(orbit.radius).toBe(70);
  });
});

// ─── buildCesiumCameraView ──────────────────────────────────────────────

describe('cameraPresets — buildCesiumCameraView', () => {
  it('returns lat/lng/height plus look HPR for a Cesium setView call', () => {
    const v = buildCesiumCameraView(
      { lat: 38.818, lng: -77.082, height: 50 },
      TILTED_AERIAL_VIEW,
    );
    expect(v.destination).toMatchObject({
      latitude:  expect.any(Number),
      longitude: expect.any(Number),
      height:    expect.any(Number),
    });
    expect(v.orientation).toMatchObject({
      heading: expect.any(Number),
      pitch:   expect.any(Number),
      roll:    0,
    });
  });

  it('look heading = orbit heading + π (camera south → look north)', () => {
    const v = buildCesiumCameraView(
      { lat: 38.818, lng: -77.082 },
      TILTED_AERIAL_VIEW,
    );
    // Wrap π + π to keep the test deterministic across the [-π, π] branch.
    const expected = (TILTED_AERIAL_VIEW.heading + Math.PI + 2 * Math.PI) % (2 * Math.PI);
    const actual   = (v.orientation.heading + 2 * Math.PI) % (2 * Math.PI);
    // Allow either +0 or -0 representation
    const diff = Math.abs(expected - actual);
    const wrap = Math.min(diff, 2 * Math.PI - diff);
    expect(wrap).toBeLessThan(1e-6);
  });

  it('camera is positioned south of the target for TILTED_AERIAL_VIEW', () => {
    // heading = π → camera is south of target → look direction is north.
    // At -45° pitch, the camera's lat is LOWER than the target's lat.
    const target = { lat: 38.818, lng: -77.082, height: 50 };
    const v = buildCesiumCameraView(target, TILTED_AERIAL_VIEW);
    // Allow tiny noise from the small-angle lat/lng conversion.
    expect(v.destination.latitude).toBeLessThan(target.lat);
    // Height should be ABOVE the target (camera is up and south).
    expect(v.destination.height).toBeGreaterThan(target.height!);
  });

  it('camera is directly above the target for TOP_DOWN_VIEW', () => {
    const target = { lat: 38.818, lng: -77.082, height: 50 };
    const v = buildCesiumCameraView(target, TOP_DOWN_VIEW);
    // At pitch=-π/2, camera sits directly above the target (no lat/lng offset).
    expect(v.destination.latitude).toBeCloseTo(target.lat, 5);
    expect(v.destination.longitude).toBeCloseTo(target.lng, 5);
    // Height = target height + range (150m above).
    expect(v.destination.height).toBeCloseTo(target.height! + TOP_DOWN_VIEW.range, 5);
  });

  it('passes a custom preset straight through', () => {
    const custom: CameraPreset = {
      heading: Math.PI / 2,  // camera east → look west
      pitch:   -0.5,
      range:   200,
      label:   'Custom',
    };
    const target = { lat: 0, lng: 0, height: 0 };
    const v = buildCesiumCameraView(target, custom);
    // Camera east of origin → positive longitude.
    expect(v.destination.longitude).toBeGreaterThan(0);
    expect(v.destination.height).toBeGreaterThan(0);
  });
});

// ─── Type-level / shape sanity ───────────────────────────────────────────

describe('cameraPresets — type contract', () => {
  it('presets are frozen-shape compatible (readonly label, mutable math)', () => {
    // Both presets must satisfy the CameraPreset shape so they can be used
    // interchangeably in `flyToPreset(orbit, apply, preset)`.
    const presets: CameraPreset[] = [TILTED_AERIAL_VIEW, TOP_DOWN_VIEW];
    for (const p of presets) {
      expect(typeof p.heading).toBe('number');
      expect(typeof p.pitch).toBe('number');
      expect(typeof p.range).toBe('number');
      expect(typeof p.label).toBe('string');
      expect(isFinite(p.heading)).toBe(true);
      expect(isFinite(p.pitch)).toBe(true);
      expect(isFinite(p.range)).toBe(true);
    }
  });
});
