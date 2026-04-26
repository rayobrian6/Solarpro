// ============================================================================
// mpptAllocator-spread.test.ts — v47.422
//
// These tests lock in the "forced-spread second pass" behavior that fixes
// the production bug where all strings collapsed onto CH1 when each string
// individually exceeded the per-MPPT current cap.
//
// The user-visible symptom was: CH1 shows all strings (red, over-current),
// CH2-N show 0 strings (empty). That misrepresented the real allocation
// the installer intended and made it impossible to see per-channel overage.
//
// After v47.422 the allocator spreads unplaced strings round-robin across
// channels respecting ONLY the parallel cap, and surfaces per-channel
// current overage via the existing MPPT_CURRENT_EXCEEDED code. The
// summary-level MPPT_ALLOCATION_INVALID still fires with the capacity
// clause + remedies, so nothing is silenced.
//
// This is brand-agnostic: the same logic applies to Sol-Ark, Growatt,
// Solis, Schneider, Victron, OutBack, and every future string/hybrid
// inverter.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  distributeStringsAcrossMpptsSafely,
  type AllocatorString,
} from './mpptAllocator';

function mkStr(id: string, panels: number, designA: number): AllocatorString {
  return {
    id,
    panelCount: panels,
    voc: 45 * panels,
    isc: designA / 1.25,
    designCurrent: designA,
  };
}

