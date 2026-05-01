// ═══════════════════════════════════════════════════════════════════════════
// Solis S6-EH1P US — Datasheet audit (v47.426)
// lib/solis-datasheet.test.ts
//
// Rule (v47.418): do not derive fake short-circuit values from 1.25 × operating.
// Every field below is the literal manufacturer-published value from the
// Ginlong Solis S6-EH1P US datasheet (Krannich Solar, December 2024).
//
// If the equipment-db drifts from the datasheet, this test fails loudly.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { getInverterById } from './equipment-db';

interface SolisDatasheetSpec {
  id: string;
  acKw: number;
  dcKwMax: number;
  mppts: number;
  stringsPerMppt: number;
  impPerMppt: number;   // A
  iscPerMppt: number;   // A
  maxDcV: number;
  mpptVmin: number;
  mpptVmax: number;
  peakEfficiency: number;  // %
  cecEfficiency: number;   // %
  acVoltage: number;
}

// Per Krannich Solar Ginlong Solis S6-EH1P US datasheet (Dec 2024 edition)
const SOLIS_DATASHEET: SolisDatasheetSpec[] = [
  { id: 'solis-s6-eh1p-3p8k-us',  acKw: 3.8,  dcKwMax: 5.7,   mppts: 2, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.0, cecEfficiency: 96.5, acVoltage: 240 },
  { id: 'solis-s6-eh1p-5k-us',    acKw: 5.0,  dcKwMax: 7.5,   mppts: 2, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.0, cecEfficiency: 96.5, acVoltage: 240 },
  { id: 'solis-s6-eh1p-7p6k-us',  acKw: 7.6,  dcKwMax: 11.4,  mppts: 3, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.6, cecEfficiency: 97.0, acVoltage: 240 },
  { id: 'solis-s6-eh1p-9p9k-us',  acKw: 9.9,  dcKwMax: 14.85, mppts: 4, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.6, cecEfficiency: 97.0, acVoltage: 240 },
  { id: 'solis-s6-eh1p-10k-us',   acKw: 10.0, dcKwMax: 15.0,  mppts: 4, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.6, cecEfficiency: 97.0, acVoltage: 240 },
  { id: 'solis-s6-eh1p-11p4k-us', acKw: 11.4, dcKwMax: 17.1,  mppts: 4, stringsPerMppt: 1, impPerMppt: 16, iscPerMppt: 25.6, maxDcV: 600, mpptVmin: 80, mpptVmax: 520, peakEfficiency: 97.6, cecEfficiency: 97.0, acVoltage: 240 },
];

describe('Solis S6-EH1P US — equipment-db matches manufacturer datasheet', () => {
  for (const spec of SOLIS_DATASHEET) {
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

      it('MPPT channels match datasheet', () => {
        expect(inv.mpptChannels).toBe(spec.mppts);
      });

      it('Parallel strings per MPPT match datasheet (1 per MPPT for S6-EH1P)', () => {
        expect(inv.maxParallelStringsPerMppt).toBe(spec.stringsPerMppt);
      });

      it('Max input current per MPPT matches datasheet (IMP, not derived)', () => {
        expect(inv.maxInputCurrentPerMppt).toBe(spec.impPerMppt);
      });

      it('Max short-circuit current per MPPT matches datasheet (ISC, literal value)', () => {
        expect(inv.maxShortCircuitCurrent).toBe(spec.iscPerMppt);
      });

      it('Max DC voltage matches datasheet', () => {
        expect(inv.maxDcVoltage).toBe(spec.maxDcV);
      });

      it('MPPT voltage range matches datasheet', () => {
        expect(inv.mpptVoltageMin).toBe(spec.mpptVmin);
        expect(inv.mpptVoltageMax).toBe(spec.mpptVmax);
      });

      it('Peak efficiency matches datasheet', () => {
        expect(inv.efficiency).toBe(spec.peakEfficiency);
      });

      it('CEC efficiency matches datasheet', () => {
        expect(inv.cec_efficiency).toBe(spec.cecEfficiency);
      });

      it('AC output voltage matches datasheet (240V split-phase)', () => {
        expect(inv.acOutputVoltage).toBe(spec.acVoltage);
      });

      it('UL 1741-SB listed (NEC 690/705 compliance)', () => {
        expect(inv.ulListing).toMatch(/1741.?SB/i);
      });

      it('AFCI protection integrated per datasheet', () => {
        expect(inv.arcFaultProtection).toBe(true);
      });

      it('Rapid shutdown compliant per datasheet (SunSpec transmitter)', () => {
        expect(inv.rapidShutdownCompliant).toBe(true);
      });

      it('ecosystem tagged as solis / s6-eh1p', () => {
        expect(inv.ecosystemBrand).toBe('solis');
        expect(inv.ecosystemFamily).toBe('s6-eh1p');
      });
    });
  }
});