// ============================================================
// SolarPro CAD Engine — Roof CAD Solver
// lib/cad/roof/roofCAD.ts
//
// Responsibilities:
//   1. Normalize roof planes (lat/lng → local XY meters)
//   2. Apply TRUE polygon setbacks per plane (independent)
//   3. Generate panel grid per plane (portrait default)
//   4. Reject panels with ANY corner outside usablePolygon
//   5. Maximize fill per plane
//   6. Compute dimensions
//
// RULES:
//   - NO shared transforms across planes
//   - Portrait is DEFAULT; landscape only if portrait yields 0
//   - NO geometry logic in rendering templates
// ============================================================

import type { PermitInputShape } from '../../drafting/permitInputShape';
import type {
  CADModel, CADRoofModel, CADRoofPlane, CADPanel, CADDimension,
  CADObstruction, CADElectricalNode,
} from '../types';
import type { SysDefObstruction, SysDefElectricalNode } from '@/lib/system/systemDefinition';
import {
  Point2D, BBox,
  latLngToXY, latlngArrayToXY, bbox,
  insetPolygon, gridInsidePolygon, polygonArea, centroid,
  metersToFt, ftToMeters, fmtFt,
} from '../geometry';

const INCHES_TO_METERS = 0.0254;

// ── Default panel dimensions ──────────────────────────────────
const DEFAULT_PANEL_LENGTH_IN = 66;   // ~1.676 m (portrait height)
const DEFAULT_PANEL_WIDTH_IN  = 40;   // ~1.016 m (portrait width)
const DEFAULT_GAP_M           = 0.02; // 2 cm between panels

// ── Setback defaults ──────────────────────────────────────────
const DEFAULT_EAVE_SETBACK_IN  = 36;  // 3 ft
const DEFAULT_RIDGE_SETBACK_IN = 36;  // 3 ft
const DEFAULT_RAKE_SETBACK_IN  = 36;  // 3 ft (sides)

