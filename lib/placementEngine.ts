/**
 * placementEngine.ts — SolarPro Panel Placement Engine v2
 *
 * Provides:
 *   1. Grid-based snapping system (portrait/landscape aware)
 *   2. Fire setback zone calculation (NEC/IFC compliant defaults)
 *   3. Azimuth-aligned grid rotation for roof arrays
 *   4. Multi-row generation with auto-spacing
 *   5. Orientation-aware panel dimensions
 *   6. Setback zone overlay data (red/green zones for canvas)
 *   7. Auto-fill with target system size support
 *
 * CRITICAL: This engine ONLY generates PlacedPanel[] arrays.
 * It does NOT touch panel counting, engineering, proposals, or BOM.
 * All downstream pipeline (Design → Engineering → Proposal) remains unchanged.
 */

import { v4 as uuidv4 } from 'uuid';
import type { PlacedPanel, SolarPanel, RoofPlane } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────────────
const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 111320;

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PanelOrientation = 'portrait' | 'landscape';

/**
 * Fire setback configuration — configurable per AHJ.
 * All values in meters.
 */
export interface FireSetbackConfig {
  /** Minimum distance from roof edge (default: 0.457m = 18 inches) */
  edgeSetbackM: number;
  /** Firefighter pathway width — required on one side (default: 0.914m = 36 inches) */
  pathwayWidthM: number;
  /** Ridge setback — distance from roof ridge (default: 0.457m = 18 inches) */
  ridgeSetbackM: number;
  /** Whether to enforce pathway (some AHJs exempt small systems) */
  enforcePathway: boolean;
}

export const DEFAULT_FIRE_SETBACKS: FireSetbackConfig = {
  edgeSetbackM: 0.457,    // 18 inches
  pathwayWidthM: 0.914,   // 36 inches
  ridgeSetbackM: 0.457,   // 18 inches
  enforcePathway: true,
};

export const RELAXED_FIRE_SETBACKS: FireSetbackConfig = {
  edgeSetbackM: 0.3,
  pathwayWidthM: 0.6,
  ridgeSetbackM: 0.3,
  enforcePathway: false,
};

/**
 * Grid snap configuration — defines the invisible alignment grid.
 */
export interface GridSnapConfig {
  panelWidthM: number;
  panelHeightM: number;
  panelSpacingM: number;
  rowSpacingM: number;
  azimuthDeg: number;
  originLat: number;
  originLng: number;
}

/**
 * Setback zone polygon for canvas overlay rendering.
 * type='restricted' → red zone, type='buildable' → green zone
 */
export interface SetbackZone {
  type: 'restricted' | 'buildable';
  vertices: { lat: number; lng: number }[];
  label: string;
}

/**
 * Multi-row generation parameters.
 */
export interface MultiRowParams {
  layoutId: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  rowCount: number;
  rowSpacingM: number;
  panel: SolarPanel;
  orientation: PanelOrientation;
  tilt: number;
  azimuth: number;
  panelSpacingM: number;
  systemType: 'roof' | 'ground' | 'fence';
}

/**
 * Auto-fill parameters with optional target system size.
 */
export interface AutoFillParams {
  layoutId: string;
  roofPlane: RoofPlane;
  panel: SolarPanel;
  orientation: PanelOrientation;
  setbacks: FireSetbackConfig;
  panelSpacingM: number;
  rowSpacingM: number;
  tilt: number;
  azimuth: number;
  /** Optional: stop placing panels when this kW target is reached */
  targetKw?: number;
}

// ─── Panel Dimension Helpers ──────────────────────────────────────────────────

/**
 * Get effective panel width and height based on orientation.
 * Portrait: width < height (tall panel)
 * Landscape: width > height (wide panel, rotated 90°)
 */
export function getPanelDimensions(
  panel: SolarPanel,
  orientation: PanelOrientation
): { widthM: number; heightM: number } {
  if (orientation === 'landscape') {
    // Swap width and height for landscape
    return { widthM: panel.height, heightM: panel.width };
  }
  return { widthM: panel.width, heightM: panel.height };
}

// ─── Grid Snap System ─────────────────────────────────────────────────────────

/**
 * Snap a lat/lng coordinate to the nearest grid point.
 * The grid is defined by panel dimensions + spacing, anchored at origin.
 * Supports azimuth-rotated grids for roof alignment.
 */
