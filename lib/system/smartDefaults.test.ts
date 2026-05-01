// ═══════════════════════════════════════════════════════════════════════
// Smart Defaults — Phase 13 test suite
// lib/system/smartDefaults.test.ts
//
// Validates the initialization layer invariants:
//   1. Fresh project → defaults applied, system is functional
//   2. User-edited config → defaults DO NOT override
//   3. Cleared system → defaults re-trigger (via clearDefaultsAppliedFlag)
//   4. Brand change mid-flight → NO auto-reset
//   5. Validation integrity — defaults do not mutate inputs
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  isSystemUninitialized,
  getDefaultBrand,
  applySmartDefaultsOnce,
  clearDefaultsAppliedFlag,
  type SmartDefaultsConfigShape,
  type SmartDefaultsInverter,
} from './smartDefaults';
import type { SystemType } from './systemDefinition';

// ─── fixtures ─────────────────────────────────────────────────────────

function makeString(panelCount = 10) {
  return {
    id: 'str-seed',
    panelCount,
    panelId: 'panel-default',
  };
}

function makeInverter(type: string = 'string', strings = [makeString()]): SmartDefaultsInverter {
  return {
    id: 'inv-seed',
    inverterId: '',
    type,
    strings,
  };
}

function makeConfig(overrides: Partial<SmartDefaultsConfigShape> = {}): SmartDefaultsConfigShape {
  return {
    systemType: 'roof',
    inverters: [makeInverter()],
    ...overrides,
  };
}

// ─── isSystemUninitialized ────────────────────────────────────────────

describe('isSystemUninitialized', () => {
  it('returns true for factory-fresh config (1 inverter, 1 string, panelCount=10)', () => {
    expect(isSystemUninitialized(makeConfig())).toBe(true);
  });

  it('returns true when panelCount=0 (placeholder pre-CAD)', () => {
    expect(isSystemUninitialized(makeConfig({
      inverters: [makeInverter('string', [makeString(0)])],
    }))).toBe(true);
  });

  it('returns true when inverters array is empty', () => {
    expect(isSystemUninitialized(makeConfig({ inverters: [] }))).toBe(true);
  });

  it('returns false when defaultsApplied flag is set', () => {
    expect(isSystemUninitialized(makeConfig({ defaultsApplied: true }))).toBe(false);
  });

  it('returns false when there are multiple inverters', () => {
    expect(isSystemUninitialized(makeConfig({
      inverters: [makeInverter(), makeInverter()],
    }))).toBe(false);
  });

  it('returns false when single inverter has multiple strings (user-edited)', () => {
    expect(isSystemUninitialized(makeConfig({
      inverters: [makeInverter('string', [makeString(10), makeString(10)])],
    }))).toBe(false);
  });

  it('returns false when panelCount is an off-default value (e.g., 14)', () => {
    expect(isSystemUninitialized(makeConfig({
      inverters: [makeInverter('string', [makeString(14)])],
    }))).toBe(false);
  });
});

// ─── getDefaultBrand ──────────────────────────────────────────────────

describe('getDefaultBrand', () => {
  it('returns enphase for roof (recommended)', () => {
    expect(getDefaultBrand('roof')).toBe('enphase');
  });

  it('returns ecoflow for fence (recommended)', () => {
    expect(getDefaultBrand('fence')).toBe('ecoflow');
  });

  it('returns a supported brand for ground (no explicit recommendation)', () => {
    const id = getDefaultBrand('ground');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // Whatever brand is returned must support the ground systemType
    // (this is enforced by the function's selection rules).
  });
});

// ─── Scenario 1: New Project — defaults applied ───────────────────────

