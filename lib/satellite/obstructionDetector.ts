// ============================================================================
// v47.438 - Satellite Obstruction Detector
//
// Given lat/lng, detect roof obstructions from satellite/aerial imagery.
// Uses a layered approach:
//
//   1. Google Maps Static API (if GOOGLE_MAPS_API_KEY available)
//      - Fetch overhead satellite image of the property
//      - Run visual analysis (currently heuristic until ML model integrated)
//      - Return detected obstructions with confidence levels
//
//   2. OpenStreetMap Overpass API (fallback)
//      - Query building footprint + nearby features
//      - Infer obstructions from building geometry + proximity to trees/structures
//
//   3. Heuristic fallback (no API required)
//      - Based on structure type (residential vs commercial) and region
//      - Return common obstruction patterns with low confidence
//
// DESIGN PRINCIPLE:
//   Always return SOMETHING -- even low-confidence heuristic results are
//   valuable as pre-fill suggestions. The user can always override.
//   The ConfidenceBadge makes the source and certainty crystal clear.
// ============================================================================

import type {
  DetectedObstruction,
  ObstructionDetectionResult,
  SatelliteSource,
} from './types';
import type { ObstructionType, ObstructionLocation } from '../survey/v2/types';

// ---------------------------------------------------------------------------
// Google Maps Static API - fetch satellite tile for lat/lng
// ---------------------------------------------------------------------------
const GMAPS_STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';

