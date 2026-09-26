// ═══════════════════════════════════════════════════════════════════════════
// THE PERMIT'S WIND ANALYSIS WAS HARDCODED TO A 15 FT BUILDING
//
// `buildStructuralInputForPermit` carried:
//
//     meanRoofHeight: 15,
//
// with no fallback chain, no project read and no comment — sitting between a wind
// speed sourced from the canonical site, an exposure category sourced from the
// canonical site, and a span whose own last-resort literal is a NAMED
// `NON_AUTHORITATIVE_NOMINAL_SPAN_FT` precisely so that a number cannot masquerade
// as authority.
//
// That 15 is not decoration. It sets Kz, and therefore:
//
//     qz = 0.00256·Kz·Kzt·Kd·Ke·V²  →  net uplift  →  uplift per attachment
//                                   →  attachment count and spacing (PV-4C, PE-1)
//
// Measured on Exposure C at 115 mph: qz is 24.46 psf at 15 ft, 27.05 at 25 ft and
// 29.93 at 35 ft. So every building over one storey was analysed 10–22 % LOW — in
// the unsafe direction — and PV-4C printed the coefficient row `Kz 0.85 · Kzt 1.00`
// as though the derivation were checkable, while never printing the height those
// coefficients were read at. The sheet's own comment says the package published qz
// and the uplift and "not one occurrence of Kz, Kzt, Kd, Ke or the mean roof
// height"; the coefficient row fixed four of the five, and the fifth was the one
// that was wrong.
//
// 🚨 A CHANGELOG HAD ALREADY TALKED THE FIX OUT OF EXISTENCE. lib/version.ts says
// "meanRoofHeight wired to ASCE 7-22 Kz calc (was hardcoded 15 ft)". True of the
// engineering page. False of the permit — the document that gets sealed.
//
// These are MUTATION tests: they move the building and prove the stamped analysis
// follows, rather than pinning today's numbers. Every structural fixture in the
// repo happens to pin 15 ft, which is exactly why nothing caught this.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { buildStructuralInputForPermit } from '@/lib/permit/utils/structuralInput';
import { buildCanonical } from '@/lib/permit/utils/canonical';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT } from '@/lib/structural/meanRoofHeightAuthority';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const M = (ft: number) => ft / 3.28084;

/** Regenerate and return the flattened text of the whole package. */
function render(mutate?: (i: any) => void): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&deg;/g, '°').replace(/&mdash;/g, '—').replace(/&sect;/g, '§')
    .replace(/\s+/g, ' ');
}

/**
 * Attach a canonical building model, which is what the permit route does
 * (`enrichedBody._canonicalBuildingModel = canonicalBuildingModel`) and which no
 * structural fixture in this repo has ever carried.
 */
function withBuilding(i: any, opts: { stories?: number; wallHeightsFt?: number[] }): void {
  i._canonicalBuildingModel = {
    schemaVersion: 'canonical_building_model_v1',
    wallPlanes: (opts.wallHeightsFt ?? []).map((ft, n) => ({
      id: `wall-${n}`, estimatedHeightM: M(ft),
    })),
    metadata: opts.stories === undefined ? {} : { stories: opts.stories },
  };
}

/** Pull the structural input the permit actually builds, for the same fixture. */
function structuralInput(mutate?: (i: any) => void): any {
  const input: any = clone(braidonOriginalAuditFixture);
  mutate?.(input);
  // 🚨 THE PERMIT'S OWN BUILDERS, not a local imitation. generatePermit.ts:190
  // calls `generateCADLayout(input)` and passes that cad plus `buildCanonical(input)`
  // into `buildStructuralInputForPermit`. Reconstructing either one differently here
  // would make this test agree with itself rather than with the package.
  const canonical = buildCanonical(input);
  const cad = generateCADLayout(input);
  return buildStructuralInputForPermit(input, cad, canonical);
}

