/**
 * tests/measurements.test.ts
 *
 * Pure-math tests for the v66 Measurements + Ruler tools. Mirrors the
 * pattern in tests/block3d.test.ts: no Cesium, no React, no DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  EARTH_RADIUS_M,
  METER_TO_FEET,
  haversineMeters,
  slopeMeters,
  metersToFeet,
  formatFeetLabel,
  formatMeasurementLabel,
  buildMeasurement,
  midpoint,
  type LngLatH,
  type Measurement,
} from '@/lib/3d/measureMath';

const ALEX_LAT = 38.818;
const ALEX_LNG = -77.082;
const NYC_LAT  = 40.7128;
const NYC_LNG  = -74.0060;

const EQUATOR_A: LngLatH = { lat: 0, lng: 0, h: 0 };
const TEN_DEG_N: LngLatH = { lat: 10, lng: 0, h: 0 };

describe('measureMath — haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 5 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('returns 0 when two points have same lat/lng but different heights', () => {
    const a: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 };
    const b: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 100 };
    expect(haversineMeters(a, b)).toBe(0);
  });

  it('DC ↔ NYC is approximately 333 km (±10 km tolerance)', () => {
    const d = haversineMeters(
      { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 },
      { lat: NYC_LAT,  lng: NYC_LNG,  h: 0 },
    );
    expect(d).toBeGreaterThan(325_000);
    expect(d).toBeLessThan(345_000);
  });

  it('10° of latitude at the equator is approximately 1111 km', () => {
    const d = haversineMeters(EQUATOR_A, TEN_DEG_N);
    expect(d).toBeGreaterThan(1_108_000);
    expect(d).toBeLessThan(1_115_000);
  });

  it('a 10-meter east-west span at the equator is within 5% of 10 m', () => {
    const lngPer10mAtEquator = 10 / (EARTH_RADIUS_M * Math.cos(0) * Math.PI / 180);
    const a: LngLatH = { lat: 0, lng: 0, h: 0 };
    const b: LngLatH = { lat: 0, lng: lngPer10mAtEquator, h: 0 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(9.5);
    expect(d).toBeLessThan(10.5);
  });
});

describe('measureMath — slopeMeters', () => {
  it('equals haversine when heights are equal', () => {
    const a: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 10 };
    const b: LngLatH = { lat: NYC_LAT,  lng: NYC_LNG,  h: 10 };
    expect(slopeMeters(a, b)).toBeCloseTo(haversineMeters(a, b), 6);
  });

  it('equals |Δh| when points are geographically identical', () => {
    const a: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 };
    const b: LngLatH = { lat: ALEX_LAT, lng: ALEX_LNG, h: 5 };
    expect(slopeMeters(a, b)).toBe(5);
  });

  it('hypotenuse on a 3-4-5 triangle: horiz=4 m, Δh=3 m → slope=5 m', () => {
    const lngPer4m = 4 / (EARTH_RADIUS_M * Math.PI / 180);
    const a: LngLatH = { lat: 0, lng: 0, h: 0 };
    const b: LngLatH = { lat: 0, lng: lngPer4m, h: 3 };
    expect(slopeMeters(a, b)).toBeGreaterThan(4.95);
    expect(slopeMeters(a, b)).toBeLessThan(5.05);
  });
});

describe('measureMath — metersToFeet', () => {
  it('1 m is approximately 3.281 ft', () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 5);
  });

  it('100 m is approximately 328.1 ft', () => {
    expect(metersToFeet(100)).toBeCloseTo(328.084, 3);
  });

  it('0 m is 0 ft', () => {
    expect(metersToFeet(0)).toBe(0);
  });

  it('METER_TO_FEET matches the constant 3.28084', () => {
    expect(METER_TO_FEET).toBe(3.28084);
  });
});

describe('measureMath — formatFeetLabel', () => {
  it('≥ 10 ft uses 0 decimals (Aurora style)', () => {
    expect(formatFeetLabel(15)).toBe("49'");
  });

  it('< 10 ft uses 1 decimal (Aurora style)', () => {
    expect(formatFeetLabel(1)).toBe("3.3'");
  });

  it('decimals=2 produces 2-decimal label below 10 ft', () => {
    expect(formatFeetLabel(1, 2)).toBe("3.28'");
  });

  it('decimals=2 still rounds to integer at ≥10 ft', () => {
    expect(formatFeetLabel(15, 2)).toBe("49'");
  });
});

describe('measureMath — formatMeasurementLabel', () => {
  it('returns just the slope label when heights are equal', () => {
    const m: Measurement = buildMeasurement('id1',
      { lat: ALEX_LAT, lng: ALEX_LNG, h: 5 },
      { lat: NYC_LAT,  lng: NYC_LNG,  h: 5 },
    );
    const label = formatMeasurementLabel(m);
    expect(label).not.toContain('horiz');
  });

  it('adds "(horiz ...)" when the vertical component is ≥ 0.1 ft', () => {
    const m: Measurement = buildMeasurement('id1',
      { lat: 0, lng: 0, h: 0 },
      { lat: 0, lng: 5 / (EARTH_RADIUS_M * Math.PI / 180), h: 1 },
    );
    const label = formatMeasurementLabel(m);
    expect(label).toContain("'");
    expect(label).toContain('horiz');
  });
});

describe('measureMath — buildMeasurement', () => {
  it('preserves id and points', () => {
    const a: LngLatH = { lat: 1, lng: 2, h: 3 };
    const b: LngLatH = { lat: 4, lng: 5, h: 6 };
    const m = buildMeasurement('abc-123', a, b);
    expect(m.id).toBe('abc-123');
    expect(m.a).toEqual(a);
    expect(m.b).toEqual(b);
  });

  it('populates horizDistM and slopeDistM with the right relationship', () => {
    const m = buildMeasurement('m1',
      { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 },
      { lat: NYC_LAT,  lng: NYC_LNG,  h: 50 },
    );
    expect(m.slopeDistM).toBeGreaterThanOrEqual(m.horizDistM);
    expect(m.slopeDistM - m.horizDistM).toBeLessThan(0.001 * m.horizDistM);
  });

  it('zero-height difference → slopeDistM === horizDistM', () => {
    const m = buildMeasurement('m2',
      { lat: ALEX_LAT, lng: ALEX_LNG, h: 12 },
      { lat: NYC_LAT,  lng: NYC_LNG,  h: 12 },
    );
    expect(m.slopeDistM).toBeCloseTo(m.horizDistM, 6);
  });
});

describe('measureMath — midpoint', () => {
  it('lat/lng is the average of the two inputs', () => {
    const a: LngLatH = { lat: 10, lng: 20, h: 0 };
    const b: LngLatH = { lat: 30, lng: 40, h: 4 };
    const mid = midpoint(a, b);
    expect(mid.lat).toBe(20);
    expect(mid.lng).toBe(30);
  });

  it('h is the average + 0.3 m lift by default', () => {
    const a: LngLatH = { lat: 0, lng: 0, h: 0 };
    const b: LngLatH = { lat: 0, lng: 0, h: 4 };
    expect(midpoint(a, b).h).toBeCloseTo(2.3, 6);
  });

  it('custom liftM overrides the default', () => {
    const a: LngLatH = { lat: 0, lng: 0, h: 0 };
    const b: LngLatH = { lat: 0, lng: 0, h: 0 };
    expect(midpoint(a, b, 1.5).h).toBe(1.5);
  });
});
