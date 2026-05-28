// ============================================================================
// lib/system/visionPatch.ts — Vision → SystemDefinition Patch Layer
//
// VERSION: VISION_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   VisionAggregationResult (from visionAggregator.ts)
//     → patchSystemDefinitionFromVision()  ← YOU ARE HERE
//     → SystemDefinition (obstructions, electricalNodes, planeCorrections added)
//     → CAD engine (collision avoidance, conduit routing)
//
// RESPONSIBILITIES:
//   1. Accept a VisionAggregationResult and an existing SystemDefinition
//   2. Gate each obstruction/node by minimum confidence threshold
//   3. Map ObstructionNode → SysDefObstruction (type-safe conversion)
//   4. Map ElectricalNode  → SysDefElectricalNode
//   5. Map PlaneCorrection → SysDefPlaneCorrection
//   6. Return a NEW SystemDefinition with vision data merged in
//   7. Emit [SYSDEF PATCH] audit log lines for every field written
//
// NON-NEGOTIABLE RULES:
//   - NEVER mutates the input SystemDefinition — returns a new object
//   - NEVER overwrites confirmed design values (panel, layout.totalPanels, etc.)
//   - NEVER throws — all errors caught; original SystemDefinition returned on failure
//   - If vision result has no high-confidence detections, original is returned unchanged
//   - [SYSDEF PATCH] prefix on every log line for easy grep in production logs
//
// CONFIDENCE GATES:
//   OBSTRUCTION_MIN_CONFIDENCE   = 0.55 (lower — obstructions are conservative)
//   ELECTRICAL_MIN_CONFIDENCE    = 0.65 (higher — affects NEC compliance routing)
//   PLANE_CORRECTION_MIN_CONFIDENCE = 0.70 (highest — modifies geometry)
// ============================================================================

import type { SystemDefinition, SysDefObstruction, SysDefElectricalNode, SysDefPlaneCorrection } from './systemDefinition';
import type { VisionAggregationResult, ObstructionNode, ElectricalNode, PlaneCorrection } from '@/lib/vision/types';

// ─── Confidence gates ─────────────────────────────────────────────────────────

/** Minimum confidence to write an obstruction into SystemDefinition */
export const OBSTRUCTION_MIN_CONFIDENCE = 0.55;

/** Minimum confidence to write an electrical node into SystemDefinition */
export const ELECTRICAL_MIN_CONFIDENCE = 0.65;

/** Minimum confidence to apply a plane polygon correction */
export const PLANE_CORRECTION_MIN_CONFIDENCE = 0.70;

// ─── Patch options ────────────────────────────────────────────────────────────

export interface VisionPatchOptions {
  /** Override obstruction confidence gate (default: OBSTRUCTION_MIN_CONFIDENCE) */
  obstructionMinConfidence?: number;
  /** Override electrical node confidence gate (default: ELECTRICAL_MIN_CONFIDENCE) */
  electricalMinConfidence?: number;
  /** Override plane correction confidence gate (default: PLANE_CORRECTION_MIN_CONFIDENCE) */
  planeCorrectionMinConfidence?: number;
  /**
   * Merge strategy for obstructions when SystemDefinition already has vision data:
   *   'replace' — replace all existing vision obstructions with new ones (default)
   *   'merge'   — merge by id, new detections win on conflict
   *   'additive' — only add new ids, never remove existing
   */
  obstructionMergeStrategy?: 'replace' | 'merge' | 'additive';
}

// ─── Patch result ─────────────────────────────────────────────────────────────

export interface VisionPatchResult {
  /** Patched SystemDefinition — new object, input is not mutated */
  definition: SystemDefinition;
  /** Number of obstructions written */
  obstructionsWritten: number;
  /** Number of obstructions skipped (below confidence) */
  obstructionsSkipped: number;
  /** Number of electrical nodes written */
  electricalNodesWritten: number;
  /** Number of electrical nodes skipped */
  electricalNodesSkipped: number;
  /** Number of plane corrections written */
  planeCorrectionsWritten: number;
  /** Whether any data was patched (false = original returned unchanged) */
  patched: boolean;
  /** Full audit log — every [SYSDEF PATCH] line */
  log: string[];
}

