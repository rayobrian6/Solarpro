// ============================================================================
// lib/system/mpptAllocator.test.ts — Phase 13.4
//
// Tests the pure MPPT-aware string allocator.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  distributeStringsAcrossMpptsSafely,
  type AllocatorString,
  type AllocateStringsParams,
} from './mpptAllocator';

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeString(
  id: string,
  panelCount: number,
  designCurrent: number
): AllocatorString {
  return {
    id,
    panelCount,
    voc: 45.39 * panelCount,
    isc: designCurrent / 1.25,
    designCurrent,
  };
}

// ─── TEST 1 — Current screenshot / production bug scenario ──────────────────
describe('mpptAllocator — Phase 13.4 bug reproducer (36 panels / 3 strings / 2 MPPT / 18A)', () => {
  // This is the exact failure mode from the v47.374 production screenshot:
  //   • 36 panels → 3 strings of 12
  //   • design current per string ≈ 15.3 A
  //   • inverter: 2 MPPT channels, 18 A max input current, parallel cap 2
  //   • Expected: impossible to place 3 strings (any bin with 2 strings
  //     draws 30.6 A > 18 A). Allocator must return invalid.
  it('3 strings × 15.3A cannot land on 2 × 18A MPPTs → MPPT_CURRENT_EXCEEDED', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 12, 15.3),
        makeString('s2', 12, 15.3),
        makeString('s3', 12, 15.3),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 18,
      maxParallelStringsPerMppt: 2,
    });

    expect(result.valid).toBe(false);
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain('MPPT_CURRENT_EXCEEDED');
    expect(codes).toContain('MPPT_ALLOCATION_INVALID');
    // One string must remain unplaced because both MPPTs are already at 15.3A
    // and adding the third would hit 30.6A > 18A.
    const invalid = result.violations.find(v => v.code === 'MPPT_ALLOCATION_INVALID');
    expect(invalid?.stringIds).toHaveLength(1);
  });
});

// ─── TEST 2 — Valid 2-string / 2-MPPT case ──────────────────────────────────
describe('mpptAllocator — valid balanced allocations', () => {
  it('2 strings across 2 MPPTs → 1 each, no violations', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 12, 15.3),
        makeString('s2', 12, 15.3),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 18,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.allocation[0].stringIds).toHaveLength(1);
    expect(result.allocation[1].stringIds).toHaveLength(1);
  });

  it('4 strings across 2 MPPTs at low current → 2 each, balanced', () => {
    // 4 strings @ 7A each, 2 MPPTs @ 20A max, parallel cap 2 → each bin
    // gets 2 strings at 14A total (well within 20A).
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 8, 7),
        makeString('s2', 8, 7),
        makeString('s3', 8, 7),
        makeString('s4', 8, 7),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.allocation[0].stringIds).toHaveLength(2);
    expect(result.allocation[1].stringIds).toHaveLength(2);
    expect(result.allocation[0].totalDesignCurrent).toBe(14);
    expect(result.allocation[1].totalDesignCurrent).toBe(14);
  });

  it('4 MPPTs / 4 strings → one-per-channel balanced', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 12),
        makeString('s2', 10, 12),
        makeString('s3', 10, 12),
        makeString('s4', 10, 12),
      ],
      mpptCount: 4,
      mpptMaxInputCurrent: 15,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    for (const bin of result.allocation) {
      expect(bin.stringIds).toHaveLength(1);
      expect(bin.totalDesignCurrent).toBe(12);
    }
  });
});

// ─── TEST 3 — Parallel allowed AND current-safe ─────────────────────────────
describe('mpptAllocator — parallel strings with current headroom', () => {
  it('3 strings @ 8A, 2 MPPTs @ 20A, parallel cap 2 → 2+1 valid', () => {
    // 2 × 8A = 16A < 20A — parallel is safe on one MPPT.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 8),
        makeString('s2', 10, 8),
        makeString('s3', 10, 8),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    // Allocation should be 2+1 or 1+2 (balanced-loss best-fit).
    const counts = result.allocation.map(b => b.stringIds.length).sort();
    expect(counts).toEqual([1, 2]);
  });

  it('3 strings @ 11A, 2 MPPTs @ 20A, parallel cap 2 → 2nd parallel would exceed → 1 unplaced', () => {
    // 2 × 11A = 22A > 20A → the third string cannot join either bin.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 11),
        makeString('s2', 10, 11),
        makeString('s3', 10, 11),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(false);
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain('MPPT_CURRENT_EXCEEDED');
  });
});

