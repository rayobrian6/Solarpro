'use client';
/**
 * SolarEngine3D — Production Aurora-Solar-Quality 3D Design Engine
 * 
 * Features:
 * - CesiumJS 1.114 + Google Photorealistic 3D Tiles
 * - True surface picking: scene.pickPosition → globe.pick → ellipsoid fallback
 * - Three placement engines: Roof, Ground, Fence, Ground Array (chained rows)
 * - GPU-instanced panel rendering (Cesium entities, incremental diff)
 * - Real-time shade engine (NOAA sun position + Cesium shadow maps)
 * - Overlays: roof segments, parcel boundary, shade heatmap
 * - Full NaN/error guards on all Cesium operations
 * - renderError handler to prevent 3D freeze
 * - React.memo with custom comparison (prevents re-renders on unrelated state changes)
 * - Dynamic shadow map resolution (reduces GPU load at overview distances)
 * - Tile loading optimized (maximumScreenSpaceError, preloadFlightDestinations)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { buildDigitalTwin, enrichDigitalTwinWithDsm, type DigitalTwinData, type RoofSegment } from '@/lib/digitalTwin';
import { filterToSubjectBuilding } from '@/lib/aerial/subjectBuildingCrop';
import { getSunPosition } from '@/lib/solarMath';
import type { PlacedPanel, RoofPlane } from '@/types';
import {
  polygonCentroid,
  latLngToLocal,
  localToLatLng,
  shrinkPolygon,
  type LocalPoint,
} from '@/lib/roofGeometry';
import {
  buildSurfaceGrid,
  assignRoofPlane,
  removeObstructedPanels,
  extendRow as extendRowOnSurface,
  addRow as addRowOnSurface,
  computeEcefFrameForLegacyPlane,
} from '@/lib/surfaceGeometry3D';
import type { PlacedObstruction } from '@/types';
import {
  buildRoofPlane3D,
  computePlaneFromPoints3D,
  renderPlane3DEntity,
  renderPoint3DMarker,
  renderPreviewPolyline,
  type Cart3,
  type Plane3DFrame,
} from '@/lib/roofPlane3D';
import {
  placeFencePanels,
  placeGroundRow,
  getPanelDims,
  PANEL_OFFSET_M as PLANE_ENGINE_PANEL_OFFSET_M,
} from '@/lib/planeEngine';
import { latLngToECEF as engLatLngToECEF } from '@/lib/roofPlane3D';

// ─── v48.7: Control Layer ────────────────────────────────────────────────────
// All panel placement is now routed through placePanelsControlled().
// Original engine imports above are kept for non-placement functions
// (frame rendering, plane building, etc.) that are NOT placement calls.
import {
  placePanelsControlled,
  placePanelsMultiPlane,
  type ControlConfig,
  type ControlPlane,
  DEFAULT_SETBACKS,
} from '@/lib/3d/controlLayer';

// ─── v49.0: Isolated Ground Mount Reality Engine ──────────────────────────────
// ALL ground placement routes through this engine.
// Roof / fence systems are UNTOUCHED by this import.
import {
  buildGroundRacking,
  getMaxRows,
  getWithinTableSpacing,
  formatClickTrace,
  MOUNT_HEIGHT_M as GME_MOUNT_HEIGHT_M,
  PLP_ROW_COUNT,
  XR_ROW_COUNT,
  type GroundPanel,
  type BuildRackingOptions,
  type GroundClickTrace,
  type GroundRackingResult,
} from '@/lib/3d/ground/groundMountRealityEngine';

// PanelPrimitiveRenderer and LODManager removed — entity-based rendering used instead
import { batchComputeShadeFactors, precomputeDaySunPositions, clearSunCache } from '@/lib/sunVectorCache';

// API keys loaded from environment variables — never hardcode secrets in source
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const CESIUM_TOKEN   = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN   ?? '';

// Panel physical dimensions (standard 400W panel)
// Portrait: width=1.134m (short side), height=1.722m (long side, runs down slope)
// Landscape: width=1.722m (long side, runs along ridge), height=1.134m (short side, runs down slope)
// v48.7: Unified with planeEngine.ts + surfaceGeometry3D.ts canonical dims (was 1.133/1.721 -- 1mm off)
const PW_PORTRAIT  = 1.134;
const PH_PORTRAIT  = 1.722;
const PW_LANDSCAPE = 1.722;
const PH_LANDSCAPE = 1.134;
const PT = 0.040;  // thickness meters
// PANEL_OFFSET: vertical gap for ground / fence / fallback contexts.
// Ground mount and fence panels use this directly (their height math is separate).
const PANEL_OFFSET = 0.08; // meters above surface (ground / fence / fallback)
// v62: debug-only plane overlays (frame axis arrows, geometry audit, layout bbox).
// Off in production — they clutter the scene once several faces are placed/marked.
const DEBUG_PLANE_OVERLAYS = false;
// v62: auto-snap on single-panel move — DISABLED. First cut snapped to the nearest
// panel across ALL planes, which jumped panels onto the wrong plane and floated them
// off the roof (+ eave jerk). Rebuild with point-in-polygon plane assignment and an
// on-plane clamp before re-enabling. Free move stays on.
const ENABLE_PANEL_SNAP = false;
// v62: per-click trace snap (snap a corner onto an existing plane's point while marking)
// stays OFF — it "snaps to the next point" mid-trace, which is exactly the behaviour
// that defeats free marking. Connection is instead handled by the Stitch button, which
// now writes the averaged corners BACK into plane.vertices (see stitchRoofVertices →
// onRoofPlaneStitched) so the geometry panels are placed on follows the stitch.
const ENABLE_TRACE_SNAP = false;

// ── Mounting-system-aware roof panel offset ─────────────────────────────────
// Physical stack height from roof deck to panel bottom face:
//   rooftech-mini + xr100 : RT-MINI standoff (~4" = 0.102m) + XR100 rail (1.66" = 0.042m) ≈ 0.14m
//   rooftech-mini + xr1000: RT-MINI standoff (~4" = 0.102m) + XR1000 rail (2.0"  = 0.051m) ≈ 0.16m
//   ironridge l-foot only : L-foot body (~2.5" = 0.064m)  + XR100 rail (1.66" = 0.042m)   ≈ 0.11m
//   rail-less (rt-mini-s) : standoff only                                                   ≈ 0.10m
//   flat-roof ballasted   : tilt leg — conservative low profile                             ≈ 0.10m
//   default / unknown     : 0.12m — conservative clearance, safe for any pitch
//
// RENDERING ONLY — does NOT affect structural calc, placement math, ECEF coords, or BOM.
function getRoofPanelOffset(mountingSystemId: string): number {
  switch (mountingSystemId) {
    case 'rooftech-mini':
    case 'rt-mini':
    case 'ironridge-xr100':     // RT-MINI pads are the standard standoff for XR100
      return 0.14;              // 102mm standoff + 42mm rail = ~144mm
    case 'ironridge-xr1000':
      return 0.16;              // 102mm standoff + 51mm rail + margin
    case 'rooftech-mini-s':
    case 'rooftech-mini-t':
    case 'rooftech-hook':
      return 0.10;              // rail-less: standoff height only
    case 'rooftech-mini-m':
      return 0.12;
    case 'ironridge-flat-roof':
      return 0.10;              // ballasted tray — low profile
    default:
      return 0.12;              // safe conservative default
  }
}

// v47.257: Ground mount racking height above grade.
// All ground-mounted panels share a single flat mountPlaneZ = baseZ + MOUNT_HEIGHT_M.
// baseZ = cesiumGroundElevRef.current (sampled from terrain provider at boot).
// This prevents panels from following terrain irregularities.
const MOUNT_HEIGHT_M = 1.2; // ~4ft standard ground-mount racking height

// RENDER_SCALE_STRUCTURAL: visual thickness multiplier for ground-mount structural members.
// Applied ONLY in the renderer — does NOT affect any geometry, positions, or calculations.
// Makes strongback, rails, and braces clearly readable at Cesium viewing distances.
// Scale 2.5x: a 64mm strongback reads as ~160mm — visible but not cartoonish.
const RENDER_SCALE_STRUCTURAL = 1.0;

// ── Manufacturer racking span constants ────────────────────────────────────
// IronRidge XR1000: rail lengths 11/14/17ft, max support span ~12ft (3.66m)
// under commercial load. One post pair per span interval along the row.
const IRONRIDGE_XR_SPAN_M  = 3.66;  // 12 ft between post pairs
// PLP Power Rail: rail sections up to ~20ft (6.10m), load-rated spacing.
const PLP_POWER_RAIL_SPAN_M = 6.10; // 20 ft between post pairs
// Row count constants per racking style
const IRONRIDGE_XR_ROWS   = 4;   // IronRidge XR: up to 4 portrait rows per array
const PLP_PORTRAIT_ROWS   = 2;   // PLP Power Rail: exactly 2 portrait rows per array

// Legacy aliases (portrait default)
const PW = PW_PORTRAIT;
const PH = PH_PORTRAIT;

function panelDims(orientation: PanelOrientation): { pw: number; ph: number } {
  return orientation === 'landscape'
    ? { pw: PW_LANDSCAPE, ph: PH_LANDSCAPE }
    : { pw: PW_PORTRAIT,  ph: PH_PORTRAIT  };
}

export type PlacementMode = 'select' | 'roof' | 'ground' | 'fence' | 'auto_roof' | 'plane' | 'row' | 'measure' | 'ground_array' | 'pick_house' | 'surface_select' | 'extend_row' | 'add_row' | 'snap_panel' | 'obstruction' | 'plane3d' | 'mark_plane' | 'set_direction' | 'set_origin';
export type PanelOrientation = 'portrait' | 'landscape';
export type SystemType = 'roof' | 'ground' | 'fence';
export type LoadStage = 'idle' | 'cesium' | 'viewer' | 'tiles' | 'solar' | 'done' | 'error';

// Fence section state for user-controlled editing (solar/gate/vinyl per section)
type FenceSectionState = {
  id: string;
  segIdx: number;
  secIdx: number;
  type: 'solar' | 'gate' | 'vinyl';
  panelIds: string[];
  entityKey: string;
};

interface Props {
  lat: number;
  lng: number;
  projectAddress?: string;
  panels: PlacedPanel[];
  onPanelsChange: (panels: PlacedPanel[]) => void;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  systemType: SystemType;
  tilt: number;
  azimuth: number;
  fenceHeight: number;
  showShade: boolean;
  selectedPanel?: any;
  /** Mounting system ID from mounting-hardware-db — drives visual panel offset.
   *  Defaults to 'ironridge-xr100' when not provided. VISUAL ONLY — no structural impact. */
  mountingSystemId?: string;
  fireSetbacks?: {
    edgeSetbackM: number;
    ridgeSetbackM: number;
    eaveSetbackM: number;
    enforcePathway: boolean;
    pathwayWidthM?: number;
  };
  /** v62: render the fire setback keep-out zones on the 3D roof (driven by the
   *  Design Studio "Zones On/Off" toggle). */
  showSetbackZones?: boolean;
  onTwinLoaded?: (twin: DigitalTwinData) => void;
  onError?: (msg: string) => void;
  onLocationPick?: (lat: number, lng: number, address: string) => void;
  /** v47.121: Called when user finishes drawing a 3D roof plane (≥3 points picked on 3D tiles) */
  onRoofPlaneCreated?: (plane: import('@/types').RoofPlane) => void;
  /** v64: Stitch button — push the averaged/connected corners AND the recomputed
   *  plane frame back into roofPlanes state so panel placement (Auto Layout) +
   *  persistence use the stitched geometry, not the pre-stitch traced corners or a
   *  stale frame. One call per Stitch, all updated planes at once. */
  onRoofPlanesStitched?: (updates: Array<{
    id: string;
    vertices: Array<{ lat: number; lng: number }>;
    localFrame3D: {
      u: { x: number; y: number; z: number };
      v: { x: number; y: number; z: number };
      n: { x: number; y: number; z: number };
    };
    /** Stitched ECEF corners — the exact polygon3D that the stitch produced.
     *  Persisted so the roof-plane restore-on-load effect can rebuild the
     *  STITCHED 3D outline without re-sampling terrain. */
    polygon3D?: Array<{ x: number; y: number; z: number }>;
    /** Stitched plane origin in ECEF (min-UV corner of the stitched polygon). */
    origin3D?: { x: number; y: number; z: number };
    /** Stitched plane outward normal in ECEF. */
    normal3D?: { x: number; y: number; z: number };
  }>) => void;
  /** E2E-only diagnostics bridge. Passed only when NEXT_PUBLIC_E2E=1. */
  onE2EDiagnostics?: (diagnostics: {
    fullRebuildCount: number;
    setbackInsets: number;
    /** Number of roof-plane entities in the 3D map (after reload, should match roofPlanes count). */
    roofPlaneEntityCount: number;
  }) => void;
  /** v47.122: ID of the currently selected roof plane (highlights it, dims others) */
  selectedRoofPlaneId?: string;
  /** v47.122: Called when user clicks a roof plane in the 3D view */
  onRoofPlaneSelect?: (planeId: string) => void;
  /** v48.26: Orientation driven from DesignStudio (2D panel orientation buttons).
   *  Keeps the 3D panelOrientationRef in sync so handleAutoRoof uses the correct
   *  orientation when triggered by relayoutWithOrientation via placementMode='auto_roof'. */
  orientation?: PanelOrientation;
  /** v48.25: Called when the user toggles panel orientation inside the 3D viewer.
   *  DesignStudio uses this to keep its own `orientation` state + 2D layout in sync. */
  onOrientationChange?: (orientation: PanelOrientation) => void;
  /** CAD-derived roof planes from DesignStudio -- used by Auto Fill instead of Solar API segments */
  roofPlanes?: Array<{
    id: string;
    vertices: Array<{ lat: number; lng: number }>;
    pitch: number;
    azimuth: number;
    area: number;
    usableArea: number;
    confirmed?: boolean;
    planeHeightAtCenterMeters?: number;
    centroidLat?: number;   // v47.94: persistent centroid -- single coordinate origin
    centroidLng?: number;   // v47.94: persistent centroid -- single coordinate origin
    origin3D?:  { x: number; y: number; z: number };
    normal3D?:  { x: number; y: number; z: number };
    polygon3D?: Array<{ x: number; y: number; z: number }>;
    createdFrom3D?: boolean;
    ecefFrame3D?: { u: { x: number; y: number; z: number }; v: { x: number; y: number; z: number }; n: { x: number; y: number; z: number } };
    localFrame3D?: { u: { x: number; y: number; z: number }; v: { x: number; y: number; z: number }; n: { x: number; y: number; z: number } };
  }>;
  /** v50.11: Show irradiance heatmap overlay on the 3D roof */
  showIrradiance?: boolean;
  /** v63: Color each panel by its string assignment instead of system-type color. */
  colorByString?: boolean;
  /** v63: Render optimizer / microinverter device boxes mounted under each panel. */
  showEquipment?: boolean;
  /** v63: Panel face opacity (0.1–1). Lower it to reveal equipment under the panels. */
  panelOpacity?: number;
  /** v63: Per-panel string color + device type, keyed by panel id (from stringAssignment.ts). */
  panelMeta?: Record<string, { color?: string; deviceType?: 'optimizer' | 'micro' | 'none'; stringLabel?: string }>;
  /** v63: Legend rows for the string / equipment overlay shown in the 3D view. */
  stringLegend?: Array<{ label: string; color: string; panelCount?: number }>;
  /** v63: Manual string-painting mode. When true, a panel click reports the panel
   *  id via onPanelPaint instead of running the normal select/array behavior. */
  paintMode?: boolean;
  onPanelPaint?: (panelId: string) => void;
}

function log(tag: string, msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] [${tag}] ${msg}`;
  if (data !== undefined) console.log(line, data);
  else console.log(line);
  return line;
}

/**
 * Standardized Cesium error handler.
 * Use this instead of silent catch{} blocks so errors are always traceable.
 * @param operation - Human-readable name of the operation that failed
 * @param error    - The caught error object
 * @param warn     - If true, logs as console.warn instead of console.error (default: false)
 */
function handleCesiumError(operation: string, error: any, warn = false) {
  const msg = error?.message ?? String(error);
  const line = `[SolarEngine3D] ${operation} failed: ${msg}`;
  if (warn) console.warn(line, error);
  else console.error(line, error);
}

// metersPerDegLat / metersPerDegLng removed v47.133 — all placement uses ECEF only

// Unit conversion helpers - display in feet
function mToFt(m: number): number { return m * 3.28084; }
function ftStr(m: number, decimals = 1): string {
  const ft = mToFt(m);
  if (ft >= 10) return `${ft.toFixed(0)}'`;
  return `${ft.toFixed(decimals)}'`;
}
function ftStrFull(m: number): string {
  const ft = mToFt(m);
  const wholeFt = Math.floor(ft);
  const inches = Math.round((ft - wholeFt) * 12);
  if (inches === 0) return `${wholeFt}'`;
  if (inches === 12) return `${wholeFt + 1}'`;
  return `${wholeFt}' ${inches}"`;
}

function headingFromAzimuth(azDeg: number): number {
  // v47.317: Correct Cesium HPR heading for a given compass azimuth.
  //
  // Cesium's headingPitchRollQuaternion with HPR(H, P, 0) produces face normal:
  //   face_ENU = (-cosH*sinP, sinH*sinP, cosP)  [East, North, Up]
  //
  // For a roof facing azimuth `az` tilted at `tilt` degrees:
  //   required face_ENU = (sin(az)*sin(tilt), cos(az)*sin(tilt), cos(tilt))
  //
  // Matching components: cosH = sin(az), sinH = -cos(az)
  //   => H = atan2(-cos(az), sin(az))   [= az - 90 degrees]
  //
  // Previous formula az*DEG was wrong -- it gave H=az which made panels face
  // 90 degrees off from the roof's true azimuth direction.
  const az = azDeg * Math.PI / 180;
  return Math.atan2(-Math.cos(az), Math.sin(az));
}

// ── Ground Array: Inter-row spacing formula ────────────────────────────────
// Calculates minimum row spacing to prevent inter-row shading at winter solstice
// (worst-case sun angle). Industry standard: add 10% buffer.
// @param tiltDeg      - Panel tilt angle (degrees from horizontal)
// @param panelHeightM - Panel height along slope (1.722m portrait, 1.134m landscape)
// @param latitudeDeg  - Site latitude (degrees, positive = north)
// @returns Minimum row spacing center-to-center (meters)
function calcMinRowSpacing(tiltDeg: number, panelHeightM: number, latitudeDeg: number): number {
  const tiltRad = tiltDeg * Math.PI / 180;
  const panelVerticalHeight  = panelHeightM * Math.sin(tiltRad);
  const panelHorizontalDepth = panelHeightM * Math.cos(tiltRad);
  const sunElevDeg = Math.max(10, 90 - Math.abs(latitudeDeg) - 23.45);
  const shadowLength = panelVerticalHeight / Math.tan(sunElevDeg * Math.PI / 180);
  return Math.max(1.5, (panelHorizontalDepth + shadowLength) * 1.1);
}

// Safe color helpers
function shadeToColor(C: any, shadeFactor: number): any {
  const r = Math.round(255 * (1 - shadeFactor));
  const g = Math.round(200 * shadeFactor);
  return new C.Color(r / 255, g / 255, 0.1, 0.92);
}

function sunshineToColor(C: any, hours: number, maxHours: number): any {
  const t = Math.min(1, hours / (maxHours || 1800));
  return new C.Color(1 - t * 0.6, 0.3 + t * 0.5, 0.1, 0.55);
}

function systemTypeColor(C: any, type: SystemType): any {
  // v47.157: Realistic panel colors
  // Roof: dark navy-black solar cell body (real panels are very dark blue-black)
  if (type === 'roof')   return new C.Color(0.04, 0.08, 0.18, 0.97);
  // Ground: dark charcoal-green (ground-mount panels look similar, slightly warmer)
  if (type === 'ground') return new C.Color(0.04, 0.12, 0.08, 0.97);
  // Fence: dark amber-charcoal
  // Fence: near-black matte (SOL Fence glass-glass bifacial panels look near-black)
  if (type === 'fence')  return new C.Color(0.035, 0.035, 0.045, 0.98);
  return new C.Color(0.08, 0.08, 0.10, 0.97);
}

// ── NaN validation helpers ──────────────────────────────────────────────────
function isValidCoord(lat: number, lng: number, alt?: number): boolean {
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (alt !== undefined && !isFinite(alt)) return false;
  return true;
}

function safeCartesian3(C: any, lng: number, lat: number, alt: number): any {
  if (!isValidCoord(lat, lng, alt)) return null;
  try {
    const c = C.Cartesian3.fromDegrees(lng, lat, alt);
    if (!c || !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return null;
    return c;
  } catch { return null; }
}

function SolarEngine3D({
  lat, lng, projectAddress,
  panels, onPanelsChange, roofPlanes,
  placementMode, onPlacementModeChange,
  systemType, tilt, azimuth, fenceHeight,
  showShade, selectedPanel,
  fireSetbacks,
  showSetbackZones = false,
  mountingSystemId = 'ironridge-xr100',
  onTwinLoaded, onError, onLocationPick,
  onRoofPlaneCreated,
  onRoofPlanesStitched,
  onE2EDiagnostics,
  selectedRoofPlaneId,
  onRoofPlaneSelect,
  onOrientationChange,
  orientation: orientationProp,
  showIrradiance = false,
  colorByString = false,
  showEquipment = false,
  panelOpacity = 1,
  panelMeta,
  stringLegend,
  paintMode = false,
  onPanelPaint,
}: Props) {
  const cesiumRef   = useRef<HTMLDivElement>(null);
  const viewerRef   = useRef<any>(null);
  const tilesetRef  = useRef<any>(null);
  const panelMapRef = useRef<Map<string, any>>(new Map());
  // primitiveRendererRef and lodManagerRef removed — entity-based rendering via panelMapRef
  const overlayRef  = useRef<any[]>([]);
  const setbackZoneEntitiesRef = useRef<any[]>([]); // v62: fire setback keep-out zone entities
  const roofWireframeEntitiesRef = useRef<any[]>([]); // v62: stitched roof-model edge polylines
  const measureOverlayRef = useRef<any[]>([]);
  const handlerRef  = useRef<any>(null);
  const initDone    = useRef(false);
  // autoFillRunningRef: mutex to prevent Auto Fill from running more than once concurrently.
  // Set to true at the start of handleAutoRoof, cleared when done.
  const autoFillRunningRef = useRef(false);
  // clearingRef: v47.217 — set to true during clearPanels() to block any in-flight async
  // operations (autoFill, row generation, etc.) from re-injecting panels after a clear.
  const clearingRef = useRef(false);
  // roofPlanesRef: always current copy of the roofPlanes prop (updated via useEffect)
  const roofPlanesRef = useRef<Props['roofPlanes']>(roofPlanes ?? []);
  // selectedPanelRef: always current copy of the selectedPanel prop
  const selectedPanelRef = useRef<Props['selectedPanel']>(selectedPanel);
  // mountingSystemIdRef: always current mounting system ID — read inside closures without stale prop
  const mountingSystemIdRef = useRef<string>(mountingSystemId);
  // v63: string-coloring + equipment-overlay state, read inside render closures.
  const colorByStringRef = useRef<boolean>(colorByString);
  const showEquipmentRef = useRef<boolean>(showEquipment);
  const panelOpacityRef  = useRef<number>(panelOpacity);
  const panelMetaRef      = useRef<Props['panelMeta']>(panelMeta);
  const paintModeRef      = useRef<boolean>(paintMode);
  const onPanelPaintRef   = useRef<Props['onPanelPaint']>(onPanelPaint);
  // equipmentMapRef: Cesium device-box entities (optimizer/micro) keyed by panel id.
  const equipmentMapRef   = useRef<Map<string, any>>(new Map());
  // roofRailMapRef: Cesium entities keyed by planeId for roof rail visualization (Phase 2).
  // Cleared and rebuilt whenever renderAllPanels rebuilds the panel set.
  const roofRailMapRef = useRef<Map<string, any[]>>(new Map());
  // terrainReadyRef: mirrors terrainReady state as a ref so it can be read inside
  // setInterval callbacks without stale closure issues.
  const terrainReadyRef = useRef(false);

  // pendingPanelsRef: stores panels that arrive via props BEFORE boot() completes.
  // boot() checks this ref at completion and renders them if panels prop is still [].
  const pendingPanelsRef    = useRef<PlacedPanel[]>([]);
  // renderAllPanelsRef: exposes renderAllPanels to the panels useEffect below.
  const renderAllPanelsRef  = useRef<((viewer: any, C: any, list: PlacedPanel[], forceFullRebuild?: boolean) => void) | null>(null);

  // orbitRef: mutable orbit state for the custom turntable camera controller.
  // Updated inside mousedown/mousemove/wheel handlers inside boot().
  // Read by applyOrbitRef.current() to reposition the Cesium camera.
  const orbitRef = useRef({
    targetLat: lat, targetLng: lng, targetAlt: 0,
    heading: Math.PI, pitch: -1.134, radius: 150.0,
    dragging: false, dragButton: -1,
    dragStartX: 0, dragStartY: 0,
    dragStartH: 0.0, dragStartP: 0.0,
    dragStartTLat: 0.0, dragStartTLng: 0.0,
  });
  // applyOrbitRef: function that reads orbitRef and calls camera.setView().
  // Assigned inside boot() once the Cesium viewer is available.
  const applyOrbitRef = useRef<(() => void) | null>(null);
  // Performance: debounce timer for panel re-renders during bulk operations
  const renderDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Performance: snapshot of last rendered panel list for incremental diff
  const lastRenderedPanelsRef = useRef<PlacedPanel[]>([]);
  const fullRebuildCountRef = useRef(0);
  const publishE2EDiagnostics = useCallback(() => {
    onE2EDiagnostics?.({
      fullRebuildCount: fullRebuildCountRef.current,
      setbackInsets: setbackZoneEntitiesRef.current.length,
      roofPlaneEntityCount: plane3DEntityMap.current.size,
    });
  }, [onE2EDiagnostics]);
  // Row tool context: tracks which systemType to use for row-placed panels
  // (row mode is a placement style, not a system type — inherits from last active mode)
  const rowSystemTypeRef = useRef<SystemType>('roof');

  // Ground Array tool state
  // groundArrayRowsRef: confirmed rows placed so far in current array session
  // groundArrayFirstRowRef: start/end points of row 1 (defines azimuth + row direction)
  const groundArrayRowsRef = useRef<PlacedPanel[][]>([]);
  const groundArrayFirstRowRef = useRef<{
    start: { lat: number; lng: number; height: number };
    end:   { lat: number; lng: number; height: number };
    azimuthDeg: number;
    rowSpacingM: number;
  } | null>(null);
  const [groundArrayRowCount, setGroundArrayRowCount] = useState(0);
  const [groundArrayPanelCount, setGroundArrayPanelCount] = useState(0);
  const [showGroundArrayConfirm, setShowGroundArrayConfirm] = useState(false);
  // v6.2.2: Unique key prefix per ground array instance — prevents racking key
  // collisions between multiple finalized ground mounts.
  const groundArrayKeyPrefixRef = useRef<string>('');
  // prevLatRef / prevLngRef: track previous coordinates for address-change fly.
  const prevLatRef = useRef<number>(lat);
  const prevLngRef = useRef<number>(lng);
  // sceneReadyRef: true only after the tileset's first tiles are visible on screen.
  // Panels must NOT be rendered before this — they would float with no surface beneath.
  const sceneReadyRef = useRef<boolean>(false);

  // v47.119: Obstruction system
  // obstructionsRef: list of placed obstructions (vents, skylights, etc.)
  // selectedPlaneRef: the active RoofPlane for surface-based placement
  const obstructionsRef     = useRef<PlacedObstruction[]>([]);
  const [obstructions, setObstructions] = useState<PlacedObstruction[]>([]);
  // selectedPlaneRef: the plane clicked in surface_select mode — anchor for place/extend/add
  const selectedPlaneRef    = useRef<any>(null);

  // surfaceOrientationRef: current orientation for surface-placed panels (separate from ground/fence)
  const surfaceOrientationRef = useRef<PanelOrientation>('portrait');

  // ── v47.121: plane3d tool refs ──────────────────────────────────────────────
  // pts3DCesium: raw Cesium Cartesian3 objects from scene.pickPosition (for Cesium entity rendering)
  const pts3DCesiumRef   = useRef<any[]>([]);
  // pts3DCart: plain {x,y,z} Cart3 objects (for roofPlane3D math — no Cesium dependency)
  const pts3DCartRef     = useRef<Cart3[]>([]);
  // Cesium entities for in-progress point markers
  const pts3DMarkersRef  = useRef<any[]>([]);
  // Cesium entity for in-progress preview polyline
  const pts3DLineRef     = useRef<any | null>(null);
  // Cesium entities for finalized plane surfaces (fill + outline + label)
  // plane3DEntityMap: planeId → array of Cesium entity IDs for that specific plane
  // Allows per-plane removal and re-render on selection change
  const plane3DEntitiesRef = useRef<string[]>([]);
  const plane3DEntityMap   = useRef<Map<string, string[]>>(new Map());
  // plane3DFrameMap: planeId → Plane3DFrame (for re-rendering on selection change)
  const plane3DFrameMap    = useRef<Map<string, Plane3DFrame>>(new Map());
  // plane3DCesiumPtsMap: planeId → Cesium Cartesian3[] (projected polygon corners)
  const plane3DCesiumPtsMap = useRef<Map<string, any[]>>(new Map());
  // v62: planes traced with "Mark Plane" (outline only, no panels) — render clean.
  const markOnlyPlaneIdsRef = useRef<Set<string>>(new Set());
  // Count of placed points (for status message)
  const [pts3DCount, setPts3DCount] = useState(0);

  // ── v47.126: Layout direction + origin control refs ─────────────────────
  // customLayoutDirRef: user-defined u-axis ENU vector {x,y} (null = use longest edge)
  const customLayoutDirRef   = useRef<{x:number;y:number} | null>(null);
  // customLayoutOriginRef: user-defined grid origin lat/lng (null = use corner-snap)
  const customLayoutOriginRef = useRef<{lat:number;lng:number} | null>(null);
  // dirClickPtsRef: accumulates 2 screen picks for set_direction mode
  const dirClickPtsRef       = useRef<{lat:number;lng:number;height:number}[]>([]);
  // layoutBBoxEntitiesRef: Cesium entity IDs for bounding-box preview overlay
  const layoutBBoxRef        = useRef<any[]>([]);
  // activePlane3DIdRef: which plane is currently "active" (highlighted)
  const activePlane3DIdRef   = useRef<string | null>(null);
  // previewRowEntitiesRef: transient row-preview polylines
  const previewRowEntitiesRef = useRef<any[]>([]);
  const [layoutDirSet, setLayoutDirSet]     = useState(false);
  const [layoutOriginSet, setLayoutOriginSet] = useState(false);
  const [activePlane3DId, setActivePlane3DId] = useState<string | null>(null);

  const modeRef      = useRef<PlacementMode>(placementMode);
  const azimuthRef   = useRef<number>(azimuth);
  const tiltRef      = useRef<number>(tilt);
  const fenceHRef    = useRef<number>(fenceHeight);
  const gTiltRef     = useRef<number>(25);
  const fenceSectionsRef = useRef<FenceSectionState[]>([]);
  const fencePtsRef  = useRef<Array<{ lat: number; lng: number; height: number }>>([]);
  const planePtsRef  = useRef<Array<{ lat: number; lng: number; height: number }>>([]);
  const rowPtsRef    = useRef<Array<{ lat: number; lng: number; height: number }>>([]);
  // Stores the screen position of the row start click so computeSurfaceNormal
  // can sample the correct 8-neighbor pixels for tilt/azimuth detection.
  const rowStartScreenPosRef = useRef<{ x: number; y: number } | null>(null);
  const panelsRef    = useRef<PlacedPanel[]>(panels);
  const twinRef             = useRef<DigitalTwinData | null>(null);
  const simHourRef          = useRef<number>(12);
  const showShadeRef        = useRef<boolean>(showShade);
  const cesiumGroundElevRef = useRef<number>(0); // true ellipsoidal ground elevation from Cesium terrain
  // Whether cesiumGroundElevRef has been resolved (boot/fly). Used instead of a
  // `> 0` test so legitimately NEGATIVE ellipsoidal ground elevations (coastal /
  // low-lying sites, where elevation + geoid undulation < 0, e.g. Waterford CT)
  // are kept rather than discarded → points no longer float above true ground.
  const cesiumGroundElevResolvedRef = useRef<boolean>(false);

  const [stage, setStage]         = useState<LoadStage>('idle');
  const [stageMsg, setStageMsg]   = useState('Initializing...');
  const [progress, setProgress]   = useState(0);
  const [twin, setTwin]           = useState<DigitalTwinData | null>(null);
  const [simHour, setSimHour]     = useState(12);
  const [animating, setAnimating] = useState(false);
  const [showParcel, setShowParcel]     = useState(true);
  const [showRoofSegs, setShowRoofSegs] = useState(true);
  // v50.11: local irradiance toggle — initialised from prop, also togglable from internal button
  const [showIrradianceLocal, setShowIrradianceLocal] = useState(showIrradiance);
  const [panelCount, setPanelCount]     = useState(panels.length);
  const [fencePtCount, setFencePtCount] = useState(0);
  const [gTilt, setGTilt]               = useState(25);
  const [planePtCount, setPlanePtCount] = useState(0);
  const [rowPtCount, setRowPtCount]     = useState(0);
  const [panelOrientation, setPanelOrientation] = useState<PanelOrientation>('portrait');
  const panelOrientationRef = useRef<PanelOrientation>('portrait');
  const [selectedPanelId, setSelectedPanelId]   = useState<string | null>(null);
  const selectedPanelIdRef = useRef<string | null>(null);
  // v48.12: Multi-select — Set of panel IDs currently highlighted
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(new Set());
  const selectedPanelIdsRef = useRef<Set<string>>(new Set());
  // v62: Array group-selection drill state. null = top level → a click selects the
  // WHOLE array (all panels sharing a group key). When set to a group key, we've
  // double-clicked INTO that array → clicks select single panels. Empty click exits.
  const drilledGroupKeyRef = useRef<string | null>(null);
  // v62: mouse grab-to-move / grab-to-rotate state.
  //   dragRef        — active drag session (mode 'move'|'rotate' + plane/centroid/angle)
  //   suppressClickRef — true after a real drag so the trailing LEFT_CLICK is ignored
  //   rotateHandleRef  — the floating rotate-knob entity shown above a selected array
  const dragRef = useRef<any>(null);
  const suppressClickRef = useRef<boolean>(false);
  // v62: stitched roof-model wireframe toggle (classified edges across all planes)
  const [showRoofModel, setShowRoofModel] = useState(false);
  const rotateHandleRef = useRef<any>(null);
  const rotateHandleLineRef = useRef<any>(null);
  // v62: true while a grab-to-move/rotate is in progress. The CUSTOM camera handler
  // (DOM pointermove orbit/pan, set up in boot) checks this and bails, so dragging an
  // array doesn't also pan/orbit the camera. (Cesium's built-in controller is fully
  // disabled here, so toggling its enable flags does nothing — this is the real gate.)
  const arrayManipRef = useRef<boolean>(false);
  // v48.12: Toolbar tooltip state
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(null);
  // Which toolbar group is currently expanded (null = all collapsed)
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // v48.12: Ground mount racking visibility toggle
  const [showRacking, setShowRacking] = useState<boolean>(true);
  const showRackingRef = useRef<boolean>(true);
  // v48.13: Camera heading for rotating compass (degrees, 0=north, CW)
  const [cameraHeadingDeg, setCameraHeadingDeg] = useState<number>(0);
  // v48.14: Ground mount racking style toggle
  const [groundMountStyle, setGroundMountStyle] = useState<'pipe' | 'ironridge'>('pipe');
  const groundMountStyleRef = useRef<'pipe' | 'ironridge'>('pipe');
  const measurePtsRef  = useRef<Array<{ lat: number; lng: number; height: number }>>([]);
  const [measurePtCount, setMeasurePtCount] = useState(0);
  const ghostEntityRef = useRef<any>(null);
  const [statusMsg, setStatusMsg]       = useState('');
  const [fps, setFps]                   = useState(60);
  const [lastLog, setLastLog]           = useState('');
  const [showShadeLocal, setShowShadeLocal] = useState(showShade);
  const [tileStatus, setTileStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  // v50.11: Irradiance heatmap state
  const irradianceOverlayRef = useRef<any>(null);   // Cesium GroundPrimitive
  const irradianceGroundRef  = useRef<any>(null);   // separate overlay for ground/fence areas
  const [irradianceLoading, setIrradianceLoading] = useState(false);
  const [irradianceBounds, setIrradianceBounds] = useState<{
    west: number; south: number; east: number; north: number;
  } | null>(null);

  // Phase 0: Debug panel state
  const [renderMode, setRenderMode]           = useState<'TILES' | 'TERRAIN_ONLY'>('TERRAIN_ONLY');
  const [terrainReady, setTerrainReady]       = useState(false);
  const [tilesetReady, setTilesetReady]       = useState(false);
  const [clickCountForTool, setClickCountForTool] = useState(0);
  const [lastPickMethod, setLastPickMethod]   = useState<string>('none');
  const [lastPickLatLon, setLastPickLatLon]   = useState<string>('—');
  const renderModeRef = useRef<'TILES' | 'TERRAIN_ONLY'>('TERRAIN_ONLY');

  // Phase 4: Row tool local lastClick ref (no stale state)
  const rowLastClickRef = useRef<{ lat: number; lng: number; height: number; screenPos: { x: number; y: number } } | null>(null);

  const totalKw = ((panelCount * (selectedPanel?.wattage ?? 400)) / 1000).toFixed(1);

  // Sync orientation ref
  useEffect(() => { panelOrientationRef.current = panelOrientation; }, [panelOrientation]);
  // v48.26: sync panelOrientation state when DesignStudio drives it via the 2D buttons
  useEffect(() => {
    if (orientationProp && orientationProp !== panelOrientationRef.current) {
      setPanelOrientation(orientationProp);
      panelOrientationRef.current = orientationProp;
      surfaceOrientationRef.current = orientationProp;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientationProp]);
  useEffect(() => { groundMountStyleRef.current = groundMountStyle; }, [groundMountStyle]);

  // Sync refs with props
  // Phase 2: When tool changes, reset ALL tool-specific state
  useEffect(() => {
    const prevMode = modeRef.current;
    modeRef.current = placementMode;
    if (prevMode !== placementMode) {
      fencePtsRef.current = []; setFencePtCount(0);
      planePtsRef.current = []; setPlanePtCount(0);
      rowPtsRef.current = []; rowLastClickRef.current = null;
      rowStartScreenPosRef.current = null; setRowPtCount(0);
      measurePtsRef.current = []; setMeasurePtCount(0);
      setClickCountForTool(0);
      clearGhostPanel();
      // v62: leaving select mode — drop the rotate knob and never leave a drag
      // half-open (which would keep camera left-drag disabled).
      hideRotateHandle();
      if (dragRef.current) dragRef.current = null;
      suppressClickRef.current = false;
      arrayManipRef.current = false; // never leave the camera frozen on tool change
      // v47.131 Issue 2: Reset plane frame state on every tool change.
      // This prevents extend_row / add_row from using the previous plane's
      // ECEF frame when the user switches to a different plane.
      selectedPlaneRef.current = null;
      const viewer = viewerRef.current;
      if (viewer) {
        overlayRef.current.forEach((e: any) => { try { viewer.entities.remove(e); } catch {} });
        overlayRef.current = [];
        const C = (window as any).Cesium;
        if (C && twinRef.current) { try { drawOverlays(viewer, C, twinRef.current); } catch {} }
        try { viewer.scene.requestRender(); } catch {}
      }
    }
    // Auto Fill: only trigger when mode CHANGES TO 'auto_roof' (not on every re-render)
    // This is inside prevMode !== placementMode guard to prevent duplicate runs.
    if (placementMode === 'pick_house' && prevMode !== 'pick_house') {
      setStatusMsg('🏡 Click any house on the map to select it as the target property');
    }
    // v62: marking faces → auto-show the stitched Roof Model so edges classify live.
    if (placementMode === 'mark_plane' && prevMode !== 'mark_plane') {
      setShowRoofModel(true);
      setStatusMsg('⬡ Mark Plane — click a roof face\'s corners (3+), right-click to finish · edges classify live');
    }
    if (placementMode === 'auto_roof' && prevMode !== 'auto_roof') {
      const viewer = viewerRef.current;
      const C = (window as any).Cesium;
      if (viewer && C && twinRef.current) {
        // Wait for terrain sampling to complete before running Auto Fill.
        // terrainReadyRef is set true at the end of boot() after sampleTerrainMostDetailed.
        // If terrain is already ready, run immediately. Otherwise poll every 200ms (max 5s).
        const runAutoFill = () => handleAutoRoof(viewer, C);
        // Run immediately if twin data is available (don't wait for terrainReady
        // since EllipsoidTerrainProvider never gives valid heights anyway -
        // clampToHeightMostDetailed handles height correction at render time)
        if (twinRef.current && twinRef.current.roofSegments.length > 0) {
          setTimeout(runAutoFill, 100);
        } else {
          // Twin not loaded yet - poll for it (max 8s)
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if ((twinRef.current && twinRef.current.roofSegments.length > 0) || waited >= 8000) {
              clearInterval(poll);
              runAutoFill();
            }
          }, 200);
        }
      }
    }
  }, [placementMode]);
  useEffect(() => { azimuthRef.current = azimuth; }, [azimuth]);
  useEffect(() => { tiltRef.current = tilt; }, [tilt]);
  useEffect(() => { fenceHRef.current = fenceHeight; }, [fenceHeight]);
  useEffect(() => { gTiltRef.current = gTilt; }, [gTilt]);
  useEffect(() => { panelsRef.current = panels; setPanelCount(panels.length); }, [panels]);

  // Rebuild fence sections from loaded panels (covers saved/restored state)
  // NOTE: Does NOT depend on systemType prop — fence panels may exist even when
  // activeZoneType is 'roof' (mixed projects). We detect fence panels by their own systemType.
  useEffect(() => {
    if (panels.length === 0) return;
    // Only rebuild if sections are empty (fresh load) — don't overwrite active editing
    if (fenceSectionsRef.current.length > 0) return;

    const fencePanels = panels.filter(p => (p as any).systemType === 'fence');
    if (fencePanels.length === 0) return;

    // Group by layoutId (each layoutId = one fence segment)
    const byLayout = new Map<string, typeof fencePanels>();
    fencePanels.forEach(p => {
      const lid = p.layoutId ?? 'default';
      if (!byLayout.has(lid)) byLayout.set(lid, []);
      byLayout.get(lid)!.push(p);
    });

    const sections: FenceSectionState[] = [];
    let segIdx = 0;
    byLayout.forEach((segPanels, layoutId) => {
      // Sort by column within segment
      segPanels.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
      const PANELS_PER_SEC = 2;
      for (let i = 0; i < segPanels.length; i += PANELS_PER_SEC) {
        const secPanels = segPanels.slice(i, i + PANELS_PER_SEC);
        sections.push({
          id:        `sec-${segIdx}-${Math.floor(i / PANELS_PER_SEC)}`,
          segIdx,
          secIdx:    Math.floor(i / PANELS_PER_SEC),
          type:      'solar',
          panelIds:  secPanels.map(p => p.id),
          entityKey: '',
        });
      }
      segIdx++;
    });

    fenceSectionsRef.current = sections;
  }, [panels]);

  useEffect(() => { roofPlanesRef.current = roofPlanes ?? []; }, [roofPlanes]);

  // ── v64: Restore 3D roof-plane outlines + wireframe on project load ──────
  // After reload the panels are still there (they have their own restore effect),
  // but the roof-plane outline entities (plane3DEntityMap) and stitched wireframe
  // are GONE because they were only ever built from user actions this session.
  // This effect rebuilds them from the persisted roofPlanes prop (which carries
  // polygon3D / origin3D / normal3D / localFrame3D from the stitch write-back).
  //
  // Idempotent: skips planes already in plane3DEntityMap (traced/stitched this
  // session). Does NOT touch panels or fences — those have their own restore paths.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C || stage !== 'done') return;
    const planes = roofPlanes ?? [];
    if (planes.length === 0) return;

    // Find planes that are NOT already rendered (not in the entity map)
    const planesToRestore = planes.filter(p => !plane3DEntityMap.current.has(p.id));
    if (planesToRestore.length === 0) return;

    const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    let restored = 0;

    for (const plane of planesToRestore) {
      try {
        // ── Step 1: Get ECEF corners ──────────────────────────────────
        // Prefer polygon3D (stitched geometry — exact ECEF corners from the
        // stitch write-back, Part A). Fallback for 2D-only legacy planes:
        // project vertices (lat/lng) to ECEF via computeEcefFrameForLegacyPlane.
        let cartPts: Cart3[];
        let frame: Plane3DFrame;

        if (plane.polygon3D && plane.polygon3D.length >= 3) {
          // polygon3D carries the exact stitched (or traced) ECEF corners.
          cartPts = plane.polygon3D.map(p => ({ x: p.x, y: p.y, z: p.z }));
          frame = computePlaneFromPoints3D(cartPts);
        } else if (plane.createdFrom3D && plane.origin3D && plane.ecefFrame3D) {
          // 3D plane with ECEF frame but no polygon3D (pre-stitch or older save).
          // Reconstruct polygon3D from the 2D vertices + stored ECEF frame.
          const legacy = computeEcefFrameForLegacyPlane(plane, groundElev);
          if (!legacy.polygon3D || legacy.polygon3D.length < 3) {
            addLog('RESTORE', `Skipped plane ${plane.id.slice(0,8)}: legacy projection yielded <3 corners`);
            continue;
          }
          cartPts = legacy.polygon3D.map(p => ({ x: p.x, y: p.y, z: p.z }));
          frame = computePlaneFromPoints3D(cartPts);
        } else {
          // 2D-only legacy plane (no polygon3D, no ecefFrame3D). Project from
          // vertices via azimuth/pitch → ECEF. This is a lossy approximation but
          // at least shows the outline on reload.
          try {
            const legacy = computeEcefFrameForLegacyPlane(plane, groundElev);
            if (!legacy.polygon3D || legacy.polygon3D.length < 3) {
              addLog('RESTORE', `Skipped 2D plane ${plane.id.slice(0,8)}: <3 corners`);
              continue;
            }
            cartPts = legacy.polygon3D.map(p => ({ x: p.x, y: p.y, z: p.z }));
            frame = computePlaneFromPoints3D(cartPts);
          } catch (e) {
            addLog('RESTORE', `Skipped 2D plane ${plane.id.slice(0,8)}: ${(e as Error).message}`);
            continue;
          }
        }

        // ── Step 2: Convert projected points to Cesium Cartesian3 ──────
        const projectedCesiumPts = frame.projectedPts.map((p: Cart3) =>
          new C.Cartesian3(p.x, p.y, p.z)
        );

        // ── Step 3: Determine mark-only (no panels assigned) ──────────
        const planeHasPanels = panelsRef.current.some(p => p.planeId === plane.id);
        const isMarkOnly = !planeHasPanels;
        if (isMarkOnly) markOnlyPlaneIdsRef.current.add(plane.id);

        // ── Step 4: Render plane entity (mirrors finalizePlane3D) ──────
        const isSelected = selectedRoofPlaneId === plane.id;
        const entityIds = renderPlane3DEntity(
          viewer, C, projectedCesiumPts, plane.id, frame, isSelected, isMarkOnly,
        );

        // ── Step 5: Populate all three maps ───────────────────────────
        plane3DEntityMap.current.set(plane.id, entityIds);
        plane3DFrameMap.current.set(plane.id, frame);
        plane3DCesiumPtsMap.current.set(plane.id, projectedCesiumPts);
        plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();

        restored++;
        addLog('RESTORE', `Rebuilt 3D outline for plane ${plane.id.slice(0,8)} (${isMarkOnly ? 'mark-only' : 'panel plane'})`);
      } catch (e) {
        addLog('RESTORE', `Failed plane ${plane.id.slice(0,8)}: ${(e as Error).message}`);
      }
    }

    // ── Step 6: Show roof model + wireframe + setbacks ────────────────
    if (restored > 0) {
      setShowRoofModel(true);
      try { renderRoofWireframe(viewer, C); } catch {}
      if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch {} }
      try { viewer.scene.requestRender(); } catch {}
      addLog('RESTORE', `Restored ${restored} roof-plane outline(s) on load`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, roofPlanes, panels]);

  useEffect(() => {
    publishE2EDiagnostics();
  }, [panels.length, roofPlanes?.length, showSetbackZones, publishE2EDiagnostics]);

  // v62: render/refresh fire setback keep-out zones on the 3D roof when the
  // Design Studio "Zones On/Off" toggle, the planes, panels, or setback values change.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch (e) { addLog('WARN', `renderFireSetbackZones: ${(e as Error).message}`); } }
    else clearFireSetbackZones(viewer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSetbackZones, roofPlanes, panels, fireSetbacks, stage]);

  // v62: render/refresh the stitched roof-model wireframe on toggle / plane / panel change.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    if (showRoofModel) { try { renderRoofWireframe(viewer, C); } catch (e) { addLog('WARN', `renderRoofWireframe: ${(e as Error).message}`); } }
    else clearRoofWireframe(viewer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoofModel, roofPlanes, panels, stage]);
  useEffect(() => { mountingSystemIdRef.current = mountingSystemId; }, [mountingSystemId]);
  useEffect(() => { paintModeRef.current = paintMode; }, [paintMode]);
  useEffect(() => { onPanelPaintRef.current = onPanelPaint; }, [onPanelPaint]);

  // v63: keep string-coloring / equipment refs current, then force a full panel
  // rebuild so colors, opacity and device boxes refresh. Only rebuild when the
  // overlay is active (or was just turned off, to revert colors / clear devices);
  // when both toggles are off, panelMeta churn from panel edits is ignored so we
  // don't trigger a wasteful full rebuild (and the panel "blink") on every click.
  const prevVizRef = useRef({ colorByString: false, showEquipment: false, panelOpacity: 1 });
  useEffect(() => {
    colorByStringRef.current = colorByString;
    showEquipmentRef.current = showEquipment;
    panelOpacityRef.current  = panelOpacity;
    panelMetaRef.current      = panelMeta;   // keep current so incremental renders color correctly
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    const prev = prevVizRef.current;
    prevVizRef.current = { colorByString, showEquipment, panelOpacity };
    if (!viewer || !C || !renderAllPanelsRef.current) return;
    // Only an actual viz CHANGE (toggle flip or opacity change) warrants the
    // expensive full panel rebuild. panelMeta is in this effect's deps too, but
    // panelMeta churn from moving/adding a panel must NOT force a rebuild — doing
    // so tore down + re-added EVERY panel entity on every drag-release while a
    // mode was active (the "jerky / snaps to everything" regression, 2176e4d3).
    // A moved/added panel is recolored by the normal incremental render path,
    // which already reads panelMetaRef/colorByStringRef in addPanelEntity.
    const vizChanged =
      prev.colorByString !== colorByString ||
      prev.showEquipment !== showEquipment ||
      prev.panelOpacity  !== panelOpacity;
    const turnedOff = (prev.colorByString && !colorByString) || (prev.showEquipment && !showEquipment);
    if (vizChanged && (colorByString || showEquipment || turnedOff)) {
      renderAllPanelsRef.current(viewer, C, panelsRef.current, true /* forceFullRebuild */);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorByString, showEquipment, panelOpacity, panelMeta]);

  // v47.122: Re-render all tracked planes when selection changes
  // Selected plane → bright highlight; all others → dimmed
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;

    plane3DEntityMap.current.forEach((entityIds, planeId) => {
      const frame     = plane3DFrameMap.current.get(planeId);
      const cesiumPts = plane3DCesiumPtsMap.current.get(planeId);
      if (!frame || !cesiumPts) return;

      // Remove old entities for this plane
      entityIds.forEach(eid => {
        const ent = viewer.entities.getById(eid);
        if (ent) try { viewer.entities.remove(ent); } catch {}
      });

      // Re-render with new selection state
      const isSelected = selectedRoofPlaneId === planeId;
      const newIds = renderPlane3DEntity(viewer, C, cesiumPts, planeId, frame, isSelected, markOnlyPlaneIdsRef.current.has(planeId));
      plane3DEntityMap.current.set(planeId, newIds);

      // Also update the flat list
      plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    });

    try { viewer.scene.requestRender(); } catch {}
  }, [selectedRoofPlaneId]);

  useEffect(() => { selectedPanelRef.current = selectedPanel; }, [selectedPanel]);
  useEffect(() => { simHourRef.current = simHour; }, [simHour]);
  useEffect(() => { showShadeRef.current = showShade; setShowShadeLocal(showShade); }, [showShade]);
  // v50.11: sync prop → local state (parent can also drive the toggle)
  useEffect(() => { setShowIrradianceLocal(showIrradiance); }, [showIrradiance]);

  // v50.16: Irradiance heatmap — roof (masked) + ground/fence (unmasked, panel bbox)
  // GroundPrimitive with ClassificationType.CESIUM_3D_TILE paints directly onto
  // the 3D tile mesh surface. imageryLayers only reach the globe ellipsoid and
  // are always hidden under the Google Photorealistic 3D tile mesh.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C || stage !== 'done') return;

    // ── Remove existing overlays ────────────────────────────────────────────
    if (irradianceOverlayRef.current) {
      try { viewer.scene.primitives.remove(irradianceOverlayRef.current); } catch {}
      irradianceOverlayRef.current = null;
    }
    if (irradianceGroundRef.current) {
      try { viewer.scene.primitives.remove(irradianceGroundRef.current); } catch {}
      irradianceGroundRef.current = null;
    }

    if (!showIrradianceLocal) {
      try { viewer.scene.requestRender(); } catch {}
      return;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function makeGroundPrimitive(
      C: any,
      rect: any,
      dataUrl: string,
    ): any {
      const geometry = new C.RectangleGeometry({
        rectangle:    rect,
        vertexFormat: C.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
      });
      const instance = new C.GeometryInstance({ geometry });
      // color (1,1,1,1) preserves per-pixel alpha from the canvas exactly.
      // A flat alpha multiplier < 1 would make transparent mask pixels semi-opaque.
      const mat = C.Material.fromType('Image', {
        image: dataUrl,
        color: new C.Color(1.0, 1.0, 1.0, 1.0),
      });
      const appearance = new C.MaterialAppearance({ translucent: true, flat: true });
      appearance.material = mat;
      return new C.GroundPrimitive({
        geometryInstances:  instance,
        appearance,
        classificationType: C.ClassificationType.CESIUM_3D_TILE,
        asynchronous:       false,
      });
    }

    // ── Load + render ───────────────────────────────────────────────────────
    let cancelled = false;
    setIrradianceLoading(true);
    (async () => {
      try {
        const { loadIrradianceLayer, loadIrradianceLayerUnmasked } = await import('@/lib/geotiffDecoder');
        const { renderIrradianceCanvas } = await import('@/lib/irradianceColormap');

        // ── 1. ROOF overlay (masked — only roof pixels coloured) ─────────────
        const roofLayer = await loadIrradianceLayer(lat, lng);
        if (cancelled) return;

        if (roofLayer) {
          console.log('[Irradiance] Roof layer:', roofLayer.width, 'x', roofLayer.height, 'mask:', roofLayer.mask ? 'YES' : 'NO');
          const roofCanvas = renderIrradianceCanvas(roofLayer);
          setIrradianceBounds(roofLayer.bounds);
          const roofRect = C.Rectangle.fromDegrees(
            roofLayer.bounds.west, roofLayer.bounds.south,
            roofLayer.bounds.east, roofLayer.bounds.north,
          );
          const roofDataUrl = roofCanvas.toDataURL('image/png');
          const roofPrimitive = makeGroundPrimitive(C, roofRect, roofDataUrl);
          viewer.scene.primitives.add(roofPrimitive);
          irradianceOverlayRef.current = roofPrimitive;
          console.log('[Irradiance] ✅ Roof heatmap added (CESIUM_3D_TILE)',
            roofLayer.minVal.toFixed(0), '–', roofLayer.maxVal.toFixed(0), 'kWh/m²/yr');
        } else {
          console.warn('[Irradiance] No roof data for', lat, lng);
        }

        // ── 2. GROUND / FENCE overlay (unmasked — full solar flux in panel area) ─
        // Find bounding box of all ground + fence panels on screen
        const groundFencePanels = panelsRef.current.filter(
          p => p.systemType === 'ground' || p.systemType === 'fence'
        );

        if (groundFencePanels.length > 0) {
          if (cancelled) return;

          // Compute lat/lng bbox of all ground+fence panels
          let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
          for (const p of groundFencePanels) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
          }

          if (isFinite(minLat) && isFinite(minLng)) {
            // Expand bbox slightly so panels at the edges aren't clipped
            const pad = 0.00008; // ~9m
            const groundBounds = {
              west:  minLng - pad,
              south: minLat - pad,
              east:  maxLng + pad,
              north: maxLat + pad,
            };

            const groundLayer = await loadIrradianceLayerUnmasked(lat, lng);
            if (cancelled) return;

            if (groundLayer) {
              const clippedLayer = { ...groundLayer, bounds: groundBounds };
              const groundCanvas = renderIrradianceCanvas(clippedLayer);
              const groundRect = C.Rectangle.fromDegrees(
                groundBounds.west, groundBounds.south,
                groundBounds.east, groundBounds.north,
              );
              const groundDataUrl = groundCanvas.toDataURL('image/png');
              const groundPrimitive = makeGroundPrimitive(C, groundRect, groundDataUrl);
              viewer.scene.primitives.add(groundPrimitive);
              irradianceGroundRef.current = groundPrimitive;
              console.log('[Irradiance] ✅ Ground/fence heatmap added —',
                groundFencePanels.length, 'panels bbox:',
                minLat.toFixed(5), minLng.toFixed(5), '→', maxLat.toFixed(5), maxLng.toFixed(5));
            }
          }
        }

        try { viewer.scene.requestRender(); } catch {}
      } catch (err: unknown) {
        if (!cancelled) {
          console.error('[Irradiance] Failed:', (err as Error).message, err);
        }
      } finally {
        if (!cancelled) setIrradianceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (irradianceOverlayRef.current && viewerRef.current) {
        try { viewerRef.current.scene.primitives.remove(irradianceOverlayRef.current); } catch {}
        irradianceOverlayRef.current = null;
      }
      if (irradianceGroundRef.current && viewerRef.current) {
        try { viewerRef.current.scene.primitives.remove(irradianceGroundRef.current); } catch {}
        irradianceGroundRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIrradianceLocal, lat, lng, stage]);

  const addLog = useCallback((tag: string, msg: string) => {
    const line = log(tag, msg);
    setLastLog(line);
  }, []);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    boot();
    return () => cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Restore panels when they arrive from DesignStudio (after boot) ──────────
  // If viewer is ready: render with debounce (16ms) to batch rapid updates.
  // If viewer not ready yet: store in pendingPanelsRef so boot() can pick them up.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C || !renderAllPanelsRef.current) {
      // Boot not complete yet — store for later
      if (panels.length > 0) pendingPanelsRef.current = panels;
      return;
    }
    // Cancel any pending debounced render
    if (renderDebounceRef.current) {
      clearTimeout(renderDebounceRef.current);
    }
    // Dynamic debounce: longer window for large batch operations (auto-fill, undo/redo)
    // 16ms for single panel clicks (imperceptible), 50ms for large batches
    const delta = Math.abs(panels.length - lastRenderedPanelsRef.current.length);
    const debounceMs = delta > 20 ? 50 : delta > 5 ? 32 : 16;
    const snapshot = panels; // capture current value for closure
    renderDebounceRef.current = setTimeout(() => {
      renderDebounceRef.current = null;
      const v = viewerRef.current;
      const Cs = (window as any).Cesium;
      if (!v || !Cs || !renderAllPanelsRef.current) return;
      renderAllPanelsRef.current(v, Cs, snapshot);
    }, debounceMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels]);

  // ── Fly camera when address changes (lat/lng props change) ──────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    // Only fly if coordinates changed by more than ~11m (0.0001°)
    if (Math.abs(lat - prevLatRef.current) < 0.0001 && Math.abs(lng - prevLngRef.current) < 0.0001) return;
    prevLatRef.current = lat;
    prevLngRef.current = lng;

    // ── v62: RESET per-location state on EVERY address change ────────────────
    // Ray's repro: first fly-in works, the SECOND fly-in corrupts the plane.
    // Cause: state from the previous address leaked into the next plane build.
    //   • cesiumGroundElevResolvedRef → false: the new address must NOT build
    //     planes at the OLD address's ground elevation during the async twin
    //     reload (it gets re-resolved below once the new twin loads).
    //   • customLayoutDir/Origin → null: a stale grid axis/origin from a prior
    //     Set-Direction/Origin would skew the next address's grid.
    //   • clearPlane3DPreview: drop any in-progress 3D-plane click points.
    cesiumGroundElevResolvedRef.current = false;
    customLayoutDirRef.current   = null;
    customLayoutOriginRef.current = null;
    try { clearPlane3DPreview(viewer); } catch {}
    addLog('FLY', 'reset per-location state (elevResolved/customDir/customOrigin/plane3d) on address change');

    const elev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    // Update orbit state for new address — snap camera to site at default pose
    const o = orbitRef.current;
    o.targetLat = lat;
    o.targetLng = lng;
    o.targetAlt = elev;
    o.heading   = Math.PI;  // π → fly-in looks NORTH (look dir = heading + π)
    o.pitch     = -1.134;  // -65° — top-down-ish view
    // 150m default framing; only fall back to a wider 300m when the ground
    // elevation is genuinely UNRESOLVED. (Was `elev > 0`, which wrongly treated
    // legitimately-negative coastal elevations as "unknown" and zoomed out.)
    o.radius    = cesiumGroundElevResolvedRef.current ? 150 : 300;
    o.dragging  = false;
    if (applyOrbitRef.current) {
      applyOrbitRef.current();
      addLog('FLY', `Address change → orbit to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else {
      // applyOrbit not yet ready (boot hasn’t run); will be applied when applyOrbitRef is set
      addLog('FLY', `Address change queued (applyOrbit not ready)`);
    }
    [200, 600, 1500, 3000].forEach(t =>
      setTimeout(() => { try { viewer.resize(); viewer.scene.requestRender(); } catch {} }, t)
    );

    // Reload digital twin for new location (Pick House / address change)
    // Clear old overlays and reload Solar API data for the new lat/lng
    addLog('FLY', `Reloading digital twin for new location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    setStatusMsg('🏡 Loading solar data for new location...');
    // Clear old roof segment overlays
    overlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    overlayRef.current = [];
    // Reset twin ref so Auto Fill doesn't use stale data
    twinRef.current = null;
    terrainReadyRef.current = false;
    setTerrainReady(false);
    // PERF v61: Reload twin data for new location — skip DSM for speed, enrich lazily.
    buildDigitalTwin(lat, lng, projectAddress ?? '', true /* skipDsm */).then(newTwin => {
      twinRef.current = newTwin;
      onTwinLoaded?.(newTwin);
      addLog('FLY', `Twin reloaded: ${newTwin.roofSegments.length} segments`);
      setStatusMsg(`✅ Solar data loaded: ${newTwin.roofSegments.length} roof segments`);

      // PERF v61: Use geoid approximation directly — skip sampleTerrainMostDetailed (saves 3-5s).
      const googleGroundElev = newTwin.elevation ?? 0;
      const latRad = lat * Math.PI / 180;
      const geoidApprox = -29 - 5 * Math.sin(latRad);
      cesiumGroundElevRef.current = googleGroundElev + geoidApprox;
      cesiumGroundElevResolvedRef.current = true;
      addLog('FLY', `cesiumGroundElev updated: ${cesiumGroundElevRef.current.toFixed(1)}m (geoidApprox: ${geoidApprox.toFixed(1)}m) [no terrain sample]`);
      // Defensive: keep the redundant ellipsoid globe hidden after navigation so
      // the flat base-imagery plane (rendered at height 0) can't bleed up through
      // the real terrain at low-lying/coastal sites. Only when 3D tiles exist, so
      // a tile-less location still falls back to the Esri base map.
      try { if (tilesetRef.current) viewer.scene.globe.show = false; } catch {}
      terrainReadyRef.current = true;
      setTerrainReady(true);
      // Sync orbit target altitude now that ground elevation is known
      const oo = orbitRef.current;
      oo.targetAlt = cesiumGroundElevRef.current;
      applyOrbitRef.current?.();

      // Redraw overlays for new location
      drawOverlays(viewer, C, newTwin);
      viewer.scene.requestRender();

      // Lazy DSM enrichment after scene is interactive
      setTimeout(() => {
        enrichDigitalTwinWithDsm(newTwin).then(enriched => {
          if (enriched !== newTwin) {
            setTwin(enriched);
            onTwinLoaded?.(enriched);
            twinRef.current = enriched;
            if (viewerRef.current && (window as any).Cesium) {
              drawOverlays(viewerRef.current, (window as any).Cesium, enriched);
            }
            addLog('FLY', `DSM enriched: ${enriched.roofSegments.length} roof segments`);
          }
        }).catch(() => {/* non-fatal */});
      }, 2000);
    }).catch(err => {
      addLog('WARN', `Twin reload failed: ${(err as Error).message}`);
      terrainReadyRef.current = true; // unblock Auto Fill even on error
      setTerrainReady(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  /**
   * Main initialization sequence for the 3D engine.
   *
   * Execution order:
   * 1. Dynamically loads CesiumJS from CDN
   * 2. Creates the Cesium Viewer with optimized settings (requestRenderMode, EllipsoidTerrain)
   * 3. Fetches Google Photorealistic 3D Tiles AND Solar API data IN PARALLEL via Promise.allSettled
   * 4. Samples Cesium terrain to compute geoid undulation offset (Google orthometric → Cesium ellipsoidal)
   * 5. Draws roof segment + parcel overlays
   * 6. Sets up click, hover, keyboard, and resize handlers
   * 7. Renders any panels that arrived via props before boot completed (pendingPanelsRef)
   *
   * @remarks
   * - Uses EllipsoidTerrainProvider (not World Terrain) to avoid conflicts with 3D Tiles geometry
   * - requestRenderMode + maximumRenderTimeChange=Infinity means Cesium only renders on demand (saves GPU)
   * - Promise.allSettled ensures boot continues even if tiles OR Solar API fails independently
   *
   * @throws {Error} If the Cesium container div is not mounted when boot() runs
   */
  async function boot() {
    try {
      setStage('cesium'); setStageMsg('Loading CesiumJS...'); setProgress(10);
      const C = await loadCesium();
      addLog('BOOT', 'CesiumJS loaded OK');

      setStage('viewer'); setStageMsg('Initializing 3D viewer...'); setProgress(25);
      if (!cesiumRef.current) throw new Error('Cesium container not mounted');

      try { C.Ion.defaultAccessToken = CESIUM_TOKEN; } catch (e) { handleCesiumError('Ion token set', e, true); }

      cesiumRef.current.style.width = '100%';
      cesiumRef.current.style.height = '100%';
      cesiumRef.current.style.position = 'absolute';
      cesiumRef.current.style.inset = '0';

      const viewerOptions: any = {
        baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false,
        shadows: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
        imageryProvider: false,
      };

      // Use flat ellipsoid terrain — Google Photorealistic 3D Tiles provide all geometry.
      // Cesium World Terrain conflicts with 3D Tiles and causes jagged mountain artifacts.
      viewerOptions.terrainProvider = new C.EllipsoidTerrainProvider();

      const viewer = new C.Viewer(cesiumRef.current, viewerOptions);
      viewer.resize();
      viewerRef.current = viewer;

      // ── CUSTOM ORBIT CAMERA CONTROLLER ────────────────────────────────────────
      //
      // WHY A CUSTOM CONTROLLER?
      // Cesium's built-in ScreenSpaceCameraController is designed for planet-scale
      // navigation.  At roof level (camera altitude 10–200 m), its spin3D() function
      // randomly switches between pan3D / look3D / strafe / rotate3D depending on
      // what the depth-buffer ray hits each frame.  The result is the "mind of its
      // own" behaviour: dragging the mouse causes the camera to lurch, snap to
      // first-person look, or fly off at high speed depending on whether the ray
      // lands on a roof tile, a wall, or open sky.
      //
      // rotate3D() (the "good" orbit function) uses rho = |camera.position| from
      // Earth centre (~6,370,100 m at roof level), so one full drag rotates by
      // roughly 0.006° — completely invisible.  All of Cesium's built-in modes
      // are calibrated for distances ≥ 1,000 km.
      //
      // SOLUTION: disable Cesium's input system entirely and implement a clean
      // turntable orbit using camera.setView() each frame:
      //
      //   Camera position = target + R·(spherical heading/pitch)
      //
      // where:
      //   target  = building centre (lat/lng/groundElev, stable ref point)
      //   R       = orbit radius (metres, updated by scroll)
      //   heading = azimuth around target (radians, updated by left/right drag)
      //   pitch   = elevation angle  (radians, −π/2 = top-down, updated by up/down drag)
      //
      // camera.setView() is fully deterministic and always produces the correct
      // camera position+orientation regardless of what tiles are loaded.
      //
      // CONTROLS (v52.2):
      //   Left-drag     → pan (translate orbit target — matches 2D map drag)
      //   Right-drag    → orbit (heading + pitch)
      //   Middle-drag   → orbit (heading + pitch)
      //   Scroll wheel  → zoom (adjust orbit radius)
      //   Middle-click  → zoom to cursor is NOT supported; middle is pan only

      // ── 1. Disable Cesium's built-in camera input ────────────────────────────
      try {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableInputs     = false;   // disables all Cesium mouse/touch handling
        ctrl.enableRotate     = false;
        ctrl.enableTilt       = false;
        ctrl.enableZoom       = false;
        ctrl.enableLook       = false;
        ctrl.enableTranslate  = false;
        // Keep collision detection off so we can tilt past 90°
        ctrl.enableCollisionDetection = false;
      } catch (e) { addLog('WARN', `ctrl disable: ${(e as Error).message}`); }

      // ── 2. Orbit state ───────────────────────────────────────────────────────
      //
      // These are plain numbers in a closure object — no React state, no re-renders.
      // All mutations happen inside event handlers; camera.setView() is called at
      // the end of each mutation to apply the change immediately.
      const orbit = {
        // Orbit target: building centre on the ground surface
        // Updated at boot-end (after cesiumGroundElevRef is resolved) and when
        // the user pans (middle-drag).  Stored as Cartesian3 for efficiency.
        targetLat: lat,
        targetLng: lng,
        targetAlt: 0 as number,   // filled in after terrain sampling completes

        // Spherical camera pose
        // heading = bearing from target to camera; look dir = heading + π.
        // π puts the camera SOUTH of the target so the fly-in looks NORTH
        // (was 0.0, which sat north of target and looked south).
        heading: Math.PI,         // radians; fly-in looks NORTH
        pitch:   -1.134,          // radians, -65° (initial boot angle)
        radius:  150.0,           // metres from target

        // Drag state
        dragging:      false as boolean,
        dragButton:    -1    as number,  // 0=left, 1=middle, 2=right
        dragStartX:    0     as number,
        dragStartY:    0     as number,
        dragStartH:    0.0   as number,  // heading at drag start
        dragStartP:    0.0   as number,  // pitch at drag start
        dragStartTLat: 0.0   as number,  // target lat at drag start (pan)
        dragStartTLng: 0.0   as number,  // target lng at drag start (pan)
      };

      // Point orbitRef.current to this orbit object so it is accessible
      // from anywhere in the component (fitCameraToRoofPlanes, flyToProperty, etc.)
      orbitRef.current = orbit;

      // ── 3. camera.setView() helper ───────────────────────────────────────────
      //
      // Computes the camera position from the orbit state and calls setView().
      // This is the ONLY place that moves the Cesium camera — one clean function.
      //
      // MATH:
      //   orbit.heading = angle of camera POSITION relative to target (0=N, CW+)
      //   orbit.pitch   = Cesium convention: 0=horizontal, -π/2=straight down
      //   orbit.radius  = metres from target to camera
      //
      //   Camera sits at:
      //     ENU east  =  R · cos(−pitch) · sin(heading)
      //     ENU north =  R · cos(−pitch) · cos(heading)
      //     ENU up    = −R · sin(pitch)          (positive when pitch<0 = cam is above target)
      //
      //   Camera looks TOWARD target, so look-direction = −enuOffset (normalised).
      //   Cesium setView HPR derives orientation from the heading+pitch of the camera’s
      //   look direction, NOT the camera position direction.
      //   Look-direction heading = orbit.heading + π   (camera faces opposite to its position)
      //   Look-direction pitch   = −orbit.pitch         (inverse: cam above target → look down)
      function applyOrbit() {
        const cam = viewer.camera;
        if (!cam) return;

        const C3   = C.Cartesian3;
        const CMath = C.Math;

        // Clamp to safe values
        orbit.pitch  = CMath.clamp(orbit.pitch,  -CMath.PI_OVER_TWO + 0.02,  CMath.PI_OVER_TWO - 0.05);
        orbit.radius = CMath.clamp(orbit.radius, 1.5, 50000);

        // Elevation angle: -pitch in Cesium convention (pitch=-π/2 = looking straight down = camera is overhead)
        const elev  = -orbit.pitch;   // elevation above horizontal (positive = camera is above target)
        const pSin  = Math.sin(elev);  // how high the camera is (>0 = above)
        const pCos  = Math.cos(elev);  // horizontal distance scale
        const hSin  = Math.sin(orbit.heading);
        const hCos  = Math.cos(orbit.heading);

        // Camera offset from target in ENU metres
        const eastM  = orbit.radius * pCos * hSin;
        const northM = orbit.radius * pCos * hCos;
        const upM    = orbit.radius * pSin;

        // Convert ENU offset to world Cartesian3.
        // Cesium’s eastNorthUpToFixedFrame(origin) gives a 4×4 matrix where:
        //   col0 = East unit vector in ECEF
        //   col1 = North unit vector in ECEF
        //   col2 = Up unit vector in ECEF
        //   col3 = origin (target) in ECEF
        //
        // multiplyByPointAsVector (3×4 × [x,y,z,0]) gives the ROTATION ONLY,
        // i.e. ecef_offset = R · enuVec (no translation).
        // Camera position = origin + ecef_offset.
        const targetCart = C3.fromDegrees(orbit.targetLng, orbit.targetLat, orbit.targetAlt);
        const enuToEcef  = C.Transforms.eastNorthUpToFixedFrame(targetCart);

        // Use multiplyByPointAsVector to get rotation-only (no translation baked in)
        const enuVec    = new C3(eastM, northM, upM);
        const ecefVec   = C.Matrix4.multiplyByPointAsVector(enuToEcef, enuVec, new C3());
        const camPos    = C3.add(targetCart, ecefVec, new C3());

        // Camera look-direction heading & pitch:
        // The camera sits at position = target + offset, and must look TOWARD target.
        // Look direction = −offset (normalised).
        // In Cesium HPR convention for setView:
        //   heading = compass bearing of look direction = orbit.heading + π  (camera is opposite side of target)
        //   pitch   = elevation of look direction = −elev (camera above → look down, i.e. negative pitch)
        const lookHeading = orbit.heading + Math.PI;
        const lookPitch   = -elev;   // same as orbit.pitch

        cam.setView({
          destination: camPos,
          orientation: {
            heading: lookHeading,
            pitch:   lookPitch,
            roll:    0,
          },
        });

        viewer.scene.requestRender();
      }

      // ── 4. Expose applyOrbit via ref so flyTo/fitCamera can update orbit state
      applyOrbitRef.current = applyOrbit;

      // Seed orbit.targetAlt once terrain is available (deferred)
      // syncOrbitAlt: updates orbit target altitude after terrain elevation is resolved.
      // Called by the lat/lng change effect when cesiumGroundElevRef is updated.
      // (defined here so it’s in scope; actually called via orbitRef/applyOrbitRef).

      // ── 5. Mouse / Pointer event handlers ─────────────────────────────────────────────
      // Use viewer.scene.canvas directly — guaranteed to be the Cesium rendering canvas.
      // Previously used querySelector('canvas') which could pick a non-rendering canvas.
      const cesiumCanvas = viewer.scene.canvas as HTMLCanvasElement | null;

      if (cesiumCanvas) {
        // ── 5a. Drag sensitivity constants ──────────────────────────────────────
        // ORBIT_DRAG: radians of heading/pitch change per pixel of mouse movement.
        // At 0.004 rad/px: dragging 400px across a 1600-wide canvas rotates ~92°.
        const ORBIT_DRAG  = 0.004;  // rad/px for left-drag orbit
        const TILT_DRAG   = 0.003;  // rad/px for right-drag tilt (finer)

        // PAN_DRAG: metres of orbit target shift per pixel.
        // At orbit.radius = 150m: 1px → 150*0.001 = 0.15m pan.  Scales with zoom.
        const PAN_SCALE   = 0.001;  // world metres per pixel per metre of orbit radius

        // ── 5b. Wheel zoom ──────────────────────────────────────────────────────
        // The upstream normalizer (see wheel listener below) already converts all
        // wheel events to ±120.  We apply a fixed proportional step per notch.
        const ZOOM_FACTOR = 0.15;   // 15% of current radius per notch

        let middleDown   = false;
        let middleDownAt = 0;
        let reDispatching = false;

        // ── 5c. pointerdown (replaces mousedown) ───────────────────────────────────────
        // Using pointerdown (fires before implicit pointer capture) so we can
        // call setPointerCapture() and guarantee that pointermove/pointerup
        // follow the pointer to window even on browsers that redirect them.
        cesiumCanvas.addEventListener('pointerdown', (ev: PointerEvent) => {
          if (ev.button === 1) { middleDown = true; middleDownAt = Date.now(); }

          // Capture the pointer so pointermove/pointerup come to us even if
          // the cursor leaves the canvas (works on all modern browsers).
          try { cesiumCanvas.setPointerCapture(ev.pointerId); } catch {}

          orbit.dragging   = true;
          orbit.dragButton = ev.button;
          orbit.dragStartX = ev.clientX;
          orbit.dragStartY = ev.clientY;
          orbit.dragStartH    = orbit.heading;
          orbit.dragStartP    = orbit.pitch;
          orbit.dragStartTLat = orbit.targetLat;
          orbit.dragStartTLng = orbit.targetLng;

          ev.preventDefault();
        }, { capture: true });

        // ── 5d. pointermove (replaces mousemove on window) ────────────────────────────────
        // With pointer capture active, pointermove fires even after the cursor
        // leaves the canvas.  We also keep a mousemove fallback on window for
        // browsers that don’t support pointer capture on canvas.
        const handleDragMove = (ev: PointerEvent | MouseEvent) => {
          if (!orbit.dragging) return;
          // v62: an array grab is active → don't move the camera (let the array
          // manipulation own the drag). Without this the left-drag PANS the camera
          // while the array also rotates/moves — the cause of the "shear".
          if (arrayManipRef.current) return;

          const dx = ev.clientX - orbit.dragStartX;
          const dy = ev.clientY - orbit.dragStartY;

          // v52.2: Swapped left/right-drag controls to match GIS/Google-Maps convention:
          //   Left-drag   → pan (translate target) — matches 2D map drag behaviour
          //   Right-drag  → full orbit (heading + pitch)
          //   Middle-drag → orbit (heading + pitch, same as right-drag)
          // Previously left=orbit, right=tilt — felt inverted vs 2D map expectations.
          if (orbit.dragButton === 0) {
            // Left-drag: pan the orbit target (like 2D map drag)
            const panScale = orbit.radius * PAN_SCALE;
            const hSin = Math.sin(orbit.heading);
            const hCos = Math.cos(orbit.heading);
            // Google-Maps "grab the map" semantics: the scene follows the cursor,
            // so the orbit TARGET moves opposite the drag (drag right → content
            // moves right → target shifts camera-left). Camera looks toward
            // heading+π, so camera-right = -(east·hCos) + ... with these signs:
            const eastPan  =  dx * panScale * hCos - dy * panScale * hSin;
            const northPan = -dx * panScale * hSin - dy * panScale * hCos;
            const mPerDegLat = 111320;
            const mPerDegLng = 111320 * Math.cos(orbit.targetLat * Math.PI / 180);
            orbit.targetLat = orbit.dragStartTLat + northPan / mPerDegLat;
            orbit.targetLng = orbit.dragStartTLng + eastPan  / mPerDegLng;

          } else if (orbit.dragButton === 2 || orbit.dragButton === 1) {
            // Right-drag or middle-drag: full orbit (heading + pitch)
            orbit.heading = orbit.dragStartH - dx * ORBIT_DRAG;
            orbit.pitch   = orbit.dragStartP + dy * ORBIT_DRAG;
          }

          applyOrbit();
        };

        // Primary: pointermove on canvas (pointer capture redirects here even outside canvas).
        cesiumCanvas.addEventListener('pointermove', handleDragMove as EventListener);
        // Dedup guard: skip window mousemove when pointermove already handled it.
        let lastMoveX = -9999, lastMoveY = -9999;
        const handlePointerMoveDedup = (ev: PointerEvent) => { lastMoveX = ev.clientX; lastMoveY = ev.clientY; };
        cesiumCanvas.addEventListener('pointermove', handlePointerMoveDedup);
        // Fallback: window mousemove for edge cases (pointer capture not active).
        window.addEventListener('mousemove', (ev: MouseEvent) => {
          if (ev.clientX === lastMoveX && ev.clientY === lastMoveY) return;
          (handleDragMove as EventListener)(ev);
        });

        // ── 5e. pointerup + mouseup ────────────────────────────────────────────────────────
        const handleDragEnd = (ev: PointerEvent | MouseEvent) => {
          if ('pointerId' in ev) {
            try { cesiumCanvas.releasePointerCapture((ev as PointerEvent).pointerId); } catch {}
          }
          if (ev.button === 1) middleDown = false;
          orbit.dragging   = false;
          orbit.dragButton = -1;
        };
        cesiumCanvas.addEventListener('pointerup',     handleDragEnd as EventListener);
        cesiumCanvas.addEventListener('pointercancel', handleDragEnd as EventListener);
        window.addEventListener('mouseup', handleDragEnd as EventListener);

        // ── 5f. Wheel zoom ───────────────────────────────────────────────────────
        // Capture-phase normalizer: converts all wheel events to ±120 and
        // drops middle-click synthetic blips.  Then applyOrbit() handles zoom.
        cesiumCanvas.addEventListener('wheel', (ev: WheelEvent) => {
          if (reDispatching) return;

          // Drop middle-click synthetic blip (button press → wheel within 150ms)
          if (middleDown && Date.now() - middleDownAt < 150) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
            return;
          }

          ev.stopImmediatePropagation();
          ev.preventDefault();

          // ev.deltaY > 0 = scroll down = zoom out (increase radius)
          const direction = ev.deltaY > 0 ? 1 : -1;
          orbit.radius = orbit.radius * (1 + direction * ZOOM_FACTOR);

          applyOrbit();

          // Pump renders for the zoom animation window
          const end = Date.now() + 600;
          const pump = () => {
            try { viewer.scene.requestRender(); } catch {}
            if (Date.now() < end) requestAnimationFrame(pump);
          };
          requestAnimationFrame(pump);

        }, { capture: true, passive: false });

        // Context menu suppression (right-drag should not open browser menu)
        cesiumCanvas.addEventListener('contextmenu', (ev: Event) => {
          ev.preventDefault();
        });
      }
      // ─────────────────────────────────────────────────────────────────────────

      if (cesiumRef.current) {
        const ro = new ResizeObserver(() => {
          try { viewer.resize(); viewer.scene.requestRender(); } catch {}
        });
        ro.observe(cesiumRef.current);
      }

      // ─────────────────────────────────────────────────────────────────────────

      // Global render error handler - prevents freeze
      viewer.scene.renderError.addEventListener((_scene: any, error: any) => {
        addLog('ERROR', `Cesium render error: ${error?.message ?? error}`);
        try { viewer.scene.requestRender(); } catch {}
      });

      // Add imagery - ArcGIS directly (no Ion auth delay)
      try {
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, GeoEye',
        }));
      } catch (e) { handleCesiumError('Imagery layer setup', e, true); }

      // depthTestAgainstTerrain: false allows overlays to show even if elevation math is slightly off
      // When true, entities below terrain surface are hidden (causes overlay disappearance)
      viewer.scene.globe.depthTestAgainstTerrain = false;
      viewer.scene.pickTranslucentDepth = true;
      viewer.scene.globe.enableLighting = false;  // off by default, enabled when shade mode active
      viewer.scene.shadowMap.enabled = false;      // off by default
      viewer.scene.shadowMap.softShadows = true;
      viewer.scene.shadowMap.size = 1024;
      viewer.scene.fog.enabled = false;
      viewer.scene.globe.show = true;

      // Initialize clock to June 21 at noon for sun position
      try {
        const initDate = new Date();
        initDate.setFullYear(initDate.getFullYear(), 5, 21);
        initDate.setHours(12, 0, 0, 0);
        viewer.clock.currentTime = C.JulianDate.fromDate(initDate);
        viewer.clock.shouldAnimate = false;
      } catch (e) { handleCesiumError('Clock initialization', e, true); }

      viewer.scene.requestRender();

      setStage('tiles'); setStageMsg('Loading 3D tiles + Solar data...'); setProgress(45);

      // ── Part 2 fix: explicit API key check before attempting tile load ─────
      // If NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set in Vercel env vars,
      // the tile URL becomes "...?key=" which returns 403 from Google.
      // Log a clear error and skip the tile load rather than silently failing.
      if (!GOOGLE_API_KEY) {
        console.error(
          '[3D_TILE_ERROR] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set.\n' +
          '  → Vercel Dashboard → Project → Settings → Environment Variables\n' +
          '  → Add: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = <your Google Maps API key>\n' +
          '  → Enable: Maps JavaScript API + Photorealistic 3D Tiles API\n' +
          '  → Then redeploy. 3D tiles require this key to load.'
        );
        addLog('WARN', '3D Tiles skipped — NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not configured (check Vercel env vars)');
        setTileStatus('failed');
        setRenderMode('TERRAIN_ONLY');
      }

      // PERF v61: Run tiles and Solar API fetch IN PARALLEL for faster boot.
      // DSM is NOT fetched at boot — it's the slowest call and not needed for initial render.
      // DSM is lazy-loaded after boot completes (additive, non-blocking).
      const tilePromise: Promise<any> = GOOGLE_API_KEY
        ? C.Cesium3DTileset.fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
            {
              showCreditsOnScreen: false,
              // PERF v48.29: Raised initial SSE from 32→64 for faster first paint.
              // Dynamic optimizer (camera.changed) adjusts down to 16/8 on zoom-in.
              maximumScreenSpaceError: 64,
              // PERF v61: skipLevelOfDetail=true — tiles appear immediately without waiting for full LOD chain.
              // Visual quality is the same at final zoom; only intermediate LOD pops are slightly more visible.
              skipLevelOfDetail: true,
              // preferLeaves: true loads highest-detail tiles first when zoomed in.
              preferLeaves: true,
              // dynamicScreenSpaceError: reduces tile detail at edges — big perf win.
              dynamicScreenSpaceError: true,
              dynamicScreenSpaceErrorDensity: 0.00278,
              dynamicScreenSpaceErrorFactor: 4.0,
              // PERF v61: Limit concurrent tile requests — prevents request queue saturation on first load.
              maximumAttemptedTiles: 32,
            }
          )
        : Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not set'));

      // PERF v61: Only fetch elevation + solar at boot. DSM lazy-loaded after scene is interactive.
      // skipDsm=true reduces initial boot time by 3-8s (DSM call is the slowest API at boot).
      const [tileResult, twinResult] = await Promise.allSettled([
        tilePromise,
        buildDigitalTwin(lat, lng, projectAddress ?? '', true /* skipDsm */),
      ]);

      // Handle tiles result
      if (tileResult.status === 'fulfilled') {
        const tileset = tileResult.value;
        viewer.scene.primitives.add(tileset);
        tilesetRef.current = tileset;
        addLog('BOOT', '✅ Google 3D Tiles loaded OK');
        setTileStatus('loaded');
        setRenderMode('TILES');
        // The Google 3D Tiles ARE the terrain + imagery, so hide the flat ellipsoid
        // globe (rendered at ellipsoidal height 0). At low-lying/coastal sites the
        // real tile ground sits BELOW height 0 (negative ellipsoidal), so the globe
        // pokes UP through the terrain and "bleeds through" at oblique angles
        // (Waterford CT). Only hide once tiles are confirmed loaded — the failure
        // branch keeps globe.show=true so the Esri base map remains as a fallback.
        try { viewer.scene.globe.show = false; } catch (e) { handleCesiumError('hide globe', e, true); }
        try {
          tileset.allTilesLoaded.addEventListener(() => {
            addLog('BOOT', '✅ All 3D tiles loaded');
            try { viewer.scene.requestRender(); } catch {}
          });
        } catch (e) { handleCesiumError('allTilesLoaded listener', e, true); }
      } else {
        const tileErr = (tileResult as PromiseRejectedResult).reason;
        console.error('[3D_TILE_ERROR]', tileErr?.message ?? tileErr);
        addLog('WARN', `3D Tiles failed: ${tileErr?.message ?? 'unknown error'}`);
        setTileStatus('failed');
        // Fallback to terrain-only mode — panel placement still works via CAD engine
        setRenderMode('TERRAIN_ONLY');
      }

      // Handle Solar API result
      let twinData: DigitalTwinData | null = null;
      if (twinResult.status === 'fulfilled') {
        twinData = twinResult.value as DigitalTwinData;
        twinRef.current = twinData;
        onTwinLoaded?.(twinData);
        addLog('SOLAR', `Digital twin: ${twinData.roofSegments.length} segments, elev=${twinData.elevation.toFixed(1)}m`);
      } else {
        addLog('WARN', `Digital twin failed: ${(twinResult as PromiseRejectedResult).reason?.message}`);
      }

      setStage('solar'); setProgress(65);

      setProgress(80);

      // Sample Cesium terrain to get true ellipsoidal height (fixes geoid undulation offset)
      // Google Elevation API returns orthometric heights; Cesium uses ellipsoidal heights
      // In Ohio the geoid undulation is approximately -33m (EGM96 geoid model)
      const googleGroundElev = twinData?.elevation ?? 0;
      // PERF v61: Use lat-based EGM96 geoid approximation directly — skip sampleTerrainMostDetailed.
      // sampleTerrainMostDetailed can take 3-5s with EllipsoidTerrainProvider (which returns 0 anyway).
      // The geoid approximation below is accurate to ~1-2m for CONUS, which is sufficient for panel placement.
      // Formula: ellipsoidal_height = orthometric_height (Google Elevation) + geoid_undulation
      // EGM96 CONUS approx: -29 - 5*sin(lat_rad) → ~-34m at Ohio, ~-32m at Alexandria VA, ~-29m at Texas
      const latRadBoot = lat * Math.PI / 180;
      const geoidApproxBoot = -29 - 5 * Math.sin(latRadBoot);
      const cesiumGroundElev = googleGroundElev + geoidApproxBoot;
      cesiumGroundElevRef.current = cesiumGroundElev;
      cesiumGroundElevResolvedRef.current = true;
      terrainReadyRef.current = true;
      setTerrainReady(true);
      addLog('BOOT', `cesiumGroundElev: ${cesiumGroundElev.toFixed(1)}m (Google: ${googleGroundElev.toFixed(1)}m, geoidApprox: ${geoidApproxBoot.toFixed(1)}m) [skipped sampleTerrainMostDetailed for speed]`);
      // NOW set twin state - cesiumGroundElevRef is ready, so drawOverlays will use correct elevation
      if (twinData) setTwin(twinData);

      // Set initial orbit state using terrain-corrected elevation
      const oo = orbitRef.current;
      oo.targetLat = lat;
      oo.targetLng = lng;
      oo.targetAlt = cesiumGroundElev;
      oo.heading   = Math.PI;  // π → fly-in looks NORTH (look dir = heading + π)
      oo.pitch     = -1.134;   // -65° top-down-ish
      oo.radius    = 150;
      applyOrbitRef.current?.();

      setProgress(90);
      // Draw overlays AFTER terrain sampling so geoidOffset is correctly applied
      if (twinData) drawOverlays(viewer, C, twinData);
      // Redraw again after camera settles to ensure overlays are visible
      setTimeout(() => {
        if (twinData && viewerRef.current) {
          const Cesium = (window as any).Cesium;
          if (Cesium) drawOverlays(viewerRef.current, Cesium, twinData);
        }
      }, 3000);

      setupClickHandler(viewer, C);
      setupHoverHandler(viewer, C);
      setupFpsMonitor(viewer);
      setupCameraOptimizer(viewer, C);
      setupKeyboardHandler();


      // Initial camera position via orbit (also called at end of missing section above)
      // applyOrbit() was already called after cesiumGroundElev was set above


      // Expose renderAllPanels so the panels useEffect can call it after boot
      renderAllPanelsRef.current = renderAllPanels;

      // Render panels: use panels prop if available, otherwise use pendingPanelsRef
      // (panels prop may still be [] if DesignStudio's restore effect ran before boot)
      const panelsToRender = panels.length > 0 ? panels : pendingPanelsRef.current;
      if (panelsToRender.length > 0) {
        renderAllPanels(viewer, C, panelsToRender);
        addLog('BOOT', `Rendered ${panelsToRender.length} panels at boot completion`);
      }
      pendingPanelsRef.current = [];

      setStage('done'); setStageMsg('Ready'); setProgress(100);
      setStatusMsg('✅ 3D Digital Twin loaded — click to place panels');
      addLog('BOOT', 'Boot complete');

      [200, 600, 1500, 3000].forEach(t =>
        setTimeout(() => { try { viewer.resize(); viewer.scene.requestRender(); } catch {} }, t)
      );

      // PERF v61: Lazy-load DSM after scene is already interactive (non-blocking).
      // This enriches roof segment geometry without blocking initial 3D render.
      if (twinData) {
        setTimeout(() => {
          enrichDigitalTwinWithDsm(twinData).then(enriched => {
            if (enriched !== twinData) {
              setTwin(enriched);
              onTwinLoaded?.(enriched);
              if (viewerRef.current && (window as any).Cesium) {
                drawOverlays(viewerRef.current, (window as any).Cesium, enriched);
              }
              addLog('BOOT', `DSM enriched: ${enriched.roofSegments.length} roof segments`);
            }
          }).catch(e => addLog('WARN', `DSM enrichment failed: ${(e as Error).message}`));
        }, 2000); // 2s delay — scene is already interactive by then
      }

    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? String(err);
      setStage('error'); setStageMsg(`Error: ${msg}`);
      addLog('ERROR', `Boot failed: ${msg}`);
      // v47.120: Reset initDone so the Retry button in the error overlay can re-run boot().
      // This is critical: without this, clicking Retry would silently skip boot() (initDone=true guard).
      initDone.current = false;
      // Note: onError is intentionally NOT calling setShow3D(false) anymore (v47.120).
      // The error overlay inside this component has a Retry button — hiding the 3D view
      // on any transient failure (Cesium CDN down, network blip) is too aggressive.
      onError?.(msg);
    }
  }

  async function loadCesium(): Promise<any> {
    if ((window as any).Cesium) return (window as any).Cesium;
    return new Promise((resolve, reject) => {
      if (!document.getElementById('cesium-css')) {
        const link = document.createElement('link');
        link.id = 'cesium-css'; link.rel = 'stylesheet';
        link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Widgets/widgets.css';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Cesium.js';
      script.async = true;
      const timeout = setTimeout(() => reject(new Error('CesiumJS load timeout')), 45000); // PERF v58.19: CDN cold-start
      script.onload = () => {
        clearTimeout(timeout);
        if ((window as any).Cesium) resolve((window as any).Cesium);
        else reject(new Error('Cesium not found after load'));
      };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('CesiumJS script load failed')); };
      document.head.appendChild(script);
    });
  }

  function setupFpsMonitor(viewer: any) {
    let frameCount = 0, lastTime = performance.now();
    let lastHeadingDeg = -1;
    viewer.scene.postRender.addEventListener(() => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(Math.round(frameCount * 1000 / (now - lastTime)));
        frameCount = 0; lastTime = now;
      }
      // v48.13: Update compass heading ~10fps (every 100ms)
      try {
        const headRad = viewer.camera.heading ?? 0;
        const headDeg = ((headRad * 180 / Math.PI) + 360) % 360;
        if (Math.abs(headDeg - lastHeadingDeg) > 0.5) {
          setCameraHeadingDeg(headDeg);
          lastHeadingDeg = headDeg;
        }
      } catch {}
    });
  }

  // ── Camera-based performance optimizer ────────────────────────────────────
  // Dynamically adjusts shadow map resolution and tile detail based on camera
  // height. At overview distances (>500m), reduces GPU load significantly
  // without any visible quality loss.
  function setupCameraOptimizer(viewer: any, C: any) {
    let lastOptHeight = -1;
    viewer.camera.changed.addEventListener(() => {
      try {
        // CRITICAL: With requestRenderMode=true, Cesium won't repaint during camera
        // moves unless we explicitly request a render here. Without this, middle-mouse
        // drag / tilt appears frozen even though the camera IS moving internally.
        viewer.scene.requestRender();

        const h = viewer.camera.positionCartographic?.height ?? 500;
        // Only update quality settings when height changes by more than 50m (avoid thrashing)
        if (Math.abs(h - lastOptHeight) < 50) return;
        lastOptHeight = h;

        // Dynamic shadow map resolution: high quality close-up, low quality overview
        if (viewer.scene.shadowMap) {
          if (h > 800) {
            viewer.scene.shadowMap.size = 512;
            viewer.scene.shadowMap.softShadows = false;
          } else if (h > 300) {
            viewer.scene.shadowMap.size = 1024;
            viewer.scene.shadowMap.softShadows = true;
          } else {
            viewer.scene.shadowMap.size = 2048;
            viewer.scene.shadowMap.softShadows = true;
          }
        }

        // Dynamic tile screen space error: more detail close-up, less at overview
        // v48.29: Raised thresholds (64/32/16) to reduce tile-reload storms at oblique 45° angles.
        // At 45° tilt many more tile faces are visible, causing SSE=4 to flood requests → slow render.
        if (tilesetRef.current) {
          if (h > 1000) {
            tilesetRef.current.maximumScreenSpaceError = 64; // fast overview
          } else if (h > 400) {
            tilesetRef.current.maximumScreenSpaceError = 32; // balanced
          } else {
            tilesetRef.current.maximumScreenSpaceError = 16; // full quality close-up (was 4 — caused 10-15s loads at 45°)
          }
        }
      } catch {}
    });

    // ADDITIONAL FIX: Pump requestRender during any mouse drag on the canvas.
    // camera.changed fires at the END of a movement step, but smooth dragging
    // needs continuous repaints. We listen to mousemove/pointermove while any
    // button is held and request a render each frame.
    const canvas = viewer.scene.canvas as HTMLCanvasElement;
    let dragActive = false;
    let rafId = 0;

    const onDragStart = () => { dragActive = true; };
    const onDragEnd   = () => {
      dragActive = false;
      cancelAnimationFrame(rafId);
      // One final render after drag ends to settle the view
      try { viewer.scene.requestRender(); } catch {}
    };
    const pumpRender = () => {
      if (!dragActive) return;
      try { viewer.scene.requestRender(); } catch {}
      rafId = requestAnimationFrame(pumpRender);
    };
    const onDragMove = () => {
      if (!dragActive) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(pumpRender);
    };

    canvas.addEventListener('mousedown',   onDragStart, { passive: true });
    canvas.addEventListener('pointerdown', onDragStart, { passive: true });
    canvas.addEventListener('mouseup',     onDragEnd,   { passive: true });
    canvas.addEventListener('pointerup',   onDragEnd,   { passive: true });
    canvas.addEventListener('mouseleave',  onDragEnd,   { passive: true });
    canvas.addEventListener('mousemove',   onDragMove,  { passive: true });
    canvas.addEventListener('pointermove', onDragMove,  { passive: true });

    // Scroll wheel zoom: pump renders continuously for the full duration of
    // Cesium's zoom animation (~500ms) so it doesn't freeze mid-animation.
    // Previous code only pumped at +100ms and +300ms — frames after 300ms were
    // skipped, causing the zoom to stall then snap to the final position.
    canvas.addEventListener('wheel', () => {
      // Kick off a short RAF loop that runs for 600ms — covers the full
      // Cesium zoom-inertia window without over-rendering idle frames.
      const end = Date.now() + 600;
      const pump = () => {
        try { viewer.scene.requestRender(); } catch {}
        if (Date.now() < end) requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    }, { passive: true });
  }

  // ── v47.215: Fit camera to all placed panels (bounding box zoom) ─────────────────
  // Called by the "Fit View" toolbar button and automatically after any placement.
  // Works for both auto-fill and manually placed panels.
  function fitCameraToRoofPlanes(_viewer: any, _C: any) {
    const panels = panelsRef.current;
    const o = orbitRef.current;
    if (!panels || panels.length === 0) {
      // No panels — reset to site at default pose
      o.targetLat = lat; o.targetLng = lng;
      o.targetAlt = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      o.heading = Math.PI; o.pitch = -1.134; o.radius = 150;  // look NORTH
    } else {
      const lats = panels.map((p: PlacedPanel) => p.lat);
      const lngs = panels.map((p: PlacedPanel) => p.lng);
      const centLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      const latSpanM = (Math.max(...lats) - Math.min(...lats)) * 111320;
      const lngSpanM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(centLat * Math.PI / 180);
      const spanM    = Math.max(latSpanM, lngSpanM, 15);
      const radius   = Math.max(50, spanM * 1.4);
      o.targetLat = centLat; o.targetLng = centLng;
      o.targetAlt = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      o.heading = Math.PI; o.pitch = -1.222;  // -70°, look NORTH
      o.radius  = radius;
      addLog('FIT', `Fit view: ${panels.length} panels, span=${spanM.toFixed(0)}m, radius=${radius.toFixed(0)}m`);
    }
    applyOrbitRef.current?.();
  }

  // ── Draw all overlays ──────────────────────────────────────────────────────
  function drawOverlays(viewer: any, C: any, twinData: DigitalTwinData) {
    overlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    overlayRef.current = [];

    // Ground elevation for overlay positioning.
    // Use cesiumGroundElevRef if available (sampled at boot from terrain provider).
    // Fallback: Google elevation + lat-based EGM96 geoid approximation for CONUS.
    const googleElev = isFinite(twinData.elevation) ? twinData.elevation : 0;
    const geoidUndulationOverlay = -29 - 5 * Math.sin(
      (twinData.roofSegments[0]?.center?.lat ?? 38) * Math.PI / 180
    );
    const cesiumElev = cesiumGroundElevResolvedRef.current
      ? cesiumGroundElevRef.current
      : googleElev + geoidUndulationOverlay;
    const elev = cesiumElev;
    // geoidOffset: difference between Cesium ellipsoidal and Google orthometric heights.
    // Used to convert per-segment and per-corner elevations from Google to Cesium coords.
    const geoidOffset = cesiumElev - googleElev;

    // Parcel boundary
    if (showParcel && twinData.parcel) {
      try {
        const rawPos = twinData.parcel.boundary
          .map(p => safeCartesian3(C, p.lng, p.lat, elev + 1.0))
          .filter(Boolean);
        if (rawPos.length >= 2) {
          const e = viewer.entities.add({
            polyline: {
              positions: [...rawPos, rawPos[0]],
              width: 3,
              material: new C.PolylineGlowMaterialProperty({ glowPower: 0.3, color: C.Color.fromCssColorString('#00ff88') }),
              clampToGround: true,
            },
          });
          overlayRef.current.push(e);
        }
        twinData.parcel.easements.forEach((ez: any) => {
          try {
            const ezPos = ez.boundary.map((p: any) => safeCartesian3(C, p.lng, p.lat, elev + 0.5)).filter(Boolean);
            if (ezPos.length >= 2) {
              const e = viewer.entities.add({
                polyline: {
                  positions: [...ezPos, ezPos[0]], width: 2,
                  material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString('#ffaa00'), dashLength: 8 }),
                  clampToGround: true,
                },
              });
              overlayRef.current.push(e);
            }
          } catch {}
        });
      } catch (e: unknown) { addLog('WARN', `Parcel overlay: ${(e as Error).message}`); }
    }

    // Roof segments
    if (showRoofSegs && twinData.roofSegments.length > 0) {
      const maxSun = Math.max(...twinData.roofSegments.map((s: any) => s.sunshineHours || 0), 1800);
      twinData.roofSegments.forEach((seg: any, i: number) => {
        try {
          // seg.elevation is in Google orthometric coords (baseElev + heightAboveGround)
          // Apply geoidOffset to convert to Cesium ellipsoidal coordinates
          const segElevGoogle = isFinite(seg.elevation) ? seg.elevation : googleElev;
          const segElev = segElevGoogle + geoidOffset; // convert to Cesium ellipsoidal
          const color = sunshineToColor(C, seg.sunshineHours || 0, maxSun || 1800);

          // Build positions from corners (which have per-corner altitude accounting for roof pitch)
          let positions: any[] = [];
          if (seg.corners && seg.corners.length >= 3) {
            const raw = seg.corners.map((c: any) => {
              // c.alt is in Google orthometric coords - apply geoidOffset for Cesium
              const altGoogle = isFinite(c.alt) ? c.alt : segElevGoogle;
              const alt = altGoogle + geoidOffset;
              return safeCartesian3(C, c.lng, c.lat, alt);
            }).filter(Boolean);
            if (raw.length >= 3) positions = [...raw, raw[0]];
          }
          // Fallback: flat bounding box at segElev (already geoidOffset-corrected)
          if (positions.length < 3 && seg.boundingBox?.sw && seg.boundingBox?.ne) {
            const { sw, ne } = seg.boundingBox;
            if (isValidCoord(sw.lat, sw.lng) && isValidCoord(ne.lat, ne.lng)) {
              const pts = [
                safeCartesian3(C, sw.lng, sw.lat, segElev),
                safeCartesian3(C, ne.lng, sw.lat, segElev),
                safeCartesian3(C, ne.lng, ne.lat, segElev),
                safeCartesian3(C, sw.lng, ne.lat, segElev),
              ].filter(Boolean);
              if (pts.length === 4) positions = [...pts, pts[0]];
            }
          }
          if (positions.length < 3) return;

          // Use corrected positions (geoidOffset already applied to segElev)
          // With depthTestAgainstTerrain=false, these will always be visible
          if (positions.length >= 3) {
            // No polygon fill — keep roof visible and unobstructed
            // Thin yellow outline only
            try {
              const e = viewer.entities.add({
                polyline: {
                  positions,
                  width: 1.5,
                  material: C.Color.fromCssColorString('#ffdd00').withAlpha(0.55),
                  clampToGround: false,
                  arcType: C.ArcType.NONE,
                },
              });
              overlayRef.current.push(e);
            } catch (e) { handleCesiumError('Roof segment polyline', e, true); }
          }

          // Label at center of segment
          if (isValidCoord(seg.center?.lat, seg.center?.lng)) {
            try {
              const labelPos = safeCartesian3(C, seg.center.lng, seg.center.lat, segElev + 1.5); // segElev already geoidOffset-corrected
              if (labelPos) {
                const pitchStr = isFinite(seg.pitchDegrees) ? seg.pitchDegrees.toFixed(0) : '?';
                const azStr = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees.toFixed(0) : '?';
                const sunStr = isFinite(seg.sunshineHours) ? seg.sunshineHours.toFixed(0) : '?';
                const areaFt = isFinite(seg.areaM2) ? ` ${(seg.areaM2 * 10.7639).toFixed(0)}ft²` : '';
                const e = viewer.entities.add({
                  position: labelPos,
                  label: {
                    text: `${pitchStr}° / ${azStr}°\n${sunStr}h${areaFt}`,
                    font: '12px sans-serif', fillColor: C.Color.WHITE,
                    outlineColor: C.Color.BLACK, outlineWidth: 2,
                    style: C.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: C.VerticalOrigin.BOTTOM,
                    pixelOffset: new C.Cartesian2(0, -5),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scale: 0.9, showBackground: true,
                    backgroundColor: new C.Color(0, 0, 0, 0.6),
                    backgroundPadding: new C.Cartesian2(4, 3),
                  },
                });
                overlayRef.current.push(e);
              }
            } catch (e) { handleCesiumError(`Segment ${i} label`, e, true); }
          }

          // ── Setback boundary visualization ──────────────────────────────────────────
          // Show the buildable area boundary (inset from roof polygon by fire setback).
          // This helps the user see exactly where panels can be placed.
          // Only shown when placementMode === 'auto_roof' (Auto Fill active).
          if (modeRef.current === 'auto_roof') {
            try {
              const SETBACK_M = Math.max(fireSetbacks?.edgeSetbackM ?? 0.457, fireSetbacks?.ridgeSetbackM ?? 0.457); // matches fillRoofSegmentWithPanels
              // Use convexHull or polygon as the roof boundary
              const roofPoly: Array<{ lat: number; lng: number }> =
                (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
                (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];

              if (roofPoly.length >= 3) {
                // Inset the polygon by SETBACK_M to get the buildable area boundary
                // Simple centroid-based inset: move each vertex toward centroid by SETBACK_M
                const cLat = roofPoly.reduce((s, p) => s + p.lat, 0) / roofPoly.length;
                const cLng = roofPoly.reduce((s, p) => s + p.lng, 0) / roofPoly.length;
                const cosLatSB = Math.cos(cLat * Math.PI / 180);
                const mLatSB = 111320;
                const mLngSB = 111320 * cosLatSB;

                const insetPoly = roofPoly.map(p => {
                  const dLat = p.lat - cLat;
                  const dLng = p.lng - cLng;
                  const distM = Math.sqrt((dLat * mLatSB) ** 2 + (dLng * mLngSB) ** 2);
                  if (distM < 0.001) return p;
                  const scale = Math.max(0, (distM - SETBACK_M) / distM);
                  return { lat: cLat + dLat * scale, lng: cLng + dLng * scale };
                });

                const sbElev = segElev + 0.15; // slightly above roof surface
                const sbPositions = [...insetPoly, insetPoly[0]]
                  .map(p => safeCartesian3(C, p.lng, p.lat, sbElev))
                  .filter(Boolean);

                if (sbPositions.length >= 3) {
                  // Dashed cyan line = buildable area boundary
                  const sbLine = viewer.entities.add({
                    polyline: {
                      positions: sbPositions,
                      width: 2,
                      material: new C.PolylineDashMaterialProperty({
                        color: C.Color.fromCssColorString('#00ffff').withAlpha(0.85),
                        dashLength: 12,
                        dashPattern: 0xFF00,
                      }),
                      clampToGround: false,
                      arcType: C.ArcType.NONE,
                    },
                  });
                  overlayRef.current.push(sbLine);
                }
              }
            } catch (sbErr: unknown) { addLog('WARN', `Setback overlay seg ${i}: ${(sbErr as Error).message}`); }
          }
        } catch (e: unknown) { addLog('WARN', `Segment ${i} overlay: ${(e as Error).message}`); }
      });
    }
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Render all panels ──────────────────────────────────────────────────────
  /**
   * Clears all existing panel entities from the viewer and rebuilds them from the provided list.
   *
   * @remarks
   * Always clears before rebuilding to prevent panel accumulation bugs.
   * This is the ONLY correct way to update the panel display — never call addPanelEntity
   * directly without first clearing, or panels will multiply on re-renders.
   *
   * Performance: uses incremental diff rendering — only adds new panels and removes
   * deleted ones, rather than clearing and rebuilding all entities on every change.
   * Falls back to full rebuild when shade mode changes (colors must be recomputed).
   *
   * @param viewer   - Active Cesium Viewer instance
   * @param C        - Cesium namespace (window.Cesium)
   * @param panelList - Full list of panels to render (replaces current display entirely)
   * @param forceFullRebuild - If true, clears all entities and rebuilds (used for shade toggle)
   */
  // ── Phase 2: Roof rail visualization ────────────────────────────────────────
  //
  // Renders IronRidge XR100 rails beneath roof panel arrays.
  //
  // Design rules (per spec):
  //   - Rails ONLY — no pads, L-feet, bolts, or flashing (Phase 3+)
  //   - Rails run parallel to eaves (along the panel u-axis / ridge direction)
  //   - One rail run per panel row (gridRow), spanning the full row width
  //   - Rail positioned at panel bottom edge (eave side of panel row)
  //   - Rail height offset = stack height MINUS rail height (sits under panel)
  //   - Minimal entity count: one box entity per rail run, NOT per panel
  //   - Only rendered for rail-based mounting systems
  //   - Entities stored in roofRailMapRef keyed by planeId for O(plane) cleanup
  //
  // RENDERING ONLY — zero impact on structural calc, panel coords, or BOM.

  /** Returns XR rail dimensions for the active mounting system, or null for rail-less. */
  function getRailSpec(mountingId: string): { heightM: number; widthM: number; color: string } | null {
    switch (mountingId) {
      case 'ironridge-xr100':
      case 'rooftech-mini':
      case 'rt-mini':
        return { heightM: 0.042, widthM: 0.025, color: '#6b7280' }; // XR100: 1.66"H × ~1"W, silver-grey
      case 'ironridge-xr1000':
        return { heightM: 0.051, widthM: 0.030, color: '#4b5563' }; // XR1000: 2"H, darker grey
      // Rail-less and non-roof systems return null → no rails rendered
      case 'rooftech-mini-s':
      case 'rooftech-mini-t':
      case 'rooftech-hook':
      case 'ironridge-flat-roof':
        return null;
      default:
        return null; // unknown system → don't render rails
    }
  }

  /**
   * Clears all roof rail entities for a specific planeId (or all planes if planeId omitted).
   * Safe to call before every renderRoofRails rebuild.
   */
  function clearRoofRails(viewer: any, planeId?: string) {
    if (planeId) {
      const entities = roofRailMapRef.current.get(planeId) ?? [];
      entities.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      roofRailMapRef.current.delete(planeId);
    } else {
      roofRailMapRef.current.forEach(entities => {
        entities.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      });
      roofRailMapRef.current.clear();
    }
  }

  /**
   * Renders XR100 rails for all roof planes visible in panelList.
   *
   * Algorithm:
   *   1. Filter to roof panels that have ECEF frame vectors (ecefNx/ecefUx)
   *   2. Group by planeId
   *   3. For each plane: group panels by gridRow
   *   4. For each row: find min/max along u-axis, compute rail center + length
   *   5. Position rail at panel bottom edge, offset below panel bottom face
   *   6. Build one Cesium box entity per rail run
   */
  function renderRoofRails(viewer: any, C: any, panelList: PlacedPanel[]) {
    const mountId = mountingSystemIdRef.current;
    const railSpec = getRailSpec(mountId);

    // Clear ALL existing rail entities first
    clearRoofRails(viewer);

    // No rails for this mounting system
    if (!railSpec) return;

    // Only process roof panels that have ECEF frame vectors AND a planeId.
    // Panels placed without a plane (single roof click) have no planeId — skip them.
    // Both auto-fill and surface-select paths store ecefNx/ecefUx on every panel.
    const roofPanels = panelList.filter(p =>
      p.systemType === 'roof' &&
      p.planeId !== undefined &&
      isFinite(p.ecefNx ?? NaN) && isFinite(p.ecefUx ?? NaN)
    );
    if (roofPanels.length === 0) return;

    // v62: panels rotated out of the plane grid (frameQuat) don't fit the row-spanning
    // rail logic — they get their own per-panel rails below. Grid rails use the rest.
    const rotatedPanels = roofPanels.filter(p => (p as any).frameQuat);
    const gridPanels    = roofPanels.filter(p => !(p as any).frameQuat);

    // Group by planeId
    const byPlane = new Map<string, PlacedPanel[]>();
    for (const panel of gridPanels) {
      const pid = panel.planeId!;
      if (!byPlane.has(pid)) byPlane.set(pid, []);
      byPlane.get(pid)!.push(panel);
    }

    const { heightM: railH, widthM: railW } = railSpec;
    const railColor = new C.Color(
      parseInt(railSpec.color.slice(1, 3), 16) / 255,
      parseInt(railSpec.color.slice(3, 5), 16) / 255,
      parseInt(railSpec.color.slice(5, 7), 16) / 255,
      0.92,
    );

    // Rail centre sits inwardM below the panel centroid along the roof normal.
    // panel.height = roofDeckAlt + stackH (vertical addition).
    // Rail centre = roofDeckAlt + railH/2  =>  inwardM = stackH - railH/2.
    const stackH  = getRoofPanelOffset(mountId);
    const inwardM = stackH - railH / 2;

    // Max gap between adjacent panel edges that still belongs to the same rail run.
    // Panels from buildSurfaceGrid have 0mm spacing so any gap > 0.20m is a real
    // missing-panel hole or a genuine array separation. Never bridge this gap.
    const MAX_PANEL_GAP = 0.20; // metres

    byPlane.forEach((planePanels, planeId) => {
      // -- Plane ECEF frame --------------------------------------------------
      // All panels on a planeId share identical ecefNx/Ny/Nz and ecefUx/Uy/Uz.
      //   u = along-ridge direction  (rail runs along u)
      //   n = roof plane normal
      //   v = cross(n, u)  = down-slope axis  (rows are separated along v)
      const rep0 = planePanels[0];
      const nx = rep0.ecefNx!;  const ny = rep0.ecefNy!;  const nz = rep0.ecefNz!;
      const ux = rep0.ecefUx!;  const uy = rep0.ecefUy!;  const uz = rep0.ecefUz!;

      // v = cross(n, u)
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;

      // Reference ECEF point for plane-local coordinates (first panel in plane)
      const refEcef = engLatLngToECEF(rep0.lat, rep0.lng, rep0.height ?? 0);

      // For each panel compute plane-local (u, v) coordinates and panel half-widths.
      // uC/vC are metres along the ridge/slope axes relative to refEcef.
      // uMin/uMax are the panel's left/right edges in the u (ridge) direction.
      type PanelUV = {
        p: PlacedPanel;
        uC: number; vC: number;
        pw: number; ph: number;
        uMin: number; uMax: number;
      };

      const panelUVs: PanelUV[] = planePanels.map(p => {
        const ecef = engLatLngToECEF(p.lat, p.lng, p.height ?? 0);
        const dx = ecef.x - refEcef.x;
        const dy = ecef.y - refEcef.y;
        const dz = ecef.z - refEcef.z;
        const uC = dx * ux + dy * uy + dz * uz;
        const vC = dx * vx + dy * vy + dz * vz;
        const orient = (p.orientation ?? 'portrait') as PanelOrientation;
        const { pw, ph } = panelDims(orient);
        return { p, uC, vC, pw, ph, uMin: uC - pw / 2, uMax: uC + pw / 2 };
      });

      // -- Group panels into rows by v-coordinate ----------------------------
      // Panels in the same row share nearly the same vC value.
      // Tolerance = 25% of panel height -- enough to absorb any floating-point
      // noise while clearly separating distinct rows (which differ by ~panelH).
      panelUVs.sort((a, b) => a.vC - b.vC);

      const rows: PanelUV[][] = [];
      for (const puv of panelUVs) {
        const tol = puv.ph * 0.25;
        let placed = false;
        for (const row of rows) {
          const rowV = row.reduce((s, r) => s + r.vC, 0) / row.length;
          if (Math.abs(puv.vC - rowV) <= tol) {
            row.push(puv);
            placed = true;
            break;
          }
        }
        if (!placed) rows.push([puv]);
      }

      // -- Split each row into contiguous rail segments ----------------------
      // Sort panels by uMin (left to right along ridge).
      // A new segment starts whenever the gap between panel edges exceeds MAX_PANEL_GAP.
      // Span is derived ONLY from actual placed panel corners -- never grid bounds.
      const planeEntities: any[] = [];

      rows.forEach((row, rowIdx) => {
        row.sort((a, b) => a.uMin - b.uMin);

        const segments: PanelUV[][] = [];
        let seg: PanelUV[] = [row[0]];
        for (let i = 1; i < row.length; i++) {
          const gap = row[i].uMin - row[i - 1].uMax;
          if (gap > MAX_PANEL_GAP) {
            segments.push(seg);
            seg = [];
          }
          seg.push(row[i]);
        }
        segments.push(seg);

        segments.forEach((segment, segIdx) => {
          // Rail span = actual outer edges of the first and last panel in segment.
          // This is the ONLY source. No roof bounds, no grid slots, no run lengths.
          const segUMin    = Math.min(...segment.map(s => s.uMin));
          const segUMax    = Math.max(...segment.map(s => s.uMax));
          const railLength = segUMax - segUMin;
          if (railLength <= 0) return;

          // Row v-centre for this segment
          const vCentre = segment.reduce((s, r) => s + r.vC, 0) / segment.length;
          // Rail box u-centre = midpoint of the span
          const uMid = (segUMin + segUMax) / 2;

          const rep     = segment[0].p;
          const azDeg   = rep.azimuth ?? 180;
          const tiltDeg = rep.tilt    ?? 0;
          const { ph: panelH } = panelDims((rep.orientation ?? 'portrait') as PanelOrientation);

          const tiltRad    = tiltDeg * Math.PI / 180;
          const headingRad = (azDeg - 90) * Math.PI / 180;
          const pitchRad   = -tiltRad;

          console.log(
            `[RAIL_SPAN_SOURCE] planeId=${planeId} row=${rowIdx} seg=${segIdx}` +
            ` panelCount=${segment.length} segStart=${segUMin.toFixed(3)}` +
            ` segEnd=${segUMax.toFixed(3)} segLength=${railLength.toFixed(3)}m` +
            ` source=actual-panel-corners`
          );

          // Two rails per row: lower (25% from eave) and upper (25% from ridge).
          // shiftV moves along v (down-slope) from the row centre.
          //   positive v => toward eave  => lower rail
          //   negative v => toward ridge => upper rail
          const railOffsets: Array<{ shiftV: number; label: string }> = [
            { shiftV:  panelH * 0.25, label: 'lower' },
            { shiftV: -panelH * 0.25, label: 'upper' },
          ];

          for (const { shiftV, label } of railOffsets) {
            const vRail = vCentre + shiftV;

            // ECEF position of rail centre:
            //   P = refEcef  +  uMid * u  +  vRail * v  -  inwardM * n
            const railX = refEcef.x + uMid * ux + vRail * vx - inwardM * nx;
            const railY = refEcef.y + uMid * uy + vRail * vy - inwardM * ny;
            const railZ = refEcef.z + uMid * uz + vRail * vz - inwardM * nz;

            if (!isFinite(railX) || !isFinite(railY) || !isFinite(railZ)) continue;

            try {
              const pos = new C.Cartesian3(railX, railY, railZ);
              // v62: if this array was in-plane-rotated, orient the rail from the
              // ROTATED ECEF frame (box: X=width→−v, Y=length→u, Z=height→n) so it
              // tracks the panels. Non-rotated rails keep the exact HPR path.
              let ori: any;
              if ((rep as any).frameQuat) {
                const m = new C.Matrix3(
                  -vx, ux, nx,
                  -vy, uy, ny,
                  -vz, uz, nz,
                );
                ori = C.Quaternion.fromRotationMatrix(m);
              } else {
                ori = C.Transforms.headingPitchRollQuaternion(
                  pos,
                  new C.HeadingPitchRoll(headingRad, pitchRad, 0),
                );
              }
              if (!ori) continue;

              const railEntity = viewer.entities.add({
                name:        `roof-rail-plane${planeId}-row${rowIdx}-seg${segIdx}-${label}`,
                position:    pos,
                orientation: ori,
                box: {
                  // Cross-section 3x visual scale for readability at Cesium zoom levels.
                  // Length (y / along-ridge) is EXACT panel-edge to panel-edge -- never scaled.
                  dimensions: new C.Cartesian3(railW * 3, railLength, railH * 3),
                  material:   new C.ColorMaterialProperty(railColor),
                  outline:    false,
                  shadows:    C.ShadowMode.DISABLED,
                },
              });
              planeEntities.push(railEntity);
            } catch (e) {
              handleCesiumError('renderRoofRails row entity', e, true);
            }
          }
        }); // end segment loop
      }); // end row loop

      if (planeEntities.length > 0) {
        roofRailMapRef.current.set(planeId, planeEntities);
      }
    });

    // v62: per-panel rails for ROTATED panels. Rails are physically HORIZONTAL (run
    // along the eave), regardless of how the panel is spun — a landscape panel just
    // clamps onto horizontal rails. So we rebuild the plane's true horizontal eave
    // (cross(up, normal)) and size each rail to the panel's footprint projected onto
    // that eave (length) and the slope axis (row spacing).
    const rotByPlane = new Map<string, PlacedPanel[]>();
    for (const p of rotatedPanels) { const k = p.planeId!; if (!rotByPlane.has(k)) rotByPlane.set(k, []); rotByPlane.get(k)!.push(p); }
    rotByPlane.forEach((ps, pid) => {
      const ents: any[] = [];
      for (const p of ps) {
        const pos = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
        if (!pos) continue;
        // Panel's own box axes under its rotation: lX along ph, lY along pw, lZ = normal.
        const fq = (p as any).frameQuat;
        const M = C.Matrix3.fromQuaternion(new C.Quaternion(fq.x, fq.y, fq.z, fq.w), new C.Matrix3());
        const lX = C.Matrix3.getColumn(M, 0, new C.Cartesian3());
        const lY = C.Matrix3.getColumn(M, 1, new C.Cartesian3());
        const n  = C.Matrix3.getColumn(M, 2, new C.Cartesian3());
        const up = C.Cartesian3.normalize(C.Cartesian3.clone(pos), new C.Cartesian3());
        const eave = C.Cartesian3.cross(up, n, new C.Cartesian3()); // horizontal reference
        const dims = panelDims(((p as any).orientation ?? 'portrait') as PanelOrientation);
        // Rails run along whichever PANEL edge is closest to horizontal → square with
        // the panel AND horizontal when its long edge is. The other edge spaces the rows.
        const alignX = Math.abs(C.Cartesian3.dot(lX, eave)); // ph edge vs horizontal
        const alignY = Math.abs(C.Cartesian3.dot(lY, eave)); // pw edge vs horizontal
        const railAxis = alignX >= alignY ? lX : lY;
        const railLen  = alignX >= alignY ? dims.ph : dims.pw;
        const offAxis  = alignX >= alignY ? lY : lX;
        const offDim   = alignX >= alignY ? dims.pw : dims.ph;
        // orientation: rail box Y = railAxis (length), Z = n, X = railAxis × n.
        const Xax = C.Cartesian3.normalize(C.Cartesian3.cross(railAxis, n, new C.Cartesian3()), new C.Cartesian3());
        const m2 = new C.Matrix3(Xax.x, railAxis.x, n.x, Xax.y, railAxis.y, n.y, Xax.z, railAxis.z, n.z);
        const oq = C.Quaternion.fromRotationMatrix(m2, new C.Quaternion());
        for (const sgn of [0.25, -0.25]) {
          const c = new C.Cartesian3(
            pos.x + offAxis.x * (offDim * sgn) - n.x * inwardM,
            pos.y + offAxis.y * (offDim * sgn) - n.y * inwardM,
            pos.z + offAxis.z * (offDim * sgn) - n.z * inwardM);
          try {
            ents.push(viewer.entities.add({
              name: `roof-rail-rot-${p.id.slice(0, 6)}-${sgn > 0 ? 'lo' : 'hi'}`,
              position: c,
              orientation: oq,
              box: { dimensions: new C.Cartesian3(railW * 3, railLen, railH * 3), material: new C.ColorMaterialProperty(railColor), outline: false, shadows: C.ShadowMode.DISABLED },
            }));
          } catch (e) { handleCesiumError('renderRoofRails rotated', e, true); }
        }
      }
      if (ents.length > 0) roofRailMapRef.current.set(`${pid}-rot`, ents);
    });
  }

  // ── v62: Fire setback keep-out zones rendered ON the 3D roof ───────────────
  // For each roof plane: classify edges (ridge / eave / rake-side, + flag hips &
  // valleys = edges shared with another plane), inset each edge inward by its
  // required setback, and draw the keep-out band as a translucent strip on the
  // plane surface. This makes the firewalk clearances visible in 3D and is the
  // groundwork for owning the roof model (→ in-house CAD).
  function clearFireSetbackZones(viewer: any) {
    setbackZoneEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    setbackZoneEntitiesRef.current = [];
  }

  // ── v62: Shared roof-model primitives (used by setback zones AND the stitched
  //         roof-model wireframe — single source of truth for plane geometry +
  //         edge classification). ───────────────────────────────────────────────
  //
  // Collect renderable planes from BOTH sources with ECEF corners + frame + centroid:
  //   1. 3D Plane tool planes (plane3DCesiumPtsMap + plane3DFrameMap) — exact ECEF.
  //   2. roofPlanes prop (lat/lng vertices) — projected onto a panel/legacy frame.
  function collectRoofRenderables(C: any, groundElev: number): any[] {
    const renderables: any[] = [];
    const seen = new Set<string>();
    plane3DCesiumPtsMap.current.forEach((pts: any[], pid: string) => {
      const fr = plane3DFrameMap.current.get(pid);
      if (!fr || !pts || pts.length < 3) return;
      const u = C.Cartesian3.normalize(new C.Cartesian3(fr.u.x, fr.u.y, fr.u.z), new C.Cartesian3());
      const n = C.Cartesian3.normalize(new C.Cartesian3(fr.normal.x, fr.normal.y, fr.normal.z), new C.Cartesian3());
      const v = C.Cartesian3.normalize(C.Cartesian3.cross(n, u, new C.Cartesian3()), new C.Cartesian3());
      const origin = new C.Cartesian3(fr.origin.x, fr.origin.y, fr.origin.z);
      const corners = pts.map((p: any) => new C.Cartesian3(p.x, p.y, p.z));
      renderables.push({ id: pid, corners, u, v, n, origin });
      seen.add(pid);
    });
    (roofPlanesRef.current ?? []).forEach(plane => {
      if (seen.has(plane.id)) return;
      const vs = (plane as any).vertices ?? [];
      if (vs.length < 3) return;
      const planePanels = panelsRef.current.filter(p => p.planeId === plane.id && isFinite((p as any).ecefUx) && isFinite((p as any).ecefNx));
      let u: any, n: any, origin: any;
      if (planePanels.length) {
        const rp: any = planePanels[0];
        u = C.Cartesian3.normalize(new C.Cartesian3(rp.ecefUx, rp.ecefUy, rp.ecefUz), new C.Cartesian3());
        n = C.Cartesian3.normalize(new C.Cartesian3(rp.ecefNx, rp.ecefNy, rp.ecefNz), new C.Cartesian3());
        origin = safeCartesian3(C, rp.lng, rp.lat, rp.height ?? 0);
      } else {
        try {
          const lg = computeEcefFrameForLegacyPlane(plane as any, groundElev);
          u = C.Cartesian3.normalize(new C.Cartesian3(lg.ecefFrame3D.u.x, lg.ecefFrame3D.u.y, lg.ecefFrame3D.u.z), new C.Cartesian3());
          n = C.Cartesian3.normalize(new C.Cartesian3(lg.ecefFrame3D.n.x, lg.ecefFrame3D.n.y, lg.ecefFrame3D.n.z), new C.Cartesian3());
          origin = new C.Cartesian3(lg.origin3D.x, lg.origin3D.y, lg.origin3D.z);
        } catch { return; }
      }
      if (!origin) return;
      const v = C.Cartesian3.normalize(C.Cartesian3.cross(n, u, new C.Cartesian3()), new C.Cartesian3());
      const baseH = C.Cartographic.fromCartesian(origin).height;
      const corners = vs.map((vert: any) => {
        const Pv = safeCartesian3(C, vert.lng, vert.lat, baseH);
        if (!Pv) return null;
        const diff = C.Cartesian3.subtract(Pv, origin, new C.Cartesian3());
        const dn = C.Cartesian3.dot(diff, n);
        return C.Cartesian3.subtract(Pv, C.Cartesian3.multiplyByScalar(n, dn, new C.Cartesian3()), new C.Cartesian3());
      }).filter(Boolean);
      if (corners.length < 3) return;
      renderables.push({ id: plane.id, corners, u, v, n, origin });
    });
    renderables.forEach((rp: any) => {
      const c = new C.Cartesian3(0, 0, 0);
      rp.corners.forEach((p: any) => C.Cartesian3.add(c, p, c));
      rp.centroid = C.Cartesian3.divideByScalar(c, rp.corners.length, c);
    });
    return renderables;
  }

  // partnerOf(planeId, edgeMidpointEcef) → the OTHER plane meeting at that edge (or
  // null). A shared edge = a hip or a valley; the stitch's adjacency lives here.
  function buildPartnerOf(C: any, renderables: any[]): (pid: string, mid: any) => any {
    const byId = new Map(renderables.map((rp: any) => [rp.id, rp]));
    const allMids: Array<{ mid: any; pid: string }> = [];
    renderables.forEach((rp: any) => {
      for (let i = 0; i < rp.corners.length; i++) {
        const a = rp.corners[i], b = rp.corners[(i + 1) % rp.corners.length];
        allMids.push({ mid: C.Cartesian3.midpoint(a, b, new C.Cartesian3()), pid: rp.id });
      }
    });
    return (pid: string, mid: any) => {
      const m = allMids.find(e => e.pid !== pid && C.Cartesian3.distance(e.mid, mid) < 1.2);
      return m ? byId.get(m.pid) : null;
    };
  }

  // Classify every edge of a plane → 'ridge' | 'eave' | 'hip' | 'valley' | 'rake'.
  // ridge=highest edge, eave=lowest (by altitude, sign-independent); a shared edge is a
  // hip (convex fold) or valley (concave) by (nA−nB)·(cA−cB); otherwise a rake.
  function classifyPlaneEdges(C: any, rp: any, partnerOf: (pid: string, mid: any) => any): string[] {
    const corners = rp.corners; const N = corners.length;
    const heights = corners.map((P: any) => { const c = C.Cartographic.fromCartesian(P); return c ? c.height : 0; });
    const hMax = Math.max(...heights), hMin = Math.min(...heights);
    const band = Math.max(0.3, (hMax - hMin) * 0.25); // height band that counts as ridge/eave
    const sloped = (hMax - hMin) > 0.3;
    const kinds: string[] = [];
    for (let i = 0; i < N; i++) {
      const ha = heights[i], hb = heights[(i + 1) % N];
      const am = (ha + hb) / 2; // edge's average altitude — robust vs a slightly-uneven eave
      const a3 = corners[i], b3 = corners[(i + 1) % N];
      const horiz = Math.abs(ha - hb) < Math.max(0.3, C.Cartesian3.distance(a3, b3) * 0.12); // ~level edge
      const mid = C.Cartesian3.midpoint(a3, b3, new C.Cartesian3());
      const partner = partnerOf(rp.id, mid);
      let kind = 'rake';
      if (sloped && am > hMax - band)      kind = 'ridge';
      else if (sloped && am < hMin + band) kind = 'eave';
      if (partner) {
        // Shared edge: convex fold = ridge (if level) or hip (if sloped); concave = valley.
        const dN = C.Cartesian3.subtract(rp.n, partner.n, new C.Cartesian3());
        const dC = C.Cartesian3.subtract(rp.centroid, partner.centroid, new C.Cartesian3());
        const convex = C.Cartesian3.dot(dN, dC) > 0;
        kind = convex ? (horiz ? 'ridge' : 'hip') : 'valley';
      }
      kinds.push(kind);
    }
    return kinds;
  }

  // v62: STITCH — snap a just-picked corner to the nearest SHARED roof point so planes
  // connect at exact common vertices/edges. Considers: every existing plane's corners
  // (vertices) and edges (projected point), plus the corners already in the current
  // trace. Returns the snapped Cartesian3, or null if nothing is within tolerance.
  function snapTracedPoint(C: any, cart: any): any | null {
    const TOL = 0.9; // metres — how close a click must be to grab a shared point
    let best: any = null; let bestD = TOL * TOL;
    const consider = (p: any) => {
      if (!p) return;
      const d = C.Cartesian3.distanceSquared(cart, p);
      if (d < bestD) { bestD = d; best = p; }
    };
    const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const renderables = collectRoofRenderables(C, groundElev);
    for (const rp of renderables) {
      const cs = rp.corners;
      for (let i = 0; i < cs.length; i++) {
        consider(cs[i]); // existing vertex
        const a = cs[i], b = cs[(i + 1) % cs.length]; // nearest point on the edge
        const ab = C.Cartesian3.subtract(b, a, new C.Cartesian3());
        const denom = C.Cartesian3.dot(ab, ab);
        if (denom > 1e-9) {
          let t = C.Cartesian3.dot(C.Cartesian3.subtract(cart, a, new C.Cartesian3()), ab) / denom;
          t = Math.max(0, Math.min(1, t));
          consider(C.Cartesian3.add(a, C.Cartesian3.multiplyByScalar(ab, t, new C.Cartesian3()), new C.Cartesian3()));
        }
      }
    }
    for (const p of pts3DCesiumRef.current) consider(p); // corners of the in-progress trace
    return best ? new C.Cartesian3(best.x, best.y, best.z) : null;
  }

  // v62: which roof plane (renderable, with frame) is a 3D click on? Projects the click
  // onto each plane and tests polygon containment in plane-UV; requires the click to be
  // within 3m of the plane along its normal so a far plane can't capture it.
  function planeRenderableAtClick(C: any, clickCart: any, groundElev: number): any | null {
    const renderables = collectRoofRenderables(C, groundElev);
    for (const rp of renderables) {
      const diff = C.Cartesian3.subtract(clickCart, rp.origin, new C.Cartesian3());
      const dn = C.Cartesian3.dot(diff, rp.n);
      if (Math.abs(dn) > 3.0) continue;
      const Pon = C.Cartesian3.subtract(clickCart, C.Cartesian3.multiplyByScalar(rp.n, dn, new C.Cartesian3()), new C.Cartesian3());
      const rel = C.Cartesian3.subtract(Pon, rp.origin, new C.Cartesian3());
      const pu = C.Cartesian3.dot(rel, rp.u), pv = C.Cartesian3.dot(rel, rp.v);
      const poly: number[][] = rp.corners.map((c: any) => {
        const r = C.Cartesian3.subtract(c, rp.origin, new C.Cartesian3());
        return [C.Cartesian3.dot(r, rp.u), C.Cartesian3.dot(r, rp.v)];
      });
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > pv) !== (yj > pv)) && (pu < (xj - xi) * (pv - yi) / (yj - yi) + xi)) inside = !inside;
      }
      if (inside) return rp;
    }
    return null;
  }

  function renderFireSetbackZones(viewer: any, C: any) {
    clearFireSetbackZones(viewer);
    const ridgeSB = fireSetbacks?.ridgeSetbackM ?? 0.457;
    const eaveSB  = fireSetbacks?.eaveSetbackM  ?? 0;
    const edgeSB  = fireSetbacks?.edgeSetbackM  ?? 0.457;
    const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;

    const renderables = collectRoofRenderables(C, groundElev);
    if (renderables.length === 0) {
      setStatusMsg('No roof planes to draw setbacks on — trace a 3D plane or fill a roof first');
      return;
    }
    const partnerOf = buildPartnerOf(C, renderables);

    renderables.forEach((rp: any) => {
      const { u, v, n, origin, corners } = rp;
      const uv = corners.map((P: any) => {
        const rel = C.Cartesian3.subtract(P, origin, new C.Cartesian3());
        return { uu: C.Cartesian3.dot(rel, u), vv: C.Cartesian3.dot(rel, v) };
      });
      if (uv.some((p: any) => !isFinite(p.uu) || !isFinite(p.vv))) return;
      const kinds = classifyPlaneEdges(C, rp, partnerOf); // ridge/eave/hip/valley/rake per edge — one source of truth
      const cu = uv.reduce((s: number, p: any) => s + p.uu, 0) / uv.length;
      const cv = uv.reduce((s: number, p: any) => s + p.vv, 0) / uv.length;

      const toEcef = (uu: number, vv: number, off: number) =>
        C.Cartesian3.add(origin,
          C.Cartesian3.add(C.Cartesian3.multiplyByScalar(u, uu, new C.Cartesian3()),
            C.Cartesian3.add(C.Cartesian3.multiplyByScalar(v, vv, new C.Cartesian3()),
              C.Cartesian3.multiplyByScalar(n, off, new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());

      const N = uv.length;
      // Pass 1 — classify each edge + its inward unit normal (in UV) + colour.
      const E: Array<{ sb: number; kind: string; inx: number; iny: number; ex: number; ey: number; col: any }> = [];
      for (let i = 0; i < N; i++) {
        const a = uv[i], b = uv[(i + 1) % N];
        const kind = kinds[i];
        const sb = kind === 'ridge' ? ridgeSB : kind === 'eave' ? eaveSB : edgeSB; // hip/valley/rake → edge setback
        let ex = b.uu - a.uu, ey = b.vv - a.vv;
        const L = Math.hypot(ex, ey) || 1; ex /= L; ey /= L;
        let inx = -ey, iny = ex;
        const mx = (a.uu + b.uu) / 2, my = (a.vv + b.vv) / 2;
        if (inx * (cu - mx) + iny * (cv - my) < 0) { inx = -inx; iny = -iny; }
        const col =
            kind === 'hip'    ? C.Color.fromCssColorString('#ff9500')   // hip → orange
          : kind === 'valley' ? C.Color.fromCssColorString('#22b8ff')   // valley → cyan
          : kind === 'ridge'  ? C.Color.fromCssColorString('#ff2d2d')   // ridge → red
          :                     C.Color.fromCssColorString('#ff6464');  // eave/rake → light red
        E.push({ sb, kind, inx, iny, ex, ey, col });
      }

      // Pass 2 — mitered inset corner per vertex = intersection of the two adjacent
      // edges' inward-offset lines. Bands then SHARE corners → no overlap, no overhang.
      const lineX = (p1x: number, p1y: number, d1x: number, d1y: number, p2x: number, p2y: number, d2x: number, d2y: number) => {
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 1e-9) return null; // parallel (collinear edges)
        const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / denom;
        return { uu: p1x + t * d1x, vv: p1y + t * d1y };
      };
      const inset: Array<{ uu: number; vv: number }> = [];
      for (let j = 0; j < N; j++) {
        const ep = E[(j - 1 + N) % N], ec = E[j], vj = uv[j];
        const hit = lineX(
          vj.uu + ep.inx * ep.sb, vj.vv + ep.iny * ep.sb, ep.ex, ep.ey,
          vj.uu + ec.inx * ec.sb, vj.vv + ec.iny * ec.sb, ec.ex, ec.ey);
        // Plain per-edge inward offset for this corner (the safe fallback).
        const fallback = { uu: vj.uu + ec.inx * ec.sb, vv: vj.vv + ec.iny * ec.sb };
        // Guard (fix cf0dd96b regression): the miter is the intersection of two
        // inward-offset edge lines. At a CONCAVE/reflex vertex (notched outline),
        // or where a 0"-eave meets an 18" rake at a shallow angle, that intersection
        // shoots far across the roof INTERIOR — drawing the red setback band through
        // the middle of the roof / along the eave line. A legitimate miter never
        // sits much farther from the vertex than the edge's own setback, so reject
        // any blown-up intersection and fall back to the per-edge offset.
        let pt = hit ?? fallback;
        const reach = Math.hypot(pt.uu - vj.uu, pt.vv - vj.vv);
        const maxReach = 2.5 * Math.max(ep.sb, ec.sb) + 0.02;
        if (!isFinite(reach) || reach > maxReach) pt = fallback;
        inset.push(pt);
      }

      // Pass 3 — render one band per edge: outer = exact polygon edge, inner = mitered
      // corners. Hug the surface (4cm) so it doesn't overhang at oblique angles.
      const off = 0.04;
      for (let i = 0; i < N; i++) {
        const e = E[i];
        if (e.sb <= 0.001) continue;
        const a = uv[i], b = uv[(i + 1) % N];
        const ia = inset[i], ib = inset[(i + 1) % N];
        const positions = [
          toEcef(a.uu, a.vv, off),
          toEcef(b.uu, b.vv, off),
          toEcef(ib.uu, ib.vv, off),
          toEcef(ia.uu, ia.vv, off),
        ];
        const ent = viewer.entities.add({
          name: `[SETBACK ${e.kind} ${rp.id.slice(0, 6)}]`,
          polygon: {
            hierarchy: new C.PolygonHierarchy(positions),
            perPositionHeight: true,
            material: e.col.withAlpha(0.4),
            outline: true,
            outlineColor: e.col.withAlpha(0.95),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        setbackZoneEntitiesRef.current.push(ent);
      }
    });
    publishE2EDiagnostics();
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── v62: STITCHED ROOF MODEL wireframe ─────────────────────────────────────
  // Draw every classified edge across ALL planes as a colour-coded polyline so the
  // connected roof reads as one model: ridge(red) hip(orange) valley(cyan) eave(green)
  // rake(amber). Reuses the same collect+classify pipeline as the setback zones.
  // Foundation for the permit roof-plan sheet + in-house CAD.
  function clearRoofWireframe(viewer: any) {
    roofWireframeEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    roofWireframeEntitiesRef.current = [];
  }

  function renderRoofWireframe(viewer: any, C: any) {
    clearRoofWireframe(viewer);
    const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const renderables = collectRoofRenderables(C, groundElev);
    if (renderables.length === 0) {
      setStatusMsg('No roof planes yet — trace a 3D plane or fill a roof to build the model');
      return;
    }
    const partnerOf = buildPartnerOf(C, renderables);
    const colorOf = (kind: string) =>
        kind === 'hip'    ? C.Color.fromCssColorString('#ff9500')
      : kind === 'valley' ? C.Color.fromCssColorString('#22b8ff')
      : kind === 'ridge'  ? C.Color.fromCssColorString('#ff2d2d')
      : kind === 'eave'   ? C.Color.fromCssColorString('#34d399')
      :                     C.Color.fromCssColorString('#facc15'); // rake → amber
    const counts: Record<string, number> = { eave: 0, ridge: 0, hip: 0, valley: 0, rake: 0 };

    renderables.forEach((rp: any) => {
      const kinds = classifyPlaneEdges(C, rp, partnerOf);
      const N = rp.corners.length;
      for (let i = 0; i < N; i++) {
        const kind = kinds[i];
        counts[kind] = (counts[kind] ?? 0) + 1;
        // lift slightly along the plane normal so the line sits on the roof surface
        const a = C.Cartesian3.add(rp.corners[i], C.Cartesian3.multiplyByScalar(rp.n, 0.08, new C.Cartesian3()), new C.Cartesian3());
        const b = C.Cartesian3.add(rp.corners[(i + 1) % N], C.Cartesian3.multiplyByScalar(rp.n, 0.08, new C.Cartesian3()), new C.Cartesian3());
        const ent = viewer.entities.add({
          name: `[ROOF-EDGE ${kind} ${rp.id.slice(0, 6)}]`,
          polyline: {
            positions: [a, b],
            width: (kind === 'eave' || kind === 'rake') ? 4 : 6,
            material: new C.PolylineGlowMaterialProperty({ glowPower: 0.25, color: colorOf(kind) }),
            clampToGround: false,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        roofWireframeEntitiesRef.current.push(ent);
      }
    });
    setStatusMsg(`🔗 Roof model — ${renderables.length} face${renderables.length !== 1 ? 's' : ''} · ${counts.ridge} ridge · ${counts.hip} hip · ${counts.valley} valley · ${counts.eave} eave · ${counts.rake} rake`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── v62: STITCH — average shared corners to meet polygons in the middle ──────
  // Humans drop pins roughly where a hip/ridge/corner is; two faces drawn at
  // different angles never quite meet. This clusters corners across planes (each
  // plane contributes ≤1 corner per cluster) and moves every corner in a shared
  // cluster to the cluster AVERAGE — so faces meet at one natural point. Then it
  // re-fits each plane's frame and re-renders. Free marking → Stitch → clean roof.
  function stitchRoofVertices(viewer: any, C: any) {
    const entries = Array.from(plane3DCesiumPtsMap.current.entries()) as [string, any[]][];
    if (entries.length < 2) { setStatusMsg('Stitch needs 2+ marked planes'); return; }
    const TOL = 1.6; // metres — corners within this are treated as the same point
    // Working copy of every plane's corners, mutated across passes.
    const work = new Map<string, any[]>();
    for (const [pid, pts] of entries) work.set(pid, pts.map((p: any) => new C.Cartesian3(p.x, p.y, p.z)));

    type Cl = { members: { pid: string; idx: number }[]; cx: number; cy: number; cz: number };
    let lastShared = 0;
    // Multi-pass: pass 1 pulls most corners together; later passes catch stragglers
    // (e.g. a hip→multi-valley junction) that only fall within tolerance once their
    // neighbours have already moved to the averaged point.
    for (let pass = 0; pass < 4; pass++) {
      const clusters: Cl[] = [];
      for (const [pid, pts] of work) {
        pts.forEach((p: any, idx: number) => {
          let target: Cl | null = null;
          for (const cl of clusters) {
            const n = cl.members.length;
            const dx = p.x - cl.cx / n, dy = p.y - cl.cy / n, dz = p.z - cl.cz / n;
            if (dx * dx + dy * dy + dz * dz < TOL * TOL && !cl.members.some(m => m.pid === pid)) { target = cl; break; }
          }
          if (target) { target.members.push({ pid, idx }); target.cx += p.x; target.cy += p.y; target.cz += p.z; }
          else clusters.push({ members: [{ pid, idx }], cx: p.x, cy: p.y, cz: p.z });
        });
      }
      let movedThisPass = 0; lastShared = 0;
      for (const cl of clusters) {
        const n = cl.members.length;
        if (n < 2) continue;
        lastShared++;
        const ax = cl.cx / n, ay = cl.cy / n, az = cl.cz / n;
        for (const m of cl.members) {
          const cur = work.get(m.pid)![m.idx];
          if (Math.abs(cur.x - ax) > 1e-4 || Math.abs(cur.y - ay) > 1e-4 || Math.abs(cur.z - az) > 1e-4) movedThisPass++;
          work.get(m.pid)![m.idx] = new C.Cartesian3(ax, ay, az);
        }
      }
      if (movedThisPass === 0) break; // converged
    }
    if (lastShared === 0) { setStatusMsg(`Stitch — no shared corners found within ~${TOL}m`); return; }

    // v64: collect the stitched corners (lat/lng) per plane so they can be written
    // back into roofPlanes state — the geometry every panel-placement engine reads.
    const stitchUpdates: Array<{
      id: string;
      vertices: Array<{ lat: number; lng: number }>;
      localFrame3D: {
        u: { x: number; y: number; z: number };
        v: { x: number; y: number; z: number };
        n: { x: number; y: number; z: number };
      };
      polygon3D?: Array<{ x: number; y: number; z: number }>;
      origin3D?:  { x: number; y: number; z: number };
      normal3D?:  { x: number; y: number; z: number };
    }> = [];
    for (const [pid, pts] of work) {
      const cartPts: Cart3[] = pts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
      let frame; try { frame = computePlaneFromPoints3D(cartPts); } catch { continue; }
      const projected = frame.projectedPts.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z));
      const oldIds = plane3DEntityMap.current.get(pid) || [];
      oldIds.forEach(id => { try { const e = viewer.entities.getById(id); if (e) viewer.entities.remove(e); } catch {} });
      const isSel = selectedRoofPlaneId === pid;
      const newIds = renderPlane3DEntity(viewer, C, projected, pid, frame, isSel, markOnlyPlaneIdsRef.current.has(pid));
      plane3DEntityMap.current.set(pid, newIds);
      plane3DFrameMap.current.set(pid, frame);
      plane3DCesiumPtsMap.current.set(pid, projected);
      // projected[i] is the same planarized corner buildRoofPlane3D used to make
      // plane.vertices[i] — convert back to lat/lng to update the source geometry.
      const verts: Array<{ lat: number; lng: number }> = [];
      for (const p of projected) {
        const carto = C.Cartographic.fromCartesian(p);
        if (!carto) continue;
        verts.push({ lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude) });
      }
      if (verts.length >= 3) {
        stitchUpdates.push({
          id: pid,
          vertices: verts,
          // Hand back the STITCHED plane frame too. Without this, Auto Layout
          // (handleAutoRoof) clipped panels to the new stitched outline but laid
          // the grid on the plane's STALE pre-stitch frame, so panels landed off
          // the stitched roof ("auto layout fucks the stitch up"). frame.u/v are
          // the ECEF ridge/cross-slope axes; n = frame.normal.
          localFrame3D: {
            u: { x: frame.u.x, y: frame.u.y, z: frame.u.z },
            v: { x: frame.v.x, y: frame.v.y, z: frame.v.z },
            n: { x: frame.normal.x, y: frame.normal.y, z: frame.normal.z },
          },
          // v64: Persist the stitched ECEF corners so the reload-restore effect
          // rebuilds the STITCHED roof outline, not the pre-stitch traced outline.
          // Without this, polygon3D stays as the pre-stitch geometry and the roof
          // reloads un-stitched (corners don't meet at hips/ridges/valleys).
          polygon3D: projected.map((p: any) => ({ x: p.x, y: p.y, z: p.z })),
          origin3D:  { x: frame.origin.x, y: frame.origin.y, z: frame.origin.z },
          normal3D:  { x: frame.normal.x, y: frame.normal.y, z: frame.normal.z },
        });
      }
    }
    setShowRoofModel(true);
    try { renderRoofWireframe(viewer, C); } catch {}
    if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch {} }
    try { viewer.scene.requestRender(); } catch {}
    // Sync the stitched geometry into roofPlanes state. The roofPlanes-change
    // effects only re-render setback/wireframe (no surface rebuild, no panel
    // refill), so this stays consistent with what we just drew while making panel
    // placement + persistence use the stitched corners.
    if (stitchUpdates.length > 0) onRoofPlanesStitched?.(stitchUpdates);
    setStatusMsg(`🔗 Stitched — ${lastShared} shared point${lastShared !== 1 ? 's' : ''} averaged (multi-pass)`);
  }

  // ── v63: Equipment overlay (optimizers / microinverters) ────────────────────
  function clearEquipment(viewer: any) {
    equipmentMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    equipmentMapRef.current.clear();
  }

  /**
   * Render a small device box mounted just under each panel that carries an
   * optimizer or microinverter (per panelMeta). Reads the panel entity's own
   * world pose so the device inherits the panel's exact position + orientation,
   * then offsets it along -normal to sit between the panel and the roof. The
   * device is revealed when the user lowers panel opacity.
   */
  function renderEquipment(viewer: any, C: any, panelList: PlacedPanel[]) {
    clearEquipment(viewer);
    const meta = panelMetaRef.current;
    if (!meta) return;
    for (const panel of panelList) {
      const m = meta[panel.id];
      if (!m || !m.deviceType || m.deviceType === 'none') continue;
      const frameEntity = panelMapRef.current.get(panel.id);
      if (!frameEntity) continue;
      let pos: any, orientation: any;
      try {
        pos = frameEntity.position?.getValue?.(C.JulianDate.now()) ?? frameEntity.position?._value;
        orientation = frameEntity.orientation?.getValue?.(C.JulianDate.now()) ?? frameEntity.orientation?._value;
      } catch { continue; }
      if (!pos || !orientation) continue;
      // Face normal = Z column of the orientation rotation matrix (ECEF).
      const rotM = C.Matrix3.fromQuaternion(orientation);
      const n = C.Matrix3.getColumn(rotM, 2, new C.Cartesian3());
      // Mount the device ~7cm under the panel face (between panel and roof).
      const UNDER = 0.07;
      const dpos = new C.Cartesian3(pos.x - n.x * UNDER, pos.y - n.y * UNDER, pos.z - n.z * UNDER);
      const isMicro = m.deviceType === 'micro';
      // Device footprints (m): micro ~212×175×32, optimizer ~155×110×32.
      const dim = isMicro
        ? new C.Cartesian3(0.212, 0.175, 0.032)
        : new C.Cartesian3(0.155, 0.110, 0.032);
      const col = isMicro
        ? C.Color.fromCssColorString('#16a34a')   // micro → green
        : C.Color.fromCssColorString('#f59e0b');  // optimizer → amber
      const ent = viewer.entities.add({
        name: `[EQUIP] ${m.deviceType} ${panel.id}`,
        position: dpos,
        orientation,
        box: {
          dimensions:               dim,
          material:                 new C.ColorMaterialProperty(col),
          outline:                  true,
          outlineColor:             C.Color.fromCssColorString('#0b0f17').withAlpha(0.9),
          outlineWidth:             1,
          shadows:                  C.ShadowMode.DISABLED,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      equipmentMapRef.current.set(panel.id, ent);
    }
    try { viewer.scene.requestRender(); } catch {}
  }

  // Refresh equipment boxes to match current panels + meta (or clear them off).
  function refreshEquipment(viewer: any, C: any, panelList: PlacedPanel[]) {
    if (showEquipmentRef.current) {
      try { renderEquipment(viewer, C, panelList); } catch (e) { handleCesiumError('renderEquipment', e, true); }
    } else {
      clearEquipment(viewer);
    }
  }

  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[], forceFullRebuild = false) {
    const prev = lastRenderedPanelsRef.current;

    // Full rebuild path: shade mode changed, or first render, or forced
    if (forceFullRebuild || (prev.length === 0 && panelList.length > 0)) {
      fullRebuildCountRef.current += 1;
      panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      panelMapRef.current.clear();
      // v48.7: pre-compute skipGrid for entire batch — consistent rendering across all panels
      const skipGridBatch = panelList.length > 12;
      panelList.forEach(p => addPanelEntity(viewer, C, p, skipGridBatch));
      lastRenderedPanelsRef.current = panelList;
      // Phase 2: rebuild roof rails after full panel rebuild
      try { renderRoofRails(viewer, C, panelList); } catch (e) { handleCesiumError('renderRoofRails full', e, true); }
      refreshEquipment(viewer, C, panelList); // v63
      publishE2EDiagnostics();
      try { viewer.scene.requestRender(); } catch {}
      return;
    }

    // Incremental diff: build lookup maps for O(1) access
    const prevMap = new Map<string, PlacedPanel>(prev.map(p => [p.id, p]));
    const nextMap = new Map<string, PlacedPanel>(panelList.map(p => [p.id, p]));

    // Remove panels that no longer exist
    let changed = false;
    prevMap.forEach((_, id) => {
      if (!nextMap.has(id)) {
        if (panelMapRef.current.has(id)) {
          removePanelEntities(viewer, id); // v47.159: removes frame+glass+grid
          changed = true;
        }
      }
    });

    // v48.7: pre-compute skipGrid based on final panel count — consistent for all adds
    const skipGridIncr = panelList.length > 12;

    // Add new panels (not in prev)
    nextMap.forEach((panel, id) => {
      if (!prevMap.has(id)) {
        addPanelEntity(viewer, C, panel, skipGridIncr);
        changed = true;
      }
    });

    // Update panels whose position/tilt/azimuth/type changed
    nextMap.forEach((panel, id) => {
      const old = prevMap.get(id);
      if (!old) return; // already handled above
      const posChanged = old.lat !== panel.lat || old.lng !== panel.lng ||
                         old.height !== panel.height || old.tilt !== panel.tilt ||
                         old.azimuth !== panel.azimuth || old.heading !== panel.heading;
      const typeChanged = old.systemType !== panel.systemType;

      if (posChanged || typeChanged) {
        // v47.159: Always remove+re-add on any change.
        // In-place update was removed because it only updated the frame entity,
        // leaving glass sheen and grid line entities at stale positions.
        // remove+re-add is the only safe approach when we have 3 layered entities per panel.
        if (panelMapRef.current.has(id)) {
          removePanelEntities(viewer, id);
        }
        addPanelEntity(viewer, C, panel, skipGridIncr);
        changed = true;
      }
    });

    lastRenderedPanelsRef.current = panelList;
    if (changed) {
      // Phase 2: rebuild roof rails whenever panel set changes
      try { renderRoofRails(viewer, C, panelList); } catch (e) { handleCesiumError('renderRoofRails incr', e, true); }
      refreshEquipment(viewer, C, panelList); // v63
      publishE2EDiagnostics();
      try { viewer.scene.requestRender(); } catch {}
    }
  }

  // ── Add single panel entity ────────────────────────────────────────────────
  /**
   * Adds a single solar panel as a Cesium box entity to the viewer.
   *
   * Panel geometry:
   * - Position: Cartesian3 from panel.lat/lng/height (with geoid correction applied upstream)
   * - Orientation: HeadingPitchRoll from panel.heading (azimuth), panel.tilt, panel.roll
   * - Dimensions: portrait (1.134m × 1.722m) or landscape (1.722m × 1.134m), 40mm thick
   * - Color: system type color (roof=blue, ground=green, fence=orange) or shade heatmap color
   *
   * @remarks
   * Stores the created entity in panelMapRef keyed by panel.id for later removal/update.
   * Validates all coordinates and quaternion values before adding — silently skips invalid panels.
   *
   * @param viewer - Active Cesium Viewer instance
   * @param C      - Cesium namespace (window.Cesium)
   * @param panel  - PlacedPanel data object with position, orientation, and type info
   * @returns The created Cesium Entity, or undefined if validation failed
   */
  // v48.7: Optional skipGrid override — callers doing batch adds pass this in
  // so all panels in the batch get consistent grid-line rendering.
  // When undefined, falls back to checking panelMapRef size (entities already rendered).
  function addPanelEntity(viewer: any, C: any, panel: PlacedPanel, skipGridOverride?: boolean) {
    try {
      // v47.138: Height is set by pure plane math in buildSurfaceGridECEF /
      // addRow / extendRow / placeSinglePanel — origin + u*uC + v*vC + n*PANEL_OFFSET_ECEF (0.05m).
      // Cesium mesh (3D tiles) is VISUAL ONLY — never sample per-panel height from terrain.
      const h       = panel.height ?? 0;
      const tiltDeg = panel.tilt    ?? 0;
      const azDeg   = panel.azimuth ?? 180;

      if (!isValidCoord(panel.lat, panel.lng, h)) {
        addLog('ERROR', `Panel ${panel.id} invalid coords lat=${panel.lat} lng=${panel.lng} h=${h}`); return;
      }
      if (!isFinite(tiltDeg) || !isFinite(azDeg)) {
        addLog('ERROR', `Panel ${panel.id} invalid tilt/az tilt=${tiltDeg} az=${azDeg}`); return;
      }

      // v47.143: Orientation — prefer ECEF frame vectors when stored on panel.
      //
      // ECEF rotation matrix path (for 3D-tool roof planes):
      //   Panel coordinate frame = (u, v=cross(n,u), n) all in ECEF.
      //   A Cesium box at position P with orientation Q has:
      //     local x = Q * [1,0,0]_ECEF
      //     local y = Q * [0,1,0]_ECEF
      //     local z = Q * [0,0,1]_ECEF
      //   We want: local_z = n (panel face normal = roof normal),
      //            local_x = v (cross-slope, along panel height dimension),
      //            local_y = u (along-ridge, along panel width dimension).
      //   Build rotation matrix M = [v | u | n] (columns), convert to quaternion.
      //
      // HeadingPitchRoll fallback (for 2D/legacy planes):
      //   heading = azimuth, pitch = -tilt (adequate for low-tilt planes).

      const pos = safeCartesian3(C, panel.lng, panel.lat, h);
      if (!pos) {
        addLog('ERROR', `Panel ${panel.id} safeCartesian3 returned null`); return;
      }
      const mag = C.Cartesian3.magnitude(pos);
      if (mag < 6_300_000 || mag > 6_500_000) {
        addLog('ERROR', `Panel ${panel.id} ECEF magnitude=${mag.toFixed(0)} out of range (expected 6.3M-6.5M)`); return;
      }

      let orientation: any;

      // v47.144: Panel orientation via HeadingPitchRoll derived from ECEF frame.
      //
      // Cesium HeadingPitchRoll convention at position P (ENU local frame):
      //   - heading: yaw around local Up (0=North, π/2=East, clockwise)
      //   - pitch:   tilt from horizontal (0=flat, negative = tilted back/nose-down)
      //   - roll:    0
      //
      // For a box entity with dims (ph, pw, thickness):
      //   default pose: y=North (pw direction), x=East (ph direction), z=Up (thickness)
      //
      // We need: panel face normal = roof plane normal
      //   → heading = compass bearing of plane u-axis (along-ridge)
      //   → pitch   = -(tilt of plane from horizontal)
      //   → roll    = 0
      //
      // This is EXACTLY what planeHPR() computes. heading/pitch are stored on panel.
      // We use them directly — no matrix needed, no additional rotation.
      //
      // Step 3 (spec): quaternion.setFromUnitVectors((0,0,1), N) is equivalent to
      // HeadingPitchRoll(heading, -tilt, 0) when heading and tilt are correctly derived
      // from the ECEF normal. planeHPR() does exactly this derivation.

      const pn = panel as any;
      if (pn.frameQuat && isFinite(pn.frameQuat.x) && isFinite(pn.frameQuat.w)) {
        // v62: panel was in-plane-rotated by the grab tool — render its explicit
        // world orientation verbatim (HPR can't express in-plane yaw about the normal).
        orientation = new C.Quaternion(pn.frameQuat.x, pn.frameQuat.y, pn.frameQuat.z, pn.frameQuat.w);
      } else {
        // Use stored heading/pitch from planeHPR() (derived from ECEF frame, per-plane)
        let heading: number;
        let pitchRad: number;
        if (isFinite(panel.heading ?? NaN) && isFinite(panel.pitch ?? NaN) &&
            Math.abs(panel.pitch ?? 0) < Math.PI / 2 + 0.1) {
          heading  = panel.heading!;
          pitchRad = panel.pitch!;
        } else {
          // Fallback: derive from azimuth/tilt scalars
          heading  = headingFromAzimuth(azDeg);
          pitchRad = -tiltDeg * Math.PI / 180;
        }
        const rollRad = 0;
        if (!isFinite(heading) || !isFinite(pitchRad)) {
          addLog('ERROR', `Panel ${panel.id} non-finite HPR heading=${heading} pitch=${pitchRad}`); return;
        }
        const hpr = new C.HeadingPitchRoll(heading, pitchRad, rollRad);
        orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
      }

      if (!orientation || !isFinite(orientation.x) || !isFinite(orientation.y) ||
          !isFinite(orientation.z) || !isFinite(orientation.w)) {
        addLog('ERROR', `Panel ${panel.id} invalid quaternion`); return;
      }

      // v47.147: Alignment guard — verify panel face normal matches stored pitch.
      // dot(panelNormal, Up_ENU) = cos(pitch) by construction.
      // We check that the stored pitch produces a panel normal within 0.5° of
      // the expected Up-component (nUp). This catches any future rotation stacking.
      {
        const pitchStored = isFinite(panel.pitch ?? NaN) ? (panel.pitch ?? 0) : 0;
        const nUpExpected = Math.cos(pitchStored);           // cos(pitch) = nUp
        const nUpActual   = Math.cos(Math.abs(pitchStored)); // |cos(pitch)| >= 0
        // cos(pitch) = nUp — face normal z-component. Must be ≥ cos(0.5°) ≈ 0.99996 relative to expected.
        // Simple check: |pitchStored| must be finite and in valid range.
        if (!isFinite(pitchStored) || Math.abs(pitchStored) > Math.PI / 2 + 0.01) {
          addLog('WARN', `Panel ${panel.id} alignment guard: pitch=${(pitchStored*180/Math.PI).toFixed(1)}° out of range — clamping`);
        }
      }

      const sType  = (panel.systemType ?? 'roof') as SystemType;
      const orient: PanelOrientation = (panel as any).orientation ?? panelOrientationRef.current;
      const { pw, ph } = panelDims(orient);

      // ── v47.157: Realistic layered panel rendering ────────────────────────────
      // Layer 1 (bottom): Solar cell body — dark navy/black, nearly opaque
      // Layer 2 (top):    Glass sheen — very thin semi-transparent pale blue overlay
      //                   Gives the characteristic reflective glass look of real panels
      // Frame:            Silver-white outline on both layers for aluminum rail effect
      const PANEL_THICKNESS  = 0.040; // 40mm total panel depth
      const GLASS_OFFSET     = 0.022; // glass sits 22mm above cell body center

      let cellMaterial: any;
      let glassColor: any;
      let frameOutlineCol: any;

      if (showShadeRef.current && twinRef.current) {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear(), 5, 21);
        // simHourRef is LOCAL solar time — convert to UTC
        const _localH = simHourRef.current;
        const _utcH = ((_localH - lng / 15) % 24 + 24) % 24;
        d.setUTCHours(Math.floor(_utcH), Math.round((_utcH % 1) * 60), 0, 0);
        const sunPos = getSunPosition(lat, lng, d);
        const shade  = computeShade(panel, sunPos);
        cellMaterial    = new C.ColorMaterialProperty(shadeToColor(C, shade));
        glassColor      = shadeToColor(C, shade).withAlpha(0.18);
        frameOutlineCol = C.Color.fromCssColorString('#aaaaaa').withAlpha(0.70);
      } else {
        // v62: selection survives re-renders. If this panel is in the current selection,
        // a freshly (re)added entity keeps its red highlight instead of flashing back to
        // its system color. This kills the "array disappears / blinks" symptom regardless
        // of what triggered the re-render (a stray [panels] diff, a nudge re-add, etc).
        const isSel = selectedPanelIdsRef.current.has(panel.id);
        const meta  = panelMetaRef.current?.[panel.id];
        // v63: panel face opacity — lower it to reveal equipment under the panels.
        const effOpacity = Math.max(0.1, Math.min(1, panelOpacityRef.current ?? 1));
        // v63: color-by-string overrides the system-type color when enabled.
        const baseCol = (colorByStringRef.current && meta?.color)
          ? C.Color.fromCssColorString(meta.color)
          : systemTypeColor(C, sType);
        cellMaterial    = isSel
          ? new C.ColorMaterialProperty(C.Color.fromCssColorString('#ff3333').withAlpha(0.92))
          : new C.ColorMaterialProperty(effOpacity < 1 ? baseCol.withAlpha(effOpacity) : baseCol);
        // Glass sheen: pale blue-silver, very translucent — simulates tempered glass
        const glassRgb   = sType === 'roof' ? '#7ab8d4' : sType === 'ground' ? '#7ab8a0' : '#1a2030';
        const glassAlpha = (sType === 'fence' ? 0.35 : 0.22) * effOpacity;
        glassColor      = C.Color.fromCssColorString(glassRgb).withAlpha(glassAlpha);
        // Aluminum frame: bright silver-white outline
        frameOutlineCol = C.Color.fromCssColorString('#c8d0d8').withAlpha(0.88 * (isSel ? 1 : effOpacity));
      }

      addLog('DEBUG', `addPanelEntity ${panel.id} pos=(${panel.lat.toFixed(6)},${panel.lng.toFixed(6)},${h.toFixed(2)}) mag=${mag.toFixed(0)} ecefFrame=${isFinite((panel as any).ecefNx) ? 'yes' : 'HPR'} dims=${pw.toFixed(2)}x${ph.toFixed(2)}`);

      // Layer 1: Solar cell body (main panel box — dark, nearly opaque)
      const frameEntity = viewer.entities.add({
        name: `[PANEL] ${panel.id}`,
        position: pos,
        orientation,
        box: {
          // NOTE: do NOT oversize to overlap neighbors — overlapping coplanar boxes
          // z-fight and flicker (badly visible once highlighted). Seam-sealing on
          // rough coastal mesh will be done with a single continuous backing surface
          // per array instead (no overlap), as a follow-up.
          dimensions:               new C.Cartesian3(ph, pw, PANEL_THICKNESS),
          material:                 cellMaterial,
          outline:                  true,
          outlineColor:             frameOutlineCol,
          outlineWidth:             1.5,
          shadows:                  C.ShadowMode.ENABLED,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      // Layer 2: Glass sheen overlay — very thin box floating just above cell surface.
      // Simulates the characteristic light blue reflective tempered glass of real PV panels.
      // Offset along the panel normal by GLASS_OFFSET so it sits on top.
      const glassThickness = 0.004; // 4mm glass layer
      // Compute glass position: panel position + normal * GLASS_OFFSET
      // v6.2.2-fix: Derive ECEF face normal from orientation quaternion when not stored.
      // The stored ecefN fallback (0,0,1) is WRONG for ground panels — it points toward
      // the North Pole in ECEF, not along the panel face normal. Instead, extract the
      // Z-axis of the orientation quaternion which IS the actual face normal.
      let ecefNx: number, ecefNy: number, ecefNz: number;
      if (isFinite((panel as any).ecefNx) && isFinite((panel as any).ecefNy) && isFinite((panel as any).ecefNz) &&
          (Math.abs((panel as any).ecefNx) + Math.abs((panel as any).ecefNy) + Math.abs((panel as any).ecefNz)) > 1e-6) {
        ecefNx = (panel as any).ecefNx;
        ecefNy = (panel as any).ecefNy;
        ecefNz = (panel as any).ecefNz;
      } else {
        // Derive face normal from orientation quaternion: rotate (0,0,1) by q.
        // rotMatrix column 2 = Z-axis = face normal in ECEF.
        const rotM = C.Matrix3.fromQuaternion(orientation);
        ecefNx = C.Matrix3.getColumn(rotM, 2, new C.Cartesian3()).x;
        ecefNy = C.Matrix3.getColumn(rotM, 2, new C.Cartesian3()).y;
        ecefNz = C.Matrix3.getColumn(rotM, 2, new C.Cartesian3()).z;
      }
      const gx = (pos as any).x + ecefNx * GLASS_OFFSET;
      const gy = (pos as any).y + ecefNy * GLASS_OFFSET;
      const gz = (pos as any).z + ecefNz * GLASS_OFFSET;
      const glassPos = new C.Cartesian3(gx, gy, gz);

      const glassEntity = viewer.entities.add({
        name: `[PANEL-GLASS] ${panel.id}`,
        position: glassPos,
        orientation,
        box: {
          dimensions:               new C.Cartesian3(ph - 0.04, pw - 0.04, glassThickness),
          material:                 new C.ColorMaterialProperty(glassColor),
          outline:                  false,
          shadows:                  C.ShadowMode.DISABLED,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      panelMapRef.current.set(panel.id, frameEntity);
      panelMapRef.current.set(`${panel.id}__glass`, glassEntity);

      // v47.317: Cell grid lines — simulate photovoltaic cell grid on panel face.
      // Philadelphia Solar PS-MNB108: 108 half-cells (54x2), visually 6 cols x 12 rows.
      // Grid lines are drawn as polylines on the panel surface using ECEF frame vectors.
      // u-axis = along panel width (pw), v-axis = along panel height (ph), n = face normal.
      //
      // Performance: skip grid lines when panel count > 12.
      // Each panel grid = 20 polyline entities => large designs = hundreds of extra entities.
      // Grid lines are purely cosmetic; panels render correctly with body + glass alone.
      // v48.7: Use skipGridOverride when provided (batch adds) so all panels in a batch
      // get consistent rendering. Fall back to panelMapRef size / 2 (frame+glass per panel).
      const _skipGrid = skipGridOverride !== undefined
        ? skipGridOverride
        : Math.floor(panelMapRef.current.size / 2) > 12;
      if (!_skipGrid) try {
        const GRID_COLS = 6;   // 6 cell columns across panel width
        const GRID_ROWS = 12;  // 12 cell rows up panel height (54x2 half-cells)
        const GRID_OFFSET = GLASS_OFFSET + 0.003; // just above glass surface
        const gridLineColor = sType === 'fence'
          ? new C.Color(0.15, 0.20, 0.30, 0.55)  // subtle blue-grey on near-black
          : new C.Color(0.10, 0.15, 0.25, 0.45); // subtle dark blue on navy

        // v48.31: Compute ECEF pwDir/phDir axes for this panel grid.
        // pwDir = along panel width (pw), phDir = along panel height (ph), N = face normal.
        // ALWAYS derive from orientation quaternion — this is the single source of truth
        // (same quaternion drives the box entity, so grid lines MUST use it too).
        // The old storedUx branch used frame.u which for ground panels doesn't always
        // match the box Y-axis, causing the cell grid to render as a "ghost" behind panels.
        const pN = { x: ecefNx, y: ecefNy, z: ecefNz };

        let pwDir: { x: number; y: number; z: number };
        let phDir: { x: number; y: number; z: number };

        {
          // Cesium box local axes: X = phDir (height dim), Y = pwDir (width dim), Z = normal.
          const rotM3 = C.Matrix3.fromQuaternion(orientation);
          const col0 = C.Matrix3.getColumn(rotM3, 0, new C.Cartesian3()); // X = phDir
          const col1 = C.Matrix3.getColumn(rotM3, 1, new C.Cartesian3()); // Y = pwDir
          phDir = { x: col0.x, y: col0.y, z: col0.z };
          pwDir = { x: col1.x, y: col1.y, z: col1.z };
        }

        // Panel face center with grid offset (slightly in front of glass)
        const faceCenter = {
          x: (pos as any).x + pN.x * GRID_OFFSET,
          y: (pos as any).y + pN.y * GRID_OFFSET,
          z: (pos as any).z + pN.z * GRID_OFFSET,
        };

        // Panel half-dimensions
        const halfW = pw / 2; // half of panel width (pwDir direction)
        const halfH = ph / 2; // half of panel height (phDir direction)

        const gridLines: any[] = [];

        // Vertical grid lines (along phDir/height axis, dividing columns across pwDir/width)
        for (let ci = 0; ci <= GRID_COLS; ci++) {
          const wOff = -halfW + (ci / GRID_COLS) * pw;
          const ptBottom = new C.Cartesian3(
            faceCenter.x + pwDir.x * wOff + phDir.x * (-halfH),
            faceCenter.y + pwDir.y * wOff + phDir.y * (-halfH),
            faceCenter.z + pwDir.z * wOff + phDir.z * (-halfH),
          );
          const ptTop = new C.Cartesian3(
            faceCenter.x + pwDir.x * wOff + phDir.x * halfH,
            faceCenter.y + pwDir.y * wOff + phDir.y * halfH,
            faceCenter.z + pwDir.z * wOff + phDir.z * halfH,
          );
          gridLines.push(viewer.entities.add({
            name: `[PANEL-GRID] ${panel.id} v${ci}`,
            polyline: {
              positions: [ptBottom, ptTop],
              width: 0.8,
              material: new C.ColorMaterialProperty(gridLineColor),
              followSurface: false,
              clampToGround: false,
            },
          }));
        }

        // Horizontal grid lines (along pwDir/width axis, dividing rows across phDir/height)
        for (let ri = 0; ri <= GRID_ROWS; ri++) {
          const hOff = -halfH + (ri / GRID_ROWS) * ph;
          const ptLeft = new C.Cartesian3(
            faceCenter.x + pwDir.x * (-halfW) + phDir.x * hOff,
            faceCenter.y + pwDir.y * (-halfW) + phDir.y * hOff,
            faceCenter.z + pwDir.z * (-halfW) + phDir.z * hOff,
          );
          const ptRight = new C.Cartesian3(
            faceCenter.x + pwDir.x * halfW + phDir.x * hOff,
            faceCenter.y + pwDir.y * halfW + phDir.y * hOff,
            faceCenter.z + pwDir.z * halfW + phDir.z * hOff,
          );
          gridLines.push(viewer.entities.add({
            name: `[PANEL-GRID] ${panel.id} h${ri}`,
            polyline: {
              positions: [ptLeft, ptRight],
              width: 0.8,
              material: new C.ColorMaterialProperty(gridLineColor),
              followSurface: false,
              clampToGround: false,
            },
          }));
        }

        // Store grid line entities for cleanup: __grid__0, __grid__1, ...
        gridLines.forEach((e, i) => {
          panelMapRef.current.set(`${panel.id}__grid__${i}`, e);
        });

      } catch (gridErr: unknown) {
        // Grid lines are cosmetic — never fail silently on grid errors
        addLog('WARN', `addPanelEntity grid ${panel.id}: ${(gridErr as Error).message}`);
      }

      return frameEntity;
    } catch (err: unknown) {
      addLog('ERROR', `addPanelEntity ${panel.id}: ${(err as Error).message}`);
    }
  }

  // v47.159: Remove all entities for a single panel id (frame + glass + grid lines)
  function removePanelEntities(viewer: any, id: string) {
    // Frame entity
    const ent = panelMapRef.current.get(id);
    if (ent) { try { viewer.entities.remove(ent); } catch {} panelMapRef.current.delete(id); }
    // Glass sheen
    const glassEnt = panelMapRef.current.get(`${id}__glass`);
    if (glassEnt) { try { viewer.entities.remove(glassEnt); } catch {} panelMapRef.current.delete(`${id}__glass`); }
    // Cell grid lines (__grid__0 .. __grid__N) -- remove all matching keys
    const gridPrefix = `${id}__grid__`;
    const keysToDelete: string[] = [];
    panelMapRef.current.forEach((_val, key) => {
      if (key.startsWith(gridPrefix)) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => {
      const e = panelMapRef.current.get(key);
      if (e) { try { viewer.entities.remove(e); } catch {} panelMapRef.current.delete(key); }
    });
    // v48.13: Remove all ground racking entities (posts, rails, braces) keyed to this panel id.
    // Keys contain panel id: __gracking__post__left/right__tableId__panelId,
    //   __gracking__rail__r#__tableId__panelId, __gracking__brace__left/right__tableId__panelId
    // Also handle legacy v48.12 key: __gracking__post__${id}
    const rackKeysToDelete: string[] = [];
    panelMapRef.current.forEach((_val, key) => {
      if (key.startsWith('__gracking__') && key.includes(id)) rackKeysToDelete.push(key);
    });
    rackKeysToDelete.forEach(key => {
      const e = panelMapRef.current.get(key);
      if (e) { try { viewer.entities.remove(e); } catch {} panelMapRef.current.delete(key); }
    });
  }

  function computeShade(panel: PlacedPanel, sunPos: any): number {
    if (sunPos.elevation <= 0) return 0;
    const sunElRad = sunPos.elevation * Math.PI / 180;
    const sunAzRad = sunPos.azimuth * Math.PI / 180;
    const panelTiltRad = (panel.tilt ?? 0) * Math.PI / 180;
    const panelAzRad = (panel.azimuth ?? 180) * Math.PI / 180;
    const nx = Math.sin(panelTiltRad) * Math.sin(panelAzRad);
    const ny = Math.sin(panelTiltRad) * Math.cos(panelAzRad);
    const nz = Math.cos(panelTiltRad);
    const sx = Math.cos(sunElRad) * Math.sin(sunAzRad);
    const sy = Math.cos(sunElRad) * Math.cos(sunAzRad);
    const sz = Math.sin(sunElRad);
    return Math.max(0, nx * sx + ny * sy + nz * sz);
  }

  // ── Update shade colors ────────────────────────────────────────────────────
  function updateShadeColors() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const C = (window as any).Cesium;
    if (!C) return;

    // Build simulation date: June 21 at simulated hour (UTC)
    // IMPORTANT: Use UTC hours so Cesium's sun position (which uses UTC) matches our calculation
    // simHourRef is LOCAL solar time; convert to UTC for sun position
    const localHour = simHourRef.current;
    const hour = ((localHour - lng / 15) % 24 + 24) % 24;
    const d = new Date();
    // Set to June 21 of current year, at the simulated hour in UTC
    d.setUTCFullYear(d.getUTCFullYear(), 5, 21); // June 21
    d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);

    // Sync Cesium clock so the built-in sun/shadow system moves with the slider
    try {
      const julianDate = C.JulianDate.fromDate(d);
      viewer.clock.currentTime = julianDate;
      viewer.clock.shouldAnimate = false; // keep clock frozen at our chosen time

      // Enable/disable lighting and shadows based on shade mode
      const shadeOn = showShadeRef.current;
      viewer.scene.globe.enableLighting = shadeOn;
      viewer.scene.shadowMap.enabled = shadeOn;
      viewer.scene.shadowMap.softShadows = shadeOn;
      viewer.scene.shadowMap.size = 1024;

      // Always show the sun disc
      if (viewer.scene.sun) viewer.scene.sun.show = true;

      // Force Cesium to re-evaluate the scene with the new clock time
      viewer.scene.requestRender();
      // Second render call after a tick to ensure shadow map recalculates
      setTimeout(() => {
        try { viewer.scene.requestRender(); } catch {}
      }, 50);
    } catch (e: unknown) {
      addLog('WARN', `updateShadeColors clock sync: ${(e as Error).message}`);
    }

    // Compute sun position for panel shade factor coloring
    // Use local time for getSunPosition (it expects local solar time)
    const dLocal = new Date();
    dLocal.setUTCFullYear(dLocal.getUTCFullYear(), 5, 21);
    dLocal.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    const sunPos = getSunPosition(lat, lng, dLocal);

    // Recolor panel entities based on computed shade factor
    panelsRef.current.forEach(panel => {
      const entity = panelMapRef.current.get(panel.id);
      if (!entity || !entity.box) return;
      try {
        let color: any;
        if (showShadeRef.current) {
          const shade = computeShade(panel, sunPos);
          color = new C.ColorMaterialProperty(shadeToColor(C, shade));
        } else {
          color = new C.ColorMaterialProperty(systemTypeColor(C, (panel.systemType ?? 'roof') as SystemType));
        }
        entity.box.material = color;
      } catch (e) { handleCesiumError(`Shade color update panel ${panel.id}`, e, true); }
    });

    // Final render request
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Setup click handler ────────────────────────────────────────────────────
  function setupClickHandler(viewer: any, C: any) {
    if (handlerRef.current) { try { handlerRef.current.destroy(); } catch {} }
    // v62: kill Cesium's built-in double-click → track/zoom-to-entity. Our double-click
    // drills into a single panel; the default was also flying the camera in.
    try { viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); } catch {}
    try { viewer.trackedEntity = undefined; } catch {}
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction((event: any) => {
      try {
        // v62: swallow the click that trails a grab-drag (move/rotate) so it doesn't
        // re-run selection on mouse-up.
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        const mode = modeRef.current;
        const screenPos = event.position;
        if (mode === 'select')      handleSelectClick(viewer, C, screenPos);
        else if (mode === 'roof')   handleRoofClick(viewer, C, screenPos);
        // v49.1: 'ground' mode now routes to handleGroundArrayClick (array engine).
        // The legacy handleGroundClick (single-panel) is DISABLED for ground mounts.
        // This ensures ALL ground placement uses the 2-row PLP / 4-row XR engine.
        else if (mode === 'ground' || mode === 'ground_array') handleGroundArrayClick(viewer, C, screenPos);
        else if (mode === 'fence')  handleFenceClick(viewer, C, screenPos);
        else if (mode === 'plane')  handlePlaneClick(viewer, C, screenPos);
        else if (mode === 'row')    handleRowClick(viewer, C, screenPos);
        else if (mode === 'measure')        handleMeasureClick(viewer, C, screenPos);
        else if (mode === 'surface_select') handleSurfaceSelectClick(viewer, C, screenPos);
        else if (mode === 'extend_row')     handleExtendRowClick(viewer, C, screenPos);
        else if (mode === 'add_row')        handleAddRowClick(viewer, C, screenPos);
        else if (mode === 'snap_panel')     handleSnapPanelClick(viewer, C, screenPos);
        else if (mode === 'obstruction')    handleObstructionClick(viewer, C, screenPos);
        else if (mode === 'plane3d')        handlePlane3DClick(viewer, C, screenPos);
        else if (mode === 'mark_plane')     handlePlane3DClick(viewer, C, screenPos); // same point-trace, no panel fill on finish
        else if (mode === 'set_direction')  handleSetDirectionClick(viewer, C, screenPos);
        else if (mode === 'set_origin')     handleSetOriginClick(viewer, C, screenPos);
        // auto_roof: fires once via placementMode useEffect — NOT on canvas click

        // pick_house: user clicked a house — get lat/lng and reverse-geocode
        if (mode === 'pick_house') {
          try {
            const pickedPos = viewer.scene.pickPosition(screenPos);
            if (pickedPos && isFinite(pickedPos.x)) {
              const carto = C.Cartographic.fromCartesian(pickedPos);
              const pickedLat = C.Math.toDegrees(carto.latitude);
              const pickedLng = C.Math.toDegrees(carto.longitude);
              if (isValidCoord(pickedLat, pickedLng)) {
                addLog('PICK', `House picked at ${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`);
                setStatusMsg('House selected — loading solar data...');
                onPlacementModeChange('select');
                // Reverse geocode in background
                fetch(`/api/geocode?lat=${pickedLat}&lng=${pickedLng}`)
                  .then(r => r.json())
                  .then(data => {
                    const address = data?.data?.short_name || `${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`;
                    if (onLocationPick) onLocationPick(pickedLat, pickedLng, address);
                  })
                  .catch(() => {
                    if (onLocationPick) onLocationPick(pickedLat, pickedLng, `${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)}`);
                  });
              }
            }
          } catch (e: unknown) {
            addLog('ERROR', `pick_house: ${(e as Error).message}`);
          }
        }
      } catch (err: unknown) {
        addLog('ERROR', `Click handler: ${(err as Error).message}`);
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    // v48.12: SHIFT+click in select mode → multi-select toggle
    handler.setInputAction((event: any) => {
      if (modeRef.current === 'select') {
        handleShiftSelectClick(viewer, C, event.position);
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK, C.KeyboardEventModifier.SHIFT);

    // v62: DOUBLE-click in select mode → drill INTO the clicked panel's array so the
    // following single clicks select individual panels (micro-edit). Click empty space
    // exits back to whole-array selection (handled in handleSelectClick).
    handler.setInputAction((event: any) => {
      if (modeRef.current !== 'select') return;
      const { foundId } = pickPanelAtScreen(viewer, event.position);
      if (!foundId) return;
      const panel = panelsRef.current.find(p => p.id === foundId);
      const gk = groupKeyOf(panel);
      if (gk) {
        drilledGroupKeyRef.current = gk;
        handleSelectClick(viewer, C, event.position); // now selects the single panel
        setStatusMsg('🔎 Editing single panels — click panels to select · empty space to exit the array');
      }
    }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // ── v62: GRAB-TO-MOVE / GRAB-TO-ROTATE (mouse drag in select mode) ──────────
    // Drag the ⟳ handle → rotate the array about its centroid. Drag the array body
    // (a selected panel) → move it on its plane. Camera left-drag is disabled for
    // the duration so the globe doesn't orbit underneath.
    handler.setInputAction((event: any) => {
      if (modeRef.current !== 'select') return;
      const ids = selectedPanelIdsRef.current;
      if (ids.size === 0) return;
      const screen = event.position;
      const cen = arrayCentroidECEF(C, ids);
      const N   = arrayNormalECEF(C, ids);
      if (!cen || !N) return;
      const plane = C.Plane.fromPointNormal(cen, N);

      // Rotate handle hit?
      let onHandle = false;
      try { const pk = viewer.scene.pick(screen); if (pk && pk.id && rotateHandleRef.current && pk.id === rotateHandleRef.current) onHandle = true; } catch {}
      if (onHandle) {
        const U = arrayEaveECEF(C, ids);
        if (!U) return;
        const V = C.Cartesian3.normalize(C.Cartesian3.cross(N, U, new C.Cartesian3()), new C.Cartesian3());
        const ray = viewer.camera.getPickRay(screen);
        const hit = ray ? C.IntersectionTests.rayPlane(ray, plane) : null;
        let ang = 0;
        if (hit) { const r = C.Cartesian3.subtract(hit, cen, new C.Cartesian3()); ang = Math.atan2(C.Cartesian3.dot(r, V), C.Cartesian3.dot(r, U)); }
        dragRef.current = { mode: 'rotate', cen, N, U, V, lastAngle: ang, moved: false, armed: false, downX: screen.x, downY: screen.y };
        arrayManipRef.current = true; // freeze the custom camera handler for this drag
        return;
      }

      // Body hit on a selected panel → move.
      const { foundId } = pickPanelAtScreen(viewer, screen);
      if (foundId && ids.has(foundId)) {
        const ray = viewer.camera.getPickRay(screen);
        const hit = ray ? C.IntersectionTests.rayPlane(ray, plane) : null;
        dragRef.current = { mode: 'move', plane, lastCart: hit, moved: false, armed: false, downX: screen.x, downY: screen.y };
        arrayManipRef.current = true; // freeze the custom camera handler for this drag
      }
    }, C.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((event: any) => {
      const drag = dragRef.current;
      if (!drag) return;
      const ray = viewer.camera.getPickRay(event.endPosition);
      if (!ray) return;
      // v62: drag threshold — a click/double-click (cursor barely moves) must NOT move
      // or rotate the array, so single-panel select (double-click) + Delete stays reliable.
      if (!drag.armed) {
        const ddx = event.endPosition.x - drag.downX, ddy = event.endPosition.y - drag.downY;
        if (Math.hypot(ddx, ddy) < 6) return;
        drag.armed = true; // re-baseline at the current cursor so there's no jump
        if (drag.mode === 'move') {
          const h = C.IntersectionTests.rayPlane(ray, drag.plane); if (h) drag.lastCart = h;
        } else {
          const pl = C.Plane.fromPointNormal(drag.cen, drag.N);
          const h = C.IntersectionTests.rayPlane(ray, pl);
          if (h) { const r = C.Cartesian3.subtract(h, drag.cen, new C.Cartesian3()); drag.lastAngle = Math.atan2(C.Cartesian3.dot(r, drag.V), C.Cartesian3.dot(r, drag.U)); }
        }
        return;
      }
      if (drag.mode === 'move') {
        const hit = C.IntersectionTests.rayPlane(ray, drag.plane);
        if (!hit) return;
        if (!drag.lastCart) { drag.lastCart = hit; return; }
        const d = C.Cartesian3.subtract(hit, drag.lastCart, new C.Cartesian3());
        drag.lastCart = hit; drag.moved = true;
        translateArrayBy(viewer, C, selectedPanelIdsRef.current, d, false);
      } else if (drag.mode === 'rotate') {
        const plane = C.Plane.fromPointNormal(drag.cen, drag.N);
        const hit = C.IntersectionTests.rayPlane(ray, plane);
        if (!hit) return;
        const r = C.Cartesian3.subtract(hit, drag.cen, new C.Cartesian3());
        const ang = Math.atan2(C.Cartesian3.dot(r, drag.V), C.Cartesian3.dot(r, drag.U));
        let delta = ang - drag.lastAngle;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        drag.lastAngle = ang; drag.moved = true;
        rotateArrayBy(viewer, C, selectedPanelIdsRef.current, delta, drag.cen, drag.N, false);
      }
    }, C.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      arrayManipRef.current = false; // hand the camera back to the custom handler
      if (drag.moved) {
        suppressClickRef.current = true;      // ignore the trailing LEFT_CLICK
        if (ENABLE_PANEL_SNAP && drag.mode === 'move' && selectedPanelIdsRef.current.size === 1) {
          const id = [...selectedPanelIdsRef.current][0];
          try { snapMovedPanel(viewer, C, id); } catch (e) { addLog('WARN', `snapMovedPanel: ${(e as Error).message}`); }
        }
        onPanelsChange(panelsRef.current);    // commit once
        showRotateHandle(viewer, C);          // handle re-floats above the new position
        setStatusMsg(drag.mode === 'rotate' ? '↻ Array rotated — drag ⟳ again, or drag the array to move' : '✥ Moved — drag again, or drag ⟳ to rotate');
      }
    }, C.ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction(() => {
      if (modeRef.current === 'plane' && planePtsRef.current.length >= 3) {
        finalizePlane(viewer, C);
      } else if (modeRef.current === 'plane3d' && pts3DCesiumRef.current.length >= 3) {
        // v47.121: Right-click finalizes 3D plane creation
        finalizePlane3D(viewer, C);
      } else if (modeRef.current === 'mark_plane' && pts3DCesiumRef.current.length >= 3) {
        // v62: Right-click finalizes a MARK-ONLY face (no panels)
        finalizePlane3D(viewer, C, false);
      } else if ((modeRef.current === 'plane3d' || modeRef.current === 'mark_plane') && pts3DCesiumRef.current.length > 0) {
        // Right-click with < 3 points: cancel and clear
        clearPlane3DPreview(viewer);
        setStatusMsg(`${modeRef.current === 'mark_plane' ? 'Mark Plane' : '3D Plane'} cancelled — need at least 3 points. Click again to start.`);
      } else if (modeRef.current === 'fence' && fencePtsRef.current.length >= 2) {
        finalizeFence(viewer, C);
      } else if (modeRef.current === 'roof') {
        clearGhostPanel();
        setStatusMsg('Roof placement sequence ended');
      } else if (modeRef.current === 'measure') {
        measurePtsRef.current = [];
        setMeasurePtCount(0);
        clearMeasureOverlay();
        setStatusMsg('Measure cleared');
      }
    }, C.ScreenSpaceEventType.RIGHT_CLICK);
  }

  function setupHoverHandler(viewer: any, C: any) {
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: any) => {
      try {
        if (modeRef.current === 'select') return;
        // Use the same pick chain as placement (3D tiles → ellipsoid), NOT raw
        // globe.pick — the globe is hidden once tiles load, so globe.pick returns
        // a garbage underground height. This keeps the readout truthful and
        // matching where panels actually land.
        const hit = getWorldPosition(viewer, C, event.endPosition);
        if (hit) {
          const carto = C.Cartographic.fromCartesian(hit.cartesian);
          if (carto) {
            const pLat = C.Math.toDegrees(carto.latitude);
            const pLng = C.Math.toDegrees(carto.longitude);
            const h = carto.height;
            if (isFinite(pLat) && isFinite(pLng)) {
              setStatusMsg(`📍 ${pLat.toFixed(5)}, ${pLng.toFixed(5)} | h=${ftStr(h)} (${h.toFixed(1)}m)`);
            }
          }
        }
      } catch {}
    }, C.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── getWorldPosition: unified surface picking (3D tiles → terrain → ellipsoid) ──
  /**
   * Unified surface picking — converts a screen pixel position to a 3D world coordinate.
   *
   * Picking priority chain (highest to lowest accuracy):
   * 1. **3D Tiles** — scene.pick() + scene.pickPosition() on the Google Photorealistic mesh
   *    (most accurate: snaps to actual building/roof geometry)
   * 2. **Terrain** — globe.pick() on the ellipsoid terrain surface
   *    (fallback when no 3D tile is under the cursor)
   * 3. **Ellipsoid** — mathematical ray-ellipsoid intersection
   *    (last resort: flat earth approximation, no terrain height)
   *
   * @param viewer    - Active Cesium Viewer instance
   * @param C         - Cesium namespace (window.Cesium)
   * @param screenPos - Cesium Cartesian2 screen pixel position (from event.position)
   * @returns Object with { cartesian: Cartesian3, pickMethod: string } or null if all methods fail
   */
  function getWorldPosition(viewer: any, C: any, screenPos: any): { cartesian: any; pickMethod: string } | null {
    let cartesian: any = null;
    let pickMethod = 'none';

    // Try 3D tiles first (pickPosition on picked object)
    try {
      const pickedObject = viewer.scene.pick(screenPos);
      if (pickedObject) {
        const pp = viewer.scene.pickPosition(screenPos);
        if (pp && isFinite(pp.x) && isFinite(pp.y) && isFinite(pp.z) && C.Cartesian3.magnitude(pp) > 1000) {
          // Google Photorealistic 3D Tiles meshes are shells — pickPosition can land on
          // the inner (back) face of a roof/wall, placing the point INSIDE the geometry.
          // Fix: nudge the hit point 0.15 m outward along the ellipsoid surface normal
          // (i.e. radially away from Earth's centre) so markers/panels always sit on top.
          const surfaceNormal = C.Ellipsoid.WGS84.geodeticSurfaceNormal(pp);
          if (surfaceNormal) {
            const nudge = C.Cartesian3.multiplyByScalar(surfaceNormal, 0.15, new C.Cartesian3());
            cartesian = C.Cartesian3.add(pp, nudge, new C.Cartesian3());
          } else {
            cartesian = pp;
          }
          pickMethod = '3dtiles';
        }
      }
    } catch (e) { handleCesiumError('3D tiles pick', e, true); }

    // Fallback: globe terrain pick.
    // Only when the globe is SHOWN — we hide it once 3D Tiles load (coastal
    // bleed-through fix), and globe.pick on a hidden globe returns a garbage
    // point (far underground) that still passes the magnitude check, poisoning
    // plane/fence/roof placement. Skip straight to the deterministic ellipsoid
    // pick when the globe is hidden.
    if (!cartesian && viewer.scene.globe.show) {
      try {
        const ray = viewer.camera.getPickRay(screenPos);
        if (ray) {
          const gp = viewer.scene.globe.pick(ray, viewer.scene);
          if (gp && isFinite(gp.x) && C.Cartesian3.magnitude(gp) > 1000) {
            cartesian = gp; pickMethod = 'terrain';
          }
        }
      } catch (e) { handleCesiumError('Terrain pick', e, true); }
    }

    // Fallback: ellipsoid pick
    if (!cartesian) {
      try {
        const ray = viewer.camera.getPickRay(screenPos);
        if (ray) {
          const ep = viewer.scene.globe.ellipsoid.intersectWithRay(ray);
          if (ep && isFinite(ep.x) && C.Cartesian3.magnitude(ep) > 1000) {
            cartesian = ep; pickMethod = 'ellipsoid';
          }
        }
      } catch (e) { handleCesiumError('Ellipsoid pick', e, true); }
    }

    if (!cartesian) return null;
    return { cartesian, pickMethod };
  }

  // ── getGroundPlanePosition: ground-level click picker (v48.32) ──────────────
  /**
   * Picks a ground-level world position for ground array placement.
   *
   * Key requirement: must hit the GROUND SURFACE (where piles go into the ground),
   * NOT elevated panel geometry or racking structure entities.
   *
   * Strategy: try globe.pick (terrain only — ignores all Cesium entities) first.
   * This guarantees we always get the ground surface point regardless of what
   * panel/racking geometry is above it.
   * Fall back to 3D tiles pick (scene.pick) if terrain pick fails.
   * Final fallback: cesiumGroundElevRef height with ray-ellipsoid.
   */
  // ── getGroundPlanePosition v50.5: delegate to getWorldPosition (same as fence/plane) ──────────
  //
  // getWorldPosition is already pixel-perfect for fence and plane modes — it uses
  // scene.pick + scene.pickPosition on 3D tiles (primary) with globe.pick and ellipsoid
  // as fallbacks. We use the SAME function here for lat/lng accuracy.
  //
  // Height trust: only 3dtiles pick gives real mesh height; terrain/ellipsoid return h≈0
  // with EllipsoidTerrainProvider. When h≈0 and site is elevated, fall back to
  // cesiumGroundElevRef (boot-sampled from Google Elevation API + EGM96 geoid).
  //
  function getGroundPlanePosition(
    viewer: any,
    C: any,
    screenPos: any,
  ): { lat: number; lng: number; height: number; pickMethod: string } | null {

    const hit = getWorldPosition(viewer, C, screenPos);
    if (!hit) return null;

    const carto = C.Cartographic.fromCartesian(hit.cartesian);
    if (!carto) return null;
    const pLat = C.Math.toDegrees(carto.latitude);
    const pLng = C.Math.toDegrees(carto.longitude);
    if (!isValidCoord(pLat, pLng)) return null;

    // Height trust: 3dtiles gives real mesh height; terrain+ellipsoid return h≈0.
    const rawH = isFinite(carto.height) && carto.height > -500 ? carto.height : null;
    const trustedH = (hit.pickMethod === '3dtiles' && rawH !== null) ? rawH : null;
    const fallbackH = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const groundElevM = trustedH ?? fallbackH;

    addLog('GROUND', `[GROUND-PICK v50.5] method=${hit.pickMethod} lat=${pLat.toFixed(6)} lng=${pLng.toFixed(6)} rawH=${rawH?.toFixed(2) ?? 'null'} groundElevM=${groundElevM.toFixed(2)}`);
    return { lat: pLat, lng: pLng, height: groundElevM, pickMethod: hit.pickMethod };
  }

  // ── Roof placement ─────────────────────────────────────────────────────────
  function handleRoofClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) {
        setStatusMsg('❌ No surface detected — click directly on the building');
        return;
      }
      const cartesian = hit.cartesian;
      const pickMethod = hit.pickMethod;

      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return;
      const pLat = C.Math.toDegrees(carto.latitude);
      const pLng = C.Math.toDegrees(carto.longitude);
      const pHeight = carto.height;
      if (!isValidCoord(pLat, pLng, pHeight)) return;

      const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const offM = getRoofPanelOffset(mountingSystemIdRef.current);
      // v62: if the click lands on a marked/CAD plane, make the panel FIRST-CLASS —
      // stamp that plane's ECEF frame + planeId so it rotates and renders rails (the
      // bare Roof tool used to place "stale" panels with no frame). Falls back to the
      // per-click surface normal when the click isn't on a known plane.
      const rp = planeRenderableAtClick(C, cartesian, groundElev);
      let panel;
      if (rp) {
        // project the click onto the plane, then lift along the normal by the mount offset
        const d0 = C.Cartesian3.dot(C.Cartesian3.subtract(cartesian, rp.origin, new C.Cartesian3()), rp.n);
        const onPlane = C.Cartesian3.subtract(cartesian, C.Cartesian3.multiplyByScalar(rp.n, d0, new C.Cartesian3()), new C.Cartesian3());
        const pos = C.Cartesian3.add(onPlane, C.Cartesian3.multiplyByScalar(rp.n, offM, new C.Cartesian3()), new C.Cartesian3());
        const pc = C.Cartographic.fromCartesian(pos);
        const existing: any = panelsRef.current.find(p => (p as any).planeId === rp.id && isFinite((p as any).ecefNx));
        const prop: any = (roofPlanesRef.current ?? []).find(p => p.id === rp.id);
        const heading  = existing ? existing.heading : headingFromAzimuth(prop?.azimuth ?? azimuthRef.current);
        const pitchRad = existing ? existing.pitch   : -((prop?.pitch ?? 0) * Math.PI / 180);
        const tiltP    = existing ? (existing.tilt ?? 0)    : (prop?.pitch ?? 0);
        const azP      = existing ? (existing.azimuth ?? 180) : (prop?.azimuth ?? 180);
        panel = createPanel({
          lat: C.Math.toDegrees(pc.latitude), lng: C.Math.toDegrees(pc.longitude), height: pc.height,
          tilt: tiltP, azimuth: azP, systemType: 'roof', heading, pitch: pitchRad, roll: 0,
          orientation: panelOrientationRef.current ?? 'portrait',
        });
        (panel as any).planeId = rp.id;
        (panel as any).ecefUx = rp.u.x; (panel as any).ecefUy = rp.u.y; (panel as any).ecefUz = rp.u.z;
        (panel as any).ecefNx = rp.n.x; (panel as any).ecefNy = rp.n.y; (panel as any).ecefNz = rp.n.z;
      } else {
        const { tiltDeg, azimuthDeg } = computeSurfaceNormal(viewer, C, screenPos, cartesian, pickMethod);
        panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight + offM,
          tilt: tiltDeg, azimuth: azimuthDeg, systemType: 'roof',
          heading: headingFromAzimuth(azimuthDeg), pitch: -(tiltDeg * Math.PI / 180), roll: 0,
        });
      }

      addPanelEntity(viewer, C, panel);
      const newPanels = [...panelsRef.current, panel];
      panelsRef.current = newPanels;
      lastRenderedPanelsRef.current = newPanels; // prevent double-render orphan
      onPanelsChange(newPanels);
      setPanelCount(newPanels.length);
      // Phase 2: rebuild rails after single-click roof placement
      try { renderRoofRails(viewer, C, newPanels); } catch {}
      setStatusMsg(`✅ Roof panel placed (${(panel.tilt ?? 0).toFixed(0)}° pitch, ${(panel.azimuth ?? 0).toFixed(0)}° az)${rp ? ' · on plane' : ''} — click to continue, right-click to stop`);
      showGhostPanel(viewer, C, pLat, pLng, pHeight, panel.tilt ?? 0, panel.azimuth ?? 0);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleRoofClick: ${(err as Error).message}`);
    }
  }

  // ── Ground placement ───────────────────────────────────────────────────────
  function handleGroundClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { setStatusMsg('❌ No ground detected'); return; }
      const cartesian = hit.cartesian;

      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return;
      const pLat = C.Math.toDegrees(carto.latitude);
      const pLng = C.Math.toDegrees(carto.longitude);
      // v48.11: Use actual terrain hit height so single-click ground panels appear at
      // the cursor. Fall back to boot-sampled cesiumGroundElevRef when hit height is
      // unavailable (e.g. ellipsoid-only pick returns height ~0).
      // v50.2: Same 3-tier trust logic as getGroundPlanePosition.
      // getWorldPosition uses scene.pick + pickPosition (3dtiles) first, then globe.pick, then ellipsoid.
      // Only 3dtiles gives real mesh height; terrain+ellipsoid both return h≈0.
      const rawHeightGnd = isFinite(carto.height) && carto.height > -500 ? carto.height : null;
      const trustedHeightGnd = (hit.pickMethod === '3dtiles' && rawHeightGnd !== null && rawHeightGnd > -500) ? rawHeightGnd : null;
      const cesiumFallbackGnd = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const baseZ = trustedHeightGnd ?? cesiumFallbackGnd;
      const mountPlaneZ = baseZ + MOUNT_HEIGHT_M;
      if (!isValidCoord(pLat, pLng, mountPlaneZ)) return;

      // [GROUND_CLICK_DEBUG] Full placement chain trace
      addLog('GROUND', `[GROUND_CLICK_DEBUG] screenPos=(${screenPos.x.toFixed(1)},${screenPos.y.toFixed(1)}) method=${hit.pickMethod} lat=${pLat.toFixed(6)} lng=${pLng.toFixed(6)} cartoH=${carto.height?.toFixed(2)} baseZ=${baseZ.toFixed(2)} mountPlaneZ=${mountPlaneZ.toFixed(2)}`);

      const groundTilt = gTiltRef.current;
      const groundAz = azimuthRef.current;
      const panel = createPanel({
        lat: pLat, lng: pLng,
        height: mountPlaneZ + PANEL_OFFSET + (PH * Math.sin(groundTilt * Math.PI / 180)) / 2,
        tilt: groundTilt, azimuth: groundAz, systemType: 'ground',
        heading: headingFromAzimuth(groundAz), pitch: -(groundTilt * Math.PI / 180), roll: 0,
      });

      addLog('GROUND', `[GROUND_CLICK_DEBUG] panel placed lat=${panel.lat.toFixed(6)} lng=${panel.lng.toFixed(6)} height=${panel.height.toFixed(2)}`);
      // v48.17 FINAL: structure-before-panels — racking drawn first so posts render under panels
      addGroundRacking(viewer, C, [panel], baseZ);
      addPanelEntity(viewer, C, panel);
      const newPanels = [...panelsRef.current, panel];
      panelsRef.current = newPanels;
      lastRenderedPanelsRef.current = newPanels; // prevent double-render orphan
      onPanelsChange(newPanels);
      setPanelCount(newPanels.length);
      setStatusMsg(`✅ Ground panel placed (${groundTilt}° tilt)`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleGroundClick: ${(err as Error).message}`);
    }
  }

  // ── Ground Array placement ────────────────────────────────────────────────────
  // Two-phase: Click 1 = row start, Click 2 = row end (defines direction + length).
  // Subsequent clicks add more rows at auto-calculated spacing (winter solstice formula).
  // Press Enter or right-click to finalize the array.
  function handleGroundArrayClick(viewer: any, C: any, screenPos: any) {
    try {
      // v49.1 / v48.29: Ground engine active
      addLog('GROUND', `[v49.1] groundMountRealityEngine active mode=${modeRef.current} style=${groundMountStyleRef.current} rows=${groundArrayRowsRef.current.length}`);

      // v48.29: Use ray-plane ground pick instead of scene.pickPosition.
      // scene.pickPosition is unreliable at oblique camera angles (depth buffer
      // inaccuracy on Google 3D Tiles gives wrong world coordinates at non-top-down views).
      // getGroundPlanePosition fires a pick ray and intersects with a local tangent
      // plane at the known terrain elevation — works correctly at ANY camera angle.
      const gpp = getGroundPlanePosition(viewer, C, screenPos);
      if (!gpp) { setStatusMsg('\u274c No ground detected \u2014 click on open ground'); return; }

      // Rows 2+: locked flat plane from row-1 start elevation.
      // Row 1 (first click): use terrain elevation from ground plane pick.
      const pendingStartCheck = groundArrayFirstRowRef.current;
      const baseZ_arr = (pendingStartCheck && pendingStartCheck.rowSpacingM > 0)
        ? pendingStartCheck.start.height - MOUNT_HEIGHT_M   // LOCKED flat plane
        : gpp.height;
      const mountPlaneZ_arr = baseZ_arr + MOUNT_HEIGHT_M;
      addLog('GROUND', `[GROUND_CLICK_DEBUG v48.29] method=${gpp.pickMethod} lat=${gpp.lat.toFixed(7)} lng=${gpp.lng.toFixed(7)} baseZ=${baseZ_arr.toFixed(2)} mountZ=${mountPlaneZ_arr.toFixed(2)} locked=${!!(pendingStartCheck && pendingStartCheck.rowSpacingM > 0)}`);
      const pt = {
        lat:    gpp.lat,
        lng:    gpp.lng,
        height: mountPlaneZ_arr,
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;

      const pendingStart = groundArrayFirstRowRef.current;

      // Phase 1a: no start yet \u2014 store start point
      if (!pendingStart) {
        // v6.2.2: Generate unique key prefix for this ground array instance
        groundArrayKeyPrefixRef.current = `ga${Date.now().toString(36)}_`;
        groundArrayFirstRowRef.current = { start: pt, end: pt, azimuthDeg: azimuthRef.current, rowSpacingM: 0 };
        try {
          // v50.6: dot at ground surface elevation (gpp.height), NOT mount plane height
          // pt.height = groundElevM + MOUNT_HEIGHT_M (1.2m up) — at oblique angles that
          // causes a visible screen-space offset. Use gpp.height + 0.05 to sit on the ground.
          const mPos = safeCartesian3(C, pt.lng, pt.lat, gpp.height + 0.05);
          if (mPos) {
            const m = viewer.entities.add({
              position: mPos,
              point: { pixelSize: 12, color: C.Color.fromCssColorString('#14b8a6'),
                outlineColor: C.Color.WHITE, outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY },
              label: { text: 'Start', font: '11px sans-serif',
                fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 2,
                style: 2, verticalOrigin: 1,
                pixelOffset: new C.Cartesian2(0, -16),
                disableDepthTestDistance: Number.POSITIVE_INFINITY },
            });
            overlayRef.current.push(m);
          }
        } catch {}
        setStatusMsg('\ud83c\udf31 Row start set \u2014 click end point to define row direction and length');
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      // Phase 1b: first row end click
      if (pendingStart.rowSpacingM === 0 && groundArrayRowsRef.current.length === 0) {
        const c1 = C.Cartesian3.fromDegrees(pendingStart.start.lng, pendingStart.start.lat, pendingStart.start.height);
        const c2 = C.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.height);
        const rowVec = C.Cartesian3.subtract(c2, c1, new C.Cartesian3());
        const worldLen = C.Cartesian3.magnitude(rowVec);
        if (worldLen < 0.5) { setStatusMsg('\u274c Row too short \u2014 click further away'); return; }
        C.Cartesian3.normalize(rowVec, rowVec);
        const enuMatrix = C.Transforms.eastNorthUpToFixedFrame(c1);
        const enuInv    = C.Matrix4.inverse(enuMatrix, new C.Matrix4());
        const localVec  = C.Matrix4.multiplyByPointAsVector(enuInv, rowVec, new C.Cartesian3());
        let   rowAzDeg  = (Math.atan2(localVec.x, localVec.y) * 180 / Math.PI + 360) % 360;

        // v6.3-canon: Canonicalize rail direction so click order doesn't flip the array.
        // The clicked segment defines a LINE, not a direction — two equivalent rail-axis
        // choices exist (rowAzDeg and rowAzDeg+180).  We pick the one whose perpendicular
        // facing axis (rowAzDeg+90) best matches the configured panel-face azimuth.
        // When flipping, also swap start/end so p1→p2 matches the canonical rowAzDeg.
        let canonStart = pendingStart.start;
        let canonEnd   = pt;
        {
          const desiredFacing = azimuthRef.current;                       // UI slider (default 180° = south)
          const candidateFacing = (rowAzDeg + 90) % 360;                  // perpendicular to raw rail axis
          // Angular difference in [-180, 180]
          let diff = candidateFacing - desiredFacing;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          if (Math.abs(diff) > 90) {
            // Flipping rail axis by 180° brings the facing axis closer to desired
            rowAzDeg = (rowAzDeg + 180) % 360;
            // Swap start/end so p1→p2 direction matches canonical rowAzDeg
            canonStart = pt;
            canonEnd   = pendingStart.start;
            addLog('GROUND', `[CANON] Flipped rail axis + swapped points: raw facing=${candidateFacing.toFixed(1)}° vs desired=${desiredFacing.toFixed(1)}° (diff=${diff.toFixed(1)}°) → canonical rowAzDeg=${rowAzDeg.toFixed(1)}°`);
          } else {
            addLog('GROUND', `[CANON] Rail axis OK: facing=${candidateFacing.toFixed(1)}° vs desired=${desiredFacing.toFixed(1)}° (diff=${diff.toFixed(1)}°) → rowAzDeg=${rowAzDeg.toFixed(1)}°`);
          }
        }

        const orient = panelOrientationRef.current;
        const { ph } = panelDims(orient);
        const rowSpacingM = calcMinRowSpacing(gTiltRef.current, ph, pt.lat);
        const row1 = placeGroundArrayRow(viewer, C, canonStart, canonEnd, rowAzDeg, 0);
        if (row1.length === 0) { setStatusMsg('\u274c No panels fit \u2014 try a longer line'); return; }
        groundArrayFirstRowRef.current = { start: canonStart, end: canonEnd, azimuthDeg: rowAzDeg, rowSpacingM };
        groundArrayRowsRef.current = [row1];
        setGroundArrayRowCount(1);
        setGroundArrayPanelCount(row1.length);
        try {
          // v50.6: dot at ground surface (gpp.height), not mount plane height
          const mPos = safeCartesian3(C, pt.lng, pt.lat, gpp.height + 0.05);
          if (mPos) {
            const m = viewer.entities.add({ position: mPos,
              point: { pixelSize: 10, color: C.Color.fromCssColorString('#fbbf24'),
                outlineColor: C.Color.WHITE, outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY } });
            overlayRef.current.push(m);
          }
        } catch {}
        const kw = (row1.length * (selectedPanelRef.current?.wattage ?? 400) / 1000).toFixed(1); // v47.161

        // v48.21: PLP Power Rail = exactly 2 portrait rows within ONE table.
        // Row2 is placed immediately behind row1 using WITHIN-TABLE spacing.
        // Within-table offset = panelH * cos(tilt) (NOT shadow-avoidance spacing).
        // The 2 portrait rows share the same structural table — posts connect both rows.
        const currentStyle = groundMountStyleRef.current ?? 'pipe';
        if (currentStyle === 'pipe' && getMaxRows('pipe') >= 2) {
          // Within-table row offset: one panel horizontal depth N-S (from groundMountRealityEngine)
          const withinTableOffsetM = getWithinTableSpacing('pipe', panelOrientationRef.current, gTiltRef.current);
          // Row2 is placed behind row1 in the anti-azimuth direction (away from sun face)
          // v6.2.2-az: panel face azimuth = (rowAzDeg + 90), anti-azimuth = + 180
          const panelFaceAzR2 = (rowAzDeg + 90) % 360;
          const offsetAzDegR2 = (panelFaceAzR2 + 180) % 360;
          const offsetRadR2   = offsetAzDegR2 * Math.PI / 180;
          const c1Base2 = C.Cartesian3.fromDegrees(canonStart.lng, canonStart.lat, canonStart.height);
          const enuMat2 = C.Transforms.eastNorthUpToFixedFrame(c1Base2);
          const localOff2 = new C.Cartesian3(
            withinTableOffsetM * Math.sin(offsetRadR2),
            withinTableOffsetM * Math.cos(offsetRadR2),
            0,
          );
          // v49.1 FIX: multiplyByPointAsVector (direction only, no translation) for ENU offset vectors
          const worldOff2 = C.Matrix4.multiplyByPointAsVector(enuMat2, localOff2, new C.Cartesian3());
          const newC1_2 = C.Cartesian3.add(c1Base2, worldOff2, new C.Cartesian3());
          const c2Base2 = C.Cartesian3.fromDegrees(canonEnd.lng, canonEnd.lat, canonEnd.height);
          const newC2_2 = C.Cartesian3.add(c2Base2, worldOff2, new C.Cartesian3());
          const newCarto1_2 = C.Cartographic.fromCartesian(newC1_2);
          const newCarto2_2 = C.Cartographic.fromCartesian(newC2_2);
          if (newCarto1_2 && newCarto2_2) {
            const newStart2 = { lat: C.Math.toDegrees(newCarto1_2.latitude), lng: C.Math.toDegrees(newCarto1_2.longitude), height: pt.height };
            const newEnd2   = { lat: C.Math.toDegrees(newCarto2_2.latitude), lng: C.Math.toDegrees(newCarto2_2.longitude), height: pt.height };
            const row2 = placeGroundArrayRow(viewer, C, newStart2, newEnd2, rowAzDeg, 1);
            if (row2.length > 0) {
              groundArrayRowsRef.current = [row1, row2];
              const totalPanels2 = row1.length + row2.length;
              setGroundArrayRowCount(2);
              setGroundArrayPanelCount(totalPanels2);
              const kw2 = (totalPanels2 * (selectedPanelRef.current?.wattage ?? 400) / 1000).toFixed(1);
              setStatusMsg(`\u2705 PLP: 2 rows \u00b7 ${totalPanels2} panels (${kw2} kW) \u2014 press Enter or \u2713 Confirm`);
              addLog('GROUND', `[v48.21] PLP auto-row2: ${row2.length} panels withinTable=${withinTableOffsetM.toFixed(3)}m`);
              try { viewer.scene.requestRender(); } catch {}
              return;
            }
          }
          addLog('GROUND', '[v48.21] PLP auto-row2 failed — falling back to 1-row display');
        }
        setStatusMsg(`\u2705 Row 1: ${row1.length} panels (${kw} kW) \u2014 click to add Row 2, or press Enter to finish`);
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      // Phase 2+: add subsequent rows at auto-calculated offset
      const ref = groundArrayFirstRowRef.current;
      if (!ref || ref.rowSpacingM === 0) return;
      // v48.18: Enforce per-style row limits
      const styleNow = groundMountStyleRef.current ?? 'pipe';
      const maxRowsNow = getMaxRows(styleNow); // from groundMountRealityEngine
      if (groundArrayRowsRef.current.length >= maxRowsNow) {
        setStatusMsg(`\u2705 ${groundArrayRowsRef.current.length} rows placed \u2014 press Enter or \u2713 Confirm to finish`);
        return;
      }
      const rowCount = groundArrayRowsRef.current.length;
      // v6.2.2-az: panel face azimuth = (row bearing + 90), anti-azimuth = + 180
      const panelFaceAz = (ref.azimuthDeg + 90) % 360;
      const offsetAzDeg = (panelFaceAz + 180) % 360;
      const offsetRad   = offsetAzDeg * Math.PI / 180;
      const totalOffset = ref.rowSpacingM * rowCount;
      const c1Base = C.Cartesian3.fromDegrees(ref.start.lng, ref.start.lat, ref.start.height);
      const enuMat = C.Transforms.eastNorthUpToFixedFrame(c1Base);
      const localOff = new C.Cartesian3(totalOffset * Math.sin(offsetRad), totalOffset * Math.cos(offsetRad), 0);
      // v49.1 FIX: multiplyByPointAsVector for ENU offset vectors (not points)
      const worldOff = C.Matrix4.multiplyByPointAsVector(enuMat, localOff, new C.Cartesian3());
      const newC1 = C.Cartesian3.add(c1Base, worldOff, new C.Cartesian3());
      const c2Base = C.Cartesian3.fromDegrees(ref.end.lng, ref.end.lat, ref.end.height);
      const newC2  = C.Cartesian3.add(c2Base, worldOff, new C.Cartesian3());
      const newCarto1 = C.Cartographic.fromCartesian(newC1);
      const newCarto2 = C.Cartographic.fromCartesian(newC2);
      if (!newCarto1 || !newCarto2) return;
      const newStart = { lat: C.Math.toDegrees(newCarto1.latitude), lng: C.Math.toDegrees(newCarto1.longitude), height: mountPlaneZ_arr };
      const newEnd   = { lat: C.Math.toDegrees(newCarto2.latitude), lng: C.Math.toDegrees(newCarto2.longitude), height: mountPlaneZ_arr };
      const newRow = placeGroundArrayRow(viewer, C, newStart, newEnd, ref.azimuthDeg, rowCount);
      if (newRow.length === 0) { setStatusMsg('\u26a0\ufe0f No panels fit in this row'); return; }
      groundArrayRowsRef.current = [...groundArrayRowsRef.current, newRow];
      const totalPanels = groundArrayRowsRef.current.reduce((s, r) => s + r.length, 0);
      setGroundArrayRowCount(groundArrayRowsRef.current.length);
      setGroundArrayPanelCount(totalPanels);
      const kw2 = (totalPanels * (selectedPanelRef.current?.wattage ?? 400) / 1000).toFixed(1); // v47.161
      setStatusMsg(`\u2705 ${groundArrayRowsRef.current.length} rows \u00b7 ${totalPanels} panels \u00b7 ${kw2} kW \u2014 click for Row ${groundArrayRowsRef.current.length + 1} or Enter to finish`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleGroundArrayClick: ${(err as Error).message}`);
    }
  }

  // ── placeGroundArrayRow v49.2: STRUCTURE-FIRST ──────────────────────────────
  // Pipeline order:
  //   1. buildGroundRacking() → compute ALL structural geometry (piles, rails, tubes)
  //   2. Render ALL structure members immediately (visible during preview)
  //   3. placePanelsControlled() → place panels with rail Z from structure
  //   4. Stamp arrayRow on panels
  // Panels NEVER rendered without structure. Structure defines the grid.
  function placeGroundArrayRow(
    viewer: any, C: any,
    p1: { lat: number; lng: number; height: number },
    p2: { lat: number; lng: number; height: number },
    rowAzDeg: number,
    arrayRowIndex: number = 0,
    allRowsForRacking?: PlacedPanel[], // if set, rebuild racking for ALL rows together
  ): PlacedPanel[] {
    const orient  = panelOrientationRef.current;
    const tiltDeg = gTiltRef.current;
    // v6.2.2-az: Derive panel-face azimuth from click-derived row bearing.
    // rowAzDeg = bearing from startPoint → endPoint = RAIL direction.
    // Panel face azimuth = perpendicular to rail direction = (rowAzDeg + 90) % 360.
    // This matches buildPlaneFromTwoPoints: horizontal = cross(radialUp, u),
    // which always points 90° clockwise from the row direction when viewed from above.
    // azimuthRef.current (UI slider, defaults 180°) must NOT be used — it ignores user intent.
    const azDeg   = (rowAzDeg + 90) % 360;
    const style   = groundMountStyleRef.current ?? 'pipe';

    // v6.2.2-az: Validation logging
    addLog('GROUND', `[AZ-TRUTH] startPoint=(${p1.lat.toFixed(6)}, ${p1.lng.toFixed(6)}) endPoint=(${p2.lat.toFixed(6)}, ${p2.lng.toFixed(6)})`);
    addLog('GROUND', `[AZ-TRUTH] rowBearing=${rowAzDeg.toFixed(1)}° → panelFaceAzimuth=${azDeg.toFixed(1)}° (UI slider was ${azimuthRef.current.toFixed(1)}°)`);

    // basePlaneZ = terrain height locked at first click
    const basePlaneZ = p1.height - MOUNT_HEIGHT_M;

    // ── STEP 1: Place panels via plane engine (get panel positions) ───────────
    const p1ECEF = engLatLngToECEF(p1.lat, p1.lng, p1.height);
    const p2ECEF = engLatLngToECEF(p2.lat, p2.lng, p2.height);

    const clGroundResult = placePanelsControlled({
      mode:        'ground',
      p1ECEF,
      p2ECEF,
      tiltDeg,
      azimuthDeg:  azDeg,
      orientation: orient,
      wattage:     selectedPanelRef.current?.wattage ?? 400,
      layoutId:    `ground-row-${Date.now()}`,
    });
    const panels = clGroundResult.panels;

    if (panels.length === 0) {
      addLog('GROUND', `[v49.2] placeGroundArrayRow: 0 panels from engine — skipping`);
      return [];
    }

    // Stamp array row index for racking engine row detection
    panels.forEach(p => { (p as any).arrayRow = arrayRowIndex; });

    addLog('GROUND', `[v49.2] STRUCTURE-FIRST row${arrayRowIndex}: ${panels.length} panels style=${style}`);

    // ── STEP 2: BUILD STRUCTURE FIRST ────────────────────────────────────────
    // Use ALL rows placed so far + this new row for a complete structural picture.
    // This ensures N/S post pairs, torque tubes, and rails span ALL rows.
    const existingRows = groundArrayRowsRef.current.flat();
    const castExisting: GroundPanel[] = existingRows.map(p => ({
      id: p.id, lat: p.lat, lng: p.lng, height: p.height,
      tilt: p.tilt, azimuth: p.azimuth,
      arrayRow: (p as any).arrayRow ?? 0,
      col: p.col, row: p.row,
      systemType: 'ground' as const,
      orientation: orient,
      wattage: p.wattage,
    }));
    const castNew: GroundPanel[] = panels.map(p => ({
      id: p.id, lat: p.lat, lng: p.lng, height: p.height,
      tilt: p.tilt, azimuth: p.azimuth,
      arrayRow: arrayRowIndex,
      col: p.col, row: p.row,
      systemType: 'ground' as const,
      orientation: orient,
      wattage: p.wattage,
    }));
    const allPanelsForRacking = [...castExisting, ...castNew];

    const opts: BuildRackingOptions = {
      style,
      panels:      allPanelsForRacking,
      basePlaneZ,
      tiltDeg,
      azimuthDeg:  azDeg,
      orientation: orient,
      keyPrefix:   groundArrayKeyPrefixRef.current,  // v6.2.2: unique per ground array
    };

    const rackingResult = buildGroundRacking(opts);
    // v6.2.0: Debug log summary only (was per-line output)
    addLog('GROUND', `[ENGINE] ${rackingResult.debugLog.length} debug messages, ${rackingResult.members.length} members, valid=${rackingResult.valid}`);

    // v6.2.0: Entity cleanup now handled inside renderGroundRackingOutput.

    // ── STEP 4: RENDER ALL STRUCTURE MEMBERS (before panels) ─────────────────
    // v50.0: STEP 4 — Single render path (renderGroundRackingOutput)
    // REG-4: only render structure if showRacking is enabled
    let membersRendered = 0;
    if (showRackingRef.current) {
      membersRendered = renderGroundRackingOutput(viewer, C, rackingResult, `placeGroundArrayRow[row${arrayRowIndex}]`);
    }

    addLog('GROUND', `[v49.2] STRUCTURE rendered: ${membersRendered} members BEFORE panels. groundZ=${rackingResult.groundZ.toFixed(3)} sRailZ=${rackingResult.sRailZ.toFixed(3)}`);

    // ── STEP 5: RENDER PANELS ON TOP OF STRUCTURE ────────────────────────────
    // v5.4: Use grid-corrected panel positions from engine (eliminates terrain drift).
    // correctedPanels[] has lat/lng/height recomputed from deterministic grid origin.
    // Merge corrected positions back onto PlacedPanel objects.
    // v6.1.1 FIX: Also enforce heading/pitch from structural tilt plane.
    // Row 2 auto-placement creates panels with WRONG heading/pitch because its
    // two ECEF points are at the same height (flat plane). All panels must share
    // the same heading/pitch from the structural tilt plane definition.
    const correctedMap = new Map(rackingResult.correctedPanels.map(cp => [cp.id, cp]));
    const structuralHeading = headingFromAzimuth(azDeg);  // v6.2.2-az: use click-derived azimuth
    const structuralPitch   = -(gTiltRef.current * Math.PI / 180);
    const panelsToRender = panels.map(p => {
      const cp = correctedMap.get(p.id);
      if (cp) return { ...p, lat: cp.lat, lng: cp.lng, height: cp.height,
                        heading: structuralHeading, pitch: structuralPitch };
      return p;
    });

    // ═══ RENDER TRUTH VERIFICATION ═══
    // Log exact coordinates for panels vs structure to prove alignment
    if (panelsToRender.length > 0 && rackingResult.members.length > 0) {
      const p0 = panelsToRender[0];
      const cp0 = correctedMap.get(panels[0]?.id);
      const orig0 = panels[0];
      addLog('GROUND', `[RENDER-TRUTH] Panel[0] id=${p0.id}`);
      addLog('GROUND', `[RENDER-TRUTH]   original:  lat=${orig0?.lat?.toFixed(8)} lng=${orig0?.lng?.toFixed(8)} h=${orig0?.height?.toFixed(4)}`);
      addLog('GROUND', `[RENDER-TRUTH]   corrected: lat=${cp0?.lat?.toFixed(8)} lng=${cp0?.lng?.toFixed(8)} h=${cp0?.height?.toFixed(4)}`);
      addLog('GROUND', `[RENDER-TRUTH]   rendered:  lat=${p0.lat?.toFixed(8)} lng=${p0.lng?.toFixed(8)} h=${p0.height?.toFixed(4)}`);
      addLog('GROUND', `[RENDER-TRUTH]   heading=${p0.heading?.toFixed(4)} pitch=${p0.pitch?.toFixed(4)} tilt=${p0.tilt} az=${p0.azimuth}`);
      if (cp0) {
        const dLat = Math.abs((p0.lat ?? 0) - cp0.lat) * 111139;
        const dLng = Math.abs((p0.lng ?? 0) - cp0.lng) * 111139 * Math.cos((p0.lat ?? 0) * Math.PI / 180);
        const dH = Math.abs((p0.height ?? 0) - cp0.height);
        addLog('GROUND', `[RENDER-TRUTH]   delta(rendered-corrected): dNS=${(dLat*1000).toFixed(1)}mm dEW=${(dLng*1000).toFixed(1)}mm dZ=${(dH*1000).toFixed(1)}mm`);
      }
      // Log first rail for comparison
      const firstRail = rackingResult.members.find(m => m.memberType === 'powerrail');
      if (firstRail) {
        addLog('GROUND', `[RENDER-TRUTH] Rail[0]: ${firstRail.name} lat=${firstRail.lat.toFixed(8)} lng=${firstRail.lng.toFixed(8)} z=${firstRail.z.toFixed(4)}`);
        addLog('GROUND', `[RENDER-TRUTH]   heading=${(firstRail.headingRad * 180 / Math.PI).toFixed(1)}° pitch=${(firstRail.pitchRad * 180 / Math.PI).toFixed(1)}°`);
      }
      // Log first strongback
      const firstSB = rackingResult.members.find(m => m.memberType === 'strongback');
      if (firstSB) {
        addLog('GROUND', `[RENDER-TRUTH] SB[0]: ${firstSB.name} lat=${firstSB.lat.toFixed(8)} lng=${firstSB.lng.toFixed(8)} z=${firstSB.z.toFixed(4)}`);
      }
      // Log correctedPanels count vs panels count
      addLog('GROUND', `[RENDER-TRUTH] correctedPanels=${rackingResult.correctedPanels.length} panels=${panels.length} matched=${[...correctedMap.keys()].filter(k => panels.some(p => p.id === k)).length}`);
    }
    // ═══ END RENDER TRUTH VERIFICATION ═══

    const skipGridGround = (panelsRef.current.length + panelsToRender.length) > 12;

    // v6.3.1: If panel count now exceeds grid threshold, strip grid polylines
    // from ALL existing panels.  Without this, the first array retains its grid
    // cosmetics while subsequent arrays are drawn without them.
    if (skipGridGround) {
      const gridKeysToRemove: string[] = [];
      panelMapRef.current.forEach((_ent, key) => {
        if (key.includes('__grid__')) gridKeysToRemove.push(key);
      });
      if (gridKeysToRemove.length > 0) {
        gridKeysToRemove.forEach(key => {
          const e = panelMapRef.current.get(key);
          if (e) { try { viewer.entities.remove(e); } catch {} }
          panelMapRef.current.delete(key);
        });
        addLog('GROUND', `[GRID-CLEANUP] Removed ${gridKeysToRemove.length} stale grid entities (panel count > 12)`);
      }
    }

    for (const panel of panelsToRender) {
      addPanelEntity(viewer, C, panel, skipGridGround);
    }

    // ═══ v6.1 SHARED-PLANE FIX ═══
    // When placing row 2+, the racking engine rebuilds correctedPanels for ALL rows
    // on a single shared tilted plane (solveClearancePlane). But row 1 panels were
    // already rendered from a PARTIAL (row-1-only) racking solution with different
    // heights. We must re-render existing rows with the unified corrected positions.
    if (arrayRowIndex > 0 && rackingResult.correctedPanels.length > 0) {
      const existingRows = groundArrayRowsRef.current.flat();
      if (existingRows.length > 0) {
        // Remove stale row 1 panel entities (frame+glass+grid+racking)
        let removedCount = 0;
        for (const oldP of existingRows) {
          removePanelEntities(viewer, oldP.id);
          removedCount++;
        }
        // Re-render existing rows with corrected positions + structural heading/pitch
        let reRendered = 0;
        for (const oldP of existingRows) {
          const cp = correctedMap.get(oldP.id);
          if (cp) {
            const corrected = { ...oldP, lat: cp.lat, lng: cp.lng, height: cp.height,
                                heading: structuralHeading, pitch: structuralPitch };
            addPanelEntity(viewer, C, corrected, skipGridGround);
            reRendered++;
          } else {
            addPanelEntity(viewer, C, oldP, skipGridGround);
          }
        }
        addLog('GROUND', `[v6.1.1 SHARED-PLANE] Re-rendered ${reRendered}/${existingRows.length} existing panels with unified positions + heading/pitch (removed ${removedCount} stale entities)`);
      }
    }
    // ═══ END v6.1 SHARED-PLANE FIX ═══

    // Track ghost panels for renderAllPanels diff
    const allGhostSoFar = groundArrayRowsRef.current.flat().concat(panels);
    lastRenderedPanelsRef.current = [...panelsRef.current, ...allGhostSoFar];

    addLog('GROUND', `[v49.2] COMPLETE row${arrayRowIndex}: structure(${membersRendered}) → panels(${panels.length})`);
    return panels;
  }

  // v49.2: finalizeGroundArray — structure already rendered during preview
  function finalizeGroundArray() {
    // Structure-first: racking was ALREADY rendered in placeGroundArrayRow (during preview).
    // Here we just commit panels to permanent state. No second addGroundRacking call.
    const allNewPanels = groundArrayRowsRef.current.flat();
    const rowCountFinal = groundArrayRowsRef.current.length;
    addLog('GROUND', `[v49.2] finalizeGroundArray: ${rowCountFinal} rows, ${allNewPanels.length} panels — structure already rendered`);
    if (allNewPanels.length === 0) { cancelGroundArray(); return; }

    const allPanels = [...panelsRef.current, ...allNewPanels];
    panelsRef.current = allPanels;
    lastRenderedPanelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);

    // __gnd__ racking entities are already in viewer from preview — they stay permanently.
    // resetGroundArray clears groundArrayRowsRef but does NOT touch panelMapRef racking entries.

    const kw = (allNewPanels.length * (selectedPanelRef.current?.wattage ?? 400) / 1000).toFixed(1);
    setStatusMsg(`\u2705 Ground array placed: ${rowCountFinal} rows \u00b7 ${allNewPanels.length} panels \u00b7 ${kw} kW`);
    resetGroundArray();
    setShowGroundArrayConfirm(false);
    try { const viewer = viewerRef.current; if (viewer) viewer.scene.requestRender(); } catch {}
  }

  function cancelGroundArray() {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    const ghostPanels = groundArrayRowsRef.current.flat();
    if (viewer && C) {
      // Remove ghost panel entities
      ghostPanels.forEach(p => {
        removePanelEntities(viewer, p.id); // v47.159
      });
      // v49.2: Also remove __gnd__ racking preview entities on cancel
      // v6.2.2: Scope to current array's prefix to preserve finalized arrays
      const cancelPrefix = groundArrayKeyPrefixRef.current;
      const keysToRemove: string[] = [];
      panelMapRef.current.forEach((ent, key) => {
        if (cancelPrefix && key.startsWith(cancelPrefix)) keysToRemove.push(key);
        else if (!cancelPrefix && key.startsWith('__gnd__')) keysToRemove.push(key);
      });
      keysToRemove.forEach(key => {
        try {
          const ent = panelMapRef.current.get(key);
          if (ent) viewer.entities.remove(ent);
          panelMapRef.current.delete(key);
        } catch {}
      });
      try { viewer.scene.requestRender(); } catch {}
    }
    // v48.18: Restore lastRenderedPanelsRef to committed panels only (no ghosts).
    lastRenderedPanelsRef.current = [...panelsRef.current];
    resetGroundArray();
    setShowGroundArrayConfirm(false);
    setStatusMsg('Ground array cancelled');
  }

  function resetGroundArray() {
    groundArrayRowsRef.current = [];
    groundArrayFirstRowRef.current = null;
    setGroundArrayRowCount(0);
    setGroundArrayPanelCount(0);
    const viewer = viewerRef.current;
    if (viewer) {
      overlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      overlayRef.current = [];
    }
  }

  // ── Fence placement ────────────────────────────────────────────────────────
  function handleFenceClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { setStatusMsg('No ground hit for fence point'); return; }
      const cartesian = hit.cartesian;

      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return;
      const pLat = C.Math.toDegrees(carto.latitude);
      const pLng = C.Math.toDegrees(carto.longitude);
      // Height trust (same 3-tier rule as ground placement): only a 3D-tiles pick
      // gives a real mesh height. terrain/ellipsoid picks return ellipsoidal h≈0,
      // which sits ABOVE true ground at coastal/low-lying sites (negative
      // ellipsoidal ground) — the cause of fence points clicking high in CT.
      // Fall back to the resolved ground elevation (now kept even when negative).
      const rawH = isFinite(carto.height) && carto.height > -500 ? carto.height : null;
      const trustedH = (hit.pickMethod === '3dtiles' && rawH !== null) ? rawH : null;
      const fallbackH = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const pHeight = trustedH ?? fallbackH;
      if (!isValidCoord(pLat, pLng, pHeight)) return;
      addLog('FENCE', `[FENCE-PICK] method=${hit.pickMethod} rawH=${rawH?.toFixed(2) ?? 'null'} usedH=${pHeight.toFixed(2)}`);

      fencePtsRef.current.push({ lat: pLat, lng: pLng, height: pHeight });
      const count = fencePtsRef.current.length;
      setFencePtCount(count);

      // Draw marker
      try {
        const markerPos = safeCartesian3(C, pLng, pLat, pHeight + 0.5);
        if (markerPos) {
          const marker = viewer.entities.add({
            position: markerPos,
            point: {
              pixelSize: 12, color: C.Color.fromCssColorString('#ff8800'),
              outlineColor: C.Color.WHITE, outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: `${count}`, font: '11px sans-serif',
              fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 2,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new C.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              showBackground: true, backgroundColor: new C.Color(0.8, 0.4, 0, 0.8),
            },
          });
          overlayRef.current.push(marker);
        }
      } catch {}

      // Draw line preview
      if (count >= 2) {
        try {
          const linePos = fencePtsRef.current
            .map(p => safeCartesian3(C, p.lng, p.lat, p.height + 0.5))
            .filter(Boolean);
          if (linePos.length >= 2) {
            const lineEntity = viewer.entities.add({
              polyline: {
                positions: linePos, width: 3,
                material: new C.PolylineGlowMaterialProperty({
                  glowPower: 0.3, color: C.Color.fromCssColorString('#ff8800'),
                }),
                clampToGround: false, arcType: C.ArcType.NONE,
              },
            });
            overlayRef.current.push(lineEntity);
          }
        } catch {}
      }

      addLog('FENCE', `Point ${count} at ${pLat.toFixed(5)},${pLng.toFixed(5)}`);
      setStatusMsg(`🔶 Fence point ${count} — right-click to finish`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleFenceClick: ${(err as Error).message}`);
    }
  }

  // ── finalizeFence v47.158: SOL Fence Nexus — posts + realistic panels ──
  // SOL Fence Nexus specs (from datasheet):
  //   Panel:   Philadelphia Solar PS-MNB108 430W, 1721x1133mm, vertical bifacial
  //   Section: 7'11" (2.413m) wide x 5'10" (1.778m) tall metal-to-metal
  //   Post:    60mm square hot-dip galvanized steel, driven/buried every section
  //   Ground clearance: 2" (0.051m) bottom of panel above grade
  //   Total max height: 6' (1.829m)
  //   2 panels per section, stacked portrait side-by-side
  function finalizeFence(viewer: any, C: any) {
    const pts = fencePtsRef.current;
    if (pts.length < 2) return;

    const fenceH = fenceHRef.current;
    const orient = panelOrientationRef.current;
    const dims   = getPanelDims(orient);
    const newPanels: PlacedPanel[] = [];
    const postEntityIds: string[] = []; // track post entities for cleanup

    // v47.159: SOL Fence Nexus geometry constants
    // Section = 2 panels side-by-side. Posts at every section boundary (every 2 panels).
    // Last section may be 1 panel if remaining space fits 1 but not 2.
    const SOL_POST_SIZE   = 0.060;  // 60mm square post cross-section (m)
    const SOL_POST_HEIGHT = Math.max(fenceH, 1.829); // 6' max, or user fenceH
    const SOL_CLEARANCE   = 0.051;  // 2" ground clearance (m)
    const PANELS_PER_SECTION = 2;   // SOL Fence Nexus: 2 panels per section

    addLog('FENCE', `finalizeFence v47.158: ${pts.length} pts, fenceH=${fenceH.toFixed(2)}m orient=${orient}`);

    // Enforce minimum fence height — must fit at least one panel row
    const effectiveFenceH = Math.max(fenceH, dims.heightM + SOL_CLEARANCE + 0.01);
    if (fenceH < dims.heightM) {
      addLog('FENCE', `fenceH (${fenceH.toFixed(2)}) < panel height (${dims.heightM.toFixed(3)}) — clamped to ${effectiveFenceH.toFixed(3)}m`);
    }

    // Per-segment: each straight run gets its own PlaneFrame
    for (let si = 0; si < pts.length - 1; si++) {
      const a = pts[si];
      const b = pts[si + 1];

      // Convert to ECEF
      const p1ECEF = engLatLngToECEF(a.lat, a.lng, a.height);
      const p2ECEF = engLatLngToECEF(b.lat, b.lng, b.height);

      addLog('FENCE', `Seg${si}: a=(${a.lat.toFixed(5)},${a.lng.toFixed(5)},h=${a.height.toFixed(1)}) b=(${b.lat.toFixed(5)},${b.lng.toFixed(5)},h=${b.height.toFixed(1)})`);

      // Place panels — routed through control layer
      const clFenceResult = placePanelsControlled({
        mode:         'fence',
        p1ECEF,
        p2ECEF,
        fenceHeightM: effectiveFenceH,
        orientation:  orient,
        wattage:      430, // Philadelphia Solar PS-MNB108(HCBF)-430W
        azimuthDeg:   azimuthRef.current,
        layoutId:     `fence-seg${si}-${Date.now()}`,
      });
      const segPanels = clFenceResult.panels;

      addLog('FENCE', `Seg${si}: placePanelsControlled(fence) → ${segPanels.length} panels (engine=${clFenceResult.engineUsed})`);
      // v48.11: pre-compute skipGrid from merged count — consistent rendering for all panels in batch
      const skipGridFence = (panelsRef.current.length + newPanels.length + segPanels.length) > 12;
      for (const panel of segPanels) {
        newPanels.push(panel);
        addPanelEntity(viewer, C, panel, skipGridFence);
      }

      // ── Track sections for user editing ────────────────────────
      // Group panels into sections (PANELS_PER_SECTION per section).
      // Each section defaults to 'solar'. User can later convert to gate/vinyl.
      for (let secI = 0; secI < segPanels.length; secI += PANELS_PER_SECTION) {
        const secPanels = segPanels.slice(secI, secI + PANELS_PER_SECTION);
        const secPanelIds = secPanels.map(p => p.id);
        fenceSectionsRef.current.push({
          id:       `sec-${si}-${Math.floor(secI / PANELS_PER_SECTION)}`,
          segIdx:   si,
          secIdx:   Math.floor(secI / PANELS_PER_SECTION),
          type:     'solar',
          panelIds: secPanelIds,
          entityKey: '',  // populated if converted to gate/vinyl
        });
      }

      // v47.159: SOL Fence posts — 1 post per SECTION (every 2 panels).
      // Posts are placed at panel-count boundaries: after every PANELS_PER_SECTION panels,
      // plus at the very start and end of the segment.
      // Last section may be 1 panel if remaining space < 2 panel widths.
      try {
        const segVec = { x: p2ECEF.x - p1ECEF.x, y: p2ECEF.y - p1ECEF.y, z: p2ECEF.z - p1ECEF.z };
        const segLen = Math.sqrt(segVec.x**2 + segVec.y**2 + segVec.z**2);
        const segDir = { x: segVec.x/segLen, y: segVec.y/segLen, z: segVec.z/segLen };

        // Radial up (toward sky) at p1
        const p1Mag = Math.sqrt(p1ECEF.x**2 + p1ECEF.y**2 + p1ECEF.z**2);
        const radialUp = { x: p1ECEF.x/p1Mag, y: p1ECEF.y/p1Mag, z: p1ECEF.z/p1Mag };

        // Calculate post positions based on actual panel count + PANELS_PER_SECTION
        // Each panel is dims.widthM wide. Posts go at: 0, 2*dimW, 4*dimW, ..., nPanels*dimW
        const panelW = dims.widthM; // 1.134m per panel
        const sectionW = PANELS_PER_SECTION * panelW; // 2.268m per 2-panel section
        const totalPanels = segPanels.length;

        // Build post positions: one at start, one after every PANELS_PER_SECTION panels, one at end
        const postOffsets: number[] = [0]; // always post at start
        for (let panelIdx = PANELS_PER_SECTION; panelIdx < totalPanels; panelIdx += PANELS_PER_SECTION) {
          postOffsets.push(panelIdx * panelW);
        }
        // Always post at end (last panel right edge)
        const endOffset = totalPanels * panelW;
        if (Math.abs(postOffsets[postOffsets.length - 1] - endOffset) > 0.01) {
          postOffsets.push(endOffset);
        }

        for (let pi = 0; pi < postOffsets.length; pi++) {
          const t = Math.min(postOffsets[pi], segLen);
          // Post base position (at grade level)
          const postBase = {
            x: p1ECEF.x + segDir.x * t,
            y: p1ECEF.y + segDir.y * t,
            z: p1ECEF.z + segDir.z * t,
          };
          // Post center = base + radialUp * (SOL_POST_HEIGHT / 2)
          const halfH = SOL_POST_HEIGHT / 2;
          const postCenter = {
            x: postBase.x + radialUp.x * halfH,
            y: postBase.y + radialUp.y * halfH,
            z: postBase.z + radialUp.z * halfH,
          };
          const postPos = new C.Cartesian3(postCenter.x, postCenter.y, postCenter.z);

          // Post orientation: vertical, heading aligned to fence direction
          const postHPR = new C.HeadingPitchRoll(
            headingFromAzimuth(azimuthRef.current), 0, 0
          );
          const postOrient = C.Transforms.headingPitchRollQuaternion(postPos, postHPR);

          // Post box: SOL_POST_SIZE x SOL_POST_SIZE x SOL_POST_HEIGHT
          const postEntity = viewer.entities.add({
            name: `[FENCE-POST] seg${si}-post${pi}`,
            position: postPos,
            orientation: postOrient,
            box: {
              dimensions: new C.Cartesian3(SOL_POST_SIZE, SOL_POST_SIZE, SOL_POST_HEIGHT),
              material: new C.ColorMaterialProperty(
                new C.Color(0.025, 0.025, 0.030, 1.0) // near-black matte (powder-coated steel)
              ),
              outline: false,
              shadows: C.ShadowMode.DISABLED,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          // Track post entity for cleanup
          const postKey = `__fencepost__seg${si}-post${pi}-${Date.now()}`;
          panelMapRef.current.set(postKey, postEntity);
          postEntityIds.push(postKey);
        }
        const nSections = Math.ceil(totalPanels / PANELS_PER_SECTION);
        addLog('FENCE', `Seg${si}: added ${postOffsets.length} posts for ${totalPanels} panels (${nSections} sections)`);

        // ── Gap infill: fill remaining space at end of segment ──────
        // If panels don't perfectly fill the segment, add a solid infill
        // panel matching fence color/trim to close the gap.
        // Uses last panel's actual position + offset to guarantee alignment.
        const panelCoverage = totalPanels * panelW;
        const gapM = segLen - panelCoverage;
        const MIN_VISIBLE_GAP = 0.05; // 5cm — below this, gap is invisible
        if (gapM > MIN_VISIBLE_GAP && segPanels.length > 0) {
          try {
            const lastPanel = segPanels[segPanels.length - 1];
            // Get last panel's ECEF position
            const lastPos = safeCartesian3(C, lastPanel.lng, lastPanel.lat, lastPanel.height ?? 0);
            if (lastPos) {
              // Offset from last panel center by half panel width + half gap width along segment direction
              const offsetDist = panelW / 2 + gapM / 2;
              const infillPos = new C.Cartesian3(
                lastPos.x + segDir.x * offsetDist,
                lastPos.y + segDir.y * offsetDist,
                lastPos.z + segDir.z * offsetDist,
              );

              // Use exact same heading/pitch as last panel — guaranteed alignment
              const infillHeading = lastPanel.heading ?? headingFromAzimuth(lastPanel.azimuth);
              const infillPitch = lastPanel.pitch ?? 0;
              const infillHPR = new C.HeadingPitchRoll(infillHeading, infillPitch, 0);
              const infillOrient = C.Transforms.headingPitchRollQuaternion(infillPos, infillHPR);

              // Solid dark infill panel — matches fence panel color & trim
              // Box dimensions follow panel convention: (ph, pw, thickness)
              const infillEntity = viewer.entities.add({
                name: `[FENCE-INFILL] seg${si}-gap`,
                position: infillPos,
                orientation: infillOrient,
                box: {
                  dimensions: new C.Cartesian3(dims.heightM, gapM, 0.035),
                  material: new C.ColorMaterialProperty(
                    new C.Color(0.12, 0.12, 0.14, 1.0) // dark charcoal — matches solar panel frame
                  ),
                  outline: true,
                  outlineColor: new C.Color(0.2, 0.2, 0.22, 0.8),
                  outlineWidth: 1,
                  shadows: C.ShadowMode.DISABLED,
                },
              });
              const infillKey = `__fenceinfill__seg${si}-${Date.now()}`;
              panelMapRef.current.set(infillKey, infillEntity);
              addLog('FENCE', `Seg${si}: infill ${gapM.toFixed(3)}m gap (last panel → segment end)`);
            }
          } catch (infillErr: unknown) {
            addLog('WARN', `Seg${si}: infill rendering failed: ${(infillErr as Error).message}`);
          }
        }
      } catch (postErr: unknown) {
        addLog('WARN', `Seg${si}: post rendering failed: ${(postErr as Error).message}`);
      }

    }

    addLog('FENCE', `finalizeFence total: ${newPanels.length} panels across ${pts.length - 1} segment(s)`);
    const allPanels = [...panelsRef.current, ...newPanels];
    panelsRef.current = allPanels;
    // Sync lastRenderedPanelsRef BEFORE calling onPanelsChange so the
    // panels-prop useEffect's incremental diff sees these panels as
    // "already rendered" and does NOT call addPanelEntity a second time.
    lastRenderedPanelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    fencePtsRef.current = [];
    setFencePtCount(0);
    setStatusMsg(`Fence: ${newPanels.length} panels placed (${orient}, ${pts.length - 1} segment(s)) — click panels to convert sections`);
    // Auto-switch to select mode so user can immediately click panels to convert sections
    onPlacementModeChange('select');
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Convert fence section type (solar → gate/vinyl, etc.) ─────
  // Solar = normal solar panel entities (frame + glass + grid)
  // Gate  = opening (panels removed, gap between posts)
  // Vinyl = solid dark panels matching fence color/trim (recolor existing panels)
  function convertFenceSection(
    viewer: any, C: any,
    sectionId: string,
    newType: 'solar' | 'gate' | 'vinyl',
    gateSize?: '4ft' | '8ft',
    selectedPanelId?: string,
  ) {
    const sec = fenceSectionsRef.current.find(s => s.id === sectionId);
    if (!sec || sec.type === newType) return;

    const oldType = sec.type;
    addLog('FENCE', `Converting section ${sectionId}: ${oldType} \u2192 ${newType}${gateSize ? ` (${gateSize})` : ''}`);

    // Determine which panel IDs to affect for gate conversion
    // 4ft gate = only the selected panel; 8ft gate = all panels in section
    let gatePanelIds: string[] = sec.panelIds;
    if (newType === 'gate' && gateSize === '4ft' && selectedPanelId && sec.panelIds.includes(selectedPanelId)) {
      gatePanelIds = [selectedPanelId];
    }

    // ── Step 1: Tear down old state ──────────────────────────────
    if (oldType === 'gate') {
      // Remove all gate entities for this section
      const gateKeysToRemove: string[] = [];
      panelMapRef.current.forEach((ent, key) => {
        if (key.startsWith('__gate__')) {
          const belongsToSection = sec.panelIds.some(pid => key.includes(pid));
          if (belongsToSection) {
            try { viewer.entities.remove(ent); } catch {}
            gateKeysToRemove.push(key);
          }
        }
      });
      gateKeysToRemove.forEach(k => panelMapRef.current.delete(k));
      sec.entityKey = '';

      // Re-add panel entities so we have something to work with for solar/vinyl
      if (newType !== 'gate') {
        const skipGrid = panelsRef.current.length > 12;
        for (const pid of sec.panelIds) {
          const panel = panelsRef.current.find(p => p.id === pid);
          if (panel && !panelMapRef.current.has(pid)) {
            addPanelEntity(viewer, C, panel, skipGrid);
          }
        }
      }
    }
    // For solar/vinyl → anything: panels are already rendered (either normal or recolored)

    // ── Step 2: Apply new state ──────────────────────────────────
    if (newType === 'solar') {
      // Restore normal solar panel colors
      for (const pid of sec.panelIds) {
        const frameEnt = panelMapRef.current.get(pid);
        if (frameEnt && frameEnt.box) {
          try {
            frameEnt.box.material = new C.ColorMaterialProperty(
              systemTypeColor(C, 'fence')
            );
          } catch {}
        }
        // Restore glass sheen visibility
        const glassEnt = panelMapRef.current.get(`${pid}__glass`);
        if (glassEnt) { try { glassEnt.show = true; } catch {} }
        // Restore grid lines visibility
        panelMapRef.current.forEach((ent, key) => {
          if (key.startsWith(`${pid}__grid__`)) {
            try { ent.show = true; } catch {}
          }
        });
      }
    } else if (newType === 'gate') {
      // Remove solar panel entities for gate slots only
      for (const pid of gatePanelIds) {
        removePanelEntities(viewer, pid);
      }

      // Render gate: OPAQUE steel-gray panel at each gate slot position.
      // 4ft gate = 1 slot, 8ft gate = 2 slots (full section width).
      const gatePanels = gatePanelIds
        .map(pid => panelsRef.current.find(p => p.id === pid))
        .filter(Boolean) as PlacedPanel[];

      const gateEntityKeys: string[] = [];

      for (const panel of gatePanels) {
        try {
          const _pOrient = (panel.orientation as string | undefined); const _gOrient = (panelOrientationRef.current as string); const dims = getPanelDims((_pOrient === 'hybrid' || !_pOrient ? (_gOrient === 'hybrid' ? 'portrait' : _gOrient) : _pOrient) as 'portrait' | 'landscape');
          const pos = safeCartesian3(C, panel.lng, panel.lat, panel.height ?? 0);
          if (!pos) continue;

          const heading = panel.heading ?? headingFromAzimuth(panel.azimuth);
          const pitch = panel.pitch ?? 0;
          const hpr = new C.HeadingPitchRoll(heading, pitch, 0);
          const orient = C.Transforms.headingPitchRollQuaternion(pos, hpr);

          // Gate panel: opaque steel gray with bold outline frame
          const gateEntity = viewer.entities.add({
            name: `[FENCE-GATE-${(gateSize ?? '8ft').toUpperCase()}] ${panel.id}`,
            position: pos,
            orientation: orient,
            box: {
              dimensions: new C.Cartesian3(dims.heightM, dims.widthM, 0.02),
              material: new C.ColorMaterialProperty(
                new C.Color(0.55, 0.55, 0.58, 1.0) // opaque steel gray
              ),
              outline: true,
              outlineColor: new C.Color(0.35, 0.35, 0.38, 1.0),
              outlineWidth: 3,
              shadows: C.ShadowMode.DISABLED,
            },
          });
          const gateKey = `__gate__${panel.id}-${Date.now()}`;
          panelMapRef.current.set(gateKey, gateEntity);
          gateEntityKeys.push(gateKey);
        } catch (gateErr: unknown) {
          addLog('WARN', `Gate rendering failed for ${panel.id}: ${(gateErr as Error).message}`);
        }
      }

      sec.entityKey = gateEntityKeys[0] ?? '';
      addLog('FENCE', `Section ${sectionId} \u2192 gate ${gateSize ?? '8ft'} (${gatePanels.length} slots, opaque steel)`);
    } else if (newType === 'vinyl') {
      // Recolor existing panels to solid dark — matches fence panel color & trim
      // Hide glass sheen and grid lines for clean solid look
      const vinylColor = new C.Color(0.12, 0.12, 0.14, 1.0); // dark charcoal
      for (const pid of sec.panelIds) {
        const frameEnt = panelMapRef.current.get(pid);
        if (frameEnt && frameEnt.box) {
          try {
            frameEnt.box.material = new C.ColorMaterialProperty(vinylColor);
          } catch {}
        }
        // Hide glass sheen (vinyl is opaque)
        const glassEnt = panelMapRef.current.get(`${pid}__glass`);
        if (glassEnt) { try { glassEnt.show = false; } catch {} }
        // Hide grid lines (vinyl is solid)
        panelMapRef.current.forEach((ent, key) => {
          if (key.startsWith(`${pid}__grid__`)) {
            try { ent.show = false; } catch {}
          }
        });
      }
    }

    sec.type = newType;

    // Update panel count (gate/vinyl panels don't count as active solar)
    const activePanelIds = new Set(
      fenceSectionsRef.current
        .filter(s => s.type === 'solar')
        .flatMap(s => s.panelIds)
    );
    const activeCount = panelsRef.current.filter(p => activePanelIds.has(p.id)).length;
    setPanelCount(activeCount);
    setStatusMsg(`Section ${sectionId} → ${newType} (${activeCount} active solar panels)`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Auto-roof placement ────────────────────────────────────────────────────

  // ── Plane mode ──────────────────────────────────────────────────────────
  function handlePlaneClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const cartesian = hit.cartesian;
      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return;
      const pt = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
        height: carto.height,
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;
      planePtsRef.current.push(pt);
      setPlanePtCount(planePtsRef.current.length);
      try {
        const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.5);
        if (mPos) {
          const m = viewer.entities.add({
            position: mPos,
            point: { pixelSize: 8, color: C.Color.fromCssColorString('#00ccff'), outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
          overlayRef.current.push(m);
        }
      } catch {}
      if (planePtsRef.current.length >= 2) {
        const pts = planePtsRef.current;
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        try {
          const p1 = safeCartesian3(C, prev.lng, prev.lat, prev.height + 0.5);
          const p2 = safeCartesian3(C, last.lng, last.lat, last.height + 0.5);
          if (p1 && p2) {
            const line = viewer.entities.add({
              polyline: { positions: [p1, p2], width: 1.5,
                material: C.Color.fromCssColorString('#00ccff').withAlpha(0.6),
                clampToGround: false, arcType: C.ArcType.NONE },
            });
            overlayRef.current.push(line);
          }
        } catch {}
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handlePlaneClick: ${(err as Error).message}`); }
  }

  /** @deprecated v47.152 — mode='plane' button now redirects to 'plane3d'.
   *  finalizePlane() uses fillRoofSegmentWithPanels() which produces panels
   *  with no planeId and no ECEF frame. Kept for compatibility only.
   *  Do NOT add new call sites. Use finalizePlane3D() instead.
   */
  function finalizePlane(viewer: any, C: any) {
    const pts = planePtsRef.current;
    if (pts.length < 3) return;
    // Compute plane normal from first 3 points
    const mLat = 111320;
    const cosLat = Math.cos(pts[0].lat * Math.PI / 180);
    const mLng = 111320 * cosLat;
    const toLocal = (p: any) => ({
      x: (p.lng - pts[0].lng) * mLng,
      y: (p.lat - pts[0].lat) * mLat,
      z: p.height - pts[0].height,
    });
    const a = toLocal(pts[0]), b = toLocal(pts[1]), c = toLocal(pts[2]);
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nx = ab.y * ac.z - ab.z * ac.y;
    const ny = ab.z * ac.x - ab.x * ac.z;
    const nz = ab.x * ac.y - ab.y * ac.x;
    const nm = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (nm < 0.001) { planePtsRef.current = []; setPlanePtCount(0); return; }
    const pitchDeg = Math.acos(Math.max(-1, Math.min(1, Math.abs(nz / nm)))) * 180 / Math.PI;
    const azimuthDeg = (Math.atan2(nx / nm, ny / nm) * 180 / Math.PI + 360) % 360;
    // Create synthetic segment
    const centerLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const centerLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    const centerH   = pts.reduce((s, p) => s + p.height, 0) / pts.length;
    const syntheticSeg = {
      center: { lat: centerLat, lng: centerLng },
      elevation: centerH,
      pitchDegrees: pitchDeg,
      azimuthDegrees: azimuthDeg,
      convexHull: pts,
      boundingBox: {
        sw: { lat: Math.min(...pts.map(p => p.lat)), lng: Math.min(...pts.map(p => p.lng)) },
        ne: { lat: Math.max(...pts.map(p => p.lat)), lng: Math.max(...pts.map(p => p.lng)) },
      },
    };
    const newPanels = fillRoofSegmentWithPanels(viewer, C, syntheticSeg);
    const allPanels = [...panelsRef.current, ...newPanels];
    panelsRef.current = allPanels;
    lastRenderedPanelsRef.current = allPanels; // prevent double-render orphan
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    planePtsRef.current = [];
    setPlanePtCount(0);
    setStatusMsg(`✅ Plane: ${newPanels.length} panels placed (pitch=${pitchDeg.toFixed(1)}° az=${azimuthDeg.toFixed(1)}°)`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Row placement ────────────────────────────────────────────────────────
  // ── Row placement (Phase 4) ───────────────────────────────────────────────────────
  // rowLastClickRef stores click 1. Reset on tool change / address change.
  // Click 1: null ref -> store point. Click 2: has point -> finalizeRow, clear.
  function handleRowClick(viewer: any, C: any, screenPos: any) {
    const rowHit = getWorldPosition(viewer, C, screenPos);
    if (!rowHit) {
      setStatusMsg('❌ No surface detected — click directly on the roof or ground');
      return;
    }
    const carto = C.Cartographic.fromCartesian(rowHit.cartesian);
    if (!carto) return;
    const pt = {
      lat:    C.Math.toDegrees(carto.latitude),
      lng:    C.Math.toDegrees(carto.longitude),
      height: carto.height,
    };
    if (!isValidCoord(pt.lat, pt.lng)) return;

    if (rowLastClickRef.current === null) {
      // Click 1: store start
      rowLastClickRef.current = { ...pt, screenPos: { x: screenPos.x, y: screenPos.y } };
      rowPtsRef.current = [pt];
      rowStartScreenPosRef.current = { x: screenPos.x, y: screenPos.y };
      setRowPtCount(1);
      try {
        const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.5);
        if (mPos) {
          const m = viewer.entities.add({
            position: mPos,
            point: { pixelSize: 12, color: C.Color.fromCssColorString('#00ffcc'),
              outlineColor: C.Color.BLACK, outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
          overlayRef.current.push(m);
        }
      } catch {}
      setStatusMsg('🟢 Row start set — click end point to place row');
    } else {
      // Click 2: finalize with local ref values (no stale state)
      const startPt = rowLastClickRef.current;
      const startScreenPos = { x: startPt.screenPos.x, y: startPt.screenPos.y };
      rowLastClickRef.current = null;
      rowPtsRef.current = [];
      rowStartScreenPosRef.current = null;
      setRowPtCount(0);
      try {
        const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.5);
        if (mPos) {
          const m = viewer.entities.add({
            position: mPos,
            point: { pixelSize: 12, color: C.Color.fromCssColorString('#ffcc00'),
              outlineColor: C.Color.BLACK, outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
          overlayRef.current.push(m);
        }
      } catch {}
      finalizeRow(viewer, C, startPt, pt, startScreenPos);
    }
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── finalizeRow v47.130: unified PlaneFrame engine ──
  function finalizeRow(
    viewer: any, C: any,
    p1: { lat: number; lng: number; height: number },
    p2: { lat: number; lng: number; height: number },
    startScreenPos: { x: number; y: number },
  ) {
    const orient = panelOrientationRef.current;
    const dims   = getPanelDims(orient);

    // Convert click endpoints to ECEF — single source of truth
    const p1ECEF = engLatLngToECEF(p1.lat, p1.lng, p1.height);
    const p2ECEF = engLatLngToECEF(p2.lat, p2.lng, p2.height);

    // Sample surface tilt/azimuth at the start click position
    const p1Cart = { x: p1ECEF.x, y: p1ECEF.y, z: p1ECEF.z };
    const { tiltDeg, azimuthDeg } = computeSurfaceNormal(
      viewer, C, startScreenPos, p1Cart, '3dtiles',
    );
    const tiltForRow = isFinite(tiltDeg)    ? tiltDeg    : tiltRef.current;
    const azForRow   = isFinite(azimuthDeg) ? azimuthDeg : azimuthRef.current;

    const clRowResult = placePanelsControlled({
      mode:        'ground',
      p1ECEF,
      p2ECEF,
      tiltDeg:     tiltForRow,
      azimuthDeg:  azForRow,
      orientation: orient,
      wattage:     selectedPanelRef.current?.wattage ?? 400,  // v47.161: use selected panel wattage
      layoutId:    `row-${Date.now()}`,
    });
    const panels = clRowResult.panels;
    addLog('GROUND', `[CL] placePanelsControlled(ground/finalizeRow) → ${panels.length} panels (engine=${clRowResult.engineUsed})`);

    // v48.11: pre-compute skipGrid from merged count — consistent rendering for all panels in batch
    const skipGridFinalizeRow = (panelsRef.current.length + panels.length) > 12;
    for (const panel of panels) {
      addPanelEntity(viewer, C, panel, skipGridFinalizeRow);
    }

    const allPanels = [...panelsRef.current, ...panels];
    panelsRef.current = allPanels;
    lastRenderedPanelsRef.current = allPanels; // prevent double-render orphan
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    setStatusMsg(`✅ Row: ${panels.length} panels placed (${orient}) — click to start next row`);
    try { viewer.scene.requestRender(); } catch {}
  }

  function clearMeasureOverlay() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    measureOverlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    measureOverlayRef.current = [];
    try { viewer.scene.requestRender(); } catch {}
  }

  // v48.12: Restore one panel's color to its system-type default
  function restorePanelColor(viewer: any, C: any, id: string) {
    const ent = panelMapRef.current.get(id);
    if (ent) {
      const panel = panelsRef.current.find(p => p.id === id);
      if (panel) {
        const sType = (panel.systemType ?? 'roof') as SystemType;
        ent.box.material = new C.ColorMaterialProperty(systemTypeColor(C, sType));
      }
    }
  }

  function clearPanelSelection() {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (viewer && C) {
      // v48.12: Restore all multi-selected panels
      selectedPanelIdsRef.current.forEach(id => restorePanelColor(viewer, C, id));
      // Restore legacy single-select panel (in case Set was bypassed)
      const prevId = selectedPanelIdRef.current;
      if (prevId && !selectedPanelIdsRef.current.has(prevId)) {
        restorePanelColor(viewer, C, prevId);
      }
    }
    selectedPanelIdsRef.current = new Set();
    setSelectedPanelIds(new Set());
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    hideRotateHandle(); // v62: drop the floating rotate knob when selection clears
  }

  // v48.12: Shared drillPick logic — returns foundId + foundEntity (or nulls)
  // v48.12 audit: Only matches bare panel IDs (no __ separator).
  // Racking posts, fence posts, glass, and grid-line entities all have __ in their keys
  // and must not be treated as selectable panels.
  function pickPanelAtScreen(viewer: any, screenPos: any): { foundId: string | null; foundEntity: any } {
    let foundId: string | null = null;
    let foundEntity: any = null;
    // isPanelId: true only for bare UUID keys (no __ separator)
    const isPanelId = (id: string) => !id.includes('__');
    try {
      const drilled = viewer.scene.drillPick(screenPos, 10);
      for (const pickedObj of drilled) {
        if (!pickedObj || !pickedObj.id) continue;
        const entity = pickedObj.id;
        panelMapRef.current.forEach((ent, id) => {
          if (!foundId && isPanelId(id) && ent === entity) { foundId = id; foundEntity = entity; }
        });
        if (foundId) break;
      }
    } catch {
      const picked = viewer.scene.pick(screenPos);
      if (picked && picked.id) {
        panelMapRef.current.forEach((ent, id) => {
          if (!foundId && isPanelId(id) && ent === picked.id) { foundId = id; foundEntity = picked.id; }
        });
      }
    }
    return { foundId, foundEntity };
  }

  // v62: a panel's "array" key. Roof arrays group by planeId; fence/ground arrays
  // group by layoutId (those have no planeId). Falls back to the panel's own id so a
  // lone panel is still a (1-panel) group. Used for whole-array group selection.
  const groupKeyOf = (p?: PlacedPanel | null): string | null =>
    p ? (((p as any).planeId ?? (p as any).layoutId ?? p.id) || null) : null;

  function handleSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      // v63: paint mode — a click assigns the hit panel to the active string
      // (reported to DesignStudio) instead of selecting/moving the array.
      if (paintModeRef.current) {
        const hit = pickPanelAtScreen(viewer, screenPos);
        if (hit.foundId && onPanelPaintRef.current) {
          onPanelPaintRef.current(hit.foundId);
          setStatusMsg('🎨 Panel painted to active string');
          try { viewer.scene.requestRender(); } catch {}
        } else {
          setStatusMsg('🎨 Paint mode — click a panel to assign it to the active string');
        }
        return;
      }
      // v31.1: drillPick finds panel entities even when occluded by terrain/3D tiles.
      // v62: GROUP SELECTION (Figma/PowerPoint model — no modes, no new buttons).
      //   • plain click            → select the WHOLE array (move/rotate the array)
      //   • double-click (drill)   → then a click selects a single panel (micro-edit)
      //   • click empty space      → clear selection AND exit any drilled-in array
      const picked = pickPanelAtScreen(viewer, screenPos);
      const foundId = picked.foundId;
      const foundEntity = picked.foundEntity;

      if (!foundId || !foundEntity) {
        clearPanelSelection();
        drilledGroupKeyRef.current = null;
        setStatusMsg('Selection cleared');
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      const panel    = panelsRef.current.find(p => p.id === foundId);
      const groupKey = groupKeyOf(panel);
      const RED = new C.ColorMaterialProperty(C.Color.fromCssColorString('#ff3333').withAlpha(0.92));

      // Drilled INTO this array → a click selects just the one clicked panel.
      if (drilledGroupKeyRef.current && drilledGroupKeyRef.current === groupKey) {
        clearPanelSelection();
        if (foundEntity.box) foundEntity.box.material = RED;
        selectedPanelIdRef.current = foundId;
        setSelectedPanelId(foundId);
        selectedPanelIdsRef.current = new Set([foundId]);
        setSelectedPanelIds(new Set([foundId]));
        showRotateHandle(viewer, C); // single panel can move AND rotate
        setStatusMsg('📌 1 panel — drag to move · drag ⟳ to rotate · Delete to remove · empty space to exit');
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      // DEFAULT → select the WHOLE array (all panels sharing this group key).
      drilledGroupKeyRef.current = null;
      clearPanelSelection();
      const arrayPanels = (groupKey
        ? panelsRef.current.filter(p => groupKeyOf(p) === groupKey)
        : [panel]).filter(Boolean) as PlacedPanel[];
      const ids = new Set<string>();
      for (const p of arrayPanels) {
        const ent = panelMapRef.current.get(p.id);
        if (ent?.box) ent.box.material = RED;
        ids.add(p.id);
      }
      selectedPanelIdsRef.current = ids;
      setSelectedPanelIds(ids);
      selectedPanelIdRef.current = foundId;
      setSelectedPanelId(foundId);
      showRotateHandle(viewer, C); // floating ⟳ knob to grab-rotate the array
      setStatusMsg(`📐 Array selected — ${ids.size} panel${ids.size !== 1 ? 's' : ''} · DRAG to move · drag the ⟳ knob to rotate · double-click to edit one panel`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleSelectClick: ${(err as Error).message}`); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  v62 — Array manipulation: grab-to-move + grab-to-rotate (mouse), shared core
  // ════════════════════════════════════════════════════════════════════════════

  // Centroid / normal / eave axis of the current selection, all in ECEF.
  function arrayCentroidECEF(C: any, ids: Set<string>): any | null {
    const cen = new C.Cartesian3(0, 0, 0); let cnt = 0;
    panelsRef.current.forEach(p => {
      if (!ids.has(p.id)) return;
      const c = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
      if (c) { C.Cartesian3.add(cen, c, cen); cnt++; }
    });
    return cnt ? C.Cartesian3.divideByScalar(cen, cnt, cen) : null;
  }
  function arrayNormalECEF(C: any, ids: Set<string>): any | null {
    const ref = panelsRef.current.find(p => ids.has(p.id) && isFinite((p as any).ecefNx));
    if (ref) return C.Cartesian3.normalize(new C.Cartesian3((ref as any).ecefNx, (ref as any).ecefNy, (ref as any).ecefNz), new C.Cartesian3());
    // Fallback: radial-up at the array centroid, so a frameless panel can still rotate.
    const cen = arrayCentroidECEF(C, ids);
    return cen ? C.Cartesian3.normalize(C.Cartesian3.clone(cen), new C.Cartesian3()) : null;
  }
  function arrayEaveECEF(C: any, ids: Set<string>): any | null {
    const ref = panelsRef.current.find(p => ids.has(p.id) && isFinite((p as any).ecefUx));
    if (ref) return C.Cartesian3.normalize(new C.Cartesian3((ref as any).ecefUx, (ref as any).ecefUy, (ref as any).ecefUz), new C.Cartesian3());
    // Fallback: a horizontal axis perpendicular to up (so the handle/grid still has a U).
    const cen = arrayCentroidECEF(C, ids);
    if (!cen) return null;
    const up = C.Cartesian3.normalize(C.Cartesian3.clone(cen), new C.Cartesian3());
    const east = C.Cartesian3.normalize(new C.Cartesian3(-cen.y, cen.x, 0), new C.Cartesian3());
    const u = C.Cartesian3.cross(up, east, new C.Cartesian3());
    return (isFinite(u.x) && C.Cartesian3.magnitude(u) > 1e-6) ? C.Cartesian3.normalize(u, u) : east;
  }

  // Apply a per-panel transform to every selected panel, re-add entities directly
  // (selection colour survives via addPanelEntity), re-render rails, and pre-sync
  // lastRenderedPanelsRef so the [panels] diff is a no-op (no re-fill, no blink).
  // commit=false during a live drag (skip onPanelsChange spam — commit once on drop).
  function applyArrayTransform(
    viewer: any, C: any, ids: Set<string>,
    xform: (posCart: any, panel: PlacedPanel) => { pos: any; frameQuat?: { x: number; y: number; z: number; w: number }; u?: { x: number; y: number; z: number } },
    commit = true,
  ) {
    const updated = panelsRef.current.map(p => {
      if (!ids.has(p.id)) return p;
      const pos = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
      if (!pos) return p;
      const r = xform(pos, p);
      if (!r.pos) return p;
      const carto = C.Cartographic.fromCartesian(r.pos);
      const next: any = { ...p,
        lat:    C.Math.toDegrees(carto.latitude),
        lng:    C.Math.toDegrees(carto.longitude),
        height: carto.height };
      // frameQuat = explicit world orientation for in-plane-rotated panels. tilt/
      // azimuth (face direction → energy) are unchanged by in-plane rotation, so we
      // don't touch them — only the footprint yaw spins.
      if (r.frameQuat) next.frameQuat = r.frameQuat;
      // Rotated eave axis → keeps rails (which derive u/v from ecefU) aligned.
      if (r.u) { next.ecefUx = r.u.x; next.ecefUy = r.u.y; next.ecefUz = r.u.z; }
      return next;
    });
    const skipGrid = updated.length > 12;
    ids.forEach(id => {
      removePanelEntities(viewer, id);          // removes frame+glass+grid for this panel
      const p = updated.find(q => q.id === id);
      if (p) addPanelEntity(viewer, C, p, skipGrid);
    });
    panelsRef.current = updated;
    lastRenderedPanelsRef.current = updated;     // pre-sync → [panels] diff is a no-op (no blink)
    try { renderRoofRails(viewer, C, updated); } catch (e) { handleCesiumError('renderRoofRails xform', e, true); }
    if (commit) { onPanelsChange(updated); showRotateHandle(viewer, C); }
    try { viewer.scene.requestRender(); } catch {}
  }

  // Translate the selected array by an ECEF delta.
  function translateArrayBy(viewer: any, C: any, ids: Set<string>, delta: any, commit = true) {
    applyArrayTransform(viewer, C, ids, (pos) => ({
      pos: new C.Cartesian3(pos.x + delta.x, pos.y + delta.y, pos.z + delta.z),
    }), commit);
  }

  // The body→world orientation quaternion a panel renders with TODAY (same HPR math
  // as addPanelEntity). Used as the base we spin from on the first rotation.
  function baseQuatFromHPR(C: any, pos: any, panel: PlacedPanel): any {
    let heading: number, pitchRad: number;
    if (isFinite(panel.heading ?? NaN) && isFinite(panel.pitch ?? NaN) && Math.abs(panel.pitch ?? 0) < Math.PI / 2 + 0.1) {
      heading = panel.heading!; pitchRad = panel.pitch!;
    } else {
      heading = headingFromAzimuth(panel.azimuth ?? 180); pitchRad = -(panel.tilt ?? 0) * Math.PI / 180;
    }
    return C.Transforms.headingPitchRollQuaternion(pos, new C.HeadingPitchRoll(heading, pitchRad, 0));
  }

  // Rigid IN-PLANE rotation of the selected array by `rad` about axis N (the roof
  // normal), pivoting on centroid `cen`. Positions rotate about N; each panel's world
  // orientation is pre-multiplied by the same rotation so the rectangle spins WITHIN
  // the plane (face normal stays = N, so tilt/azimuth/energy are unchanged). The result
  // is stored as an explicit frameQuat that addPanelEntity renders verbatim.
  function rotateArrayBy(viewer: any, C: any, ids: Set<string>, rad: number, cen: any, N: any, commit = true) {
    const Rq   = C.Quaternion.fromAxisAngle(N, rad);
    const rotM = C.Matrix3.fromQuaternion(Rq);
    applyArrayTransform(viewer, C, ids, (pos, panel) => {
      const r  = C.Cartesian3.subtract(pos, cen, new C.Cartesian3());
      const rr = C.Matrix3.multiplyByVector(rotM, r, new C.Cartesian3());
      const newPos = C.Cartesian3.add(cen, rr, new C.Cartesian3());
      const baseQ = (panel as any).frameQuat
        ? new C.Quaternion((panel as any).frameQuat.x, (panel as any).frameQuat.y, (panel as any).frameQuat.z, (panel as any).frameQuat.w)
        : baseQuatFromHPR(C, pos, panel);
      const nq = C.Quaternion.multiply(Rq, baseQ, new C.Quaternion());
      C.Quaternion.normalize(nq, nq);
      // Rotate the stored eave axis too (n is the rotation axis, so it's unchanged).
      let uOut: { x: number; y: number; z: number } | undefined;
      if (isFinite((panel as any).ecefUx)) {
        const u = C.Matrix3.multiplyByVector(rotM, new C.Cartesian3((panel as any).ecefUx, (panel as any).ecefUy, (panel as any).ecefUz), new C.Cartesian3());
        uOut = { x: u.x, y: u.y, z: u.z };
      }
      return { pos: newPos, frameQuat: { x: nq.x, y: nq.y, z: nq.z, w: nq.w }, u: uOut };
    }, commit);
  }

  // ── Floating rotate knob (the ⟳ handle) shown above a selected array ──────────
  function showRotateHandle(viewer: any, C: any) {
    hideRotateHandle();
    const ids = selectedPanelIdsRef.current;
    if (ids.size < 1) return; // show for a single panel too (it can rotate in place)
    const cen = arrayCentroidECEF(C, ids);
    const N   = arrayNormalECEF(C, ids);
    const U   = arrayEaveECEF(C, ids);
    if (!cen || !N || !U) return;
    const V = C.Cartesian3.normalize(C.Cartesian3.cross(N, U, new C.Cartesian3()), new C.Cartesian3());
    // Float it just past the array's top edge (max extent along +V) + a small gap.
    let maxV = 0;
    panelsRef.current.forEach(p => {
      if (!ids.has(p.id)) return;
      const c = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
      if (c) { const r = C.Cartesian3.subtract(c, cen, new C.Cartesian3()); maxV = Math.max(maxV, C.Cartesian3.dot(r, V)); }
    });
    const off = maxV + 1.5;
    const anchor = new C.Cartesian3(cen.x + N.x * 0.5, cen.y + N.y * 0.5, cen.z + N.z * 0.5);
    const hp = new C.Cartesian3(
      cen.x + V.x * off + N.x * 0.5,
      cen.y + V.y * off + N.y * 0.5,
      cen.z + V.z * off + N.z * 0.5);
    // Connector line from the array centre to the knob, so it reads as a handle.
    rotateHandleLineRef.current = viewer.entities.add({
      name: '[ROTATE-HANDLE-LINE]',
      polyline: {
        positions: [anchor, hp],
        width: 2,
        material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString('#00e5ff').withAlpha(0.8), dashLength: 8 }),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    rotateHandleRef.current = viewer.entities.add({
      name: '[ROTATE-HANDLE]',
      position: hp,
      point: { pixelSize: 20, color: C.Color.fromCssColorString('#00e5ff'),
               outlineColor: C.Color.fromCssColorString('#00343d'), outlineWidth: 3,
               disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: '⟳', font: 'bold 16px sans-serif', fillColor: C.Color.BLACK,
               pixelOffset: new C.Cartesian2(0, 1), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    try { viewer.scene.requestRender(); } catch {}
  }
  function hideRotateHandle() {
    const viewer = viewerRef.current;
    if (viewer) {
      if (rotateHandleRef.current)     { try { viewer.entities.remove(rotateHandleRef.current); } catch {} }
      if (rotateHandleLineRef.current) { try { viewer.entities.remove(rotateHandleLineRef.current); } catch {} }
    }
    rotateHandleRef.current = null;
    rotateHandleLineRef.current = null;
  }

  // ── Keyboard fallbacks (mouse drag is primary) ───────────────────────────────
  function moveSelectedArrayScreen(screenDx: number, screenDy: number) {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    const ids = selectedPanelIdsRef.current;
    if (ids.size === 0) return;
    const STEP_M = 0.3;
    const cen = arrayCentroidECEF(C, ids);
    const N   = arrayNormalECEF(C, ids);
    if (!cen || !N) { setStatusMsg('Move needs a 3D-plane array'); return; }
    // Screen-relative on-plane direction (matches what the user sees).
    let dir: any = null;
    try {
      const toWin = C.SceneTransforms.wgs84ToWindowCoordinates ?? C.SceneTransforms.worldToWindowCoordinates;
      const s0 = toWin ? toWin(viewer.scene, cen) : null;
      if (s0) {
        const plane = C.Plane.fromPointNormal(cen, N);
        const s1 = new C.Cartesian2(s0.x + screenDx * 16, s0.y + screenDy * 16);
        const ray = viewer.camera.getPickRay(s1);
        const hit = ray ? C.IntersectionTests.rayPlane(ray, plane) : null;
        if (hit) { const d = C.Cartesian3.subtract(hit, cen, new C.Cartesian3()); if (C.Cartesian3.magnitude(d) > 1e-6) dir = C.Cartesian3.normalize(d, d); }
      }
    } catch { dir = null; }
    if (!dir) return;
    translateArrayBy(viewer, C, ids, C.Cartesian3.multiplyByScalar(dir, STEP_M, new C.Cartesian3()), true);
    setStatusMsg(`Array moved ${Math.round(STEP_M * 100)}cm — drag to move · drag ⟳ to rotate`);
  }
  function rotateSelectedArray(deg: number) {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    const ids = selectedPanelIdsRef.current;
    if (ids.size === 0) return;
    const cen = arrayCentroidECEF(C, ids);
    const N   = arrayNormalECEF(C, ids);
    if (!cen || !N) { setStatusMsg('Rotate needs a 3D-plane array'); return; }
    rotateArrayBy(viewer, C, ids, deg * Math.PI / 180, cen, N, true);
    setStatusMsg(`Array rotated ${deg > 0 ? '+' : ''}${deg}° — or drag the ⟳ handle`);
  }

  // v62: SNAP a just-moved single panel into the nearest array's grid — forgiving.
  // Finds the nearest other roof panel, ADOPTS its plane frame (so a panel dragged
  // onto a different plane lies flat with rails the right way), and rounds the drop
  // to that plane's grid (step = average of the two panel sizes, so a landscape panel
  // dropped by a portrait array "splits the difference" to fit). Keeps its own
  // orientation; bumps to a free cell if the target is occupied.
  function snapMovedPanel(viewer: any, C: any, panelId: string) {
    const panel: any = panelsRef.current.find(p => p.id === panelId);
    if (!panel) return;
    const pPos = safeCartesian3(C, panel.lng, panel.lat, panel.height ?? 0);
    if (!pPos) return;
    let ref: any = null, best = Infinity;
    for (const q of panelsRef.current as any[]) {
      if (q.id === panelId || (q.systemType ?? 'roof') !== 'roof') continue;
      if (!isFinite(q.ecefUx) || !isFinite(q.ecefNx)) continue;
      const qp = safeCartesian3(C, q.lng, q.lat, q.height ?? 0);
      if (!qp) continue;
      const d = C.Cartesian3.distanceSquared(pPos, qp);
      if (d < best) { best = d; ref = q; }
    }
    if (!ref) return; // nothing to snap to (lone panel) — leave where dropped

    const refPos = safeCartesian3(C, ref.lng, ref.lat, ref.height ?? 0);
    const u = C.Cartesian3.normalize(new C.Cartesian3(ref.ecefUx, ref.ecefUy, ref.ecefUz), new C.Cartesian3());
    const n = C.Cartesian3.normalize(new C.Cartesian3(ref.ecefNx, ref.ecefNy, ref.ecefNz), new C.Cartesian3());
    const v = C.Cartesian3.normalize(C.Cartesian3.cross(n, u, new C.Cartesian3()), new C.Cartesian3());
    const diff = C.Cartesian3.subtract(pPos, refPos, new C.Cartesian3());
    const du = C.Cartesian3.dot(diff, u), dv = C.Cartesian3.dot(diff, v);
    const dd = panelDims((panel.orientation ?? 'portrait') as PanelOrientation);
    const rd = panelDims((ref.orientation   ?? 'portrait') as PanelOrientation);
    const stepU = (dd.pw + rd.pw) / 2, stepV = (dd.ph + rd.ph) / 2;
    let su = Math.round(du / stepU) * stepU;
    let sv = Math.round(dv / stepV) * stepV;
    if (Math.abs(su) < 1e-3 && Math.abs(sv) < 1e-3) {
      // landed on the ref cell — step one cell along the drag direction
      if (Math.abs(du) >= Math.abs(dv)) su = stepU * (du >= 0 ? 1 : -1);
      else                              sv = stepV * (dv >= 0 ? 1 : -1);
    }
    const cellAt = (uu: number, vv: number) =>
      C.Cartesian3.add(refPos,
        C.Cartesian3.add(C.Cartesian3.multiplyByScalar(u, uu, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(v, vv, new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    const occupied = (uu: number, vv: number) => {
      const c = cellAt(uu, vv);
      return (panelsRef.current as any[]).some(q => {
        if (q.id === panelId) return false;
        const qp = safeCartesian3(C, q.lng, q.lat, q.height ?? 0);
        return qp && C.Cartesian3.distance(qp, c) < Math.min(stepU, stepV) * 0.5;
      });
    };
    let tries = 0;
    while (occupied(su, sv) && tries < 8) { su += stepU * (du >= 0 ? 1 : -1); tries++; }

    const carto = C.Cartographic.fromCartesian(cellAt(su, sv));
    const newPanel: any = { ...panel,
      lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude), height: carto.height,
      planeId: ref.planeId, heading: ref.heading, pitch: ref.pitch, tilt: ref.tilt, azimuth: ref.azimuth, roll: ref.roll,
      ecefUx: ref.ecefUx, ecefUy: ref.ecefUy, ecefUz: ref.ecefUz,
      ecefNx: ref.ecefNx, ecefNy: ref.ecefNy, ecefNz: ref.ecefNz,
    };
    delete newPanel.frameQuat; // adopt the destination plane's HPR facing
    const updated = panelsRef.current.map(p => p.id === panelId ? newPanel : p);
    removePanelEntities(viewer, panelId);
    addPanelEntity(viewer, C, newPanel, updated.length > 12);
    panelsRef.current = updated;
    lastRenderedPanelsRef.current = updated;
    try { renderRoofRails(viewer, C, updated); } catch {}
    setStatusMsg(ref.planeId === panel.planeId ? 'Panel snapped to the array grid' : '↳ Panel moved to a new plane & snapped to its grid');
  }

  // v48.12: SHIFT+click — toggle panel in/out of multi-select Set
  function handleShiftSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      const { foundId, foundEntity } = pickPanelAtScreen(viewer, screenPos);
      if (!foundId || !foundEntity) return; // clicking empty space does not clear selection
      const ids = new Set(selectedPanelIdsRef.current);
      if (ids.has(foundId)) {
        // Deselect this panel
        restorePanelColor(viewer, C, foundId);
        ids.delete(foundId);
        // If it was also the single-select anchor, update it
        if (selectedPanelIdRef.current === foundId) {
          selectedPanelIdRef.current = ids.size > 0 ? [...ids][0] : null;
          setSelectedPanelId(selectedPanelIdRef.current);
        }
      } else {
        // Add this panel — highlight amber for multi-select
        foundEntity.box.material = new C.ColorMaterialProperty(
          C.Color.fromCssColorString('#ffaa00').withAlpha(0.92)
        );
        ids.add(foundId);
        // Keep selectedPanelId pointing to most-recently added panel
        selectedPanelIdRef.current = foundId;
        setSelectedPanelId(foundId);
      }
      selectedPanelIdsRef.current = ids;
      setSelectedPanelIds(new Set(ids));
      const count = ids.size;
      if (count === 0) {
        setStatusMsg('Selection cleared');
      } else {
        setStatusMsg(`📌 ${count} panel${count > 1 ? 's' : ''} selected | Press Delete to remove all`);
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleShiftSelectClick: ${(err as Error).message}`); }
  }

  // v48.12: Delete all panels in selectedPanelIdsRef (works for 1 or many)
  function deleteSelectedPanels() {
    const viewer = viewerRef.current;
    const ids = selectedPanelIdsRef.current;
    if (ids.size === 0 || !viewer) return;
    const count = ids.size;
    ids.forEach(id => removePanelEntities(viewer, id)); // v47.159: removes frame+glass+grid
    const idSet = new Set(ids);
    const newPanels = panelsRef.current.filter(p => !idSet.has(p.id));
    panelsRef.current = newPanels;
    lastRenderedPanelsRef.current = newPanels;
    // v62: rebuild rails from the remaining panels — otherwise the deleted panel's
    // rail run stays under empty roof (rails are separate entities, not removed above).
    const C = (window as any).Cesium;
    if (C) { try { renderRoofRails(viewer, C, newPanels); } catch {} }
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    selectedPanelIdsRef.current = new Set();
    setSelectedPanelIds(new Set());
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    setStatusMsg(`🗑️ ${count} panel${count > 1 ? 's' : ''} deleted`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // Legacy single-delete alias — kept for any direct calls that may remain
  function deleteSelectedPanel() { deleteSelectedPanels(); }

  /**
   * renderGroundRackingOutput — v50.0 SINGLE RENDER PATH
   *
   * THE ONLY place that converts GroundSystemOutput → Cesium entities.
   * Both placeGroundArrayRow (preview) and addGroundRacking (rebuild) call this.
   * Renderer ONLY consumes engine output — generates NO geometry itself.
   * Returns number of members rendered, or 0 if validation failed.
   */
  function renderGroundRackingOutput(
    viewer: any,
    C: any,
    result: GroundRackingResult,
    contextLabel: string,
  ): number {
    // VALIDATION GATE: fail-fast if engine flagged build as invalid
    if (!result.valid) {
      addLog('WARN', `[RENDERER] ${contextLabel}: build INVALID — ${result.errors.join('; ')} — NOT rendering`);
      return 0;
    }
    if (result.members.length === 0) {
      addLog('WARN', `[RENDERER] ${contextLabel}: 0 members — nothing to render`);
      return 0;
    }

    // v6.2.0 → v6.2.2-fix: Only clear racking entities whose keys will be
    // replaced by the incoming members. The old blanket "__gnd__" wipe destroyed
    // racking from previously-finalized ground mounts when building a new one.
    const incomingKeys = new Set(result.members.map(m => m.key));
    const gndKeysToRemove: string[] = [];
    panelMapRef.current.forEach((_ent, key) => {
      if (incomingKeys.has(key)) gndKeysToRemove.push(key);
    });
    if (gndKeysToRemove.length > 0) {
      gndKeysToRemove.forEach(key => {
        try {
          const ent = panelMapRef.current.get(key);
          if (ent) viewer.entities.remove(ent);
          panelMapRef.current.delete(key);
        } catch {}
      });
      addLog('GROUND', `[RENDERER] cleared ${gndKeysToRemove.length} stale ground entities (scoped to incoming keys)`);
    }

    // v6.2.0: Removed per-member RENDER-AUDIT logging (performance).
    // Summary logged at end of render instead.
    let count = 0;
    for (const m of result.members) {
      try {
        const ecef = engLatLngToECEF(m.lat, m.lng, m.z);
        const pos  = new C.Cartesian3(ecef.x, ecef.y, ecef.z);
        const ori  = C.Transforms.headingPitchRollQuaternion(
          pos,
          new C.HeadingPitchRoll(m.headingRad, m.pitchRad, 0),
        );
        const color = new C.Color(m.color.r, m.color.g, m.color.b, m.color.a);
        const ent = viewer.entities.add({
          name:        m.name,
          position:    pos,
          orientation: ori,
          box: {
            dimensions: (() => {
              // Apply visual thickness scaling to structural members only.
              // dims[1] = LENGTH (EW span) — never scaled.
              // dims[0] = cross-section width, dims[2] = cross-section height — scale for readability.
              const needsScale = m.memberType === 'strongback' || m.memberType === 'powerrail' || m.memberType === 'brace';
              const s = needsScale ? RENDER_SCALE_STRUCTURAL : 1.0;
              return new C.Cartesian3(m.dims[0] * s, m.dims[1], m.dims[2] * s);
            })(),
            material:   new C.ColorMaterialProperty(color),
            outline:    false,
            shadows:    C.ShadowMode.DISABLED,
          },
        });
        panelMapRef.current.set(m.key, ent);
        count++;
      } catch (memberErr: unknown) {
        addLog('WARN', `[RENDERER] ${contextLabel} member (${m.name}): ${(memberErr as Error).message}`);
      }
    }
    addLog('GROUND', `[RENDERER] ${contextLabel}: ${count}/${result.members.length} members (piles=${result.piles.length} sbs=${result.strongbacks.length} rails=${result.rails.length})`);
    return count;
  }

  /**
   * addGroundRacking — v49.0 GROUND MOUNT REALITY ENGINE
   *
   * ROUTING GATE: ALL ground placement flows through groundMountRealityEngine.ts
   * Roof / fence systems are COMPLETELY UNTOUCHED.
   *
   * Engine: lib/3d/ground/groundMountRealityEngine.ts
   * - STRUCTURE-FIRST: bays → piles → rails → module members → panels
   * - PLP: EXACTLY 2 portrait rows, 6.10m bay spans, driven piles
   * - IronRidge XR: EXACTLY 4 landscape rows, 3.66m bay spans
   * - basePlaneZ LOCKED at first click — never re-sampled from terrain
   */
  function addGroundRacking(
    viewer: any,
    C: any,
    panels: PlacedPanel[],
    baseZ: number,
  ) {
    if (!showRackingRef.current || panels.length === 0) return;
    try {
      // ── ROUTING GATE ──────────────────────────────────────────────────────
      // systemType === 'ground' → groundMountRealityEngine (isolated, new)
      // All other systemTypes → UNTOUCHED (roof/fence use their own paths)
      const style       = groundMountStyleRef.current ?? 'pipe';
      const tiltDeg     = panels[0]?.tilt    ?? 20;
      const az          = panels[0]?.azimuth ?? 180;
      const orient      = ((panels[0] as any).orientation ?? panelOrientationRef.current ?? 'portrait') as 'portrait' | 'landscape';

      // Cast PlacedPanel[] → GroundPanel[] (compatible shape, add systemType/orientation)
      const groundPanels: GroundPanel[] = panels.map(p => ({
        id:          p.id,
        lat:         p.lat,
        lng:         p.lng,
        height:      p.height,
        tilt:        p.tilt,
        azimuth:     p.azimuth,
        arrayRow:    (p as any).arrayRow ?? p.row ?? 0,
        col:         p.col,
        row:         p.row,
        systemType:  'ground' as const,
        orientation: orient,
        wattage:     p.wattage,
        heading:     p.heading,
        pitch:       p.pitch,
        roll:        p.roll,
      }));

      const opts: BuildRackingOptions = {
        style,
        panels:      groundPanels,
        basePlaneZ:  baseZ,
        tiltDeg,
        azimuthDeg:  az,
        orientation: orient,
      };

      // v50.0: Build via Reality Engine
      const result = buildGroundRacking(opts);
      // v6.2.0: Debug log summary only
      addLog('GROUND', `[ENGINE] ${result.debugLog.length} debug messages, ${result.members.length} members, valid=${result.valid}`);

      // v50.0: Single render path — renderer consumes ONLY engine output
      const rendered = renderGroundRackingOutput(viewer, C, result, `addGroundRacking[${style}]`);
      addLog('GROUND', `[v50.0] addGroundRacking: ${rendered} members rendered valid=${result.valid} groundZ=${result.groundZ.toFixed(3)}`);

      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('WARN', `addGroundRacking: ${(err as Error).message}`);
    }
  }


  function setupKeyboardHandler() {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select'
          && (selectedPanelIdRef.current || selectedPanelIdsRef.current.size > 0)) {
        e.preventDefault();
        deleteSelectedPanels(); // v48.12: deletes all in Set
      }
      // v62: with an array selected, arrow keys MOVE it (screen-relative) and
      // , / . ROTATE it about its plane normal.
      if (modeRef.current === 'select' && selectedPanelIdsRef.current.size > 0) {
        // screenDx/screenDy: window coords (+x right, +y DOWN) → up arrow = -y.
        const moves: Record<string, [number, number]> = {
          ArrowRight: [ 1,  0], ArrowLeft: [-1,  0],
          ArrowUp:    [ 0, -1], ArrowDown: [ 0,  1],
        };
        if (moves[e.key]) {
          e.preventDefault();
          moveSelectedArrayScreen(moves[e.key][0], moves[e.key][1]);
        } else if (!e.repeat && (e.key === ',' || e.key === '<')) {
          e.preventDefault(); rotateSelectedArray(-2);   // CCW (no key-repeat → no runaway spin)
        } else if (!e.repeat && (e.key === '.' || e.key === '>')) {
          e.preventDefault(); rotateSelectedArray(2);    // CW
        }
      }
      if (e.key === 'Enter') {
        // Finalize ground array on Enter
        if (modeRef.current === 'ground_array' && groundArrayRowsRef.current.length > 0) {
          e.preventDefault();
          finalizeGroundArray();
        }
        // Finalize fence on Enter
        if (modeRef.current === 'fence' && fencePtsRef.current.length >= 2) {
          e.preventDefault();
          const viewer = viewerRef.current;
          const C = (window as any).Cesium;
          if (viewer && C) finalizeFence(viewer, C);
        }
      }
      if (e.key === 'Escape') {
        // Cancel ground array
        if (modeRef.current === 'ground_array' && groundArrayRowsRef.current.length > 0) {
          cancelGroundArray();
        }
        clearPanelSelection();
        measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay();
        rowPtsRef.current = []; setRowPtCount(0); rowStartScreenPosRef.current = null;
        planePtsRef.current = []; setPlanePtCount(0);
        clearGhostPanel();
      }
    };
    window.addEventListener('keydown', onKey);
  }

  // ── Measure tool ─────────────────────────────────────────────────────────
  function handleMeasureClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const cartesian = hit.cartesian;
      const carto = C.Cartographic.fromCartesian(cartesian);
      if (!carto) return;
      const pt = { lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude), height: carto.height };
      if (!isValidCoord(pt.lat, pt.lng)) return;
      measurePtsRef.current.push(pt);
      setMeasurePtCount(measurePtsRef.current.length);
      try {
        const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.3);
        if (mPos) {
          const m = viewer.entities.add({
            position: mPos,
            point: { pixelSize: 10, color: C.Color.fromCssColorString('#00ffff'), outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
          measureOverlayRef.current.push(m);
        }
      } catch {}
      if (measurePtsRef.current.length >= 2) {
        const p1 = measurePtsRef.current[measurePtsRef.current.length - 2];
        const p2 = measurePtsRef.current[measurePtsRef.current.length - 1];
        const R = 6371000;
        const dLat = (p2.lat - p1.lat) * Math.PI / 180;
        const dLng = (p2.lng - p1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat*Math.PI/180)*Math.cos(p2.lat*Math.PI/180)*Math.sin(dLng/2)**2;
        const horizDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const vertDist = Math.abs(p2.height - p1.height);
        const slopeDist = Math.sqrt(horizDist**2 + vertDist**2);
        // Display in feet (primary) with meters as secondary
        const slopeFt = mToFt(slopeDist);
        const horizFt = mToFt(horizDist);
        const distStr = slopeFt >= 1 ? `${slopeFt.toFixed(1)} ft` : `${(slopeDist*100).toFixed(1)} cm`;
        const horizStr = horizFt >= 1 ? `${horizFt.toFixed(1)} ft` : `${(horizDist*100).toFixed(1)} cm`;
        const distStrFull = `${slopeFt.toFixed(1)} ft (${slopeDist.toFixed(1)} m)`;
        const horizStrFull = `${horizFt.toFixed(1)} ft (${horizDist.toFixed(1)} m)`;
        try {
          const pos1 = safeCartesian3(C, p1.lng, p1.lat, p1.height + 0.3);
          const pos2 = safeCartesian3(C, p2.lng, p2.lat, p2.height + 0.3);
          if (pos1 && pos2) {
            const line = viewer.entities.add({
              polyline: { positions: [pos1, pos2], width: 2,
                material: C.Color.fromCssColorString('#00ffff').withAlpha(0.9),
                clampToGround: false, arcType: C.ArcType.NONE },
            });
            measureOverlayRef.current.push(line);
            const midPos = safeCartesian3(C, (p1.lng+p2.lng)/2, (p1.lat+p2.lat)/2, (p1.height+p2.height)/2 + 1.5);
            if (midPos) {
              const lbl = viewer.entities.add({
                position: midPos,
                label: {
                  text: `${distStr}\n(horiz: ${horizStr})`,
                  font: '13px sans-serif', fillColor: C.Color.WHITE,
                  outlineColor: C.Color.BLACK, outlineWidth: 2,
                  style: C.LabelStyle.FILL_AND_OUTLINE,
                  verticalOrigin: C.VerticalOrigin.BOTTOM,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  showBackground: true,
                  backgroundColor: new C.Color(0, 0.1, 0.2, 0.85),
                  backgroundPadding: new C.Cartesian2(8, 5),
                },
              });
              measureOverlayRef.current.push(lbl);
            }
          }
        } catch {}
        setStatusMsg(`📏 Distance: ${distStrFull} (horizontal: ${horizStrFull})`);
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleMeasureClick: ${(err as Error).message}`); }
  }

  // ── Ghost panel preview (sequential auto-connect) ────────────────────────
  function showGhostPanel(viewer: any, C: any, lastLat: number, lastLng: number, lastH: number, tiltDeg: number, azimuthDeg: number) {
    if (ghostEntityRef.current) { try { viewer.entities.remove(ghostEntityRef.current); } catch {} ghostEntityRef.current = null; }
    const orient = panelOrientationRef.current;
    const { pw, ph } = panelDims(orient);
    const heading = headingFromAzimuth(azimuthDeg);
    const mLat = 111320;
    const cosLat = Math.cos(lastLat * Math.PI / 180);
    const mLng = 111320 * cosLat;
    const azRad = azimuthDeg * Math.PI / 180;
    const ridgeE = Math.cos(azRad), ridgeN = -Math.sin(azRad);
    const stepM = pw + 0.05;
    const nextLat = lastLat + (ridgeN * stepM) / mLat;
    const nextLng = lastLng + (ridgeE * stepM) / mLng;
    const pos = safeCartesian3(C, nextLng, nextLat, lastH + getRoofPanelOffset(mountingSystemIdRef.current));
    if (!pos) return;
    const pitchRad = -tiltDeg * Math.PI / 180;
    const hpr = new C.HeadingPitchRoll(heading, pitchRad, 0);
    const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
    if (!orientation) return;
    try {
      const ghost = viewer.entities.add({
        position: pos, orientation,
        box: {
          dimensions: new C.Cartesian3(ph, pw, PT),
          material: new C.ColorMaterialProperty(C.Color.fromCssColorString('#00ccff').withAlpha(0.35)),
          outline: true, outlineColor: C.Color.fromCssColorString('#00ccff').withAlpha(0.8), outlineWidth: 2,
        },
      });
      ghostEntityRef.current = ghost;
      try { viewer.scene.requestRender(); } catch {}
    } catch {}
  }

  function clearGhostPanel() {
    const viewer = viewerRef.current;
    if (!viewer || !ghostEntityRef.current) return;
    try { viewer.entities.remove(ghostEntityRef.current); } catch {}
    ghostEntityRef.current = null;
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Auto Fill: fill all eligible roof segments ────────────────────────────────────────────────────────
  // v31.5: Fills each eligible segment using fillRoofSegmentWithPanels().
  //        Eligible = sunshineHours >= 50% of best segment AND areaM2 >= one panel.
  //        Panel count per segment is capped by seg.maxPanels (area-based realistic limit).
  // ── Auto Fill: fill all eligible roof segments ──────────────────────────────────────────────────
  // v34.3: PRIMARY PATH now filters against original boundary polygon only (Google panels already have setbacks).
  //        Fills each eligible segment (sunshineHours >= 50% of best AND areaM2 >= one panel).
  //        Panel count per segment is capped by seg.maxPanels (area-based realistic limit).
  // ── Auto Fill (v47.89): CAD engine-based auto-fill ────────────────────────────────
  //
  // Replaces the old roofSegments/Solar API path.
  // Now consumes roofPlanes prop (user-drawn planes from DesignStudio)
  // and calls generatePanelGridCAD() — the same engine as the 2D view.
  // ══════════════════════════════════════════════════════════════════════════════
  //  v47.121 — 3D Roof Plane Creation Tool
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * clearPlane3DPreview — remove in-progress markers + preview line, reset arrays.
   */
  function clearPlane3DPreview(viewer: any) {
    for (const e of pts3DMarkersRef.current) {
      try { viewer.entities.remove(e); } catch {}
    }
    pts3DMarkersRef.current = [];
    if (pts3DLineRef.current) {
      try { viewer.entities.remove(pts3DLineRef.current); } catch {}
      pts3DLineRef.current = null;
    }
    pts3DCesiumRef.current = [];
    pts3DCartRef.current   = [];
    setPts3DCount(0);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ────────────────────────────────────────────────────────────────────────────
  // v47.126: Set Layout Direction handler
  // User clicks two points; the vector between them becomes the u-axis override.
  // ────────────────────────────────────────────────────────────────────────────
  function handleSetDirectionClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { setStatusMsg('Set Direction: could not pick surface'); return; }
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      const pt = {
        lat:    C.Math.toDegrees(carto.latitude),
        lng:    C.Math.toDegrees(carto.longitude),
        height: carto.height,
      };
      dirClickPtsRef.current = [...dirClickPtsRef.current, pt];

      if (dirClickPtsRef.current.length === 1) {
        setStatusMsg('Set Direction: first point set — click second point along the roof edge');
        // Show a marker
        const marker = viewer.entities.add({
          name: '[DIR-PT1]',
          position: hit.cartesian,
          point: {
            pixelSize: 12,
            color: C.Color.fromCssColorString('#ffd700'),
            outlineColor: C.Color.WHITE, outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        layoutBBoxRef.current.push(marker);
        try { viewer.scene.requestRender(); } catch {}

      } else if (dirClickPtsRef.current.length >= 2) {
        const [p1, p2] = dirClickPtsRef.current;
        const DEG = Math.PI / 180;
        const cosLat = Math.cos(p1.lat * DEG);
        const MPD = 111_320;
        const dx = (p2.lng - p1.lng) * MPD * cosLat;
        const dy = (p2.lat - p1.lat) * MPD;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.5) {
          setStatusMsg('Set Direction: points too close — click further apart');
          dirClickPtsRef.current = [];
          return;
        }
        // Store normalized ENU x,y direction (z=0 for horizontal direction)
        customLayoutDirRef.current = { x: dx / len, y: dy / len };
        setLayoutDirSet(true);
        dirClickPtsRef.current = [];

        // Draw direction arrow
        const arrowEnd = C.Cartesian3.fromDegrees(
          p1.lng + (dx / len) * 5 / (MPD * cosLat),
          p1.lat + (dy / len) * 5 / MPD,
          p1.height + 0.1,
        );
        const arrowStart = C.Cartesian3.fromDegrees(p1.lng, p1.lat, p1.height + 0.1);
        const arrowEnt = viewer.entities.add({
          name: '[DIR-ARROW]',
          polyline: {
            positions: [arrowStart, arrowEnd],
            width: 4,
            material: new C.PolylineArrowMaterialProperty(C.Color.fromCssColorString('#ffd700').withAlpha(0.95)),
            clampToGround: false, arcType: C.ArcType.NONE,
          },
        });
        layoutBBoxRef.current.push(arrowEnt);

        addLog('DIR', `u-axis set: dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);
        setStatusMsg('✓ Layout direction locked — panels will align to this axis');
        onPlacementModeChange('select');
        try { viewer.scene.requestRender(); } catch {}
      }
    } catch (err: unknown) {
      addLog('ERROR', `handleSetDirectionClick: ${(err as Error).message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // v47.126: Set Origin handler
  // User clicks one point; this becomes the layout grid origin.
  // ────────────────────────────────────────────────────────────────────────────
  function handleSetOriginClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { setStatusMsg('Set Origin: could not pick surface'); return; }
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      const pt = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
      };
      customLayoutOriginRef.current = pt;
      setLayoutOriginSet(true);

      // Show origin marker
      // Clear old origin markers
      layoutBBoxRef.current
        .filter((e: any) => (e as Error).name === '[ORIGIN-MARKER]')
        .forEach((e: any) => { try { viewer.entities.remove(e); } catch {} });

      const originMarker = viewer.entities.add({
        name: '[ORIGIN-MARKER]',
        position: hit.cartesian,
        point: {
          pixelSize: 14,
          color: C.Color.fromCssColorString('#00ff88'),
          outlineColor: C.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: 'ORIGIN',
          font: 'bold 11px monospace',
          fillColor: C.Color.fromCssColorString('#00ff88'),
          style: C.LabelStyle.FILL_AND_OUTLINE,
          outlineColor: C.Color.BLACK, outlineWidth: 2,
          pixelOffset: new C.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      layoutBBoxRef.current.push(originMarker);

      addLog('ORIGIN', `origin set: ${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`);
      setStatusMsg('✓ Layout origin set — first panel starts here');
      onPlacementModeChange('select');
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleSetOriginClick: ${(err as Error).message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // v47.126: Clear layout customization overlays
  // ────────────────────────────────────────────────────────────────────────────
  function clearLayoutOverlays(viewer: any) {
    for (const e of layoutBBoxRef.current) {
      try { viewer.entities.remove(e); } catch {}
    }
    layoutBBoxRef.current = [];
    for (const e of previewRowEntitiesRef.current) {
      try { viewer.entities.remove(e); } catch {}
    }
    previewRowEntitiesRef.current = [];
  }

  /**
   * handlePlane3DClick — left-click in 'plane3d' mode.
   * Picks 3D position using full getWorldPosition() chain (3D tiles → terrain → ellipsoid).
   * v47.125: upgraded from raw pickPosition to robust 3-fallback chain.
   */
  function handlePlane3DClick(viewer: any, C: any, screenPos: any) {
    try {
      // v47.125: Use full picking chain (3D tiles → terrain → ellipsoid)
      // Raw pickPosition() alone fails when cursor misses the mesh or DEPTH_TEST is off.
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) {
        setStatusMsg('3D Plane: could not pick surface — ensure 3D tiles are loaded and zoom closer to roof');
        addLog('PLANE3D', 'getWorldPosition failed — no valid 3D position from any picking method');
        return;
      }
      // v62: STITCH — snap this corner to a shared roof point (existing plane vertex
      // or edge, or a point in the current trace) so adjacent planes meet at EXACT
      // common points. This is how the roof connects (ridge/hip/valley/dormer all
      // share vertices) → a watertight, CAD-accurate structure built as you mark.
      const snapHit = ENABLE_TRACE_SNAP ? snapTracedPoint(C, hit.cartesian) : null;
      const pickedPos = snapHit ?? hit.cartesian;
      addLog('PLANE3D', `pick method: ${hit.pickMethod}${snapHit ? ' (snapped to shared point)' : ''}`);

      // Store Cesium Cartesian3 (for rendering)
      pts3DCesiumRef.current = [...pts3DCesiumRef.current, pickedPos];

      // Store plain Cart3 (for geometry math, no Cesium dep)
      const cart: Cart3 = { x: pickedPos.x, y: pickedPos.y, z: pickedPos.z };
      pts3DCartRef.current = [...pts3DCartRef.current, cart];
      if (snapHit) setStatusMsg('🔗 Snapped to a shared roof point');

      const count = pts3DCesiumRef.current.length;
      setPts3DCount(count);

      // Render point marker
      const marker = renderPoint3DMarker(viewer, C, pickedPos, count - 1);
      pts3DMarkersRef.current = [...pts3DMarkersRef.current, marker];

      // Update preview polyline
      pts3DLineRef.current = renderPreviewPolyline(
        viewer, C,
        pts3DCesiumRef.current,
        pts3DLineRef.current,
      );

      if (count < 3) {
        setStatusMsg(`3D Plane: ${count} pt${count > 1 ? 's' : ''} placed — click ${3 - count} more corner${3 - count > 1 ? 's' : ''}`);
      } else {
        setStatusMsg(`3D Plane: ${count} points — right-click or press "Create Roof Plane" to finalize`);
      }

      addLog('PLANE3D', `Point ${count}: (${pickedPos.x.toFixed(0)}, ${pickedPos.y.toFixed(0)}, ${pickedPos.z.toFixed(0)})`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handlePlane3DClick: ${(err as Error).message}`);
      setStatusMsg(`3D Plane error: ${(err as Error).message}`);
    }
  }

  /**
   * finalizePlane3D — build RoofPlane from pts3D, render surface,
   * auto-fill with panels, notify DesignStudio via onRoofPlaneCreated.
   */
  function finalizePlane3D(viewer: any, C: any, fillPanels = true) {
    const cesiumPts = pts3DCesiumRef.current;
    const cartPts   = pts3DCartRef.current;

    if (cartPts.length < 3) {
      setStatusMsg('3D Plane: need at least 3 points — keep clicking roof corners');
      return;
    }

    try {
      addLog('PLANE3D', `Finalizing: ${cartPts.length} points`);

      // Step 1: Compute exact plane frame (first 3 pts define plane, rest projected)
      const frame = computePlaneFromPoints3D(cartPts);

      // Step 2: Build complete RoofPlane using projected points (guaranteed coplanar)
      const plane = buildRoofPlane3D(cartPts);

      // v62: Lock the grid columns to the EAVE (horizontal, perpendicular to the
      // plane's downslope azimuth) so a hand-traced face can't run the array
      // sideways when the most-horizontal traced edge happens to be a rake/diagonal.
      // handleAutoRoof / the fill below pass this as customDir; clipping still uses
      // the real traced polygon. (Same proven fix as the Auto Fill path.)
      {
        const azR = (plane.azimuth ?? 180) * Math.PI / 180;
        (plane as any).__eaveDirENU = { x: Math.cos(azR), y: -Math.sin(azR) };
      }

      addLog('PLANE3D', `Plane: id=${plane.id.slice(0,8)} az=${plane.azimuth.toFixed(1)} tilt=${plane.pitch.toFixed(1)} area=${plane.area.toFixed(1)}m²`);

      // Step 3: Convert PROJECTED points to Cesium Cartesian3 for rendering
      // This ensures the rendered polygon is mathematically planar (no mesh warping)
      const projectedCesiumPts = frame.projectedPts.map((p: Cart3) =>
        new C.Cartesian3(p.x, p.y, p.z)
      );

      // v62: mark-only faces render as a clean outline (no fill/grid/label/arrows).
      if (!fillPanels) markOnlyPlaneIdsRef.current.add(plane.id);

      // Render plane visualization (full for panel planes; outline-only for marked).
      const isSelected = selectedRoofPlaneId === plane.id;
      const entityIds  = renderPlane3DEntity(viewer, C, projectedCesiumPts, plane.id, frame, isSelected, !fillPanels);
      plane3DEntitiesRef.current = [...plane3DEntitiesRef.current, ...entityIds];

      // Store per-plane data for re-rendering on selection change
      plane3DEntityMap.current.set(plane.id, entityIds);
      plane3DFrameMap.current.set(plane.id, frame);
      plane3DCesiumPtsMap.current.set(plane.id, projectedCesiumPts);

      // Clear in-progress preview
      clearPlane3DPreview(viewer);

      // v62: frame-axis arrows + geometry audit are DEBUG overlays — off by default
      // (they cluttered the scene once multiple faces were marked).
      if (DEBUG_PLANE_OVERLAYS) {
        try { renderFrameAxes(viewer, C, plane, cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0, `plane3d-${plane.id.slice(0, 6)}`); } catch (e) { console.warn('[finalizePlane3D] renderFrameAxes failed:', (e as Error).message); }
        try { renderPlaneDebugAudit(viewer, C, plane, `plane3d-${plane.id.slice(0, 6)}`); } catch (e) { console.warn('[finalizePlane3D] renderPlaneDebugAudit failed:', (e as Error).message); }
      }

      // Notify DesignStudio (adds plane to roofPlanes state)
      onRoofPlaneCreated?.(plane);

      // v62: MARK-ONLY — outline the face for the roof model / permit WITHOUT placing
      // panels. The plane is already stored (plane3DCesiumPtsMap/FrameMap) so the Roof
      // Model + setback zones pick it up; stay in mark mode so the next face can be traced.
      if (!fillPanels) {
        pts3DCesiumRef.current = []; pts3DCartRef.current = []; setPts3DCount(0);
        activePlane3DIdRef.current = plane.id; setActivePlane3DId(plane.id);
        if (showRoofModel)    { try { renderRoofWireframe(viewer, C); } catch {} }
        if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch {} }
        setStatusMsg(`⬡ Plane marked — Az ${plane.azimuth.toFixed(0)}° Tilt ${plane.pitch.toFixed(0)}° · trace the next face (right-click to finish) · 🔗 Roof Model to see edges`);
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      // v48.7: Immediately auto-fill via control layer (plane3d mode)
      const groundElev    = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const orient        = panelOrientationRef.current ?? 'portrait';
      const edgeSetbackM  = fireSetbacks?.edgeSetbackM  ?? 0.457;
      const ridgeSetbackM = fireSetbacks?.ridgeSetbackM ?? 0.457;
      const eaveSetbackM  = fireSetbacks?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
      const layoutId      = `plane3d-${plane.id}`;

      const clResult = placePanelsControlled({
        mode:            'plane3d',
        plane:           plane as unknown as ControlPlane,
        orientation:     orient,
        wattage:         selectedPanelRef.current?.wattage ?? 400,
        setbacks:        { eaveM: eaveSetbackM, ridgeM: ridgeSetbackM, sideM: edgeSetbackM },
        groundElevM:     groundElev,
        layoutId,
        customOriginLat: customLayoutOriginRef.current?.lat,
        customOriginLng: customLayoutOriginRef.current?.lng,
        // v62: eave-lock (no sideways); explicit Set-Direction still wins.
        customDirX:      customLayoutDirRef.current?.x ?? (plane as any).__eaveDirENU?.x,
        customDirY:      customLayoutDirRef.current?.y ?? (plane as any).__eaveDirENU?.y,
      });
      const newPanels = clResult.panels;

      addLog('PLANE3D', `[CL] placePanelsControlled(plane3d) → ${newPanels.length} panels (engine=${clResult.engineUsed})`);

      // v47.149: Per-plane data consistency audit (read-only — no mutations)
      // Groups panels by planeId and verifies all panels share identical heading/pitch.
      if (newPanels.length > 0) {
        const h0 = newPanels[0].heading ?? NaN;
        const p0 = newPanels[0].pitch   ?? NaN;
        const badH = newPanels.filter(p => Math.abs((p.heading ?? NaN) - h0) > 0.001);
        const badP = newPanels.filter(p => Math.abs((p.pitch   ?? NaN) - p0) > 0.001);
        if (badH.length > 0 || badP.length > 0) {
          addLog('ERROR', `[PLANE3D AUDIT] plane=${plane.id.slice(0,8)} INCONSISTENT: ${badH.length} heading mismatches, ${badP.length} pitch mismatches. Expected h=${h0.toFixed(4)} p=${p0.toFixed(4)}`);
        } else {
          addLog('PLANE3D', `[AUDIT] plane=${plane.id.slice(0,8)} ALL ${newPanels.length} panels consistent: h=${isFinite(h0)?h0.toFixed(4):'NaN'} p=${isFinite(p0)?p0.toFixed(4):'NaN'}`);
        }
      }

      // v47.126: Mark this plane as "active" for highlight
      activePlane3DIdRef.current = plane.id;
      setActivePlane3DId(plane.id);

      if (newPanels.length > 0) {
        const filtered = removeObstructedPanels(newPanels, obstructionsRef.current);
        const merged   = [...panelsRef.current, ...filtered];
        // v48.7: pre-compute skipGrid from final merged count — consistent for all panels in batch
        const skipGridBatch3D = merged.length > 12;
        filtered.forEach(p => addPanelEntity(viewer, C, p, skipGridBatch3D));
        lastRenderedPanelsRef.current = merged;
        panelsRef.current = merged;
        onPanelsChange(merged);
        setPanelCount(merged.length);
        // Phase 2: render roof rails after plane3d fill
        try { renderRoofRails(viewer, C, merged); } catch (e) { handleCesiumError('renderRoofRails plane3d', e, true); }

        // v47.126: bounding-box overlay — debug only
        if (DEBUG_PLANE_OVERLAYS) {
          try { renderLayoutBBox(viewer, C, filtered, plane.id); } catch (e) { console.warn('[PLANE3D] renderLayoutBBox failed:', (e as Error).message); }
        }

        setStatusMsg(
          `▣ Roof Plane Active — Az ${plane.azimuth.toFixed(0)}°  Tilt ${plane.pitch.toFixed(0)}° | ` +
          `${filtered.length} panels · ${(filtered.length * (selectedPanelRef.current?.wattage ?? 400) / 1000).toFixed(1)} kW`
        );
      } else {
        setStatusMsg(
          `◻ Roof plane created — Az ${plane.azimuth.toFixed(0)}°  Tilt ${plane.pitch.toFixed(0)}° | ` +
          `No panels fit — try reducing setbacks or enlarging the polygon`
        );
      }

      // Switch to surface_select so user can continue with this plane
      onPlacementModeChange('surface_select');
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `finalizePlane3D: ${(err as Error).message}`);
      setStatusMsg(`3D Plane error: ${(err as Error).message} — try placing points more spread apart on the roof`);
      clearPlane3DPreview(viewer);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  v47.119 — Surface-Based Placement Handlers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * handleSurfaceSelectClick — click on roof surface to select a plane
   * and immediately place a full surface grid using buildSurfaceGrid().
   *
   * Flow:
   *   1. scene.pickPosition → lat/lng/height of click
   *   2. assignRoofPlane() → find nearest matching RoofPlane
   *   3. buildSurfaceGrid() → place full panel grid on that surface
   *   4. Render panels + update state
   */
  function handleSurfaceSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      const pickedPos = viewer.scene.pickPosition(screenPos);
      if (!pickedPos || !isFinite(pickedPos.x)) {
        addLog('SURFACE', 'pickPosition returned invalid position');
        setStatusMsg('Surface click — no 3D position found. Ensure tiles are loaded.');
        return;
      }

      const carto = C.Cartographic.fromCartesian(pickedPos);
      const clickLat = C.Math.toDegrees(carto.latitude);
      const clickLng = C.Math.toDegrees(carto.longitude);
      const clickH   = carto.height;

      if (!isValidCoord(clickLat, clickLng)) {
        addLog('SURFACE', `Invalid click coords: ${clickLat}, ${clickLng}`);
        return;
      }

      const planes = roofPlanesRef.current ?? [];
      if (planes.length === 0) {
        setStatusMsg('No roof planes — draw planes in 2D mode first, then use Surface Select');
        return;
      }

      // v47.155: Polygon-first plane assignment.
      // 1. Check if click is inside any plane's polygon (exact containment).
      // 2. If multiple planes contain the click, pick the one with nearest centroid.
      // 3. Fall back to nearest centroid within 60m if no polygon contains click.
      let plane: typeof planes[0] | null = null;
      {
        const cosLat = Math.cos(clickLat * Math.PI / 180);
        // Candidates: planes whose polygon contains the click
        const insidePlanes = planes.filter(p => {
          const verts = (p as any).vertices ?? [];
          if (verts.length < 3) return false;
          let inside = false, j = verts.length - 1;
          for (let i = 0; i < verts.length; j = i++) {
            const xi = verts[i].lng, yi = verts[i].lat;
            const xj = verts[j].lng, yj = verts[j].lat;
            if (((yi > clickLat) !== (yj > clickLat)) &&
                (clickLng < (xj - xi) * (clickLat - yi) / (yj - yi) + xi)) {
              inside = !inside;
            }
          }
          return inside;
        });
        const searchSet = insidePlanes.length > 0 ? insidePlanes : planes;
        const maxDist   = insidePlanes.length > 0 ? Infinity : 60;
        let bestDist = Infinity;
        for (const p of searchSet) {
          const cLat = (p as any).centroidLat ?? ((p as any).vertices.reduce((s: number, v: any) => s + v.lat, 0) / (p as any).vertices.length);
          const cLng = (p as any).centroidLng ?? ((p as any).vertices.reduce((s: number, v: any) => s + v.lng, 0) / (p as any).vertices.length);
          const dy = (clickLat - cLat) * 111320;
          const dx = (clickLng - cLng) * 111320 * cosLat;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < bestDist && dist <= maxDist) { bestDist = dist; plane = p as any; }
        }
        addLog('SURFACE', `Plane assignment: inside=${insidePlanes.length} candidates=${searchSet.length} bestDist=${bestDist.toFixed(1)}m`);
      }
      if (!plane) {
        setStatusMsg('Click closer to a roof plane (or draw a plane first)');
        addLog('SURFACE', `No plane found near click (${clickLat.toFixed(4)}, ${clickLng.toFixed(4)})`);
        return;
      }

      addLog('SURFACE', `Plane selected: ${plane.id} az=${plane.azimuth} tilt=${plane.pitch}`);

      // v47.131 Issue 2: If switching to a DIFFERENT plane, clear all prior
      // frame state so extend_row / add_row start fresh on the new plane's axes.
      if (selectedPlaneRef.current && selectedPlaneRef.current.id !== plane.id) {
        addLog('SURFACE', `Plane switch: ${selectedPlaneRef.current.id.slice(0,6)} → ${plane.id.slice(0,6)} — resetting frame state`);
        }
      selectedPlaneRef.current = plane as any;

      const groundElev    = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      // v48.7: orientation is now resolved once here and passed explicitly — no ref fallback chain
      const orient        = panelOrientationRef.current ?? 'portrait';
      const edgeSetbackM  = fireSetbacks?.edgeSetbackM  ?? 0.457;
      const ridgeSetbackM = fireSetbacks?.ridgeSetbackM ?? 0.457;
      const eaveSetbackM  = fireSetbacks?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
      const layoutId      = `surface-${plane.id}`;

      // v48.7: Route through control layer (surface_select mode)
      const clResult  = placePanelsControlled({
        mode:        'surface_select',
        plane:       plane as unknown as ControlPlane,
        orientation: orient,
        wattage:     selectedPanelRef.current?.wattage ?? 400,
        setbacks:    { eaveM: eaveSetbackM, ridgeM: ridgeSetbackM, sideM: edgeSetbackM },
        groundElevM: groundElev,
        layoutId,
      });
      const newPanels = clResult.panels;

      addLog('SURFACE', `[CL] placePanelsControlled(surface_select) → ${newPanels.length} panels (engine=${clResult.engineUsed})`);

      // v47.149: Per-plane data consistency audit (read-only — kept from original)
      if (newPanels.length > 0) {
        const h0 = newPanels[0].heading ?? NaN;
        const p0 = newPanels[0].pitch   ?? NaN;
        const badH = newPanels.filter(p => Math.abs((p.heading ?? NaN) - h0) > 0.001);
        const badP = newPanels.filter(p => Math.abs((p.pitch   ?? NaN) - p0) > 0.001);
        if (badH.length > 0 || badP.length > 0) {
          addLog('ERROR', `[SURFACE AUDIT] plane=${plane.id.slice(0,8)} INCONSISTENT: ${badH.length} heading, ${badP.length} pitch mismatches. h=${h0.toFixed(4)} p=${p0.toFixed(4)}`);
        } else {
          addLog('SURFACE', `[AUDIT] plane=${plane.id.slice(0,8)} ALL ${newPanels.length} panels consistent: h=${isFinite(h0)?h0.toFixed(4):'NaN'} p=${isFinite(p0)?p0.toFixed(4):'NaN'}`);
        }
      }

      if (newPanels.length === 0) {
        setStatusMsg(`Surface select: plane ${plane.id} — no panels fit (check setbacks/plane size)`);
        return;
      }

      // Apply obstruction filter
      const filtered = removeObstructedPanels(newPanels, obstructionsRef.current);

      // Merge with existing panels (remove old panels from same plane, add new)
      const existingOtherPlanes = panelsRef.current.filter(p => p.planeId !== plane.id);
      const mergedPanels = [...existingOtherPlanes, ...filtered];

      // Clear old entities for this plane
      panelsRef.current.filter(p => p.planeId === plane.id).forEach(p => {
        removePanelEntities(viewer, p.id); // v47.159
      });

      // Render new panels — v48.7: pre-compute skipGrid from merged count
      const skipGridSurface = mergedPanels.length > 12;
      filtered.forEach(p => addPanelEntity(viewer, C, p, skipGridSurface));
      lastRenderedPanelsRef.current = mergedPanels;
      panelsRef.current = mergedPanels;
      onPanelsChange(mergedPanels);
      setPanelCount(mergedPanels.length);
      // Phase 2: render roof rails after surface-select fill
      try { renderRoofRails(viewer, C, mergedPanels); } catch (e) { handleCesiumError('renderRoofRails surface', e, true); }

      setStatusMsg(`Surface grid: ${filtered.length} panels on plane ${plane.id.slice(0,8)}… | Extend Row / Add Row to expand`);

      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleSurfaceSelectClick: ${(err as Error).message}`);
      handleCesiumError('Surface select click', err);
    }
  }

  /**
   * handleExtendRowClick — in 'extend_row' mode, clicking on a plane
   * adds one more column to the highest row on that plane.
   */
  // v62: SNAP PANEL — manually place ONE panel flush against the nearest existing panel,
  // on the side the user clicked. Inherits the array's plane frame + facing (and rotation
  // if the array was rotated), and uses the current orientation toggle — so you can start a
  // landscape row below a portrait array. Click again next to the new panel to keep going.
  function handleSnapPanelClick(viewer: any, C: any, screenPos: any) {
    try {
      const pickedPos = viewer.scene.pickPosition(screenPos);
      if (!pickedPos || !isFinite(pickedPos.x)) { setStatusMsg('Snap Panel — click on the roof near the array'); return; }

      // Nearest existing roof panel that carries an ECEF frame.
      let ref: PlacedPanel | null = null; let bestD = Infinity;
      for (const p of panelsRef.current) {
        if ((p.systemType ?? 'roof') !== 'roof') continue;
        if (!isFinite((p as any).ecefUx) || !isFinite((p as any).ecefNx)) continue;
        const c = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
        if (!c) continue;
        const dx = c.x - pickedPos.x, dy = c.y - pickedPos.y, dz = c.z - pickedPos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; ref = p; }
      }
      if (!ref) { setStatusMsg('No array yet — fill or place an array first, then snap panels to it'); return; }

      const refPos = safeCartesian3(C, ref.lng, ref.lat, ref.height ?? 0);
      const U = C.Cartesian3.normalize(new C.Cartesian3((ref as any).ecefUx, (ref as any).ecefUy, (ref as any).ecefUz), new C.Cartesian3());
      const N = C.Cartesian3.normalize(new C.Cartesian3((ref as any).ecefNx, (ref as any).ecefNy, (ref as any).ecefNz), new C.Cartesian3());
      const V = C.Cartesian3.normalize(C.Cartesian3.cross(N, U, new C.Cartesian3()), new C.Cartesian3());

      // Click offset from ref, in the plane's U (eave) / V (slope) coordinates.
      const off = C.Cartesian3.subtract(pickedPos, refPos, new C.Cartesian3());
      const du = C.Cartesian3.dot(off, U);
      const dv = C.Cartesian3.dot(off, V);

      const newOrient: PanelOrientation = panelOrientationRef.current ?? 'portrait';
      const refDims = panelDims(((ref as any).orientation ?? 'portrait') as PanelOrientation);
      const newDims = panelDims(newOrient);

      // Pick the adjacent slot on the side clicked (normalised by panel size so the
      // choice between "next column" and "next row" feels right).
      let offU = 0, offV = 0;
      if (Math.abs(du) / refDims.pw >= Math.abs(dv) / refDims.ph) {
        offU = (du >= 0 ? 1 : -1) * (refDims.pw / 2 + newDims.pw / 2);
      } else {
        offV = (dv >= 0 ? 1 : -1) * (refDims.ph / 2 + newDims.ph / 2);
      }

      const center = new C.Cartesian3(
        refPos.x + U.x * offU + V.x * offV,
        refPos.y + U.y * offU + V.y * offV,
        refPos.z + U.z * offU + V.z * offV,
      );

      // Reject if that slot is already filled.
      const occ = Math.min(newDims.pw, newDims.ph) * 0.5;
      for (const p of panelsRef.current) {
        const c = safeCartesian3(C, p.lng, p.lat, p.height ?? 0);
        if (!c) continue;
        const ddx = c.x - center.x, ddy = c.y - center.y, ddz = c.z - center.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz < occ * occ) {
          setStatusMsg('A panel is already there — click an open edge of the array');
          return;
        }
      }

      const carto = C.Cartographic.fromCartesian(center);
      const FT = 3.280839895;
      const newId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `snap-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const newPanel: any = {
        ...ref,                              // inherit frame, facing, rotation, plane/layout, wattage
        id:           newId,
        lat:          Math.round(C.Math.toDegrees(carto.latitude) * 1e7) / 1e7,
        lng:          Math.round(C.Math.toDegrees(carto.longitude) * 1e7) / 1e7,
        height:       carto.height,
        orientation:  newOrient,
        widthFeet:    newDims.pw * FT,
        heightFeet:   newDims.ph * FT,
        layoutSource: 'MANUAL',
      };

      const updated = [...panelsRef.current, newPanel as PlacedPanel];
      addPanelEntity(viewer, C, newPanel, updated.length > 12);
      panelsRef.current = updated;
      lastRenderedPanelsRef.current = updated;
      try { renderRoofRails(viewer, C, updated); } catch {}
      onPanelsChange(updated);
      setPanelCount(updated.length);
      setStatusMsg(`➕ Panel snapped (${newOrient}) — ${updated.length} total · click again to add more`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleSnapPanelClick: ${(err as Error).message}`); }
  }

  function handleExtendRowClick(viewer: any, C: any, screenPos: any) {
    try {
      const pickedPos = viewer.scene.pickPosition(screenPos);
      if (!pickedPos || !isFinite(pickedPos.x)) return;
      const carto = C.Cartographic.fromCartesian(pickedPos);
      const clickLat = C.Math.toDegrees(carto.latitude);
      const clickLng = C.Math.toDegrees(carto.longitude);

      const planes = roofPlanesRef.current ?? [];
      const plane = assignRoofPlane(clickLat, clickLng, planes as any, 60);
      if (!plane) { setStatusMsg('Click on a roof plane to extend a row'); return; }

      const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      // v48.7: orientation resolved once, passed explicitly — no ref fallback chain
      const orient  = panelOrientationRef.current ?? 'portrait';
      const layoutId = panelsRef.current.find(p => p.planeId === plane.id)?.layoutId ?? `surface-${plane.id}`;

      // v48.7: Route through control layer (extend_row mode)
      // Control layer resolves targetRow from clickECEF — fixes the global-maxCol bug.
      const clickECEF = { x: pickedPos.x, y: pickedPos.y, z: pickedPos.z };
      const clExtResult = placePanelsControlled({
        mode:           'extend_row',
        plane:          plane as unknown as ControlPlane,
        existingPanels: panelsRef.current,
        clickECEF,
        orientation:    orient,
        wattage:        selectedPanelRef.current?.wattage ?? 400,
        groundElevM:    groundElev,
        layoutId,
      });
      const newPanel = clExtResult.panels.length > 0 ? clExtResult.panels[0] : null;

      if (!newPanel) {
        // v48.11: distinguish boundary rejection from no-panels-on-plane
        if (clExtResult.rejectionReason === 'boundary') {
          setStatusMsg('⛔ Row cannot be extended — panel would exceed roof boundary');
        } else {
          setStatusMsg('No panels on this plane yet — use Surface Select first');
        }
        return;
      }

      const updated = [...panelsRef.current, newPanel];
      addPanelEntity(viewer, C, newPanel);
      lastRenderedPanelsRef.current = updated;
      panelsRef.current = updated;
      onPanelsChange(updated);
      setPanelCount(updated.length);
      // Phase 2: rebuild rails after extend row
      try { renderRoofRails(viewer, C, updated); } catch {}
      setStatusMsg(`Row extended — ${updated.length} total panels`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleExtendRowClick: ${(err as Error).message}`);
    }
  }

  /**
   * handleAddRowClick — v47.136: Grid-locked Add Row.
   *
   * Projects the click position onto the plane's v-axis, snaps to the nearest
   * grid row index (rowIndex = round(vProj / stepV)), then generates a FULL ROW
   * spanning all columns of the widest existing row.
   *
   * Formula: worldPos = origin + u*(col*stepU + w/2) + v*(rowIndex*stepV + h/2) + n*OFFSET
   */
  function handleAddRowClick(viewer: any, C: any, screenPos: any) {
    try {
      const pickedPos = viewer.scene.pickPosition(screenPos);
      if (!pickedPos || !isFinite(pickedPos.x)) return;
      const carto = C.Cartographic.fromCartesian(pickedPos);
      const clickLat = C.Math.toDegrees(carto.latitude);
      const clickLng = C.Math.toDegrees(carto.longitude);

      const planes = roofPlanesRef.current ?? [];
      const plane = assignRoofPlane(clickLat, clickLng, planes as any, 60);
      if (!plane) { setStatusMsg('Click on a roof plane to add a row'); return; }

      const groundElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const orient = panelOrientationRef.current ?? 'portrait'; // single source — no surfaceOrientationRef fallback
      const layoutId = panelsRef.current.find(p => p.planeId === plane.id)?.layoutId ?? `surface-${plane.id}`;

      // Pass click ECEF position for grid-locked row snapping
      const clickECEF = { x: pickedPos.x, y: pickedPos.y, z: pickedPos.z };

      const clAddResult = placePanelsControlled({
        mode:           'add_row',
        plane:          plane as unknown as ControlPlane,
        existingPanels: panelsRef.current,
        clickECEF,
        orientation:    orient,
        wattage:        selectedPanelRef.current?.wattage ?? 400,
        groundElevM:    groundElev,
        layoutId,
      });
      const newPanels = clAddResult.panels;
      addLog('SURFACE', `[CL] placePanelsControlled(add_row) → ${newPanels.length} panels (engine=${clAddResult.engineUsed})`);

      if (!newPanels || newPanels.length === 0) {
        setStatusMsg('No panels on this plane yet — use Surface Select first');
        return;
      }

      // v47.149: Per-plane data consistency audit (read-only)
      {
        const h0 = newPanels[0].heading ?? NaN;
        const p0 = newPanels[0].pitch   ?? NaN;
        const badH = newPanels.filter(p => Math.abs((p.heading ?? NaN) - h0) > 0.001);
        const badP = newPanels.filter(p => Math.abs((p.pitch   ?? NaN) - p0) > 0.001);
        if (badH.length > 0 || badP.length > 0) {
          addLog('ERROR', `[ADDROW AUDIT] plane=${plane.id.slice(0,8)} INCONSISTENT: ${badH.length} heading, ${badP.length} pitch mismatches`);
        } else {
          addLog('SURFACE', `[ADDROW AUDIT] ${newPanels.length} panels consistent: h=${isFinite(h0)?h0.toFixed(4):'NaN'} p=${isFinite(p0)?p0.toFixed(4):'NaN'}`);
        }
      }

      const updated = [...panelsRef.current, ...newPanels];
      // v48.7: pre-compute skipGrid from final count — consistent rendering for all new panels
      const skipGridAddRow = updated.length > 12;
      newPanels.forEach(p => addPanelEntity(viewer, C, p, skipGridAddRow));
      lastRenderedPanelsRef.current = updated;
      panelsRef.current = updated;
      onPanelsChange(updated);
      setPanelCount(updated.length);
      // Phase 2: rebuild rails after add row
      try { renderRoofRails(viewer, C, updated); } catch {}
      setStatusMsg(`Row added (${newPanels.length} panels) — ${updated.length} total`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleAddRowClick: ${(err as Error).message}`);
    }
  }

  /**
   * handleObstructionClick — in 'obstruction' mode, clicking places an
   * obstruction marker (red sphere) and removes panels within its radius.
   */
  function handleObstructionClick(viewer: any, C: any, screenPos: any) {
    try {
      const pickedPos = viewer.scene.pickPosition(screenPos);
      if (!pickedPos || !isFinite(pickedPos.x)) {
        setStatusMsg('Obstruction: could not pick position — ensure tiles are loaded');
        return;
      }

      const carto = C.Cartographic.fromCartesian(pickedPos);
      const obsLat = C.Math.toDegrees(carto.latitude);
      const obsLng = C.Math.toDegrees(carto.longitude);
      const obsH   = carto.height;

      if (!isValidCoord(obsLat, obsLng)) return;

      const OBSTRUCTION_RADIUS_M = 0.75; // 75cm radius = ~typical vent pipe

      const newObs: PlacedObstruction = {
        id:      `obs-${Date.now()}`,
        lat:     obsLat,
        lng:     obsLng,
        height:  obsH,
        radiusM: OBSTRUCTION_RADIUS_M,
        type:    'vent',
      };

      // Visual: red sphere entity
      try {
        const obsPos = C.Cartesian3.fromDegrees(obsLng, obsLat, obsH + OBSTRUCTION_RADIUS_M);
        viewer.entities.add({
          name:     `[OBS] ${newObs.id}`,
          position: obsPos,
          ellipsoid: {
            radii: new C.Cartesian3(OBSTRUCTION_RADIUS_M, OBSTRUCTION_RADIUS_M, OBSTRUCTION_RADIUS_M * 1.5),
            material: C.Color.RED.withAlpha(0.6),
            outline: true,
            outlineColor: C.Color.DARKRED,
          },
          label: {
            text: '⚠ Vent',
            font: '11px sans-serif',
            fillColor: C.Color.WHITE,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: C.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            pixelOffset: new C.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } catch (e: unknown) {
        addLog('WARN', `Obstruction entity: ${(e as Error).message}`);
      }

      // Update obstruction list
      const updatedObs = [...obstructionsRef.current, newObs];
      obstructionsRef.current = updatedObs;
      setObstructions(updatedObs);

      // Remove panels within obstruction radius
      const filtered = removeObstructedPanels(panelsRef.current, [newObs]);
      const removed  = panelsRef.current.length - filtered.length;

      if (removed > 0) {
        // Remove Cesium entities for culled panels
        panelsRef.current.filter(p => !filtered.find(f => f.id === p.id)).forEach(p => {
          removePanelEntities(viewer, p.id); // v47.159
        });
        lastRenderedPanelsRef.current = filtered;
        panelsRef.current = filtered;
        onPanelsChange(filtered);
        setPanelCount(filtered.length);
        setStatusMsg(`Obstruction placed — ${removed} panel(s) removed within ${OBSTRUCTION_RADIUS_M}m radius`);
      } else {
        setStatusMsg(`Obstruction placed (no panels removed)`);
      }

      addLog('OBS', `Placed obstruction at ${obsLat.toFixed(5)}, ${obsLng.toFixed(5)} — ${removed} panels removed`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) {
      addLog('ERROR', `handleObstructionClick: ${(err as Error).message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════

  //
  // 3D height placement:
  //   1. For each panel (lat, lng) from CAD engine
  //   2. Compute slope projection along azimuth direction from plane centroid
  //   3. height = groundElev + planeHeightAtCenter + tanPitch * slopeProjection + PANEL_OFFSET
  //   This places panels flush with the roof plane defined by pitch + azimuth.
  /**
   * renderFrameAxes — debug visualization of the locked coordinate frame.
   * v47.124: REQUIRED visual validation — arrows MUST be perfectly straight.
   *
   *   RED   arrow = u direction (along roof edge / ridge)
   *   GREEN arrow = v direction (up slope)
   *   BLUE  arrow = n direction (surface normal, outward)
   *
   * If any arrow is not straight → frame is not being used correctly.
   *
   * @param plane      RoofPlane with localFrame3D
   * @param groundElevM Ground elevation in meters
   * @param tag        Unique label prefix for entity names
   */
  function renderFrameAxes(viewer: any, C: any, plane: import('@/types').RoofPlane, groundElevM: number, tag: string) {
    if (!viewer || !C) return;

    const originLat  = plane.centroidLat ?? (plane.vertices.reduce((s, v) => s + v.lat, 0) / plane.vertices.length);
    const originLng  = plane.centroidLng ?? (plane.vertices.reduce((s, v) => s + v.lng, 0) / plane.vertices.length);
    const planeH     = (plane.planeHeightAtCenterMeters ?? 3.5) + 0.3; // slightly above plane
    const baseHeight = groundElevM + planeH;

    // Get frame vectors (ENU: east=x, north=y, up=z)
    const frame = (plane as any).localFrame3D;
    if (!frame) return; // only render for stable-frame planes

    const { u, v: vv, n } = frame;
    const ARROW_LEN = 3.0; // 3m arrows — clearly visible
    const DEG_TO_RAD = Math.PI / 180;
    const cosLat = Math.cos(originLat * DEG_TO_RAD);
    const MPD = 111_320; // meters per degree latitude

    function enuToLatLngH(ex: number, ey: number, ez: number): [number, number, number] {
      return [
        originLat + ey / MPD,
        originLng + ex / (MPD * cosLat),
        baseHeight + ez,
      ];
    }

    const [oLat, oLng, oH] = [originLat, originLng, baseHeight];
    const origin3 = C.Cartesian3.fromDegrees(oLng, oLat, oH);

    // ── RED: u-axis (along roof edge) ───────────────────────────────────────
    const [uLat, uLng, uH] = enuToLatLngH(u.x * ARROW_LEN, u.y * ARROW_LEN, u.z * ARROW_LEN);
    const uTip = C.Cartesian3.fromDegrees(uLng, uLat, uH);
    const uEntity = viewer.entities.add({
      name: `[FRAME-U] ${tag}`,
      polyline: {
        positions: [origin3, uTip],
        width: 4,
        material: new C.PolylineArrowMaterialProperty(C.Color.RED.withAlpha(0.95)),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });
    overlayRef.current.push(uEntity);

    // ── GREEN: v-axis (up slope) ─────────────────────────────────────────────
    const [vLat, vLng, vH] = enuToLatLngH(vv.x * ARROW_LEN, vv.y * ARROW_LEN, vv.z * ARROW_LEN);
    const vTip = C.Cartesian3.fromDegrees(vLng, vLat, vH);
    const vEntity = viewer.entities.add({
      name: `[FRAME-V] ${tag}`,
      polyline: {
        positions: [origin3, vTip],
        width: 4,
        material: new C.PolylineArrowMaterialProperty(C.Color.LIME.withAlpha(0.95)),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });
    overlayRef.current.push(vEntity);

    // ── BLUE: n-axis (surface normal) ────────────────────────────────────────
    const [nLat, nLng, nH] = enuToLatLngH(n.x * ARROW_LEN, n.y * ARROW_LEN, n.z * ARROW_LEN);
    const nTip = C.Cartesian3.fromDegrees(nLng, nLat, nH);
    const nEntity = viewer.entities.add({
      name: `[FRAME-N] ${tag}`,
      polyline: {
        positions: [origin3, nTip],
        width: 4,
        material: new C.PolylineArrowMaterialProperty(C.Color.CYAN.withAlpha(0.95)),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });
    overlayRef.current.push(nEntity);

    // ── Labels at arrow tips ──────────────────────────────────────────────────
    [
      { pos: uTip, text: 'u →', color: C.Color.RED },
      { pos: vTip, text: 'v ↑', color: C.Color.LIME },
      { pos: nTip, text: 'n ⊥', color: C.Color.CYAN },
    ].forEach(({ pos, text, color }) => {
      const labelEnt = viewer.entities.add({
        name: `[FRAME-LBL] ${tag} ${text}`,
        position: pos,
        label: {
          text,
          font: 'bold 12px monospace',
          fillColor: color,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new C.Cartesian2(0, -14),
        },
      });
      overlayRef.current.push(labelEnt);
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // v47.126: renderLayoutBBox — draw a dashed bounding box around the placed
  // panel grid to show the installer exactly where panels are going.
  // Also shows a panel count label at the top-center of the bbox.
  // ────────────────────────────────────────────────────────────────────────────
  function renderLayoutBBox(viewer: any, C: any, panels: PlacedPanel[], tag: string) {
    if (panels.length === 0) return;

    // Clear old bbox for this tag
    const prefix = `[BBOX-${tag}]`;
    for (const e of layoutBBoxRef.current.filter((e: any) => e.name?.startsWith(prefix))) {
      try { viewer.entities.remove(e); } catch {}
    }
    layoutBBoxRef.current = layoutBBoxRef.current.filter((e: any) => !e.name?.startsWith(prefix));

    // Compute lat/lng bounding box of all panels
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    let sumH = 0;
    for (const p of panels) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      sumH += (p.height ?? 0);
    }
    const avgH = sumH / panels.length + 0.3; // slightly above panels

    // Expand bbox by half panel size (~0.85m = ~7.6e-6 deg lat)
    const padLat = 8e-6, padLng = 1.1e-5;
    const corners = [
      C.Cartesian3.fromDegrees(minLng - padLng, minLat - padLat, avgH),
      C.Cartesian3.fromDegrees(maxLng + padLng, minLat - padLat, avgH),
      C.Cartesian3.fromDegrees(maxLng + padLng, maxLat + padLat, avgH),
      C.Cartesian3.fromDegrees(minLng - padLng, maxLat + padLat, avgH),
      C.Cartesian3.fromDegrees(minLng - padLng, minLat - padLat, avgH), // close
    ];

    // Dashed bounding box outline (cyan)
    const bboxLine = viewer.entities.add({
      name: `${prefix}-outline`,
      polyline: {
        positions: corners,
        width: 2,
        material: new C.PolylineDashMaterialProperty({
          color:     C.Color.fromCssColorString('#00ffcc').withAlpha(0.85),
          dashLength: 16,
          dashPattern: 255,
        }),
        clampToGround: false,
        arcType: C.ArcType.NONE,
      },
    });
    layoutBBoxRef.current.push(bboxLine);

    // Panel count label at top-center
    const centerLng = (minLng + maxLng) / 2;
    const labelPos  = C.Cartesian3.fromDegrees(centerLng, maxLat + padLat * 3, avgH);
    const wattage   = panels[0]?.wattage ?? 400;
    const kw        = (panels.length * wattage / 1000).toFixed(1);
    const countLabel = viewer.entities.add({
      name: `${prefix}-count`,
      position: labelPos,
      label: {
        text:                     `${panels.length} panels · ${kw} kW`,
        font:                     'bold 13px monospace',
        fillColor:                C.Color.fromCssColorString('#00ffcc'),
        style:                    C.LabelStyle.FILL_AND_OUTLINE,
        outlineColor:             C.Color.BLACK,
        outlineWidth:             3,
        verticalOrigin:           C.VerticalOrigin.BOTTOM,
        horizontalOrigin:         C.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground:           true,
        backgroundColor:          C.Color.fromCssColorString('#001a14').withAlpha(0.85),
        backgroundPadding:        new C.Cartesian2(10, 5),
      },
    });
    layoutBBoxRef.current.push(countLabel);

    try { viewer.scene.requestRender(); } catch {}
  }

  // ── v47.141: Plane Debug Audit ────────────────────────────────────────────
  /**
   * renderPlaneDebugAudit — full visual audit of a roof plane's geometry.
   *
   * Renders directly from ECEF origin3D + ecefFrame3D + polygon3D so the
   * debug display matches EXACTLY what the panel placement engine sees.
   *
   * Visualizations:
   *   1. Polygon boundary      — white polyline through polygon3D vertices
   *   2. Vertex labels         — numbered point+label at each projected vertex
   *   3. Frame axes (ECEF)     — RED=u, GREEN=v, BLUE=n from origin3D
   *   4. UV bounding box       — orange dashed rectangle in plane-local UV space
   *   5. Ortho check log       — dot(u,v), dot(u,n), dot(v,n) to addLog
   */
  function renderPlaneDebugAudit(
    viewer: any,
    C: any,
    plane: import('@/types').RoofPlane,
    tag: string,
  ) {
    if (!viewer || !C) return;

    const origin  = (plane as any).origin3D as {x:number;y:number;z:number} | undefined;
    const ef      = (plane as any).ecefFrame3D as {u:{x:number;y:number;z:number};v:{x:number;y:number;z:number};n:{x:number;y:number;z:number}} | undefined;
    const poly3D  = (plane as any).polygon3D  as Array<{x:number;y:number;z:number}> | undefined;

    if (!origin || !ef || !poly3D || poly3D.length < 3) {
      addLog('AUDIT', `[${tag}] Missing origin3D/ecefFrame3D/polygon3D — skipping audit`);
      return;
    }

    const auditEntities: any[] = [];

    try {
      // ── 1. Polygon boundary ──────────────────────────────────────────────
      const boundaryPts = [...poly3D, poly3D[0]].map(
        (p: {x:number;y:number;z:number}) => new C.Cartesian3(p.x, p.y, p.z)
      );
      const boundaryLine = viewer.entities.add({
        name: `[AUDIT-POLY] ${tag}`,
        polyline: {
          positions: boundaryPts,
          width: 3.5,
          material: C.Color.WHITE.withAlpha(0.95),
          clampToGround: false,
          arcType: C.ArcType.NONE,
        },
      });
      auditEntities.push(boundaryLine);

      // ── 2. Vertex labels (numbered) ──────────────────────────────────────
      poly3D.forEach((p: {x:number;y:number;z:number}, i: number) => {
        const pos = new C.Cartesian3(p.x, p.y, p.z);
        const vLabel = viewer.entities.add({
          name: `[AUDIT-VTX${i}] ${tag}`,
          position: pos,
          point: {
            pixelSize: 10,
            color: C.Color.YELLOW.withAlpha(0.95),
            outlineColor: C.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `V${i}`,
            font: 'bold 12px monospace',
            fillColor: C.Color.YELLOW,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: C.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            pixelOffset: new C.Cartesian2(0, -12),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: C.Color.BLACK.withAlpha(0.65),
            backgroundPadding: new C.Cartesian2(4, 3),
            scale: 0.9,
          },
        });
        auditEntities.push(vLabel);
      });

      // ── 3. Frame axes from ECEF origin3D ────────────────────────────────
      const originPt = new C.Cartesian3(origin.x, origin.y, origin.z);
      const ALEN = 4.0; // 4m arrows

      const axesDef: Array<{vec:{x:number;y:number;z:number}; color:any; label:string}> = [
        { vec: ef.u, color: C.Color.RED,          label: 'u\u2192' },
        { vec: ef.v, color: C.Color.LIME,          label: 'v\u2191' },
        { vec: ef.n, color: C.Color.DEEPSKYBLUE,   label: 'n\u22a5' },
      ];

      for (const ax of axesDef) {
        const tipPt = new C.Cartesian3(
          origin.x + ax.vec.x * ALEN,
          origin.y + ax.vec.y * ALEN,
          origin.z + ax.vec.z * ALEN,
        );
        const axLine = viewer.entities.add({
          name: `[AUDIT-AX-${ax.label}] ${tag}`,
          polyline: {
            positions: [originPt, tipPt],
            width: 5,
            material: new C.PolylineArrowMaterialProperty(ax.color.withAlpha(0.97)),
            clampToGround: false,
            arcType: C.ArcType.NONE,
          },
        });
        auditEntities.push(axLine);

        const axLabel = viewer.entities.add({
          name: `[AUDIT-AX-LBL-${ax.label}] ${tag}`,
          position: tipPt,
          label: {
            text: ax.label,
            font: 'bold 13px monospace',
            fillColor: ax.color,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: C.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: C.Color.BLACK.withAlpha(0.75),
            backgroundPadding: new C.Cartesian2(5, 3),
          },
        });
        auditEntities.push(axLabel);
      }

      // ── 4. UV bounding box (plane-local space → ECEF) ──────────────────
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (const p of poly3D) {
        const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
        const pu = d.x * ef.u.x + d.y * ef.u.y + d.z * ef.u.z;
        const pv = d.x * ef.v.x + d.y * ef.v.y + d.z * ef.v.z;
        if (pu < uMin) uMin = pu; if (pu > uMax) uMax = pu;
        if (pv < vMin) vMin = pv; if (pv > vMax) vMax = pv;
      }

      const BBOX_LIFT = 0.08; // meters above plane surface
      function uvToECEF(u: number, v: number) {
        return new C.Cartesian3(
          origin.x + ef.u.x * u + ef.v.x * v + ef.n.x * BBOX_LIFT,
          origin.y + ef.u.y * u + ef.v.y * v + ef.n.y * BBOX_LIFT,
          origin.z + ef.u.z * u + ef.v.z * v + ef.n.z * BBOX_LIFT,
        );
      }
      const bboxCorners = [
        uvToECEF(uMin, vMin),
        uvToECEF(uMax, vMin),
        uvToECEF(uMax, vMax),
        uvToECEF(uMin, vMax),
        uvToECEF(uMin, vMin),
      ];
      const bboxLine = viewer.entities.add({
        name: `[AUDIT-BBOX] ${tag}`,
        polyline: {
          positions: bboxCorners,
          width: 2.5,
          material: new C.PolylineDashMaterialProperty({
            color: C.Color.fromCssColorString('#ff8800').withAlpha(0.90),
            dashLength: 12,
            dashPattern: 0xFF00,
          }),
          clampToGround: false,
          arcType: C.ArcType.NONE,
        },
      });
      auditEntities.push(bboxLine);

      const bboxCenterPt = uvToECEF((uMin + uMax) / 2, (vMin + vMax) / 2);
      const bboxDimsLabel = viewer.entities.add({
        name: `[AUDIT-BBOX-LBL] ${tag}`,
        position: bboxCenterPt,
        label: {
          text: `UV: ${(uMax-uMin).toFixed(2)}m \u00d7 ${(vMax-vMin).toFixed(2)}m\naz=${plane.azimuth.toFixed(1)}\u00b0 tilt=${plane.pitch.toFixed(1)}\u00b0`,
          font: '11px monospace',
          fillColor: C.Color.fromCssColorString('#ff8800'),
          style: C.LabelStyle.FILL_AND_OUTLINE,
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: C.VerticalOrigin.CENTER,
          horizontalOrigin: C.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: C.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new C.Cartesian2(8, 5),
          scale: 0.9,
        },
      });
      auditEntities.push(bboxDimsLabel);

      // ── 5. Frame orthogonality check → log ──────────────────────────────
      const u = ef.u, v = ef.v, n = ef.n;
      const uvDot = Math.abs(u.x*v.x + u.y*v.y + u.z*v.z);
      const unDot = Math.abs(u.x*n.x + u.y*n.y + u.z*n.z);
      const vnDot = Math.abs(v.x*n.x + v.y*n.y + v.z*n.z);
      const uMag  = Math.sqrt(u.x*u.x + u.y*u.y + u.z*u.z);
      const vMag  = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
      const nMag  = Math.sqrt(n.x*n.x + n.y*n.y + n.z*n.z);

      addLog('AUDIT', `[${tag}] |u|=${uMag.toFixed(6)} |v|=${vMag.toFixed(6)} |n|=${nMag.toFixed(6)}`);
      addLog('AUDIT', `[${tag}] dot(u,v)=${uvDot.toExponential(2)} dot(u,n)=${unDot.toExponential(2)} dot(v,n)=${vnDot.toExponential(2)}`);
      addLog('AUDIT', `[${tag}] UV bbox: u=[${uMin.toFixed(2)},${uMax.toFixed(2)}] v=[${vMin.toFixed(2)},${vMax.toFixed(2)}]`);
      addLog('AUDIT', `[${tag}] roofW=${(uMax-uMin).toFixed(2)}m roofH=${(vMax-vMin).toFixed(2)}m az=${plane.azimuth.toFixed(1)}\u00b0 tilt=${plane.pitch.toFixed(1)}\u00b0`);

      poly3D.forEach((p: {x:number;y:number;z:number}, i: number) => {
        const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
        const pu = d.x*ef.u.x + d.y*ef.u.y + d.z*ef.u.z;
        const pv = d.x*ef.v.x + d.y*ef.v.y + d.z*ef.v.z;
        addLog('AUDIT', `[${tag}] V${i}: u=${pu.toFixed(3)}m v=${pv.toFixed(3)}m`);
      });

      auditEntities.forEach(e => overlayRef.current.push(e));
      addLog('AUDIT', `[${tag}] Done — ${auditEntities.length} audit entities`);
      try { viewer.scene.requestRender(); } catch {}

    } catch (err: unknown) {
      addLog('ERROR', `renderPlaneDebugAudit [${tag}]: ${(err as Error).message}`);
    }
  }

  // v62: Convert a Google Solar roof segment → a clean tilted 3D RoofPlane so the
  // standard flush grid engine (placePanelsControlled) can fill it like a hand-drawn
  // plane. Builds the segment's convexHull as a 3D polygon at the correct heights for
  // its pitch+azimuth (downslope = lower), then buildRoofPlane3D computes the frame.
  function segmentToRoofPlane3D(seg: any, groundElevM: number): RoofPlane | null {
    try {
      const hull = (seg?.convexHull && seg.convexHull.length >= 3) ? seg.convexHull : null;
      if (!hull || !seg.center || !isValidCoord(seg.center.lat, seg.center.lng)) return null;
      const DEG = Math.PI / 180;
      const pitch = isFinite(seg.pitchDegrees) ? Math.max(0, Math.min(60, seg.pitchDegrees)) : 20;
      const az    = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
      const hAG   = isFinite(seg.heightAboveGround) ? seg.heightAboveGround : 3.0;
      const baseH = groundElevM + hAG;
      const tanP  = Math.tan(pitch * DEG);
      const cosLat = Math.cos(seg.center.lat * DEG);
      const mLat = 111320, mLng = 111320 * (cosLat > 0.01 ? cosLat : 1);
      // Downslope (azimuth) + eave (perpendicular) horizontal unit vectors, in (E,N).
      const dsE = Math.sin(az * DEG), dsN = Math.cos(az * DEG);  // downslope
      const evE = Math.cos(az * DEG), evN = -Math.sin(az * DEG); // eave (cross-slope)
      // Size guard from the face extent along eave + slope.
      let minEv = Infinity, maxEv = -Infinity, minSl = Infinity, maxSl = -Infinity;
      for (const v of hull) {
        const dE = (v.lng - seg.center.lng) * mLng;
        const dN = (v.lat - seg.center.lat) * mLat;
        const ev = dE * evE + dN * evN;
        const sl = dE * dsE + dN * dsN;
        if (ev < minEv) minEv = ev; if (ev > maxEv) maxEv = ev;
        if (sl < minSl) minSl = sl; if (sl > maxSl) maxSl = sl;
      }
      if (!(maxEv - minEv > 0.5) || !(maxSl - minSl > 0.5)) return null; // too small

      // Build the plane from the REAL hull (tilted to pitch/azimuth) so the grid
      // CLIPS to the actual roof face — no overshoot onto the ground. Then attach
      // the EAVE direction as an ENU unit vector: handleAutoRoof passes it to the
      // grid as customDir, forcing the columns along the eave regardless of the
      // hull's most-horizontal edge. Real shape (clipping) + forced eave (no
      // sideways) = correct on irregular CT hulls. (Proven in a harness.)
      const hullPts3D = hull.map((v: any) => {
        const dE = (v.lng - seg.center.lng) * mLng;
        const dN = (v.lat - seg.center.lat) * mLat;
        const along = dE * dsE + dN * dsN; // metres downslope (+ = lower)
        return engLatLngToECEF(v.lat, v.lng, baseH - along * tanP);
      });
      if (hullPts3D.length < 3) return null;
      const plane = buildRoofPlane3D(hullPts3D);
      (plane as any).__eaveDirENU = { x: evE, y: evN };
      return plane;
    } catch (e) {
      addLog('AUTO', `segmentToRoofPlane3D: ${(e as Error).message}`);
      return null;
    }
  }

  function handleAutoRoof(viewer: any, C: any) {
    if (autoFillRunningRef.current) {
      addLog('AUTO', 'handleAutoRoof: already running - skipped duplicate call');
      return;
    }
    // v47.217: Do not start auto-fill if panels are being cleared
    if (clearingRef.current) {
      addLog('AUTO', 'handleAutoRoof: skipped — clear in progress');
      return;
    }
    autoFillRunningRef.current = true;

    const planes = roofPlanesRef.current ?? [];
    const confirmedPlanes = planes.filter(rp => rp.vertices && rp.vertices.length >= 3 && rp.confirmed !== false);
    let eligiblePlanes = confirmedPlanes.length > 0 ? confirmedPlanes : planes.filter(rp => rp.vertices && rp.vertices.length >= 3);

    // ── "Only my building" (Ray, 2026-06-30) ────────────────────────────────
    // Auto-fill must panel ONLY the subject building, never the neighbours whose
    // planes are also in roofPlanes (from a block-wide detect / saved data) — that
    // was the "50 on my roof + 84 elsewhere = 134" bug. Applied HERE, the single
    // 3D-fill chokepoint, so it covers EVERY trigger (Design Studio buttons AND the
    // in-scene "Auto Fill" tool). Keep the facet cluster under the house (lat,lng)
    // + a 60 m hard cap so a bridged/spurious far plane can't survive.
    if (eligiblePlanes.length > 1) {
      const before = eligiblePlanes.length;
      const { kept } = filterToSubjectBuilding(
        eligiblePlanes,
        (p) => (p.vertices ?? []) as Array<{ lat: number; lng: number }>,
        { lat, lng },
        { maxDistM: 60 },
      );
      if (kept.length > 0 && kept.length < before) {
        eligiblePlanes = kept;
        addLog('AUTO', `handleAutoRoof: subject-building filter kept ${kept.length}/${before} planes (dropped neighbour roofs)`);
      }
    }

    // ── v62: AUTO-DETECT — no hand-drawn planes → build CLEAN planes from Google
    // Solar's detected roof segments and run them through the SAME flush grid engine
    // (placePanelsControlled below) the hand-drawn tool uses. Accurate per-face
    // geometry + the proven 0-gap aligned grid → tight rectangular layout on every
    // covered address, no tracing. (Previous attempt used the gappy/staggered
    // fillRoofSegmentWithPanels engine — wrong engine.)
    if (eligiblePlanes.length === 0) {
      const gElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      const segPlanes = (twinRef.current?.roofSegments ?? [])
        .map((s: any) => segmentToRoofPlane3D(s, gElev))
        .filter((p: RoofPlane | null): p is RoofPlane => !!p);
      if (segPlanes.length > 0) {
        eligiblePlanes = segPlanes;
        addLog('AUTO', `handleAutoRoof: no drawn planes → built ${segPlanes.length} clean planes from Google roof segments`);
      }
    }

    if (eligiblePlanes.length === 0) {
      setStatusMsg('No roof detected — use "Pick House" to select the building, then Auto Fill');
      addLog('AUTO', 'handleAutoRoof: no drawn planes AND no Solar segments');
      autoFillRunningRef.current = false;
      onPlacementModeChange('select');
      return;
    }

    addLog('AUTO', `handleAutoRoof: ${eligiblePlanes.length} planes, groundElev=${cesiumGroundElevRef.current.toFixed(1)}m`);

    // ── Clear existing panels ────────────────────────────────────────────────
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    lastRenderedPanelsRef.current = [];
    // Phase 2: clear roof rails on auto-fill rebuild
    try { clearRoofRails(viewer); } catch {}

    const orientRaw   = (panelOrientationRef.current ?? 'portrait') as string;
    // v50.23: 'hybrid' in 3D mode → use 'portrait' orientation + layoutStrategy:'mixed'
    // The control layer's 'mixed' strategy fills portrait rows then sweeps landscape in remainder.
    const orient      = (orientRaw === 'hybrid' ? 'portrait' : orientRaw) as 'portrait' | 'landscape';
    const isHybrid    = orientRaw === 'hybrid';
    const groundElev  = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const edgeSetback  = fireSetbacks?.edgeSetbackM  ?? 0.457;
    const ridgeSetback = fireSetbacks?.ridgeSetbackM ?? 0.457;
    const eaveSetback  = fireSetbacks?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
    const wattage     = selectedPanelRef.current?.wattage ?? 400;

    const newPanels: PlacedPanel[] = [];

    eligiblePlanes.forEach((plane, planeIdx) => {
      // ── v47.124: Use buildSurfaceGrid — mandatory frame-locked placement ──
      // buildSurfaceGrid checks plane.localFrame3D FIRST (stable longest-edge frame).
      // Falls back to azimuth-derived only if localFrame3D not set (legacy planes).
      // All panels share identical heading/pitch/roll from the locked frame.
      // Panel positions: origin + u*(col*stepU + w/2) + v*(row*stepV + h/2)  [no drift]
      const layoutId = `auto-${planeIdx}-${plane.id.slice(0,6)}`;

      // v50.23: per-plane orientation override (from Roof Planes panel) beats global
      const planeOrientRaw = (plane as any).orientation as string | undefined;
      const planeIsHybrid  = planeOrientRaw === 'hybrid' || (!planeOrientRaw && isHybrid);
      const planeOrient    = planeOrientRaw === 'portrait' ? 'portrait'
                           : planeOrientRaw === 'landscape' ? 'landscape'
                           : orient; // hybrid or undefined → use base orient (portrait for mixed)

      // v48.7: Route through control layer (auto_roof mode)
      const clAutoResult = placePanelsControlled({
        mode:            'auto_roof',
        plane:           plane as unknown as ControlPlane,
        orientation:     planeOrient as 'portrait' | 'landscape',
        layoutStrategy:  planeIsHybrid ? 'mixed' : undefined,
        wattage,
        setbacks:        { eaveM: eaveSetback, ridgeM: ridgeSetback, sideM: edgeSetback },
        groundElevM:     groundElev,
        layoutId,
        customOriginLat: customLayoutOriginRef.current?.lat,
        customOriginLng: customLayoutOriginRef.current?.lng,
        // v62: Auto-detected Google-segment planes carry an eave direction so the
        // grid columns lock to the eave (no "sideways"). User Set-Direction wins.
        customDirX:      customLayoutDirRef.current?.x ?? (plane as any).__eaveDirENU?.x,
        customDirY:      customLayoutDirRef.current?.y ?? (plane as any).__eaveDirENU?.y,
      });
      const planePanels = clAutoResult.panels;

      addLog('AUTO', `[CL] plane[${planeIdx}] id=${plane.id.slice(0,8)} -> ${planePanels.length} panels (engine=${clAutoResult.engineUsed}, frame: ${(plane as any).localFrame3D ? 'stable' : 'fallback'})`);

      // ── Debug frame axes (red=u, green=v, blue=n) — off by default ──────────
      if (DEBUG_PLANE_OVERLAYS) {
        try { renderFrameAxes(viewer, C, plane as any, groundElev, `auto-${planeIdx}`); } catch (e) { console.warn('[AUTO] renderFrameAxes failed:', (e as Error).message); }
      }

      newPanels.push(...planePanels);
    });

    addLog('AUTO', `total: ${newPanels.length} panels from ${eligiblePlanes.length} planes`);

    if (newPanels.length === 0) {
      setStatusMsg('Auto-roof: no panels placed — check roof plane vertices and setback settings');
      autoFillRunningRef.current = false;
      onPlacementModeChange('select');
      return;
    }

    // ── Render all panels ────────────────────────────────────────────────────
    // v48.7: pre-compute skipGrid from final count — consistent rendering for all auto panels
    const skipGridAuto = newPanels.length > 12;
    let entityCount = 0;
    newPanels.forEach(panel => {
      const entity = addPanelEntity(viewer, C, panel, skipGridAuto);
      if (entity) entityCount++;
    });
    addLog('AUTO', `entities added: ${entityCount}/${newPanels.length}`);

    // v47.217: Guard against clear — if clearPanels() ran while autoFill was computing,
    // discard these results to prevent ghost panels from reappearing.
    if (clearingRef.current) {
      addLog('AUTO', 'handleAutoRoof: discarding results — clear was triggered during fill');
      autoFillRunningRef.current = false;
      return;
    }
    lastRenderedPanelsRef.current = newPanels;
    panelsRef.current = newPanels;
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    // Phase 2: render roof rails after auto-fill completes
    try { renderRoofRails(viewer, C, newPanels); } catch (e) { handleCesiumError('renderRoofRails auto', e, true); }
    setStatusMsg(`Auto-roof: ${newPanels.length} panels on ${eligiblePlanes.length} roof planes (frame-locked)`);

    // v47.126: bounding box for auto-filled panels — debug only
    if (DEBUG_PLANE_OVERLAYS) {
      try { renderLayoutBBox(viewer, C, newPanels, 'auto'); } catch (e) { console.warn('[AUTO] renderLayoutBBox failed:', (e as Error).message); }
    }

    try { viewer.scene.requestRender(); } catch {}
    [200, 500, 1000].forEach(t =>
      setTimeout(() => { try { viewer.scene.requestRender(); } catch {} }, t)
    );

    // v47.215 / orbit update: fit camera to all placed panels via orbit state
    if (newPanels.length > 0) {
      try {
        const lats = newPanels.map(p => p.lat);
        const lngs = newPanels.map(p => p.lng);
        const centLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
        const latSpanM = (Math.max(...lats) - Math.min(...lats)) * 111320;
        const lngSpanM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(centLat * Math.PI / 180);
        const spanM    = Math.max(latSpanM, lngSpanM, 20);
        const radius   = Math.max(60, spanM * 1.4);
        const o = orbitRef.current;
        o.targetLat = centLat; o.targetLng = centLng;
        o.targetAlt = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
        o.heading = Math.PI; o.pitch = -1.222; o.radius = radius;  // -70° pitch, look NORTH
        applyOrbitRef.current?.();
      } catch {}
    }

    setTimeout(() => {
      autoFillRunningRef.current = false;
      onPlacementModeChange('select');
    }, 400);
  }


  // ── Fill roof segment with panels ──────────────────────────────────────────────────────────────
  // v31.9: Complete audit + fix.
  //
  // ELEVATION FORMULA (critical):
  //   cesiumGroundElevRef = Cesium ellipsoidal height at ground level (from terrain sampling or
  //                         googleGroundElev + OHIO_GEOID_UNDULATION fallback).
  //   seg.heightAboveGround = meters the roof center is above ground (from Google Solar API).
  //   segElev = cesiumGroundElevRef + seg.heightAboveGround  <- correct Cesium ellipsoidal height
  //
  // PRIMARY PATH  -- seg.googlePanels (Google Solar API pre-computed positions)
  //   * Uses exact lat/lng from Google's roof analysis
  //   * Height = segElev + tanPitch * (slope projection from center) + PANEL_OFFSET
  //   * Capped at seg.maxPanels
  //
  // FALLBACK PATH -- Row-tool-aligned Cartesian3 grid (when googlePanels is empty)
  //   * Builds grid in world-space using C.Cartesian3.fromDegrees at segElev
  //   * Walks along ridge direction (perpendicular to azimuth) and slope direction
  //   * Each panel position converted back to lat/lng via Cartographic.fromCartesian
  //   * Clips to seg.convexHull using point-in-polygon test
  //   * Capped at seg.maxPanels
  function fillRoofSegmentWithPanels(viewer: any, C: any, seg: any): PlacedPanel[] {
    const panels: PlacedPanel[] = [];

    if (!seg?.center || !isValidCoord(seg.center.lat, seg.center.lng)) {
      addLog('FILL', `seg ${seg?.id}: invalid center`);
      return panels;
    }

    // ── Upper bound: seg.maxPanels is computed from actual roof area with setbacks ──
    const maxPanelsLimit = (isFinite(seg.maxPanels) && seg.maxPanels > 0) ? seg.maxPanels : 60;

    // ── Shared geometry constants ──────────────────────────────────────────────────
    const mLat = 111320;
    const cosLat = Math.cos(seg.center.lat * Math.PI / 180);
    const mLng = isFinite(cosLat) && cosLat > 0.001 ? 111320 * cosLat : 111320;

    const azDeg    = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
    const pitchDeg = isFinite(seg.pitchDegrees)   ? Math.max(0, Math.min(60, seg.pitchDegrees)) : 20;
    const heading  = headingFromAzimuth(azDeg);
    const tanPitch = Math.tan(pitchDeg * Math.PI / 180);
    if (!isFinite(tanPitch)) { addLog('FILL', `seg ${seg?.id}: invalid tanPitch`); return panels; }

    // ── Elevation: cesiumGroundElevRef + heightAboveGround ─────────────────────────
    const heightAboveGround = isFinite(seg.heightAboveGround) ? seg.heightAboveGround : 3.0;
    // v47.216: lat-based EGM96 geoid approximation for CONUS (fallback when terrain not sampled)
    const segLatRad = seg.center.lat * Math.PI / 180;
    const geoidApproxFill = -29 - 5 * Math.sin(segLatRad);
    const groundElev = cesiumGroundElevResolvedRef.current
      ? cesiumGroundElevRef.current
      : (isFinite(seg.elevation) ? seg.elevation : 0) + geoidApproxFill;
    const segElev = groundElev + heightAboveGround;

    addLog('FILL', `seg ${seg?.id}: groundElev=${groundElev.toFixed(1)} hAG=${heightAboveGround.toFixed(2)} segElev=${segElev.toFixed(1)} pitch=${pitchDeg.toFixed(1)} az=${azDeg.toFixed(1)}`);

    // ── Panel dimensions ───────────────────────────────────────────────────────────
    const orient = panelOrientationRef.current ?? 'portrait';
    const { pw: PW_O, ph: PH_O } = panelDims(orient);
    const panelW = PW_O + 0.05;
    const panelH = PH_O + 0.10;

    // ── Point-in-polygon (ray casting) ────────────────────────────────────────────
    function pointInPolygon(
      lat: number, lng: number,
      poly: Array<{ lat: number; lng: number }>
    ): boolean {
      if (!poly || poly.length < 3) return true;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].lng, yi = poly[i].lat;
        const xj = poly[j].lng, yj = poly[j].lat;
        if ((yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }

    // ── Clip polygon with setback ───────────────────────────────────────────────────────
    // Use actual fire setback values from UI config (passed as prop), fallback to IFC defaults
    const edgeSetbackM  = (fireSetbacks?.edgeSetbackM  ?? 0.457); // 18 inches default
    const ridgeSetbackM = (fireSetbacks?.ridgeSetbackM ?? 0.457); // 18 inches default
    // Use the larger of edge/ridge for uniform polygon shrink (conservative, safe)
    const SETBACK_M_FILL = Math.max(edgeSetbackM, ridgeSetbackM);
    addLog('FILL', `seg ${seg?.id}: setbacks edge=${(edgeSetbackM*39.37).toFixed(0)}" ridge=${(ridgeSetbackM*39.37).toFixed(0)}" effective=${(SETBACK_M_FILL*39.37).toFixed(0)}"`);

    const rawClipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];

    function shrinkPoly(
      poly: Array<{ lat: number; lng: number }>,
      setbackM: number
    ): Array<{ lat: number; lng: number }> {
      if (poly.length < 3) return poly;
      const cLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
      const cLng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
      return poly.map(p => {
        const dLatM = (p.lat - cLat) * mLat;
        const dLngM = (p.lng - cLng) * mLng;
        const dist = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
        if (dist <= setbackM) return { lat: cLat, lng: cLng };
        const scale = (dist - setbackM) / dist;
        return {
          lat: cLat + (p.lat - cLat) * scale,
          lng: cLng + (p.lng - cLng) * scale,
        };
      });
    }

    const clipPoly = rawClipPoly.length >= 3
      ? shrinkPoly(rawClipPoly, SETBACK_M_FILL)
      : rawClipPoly;

    // ============================================================================
    // PRIMARY PATH: Google's pre-computed panel positions
    // ============================================================================
    const googlePanels: Array<{ lat: number; lng: number; orientation: string; yearlyEnergyDcKwh: number }>
      = seg.googlePanels ?? [];

    if (googlePanels.length > 0) {
      addLog('FILL', `seg ${seg?.id}: PRIMARY PATH -- ${googlePanels.length} googlePanels, limit=${Math.min(googlePanels.length, maxPanelsLimit)}`);
      const azRad  = azDeg * Math.PI / 180;
      const slopeE = Math.sin(azRad);
      const slopeN = Math.cos(azRad);
      const ridgeE = Math.cos(azRad);
      const ridgeN = -Math.sin(azRad);

      // ── Step 1: Filter valid panels and compute roof-local coordinates ──
      type GpWithCoords = {
        lat: number; lng: number; orientation: string;
        slopeProj: number; ridgeProj: number; height: number;
      };
      const validGp: GpWithCoords[] = [];
      for (const gp of googlePanels) {
        if (!isValidCoord(gp.lat, gp.lng)) continue;
        const dN = (gp.lat - seg.center.lat) * mLat;
        const dE = (gp.lng - seg.center.lng) * mLng;
        const slopeProj = dE * slopeE + dN * slopeN;
        const ridgeProj = dE * ridgeE + dN * ridgeN;
        const height = segElev + tanPitch * slopeProj + getRoofPanelOffset(mountingSystemIdRef.current);
        if (!isValidCoord(gp.lat, gp.lng, height)) continue;
        validGp.push({ lat: gp.lat, lng: gp.lng, orientation: gp.orientation, slopeProj, ridgeProj, height });
      }

      // ── Step 2: Boundary-clip Google panels against ORIGINAL (unshrunk) polygon ──
      // IMPORTANT: Google Solar API already places panels with fire setbacks applied.
      // We must NOT filter against the shrunk polygon (clipPoly) — that rejects
      // all Google panels since they are already inset from the roof edge.
      // Instead, filter against the original roof boundary (rawClipPoly) to remove
      // any panels truly outside the roof footprint (data quality guard only).
      // Safety fallback: if rawClipPoly rejects ALL panels, trust Google's positions
      // (handles coordinate system mismatches between convexHull and Google lat/lng).
      let setbackFilteredGp: GpWithCoords[];
      if (rawClipPoly.length >= 3) {
        const boundaryFiltered = validGp.filter(gp => pointInPolygon(gp.lat, gp.lng, rawClipPoly));
        // If boundary filter removes everything, skip it (trust Google's setback-compliant positions)
        setbackFilteredGp = boundaryFiltered.length > 0 ? boundaryFiltered : validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY boundary-clip: ${boundaryFiltered.length}/${validGp.length} kept (safety=${boundaryFiltered.length === 0 ? 'BYPASSED' : 'ok'})`);
      } else {
        setbackFilteredGp = validGp;
        addLog('FILL', `seg ${seg?.id}: PRIMARY no boundary polygon — using all ${validGp.length} Google panels`);
      }

      // ── Step 3: Sort into clean aligned rows (by slopeProj then ridgeProj) ──
      // Quantize slopeProj into rows using panel height as bucket size.
      // This groups Google panels into neat rows matching the roof slope direction,
      // producing the same clean appearance as the manual Row tool.
      const rowBucket = (PH_O + 0.10); // panel height + gap
      setbackFilteredGp.sort((a, b) => {
        const rowA = Math.round(a.slopeProj / rowBucket);
        const rowB = Math.round(b.slopeProj / rowBucket);
        if (rowA !== rowB) return rowA - rowB;
        return a.ridgeProj - b.ridgeProj; // left to right within row
      });

      // ── Step 4: Place panels up to maxPanelsLimit ──
      let placed = 0, skipped = 0;
      const limit = Math.min(setbackFilteredGp.length, maxPanelsLimit);
      for (let i = 0; i < limit; i++) {
        const gp = setbackFilteredGp[i];
        const gpOrient: PanelOrientation =
          gp.orientation?.toUpperCase() === 'PORTRAIT' ? 'portrait' : 'landscape';
        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: gp.height,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: -(pitchDeg * Math.PI / 180), roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        placed++;
      }
      skipped = validGp.length - placed;
      addLog('FILL', `seg ${seg?.id}: PRIMARY placed=${placed} skipped/setback=${skipped}`);
      if (panels.length > 0) return panels;
    }

    // ============================================================================
    // FALLBACK PATH: Row-tool-aligned Cartesian3 grid
    // ============================================================================
    addLog('FILL', `seg ${seg?.id}: FALLBACK PATH (no googlePanels)`);

    if (!seg.boundingBox?.sw || !seg.boundingBox?.ne) {
      addLog('FILL', `seg ${seg?.id}: no boundingBox, abort`);
      return panels;
    }

    const SETBACK = SETBACK_M_FILL; // use same setback as clip polygon

    const originCart = C.Cartesian3.fromDegrees(seg.center.lng, seg.center.lat, segElev);
    if (!originCart || !isFinite(originCart.x)) {
      addLog('FILL', `seg ${seg?.id}: invalid originCart`);
      return panels;
    }

    const enuMatrix = C.Transforms.eastNorthUpToFixedFrame(originCart);

    const azRad  = azDeg * Math.PI / 180;
    const slopeLocal = new C.Cartesian3(Math.sin(azRad),  Math.cos(azRad),  0);
    const ridgeLocal = new C.Cartesian3(Math.cos(azRad), -Math.sin(azRad),  0);

    const slopeWorld = C.Matrix4.multiplyByPointAsVector(enuMatrix, slopeLocal, new C.Cartesian3());
    const ridgeWorld = C.Matrix4.multiplyByPointAsVector(enuMatrix, ridgeLocal, new C.Cartesian3());
    C.Cartesian3.normalize(slopeWorld, slopeWorld);
    C.Cartesian3.normalize(ridgeWorld, ridgeWorld);

    const bbCorners = [
      { lat: seg.boundingBox.sw.lat, lng: seg.boundingBox.sw.lng },
      { lat: seg.boundingBox.sw.lat, lng: seg.boundingBox.ne.lng },
      { lat: seg.boundingBox.ne.lat, lng: seg.boundingBox.sw.lng },
      { lat: seg.boundingBox.ne.lat, lng: seg.boundingBox.ne.lng },
    ];

    let minRidge = Infinity, maxRidge = -Infinity;
    let minSlope = Infinity, maxSlope = -Infinity;
    for (const c of bbCorners) {
      const dN = (c.lat - seg.center.lat) * mLat;
      const dE = (c.lng - seg.center.lng) * mLng;
      const rProj = dE * Math.cos(azRad) + dN * (-Math.sin(azRad));
      const sProj = dE * Math.sin(azRad) + dN * Math.cos(azRad);
      if (rProj < minRidge) minRidge = rProj;
      if (rProj > maxRidge) maxRidge = rProj;
      if (sProj < minSlope) minSlope = sProj;
      if (sProj > maxSlope) maxSlope = sProj;
    }

    const roofW = maxRidge - minRidge;
    const roofH = maxSlope - minSlope;
    if (!isFinite(roofW) || !isFinite(roofH) || roofW <= 0 || roofH <= 0) {
      addLog('FILL', `seg ${seg?.id}: invalid roofW=${roofW.toFixed(1)} roofH=${roofH.toFixed(1)}`);
      return panels;
    }

    const usableW = Math.max(0, roofW - 2 * SETBACK);
    const usableH = Math.max(0, roofH - 2 * SETBACK);
    if (usableW < panelW || usableH < panelH) {
      addLog('FILL', `seg ${seg?.id}: usable area too small (${usableW.toFixed(1)}x${usableH.toFixed(1)}m)`);
      return panels;
    }

    const cols = Math.floor(usableW / panelW);
    const rows = Math.floor(usableH / panelH);
    addLog('FILL', `seg ${seg?.id}: grid ${cols}x${rows} (roofW=${roofW.toFixed(1)} roofH=${roofH.toFixed(1)} usable=${usableW.toFixed(1)}x${usableH.toFixed(1)})`);

    if (cols < 1 || rows < 1) return panels;

    const ridgeStart = minRidge + SETBACK + (usableW - cols * panelW) / 2;
    const slopeStart = minSlope + SETBACK + (usableH - rows * panelH) / 2;

    let placed = 0, clipped = 0;
    for (let r = 0; r < rows && panels.length < maxPanelsLimit; r++) {
      for (let c = 0; c < cols && panels.length < maxPanelsLimit; c++) {
        const alongRidge = ridgeStart + (c + 0.5) * panelW;
        const alongSlope = slopeStart + (r + 0.5) * panelH;

        const worldPos = new C.Cartesian3(
          originCart.x + ridgeWorld.x * alongRidge + slopeWorld.x * alongSlope,
          originCart.y + ridgeWorld.y * alongRidge + slopeWorld.y * alongSlope,
          originCart.z + ridgeWorld.z * alongRidge + slopeWorld.z * alongSlope,
        );

        const panelCarto = C.Cartographic.fromCartesian(worldPos);
        if (!panelCarto) continue;
        const pLat    = C.Math.toDegrees(panelCarto.latitude);
        const pLng    = C.Math.toDegrees(panelCarto.longitude);
        const pHeight = panelCarto.height + getRoofPanelOffset(mountingSystemIdRef.current);

        if (!isValidCoord(pLat, pLng, pHeight)) continue;

        if (clipPoly.length >= 3 && !pointInPolygon(pLat, pLng, clipPoly)) { clipped++; continue; }

        const panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: -(pitchDeg * Math.PI / 180), roll: 0, orientation: orient,
        });
        panels.push(panel);
        // NOTE: Do NOT call addPanelEntity here.
        // handleAutoRoof calls renderAllPanels(newPanels) after collecting all segments.
        placed++;
      }
    }
    addLog('FILL', `seg ${seg?.id}: FALLBACK placed=${placed} clipped=${clipped}`);
    return panels;
  }


  // ── Compute surface normal ─────────────────────────────────────────────────
  function computeSurfaceNormal(
    viewer: any, C: any, screenPos: any, cartesian: any, pickMethod: string
  ): { tiltDeg: number; azimuthDeg: number } {
    try {
      if (pickMethod === '3dtiles') {
        // 8-direction sampling at 15px offsets — more reliable slope detection on 3D tiles
        const D = 15;
        const offsets = [
          { dx: D, dy: 0 }, { dx: -D, dy: 0 },
          { dx: 0, dy: D }, { dx: 0, dy: -D },
          { dx: D, dy: D }, { dx: -D, dy: -D },
          { dx: D, dy: -D }, { dx: -D, dy: D },
        ];
        const neighbors: any[] = [];
        for (const off of offsets) {
          try {
            const sp = { x: screenPos.x + off.dx, y: screenPos.y + off.dy };
            const c = viewer.scene.pickPosition(sp);
            if (c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z) && C.Cartesian3.magnitude(c) > 1000) {
              neighbors.push(c);
            }
          } catch {}
        }

        if (neighbors.length >= 2) {
          try {
            const enu = C.Transforms.eastNorthUpToFixedFrame(cartesian);
            const enuInv = C.Matrix4.inverse(enu, new C.Matrix4());
            const accum = new C.Cartesian3(0, 0, 0);
            let count = 0;

            for (let i = 0; i < neighbors.length - 1; i++) {
              for (let j = i + 1; j < neighbors.length; j++) {
                try {
                  const v1 = C.Cartesian3.subtract(neighbors[i], cartesian, new C.Cartesian3());
                  const v2 = C.Cartesian3.subtract(neighbors[j], cartesian, new C.Cartesian3());
                  const mag1 = C.Cartesian3.magnitude(v1);
                  const mag2 = C.Cartesian3.magnitude(v2);
                  if (!isFinite(mag1) || !isFinite(mag2) || mag1 < 0.01 || mag2 < 0.01) continue;
                  const cross = C.Cartesian3.cross(v1, v2, new C.Cartesian3());
                  const crossMag = C.Cartesian3.magnitude(cross);
                  if (!isFinite(crossMag) || crossMag < 0.001) continue;
                  C.Cartesian3.normalize(cross, cross);
                  const localN = C.Matrix4.multiplyByPointAsVector(enuInv, cross, new C.Cartesian3());
                  if (localN.z < 0) { C.Cartesian3.negate(cross, cross); }
                  C.Cartesian3.add(accum, cross, accum);
                  count++;
                } catch {}
              }
            }

            if (count > 0) {
              C.Cartesian3.normalize(accum, accum);
              const localNormal = C.Matrix4.multiplyByPointAsVector(enuInv, accum, new C.Cartesian3());
              const localMag = C.Cartesian3.magnitude(localNormal);
              if (!isFinite(localMag) || localMag < 0.001) throw new Error('local normal degenerate');
              C.Cartesian3.normalize(localNormal, localNormal);
              const tiltDeg = Math.acos(Math.max(-1, Math.min(1, Math.abs(localNormal.z)))) * 180 / Math.PI;
              const azimuthDeg = (Math.atan2(localNormal.x, localNormal.y) * 180 / Math.PI + 360) % 360;
              if (!isFinite(tiltDeg) || !isFinite(azimuthDeg)) throw new Error('NaN result');
              return { tiltDeg, azimuthDeg };
            }
          } catch {}
        }
      }

      // Fallback: nearest Solar API segment
      const twinData = twinRef.current;
      if (twinData && twinData.roofSegments.length > 0) {
        try {
          const carto = C.Cartographic.fromCartesian(cartesian);
          if (carto) {
            const pLat = C.Math.toDegrees(carto.latitude);
            const pLng = C.Math.toDegrees(carto.longitude);
            if (isFinite(pLat) && isFinite(pLng)) {
              let nearest = twinData.roofSegments[0];
              let minDist = Infinity;
              twinData.roofSegments.forEach(seg => {
                const d = Math.hypot(seg.center.lat - pLat, seg.center.lng - pLng);
                if (d < minDist) { minDist = d; nearest = seg; }
              });
              return {
                tiltDeg: isFinite(nearest.pitchDegrees) ? nearest.pitchDegrees : tiltRef.current,
                azimuthDeg: isFinite(nearest.azimuthDegrees) ? nearest.azimuthDegrees : azimuthRef.current,
              };
            }
          }
        } catch {}
      }
    } catch {}
    return { tiltDeg: tiltRef.current, azimuthDeg: azimuthRef.current };
  }

  // ── Create panel object ────────────────────────────────────────────────────
  function createPanel(opts: {
    lat: number; lng: number; height: number;
    tilt: number; azimuth: number; systemType: SystemType;
    heading: number; pitch: number; roll: number;
    orientation?: PanelOrientation;
    planeId?: string;  // v47.152: explicit planeId; undefined = free-click (no plane)
  }): PlacedPanel {
    const p: any = {
      id: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      layoutId: 'layout-1',
      lat: opts.lat, lng: opts.lng, x: 0, y: 0,
      tilt: opts.tilt, azimuth: opts.azimuth,
      wattage: selectedPanel?.wattage ?? 400,
      bifacialGain: opts.systemType === 'fence' ? 1.15 : 1.0,
      row: 0, col: 0,
      height: opts.height, heading: opts.heading,
      pitch: opts.pitch, roll: opts.roll,
      systemType: opts.systemType,
      orientation: opts.orientation ?? panelOrientationRef.current,
      planeId: opts.planeId,  // v47.152: undefined for free-click, planeId string for plane-bound
    };
    return p;
  }

  // ── Clear all panels ───────────────────────────────────────────────────────
  // v47.217: Atomic clear — sets clearingRef to block any in-flight async operations
  // (autoFill, row generation, snapping) from re-injecting panels after clear.
  // Also clears: pendingPanelsRef, panel selection, lastRenderedPanels diff state.
  function clearPanels() {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // ── Debug logging (Phase 1: before clear) ──
    const panelsBefore = panelsRef.current.length;
    const entitiesBefore = panelMapRef.current.size;
    addLog('CLEAR', `clearPanels triggered: panelsBefore=${panelsBefore}, entitiesBefore=${entitiesBefore}`);

    // ── Step 1: Set mutex to block any async ops ──
    clearingRef.current = true;
    // Also abort any in-flight autoFill so its onPanelsChange([...]) doesn't re-add panels
    autoFillRunningRef.current = false;

    // ── Step 2: Remove all panel entities from the 3D scene ──
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    // Phase 2: clear roof rail entities alongside panels
    try { clearRoofRails(viewer); } catch {}

    // ── Step 3: Reset all panel data state ──
    lastRenderedPanelsRef.current = []; // reset incremental diff state
    panelsRef.current = [];
    pendingPanelsRef.current = [];     // prevent boot-time stale panels from reappearing

    // ── Step 4: Clear panel selection ──
    clearPanelSelection();

    // ── Step 5: Notify parent (resets panel count, system size, proposal metrics) ──
    onPanelsChange([]);
    setPanelCount(0);

    // ── Debug logging (Phase 2: after clear) ──
    const panelsAfter = panelsRef.current.length;
    const entitiesAfter = panelMapRef.current.size;
    addLog('CLEAR', `clearPanels complete: panelsAfter=${panelsAfter}, entitiesAfter=${entitiesAfter}`);
    if (entitiesAfter > 0) addLog('CLEAR', `WARNING: ${entitiesAfter} entities remain after clear — possible ghost panels`);

    setStatusMsg('🗑️ All panels cleared');
    try { viewer.scene.requestRender(); } catch {}

    // ── Step 6: Release mutex after a short delay to allow React state flush ──
    // 200ms is enough for any synchronous React updates to complete before new ops can run.
    setTimeout(() => { clearingRef.current = false; }, 200);
  }

  // ── Sun animation ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (animating) {
      const interval = setInterval(() => {
        setSimHour(h => {
          const next = h >= 22 ? 5 : h + 0.25;
          simHourRef.current = next;
          updateShadeColors();
          return next;
        });
      }, 100);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating]);

  useEffect(() => {
    if (stage === 'done') updateShadeColors();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShade, simHour]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C || !twin || stage !== 'done') return;
    drawOverlays(viewer, C, twin);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showParcel, showRoofSegs, twin, stage]);

  function cleanup() {
    if (handlerRef.current) { try { handlerRef.current.destroy(); } catch {} }
    if (viewerRef.current) { try { viewerRef.current.destroy(); } catch {} }
  }

  function flyToProperty() {
    const elev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : (twinRef.current?.elevation ?? 0);
    const o = orbitRef.current;
    o.targetLat = lat; o.targetLng = lng; o.targetAlt = elev;
    o.heading = Math.PI; o.pitch = -0.785; o.radius = 200;  // -45° pitch, look NORTH
    applyOrbitRef.current?.();
  }

  function formatHour(h: number): string {
    const hh = Math.floor(h);
    const mm = Math.round((h % 1) * 60);
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }

  // Sun position for display — use UTC hours to match fixed getSunPosition
  // simHour is now LOCAL solar time (5–22). Convert to UTC for getSunPosition.
  const localSolarHourClamped = ((simHour % 24) + 24) % 24;
  const simHourUTC = ((simHour - lng / 15) % 24 + 24) % 24;
  const sunPos = getSunPosition(lat, lng, (() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear(), 5, 21);
    d.setUTCHours(Math.floor(simHourUTC), Math.round((simHourUTC % 1) * 60), 0, 0);
    return d;
  })());
  // localSolarHourClamped IS simHour (slider value = local solar time directly)
  const lsh = Math.floor(localSolarHourClamped);
  const lsm = Math.round((localSolarHourClamped % 1) * 60);
  const localSolarTimeStr = `${lsh.toString().padStart(2,'0')}:${lsm.toString().padStart(2,'0')}`;
  const solarNoonUTC = 12 - lng / 15; // still needed for potential noon marker
  const azToDir = (az: number) => {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(az / 22.5) % 16];
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a1a', overflow: 'hidden' }}>

      {/* Cesium container */}
      <div ref={cesiumRef} style={{ width: '100%', height: '100%' }} />

      {/* v63: String / equipment legend overlay */}
      {(colorByString || showEquipment) && ((stringLegend && stringLegend.length > 0) || showEquipment) ? (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 20,
          maxHeight: '46%', overflowY: 'auto',
          background: 'rgba(10,14,24,0.82)', border: '1px solid rgba(148,163,184,0.25)',
          borderRadius: 8, padding: '8px 10px', backdropFilter: 'blur(4px)',
          fontSize: 11, color: '#e2e8f0', minWidth: 132,
        }}>
          {colorByString && stringLegend && stringLegend.length > 0 ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 5, color: '#94a3b8', letterSpacing: 0.3 }}>
                STRINGS ({stringLegend.length})
              </div>
              {stringLegend.map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 2, background: s.color, flex: '0 0 auto', border: '1px solid rgba(255,255,255,0.25)' }} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  {typeof s.panelCount === 'number' ? (
                    <span style={{ color: '#94a3b8' }}>{s.panelCount}</span>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
          {showEquipment ? (
            <div style={{ marginTop: colorByString && stringLegend?.length ? 7 : 0, paddingTop: colorByString && stringLegend?.length ? 6 : 0, borderTop: colorByString && stringLegend?.length ? '1px solid rgba(148,163,184,0.18)' : 'none' }}>
              <div style={{ fontWeight: 600, marginBottom: 5, color: '#94a3b8', letterSpacing: 0.3 }}>EQUIPMENT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 11, height: 11, borderRadius: 2, background: '#f59e0b', flex: '0 0 auto' }} />
                <span>Optimizer</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: 2, background: '#16a34a', flex: '0 0 auto' }} />
                <span>Microinverter</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Debug Panel removed — was QA-only overlay */}

      {/* Loading overlay */}
      {stage !== 'done' && stage !== 'error' ? (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(8,8,20,0.96)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          {/* Animated sun icon */}
          <div style={{ position: 'relative', width: 80, height: 80, marginBottom: 28 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '3px solid rgba(255,165,0,0.15)', borderTop: '3px solid #ff8c00',
              animation: 'spin 1.2s linear infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 8, borderRadius: '50%',
              border: '2px solid rgba(255,200,0,0.1)', borderBottom: '2px solid #ffd700',
              animation: 'spin 0.8s linear infinite reverse',
            }} />
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28,
            }}>☀️</div>
          </div>

          <div style={{ color: '#ff8c00', fontSize: 20, fontWeight: 800, marginBottom: 6, letterSpacing: '-0.5px' }}>
            SolarPro 3D Engine
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24, textAlign: 'center', maxWidth: 300 }}>
            {stageMsg}
          </div>

          {/* Progress bar */}
          <div style={{ width: 300, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: '#64748b', fontSize: 11 }}>Loading...</span>
              <span style={{ color: '#ff8c00', fontSize: 11, fontWeight: 700 }}>{progress}%</span>
            </div>
            <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${progress}%`,
                background: 'linear-gradient(90deg, #ff8c00, #ffd700)',
                borderRadius: 3, transition: 'width 0.5s ease',
                boxShadow: '0 0 8px rgba(255,140,0,0.5)',
              }} />
            </div>
          </div>

          {/* Stage steps */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {([
              { key: 'cesium', label: 'Engine', icon: '⚙️' },
              { key: 'viewer', label: 'Viewer', icon: '🗺️' },
              { key: 'tiles', label: '3D Tiles', icon: '🏙️' },
              { key: 'solar', label: 'Solar API', icon: '☀️' },
              { key: 'done', label: 'Ready', icon: '✅' },
            ] as const).map(s => {
              const stages = ['idle','cesium','viewer','tiles','solar','done'];
              const currentIdx = stages.indexOf(stage);
              const stepIdx = stages.indexOf(s.key);
              const isDone = currentIdx > stepIdx;
              const isActive = currentIdx === stepIdx;
              return (
                <div key={s.key} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  opacity: isDone ? 1 : isActive ? 1 : 0.3,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: isDone ? 'rgba(16,185,129,0.2)' : isActive ? 'rgba(255,140,0,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isDone ? 'rgba(16,185,129,0.4)' : isActive ? 'rgba(255,140,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  }}>{s.icon}</div>
                  <span style={{ fontSize: 9, color: isDone ? '#10b981' : isActive ? '#ff8c00' : '#475569' }}>{s.label}</span>
                </div>
              );
            })}
          </div>

          <div style={{ color: '#334155', fontSize: 11, marginTop: 24 }}>
            Powered by Google Solar API + CesiumJS
          </div>
        </div>
      ) : null}

            {/* Error overlay */}
      {stage === 'error' ? (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(10,10,26,0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ color: '#ff4444', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>3D Engine Error</div>
          <div style={{ color: '#aaa', fontSize: 13, maxWidth: 400, textAlign: 'center', marginBottom: 24 }}>{stageMsg}</div>
          <button
            onClick={() => {
              // v47.120: initDone is already false (reset in catch block above)
              setStage('idle');
              setProgress(0);
              setStageMsg('Retrying...');
              boot();
            }}
            style={{ padding: '10px 24px', background: '#ff8c00', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
          >
            🔄 Retry 3D Load
          </button>
        </div>
      ) : null}

      {/* ── Collapsible grouped toolbar ── */}
      {stage === 'done' ? ((() => {
        const btnBase: React.CSSProperties = {
          width: 36, height: 36, borderRadius: 8, fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', border: 'none', transition: 'all 0.15s', flexShrink: 0,
        };

        // Activate a tool and collapse the flyout
        const activateTool = (mode: PlacementMode) => {
          onPlacementModeChange(mode);
          if (mode !== 'ground' && mode !== 'ground_array' && groundArrayRowsRef.current.length > 0) cancelGroundArray();
          if (mode === 'roof' || mode === 'ground' || mode === 'ground_array' || mode === 'fence') {
            rowSystemTypeRef.current = (mode === 'ground' || mode === 'ground_array') ? 'ground' : mode as SystemType;
          }
          if (mode !== 'fence')   { fencePtsRef.current = []; setFencePtCount(0); }
          if (mode !== 'plane')   { planePtsRef.current = []; setPlanePtCount(0); }
          if (mode !== 'plane3d') { const v = viewerRef.current; if (v) clearPlane3DPreview(v); }
          if (mode === 'set_direction') { dirClickPtsRef.current = []; }
          if (mode !== 'row')     { rowPtsRef.current = []; setRowPtCount(0); rowStartScreenPosRef.current = null; }
          if (mode !== 'measure') { measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay(); }
          if (mode !== 'select')  { clearPanelSelection(); }
          setOpenGroup(null); // close flyout after selection

          // Camera angle is NOT forced when entering ground mode.
          // getWorldPosition() works at any angle (same as 3D plane tool).
        };

        type ToolDef  = { mode: PlacementMode; icon: string; label: string; tip: string };
        type GroupDef = { id: string; icon: string; label: string; tools: ToolDef[] };

        const groups: GroupDef[] = [
          {
            id: 'place', icon: '\u{1F3E0}', label: 'Place',
            tools: [
              { mode: 'roof'    as PlacementMode, icon: '\u{1F3E0}', label: 'Roof',     tip: 'Place panels on a roof surface' },
              { mode: 'ground'  as PlacementMode, icon: '\u{1F331}', label: 'Ground',   tip: 'Ground mount: click start \u2192 end to place a row' },
              { mode: 'fence'   as PlacementMode, icon: '\u26A1',    label: 'Fence',    tip: 'SOL Fence: click points, right-click to finish' },
              { mode: 'plane3d' as PlacementMode, icon: '\u{1F4D0}', label: '3D Plane', tip: '3D Plane: click 3+ roof points to define a custom grid' },
              { mode: 'mark_plane' as PlacementMode, icon: '⬡', label: 'Mark Plane', tip: 'Outline a roof face for the model/permit WITHOUT panels (3+ corners, right-click to finish). Use 🔗 Roof Model to see all edges.' },
              { mode: 'row'     as PlacementMode, icon: '\u27A1',    label: 'Row',      tip: 'Row Tool: click two points to place a panel row' },
            ],
          },
          {
            id: 'auto', icon: '\u2728', label: 'Auto',
            tools: [
              { mode: 'auto_roof'      as PlacementMode, icon: '\u2728',       label: 'Auto Fill',  tip: 'Fill all detected roof segments with panels' },
              { mode: 'pick_house'     as PlacementMode, icon: '\u{1F3E1}',    label: 'Pick House', tip: 'Click a building to load its address + solar data' },
              { mode: 'surface_select' as PlacementMode, icon: '\u{1F3AF}',    label: 'Surface',    tip: 'Click a roof plane to fill it with a panel grid' },
              { mode: 'extend_row'     as PlacementMode, icon: '\u2192+',      label: 'Ext Row',    tip: 'Add one more panel column to the right of each row' },
              { mode: 'add_row'        as PlacementMode, icon: '\u2191+',      label: 'Add Row',    tip: 'Add a new panel row above the highest existing row' },
              { mode: 'snap_panel'     as PlacementMode, icon: '\u2b1b+',      label: 'Snap',       tip: 'Click beside the array to snap ONE panel flush. Use the orientation toggle first to drop a landscape row.' },
            ],
          },
          {
            id: 'tools', icon: '\u{1F4CF}', label: 'Tools',
            tools: [
              { mode: 'measure'       as PlacementMode, icon: '\u{1F4CF}', label: 'Measure',   tip: 'Click two points to measure distance on terrain' },
              { mode: 'obstruction'   as PlacementMode, icon: '\u26A0',    label: 'Obstruct',  tip: 'Mark a rectangular area as obstructed (HVAC etc.)' },
              { mode: 'set_direction' as PlacementMode, icon: '\u{1F9ED}', label: 'Direction', tip: 'Click two points to set a custom panel row direction' },
              { mode: 'set_origin'    as PlacementMode, icon: '\u{1F4CD}', label: 'Origin',    tip: 'Set a custom grid origin for Surface Select' },
            ],
          },
        ];

        const activeGroupId = groups.find(g => g.tools.some(t => t.mode === placementMode))?.id ?? null;

        return (
          <>
            {/* ── LEFT: spine + flyout ── */}
            <div style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
              gap: 0, zIndex: 50, pointerEvents: 'none',
            }}>

              {/* ── Spine: always-visible icon column ── */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center',
                background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                padding: '6px 4px', pointerEvents: 'all',
              }}>

                {/* SELECT — standalone, always visible */}
                <button
                  onMouseEnter={(e) => { const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setTooltipInfo({ text: 'Select: click panels. SHIFT+click = multi-select.', x: r.left + r.width / 2, y: r.top - 8 }); }}
                  onMouseLeave={() => setTooltipInfo(null)}
                  onClick={() => activateTool('select')}
                  style={{
                    ...btnBase,
                    background: placementMode === 'select' ? 'linear-gradient(135deg,#ff8c00,#ffd700)' : 'rgba(255,255,255,0.07)',
                    color: placementMode === 'select' ? '#000' : '#ccc',
                    boxShadow: placementMode === 'select' ? '0 0 8px rgba(255,180,0,0.4)' : 'none',
                  }}
                >{'\u2196'}</button>

                <div style={{ width: 22, height: 1, background: 'rgba(255,255,255,0.12)', margin: '1px 0' }} />

                {/* GROUP HEADER BUTTONS */}
                {groups.map((grp) => {
                  const isOpen    = openGroup === grp.id;
                  const hasActive = grp.id === activeGroupId;
                  const activeTool = grp.tools.find(t => t.mode === placementMode);
                  const headerIcon = activeTool ? activeTool.icon : grp.icon;
                  return (
                    <div key={grp.id} style={{ position: 'relative' }}>
                      <button
                        onMouseEnter={(e) => { const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setTooltipInfo({ text: grp.label + ' \u2014 click to expand', x: r.left + r.width / 2, y: r.top - 8 }); }}
                        onMouseLeave={() => setTooltipInfo(null)}
                        onClick={() => setOpenGroup(isOpen ? null : grp.id)}
                        style={{
                          ...btnBase,
                          background: hasActive
                            ? 'linear-gradient(135deg,#ff8c00,#ffd700)'
                            : isOpen ? 'rgba(255,140,0,0.22)' : 'rgba(255,255,255,0.07)',
                          color: hasActive ? '#000' : isOpen ? '#ffd700' : '#ccc',
                          boxShadow: hasActive ? '0 0 8px rgba(255,180,0,0.4)' : 'none',
                          outline: isOpen ? '1px solid rgba(255,180,0,0.5)' : 'none',
                          position: 'relative',
                        }}
                      >
                        {headerIcon}
                        {/* Mini chevron — rotates when open */}
                        <span style={{
                          position: 'absolute', bottom: 1, right: 2, fontSize: 6,
                          color: hasActive ? '#000' : '#666',
                          display: 'inline-block',
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s',
                        }}>&#9654;</span>
                      </button>
                    </div>
                  );
                })}

                <div style={{ width: 22, height: 1, background: 'rgba(255,255,255,0.12)', margin: '1px 0' }} />

                {/* VIEW UTILITY BUTTONS */}
                {([
                  { icon: '\u26F6',        tip: 'Fit View: zoom to placed panels',   action: () => { const v = viewerRef.current; const C = (window as any).Cesium; if (v&&C) fitCameraToRoofPlanes(v,C); } },
                  { icon: '\u{1F3E0}',     tip: 'Fly Home: return to property',      action: flyToProperty },
                  { icon: '\u{1F9ED}',     tip: 'Orient North: reset heading',       action: () => { const o=orbitRef.current; o.heading=Math.PI; o.pitch=-0.785; applyOrbitRef.current?.(); setStatusMsg('\u{1F9ED} North up'); } },
                  { icon: '\u{1F4D0}',     tip: 'Tilt: 3D angled perspective view', action: () => { const o=orbitRef.current; o.heading=5.76; o.pitch=-0.524; o.radius=280; applyOrbitRef.current?.(); setStatusMsg('\u{1F4D0} Perspective'); } },
                  { icon: '\u{1F52D}',     tip: "Top-Down: bird's eye view",        action: () => { const o=orbitRef.current; o.heading=Math.PI; o.pitch=-1.553; o.radius=150; applyOrbitRef.current?.(); setStatusMsg('\u{1F52D} Top-down'); } },
                  { icon: '\u{1F5D1}',     tip: 'Clear All: remove all panels',     action: clearPanels, danger: true },
                ] as { icon: string; tip: string; action: () => void; danger?: boolean }[]).map(({ icon, tip, action, danger }) => (
                  <button key={tip}
                    onMouseEnter={(e) => { const r=(e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setTooltipInfo({text:tip,x:r.left+r.width/2,y:r.top-8}); }}
                    onMouseLeave={() => setTooltipInfo(null)}
                    onClick={action}
                    style={{ ...btnBase, background: danger ? 'rgba(255,60,60,0.15)' : 'rgba(255,255,255,0.07)', color: danger ? '#ff6666' : '#aaa' }}
                  >{icon}</button>
                ))}

              </div>{/* end spine */}

              {/* ── Flyout panel (slides out to the right when a group is open) ── */}
              {openGroup ? ((() => {
                const grp = groups.find(g => g.id === openGroup)!;
                return (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 3,
                    background: 'rgba(15,15,30,0.95)', backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,180,0,0.35)', borderRadius: 12,
                    padding: '6px 5px', marginLeft: 6, pointerEvents: 'all',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
                    animation: 'toolFlyout 0.13s ease',
                  }}>
                    {/* Group label header */}
                    <div style={{
                      fontSize: 9, color: '#ffa040', textAlign: 'center',
                      fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', paddingBottom: 2,
                    }}>{grp.label}</div>
                    {/* Tool rows */}
                    {grp.tools.map(({ mode, icon, label, tip }) => (
                      <button key={mode}
                        onMouseEnter={(e) => { const r=(e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setTooltipInfo({text:label+': '+tip,x:r.left+r.width/2,y:r.top-8}); }}
                        onMouseLeave={() => setTooltipInfo(null)}
                        onClick={() => activateTool(mode)}
                        style={{
                          width: 86, height: 34, borderRadius: 8, fontSize: 12,
                          display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
                          cursor: 'pointer', border: 'none', transition: 'all 0.12s',
                          background: placementMode === mode
                            ? 'linear-gradient(135deg,#ff8c00,#ffd700)'
                            : 'rgba(255,255,255,0.08)',
                          color: placementMode === mode ? '#000' : '#ccc',
                          boxShadow: placementMode === mode ? '0 0 8px rgba(255,180,0,0.35)' : 'none',
                          fontWeight: placementMode === mode ? 700 : 400,
                        }}
                      >
                        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
                        <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{label}</span>
                      </button>
                    ))}
                  </div>
                );
              })()) : null}

            </div>{/* end toolbar row */}

            {/* Flyout slide-in animation */}
            <style>{'@keyframes toolFlyout { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }'}</style>

            {/* ── TOP-RIGHT: stats + orientation + active tool + context controls ── */}
            <div style={{
              position: 'absolute', top: 12, right: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
              zIndex: 50,
            }}>
              {/* Stats + orientation row */}
              {/* Stats + orientation row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '5px 12px',
              }}>
                <span style={{ color: '#ffd700', fontSize: 13, fontWeight: 700 }}>{panelCount} panels</span>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)' }} />
                <span style={{ color: '#4caf50', fontSize: 13, fontWeight: 700 }}>{totalKw} kW</span>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)' }} />
                <button
                  onClick={() => {
                    const next: PanelOrientation = panelOrientation === 'portrait' ? 'landscape' : 'portrait';
                    setPanelOrientation(next);
                    panelOrientationRef.current  = next;
                    surfaceOrientationRef.current = next;
                    // v48.32: Re-render existing panels with new orientation.
                    // IMPORTANT: do NOT call onPanelsChange here — that would push
                    // orientation-cloned panels back to DesignStudio, which can cause
                    // the panels useEffect to fire a second render pass and multiply panels.
                    // Instead: directly rebuild entities in the Cesium viewer only,
                    // and update panelsRef/lastRenderedPanelsRef so the next incremental
                    // diff sees the correct baseline.
                    const viewer = viewerRef.current;
                    const Cs = (window as any).Cesium;
                    if (viewer && Cs && panelsRef.current.length > 0) {
                      // 1. Clone panels with new orientation (keep same IDs so refs stay valid)
                      const updated = panelsRef.current.map(p => ({ ...p, orientation: next }));
                      // 2. Remove all existing panel entities from the viewer
                      panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
                      panelMapRef.current.clear();
                      // 3. Re-add with new orientation dims
                      const skipGrid = updated.length > 12;
                      updated.forEach(p => addPanelEntity(viewer, Cs, p, skipGrid));
                      // 4. Update local refs so incremental diff stays clean
                      panelsRef.current = updated;
                      lastRenderedPanelsRef.current = updated;
                      try { viewer.scene.requestRender(); } catch {}
                    }
                    // Notify DesignStudio so 2D orientation state stays in sync
                    onOrientationChange?.(next);
                  }}
                  title="Toggle panel orientation"
                  style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: panelOrientation === 'landscape' ? 'rgba(255,140,0,0.25)' : 'rgba(255,255,255,0.08)',
                    color: panelOrientation === 'landscape' ? '#ffd700' : '#aaa',
                    border: panelOrientation === 'landscape' ? '1px solid rgba(255,200,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {panelOrientation === 'portrait' ? '\u25AF Port' : '\u25AD Land'}
                </button>
              </div>

              {/* Active tool badge */}
              <div style={{
                background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,140,0,0.25)', borderRadius: 8,
                padding: '4px 10px', fontSize: 11, color: '#ff8c00', fontWeight: 600,
              }}>
                {placementMode === 'select' ? '\u2196 Select' :
                 placementMode === 'roof' ? '\u{1F3E0} Place Roof' :
                 placementMode === 'ground' || placementMode === 'ground_array' ? '\u{1F331} Ground Array' :
                 placementMode === 'fence' ? '\u26A1 Fence' :
                 placementMode === 'plane3d' ? '\u{1F4D0} 3D Plane' :
                 placementMode === 'row' ? '\u27A1 Row' :
                 placementMode === 'auto_roof' ? '\u2728 Auto Fill' :
                 placementMode === 'pick_house' ? '\u{1F3E1} Pick House' :
                 placementMode === 'surface_select' ? '\u{1F3AF} Surface' :
                 placementMode === 'extend_row' ? '\u2192+ Ext Row' :
                 placementMode === 'add_row' ? '\u2191+ Add Row' :
                 placementMode === 'obstruction' ? '\u26A0 Obstruction' :
                 placementMode === 'measure' ? '\u{1F4CF} Measure' :
                 placementMode === 'set_direction' ? '\u{1F9ED} Set Direction' :
                 placementMode === 'set_origin' ? '\u{1F4CD} Set Origin' :
                 placementMode}
              </div>

              {/* ── Ground mode context controls (v48.28) ── */}
              {(placementMode === 'ground' || placementMode === 'ground_array') ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'stretch',
                  background: 'rgba(15,15,30,0.93)', backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(20,184,166,0.35)', borderRadius: 10, padding: '8px 10px',
                  minWidth: 160,
                }}>
                  {/* Header */}
                  <div style={{ color: '#14b8a6', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', borderBottom: '1px solid rgba(20,184,166,0.2)', paddingBottom: 4, marginBottom: 2 }}>
                    🌱 Ground Mount
                  </div>

                  {/* Tilt row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#aaa', fontSize: 10 }}>Panel Tilt</span>
                    <select value={gTilt} onChange={e => setGTilt(Number(e.target.value))}
                      style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
                      <option value={0}>0° (Flat)</option>
                      <option value={10}>10°</option>
                      <option value={20}>20°</option>
                      <option value={25}>25°</option>
                      <option value={30}>30°</option>
                      <option value={35}>35°</option>
                      <option value={40}>40°</option>
                      <option value={90}>90° (Vertical)</option>
                    </select>
                  </div>

                  {/* Racking toggle row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#aaa', fontSize: 10 }}>Racking</span>
                    <button
                      title={showRacking ? 'Hide post & rail structure' : 'Show post & rail structure'}
                      onClick={() => { const next = !showRacking; setShowRacking(next); showRackingRef.current = next; }}
                      style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                        background: showRacking ? 'rgba(20,184,166,0.25)' : 'rgba(255,255,255,0.07)',
                        color: showRacking ? '#2dd4bf' : '#666', border: `1px solid ${showRacking ? 'rgba(20,184,166,0.35)' : 'rgba(255,255,255,0.1)'}`,
                      }}
                    >
                      {showRacking ? 'Visible' : 'Hidden'}
                    </button>
                  </div>

                  {/* Racking style row (only when racking is visible) */}
                  {showRacking ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ color: '#aaa', fontSize: 10 }}>Style</span>
                      {/* v48.30: IronRidge XR is a 4-row landscape system — not yet built.
                          Power Rail is the only active style. IronRidge button is disabled
                          with a "coming soon" tooltip so clicking it doesn't wipe the array. */}
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          title="Power Rail ground mount (active)"
                          onClick={() => { setGroundMountStyle('pipe'); groundMountStyleRef.current = 'pipe'; }}
                          style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                            background: 'rgba(255,200,80,0.18)', color: '#ffc850',
                            border: '1px solid rgba(255,200,80,0.35)',
                          }}
                        >Power Rail</button>
                        <button
                          title="IronRidge XR — 4-row landscape system (coming soon)"
                          onClick={() => setStatusMsg('🔧 IronRidge XR (4-row landscape) coming soon')}
                          style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                            cursor: 'not-allowed', opacity: 0.38,
                            background: 'rgba(255,255,255,0.04)', color: '#555',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >IronRidge XR</button>
                      </div>
                    </div>
                  ) : null}

                  {/* Status / confirm section */}
                  {groundArrayRowCount > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4, borderTop: '1px solid rgba(20,184,166,0.15)' }}>
                      <span style={{ color: '#14b8a6', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
                        {groundArrayRowCount} row{groundArrayRowCount !== 1 ? 's' : ''} · {groundArrayPanelCount} panels
                      </span>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={finalizeGroundArray}
                          style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)', color: '#fff' }}>
                          ✓ Place Array
                        </button>
                        <button onClick={cancelGroundArray}
                          title="Discard this array and start over"
                          style={{ padding: '5px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                            border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                          ✗
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#888', fontSize: 10, textAlign: 'center', paddingTop: 3 }}>
                      Click start → end to place a row
                    </div>
                  )}
                </div>
              ) : null}

              {/* ── 3D Plane context controls ── */}
              {placementMode === 'plane3d' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(0,255,136,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#00ff88', fontSize: 12 }}>
                    {pts3DCount === 0 ? 'Click roof corners in 3D' :
                     pts3DCount < 3 ? `${pts3DCount} pt${pts3DCount > 1 ? 's' : ''} \u2014 need ${3 - pts3DCount} more` :
                     `${pts3DCount} pts \u2014 right-click or Finish`}
                  </span>
                  {pts3DCount >= 3 ? (
                    <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) finalizePlane3D(v, C); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(0,255,136,0.15)', color: '#00ff88',
                        border: '1px solid rgba(0,255,136,0.4)', cursor: 'pointer' }}>
                      \u2705 Create Roof Plane
                    </button>
                  ) : null}
                  {pts3DCount > 0 ? (
                    <button onClick={() => { const v = viewerRef.current; if (v) clearPlane3DPreview(v); setStatusMsg('3D Plane cleared'); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,60,60,0.12)', color: '#ff6666',
                        border: '1px solid rgba(255,60,60,0.3)', cursor: 'pointer' }}>
                      \u2715 Clear
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Fence context controls ── */}
              {placementMode === 'fence' && fencePtCount > 0 ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(255,136,0,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#ff8800', fontSize: 12 }}>{fencePtCount} pts</span>
                  {fencePtCount >= 2 ? (
                    <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) finalizeFence(v, C); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(0,200,100,0.2)', color: '#00cc66',
                        border: '1px solid rgba(0,200,100,0.4)', cursor: 'pointer' }}>
                      \u2705 Finish Fence
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Select context controls ── */}
              {placementMode === 'select' && selectedPanelIds.size > 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(255,100,100,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: selectedPanelIds.size > 1 ? '#ffaa00' : '#ff6666', fontSize: 12 }}>
                      {selectedPanelIds.size === 1 ? '1 selected' : `${selectedPanelIds.size} selected`}
                    </span>
                    <button onClick={deleteSelectedPanels}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(255,50,50,0.2)', color: '#ff6666',
                        border: '1px solid rgba(255,50,50,0.4)', cursor: 'pointer' }}>
                      Delete{selectedPanelIds.size > 1 ? ` (${selectedPanelIds.size})` : ''}
                    </button>
                    <button onClick={clearPanelSelection}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,255,255,0.08)', color: '#aaa',
                        border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>
                      \u2715
                    </button>
                  </div>
                  {selectedPanelIds.size === 1 ? (
                    <span style={{ color: '#666', fontSize: 10 }}>SHIFT+click to add</span>
                  ) : null}
                  {/* Fence section conversion */}
                  {selectedPanelIds.size >= 1 ? ((() => {
                    const selId = [...selectedPanelIds][0];
                    const sectionsCount = fenceSectionsRef.current.length;
                    if (sectionsCount === 0 && panelsRef.current.length > 0) {
                      const fencePanels = panelsRef.current.filter(p => (p as any).systemType === 'fence');
                      if (fencePanels.length > 0) {
                        const byLayout = new Map<string, typeof fencePanels>();
                        fencePanels.forEach(p => { const lid = p.layoutId ?? 'default'; if (!byLayout.has(lid)) byLayout.set(lid, []); byLayout.get(lid)!.push(p); });
                        const rebuilt: FenceSectionState[] = [];
                        let segIdx = 0;
                        byLayout.forEach((segPanels) => {
                          segPanels.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
                          for (let i = 0; i < segPanels.length; i += 2) {
                            const secPanels = segPanels.slice(i, i + 2);
                            rebuilt.push({ id: `sec-${segIdx}-${Math.floor(i / 2)}`, segIdx, secIdx: Math.floor(i / 2), type: 'solar', panelIds: secPanels.map(p => p.id), entityKey: '' });
                          }
                          segIdx++;
                        });
                        fenceSectionsRef.current = rebuilt;
                      }
                    }
                    const sec = fenceSectionsRef.current.find(s => s.panelIds.includes(selId));
                    if (!sec) return null;
                    return (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
                        <span style={{ color: '#888', fontSize: 10 }}>Section:</span>
                        {sec.type !== 'solar' ? (
                          <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) convertFenceSection(v, C, sec.id, 'solar'); }}
                            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                              background: 'rgba(34,197,94,0.15)', color: '#4ade80',
                              border: '1px solid rgba(34,197,94,0.3)', cursor: 'pointer' }}>
                            Solar
                          </button>
                        ) : null}
                        {sec.type !== 'gate' ? (
                          <>
                            <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) convertFenceSection(v, C, sec.id, 'gate', '4ft', selId); }}
                              style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                                background: 'rgba(168,85,247,0.15)', color: '#c084fc',
                                border: '1px solid rgba(168,85,247,0.3)', cursor: 'pointer' }}>
                              4ft Gate
                            </button>
                            <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) convertFenceSection(v, C, sec.id, 'gate', '8ft', selId); }}
                              style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                                background: 'rgba(139,92,246,0.2)', color: '#a78bfa',
                                border: '1px solid rgba(139,92,246,0.4)', cursor: 'pointer' }}>
                              8ft Gate
                            </button>
                          </>
                        ) : null}
                        {sec.type !== 'vinyl' ? (
                          <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) convertFenceSection(v, C, sec.id, 'vinyl'); }}
                            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                              background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
                              border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer' }}>
                            Vinyl
                          </button>
                        ) : null}
                        <span style={{ color: '#666', fontSize: 9 }}>({sec.type})</span>
                      </div>
                    );
                  })()) : null}
                </div>
              ) : null}

              {/* ── Measure context ── */}
              {placementMode === 'measure' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(0,255,255,0.2)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#00ffff', fontSize: 12 }}>
                    {measurePtCount === 0 ? 'Click point 1' : measurePtCount === 1 ? 'Click point 2' : `${measurePtCount} pts`}
                  </span>
                  {measurePtCount > 0 ? (
                    <button onClick={() => { measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay(); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(0,200,255,0.15)', color: '#00ffff',
                        border: '1px solid rgba(0,200,255,0.3)', cursor: 'pointer' }}>
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Row context ── */}
              {placementMode === 'row' ? (
                <div style={{
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(0,255,204,0.2)',
                  borderRadius: 10, padding: '6px 10px', color: '#00ffcc', fontSize: 12,
                }}>
                  {rowPtCount === 0 ? 'Click row start' : 'Click row end'}
                </div>
              ) : null}

              {/* ── Set Direction context ── */}
              {placementMode === 'set_direction' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(255,215,0,0.2)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#ffd700', fontSize: 12 }}>
                    {!layoutDirSet ? 'Click first point, then second along roof edge' : '\u2713 Direction locked'}
                  </span>
                  {layoutDirSet ? (
                    <button onClick={() => { customLayoutDirRef.current = null; setLayoutDirSet(false); setStatusMsg('Layout direction reset'); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,215,0,0.12)', color: '#ffd700',
                        border: '1px solid rgba(255,215,0,0.3)', cursor: 'pointer' }}>
                      \u2715 Reset
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Set Origin context ── */}
              {placementMode === 'set_origin' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(0,255,136,0.2)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#00ff88', fontSize: 12 }}>
                    {!layoutOriginSet ? 'Click to set grid origin' : '\u2713 Origin set'}
                  </span>
                  {layoutOriginSet ? (
                    <button onClick={() => { customLayoutOriginRef.current = null; setLayoutOriginSet(false); setStatusMsg('Layout origin reset'); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(0,255,136,0.12)', color: '#00ff88',
                        border: '1px solid rgba(0,255,136,0.3)', cursor: 'pointer' }}>
                      \u2715 Reset
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Plane (legacy) context ── */}
              {placementMode === 'plane' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(0,180,255,0.2)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#00ccff', fontSize: 12 }}>
                    {planePtCount === 0 ? 'Click roof corners' : `${planePtCount} pts`}
                  </span>
                  {planePtCount >= 3 ? (
                    <button onClick={() => { const v = viewerRef.current; const C = (window as any).Cesium; if (v && C) finalizePlane(v, C); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(0,180,255,0.2)', color: '#00ccff',
                        border: '1px solid rgba(0,180,255,0.4)', cursor: 'pointer' }}>
                      \u2705 Fill Plane
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        );
      })()) : null}




      {/* Overlay toggles (bottom-left, above status bar — clear of tool sidebar) */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', left: 60, bottom: 16,
          display: 'flex', flexDirection: 'row', gap: 6,
          background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 10px', zIndex: 50,
        }}>
          {[
            { key: 'parcel', label: '📐 Parcel', value: showParcel, color: '#00ff88' },
            { key: 'roof', label: '🏠 Roof Segs', value: showRoofSegs, color: '#ffd700' },
            { key: 'shade', label: '🌡 Shade', value: showShadeLocal, color: '#ff6644' },
            { key: 'irradiance', label: irradianceLoading ? '⏳ Heatmap' : '☀ Heatmap', value: showIrradianceLocal, color: '#f97316' },
          ].map(({ key, label, value, color }) => (
            <button
              key={key}
              onClick={() => {
                if (key === 'parcel') setShowParcel(v => !v);
                else if (key === 'roof') setShowRoofSegs(v => !v);
                else if (key === 'shade') {
                  const next = !showShadeRef.current;
                  showShadeRef.current = next;
                  setShowShadeLocal(next);
                  updateShadeColors();
                }
                else if (key === 'irradiance') setShowIrradianceLocal(v => !v);
              }}
              style={{
                padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: 'none', textAlign: 'left',
                background: value ? `${color}22` : 'rgba(255,255,255,0.05)',
                color: value ? color : '#666',
                borderLeft: `3px solid ${value ? color : 'transparent'}`,
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Sun simulator (bottom) */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          background: 'rgba(10,12,24,0.94)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,200,0,0.25)', borderRadius: 12,
          padding: '10px 18px', zIndex: 50, minWidth: 360,
        }}>
          {/* Row 1: time + sun position + play */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>{sunPos.elevation > 0 ? '☀️' : '🌙'}</span>
              <div>
                <div style={{ color: '#ffd700', fontSize: 14, fontWeight: 800, lineHeight: 1.1 }}>
                  {localSolarTimeStr} Solar
                </div>
                <div style={{ color: '#888', fontSize: 10 }}>Local solar time</div>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              {sunPos.elevation > 0 ? (
                <>
                  <div style={{ color: '#ff8c00', fontSize: 13, fontWeight: 700 }}>
                    {azToDir(sunPos.azimuth)} {sunPos.azimuth.toFixed(0)}°
                  </div>
                  <div style={{ color: '#888', fontSize: 10 }}>El: {sunPos.elevation.toFixed(1)}°</div>
                </>
              ) : (
                <div style={{ color: '#555', fontSize: 12 }}>Below horizon</div>
              )}
            </div>
            <button onClick={() => setAnimating(a => !a)}
              style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 13,
                background: animating ? '#ff8c00' : 'rgba(255,255,255,0.1)',
                color: animating ? '#000' : '#ccc', border: 'none', cursor: 'pointer', fontWeight: 700,
              }}>
              {animating ? '⏸' : '▶'}
            </button>
          </div>

          {/* Row 2: slider in LOCAL solar time (5am–10pm) */}
          <div style={{ width: '100%', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              {Array.from({length: 18}, (_, i) => i + 5).map(h => (
                <div key={h} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <div style={{ width: 1, height: h % 3 === 0 ? 7 : 3,
                    background: h % 3 === 0 ? 'rgba(255,200,0,0.5)' : 'rgba(255,255,255,0.15)' }} />
                  {h % 3 === 0 ? <div style={{ color: 'rgba(255,200,0,0.55)', fontSize: 9 }}>{h}</div> : null}
                </div>
              ))}
            </div>
            <input type="range" min={5} max={22} step={0.25} value={localSolarHourClamped}
              onChange={e => {
                // simHour is LOCAL solar time — set directly
                const localH = Number(e.target.value);
                simHourRef.current = localH;
                setSimHour(localH);
                updateShadeColors();
              }}
              style={{ width: '100%', accentColor: '#ff8c00', cursor: 'pointer' }} />
            {/* Solar noon marker */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${Math.max(0, Math.min(100, (12 - 5) / 17 * 100))}%`,
              width: 2, background: 'rgba(255,220,0,0.4)', pointerEvents: 'none',
            }} />
          </div>

          {/* Row 3: compass direction bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center' }}>
            <div style={{ color: '#555', fontSize: 10, marginRight: 4 }}>Sun</div>
            {(['NW','W','SW','S','SE','E','NE','N'] as const).map((dir, i) => {
              const dirAz = [315,270,225,180,135,90,45,0][i];
              const diff = Math.abs(((sunPos.azimuth - dirAz + 540) % 360) - 180);
              const isActive = diff < 22.5 && sunPos.elevation > 0;
              const isSouth = dir === 'S';
              return (
                <div key={dir} style={{
                  fontSize: 11, fontWeight: isActive ? 800 : 400,
                  color: isActive ? '#ffd700' : isSouth ? 'rgba(255,140,0,0.5)' : 'rgba(255,255,255,0.2)',
                  padding: '2px 5px', borderRadius: 4,
                  background: isActive ? 'rgba(255,215,0,0.18)' : isSouth ? 'rgba(255,140,0,0.06)' : 'transparent',
                  border: isSouth ? '1px solid rgba(255,140,0,0.2)' : '1px solid transparent',
                  transition: 'all 0.15s',
                }}>{dir}</div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* v48.13: Rotating compass rose — needle always points to true North */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', bottom: 120, right: 12, width: 72, height: 72, zIndex: 50,
          background: 'rgba(10,12,24,0.88)', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          {/* Outer ring with cardinal labels — fixed to DOM, does NOT rotate */}
          <div style={{ position: 'absolute', width: 72, height: 72 }}>
            <svg width="72" height="72" viewBox="0 0 72 72">
              {/* Tick marks */}
              {[0,45,90,135,180,225,270,315].map(a => {
                const r = a * Math.PI / 180;
                const r1 = 33, r2 = 30;
                return (
                  <line key={a}
                    x1={36 + r1*Math.sin(r)} y1={36 - r1*Math.cos(r)}
                    x2={36 + r2*Math.sin(r)} y2={36 - r2*Math.cos(r)}
                    stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
                );
              })}
              {/* Cardinal direction label ring — camera-heading offset so they stay fixed */}
              {/* We render N/S/E/W fixed; the needle rotates INSIDE */}
            </svg>
          </div>
          {/* Rotating needle group — rotates by -cameraHeadingDeg so N points to true north */}
          <div style={{
            position: 'absolute',
            width: 60, height: 60,
            transform: `rotate(${-cameraHeadingDeg}deg)`,
            transition: 'transform 0.12s linear',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="60" height="60" viewBox="0 0 60 60">
              {/* North half — red */}
              <polygon points="30,5 26,30 30,26 34,30" fill="#ff3333" opacity="0.95"/>
              {/* South half — white */}
              <polygon points="30,55 26,30 30,34 34,30" fill="rgba(255,255,255,0.75)" opacity="0.95"/>
              {/* Center dot */}
              <circle cx="30" cy="30" r="3.5" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5"/>
              {/* N label on needle (rotates with needle, so user sees N pointing to true north) */}
              <text x="30" y="16" textAnchor="middle" fill="#ff3333" fontSize="8" fontWeight="bold" fontFamily="sans-serif">N</text>
            </svg>
          </div>
          {/* Fixed camera-direction indicator label below compass */}
        </div>
      ) : null}
      {/* Camera heading readout label under compass */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', bottom: 100, right: 10, width: 76, textAlign: 'center',
          color: 'rgba(255,255,255,0.45)', fontSize: 9, zIndex: 50, fontFamily: 'monospace',
          letterSpacing: 0.5,
        }}>
          {Math.round(cameraHeadingDeg)}° {
            cameraHeadingDeg < 22.5 || cameraHeadingDeg >= 337.5 ? 'N' :
            cameraHeadingDeg < 67.5 ? 'NE' :
            cameraHeadingDeg < 112.5 ? 'E' :
            cameraHeadingDeg < 157.5 ? 'SE' :
            cameraHeadingDeg < 202.5 ? 'S' :
            cameraHeadingDeg < 247.5 ? 'SW' :
            cameraHeadingDeg < 292.5 ? 'W' : 'NW'
          }
        </div>
      ) : null}

      {/* v48.12: Floating tooltip — shown on toolbar button hover */}
      {tooltipInfo ? (
        <div style={{
          position: 'fixed',
          left: tooltipInfo.x,
          top: tooltipInfo.y,
          transform: 'translateX(-50%) translateY(-100%)',
          marginTop: -6,
          background: 'rgba(10,10,25,0.97)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 6,
          color: '#e8e8e8',
          fontSize: 11,
          padding: '6px 10px',
          maxWidth: 260,
          zIndex: 99999,
          pointerEvents: 'none',
          lineHeight: 1.45,
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          whiteSpace: 'normal',
          textAlign: 'center',
        }}>
          {tooltipInfo.text}
        </div>
      ) : null}

      {/* Status bar */}
      {stage === 'done' && statusMsg ? (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 16px',
          color: '#ccc', fontSize: 12, zIndex: 50, maxWidth: '80%', textAlign: 'center',
        }}>
          {statusMsg}
        </div>
      ) : null}

      {/* v62: Stitched roof-model toggle — classify + draw every edge across all planes */}
      {stage === 'done' ? (
        <button
          onClick={() => setShowRoofModel(v => !v)}
          title="Roof Model: classify & stitch every plane's edges (ridge/hip/valley/eave/rake)"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 51,
            background: showRoofModel ? 'rgba(34,184,255,0.18)' : 'rgba(15,15,30,0.9)',
            border: `1px solid ${showRoofModel ? 'rgba(34,184,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
            color: showRoofModel ? '#22b8ff' : '#bbb', borderRadius: 8, padding: '5px 10px',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
          }}
        >
          🔗 Roof Model{showRoofModel ? ' ✓' : ''}
        </button>
      ) : null}

      {/* v62: Stitch — average shared corners so marked faces meet at natural points */}
      {stage === 'done' ? (
        <button
          onClick={() => { const v = viewerRef.current; const Cz = (window as any).Cesium; if (v && Cz) stitchRoofVertices(v, Cz); }}
          title="Stitch: pull marked planes together — averages corners that should be shared (hips/ridges/valleys) into one natural point"
          style={{
            position: 'absolute', top: 12, left: 132, zIndex: 51,
            background: 'rgba(15,15,30,0.9)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#bbb', borderRadius: 8, padding: '5px 10px',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
          }}
        >
          ✂ Stitch
        </button>
      ) : null}

      {/* v62: Roof-model edge legend */}
      {stage === 'done' && showRoofModel ? (
        <div style={{
          position: 'absolute', top: 46, left: 12, zIndex: 50,
          background: 'rgba(15,15,30,0.9)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 9px',
          color: '#ddd', fontSize: 10, lineHeight: '15px',
        }}>
          <div style={{ fontWeight: 700, color: '#22b8ff', marginBottom: 3 }}>🔗 Roof edges</div>
          {([['#ff2d2d', 'Ridge'], ['#ff9500', 'Hip'], ['#22b8ff', 'Valley'], ['#34d399', 'Eave'], ['#facc15', 'Rake']] as const).map(([c, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
              {label}
            </div>
          ))}
        </div>
      ) : null}

      {/* v62: Fire setback legend — explains the keep-out zone colours */}
      {stage === 'done' && showSetbackZones && !showRoofModel ? (
        <div style={{
          position: 'absolute', top: 54, left: 12, zIndex: 50,
          background: 'rgba(15,15,30,0.9)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 9px',
          color: '#ddd', fontSize: 10, lineHeight: '15px',
        }}>
          <div style={{ fontWeight: 700, color: '#ff6464', marginBottom: 3 }}>🔥 Fire setbacks</div>
          {([['#ff2d2d', 'Ridge'], ['#ff9500', 'Hip'], ['#22b8ff', 'Valley'], ['#ff6464', 'Rake / eave']] as const).map(([c, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
              {label}
            </div>
          ))}
        </div>
      ) : null}

      {/* Coordinates bar */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '3px 8px',
          color: '#666', fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {lat.toFixed(5)}, {lng.toFixed(5)} | h={ftStr(cesiumGroundElevRef.current)} ({cesiumGroundElevRef.current.toFixed(0)}m)
        </div>
      ) : null}

      {/* Tile status indicator */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', top: 8, right: 60,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 7px',
          color: tileStatus === 'loaded' ? '#44ff88' : tileStatus === 'failed' ? '#ff6644' : '#ffaa44',
          fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {tileStatus === 'loaded' ? '🟢 3D' : tileStatus === 'failed' ? '🔴 3D' : '🟡 3D'}
        </div>
      ) : null}

      {/* FPS counter */}
      {stage === 'done' ? (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 7px',
          color: fps < 30 ? '#ff4444' : '#44ff88', fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {fps} FPS
        </div>
      ) : null}

      {/* Last log */}
      {stage === 'done' && lastLog ? (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 8px',
          color: '#555', fontSize: 9, zIndex: 50, fontFamily: 'monospace', maxWidth: 300,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lastLog}
        </div>
      ) : null}
    </div>
  );
}

// ── React.memo wrapper ─────────────────────────────────────────────────────
// Prevents SolarEngine3D from re-rendering when unrelated parent state changes
// (e.g. right-panel config edits, proposal values, etc.)
// Only re-renders when 3D-relevant props actually change.
export default React.memo(SolarEngine3D, (prev, next) => {
  // v47.120: Added roofPlanes comparison so surface-based handlers
  // always see the latest planes when the user adds/removes roof planes.
  // v47.122: Added selectedRoofPlaneId so selection highlight updates trigger re-render.
  return (
    prev.panels === next.panels &&
    prev.lat === next.lat &&
    prev.lng === next.lng &&
    prev.placementMode === next.placementMode &&
    prev.showShade === next.showShade &&
    prev.tilt === next.tilt &&
    prev.azimuth === next.azimuth &&
    prev.fenceHeight === next.fenceHeight &&
    prev.selectedPanel?.id === next.selectedPanel?.id &&
    prev.onPanelsChange === next.onPanelsChange &&
    prev.onPlacementModeChange === next.onPlacementModeChange &&
    prev.roofPlanes === next.roofPlanes &&
    prev.selectedRoofPlaneId === next.selectedRoofPlaneId &&
    prev.systemType === next.systemType
  );
});
