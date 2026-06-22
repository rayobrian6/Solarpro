// ═══════════════════════════════════════════════════════════════════════
// Brand Compatibility Matrix — Tests
// lib/system/brandCompatibility.test.ts
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  evaluateCompatibility,
  listCompatibleBatteryBrands,
  listCompatibleInverterBrands,
  getRequiredBosCategories,
  findMissingBosCategories,
} from './brandCompatibility';

describe('evaluateCompatibility — happy paths', () => {
  it('EcoFlow + EcoFlow battery (hybrid, fence) → ok', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'ecoflow',
      batteryBrandId: 'ecoflow',
      batteryEnabled: true,
      systemType: 'fence',
      topology: 'hybrid',
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('Enphase + Enphase battery (micro, roof) → ok', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'enphase',
      batteryBrandId: 'enphase',
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'micro',
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('Fronius + no battery (string, roof) → ok', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'fronius',
      batteryEnabled: false,
      systemType: 'roof',
      topology: 'string',
    });
    expect(r.ok).toBe(true);
  });

  it('SolarEdge + no battery (optimizer, ground) → ok', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'solaredge',
      batteryEnabled: false,
      systemType: 'ground',
      topology: 'optimizer',
    });
    expect(r.ok).toBe(true);
  });
});

describe('evaluateCompatibility — HARD incompatibilities (errors)', () => {
  it('EcoFlow + Enphase battery → INCOMPATIBLE_CROSS_BRAND error', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'ecoflow',
      batteryBrandId: 'enphase',
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'hybrid',
    });
    expect(r.ok).toBe(false);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('INCOMPATIBLE_CROSS_BRAND');
    // A corrective suggestion should be offered.
    expect(r.suggestion).toBeDefined();
  });

  it('Enphase + EcoFlow battery → INCOMPATIBLE_CROSS_BRAND error', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'enphase',
      batteryBrandId: 'ecoflow',
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'micro',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('INCOMPATIBLE_CROSS_BRAND');
  });

  it('Fronius + micro topology → TOPOLOGY_DRIFT_FROM_BRAND + INCOMPATIBLE_TOPOLOGY_COMBO', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'fronius',
      batteryEnabled: false,
      systemType: 'roof',
      topology: 'micro',
    });
    expect(r.ok).toBe(false);
    const codes = r.issues.map(i => i.code);
    // Both rules fire because Fronius is a string brand AND its profile
    // explicitly excludes the 'micro' topology.
    expect(codes).toContain('TOPOLOGY_DRIFT_FROM_BRAND');
    expect(codes).toContain('INCOMPATIBLE_TOPOLOGY_COMBO');
  });

  it('Fronius + battery enabled → BATTERY_ON_NONCAPABLE_BRAND error', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'fronius',
      batteryBrandId: 'ecoflow',
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'string',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('BATTERY_ON_NONCAPABLE_BRAND');
  });

  it('SolarEdge + hybrid topology → INCOMPATIBLE_TOPOLOGY_COMBO', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'solaredge',
      systemType: 'roof',
      topology: 'hybrid',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('INCOMPATIBLE_TOPOLOGY_COMBO');
  });

  it('unknown inverter brand → UNKNOWN_INVERTER_BRAND error', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'nonexistent-brand-xyz',
      batteryEnabled: false,
      systemType: 'roof',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map(i => i.code)).toContain('UNKNOWN_INVERTER_BRAND');
  });
});

describe('evaluateCompatibility — soft mismatches (warnings)', () => {
  it('brand does not support systemType → INCOMPATIBLE_SYSTEM_BRAND warning', () => {
    // Fronius supports only roof and ground, not fence.
    const r = evaluateCompatibility({
      inverterBrandId: 'fronius',
      batteryEnabled: false,
      systemType: 'fence',
      topology: 'string',
    });
    expect(r.ok).toBe(true); // warnings don't block
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('INCOMPATIBLE_SYSTEM_BRAND');
    // And the warning should carry the supported list in context.
    const issue = r.issues.find(i => i.code === 'INCOMPATIBLE_SYSTEM_BRAND');
    expect(issue?.context).toHaveProperty('supportedSystemTypes');
  });

  it('Enphase inverter with unrecommended battery brand → INCOMPATIBLE_INVERTER_BATTERY warning', () => {
    // Enphase's recommendedBatteryBrands = ['enphase']. Using a generic
    // third-party battery produces a soft warning (not a hard reject).
    // Use an unknown brand id so we avoid any cross-brand hard exclusion
    // rules firing for registered brands.
    const r = evaluateCompatibility({
      inverterBrandId: 'enphase',
      batteryBrandId: 'byd',       // not registered, not explicitly excluded
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'micro',
    });
    // We expect ONLY warnings (no errors blocking ok=true).
    expect(r.ok).toBe(true);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('INCOMPATIBLE_INVERTER_BATTERY');
  });
});