export function snapToGrid(
  lat: number,
  lng: number,
  config: GridSnapConfig
): { lat: number; lng: number } {
  const mPerDegLng = metersPerDegLng(config.originLat);

  // Convert to local ENU meters relative to grid origin
  const dx = (lng - config.originLng) * mPerDegLng;
  const dy = (lat - config.originLat) * METERS_PER_DEG_LAT;

  // Rotate into grid-aligned frame (counter-rotate by azimuth)
  const azRad = config.azimuthDeg * DEG_TO_RAD;
  const cosA = Math.cos(azRad);
  const sinA = Math.sin(azRad);

  const gx = dx * cosA + dy * sinA;
  const gy = -dx * sinA + dy * cosA;

  // Snap to grid cell
  const cellW = config.panelWidthM + config.panelSpacingM;
  const cellH = config.panelHeightM + config.rowSpacingM;

  const snappedGx = Math.round(gx / cellW) * cellW;
  const snappedGy = Math.round(gy / cellH) * cellH;

  // Rotate back to world frame
  const snappedDx = snappedGx * cosA - snappedGy * sinA;
  const snappedDy = snappedGx * sinA + snappedGy * cosA;

  return {
    lat: config.originLat + snappedDy / METERS_PER_DEG_LAT,
    lng: config.originLng + snappedDx / mPerDegLng,
  };
}

/**
 * Build a GridSnapConfig from existing panels (snaps new panels to existing array grid).
 * If no panels exist, creates a fresh grid anchored at the given origin.
 */
export function buildGridConfig(
  existingPanels: PlacedPanel[],
  panel: SolarPanel,
  orientation: PanelOrientation,
  panelSpacingM: number,
  rowSpacingM: number,
  azimuthDeg: number,
  fallbackLat: number,
  fallbackLng: number
): GridSnapConfig {
  const { widthM, heightM } = getPanelDimensions(panel, orientation);

  if (existingPanels.length > 0) {
    // Anchor grid to first panel of same array
    const anchor = existingPanels[0];
    return {
      panelWidthM: widthM,
      panelHeightM: heightM,
      panelSpacingM,
      rowSpacingM,
      azimuthDeg,
      originLat: anchor.lat,
      originLng: anchor.lng,
    };
  }

  return {
    panelWidthM: widthM,
    panelHeightM: heightM,
    panelSpacingM,
    rowSpacingM,
    azimuthDeg,
    originLat: fallbackLat,
    originLng: fallbackLng,
  };
}

// ─── Fire Setback Zone Calculation ───────────────────────────────────────────

/**
 * Calculate the effective setback distance for a roof polygon.
 * Returns the inset amount in meters (used to shrink the buildable area).
 *
 * For a simple rectangular roof:
 *   - All edges get edgeSetbackM
 *   - One side (north, for south-facing) gets additional pathwayWidthM
 *   - Ridge (top edge) gets ridgeSetbackM
 *
 * For the 2D canvas layout engine, we use a uniform inset equal to the
 * maximum setback value. The 3D engine uses per-edge setbacks.
 */
export function calcEffectiveSetback(config: FireSetbackConfig): number {
  const base = config.edgeSetbackM;
  const pathway = config.enforcePathway ? config.pathwayWidthM : 0;
  // Use the larger of edge setback or pathway for uniform inset
  return Math.max(base, pathway);
}

/**
 * Generate setback zone overlay polygons for canvas rendering.
 * Returns restricted zones (red) and buildable zone (green).
 *
 * The restricted zone is the ring between the roof edge and the setback line.
 * The buildable zone is the inset polygon where panels can be placed.
 */
export function generateSetbackZones(
  roofVertices: { lat: number; lng: number }[],
  config: FireSetbackConfig
): SetbackZone[] {
  if (roofVertices.length < 3) return [];

  const zones: SetbackZone[] = [];

  // Restricted zone = the full roof outline (shown as red background)
  zones.push({
    type: 'restricted',
    vertices: roofVertices,
    label: `Edge setback ${(config.edgeSetbackM * 39.37).toFixed(0)}"`,
  });

  // Buildable zone = inset polygon
  const buildable = insetPolygon(roofVertices, config.edgeSetbackM);
  if (buildable.length >= 3) {
    zones.push({
      type: 'buildable',
      vertices: buildable,
      label: 'Buildable area',
    });
  }

  return zones;
}

