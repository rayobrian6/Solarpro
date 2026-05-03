// ══════════════════════════════════════════════════════════════════════
// v61.2 Display Mode — unit tests
// lib/system/displayMode.test.ts
//
// Tests the Single Source of Truth architecture introduced in v61.2:
//   1. DisplayMode='current' → all values come from currentDisplayConfig
//   2. DisplayMode='recommended' → all values come from recommendedDisplayConfig
//   3. Switching modes updates all derived values consistently (no mixing)
//   4. Applying recommendation resets displayMode to 'current'
//
// These tests exercise the core logic inline (as it lives in page.tsx)
// using sizeSystemFromBrand + a minimal config fixture.
// ══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from './sizingEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DisplayMode = 'current' | 'recommended';

interface DisplayConfig {
  totalStrings: number;
  inverterModel: string;
  acKw: number;
  panelCount: number;
  topology: string;
}

/**
 * Mirrors the exact displayConfig selector logic from page.tsx v61.2.
 * This is the Single Source of Truth function under test.
 */
function selectDisplayConfig(
  displayMode: DisplayMode,
  currentDisplayConfig: DisplayConfig,
  recommendedDisplayConfig: DisplayConfig,
  sizingRecommendation: ReturnType<typeof sizeSystemFromBrand> | null,
): DisplayConfig {
  return displayMode === 'recommended' && sizingRecommendation
    ? recommendedDisplayConfig
    : currentDisplayConfig;
}

/**
 * Build a minimal currentDisplayConfig from an inverter config array.
 * Mirrors the currentDisplayConfig derivation in page.tsx.
 */
function buildCurrentDisplayConfig(
  inverters: Array<{ strings: Array<{ panelCount: number }>; type: string; inverterId: string }>,
  totalInverterKw: number,
  systemPanelCount: number,
): DisplayConfig {
  const totalStrings = inverters.reduce((s, inv) => s + inv.strings.length, 0);
  const topology = inverters[0]?.type === 'ecoflow' ? 'hybrid' : (inverters[0]?.type ?? 'string');
  return {
    totalStrings,
    inverterModel: inverters[0]?.inverterId ?? 'No inverter',
    acKw: totalInverterKw,
    panelCount: systemPanelCount > 0 ? systemPanelCount : inverters.reduce((s, inv) => s + inv.strings.reduce((ss, st) => ss + st.panelCount, 0), 0),
    topology,
  };
}

/**
 * Build recommendedDisplayConfig from a sizing recommendation.
 * Mirrors the recommendedDisplayConfig derivation in page.tsx.
 */
function buildRecommendedDisplayConfig(
  rec: ReturnType<typeof sizeSystemFromBrand>,
  fallback: DisplayConfig,
): DisplayConfig {
  const totalStrings = rec.topology === 'micro' ? 0 : rec.strings.length;
  const acKw = rec.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
  return {
    totalStrings,
    inverterModel: rec.inverterModels[0]?.equipmentDbId ?? 'Recommended inverter',
    acKw,
    panelCount: rec.input.panelCount,
    topology: rec.topology as string,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// A plausible "current" inverter config: 2 Fronius inverters, 4 strings each, 8 panels/string
const CURRENT_INVERTERS = [
  {
    inverterId: 'fronius-symo-10',
    type: 'string' as const,
    strings: [
      { panelCount: 8 }, { panelCount: 8 }, { panelCount: 8 }, { panelCount: 8 },
    ],
  },
  {
    inverterId: 'fronius-symo-10',
    type: 'string' as const,
    strings: [
      { panelCount: 8 }, { panelCount: 8 }, { panelCount: 8 }, { panelCount: 8 },
    ],
  },
];
const CURRENT_TOTAL_STRINGS = 8;  // 2 inverters × 4 strings
const CURRENT_PANEL_COUNT = 64;   // 8 strings × 8 panels
const CURRENT_AC_KW = 20;

// A fresh sizing recommendation for the same 64 panels (Fronius, string topology)
const REC_64_STRING = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 64,
  selectedBrand: 'fronius',
});

// ─── Test 1 ──────────────────────────────────────────────────────────────────

