// ============================================================================
// lib/system/solaredgeDataConsistency.test.ts — Phase 13.6a
//
// SOLAREDGE DATA RECONCILIATION
//
// Locks in the fact that SolarEdge brand profile and equipment-db agree on
// mpptCount for every HD-Wave model, and that per-MPPT current limits match
// the datasheet (single-phase HD-Wave is 1 MPPT with 1-2 or 1-3 parallel
// strings per input, NOT 2 independent MPPT channels).
//
// Source of truth: SolarEdge HD-Wave datasheet for North America.
// https://www.solaredge.com/sites/default/files/se-hd-wave-single-phase-inverter-datasheet-na.pdf
// ============================================================================

import { describe, it, expect } from 'vitest';
import { STRING_INVERTERS } from '../equipment-db';
import { SOLAREDGE_PROFILE } from './brandProfiles/solaredge';

// ─── Datasheet truth table ──────────────────────────────────────────────────
// model-id → { expected mpptChannels, expected maxInputCurrent, expected max parallel strings per input }
const SE_HD_WAVE_DATASHEET = {
  'se-3800h':  { mpptChannels: 1, maxInputCurrent: 10.5, maxParallelStringsPerMppt: 2 },
  'se-6000h':  { mpptChannels: 1, maxInputCurrent: 16.5, maxParallelStringsPerMppt: 2 },
  // v47.416 — Corrected from 3 to 2 per official SolarEdge HD-Wave NA datasheet
  // ("DC Input Conduit Size / # of Strings: 3/4" minimum / 1-2 strings / 14-6 AWG").
  // Source: https://media.unboundsolar.com/.../solaredge-se7600h-hd-wave-inverter-specs-20190311174102.9995976-1.pdf
  'se-7600h':  { mpptChannels: 1, maxInputCurrent: 20.0, maxParallelStringsPerMppt: 2 },
  'se-10000h': { mpptChannels: 1, maxInputCurrent: 27.0, maxParallelStringsPerMppt: 3 },
  'se-11400h': { mpptChannels: 1, maxInputCurrent: 30.5, maxParallelStringsPerMppt: 3 },
} as const;

describe('Phase 13.6a — SolarEdge HD-Wave data consistency', () => {
  // ── (1) Equipment-db reflects the datasheet ────────────────────────────
  describe('equipment-db matches SolarEdge HD-Wave datasheet', () => {
    for (const [id, expected] of Object.entries(SE_HD_WAVE_DATASHEET)) {
      it(`${id} has the correct MPPT and current specs`, () => {
        const inv = STRING_INVERTERS.find(x => x.id === id);
        expect(inv, `${id} not found in equipment-db`).toBeDefined();
        if (!inv) return;
        expect(inv.mpptChannels, `${id}.mpptChannels`).toBe(expected.mpptChannels);
        expect(inv.numberOfMPPT, `${id}.numberOfMPPT`).toBe(expected.mpptChannels);
        expect(inv.maxInputCurrentPerMppt, `${id}.maxInputCurrentPerMppt`).toBe(expected.maxInputCurrent);
        expect(
          inv.maxParallelStringsPerMppt,
          `${id}.maxParallelStringsPerMppt`
        ).toBe(expected.maxParallelStringsPerMppt);
      });
    }
  });

  // ── (2) Brand profile agrees with equipment-db ─────────────────────────
  describe('brand profile mpptCount matches equipment-db mpptChannels', () => {
    for (const modelRef of SOLAREDGE_PROFILE.supportedInverterModels) {
      it(`${modelRef.equipmentDbId} mpptCount matches equipment-db`, () => {
        const eq = STRING_INVERTERS.find(x => x.id === modelRef.equipmentDbId);
        expect(eq, `equipment-db entry missing for ${modelRef.equipmentDbId}`).toBeDefined();
        if (!eq) return;
        expect(
          modelRef.mpptCount,
          `brand profile mpptCount must match equipment-db mpptChannels for ${modelRef.equipmentDbId}`
        ).toBe(eq.mpptChannels);
      });
    }
  });

  // ── (3) Per-string current check now passes for 400W panels ───────────
  // NEC 690.8(A): design current = Isc × 1.25. For a typical 400W panel
  // with Isc=12.2A, design = 15.25A. The SolarEdge HD-Wave models with the
  // fixed datasheet current caps can accept this:
  //   SE3800H (10.5A) → cannot (too small; irrelevant — 1 string at this Isc
  //                    exceeds cap; this is correct behavior and documented)
  //   SE6000H  (16.5A) → yes, 1 string  ✓
  //   SE7600H  (20.0A) → yes, 1 string  ✓
  //   SE10000H (27.0A) → yes, 1 string  ✓  (room for a second parallel but
  //                      2 × 15.25 = 30.5A > 27A cap, so still 1 string max)
  //   SE11400H (30.5A) → yes, 1 string  ✓  (exactly at cap for 2 strings,
  //                      2 × 15.25 = 30.5A ≤ 30.5A — OK numerically)
  it('SE-11400H can accept 1 string of a 400W/12.2A-Isc panel (pre-13.6a this failed)', () => {
    const inv = STRING_INVERTERS.find(x => x.id === 'se-11400h')!;
    const designCurrentPerString = 12.2 * 1.25; // 15.25A
    expect(inv.maxInputCurrentPerMppt).toBeGreaterThanOrEqual(designCurrentPerString);
  });

  it('SE-6000H can accept 1 string of a 400W/12.2A-Isc panel (pre-13.6a this failed)', () => {
    const inv = STRING_INVERTERS.find(x => x.id === 'se-6000h')!;
    const designCurrentPerString = 12.2 * 1.25;
    expect(inv.maxInputCurrentPerMppt).toBeGreaterThanOrEqual(designCurrentPerString);
  });
});