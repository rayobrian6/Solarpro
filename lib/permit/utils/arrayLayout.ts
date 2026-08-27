// ═══════════════════════════════════════════════════════════════
// Array Structural Layout — ONE source of truth for the panel
// orientation, row/column grid and panel dimensions that the
// structural engine uses to size attachments.
//
// Root cause it fixes: generatePermit built the V4 structural input
// with `panelOrientation: 'portrait'` HARDCODED and NO rowCount /
// colCount — so the engine fell back to autoLayout(panelCount), a
// near-square GUESS that has no relation to how the array is actually
// laid out on the roof. The same design's real layout already exists
// on `project.panelPositions` (PlacedPanel[]) — each placed module
// carries its real `orientation`, `row`, `col` and `arrayId` from the
// design engine. This selector reads that ONE source so the planset's
// attachment count derives from the real design, not a guess.
//
// Like conductorAuthority / integratedEquipment, this is a PURE,
// DETERMINISTIC read of existing design data — NOT a new layout
// engine. It runs no placement or physics; it only summarizes the
// already-placed modules into the (orientation, rowCount, colCount,
// panel dims) the structural engine consumes.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import { classifyPanel } from './subSystems';
import { resolvePanelSpecs } from './panelSpecs';
import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';
import type { HybridEquipmentCarrier } from './helpers';
import type { CADModel } from '@/lib/cad/types';

export type ArrayOrientation = 'portrait' | 'landscape';

export interface ArrayStructuralLayout {
  panelCount: number;
  rowCount: number;          // distinct roof-attached courses (rail runs / 2)
  colCount: number;          // panels per course (area-conserving: ceil(count/rows))
  orientation: ArrayOrientation;
  panelLengthIn: number;     // panel LONG dimension (in)
  panelWidthIn: number;      // panel SHORT dimension (in)
  panelWeightLbs: number;
  /**
   * Distinct sub-arrays (design arrayId, else roof planeId) — drives trunk-cable
   * bridge splices (a raw-cable M+F jumper per gap between sub-arrays).
   */
  subArrayCount: number;
  /** Human-readable provenance for the audit trail / warnings. */
  source: string;
  /** True when no panelPositions were available and we fell back to a guess. */
  isFallback: boolean;
}

const M_TO_IN = 39.3701;

function normalizeOrientation(raw: unknown): ArrayOrientation | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'portrait' || s === 'landscape') return s;
  return undefined; // 'hybrid'/'mixed'/'' → let the caller pick the majority
}

/**
 * Derive the structural array layout from the single design source
 * (project.panelPositions). Falls back to autoLayout-style dimensions
 * ONLY when no placed panels are present, and flags it via `isFallback`
 * + `source` so the contradiction is never silent.
 */
