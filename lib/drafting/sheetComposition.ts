// ============================================================
// SolarPro Drafting Engine — Sheet Composition Engine
// lib/drafting/sheetComposition.ts
//
// STEP 1: getSheetComposition(systemType, viewType)
//
// Returns a SheetComposition that drives:
//   • which drawing function is the PRIMARY view
//   • layout CSS class + flex percentages
//   • data section definitions (system-specific fields)
//   • validation rules (what must be present)
//
// FENCE:  elevation_dominant — elevation IS the primary view
// GROUND: split_view         — array plan + row elevation side-by-side
// ROOF:   plan_dominant      — top-down GPS plan is primary
//
// ALL VALUES ARE CAD-DRIVEN. Helpers extract from CADModel.
// ============================================================

import type { CADModel } from '../cad/types';

export type SysType = 'roof' | 'ground_mount' | 'solar_fence';
export type ViewType = 'plan' | 'structural';

// ── Layout modes ────────────────────────────────────────────────────────────
export type LayoutMode =
  | 'elevation_dominant'  // fence: 78% elevation, 22% data
  | 'plan_dominant'       // roof: 82% plan, 18% data
  | 'split_view';         // ground: 65% plan/elev, 35% data

// ── Data row ────────────────────────────────────────────────────────────────
export interface DataRow {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean; // red/warning row
}

// ── Callout row ─────────────────────────────────────────────────────────────
export interface CalloutItem {
  n: number;
  label: string;
  sub?: string;
}

// ── Primary view identifiers ──────────────────────────────────────────────────
export type PrimaryViewId =
  | 'fence_elevation'     // fence: side-on structural elevation
  | 'fence_structural'    // fence: post/embed structural detail
  | 'roof_plan'           // roof: top-down GPS array plan
  | 'roof_cross_section'  // roof: cross-section attachment detail
  | 'ground_plan'         // ground: top-down array site plan
  | 'ground_elevation';   // ground: pile elevation structural detail

// ── Secondary view identifiers ────────────────────────────────────────────────
export type SecondaryViewId =
  | 'segment_plan'        // fence: top-down segment map
  | 'footing_detail'      // fence/ground: post footing cross-section
  | 'setbacks'            // roof: fire setback overlay
  | 'obstructions'        // roof: roof obstruction map
  | 'planes'              // roof: roof plane geometry
  | 'attachment_detail'   // roof: L-foot/lag detail cross-section
  | 'row_layout'          // ground: row spacing diagram
  | 'pier_detail';        // ground: pier/pile detail

// ── Data section identifiers ──────────────────────────────────────────────────
export type DataSectionId =
  | 'fence_metrics'
  | 'panel_layout'
  | 'callouts'
  | 'wind_load'
  | 'embedment'
  | 'materials'
  | 'roof_metrics'
  | 'array_summary'
  | 'fire_setbacks'
  | 'pitch'
  | 'azimuth'
  | 'attachment_spacing'
  | 'rail_system'
  | 'row_spacing'
  | 'tilt'
  | 'system_size'
  | 'foundation_depth'
  | 'utility_analysis';

