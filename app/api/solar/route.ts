export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { RoofPlane, RoofEdgeType, SolarApiSegment } from '@/types';
import { requireAuth } from '@/lib/security';

const GOOGLE_SOLAR_API_KEY =
  process.env.GOOGLE_SOLAR_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

// ─── Geometry helpers ────────────────────────────────────────────────────────

const rad = (d: number) => (d * Math.PI) / 180;

function offsetLatLng(
  lat: number, lng: number, dxE: number, dyN: number
): { lat: number; lng: number } {
  return {
    lat: lat + dyN / 111320,
    lng: lng + dxE / (111320 * Math.cos(rad(lat))),
  };
}

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Reconstruct a 4-vertex polygon for a roof segment.
 *
 * Vertex order (clockwise from top-left when facing the slope):
 *   [0] ridge-left   [1] ridge-right
 *   [3] eave-left    [2] eave-right
 *
 * The "ridge" side is opposite the azimuth direction (up-slope).
 * The "eave" side is in the azimuth direction (down-slope / facing direction).
 */
function reconstructPolygon(seg: SolarApiSegment): { lat: number; lng: number }[] {
  const clat = seg.center.latitude;
  const clng = seg.center.longitude;

  // Bounding box half-dimensions
  const bbW = distanceM(
    { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.sw.longitude },
    { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.ne.longitude }
  ) / 2;
  const bbH = distanceM(
    { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.sw.longitude },
    { lat: seg.boundingBox.ne.latitude, lng: seg.boundingBox.sw.longitude }
  ) / 2;

  // Small margin so adjacent planes visually touch
  const hw = bbW * 1.02;
  const hd = bbH * 1.02;

  // azimuth = down-slope direction; ridge is opposite (up-slope)
  const az      = rad(seg.azimuthDegrees);
  const perpAz  = az + Math.PI / 2;

  const downE  = Math.sin(az);      const downN  = Math.cos(az);
  const rightE = Math.sin(perpAz);  const rightN = Math.cos(perpAz);

  return [
    offsetLatLng(clat, clng, -rightE * hw - downE * hd, -rightN * hw - downN * hd), // [0] ridge-left
    offsetLatLng(clat, clng,  rightE * hw - downE * hd,  rightN * hw - downN * hd), // [1] ridge-right
    offsetLatLng(clat, clng,  rightE * hw + downE * hd,  rightN * hw + downN * hd), // [2] eave-right
    offsetLatLng(clat, clng, -rightE * hw + downE * hd, -rightN * hw + downN * hd), // [3] eave-left
  ];
}

/**
 * Default edge types for a 4-vertex polygon from reconstructPolygon():
 *   edge 0: [0]→[1] = top  = ridge
 *   edge 1: [1]→[2] = right = rake
 *   edge 2: [2]→[3] = bottom = eave
 *   edge 3: [3]→[0] = left  = rake
 */
function defaultEdgeTypes(): RoofEdgeType[] {
  return ['ridge', 'rake', 'eave', 'rake'];
}

/**
 * Detect shared edges between all pairs of polygons.
 * A shared edge = two edge midpoints within 3m of each other.
 * Returns Map<segIndex, Array<{neighborIdx, edgeIdx}>>
 */
function detectAdjacencies(
  polygons: { lat: number; lng: number }[][]
): Map<number, { neighborIdx: number; edgeIdx: number }[]> {
  const result = new Map<number, { neighborIdx: number; edgeIdx: number }[]>();

  for (let i = 0; i < polygons.length; i++) {
    result.set(i, []);
  }

  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const polyI = polygons[i];
      const polyJ = polygons[j];

      for (let ei = 0; ei < polyI.length; ei++) {
        const mI = {
          lat: (polyI[ei].lat + polyI[(ei + 1) % polyI.length].lat) / 2,
          lng: (polyI[ei].lng + polyI[(ei + 1) % polyI.length].lng) / 2,
        };
        for (let ej = 0; ej < polyJ.length; ej++) {
          const mJ = {
            lat: (polyJ[ej].lat + polyJ[(ej + 1) % polyJ.length].lat) / 2,
            lng: (polyJ[ej].lng + polyJ[(ej + 1) % polyJ.length].lng) / 2,
          };
          if (distanceM(mI, mJ) < 2.5) { // tightened: 2.5m catches shared edges, avoids false positives
            result.get(i)!.push({ neighborIdx: j, edgeIdx: ei });
            result.get(j)!.push({ neighborIdx: i, edgeIdx: ej });
          }
        }
      }
    }
  }

  return result;
}

