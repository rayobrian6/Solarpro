/**
 * Digital Twin Data Pipeline
 * Automatically fetches all required geospatial data for a property
 */

export interface ParcelData {
  boundary: Array<{ lat: number; lng: number }>;
  area: number; // m²
  setbackMeters: number;
  easements: EasementZone[];
  address: string;
  parcelId?: string;
}

export interface EasementZone {
  type: 'utility' | 'access' | 'drainage' | 'setback';
  boundary: Array<{ lat: number; lng: number }>;
  widthMeters: number;
  description: string;
}

export interface TerrainPoint {
  lat: number;
  lng: number;
  elevation: number;
}

export interface DigitalTwinData {
  lat: number;
  lng: number;
  address: string;
  elevation: number;
  elevationGrid: TerrainPoint[];
  solarData: any;
  parcel: ParcelData | null;
  roofSegments: RoofSegment[];
  buildingFootprint: Array<{ lat: number; lng: number }>;
}

export interface RoofSegment {
  id: string;
  center: { lat: number; lng: number };
  elevation: number;          // absolute elevation (baseElevation + heightAboveGround)
  heightAboveGround: number;  // meters above terrain (for panel placement)
  pitchDegrees: number;
  azimuthDegrees: number;
  areaM2: number;
  sunshineHours: number;
  usableAreaM2: number;       // area after setbacks
  maxPanels: number;          // realistic max panels
  boundingBox: {
    sw: { lat: number; lng: number };
    ne: { lat: number; lng: number };
  };
  corners: Array<{ lat: number; lng: number; alt: number }>;
  // Polygon corners in lat/lng for accurate panel filling
  polygon: Array<{ lat: number; lng: number }>;
  // Convex hull derived from Google's actual panel positions — most accurate roof shape
  convexHull: Array<{ lat: number; lng: number }>;
  // Google's pre-computed panel positions for this segment
  googlePanels: Array<{ lat: number; lng: number; orientation: string; yearlyEnergyDcKwh: number }>;
  // Panel dimensions from Google API
  panelWidthMeters: number;
  panelHeightMeters: number;
}

const GOOGLE_API_KEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

// Standard panel dimensions (400W)
const PANEL_W = 1.134; // meters
const PANEL_H = 1.722; // meters
const SETBACK_M = 0.5; // 0.5m setback from roof edges

/**
 * Full automatic data pipeline for a property
 */
export async function buildDigitalTwin(
  lat: number,
  lng: number,
  address: string
): Promise<DigitalTwinData> {
  // Run all API calls in parallel — including DSM for real roof geometry
  const [elevationData, solarData, elevationGrid, dsmData] = await Promise.allSettled([
    fetchElevation(lat, lng),
    fetchSolarData(lat, lng),
    fetchElevationGrid(lat, lng, 5),
    fetchDsmRoofPlanes(lat, lng),
  ]);

  const elevation = elevationData.status === 'fulfilled' ? elevationData.value : 0;
  const solar     = solarData.status === 'fulfilled' ? solarData.value : null;
  const grid      = elevationGrid.status === 'fulfilled' ? elevationGrid.value : [];
  const dsm       = dsmData.status === 'fulfilled' ? dsmData.value : null;

  // Extract roof segments from Solar API (for sunshine hours, panel positions, etc.)
  const solarSegments = solar ? extractRoofSegments(solar, elevation) : [];

  // Merge DSM roof planes with Solar API segments:
  // DSM gives us accurate polygon geometry; Solar API gives us sunshine hours & panel positions.
  // Match each DSM plane to the nearest Solar API segment by center proximity + azimuth similarity.
  const roofSegments = dsm?.roofPlanes?.length
    ? mergeDsmWithSolar(dsm.roofPlanes, solarSegments, elevation)
    : solarSegments;

  const buildingFootprint = estimateBuildingFootprint(roofSegments, lat, lng);
  const parcel = estimateParcel(lat, lng, buildingFootprint);

  return {
    lat, lng, address, elevation,
    elevationGrid: grid,
    solarData: solar,
    parcel,
    roofSegments,
    buildingFootprint,
  };
}

/**
 * Fetch DSM-derived roof planes from our /api/dsm endpoint
 */