// ── Sheet composition ─────────────────────────────────────────────────────────
export interface SheetComposition {
  /** system type */
  systemType: SysType;
  /** plan | structural */
  viewType: ViewType;
  /** sheet identifier e.g. "PV-2", "PV-3" */
  sheetId: string;
  /** primary drawing view — EXPLICITLY bound, no fallback */
  primaryView: PrimaryViewId;
  /** secondary drawing views (rendered as strip below primary) */
  secondaryViews: SecondaryViewId[];
  /** data sections to populate in the data zone */
  dataSections: DataSectionId[];
  /** CSS layout mode class */
  layout: LayoutMode;
  /** draw zone flex percentage (0–100) */
  drawPct: number;
  /** data zone flex percentage (0–100) */
  dataPct: number;
  /** header text for the draw zone */
  drawHeader: string;
  /** secondary strip header (if secondaryViews present) */
  secondaryHeader?: string;
  /** data section title */
  dataTitle: string;
  /** system-specific data rows (CAD-driven) */
  dataRows: DataRow[];
  /** callout schedule items */
  callouts: CalloutItem[];
  /** validation: what must be present */
  requires: string[];
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function getSheetComposition(
  systemType: SysType,
  viewType: ViewType,
  cad: CADModel,
  input?: {
    project?: Record<string, unknown>;
    system?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    compliance?: Record<string, unknown>;
  },
): SheetComposition {
  switch (systemType) {
    case 'solar_fence':
      return fenceComposition(viewType, cad, input);
    case 'ground_mount':
      return groundComposition(viewType, cad, input);
    case 'roof':
      return roofComposition(viewType, cad, input);
    default: {
      const _never: never = systemType;
      throw new Error(`[getSheetComposition] Unknown systemType: "${String(_never)}"`);
    }
  }
}

// ── Layout CSS builder ───────────────────────────────────────────────────────

/**
 * Returns the CSS flex sizing string for the draw zone and data zone.
 * Use as: style="flex: 0 0 ${comp.drawPct}%"
 */
export function buildLayoutFromComposition(comp: SheetComposition): {
  drawStyle: string;
  dataStyle: string;
  pageDrawClass: string;
} {
  return {
    drawStyle:    `flex: 0 0 ${comp.drawPct}%; max-width: ${comp.drawPct}%;`,
    dataStyle:    `flex: 0 0 ${comp.dataPct}%; max-width: ${comp.dataPct}%;`,
    pageDrawClass: `page-draw layout-${comp.layout.replace(/_/g, '-')}`,
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface SheetValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * validateSheetComposition — STEP 7
 * Ensures the CAD model satisfies the composition requirements.
 * fence must have elevation data, roof must have setbacks, ground must have elevation.
 */
export function validateSheetComposition(
  systemType: SysType,
  cad: CADModel,
): SheetValidationResult {
  const errors: string[] = [];

  switch (systemType) {
    case 'solar_fence':
      if (!cad.fence) {
        errors.push('solar_fence: cad.fence is missing — elevation cannot render');
      } else {
        if (!cad.fence.segments || cad.fence.segments.length === 0) {
          errors.push('solar_fence: cad.fence.segments is empty — elevation requires ≥1 segment');
        }
        if (!cad.fence.totalLengthM || cad.fence.totalLengthM <= 0) {
          errors.push('solar_fence: cad.fence.totalLengthM ≤ 0 — elevation cannot render without length');
        }
      }
      break;

    case 'ground_mount':
      if (!cad.ground) {
        errors.push('ground_mount: cad.ground is missing — elevation cannot render');
      } else {
        if (!cad.ground.arrays || cad.ground.arrays.length === 0) {
          errors.push('ground_mount: cad.ground.arrays is empty — requires ≥1 array');
        } else {
          const arr = cad.ground.arrays[0];
          if (!arr.pileDepthM || arr.pileDepthM <= 0) {
            errors.push('ground_mount: cad.ground.arrays[0].pileDepthM ≤ 0 — structural requires pile depth');
          }
        }
      }
      break;

    case 'roof':
      if (!cad.roof) {
        errors.push('roof: cad.roof is missing — setbacks cannot render');
      } else {
        if (!cad.roof.planes || cad.roof.planes.length === 0) {
          errors.push('roof: cad.roof.planes is empty — plan requires ≥1 plane with setbacks');
        } else {
          const plane = cad.roof.planes[0];
          if (!plane.polygon || plane.polygon.length < 3) {
            errors.push('roof: cad.roof.planes[0].polygon has < 3 vertices — setback geometry invalid');
          }
        }
      }
      break;
  }

  return { valid: errors.length === 0, errors };
}

// ── Hard-throw validation (Step 8) ───────────────────────────────────────────
/**
 * validateSheet — throws if the composition/systemType pairing is invalid.
 * Called before every render to prevent wrong-system drawings from rendering.
 */
export function validateSheet(systemType: SysType, composition: SheetComposition): void {
  if (systemType !== composition.systemType) {
    throw new Error(
      `[validateSheet] systemType mismatch: caller="${systemType}" composition="${composition.systemType}"`,
    );
  }
  if (systemType === 'solar_fence' && composition.primaryView !== 'fence_elevation' && composition.primaryView !== 'fence_structural') {
    throw new Error(
      `[validateSheet] Fence must render fence_elevation or fence_structural — got "${composition.primaryView}"`,
    );
  }
  if (systemType === 'roof' && composition.primaryView !== 'roof_plan' && composition.primaryView !== 'roof_cross_section') {
    throw new Error(
      `[validateSheet] Roof must render roof_plan or roof_cross_section — got "${composition.primaryView}"`,
    );
  }
  if (systemType === 'ground_mount' && composition.primaryView !== 'ground_plan' && composition.primaryView !== 'ground_elevation') {
    throw new Error(
      `[validateSheet] Ground must render ground_plan or ground_elevation — got "${composition.primaryView}"`,
    );
  }
}

// ── CAD data extractors ───────────────────────────────────────────────────────

function mToFt(m: number): number {
  return Math.round(m * 3.28084 * 10) / 10;
}
function mToFtIn(m: number): string {
  const totalIn = m * 39.3701;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn % 12);
  return inches === 0 ? `${ft}'` : `${ft}'-${inches}"`;
}

export function getFenceData(cad: CADModel, input?: Record<string, unknown>): {
  totalLenFt: number;
  segmentCount: number;
  panelHeightFt: number;
  postSpacingFt: number;
  embedFt: number;
  railCount: number;
  windSpeedMph: number;
} {
  const f  = cad.fence;
  const p  = (input?.project ?? {}) as Record<string, unknown>;
  const c  = ((input?.compliance ?? {}) as Record<string, unknown>);
  const cs = ((c?.structural ?? {}) as Record<string, unknown>);
  const cw = ((cs?.wind ?? {}) as Record<string, unknown>);

  return {
    totalLenFt:   f?.totalLengthM  ? mToFt(f.totalLengthM)  : 0,
    segmentCount: f?.segments?.length ?? 0,
    panelHeightFt: f?.panelHeightM ? mToFt(f.panelHeightM)  : ((p?.fencePanelHeightFt as number) || 5.5),
    postSpacingFt: f?.postSpacingM ? mToFt(f.postSpacingM)  : ((p?.fencePostSpacingFt as number) || 8),
    embedFt:       f?.postEmbedM   ? mToFt(f.postEmbedM)    : ((p?.fencePostEmbedmentFt as number) || 2.5),
    railCount:     f?.railCount    ?? 2,
    windSpeedMph:  (cw?.windSpeed as number) || (p?.ahjWindSpeedMph as number) || 115,
  };
}

export function getGroundData(cad: CADModel, input?: Record<string, unknown>): {
  rowCount: number;
  panelsPerRow: number;
  tiltDeg: number;
  azimuthDeg: number;
  rowSpacingFt: number;
  groundClearIn: number;
  pileDepthFt: number;
  pileSpacingFt: number;
  structureType: string;
  setbackFt: number;
  windSpeedMph: number;
  snowPsf: number;
} {
  const g   = cad.ground;
  const arr = g?.arrays?.[0];
  const p   = (input?.project ?? {}) as Record<string, unknown>;
  const lay = (input?.layout  ?? {}) as Record<string, unknown>;
  const gArrs = (lay?.groundArrays as Record<string, unknown>[])?.[0] ?? {};
  const c   = ((input?.compliance ?? {}) as Record<string, unknown>);
  const cs  = ((c?.structural ?? {}) as Record<string, unknown>);
  const cw  = ((cs?.wind ?? {}) as Record<string, unknown>);

  return {
    rowCount:      arr?.dimensions?.rowCount     ?? (gArrs?.rowCount as number)     ?? 4,
    panelsPerRow:  arr?.dimensions?.panelsPerRow ?? (gArrs?.panelsPerRow as number) ?? 5,
    tiltDeg:       arr?.tiltDeg                 ?? (gArrs?.tiltDeg as number)       ?? 20,
    azimuthDeg:    arr?.azimuth                 ?? (gArrs?.azimuth as number)       ?? 180,
    rowSpacingFt:  arr?.rowSpacingM             ? mToFt(arr.rowSpacingM)            : ((gArrs?.rowSpacingFt as number) || 10),
    groundClearIn: arr?.groundClearanceM        ? Math.round(arr.groundClearanceM * 39.3701) : ((gArrs?.groundClearanceIn as number) || 18),
    pileDepthFt:   arr?.pileDepthM              ? mToFt(arr.pileDepthM)             : ((gArrs?.pileDepthFt as number) || 5),
    pileSpacingFt: arr?.pileSpacingM            ? mToFt(arr.pileSpacingM)           : ((gArrs?.pileSpacingFt as number) || 8),
    structureType: (arr?.structureType         ?? (gArrs?.structureType as string)  ?? 'DRIVEN PILE').toString().toUpperCase().replace(/_/g,' '),
    setbackFt:     g?.setbackFt                ?? ((lay?.groundSetbackFt as number) || 5),
    windSpeedMph:  (cw?.windSpeed as number)   || (p?.ahjWindSpeedMph as number)   || 115,
    snowPsf:       (p?.ahjGroundSnowPsf as number) || 0,
  };
}

export function getRoofData(cad: CADModel, input?: Record<string, unknown>): {
  pitchStr: string;
  azimuthDeg: number;
  setbackFt: number;
  roofType: string;
  mountSys: string;
  rafterSize: string;
  rafterSpacing: number;
  attachSpacing: number;
  conduitType: string;
  windSpeedMph: number;
  totalPanels: number;
  dcKw: string;
} {
  const r   = cad.roof;
  const pl  = r?.planes?.[0];
  const p   = (input?.project ?? {}) as Record<string, unknown>;
  const c   = ((input?.compliance ?? {}) as Record<string, unknown>);
  const cs  = ((c?.structural ?? {}) as Record<string, unknown>);
  const cw  = ((cs?.wind ?? {}) as Record<string, unknown>);

  const pitchNum = (pl?.pitch ?? (p?.roofPitch as number) ?? 5);

  return {
    pitchStr:      `${pitchNum}:12`,
    azimuthDeg:    pl?.azimuth   ?? (p?.roofAzimuth as number)    ?? 180,
    setbackFt:     pl?.setbacks?.eaveM ? mToFt(pl.setbacks.eaveM) : ((p?.fireSetbackFt as number) ?? 3),
    roofType:      ((p?.roofType as string) || 'SHINGLE').toUpperCase(),
    mountSys:      ((p?.mountingSystem as string) || 'IRONRIDGE XR100').toUpperCase(),
    rafterSize:    ((p?.rafterSize as string) || '2x6'),
    rafterSpacing: (p?.rafterSpacing as number) || 24,
    attachSpacing: (p?.attachmentSpacing as number) || 48,
    conduitType:   ((p?.conduitType as string) || 'EMT').toUpperCase(),
    windSpeedMph:  (cw?.windSpeed as number) || (p?.ahjWindSpeedMph as number) || 115,
    totalPanels:   cad.totalPanels ?? 0,
    dcKw:          (cad.totalDcKw ?? 0).toFixed(2),
  };
}

// ── System compositions ───────────────────────────────────────────────────────

function fenceComposition(
  viewType: ViewType,
  cad: CADModel,
  input?: Record<string, unknown>,
): SheetComposition {
  const d = getFenceData(cad, input);
  const isPlan = viewType === 'plan';

  const dataRows: DataRow[] = isPlan
    ? [
        { label: 'TOTAL LENGTH',   value: `${d.totalLenFt} L.F.`,          bold: true },
        { label: 'SEGMENTS',       value: `${d.segmentCount}` },
        { label: 'PANEL HEIGHT',   value: `${d.panelHeightFt}' H` },
        { label: 'POST SPACING',   value: `${d.postSpacingFt}' O.C.` },
        { label: 'POST EMBEDMENT', value: `${d.embedFt}' MIN` },
        { label: 'RAIL COUNT',     value: `${d.railCount} RAILS` },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'WIND FORCE Cf',  value: '1.3 (ASCE 7-22 §29)' },
        { label: 'EXPOSURE CAT',   value: 'C — OPEN TERRAIN' },
        { label: 'MODULES',        value: `${cad.totalPanels ?? 0} @ ${(cad.totalDcKw ?? 0).toFixed(2)} kWdc`, bold: true },
      ]
    : [
        { label: 'TOTAL LENGTH',   value: `${d.totalLenFt} L.F.`,          bold: true },
        { label: 'POST SPACING',   value: `${d.postSpacingFt}' O.C.` },
        { label: 'POST EMBEDMENT', value: `${d.embedFt}' MIN`,             bold: true, highlight: true },
        { label: 'PANEL HEIGHT',   value: `${d.panelHeightFt}' H` },
        { label: 'RAIL COUNT',     value: `${d.railCount} RAILS` },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'WIND FORCE Cf',  value: '1.3 (ASCE 7-22 §29)' },
        { label: 'EXPOSURE CAT',   value: 'C — OPEN TERRAIN' },
        { label: 'DESIGN CODE',    value: 'ASCE 7-22 / IBC 2021' },
        { label: 'MODULES',        value: `${cad.totalPanels ?? 0} @ ${(cad.totalDcKw ?? 0).toFixed(2)} kWdc`, bold: true },
      ];

  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'FENCE SEGMENT', sub: 'PV modules mounted vertically' },
        { n: 2, label: 'FENCE POST', sub: `steel pipe @ ${d.postSpacingFt}' O.C.` },
        { n: 3, label: 'GATE OPENING', sub: 'structural post each side' },
        { n: 4, label: 'AZIMUTH LABEL', sub: 'panel face direction' },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: 'vertical bifacial mounting' },
        { n: 2, label: 'TOP RAIL', sub: `${d.railCount === 1 ? '1 RAIL' : d.railCount + ' RAILS'} — aluminum extrusion` },
        { n: 3, label: 'FENCE POST', sub: `${d.embedFt}' embedment min` },
        { n: 4, label: 'GRADE LINE', sub: 'field-verified elevation' },
        { n: 5, label: 'WIND ARROWS', sub: `${d.windSpeedMph} MPH Vult — ASCE 7-22 §29` },
      ];

  return {
    systemType:     'solar_fence',
    viewType,
    sheetId:        isPlan ? 'PV-2' : 'PV-3',
    // GOLD STANDARD: fence ALWAYS uses elevation as primary view
    primaryView:    isPlan ? 'fence_elevation' : 'fence_structural',
    secondaryViews: isPlan ? ['segment_plan'] : ['footing_detail'],
    dataSections:   isPlan
      ? ['fence_metrics', 'panel_layout', 'callouts']
      : ['wind_load', 'embedment', 'materials'],
    layout:         'elevation_dominant',
    drawPct:        78,
    dataPct:        22,
    drawHeader:     isPlan
      ? `SOLAR FENCE ELEVATION — ${d.totalLenFt} L.F. TOTAL | ${d.segmentCount} SEGMENTS | POST @ ${d.postSpacingFt}' O.C. | WIND: ${d.windSpeedMph} MPH`
      : `FENCE STRUCTURAL ELEVATION — POST EMBED: ${d.embedFt}' MIN | WIND: ${d.windSpeedMph} MPH Vult | ASCE 7-22`,
    secondaryHeader: isPlan ? 'SEGMENT PLAN — TOP VIEW' : 'FOOTING DETAIL — NTS',
    dataTitle:      isPlan ? 'FENCE DATA' : 'STRUCTURAL DATA',
    dataRows,
    callouts,
    requires:       ['fence', 'fence.segments', 'fence.totalLengthM'],
  };
}

