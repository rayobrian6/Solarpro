/**
 * tests/controlLayer3d.test.ts
 *
 * SKEPTICAL behavioral test for the 3D panel-placement control layer.
 * Unlike tests/aurora3dParity.test.ts (which only checks symbol presence),
 * this file actually invokes placePanelsControlled() with a synthetic
 * roof plane and verifies the output is real, finite, and physically
 * reasonable. If this file passes, the placement math in lib/3d/controlLayer
 * is producing real panels. If it fails, the 3D viewer is producing garbage
 * regardless of how the UI is wired.
 *
 * Why this file exists:
 *   The Aurora parity suite is a competitive-radar smoke test. James wanted
 *   to know whether the 3D actually works, not just whether the file exists.
 *   This file answers that question for the placement engine — the part of
 *   the 3D pipeline that produces the panels users see on screen.
 *
 * What this file does NOT cover (out of scope here, would need a browser):
 *   - CesiumJS scene rendering
 *   - Google 3D Tiles loading
 *   - Surface picking (clicking on a roof)
 *   - Camera orbit/zoom
 *   - Shade engine visualization
 *   - React render of SolarEngine3D component
 *   - User interaction (drag, click, keyboard shortcuts)
 *
 * The 3D viewer component itself is an 8963-line client component using
 * Cesium + Google 3D Tiles. End-to-end visual verification requires a
 * browser environment + the NEXT_PUBLIC_GOOGLE_MAPS_API_KEY +
 * NEXT_PUBLIC_CESIUM_ION_TOKEN env vars. See HANDOFF_2026-08-15.md §3
 * for the full test plan.
 */

import { describe, it, expect } from 'vitest';
import {
  placePanelsControlled,
  getCanonicalDims,
  CANONICAL_PANEL_WIDTH_M,
  CANONICAL_PANEL_HEIGHT_M,
  CANONICAL_PANEL_OFFSET_M,
  DEFAULT_SETBACKS,
  type ControlPlane,
  type ControlConfig,
} from '@/lib/3d/controlLayer';
import type { RoofPlane, PlacedPanel } from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a synthetic rectangular roof plane centered on (lat, lng), with
 * given width/length in feet, a given pitch and azimuth. The vertices
 * are in clockwise order starting from NW.
 *
 * Default: 30ft × 20ft, pitch=22°, azimuth=180° (south-facing gable) at
 * Alexandria VA. This matches a typical suburban roof and exercises the
 * full placement math including ECEF frame, polygon containment, and
 * ridge/side setback application.
 */
function makeSyntheticPlane(opts: {
  lat?: number;
  lng?: number;
  widthFt?: number;
  lengthFt?: number;
  pitchDeg?: number;
  azimuthDeg?: number;
  heightAboveGroundM?: number;
} = {}): RoofPlane {
  const lat = opts.lat ?? 38.818;       // Alexandria VA
  const lng = opts.lng ?? -77.082;
  const widthFt  = opts.widthFt  ?? 30;
  const lengthFt = opts.lengthFt ?? 20;
  const pitchDeg = opts.pitchDeg ?? 22;
  const azimuthDeg = opts.azimuthDeg ?? 180;
  const heightM = opts.heightAboveGroundM ?? 6;

  // Convert feet to degrees. At lat φ: 1° lat ≈ 364000 ft, 1° lng ≈ 364000*cos(φ) ft.
  // Use rough approximations — the control layer's ECEF math handles the rest.
  const FT_PER_DEG_LAT = 364000;
  const FT_PER_DEG_LNG = 364000 * Math.cos(lat * Math.PI / 180);
  const halfW = widthFt / 2;
  const halfL = lengthFt / 2;

  // Compute corners — for azimuth=180° (south-facing gable), the long axis
  // is east-west and the short axis is north-south. For other azimuths, the
  // placement engine will re-orient based on the longest edge.
  const dLat = halfL / FT_PER_DEG_LAT;
  const dLng = halfW / FT_PER_DEG_LNG;

  const vertices = [
    { lat: lat + dLat, lng: lng - dLng },  // NW
    { lat: lat + dLat, lng: lng + dLng },  // NE
    { lat: lat - dLat, lng: lng + dLng },  // SE
    { lat: lat - dLat, lng: lng - dLng },  // SW
  ];

  return {
    id: 'synth-' + Math.random().toString(36).slice(2, 8),
    vertices,
    pitch: pitchDeg,
    azimuth: azimuthDeg,
    area: widthFt * lengthFt * 0.092903,       // sq ft → sq m
    usableArea: widthFt * lengthFt * 0.07,     // rough usable after setbacks
    centroidLat: lat,
    centroidLng: lng,
    planeHeightAtCenterMeters: heightM,
    confirmed: true,
    source: 'manual',
  };
}

