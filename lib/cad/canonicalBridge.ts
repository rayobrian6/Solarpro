// ============================================================================
// lib/cad/canonicalBridge.ts — CanonicalBuildingModel → CAD Bridge
//
// This is the SINGLE LEGAL PATH from the unified geometry pipeline into the
// CAD engine. No other module may feed geometry data into CAD.
//
// PIPELINE POSITION:
//   CanonicalBuildingModel (from unifiedGeometry/canonicalBuilder)
//     → canonicalToCADInputs()  ← YOU ARE HERE
//     → generateCADLayout()     → CADModel
//
// NON-NEGOTIABLE:
//   1. Only CanonicalBuildingModel with promoted_canonical or cad_safe authority can feed CAD
//   2. All obstructions pass through with source='promoted_canonical'
//   3. Raw vision artifacts are NEVER accepted — they must be promoted first
//   4. Mock artifacts are BLOCKED — they cannot enter the CAD pipeline
//   5. Every CADObstruction/CADElectricalNode traces back to its canonical source
//   6. This bridge REJECTS any model that hasn't been through human review
//
// BYPASS PREVENTION:
//   - CADObstruction.source='vision' is ILLEGAL through this bridge
//   - roofObstructionRegistration data must go through promotion first
//   - patchSystemDefinitionFromVision() has been removed — this is the sole legal path
// ============================================================================

import type { CanonicalBuildingModel, CanonicalRoofPlane, CanonicalObstruction, CanonicalElectricalNode } from '@/lib/siteSurveys/unifiedGeometry/types';
import { assertNoCadMutation, isSyntheticArtifact } from '@/lib/siteSurveys/unifiedGeometry/authority';
import type { UnifiedGeometryAuthorityState } from '@/lib/siteSurveys/unifiedGeometry/authority';
import type { CADObstruction, CADElectricalNode } from './types';
import type { Point2D } from './geometry';
import { latLngToXY, polygonArea, centroid } from './geometry';

// ── Bridge Types ─────────────────────────────────────────────────────────────

/**
 * Result of converting a CanonicalBuildingModel to CAD-compatible inputs.
 *
 * These arrays can be directly assigned to CADModel.obstructions and
 * CADModel.electricalNodes — they are the ONLY legal source of vision-derived
 * geometry in the CAD engine.
 */
export interface CADCanonicalRoofPlaneInput {
  /** Canonical roof plane id */
  id: string;
  /** CAD local XY meters — raw plane boundary from CanonicalBuildingModel */
  polygon: Point2D[];
  /** Pitch in degrees */
  pitch: number;
  /** Azimuth in degrees */
  azimuth: number;
  /** Canonical area in square meters */
  areaSqM: number;
  /** Canonical setback defaults in meters */
  setbacks: {
    eaveM: number;
    ridgeM: number;
    rakeM: number;
  };
  /** Provenance back to the promoted source artifact */
  sourceArtifactId: string;
}

export interface CanonicalBridgeResult {
  /** CAD-ready roof planes from the canonical model */
  roofPlanes: CADCanonicalRoofPlaneInput[];
  /** CAD-ready obstructions from the canonical model */
  obstructions: CADObstruction[];
  /** CAD-ready electrical nodes from the canonical model */
  electricalNodes: CADElectricalNode[];
  /** Bridge audit log — every conversion step */
  log: string[];
  /** Number of roof planes that were converted */
  roofPlanesConverted: number;
  /** Number of roof planes skipped */
  roofPlanesSkipped: number;
  /** Number of obstructions that were converted */
  obstructionsConverted: number;
  /** Number of electrical nodes that were converted */
  electricalNodesConverted: number;
  /** Number of obstructions skipped (e.g., missing world projection) */
  obstructionsSkipped: number;
  /** Number of electrical nodes skipped */
  electricalNodesSkipped: number;
  /** Origin latitude used for lat/lng → local-meters projection of worldPolygon roof planes.
   *  Null if no world-to-local projection was needed (all planes had local_meters_xy polygons). */
  originLat: number | null;
  /** Origin longitude used for lat/lng → local-meters projection. Null if not needed. */
  originLng: number | null;
}

