import { describe, it, expect } from 'vitest';
import { runStructuralCalcV4 } from '../../lib/structural-engine-v4';
import { generateBOMV4 } from '../../lib/bom-engine-v4';

// The rooftop racking BOM (rail count, splices, clamps, lag bolts, rail bolts)
// must come from the structural engine's real calcRackingBOM — NOT the registry
// accessory formulas that guessed `rows×2` fixed-14ft rails and had no rail
// bolts. This locks the single-source wiring (generateBOMV4 consumes rackingBOM).
describe('BOM roof racking is single-sourced from the structural rackingBOM', () => {
  const structInput: any = {
    installationType: 'roof_mount', windSpeed: 110, windExposure: 'C', groundSnowLoad: 20,
    meanRoofHeight: 15, roofPitch: 26, framingType: 'rafter', rafterSize: '2x6', rafterSpanFt: 12,
    rafterSpacingIn: 24, woodSpecies: 'df_larch', panelCount: 52, panelLengthIn: 66.9,
    panelWidthIn: 40.9, panelWeightLbs: 46, panelOrientation: 'portrait', mountingSystemId: 'rooftech-mini',
  };
  const bomBase = (sr: any): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52, deviceCount: 52,
    stringCount: 0, inverterCount: 52, systemKw: 21, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: sr.mountLayout.mountCount, railSections: sr.rackingBOM.rails.qty,
    rowCount: sr.arrayGeometry.rowCount, mainPanelAmps: 200, backfeedAmps: 60, acOCPD: 60, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200, rackingId: 'rooftech-mini',
  });
  const structItems = (bom: any) => (bom.items || []).filter((i: any) => i.stageId === 'structural');
  const qtyOf = (bom: any, cat: string) =>
    structItems(bom).filter((i: any) => i.category === cat).reduce((s: number, i: any) => s + i.quantity, 0);

  it('emits rail count, splices and rail bolts FROM the rackingBOM (not the registry guess)', () => {
    const sr: any = runStructuralCalcV4(structInput);
    const rb = sr.rackingBOM;
    const bom: any = generateBOMV4({ ...bomBase(sr), rackingBOM: rb });

    // Rail count matches the structural engine (real length ÷ section × railCount),
    // NOT the registry's rows×2 guess.
    expect(qtyOf(bom, 'rail')).toBe(rb.rails.qty);
    // Rail T-bolts (previously MISSING entirely) are present.
    expect(rb.mountingBolts.qty).toBeGreaterThan(0);
    expect(qtyOf(bom, 'mount_hardware')).toBe(rb.mountingBolts.qty);
    // Splices present (RT-MINI had none in the registry).
    expect(qtyOf(bom, 'splice')).toBe(rb.railSplices.qty);
    // Lag bolts = mounts × fasteners.
    expect(qtyOf(bom, 'lag_bolt')).toBe(rb.lagBolts.qty);
  });

  it('the registry fallback under-counts rails vs the real rackingBOM (the bug this fixes)', () => {
    const sr: any = runStructuralCalcV4(structInput);
    const withRB: any = generateBOMV4({ ...bomBase(sr), rackingBOM: sr.rackingBOM });
    const fallback: any = generateBOMV4(bomBase(sr)); // no rackingBOM → registry formulas
    // Wide rows need multiple 14 ft rail sections per run; the registry emitted
    // one piece per run, so the real count is materially higher.
    expect(qtyOf(withRB, 'rail')).toBeGreaterThan(qtyOf(fallback, 'rail'));
    // And the fallback emits no rail bolts at all.
    expect(qtyOf(fallback, 'mount_hardware')).toBe(0);
  });
});