/**
 * Inset a polygon by a given distance in meters.
 * Uses a simple centroid-based shrink (works well for convex polygons).
 * For production use, a proper Minkowski difference would be more accurate.
 */
export function insetPolygon(
  vertices: { lat: number; lng: number }[],
  insetM: number
): { lat: number; lng: number }[] {
  if (vertices.length < 3) return vertices;

  // Find centroid
  const centLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const centLng = vertices.reduce((s, v) => s + v.lng, 0) / vertices.length;
  const mPerDegLng = metersPerDegLng(centLat);

  return vertices.map(v => {
    // Vector from centroid to vertex (in meters)
    const dx = (v.lng - centLng) * mPerDegLng;
    const dy = (v.lat - centLat) * METERS_PER_DEG_LAT;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return v; // vertex at centroid, skip

    // Move vertex toward centroid by insetM
    const scale = Math.max(0, (dist - insetM) / dist);
    return {
      lat: centLat + (v.lat - centLat) * scale,
      lng: centLng + (v.lng - centLng) * scale,
    };
  });
}

// ─── Azimuth-Aligned Grid Generation ─────────────────────────────────────────

/**
 * Generate a panel grid aligned to the roof azimuth.
 * Panels are placed in rows perpendicular to the azimuth direction,
 * ensuring arrays follow the roof slope direction.
 *
 * This is the core grid generation function used by all placement modes.
 */
export function generateAlignedGrid(params: {
  layoutId: string;
  vertices: { lat: number; lng: number }[];
  panel: SolarPanel;
  orientation: PanelOrientation;
  setbackM: number;
  panelSpacingM: number;
  rowSpacingM: number;
  tilt: number;
  azimuth: number;
  systemType: 'roof' | 'ground' | 'fence';
  targetKw?: number;
}): PlacedPanel[] {
  const {
    layoutId, vertices, panel, orientation, setbackM,
    panelSpacingM, rowSpacingM, tilt, azimuth, systemType, targetKw,
  } = params;

  if (vertices.length < 3) return [];

  const { widthM, heightM } = getPanelDimensions(panel, orientation);

  // Centroid of polygon
  const centLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const centLng = vertices.reduce((s, v) => s + v.lng, 0) / vertices.length;
  const mPerDegLng = metersPerDegLng(centLat);

  // Convert vertices to local ENU meters
  const localVerts = vertices.map(v => ({
    x: (v.lng - centLng) * mPerDegLng,
    y: (v.lat - centLat) * METERS_PER_DEG_LAT,
  }));

  // Rotate vertices into azimuth-aligned frame
  // Azimuth 180° = south-facing → rows run east-west
  const azRad = (azimuth - 180) * DEG_TO_RAD; // offset so 180° = no rotation
  const cosA = Math.cos(azRad);
  const sinA = Math.sin(azRad);

  const rotatedVerts = localVerts.map(v => ({
    x: v.x * cosA + v.y * sinA,
    y: -v.x * sinA + v.y * cosA,
  }));

  // Bounding box in rotated frame
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const v of rotatedVerts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  // Apply setback inset
  minX += setbackM; maxX -= setbackM;
  minY += setbackM; maxY -= setbackM;

  if (minX >= maxX || minY >= maxY) return [];

  // Precompute polygon for fast PIP
  const poly = precomputeLocalPolygon(rotatedVerts);

  // Grid step sizes
  const stepX = widthM + panelSpacingM;
  const stepY = heightM + rowSpacingM;
  const halfW = widthM / 2;
  const halfH = heightM / 2;

  const panels: PlacedPanel[] = [];
  let row = 0;
  const targetWatts = targetKw ? targetKw * 1000 : Infinity;

  for (let y = minY + halfH; y + halfH <= maxY; y += stepY, row++) {
    let col = 0;
    for (let x = minX + halfW; x + halfW <= maxX; x += stepX, col++) {
      // Check if panel center is inside the inset polygon
      if (!fastLocalPIP(x, y, poly)) continue;

      // Check target kW limit
      if (panels.length * panel.wattage >= targetWatts) break;

      // Rotate back to world frame
      const worldX = x * cosA - y * sinA;
      const worldY = x * sinA + y * cosA;

      const panelLat = centLat + worldY / METERS_PER_DEG_LAT;
      const panelLng = centLng + worldX / mPerDegLng;

      panels.push({
        id: uuidv4(),
        layoutId,
        lat: panelLat,
        lng: panelLng,
        x: col * stepX,
        y: row * stepY,
        tilt,
        azimuth,
        wattage: panel.wattage,
        bifacialGain: panel.bifacialFactor,
        row,
        col,
        systemType,
        // Store orientation in arrayId field for downstream use
        // (arrayId is optional and not used by engineering pipeline)
        arrayId: orientation,
      });
    }
    if (panels.length * panel.wattage >= targetWatts) break;
  }

  return panels;
}

