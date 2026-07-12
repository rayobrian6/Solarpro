/**
 * lib/bom/deriveRunLengths.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Derives wire run lengths (in feet) from CAD geometry, replacing the
 * hardcoded defaults in computed-system.ts when real geometry is available.
 *
 * Strategy per segment:
 *
 *  DC_STRING_RUN          — roof: half-diagonal of the largest roof plane (DC
 *                           wire from array midpoint down to eave junction box)
 *                           ground: half of array depth + typical conduit drop
 *  DC_DISCO_TO_INV_RUN    — short fixed run (10 ft) — not geometry-derived
 *  ROOF_RUN               — roof: plane width × 0.6 (trunk cable along eave)
 *                           (covers microinverter trunk + short DC homerun)
 *  BRANCH_RUN             — microinverter: sum of branch trunk segments
 *                           approximated as plane width × branch count factor
 *  ARRAY_OPEN_AIR         — ground/fence: array width (open-air homerun)
 *  ARRAY_CONDUIT_RUN      — conduitRoutes totalLengthM (vision) or array
 *                           bounding-box diagonal as fallback
 *  INV_TO_DISCO_RUN       — electricalNode distance if vision available;
 *                           else 20 ft default
 *  COMBINER_TO_DISCO_RUN  — same as INV_TO_DISCO_RUN path
 *  DISCO_TO_METER_RUN     — conduitRoutes totalLengthM (vision) or distance
 *                           between array centroid and MSP node; else 15 ft
 *  METER_TO_MSP_RUN       — fixed 10 ft (meter → MSP is always very short)
 *  MSP_TO_UTILITY_RUN     — fixed 5 ft
 *  BATTERY_TO_BUI_RUN     — not geometry-derived (5–10 ft typical)
 *  BUI_TO_MSP_RUN         — not geometry-derived (15 ft typical)
 *  GENERATOR_TO_ATS_RUN   — not geometry-derived (50 ft typical)
 *  ATS_TO_MSP_RUN         — not geometry-derived (20 ft typical)
 *
 * All values are in FEET. CAD geometry is in METERS → convert with M_TO_FT.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CADModel, CADRoofPlane, CADConduitRoute, CADElectricalNode } from '@/lib/cad/types';
import type { RunSegmentId } from '@/lib/computed-system';

// ── Constants ──────────────────────────────────────────────────────────────

const M_TO_FT = 3.28084;

/** NEC 15% slack/waste factor applied to all derived run lengths. */
const SLACK_FACTOR = 1.15;

// ── Geometry helpers ───────────────────────────────────────────────────────

function mToFt(meters: number): number {
  return meters * M_TO_FT;
}

/** Euclidean distance between two XY points (local meters → feet). */
function distFt(ax: number, ay: number, bx: number, by: number): number {
  return mToFt(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2));
}

/** Diagonal of a rectangle (meters → feet). */
function diagonalFt(widthM: number, heightM: number): number {
  return mToFt(Math.sqrt(widthM ** 2 + heightM ** 2));
}

/** Centroid of a CAD roof plane polygon. */
function planeCentroid(plane: CADRoofPlane): { x: number; y: number } {
  const pts = plane.polygon;
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Largest roof plane by area. */
function largestPlane(planes: CADRoofPlane[]): CADRoofPlane | null {
  if (!planes || planes.length === 0) return null;
  return planes.reduce((a, b) => (b.areaSqM > a.areaSqM ? b : a));
}

/** Sum of all conduit route lengths (meters). Returns 0 if no routes. */
function totalConduitLengthFt(routes: CADConduitRoute[] | undefined): number {
  if (!routes || routes.length === 0) return 0;
  const totalM = routes.reduce((s, r) => s + (r.totalLengthM ?? 0), 0);
  return mToFt(totalM);
}

/** Find the primary MSP / interconnect node from electricalNodes. */
function findMspNode(nodes: CADElectricalNode[] | undefined): CADElectricalNode | null {
  if (!nodes || nodes.length === 0) return null;
  // Prefer isPrimaryInterconnect, then type containing 'msp' or 'panel' or 'meter'
  const primary = nodes.find(n => n.isPrimaryInterconnect);
  if (primary) return primary;
  const byType = nodes.find(n =>
    /msp|main.?panel|meter|interconnect/i.test(n.type),
  );
  return byType ?? null;
}

/** Centroid of the entire CAD model bounding box. */
function modelCentroid(cad: CADModel): { x: number; y: number } {
  const b = cad.bounds;
  if (!b) return { x: 0, y: 0 };
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  };
}

