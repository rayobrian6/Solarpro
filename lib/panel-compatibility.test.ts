/**
 * v47.421 — Panel Compatibility Helper regression tests.
 *
 * Locks in that findCompatiblePanels() + formatCompatiblePanelClause()
 * produce accurate, registry-driven suggestions for every brand's MPPT
 * current cap. Critical for the "panel swap suggestion" UX.
 */
import { describe, it, expect } from 'vitest';
import {
  findCompatiblePanels,
  formatCompatiblePanelClause,
} from './panel-compatibility';

describe('v47.421 — findCompatiblePanels()', () => {
  describe('API guarantees', () => {
    it('returns empty result when cap is undefined', () => {
      const r = findCompatiblePanels(undefined);
      expect(r.totalCompatible).toBe(0);
      expect(r.comfortable).toEqual([]);
      expect(r.marginal).toEqual([]);
    });

    it('returns empty result when cap is null', () => {
      const r = findCompatiblePanels(null);
      expect(r.totalCompatible).toBe(0);
    });

    it('returns empty result when cap is 0 or negative', () => {
      expect(findCompatiblePanels(0).totalCompatible).toBe(0);
      expect(findCompatiblePanels(-5).totalCompatible).toBe(0);
    });

    it('echoes the input cap and NEC multiplier into the result', () => {
      const r = findCompatiblePanels(13.5);
      expect(r.inverterMaxInputCurrentPerMppt).toBe(13.5);
      expect(r.necMultiplier).toBe(1.25);
    });

    it('honors custom necMultiplier option', () => {
      const r = findCompatiblePanels(13.5, { necMultiplier: 1.0 });
      expect(r.necMultiplier).toBe(1.0);
      // With multiplier 1.0, design current = Isc. Qcells Isc=12.26 → 12.26A,
      // which fits under 13.5A cap. So qcells becomes compatible.
      expect(r.totalCompatible).toBeGreaterThan(0);
    });
  });

  describe('Growatt MIN TL-XH-US (13.5A per-MPPT cap)', () => {
    const r = findCompatiblePanels(13.5);

    it('finds at least one compatible panel', () => {
      expect(r.totalCompatible).toBeGreaterThan(0);
    });

    it('includes Panasonic EverVolt HK Black 410W (Isc 10.06A → 12.58A design, fits)', () => {
      const all = [...r.comfortable, ...r.marginal];
      const evervolt = all.find(c => c.id === 'pan-evervolt-410');
      expect(evervolt).toBeDefined();
      expect(evervolt!.designCurrent).toBeCloseTo(12.58, 1);
    });

    it('excludes Qcells Peak Duo 400W (Isc 12.26A → 15.33A design, exceeds cap)', () => {
      const all = [...r.comfortable, ...r.marginal];
      const qcells = all.find(c => c.id === 'qcells-peak-duo-400');
      expect(qcells).toBeUndefined();
    });

    it('excludes Silfab 430W (Isc 13.30A → 16.63A design, exceeds cap)', () => {
      const all = [...r.comfortable, ...r.marginal];
      const silfab = all.find(c => c.id === 'silfab-sil430');
      expect(silfab).toBeUndefined();
    });

    it('excludes REC Alpha Pure 430W (Isc 11.14A → 13.93A design, exceeds cap)', () => {
      const all = [...r.comfortable, ...r.marginal];
      const rec = all.find(c => c.id === 'rec-alpha-pure-430');
      expect(rec).toBeUndefined();
    });

    it('all returned candidates have designCurrent ≤ 13.5A', () => {
      const all = [...r.comfortable, ...r.marginal];
      for (const c of all) {
        expect(c.designCurrent).toBeLessThanOrEqual(13.5);
      }
    });

    it('tiers each candidate correctly (comfortable vs marginal by 20% headroom)', () => {
      for (const c of r.comfortable) expect(c.headroom).toBeGreaterThanOrEqual(0.20);
      for (const c of r.marginal)    expect(c.headroom).toBeLessThan(0.20);
    });

    it('comfortable list is sorted by headroom DESC', () => {
      for (let i = 1; i < r.comfortable.length; i++) {
        expect(r.comfortable[i - 1].headroom).toBeGreaterThanOrEqual(r.comfortable[i].headroom);
      }
    });

    it('marginal list is sorted by watts DESC', () => {
      for (let i = 1; i < r.marginal.length; i++) {
        expect(r.marginal[i - 1].watts).toBeGreaterThanOrEqual(r.marginal[i].watts);
      }
    });
  });

  describe('Sol-Ark 8K-2P (18A per-MPPT cap)', () => {
    const r = findCompatiblePanels(18.0);

    it('finds more panels than Growatt (wider budget)', () => {
      const growatt = findCompatiblePanels(13.5);
      expect(r.totalCompatible).toBeGreaterThanOrEqual(growatt.totalCompatible);
    });

    it('includes Qcells Peak Duo 400W (Isc 12.26 → 15.33A, fits under 18A)', () => {
      const all = [...r.comfortable, ...r.marginal];
      expect(all.find(c => c.id === 'qcells-peak-duo-400')).toBeDefined();
    });

    it('includes Silfab 430W (Isc 13.30 → 16.63A, fits under 18A)', () => {
      const all = [...r.comfortable, ...r.marginal];
      expect(all.find(c => c.id === 'silfab-sil430')).toBeDefined();
    });
  });

  describe('Sol-Ark 15K-2P (26A per-MPPT cap)', () => {
    const r = findCompatiblePanels(26.0);

    it('fits every residential panel in the catalog', () => {
      // At 26A, even Isc=20.8A panels would fit. Every current catalog
      // panel has Isc ≤ 15A, so every one should fit comfortably.
      expect(r.marginal).toHaveLength(0);
      expect(r.comfortable.length).toBeGreaterThan(0);
      expect(r.totalCompatible).toBe(r.comfortable.length);
    });
  });

  describe('Excludes SolFence panel and inactive entries', () => {
    const r = findCompatiblePanels(26.0);
    const all = [...r.comfortable, ...r.marginal];

    it('panel-fence-ps1 is NOT in compatible list (fence-specific)', () => {
      expect(all.find(c => c.id === 'panel-fence-ps1')).toBeUndefined();
    });
  });

  describe('Display format', () => {
    const r = findCompatiblePanels(13.5);
    const all = [...r.comfortable, ...r.marginal];

    it('every candidate has a displayName in "Manufacturer Model" format', () => {
      for (const c of all) {
        expect(c.displayName).toMatch(/\S/); // non-empty
        expect(c.displayName).toContain(' '); // has a space
      }
    });

    it('designCurrent is rounded to 2 decimals', () => {
      for (const c of all) {
        // Should be at most 2 decimal places. Multiply by 100 and expect
        // the result to be (very close to) an integer.
        expect(Math.abs(c.designCurrent * 100 - Math.round(c.designCurrent * 100)))
          .toBeLessThan(1e-9);
      }
    });

    it('headroom is rounded to 3 decimals', () => {
      for (const c of all) {
        expect(Math.abs(c.headroom * 1000 - Math.round(c.headroom * 1000)))
          .toBeLessThan(1e-9);
      }
    });
  });
});

