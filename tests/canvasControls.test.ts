/**
 * tests/canvasControls.test.ts
 *
 * Unit tests for components/3d/controls/{heading.ts, zoom.ts}.
 *
 * What this guards:
 *   - headingToCompassRotationDeg is in [0, 360) and matches the
 *     convention used by the existing bottom-right compass in
 *     SolarEngine3D.tsx:10562 (`transform: rotate(${-cameraHeadingDeg}deg)`)
 *   - headingToCardinal maps 0/45/90/.../315 to N/NE/E/.../NW
 *   - computeZoomedRadius matches the existing wheel-zoom formula
 *     in SolarEngine3D.tsx:1751, 1867 (`radius * (1 + dir * 0.15)`)
 *   - both helpers are defensive against NaN / Infinity / negative
 *
 * No Cesium, no DOM, no React — pure math, runs in the node environment.
 */

import { describe, it, expect } from 'vitest';
import {
  headingToCompassRotationDeg,
  headingToCardinal,
  normalizeHeadingRad,
  normalizeHeadingDeg,
} from '@/components/3d/controls/heading';
import {
  computeZoomedRadius,
  ZOOM_STEP_FACTOR,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
} from '@/components/3d/controls/zoom';

// ─── headingToCompassRotationDeg ───────────────────────────────────────