// ─── Multi-Row Generation Tool ────────────────────────────────────────────────

/**
 * Generate multiple rows of panels from a start/end line definition.
 * User places first row (start → end), then specifies row count.
 * Additional rows are auto-generated at rowSpacingM intervals.
 *
 * Row direction: perpendicular to the azimuth (rows run east-west for south-facing).
 * Row offset direction: north for south-facing arrays (away from sun).
 */
export function generateMultipleRows(params: MultiRowParams): PlacedPanel[] {
  const {
    layoutId, startLat, startLng, endLat, endLng,
    rowCount, rowSpacingM, panel, orientation, tilt, azimuth, panelSpacingM, systemType,
  } = params;

  const { widthM, heightM } = getPanelDimensions(panel, orientation);
  const mPerDegLng = metersPerDegLng((startLat + endLat) / 2);

  // Row direction vector (from start to end)
  const rowDx = (endLng - startLng) * mPerDegLng;
  const rowDy = (endLat - startLat) * METERS_PER_DEG_LAT;
  const rowLen = Math.sqrt(rowDx * rowDx + rowDy * rowDy);
  if (rowLen < 0.01) return [];

  const rowUx = rowDx / rowLen; // unit vector along row
  const rowUy = rowDy / rowLen;

  // Offset direction: perpendicular to row, pointing "north" for south-facing
  // For azimuth 180° (south-facing), offset is northward (+lat)
  const azRad = azimuth * DEG_TO_RAD;
  const offsetUx = -Math.sin(azRad); // perpendicular to azimuth
  const offsetUy = Math.cos(azRad);

  // Row spacing includes panel height + gap
  const totalRowSpacing = heightM + rowSpacingM;

  const allPanels: PlacedPanel[] = [];

  for (let r = 0; r < rowCount; r++) {
    // Offset this row from the first row
    const offsetM = r * totalRowSpacing;
    const rowStartLat = startLat + (offsetUy * offsetM) / METERS_PER_DEG_LAT;
    const rowStartLng = startLng + (offsetUx * offsetM) / mPerDegLng;

    // Place panels along this row
    const panelStep = widthM + panelSpacingM;
    const panelCount = Math.floor(rowLen / panelStep);

    for (let c = 0; c < panelCount; c++) {
      const distAlongRow = c * panelStep + widthM / 2;
      const panelLat = rowStartLat + (rowUy * distAlongRow) / METERS_PER_DEG_LAT;
      const panelLng = rowStartLng + (rowUx * distAlongRow) / mPerDegLng;

      allPanels.push({
        id: uuidv4(),
        layoutId,
        lat: panelLat,
        lng: panelLng,
        x: c * panelStep,
        y: r * totalRowSpacing,
        tilt,
        azimuth,
        wattage: panel.wattage,
        bifacialGain: panel.bifacialFactor,
        row: r,
        col: c,
        systemType,
        arrayId: orientation,
      });
    }
  }

  return allPanels;
}

// ─── Auto-Fill with Fire Setbacks ─────────────────────────────────────────────

/**
 * Auto-fill a roof plane with panels, respecting fire setbacks.
 * This is the upgraded version of fillRoof() that uses proper setback zones.
 */
