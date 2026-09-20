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

describe('the emit carries the reshaped values', () => {
  it('the onRoofPlanesStitched contract includes pitch and azimuth', () => {
    const propType = ENGINE.slice(
      ENGINE.indexOf('onRoofPlanesStitched?: (updates: Array<{'),
      ENGINE.indexOf('}>) => void;', ENGINE.indexOf('onRoofPlanesStitched?: (updates: Array<{')),
    );
    expect(propType).toMatch(/pitch\?: number;/);
    expect(propType).toMatch(/azimuth\?: number;/);
  });

  it('EVERY reshape site emits them — all three pushes', () => {
    // Square Up, the flat-trace rebuild and applyBuildingShape. If a fourth
    // reshape path is added and forgets, plane.pitch silently drifts again.
    const pushes = ENGINE.match(/updates\.push\(\{[\s\S]{0,420}?\}\);/g) ?? [];
    expect(pushes.length).toBe(3);
    for (const push of pushes) {
      expect(push, `a reshape push omits pitch:\n${push}`).toMatch(/pitch:/);
      expect(push, `a reshape push omits azimuth:\n${push}`).toMatch(/azimuth:/);
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
