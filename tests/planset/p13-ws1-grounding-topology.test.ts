// ═══════════════════════════════════════════════════════════════════════════
// PLANSET 13 · WS-1 — CANONICAL GROUNDING AND BONDING TOPOLOGY.
//
// The package modelled the AC branch EGC, the feeder EGC, the raceway bond and
// the (not-required) GEC — and NOTHING for the path that bonds the module /
// racking system to the rooftop equipment ground. So the planset could not
// explain its own array bonding path, and the #10 conductor the design installs
// had no object to belong to.
//
// THE RULING THIS ENCODES: the NEC 250.122 MINIMUM and the DESIGN SELECTION are
// different facts and are stored separately.
//     calculated minimum : #12 Cu   (the code table, at the 20 A branch OCPD)
//     selected design    : #10 Cu   (the project standard — larger, permitted)
// No sheet may claim the code table produced #10.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import {
  ARRAY_RACK_BONDING_DESIGN_SIZE, conductorAreaRank, meetsOrExceedsMinimum,
} from '@/lib/permit/snapshot/groundingDesignStandard';
import { getEGCSize } from '@/lib/manufacturer-specs';
import type { PermitDesignSnapshot, GroundingRecord } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile = 'design-review') {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

const PKG = gen();
const gnd = (id: string): GroundingRecord =>
  PKG.snap.electrical.groundingObjects.find(g => g.groundingId === id)!;

describe('WS-1 — the array/racking bonding segment exists and is canonical', () => {
  it('the segment is generated', () => {
    const g = gnd('gnd-array-bond');
    expect(g, 'no array/racking bonding segment was generated').toBeTruthy();
    expect(g.segmentRole).toBe('ARRAY_RACK_BONDING_EGC');
    expect(g.required).toBe(true);
    expect(g.method).toBe('conductor');
  });

  it('it has REAL source and destination nodes, not the route circuit\'s endpoints', () => {
    const g = gnd('gnd-array-bond');
    expect(g.sourceNode).toMatch(/racking/i);
    expect(g.destinationNode).toMatch(/junction box/i);
    // the route segment it shares describes a different circuit
    expect(g.sourceNode).not.toMatch(/MICROINVERTERS/i);
  });

  it('it is bare, free-air, and bound to a route + a calculation id', () => {
    const g = gnd('gnd-array-bond');
    expect(g.insulationState).toBe('bare');
    expect(g.installationMethod).toBe('free-air');
    expect(g.routeId).toBeTruthy();
    expect(g.calculationId).toBeTruthy();
  });
});

describe('WS-1 — the code minimum and the design selection are separate facts', () => {
  it('#12 Cu is the CALCULATED MINIMUM for the current 20 A branch', () => {
    const g = gnd('gnd-array-bond');
    expect(g.associatedOcpdA).toBe(20);
    expect(g.calculatedMinimumSize).toBe('#12 AWG');
    expect(getEGCSize(20)).toBe('#12 AWG');   // the table itself
  });

  it('#10 Cu is the SELECTED project design conductor, and is what is installed', () => {
    const g = gnd('gnd-array-bond');
    expect(g.selectedDesignSize).toBe(ARRAY_RACK_BONDING_DESIGN_SIZE);
    expect(g.selectedDesignSize).toBe('#10 AWG');
    expect(g.conductorSize).toBe('#10 AWG');
    expect(g.selectionSource).toBe('project-design-standard');
    expect(g.selectionReason).toBeTruthy();
  });

  it('NO text claims the code table calculated #10', () => {
    // The sizing basis must attribute #12 to 250.122 and #10 to the design std.
    const g = gnd('gnd-array-bond');
    expect(g.sizingBasis).toMatch(/250\.122 minimum #12 AWG/);
    expect(g.sizingBasis).toMatch(/#10 AWG per project design standard/);
    expect(g.sizingBasis).not.toMatch(/250\.122[^.]{0,40}#10/);
    // and nowhere in the package
    expect(PKG.html).not.toMatch(/250\.122[^<]{0,30}requires?[^<]{0,10}#10/i);
  });

  it('a record at the minimum says so explicitly rather than leaving it implied', () => {
    for (const id of ['gnd-br-1', 'gnd-feeder']) {
      const g = gnd(id);
      expect(g.selectionSource).toBe('nec-minimum');
      expect(g.selectedDesignSize).toBeNull();
      expect(g.conductorSize).toBe(g.calculatedMinimumSize);
    }
  });

  it('changing the OCPD recalculates the MINIMUM (the table is live, not a literal)', () => {
    expect(getEGCSize(20)).toBe('#12 AWG');
    expect(getEGCSize(60)).toBe('#10 AWG');
    expect(getEGCSize(100)).toBe('#8 AWG');
    expect(getEGCSize(200)).toBe('#6 AWG');
  });

  it('the design standard is a named single source, changeable without touching the minimum', () => {
    // The selection lives in ONE place; nothing derives it from the code table.
    expect(ARRAY_RACK_BONDING_DESIGN_SIZE).toBe('#10 AWG');
    expect(conductorAreaRank('#10 AWG')).toBeGreaterThan(conductorAreaRank('#12 AWG'));
  });

  // REGRESSION: the first implementation installed the #10 standard
  // UNCONDITIONALLY. On a ground-mount array with an 80 A branch OCPD the code
  // minimum is #8 — larger than the standard — so that shipped an UNDER-SIZED
  // equipment grounding conductor. V45 refused the snapshot, which is how it was
  // found. A design standard is a FLOOR, never a ceiling.
  it('the code minimum WINS when it exceeds the design standard', () => {
    const big = getEGCSize(80);
    expect(big).toBe('#8 AWG');
    expect(conductorAreaRank(big)).toBeGreaterThan(conductorAreaRank(ARRAY_RACK_BONDING_DESIGN_SIZE));
    // the installed conductor may never be smaller than the minimum
    expect(meetsOrExceedsMinimum(ARRAY_RACK_BONDING_DESIGN_SIZE, big)).toBe(false);
  });
});

describe('WS-1 — V45 refuses a record that conflates or under-sizes', () => {
  const withGnd = (over: Partial<GroundingRecord>): PermitDesignSnapshot => {
    const s = clone(PKG.snap) as any;
    const i = s.electrical.groundingObjects.findIndex((g: GroundingRecord) => g.groundingId === 'gnd-array-bond');
    s.electrical.groundingObjects[i] = { ...s.electrical.groundingObjects[i], ...over };
    return s as PermitDesignSnapshot;
  };
  const v45 = (s: PermitDesignSnapshot) =>
    blockingViolations(validatePermitDesignSnapshot(s)).filter(x => x.invariant === 'V45');

  it('the live snapshot has no V45 violation', () => {
    expect(v45(PKG.snap)).toEqual([]);
  });

  it('an INSTALLED conductor smaller than the code minimum is refused', () => {
    const bad = withGnd({ conductorSize: '#14 AWG', selectedDesignSize: '#14 AWG' });
    const vs = v45(bad);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs[0].message).toMatch(/SMALLER than the NEC 250\.122 minimum/);
  });

  it('claiming the NEC minimum produced a larger size is refused', () => {
    const bad = withGnd({ selectionSource: 'nec-minimum' });
    const vs = v45(bad);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs[0].message).toMatch(/the code table did not produce this size/);
  });

  it('a larger conductor with no stated source/reason is refused', () => {
    const bad = withGnd({ selectionSource: null, selectionReason: null });
    expect(v45(bad).length).toBeGreaterThan(0);
  });

  it('the area comparison is on conductor AREA, not string or numeric order', () => {
    expect(meetsOrExceedsMinimum('#10 AWG', '#12 AWG')).toBe(true);   // larger
    expect(meetsOrExceedsMinimum('#12 AWG', '#12 AWG')).toBe(true);   // equal
    expect(meetsOrExceedsMinimum('#14 AWG', '#12 AWG')).toBe(false);  // smaller
    expect(meetsOrExceedsMinimum('#1/0 AWG', '#2 AWG')).toBe(true);
    // an unrecognised label must never fail a package
    expect(meetsOrExceedsMinimum('350 kcmil', '#12 AWG')).toBe(true);
  });
});

describe('WS-1 — roles cannot cross-map', () => {
  it('every grounding record carries exactly one canonical role', () => {
    const roles = PKG.snap.electrical.groundingObjects.map(g => g.segmentRole);
    expect(roles.every(Boolean)).toBe(true);
    expect(new Set(roles).size).toBeGreaterThan(1);
  });

  it('the GEC is a GEC and is not required here — it is not an EGC', () => {
    const g = gnd('gnd-gec');
    expect(g.segmentRole).toBe('GEC');
    expect(g.required).toBe(false);
    expect(g.method).toBe('none-required');
    expect(g.conductorSize).toBeNull();
    // a not-required record may never carry a size or a selection
    expect(g.calculatedMinimumSize).toBeNull();
    expect(g.selectedDesignSize).toBeNull();
  });

  it('the branch EGC is an AC BRANCH conductor, not a microinverter product EGC', () => {
    const g = gnd('gnd-br-1');
    expect(g.segmentRole).toBe('BRANCH_EGC');
    // no claim about a separate Enphase product grounding conductor is made here
    expect(`${g.associatedEquipment} ${g.sizingBasis}`).not.toMatch(/IQ8A/i);
  });

  it('role and purpose agree on every record', () => {
    const MAP: Record<string, string> = {
      'branch-egc': 'BRANCH_EGC', 'feeder-egc': 'FEEDER_EGC', 'raceway-bond': 'RACEWAY_BOND',
      'gec': 'GEC', 'array-rack-bonding-egc': 'ARRAY_RACK_BONDING_EGC',
      'integrated-listed-method': 'INTEGRATED_LISTED_METHOD',
    };
    for (const g of PKG.snap.electrical.groundingObjects) {
      expect(g.segmentRole, `${g.groundingId} role/purpose mismatch`).toBe(MAP[g.purpose]);
    }
  });
});

describe('WS-1 — the sheet renders both sizes', () => {
  it('the rendered row states the installed size AND the code minimum', () => {
    expect(PKG.html).toContain('gnd-array-bond');
    expect(PKG.html).toMatch(/NEC 250\.122 min #12 AWG/);
    expect(PKG.html).toMatch(/Array \/ racking bonding EGC/);
  });

  it('the row prints the canonical endpoints', () => {
    const i = PKG.html.indexOf('gnd-array-bond');
    const row = PKG.html.slice(i, i + 900);
    expect(row).toMatch(/Bonded module frames/);
    expect(row).toMatch(/junction box/i);
  });

  it('the raw enum never leaks as a label', () => {
    expect(PKG.html).not.toContain('>array-rack-bonding-egc<');
  });
});
