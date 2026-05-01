/**
 * v47.417 — E-DC-DISCONNECT gating regression tests.
 *
 * Behavioral contract under NEC 690.15:
 *   (1) Microinverter systems: DC disconnect not required (emits
 *       I-DC-DISCONNECT-MICRO info; no error).
 *   (2) Non-micro systems where EVERY inverter has a factory-integrated
 *       DC safety switch: DC disconnect requirement satisfied by the
 *       integrated switch (emits I-DC-DISCONNECT-INTEGRATED info; no error).
 *   (3) Non-micro systems with at least one inverter lacking an integrated
 *       switch AND where the user has not set dcDisconnect: true: error
 *       E-DC-DISCONNECT fires.
 *   (4) Non-micro systems where the user has set dcDisconnect: true:
 *       no error regardless of integrated-switch flag.
 */
import { describe, it, expect } from 'vitest';
import { runElectricalCalc, type ElectricalCalcInput, type InverterInput } from './electrical-calc';

const panel = {
  panelVoc: 41.6,
  panelIsc: 12.26,
  panelImp: 11.59,
  panelVmp: 34.5,
  panelWatts: 400,
  tempCoeffVoc: -0.26,
  tempCoeffIsc: 0.05,
  maxSeriesFuseRating: 20,
  wireGauge: '10',
  wireLength: 50,
  conduitType: 'EMT',
};

const baseInverterString: InverterInput = {
  type: 'string',
  acOutputKw: 7.6,
  maxDcVoltage: 600,
  mpptVoltageMin: 200,
  mpptVoltageMax: 600,
  maxInputCurrentPerMppt: 18,
  acOutputCurrentMax: 32,
  strings: [{ ...panel, panelCount: 9 }, { ...panel, panelCount: 9 }],
};

const baseInverterMicro: InverterInput = {
  type: 'micro',
  acOutputKw: 0.295,
  maxDcVoltage: 60,
  mpptVoltageMin: 16,
  mpptVoltageMax: 60,
  maxInputCurrentPerMppt: 14,
  acOutputCurrentMax: 1.21,
  strings: [{ ...panel, panelCount: 24 }],
};

function mkInput(overrides: Partial<ElectricalCalcInput> = {}, inverters?: InverterInput[]): ElectricalCalcInput {
  return {
    inverters: inverters ?? [baseInverterString],
    mainPanelAmps: 200,
    systemVoltage: 240,
    designTempMin: -10,
    designTempMax: 40,
    rooftopTempAdder: 30,
    wireGauge: '6',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: false,   // <- the whole point of these tests
    necVersion: '2023',
    ...overrides,
  };
}

describe('v47.417 — E-DC-DISCONNECT NEC 690.15 gating', () => {
  it('fires E-DC-DISCONNECT when non-micro inverter has NO integrated switch and user has not installed one', () => {
    const input = mkInput({}, [{ ...baseInverterString, integratedDcDisconnect: false }]);
    const result = runElectricalCalc(input);
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain('E-DC-DISCONNECT');
  });

  it('fires E-DC-DISCONNECT when integratedDcDisconnect flag is omitted (undefined, safe default)', () => {
    const inv: InverterInput = { ...baseInverterString };
    delete (inv as any).integratedDcDisconnect;
    const result = runElectricalCalc(mkInput({}, [inv]));
    const codes = result.errors.map(e => e.code);
    expect(codes).toContain('E-DC-DISCONNECT');
  });

  it('suppresses E-DC-DISCONNECT when EVERY non-micro inverter has integratedDcDisconnect: true', () => {
    const input = mkInput({}, [{ ...baseInverterString, integratedDcDisconnect: true }]);
    const result = runElectricalCalc(input);
    const codes = result.errors.map(e => e.code);
    expect(codes).not.toContain('E-DC-DISCONNECT');
    const infoCodes = (result.infos ?? []).map(i => i.code);
    expect(infoCodes).toContain('I-DC-DISCONNECT-INTEGRATED');
  });

  it('suppresses E-DC-DISCONNECT for a SolarEdge-like dual-inverter array (both integrated)', () => {
    const se7600h: InverterInput = {
      ...baseInverterString,
      acOutputKw: 7.6,
      maxInputCurrentPerMppt: 20,
      integratedDcDisconnect: true,
    };
    const input = mkInput({}, [se7600h, se7600h]);
    const result = runElectricalCalc(input);
    expect(result.errors.map(e => e.code)).not.toContain('E-DC-DISCONNECT');
  });

  it('still fires E-DC-DISCONNECT if EVEN ONE non-micro inverter lacks integratedDcDisconnect', () => {
    const integrated: InverterInput = { ...baseInverterString, integratedDcDisconnect: true };
    const notIntegrated: InverterInput = { ...baseInverterString, integratedDcDisconnect: false };
    const input = mkInput({}, [integrated, notIntegrated]);
    const result = runElectricalCalc(input);
    expect(result.errors.map(e => e.code)).toContain('E-DC-DISCONNECT');
  });

  it('does not fire for pure microinverter systems (emits I-DC-DISCONNECT-MICRO info)', () => {
    const result = runElectricalCalc(mkInput({}, [baseInverterMicro]));
    expect(result.errors.map(e => e.code)).not.toContain('E-DC-DISCONNECT');
    expect((result.infos ?? []).map(i => i.code)).toContain('I-DC-DISCONNECT-MICRO');
  });

  it('does not fire when user has dcDisconnect: true, regardless of integrated flag', () => {
    const inv: InverterInput = { ...baseInverterString, integratedDcDisconnect: false };
    const result = runElectricalCalc(mkInput({ dcDisconnect: true }, [inv]));
    expect(result.errors.map(e => e.code)).not.toContain('E-DC-DISCONNECT');
  });

  it('info code I-DC-DISCONNECT-INTEGRATED carries NEC 690.15 reference and is an info (not error)', () => {
    const inv: InverterInput = { ...baseInverterString, integratedDcDisconnect: true };
    const result = runElectricalCalc(mkInput({}, [inv]));
    const info = (result.infos ?? []).find(i => i.code === 'I-DC-DISCONNECT-INTEGRATED');
    expect(info).toBeDefined();
    expect(info?.necReference).toBe('NEC 690.15');
    expect(info?.severity).toBe('info');
  });
});