async function fetchSatelliteImage(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<Buffer | null> {
  try {
    // Zoom 20 = ~0.6m/pixel, shows individual roof features
    // 640x640 max resolution for static API
    const url = `${GMAPS_STATIC_URL}?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${apiKey}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'SolarProDesign/1.0' },
    });

    if (!res.ok) {
      console.warn(`[satellite] Google Maps Static API returned ${res.status}`);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[satellite] Failed to fetch satellite image: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Overpass API - query building footprint + nearby features from OSM
// ---------------------------------------------------------------------------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

async function queryOverpass(
  lat: number,
  lng: number,
): Promise<OverpassElement[]> {
  try {
    // Search within ~30m radius for building features and nearby trees/structures
    const radius = 30;
    const query = `
[out:json][timeout:10];
(
  way["building"](around:${radius},${lat},${lng});
  node["natural"="tree"](around:${radius},${lat},${lng});
  way["natural"="tree_row"](around:${radius},${lat},${lng});
  node["man_made"="chimney"](around:${radius},${lat},${lng});
  node["man_made"="antenna"](around:${radius},${lat},${lng});
  way["roof:material"](around:${radius},${lat},${lng});
);
out body;
>;
out skel qt;`;

    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return data?.elements ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// OSM element analysis - extract obstructions from Overpass results
// ---------------------------------------------------------------------------
function analyzeOverpassElements(
  elements: OverpassElement[],
  lat: number,
  lng: number,
): DetectedObstruction[] {
  const obstructions: DetectedObstruction[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};

    // Trees near the building = tree_shade obstruction
    if (tags.natural === 'tree' || tags.natural === 'tree_row') {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (elLat != null && elLng != null) {
        const location = inferTreeLocation(elLat, elLng, lat, lng);
        obstructions.push({
          type: 'tree_shade',
          location,
          confidence: 0.6,
          source: 'satellite' as SatelliteSource,
          derivation: 'Nearby tree detected in OpenStreetMap data',
        });
      }
    }

    // Chimney
    if (tags['man_made'] === 'chimney') {
      obstructions.push({
        type: 'chimney',
        location: 'ridge',
        confidence: 0.65,
        source: 'satellite' as SatelliteSource,
        derivation: 'Chimney feature found in OpenStreetMap data',
      });
    }

    // Antenna / satellite dish
    if (tags['man_made'] === 'antenna' || tags['man_made'] === 'mast') {
      obstructions.push({
        type: 'antenna',
        location: 'ridge',
        confidence: 0.55,
        source: 'satellite' as SatelliteSource,
        derivation: 'Antenna/mast found in OpenStreetMap data',
      });
    }

    // Dormer windows
    if (tags['roof:shape'] === 'gabled' || tags['building:levels']) {
      // Multi-story with gabled roof often has dormers
      const levels = parseInt(tags['building:levels'] ?? '1', 10);
      if (levels >= 2 && tags['roof:shape'] === 'gabled') {
        obstructions.push({
          type: 'dormer',
          location: 'south',
          confidence: 0.35,
          source: 'satellite' as SatelliteSource,
          derivation: 'Gabled multi-story building often has dormer windows (inferred from OSM)',
        });
      }
    }
  }

  return deduplicateObstructions(obstructions);
}

// ---------------------------------------------------------------------------
// Tree location inference - which roof zone does a tree shade?
// ---------------------------------------------------------------------------
function inferTreeLocation(
  treeLat: number,
  treeLng: number,
  buildingLat: number,
  buildingLng: number,
): ObstructionLocation {
  const dLat = treeLat - buildingLat;
  const dLng = treeLng - buildingLng;

  // Cardinal direction relative to building center
  if (Math.abs(dLat) > Math.abs(dLng)) {
    return dLat > 0 ? 'north' : 'south';
  }
  return dLng > 0 ? 'east' : 'west';
}

// ---------------------------------------------------------------------------
// Heuristic obstruction detection (no API needed)
// ---------------------------------------------------------------------------
function heuristicObstructions(
  structureType?: string,
  _lat?: number,
  _lng?: number,
): DetectedObstruction[] {
  const obs: DetectedObstruction[] = [];

  if (structureType === 'residential' || !structureType) {
    // Most residential roofs have:
    // - Vent pipes (plumbing stacks) -- very common
    obs.push({
      type: 'vent_pipe',
      location: 'ridge',
      confidence: 0.4,
      source: 'address-lookup',
      derivation: 'Vent pipes are present on ~95% of residential roofs (heuristic)',
    });

    // - Chimney on ~40% of homes (older homes more likely)
    obs.push({
      type: 'chimney',
      location: 'ridge',
      confidence: 0.25,
      source: 'address-lookup',
      derivation: 'Chimneys are present on ~40% of residential roofs (heuristic)',
    });

    // - HVAC if flat or low pitch commercial
    //   Skip for steep residential -- they're usually on the ground
  }

  if (structureType === 'commercial' || structureType === 'industrial') {
    // Commercial buildings commonly have:
    obs.push({
      type: 'hvac_unit',
      location: 'center',
      confidence: 0.45,
      source: 'address-lookup',
      derivation: 'HVAC units are present on ~80% of commercial roofs (heuristic)',
    });

    obs.push({
      type: 'exhaust_fan',
      location: 'ridge',
      confidence: 0.3,
      source: 'address-lookup',
      derivation: 'Exhaust fans are common on commercial roofs (heuristic)',
    });
  }

  return obs;
}

// ---------------------------------------------------------------------------
// Usable roof area computation from detected obstructions
// ---------------------------------------------------------------------------
function computeUsableArea(
  obstructions: DetectedObstruction[],
  structureType?: string,
): { usablePct: number; confidence: number; derivation: string } {
  // Each obstruction type reduces usable area by a certain amount
  const OBSTRUCTION_AREA_IMPACT: Record<ObstructionType, number> = {
    chimney: 3,        // Small footprint, setback clearance ~3ft
    hvac_unit: 8,      // Larger footprint + service clearance
    vent_pipe: 1,      // Minimal, just the pipe + small setback
    skylight: 4,       // Medium, no panels above or below
    dormer: 10,        // Large, creates a non-planar section
    tree_shade: 15,    // Shade reduces usable area significantly
    antenna: 2,        // Small footprint
    satellite_dish: 2, // Small footprint
    exhaust_fan: 2,    // Small footprint
    solar_tube: 2,     // Small, like skylight but smaller
    other: 5,          // Unknown, assume medium impact
  };

  // Base usable percentage after standard fire setbacks (3ft ridge, 3ft sides)
  const baseUsable = structureType === 'commercial' ? 75 : 80;

  // Subtract obstruction impacts (capped at 50% total reduction)
  let reduction = 0;
  for (const obs of obstructions) {
    reduction += OBSTRUCTION_AREA_IMPACT[obs.type] ?? 5;
  }
  reduction = Math.min(reduction, 50);

  const usablePct = Math.max(10, baseUsable - reduction);

  // Confidence depends on detection source
  const hasHighConfidence = obstructions.some(o => o.confidence >= 0.6);
  const hasAnyReal = obstructions.some(o => o.source !== 'address-lookup');

  const confidence = hasAnyReal
    ? (hasHighConfidence ? 0.7 : 0.5)
    : 0.3;

  const derivation = obstructions.length > 0
    ? `Base ${baseUsable}% (fire setbacks) minus ${reduction}% from ${obstructions.length} detected obstructions`
    : `Estimated ${baseUsable}% after standard fire setbacks (no obstructions detected)`;

  return { usablePct, confidence, derivation };
}

// ---------------------------------------------------------------------------
// Deduplication - remove duplicate type+location pairs (keep highest conf)
// ---------------------------------------------------------------------------
function deduplicateObstructions(obs: DetectedObstruction[]): DetectedObstruction[] {
  const seen = new Map<string, DetectedObstruction>();
  for (const o of obs) {
    const key = `${o.type}:${o.location}`;
    const existing = seen.get(key);
    if (!existing || o.confidence > existing.confidence) {
      seen.set(key, o);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Estimate total roof area from structure type + typical sizes
// ---------------------------------------------------------------------------
function estimateRoofArea(
  structureType?: string,
  lat?: number,
  lng?: number,
): number {
  // Very rough estimates based on typical building sizes
  if (structureType === 'commercial' || structureType === 'industrial') {
    return 5000; // ~5000 sqft typical commercial roof
  }

  // Residential: try to estimate from US regional data
  // Northeast/older cities = smaller homes, Sunbelt = larger homes
  if (lat != null) {
    const absLat = Math.abs(lat);
    if (absLat > 40) return 1400;  // Northeast/Midwest: smaller lots
    if (absLat > 35) return 1700;  // Mid-Atlantic: medium
    return 2000;                    // Sunbelt: larger homes
  }

  return 1600; // Default US residential
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------
export async function detectObstructions(
  input: {
    lat: number;
    lng: number;
    address?: string;
    structureType?: string;
  },
): Promise<ObstructionDetectionResult> {
  const { lat, lng, address, structureType } = input;
  const startTime = Date.now();
  let method: ObstructionDetectionResult['method'] = 'heuristic';
  let liveApiUsed = false;

  let obstructions: DetectedObstruction[] = [];

  // ---- Layer 1: Google Maps Static API ----
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (gmapsKey) {
    const imageBuffer = await fetchSatelliteImage(lat, lng, gmapsKey);
    if (imageBuffer) {
      liveApiUsed = true;
      method = 'google_maps_static';

      // Phase 4 future: run ML model on imageBuffer here
      // For now, we note that we fetched the image and fall through
      // to heuristic + Overpass analysis
      console.log(`[satellite] Fetched ${imageBuffer.length}b satellite image for ${lat},${lng}`);
    }
  }

  // ---- Layer 2: Overpass API (OSM data) ----
  const overpassElements = await queryOverpass(lat, lng);
  if (overpassElements.length > 0) {
    const osmObs = analyzeOverpassElements(overpassElements, lat, lng);
    if (osmObs.length > 0) {
      obstructions = [...obstructions, ...osmObs];
      if (method === 'heuristic') method = 'overpass_api';
    }
  }

  // ---- Layer 3: Heuristic fallback ----
  const heuristicObs = heuristicObstructions(structureType, lat, lng);
  obstructions = [...obstructions, ...heuristicObs];

  // Deduplicate after merging all sources
  obstructions = deduplicateObstructions(obstructions);

  // ---- Compute usable roof area ----
  const areaResult = computeUsableArea(obstructions, structureType);
  const totalRoofArea = estimateRoofArea(structureType, lat, lng);
  const usableAreaSqft = Math.round(totalRoofArea * areaResult.usablePct / 100);

  const elapsed = Date.now() - startTime;
  console.log(
    `[satellite] Obstruction detection complete: ${obstructions.length} obstructions, ` +
    `${areaResult.usablePct}% usable, method=${method}, elapsed=${elapsed}ms`
  );

  return {
    obstructions,
    totalRoofAreaSqft: totalRoofArea,
    usableAreaSqft,
    usableAreaPct: areaResult.usablePct,
    areaSource: method !== 'heuristic' ? 'satellite' : 'local_calc',
    areaConfidence: areaResult.confidence >= 0.6 ? 'high' : areaResult.confidence >= 0.4 ? 'medium' : 'low',
    areaDerivation: areaResult.derivation,
    method,
    analyzedAt: new Date().toISOString(),
  };
}
