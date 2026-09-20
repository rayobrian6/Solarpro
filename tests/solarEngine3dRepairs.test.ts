/**
 * tests/solarEngine3dRepairs.test.ts
 *
 * Regression tests for the four defects repaired in
 * components/3d/SolarEngine3D.tsx after the 56-commit 3D/Aurora drop.
 *
 * Almost nothing in SolarEngine3D is reachable from a jsdom unit test — it is
 * a 12k-line Cesium canvas component — so these tests target the pure helpers
 * that were extracted out of the broken code paths, plus two source-level
 * assertions for the defects that genuinely have no pure surface (a wrong
 * Cesium constructor name, and byte-level string corruption).
 *
 * Defects covered:
 *   A  `new C.ConstantPosition(...)` — not a Cesium symbol; Lift/Flatten Roofs
 *      threw the moment it ran.
 *   B  liDARGetElevationAt ignored its lat/lng and full-sorted the whole cloud.
 *   C  the Block line-trace tool orphaned a Cesium point entity per vertex per
 *      click.
 *   D  44 distinct mojibake atoms (UTF-8 re-encoded through CP1252).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildLiDARPointGrid,
  elevationAtFromGrid,
  removeBlockPreviewEntity,
} from '@/components/3d/SolarEngine3D';

const SOURCE_PATH = path.resolve(__dirname, '../components/3d/SolarEngine3D.tsx');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

// ─── B: LiDAR elevation lookup is actually spatial ──────────────────────────

/**
 * Two flat-topped clusters 50 m apart in the dataset's local ENU frame:
 * a low one at the origin (z ≈ 10 m) and a tall one at x = 50 (z ≈ 30 m),
 * plus a scatter of low ground returns between them.
 *
 * The pre-fix adapter returned the mean of the 25 highest Z values in the
 * WHOLE cloud regardless of where you asked, so both clusters answered ~30.
 */
function twoClusterCloud() {
  const pts: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 60; i++) {
    pts.push({ x: (i % 10) * 0.1 - 0.45, y: Math.floor(i / 10) * 0.1 - 0.25, z: 10 });
  }
  for (let i = 0; i < 60; i++) {
    pts.push({ x: 50 + (i % 10) * 0.1 - 0.45, y: Math.floor(i / 10) * 0.1 - 0.25, z: 30 });
  }
  for (let i = 0; i < 200; i++) {
    pts.push({ x: 5 + i * 0.2, y: 20, z: 1 });
  }
  return pts;
}

/**
 * The adapter exactly as it stood before the repair, kept here as the
 * characterization of the bug. If someone reintroduces it, the contrast
 * assertions below are the ones that will break.
 */
function legacyElevationAt(points: Array<{ x: number; y: number; z: number }>, _x: number, _y: number) {
  const zs: number[] = [];
  for (const p of points) {
    const dx = (p.x ?? 0) - _x;
    const dy = (p.y ?? 0) - _y;
    void dx; void dy;
    zs.push(p.z ?? 0);
  }
  zs.sort((a, b) => b - a);
  const K = Math.min(25, zs.length);
  let sum = 0;
  for (let i = 0; i < K; i++) sum += zs[i];
  return sum / K;
}