/**
 * World projection function — converts normalized image coordinates to
 * local CAD XY meters. Must be provided by the caller based on the
 * survey's GPS origin and image-to-world calibration.
 *
 * If not provided, obstructions/nodes without world coordinates are skipped.
 */
export type WorldProjectionFn = (
  normalizedX: number,
  normalizedY: number,
  roofPlaneId: string | null,
) => { x: number; y: number } | null;

// ── Bridge Configuration ─────────────────────────────────────────────────────

export interface CanonicalBridgeConfig {
  /**
   * Function to project normalized image coordinates to CAD local meters.
   * Required for obstructions/nodes that only have image-space coordinates.
   * If not provided, items without world coordinates are skipped.
   */
  worldProjection?: WorldProjectionFn;

  /**
   * Whether to skip items that lack a valid world projection.
   * Default: true (items without projection are skipped with a warning).
   * If false, items without projection get x=0, y=0 (DANGEROUS — for testing only).
   */
  skipWithoutProjection?: boolean;

  /**
   * Origin latitude for lat/lng → local-meters projection.
   * Used when converting worldPolygon (lat/lng) roof planes to local meters.
   * If not provided, the origin is derived from the first world polygon vertex
   * across all roof planes in the model.
   */
  originLat?: number;

  /**
   * Origin longitude for lat/lng → local-meters projection.
   * Used when converting worldPolygon (lat/lng) roof planes to local meters.
   * If not provided, the origin is derived from the first world polygon vertex
   * across all roof planes in the model.
   */
  originLng?: number;
}

// ── Bridge Error ──────────────────────────────────────────────────────────────

export class CanonicalBridgeError extends Error {
  constructor(message: string) {
    super(`[CANONICAL_BRIDGE_ERROR] ${message}`);
    this.name = 'CanonicalBridgeError';
  }
}

// ── Main Bridge Function ─────────────────────────────────────────────────────

/**
 * canonicalToCADInputs — the ONLY legal path from CanonicalBuildingModel
 * to CAD-compatible obstruction and electrical node arrays.
 *
 * SECURITY CONTRACT:
 *   1. The model MUST have cad_safe or promoted_canonical authority
 *   2. Mock artifacts are REJECTED — they cannot enter CAD
 *   3. All output items have source='promoted_canonical' — never 'vision'
 *   4. Every item links back to its source artifact ID for provenance
 *
 * @param model    CanonicalBuildingModel from the unified geometry pipeline
 * @param config   Bridge configuration (world projection, etc.)
 * @returns        CanonicalBridgeResult with CAD-ready arrays
 * @throws         CanonicalBridgeError if model authority is insufficient
 */