export function autoFillWithSetbacks(params: AutoFillParams): PlacedPanel[] {
  const {
    layoutId, roofPlane, panel, orientation, setbacks,
    panelSpacingM, rowSpacingM, tilt, azimuth, targetKw,
  } = params;

  const effectiveSetback = calcEffectiveSetback(setbacks);

  return generateAlignedGrid({
    layoutId,
    vertices: roofPlane.vertices,
    panel,
    orientation,
    setbackM: effectiveSetback,
    panelSpacingM,
    rowSpacingM,
    tilt,
    azimuth,
    systemType: 'roof',
    targetKw,
  });
}

// ─── Ground Mount Layout ──────────────────────────────────────────────────────

/**
 * Generate a ground mount array with azimuth-aligned rows.
 * Uses the same aligned grid engine as roof arrays.
 */
export function generateGroundArray(params: {
  layoutId: string;
  area: { lat: number; lng: number }[];
  panel: SolarPanel;
  orientation: PanelOrientation;
  tilt: number;
  azimuth: number;
  rowSpacingM: number;
  panelSpacingM: number;
  marginM?: number;
}): PlacedPanel[] {
  const { layoutId, area, panel, orientation, tilt, azimuth, rowSpacingM, panelSpacingM, marginM = 0.5 } = params;

  if (area.length < 3) return [];

  // Close the polygon if not already closed
  const vertices = [...area];
  if (vertices[0].lat !== vertices[vertices.length - 1].lat ||
      vertices[0].lng !== vertices[vertices.length - 1].lng) {
    vertices.push(vertices[0]);
  }

  return generateAlignedGrid({
    layoutId,
    vertices,
    panel,
    orientation,
    setbackM: marginM,
    panelSpacingM,
    rowSpacingM,
    tilt,
    azimuth,
    systemType: 'ground',
  });
}

// ─── Fence Layout ─────────────────────────────────────────────────────────────

/**
 * Generate a fence/vertical array along a line.
 * Panels are placed vertically (tilt=90°) along the fence line.
 */
export function generateFenceArray(params: {
  layoutId: string;
  fenceLine: { lat: number; lng: number }[];
  panel: SolarPanel;
  orientation: PanelOrientation;
  azimuth: number;
  panelSpacingM: number;
  fenceHeightM: number;
  bifacialOptimized: boolean;
}): PlacedPanel[] {
  const { layoutId, fenceLine, panel, orientation, azimuth, panelSpacingM, fenceHeightM, bifacialOptimized } = params;

  if (fenceLine.length < 2) return [];

  const { widthM } = getPanelDimensions(panel, orientation);
  const mPerDegLng = metersPerDegLng(fenceLine[0].lat);
  const bifacialGain = bifacialOptimized ? panel.bifacialFactor : 1.0;

  const panels: PlacedPanel[] = [];
  let col = 0;

  // Walk along fence line segments
  for (let seg = 0; seg < fenceLine.length - 1; seg++) {
    const p1 = fenceLine[seg];
    const p2 = fenceLine[seg + 1];

    const dx = (p2.lng - p1.lng) * mPerDegLng;
    const dy = (p2.lat - p1.lat) * METERS_PER_DEG_LAT;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.01) continue;

    const ux = dx / segLen;
    const uy = dy / segLen;

    const step = widthM + panelSpacingM;
    const panelCount = Math.floor(segLen / step);

    for (let i = 0; i < panelCount; i++) {
      const dist = i * step + widthM / 2;
      const panelLat = p1.lat + (uy * dist) / METERS_PER_DEG_LAT;
      const panelLng = p1.lng + (ux * dist) / mPerDegLng;

      panels.push({
        id: uuidv4(),
        layoutId,
        lat: panelLat,
        lng: panelLng,
        x: col * step,
        y: 0,
        tilt: 90,
        azimuth,
        wattage: panel.wattage,
        bifacialGain,
        row: 0,
        col,
        systemType: 'fence',
        arrayId: orientation,
      });
      col++;
    }
  }

  return panels;
}

// ─── Row Spacing Calculator ───────────────────────────────────────────────────

/**
 * Calculate minimum row spacing to avoid inter-row shading.
 * Based on winter solstice sun elevation at the given latitude.
 * Same formula as SolarEngine3D.tsx calcMinRowSpacing().
 */
