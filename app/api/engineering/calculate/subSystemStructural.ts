// ═══════════════════════════════════════════════════════════════
// Hybrid multi-system support — per-sub-system structural runs for
// /api/engineering/calculate.
//
// Problem: the engineering page POSTs ONE structural input for the whole
// project (panelCount = every panel, installationType from config.systemType),
// so a hybrid fence+ground+roof project was analyzed as a single 94-module
// fence — roof and ground subsets got NO structural analysis.
//
// Fix (mirrors the permit path — lib/permit/utils/structuralInput.ts
// buildSubSystemStructuralInputs + the generatePermit loop keyed on
// compliance.structural.subSystems): when the client sends
// structural.subSystems[], run runStructuralCalcV4 once per entry, each
// built from the SHARED project-level payload (wind/exposure/rafter/panel
// dims/fence geometry) + that entry's panelCount/geometry, with
// installationType mapped roof→'roof_residential', ground→'ground_mount',
// fence→'fence' (same mapping as systemTypeToInstallationType client-side).
//
// Pure module (no Next.js imports) so tests can call it directly without
// request mocking. The route keeps the legacy whole-project run untouched
// and ADDS structural.subSystems / structural.subSystemMeta to the response.
// ═══════════════════════════════════════════════════════════════

import {
  runStructuralCalcV4,
  type StructuralInputV4,
  type StructuralResultV4,
} from '@/lib/structural-engine-v4';
import { getMountingSystemById, resolveMountingSystemId } from '@/lib/mounting-hardware-db';

export type SubSystemKey = 'roof' | 'ground' | 'fence';

/** One entry of the optional structural.subSystems[] payload (client contract). */
export interface SubSystemEntry {
  key: SubSystemKey;
  panelCount: number;
  /** Fence-subset run length (ft). Fallback: panelCount × module width. */
  fenceLengthFt?: number;
  /** Ground-array tilt (deg) — stands in for roofPitch in the V4 input. */
  groundTiltDeg?: number;
  /** Accepted for forward-compat; no V4 structural field consumes azimuth yet. */
  groundAzimuth?: number;
  rowCount?: number;
}

/** Jurisdiction-derived fallbacks the route already computes for the legacy run. */
export interface StructuralDefaults {
  windSpeed: number;
  groundSnowLoad: number;
}

// Same ground-capable default the permit path uses (buildSubSystemStructuralInputs):
// a roof mount (RT-MINI etc.) analyzed as ground is nonsense, and the V4 ground-pile
// branch only activates when the mounting system's systemType is a ground type.
export const GROUND_DEFAULT_MOUNTING_ID = 'ground-dual-post-driven';

/**
 * Legacy structural payload → StructuralInputV4. Moved VERBATIM from route.ts
 * so the whole-project (legacy) run and the per-sub runs share ONE mapping —
 * same field aliases, same fallbacks, byte-identical legacy behavior.
 */
export function buildStructuralInputV4(
  structural: any,
  defaults: StructuralDefaults,
): StructuralInputV4 {
  return {
    installationType: structural.installationType ?? 'roof_residential',
    windSpeed:        Number(structural.windSpeed ?? defaults.windSpeed),
    // `||` not `??` — '' now means UNSTATED (see engineering-helpers ProjectConfig),
    // and `??` would pass the empty string through into KZ_TABLE[''].
    windExposure:     structural.windExposure || 'C',
    groundSnowLoad:   Number(structural.groundSnowLoad ?? defaults.groundSnowLoad),
    meanRoofHeight:   Number(structural.meanRoofHeight ?? 15),
    roofPitch:        Number(structural.roofPitch ?? 20),
    framingType:      structural.framingType ?? 'unknown',
    rafterSize:       structural.rafterSize ?? '2x6',
    rafterSpacingIn:  Number(structural.rafterSpacing ?? structural.rafterSpacingIn ?? 24),
    rafterSpanFt:     Number(structural.rafterSpan ?? structural.rafterSpanFt ?? 16),
    woodSpecies:      structural.rafterSpecies ?? structural.woodSpecies ?? 'Douglas Fir-Larch',
    panelCount:       Number(structural.panelCount ?? 24),
    panelLengthIn:    Number(structural.panelLength ?? structural.panelLengthIn ?? 73.0),
    panelWidthIn:     Number(structural.panelWidth ?? structural.panelWidthIn ?? 41.0),
    panelWeightLbs:   Number(structural.panelWeight ?? structural.panelWeightLbs ?? 45.0),
    panelOrientation: structural.panelOrientation ?? 'portrait',
    rowCount:         structural.rowCount,
    colCount:         structural.colCount,
    moduleGapIn:      structural.moduleGapIn ?? 0.5,
    rowGapIn:         structural.rowGapIn ?? 6,
    mountingSystemId: structural.mountingSystem ?? structural.mountingSystemId ?? 'ironridge-xr100',
    rackingWeightPerPanelLbs: structural.rackingWeight ?? structural.rackingWeightPerPanelLbs ?? 4.0,
    roofDeadLoadPsf:  structural.roofDeadLoadPsf ?? 15,
    soilType:         structural.soilType,
    frostDepthIn:     structural.frostDepthIn,
    // Fence (SolFence) — forwarded to analyzeFence; falls back to SolFence
    // defaults (6ft height, 8ft section) when the client omits them.
    fenceHeightFt:    structural.fenceHeightFt,
    fenceLengthFt:    structural.fenceLengthFt,
    postSpacingFt:    structural.postSpacingFt,
    groundClearanceFt: structural.groundClearanceFt,
  };
}

