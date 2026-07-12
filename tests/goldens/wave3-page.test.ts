// ═══════════════════════════════════════════════════════════════
// Wave 3 — engineering-page pure helpers (contract §3 Wave 3).
//
// Locks the page half of I-4 (no cross-sub bleed: per-sub staleness gate,
// sub-scoped fleet replacement) and I-10 (single-sub decisions IDENTICAL
// to the historical whole-fleet gates).
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';

import {
  fleetKeys,
  fleetPanelTotal,
  inverterFleetKey,
  partitionFleet,
  replaceSubFleet,
  stampFleet,
  type FleetInverterLike,
} from '@/lib/system/subSystemFleet';
import {
  gateInactiveInverterPerSub,
  gateStaleFleetPerSub,
  presentStampKeys,
} from '@/lib/system/subSystemStaleness';

const inv = (
  id: string,
  panelCounts: number[],
  subSystemKey?: 'roof' | 'ground' | 'fence',
  inverterId = 'enphase-iq8plus',
): FleetInverterLike => ({
  id,
  inverterId,
  type: 'micro',
  ...(subSystemKey ? { subSystemKey } : {}),
  strings: panelCounts.map((panelCount, i) => ({
    id: `${id}-s${i}`,
    panelCount,
    ...(subSystemKey ? { subSystemKey } : {}),
  })),
});

describe('subSystemFleet primitives', () => {
  it('inverterFleetKey: tag wins, fallback for untagged (never bare roof unless fallback is roof)', () => {
    expect(inverterFleetKey(inv('a', [5], 'ground'), 'fence')).toBe('ground');
    expect(inverterFleetKey(inv('a', [5]), 'fence')).toBe('fence');
  });

  it('partitionFleet + fleetKeys: fixed roof > ground > fence order', () => {
    const fleet = [inv('f', [17], 'fence'), inv('r', [51], 'roof'), inv('g', [26], 'ground')];
    const part = partitionFleet(fleet, 'roof');
    expect(part.roof).toHaveLength(1);
    expect(part.ground).toHaveLength(1);
    expect(part.fence).toHaveLength(1);
    expect(fleetKeys(fleet, 'roof')).toEqual(['roof', 'ground', 'fence']);
  });

  it('fleetPanelTotal sums across strings', () => {
    expect(fleetPanelTotal([inv('a', [10, 11]), inv('b', [12])])).toBe(33);
  });

  it('stampFleet tags inverters AND strings, pure', () => {
    const src = [inv('a', [8])];
    const stamped = stampFleet(src, 'fence');
    expect(stamped[0].subSystemKey).toBe('fence');
    expect(stamped[0].strings![0].subSystemKey).toBe('fence');
    expect(src[0].subSystemKey).toBeUndefined(); // input untouched
  });

  it('replaceSubFleet swaps ONE fleet in place; other subs are the same references (I-4)', () => {
    const roof = inv('r', [51], 'roof');
    const ground = inv('g', [26], 'ground');
    const fence = inv('f', [17], 'fence');
    const next = replaceSubFleet([roof, ground, fence], 'ground', [inv('g2', [30])], 'roof');
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(roof);            // untouched by reference
    expect(next[2]).toBe(fence);           // untouched by reference
    expect(next[1].id).toBe('g2');         // in place of the old ground fleet
    expect(next[1].subSystemKey).toBe('ground'); // stamped
  });

  it('replaceSubFleet appends when the sub had no fleet yet', () => {
    const roof = inv('r', [51], 'roof');
    const next = replaceSubFleet([roof], 'fence', [inv('f', [17])], 'roof');
    expect(next.map(i => i.id)).toEqual(['r', 'f']);
    expect(next[1].subSystemKey).toBe('fence');
  });
});

describe('gateStaleFleetPerSub — I-10 legacy-total mode (≤1 present sub)', () => {
  it('discards ALL on total mismatch (historical decision, byte-identical)', () => {
    const fleet = [inv('a', [10])];
    const res = gateStaleFleetPerSub({
      inverters: fleet,
      expectedBySub: { roof: 36 },
      expectedTotal: 36,
      fallbackKey: 'roof',
    });
    expect(res.mode).toBe('legacy-total');
    expect(res.anyDiscarded).toBe(true);
    expect(res.keptInverters).toHaveLength(0);
    expect(res.discardedKeys).toEqual(['roof']);
  });

  it('keeps everything when totals match / when saved total is 0', () => {
    const ok = gateStaleFleetPerSub({
      inverters: [inv('a', [36])],
      expectedBySub: { roof: 36 },
      expectedTotal: 36,
      fallbackKey: 'roof',
    });
    expect(ok.anyDiscarded).toBe(false);
    expect(ok.keptInverters).toHaveLength(1);

    const zero = gateStaleFleetPerSub({
      inverters: [inv('a', [0])],
      expectedBySub: { roof: 36 },
      expectedTotal: 36,
      fallbackKey: 'roof',
    });
    expect(zero.anyDiscarded).toBe(false);
  });

  it('fence-only project gates in legacy mode under a fence fallback (never roof-defaulted)', () => {
    const res = gateStaleFleetPerSub({
      inverters: [inv('f', [20])],
      expectedBySub: { fence: 44 },
      expectedTotal: 44,
      fallbackKey: 'fence',
    });
    expect(res.mode).toBe('legacy-total');
    expect(res.discardedKeys).toEqual(['fence']);
  });
});