export function resolveArrayStructuralLayout(
  input: PermitInput,
  cad?: Pick<CADModel, 'panelWidthM' | 'panelHeightM' | 'totalPanels'> & HybridEquipmentCarrier,
  /** Hybrid (P2): scope the layout to ONE sub-system's panels. Unscoped, a
   *  hybrid's roof structural run would size rails/feet for fence+ground
   *  panels too. Uses the same classifyPanel as the partition. */
  subSystemKey?: 'roof' | 'ground' | 'fence',
): ArrayStructuralLayout {
  const project = input.project ?? ({} as PermitInput['project']);
  let positions = (project.panelPositions ?? []) as Array<{
    row?: number; col?: number; orientation?: string; arrayId?: string; planeId?: string;
    systemType?: string; placementType?: string;
  }>;
  if (subSystemKey) positions = positions.filter(p => classifyPanel(p) === subSystemKey);

  // ── P0-3 (data-authority register): sub-scoped runs resolve the SUB's OWN
  //    module dims + weight through the per-sub panel-spec authority
  //    (equipment-db via project.subSystems[key].panelId → the sub's fleet).
  //    project.panelWeightLbs / cad.panel*M are panel0 carriers — the FENCE
  //    module's on hybrids — and an understated roof dead load is the
  //    highest-liability class. Unscoped (single-system) calls keep the
  //    legacy chain byte-identical. ──
  const subSpecs = subSystemKey ? resolvePanelSpecs(input, cad ?? null, subSystemKey) : null;

  // ── Panel physical dimensions (single-sourced: per-sub authority when
  //    scoped, else CAD panel dims from the selected equipment, else the
  //    project fallback). Long ≥ short always. ──
  // BRAIDON PDF AUDIT 2026-08-27 (N1) — the per-sub authority above is only consulted when the
  // call is SUB-SCOPED. An ordinary single-system planset passes no subSystemKey, so subSpecs is
  // null and the chain fell straight through to the posted project scalars — and, failing those,
  // to the literals 66.9 × 40.9 in and 50 lb. That is why the dead load and the array footprint
  // could not be corrected by fixing the equipment-db record: nothing on the unscoped path ever
  // read the catalogue. The module MODEL is known on every path, so resolve it canonically and
  // use the record when it resolves. `resolveModuleIdentity` fails closed on a partial or
  // ambiguous model, so an unrecognised module still falls back exactly as before.
  // (the narrowed `cad` param here carries no systemDefinition, so the model comes off the
  // posted fleet — the same string the sheets already name as the selected module)
  const _catModel = input.system?.inverters
    ?.flatMap(inv => inv.strings ?? [])
    .find(st => st?.panelModel)?.panelModel ?? null;
  const _cat = subSpecs ? null : (resolveModuleIdentity({ model: _catModel }).spec ?? null);
  const rawW = (cad?.panelWidthM ?? 0) > 0 ? cad!.panelWidthM * M_TO_IN : (project.panelWidthIn || 0);
  const rawH = (cad?.panelHeightM ?? 0) > 0 ? cad!.panelHeightM * M_TO_IN : (project.panelLengthIn || 0);
  const dimA = (subSpecs?.widthIn ?? 0) > 0 ? subSpecs!.widthIn : (_cat?.width ?? (rawW > 0 ? rawW : 40.9));
  const dimB = (subSpecs?.lengthIn ?? 0) > 0 ? subSpecs!.lengthIn : (_cat?.length ?? (rawH > 0 ? rawH : 66.9));
  const panelLengthIn = Math.max(dimA, dimB);
  const panelWidthIn = Math.min(dimA, dimB);
  const _legacyWeight = project.panelWeightLbs || 50;
  const panelWeightLbs = (subSpecs?.weightLbs ?? 0) > 0 ? subSpecs!.weightLbs
    : (_cat?.weight ?? _legacyWeight);
  if (_cat && Math.abs((_cat.weight ?? 0) - _legacyWeight) > 0.05) {
    console.warn(`[arrayLayout] unscoped dead-load module weight from catalogue: `
      + `${_legacyWeight} lbs (posted scalar) → ${_cat.weight} lbs (${_cat.model})`);
  }
  if (subSpecs && subSpecs.weightLbs > 0 && Math.abs(subSpecs.weightLbs - _legacyWeight) > 0.05) {
    console.warn(`[arrayLayout] ${subSystemKey} dead-load module weight recomputed: `
      + `${_legacyWeight} lbs (project panel0 scalar) → ${subSpecs.weightLbs} lbs (${subSpecs.model})`);
  }

  const fallbackCount =
    input.system?.totalPanels || cad?.totalPanels || project.panelPositions?.length || 1;

  // ── No real layout → honest fallback (near-square autoLayout guess). ──
  if (positions.length === 0) {
    const panelCount = Math.max(1, fallbackCount);
    const { rowCount, colCount } = autoLayoutGrid(panelCount);
    return {
      panelCount, rowCount, colCount,
      orientation: 'portrait',
      panelLengthIn, panelWidthIn, panelWeightLbs,
      subArrayCount: 1,
      source: 'FALLBACK autoLayout (no panelPositions on design)',
      isFallback: true,
    };
  }

  const panelCount = positions.length;

  // ── Orientation = majority vote of the real placed modules. ──
  let portraitN = 0, landscapeN = 0;
  for (const p of positions) {
    const o = normalizeOrientation(p.orientation);
    if (o === 'portrait') portraitN++;
    else if (o === 'landscape') landscapeN++;
  }
  const orientation: ArrayOrientation =
    landscapeN > portraitN ? 'landscape' : 'portrait';

  // ── Row count = number of distinct courses across every sub-array.
  //    A course is a contiguous run of modules carried by one pair of
  //    rails; keying on (arrayId,row) counts each roof plane's rows so a
  //    multi-plane design contributes all its rail runs. This drives
  //    railCount = 2 × rowCount in the engine. ──
  const courseKeys = new Set<string>();
  // Distinct sub-arrays: prefer the design's arrayId, else the roof planeId —
  // each extra sub-array is a physical gap the trunk cable must BRIDGE (one
  // field-wireable M+F jumper), which is where splices actually occur.
  const subArrayKeys = new Set<string>();
  for (const p of positions) {
    const arr = p.arrayId ?? p.planeId ?? '0';
    const row = p.row ?? 0;
    courseKeys.add(`${arr}:${row}`);
    subArrayKeys.add(String(p.arrayId ?? p.planeId ?? '0'));
  }
  const rowCount = Math.max(1, courseKeys.size);
  const subArrayCount = Math.max(1, subArrayKeys.size);

  // ── colCount is chosen to conserve total array area:
  //    mountCount = (railLen/spacing + 1) × 2·rowCount, and railLen ∝ colCount,
  //    so rowCount × colCount must equal panelCount for the total rail length
  //    (hence the feet count) to match the real array. ──
  const colCount = Math.max(1, Math.ceil(panelCount / rowCount));

  return {
    panelCount, rowCount, colCount, orientation,
    panelLengthIn, panelWidthIn, panelWeightLbs,
    subArrayCount,
    source: `design panelPositions (${panelCount} modules, ${rowCount} courses, ${subArrayCount} sub-array(s), ${orientation})`,
    isFallback: false,
  };
}

/** Near-square fallback grid — matches the engine's own autoLayout intent. */
function autoLayoutGrid(panelCount: number): { rowCount: number; colCount: number } {
  if (panelCount <= 6) return { rowCount: 1, colCount: panelCount };
  if (panelCount <= 20) return { rowCount: 2, colCount: Math.ceil(panelCount / 2) };
  if (panelCount <= 30) return { rowCount: 3, colCount: Math.ceil(panelCount / 3) };
  return { rowCount: 4, colCount: Math.ceil(panelCount / 4) };
}
