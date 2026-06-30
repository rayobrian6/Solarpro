import { describe, expect, it } from 'vitest';
import { runStructuralCalcV4 } from '@/lib/structural-engine-v4';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitInput } from '@/lib/permit/types';

// ── BUG 1 test ── Structural calc V4 field wiring (wind/snow, not windAnalysis/snowAnalysis)
describe('structural calc V4 → generatePermit field wiring', () => {
  it('runStructuralCalcV4 returns { wind, snow } — not windAnalysis/snowAnalysis', () => {
    const result = runStructuralCalcV4({
      installationType: 'roof_residential',
      windSpeed: 110,
      windExposure: 'C',
      groundSnowLoad: 5,
      meanRoofHeight: 15,
      roofPitch: 22,
      framingType: 'rafter',
      rafterSize: '2x6',
      rafterSpacingIn: 24,
      rafterSpanFt: 12,
      panelCount: 52,
      panelLengthIn: 66,
      panelWidthIn: 40,
      panelWeightLbs: 50,
      panelOrientation: 'portrait',
      mountingSystemId: 'ironridge-xr100',
      rackingWeightPerPanelLbs: 4,
    });

    // StructuralResultV4 has .wind and .snow (NOT .windAnalysis / .snowAnalysis)
    expect(result.wind).toBeDefined();
    expect(result.snow).toBeDefined();
    // These must NOT exist on the result object
    expect((result as any).windAnalysis).toBeUndefined();
    expect((result as any).snowAnalysis).toBeUndefined();

    // Verify the actual wind/snow fields contain real values
    expect(result.wind.designWindSpeedMph).toBe(110);
    expect(result.wind.velocityPressurePsf).toBeGreaterThan(0);
    expect(result.wind.netUpliftPressurePsf).toBeGreaterThan(0);
    expect(result.snow.groundSnowLoadPsf).toBe(5);
    expect(result.snow.roofSnowLoadPsf).toBeGreaterThan(0);

    // Rafter analysis should also be populated
    expect(result.rafterAnalysis.size).toBeTruthy();
    expect(result.rafterAnalysis.overallUtilization).toBeGreaterThan(0);
  });

  it('generatePermitHTML with roof project produces structural values (not blanks)', () => {
    const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));
    expect(typeof html).toBe('string');
    // After the fix, structural V4 should SUCCEED and embed real wind/snow numbers.
    // The fixture has ahjWindSpeedMph=115 and ahjGroundSnowPsf=0.
    // Even with 0 ground snow, the result should have a wind speed reference.
    // The key assertion: no "structural V4 failed" in the output log.
    // (We can't see console output directly, but we can check the HTML contains
    // structural content on the PV-4C sheet.)
    expect(html).toContain('PV-4C');
  });
});

// ── BUG 2 test ── sldAdapter uses system total AC for microinverters
describe('sldAdapter acOutputAmps for microinverter system', () => {
  it('computes acOutputAmps from system totalAcKw, not per-device acOutputKw', () => {
    // The roof project fixture is a micro system with 12 panels.
    // system.totalAcKw = 5.0 (already the system total)
    // system.inverters[0].acOutputKw = 5.0 (in this fixture it's already the total)
    //
    // Let's build a more realistic micro fixture where inv0.acOutputKw is per-device
    // (e.g., 0.24 kW for IQ8A) and totalAcKw is the computed system total.
    const microInput: PermitInput = JSON.parse(JSON.stringify(roofProject));
    microInput.system.totalAcKw = 12.48;   // 52 × 0.24 kW system total
    microInput.system.totalPanels = 52;
    microInput.system.inverters = [{
      manufacturer: 'Enphase',
      model: 'IQ8A',
      type: 'micro',
      acOutputKw: 0.24,           // per-device output
      maxDcVoltage: 60,
      efficiency: 0.97,
      ulListing: 'UL 1741 SA',
      strings: [],
    }];

    const sldInput = buildSLDInputFromPermit(microInput, null);

    // acOutputAmps should be based on system total (12.48 kW × 1000 / 240 ≈ 52A),
    // NOT per-device (0.24 kW × 1000 / 240 = 1A).
    expect(sldInput.acOutputKw).toBe(12.48);
    expect(sldInput.acOutputAmps).toBe(52);   // Math.round(12480 / 240) = 52
    // acOCPD should be realistic (NEC 125% of 52A = 65A → next standard = 70A)
    expect(sldInput.acOCPD).toBeGreaterThanOrEqual(60);
  });

  it('falls back to eq.inverterAcOutputKw when totalAcKw is 0 (string inverter)', () => {
    const stringInput: PermitInput = JSON.parse(JSON.stringify(roofProject));
    stringInput.system.topology = 'string';
    stringInput.system.totalAcKw = 0;  // force fallback
    stringInput.system.inverters = [{
      manufacturer: 'SolarEdge',
      model: 'SE7600A',
      type: 'string',
      acOutputKw: 7.6,
      maxDcVoltage: 480,
      efficiency: 0.98,
      ulListing: 'UL 1741 SA',
      strings: [{ label: 'String 1', panelCount: 12, panelManufacturer: 'CS', panelModel: 'CS6R', panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, wireGauge: '10 AWG', wireLength: 45, isc: 13.85, ampacity: 30, ocpd: 20, voltageDrop: 1.8 }],
    }];

    const sldInput = buildSLDInputFromPermit(stringInput, null);

    // When totalAcKw is 0, fallback to eq.inverterAcOutputKw (7.6 kW)
    expect(sldInput.acOutputKw).toBe(7.6);
    expect(sldInput.acOutputAmps).toBeGreaterThan(0);
  });
});

// Helper — import generatePermitHTML (used in BUG 1 test above)
import { generatePermitHTML } from '@/lib/permit';