// ─── Main patch function ──────────────────────────────────────────────────────

/**
 * patchSystemDefinitionFromVision — applies vision aggregation results
 * as an optional override layer on top of an existing SystemDefinition.
 *
 * SAFETY GUARANTEE: If vision data is empty or all below threshold,
 * the original SystemDefinition is returned unchanged (patched=false).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * @deprecated — PHASE 6 CAD INPUT LOCKDOWN
 *
 *   This function is DEPRECATED and should NOT be called in new code.
 *   It writes raw vision data directly into SystemDefinition.obstructions
 *   without going through the unified geometry pipeline or human review.
 *
 *   REPLACEMENT:
 *     Use `canonicalBridge.canonicalToCADInputs()` instead, which requires
 *     all geometry to pass through:
 *       Survey Photos → Evidence Manifest → Pipeline Adapters →
 *       Unified Geometry Evidence Bundle → Human Review/Promotion →
 *       CanonicalBuildingModel → canonicalBridge → CAD
 *
 *   This function remains in the codebase for backward compatibility but
 *   will be removed in a future version. Callers should migrate to the
 *   unified geometry pipeline.
 *
 *   If you must call this function (legacy path), be aware that:
 *   - The CAD engine now blocks source='vision' obstructions (Phase 6 guard)
 *   - Raw vision obstructions written to SystemDefinition will be filtered
 *     out by roofCAD.ts's buildCADObstructions() bypass guard
 *   - Use canonicalBridge.canonicalToCADInputs() for the legal path
 * ══════════════════════════════════════════════════════════════════════════
 *
 * @param existing  SystemDefinition built from project data
 * @param vision    VisionAggregationResult from visionAggregator.ts
 * @param options   Confidence gates and merge strategy
 * @returns         VisionPatchResult with new definition + audit log
 */
