// ============================================================
// SolarPro CAD Engine — CAD → Drafting Adapter
// lib/cad/adapter.ts
//
// adaptCADToDrafting(cadModel, originalInput): DraftingInput
//
// PURPOSE:
//   Convert CADModel (geometry-solved) into the existing
//   DraftingInput format consumed by all rendering templates.
//
// RULES:
//   - Preserves ALL original PermitInput fields (pass-through)
//   - Overwrites ONLY geometry fields with CAD-solved values
//   - Templates receive a DraftingInput identical in shape to before
//   - Zero breaking changes to template signatures
//
// FIELD MAPPING:
//   CADRoofModel.planes[]        → project.roofPlanes + project.panelPositions
//   CADGroundModel.arrays[]      → layout.groundArrays
//   CADFenceModel.segments[]     → layout.fenceSegments
//
// COORDINATE ENCODING (roof + fence):
//   The roof template computes:
//     scale = (drawW - 2*margin) / lngSpan           [pixels per degree]
//     panLenPx = (panelLenIn / 12) * scale * 0.8     [feet * pixels/degree = WRONG]
//
//   Fix (without touching templates): encode all XY coords as
//   "fake lat/lng" where 1 degree == 1 foot. This gives:
//     lngSpan = roof_width_in_feet
//     scale   = pixels / foot
//     panLenPx = (panelLenIn/12) * pixels/foot = correct pixels ✓
//
//   Also passes the template's Math.abs(lat) > 0.001 validation
//   because house-scale offsets in feet (10–150 ft) >> 0.001.
// ============================================================

import type { DraftingInput, DraftingLayout, DraftingProject } from '../drafting/types';
import type { PermitInputShape } from '../drafting/permitInputShape';
import type { CADModel, CADRoofPlane, CADGroundArray, CADFenceSegment } from './types';
import { metersToFt } from './geometry';

// 1 degree == 1 foot encoding constant
const METERS_TO_FEET = 3.280_839_895;

/**
 * Encode local XY meters (from CAD origin) as "fake degrees"
 * where 1 degree == 1 foot. This makes template scale = pixels/ft
 * so panLenPx = (panelLenIn/12) * scale = correct pixel size.
 *
 * A small offset (10ft) is added to keep all coords > 0.001° so
 * the template's Math.abs(lat) > 0.001 validation always passes.
 */
const FAKE_DEG_OFFSET = 10; // feet — ensures lat/lng are always > 0.001

function xyToFakeDeg(x: number, y: number): { lat: number; lng: number } {
  return {
    lat: y * METERS_TO_FEET + FAKE_DEG_OFFSET,
    lng: x * METERS_TO_FEET + FAKE_DEG_OFFSET,
  };
}

/**
 * Converts CADModel into DraftingInput for consumption by
 * drawRoofPlan / drawGroundArray / drawFencePlan templates.
 *
 * The original PermitInputShape is passed through so all
 * non-geometry fields (electrical, compliance, etc.) are preserved.
 */
export function adaptCADToDrafting(
  cad: CADModel,
  original: PermitInputShape,
): DraftingInput {
  console.log('[CAD → DRAFTING ADAPTER]', {
    systemType:   cad.systemType,
    totalPanels:  cad.totalPanels,
    totalDcKw:    cad.totalDcKw.toFixed(2),
    warnings:     cad.warnings,
    solveMs:      cad.solveMs,
  });

  // Base engineering (pass-through with CAD overrides)
  const engineering = {
    totalDcKw:    cad.totalDcKw   || original.system?.totalDcKw   || 0,
    totalAcKw:    original.system?.totalAcKw  || original.system?.totalDcKw || 0,
    totalPanels:  cad.totalPanels || original.system?.totalPanels || 0,
    windSpeedMph:  original.project?.ahjWindSpeedMph,
    groundSnowPsf: original.project?.ahjGroundSnowPsf,
    // Error 5ab fix: panelWatts/Voc/Isc ARE on PermitInputShape.system.inverters[].strings[]
    panelWatts:   original.system?.inverters?.[0]?.strings?.[0]?.panelWatts
                  ?? original.project?.['panelWatts'],
    panelVoc:     original.system?.inverters?.[0]?.strings?.[0]?.panelVoc
                  ?? original.project?.panelVoc,
    panelIsc:     original.system?.inverters?.[0]?.strings?.[0]?.panelIsc
                  ?? original.project?.panelIsc,
  };

  // Route to system-specific adapter
  switch (cad.systemType) {
    case 'roof':
      return adaptRoof(cad, original, engineering);
    case 'ground_mount':
      return adaptGround(cad, original, engineering);
    case 'solar_fence':
      return adaptFence(cad, original, engineering);
    default:
      throw new Error(`[CAD Adapter] Unknown systemType: ${cad.systemType}`);
  }
}

