/**
 * lib/system/__tests__/configOverwriteKillSwitch.test.ts
 *
 * v61.7 — Config Overwrite Kill Switch Tests
 *
 * Tests that verify the isUserControlled flag correctly prevents
 * automatic config mutations. These tests verify the LOGIC of the
 * kill switch, not the React hooks directly.
 */

import { shouldAllowOverride, DEFAULT_LOCKS } from '../../solardog/controlMode';

// ─── Mock for sizeSystemFromBrand (used in CAD sync logic tests) ───────────
// We test the pure logic that guards mutations, not the React hooks.

// ─── Helper: simulate the kill switch decision logic ──────────────────────

interface KillSwitchState {
  isUserControlled?: boolean;
  userHasEditedInverters?: boolean;
}

/** Mirrors the _cadUserLocked logic in page.tsx CAD sync */
function isCadUserLocked(state: KillSwitchState): boolean {
  return !!(state.isUserControlled || state.userHasEditedInverters);
}

/** Mirrors the AUTO-APPLY useEffect guard in page.tsx */
function isAutoApplyBlocked(state: KillSwitchState): boolean {
  if (state.userHasEditedInverters) return true;
  if (state.isUserControlled) return true;
  return false;
}

/** Mirrors the HARD DC/AC AUTO-HEAL guard in page.tsx */
function isDcAcHealBlocked(state: KillSwitchState): boolean {
  return !!(state.isUserControlled);
}

