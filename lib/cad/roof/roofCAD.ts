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
import type { CanonicalBridgeResult, CADCanonicalRoofPlaneInput } from '../canonicalBridge';
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
  // Error 5q fix: _canonicalCADBridge is now on PermitInputShape — no `as any` needed
  const canonicalBridge = input._canonicalCADBridge;
  const canonicalRoofPlanes = canonicalBridge?.roofPlanes ?? [];
  const usingCanonicalRoofPlanes = canonicalRoofPlanes.length > 0;

  console.log('[CAD ENGINE INIT] roofCAD', {
    panelPositions: input.project?.panelPositions?.length ?? 0,
    roofPlanes:     input.project?.roofPlanes?.length ?? 0,
    canonicalRoofPlanes: canonicalRoofPlanes.length,
    totalPanels:    input.system?.totalPanels,
    systemKw:       input.system?.totalDcKw,
  });

  const warnings: string[] = [];

  // ── Vision obstructions from SystemDefinition ────────────────────────────
  // If the caller has run the vision pipeline, SystemDefinition.obstructions
  // contains world-projected obstructions. We project them to CAD space and
  // filter panels that fall within (radiusM + setbackM) of each obstruction.
  // This is NON-BREAKING: if obstructions is undefined/empty, nothing changes.
  // Error 5w fix: _systemDefinition now declared on PermitInputShape — no `as any` needed
  // (copied — Nearmap AI obstructions are appended below; never mutate the
  // caller's SystemDefinition array)
  const sysDefObstructions: SysDefObstruction[] =
    [...(input._systemDefinition?.obstructions ?? [])];
  const sysDefElecNodes: SysDefElectricalNode[] =
    input._systemDefinition?.electricalNodes ?? [];
  const canonicalCADObstructions: CADObstruction[] = canonicalBridge?.obstructions ?? [];
  const canonicalCADElecNodes: CADElectricalNode[] = canonicalBridge?.electricalNodes ?? [];

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
  const rawPlanes  = usingCanonicalRoofPlanes ? [] : (input.project?.roofPlanes     || []).filter(
    rp => rp.vertices && rp.vertices.length >= 3 &&
          rp.vertices.every((v: any) => isFinite(v.lat) && isFinite(v.lng) && Math.abs(v.lat) > 0.001)
  );
  const rawPanels  = (input.project?.panelPositions || []).filter(
    (p: any) => p.lat && p.lng && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) > 0.001
  );

  // ── Global origin — centroid of all plane vertices ────────────
  if (usingCanonicalRoofPlanes) {
    warnings.push('roofCAD: using cad-safe canonical roof geometry from CanonicalBuildingModel');
  }

  const allLatLngs: Array<{ lat: number; lng: number }> = rawPlanes.flatMap(
    (rp: any) => rp.vertices
  );
  // When using canonical roof planes, the bridge already derived originLat/originLng
  // from the worldPolygon vertices (lat/lng → local-meters projection). Use those
  // so that GPS panel positions and other lat/lng-based computations share the same
  // coordinate origin as the canonical roof plane polygons.
  // Without this, origin defaults to (37.0, -122.0) because rawPlanes is empty,
  // placing all GPS-derived points far from the canonical plane polygons.
  const originLat = usingCanonicalRoofPlanes && canonicalBridge?.originLat != null
    ? canonicalBridge.originLat
    : allLatLngs.length > 0
      ? allLatLngs.reduce((s, v) => s + v.lat, 0) / allLatLngs.length
      : (rawPanels[0]?.lat ?? 37.0);
  const originLng = usingCanonicalRoofPlanes && canonicalBridge?.originLng != null
    ? canonicalBridge.originLng
    : allLatLngs.length > 0
      ? allLatLngs.reduce((s, v) => s + v.lng, 0) / allLatLngs.length
      : (rawPanels[0]?.lng ?? -122.0);

  // ── Nearmap AI obstructions (raw lat/lng polygons from the permit route) ──
  // Projected HERE because only roofCAD knows the local origin. Each becomes a
  // SysDefObstruction so the existing per-plane panel filtering + CADModel
  // plumbing applies unchanged; roofPlaneId is assigned by point-in-polygon
  // against the raw (real-GPS) plane rings.
  const _ptInRing = (lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
      if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  let _droppedOffRoof = 0;
  const nearmapObstructions: SysDefObstruction[] = ((input.project as any)?.roofObstructions ?? [])
    .filter((o: any) => Array.isArray(o?.polygon) && o.polygon.length >= 3)
    .map((o: any, i: number) => {
      const pts = o.polygon.filter((p: any) => isFinite(p?.lat) && isFinite(p?.lng));
      if (pts.length < 3) return null;
      let cLat = pts.reduce((s: number, p: any) => s + p.lat, 0) / pts.length;
      let cLng = pts.reduce((s: number, p: any) => s + p.lng, 0) / pts.length;
      // The Nearmap AI query AOI (~45 m) covers NEIGHBORING buildings too —
      // an obstruction only belongs on this planset if its centroid sits on
      // one of THIS project's roof planes. (Neighbor vents scattered across
      // the sheet were the "all fucky" bug.)
      // CANOPY is the exception: a tree overhanging the eave has its centroid
      // over the YARD — membership is vertex overlap either way, and the drawn
      // marker re-centers on the part of the canopy actually over the roof
      // (that's the area the aerial couldn't verify — possible hidden vents).
      const isCanopy = o.type === 'canopy';
      let hostPlane: any;
      let radPts = pts;   // vertices that drive the drawn radius
      if (isCanopy) {
        hostPlane = rawPlanes.find((rp: any) =>
          pts.some((p: any) => _ptInRing(p.lat, p.lng, rp.vertices ?? [])) ||
          (rp.vertices ?? []).some((v: any) => _ptInRing(v.lat, v.lng, pts)));
        if (!hostPlane) { _droppedOffRoof++; return null; }
        const onRoof = pts.filter((p: any) =>
          rawPlanes.some((rp: any) => _ptInRing(p.lat, p.lng, rp.vertices ?? [])));
        if (onRoof.length >= 1) {
          cLat = onRoof.reduce((s: number, p: any) => s + p.lat, 0) / onRoof.length;
          cLng = onRoof.reduce((s: number, p: any) => s + p.lng, 0) / onRoof.length;
          radPts = onRoof;   // size the marker by the OVER-ROOF part, not the whole tree
        }
      } else {
        hostPlane = rawPlanes.find((rp: any) => _ptInRing(cLat, cLng, rp.vertices ?? []));
        if (!hostPlane) { _droppedOffRoof++; return null; }
      }
      const cosLat = Math.cos(cLat * Math.PI / 180);
      // LINEAR features (ridge vents, flashing runs) are not point obstructions —
      // a circle abstraction turns them into a giant blob mid-ridge. Drop them;
      // the ridge/hip setback bands already communicate that keep-out.
      // Linear-feature drop does not apply to canopy — a tree edge tracing the
      // eave is exactly the shape we're flagging, not a ridge-vent artifact.
      if (!isCanopy) {
        const _xs = pts.map((p: any) => (p.lng - cLng) * 111320 * cosLat);
        const _ys = pts.map((p: any) => (p.lat - cLat) * 111320);
        const _extX = Math.max(...(_xs as number[])) - Math.min(...(_xs as number[]));
        const _extY = Math.max(...(_ys as number[])) - Math.min(...(_ys as number[]));
        const _long = Math.max(_extX, _extY), _short = Math.max(Math.min(_extX, _extY), 0.05);
        if (_long / _short > 3 && _long > 2) { _droppedOffRoof++; return null; }
      }
      const cXY = latLngToXY(cLat, cLng, originLat, originLng);
      // footprint radius = max vertex distance from the centroid, capped PER
      // TYPE — a vent is never 1.2 m across; coarse AI polygons at the ridge
      // junctions were rendering as dominant circles mid-sheet. Canopy gets a
      // wide cap + floor: the blind spot is genuinely large.
      const _radCap: Record<string, number> = {
        vent: 0.3, chimney: 0.8, ac_unit: 0.6, satellite: 0.5, skylight: 1.2, canopy: 3.5, other: 0.5,
      };
      const radiusM = Math.min(_radCap[o.type] ?? 0.5, Math.max(isCanopy ? 1.0 : 0.15, ...radPts.map((p: any) =>
        Math.hypot((p.lat - cLat) * 111320, (p.lng - cLng) * 111320 * cosLat))));
      return {
        id:          `nm-obs-${i}`,
        type:        o.type || 'other',
        worldX:      cXY.x,
        worldY:      cXY.y,
        radiusM,
        heightFt:    1,
        setbackIn:   Math.round(((o.clearanceM ?? 0.15) / 0.0254)),
        confidence:  typeof o.confidence === 'number' ? o.confidence : 0.8,
        roofPlaneId: hostPlane.id ?? null,
        source:      'merged' as const,
      };
    })
    .filter(Boolean) as SysDefObstruction[];
  if (nearmapObstructions.length > 0 || _droppedOffRoof > 0) {
    sysDefObstructions.push(...nearmapObstructions);
    warnings.push(`roofCAD: ${nearmapObstructions.length} Nearmap AI obstruction(s) on-roof (${_droppedOffRoof} neighbor/off-roof dropped)`);
  }

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
      // Error 5x fix: planeId now on panelPositions type; arrayId was already there
      planeId:     p.planeId || p.arrayId,
    };
  });

  // ── Build planes ──────────────────────────────────────────────
  const cadPlanes: CADRoofPlane[] = [];

  if (usingCanonicalRoofPlanes) {
    for (const rp of canonicalRoofPlanes) {
      appendCADRoofPlaneFromLocal({
        rp,
        polyXY: rp.polygon,
        setbacks: rp.setbacks,
        panelPortraitW,
        panelPortraitH,
        warnings,
        cadPlanes,
        sysDefObstructions,
        canonicalCADObstructions,
        // Real design panel positions (shared local-meter frame via canonical
        // origin) — used when they fall inside this plane; grid is the fallback.
        gpsPanels,
      });
    }
  } else if (rawPlanes.length > 0) {
    for (const rp of rawPlanes) {
      // Convert plane vertices to local XY
      const polyXY: Point2D[] = rp.vertices.map((v: any) =>
        latLngToXY(v.lat, v.lng, originLat, originLng)
      );

      const planeSetbacks = { eaveM, ridgeM, rakeM };

      // Apply uniform setback (use full inset for simplicity — all sides equal)
      // For a true AHJ permit: eave at bottom, ridge at top, rake on sides.
      // We use a conservative uniform inset of min(eave, ridge, rake).
      const conservativeInset = Math.min(planeSetbacks.eaveM, planeSetbacks.ridgeM, planeSetbacks.rakeM);
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

      const _designedPlane = planeGpsPanels.length > 0;
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
        eaveM:         planeSetbacks.eaveM.toFixed(3),
        ridgeM:        planeSetbacks.ridgeM.toFixed(3),
        rakeM:         planeSetbacks.rakeM.toFixed(3),
        insetM:        conservativeInset.toFixed(3),
        polyPts:       polyXY.length,
        usablePts:     usablePolygon.length,
        areaSqM:       areaSqM.toFixed(1),
        planePanels:   planePanels.length,
      });

      // ── Obstruction collision filtering ──────────────────────────────────
      // Remove panels whose center falls within any obstruction exclusion zone.
      // Exclusion zone = radiusM + setbackIn * INCHES_TO_METERS.
      const planeObstructions = [
        ...buildCADObstructions(sysDefObstructions, rp.id),
        ...canonicalCADObstructions.filter(o => o.roofPlaneId === rp.id),
      ];
      // DESIGNED (GPS) positions are authoritative — never silently delete a
      // customer-placed module: the roof table summed 52 while every other
      // sheet declared 53 because one designed panel fell in a keep-out. For
      // designed planes we KEEP the module and flag the conflict; the filter
      // only prunes AUTO-GENERATED grid placements.
      let filteredPanels: typeof planePanels;
      if (_designedPlane) {
        const kept = filterPanelsByObstructions(planePanels, planeObstructions, []);
        const conflicts = planePanels.length - kept.length;
        if (conflicts > 0) {
          warnings.push(`[OBSTRUCTION CONFLICT] plane ${rp.id}: ${conflicts} designed module(s) overlap obstruction keep-outs — modules retained, FIELD VERIFY clearance`);
          console.log(`[OBSTRUCTION FILTER] roofCAD plane=${rp.id} designed-plane conflicts=${conflicts} (retained)`);
        }
        filteredPanels = planePanels;
      } else {
        filteredPanels = filterPanelsByObstructions(planePanels, planeObstructions, warnings);
        const removedCount = planePanels.length - filteredPanels.length;
        if (removedCount > 0) {
          warnings.push(`[OBSTRUCTION] plane ${rp.id}: removed ${removedCount} panel(s) blocked by obstructions`);
          console.log(`[OBSTRUCTION FILTER] roofCAD plane=${rp.id} removed=${removedCount} remaining=${filteredPanels.length}`);
        }
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
        setbacks:      planeSetbacks,
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
  } else if (gpsPanels.length > 0) {
    // No roof-plane polygons, but we DO have the user's real array. Draw the
    // ACTUAL panel positions and derive a tight roof footprint from them, rather
    // than fabricating a generic box + regenerated grid (the old behavior threw
    // away the real layout — the "drops modules onto a generic box" complaint).
    warnings.push('roofCAD: no roofPlanes — drawing real panel positions, footprint derived from array');
    const panels: CADPanel[] = gpsPanels.map(gp => {
      const isPortrait = gp.orientation !== 'landscape';
      const pw = isPortrait ? panelPortraitW : panelPortraitH;
      const ph = isPortrait ? panelPortraitH : panelPortraitW;
      return {
        id:          gp.id,
        x:           gp.x - pw / 2,
        y:           gp.y - ph / 2,
        widthM:      pw,
        heightM:     ph,
        orientation: isPortrait ? 'portrait' : 'landscape',
        row:         gp.row ?? 0,
        col:         gp.col ?? 0,
        planeId:     'array',
      };
    });

    const pbb = bbox(panels.flatMap(p => [
      { x: p.x, y: p.y },
      { x: p.x + p.widthM, y: p.y + p.heightM },
    ]));
    const mX = panelPortraitW * 0.5, mY = panelPortraitH * 0.5;  // half-panel margin
    const footprint: Point2D[] = [
      { x: pbb.minX - mX, y: pbb.minY - mY },
      { x: pbb.maxX + mX, y: pbb.minY - mY },
      { x: pbb.maxX + mX, y: pbb.maxY + mY },
      { x: pbb.minX - mX, y: pbb.maxY + mY },
    ];

    console.log(`[PANEL GRID GENERATED] roofCAD plane=array source=GPS-NOPLANE count=${panels.length}`);

    cadPlanes.push({
      id:            'array',
      polygon:       footprint,
      usablePolygon: footprint,
      pitch:         input.project?.roofPitch ?? 5,
      azimuth:       180,
      areaSqM:       pbb.width * pbb.height,
      setbacks:      { eaveM, ridgeM, rakeM },
      panels,
      dimensions: {
        widthM:      pbb.width,
        heightM:     pbb.height,
        panelCountX: new Set(panels.map(p => p.col)).size,
        panelCountY: new Set(panels.map(p => p.row)).size,
      },
    });
  } else {
    // No roof plane data AND no panels — generate schematic single-plane layout
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
  // When a project-specified system size exists (e.g. 34 panels / 13.60 kW),
  // the CAD layout may place far more panels than specified because worldPolygon
  // projections can produce oversized roof areas.  Honour the project spec as
  // the authoritative system size; fall back to the CAD-placed count only when
  // no project spec exists.
  const projectTotalPanels = input.system?.totalPanels;
  const totalPanels = projectTotalPanels && projectTotalPanels > 0
    ? projectTotalPanels
    : (allPanels.length || input.system?.totalPanels || 0);
  // Error 5ab fix: panelWatts IS on PermitInputShape.system.inverters[].strings[] — no `as any` needed
  const panelWatts  = input.system?.inverters?.[0]?.strings?.[0]?.panelWatts
    ?? input.project?.['panelWatts']
    ?? 400;
  const totalDcKw   = projectTotalPanels && projectTotalPanels > 0
    ? (input.system?.totalDcKw ?? (totalPanels * panelWatts / 1000))
    : totalPanels * panelWatts / 1000;

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
  const allCADObstructions = [
    ...buildCADObstructions(sysDefObstructions, null),
    ...canonicalCADObstructions,
  ];
  const allCADElecNodes = [
    ...buildCADElectricalNodes(sysDefElecNodes),
    ...canonicalCADElecNodes,
  ];

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


function appendCADRoofPlaneFromLocal(args: {
  rp: CADCanonicalRoofPlaneInput;
  polyXY: Point2D[];
  setbacks: { eaveM: number; ridgeM: number; rakeM: number };
  panelPortraitW: number;
  panelPortraitH: number;
  warnings: string[];
  cadPlanes: CADRoofPlane[];
  sysDefObstructions: SysDefObstruction[];
  canonicalCADObstructions: CADObstruction[];
  gpsPanels: Array<{
    id: string; x: number; y: number;
    orientation: string; row?: number; col?: number; planeId?: string;
  }>;
}): void {
  const {
    rp,
    polyXY,
    setbacks,
    panelPortraitW,
    panelPortraitH,
    warnings,
    cadPlanes,
    sysDefObstructions,
    canonicalCADObstructions,
    gpsPanels,
  } = args;

  const conservativeInset = Math.min(setbacks.eaveM, setbacks.ridgeM, setbacks.rakeM);
  const usablePolygon = insetPolygon(polyXY, conservativeInset);
  const planeBB = bbox(usablePolygon.length >= 3 ? usablePolygon : polyXY);
  const gridPoly = usablePolygon.length >= 3 ? usablePolygon : polyXY;
  const gridBB = bbox(gridPoly);

  // Prefer the real design panel positions that fall inside this plane polygon.
  // Only grid-generate when the design carries no panels for this plane — this
  // mirrors the legacy rawPlanes branch and stops the planset from tiling a
  // synthetic grid over the canonical roof instead of the user's actual layout.
  const planeGpsPanels = gpsPanels.filter(p =>
    pointInPolygonLocal({ x: p.x, y: p.y }, polyXY)
  );

  let planePanels: CADPanel[];
  if (planeGpsPanels.length > 0) {
    planePanels = planeGpsPanels.map(gp => {
      const isPortrait = gp.orientation !== 'landscape';
      const pw = isPortrait ? panelPortraitW : panelPortraitH;
      const ph = isPortrait ? panelPortraitH : panelPortraitW;
      return {
        id:          gp.id,
        x:           gp.x - pw / 2,   // store as top-left
        y:           gp.y - ph / 2,
        widthM:      pw,
        heightM:     ph,
        orientation: isPortrait ? 'portrait' : 'landscape',
        row:         gp.row ?? 0,
        col:         gp.col ?? 0,
        planeId:     rp.id,
      };
    });
    console.log(`[PANEL GRID GENERATED] roofCAD canonical plane=${rp.id} source=GPS count=${planePanels.length}`);
  } else {
    const cells = gridInsidePolygon(
      gridPoly,
      panelPortraitW,
      panelPortraitH,
      DEFAULT_GAP_M,
      DEFAULT_GAP_M,
      gridBB,
    );

    const useCells = cells.length > 0 ? cells : (() => {
      warnings.push(`plane ${rp.id}: canonical portrait grid=0, trying landscape`);
      return gridInsidePolygon(
        gridPoly,
        panelPortraitH,
        panelPortraitW,
        DEFAULT_GAP_M,
        DEFAULT_GAP_M,
        gridBB,
      );
    })();

    planePanels = useCells.map(cell => ({
      id:          `${rp.id}-r${cell.row}-c${cell.col}`,
      x:           cell.x,
      y:           cell.y,
      widthM:      panelPortraitW,
      heightM:     panelPortraitH,
      orientation: 'portrait',
      row:         cell.row,
      col:         cell.col,
      planeId:     rp.id,
    }));
    console.log(`[PANEL GRID GENERATED] roofCAD canonical plane=${rp.id} source=GRID count=${planePanels.length}`);
  }

  const planeObstructions = [
    ...buildCADObstructions(sysDefObstructions, rp.id),
    ...canonicalCADObstructions.filter(o => o.roofPlaneId === rp.id),
  ];
  const filteredPanels = filterPanelsByObstructions(planePanels, planeObstructions, warnings);
  const removedCount = planePanels.length - filteredPanels.length;
  if (removedCount > 0) {
    warnings.push(`[OBSTRUCTION] plane ${rp.id}: removed ${removedCount} canonical panel(s) blocked by obstructions`);
  }

  const filteredBB = filteredPanels.length > 0
    ? bbox(filteredPanels.flatMap(p => [
        { x: p.x, y: p.y },
        { x: p.x + p.widthM, y: p.y + p.heightM },
      ]))
    : planeBB;
  const filteredRows = new Set(filteredPanels.map(p => p.row)).size;
  const filteredCols = new Set(filteredPanels.map(p => p.col)).size;

  console.log('[SETBACK APPLIED] roofCAD canonical', {
    planeId:       rp.id,
    eaveM:         setbacks.eaveM.toFixed(3),
    ridgeM:        setbacks.ridgeM.toFixed(3),
    rakeM:         setbacks.rakeM.toFixed(3),
    insetM:        conservativeInset.toFixed(3),
    polyPts:       polyXY.length,
    usablePts:     usablePolygon.length,
    areaSqM:       rp.areaSqM.toFixed(1),
    planePanels:   filteredPanels.length,
    sourceArtifactId: rp.sourceArtifactId,
  });

  cadPlanes.push({
    id:            rp.id,
    polygon:       polyXY,
    usablePolygon: usablePolygon.length >= 3 ? usablePolygon : polyXY,
    pitch:         rp.pitch,
    azimuth:       rp.azimuth,
    areaSqM:       rp.areaSqM,
    setbacks,
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
 *
 * SOURCE GUARANTEE (Phase 6 — CAD Input Lockdown):
 *   - SysDefObstruction.source no longer includes 'vision' — the type system
 *     enforces this. Raw vision data must go through the unified geometry pipeline:
 *     canonicalBridge.canonicalToCADInputs() → CADModel.obstructions
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
 *
 * SOURCE GUARANTEE (Phase 6 — CAD Input Lockdown):
 *   - SysDefElectricalNode.source no longer includes 'vision' — the type system
 *     enforces this. Raw vision data must go through canonicalBridge.canonicalToCADInputs().
 */
function buildCADElectricalNodes(nodes: SysDefElectricalNode[]): CADElectricalNode[] {
  return nodes
    .map(n => ({
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
  allObstructions: CADObstruction[],
  warnings: string[],
): CADPanel[] {
  // CANOPY never deletes designed modules: it flags an area the aerial could
  // not verify (hatched zone + note on the sheet). Hard-filtering by it made
  // the DRAWING silently drop modules the design carries (header said 53,
  // roof showed 41) — the sheet must draw the design and flag the conflict.
  const obstructions = allObstructions.filter(o => o.type !== 'canopy');
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
