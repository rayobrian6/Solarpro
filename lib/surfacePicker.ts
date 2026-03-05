/**
 * surfacePicker.ts — Cesium 3D Surface Picking Engine
 *
 * Priority order:
 *   1. 3D Tiles (buildings/roofs) via scene.pick() + pickPosition()
 *   2. Terrain globe via globe.pick()
 *   3. Ellipsoid fallback
 *
 * Returns exact Cartesian3 hit point + surface normal + tilt/azimuth.
 */

export interface SurfaceHit {
  cartesian: any;           // Cesium.Cartesian3
  lat: number;
  lng: number;
  height: number;
  normal: { x: number; y: number; z: number };
  tiltDegrees: number;      // 0 = flat, 90 = vertical
  azimuthDegrees: number;   // compass bearing of downslope direction
  surfaceType: 'building' | 'terrain' | 'unknown';
}

/**
 * Pick exact 3D surface point under screen pixel.
 */
export function pickSurface(
  viewer: any,
  screenPos: { x: number; y: number }
): SurfaceHit | null {
  const C = (window as any).Cesium;
  if (!C || !viewer) return null;

  try {
    // ── 1. Try 3D tiles (buildings) ──────────────────────────────────────
    const picked = viewer.scene.pick(screenPos);
    if (picked && viewer.scene.pickPositionSupported) {
      const cartesian = viewer.scene.pickPosition(screenPos);
      if (cartesian && C.defined(cartesian)) {
        const normal = computeSurfaceNormal(viewer, screenPos, cartesian);
        const { lat, lng, height } = cartesianToLatLng(C, cartesian);
        const { tilt, azimuth } = normalToTiltAzimuth(C, cartesian, normal);
        return {
          cartesian,
          lat, lng, height,
          normal,
          tiltDegrees: tilt,
          azimuthDegrees: azimuth,
          surfaceType: 'building',
        };
      }
    }

    // ── 2. Try terrain globe ─────────────────────────────────────────────
    const ray = viewer.camera.getPickRay(screenPos);
    if (ray) {
      const terrainPos = viewer.scene.globe.pick(ray, viewer.scene);
      if (terrainPos && C.defined(terrainPos)) {
        const normal = computeSurfaceNormal(viewer, screenPos, terrainPos);
        const { lat, lng, height } = cartesianToLatLng(C, terrainPos);
        const { tilt, azimuth } = normalToTiltAzimuth(C, terrainPos, normal);
        return {
          cartesian: terrainPos,
          lat, lng, height,
          normal,
          tiltDegrees: tilt,
          azimuthDegrees: azimuth,
          surfaceType: 'terrain',
        };
      }
    }

    // ── 3. Ellipsoid fallback ────────────────────────────────────────────
    if (ray) {
      const ellipsoidPos = viewer.scene.globe.ellipsoid.intersectWithRay(ray);
      if (ellipsoidPos && C.defined(ellipsoidPos)) {
        const { lat, lng, height } = cartesianToLatLng(C, ellipsoidPos);
        return {
          cartesian: ellipsoidPos,
          lat, lng, height,
          normal: { x: 0, y: 0, z: 1 },
          tiltDegrees: 0,
          azimuthDegrees: 180,
          surfaceType: 'unknown',
        };
      }
    }
  } catch (e) {
    console.warn('pickSurface error:', e);
  }

  return null;
}

/**
 * Compute surface normal via finite-difference raycasting.
 * Samples 4 neighboring pixels to estimate the local surface plane.
 */