// ─── TEST 4 — Missing current metadata (structured unknown) ─────────────────
describe('mpptAllocator — missing mpptMaxInputCurrent (no silent pass)', () => {
  it('emits MPPT_CURRENT_UNKNOWN and does not fake a current check', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 12, 15.3),
        makeString('s2', 12, 15.3),
      ],
      mpptCount: 2,
      // mpptMaxInputCurrent intentionally omitted
      maxParallelStringsPerMppt: 2,
    });
    // Without a current limit, 2-strings-on-2-MPPTs still places fine on
    // parallel-cap alone. Result must surface the MPPT_CURRENT_UNKNOWN
    // meta flag so callers know this is not a verified allocation.
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain('MPPT_CURRENT_UNKNOWN');
    expect(result.meta.currentLimitAssumed).toBe(true);
    expect(result.meta.mpptMaxInputCurrent).toBeNull();
  });

  it('missing current + overfull parallel → MPPT_PARALLEL_CAP_EXCEEDED (not current exceeded)', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 5),
        makeString('s2', 10, 5),
        makeString('s3', 10, 5),
      ],
      mpptCount: 2,
      // no mpptMaxInputCurrent
      maxParallelStringsPerMppt: 1, // only 1 string per MPPT allowed
    });
    expect(result.valid).toBe(false);
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain('MPPT_PARALLEL_CAP_EXCEEDED');
    expect(codes).toContain('MPPT_CURRENT_UNKNOWN');
  });
});

// ─── TEST 5 — Purity: inputs not mutated ────────────────────────────────────
describe('mpptAllocator — purity', () => {
  it('does not mutate input strings array or string objects', () => {
    const strings: AllocatorString[] = [
      makeString('s1', 12, 15.3),
      makeString('s2', 12, 15.3),
      makeString('s3', 12, 15.3),
    ];
    const params: AllocateStringsParams = {
      strings,
      mpptCount: 2,
      mpptMaxInputCurrent: 18,
      maxParallelStringsPerMppt: 2,
    };
    const snapshotStrings = JSON.stringify(strings);
    const snapshotParams = JSON.stringify(params);

    distributeStringsAcrossMpptsSafely(params);

    expect(JSON.stringify(strings)).toBe(snapshotStrings);
    expect(JSON.stringify(params)).toBe(snapshotParams);
  });
});

// ─── TEST 6 — Edge cases ────────────────────────────────────────────────────
describe('mpptAllocator — edge cases', () => {
  it('zero strings → trivially valid, empty bins', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [],
      mpptCount: 2,
      mpptMaxInputCurrent: 18,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.allocation).toHaveLength(2);
    expect(result.allocation[0].stringIds).toHaveLength(0);
    expect(result.allocation[1].stringIds).toHaveLength(0);
  });

  it('defaults parallel cap to 1 when not provided (safe default)', () => {
    // 3 strings, 2 MPPTs, no parallel cap given → safe default = 1.
    // 3rd string cannot be placed → invalid.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 5),
        makeString('s2', 10, 5),
        makeString('s3', 10, 5),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      // maxParallelStringsPerMppt intentionally omitted
    });
    expect(result.meta.maxParallelStringsPerMppt).toBe(1);
    expect(result.valid).toBe(false);
    expect(result.violations.map(v => v.code)).toContain('MPPT_PARALLEL_CAP_EXCEEDED');
  });

  it('single MPPT with all strings fitting under current cap → valid 1-bin', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 6, 4),
        makeString('s2', 6, 4),
      ],
      mpptCount: 1,
      mpptMaxInputCurrent: 15,
      maxParallelStringsPerMppt: 3,
    });
    expect(result.valid).toBe(true);
    expect(result.allocation).toHaveLength(1);
    expect(result.allocation[0].stringIds).toEqual(['s1', 's2']);
    expect(result.allocation[0].totalDesignCurrent).toBe(8);
  });

  it('sorts largest strings first (deterministic placement)', () => {
    // Two unequal strings, one larger. Should land on separate MPPTs.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('small', 6, 5),
        makeString('large', 14, 13),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 15,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.valid).toBe(true);
    // The two strings are placed; the allocator sorts by designCurrent DESC
    // then places large first into least-loaded (both bins have 0). Then
    // small goes to the other (least-loaded now).
    const ids = new Set(result.allocation.flatMap(b => b.stringIds));
    expect(ids.has('large')).toBe(true);
    expect(ids.has('small')).toBe(true);
    // Both bins should have exactly 1 string (balanced).
    expect(result.allocation[0].stringIds).toHaveLength(1);
    expect(result.allocation[1].stringIds).toHaveLength(1);
  });

  it('invalid mpptCount (0) is clamped to 1', () => {
    const result = distributeStringsAcrossMpptsSafely({
      strings: [makeString('s1', 10, 5)],
      mpptCount: 0,
      mpptMaxInputCurrent: 15,
      maxParallelStringsPerMppt: 2,
    });
    expect(result.meta.mpptCount).toBe(1);
    expect(result.allocation).toHaveLength(1);
    expect(result.valid).toBe(true);
  });
});

