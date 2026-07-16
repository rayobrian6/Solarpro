import { describe, it, expect } from 'vitest';
import { generateBOMV4 } from '../../lib/bom-engine-v4';
import { applyDistributorPricing } from '../../lib/bom/distributorPricing';
import { generatePermitHTML } from '../../lib/permit/generatePermit';
import { roofProject } from '../../test-fixtures/roofProject';

// "Truck Stock — Recommended Extras": crew consumables/spares beyond the exact
// installed quantities (Ray 2026-07-11: Polaris taps, box connectors, LBs/LRs…).
// Distinct stage, every line required:false, EXCLUDED from totalBomCost/$-per-W,
// and excluded from the permit SCHED (installed materials only).
describe('truck stock stage', () => {
  const mk = (over: any = {}): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52, deviceCount: 52,
    stringCount: 0, inverterCount: 52, systemKw: 21, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 104, railSections: 32, mainPanelAmps: 200, backfeedAmps: 80, acOCPD: 80, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200, ...over,
  });
  const tsItems = (bom: any) => (bom.items || []).filter((i: any) => i.stageId === 'truck_stock');

  it('emits recommended extras as a distinct non-required stage, gated by context', () => {
    const bom: any = generateBOMV4(mk());
    const ts = tsItems(bom);
    expect(ts.length).toBeGreaterThanOrEqual(8);
    ts.forEach((i: any) => expect(i.required).toBe(false));
    // LB + LR conduit bodies (Ray's headline ask).
    expect(ts.some((i: any) => i.model.includes('LB Conduit Body'))).toBe(true);
    expect(ts.some((i: any) => i.model.includes('LR Conduit Body'))).toBe(true);
    // Supply-side → spare Polaris tap; micro → spare trunk splices/seals.
    expect(ts.some((i: any) => i.partNumber === 'IPLD350-3')).toBe(true);
    expect(ts.some((i: any) => i.partNumber === 'Q-CONN-10M')).toBe(true);
    // Sealant scales with penetrations: 104 attachments → ceil(104/20) = 6 tubes.
    expect(ts.find((i: any) => i.partNumber === 'SEALANT-TUBE')?.quantity).toBe(6);
  });

  it('gates spares out when not applicable (load-side string job)', () => {
    const bom: any = generateBOMV4(mk({
      inverterId: 'solaredge-se7600h', stringCount: 2, deviceCount: undefined,
      inverterCount: 1, interconnectionMethod: 'LOAD_SIDE',
    }));
    const ts = tsItems(bom);
    expect(ts.some((i: any) => i.partNumber === 'IPLD350-3')).toBe(false); // no tap spare
    expect(ts.some((i: any) => i.partNumber === 'Q-CONN-10M')).toBe(false); // no trunk spares
    expect(ts.some((i: any) => i.model.includes('LB Conduit Body'))).toBe(true); // universal extras stay
  });

  it('is priced into a SEPARATE subtotal — totalBomCost / $-per-W unchanged', () => {
    const withTs: any = generateBOMV4(mk());
    const withoutTs: any = generateBOMV4(mk({ includeTruckStock: false }));
    expect(tsItems(withoutTs).length).toBe(0);
    const pricedWith = applyDistributorPricing(withTs.items);
    const pricedWithout = applyDistributorPricing(withoutTs.items);
    // Required-materials total identical; extras land in truckStockCost only.
    expect(pricedWith.totalBomCost).toBeCloseTo(pricedWithout.totalBomCost, 2);
    expect(pricedWith.truckStockCost ?? 0).toBeGreaterThan(0);
    expect(pricedWithout.truckStockCost ?? 0).toBe(0);
  });

  it('is EXCLUDED from the permit SCHED (installed materials only)', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.mountingSystemId = 'rooftech-mini';
    const html = generatePermitHTML(input);
    expect(html).not.toContain('recommended truck stock');
    expect(html).not.toContain('Truck Stock — Recommended');
  });
});
