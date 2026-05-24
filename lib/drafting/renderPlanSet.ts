// ============================================================
// SolarPro Drafting Engine — Global Render Contract
// lib/drafting/renderPlanSet.ts
//
// renderPlanSet(cadModel, systemType) — STEP 1
//
// The ONLY entry point for generating any planset sheet.
// NO sheet may render without BOTH a solved CADModel AND
// a matching systemType.
//
// This function:
//   1. Validates (Step 10) — throws if invalid
//   2. Routes to system-specific engines (Step 2/5)
//   3. Returns named sheet SVGs keyed by sheet ID
//
// Sheet IDs follow PV-n notation:
//   PV-0: Cover / title sheet
//   PV-1: Site plan
//   PV-2: Array plan (PRIMARY per system)
//   PV-3: Structural / elevation
//   PV-4A..C: Electrical / single-line
//   SCHED: Schedule sheet
//   APP-A: Appendix A
//   CERT: Certification
//   PE-1: PE letter
// ============================================================

import type { CADModel } from '../cad/types';
import { assertValidPlanSet, type SystemType } from './validation';
import type { DraftingInput } from './types';
import type { DesignIntent } from './designIntent';
import { drawFenceElevation, drawFencePlan } from './templates/fence';
import { drawGroundArray, drawGroundStructural } from './templates/ground';
import { drawRoofPlan, drawRoofStructural } from './templates/roof';
import { buildRenderContext, type RenderContext } from './renderContext';
import type { BillInsights } from '../billInsights';
import type { DocumentProvenanceBundle } from '@/lib/documentProvenance';
import type { EngineeringDecisionEvaluationBundle } from '@/lib/engineeringDecisionProvenance';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import { buildCADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import {
  CAD_APPENDIX_PREVIEW_SHEET_ID,
  buildPlanSetCADAppendixPreviewSheetV1,
  renderPlanSetCADAppendixPreviewSheetV1,
} from './cadAppendixPreviewSheet';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanSetSheets {
  /** Sheet ID → SVG string */
  sheets: Record<string, string>;
  /** System type that generated these sheets */
  systemType: SystemType;
  /** Total panels from CAD */
  totalPanels: number;
  /** Total DC kW from CAD */
  totalDcKw: number;
  /** Any warnings from validation */
  warnings: string[];
  /** v47.307: RenderContext used for this planset (includes billInsights if available) */
  renderContext: RenderContext;
}

// ── Main render contract ──────────────────────────────────────────────────────

/**
 * renderPlanSet — STEP 1 Global Render Contract (v47.307)
 *
 * The ONLY public function that generates planset sheets.
 * BOTH cadModel and systemType are mandatory.
 * Throws PlanSetValidationError if the model fails validation.
 *
 * @param cad          Solved CADModel (from generateCADLayout)
 * @param systemType   Must match cad.systemType exactly
 * @param input        DraftingInput for non-geometry fields (project specs, electrical)
 * @param intent       Optional DesignIntent from CAD solver
 * @param billInsights Optional Bill Intelligence Layer output (v47.307)
 * @param engOpts      Optional engineering data (rate, utility, usage) (v47.307)
 */
export function renderPlanSet(
  cad: CADModel,
  systemType: SystemType,
  input: DraftingInput,
  intent?: DesignIntent | null,
  billInsights?: BillInsights | null,
  engOpts?: {
    electricityRate?: number | null;
    rateSource?: 'bill-derived' | 'electric-subtotal' | 'utility-db' | 'manual' | 'unknown';
    utilityName?: string | null;
    monthlyKwh?: number | null;
    annualKwh?: number | null;
    documentProvenance?: DocumentProvenanceBundle | null;
    decisionProvenance?: EngineeringDecisionEvaluationBundle | null;
    /** Explicit opt-in only. Disabled by default. Adds non-authoritative APP-CAD preview appendix. */
    cadAppendixPreviewV1?: boolean;
  } | null,
): PlanSetSheets {
  // ── STEP 10: Validate before any rendering ──
  assertValidPlanSet(cad, systemType);

  // ── STEP 1: Build RenderContext ──
  const ctx = buildRenderContext(cad, {
    billInsights:    billInsights ?? null,
    electricityRate: engOpts?.electricityRate ?? null,
    rateSource:      engOpts?.rateSource,
    utilityName:     engOpts?.utilityName ?? null,
    monthlyKwh:      engOpts?.monthlyKwh ?? null,
    annualKwh:       engOpts?.annualKwh ?? null,
    documentProvenance: engOpts?.documentProvenance ?? null,
    decisionProvenance: engOpts?.decisionProvenance ?? null,
  });

  console.log(`[renderPlanSet] ✓ validated ${systemType} — ${cad.totalPanels} panels / ${cad.totalDcKw.toFixed(2)} kW DC hasBillInsights=${ctx.billInsights !== null}`);

  // ── STEP 2: Hard system mode routing ──
  const basePlanSet = (() => {
    switch (systemType) {
      case 'solar_fence':
        return renderFenceSheets(cad, input, intent, ctx);
      case 'ground_mount':
        return renderGroundSheets(cad, input, intent, ctx);
      case 'roof':
        return renderRoofSheets(cad, input, intent, ctx);
      default:
        throw new Error(`[renderPlanSet] Unhandled systemType: "${systemType}"`);
    }
  })();

  return engOpts?.cadAppendixPreviewV1 === true
    ? withCADAppendixPreviewV1(basePlanSet, cad, systemType)
    : basePlanSet;
}

// ── FENCE: Elevation is mandatory PRIMARY ────────────────────────────────────
// STEP 2 — FENCE MODE:
//   PRIMARY:   PV-3 Elevation (mandatory — shows post/panel/rail structure)
//   SECONDARY: PV-2 Site plan (top-down segment layout)
//   No roof terminology. No array terminology. No rafter terminology.

function renderFenceSheets(
  cad: CADModel,
  input: DraftingInput,
  intent?: DesignIntent | null,
  ctx?: RenderContext,
): PlanSetSheets {
  const sheets: Record<string, string> = {};

  // PRIMARY: Fence elevation (structural)
  sheets['PV-3'] = drawFenceElevation(input, intent, cad, ctx);

  // SECONDARY: Fence site plan (segment map)
  sheets['PV-2'] = drawFencePlan(input, intent, cad, ctx);

  return buildResult(sheets, 'solar_fence', cad, ctx);
}

// ── GROUND: Row-based layout + elevation ─────────────────────────────────────
// STEP 2 — GROUND MODE:
//   PRIMARY:   PV-2 Array plan (row-based grid, named segments)
//   SECONDARY: PV-3 Pile structural elevation
//   No roof planes. No fence/post terminology.

function renderGroundSheets(
  cad: CADModel,
  input: DraftingInput,
  intent?: DesignIntent | null,
  ctx?: RenderContext,
): PlanSetSheets {
  const sheets: Record<string, string> = {};

  // PRIMARY: Ground array plan
  sheets['PV-2'] = drawGroundArray(input, intent, cad, ctx);

  // SECONDARY: Structural pile elevation
  sheets['PV-3'] = drawGroundStructural(input, intent, cad, ctx);

  return buildResult(sheets, 'ground_mount', cad, ctx);
}

// ── ROOF: Top-down GPS plan is primary ───────────────────────────────────────
// STEP 2 — ROOF MODE:
//   PRIMARY:   PV-2 Roof plan (top-down, GPS-accurate panel positions)
//   SECONDARY: PV-3 Attachment cross-section + detail
//   No posts. No fence/ground terminology.

function renderRoofSheets(
  cad: CADModel,
  input: DraftingInput,
  intent?: DesignIntent | null,
  ctx?: RenderContext,
): PlanSetSheets {
  const sheets: Record<string, string> = {};

  // PRIMARY: Roof array plan
  sheets['PV-2'] = drawRoofPlan(input, intent, cad, ctx);

  // SECONDARY: Structural attachment detail
  sheets['PV-3'] = drawRoofStructural(input, intent, cad, ctx);

  return buildResult(sheets, 'roof', cad, ctx);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function withCADAppendixPreviewV1(
  planSet: PlanSetSheets,
  cad: CADModel,
  systemType: SystemType,
): PlanSetSheets {
  const appendixSheetId: string = CAD_APPENDIX_PREVIEW_SHEET_ID;
  if (appendixSheetId === 'PV-2' || appendixSheetId === 'PV-3') {
    throw new Error('[renderPlanSet] CAD appendix preview cannot use production PV-2/PV-3 sheet ids.');
  }
  if (Object.prototype.hasOwnProperty.call(planSet.sheets, CAD_APPENDIX_PREVIEW_SHEET_ID)) {
    throw new Error(`[renderPlanSet] CAD appendix preview sheet id collision: ${CAD_APPENDIX_PREVIEW_SHEET_ID}`);
  }

  try {
    const exportBundle = buildCADModelExportBundle(cad, {
      exportedAt: '1970-01-01T00:00:00.000Z',
      exportedBy: 'renderPlanSet.cadAppendixPreviewV1',
      exportReason: 'plan-set-cad-appendix-preview-v1',
    });
    const svgArtifact = buildCADSvgArtifactPreview(exportBundle);
    const appendixSheet = buildPlanSetCADAppendixPreviewSheetV1({
      exportBundle,
      svgArtifact,
      renderingWarnings: planSet.warnings,
    });

    return {
      ...planSet,
      sheets: {
        ...planSet.sheets,
        [CAD_APPENDIX_PREVIEW_SHEET_ID]: renderPlanSetCADAppendixPreviewSheetV1(appendixSheet),
      },
    };
  } catch (error) {
    console.warn(
      `[renderPlanSet] CAD appendix preview omitted for ${systemType}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return planSet;
  }
}

function buildResult(
  sheets: Record<string, string>,
  systemType: SystemType,
  cad: CADModel,
  ctx?: RenderContext,
): PlanSetSheets {
  // Build a minimal context if none was provided (backward compat)
  const renderContext = ctx ?? buildRenderContext(cad);
  return {
    sheets,
    systemType,
    totalPanels:   cad.totalPanels,
    totalDcKw:     cad.totalDcKw,
    warnings:      cad.warnings || [],
    renderContext,
  };
}