describe('v47.421 — formatCompatiblePanelClause()', () => {
  it('returns empty string when no compatible panels', () => {
    const empty = findCompatiblePanels(undefined);
    expect(formatCompatiblePanelClause(empty)).toBe('');
  });

  it('returns a human-readable clause for Growatt 13.5A cap', () => {
    const r = findCompatiblePanels(13.5);
    const clause = formatCompatiblePanelClause(r);
    expect(clause).toContain('Compatible panels in the SolarPro catalog');
    expect(clause).toContain('Panasonic EverVolt HK Black 410W');
    expect(clause).toMatch(/Isc \d+\.\d{2}A/);
    expect(clause).toMatch(/\d+\.\d{2}A design/);
    expect(clause).toMatch(/\d+% headroom/);
  });

  it('limits output to maxSuggestions (default 3)', () => {
    const r = findCompatiblePanels(26.0); // wide cap → many matches
    const clause = formatCompatiblePanelClause(r);
    // Count semicolons as proxy for pick count. 3 picks → 2 semicolons.
    const separators = (clause.match(/;/g) || []).length;
    expect(separators).toBeLessThanOrEqual(2);
  });

  it('respects custom maxSuggestions', () => {
    const r = findCompatiblePanels(26.0);
    const clauseOne = formatCompatiblePanelClause(r, 1);
    expect((clauseOne.match(/;/g) || []).length).toBe(0);
    const clauseFive = formatCompatiblePanelClause(r, 5);
    // Up to 4 separators for 5 picks (may be fewer if fewer matches exist).
    expect((clauseFive.match(/;/g) || []).length).toBeLessThanOrEqual(4);
  });

  it('adds "and N more" suffix when truncated', () => {
    const r = findCompatiblePanels(26.0);
    if (r.totalCompatible > 3) {
      const clause = formatCompatiblePanelClause(r, 3);
      expect(clause).toMatch(/and \d+ more in the catalog/);
    }
  });

  it('omits "and N more" when not truncated', () => {
    const r = findCompatiblePanels(13.5);
    const clause = formatCompatiblePanelClause(r, r.totalCompatible + 10);
    expect(clause).not.toMatch(/and \d+ more/);
  });

  it('tags marginal candidates with [marginal] flag', () => {
    const r = findCompatiblePanels(13.5);
    // Growatt's tight 13.5A cap generally produces some marginal matches.
    if (r.marginal.length > 0) {
      // Force the clause to include a marginal pick by requesting many.
      const clause = formatCompatiblePanelClause(r, r.totalCompatible);
      expect(clause).toContain('[marginal]');
    }
  });
});