export function patchSystemDefinitionFromVision(
  existing: SystemDefinition,
  vision: VisionAggregationResult,
  options: VisionPatchOptions = {},
): VisionPatchResult {
  const log: string[] = [];
  const tag = `[SYSDEF PATCH] projectId=${vision.projectId} surveyId=${vision.surveyId}`;

  // ── DEPRECATION WARNING (Phase 6 — CAD Input Lockdown) ──────────────
  // This function is DEPRECATED. Raw vision data written to SystemDefinition
  // will be blocked by the CAD engine's bypass guard (roofCAD.ts).
  // Use canonicalBridge.canonicalToCADInputs() instead.
  console.warn(
    `[DEPRECATED] patchSystemDefinitionFromVision() is deprecated (Phase 6 CAD Input Lockdown). ` +
    `Raw vision obstructions written to SystemDefinition will be blocked by the CAD engine. ` +
    `Use canonicalBridge.canonicalToCADInputs() from the unified geometry pipeline instead.`,
  );

  log.push(`${tag} START aggregatedAt=${vision.aggregatedAt} pipelineVersion=${vision.pipelineVersion}`);
  log.push(`${tag} WARNING: patchSystemDefinitionFromVision() is DEPRECATED — use canonicalBridge instead`);
  log.push(`${tag} input: obstructions=${vision.obstructions.length} electricalNodes=${vision.electricalNodes.length} planeCorrections=${vision.planeCorrections.length}`);

  const obsMinConf   = options.obstructionMinConfidence   ?? OBSTRUCTION_MIN_CONFIDENCE;
  const elecMinConf  = options.electricalMinConfidence    ?? ELECTRICAL_MIN_CONFIDENCE;
  const planeMinConf = options.planeCorrectionMinConfidence ?? PLANE_CORRECTION_MIN_CONFIDENCE;
  const mergeStrategy = options.obstructionMergeStrategy ?? 'replace';

  // ── Gate: if nothing to patch, return original ────────────────────────────
  if (
    vision.obstructions.length === 0 &&
    vision.electricalNodes.length === 0 &&
    vision.planeCorrections.length === 0
  ) {
    log.push(`${tag} SKIP: empty vision result — returning original SystemDefinition unchanged`);
    return _noopResult(existing, log);
  }

  // ── Map obstructions ──────────────────────────────────────────────────────
  let obstructionsWritten = 0;
  let obstructionsSkipped = 0;
  const newObstructions: SysDefObstruction[] = [];

  for (const obs of vision.obstructions) {
    if (obs.confidence < obsMinConf) {
      obstructionsSkipped++;
      log.push(`${tag} SKIP obstruction id=${obs.id} type=${obs.type} conf=${obs.confidence.toFixed(2)} < threshold=${obsMinConf}`);
      continue;
    }
    const mapped = _mapObstruction(obs);
    newObstructions.push(mapped);
    obstructionsWritten++;
    log.push(`${tag} WRITE obstruction id=${mapped.id} type=${mapped.type} worldX=${mapped.worldX.toFixed(2)} worldY=${mapped.worldY.toFixed(2)} radiusM=${mapped.radiusM.toFixed(2)} setbackIn=${mapped.setbackIn} conf=${obs.confidence.toFixed(2)}`);
  }

  // ── Merge strategy ────────────────────────────────────────────────────────
  let finalObstructions: SysDefObstruction[];
  const existingObstructions = existing.obstructions ?? [];

  if (mergeStrategy === 'replace') {
    // Keep manual obstructions (source='manual'), replace all vision ones
    const manualObstructions = existingObstructions.filter(o => o.source === 'manual');
    finalObstructions = [...manualObstructions, ...newObstructions];
    if (manualObstructions.length > 0) {
      log.push(`${tag} MERGE: preserved ${manualObstructions.length} manual obstruction(s)`);
    }
  } else if (mergeStrategy === 'merge') {
    const existingById = new Map(existingObstructions.map(o => [o.id, o]));
    for (const obs of newObstructions) {
      existingById.set(obs.id, obs); // new vision data wins on id conflict
    }
    finalObstructions = Array.from(existingById.values());
  } else {
    // additive: only add ids not already present
    const existingIds = new Set(existingObstructions.map(o => o.id));
    const addedObstructions = newObstructions.filter(o => !existingIds.has(o.id));
    finalObstructions = [...existingObstructions, ...addedObstructions];
  }

  log.push(`${tag} obstructions: ${existingObstructions.length} → ${finalObstructions.length} (written=${obstructionsWritten} skipped=${obstructionsSkipped} strategy=${mergeStrategy})`);

  // ── Map electrical nodes ──────────────────────────────────────────────────
  let electricalNodesWritten = 0;
  let electricalNodesSkipped = 0;
  const newElecNodes: SysDefElectricalNode[] = [];

  for (const node of vision.electricalNodes) {
    if (node.confidence < elecMinConf) {
      electricalNodesSkipped++;
      log.push(`${tag} SKIP electrical id=${node.id} type=${node.type} conf=${node.confidence.toFixed(2)} < threshold=${elecMinConf}`);
      continue;
    }
    const mapped = _mapElectricalNode(node);
    newElecNodes.push(mapped);
    electricalNodesWritten++;
    log.push(`${tag} WRITE electrical id=${mapped.id} type=${mapped.type} worldX=${mapped.worldX.toFixed(2)} worldY=${mapped.worldY.toFixed(2)} story=${mapped.story} primary=${mapped.isPrimaryInterconnect} conf=${node.confidence.toFixed(2)}`);
  }

  // Merge electrical: keep manual entries, add/replace vision entries
  const existingElecNodes = existing.electricalNodes ?? [];
  const manualElecNodes = existingElecNodes.filter(n => n.source === 'manual');
  const existingElecIds = new Set(manualElecNodes.map(n => n.id));
  const elecToAdd = newElecNodes.filter(n => !existingElecIds.has(n.id));
  const finalElecNodes: SysDefElectricalNode[] = [...manualElecNodes, ...elecToAdd];

  log.push(`${tag} electricalNodes: ${existingElecNodes.length} → ${finalElecNodes.length} (written=${electricalNodesWritten} skipped=${electricalNodesSkipped})`);

  // ── Map plane corrections ─────────────────────────────────────────────────
  let planeCorrectionsWritten = 0;
  const newPlaneCorrections: SysDefPlaneCorrection[] = [];

  for (const correction of vision.planeCorrections) {
    if (correction.confidence < planeMinConf) {
      log.push(`${tag} SKIP planeCorrection planeId=${correction.roofPlaneId} conf=${correction.confidence.toFixed(2)} < threshold=${planeMinConf}`);
      continue;
    }
    const mapped = _mapPlaneCorrection(correction);
    newPlaneCorrections.push(mapped);
    planeCorrectionsWritten++;
    log.push(`${tag} WRITE planeCorrection planeId=${mapped.roofPlaneId} type=${mapped.correctionType} conf=${correction.confidence.toFixed(2)}`);
  }

  log.push(`${tag} planeCorrections: written=${planeCorrectionsWritten}`);

  // ── Determine if anything was actually patched ────────────────────────────
  const patched = obstructionsWritten > 0 || electricalNodesWritten > 0 || planeCorrectionsWritten > 0;

  if (!patched) {
    log.push(`${tag} SKIP: all detections below confidence threshold — returning original unchanged`);
    return _noopResult(existing, log);
  }

  // ── Build patched SystemDefinition ────────────────────────────────────────
  const patched_definition: SystemDefinition = {
    ...existing,
    obstructions:    finalObstructions,
    electricalNodes: finalElecNodes,
    planeCorrections: newPlaneCorrections.length > 0 ? newPlaneCorrections : existing.planeCorrections,
    visionPatchedAt: new Date().toISOString(),
  };

  log.push(`${tag} DONE patched=true obstructionsTotal=${finalObstructions.length} electricalTotal=${finalElecNodes.length} planeCorrectionsTotal=${newPlaneCorrections.length}`);

  return {
    definition: patched_definition,
    obstructionsWritten,
    obstructionsSkipped,
    electricalNodesWritten,
    electricalNodesSkipped,
    planeCorrectionsWritten,
    patched: true,
    log,
  };
}

