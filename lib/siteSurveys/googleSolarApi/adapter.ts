// ============================================================================
// lib/siteSurveys/googleSolarApi/adapter.ts
//
// Pipeline C Adapter — converts Google Solar API buildingInsights response
// into UnifiedGeometryArtifact instances.
//
// This is the key adapter that delivers what the user has been asking for
// since Session 1: REAL ROOF POLYGON SHAPES, not bounding boxes.
//
// The Google Solar API provides:
//   - Actual polygon outlines for each roof plane (not rectangles!)
//   - Accurate pitch and azimuth per plane
//   - Area per plane in square meters
//   - Building bounding box and imagery metadata
//
// The adapter maps these to the same UnifiedGeometryArtifact type used by
// Pipeline A and Pipeline B, so the existing UnifiedGeometryOverlayRenderer
// can render them immediately — no UI changes needed for the overlay itself.
//
// ISOLATION NOTE: This adapter is used ONLY by Pipeline C (roof geometry
// overlays on site survey photos). The 3D design pipeline has its own
// conversion logic in app/api/solar/route.ts (buildRoofPlanes function)
// which uses a DIFFERENT data model (roofSegmentStats → RoofPlane[] with
// lat/lng coordinates). These two adapters MUST remain independent.
//
// CRITICAL COORDINATE SYSTEM NOTE:
//   The Google Solar API provides roof plane outlines in a pixel coordinate
//   system where (0, 0) is the CENTER of the aerial imagery. Our unified
//   geometry system uses normalized_image_0_1000 where (0, 0) is the
//   top-left and (1000, 1000) is the bottom-right.
//
//   To convert Solar API pixel coordinates to normalized_image_0_1000,
//   we need the building's bounding box from the Solar API response,
//   which gives us the extent of the building in pixel coordinates.
//   We then normalize the polygon vertices relative to the bounding box
//   and scale to the 0-1000 range.
//
//   Formula:
//     normalized_x = ((pixel_x - bbox_x) / bbox_width) * 1000
//     normalized_y = ((pixel_y - bbox_y) / bbox_height) * 1000
//
//   This maps the building's bounding box to the full 0-1000 range,
//   giving us the highest resolution for the roof geometry overlay.
// ============================================================================

import { v4 as uuid } from 'uuid';
import type {
  BuildingInsightsResponse,
  SolarRoofPlane,
  SolarPixelBoundingBox,
  SolarApiPixelPoint,
} from './types';
import type {
  UnifiedGeometryArtifact,
  GeometryPoint2D,
  GeometryPolygon,
  GeometryBBox,
  GeometryNormalVector,
  GeometryProvenance,
  RoofLineSubtype,
} from '@/lib/siteSurveys/unifiedGeometry/types';
import {
  RAW_EVIDENCE_AUTHORITY,
} from '@/lib/siteSurveys/unifiedGeometry/authority';
import type { UnifiedGeometryAuthority } from '@/lib/siteSurveys/unifiedGeometry/authority';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Confidence for Google Solar API roof plane data.
 *
 * The Google Solar API uses high-resolution aerial imagery and ML models
 * trained on millions of buildings. The roof geometry is significantly
 * more accurate than our heuristic Pipeline B outputs. We assign a high
 * confidence to reflect this.
 */
const GOOGLE_SOLAR_PLANE_CONFIDENCE = 92;

/**
 * Confidence for roof lines inferred from adjacent plane boundaries.
 *
 * Roof lines are inferred from the shared edges of adjacent roof planes,
 * which is a heuristic process. Lower confidence reflects this.
 */
const GOOGLE_SOLAR_LINE_CONFIDENCE = 78;

/**
 * Confidence for the building bounding box.
 * The bbox is authoritative from the API.
 */
const GOOGLE_SOLAR_BBOX_CONFIDENCE = 98;

// ─── Coordinate Conversion ──────────────────────────────────────────────────