describe('evaluateCompatibility — corrective suggestions', () => {
  it('provides an inverter + topology suggestion for incompatible combos', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'ecoflow',
      batteryBrandId: 'enphase',
      batteryEnabled: true,
      systemType: 'fence',
      topology: 'hybrid',
    });
    expect(r.suggestion).toBeDefined();
    expect(r.suggestion?.inverterBrandId).toBeTruthy();
    expect(r.suggestion?.topology).toBeTruthy();
    expect(r.suggestion?.rationale).toMatch(/recommended|supports/i);
  });

  it('does NOT produce a suggestion when configuration is clean', () => {
    const r = evaluateCompatibility({
      inverterBrandId: 'enphase',
      batteryBrandId: 'enphase',
      batteryEnabled: true,
      systemType: 'roof',
      topology: 'micro',
    });
    expect(r.ok).toBe(true);
    expect(r.suggestion).toBeUndefined();
  });

  it('suggestion battery brand follows the recommended inverter', () => {
    // Fence system → recommended brand is now ENPHASE (SolFence is "just solar" +
    // battery-agnostic; IQ8 micro per the datasheet). An incompatible EcoFlow battery
    // on an Enphase fence resolves to Enphase + Enphase battery.
    const r = evaluateCompatibility({
      inverterBrandId: 'enphase', // micro — matches the SolFence recommendation
      batteryBrandId: 'ecoflow',  // HARD INCOMPATIBLE with Enphase
      batteryEnabled: true,
      systemType: 'fence',
      topology: 'micro',
    });
    expect(r.ok).toBe(false);
    expect(r.suggestion?.inverterBrandId).toBe('enphase');
    expect(r.suggestion?.batteryBrandId).toBe('enphase');
  });
});

describe('listCompatibleBatteryBrands', () => {
  it('returns EcoFlow recommended for EcoFlow inverter', () => {
    const list = listCompatibleBatteryBrands('ecoflow');
    expect(list).toContain('ecoflow');
  });

  it('returns Enphase recommended for Enphase inverter', () => {
    const list = listCompatibleBatteryBrands('enphase');
    expect(list).toContain('enphase');
  });

  it('returns empty for Fronius (non-battery-capable)', () => {
    expect(listCompatibleBatteryBrands('fronius')).toHaveLength(0);
  });

  it('returns empty for unknown brand', () => {
    expect(listCompatibleBatteryBrands('nonexistent')).toHaveLength(0);
    expect(listCompatibleBatteryBrands(null)).toHaveLength(0);
  });
});

describe('listCompatibleInverterBrands', () => {
  it('fence systems: EcoFlow + Enphase supported', () => {
    const list = listCompatibleInverterBrands('fence');
    const ids = list.map(p => p.id);
    expect(ids).toContain('ecoflow');
    expect(ids).toContain('enphase');
  });

  it('roof + micro topology narrows to Enphase only', () => {
    const list = listCompatibleInverterBrands('roof', 'micro');
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) expect(p.topology).toBe('micro');
  });

  it('ground + hybrid topology returns EcoFlow', () => {
    const list = listCompatibleInverterBrands('ground', 'hybrid');
    expect(list.map(p => p.id)).toContain('ecoflow');
  });
});

describe('BOS category matrix', () => {
  it('micro topology requires microinverter + trunk_cable + terminator + monitoring_gateway', () => {
    const cats = getRequiredBosCategories('micro');
    expect(cats).toContain('microinverter');
    expect(cats).toContain('trunk_cable');
    expect(cats).toContain('terminator');
    expect(cats).toContain('monitoring_gateway');
  });

  it('string topology requires dc_disconnect + ac_disconnect + rapid_shutdown', () => {
    const cats = getRequiredBosCategories('string');
    expect(cats).toContain('dc_disconnect');
    expect(cats).toContain('ac_disconnect');
    expect(cats).toContain('rapid_shutdown');
  });

  it('optimizer topology requires optimizer category', () => {
    const cats = getRequiredBosCategories('optimizer');
    expect(cats).toContain('optimizer');
  });

  it('hybrid topology requires smart_meter + monitoring_gateway', () => {
    const cats = getRequiredBosCategories('hybrid');
    expect(cats).toContain('smart_meter');
    expect(cats).toContain('monitoring_gateway');
  });

  it('findMissingBosCategories flags optimizer missing from optimizer BOM', () => {
    const missing = findMissingBosCategories('optimizer', ['dc_disconnect', 'ac_disconnect']);
    expect(missing).toContain('optimizer');
  });

  it('findMissingBosCategories returns empty when BOM is complete', () => {
    const missing = findMissingBosCategories('string', [
      'dc_disconnect', 'ac_disconnect', 'rapid_shutdown',
    ]);
    expect(missing).toHaveLength(0);
  });

  it('findMissingBosCategories flags all missing for an empty BOM', () => {
    const missing = findMissingBosCategories('micro', []);
    expect(missing).toEqual(
      expect.arrayContaining(['microinverter', 'trunk_cable', 'terminator', 'monitoring_gateway']),
    );
  });
});

describe('evaluateCompatibility — edge cases', () => {
  it('empty input → ok, no issues', () => {
    const r = evaluateCompatibility({});
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('only systemType provided → no rules fire', () => {
    const r = evaluateCompatibility({ systemType: 'roof' });
    expect(r.ok).toBe(true);
  });

  it('errors sort before warnings', () => {
    // Construct a combo that generates both: Fronius + fence (warning for
    // systemType) + micro topology (error for drift).
    const r = evaluateCompatibility({
      inverterBrandId: 'fronius',
      systemType: 'fence', // not supported → warning
      topology: 'micro',   // drift + exclusion → errors
    });
    expect(r.ok).toBe(false);
    // All errors must come before any warning.
    let sawWarning = false;
    for (const i of r.issues) {
      if (i.severity === 'warning') sawWarning = true;
      if (i.severity === 'error' && sawWarning) {
        throw new Error('Error found after warning — sort broken');
      }
    }
  });
});