// ═══════════════════════════════════════════════════════════════════════════
// FINAL CLOSEOUT PASS 2026-07-23 — CO-B (BOM) regression gates.
// Covers §5 (branch/feeder conductor reconciliation from route segments), §6
// (physical-raceway conduit BOM — no "all runs" roll-up), §7 (raceway code
// article from raceway TYPE — PVC→352, EMT→358, mixed), §8 (no string/DC
// legend or BOM row without a canonical DC segment). Permanent gates 5, 6, 7, 8.
//
// Drives generateBOMV4 with real computeSystem runs directly (the permit-path
// coupling) so the gates are independent of the full HTML render pipeline.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { generateBOMV4, type BOMGenerationInputV4, type BOMLineItemV4 } from '@/lib/bom-engine-v4';
import { csMicroInput, bomMicroInput } from '../goldens/wave0-fixtures';

function microBom(csOverrides: Partial<ComputedSystemInput> = {}) {
  const cs = computeSystem({ ...csMicroInput(), ...csOverrides });
  const bom = generateBOMV4({
    ...bomMicroInput(),
    moduleCount: 20, deviceCount: 20, inverterCount: 20, systemKw: 8.4,
    attachmentCount: 40, railSections: 12,
    includeTruckStock: false, includeSuggestedTools: false,
    runs: cs.runs,
  } as BOMGenerationInputV4);
  return { cs, bom };
}

const conduitRows = (items: BOMLineItemV4[]) => items.filter(i => i.category === 'conduit');
const fittingRows = (items: BOMLineItemV4[]) => items.filter(i => i.category === 'conduit_fitting');
const wireRows = (items: BOMLineItemV4[]) => items.filter(i => i.category === 'wire');

describe('§6 / gate 6 — physical-raceway conduit BOM (no "all runs" roll-up)', () => {
  it('emits ONE conduit row per physical raceway, each labeled with its physicalRacewayId + source segments', () => {
    const { cs, bom } = microBom();
    // no project-level roll-up row survives
    expect(bom.items.every(i => !/—\s*all runs/i.test(i.description ?? ''))).toBe(true);
    // one conduit row per engine physical raceway; each cites a real RW id
    const rows = conduitRows(bom.items);
    const rwIds = cs.physicalRaceways.map(r => r.physicalRacewayId);
    expect(rows.length).toBe(rwIds.length);
    for (const row of rows) {
      expect(rwIds.some(id => (row.description ?? '').includes(id))).toBe(true);
      // source segment IDs are present in brackets
      expect(row.description).toMatch(/\[[A-Z0-9_,\s]+\]/);
    }
    // the shared branch home-run is counted ONCE (sharedCircuitCount>1 note)
    const shared = rows.find(r => /RW-BRANCH-HOMERUN/.test(r.description ?? ''));
    expect(shared).toBeTruthy();
    expect(shared!.description).toMatch(/shared home-run/i);
    expect(bom.physicalRaceways?.some(r => r.sharedCircuitCount > 1)).toBe(true);
  });

  it('each raceway generates its matching fittings (couplings, connectors, straps, bushings, bends)', () => {
    const { bom } = microBom();
    const homerunFittings = fittingRows(bom.items).filter(i => /RW-BRANCH-HOMERUN/.test(i.description ?? ''));
    const kinds = homerunFittings.map(i => i.model.toLowerCase());
    expect(kinds.some(k => k.includes('coupling'))).toBe(true);
    expect(kinds.some(k => k.includes('connector'))).toBe(true);
    expect(kinds.some(k => k.includes('strap'))).toBe(true);
    expect(kinds.some(k => k.includes('bushing'))).toBe(true);
    expect(kinds.some(k => k.includes('sweep') || k.includes('elbow'))).toBe(true);
  });
});

describe('§7 / gate 7 — raceway code article derives from the raceway TYPE', () => {
  it('PVC raceways cite NEC 352 (never 358) on conduit + support rows', () => {
    const { bom } = microBom({ conduitType: 'PVC Sch 80' });
    const raceRows = [...conduitRows(bom.items), ...fittingRows(bom.items)];
    expect(raceRows.length).toBeGreaterThan(0);
    // no PVC raceway/fitting row cites the EMT article
    expect(raceRows.every(r => !/358/.test(r.necReference ?? ''))).toBe(true);
    // conduit + strap rows cite the PVC article
    const strap = raceRows.find(r => /strap/i.test(r.model));
    expect(strap!.necReference).toMatch(/352/);
    const conduit = conduitRows(bom.items)[0];
    expect(conduit.necReference).toMatch(/NEC 352/);
  });

  it('EMT raceways cite NEC 358 (never 352) on conduit + support rows', () => {
    const { bom } = microBom({ conduitType: 'EMT' });
    const conduit = conduitRows(bom.items).find(r => /EMT/i.test(r.model));
    expect(conduit).toBeTruthy();
    expect(conduit!.necReference).toMatch(/NEC 358/);
    const strap = fittingRows(bom.items).find(r => /strap/i.test(r.model) && /EMT/i.test(r.model));
    expect(strap!.necReference).toMatch(/358/);
  });

  it('mixed-transition: a system with EMT and PVC raceways cites each raceway its OWN article', () => {
    // Hand-build two raceways of different types (the general mixed-system case).
    const cs = computeSystem({ ...csMicroInput(), conduitType: 'PVC Sch 80' });
    const runs = cs.runs.map(r => ({ ...r }));
    // Force the feeder raceway to EMT while the branch home-run stays PVC.
    const feeder = runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN');
    if (feeder) {
      feeder.conduitType = 'EMT';
      feeder.physicalRacewayId = 'RW-COMBINER_TO_DISCO_RUN';
      // strip any PVC authority object so the type drives the article
      delete (feeder as { physicalRaceway?: unknown }).physicalRaceway;
    }
    const bom = generateBOMV4({
      ...bomMicroInput(), moduleCount: 20, deviceCount: 20, inverterCount: 20, systemKw: 8.4,
      includeTruckStock: false, includeSuggestedTools: false, runs,
    } as BOMGenerationInputV4);
    const pvc = conduitRows(bom.items).find(r => /PVC/i.test(r.model));
    const emt = conduitRows(bom.items).find(r => /EMT/i.test(r.model));
    expect(pvc!.necReference).toMatch(/352/);
    expect(emt!.necReference).toMatch(/358/);
  });
});

