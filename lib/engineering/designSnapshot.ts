// ============================================================
// Engineering Automation System — Design Snapshot Builder
// Extracts all engineering-relevant data from the design engine
// ============================================================

import type { Project, PlacedPanel, Layout } from '@/types';
import type { DesignSnapshot, RoofSegmentSummary, GroundArraySummary, FenceArraySummary } from './types';


// Default panel specs (400W monocrystalline) used when no panel selected
const DEFAULT_PANEL = {
  id: 'default-400w',
  manufacturer: 'Generic',
  model: '400W Monocrystalline',
  wattage: 400,
  width: 1.134,
  height: 1.762,
  efficiency: 20.4,
  bifacial: false,
  bifacialFactor: 1.0,
  temperatureCoeff: -0.35,
  pricePerWatt: 0.35,
  warranty: 25,
  cellType: 'Mono PERC',
};

// Default inverter (string, 8.2kW)
const DEFAULT_INVERTER = {
  id: 'default-string',
  manufacturer: 'Generic',
  model: 'String Inverter 8.2kW',
  capacity: 8.2,
  efficiency: 97.5,
  type: 'string' as const,
  pricePerUnit: 1200,
  warranty: 10,
  mpptChannels: 2,
  batteryCompatible: false,
};

/**
 * Build a DesignSnapshot from a Project + Layout.
 * This is the single entry point for engineering to read design data.
 */
export function buildDesignSnapshot(project: Project, layout: Layout): DesignSnapshot {
  const panels = layout.panels || [];
  const panelCount = panels.length;
  const systemSizeKw = parseFloat((panelCount * ((project.selectedPanel?.wattage ?? 400) / 1000)).toFixed(2));

  // Compute design version hash (for change detection)
  const designVersionId = computeDesignVersionId(layout);

  // Extract roof segments from panels
  const roofSegments = extractRoofSegments(panels, layout);
  const groundArrays = extractGroundArrays(panels, layout);
  const fenceArrays = extractFenceArrays(panels, layout);

  // Parse state from address
  const stateCode = project.stateCode || parseStateCode(project.address || '');
  const city = project.city || parseCityFromAddress(project.address || '');

  return {
    projectId: project.id,
    layoutId: layout.id,
    designVersionId,

    panels,
    panelCount,
    systemSizeKw,

    panel: project.selectedPanel || DEFAULT_PANEL as any,
    inverter: project.selectedInverter || null,
    mounting: project.selectedMounting || null,
    batteries: project.selectedBatteries || [],
    batteryCount: project.batteryCount || 0,

    systemType: (layout.systemType || project.systemType || 'roof') as 'roof' | 'ground' | 'fence',
    roofSegments,
    groundArrays,
    fenceArrays,

    address: project.address || '',
    lat: project.lat || 0,
    lng: project.lng || 0,
    stateCode,
    city,
    county: project.county || '',
    zip: project.zip || '',

    utilityName: project.utilityName || 'Unknown Utility',
    utilityRatePerKwh: project.utilityRatePerKwh || 0.12,
    ahj: deriveAhj(project),

    edgeSetbackM: 0.457,    // 18" default
    ridgeSetbackM: 0.457,   // 18" default
    pathwayWidthM: 0.914,   // 36" default

    capturedAt: new Date().toISOString(),
  };
}

/**
 * Compute a deterministic version ID from the layout.
 * Changes when panels are added/removed/moved.
 */
