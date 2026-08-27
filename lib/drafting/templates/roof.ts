// ============================================================
// SolarPro Drafting Engine — Roof System Templates
// lib/drafting/templates/roof.ts
//
// drawRoofPlan()       → PV-2: top-down GPS array layout (PRIMARY)
// drawRoofStructural() → PV-3: cross-section + attachment detail
//
// SYSTEM: roof ONLY
// CAD IS THE SOLE SOURCE OF TRUTH — all geometry from CADModel.
//
// CROSS-CONTAMINATION BLOCK (STEP 9):
//   ✗ No fence terminology (post, rail, gate, fence height, embed)
//   ✗ No ground terminology (pile, array row, row spacing, ground mount)
//   ✓ Roof-only: plane, pitch, rafter, ridge, eave, setback,
//                L-foot, flashing, lag bolt, fascia
//
// GPS COORDINATE ENCODING:
//   CAD adapter encodes local XY (meters) as fake-degrees (1°==1ft)
//   so template scale = pixels/ft and panel sizes are pixel-accurate.
//
// STRUCTURAL REALISM (STEP 7):
//   PV-3 shows: rafter cross-section, full layer stack, L-foot
//   detail circle, dimension hierarchy, attachment callouts.
// ============================================================

import type { DraftingInput } from '../types';
import type { DesignIntent } from '../designIntent';
import type { CADModel } from '../../cad/types';
import { drawUtilityAnalysis, type RenderContext } from '../renderContext';
import { projectStructural, projectAttachmentInstallationAuthority } from '../../permit/snapshot/structuralProjection';
// ECD §7 — the canonical BONDING authority (requirement vs method). PV-3's
// hardware schedule used to hardcode 'UL 2703 INTEGRATED — NEC 690.43' in BOTH
// the verified AND the assembly-PENDING branch.
import { projectRackingBondingAuthority } from '../../permit/snapshot/rackingBonding';
import { getManufacturerAsset } from '../../manufacturer-assets-db';
// AAC WS-9 — the ONE document-applicability seam every sheet may use.
import { sheetDocumentApplicability, type EquipmentDocumentAuthority } from '../../permit/snapshot/documentAuthority';
import { projectCodeAuthority } from '../../permit/snapshot/codeAuthorityProjection';
import { applyAffine, fitAffine, emitPlacementManifestComment } from '../../permit/snapshot/coordinateAuthority';
import type { PlacementEntry } from '../../permit/snapshot/types';
import { getLayoutForSystem } from '../layoutEngine';
import {
  drawSVGOpen, drawSVGClose, drawBackground, drawTitleBar,
  drawNorthArrow, drawScaleBar, drawText, drawLine, drawRect, drawRectFilled,
  drawCircleFilled, drawPolyline, drawPolygon, drawHatch,
  drawArrowhead, ftToFtIn, escapeXml,
} from '../primitives';
import {
  drawDimension, drawLinearDimension, drawVerticalDimension,
  drawContinuousDimension, drawOverallDimension,
} from '../dimensions';
import {
  drawCallout, drawCalloutWithLeader, drawLeaderLine, drawWindArrow,
} from '../callouts';
import { regularizeRoofPlanes, coTransformPanels } from '../regularizeRoof';
import { getMountingSystemById } from '../../mounting-hardware-db';
import { resolveFireSetbackIn } from '../../permit/utils/fireSetback';
// KDP (structural math consistency) — THE roof-pitch authority, shared with the
// specs table / cover / PV-4C / PE-1 so no sheet prints a different pitch.
import { resolveRoofPitch } from '../sheetComposition';
// §6 ROUTE PROVENANCE (07-22): the trench/conduit annotation must NOT claim
// "ROUTE FIELD-VERIFIED" while run lengths are CAD-derived estimates — it prints
// "CAD-DERIVED ESTIMATE — FIELD VERIFY", driven by the snapshot's lengthSource.
import { routeProvenanceLabel, branchLayoutCaption, projectCanonicalBranch } from '../../permit/snapshot/electricalProjection';
import {
  computeFitWindow, drawSiteContextEls, type SiteContext,
  computePlanTiltDeg, choosePlanRotationDeg, rotateFakePt, rotateAzimuthDeg,
  northArrowRotationDeg, rotateSiteContext,
} from './roofSiteContext';
import { buildHybridOverlays, rotateHybridOverlays, fenceInsetSVG } from './hybridOverlay';

// Ray-cast point-in-polygon on a lat/lng ring (planar; fine at roof scale).
function ptInLatLngRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Screen-space point-in-ring (ray cast) — used to pick each edge's inward normal.
function ptInRingXY(x: number, y: number, ring: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// CAD-space vertex coincidence (fake-degrees, 1 unit ≈ 1 ft).
function sameVert(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.75 && Math.abs(a.lng - b.lng) < 0.75;
}

// Residual-noise axis snap for module/framing angles (deg, folded mod 180).
// The GLOBAL plan rotation squares the BUILDING to the sheet, so on-sheet
// angles land within a couple degrees of the axes — this only cleans that
// residual trace noise (same 8° regularizeRoof straightens linework with).
// It must stay SMALL: the old 15° tolerance squared modules INDEPENDENTLY of
// a visibly tilted roof outline — the root of Ray's "cocking everything to
// the side" PV-1 (modules axis-square, outline at ~6-8°, fence at ~13°).
const AXIS_SNAP_DEG = 8;
function snapAxisDeg(angMod180: number): number {
  if (angMod180 < AXIS_SNAP_DEG || angMod180 > 180 - AXIS_SNAP_DEG) return 0;
  if (Math.abs(angMod180 - 90) < AXIS_SNAP_DEG) return 90;
  return angMod180;
}

// Edge classification: an edge shared with ANOTHER facet (same endpoints, either
// order) is interior = ridge/hip; a perimeter edge is eave/rake. Drives both the
// per-edge fire-setback distance and the per-edge line weight. Returns the
// ADJACENT plane index (-1 = perimeter) so callers can tell ridge from hip:
// opposite-facing neighbor (azimuths ~180° apart) = ridge; else hip/valley.
function interiorEdgeAdj(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
  planes: any[], skipIdx: number,
): number {
  for (let pi = 0; pi < planes.length; pi++) {
    if (pi === skipIdx) continue;
    const vs = planes[pi].vertices as Array<{ lat: number; lng: number }>;
    for (let i = 0; i < vs.length; i++) {
      const u = vs[i], v = vs[(i + 1) % vs.length];
      if ((sameVert(u, a) && sameVert(v, b)) || (sameVert(u, b) && sameVert(v, a))) return pi;
    }
  }
  return -1;
}
function isInteriorEdge(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
  planes: any[], skipIdx: number,
): boolean {
  return interiorEdgeAdj(a, b, planes, skipIdx) >= 0;
}

// Plan-view (horizontal footprint) area of a facet ring, in ft². drawRoofPlan
// receives fake-degree CAD units where 1 unit ≈ 1 ft (see header), so the raw
// shoelace is already ft² — no lat/lng metre conversion. This is the "PLAN VIEW"
// roof area the pro sets report, not the sloped surface area.
function planViewAreaFt2(ring: Array<{ lat: number; lng: number }>): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].lng * ring[i].lat - ring[i].lng * ring[j].lat;
  }
  return Math.abs(a / 2);   // ft² (1 CAD unit = 1 ft)
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRoofPlan — PV-2 Top-Down GPS Array Layout (PRIMARY)
// STEP 2: Roof top-down plan is the primary view.
// STEP 4: All geometry from CADModel (via fake-degree encoding).
// ─────────────────────────────────────────────────────────────────────────────

// W3.1 §2 — tag a drawn module with its CANONICAL object id so the render-parity
// harness can verify (d) no rendered physical object without a canonical ID and
// (e) coverage. The id matches snapshot.geometry.moduleInstances[].instanceId
// (`mi-<panelId>`). Only emitted for safe-charactered ids (never fabricated).
function canonicalObjIdAttr(p: { id?: unknown } | null | undefined): string {
  const raw = p?.id;
  if (raw == null) return '';
  const s = String(raw);
  return /^[\w.:-]+$/.test(s) ? ` data-object-id="mi-${s}"` : '';
}