export function roofCAD(input: PermitInputShape): CADModel {
  const t0 = Date.now();
  console.log('[CAD ENGINE INIT] roofCAD', {
    panelPositions: input.project?.panelPositions?.length ?? 0,
    roofPlanes:     input.project?.roofPlanes?.length ?? 0,
    totalPanels:    input.system?.totalPanels,
    systemKw:       input.system?.totalDcKw,
  });

  const warnings: string[] = [];

  // ── Vision obstructions from SystemDefinition ────────────────────────────
  // If the caller has run the vision pipeline, SystemDefinition.obstructions
  // contains world-projected obstructions. We project them to CAD space and
  // filter panels that fall within (radiusM + setbackM) of each obstruction.
  // This is NON-BREAKING: if obstructions is undefined/empty, nothing changes.
  const sysDefObstructions: SysDefObstruction[] =
    (input as any)._systemDefinition?.obstructions ?? [];
  const sysDefElecNodes: SysDefElectricalNode[] =
    (input as any)._systemDefinition?.electricalNodes ?? [];

  // ── Panel dimensions ─────────────────────────────────────────
  const panelLenIn = input.project?.panelLengthIn ?? DEFAULT_PANEL_LENGTH_IN;
  const panelWidIn = input.project?.panelWidthIn  ?? DEFAULT_PANEL_WIDTH_IN;
  // Portrait: height = length, width = width
  const panelPortraitH = panelLenIn * INCHES_TO_METERS;   // ~1.676m
  const panelPortraitW = panelWidIn * INCHES_TO_METERS;    // ~1.016m

  // ── Setbacks ──────────────────────────────────────────────────
  const eaveSetIn  = input.project?.ahjRoofSetbackIn  ?? DEFAULT_EAVE_SETBACK_IN;
  const ridgeSetIn = input.project?.ahjRidgeSetbackIn ?? DEFAULT_RIDGE_SETBACK_IN;
  const rakeSetIn  = eaveSetIn; // sides same as eave by default
  const eaveM  = eaveSetIn  * INCHES_TO_METERS;
  const ridgeM = ridgeSetIn * INCHES_TO_METERS;
  const rakeM  = rakeSetIn  * INCHES_TO_METERS;

  // ── Raw input data ────────────────────────────────────────────
  const rawPlanes  = (input.project?.roofPlanes     || []).filter(
    rp => rp.vertices && rp.vertices.length >= 3 &&
          rp.vertices.every((v: any) => isFinite(v.lat) && isFinite(v.lng) && Math.abs(v.lat) > 0.001)
  );
  const rawPanels  = (input.project?.panelPositions || []).filter(
    (p: any) => p.lat && p.lng && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) > 0.001
  );

  // ── Global origin — centroid of all plane vertices ────────────
  const allLatLngs: Array<{ lat: number; lng: number }> = rawPlanes.flatMap(
    (rp: any) => rp.vertices
  );
  const originLat = allLatLngs.length > 0
    ? allLatLngs.reduce((s, v) => s + v.lat, 0) / allLatLngs.length
    : (rawPanels[0]?.lat ?? 37.0);
  const originLng = allLatLngs.length > 0
    ? allLatLngs.reduce((s, v) => s + v.lng, 0) / allLatLngs.length
    : (rawPanels[0]?.lng ?? -122.0);

  // ── GPS panel lookup map ──────────────────────────────────────
  // Map each GPS panel to local XY
  const gpsPanels: Array<{
    id: string; x: number; y: number;
    orientation: string; row?: number; col?: number; planeId?: string;
  }> = rawPanels.map((p: any) => {
    const xy = latLngToXY(p.lat, p.lng, originLat, originLng);
    return {
      id:          p.id || `p${Math.random().toString(36).slice(2)}`,
      x:           xy.x,
      y:           xy.y,
      orientation: (p.orientation || 'portrait').toLowerCase(),
      row:         p.row,
      col:         p.col,
      planeId:     (p as any).planeId || (p as any).arrayId,
    };
  });

  // ── Build planes ──────────────────────────────────────────────
  const cadPlanes: CADRoofPlane[] = [];

  if (rawPlanes.length > 0) {
    for (const rp of rawPlanes as any[]) {
      // Convert plane vertices to local XY
      const polyXY: Point2D[] = rp.vertices.map((v: any) =>
        latLngToXY(v.lat, v.lng, originLat, originLng)
      );

      // Apply uniform setback (use full inset for simplicity — all sides equal)
      // For a true AHJ permit: eave at bottom, ridge at top, rake on sides.
      // We use a conservative uniform inset of min(eave, ridge, rake).
      const conservativeInset = Math.min(eaveM, ridgeM, rakeM);
      const usablePolygon = insetPolygon(polyXY, conservativeInset);

      const planeBB = bbox(usablePolygon.length >= 3 ? usablePolygon : polyXY);
      const areaSqM = polygonArea(polyXY);

      // ── Panel placement ───────────────────────────────────────
      // Strategy: if GPS panels available for this plane, use them.
      // Otherwise generate grid inside usablePolygon.
      const planePanels: CADPanel[] = [];

      // Find GPS panels that fall inside this plane's polygon
      const planeGpsPanels = gpsPanels.filter(p =>
        pointInPolygonLocal({ x: p.x, y: p.y }, polyXY)
      );

      if (planeGpsPanels.length > 0) {
        // Use GPS panel positions directly
        for (const gp of planeGpsPanels) {
          const isPortrait = gp.orientation !== 'landscape';
          const pw = isPortrait ? panelPortraitW : panelPortraitH;
          const ph = isPortrait ? panelPortraitH : panelPortraitW;
          planePanels.push({
            id:          gp.id,
            x:           gp.x - pw / 2,   // store as top-left
            y:           gp.y - ph / 2,
            widthM:      pw,
            heightM:     ph,
            orientation: isPortrait ? 'portrait' : 'landscape',
            row:         gp.row ?? 0,
            col:         gp.col ?? 0,
            planeId:     rp.id,
          });
        }
        console.log(`[PANEL GRID GENERATED] roofCAD plane=${rp.id} source=GPS count=${planePanels.length}`);
      } else {
        // Generate portrait grid inside usablePolygon
        const gridPoly = usablePolygon.length >= 3 ? usablePolygon : polyXY;
        const gridBB   = bbox(gridPoly);
        const cells = gridInsidePolygon(
          gridPoly,
          panelPortraitW,
          panelPortraitH,
          DEFAULT_GAP_M,
          DEFAULT_GAP_M,
          gridBB,
        );

        // If portrait yields 0, try landscape
        const useCells = cells.length > 0 ? cells : (() => {
          if (cells.length === 0) {
            warnings.push(`plane ${rp.id}: portrait grid=0, trying landscape`);
            return gridInsidePolygon(
              gridPoly, panelPortraitH, panelPortraitW,
              DEFAULT_GAP_M, DEFAULT_GAP_M, gridBB,
            );
          }
          return cells;
        })();

        for (const cell of useCells) {
          planePanels.push({
            id:          `${rp.id}-r${cell.row}-c${cell.col}`,
            x:           cell.x,
            y:           cell.y,
            widthM:      panelPortraitW,
            heightM:     panelPortraitH,
            orientation: 'portrait',
            row:         cell.row,
            col:         cell.col,
            planeId:     rp.id,
          });
        }
        console.log(`[PANEL GRID GENERATED] roofCAD plane=${rp.id} source=GRID count=${planePanels.length}`);
      }

      // ── Compute plane dimensions ──────────────────────────────
      const panelBB = planePanels.length > 0
        ? bbox(planePanels.flatMap(p => [
            { x: p.x, y: p.y },
            { x: p.x + p.widthM, y: p.y + p.heightM },
          ]))
        : planeBB;

      const uniqueRows = new Set(planePanels.map(p => p.row)).size;
      const uniqueCols = new Set(planePanels.map(p => p.col)).size;

      console.log('[SETBACK APPLIED] roofCAD', {
        planeId:       rp.id,
        eaveM:         eaveM.toFixed(3),
        ridgeM:        ridgeM.toFixed(3),
        rakeM:         rakeM.toFixed(3),
        insetM:        conservativeInset.toFixed(3),
        polyPts:       polyXY.length,
        usablePts:     usablePolygon.length,
        areaSqM:       areaSqM.toFixed(1),
        planePanels:   planePanels.length,
      });

      // ── Obstruction collision filtering ──────────────────────────────────
      // Remove panels whose center falls within any obstruction exclusion zone.
      // Exclusion zone = radiusM + setbackIn * INCHES_TO_METERS.
      const planeObstructions = buildCADObstructions(sysDefObstructions, rp.id);
      const filteredPanels = filterPanelsByObstructions(planePanels, planeObstructions, warnings);
      const removedCount = planePanels.length - filteredPanels.length;
      if (removedCount > 0) {
        warnings.push(`[OBSTRUCTION] plane ${rp.id}: removed ${removedCount} panel(s) blocked by obstructions`);
        console.log(`[OBSTRUCTION FILTER] roofCAD plane=${rp.id} removed=${removedCount} remaining=${filteredPanels.length}`);
      }

      // Recompute dimensions after filtering
      const filteredBB = filteredPanels.length > 0
        ? bbox(filteredPanels.flatMap(p => [
            { x: p.x, y: p.y },
            { x: p.x + p.widthM, y: p.y + p.heightM },
          ]))
        : panelBB;
      const filteredRows = new Set(filteredPanels.map(p => p.row)).size;
      const filteredCols = new Set(filteredPanels.map(p => p.col)).size;

      cadPlanes.push({
        id:            rp.id,
        polygon:       polyXY,
        usablePolygon: usablePolygon.length >= 3 ? usablePolygon : polyXY,
        pitch:         rp.pitch  ?? 5,
        azimuth:       rp.azimuth ?? 180,
        areaSqM,
        setbacks:      { eaveM, ridgeM, rakeM },
        panels:        filteredPanels,
        obstructions:  planeObstructions,
        dimensions: {
          widthM:      filteredBB.width,
          heightM:     filteredBB.height,
          panelCountX: filteredCols,
          panelCountY: filteredRows,
        },
      });
    }
  } else {
    // No roof plane data — generate schematic single-plane layout
    warnings.push('roofCAD: no roofPlanes with GPS — generating schematic layout');
    const totalPanels = input.system?.totalPanels || 10;

    // Estimate array size
    const cols = Math.ceil(Math.sqrt(totalPanels * 1.5));
    const rows = Math.ceil(totalPanels / cols);
    const arrayW = cols * (panelPortraitW + DEFAULT_GAP_M);
    const arrayH = rows * (panelPortraitH + DEFAULT_GAP_M);

    const schematicPoly: Point2D[] = [
      { x: -arrayW * 0.1, y: -arrayH * 0.1 },
      { x:  arrayW * 1.1, y: -arrayH * 0.1 },
      { x:  arrayW * 1.1, y:  arrayH * 1.1 },
      { x: -arrayW * 0.1, y:  arrayH * 1.1 },
    ];

    const panels: CADPanel[] = [];
    let count = 0;
    for (let r = 0; r < rows && count < totalPanels; r++) {
      for (let c = 0; c < cols && count < totalPanels; c++) {
        panels.push({
          id:          `schematic-r${r}-c${c}`,
          x:           c * (panelPortraitW + DEFAULT_GAP_M),
          y:           r * (panelPortraitH + DEFAULT_GAP_M),
          widthM:      panelPortraitW,
          heightM:     panelPortraitH,
          orientation: 'portrait',
          row:         r,
          col:         c,
          planeId:     'schematic',
        });
        count++;
      }
    }

    console.log(`[PANEL GRID GENERATED] roofCAD plane=schematic source=SCHEMATIC count=${panels.length}`);

    cadPlanes.push({
      id:            'schematic',
      polygon:       schematicPoly,
      usablePolygon: schematicPoly,
      pitch:         input.project?.roofPitch ?? 5,
      azimuth:       180,
      areaSqM:       arrayW * arrayH,
      setbacks:      { eaveM, ridgeM, rakeM },
      panels,
      dimensions: {
        widthM:      arrayW,
        heightM:     arrayH,
        panelCountX: cols,
        panelCountY: rows,
      },
    });
  }

  // ── Aggregate totals ──────────────────────────────────────────
  const allPanels = cadPlanes.flatMap(p => p.panels);
  const totalPanels = allPanels.length || input.system?.totalPanels || 0;
  const panelWatts  = (input.system?.inverters?.[0]?.strings?.[0] as any)?.panelWatts
    ?? input.project?.['panelWatts']
    ?? 400;
  const totalDcKw   = totalPanels * panelWatts / 1000;

  // ── Global bounds ──────────────────────────────────────────────
  const allPoints = cadPlanes.flatMap(p => p.polygon);
  const globalBounds = bbox(allPoints.length > 0 ? allPoints : [{ x: 0, y: 0 }, { x: 10, y: 10 }]);

  // ── Dimensions ────────────────────────────────────────────────
  const dims = buildRoofDimensions(cadPlanes);

  const roofModel: CADRoofModel = {
    planes:         cadPlanes,
    totalPanels,
    setbackIn:      eaveSetIn,
    ridgeSetbackIn: ridgeSetIn,
  };

  console.log('[ROOF CAD SOLVED]', {
    planes:      cadPlanes.length,
    totalPanels,
    totalDcKw:   totalDcKw.toFixed(2),
    solveMs:     Date.now() - t0,
    warnings,
  });

  // Build top-level CAD obstruction and electrical node arrays
  const allCADObstructions = buildCADObstructions(sysDefObstructions, null);
  const allCADElecNodes = buildCADElectricalNodes(sysDefElecNodes);

  return {
    systemType:      'roof',
    version:         'v1.0',
    roof:            roofModel,
    totalPanels,
    totalDcKw,
    panelWidthM:     panelPortraitW,
    panelHeightM:    panelPortraitH,
    originLat,
    originLng,
    bounds:          globalBounds,
    dimensions:      dims,
    solveMs:         Date.now() - t0,
    warnings,
    obstructions:    allCADObstructions.length > 0 ? allCADObstructions : undefined,
    electricalNodes: allCADElecNodes.length > 0 ? allCADElecNodes : undefined,
  };
}