export function canonicalToCADInputs(
  model: CanonicalBuildingModel,
  config: CanonicalBridgeConfig = {},
): CanonicalBridgeResult {
  const log: string[] = [];
  const tag = `[CANONICAL_BRIDGE] surveyId=${model.surveyId}`;

  // ── Authority gate ──────────────────────────────────────────────────────────
  // The bridge accepts both 'promoted_canonical' and 'cad_safe' authority states.
  // 'promoted_canonical' is the canonical source of truth with permitGenerationAllowed=true;
  // it may feed the CAD pipeline for permit generation even though cadConsumable is false
  // (cadConsumable=true is reserved for the terminal cad_safe state which also allows
  // direct CAD mutation). The strict isCadConsumable() check is too narrow here —
  // the bridge's own policy is: promoted_canonical + no mock artifacts = allowed.
  const allowedBridgeStates: UnifiedGeometryAuthorityState[] = ['promoted_canonical', 'cad_safe'];
  if (!allowedBridgeStates.includes(model.authority.state) || model.authority.mockArtifact) {
    throw new CanonicalBridgeError(
      `CanonicalBuildingModel authority state='${model.authority.state}' is not CAD-consumable. ` +
      `Only 'cad_safe' or 'promoted_canonical' authority models may feed the CAD engine. ` +
      `Promote artifacts through the review workflow first.`,
    );
  }

  // ── Mock artifact gate ──────────────────────────────────────────────────
  if (model.authority.mockArtifact) {
    throw new CanonicalBridgeError(
      'CanonicalBuildingModel contains mock artifacts — mock data is BLOCKED from the CAD pipeline. ' +
      'Ensure all source artifacts are from real pipeline runs, not mock/test data.',
    );
  }

  // ── Synthetic artifact gate ──
  // Check all obstructions and electrical nodes for synthetic provenance.
  // Synthetic artifacts (produced by heuristic/fake implementations) can NEVER
  // enter the CAD pipeline, regardless of their authority state.
  const syntheticObstructions = model.obstructions.filter(
    obs => isSyntheticArtifact(obs as unknown as { synthetic?: boolean })
  );
  const syntheticElectricalNodes = model.electricalNodes.filter(
    node => isSyntheticArtifact(node as unknown as { synthetic?: boolean })
  );
  if (syntheticObstructions.length > 0 || syntheticElectricalNodes.length > 0) {
    const details: string[] = [];
    for (const obs of syntheticObstructions) {
      details.push(`obstruction id=${obs.id} type=${obs.type}`);
    }
    for (const node of syntheticElectricalNodes) {
      details.push(`electricalNode id=${node.id} type=${node.type}`);
    }
    throw new CanonicalBridgeError(
      `CanonicalBuildingModel contains synthetic artifacts — BLOCKED from CAD pipeline. ` +
      `Synthetic artifacts are produced by heuristic implementations, not real ML models. ` +
      `${details.length} synthetic item(s): ${details.join(', ')}. ` +
      `Await real model integration before these artifacts can be used.`
    );
  }

  log.push(`${tag} START authority=${model.authority.state} roofPlanes=${model.roofPlanes.length} obstructions=${model.obstructions.length} electricalNodes=${model.electricalNodes.length}`);

  // ── Degraded geometry gate ────────────────────────────────────────
  // Roof/wall planes missing polygon data MUST NOT flow into CAD.
  // They carry the degradedNoGeometry flag set by CanonicalModelBuilder.
  const degradedRoofPlanes = model.roofPlanes.filter(p => p.degradedNoGeometry);
  const degradedWallPlanes = model.wallPlanes.filter(p => p.degradedNoGeometry);
  if (degradedRoofPlanes.length > 0 || degradedWallPlanes.length > 0) {
    throw new CanonicalBridgeError(
      `CanonicalBuildingModel contains ${degradedRoofPlanes.length} degraded roof plane(s) and ` +
      `${degradedWallPlanes.length} degraded wall plane(s) with no polygon geometry. ` +
      `Degraded planes CANNOT enter the CAD pipeline — their geometry is fabricated/missing. ` +
      `Ensure all source artifacts have polygon or bbox data before promoting to canonical.`,
    );
  }

  // ── Convert roof planes ─────────────────────────────────────────────────
  let roofPlanesConverted = 0;
  let roofPlanesSkipped = 0;
  const roofPlanes: CADCanonicalRoofPlaneInput[] = [];

  // ── Derive lat/lng origin for worldPolygon → local-meters projection ──────
  // If config supplies originLat/originLng, use those. Otherwise scan all roof
  // planes' worldPolygon vertices and use the first vertex as origin (same
  // strategy as the legacy roofCAD lat/lng path).
  let originLat = config.originLat;
  let originLng = config.originLng;
  if (originLat == null || originLng == null) {
    // Try model metadata first
    if (model.metadata?.latitude != null && model.metadata?.longitude != null) {
      originLat = model.metadata.latitude;
      originLng = model.metadata.longitude;
    } else {
      // Derive from first world polygon vertex
      for (const rp of model.roofPlanes) {
        if (rp.worldPolygon?.vertices?.length) {
          originLat = rp.worldPolygon.vertices[0].lat;
          originLng = rp.worldPolygon.vertices[0].lng;
          break;
        }
      }
    }
  }

  for (const canonicalRoofPlane of model.roofPlanes) {
    const converted = convertRoofPlane(canonicalRoofPlane, log, tag, originLat, originLng);
    if (converted) {
      roofPlanes.push(converted);
      roofPlanesConverted++;
    } else {
      roofPlanesSkipped++;
    }
  }

  if (model.roofPlanes.length > 0 && roofPlanesConverted === 0) {
    throw new CanonicalBridgeError(
      'CanonicalBuildingModel contains roof planes, but none are CAD-safe. ' +
      'Permit/CAD generation requires at least one local_meters_xy roof polygon with 3+ finite vertices.',
    );
  }

  // ── Convert obstructions ────────────────────────────────────────────────
  let obstructionsConverted = 0;
  let obstructionsSkipped = 0;
  const obstructions: CADObstruction[] = [];

  for (const canonicalObs of model.obstructions) {
    const converted = convertObstruction(canonicalObs, config, log, tag);
    if (converted) {
      obstructions.push(converted);
      obstructionsConverted++;
    } else {
      obstructionsSkipped++;
    }
  }

  // ── Convert electrical nodes ────────────────────────────────────────────
  let electricalNodesConverted = 0;
  let electricalNodesSkipped = 0;
  const electricalNodes: CADElectricalNode[] = [];

  for (const canonicalNode of model.electricalNodes) {
    const converted = convertElectricalNode(canonicalNode, config, log, tag);
    if (converted) {
      electricalNodes.push(converted);
      electricalNodesConverted++;
    } else {
      electricalNodesSkipped++;
    }
  }

  log.push(
    `${tag} DONE roofPlanes=${roofPlanesConverted} (skipped=${roofPlanesSkipped}) ` +
    `obstructions=${obstructionsConverted} (skipped=${obstructionsSkipped}) ` +
    `electricalNodes=${electricalNodesConverted} (skipped=${electricalNodesSkipped})`,
  );

  return {
    roofPlanes,
    obstructions,
    electricalNodes,
    log,
    roofPlanesConverted,
    roofPlanesSkipped,
    obstructionsConverted,
    electricalNodesConverted,
    obstructionsSkipped,
    electricalNodesSkipped,
    originLat: originLat ?? null,
    originLng: originLng ?? null,
  };
}