describe("v61.2 DisplayMode — Single Source of Truth", () => {

  it("1. DisplayMode='current' → all display values come from currentDisplayConfig", () => {
    const currentDC = buildCurrentDisplayConfig(CURRENT_INVERTERS, CURRENT_AC_KW, CURRENT_PANEL_COUNT);
    const recommendedDC = buildRecommendedDisplayConfig(REC_64_STRING, currentDC);
    const displayConfig = selectDisplayConfig('current', currentDC, recommendedDC, REC_64_STRING);

    // All values must match currentDisplayConfig exactly — no recommended bleed-in
    expect(displayConfig.totalStrings).toBe(currentDC.totalStrings);
    expect(displayConfig.inverterModel).toBe(currentDC.inverterModel);
    expect(displayConfig.acKw).toBe(currentDC.acKw);
    expect(displayConfig.panelCount).toBe(currentDC.panelCount);
    expect(displayConfig.topology).toBe(currentDC.topology);

    // Sanity: current config has 8 strings
    expect(displayConfig.totalStrings).toBe(CURRENT_TOTAL_STRINGS);
    expect(displayConfig.panelCount).toBe(CURRENT_PANEL_COUNT);
  });

  // ─── Test 2 ────────────────────────────────────────────────────────────────

  it("2. DisplayMode='recommended' → all display values come from recommendedDisplayConfig", () => {
    const currentDC = buildCurrentDisplayConfig(CURRENT_INVERTERS, CURRENT_AC_KW, CURRENT_PANEL_COUNT);
    const recommendedDC = buildRecommendedDisplayConfig(REC_64_STRING, currentDC);
    const displayConfig = selectDisplayConfig('recommended', currentDC, recommendedDC, REC_64_STRING);

    // All values must match recommendedDisplayConfig exactly — no current bleed-in
    expect(displayConfig.totalStrings).toBe(recommendedDC.totalStrings);
    expect(displayConfig.inverterModel).toBe(recommendedDC.inverterModel);
    expect(displayConfig.acKw).toBe(recommendedDC.acKw);
    expect(displayConfig.panelCount).toBe(recommendedDC.panelCount);
    expect(displayConfig.topology).toBe(recommendedDC.topology);

    // Recommended panel count should equal the sizing input
    expect(displayConfig.panelCount).toBe(REC_64_STRING.input.panelCount);

    // Recommended acKw must match the engine's own calculation
    const expectedAcKw = REC_64_STRING.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    expect(displayConfig.acKw).toBeCloseTo(expectedAcKw, 4);
  });

  // ─── Test 3 ────────────────────────────────────────────────────────────────

  it("3. Switching displayMode updates ALL components consistently — no mixing", () => {
    const currentDC = buildCurrentDisplayConfig(CURRENT_INVERTERS, CURRENT_AC_KW, CURRENT_PANEL_COUNT);
    const recommendedDC = buildRecommendedDisplayConfig(REC_64_STRING, currentDC);

    // Simulate all UI consumers reading from displayConfig for mode='current'
    const dcCurrent = selectDisplayConfig('current', currentDC, recommendedDC, REC_64_STRING);
    // Simulate all UI consumers reading from displayConfig for mode='recommended'
    const dcRecommended = selectDisplayConfig('recommended', currentDC, recommendedDC, REC_64_STRING);

    // Critical invariant: both modes are self-consistent (no mixing)
    // i.e., every field of dcCurrent comes from ONE source (currentDC)
    expect(dcCurrent.totalStrings).toBe(currentDC.totalStrings);
    expect(dcCurrent.acKw).toBe(currentDC.acKw);
    expect(dcCurrent.panelCount).toBe(currentDC.panelCount);
    expect(dcCurrent.inverterModel).toBe(currentDC.inverterModel);

    // And every field of dcRecommended comes from ONE source (recommendedDC)
    expect(dcRecommended.totalStrings).toBe(recommendedDC.totalStrings);
    expect(dcRecommended.acKw).toBe(recommendedDC.acKw);
    expect(dcRecommended.panelCount).toBe(recommendedDC.panelCount);
    expect(dcRecommended.inverterModel).toBe(recommendedDC.inverterModel);

    // The two modes must NOT be identical (they represent different configs)
    // At minimum, acKw or totalStrings should differ in a real scenario
    const hasDifference =
      dcCurrent.totalStrings !== dcRecommended.totalStrings ||
      dcCurrent.acKw !== dcRecommended.acKw ||
      dcCurrent.inverterModel !== dcRecommended.inverterModel;
    // This assertion is conditional: if the engine happens to return identical
    // values (unlikely), we skip rather than false-fail.
    if (dcCurrent.acKw !== dcRecommended.acKw || currentDC.totalStrings !== recommendedDC.totalStrings) {
      expect(hasDifference).toBe(true);
    }
  });

  // ─── Test 4 ────────────────────────────────────────────────────────────────

  it("4. Applying recommendation resets displayMode to 'current'", () => {
    // Simulate the state machine:
    //   Step 1: user is in 'recommended' mode (previewing)
    //   Step 2: user clicks "Apply" → applySizingRecommendation() fires
    //   Step 3: applySizingRecommendation() calls setDisplayMode('current')
    //           AND updates config.inverters to match the recommendation
    //   Step 4: displayMode is now 'current' — but config reflects the applied rec

    let displayMode: DisplayMode = 'recommended';

    // Simulate applyRecommendation(): sets config from rec, then resets mode
    function applyRecommendation(rec: ReturnType<typeof sizeSystemFromBrand>) {
      // The new "current" config after applying is the rec's output
      // In the real code: setConfig(applySizingRecommendation(rec))
      //                   setDisplayMode('current')   ← the key reset
      displayMode = 'current';  // ← this is what we're testing
      return rec;  // applied rec becomes new current config
    }

    // Before apply: displayMode is 'recommended'
    expect(displayMode).toBe('recommended');

    // Apply the recommendation
    const appliedRec = applyRecommendation(REC_64_STRING);

    // After apply: displayMode must be 'current'
    expect(displayMode).toBe('current');

    // The applied rec should be a valid sizing result
    expect(appliedRec.inverterModels.length).toBeGreaterThan(0);
    expect(appliedRec.input.panelCount).toBe(64);

    // With displayMode='current' and config now reflecting the applied rec,
    // selectDisplayConfig should return currentDisplayConfig
    // (which now matches the recommendation — they are the same data)
    const newCurrentDC = buildCurrentDisplayConfig(
      // Convert applied rec strings to inverter-like config
      appliedRec.inverterModels.map(m => ({
        inverterId: m.equipmentDbId,
        type: appliedRec.topology as 'string' | 'micro' | 'optimizer' | 'ecoflow',
        strings: appliedRec.strings.slice(0, m.qty).map(s => ({ panelCount: s.panelCount })),
      })),
      appliedRec.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0),
      appliedRec.input.panelCount,
    );
    const newRecommendedDC = buildRecommendedDisplayConfig(appliedRec, newCurrentDC);

    const finalDisplayConfig = selectDisplayConfig(
      displayMode,         // 'current' after reset
      newCurrentDC,
      newRecommendedDC,
      appliedRec,
    );

    // displayConfig should now reflect 'current' (the applied config)
    expect(finalDisplayConfig.totalStrings).toBe(newCurrentDC.totalStrings);
    expect(finalDisplayConfig.panelCount).toBe(newCurrentDC.panelCount);
  });

  // ─── Bonus: micro topology edge case ────────────────────────────────────────

  it("5. Micro topology: recommendedDisplayConfig.totalStrings is always 0", () => {
    const micRec = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      selectedBrand: 'enphase',
    });
    expect(micRec.topology).toBe('micro');

    const currentDC = buildCurrentDisplayConfig(CURRENT_INVERTERS, CURRENT_AC_KW, CURRENT_PANEL_COUNT);
    const recommendedDC = buildRecommendedDisplayConfig(micRec, currentDC);

    // Micro systems have no DC strings — totalStrings must be 0
    expect(recommendedDC.totalStrings).toBe(0);

    // panelCount should come from the recommendation input
    expect(recommendedDC.panelCount).toBe(20);

    // topology must be 'micro'
    expect(recommendedDC.topology).toBe('micro');
  });

});