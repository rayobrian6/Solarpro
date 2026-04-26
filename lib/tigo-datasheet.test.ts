// ═══════════════════════════════════════════════════════════════════════════
// Tigo EI Inverter — Datasheet audit (v47.426)
// lib/tigo-datasheet.test.ts
//
// Rule (v47.418): do not derive fake short-circuit values from 1.25 × operating.
// Every field below is the literal manufacturer-published value from the
// Tigo EI Inverter datasheet (Krannich, July 2024, 002-00081-00 v4.4).
//
// 3 SKUs: TSI-3.8/7.6/11.4K-US. Hybrid single-phase residential, 240V, up to
// 200% DC oversizing, 2 strings per MPPT, 152-month warranty.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { getInverterById } from './equipment-db';

interface TigoDatasheetSpec {
  id: string;
  acKw: number;
  dcKwStc: number;    // Max recommended STC (per datasheet)
  mppts: number;
  stringsPerMppt: number;
  impPerMppt: number;   // A
  iscPerMppt: number;   // A
  maxDcV: number;
  mpptVmin: number;
  mpptVmax: number;
  peakEfficiency: number;  // %
  cecEfficiency: number;   // % (@240V)
  acVoltage: number;
  warrantyMonths: number;
  acOutputAmpsMax: number;
}

// Per Tigo EI Inverter datasheet 002-00081-00 v4.4 (Krannich, Jul 2024)
const TIGO_DATASHEET: TigoDatasheetSpec[] = [
  { id: 'tigo-tsi-3p8k-us',  acKw: 3.8,  dcKwStc: 7.6,  mppts: 2, stringsPerMppt: 2, impPerMppt: 13.5, iscPerMppt: 16.9, maxDcV: 600, mpptVmin: 80, mpptVmax: 550, peakEfficiency: 98.0, cecEfficiency: 97.0, acVoltage: 240, warrantyMonths: 152, acOutputAmpsMax: 16 },
  { id: 'tigo-tsi-7p6k-us',  acKw: 7.6,  dcKwStc: 15.2, mppts: 3, stringsPerMppt: 2, impPerMppt: 13.5, iscPerMppt: 16.9, maxDcV: 600, mpptVmin: 80, mpptVmax: 550, peakEfficiency: 98.4, cecEfficiency: 97.5, acVoltage: 240, warrantyMonths: 152, acOutputAmpsMax: 32 },
  { id: 'tigo-tsi-11p4k-us', acKw: 11.4, dcKwStc: 22.8, mppts: 4, stringsPerMppt: 2, impPerMppt: 13.5, iscPerMppt: 16.9, maxDcV: 600, mpptVmin: 80, mpptVmax: 550, peakEfficiency: 98.5, cecEfficiency: 98.0, acVoltage: 240, warrantyMonths: 152, acOutputAmpsMax: 48 },
];

describe('Tigo EI Inverter — equipment-db matches manufacturer datasheet', () => {
  for (const spec of TIGO_DATASHEET) {
    describe(spec.id, () => {
      const inv = getInverterById(spec.id);

      it('exists in equipment-db', () => {
        expect(inv, `${spec.id} missing from equipment-db`).toBeDefined();
      });

      if (!inv) return;

      it('AC output kW matches datasheet', () => {
        expect(inv.acOutputKw).toBe(spec.acKw);
      });

      it('DC input kW max matches datasheet (max recommended STC)', () => {
        expect(inv.dcInputKwMax).toBe(spec.dcKwStc);
      });

      it('MPPT channels match datasheet (2/3/4 pattern across family)', () => {
        expect(inv.mpptChannels).toBe(spec.mppts);
      });

      it('Parallel strings per MPPT match datasheet (2 per MPPT)', () => {
        expect(inv.maxParallelStringsPerMppt).toBe(spec.stringsPerMppt);
      });

      it('Max input current per MPPT matches datasheet (13.5A IMP)', () => {
        expect(inv.maxInputCurrentPerMppt).toBe(spec.impPerMppt);
      });

      it('Max short-circuit current per MPPT matches datasheet (16.9A ISC literal)', () => {
        expect(inv.maxShortCircuitCurrent).toBe(spec.iscPerMppt);
      });

      it('Max DC voltage matches datasheet (600V)', () => {
        expect(inv.maxDcVoltage).toBe(spec.maxDcV);
      });

      it('MPPT voltage range matches datasheet (80-550V)', () => {
        expect(inv.mpptVoltageMin).toBe(spec.mpptVmin);
        expect(inv.mpptVoltageMax).toBe(spec.mpptVmax);
      });

      it('Peak efficiency matches datasheet', () => {
        expect(inv.efficiency).toBe(spec.peakEfficiency);
      });

      it('CEC efficiency matches datasheet (@240V)', () => {
        expect(inv.cec_efficiency).toBe(spec.cecEfficiency);
      });

      it('AC output voltage matches datasheet (240V 1Φ)', () => {
        expect(inv.acOutputVoltage).toBe(spec.acVoltage);
      });

      it('AC output current max matches datasheet', () => {
        expect(inv.acOutputCurrentMax).toBe(spec.acOutputAmpsMax);
      });

      it('UL 1741:2021 Ed.3 SB listed per datasheet', () => {
        expect(inv.ulListing).toMatch(/1741.?SB/i);
      });

      it('AFCI protection integrated per datasheet', () => {
        expect(inv.arcFaultProtection).toBe(true);
      });

      it('Rapid shutdown compliant per datasheet (PVRSS with TS4)', () => {
        expect(inv.rapidShutdownCompliant).toBe(true);
      });

      it('warranty encodes 152-month duration', () => {
        expect(inv.warranty).toMatch(/152/);
      });

      it('ecosystem tagged as tigo / ei-inverter', () => {
        expect(inv.ecosystemBrand).toBe('tigo');
        expect(inv.ecosystemFamily).toBe('ei-inverter');
      });
    });
  }
});