function groundComposition(
  viewType: ViewType,
  cad: CADModel,
  input?: Record<string, unknown>,
): SheetComposition {
  const d = getGroundData(cad, input);
  const isPlan = viewType === 'plan';

  const dataRows: DataRow[] = isPlan
    ? [
        { label: 'ROWS',           value: `${d.rowCount}`,                  bold: true },
        { label: 'PANELS/ROW',     value: `${d.panelsPerRow}` },
        { label: 'TILT ANGLE',     value: `${d.tiltDeg}°`,                  bold: true },
        { label: 'AZIMUTH',        value: `${d.azimuthDeg}° (${azLabel(d.azimuthDeg)})` },
        { label: 'ROW SPACING',    value: `${d.rowSpacingFt}' O.C.` },
        { label: 'GND CLEARANCE',  value: `${d.groundClearIn}" MIN` },
        { label: 'STRUCTURE',      value: d.structureType },
        { label: 'PROPERTY SETBK', value: `${d.setbackFt}'` },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'MODULES',        value: `${cad.totalPanels ?? 0} @ ${(cad.totalDcKw ?? 0).toFixed(2)} kWdc`, bold: true },
      ]
    : [
        { label: 'STRUCTURE TYPE', value: d.structureType,                  bold: true },
        { label: 'PILE DEPTH',     value: `${d.pileDepthFt}' MIN`,          bold: true, highlight: true },
        { label: 'PILE SPACING',   value: `${d.pileSpacingFt}' O.C.` },
        { label: 'GND CLEARANCE',  value: `${d.groundClearIn}" MIN` },
        { label: 'TILT ANGLE',     value: `${d.tiltDeg}°` },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        ...(d.snowPsf > 0 ? [{ label: 'SNOW LOAD', value: `${d.snowPsf} PSF` }] : []),
        { label: 'DESIGN CODE',    value: 'ASCE 7-22 / IBC 2021' },
        { label: 'VERIFY',         value: 'GEOTECH RPT REQ\'D',             bold: true, highlight: true },
      ];

  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'MODULE ROW', sub: `${d.panelsPerRow} modules @ ${d.tiltDeg}° tilt` },
        { n: 2, label: 'GROUND LINE', sub: 'grade elevation reference' },
        { n: 3, label: 'TILT INDICATOR', sub: `${d.tiltDeg}° array tilt` },
        { n: 4, label: 'SETBACK LINE', sub: `${d.setbackFt}' property setback` },
        { n: 5, label: 'PILE LOCATION', sub: d.structureType },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: `${d.tiltDeg}° tilt` },
        { n: 2, label: 'PILE / POST', sub: d.structureType },
        { n: 3, label: 'EMBEDMENT', sub: `${d.pileDepthFt}' min below grade` },
        { n: 4, label: 'GRADE LINE', sub: `${d.groundClearIn}" clearance min` },
      ];

  return {
    systemType:     'ground_mount',
    viewType,
    sheetId:        isPlan ? 'PV-2' : 'PV-3',
    primaryView:    isPlan ? 'ground_plan' : 'ground_elevation',
    secondaryViews: isPlan ? ['row_layout'] : ['pier_detail'],
    dataSections:   isPlan
      ? ['row_spacing', 'tilt', 'system_size']
      : ['foundation_depth', 'wind_load'],
    layout:         'split_view',
    drawPct:        65,
    dataPct:        35,
    drawHeader:     isPlan
      ? `GROUND ARRAY PLAN — ${d.rowCount} ROWS × ${d.panelsPerRow} MOD/ROW | TILT: ${d.tiltDeg}° | AZ: ${d.azimuthDeg}° | ROW SPACING: ${d.rowSpacingFt}'`
      : `PILE ELEVATION — ${d.structureType} | EMBED: ${d.pileDepthFt}' MIN | PILE @ ${d.pileSpacingFt}' O.C. | WIND: ${d.windSpeedMph} MPH`,
    secondaryHeader: isPlan ? 'ROW SPACING DIAGRAM' : 'PIER / PILE DETAIL — NTS',
    dataTitle:      isPlan ? 'ARRAY DATA' : 'STRUCTURAL DATA',
    dataRows,
    callouts,
    requires:       isPlan
      ? ['ground', 'ground.arrays']
      : ['ground', 'ground.arrays', 'ground.arrays[0].pileDepthM'],
  };
}