export function drawRoofPlan(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
  panelColorById?: Map<string, string> | null,
): string {
  const { project, layout, engineering } = input;

  const totalPanels = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw        = cad?.totalDcKw   ?? engineering.totalDcKw   ?? (totalPanels * (engineering.panelWatts || 400) / 1000);
  // ── W3 §2 — module footprint dims PROJECT from the canonical snapshot module
  // instance (exact catalog dims). The generic 66×40 fallback is DELETED; when
  // no snapshot is present (standalone preview) the project scalars are the
  // last resort, never a made-up module size. panelLenIn = long dim (height),
  // panelWidIn = width — matching the snapshot ModuleInstance convention.
  const _sp = projectStructural(ctx?.snapshot);
  // 0 when truly unknown (never 66/40): the snapshot fires MODULE-DIMENSIONS-
  // UNVERIFIED and the review banner prints — the drawing degrades honestly
  // rather than presenting a fabricated module size as real.
  const panelLenIn  = _sp.moduleHeightIn ?? project.panelLengthIn ?? 0;
  const panelWidIn  = _sp.moduleWidthIn  ?? project.panelWidthIn  ?? 0;
  const mountSys    = ((((project as any)._canonical?.mountSystem as string)
    || project.mountingSystem
    || 'IRONRIDGE XR100')).toUpperCase();
  // Genuinely rail-less products (RT-APEX / E Mount AIR / explicit "rail-less" /
  // S-5 / EcoFasten) draw per-module direct mounts. Everything else — INCLUDING
  // Roof Tech RT-MINI, which is an L-FOOT + RAIL base, NOT rail-less (Ray ruling;
  // BOM orders rails + T-bolts for it; see bom-engine-v4.ts:310, sheetComposition
  // .ts:647) — is RAILED: continuous row rails on feet at framing crossings.
  const isRailless  = /RAIL-?LESS|RT[- ]?APEX|E[ -]?MOUNT ?AIR/i.test(mountSys);
  const roofType    = (project.roofType       || 'SHINGLE').toUpperCase();
  const condType    = (project.conduitType    || 'EMT').toUpperCase();
  const panelWatts  = engineering.panelWatts || 0;
  const _modNamed   = [project.moduleMfr, project.moduleModel].filter(Boolean).join(' ').toUpperCase();
  const _invNamed   = [project.inverterMfr, project.inverterModel].filter(Boolean).join(' ').toUpperCase();
  const pitchNum    = project.roofPitch       || 5;
  const pitchStr    = pitchNum + ':12';
  const rafterSp    = project.rafterSpacing   || 24;
  // W3 §4/§6 — attachment O.C. spacing PROJECTS from the canonical snapshot
  // (engine-RESOLVED spacing on the rail/attachment objects), never the invented
  // 48" literal. Feet are then geo-registered onto the real rafter grid at this
  // canonical O.C.; their COUNT reconciles with snapshot.structural.attachments
  // (V22). When no snapshot is present the resolved project value is the last
  // resort (still engine-resolved, not a sheet literal).
  const attachSp    = _sp.attachmentSpacingIn
    ?? (project as any).resolvedAttachSpacingIn
    ?? project.attachmentSpacing
    ?? null;
  // Railed systems (incl. RT-MINI) run RAIL FEET at the canonical O.C. STAGGERED —
  // feet share rafters under a continuous rail, NOT one per module. The drawn feet
  // + the attachment callout both use the projected spacing so the plan matches
  // the engine-resolved layout and the BOM.
  const railFootOcIn = _sp.attachmentSpacingIn
    ?? (project as any).resolvedAttachSpacingIn
    ?? project.attachmentSpacing
    ?? 48;
  // PPC §3 — PV-1's spacing ANNOTATIONS project the canonical spacing authority
  // (design value + verification state). The numeric above stays the GEOMETRY
  // driver (where feet are drawn); every printed spacing string comes from here,
  // so PV-1 can no longer state a spacing the structural authority has not verified.
  const _attP = projectAttachmentInstallationAuthority(
    ctx?.snapshot ?? null,
    ((project as any).mountingSystemId as string | undefined) ?? null,
  );
  /** '(DESIGN)' / '(VERIFIED)' suffixed short spacing label, e.g. '48" O.C. (DESIGN)'. */
  const _ocLabelP = _attP.spacingShortLabel;
  const _spacingPendingP = _attP.spacing.verificationState !== 'verified';
  // Fire setbacks — CORRECT AHJ DATABASE SEMANTICS (Ray, 2026-07-01): per the
  // IFC code table behind applyCodeBasis, ahjRidgeSetbackIn is the FIRE SETBACK
  // (drawn as a band on every edge) and ahjRoofSetbackIn is the ACCESS PATHWAY
  // WIDTH — a designated 36" route requirement, NOT a uniform edge moat.
  // Hatching every eave/rake at the pathway width buried half the roof in red
  // and made code-compliant modules read as violations.
  // Defaults resolved AFTER geometry validation — the 18"-vs-36" ridge
  // setback depends on array coverage (IFC 2021 §1204.2.1.1); see below.
  const pathwayIn   = project.ahjRoofSetbackIn  || 36;
  const pathwayFt   = pathwayIn / 12;

  // ── STEP 4: Geometry from CAD (via adapter fake-degree encoding) ──
  const rpData = project.roofPlanes    || [];
  const ppData = project.panelPositions || [];

  const validPlanes = rpData.filter(
    (rp: any) => rp.vertices && rp.vertices.length >= 3 &&
          rp.vertices.every((v: any) => isFinite(v.lat) && isFinite(v.lng) && Math.abs(v.lat) > 0.001)
  );
  const validPanels = ppData.filter(
    (p: any) => p.lat && p.lng && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) > 0.001
  );

  console.log('[drawRoofPlan] CAD-driven input:', {
    planes: validPlanes.length,
    panels: validPanels.length,
    totalPanels,
    dcKw: dcKw.toFixed(2),
    cadPresent: !!cad,
  });

  // ── STEP 4 enforcement: throw without real geometry ──
  if (validPanels.length === 0 || validPlanes.length === 0) {
    throw new Error(
      '[drawRoofPlan] No valid CAD geometry. ' +
      `planes=${rpData.length} validPlanes=${validPlanes.length} ` +
      `panels=${ppData.length} validPanels=${validPanels.length} ` +
      '— roof system requires cad.roof model with planes and panels.'
    );
  }

  // ── Fire setback width — IFC 2021 §1204.2.1.1 coverage test ──
  // The 18" ridge setback is the EXCEPTION, allowed only where the array
  // covers ≤ 33% of the roof plan area; above that the 36" default governs.
  // An AHJ-supplied value always wins. (Shipping 18" bands on a 48%-coverage
  // roof was a plan-check red flag.)
  const _shoelaceFt2 = (verts: any[]): number => {
    let s = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      s += a.lng * b.lat - b.lng * a.lat;
    }
    return Math.abs(s) / 2;   // fake-degree verts: 1 unit = 1 ft
  };
  const _roofAreaFt2  = validPlanes.reduce((s: number, rp: any) => s + _shoelaceFt2(rp.vertices), 0);
  // COVERAGE BASIS (documented choice): PLAN array area ÷ PLAN roof area —
  // both terms in the same horizontal projection. A module lying on a pitched
  // plane occupies (real area × cos(pitch)) of plan; the old REAL-module-area ÷
  // PLAN-roof-area ratio mixed bases and overstated coverage by 1/cos(pitch),
  // wrongly denying the 18" exception (Stowell 27.6°: 36.4% mixed vs ~30.4%
  // consistent → the 18" ridge setback actually applies). Per-plane this is
  // identical to real-array ÷ (plan-roof/cos) — surface basis.
  const _cosOfPitch = (pitch: any): number => {
    const pd = Number(pitch);
    return isFinite(pd) && pd > 0 && pd < 89 ? Math.cos(pd * Math.PI / 180) : 1;
  };
  const _panelRealFt2 = (panelLenIn * panelWidIn) / 144;
  const _planeIdxOf = (p: any, planes: any[]): number => {
    let idx = planes.findIndex((rp: any) => ptInLatLngRing(p.lat, p.lng, rp.vertices));
    if (idx < 0) {   // regularized-border stragglers → nearest plane centroid
      let bestD = Infinity;
      planes.forEach((rp: any, i: number) => {
        const cLa = rp.vertices.reduce((s: number, v: any) => s + v.lat, 0) / rp.vertices.length;
        const cLo = rp.vertices.reduce((s: number, v: any) => s + v.lng, 0) / rp.vertices.length;
        const d = (p.lat - cLa) ** 2 + (p.lng - cLo) ** 2;
        if (d < bestD) { bestD = d; idx = i; }
      });
    }
    return idx;
  };
  const _arrayPlanFt2 = validPanels.reduce((s: number, p: any) => {
    const i = _planeIdxOf(p, validPlanes);
    return s + _panelRealFt2 * (i >= 0 ? _cosOfPitch(validPlanes[i].pitch) : 1);
  }, 0);
  const _coverage     = _roofAreaFt2 > 0 ? _arrayPlanFt2 / _roofAreaFt2 : 0;
  // AHJ-supplied override precedence unchanged — resolveFireSetbackIn owns it.
  const fireSetIn   = resolveFireSetbackIn(project.ahjRidgeSetbackIn as number | undefined, _coverage);
  const setbackFt   = fireSetIn / 12;

  // ── Regularize the hand-traced geometry for DRAWING (display copy only) ──
  // Welds shared facet corners, straightens near-axis eaves/ridge, squares the
  // outline — ±1-2 ft trace noise rendered as amateur linework (wavy eaves,
  // dogleg ridge, asymmetric hips). Panels ride along via each facet's fitted
  // affine so rows stay flush to the straightened edges (they overhung the new
  // eave when only the planes moved). Stored geometry is untouched.
  const regPlanes0 = regularizeRoofPlanes(validPlanes as any[]);
  const regPanels0 = coTransformPanels(validPlanes as any[], regPlanes0 as any[], validPanels as any[]);

  // ── Layout zones (STEP 3) — up-front: the plan-rotation fill choice below
  // needs the draw-window dimensions. ──
  const zones = getLayoutForSystem('roof', 'plan');
  const W = zones.canvas.width;
  const H = zones.canvas.height;
  const dz = zones.draw;
  // Margin leaves room for the dimension lines + callout row outside the roof.
  const margin  = 52;
  // PV-2 (plan mode) carries the tables + general-notes column at the left
  // INSIDE the draw zone (tx=8, ~268px + 31'-6" vertical dim clearance).
  // Reserve that width in fit-to-frame so the roof can never slide under it
  // — the opaque-backing patch just erased whatever linework it covered.
  // Same left reserve on BOTH sheets so PV-1B frames at the IDENTICAL zoom/position
  // as PV-1 (they're sibling views of the same roof; different zoom read as sloppy).
  // 280px is reserved for PV-1's left-edge tables (ROOF DESCRIPTION / ARRAY &
  // ROOF CALC / GENERAL NOTES). PV-1B renders none of them — reserving the
  // strip anyway silently cost ~30% of the drawing scale (the "zoom is
  // nowhere near right" regression, Ray 2026-07-20).
  const leftReserve = (panelColorById && panelColorById.size > 0) ? 20 : 280;

  // ── ONE GLOBAL PLAN ROTATION (Ray 2026-07-11: "cocking everything to the
  // side") ──────────────────────────────────────────────────────────────────
  // Pro sets square the BUILDING to the sheet and rotate the north arrow. The
  // angle comes from the dominant roof axis (length-weighted edge bearings
  // folded mod 90°) and EVERY drawn layer goes through the SAME fake-degree
  // pre-transform — plane polygons, module rects + azimuths, site context,
  // hybrid overlays (ground slats / fence line), obstructions. Applied BEFORE
  // the toX/toY pixel mapping, so the fit window recomputes on ROTATED extents
  // and every text label stays horizontal. Modules end up square BECAUSE the
  // building is square — not via the old module-only azimuth snap that left
  // rects axis-square against a tilted outline. The north rose (below) turns
  // by northArrowRotationDeg(planRotDeg) — the same constant.
  const _siteRaw: SiteContext | null =
    (input as unknown as { _siteContext?: SiteContext | null })._siteContext || null;
  const _hybRaw = cad?.hybrid ? buildHybridOverlays(cad, cad.originLat, cad.originLng) : null;
  const _planTilt = computePlanTiltDeg(regPlanes0 as any[]);
  // Hybrid overlays are SUBJECT MATTER (fit-basis members below), so they vote
  // on which squaring (long axis horizontal vs vertical) fills the window best.
  const _subjPtsForRot = [
    ...regPlanes0.flatMap((rp: any) => (rp.vertices ?? []) as Array<{ lat: number; lng: number }>),
    ...(_hybRaw?.allPts ?? []),
  ];
  // ONE MAP TRUTH (Ray 2026-07-20: "We aren't even using the same source of
  // truth for the map"): the rotation choice must be IDENTICAL on PV-1 and
  // PV-1B — feeding the chooser each sheet's own usable width let PV-1B's
  // freed left-reserve flip the building relative to PV-1. The chooser always
  // evaluates the PV-1 aspect (leftReserve 280 basis); PV-1B then renders the
  // SAME map, just larger.
  const planRotDeg = choosePlanRotationDeg(
    _planTilt, _subjPtsForRot,
    dz.width - 2 * margin - 280, dz.height - 2 * margin,
  );
  const _pvLngs = regPlanes0.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lng));
  const _pvLats = regPlanes0.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lat));
  const _pivot = {
    lng: (Math.min(..._pvLngs) + Math.max(..._pvLngs)) / 2,
    lat: (Math.min(..._pvLats) + Math.max(..._pvLats)) / 2,
  };
  const _rotPt = (p: { lat: number; lng: number }) => rotateFakePt(p, planRotDeg, _pivot);
  const _rotAz = (az: unknown) =>
    (typeof az === 'number' && isFinite(az)) ? rotateAzimuthDeg(az, planRotDeg) : az;
  const regPlanes = planRotDeg === 0 ? regPlanes0 : regPlanes0.map((rp: any) => ({
    ...rp,
    azimuth: _rotAz(rp.azimuth),
    vertices: (rp.vertices ?? []).map((v: any) => ({ ...v, ..._rotPt(v) })),
  }));
  const regPanels = planRotDeg === 0 ? regPanels0 : regPanels0.map((p: any) => ({
    ...p,
    ..._rotPt(p),
    azimuth: _rotAz(p.azimuth),
    heading: _rotAz(p.heading),
  }));
  // ── COUNT RECONCILE (systemic root #2 sibling) ──────────────────────────────
  // The authoritative module count (cad.totalPanels) can exceed the panels that
  // actually resolved onto a plane and got DRAWN here (regPanels — one per valid
  // panelPosition; modules with missing/invalid GPS never make it into
  // validPanels). When they differ the header/callout must NOT silently claim
  // the full count over a drawing (and per-facet table) that show fewer — that
  // is the "PV-1 header 48 / drawing 40" self-contradiction. Annotate the drawn
  // subset so the sheet tells ONE consistent story to a plan checker.
  const _drawnPanels = regPanels.length;
  const _countMismatch = totalPanels > 0 && _drawnPanels !== totalPanels;
  const _shownNote = _countMismatch ? ` (${_drawnPanels} OF ${totalPanels} SHOWN)` : '';
  const _site = _siteRaw && planRotDeg !== 0 ? rotateSiteContext(_siteRaw, planRotDeg, _pivot) : _siteRaw;
  const _hyb = _hybRaw && planRotDeg !== 0 ? rotateHybridOverlays(_hybRaw, planRotDeg, _pivot) : _hybRaw;
  console.log('[drawRoofPlan] plan rotation:', {
    dominantAxisTiltDeg: +_planTilt.toFixed(2),
    planRotDeg: +planRotDeg.toFixed(2),
    northArrowDeg: +northArrowRotationDeg(planRotDeg).toFixed(2),
  });

  // ── SLOPE→PLAN projection (per plane) ──────────────────────────────────────
  // Panel CENTERS are plan-true (projected lat/lng), but module rectangle DIMS
  // are physical (on-surface) and IFC 1204 setbacks/pathways are walked ALONG
  // THE ROOF SURFACE. Anything with a fall-line (up/down-slope) component
  // foreshortens by cos(pitch) when drawn/checked in plan; cross-slope
  // distances (along the eave / rake direction) project 1:1. Drawing raw
  // physical dims + raw band widths in plan space flagged compliant designs
  // (Stowell: 16 phantom "MODULE(S) ENCROACH" on a roof that clears 36" by
  // 0.3" measured on the surface).
  const planeCosP = regPlanes.map((rp: any) => _cosOfPitch(rp.pitch));
  const _hostIdxCache = new Map<any, number>();
  const hostPlaneIdx = (p: any): number => {
    let idx = _hostIdxCache.get(p);
    if (idx === undefined) { idx = _planeIdxOf(p, regPlanes); _hostIdxCache.set(p, idx); }
    return idx;
  };
  const panelCosP = (p: any): number => {
    const i = hostPlaneIdx(p);
    return i >= 0 ? planeCosP[i] : 1;
  };

  // SVG ids are DOCUMENT-global: PV-1, PV-1B and PV-2 all embed this svg in
  // one planset html, and identically-named clipPaths collide — the browser
  // resolves url(#sbclip0) to the FIRST sheet's plane polygon, so later
  // sheets' framing/fire-bands were clipped by ANOTHER sheet's geometry
  // (Braidon PV-1B: rafters + ridge band vanished west of PV-1's overlap —
  // "your firewalk is cut off", 2026-07-20). Every clip id is namespaced with
  // a per-render sequence number.
  // Deterministic namespace: byte-identical re-renders are a legacy-sweep
  // invariant, so a sequence counter is out. The ONLY geometry differentiator
  // between same-document renders is branch mode (leftReserve/transform);
  // same-mode renders share ids AND identical clip geometry (harmless).
  const _svgNs = (panelColorById && panelColorById.size > 0) ? 'b' : 'p';
  const els: string[] = [];
  // v65: pre-compute branch-color mode flag (needed for title bar)
  const isBranchColorMode = !!(panelColorById && panelColorById.size > 0);

  els.push(drawSVGOpen(W, H));
  // Pro-reference restyle (Ray, 2026-07-01: match the PE-sealed set): white sheet,
  // white roof linework, red-HATCHED setback bands, white modules w/ attachment
  // dots — monochrome CAD language instead of tinted fills ("cartoony").
  els.push(drawBackground(W, H, '#ffffff'));
  // Red diagonal hatch for the fire-setback band (the reference's signature mark).
  els.push(`<defs><pattern id="hatch-setback" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#cc2222" stroke-width="0.7"/></pattern></defs>`);
  // Setback hatch is DEFERRED and painted OVER the modules: painting modules
  // on top hid every encroachment (modules sitting in the 36" band read as
  // clean roof). Quads + label positions collected for encroachment counting
  // and label de-collision.
  const deferredBandEls: string[] = [];
  const bandQuads: Array<Array<{ x: number; y: number }>> = [];
  const bandLabelPts: Array<{ x: number; y: number }> = [];
  // Viewport title (reference style) renders BELOW the drawing — the old
  // full-width solid-black banner read as a web dashboard, not a CAD sheet.
  let svgTitle = isBranchColorMode
    ? 'CIRCUIT LAYOUT — AC BRANCH COLOR MAP'
    : 'ROOF PLAN WITH MODULES';

  // ── GPS coordinate → SVG mapping ──
  const allLats = regPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lat));
  const allLngs = regPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lng));
  const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs), maxLng = Math.max(...allLngs);
  const latSpan = maxLat - minLat || 0.001;   // ROOF span — drives the overall dimensions
  const lngSpan = maxLng - minLng || 0.001;

  // ── Site context (PV-2 only): county-GIS parcel + street projected into THIS
  // frame (roofSiteContext already converted real lat/lng → fake-degrees via the
  // CAD origin). When present, the FIT WINDOW expands to include the lot so the
  // property line / driveway / sidewalk render to-scale around the roof; the
  // roof's own dimensions still use the roof span above. Absent → fit = roof
  // (identical to the prior behavior — no fabricated lot on parcel-less jobs).
  // Site context now renders on BOTH PV-1 and PV-1B (faded on PV-1B so the
  // circuit wiring stays the hero) — a bare white circuit sheet read as
  // unfinished next to PV-1's rich contextual plan. (_site was resolved — and
  // plan-rotated — in the global-rotation block above.)
  // Expand the fit to include the parcel + surrounding building footprints so the
  // lot + neighbors show (capped inside computeFitWindow so the roof stays large).
  const _ctxPts = _site
    ? [...(_site.parcel ?? []), ..._site.buildings.flat(), ..._site.roads.flatMap(r => r.pts), ..._site.driveways.flat()]
    : [];
  // ── HYBRID overlays (ground arrays + fence) are SUBJECT MATTER ─────────────
  // Ray: the top-down aerial must show ALL the variety — roof, ground AND
  // fence. Their projected extents are unioned into the fit basis (below) so
  // computeFitWindow's zoom caps can never clip them like mere context.
  // (_hyb was built — and plan-rotated — in the global-rotation block above.)
  // FIT BASIS = roof + GROUND (+ FENCE when the site layer exists).
  // Ray 2026-07-14 excluded the fence ("roof+ground hero") because with NO
  // parcel data the union ballooned into a dead white yard. Ray 2026-07-16
  // reversed it for parcel-backed sheets: "show the cached parcel from
  // nearmap [rather] than trying to show tid bits" — with the Nearmap/GIS
  // layer the yard is real content and the fence is subject matter ON it.
  // Parcel-less jobs keep the old tight framing (fence = arrow only).
  const _fFitPts = (_site && _hyb) ? _hyb.fence.flatMap(f => f.line) : [];
  const _gPts = _hyb ? [..._hyb.ground.flatMap(g => g.ring), ..._fFitPts] : [];
  const _hLngs = _gPts.map(p => p.lng);
  const _hLats = _gPts.map(p => p.lat);
  const subjMinLng = _hLngs.length ? Math.min(minLng, ..._hLngs) : minLng;
  const subjMaxLng = _hLngs.length ? Math.max(maxLng, ..._hLngs) : maxLng;
  const subjMinLat = _hLats.length ? Math.min(minLat, ..._hLats) : minLat;
  const subjMaxLat = _hLats.length ? Math.max(maxLat, ..._hLats) : maxLat;

  // ── BIG / SHARED PARCEL → frame the SUBJECT building only ──────────────────
  // If the parcel is far larger than the roof (an apartment complex — Braidon's
  // building is 1 of ~13 on a 3.12-ac lot — or a big rural parcel), fitting the
  // whole lot shrinks the building to a dot. We only want to see what we're
  // working on (Ray 2026-07-08), so frame the subject building tight (attachment
  // detail stays readable). A normal home lot (parcel ≈ a couple× the roof) still
  // shows the full lot + street. Uses parcel-vs-roof extent — robust, unlike a
  // point-in-parcel test against OSM footprints that don't register to the GIS lot.
  let _bigLot = false;
  if (_site?.parcel && _site.parcel.length >= 3) {
    const _pl = _site.parcel.map(p => p.lng), _pa = _site.parcel.map(p => p.lat);
    const parcelW = Math.max(..._pl) - Math.min(..._pl);   // fake-deg = ft
    const parcelH = Math.max(..._pa) - Math.min(..._pa);
    _bigLot = parcelW > 2 * lngSpan || parcelH > 2 * latSpan;
  }
  // Circuit sheet (PV-1B) frames the ARRAY, not the whole roof plane — a small
  // array on a big roof otherwise renders as a tiny cluster in a sea of white.
  // PV-1B framing ruling (Ray, 2026-07-20 — "the zoom is nowhere near right…
  // we lost the visuals like in PV1"): the circuit sheet uses the SAME window
  // as PV-1, site context and all. The earlier tight array-only fit stripped
  // the sidewalks/trees and made the rafter grid (which only exists under the
  // plane polygons) read as "gone" at close zoom. The wiring stays the hero
  // via color + the annotation-free site layer (drawn at reduced opacity).
  const _fit = ((_site && _ctxPts.length > 0)
    // v21 review: the subject roof rendered at ~38% of the window (1/2.6) with
    // the neighbor's tree canopy dominating. Tighter caps keep the roof ≥ ~50%
    // (≥ 80% on big lots); nearest context still shows, SVG clips the rest.
    // PV-1B: tighter still (1.35 → roof ≥ ~74% of the window) — the wiring is
    // the subject; sidewalks/trees remain a visible ring, never the hero.
    // Same window on BOTH sheets — PV-1B's extra scale comes from the freed
    // left reserve alone, never from a different crop of the map.
    ? computeFitWindow({ minLng: subjMinLng, maxLng: subjMaxLng, minLat: subjMinLat, maxLat: subjMaxLat }, _ctxPts, { maxZoomOut: _bigLot ? 1.25 : 2.0 })
    : { minLng: subjMinLng, maxLng: subjMaxLng, minLat: subjMinLat, maxLat: subjMaxLat });
  const fitLatSpan = _fit.maxLat - _fit.minLat || 0.001;
  const fitLngSpan = _fit.maxLng - _fit.minLng || 0.001;

  // (margin + leftReserve are declared with the layout zones above — the
  // plan-rotation fill choice shares them.)
  const scaleX  = (dz.width  - 2 * margin - leftReserve) / fitLngSpan;
  const scaleY  = (dz.height - 2 * margin) / fitLatSpan;
  // Fit-to-frame (was *1.35, which overzoomed and clipped the top hip + the
  // setback dimension off the page for frame-filling roofs — caught via harness).
  const scale   = Math.min(scaleX, scaleY);

  // Center the fit WINDOW (roof, or roof+lot when site context is present) in
  // the draw zone.
  const winWpx = fitLngSpan * scale;
  const winHpx = fitLatSpan * scale;
  const offX = Math.max(0, (dz.width  - 2 * margin - leftReserve - winWpx) / 2);
  const offY = Math.max(0, (dz.height - 2 * margin - winHpx) / 2);
  const toX = (lng: number) => dz.x  + margin + leftReserve + offX + (lng - _fit.minLng) * scale;
  const toY = (lat: number) => dz.y  + (dz.height - margin) - offY - (lat - _fit.minLat) * scale;

  // ── Site layer — drawn UNDER the roof (roof linework paints on top), clipped
  // to the draw zone so off-window neighbors/roads can't spill onto the tables
  // or off-sheet. ──
  let _siteLegend: Array<{ swatch: string; label: string }> = [];
  // Property-line setback ring distance — the SAME engine value the ground/fence
  // sheets print (CADGroundModel.setbackFt ← layout.groundSetbackFt; ground.ts
  // "Array setback X' min. from property line"). Only meaningful when yard
  // systems exist on this plan; roof-only jobs draw no ring (a roof array has
  // no P/L setback claim to make).
  const _plSetbackFt: number | null = _hyb
    ? (cad?.ground?.setbackFt ?? (layout as { groundSetbackFt?: number } | undefined)?.groundSetbackFt ?? null)
    : null;
  // Site layer on BOTH sheets — PV-1 gets the full annotated site plan;
  // PV-1B keeps the same VISUALS (roads, sidewalks, trees, buildings, parcel
  // line) at reduced opacity behind the wiring, but with annotations:false —
  // no parcel dims, no PROPERTY LINE tags, no setback ring/dims, no service
  // cluster, no trench notes. Ray 2026-07-20: "We lost the visuals like in
  // PV1" reversed the brief no-site experiment; the furniture stays off.
  if (_site) {
    try {
      const sr = drawSiteContextEls(_site, { minLng, maxLng, minLat, maxLat }, toX, toY,
        { plSetbackFt: _plSetbackFt, fitWin: _fit, annotations: !isBranchColorMode });
      if (sr.els.length) {
        els.push(`<defs><clipPath id="pv2site-clip${_svgNs}"><rect x="${dz.x}" y="${dz.y}" width="${dz.width}" height="${dz.height}"/></clipPath></defs>`);
        els.push(`<g class="pv2-site" clip-path="url(#pv2site-clip${_svgNs})"${isBranchColorMode ? ' opacity="0.5"' : ''}>${sr.els.join('')}</g>`);
        _siteLegend = sr.legend;
        svgTitle = 'SITE & ROOF PLAN WITH MODULES';
      }
    } catch (e) {
      console.warn('[drawRoofPlan] site context skipped (non-fatal):', (e as Error)?.message);
    }
  }

  // ── HYBRID overlay layer: GROUND arrays drawn to-scale on the site plan ─────
  // (Fence is NOT drawn to-scale here — it sits 100+ ft off and ballooned the
  // window; it renders in the SITE KEY inset below. Ray 2026-07-14.)
  if (_hyb) {
    // Liang-Barsky segment/rect clip against the draw zone (fence + trench runs)
    const clipToDz = (x1: number, y1: number, x2: number, y2: number): [number, number, number, number] | null => {
      const dx = x2 - x1, dy = y2 - y1;
      let t0 = 0, t1 = 1;
      const edges: Array<[number, number]> = [
        [-dx, x1 - dz.x], [dx, dz.x + dz.width - x1],
        [-dy, y1 - dz.y], [dy, dz.y + dz.height - y1],
      ];
      for (const [p, q] of edges) {
        if (p === 0) { if (q < 0) return null; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
      return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
    };
    const hEls: string[] = [];
    for (const g of _hyb.ground) {
      const pts = g.ring.map(p => `${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ');
      hEls.push(`<polygon points="${pts}" fill="#2b6cb0" fill-opacity="0.14" stroke="#2b6cb0" stroke-width="1.6"/>`);
      // Per-module cell divisions so the array reads as a real N-up array.
      for (const [a, b] of [...g.rowLines, ...g.cellLines]) {
        hEls.push(`<line x1="${toX(a.lng).toFixed(1)}" y1="${toY(a.lat).toFixed(1)}" x2="${toX(b.lng).toFixed(1)}" y2="${toY(b.lat).toFixed(1)}" stroke="#2b6cb0" stroke-width="0.8"/>`);
      }
      if (g.label) {
        // Clamp the label into the visible draw zone — PV-1B's tight array
        // framing can push the ground array to the clipped edge, burying the
        // label under the right sidebar (Ray: "pages getting cut off").
        const glx = Math.min(Math.max(toX(g.labelPt.lng), dz.x + 70), dz.x + dz.width - 70);
        const gly = Math.min(Math.max(toY(g.labelPt.lat), dz.y + 14), dz.y + dz.height - 18);
        hEls.push(`<text x="${glx.toFixed(1)}" y="${gly.toFixed(1)}" font-size="8" font-weight="bold" fill="#2b6cb0" text-anchor="middle" stroke="#fff" stroke-width="2.4" paint-order="stroke">${g.label}</text>`);
        if (isBranchColorMode) {
          hEls.push(`<text x="${glx.toFixed(1)}" y="${(gly + 10).toFixed(1)}" font-size="6.2" font-weight="bold" fill="#1b5eb5" text-anchor="middle" stroke="#fff" stroke-width="2" paint-order="stroke">STRINGS: SEE PV-1BG</text>`);
        }
      }
    }
    if (hEls.length) {
      els.push(`<g class="pv2-hybrid">${hEls.join('')}</g>`);
      _siteLegend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#2b6cb0" fill-opacity="0.14" stroke="#2b6cb0" stroke-width="1"/><line x1="7" y1="-4" x2="7" y2="4" stroke="#2b6cb0" stroke-width="0.7"/>`, label: 'GROUND-MOUNT ARRAY (SEE GROUND SHEETS)' });
      if (_hyb.fence.length) _siteLegend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#1a7a3a" stroke-width="2.6" stroke-linecap="round"/>`, label: 'SOLAR FENCE RUN (SEE FENCE SHEETS)' });
    }
    // Fence on the main plan: draw the run's VISIBLE portion (clipped to the
    // draw zone) at its true rotated bearing. The direction arrow is only the
    // fallback when the fence is entirely (or nearly) off-frame — its angle is
    // direction-to-fence, NOT fence bearing, so it must never stand in for a
    // drawable fence (that regressed the plan-rotation e2e test when the
    // mini-map's real fence line was removed).
    const _fenceOffFrame: typeof _hyb.fence = [];
    if (_hyb.fence.length) {
      for (const f of _hyb.fence) {
        const c = clipToDz(toX(f.line[0].lng), toY(f.line[0].lat), toX(f.line[1].lng), toY(f.line[1].lat));
        // draw only when a meaningful run is visible; tiny slivers → arrow
        if (c && Math.hypot(c[2] - c[0], c[3] - c[1]) >= 40) {
          els.push(`<line x1="${c[0].toFixed(1)}" y1="${c[1].toFixed(1)}" x2="${c[2].toFixed(1)}" y2="${c[3].toFixed(1)}" stroke="#1a7a3a" stroke-width="3" stroke-linecap="round"/>`);
          els.push(`<text x="${((c[0] + c[2]) / 2).toFixed(1)}" y="${((c[1] + c[3]) / 2 - 5).toFixed(1)}" font-size="6.2" font-weight="700" fill="#1a7a3a" text-anchor="middle" stroke="#fff" stroke-width="2" paint-order="stroke">SOLAR FENCE → SEE PV-1F</text>`);
        } else {
          _fenceOffFrame.push(f);
        }
      }
    }
    if (_fenceOffFrame.length) {
      const fPts = _fenceOffFrame.flatMap(f => [f.line[0], f.line[1]]);
      const fLat = fPts.reduce((s, p) => s + p.lat, 0) / fPts.length;
      const fLng = fPts.reduce((s, p) => s + p.lng, 0) / fPts.length;
      // Arrow points toward the fence's true plan position (same frame as the
      // ground overlay + mini-map), clamped to the draw-zone edge. Distance in
      // real feet can't be derived here — the overlay frame is normalized, not
      // GPS — so the label carries the fence run length + a "SEE PV-1F" pointer,
      // not a fabricated distance.
      const cx = dz.x + dz.width / 2, cy = dz.y + dz.height / 2;
      let ux = toX(fLng) - cx, uy = toY(fLat) - cy;
      const mag = Math.hypot(ux, uy) || 1; ux /= mag; uy /= mag;
      const halfW = dz.width / 2 - 30, halfH = dz.height / 2 - 30;
      const t = Math.min(
        Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity,
        Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity);
      const ax = cx + ux * t, ay = cy + uy * t;
      const a2x = ax + ux * 24, a2y = ay + uy * 24;
      els.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${a2x.toFixed(1)}" y2="${a2y.toFixed(1)}" stroke="#1a7a3a" stroke-width="2.6"/>`);
      els.push(`<path d="M${a2x.toFixed(1)},${a2y.toFixed(1)} L${(a2x - ux * 9 - uy * 4.5).toFixed(1)},${(a2y - uy * 9 + ux * 4.5).toFixed(1)} L${(a2x - ux * 9 + uy * 4.5).toFixed(1)},${(a2y - uy * 9 - ux * 4.5).toFixed(1)} Z" fill="#1a7a3a"/>`);
      const fLen = _fenceOffFrame[0]?.label?.match(/·\s*([^·]+L\.F\.)/)?.[1]?.trim() ?? 'SOLAR FENCE';
      els.push(`<text x="${ax.toFixed(1)}" y="${(ay - 8).toFixed(1)}" font-size="7" font-weight="bold" fill="#1a7a3a" text-anchor="middle" stroke="#fff" stroke-width="2.6" paint-order="stroke">SOLAR FENCE ${fLen} → SEE PV-1F</text>`);
    }

    // ── (N) TRENCH / CONDUIT ROUTES (reference: the "(N) ~ TRENCHING" runs) ──
    // Schematic dashed orthogonal runs from each yard array group (ground +
    // fence) toward the PV interconnection point. Drawn ONLY when the site
    // layer actually located service equipment (meter GPS / street-side
    // heuristic) — no service point, no invented route. Routes are explicitly
    // schematic: label says ROUTE FIELD-VERIFIED. Clipped to the draw zone.
    if (!isBranchColorMode && _site && _site.equipment.length && (_hyb.ground.length || _hyb.fence.length)) {
      const _svcE = _site.equipment.find(e => e.kind === 'utility_meter') ?? _site.equipment[0];
      const spx = toX(_svcE.pt.lng), spy = toY(_svcE.pt.lat);
      type Pt2 = { x: number; y: number };
      const starts: Array<{ p: Pt2; kind: 'ground' | 'fence' }> = [];
      for (const g of _hyb.ground) {
        let best = g.ring[0], bd = Infinity;
        for (const p of g.ring) {
          const d = (toX(p.lng) - spx) ** 2 + (toY(p.lat) - spy) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        starts.push({ p: { x: toX(best.lng), y: toY(best.lat) }, kind: 'ground' });
      }
      for (const f of _hyb.fence) {
        const c0: Pt2 = { x: toX(f.line[0].lng), y: toY(f.line[0].lat) };
        const c1: Pt2 = { x: toX(f.line[1].lng), y: toY(f.line[1].lat) };
        starts.push({
          p: ((c0.x - spx) ** 2 + (c0.y - spy) ** 2) <= ((c1.x - spx) ** 2 + (c1.y - spy) ** 2) ? c0 : c1,
          kind: 'fence',
        });
      }
      // Roof bbox (screen) — routes must not read as trenching THROUGH the
      // house: of the two orthogonal elbows, keep the one whose legs overlap
      // the roof footprint least; labels only ride legs clear of the roof.
      const _rbx0 = toX(minLng), _rbx1 = toX(maxLng), _rby0 = toY(maxLat), _rby1 = toY(minLat);
      const _roofOverlap = (a: Pt2, b: Pt2): number => {
        if (Math.abs(a.y - b.y) < 0.01) {   // horizontal leg
          if (a.y < _rby0 || a.y > _rby1) return 0;
          return Math.max(0, Math.min(Math.max(a.x, b.x), _rbx1) - Math.max(Math.min(a.x, b.x), _rbx0));
        }
        if (a.x < _rbx0 || a.x > _rbx1) return 0;
        return Math.max(0, Math.min(Math.max(a.y, b.y), _rby1) - Math.max(Math.min(a.y, b.y), _rby0));
      };
      const tEls: string[] = [];
      const _labeledKinds = new Set<string>();
      starts.forEach((s, i) => {
        const st = s.p;
        if (Math.hypot(st.x - spx, st.y - spy) < 24) return;   // array abuts the wall — no run to draw
        const off = i * 4;   // stagger shared legs so routes don't merge into one heavy line
        const hFirst: Array<[Pt2, Pt2]> = [
          [st, { x: spx + off, y: st.y }],
          [{ x: spx + off, y: st.y }, { x: spx + off, y: spy }],
        ];
        const vFirst: Array<[Pt2, Pt2]> = [
          [st, { x: st.x, y: spy + off }],
          [{ x: st.x, y: spy + off }, { x: spx, y: spy + off }],
        ];
        const ovOf = (segs: Array<[Pt2, Pt2]>) => segs.reduce((sum, [a, b]) => sum + _roofOverlap(a, b), 0);
        const segs = ovOf(vFirst) < ovOf(hFirst) ? vFirst : hFirst;
        let bestSeg: [number, number, number, number] | null = null, bestScore = -Infinity;
        for (const [a, b] of segs) {
          const c = clipToDz(a.x, a.y, b.x, b.y);
          if (!c) continue;
          tEls.push(`<line x1="${c[0].toFixed(1)}" y1="${c[1].toFixed(1)}" x2="${c[2].toFixed(1)}" y2="${c[3].toFixed(1)}" stroke="#3a3f46" stroke-width="1.1" stroke-dasharray="7 3.5"/>`);
          const L = Math.hypot(c[2] - c[0], c[3] - c[1]);
          const score = L - 4 * _roofOverlap(a, b);   // prefer long legs CLEAR of the roof
          if (score > bestScore) { bestScore = score; bestSeg = c; }
        }
        // one label per system kind, on a leg FULLY CLEAR of the roof + its
        // dimension/callout band (a half-covered label read worse than none)
        const _clearOfRoof = bestSeg
          ? !(Math.min(bestSeg[0], bestSeg[2]) < _rbx1 + 25 && Math.max(bestSeg[0], bestSeg[2]) > _rbx0 - 25 &&
              Math.min(bestSeg[1], bestSeg[3]) < _rby1 + 58 && Math.max(bestSeg[1], bestSeg[3]) > _rby0 - 25)
          : false;
        if (bestSeg && bestScore > 70 && _clearOfRoof && !_labeledKinds.has(s.kind)) {
          _labeledKinds.add(s.kind);
          const mx = (bestSeg[0] + bestSeg[2]) / 2, my = (bestSeg[1] + bestSeg[3]) / 2;
          let ang = Math.atan2(bestSeg[3] - bestSeg[1], bestSeg[2] - bestSeg[0]) * 180 / Math.PI;
          if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
          tEls.push(`<text x="${mx.toFixed(1)}" y="${(my - 3.5).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.4" font-weight="bold" fill="#3a3f46" stroke="#fff" stroke-width="1.6" paint-order="stroke">(N) TRENCH — ${routeProvenanceLabel(ctx?.snapshot)}</text>`);
        }
      });
      if (tEls.length) {
        els.push(`<g class="pv1-trench">${tEls.join('')}</g>`);
        _siteLegend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#3a3f46" stroke-width="1.1" stroke-dasharray="4 2"/>`, label: '(N) TRENCH / CONDUIT ROUTE — FIELD VERIFY' });
      }
    }
  }

  // ── Draw roof planes ──
  // Plane labels are collected here and rendered AFTER the panels so the modules
  // never paint over them (the old "ANE 2 / E FAC" clipping).
  const planeLabels: Array<{ cx: number; cy: number; ri: number; pitch: any; azimuth: any }> = [];
  const interiorEdgesXY: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  // per-plane framing grid — attachment feet snap onto these lines
  const framingGrids: Array<{ fAz: number; spacingPx: number; bcx: number; bcy: number } | null> = [];
  regPlanes.forEach((rp: any, ri: number) => {
    const ptsXY = rp.vertices!.map((v: any) => ({ x: toX(v.lng), y: toY(v.lat) }));
    const pts = ptsXY.map((p: { x: number; y: number }) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

    // Roof plane — WHITE with fine black linework (reference CAD style; the gray
    // fills + shingle texture were the "cartoony" read).
    els.push(`<polygon points="${pts}" fill="#ffffff" stroke="none"/>`);

    // Per-edge fire-setback bands + line weights. Classification:
    //   interior (shared with another facet) = RIDGE/HIP → band + heavy line
    //   perimeter, outward normal ≈ downslope   = EAVE   → NO band (no code
    //     requirement — panels run to the gutter; Ray: "if there is no firewalk
    //     on the eave it needs to not show") + fine line
    //   perimeter otherwise                     = RAKE   → band + fine line
    const nV = ptsXY.length;
    const clipId = `sb${_svgNs}c${ri}`;
    els.push(`<defs><clipPath id="${clipId}"><polygon points="${pts}"/></clipPath></defs>`);
    const bands: string[] = [];
    const edgeLines: string[] = [];
    const az = (typeof rp.azimuth === 'number' && isFinite(rp.azimuth)) ? rp.azimuth : null;
    // downslope unit vector in (lng, lat) CAD space — azimuth 0° = faces north = +lat
    const dsX = az != null ? Math.sin(az * Math.PI / 180) : 0;
    const dsY = az != null ? Math.cos(az * Math.PI / 180) : 0;

    // ── Framing lines (rafters / truss top chords @ rafterSp O.C.) ──
    // Thin light lines running along the fall line (eave → ridge), clipped to
    // the facet — the reference sets show framing under the array, and the
    // attachment dots land ON these lines. Snapped to the sheet axes like the
    // modules so the grid reads drafted, not traced.
    if (az != null) {
      // Residual snap only — the global plan rotation already squared the
      // building, so plane azimuths sit within a few degrees of the axes.
      const fAz = snapAxisDeg(((az % 180) + 180) % 180);
      const fdX = Math.sin(fAz * Math.PI / 180), fdY = -Math.cos(fAz * Math.PI / 180); // screen dir (y down)
      const fpX = -fdY, fpY = fdX;                                                     // across-slope
      const bxs = ptsXY.map((p: { x: number; y: number }) => p.x);
      const bys = ptsXY.map((p: { x: number; y: number }) => p.y);
      const bcx = (Math.min(...bxs) + Math.max(...bxs)) / 2;
      const bcy = (Math.min(...bys) + Math.max(...bys)) / 2;
      const halfDiag = Math.hypot(Math.max(...bxs) - Math.min(...bxs), Math.max(...bys) - Math.min(...bys)) / 2 + 4;
      const spacingPx = Math.max((rafterSp / 12) * scale, 6);
      const nLines = Math.ceil(halfDiag / spacingPx);
      const framing: string[] = [];
      for (let k = -nLines; k <= nLines; k++) {
        const oxp = bcx + fpX * k * spacingPx, oyp = bcy + fpY * k * spacingPx;
        framing.push(`<line x1="${(oxp - fdX * halfDiag).toFixed(1)}" y1="${(oyp - fdY * halfDiag).toFixed(1)}" x2="${(oxp + fdX * halfDiag).toFixed(1)}" y2="${(oyp + fdY * halfDiag).toFixed(1)}" stroke="#c8cdd5" stroke-width="0.45"/>`);
      }
      els.push(`<g clip-path="url(#${clipId})">${framing.join('')}</g>`);
      framingGrids[ri] = { fAz, spacingPx, bcx, bcy };
    } else {
      framingGrids[ri] = null;
    }
    for (let ei = 0; ei < nV; ei++) {
      const a = ptsXY[ei], b = ptsXY[(ei + 1) % nV];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) continue;   // degenerate/closing dup
      const va = rp.vertices![ei], vb = rp.vertices![(ei + 1) % nV];
      const adjIdx = interiorEdgeAdj(va, vb, regPlanes, ri);
      const interior = adjIdx >= 0;
      // IFC 2021 §1204.2 is PER EDGE TYPE, not one blanket width: the ridge
      // gets the coverage-resolved setback (18"/36"), hips and valleys need
      // only an 18" clear path, and eaves/rakes have NO fire setback at all
      // (access is handled by the drawn pathways). The old blanket band
      // hatched hips at 3'-0" and rakes too — half the roof read as keep-out.
      let edgeKind: 'ridge' | 'hip' | 'perimeter' = 'perimeter';
      if (interior) {
        const azA = rp.azimuth, azB = (regPlanes[adjIdx] as any)?.azimuth;
        if (isFinite(azA) && isFinite(azB)) {
          const d = Math.abs(((azA - azB) % 360 + 360) % 360);
          edgeKind = Math.min(d, 360 - d) > 135 ? 'ridge' : 'hip';
        } else edgeKind = 'ridge';   // no azimuths → conservative
      }
      const HIP_SETBACK_FT = 1.5;   // IFC 2021 §1204.2.1.2 — 18" clear at hips/valleys
      const edgeSetbackFt = edgeKind === 'ridge' ? setbackFt : HIP_SETBACK_FT;
      // Inward unit normal (screen space) — probe a point just off the midpoint.
      const ex = b.x - a.x, ey = b.y - a.y, el = Math.hypot(ex, ey);
      let nx = -ey / el, ny = ex / el;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!ptInRingXY(mx + nx * 3, my + ny * 3, ptsXY)) { nx = -nx; ny = -ny; }
      // SLOPE→PLAN band width: the IFC distance is walked ON the surface, so
      // only the offset's FALL-LINE component foreshortens in plan:
      //   k = √(1 − (n̂·f̂)²·sin²(pitch))
      // Ridge/eave offsets run straight down-slope (n̂‖f̂) → k = cos(pitch);
      // rake-parallel (cross-slope) offsets → k = 1 (NO foreshortening);
      // diagonal hips/valleys land in between. f̂ = plan downslope unit from
      // the plane azimuth (screen y is flipped: −dsY).
      const _sinP2 = 1 - planeCosP[ri] * planeCosP[ri];
      const _fdot = az != null ? Math.abs(nx * dsX + ny * (-dsY)) : 0;
      const _kPlan = Math.sqrt(Math.max(0, 1 - Math.min(1, _fdot * _fdot) * _sinP2));
      const dPx = edgeSetbackFt * _kPlan * scale;
      if (interior) {
        const a2x = a.x + nx * dPx, a2y = a.y + ny * dPx;
        const b2x = b.x + nx * dPx, b2y = b.y + ny * dPx;
        bands.push(`<polygon points="${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)} ${a2x.toFixed(1)},${a2y.toFixed(1)}" fill="url(#hatch-setback)" opacity="0.45" stroke="none"/>`);
        bands.push(`<line x1="${a2x.toFixed(1)}" y1="${a2y.toFixed(1)}" x2="${b2x.toFixed(1)}" y2="${b2y.toFixed(1)}" class="line-setbk"/>`);
        bandQuads.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b2x, y: b2y }, { x: a2x, y: a2y }]);
        // Reference-style IN-BAND label on long bands (rotated to the band
        // axis). Labels de-collide globally — every short hip band carrying
        // its own rotated label produced the NW/SE-corner crisscross.
        if (!isBranchColorMode && el > 150) {
          const bmx = (a.x + b.x) / 2 + nx * dPx * 0.5;
          const bmy = (a.y + b.y) / 2 + ny * dPx * 0.5;
          if (!bandLabelPts.some(q => Math.hypot(q.x - bmx, q.y - bmy) < 60)) {
            bandLabelPts.push({ x: bmx, y: bmy });
            let angDeg = Math.atan2(ey, ex) * 180 / Math.PI;
            if (angDeg > 90) angDeg -= 180; else if (angDeg < -90) angDeg += 180;   // never upside-down
            bands.push(`<text x="${bmx.toFixed(1)}" y="${(bmy + 2).toFixed(1)}" transform="rotate(${angDeg.toFixed(1)} ${bmx.toFixed(1)} ${bmy.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.4" font-weight="bold" fill="#b91c1c" opacity="0.9">${ftToFtIn(edgeSetbackFt)} ${edgeKind === 'ridge' ? 'RIDGE' : 'HIP/VALLEY'} SETBACK</text>`);
          }
        }
      }
      if (interior) interiorEdgesXY.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      edgeLines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#000" stroke-width="${interior ? 2.4 : 1.3}"/>`);
    }
    deferredBandEls.push(`<g clip-path="url(#${clipId})">${bands.join('')}</g>`);
    els.push(...edgeLines);

    // Plane label — collected, rendered after panels (see planeLabels render below)
    const cx = rp.vertices!.reduce((s: number, v: any) => s + toX(v.lng), 0) / rp.vertices!.length;
    const cy = rp.vertices!.reduce((s: number, v: any) => s + toY(v.lat), 0) / rp.vertices!.length;
    planeLabels.push({ cx, cy, ri, pitch: rp.pitch, azimuth: rp.azimuth });
  });

  // ── Fire-access pathways (IFC 2021 §1204.2.1) — DRAWN, not just noted ──
  // For each panel-bearing plane, find the widest module-free strip running
  // eave→ridge; when it fits the required pathway width, hatch and label it.
  // The pathway existed only as note TEXT before — a plan checker looking for
  // the code-required 36" route found nothing in the geometry.
  let _pathwaysDrawn = 0;
  regPlanes.forEach((rp: any, ri: number) => {
    if (!rp.vertices || rp.vertices.length < 3) return;
    const planePanels = regPanels.filter((p: any) => ptInLatLngRing(p.lat, p.lng, rp.vertices));
    if (!planePanels.length) return;
    const ptsXY = rp.vertices.map((v: any) => ({ x: toX(v.lng), y: toY(v.lat) }));
    // Screen-space downslope basis (v = eave→ridge axis, u = along-eave axis)
    const az = (typeof rp.azimuth === 'number' && isFinite(rp.azimuth)) ? rp.azimuth : 180;
    const c0lng = rp.vertices.reduce((s: number, v: any) => s + v.lng, 0) / rp.vertices.length;
    const c0lat = rp.vertices.reduce((s: number, v: any) => s + v.lat, 0) / rp.vertices.length;
    let vdx = toX(c0lng + Math.sin(az * Math.PI / 180)) - toX(c0lng);
    let vdy = toY(c0lat + Math.cos(az * Math.PI / 180)) - toY(c0lat);
    const vl = Math.hypot(vdx, vdy) || 1; vdx /= vl; vdy /= vl;
    const udx = -vdy, udy = vdx;
    const uOf = (x: number, y: number) => x * udx + y * udy;
    const vOf = (x: number, y: number) => x * vdx + y * vdy;
    const us = ptsXY.map((p: any) => uOf(p.x, p.y));
    const vs = ptsXY.map((p: any) => vOf(p.x, p.y));
    const uMin = Math.min(...us), uMax = Math.max(...us);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    // Occupied intervals along the eave axis (panels padded to footprint)
    const _padPx = (Math.max(panelLenIn, panelWidIn) / 12) * scale / 2 + 2;
    const occ = planePanels
      .map((p: any) => { const u = uOf(toX(p.lng), toY(p.lat)); return [u - _padPx, u + _padPx] as [number, number]; })
      .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const iv of occ) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const gaps: Array<[number, number]> = [];
    let cur = uMin;
    for (const [s, e] of merged) { if (s > cur) gaps.push([cur, s]); cur = Math.max(cur, e); }
    if (cur < uMax) gaps.push([cur, uMax]);
    // Pathway WIDTH is measured CROSS-SLOPE (perpendicular to the eave→ridge
    // walk), so it projects 1:1 into plan — NO cos(pitch) here (only fall-line
    // components foreshorten; see the slope→plan block above).
    const needPx = pathwayFt * scale;
    const best = gaps.filter(g => g[1] - g[0] >= needPx)
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    if (!best) return;
    const gc = (best[0] + best[1]) / 2;
    const g0 = gc - needPx / 2, g1 = gc + needPx / 2;
    const corner = (u: number, v: number) => `${(u * udx + v * vdx).toFixed(1)},${(u * udy + v * vdy).toFixed(1)}`;
    const poly = [corner(g0, vMin), corner(g1, vMin), corner(g1, vMax), corner(g0, vMax)].join(' ');
    // Fire-access pathways belong on PV-1 (the fire/setback sheet); on PV-1B's
    // circuit map they just clutter the branch routing, so skip them here.
    if (!isBranchColorMode) {
      els.push(`<g clip-path="url(#sb${_svgNs}c${ri})"><polygon points="${poly}" fill="#1a7a2e" opacity="0.10" stroke="#1a7a2e" stroke-width="1" stroke-dasharray="6 3"/></g>`);
      const lmx = gc * udx + ((vMin + vMax) / 2) * vdx;
      const lmy = gc * udy + ((vMin + vMax) / 2) * vdy;
      let angDeg = Math.atan2(vdy, vdx) * 180 / Math.PI;
      if (angDeg > 90) angDeg -= 180; else if (angDeg < -90) angDeg += 180;
      els.push(`<text x="${lmx.toFixed(1)}" y="${lmy.toFixed(1)}" transform="rotate(${angDeg.toFixed(1)} ${lmx.toFixed(1)} ${lmy.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.6" font-weight="bold" fill="#1a7a2e">${ftToFtIn(pathwayFt)} ACCESS PATHWAY</text>`);
      _pathwaysDrawn++;
    }
  });

  // ── Draw panels (from CAD fake-degree positions) ──
  // Render modules at near-true footprint (was 0.8 → a sparse, scattered array).
  // 0.97 leaves only a hairline gap so adjacent panels read as a tight, real array.
  const panLenPx = Math.max((panelLenIn / 12) * scale * 0.97, 6);
  const panWidPx = Math.max((panelWidIn / 12) * scale * 0.97, 4);

  // W3.1 §2 — CANONICAL PROJECTION CONTEXT. When a validated snapshot is present,
  // module outlines, rails, attachment feet and splice markers are drawn as PURE
  // PROJECTIONS of their canonical coordinates: viewport ∘ DT-SITE(canonical),
  // where the viewport (registration-ft → sheet-px, scale/paper/flip ONLY) is fit
  // by least squares from DT-SITE(drawnPolygon centroid) → toX/toY(raw lng/lat).
  // The renderer no longer regularizes/geo-registers modules — the display
  // straightening lives in the snapshot's drawnPolygon; positions stay RAW
  // canonical (no panel moved). A single placement manifest is emitted for the
  // post-render checkRenderParity (V30/V31, blocking).
  const _placementEntries: PlacementEntry[] = [];
  let _projVp: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  let _projDTM: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  const _miByRawId = new Map<string, any>();
  if (ctx?.snapshot) {
    const _snap = ctx.snapshot;
    const _dt = (_snap.geometry.drawingTransforms ?? []).find((t: any) => t.transformId === 'DT-SITE') ?? null;
    if (_dt) {
      const _rawById = new Map(validPanels.map((p: any) => [String(p.id), p]));
      const _src: Array<{ x: number; y: number }> = [], _dst: Array<{ x: number; y: number }> = [];
      for (const mi of _snap.geometry.moduleInstances) {
        const rawId = String(mi.instanceId).replace(/^mi-/, '');
        _miByRawId.set(rawId, mi);
        const rp: any = _rawById.get(rawId);
        const poly = (mi.drawnPolygon ?? mi.polygon)?.points ?? [];
        if (!rp || !poly.length) continue;
        const cen = { x: poly.reduce((s: number, q: any) => s + q.x, 0) / poly.length, y: poly.reduce((s: number, q: any) => s + q.y, 0) / poly.length };
        _src.push(applyAffine(_dt.matrix, cen));
        _dst.push({ x: toX(rp.lng), y: toY(rp.lat) });
      }
      const vp = fitAffine(_src, _dst);
      if (vp) { _projVp = vp; _projDTM = _dt.matrix; }
    }
  }
  const _projectCanon = (xy: { x: number; y: number }) => applyAffine(_projVp!, applyAffine(_projDTM!, xy));
  const _canonCentroid = (poly: { points: Array<{ x: number; y: number }> }) => ({
    x: poly.points.reduce((s, q) => s + q.x, 0) / poly.points.length,
    y: poly.points.reduce((s, q) => s + q.y, 0) / poly.points.length,
  });

  // PV-1B circuit sheet: map each branch color → its circuit number (1-based), in
  // the order arrayPages assigned them (first appearance = B1..Bn = legend order).
  const branchIndexByColor = new Map<string, number>();
  if (isBranchColorMode && panelColorById) {
    for (const c of panelColorById.values()) {
      if (!branchIndexByColor.has(c)) branchIndexByColor.set(c, branchIndexByColor.size);
    }
  }

  // Reference-style modules: WHITE rectangle, fine dark-blue frame, attachment
  // dots at the rail-foot quarter points. Each module is ROTATED to its plane's
  // fall line (portrait long axis runs up-slope) — drawing every module
  // axis-aligned overlapped/poked-out the rotated end-plane (E/W) arrays.
  // PV-2B keeps solid branch-colored fills — that sheet IS a color map.
  regPanels.forEach((p: any) => {
    const px = toX(p.lng), py = toY(p.lat);
    const isLandscape = (p.orientation || 'landscape') === 'landscape';
    // SLOPE→PLAN: the rect's local HEIGHT runs up-slope after the azimuth
    // rotation below (portrait long side / landscape short side = the module's
    // fall-line dimension), so it foreshortens by cos(pitch); the cross-slope
    // width projects 1:1. Raw physical dims on plan-true centers overdrew
    // every module 1/cos(pitch) up-slope — the root of the phantom flags.
    const _cosP = panelCosP(p);
    const pw = isLandscape ? panLenPx : panWidPx;
    const ph = (isLandscape ? panWidPx : panLenPx) * _cosP;
    const x0 = px - pw / 2, y0 = py - ph / 2;
    const azRot = Number(p.azimuth ?? p.heading);
    // rotate so the long axis follows the plane azimuth. RESIDUAL snap only
    // (8°): the GLOBAL plan rotation squares the building, so azimuths land on
    // the sheet axes ± trace noise. The old 15° snap squared modules
    // INDEPENDENTLY of a tilted outline — the module-vs-outline mismatch.
    const rot = isFinite(azRot) ? snapAxisDeg(((azRot % 180) + 180) % 180) : 0;
    const gOpen = rot > 1 && rot < 179
      ? `<g transform="rotate(${rot.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})">` : '<g>';

    const branchColor = panelColorById?.get(p.id);
    // ── Module outline (system-agnostic) ──
    // W3.1/W4 §2 — the module outline is a PURE PROJECTION of the canonical
    // drawnPolygon (viewport∘DT-SITE) on EVERY sheet: PV-1 (structural) AND the
    // PV-1B circuit sheet draw the SAME 31 canonical polygons with the SAME ids,
    // so the two sheets never disagree on where a module is. The renderer never
    // recreates a rectangle from generic dims when the snapshot is present.
    // Only the STYLING differs: PV-1B strokes each module in its BRANCH color
    // with a light branch-colored fill (borders stay crisp on the white roof),
    // while the thin circuit wires + micro symbols (below) overlay — never
    // replace — the module layer. No snapshot (standalone preview / unit tests)
    // ⇒ legacy rect fallback, for both modes.
    const _mi = (_projVp && _projDTM) ? _miByRawId.get(String(p.id)) : null;
    const _canonPoly: Array<{ x: number; y: number }> | null =
      _mi && _mi.drawnPolygon?.points?.length ? _mi.drawnPolygon.points.map((c: any) => _projectCanon(c)) : null;
    const cNum = branchColor ? (branchIndexByColor.get(branchColor) ?? 0) + 1 : 0;
    if (_canonPoly && _mi) {
      const ptsStr = _canonPoly.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
      const stroke = branchColor ?? '#2c4a75';
      // branch-colored LIGHT fill on the circuit sheet; opaque near-white on the
      // structural sheet (that sheet's fill carries no circuit meaning).
      const fillAttr = branchColor
        ? `fill="${branchColor}" fill-opacity="0.14"`
        : `fill="#fdfdfd"`;
      els.push(`<polygon data-object-id="${_mi.instanceId}" points="${ptsStr}" ${fillAttr} stroke="${stroke}" stroke-width="${branchColor ? '1.1' : '0.8'}"/>`);
      _placementEntries.push({
        objectId: _mi.instanceId, kind: 'module',
        canonicalXY: _canonCentroid(_mi.drawnPolygon),
        sheetXY: { x: _canonPoly.reduce((s, c) => s + c.x, 0) / _canonPoly.length, y: _canonPoly.reduce((s, c) => s + c.y, 0) / _canonPoly.length },
      });
      if (branchColor) {
        // circuit tag + IQ8 micro symbol OVERLAY the branch-colored module,
        // placed from the PROJECTED polygon bbox so they track the canonical
        // geometry (upright) on every plane, incl. rotated E/W faces.
        const xs = _canonPoly.map(c => c.x), ys = _canonPoly.map(c => c.y);
        const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
        const bw = bx1 - bx0, bh = by1 - by0, bcx = (bx0 + bx1) / 2;
        const numFs = Math.max(Math.min(Math.min(bw, bh) * 0.30, 9), 4.2);
        els.push(`<text x="${bcx.toFixed(1)}" y="${(by0 + numFs + 1.5).toFixed(1)}" text-anchor="middle" font-size="${numFs.toFixed(1)}" font-weight="700" fill="${branchColor}">${cNum}</text>`);
        const micW = Math.max(Math.min(bw, bh) * 0.50, 4);
        const micH = Math.max(Math.min(bw, bh) * 0.18, 1.8);
        const micCy = by0 + bh * 0.62;
        els.push(`<rect x="${(bcx - micW / 2).toFixed(1)}" y="${(micCy - micH / 2).toFixed(1)}" width="${micW.toFixed(1)}" height="${micH.toFixed(1)}" fill="#2b2f36" stroke="${branchColor}" stroke-width="0.6" rx="0.6"/>`);
      }
    } else {
      // No snapshot geometry (standalone preview / unit tests): legacy local
      // rect, same styling split as the projected path above.
      const stroke = branchColor ?? '#2c4a75';
      const fillAttr = branchColor ? `fill="${branchColor}" fill-opacity="0.14"` : `fill="#fdfdfd"`;
      els.push(`${gOpen}<rect${canonicalObjIdAttr(p)} x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" ${fillAttr} stroke="${stroke}" stroke-width="${branchColor ? '1.1' : '0.8'}"/></g>`);
      if (branchColor) {
        const numFs = Math.max(Math.min(Math.min(pw, ph) * 0.22, 9), 4.2);
        els.push(`<text x="${px.toFixed(1)}" y="${(py - ph * 0.5 + numFs + 1.5).toFixed(1)}" text-anchor="middle" font-size="${numFs.toFixed(1)}" font-weight="700" fill="${branchColor}">${cNum}</text>`);
        const micW = Math.max(Math.min(pw, ph) * 0.44, 4);
        const micH = Math.max(Math.min(pw, ph) * 0.16, 1.8);
        const micCy = py + ph * 0.20;
        els.push(`<rect x="${(px - micW / 2).toFixed(1)}" y="${(micCy - micH / 2).toFixed(1)}" width="${micW.toFixed(1)}" height="${micH.toFixed(1)}" fill="#2b2f36" stroke="${branchColor}" stroke-width="0.6" rx="0.6"/>`);
      }
    }
  });

  // ── W3.1 §2 — RAILS · ATTACHMENTS · SPLICES as PURE PROJECTIONS of the
  // canonical snapshot coordinates. The former procedural rafter-grid foot
  // generation is DELETED: rail lines, attachment feet and splice markers are
  // now placed by applying the snapshot-carried DrawingTransform (DT-SITE) then a
  // viewport affine fit ONLY from the drawn module anchors (scale/paper/flip) —
  // the renderer no longer geo-registers or re-derives structural positions.
  // Every drawn object is tagged with its canonical data-object-id and emitted in
  // a placement manifest; generatePermit's post-render checkRenderParity enforces
  // drawn == transform(canonical) (+ no-omission) as a BLOCKING invariant.
  const _deckMountUsed = false;   // deck-foot heuristic retired with procedural placement
  // W4 §10 — snapshot-DRIVEN structural placement for EVERY roof system: railed
  // arrays draw canonical rails + attachment feet + splices; rail-less/direct-
  // mount arrays have EMPTY rails and draw canonical direct-mount attachment
  // feet. Both are pure projections (viewport∘DT-SITE) with manifest parity —
  // the `isRailless` name flag no longer gates PV-1 mount placement.
  if (!isBranchColorMode && _projVp && _projDTM && ctx?.snapshot) {
    const snap = ctx.snapshot;
    const cAtts = snap.structural.attachments ?? [];
    const cRails = snap.structural.rails ?? [];
    const project = _projectCanon;   // viewport∘DT-SITE, fit up-front from module anchors
    const railEls: string[] = [], feetEls: string[] = [], spliceEls: string[] = [];
    for (const r of cRails) {
      const a = project(r.startXY), b = project(r.endXY);
      railEls.push(`<line data-object-id="${r.railId}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#5a6478" stroke-width="0.8"/>`);
      _placementEntries.push({ objectId: r.railId, kind: 'rail',
        canonicalXY: { x: (r.startXY.x + r.endXY.x) / 2, y: (r.startXY.y + r.endXY.y) / 2 },
        sheetXY: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      (r.splicePointsXY ?? []).forEach((sp: { x: number; y: number }, k: number) => {
        const s = project(sp); const sid = `splice-${r.railId}-${k + 1}`;
        spliceEls.push(`<rect data-object-id="${sid}" x="${(s.x - 1.4).toFixed(1)}" y="${(s.y - 1.4).toFixed(1)}" width="2.8" height="2.8" fill="none" stroke="#b45309" stroke-width="0.8"/>`);
        _placementEntries.push({ objectId: sid, kind: 'splice', canonicalXY: sp, sheetXY: s });
      });
    }
    for (const at of cAtts) {
      const q = project(at.xy);
      feetEls.push(`<circle data-object-id="${at.attachmentId}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="1.15" fill="#2a5db0"/>`);
      _placementEntries.push({ objectId: at.attachmentId, kind: 'attachment', canonicalXY: at.xy, sheetXY: q });
    }
    els.push(`<g class="pv1-structural">${railEls.join('')}${feetEls.join('')}${spliceEls.join('')}</g>`);
  }
  // §2 — emit ONE placement manifest for this sheet (modules + rails + feet +
  // splices) for the post-render checkRenderParity (V30/V31, blocking).
  if (_projVp && _placementEntries.length) {
    els.push(emitPlacementManifestComment({
      sheetId: isBranchColorMode ? 'PV-1B' : 'PV-1', transformId: 'DT-SITE', viewport: _projVp, entries: _placementEntries,
    }));
  }

  // ── Setback hatch OVER the modules + encroachment accounting ──
  // Painting modules on top of the hatch hid every violation; the AHJ (and
  // Ray) must SEE a module sitting in the band. Encroaching modules get a red
  // corner flag; the count lands in the general notes.
  els.push(...deferredBandEls);
  let _encroachCount = 0;
  const _flagsByPlane = new Array(regPlanes.length).fill(0);
  if (!isBranchColorMode && bandQuads.length) {
    regPanels.forEach((p: any) => {
      const px = toX(p.lng), py = toY(p.lat);
      // FOOTPRINT test — center + all four corners (rotation-snapped like the
      // module renderer). The centers-only test let a module overlap a band by
      // half its width and still read as clean.
      // SAME slope→plan geometry as the drawn rects + bands: the fall-line
      // half-dimension foreshortens by cos(pitch). With bands ALSO plan-
      // projected (above), checking in plan space is now exact — the old raw
      // half-module vs raw band width read 62.2" plan ridge clearance as
      // 28.3" < 36" and flagged 16 compliant Stowell modules.
      const isLandscape = (p.orientation || 'landscape') === 'landscape';
      let hw = (isLandscape ? panLenPx : panWidPx) / 2;
      let hh = ((isLandscape ? panWidPx : panLenPx) / 2) * panelCosP(p);
      const azRot = Number(p.azimuth ?? p.heading);
      const rot = isFinite(azRot) ? ((azRot % 360) + 360) % 360 % 180 : 0;
      if (snapAxisDeg(rot) === 90) { const t = hw; hw = hh; hh = t; }
      const testPts = [
        { x: px, y: py },
        { x: px - hw, y: py - hh }, { x: px + hw, y: py - hh },
        { x: px - hw, y: py + hh }, { x: px + hw, y: py + hh },
      ];
      if (testPts.some(t => bandQuads.some(q => ptInRingXY(t.x, t.y, q)))) {
        _encroachCount++;
        const hi = hostPlaneIdx(p);
        if (hi >= 0) _flagsByPlane[hi]++;
        els.push(`<rect x="${(px - 4).toFixed(1)}" y="${(py - 4).toFixed(1)}" width="8" height="8" fill="none" stroke="#cc0000" stroke-width="1.2" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`);
      }
    });
  }
  // Slope→plan audit trail — one line per plane (pitch, cos, band widths
  // slope-in → plan-in, coverage basis, flags).
  regPlanes.forEach((rp: any, i: number) => {
    const c = planeCosP[i];
    const pd = Number(rp.pitch);
    console.log(
      `[drawRoofPlan] plane ${i + 1}: pitch=${isFinite(pd) ? pd.toFixed(1) : '?'}° cos=${c.toFixed(3)} ` +
      `ridgeBand=${fireSetIn}"→${(fireSetIn * c).toFixed(1)}"plan hip/valley=18"→${(18 * c).toFixed(1)}"plan(fall-line component only; cross-slope 1:1) ` +
      `pathway=${pathwayIn}" (cross-slope, no foreshorten) ` +
      `coverage=${(_coverage * 100).toFixed(1)}% (plan-array ÷ plan-roof) flags=${_flagsByPlane[i]}`
    );
  });

  // ── AC branch trunk routing (PV-2B): the daisy-chain per branch ──
  // Branch MEMBERSHIP comes from panelColorById (arrayPages assignment; first-
  // appearance order = B1..Bn = legend order). Wiring ORDER within a branch is
  // computed HERE, geometrically, on the RENDERED coordinates — the canonical
  // pipeline does not guarantee the map's insertion order matches rendered
  // adjacency (prod panels arrive without planeId, so the upstream serpentine
  // sort interleaved planes → the trunk polylines starburst through the roof
  // center). Greedy nearest-neighbor chaining degenerates to a serpentine walk
  // on any grid and never trusts upstream ordering.
  if (isBranchColorMode && panelColorById) {
    const byId = new Map<string, any>(regPanels.map((p: any) => [p.id, p]));
    const branchGroups: Array<{ color: string; ps: any[] }> = [];
    const seen = new Map<string, number>();
    for (const [pid, color] of panelColorById) {
      const p = byId.get(pid);
      if (!p) continue;
      if (!seen.has(color)) { seen.set(color, branchGroups.length); branchGroups.push({ color, ps: [] }); }
      branchGroups[seen.get(color)!].ps.push(p);
    }
    // JB position FIRST — homeruns need a target. Keep it ON the roof near
    // the SE eave, inside the outline: the old panel-bbox+26 offset dropped
    // it into the hip setback / off the roof edge.
    const _allVx = regPlanes.flatMap((rp: any) => (rp.vertices ?? []).map((v: any) => toX(v.lng)));
    const _allVy = regPlanes.flatMap((rp: any) => (rp.vertices ?? []).map((v: any) => toY(v.lat)));
    const _pbx = regPanels.map((p: any) => toX(p.lng)), _pby = regPanels.map((p: any) => toY(p.lat));
    const jbX = Math.min(Math.max(..._pbx) + 14, (_allVx.length ? Math.max(..._allVx) : Math.max(..._pbx)) - 10);
    const jbY = Math.min(Math.max(..._pby) + 12, (_allVy.length ? Math.max(..._allVy) : Math.max(..._pby)) - 8);

    // Axis-aligned bboxes of every module (rotation-snapped like the module
    // renderer) — transitions and homeruns are scored against these so a
    // trunk polyline can never slice through another branch's modules.
    const modRects = regPanels.map((p: any) => {
      const px = toX(p.lng), py = toY(p.lat);
      const isLandscape = (p.orientation || 'landscape') === 'landscape';
      let pw = isLandscape ? panLenPx : panWidPx;
      let ph = isLandscape ? panWidPx : panLenPx;
      const azRot = Number(p.azimuth ?? p.heading);
      const rot = isFinite(azRot) ? ((azRot % 180) + 180) % 180 : 0;
      if (snapAxisDeg(rot) === 90) { const t = pw; pw = ph; ph = t; }
      return { x0: px - pw / 2, y0: py - ph / 2, x1: px + pw / 2, y1: py + ph / 2 };
    });
    const _ptInRect = (r: any, pt: { x: number; y: number }) =>
      pt.x > r.x0 && pt.x < r.x1 && pt.y > r.y0 && pt.y < r.y1;
    // Count module bboxes an axis-aligned polyline passes through, ignoring
    // the rects that contain the endpoints (the cable legitimately starts and
    // ends AT a module).
    const routeHits = (pl: Array<{ x: number; y: number }>) => {
      const ends = [pl[0], pl[pl.length - 1]];
      let n = 0;
      for (const r of modRects) {
        if (ends.some(e => _ptInRect(r, e))) continue;
        for (let q = 1; q < pl.length; q++) {
          const s = pl[q - 1], t = pl[q];
          const hit = Math.abs(s.y - t.y) < 0.01
            ? (s.y > r.y0 && s.y < r.y1 && Math.max(s.x, t.x) > r.x0 && Math.min(s.x, t.x) < r.x1)
            : (s.x > r.x0 && s.x < r.x1 && Math.max(s.y, t.y) > r.y0 && Math.min(s.y, t.y) < r.y1);
          if (hit) { n++; break; }
        }
      }
      return n;
    };
    const routeLen = (pl: Array<{ x: number; y: number }>) => {
      let L = 0;
      for (let q = 1; q < pl.length; q++) L += Math.abs(pl[q].x - pl[q - 1].x) + Math.abs(pl[q].y - pl[q - 1].y);
      return L;
    };
    // Best axis-aligned route a→b: both Manhattan corners plus four skirts
    // around the array bbox (clamped inside the roof outline).
    // Skirt bounds come from the module RECT extremes, NOT the panel-center
    // extremes: centers put the "skirt" INSIDE the outer rows (every skirt
    // route then scored ≥1 hit and the picker degenerated to whichever loop
    // was measured first — Braidon's B1 homerun circled the whole array over
    // the ridge, 2026-07-20).
    const _arrX0 = Math.min(...modRects.map(r => r.x0)), _arrX1 = Math.max(...modRects.map(r => r.x1));
    const _arrY0 = Math.min(...modRects.map(r => r.y0)), _arrY1 = Math.max(...modRects.map(r => r.y1));
    const _roofX0 = _allVx.length ? Math.min(..._allVx) : _arrX0, _roofX1 = _allVx.length ? Math.max(..._allVx) : _arrX1;
    const _roofY0 = _allVy.length ? Math.min(..._allVy) : _arrY0, _roofY1 = _allVy.length ? Math.max(..._allVy) : _arrY1;
    const bestRoute = (a: { x: number; y: number }, b: { x: number; y: number }, opts?: { homerun?: boolean }) => {
      const yS = Math.min(_arrY1 + 8, _roofY1 - 5), yN = Math.max(_arrY0 - 8, _roofY0 + 5);
      const xE = Math.min(_arrX1 + 8, _roofX1 - 5), xW = Math.max(_arrX0 - 8, _roofX0 + 5);
      const cands: Array<Array<{ x: number; y: number }>> = [
        [a, { x: b.x, y: a.y }, b],
        [a, { x: a.x, y: b.y }, b],
        [a, { x: a.x, y: yS }, { x: b.x, y: yS }, b],
        // Homeruns: the JB sits at the SE corner by construction, so the far
        // (north/west) skirts can only produce a lasso around the array —
        // exclude them and keep the south/east corridors (+ an L through the
        // east corridor). Plane transitions keep all four skirts.
        ...(opts?.homerun ? [] : [[a, { x: a.x, y: yN }, { x: b.x, y: yN }, b],
                                  [a, { x: xW, y: a.y }, { x: xW, y: b.y }, b]]),
        [a, { x: xE, y: a.y }, { x: xE, y: b.y }, b],
        ...(opts?.homerun ? [[a, { x: a.x, y: yS }, { x: xE, y: yS }, { x: xE, y: b.y }, b]] : []),
      ];
      let best = cands[0], bh = Infinity, bl = Infinity;
      for (const c of cands) {
        const h = routeHits(c), l = routeLen(c);
        if (h < bh || (h === bh && l < bl)) { best = c; bh = h; bl = l; }
      }
      return best;
    };

    branchGroups.forEach((g, bi) => {
      if (g.ps.length < 2) return;
      // Per-plane serpentine segments joined by explicit Manhattan transitions.
      // The old GLOBAL nearest-neighbor chain wandered across hips and setback
      // zones mid-branch — cable draped over the ridge, unbuildable as drawn.
      const byPlaneKey = new Map<string, any[]>();
      for (const p of g.ps) {
        const k = String(p.planeId ?? p.arrayId ?? '');
        if (!byPlaneKey.has(k)) byPlaneKey.set(k, []);
        byPlaneKey.get(k)!.push(p);
      }
      const chainGroup = (ps: any[]): any[] => {
        const P = ps.map((p: any) => ({ p, x: toX(p.lng), y: toY(p.lat) }));
        // ROW-AWARE serpentine (2026-07-20, Braidon PV-1B): the greedy global
        // NN chain serpentined a full row and only then jumped to a stranded
        // module in the next row — a >3×median segment the corridor router
        // then drew as a zero-hit LASSO around the whole array. Cluster into
        // screen-space rows, snake them, and pick the row order + start
        // direction that minimizes total wire and ends NEAREST THE JB (short
        // homerun). NN survives only as the degenerate-scatter fallback.
        const rowGapPx = Math.max(Math.min(panLenPx, panWidPx) * 0.6, 8);
        const byY = [...P].sort((a, b) => a.y - b.y);
        const rows: Array<typeof P> = [];
        for (const q of byY) {
          const last = rows[rows.length - 1];
          if (last && Math.abs(q.y - last[last.length - 1].y) <= rowGapPx) last.push(q);
          else rows.push([q]);
        }
        const nnChain = (): typeof P => {
          const used = new Array(P.length).fill(false);
          let cur = 0;
          for (let i = 1; i < P.length; i++) if (P[i].x + P[i].y < P[cur].x + P[cur].y) cur = i;
          const out = [P[cur]]; used[cur] = true;
          for (let s = 1; s < P.length; s++) {
            let best = -1, bestD = Infinity;
            for (let i = 0; i < P.length; i++) {
              if (used[i]) continue;
              const d = (P[i].x - P[cur].x) ** 2 + (P[i].y - P[cur].y) ** 2;
              if (d < bestD) { bestD = d; best = i; }
            }
            out.push(P[best]); used[best] = true; cur = best;
          }
          return out;
        };
        let chain: typeof P;
        if (rows.length > Math.max(2, P.length / 1.6)) {
          chain = nnChain();   // scatter, not a grid — rows are meaningless
        } else {
          for (const r of rows) r.sort((a, b) => a.x - b.x);
          const pathLen = (c: typeof P) => {
            let L = 0;
            for (let k = 1; k < c.length; k++) L += Math.hypot(c[k].x - c[k - 1].x, c[k].y - c[k - 1].y);
            return L;
          };
          let best: typeof P | null = null, bestScore = Infinity;
          for (const rowsOrdered of [rows, [...rows].reverse()]) {
            for (const firstLTR of [true, false]) {
              const c: typeof P = [];
              rowsOrdered.forEach((r, ri) => {
                const ltr = (ri % 2 === 0) === firstLTR;
                c.push(...(ltr ? r : [...r].reverse()));
              });
              const end = c[c.length - 1];
              const score = pathLen(c) + 0.6 * Math.hypot(end.x - jbX, end.y - jbY);
              if (score < bestScore) { bestScore = score; best = c; }
            }
          }
          chain = best ?? nnChain();
        }
        return chain.map(q => q.p);
      };
      // Plane-group sequence: largest first, then nearest centroid next.
      const grps = [...byPlaneKey.values()].map(ps => {
        const xs = ps.map((p: any) => toX(p.lng)), ys = ps.map((p: any) => toY(p.lat));
        return { ps, cx: xs.reduce((a, b) => a + b, 0) / xs.length, cy: ys.reduce((a, b) => a + b, 0) / ys.length };
      }).sort((a, b) => b.ps.length - a.ps.length);
      const seq = [grps.shift()!];
      while (grps.length) {
        const last = seq[seq.length - 1];
        let ni = 0, nd = Infinity;
        grps.forEach((gr, i) => { const d = (gr.cx - last.cx) ** 2 + (gr.cy - last.cy) ** 2; if (d < nd) { nd = d; ni = i; } });
        seq.push(grps.splice(ni, 1)[0]);
      }
      const orderedPs: any[] = [];
      const transitionAt = new Set<number>();
      for (const gr of seq) {
        if (orderedPs.length) transitionAt.add(orderedPs.length);
        orderedPs.push(...chainGroup(gr.ps));
      }
      const pts = orderedPs.map((p: any) => ({ x: toX(p.lng), y: toY(p.lat) }));
      const segs = pts.slice(1).map((b, k) => Math.hypot(b.x - pts[k].x, b.y - pts[k].y));
      const medSeg = [...segs].sort((a, b) => a - b)[Math.floor(segs.length / 2)] || 1;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const long = transitionAt.has(k) || segs[k - 1] > Math.max(3 * medSeg, 40);
        if (long) {
          // Plane-to-plane transition: collision-scored axis-aligned route,
          // dashed. The old fixed Manhattan corner drew the trunk straight
          // THROUGH other branches' modules (unbuildable as drawn).
          const route = bestRoute(a, b);
          const midPts = route.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          els.push(`<polyline points="${midPts}" fill="none" stroke="#fff" stroke-width="2.8" opacity="0.9" stroke-dasharray="5 3"/>`);
          els.push(`<polyline points="${midPts}" fill="none" stroke="${g.color}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
        } else {
          els.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#fff" stroke-width="2.8" opacity="0.9"/>`);
          els.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${g.color}" stroke-width="1.5"/>`);
        }
      }
      const h = pts[0];
      els.push(`<rect x="${(h.x - 8).toFixed(1)}" y="${(h.y - 6).toFixed(1)}" width="16" height="12" rx="2" fill="#fff" stroke="${g.color}" stroke-width="1"/>`);
      els.push(drawText(h.x, h.y + 3, `B${bi + 1}`, { anchor: 'middle', fontSize: 6.5, fontWeight: '900', fill: '#111' }));
      // HOMERUN — every branch lands at the JB (the circuits previously ended
      // in mid-roof with no terminus anywhere on the sheet).
      const tail = pts[pts.length - 1];
      // Same collision-scored routing as the plane transitions — the fixed
      // drop-then-across leg ran a north-plane homerun straight through the
      // south rows on its way to the JB.
      const hrRoute = bestRoute(tail, { x: jbX, y: jbY }, { homerun: true });
      const hr = hrRoute.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      els.push(`<polyline points="${hr}" fill="none" stroke="#fff" stroke-width="2.6" opacity="0.85" stroke-dasharray="3 2"/>`);
      els.push(`<polyline points="${hr}" fill="none" stroke="${g.color}" stroke-width="1.3" stroke-dasharray="3 2"/>`);
    });

    // Branch TERMINUS — JB symbol where the homeruns land, honest conduit note
    // (a single hardcoded ¾" EMT for 6 branch circuits failed NEC fill/derate).
    if (branchGroups.length > 0 && regPanels.length > 0) {
      els.push(`<polyline points="${jbX.toFixed(1)},${jbY.toFixed(1)} ${(jbX + 16).toFixed(1)},${(jbY + 10).toFixed(1)}" fill="none" stroke="#444" stroke-width="1" stroke-dasharray="5 3"/>`);
      els.push(`<rect x="${(jbX - 4).toFixed(1)}" y="${(jbY - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#000" stroke-width="1"/>`);
      els.push(`<line x1="${(jbX - 4).toFixed(1)}" y1="${(jbY - 4).toFixed(1)}" x2="${(jbX + 4).toFixed(1)}" y2="${(jbY + 4).toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
      // Opaque backing — the hip/eave linework struck straight through the
      // JB note where it landed in the SE corner.
      els.push(`<rect x="${(jbX - 128).toFixed(1)}" y="${(jbY + 9).toFixed(1)}" width="150" height="17" fill="rgba(255,255,255,0.92)" stroke="none"/>`);
      els.push(drawText(jbX + 20, jbY + 16, `(N) JB — ${branchGroups.length} AC BRANCH CIRCUITS`, { anchor: 'end', fontSize: 5.8, fontWeight: 'bold', fill: '#000' }));
      els.push(drawText(jbX + 20, jbY + 23, `CONDUIT SIZED PER NEC CH.9 — SEE PV-4B / E-1`, { anchor: 'end', fontSize: 5.2, fill: '#333' }));
    }
  }

  // ── Roof obstructions + keep-out rings (Nearmap AI / vision / manual) ──
  // Footprint drawn as a white circle with a cross, keep-out clearance as a
  // dashed red ring with light hatch, type label above — the reference-set
  // treatment for vents/chimneys/AC/skylights.
  const roofObs = (project.roofObstructions ?? [])
    .filter((o: any) => isFinite(o.lat) && isFinite(o.lng))
    // SAME global plan rotation as every other drawn layer.
    .map((o: any) => planRotDeg === 0 ? o : { ...o, ..._rotPt(o) });
  // Canopy is an UNVERIFIED-area flag, not a surveyed fixture — notes and the
  // legend treat it separately from hard obstructions (vents/chimneys/etc.).
  const _canopyObs = roofObs.filter((o: any) => o.type === 'canopy');
  const _hardObs   = roofObs.filter((o: any) => o.type !== 'canopy');
  // Vents/obstructions render on BOTH sheets (Ray wants the vent/obstruction
  // callouts on PV-1B too — a circuit can't route through a vent keep-out).
  roofObs.forEach((o: any) => {
    const ox = toX(o.lng), oy = toY(o.lat);
    const rPx = Math.max(o.radiusFt * scale, 2.5);
    const kPx = Math.max((o.radiusFt + o.clearanceFt) * scale, rPx + 2.5);
    if (o.type === 'canopy') {
      // Tree canopy over the roof: the aerial is BLIND here, so this is an
      // UNVERIFIED zone (possible concealed vents/pipes), not a surveyed
      // fixture — dashed green blob + hatch, no vent-style footprint dot.
      els.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${kPx.toFixed(1)}" fill="url(#hatch-setback)" opacity="0.3" stroke="#1a7a2e" stroke-width="1" stroke-dasharray="4 3"/>`);
      els.push(drawText(ox, oy - kPx - 8.5, 'TREE CANOPY', {
        anchor: 'middle', fontSize: 4.8, fontWeight: 'bold', fill: '#1a7a2e',
      }));
      els.push(drawText(ox, oy - kPx - 2.5, 'CONCEALED AREA — FIELD VERIFY', {
        anchor: 'middle', fontSize: 4.2, fontWeight: 'bold', fill: '#1a7a2e',
      }));
      return;
    }
    els.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${kPx.toFixed(1)}" fill="url(#hatch-setback)" opacity="0.35" stroke="#cc2222" stroke-width="0.6" stroke-dasharray="3 2"/>`);
    // DESIGNED module inside this keep-out: designed positions are never
    // silently deleted (they're the customer's layout), but drawing a module
    // straight over a vent with no flag was a plan-check P0 — mark the
    // conflict explicitly for field resolution.
    for (const p of regPanels) {
      const px2 = toX(p.lng), py2 = toY(p.lat);
      if (Math.hypot(px2 - ox, py2 - oy) < kPx) {
        const cr = Math.hypot(panLenPx, panWidPx) / 2 * 0.62;
        els.push(`<circle cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" r="${cr.toFixed(1)}" fill="none" stroke="#cc0000" stroke-width="1.4" stroke-dasharray="4 2.5"/>`);
        els.push(drawText(px2, py2 - cr - 2.5, 'MODULE/OBSTRUCTION CONFLICT — FIELD VERIFY', {
          anchor: 'middle', fontSize: 4.6, fontWeight: 'bold', fill: '#cc0000',
        }));
      }
    }
    els.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${rPx.toFixed(1)}" fill="#fff" stroke="#000" stroke-width="0.9"/>`);
    els.push(`<line x1="${(ox - rPx * 0.6).toFixed(1)}" y1="${(oy - rPx * 0.6).toFixed(1)}" x2="${(ox + rPx * 0.6).toFixed(1)}" y2="${(oy + rPx * 0.6).toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
    els.push(`<line x1="${(ox - rPx * 0.6).toFixed(1)}" y1="${(oy + rPx * 0.6).toFixed(1)}" x2="${(ox + rPx * 0.6).toFixed(1)}" y2="${(oy - rPx * 0.6).toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
    els.push(drawText(ox, oy - kPx - 2.5, String(o.type || 'obstruction').toUpperCase().replace(/_/g, ' '), {
      anchor: 'middle', fontSize: 4.8, fontWeight: 'bold', fill: '#333',
    }));
  });

  // ── Plane markers — small numbered badges keyed to the MAIN HOME ROOF
  // DESCRIPTION table (ROOF #). The old 3-line PLANE/PITCH/FACING boxes buried
  // the modules on compact multi-plane roofs (Ray 2026-07-08: "cluttering the
  // roof layout beyond recognition"). All that data already lives in the table,
  // so the roof only needs a small reference number. ──
  // Plane badges OFF the plane, connected by a leader (Ray 2026-07-08: "number the
  // planes off of the plane, a line stretching to the number"). Each badge is
  // pushed just outside the roof bbox in the direction from the roof center to the
  // plane's centroid (a bowtie's 4 facets fan out to 4 sides), with a thin leader
  // from the centroid to the badge — declutters the roof, reads like a pro callout.
  const _panelPts = regPanels.map((p: any) => ({ x: toX(p.lng), y: toY(p.lat) }));
  // Roof bbox in screen coords — computed here from toX/toY (the roofMinX/… consts
  // aren't declared until the dimension section further down).
  const _bMinX = toX(minLng), _bMaxX = toX(maxLng), _bMinY = toY(maxLat), _bMaxY = toY(minLat);
  const _rcx = (_bMinX + _bMaxX) / 2, _rcy = (_bMinY + _bMaxY) / 2;
  const _halfW = Math.max((_bMaxX - _bMinX) / 2, 1), _halfH = Math.max((_bMaxY - _bMinY) / 2, 1);
  planeLabels.forEach(L => {
    let dx = L.cx - _rcx, dy = L.cy - _rcy;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { dx = 0; dy = -1; }   // single/centered plane → push up
    const dlen = Math.hypot(dx, dy) || 1;
    dx /= dlen; dy /= dlen;
    // distance from roof center to the bbox edge along (dx,dy), then a fixed lead-out
    const tEdge = Math.min(dx !== 0 ? _halfW / Math.abs(dx) : Infinity, dy !== 0 ? _halfH / Math.abs(dy) : Infinity);
    const bx = _rcx + dx * (tEdge + 17), by = _rcy + dy * (tEdge + 17);
    els.push(`<line x1="${L.cx.toFixed(1)}" y1="${L.cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#1a1a1a" stroke-width="0.7"/>`);
    els.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="7.5" fill="rgba(255,255,255,0.97)" stroke="#1a1a1a" stroke-width="1.1"/>`);
    els.push(drawText(bx, by + 2.7, String(L.ri + 1), { anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#1a1a1a' }));
  });

  // ── ROOF DESCRIPTION + ARRAY CALC tables (PV-2 only) ──────────────────────
  // Mirrors the pro reference: a per-facet "MAIN HOME ROOF DESCRIPTION" table
  // (roof # / modules / azimuth / tilt / truss) + an "ARRAY & ROOF CALC" summary
  // (plan-view roof area / array area / % coverage). Rendered top-left, opaque.
  if (!isBranchColorMode) {
    const trussSize    = ((project as any).rafterSize || (project as any).trussSize || '2×4').toString();
    const trussSpacing = `${rafterSp}" O.C.`;
    // Module→facet attribution: point-in-poly first, NEAREST-PLANE fallback
    // for modules on regularized facet borders — the column MUST sum to the
    // declared module count (it read 41 of 53; a plan checker adds it up).
    const _facetCounts = new Array(regPlanes.length).fill(0);
    regPanels.forEach((p: any) => {
      let idx = regPlanes.findIndex((rp: any) => ptInLatLngRing(p.lat, p.lng, rp.vertices));
      if (idx < 0) {
        let bestD = Infinity;
        regPlanes.forEach((rp: any, i: number) => {
          const cLa = rp.vertices.reduce((s: number, v: any) => s + v.lat, 0) / rp.vertices.length;
          const cLo = rp.vertices.reduce((s: number, v: any) => s + v.lng, 0) / rp.vertices.length;
          const d = (p.lat - cLa) ** 2 + (p.lng - cLo) ** 2;
          if (d < bestD) { bestD = d; idx = i; }
        });
      }
      if (idx >= 0) _facetCounts[idx]++;
    });
    // Display azimuths snap to the sheet axes when within the SAME 8°
    // tolerance regularizeRoof squares the linework with — the table printed
    // raw trace headings (3°/273°/89°) beside axis-square drawing, which read
    // as four planes that don't oppose each other.
    const _snapAz = (az: number) => {
      const n = ((az % 360) + 360) % 360;
      const q = Math.round(n / 90) * 90 % 360;
      return Math.abs(((n - q + 540) % 360) - 180) <= 8 ? q : Math.round(n);
    };
    const facets = regPlanes.map((rp: any, i: number) => ({
      n: i + 1,
      mods: _facetCounts[i],
      az: rp.azimuth != null && isFinite(rp.azimuth) ? `${_snapAz(rp.azimuth)}°` : '—',
      tilt: rp.pitch != null && isFinite(rp.pitch) ? `${Math.round(rp.pitch)}°` : '—',
      truss: trussSize,
      oc: trussSpacing,
    }));
    const roofAreaFt2  = regPlanes.reduce((s: number, rp: any) => s + planViewAreaFt2(rp.vertices), 0);
    const panelAreaFt2 = (panelLenIn * panelWidIn) / 144;
    const arrayAreaFt2 = totalPanels * panelAreaFt2;
    // Coverage % on the SAME consistent plan basis as the 18"/36" band test
    // above (plan-projected array ÷ plan roof) — the table printing a mixed-
    // basis 36.4% beside an 18" band selected at 30.4% read as a contradiction
    // to a plan checker. Mean cos over rendered panels scales the authoritative
    // totalPanels count when it differs from regPanels.length.
    const _meanCosTbl  = regPanels.length
      ? regPanels.reduce((s: number, p: any) => s + panelCosP(p), 0) / regPanels.length
      : 1;
    const arrayPlanTblFt2 = arrayAreaFt2 * _meanCosTbl;
    const coverPct     = roofAreaFt2 > 0 ? (arrayPlanTblFt2 / roofAreaFt2) * 100 : 0;
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

    // TRUSS SIZE + SPACING as real columns (reference parity) and typography
    // sized to survive fit-to-width viewing — at the old 5.4px cells, "273°"
    // rasterized as "2/3°" on Ray's screen (the 7 loses its top bar below
    // ~5 rendered px). Data cells ≥7.2px + the larger roof canvas fix that.
    const cols = [
      { key: 'n',     hdr: 'ROOF',    w: 34 },
      { key: 'mods',  hdr: 'MODULES', w: 52 },
      { key: 'az',    hdr: 'AZIMUTH', w: 50 },
      { key: 'tilt',  hdr: 'TILT',    w: 38 },
      { key: 'truss', hdr: 'TRUSS',   w: 44 },
      { key: 'oc',    hdr: 'SPACING', w: 50 },
    ] as const;
    const tblW = cols.reduce((s, c) => s + c.w, 0);
    const rowH = 13, hdrH = 13, titleH = 14;
    const tx = 8, ty = 30;
    const tblH = titleH + hdrH + facets.length * rowH;

    const t: string[] = [];
    t.push(`<rect x="${tx}" y="${ty}" width="${tblW}" height="${tblH}" fill="rgba(255,255,255,0.95)" stroke="#2b2f36" stroke-width="0.8"/>`);
    t.push(`<rect x="${tx}" y="${ty}" width="${tblW}" height="${titleH}" fill="#000"/>`);
    t.push(drawText(tx + tblW / 2, ty + 10, 'MAIN HOME ROOF DESCRIPTION', { anchor: 'middle', fontSize: 7.2, fontWeight: 'bold', fill: '#fff' }));
    // header row
    let cxp = tx;
    for (const c of cols) {
      t.push(`<rect x="${cxp}" y="${ty + titleH}" width="${c.w}" height="${hdrH}" fill="#e8ebf0" stroke="#999" stroke-width="0.3"/>`);
      t.push(drawText(cxp + c.w / 2, ty + titleH + 9, c.hdr, { anchor: 'middle', fontSize: 6.6, fontWeight: 'bold', fill: '#1a1a1a' }));
      cxp += c.w;
    }
    // data rows
    facets.forEach((f, ri) => {
      const ry = ty + titleH + hdrH + ri * rowH;
      cxp = tx;
      for (const c of cols) {
        t.push(`<rect x="${cxp}" y="${ry}" width="${c.w}" height="${rowH}" fill="none" stroke="#ccc" stroke-width="0.3"/>`);
        t.push(drawText(cxp + c.w / 2, ry + 9, String((f as any)[c.key]), { anchor: 'middle', fontSize: 7.2, fill: '#333' }));
        cxp += c.w;
      }
    });

    // ── ARRAY & ROOF CALC — TOTAL ──
    const cy2 = ty + tblH + 14;
    const calc: Array<[string, string]> = [
      ['ROOF AREA (PLAN VIEW)', `${fmt(roofAreaFt2)} ft²`],
      ['NEW ARRAY AREA (ACTUAL)', `${fmt(arrayAreaFt2)} ft²`],
      ['ARRAY AREA (PLAN VIEW)', `${fmt(arrayPlanTblFt2)} ft²`],
      ['ROOF COVERED BY ARRAY', `${coverPct.toFixed(1)}%`],
    ];
    const calcH = titleH + calc.length * rowH;
    t.push(`<rect x="${tx}" y="${cy2}" width="${tblW}" height="${calcH}" fill="rgba(255,255,255,0.95)" stroke="#2b2f36" stroke-width="0.8"/>`);
    t.push(`<rect x="${tx}" y="${cy2}" width="${tblW}" height="${titleH}" fill="#000"/>`);
    t.push(drawText(tx + tblW / 2, cy2 + 10, 'ARRAY & ROOF CALC — TOTAL', { anchor: 'middle', fontSize: 7.2, fontWeight: 'bold', fill: '#fff' }));
    calc.forEach(([label, val], ri) => {
      const ry = cy2 + titleH + ri * rowH;
      t.push(`<rect x="${tx}" y="${ry}" width="${tblW}" height="${rowH}" fill="none" stroke="#ccc" stroke-width="0.3"/>`);
      t.push(drawText(tx + 3, ry + 9, label, { anchor: 'start', fontSize: 6.4, fill: '#333' }));
      t.push(drawText(tx + tblW - 3, ry + 9, val, { anchor: 'end', fontSize: 6.8, fontWeight: 'bold', fill: '#1a1a1a' }));
    });

    // ── GENERAL NOTES — numbered, upright, in the left column (replaces the
    // single low-contrast italic footer line the critique flagged) ──
    const gnY = cy2 + calcH + 16;
    const gn: string[] = [
      '1. FIELD VERIFY ALL DIMENSIONS PRIOR',
      '   TO INSTALLATION.',
      ..._pathwaysDrawn > 0
        ? [
            `2. ${ftToFtIn(pathwayFt)} FIRE ACCESS PATHWAYS SHOWN`,
            '   HATCHED GREEN — IFC §1204.2.1.',
          ]
        : [
            `2. MAINTAIN ${ftToFtIn(pathwayFt)} ACCESS PATHWAY PER`,
            '   IFC §1204.2.1 — HIP CLEARANCES',
            '   PROVIDE EAVE-TO-RIDGE ROUTES.',
          ],
      '3. ATTACHMENT SUBJECT TO FRAMING',
      '   LOCATION — SEE PV-3.',
      // PPC §3 — the ONE canonical spacing line, verbatim, on PV-1.
      `3C. ${_attP.spacingDesignLine}`,
      `   STATUS: ${_attP.spacingStatusLine}.`,
      // P13 WS-4 — the DECK-MOUNT clause is GONE. It instructed the installer to
      // deck-mount "where no rafter falls in range" on every railed job,
      // unconditionally: the deck-foot placement mechanism was retired (see
      // _deckMountUsed = false, so no deck foot is ever drawn and the legend
      // carries no deck swatch), PV-3 and PV-4C describe a rafter design, and the
      // canonical assembly's attachmentMode is 'rafter' (2 structural wood screws
      // — the RT-MINI DECK condition is a different 5-screw design with its own
      // capacity and its own manufacturer instructions). A deck attachment is a
      // deliberate design with its own authority, never a field fallback.
      ...(!isRailless
        ? [
            `3B. RAILS ON FEET @ ${_ocLabelP} STAGGERED,`,
            '   FEET ON RAFTERS; RAILS AT 25%/75% OF',
            '   MODULE. END OVERHANG ≤ 18". ATTACH TO',
            '   FRAMING ONLY — NO DECK-ONLY ATTACHMENT.',
          ]
        : []),
      ...(_encroachCount > 0
        ? [
            `3A. ${_encroachCount} MODULE(S) ENCROACH THE`,
            `   ${ftToFtIn(setbackFt)} SETBACK (RED ◇) — RELOCATE`,
            '   OR OBTAIN AHJ EXCEPTION.',
          ]
        : []),
      ...(_hardObs.length > 0
        ? [
            `4. ${_hardObs.length} ROOF OBSTRUCTION(S) PLOTTED W/`,
            '   KEEP-OUT CLEARANCES (NEARMAP AI)',
            '   — FIELD VERIFY LOCATIONS.',
          ]
        : [
            '4. NO ROOF OBSTRUCTIONS MODELED IN',
            '   ARRAY AREA — FIELD VERIFY.',
          ]),
      ...(_canopyObs.length > 0
        ? [
            '5. TREE CANOPY OVERHANGS ROOF —',
            '   AERIAL COULD NOT VERIFY COVERED',
            '   AREA (VENTS/PIPES MAY BE',
            '   CONCEALED). FIELD VERIFY PRIOR',
            '   TO MODULE LAYOUT.',
          ]
        : []),
    ];
    // Opaque backing like the tables above — the notes printed straight over
    // the roof's NW hip hatch when the drawing extended into the left column.
    t.push(`<rect x="${tx - 3}" y="${gnY - 9}" width="${tblW + 6}" height="${12 + gn.length * 9.5 + 12}" fill="rgba(255,255,255,0.95)" stroke="none"/>`);
    t.push(drawText(tx, gnY, 'GENERAL NOTES', { anchor: 'start', fontSize: 7.2, fontWeight: 'bold', fill: '#000' }));
    t.push(`<line x1="${tx}" y1="${gnY + 2.5}" x2="${tx + tblW}" y2="${gnY + 2.5}" stroke="#000" stroke-width="0.8"/>`);
    gn.forEach((line, i) => {
      t.push(drawText(tx, gnY + 12 + i * 9.5, line, { anchor: 'start', fontSize: 6.4, fill: '#1a1a1a' }));
    });
    els.push(...t);
  }

  // ── DIMENSION HIERARCHY ── (PV-2 only — skipped for PV-2B branch-color mode)
  const roofMinX = toX(minLng);
  const roofMaxX = toX(maxLng);
  const roofMinY = toY(maxLat);
  const roofMaxY = toY(minLat);
  const roofWFt  = lngSpan;   // because 1° == 1ft in fake-degree encoding
  const roofHFt  = latSpan;

  // L1 — Overall width (bottom) — BOTH sheets now (dimensions are part of the
  // professional look Ray wants on PV-1B too). Extension lines sit at the roof
  // perimeter, clear of the module-mounted circuit wires.
  els.push(drawOverallDimension(
    roofMinX, roofMaxX,
    roofMaxY + 36, 24,
    ftToFtIn(roofWFt)
  ));

  // L1 — Overall height (vertical) — tight against the roof outline; at the old
  // draw-zone edge its extension line struck through both data tables.
  if (roofHFt > 3) {
    els.push(drawVerticalDimension(
      roofMinX - 26,
      roofMinY, roofMaxY,
      14,
      ftToFtIn(roofHFt)
    ));
  }
  // (fire-setback mini-dimension removed — it rendered as a broken-leader
  // artifact; the legend + callout ② carry the value)

  // ── North arrow + scale bar ──
  // North: full N/E/S/W compass rose on BOTH sheets (below) — the simple arrow
  // read as less finished than PV-1's rose.
  const scaleBarPx = Math.max(Math.round(10 * scale), 30);   // 10-foot scale bar
  const sbX = zones.dims.left + 4, sbY = H - zones.dims.bottom + 28;
  // Segmented graphic scale with real feet at every graduation (helper draws
  // the labels from totalFt — the old external 0/5/10 texts assumed 2 segments).
  els.push(drawScaleBar(sbX, sbY, scaleBarPx, '', { totalFt: 10 }));

  // ── Compass rose (BOTH sheets) + LEGEND (PV-1 only) ───────────────────────
  {
    // Compass rose — 4-point star with N/E/S/W, bottom-right corner. Wired to
    // the SAME global plan rotation as every drawn layer: the star turns by
    // northArrowRotationDeg(planRotDeg) so true north points correctly on the
    // building-squared plan; the letters ride the rotated anchors but stay
    // horizontal (counter-rotated text — reference-set discipline).
    const crX = W - zones.dims.right - 6, crY = H - zones.dims.bottom - 2, cr = 20;
    const nRot = northArrowRotationDeg(planRotDeg);
    const rose: string[] = [];
    rose.push(`<circle cx="${crX}" cy="${crY}" r="${cr}" fill="rgba(255,255,255,0.9)" stroke="#2b2f36" stroke-width="0.9"/>`);
    rose.push(`<g class="north-rose" transform="rotate(${nRot.toFixed(2)} ${crX} ${crY})">`);
    // vertical (N/S) star — N solid, S light
    rose.push(`<polygon points="${crX},${crY - cr + 2} ${crX + 4},${crY} ${crX},${crY - 3} ${crX - 4},${crY}" fill="#1a1a1a"/>`);
    rose.push(`<polygon points="${crX},${crY + cr - 2} ${crX + 4},${crY} ${crX},${crY + 3} ${crX - 4},${crY}" fill="#b0b4bc"/>`);
    // horizontal (E/W) minor star
    rose.push(`<polygon points="${crX + cr - 2},${crY} ${crX},${crY + 4} ${crX + 3},${crY} ${crX},${crY - 4}" fill="#6b7078"/>`);
    rose.push(`<polygon points="${crX - cr + 2},${crY} ${crX},${crY + 4} ${crX - 3},${crY} ${crX},${crY - 4}" fill="#6b7078"/>`);
    rose.push(`<circle cx="${crX}" cy="${crY}" r="1.4" fill="#1a1a1a"/>`);
    rose.push('</g>');
    // Letters at the ROTATED cardinal anchors, text horizontal.
    const _aR = nRot * Math.PI / 180;
    const _dN = { x: Math.sin(_aR), y: -Math.cos(_aR) };   // screen (y down)
    const _dE = { x: Math.cos(_aR), y: Math.sin(_aR) };
    const _lp = (d: { x: number; y: number }, dist: number) =>
      ({ x: crX + d.x * dist, y: crY + d.y * dist });
    const pN = _lp(_dN, cr + 7), pS = _lp({ x: -_dN.x, y: -_dN.y }, cr + 7);
    const pE = _lp(_dE, cr + 9), pW = _lp({ x: -_dE.x, y: -_dE.y }, cr + 9);
    rose.push(drawText(pN.x, pN.y + 2.8, 'N', { anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#1a1a1a' }));
    rose.push(drawText(pS.x, pS.y + 2.2, 'S', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    rose.push(drawText(pE.x, pE.y + 2.2, 'E', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    rose.push(drawText(pW.x, pW.y + 2.2, 'W', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    els.push(...rose);
  }

  // Legend — documents the symbols/line-styles on this sheet. PV-1 only; PV-1B
  // carries the compact CIRCUIT LEGEND instead (a full legend would double-label).
  if (!isBranchColorMode) {
    const _sbHatch = `<rect x="0" y="-5" width="14" height="9" fill="url(#hatch-setback)" opacity="0.6" stroke="#cc2222" stroke-width="0.5"/>`;
    const lg: Array<{ swatch: string; label: string }> = [
      { swatch: `<rect x="0" y="-5" width="14" height="9" fill="#fdfdfd" stroke="#2c4a75" stroke-width="0.7"/><circle cx="3.5" cy="-2.8" r="1" fill="#2a5db0"/><circle cx="10.5" cy="-2.8" r="1" fill="#2a5db0"/><circle cx="3.5" cy="1.8" r="1" fill="#2a5db0"/><circle cx="10.5" cy="1.8" r="1" fill="#2a5db0"/>`, label: 'PV MODULE + ATTACHMENT PTS' },
      ...(!isRailless ? [{ swatch: `<line x1="0" y1="-2.5" x2="14" y2="-2.5" stroke="#5a6478" stroke-width="0.8"/><line x1="0" y1="2.5" x2="14" y2="2.5" stroke="#5a6478" stroke-width="0.8"/><circle cx="3" cy="-2.5" r="1" fill="#2a5db0"/><circle cx="11" cy="2.5" r="1" fill="#2a5db0"/>`, label: `RAIL + RAFTER FOOT @ ${_ocLabelP}` }] : [{ swatch: `<rect x="4" y="-2.5" width="2.8" height="2.8" fill="#2a5db0"/><rect x="9" y="-2.5" width="2.8" height="2.8" fill="#2a5db0"/>`, label: 'DIRECT-ATTACH MOUNTS (RAIL-LESS)' }]),
      ...(_deckMountUsed ? [{ swatch: `<rect x="4.5" y="-2.5" width="5" height="5" fill="#fff" stroke="#b45309" stroke-width="1"/>`, label: 'DECK-MOUNTED FOOT (NO RAFTER)' }] : []),
      ...(_encroachCount > 0 ? [{
        swatch: `<rect x="4" y="-3.5" width="6" height="6" fill="none" stroke="#cc0000" stroke-width="1" transform="rotate(45 7 -0.5)"/>`,
        label: 'SETBACK ENCROACHMENT',
      }] : []),
      { swatch: _sbHatch, label: `${ftToFtIn(setbackFt)} RIDGE · 1'-6" HIP/VALLEY SETBACK` },
      ...(_pathwaysDrawn > 0 ? [{
        swatch: `<rect x="0" y="-5" width="14" height="9" fill="#1a7a2e" opacity="0.12" stroke="#1a7a2e" stroke-width="0.7" stroke-dasharray="3 1.5"/>`,
        label: `${ftToFtIn(pathwayFt)} ACCESS PATHWAY`,
      }] : []),
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#000" stroke-width="2.4"/>`, label: 'RIDGE / HIP' },
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#000" stroke-width="1.1"/>`, label: 'EAVE / RAKE' },
      { swatch: `<line x1="0" y1="-3" x2="14" y2="-3" stroke="#c8cdd5" stroke-width="0.7"/><line x1="0" y1="0" x2="14" y2="0" stroke="#c8cdd5" stroke-width="0.7"/><line x1="0" y1="3" x2="14" y2="3" stroke="#c8cdd5" stroke-width="0.7"/>`, label: `FRAMING @ ${rafterSp}" O.C.` },
      ...(_hardObs.length > 0 ? [{
        swatch: `<circle cx="7" cy="-0.5" r="5.5" fill="url(#hatch-setback)" opacity="0.35" stroke="#cc2222" stroke-width="0.5" stroke-dasharray="2 1.5"/><circle cx="7" cy="-0.5" r="2.6" fill="#fff" stroke="#000" stroke-width="0.6"/>`,
        label: 'OBSTRUCTION + KEEP-OUT',
      }] : []),
      ...(_canopyObs.length > 0 ? [{
        swatch: `<circle cx="7" cy="-0.5" r="5.5" fill="url(#hatch-setback)" opacity="0.3" stroke="#1a7a2e" stroke-width="0.8" stroke-dasharray="2.5 2"/>`,
        label: 'TREE CANOPY — VERIFY',
      }] : []),
      { swatch: `<circle cx="7" cy="0" r="4.5" fill="#fff" stroke="#000" stroke-width="1"/><text x="7" y="2.3" text-anchor="middle" font-size="5" font-weight="900" fill="#000">#</text>`, label: 'CALLOUT REF.' },
      // Site-context symbols (property line / driveway / sidewalk) — only when a
      // parcel was drawn on this sheet.
      ..._siteLegend,
    ];
    // Legend lives OFF the map (Ray 2026-07-16: every on-map float eventually
    // covers something — first the fence run, then the left-rail tables when
    // the corner-picker dodged the fence). Emitted as a sentinel HTML block
    // AFTER the SVG; composeDrawPage extracts it and injects it into the data
    // rail underneath the CALLOUT SCHEDULE. Swatches reference the main SVG's
    // defs (url(#hatch-setback)) — id lookups are document-wide, so they
    // resolve against the drawing's defs.
    const _lgRows = lg.map(e => `
      <div style="display:flex;align-items:center;gap:5px;padding:1.5px 6px;">
        <svg width="16" height="11" viewBox="-1 -6 16 12" style="flex-shrink:0;">${e.swatch}</svg>
        <span style="font-size:6.4px;color:#1a1a1a;">${e.label}</span>
      </div>`).join('');
    els.push(`<!--RAIL-LEGEND-->${_lgRows}<!--/RAIL-LEGEND-->`);
  }

  // ── Direct equipment callouts (PV-2 only — reference-set style) ──
  // The pro sets annotate the PLAN with real "(N) make/model" text + short
  // leaders — numbered bubbles wired to a remote schedule read as generated.
  // Placement uses the white space above/below/beside the roof; every leader
  // lands on a representative object and never crosses the array.
  if (!isBranchColorMode && _panelPts.length > 0) {
    const topP  = _panelPts.reduce((m, p) => (p.y < m.y ? p : m), _panelPts[0]);
    const botP  = _panelPts.reduce((m, p) => (p.y > m.y ? p : m), _panelPts[0]);
    const eastP = _panelPts.reduce((m, p) => (p.x > m.x ? p : m), _panelPts[0]);
    let ridge: any = null, hip: any = null;
    for (const e of interiorEdgesXY) {
      const len = Math.hypot(e.bx - e.ax, e.by - e.ay);
      const horiz = Math.abs(e.by - e.ay) < Math.abs(e.bx - e.ax) * 0.4;
      if (horiz) { if (!ridge || len > ridge.len) ridge = { ...e, len }; }
      else       { if (!hip   || len > hip.len)   hip   = { ...e, len }; }
    }
    const txtCallout = (
      tx: number, ty: number, anchor: 'start' | 'end',
      lines: string[], lx: number, ly: number,
    ) => {
      lines.forEach((ln, i) => {
        els.push(drawText(tx, ty + i * 7.5, ln, { anchor, fontSize: 5.8, fontWeight: i === 0 ? 'bold' : 'normal', fill: '#000' }));
      });
      const sx = anchor === 'start' ? tx - 3 : tx + 3;
      els.push(`<line x1="${sx.toFixed(1)}" y1="${(ty + (lines.length - 1) * 3.75).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#000" stroke-width="0.7"/>`);
      els.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.4" fill="#000"/>`);
    };
    const wattStr = panelWatts ? ` (${panelWatts}W)` : '';
    const modLine = _modNamed
      ? `(N) ${totalPanels} — ${_modNamed}${wattStr} MODULES${_shownNote}`
      : `(N) ${totalPanels} PV MODULES${wattStr}${_shownNote} — SEE EQUIPMENT SCHEDULE`;
    const invLine = _invNamed
      ? `(N) ${_invNamed} MICROINVERTER — 1 PER MODULE`
      : `(N) MICROINVERTER (1 PER MODULE) — SEE EQUIPMENT SCHEDULE`;
    const topRowY = Math.max(roofMinY - 26, zones.dims.top + 10);

    // Modules + microinverters — ONE stacked block, ONE leader. The two
    // separate top callouts targeted the same/adjacent top-row module from
    // both sides and printed on top of each other (start-anchored left text
    // met end-anchored right text at the same y with no width check).
    txtCallout(Math.max(topP.x - 40, dz.x + 4), topRowY - 7.5, 'start',
      [modLine, `ON ${mountSys}`, invLine], topP.x - 2, topP.y - 4);
    // (fire-setback margin callout REMOVED — the value is now printed INSIDE
    //  each long setback band, reference-style; the margin version's leader
    //  crossed the array and its text collided with GENERAL NOTES)
    // (N) junction box + conduit — JB symbol at the SE eave EXIT point (roof
    // boundary, not on a module); text goes into the right margin when there
    // is room, else drops below the SE corner.
    const jbX = roofMaxX - 4, jbY = Math.min(eastP.y, roofMaxY - 14);
    els.push(`<rect x="${(jbX - 3.5).toFixed(1)}" y="${(jbY - 3.5).toFixed(1)}" width="7" height="7" fill="#fff" stroke="#000" stroke-width="1"/>`);
    els.push(`<line x1="${(jbX - 3.5).toFixed(1)}" y1="${(jbY - 3.5).toFixed(1)}" x2="${(jbX + 3.5).toFixed(1)}" y2="${(jbY + 3.5).toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
    const cEndX = roofMaxX - 8, cEndY = roofMaxY - 6;
    els.push(`<polyline points="${jbX.toFixed(1)},${jbY.toFixed(1)} ${cEndX.toFixed(1)},${cEndY.toFixed(1)}" fill="none" stroke="#444" stroke-width="1" stroke-dasharray="5 3"/>`);
    // W1b — the JB conduit stub PROJECTS the canonical branch run raceway/size
    // (the branch home-run from the JB), never a hardcoded 3/4" + project conduit
    // type, so PV-1 agrees with E-1 / PV-4B on the branch conduit (gate 3).
    const _jbBranch = projectCanonicalBranch(ctx?.snapshot);
    const _jbConduit = _jbBranch.raceway === 'FREE_AIR'
      ? 'FREE AIR (Q-CABLE)'
      : (_jbBranch.raceway && _jbBranch.tradeSizeIn ? `${_jbBranch.tradeSizeIn} ${_jbBranch.raceway}` : `3/4" ${condType}`);
    const _jbLines = [`(N) JUNCTION BOX + ${_jbConduit}`, `CONDUIT — ${routeProvenanceLabel(ctx?.snapshot)}`];
    const _jbTextW = Math.max(..._jbLines.map(l => l.length)) * 3.5;
    const _rightGap = (W - zones.dims.right) - roofMaxX;
    if (_rightGap >= _jbTextW + 18) {
      txtCallout(roofMaxX + 10, jbY - 4, 'start', _jbLines, jbX + 4, jbY);
    } else {
      txtCallout(Math.min(jbX + 8, roofMaxX - 4), roofMaxY + 24, 'end', _jbLines, jbX, jbY + 4);
    }
    // (N) attachments — BELOW the overall-dimension band (dim owns
    // roofMaxY+24..+40; the callout used to print through the dim line)
    txtCallout(Math.max(botP.x - 40, dz.x + 4), roofMaxY + 48, 'start',
      [!isRailless
        ? `(N) ${mountSys} RAIL FEET @ ${_ocLabelP} STAGGERED`
        : `(N) ${mountSys} DIRECT MOUNTS @ ${_ocLabelP}`,
       ...(_spacingPendingP ? ['SPACING: PENDING STRUCTURAL VERIFICATION'] : []),
       `INTO FRAMING — SEE PV-3`],
      botP.x - 2, botP.y + 4);
  }

  // ── Viewport title (reference style): numbered circle + underlined title +
  // scale, directly below the drawing ──
  if (!isBranchColorMode) {
    const vtX = roofMinX, vtY = roofMaxY + 74;   // below the relocated attachments callout
    els.push(`<circle cx="${vtX + 8}" cy="${vtY - 3}" r="8" fill="#fff" stroke="#000" stroke-width="1.4"/>`);
    els.push(drawText(vtX + 8, vtY, '1', { anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#000' }));
    els.push(drawText(vtX + 22, vtY, svgTitle, { anchor: 'start', fontSize: 9, fontWeight: '900', fill: '#000', letterSpacing: 1 }));
    els.push(`<line x1="${vtX + 22}" y1="${vtY + 3.5}" x2="${vtX + 22 + svgTitle.length * 6.4}" y2="${vtY + 3.5}" stroke="#000" stroke-width="1.2"/>`);
    // Honest scale: the drawing is fit-to-frame, so print the nearest standard
    // architect scale actually achieved (px/ft ÷ 96dpi → in/ft) — "3/32"" was
    // hardcoded and only coincidentally true for one roof size.
    const _inPerFt = scale / 96;
    const _stdScales: Array<[string, number]> = [['1/16"', 1/16], ['3/32"', 3/32], ['1/8"', 1/8], ['3/16"', 3/16], ['1/4"', 1/4], ['3/8"', 3/8], ['1/2"', 1/2]];
    const _nearest = _stdScales.reduce((b, s) => Math.abs(s[1] - _inPerFt) < Math.abs(b[1] - _inPerFt) ? s : b, _stdScales[0]);
    const _scaleErr = Math.abs(_nearest[1] - _inPerFt) / _inPerFt;
    els.push(drawText(vtX + 22, vtY + 11, _scaleErr < 0.05 ? `SCALE: ${_nearest[0]} = 1'-0"` : 'GRAPHIC SCALE — SEE BAR', { anchor: 'start', fontSize: 6, fill: '#333' }));
  }
  // Branch-color mode (PV-1B): NO on-map legend. The data rail already prints
  // the BRANCH LEGEND (same colors, same order) — the floating CIRCUIT LEGEND
  // box double-labelled it and parked an opaque panel over the drawing (Ray's
  // ruling: legends live OFF the map; verified violation on Braidon PV-1B,
  // 2026-07-20). The bottom caption keys the device symbol + dashing instead.

  // (Branch legend overlay REMOVED — it duplicated the data-zone BRANCH LEGEND
  //  table and its opaque box painted straight over the viewport title, which
  //  is why the sheet read "UT — AC BRANCH COLOR MAP".)

  // ── Color-key caption (PV-1B only — PV-2 carries GENERAL NOTES instead). This
  // explains the module shading (useful) rather than repeating the sheet title. ──
  if (isBranchColorMode) {
    els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
      // W3 §topology-description — the caption PROJECTS the ONE canonical
      // topology accessor (branchLayoutCaption). Micros are CONNECTED IN
      // PARALLEL on the AC branch / Q-Cable — never the old "WIRED IN SERIES"
      // literal (gate 1: series language is prohibited on a micro AC-branch
      // sheet). Brand-aware (Enphase ⇒ Q Cable). The planset-structural golden
      // still guards against the on-map "BRANCH LEGEND" literal — this keys the
      // device symbol + dashing and references the rail table only.
      branchLayoutCaption(ctx?.snapshot), {
        anchor: 'start', fontSize: 6.5, fill: '#555', italic: true,
      }));
  }

  // ── SYSTEM REFERENCE table (PV-1 hybrid) ────────────────────────────────────
  // Compact per-system reference (module counts + which sheets detail each). NO
  // mini-map: the roof, ground AND fence all now draw on the real plan above, so
  // a map-on-the-map was redundant (Ray: "don't like the site key on the actual
  // map"). Bottom-right corner, clear of the compass rose.
  if (!isBranchColorMode && _hyb && (_hyb.ground.length || _hyb.fence.length)) {
    const cnt = (s?: string) => (s?.match(/(\d+)\s*MOD/)?.[1]) ?? '—';
    const gCount = cnt(_hyb.ground.map(g => g.label).find(Boolean));
    const fLabel = _hyb.fence[0]?.label ?? '';
    const fCount = cnt(fLabel);
    const fLen = fLabel.match(/·\s*([^·]+L\.F\.)/)?.[1]?.trim() ?? '';
    const rows: Array<[string, string, string]> = [
      ['ROOF PV', String(totalPanels || _drawnPanels), 'PV-1 · PV-3'],
      ...(gCount !== '—' ? [['GROUND', gCount, 'PV-1G · PV-3G'] as [string, string, string]] : []),
      ...(fCount !== '—' ? [['FENCE', `${fCount}${fLen ? ' · ' + fLen : ''}`, 'PV-1F · PV-1BF'] as [string, string, string]] : []),
    ];
    const bw = 290;
    const bh = 20 + 13 + rows.length * 14 + 8;         // title + header + rows + pad
    const bx = W - zones.dims.right - bw - 8;
    const by = (H - zones.dims.bottom) - bh - 34;      // bottom-right, clears the compass rose
    const ins: string[] = [];
    ins.push(`<g class="pv1-sitekey">`);
    ins.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#ffffff" stroke="#111" stroke-width="1"/>`);
    ins.push(`<rect x="${bx}" y="${by}" width="${bw}" height="15" fill="#111"/>`);
    ins.push(`<text x="${bx + 8}" y="${by + 11}" font-size="8" font-weight="700" fill="#fff" letter-spacing="0.4">SYSTEM REFERENCE</text>`);
    const tX = bx + 10, tW = bw - 20;
    let tY = by + 20;
    const colM = tX + 80, colS = tX + 150;
    ins.push(`<rect x="${tX}" y="${tY}" width="${tW}" height="13" fill="#111"/>`);
    ins.push(`<text x="${tX + 5}" y="${tY + 9.5}" font-size="6.2" font-weight="700" fill="#fff">SYSTEM</text>`);
    ins.push(`<text x="${colM}" y="${tY + 9.5}" font-size="6.2" font-weight="700" fill="#fff">MODULES</text>`);
    ins.push(`<text x="${colS}" y="${tY + 9.5}" font-size="6.2" font-weight="700" fill="#fff">DETAIL SHEETS</text>`);
    tY += 13;
    rows.forEach((r, i) => {
      if (i % 2) ins.push(`<rect x="${tX}" y="${tY}" width="${tW}" height="14" fill="#f1f3f6"/>`);
      ins.push(`<text x="${tX + 5}" y="${tY + 9.5}" font-size="6.4" font-weight="700" fill="#111">${r[0]}</text>`);
      ins.push(`<text x="${colM}" y="${tY + 9.5}" font-size="6.4" fill="#111">${r[1]}</text>`);
      ins.push(`<text x="${colS}" y="${tY + 9.5}" font-size="6.4" fill="#111">${r[2]}</text>`);
      tY += 14;
    });
    ins.push(`<rect x="${tX}" y="${by + 20}" width="${tW}" height="${13 + rows.length * 14}" fill="none" stroke="#333" stroke-width="0.6"/>`);
    ins.push(`</g>`);
    els.push(ins.join(''));
  }

  // ── Fence plan-view inset — PV-1B ONLY ─────────────────────────────────────
  // PV-1B has no site layer, so the schematic strip + PV-1BF pointer is the
  // fence's only presence there. On the SITE sheet the fence now draws in its
  // TRUE position (fence joined the fit basis above — Ray 2026-07-16 rejected
  // the inset there: "absolutely wrong... show the cached parcel").
  if (isBranchColorMode && _hyb && _hyb.fence.length) {
    const fw = 300, fh = 78;
    const fx = zones.dims.left + 8;
    const fy = (H - zones.dims.bottom) - fh - 34;
    els.push(fenceInsetSVG(_hyb.fence, { x: fx, y: fy, w: fw, h: fh }, 'PV-1BF'));
  }
  els.push(drawSVGClose());
  return els.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRoofStructural — PV-3 Attachment Cross-Section + Detail
// STEP 7: Full structural realism — rafter cross-section, layer stack,
//         L-foot detail circle, dimension hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export function drawRoofStructural(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { project, engineering } = input;

  // KDP (structural math consistency) — the pitch comes from THE pitch authority
  // (resolveRoofPitch), the same function the cover / specs table / PV-4C / PE-1
  // read. This block used to take `project.roofPitch` (the operator-entered 20°)
  // instead of the CAD plane the array was actually laid out on (16.52°), and
  // rounded to a whole number instead of 0.1 — so this sheet printed
  // "4:12 SLOPE" beside five other sheets printing 3.6:12, on one package.
  const _pitchAuth = resolveRoofPitch(cad, input as unknown as Record<string, unknown>);
  const pitchNum   = _pitchAuth.ratio;
  const pitchStr   = _pitchAuth.pitchStr;
  const rafterSz   = project.rafterSize         || '2x6';
  const rafterSp   = project.rafterSpacing      || 24;
  // SINGLE-SOURCE with the specs table (sheetComposition getRoofData): the
  // drawing/notes/callouts printed hardcoded 3/8" lag + 4'-0" spacing while
  // the specs table said 5/16" @ 24" O.C. — contradictions ON ONE SHEET.
  const _mSelD = (project as any).mountingSystemId
    ? getMountingSystemById((project as any).mountingSystemId as string)
    : undefined;
  // W3 §4 — attachment O.C. PROJECTS from the canonical snapshot (engine-
  // resolved spacing), never a sheet literal; PV-3 and PV-1 now agree.
  const _spD = projectStructural(ctx?.snapshot);
  const _cpRf = projectCodeAuthority(ctx?.snapshot);   // W4 §2 code editions
  // PPC §3/§4 — PV-3 now consumes the CANONICAL attachment-installation authority
  // (spacing + fastener assembly + document applicability + mount/racking states).
  // Previously this function read `_mSelD.mount.fastener*` straight out of
  // mounting-hardware-db and printed exact dims / torque / pilot / coating
  // unconditionally — while FASTENER-ASSEMBLY-UNVERIFIED and
  // EQUIPMENT-DOCUMENT-APPLICABILITY were both blocking.
  const _attD = (() => {
    const _mid = (project as any).mountingSystemId as string | undefined;
    const _asset = _mid ? getManufacturerAsset(_mid, 'racking_detail') : null;
    // AAC WS-9 RENDERER PURITY — projected from the frozen snapshot region.
    const _appl = _asset ? sheetDocumentApplicability({
      region: (ctx?.snapshot as { equipmentDocumentAuthority?: EquipmentDocumentAuthority } | undefined)
        ?.equipmentDocumentAuthority ?? null,
      category: 'racking_detail', equipmentId: _mid,
      selectedModel: _mSelD?.model ?? _asset.model, asset: _asset,
    }) : null;
    return projectAttachmentInstallationAuthority(
      ctx?.snapshot ?? null, _mid ?? null,
      _asset ? { model: _asset.model, docTitle: _asset.docTitle } : null,
      _appl ? {
        state: _appl.state,
        applicabilityVerified: _appl.applicabilityVerified,
        documentProduct: _appl.documentProduct,
      } : null,
    );
  })();
  /** true ⇒ the five verified conditions hold and exact instructions may print. */
  const _exactD = _attD.exactInstructionsAllowed;
  // ECD §7 — the ONE bonding authority PV-3 may state a METHOD from. The
  // REQUIREMENT (NEC 250.134 / 690.43) is separate and always rendered.
  const _bondD = projectRackingBondingAuthority(ctx?.snapshot ?? null);
  const attachSp   = _spD.attachmentSpacingIn
    ?? (project as any).resolvedAttachSpacingIn
    ?? project.attachmentSpacing
    ?? _mSelD?.mount?.maxSpacingIn
    ?? 48;
  const mountSys   = (((project as any)._canonical?.mountSystem as string)
    || project.mountingSystem
    || (_mSelD ? `${_mSelD.manufacturer} ${_mSelD.model}` : 'IRONRIDGE XR100')).toUpperCase();
  // RT-MINI is an L-FOOT + RAIL base (railed), NOT rail-less — only genuine
  // rail-less products get the direct-mount detail. (Matches roof-plan + BOM.)
  const isRaillessD = /RAIL-?LESS|RT[- ]?APEX|E[ -]?MOUNT ?AIR/i.test(mountSys);
  // PPC §4 — fastener FACTS come from the canonical assembly, and are RENDERABLE
  // only when the five verified conditions hold. `_embedD` is retained as the
  // SVG-geometry driver (the section is drawn to the observed embedment) but its
  // LABELS print PENDING while unverified — mirroring PV-4C.1.
  const _embedD   = _attD.fastener.embedmentIn ?? _mSelD?.mount?.fastenerEmbedmentIn ?? 2.5;
  const _embedLblD = _exactD ? `${_embedD}" MIN EMBED` : 'EMBEDMENT: PENDING';
  const lagLabelD = _exactD
    ? [
        _attD.fastener.diameterLabel ? `${_attD.fastener.diameterLabel}" DIA` : null,
        _attD.fastener.lengthIn != null ? `× ${_attD.fastener.lengthIn}"` : null,
        (_attD.fastener.fastenerType ?? '').toUpperCase() || null,
      ].filter(Boolean).join(' ')
    : `FASTENER ASSEMBLY: ${_attD.fastenerStateLabel}`;
  const roofType   = (project.roofType          || 'SHINGLE').toUpperCase();
  // W3 §2 — exact catalog module dims from the snapshot (no generic 66×40).
  const panelLenIn = _spD.moduleHeightIn ?? project.panelLengthIn ?? 0;
  const panelWidIn = _spD.moduleWidthIn  ?? project.panelWidthIn  ?? 0;
  const panelWt    = project.panelWeightLbs     || 45;
  const condType   = (project.conduitType       || 'EMT').toUpperCase();
  // W3 §7 — THE 115-vs-90 FIX. Wind/snow PROJECT from the single-sourced
  // snapshot env; the `?? 90` sheet default is DELETED. Every sheet prints the
  // same value the cover / PV-4C / PE-1 print. em-dash-safe display below.
  // BRAIDON PDF AUDIT 2026-08-27 (N11) — these feed the drawing's WIND/SNOW annotations only.
  // They printed the raw interpolated hazard values, so the PV-3 cross-section carried
  // "WIND 107.533 MPH" / "SNOW 23.284 PSF" while PV-4C and PE-1 printed 108 mph for the same
  // number. Round for display here; nothing in this template does load arithmetic with them.
  const _windRaw       = _spD.windSpeedMph ?? engineering.windSpeedMph ?? project?.ahjWindSpeedMph ?? null;
  const _snowRaw       = _spD.groundSnowPsf ?? engineering.groundSnowPsf ?? project?.ahjGroundSnowPsf ?? null;
  const windSpeedMph   = _windRaw != null ? Math.round(_windRaw) : null;
  const groundSnowPsf  = _snowRaw != null ? Number(_snowRaw.toFixed(1)) : null;
  const totalPanels    = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw           = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('roof', 'structural');
  const W = zones.canvas.width;
  const H = zones.canvas.height;
  const dz = zones.draw;

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#fafafa'));
  els.push(drawTitleBar(W, 'ROOF ATTACHMENT DETAIL — CROSS-SECTION + MOUNTING', 'SCALE: 1"=1\'-0"'));

  // ── Cross-section geometry ──
  // 4-bay rafter section, scaled UP (1" = 4.5px) — at the old 3px scale the
  // section + detail circle used barely half the drawing zone and the bottom
  // 40% of the sheet shipped blank.
  const IN_PX    = 4.5;
  const bayW     = rafterSp * IN_PX;
  const nBays    = 4;
  const roofRun  = bayW * nBays;
  const roofRise = roofRun * (pitchNum / 12);

  const secX     = dz.x + dz.width * 0.02;
  // Pinned (not %-of-height): the taller structural canvas would slide the
  // section down and re-create the blank band ABOVE it.
  const roofBaseY = zones.dims.top + Math.min(dz.height * 0.80, 350);

  // ── Bottom chord ──
  els.push(drawLine(secX, roofBaseY, secX + roofRun, roofBaseY, 'line-struct'));

  // ── Rafter slope lines ──
  const rafterTopX = secX + roofRun / 2;
  const rafterTopY = roofBaseY - roofRise / 2;
  els.push(drawLine(secX, roofBaseY, rafterTopX, rafterTopY, 'line-struct'));
  els.push(drawLine(rafterTopX, rafterTopY, secX + roofRun, roofBaseY, 'line-struct'));

  // Ridge
  els.push(drawText(rafterTopX, rafterTopY - 8, 'RIDGE', {
    anchor: 'middle', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));
  els.push(drawText(secX + 4, roofBaseY - 8, 'EAVE', {
    anchor: 'start', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));

  // Pitch annotation
  els.push(drawText(secX + roofRun / 4, roofBaseY - 22, pitchStr + ' SLOPE', {
    anchor: 'middle', fontSize: 8, fontWeight: 'bold', fill: '#000',
  }));

  // ── Rafter members (cross-section rects at each bay) ──
  // Each rafter shown as a wood cross-section with hatching
  const rafDepth = 18;
  const rafWidth = 14;
  for (let i = 0; i < nBays; i++) {
    const rfx       = secX + i * bayW + 10;
    const rfYCenter = roofBaseY - ((i + 0.5) / nBays) * roofRise * 0.5;
    const rfTop     = rfYCenter - rafDepth;
    // Wood fill
    els.push(`<rect x="${rfx.toFixed(1)}" y="${rfTop.toFixed(1)}" width="${rafWidth}" height="${rafDepth}" fill="url(#rafter-wood)" stroke="#5a3810" stroke-width="1.2"/>`);
    // Wood grain hatch
    els.push(`<rect x="${rfx.toFixed(1)}" y="${rfTop.toFixed(1)}" width="${rafWidth}" height="${rafDepth}" fill="url(#hatch-wood)" opacity="0.5"/>`);
    // Rafter size label
    els.push(drawText(rfx + rafWidth / 2, rfTop - 3, rafterSz, {
      anchor: 'middle', fontSize: 6, fill: '#333', fontWeight: 'bold',
    }));
  }

  // ── Roof layer stack (left bay — showing all roof layers) ──
  const detX  = secX + 8;
  const detY  = roofBaseY - roofRise / nBays * 0.3 - 70;
  const detW  = 120;
  type LayerDef = {
    label: string; fill: string; stroke: string; h: number;
    hatch?: string; hatchOpacity?: number;
  };
  const layers: LayerDef[] = [
    { label: 'PV MODULE',              fill: '#1a3f8a', stroke: '#0a1e4a', h: 12 },
    { label: isRaillessD ? 'MOUNT / CLAMP' : 'RAIL / CLAMP', fill: '#a0a0a0', stroke: '#444', h: 5 },
    { label: isRaillessD ? 'MOUNT BASE' : 'STANDOFF / L-FOOT', fill: '#b8b8b8', stroke: '#444', h: 8,  hatch: 'url(#hatch-steel)', hatchOpacity: 0.6 },
    { label: 'FLASHING',               fill: '#c8dce8', stroke: '#4488aa', h: 3  },
    { label: roofType + ' ROOF',       fill: '#b89060', stroke: '#665030', h: 8  },
    { label: 'SHEATHING (5/8" OSB)',   fill: 'url(#rafter-wood)', stroke: '#886030', h: 7,  hatch: 'url(#hatch-wood)', hatchOpacity: 0.35 },
    { label: 'RAFTER (' + rafterSz + ')', fill: 'url(#rafter-wood)', stroke: '#7a5a20', h: 16, hatch: 'url(#hatch-wood)', hatchOpacity: 0.5 },
  ];

  let curY = detY;
  layers.forEach((layer) => {
    els.push(drawRectFilled(detX, curY, detW, layer.h, layer.fill, layer.stroke, 1.0));
    if (layer.hatch) {
      els.push(`<rect x="${detX.toFixed(1)}" y="${curY.toFixed(1)}" width="${detW}" height="${layer.h}" fill="${layer.hatch}" opacity="${layer.hatchOpacity ?? 0.5}"/>`);
    }
    curY += layer.h;
  });

  // ── Detail circle (zoomed attachment) — sized to the detail (was r=148 with a
  // tiny stack floating in a mostly-empty bubble). The zoomed layers fill the
  // circle and a LAG BOLT penetrates flashing/shingle/sheathing INTO the rafter
  // with the embedment called out — the actual point of an attachment detail. ──
  const dcx = dz.x + dz.width * 0.72;
  const dcy = zones.dims.top + Math.min(dz.height, 436) * 0.46;
  const dcr = 122;
  els.push(`<circle cx="${dcx.toFixed(1)}" cy="${dcy.toFixed(1)}" r="${dcr}" fill="#fffff8" stroke="#000" stroke-width="1.8"/>`);
  els.push(drawText(dcx, dcy - dcr - 6, 'DETAIL 1/PV-3', { anchor: 'middle', fontSize: 8.5, fontWeight: '900', fill: '#000' }));
  els.push(drawText(dcx, dcy - dcr + 10, `ATTACHMENT DETAIL — ${isRaillessD ? 'DIRECT MOUNT' : 'RAIL MOUNT'}`, { anchor: 'middle', fontSize: 6.4, fill: '#555' }));

  // ── Mechanical attachment cross-section — TRUE CAD SECTION (Style A: white +
  // material hatch, thin crisp lines, real hardware profiles). Cut ALONG the roof
  // slope: rafter shows its long face; stack builds up; lag drives straight down.
  // Line-weight hierarchy 4:2:1, all ink black except the one red embed dim. ──
  const CUT = 0.7, OBJ = 0.4, HID = 0.32, DIM = 0.25, HAT = 0.18, INK = '#1a1a1a';
  const CL = 'stroke-dasharray="4 1.5 1 1.5"';   // dash-dot centerline
  const HD = 'stroke-dasharray="2.4 1.4"';       // hidden-line dashes

  // assembly anchors (compressed low-profile stack for rail-less RT-Mini)
  const _cx     = dcx - 14;                       // assembly center (labels stack right)
  const roofW   = 168;
  const _rlx    = _cx - roofW * 0.44;
  const deckTop = dcy + 44;                        // top of shingle surface
  const _shH = 7, _sheH = 10;
  let   _rafH = 40;
  const _rafTop = deckTop + _shH + _sheH;
  if (_rafTop + _rafH > dcy + dcr - 8) _rafH = (dcy + dcr - 8) - _rafTop;

  // helper: white cut pass + hatch overlay for a rect (steel or wood)
  const _hatchRect = (x: number, y: number, w: number, h: number, hatch: string, sw = CUT) => {
    els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffffff" stroke="${INK}" stroke-width="${sw}"/>`);
    els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${hatch}" stroke="none" opacity="0.55"/>`);
  };

  // ═══════════════ 1. RAFTER (wood, long-grain face) ═══════════════
  _hatchRect(_rlx, _rafTop, roofW, _rafH, 'url(#hatch-wood)', CUT);
  // long-grain lines running WITH the member (along-slope cut = side face)
  for (let g = 1; g <= 3; g++) {
    const gy = _rafTop + (_rafH * g) / 4;
    els.push(`<line x1="${(_rlx + 3).toFixed(1)}" y1="${gy.toFixed(1)}" x2="${(_rlx + roofW - 3).toFixed(1)}" y2="${(gy + (g % 2 ? 0.8 : -0.8)).toFixed(1)}" stroke="${INK}" stroke-width="${HAT}"/>`);
  }

  // ═══════════════ 2. SHEATHING (5/8" OSB) — separate member ═══════════════
  _hatchRect(_rlx, deckTop + _shH, roofW, _sheH, 'url(#hatch-wood)', CUT);
  // its own cut lines top+bottom so it reads distinct from the rafter slab
  els.push(`<line x1="${_rlx.toFixed(1)}" y1="${(deckTop + _shH).toFixed(1)}" x2="${(_rlx + roofW).toFixed(1)}" y2="${(deckTop + _shH).toFixed(1)}" stroke="${INK}" stroke-width="${CUT}"/>`);
  els.push(`<line x1="${_rlx.toFixed(1)}" y1="${(deckTop + _shH + _sheH).toFixed(1)}" x2="${(_rlx + roofW).toFixed(1)}" y2="${(deckTop + _shH + _sheH).toFixed(1)}" stroke="${INK}" stroke-width="${CUT}"/>`);
  // strand stipple (sparse) so OSB reads different from solid rafter
  for (let s = 0; s < 9; s++) {
    const sx = _rlx + 8 + s * (roofW - 16) / 8, sy = deckTop + _shH + 3 + (s % 3) * 2.5;
    els.push(`<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(sx + 3).toFixed(1)}" y2="${(sy + 0.6).toFixed(1)}" stroke="${INK}" stroke-width="${HAT}"/>`);
  }

  // ═══════════════ 3. UNDERLAYMENT (single line, no body) ═══════════════
  els.push(`<line x1="${_rlx.toFixed(1)}" y1="${(deckTop + _shH).toFixed(1)}" x2="${(_rlx + roofW).toFixed(1)}" y2="${(deckTop + _shH).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);

  // ═══════════════ 4. ASPHALT SHINGLE (stepped band, light poché) ═══════════════
  els.push(`<rect x="${_rlx.toFixed(1)}" y="${deckTop.toFixed(1)}" width="${roofW}" height="${_shH}" fill="#ffffff" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // sparse horizontal shingle hatch dashes (NOT tan)
  for (let sh = 0; sh < 2; sh++) {
    const shy = deckTop + 2.5 + sh * 3;
    for (let d = 0; d < 12; d++) {
      const dx = _rlx + 4 + d * (roofW - 8) / 12;
      els.push(`<line x1="${dx.toFixed(1)}" y1="${shy.toFixed(1)}" x2="${(dx + 5).toFixed(1)}" y2="${shy.toFixed(1)}" stroke="${INK}" stroke-width="${HAT}"/>`);
    }
  }
  // downslope (right) butt step — course overlap
  const _stepX = _rlx + roofW - 26;
  els.push(`<rect x="${_stepX.toFixed(1)}" y="${(deckTop - 2).toFixed(1)}" width="26" height="2.5" fill="#ffffff" stroke="${INK}" stroke-width="${OBJ}"/>`);
  els.push(`<line x1="${_stepX.toFixed(1)}" y1="${(deckTop - 2).toFixed(1)}" x2="${_stepX.toFixed(1)}" y2="${deckTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // break the shingle top line where the pad crosses (pad on top left, shingle top right)
  els.push(`<line x1="${(_cx + 24).toFixed(1)}" y1="${deckTop.toFixed(1)}" x2="${(_rlx + roofW).toFixed(1)}" y2="${deckTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);

  // ═══════════════ 5. BUTYL FLASHING PAD (AlphaSeal — SOLID BLACK poché) ═══════════════
  const _butW = 48, _padTop = deckTop - 3;
  els.push(`<rect x="${(_cx - _butW / 2).toFixed(1)}" y="${_padTop.toFixed(1)}" width="${_butW}" height="3" fill="${INK}"/>`);
  // edge squeeze-out beads flaring onto shingle (left + right)
  els.push(`<path d="M ${(_cx - _butW / 2).toFixed(1)} ${_padTop.toFixed(1)} L ${(_cx - _butW / 2 - 2.5).toFixed(1)} ${(deckTop).toFixed(1)} L ${(_cx - _butW / 2).toFixed(1)} ${(deckTop).toFixed(1)} Z" fill="${INK}"/>`);
  els.push(`<path d="M ${(_cx + _butW / 2).toFixed(1)} ${_padTop.toFixed(1)} L ${(_cx + _butW / 2 + 2.5).toFixed(1)} ${(deckTop).toFixed(1)} L ${(_cx + _butW / 2).toFixed(1)} ${(deckTop).toFixed(1)} Z" fill="${INK}"/>`);
  // screw-penetration neck — pad necks DOWN into the hole around bolt axis
  els.push(`<path d="M ${(_cx - 3).toFixed(1)} ${(_padTop + 3).toFixed(1)} L ${(_cx - 1.2).toFixed(1)} ${(deckTop + 3).toFixed(1)} L ${(_cx + 1.2).toFixed(1)} ${(deckTop + 3).toFixed(1)} L ${(_cx + 3).toFixed(1)} ${(_padTop + 3).toFixed(1)} Z" fill="${INK}"/>`);

  // ═══════════════ 6. MOUNT BASE PLATE (aluminum, steel-hatch) ═══════════════
  const _mbW = 54, _mbH = 8, _mbTop = _padTop - _mbH;
  _hatchRect(_cx - _mbW / 2, _mbTop, _mbW, _mbH, 'url(#hatch-steel)', CUT);
  // tiny top-corner chamfer lines
  els.push(`<line x1="${(_cx - _mbW / 2).toFixed(1)}" y1="${(_mbTop + 1.4).toFixed(1)}" x2="${(_cx - _mbW / 2 + 1.4).toFixed(1)}" y2="${_mbTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  els.push(`<line x1="${(_cx + _mbW / 2).toFixed(1)}" y1="${(_mbTop + 1.4).toFixed(1)}" x2="${(_cx + _mbW / 2 - 1.4).toFixed(1)}" y2="${_mbTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // raised center platform (2"×4" housing the T-slot)
  const _plW = 30, _plH = 5, _plTop = _mbTop - _plH;
  _hatchRect(_cx - _plW / 2, _plTop, _plW, _plH, 'url(#hatch-steel)', CUT);
  // T-slot notch (black) in platform top where riser bolt seats
  els.push(`<rect x="${(_cx - 2).toFixed(1)}" y="${_plTop.toFixed(1)}" width="4" height="2" fill="${INK}"/>`);

  // ═══════════════ mount stack: rail-less riser+clamp, OR rail branch ═══════════════
  let _clampBaseTop: number;   // y where the clamp sits
  let _label2: string;
  let _clampAnchorY: number;

  if (isRaillessD) {
    // ── 7. RISER T-BOLT (5/16-18 × 1", short — NO tall post) ──
    const _riseTop = _plTop - 16;
    // captive square/T nut below in the slot
    els.push(`<rect x="${(_cx - 2.5).toFixed(1)}" y="${(_plTop - 1).toFixed(1)}" width="5" height="2.5" fill="${INK}"/>`);
    // shank: two parallel object lines on centerline
    els.push(`<line x1="${(_cx - 1.1).toFixed(1)}" y1="${_riseTop.toFixed(1)}" x2="${(_cx - 1.1).toFixed(1)}" y2="${(_plTop - 1).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
    els.push(`<line x1="${(_cx + 1.1).toFixed(1)}" y1="${_riseTop.toFixed(1)}" x2="${(_cx + 1.1).toFixed(1)}" y2="${(_plTop - 1).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
    _clampBaseTop = _riseTop;
    _label2 = `${mountSys} RT-MID CLAMP`;
  } else {
    // ── GUARD: rail extrusion (hollow box, steel-hatch, internal bolt-channel) ──
    const _railH = 18, _railW = 14, _railTop = _plTop - _railH;
    _hatchRect(_cx - _railW / 2, _railTop, _railW, _railH, 'url(#hatch-steel)', CUT);
    // internal void (bolt channel) — double-wall
    els.push(`<rect x="${(_cx - _railW / 2 + 3).toFixed(1)}" y="${(_railTop + 3).toFixed(1)}" width="${(_railW - 6).toFixed(1)}" height="${(_railH - 6).toFixed(1)}" fill="#ffffff" stroke="${INK}" stroke-width="${OBJ}"/>`);
    // T-bolt in channel
    els.push(`<line x1="${_cx.toFixed(1)}" y1="${(_railTop + 2).toFixed(1)}" x2="${_cx.toFixed(1)}" y2="${(_plTop).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
    _clampBaseTop = _railTop;
    _label2 = 'RAIL + CLAMP';
  }

  // ═══════════════ 8. RT-MID CLAMP (stepped top-hat saddle, steel-hatch) ═══════════════
  const _clH = 17, _clTop = _clampBaseTop - _clH;
  const _clWebW = 12;                         // central web over riser bolt
  const _clEar = 22;                          // ear reach each side over frame top lip
  _clampAnchorY = _clTop + 3;
  // top-hat path (white cut pass)
  const _clPath =
    `M ${(_cx - _clWebW / 2).toFixed(1)} ${_clTop.toFixed(1)} ` +
    `L ${(_cx + _clWebW / 2).toFixed(1)} ${_clTop.toFixed(1)} ` +
    `L ${(_cx + _clWebW / 2).toFixed(1)} ${(_clTop + 4).toFixed(1)} ` +
    `L ${(_cx + _clEar).toFixed(1)} ${(_clTop + 4).toFixed(1)} ` +
    `L ${(_cx + _clEar).toFixed(1)} ${(_clampBaseTop).toFixed(1)} ` +
    `L ${(_cx + _clEar - 3).toFixed(1)} ${(_clampBaseTop).toFixed(1)} ` +
    `L ${(_cx + _clEar - 3).toFixed(1)} ${(_clTop + 7).toFixed(1)} ` +
    `L ${(_cx - _clEar + 3).toFixed(1)} ${(_clTop + 7).toFixed(1)} ` +
    `L ${(_cx - _clEar + 3).toFixed(1)} ${(_clampBaseTop).toFixed(1)} ` +
    `L ${(_cx - _clEar).toFixed(1)} ${(_clampBaseTop).toFixed(1)} ` +
    `L ${(_cx - _clEar).toFixed(1)} ${(_clTop + 4).toFixed(1)} ` +
    `L ${(_cx - _clWebW / 2).toFixed(1)} ${(_clTop + 4).toFixed(1)} Z`;
  els.push(`<path d="${_clPath}" fill="#ffffff" stroke="${INK}" stroke-width="${CUT}"/>`);
  els.push(`<path d="${_clPath}" fill="url(#hatch-steel)" stroke="none" opacity="0.55"/>`);
  // clamp bolt down the center into the platform T-slot
  els.push(`<line x1="${_cx.toFixed(1)}" y1="${(_clTop + 1).toFixed(1)}" x2="${_cx.toFixed(1)}" y2="${(_clampBaseTop + 2).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // bonding serration (WEEB bite) — tiny black sawtooth at clamp-arm/frame contact
  for (let w = 0; w < 3; w++) {
    const wx = _cx + _clEar - 10 + w * 3;
    els.push(`<path d="M ${wx.toFixed(1)} ${(_clampBaseTop).toFixed(1)} L ${(wx + 1.5).toFixed(1)} ${(_clampBaseTop + 1.6).toFixed(1)} L ${(wx + 3).toFixed(1)} ${(_clampBaseTop).toFixed(1)} Z" fill="${INK}"/>`);
  }

  // ═══════════════ 9. PV MODULE FRAME (hollow box extrusion) + LAMINATE ═══════════════
  const _frW = 90, _frH = 30;
  const _frL = _cx - 6;                       // frame slightly right; clamp grabs its left-top lip
  const _frTop = _clampBaseTop - _frH + 3;    // frame foot lands on the platform/clamp
  // outer box (white cut pass)
  els.push(`<rect x="${_frL.toFixed(1)}" y="${_frTop.toFixed(1)}" width="${_frW}" height="${_frH}" fill="#ffffff" stroke="${INK}" stroke-width="${CUT}"/>`);
  // wall-band hatch only (steel) then inner void white to show wall thickness
  els.push(`<rect x="${_frL.toFixed(1)}" y="${_frTop.toFixed(1)}" width="${_frW}" height="${_frH}" fill="url(#hatch-steel)" stroke="none" opacity="0.55"/>`);
  els.push(`<rect x="${(_frL + 2.5).toFixed(1)}" y="${(_frTop + 2.5).toFixed(1)}" width="${(_frW - 5).toFixed(1)}" height="${(_frH - 5).toFixed(1)}" fill="#ffffff" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // top lip (inward-turning flange the clamp grabs) at top-outer (left) corner
  els.push(`<path d="M ${_frL.toFixed(1)} ${(_frTop + 3).toFixed(1)} L ${_frL.toFixed(1)} ${_frTop.toFixed(1)} L ${(_frL + 6).toFixed(1)} ${_frTop.toFixed(1)} L ${(_frL + 6).toFixed(1)} ${(_frTop + 1.6).toFixed(1)} L ${(_frL + 2.5).toFixed(1)} ${(_frTop + 1.6).toFixed(1)} L ${(_frL + 2.5).toFixed(1)} ${(_frTop + 3).toFixed(1)} Z" fill="#ffffff" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // glazing pocket + laminate: 3-line glass/cell/backsheet sandwich in the inner U
  const _lamL = _frL + 6, _lamR = _frL + _frW - 3, _lamY = _frTop + 4.5;
  for (let L = 0; L < 3; L++) {
    els.push(`<line x1="${_lamL.toFixed(1)}" y1="${(_lamY + L * 1.6).toFixed(1)}" x2="${_lamR.toFixed(1)}" y2="${(_lamY + L * 1.6).toFixed(1)}" stroke="${INK}" stroke-width="${HID}"/>`);
  }
  // tiny butyl bead dot where laminate seats in channel
  els.push(`<rect x="${(_lamL - 1).toFixed(1)}" y="${(_lamY - 0.6).toFixed(1)}" width="1.6" height="${(3 * 1.6 + 0.6).toFixed(1)}" fill="${INK}"/>`);

  // ═══════════════ (b) LAG SCREW — 5/16" SS hex head + EPDM washer + embed ═══════════════
  const _boltX = _cx;                          // on rafter centerline
  let   _tipY  = _rafTop + Number(_embedD) * 10;
  if (_tipY > _rafTop + _rafH - 8) _tipY = _rafTop + _rafH - 8;
  const _headTop = _mbTop - 9, _headH = 8, _headW = 13;
  // 1. centerline first (under everything)
  els.push(`<line x1="${_boltX.toFixed(1)}" y1="${(_headTop - 2).toFixed(1)}" x2="${_boltX.toFixed(1)}" y2="${(_tipY + 3).toFixed(1)}" stroke="${INK}" stroke-width="0.22" ${CL}/>`);
  // 2. hex head (chamfered) — path with top corners cut
  els.push(`<path d="M ${(_boltX - _headW / 2 + 1.4).toFixed(1)} ${_headTop.toFixed(1)} L ${(_boltX + _headW / 2 - 1.4).toFixed(1)} ${_headTop.toFixed(1)} L ${(_boltX + _headW / 2).toFixed(1)} ${(_headTop + 1.4).toFixed(1)} L ${(_boltX + _headW / 2).toFixed(1)} ${(_headTop + _headH).toFixed(1)} L ${(_boltX - _headW / 2).toFixed(1)} ${(_headTop + _headH).toFixed(1)} L ${(_boltX - _headW / 2).toFixed(1)} ${(_headTop + 1.4).toFixed(1)} Z" fill="#ffffff" stroke="${INK}" stroke-width="${CUT}"/>`);
  els.push(`<path d="M ${(_boltX - _headW / 2 + 1.4).toFixed(1)} ${_headTop.toFixed(1)} L ${(_boltX + _headW / 2 - 1.4).toFixed(1)} ${_headTop.toFixed(1)} L ${(_boltX + _headW / 2).toFixed(1)} ${(_headTop + 1.4).toFixed(1)} L ${(_boltX + _headW / 2).toFixed(1)} ${(_headTop + _headH).toFixed(1)} L ${(_boltX - _headW / 2).toFixed(1)} ${(_headTop + _headH).toFixed(1)} L ${(_boltX - _headW / 2).toFixed(1)} ${(_headTop + 1.4).toFixed(1)} Z" fill="url(#hatch-steel)" stroke="none" opacity="0.55"/>`);
  // two chamfer arcs across the face (hex tell)
  els.push(`<path d="M ${(_boltX - _headW / 2 + 0.6).toFixed(1)} ${(_headTop + 2).toFixed(1)} Q ${_boltX.toFixed(1)} ${(_headTop + 1).toFixed(1)} ${(_boltX + _headW / 2 - 0.6).toFixed(1)} ${(_headTop + 2).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${OBJ}"/>`);
  els.push(`<path d="M ${(_boltX - _headW / 2 + 0.6).toFixed(1)} ${(_headTop + 3.8).toFixed(1)} Q ${_boltX.toFixed(1)} ${(_headTop + 2.8).toFixed(1)} ${(_boltX + _headW / 2 - 0.6).toFixed(1)} ${(_headTop + 3.8).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // 3. EPDM sealing washer (SOLID BLACK poché) + thin metal washer line above
  const _washTop = _headTop + _headH;
  els.push(`<line x1="${(_boltX - 5).toFixed(1)}" y1="${(_washTop).toFixed(1)}" x2="${(_boltX + 5).toFixed(1)}" y2="${(_washTop).toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  els.push(`<rect x="${(_boltX - 5.5).toFixed(1)}" y="${(_washTop + 0.3).toFixed(1)}" width="11" height="1.6" fill="${INK}"/>`);
  // 4. unthreaded shank (clearance through base + sheathing) — two clean parallel lines
  const _shankTop = _washTop + 1.9;
  els.push(`<line x1="${(_boltX - 1.2).toFixed(1)}" y1="${_shankTop.toFixed(1)}" x2="${(_boltX - 1.2).toFixed(1)}" y2="${_rafTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  els.push(`<line x1="${(_boltX + 1.2).toFixed(1)}" y1="${_shankTop.toFixed(1)}" x2="${(_boltX + 1.2).toFixed(1)}" y2="${_rafTop.toFixed(1)}" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // 5. threaded portion (in rafter only) — HIDDEN schematic zigzag, wood hatch behind
  for (let t = _rafTop + 1; t < _tipY - 1; t += 2.2) {
    els.push(`<line x1="${(_boltX - 1.6).toFixed(1)}" y1="${t.toFixed(1)}" x2="${(_boltX + 1.6).toFixed(1)}" y2="${(t + 1.1).toFixed(1)}" stroke="${INK}" stroke-width="${HID}" ${HD}/>`);
  }
  // 6. self-drill tip
  els.push(`<path d="M ${(_boltX - 1.6).toFixed(1)} ${(_tipY - 2).toFixed(1)} L ${_boltX.toFixed(1)} ${(_tipY + 1.5).toFixed(1)} L ${(_boltX + 1.6).toFixed(1)} ${(_tipY - 2).toFixed(1)}" fill="none" stroke="${INK}" stroke-width="${OBJ}"/>`);
  // 7. embedment dimension (the ONE red element) — left of bolt
  const _edX = _boltX - 12;
  els.push(`<line x1="${_edX.toFixed(1)}" y1="${_rafTop.toFixed(1)}" x2="${_edX.toFixed(1)}" y2="${_tipY.toFixed(1)}" stroke="#cc0000" stroke-width="0.6"/>`);
  els.push(`<line x1="${(_edX - 2.5).toFixed(1)}" y1="${_rafTop.toFixed(1)}" x2="${(_edX + 2.5).toFixed(1)}" y2="${_rafTop.toFixed(1)}" stroke="#cc0000" stroke-width="0.6"/>`);
  els.push(`<line x1="${(_edX - 2.5).toFixed(1)}" y1="${_tipY.toFixed(1)}" x2="${(_edX + 2.5).toFixed(1)}" y2="${_tipY.toFixed(1)}" stroke="#cc0000" stroke-width="0.6"/>`);
  // extension lines from bolt to dim line
  els.push(`<line x1="${_edX.toFixed(1)}" y1="${_rafTop.toFixed(1)}" x2="${(_boltX - 2).toFixed(1)}" y2="${_rafTop.toFixed(1)}" stroke="#cc0000" stroke-width="${DIM}"/>`);
  els.push(`<line x1="${_edX.toFixed(1)}" y1="${_tipY.toFixed(1)}" x2="${(_boltX - 2).toFixed(1)}" y2="${_tipY.toFixed(1)}" stroke="#cc0000" stroke-width="${DIM}"/>`);
  els.push(drawText(_edX - 3, (_rafTop + _tipY) / 2 + 2, _embedLblD, { anchor: 'end', fontSize: 5.4, fontWeight: 'bold', fill: '#cc0000' }));

  // rail-less character note (left of assembly, small italic)
  els.push(drawText(_cx - roofW * 0.42, deckTop - 30, isRaillessD ? 'LOW-PROFILE — NO RAIL' : 'RAIL-MOUNTED', { anchor: 'start', fontSize: 5.2, italic: true, fill: '#555' }));

  // ═══════════════ (d) LEADERS + numbered labels (right-stacked) ═══════════════
  const _callouts: Array<{ ax: number; ay: number; text: string }> = [
    { ax: _frL,                 ay: _frTop + 1.5,                text: `PV MODULE (${panelLenIn}"×${panelWidIn}") — CLAMP GRIPS TOP LIP` },
    { ax: _cx + _clEar - 3,     ay: _clampAnchorY,               text: `${_label2}` },
    { ax: _cx + _plW / 2 - 2,   ay: _plTop + 1.5,                text: 'MOUNT BASE PLATE + T-BOLT' },
    { ax: _boltX + _headW / 2,  ay: _headTop + 2.5,              text: `${lagLabelD}` },
    // PPC §4 — the hardcoded product name ('ALPHASEAL BUTYL') is a manufacturer
    // instruction/product assertion; it may print only under verified applicability.
    { ax: _cx + _butW / 2 - 4,  ay: _padTop + 1.5,               text: _exactD ? 'ALPHASEAL BUTYL FLASHING (SELF-SEAL)' : 'MOUNT BASE FLASHING — PENDING VERIFIED SELECTION' },
    { ax: _rlx + roofW - 8,     ay: deckTop + _shH / 2,          text: `${roofType} SHINGLE / UNDERLAYMENT` },
    { ax: _rlx + roofW - 8,     ay: _rafTop + _rafH / 2,         text: `SHEATHING (5/8" OSB) + ${rafterSz} RAFTER @ ${rafterSp}" O.C.` },
  ];
  const _clX = dcx + dcr - 6;
  _callouts.forEach((c, i) => {
    const _ly = dcy - 72 + i * 18;
    els.push(`<line x1="${c.ax.toFixed(1)}" y1="${c.ay.toFixed(1)}" x2="${(_clX - 2).toFixed(1)}" y2="${(_ly + 1).toFixed(1)}" stroke="${INK}" stroke-width="${DIM}"/>`);
    els.push(`<circle cx="${c.ax.toFixed(1)}" cy="${c.ay.toFixed(1)}" r="0.9" fill="${INK}"/>`);
    els.push(drawCallout({ cx: _clX + 6, cy: _ly, number: i + 1, r: 7 }));
    els.push(drawText(_clX + 17, _ly + 2.3, c.text, { anchor: 'start', fontSize: 6.4, fill: INK }));
  });

  // ── STEP 7: Load arrows ──
  const midPanY = detY + 5;   // top of layer stack
  // Wind (horizontal, pointing left into panel)
  els.push(drawWindArrow(
    secX + roofRun + 40, midPanY,
    40, 'left',
    `WIND ${windSpeedMph ?? '—'} MPH`
  ));
  // Snow (vertical, pointing down onto panel)
  if (groundSnowPsf != null && groundSnowPsf > 0) {
    els.push(drawWindArrow(
      detX + detW / 2, detY - 24,
      20, 'down',
      `SNOW ${groundSnowPsf} PSF`
    ));
  }

  // ── DIMENSION HIERARCHY ──
  // Two distinct rows, no duplication: the old layout drew rafter spacing
  // TWICE ('24" RAFTER SPACING (TYP.)' + '2'-0" O.C.') on overlapping rows,
  // striking through each other and the section linework.
  // Row 1 — single-bay rafter O.C., measured on the SECOND bay so the text
  // clears the eave layer stack at the left edge (it struck through it).
  // +36/12 puts the dim line 24px below the section's thick roof baseline —
  // at +20/12 the label text landed ON that baseline (read as struck).
  els.push(drawLinearDimension(
    secX + bayW, secX + bayW * 2,
    roofBaseY + 36, 12,
    `${rafterSp}" RAFTER O.C. (TYP.)`
  ));

  // Row 2 — attachment spacing at its true scaled length, on the next row
  // (+68 clears row 1's relocated line + label — at +44 the two labels
  // printed on top of each other).
  // PPC §3 — the DESIGN attachment spacing + its verification state, in INCHES
  // (the old label printed `4'-0" ATTACH. O.C. MAX`: an unverified maximum, in a
  // unit that contradicted the `48"` the specs table printed inches away).
  els.push(drawOverallDimension(
    secX + bayW, secX + bayW + Math.min(attachSp * IN_PX, roofRun - bayW),
    roofBaseY + 68, 16,
    `${_attD.spacingShortLabel} DESIGN ATTACH. O.C.`
  ));

  // L3 — Lag embedment (vertical, left)
  els.push(drawVerticalDimension(
    secX + 5, roofBaseY, roofBaseY - 30, 10, _exactD ? `${_embedD}" MIN. EMBED` : 'EMBEDMENT: PENDING'
  ));

  // ── FASTENER & HARDWARE SCHEDULE + ROOFING NOTES (below the section) ──
  // The 520px canvas letterboxed into the sheet and the bottom half printed
  // blank; the taller canvas carries install-critical content instead.
  {
    const hby = roofBaseY + 100;
    const hbw = (dz.width - 24) / 2;
    const hbx1 = secX, hbx2 = secX + hbw + 24;
    // PPC §4 — the FABRICATED derivations are DELETED. The old code invented a
    // drive torque and a pilot-hole diameter from the fastener DIAMETER
    // (`_lagDiaD <= 0.3125 ? '8–12 FT-LBS' : '15–20 FT-LBS'` and
    // `? '7/32"' : '1/4"'`) with no source at all — and the pilot line
    // CONTRADICTED the snapshot, which records `pilotHoleRequired: false`
    // ('no pilot hole') for the selected RT-MINI. Torque / pilot / coating are now
    // rendered ONLY from the verified canonical assembly, and the assembly carries
    // no torque field, so they print PENDING until a verified source exists.
    const hwRows: Array<[string, string]> = _exactD
      ? [
        ['ATTACHMENT', `${mountSys}${isRaillessD ? ' — RAIL-LESS' : ''}`],
        ['FASTENER', lagLabelD],
        ['EMBEDMENT', `${_embedD}" MIN INTO RAFTER`],
        ['PILOT HOLE', _attD.fastener.pilotRuleLabel.toUpperCase()],
        ['MATERIAL / COATING', (_attD.fastener.material ?? 'PER MANUFACTURER DOCUMENT').toUpperCase()],
        ['FLASHING', 'PER THE VERIFIED MANUFACTURER DOCUMENT'],
        // ECD §7 — PROJECTED, never a literal: the method label the canonical
        // bonding authority establishes (integrated-listed / separate components /
        // pending). The REQUIREMENT row below it is code and always prints.
        ['BONDING METHOD', _bondD.methodCompactLabel],
        ['BONDING REQUIREMENT', `PER ${_bondD.requirementCodeBasis}`],
      ]
      : [
        ['ATTACHMENT', `${mountSys}${isRaillessD ? ' — RAIL-LESS' : ''}`],
        ['FASTENER ASSEMBLY', _attD.fastenerStateLabel],
        ['INSTALLATION DETAILS', 'NOT ESTABLISHED'],
        // BRAIDON PDF AUDIT 2026-08-27 (V2) — 'EMBEDMENT / TORQUE / PILOT' at 6.4px bold is wider
        // than the 87px label column (the value column starts at hbx1+92), so it ran UNDER the
        // value and PV-3 printed the unreadable 'EMBEDMENT / TORQUE / PILOWITHHELD — NO VERIFIED
        // SOURCE'. Shortened to fit the column it is drawn in.
        ['EMBED / TORQUE / PILOT', 'WITHHELD — NO VERIFIED SOURCE'],
        ['MATERIAL / COATING', 'WITHHELD — NO VERIFIED SOURCE'],
        // ECD §7 — THE defect: this branch (assembly PENDING) asserted
        // 'UL 2703 INTEGRATED' on the same table that withholds embedment, torque,
        // pilot and coating for want of a verified source. It now projects the
        // same authority as the verified branch, which yields
        // 'BONDING REQUIRED — METHOD PENDING VERIFIED ASSEMBLY' here.
        ['BONDING METHOD', _bondD.methodCompactLabel],
        ['BONDING REQUIREMENT', `PER ${_bondD.requirementCodeBasis}`],
      ];
    const rfNotes = _exactD
      ? [
        `1. FLASH ALL PENETRATIONS PER MOUNTING MFR MANUAL.`,
        `2. SEALANT AT EVERY FASTENER — ${roofType}-COMPATIBLE.`,
        `3. ATTACH TO FRAMING ONLY — NEVER SHEATHING ALONE.`,
        `4. NO ATTACHMENT AT SPLICES; 1-1/2" MIN EDGE DISTANCE.`,
        `5. REPAIR DAMAGED ROOFING BEFORE MOUNTING.`,
        `6. VERIFY ROOFING MFR WARRANTY COMPATIBILITY.`,
      ]
      // While unverified: NO sealant / edge-distance / manufacturer-manual
      // instruction (they are exactly the instructions the unapplicable document
      // would have supplied). The general-practice statements that assert no
      // dimension and cite no document remain.
      : [
        ..._attD.pendingLines.map((l, i) => `${i + 1}. ${l}`),
        `${_attD.pendingLines.length + 1}. ATTACH TO FRAMING ONLY — NEVER SHEATHING ALONE.`,
        `${_attD.pendingLines.length + 2}. REPAIR DAMAGED ROOFING BEFORE MOUNTING.`,
      ];
    const rowH = 15, hdrH = 14;
    // Left: hardware schedule table
    els.push(`<rect x="${hbx1}" y="${hby}" width="${hbw}" height="${hdrH}" fill="#000"/>`);
    els.push(drawText(hbx1 + hbw / 2, hby + 10, 'FASTENER & HARDWARE SCHEDULE', { anchor: 'middle', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));
    hwRows.forEach(([l, v], i) => {
      const ry = hby + hdrH + i * rowH;
      els.push(`<rect x="${hbx1}" y="${ry}" width="${hbw}" height="${rowH}" fill="${i % 2 ? '#f4f4f4' : '#fff'}" stroke="#c8c8c8" stroke-width="0.4"/>`);
      // V2 — the label column is only 87px wide (5 → 92) and drawText does not clip, so a label
      // that overflows silently runs UNDER the value. Shrink the type for the few labels that are
      // too long rather than letting them collide (7 chars ≈ 25px of headroom at 6.4px bold).
      const _lblSize = l.length > 22 ? 5.6 : 6.4;
      els.push(drawText(hbx1 + 5, ry + 10.5, l, { anchor: 'start', fontSize: _lblSize, fontWeight: 'bold', fill: '#333' }));
      els.push(drawText(hbx1 + 92, ry + 10.5, v, { anchor: 'start', fontSize: 6.2, fill: '#111' }));
    });
    els.push(`<rect x="${hbx1}" y="${hby}" width="${hbw}" height="${hdrH + hwRows.length * rowH}" fill="none" stroke="#2b2f36" stroke-width="1"/>`);
    // Right: waterproofing / roofing notes
    els.push(`<rect x="${hbx2}" y="${hby}" width="${hbw}" height="${hdrH}" fill="#000"/>`);
    els.push(drawText(hbx2 + hbw / 2, hby + 10, 'WATERPROOFING & ROOFING NOTES', { anchor: 'middle', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));
    // V2 — the roofing notes were drawn as single unwrapped lines inside a fixed-width box, so
    // the longer ones (document applicability, the non-authoritative banner) ran straight through
    // the right border and out of the box. Wrap to the box, and size the box to the wrapped
    // result so the border always contains its own contents.
    const _rfCharBudget = Math.max(22, Math.floor((hbw - 16) / (6.4 * 0.58)));
    const _wrapRf = (t: string): string[] => {
      if (t.length <= _rfCharBudget) return [t];
      const out: string[] = []; let line = '';
      for (const w of t.split(/\s+/)) {
        if (!line) { line = w; continue; }
        if ((line + ' ' + w).length <= _rfCharBudget) line += ' ' + w;
        else { out.push(line); line = w; }
      }
      if (line) out.push(line);
      return out;
    };
    const _rfLines = rfNotes.flatMap(n => _wrapRf(n));
    const nBoxH = hdrH + _rfLines.length * 11 + 8;
    els.push(`<rect x="${hbx2}" y="${hby + hdrH}" width="${hbw}" height="${nBoxH - hdrH}" fill="#fff" stroke="#2b2f36" stroke-width="1"/>`);
    _rfLines.forEach((n, i) => {
      els.push(drawText(hbx2 + 6, hby + hdrH + 12 + i * 11, n, { anchor: 'start', fontSize: 6.4, fill: '#111' }));
    });
  }

  // ── Right panel: STRUCTURAL NOTES. The ①–⑦ callout schedule lives ONCE in the
  // page data-zone; the in-drawing copy that used to sit here (plus the utility
  // block below) was pure duplication. ──
  const schedLeft = W - zones.dims.right + 10;
  const noteHdrY  = zones.dims.top + 4;
  els.push(drawRectFilled(schedLeft - 2, noteHdrY - 2, zones.dims.right - 12, 14, '#000', '#000', 0));
  els.push(drawText(schedLeft + (zones.dims.right - 14) / 2 - 2, noteHdrY + 9, 'STRUCTURAL NOTES', {
    anchor: 'middle', fontSize: 8.5, fontWeight: '900', fill: '#fff',
  }));
  const noteY = noteHdrY + 18;

  // ROOF-SPECIFIC NOTES (no fence/ground terms)
  // PPC §3/§4 — the fastener/coating/embedment notes are AUTHORITY-GATED, and the
  // spacing note prints the DESIGN value + its verification STATUS (never
  // `4'-0" O.C. MAX`). The coating claim ('316 SS OR HOT-DIP GALVANIZED') is
  // withheld while `FastenerAssembly.material` is an honest null.
  const notes = [
    'VERIFY RAFTER SIZE + SPACING IN FIELD.',
    ...(_exactD
      ? [
        `ALL HARDWARE: ${(_attD.fastener.material ?? 'PER MANUFACTURER DOCUMENT').toUpperCase()}.`,
        `MIN. THREAD EMBEDMENT INTO RAFTER: ${_embedD}".`,
        `FASTENER: ${lagLabelD}.`,
      ]
      : [
        `FASTENER ASSEMBLY: ${_attD.fastenerStateLabel}.`,
        'INSTALLATION DETAILS: NOT ESTABLISHED.',
      ]),
    `${_attD.spacingDesignLine} — ${_attD.spacingStatusLine}.`,
    `WIND LOAD: ${windSpeedMph ?? '—'} MPH — REF: ${_cpRf.asceLabel}`,
    `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`,
    `REF: NEC 690.43 / IBC 1609 / ${_cpRf.asceLabel}`,
  ];
  // BRAIDON PDF AUDIT 2026-08-27 (V2) — these were drawn as single unwrapped lines, so any note
  // wider than the notes panel was CLIPPED MID-WORD by the panel edge. On PV-3 the spacing note
  // printed "…48 IN. O.C. — PENDING STRUCTURAL VERIFICATIC" — a truncated word on a structural
  // drawing reads as a rendering fault, and the reader loses the status the line exists to state.
  // Wrap on word boundaries to the panel width instead of letting the edge cut the text.
  const _notesAvailPx = Math.max(60, zones.dims.right - 16);
  const _noteCharBudget = Math.max(22, Math.floor(_notesAvailPx / (6.5 * 0.58)));
  const _wrapNote = (t: string): string[] => {
    if (t.length <= _noteCharBudget) return [t];
    const out: string[] = []; let line = '';
    for (const w of t.split(/\s+/)) {
      if (!line) { line = w; continue; }
      if ((line + ' ' + w).length <= _noteCharBudget) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out;
  };
  let _noteRow = 0;
  notes.forEach((note, i) => {
    for (const seg of _wrapNote(note)) {
      els.push(drawText(schedLeft, noteY + 10 + _noteRow * 9, seg, {
        anchor: 'start', fontSize: 6.5,
        fill: i === 0 ? '#cc0000' : '#333',
        fontWeight: i === 0 ? 'bold' : 'normal',
      }));
      _noteRow++;
    }
  });

  // (UTILITY ANALYSIS removed — a utility-bill block does not belong on the
  // structural attachment sheet; it lives on the electrical/system sheets.)

  // Scale note
  // PPC §4 — the detail itself stays drawn (the geometry is real), but while the
  // assembly/document authority is unverified it is banner-marked NON-AUTHORITATIVE
  // so no installer can build from it.
  els.push(drawText(zones.dims.left, H - 8,
    _exactD
      ? 'CROSS-SECTION SCHEMATIC — VERIFY RAFTER SIZE, SPACING + EMBEDMENT IN FIELD — NTS'
      : `CROSS-SECTION REFERENCE FIGURE — ${_attD.referenceDetailBanner} — NTS`, {
      anchor: 'start', fontSize: 6.5, fill: _exactD ? '#888' : '#b00', italic: true,
      fontWeight: _exactD ? 'normal' : 'bold',
    }));

  els.push(drawSVGClose());
  return els.join('');
}