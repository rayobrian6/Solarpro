// De-skew the array to true lines — square out per-plane azimuth/grid noise.
import { describe, it, expect } from 'vitest';
import { deskewArrayToTrue } from '@/lib/permit/utils/deskewArrayToTrue';

const DEG = Math.PI / 180;

// Build a rectangular grid of panels on a plane, optionally rotated by `skewDeg`
// about the array centre, at a given base lat/lng.
function makeGrid(planeId: string, azimuth: number, rows: number, cols: number, skewDeg: number, baseLat = 38.7, baseLng = -90.0) {
  const cos = Math.cos(baseLat * DEG);
  const pitchLat = 1.5 / 111320;          // ~1.5 m rows
  const pitchLng = 1.1 / (111320 * cos);  // ~1.1 m cols
  const cRow = (rows - 1) / 2, cCol = (cols - 1) / 2;
  const th = skewDeg * DEG;
  const panels: any[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let dLat = (r - cRow) * pitchLat, dLng = (c - cCol) * pitchLng;
    // rotate about centre by skew
    const E = dLng * 111320 * cos, N = dLat * 111320;
    const E2 = E * Math.cos(th) - N * Math.sin(th), N2 = E * Math.sin(th) + N * Math.cos(th);
    dLng = E2 / (111320 * cos); dLat = N2 / 111320;
    panels.push({ lat: baseLat + dLat, lng: baseLng + dLng, azimuth, row: r, col: c, planeId });
  }
  return panels;
}

// Measure a plane's grid tilt (deg from cardinal) the same way the util does.
function measureTilt(panels: any[]) {
  const cos = Math.cos(panels[0].lat * DEG);
  let cx = 0, cy = 0, n = 0;
  for (const a of panels) for (const b of panels) {
    if (a.row === b.row && b.col - a.col === 1) { cx += (b.lng - a.lng) * cos; cy += (b.lat - a.lat); n++; }
  }
  const ang = Math.atan2(cy, cx) / DEG;
  return ((ang % 90) + 135) % 90 - 45;
}

describe('deskewArrayToTrue', () => {
  it('squares a skewed plane grid to true and snaps its azimuth', () => {
    // Dominant near-true plane + a west plane skewed 3.2°.
    const north = makeGrid('N', 3.2, 3, 5, 0.4);
    const west = makeGrid('W', 273.2, 3, 2, 3.2, 38.7005, -90.0006);
    const input = { project: { roofPlanes: [{ id: 'N', azimuth: 3.2 }, { id: 'W', azimuth: 273.2 }], panelPositions: [...north, ...west] } };

    const res = deskewArrayToTrue(input);
    expect(res.changed).toBe(true);
    // Azimuths snapped to cardinal
    expect(input.project.roofPlanes[0].azimuth).toBe(0);
    expect(input.project.roofPlanes[1].azimuth).toBe(270);
    // West grid tilt removed (was ~3.2° → ~0)
    const westAfter = input.project.panelPositions.filter(p => p.planeId === 'W');
    expect(Math.abs(measureTilt(westAfter))).toBeLessThan(0.3);
    // Panel count unchanged
    expect(input.project.panelPositions.length).toBe(north.length + west.length);
  });

  it('preserves a genuinely rotated building (all planes consistently off)', () => {
    // Every plane at 20° — that's the building's real orientation, not noise.
    const a = makeGrid('A', 20, 3, 5, 20);
    const b = makeGrid('B', 200, 3, 4, 20, 38.7005, -90.0006);
    const input = { project: { roofPlanes: [{ id: 'A', azimuth: 20 }, { id: 'B', azimuth: 200 }], panelPositions: [...a, ...b] } };
    const tiltA0 = measureTilt(a);
    deskewArrayToTrue(input);
    // The dominant tilt (~20° folded → -25°) is the target; planes already agree,
    // so they're barely moved (not force-snapped to cardinal).
    const aAfter = input.project.panelPositions.filter(p => p.planeId === 'A');
    expect(Math.abs(measureTilt(aAfter) - tiltA0)).toBeLessThan(0.5);
  });

  it('is a no-op-ish on an already-true array (no throw, minimal change)', () => {
    const north = makeGrid('N', 0, 3, 5, 0);
    const input = { project: { roofPlanes: [{ id: 'N', azimuth: 0 }], panelPositions: north } };
    const before = north.map(p => ({ lat: p.lat, lng: p.lng }));
    deskewArrayToTrue(input);
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(input.project.panelPositions[i].lat - before[i].lat)).toBeLessThan(1e-6);
      expect(Math.abs(input.project.panelPositions[i].lng - before[i].lng)).toBeLessThan(1e-6);
    }
  });

  it('handles empty / tiny input without throwing', () => {
    expect(deskewArrayToTrue({}).changed).toBe(false);
    expect(deskewArrayToTrue({ project: { roofPlanes: [], panelPositions: [] } }).changed).toBe(false);
  });
});
