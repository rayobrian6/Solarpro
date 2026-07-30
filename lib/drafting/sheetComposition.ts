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
import { getMountingSystemById, classifyMountTopology } from '../mounting-hardware-db';
import { getRackingById } from '../equipment-db';
import { resolveFireSetbackIn, arrayCoverageFrac, resolveFireSetbackBasis } from '../permit/utils/fireSetback';
import { projectCodeAuthority } from '../permit/snapshot/codeAuthorityProjection';
// W3 §route-verification — the CONDUIT RUN callout projects the ONE canonical
// route provenance authority (never a hardcoded "route field-verified" literal;
// gate 2: no "field-verified" without a recorded field measurement).
import { routeProvenanceLabel, projectCanonicalFeeder, projectRacewayDescriptor } from '../permit/snapshot/electricalProjection';
import type { PermitDesignSnapshot } from '../permit/snapshot/types';
// PPC §3/§4 — THE fix for the second rendering stack. PV-1/PV-3 no longer read a
// flat `attachSpacing` (a field literally sourced from `maxAllowedSpacing`) nor raw
// mounting-hardware-db fastener rows: they consume the CANONICAL attachment-
// installation authority (SpacingAuthority + FastenerAssembly + document
// applicability + mount/racking states). No MAX/allowable spacing and no exact
// fastener instruction can be composed without verified authority.
import {
  projectAttachmentInstallationAuthority,
  type AttachmentInstallationAuthority,
} from '../permit/snapshot/structuralProjection';
import { getManufacturerAsset } from '../manufacturer-assets-db';
// AAC WS-9 — THE site design-load seam (no wind/snow literal in drafting).
import { resolveSiteDesignLoads } from '../permit/snapshot/siteDesignLoads';
// AAC WS-9 — the ONE document-applicability seam every sheet may use.
import { sheetDocumentApplicability, type EquipmentDocumentAuthority } from '../permit/snapshot/documentAuthority';
import { projectRackingBondingAuthority } from '../permit/snapshot/rackingBonding';

// §3 (closeout 2026-07-23) — the PV-1/PV-3 conduit-run callout descriptor. Every
// conduit description routes through the CANONICAL physical-raceway projection —
// NEVER `project.conduitType || 'EMT'` (the fabricated EMT beside a PVC run). The
// feeder conduit (the run PV-1/PV-3 draw) is the single source; absent raceway
// authority prints an honest 'PENDING — SEE SCHEDULE', never a default 'EMT'.
function canonicalConduitType(snap: PermitDesignSnapshot | null | undefined): string {
  const feed = projectCanonicalFeeder(snap);
  if (feed.raceway) {
    return (feed.tradeSizeIn ? `${feed.raceway} ${feed.tradeSizeIn}` : feed.raceway).toUpperCase();
  }
  const desc = projectRacewayDescriptor(snap);
  if (desc.present && desc.entries.length) {
    const e = desc.entries[0];
    return (e.tradeSizeIn ? `${e.racewayType} ${e.tradeSizeIn}` : e.racewayType).toUpperCase();
  }
  return 'PENDING — SEE SCHEDULE';
}

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
  /** optional GENERAL NOTES rendered below the callout schedule to fill the
   *  data column (kept out of the callout list so bubbles stay drawing-linked) */
  generalNotes?: string[];
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
    // AAC WS-9 — ONE seam, and it states its own basis. No literal here.
    windSpeedMph: resolveSiteDesignLoads({
      snapshot: (input as { _snapshot?: never } | undefined)?._snapshot ?? null,
      complianceWindMph: cw?.windSpeed, ahjWindMph: p?.ahjWindSpeedMph,
    }).windSpeedMph,
  };
}

/** W3 §7 — canonical wind speed from the validated snapshot env (single source).
 *  Null when no snapshot is present (standalone preview); callers fall back to
 *  the existing chain with a documented 115 code-minimum guard. */
