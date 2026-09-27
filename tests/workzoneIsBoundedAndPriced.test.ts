// ═══════════════════════════════════════════════════════════════════════════
// 🚨 "A RECTANGULAR NEARMAP ORTHOPHOTO PLACED INTO THAT FALLBACK WORLD."
//
// Ray tested the first Nearmap-in-3D build and rejected the presentation: one 84 m x 47 m photo
// card in the middle of somebody else's basemap. He asked for "project property + nearby
// neighborhood context... rather than one tiny 1440x810 card", and attached a condition:
//
//   "Do not assume a larger cached area is cheaper. Verify Nearmap API/billing behavior before
//    choosing the final workzone size/resolution strategy. The UX requirement is: bounded and
//    predictable paid imagery usage."
//
// This file is that verification, and then the bound.
//
// WHAT IS METERED, from the code: `fetchNearmapStaticAerial` issues exactly one request per entry
// of `nearmapTileGrid(...).tiles` — `tiles/v3/Vert/{z}/{x}/{y}.jpg` — and nothing else in the
// imagery path calls Nearmap at all. So a workzone's request volume is a pure function of
// (lat, lng, zoom, px), and these tests price real workzones exactly, with no key and no network.
//
// WHAT THESE TESTS DO NOT CLAIM: that Nearmap bills a z19 tile the same as a z21 tile. That is a
// contract question the repo cannot answer. The tile COUNTS below are exact; the pricing per tile
// is Ray's to confirm with Nearmap, and if it is not uniform the trade can be re-decided by editing
// one table without touching another file.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  planWorkzone, describeWorkzoneCost,
  WORKZONE_TARGETS, WORKZONE_TILE_CEILING,
  type WorkzonePlan,
} from '@/lib/aerial/workzonePlan';
import { nearmapTileGrid, metresPerPixel } from '@/lib/map/webMercator';

/** Ray's site. Tile counts depend on where the centre falls inside a tile, so this is exact. */
const RAY = { lat: 38.6, lng: -90.2 };

/** Latitude is the cost variable: pixels per metre grows with it, so tiles do too. */
const SITES = [
  { name: 'equator',       lat: 0,      lng: 0 },
  { name: 'Houston',       lat: 29.76,  lng: -95.37 },
  { name: 'St Louis (Ray)', lat: 38.6,  lng: -90.2 },
  { name: 'Denver',        lat: 39.74,  lng: -104.99 },
  { name: 'Seattle',       lat: 47.61,  lng: -122.33 },
  { name: 'Calgary',       lat: 51.05,  lng: -114.07 },
  { name: 'Anchorage',     lat: 61.22,  lng: -149.9 },
  { name: 'Sydney',        lat: -33.87, lng: 151.21 },
  { name: 'Reykjavik',     lat: 64.13,  lng: -21.9 },
  { name: 'Ushuaia',       lat: -54.8,  lng: -68.3 },
];

const layer = (p: WorkzonePlan, role: string) => p.layers.find(l => l.role === role)!;

describe("🚨 the workzone Ray actually gets, priced to the tile", () => {
  it('is a neighbourhood and a design core, not one card', () => {
    const p = planWorkzone(RAY.lat, RAY.lng)!;
    expect(p).toBeTruthy();
    expect(p.layers.map(l => l.role)).toEqual(['core', 'context']);

    const core = layer(p, 'core');
    expect(core.zoom).toBe(21);
    expect(core.groundWidthM).toBeCloseTo(120, 0);
    expect(core.groundHeightM).toBeCloseTo(90, 0);
    expect(core.resolutionCmPerPx).toBeCloseTo(5.8, 1);

    const ctx = layer(p, 'context');
    expect(ctx.zoom).toBe(19);
    expect(ctx.groundWidthM).toBeCloseTo(360, 0);
    expect(ctx.groundHeightM).toBeCloseTo(240, 0);
    expect(ctx.resolutionCmPerPx).toBeCloseTo(23.3, 1);
  });

  it('🚨 costs 98 paid tile GETs at this address — pinned, so widening it cannot pass unnoticed', () => {
    const p = planWorkzone(RAY.lat, RAY.lng)!;
    expect(layer(p, 'core').tiles).toBe(63);
    expect(layer(p, 'context').tiles).toBe(35);
    expect(p.totalTiles).toBe(98);
    // And the plan's own count is the fetcher's count, not an estimate beside it.
    for (const l of p.layers) {
      expect(nearmapTileGrid(RAY.lat, RAY.lng, l.zoom, l.widthPx, l.heightPx).tiles.length)
        .toBe(l.tiles);
    }
  });

  it('🚨 multi-resolution is what makes the neighbourhood affordable — measured, not assumed', () => {
    const p = planWorkzone(RAY.lat, RAY.lng)!;
    const ctx = layer(p, 'context');
    // The SAME ground, at the core's design resolution.
    const mppCore = metresPerPixel(RAY.lat, 21)!;
    const singleRes = nearmapTileGrid(
      RAY.lat, RAY.lng, 21,
      Math.round(ctx.groundWidthM / mppCore), Math.round(ctx.groundHeightM / mppCore),
    ).tiles.length;
    expect(singleRes).toBe(425);
    // 4.3x the whole two-layer plan. This is the number that decides the architecture.
    expect(singleRes / p.totalTiles).toBeGreaterThan(4);
    // And the ring itself is cheaper than the core it surrounds, at 9x the area.
    expect(ctx.tiles).toBeLessThan(layer(p, 'core').tiles);
  });

  it('says what it is about to spend, in the unit that is metered', () => {
    const msg = describeWorkzoneCost(planWorkzone(RAY.lat, RAY.lng));
    expect(msg).toContain('98 paid tile GETs');
    expect(msg).toContain('core z21');
    expect(msg).toContain('context z19');
    expect(describeWorkzoneCost(null)).toMatch(/no workzone/i);
  });
});

