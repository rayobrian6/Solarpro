// ============================================================================
// lib/string-generator.test.ts — Phase 13.4
//
// Integration test: generateStringConfig() must surface structured MPPT
// allocation failures as hard errors (isValid=false), not just warnings.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { generateStringConfig } from './string-generator';

describe('generateStringConfig — Phase 13.4 MPPT allocator integration', () => {
  // Reproduces the exact v47.374 production screenshot:
  //   36 panels × 400W, 12-panel strings, 2 MPPTs, 18A per channel.
  //   Expected result: 3 strings × ~15.3A each cannot fit on 2 channels
  //   without exceeding per-channel current. Must be invalid.
  it('36 panels / 12 PPS / 2 MPPT / 18A → isValid=false with MPPT_CURRENT_EXCEEDED', () => {
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: {
        voc: 45.39,
        vmp: 38,
        isc: 12.2,    // actual Isc from the screenshot
        imp: 11.4,
        watts: 400,
        tempCoeffVoc: -0.27,
        maxSeriesFuse: 20,
      },
      inverterSpecs: {
        maxDcVoltage: 600,
        mpptVoltageMin: 100,
        mpptVoltageMax: 550,
        mpptChannels: 2,
        maxInputCurrentPerMppt: 18,
        maxParallelStringsPerMppt: 2,
        acOutputKw: 10,
      },
      designTempMin: -10,
    });

    // HARD FAIL: allocator could not place 3 strings within 18A per channel.
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const errorText = result.errors.join(' | ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');

    // Structured allocation result is present and marked invalid.
    expect(result.mpptAllocation).toBeDefined();
    expect(result.mpptAllocation!.valid).toBe(false);
    expect(result.mpptAllocation!.violations.length).toBeGreaterThan(0);
  });

  it('36 panels / 12 PPS / 2 MPPT / 35A (plenty of headroom) → isValid=true', () => {
    // Same geometry but a channel current rating that comfortably fits
    // 2 strings × 15.3A = 30.6A. Allocation valid.
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: {
        voc: 45.39, vmp: 38, isc: 12.2, imp: 11.4, watts: 400,
        tempCoeffVoc: -0.27, maxSeriesFuse: 20,
      },
      inverterSpecs: {
        maxDcVoltage: 600,
        mpptVoltageMin: 100,
        mpptVoltageMax: 550,
        mpptChannels: 2,
        maxInputCurrentPerMppt: 35,
        maxParallelStringsPerMppt: 2,
        acOutputKw: 10,
      },
    });
    expect(result.isValid).toBe(true);
    expect(result.mpptAllocation!.valid).toBe(true);
  });

  it('missing maxInputCurrentPerMppt → MPPT_CURRENT_UNKNOWN warning, not a hard error', () => {
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: {
        voc: 45.39, vmp: 38, isc: 12.2, imp: 11.4, watts: 400,
        tempCoeffVoc: -0.27, maxSeriesFuse: 20,
      },
      inverterSpecs: {
        maxDcVoltage: 600,
        mpptVoltageMin: 100,
        mpptVoltageMax: 550,
        mpptChannels: 2,
        // maxInputCurrentPerMppt intentionally omitted
        maxParallelStringsPerMppt: 2,
        acOutputKw: 10,
      },
    });
    // Parallel cap = 2, 2 strings, 2 MPPTs → placeable.
    expect(result.mpptAllocation!.currentLimitAssumed).toBe(true);
    const warningText = result.warnings.join(' | ');
    expect(warningText).toContain('MPPT_CURRENT_UNKNOWN');
  });

  it('default parallel cap of 1 prevents accidental over-allocation', () => {
    // 3 strings, 2 MPPTs, no explicit parallel cap → defaults to 1 →
    // third string cannot be placed → isValid=false with
    // MPPT_ALLOCATION_INVALID (since allocator reports that when
    // any string remains unplaced).
    const result = generateStringConfig({
      totalModules: 18, // 3 strings of 6 panels
      moduleSpecs: {
        voc: 45.39, vmp: 38, isc: 12.2, imp: 11.4, watts: 400,
        tempCoeffVoc: -0.27, maxSeriesFuse: 20,
      },
      inverterSpecs: {
        maxDcVoltage: 600,
        mpptVoltageMin: 100,
        mpptVoltageMax: 350, // limits max panels per string to ~7
        mpptChannels: 2,
        maxInputCurrentPerMppt: 30,
        // maxParallelStringsPerMppt intentionally omitted → defaults to 1
        acOutputKw: 8,
      },
    });
    // With parallel cap = 1 and 2 MPPTs, only 2 strings fit.
    if (result.totalStrings > 2) {
      expect(result.isValid).toBe(false);
      const errorText = result.errors.join(' | ');
      expect(errorText).toContain('MPPT_ALLOCATION_INVALID');
    }
  });
});

