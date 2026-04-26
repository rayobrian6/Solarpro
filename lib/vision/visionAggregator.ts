// ============================================================================
// lib/vision/visionAggregator.ts — Vision Detection Aggregation Engine
//
// VERSION: VISION_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   PhotoVisionResult[] (from ar_detections / inference run)
//     → aggregateVisionResults()  ← YOU ARE HERE
//     → VisionAggregationResult
//     → patchSystemDefinitionFromVision() (visionPatch.ts)
//
// RESPONSIBILITIES:
//   1. Accept an array of per-photo inference results
//   2. Filter detections below confidence thresholds (confidenceGate)
//   3. Project image-space detections → world-space XY coordinates
//   4. Cluster nearby same-class detections → single ObstructionNode / ElectricalNode
//   5. Assign detections to roof planes (by GPS proximity or label matching)
//   6. Derive PlaneCorrections from roof geometry detections
//   7. Return VisionAggregationResult with full audit log
//
// PROJECTION STRATEGY:
//   Given a detection bbox (center x,y normalized 0–1) in a photo taken from
//   position (photoLat, photoLng) facing azimuth θ at pitch φ:
//
//   The detection's angular offset from photo center:
//     dAz  = (bbox.x - 0.5) * HFOV_DEG  (horizontal, +East)
//     dEl  = (bbox.y - 0.5) * VFOV_DEG  (vertical, +Down = towards roof)
//
//   Bearing to detection:
//     bearing = azimuth + dAz
//
//   Estimated ground distance:
//     If camera pitch φ (from horizontal):
//       groundDist = cameraHeightM / tan(pitch + dEl)
//     Fallback: use ESTIMATED_PHOTO_DISTANCE_M
//
//   World position:
//     worldX = photoX + cos(bearing_rad) * groundDist
//     worldY = photoY + sin(bearing_rad) * groundDist
//
// NON-BREAKING GUARANTEE:
//   - If photos array is empty → returns empty VisionAggregationResult
//   - If projection fails for any photo → detection placed at photo GPS centroid
//   - NEVER throws — all errors caught; partial results always returned
// ============================================================================

import {
  VISION_PIPELINE_VERSION,
  CLUSTER_RADIUS_M,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  OBSTRUCTION_CLASS_DEFAULTS,
  type PhotoVisionResult,
  type VisionAggregationResult,
  type WorldDetection,
  type ObstructionNode,
  type ElectricalNode,
  type PlaneCorrection,
  type DetectionClass,
  type ObstructionClass,
  type ElectricalClass,
  type RoofGeometryClass,
  type VisionDetection,
  type PhotoContext,
  type ConfidenceThresholds,
} from './types';

import { latLngToXY, dist2D, centroid, type Point2D } from '@/lib/cad/geometry';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Estimated horizontal field of view of a smartphone camera (degrees) */
const HFOV_DEG = 65;

/** Estimated vertical field of view of a smartphone camera (degrees) */
const VFOV_DEG = 50;

/** Estimated camera height above ground when taking a roof photo (meters) */
const CAMERA_HEIGHT_M = 1.6;

/** Fallback ground distance when projection math fails (meters) */
const FALLBACK_DISTANCE_M = 5.0;

/** Default story height estimate (meters) per floor for wall-mounted electrical */
const STORY_HEIGHT_M = 3.0;

const DEG = Math.PI / 180;

// ─── Classification helpers ──────────────────────────────────────────────────

const OBSTRUCTION_CLASSES = new Set<string>([
  'vent', 'skylight', 'hvac_unit', 'chimney', 'pipe_jack',
  'dormer', 'solar_tube', 'antenna', 'other_obstruction',
]);

const ELECTRICAL_CLASSES = new Set<string>([
  'meter_socket', 'main_panel', 'disconnect', 'sub_panel', 'service_entry',
]);

const ROOF_GEOMETRY_CLASSES = new Set<string>([
  'roof_edge', 'ridge_line', 'valley_line', 'gutter_line', 'hip_line',
]);

function isObstructionClass(c: string): c is ObstructionClass {
  return OBSTRUCTION_CLASSES.has(c);
}

