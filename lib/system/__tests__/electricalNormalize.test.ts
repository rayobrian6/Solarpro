// ============================================================
// Tests — v61.6 Electrical String Integrity
// ============================================================
// Run with: npx jest lib/system/__tests__/electricalNormalize.test.ts
//
// These tests verify that the electricalNormalize module correctly:
//   1. Detects 1×N string violations (single string with panelCount > maxPanelsPerString)
//   2. Ignores micro topologies (legitimate single-string)
//   3. Does NOT flag multi-string configs even if total panels is large
//   4. Repairs 1×N violations via repairElectricallyInvalidInverter
//   5. electricallyNormalizeInverterConfig is idempotent
//   6. Correctly looks up maxPanelsPerString from brand profiles
//   7. Falls back to CONSERVATIVE_MAX_PANELS_PER_STRING for unknown inverter IDs
//   8. Repairs through the one string engine only (no even split, no defaulted facts)

import {
  isElectricallyInvalid,
  getMaxPanelsPerString,
  repairElectricallyInvalidInverter,
  electricallyNormalizeInverterConfig,
  CONSERVATIVE_MAX_PANELS_PER_STRING,
  type ElectricalNormalizeResult,
} from '../electricalNormalize';
import {
  buildStringConfig,
  buildInverterConfig,
  validateInverterMetadata,
  type InverterConfig,
} from '../buildInverterConfig';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a structurally-valid InverterConfig with N strings × M panels. */
function makeInv(
  inverterId: string,
  type: InverterConfig['type'],
  strings: Array<{ panelCount: number }>,
  panelId?: string,
): InverterConfig {
  const strConfigs = strings.map((s, i) =>
    buildStringConfig({ index: i, panelCount: s.panelCount, ...(panelId ? { panelId } : {}) }),
  );
  return buildInverterConfig({ inverterId, type, strings: strConfigs });
}

/** Wrap one inverter in a minimal config object. */
function wrapConfig(inv: InverterConfig) {
  return { inverters: [inv] };
}

// ─── getMaxPanelsPerString ────────────────────────────────────────────────────

describe('getMaxPanelsPerString', () => {
  it('returns the correct value for a known Solis inverter', () => {
    // solis-s6-eh1p-5k-us has maxPanelsPerString: 13
    expect(getMaxPanelsPerString('solis-s6-eh1p-5k-us')).toBe(13);
  });

  it('returns the correct value for a known SMA inverter', () => {
    // sma-sb-5.0 has maxPanelsPerString: 11
    expect(getMaxPanelsPerString('sma-sb-5.0')).toBe(11);
  });

  it('returns the correct value for a SolarEdge inverter', () => {
    // se-7600h has maxPanelsPerString: 25
    expect(getMaxPanelsPerString('se-7600h')).toBe(25);
  });

  it('returns CONSERVATIVE_MAX_PANELS_PER_STRING for an unknown inverterId', () => {
    expect(getMaxPanelsPerString('totally-unknown-inv-xyz')).toBe(CONSERVATIVE_MAX_PANELS_PER_STRING);
  });

  it('CONSERVATIVE_MAX_PANELS_PER_STRING is 20', () => {
    expect(CONSERVATIVE_MAX_PANELS_PER_STRING).toBe(20);
  });
});

// ─── isElectricallyInvalid ────────────────────────────────────────────────────