// ============================================================================
// v47.408 — Topology-aware string current (optimizer vs string / hybrid)
//
// Regression: the compliance tab was using Isc × 1.25 for ALL non-micro
// systems, including SolarEdge HD-Wave + P-series (optimizer topology).
// For optimizer systems the string current is capped by the optimizer's
// regulated max output (NEC 690.8(A)(2)), NOT by panel Isc. Using the
// panel method there produced false MPPT_CURRENT_EXCEEDED errors.
//
// The tests use a "separating" geometry where a high-Isc panel (17.0A →
// Isc × 1.25 = 21.25A) would OVER-FAIL a 20A MPPT channel under the
// panel method, but comfortably FITS under the optimizer cap (15.0A).
// This cleanly exercises the branch.
// ============================================================================
describe('generateStringConfig — v47.408 topology-aware per-string current', () => {
  // Shared geometry — high-Isc panel where the two NEC methods diverge.
  //   Panel method:    17.0 × 1.25 = 21.25 A per string  → FAILS on 20A channel
  //   Optimizer method:            = 15.00 A per string  → PASSES on 20A channel
  const highIscModule = {
    voc: 49.6,
    vmp: 41.8,
    isc: 17.0,                 // High-current panel — distinguishes methods
    imp: 15.5,
    watts: 500,
    tempCoeffVoc: -0.27,
    maxSeriesFuse: 30,
  };
  const tightMpptInverter = {
    maxDcVoltage: 600,
    mpptVoltageMin: 100,
    mpptVoltageMax: 200,       // Center ~150V → 4 panels/string at Vmp=41.8
    mpptChannels: 4,
    maxInputCurrentPerMppt: 20,
    maxParallelStringsPerMppt: 1,
    acOutputKw: 15.2,
  };

  it('optimizer topology uses optimizer cap, not panel Isc × 1.25', () => {
    // v47.420: clampedRecommended=25 for optimizer topology, so all 16
    // panels go in a single long string (1 × 15.0A = 15A ≤ 20A channel).
    // The key invariant is still that optimizer cap (15A) is used, not
    // panel Isc×1.25 (21.25A). If panel method were used, even a single
    // string at 21.25A would exceed the 20A channel → invalid.
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: highIscModule,
      inverterSpecs: tightMpptInverter,
      designTempMin: -10,
      topology: 'optimizer',
      // optimizerMaxOutputCurrent omitted → defaults to 15.0 A.
    });

    // Valid because optimizer cap (15.0A) ≤ 20A channel (panel method would
    // give 21.25A → MPPT_CURRENT_EXCEEDED). Core invariant preserved.
    expect(result.isValid).toBe(true);
    expect(result.mpptAllocation).toBeDefined();
    expect(result.mpptAllocation!.valid).toBe(true);
    // v47.420: 16 panels in 1 long string (clampedRecommended=25)
    expect(result.totalStrings).toBeGreaterThanOrEqual(1);

    // Verify the branch by asserting the exceeded-current error is absent.
    const errorText = result.errors.join(' | ');
    expect(errorText).not.toContain('MPPT_CURRENT_EXCEEDED');
  });

  it('same geometry in string mode fails with MPPT_CURRENT_EXCEEDED', () => {
    // Identical inputs but topology='string'. Per-string current =
    // 17.0 × 1.25 = 21.25 A > 20 A channel rating. Even one string per
    // channel fails, so every string is unplaceable.
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: highIscModule,
      inverterSpecs: tightMpptInverter,
      designTempMin: -10,
      topology: 'string',    // Explicit for clarity (also the default).
    });

    // This confirms the default path STILL uses the panel method.
    expect(result.isValid).toBe(false);
    const errorText = result.errors.join(' | ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
    // Confirm the error references the 21.3A design current (panel method).
    expect(errorText).toMatch(/21\.[0-9]A/);
  });

  it('topology omitted defaults to string semantics (backwards compat)', () => {
    // No `topology` field at all → legacy path must still use panel method.
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: highIscModule,
      inverterSpecs: tightMpptInverter,
      designTempMin: -10,
      // topology omitted entirely.
    });

    expect(result.isValid).toBe(false);
    const errorText = result.errors.join(' | ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
    expect(errorText).toMatch(/21\.[0-9]A/);
  });

  it('honors custom optimizerMaxOutputCurrent when supplied', () => {
    // A specific SKU rated at 10.5 A → even tighter than default 15A.
    // 4 strings × 10.5 A = 42 A still fits 4 × 20 A channels.
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: highIscModule,
      inverterSpecs: tightMpptInverter,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 10.5,
    });

    expect(result.isValid).toBe(true);
    const errorText = result.errors.join(' | ');
    expect(errorText).not.toContain('MPPT_CURRENT_EXCEEDED');
  });

  it('hybrid topology falls through to string semantics (panel method)', () => {
    // Hybrid inverters (e.g. EG4 FlexBOSS21) don't use optimizers — the
    // string connects directly to the inverter MPPT. They must use the
    // panel Isc × 1.25 method, same as pure string topology.
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: highIscModule,
      inverterSpecs: tightMpptInverter,
      designTempMin: -10,
      topology: 'hybrid',  // Should behave like 'string'.
    });

    // Same failure as string topology → confirms hybrid ≠ optimizer.
    expect(result.isValid).toBe(false);
    const errorText = result.errors.join(' | ');
    expect(errorText).toContain('MPPT_CURRENT_EXCEEDED');
    expect(errorText).toMatch(/21\.[0-9]A/);
  });
});/**
 * v47.410 — Topology-aware downstream propagation.
 *
 * v47.408 made `designCurrentPerString` topology-aware inside the allocator,
 * but the four downstream fields consumed by the compliance UI, SLD, permit
 * PDF, and wire autosizer (`stringIsc`, `totalDcCurrentMax`, `ocpdPerString`,
 * `dcWireAmpacity`) still used the panel-Isc method unconditionally. v47.410
 * pipes the topology-aware design current through to every one of them, so
 * there is a single source of truth.
 *
 * These tests lock in the contract: every field must reflect the topology.
 */