async function fetchDsmRoofPlanes(lat: number, lng: number): Promise<any> {
  try {
    const baseUrl = typeof window !== 'undefined'
      ? ''
      : `http://localhost:${process.env.PORT || 3000}`;
    const res = await fetch(`${baseUrl}/api/dsm?lat=${lat}&lng=${lng}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Merge DSM roof planes (accurate geometry) with Solar API segments (sunshine/panels).
 * For each DSM plane, find the best-matching Solar segment and inherit its data.
 */
function mergeDsmWithSolar(
  dsmPlanes: any[],
  solarSegs: RoofSegment[],
  baseElevation: number
): RoofSegment[] {
  const mLat = 111320;

  return dsmPlanes.map((dsm: any, i: number) => {
    // Find best matching solar segment: closest center + similar azimuth
    let bestSolar: RoofSegment | null = null;
    let bestScore = Infinity;

    for (const seg of solarSegs) {
      const dLat = (dsm.center.lat - seg.center.lat) * mLat;
      const dLng = (dsm.center.lng - seg.center.lng) * mLat * Math.cos(dsm.center.lat * Math.PI / 180);
      const distM = Math.sqrt(dLat*dLat + dLng*dLng);
      const azDiff = Math.abs(((dsm.azimuthDegrees - seg.azimuthDegrees + 540) % 360) - 180);
      const score = distM + azDiff * 0.5; // weight distance more than azimuth
      if (score < bestScore) { bestScore = score; bestSolar = seg; }
    }

    // Use DSM elevation (more accurate) with geoid correction
    const dsmElev = isFinite(dsm.elevationM) ? dsm.elevationM : baseElevation;

    // Build corners from DSM polygon with elevation
    const corners = dsm.polygon.map((p: any) => ({
      lat: p.lat, lng: p.lng, alt: dsmElev,
    }));

    return {
      id: `dsm-${i}`,
      center: dsm.center,
      elevation: dsmElev,
      heightAboveGround: Math.max(0, dsmElev - baseElevation),
      pitchDegrees: dsm.pitchDegrees,
      azimuthDegrees: dsm.azimuthDegrees,
      areaM2: dsm.areaM2,
      sunshineHours: bestSolar?.sunshineHours ?? 1000,
      usableAreaM2: dsm.areaM2 * 0.82,
      maxPanels: Math.floor(dsm.areaM2 * 0.82 / 2.0),
      boundingBox: bestSolar?.boundingBox ?? {
        sw: { lat: dsm.center.lat - 0.0001, lng: dsm.center.lng - 0.0001 },
        ne: { lat: dsm.center.lat + 0.0001, lng: dsm.center.lng + 0.0001 },
      },
      corners,
      polygon: dsm.polygon,
      // Use DSM polygon as convex hull (it IS the real roof shape)
      convexHull: dsm.polygon,
      // Inherit Google panel positions from matched solar segment
      googlePanels: bestSolar?.googlePanels ?? [],
      panelWidthMeters: bestSolar?.panelWidthMeters ?? 1.045,
      panelHeightMeters: bestSolar?.panelHeightMeters ?? 1.879,
    } as RoofSegment;
  });
}

/**
 * Fetch single point elevation via server-side API route
 * (avoids CORS issues when called from browser)
 */
export async function fetchElevation(lat: number, lng: number): Promise<number> {
  try {
    // Use server-side API route to avoid CORS/network restrictions in browser
    const res = await fetch(`/api/elevation?lat=${lat}&lng=${lng}`);
    if (res.ok) {
      const data = await res.json();
      if (typeof data.elevation === 'number' && isFinite(data.elevation) && data.elevation > 0) {
        return data.elevation;
      }
    }
  } catch {}

  // Fallback: try direct Google API (works server-side)
  try {
    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.results?.[0]) return data.results[0].elevation;
  } catch {}

  return 0;
}

/**
 * Fetch elevation grid for terrain mesh
 */
export async function fetchElevationGrid(
  lat: number, lng: number, gridSize: number
): Promise<TerrainPoint[]> {
  const mPerDeg = 111320;
  const spanMeters = 100; // 100m around property
  const step = spanMeters / (gridSize - 1);

  const locations: string[] = [];
  const points: { lat: number; lng: number }[] = [];

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const dlat = (i - (gridSize - 1) / 2) * step / mPerDeg;
      const dlng = (j - (gridSize - 1) / 2) * step / (mPerDeg * Math.cos(lat * Math.PI / 180));
      const pt = { lat: lat + dlat, lng: lng + dlng };
      points.push(pt);
      locations.push(`${pt.lat},${pt.lng}`);
    }
  }

  try {
    // Use server-side API route for elevation grid
    const locStr = locations.join('|');
    const url = `/api/elevation?locations=${encodeURIComponent(locStr)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.results) {
        return data.results.map((r: any, i: number) => ({
          lat: points[i].lat,
          lng: points[i].lng,
          elevation: r.elevation,
        }));
      }
    }
  } catch {}

  // Fallback: direct Google API
  try {
    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${locations.join('|')}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    return data.results?.map((r: any, i: number) => ({
      lat: points[i].lat,
      lng: points[i].lng,
      elevation: r.elevation,
    })) ?? [];
  } catch {
    return points.map(p => ({ ...p, elevation: 0 }));
  }
}