describe('isElectricallyInvalid', () => {
  it('returns false for a micro inverter with a single large string (legitimate)', () => {
    // Micro: 44 panels in one string is correct — it's a logical group, not a physical string
    const inv = makeInv('enphase-iq8plus', 'micro', [{ panelCount: 44 }]);
    expect(isElectricallyInvalid(inv)).toBe(false);
  });

  it('returns false for a healthy string inverter with multiple strings', () => {
    // 4 strings × 11 panels — totally valid
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [
      { panelCount: 11 },
      { panelCount: 11 },
      { panelCount: 11 },
      { panelCount: 11 },
    ]);
    expect(isElectricallyInvalid(inv)).toBe(false);
  });

  it('returns false for a string inverter with a single string within limit', () => {
    // 1 string × 10 panels, maxPanelsPerString=13 → valid
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 10 }]);
    expect(isElectricallyInvalid(inv)).toBe(false);
  });

  it('returns false for a trivial/empty string (panelCount ≤ 1)', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 1 }]);
    expect(isElectricallyInvalid(inv)).toBe(false);
  });

  it('returns true for the canonical 1×44 Solis bug (maxPanelsPerString=13)', () => {
    // THE ROOT BUG: 44 panels crammed into a single string for a Solis inverter
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    expect(isElectricallyInvalid(inv)).toBe(true);
  });

  it('returns FALSE for 1×21 with an inverter the catalogue does not hold — nothing to land on, nothing to repair', () => {
    // 🚨 This pinned the fabricator. An entry with no catalogued inverter has no input window, so it
    // has no string partition to be wrong: it is the "choose a PV inverter" state. Treating it as a
    // 1×N violation is what split a fresh 37-module project into 20 / 17 (closure brief §2).
    const inv = makeInv('unknown-inv', 'string', [{ panelCount: 21 }]);
    expect(isElectricallyInvalid(inv)).toBe(false);
    expect(isElectricallyInvalid(makeInv('', 'string', [{ panelCount: 37 }]))).toBe(false);
  });

  it('an inverter-less entry is never re-split into a 20-module "conservative" partition', () => {
    const fresh = makeInv('', 'string', [{ panelCount: 37 }]);
    const out = electricallyNormalizeInverterConfig({ inverters: [fresh] });
    expect(out.rebuiltCount).toBe(0);
    expect((out.config.inverters as typeof fresh[])[0].strings.map(s => s.panelCount)).toEqual([37]);
    expect((out.config.inverters as typeof fresh[])[0].strings.map(s => s.panelCount)).not.toEqual([20, 17]);
  });

  it('returns false for 1×20 with unknown inverter (exactly at conservative limit)', () => {
    // Exactly at threshold — not a violation
    const inv = makeInv('unknown-inv', 'string', [{ panelCount: 20 }]);
    expect(isElectricallyInvalid(inv)).toBe(false);
  });

  it('returns true for optimizer topology with a 1×N violation', () => {
    // Optimizer is NOT micro — still subject to electrical validation
    const inv = makeInv('sma-sb-5.0', 'optimizer', [{ panelCount: 30 }]);
    expect(isElectricallyInvalid(inv)).toBe(true);
  });
});

// ─── repairElectricallyInvalidInverter ────────────────────────────────────────
//
// 🚨 THE REPAIR IS THE ONE STRING ENGINE'S (closure review). It re-strung through `sizeSystemFromBrand`
// on defaulted facts (49.6 V, −0.27 %/°C, 400 W, −10 °C) and kept only the strings of inverterIndex 0,
// so a 1 × 37 on an SMA SB 7.7 came back as 10 / 9 — 19 of 37 modules. Now: the entry's own inverter,
// the string's catalogued module, the caller's design low, one entry per unit, every module kept — or
// the entry unchanged when no valid layout exists.

const DESIGN_LOW = { designTempMin: -10 };
const solis44 = () => makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }], 'qcells-peak-duo-400');
const total = (invs: InverterConfig[]) => invs.reduce((n, i) => n + i.strings.reduce((m, s) => m + s.panelCount, 0), 0);

describe('repairElectricallyInvalidInverter', () => {
  it('re-strings the canonical 1×44 Solis bug through the engine, across the units it needs, keeping every module', () => {
    const inv = solis44();
    expect(isElectricallyInvalid(inv)).toBe(true);
    const repaired = repairElectricallyInvalidInverter(inv, DESIGN_LOW);
    expect(repaired.length).toBeGreaterThan(1);           // 17.6 kW DC on a 7.5 kW-DC-input inverter
    expect(total(repaired)).toBe(44);                     // nothing dropped (was: inverterIndex 0 only)
    const maxPPS = getMaxPanelsPerString('solis-s6-eh1p-5k-us');
    for (const r of repaired) {
      expect(r.inverterId).toBe('solis-s6-eh1p-5k-us');
      expect(validateInverterMetadata(r)).toHaveLength(0);
      for (const str of r.strings) {
        expect(str.panelCount).toBeLessThanOrEqual(maxPPS);
        expect(str.panelCount).toBeGreaterThan(0);
      }
    }
    expect(new Set(repaired.map(r => r.id)).size).toBe(repaired.length);
    expect(repaired[0].id).toBe(inv.id);
  });

  it('without the project\'s design low, or without a catalogued module, nothing is re-strung (no defaulted fact)', () => {
    const inv = solis44();
    expect(repairElectricallyInvalidInverter(inv)).toEqual([inv]);
    const noModule = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    expect(repairElectricallyInvalidInverter(noModule, DESIGN_LOW)).toEqual([noModule]);
  });

  it('an inverter the engine cannot string is left as it is — the violation stays visible', () => {
    // SMA SB 5.0: 10 A operating limit per MPPT, below the module's Imp — no string of it fits an input.
    const inv = makeInv('sma-sb-5.0', 'string', [{ panelCount: 30 }], 'qcells-peak-duo-400');
    expect(repairElectricallyInvalidInverter(inv, DESIGN_LOW)).toEqual([inv]);
  });

  it('preserves inverterId and type after repair', () => {
    const inv = makeInv('growatt-min-5000tl-xh-us', 'string', [{ panelCount: 44 }], 'qcells-peak-duo-400');
    const repaired = repairElectricallyInvalidInverter(inv, DESIGN_LOW);
    expect(repaired.length).toBeGreaterThan(0);
    for (const r of repaired) {
      expect(r.inverterId).toBe('growatt-min-5000tl-xh-us');
      expect(r.type).toBe('string');
      expect(isElectricallyInvalid(r)).toBe(false);
    }
    expect(total(repaired)).toBe(44);
  });
});