describe('🚨 the height the stamped wind analysis runs on', () => {
  it('a 3-storey building is NOT analysed as a 15 ft building', () => {
    const one = structuralInput(i => withBuilding(i, { stories: 1 }));
    const three = structuralInput(i => withBuilding(i, { stories: 3 }));

    expect(one.meanRoofHeight).toBe(15);
    expect(three.meanRoofHeight,
      'the permit still hardcodes the building height — a 3-storey house is being analysed as 15 ft')
      .toBeGreaterThan(one.meanRoofHeight);
    expect(three.meanRoofHeight).toBe(35);
  });

  it('modelled wall heights win over the storey classification', () => {
    const s = structuralInput(i => withBuilding(i, { stories: 3, wallHeightsFt: [9, 9] }));
    // The measurement governs, so a 3-storey CLASSIFICATION cannot inflate a building
    // whose own walls were modelled at 9 ft.
    expect(s.meanRoofHeight, 'the storey count overrode a real measurement').not.toBe(35);
    // 🚨 AND IT IS THE GEOMETRY'S OWN ANSWER, not merely "less than the storey one".
    // `toBeLessThan(20)` is satisfied by the hardcoded 15 this repair removed, so it
    // would have passed against the very defect under test.
    expect(s.meanRoofHeight).toBeGreaterThan(9);      // the eave, plus half a ridge rise
    expect(s.meanRoofHeight).toBeLessThan(13);        // but nowhere near a 3-storey 35
    expect(s.meanRoofHeight).not.toBe(15);
    expect(s.meanRoofHeightEstablished).toBe(true);
  });

  it('🚨 the operator\'s own Structural-tab height reaches the permit', () => {
    // It could not, at all, until `meanRoofHeight` was added to PermitInput['project']
    // and both of app/engineering/page.tsx's permit payloads carried it. The page's own
    // calculation had honoured the control all along; the sealed sheet had not.
    const s = structuralInput(i => { i.project.meanRoofHeight = 28; });
    expect(s.meanRoofHeight, 'the number the operator typed still does not reach the permit')
      .toBe(28);
    expect(s.meanRoofHeightEstablished).toBe(true);
  });

  it('and it OUTRANKS the modelled estimate', () => {
    const s = structuralInput(i => {
      i.project.meanRoofHeight = 28;
      withBuilding(i, { stories: 1, wallHeightsFt: [9, 9] });
    });
    expect(s.meanRoofHeight).toBe(28);
  });

  it('🚨 and an unmeasured building still analyses at 15 ft — deliberately', () => {
    // This repair is about what the sheet SAYS, not about silently re-pricing every
    // design with no building height on file. The number only moves when there is
    // real data to move it.
    const s = structuralInput();
    expect(s.meanRoofHeight).toBe(NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT);
    expect(s.meanRoofHeightEstablished).toBe(false);
  });

  it('🚨 a height that is an ASSUMPTION never claims to be established', () => {
    expect(structuralInput(i => withBuilding(i, { stories: 2 })).meanRoofHeightEstablished)
      .toBe(false);
    expect(structuralInput().meanRoofHeightEstablished).toBe(false);
    expect(structuralInput(i => withBuilding(i, { wallHeightsFt: [18] })).meanRoofHeightEstablished)
      .toBe(true);
  });
});

describe('🚨 the sealed sheet discloses the height it used', () => {
  it('PV-4C prints the mean roof height at all — it never did', () => {
    const text = render(i => withBuilding(i, { wallHeightsFt: [20, 20] }));
    expect(text, 'the stamped structural sheet still publishes Kz and qz without the height they came from')
      .toMatch(/Mean Roof Height/i);
  });

  it('and marks an assumed height ASSUMED, in the reviewer\'s words', () => {
    const assumed = render(i => withBuilding(i, { stories: 2 }));
    expect(assumed).toMatch(/Mean Roof Height/i);
    expect(assumed, 'a height derived from a storey count must not read as measured')
      .toMatch(/ASSUMED/);
    expect(assumed).toMatch(/per storey/);
  });

  it('a NOMINAL height says there is no building height on file', () => {
    const nominal = render();
    expect(nominal).toMatch(/NOMINAL/);
    expect(nominal).toMatch(/no building height on file/i);
  });

  it('a MEASURED height is not labelled assumed', () => {
    const measured = render(i => withBuilding(i, { wallHeightsFt: [20, 20] }));
    // The row is there, and it does not carry the assumption wording that the other
    // two branches do.
    expect(measured).toMatch(/Mean Roof Height/i);
    expect(measured).not.toMatch(/NOT a measured height/);
  });

  it('🚨 the printed height MOVES when the building does — end to end', () => {
    // The whole failure was a number that could not move. This is the case that
    // could not have passed before the repair, at any point in the chain:
    // resolver → structural input → V4 wind analysis → generatePermit mapping → PV-4C.
    const low = render(i => withBuilding(i, { wallHeightsFt: [10, 10] }));
    const high = render(i => withBuilding(i, { wallHeightsFt: [30, 30] }));
    const heightOf = (t: string) => {
      const m = t.match(/Mean Roof Height \(h\)\s*([0-9]+\.[0-9])\s*ft/i);
      expect(m, 'PV-4C is not printing a numeric mean roof height').toBeTruthy();
      return Number(m![1]);
    };
    // 🚨 TRACKS THE EAVE ONE-FOR-ONE. Both renders share the same roof, so the ridge
    // rise term is identical and the whole 20 ft difference in wall height has to
    // arrive in the printed h. A looser `high > low` would also pass on a height that
    // moved by an inch, which is the kind of assertion that let a hardcoded 15 survive.
    expect(heightOf(high) - heightOf(low)).toBeCloseTo(20, 1);
    // And h sits ABOVE the eave, because §26.3 adds half the ridge rise on an 18.2°
    // roof — asserting h === the eave would pin the wrong formula.
    expect(heightOf(low)).toBeGreaterThan(10);
    expect(heightOf(low)).toBeLessThan(20);
  });

  it('🚨 no internal identifier rides the sheet with it', () => {
    // A plane UUID has reached a stamped sheet in this repo before, which is why the
    // authority splits `basis` from `sheetBasis`. The wall ids are named `wall-0`
    // here; neither they nor any UUID may appear.
    const text = render(i => withBuilding(i, { wallHeightsFt: [20, 20] }));
    expect(text).not.toMatch(/wall-0/);
    expect(text).not.toMatch(/estimatedHeightM/);
  });
});
