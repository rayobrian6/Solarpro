// ============================================================
// SolarPro Drafting Engine — Composition Layer
// lib/drafting/composers/index.ts
//
// Routes drawing requests to the correct template based on
// system type (resolved from CADModel — authoritative).
//
// PUBLIC API (CAD-first path — PREFERRED):
//   getArrayPlanFromPermit(input)    → PV-2 SVG via TRUE CAD ENGINE
//   getStructuralFromPermit(input)   → PV-3 SVG via TRUE CAD ENGINE
//   getArrayPlanFromCAD(cad, input)  → PV-2 SVG (pre-solved CAD)
//   getStructuralFromCAD(cad, input) → PV-3 SVG (pre-solved CAD)
//
// PUBLIC API (legacy — DraftingInput path):
//   getArrayPlan(input)              → PV-2 SVG (system-specific)
//   getStructural(input)             → PV-3 SVG (system-specific)
//
// CAD ENGINE FLOW:
//   PermitInputShape
//     → generateCADLayout()          ← TRUE CAD solver (geometry)
//     → assertValidPlanSet()         ← STEP 10 validation (throws if invalid)
//     → adaptCADToDrafting()         ← CAD → DraftingInput adapter
//     → drawRoofPlan() | drawGroundArray() | drawFenceElevation()
//       (cad model passed directly — STEP 4 CAD-as-truth)
//
// DESIGN INTENT:
//   - CADModel is the SINGLE SOURCE OF TRUTH for all geometry
//   - Validation runs BEFORE any render (Step 10)
//   - CAD model is passed directly to templates (Step 4)
//   - System type from cad.systemType (authoritative — Step 1/2)
//   - Legacy getArrayPlan/getStructural preserved for compatibility
// ============================================================

import type { DraftingInput, SysType } from '../types';
import type { PermitInputShape } from '../permitInputShape';
import { resolveSystemType } from '../resolver';
import { drawRoofPlan, drawRoofStructural } from '../templates/roof';
import { buildSiteContext, type SiteContext } from '../templates/roofSiteContext';
import { drawGroundArray, drawGroundStructural } from '../templates/ground';
import { drawFencePlan, drawFenceElevation } from '../templates/fence';
import { safeBuildIntent } from '../designIntent';
import type { DesignIntent } from '../designIntent';
import { assertValidPlanSet, type SystemType } from '../validation';
import { buildRenderContext, type RenderContext } from '../renderContext';
import type { BillInsights } from '../../billInsights';

// ── CAD Engine imports ─────────────────────────────────────────────────────────
import { generateCADLayout } from '../../cad/cadEngine';
import { adaptCADToDrafting } from '../../cad/adapter';
import type { CADModel } from '../../cad/types';
import { buildCADFromSurvey } from '../../cad/buildCADFromSurvey';
import { mergeCADModels } from '../../cad/mergeCADModels';
import type { EnrichedSiteSurvey } from '../../siteSurvey/types';

// ─────────────────────────────────────────────────────────────────────────────
// CAD-FIRST PATH (PREFERRED)
// ─────────────────────────────────────────────────────────────────────────────

// ── getArrayPlanFromPermit ────────────────────────────────────────────────────
// PV-2 drawing via TRUE CAD ENGINE.
//
// FLOW:
//   PermitInputShape
//     → generateCADLayout()   (roof / ground / fence CAD solver)
//     → assertValidPlanSet()  (Step 10 — throws on failure)
//     → adaptCADToDrafting()  (CADModel → DraftingInput)
//     → drawRoofPlan() | drawGroundArray() | drawFencePlan()
//       (cad passed directly — Step 4)