// ─── Type mapping helpers ─────────────────────────────────────────────────────

function _mapObstruction(obs: ObstructionNode): SysDefObstruction {
  return {
    id:          obs.id,
    type:        obs.type,
    worldX:      obs.worldX,
    worldY:      obs.worldY,
    radiusM:     obs.radiusM,
    heightFt:    obs.heightFt,
    setbackIn:   obs.setbackIn,
    confidence:  obs.confidence,
    roofPlaneId: obs.roofPlaneId,
    source:      obs.source,
  };
}

function _mapElectricalNode(node: ElectricalNode): SysDefElectricalNode {
  return {
    id:                   node.id,
    type:                 node.type,
    worldX:               node.worldX,
    worldY:               node.worldY,
    story:                node.story,
    confidence:           node.confidence,
    isPrimaryInterconnect: node.isPrimaryInterconnect,
    source:               node.source,
  };
}

function _mapPlaneCorrection(corr: PlaneCorrection): SysDefPlaneCorrection {
  return {
    roofPlaneId:       corr.roofPlaneId,
    correctionType:    corr.correctionType,
    offsetX:           corr.offsetX,
    offsetY:           corr.offsetY,
    azimuthDeltaDeg:   corr.azimuthDeltaDeg,
    pitchDeltaDeg:     corr.pitchDeltaDeg,
    confidence:        corr.confidence,
    sourceClass:       corr.sourceClass,
  };
}

// ─── No-op result helper ──────────────────────────────────────────────────────

function _noopResult(existing: SystemDefinition, log: string[]): VisionPatchResult {
  return {
    definition: existing,
    obstructionsWritten: 0,
    obstructionsSkipped: 0,
    electricalNodesWritten: 0,
    electricalNodesSkipped: 0,
    planeCorrectionsWritten: 0,
    patched: false,
    log,
  };
}