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

  // Pre-compute lat/lng for each vertex in flat arrays.
  const W = mesh.width;
  const H = mesh.height;
  const positions = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const vi = (y * W + x) * 3;
      const xLocal = mesh.vertices[vi + 0];
      const yLocal = mesh.vertices[vi + 1];
      const z      = mesh.vertices[vi + 2];
      const lat = centroidLat + yLocal / METERS_PER_DEG_LAT;
      const lng = centroidLng + xLocal / metersPerDegLng;
      positions[(y * W + x) * 3 + 0] = lng;
      positions[(y * W + x) * 3 + 1] = lat;
      positions[(y * W + x) * 3 + 2] = z;
    }
  }

  // Build one GeometryInstance per quad with the quad's mean color.
  const instances: any[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i00 = (y + 0) * W + (x + 0);
      const i10 = (y + 0) * W + (x + 1);
      const i01 = (y + 1) * W + (x + 0);
      const i11 = (y + 1) * W + (x + 1);

      const verts = new Float64Array(18);
      // tri 1: i00, i10, i11
      verts[0]  = positions[i00 * 3 + 0]; verts[1]  = positions[i00 * 3 + 1]; verts[2]  = positions[i00 * 3 + 2];
      verts[3]  = positions[i10 * 3 + 0]; verts[4]  = positions[i10 * 3 + 1]; verts[5]  = positions[i10 * 3 + 2];
      verts[6]  = positions[i11 * 3 + 0]; verts[7]  = positions[i11 * 3 + 1]; verts[8]  = positions[i11 * 3 + 2];
      // tri 2: i00, i11, i01
      verts[9]  = positions[i00 * 3 + 0]; verts[10] = positions[i00 * 3 + 1]; verts[11] = positions[i00 * 3 + 2];
      verts[12] = positions[i11 * 3 + 0]; verts[13] = positions[i11 * 3 + 1]; verts[14] = positions[i11 * 3 + 2];
      verts[15] = positions[i01 * 3 + 0]; verts[16] = positions[i01 * 3 + 1]; verts[17] = positions[i01 * 3 + 2];

      const c00 = (i: number) => [mesh.colors[i * 4], mesh.colors[i * 4 + 1], mesh.colors[i * 4 + 2], mesh.colors[i * 4 + 3]];
      const cA = c00(i00), cB = c00(i10), cC = c00(i11), cD = c00(i01);
      const r = (cA[0] + cB[0] + cC[0] + cD[0]) / 4;
      const g = (cA[1] + cB[1] + cC[1] + cD[1]) / 4;
      const b = (cA[2] + cB[2] + cC[2] + cD[2]) / 4;
      const a = (cA[3] + cB[3] + cC[3] + cD[3]) / 4;

      const geometry = new C.Geometry({
        attributes: {
          position: new C.GeometryAttribute({
            componentDatatype: C.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: verts,
          }),
        },
        indices: new C.GeometryAttribute({
          componentDatatype: C.ComponentDatatype.UNSIGNED_SHORT,
          componentsPerAttribute: 1,
          values: new Uint16Array([0, 1, 2, 3, 4, 5]),
        }),
        primitiveType: C.PrimitiveType.TRIANGLES,
        boundingSphere: undefined,
      });

      const instance = new C.GeometryInstance({
        geometry,
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(
            new C.Color(Math.min(1, r), Math.min(1, g), Math.min(1, b), Math.min(1, a)),
          ),
        },
      });
      instances.push(instance);
    }
  }

  if (instances.length === 0) return () => {};

  const primitive = new C.Primitive({
    geometryInstances: instances,
    appearance: new C.PerInstanceColorAppearance({
      closed: false,
      translucent: true,
    }),
    asynchronous: false,
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