/**
 * Refine edge types using adjacency data and plane heights.
 * Shared side edges become 'hip'.
 * If the shared edge is the "top" (index 0, normally ridge) and the neighbor
 * is also pointing roughly opposite, it stays 'ridge' (two planes meeting at ridge).
 * If a shared edge has the neighbor HIGHER than self, it's a 'valley'.
 */
function refineEdgeTypes(
  baseTypes: RoofEdgeType[],
  segIdx: number,
  adjacencies: { neighborIdx: number; edgeIdx: number }[],
  segments: SolarApiSegment[]
): RoofEdgeType[] {
  const types = [...baseTypes] as RoofEdgeType[];
  const selfHeight = segments[segIdx].planeHeightAtCenterMeters;

  for (const { neighborIdx, edgeIdx } of adjacencies) {
    const neighborHeight = segments[neighborIdx].planeHeightAtCenterMeters;
    const neighborAz     = segments[neighborIdx].azimuthDegrees;
    const selfAz         = segments[segIdx].azimuthDegrees;

    // If edge 0 (ridge side) is shared and neighbor faces opposite direction
    // → this is a true ridge between two slopes (keep as 'ridge')
    if (edgeIdx === 0) {
      const azDiff = Math.abs(((neighborAz - selfAz + 540) % 360) - 180);
      if (azDiff > 120) {
        types[0] = 'ridge'; // confirmed ridge
      } else {
        // Same-direction neighbors sharing top edge = hip return
        types[0] = 'hip';
      }
    } else if (edgeIdx === 2) {
      // Eave edge shared = wall or valley
      types[2] = neighborHeight > selfHeight ? 'valley' : 'eave';
    } else {
      // Side edges (1 or 3)
      types[edgeIdx] = neighborHeight > selfHeight ? 'valley' : 'hip';
    }
  }

  return types;
}

/**
 * Full pipeline: Solar API segments → RoofPlane[]
 */
function buildRoofPlanes(segments: SolarApiSegment[]): RoofPlane[] {
  const polygons    = segments.map(seg => reconstructPolygon(seg));
  const adjacencies = detectAdjacencies(polygons);

  return segments.map((seg, i) => {
    const adj      = adjacencies.get(i) || [];
    const baseTypes = defaultEdgeTypes();
    const edgeTypes = refineEdgeTypes(baseTypes, i, adj, segments);
    const neighborIds = [...new Set(adj.map(a => `solar-segment-${a.neighborIdx}`))];

    const sunshineHours = seg.stats.sunshineQuantiles?.[5] ?? 0;

    const plane: RoofPlane = {
      id:          `solar-segment-${i}`,
      vertices:    polygons[i],
      pitch:       Math.round(seg.pitchDegrees * 10) / 10,
      azimuth:     Math.round(seg.azimuthDegrees * 10) / 10,
      area:        Math.round(seg.stats.areaMeters2 * 100) / 100,
      usableArea:  Math.round(seg.stats.areaMeters2 * 0.75 * 100) / 100,
      // v47.156: Set centroid from Solar API segment center (explicit, no fallback needed)
      centroidLat: seg.center.latitude,
      centroidLng: seg.center.longitude,
      edgeTypes,
      adjacentPlaneIds:         neighborIds.length > 0 ? neighborIds : undefined,
      source:                   'solar_api',
      solarSegmentIndex:        i,
      planeHeightAtCenterMeters: seg.planeHeightAtCenterMeters,
      confirmed:                false,
      sunshineHoursPerYear:     sunshineHours > 0 ? Math.round(sunshineHours) : undefined,
    };

    return plane;
  });
}

