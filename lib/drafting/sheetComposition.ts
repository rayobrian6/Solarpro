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
import { getMountingSystemById } from '../mounting-hardware-db';
import { resolveFireSetbackIn, arrayCoverageFrac } from '../permit/utils/fireSetback';

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
  fireSetbackFt: number;
  pathwayFt: number;
  roofType: string;
  mountSys: string;
  rafterSize: string;
  rafterSpacing: number;
  isTruss: boolean;
  attachSpacing: number;
  lagSpec: string;
  embedSpec: string;
  azimuthLabel: string;
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

  // pl?.pitch comes from canonicalBridge which stores pitchDegrees (e.g., 22°).
  // The permit format requires rise-per-12-inches (e.g., 5:12), so we must convert
  // degrees → ratio using tan(degrees) * 12.  A value already in rise-per-12
  // (e.g., 5) would yield tan(5°)*12 ≈ 1.05 which is clearly wrong as a degree
  // value, so we can detect the mismatch: if pitchNum ≤ 12 it is almost certainly
  // already in degrees (roof pitches above 12:12 = 45° are extremely rare).
  const rawPitch = (pl?.pitch ?? (p?.roofPitch as number) ?? 5);
  // Align with the documented heuristic: values <=12 are almost certainly already
  // a rise-per-12 ratio (e.g. 5:12); only 12<x<=90 is treated as degrees. The old
  // <=90 threshold tan-converted a 5:12 ratio into a bogus 1:12.
  const isDegrees = rawPitch > 12 && rawPitch <= 90;
  const pitchRatio = isDegrees
    ? Math.round(Math.tan(rawPitch * Math.PI / 180) * 12 * 10) / 10
    : rawPitch;

  // Fire setbacks — CORRECT AHJ DATABASE SEMANTICS (per the IFC table behind
  // applyCodeBasis): ahjRidgeSetbackIn = the FIRE SETBACK on roof edges;
  // ahjRoofSetbackIn = the ACCESS PATHWAY width (a designated 36" route, not a
  // uniform edge setback — treating it as one buried the drawing in hatch).
  const _fireIn    = (p?.ahjRidgeSetbackIn as number);
  const _pathwayIn = (p?.ahjRoofSetbackIn as number);
  // Same coverage-aware rule as the DRAWING (resolveFireSetbackIn) — the data
  // zone printed "1.5' EDGES" while the plan hatched 3'-0" bands.
  const _covRoofFt2 = (r?.planes ?? []).reduce((s: number, x: any) => s + (Number(x?.areaSqM) || 0), 0) * 10.7639;
  const _covFrac = arrayCoverageFrac(
    cad?.totalPanels ?? 0,
    (p?.panelLengthIn as number) || 66,
    (p?.panelWidthIn as number) || 40,
    _covRoofFt2,
  );
  const fireSetbackFt = Math.round((resolveFireSetbackIn(_fireIn, _covFrac) / 12) * 10) / 10;
  const pathwayFt     = (_pathwayIn && _pathwayIn > 0) ? Math.round((_pathwayIn / 12) * 10) / 10 : 3;

  // Fastener spec from the SELECTED mounting system so PV-3 can never
  // contradict APP-A/PE-1. Lag LENGTH must physically deliver the embedment:
  // length ≥ embedment + ~1.5" of deck/flashing/foot stack-up — the old
  // static '3" lag / 2-1/2" embedment' pair was impossible to build.
  const _mountSel = (p?.mountingSystemId as string)
    ? getMountingSystemById(p.mountingSystemId as string)
    : undefined;
  const _fracIn = (v: number) =>
    v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
  const _lagDiaIn  = _mountSel?.mount?.fastenerDiameterIn ?? 0.375;
  const _embedIn   = _mountSel?.mount?.fastenerEmbedmentIn ?? 2.5;
  const _lagLenIn  = Math.ceil((_embedIn + 1.5) * 2) / 2;
  const _ca = ((c?.structural ?? {}) as Record<string, any>)?.attachment;
  const _mountName = ((input?.project as any)?._canonical?.mountSystem as string)
    || (p?.mountingSystem as string)
    || (_mountSel ? `${_mountSel.manufacturer} ${_mountSel.model}` : 'IRONRIDGE XR100');

  // Multi-plane azimuth display — a 4-plane N/S/E/W roof must not claim
  // plane[0]'s heading ("Azimuth 3° (N)") as the system azimuth.
  const _azsAll = (r?.planes ?? [])
    .map((x: any) => x?.azimuth)
    .filter((v: any) => isFinite(v))
    .map((v: number) => ((v % 360) + 360) % 360);
  const _azDir = (az: number) => az >= 337.5 || az < 22.5 ? 'N' :
    az < 67.5 ? 'NE' : az < 112.5 ? 'E' : az < 157.5 ? 'SE' :
    az < 202.5 ? 'S' : az < 247.5 ? 'SW' : az < 292.5 ? 'W' : 'NW';
  const _azPrimary = Math.round(pl?.azimuth ?? (p?.roofAzimuth as number) ?? 180);
  const _azDirs = [...new Set(_azsAll.map(_azDir))];
  const azimuthLabel = _azDirs.length > 1
    ? `MULTI — ${_azDirs.join('/')}`
    : `${_azPrimary}° (${_azDir(((_azPrimary % 360) + 360) % 360)})`;

  return {
    pitchStr:      `${pitchRatio}:12`,
    // Round azimuth — was leaking the raw geometry float (e.g. 180.00081202849463°).
    azimuthDeg:    _azPrimary,
    azimuthLabel,
    fireSetbackFt,
    pathwayFt,
    roofType:      ((p?.roofType as string) || 'SHINGLE').toUpperCase(),
    mountSys:      _mountName.toUpperCase(),
    rafterSize:    ((p?.rafterSize as string) || '2x6'),
    rafterSpacing: (p?.rafterSpacing as number) || 24,
    // Framing type mirrors the SAME determination PV-4C/PE-1/CERT use, so PV-3
    // labels the framing consistently with the structural sheets (truss vs stick).
    isTruss: ((c?.structural as any)?.rafter?.framingType === 'truss')
      || (((c?.structural as any)?.rafter?.bendingMoment === 0)
        && (((c?.structural as any)?.rafter?.allowableBendingMoment as number) || 0) > 0),
    // Engineering-resolved spacing first (V4 mount layout — e.g. auto-resolved
    // 36"), then the user's input, then the racking system's rated max.
    attachSpacing: (_ca?.maxAllowedSpacing as number)
      || (p?.attachmentSpacing as number)
      || _mountSel?.mount?.maxSpacingIn
      || 48,
    lagSpec:       `${_fracIn(_lagDiaIn)}" DIA × ${_lagLenIn}" MIN SS`,
    embedSpec:     `${_embedIn}" MIN THREAD EMBEDMENT`,
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
  // RT-Mini (rail-less) runs 48" O.C. STAGGERED, not one foot per module and not
  // the rafter spacing (Ray 2026-07-08). Keep the railed L-foot value as-is.
  const _railless = /RT[- ]?MINI|RAIL-?LESS|ROOF ?TECH/i.test(d.mountSys);
  const _attachDisplay = _railless ? '48" O.C. STAGGERED' : `${d.attachSpacing}" O.C. MAX`;
  const _attachInto = _railless ? 'direct-attach mounts @ 48" O.C. staggered' : `L-foot @ ${d.attachSpacing}" O.C.`;
  // Framing term matches the structural authority (PV-4C/PE-1/CERT) so the set
  // doesn't say "RAFTER" on PV-3 while the calcs certify a pre-engineered truss.
  const _frameLabel = d.isTruss ? 'TRUSS' : 'RAFTER';

  const dataRows: DataRow[] = isPlan
    ? [
        { label: 'MODULE',         value: 'SEE EQUIPMENT SCHEDULE' },
        { label: 'INVERTER',       value: 'SEE EQUIPMENT SCHEDULE' },
        { label: 'MOUNTING',       value: d.mountSys },
        { label: 'ROOF TYPE',      value: d.roofType },
        { label: 'PITCH',          value: d.pitchStr,                        bold: true },
        { label: 'AZIMUTH',        value: d.azimuthLabel },
        { label: 'FIRE SETBACK',   value: `${d.fireSetbackFt}' RIDGE · 18" HIP · ${d.pathwayFt}' PATHWAY`, bold: true },
        { label: 'FRAMING',        value: `${d.rafterSize} @ ${d.rafterSpacing}" O.C.` },
        { label: 'ATTACH SPACING', value: _attachDisplay },
        { label: 'MODULES',        value: `${d.totalPanels} @ ${d.dcKw} kWdc`, bold: true },
      ]
    : [
        { label: 'MOUNTING SYS',   value: d.mountSys },
        { label: `${_frameLabel} SIZE`,    value: d.rafterSize },
        { label: `${_frameLabel} SPACING`, value: `${d.rafterSpacing}" O.C.` },
        { label: 'ATTACH SPACING', value: _attachDisplay,   bold: true },
        { label: 'LAG BOLT',       value: d.lagSpec },
        { label: 'EMBEDMENT',      value: d.embedSpec,                      bold: true, highlight: true },
        { label: 'ROOF TYPE',      value: d.roofType },
        { label: 'HARDWARE',       value: '316 S.S. THROUGHOUT' },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'DESIGN CODE',    value: 'ASCE 7-22 / NEC 690.43' },
      ];

  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'PV MODULE ARRAY', sub: `${d.totalPanels} mod @ ${d.dcKw} kW DC` },
        { n: 2, label: 'FIRE SETBACKS', sub: `${d.fireSetbackFt}' ridge · 18" hip/valley · ${d.pathwayFt}' access pathway — IFC §1204.2 per AHJ` },
        { n: 3, label: 'RIDGE LINE', sub: `${d.pitchStr} pitch` },
        { n: 4, label: 'CONDUIT RUN', sub: `route field-verified — ${d.conduitType}` },
        { n: 5, label: 'ATTACHMENT ZONE', sub: `${_attachInto} into ${_frameLabel.toLowerCase()}s` },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: 'see equipment schedule' },
        { n: 2, label: /RT[- ]?MINI|RAIL-?LESS|ROOF ?TECH/i.test(d.mountSys) ? 'DIRECT-ATTACH MOUNT' : 'MOUNTING RAIL', sub: d.mountSys },
        { n: 3, label: /RT[- ]?MINI|RAIL-?LESS|ROOF ?TECH/i.test(d.mountSys) ? 'MOUNT BASE' : 'STANDOFF / L-FOOT', sub: `${d.lagSpec} — ${d.embedSpec.toLowerCase()}` },
        { n: 4, label: 'FLASHING', sub: 'under all penetrations' },
        { n: 5, label: `${_frameLabel} ${d.rafterSize}`, sub: `@ ${d.rafterSpacing}" O.C.` },
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
      ? `ROOF PLAN — ${d.totalPanels} MOD @ ${d.dcKw} kWdc | ${d.roofType} ROOF @ ${d.pitchStr} | AZ: ${d.azimuthLabel} | ${d.mountSys}`
      : `ATTACHMENT DETAIL — ${d.mountSys} | ${d.rafterSize} @ ${d.rafterSpacing}" O.C. | ATTACH: ${_attachDisplay}`,
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