describe('mpptAllocator v47.422 — forced-spread second pass', () => {
  // ─── The screenshot bug ─────────────────────────────────────────────────
  it('4 strings @ 19.2A on 4-MPPT inverter @ 13.5A cap → each channel gets 1 string', () => {
    // Real scenario: Growatt MIN 10000TL-XH-US (4-ish MPPT, 13.5A cap) +
    // Qcells Peak Duo 400W (Isc 15.36A → design 19.2A). Each string alone
    // already exceeds 13.5A.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        mkStr('s1', 10, 19.2),
        mkStr('s2', 10, 19.2),
        mkStr('s3', 10, 19.2),
        mkStr('s4', 10, 19.2),
      ],
      mpptCount: 4,
      mpptMaxInputCurrent: 13.5,
      maxParallelStringsPerMppt: 2,
    });

    // Before v47.422: all 4 strings in unplacedIds → UI showed CH1 with
    // everything. After v47.422: each channel gets one string.
    expect(result.allocation).toHaveLength(4);
    expect(result.allocation[0].stringIds).toHaveLength(1);
    expect(result.allocation[1].stringIds).toHaveLength(1);
    expect(result.allocation[2].stringIds).toHaveLength(1);
    expect(result.allocation[3].stringIds).toHaveLength(1);

    // All four channels should show a MPPT_CURRENT_EXCEEDED violation
    // because each channel's single string (19.2A) exceeds the 13.5A cap.
    const currentExceededCount = result.violations.filter(
      v => v.code === 'MPPT_CURRENT_EXCEEDED' && v.mpptIndex !== undefined,
    ).length;
    expect(currentExceededCount).toBe(4);

    // Summary-level MPPT_ALLOCATION_INVALID still fires (capacity clause).
    const summary = result.violations.find(v => v.code === 'MPPT_ALLOCATION_INVALID');
    expect(summary).toBeDefined();
    expect(summary!.message).toContain('Required');
    expect(summary!.message).toContain('lower Isc');

    // And the allocation is explicitly invalid.
    expect(result.valid).toBe(false);
  });

  it('3 strings × 15.3A on 2 × 18A MPPTs → CH1 gets 2, CH2 gets 1 (spread), per-channel overage on CH1', () => {
    // v47.374 production scenario — reproduced for the spread contract.
    // First pass places s1→CH1, s2→CH2. s3 is unplaced (30.6A > 18A).
    // Second pass force-spreads s3 onto the least-loaded bin (CH1 by
    // deterministic tie-break). CH1 now shows 30.6A > 18A overage.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        mkStr('s1', 12, 15.3),
        mkStr('s2', 12, 15.3),
        mkStr('s3', 12, 15.3),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 18,
      maxParallelStringsPerMppt: 2,
    });

    // Every string placed — none unplaced.
    const placedCount = result.allocation.reduce(
      (sum, b) => sum + b.stringIds.length, 0,
    );
    expect(placedCount).toBe(3);

    // At least one bin carries 2 strings.
    const binsWithTwo = result.allocation.filter(b => b.stringIds.length === 2).length;
    const binsWithOne = result.allocation.filter(b => b.stringIds.length === 1).length;
    expect(binsWithTwo).toBe(1);
    expect(binsWithOne).toBe(1);

    // The 2-string bin has ~30.6A current overage, surfaced per-channel.
    const perChannelOverage = result.violations.filter(
      v => v.code === 'MPPT_CURRENT_EXCEEDED' && v.mpptIndex !== undefined,
    );
    expect(perChannelOverage).toHaveLength(1);
    expect(perChannelOverage[0].message).toContain('30.6A');
    expect(perChannelOverage[0].message).toContain('18.0A');

    // Summary MPPT_ALLOCATION_INVALID still fires.
    const summary = result.violations.find(v => v.code === 'MPPT_ALLOCATION_INVALID');
    expect(summary).toBeDefined();

    expect(result.valid).toBe(false);
  });

  it('within-cap case: no regression — allocator works identically to v47.421', () => {
    // 2 strings @ 12.58A (EverVolt 410W design current) on Growatt-like
    // 3-MPPT @ 13.5A cap. Each string fits comfortably in its own channel.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        mkStr('s1', 10, 12.58),
        mkStr('s2', 10, 12.58),
      ],
      mpptCount: 3,
      mpptMaxInputCurrent: 13.5,
      maxParallelStringsPerMppt: 2,
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.allocation[0].stringIds).toHaveLength(1);
    expect(result.allocation[1].stringIds).toHaveLength(1);
    expect(result.allocation[2].stringIds).toHaveLength(0);
  });

  it('parallel cap is STILL enforced in the second pass', () => {
    // 5 strings @ 20A on 2 MPPTs @ 13.5A cap, parallelCap=2.
    // First pass: all 5 unplaced (each exceeds 13.5A alone).
    // Second pass: spread round-robin, CH1 gets 2, CH2 gets 2; 1 string
    // truly cannot be placed because both bins hit parallel cap.
    const result = distributeStringsAcrossMpptsSafely({
      strings: [
        mkStr('s1', 10, 20),
        mkStr('s2', 10, 20),
        mkStr('s3', 10, 20),
        mkStr('s4', 10, 20),
        mkStr('s5', 10, 20),
      ],
      mpptCount: 2,
      mpptMaxInputCurrent: 13.5,
      maxParallelStringsPerMppt: 2,
    });

    // Only 4 strings placed (1 truly unplaced because both bins hit parallel cap).
    const placedCount = result.allocation.reduce(
      (sum, b) => sum + b.stringIds.length, 0,
    );
    expect(placedCount).toBe(4);
    expect(result.allocation[0].stringIds).toHaveLength(2);
    expect(result.allocation[1].stringIds).toHaveLength(2);

    // Either MPPT_PARALLEL_CAP_EXCEEDED or MPPT_CURRENT_EXCEEDED can be the
    // reported blocker for the 5th string (both conditions apply; the
    // existing diagnostic branch prioritizes current-exceeded when both
    // conditions coexist). Either one correctly flags the unplaceable.
    const topLevelUnplaced = result.violations.filter(
      v =>
        (v.code === 'MPPT_PARALLEL_CAP_EXCEEDED' ||
         v.code === 'MPPT_CURRENT_EXCEEDED') &&
        v.mpptIndex === undefined &&  // top-level, not per-bin
        (v.stringIds ?? []).includes('s5'),
    );
    expect(topLevelUnplaced.length).toBeGreaterThanOrEqual(1);

    // Summary MPPT_ALLOCATION_INVALID must still fire.
    const summary = result.violations.find(v => v.code === 'MPPT_ALLOCATION_INVALID');
    expect(summary).toBeDefined();

    expect(result.valid).toBe(false);
  });

  it('force-spread does not mutate input strings or change sort order', () => {
    const input: AllocatorString[] = [
      mkStr('a', 10, 20),
      mkStr('b', 10, 20),
      mkStr('c', 10, 20),
    ];
    const inputJson = JSON.stringify(input);

    distributeStringsAcrossMpptsSafely({
      strings: input,
      mpptCount: 2,
      mpptMaxInputCurrent: 13.5,
      maxParallelStringsPerMppt: 2,
    });

    expect(JSON.stringify(input)).toBe(inputJson);
  });

  it('determinism: same input → same allocation', () => {
    const mkInput = () => [
      mkStr('s1', 10, 19.2),
      mkStr('s2', 10, 19.2),
      mkStr('s3', 10, 19.2),
    ];
    const r1 = distributeStringsAcrossMpptsSafely({
      strings: mkInput(), mpptCount: 3, mpptMaxInputCurrent: 13.5, maxParallelStringsPerMppt: 2,
    });
    const r2 = distributeStringsAcrossMpptsSafely({
      strings: mkInput(), mpptCount: 3, mpptMaxInputCurrent: 13.5, maxParallelStringsPerMppt: 2,
    });
    expect(r1.allocation.map(b => b.stringIds)).toEqual(
      r2.allocation.map(b => b.stringIds),
    );
  });

  it('brand-agnostic: same logic applies to Sol-Ark 18A, Growatt 13.5A, Solis 15A, etc.', () => {
    // Run the same 3-string scenario across four hypothetical brand caps.
    const caps = [18, 13.5, 15, 26];
    for (const cap of caps) {
      const result = distributeStringsAcrossMpptsSafely({
        strings: [mkStr('s1', 10, 19.2), mkStr('s2', 10, 19.2), mkStr('s3', 10, 19.2)],
        mpptCount: 3,
        mpptMaxInputCurrent: cap,
        maxParallelStringsPerMppt: 2,
      });

      // All strings placed (either within cap or force-spread).
      const placed = result.allocation.reduce((s, b) => s + b.stringIds.length, 0);
      expect(placed).toBe(3);

      // If the cap is tight (< 19.2), we must see overage reports.
      if (cap < 19.2) {
        expect(result.valid).toBe(false);
        const anyOverage = result.violations.some(
          v => v.code === 'MPPT_CURRENT_EXCEEDED' && v.mpptIndex !== undefined,
        );
        expect(anyOverage).toBe(true);
      } else {
        expect(result.valid).toBe(true);
      }
    }
  });
});