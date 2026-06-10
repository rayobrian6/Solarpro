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
//   1. Only CanonicalBuildingModel with cad_safe authority can feed CAD
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

import type { CanonicalBuildingModel, CanonicalObstruction, CanonicalElectricalNode } from '@/lib/siteSurveys/unifiedGeometry/types';
import { isCadConsumable, assertNoCadMutation, isSyntheticArtifact } from '@/lib/siteSurveys/unifiedGeometry/authority';
import type { CADObstruction, CADElectricalNode } from './types';

// ── Bridge Types ─────────────────────────────────────────────────────────────

/**
 * Result of converting a CanonicalBuildingModel to CAD-compatible inputs.
 *
 * These arrays can be directly assigned to CADModel.obstructions and
 * CADModel.electricalNodes — they are the ONLY legal source of vision-derived
 * geometry in the CAD engine.
 */
export interface CanonicalBridgeResult {
  /** CAD-ready obstructions from the canonical model */
  obstructions: CADObstruction[];
  /** CAD-ready electrical nodes from the canonical model */
  electricalNodes: CADElectricalNode[];
  /** Bridge audit log — every conversion step */
  log: string[];
  /** Number of obstructions that were converted */
  obstructionsConverted: number;
  /** Number of electrical nodes that were converted */
  electricalNodesConverted: number;
  /** Number of obstructions skipped (e.g., missing world projection) */
  obstructionsSkipped: number;
  /** Number of electrical nodes skipped */
  electricalNodesSkipped: number;
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

  // ── Authority gate ──────────────────────────────────────────────────────
  if (!isCadConsumable(model.authority)) {
    throw new CanonicalBridgeError(
      `CanonicalBuildingModel authority state='${model.authority.state}' is not CAD-consumable. ` +
      `Only '${'cad_safe' as const}' or '${'promoted_canonical' as const}' authority models may feed the CAD engine. ` +
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
    `${tag} DONE obstructions=${obstructionsConverted} (skipped=${obstructionsSkipped}) ` +
    `electricalNodes=${electricalNodesConverted} (skipped=${electricalNodesSkipped})`,
  );

  return {
    obstructions,
    electricalNodes,
    log,
    obstructionsConverted,
    electricalNodesConverted,
    obstructionsSkipped,
    electricalNodesSkipped,
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

  // If a world projection function is provided, use it
  if (config.worldProjection) {
    return config.worldProjection(center.x, center.y, roofPlaneId);
  }

  // Without a projection function, we can't convert image-space to world-space
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
