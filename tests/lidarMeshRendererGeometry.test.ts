/**
 * tests/lidarMeshRendererGeometry.test.ts
 *
 * Reachability test for `lib/3d/lidar/meshRenderer.ts`.
 *
 * The LiDAR mesh is the DEFAULT style (`DEFAULT_LIDAR_STATE.style === 'mesh'`),
 * yet nothing in the suite ever executed `renderMesh` — it needs `window.Cesium`,
 * so a plain unit test skips it and the whole renderer went out the door
 * unobserved. This test closes that hole by driving the REAL exported function
 * against the REAL Cesium classes (`cesium` is a first-class dependency; its
 * Core/Scene classes construct fine under Node — only `Viewer` needs WebGL), with
 * a stub viewer that captures whatever primitive the renderer hands the scene.
 *
 * What it pins, all of which were broken:
 *   A. Vertex positions must be ECEF metres (Cartesian3), NOT raw lng/lat degrees.
 *      Degrees are ~1e2; ECEF is ~6.37e6. Writing degrees into a Cesium `position`
 *      attribute buries the mesh near the centre of the Earth.
 *   B. The renderer must not compile tens of thousands of GeometryInstances
 *      synchronously — one batched, indexed Geometry.
 *   C. `Geometry.indices` must be a plain Uint16Array/Uint32Array (Cesium's
 *      documented contract), and the bounding sphere must come from the real
 *      ECEF positions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Cesium from 'cesium';
import { renderMesh } from '@/lib/3d/lidar/meshRenderer';
import type { LiDARDataset, LiDARPoint } from '@/lib/3d/lidar/types';

// Site: Granite City, IL area — a real-world centroid, so the ECEF magnitude
// assertion below is a genuine WGS84 check rather than an equator special case.
const CENTROID_LAT = 38.7012;
const CENTROID_LNG = -90.1487;
/** Mean WGS84 radius. Every surface point must land within a few km of this. */
const EARTH_RADIUS_M = 6_371_000;

function syntheticDataset(): LiDARDataset {
  // 6×6 grid, ±10 m about the centroid, gentle ramp in Z. `buildMesh` aims for
  // ~1 cell per 4 points, so 36 points give a 3×3 vertex grid / 4 quads — small
  // enough to assert over exhaustively.
  const points: LiDARPoint[] = [];
  for (let iy = 0; iy < 6; iy++) {
    for (let ix = 0; ix < 6; ix++) {
      points.push({
        x: -10 + (20 * ix) / 5,
        y: -10 + (20 * iy) / 5,
        z: 128 + ix * 0.5 + iy * 0.25,
        classification: 6,
      });
    }
  }
  const zs = points.map((p) => p.z);
  return {
    source: 'synthetic.las',
    centroidLat: CENTROID_LAT,
    centroidLng: CENTROID_LNG,
    points,
    bounds: {
      minX: -10, maxX: 10,
      minY: -10, maxY: 10,
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    },
    count: points.length,
    crs: 'local-enu',
  };
}

function stubViewer() {
  const added: any[] = [];
  const removed: any[] = [];
  return {
    added,
    removed,
    scene: {
      primitives: {
        add: (p: any) => { added.push(p); return p; },
        remove: (p: any) => { removed.push(p); return true; },
      },
    },
  };
}

let priorWindow: any;
let hadWindow = false;

beforeAll(() => {
  hadWindow = 'window' in globalThis;
  priorWindow = (globalThis as any).window;
  (globalThis as any).window = { ...(priorWindow ?? {}), Cesium };
});

afterAll(() => {
  if (hadWindow) (globalThis as any).window = priorWindow;
  else delete (globalThis as any).window;
});