// ─── electricallyNormalizeInverterConfig ─────────────────────────────────────

describe('electricallyNormalizeInverterConfig', () => {
  it('is a no-op for a config with no inverters', () => {
    const config = { systemType: 'roof' };
    const result = electricallyNormalizeInverterConfig(config);
    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config); // exact same object reference
  });

  it('is a no-op for a config with all-valid inverters', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [
      { panelCount: 11 }, { panelCount: 11 }, { panelCount: 11 }, { panelCount: 11 },
    ]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config, DESIGN_LOW);
    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config); // exact same object reference — no copy
  });

  it('repairs a config with a 1×44 Solis violation — every module kept, one entry per unit', () => {
    const config = wrapConfig(solis44());
    const result = electricallyNormalizeInverterConfig(config, DESIGN_LOW);
    expect(result.rebuiltCount).toBe(1);
    const invs = result.config.inverters as InverterConfig[];
    expect(invs.length).toBeGreaterThan(1);
    expect(total(invs)).toBe(44);
    for (const r of invs) expect(isElectricallyInvalid(r)).toBe(false);
  });

  it('is idempotent — calling twice on an invalid config fixes it on the first call, no-op on second', () => {
    const config = wrapConfig(solis44());
    const firstPass = electricallyNormalizeInverterConfig(config, DESIGN_LOW);
    expect(firstPass.rebuiltCount).toBe(1);
    const secondPass = electricallyNormalizeInverterConfig(firstPass.config, DESIGN_LOW);
    expect(secondPass.rebuiltCount).toBe(0);
    expect(secondPass.config).toBe(firstPass.config); // no-op: same reference
  });

  it('a config the engine cannot repair comes back as the same reference (no re-render loop, no invented split)', () => {
    const config = wrapConfig(solis44());
    const result = electricallyNormalizeInverterConfig(config); // no design low
    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config);
  });

  it('does not repair a micro inverter even with a very large single string', () => {
    const inv = makeInv('enphase-iq8plus', 'micro', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config, DESIGN_LOW);
    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config); // no-op
    expect((result.config.inverters![0] as InverterConfig).strings[0].panelCount).toBe(44);
  });

  it('repairs only the invalid inverter in a mixed-validity multi-inverter config', () => {
    const validInv = makeInv('solis-s6-eh1p-5k-us', 'string', [
      { panelCount: 11 }, { panelCount: 11 },
    ]);
    const config = { inverters: [validInv, solis44()] };
    const result = electricallyNormalizeInverterConfig(config, DESIGN_LOW);
    expect(result.rebuiltCount).toBe(1);
    const invs = result.config.inverters as InverterConfig[];
    expect(invs[0]).toBe(validInv);
    expect(total(invs.slice(1))).toBe(44);
    for (const r of invs.slice(1)) expect(isElectricallyInvalid(r)).toBe(false);
  });

  it('log entries capture the before/after string layout', () => {
    const result = electricallyNormalizeInverterConfig(wrapConfig(solis44()), DESIGN_LOW);
    expect(result.log).toHaveLength(1);
    const entry = result.log[0];
    expect(entry.reason).toBe('rebuilt_invalid_1xN');
    expect(entry.incomingStringLayout).toEqual([44]);
    expect(entry.outgoingStringLayout.length).toBeGreaterThan(1);
    expect(entry.outgoingStringLayout.reduce((a, b) => a + b, 0)).toBe(44);
    const maxPPS = getMaxPanelsPerString('solis-s6-eh1p-5k-us');
    for (const count of entry.outgoingStringLayout) expect(count).toBeLessThanOrEqual(maxPPS);
  });

  it('resulting inverters all pass validateInverterMetadata after normalization', () => {
    const result = electricallyNormalizeInverterConfig(wrapConfig(solis44()), DESIGN_LOW);
    for (const r of result.config.inverters as InverterConfig[]) {
      expect(validateInverterMetadata(r)).toHaveLength(0);
    }
  });
});
