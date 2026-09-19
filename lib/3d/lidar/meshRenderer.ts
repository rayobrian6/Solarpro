/**
 * lib/3d/lidar/meshRenderer.ts
 *
 * Render a LiDAR point cloud as a Cesium `Primitive` (a 2.5D triangle mesh).
 *
 * Coupled to Cesium (window.Cesium). Loaded only on the client side.
 */

import type { LiDARDataset, LiDAROffset } from './types';
import { applyOffset } from './offsetTransform';
import { buildMesh, type MeshGeometry } from './meshBuilder';
import { METERS_PER_DEG_LAT } from '@/lib/3d/blockMath';

export interface RenderMeshOptions {
  /** false = solid rainbow (alpha 0.85). true = semi-transparent (alpha 0.4). */
  textured: boolean;
  /** Max grid resolution per axis. Default 256. */
  maxResolution?: number;
}

/** Render the mesh. Returns a cleanup function. */
export function renderMesh(
  viewer: any,
  dataset: LiDARDataset,
  offset: LiDAROffset,
  options: RenderMeshOptions,
): () => void {
  const C = (window as any).Cesium;
  if (!C) throw new Error('Cesium not loaded — renderMesh must run client-side');
  if (!viewer?.scene?.primitives) throw new Error('Cesium viewer not ready');

  const ds = applyOffset(dataset, offset);
  const centroidLat = ds.centroidLat;
  const centroidLng = ds.centroidLng;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((centroidLat * Math.PI) / 180);

  const mesh = buildMesh(ds.points, {
    maxResolution: options.maxResolution ?? 256,
    alphaTextured: options.textured,
  });
  if (mesh.width === 0 || mesh.height === 0) {
    return () => { /* nothing to clean up */ };
  }

  // Project every vertex from the local ENU frame to ECEF metres.
  //
  // WAS: the raw `lng`, `lat`, `z` triple was written straight into what
  // becomes Cesium's `position` attribute. That attribute is ECEF (a
  // `Cartesian3`, metres from the centre of the Earth) — degrees are ~1e2
  // where ECEF is ~6.4e6, so every vertex landed a couple of hundred metres
  // from the Earth's CORE and the mesh was nowhere near the site at any zoom.
  // The dataset's own doc comment (types.ts) already spells out the correct
  // conversion, and `pointCloudRenderer` does it for the point style; the mesh
  // path simply never made the call. NOW: `Cartesian3.fromDegrees` per vertex,
  // through one scratch Cartesian3 so the 256×256 worst case (65,536 vertices)
  // does not allocate 65,536 throwaway objects.
  const W = mesh.width;
  const H = mesh.height;
  const positions = new Float64Array(W * H * 3);
  const scratchEcef = new C.Cartesian3();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const vi = (y * W + x) * 3;
      const xLocal = mesh.vertices[vi + 0];
      const yLocal = mesh.vertices[vi + 1];
      const z      = mesh.vertices[vi + 2];
      const lat = centroidLat + yLocal / METERS_PER_DEG_LAT;
      const lng = centroidLng + xLocal / metersPerDegLng;
      const ecef = C.Cartesian3.fromDegrees(lng, lat, z, undefined, scratchEcef);
      positions[vi + 0] = ecef.x;
      positions[vi + 1] = ecef.y;
      positions[vi + 2] = ecef.z;
    }
  }

  // Build ONE indexed Geometry for the whole grid.
  //
  // WAS: one `GeometryInstance` per quad — up to (256-1)² = 65,025 of them,
  // each with its own 18-double vertex array and its own quad-mean colour —
  // handed to a `Primitive` with `asynchronous: false`. That flag forces the
  // instance combine, vertex-array build and shader compile to happen inside a
  // single frame on the main thread; at 65k instances the tab simply stops
  // responding for many seconds. NOW: `meshBuilder` already emits a shared
  // vertex grid plus a triangle index buffer, which is exactly the shape
  // Cesium wants, so the mesh renders as a single indexed Geometry — one
  // instance, one draw call, nothing to combine, and 6 *shared* vertices per
  // quad instead of 6 duplicated ones. `asynchronous: true` keeps even that
  // one compile off the main thread. Per-quad flat colour becomes per-vertex
  // colour, which is what `mesh.colors` was computed for to begin with.
  //
  // A grid that is one cell wide or tall has no quads, so `meshBuilder` emits
  // an empty index buffer; adding a primitive with no triangles is pointless.
  if (mesh.indices.length === 0) return () => {};

  const geometry = new C.Geometry({
    attributes: {
      position: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      // `PerInstanceColorAppearance`'s flat vertex shader declares
      // `in vec4 color`. Cesium only rewrites that declaration into a
      // batch-table fetch when the *instance* carries a colour attribute;
      // with none (below), this per-vertex attribute binds to it directly.
      color: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 4,
        values: mesh.colors,
      }),
    },
    // WAS: a `GeometryAttribute` wrapper object. Cesium's `Geometry` contract
    // is a plain `Uint16Array|Uint32Array` here; the constructor stores
    // whatever it is given without complaint, and the geometry pipeline then
    // reads `indices.length` off the wrapper (undefined) — so no triangle
    // ever reached the GPU. `mesh.indices` is already the Uint32Array Cesium
    // asks for.
    indices: mesh.indices,
    primitiveType: C.PrimitiveType.TRIANGLES,
    // WAS: `undefined`, which leaves the primitive with no volume to cull or
    // to zoom-to. Derive it from the ECEF positions built above — the only
    // values that describe where this mesh actually sits.
    boundingSphere: C.BoundingSphere.fromVertices(positions),
  });

  const primitive = new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry }),
    appearance: new C.PerInstanceColorAppearance({
      // `flat` matters: the lit variant of this appearance reads a `normal`
      // vertex attribute that this mesh has never carried.
      flat: true,
      closed: false,
      translucent: true,
    }),
    asynchronous: true,
    shadows: C.ShadowMode.DISABLED,
    releaseGeometryInstances: true,
  });
  viewer.scene.primitives.add(primitive);

  return () => {
    try { viewer.scene.primitives.remove(primitive); } catch { /* ignore */ }
  };
}

/** Re-export for callers that want to know the mesh size before render. */
export { type MeshGeometry };