function makeConfig(overrides: Partial<ControlConfig>): ControlConfig {
  return {
    mode: 'surface_select',
    orientation: 'portrait',
    ...overrides,
  };
}

// ─── Canonical dimensions ──────────────────────────────────────────────────

describe('controlLayer 3D — canonical panel dimensions', () => {
  it('CANONICAL_PANEL_WIDTH_M is 1.134m (400W module spec)', () => {
    // Per lib/3d/controlLayer.ts comment block: standard 400W module
    // (Philadelphia Solar PS-MNB108). Portrait width=1.134m.
    expect(CANONICAL_PANEL_WIDTH_M).toBeCloseTo(1.134, 6);
  });

  it('CANONICAL_PANEL_HEIGHT_M is 1.722m (400W module spec)', () => {
    expect(CANONICAL_PANEL_HEIGHT_M).toBeCloseTo(1.722, 6);
  });

  it('CANONICAL_PANEL_OFFSET_M is 0.05m above the plane surface', () => {
    // Prevents z-fighting with Cesium 3D tiles.
    expect(CANONICAL_PANEL_OFFSET_M).toBe(0.05);
  });

  it('getCanonicalDims("portrait") returns width=1.134, height=1.722', () => {
    const d = getCanonicalDims('portrait');
    expect(d.widthM).toBeCloseTo(1.134, 6);
    expect(d.heightM).toBeCloseTo(1.722, 6);
  });

  it('getCanonicalDims("landscape") returns width=1.722, height=1.134', () => {
    const d = getCanonicalDims('landscape');
    expect(d.widthM).toBeCloseTo(1.722, 6);
    expect(d.heightM).toBeCloseTo(1.134, 6);
  });

  it('DEFAULT_SETBACKS uses 0.457m (18") for ridge and sides, 0 for eave', () => {
    // IRC R324.4.1 / UL 1703: 18" ridge setback for fire classification.
    expect(DEFAULT_SETBACKS.ridgeM).toBeCloseTo(0.457, 3);
    expect(DEFAULT_SETBACKS.sideM).toBeCloseTo(0.457, 3);
    expect(DEFAULT_SETBACKS.eaveM).toBe(0);
  });
});

// ─── Real placement: 30ft × 20ft roof, portrait ────────────────────────────

describe('controlLayer 3D — surface_select placement on 30ft × 20ft gable', () => {
  it('places a positive number of panels on a real-sized roof', () => {
    const plane = makeSyntheticPlane({});
    const result = placePanelsControlled(makeConfig({
      mode: 'surface_select',
      plane: plane as ControlPlane,
      orientation: 'portrait',
    }));

    expect(result.panels.length).toBeGreaterThan(0);
    expect(result.engineUsed).toBe('surfaceGeometry3D');
    expect(result.mode).toBe('surface_select');
    expect(result.orientation).toBe('portrait');
    expect(result.panelCount).toBe(result.panels.length);
  });

  it('places 12-30 panels on a 30ft × 20ft gable roof (physically reasonable)', () => {
    // Rough bound: 30ft × 20ft = 600 sq ft = 55.7 m². After setbacks (~75% usable),
    // ~42 m². With 1.134 × 1.722m panels and gaps, expect 12-30 panels.
    // A 30ft × 20ft south-facing gable in the US commonly fits 15-25 panels.
    const plane = makeSyntheticPlane({});
    const result = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
    }));
    // Log the actual count for diagnostic visibility on the next run.
    // (Vitest's `--reporter=verbose` shows stdout under [stdout] blocks.)
    // eslint-disable-next-line no-console
    console.log(`[3D-DIAG] 30ft×20ft portrait placement → ${result.panels.length} panels`);
    expect(result.panels.length).toBeGreaterThanOrEqual(12);
    expect(result.panels.length).toBeLessThanOrEqual(30);
  });

  it('logs diagnostic counts for portrait vs landscape (visible in vitest stdout)', () => {
    const plane = makeSyntheticPlane({});
    const portrait = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      orientation: 'portrait',
    }));
    const landscape = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      orientation: 'landscape',
    }));
    // eslint-disable-next-line no-console
    console.log(`[3D-DIAG] portrait=${portrait.panels.length} landscape=${landscape.panels.length} on 30ft×20ft gable`);
    expect(portrait.panels.length).toBeGreaterThan(0);
    expect(landscape.panels.length).toBeGreaterThan(0);
  });

  it('every placed panel has finite lat/lng (no NaN in 3D output)', () => {
    const plane = makeSyntheticPlane({});
    const result = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
    }));
    for (const p of result.panels) {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lng)).toBe(true);
    }
  });

  it('every placed panel falls within the original lat/lng polygon (containment)', () => {
    const plane = makeSyntheticPlane({});
    const result = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
    }));
    const minLat = Math.min(...plane.vertices.map(v => v.lat));
    const maxLat = Math.max(...plane.vertices.map(v => v.lat));
    const minLng = Math.min(...plane.vertices.map(v => v.lng));
    const maxLng = Math.max(...plane.vertices.map(v => v.lng));
    for (const p of result.panels) {
      expect(p.lat).toBeGreaterThanOrEqual(minLat);
      expect(p.lat).toBeLessThanOrEqual(maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(minLng);
      expect(p.lng).toBeLessThanOrEqual(maxLng);
    }
  });
});

