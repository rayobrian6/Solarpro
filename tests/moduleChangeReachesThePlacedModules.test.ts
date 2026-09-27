// ═══════════════════════════════════════════════════════════════════════════
// 🚨 81 MODULES STILL REPORTING 35.64 kW AFTER A 580 W MODULE WAS CHOSEN.
//
// Ray, live: he looked for a 550 W module, found none in his catalogue, and picked a real 580 W
// one instead. "One system-kW display changed. The right Production Results/sidebar did not and
// continued displaying the value derived from the prior 440 W panel."
//
//     81 × 440 W = 35.64 kW        81 × 580 W = 46.98 kW
//
// WHICH CONSUMER BYPASSES THE IDENTITY. `panelId` IS the module identity; manufacturer, model and
// watts are PROJECTIONS of it. A `PlacedPanel` carries no `panelId` at all — only the projections
// `wattage`, `widthFeet` and `heightFeet`, stamped from whichever module was selected AT PLACEMENT
// TIME. So the picker updated `selectedPanel` and wrote the canonical `selected_equipment` store,
// and eighty-one placed modules went on projecting a module nobody had chosen any more.
//
// `calculateSystemSize` sums `p.wattage`. It was reading the stale projection, not disagreeing
// with it — which is why no new system-size calculator appears here. The projection is
// re-materialised; the summation is untouched.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { restampModuleProjection } from '@/lib/equipment/restampModuleProjection';
import { calculateSystemSize } from '@/lib/panelLayout';
import type { PlacedPanel } from '@/types';

const FT = 3.28084;

/** 81 modules of a 440 W product, 1.134 m x 1.722 m portrait — Ray's design. */
function placed(count: number, wattage: number, wM = 1.134, hM = 1.722): PlacedPanel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, layoutId: 'L', lat: 38.6, lng: -90.2, x: 0, y: 0,
    tilt: 20, azimuth: 180, wattage, bifacialGain: 1,
    row: Math.floor(i / 9), col: i % 9,
    widthFeet: wM * FT, heightFeet: hM * FT,
  })) as PlacedPanel[];
}

const P440 = { wattage: 440, width: 1.134, height: 1.722 };
const P580 = { wattage: 580, width: 1.303, height: 2.278 };   // a real 580 W product is BIGGER

describe("🚨 Ray's design, before and after the module change", () => {
  it('reproduces the reported numbers exactly', () => {
    const before = placed(81, 440);
    expect(calculateSystemSize(before)).toBeCloseTo(35.64, 6);
    const after = restampModuleProjection(before, P580).panels;
    expect(calculateSystemSize(after),
      'the placed modules still project the old product, so the system size is the old one')
      .toBeCloseTo(46.98, 6);
  });

  it('🚨 every placed module carries the selected product’s wattage afterwards', () => {
    const r = restampModuleProjection(placed(81, 440), P580);
    expect(r.restamped, 'not every module was re-materialised').toBe(81);
    expect(r.panels.every(p => p.wattage === 580)).toBe(true);
  });

  it('and the system size AGREES with count x selected wattage, which is the whole complaint', () => {
    const r = restampModuleProjection(placed(81, 440), P580);
    expect(calculateSystemSize(r.panels)).toBeCloseTo((81 * 580) / 1000, 9);
  });

  it('a module change that changes nothing re-stamps nothing', () => {
    const r = restampModuleProjection(placed(12, 440), P440);
    expect(r.restamped).toBe(0);
    // Same objects, so no downstream effect fires for a no-op pick.
    expect(r.panels[0]).toBe(r.panels[0]);
  });
});

describe('🚨 it re-materialises the PROJECTION and moves nothing', () => {
  it('positions, rows, columns and ids are untouched', () => {
    const before = placed(9, 440);
    const after = restampModuleProjection(before, P580).panels;
    for (let i = 0; i < before.length; i++) {
      expect(after[i].id).toBe(before[i].id);
      expect(after[i].lat).toBe(before[i].lat);
      expect(after[i].lng).toBe(before[i].lng);
      expect(after[i].row).toBe(before[i].row);
      expect(after[i].col).toBe(before[i].col);
    }
  });

  it('🚨 and it does NOT redraw them at the new size — it REPORTS that they do not match', () => {
    // Redrawing at the new size on top of the old positions produces overlapping hardware;
    // re-laying them out destroys hand placement ("NEVER rearrange or delete design panels to
    // clean a drawing"). So the mismatch is stated and the operator re-fits deliberately.
    const before = placed(9, 440);
    const r = restampModuleProjection(before, P580);
    expect(r.layoutFittedForDifferentSize,
      'a physically larger module was accepted into a layout fitted for a smaller one with no '
      + 'mention of it').toBe(true);
    expect(r.panels[0].widthFeet).toBe(before[0].widthFeet);
    expect(r.panels[0].heightFeet).toBe(before[0].heightFeet);
  });

  it('a same-size product of a different wattage is not flagged', () => {
    const sameSize = { wattage: 460, width: 1.134, height: 1.722 };
    const r = restampModuleProjection(placed(9, 440), sameSize);
    expect(r.restamped).toBe(9);
    expect(r.layoutFittedForDifferentSize).toBe(false);
  });

  it('LANDSCAPE modules are compared as an unordered pair, not width-to-width', () => {
    // A landscape module stamps widthFeet = the module's LONG side. Comparing in order would
    // report every landscape array as mismatched.
    const landscape = placed(4, 440, 1.722, 1.134);
    const r = restampModuleProjection(landscape, P440);
    expect(r.layoutFittedForDifferentSize,
      'a landscape layout was reported as fitted for a different module').toBe(false);
  });

  it('says nothing when it cannot tell — a module with no dimensions', () => {
    const r = restampModuleProjection(placed(4, 440), { wattage: 580 });
    expect(r.restamped).toBe(4);
    expect(r.layoutFittedForDifferentSize,
      'an unknown size was reported as a definite answer').toBeNull();
  });
});

describe('🚨 it refuses nonsense rather than zeroing a design', () => {
  it('a module with no wattage changes nothing', () => {
    const before = placed(6, 440);
    for (const bad of [{ wattage: 0 }, { wattage: NaN }, { wattage: -5 }, {} as never]) {
      const r = restampModuleProjection(before, bad as { wattage: number });
      expect(r.restamped).toBe(0);
      expect(calculateSystemSize(r.panels), 'a bad module wattage zeroed the system size')
        .toBeCloseTo(2.64, 6);
    }
  });

  it('an empty layout is not an error', () => {
    const r = restampModuleProjection([], P580);
    expect(r.panels).toEqual([]);
    expect(r.restamped).toBe(0);
    expect(r.layoutFittedForDifferentSize).toBeNull();
  });
});