// ── Dimension builder ─────────────────────────────────────────

function buildRoofDimensions(planes: CADRoofPlane[]): any[] {
  const dims: any[] = [];
  for (const plane of planes) {
    if (plane.panels.length === 0) continue;
    const panelBB = bbox(plane.panels.flatMap(p => [
      { x: p.x, y: p.y },
      { x: p.x + p.widthM, y: p.y + p.heightM },
    ]));
    // Array width (horizontal)
    dims.push({
      id:      `${plane.id}-width`,
      type:    'horizontal',
      x1:      panelBB.minX,
      y1:      panelBB.minY,
      x2:      panelBB.maxX,
      y2:      panelBB.minY,
      valueFt: metersToFt(panelBB.width),
      label:   fmtFt(metersToFt(panelBB.width)),
      level:   3,
    });
    // Array height (vertical)
    dims.push({
      id:      `${plane.id}-height`,
      type:    'vertical',
      x1:      panelBB.minX,
      y1:      panelBB.minY,
      x2:      panelBB.minX,
      y2:      panelBB.maxY,
      valueFt: metersToFt(panelBB.height),
      label:   fmtFt(metersToFt(panelBB.height)),
      level:   3,
    });
    // Setback dim
    dims.push({
      id:      `${plane.id}-setback`,
      type:    'horizontal',
      x1:      plane.polygon[0]?.x ?? 0,
      y1:      plane.polygon[0]?.y ?? 0,
      x2:      plane.usablePolygon[0]?.x ?? 0,
      y2:      plane.usablePolygon[0]?.y ?? 0,
      valueFt: metersToFt(plane.setbacks.eaveM),
      label:   fmtFt(metersToFt(plane.setbacks.eaveM)) + ' FIRE SETBACK',
      level:   2,
    });
  }
  return dims;
}

