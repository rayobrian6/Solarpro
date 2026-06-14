// ============================================================================
// v47.438 - Satellite Roof Analyzer
//
// Detect roof material and pitch from satellite/aerial imagery.
// Uses a layered approach similar to obstructionDetector:
//
//   1. Overpass API: Query OSM roof:material and roof:shape tags
//   2. Google Maps Static API: Visual analysis (future ML model)
//   3. Heuristic: Based on region, structure type, and building age
//
// Result plugs directly into StepRoof's ChipGroup selections
// with ConfidenceBadge showing the source.
// ============================================================================

import type {
  DetectedRoofMaterial,
  DetectedRoofPitch,
  RoofAnalysisResult,
  SatelliteSource,
} from './types';
import type { RoofMaterial, RoofPitch } from '../survey/v2/types';

// ---------------------------------------------------------------------------
// OSM roof material mapping
// ---------------------------------------------------------------------------
const OSM_MATERIAL_MAP: Record<string, RoofMaterial> = {
  'tar': 'flat_torch',
  'asphalt': 'comp_shingle',
  'shingle': 'comp_shingle',
  'concrete': 'tile_concrete',
  'clay': 'tile_clay',
  'metal': 'metal_standing_seam',
  'copper': 'metal_standing_seam',
  'tpo': 'flat_tpo',
  'epdm': 'flat_epdm',
  'wood': 'wood_shake',
  'slate': 'other', // No exact match in our type
  'gravel': 'flat_torch',
  'bitumen': 'flat_torch',
  'roof_tiles': 'tile_clay',
};

// ---------------------------------------------------------------------------
// OSM roof shape to pitch mapping
// ---------------------------------------------------------------------------
const OSM_SHAPE_TO_PITCH: Record<string, RoofPitch> = {
  'flat': 'flat',
  'gabled': 'standard',
  'hipped': 'standard',
  'skillion': 'low',
  'gambrel': 'steep',
  'mansard': 'very_steep',
  'dome': 'flat',
  'round': 'low',
  'saltbox': 'steep',
};

const PITCH_TO_TILT: Record<RoofPitch, number> = {
  'flat': 0,
  'low': 9,
  'standard': 22,
  'steep': 35,
  'very_steep': 45,
  '': 22, // default
};

// ---------------------------------------------------------------------------
// Query Overpass for roof attributes
// ---------------------------------------------------------------------------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
}

