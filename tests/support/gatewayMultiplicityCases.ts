// ============================================================================
// Designs past an IQ Combiner's capacity, and what every consumer says about
// them — shared by tests/gatewayMultiplicityEveryConsumer.test.ts (the real
// code) and tests/gatewayMultiplicityMutation.test.ts (the old `quantity = 1`
// shortcut restored by a module mock).
// ============================================================================

import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { computeSystem } from '@/lib/computed-system';
import { generateBOMV4 } from '@/lib/bom-engine-v4';
import { planGatewayCount } from '@/lib/equipment/integratedBos';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import { microInput, DEVICES_FOR_BRANCHES, COMBINERS, bigRoofPermit } from './sldVariantMatrix';
export { bigRoofPermit };
import { csMicroInput } from '../goldens/wave0-fixtures';

export type BoundaryBranches = 3 | 4 | 5 | 8 | 9;

/** The IQ Combiner 5C holds 4 branch positions: limit − 1, limit, limit + 1,
 *  2 × limit, 2 × limit + 1 — and how many gateways each physically needs. */
export const FIVE_C_BOUNDARY: ReadonlyArray<[BoundaryBranches, number]> = [[3, 1], [4, 1], [5, 2], [8, 2], [9, 3]];

/** What each engineering-side consumer says the count is, for one design. */
export function engineeringCounts(branches: BoundaryBranches) {
  const devices = DEVICES_FOR_BRANCHES[branches];
  const selected = COMBINERS['5c'];
  const fields = sldCombinerFields({
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', isMicro: true,
    totalDevices: devices, branchCount: branches, hasBattery: false, selectedCombinerId: selected,
    interconnectionRaw: 'LOAD_SIDE',
  });
  const cs = computeSystem({ ...csMicroInput(), totalPanels: devices, inverterModel: 'IQ8+', combinerSelectionId: selected } as any);
  const svg = renderSLDProfessional(microInput({ combiner: '5c', interconnection: 'LOAD_SIDE', ct: null, branches, mode: 'sheet' }));
  const bom = generateBOMV4({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: devices, deviceCount: devices, stringCount: 0, inverterCount: devices, systemKw: devices * 0.4,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG', dcWireLength: 50, acWireLength: 60, conduitType: 'EMT',
    conduitSizeInch: '3/4', roofType: 'shingle', attachmentCount: devices * 2, railSections: 20,
    mainPanelAmps: 200, backfeedAmps: 60, acOCPD: 60, dcOCPD: 20, systemType: 'roof', rackingId: 'ironridge-xr100',
    topologyType: 'MICROINVERTER', interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
    branchCount: branches, selectedCombinerId: selected,
  } as any);
  const combinerRow = bom.items.find(i => i.category === 'combiner' && /IQ Combiner 5C/.test(i.model));
  // The drawing: one nameplate block per combiner box it draws — the italic
  // model line every combiner prints under itself, on the single-source sheet
  // and the multi-source one alike.
  const nameplates = [...svg.matchAll(/font-style="italic"[^>]*>Enphase IQ Combiner 5C</g)].length;
  return {
    plan: planGatewayCount(fields.plan),
    drawingFields: fields.gateways?.length ?? 1,
    drawing: nameplates,
    engineFeeders: cs.gatewayInstances?.length ?? 1,
    engineCombinerRow: cs.equipmentSchedule.find(r => r.tag === 'COMB-1')?.qty,
    engineBomQty: cs.bomQuantities.acCombiner,
    bom: combinerRow?.quantity,
  };
}

/** Every consumer whose count differs from what the design physically needs. */
export function countMismatches(counts: ReturnType<typeof engineeringCounts>, physical: number): string[] {
  return Object.entries(counts).filter(([, n]) => n !== physical).map(([k, n]) => `${k}=${n} (needs ${physical})`);
}

