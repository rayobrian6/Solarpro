import { describe, it, expect } from 'vitest';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { roofProject } from '../../test-fixtures/roofProject';

// Hybrid P1: the CAD engine runs EVERY present solver with a SCOPED input and
// composes ONE CADModel carrying roof + ground + fence sections simultaneously
// (previously: single-winner switch; the fence solver consumed the unscoped
// input and claimed all modules — Stowell). generatePermit's delete guard is
// skipped for hybrids so the sections survive to the sheets.
describe('hybrid CAD composition', () => {
  const mkInput = () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const positions = input.project.panelPositions as any[];
    // Retag: first 4 fence, next 4 ground, rest roof (fixture has ≥12).
    positions.forEach((p: any, i: number) => {
      p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
    });
    if (input.layout?.panels) {
      (input.layout.panels as any[]).forEach((p: any, i: number) => {
        p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
      });
    }
    return input;
  };

  it('composes ONE CADModel with all present sections + per-section origins', () => {
    const cad: any = generateCADLayout(mkInput());
    expect(cad.hybrid).toBeDefined();
    const keys = cad.hybrid.sections.map((s: any) => s.key);
    expect(keys).toEqual(['roof', 'ground', 'fence']);
    // All three sections populated on one model.
    expect(cad.roof).toBeDefined();
    expect(cad.ground).toBeDefined();
    expect(cad.fence).toBeDefined();
    // Sections are SCOPED: each sub-solver saw only its own panels.
    const bySec = Object.fromEntries(cad.hybrid.sections.map((s: any) => [s.key, s]));
    expect(bySec.fence.totalPanels).toBe(4);
    expect(bySec.ground.totalPanels).toBe(4);
    expect(bySec.roof.totalPanels).toBeGreaterThanOrEqual(4);
    // Project-wide totals restored on the composed model.
    expect(cad.totalPanels).toBe((mkInput().project.panelPositions as any[]).length);
  });

  it('single-system designs take the legacy path (no hybrid metadata, one section)', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const cad: any = generateCADLayout(input);
    expect(cad.hybrid).toBeUndefined();
    expect(cad.roof).toBeDefined();
    expect(cad.ground).toBeUndefined();
    expect(cad.fence).toBeUndefined();
  });
});
