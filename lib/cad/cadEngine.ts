// ============================================================
// SolarPro CAD Engine — Root Entry Point
// lib/cad/cadEngine.ts
//
// generateCADLayout(input: PermitInputShape): CADModel
//
// ARCHITECTURE:
//   PermitInput
//     → resolveSystemType()
//     → roofCAD()  | groundCAD() | fenceCAD()
//     → CADModel
//     → adaptCADToDrafting()
//     → DraftingInput (feeds existing templates unchanged)
//
// RULES:
//   - One CAD solver per system type (no shared layout logic)
//   - Each solver is fully independent
//   - CADModel is the SINGLE SOURCE OF TRUTH
//   - Drafting engine = rendering only
// ============================================================

import type { PermitInputShape } from '../drafting/permitInputShape';
import type { CADModel, CADSystemType } from './types';
import { roofCAD }   from './roof/roofCAD';
import { groundCAD } from './ground/groundCAD';
import { fenceCAD }  from './fence/fenceCAD';
import { buildSystemDefinition } from '@/lib/system';
import { partitionSubSystems, classifyPanel, type SubSystem } from '@/lib/permit/utils/subSystems';

// ── Hybrid (multi-system) support — Phase 1 ─────────────────────────
// A design may contain roof + ground + fence panels in ONE project.
// Each solver historically consumed the UNSCOPED input (all panels /
// project-wide totalPanels) — how the Stowell fence claimed all 80
// modules. For hybrids we run EVERY present solver with an input scoped
// to its own panel subset, then compose one CADModel carrying all
// sections (types.ts already allows roof?/ground?/fence? together).

const SUB_TO_CAD: Record<'roof' | 'ground' | 'fence', CADSystemType> = {
  roof: 'roof', ground: 'ground_mount', fence: 'solar_fence',
};
const SUB_BUILDER: Record<'roof' | 'ground' | 'fence', (i: PermitInputShape) => CADModel> = {
  roof: roofCAD, ground: groundCAD, fence: fenceCAD,
};

/** Scope the permit input to ONE sub-system: its panels, its counts, its type. */
function scopeInputToSubSystem(input: PermitInputShape, sub: SubSystem): PermitInputShape {
  const fullPanels = input.system?.totalPanels || 0;
  const fullKw = input.system?.totalDcKw || 0;
  const kwPerPanel = fullPanels > 0 ? fullKw / fullPanels : 0;
  const filterByType = <T,>(list: T[] | undefined): T[] | undefined =>
    list ? (list as any[]).filter(p => classifyPanel(p) === sub.key) as T[] : list;
  return {
    ...input,
    system: {
      ...(input.system ?? {}),
      totalPanels: sub.panelCount,
      totalDcKw: Math.round(sub.panelCount * kwPerPanel * 100) / 100,
    },
    project: {
      ...(input.project ?? {}),
      panelPositions: filterByType(input.project?.panelPositions),
      systemType: sub.key,
    },
    layout: {
      ...(input.layout ?? {}),
      type: SUB_TO_CAD[sub.key],
    },
  } as PermitInputShape;
}

// Re-use the existing system type resolver logic
// FIX v47.318: Priority order:
//   1. input.layout?.type   (canonical — set by buildCanonical() in route.ts)
//   2. input.project?.systemType (injected by buildCanonical after it runs)
//   3. Layout data inference (fenceSegments / groundArrays present)
//   4. Default: 'roof'
function resolveCADSystemType(input: PermitInputShape): CADSystemType {
  // Priority 1: layout.type — the canonical value set by buildCanonical()
  // Error 5v fix: type is now on PermitInputShape.layout — no `as any` needed
  const layoutType = (input.layout?.type || '').toLowerCase().trim();
  if (layoutType === 'solar_fence' || layoutType === 'fence')  return 'solar_fence';
  if (layoutType === 'ground_mount' || layoutType === 'ground') return 'ground_mount';
  if (layoutType === 'roof')                                     return 'roof';

  // Priority 2: project.systemType (injected by buildCanonical)
  const raw = ((input.project?.systemType) || '').toLowerCase().trim();
  if (raw === 'solar_fence' || raw === 'fence')        return 'solar_fence';
  if (raw === 'ground_mount' || raw === 'ground')       return 'ground_mount';
  if (raw === 'roof')                                    return 'roof';

  // Priority 3: Infer from layout data
  const hasFence  = (input.layout?.fenceSegments?.length  ?? 0) > 0;
  const hasGround = (input.layout?.groundArrays?.length   ?? 0) > 0;
  if (hasFence)  return 'solar_fence';
  if (hasGround) return 'ground_mount';

  return 'roof';
}

/**
 * Primary CAD engine entry point.
 *
 * Resolves system type and delegates to the appropriate
 * system-specific CAD solver. Returns a CADModel that
 * serves as the single source of truth for all downstream
 * drafting and rendering.
 *
 * @throws Never — all solvers handle missing data gracefully.
 */