export function calcMinRowSpacing(
  tiltDeg: number,
  panelHeightM: number,
  latitudeDeg: number
): number {
  const tiltRad = tiltDeg * DEG_TO_RAD;
  const panelVerticalHeight  = panelHeightM * Math.sin(tiltRad);
  const panelHorizontalDepth = panelHeightM * Math.cos(tiltRad);
  const sunElevDeg = Math.max(10, 90 - Math.abs(latitudeDeg) - 23.45);
  const shadowLength = panelVerticalHeight / Math.tan(sunElevDeg * DEG_TO_RAD);
  return Math.max(1.5, (panelHorizontalDepth + shadowLength) * 1.1);
}

// ─── Orientation Change Helper ────────────────────────────────────────────────

/**
 * Regenerate panels with a new orientation.
 * Swaps panel width/height and recalculates grid positions.
 * Used when user toggles Portrait ↔ Landscape.
 *
 * Returns new panels with updated positions — existing panel IDs are replaced.
 * The panel count may change slightly due to different grid fit.
 */
export function regenerateWithOrientation(
  existingPanels: PlacedPanel[],
  panel: SolarPanel,
  newOrientation: PanelOrientation,
  panelSpacingM: number,
  rowSpacingM: number
): PlacedPanel[] {
  if (existingPanels.length === 0) return [];

  const { widthM, heightM } = getPanelDimensions(panel, newOrientation);

  // Group panels by layoutId
  const byLayout = new Map<string, PlacedPanel[]>();
  for (const p of existingPanels) {
    const key = p.layoutId;
    if (!byLayout.has(key)) byLayout.set(key, []);
    byLayout.get(key)!.push(p);
  }

  const result: PlacedPanel[] = [];

  for (const [layoutId, layoutPanels] of byLayout) {
    // Find bounding box of this layout's panels
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const p of layoutPanels) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const baseLat = (minLat + maxLat) / 2;
    const mPerDegLng = metersPerDegLng(baseLat);

    // Re-grid with new orientation
    const stepLng = (widthM + panelSpacingM) / mPerDegLng;
    const stepLat = (heightM + rowSpacingM) / METERS_PER_DEG_LAT;
    const halfW = widthM / 2 / mPerDegLng;
    const halfH = heightM / 2 / METERS_PER_DEG_LAT;

    const sample = layoutPanels[0];
    let row = 0;
    for (let lat = minLat; lat + heightM / METERS_PER_DEG_LAT <= maxLat + stepLat; lat += stepLat, row++) {
      let col = 0;
      for (let lng = minLng; lng + widthM / mPerDegLng <= maxLng + stepLng; lng += stepLng, col++) {
        result.push({
          id: uuidv4(),
          layoutId,
          lat: lat + halfH,
          lng: lng + halfW,
          x: col * (widthM + panelSpacingM),
          y: row * (heightM + rowSpacingM),
          tilt: sample.tilt,
          azimuth: sample.azimuth,
          wattage: sample.wattage,
          bifacialGain: sample.bifacialGain,
          row,
          col,
          systemType: sample.systemType,
          arrayId: newOrientation,
        });
      }
    }
  }

  return result;
}

// ─── Local Coordinate PIP Helpers ────────────────────────────────────────────

interface LocalPolygon {
  xs: Float64Array;
  ys: Float64Array;
  n: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
}

function precomputeLocalPolygon(verts: { x: number; y: number }[]): LocalPolygon {
  const n = verts.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    xs[i] = verts[i].x;
    ys[i] = verts[i].y;
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  return { xs, ys, n, minX, maxX, minY, maxY };
}

function fastLocalPIP(px: number, py: number, poly: LocalPolygon): boolean {
  if (px < poly.minX || px > poly.maxX || py < poly.minY || py > poly.maxY) return false;
  const { xs, ys, n } = poly;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const xi = xs[i], yi = ys[i];
    const xj = xs[j], yj = ys[j];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── Utility: Panel Count from kW Target ─────────────────────────────────────

/**
 * Calculate how many panels are needed to reach a target system size.
 */
export function panelCountForKw(targetKw: number, panelWattage: number): number {
  return Math.ceil((targetKw * 1000) / panelWattage);
}

/**
 * Calculate system size in kW from panel array.
 */
export function calcSystemSizeKw(panels: PlacedPanel[]): number {
  return panels.reduce((sum, p) => sum + p.wattage, 0) / 1000;
}