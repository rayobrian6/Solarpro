// ============================================================
// SolarPro Drafting Engine — Public API
// lib/drafting/index.ts
//
// Single import point for all planset pages.
//
// USAGE:
//   import { drawingEngine } from '@/lib/drafting';
//
//   // PV-2 page:
//   const svg = drawingEngine.getArrayPlan(draftingInput);
//
//   // PV-3 page:
//   const svg = drawingEngine.getStructural(draftingInput);
//
// ADAPTER USAGE (from PermitInput → DraftingInput):
//   import { adaptPermitInput } from '@/lib/drafting';
//   const draftingInput = adaptPermitInput(permitInput);
//
// ============================================================

export type {
  DraftingInput,
  DraftingProject,
  DraftingLayout,
  DraftingEngineering,
  SysType,
  LineClass,
  TextOptions,
  DimensionOptions,
  CalloutOptions,
  LeaderOptions,
  CanvasSize,
} from './types';

// ── Design Intent Layer (Phase 1 — additive) ─────────────────
export type { DesignIntent } from './designIntent';
export { buildDesignIntent, safeBuildIntent } from './designIntent';

export { CANVAS_STANDARD, CANVAS_WIDE, CANVAS_TALL } from './types';

// ── System Resolver ───────────────────────────────────────────
export { resolveSystemType, sysTypeLabel, pv2Title, pv3Title } from './resolver';

// ── Primitives (for advanced custom drawings) ────────────────
export {
  drawLine, drawRect, drawRectFilled, drawCircle, drawCircleFilled,
  drawPolyline, drawPolygon, drawText, drawPath, drawArrowhead,
  drawHatch, drawSVGOpen, drawSVGClose, drawBackground,
  drawTitleBar, drawNorthArrow, drawScaleBar,
  ftToFtIn, compassDir, escapeXml,
} from './primitives';

// ── Dimension Engine ─────────────────────────────────────────
export {
  drawDimension, drawLinearDimension, drawVerticalDimension,
  drawContinuousDimension, drawOverallDimension, drawSpanDimension,
  drawAngleDimension,
} from './dimensions';

// ── Callout System ────────────────────────────────────────────
export {
  drawCallout, drawCalloutWithLeader, drawLeaderLine,
  drawCalloutGroup, drawDetailTag, drawSectionCutLine,
  drawWindArrow,
} from './callouts';

// ── Templates (system-specific drawings) ─────────────────────
export { drawRoofPlan, drawRoofStructural } from './templates/roof';
export { drawGroundArray, drawGroundStructural } from './templates/ground';
export { drawFencePlan, drawFenceElevation } from './templates/fence';

// ── Composer (primary drawing engine API) ────────────────────
export {
  getArrayPlan,
  getStructural,
  getSystemType,
  validateInput,
  // CAD-first path (PREFERRED — runs TRUE CAD engine before rendering)
  getArrayPlanFromPermit,
  getStructuralFromPermit,
  // CAD-model-first path (MOST PREFERRED — accepts pre-resolved CADModel)
  getArrayPlanFromCAD,
  getStructuralFromCAD,
} from './composers';

// ── Style System ─────────────────────────────────────────────
export { DRAFTING_CSS, CAD_COLORS } from './styles';

// ── Engine Object (namespaced API) ───────────────────────────
import {
  getArrayPlan,
  getStructural,
  getSystemType,
  validateInput,
  getArrayPlanFromPermit,
  getStructuralFromPermit,
  getArrayPlanFromCAD,
  getStructuralFromCAD,
} from './composers';
import { resolveSystemType } from './resolver';
import type { DraftingInput } from './types';
import type { PermitInputShape } from './permitInputShape';

export const drawingEngine = {
  /** PV-2: Returns system-appropriate array plan SVG (legacy DraftingInput path) */
  getArrayPlan,
  /** PV-3: Returns system-appropriate structural SVG (legacy DraftingInput path) */
  getStructural,
  /** PV-2: Returns system-appropriate array plan SVG via TRUE CAD ENGINE (PREFERRED) */
  getArrayPlanFromPermit,
  /** PV-3: Returns system-appropriate structural SVG via TRUE CAD ENGINE (PREFERRED) */
  getStructuralFromPermit,
  /** PV-2: Array plan SVG using pre-resolved CADModel — MOST PREFERRED (no re-run) */
  getArrayPlanFromCAD,
  /** PV-3: Structural SVG using pre-resolved CADModel — MOST PREFERRED (no re-run) */
  getStructuralFromCAD,
  /** Returns resolved system type string */
  getSystemType,
  /** Pre-flight validation — throws on bad input */
  validateInput,
  /** Direct resolver access */
  resolveSystemType,
} as const;