function computeDesignVersionId(layout: Layout): string {
  const key = JSON.stringify({
    id: layout.id,
    panelCount: layout.totalPanels,
    systemSizeKw: layout.systemSizeKw,
    updatedAt: layout.updatedAt,
  });
  // Simple hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `v${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Extract roof segment summaries from panel array.
 * Groups panels by azimuth/tilt to identify distinct roof planes.
 */
function extractRoofSegments(panels: PlacedPanel[], layout: Layout): RoofSegmentSummary[] {
  const roofPanels = panels.filter(p => p.systemType === 'roof' || !p.systemType);
  if (roofPanels.length === 0) return [];

  // Group by rounded azimuth + tilt (identifies distinct roof planes)
  const groups = new Map<string, PlacedPanel[]>();
  for (const panel of roofPanels) {
    const az = Math.round((panel.azimuth || 180) / 5) * 5;
    const tilt = Math.round((panel.tilt || 20) / 5) * 5;
    const key = `${az}-${tilt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(panel);
  }

  const segments: RoofSegmentSummary[] = [];
  let idx = 0;
  for (const [key, groupPanels] of groups) {
    const [az, tilt] = key.split('-').map(Number);
    const panelAreaM2 = 1.134 * 1.762; // standard panel area
    segments.push({
      id: `roof-${idx++}`,
      azimuthDegrees: az,
      pitchDegrees: tilt,
      panelCount: groupPanels.length,
      areaM2: parseFloat((groupPanels.length * panelAreaM2).toFixed(1)),
    });
  }

  // Sort by panel count descending (primary face first)
  return segments.sort((a, b) => b.panelCount - a.panelCount);
}

/**
 * Extract ground array summaries.
 */
function extractGroundArrays(panels: PlacedPanel[], layout: Layout): GroundArraySummary[] {
  const groundPanels = panels.filter(p => p.systemType === 'ground');
  if (groundPanels.length === 0) return [];

  // Group by arrayId if available, otherwise treat as single array
  const groups = new Map<string, PlacedPanel[]>();
  for (const panel of groundPanels) {
    const key = panel.arrayId || 'ground-0';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(panel);
  }

  const arrays: GroundArraySummary[] = [];
  let idx = 0;
  for (const [key, groupPanels] of groups) {
    const rows = new Set(groupPanels.map(p => p.row)).size;
    arrays.push({
      id: `ground-${idx++}`,
      tiltDegrees: layout.groundTilt || 20,
      azimuthDegrees: layout.groundAzimuth || 180,
      rowCount: rows,
      panelCount: groupPanels.length,
      rowSpacingM: layout.rowSpacing || 1.5,
    });
  }
  return arrays;
}

/**
 * Extract fence array summaries.
 */
function extractFenceArrays(panels: PlacedPanel[], layout: Layout): FenceArraySummary[] {
  const fencePanels = panels.filter(p => p.systemType === 'fence');
  if (fencePanels.length === 0) return [];

  const fenceLine = layout.fenceLine || [];
  let lengthM = 0;
  for (let i = 1; i < fenceLine.length; i++) {
    const dLat = (fenceLine[i].lat - fenceLine[i-1].lat) * 111320;
    const dLng = (fenceLine[i].lng - fenceLine[i-1].lng) * 111320 * Math.cos(fenceLine[i].lat * Math.PI / 180);
    lengthM += Math.sqrt(dLat * dLat + dLng * dLng);
  }

  return [{
    id: 'fence-0',
    azimuthDegrees: layout.fenceAzimuth || 180,
    heightM: layout.fenceHeight || 1.5,
    panelCount: fencePanels.length,
    lengthM: parseFloat(lengthM.toFixed(1)),
  }];
}

function deriveAhj(project: Project): string {
  if (project.city && project.stateCode) {
    return `${project.city}, ${project.stateCode}`;
  }
  if (project.county && project.stateCode) {
    return `${project.county} County, ${project.stateCode}`;
  }
  if (project.stateCode) {
    return `${project.stateCode} State`;
  }
  return 'Unknown AHJ';
}

function parseStateCode(address: string): string {
  const match = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:\s*,|\s*$)/);
  return match ? match[1] : '';
}

function parseCityFromAddress(address: string): string {
  const parts = address.split(',');
  if (parts.length >= 2) return parts[parts.length - 2].trim();
  return '';
}