// ── Main export ────────────────────────────────────────────────────────────

export interface DerivedRunLengths {
  /** The derived run lengths in feet, ready for ComputedSystemInput.runLengths */
  runLengths: Partial<Record<RunSegmentId, number>>;
  /** Human-readable derivation notes for each segment (for debugging/logging) */
  derivationNotes: Partial<Record<RunSegmentId, string>>;
}

/**
 * Wave 2a (contract §3, 2a Compute): options for per-subsystem derivation.
 * A hybrid CADModel carries roof + ground + fence geometry simultaneously —
 * the whole-project `cad.systemType` can no longer pick the branch. Callers
 * computing ONE subsystem pass its systemType explicitly; legacy callers
 * (no opts) keep the exact pre-Wave-2a behavior.
 */
export interface DeriveRunLengthsOpts {
  /**
   * Explicit subsystem scope — beats cad.systemType. Accepts both canonical
   * CAD spellings ('roof' | 'ground_mount' | 'solar_fence') and engineering
   * spellings ('ground' | 'fence'). Unknown/absent values scope to roof
   * (the end-to-end default placement type).
   */
  systemType?: string | null;
}

/**
 * Derive wire run lengths from CAD geometry.
 *
 * Returns a `Partial<Record<RunSegmentId, number>>` that can be spread directly
 * into `ComputedSystemInput.runLengths`. Segments where geometry is insufficient
 * are omitted — the caller's existing defaults will apply.
 *
 * All returned values include the 15% NEC slack factor.
 */
