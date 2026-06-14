// ============================================================================
// v47.439 - Photo Extraction Utility
//
// Analyzes uploaded survey photos to extract structured data:
//   - Panel brand from nameplate (main_panel_open / main_panel_closed photos)
//   - Available breaker slots from open panel photo
//   - Roof condition from roof_overview / roof_detail photos
//
// LAYERED APPROACH:
//   1. Image analysis (if image bytes available)
//      - Future: OCR on nameplate text for panel brand
//      - Future: Object detection for breaker slot counting
//      - Future: Surface analysis for roof condition grading
//      - Currently: heuristic analysis from image metadata
//
//   2. Heuristic fallback
//      - Panel brand: based on most common brands by region + structure age
//      - Breaker slots: based on panel rating (200A = 40 slots, 100A = 20 slots)
//      - Roof condition: based on roof age + material
//
// DESIGN PRINCIPLE:
//   Every extraction carries confidence + source so the UX can display
//   ConfidenceBadge. Low-confidence extractions still show as suggestions
//   the user can accept or override.
// ============================================================================

import type {
  DetectedPanelBrand,
  DetectedBreakerSlots,
  DetectedRoofCondition,
  PhotoExtractionResult,
} from './types';
import type { PanelBrand, AvailableBreakerSlots, RoofCondition } from '../survey/v2/types';

// ---------------------------------------------------------------------------
// Panel brand heuristics by region and structure type
// ---------------------------------------------------------------------------

const COMMON_PANEL_BRANDS: PanelBrand[] = [
  'siemens',
  'square_d',
  'eaton',
  'cutler_hammer',
  'ge',
];

// Regional brand prevalence (which brands are most common in each US region)
const REGIONAL_BRANDS: Record<string, PanelBrand[]> = {
  // West Coast: Siemens and Square D dominate
  west: ['siemens', 'square_d', 'eaton', 'ge'],
  // Southwest: Square D and Siemens
  southwest: ['square_d', 'siemens', 'cutler_hammer', 'eaton'],
  // Midwest: Square D is king, then Cutler-Hammer
  midwest: ['square_d', 'cutler_hammer', 'siemens', 'eaton'],
  // Southeast: GE and Square D
  southeast: ['ge', 'square_d', 'siemens', 'eaton'],
  // Northeast: Square D and Cutler-Hammer
  northeast: ['square_d', 'cutler_hammer', 'eaton', 'siemens'],
};

function inferRegion(lat?: number, lng?: number): string {
  if (lat == null || lng == null) return 'default';

  const absLat = Math.abs(lat);
  const absLng = Math.abs(lng);

  // West Coast
  if (absLng > 115 && absLng < 125) return 'west';
  // Southwest
  if (absLng > 103 && absLng < 115 && absLat < 37) return 'southwest';
  // Midwest
  if (absLng > 85 && absLng < 103 && absLat > 35) return 'midwest';
  // Southeast
  if (absLng > 75 && absLng < 90 && absLat < 37) return 'southeast';
  // Northeast
  if (absLng > 67 && absLng < 80 && absLat > 37) return 'northeast';

  return 'default';
}

// ---------------------------------------------------------------------------
// Heuristic panel brand extraction
// ---------------------------------------------------------------------------
function heuristicPanelBrand(
  structureType?: string,
  lat?: number,
  lng?: number,
): DetectedPanelBrand {
  const region = inferRegion(lat, lng);
  const brands = REGIONAL_BRANDS[region] ?? COMMON_PANEL_BRANDS;

  // Most common brand in the region as default suggestion
  const topBrand = brands[0];

  return {
    brand: topBrand,
    confidence: 0.2,
    source: 'heuristic',
    derivation:
      `${topBrand.replace(/_/g, ' ')} is the most common panel brand in ` +
      `the ${region === 'default' ? 'US' : region} region (heuristic)`,
  };
}

