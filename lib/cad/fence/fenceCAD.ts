// ============================================================
// SolarPro CAD Engine — Solar Fence CAD Solver
// lib/cad/fence/fenceCAD.ts
//
// Responsibilities:
//   - Follow fence path (polyline)
//   - Segment-based panel placement
//   - Gate openings respected (panels never overlap gates)
//   - Post spacing + structural rhythm
//   - Bifacial orientation awareness
//   - Section-based layout (solar/gate/vinyl — user-controlled)
//
// RULES:
//   - Panels align to fence segments
//   - Segment length determines count
//   - NO cross-segment influence
//   - All geometry in local XY meters
// ============================================================

import type { PermitInputShape } from '../../drafting/permitInputShape';
import type {
  CADModel, CADFenceModel, CADFenceSegment, CADFencePost, CADPanel,
  CADFenceSection, FenceSectionType,
} from '../types';
import {
  Point2D, BBox,
  latLngToXY, bbox, metersToFt, ftToMeters, fmtFt, dist2D,
} from '../geometry';

const INCHES_TO_METERS = 0.0254;
const DEFAULT_PANEL_HEIGHT_FT = 6;    // standard fence panel height
const DEFAULT_POST_SPACING_FT = 8;
const DEFAULT_POST_EMBED_FT   = 3;
const DEFAULT_RAIL_COUNT      = 2;
const DEFAULT_PANEL_WIDTH_FT  = 3.28; // ~1m wide panels for fence
const PANEL_GAP_M             = 0.01;

