/**
 * panelEngine.ts — Solar Panel 3D Mesh Factory
 *
 * Creates Cesium GeometryInstances for solar panels with:
 * - Realistic panel dimensions (1.722m × 1.134m × 0.040m)
 * - Aluminum frame outline
 * - Per-instance color (shade analysis or system type)
 * - GPU-instanced rendering via Cesium.Primitive (1000-panel chunks)
 */

export interface PanelSpec {
  widthM: number;
  heightM: number;
  thicknessM: number;
  frameWidthM: number;
  cellRows: number;
  cellCols: number;
  color: 'mono-black' | 'poly-blue' | 'thin-film';
  wattage: number;
}

export const DEFAULT_PANEL_SPEC: PanelSpec = {
  widthM: 1.722,
  heightM: 1.134,
  thicknessM: 0.040,
  frameWidthM: 0.035,
  cellRows: 6,
  cellCols: 10,
  color: 'mono-black',
  wattage: 400,
};

export interface PanelColors {
  body: [number, number, number, number];   // RGBA 0-1
  frame: [number, number, number, number];
}

export function getPanelColors(spec: PanelSpec, systemType: string): PanelColors {
  if (systemType === 'roof') {
    return {
      body: [0.06, 0.14, 0.42, 0.95],
      frame: [0.75, 0.78, 0.82, 1.0],
    };
  } else if (systemType === 'ground') {
    return {
      body: [0.04, 0.20, 0.10, 0.95],
      frame: [0.70, 0.75, 0.70, 1.0],
    };
  } else {
    // fence
    return {
      body: [0.08, 0.10, 0.45, 0.95],
      frame: [0.80, 0.82, 0.86, 1.0],
    };
  }
}

/**
 * Compute shade color for a panel based on sun angle and surface normal.
 * Returns [r, g, b] in 0-1 range.
 */
export function computePanelShadeColor(
  normal: { x: number; y: number; z: number },
  sunAzimuthDeg: number,
  sunElevationDeg: number
): [number, number, number] {
  if (sunElevationDeg <= 0) {
    return [0.05, 0.05, 0.15]; // night — dark blue
  }

  const sunAzRad = sunAzimuthDeg * Math.PI / 180;
  const sunElRad = sunElevationDeg * Math.PI / 180;

  // Sun direction vector (pointing FROM sun TO surface, in ECEF-ish)
  const sunDir = {
    x: Math.sin(sunAzRad) * Math.cos(sunElRad),
    y: Math.cos(sunAzRad) * Math.cos(sunElRad),
    z: Math.sin(sunElRad),
  };

  // Dot product of panel normal and sun direction
  const dot = normal.x * sunDir.x + normal.y * sunDir.y + normal.z * sunDir.z;
  const factor = Math.max(0, dot); // 0 = fully shaded, 1 = full sun

  // Color gradient: dark blue (shaded) → bright yellow (full sun)
  const r = factor * 0.95 + 0.05;
  const g = factor * 0.75 + 0.05;
  const b = (1 - factor) * 0.6 + 0.05;

  return [r, g, b];
}

/**
 * Build instanced panel mesh placeholder (for Three.js overlay compatibility).
 * Returns a dummy object since we use Cesium primitives directly.
 */
export function buildInstancedPanelMesh(
  THREE: any,
  spec: PanelSpec,
  maxCount: number
): { mesh: any; updateInstance: (i: number, matrix: any, color: [number, number, number]) => void } {
  // Create a minimal Three.js instanced mesh for the overlay
  const geometry = new THREE.BoxGeometry(spec.widthM, spec.thicknessM, spec.heightM);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x0a1a5c,
    metalness: 0.3,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  function updateInstance(i: number, matrix: any, color: [number, number, number]) {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(color[0], color[1], color[2]));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return { mesh, updateInstance };
}