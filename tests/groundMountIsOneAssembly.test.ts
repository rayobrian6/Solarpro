// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A GROUND MOUNT MUST BEHAVE AS ONE PHYSICAL ASSEMBLY.
//
// Live acceptance FAILED on 2026-09-26, after a data-layer repair had been reported as closing
// this. Ray, first hand: "A placed ground mount is still treated as fragmented rows. I can select
// only one row at a time. I cannot select the entire ground mount as one object. I cannot move the
// entire ground mount." And the ruling: "DO NOT STOP AT 'THE DATA IS CORRECT.' I NEED TO BE ABLE
// TO USE IT."
//
// THE DEFECT WAS ONE FUNCTION. `SolarEngine3D`'s `handleSelectClick` has always selected the whole
// group and handed it to grab-to-move and grab-to-rotate, which transform the selected set rigidly
// about a shared centroid. What it was told a group IS came from `groupKeyOf`:
//
//     (p.planeId ?? p.layoutId ?? p.id)
//
// and `placeGroundArrayRow` stamps `layoutId: `ground-row-${Date.now()}`` — a fresh id PER ROW. So
// a two-row mount was two groups, one row selected at a time, and a drag moved one row out of its
// own array. `arrayId` is the assembly, and it is now preferred for ground panels.
//
// WHAT THIS FILE PROVES: the arithmetic of the assembly edits, without a viewer. The USER-FACING
// behaviour — click selects the whole mount, drag moves both rows rigidly, rotate turns them about
// one origin, two mounts stay independent — is proved in the browser by
// e2e/ground-mount-is-one-object.spec.ts, because Ray's live report outranks these tests and a
// source assertion cannot stand in for it.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assemblyPanels, assemblyIds, assemblyFrame, metresBetween,
  translateAssembly, rotateAssembly, setAssemblyAzimuth,
  setAssemblyRowPitch, setAssemblyTilt, duplicateAssembly,
  removeAssembly, replaceAssembly, spanAlongRails,
} from '@/lib/3d/groundMountAssembly';
import type { PlacedPanel } from '@/types';

const ROOT = join(__dirname, '..');
const MPD = 111_320;
const SITE = { lat: 39.7817, lng: -89.6501 };
const TILT = 20;
const PANEL_W = 1.134, PANEL_H = 1.722;

/** A ground mount as the placement flow now commits it: one arrayId, rows stamped, on the grid. */
function mount(arrayId: string, rows: number, cols: number, over: Partial<PlacedPanel> = {}): PlacedPanel[] {
  const t = TILT * Math.PI / 180;
  const rowDepth = PANEL_H * Math.cos(t);
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const out: PlacedPanel[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nsM = r * rowDepth + rowDepth / 2;
      const ewM = c * PANEL_W + PANEL_W / 2;
      out.push({
        id: `${arrayId}-p${r}-${c}`,
        lat: SITE.lat + nsM / MPD,
        lng: SITE.lng + ewM / (MPD * cosLat),
        height: 200.6096 + nsM * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65,
        tilt: TILT, azimuth: 180,
        row: r, col: c, arrayRow: r,
        arrayId,
        systemType: 'ground',
        orientation: 'portrait',
        wattage: 440,
        heading: 0, pitch: -(TILT * Math.PI / 180), roll: 0,
        ...over,
      } as PlacedPanel);
    }
  }
  return out;
}

/** A roof panel, to prove the ground rules do not leak. */
const roofPanel = (id: string): PlacedPanel => ({
  id, lat: SITE.lat, lng: SITE.lng, height: 210,
  widthFeet: 3.72, heightFeet: 5.65, tilt: 25, azimuth: 180,
  row: 0, col: 0, systemType: 'roof',
} as PlacedPanel);

/** Every pairwise distance within the assembly — the thing a rigid move must not change. */
function shape(members: PlacedPanel[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) out.push(metresBetween(members[i], members[j]));
  }
  return out;
}
const shapeUnchanged = (a: PlacedPanel[], b: PlacedPanel[], tolM = 0.001) => {
  const sa = shape(a), sb = shape(b);
  expect(sb.length).toBe(sa.length);
  sa.forEach((d, i) => {
    expect(Math.abs(sb[i] - d),
      `pairwise distance ${i} changed by ${((sb[i] - d) * 1000).toFixed(2)} mm — not rigid`)
      .toBeLessThan(tolM);
  });
};