function roofComposition(
  viewType: ViewType,
  cad: CADModel,
  input?: Record<string, unknown>,
): SheetComposition {
  const d = getRoofData(cad, input);
  const isPlan = viewType === 'plan';

  const dataRows: DataRow[] = isPlan
    ? [
        { label: 'MODULE',         value: 'SEE EQUIPMENT SCHEDULE' },
        { label: 'INVERTER',       value: 'SEE EQUIPMENT SCHEDULE' },
        { label: 'MOUNTING',       value: d.mountSys },
        { label: 'ROOF TYPE',      value: d.roofType },
        { label: 'PITCH',          value: d.pitchStr,                        bold: true },
        { label: 'AZIMUTH',        value: `${d.azimuthDeg}° (${azLabel(d.azimuthDeg)})` },
        { label: 'FIRE SETBACK',   value: `${d.setbackFt}' — ALL EDGES`,    bold: true },
        { label: 'RAFTER',         value: `${d.rafterSize} @ ${d.rafterSpacing}" O.C.` },
        { label: 'ATTACH SPACING', value: `${d.attachSpacing}" O.C. MAX` },
        { label: 'MODULES',        value: `${d.totalPanels} @ ${d.dcKw} kWdc`, bold: true },
      ]
    : [
        { label: 'MOUNTING SYS',   value: d.mountSys },
        { label: 'RAFTER SIZE',    value: d.rafterSize },
        { label: 'RAFTER SPACING', value: `${d.rafterSpacing}" O.C.` },
        { label: 'ATTACH SPACING', value: `${d.attachSpacing}" O.C. MAX`,   bold: true },
        { label: 'LAG BOLT',       value: '3/8" DIA × 3" MIN SS' },
        { label: 'EMBEDMENT',      value: '2-1/2" MIN INTO RAFTER',         bold: true, highlight: true },
        { label: 'ROOF TYPE',      value: d.roofType },
        { label: 'HARDWARE',       value: '316 S.S. THROUGHOUT' },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'DESIGN CODE',    value: 'ASCE 7-22 / NEC 690.43' },
      ];

  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'PV MODULE ARRAY', sub: `${d.totalPanels} mod @ ${d.dcKw} kW DC` },
        { n: 2, label: `${d.setbackFt}' FIRE SETBACK`, sub: 'all roof edges & ridge — IFC §605.11.6' },
        { n: 3, label: 'RIDGE LINE', sub: `${d.pitchStr} pitch` },
        { n: 4, label: 'CONDUIT RUN', sub: `route field-verified — ${d.conduitType}` },
        { n: 5, label: 'ATTACHMENT ZONE', sub: `L-foot @ ${d.attachSpacing}" O.C. into rafters` },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: 'see equipment schedule' },
        { n: 2, label: 'MOUNTING RAIL', sub: d.mountSys },
        { n: 3, label: 'STANDOFF / L-FOOT', sub: '3/8" SS LAG @ 2.5" embed' },
        { n: 4, label: 'FLASHING', sub: 'under all penetrations' },
        { n: 5, label: `RAFTER ${d.rafterSize}`, sub: `@ ${d.rafterSpacing}" O.C.` },
        { n: 6, label: d.conduitType + ' CONDUIT', sub: 'see conductor schedule' },
        { n: 7, label: 'BONDING JUMPER', sub: 'NEC 690.43' },
      ];

  return {
    systemType:     'roof',
    viewType,
    sheetId:        isPlan ? 'PV-2' : 'PV-3',
    primaryView:    isPlan ? 'roof_plan' : 'roof_cross_section',
    secondaryViews: isPlan ? ['setbacks', 'obstructions'] : ['attachment_detail' as SecondaryViewId],
    dataSections:   isPlan
      ? ['roof_metrics', 'array_summary', 'fire_setbacks']
      : ['attachment_spacing', 'rail_system'],
    layout:         'plan_dominant',
    drawPct:        82,
    dataPct:        18,
    drawHeader:     isPlan
      ? `ROOF PLAN — ${d.totalPanels} MOD @ ${d.dcKw} kWdc | ${d.roofType} ROOF @ ${d.pitchStr} | AZ: ${d.azimuthDeg}° | ${d.mountSys}`
      : `ATTACHMENT DETAIL — ${d.mountSys} | ${d.rafterSize} @ ${d.rafterSpacing}" O.C. | ATTACH: ${d.attachSpacing}" O.C. MAX`,
    secondaryHeader: isPlan ? 'SETBACK & OBSTRUCTION OVERLAY' : 'ATTACHMENT DETAIL — NTS',
    dataTitle:      isPlan ? 'SYSTEM DATA' : 'ATTACHMENT SPECS',
    dataRows,
    callouts,
    requires:       isPlan
      ? ['roof', 'roof.planes', 'roof.planes[0].polygon']
      : ['roof', 'roof.planes'],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function azLabel(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx   = Math.round(deg / 22.5) % 16;
  return dirs[idx] ?? 'S';
}