describe('applySmartDefaultsOnce — Scenario 1: new project', () => {
  it('applies defaults on a factory-fresh config with CAD-provided panel count', () => {
    const config = makeConfig(); // fresh
    const result = applySmartDefaultsOnce({
      config,
      systemPanelCount: 24,
      panelWattage: 400,
    });

    expect(result.applied).toBe(true);
    expect(result.patch.defaultsApplied).toBe(true);
    expect(result.sizingResult).not.toBeNull();
    expect(result.seedBrand).toBeTruthy();
    expect(result.patch.inverters).toBeDefined();
    expect(result.patch.inverters!.length).toBeGreaterThan(0);
    // The hydrated inverters must carry a real inverterId from the sizing engine.
    expect(result.patch.inverters![0].inverterId).toBeTruthy();
  });

  it('seeds selectedBrand when the user has not chosen one', () => {
    const config = makeConfig();
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 20 });
    expect(result.applied).toBe(true);
    expect(result.patch.selectedBrand).toBeTruthy();
  });

  it('respects a pre-existing selectedBrand (never overwrites)', () => {
    const config = makeConfig({ selectedBrand: 'fronius' });
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 20 });
    expect(result.applied).toBe(true);
    // User's brand must be kept — patch.selectedBrand should be undefined
    // (meaning no overwrite) OR equal to the user's choice.
    expect(result.patch.selectedBrand).toBeUndefined();
    expect(result.seedBrand).toBe('fronius');
  });

  it('is a no-op when systemPanelCount is 0 (waiting for CAD)', () => {
    const config = makeConfig();
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 0 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
    expect(result.sizingResult).toBeNull();
  });
});

// ─── Scenario 2: User edits — defaults DO NOT override ────────────────

describe('applySmartDefaultsOnce — Scenario 2: user edits', () => {
  it('does NOT fire when defaultsApplied is already true', () => {
    // User has a valid system already; defaults ran earlier.
    const config = makeConfig({
      defaultsApplied: true,
      inverters: [makeInverter('string', [makeString(14)])],
    });
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 14 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
    expect(result.reason).toMatch(/already applied/i);
  });

  it('does NOT fire when user has edited inverters (multiple inverters)', () => {
    const config = makeConfig({
      inverters: [makeInverter(), makeInverter()], // user added a 2nd inverter
    });
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 24 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
    expect(result.reason).toMatch(/not uninitialized/i);
  });

  it('does NOT fire when user customized panelCount off-default', () => {
    const config = makeConfig({
      inverters: [makeInverter('string', [makeString(17)])], // 17 ≠ 0 or 10
    });
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 17 });
    expect(result.applied).toBe(false);
  });
});

// ─── Scenario 3: User clears system — defaults re-trigger ─────────────

describe('applySmartDefaultsOnce — Scenario 3: reset flow', () => {
  it('clearDefaultsAppliedFlag() produces a patch that unblocks re-application', () => {
    const resetPatch = clearDefaultsAppliedFlag();
    expect(resetPatch.defaultsApplied).toBe(false);
  });

  it('re-fires defaults after a reset when config returns to factory shape', () => {
    // Step A: first run.
    const initialConfig = makeConfig();
    const first = applySmartDefaultsOnce({ config: initialConfig, systemPanelCount: 24 });
    expect(first.applied).toBe(true);

    // Step B: user resets the system.
    //    Simulate "Reset System": wipe inverters back to placeholder and
    //    merge in clearDefaultsAppliedFlag().
    const afterReset: SmartDefaultsConfigShape = {
      ...initialConfig,
      inverters: [makeInverter()], // factory placeholder again
      ...clearDefaultsAppliedFlag(),
    };

    // Step C: defaults should fire again.
    const second = applySmartDefaultsOnce({ config: afterReset, systemPanelCount: 24 });
    expect(second.applied).toBe(true);
    expect(second.patch.defaultsApplied).toBe(true);
  });
});

// ─── Scenario 4: Brand change mid-flight — NO auto-reset ──────────────

describe('applySmartDefaultsOnce — Scenario 4: brand change', () => {
  it('does NOT re-fire defaults when a user switches brands on an already-initialized system', () => {
    // System has been initialized and the user has since picked a new brand.
    const config = makeConfig({
      defaultsApplied: true,
      selectedBrand: 'fronius', // user changed brand after defaults
      inverters: [makeInverter('string', [makeString(18)])], // user sized 18 panels
    });
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 18 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
  });
});

// ─── Scenario 5: Input integrity — no mutation of config ──────────────

describe('applySmartDefaultsOnce — Scenario 5: input integrity', () => {
  it('does not mutate the input config object', () => {
    const originalInverters = [makeInverter()];
    const config: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: originalInverters,
    };
    const snapshot = JSON.stringify(config);

    applySmartDefaultsOnce({ config, systemPanelCount: 20 });

    // Input must be bit-for-bit unchanged.
    expect(JSON.stringify(config)).toBe(snapshot);
    expect(config.defaultsApplied).toBeUndefined();
    expect(config.inverters).toBe(originalInverters);
  });

  it('returns a patch that is safe to spread onto config', () => {
    const config = makeConfig();
    const { patch, applied } = applySmartDefaultsOnce({ config, systemPanelCount: 20 });
    expect(applied).toBe(true);

    // Simulate a caller merging the patch.
    const merged: SmartDefaultsConfigShape = { ...config, ...patch };
    expect(merged.defaultsApplied).toBe(true);
    expect(merged.inverters.length).toBeGreaterThan(0);
    // Original config still untouched.
    expect(config.defaultsApplied).toBeUndefined();
  });
});