/**
 * Convert Solar API pixel coordinates to our normalized_image_0_1000 system.
 *
 * The Solar API uses pixel coordinates where (0, 0) is the center of the
 * aerial imagery. Our system uses normalized coordinates where (0, 0) is
 * the top-left and (1000, 1000) is the bottom-right of the image area.
 *
 * We use the building's bounding box as the reference frame, so the
 * building fills the 0-1000 range. This gives maximum resolution for
 * the roof geometry overlay.
 *
 * @param pixel  - Point in Solar API pixel coordinates
 * @param bbox   - Building bounding box in Solar API pixel coordinates
 * @returns Point in normalized_image_0_1000 coordinates
 */
function solarPixelToNormalized(
  pixel: SolarApiPixelPoint,
  bbox: SolarPixelBoundingBox,
): GeometryPoint2D {
  // Normalize relative to the bounding box origin and dimensions
  // Add small padding (5%) to avoid vertices touching the very edges
  const paddingFraction = 0.05;
  const effectiveWidth = bbox.width * (1 - 2 * paddingFraction);
  const effectiveHeight = bbox.height * (1 - 2 * paddingFraction);
  const offsetX = bbox.x + bbox.width * paddingFraction;
  const offsetY = bbox.y + bbox.height * paddingFraction;

  const normalizedX = ((pixel.x - offsetX) / effectiveWidth) * 1000;
  const normalizedY = ((pixel.y - offsetY) / effectiveHeight) * 1000;

  // Clamp to 0-1000 range
  return {
    x: Math.max(0, Math.min(1000, normalizedX)),
    y: Math.max(0, Math.min(1000, normalizedY)),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a Solar API bounding box to our normalized_image_0_1000 system.
 *
 * @param solarBbox - Bounding box in Solar API pixel coordinates
 * @returns Bounding box in normalized_image_0_1000 coordinates
 */
function solarBBoxToNormalized(solarBbox: SolarPixelBoundingBox): GeometryBBox {
  // The building bounding box IS the reference frame, so it maps to
  // roughly the full 0-1000 range (with padding applied).
  const paddingFraction = 0.05;
  return {
    x: Math.round(1000 * paddingFraction),  // 50
    y: Math.round(1000 * paddingFraction),  // 50
    width: Math.round(1000 * (1 - 2 * paddingFraction)),  // 900
    height: Math.round(1000 * (1 - 2 * paddingFraction)),  // 900
    coordinateSystem: 'normalized_image_0_1000',
  };
}

// ─── Roof Line Inference ─────────────────────────────────────────────────────

/**
 * Infer the roof line subtype from the azimuth and pitch of two adjacent
 * roof planes.
 *
 * Ridge: Two planes slope away from each other (azimuths differ by ~180°)
 * Hip:   Two planes meet at an angle other than 180° (not ridge, not valley)
 * Valley: Two planes slope toward each other (inverse of ridge)
 * Eave:  Edge where a plane meets the building edge (no adjacent plane)
 * Rake:  Sloped edge where a plane meets the building edge
 *
 * This is a best-effort heuristic. The Google Solar API doesn't directly
 * label roof line types.
 */
function inferRoofLineSubtype(
  plane1: SolarRoofPlane,
  plane2: SolarRoofPlane | null,
): RoofLineSubtype {
  if (!plane2) {
    // No adjacent plane — this is an edge line (eave or rake)
    // Rakes are on the sloped side (perpendicular to the ridge),
    // eaves are on the horizontal side (parallel to the ridge).
    // Heuristic: if pitch > 20°, assume rake; otherwise eave.
    return plane1.roofPitch > 20 ? 'rake' : 'eave';
  }

  // Two planes meet. Determine if this is a ridge, hip, or valley.
  const azimuthDiff = Math.abs(plane1.azimuth - plane2.azimuth);
  const normalizedDiff = azimuthDiff > 180 ? 360 - azimuthDiff : azimuthDiff;

  // If azimuths are roughly opposite (~180°), it's a ridge
  if (normalizedDiff > 150 && normalizedDiff < 210) {
    return 'ridge';
  }

  // If both planes slope toward the line, it's a valley
  // This is hard to determine without 3D data, so we default to hip
  // for non-ridge, non-edge lines
  return 'hip';
}

// ─── Provenance Helper ───────────────────────────────────────────────────────

/**
 * Create provenance for a Pipeline C (Google Solar API) artifact.
 */
function makeSolarApiProvenance(
  buildingName: string | undefined,
  imageryDate: string | undefined,
): GeometryProvenance {
  return {
    sourcePipeline: 'google_solar_api',
    toolName: 'google_solar_building_insights',
    toolVersion: 'v1',
    runHash: `solar-api-${buildingName ?? uuid().slice(0, 8)}`,
    sourceFileIds: [], // No source files — the API provides the data directly
    derivedFromArtifactIds: [],
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    workerVersion: null,
    // Google Solar API data is NOT synthetic — it's produced by real ML models
    // on high-resolution aerial imagery. It is authoritative roof geometry.
  };
}

// ─── Empty Artifact Template ─────────────────────────────────────────────────

/**
 * Create a UnifiedGeometryArtifact with all optional fields set to null.
 * Same pattern as Pipeline A/B adapters.
 */
function makeEmptyArtifact(
  overrides: Partial<UnifiedGeometryArtifact> &
    Pick<
      UnifiedGeometryArtifact,
      'id' | 'surveyId' | 'geometryClass' | 'authority' | 'provenance' | 'confidence' | 'label' | 'limitations'
    >,
): UnifiedGeometryArtifact {
  return {
    bbox: null,
    polygon: null,
    lineSegment: null,
    center: null,
    planeType: null,
    pitchDegrees: null,
    azimuthDegrees: null,
    normalVector: null,
    areaSqM: null,
    inlierCount: null,
    totalPoints: null,
    lineSubtype: null,
    estimatedLengthM: null,
    obstructionSubtype: null,
    radiusM: null,
    setbackM: null,
    heightFt: null,
    roofPlaneId: null,
    cadImpact: null,
    electricalSubtype: null,
    story: null,
    isPrimaryInterconnect: null,
    depthResolution: null,
    depthMetric: null,
    consensusPhotoCount: null,
    segmentationClass: null,
    reviewState: 'review_required',
    reviewNotes: null,
    priority: overrides.confidence >= 80 ? 'high' : overrides.confidence >= 50 ? 'medium' : 'low',
    isSynthetic: false, // Google Solar API data is NOT synthetic
    obstructionMetadata: null,
    stageTimings: null,
    ...overrides,
  };
}

// ─── Main Adapter ────────────────────────────────────────────────────────────

/**
 * Adapt a Google Solar API buildingInsights response into UnifiedGeometryArtifact instances.
 *
 * This is THE adapter that converts real roof polygon data from the Google
 * Solar API into our unified geometry system. Each roof plane becomes a
 * UnifiedGeometryArtifact with:
 *
 *   - geometryClass: 'roof_plane'
 *   - polygon: REAL polygon outline (not a bbox-derived rectangle!)
 *   - pitchDegrees: from the API
 *   - azimuthDegrees: from the API
 *   - areaSqM: from the API
 *   - normalVector: computed from pitch and azimuth
 *   - provenance: sourcePipeline = 'google_solar_api'
 *   - authority: RAW_EVIDENCE (starting state, can be promoted)
 *   - isSynthetic: false (this is real data, not heuristic output)
 *
 * Additionally, roof lines are inferred from adjacent plane boundaries:
 *
 *   - geometryClass: 'roof_line'
 *   - lineSegment: derived from shared polygon edges
 *   - lineSubtype: ridge/hip/valley/eave/rake (inferred from azimuth)
 *   - provenance: sourcePipeline = 'google_solar_api'
 *
 * @param response  - The buildingInsights response from the Google Solar API
 * @param surveyId  - The site survey ID to associate artifacts with
 * @returns Array of UnifiedGeometryArtifact instances
 */
export function adaptBuildingInsightsToUnifiedArtifacts(
  response: BuildingInsightsResponse,
  surveyId: string,
): UnifiedGeometryArtifact[] {
  const artifacts: UnifiedGeometryArtifact[] = [];

  // We need the bounding box to convert pixel coordinates to normalized
  const bbox = response.boundingBox;
  if (!bbox) {
    console.warn(
      '[Pipeline C Adapter] BuildingInsights response has no boundingBox — cannot convert coordinates',
    );
    return artifacts;
  }

  const roofPlanes = response.roofPlanes ?? [];
  if (roofPlanes.length === 0) {
    console.warn(
      '[Pipeline C Adapter] BuildingInsights response has no roof planes',
    );
    return artifacts;
  }

  const provenance = makeSolarApiProvenance(
    response.name,
    response.imageryDate
      ? `${response.imageryDate.year}-${String(response.imageryDate.month).padStart(2, '0')}`
      : undefined,
  );

  const authority: UnifiedGeometryAuthority = { ...RAW_EVIDENCE_AUTHORITY };

  // ─── Adapt each roof plane ─────────────────────────────────────────────
  for (let i = 0; i < roofPlanes.length; i++) {
    const plane = roofPlanes[i];
    const planeArtifact = adaptRoofPlane(plane, i, bbox, surveyId, provenance, authority);
    if (planeArtifact) {
      artifacts.push(planeArtifact);
    }
  }

  // ─── Infer roof lines from adjacent planes ─────────────────────────────
  // For each pair of adjacent planes, we can infer a roof line.
  // Two planes are "adjacent" if their polygons share vertices or edges.
  // For simplicity, we infer lines from ALL pairs of planes whose
  // bounding boxes overlap. This is a heuristic but catches most cases.
  const lineArtifacts = inferRoofLines(roofPlanes, bbox, surveyId, provenance, authority);
  artifacts.push(...lineArtifacts);

  return artifacts;
}

// ─── Roof Plane Adapter ──────────────────────────────────────────────────────

/**
 * Adapt a single Google Solar API roof plane into a UnifiedGeometryArtifact.
 *
 * This is where the magic happens: the Solar API's polygon outline (which
 * traces the ACTUAL shape of the roof plane) is converted to a
 * GeometryPolygon with normalized_image_0_1000 coordinates. The overlay
 * renderer will draw this as a filled polygon — no more "shitty boxes"!
 */
function adaptRoofPlane(
  plane: SolarRoofPlane,
  planeIndex: number,
  buildingBbox: SolarPixelBoundingBox,
  surveyId: string,
  provenance: GeometryProvenance,
  authority: UnifiedGeometryAuthority,
): UnifiedGeometryArtifact | null {
  // Convert the polygon outline from Solar API pixel coords to normalized
  const outline = plane.planeOutline;
  if (!outline || !outline.vertices || outline.vertices.length < 3) {
    console.warn(
      `[Pipeline C Adapter] Roof plane ${planeIndex} has no polygon outline with >= 3 vertices, skipping`,
    );
    return null;
  }

  const vertices: GeometryPoint2D[] = outline.vertices.map((v) =>
    solarPixelToNormalized(v, buildingBbox),
  );

  const polygon: GeometryPolygon = {
    vertices,
    coordinateSystem: 'normalized_image_0_1000',
  };

  // Compute the normal vector from pitch and azimuth
  // Pitch = angle from horizontal, Azimuth = clockwise from north
  // Normal vector points outward from the roof plane surface
  const pitchRad = (plane.roofPitch * Math.PI) / 180;
  const azimuthRad = (plane.azimuth * Math.PI) / 180;
  const normalVector: GeometryNormalVector = {
    x: Math.sin(pitchRad) * Math.sin(azimuthRad),
    y: -Math.cos(pitchRad), // Y points "up" in our coordinate system
    z: Math.sin(pitchRad) * Math.cos(azimuthRad),
  };

  // Convert the plane's bounding box to normalized coordinates
  const bbox = solarBBoxToNormalized(plane.boundingBox);

  // Compute the center of the polygon
  const center = computePolygonCenter(vertices);

  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_plane',
    authority,
    provenance,
    confidence: GOOGLE_SOLAR_PLANE_CONFIDENCE,
    label: `Roof plane ${planeIndex + 1} (pitch ${plane.roofPitch}°, azimuth ${plane.azimuth}°, ${plane.areaSqMeters.toFixed(1)} m²)`,
    limitations: [
      'Coordinates derived from Google Solar API pixel coordinates, not directly from aerial imagery',
      'Polygon outline may have minor alignment offsets relative to site survey photos',
      'Roof plane geometry from aerial imagery — may not match ground-level measurements exactly',
    ],
    bbox,
    polygon,
    center,
    planeType: 'roof',
    pitchDegrees: plane.roofPitch,
    azimuthDegrees: plane.azimuth,
    normalVector,
    areaSqM: plane.areaSqMeters,
    roofPlaneId: `solar-plane-${planeIndex}`,
    isSynthetic: false,
  });
}