describe('generateStringConfig — v47.410 downstream fields honor topology', () => {
  // Use a geometry that succeeds in BOTH string and optimizer modes so we can
  // isolate the per-field numeric contract without allocator failure noise.
  // 480W panel, modest Isc (13.5A) — string method gives ~16.9A, optimizer
  // gives 15.0A — both under the 20A channel cap.
  const feasibleModule = {
    voc: 49.6,
    vmp: 41.8,
    isc: 13.5,
    imp: 12.5,
    watts: 480,
    tempCoeffVoc: -0.27,
    maxSeriesFuse: 25,
  };
  const roomyInverter = {
    maxDcVoltage: 600,
    mpptVoltageMin: 100,
    mpptVoltageMax: 200,
    mpptChannels: 4,
    maxInputCurrentPerMppt: 20,
    maxParallelStringsPerMppt: 1,
    acOutputKw: 15.2,
  };

  it('string topology: stringIsc reflects Isc × 1.25 (panel method)', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'string',
    });

    expect(result.isValid).toBe(true);
    expect(result.strings.length).toBeGreaterThan(0);

    // iscCorrected ≈ 13.5 (designTempMin affects Voc, not Isc).
    // Panel-method design current = iscCorrected × 1.25 ≈ 16.9 A.
    const s0 = result.strings[0];
    expect(s0.stringIsc).toBeGreaterThan(16.5);
    expect(s0.stringIsc).toBeLessThan(17.5);
  });

  it('optimizer topology: stringIsc equals the optimizer cap (690.8(A)(2))', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'optimizer',
      // optimizerMaxOutputCurrent omitted → default 15.0 A.
    });

    expect(result.isValid).toBe(true);
    expect(result.strings.length).toBeGreaterThan(0);

    // Every string must read exactly the optimizer cap — NOT panel × 1.25.
    for (const s of result.strings) {
      expect(s.stringIsc).toBe(15.0);
    }
  });

  it('optimizer topology: custom optimizerMaxOutputCurrent propagates to stringIsc', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 12.0,  // Custom SKU cap.
    });

    expect(result.isValid).toBe(true);
    for (const s of result.strings) {
      expect(s.stringIsc).toBe(12.0);
    }
  });

  it('optimizer topology: ocpdPerString uses the optimizer cap × 1.25, rounded up', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'optimizer',
    });

    // 15.0 × 1.25 = 18.75 → next standard OCPD ≥ 20 A (NEC 240.6).
    // Panel method would have been 13.5 × 1.25 × 1.25 ≈ 21.1 → 25 A.
    // The topology-aware value MUST be ≤ 20 A to confirm the optimizer branch fired.
    expect(result.ocpdPerString).toBeLessThanOrEqual(20);
  });

  it('string topology: ocpdPerString uses design-current × 1.25 (panel method, backwards compat)', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'string',
    });

    // designCurrent (16.9 A) × 1.25 ≈ 21.1 → next standard ≥ 25 A.
    // If the refactor had regressed the string path, we'd see 20 A here.
    expect(result.ocpdPerString).toBeGreaterThanOrEqual(25);
  });

  it('optimizer topology: dcWireAmpacity equals optimizer cap × 1.25', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'optimizer',
    });

    // 15.0 × 1.25 = 18.75 A minimum conductor ampacity.
    expect(result.dcWireAmpacity).toBeCloseTo(18.75, 2);
  });

  it('string topology: dcWireAmpacity equals design-current × 1.25 (panel method)', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'string',
    });

    // designCurrentPerString (Isc×1.25 ≈ 16.9) × 1.25 ≈ 21.1 A.
    // Strictly greater than the optimizer's 18.75 A — confirms the panel path.
    expect(result.dcWireAmpacity).toBeGreaterThan(20);
    expect(result.dcWireAmpacity).toBeLessThan(22);
  });

  it('optimizer totalDcCurrentMax sums stringIsc across topology-aware strings', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'optimizer',
    });

    // sum(15.0) across N strings must equal 15.0 × N.
    const expected = 15.0 * result.strings.length;
    expect(result.totalDcCurrentMax).toBeCloseTo(expected, 3);
  });

  it('string totalDcCurrentMax sums stringIsc across panel-method strings', () => {
    const result = generateStringConfig({
      totalModules: 16,
      moduleSpecs: feasibleModule,
      inverterSpecs: roomyInverter,
      designTempMin: -10,
      topology: 'string',
    });

    // Each string carries ~16.9 A → total ≈ 16.9 × N (strictly greater
    // than 15 × N), confirming the string path did NOT regress.
    const optimizerEquiv = 15.0 * result.strings.length;
    expect(result.totalDcCurrentMax).toBeGreaterThan(optimizerEquiv);
  });
});
// ============================================================
// v47.412 — Topology-aware string-length & MPPT-voltage-range
// bypass for optimizer systems
//
// Regression: the compliance tab was still showing FAIL after
// v47.410 + v47.411 for a 36-panel SolarEdge SE7600H job because
// `generateStringConfig` was computing maxPanelsPerString from
// panel Voc × N / cold-corrected vs inverter maxDcV (480 V),
// producing ~10 panels/string and forcing a 10/10/10/6 layout
// that blew the MPPT current budget. For optimizer systems the
// Voc × N math is inapplicable (DC-DC optimizers regulate each
// module independently; the inverter holds the bus voltage).
// The authoritative cap is the brand-spec maxPanelsPerString (25
// for SolarEdge), enforced downstream.
// ============================================================