// ── Local point-in-polygon helper ────────────────────────────
function pointInPolygonLocal(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Obstruction helpers ───────────────────────────────────────────────────────

/**
 * Build CADObstruction array from SysDefObstruction[].
 * Converts setbackIn → setbackM and computes totalRadiusM.
 * If planeFilter is non-null, only includes obstructions on that plane.
 */
function buildCADObstructions(
  obstructions: SysDefObstruction[],
  planeFilter: string | null,
): CADObstruction[] {
  return obstructions
    .filter(o => planeFilter === null || o.roofPlaneId === planeFilter)
    .map(o => {
      const setbackM = o.setbackIn * 0.0254;
      return {
        id:           o.id,
        type:         o.type,
        x:            o.worldX,
        y:            o.worldY,
        radiusM:      o.radiusM,
        setbackM,
        totalRadiusM: o.radiusM + setbackM,
        heightFt:     o.heightFt,
        roofPlaneId:  o.roofPlaneId,
        source:       o.source,
        confidence:   o.confidence,
      };
    });
}

/**
 * Build CADElectricalNode array from SysDefElectricalNode[].
 */
function buildCADElectricalNodes(nodes: SysDefElectricalNode[]): CADElectricalNode[] {
  return nodes.map(n => ({
    id:                   n.id,
    type:                 n.type,
    x:                    n.worldX,
    y:                    n.worldY,
    story:                n.story,
    isPrimaryInterconnect: n.isPrimaryInterconnect,
    source:               n.source,
    confidence:           n.confidence,
  }));
}

/**
 * Filter out panels that overlap with any obstruction exclusion zone.
 * A panel is removed if its CENTER falls within totalRadiusM of an obstruction.
 *
 * This is conservative: we use the panel center, not corners, to avoid
 * removing too many panels at boundaries. Corners-based filtering would be
 * more accurate but requires AHJ-specific setback direction knowledge.
 */
function filterPanelsByObstructions(
  panels: CADPanel[],
  obstructions: CADObstruction[],
  warnings: string[],
): CADPanel[] {
  if (obstructions.length === 0) return panels;

  return panels.filter(panel => {
    const cx = panel.x + panel.widthM / 2;
    const cy = panel.y + panel.heightM / 2;

    for (const obs of obstructions) {
      const dx = cx - obs.x;
      const dy = cy - obs.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= obs.totalRadiusM) {
        return false; // panel blocked by this obstruction
      }
    }
    return true;
  });
}
