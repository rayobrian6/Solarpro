/**
 * lib/autoDesign.ts
 * Auto Design Generation — creates initial solar layout from system size + location.
 * Generates roof planes, places panels, optimizes orientation.
 */

export interface AutoDesignInput {
  systemKw: number;
  lat: number;
  lng: number;
  stateCode: string;
  // Roof info (optional — will use defaults if not provided)
  roofType?: 'gable' | 'hip' | 'flat' | 'shed' | 'mansard';
  roofPitch?: number;        // degrees
  roofAzimuth?: number;      // degrees (180 = south)
  roofAreaSqFt?: number;
  // Panel specs
  panelWatts?: number;       // default 430W
  panelWidthM?: number;      // default 1.134m
  panelHeightM?: number;     // default 1.762m
  // Layout settings
  setbackM?: number;         // default 0.3m
  rowSpacingM?: number;      // default 0.5m
  panelSpacingM?: number;    // default 0.02m
  // Tilt optimization
  optimizeTilt?: boolean;
}

export interface PlacedPanelDesign {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tilt: number;
  azimuth: number;
  watts: number;
}

export interface RoofPlaneDesign {
  id: string;
  label: string;
  pitch: number;
  azimuth: number;
  areaSqM: number;
  panels: PlacedPanelDesign[];
  panelCount: number;
  systemKw: number;
}

export interface AutoDesignResult {
  success: boolean;
  // Layout
  roofPlanes: RoofPlaneDesign[];
  totalPanels: number;
  totalSystemKw: number;
  // Orientation
  recommendedTilt: number;
  recommendedAzimuth: number;
  // Production estimate
  estimatedAnnualKwh: number;
  specificYield: number;
  // Layout efficiency
  roofUtilizationPercent: number;
  // Notes
  designNotes: string[];
  error?: string;
}

// ── Optimal tilt by latitude ──────────────────────────────────────────────────
export function getOptimalTilt(lat: number): number {
  // Rule of thumb: tilt ≈ latitude × 0.87 + 3.1 (optimized for annual production)
  return Math.round(lat * 0.87 + 3.1);
}

// ── Optimal azimuth by hemisphere ─────────────────────────────────────────────
export function getOptimalAzimuth(lat: number): number {
  return lat >= 0 ? 180 : 0; // South in northern hemisphere
}

// ── Calculate inter-row spacing to avoid shading ──────────────────────────────
export function getInterRowSpacing(panelHeightM: number, tiltDeg: number, lat: number): number {
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  // Solar elevation at winter solstice noon
  const solarElevation = 90 - lat - 23.45;
  const elevRad = (Math.max(10, solarElevation) * Math.PI) / 180;
  // Shadow length
  const shadowLength = panelHeightM * Math.sin(tiltRad) / Math.tan(elevRad);
  // Row spacing = shadow length + panel base
  return Math.max(0.5, shadowLength + panelHeightM * Math.cos(tiltRad));
}

// ── Generate panel layout for a roof plane ────────────────────────────────────
function generatePanelLayout(
  panelCount: number,
  panelWatts: number,
  panelWidthM: number,
  panelHeightM: number,
  tilt: number,
  azimuth: number,
  setbackM: number,
  rowSpacingM: number,
  panelSpacingM: number,
  lat: number,
): PlacedPanelDesign[] {
  const panels: PlacedPanelDesign[] = [];
  const interRowSpacing = getInterRowSpacing(panelHeightM, tilt, lat);
  const rowPitch = panelHeightM * Math.cos((tilt * Math.PI) / 180) + interRowSpacing;

  let placed = 0;
  let row = 0;

  while (placed < panelCount) {
    const y = setbackM + row * rowPitch;
    let col = 0;

    while (placed < panelCount) {
      const x = setbackM + col * (panelWidthM + panelSpacingM);
      panels.push({
        id: `panel_${placed}`,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        width: panelWidthM,
        height: panelHeightM,
        tilt,
        azimuth,
        watts: panelWatts,
      });
      placed++;
      col++;

      // Max ~20 panels per row for visual clarity
      if (col >= 20) break;
    }
    row++;
  }

  return panels;
}