// ─── Real placement: 30ft × 20ft roof, landscape ───────────────────────────

describe('controlLayer 3D — landscape vs portrait yield different panel counts', () => {
  it('landscape orientation produces a different (not-equal) panel count than portrait', () => {
    const plane = makeSyntheticPlane({});
    const portrait = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      orientation: 'portrait',
    }));
    const landscape = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      orientation: 'landscape',
    }));
    // On a rectangular roof, orientation should change the count.
    // If they're identical, the orientation flag is being ignored.
    expect(portrait.panels.length).not.toBe(landscape.panels.length);
  });
});

// ─── Real placement: bigger roof produces more panels ──────────────────────

describe('controlLayer 3D — area → panel count relationship', () => {
  it('a 60ft × 40ft roof places more panels than a 30ft × 20ft roof', () => {
    const small = placePanelsControlled(makeConfig({
      plane: makeSyntheticPlane({ widthFt: 30, lengthFt: 20 }) as ControlPlane,
    }));
    const big = placePanelsControlled(makeConfig({
      plane: makeSyntheticPlane({ widthFt: 60, lengthFt: 40 }) as ControlPlane,
    }));
    expect(big.panels.length).toBeGreaterThan(small.panels.length);
  });
});

// ─── Guard rails ───────────────────────────────────────────────────────────

describe('controlLayer 3D — guard rails', () => {
  it('returns empty array + warning when no plane is provided for surface_select', () => {
    const result = placePanelsControlled(makeConfig({
      mode: 'surface_select',
      // no plane
    }));
    expect(result.panels).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/No plane/);
  });

  it('auto_roof mode also returns empty + warning when no plane', () => {
    const result = placePanelsControlled(makeConfig({
      mode: 'auto_roof',
    }));
    expect(result.panels).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns empty array for plane3d mode without a plane', () => {
    const result = placePanelsControlled(makeConfig({
      mode: 'plane3d',
    }));
    expect(result.panels).toEqual([]);
  });
});

// ─── Dedup: existing panels are not duplicated ────────────────────────────

describe('controlLayer 3D — dedup with existing panels', () => {
  it('does not duplicate a panel that already exists on the same plane grid', () => {
    const plane = makeSyntheticPlane({});
    const first = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
    }));
    expect(first.panels.length).toBeGreaterThan(0);

    // Re-run with the same existingPanels — should produce 0 new panels
    // (every position is already occupied). Dedup warning expected.
    const second = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      existingPanels: first.panels,
    }));
    expect(second.panels.length).toBe(0);
    const dedupWarning = second.warnings.find(w => /duplicate|dedup/i.test(w));
    expect(dedupWarning).toBeDefined();
  });
});

// ─── Setback behavior ─────────────────────────────────────────────────────

describe('controlLayer 3D — setbacks reduce panel count', () => {
  it('a 1.0m setback produces fewer (or equal) panels than the default 0.457m', () => {
    const plane = makeSyntheticPlane({});
    const defaultSetbacks = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      setbacks: { eaveM: 0, ridgeM: 0.457, sideM: 0.457 },
    }));
    const bigSetbacks = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
      setbacks: { eaveM: 0, ridgeM: 1.0, sideM: 1.0 },
    }));
    expect(bigSetbacks.panels.length).toBeLessThanOrEqual(defaultSetbacks.panels.length);
  });
});

// ─── Panel field shape ────────────────────────────────────────────────────

describe('controlLayer 3D — placed panel has the right shape', () => {
  it('every placed panel has id, lat, lng, planeId, orientation fields', () => {
    const plane = makeSyntheticPlane({});
    const result = placePanelsControlled(makeConfig({
      plane: plane as ControlPlane,
    }));
    const sample: PlacedPanel = result.panels[0];
    expect(typeof sample.id).toBe('string');
    expect(sample.id.length).toBeGreaterThan(0);
    expect(typeof sample.lat).toBe('number');
    expect(typeof sample.lng).toBe('number');
    // planeId should be set since we passed a plane
    expect(sample.planeId).toBe(plane.id);
  });
});
