import { describe, it, expect } from 'vitest';
import { resolveSuggestedTools } from '../../lib/equipment/suggestedTools';
import { generateBOMV4 } from '../../lib/bom-engine-v4';
import { applyDistributorPricing } from '../../lib/bom/distributorPricing';
import { generatePermitHTML } from '../../lib/permit/generatePermit';
import { roofProject } from '../../test-fixtures/roofProject';

// "Suggested Tools — This Job": job-specific tooling advice (bandsaw for rails,
// Q-DISC-10 on Enphase, EMT bender, NEC 110.14(D) torque tools…). Advice, not
// materials — never priced, never in totals/unpriced KPIs, never on the permit.
describe('suggested tools', () => {
  it('resolver gates tools by what the job involves', () => {
    const full = resolveSuggestedTools({
      isRailBased: true, rackingBrand: 'Roof Tech', isMicro: true, microBrand: 'Enphase',
      conduitType: 'EMT', isSupplySideTap: true, hasRoofAttachments: true, hasWirePull: true,
    });
    expect(full.some(t => t.tool.includes('bandsaw'))).toBe(true);
    expect(full.some(t => t.partNumber === 'Q-DISC-10')).toBe(true);
    expect(full.some(t => t.tool.includes('EMT bender'))).toBe(true);
    expect(full.some(t => t.tool.includes('Wire caddy'))).toBe(true);
    expect(full.some(t => t.tool.includes('Insulated hand tools'))).toBe(true);
    expect(full.some(t => t.why?.includes('110.14(D)'))).toBe(true);

    const minimal = resolveSuggestedTools({
      isRailBased: false, isMicro: false, conduitType: 'PVC',
      isSupplySideTap: false, hasRoofAttachments: false, hasWirePull: false,
    });
    expect(minimal.some(t => t.tool.includes('bandsaw'))).toBe(false);
    expect(minimal.some(t => t.partNumber === 'Q-DISC-10')).toBe(false);
    expect(minimal.some(t => t.tool.includes('EMT bender'))).toBe(false);
    // Termination tooling is universal.
    expect(minimal.some(t => t.tool.includes('Torque screwdriver'))).toBe(true);
  });

  const mk = (over: any = {}): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52, deviceCount: 52,
    stringCount: 0, inverterCount: 52, systemKw: 21, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 104, railSections: 32, mainPanelAmps: 200, backfeedAmps: 80, acOCPD: 80, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200, ...over,
  });

  it('BOM emits a tools stage that never touches pricing totals or the unpriced KPI', () => {
    const withTools: any = generateBOMV4(mk());
    const without: any = generateBOMV4(mk({ includeSuggestedTools: false }));
    const toolItems = withTools.items.filter((i: any) => i.stageId === 'tools');
    expect(toolItems.length).toBeGreaterThanOrEqual(8);
    toolItems.forEach((i: any) => expect(i.required).toBe(false));
    expect(without.items.filter((i: any) => i.stageId === 'tools').length).toBe(0);

    const pWith = applyDistributorPricing(withTools.items);
    const pWithout = applyDistributorPricing(without.items);
    expect(pWith.totalBomCost).toBeCloseTo(pWithout.totalBomCost, 2);
    expect(pWith.truckStockCost ?? 0).toBeCloseTo(pWithout.truckStockCost ?? 0, 2);
    expect(pWith.unpriced).toBe(pWithout.unpriced); // tools never count as unpriced
    // Tools stay uncosted.
    pWith.items.filter(i => i.stageId === 'tools').forEach(i => {
      expect(i.unitCost ?? 0).toBe(0);
      expect(i.totalCost ?? 0).toBe(0);
    });
  });

  it('is EXCLUDED from the permit output', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.mountingSystemId = 'rooftech-mini';
    const html = generatePermitHTML(input);
    expect(html).not.toContain('Suggested Tools');
    expect(html).not.toContain('Q-DISC-10');
  });
});