// ─── Roof Line Inference ─────────────────────────────────────────────────────

/**
 * Infer roof lines from the roof plane data.
 *
 * The Google Solar API doesn't directly provide roof lines (ridge, eave,
 * hip, valley, rake). We infer them by looking at each plane's edges:
 *
 *   - Edges shared between two planes → ridge, hip, or valley
 *   - Edges not shared (building boundary) → eave or rake
 *
 * For the initial implementation, we take a simpler approach: for each
 * pair of planes whose bounding boxes overlap, we infer a single roof
 * line connecting their centers. The subtype is inferred from the
 * azimuth relationship between the planes.
 *
 * This is a best-effort heuristic. In Phase 2 (SAM + Contour Tracing),
 * we'll get much more accurate roof lines from contour tracing.
 */
function inferRoofLines(
  roofPlanes: SolarRoofPlane[],
  buildingBbox: SolarPixelBoundingBox,
  surveyId: string,
  provenance: GeometryProvenance,
  authority: UnifiedGeometryAuthority,
): UnifiedGeometryArtifact[] {
  const lineArtifacts: UnifiedGeometryArtifact[] = [];

  if (roofPlanes.length < 2) {
    // Need at least 2 planes to have shared edges
    return lineArtifacts;
  }

  // For each pair of planes whose bounding boxes overlap, infer a roof line
  for (let i = 0; i < roofPlanes.length; i++) {
    for (let j = i + 1; j < roofPlanes.length; j++) {
      const plane1 = roofPlanes[i];
      const plane2 = roofPlanes[j];

      // Check if bounding boxes overlap
      if (!bboxesOverlap(plane1.boundingBox, plane2.boundingBox)) {
        continue;
      }

      // Infer the roof line subtype from the plane azimuths
      const lineSubtype = inferRoofLineSubtype(plane1, plane2);

      // Compute the line segment connecting the centers of the two planes
      const center1 = solarPixelToNormalized(
        planeCenter(plane1.boundingBox),
        buildingBbox,
      );
      const center2 = solarPixelToNormalized(
        planeCenter(plane2.boundingBox),
        buildingBbox,
      );

      // Estimate line length from the distance between plane centers
      // This is approximate — the actual shared edge may be shorter
      const pixelDist = Math.sqrt(
        Math.pow(planeCenter(plane1.boundingBox).x - planeCenter(plane2.boundingBox).x, 2) +
        Math.pow(planeCenter(plane1.boundingBox).y - planeCenter(plane2.boundingBox).y, 2),
      );
      // Rough conversion: assume 1 pixel ≈ 0.1m (varies by imagery zoom level)
      const estimatedLengthM = pixelDist * 0.1;

      lineArtifacts.push(
        makeEmptyArtifact({
          id: uuid(),
          surveyId,
          geometryClass: 'roof_line',
          authority,
          provenance,
          confidence: GOOGLE_SOLAR_LINE_CONFIDENCE,
          label: `Inferred ${lineSubtype} line (planes ${i + 1}-${j + 1})`,
          limitations: [
            'Roof line inferred from adjacent roof planes, not directly from imagery',
            'Line position is approximate (connects plane centers, not shared edges)',
            'Line subtype is inferred from azimuth relationship, not directly detected',
          ],
          lineSegment: {
            start: center1,
            end: center2,
            coordinateSystem: 'normalized_image_0_1000',
          },
          lineSubtype,
          estimatedLengthM,
          isSynthetic: false,
        }),
      );
    }
  }

  // Also infer edge lines for planes at the building boundary
  // These are eave or rake lines where the plane meets the building edge
  for (let i = 0; i < roofPlanes.length; i++) {
    const plane = roofPlanes[i];
    const lineSubtype = inferRoofLineSubtype(plane, null);

    // Use the polygon outline's top and bottom edges as approximate eave/rake lines
    const outline = plane.planeOutline;
    if (!outline || outline.vertices.length < 2) continue;

    // For simplicity, use the first and last vertices as the line endpoints
    // (This is a rough approximation — the actual edge would be a specific
    // segment of the polygon boundary)
    const start = solarPixelToNormalized(outline.vertices[0], buildingBbox);
    const end = solarPixelToNormalized(
      outline.vertices[outline.vertices.length - 1],
      buildingBbox,
    );

    // Skip very short lines
    const dist = Math.sqrt(
      Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2),
    );
    if (dist < 30) continue; // Less than 3% of image width

    lineArtifacts.push(
      makeEmptyArtifact({
        id: uuid(),
        surveyId,
        geometryClass: 'roof_line',
        authority,
        provenance,
        confidence: GOOGLE_SOLAR_LINE_CONFIDENCE - 5, // Slightly lower confidence for edge lines
        label: `Inferred ${lineSubtype} edge line (plane ${i + 1})`,
        limitations: [
          'Edge line inferred from roof plane boundary, not directly from imagery',
          'Line endpoints are approximate (polygon vertices, not precise edge detection)',
          'Line subtype is heuristic (eave vs rake distinction may be incorrect)',
        ],
        lineSegment: {
          start,
          end,
          coordinateSystem: 'normalized_image_0_1000',
        },
        lineSubtype,
        isSynthetic: false,
      }),
    );
  }

  // Cap the number of inferred roof lines to avoid cluttering the overlay
  const MAX_ROOF_LINES = 20;
  if (lineArtifacts.length > MAX_ROOF_LINES) {
    // Keep the highest-confidence lines
    lineArtifacts.sort((a, b) => b.confidence - a.confidence);
    lineArtifacts.length = MAX_ROOF_LINES;
  }

  return lineArtifacts;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Compute the center of a polygon from its vertices.
 */
