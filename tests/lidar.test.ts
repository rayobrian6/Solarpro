/**
 * tests/lidar.test.ts
 *
 * Pure unit tests for the LiDAR integration slice. No Cesium, no DOM, no
 * React — just math + the LAS binary parser.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIDAR_STATE,
  METERS_PER_FOOT,
  FEET_PER_METER,
  type LiDARDataset,
  type LiDARPoint,
  elevationColor,
  elevationColorAlpha,
  hslToRgba,
  normalizeElevation,
  applyOffset,
  offsetPoint,
  clampOffset,
  parseLAS,
  buildMesh,
  loadLiDARFromBuffer,
  liftRoofs,
  flattenRoofs,
} from '@/lib/3d/lidar';

// ─── LAS parser test helpers ────────────────────────────────────────────

function writeLAS12Header(opts: {
  pointDataFormatId?: number;
  pointDataRecordLength?: number;
  numPointRecords?: number;
  pointOffset?: number;
  xScale?: number;
  yScale?: number;
  zScale?: number;
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(227);
  const view = new DataView(buf);
  view.setUint8(0, 0x4c); // L
  view.setUint8(1, 0x41); // A
  view.setUint8(2, 0x53); // S
  view.setUint8(3, 0x46); // F
  view.setUint8(24, 1);
  view.setUint8(25, 2);
  view.setUint16(94, 227, true);
  view.setUint32(96, opts.pointOffset ?? 227, true);   // offset to point data
  view.setUint8(104, opts.pointDataFormatId ?? 0);
  view.setUint16(105, opts.pointDataRecordLength ?? 20, true);
  view.setUint32(107, opts.numPointRecords ?? 0, true);
  view.setFloat64(131, opts.xScale ?? 0.01, true);
  view.setFloat64(139, opts.yScale ?? 0.01, true);
  view.setFloat64(147, opts.zScale ?? 0.01, true);
  view.setFloat64(155, opts.xOffset ?? 0, true);
  view.setFloat64(163, opts.yOffset ?? 0, true);
  view.setFloat64(171, opts.zOffset ?? 0, true);
  view.setFloat64(179,  1e7, true);
  view.setFloat64(187, -1e7, true);
  view.setFloat64(195,  1e7, true);
  view.setFloat64(203, -1e7, true);
  view.setFloat64(211,  1e6, true);
  view.setFloat64(219, -1e6, true);
  return buf;
}

function appendPoint(
  bytes: Uint8Array,
  format: number,
  startOffset: number,
  X: number, Y: number, Z: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = startOffset;
  view.setInt32(o + 0, X, true);
  view.setInt32(o + 4, Y, true);
  view.setInt32(o + 8, Z, true);
  view.setUint16(o + 12, 100, true);
  view.setUint8(o + 14, 0x11);
  view.setUint8(o + 15, 2);
  // GPS time only on formats 1 and 3
  if (format === 1 || format === 3) {
    view.setFloat64(o + 20, 12345.678, true);
  }
  // RGB on formats 2 and 3. Format 2: offset 20. Format 3: offset 28.
  if (format === 2 || format === 3) {
    const rgbOffset = format === 2 ? o + 20 : o + 28;
    view.setUint16(rgbOffset + 0, 100 * 256, true);
    view.setUint16(rgbOffset + 2, 200 * 256, true);
    view.setUint16(rgbOffset + 4, 50  * 256, true);
  }
}

function buildLAS12(numPoints: number, format: 0 | 1 | 2 | 3 = 0): Uint8Array {
  const pointSize = format === 0 ? 20 : format === 1 ? 28 : format === 2 ? 26 : 34;
  const buf = new ArrayBuffer(227 + numPoints * pointSize);
  const header = new Uint8Array(buf, 0, 227);
  const headerBuf = writeLAS12Header({
    pointDataFormatId: format,
    pointDataRecordLength: pointSize,
    numPointRecords: numPoints,
  });
  header.set(new Uint8Array(headerBuf), 0);
  const out = new Uint8Array(buf);
  for (let i = 0; i < numPoints; i++) {
    appendPoint(out, format, 227 + i * pointSize, i * 10, i * 5, i * 2);
  }
  return out;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('lib/3d/lidar — types', () => {
  it('DEFAULT_LIDAR_STATE has the right shape', () => {
    expect(DEFAULT_LIDAR_STATE.dataset).toBeNull();
    expect(DEFAULT_LIDAR_STATE.style).toBe('mesh');
    expect(DEFAULT_LIDAR_STATE.textured).toBe(true);
    expect(DEFAULT_LIDAR_STATE.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(DEFAULT_LIDAR_STATE.isLoading).toBe(false);
    expect(DEFAULT_LIDAR_STATE.error).toBeNull();
  });
  it('METERS_PER_FOOT and FEET_PER_METER are reciprocals', () => {
    expect(METERS_PER_FOOT).toBeCloseTo(0.3048, 6);
    expect(FEET_PER_METER).toBeCloseTo(1 / 0.3048, 4);
    expect(METERS_PER_FOOT * FEET_PER_METER).toBeCloseTo(1, 10);
  });
});

describe('lib/3d/lidar/colorRamp — elevationColor', () => {
  it('t=0 is blue (high B, low R/G)', () => {
    const c = elevationColor(0);
    expect(c.b).toBeGreaterThan(c.r);
    expect(c.b).toBeGreaterThan(c.g);
    expect(c.r).toBeLessThan(0.1);
    expect(c.a).toBe(1);
  });
  it('t=1 is red (high R, low G/B)', () => {
    const c = elevationColor(1);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.b);
    expect(c.b).toBeLessThan(0.1);
  });
  it('t=0.5 is green-ish (G dominates)', () => {
    const c = elevationColor(0.5);
    expect(c.g).toBeGreaterThan(c.r);
    expect(c.g).toBeGreaterThan(c.b);
  });
  it('clamps t<0 and t>1', () => {
    expect(elevationColor(-0.5)).toEqual(elevationColor(0));
    expect(elevationColor(1.5)).toEqual(elevationColor(1));
  });
  it('elevationColorAlpha respects custom alpha', () => {
    const c = elevationColorAlpha(0.5, 0.3);
    expect(c.a).toBeCloseTo(0.3, 6);
  });
  it('hslToRgba: S=0 gives grey', () => {
    const c = hslToRgba(0, 0, 0.5);
    expect(c.r).toBeCloseTo(0.5, 6);
    expect(c.g).toBeCloseTo(0.5, 6);
    expect(c.b).toBeCloseTo(0.5, 6);
  });
  it('normalizeElevation: midpoint for equal min/max', () => {
    expect(normalizeElevation(5, 5, 5)).toBe(0.5);
  });
  it('normalizeElevation: clamps out-of-range', () => {
    expect(normalizeElevation(-100, 0, 10)).toBe(0);
    expect(normalizeElevation(100, 0, 10)).toBe(1);
  });
  it('normalizeElevation: handles NaN inputs safely', () => {
    expect(normalizeElevation(NaN, 0, 10)).toBe(0.5);
    expect(normalizeElevation(5, NaN, 10)).toBe(0.5);
    expect(normalizeElevation(5, 0, NaN)).toBe(0.5);
  });
});

describe('lib/3d/lidar/offsetTransform', () => {
  const ds: LiDARDataset = {
    source: 'test',
    centroidLat: 38.8, centroidLng: -77.0,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 20, z: 5 },
    ],
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 20, minZ: 0, maxZ: 5 },
    count: 2,
    crs: 'local-enu',
  };

  it('1 ft X offset shifts the point east by 0.3048 m exactly', () => {
    const p = offsetPoint({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(METERS_PER_FOOT, 10);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });
  it('1 ft Y offset shifts the point north by 0.3048 m', () => {
    const p = offsetPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(p.y).toBeCloseTo(METERS_PER_FOOT, 10);
  });
  it('1 ft Z offset shifts the point up by 0.3048 m', () => {
    const p = offsetPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(p.z).toBeCloseTo(METERS_PER_FOOT, 10);
  });
  it('combines all three axes', () => {
    const p = offsetPoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 });
    expect(p.x).toBeCloseTo(2 * METERS_PER_FOOT, 10);
    expect(p.y).toBeCloseTo(3 * METERS_PER_FOOT, 10);
    expect(p.z).toBeCloseTo(4 * METERS_PER_FOOT, 10);
  });
  it('applyOffset on empty array returns empty dataset', () => {
    const empty: LiDARDataset = { ...ds, points: [], count: 0 };
    const out = applyOffset(empty, { x: 1, y: 1, z: 1 });
    expect(out.points).toEqual([]);
  });
  it('applyOffset with zero offset returns the same dataset reference', () => {
    const out = applyOffset(ds, { x: 0, y: 0, z: 0 });
    expect(out).toBe(ds);
  });
  it('applyOffset recomputes bounds', () => {
    const out = applyOffset(ds, { x: 10, y: 20, z: 30 });
    const shift = 10 * METERS_PER_FOOT;
    expect(out.bounds.minX).toBeCloseTo(0 + shift, 10);
    expect(out.bounds.maxX).toBeCloseTo(10 + shift, 10);
    expect(out.bounds.minZ).toBeCloseTo(0 + 30 * METERS_PER_FOOT, 10);
  });
  it('applyOffset does not mutate the input dataset', () => {
    const before = ds.points[0].x;
    applyOffset(ds, { x: 100, y: 0, z: 0 });
    expect(ds.points[0].x).toBe(before);
  });
  it('clampOffset bounds at ±100 ft', () => {
    expect(clampOffset({ x: 999, y: -999, z: 50 })).toEqual({ x: 100, y: -100, z: 50 });
  });
});

describe('lib/3d/lidar/lasParser', () => {
  it('rejects files smaller than 227 bytes', () => {
    const r = parseLAS(new Uint8Array(100));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect((r as { ok: false; error: string }).error).toMatch(/too small/i);
  });
  it('rejects bad signature', () => {
    const buf = new Uint8Array(227);
    const r = parseLAS(buf);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect((r as { ok: false; error: string }).error).toMatch(/not a LAS/i);
  });
  it('parses a 100-point LAS 1.2 file (format 0)', () => {
    const bytes = buildLAS12(100, 0);
    const r = parseLAS(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dataset.count).toBe(100);
      expect(r.dataset.bounds.maxX).toBeCloseTo(9.9, 1);
      expect(r.dataset.bounds.maxY).toBeCloseTo(4.95, 1);
    }
  });
  it('parses a 50-point LAS 1.2 file (format 1, with GPS time)', () => {
    const r = parseLAS(buildLAS12(50, 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.count).toBe(50);
  });
  it('parses a 50-point LAS 1.2 file (format 2, with RGB)', () => {
    const r = parseLAS(buildLAS12(50, 2));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p0 = r.dataset.points[0];
      expect(p0.r).toBe(100);
      expect(p0.g).toBe(200);
      expect(p0.b).toBe(50);
    }
  });
  it('parses a 50-point LAS 1.2 file (format 3, GPS + RGB)', () => {
    const r = parseLAS(buildLAS12(50, 3));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.count).toBe(50);
  });
  it('rejects unsupported point data format (e.g. 6 — waveform)', () => {
    const bytes = buildLAS12(1, 0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    dv.setUint8(104, 6);
    const r = parseLAS(bytes);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect((r as { ok: false; error: string }).error).toMatch(/format 6/i);
  });
  it('sub-samples to maxPoints', () => {
    const bytes = buildLAS12(10_000, 0);
    const r = parseLAS(bytes, { maxPoints: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.count).toBeLessThanOrEqual(100);
  });
  it('handles truncated files gracefully', () => {
    const bytes = buildLAS12(100, 0);
    const truncated = bytes.slice(0, 227 + 50 * 20);
    const r = parseLAS(truncated);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.count).toBe(50);
  });
});

describe('lib/3d/lidar/meshBuilder', () => {
  function regularGrid(rows: number, cols: number, z = 10): LiDARPoint[] {
    const pts: LiDARPoint[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        pts.push({ x, y, z });
      }
    }
    return pts;
  }

  it('3×3 grid produces a 2×2-cell mesh', () => {
    const m = buildMesh(regularGrid(3, 3), { maxResolution: 10 });
    expect(m.width).toBe(2);
    expect(m.height).toBe(2);
  });
  it('vertex count = width × height', () => {
    const m = buildMesh(regularGrid(5, 5), { maxResolution: 10 });
    expect(m.vertices.length / 3).toBe(m.width * m.height);
    expect(m.colors.length / 4).toBe(m.width * m.height);
  });
  it('index count = (W-1) × (H-1) × 6', () => {
    const m = buildMesh(regularGrid(8, 6), { maxResolution: 10 });
    const expectedCells = (m.width - 1) * (m.height - 1);
    expect(m.indices.length).toBe(expectedCells * 6);
  });
  it('all-equal Z gives a constant mesh', () => {
    const m = buildMesh(regularGrid(5, 5, 7), { maxResolution: 10 });
    for (let i = 2; i < m.vertices.length; i += 3) {
      expect(m.vertices[i]).toBeCloseTo(7, 5);
    }
  });
  it('empty input returns an empty mesh', () => {
    const m = buildMesh([]);
    expect(m.width).toBe(0);
    expect(m.indices.length).toBe(0);
  });
  it('sparse data (1 point per 4 cells) has no NaN z', () => {
    const pts: LiDARPoint[] = [];
    for (let i = 0; i < 10; i++) pts.push({ x: i * 5, y: 0, z: 10 });
    const m = buildMesh(pts, { maxResolution: 8 });
    for (let i = 2; i < m.vertices.length; i += 3) {
      expect(Number.isFinite(m.vertices[i])).toBe(true);
    }
  });
  it('textured mode has lower alpha than raw mode', () => {
    const pts = regularGrid(4, 4, 10);
    const raw   = buildMesh(pts, { maxResolution: 8, alphaTextured: false });
    const tex   = buildMesh(pts, { maxResolution: 8, alphaTextured: true });
    expect(raw.colors[3]).toBeGreaterThan(tex.colors[3]);
  });
  it('mesh respects the input bounds', () => {
    const m = buildMesh(regularGrid(3, 3, 10), { maxResolution: 8 });
    expect(m.bounds.minX).toBeCloseTo(0, 5);
    expect(m.bounds.maxX).toBeCloseTo(2, 5);
    expect(m.bounds.minY).toBeCloseTo(0, 5);
    expect(m.bounds.maxY).toBeCloseTo(2, 5);
  });
});

describe('lib/3d/lidar/loadLiDAR', () => {
  it('loadLiDARFromBuffer stamps centroid and source', () => {
    const bytes = buildLAS12(10, 0);
    const copy = bytes.buffer.slice(0) as ArrayBuffer;
    const r = loadLiDARFromBuffer(copy, 'site.las', {
      centroidLat: 38.8, centroidLng: -77.0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dataset.source).toBe('site.las');
      expect(r.dataset.centroidLat).toBe(38.8);
      expect(r.dataset.centroidLng).toBe(-77.0);
    }
  });
  it('loadLiDARFromBuffer returns the parser error on bad input', () => {
    const r = loadLiDARFromBuffer(new ArrayBuffer(100), 'bad.las', {
      centroidLat: 0, centroidLng: 0,
    });
    expect(r.ok).toBe(false);
  });
  it('onLoadingChange fires true then false', () => {
    let loadingStates: boolean[] = [];
    const bytes = buildLAS12(10, 0);
    const copy = bytes.buffer.slice(0) as ArrayBuffer;
    loadLiDARFromBuffer(copy, 'x.las', {
      centroidLat: 0, centroidLng: 0,
      onLoadingChange: (b) => loadingStates.push(b),
    });
    expect(loadingStates).toEqual([true, false]);
  });
});

describe('lib/3d/lidar/liftRoofs', () => {
  function makeDataset(z: number, n = 100): LiDARDataset {
    const pts: LiDARPoint[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: i * 0.1, y: 0, z });
    return {
      source: 't', centroidLat: 0, centroidLng: 0,
      points: pts, count: pts.length, crs: 'local-enu',
      bounds: { minX: 0, maxX: n * 0.1, minY: 0, maxY: 0, minZ: z, maxZ: z },
    };
  }

  it('liftRoofs: 100 points at z=20 under a 10m×10m plane → 20m', () => {
    const ds = makeDataset(20);
    const planes = [{ id: 'p1', vertices: [{ lat: 0.0, lng: 0.0 }, { lat: 0.0, lng: 0.0001 }] }];
    const out = liftRoofs(ds, planes as any, { x: 0, y: 0, z: 0 });
    expect(out[0].planeHeightAtCenterMeters).toBeCloseTo(20, 1);
  });
  it('liftRoofs: no points under the plane → unchanged', () => {
    const ds = makeDataset(20, 0);
    const planes = [{ id: 'p1', vertices: [{ lat: 0, lng: 0 }], planeHeightAtCenterMeters: 5 }];
    const out = liftRoofs(ds, planes as any, { x: 0, y: 0, z: 0 });
    expect(out[0].planeHeightAtCenterMeters).toBe(5);
  });
  it('liftRoofs: empty roofPlanes → empty array', () => {
    const out = liftRoofs(makeDataset(20), [], { x: 0, y: 0, z: 0 });
    expect(out).toEqual([]);
  });
  it('flattenRoofs: uses median', () => {
    const ds = makeDataset(20, 100);
    const planes = [{ id: 'p1', vertices: [{ lat: 0, lng: 0 }, { lat: 0.0001, lng: 0.0001 }] }];
    const out = flattenRoofs(ds, planes as any, { x: 0, y: 0, z: 0 });
    expect(out[0].planeHeightAtCenterMeters).toBeCloseTo(20, 1);
  });
  it('liftRoofs: includes Z offset (1 ft = 0.3048 m)', () => {
    const ds = makeDataset(20, 50);
    const planes = [{ id: 'p1', vertices: [{ lat: 0, lng: 0 }, { lat: 0.0001, lng: 0.0001 }] }];
    const out = liftRoofs(ds, planes as any, { x: 0, y: 0, z: 1 });
    expect(out[0].planeHeightAtCenterMeters).toBeCloseTo(20 + METERS_PER_FOOT, 1);
  });
  it('liftRoofs: empty dataset → returns input array unchanged', () => {
    const planes = [{ id: 'p1', vertices: [{ lat: 0, lng: 0 }] }];
    const ds: LiDARDataset = { ...makeDataset(0, 0), points: [], count: 0 };
    const out = liftRoofs(ds, planes as any, { x: 0, y: 0, z: 0 });
    expect(out).toBe(planes);
  });
});