// ── Main auto design function ─────────────────────────────────────────────────
export async function generateAutoDesign(input: AutoDesignInput): Promise<AutoDesignResult> {
  const {
    systemKw,
    lat,
    lng,
    stateCode,
    roofType = 'gable',
    roofPitch,
    roofAzimuth,
    roofAreaSqFt,
    panelWatts = 430,
    panelWidthM = 1.134,
    panelHeightM = 1.762,
    setbackM = 0.3,
    rowSpacingM = 0.5,
    panelSpacingM = 0.02,
    optimizeTilt = true,
  } = input;

  const designNotes: string[] = [];

  // Determine optimal orientation
  const optimalTilt = optimizeTilt ? getOptimalTilt(lat) : (roofPitch ?? 20);
  const optimalAzimuth = roofAzimuth ?? getOptimalAzimuth(lat);

  // Calculate panel count
  const totalPanels = Math.ceil((systemKw * 1000) / panelWatts);
  const actualSystemKw = Math.round((totalPanels * panelWatts) / 1000 * 100) / 100;

  // Determine roof plane configuration
  let roofPlanes: RoofPlaneDesign[] = [];

  if (roofType === 'gable') {
    // Split panels between south and east/west faces if needed
    const southPanels = totalPanels;
    const southPlane: RoofPlaneDesign = {
      id: 'plane_south',
      label: 'South Roof',
      pitch: optimalTilt,
      azimuth: optimalAzimuth,
      areaSqM: roofAreaSqFt ? roofAreaSqFt * 0.0929 / 2 : totalPanels * panelWidthM * panelHeightM * 1.3,
      panels: generatePanelLayout(
        southPanels, panelWatts, panelWidthM, panelHeightM,
        optimalTilt, optimalAzimuth, setbackM, rowSpacingM, panelSpacingM, lat
      ),
      panelCount: southPanels,
      systemKw: Math.round(southPanels * panelWatts / 1000 * 100) / 100,
    };
    roofPlanes = [southPlane];
    designNotes.push(`Placed ${southPanels} panels on south-facing roof at ${optimalTilt}° tilt`);
  } else if (roofType === 'hip') {
    // Distribute across south, east, west faces
    const southCount = Math.ceil(totalPanels * 0.6);
    const eastCount = Math.floor(totalPanels * 0.2);
    const westCount = totalPanels - southCount - eastCount;

    roofPlanes = [
      {
        id: 'plane_south', label: 'South Roof', pitch: optimalTilt, azimuth: 180,
        areaSqM: southCount * panelWidthM * panelHeightM * 1.3,
        panels: generatePanelLayout(southCount, panelWatts, panelWidthM, panelHeightM, optimalTilt, 180, setbackM, rowSpacingM, panelSpacingM, lat),
        panelCount: southCount, systemKw: Math.round(southCount * panelWatts / 1000 * 100) / 100,
      },
      {
        id: 'plane_east', label: 'East Roof', pitch: optimalTilt, azimuth: 90,
        areaSqM: eastCount * panelWidthM * panelHeightM * 1.3,
        panels: generatePanelLayout(eastCount, panelWatts, panelWidthM, panelHeightM, optimalTilt, 90, setbackM, rowSpacingM, panelSpacingM, lat),
        panelCount: eastCount, systemKw: Math.round(eastCount * panelWatts / 1000 * 100) / 100,
      },
      {
        id: 'plane_west', label: 'West Roof', pitch: optimalTilt, azimuth: 270,
        areaSqM: westCount * panelWidthM * panelHeightM * 1.3,
        panels: generatePanelLayout(westCount, panelWatts, panelWidthM, panelHeightM, optimalTilt, 270, setbackM, rowSpacingM, panelSpacingM, lat),
        panelCount: westCount, systemKw: Math.round(westCount * panelWatts / 1000 * 100) / 100,
      },
    ].filter(p => p.panelCount > 0);
    designNotes.push('Hip roof: panels distributed across south (60%), east (20%), west (20%) faces');
  } else if (roofType === 'flat') {
    // Flat roof — use optimal tilt with ballast
    const flatTilt = getOptimalTilt(lat);
    roofPlanes = [{
      id: 'plane_flat', label: 'Flat Roof', pitch: flatTilt, azimuth: 180,
      areaSqM: roofAreaSqFt ? roofAreaSqFt * 0.0929 : totalPanels * panelWidthM * panelHeightM * 2.0,
      panels: generatePanelLayout(totalPanels, panelWatts, panelWidthM, panelHeightM, flatTilt, 180, setbackM, rowSpacingM, panelSpacingM, lat),
      panelCount: totalPanels, systemKw: actualSystemKw,
    }];
    designNotes.push(`Flat roof: ballasted racking at ${flatTilt}° tilt facing south`);
    designNotes.push('Increased row spacing applied to avoid inter-row shading');
  } else {
    // Default: single south-facing plane
    roofPlanes = [{
      id: 'plane_main', label: 'Main Roof', pitch: optimalTilt, azimuth: optimalAzimuth,
      areaSqM: totalPanels * panelWidthM * panelHeightM * 1.3,
      panels: generatePanelLayout(totalPanels, panelWatts, panelWidthM, panelHeightM, optimalTilt, optimalAzimuth, setbackM, rowSpacingM, panelSpacingM, lat),
      panelCount: totalPanels, systemKw: actualSystemKw,
    }];
  }

  // Production estimate
  const sunHoursMap: Record<string, number> = {
    AL: 4.7, AK: 3.2, AZ: 6.0, AR: 4.7, CA: 5.4, CO: 5.4, CT: 4.2, DE: 4.3,
    FL: 5.3, GA: 5.0, HI: 5.8, ID: 4.9, IL: 4.4, IN: 4.3, IA: 4.5, KS: 5.0,
    KY: 4.4, LA: 5.0, ME: 4.2, MD: 4.5, MA: 4.2, MI: 4.1, MN: 4.5, MS: 5.0,
    MO: 4.7, MT: 4.9, NE: 5.0, NV: 6.1, NH: 4.2, NJ: 4.4, NM: 6.1, NY: 4.1,
    NC: 4.8, ND: 4.8, OH: 4.1, OK: 5.2, OR: 4.5, PA: 4.2, RI: 4.2, SC: 5.0,
    SD: 5.0, TN: 4.7, TX: 5.3, UT: 5.6, VT: 4.0, VA: 4.6, WA: 4.0, WV: 4.2,
    WI: 4.3, WY: 5.3, DC: 4.4,
  };
  const sunHours = sunHoursMap[stateCode] || 4.5;
  const systemEfficiency = 0.86;
  const estimatedAnnualKwh = Math.round(actualSystemKw * sunHours * 365 * systemEfficiency);
  const specificYield = Math.round(estimatedAnnualKwh / actualSystemKw);

  // Roof utilization
  const totalPanelAreaSqM = totalPanels * panelWidthM * panelHeightM;
  const totalRoofAreaSqM = roofPlanes.reduce((s, p) => s + p.areaSqM, 0);
  const roofUtilizationPercent = Math.min(95, Math.round((totalPanelAreaSqM / totalRoofAreaSqM) * 100));

  // Add orientation note
  if (optimalAzimuth !== 180) {
    designNotes.push(`Note: South-facing (180°) is optimal. Current azimuth: ${optimalAzimuth}°`);
  }
  designNotes.push(`Optimal tilt for ${lat.toFixed(1)}°N latitude: ${optimalTilt}°`);

  return {
    success: true,
    roofPlanes,
    totalPanels,
    totalSystemKw: actualSystemKw,
    recommendedTilt: optimalTilt,
    recommendedAzimuth: optimalAzimuth,
    estimatedAnnualKwh,
    specificYield,
    roofUtilizationPercent,
    designNotes,
  };
}