export function fenceCAD(input: PermitInputShape): CADModel {
  const t0 = Date.now();
  console.log('[CAD ENGINE INIT] fenceCAD', {
    fenceSegments: input.layout?.fenceSegments?.length ?? 0,
    totalPanels:   input.system?.totalPanels,
    systemKw:      input.system?.totalDcKw,
  });

  const warnings: string[] = [];

  // ── Fence parameters ─────────────────────────────────────────
  const postSpFt    = input.layout?.fencePostSpacingFt  ?? DEFAULT_POST_SPACING_FT;
  const postEmbedFt = input.layout?.fencePostEmbedmentFt ?? DEFAULT_POST_EMBED_FT;
  const railCount   = input.layout?.fenceRailCount       ?? DEFAULT_RAIL_COUNT;
  const panelHFt    = input.layout?.fencePanelHeightFt   ?? DEFAULT_PANEL_HEIGHT_FT;
  const postSpM     = ftToMeters(postSpFt);
  const postEmbedM  = ftToMeters(postEmbedFt);
  const panelHM     = ftToMeters(panelHFt);

  // Panel width from system data or default
  const panelLenIn  = input.project?.panelLengthIn ?? 66;
  const panelWidIn  = input.project?.panelWidthIn  ?? 40;
  // Fence panels: typically portrait (narrow width, full height)
  const panelWM     = panelWidIn * INCHES_TO_METERS;  // ~1.016m
  const panelHMFromInput = panelLenIn * INCHES_TO_METERS; // ~1.676m
  const effectivePanelH = Math.max(panelHM, panelHMFromInput * 0.5);

  // ── Gate openings ─────────────────────────────────────────────
  const rawGates = (input.layout?.fenceGateOpenings || []) as Array<{
    positionFt: number;
    widthFt:    number;
  }>;
  const gateOpeningsM = rawGates.map(g => ({
    positionM: ftToMeters(g.positionFt),
    widthM:    ftToMeters(g.widthFt),
  }));

  // ── Raw segments ─────────────────────────────────────────────
  const rawSegs = (input.layout?.fenceSegments || []) as Array<{
    id:         string;
    startPoint: { lat: number; lng: number; x?: number; y?: number };
    endPoint:   { lat: number; lng: number; x?: number; y?: number };
    lengthFt:   number;
    azimuth:    number;
    panelCount: number;
    tilt?:      number;
    bifacial?:  boolean;
    label?:     string;
    // GPS-first path only: real panel offsets (m, from segment start, panel
    // left edge along the axis) + the design's real panel ids, in axis order.
    panelOffsetsM?: number[];
    panelIds?:      string[];
  }>;

  // ── GPS-first: real designed fence panel positions ───────────
  // panelPositions is already SCOPED to fence panels by the hybrid engine.
  // When the design carries real GPS modules, they are AUTHORITATIVE — build
  // segments from them (principal axis per array group) instead of trusting
  // layout.fenceSegments (fence_line is often NULL → old code fabricated a
  // schematic segment at lat 0/0, azimuth 90, ignoring the real fence).
  const rawGpsPanels = (input.project?.panelPositions || []).filter(
    (p: any) => p && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) > 0.001
  ) as any[];
  let gpsOrigin: { lat: number; lng: number } | null = null;

  if (rawGpsPanels.length > 0) {
    rawSegs.length = 0; // GPS wins over fenceSegments input + schematic fallback

    // Origin = centroid of the real fence panels
    const cLat = rawGpsPanels.reduce((s, p) => s + p.lat, 0) / rawGpsPanels.length;
    const cLng = rawGpsPanels.reduce((s, p) => s + p.lng, 0) / rawGpsPanels.length;
    gpsOrigin = { lat: cLat, lng: cLng };

    // Group panels by array/layout id → one fence segment per group
    const groups = new Map<string, any[]>();
    for (const p of rawGpsPanels) {
      const key = String(p.arrayId ?? (p as any).layoutId ?? '__fence__');
      const g = groups.get(key);
      if (g) g.push(p); else groups.set(key, [p]);
    }

    const azOfVec  = (vx: number, vy: number) =>
      (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    const angDiff  = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    let segIdx = 0;
    for (const [key, group] of groups) {
      const pts = group.map(p => latLngToXY(p.lat, p.lng, cLat, cLng));
      const mx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
      const my = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;

      // Median of the design panels' facing azimuths (when present)
      const azs = group
        .map(p => p.azimuth)
        .filter((a: any) => typeof a === 'number' && isFinite(a))
        .sort((a: number, b: number) => a - b);
      const azMed: number | null = azs.length > 0 ? azs[Math.floor(azs.length / 2)] : null;

      // Principal axis of the group's local points (covariance eigenvector)
      let sxx = 0, sxy = 0, syy = 0;
      for (const pt of pts) {
        const dx = pt.x - mx, dy = pt.y - my;
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
      }
      let ux: number, uy: number;
      if (group.length >= 2 && (sxx + syy) > 1e-9) {
        const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        ux = Math.cos(theta); uy = Math.sin(theta);
      } else if (azMed != null) {
        // Single panel (or degenerate cluster): axis ⟂ to the panel's facing
        const azRad = azMed * Math.PI / 180;
        ux = Math.cos(azRad); uy = -Math.sin(azRad);
      } else {
        ux = 1; uy = 0; // east-west default
      }

      // Project onto the axis: endpoints = extreme projections ± half a panel
      const ts   = pts.map(pt => (pt.x - mx) * ux + (pt.y - my) * uy);
      const tMin = Math.min(...ts);
      const tMax = Math.max(...ts);
      const halfW = panelWM / 2;
      const startXY = { x: mx + ux * (tMin - halfW), y: my + uy * (tMin - halfW) };
      const endXY   = { x: mx + ux * (tMax + halfW), y: my + uy * (tMax + halfW) };
      const lengthM = (tMax - tMin) + panelWM;

      // Segment azimuth = ⟂ to axis; pick the side matching the design's
      // median panel azimuth, else the equatorward side.
      const cand1 = azOfVec(uy, -ux);
      const cand2 = azOfVec(-uy, ux);
      const target = azMed != null ? azMed : (cLat >= 0 ? 180 : 0);
      const segAz = angDiff(cand1, target) <= angDiff(cand2, target) ? cand1 : cand2;

      // Real panel offsets along the axis (left-edge convention, sorted)
      const order = ts.map((t, i) => i).sort((a, b) => ts[a] - ts[b]);
      const offsets = order.map(i => ts[i] - tMin);
      const ids     = order.map(i => String(group[i].id ?? `gps-p${i}`));

      rawSegs.push({
        id:         key === '__fence__' ? `gps-seg${segIdx}` : key,
        startPoint: { lat: 0, lng: 0, x: startXY.x, y: startXY.y },
        endPoint:   { lat: 0, lng: 0, x: endXY.x, y: endXY.y },
        lengthFt:   metersToFt(lengthM),
        azimuth:    segAz,
        panelCount: group.length,
        tilt:       90,
        bifacial:   false,
        label:      `SEG-${segIdx + 1}`,
        panelOffsetsM: offsets,
        panelIds:      ids,
      });
      segIdx++;
    }

    const gpsTotalLenFt = rawSegs.reduce((s, seg) => s + seg.lengthFt, 0);
    console.log(`[fenceCAD] source=GPS segments=${rawSegs.length} panels=${rawGpsPanels.length} lengthFt=${gpsTotalLenFt.toFixed(1)}`);
  }

  if (rawSegs.length === 0) {
    warnings.push('fenceCAD: no fenceSegments — generating schematic single-segment');
    const totalPanels = input.system?.totalPanels ?? 10;
    const segLenM = totalPanels * (panelWM + PANEL_GAP_M);
    rawSegs.push({
      id:         'schematic',
      startPoint: { lat: 0, lng: 0, x: 0, y: 0 },
      endPoint:   { lat: 0, lng: 0, x: segLenM, y: 0 },
      lengthFt:   metersToFt(segLenM),
      azimuth:    90,
      panelCount: totalPanels,
      tilt:       90,
      bifacial:   false,
      label:      'SEG-1',
    });
  }

  // ── Global origin — GPS centroid (GPS path) or first segment start ──
  const firstSeg  = rawSegs[0];
  const hasLatLng = !gpsOrigin &&
    firstSeg?.startPoint?.lat && Math.abs(firstSeg.startPoint.lat) > 0.001;
  const originLat = gpsOrigin ? gpsOrigin.lat : hasLatLng ? firstSeg.startPoint.lat : 0;
  const originLng = gpsOrigin ? gpsOrigin.lng : hasLatLng ? firstSeg.startPoint.lng : 0;

  // ── Convert segments to local XY ──────────────────────────────
  const cadSegments: CADFenceSegment[] = [];
  const allSections: CADFenceSection[] = [];
  let cumulativeLengthM = 0;

  for (const seg of rawSegs) {
    const startXY = hasLatLng
      ? latLngToXY(seg.startPoint.lat, seg.startPoint.lng, originLat, originLng)
      : { x: seg.startPoint.x ?? 0, y: seg.startPoint.y ?? 0 };
    const endXY = hasLatLng
      ? latLngToXY(seg.endPoint.lat, seg.endPoint.lng, originLat, originLng)
      : { x: seg.endPoint.x ?? ftToMeters(seg.lengthFt), y: seg.endPoint.y ?? 0 };

    const lengthM = dist2D(startXY, endXY) || ftToMeters(seg.lengthFt);

    // ── Direction unit vector ────────────────────────────────────
    const dx = endXY.x - startXY.x;
    const dy = endXY.y - startXY.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // ── Section-based panel placement ──────────────────────────
    // Snap to whole sections from the start — no centering, no auto-fill.
    // Small margin at end is acceptable (real install behavior).
    const sectionW = panelWM + PANEL_GAP_M;  // one panel per section slot
    // GPS path: real designed offsets drive placement (count = design count)
    const gpsOffsets = seg.panelOffsetsM;
    const panelCount = gpsOffsets
      ? gpsOffsets.length
      : (seg.panelCount || Math.floor(lengthM / sectionW));
    const panels: CADPanel[] = [];
    const segSections: CADFenceSection[] = [];
    let sectionIdx = 0;

    for (let pi = 0; pi < panelCount; pi++) {
      const t = gpsOffsets ? gpsOffsets[pi] : pi * sectionW;

      // Skip if panel falls within a gate opening.
      // GPS path: designed positions are authoritative — never drop them.
      const panelAbsPos = cumulativeLengthM + t;
      const inGate = !gpsOffsets && gateOpeningsM.some(g =>
        panelAbsPos + panelWM > g.positionM &&
        panelAbsPos < g.positionM + g.widthM
      );

      if (inGate) {
        // Create gate section
        segSections.push({
          id:         `${seg.id}-sec${sectionIdx}`,
          segmentId:  seg.id,
          index:      sectionIdx++,
          type:       'gate',
          startM:     t,
          widthM:     panelWM,
          heightM:    effectivePanelH,
          x:          startXY.x + ux * (t + panelWM / 2),
          y:          startXY.y + uy * (t + panelWM / 2),
          panelCount: 0,
        });
        continue;
      }

      const px = startXY.x + ux * t;
      const py = startXY.y + uy * t;

      panels.push({
        id:          seg.panelIds?.[pi] ?? `${seg.id}-p${pi}`,
        x:           px,
        y:           py,
        widthM:      panelWM,
        heightM:     effectivePanelH,
        orientation: 'portrait',
        row:         0,
        col:         pi,
        segmentId:   seg.id,
      });

      // Create solar section
      segSections.push({
        id:         `${seg.id}-sec${sectionIdx}`,
        segmentId:  seg.id,
        index:      sectionIdx++,
        type:       'solar',
        startM:     t,
        widthM:     panelWM,
        heightM:    effectivePanelH,
        x:          px + panelWM / 2,
        y:          py,
        panelCount: 1,
      });
    }

    // ── Post placement ───────────────────────────────────────────
    const posts: CADFencePost[] = [];
    const numPosts = Math.ceil(lengthM / postSpM) + 1;
    for (let pi2 = 0; pi2 < numPosts; pi2++) {
      const t2 = Math.min(pi2 * postSpM, lengthM);
      posts.push({
        id:      `${seg.id}-post${pi2}`,
        x:       startXY.x + ux * t2,
        y:       startXY.y + uy * t2,
        embedM:  postEmbedM,
        heightM: effectivePanelH + ftToMeters(0.5), // slight above-panel
      });
    }

    console.log('[PANEL GRID GENERATED] fenceCAD', {
      segId:      seg.id,
      lengthM:    lengthM.toFixed(2),
      panels:     panels.length,
      posts:      posts.length,
      tilt:       seg.tilt ?? 90,
      bifacial:   seg.bifacial ?? false,
    });

    // Collect sections for this segment
    allSections.push(...segSections);

    cadSegments.push({
      id:         seg.id,
      startX:     startXY.x,
      startY:     startXY.y,
      endX:       endXY.x,
      endY:       endXY.y,
      lengthM,
      azimuth:    seg.azimuth,
      panelCount: panels.length,
      panels,
      posts,
      tiltDeg:    seg.tilt    ?? 90,
      bifacial:   seg.bifacial ?? false,
      label:      seg.label   ?? seg.id,
    });

    cumulativeLengthM += lengthM;
  }

  // ── Total fence length ────────────────────────────────────────
  const totalLengthM = cadSegments.reduce((s, seg) => s + seg.lengthM, 0);

  // ── Aggregates ────────────────────────────────────────────────
  const allPanels   = cadSegments.flatMap(s => s.panels);
  const totalPanels = allPanels.length || input.system?.totalPanels || 0;
  // Error 5ab fix: panelWatts IS on PermitInputShape.system.inverters[].strings[] — no `as any` needed
  const panelWatts  = input.system?.inverters?.[0]?.strings?.[0]?.panelWatts ?? 400;
  const totalDcKw   = totalPanels * panelWatts / 1000;

  // ── Bounds ────────────────────────────────────────────────────
  const allPoints = cadSegments.flatMap(s => [
    { x: s.startX, y: s.startY },
    { x: s.endX,   y: s.endY },
  ]);
  const globalBounds = bbox(allPoints.length > 0
    ? allPoints
    : [{ x: 0, y: 0 }, { x: totalLengthM, y: effectivePanelH }]);

  // ── Dimensions ────────────────────────────────────────────────
  const dims = buildFenceDimensions(cadSegments, effectivePanelH, postEmbedM);

  const fenceModel: CADFenceModel = {
    segments:        cadSegments,
    totalPanels,
    totalLengthM,
    postSpacingM:    postSpM,
    postEmbedM,
    panelHeightM:    effectivePanelH,
    railCount,
    gateOpenings:    gateOpeningsM,
    sections:        allSections,
  };

  console.log('[FENCE CAD SOLVED]', {
    segments:    cadSegments.length,
    sections:    allSections.length,
    solarSections: allSections.filter(s => s.type === 'solar').length,
    gateSections:  allSections.filter(s => s.type === 'gate').length,
    totalPanels,
    totalLenFt:  metersToFt(totalLengthM).toFixed(1),
    totalDcKw:   totalDcKw.toFixed(2),
    solveMs:     Date.now() - t0,
    warnings,
  });

  return {
    systemType:   'solar_fence',
    version:      'v1.0',
    fence:        fenceModel,
    totalPanels,
    totalDcKw,
    panelWidthM:  panelWM,
    panelHeightM: effectivePanelH,
    originLat,
    originLng,
    bounds:       globalBounds,
    dimensions:   dims,
    solveMs:      Date.now() - t0,
    warnings,
  };
}