/**
 * Shared base input + one sub-system entry → the scoped V4 input for that run.
 * Project-level rowCount/colCount describe the WHOLE project (e.g. 94 panels),
 * so per-sub runs drop them and use entry.rowCount (else the engine's
 * autoLayout for the subset panelCount) — same rationale as the permit path
 * scoping resolveArrayStructuralLayout per sub-system.
 */
function inputForSubSystem(base: StructuralInputV4, entry: SubSystemEntry): StructuralInputV4 {
  const panelCount = Math.max(1, Math.round(Number(entry.panelCount)));
  const scoped: StructuralInputV4 = {
    ...base,
    panelCount,
    rowCount: entry.rowCount,
    colCount: undefined,
  };

  if (entry.key === 'roof') {
    // Rafter/roof fields in the shared payload describe the roof — pass through.
    return { ...scoped, installationType: 'roof_residential' };
  }

  if (entry.key === 'ground') {
    // Keep the project's mounting id only if it IS a ground-capable system.
    const projMount = getMountingSystemById(resolveMountingSystemId(base.mountingSystemId || ''));
    const isGroundMount = !!projMount && ['ground_mount', 'tracker'].includes(projMount.category);
    return {
      ...scoped,
      installationType: 'ground_mount',
      mountingSystemId: isGroundMount ? base.mountingSystemId : GROUND_DEFAULT_MOUNTING_ID,
      roofPitch: typeof entry.groundTiltDeg === 'number' ? entry.groundTiltDeg : base.roofPitch,
      soilType: base.soilType ?? 'unknown',
      frostDepthIn: base.frostDepthIn ?? 36,
    };
  }

  // Fence: scope the run length to the fence SUBSET. Entry value wins; then the
  // project-level fence field; last resort panelCount × module width (ft).
  const moduleWidthFt = (base.panelWidthIn > 0 ? base.panelWidthIn : 41) / 12;
  return {
    ...scoped,
    installationType: 'fence',
    fenceLengthFt:
      entry.fenceLengthFt ?? base.fenceLengthFt ?? Math.round(panelCount * moduleWidthFt * 10) / 10,
  };
}

export interface SubSystemStructuralOutcome {
  /** Keyed results — the SAME objects runStructuralCalcV4 returns. */
  subSystems: Partial<Record<SubSystemKey, StructuralResultV4>>;
  subSystemMeta: {
    partitioned: true;
    counts: Partial<Record<SubSystemKey, number>>;
    /** Keys whose engine run crashed (logged + omitted from subSystems). */
    failed?: SubSystemKey[];
  };
}

/**
 * Run the V4 structural engine once per structural.subSystems[] entry.
 * Returns null when the payload has no valid entries (legacy request) —
 * the route then emits a byte-identical legacy response.
 * One failing engine never kills the response: it is logged and its key omitted.
 */
export function runSubSystemStructural(
  structural: any,
  defaults: StructuralDefaults,
): SubSystemStructuralOutcome | null {
  const raw: any[] = Array.isArray(structural?.subSystems) ? structural.subSystems : [];
  const entries: SubSystemEntry[] = raw.filter(
    (e: any): e is SubSystemEntry =>
      !!e &&
      (e.key === 'roof' || e.key === 'ground' || e.key === 'fence') &&
      Number(e.panelCount) > 0,
  );
  if (entries.length === 0) return null;

  const base = buildStructuralInputV4(structural, defaults);
  const subSystems: SubSystemStructuralOutcome['subSystems'] = {};
  const counts: SubSystemStructuralOutcome['subSystemMeta']['counts'] = {};
  const failed: SubSystemKey[] = [];

  for (const entry of entries) {
    if (entry.key in subSystems || failed.includes(entry.key)) continue; // first entry per key wins
    counts[entry.key] = Math.round(Number(entry.panelCount));
    try {
      subSystems[entry.key] = runStructuralCalcV4(inputForSubSystem(base, entry));
    } catch (err: unknown) {
      console.error(`[calculate] sub-system '${entry.key}' structural run crashed:`, err);
      failed.push(entry.key);
    }
  }

  return {
    subSystems,
    subSystemMeta: {
      partitioned: true,
      counts,
      ...(failed.length > 0 ? { failed } : {}),
    },
  };
}