// ─── TEST 7a — v47.407 error-message improvements ─────────────────────────
describe('mpptAllocator — v47.407 allocation-invalid message honesty', () => {
  it('MPPT_ALLOCATION_INVALID message includes capacity clause + does NOT suggest shorter strings', () => {
    // Production scenario (from screenshot): 36 panels / 4 strings / 15.3A
    // design current on 2x15A MPPT inverter — 2 strings overflow.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 10, 15.3),
        makeString('s2', 10, 15.3),
        makeString('s3', 10, 15.3),
        makeString('s4', 6,  15.3),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 15.0,
      maxParallelStringsPerMppt: 2,
    });

    expect(result.valid).toBe(false);
    const invalidViolation = result.violations.find(
      v => v.code === 'MPPT_ALLOCATION_INVALID',
    );
    expect(invalidViolation).toBeDefined();
    const msg = invalidViolation!.message;

    // Must include the exact capacity clause.
    expect(msg).toContain('Required');
    expect(msg).toContain('61.2A total design current'); // 4 x 15.3
    expect(msg).toContain('30.0A total channel capacity'); // 2 x 15.0

    // Must NOT contain the retired "shorter strings" suggestion.
    expect(msg).not.toContain('shorter strings');
    expect(msg).not.toContain('shorter string');

    // Must point at the Sizing Recommendation panel as remedy (a).
    expect(msg).toContain('Sizing Recommendation');

    // Must include remedies (a) (b) (c).
    expect(msg).toContain('(a)');
    expect(msg).toContain('(b)');
    expect(msg).toContain('(c)');

    // Remedy (c) must reference lower Isc (panel-level), not string length.
    expect(msg).toContain('lower Isc');
  });

  it('error message scales correctly for different array sizes', () => {
    // 6 strings x 18A on 2x20A MPPT: 108A needed vs 40A capacity.
    const result = distributeStringsAcrossMpptsSafely({
      strings: Array.from({ length: 6 }, (_, i) => makeString(`s${i}`, 10, 18)),
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      maxParallelStringsPerMppt: 2,
    });
    const invalid = result.violations.find(v => v.code === 'MPPT_ALLOCATION_INVALID');
    expect(invalid).toBeDefined();
    expect(invalid!.message).toContain('108.0A total design current');
    expect(invalid!.message).toContain('40.0A total channel capacity');
    // 20A / 18A = 1.11 -> floor=1 string per channel -> need 6 channels total.
    expect(invalid!.message).toContain('6 channels total');
  });
});

