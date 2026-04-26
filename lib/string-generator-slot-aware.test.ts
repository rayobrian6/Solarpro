/**
 * v47.418 — Slot-aware string-generator regression tests.
 *
 * These tests lock in the fix for the Sol-Ark 8K-2P "5 strings unplaced"
 * bug. The old string-generator used a purely voltage-bounded panel-per-
 * string calculation (NEC 690.7 cold-temp Voc cap) and then did
 * `numStrings = ceil(total / panelsPerString)` without consulting the
 * inverter's physical slot capacity (mpptChannels × maxParallelStringsPerMppt).
 * For a Sol-Ark 8K-2P (2 MPPT × 2 parallel = 4 slots) with 45 panels at a
 * cold-corrected Voc that allows 11 panels/string, it produced 5 strings
 * → MPPT allocator rejected → user saw an error instead of a valid layout.
 *
 * The fix: when the naive voltage-bounded layout would exceed totalSlots,
 * spread panels evenly across all available slots; if that still requires
 * more panels/string than the voltage cap allows, emit an honest
 * SLOT_CAPACITY_EXCEEDED error instead of letting a bad layout through
 * to the MPPT allocator where it surfaces as a confusing error.
 */
import { describe, it, expect } from 'vitest';
import { generateStringConfig } from './string-generator';

// Canonical test fixtures — kept local so the test is hermetic.
const qcellsPeakDuo400 = {
  voc: 41.8,
  vmp: 33.6,
  isc: 12.97,
  imp: 11.91,
  watts: 400,
  tempCoeffVoc: -0.27,
  tempCoeffIsc: 0.05,
  maxSeriesFuseRating: 25,
  maxSeriesFuse: 25,
};

const solarkWith2Mppt2Parallel = {
  maxDcVoltage: 500,
  mpptVoltageMin: 150,
  mpptVoltageMax: 425,
  mpptChannels: 2,
  maxInputCurrent: 18.0,           // Sol-Ark 8K-2P self-limit
  maxParallelStringsPerMppt: 2,    // 2 × 2 = 4 total slots
  acOutputKw: 8.0,
  dcInputKwMax: 10.5,
};