function computePolygonCenter(vertices: GeometryPoint2D[]): GeometryPoint2D {
  const n = vertices.length;
  const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
  const sumY = vertices.reduce((sum, v) => sum + v.y, 0);
  return {
    x: sumX / n,
    y: sumY / n,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Compute the center of a Solar API bounding box (in pixel coordinates).
 */
function planeCenter(bbox: SolarPixelBoundingBox): SolarApiPixelPoint {
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

/**
 * Check if two Solar API bounding boxes overlap.
 */
function bboxesOverlap(
  a: SolarPixelBoundingBox,
  b: SolarPixelBoundingBox,
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ─── Batch Adaptation Helper ─────────────────────────────────────────────────

/**
 * Adapt a Pipeline C result (which may include errors) into unified artifacts.
 *
 * If the Pipeline C result was unsuccessful, returns an empty array.
 * If successful, delegates to adaptBuildingInsightsToUnifiedArtifacts.
 */
export function adaptPipelineCResult(
  result: { success: boolean; buildingInsights: BuildingInsightsResponse | null },
  surveyId: string,
): UnifiedGeometryArtifact[] {
  if (!result.success || !result.buildingInsights) {
    return [];
  }
  return adaptBuildingInsightsToUnifiedArtifacts(result.buildingInsights, surveyId);
}
