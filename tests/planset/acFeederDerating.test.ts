// Reproduction test for the AC FEEDER false-FAIL bug.
//
// Symptom: Engineering page shows ELEC FAIL with a single E-AC-WIRE-FAIL:
//   "AC wire #2/0 AWG — ampacity 71.8A"
// for a 52x Enphase IQ8A micro system in Granite City, IL (~18.15 kW AC, 240V).
//
// Root cause: lib/jurisdiction.ts getDesignTemperatures() stores maxTemp as a
// FAHRENHEIT value (IL = 95 °F = 35 °C) but the wire autosizer consumes
// input.designTempMax as a CELSIUS ambient. getTempDeratingFactor(95) falls into
// the worst-case ">75 °C" bucket (0.41), so #2/0 (175A @75C) derates to
// 175 * 0.41 = 71.75 ≈ 71.8A — a FALSE fail. At the true ambient (35 °C, factor
// 0.96) #2/0 = 168A and the feeder passes comfortably (required 94.5A).
//
// This test reproduces the failure with the CURRENT code, then asserts the
// CORRECT behaviour (no false fail, code-correct gauge). It is RED until the fix
// lands and GREEN after.

import { describe, it, expect } from 'vitest';
import { runElectricalCalc, ElectricalCalcInput } from '../../lib/electrical-calc';
import { getDesignTemperatures } from '../../lib/jurisdiction';

// 52x Enphase IQ8A microinverters, combined into a single AC feeder.
// IQ8A: ~0.349 kW continuous per device, 1.45A continuous per device.
const DEVICE_COUNT = 52;
const PER_DEVICE_KW = 0.349;
const PER_DEVICE_AC_A = 1.45;

const ilTemps = getDesignTemperatures('IL'); // Granite City, IL

function buildInput(overrides: Partial<ElectricalCalcInput> = {}): ElectricalCalcInput {
  return {
    inverters: [
      {
        type: 'micro',
        acOutputKw: PER_DEVICE_KW,
        maxDcVoltage: 60,
        mpptVoltageMin: 27,
        mpptVoltageMax: 45,
        maxInputCurrentPerMppt: 12,
        acOutputCurrentMax: PER_DEVICE_AC_A,
        deviceCount: DEVICE_COUNT,
        modulesPerDevice: 1,
        strings: [],
      },
    ],
    mainPanelAmps: 200,
    systemVoltage: 240,
    designTempMin: ilTemps.minTemp,   // -21 (correctly °C)
    designTempMax: ilTemps.maxTemp,   // 95  (stored as °F — the bug source)
    rooftopTempAdder: 35,
    wireGauge: '#10 AWG',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    necVersion: '2020',
    engineeringMode: 'AUTO',
    ...overrides,
  };
}

describe('AC feeder derating (Granite City IL, 52x IQ8A)', () => {
  it('exposes the inflated ambient reaching the AC sizer', () => {
    // The combined feeder current = 52 * 0.349kW / 240V = 75.6A; required = 94.5A.
    const result = runElectricalCalc(buildInput());
    const inv = result.inverters[0];
    expect(inv.acWireResult.requiredAmpacity).toBeCloseTo(94.5, 0);
  });

  it('AC FEEDER must NOT false-fail from rooftop/units temperature derating', () => {
    const result = runElectricalCalc(buildInput());
    const inv = result.inverters[0];
    const ac = inv.acWireResult;

    const acFail = result.errors.find(e => e.code === 'E-AC-WIRE-FAIL');

    // Diagnostic: print the effective ampacity + selected gauge the engine produced.
    // (Vitest prints this on failure.)
    expect({
      selectedGauge: ac.selectedGauge,
      effectiveAmpacity: Number(ac.effectiveAmpacity.toFixed(1)),
      requiredAmpacity: Number(ac.requiredAmpacity.toFixed(1)),
      tempDeratingFactor: ac.tempDeratingFactor,
      acFailPresent: !!acFail,
    }).toMatchObject({ acFailPresent: false });

    // The AC feeder must pass NEC 690.8 / 705.12 ampacity.
    expect(ac.overallPass).toBe(true);
  });

  it('selected feeder gauge is code-correct at the true ambient', () => {
    const result = runElectricalCalc(buildInput());
    const ac = result.inverters[0].acWireResult;
    // At 35°C ambient (0.96 factor), effective ampacity must cover 1.25 * Iout.
    expect(ac.effectiveAmpacity).toBeGreaterThanOrEqual(ac.requiredAmpacity);
  });
});