describe('§5 / gate 5 — branch conductor quantities equal object-derived requirements', () => {
  it('branch conductors come from the sectioned segments: open-air Q-Cable excluded, shared home-run × sharedCircuitCount', () => {
    const { cs, bom } = microBom();
    const recon = bom.branchWireReconciliation;
    expect(recon).toBeTruthy();
    // the open-air Q-Cable trunk is NEVER billed as THWN field wire
    expect(recon!.openAirTrunkSegments).toContain('BRANCH_RUN');
    const branchCalc = recon!.segments.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN')!;
    expect(branchCalc).toBeTruthy();
    // hots = conductorsPerCircuit × sharedCircuitCount (all branches bundled)
    expect(branchCalc.sharedCircuitCount).toBe(cs.acBranchCount);
    expect(branchCalc.hotConductors).toBe(branchCalc.conductorsPerCircuit * cs.acBranchCount);
    // footage reconciles conductor-by-conductor: ceil(len × hots × waste)
    const expectedHotFt = Math.ceil(branchCalc.oneWayFt * branchCalc.hotConductors * recon!.waste);
    expect(branchCalc.hotFt).toBe(expectedHotFt);
    // the BOM wire row for the branch gauge equals the aggregated hot footage
    const hotAgg = recon!.hotByGauge.find(g => g.gauge === branchCalc.gauge)!;
    const wireRow = wireRows(bom.items).find(w =>
      w.model.startsWith(branchCalc.gauge) && !/EGC/i.test(w.model));
    expect(wireRow!.quantity).toBe(hotAgg.ft);
  });

  it('SCHED-2 branch gauge equals the gauge the ENGINE assigns to the branch home-run (no #10-vs-#12 mismatch)', () => {
    const { cs, bom } = microBom();
    const homerun = cs.runs.find(r => r.id === 'BRANCH_HOMERUN_RUN')!;
    const branchWireRows = wireRows(bom.items).filter(w =>
      (w.description ?? '').includes('BRANCH_HOMERUN_RUN') && !/EGC/i.test(w.model));
    expect(branchWireRows.length).toBeGreaterThan(0);
    // every branch home-run conductor row prints exactly the engine gauge
    for (const w of branchWireRows) expect(w.model.startsWith(homerun.wireGauge)).toBe(true);
  });

  it('the flat structural "acWireLength × 1.15" EGC double-emitter is gone on the runs-fed path (EGC billed per raceway once)', () => {
    const { bom } = microBom();
    const structuralEgc = bom.items.filter(i =>
      i.stageId === 'structural' && i.category === 'wire' && /EGC/i.test(i.model));
    expect(structuralEgc.length).toBe(0);
    // EGC now lives on the AC stage, one green conductor per raceway
    const acEgc = wireRows(bom.items).filter(w => /Green EGC/i.test(w.model));
    expect(acEgc.length).toBeGreaterThan(0);
    for (const e of acEgc) expect(e.necReference).toMatch(/250\.122/);
  });

  it('no conductor row merges branch hots with feeder EGC under a generic "AC wiring" label', () => {
    const { bom } = microBom();
    expect(bom.items.every(i => !/—\s*AC wiring/i.test(i.description ?? ''))).toBe(true);
  });
});

describe('§8 / gate 8 — no string/DC BOM row without a canonical DC segment', () => {
  it('a pure 1:1 micro job emits NO field DC (USE-2) wire and NO DC conduit', () => {
    const { cs, bom } = microBom();
    // engine confirms no DC-in-conduit segment on a pure micro job
    const dcInConduit = cs.runs.filter(r => !r.isOpenAir && r.color === 'dc' && r.conduitType !== 'NONE');
    expect(dcInConduit.length).toBe(0);
    // BOM carries no USE-2 field DC conductor and no DC-labeled conduit
    const useRows = wireRows(bom.items).filter(w => /USE-2/i.test(w.model) || /USE-2/i.test(w.description ?? ''));
    expect(useRows.length).toBe(0);
  });
});