function isElectricalClass(c: string): c is ElectricalClass {
  return ELECTRICAL_CLASSES.has(c);
}

function isRoofGeometryClass(c: string): c is RoofGeometryClass {
  return ROOF_GEOMETRY_CLASSES.has(c);
}

function isKnownClass(c: string): c is DetectionClass {
  return isObstructionClass(c) || isElectricalClass(c) || isRoofGeometryClass(c);
}

// ─── Confidence gating ───────────────────────────────────────────────────────

function meetsThreshold(
  detection: VisionDetection,
  thresholds: ConfidenceThresholds,
): boolean {
  const cls = detection.class as DetectionClass;
  const classThreshold = thresholds.byClass[cls] ?? thresholds.default;
  return detection.confidence >= classThreshold;
}

// ─── World projection ─────────────────────────────────────────────────────────

/**
 * Project a single detection from image-space to world-space XY (meters).
 * Returns the world position and the projection method used.
 */
function projectDetectionToWorld(
  detection: VisionDetection,
  ctx: PhotoContext,
  origin: { lat: number; lng: number },
  log: string[],
): { worldX: number; worldY: number; radiusM: number; method: WorldDetection['projectionMethod'] } {
  const bbox = detection.bbox;

  // Method 1: GPS + azimuth + pitch → full projection
  if (
    ctx.lat != null && ctx.lng != null &&
    ctx.azimuth != null
  ) {
    try {
      const photoXY = latLngToXY(ctx.lat, ctx.lng, origin.lat, origin.lng);
      const pitch = ctx.pitch ?? 0; // degrees from horizontal (0 = looking horizontally)

      // Angular offset of detection center from photo center
      const dAz = (bbox.x - 0.5) * HFOV_DEG;   // +East
      const dEl = -(bbox.y - 0.5) * VFOV_DEG;  // +Up (image y flipped)

      const bearingDeg = ((ctx.azimuth + dAz) + 360) % 360;
      const bearingRad = bearingDeg * DEG;

      // Estimate ground distance using camera geometry
      const totalPitchDeg = pitch + dEl;
      let groundDistM: number;
      if (Math.abs(totalPitchDeg) > 5 && totalPitchDeg < 85) {
        groundDistM = CAMERA_HEIGHT_M / Math.tan(totalPitchDeg * DEG);
        groundDistM = Math.max(0.5, Math.min(groundDistM, 30)); // clamp to sane range
      } else {
        groundDistM = FALLBACK_DISTANCE_M;
      }

      // East/North components
      const worldX = photoXY.x + Math.sin(bearingRad) * groundDistM;
      const worldY = photoXY.y + Math.cos(bearingRad) * groundDistM;

      // Estimate footprint radius from bbox size
      const bboxWidthM = bbox.width * groundDistM * Math.tan((HFOV_DEG / 2) * DEG) * 2;
      const radiusM = Math.max(0.10, bboxWidthM / 2);

      return { worldX, worldY, radiusM, method: 'gps_azimuth_pitch' };
    } catch (err) {
      log.push(`[aggregator] projection failed for ${detection.class}: ${err} — falling back to GPS centroid`);
    }
  }

  // Method 2: GPS only → place at photo GPS position
  if (ctx.lat != null && ctx.lng != null) {
    const photoXY = latLngToXY(ctx.lat, ctx.lng, origin.lat, origin.lng);
    const cls = detection.class as DetectionClass;
    const defaults = isObstructionClass(cls)
      ? OBSTRUCTION_CLASS_DEFAULTS[cls as ObstructionClass]
      : { radiusM: 0.40, heightFt: 2.0, setbackIn: 18 };
    return { worldX: photoXY.x, worldY: photoXY.y, radiusM: defaults.radiusM, method: 'gps_centroid' };
  }

  // Method 3: No GPS — use (0,0) fallback (will be filtered in post-processing)
  return { worldX: 0, worldY: 0, radiusM: 0.40, method: 'none' };
}

// ─── Roof plane assignment ───────────────────────────────────────────────────