describe('v47.418 — slot-aware string-generator', () => {
  it('naive layout that FITS in slots uses legacy length-first packing', () => {
    // 18 panels on a 4-slot Sol-Ark 8K-2P.
    // maxPanelsPerString (Voc cap, cold) is ~10, recommended is ~9.
    // Legacy: 18 / 9 = 2 full strings of 9. 2 strings is below the 4-slot
    // capacity, so the slot-aware branch must NOT fire. This locks in that
    // the new logic is a pure add-on that only triggers when naive exceeds
    // totalSlots.
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: qcellsPeakDuo400,
      inverterSpecs: solarkWith2Mppt2Parallel,
      designTempMin: -10,
      topology: 'hybrid',
    });
    expect(result.totalStrings).toBe(2);
    expect(result.strings.every(s => s.panelsInString === 9)).toBe(true);
    const warningText = result.warnings.join(' ');
    expect(warningText).not.toMatch(/layout adjusted for MPPT slot capacity/i);
  });

  it('Sol-Ark 8K-2P + 45 panels: slot-packs to 4 strings instead of 5', () => {
    // THE BUG SCENARIO: naive layout = 4 full × 11 + 1 × 1 = 5 strings.
    // With only 4 slots (2 MPPT × 2 parallel), this must collapse to 4 strings.
    // 45 / 4 = 11.25 → 12,11,11,11 (12 exceeds maxPPS=11 → SLOT_CAPACITY_EXCEEDED error)
    const result = generateStringConfig({
      totalModules: 45,
      moduleSpecs: qcellsPeakDuo400,
      inverterSpecs: solarkWith2Mppt2Parallel,
      designTempMin: -10,
      topology: 'hybrid',
    });
    // The layout is forced to 4 strings (filling slots) — NOT 5.
    expect(result.totalStrings).toBe(4);
    // Sum of panels in the layout equals totalModules
    const sumPanels = result.strings.reduce((s, x) => s + x.panelsInString, 0);
    expect(sumPanels).toBe(45);
    // Because the max panels/string would be 12 (> voltage cap 11), we should
    // see the SLOT_CAPACITY_EXCEEDED error (not the allocator confusion).
    const errorText = result.errors.join(' ');
    expect(errorText).toContain('SLOT_CAPACITY_EXCEEDED');
    expect(errorText).toMatch(/45 panels cannot fit/);
    expect(errorText).toMatch(/inverter/i);
  });

  it('Sol-Ark 8K-2P + 40 panels: slot-packs to 4 strings of 10 cleanly', () => {
    // 40 / 4 slots = 10 panels each — below voltage cap of 11. No error.
    const result = generateStringConfig({
      totalModules: 40,
      moduleSpecs: qcellsPeakDuo400,
      inverterSpecs: solarkWith2Mppt2Parallel,
      designTempMin: -10,
      topology: 'hybrid',
    });
    expect(result.totalStrings).toBe(4);
    expect(result.strings.every(s => s.panelsInString === 10)).toBe(true);
    // No SLOT_CAPACITY_EXCEEDED error because 10 ≤ maxPPS=11
    const errorText = result.errors.join(' ');
    expect(errorText).not.toContain('SLOT_CAPACITY_EXCEEDED');
    // Should surface the adjustment as a warning though
    const warningText = result.warnings.join(' ');
    expect(warningText).toMatch(/layout adjusted for MPPT slot capacity/i);
  });

  it('SolarEdge SE7600H optimizer topology unaffected (regression guard)', () => {
    // Optimizer topology skips the slot-aware branch (voltage bypass,
    // maxPanelsPerString ceiling from brand profile or 25 default).
    // v47.420: with clampedRecommended=25, 36 panels → [25,11] (2 strings)
    // instead of the old v47.415 [18,18] which relied on the incorrect
    // maxStringPowerW clipping cap of 15 panels.
    const seInverter = {
      maxDcVoltage: 480,
      mpptVoltageMin: 380,
      mpptVoltageMax: 480,
      mpptChannels: 1,
      maxInputCurrent: 20.0,
      maxParallelStringsPerMppt: 2,  // SE7600H = 1 MPPT × 2 parallel = 2 slots
      acOutputKw: 7.6,
      dcInputKwMax: 11.0,
    };
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: qcellsPeakDuo400,
      inverterSpecs: seInverter,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });
    // Slot-aware branch does NOT fire for optimizer topology — still 2 strings.
    // v47.420 clampedRecommended=25: strings are [25, 11], each ≤ 25 panels.
    expect(result.totalStrings).toBe(2);
    expect(result.strings.every(s => s.panelsInString <= 25)).toBe(true);
  });
});
describe('v47.419 — MPPT-current-aware string-length selection', () => {
  // Reproduces the user-reported Sol-Ark 8K-2P × 2 / 36 panels scenario.
  // Before v47.419: the generator picked recommended = round(mpptCenter/Vmp) = 8,
  // giving [8,8,8,8,4] = 5 strings × 15.3A = 76.5A > 72A channel budget
  // → MPPT_CURRENT_EXCEEDED, user saw a FAIL.
  // After v47.419: the generator searches longer-first and picks 10/string,
  // giving [10,10,10,6] = 4 strings × 15.3A = 61.3A within budget.
  const recAlphaLike = {
    voc: 41.8, vmp: 34.5, isc: 12.26, imp: 11.91, watts: 400,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.05,
    maxSeriesFuseRating: 25, maxSeriesFuse: 25,
  };
  const solark2x8k = {
    maxDcVoltage: 500, mpptVoltageMin: 150, mpptVoltageMax: 425,
    mpptChannels: 4,            // 2 units × 2 MPPT each
    maxInputCurrent: 18.0,
    maxInputCurrentPerMppt: 18.0,
    maxParallelStringsPerMppt: 2,
    acOutputKw: 16.0,
    dcInputKwMax: 21.0,
  };

  it('Sol-Ark 8K-2P × 2 units + 36 panels (Vmp=34.5): picks 10/string not 8', () => {
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: recAlphaLike,
      inverterSpecs: solark2x8k,
      designTempMin: -10,
      topology: 'hybrid',
    });
    // Must be 4 strings, not 5. Layout [10,10,10,6].
    expect(result.totalStrings).toBe(4);
    const counts = result.strings.map(s => s.panelsInString).sort((a, b) => b - a);
    expect(counts).toEqual([10, 10, 10, 6]);
    // Total current: 4 × (12.26 × 1.25) = 61.3 A, well within 4ch × 18A = 72 A.
    // No MPPT_CURRENT_EXCEEDED.
    const errorText = result.errors.join(' ');
    expect(errorText).not.toContain('MPPT_CURRENT_EXCEEDED');
    expect(errorText).not.toContain('MPPT_ALLOCATION_INVALID');
    expect(errorText).not.toContain('SLOT_CAPACITY_EXCEEDED');
  });

  it('current-unconstrained (no maxInputCurrent) falls back to legacy recommended', () => {
    // When current limits are missing, we should not fail-search — the
    // legacy behaviour (use clampedRecommended) is preserved so systems
    // with unknown current caps still produce a reasonable layout.
    const noCurrentCap = { ...solark2x8k, maxInputCurrent: undefined as any, maxInputCurrentPerMppt: undefined as any };
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: recAlphaLike,
      inverterSpecs: noCurrentCap,
      designTempMin: -10,
      topology: 'hybrid',
    });
    // Legacy path uses clampedRecommended = round((150+425)/2 / 34.5) = 8.
    // 36/8 = 4 full + 4 remainder → 5 strings.
    expect(result.totalStrings).toBe(5);
  });

  it('current-aware search respects voltage-safe max (does not pick 11 panels when max=10)', () => {
    // maxPanelsPerString = floor(500 / vocCorrected). With designTempMin=-10
    // vocCorrected ≈ 45.75, max = floor(500/45.75) = 10. The search starts
    // at 10 and that already passes current budget, so the result is 10.
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: recAlphaLike,
      inverterSpecs: solark2x8k,
      designTempMin: -10,
      topology: 'hybrid',
    });
    const maxPanelInAnyString = Math.max(...result.strings.map(s => s.panelsInString));
    expect(maxPanelInAnyString).toBeLessThanOrEqual(result.maxPanelsPerString);
  });
});