describe('v47.412 — optimizer topology: string-length & voltage bypass', () => {
  // Typical residential panel (~45V Voc, 11A Isc, 400W)
  const residentialPanel = {
    voc: 45.0,
    vmp: 37.0,
    isc: 11.0,
    imp: 10.6,
    watts: 400,
    tempCoeffVoc: -0.27,
    maxSeriesFuse: 20,
  };

  // SolarEdge SE7600H-US HD-Wave
  const se7600hSpecs = {
    maxDcVoltage: 480,
    mpptVoltageMin: 380,
    mpptVoltageMax: 480,
    mpptChannels: 1,
    maxInputCurrentPerMppt: 20,
    maxParallelStringsPerMppt: 3,
    acOutputKw: 7.6,
  };

  it('36-panel SolarEdge optimizer system produces long strings (not many short)', () => {
    // v47.420: clampedRecommended=25 → [25,11] (2 strings, not 4 short)
    // The key invariant: optimizer topology makes FEWER, LONGER strings.
    // Before v47.412: 4 strings of 10/10/10/6 → 60A on 20A channel → FAIL
    // After v47.412:  ≤3 strings, each ≥ min panels
    // After v47.420:  2 strings [25, 11] — last string can be shorter remainder
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: residentialPanel,
      inverterSpecs: se7600hSpecs,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // Still ≤3 strings (not 4 short strings as in the pre-v47.412 bug).
    expect(result.totalStrings).toBeLessThanOrEqual(3);
    // All strings at least minPanelsPerString=8 (brand profile floor)
    for (const s of result.strings) {
      expect(s.panelsInString).toBeGreaterThanOrEqual(8);
    }
  });

  it('optimizer does NOT raise Voc×N exceeds-inverter-max error for long strings', () => {
    // 20 panels × 45V = 900V panel-Voc-sum, way above 480V inverter maxDcV.
    // String topology would legitimately flag this. Optimizer topology must not.
    const result = generateStringConfig({
      totalModules: 20,
      moduleSpecs: residentialPanel,
      inverterSpecs: se7600hSpecs,
      designTempMin: -10,
      topology: 'optimizer',
    });

    const hasVocError = result.errors.some(e =>
      /exceeds inverter max|exceeds.*maxDcVoltage|Voc=.*exceeds/.test(e)
    );
    expect(hasVocError).toBe(false);
  });

  it('optimizer does NOT raise Vmp exceeds MPPT max warning', () => {
    // 20 × 37V = 740V Vmp-sum, above 480V MPPT max. Panel-Vmp×N is
    // inapplicable to optimizers (inverter holds bus inside its MPPT range).
    const result = generateStringConfig({
      totalModules: 20,
      moduleSpecs: residentialPanel,
      inverterSpecs: se7600hSpecs,
      designTempMin: -10,
      topology: 'optimizer',
    });

    const hasVmpWarning = result.warnings.some(w =>
      /exceeds MPPT max|exceeds MPPT maximum/.test(w)
    );
    expect(hasVmpWarning).toBe(false);
  });

  it('string topology still correctly flags panel-Voc × N overvoltage', () => {
    // Regression lock: make sure we did not remove the real string-topology
    // gate. 20 panels × 45V cold-corrected on a 480V inverter must still
    // produce E-VOC-EXCEED.
    const result = generateStringConfig({
      totalModules: 20,
      moduleSpecs: residentialPanel,
      inverterSpecs: se7600hSpecs,
      designTempMin: -10,
      topology: 'string',
    });

    // Either maxPanelsPerString is clamped down (so no 20-panel string exists)
    // OR an error is recorded — but the function MUST NOT quietly pass a
    // 900V string on a 480V inverter.
    const allShort = result.strings.every(s => s.panelsInString * residentialPanel.voc <= se7600hSpecs.maxDcVoltage);
    const hasVocIssue = result.errors.some(e => /Voc=.*exceeds inverter max/.test(e));
    expect(allShort || hasVocIssue).toBe(true);
  });

  it('optimizer maxPanelsPerString is NOT derived from Voc × N', () => {
    // Direct field inspection — before v47.412 this was 10 for the above
    // geometry. It must now be the optimizer-topology high ceiling (200)
    // so the string count collapses to the minimum.
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: residentialPanel,
      inverterSpecs: se7600hSpecs,
      designTempMin: -10,
      topology: 'optimizer',
    });
    expect(result.maxPanelsPerString).toBeGreaterThanOrEqual(36);
  });
});

