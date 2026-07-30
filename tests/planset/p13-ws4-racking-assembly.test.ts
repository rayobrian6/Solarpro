// ═══════════════════════════════════════════════════════════════════════════
// PLANSET 13 · WS-4 — CANONICAL RACKING ASSEMBLY PROPAGATION.
//
// The project stores mountingSystemId='rooftech-mini' and attachmentSpacing=48,
// and the catalog carries the architecture, the fastener pattern and the spacing
// maximum. None of it was projected, so:
//   • PV-1 printed "DECK-MOUNT (◻) WHERE NO RAFTER FALLS IN RANGE" on every
//     railed job — an instruction this design never made, whose placement
//     mechanism is retired, and whose RT-MINI deck condition is a DIFFERENT
//     5-screw design with its own capacity and its own manufacturer document;
//   • the 48" spacing had no stated source;
//   • the architecture was inferred downstream instead of read.
//
// WHAT IS AND IS NOT A GAP (the campaign's critical rule — do not populate null
// SKUs with guesses):
//   mountModel 'RT-MINI'  — KNOWN, pinned from the catalog.
//   mountSku              — genuinely absent: mounting-hardware-db has no SKU
//                           field at all. A real catalogue gap, and NOT the same
//                           fact as "the mount is unselected".
//   railSku / railModel   — a genuine UNMADE SELECTION among validated listed
//                           rails, which the record states as PENDING.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { getMountingSystemById, resolveMountingSystemId } from '@/lib/mounting-hardware-db';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen() {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}
const PKG = gen();
const RA = PKG.snap.structural.rackingAssembly as any;

describe('WS-4 — the stored selection is found and its architecture is READ, not inferred', () => {
  it('the project selection resolves to the RT-MINI record', () => {
    expect(PKG.input.project.mountingSystemId).toBe('rooftech-mini');
    const m = getMountingSystemById('rooftech-mini')!;
    expect(m.model).toBe('RT-MINI');
    expect(m.manufacturer).toBe('Roof Tech');
  });

  it('the assembly states a RAIL-PAIRED architecture with its basis', () => {
    expect(RA.architectureType).toBe('rail-paired');
    expect(RA.architectureBasis).toBeTruthy();
    expect(RA.architectureBasis).toMatch(/rail-paired/i);
  });

  it('the mount MODEL is pinned even though no SKU exists anywhere', () => {
    expect(RA.mountManufacturer).toBe('Roof Tech');
    expect(RA.mountModel).toBe('RT-MINI');
    // the catalogue genuinely has no orderable part number — not a guess, not a
    // silent fill, and not evidence that the mount is unselected
    expect(RA.mountSku).toBeNull();
  });

  it('the 48-inch spacing has a stated manufacturer source', () => {
    // The live project stores attachmentSpacing=48; the frozen audit fixture does
    // not carry the field. Either way the SOURCE of 48" is the catalog maximum,
    // which is the fact that was missing — the number had no attribution.
    const stored = (PKG.input.project as { attachmentSpacing?: number }).attachmentSpacing;
    if (stored !== undefined) expect(stored).toBe(48);
    expect(getMountingSystemById('rooftech-mini')!.mount.maxSpacingIn).toBe(48);
    expect(RA.attachmentSpacingSourceIn).toBe(48);
    expect(RA.attachmentSpacingSource).toMatch(/maxSpacingIn/);
  });

  it('the bonding hardware comes from the canonical assembly', () => {
    expect(RA.groundingBonding).toBe('RT-MINI Bond Clip');
  });
});

describe('WS-4 — rail-based needs a real rail; rail-less must never get one invented', () => {
  it('a rail-paired assembly reports its rail as an UNMADE SELECTION, not as resolved', () => {
    expect(RA.architectureType).toBe('rail-paired');
    expect(RA.railSku).toBeNull();
    expect(String(RA.railModel)).toMatch(/PENDING/i);
  });

  it("the 'rail-less' alias no longer binds a RAIL-PAIRED product", () => {
    // It used to map to 'rooftech-mini', turning an architecture keyword into a
    // permanent "rail unselected" blocker on a job that never wanted a rail.
    expect(resolveMountingSystemId('rail-less')).not.toBe('rooftech-mini');
    const resolved = getMountingSystemById(resolveMountingSystemId('rail-less'));
    if (resolved) expect(resolved.systemType).not.toBe('rail_based');
  });

  it('a genuinely rail-less product is NOT rail-paired and carries no rail', () => {
    const tesla = getMountingSystemById('tesla-panel-mount-comp-rafter');
    expect(tesla).toBeTruthy();
    expect(tesla!.systemType).toBe('rail_less');
  });
});