/**
 * Fetch Google Solar API building insights
 */
export async function fetchSolarData(lat: number, lng: number): Promise<any> {
  const res = await fetch(
    `/api/solar?endpoint=buildingInsights&lat=${lat}&lng=${lng}&quality=HIGH`
  );
  if (!res.ok) throw new Error(`Solar API: ${res.status}`);
  return res.json();
}

/**
 * Convert meters offset to lat/lng delta
 */
function metersToLatDelta(meters: number): number {
  return meters / 111320;
}
function metersToLngDelta(meters: number, lat: number): number {
  return meters / (111320 * Math.cos(lat * Math.PI / 180));
}

/**
 * Compute accurate roof polygon corners from Solar API segment data.
 *
 * Strategy: derive ridge-length and slope-width from groundAreaMeters2 and the
 * bounding box, then build a rectangle aligned to the roof's actual azimuth.
 *
 * The Google Solar API bounding box is axis-aligned (lat/lng), so its W and H
 * dimensions correspond to the ground-projected extents along E-W and N-S axes.
 * For a roof segment with azimuth Az:
 *   - Ridge direction is perpendicular to Az (along the roof peak)
 *   - Slope direction is along Az (downhill direction)
 *
 * We use groundAreaMeters2 as the authoritative area and back-calculate the
 * actual ridge length and slope width so the polygon area matches reality.
 */