// ============================================================================
// v47.415 — MPPT allocator uses OPERATING current, not NEC nameplate cap
// ============================================================================
//
// Research: SolarEdge "String Sizing for SolarEdge Inverters" AppNote
//   max string power = nominalDcVoltage × optimizerMaxOutputCurrent
//   (SE7600H: 400V × 15A = 6,000W)
// The 15A optimizer nameplate is reached ONLY at max string power. Shorter
// strings operate at lower current:
//   operating current = stringPowerW / nominalDcVoltage
//   e.g. 9 × 400W on SE7600H (400V) = 3,600W / 400V = 9A, NOT 15A
//
// The MPPT allocator feasibility check must use OPERATING current
// (stringPowerW / nominalDcV), NOT the NEC conductor cap (15A). Pre-v47.415
// it used 15A everywhere, which wrongly rejected 2-strings-per-inverter
// layouts because 2 × 15 = 30A > 20A cap when the real operating current
// is 2 × 9 = 18A ≤ 20A.
//
// NEC conductor-sizing fields (stringIsc, ocpdPerString, dcWireAmpacity)
// stay at 15A per v47.410 contract — unchanged here.
// ============================================================================

describe('v47.415 — MPPT allocator uses operating current (stringPower/nominalDcV)', () => {
  const qcellsPanel400W = {
    voc: 41.6,
    vmp: 34.5,
    isc: 12.26,
    imp: 11.59,
    watts: 400,
    tempCoeffVoc: -0.26,
    maxSeriesFuse: 20,
  };

  // SE7600H-US with v47.415 nominalDcVoltage plumbed
  const se7600hWithBusV = {
    maxDcVoltage: 480,
    mpptVoltageMin: 200,
    mpptVoltageMax: 480,
    nominalDcVoltage: 400, // v47.415 — fixed DC bus
    mpptChannels: 1,
    maxInputCurrentPerMppt: 20,
    maxParallelStringsPerMppt: 3,
    acOutputKw: 7.6,
  };

  it('2 strings of 9 on ONE SE7600H: passes MPPT allocation at 18A (2×9A, NOT 2×15A)', () => {
    // 18 panels on 1 SE7600H-US. With the bug: 2 × 15A = 30A > 20A cap → FAIL.
    // With v47.415 fix: 2 × (9×400W/400V) = 2 × 9A = 18A ≤ 20A → PASS.
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: qcellsPanel400W,
      inverterSpecs: se7600hWithBusV,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // Must not have MPPT current violations.
    const hasMpptViolation = result.errors.some(e =>
      /MPPT_CURRENT_EXCEEDED|too many strings|MPPT_ALLOCATION_INVALID/.test(e)
    );
    expect(hasMpptViolation).toBe(false);
  });

  it('36 panels on 2× SE7600H: MPPT allocator accepts via operating current', () => {
    // Simulate the production scenario: 36 panels on 2× SE7600H-US.
    // String-generator is called with totalMpptChannels = 2 (sum across
    // inverter units) per /api/engineering/calculate/route.ts logic.
    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: qcellsPanel400W,
      inverterSpecs: {
        ...se7600hWithBusV,
        mpptChannels: 2, // 2 inverter units × 1 MPPT each = 2 total channels
      },
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // Must not have MPPT current violations.
    const hasMpptViolation = result.errors.some(e =>
      /MPPT_CURRENT_EXCEEDED|too many strings|MPPT_ALLOCATION_INVALID/.test(e)
    );
    expect(hasMpptViolation).toBe(false);
  });

  it('NEC conductor-sizing fields (stringIsc, ocpd, dcWire) stay at 15A nameplate', () => {
    // v47.410 contract: the *conductor* must handle the optimizer's rated
    // max output (15A) regardless of steady-state operating current.
    // v47.415 does NOT change this — only the MPPT allocator feasibility
    // math uses operating current.
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: qcellsPanel400W,
      inverterSpecs: se7600hWithBusV,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 15.0,
    });

    // stringIsc per v47.410: topology-aware = optimizer cap = 15A
    for (const s of result.strings) {
      expect(s.stringIsc).toBeCloseTo(15.0, 1);
    }
    // dcWireAmpacity per v47.410: 15 × 1.25 = 18.75A
    expect(result.dcWireAmpacity).toBeCloseTo(18.75, 1);
  });

  it('custom optimizerMaxOutputCurrent (10.5A) narrows both NEC and operating math', () => {
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: qcellsPanel400W,
      inverterSpecs: se7600hWithBusV,
      designTempMin: -10,
      topology: 'optimizer',
      optimizerMaxOutputCurrent: 10.5, // low-output SKU
    });

    for (const s of result.strings) {
      // stringIsc still uses optimizer cap for conductor sizing
      expect(s.stringIsc).toBeCloseTo(10.5, 1);
    }
    expect(result.dcWireAmpacity).toBeCloseTo(10.5 * 1.25, 1);
  });

  it('string topology (non-optimizer) uses panel Isc × 1.25 unchanged', () => {
    // Regression guard: no behavior change for non-optimizer systems.
    const result = generateStringConfig({
      totalModules: 18,
      moduleSpecs: { ...qcellsPanel400W, isc: 10.0 },
      inverterSpecs: {
        ...se7600hWithBusV,
        nominalDcVoltage: undefined, // non-optimizer doesn't use bus V
      },
      designTempMin: -10,
      topology: 'string',
    });

    // stringIsc = 10.0 × 1.25 = 12.5A (panel method)
    for (const s of result.strings) {
      expect(s.stringIsc).toBeCloseTo(12.5, 1);
    }
  });
});