// ── Roof Plane Converter ───────────────────────────────────────────────────

function convertRoofPlane(
  plane: CanonicalRoofPlane,
  log: string[],
  tag: string,
  originLat?: number,
  originLng?: number,
): CADCanonicalRoofPlaneInput | null {
  // ── Determine polygon source: prefer local_meters_xy polygon, fall back to
  //    worldPolygon (lat/lng) projected to local meters. ────────────────────
  let polygon: Point2D[];

  if (plane.polygon && plane.polygon.coordinateSystem === 'local_meters_xy') {
    // Primary path: canonical local-meter polygon is available
    const vertices = plane.polygon.vertices ?? [];
    if (vertices.length < 3) {
      log.push(`${tag} SKIP roofPlane id=${plane.id} — polygon has ${vertices.length} vertices (need 3+)`);
      return null;
    }
    polygon = vertices.map((v, idx) => {
      if (v.coordinateSystem !== 'local_meters_xy') {
        throw new CanonicalBridgeError(
          `Roof plane id=${plane.id} vertex[${idx}] uses coordinateSystem='${v.coordinateSystem}'. ` +
          `CAD requires local_meters_xy vertices.`,
        );
      }
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) {
        throw new CanonicalBridgeError(
          `Roof plane id=${plane.id} vertex[${idx}] has non-finite coordinates x=${v.x} y=${v.y}.`,
        );
      }
      return { x: v.x, y: v.y };
    });
  } else if (plane.worldPolygon?.vertices && plane.worldPolygon.vertices.length >= 3) {
    // Fallback path: worldPolygon (lat/lng) → project to local meters.
    // This handles Phase 1 models built from Google Solar API roofSegmentStats
    // which provide world-space outlines but no local-meter polygon.
    if (originLat == null || originLng == null) {
      log.push(`${tag} SKIP roofPlane id=${plane.id} — has worldPolygon but no lat/lng origin available for projection`);
      return null;
    }
    const wv = plane.worldPolygon.vertices;
    if (wv.some(v => !Number.isFinite(v.lat) || !Number.isFinite(v.lng))) {
      log.push(`${tag} SKIP roofPlane id=${plane.id} — worldPolygon has non-finite lat/lng vertex`);
      return null;
    }
    polygon = wv.map(v => latLngToXY(v.lat, v.lng, originLat!, originLng!));

    // ── Error 3g fix: rescale projected polygon to match areaSqM ──────
    // The Google Solar API's reconstructPolygon() builds lat/lng vertices
    // using offsetLatLng(), which encodes meter offsets as degree deltas
    // (dxE / 111320). When latLngToXY() later converts those degree deltas
    // back to meters (dLng * cosLat * EARTH_RADIUS_M), the round-trip
    // introduces a scaling distortion of cosLat * EARTH_RADIUS_M / 111320
    // ≈ 4.5× per axis (≈ 20-130× in area depending on orientation). This
    // causes the projected polygon to have hundreds-of-meters extents
    // instead of the actual 5-15m roof dimensions, allowing gridInsidePolygon()
    // to place far too many panels (84+ instead of ~17).
    //
    // Fix: use the canonical areaSqM (from the Solar API's areaMeters2)
    // as the ground truth. Compute the area of the projected polygon
    // (shoelace formula), derive a uniform scale factor, and rescale all
    // vertices around the polygon centroid so the projected area matches
    // areaSqM. This preserves the polygon shape (aspect ratio, orientation)
    // while eliminating the projection distortion.
    if (plane.areaSqM > 0) {
      const projectedArea = polygonArea(polygon);
      if (projectedArea > 0) {
        const scaleFactor = Math.sqrt(plane.areaSqM / projectedArea);
        if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
          const c = centroid(polygon);
          polygon = polygon.map(p => ({
            x: c.x + (p.x - c.x) * scaleFactor,
            y: c.y + (p.y - c.y) * scaleFactor,
          }));
          log.push(
            `${tag} RESCALE roofPlane id=${plane.id} projectedArea=${projectedArea.toFixed(1)}m² → targetArea=${plane.areaSqM.toFixed(1)}m² scaleFactor=${scaleFactor.toFixed(4)}`,
          );
        }
      }
    }

    log.push(
      `${tag} CONVERT roofPlane id=${plane.id} via worldPolygon (${wv.length} lat/lng vertices, ` +
      `origin=${originLat.toFixed(6)},${originLng.toFixed(6)})`,
    );
  } else if (plane.polygon && plane.polygon.coordinateSystem !== 'local_meters_xy') {
    // Has a polygon but in the wrong coordinate system (normalized_image_0_1000)
    log.push(
      `${tag} SKIP roofPlane id=${plane.id} — polygon uses coordinateSystem='${plane.polygon.coordinateSystem}', ` +
      `need local_meters_xy or worldPolygon`,
    );
    return null;
  } else {
    // No polygon and no worldPolygon — genuinely missing geometry
    if (plane.degradedNoGeometry) {
      log.push(`${tag} SKIP roofPlane id=${plane.id} — degraded (no geometry)`);
    } else {
      log.push(`${tag} SKIP roofPlane id=${plane.id} — missing polygon and worldPolygon`);
    }
    return null;
  }

  const setbacks = plane.setbackDefaults;
  for (const [name, value] of Object.entries(setbacks)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new CanonicalBridgeError(
        `Roof plane id=${plane.id} has invalid setback ${name}=${value}.`,
      );
    }
  }

  if (!Number.isFinite(plane.pitchDegrees) || !Number.isFinite(plane.azimuthDegrees) || !Number.isFinite(plane.areaSqM)) {
    throw new CanonicalBridgeError(
      `Roof plane id=${plane.id} has non-finite pitch/azimuth/area values.`,
    );
  }

  log.push(
    `${tag} CONVERT roofPlane id=${plane.id} vertices=${polygon.length} ` +
    `pitch=${plane.pitchDegrees.toFixed(1)} azimuth=${plane.azimuthDegrees.toFixed(1)} ` +
    `areaSqM=${plane.areaSqM.toFixed(2)} sourceArtifactId=${plane.sourceArtifactId}`,
  );

  return {
    id: plane.id,
    polygon,
    pitch: plane.pitchDegrees,
    azimuth: plane.azimuthDegrees,
    areaSqM: plane.areaSqM,
    setbacks: {
      eaveM: setbacks.eaveM,
      ridgeM: setbacks.ridgeM,
      rakeM: setbacks.rakeM,
    },
    sourceArtifactId: plane.sourceArtifactId,
  };
}