export function getArrayPlanFromPermit(
  input: PermitInputShape,
  ctx?: RenderContext | null,
  enrichedSurvey?: EnrichedSiteSurvey | null,
): string {
  console.log('[CAD COMPOSER] getArrayPlanFromPermit — entering CAD pipeline', {
    systemType: input.project?.systemType,
    totalPanels: input.system?.totalPanels,
  });

  // ── Step 1: Run TRUE CAD solver ──────────────────────────────────────────
  let cad = generateCADLayout(input);

  console.log('[CAD COMPOSER] CAD solve complete', {
    systemType:  cad.systemType,
    totalPanels: cad.totalPanels,
    totalDcKw:   cad.totalDcKw.toFixed(2),
    warnings:    cad.warnings,
    solveMs:     cad.solveMs,
  });

  // ── Phase 3: Survey CAD overlay (non-destructive, guarded) ──────────────────
  if (enrichedSurvey) {
    try {
      const surveyInputs = buildCADFromSurvey(enrichedSurvey);
      const { model: mergedCad, mergeLog, applied } = mergeCADModels(cad, surveyInputs);
      cad = mergedCad;
      if (applied.length > 0) {
        console.log('[CAD COMPOSER] [SURVEY MERGED] getArrayPlanFromPermit', { applied, mergeLog });
      }
    } catch (surveyMergeErr) {
      console.warn('[CAD COMPOSER] Survey merge skipped (non-fatal):', (surveyMergeErr as Error).message);
    }
  }

  // ── Step 10: Validate before any rendering ───────────────────────────────
  assertValidPlanSet(cad, cad.systemType as SystemType);

  // ── Step 2: Convert CADModel → DraftingInput ─────────────────────────────
  const dInput = adaptCADToDrafting(cad, input);

  // ── Step 3: Build design intent (safe — never throws) ────────────────────
  const intent = safeBuildIntent(dInput);

  // ── Step 4+5: Route to system-specific template, passing cad + ctx directly ──
  const sysType = cad.systemType;

  console.log('[CAD COMPOSER] [Geometry Output] getArrayPlanFromPermit', {
    sysType,
    panelCount:   dInput.project?.panelPositions?.length   ?? 0,
    segmentCount: dInput.layout?.fenceSegments?.length ?? 0,
    groundCount:  dInput.layout?.groundArrays?.length  ?? 0,
    cadWarnings:  cad.warnings,
  });

  let svg: string;
  switch (sysType) {
    case 'solar_fence':
      svg = drawFencePlan(dInput, intent, cad, ctx);
      break;
    case 'ground_mount':
      svg = drawGroundArray(dInput, intent, cad, ctx);
      break;
    case 'roof':
    default:
      svg = drawRoofPlan(dInput, intent, cad, ctx);
      break;
  }

  console.log('[CAD COMPOSER] getArrayPlanFromPermit OK', {
    sysType,
    svgLength: svg.length,
  });
  return svg;
}

// ── getStructuralFromPermit ───────────────────────────────────────────────────
// PV-3 structural drawing via TRUE CAD ENGINE.

export function getStructuralFromPermit(
  input: PermitInputShape,
  ctx?: RenderContext | null,
  enrichedSurvey?: EnrichedSiteSurvey | null,
): string {
  console.log('[CAD COMPOSER] getStructuralFromPermit — entering CAD pipeline', {
    systemType: input.project?.systemType,
    totalPanels: input.system?.totalPanels,
  });

  // ── Step 1: Run TRUE CAD solver ──────────────────────────────────────────
  let cad = generateCADLayout(input);

  console.log('[CAD COMPOSER] CAD solve complete (structural)', {
    systemType:  cad.systemType,
    totalPanels: cad.totalPanels,
    solveMs:     cad.solveMs,
  });

  // ── Phase 3: Survey CAD overlay (non-destructive, guarded) ──────────────────
  if (enrichedSurvey) {
    try {
      const surveyInputs = buildCADFromSurvey(enrichedSurvey);
      const { model: mergedCad, mergeLog, applied } = mergeCADModels(cad, surveyInputs);
      cad = mergedCad;
      if (applied.length > 0) {
        console.log('[CAD COMPOSER] [SURVEY MERGED] getStructuralFromPermit', { applied, mergeLog });
      }
    } catch (surveyMergeErr) {
      console.warn('[CAD COMPOSER] Survey merge skipped (non-fatal):', (surveyMergeErr as Error).message);
    }
  }

  // ── Step 10: Validate before any rendering ───────────────────────────────
  assertValidPlanSet(cad, cad.systemType as SystemType);

  // ── Step 2: Convert CADModel → DraftingInput ─────────────────────────────
  const dInput = adaptCADToDrafting(cad, input);

  // ── Step 3: Build design intent (safe — never throws) ────────────────────
  const intent = safeBuildIntent(dInput);

  // ── Step 4+5: Route to system-specific structural template, passing ctx ─────
  const sysType = cad.systemType;

  console.log('[CAD COMPOSER] [Geometry Output] getStructuralFromPermit', {
    sysType,
    panelCount:   dInput.project?.panelPositions?.length   ?? 0,
    segmentCount: dInput.layout?.fenceSegments?.length ?? 0,
    groundCount:  dInput.layout?.groundArrays?.length  ?? 0,
    cadWarnings:  cad.warnings,
  });

  let svg: string;
  switch (sysType) {
    case 'solar_fence':
      svg = drawFenceElevation(dInput, intent, cad, ctx);
      break;
    case 'ground_mount':
      svg = drawGroundStructural(dInput, intent, cad, ctx);
      break;
    case 'roof':
    default:
      svg = drawRoofStructural(dInput, intent, cad, ctx);
      break;
  }

  console.log('[CAD COMPOSER] getStructuralFromPermit OK', {
    sysType,
    svgLength: svg.length,
  });
  return svg;
}

