/**
 * OpenAI Roof Geometry Extractor — uses GPT-4o Vision to extract
 * structured roof geometry from survey photos.
 *
 * This module sends photos classified as `roof_plane` or `overview` to
 * GPT-4o with a structured prompt that extracts:
 *   - Roof plane polygons (as normalized coordinates)
 *   - Ridgeline / eave / rake lines
 *   - Obstruction bounding boxes (vents, pipes, chimneys, skylights)
 *   - Equipment bounding boxes (solar panels, inverters, meters)
 *
 * The response is parsed into NormalizedRegion/NormalizedLine geometry
 * that integrates directly with the existing overlay system.
 *
 * Cost: ~$0.01-0.03/image for GPT-4o with detail:high
 * Fallback: If OpenAI API is unavailable, falls back to
 * sharp-based contour extraction (roofGeometryExtractor.ts).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { NormalizedRegion, NormalizedLine } from './overlayCoordinateConversion';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A roof plane polygon extracted by GPT-4o Vision. */
export interface VisionRoofPlane {
  /** Plane label (e.g., "front-left", "back-right"). */
  label: string;
  /** Polygon vertices in normalized_image_0_1000 coordinates. */
  vertices: Array<{ x: number; y: number }>;
  /** Estimated slope in degrees (if visible). */
  slopeDegrees?: number;
  /** Estimated aspect/azimuth in degrees (if visible). */
  aspectDegrees?: number;
  /** Confidence score (0-1). */
  confidence: number;
}

/** An obstruction detected by GPT-4o Vision. */
export interface VisionObstruction {
  /** Type of obstruction. */
  type: 'vent' | 'pipe' | 'chimney' | 'skylight' | 'satellite_dish' | 'other';
  /** Bounding box in normalized_image_0_1000 coordinates. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Confidence score (0-1). */
  confidence: number;
}

/** Equipment detected by GPT-4o Vision. */
export interface VisionEquipment {
  /** Type of equipment. */
  type: 'solar_panel' | 'inverter' | 'meter' | 'service_panel' | 'junction_box' | 'other';
  /** Bounding box in normalized_image_0_1000 coordinates. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Confidence score (0-1). */
  confidence: number;
}

/** A structural line detected by GPT-4o Vision. */
export interface VisionStructuralLine {
  /** Type of structural line. */
  type: 'ridge' | 'eave' | 'rake' | 'valley' | 'hip' | 'wall_edge';
  /** Start point in normalized_image_0_1000 coordinates. */
  start: { x: number; y: number };
  /** End point in normalized_image_0_1000 coordinates. */
  end: { x: number; y: number };
  /** Confidence score (0-1). */
  confidence: number;
}