export function deriveRunLengths(cad: CADModel, opts?: DeriveRunLengthsOpts): DerivedRunLengths {
  const result: Partial<Record<RunSegmentId, number>> = {};
  const notes: Partial<Record<RunSegmentId, string>> = {};

  // Wave 2a: explicit per-subsystem scope beats the whole-project systemType.
  // Legacy path (no opts.systemType) is byte-identical to pre-Wave-2a.
  const explicit = opts?.systemType != null && opts.systemType !== '';
  const st = String((explicit ? opts!.systemType : cad.systemType) ?? '').toLowerCase();
  const isGround = st === 'ground_mount' || st === 'ground';
  const isFence  = st === 'solar_fence'  || st === 'fence';
  const isRoof   = explicit
    ? (!isGround && !isFence)                          // explicit scope: roof is the default bucket
    : (cad.systemType === 'roof' || !cad.systemType);  // legacy semantics preserved exactly

  const conduitFt   = totalConduitLengthFt(cad.conduitRoutes);
  const mspNode     = findMspNode(cad.electricalNodes);
  const arrayCentroid = modelCentroid(cad);

  // ── ROOF system ──────────────────────────────────────────────────────────
  if (isRoof && cad.roof) {
    const planes = cad.roof.planes ?? [];
    const main   = largestPlane(planes);

    if (main) {
      const { widthM, heightM } = main.dimensions;

      // DC_STRING_RUN: half-diagonal of the main plane (DC wire from panel
      // at far corner down to eave junction, + 15% slack)
      const halfDiagFt = diagonalFt(widthM, heightM) / 2;
      result.DC_STRING_RUN = round(halfDiagFt * SLACK_FACTOR);
      notes.DC_STRING_RUN  = `roof plane half-diagonal ${halfDiagFt.toFixed(1)} ft × ${SLACK_FACTOR} slack`;

      // ROOF_RUN: trunk cable along the eave (≈ plane width × 0.6)
      // 0.6 factor: cable runs to midpoint of each row, not full width
      const trunkFt = mToFt(widthM) * 0.6;
      result.ROOF_RUN = round(trunkFt * SLACK_FACTOR);
      notes.ROOF_RUN  = `roof plane width ${mToFt(widthM).toFixed(1)} ft × 0.6 eave factor × ${SLACK_FACTOR} slack`;

      // BRANCH_RUN: sum of plane widths (microinverter trunk along all planes)
      const totalWidthFt = planes.reduce((s, p) => s + mToFt(p.dimensions.widthM), 0);
      result.BRANCH_RUN = round(totalWidthFt * SLACK_FACTOR);
      notes.BRANCH_RUN  = `sum of all plane widths ${totalWidthFt.toFixed(1)} ft × ${SLACK_FACTOR} slack`;

      // ARRAY_CONDUIT_RUN: vision conduit routes if available, else plane height
      // (conduit from roof eave drop to inverter/disconnect)
      if (conduitFt > 0) {
        result.ARRAY_CONDUIT_RUN = round(conduitFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `vision conduit route ${conduitFt.toFixed(1)} ft × ${SLACK_FACTOR} slack`;
      } else {
        // Estimate: conduit runs down the wall (plane height as proxy for roof run-to-eave)
        const wallDropFt = mToFt(heightM) * 0.5 + 10; // half-height + 10 ft wall drop
        result.ARRAY_CONDUIT_RUN = round(wallDropFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `estimated wall drop ${wallDropFt.toFixed(1)} ft × ${SLACK_FACTOR} slack`;
      }

      // ARRAY_OPEN_AIR: open-air homerun on roof (short - panel row to j-box)
      result.ARRAY_OPEN_AIR = round(mToFt(widthM / planes.length) * 0.5 * SLACK_FACTOR);
      notes.ARRAY_OPEN_AIR  = `per-plane width ${mToFt(widthM / planes.length).toFixed(1)} ft × 0.5 × slack`;
    }

    // INV_TO_DISCO_RUN / COMBINER_TO_DISCO_RUN: inverter to AC disconnect
    // Use MSP node distance from array centroid if vision available
    if (mspNode) {
      const dFt = distFt(arrayCentroid.x, arrayCentroid.y, mspNode.x, mspNode.y);
      // Inverter is typically near the array drop; disconnect is partway to MSP
      const invToDiscoFt = Math.min(dFt * 0.35, 30); // at most 30 ft
      result.INV_TO_DISCO_RUN       = round(invToDiscoFt * SLACK_FACTOR);
      result.COMBINER_TO_DISCO_RUN  = round(invToDiscoFt * SLACK_FACTOR);
      notes.INV_TO_DISCO_RUN        = `35% of array→MSP dist ${dFt.toFixed(1)} ft = ${invToDiscoFt.toFixed(1)} ft × slack`;
      notes.COMBINER_TO_DISCO_RUN   = notes.INV_TO_DISCO_RUN;
    }

    // DISCO_TO_METER_RUN: AC disconnect to MSP
    if (conduitFt > 0) {
      // Vision conduit covers the full array-drop → MSP path; subtract the
      // roof portion (ARRAY_CONDUIT_RUN already set above)
      const acRunFt = Math.max(conduitFt - (result.ARRAY_CONDUIT_RUN ?? 20), 10);
      result.DISCO_TO_METER_RUN = round(acRunFt * SLACK_FACTOR);
      notes.DISCO_TO_METER_RUN  = `vision conduit ${conduitFt.toFixed(1)} ft minus roof portion = ${acRunFt.toFixed(1)} ft × slack`;
    } else if (mspNode) {
      const dFt = distFt(arrayCentroid.x, arrayCentroid.y, mspNode.x, mspNode.y);
      const discoToMeterFt = Math.max(dFt * 0.65, 10); // remaining 65% of path
      result.DISCO_TO_METER_RUN = round(discoToMeterFt * SLACK_FACTOR);
      notes.DISCO_TO_METER_RUN  = `65% of array→MSP dist ${dFt.toFixed(1)} ft = ${discoToMeterFt.toFixed(1)} ft × slack`;
    }
  }

  // ── GROUND system ────────────────────────────────────────────────────────
  if (isGround && cad.ground) {
    const arrays = cad.ground.arrays ?? [];
    if (arrays.length > 0) {
      // Use the first (or largest) array for DC run derivation
      const arr = arrays.reduce((a, b) =>
        (b.dimensions.arrayWidthM * b.dimensions.arrayDepthM) >
        (a.dimensions.arrayWidthM * a.dimensions.arrayDepthM) ? b : a,
      );

      const { arrayWidthM, arrayDepthM } = arr.dimensions;

      // DC_STRING_RUN: half the array diagonal (DC wire from far panel to combiner)
      const halfDiagFt = diagonalFt(arrayWidthM, arrayDepthM) / 2;
      result.DC_STRING_RUN = round(halfDiagFt * SLACK_FACTOR);
      notes.DC_STRING_RUN  = `ground array half-diagonal ${halfDiagFt.toFixed(1)} ft × slack`;

      // ARRAY_OPEN_AIR: open-air homerun from array edge to combiner/inverter
      const openAirFt = mToFt(arrayDepthM) * 0.5 + 5;
      result.ARRAY_OPEN_AIR = round(openAirFt * SLACK_FACTOR);
      notes.ARRAY_OPEN_AIR  = `ground array depth/2 ${(mToFt(arrayDepthM) * 0.5).toFixed(1)} ft + 5 ft drop × slack`;

      // ARRAY_CONDUIT_RUN: vision conduit or bounding box diagonal to MSP
      if (conduitFt > 0) {
        result.ARRAY_CONDUIT_RUN = round(conduitFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `vision conduit ${conduitFt.toFixed(1)} ft × slack`;
      } else if (mspNode) {
        const dFt = distFt(arr.originX, arr.originY, mspNode.x, mspNode.y);
        result.ARRAY_CONDUIT_RUN = round(dFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `ground array origin→MSP node ${dFt.toFixed(1)} ft × slack`;
      } else {
        // Fallback: array diagonal as proxy for conduit run
        const fullDiagFt = diagonalFt(arrayWidthM, arrayDepthM);
        result.ARRAY_CONDUIT_RUN = round(fullDiagFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `ground array full diagonal ${fullDiagFt.toFixed(1)} ft × slack`;
      }

      // DISCO_TO_METER_RUN: conduit from inverter/disconnect to MSP
      if (mspNode) {
        const dFt = distFt(arr.originX, arr.originY, mspNode.x, mspNode.y);
        result.DISCO_TO_METER_RUN = round(dFt * SLACK_FACTOR);
        notes.DISCO_TO_METER_RUN  = `ground array origin→MSP node ${dFt.toFixed(1)} ft × slack`;
      } else if (conduitFt > 0) {
        result.DISCO_TO_METER_RUN = round(conduitFt * 0.6 * SLACK_FACTOR);
        notes.DISCO_TO_METER_RUN  = `60% of conduit route ${conduitFt.toFixed(1)} ft × slack`;
      }
    }
  }

  // ── FENCE system ─────────────────────────────────────────────────────────
  if (isFence && cad.fence) {
    const totalLenFt = mToFt(cad.fence.totalLengthM ?? 0);
    if (totalLenFt > 0) {
      // DC_STRING_RUN: half the fence total length (DC wire from far panel)
      result.DC_STRING_RUN = round((totalLenFt / 2) * SLACK_FACTOR);
      notes.DC_STRING_RUN  = `fence total length / 2 = ${(totalLenFt / 2).toFixed(1)} ft × slack`;

      // ARRAY_OPEN_AIR: open-air run from panel to combiner (short)
      result.ARRAY_OPEN_AIR = round(Math.min(totalLenFt * 0.1, 15) * SLACK_FACTOR);
      notes.ARRAY_OPEN_AIR  = `10% fence length = ${(totalLenFt * 0.1).toFixed(1)} ft × slack (capped 15 ft)`;

      // ARRAY_CONDUIT_RUN: conduit from fence combiner to inverter
      if (conduitFt > 0) {
        result.ARRAY_CONDUIT_RUN = round(conduitFt * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `vision conduit ${conduitFt.toFixed(1)} ft × slack`;
      } else {
        result.ARRAY_CONDUIT_RUN = round(Math.min(totalLenFt * 0.25, 40) * SLACK_FACTOR);
        notes.ARRAY_CONDUIT_RUN  = `25% fence length = ${(totalLenFt * 0.25).toFixed(1)} ft × slack (capped 40 ft)`;
      }

      // DISCO_TO_METER_RUN
      if (mspNode) {
        // Use first fence segment start as array reference
        const seg0 = cad.fence.segments?.[0];
        if (seg0) {
          const dFt = distFt(seg0.startX, seg0.startY, mspNode.x, mspNode.y);
          result.DISCO_TO_METER_RUN = round(dFt * SLACK_FACTOR);
          notes.DISCO_TO_METER_RUN  = `fence start→MSP node ${dFt.toFixed(1)} ft × slack`;
        }
      }
    }
  }

  return { runLengths: result, derivationNotes: notes };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Round to nearest foot (minimum 5 ft). */
function round(ft: number): number {
  return Math.max(5, Math.round(ft));
}