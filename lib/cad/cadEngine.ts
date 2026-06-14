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