// ---------------------------------------------------------------------------
// Heuristic breaker slot extraction from panel rating
// ---------------------------------------------------------------------------
function heuristicBreakerSlots(
  panelRating?: string,
): DetectedBreakerSlots | null {
  // Estimate available slots from panel rating
  // Most panels: total slots = bus rating / 20 (each slot is ~20A)
  // Available = total - used (typically 60-80% used for residential)

  const ratingMap: Record<string, { totalSlots: number; typicalUsed: number }> = {
    '100': { totalSlots: 20, typicalUsed: 16 },
    '150': { totalSlots: 30, typicalUsed: 22 },
    '200': { totalSlots: 40, typicalUsed: 30 },
    '225': { totalSlots: 42, typicalUsed: 34 },
    '320': { totalSlots: 40, typicalUsed: 32 },
    '400': { totalSlots: 42, typicalUsed: 34 },
  };

  const info = panelRating ? ratingMap[panelRating] : undefined;
  if (!info) return null;

  const availableSlots = info.totalSlots - info.typicalUsed;

  return {
    totalSlots: info.totalSlots,
    availableSlots: Math.max(0, availableSlots),
    confidence: 0.25,
    source: 'heuristic',
    derivation:
      `Estimated ${Math.max(0, availableSlots)} available slots from ` +
      `${panelRating}A panel (${info.totalSlots} total, ~${info.typicalUsed} typically used)`,
  };
}

// ---------------------------------------------------------------------------
// Map available breaker count to survey chip value
// ---------------------------------------------------------------------------
export function breakerCountToChipValue(count: number): AvailableBreakerSlots {
  if (count === 0) return '0';
  if (count <= 2) return '1-2';
  if (count <= 4) return '3-4';
  return '5+';
}

// ---------------------------------------------------------------------------
// Heuristic roof condition from roof age + material
// ---------------------------------------------------------------------------
function heuristicRoofCondition(
  roofAgeYears?: number | null,
  roofMaterial?: string,
): DetectedRoofCondition {
  // Base condition on age
  let condition: RoofCondition = 'good';
  let confidence = 0.25;

  if (roofAgeYears != null) {
    if (roofAgeYears <= 10) {
      condition = 'good';
      confidence = 0.35;
    } else if (roofAgeYears <= 20) {
      condition = 'fair';
      confidence = 0.35;
    } else {
      condition = 'poor';
      confidence = 0.3;
    }

    // Material modifiers
    if (roofMaterial === 'tile_clay' || roofMaterial === 'tile_concrete') {
      // Tile roofs last longer
      if (roofAgeYears <= 20) { condition = 'good'; confidence = 0.3; }
      else if (roofAgeYears <= 40) { condition = 'fair'; confidence = 0.3; }
      else { condition = 'poor'; confidence = 0.25; }
    } else if (roofMaterial === 'metal_standing_seam' || roofMaterial === 'metal_r_panel') {
      // Metal roofs last longer too
      if (roofAgeYears <= 20) { condition = 'good'; confidence = 0.3; }
      else if (roofAgeYears <= 35) { condition = 'fair'; confidence = 0.3; }
      else { condition = 'poor'; confidence = 0.25; }
    }
  } else {
    // No age info -- default to fair with very low confidence
    condition = 'fair';
    confidence = 0.15;
  }

  const materialLabel = roofMaterial ? roofMaterial.replace(/_/g, ' ') : 'unknown material';

  return {
    condition,
    confidence,
    source: 'heuristic',
    derivation:
      roofAgeYears != null
        ? `${condition} condition estimated from ${roofAgeYears}yr old ${materialLabel} roof (heuristic)`
        : `No roof age available -- defaulting to fair condition for ${materialLabel} (heuristic)`,
  };
}

// ---------------------------------------------------------------------------
// Image-based extraction (future ML integration point)
// ---------------------------------------------------------------------------

/** OCR-based panel brand detection from nameplate image */
async function extractPanelBrandFromImage(
  _imageUrl: string,
): Promise<DetectedPanelBrand | null> {
  // Phase 4 future: Call OCR API (Google Vision, Tesseract, etc.)
  // on the panel photo to read the brand name from the nameplate.
  //
  // Pseudo-code for future:
  //   const ocrResult = await ocrService.analyze(imageUrl);
  //   const brandText = ocrResult.text;
  //   const matched = fuzzyMatchBrand(brandText);
  //   return { brand: matched, confidence: ocrResult.confidence, source: 'photo-ocr' };
  //
  // For now, return null to indicate no image analysis available
  return null;
}

