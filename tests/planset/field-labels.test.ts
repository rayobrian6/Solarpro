import { describe, it, expect } from 'vitest';
import { selectFieldLabels, auditEditionDependence } from '@/lib/permit/utils/fieldLabels';
import { roofProject } from '../../test-fixtures/roofProject';
import type { CADModel } from '@/lib/cad/types';

// The required sticker set is standard PER JOB, derived from the field-label
// dataset and gated by topology / interconnection / battery / rapid-shutdown /
// NEC edition — not a hand-maintained list.
describe('field-label selection (standard per job)', () => {
  const clone = () => JSON.parse(JSON.stringify(roofProject));
  const cad = (p: any): CADModel => ({ systemType: p.project.systemType, totalPanels: p.system.totalPanels, totalDcKw: p.system.totalDcKw } as any);
  // A.4b — these cases ask which labels APPLY to a given design (topology,
  // battery, DC-vs-AC), a pure design question. `required` additionally means
  // RELEASED FOR PROCUREMENT and is false for an edition-dependent placard while
  // the adopted NEC edition is unresolved — a separate fact, covered by its own
  // cases below.
  const reqIds = (labels: ReturnType<typeof selectFieldLabels>) => labels.filter(l => l.applies).map(l => l.refId);
  const releasedIds = (labels: ReturnType<typeof selectFieldLabels>) => labels.filter(l => l.required).map(l => l.refId);

  it('micro load-side (no battery): AC labels + backfeed, no DC-only or ESS or line-side labels', () => {
    const p = clone();
    p.project.interconnectionMethod = 'LOAD_SIDE';
    const ids = reqIds(selectFieldLabels(p, cad(p)));
    expect(ids).toContain('backfeed-breaker-do-not-relocate');   // load-side
    expect(ids).toContain('ac-point-of-connection-disconnect');
    expect(ids).not.toContain('line-side-tap-warning');          // not supply-side
    expect(ids).not.toContain('dc-photovoltaic-power-source-ratings'); // micro has no DC source circuit
    expect(ids).not.toContain('photovoltaic-power-source-conduit');
    expect(ids).not.toContain('ess-disconnect');                 // no battery
  });

  it('string + supply-side + battery: DC labels + line-side tap + ESS, no backfeed', () => {
    const p = clone();
    p.system.topology = 'string';
    p.system.inverters[0].type = 'string';
    p.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    p.project.batteryBrand = 'Tesla'; p.project.batteryModel = 'Powerwall 3'; p.project.batteryCount = 1; p.project.batteryKwh = 13.5;
    const ids = reqIds(selectFieldLabels(p, cad(p)));
    expect(ids).toContain('dc-photovoltaic-power-source-ratings');
    expect(ids).toContain('photovoltaic-power-source-conduit');
    expect(ids).toContain('line-side-tap-warning');
    expect(ids).toContain('ess-disconnect');
    expect(ids).toContain('ess-master-placard');
    expect(ids).not.toContain('backfeed-breaker-do-not-relocate'); // supply-side has no back-fed breaker
  });

  // A.4b §2/§8 — `compliance.jurisdiction.necVersion` is FALLBACK metadata after
  // A.4a, not the adopted edition. Setting it must therefore NOT produce an
  // edition-stamped citation: only a governed adoption may put a year on a code
  // reference. This test previously asserted the opposite ("NEC 2020"), which is
  // exactly the leak being closed — on Braidon that year is supported by neither
  // Madison County source.
  it('A.4b — a fallback NEC year never stamps an edition onto a code reference', () => {
    const p2020 = clone(); p2020.compliance.jurisdiction.necVersion = 'NEC 2020';
    const rsd = selectFieldLabels(p2020, cad(p2020)).find(l => l.refId === 'rapid-shutdown-building-placard');
    expect(rsd?.necRef).toBeTruthy();
    // The SECTION is still cited — a reviewer needs it — but with no edition.
    expect(rsd?.necRef).toMatch(/NEC §/);
    expect(rsd?.necRef).not.toContain('NEC 2020');
    expect(rsd?.necRef).not.toMatch(/NEC 20\d\d/);
  });

  it('A.4b §3/§5 — an edition-dependent placard APPLIES but is NOT RELEASED while adoption is unresolved', () => {
    const p = clone();
    p.project.interconnectionMethod = 'LOAD_SIDE';
    p.compliance.jurisdiction.necVersion = 'NEC 2020';   // fallback only — not adoption
    const labels = selectFieldLabels(p, cad(p));
    const backfeed = labels.find(l => l.refId === 'backfeed-breaker-do-not-relocate')!;
    // Its required WORDING differs between cycles ('POWER SOURCE OUTPUT
    // CONNECTION' in 2023 vs 'INVERTER OUTPUT CONNECTION' in 2017/2020), so a
    // defaulted year must not specify the physical product.
    expect(backfeed.applies).toBe(true);
    expect(backfeed.editionDependent).toBe(true);
    expect(backfeed.editionPending).toBe(true);
    expect(backfeed.required).toBe(false);
    expect(backfeed.editionPendingNote).toMatch(/NOT RELEASED FOR PROCUREMENT/);
    // §5 — the rapid-shutdown family is withheld on EXISTENCE grounds: the
    // requirement set does not exist before NEC 2014/2017, and 2005 is a live
    // candidate for this jurisdiction.
    const rsd = labels.filter(l => /^rapid-shutdown/.test(l.refId));
    expect(rsd.length).toBeGreaterThan(0);
    expect(rsd.every(l => l.editionDependent)).toBe(true);
    // An edition-STABLE placard is unaffected — refusing everything would be as
    // dishonest as specifying everything.
    const acPoi = labels.find(l => l.refId === 'ac-point-of-connection-disconnect')!;
    expect(acPoi.editionDependent).toBe(false);
    expect(acPoi.required).toBe(acPoi.applies);
    expect(releasedIds(labels)).not.toContain('backfeed-breaker-do-not-relocate');
  });

  it('A.4b — every dataset label naming an NEC edition has been classified (tripwire)', () => {
    // A new or edited dataset entry whose prose names an edition and appears in
    // neither the dependent nor the explicitly-stable set is UNCLASSIFIED, and
    // treating it as edition-independent by default is the failure this
    // containment exists to prevent.
    expect(auditEditionDependence()).toEqual([]);
  });

  it('A.4b — no label anywhere carries an authoritative NEC year from a fallback', () => {
    const p = clone(); p.compliance.jurisdiction.necVersion = 'NEC 2020';
    const refs = selectFieldLabels(p, cad(p)).map(l => l.necRef).join(' | ');
    // §8 negative case: zero authoritative "NEC 2020" labels while adoption is
    // unresolved. IFC keeps its own PENDING treatment, which is unaffected.
    expect(refs).not.toMatch(/NEC 20\d\d/);
  });

  it('fills live ratings into the AC labels with no doubled units', () => {
    const p = clone();
    const acPoi = selectFieldLabels(p, cad(p)).find(l => l.refId === 'ac-point-of-connection-disconnect');
    const joined = (acPoi?.lines ?? []).join(' ');
    // 3.96 kW AC / 240 V ≈ 16.5 A — filled, single unit
    expect(joined).toMatch(/RATED AC OUTPUT CURRENT:\s*[\d.]+ A/);
    expect(joined).not.toMatch(/A A|V V/);
  });

  it('drops rapid-shutdown labels when the system has none', () => {
    const p = clone();
    p.project.rapidShutdown = false;
    const ids = reqIds(selectFieldLabels(p, cad(p)));
    expect(ids).not.toContain('rapid-shutdown-building-placard');
    expect(ids).not.toContain('rapid-shutdown-switch-initiator-label');
  });
});