// ─── TEST 7 — Deterministic best-fit behavior ───────────────────────────────
describe('mpptAllocator — best-fit / least-loaded', () => {
  it('prefers least-loaded bin when multiple are valid', () => {
    // 3 strings: 10A, 5A, 5A. 2 MPPTs, cap 3, max current 20A.
    // Sorted DESC by current: [10, 5, 5].
    //   Place 10A → bin0 (tie, lowest idx).
    //   Place 5A  → bin1 (least-loaded: 0 < 10).
    //   Place 5A  → bin1 (tie: 10 vs 5 → bin1 still least-loaded).
    // Final: bin0=[10], bin1=[5, 5].
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('big', 14, 10),
        makeString('s1', 8, 5),
        makeString('s2', 8, 5),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20,
      maxParallelStringsPerMppt: 3,
    });
    expect(result.valid).toBe(true);
    expect(result.allocation[0].totalDesignCurrent).toBe(10);
    expect(result.allocation[1].totalDesignCurrent).toBe(10);
  });
});

// ─── v47.416 — Regression: 2× SE7600H + 36 panels + optimizer topology ─────
// This locks in the datasheet-correct behaviour that motivated v47.416:
// The SE7600H-US has 1 MPPT tracker with 2 parallel DC input pairs (per the
// official SolarEdge HD-Wave NA datasheet "1-2 strings", max input 20 A).
// A 36-panel system across 2 inverters = 4 strings of 9 panels @ 400W/400V
// = 9 A operating current per string = 18 A per MPPT (under the 20 A cap).
// Before v47.416 the compliance payload from the UI omitted
// maxParallelStringsPerMppt entirely, so string-generator.ts defaulted it to
// 1 and the allocator falsely rejected the layout with MPPT_PARALLEL_CAP_EXCEEDED.
// This test proves the allocator math itself is correct when the cap is
// propagated properly from the UI payload.
describe('mpptAllocator — v47.416 regression: 2× SE7600H, 36 panels, optimizer topology', () => {
  it('4 strings of 9 panels across 2 MPPTs @ 9A each → 18A/MPPT, parallel cap 2 → valid', () => {
    // Realistic operating current for a 9-panel string on the SE7600H 400V
    // fixed DC bus: 9 × 400W / 400V ≈ 9.0 A (NOT the 15 A optimizer nameplate;
    // that is the NEC-only conductor-sizing value — see v47.415).
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('inv1-s1', 9, 9.0),
        makeString('inv1-s2', 9, 9.0),
        makeString('inv2-s1', 9, 9.0),
        makeString('inv2-s2', 9, 9.0),
      ],
      mpptCount: 2,                       // 2 inverters × 1 MPPT each
      mpptMaxInputCurrent: 20.0,          // SE7600H-US datasheet value
      maxParallelStringsPerMppt: 2,       // SE7600H-US datasheet "1-2 strings"
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    // Each MPPT receives exactly 2 strings at 9 A each = 18 A total.
    expect(result.allocation[0].stringIds).toHaveLength(2);
    expect(result.allocation[1].stringIds).toHaveLength(2);
    expect(result.allocation[0].totalDesignCurrent).toBeCloseTo(18.0, 1);
    expect(result.allocation[1].totalDesignCurrent).toBeCloseTo(18.0, 1);
    // And 18 A stays strictly below the 20 A cap.
    expect(result.allocation[0].totalDesignCurrent).toBeLessThan(20.0);
    expect(result.allocation[1].totalDesignCurrent).toBeLessThan(20.0);
  });

  it('same 4 strings but cap=1 (the pre-v47.416 payload bug) → rejected with MPPT_PARALLEL_CAP_EXCEEDED', () => {
    // This reproduces the screenshot-reported failure: the UI was omitting
    // maxParallelStringsPerMppt from the payload, string-generator.ts
    // defaulted it to 1, and the allocator could only place 2 of the 4
    // strings (one per MPPT). The regression guard here asserts the
    // allocator IS correctly restrictive in that case — the fix belongs in
    // the payload layer (app/engineering/page.tsx buildCalcPayload).
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        makeString('s1', 9, 9.0),
        makeString('s2', 9, 9.0),
        makeString('s3', 9, 9.0),
        makeString('s4', 9, 9.0),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 20.0,
      maxParallelStringsPerMppt: 1, // ← buggy legacy default
    });
    expect(result.valid).toBe(false);
    const codes = result.violations.map(v => v.code);
    expect(codes).toContain('MPPT_PARALLEL_CAP_EXCEEDED');
  });
});