async function queryRoofAttributes(
  lat: number,
  lng: number,
): Promise<OverpassElement[]> {
  try {
    const radius = 15; // Tighter radius for the specific building
    const query = `
[out:json][timeout:10];
way["building"](around:${radius},${lat},${lng});
out body;`;

    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data?.elements ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Extract roof data from OSM elements
// ---------------------------------------------------------------------------
function extractFromOsm(
  elements: OverpassElement[],
): { material: DetectedRoofMaterial | null; pitch: DetectedRoofPitch | null } {
  let material: DetectedRoofMaterial | null = null;
  let pitch: DetectedRoofPitch | null = null;

  for (const el of elements) {
    const tags = el.tags ?? {};

    // Roof material
    const osmMat = tags['roof:material'] ?? tags['building:roof:material'];
    if (osmMat && !material) {
      const mapped = OSM_MATERIAL_MAP[osmMat.toLowerCase()];
      if (mapped) {
        material = {
          material: mapped,
          confidence: 0.65,
          source: 'satellite' as SatelliteSource,
          derivation: `Roof material "${osmMat}" found in OpenStreetMap data`,
        };
      }
    }

    // Roof shape -> pitch
    const osmShape = tags['roof:shape'] ?? tags['building:roof:shape'];
    if (osmShape && !pitch) {
      const mappedPitch = OSM_SHAPE_TO_PITCH[osmShape.toLowerCase()];
      if (mappedPitch) {
        const tilt = PITCH_TO_TILT[mappedPitch];
        pitch = {
          pitch: mappedPitch,
          estimatedTiltDeg: tilt,
          confidence: 0.55,
          source: 'satellite' as SatelliteSource,
          derivation: `Roof shape "${osmShape}" from OpenStreetMap maps to ${mappedPitch} pitch (~${tilt}deg)`,
        };
      }
    }

    // Roof levels -> approximate pitch (multi-story residential = steeper)
    const levels = parseInt(tags['building:levels'] ?? '0', 10);
    if (levels > 0 && !pitch) {
      // Gabled 2-story homes typically have standard pitch
      const inferredPitch: RoofPitch = levels >= 3 ? 'steep' : 'standard';
      pitch = {
        pitch: inferredPitch,
        estimatedTiltDeg: PITCH_TO_TILT[inferredPitch],
        confidence: 0.25,
        source: 'address-lookup' as SatelliteSource,
        derivation: `${levels}-story building typically has ${inferredPitch} roof pitch (inferred from OSM building levels)`,
      };
    }
  }

  return { material, pitch };
}

// ---------------------------------------------------------------------------
// Heuristic roof material by region
// ---------------------------------------------------------------------------
function heuristicRoofMaterial(
  lat?: number,
  lng?: number,
  structureType?: string,
): DetectedRoofMaterial {
  // Commercial/industrial: flat roof with TPO/EPDM
  if (structureType === 'commercial' || structureType === 'industrial') {
    // Sunbelt commercial = TPO (white reflective), Northern = EPDM (black rubber)
    if (lat != null && Math.abs(lat) < 37) {
      return {
        material: 'flat_tpo',
        confidence: 0.35,
        source: 'address-lookup',
        derivation: 'Commercial buildings in warm climates typically use TPO (white reflective membrane)',
      };
    }
    return {
      material: 'flat_epdm',
      confidence: 0.3,
      source: 'address-lookup',
      derivation: 'Commercial buildings typically use flat membrane roofing (EPDM/TPO)',
    };
  }

  // Residential: comp_shingle dominates ~80% of US homes
  // Regional variations:
  if (lat != null && lng != null) {
    const absLat = Math.abs(lat);

    // Southwest (AZ, NM, TX): tile is very common
    if (absLat < 35 && lng > -110) {
      return {
        material: 'tile_clay',
        confidence: 0.35,
        source: 'address-lookup',
        derivation: 'Southwestern US homes often have clay tile roofs (regional heuristic)',
      };
    }

    // Florida: tile concrete or comp shingle
    if (absLat < 30 && lng > -88) {
      return {
        material: 'tile_concrete',
        confidence: 0.3,
        source: 'address-lookup',
        derivation: 'Florida homes often have concrete tile or shingle roofs (regional heuristic)',
      };
    }

    // Pacific Northwest: metal standing seam gaining popularity
    if (absLat > 45 && lng < -120) {
      return {
        material: 'comp_shingle',
        confidence: 0.35,
        source: 'address-lookup',
        derivation: 'Pacific NW homes primarily use composite shingle (regional heuristic)',
      };
    }
  }

  // Default: composite shingle (80%+ of US residential)
  return {
    material: 'comp_shingle',
    confidence: 0.4,
    source: 'address-lookup',
    derivation: 'Composite shingle is the most common US residential roof material (~80% of homes)',
  };
}

// ---------------------------------------------------------------------------
// Heuristic roof pitch by region
// ---------------------------------------------------------------------------
function heuristicRoofPitch(
  lat?: number,
  structureType?: string,
): DetectedRoofPitch {
  // Commercial: flat
  if (structureType === 'commercial' || structureType === 'industrial') {
    return {
      pitch: 'flat',
      estimatedTiltDeg: 0,
      confidence: 0.35,
      source: 'address-lookup',
      derivation: 'Commercial/industrial buildings typically have flat roofs',
    };
  }

  // Residential: standard pitch is most common
  // Snow country = steeper for shedding
  if (lat != null && Math.abs(lat) > 42) {
    return {
      pitch: 'steep',
      estimatedTiltDeg: 35,
      confidence: 0.25,
      source: 'address-lookup',
      derivation: 'Northern/snow-prone regions often have steeper roofs for snow shedding',
    };
  }

  return {
    pitch: 'standard',
    estimatedTiltDeg: 22,
    confidence: 0.35,
    source: 'address-lookup',
    derivation: 'Standard pitch (5-9:12) is the most common residential roof pitch',
  };
}

// ---------------------------------------------------------------------------
// Main roof analysis function
// ---------------------------------------------------------------------------
export async function analyzeRoof(
  input: {
    lat: number;
    lng: number;
    address?: string;
    structureType?: string;
  },
): Promise<RoofAnalysisResult> {
  const { lat, lng, address, structureType } = input;
  let method: RoofAnalysisResult['method'] = 'heuristic';

  let material: DetectedRoofMaterial | null = null;
  let pitch: DetectedRoofPitch | null = null;

  // ---- Layer 1: Overpass API (OSM roof tags) ----
  try {
    const elements = await queryRoofAttributes(lat, lng);
    if (elements.length > 0) {
      const osmResult = extractFromOsm(elements);
      if (osmResult.material) {
        material = osmResult.material;
        method = 'overpass_api';
      }
      if (osmResult.pitch) {
        pitch = osmResult.pitch;
        if (method === 'heuristic') method = 'overpass_api';
      }
    }
  } catch {
    // Overpass query failed -- fall through to heuristic
  }

  // ---- Layer 2: Heuristic fallback (always fills gaps) ----
  if (!material) {
    material = heuristicRoofMaterial(lat, lng, structureType);
  }
  if (!pitch) {
    pitch = heuristicRoofPitch(lat, structureType);
  }

  return {
    material,
    pitch,
    method,
    analyzedAt: new Date().toISOString(),
  };
}