// ─── CAD-MODEL-FIRST DRAWING FUNCTIONS ───────────────────────────────────────
// Accept a pre-resolved CADModel (already computed by generatePermitHTML)
// and skip the second generateCADLayout() call.
//
// USAGE (in route.ts page functions):
//   const drawingSvg = drawingEngine.getArrayPlanFromCAD(cad, input);
//   const structSvg  = drawingEngine.getStructuralFromCAD(cad, input);
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PV-2 array plan SVG using a pre-computed CADModel.
 * cad.systemType is authoritative — Step 10 validation runs first.
 */
export function getArrayPlanFromCAD(
  cad: CADModel,
  input: PermitInputShape,
  ctx?: RenderContext | null,
  panelColorById?: Map<string, string> | null,
): string {
  console.log('[CAD COMPOSER] getArrayPlanFromCAD — using pre-resolved cad', {
    systemType:  cad.systemType,
    totalPanels: cad.totalPanels,
    totalDcKw:   cad.totalDcKw.toFixed(2),
  });

  // ── Step 10: Validate ────────────────────────────────────────────────────
  assertValidPlanSet(cad, cad.systemType as SystemType);

  // Convert pre-solved CADModel → DraftingInput
  const dInput = adaptCADToDrafting(cad, input);
  const intent = safeBuildIntent(dInput);

  // Site context (county-GIS parcel + street) projected into the roof's own
  // fake-degree frame so PV-2 can draw the property line / driveway / sidewalk
  // INTEGRATED with the roof (not a separate box). Null when no parcel/origin →
  // roof plan renders exactly as before.
  try {
    (dInput as unknown as { _siteContext?: SiteContext | null })._siteContext =
      buildSiteContext(cad, input);
  } catch { /* non-fatal — roof-only render */ }

  // Route to template using cad.systemType (authoritative), passing cad directly
  let svg: string;
  switch (cad.systemType) {
    case 'solar_fence':
      svg = drawFencePlan(dInput, intent, cad, ctx);
      break;
    case 'ground_mount':
      svg = drawGroundArray(dInput, intent, cad, ctx);
      break;
    case 'roof':
    default:
      svg = drawRoofPlan(dInput, intent, cad, ctx, panelColorById);
      break;
  }

  console.log('[CAD COMPOSER] getArrayPlanFromCAD OK', {
    systemType: cad.systemType,
    svgLength:  svg.length,
  });
  return svg;
}

/**
 * PV-3 structural SVG using a pre-computed CADModel.
 * cad.systemType is authoritative — Step 10 validation runs first.
 */