function computeSurfaceNormal(
  viewer: any,
  screenPos: { x: number; y: number },
  centerPos: any
): { x: number; y: number; z: number } {
  const C = (window as any).Cesium;
  const OFFSET = 3; // pixels

  try {
    const offsets = [
      { x: screenPos.x + OFFSET, y: screenPos.y },
      { x: screenPos.x - OFFSET, y: screenPos.y },
      { x: screenPos.x, y: screenPos.y + OFFSET },
      { x: screenPos.x, y: screenPos.y - OFFSET },
    ];

    const positions: any[] = [];
    for (const off of offsets) {
      let pos: any = null;
      const picked = viewer.scene.pick(off);
      if (picked && viewer.scene.pickPositionSupported) {
        pos = viewer.scene.pickPosition(off);
      }
      if (!pos || !C.defined(pos)) {
        const ray = viewer.camera.getPickRay(off);
        if (ray) pos = viewer.scene.globe.pick(ray, viewer.scene);
      }
      if (pos && C.defined(pos)) positions.push(pos);
    }

    if (positions.length >= 2) {
      // Use cross product of two edge vectors
      const p0 = positions[0];
      const p1 = positions[2] ?? positions[1];

      const v1 = C.Cartesian3.subtract(p0, centerPos, new C.Cartesian3());
      const v2 = C.Cartesian3.subtract(p1, centerPos, new C.Cartesian3());
      const cross = C.Cartesian3.cross(v1, v2, new C.Cartesian3());
      const normalized = C.Cartesian3.normalize(cross, new C.Cartesian3());

      // Ensure normal points away from Earth center
      const up = C.Cartesian3.normalize(centerPos, new C.Cartesian3());
      const dot = C.Cartesian3.dot(normalized, up);
      if (dot < 0) {
        C.Cartesian3.negate(normalized, normalized);
      }

      return { x: normalized.x, y: normalized.y, z: normalized.z };
    }
  } catch (e) {
    // Fall through to default
  }

  // Default: use ellipsoid normal (straight up)
  const C2 = (window as any).Cesium;
  const up = C2.Cartesian3.normalize(centerPos, new C2.Cartesian3());
  return { x: up.x, y: up.y, z: up.z };
}

/**
 * Convert surface normal to tilt (degrees from horizontal) and azimuth (compass bearing).
 */
function normalToTiltAzimuth(
  C: any,
  position: any,
  normal: { x: number; y: number; z: number }
): { tilt: number; azimuth: number } {
  try {
    // Get local ENU frame at position
    const enu = C.Transforms.eastNorthUpToFixedFrame(position);
    const invEnu = C.Matrix4.inverse(enu, new C.Matrix4());

    // Transform normal to local ENU space
    const normalCart = new C.Cartesian3(normal.x, normal.y, normal.z);
    const localNormal = C.Matrix4.multiplyByPointAsVector(invEnu, normalCart, new C.Cartesian3());
    C.Cartesian3.normalize(localNormal, localNormal);

    // localNormal.z = cos(tilt), where tilt=0 means flat (normal pointing up)
    const tilt = Math.acos(Math.max(-1, Math.min(1, localNormal.z))) * 180 / Math.PI;

    // Azimuth = direction the slope faces (downhill direction)
    // In ENU: east=x, north=y
    // The downslope direction is opposite to the horizontal component of the normal
    const azimuth = (Math.atan2(-localNormal.x, -localNormal.y) * 180 / Math.PI + 360) % 360;

    return { tilt, azimuth };
  } catch (e) {
    return { tilt: 0, azimuth: 180 };
  }
}

/**
 * Convert Cartesian3 to lat/lng/height.
 */
export function cartesianToLatLng(
  C: any,
  cartesian: any
): { lat: number; lng: number; height: number } {
  const carto = C.Cartographic.fromCartesian(cartesian);
  return {
    lat: C.Math.toDegrees(carto.latitude),
    lng: C.Math.toDegrees(carto.longitude),
    height: carto.height,
  };
}

/**
 * Build a Cesium Matrix4 model matrix for a panel at a surface hit point.
 * The panel is oriented so its face aligns with the surface normal.
 */
export function buildPanelModelMatrix(
  hit: SurfaceHit,
  tiltOverride: number | null,
  azimuthOverride: number | null,
  systemType: string
): any {
  const C = (window as any).Cesium;

  // For fence: always 90° tilt
  // For roof: use surface normal tilt
  // For ground: use configured tilt
  const finalTilt = systemType === 'fence' ? 90
    : tiltOverride !== null ? tiltOverride
    : hit.tiltDegrees;

  const finalAzimuth = azimuthOverride !== null ? azimuthOverride : hit.azimuthDegrees;

  // Start with ENU frame at hit position
  const position = hit.cartesian;
  const enu = C.Transforms.eastNorthUpToFixedFrame(position);

  // Apply azimuth rotation around local Z (up) axis
  const azRad = C.Math.toRadians(finalAzimuth);
  const rotZ = C.Matrix3.fromRotationZ(-azRad);

  // Apply tilt rotation around local X axis
  const tiltRad = C.Math.toRadians(finalTilt);
  const rotX = C.Matrix3.fromRotationX(-tiltRad);

  // Combined rotation: first azimuth, then tilt
  const rot = C.Matrix3.multiply(rotZ, rotX, new C.Matrix3());
  const rot4 = C.Matrix4.fromRotationTranslation(rot, C.Cartesian3.ZERO);

  return C.Matrix4.multiply(enu, rot4, new C.Matrix4());
}