describe('gateStaleFleetPerSub — per-sub mode (≥2 present subs)', () => {
  const roofFleet = inv('r', [25, 26], 'roof');   // 51 — matches
  const groundFleet = inv('g', [26], 'ground');   // 26 — matches
  const fenceFleet = inv('f', [17], 'fence');     // 17

  it('a fence CAD edit discards ONLY the fence fleet (roof/ground survive)', () => {
    const res = gateStaleFleetPerSub({
      inverters: [roofFleet, groundFleet, fenceFleet],
      expectedBySub: { roof: 51, ground: 26, fence: 20 }, // fence 17→20 in CAD
      expectedTotal: 97,
      fallbackKey: 'roof',
    });
    expect(res.mode).toBe('per-sub');
    expect(res.discardedKeys).toEqual(['fence']);
    expect(res.keptInverters.map(i => i.id)).toEqual(['r', 'g']);
    expect(res.keptInverters[0]).toBe(roofFleet); // same reference — untouched
  });

  it('nothing discarded when every fleet matches its own stamp count', () => {
    const res = gateStaleFleetPerSub({
      inverters: [roofFleet, fenceFleet],
      expectedBySub: { roof: 51, fence: 17 },
      expectedTotal: 68,
      fallbackKey: 'roof',
    });
    expect(res.anyDiscarded).toBe(false);
    expect(res.keptInverters).toHaveLength(2);
  });

  it('a fleet whose sub is no longer stamped (expected 0) is stale and discarded', () => {
    const res = gateStaleFleetPerSub({
      inverters: [roofFleet, groundFleet],
      expectedBySub: { roof: 51, fence: 17 }, // ground panels deleted in CAD
      expectedTotal: 68,
      fallbackKey: 'roof',
    });
    expect(res.mode).toBe('per-sub');
    expect(res.discardedKeys).toEqual(['ground']);
    expect(res.keptInverters.map(i => i.id)).toEqual(['r']);
  });

  it('untagged inverters belong to the fallback key fleet', () => {
    const res = gateStaleFleetPerSub({
      inverters: [inv('legacy', [51]), fenceFleet], // untagged 51-panel fleet
      expectedBySub: { roof: 51, fence: 17 },
      expectedTotal: 68,
      fallbackKey: 'roof',
    });
    expect(res.anyDiscarded).toBe(false);
  });
});

describe('gateInactiveInverterPerSub', () => {
  const dead = (id: string) => id.startsWith('ecoflow-power-ocean-');

  it('legacy mode (≤1 fleet): primary inverter check discards all', () => {
    const res = gateInactiveInverterPerSub(
      [inv('a', [10], undefined, 'ecoflow-power-ocean-5kw'), inv('b', [10], undefined, 'solis-s6')],
      'roof',
      dead,
    );
    expect(res.mode).toBe('legacy-total');
    expect(res.anyDiscarded).toBe(true);
    expect(res.keptInverters).toHaveLength(0);
  });

  it('per-sub mode: only the fleet with the dead SKU is discarded', () => {
    const res = gateInactiveInverterPerSub(
      [
        inv('r', [51], 'roof', 'enphase-iq8plus'),
        inv('f', [17], 'fence', 'ecoflow-power-ocean-5kw'),
      ],
      'roof',
      dead,
    );
    expect(res.mode).toBe('per-sub');
    expect(res.discardedKeys).toEqual(['fence']);
    expect(res.keptInverters.map(i => i.id)).toEqual(['r']);
  });
});

describe('presentStampKeys', () => {
  it('orders roof > ground > fence and drops zero counts', () => {
    expect(presentStampKeys({ fence: 17, roof: 51, ground: 0 })).toEqual(['roof', 'fence']);
    expect(presentStampKeys({})).toEqual([]);
  });
});