/** Object detection for breaker slot counting from open panel photo */
async function extractBreakerSlotsFromImage(
  _imageUrl: string,
): Promise<DetectedBreakerSlots | null> {
  // Phase 4 future: Run object detection on open panel photo:
  //   - Count total breaker positions (filled + empty)
  //   - Count empty positions (no breaker installed)
  //   - Return available = total - filled
  //
  // For now, return null
  return null;
}

/** Visual roof condition analysis from roof photo */
async function extractRoofConditionFromImage(
  _imageUrl: string,
): Promise<DetectedRoofCondition | null> {
  // Phase 4 future: Run surface analysis on roof photo:
  //   - Detect curling, cracking, missing pieces (poor)
  //   - Detect wear but intact (fair)
  //   - Detect intact, good condition (good)
  //
  // For now, return null
  return null;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export interface PhotoExtractorInput {
  /** Photo URLs keyed by category */
  photoUrls: Record<string, string>;
  /** Context for heuristic fallback */
  structureType?: string;
  latitude?: number;
  longitude?: number;
  panelRating?: string;
  roofAgeYears?: number | null;
  roofMaterial?: string;
}

export async function extractFromPhotos(
  input: PhotoExtractorInput,
): Promise<PhotoExtractionResult> {
  const {
    photoUrls,
    structureType,
    latitude,
    longitude,
    panelRating,
    roofAgeYears,
    roofMaterial,
  } = input;

  const analyzedCategories: string[] = [];
  let panelBrand: DetectedPanelBrand | null = null;
  let breakerSlots: DetectedBreakerSlots | null = null;
  let roofCondition: DetectedRoofCondition | null = null;

  // ---- Panel brand extraction ----
  const panelOpenUrl = photoUrls['main_panel_open'];
  const panelClosedUrl = photoUrls['main_panel_closed'];

  if (panelClosedUrl || panelOpenUrl) {
    // Try image-based extraction first (nameplate is usually on closed panel)
    const imageUrl = panelClosedUrl || panelOpenUrl;
    if (imageUrl) {
      const imageResult = await extractPanelBrandFromImage(imageUrl);
      if (imageResult) {
        panelBrand = imageResult;
        analyzedCategories.push('main_panel_closed', 'main_panel_open');
      }
    }

    // Heuristic fallback
    if (!panelBrand) {
      panelBrand = heuristicPanelBrand(structureType, latitude, longitude);
      if (panelOpenUrl) analyzedCategories.push('main_panel_open');
      if (panelClosedUrl) analyzedCategories.push('main_panel_closed');
    }
  }

  // ---- Breaker slot extraction ----
  if (panelOpenUrl) {
    // Try image-based extraction first
    const imageResult = await extractBreakerSlotsFromImage(panelOpenUrl);
    if (imageResult) {
      breakerSlots = imageResult;
      analyzedCategories.push('main_panel_open');
    }

    // Heuristic fallback from panel rating
    if (!breakerSlots && panelRating) {
      breakerSlots = heuristicBreakerSlots(panelRating);
      analyzedCategories.push('main_panel_open');
    }
  }

  // ---- Roof condition extraction ----
  const roofOverviewUrl = photoUrls['roof_overview'];
  const roofDetailUrl = photoUrls['roof_detail'];

  if (roofOverviewUrl || roofDetailUrl) {
    // Try image-based extraction first
    const imageUrl = roofDetailUrl || roofOverviewUrl;
    if (imageUrl) {
      const imageResult = await extractRoofConditionFromImage(imageUrl);
      if (imageResult) {
        roofCondition = imageResult;
        analyzedCategories.push('roof_detail', 'roof_overview');
      }
    }

    // Heuristic fallback from roof age + material
    if (!roofCondition) {
      roofCondition = heuristicRoofCondition(roofAgeYears, roofMaterial);
      if (roofOverviewUrl) analyzedCategories.push('roof_overview');
      if (roofDetailUrl) analyzedCategories.push('roof_detail');
    }
  }

  return {
    panelBrand,
    breakerSlots,
    roofCondition,
    analyzedCategories: [...new Set(analyzedCategories)],
    analyzedAt: new Date().toISOString(),
  };
}