/**
 * Sample a polygon area and return surface hit points for panel placement.
 * Uses a grid pattern aligned to the given azimuth.
 */
export async function samplePolygonSurface(
  viewer: any,
  polygon: Array<{ lat: number; lng: number }>,
  panelW: number,
  panelH: number,
  rowSpacing: number,
  colSpacing: number,
  azimuthDeg: number
): Promise<SurfaceHit[]> {
  const C = (window as any).Cesium;
  if (!C || polygon.length < 3) return [];

  // Compute bounding box
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Meters per degree at this latitude
  const mLat = 111320;
  const mLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  // Panel step sizes in degrees
  const stepLat = (panelH + rowSpacing) / mLat;
  const stepLng = (panelW + colSpacing) / mLng;

  const hits: SurfaceHit[] = [];
  const canvas = viewer.scene.canvas;

  // Grid scan
  for (let lat = minLat + stepLat / 2; lat < maxLat; lat += stepLat) {
    for (let lng = minLng + stepLng / 2; lng < maxLng; lng += stepLng) {
      // Point-in-polygon test
      if (!pointInPolygon(lat, lng, polygon)) continue;

      // Project to screen
      const worldPos = C.Cartesian3.fromDegrees(lng, lat, 0);
      const screenPos = C.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, worldPos);
      if (!screenPos) continue;
      if (screenPos.x < 0 || screenPos.x > canvas.width) continue;
      if (screenPos.y < 0 || screenPos.y > canvas.height) continue;

      // Pick surface at this screen position
      const hit = pickSurface(viewer, { x: screenPos.x, y: screenPos.y });
      if (hit) {
        hits.push(hit);
      } else {
        // Fallback: use elevation estimate
        const elevation = await getElevationEstimate(viewer, lat, lng);
        const cartesian = C.Cartesian3.fromDegrees(lng, lat, elevation);
        hits.push({
          cartesian,
          lat, lng, height: elevation,
          normal: { x: 0, y: 0, z: 1 },
          tiltDegrees: 0,
          azimuthDegrees: azimuthDeg,
          surfaceType: 'terrain',
        });
      }
    }
  }

  return hits;
}

/**
 * Generate fence panel positions along a polyline.
 */
export function generateFencePanels(
  line: Array<{ lat: number; lng: number }>,
  panelW: number,
  panelH: number,
  fenceHeight: number,
  baseElevation: number
): SurfaceHit[] {
  const C = (window as any).Cesium;
  if (!C || line.length < 2) return [];

  const mLat = 111320;
  const avgLat = line.reduce((s, p) => s + p.lat, 0) / line.length;
  const mLng = 111320 * Math.cos(avgLat * Math.PI / 180);

  const hits: SurfaceHit[] = [];
  const spacing = panelW + 0.05; // 5cm gap between panels

  for (let seg = 0; seg < line.length - 1; seg++) {
    const p0 = line[seg];
    const p1 = line[seg + 1];

    const dx = (p1.lng - p0.lng) * mLng;
    const dy = (p1.lat - p0.lat) * mLat;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const numPanels = Math.floor(segLen / spacing);
    if (numPanels === 0) continue;

    // Fence azimuth = perpendicular to fence direction
    const fenceDir = Math.atan2(dx, dy) * 180 / Math.PI;
    const panelAzimuth = (fenceDir + 90 + 360) % 360; // face east/west

    for (let i = 0; i < numPanels; i++) {
      const t = (i + 0.5) / numPanels;
      const pLat = p0.lat + t * (p1.lat - p0.lat);
      const pLng = p0.lng + t * (p1.lng - p0.lng);
      const elevation = baseElevation + fenceHeight / 2;

      const cartesian = C.Cartesian3.fromDegrees(pLng, pLat, elevation);

      hits.push({
        cartesian,
        lat: pLat,
        lng: pLng,
        height: elevation,
        normal: { x: Math.sin(panelAzimuth * Math.PI / 180), y: Math.cos(panelAzimuth * Math.PI / 180), z: 0 },
        tiltDegrees: 90,
        azimuthDegrees: panelAzimuth,
        surfaceType: 'terrain',
      });
    }
  }

  return hits;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pointInPolygon(lat: number, lng: number, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

async function getElevationEstimate(viewer: any, lat: number, lng: number): Promise<number> {
  try {
    const C = (window as any).Cesium;
    const positions = [C.Cartographic.fromDegrees(lng, lat)];
    const updated = await C.sampleTerrainMostDetailed(viewer.terrainProvider, positions);
    return updated[0]?.height ?? 0;
  } catch {
    return 0;
  }
}