describe('WS-4 — attachment mode: rafter and deck are different designs', () => {
  it('this design is RAFTER attachment, from the catalog fastener pattern', () => {
    expect(RA.attachmentMode).toBe('rafter');
    expect(RA.fastenersPerMount).toBe(2);
    expect(RA.attachmentModeBasis).toMatch(/fastenersPerMount=2/);
    expect(RA.attachmentModeBasis).toMatch(/rafter/i);
  });

  it('the RT-MINI rafter condition is 2 screws — the deck condition is a DIFFERENT pattern', () => {
    const m = getMountingSystemById('rooftech-mini')!;
    expect(m.mount.fastenersPerMount).toBe(2);
    // The 5-screw deck pattern belongs to the deck condition only. It may never
    // be shown for this design, which is rafter-attached.
    expect(RA.fastenersPerMount).not.toBe(5);
  });

  it('the artifact no longer instructs deck-mounting as a field fallback', () => {
    expect(PKG.html).not.toContain('DECK-MOUNT');
    expect(PKG.html).not.toMatch(/WHERE NO RAFTER FALLS IN RANGE/i);
    expect(PKG.html).toMatch(/NO DECK-ONLY ATTACHMENT/);
  });

  it('no five-screw deck pattern is printed for this rafter design', () => {
    expect(PKG.html).not.toMatch(/5\s*(x|×)\s*deck screw/i);
    expect(PKG.html).not.toMatch(/five screws/i);
  });
});

describe('WS-4 — RT-MINI and RT-MINI II are different products', () => {
  it("'rooftech-mini' does not silently map to RT-MINI II", () => {
    expect(resolveMountingSystemId('rooftech-mini')).toBe('rooftech-mini');
    expect(getMountingSystemById('rooftech-mini')!.model).toBe('RT-MINI');
    expect(getMountingSystemById('rooftech-mini')!.model).not.toMatch(/II/);
  });

  it('the assembly names the selected generation, not the document\'s generation', () => {
    // The archived install document is the RT-MINI II manual; the SELECTED
    // product is RT-MINI. The assembly must state what was selected.
    expect(RA.mountModel).toBe('RT-MINI');
  });

  it('cross-generation document applicability remains an OPEN requirement', () => {
    // Nothing in WS-4 clears it: a RT-MINI II manual has not been shown to apply
    // to a selected RT-MINI, and this campaign forbids letting it silently do so.
    const open = PKG.snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
    expect(open).toContain('EQUIPMENT-DOCUMENT-APPLICABILITY');
  });
});

describe('WS-4 — the assembly drives the grounding bonding method', () => {
  const bond = PKG.snap.electrical.groundingObjects.find(g => g.groundingId === 'gnd-array-bond')!;

  it('gnd-array-bond is bound to the canonical assembly', () => {
    expect(bond.rackingAssemblyId).toBe(RA.assemblyId);
  });

  it('its bonding METHOD stays null while the assembly is unverified', () => {
    // WS-1 built the conductor; the METHOD by which frames/rails are bonded is
    // the assembly's authority and is not asserted from a product name.
    expect(RA.assemblyVerification.overall).not.toBe('verified');
    expect(bond.bondingMethod).toBeNull();
    expect(bond.manufacturerEvidenceId).toBeNull();
  });

  it('the conductor itself is still fully specified — the method gap does not erase it', () => {
    expect(bond.conductorSize).toBe('#10 AWG');
    expect(bond.calculatedMinimumSize).toBe('#12 AWG');
    expect(bond.required).toBe(true);
  });
});

describe('WS-4 — requirement scoping hides nothing', () => {
  it('the rail selection is stated as an unmade selection, not as a resolved fact', () => {
    const open = PKG.snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
    expect(open).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
  });

  it('the planset does not claim the MOUNT is unselected', () => {
    // The 'UNSELECTED' language on the artifact is scoped to the rail/splice SKU,
    // which is genuinely unmade. The mount model is known and printed.
    const unselected = PKG.html.match(/[^.]{0,80}UNSELECTED[^.]{0,40}/g) ?? [];
    for (const u of unselected) expect(u).toMatch(/rail|splice/i);
    expect(PKG.html).toContain('RT-MINI');
  });
});