// ── Dimension builder ─────────────────────────────────────────




function buildFenceDimensions(
  segments: CADFenceSegment[],
  panelHeightM: number,
  postEmbedM: number,
): any[] {
  const dims: any[] = [];

  for (const seg of segments) {
    // Segment length
    dims.push({
      id:      `${seg.id}-len`,
      type:    'horizontal',
      x1:      seg.startX,
      y1:      seg.startY,
      x2:      seg.endX,
      y2:      seg.endY,
      valueFt: metersToFt(seg.lengthM),
      label:   fmtFt(metersToFt(seg.lengthM)) + ' SEG LEN',
      level:   3,
    });
  }

  // Panel height
  if (segments.length > 0) {
    dims.push({
      id:      'fence-panel-height',
      type:    'vertical',
      x1:      segments[0].startX,
      y1:      0,
      x2:      segments[0].startX,
      y2:      panelHeightM,
      valueFt: metersToFt(panelHeightM),
      label:   fmtFt(metersToFt(panelHeightM)) + ' PANEL HT',
      level:   2,
    });
    // Embedment
    dims.push({
      id:      'fence-embed',
      type:    'vertical',
      x1:      segments[0].startX,
      y1:      0,
      x2:      segments[0].startX,
      y2:      -postEmbedM,
      valueFt: metersToFt(postEmbedM),
      label:   fmtFt(metersToFt(postEmbedM)) + ' EMBED',
      level:   2,
    });
  }

  return dims;
}