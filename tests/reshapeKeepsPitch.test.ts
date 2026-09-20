/**
 * tests/reshapeKeepsPitch.test.ts
 *
 * WHEN A FACE IS RESHAPED, THE NUMBER MUST FOLLOW THE GEOMETRY.
 *
 * THE DEFECT
 * ----------
 * Four controls reshape a roof face and emit the result through
 * `onRoofPlanesStitched`: Square Up, Stitch, the flat-trace rebuild, and the
 * Building pitch/wall sliders. That update shape carried `vertices`,
 * `localFrame3D`, `polygon3D`, `origin3D` and `normal3D` — but NOT `pitch` or
 * `azimuth`.
 *
 * So dragging the Building pitch slider changed the 3D roof while
 * `plane.pitch` kept its original value. Everything downstream reads
 * plane.pitch — the planset, the structural engine, the production model — so
 * the roof the user shaped and the pitch the permit quoted disagreed
 * permanently, and nothing reported it. `applyBuildingShape` had both values in
 * hand the whole time; it simply never sent them.
 *
 * 🚨 This is a permit-grade disagreement, not a UI nit: a stamped drawing
 * quoting a pitch the modelled roof does not have.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSignature } from '@/lib/roofPlanesSignature';
import type { RoofPlane } from '@/types';

const ENGINE = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
const STUDIO = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');

/**
 * Every `updates.push({ ... })` block, delimited by BRACE BALANCE.
 *
 * 🚨 NOT BY A CHARACTER CAP. This used to be
 *     ENGINE.match(/updates\.push\(\{[\s\S]{0,420}?\}\);/g)
 * and the 420 was load-bearing: adding one field to the emit pushed two of the
 * three blocks past the cap, so the regex silently matched ONE and the test
 * failed with "expected 1 to be 3". A test that breaks when the thing it guards
 * is correctly extended is measuring the wrong property — and the failure looks
 * like a regression, which is worse than no test.
 */
function updatePushBlocks(src: string): string[] {
  const out: string[] = [];
  const needle = 'updates.push({';
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1; // sit on the opening brace
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(needle, j);
  }
  return out;
}

describe('the emit carries the reshaped values', () => {
  it('the RoofPlaneReshapeUpdate contract includes pitch, azimuth and the ECEF frame', () => {
    // 🚨 ONE declaration. This shape used to be written out FOUR times — on the
    // prop and inside each of the three functions that fill it — so a field
    // added in one place never reached the others. `ecefFrame3D` was missing
    // from all four.
    const start = ENGINE.indexOf('export interface RoofPlaneReshapeUpdate {');
    expect(start, 'RoofPlaneReshapeUpdate must be declared once, by name').toBeGreaterThan(-1);
    const contract = ENGINE.slice(start, ENGINE.indexOf('\n}\n', start));

    expect(contract).toMatch(/pitch\?: number;/);
    expect(contract).toMatch(/azimuth\?: number;/);
    expect(contract, 'the frame panels are PLACED on must be part of the contract')
      .toMatch(/ecefFrame3D\?:/);

    // And nothing may re-declare the shape inline again.
    expect(ENGINE).not.toMatch(/updates: Array<\{/);
    expect(ENGINE.match(/const updates: RoofPlaneReshapeUpdate\[\] = \[\];/g) ?? [])
      .toHaveLength(3);
  });

  it('EVERY reshape site emits them — all three pushes', () => {
    // Square Up, the flat-trace rebuild and applyBuildingShape. If a fourth
    // reshape path is added and forgets, plane.pitch silently drifts again.
    const pushes = updatePushBlocks(ENGINE);
    expect(pushes.length).toBe(3);
    for (const push of pushes) {
      expect(push, `a reshape push omits pitch:\n${push}`).toMatch(/pitch:/);
      expect(push, `a reshape push omits azimuth:\n${push}`).toMatch(/azimuth:/);
      // 🚨 buildSurfaceGrid places panels from ecefFrame3D, not localFrame3D.
      // Emitting a new origin3D/normal3D while leaving ecefFrame3D stale put a
      // new origin on an old triad: panels wedge below the deck once the
      // reshape rotates the plane past ~0.5°, and polyUV foreshortens the
      // usable extent by cos²(Δ), which removes whole rows — panel count, kW
      // and BOM.
      expect(push, `a reshape push omits ecefFrame3D:\n${push}`).toMatch(/ecefFrame3D:/);
    }
  });
});

describe('the studio applies them to the stored plane', () => {
  it('the handler writes pitch and azimuth back', () => {
    const handler = STUDIO.slice(
      STUDIO.indexOf('onRoofPlanesStitched={(updates)'),
      STUDIO.indexOf('Stitch synced'),
    );
    expect(handler).toMatch(/\{ pitch: u\.pitch \}/);
    expect(handler).toMatch(/\{ azimuth: u\.azimuth \}/);
    // The emit is only half the journey — the studio has to store the frame too.
    expect(handler, 'the handler drops ecefFrame3D, so the emit changes nothing')
      .toMatch(/\{ ecefFrame3D: u\.ecefFrame3D \}/);
  });

  it('applies them only when present — a geometry-only stitch must not zero the pitch', () => {
    // A reshape that genuinely has nothing to say about pitch (an older emit,
    // or a pure corner-join) must leave the existing value alone rather than
    // overwrite it with undefined.
    const handler = STUDIO.slice(
      STUDIO.indexOf('onRoofPlanesStitched={(updates)'),
      STUDIO.indexOf('Stitch synced'),
    );
    expect(handler).toMatch(/typeof u\.pitch === 'number'/);
    expect(handler).toMatch(/typeof u\.azimuth === 'number'/);
  });
});

describe('the reshape reaches the database', () => {
  function plane(over: Partial<RoofPlane> = {}): RoofPlane {
    return {
      id: 'a', vertices: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1 }, { lat: 1.001, lng: 1.001 }],
      pitch: 22, azimuth: 180, area: 40, usableArea: 34, ...over,
    } as RoofPlane;
  }

  it('a pitch reshape changes the signature, so it schedules a save', () => {
    // pitch and azimuth are in SIGNED_FIELDS, so once the value actually
    // reaches the plane the existing autosave carries it. Before the fix the
    // value never changed, so there was nothing to save — the write path was
    // fine and the input to it was wrong.
    const before = layoutSignature({ panels: [], roofPlanes: [plane({ pitch: 22 })] });
    const after = layoutSignature({ panels: [], roofPlanes: [plane({ pitch: 35 })] });
    expect(after).not.toBe(before);
  });

  it('an azimuth reshape schedules a save', () => {
    const before = layoutSignature({ panels: [], roofPlanes: [plane({ azimuth: 180 })] });
    const after = layoutSignature({ panels: [], roofPlanes: [plane({ azimuth: 200 })] });
    expect(after).not.toBe(before);
  });

  it('a reshape that changes only geometry still schedules a save', () => {
    const before = layoutSignature({ panels: [], roofPlanes: [plane()] });
    const moved = plane({ vertices: [{ lat: 1, lng: 1 }, { lat: 1.002, lng: 1 }, { lat: 1.002, lng: 1.002 }] });
    expect(layoutSignature({ panels: [], roofPlanes: [moved] })).not.toBe(before);
  });
});