// ── Roof Adapter ─────────────────────────────────────────────────────────────

function adaptRoof(
  cad: CADModel,
  original: PermitInputShape,
  engineering: DraftingInput['engineering'],
): DraftingInput {
  const roof = cad.roof!;

  // Convert CAD plane polygons to fake-degree coordinates (1° == 1 ft).
  // plane.polygon vertices are stored in local XY meters from CAD origin.
  const adaptedRoofPlanes = roof.planes.map((plane: CADRoofPlane) => ({
    id:       plane.id,
    vertices: plane.polygon.map(pt => xyToFakeDeg(pt.x, pt.y)),
    pitch:    plane.pitch,
    azimuth:  plane.azimuth,
    area:     plane.areaSqM,
    _usablePolygon: plane.usablePolygon,
    _cadSolved: true,
  }));

  // Convert CAD panels to fake-degree coordinates.
  // panel.x, panel.y = top-left corner in meters.
  // Template renders at center: drawRectFilled(px - pw/2, py - ph/2, pw, ph)
  // where px = toX(p.lng). So p.lng must be the CENTER x in fake-degrees.
  const adaptedPanelPositions = roof.planes.flatMap((plane: CADRoofPlane) =>
    plane.panels.map(panel => {
      // Center of panel in meters
      const centerX = panel.x + panel.widthM  / 2;
      const centerY = panel.y + panel.heightM / 2;
      const fakeDeg = xyToFakeDeg(centerX, centerY);
      return {
        id:          panel.id,
        lat:         fakeDeg.lat,
        lng:         fakeDeg.lng,
        tilt:        plane.pitch,
        azimuth:     plane.azimuth,
        row:         panel.row,
        col:         panel.col,
        orientation: panel.orientation,
      };
    })
  );

  console.log('[CAD → DRAFTING ADAPTER] roof encoding sample:', {
    planes: adaptedRoofPlanes.length,
    panels: adaptedPanelPositions.length,
    samplePlaneVertex: adaptedRoofPlanes[0]?.vertices?.[0],
    samplePanel: adaptedPanelPositions[0],
    note: '1 degree == 1 foot; scale = pixels/ft; panLenPx = (in/12)*scale = correct',
  });

  // Roof obstructions (vents/chimneys/AC/skylights) → fake-degree circles so
  // PV-2 can draw the footprint + keep-out ring. x/y are local meters.
  const adaptedObstructions = (cad.obstructions ?? []).map(o => {
    const fd = xyToFakeDeg(o.x, o.y);
    return {
      lat:         fd.lat,
      lng:         fd.lng,
      radiusFt:    o.radiusM * METERS_TO_FEET,
      clearanceFt: o.setbackM * METERS_TO_FEET,
      type:        o.type,
    };
  });

  const project: DraftingProject = {
    ...originalProject(original),
    roofPlanes:       adaptedRoofPlanes,
    panelPositions:   adaptedPanelPositions,
    roofObstructions: adaptedObstructions.length > 0 ? adaptedObstructions : undefined,
  };

  const layout: DraftingLayout = {
    ...originalLayout(original),
  };

  return { project, layout, engineering };
}

// ── Ground Adapter ────────────────────────────────────────────────────────────

function adaptGround(
  cad: CADModel,
  original: PermitInputShape,
  engineering: DraftingInput['engineering'],
): DraftingInput {
  const ground = cad.ground!;

  // Convert CAD arrays back to layout.groundArrays format
  const adaptedGroundArrays = ground.arrays.map((arr: CADGroundArray) => ({
    id:                arr.id,
    rowCount:          arr.dimensions.rowCount,
    panelsPerRow:      arr.dimensions.panelsPerRow,
    tiltDeg:           arr.tiltDeg,
    azimuth:           arr.azimuth,
    rowSpacingFt:      metersToFt(arr.rowSpacingM),
    groundClearanceIn: arr.groundClearanceM * 39.3701,
    structureType:     arr.structureType,
    pileDepthFt:       metersToFt(arr.pileDepthM),
    pileSpacingFt:     metersToFt(arr.pileSpacingM),
    // CAD-solved extras for templates
    _cadOriginX:       arr.originX,
    _cadOriginY:       arr.originY,
    _cadPanels:        arr.panels,
    _cadRows:          arr.rows,
    _cadSolved:        true,
  }));

  const project: DraftingProject = {
    ...originalProject(original),
  };

  const layout: DraftingLayout = {
    ...originalLayout(original),
    groundArrays:   adaptedGroundArrays,
    groundSetbackFt: ground.setbackFt,
  };

  return { project, layout, engineering };
}