function computeRoofPolygon(
  centerLat: number,
  centerLng: number,
  swLat: number, swLng: number,
  neLat: number, neLng: number,
  pitchDeg: number,
  azimuthDeg: number,
  baseElev: number,
  groundAreaM2: number = 0
): { corners: Array<{ lat: number; lng: number; alt: number }>; polygon: Array<{ lat: number; lng: number }> } {

  // Validate all inputs
  const safeCenterLat = isFinite(centerLat) ? centerLat : 0;
  const safeCenterLng = isFinite(centerLng) ? centerLng : 0;
  const safeSwLat = isFinite(swLat) ? swLat : safeCenterLat - 0.0001;
  const safeSwLng = isFinite(swLng) ? swLng : safeCenterLng - 0.0001;
  const safeNeLat = isFinite(neLat) ? neLat : safeCenterLat + 0.0001;
  const safeNeLng = isFinite(neLng) ? neLng : safeCenterLng + 0.0001;
  const safePitch = isFinite(pitchDeg) ? Math.max(0, Math.min(75, pitchDeg)) : 20;
  const safeAzimuth = isFinite(azimuthDeg) ? azimuthDeg : 180;
  const safeElev = isFinite(baseElev) ? baseElev : 0;

  const mLat = 111320;
  const cosLat = Math.cos(safeCenterLat * Math.PI / 180);
  const mLng = isFinite(cosLat) && cosLat > 0.001 ? 111320 * cosLat : 111320;

  // Bounding box dimensions in meters (axis-aligned)
  const bbW = Math.max(0.5, (safeNeLng - safeSwLng) * mLng); // E-W extent
  const bbH = Math.max(0.5, (safeNeLat - safeSwLat) * mLat); // N-S extent

  const azRad = safeAzimuth * Math.PI / 180;
  const pitchRad = safePitch * Math.PI / 180;

  // Ridge direction (perpendicular to downslope / azimuth)
  const ridgeE = Math.cos(azRad);
  const ridgeN = -Math.sin(azRad);
  // Downslope direction (along azimuth)
  const slopeE = Math.sin(azRad);
  const slopeN = Math.cos(azRad);

  // Project bounding box onto ridge and slope axes to get initial extents
  // The BB corners project onto ridge/slope axes; take the max projection
  const bbCorners = [
    { e: -bbW / 2, n: -bbH / 2 },
    { e:  bbW / 2, n: -bbH / 2 },
    { e:  bbW / 2, n:  bbH / 2 },
    { e: -bbW / 2, n:  bbH / 2 },
  ];
  const ridgeProjs = bbCorners.map(c => Math.abs(c.e * ridgeE + c.n * ridgeN));
  const slopeProjs = bbCorners.map(c => Math.abs(c.e * slopeE + c.n * slopeN));
  let halfRidge = Math.max(...ridgeProjs);
  let halfSlope = Math.max(...slopeProjs);

  // If we have a reliable groundArea, use it to correct the dimensions.
  // groundArea = ridgeLength * slopeWidth (ground-projected slope width)
  // We keep the aspect ratio from the bounding box projection but scale to match area.
  if (groundAreaM2 > 1) {
    const currentArea = (2 * halfRidge) * (2 * halfSlope);
    if (currentArea > 0.1) {
      const scale = Math.sqrt(groundAreaM2 / currentArea);
      halfRidge *= scale;
      halfSlope *= scale;
    }
  }

  // Elevation change from center to eave/ridge along slope
  const tanPitch = Math.tan(pitchRad);
  const elevDelta = isFinite(tanPitch) ? tanPitch * halfSlope : 0;

  // 4 corners of the roof plane rectangle, oriented along ridge/slope axes:
  // upslope = toward ridge (higher elevation), downslope = toward eave (lower)
  const corners3D = [
    // eave-left:  -ridge, -slope (downslope-left)
    { dE: -halfRidge * ridgeE - halfSlope * slopeE, dN: -halfRidge * ridgeN - halfSlope * slopeN, dElev: -elevDelta },
    // eave-right: +ridge, -slope (downslope-right)
    { dE:  halfRidge * ridgeE - halfSlope * slopeE, dN:  halfRidge * ridgeN - halfSlope * slopeN, dElev: -elevDelta },
    // ridge-right: +ridge, +slope (upslope-right)
    { dE:  halfRidge * ridgeE + halfSlope * slopeE, dN:  halfRidge * ridgeN + halfSlope * slopeN, dElev:  elevDelta },
    // ridge-left:  -ridge, +slope (upslope-left)
    { dE: -halfRidge * ridgeE + halfSlope * slopeE, dN: -halfRidge * ridgeN + halfSlope * slopeN, dElev:  elevDelta },
  ];

  const corners = corners3D.map(c => {
    const lat = safeCenterLat + c.dN / mLat;
    const lng = safeCenterLng + c.dE / mLng;
    const alt = safeElev + c.dElev;
    return {
      lat: isFinite(lat) ? lat : safeCenterLat,
      lng: isFinite(lng) ? lng : safeCenterLng,
      alt: isFinite(alt) ? alt : safeElev,
    };
  });

  const polygon = corners.map(c => ({ lat: c.lat, lng: c.lng }));
  return { corners, polygon };
}

/**
 * Calculate usable area after setbacks and estimate max panels
 */
function calcUsableArea(areaM2: number, pitchDeg: number): { usableAreaM2: number; maxPanels: number } {
  // Apply setback reduction (typically ~15-20% for residential)
  const setbackFactor = 0.82;
  const usableAreaM2 = areaM2 * setbackFactor;

  // Panel area including spacing
  const panelAreaWithSpacing = (PANEL_W + 0.05) * (PANEL_H + 0.1);

  // Packing efficiency (accounts for irregular shapes, obstructions)
  const packingEfficiency = 0.85;

  const maxPanels = Math.floor((usableAreaM2 * packingEfficiency) / panelAreaWithSpacing);

  return { usableAreaM2, maxPanels };
}

/**
 * Extract structured roof segments from Solar API response
 * Fixed version with accurate corner computation
 */