function snapWind(input?: Record<string, unknown>): number | null {
  const w = (input as { _snapshot?: { structural?: { env?: { ultimateWindSpeedMph?: number } } } } | undefined)
    ?._snapshot?.structural?.env?.ultimateWindSpeedMph;
  return typeof w === 'number' && isFinite(w) ? w : null;
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
    // Speck PLP POWER DRIVE™ places ONE driven I-beam pylon per BAY at ~20 ft O.C.
    // (engine PLP_BAY_SPAN_M = 6.10). A legacy per-array pile-spacing scalar (often
    // a stale ~8 ft generic default) does NOT describe PLP, so honor a stored value
    // only when it is a plausible PLP bay span (≥ 15 ft); otherwise use the 20 ft
    // engine standard. Keeps the PV-3G detail + STRUCTURAL DATA panel in agreement.
    pileSpacingFt: (() => {
      const v = arr?.pileSpacingM ? mToFt(arr.pileSpacingM) : (gArrs?.pileSpacingFt as number);
      return (typeof v === 'number' && v >= 15) ? Math.round(v) : 20;
    })(),
    structureType: 'DRIVEN PYLON — PLP',
    setbackFt:     g?.setbackFt                ?? ((lay?.groundSetbackFt as number) || 5),
    // W3 §7 — single-sourced from the snapshot env (115 is the standalone guard).
    // AAC WS-9 — ONE seam, basis-stated. No literal in the drafting layer.
    windSpeedMph: resolveSiteDesignLoads({
      snapshot: (input as { _snapshot?: never } | undefined)?._snapshot ?? null,
      complianceWindMph: cw?.windSpeed, ahjWindMph: p?.ahjWindSpeedMph,
    }).windSpeedMph,
    snowPsf:       (p?.ahjGroundSnowPsf as number) || 0,
  };
}

/**
 * KDP (structural math consistency) — THE roof-pitch authority.
 *
 * `cad.roof.planes[0].pitch` is the CAD plane's pitch in DEGREES, produced by
 * canonicalBridge from the surveyed/derived roof geometry. `project.roofPitch`
 * is the operator-entered figure and is NOT the same number: on the live Braidon
 * project the CAD plane is 16.5176° (= 3.6:12) while `project.roofPitch` still
 * reads 20 (= 4.4:12). The geometry the array was laid out on is the CAD plane,
 * so it governs; the project field is the fallback for a package with no plane.
 *
 * The PV-3 cross-section used to read `project.roofPitch` AND round to a whole
 * number, so one sheet printed "4:12 SLOPE" while the cover, the specs table,
 * PV-4C and PE-1 all printed 3.6:12 from this function. Same value, same
 * precision, everywhere — or the sheet is wrong.
 *
 * The degrees-vs-ratio heuristic is preserved verbatim: a value ≤ 12 is almost
 * certainly already rise-per-12 (5:12); only 12 < x ≤ 90 is treated as degrees.
 */