describe('B — LiDAR elevation lookup is a real spatial query', () => {
  it('returns the elevation of the cluster under the query point, not the tallest in the scan', () => {
    const pts = twoClusterCloud();
    const grid = buildLiDARPointGrid(pts);
    expect(grid).not.toBeNull();

    const atLow = elevationAtFromGrid(grid, 0, 0);
    const atTall = elevationAtFromGrid(grid, 50, 0);

    expect(atLow).toBeCloseTo(10, 6);
    expect(atTall).toBeCloseTo(30, 6);
    // The whole point of the defect: these two must differ.
    expect(atLow).not.toBeCloseTo(atTall as number, 3);
  });

  it('the pre-fix algorithm answered identically everywhere (characterization)', () => {
    const pts = twoClusterCloud();
    expect(legacyElevationAt(pts, 0, 0)).toBe(legacyElevationAt(pts, 50, 0));
    // ...and it answered 30 over the 10 m cluster.
    expect(legacyElevationAt(pts, 0, 0)).toBeCloseTo(30, 6);
  });

  it('answers null where the scan has no coverage, so roofActions leaves that segment alone', () => {
    const grid = buildLiDARPointGrid(twoClusterCloud());
    expect(elevationAtFromGrid(grid, 500, 500)).toBeNull();
  });

  it('averages the highest K returns inside the radius, ignoring ground seen through the eaves', () => {
    // 30 roof returns at z = 8 directly under the query, 30 ground returns at
    // z = 0 beside them but still inside the 2 m radius.
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < 30; i++) pts.push({ x: 0.01 * i, y: 0, z: 8 });
    for (let i = 0; i < 30; i++) pts.push({ x: 0.01 * i, y: 1.5, z: 0 });
    const grid = buildLiDARPointGrid(pts);
    expect(elevationAtFromGrid(grid, 0, 0)).toBeCloseTo(8, 6);
  });

  it('honours an explicit radius', () => {
    const pts = [
      { x: 0, y: 0, z: 5 },
      { x: 10, y: 0, z: 50 },
    ];
    const grid = buildLiDARPointGrid(pts);
    expect(elevationAtFromGrid(grid, 0, 0, { radiusM: 1 })).toBeCloseTo(5, 6);
    expect(elevationAtFromGrid(grid, 0, 0, { radiusM: 20, topK: 1 })).toBeCloseTo(50, 6);
  });

  it('builds no grid for an empty cloud and queries it safely', () => {
    expect(buildLiDARPointGrid([])).toBeNull();
    expect(elevationAtFromGrid(null, 0, 0)).toBeNull();
  });

  it('does not sort the point array it is given (the old code sorted a 500k-entry copy per call)', () => {
    const pts = twoClusterCloud();
    const order = pts.map(p => p.z);
    const grid = buildLiDARPointGrid(pts);
    elevationAtFromGrid(grid, 0, 0);
    elevationAtFromGrid(grid, 50, 0);
    expect(pts.map(p => p.z)).toEqual(order);
  });
});

// ─── C: block preview dots are removed with their polyline ──────────────────

function fakeViewer() {
  const removed: any[] = [];
  return {
    removed,
    entities: {
      remove(e: any) { removed.push(e); return true; },
    },
  };
}

describe('C — the block line-trace preview takes its vertex dots with it', () => {
  it('removes every dot hung off the preview, then the preview itself', () => {
    const viewer = fakeViewer();
    const dots = [{ id: 'dot-0' }, { id: 'dot-1' }, { id: 'dot-2' }];
    const preview: any = { id: 'block-preview-1', __dots: dots };

    removeBlockPreviewEntity(viewer, preview);

    expect(viewer.removed).toEqual([...dots, preview]);
    // The list is cleared so a double-removal cannot re-enter the viewer.
    expect(preview.__dots).toBeUndefined();
  });

  it('leaves nothing behind across a five-click trace (the leak was quadratic)', () => {
    const viewer = fakeViewer();
    const live = new Set<any>();
    const add = (e: any) => { live.add(e); return e; };
    const origRemove = viewer.entities.remove.bind(viewer.entities);
    viewer.entities.remove = (e: any) => { live.delete(e); return origRemove(e); };

    let preview: any = null;
    const pts: number[] = [];
    for (let click = 1; click <= 5; click++) {
      pts.push(click);
      if (preview) { removeBlockPreviewEntity(viewer, preview); preview = null; }
      if (pts.length >= 2) {
        preview = add({ id: `block-preview-${click}` });
        // handleBlockClick re-adds a dot for EVERY collected point, every click.
        preview.__dots = pts.map((_, i) => add({ id: `dot-${click}-${i}` }));
      }
    }
    // Finalize.
    removeBlockPreviewEntity(viewer, preview);

    expect(live.size).toBe(0);
  });

  it('is a no-op on a null preview and survives a viewer that throws', () => {
    expect(() => removeBlockPreviewEntity(null, null)).not.toThrow();
    const angry = { entities: { remove() { throw new Error('scene torn down'); } } };
    expect(() => removeBlockPreviewEntity(angry, { __dots: [{}] })).not.toThrow();
  });
});