// ─── Topology-specific hydration checks ───────────────────────────────

describe('applySmartDefaultsOnce — topology-specific hydration', () => {
  it('roof + enphase (micro): emits a single UI card whose panelCount === panel total', () => {
    const config: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter()],
    };
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 36 });
    expect(result.applied).toBe(true);
    if (result.sizingResult!.topology === 'micro') {
      // Micro → exactly 1 UI card holding all panels as a single string.
      expect(result.patch.inverters!.length).toBe(1);
      expect(result.patch.inverters![0].type).toBe('micro');
      expect(result.patch.inverters![0].strings.length).toBe(1);
      expect(result.patch.inverters![0].strings[0].panelCount).toBe(36);
    }
  });

  it('fence + ecoflow (hybrid): emits inverter cards with ecoflow type', () => {
    const config: SmartDefaultsConfigShape = {
      systemType: 'fence' as SystemType,
      inverters: [makeInverter()],
    };
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 12 });
    expect(result.applied).toBe(true);
    expect(result.patch.inverters!.length).toBeGreaterThan(0);
    // Whatever the ecoflow topology produces, each UI card must carry a
    // non-empty inverterId from the sizing engine.
    for (const inv of result.patch.inverters!) {
      expect(inv.inverterId).toBeTruthy();
    }
  });
});

// ─── Phase 13.1 — USER INTENT LOCK ──────────────────────────────────

describe('applySmartDefaultsOnce — Phase 13.1 USER INTENT LOCK', () => {
  it('refuses to apply when userHasEditedInverters=true (even if config looks fresh)', () => {
    // This is the "belt-and-suspenders" invariant: even if the config
    // structurally matches "uninitialized" (1 inverter, 1 string, 10 panels)
    // and defaultsApplied is NOT set, the user-edit lock alone must
    // block defaults from firing.
    const config: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter()],
      userHasEditedInverters: true,
    };
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 24 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
    expect(result.reason).toMatch(/user intent lock|edited/i);
  });

  it('still refuses when both defaultsApplied=true AND userHasEditedInverters=true', () => {
    const config: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter()],
      defaultsApplied: true,
      userHasEditedInverters: true,
    };
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 24 });
    expect(result.applied).toBe(false);
    expect(result.patch).toEqual({});
  });

  it('fires when the lock is explicitly false (and config is fresh)', () => {
    const config: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter()],
      userHasEditedInverters: false,
    };
    const result = applySmartDefaultsOnce({ config, systemPanelCount: 24 });
    expect(result.applied).toBe(true);
    expect(result.patch.defaultsApplied).toBe(true);
  });
});

describe('clearDefaultsAppliedFlag — Phase 13.1', () => {
  it('clears both defaultsApplied and userHasEditedInverters', () => {
    const patch = clearDefaultsAppliedFlag();
    expect(patch.defaultsApplied).toBe(false);
    expect(patch.userHasEditedInverters).toBe(false);
  });

  it('full reset round-trip: locked/edited → reset → defaults re-fire', () => {
    // Step 1: user has an edited + applied system.
    const locked: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter('string', [makeString(17)])], // user-edited layout
      defaultsApplied: true,
      userHasEditedInverters: true,
    };

    // Sanity: defaults must NOT fire in this state.
    const blocked = applySmartDefaultsOnce({ config: locked, systemPanelCount: 17 });
    expect(blocked.applied).toBe(false);

    // Step 2: user resets the system (simulates "Reset System" click).
    const afterReset: SmartDefaultsConfigShape = {
      systemType: 'roof',
      inverters: [makeInverter()], // factory placeholder again
      ...clearDefaultsAppliedFlag(),
    };
    expect(afterReset.defaultsApplied).toBe(false);
    expect(afterReset.userHasEditedInverters).toBe(false);

    // Step 3: defaults should now be allowed to re-fire.
    const rearmed = applySmartDefaultsOnce({ config: afterReset, systemPanelCount: 24 });
    expect(rearmed.applied).toBe(true);
    expect(rearmed.patch.defaultsApplied).toBe(true);
  });
});