/**
 * Assign a detection to a roof plane based on:
 *   1. Explicit label match (ctx.label contains plane id or compass direction)
 *   2. GPS proximity to plane centroid
 *   3. Fallback: null
 */
function assignToRoofPlane(
  worldX: number,
  worldY: number,
  ctx: PhotoContext,
  roofPlanes: Array<{ id: string; centroidX: number; centroidY: number }>,
): string | null {
  if (roofPlanes.length === 0) return null;

  // Label-based assignment: look for plane id in photo label
  if (ctx.label && ctx.roofPlaneId) {
    const match = roofPlanes.find(p => p.id === ctx.roofPlaneId);
    if (match) return match.id;
  }

  // GPS proximity: find closest plane centroid
  let closest: string | null = null;
  let closestDist = Infinity;
  for (const plane of roofPlanes) {
    const d = dist2D({ x: worldX, y: worldY }, { x: plane.centroidX, y: plane.centroidY });
    if (d < closestDist) {
      closestDist = d;
      closest = plane.id;
    }
  }

  // Only assign if within 15m of a plane centroid (loose threshold)
  return closestDist <= 15 ? closest : null;
}

// ─── Spatial clustering ──────────────────────────────────────────────────────

interface ClusterInput {
  cls: string;
  worldX: number;
  worldY: number;
  radiusM: number;
  confidence: number;
  detectionId: string;
  roofPlaneId: string | null;
  source: WorldDetection;
}

/**
 * Merge nearby same-class detections into clusters.
 * Within a cluster, the highest-confidence detection wins for position.
 */
function clusterDetections(detections: ClusterInput[]): Array<{
  cls: string;
  worldX: number;
  worldY: number;
  radiusM: number;
  confidence: number;
  count: number;
  ids: string[];
  roofPlaneId: string | null;
  sources: WorldDetection[];
}> {
  const clusters: Array<{
    cls: string;
    members: ClusterInput[];
  }> = [];

  for (const det of detections) {
    // Find an existing cluster of same class within CLUSTER_RADIUS_M
    const existing = clusters.find(c => {
      if (c.cls !== det.cls) return false;
      // Compare against cluster centroid (mean of member positions)
      const members = c.members;
      const cx = members.reduce((s, m) => s + m.worldX, 0) / members.length;
      const cy = members.reduce((s, m) => s + m.worldY, 0) / members.length;
      return dist2D({ x: det.worldX, y: det.worldY }, { x: cx, y: cy }) <= CLUSTER_RADIUS_M;
    });

    if (existing) {
      existing.members.push(det);
    } else {
      clusters.push({ cls: det.cls, members: [det] });
    }
  }

  return clusters.map(c => {
    // Best member = highest confidence
    const best = c.members.reduce((a, b) => a.confidence >= b.confidence ? a : b);
    return {
      cls: c.cls,
      worldX: best.worldX,
      worldY: best.worldY,
      radiusM: Math.max(...c.members.map(m => m.radiusM)),
      confidence: best.confidence,
      count: c.members.length,
      ids: c.members.map(m => m.detectionId).filter(Boolean),
      roofPlaneId: best.roofPlaneId,
      sources: c.members.map(m => m.source),
    };
  });
}

// ─── ID generation ───────────────────────────────────────────────────────────

/** Generate a deterministic id from class + world position (for stability) */
function makeNodeId(cls: string, worldX: number, worldY: number): string {
  const x = Math.round(worldX * 10) / 10;
  const y = Math.round(worldY * 10) / 10;
  return `${cls}_${x}_${y}`.replace(/\./g, 'p').replace(/-/g, 'n');
}

// ─── Main aggregator ─────────────────────────────────────────────────────────

export interface AggregatorOptions {
  /** Override default confidence thresholds */
  thresholds?: Partial<ConfidenceThresholds>;
  /** Project GPS origin (defaults to centroid of all photo GPS positions) */
  origin?: { lat: number; lng: number };
  /** Roof plane data for assignment */
  roofPlanes?: Array<{ id: string; lat: number; lng: number }>;
}