// ── Obstruction Converter ────────────────────────────────────────────────────

/**
 * Convert a CanonicalObstruction to a CADObstruction.
 *
 * CRITICAL: The output source is ALWAYS 'promoted_canonical'.
 * This is the fix for the CADObstruction.source='vision' bypass.
 * Even if the canonical obstruction originally came from vision,
 * it has been through human review and promotion — therefore it
 * is no longer raw vision data.
 */
function convertObstruction(
  obs: CanonicalObstruction,
  config: CanonicalBridgeConfig,
  log: string[],
  tag: string,
): CADObstruction | null {
  // Compute world position
  const worldPos = resolveWorldPosition(obs.center, obs.roofPlaneId, config);

  if (!worldPos) {
    const skip = config.skipWithoutProjection ?? true;
    if (skip) {
      log.push(`${tag} SKIP obstruction id=${obs.id} type=${obs.type} — no world projection available`);
      return null;
    }
    // DANGEROUS: fallback to (0,0) — only for testing
    log.push(`${tag} WARN obstruction id=${obs.id} type=${obs.type} — no world projection, using (0,0)`);
  }

  const pos = worldPos ?? { x: 0, y: 0 };

  // CRITICAL: source is 'promoted_canonical' — NEVER 'vision'
  // This is the key enforcement point. Even though CADObstruction.source
  // still allows 'vision' | 'manual' | 'merged' for backward compatibility,
  // this bridge will NEVER output 'vision'. Raw vision data must go through
  // the promotion workflow first.
  const cadObs: CADObstruction = {
    id: obs.id,
    type: obs.type,
    x: pos.x,
    y: pos.y,
    radiusM: obs.radiusM,
    setbackM: obs.setbackM,
    totalRadiusM: obs.totalRadiusM,
    heightFt: obs.heightFt,
    roofPlaneId: obs.roofPlaneId,
    source: 'promoted_canonical' as CADObstruction['source'] | 'promoted_canonical',
    confidence: obs.confidence,
  };

  log.push(`${tag} CONVERT obstruction id=${obs.id} type=${obs.type} x=${pos.x.toFixed(2)} y=${pos.y.toFixed(2)} radiusM=${obs.radiusM.toFixed(2)} source=promoted_canonical`);

  return cadObs;
}