/** The full result of GPT-4o Vision geometry extraction. */
export interface VisionGeometryResult {
  /** The file ID that was analyzed. */
  fileId: string;
  /** Whether the API call succeeded. */
  success: boolean;
  /** Error message if the call failed. */
  error: string | null;
  /** Extracted roof planes. */
  roofPlanes: VisionRoofPlane[];
  /** Extracted obstructions. */
  obstructions: VisionObstruction[];
  /** Extracted equipment. */
  equipment: VisionEquipment[];
  /** Extracted structural lines. */
  lines: VisionStructuralLine[];
  /** GPT-4o's text description of what it sees. */
  description: string | null;
  /** Method used for extraction. */
  method: 'openai_vision' | 'fallback_sharp';
  /** Estimated API cost in USD. */
  estimatedCost: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt
// ────────────────────────────────────────────────────────────────────────────

const ROOF_GEOMETRY_PROMPT = `You are an expert solar survey analyst. Analyze this photo of a building's roof and extract precise geometric information.

Your task is to identify and locate:
1. **roof_planes** — Each visible roof face/section. Provide polygon vertices as percentages of the image (0-100 for both x and y, where 0,0 is top-left).
2. **obstructions** — Objects ON the roof (vents, pipes, chimneys, skylights, satellite dishes, etc.). Provide bounding boxes as {x, y, width, height} percentages.
3. **equipment** — Electrical or solar equipment visible (solar panels, inverters, meters, service panels). Provide bounding boxes.
4. **structural_lines** — Roof structure lines (ridges, eaves, rakes, valleys, hips). Provide start and end points as percentages.
5. **description** — A brief text description of the roof structure visible.

IMPORTANT RULES:
- All coordinates are PERCENTAGES (0-100) of image dimensions, NOT pixels
- x increases rightward, y increases downward
- (0,0) is the TOP-LEFT corner of the image
- Only include features you can clearly see — do not guess
- For roof plane polygons, list vertices in clockwise order
- Confidence values are 0.0 to 1.0 (1.0 = absolutely certain)
- If the photo is not a roof view, return empty arrays and explain why

Respond with ONLY a JSON object (no markdown, no code blocks):
{
  "roof_planes": [
    {
      "label": "descriptive_name",
      "vertices": [{"x": 10, "y": 20}, {"x": 80, "y": 20}, {"x": 80, "y": 60}, {"x": 10, "y": 60}],
      "slope_degrees": 25,
      "aspect_degrees": 180,
      "confidence": 0.85
    }
  ],
  "obstructions": [
    {
      "type": "vent",
      "bbox": {"x": 40, "y": 30, "width": 5, "height": 5},
      "confidence": 0.9
    }
  ],
  "equipment": [
    {
      "type": "solar_panel",
      "bbox": {"x": 20, "y": 25, "width": 30, "height": 15},
      "confidence": 0.8
    }
  ],
  "structural_lines": [
    {
      "type": "ridge",
      "start": {"x": 10, "y": 25},
      "end": {"x": 90, "y": 25},
      "confidence": 0.9
    }
  ],
  "description": "A gabled roof with two visible planes, facing south. Two plumbing vents and a chimney visible on the right plane."
}`;

// ────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract roof geometry from a photo using GPT-4o Vision.
 *
 * @param imageUrl - URL of the photo to analyze
 * @param fileId - ID of the file being analyzed
 * @param openaiApiKey - OpenAI API key
 * @returns Structured geometry extraction result
 */
export async function extractRoofGeometryWithVision(
  imageUrl: string,
  fileId: string,
  openaiApiKey: string,
): Promise<VisionGeometryResult> {
  const emptyResult: VisionGeometryResult = {
    fileId,
    success: false,
    error: null,
    roofPlanes: [],
    obstructions: [],
    equipment: [],
    lines: [],
    description: null,
    method: 'openai_vision',
    estimatedCost: 0,
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: ROOF_GEOMETRY_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000), // 60s timeout for high-detail
    });

    if (!response.ok) {
      emptyResult.error = `OpenAI API error: ${response.status} ${response.statusText}`;
      return emptyResult;
    }

    const json = await response.json() as Record<string, unknown>;
    const choices = json.choices as Array<{ message: { content: string } }>;
    if (!choices || choices.length === 0) {
      emptyResult.error = 'No response from OpenAI API';
      return emptyResult;
    }

    const content = choices[0].message.content.trim();

    // Parse the JSON response
    let cleanContent = content;
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleanContent) as {
      roof_planes?: VisionRoofPlane[];
      obstructions?: VisionObstruction[];
      equipment?: VisionEquipment[];
      structural_lines?: VisionStructuralLine[];
      description?: string;
    };

    // Convert percentage coordinates (0-100) to normalized_image_0_1000 (0-1000)
    const roofPlanes = (parsed.roof_planes ?? []).map(normalizeRoofPlane);
    const obstructions = (parsed.obstructions ?? []).map(normalizeObstruction);
    const equipment = (parsed.equipment ?? []).map(normalizeEquipment);
    const lines = (parsed.structural_lines ?? []).map(normalizeStructuralLine);

    return {
      fileId,
      success: true,
      error: null,
      roofPlanes,
      obstructions,
      equipment,
      lines,
      description: parsed.description ?? null,
      method: 'openai_vision',
      estimatedCost: 0.02, // ~$0.02 per image with detail:high
    };
  } catch (err) {
    emptyResult.error = err instanceof Error ? err.message : 'Unknown error';
    return emptyResult;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Coordinate normalization: 0-100 → 0-1000
// ────────────────────────────────────────────────────────────────────────────

function normalizeRoofPlane(plane: VisionRoofPlane): VisionRoofPlane {
  return {
    ...plane,
    vertices: plane.vertices.map(v => ({
      x: Math.round(v.x * 10),
      y: Math.round(v.y * 10),
    })),
  };
}

function normalizeObstruction(obs: VisionObstruction): VisionObstruction {
  return {
    ...obs,
    bbox: {
      x: Math.round(obs.bbox.x * 10),
      y: Math.round(obs.bbox.y * 10),
      width: Math.round(obs.bbox.width * 10),
      height: Math.round(obs.bbox.height * 10),
    },
  };
}

function normalizeEquipment(equip: VisionEquipment): VisionEquipment {
  return {
    ...equip,
    bbox: {
      x: Math.round(equip.bbox.x * 10),
      y: Math.round(equip.bbox.y * 10),
      width: Math.round(equip.bbox.width * 10),
      height: Math.round(equip.bbox.height * 10),
    },
  };
}

function normalizeStructuralLine(line: VisionStructuralLine): VisionStructuralLine {
  return {
    ...line,
    start: { x: Math.round(line.start.x * 10), y: Math.round(line.start.y * 10) },
    end: { x: Math.round(line.end.x * 10), y: Math.round(line.end.y * 10) },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Conversion to existing geometry types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a VisionRoofPlane to a NormalizedRegion (bounding box).
 * The polygon vertices are stored in the payload for polygon rendering.
 */
export function visionRoofPlaneToRegion(plane: VisionRoofPlane): NormalizedRegion {
  const xs = plane.vertices.map(v => v.x);
  const ys = plane.vertices.map(v => v.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: Math.max(0, Math.min(1000, minX)),
    y: Math.max(0, Math.min(1000, minY)),
    width: Math.max(1, Math.min(1000 - minX, maxX - minX)),
    height: Math.max(1, Math.min(1000 - minY, maxY - minY)),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a VisionObstruction to a NormalizedRegion.
 */
export function visionObstructionToRegion(obs: VisionObstruction): NormalizedRegion {
  return {
    x: Math.max(0, Math.min(1000, obs.bbox.x)),
    y: Math.max(0, Math.min(1000, obs.bbox.y)),
    width: Math.max(1, Math.min(1000 - obs.bbox.x, obs.bbox.width)),
    height: Math.max(1, Math.min(1000 - obs.bbox.y, obs.bbox.height)),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a VisionEquipment to a NormalizedRegion.
 */
export function visionEquipmentToRegion(equip: VisionEquipment): NormalizedRegion {
  return {
    x: Math.max(0, Math.min(1000, equip.bbox.x)),
    y: Math.max(0, Math.min(1000, equip.bbox.y)),
    width: Math.max(1, Math.min(1000 - equip.bbox.x, equip.bbox.width)),
    height: Math.max(1, Math.min(1000 - equip.bbox.y, equip.bbox.height)),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a VisionStructuralLine to a NormalizedLine.
 */
export function visionStructuralLineToNormalizedLine(line: VisionStructuralLine): NormalizedLine {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let orientation: 'horizontal' | 'vertical' | 'diagonal' = 'diagonal';
  if (absDx > absDy * 3) orientation = 'horizontal';
  else if (absDy > absDx * 3) orientation = 'vertical';

  return {
    x1: line.start.x,
    y1: line.start.y,
    x2: line.end.x,
    y2: line.end.y,
    orientation,
    strength: line.confidence,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Batch-extract geometry from multiple photos using GPT-4o Vision.
 * Respects rate limits (1 request/second) and handles errors gracefully.
 *
 * @param photos - Array of { fileId, fileUrl, filename } to analyze
 * @param openaiApiKey - OpenAI API key
 * @param maxPhotos - Maximum number of photos to process (default 10)
 * @returns Array of results, one per photo
 */
export async function batchExtractRoofGeometryWithVision(
  photos: Array<{ fileId: string; fileUrl: string; filename: string | null }>,
  openaiApiKey: string,
  maxPhotos: number = 10,
): Promise<VisionGeometryResult[]> {
  const results: VisionGeometryResult[] = [];
  const toProcess = photos.slice(0, maxPhotos);

  for (const photo of toProcess) {
    const result = await extractRoofGeometryWithVision(
      photo.fileUrl,
      photo.fileId,
      openaiApiKey,
    );
    results.push(result);

    // Rate limiting: 1 request per second
    if (toProcess.indexOf(photo) < toProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}
