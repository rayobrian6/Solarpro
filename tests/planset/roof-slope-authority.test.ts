// ═══════════════════════════════════════════════════════════════════════════
// A FABRICATED 20° ROOF REACHED THE WIND AND SNOW ANALYSIS
//
// `buildStructuralInputForPermit` opened with:
//
//     const roofPitchDeg = cad.roof?.planes?.[0]?.pitch ?? input.project.roofPitch ?? 20;
//
// That 20 is not decoration. `roofPitch` feeds `rooftopSolarPressureCoefficient`,
// whose entire job is to decide whether ASCE 7-22 Fig. 29.4-7 governs (the test
// is `slope > 7°`), and `calcRoofSnowLoad`, which picks the Cs slope factor. So
// a design whose CAD planes carried no pitch produced, on PV-4C:
//
//     "ASCE 7-22 Fig. 29.4-7 applies to roof slopes LESS THAN 7°;
//      this roof is 20.0°."
//
// — a slope this package never measured, attached to an engineering assumption
// the engineer of record is asked to accept. And the drafting layer's own
// fallback invented 5° for the same missing data: two fabricated roofs, one
// design.
//
// A second defect sat behind it. The engine publishes the Eq. 26.10-1 factor
// table, the derivation, the pressure-coefficient basis and the applicability
// verdict; PV-4C reads all five; and generatePermit's wind mapping carried NONE
// of them. The sheet printed "pressure coefficient basis not recorded" about a
// basis the engine had recorded, and the one sentence telling an engineer the
// cited figure does not govern this geometry never reached the roof sheet.
//
// These are MUTATION tests: they move the canonical roof plane and prove the
// wind analysis follows, rather than pinning today's numbers.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  projectGoverningRoofSlope, NON_AUTHORITATIVE_NOMINAL_SLOPE_DEG,
} from '@/lib/structural/roofSlopeAuthority';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Regenerate and return the flattened text of the whole package. */
function render(mutate?: (i: any) => void): { text: string; input: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&deg;/g, '°').replace(/&mdash;/g, '—').replace(/&sect;/g, '§')
    .replace(/\s+/g, ' ');
  return { text, input };
}

/** Move every canonical roof-plane record to one slope. */
function setAllPlaneSlopes(i: any, deg: number): void {
  for (const p of (i.project?.roofPlanes ?? [])) p.pitch = deg;
  for (const p of (i.layout?.geometry?.roofPlanes ?? [])) p.pitch = deg;
  for (const p of (i.project?.panelPositions ?? [])) p.tilt = deg;
  for (const p of (i.layout?.panels ?? [])) p.tilt = deg;
}

describe('the governing slope resolver', () => {
  it('takes the STEEPEST plane and names it', () => {
    const g = projectGoverningRoofSlope({
      cadPlanes: [
        { id: 'plane-shallow', pitch: 16.5 },
        { id: 'plane-steep', pitch: 18.2 },
      ],
    });
    expect(g.established).toBe(true);
    expect(g.slopeDeg).toBeCloseTo(18.2, 4);
    expect(g.planeId).toBe('plane-steep');
    expect(g.shallowestDeg).toBeCloseTo(16.5, 4);
    expect(g.basis).toMatch(/steepest of 2 roof planes/);
  });

  it('prefers a plane that carries MODULES over one that does not', () => {
    // A steeper plane with no array on it is not the roof the analysis is about.
    const g = projectGoverningRoofSlope({
      cadPlanes: [
        { id: 'garage', pitch: 35, moduleCount: 0 },
        { id: 'main', pitch: 18.2, moduleCount: 19 },
        { id: 'main-2', pitch: 16.5, moduleCount: 12 },
      ],
    });
    expect(g.planeId).toBe('main');
    expect(g.slopeDeg).toBeCloseTo(18.2, 4);
  });

  it('falls back to an operator pitch, and says it cannot name a plane', () => {
    const g = projectGoverningRoofSlope({ projectRoofPitchDeg: 22.5 });
    expect(g.established).toBe(true);
    expect(g.slopeDeg).toBe(22.5);
    expect(g.planeId).toBeNull();
    expect(g.basis).toMatch(/no roof plane geometry is on file/);
  });

  it('and with NOTHING on file it fabricates nothing', () => {
    const g = projectGoverningRoofSlope({});
    expect(g.established).toBe(false);
    expect(g.planeId).toBeNull();
    expect(g.slopeDeg).toBe(NON_AUTHORITATIVE_NOMINAL_SLOPE_DEG);
    // The nominal must not answer the Fig. 29.4-7 question by itself.
    expect(g.slopeDeg).toBeLessThanOrEqual(7);
    expect(g.basis).toMatch(/NO roof slope is established/);
  });

  it('never accepts a non-slope as a slope', () => {
    expect(projectGoverningRoofSlope({ cadPlanes: [{ pitch: NaN }] }).established).toBe(false);
    expect(projectGoverningRoofSlope({ cadPlanes: [{ pitch: -3 }] }).established).toBe(false);
    expect(projectGoverningRoofSlope({ cadPlanes: [{ pitch: 120 }] }).established).toBe(false);
    expect(projectGoverningRoofSlope({ cadPlanes: 'not-an-array' }).established).toBe(false);
  });
});

describe('the wind analysis follows the canonical plane — MUTATION', () => {
  it('no fabricated 20° survives anywhere in the package', () => {
    const { text } = render();
    expect(text).not.toMatch(/this roof is 20\.0°/);
    expect(text).not.toMatch(/(?<![\d.])20\.0\s*°/);
  });

  it('the applicability note states the CANONICAL governing plane slope', () => {
    const { text } = render();
    // Braidon: 16.5° and 18.2°; the steeper governs.
    expect(text).toMatch(/Fig\. 29\.4-7 applies to roof slopes LESS THAN 7°; this roof is 18\.2°/);
  });

  it('...and PV-4C names the plane that slope came from', () => {
    const { text } = render();
    expect(text).toMatch(/Roof Slope Basis/);
    expect(text).toMatch(/steepest of 2 roof planes[^§]{0,120}18\.2°/);
  });

  it('MUTATE the planes below 7° ⇒ the figure applies and the note disappears', () => {
    const { text } = render(i => setAllPlaneSlopes(i, 4));
    expect(text).not.toMatch(/applies to roof slopes LESS THAN/);
    // and the coefficient basis stops calling itself an assumption
    expect(text).toMatch(/ASCE 7-22 Fig\. 29\.4-7, zone/);
    expect(text).not.toMatch(/ENGINEERING ASSUMPTION \(see applicability note\)/);
  });

  it('MUTATE the planes to a steep roof ⇒ the note follows to that value', () => {
    const { text } = render(i => setAllPlaneSlopes(i, 33.3));
    expect(text).toMatch(/this roof is 33\.3°/);
    expect(text).not.toMatch(/this roof is 18\.2°/);
  });

  it('the derivation the engine records actually reaches the sheet', () => {
    // It was computed and dropped: PV-4C printed "pressure coefficient basis
    // not recorded" about a basis the engine had recorded.
    const { text } = render();
    expect(text).not.toMatch(/pressure coefficient basis not recorded/);
    expect(text).toMatch(/GCrn = /);
  });
});