// ─── A: the Cesium position property name actually exists ───────────────────

describe('A — Lift/Flatten Roofs uses a real Cesium constructor', () => {
  // 🚨 EXPLICIT 60s TIMEOUT. This is the only test in the suite that imports
  // the whole of Cesium, which is tens of megabytes of ESM. Alone it takes ~2s;
  // inside the full run, competing with two other workers, it has taken 23s and
  // blown the 10s default — a red CI on a commit that changed nothing near it.
  // A flaky gate is worse than a slow one: it trains people to re-run rather
  // than read. The assertion is not slow; the import is.
  it('ConstantPosition is not a Cesium symbol; ConstantPositionProperty is', async () => {
    const Cesium: any = await import('cesium');
    expect(Cesium.ConstantPosition).toBeUndefined();
    expect(typeof Cesium.ConstantPositionProperty).toBe('function');
  }, 60_000);

  it('SolarEngine3D never constructs C.ConstantPosition', () => {
    expect(SOURCE).not.toMatch(/new\s+C\.ConstantPosition\s*\(/);
    expect(SOURCE).toMatch(/new\s+C\.ConstantPositionProperty\s*\(/);
  });
});

// ─── D: no mojibake left in the source ──────────────────────────────────────

/**
 * A mojibake atom is a run of characters that, mapped back through CP1252 to
 * bytes, decodes as valid multi-byte UTF-8 — i.e. text that was encoded once
 * as UTF-8 and then re-encoded as if it had been CP1252.
 */
const CP1252_HIGH: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

function findMojibake(src: string): string[] {
  const toByte = (cp: number) => (cp <= 0xFF ? cp : CP1252_HIGH[cp]);
  const hits: string[] = [];
  let i = 0;
  while (i < src.length) {
    const cp = src.codePointAt(i)!;
    const b = toByte(cp);
    if (b !== undefined && b >= 0x80) {
      let j = i;
      const bytes: number[] = [];
      while (j < src.length) {
        const c2 = src.codePointAt(j)!;
        const b2 = toByte(c2);
        if (b2 === undefined || b2 < 0x80) break;
        bytes.push(b2);
        j += String.fromCodePoint(c2).length;
      }
      const decoded = Buffer.from(bytes).toString('utf8');
      // A run of length 1 can only be a legitimate Latin-1 character
      // (°, ², ×, ·) — it never decodes as multi-byte UTF-8.
      if (bytes.length > 1 && !decoded.includes('�')) {
        hits.push(`${src.slice(i, j)} -> ${decoded}`);
      }
      i = j;
    } else {
      i += String.fromCodePoint(cp).length;
    }
  }
  return hits;
}

describe('D — SolarEngine3D carries no CP1252-mangled text', () => {
  it('has zero mojibake atoms anywhere in the file', () => {
    expect(findMojibake(SOURCE)).toEqual([]);
  });

  it('still carries the glyphs those atoms decode to, so nothing was merely deleted', () => {
    for (const glyph of ['⤴', '⤓', '─', '—', '→', '·', '≈', '✅', '❌', '🧱', '📐', '⏳', '🏠']) {
      expect(SOURCE).toContain(glyph);
    }
  });

  it('holds no stray C1 control characters (U+0080..U+009F), the tell of a half-repair', () => {
    expect(SOURCE).not.toMatch(/[-]/);
  });

  it('self-check: the detector fires on known mojibake', () => {
    expect(findMojibake('status: â€” done')).toHaveLength(1);
    // ...and does not fire on legitimate Latin-1 or on clean UTF-8.
    expect(findMojibake('-45° tilt, 12 m², 3 × 4')).toEqual([]);
    expect(findMojibake('clean — em dash ─ box → arrow')).toEqual([]);
  });
});
