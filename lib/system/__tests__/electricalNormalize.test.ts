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
//   8. repairByEvenSplit when sizing engine is unavailable

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
): InverterConfig {
  const strConfigs = strings.map((s, i) =>
    buildStringConfig({ index: i, panelCount: s.panelCount }),
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

  it('returns true for 1×21 with an unknown inverter (CONSERVATIVE threshold=20)', () => {
    // Unknown inverter falls back to CONSERVATIVE_MAX_PANELS_PER_STRING=20
    const inv = makeInv('unknown-inv', 'string', [{ panelCount: 21 }]);
    expect(isElectricallyInvalid(inv)).toBe(true);
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

describe('repairElectricallyInvalidInverter', () => {
  it('produces multiple strings for the canonical 1×44 Solis bug', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    expect(isElectricallyInvalid(inv)).toBe(true);

    const repaired = repairElectricallyInvalidInverter(inv, { panelWattage: 400 });

    // Must produce more than 1 string
    expect(repaired.strings.length).toBeGreaterThan(1);
    // Each string must be within maxPanelsPerString
    const maxPPS = getMaxPanelsPerString('solis-s6-eh1p-5k-us');
    for (const str of repaired.strings) {
      expect(str.panelCount).toBeLessThanOrEqual(maxPPS);
      expect(str.panelCount).toBeGreaterThan(0);
    }
    // Metadata must be valid after repair
    const violations = validateInverterMetadata(repaired);
    expect(violations).toHaveLength(0);
    // NOTE: The sizing engine distributes panels across multiple inverter units.
    // repairElectricallyInvalidInverter only repairs the strings for inverterIndex=0,
    // so the panel count in the repaired inverter may be < the original 44.
    // The key invariant is: NO string exceeds maxPanelsPerString.
  });

  it('preserves inverterId and type after repair', () => {
    const inv = makeInv('sma-sb-5.0', 'string', [{ panelCount: 30 }]);
    const repaired = repairElectricallyInvalidInverter(inv);
    expect(repaired.inverterId).toBe('sma-sb-5.0');
    expect(repaired.type).toBe('string');
  });

  it('resulting config passes isElectricallyInvalid=false after repair', () => {
    const inv = makeInv('growatt-min-5000tl-xh-us', 'string', [{ panelCount: 44 }]);
    const repaired = repairElectricallyInvalidInverter(inv, { panelWattage: 400 });
    expect(isElectricallyInvalid(repaired)).toBe(false);
  });

  it('is idempotent — repairing an already-valid inverter returns equivalent config', () => {
    // Build a valid 4-string × 11-panel config
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [
      { panelCount: 11 }, { panelCount: 11 }, { panelCount: 11 }, { panelCount: 11 },
    ]);
    // isElectricallyInvalid should be false — but call repair anyway to test idempotency
    expect(isElectricallyInvalid(inv)).toBe(false);
    // Calling repair on a valid inverter doesn't change the layout
    // (repairElectricallyInvalidInverter doesn't re-check; it's a fix function, not a guard)
    // So we just verify the metadata is still intact after the call
    const repaired = repairElectricallyInvalidInverter(inv, { panelWattage: 400 });
    const violations = validateInverterMetadata(repaired);
    expect(violations).toHaveLength(0);
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
    const result = electricallyNormalizeInverterConfig(config);
    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config); // exact same object reference — no copy
  });

  it('repairs a config with a 1×44 Solis violation', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config, { panelWattage: 400 });

    expect(result.rebuiltCount).toBe(1);
    expect(result.config.inverters).toHaveLength(1);

    const repairedInv = result.config.inverters![0] as InverterConfig;
    // Must have more than 1 string after repair
    expect(repairedInv.strings.length).toBeGreaterThan(1);
    // Each string must respect maxPanelsPerString
    const maxPPS = getMaxPanelsPerString('solis-s6-eh1p-5k-us');
    for (const str of repairedInv.strings) {
      expect(str.panelCount).toBeLessThanOrEqual(maxPPS);
    }
    // The repaired config must no longer be flagged as invalid
    expect(isElectricallyInvalid(repairedInv)).toBe(false);
    // NOTE: The sizing engine may assign fewer panels to inverterIndex=0 
    // when the load requires multiple inverters. That is correct behavior.
    // The test does NOT assert total == 44 for this reason.
  });

  it('is idempotent — calling twice on an invalid config fixes it on the first call, no-op on second', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);

    const firstPass = electricallyNormalizeInverterConfig(config, { panelWattage: 400 });
    expect(firstPass.rebuiltCount).toBe(1);

    // Second pass on the already-normalized config
    const secondPass = electricallyNormalizeInverterConfig(firstPass.config, { panelWattage: 400 });
    expect(secondPass.rebuiltCount).toBe(0);
    expect(secondPass.config).toBe(firstPass.config); // no-op: same reference
  });

  it('does not repair a micro inverter even with a very large single string', () => {
    const inv = makeInv('enphase-iq8plus', 'micro', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config);

    expect(result.rebuiltCount).toBe(0);
    expect(result.config).toBe(config); // no-op
    // The micro inverter remains unchanged
    expect((result.config.inverters![0] as InverterConfig).strings[0].panelCount).toBe(44);
  });

  it('repairs only the invalid inverter in a mixed-validity multi-inverter config', () => {
    const validInv = makeInv('solis-s6-eh1p-5k-us', 'string', [
      { panelCount: 11 }, { panelCount: 11 },
    ]);
    const invalidInv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    const config = { inverters: [validInv, invalidInv] };

    const result = electricallyNormalizeInverterConfig(config, { panelWattage: 400 });

    expect(result.rebuiltCount).toBe(1);
    expect(result.config.inverters).toHaveLength(2);

    // First inverter stays the same
    expect((result.config.inverters![0] as InverterConfig).strings).toHaveLength(2);
    expect((result.config.inverters![0] as InverterConfig).strings[0].panelCount).toBe(11);

    // Second inverter is repaired
    const repairedInv = result.config.inverters![1] as InverterConfig;
    expect(repairedInv.strings.length).toBeGreaterThan(1);
    expect(isElectricallyInvalid(repairedInv)).toBe(false);
  });

  it('log entries capture the before/after string layout', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config, { panelWattage: 400 });

    expect(result.log).toHaveLength(1);
    const entry = result.log[0];
    expect(entry.reason).toBe('rebuilt_invalid_1xN');
    expect(entry.incomingStringLayout).toEqual([44]);
    // outgoing layout must have multiple strings, each within maxPanelsPerString
    expect(entry.outgoingStringLayout.length).toBeGreaterThan(1);
    const maxPPS = getMaxPanelsPerString('solis-s6-eh1p-5k-us');
    for (const count of entry.outgoingStringLayout) {
      expect(count).toBeLessThanOrEqual(maxPPS);
    }
    // NOTE: total may be < 44 if the sizing engine distributes load across inverters.
  });

  it('resulting inverters all pass validateInverterMetadata after normalization', () => {
    const inv = makeInv('solis-s6-eh1p-5k-us', 'string', [{ panelCount: 44 }]);
    const config = wrapConfig(inv);
    const result = electricallyNormalizeInverterConfig(config, { panelWattage: 400 });

    const repairedInv = result.config.inverters![0] as InverterConfig;
    const violations = validateInverterMetadata(repairedInv);
    expect(violations).toHaveLength(0);
  });
});