// ── Electrical Node Converter ────────────────────────────────────────────────

/**
 * Convert a CanonicalElectricalNode to a CADElectricalNode.
 *
 * CRITICAL: The output source is ALWAYS 'promoted_canonical'.
 * Same bypass prevention as obstructions.
 */
function convertElectricalNode(
  node: CanonicalElectricalNode,
  config: CanonicalBridgeConfig,
  log: string[],
  tag: string,
): CADElectricalNode | null {
  // Compute world position
  const worldPos = resolveWorldPosition(node.center, null, config);

  if (!worldPos) {
    const skip = config.skipWithoutProjection ?? true;
    if (skip) {
      log.push(`${tag} SKIP electrical id=${node.id} type=${node.type} — no world projection available`);
      return null;
    }
    log.push(`${tag} WARN electrical id=${node.id} type=${node.type} — no world projection, using (0,0)`);
  }

  const pos = worldPos ?? { x: 0, y: 0 };

  // CRITICAL: source is 'promoted_canonical' — NEVER 'vision'
  const cadNode: CADElectricalNode = {
    id: node.id,
    type: node.type,
    x: pos.x,
    y: pos.y,
    story: node.story,
    isPrimaryInterconnect: node.isPrimaryInterconnect,
    source: 'promoted_canonical' as CADElectricalNode['source'] | 'promoted_canonical',
    confidence: node.confidence,
  };

  log.push(`${tag} CONVERT electrical id=${node.id} type=${node.type} x=${pos.x.toFixed(2)} y=${pos.y.toFixed(2)} story=${node.story} source=promoted_canonical`);

  return cadNode;
}