describe('canvasControls — headingToCompassRotationDeg (Aurora parity)', () => {
  it('heading 0 (looking north) → rotation 0 (N at top, no rotation)', () => {
    // The needle is drawn with N at the top in its local frame, so a
    // looking-north camera needs zero rotation to keep N at the top.
    expect(headingToCompassRotationDeg(0)).toBe(0);
  });

  it('heading π/2 (looking east) → rotation 270 (N at left)', () => {
    // Looking east means the camera has rotated 90° CW from north. To
    // keep the N tip pointing to true north on the map, the needle
    // must rotate 270° CW (or equivalently 90° CCW). We emit CW-positive.
    expect(headingToCompassRotationDeg(Math.PI / 2)).toBeCloseTo(270, 10);
  });

  it('heading π (looking south) → rotation 180 (N at bottom)', () => {
    expect(headingToCompassRotationDeg(Math.PI)).toBeCloseTo(180, 10);
  });

  it('heading 3π/2 (looking west) → rotation 90 (N at right)', () => {
    expect(headingToCompassRotationDeg(3 * Math.PI / 2)).toBeCloseTo(90, 10);
  });

  it('heading -π/4 (looking NW) → rotation 45', () => {
    // -π/4 rad = -45° → negated = 45°. NW look → N tip lands NE.
    expect(headingToCompassRotationDeg(-Math.PI / 4)).toBeCloseTo(45, 10);
  });

  it('result is always in [0, 360)', () => {
    const samples = [
      0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2,
      Math.PI, 2 * Math.PI, -Math.PI, -2 * Math.PI,
      10 * Math.PI, 0.001, -0.001,
    ];
    for (const h of samples) {
      const r = headingToCompassRotationDeg(h);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });

  it('matches the existing bottom-right compass convention in SolarEngine3D', () => {
    // Line 10562 uses `transform: rotate(${-cameraHeadingDeg}deg)`.
    // Our function should produce the exact same value (modulo a clean
    // [0, 360) wrap). This is the Aurora-parity pin.
    for (const h of [-Math.PI, -Math.PI / 2, 0, Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI]) {
      const hDeg = (h * 180) / Math.PI;
      const expected = ((-hDeg % 360) + 360) % 360;
      expect(headingToCompassRotationDeg(h)).toBeCloseTo(expected, 10);
    }
  });

  it('rejects non-finite input by returning 0', () => {
    // Defensive: a busted Cesium heading should not break the strip.
    expect(headingToCompassRotationDeg(NaN)).toBe(0);
    expect(headingToCompassRotationDeg(Infinity)).toBe(0);
    expect(headingToCompassRotationDeg(-Infinity)).toBe(0);
  });
});

// ─── headingToCardinal ────────────────────────────────────────────────

describe('canvasControls — headingToCardinal (8-wind)', () => {
  it('maps 0° to N', () => {
    expect(headingToCardinal(0)).toBe('N');
  });

  it('maps 45° to NE', () => {
    expect(headingToCardinal(45)).toBe('NE');
  });

  it('maps 90° to E', () => {
    expect(headingToCardinal(90)).toBe('E');
  });

  it('maps 135° to SE', () => {
    expect(headingToCardinal(135)).toBe('SE');
  });

  it('maps 180° to S', () => {
    expect(headingToCardinal(180)).toBe('S');
  });

  it('maps 225° to SW', () => {
    expect(headingToCardinal(225)).toBe('SW');
  });

  it('maps 270° to W', () => {
    expect(headingToCardinal(270)).toBe('W');
  });

  it('maps 315° to NW', () => {
    expect(headingToCardinal(315)).toBe('NW');
  });

  it('N range: 337.5°–22.5° (wraps through 360°/0°)', () => {
    expect(headingToCardinal(337.5)).toBe('N');
    expect(headingToCardinal(350)).toBe('N');
    expect(headingToCardinal(359.9)).toBe('N');
    expect(headingToCardinal(22.4)).toBe('N');
  });

  it('handles negative and > 360 by wrapping', () => {
    expect(headingToCardinal(-90)).toBe('W');
    expect(headingToCardinal(450)).toBe('E');
    expect(headingToCardinal(-45)).toBe('NW');
  });

  it('matches the existing bottom-right compass readout in SolarEngine3D', () => {
    // Line 10588–10595 uses the same 22.5° half-bin boundaries.
    // Note: 67.5, 112.5, 157.5, 202.5, 247.5, 292.5 are bin BOUNDARIES
    // (strict-less-than), so they belong to the next bin. E.g. 112.5
    // returns 'SE', not 'E'. We test just-inside each bin to avoid
    // boundary ambiguity.
    const cases: Array<[number, 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW']> = [
      [0, 'N'], [22.4, 'N'], [22.5, 'NE'], [45, 'NE'],
      [67.4, 'NE'], [67.5, 'E'], [90, 'E'], [112.4, 'E'], [112.5, 'SE'], [135, 'SE'],
      [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'], [337.5, 'N'],
    ];
    for (const [h, expected] of cases) {
      expect(headingToCardinal(h)).toBe(expected);
    }
  });

  it('rejects non-finite input by returning N', () => {
    expect(headingToCardinal(NaN)).toBe('N');
    expect(headingToCardinal(Infinity)).toBe('N');
    expect(headingToCardinal(-Infinity)).toBe('N');
  });
});

// ─── normalizeHeading{Rad,Deg} ────────────────────────────────────────

describe('canvasControls — normalizeHeadingRad', () => {
  it('returns 0 for 0', () => {
    expect(normalizeHeadingRad(0)).toBe(0);
  });

  it('wraps 2π to 0', () => {
    expect(normalizeHeadingRad(2 * Math.PI)).toBeCloseTo(0, 12);
  });

  it('wraps negative values into [0, 2π)', () => {
    const r = normalizeHeadingRad(-Math.PI / 2);
    expect(r).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it('rejects non-finite', () => {
    expect(normalizeHeadingRad(NaN)).toBe(0);
    expect(normalizeHeadingRad(Infinity)).toBe(0);
  });
});

describe('canvasControls — normalizeHeadingDeg', () => {
  it('returns 0 for 0', () => {
    expect(normalizeHeadingDeg(0)).toBe(0);
  });

  it('wraps 360 to 0', () => {
    expect(normalizeHeadingDeg(360)).toBe(0);
  });

  it('wraps negative values into [0, 360)', () => {
    expect(normalizeHeadingDeg(-90)).toBe(270);
    expect(normalizeHeadingDeg(-180)).toBe(180);
  });

  it('rejects non-finite', () => {
    expect(normalizeHeadingDeg(NaN)).toBe(0);
    expect(normalizeHeadingDeg(Infinity)).toBe(0);
  });
});

// ─── ZOOM_STEP_FACTOR constant ────────────────────────────────────────

describe('canvasControls — ZOOM_STEP_FACTOR (Aurora parity)', () => {
  it('factor is 0.15 (matches the wheel-zoom in SolarEngine3D)', () => {
    // Pin the constant to the existing wheel-zoom behavior in
    // SolarEngine3D.tsx:1751, 1867. If that file's ZOOM_FACTOR ever
    // changes, this test will fail and force a deliberate update here.
    expect(ZOOM_STEP_FACTOR).toBe(0.15);
  });

  it('exposes the orbit-clamp range', () => {
    // SolarEngine3D.tsx:1671 clamps radius to [1.5, 50000].
    expect(MIN_RADIUS_M).toBe(1.5);
    expect(MAX_RADIUS_M).toBe(50_000);
  });
});

// ─── computeZoomedRadius ──────────────────────────────────────────────

describe('canvasControls — computeZoomedRadius', () => {
  it('zoom OUT (+1) at 100m → 115m (15% increase)', () => {
    expect(computeZoomedRadius(100, 1)).toBeCloseTo(115, 10);
  });

  it('zoom IN (−1) at 100m → 85m (15% decrease)', () => {
    expect(computeZoomedRadius(100, -1)).toBeCloseTo(85, 10);
  });

  it('zoom OUT at 150m → 172.5m (matches TILTED_AERIAL_VIEW default)', () => {
    // TILTED_AERIAL_VIEW.range = 150 (lib/3d/cameraPresets.ts:61).
    // One zoom-OUT click from the default pose → 172.5m. Useful
    // sanity check that the math matches the most common starting point.
    expect(computeZoomedRadius(150, 1)).toBeCloseTo(172.5, 10);
  });

  it('zoom IN clamps to MIN_RADIUS_M at low values', () => {
    // 2m * (1 - 0.15) = 1.7m → above MIN, not clamped yet.
    // But 1m * (1 - 0.15) = 0.85m → below MIN → clamp to 1.5m.
    expect(computeZoomedRadius(1, -1)).toBe(MIN_RADIUS_M);
    expect(computeZoomedRadius(0.5, -1)).toBe(MIN_RADIUS_M);
  });

  it('zoom OUT clamps to MAX_RADIUS_M at high values', () => {
    // 50000 * 1.15 = 57500 → above MAX → clamp to 50000.
    expect(computeZoomedRadius(MAX_RADIUS_M, 1)).toBe(MAX_RADIUS_M);
    // Just below the cap: 49000 * 1.15 = 56350 → clamp to 50000.
    expect(computeZoomedRadius(49_000, 1)).toBe(MAX_RADIUS_M);
  });

  it('does not undershoot at the lower bound (the clamp wins)', () => {
    // 1.7m * 0.85 = 1.445m → clamp to 1.5.
    const r = computeZoomedRadius(1.7, -1);
    expect(r).toBe(MIN_RADIUS_M);
  });

  it('factor parameter is honored', () => {
    // A 50% step: 100m * 1.5 = 150m.
    expect(computeZoomedRadius(100, 1, 0.5)).toBeCloseTo(150, 10);
    expect(computeZoomedRadius(100, -1, 0.5)).toBeCloseTo(50, 10);
  });

  it('custom min / max are honored', () => {
    expect(computeZoomedRadius(100, -1, 0.15, 0, 200)).toBeCloseTo(85, 10);
    expect(computeZoomedRadius(190, 1, 0.15, 0, 200)).toBe(200);
  });

  it('rejects non-finite currentRadius by returning min', () => {
    expect(computeZoomedRadius(NaN, -1)).toBe(MIN_RADIUS_M);
    expect(computeZoomedRadius(Infinity, 1)).toBe(MIN_RADIUS_M);
    expect(computeZoomedRadius(-Infinity, -1)).toBe(MIN_RADIUS_M);
    expect(computeZoomedRadius(0, -1)).toBe(MIN_RADIUS_M);
    expect(computeZoomedRadius(-5, 1)).toBe(MIN_RADIUS_M);
  });

  it('rejects non-finite factor by falling back to ZOOM_STEP_FACTOR', () => {
    // NaN factor → use 0.15 → 100m * 0.85 = 85m.
    expect(computeZoomedRadius(100, -1, NaN)).toBeCloseTo(85, 10);
    // Negative factor → use 0.15 → 100m * 1.15 = 115m.
    expect(computeZoomedRadius(100, 1, -0.5)).toBeCloseTo(115, 10);
  });

  it('matches the existing wheel-zoom formula in SolarEngine3D', () => {
    // Line 1867 uses `orbit.radius = orbit.radius * (1 + direction * ZOOM_FACTOR)`
    // with ZOOM_FACTOR = 0.15. Pin our helper to that exact formula so
    // the buttons and the wheel feel identical.
    for (const r of [10, 50, 100, 150, 500, 1000, 10_000]) {
      const legacyOut = r * (1 + 1 * 0.15);
      const legacyIn  = r * (1 + -1 * 0.15);
      const oursOut   = computeZoomedRadius(r, 1);
      const oursIn    = computeZoomedRadius(r, -1);
      // When neither side hits the clamps, the result must be bit-equal.
      if (r * 0.85 > MIN_RADIUS_M) {
        expect(oursIn).toBeCloseTo(legacyIn, 10);
      }
      if (r * 1.15 < MAX_RADIUS_M) {
        expect(oursOut).toBeCloseTo(legacyOut, 10);
      }
    }
  });

  it('round-trip: zoom out then in returns (close to) the original', () => {
    // 100m → 115m → 97.75m. Loses 2.25% to compounding. That's
    // intentional and matches the wheel-zoom behavior — the camera
    // doesn't try to remember its previous pose across zoom steps.
    const start = 100;
    const after = computeZoomedRadius(computeZoomedRadius(start, 1), -1);
    expect(after).toBeCloseTo(97.75, 10);
    expect(after).toBeLessThan(start);
  });
});

// ─── Type contract ────────────────────────────────────────────────────

describe('canvasControls — type contract sanity', () => {
  it('public exports are reachable through the index path', () => {
    // Smoke test: each exported function is callable with the same
    // signature documented in DESIGN.md. If a future refactor breaks
    // the import surface, this fails fast.
    expect(typeof headingToCompassRotationDeg).toBe('function');
    expect(typeof headingToCardinal).toBe('function');
    expect(typeof normalizeHeadingRad).toBe('function');
    expect(typeof normalizeHeadingDeg).toBe('function');
    expect(typeof computeZoomedRadius).toBe('function');
  });
});