describe('renderMesh — Cesium geometry contract', () => {
  function render() {
    const viewer = stubViewer();
    const cleanup = renderMesh(
      viewer as any,
      syntheticDataset(),
      { x: 0, y: 0, z: 0 },
      { textured: false, maxResolution: 8 },
    );
    expect(viewer.added).toHaveLength(1);
    const primitive = viewer.added[0];
    const gi = primitive.geometryInstances;
    const instances: any[] = Array.isArray(gi) ? gi : [gi];
    return { viewer, cleanup, primitive, instances };
  }

  it('A. writes ECEF metres into the position attribute, not raw degrees', () => {
    const { instances } = render();
    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      const position = instance.geometry.attributes.position;
      expect(position).toBeDefined();
      const values: Float64Array = position.values;
      expect(values.length).toBeGreaterThan(0);
      expect(values.length % 3).toBe(0);

      for (let i = 0; i < values.length; i += 3) {
        const mag = Math.hypot(values[i], values[i + 1], values[i + 2]);
        // Degrees would give ~90; the ellipsoid surface is ~6.37e6 m.
        expect(mag).toBeGreaterThan(EARTH_RADIUS_M - 30_000);
        expect(mag).toBeLessThan(EARTH_RADIUS_M + 30_000);
      }
    }
  });

  it('A2. the positions round-trip back to the dataset centroid and elevation', () => {
    const { instances } = render();
    const values: Float64Array = instances[0].geometry.attributes.position.values;
    const carto = Cesium.Cartographic.fromCartesian(
      new Cesium.Cartesian3(values[0], values[1], values[2]),
    );
    expect(carto).toBeDefined();
    const lat = Cesium.Math.toDegrees(carto!.latitude);
    const lng = Cesium.Math.toDegrees(carto!.longitude);
    // The synthetic cloud spans ±10 m — well under 0.001° of arc.
    expect(lat).toBeCloseTo(CENTROID_LAT, 3);
    expect(lng).toBeCloseTo(CENTROID_LNG, 3);
    expect(carto!.height).toBeGreaterThan(120);
    expect(carto!.height).toBeLessThan(140);
  });

  it('C. hands Cesium a typed index array, not a GeometryAttribute', () => {
    const { instances } = render();
    for (const instance of instances) {
      const indices = instance.geometry.indices;
      expect(indices).toBeDefined();
      // Cesium's documented contract: Uint16Array|Uint32Array. A
      // GeometryAttribute wrapper is silently accepted by the constructor and
      // then blows up (or draws nothing) inside the geometry pipeline.
      expect(ArrayBuffer.isView(indices)).toBe(true);
      expect(
        indices instanceof Uint16Array || indices instanceof Uint32Array,
      ).toBe(true);
      expect(indices.length % 3).toBe(0);
      expect(indices.length).toBeGreaterThan(0);

      // Every index must address a real vertex of THIS geometry.
      const vertexCount = instance.geometry.attributes.position.values.length / 3;
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBeLessThan(vertexCount);
      }
    }
  });

  it('C2. carries a bounding sphere derived from the ECEF positions', () => {
    const { instances } = render();
    for (const instance of instances) {
      const bs = instance.geometry.boundingSphere;
      expect(bs).toBeDefined();
      const centreMag = Cesium.Cartesian3.magnitude(bs.center);
      expect(centreMag).toBeGreaterThan(EARTH_RADIUS_M - 30_000);
      expect(centreMag).toBeLessThan(EARTH_RADIUS_M + 30_000);
      // A ±10 m site: the sphere must be site-scale, not planet-scale.
      expect(bs.radius).toBeGreaterThan(0);
      expect(bs.radius).toBeLessThan(1000);
    }
  });

  it('B. batches into a single geometry instead of one instance per quad', () => {
    const { instances, primitive } = render();
    expect(instances).toHaveLength(1);
    // And it must not block the main thread compiling them.
    expect(primitive.asynchronous).toBe(true);
  });

  it('B2. instance count stays O(1) as the grid grows', () => {
    // 256² is the default cap; the per-quad code path produced 65,025
    // GeometryInstances here and compiled them synchronously.
    const points: LiDARPoint[] = [];
    for (let iy = 0; iy < 40; iy++) {
      for (let ix = 0; ix < 40; ix++) {
        points.push({ x: -20 + ix, y: -20 + iy, z: 130 + (ix % 7) * 0.3 });
      }
    }
    const ds: LiDARDataset = {
      ...syntheticDataset(),
      points,
      bounds: { minX: -20, maxX: 19, minY: -20, maxY: 19, minZ: 130, maxZ: 131.8 },
      count: points.length,
    };
    const viewer = stubViewer();
    renderMesh(viewer as any, ds, { x: 0, y: 0, z: 0 }, { textured: true });
    const gi = viewer.added[0].geometryInstances;
    expect(Array.isArray(gi) ? gi.length : 1).toBe(1);
  });

  it('keeps its existing contract: empty cloud renders nothing, cleanup removes', () => {
    const empty = { ...syntheticDataset(), points: [], count: 0 };
    const v1 = stubViewer();
    const noop = renderMesh(v1 as any, empty, { x: 0, y: 0, z: 0 }, { textured: false });
    expect(v1.added).toHaveLength(0);
    expect(() => noop()).not.toThrow();

    const { viewer, cleanup, primitive } = render();
    cleanup();
    expect(viewer.removed).toEqual([primitive]);
  });
});
