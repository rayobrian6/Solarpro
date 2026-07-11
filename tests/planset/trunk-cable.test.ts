import { describe, it, expect } from 'vitest';
import { resolveTrunkCablePlan, TRUNK_CABLE_SYSTEMS } from '../../lib/equipment/trunkCable';
import { generateBOMV4 } from '../../lib/bom-engine-v4';

// Brand-agnostic AC trunk/bus cable resolver — real install logic:
// continuous per BRANCH (not per array), service loop + sealing cap at row
// transitions (cheapest option), field splices only where forced (sub-array/
// plane bridges) or explicitly chosen by the installer.
describe('resolveTrunkCablePlan', () => {
  it('Enphase: orientation-specific SKU, 13/branch (IQ8+), drops = devices, 0 splices single-plane', () => {
    const p = resolveTrunkCablePlan({ brand: 'Enphase', model: 'IQ8PLUS-72-2-US', deviceCount: 52, orientation: 'portrait', rowCount: 4 })!;
    expect(p.cable.sku).toBe('Q-12-10-240');
    expect(p.branchCount).toBe(4);            // ceil(52/13) — NOT the old 16/branch
    expect(p.dropCount).toBe(52);             // sold per connector-drop
    expect(p.splicePairs).toBe(0);            // continuous + service loop = cheapest
    expect(p.terminators).toBe(4);            // 1 per branch end
    const l = resolveTrunkCablePlan({ brand: 'Enphase', deviceCount: 52, orientation: 'landscape' })!;
    expect(l.cable.sku).toBe('Q-12-17-240');  // landscape trunk is a DIFFERENT SKU
    expect(l.approxFeet).toBeGreaterThan(p.approxFeet); // wider drop pitch
  });

  it('splices are forced only by sub-array/plane bridges, not rows', () => {
    const twoPlanes = resolveTrunkCablePlan({ brand: 'Enphase', deviceCount: 52, subArrayCount: 2 })!;
    expect(twoPlanes.splicePairs).toBe(1);    // one raw-cable jumper M+F pair
  });

  it('installer row-splice override: branch boundaries absorb row transitions', () => {
    // 4 rows / 4 branches → every transition lands on a branch break → 0 cuts.
    const p = resolveTrunkCablePlan({ brand: 'Enphase', deviceCount: 52, rowCount: 4, spliceAtRows: true })!;
    expect(p.splicePairs).toBe(0);
    // 6 rows / 4 branches → 2 within-branch transitions need cuts.
    const q = resolveTrunkCablePlan({ brand: 'Enphase', deviceCount: 52, rowCount: 6, spliceAtRows: true })!;
    expect(q.splicePairs).toBe(2);
  });

  it('resolves APsystems / Hoymiles / NEP with per-brand branch limits', () => {
    expect(resolveTrunkCablePlan({ brand: 'APsystems', model: 'DS3', deviceCount: 26 })!.branchCount).toBe(7);  // 4/branch
    expect(resolveTrunkCablePlan({ brand: 'Hoymiles', model: 'HMS-800-2T', deviceCount: 26 })!.branchCount).toBe(6); // 5/branch
    expect(resolveTrunkCablePlan({ brand: 'NEP', deviceCount: 26 })!.cable.sku).toBe('NB020229');
    expect(resolveTrunkCablePlan({ brand: 'UnknownBrand', deviceCount: 10 })).toBeNull();
  });

  it('every cataloged system has splice + terminator hardware defined', () => {
    for (const s of TRUNK_CABLE_SYSTEMS) {
      expect(s.connectors.male.sku).toBeTruthy();
      expect(s.connectors.female.sku).toBeTruthy();
      expect(s.connectors.terminator.sku).toBeTruthy();
      expect(s.maxDevicesPerBranch).toBeGreaterThan(0);
    }
  });
});

describe('BOM consumes the trunk resolver', () => {
  const mk = (o: 'portrait' | 'landscape'): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52, deviceCount: 52,
    stringCount: 0, inverterCount: 52, systemKw: 21, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 104, railSections: 32, rowCount: 4, mainPanelAmps: 200, backfeedAmps: 60,
    acOCPD: 60, dcOCPD: 20, systemType: 'roof', interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
    layoutOrientation: o,
  });
  const find = (bom: any, cat: string) => (bom.items || []).filter((i: any) => i.category === cat);

  it('emits the orientation-correct trunk SKU as drops + per-branch terminators/seals', () => {
    const p: any = generateBOMV4(mk('portrait'));
    const trunk = find(p, 'trunk_cable')[0];
    expect(trunk.partNumber).toBe('Q-12-10-240');
    expect(trunk.quantity).toBe(52);          // per connector-drop
    expect(find(p, 'terminator')[0].quantity).toBe(4);
    expect(find(p, 'sealing_cap')[0].quantity).toBe(4);
    expect(find(p, 'connector').length).toBe(0); // single plane → no splices
    const l: any = generateBOMV4(mk('landscape'));
    expect(find(l, 'trunk_cable')[0].partNumber).toBe('Q-12-17-240');
  });
});