describe('🚨 the group a ground panel belongs to is its ASSEMBLY, not its row', () => {
  it('🚨 groupKeyOf prefers arrayId for a ground panel', () => {
    // The one-line defect, asserted on the source because the function is component-private.
    // Comments are stripped, so the explanation above it cannot satisfy the check.
    const src = readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const at = src.indexOf('const groupKeyOf =');
    expect(at, 'groupKeyOf is gone — the selection grouping moved and this suite is stale')
      .toBeGreaterThan(-1);
    const body = src.slice(at, at + 400);
    expect(body, 'a ground panel is still grouped by its per-row layoutId')
      .toMatch(/systemType === 'ground' && p\.arrayId/);
    // And roof/fence must keep their own keys — this was scoped deliberately.
    expect(body).toMatch(/planeId/);
    expect(body).toMatch(/layoutId/);
  });

  it('two mounts on one site are two assemblies', () => {
    const all = [...mount('ga-A', 2, 4), ...mount('ga-B', 2, 3), roofPanel('roof-1')];
    expect(assemblyIds(all)).toEqual(['ga-A', 'ga-B']);
    expect(assemblyPanels(all, 'ga-A')).toHaveLength(8);
    expect(assemblyPanels(all, 'ga-B')).toHaveLength(6);
    // The roof panel is in neither.
    expect(assemblyPanels(all, 'ga-A').some(p => p.id === 'roof-1')).toBe(false);
  });

  it('the frame is read off the panels: anchor, azimuth, tilt, rows, pitch', () => {
    const f = assemblyFrame(mount('ga-A', 3, 4))!;
    expect(f.anchor.id).toBe('ga-A-p0-0');           // lowest row, then lowest col
    expect(f.azimuthDeg).toBe(180);
    expect(f.tiltDeg).toBe(TILT);
    expect(f.rows).toEqual([0, 1, 2]);
    // Grid pitch is panelH x cos(tilt).
    expect(f.rowPitchM!).toBeCloseTo(PANEL_H * Math.cos(TILT * Math.PI / 180), 3);
  });
});

describe('🚨 MOVE translates the whole assembly rigidly', () => {
  it('🚨 every module shifts by the same delta and row-relative positions do not change', () => {
    // Ray: "Move must translate the entire assembly rigidly. Row-relative positions must not
    // change."
    const before = mount('ga-A', 2, 4);
    const after = translateAssembly(before, 12, -7);
    shapeUnchanged(before, after);
    // And it really moved — otherwise "rigid" would be satisfied by doing nothing.
    const moved = metresBetween(before[0], after[0]);
    expect(moved).toBeGreaterThan(13);
    expect(moved).toBeCloseTo(Math.hypot(12, 7), 1);
  });

  it('every member moves — not just the row that was clicked', () => {
    const before = mount('ga-A', 3, 3);
    const after = translateAssembly(before, 5, 5);
    for (let i = 0; i < before.length; i++) {
      expect(metresBetween(before[i], after[i]),
        `${before[i].id} did not move with the assembly`).toBeGreaterThan(6);
    }
  });

  it('tilt, azimuth and height are untouched by a move', () => {
    const after = translateAssembly(mount('ga-A', 2, 3), 9, 9);
    for (const p of after) {
      expect(p.tilt).toBe(TILT);
      expect(p.azimuth).toBe(180);
    }
    expect(after[0].height).toBeCloseTo(mount('ga-A', 2, 3)[0].height!, 6);
  });
});