export interface RoofPitchAuthority {
  /** rise per 12 in., rounded to 0.1 — the printed figure */
  ratio: number;
  /** pitch in degrees when the source carried degrees, else null */
  degrees: number | null;
  /** the ONE display string every sheet prints, e.g. '3.6:12' */
  pitchStr: string;
  source: 'cad-plane' | 'project-input' | 'default';
}
export function resolveRoofPitch(
  cad: CADModel | null | undefined,
  input?: Record<string, unknown>,
): RoofPitchAuthority {
  const pl = cad?.roof?.planes?.[0] as { pitch?: number } | undefined;
  const proj = (input?.project ?? {}) as Record<string, unknown>;
  const fromPlane = typeof pl?.pitch === 'number' && isFinite(pl.pitch) ? pl.pitch : null;
  const fromProject = typeof proj?.roofPitch === 'number' && isFinite(proj.roofPitch as number)
    ? (proj.roofPitch as number) : null;
  const raw = fromPlane ?? fromProject ?? 5;
  const source: RoofPitchAuthority['source'] =
    fromPlane != null ? 'cad-plane' : fromProject != null ? 'project-input' : 'default';
  const isDegrees = raw > 12 && raw <= 90;
  const ratio = isDegrees ? Math.round(Math.tan(raw * Math.PI / 180) * 12 * 10) / 10 : raw;
  return { ratio, degrees: isDegrees ? raw : null, pitchStr: `${ratio}:12`, source };
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
  /** PPC §3/§4 — the CANONICAL attachment authority. Replaces the old
   *  `attachSpacing` (sourced from the legacy `maxAllowedSpacing` field, whose
   *  NAME carried the max-allowed lie) and the raw `lagSpec` / `embedSpec`
   *  strings. Emitters read `.spacingDesignLine` / `.spacingStatusLine` /
   *  `.pendingLines` and NEVER compose a dimension of their own. */
  attachment: AttachmentInstallationAuthority;
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

  // KDP — ONE pitch authority, shared with the PV-3 cross-section (see
  // resolveRoofPitch below). This block used to be inline here AND duplicated
  // with different inputs and different precision in drawRoofStructural.
  const _pitchAuth = resolveRoofPitch(cad, input);
  const pitchRatio = _pitchAuth.ratio;

  // Fire setbacks — CORRECT AHJ DATABASE SEMANTICS (per the IFC table behind
  // applyCodeBasis): ahjRidgeSetbackIn = the FIRE SETBACK on roof edges;
  // ahjRoofSetbackIn = the ACCESS PATHWAY width (a designated 36" route, not a
  // uniform edge setback — treating it as one buried the drawing in hatch).
  const _fireIn    = (p?.ahjRidgeSetbackIn as number);
  const _pathwayIn = (p?.ahjRoofSetbackIn as number);
  // Same coverage-aware rule as the DRAWING (resolveFireSetbackIn) — the data
  // zone printed "1.5' EDGES" while the plan hatched 3'-0" bands.
  const _covRoofFt2 = (r?.planes ?? []).reduce((s: number, x: any) => s + (Number(x?.areaSqM) || 0), 0) * 10.7639;
  const _covPitch = (() => {
    const ps = (r?.planes ?? []).map((x: any) => Number(x?.pitch)).filter((v: number) => isFinite(v));
    return ps.length ? ps.reduce((a: number, b: number) => a + b, 0) / ps.length : undefined;
  })();
  const _covFrac = arrayCoverageFrac(
    cad?.totalPanels ?? 0,
    (p?.panelLengthIn as number) || 66,
    (p?.panelWidthIn as number) || 40,
    _covRoofFt2,
    _covPitch,   // plan-projected basis — same 18"-vs-36" decision as the drawing
  );
  const fireSetbackFt = Math.round((resolveFireSetbackIn(_fireIn, _covFrac) / 12) * 10) / 10;
  const pathwayFt     = (_pathwayIn && _pathwayIn > 0) ? Math.round((_pathwayIn / 12) * 10) / 10 : 3;

  // PPC §3/§4 — the ONE attachment authority. The old block read
  // mounting-hardware-db directly (`fastenerDiameterIn` / `fastenerEmbedmentIn`
  // / `fastenerLengthIn` → `lagSpec` / `embedSpec`) and printed the result
  // unconditionally, and sourced spacing from `compliance.structural.attachment
  // .maxAllowedSpacing` — a field whose NAME asserted a maximum nobody verified.
  // Both are replaced by the canonical projection; the descriptor now carries
  // authority + verification state, not fabricated dimension strings.
  const _mountSel = (p?.mountingSystemId as string)
    ? getMountingSystemById(p.mountingSystemId as string)
    : undefined;
  const _snapRoof = (input as { _snapshot?: PermitDesignSnapshot } | undefined)?._snapshot ?? null;
  const _mountIdRoof = (p?.mountingSystemId as string) ?? null;
  const _rackAsset = _mountIdRoof ? getManufacturerAsset(_mountIdRoof, 'racking_detail') : null;
  const _applRoof = _rackAsset
    // AAC WS-9 RENDERER PURITY — the drafting stack projects the snapshot's
    // decided verdict; with no snapshot (standalone preview) the snapshot layer
    // answers with the honest no-facts evaluation, flagged as such.
    ? sheetDocumentApplicability({
        region: (input as { _snapshot?: { equipmentDocumentAuthority?: EquipmentDocumentAuthority } } | undefined)
          ?._snapshot?.equipmentDocumentAuthority ?? null,
        category: 'racking_detail', equipmentId: _mountIdRoof,
        selectedModel: _mountSel?.model ?? _rackAsset.model, asset: _rackAsset,
      })
    : null;
  const attachment = projectAttachmentInstallationAuthority(
    _snapRoof, _mountIdRoof,
    _rackAsset ? { model: _rackAsset.model, docTitle: _rackAsset.docTitle } : null,
    _applRoof ? {
      state: _applRoof.state,
      applicabilityVerified: _applRoof.applicabilityVerified,
      documentProduct: _applRoof.documentProduct,
    } : null,
  );
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
    // PPC §3/§4 — the canonical attachment authority (design spacing + status +
    // fastener/document gating). NO renderer-local spacing or dimension source.
    attachment,
    // §3 — conduit description from the canonical physical-raceway projection
    // (feeder conduit), never the renderer-local `|| 'EMT'` default (gate 4).
    conduitType:   canonicalConduitType((input as { _snapshot?: PermitDesignSnapshot } | undefined)?._snapshot ?? null),
    // W3 §7 — single-sourced from the snapshot env (115 is the standalone guard).
    // AAC WS-9 — ONE seam, basis-stated. No literal in the drafting layer.
    windSpeedMph: resolveSiteDesignLoads({
      snapshot: (input as { _snapshot?: never } | undefined)?._snapshot ?? null,
      complianceWindMph: cw?.windSpeed, ahjWindMph: p?.ahjWindSpeedMph,
    }).windSpeedMph,
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

  // Post/foundation wording mirrors the SolFence telescoping section record
  // (SOLFENCE_SECTION, lib/drafting/templates/fence.ts) — 4"⌀ outer aluminum
  // post over a 2-7/8"⌀ inner steel post, driven, no concrete.
  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'FENCE SEGMENT', sub: 'PV modules mounted vertically (bifacial)' },
        { n: 2, label: 'FENCE POST', sub: `4"⌀ outer / 2-7/8"⌀ inner steel @ ${d.postSpacingFt}' O.C.` },
        { n: 3, label: 'GATE OPENING', sub: 'structural post each side' },
        { n: 4, label: 'AZIMUTH LABEL', sub: 'panel face direction' },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: 'vertical bifacial mounting' },
        { n: 2, label: 'RAILS', sub: `${d.railCount === 1 ? '1 rail' : d.railCount + ' rails'} + 2"×1" mid rail — section system` },
        { n: 3, label: 'FENCE POST', sub: `telescoping — inner post driven ${d.embedFt}' min` },
        { n: 4, label: 'GRADE LINE', sub: 'field-verified elevation' },
        { n: 5, label: 'WIND ARROWS', sub: `${d.windSpeedMph} MPH Vult — ASCE 7-22 §29` },
      ];

  // GENERAL NOTES — fills the data rail below the callout schedule (the fence
  // sheets previously left the lower rail blank; ground already does this).
  const fenceGeneralNotes: string[] = [
    `Vertical bifacial solar fence — ${d.totalLenFt} L.F. total run in ${d.segmentCount} segment${d.segmentCount === 1 ? '' : 's'}; modules mounted 90° vertical, side-by-side in pre-built sections.`,
    `Foundation: 2-7/8" dia. inner steel post driven ${d.embedFt}' minimum with post pounder — no concrete; 4" dia. outer post sleeved over inner (telescoping). Field-verify refusal.`,
    `Posts at ${d.postSpacingFt}' O.C. nominal (93-3/4" center-to-center); a post lands at every section joint — never mid-module.`,
    'Bond all posts, rails and module frames to the equipment grounding conductor — min #6 AWG Cu (NEC 690.43 / 250.169).',
    `Design wind ${d.windSpeedMph} MPH Vult per ASCE 7-22 §29 (freestanding wall); system rated ${getRackingById('solfence-8ft')?.maxWindSpeed ?? 115} MPH / ${getRackingById('solfence-8ft')?.maxSnowLoad ?? 113} PSF per manufacturer.`,
    'DC circuits per the CIRCUIT legend; module-level power electronics installer-supplied per plan — see the DC CIRCUIT sheet / E-1.',
    'All dimensions NTS — field-verify segment lengths, post locations and grades prior to installation.',
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
    // Wave 6.2 (punch 1c): the drawn elevation is a TYPICAL 2-bay section of
    // the run — headers must say so (the sheet otherwise read as if the whole
    // fence were the drawn ~16' width).
    drawHeader:     isPlan
      ? `SOLAR FENCE — TYPICAL 2-BAY ELEVATION OF ${d.totalLenFt} L.F. RUN | ${d.segmentCount} SEGMENTS | POST @ ${d.postSpacingFt}' O.C. | WIND: ${d.windSpeedMph} MPH`
      : `FENCE STRUCTURAL DETAILS — POST EMBED: ${d.embedFt}' MIN | WIND: ${d.windSpeedMph} MPH Vult | ASCE 7-22 | ${d.totalLenFt} L.F. RUN`,
    secondaryHeader: isPlan ? 'SEGMENT PLAN — TOP VIEW (DC CIRCUITS)' : 'CONNECTION + FOOTING DETAILS — NTS',
    dataTitle:      isPlan ? 'FENCE DATA' : 'STRUCTURAL DATA',
    dataRows,
    callouts,
    generalNotes:   fenceGeneralNotes,
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
        { label: 'PYLON EMBED',    value: `${d.pileDepthFt}' MIN`,          bold: true, highlight: true },
        { label: 'PYLON SPACING',  value: `${d.pileSpacingFt}' O.C. (1/BAY)` },
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
        { n: 5, label: 'PYLON LOCATION', sub: d.structureType },
        { n: 6, label: 'ROW SPACING', sub: `${d.rowSpacingFt}' O.C. — verify inter-row shading` },
        { n: 7, label: 'PYLON EMBED', sub: `${d.pileDepthFt}' min below grade — field-verify refusal` },
        { n: 8, label: 'GROUND CLEARANCE', sub: `${d.groundClearIn}" min below lowest module` },
        { n: 9, label: 'EQUIP. BONDING', sub: 'all metalwork bonded to EGC — see PV-3' },
        { n: 10, label: 'FOUNDATION', sub: 'driven I-beam pylon — no concrete' },
        { n: 11, label: 'DESIGN LOADS', sub: `${d.windSpeedMph} MPH Vult · ASCE 7-22` },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: `${d.tiltDeg}° tilt` },
        { n: 2, label: 'PYLON / STRUT', sub: d.structureType },
        { n: 3, label: 'EMBEDMENT', sub: `${d.pileDepthFt}' min below grade` },
        { n: 4, label: 'GRADE LINE', sub: `${d.groundClearIn}" clearance min` },
      ];

  return {
    systemType:     'ground_mount',
    viewType,
    sheetId:        isPlan ? 'PV-2' : 'PV-3',
    primaryView:    isPlan ? 'ground_plan' : 'ground_elevation',
    // Ground plan owns its row-spacing side elevation + pile section INSIDE the
    // primary SVG (drawGroundArray split layout) — no duplicate outer strip, so
    // the primary fills the full draw-zone height instead of ~48% letterbox.
    secondaryViews: isPlan ? [] : ['pier_detail'],
    dataSections:   isPlan
      ? ['row_spacing', 'tilt', 'system_size']
      : ['foundation_depth', 'wind_load'],
    layout:         'split_view',
    drawPct:        65,
    dataPct:        35,
    drawHeader:     isPlan
      ? `GROUND ARRAY PLAN — ${d.rowCount} ROWS × ${d.panelsPerRow} MOD/ROW | TILT: ${d.tiltDeg}° | AZ: ${d.azimuthDeg}° | ROW SPACING: ${d.rowSpacingFt}'`
      : `PLP PYLON ELEVATION — ${d.structureType} | EMBED: ${d.pileDepthFt}' MIN | PYLON @ ${d.pileSpacingFt}' O.C. | WIND: ${d.windSpeedMph} MPH`,
    secondaryHeader: isPlan ? 'ROW SPACING DIAGRAM' : 'PLP PYLON DETAIL — NTS',
    dataTitle:      isPlan ? 'ARRAY DATA' : 'STRUCTURAL DATA',
    dataRows,
    callouts,
    generalNotes:   isPlan
      ? [
          'Array is ground-mounted on a driven-steel-pile foundation — no concrete unless refusal cannot be met; field-verify refusal depth.',
          `Module rows at ${d.tiltDeg}° fixed tilt, azimuth ${d.azimuthDeg}° (${azLabel(d.azimuthDeg)}); verify inter-row shading at winter solstice for the ${d.rowSpacingFt}' O.C. spacing.`,
          `Maintain ${d.setbackFt}' minimum setback from all property lines and the ${d.groundClearIn}" minimum ground clearance below the lowest module edge.`,
          'Bond all module frames, rails and pile caps to the equipment grounding conductor per NEC 690.43 / 250.—see PV-3 for the grounding schedule.',
          'Racking, clamps and fasteners installed per the manufacturer\'s ICC-ES report and stamped structural details; torque to spec.',
          `Design loads: ${d.windSpeedMph} MPH Vult wind (ASCE 7-22)${d.snowPsf > 0 ? `, ${d.snowPsf} PSF ground snow` : ''}; foundation embedment per the project geotechnical report.`,
          'All dimensions are approximate / NTS — field-verify pile locations, row spacing and grades prior to installation.',
        ]
      : undefined,
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
  // Roof Tech RT-MINI is an L-FOOT + RAIL base (rail_based), NOT rail-less — so
  // its attach spacing is the ENGINE-resolved value (structural.attachment
  // .maxAllowedSpacing), the SAME single source PV-4C/PE-1/CERT/APP-A print. The
  // old regex wrongly matched RT-MINI + the brand name "ROOF TECH" and hardcoded
  // 48" STAGGERED, contradicting the structural authority. Only genuinely
  // rail-less products (RT-APEX / E Mount AIR / explicit "rail-less") get the
  // direct-attach treatment. (RT-MINI research 2026-07-09, sourced.)
  const _railless = /RAIL-?LESS|RT[- ]?APEX|E[ -]?MOUNT ?AIR/i.test(d.mountSys);
  // PPC §3 — ONE spacing authority, rendered as a DESIGN value + its verification
  // STATUS. The old expressions printed `${attachSpacing}" O.C. MAX` (and a
  // hardcoded 48" on the rail-less branch) — an unverified maximum-allowed claim
  // on PV-1 + PV-3 while the canonical authority said PENDING VERIFICATION.
  const _att = d.attachment;
  const _attachDisplay = _att.spacingShortLabel + (_railless ? ' STAGGERED' : '');
  const _attachInto = _railless
    ? `direct-attach mounts @ ${_att.spacingShortLabel} staggered`
    : `L-foot @ ${_att.spacingShortLabel}`;
  // PPC §4 — while the attachment authority is not fully verified NO exact
  // fastener dimension / embedment / torque / pilot / coating / sealant string may
  // be composed. The observed geometry stays in `_att.fastener` for regeneration.
  const _exact = _att.exactInstructionsAllowed;
  // ECD §7 — the canonical BONDING authority the PV-3 callouts project. Callout ⑦
  // used to name a 'BONDING JUMPER' (a METHOD) with no authority behind it.
  const _bond = projectRackingBondingAuthority(
    (input as { _snapshot?: PermitDesignSnapshot } | undefined)?._snapshot ?? null);
  const _fa = _att.fastener;
  const _lagRow = _exact
    ? `${_fa.diameterLabel ?? '—'}" DIA × ${_fa.lengthIn ?? '—'}" ${(_fa.fastenerType ?? '').toUpperCase()}`.trim()
    : _att.fastenerStateLabel;
  const _embedRow = _exact
    ? `${_fa.embedmentIn ?? '—'}" MIN THREAD EMBEDMENT`
    : 'NOT ESTABLISHED';
  const _hardwareRow = _exact && _fa.material ? _fa.material.toUpperCase() : 'PENDING VERIFIED SELECTION';
  // Framing term matches the structural authority (PV-4C/PE-1/CERT) so the set
  // doesn't say "RAFTER" on PV-3 while the calcs certify a pre-engineered truss.
  const _frameLabel = d.isTruss ? 'TRUSS' : 'RAFTER';

  // §11 — the attachment-base callout label is PROJECTED from the canonical mount
  // TOPOLOGY (classifyMountTopology), NEVER inferred from the product name. The
  // old name regex printed "DIRECT-ATTACH MOUNT" on RT-MINI, which is rail_paired
  // (an L-foot/standoff base carrying a rail), contradicting the structural sheets.
  const _mountSelC = (input?.project as { mountingSystemId?: string } | undefined)?.mountingSystemId
    ? getMountingSystemById(String((input!.project as { mountingSystemId?: string }).mountingSystemId))
    : undefined;
  const _mountTopo = _mountSelC ? classifyMountTopology(_mountSelC).topology : 'unknown';
  const _baseLabelP2 = _mountTopo === 'rail_paired' ? 'RAIL-PAIRED ROOF ATTACHMENT BASE'
    : _mountTopo === 'rail_less' ? 'DIRECT-ATTACH MOUNT (RAIL-LESS)'
    : 'MOUNT TOPOLOGY — PENDING VERIFICATION';
  const _baseLabelP3 = _mountTopo === 'rail_paired' ? 'MOUNT BASE / RAIL ATTACHMENT'
    : _mountTopo === 'rail_less' ? 'DIRECT-ATTACH FOOT'
    : 'ATTACHMENT — PENDING VERIFICATION';

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
        { label: 'DESIGN ATTACHMENT SPACING', value: _attachDisplay },
        { label: 'SPACING STATUS', value: _att.spacingStatusLine, highlight: !_exact },
        { label: 'MODULES',        value: `${d.totalPanels} @ ${d.dcKw} kWdc`, bold: true },
      ]
    : [
        { label: 'MOUNTING SYS',   value: d.mountSys },
        { label: `${_frameLabel} SIZE`,    value: d.rafterSize },
        { label: `${_frameLabel} SPACING`, value: `${d.rafterSpacing}" O.C.` },
        { label: 'DESIGN ATTACHMENT SPACING', value: _attachDisplay,   bold: true },
        { label: 'SPACING STATUS', value: _att.spacingStatusLine, highlight: !_exact },
        // PPC §4 — dimensionless while unverified (no diameter / length / embedment
        // / coating may print without the five verified conditions).
        { label: 'FASTENER ASSEMBLY', value: _lagRow },
        { label: 'EMBEDMENT',      value: _embedRow,                        bold: true, highlight: !_exact },
        { label: 'ROOF TYPE',      value: d.roofType },
        { label: 'HARDWARE',       value: _hardwareRow },
        { label: 'WIND SPEED',     value: `${d.windSpeedMph} MPH Vult` },
        { label: 'DESIGN CODE',    value: 'ASCE 7-22 / NEC 690.43' },
      ];

  const callouts: CalloutItem[] = isPlan
    ? [
        { n: 1, label: 'PV MODULE ARRAY', sub: `${d.totalPanels} mod @ ${d.dcKw} kW DC` },
        // §15 — the setback DIMENSIONS are modeled; the authority BASIS is
        // provisional until the AHJ identity + adopted IFC edition are verified
        // (never "per AHJ" on an unverified assumption; drives off codeAuthority).
        { n: 2, label: 'FIRE SETBACKS', sub: (() => {
            const _cp = projectCodeAuthority((input as { _snapshot?: PermitDesignSnapshot } | undefined)?._snapshot ?? null);
            const _fb = resolveFireSetbackBasis({ ifcEdition: _cp.ifc, verificationStatus: _cp.verificationStatus, ahjName: _cp.ahjName });
            return `${d.fireSetbackFt}' ridge · 18" hip/valley · ${d.pathwayFt}' pathway (MODELED) — ${_fb.calloutSuffix}`;
          })() },
        { n: 3, label: 'RIDGE LINE', sub: `${d.pitchStr} pitch` },
        { n: 4, label: 'CONDUIT RUN', sub: `${routeProvenanceLabel((input as { _snapshot?: PermitDesignSnapshot } | undefined)?._snapshot ?? null)} — ${d.conduitType}` },
        // 'truss'.toLowerCase()+'s' printed "trusss" on PV-1 — pluralize properly.
        { n: 5, label: 'ATTACHMENT ZONE', sub: `${_attachInto} into ${_frameLabel === 'TRUSS' ? 'trusses' : 'rafters'}` },
      ]
    : [
        { n: 1, label: 'PV MODULE', sub: 'see equipment schedule' },
        { n: 2, label: _baseLabelP2, sub: d.mountSys },
        // PPC §4 — callout ③ used to print the exact lag spec + embedment.
        { n: 3, label: _baseLabelP3, sub: _exact
            ? `${_lagRow} — ${_embedRow.toLowerCase()}`
            : `fastener assembly ${_att.fastenerStateLabel.toLowerCase()} — installation details not established` },
        { n: 4, label: 'FLASHING', sub: _exact
            ? 'under all penetrations per the verified manufacturer document'
            : 'flashing / sealant instructions pending verified document applicability' },
        { n: 5, label: `${_frameLabel} ${d.rafterSize}`, sub: `@ ${d.rafterSpacing}" O.C.` },
        { n: 6, label: /PENDING/.test(d.conduitType) ? 'CONDUIT' : d.conduitType + ' CONDUIT', sub: /PENDING/.test(d.conduitType) ? 'raceway authority pending — see conductor schedule' : 'see conductor schedule' },
        // ECD §7 — callout ⑦ used to name a 'BONDING JUMPER' — a specific METHOD
        // (discrete jumper hardware) — with no authority and no selected component,
        // in the same array whose siblings ③④ correctly degrade to pending. It now
        // projects the canonical bonding authority: the REQUIREMENT is the label,
        // the METHOD is whatever the authority establishes.
        { n: 7, label: 'BONDING', sub: `${_bond.methodShortLabel.toLowerCase()} · ${_bond.requirementCodeBasis}` },
      ];

  // PPC §3 — the ONE canonical spacing line, printed verbatim on PV-1 AND PV-3,
  // plus (PV-3) Ray's exact fastener PENDING block + the non-authoritative
  // reference-detail banner. Any sheet-scoped gate reads these strings.
  const generalNotes: string[] = isPlan
    ? [_att.spacingLine]
    : [_att.spacingLine, ..._att.pendingLines];

  return {
    systemType:     'roof',
    viewType,
    // PPC §3 sub-finding — the plan composition is rendered by pageRoofPlan as
    // **PV-1** (arrayPages.ts titleBlock); the old 'PV-2' declaration pointed every
    // sheet-scoped gate at the wrong sheet. 'PV-2' only exists on the standalone
    // CAD path (renderPlanSet.ts), which does not read this field for its title.
    sheetId:        isPlan ? 'PV-1' : 'PV-3',
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
      : `ATTACHMENT DETAIL (REFERENCE${_exact ? '' : ' — NON-AUTHORITATIVE'}) — ${d.mountSys} | ${d.rafterSize} @ ${d.rafterSpacing}" O.C. | ATTACH: ${_attachDisplay}${_exact ? '' : ' — PENDING STRUCTURAL VERIFICATION'}`,
    secondaryHeader: isPlan ? 'SETBACK & OBSTRUCTION OVERLAY' : 'ATTACHMENT DETAIL — NTS',
    dataTitle:      isPlan ? 'SYSTEM DATA' : 'ATTACHMENT SPECS',
    dataRows,
    callouts,
    generalNotes,
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