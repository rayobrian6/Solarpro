// ═══════════════════════════════════════════════════════════════════════════
// Tesla Solar Inverter — Datasheet audit (v47.426)
// lib/tesla-datasheet.test.ts
//
// Rule (v47.418): do not derive fake short-circuit values from 1.25 × operating.
// Every field below is the literal manufacturer-published value from the
// Tesla Solar Inverter datasheet (tesla.com energy library).
//
// 4 SKUs: 3.8 / 5 / 5.7 / 7.6 kW. All pure string inverters with 2 MPPTs.
// Input connectors per MPPT follow a 1-2-1-2 pattern across the family.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { getInverterById } from './equipment-db';

interface TeslaDatasheetSpec {
  id: string;
  acKw: number;
  dcKwMax: number;
  mppts: number;
  stringsPerMppt: number;
  impPerMppt: number;   // A (IMP, not derived)
  iscPerMppt: number;   // A (ISC, literal datasheet value)
  maxDcV: number;
  mpptVmin: number;
  mpptVmax: number;
  peakEfficiency: number;  // %
  cecEfficiency: number;   // %
  acVoltage: number;
  warrantyYears: number;
}

// Per Tesla Solar Inverter datasheet (tesla.com energy library)
const TESLA_DATASHEET: TeslaDatasheetSpec[] = [
  { id: 'tesla-solar-inverter-3p8k',  acKw: 3.8, dcKwMax: 5.7,  mppts: 2, stringsPerMppt: 1, impPerMppt: 13, iscPerMppt: 17, maxDcV: 600, mpptVmin: 60, mpptVmax: 480, peakEfficiency: 98.6, cecEfficiency: 98.0, acVoltage: 240, warrantyYears: 12.5 },
  { id: 'tesla-solar-inverter-5k',    acKw: 5.0, dcKwMax: 7.5,  mppts: 2, stringsPerMppt: 2, impPerMppt: 13, iscPerMppt: 17, maxDcV: 600, mpptVmin: 60, mpptVmax: 480, peakEfficiency: 98.6, cecEfficiency: 98.0, acVoltage: 240, warrantyYears: 12.5 },
  { id: 'tesla-solar-inverter-5p7k',  acKw: 5.7, dcKwMax: 8.55, mppts: 2, stringsPerMppt: 1, impPerMppt: 13, iscPerMppt: 17, maxDcV: 600, mpptVmin: 60, mpptVmax: 480, peakEfficiency: 98.6, cecEfficiency: 98.0, acVoltage: 240, warrantyYears: 12.5 },
  { id: 'tesla-solar-inverter-7p6k',  acKw: 7.6, dcKwMax: 11.4, mppts: 2, stringsPerMppt: 2, impPerMppt: 13, iscPerMppt: 17, maxDcV: 600, mpptVmin: 60, mpptVmax: 480, peakEfficiency: 98.6, cecEfficiency: 98.0, acVoltage: 240, warrantyYears: 12.5 },
];

describe('Tesla Solar Inverter — equipment-db matches manufacturer datasheet', () => {
  for (const spec of TESLA_DATASHEET) {
    describe(spec.id, () => {
      const inv = getInverterById(spec.id);

      it('exists in equipment-db', () => {
        expect(inv, `${spec.id} missing from equipment-db`).toBeDefined();
      });

      if (!inv) return;

      it('AC output kW matches datasheet', () => {
        expect(inv.acOutputKw).toBe(spec.acKw);
      });

      it('DC input kW max matches datasheet', () => {
        expect(inv.dcInputKwMax).toBe(spec.dcKwMax);
      });

      it('MPPT channels match datasheet (all 4 SKUs have 2 MPPTs)', () => {
        expect(inv.mpptChannels).toBe(spec.mppts);
      });

      it('Parallel strings per MPPT match datasheet 1-2-1-2 pattern', () => {
        expect(inv.maxParallelStringsPerMppt).toBe(spec.stringsPerMppt);
      });

      it('Max input current per MPPT matches datasheet (13A IMP)', () => {
        expect(inv.maxInputCurrentPerMppt).toBe(spec.impPerMppt);
      });

      it('Max short-circuit current per MPPT matches datasheet (17A ISC literal)', () => {
        expect(inv.maxShortCircuitCurrent).toBe(spec.iscPerMppt);
      });

      it('Max DC voltage matches datasheet (600V)', () => {
        expect(inv.maxDcVoltage).toBe(spec.maxDcV);
      });

      it('MPPT voltage range matches datasheet (60-480V)', () => {
        expect(inv.mpptVoltageMin).toBe(spec.mpptVmin);
        expect(inv.mpptVoltageMax).toBe(spec.mpptVmax);
      });

      it('Peak efficiency matches datasheet (98.6%)', () => {
        expect(inv.efficiency).toBe(spec.peakEfficiency);
      });

      it('CEC efficiency matches datasheet (98.0%)', () => {
        expect(inv.cec_efficiency).toBe(spec.cecEfficiency);
      });

      it('AC output voltage matches datasheet (240V 1Φ)', () => {
        expect(inv.acOutputVoltage).toBe(spec.acVoltage);
      });

      it('UL 1741-SB listed per datasheet', () => {
        expect(inv.ulListing).toMatch(/1741.?SB/i);
      });

      it('AFCI protection integrated per datasheet', () => {
        expect(inv.arcFaultProtection).toBe(true);
      });

      it('Rapid shutdown compliant per datasheet (via Solar Shutdown Device)', () => {
        expect(inv.rapidShutdownCompliant).toBe(true);
      });

      it('warranty encodes 12.5-year duration', () => {
        expect(inv.warranty).toMatch(/12\.5/);
      });

      it('ecosystem tagged as tesla / solar-inverter', () => {
        expect(inv.ecosystemBrand).toBe('tesla');
        expect(inv.ecosystemFamily).toBe('solar-inverter');
      });
    });
  }
});