describe('🚨 ROTATE turns both rows about the SAME parent origin', () => {
  it('🚨 the shape is preserved and the anchor is the pivot', () => {
    // Ray: "PASS only if both rows rotate around the same parent origin."
    const before = mount('ga-A', 2, 4);
    const after = rotateAssembly(before, 30);
    shapeUnchanged(before, after, 0.01);
    // The anchor does not move: it IS the pivot.
    const a0 = before.find(p => p.id === 'ga-A-p0-0')!;
    const a1 = after.find(p => p.id === 'ga-A-p0-0')!;
    expect(metresBetween(a0, a1), 'the pivot itself moved').toBeLessThan(0.001);
    // Everything else does.
    const far0 = before.find(p => p.id === 'ga-A-p1-3')!;
    const far1 = after.find(p => p.id === 'ga-A-p1-3')!;
    expect(metresBetween(far0, far1), 'the far corner did not turn').toBeGreaterThan(0.5);
  });

  it('🚨 the modules turn with the structure — azimuth advances by the same delta', () => {
    const after = rotateAssembly(mount('ga-A', 2, 3), 45);
    for (const p of after) expect(p.azimuth).toBe(225);
    // A rotation that leaves the modules facing the old way would draw them across the rails.
    expect(after.every(p => typeof p.heading === 'number')).toBe(true);
  });

  it('rotating by an absolute azimuth lands on that azimuth, the short way round', () => {
    const after = setAssemblyAzimuth(mount('ga-A', 2, 3), 170);
    for (const p of after) expect(p.azimuth).toBe(170);
    shapeUnchanged(mount('ga-A', 2, 3), after, 0.01);
    // 350 -> 10 must turn 20 degrees, not 340.
    const wrapped = setAssemblyAzimuth(mount('ga-A', 1, 2, { azimuth: 350 }), 10);
    for (const p of wrapped) expect(p.azimuth).toBe(10);
  });

  it('a full turn returns to the start', () => {
    const before = mount('ga-A', 2, 3);
    let after = before;
    for (let i = 0; i < 4; i++) after = rotateAssembly(after, 90);
    for (let i = 0; i < before.length; i++) {
      expect(metresBetween(before[i], after[i]),
        `${before[i].id} drifted over four 90 degree turns`).toBeLessThan(0.01);
    }
  });
});

describe('🚨 ROW PITCH moves the rows behind the datum, and only those', () => {
  it('row 0 holds still and row 1 moves back by the delta', () => {
    const before = mount('ga-A', 2, 4);
    const f0 = assemblyFrame(before)!;
    const after = setAssemblyRowPitch(before, f0.rowPitchM! + 1.5);
    const lead0Before = before.find(p => p.id === 'ga-A-p0-0')!;
    const lead0After = after.find(p => p.id === 'ga-A-p0-0')!;
    expect(metresBetween(lead0Before, lead0After), 'the datum row moved').toBeLessThan(0.001);
    expect(assemblyFrame(after)!.rowPitchM!).toBeCloseTo(f0.rowPitchM! + 1.5, 3);
  });

  it('a row keeps its own internal spacing — the row does not stretch', () => {
    const before = mount('ga-A', 2, 4);
    const after = setAssemblyRowPitch(before, 4);
    for (const r of [0, 1]) {
      const rowBefore = before.filter(p => p.arrayRow === r);
      const rowAfter = after.filter(p => p.arrayRow === r);
      shapeUnchanged(rowBefore, rowAfter);
    }
  });

  it('a single-row mount and a non-positive pitch are refused, not mangled', () => {
    const one = mount('ga-A', 1, 4);
    expect(setAssemblyRowPitch(one, 5)).toEqual(one);
    const two = mount('ga-A', 2, 4);
    expect(setAssemblyRowPitch(two, 0)).toEqual(two);
    expect(setAssemblyRowPitch(two, -3)).toEqual(two);
  });
});