// ── Input Adapter ─────────────────────────────────────────────
// Converts PermitInput (route.ts shape) to DraftingInput.
// Allows gradual migration — planset pages call this adapter
// then pass DraftingInput to the engine.

export type { PermitInputShape } from './permitInputShape';

/**
 * Adapts PermitInput to DraftingInput.
 * Zero data loss — all fields mapped.
 * Safe to call with partial input.
 */
export function adaptPermitInput(input: PermitInputShape): DraftingInput {
  const firstStr = input.system?.inverters?.[0]?.strings?.[0];

  // [ADAPT INPUT] — Step 1: log what geometry is present
  const _panels   = input.project?.panelPositions;
  const _segs     = input.layout?.fenceSegments;
  const _grounds  = input.layout?.groundArrays;
  const _sysType  = input.project?.systemType;
  console.log('[ADAPT INPUT]', {
    sysType:     _sysType,
    hasLayout:   !!input.layout,
    hasPanels:   _panels?.length ?? 0,
    hasFence:    _segs?.length ?? 0,
    hasGround:   _grounds?.length ?? 0,
    totalPanels: input.system?.totalPanels ?? 0,
  });

  // Hard-fail: geometry must exist for the declared system type
  if (_sysType === 'solar_fence') {
    if (!_segs || _segs.length === 0) {
      throw new Error('[adaptPermitInput] solar_fence: layout.fenceSegments is empty — no geometry to draw');
    }
  } else if (_sysType === 'ground_mount') {
    if (!_grounds || _grounds.length === 0) {
      throw new Error('[adaptPermitInput] ground_mount: layout.groundArrays is empty — no geometry to draw');
    }
  } else {
    // roof (default)
    if (!_panels || _panels.length === 0) {
      console.warn('[ADAPT INPUT] WARN: roof — no panelPositions. Schematic mode will be used.');
    }
  }

  return {
    project: {
      systemType:        input.project?.systemType,
      roofType:          input.project?.roofType,
      roofPitch:         input.project?.roofPitch,
      mountingSystem:    input.project?.mountingSystem,
      rafterSize:        input.project?.rafterSize,
      rafterSpacing:     input.project?.rafterSpacing,
      attachmentSpacing: input.project?.attachmentSpacing,
      panelLengthIn:     input.project?.panelLengthIn,
      panelWidthIn:      input.project?.panelWidthIn,
      panelWeightLbs:    input.project?.panelWeightLbs,
      conduitType:       input.project?.conduitType,
      ahjWindSpeedMph:   input.project?.ahjWindSpeedMph,
      ahjGroundSnowPsf:  input.project?.ahjGroundSnowPsf,
      ahjRoofSetbackIn:  input.project?.ahjRoofSetbackIn,
      ahjRidgeSetbackIn: input.project?.ahjRidgeSetbackIn,
      panelPositions:    input.project?.panelPositions,
      roofPlanes:        input.project?.roofPlanes,
    },
    layout: {
      fenceSegments:        input.layout?.fenceSegments,
      fenceTotalLengthFt:   input.layout?.fenceTotalLengthFt,
      fenceGateOpenings:    input.layout?.fenceGateOpenings,
      fencePostSpacingFt:   input.layout?.fencePostSpacingFt,
      fencePostEmbedmentFt: input.layout?.fencePostEmbedmentFt,
      fenceRailCount:       input.layout?.fenceRailCount,
      fencePanelHeightFt:   input.layout?.fencePanelHeightFt,
      groundArrays:         input.layout?.groundArrays,
      groundSetbackFt:      input.layout?.groundSetbackFt,
    },
    engineering: {
      totalDcKw:    input.system?.totalDcKw    || 0,
      totalAcKw:    input.system?.totalAcKw    || 0,
      totalPanels:  input.system?.totalPanels  || 0,
      panelWatts:   firstStr?.panelWatts,
      panelVoc:     firstStr?.panelVoc,
      panelIsc:     firstStr?.panelIsc,
      windSpeedMph: input.project?.ahjWindSpeedMph,
      groundSnowPsf: input.project?.ahjGroundSnowPsf,
    },
  };
}