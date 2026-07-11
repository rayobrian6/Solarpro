import { describe, it, expect } from 'vitest';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { generatePermitHTML } from '../../lib/permit/generatePermit';
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

  it('the top-down site plan draws ALL systems: ground overlay + fence overlay on the roof plan', () => {
    // Ray: "the top down aerial view of the property gets all of the variety
    // from roof to ground and fence."
    const html = generatePermitHTML(mkInput());
    expect(html).toContain('GROUND MOUNT —');
    expect(html).toContain('SOLAR FENCE —');
    expect(html).toContain('pv2-hybrid');                       // overlay layer rendered
    expect(html).toContain('HYBRID DESIGN — THIS SET IS NOT PERMIT-READY'); // P0 banner stays until P2/P3
  });

  it('the roof sheet documents ONLY the roof subset (counts + drawn modules)', () => {
    // Stowell v2: the roof sheet claimed all modules on IronRidge and drew
    // ground/fence panels as floating roof modules with phantom setback
    // violations. The roof view + input are now scoped to the roof subset
    // (fixture: 4 roof of 12 total).
    const html = generatePermitHTML(mkInput());
    expect(html).toContain('(N) 4 PV MODULES');       // roof callout = subset
    expect(html).not.toContain('(N) 12 PV MODULES');  // never the project total
  });
});
