import { describe, it, expect } from 'vitest';
import { roofCAD } from '../../lib/cad/roof/roofCAD';
import { groundCAD } from '../../lib/cad/ground/groundCAD';
import { roofProject } from '../../test-fixtures/roofProject';

// V0 verification findings (Stowell, 2026-07-11): CAD solvers fabricated
// modules the design never placed.
//  (a) roofCAD grid-filled EMPTY roof planes on a DESIGNED project — the
//      Stowell az-270 plane (0 designed panels) got 24 phantom modules,
//      inflating the roof table to 75 and tripping 19 phantom fire-setback
//      encroachments ("RELOCATE OR OBTAIN AHJ EXCEPTION" on a clean design).
//  (b) groundCAD's synthesized grid tiled rows×cols slots past the real
//      module count (26 ground panels → 6×5 = 30 slots → "GROUND MOUNT — 30
//      MOD" label + per-module BOM lines billed for 30).
describe('CAD solvers never fabricate modules on designed projects', () => {
  it('roofCAD leaves a designed-empty plane EMPTY instead of grid-filling it', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const planes = input.project.roofPlanes as any[];
    // Add a second, disjoint plane the design placed NO panels on.
    const p0 = planes[0];
    const dLat = 0.0005; // ~55m north — disjoint from plane 0 and its panels
    planes.push({
      ...p0,
      id: 'empty-plane',
      azimuth: 270,
      vertices: (p0.vertices as any[]).map(v => ({ lat: v.lat + dLat, lng: v.lng })),
    });

    const cad: any = roofCAD(input);
    const empty = cad.roof.planes.find((pl: any) => pl.id === 'empty-plane');
    expect(empty).toBeDefined();
    expect(empty.panels.length).toBe(0);   // was: a full synthetic grid
    // The designed plane keeps its real modules.
    const designed = cad.roof.planes.find((pl: any) => pl.id !== 'empty-plane');
    expect(designed.panels.length).toBe((input.project.panelPositions as any[]).length);
    // Model total = design total (no phantoms).
    const drawn = cad.roof.planes.reduce((s: number, pl: any) => s + pl.panels.length, 0);
    expect(drawn).toBe((input.project.panelPositions as any[]).length);
  });

  it('roofCAD still grid-fills when the project has NO designed panels (schematic mode)', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.panelPositions = [];
    if (input.layout) input.layout.panels = [];
    const cad: any = roofCAD(input);
    const drawn = cad.roof.planes.reduce((s: number, pl: any) => s + pl.panels.length, 0);
    expect(drawn).toBeGreaterThan(0);      // schematic fallback preserved
  });

  it('groundCAD synthesized grid emits EXACTLY system.totalPanels, never rows×cols slots', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.layout = { ...(input.layout ?? {}), type: 'ground_mount', groundArrays: undefined };
    input.system = { ...(input.system ?? {}), totalPanels: 26 };
    const cad: any = groundCAD(input);
    expect(cad.ground.arrays[0].panels.length).toBe(26);  // was 30 (6×5 slots)
    expect(cad.totalPanels).toBe(26);
    // No empty synthetic rows appended after the budget ran out.
    for (const row of cad.ground.arrays[0].rows) expect(row.panels.length).toBeGreaterThan(0);
  });
});
