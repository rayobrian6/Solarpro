/**
 * v47.429 — RACKING DATABASE AUDIT LOCK (Stage 6)
 *
 * Regression guard for lib/racking-database.ts. This file is the
 * structural-engineering-facing racking registry (12 systems across
 * 11 manufacturers). It is NOT yet wired to the UI — the UI reads
 * mounting-hardware-db.ts. Both DBs coexist until Stage 7/8 decides
 * whether to consolidate.
 *
 * This audit locks the authoritative per-row values so that:
 *   (a) A future consolidation (Stage 7/8) can't silently drop a row
 *   (b) A refactor can't accidentally rename an id that downstream
 *       structural-engine-v3.ts + inventoryAllEquipment.ts depend on
 *   (c) Published manufacturer/model names stay in sync with datasheet claims
 *
 * Every value below was extracted from lib/racking-database.ts v47.429.
 * To update a value, first verify the new value against the source
 * datasheet, then update both this file and the registry in the SAME commit.
 */
import { describe, it, expect } from 'vitest';
import {
  RACKING_DATABASE,
  getRackingById,
  getRackingByManufacturer,
  getManufacturers,
  type RackingSystemSpec,
} from './racking-database';

// ─── Expected top-level locks for all 12 rows ─────────────────────

interface RackingLock {
  id: string;
  manufacturer: string;
  model: string;
  systemType: string;
  ulListing: string;
  warranty: string;
}

// Values below were extracted programmatically from lib/racking-database.ts
// during v47.429 ship. To update: verify the new value against the source
// datasheet, then update both this file and the registry in the same commit.
const EXPECTED_ROWS: RackingLock[] = [
  { id: 'ironridge-xr100',     manufacturer: 'IronRidge',     model: 'XR100 Rail System',           systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'ironridge-xr1000',    manufacturer: 'IronRidge',     model: 'XR1000 Rail System',          systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'unirac-solarmount',   manufacturer: 'Unirac',        model: 'SolarMount',                  systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'unirac-sme',          manufacturer: 'Unirac',        model: 'SolarMount Evolution (SME)',  systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'rooftech-mini',       manufacturer: 'Roof Tech',     model: 'RT-MINI Flush Mount',         systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'snapnrack-100',       manufacturer: 'SnapNrack',     model: 'Series 100',                  systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'quickmount-classic',  manufacturer: 'QuickMount PV', model: 'Classic Mount',               systemType: 'rail_based', ulListing: 'UL 2703', warranty: '10 years' },
  { id: 'quickmount-tile',     manufacturer: 'QuickMount PV', model: 'Tile Replacement Mount',      systemType: 'rail_based', ulListing: 'UL 2703', warranty: '10 years' },
  { id: 's5-pvkit',            manufacturer: 'S-5!',          model: 'PVKIT 2.0',                   systemType: 'clamp_only', ulListing: 'UL 2703', warranty: '25 years' },
  { id: 'k2-crossrail',        manufacturer: 'K2 Systems',    model: 'CrossRail',                   systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'ecofasten-rockit',    manufacturer: 'EcoFasten',     model: 'Rock-It',                     systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'dpw-powerrail',       manufacturer: 'DPW Solar',     model: 'Power Rail',                  systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'schletter-classic',   manufacturer: 'Schletter',     model: 'Classic Roof Mount',          systemType: 'rail_based', ulListing: 'UL 2703', warranty: '20 years' },
  { id: 'esdec-flatfix',       manufacturer: 'Esdec',         model: 'FlatFix Fusion',              systemType: 'ballasted',  ulListing: 'UL 2703', warranty: '20 years' },
];

// ─── Tests ────────────────────────────────────────────────────────

describe('v47.429 — racking-database.ts audit lock', () => {
  describe('Row count and presence', () => {
    it('registry contains exactly the audited set of rows', () => {
      // If this fails, someone added/removed a row. That is fine — update
      // EXPECTED_ROWS above AND verify the new row was actually datasheet-sourced.
      const idsInRegistry = RACKING_DATABASE.map(r => r.id).sort();
      const idsExpected = EXPECTED_ROWS.map(r => r.id).sort();
      expect(idsInRegistry).toEqual(idsExpected);
    });

    it('registry has no duplicate ids', () => {
      const idCounts = new Map<string, number>();
      for (const r of RACKING_DATABASE) {
        idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
      }
      const dups = Array.from(idCounts.entries()).filter(([, n]) => n > 1);
      expect(
        dups,
        dups.map(([id, n]) => `duplicate id '${id}' ×${n}`).join('\n'),
      ).toEqual([]);
    });
  });

  describe('Per-row field locks', () => {
    EXPECTED_ROWS.forEach(expected => {
      it(`${expected.id}: manufacturer/model/systemType/ul/warranty match lock`, () => {
        const row = getRackingById(expected.id);
        expect(row, `id '${expected.id}' not found in RACKING_DATABASE`).toBeDefined();
        const r = row as RackingSystemSpec;
        expect(r.manufacturer).toBe(expected.manufacturer);
        expect(r.model).toBe(expected.model);
        expect(r.systemType).toBe(expected.systemType);
        expect(r.ulListing).toBe(expected.ulListing);
        expect(r.warranty).toBe(expected.warranty);
      });
    });
  });

  describe('Helper function integrity', () => {
    it('getManufacturers returns exactly the 11 brands in the audit lock', () => {
      const expectedBrands = Array.from(
        new Set(EXPECTED_ROWS.map(r => r.manufacturer)),
      ).sort();
      expect(getManufacturers().sort()).toEqual(expectedBrands);
    });

    it('getRackingByManufacturer returns non-empty list for every locked brand', () => {
      const brands = Array.from(new Set(EXPECTED_ROWS.map(r => r.manufacturer)));
      for (const brand of brands) {
        const rows = getRackingByManufacturer(brand);
        expect(
          rows.length,
          `getRackingByManufacturer('${brand}') returned zero rows`,
        ).toBeGreaterThan(0);
      }
    });

    it('getRackingById returns undefined for unknown id (no silent fallback)', () => {
      expect(getRackingById('this-id-should-not-exist-xyz')).toBeUndefined();
    });
  });

  describe('Cross-DB cross-check', () => {
    it('every locked manufacturer is also present in mounting-hardware-db', async () => {
      // Stage 6/7/8 guard: the two racking DBs must share manufacturers.
      // If a brand exists in racking-database.ts but NOT in mounting-hardware-db.ts,
      // the EcosystemPicker (which reads mounting-hardware-db) can never
      // surface it — that would be a silent UI gap.
      const { getAllMountingSystems } = await import('./mounting-hardware-db');
      const uiMfgs = new Set(
        getAllMountingSystems().map(s => (s.manufacturer || '').toLowerCase()),
      );
      const missing: string[] = [];
      for (const row of EXPECTED_ROWS) {
        if (!uiMfgs.has(row.manufacturer.toLowerCase())) {
          missing.push(row.manufacturer);
        }
      }
      expect(
        missing,
        missing.length
          ? `These racking-database manufacturers are MISSING from mounting-hardware-db: ${missing.join(', ')}`
          : '',
      ).toEqual([]);
    });
  });
});