export function getStructuralFromCAD(
  cad: CADModel,
  input: PermitInputShape,
  ctx?: RenderContext | null,
): string {
  console.log('[CAD COMPOSER] getStructuralFromCAD — using pre-resolved cad', {
    systemType:  cad.systemType,
    totalPanels: cad.totalPanels,
  });

  // ── Step 10: Validate ────────────────────────────────────────────────────
  assertValidPlanSet(cad, cad.systemType as SystemType);

  const dInput = adaptCADToDrafting(cad, input);
  const intent = safeBuildIntent(dInput);

  let svg: string;
  switch (cad.systemType) {
    case 'solar_fence':
      svg = drawFenceElevation(dInput, intent, cad, ctx);
      break;
    case 'ground_mount':
      svg = drawGroundStructural(dInput, intent, cad, ctx);
      break;
    case 'roof':
    default:
      svg = drawRoofStructural(dInput, intent, cad, ctx);
      break;
  }

  console.log('[CAD COMPOSER] getStructuralFromCAD OK', {
    systemType: cad.systemType,
    svgLength:  svg.length,
  });
  return svg;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY PATH (DraftingInput — preserved for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

// ── getArrayPlan ──────────────────────────────────────────────────────────────
// PV-2 drawing: layout plan for the array type (legacy DraftingInput path).
//
//   roof         → drawRoofPlan()       top-down roof + panels
//   ground_mount → drawGroundArray()    site plan + row layout
//   solar_fence  → drawFencePlan()      top-down fence path + segments

export function getArrayPlan(input: DraftingInput): string {
  const sysType = resolveSystemType(input);

  // Phase 1: build intent (safe — never throws, may return null)
  const intent = safeBuildIntent(input);

  // Dev-mode logging
  console.log('[DesignIntent] getArrayPlan', intent);

  // [Geometry Output] — log raw geometry data flowing into this render
  const panels   = input.project?.panelPositions;
  const segments = input.layout?.fenceSegments;
  const grounds  = input.layout?.groundArrays;
  const bounds   = intent?.geometry?.bounds;
  const scaleTarget = intent?.drafting?.scaleTarget;
  console.log('[Geometry Output] getArrayPlan', {
    sysType,
    panelCount:   panels?.length ?? 0,
    segmentCount: segments?.length ?? 0,
    groundCount:  grounds?.length ?? 0,
    bounds,
    scale: { target: scaleTarget },
  });
  if (sysType === 'solar_fence' && (!segments || segments.length === 0)) {
    throw new Error('[DraftingEngine] solar_fence: no fenceSegments — cannot draw without geometry');
  }
  if (sysType === 'ground_mount' && (!grounds || grounds.length === 0)) {
    throw new Error('[DraftingEngine] ground_mount: no groundArrays — cannot draw without geometry');
  }
  if (sysType === 'roof' && (!panels || panels.length === 0)) {
    console.warn('[Geometry Output] WARN: roof — no panelPositions.');
  }

  // Note: legacy path passes null for cad (templates fall back to DraftingInput)
  const svg = sysType === 'solar_fence'  ? drawFencePlan(input, intent, null) :
               sysType === 'ground_mount' ? drawGroundArray(input, intent, null) :
               drawRoofPlan(input, intent, null);

  console.log('[Drawing] getArrayPlan', sysType, 'svg.length=' + svg.length);
  switch (sysType) {
    case 'solar_fence':  return svg;
    case 'ground_mount': return svg;
    case 'roof':         return svg;
    default: {
      const _never: never = sysType;
      throw new Error('[DraftingEngine] getArrayPlan: unknown system type: ' + String(_never));
    }
  }
}

// ── getStructural ─────────────────────────────────────────────────────────────
// PV-3 drawing: structural detail for the array type (legacy DraftingInput path).
//
//   roof         → drawRoofStructural()    cross-section + attachment
//   ground_mount → drawGroundStructural()  pile/pier elevation
//   solar_fence  → drawFenceElevation()    full structural elevation

export function getStructural(input: DraftingInput): string {
  const sysType = resolveSystemType(input);

  // Build intent (safe)
  const intent = safeBuildIntent(input);
  console.log('[DesignIntent] getStructural', intent);

  const panels   = input.project?.panelPositions;
  const segments = input.layout?.fenceSegments;
  const grounds  = input.layout?.groundArrays;
  const bounds   = intent?.geometry?.bounds;
  const scaleTarget = intent?.drafting?.scaleTarget;
  console.log('[Geometry Output] getStructural', {
    sysType,
    panelCount:   panels?.length ?? 0,
    segmentCount: segments?.length ?? 0,
    groundCount:  grounds?.length ?? 0,
    bounds,
    scale: { target: scaleTarget },
  });
  if (sysType === 'solar_fence' && (!segments || segments.length === 0)) {
    throw new Error('[DraftingEngine] solar_fence: no fenceSegments — cannot draw without geometry');
  }
  if (sysType === 'ground_mount' && (!grounds || grounds.length === 0)) {
    throw new Error('[DraftingEngine] ground_mount: no groundArrays — cannot draw without geometry');
  }
  if (sysType === 'roof' && (!panels || panels.length === 0)) {
    console.warn('[Geometry Output] WARN: roof — no panelPositions.');
  }

  // Note: legacy path passes null for cad (templates fall back to DraftingInput)
  const svg = sysType === 'solar_fence'  ? drawFenceElevation(input, intent, null) :
               sysType === 'ground_mount' ? drawGroundStructural(input, intent, null) :
               drawRoofStructural(input, intent, null);

  console.log('[Drawing] getStructural', sysType, 'svg.length=' + svg.length);
  switch (sysType) {
    case 'solar_fence':  return svg;
    case 'ground_mount': return svg;
    case 'roof':         return svg;
    default: {
      const _never: never = sysType;
      throw new Error('[DraftingEngine] getStructural: unknown system type: ' + String(_never));
    }
  }
}

// ── getSystemType ─────────────────────────────────────────────────────────────
// Expose resolved system type for page headers / labels.

export function getSystemType(input: DraftingInput): SysType {
  return resolveSystemType(input);
}

// ── validateInput ─────────────────────────────────────────────────────────────
// Pre-flight check before drawing. Throws descriptive errors.

export function validateInput(input: DraftingInput): void {
  if (!input) {
    throw new Error('[DraftingEngine] Input is null or undefined');
  }
  if (!input.project) {
    throw new Error('[DraftingEngine] input.project is required');
  }
  if (!input.layout) {
    throw new Error('[DraftingEngine] input.layout is required');
  }
  if (!input.engineering) {
    throw new Error('[DraftingEngine] input.engineering is required');
  }

  const sysType = resolveSystemType(input);

  if (sysType === 'solar_fence') {
    const segs = input.layout.fenceSegments;
    if (!segs || segs.length === 0) {
      console.warn('[DraftingEngine] solar_fence: no fenceSegments — using schematic layout');
    }
  }

  if (sysType === 'ground_mount') {
    const arrs = input.layout.groundArrays;
    if (!arrs || arrs.length === 0) {
      console.warn('[DraftingEngine] ground_mount: no groundArrays — using schematic layout');
    }
  }
}