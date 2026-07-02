// ============================================================
// NEC ENGINE PARITY — drift fence (UNIFIED-ENGINE-DESIGN-SPEC.md, C8)
// ============================================================
// The Compliance tab runs runElectricalCalc (lib/electrical-calc.ts); the SLD
// runs computeSystem (lib/computed-system.ts). Audit C8 worried these "three NEC
// engines diverge." A 2026-06-21 parity measurement found the AC sizing path
// (NEC 690.8 inverter output current → 1.25 continuous → next-standard OCPD) is
// IDENTICAL between the two for string topology. Rather than do a high-risk
// refactor to merge the engines (which wouldn't change any number, since they
// already agree), this test LOCKS IN that agreement: if a future edit changes one
// engine's AC sizing and not the other, CI fails here and surfaces the C8 drift.
//
// Scope: AC output current, AC continuous current, AC OCPD — the permit-critical
// quantities both engines compute independently. (DC 690.7 string sizing is done
// by a separate generateStringConfig, already reconciled with computeSystem in
// commit 5703e4bf; a DC fence is a follow-up.)
import { describe, it, expect } from 'vitest';
import { runElectricalCalc, type ElectricalCalcInput } from '../lib/electrical-calc';
import { computeSystem, type ComputedSystemInput } from '../lib/computed-system';

// Representative Tesla TSP-420 panel.
const PANEL = { voc: 40.92, isc: 13.03, imp: 12.25, vmp: 34.29, watts: 420, tcVoc: -0.27, tcIsc: 0.04, fuse: 25 };

interface Case { name: string; acKw: number; acAmax: number; mppt: number; maxIn: number; strings: number[] }
const CASES: Case[] = [
  { name: '7.6 kW · 2 strings × 10', acKw: 7.6,  acAmax: 32, mppt: 2, maxIn: 17, strings: [10, 10] },
  { name: '11.4 kW · 3 strings × 11', acKw: 11.4, acAmax: 48, mppt: 3, maxIn: 17, strings: [11, 11, 11] },
  { name: '3.8 kW · 1 string × 12', acKw: 3.8,  acAmax: 16, mppt: 2, maxIn: 17, strings: [12] },
  { name: '15.2 kW · 4 strings × 10', acKw: 15.2, acAmax: 64, mppt: 4, maxIn: 17, strings: [10, 10, 10, 10] },
];

const SV = 240, TMIN = -10, TMAX = 40, ROOF = 30;

function buildEcInput(c: Case): ElectricalCalcInput {
  return {
    inverters: [{
      type: 'string', acOutputKw: c.acKw, maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
      maxInputCurrentPerMppt: c.maxIn, acOutputCurrentMax: c.acAmax,
      strings: c.strings.map(pc => ({
        panelCount: pc, panelVoc: PANEL.voc, panelIsc: PANEL.isc, panelImp: PANEL.imp, panelVmp: PANEL.vmp,
        panelWatts: PANEL.watts, tempCoeffVoc: PANEL.tcVoc, tempCoeffIsc: PANEL.tcIsc,
        maxSeriesFuseRating: PANEL.fuse, wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
      })),
    }],
    mainPanelAmps: 200, systemVoltage: SV, designTempMin: TMIN, designTempMax: TMAX, rooftopTempAdder: ROOF,
    wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true, necVersion: '2023',
  };
}

function buildCsInput(c: Case): ComputedSystemInput {
  const totalPanels = c.strings.reduce((a, b) => a + b, 0);
  return {
    topology: 'string', totalPanels, totalStrings: c.strings.length, panelWatts: PANEL.watts,
    panelVoc: PANEL.voc, panelIsc: PANEL.isc, panelVmp: PANEL.vmp, panelImp: PANEL.imp,
    panelTempCoeffVoc: PANEL.tcVoc, panelTempCoeffIsc: PANEL.tcIsc, panelMaxSeriesFuse: PANEL.fuse,
    panelModel: 'TSP-420', panelManufacturer: 'Tesla', inverterManufacturer: 'Tesla', inverterModel: 'TSI',
    inverterAcKw: c.acKw, inverterAcCurrentMax: c.acAmax, inverterMaxDcV: 600, inverterMpptVmin: 100, inverterMpptVmax: 600,
    inverterMaxInputCurrentPerMppt: c.maxIn, inverterMpptChannels: c.mppt, inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: TMIN, ambientTempC: 30, rooftopTempAdderC: ROOF, runLengths: {}, conduitType: 'EMT',
    mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200, interconnectionMethod: 'LOAD_SIDE',
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
  } as ComputedSystemInput;
}

describe('NEC engine parity (C8 drift fence): computeSystem vs electrical-calc — AC sizing', () => {
  for (const c of CASES) {
    it(`agrees on AC current / continuous / OCPD — ${c.name}`, () => {
      const ec = runElectricalCalc(buildEcInput(c));
      const cs = computeSystem(buildCsInput(c));

      // NEC 690.8 inverter output current
      expect(cs.acOutputCurrentA).toBeCloseTo(ec.acSizing.acCurrentAmps, 1);
      // × 1.25 continuous
      expect(cs.acContinuousCurrentA).toBeCloseTo(ec.acSizing.continuousCurrentAmps, 1);
      // next-standard OCPD (NEC 240.6) — must match exactly (it's a discrete breaker size)
      expect(cs.acOcpdAmps).toBe(ec.acSizing.ocpdAmps);
    });
  }
});