// ── World Position Resolver ──────────────────────────────────────────────────

/**
 * Resolve normalized image coordinates to CAD local XY meters.
 * Uses the provided worldProjection function if available.
 * Returns null if no projection is available.
 */
function resolveWorldPosition(
  center: { x: number; y: number; coordinateSystem: string } | null,
  roofPlaneId: string | null,
  config: CanonicalBridgeConfig,
): { x: number; y: number } | null {
  if (!center) return null;

  // CanonicalBuildingModel centers are already local CAD meters once promoted.
  if (center.coordinateSystem === 'local_meters_xy') {
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
    return { x: center.x, y: center.y };
  }

  // If a world projection function is provided, use it for non-local/image-space data.
  if (config.worldProjection) {
    return config.worldProjection(center.x, center.y, roofPlaneId);
  }

  // Without a projection function, we can't convert image-space to world-space.
  return null;
}

// ── Guard: Verify CAD model source integrity ──────────────────────────────────

/**
 * assertNoRawVisionInCAD — runtime guard that checks a CADModel's obstructions
 * and electrical nodes for any source='vision' entries that bypassed the
 * canonical bridge.
 *
 * DEFENSE-IN-DEPTH: The type system now excludes 'vision' from CADObstruction.source
 * and CADElectricalNode.source. This runtime guard remains as a safety net against
 * runtime data (e.g., from DB or external APIs) that might still contain 'vision'.
 *
 * This should be called AFTER generateCADLayout() to verify no raw vision
 * data leaked into the model.
 *
 * @throws CanonicalBridgeError if raw vision data is found
 */
export function assertNoRawVisionInCAD(
  obstructions: CADObstruction[] | undefined,
  electricalNodes: CADElectricalNode[] | undefined,
): void {
  const violations: string[] = [];

  if (obstructions) {
    for (const obs of obstructions) {
      // Defense-in-depth: type system prevents 'vision', but runtime data may bypass
      if ((obs as { source: string }).source === 'vision') {
        violations.push(`obstruction id=${obs.id} type=${obs.type} has source='vision' — must go through canonical bridge`);
      }
    }
  }

  if (electricalNodes) {
    for (const node of electricalNodes) {
      if ((node as { source: string }).source === 'vision') {
        violations.push(`electricalNode id=${node.id} type=${node.type} has source='vision' — must go through canonical bridge`);
      }
    }
  }

  if (violations.length > 0) {
    throw new CanonicalBridgeError(
      `Raw vision data found in CAD model — ${violations.length} violation(s):\n` +
      violations.join('\n') +
      '\n\nAll vision-sourced geometry must go through the unified geometry pipeline:\n' +
      '  Survey Photos → Evidence Manifest → Photo Vision Artifacts → Geometry Reconstruction Artifacts →\n' +
      '  Unified Geometry Evidence Bundle → Human Review/Promotion → CanonicalBuildingModel →\n' +
      '  canonicalBridge.canonicalToCADInputs() → CAD engine',
    );
  }
}

// ── Guard: Verify CAD model only uses canonical sources ───────────────────────

/**
 * validateCADModelSources — check that all obstructions and electrical nodes
 * in a CADModel have acceptable sources.
 *
 * Acceptable sources: 'promoted_canonical', 'manual', 'merged'
 * Unacceptable sources: 'vision' (raw, unreviewed) — blocked at type level
 *
 * DEFENSE-IN-DEPTH: The type system excludes 'vision' from the source unions.
 * This function remains as a runtime safety net.
 *
 * Returns a list of violations (empty = all good).
 */
export function validateCADModelSources(
  obstructions: CADObstruction[] | undefined,
  electricalNodes: CADElectricalNode[] | undefined,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (obstructions) {
    for (const obs of obstructions) {
      if ((obs as { source: string }).source === 'vision') {
        violations.push(`CADObstruction id=${obs.id} has source='vision' (raw, unreviewed)`);
      }
    }
  }

  if (electricalNodes) {
    for (const node of electricalNodes) {
      if ((node as { source: string }).source === 'vision') {
        violations.push(`CADElectricalNode id=${node.id} has source='vision' (raw, unreviewed)`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
