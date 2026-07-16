import { describe, it, expect } from 'vitest';
import { generateBOMV4 } from '../../lib/bom-engine-v4';

// A supply-side (NEC 705.11) job needs the PHYSICAL tap hardware — the BOM
// previously emitted only a compliance note, shipping a fused disco with
// nothing to make the tap (found on the live Braidon v21 set).
describe('supply-side tap hardware', () => {
  const mk = (ic: string): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52, deviceCount: 52,
    stringCount: 0, inverterCount: 52, systemKw: 21, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 104, railSections: 32, mainPanelAmps: 200, backfeedAmps: 80, acOCPD: 80, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: ic, panelBusRating: 200,
  });
  // Installed tap hardware only — the truck-stock stage adds a SPARE with the
  // same SKU (required:false), which is asserted separately in truck-stock.test.
  const taps = (bom: any) => (bom.items || []).filter((i: any) => i.partNumber === 'IPLD350-3' && i.stageId !== 'truck_stock');

  it('emits 3 insulated multi-tap connectors (L1/L2/N) for SUPPLY_SIDE_TAP only', () => {
    const ss = taps(generateBOMV4(mk('SUPPLY_SIDE_TAP')));
    expect(ss.length).toBe(1);
    expect(ss[0].quantity).toBe(3);
    expect(ss[0].necReference).toContain('705.11');
    expect(taps(generateBOMV4(mk('LOAD_SIDE'))).length).toBe(0);
  });
});