// ─── GET /api/solar — original proxy (unchanged) ─────────────────────────────
export async function GET(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');
  const lat      = searchParams.get('lat');
  const lng      = searchParams.get('lng');
  const quality  = searchParams.get('quality') || 'HIGH';

  if (!endpoint || !lat || !lng) {
    return NextResponse.json(
      { error: 'Missing required parameters: endpoint, lat, lng' },
      { status: 400 }
    );
  }

  try {
    let url = '';
    if (endpoint === 'buildingInsights') {
      url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`;
    } else if (endpoint === 'dataLayers') {
      url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`;
    } else {
      return NextResponse.json(
        { error: 'Invalid endpoint. Use: buildingInsights or dataLayers' },
        { status: 400 }
      );
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Google Solar API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }
    return NextResponse.json(await response.json());
  } catch (error: unknown) {
    return handleRouteDbError('[solar/GET]', error);
  }
}

// ─── POST /api/solar — reconstruct RoofPlanes from Solar API ─────────────────
// Body:    { lat: number, lng: number, quality?: 'LOW'|'MEDIUM'|'HIGH' }
// Returns: { success: true, roofPlanes: RoofPlane[], raw: {...} }
//       or { success: false, error: string, roofPlanes: [], code: string }
export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    const body = await req.json();
    const { lat, lng, quality = 'LOW' } = body as {
      lat: number;
      lng: number;
      quality?: string;
    };

    if (!lat || !lng) {
      return NextResponse.json(
        { success: false, error: 'lat and lng are required', roofPlanes: [] },
        { status: 400 }
      );
    }

    const solarUrl =
      `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
      `?location.latitude=${lat}&location.longitude=${lng}` +
      `&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`;

    let solarRes: Response;
    try {
      solarRes = await fetch(solarUrl, { signal: AbortSignal.timeout(12000) });
    } catch {
      return NextResponse.json({
        success:    false,
        error:      'Solar API request timed out',
        roofPlanes: [],
        code:       'TIMEOUT',
      });
    }

    if (!solarRes.ok) {
      const errText = await solarRes.text();
      console.warn('[solar/POST] Solar API error:', solarRes.status, errText.substring(0, 200));
      return NextResponse.json({
        success:    false,
        error:      'Solar API unavailable for this location',
        roofPlanes: [],
        code:       'SOLAR_API_UNAVAILABLE',
      });
    }

    const solarJson = await solarRes.json() as any;
    const rawSegs   = solarJson.solarPotential?.roofSegmentStats ?? [];

    if (rawSegs.length === 0) {
      return NextResponse.json({
        success:    false,
        error:      'No roof segments found for this location',
        roofPlanes: [],
        code:       'NO_SEGMENTS',
      });
    }

    const enriched: SolarApiSegment[] = rawSegs.map((s: any, i: number) => ({
      pitchDegrees:              s.pitchDegrees              ?? 0,
      azimuthDegrees:            s.azimuthDegrees             ?? 180,
      center:                    s.center,
      boundingBox:               s.boundingBox,
      planeHeightAtCenterMeters: s.planeHeightAtCenterMeters  ?? 0,
      stats: {
        areaMeters2:       s.stats?.areaMeters2       ?? 0,
        groundAreaMeters2: s.stats?.groundAreaMeters2  ?? 0,
        sunshineQuantiles: s.stats?.sunshineQuantiles  ?? [],
      },
      segmentIndex: i,
    }));

    const roofPlanes = buildRoofPlanes(enriched);

    console.log(`[solar/POST] Built ${roofPlanes.length} roof planes for (${lat}, ${lng})`);

    return NextResponse.json({
      success: true,
      roofPlanes,
      raw: {
        segmentCount:    rawSegs.length,
        imageryDate:     solarJson.imageryDate,
        imageryQuality:  solarJson.imageryQuality,
        maxArrayPanels:  solarJson.solarPotential?.maxArrayPanelsCount,
        buildingCenter:  solarJson.center,
        wholeRoofAreaM2: solarJson.solarPotential?.wholeRoofStats?.areaMeters2,
      },
    });
  } catch (error: unknown) {
    return handleRouteDbError('[solar/POST]', error);
  }
}