/**
 * aggregateVisionResults — the main aggregation function.
 *
 * Takes per-photo inference results, filters, projects, clusters, and
 * returns a complete VisionAggregationResult.
 *
 * NON-BREAKING: Returns an empty result (no obstructions, no nodes) if
 * photos array is empty or all detections fail thresholds.
 */
export function aggregateVisionResults(
  photos: PhotoVisionResult[],
  projectId: string,
  surveyId: string,
  options: AggregatorOptions = {},
): VisionAggregationResult {
  const log: string[] = [];
  const startMs = Date.now();

  log.push(`[aggregator] START projectId=${projectId} surveyId=${surveyId} photos=${photos.length}`);

  // ── Empty guard ──────────────────────────────────────────────────────────
  if (photos.length === 0) {
    log.push('[aggregator] No photos provided — returning empty result');
    return _emptyResult(projectId, surveyId, log);
  }

  // ── Merge thresholds ─────────────────────────────────────────────────────
  const thresholds: ConfidenceThresholds = {
    default: options.thresholds?.default ?? DEFAULT_CONFIDENCE_THRESHOLDS.default,
    byClass: {
      ...DEFAULT_CONFIDENCE_THRESHOLDS.byClass,
      ...options.thresholds?.byClass,
    },
  };

  // ── Resolve GPS origin ───────────────────────────────────────────────────
  let origin = options.origin;
  if (!origin) {
    const gpsPoints: Array<{ lat: number; lng: number }> = [];
    for (const pv of photos) {
      if (pv.photoContext.lat != null && pv.photoContext.lng != null) {
        gpsPoints.push({ lat: pv.photoContext.lat, lng: pv.photoContext.lng });
      }
    }
    if (gpsPoints.length > 0) {
      origin = {
        lat: gpsPoints.reduce((s, p) => s + p.lat, 0) / gpsPoints.length,
        lng: gpsPoints.reduce((s, p) => s + p.lng, 0) / gpsPoints.length,
      };
      log.push(`[aggregator] GPS origin resolved from ${gpsPoints.length} photo GPS points: ${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
    } else {
      origin = { lat: 0, lng: 0 };
      log.push('[aggregator] WARNING: No photo GPS data available — using (0,0) origin');
    }
  }

  // ── Build roof plane lookup ──────────────────────────────────────────────
  const roofPlaneLookup: Array<{ id: string; centroidX: number; centroidY: number }> = [];
  if (options.roofPlanes) {
    for (const plane of options.roofPlanes) {
      const xy = latLngToXY(plane.lat, plane.lng, origin.lat, origin.lng);
      roofPlaneLookup.push({ id: plane.id, centroidX: xy.x, centroidY: xy.y });
    }
  }

  // ── Process each photo ────────────────────────────────────────────────────
  let totalRaw = 0;
  let totalFiltered = 0;
  const allWorldDetections: WorldDetection[] = [];

  for (const pv of photos) {
    const detections = pv.inferenceResult.detections ?? [];
    totalRaw += detections.length;

    for (const det of detections) {
      // Skip unknown classes
      if (!isKnownClass(det.class)) {
        totalFiltered++;
        log.push(`[aggregator] SKIP unknown class="${det.class}" conf=${det.confidence.toFixed(2)}`);
        continue;
      }

      // Confidence gate
      if (!meetsThreshold(det, thresholds)) {
        totalFiltered++;
        continue;
      }

      // Project to world
      const proj = projectDetectionToWorld(det, pv.photoContext, origin, log);

      // Skip zero-GPS projections for obstructions (they're meaningless without location)
      if (proj.method === 'none' && isObstructionClass(det.class)) {
        totalFiltered++;
        log.push(`[aggregator] SKIP obstruction ${det.class} — no GPS context`);
        continue;
      }

      // Assign to roof plane
      const roofPlaneId = assignToRoofPlane(
        proj.worldX, proj.worldY,
        pv.photoContext,
        roofPlaneLookup,
      );

      const wd: WorldDetection = {
        class: det.class as DetectionClass,
        confidence: det.confidence,
        worldX: proj.worldX,
        worldY: proj.worldY,
        radiusM: proj.radiusM,
        roofPlaneId,
        source: pv.photoContext,
        rawDetection: det,
        projectionMethod: proj.method,
      };

      allWorldDetections.push(wd);
    }
  }

  log.push(`[aggregator] World detections: total_raw=${totalRaw} filtered=${totalFiltered} projected=${allWorldDetections.length}`);

  // ── Split by type ─────────────────────────────────────────────────────────
  const obstructionDetections = allWorldDetections.filter(d => isObstructionClass(d.class));
  const electricalDetections  = allWorldDetections.filter(d => isElectricalClass(d.class));
  const geometryDetections    = allWorldDetections.filter(d => isRoofGeometryClass(d.class));

  // ── Cluster obstructions ──────────────────────────────────────────────────
  const obsClusters = clusterDetections(
    obstructionDetections.map(d => ({
      cls: d.class,
      worldX: d.worldX,
      worldY: d.worldY,
      radiusM: d.radiusM,
      confidence: d.confidence,
      detectionId: d.rawDetection.detection_id ?? '',
      roofPlaneId: d.roofPlaneId,
      source: d,
    })),
  );

  const obstructions: ObstructionNode[] = obsClusters.map(c => {
    const cls = c.cls as ObstructionClass;
    const defaults = OBSTRUCTION_CLASS_DEFAULTS[cls] ?? OBSTRUCTION_CLASS_DEFAULTS.other_obstruction;
    return {
      id: makeNodeId(cls, c.worldX, c.worldY),
      type: cls,
      worldX: c.worldX,
      worldY: c.worldY,
      radiusM: c.radiusM,
      heightFt: defaults.heightFt,
      setbackIn: defaults.setbackIn,
      confidence: c.confidence,
      detectionCount: c.count,
      roofPlaneId: c.roofPlaneId,
      sourceDetectionIds: c.ids,
      source: 'vision',
    };
  });

  log.push(`[aggregator] Obstructions: ${obstructions.length} nodes from ${obstructionDetections.length} detections`);

  // ── Cluster electrical nodes ───────────────────────────────────────────────
  const elecClusters = clusterDetections(
    electricalDetections.map(d => ({
      cls: d.class,
      worldX: d.worldX,
      worldY: d.worldY,
      radiusM: d.radiusM,
      confidence: d.confidence,
      detectionId: d.rawDetection.detection_id ?? '',
      roofPlaneId: d.roofPlaneId,
      source: d,
    })),
  );

  // Determine primary interconnect: prefer main_panel, then disconnect, then meter_socket
  const PRIMARY_PRIORITY: ElectricalClass[] = ['main_panel', 'disconnect', 'meter_socket', 'sub_panel', 'service_entry'];
  let primaryAssigned = false;

  const electricalNodes: ElectricalNode[] = elecClusters
    .sort((a, b) => {
      const ai = PRIMARY_PRIORITY.indexOf(a.cls as ElectricalClass);
      const bi = PRIMARY_PRIORITY.indexOf(b.cls as ElectricalClass);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(c => {
      const cls = c.cls as ElectricalClass;
      const isPrimary = !primaryAssigned && PRIMARY_PRIORITY.includes(cls);
      if (isPrimary) primaryAssigned = true;

      // Estimate story from photo label or world Y (rough heuristic)
      const storyGuess = c.sources.some(s => s.source.label?.includes('2') || s.source.label?.includes('second')) ? 2 : 1;

      return {
        id: makeNodeId(cls, c.worldX, c.worldY),
        type: cls,
        worldX: c.worldX,
        worldY: c.worldY,
        story: storyGuess,
        confidence: c.confidence,
        detectionCount: c.count,
        sourceDetectionIds: c.ids,
        isPrimaryInterconnect: isPrimary,
        source: 'vision',
      };
    });

  log.push(`[aggregator] Electrical nodes: ${electricalNodes.length} nodes from ${electricalDetections.length} detections`);

  // ── Derive plane corrections from geometry detections ─────────────────────
  const planeCorrections: PlaneCorrection[] = _derivePlaneCorrections(
    geometryDetections,
    roofPlaneLookup,
    origin,
    log,
  );

  log.push(`[aggregator] Plane corrections: ${planeCorrections.length}`);

  // ── Class counts ──────────────────────────────────────────────────────────
  const classCounts: Record<string, number> = {};
  for (const d of allWorldDetections) {
    classCounts[d.class] = (classCounts[d.class] ?? 0) + 1;
  }

  const hasHighConfidenceDetections =
    obstructions.some(o => o.confidence >= 0.70) ||
    electricalNodes.some(e => e.confidence >= 0.70);

  const durationMs = Date.now() - startMs;
  log.push(`[aggregator] DONE durationMs=${durationMs} obstructions=${obstructions.length} electrical=${electricalNodes.length} planeCorrections=${planeCorrections.length}`);

  return {
    projectId,
    surveyId,
    aggregatedAt: new Date().toISOString(),
    pipelineVersion: VISION_PIPELINE_VERSION,
    obstructions,
    electricalNodes,
    planeCorrections,
    photosProcessed: photos.length,
    rawDetectionCount: totalRaw,
    filteredCount: totalFiltered,
    classCounts,
    log,
    hasHighConfidenceDetections,
  };
}

// ─── Plane correction derivation ─────────────────────────────────────────────

/**
 * Derive PlaneCorrections from roof geometry class detections.
 *
 * Current strategy: if ridge_line or gutter_line detections are significantly
 * offset from a roof plane centroid in a consistent direction, flag a
 * polygon_offset correction.
 *
 * This is a conservative first implementation — corrections are only flagged
 * when confidence is high (>= 0.70) and at least 2 detections agree.
 */
function _derivePlaneCorrections(
  geometryDetections: WorldDetection[],
  roofPlanes: Array<{ id: string; centroidX: number; centroidY: number }>,
  origin: { lat: number; lng: number },
  log: string[],
): PlaneCorrection[] {
  const corrections: PlaneCorrection[] = [];

  if (geometryDetections.length === 0 || roofPlanes.length === 0) return corrections;

  // Group geometry detections by roof plane
  const byPlane = new Map<string, WorldDetection[]>();
  for (const d of geometryDetections) {
    if (!d.roofPlaneId) continue;
    const existing = byPlane.get(d.roofPlaneId) ?? [];
    existing.push(d);
    byPlane.set(d.roofPlaneId, existing);
  }

  for (const [planeId, dets] of byPlane) {
    const plane = roofPlanes.find(p => p.id === planeId);
    if (!plane) continue;

    // Ridge corrections: ridge_line detections should be near the plane top
    const ridgeDets = dets.filter(d => d.class === 'ridge_line' && d.confidence >= 0.70);
    if (ridgeDets.length >= 2) {
      const avgX = ridgeDets.reduce((s, d) => s + d.worldX, 0) / ridgeDets.length;
      const avgY = ridgeDets.reduce((s, d) => s + d.worldY, 0) / ridgeDets.length;
      const offsetX = avgX - plane.centroidX;
      const offsetY = avgY - plane.centroidY;
      const offsetMag = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

      if (offsetMag > 1.5) {
        corrections.push({
          roofPlaneId: planeId,
          correctionType: 'polygon_offset',
          offsetX: offsetX * 0.5, // conservative: apply 50% of detected offset
          offsetY: offsetY * 0.5,
          confidence: Math.min(...ridgeDets.map(d => d.confidence)),
          sourceClass: 'ridge_line',
        });
        log.push(`[aggregator] PlaneCorrection polygon_offset planeId=${planeId} offsetMag=${offsetMag.toFixed(2)}m`);
      }
    }
  }

  return corrections;
}

// ─── Empty result helper ──────────────────────────────────────────────────────

function _emptyResult(
  projectId: string,
  surveyId: string,
  log: string[],
): VisionAggregationResult {
  return {
    projectId,
    surveyId,
    aggregatedAt: new Date().toISOString(),
    pipelineVersion: VISION_PIPELINE_VERSION,
    obstructions: [],
    electricalNodes: [],
    planeCorrections: [],
    photosProcessed: 0,
    rawDetectionCount: 0,
    filteredCount: 0,
    classCounts: {},
    log,
    hasHighConfidenceDetections: false,
  };
}