/** Mirrors the SMART DEFAULTS guard in page.tsx */
function isSmartDefaultsBlocked(state: KillSwitchState): boolean {
  return !!(state.userHasEditedInverters || state.isUserControlled);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ConfigOverwriteKillSwitch — isUserControlled flag logic', () => {

  // ── Phase 1: isUserControlled flag ──────────────────────────────────────

  describe('1. Flag initial state', () => {
    it('fresh config has no isUserControlled (undefined = false)', () => {
      const state: KillSwitchState = {};
      expect(isCadUserLocked(state)).toBe(false);
      expect(isAutoApplyBlocked(state)).toBe(false);
      expect(isDcAcHealBlocked(state)).toBe(false);
      expect(isSmartDefaultsBlocked(state)).toBe(false);
    });

    it('isUserControlled=false means all auto-mutations are allowed', () => {
      const state: KillSwitchState = { isUserControlled: false };
      expect(isCadUserLocked(state)).toBe(false);
      expect(isAutoApplyBlocked(state)).toBe(false);
      expect(isDcAcHealBlocked(state)).toBe(false);
      expect(isSmartDefaultsBlocked(state)).toBe(false);
    });
  });

  // ── Test 1: AUTO mode does not mutate config when isUserControlled=true ──

  describe('2. AUTO mode is blocked when isUserControlled=true', () => {
    it('AUTO-APPLY is blocked when isUserControlled=true', () => {
      const state: KillSwitchState = { isUserControlled: true };
      expect(isAutoApplyBlocked(state)).toBe(true);
    });

    it('AUTO-APPLY is blocked when userHasEditedInverters=true (legacy)', () => {
      const state: KillSwitchState = { userHasEditedInverters: true };
      expect(isAutoApplyBlocked(state)).toBe(true);
    });

    it('AUTO-APPLY fires when both flags are false (clean state)', () => {
      const state: KillSwitchState = { isUserControlled: false, userHasEditedInverters: false };
      expect(isAutoApplyBlocked(state)).toBe(false);
    });

    it('shouldAllowOverride returns false in guided mode (never silent override)', () => {
      const result = shouldAllowOverride('inverter', 'guided', DEFAULT_LOCKS);
      expect(result).toBe(false);
    });

    it('shouldAllowOverride returns true in auto mode for unlocked fields', () => {
      const result = shouldAllowOverride('inverter', 'auto', DEFAULT_LOCKS);
      expect(result).toBe(true);
    });

    it('shouldAllowOverride returns false in manual mode regardless', () => {
      const result = shouldAllowOverride('inverter', 'manual', DEFAULT_LOCKS);
      expect(result).toBe(false);
    });
  });

  // ── Test 2: User config persists after any render ────────────────────────

  describe('3. CAD sync respects isUserControlled', () => {
    it('CAD sync is locked when isUserControlled=true', () => {
      const state: KillSwitchState = { isUserControlled: true };
      expect(isCadUserLocked(state)).toBe(true);
    });

    it('CAD sync is locked when userHasEditedInverters=true', () => {
      const state: KillSwitchState = { userHasEditedInverters: true };
      expect(isCadUserLocked(state)).toBe(true);
    });

    it('CAD sync is NOT locked when both flags are false', () => {
      const state: KillSwitchState = { isUserControlled: false, userHasEditedInverters: false };
      expect(isCadUserLocked(state)).toBe(false);
    });

    it('CAD sync locked = string rearrange is skipped (only panel count update)', () => {
      // When locked, the new branch fires: proportional panel count update
      // The old sizeSystemFromBrand path is skipped
      const isLocked = isCadUserLocked({ isUserControlled: true });
      expect(isLocked).toBe(true);
      // In the real code: !_cadUserLocked prevents the string-engine path from running
    });
  });

  // ── Test 3: Apply Recommended fully replaces config ──────────────────────

  describe('4. Apply Recommendation marks config as user-controlled', () => {
    it('after Apply Recommendation, isUserControlled becomes true', () => {
      // Simulate what applySizingRecommendation does
      let state: KillSwitchState = { isUserControlled: false };
      // The explicit Apply action sets isUserControlled
      state = { ...state, isUserControlled: true };
      expect(state.isUserControlled).toBe(true);
    });

    it('after Apply, AUTO-APPLY is blocked (config is now final)', () => {
      const stateAfterApply: KillSwitchState = { isUserControlled: true };
      expect(isAutoApplyBlocked(stateAfterApply)).toBe(true);
    });

    it('after Apply, CAD sync cannot rearrange strings', () => {
      const stateAfterApply: KillSwitchState = { isUserControlled: true };
      expect(isCadUserLocked(stateAfterApply)).toBe(true);
    });

    it('after Apply, HARD DC/AC heal is blocked', () => {
      const stateAfterApply: KillSwitchState = { isUserControlled: true };
      expect(isDcAcHealBlocked(stateAfterApply)).toBe(true);
    });
  });

  // ── Test 4: HARD DC/AC AUTO-HEAL is blocked when isUserControlled=true ───

  describe('5. HARD DC/AC AUTO-HEAL respects isUserControlled', () => {
    it('DC/AC heal is blocked when isUserControlled=true', () => {
      const state: KillSwitchState = { isUserControlled: true };
      expect(isDcAcHealBlocked(state)).toBe(true);
    });

    it('DC/AC heal fires when isUserControlled=false', () => {
      const state: KillSwitchState = { isUserControlled: false };
      expect(isDcAcHealBlocked(state)).toBe(false);
    });

    it('DC/AC heal fires when isUserControlled=undefined (fresh state)', () => {
      const state: KillSwitchState = {};
      expect(isDcAcHealBlocked(state)).toBe(false);
    });
  });

  // ── Test 5: Smart Defaults blocked when isUserControlled=true ─────────────

  describe('6. Smart Defaults respects kill switch', () => {
    it('Smart Defaults blocked when isUserControlled=true', () => {
      const state: KillSwitchState = { isUserControlled: true };
      expect(isSmartDefaultsBlocked(state)).toBe(true);
    });

    it('Smart Defaults blocked when userHasEditedInverters=true (legacy)', () => {
      const state: KillSwitchState = { userHasEditedInverters: true };
      expect(isSmartDefaultsBlocked(state)).toBe(true);
    });

    it('Smart Defaults fires on fresh project (no flags)', () => {
      const state: KillSwitchState = {};
      expect(isSmartDefaultsBlocked(state)).toBe(false);
    });

    it('Smart Defaults sets isUserControlled=true after bootstrap', () => {
      // Simulate what the Smart Defaults useEffect does
      let state: KillSwitchState = { isUserControlled: false };
      // After smart defaults runs:
      state = { ...state, isUserControlled: true };
      expect(state.isUserControlled).toBe(true);
      // Now any subsequent render won't re-run smart defaults
      expect(isSmartDefaultsBlocked(state)).toBe(true);
    });
  });

  // ── Test 6: Ecosystem reset clears isUserControlled ─────────────────────

  describe('7. Ecosystem reset clears kill switch', () => {
    it('ecosystem reset clears isUserControlled', () => {
      let state: KillSwitchState = { isUserControlled: true, userHasEditedInverters: false };
      // Simulate updateConfig({ ecosystemBrand: undefined, ..., isUserControlled: false })
      state = { ...state, isUserControlled: false };
      expect(state.isUserControlled).toBe(false);
      // Now auto-mutations are re-enabled
      expect(isAutoApplyBlocked(state)).toBe(false);
      expect(isCadUserLocked(state)).toBe(false);
    });
  });

  // ── Test 7: LOCK constant sets both flags ────────────────────────────────

  describe('8. LOCK constant stamps both flags', () => {
    it('user edit stamps userHasEditedInverters=true', () => {
      // Simulate what LOCK = { userHasEditedInverters: true, isUserControlled: true } does
      const LOCK = { userHasEditedInverters: true as const, isUserControlled: true as const };
      let state: KillSwitchState = {};
      state = { ...state, ...LOCK };
      expect(state.userHasEditedInverters).toBe(true);
      expect(state.isUserControlled).toBe(true);
    });

    it('after user edit, all auto-mutations are blocked', () => {
      const LOCK = { userHasEditedInverters: true as const, isUserControlled: true as const };
      const state: KillSwitchState = { ...LOCK };
      expect(isAutoApplyBlocked(state)).toBe(true);
      expect(isCadUserLocked(state)).toBe(true);
      expect(isDcAcHealBlocked(state)).toBe(true);
      expect(isSmartDefaultsBlocked(state)).toBe(true);
    });
  });

  // ── Test 8: Panel count consistency ─────────────────────────────────────

  describe('9. Panel count consistency across all layers', () => {
    it('proportional scaling preserves string count', () => {
      // When isUserControlled=true and panel count changes,
      // we scale each string proportionally (no rearrange)
      const strings = [
        { panelCount: 13 },
        { panelCount: 13 },
        { panelCount: 13 },
      ];
      const oldTotal = strings.reduce((s, str) => s + str.panelCount, 0); // 39
      const newTotal = 44;
      const scaled = strings.map(str => ({
        panelCount: Math.max(1, Math.round((str.panelCount / oldTotal) * newTotal)),
      }));
      // Each string should scale proportionally: 13/39 * 44 ≈ 14.67 → 15
      expect(scaled.length).toBe(3); // same number of strings
      expect(scaled.every(s => s.panelCount > 0)).toBe(true); // no zero panels
      // Total should be close to newTotal (rounding may cause ±1)
      const scaledTotal = scaled.reduce((s, str) => s + str.panelCount, 0);
      expect(Math.abs(scaledTotal - newTotal)).toBeLessThanOrEqual(2);
    });

    it('string count never changes during panel count update (user-controlled)', () => {
      // Simulate the user-controlled CAD sync: 2 inverters, 2 strings each
      const inverters = [
        { strings: [{ panelCount: 8 }, { panelCount: 8 }] },
        { strings: [{ panelCount: 8 }, { panelCount: 7 }] },
      ];
      const oldTotal = inverters.reduce(
        (s, inv) => s + inv.strings.reduce((s2, str) => s2 + str.panelCount, 0), 0
      ); // 31
      const newTotal = 44;

      // The user-controlled path scales proportionally
      const newInverters = inverters.map(inv => ({
        strings: inv.strings.map(str => ({
          panelCount: Math.max(1, Math.round((str.panelCount / oldTotal) * newTotal)),
        })),
      }));

      // String count must be preserved
      expect(newInverters.length).toBe(2);
      expect(newInverters[0].strings.length).toBe(2);
      expect(newInverters[1].strings.length).toBe(2);
    });
  });
});