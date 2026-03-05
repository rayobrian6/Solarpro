// ============================================================
// PANEL LAYOUT ENGINE
// Handles auto-placement of panels for all 3 system types
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import type { PlacedPanel, SolarPanel, RoofPlane, Layout } from '@/types';

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 111320;

function metersPerDegLng(lat: number) {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

// Convert lat/lng offset in meters to degrees
function offsetLatLng(
  baseLat: number, baseLng: number,
  northMeters: number, eastMeters: number
): { lat: number; lng: number } {
  return {
    lat: baseLat + northMeters / METERS_PER_DEG_LAT,
    lng: baseLng + eastMeters / metersPerDegLng(baseLat),
  };
}

// ─── Roof Mount Panel Layout ──────────────────────────────────
export function generateRoofLayout(params: {
  layoutId: string;
  roofPlane: RoofPlane;
  panel: SolarPanel;
  setback: number;        // meters
  panelSpacing: number;   // meters between panels
  rowSpacing: number;     // meters between rows
  tilt: number;
  azimuth: number;
}): PlacedPanel[] {
  const { layoutId, roofPlane, panel, setback, panelSpacing, rowSpacing, tilt, azimuth } = params;
  const panels: PlacedPanel[] = [];

  if (roofPlane.vertices.length < 3) return panels;

  // Get bounding box of roof plane
  const lats = roofPlane.vertices.map(v => v.lat);
  const lngs = roofPlane.vertices.map(v => v.lng);
  const minLat = Math.min(...lats) + setback / METERS_PER_DEG_LAT;
  const maxLat = Math.max(...lats) - setback / METERS_PER_DEG_LAT;
  const minLng = Math.min(...lngs) + setback / metersPerDegLng(roofPlane.vertices[0].lat);
  const maxLng = Math.max(...lngs) - setback / metersPerDegLng(roofPlane.vertices[0].lat);

  const panelWidthDeg = panel.width / metersPerDegLng(minLat);
  const panelHeightDeg = panel.height / METERS_PER_DEG_LAT;
  const rowSpacingDeg = rowSpacing / METERS_PER_DEG_LAT;
  const colSpacingDeg = panelSpacing / metersPerDegLng(minLat);

  let row = 0;
  let lat = minLat;
  while (lat + panelHeightDeg <= maxLat) {
    let col = 0;
    let lng = minLng;
    while (lng + panelWidthDeg <= maxLng) {
      const centerLat = lat + panelHeightDeg / 2;
      const centerLng = lng + panelWidthDeg / 2;

      // Check if panel center is inside roof polygon
      if (pointInPolygon({ lat: centerLat, lng: centerLng }, roofPlane.vertices)) {
        panels.push({
          id: uuidv4(),
          layoutId,
          lat: centerLat,
          lng: centerLng,
          x: col * (panel.width + panelSpacing),
          y: row * (panel.height + rowSpacing),
          tilt,
          azimuth,
          wattage: panel.wattage,
          bifacialGain: panel.bifacialFactor,
          row,
          col,
        });
      }
      lng += panelWidthDeg + colSpacingDeg;
      col++;
    }
    lat += panelHeightDeg + rowSpacingDeg;
    row++;
  }

  return panels;
}

// ─── Ground Mount Panel Layout ────────────────────────────────
export function generateGroundLayout(params: {
  layoutId: string;
  area: { lat: number; lng: number }[];
  panel: SolarPanel;
  tilt: number;
  azimuth: number;
  rowSpacing: number;
  panelSpacing: number;
  panelsPerRow: number;
  groundHeight: number;
}): PlacedPanel[] {
  const { layoutId, area, panel, tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow } = params;
  const panels: PlacedPanel[] = [];

  if (area.length < 2) return panels;

  const lats = area.map(v => v.lat);
  const lngs = area.map(v => v.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const baseLat = (minLat + maxLat) / 2;

  // Panel dimensions in degrees
  const panelWidthDeg = panel.width / metersPerDegLng(baseLat);
  const panelHeightDeg = panel.height / METERS_PER_DEG_LAT;

  // Row spacing accounts for tilt shadow
  const shadowLength = panel.height * Math.cos(tilt * DEG_TO_RAD);
  const effectiveRowSpacing = Math.max(rowSpacing, shadowLength + 0.5);
  const rowSpacingDeg = effectiveRowSpacing / METERS_PER_DEG_LAT;
  const colSpacingDeg = panelSpacing / metersPerDegLng(baseLat);

  // Group panels into rows
  const rowWidth = panelsPerRow * (panel.width + panelSpacing) - panelSpacing;
  const rowWidthDeg = rowWidth / metersPerDegLng(baseLat);

  let row = 0;
  let lat = minLat + 0.5 / METERS_PER_DEG_LAT;

  while (lat + panelHeightDeg <= maxLat - 0.5 / METERS_PER_DEG_LAT) {
    let col = 0;
    let lng = minLng + 0.5 / metersPerDegLng(baseLat);

    while (lng + panelWidthDeg <= maxLng - 0.5 / metersPerDegLng(baseLat)) {
      const centerLat = lat + panelHeightDeg / 2;
      const centerLng = lng + panelWidthDeg / 2;

      panels.push({
        id: uuidv4(),
        layoutId,
        lat: centerLat,
        lng: centerLng,
        x: col * (panel.width + panelSpacing),
        y: row * (panel.height + effectiveRowSpacing),
        tilt,
        azimuth,
        wattage: panel.wattage,
        bifacialGain: panel.bifacialFactor,
        row,
        col,
      });

      lng += panelWidthDeg + colSpacingDeg;
      col++;
    }

    lat += panelHeightDeg + rowSpacingDeg;
    row++;
  }

  return panels;
}

// ─── Fence Mount Panel Layout ─────────────────────────────────
export function generateFenceLayout(params: {
  layoutId: string;
  fenceLine: { lat: number; lng: number }[];
  panel: SolarPanel;
  azimuth: number;
  panelSpacing: number;
  fenceHeight: number;
  bifacialOptimized: boolean;
}): PlacedPanel[] {
  const { layoutId, fenceLine, panel, azimuth, panelSpacing, fenceHeight, bifacialOptimized } = params;
  const panels: PlacedPanel[] = [];

  if (fenceLine.length < 2) return panels;

  // Calculate total fence length
  let totalLength = 0;
  const segments: { start: { lat: number; lng: number }; end: { lat: number; lng: number }; length: number }[] = [];

  for (let i = 0; i < fenceLine.length - 1; i++) {
    const start = fenceLine[i];
    const end = fenceLine[i + 1];
    const dLat = (end.lat - start.lat) * METERS_PER_DEG_LAT;
    const dLng = (end.lng - start.lng) * metersPerDegLng(start.lat);
    const segLength = Math.sqrt(dLat * dLat + dLng * dLng);
    segments.push({ start, end, length: segLength });
    totalLength += segLength;
  }

  // Place panels along fence line
  const panelStep = panel.width + panelSpacing;
  let distanceAlongFence = panelSpacing / 2;
  let panelIndex = 0;

  while (distanceAlongFence + panel.width <= totalLength) {
    // Find which segment this panel is on
    let remainingDist = distanceAlongFence;
    let segIdx = 0;
    while (segIdx < segments.length - 1 && remainingDist > segments[segIdx].length) {
      remainingDist -= segments[segIdx].length;
      segIdx++;
    }

    const seg = segments[segIdx];
    const t = Math.min(1, remainingDist / seg.length);
    const panelLat = seg.start.lat + t * (seg.end.lat - seg.start.lat);
    const panelLng = seg.start.lng + t * (seg.end.lng - seg.start.lng);

    // Calculate segment azimuth for this panel
    const dLat = (seg.end.lat - seg.start.lat) * METERS_PER_DEG_LAT;
    const dLng = (seg.end.lng - seg.start.lng) * metersPerDegLng(seg.start.lat);
    const segAngle = Math.atan2(dLng, dLat) * (180 / Math.PI);
    const panelAzimuth = azimuth || ((segAngle + 90 + 360) % 360);

    // Bifacial gain for vertical panels
    const bifacialGain = bifacialOptimized ? 1.20 : 1.10;

    panels.push({
      id: uuidv4(),
      layoutId,
      lat: panelLat,
      lng: panelLng,
      x: panelIndex * panelStep,
      y: 0,
      tilt: 90, // Vertical
      azimuth: panelAzimuth,
      wattage: panel.wattage,
      bifacialGain,
      row: segIdx,   // Use segment index as row so 3D viewer can detect fence direction per segment
      col: panelIndex,
    });

    distanceAlongFence += panelStep;
    panelIndex++;
  }

  return panels;
}

// ─── Point in Polygon (Ray Casting) ──────────────────────────
function pointInPolygon(
  point: { lat: number; lng: number },
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  const x = point.lng, y = point.lat;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Calculate System Size ────────────────────────────────────
export function calculateSystemSize(panels: PlacedPanel[]): number {
  return panels.reduce((sum, p) => sum + p.wattage * p.bifacialGain, 0) / 1000;
}

// ─── Recommend System Size ────────────────────────────────────
export function recommendSystemSize(annualKwh: number, lat: number): {
  systemSizeKw: number;
  panelCount: number;
  panelWattage: number;
} {
  // Specific yield varies by location (kWh/kWp/year)
  const specificYield = Math.max(1000, 1800 - Math.abs(lat - 25) * 10);
  const systemSizeKw = Math.ceil((annualKwh / specificYield) * 10) / 10;
  const panelWattage = 400;
  const panelCount = Math.ceil((systemSizeKw * 1000) / panelWattage);

  return { systemSizeKw, panelCount, panelWattage };
}

// ─── Polygon Area (m²) ────────────────────────────────────────
export function polygonAreaM2(vertices: { lat: number; lng: number }[]): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = vertices[i].lng * metersPerDegLng(vertices[i].lat);
    const yi = vertices[i].lat * METERS_PER_DEG_LAT;
    const xj = vertices[j].lng * metersPerDegLng(vertices[j].lat);
    const yj = vertices[j].lat * METERS_PER_DEG_LAT;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2);
}

// ─── Fence Length (m) ─────────────────────────────────────────
export function fenceLengthM(points: { lat: number; lng: number }[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dLat = (points[i + 1].lat - points[i].lat) * METERS_PER_DEG_LAT;
    const dLng = (points[i + 1].lng - points[i].lng) * metersPerDegLng(points[i].lat);
    length += Math.sqrt(dLat * dLat + dLng * dLng);
  }
  return length;
}