describe('🚨 the cost bound is a tile ceiling, and it holds at every latitude', () => {
  it('no site on earth exceeds the ceiling, or any layer its own budget', () => {
    for (const s of SITES) {
      const p = planWorkzone(s.lat, s.lng);
      expect(p, `${s.name} could not be planned at all`).toBeTruthy();
      expect(p!.totalTiles, `${s.name} exceeded the ceiling`)
        .toBeLessThanOrEqual(WORKZONE_TILE_CEILING);
      for (const l of p!.layers) {
        const budget = WORKZONE_TARGETS.find(t => t.role === l.role)!.tileBudget;
        expect(l.tiles, `${s.name} ${l.role} exceeded its budget`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('🚨 and at a far-northern address the EXTENT gives way, not the cost', () => {
    // Anchorage at the full target extent would be 154 + 77 = 231 tiles — more than double the
    // ceiling. An extent-only rule would have quietly spent it.
    const mppCore = metresPerPixel(61.22, 21)!, mppCtx = metresPerPixel(61.22, 19)!;
    const unbounded =
      nearmapTileGrid(61.22, -149.9, 21, Math.round(120 / mppCore), Math.round(90 / mppCore))
        .tiles.length
      + nearmapTileGrid(61.22, -149.9, 19, Math.round(360 / mppCtx), Math.round(240 / mppCtx))
        .tiles.length;
    expect(unbounded).toBeGreaterThan(WORKZONE_TILE_CEILING * 2);

    const p = planWorkzone(61.22, -149.9)!;
    expect(p.totalTiles).toBeLessThanOrEqual(WORKZONE_TILE_CEILING);
    // Said out loud, so nobody reads the smaller frame as a bug.
    expect(p.layers.every(l => l.boundedByBudget)).toBe(true);
    expect(layer(p, 'core').groundWidthM).toBeLessThan(120);
    expect(describeWorkzoneCost(p)).toContain('extent reduced');
  });

  it('at Ray’s latitude the budget does NOT bind — he gets the full target extent', () => {
    const p = planWorkzone(RAY.lat, RAY.lng)!;
    expect(p.layers.every(l => l.boundedByBudget)).toBe(false);
  });

  it('the ceiling is the sum of the budgets, with nothing outside the table', () => {
    expect(WORKZONE_TILE_CEILING).toBe(112);
    expect(WORKZONE_TARGETS).toHaveLength(2);
  });
});

describe('🚨 the ring encloses the core, at every site', () => {
  it('the context strictly contains the core, so the cut-out is a hole and not an overhang', () => {
    for (const s of SITES) {
      const p = planWorkzone(s.lat, s.lng)!;
      const ctx = p.layers.find(l => l.role === 'context');
      if (!ctx) continue;                     // dropped on purpose is allowed; overlapping is not
      const core = layer(p, 'core');
      expect(core.bounds.west, s.name).toBeGreaterThan(ctx.bounds.west);
      expect(core.bounds.east, s.name).toBeLessThan(ctx.bounds.east);
      expect(core.bounds.south, s.name).toBeGreaterThan(ctx.bounds.south);
      expect(core.bounds.north, s.name).toBeLessThan(ctx.bounds.north);
    }
  });

  it('every layer is centred on the project, so the two agree about where the house is', () => {
    const p = planWorkzone(RAY.lat, RAY.lng)!;
    for (const l of p.layers) {
      expect((l.bounds.west + l.bounds.east) / 2).toBeCloseTo(RAY.lng, 4);
      expect((l.bounds.south + l.bounds.north) / 2).toBeCloseTo(RAY.lat, 4);
    }
  });
});

describe('🚨 the explicit expand buys only what is missing', () => {
  it('planning just the context costs the ring and nothing else', () => {
    const p = planWorkzone(RAY.lat, RAY.lng, ['context'])!;
    expect(p.layers.map(l => l.role)).toEqual(['context']);
    expect(p.totalTiles).toBe(35);
  });

  it('planning just the core costs the core and nothing else', () => {
    const p = planWorkzone(RAY.lat, RAY.lng, ['core'])!;
    expect(p.layers.map(l => l.role)).toEqual(['core']);
    expect(p.totalTiles).toBe(63);
  });

  it('a core-only plan is still a plan — no context does not void the design surface', () => {
    const p = planWorkzone(RAY.lat, RAY.lng, ['core'])!;
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].bounds).toBeTruthy();
  });
});

describe('🚨 it refuses rather than guessing', () => {
  it('no location, no plan', () => {
    for (const [lat, lng] of [[NaN, -90], [38.6, NaN], [91, 0], [0, 181], [-86, 0]]) {
      expect(planWorkzone(lat, lng), `${lat},${lng} was planned anyway`).toBeNull();
    }
  });
});