// ── Fence Adapter ─────────────────────────────────────────────────────────────

function adaptFence(
  cad: CADModel,
  original: PermitInputShape,
  engineering: DraftingInput['engineering'],
): DraftingInput {
  const fence = cad.fence!;

  // Convert CAD segment endpoints to fake-degree coordinates (1° == 1 ft).
  // seg.startX/Y and endX/Y are in meters from CAD origin.
  const adaptedSegments = fence.segments.map((seg: CADFenceSegment) => {
    const startFD = xyToFakeDeg(seg.startX, seg.startY);
    const endFD   = xyToFakeDeg(seg.endX,   seg.endY);
    return {
      id:         seg.id,
      startPoint: {
        lat: startFD.lat,
        lng: startFD.lng,
        x:   seg.startX,
        y:   seg.startY,
      },
      endPoint: {
        lat: endFD.lat,
        lng: endFD.lng,
        x:   seg.endX,
        y:   seg.endY,
      },
      lengthFt:   metersToFt(seg.lengthM),
      azimuth:    seg.azimuth,
      panelCount: seg.panelCount,
      tilt:       seg.tiltDeg,
      bifacial:   seg.bifacial,
      label:      seg.label,
      // CAD-solved extras
      _cadPanels: seg.panels,
      _cadPosts:  seg.posts,
      _cadSolved: true,
    };
  });

  const project: DraftingProject = {
    ...originalProject(original),
  };

  const layout: DraftingLayout = {
    ...originalLayout(original),
    fenceSegments:        adaptedSegments,
    fenceTotalLengthFt:   metersToFt(fence.totalLengthM),
    fencePostSpacingFt:   metersToFt(fence.postSpacingM),
    fencePostEmbedmentFt: metersToFt(fence.postEmbedM),
    fencePanelHeightFt:   metersToFt(fence.panelHeightM),
    fenceRailCount:       fence.railCount,
    fenceGateOpenings:    fence.gateOpenings.map(g => ({
      positionFt: metersToFt(g.positionM),
      widthFt:    metersToFt(g.widthM),
    })),
  };

  return { project, layout, engineering };
}

// ── Pass-through helpers ──────────────────────────────────────────────────────

function originalProject(original: PermitInputShape): DraftingProject {
  return {
    systemType:        original.project?.systemType,
    roofType:          original.project?.roofType,
    roofPitch:         original.project?.roofPitch,
    mountingSystem:    original.project?.mountingSystem,
    // SINGLE-SOURCE PASS-THROUGH: stripping these here made the DRAWING half
    // of PV-3 contradict its own SPECS table (IronRidge title vs RT-Mini
    // callouts; 4'-0" drawn vs 12" O.C. MAX specified). The templates resolve
    // racking + attachment spacing with the SAME chain sheetComposition uses.
    mountingSystemId:  (original.project as Record<string, unknown> | undefined)?.['mountingSystemId'],
    _canonical:        (original.project as Record<string, unknown> | undefined)?.['_canonical'],
    resolvedAttachSpacingIn:
      (original as unknown as { compliance?: { structural?: { attachment?: { maxAllowedSpacing?: number } } } })
        .compliance?.structural?.attachment?.maxAllowedSpacing,
    rafterSize:        original.project?.rafterSize,
    rafterSpacing:     original.project?.rafterSpacing,
    attachmentSpacing: original.project?.attachmentSpacing,
    panelLengthIn:     original.project?.panelLengthIn,
    panelWidthIn:      original.project?.panelWidthIn,
    panelWeightLbs:    original.project?.panelWeightLbs,
    conduitType:       original.project?.conduitType,
    ahjWindSpeedMph:   original.project?.ahjWindSpeedMph,
    ahjGroundSnowPsf:  original.project?.ahjGroundSnowPsf,
    ahjRoofSetbackIn:  original.project?.ahjRoofSetbackIn,
    ahjRidgeSetbackIn: original.project?.ahjRidgeSetbackIn,
  };
}

function originalLayout(original: PermitInputShape): DraftingLayout {
  return {
    fenceSegments:        original.layout?.fenceSegments,
    fenceTotalLengthFt:   original.layout?.fenceTotalLengthFt,
    fenceGateOpenings:    original.layout?.fenceGateOpenings,
    fencePostSpacingFt:   original.layout?.fencePostSpacingFt,
    fencePostEmbedmentFt: original.layout?.fencePostEmbedmentFt,
    fenceRailCount:       original.layout?.fenceRailCount,
    fencePanelHeightFt:   original.layout?.fencePanelHeightFt,
    groundArrays:         original.layout?.groundArrays,
    groundSetbackFt:      original.layout?.groundSetbackFt,
  };
}