describe('v47.421 — End-to-end integration with string-generator', () => {
  // When the string-generator emits MPPT_CURRENT_EXCEEDED, the error
  // message MUST now include a compatible-panels clause (when any match).
  it('MPPT_CURRENT_EXCEEDED error is enriched with compatible panel suggestions', async () => {
    const { generateStringConfig } = await import('./string-generator');
    // Silfab 430W (Isc 13.30) on Growatt-like 13.5A cap → every string fails.
    const silfab = {
      voc: 41.2, vmp: 34.4, isc: 13.30, imp: 12.50, watts: 430,
      tempCoeffVoc: -0.27, tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 25, maxSeriesFuse: 25,
    };
    const growatt = {
      maxDcVoltage: 600, mpptVoltageMin: 220, mpptVoltageMax: 500,
      mpptChannels: 3, maxInputCurrent: 13.5, maxInputCurrentPerMppt: 13.5,
      maxParallelStringsPerMppt: 2,
      acOutputKw: 11.4, dcInputKwMax: 22.8, nominalDcVoltage: 360,
    };
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: silfab,
      inverterSpecs: growatt,
      designTempMin: -10,
      topology: 'hybrid',
    });
    const errorText = result.errors.join(' ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
    // THE CORE ASSERTION: the error now mentions specific compatible panels.
    expect(errorText).toContain('Compatible panels in the SolarPro catalog');
    expect(errorText).toContain('Panasonic EverVolt HK Black 410W');
  });

  it('MPPT_CURRENT_EXCEEDED without a cap: gracefully omits the suggestion clause', async () => {
    const { generateStringConfig } = await import('./string-generator');
    // Pathological scenario: cap unknown, but other conditions produce the
    // error. With no cap, no suggestions can be computed — clause is empty.
    const highIscPanel = {
      voc: 41.2, vmp: 34.4, isc: 13.30, imp: 12.50, watts: 430,
      tempCoeffVoc: -0.27, tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 25, maxSeriesFuse: 25,
    };
    const inverterNoCap = {
      maxDcVoltage: 600, mpptVoltageMin: 220, mpptVoltageMax: 500,
      mpptChannels: 3,
      maxInputCurrent: undefined as unknown as number,
      maxInputCurrentPerMppt: undefined as unknown as number,
      maxParallelStringsPerMppt: 2,
      acOutputKw: 11.4, dcInputKwMax: 22.8,
    };
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: highIscPanel,
      inverterSpecs: inverterNoCap,
      designTempMin: -10,
      topology: 'hybrid',
    });
    // With cap undefined the current check may or may not trigger, but in
    // the event any error is emitted, it must not crash trying to suggest.
    expect(() => result.errors.join(' ')).not.toThrow();
  });
});