describe('🚨 TILT changes the angle and the heights together', () => {
  it('every module takes the new tilt, and pitch follows it', () => {
    // They are the same fact twice; a mismatch draws a module at an angle it is not built at.
    const after = setAssemblyTilt(mount('ga-A', 2, 3), 35);
    for (const p of after) {
      expect(p.tilt).toBe(35);
      expect(p.pitch).toBeCloseTo(-(35 * Math.PI / 180), 6);
    }
  });

  it('🚨 the back row is re-lifted and the front row is the datum', () => {
    const before = mount('ga-A', 2, 4);
    const datum = before.find(p => p.id === 'ga-A-p0-0')!.height!;
    const after = setAssemblyTilt(before, 35);
    const front = after.filter(p => p.arrayRow === 0);
    const back = after.filter(p => p.arrayRow === 1);
    for (const p of front) expect(p.height).toBeCloseTo(datum, 6);
    const pitchM = assemblyFrame(before)!.rowPitchM!;
    for (const p of back) {
      expect(p.height).toBeCloseTo(datum + pitchM * Math.tan(35 * Math.PI / 180), 4);
      expect(p.height!, 'a steeper tilt did not raise the back row').toBeGreaterThan(datum);
    }
  });

  it('an impossible tilt is refused', () => {
    const before = mount('ga-A', 2, 3);
    expect(setAssemblyTilt(before, -5)).toEqual(before);
    expect(setAssemblyTilt(before, 95)).toEqual(before);
  });
});

describe('🚨 DUPLICATE makes a SECOND assembly, not a bigger one', () => {
  it('🚨 the copy has a new arrayId and new module ids', () => {
    // Sharing the id would make the copy and the original one assembly, so selecting either
    // would select both — the exact defect this work removes.
    const original = mount('ga-A', 2, 3);
    const copy = duplicateAssembly(original, 'ga-B');
    expect(copy).toHaveLength(original.length);
    expect(new Set(copy.map(p => p.arrayId))).toEqual(new Set(['ga-B']));
    expect(copy.some(p => original.some(o => o.id === p.id)), 'a module id was reused').toBe(false);
  });

  it('the copy is the same shape, offset clear of the original', () => {
    const original = mount('ga-A', 2, 4);
    const copy = duplicateAssembly(original, 'ga-B');
    shapeUnchanged(original, copy, 0.01);
    const gap = metresBetween(original[0], copy[0]);
    expect(gap, 'the copy landed on top of the original')
      .toBeGreaterThan(spanAlongRails(original));
  });

  it('and the two are independently addressable afterwards', () => {
    const original = mount('ga-A', 2, 3);
    const all = replaceAssembly(original, 'ga-A', [...original, ...duplicateAssembly(original, 'ga-B')]);
    expect(assemblyIds(all)).toEqual(['ga-A', 'ga-B']);
    // Moving A must not move B — the live requirement, in arithmetic.
    const aBefore = assemblyPanels(all, 'ga-A');
    const bBefore = assemblyPanels(all, 'ga-B');
    const moved = replaceAssembly(all, 'ga-A', translateAssembly(aBefore, 20, 0));
    const bAfter = assemblyPanels(moved, 'ga-B');
    for (let i = 0; i < bBefore.length; i++) {
      expect(metresBetween(bBefore[i], bAfter[i]),
        `moving assembly A moved ${bBefore[i].id} of assembly B`).toBeLessThan(0.001);
    }
    expect(metresBetween(aBefore[0], assemblyPanels(moved, 'ga-A')[0])).toBeGreaterThan(19);
  });
});

describe('🚨 DELETE removes one assembly and nothing else', () => {
  it('the other mount and the roof panels survive', () => {
    const all = [...mount('ga-A', 2, 3), ...mount('ga-B', 2, 2), roofPanel('roof-1')];
    const left = removeAssembly(all, 'ga-A');
    expect(assemblyIds(left)).toEqual(['ga-B']);
    expect(left.some(p => p.id === 'roof-1')).toBe(true);
    expect(left).toHaveLength(4 + 1);
  });
});

describe('the ground rules do not leak onto roof or fence panels', () => {
  it('a roof panel is never part of an assembly, even carrying an arrayId', () => {
    const odd = { ...roofPanel('roof-2'), arrayId: 'ga-A' } as PlacedPanel;
    expect(assemblyPanels([...mount('ga-A', 1, 2), odd], 'ga-A').some(p => p.id === 'roof-2'))
      .toBe(false);
  });

  it('a ground panel with no arrayId is in no assembly — not merged on a guess', () => {
    // Placed before the id was written. Grouping it with a neighbour would silently join two
    // physically separate mounts.
    const legacy = mount('x', 2, 2).map(p => ({ ...p, arrayId: undefined })) as PlacedPanel[];
    expect(assemblyIds(legacy)).toEqual([]);
  });
});