export function generateCADLayout(input: PermitInputShape): CADModel {
  const systemType = resolveCADSystemType(input);

  console.log('[CAD ENGINE INIT]', {
    systemType,
    timestamp: Date.now(),
    totalPanels: input.system?.totalPanels,
    systemKw:    input.system?.totalDcKw,
    hasPanelPositions: (input.project?.panelPositions?.length ?? 0) > 0,
    hasRoofPlanes:     (input.project?.roofPlanes?.length     ?? 0) > 0,
    hasFenceSegments:  (input.layout?.fenceSegments?.length   ?? 0) > 0,
    hasGroundArrays:   (input.layout?.groundArrays?.length    ?? 0) > 0,
  });

  let model: CADModel;

  // ── HYBRID PATH (Phase 1): panels span >1 system type ─────────────
  // Run EVERY present solver with a SCOPED input (its own panel subset —
  // unscoped, the fence solver claimed all 80 Stowell modules), use the
  // legacy winner's model as the base, graft the other sections onto it,
  // and restore project-wide totals. Each grafted section's local XY is
  // relative to ITS OWN origin — recorded in model.hybrid.sections so the
  // site plan (top-down aerial with roof + ground + fence together) can
  // re-project each section against the base origin.
  const _allPanels = (input.project?.panelPositions ?? []) as any[];
  const _subs = partitionSubSystems(_allPanels);

  if (_subs.length > 1) {
    const _cadToKey: Record<CADSystemType, 'roof' | 'ground' | 'fence'> =
      { roof: 'roof', ground_mount: 'ground', solar_fence: 'fence' };
    const primaryKey = _cadToKey[systemType];
    const built = new Map<'roof' | 'ground' | 'fence', CADModel>();
    for (const sub of _subs) {
      try {
        built.set(sub.key, SUB_BUILDER[sub.key](scopeInputToSubSystem(input, sub)));
      } catch (e) {
        console.warn(`[CAD ENGINE] hybrid sub-solver '${sub.key}' failed (section skipped):`,
          e instanceof Error ? e.message : e);
      }
    }
    // Base = the legacy winner's scoped model (falls back to first built).
    const base = built.get(primaryKey) ?? built.values().next().value as CADModel;
    model = base;
    model.hybrid = { sections: [] };
    for (const sub of _subs) {
      const m = built.get(sub.key);
      if (!m) continue;
      // Graft the section (base already carries its own).
      if (sub.key === 'roof' && m.roof) model.roof = m.roof;
      if (sub.key === 'ground' && m.ground) model.ground = m.ground;
      if (sub.key === 'fence' && m.fence) model.fence = m.fence;
      model.hybrid.sections.push({
        key: sub.key,
        originLat: m.originLat, originLng: m.originLng,
        totalPanels: m.totalPanels, dcKw: m.totalDcKw,
      });
    }
    // Project-wide totals (consistency checks compare vs canonical.panels).
    model.totalPanels = input.system?.totalPanels || _allPanels.length || model.totalPanels;
    model.totalDcKw   = input.system?.totalDcKw   || model.totalDcKw;
    model.warnings.push(
      `HYBRID: ${_subs.map(s => `${s.key}:${s.panelCount}`).join(' + ')} — all sections populated; ` +
      `grafted sections use their own origins (see model.hybrid.sections)`);
    console.log('[CAD ENGINE] HYBRID composed:', model.hybrid.sections);
  } else {
    switch (systemType) {
      case 'roof':
        model = roofCAD(input);
        break;

      case 'ground_mount':
        model = groundCAD(input);
        break;

      case 'solar_fence':
        model = fenceCAD(input);
        break;

      default: {
        // TypeScript exhaustive check
        const _never: never = systemType;
        throw new Error(`[CAD ENGINE] Unknown system type: ${String(_never)}`);
      }
    }
  }

  // ── Attach SystemDefinition (v48) ──────────────────────────────────
  // Non-breaking: builds standardized system config from input data.
  // Downstream consumers can read model.systemDefinition instead of
  // scattered input fields. Does not alter any geometry or solver output.
  try {
    model.systemDefinition = buildSystemDefinition(input);
  } catch (sdErr: unknown) {
    // Non-fatal — system definition is an overlay, not a requirement
    console.warn('[CAD ENGINE] SystemDefinition build failed (non-critical):', sdErr instanceof Error ? (sdErr as Error).message : sdErr);
  }

  return model;
}

export type { CADModel, CADSystemType } from './types';
export type {
  CADRoofModel, CADRoofPlane,
  CADGroundModel, CADGroundArray, CADGroundRow,
  CADFenceModel, CADFenceSegment, CADFencePost,
  CADPanel, CADDimension,
} from './types';