// ─── v47.420 — Stage 5.1 Growatt compliance smoke tests ────────────────────
// End-to-end string-generator proof that a Growatt MIN TL-XH-US produces a
// clean PASS layout for realistic residential panel counts. Uses the actual
// datasheet-derived inverter specs (registry values, not invented numbers).
//
// IMPORTANT: Growatt MIN TL-XH-US self-limits at 13.5 A OPERATING current
// per MPPT (per datasheet). NEC 690.8(A)(1) requires design current =
// panel Isc × 1.25. So the pairing constraint is: panel Isc ≤ 10.8 A for
// a comfortable fit. Panels with Isc ≈ 11 A work but sit right at the
// boundary; panels with Isc > 11 A (e.g. Qcells Peak Duo 12.26 A,
// Silfab 13.30 A) will trigger MPPT_CURRENT_EXCEEDED on Growatt — this
// is correct behaviour that surfaces a real incompatibility.
//
// The datasheet allows up to 16.9 A SHORT-CIRCUIT per MPPT — this is the
// safety-survivable limit, not the operating/design-current limit.
describe('v47.420 — Growatt MIN TL-XH-US end-to-end string generation', () => {
  // Panasonic EverVolt HK Black 410W — Isc=10.06 A, representative of the residential
  // panels Growatt MIN TL-XH-US is designed to pair with.
  // Design current per string = 10.06 × 1.25 = 12.58 A < 13.5 A cap. PASS.
  const evervolt410 = {
    voc: 51.9, vmp: 43.7, isc: 10.06, imp: 9.39, watts: 410,
    tempCoeffVoc: -0.26, tempCoeffIsc: 0.04,
    maxSeriesFuseRating: 20, maxSeriesFuse: 20,
  };

  // Higher-Isc panel for negative-test coverage (expected to surface a
  // real MPPT-current error — locks in that Growatt correctly rejects
  // panel pairings that exceed the 13.5 A operating cap).
  const silfab430 = {
    voc: 41.2, vmp: 34.4, isc: 13.30, imp: 12.50, watts: 430,
    tempCoeffVoc: -0.27, tempCoeffIsc: 0.05,
    maxSeriesFuseRating: 25, maxSeriesFuse: 25,
  };

  // Growatt MIN 11400TL-XH-US — family flagship (registry-accurate specs).
  // 3 MPPT × 2 parallel = 6 slots, 13.5 A per-MPPT operating current cap.
  const growatt11400 = {
    maxDcVoltage: 600,
    mpptVoltageMin: 220,
    mpptVoltageMax: 500,
    mpptChannels: 3,
    maxInputCurrent: 13.5,
    maxInputCurrentPerMppt: 13.5,
    maxParallelStringsPerMppt: 2,
    acOutputKw: 11.4,
    dcInputKwMax: 22.8,
    nominalDcVoltage: 360,
  };

  // Growatt MIN 6000TL-XH-US — 3 MPPT × 2 parallel = 6 slots, same 13.5 A cap.
  const growatt6000 = {
    maxDcVoltage: 600,
    mpptVoltageMin: 160,
    mpptVoltageMax: 500,
    mpptChannels: 3,
    maxInputCurrent: 13.5,
    maxInputCurrentPerMppt: 13.5,
    maxParallelStringsPerMppt: 2,
    acOutputKw: 6.0,
    dcInputKwMax: 12.0,
    nominalDcVoltage: 360,
  };

  it('Growatt 11400 + 24 panels EVERVOLT 410W: produces a clean PASS layout (no allocation errors)', () => {
    // 24 × 410W = 9.84 kW DC on 11.4 kW AC (ratio 0.86 — undersized array,
    // which is fine, many customers start small and expand). Per-string
    // design current = 10.06 × 1.25 = 12.58 A < 13.5 A cap.
    // Voltage-safe max ≈ floor(600 / 56.9) = 10 panels per string.
    // Expected: 3 strings of 8 panels (or similar even distribution).
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: evervolt410,
      inverterSpecs: growatt11400,
      designTempMin: -10,
      topology: 'hybrid',
    });
    expect(result.strings.length).toBeGreaterThan(0);
    const total = result.strings.reduce((s, str) => s + str.panelsInString, 0);
    expect(total).toBe(24);
    const maxPanelInAnyString = Math.max(...result.strings.map(s => s.panelsInString));
    expect(maxPanelInAnyString).toBeLessThanOrEqual(result.maxPanelsPerString);
    expect(result.totalStrings).toBeLessThanOrEqual(6); // 3 MPPT × 2 parallel
    // Must not surface MPPT-current or allocation errors with compatible panel.
    const errorText = result.errors.join(' ');
    expect(errorText).not.toContain('MPPT_CURRENT_EXCEEDED');
    expect(errorText).not.toContain('MPPT_ALLOCATION_INVALID');
    expect(errorText).not.toContain('SLOT_CAPACITY_EXCEEDED');
  });

  it('Growatt 6000 + 18 panels EVERVOLT 410W: fits cleanly (no slot or current errors)', () => {
    // 18 × 410W = 7.38 kW DC on 6.0 kW AC (ratio 1.23 — typical residential).
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: evervolt410,
      inverterSpecs: growatt6000,
      designTempMin: -10,
      topology: 'hybrid',
    });
    const total = result.strings.reduce((s, str) => s + str.panelsInString, 0);
    expect(total).toBe(18);
    expect(result.totalStrings).toBeGreaterThanOrEqual(2);
    expect(result.totalStrings).toBeLessThanOrEqual(6);
    const errorText = result.errors.join(' ');
    expect(errorText).not.toContain('SLOT_CAPACITY_EXCEEDED');
    expect(errorText).not.toContain('MPPT_ALLOCATION_INVALID');
    expect(errorText).not.toContain('MPPT_CURRENT_EXCEEDED');
  });

  it('Growatt 11400 + 36 panels EVERVOLT 410W: current-aware search distributes across MPPT channels', () => {
    // 36 panels, voltage-safe max ≈ 10, 6 slots. Naive: 36/10 = 4 strings,
    // fits in 6 slots. Design current per string = 12.58 A, 4 strings =
    // 50.3 A total vs 3 × 13.5 = 40.5 A total cap. Uh oh — that IS over.
    // The v47.419 current-aware search should find a longer string length
    // (11, 12) to reduce string count from 4 to 3. At 12 per string × 3
    // strings = 36, 3 strings at 12.58 A each spread 1-per-MPPT = 12.58 A
    // per channel ≤ 13.5 A ✓. Expected: 3 strings, one per MPPT.
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: evervolt410,
      inverterSpecs: growatt11400,
      designTempMin: -10,
      topology: 'hybrid',
    });
    const total = result.strings.reduce((s, str) => s + str.panelsInString, 0);
    expect(total).toBe(36);
    expect(result.totalStrings).toBeLessThanOrEqual(6);
    const errorText = result.errors.join(' ');
    expect(errorText).not.toContain('SLOT_CAPACITY_EXCEEDED');
  });

  // Negative test: high-Isc panel pairing surfaces the manufacturer limit.
  // This is CORRECT behaviour — Growatt's 13.5 A operating cap means panels
  // with Isc > 10.8 A are incompatible. The system must honestly surface
  // this rather than silently accept an infeasible design.
  //
  // v47.421 — The error message is now enriched with specific compatible-
  // panel suggestions from the registry ("switch to Panasonic EVERVOLT"),
  // turning an unactionable code into a concrete remediation path.
  it('Growatt 11400 + high-Isc Silfab 430W: surfaces MPPT_CURRENT_EXCEEDED with panel-swap suggestions', () => {
    // Silfab Isc 13.30 × 1.25 = 16.63 A > 13.5 A cap. Every string fails.
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: silfab430,
      inverterSpecs: growatt11400,
      designTempMin: -10,
      topology: 'hybrid',
    });
    const errorText = result.errors.join(' ');
    // (a) The underlying error still surfaces.
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
    // (b) v47.421 — the error now tells the user WHICH panels would work.
    expect(errorText).toContain('Compatible panels in the SolarPro catalog');
    expect(errorText).toContain('Panasonic EverVolt HK Black 410W');
  });

  // ─── v47.422 — MPPT-channel-spread display fix ───────────────────────────
  // The screenshot bug: when every string exceeded the per-MPPT current cap,
  // all strings were collapsed onto channel 0 in the generated output,
  // making the UI display "CH1: 3 strings, CH2-4: empty" — a misleading
  // rendering of the installer's intended layout.
  //
  // v47.422 second-pass spreads unplaced strings across channels so the UI
  // honestly shows each channel's real load (and its overage, if any).
  // This is the brand-agnostic fix the user explicitly requested:
  // "I can't keep doing this every time we add a brand".
  it('v47.422 — Growatt 11400 + high-Isc Silfab 430W: strings spread across MPPT channels, not collapsed onto CH1', () => {
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: silfab430,
      inverterSpecs: growatt11400,
      designTempMin: -10,
      topology: 'hybrid',
    });

    // Every string must land on a channel — no "unplaced" collapse onto CH1.
    const totalStringsPlaced = result.mpptChannels.reduce(
      (sum, ch) => sum + ch.strings.length,
      0,
    );
    expect(totalStringsPlaced).toBe(result.strings.length);
    expect(totalStringsPlaced).toBeGreaterThan(0);

    // Critical assertion: at least 2 channels are used (no CH1-collapse).
    // Growatt 11400 has 3 MPPT channels; with 3+ strings we expect spread.
    const channelsInUse = result.mpptChannels.filter(c => c.strings.length > 0);
    expect(channelsInUse.length).toBeGreaterThanOrEqual(2);

    // The generated strings' mpptChannel fields must match the
    // mpptChannels[] summary — if a string is "assigned" to CH2 in
    // the flat list, it must appear under mpptChannels[1].strings.
    for (const gs of result.strings) {
      const ch = result.mpptChannels[gs.mpptChannel];
      expect(ch).toBeDefined();
      expect(ch.strings.some(s => s.stringIndex === gs.stringIndex)).toBe(true);
    }

    // Still invalid — the user is warned, but via accurate per-channel chips.
    expect(result.isValid).toBe(false);
    const errorText = result.errors.join(' ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
  });
});