// ─── Convex Hull (Graham scan) ────────────────────────────────────────────────
function convexHull(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  if (points.length < 3) return points;
  // Sort by lat then lng
  const pts = [...points].sort((a, b) => a.lat !== b.lat ? a.lat - b.lat : a.lng - b.lng);
  const cross = (O: any, A: any, B: any) =>
    (A.lng - O.lng) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lng - O.lng);
  const lower: any[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: any[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return [...lower, ...upper];
}

// Expand a convex hull outward by `marginM` meters (to cover panel edges, not just centers)
function expandHull(
  hull: Array<{ lat: number; lng: number }>,
  marginM: number,
  centerLat: number
): Array<{ lat: number; lng: number }> {
  if (hull.length < 3) return hull;
  const mLat = 111320;
  const mLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  // Centroid
  const cx = hull.reduce((s, p) => s + p.lng, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.lat, 0) / hull.length;
  return hull.map(p => {
    const dx = (p.lng - cx) * mLng;
    const dy = (p.lat - cy) * mLat;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      lat: p.lat + (dy / dist) * marginM / mLat,
      lng: p.lng + (dx / dist) * marginM / mLng,
    };
  });
}

export function extractRoofSegments(solarData: any, baseElevation: number): RoofSegment[] {
  const segments = solarData?.solarPotential?.roofSegmentStats ?? [];
  // Google's pre-computed panel positions grouped by segmentIndex
  const allGooglePanels: any[] = solarData?.solarPotential?.solarPanels ?? [];
  const panelsBySegment = new Map<number, any[]>();
  for (const p of allGooglePanels) {
    const si = p.segmentIndex ?? -1;
    if (!panelsBySegment.has(si)) panelsBySegment.set(si, []);
    panelsBySegment.get(si)!.push(p);
  }
  const apiPanelW: number = solarData?.solarPotential?.panelWidthMeters ?? 1.045;
  const apiPanelH: number = solarData?.solarPotential?.panelHeightMeters ?? 1.879;

  return segments.map((seg: any, i: number) => {
    const centerLat = seg.center?.latitude ?? 0;
    const centerLng = seg.center?.longitude ?? 0;
    const pitchDeg = seg.pitchDegrees ?? 0;
    const azimuthDeg = seg.azimuthDegrees ?? 180;
    const areaM2 = seg.stats?.areaMeters2 ?? 0;
    const sunshineHours = seg.stats?.sunshineQuantiles?.[5] ?? 0;

    // planeHeightAtCenterMeters is absolute elevation (meters above sea level).
    // We need height-above-ground for Cesium rendering (which adds to terrain).
    // Subtract baseElevation (ground level) to get roof height above ground.
    const absElev = seg.planeHeightAtCenterMeters != null
      ? seg.planeHeightAtCenterMeters
      : baseElevation;
    // Height above ground: how many meters the roof center is above terrain
    const heightAboveGround = Math.max(0, absElev - baseElevation);
    // For Cesium rendering we use terrain elevation + heightAboveGround
    const elev = baseElevation + heightAboveGround;

    // Bounding box from API
    const bb = seg.boundingBox ?? {};
    const sw = bb.sw ?? { latitude: centerLat - 0.0001, longitude: centerLng - 0.0001 };
    const ne = bb.ne ?? { latitude: centerLat + 0.0001, longitude: centerLng + 0.0001 };

    // Compute fallback polygon corners from bounding box + pitch/azimuth
    const groundAreaM2 = seg.stats?.groundAreaMeters2 ?? 0;
    const { corners, polygon } = computeRoofPolygon(
      centerLat, centerLng,
      sw.latitude, sw.longitude,
      ne.latitude, ne.longitude,
      pitchDeg, azimuthDeg,
      elev,
      groundAreaM2
    );

    // Build convex hull from Google's actual panel positions (most accurate roof shape)
    const segGooglePanels = panelsBySegment.get(i) ?? [];
    const panelCenters = segGooglePanels.map((p: any) => ({
      lat: p.center.latitude,
      lng: p.center.longitude,
    }));

    // Expand hull by half panel diagonal to cover full panel area (not just centers)
    const halfDiag = Math.sqrt(apiPanelW * apiPanelW + apiPanelH * apiPanelH) / 2;
    const rawHull = panelCenters.length >= 3
      ? convexHull(panelCenters)
      : panelCenters.length > 0
        ? panelCenters
        : polygon; // fallback to computed polygon if no panels
    const hull = rawHull.length >= 3
      ? expandHull(rawHull, halfDiag + 0.3, centerLat) // +0.3m extra margin
      : rawHull;

    // Calculate usable area and max panels
    const { usableAreaM2, maxPanels } = calcUsableArea(areaM2, pitchDeg);

    return {
      id: `seg-${i}`,
      center: { lat: centerLat, lng: centerLng },
      elevation: elev,
      heightAboveGround: heightAboveGround,
      pitchDegrees: pitchDeg,
      azimuthDegrees: azimuthDeg,
      areaM2,
      sunshineHours,
      usableAreaM2,
      maxPanels,
      boundingBox: {
        sw: { lat: sw.latitude, lng: sw.longitude },
        ne: { lat: ne.latitude, lng: ne.longitude },
      },
      corners,
      polygon,
      convexHull: hull,
      googlePanels: segGooglePanels.map((p: any) => ({
        lat: p.center.latitude,
        lng: p.center.longitude,
        orientation: p.orientation ?? 'LANDSCAPE',
        yearlyEnergyDcKwh: p.yearlyEnergyDcKwh ?? 0,
      })),
      panelWidthMeters: apiPanelW,
      panelHeightMeters: apiPanelH,
    };
  });
}

/**
 * Estimate building footprint from roof segments
 */
function estimateBuildingFootprint(
  segments: RoofSegment[],
  lat: number, lng: number
): Array<{ lat: number; lng: number }> {
  if (segments.length === 0) {
    // Default 15x12m footprint
    const mLat = 111320;
    const mLng = mLat * Math.cos(lat * Math.PI / 180);
    const hw = 7.5 / mLng, hh = 6 / mLat;
    return [
      { lat: lat - hh, lng: lng - hw },
      { lat: lat - hh, lng: lng + hw },
      { lat: lat + hh, lng: lng + hw },
      { lat: lat + hh, lng: lng - hw },
    ];
  }

  // Union of all segment bounding boxes
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  segments.forEach(s => {
    minLat = Math.min(minLat, s.boundingBox.sw.lat);
    maxLat = Math.max(maxLat, s.boundingBox.ne.lat);
    minLng = Math.min(minLng, s.boundingBox.sw.lng);
    maxLng = Math.max(maxLng, s.boundingBox.ne.lng);
  });

  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ];
}

/**
 * Estimate parcel boundary (setback from building footprint)
 * In production this would use Regrid/Parcel API
 */
function estimateParcel(
  lat: number, lng: number,
  footprint: Array<{ lat: number; lng: number }>
): ParcelData {
  const mLat = 111320;
  const mLng = mLat * Math.cos(lat * Math.PI / 180);

  // Typical residential lot: 30m x 40m
  const lotW = 15 / mLng;
  const lotH = 20 / mLat;

  const boundary = [
    { lat: lat - lotH, lng: lng - lotW },
    { lat: lat - lotH, lng: lng + lotW },
    { lat: lat + lotH, lng: lng + lotW },
    { lat: lat + lotH, lng: lng - lotW },
  ];

  const easements: EasementZone[] = [
    {
      type: 'setback',
      description: 'Front setback (6m)',
      widthMeters: 6,
      boundary: [
        { lat: lat - lotH, lng: lng - lotW },
        { lat: lat - lotH, lng: lng + lotW },
        { lat: lat - lotH + 6 / mLat, lng: lng + lotW },
        { lat: lat - lotH + 6 / mLat, lng: lng - lotW },
      ],
    },
    {
      type: 'utility',
      description: 'Rear utility easement (3m)',
      widthMeters: 3,
      boundary: [
        { lat: lat + lotH - 3 / mLat, lng: lng - lotW },
        { lat: lat + lotH - 3 / mLat, lng: lng + lotW },
        { lat: lat + lotH, lng: lng + lotW },
        { lat: lat + lotH, lng: lng - lotW },
      ],
    },
  ];

  return {
    boundary,
    area: (lotW * 2 * mLng) * (lotH * 2 * mLat),
    setbackMeters: 1.5,
    easements,
    address: '',
  };
}