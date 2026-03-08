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
import { buildDigitalTwin, type DigitalTwinData, type RoofSegment } from '@/lib/digitalTwin';
import { getSunPosition } from '@/lib/solarMath';
import type { PlacedPanel } from '@/types';
// PanelPrimitiveRenderer and LODManager removed — entity-based rendering used instead
import { batchComputeShadeFactors, precomputeDaySunPositions, clearSunCache } from '@/lib/sunVectorCache';

// API keys loaded from environment variables — never hardcode secrets in source
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const CESIUM_TOKEN   = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN   ?? '';

// Panel physical dimensions (standard 400W panel)
// Portrait: width=1.134m (short side), height=1.722m (long side, runs down slope)
// Landscape: width=1.722m (long side, runs along ridge), height=1.134m (short side, runs down slope)
const PW_PORTRAIT  = 1.134;
const PH_PORTRAIT  = 1.722;
const PW_LANDSCAPE = 1.722;
const PH_LANDSCAPE = 1.134;
const PT = 0.040;  // thickness meters
// PANEL_OFFSET: vertical gap between the roof/ground surface and the bottom of the panel box.
// 0.08m (8cm) prevents z-fighting (flickering) where the panel geometry intersects the tile mesh.
// Too small = z-fighting artifacts. Too large = panels appear to float above the roof.
const PANEL_OFFSET = 0.08; // meters above surface

// Legacy aliases (portrait default)
const PW = PW_PORTRAIT;
const PH = PH_PORTRAIT;

function panelDims(orientation: PanelOrientation): { pw: number; ph: number } {
  return orientation === 'landscape'
    ? { pw: PW_LANDSCAPE, ph: PH_LANDSCAPE }
    : { pw: PW_PORTRAIT,  ph: PH_PORTRAIT  };
}

export type PlacementMode = 'select' | 'roof' | 'ground' | 'fence' | 'auto_roof' | 'plane' | 'row' | 'measure' | 'ground_array';
export type PanelOrientation = 'portrait' | 'landscape';
export type SystemType = 'roof' | 'ground' | 'fence';
export type LoadStage = 'idle' | 'cesium' | 'viewer' | 'tiles' | 'solar' | 'done' | 'error';

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
  onTwinLoaded?: (twin: DigitalTwinData) => void;
  onError?: (msg: string) => void;
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

function metersPerDegLat() { return 111320; }
function metersPerDegLng(lat: number) { return 111320 * Math.cos(lat * Math.PI / 180); }

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
  return azDeg * Math.PI / 180;
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
  if (type === 'roof')   return new C.Color(0.1, 0.4, 0.9, 0.92);
  if (type === 'ground') return new C.Color(0.1, 0.75, 0.3, 0.92);
  if (type === 'fence')  return new C.Color(0.9, 0.6, 0.1, 0.92);
  return new C.Color(0.5, 0.5, 0.5, 0.92);
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
  panels, onPanelsChange,
  placementMode, onPlacementModeChange,
  systemType, tilt, azimuth, fenceHeight,
  showShade, selectedPanel,
  onTwinLoaded, onError,
}: Props) {
  const cesiumRef   = useRef<HTMLDivElement>(null);
  const viewerRef   = useRef<any>(null);
  const tilesetRef  = useRef<any>(null);
  const panelMapRef = useRef<Map<string, any>>(new Map());
  // primitiveRendererRef and lodManagerRef removed — entity-based rendering via panelMapRef
  const overlayRef  = useRef<any[]>([]);
  const handlerRef  = useRef<any>(null);
  const initDone    = useRef(false);

  // pendingPanelsRef: stores panels that arrive via props BEFORE boot() completes.
  // boot() checks this ref at completion and renders them if panels prop is still [].
  const pendingPanelsRef    = useRef<PlacedPanel[]>([]);
  // renderAllPanelsRef: exposes renderAllPanels to the panels useEffect below.
  const renderAllPanelsRef  = useRef<((viewer: any, C: any, list: PlacedPanel[]) => void) | null>(null);
  // Performance: debounce timer for panel re-renders during bulk operations
  const renderDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Performance: snapshot of last rendered panel list for incremental diff
  const lastRenderedPanelsRef = useRef<PlacedPanel[]>([]);
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
  // prevLatRef / prevLngRef: track previous coordinates for address-change fly.
  const prevLatRef = useRef<number>(lat);
  const prevLngRef = useRef<number>(lng);
  // sceneReadyRef: true only after the tileset's first tiles are visible on screen.
  // Panels must NOT be rendered before this — they would float with no surface beneath.
  const sceneReadyRef = useRef<boolean>(false);

  const modeRef      = useRef<PlacementMode>(placementMode);
  const azimuthRef   = useRef<number>(azimuth);
  const tiltRef      = useRef<number>(tilt);
  const fenceHRef    = useRef<number>(fenceHeight);
  const gTiltRef     = useRef<number>(25);
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

  const [stage, setStage]         = useState<LoadStage>('idle');
  const [stageMsg, setStageMsg]   = useState('Initializing...');
  const [progress, setProgress]   = useState(0);
  const [twin, setTwin]           = useState<DigitalTwinData | null>(null);
  const [simHour, setSimHour]     = useState(12);
  const [animating, setAnimating] = useState(false);
  const [showParcel, setShowParcel]     = useState(true);
  const [showRoofSegs, setShowRoofSegs] = useState(true);
  const [panelCount, setPanelCount]     = useState(panels.length);
  const [fencePtCount, setFencePtCount] = useState(0);
  const [gTilt, setGTilt]               = useState(25);
  const [planePtCount, setPlanePtCount] = useState(0);
  const [rowPtCount, setRowPtCount]     = useState(0);
  const [panelOrientation, setPanelOrientation] = useState<PanelOrientation>('portrait');
  const panelOrientationRef = useRef<PanelOrientation>('portrait');
  const [selectedPanelId, setSelectedPanelId]   = useState<string | null>(null);
  const selectedPanelIdRef = useRef<string | null>(null);
  const measurePtsRef  = useRef<Array<{ lat: number; lng: number; height: number }>>([]);
  const [measurePtCount, setMeasurePtCount] = useState(0);
  const ghostEntityRef = useRef<any>(null);
  const [statusMsg, setStatusMsg]       = useState('');
  const [fps, setFps]                   = useState(60);
  const [lastLog, setLastLog]           = useState('');
  const [showShadeLocal, setShowShadeLocal] = useState(showShade);
  const [tileStatus, setTileStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

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
      const viewer = viewerRef.current;
      if (viewer) {
        overlayRef.current.forEach((e: any) => { try { viewer.entities.remove(e); } catch {} });
        overlayRef.current = [];
        const C = (window as any).Cesium;
        if (C && twinRef.current) { try { drawOverlays(viewer, C, twinRef.current); } catch {} }
        try { viewer.scene.requestRender(); } catch {}
      }
    }
    if (placementMode === 'auto_roof') {
      const viewer = viewerRef.current;
      const C = (window as any).Cesium;
      if (viewer && C && twinRef.current) {
        // Wait for terrain sampling to complete before running Auto Fill.
        // cesiumGroundElevRef is set at the end of boot() after sampleTerrainMostDetailed.
        // If it's already set (> 0), run immediately. Otherwise poll every 200ms (max 5s).
        const runAutoFill = () => handleAutoRoof(viewer, C);
        if (cesiumGroundElevRef.current > 0) {
          setTimeout(runAutoFill, 50);
        } else {
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if (cesiumGroundElevRef.current > 0 || waited >= 5000) {
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
  useEffect(() => { simHourRef.current = simHour; }, [simHour]);
  useEffect(() => { showShadeRef.current = showShade; setShowShadeLocal(showShade); }, [showShade]);

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
    const elev = cesiumGroundElevRef.current > 0 ? cesiumGroundElevRef.current : 0;
    const altitude = Math.max(elev + 200, 500);
    try {
      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lng, lat, altitude),
        orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
        duration: 2.0,
        complete: () => {
          // Render pump after camera arrives
          [200, 600, 1500, 3000].forEach(t =>
            setTimeout(() => { try { viewer.resize(); viewer.scene.requestRender(); } catch {} }, t)
          );
        },
      });
      addLog('FLY', `Address change → fly to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e: any) {
      addLog('WARN', `flyTo failed: ${e.message}`);
    }
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

      // Run tiles and Solar API fetch IN PARALLEL for faster boot
      const [tileResult, twinResult] = await Promise.allSettled([
        C.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
          {
            showCreditsOnScreen: false,
            // maximumScreenSpaceError: controls tile quality vs performance tradeoff.
            // Lower = higher quality (more tiles loaded), higher = better performance (fewer tiles).
            // 4 is a good balance for rooftop-level detail. Default is 16.
            maximumScreenSpaceError: 4,
            // skipLevelOfDetail: false ensures tiles load in order (no popping artifacts).
            // true would allow skipping LOD levels for faster load but causes visual glitches.
            skipLevelOfDetail: false,
            // preferLeaves: true loads the highest-detail tiles first when zoomed in.
            preferLeaves: true,
            // dynamicScreenSpaceError: reduces tile detail for tiles far from camera center.
            // Improves performance without visible quality loss at edges of view.
            dynamicScreenSpaceError: true,
            // density=0.00278 and factor=4.0 are Google's recommended values for Photorealistic 3D Tiles.
            // Tuned to match the tile resolution of the Google Maps dataset.
            dynamicScreenSpaceErrorDensity: 0.00278,
            dynamicScreenSpaceErrorFactor: 4.0,
          }
        ),
        buildDigitalTwin(lat, lng, projectAddress ?? ''),
      ]);

      // Handle tiles result
      if (tileResult.status === 'fulfilled') {
        const tileset = tileResult.value;
        viewer.scene.primitives.add(tileset);
        tilesetRef.current = tileset;
        addLog('BOOT', '\u2705 Google 3D Tiles loaded OK');
        setTileStatus('loaded');
        setRenderMode('TILES');
        try {
          tileset.allTilesLoaded.addEventListener(() => {
            addLog('BOOT', '✅ All 3D tiles loaded');
            try { viewer.scene.requestRender(); } catch {}
          });
        } catch (e) { handleCesiumError('allTilesLoaded listener', e, true); }
      } else {
        addLog('WARN', `3D Tiles failed: ${(tileResult as PromiseRejectedResult).reason?.message}`);
        setTileStatus('failed');
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
      // GEOID UNDULATION EXPLANATION:
      // Google Elevation API returns orthometric heights (height above mean sea level / EGM96 geoid).
      // Cesium uses ellipsoidal heights (height above the WGS84 mathematical ellipsoid).
      // The difference between these two systems is called "geoid undulation" (N).
      // Formula: ellipsoidal height = orthometric height + geoid undulation
      //
      // For Ohio (~41.5N, -81.4W), the EGM96 geoid undulation is approximately -33.5m.
      // This means the geoid surface is 33.5m BELOW the ellipsoid at this location.
      // Source: https://geographiclib.sourceforge.io/cgi-bin/GeoidEval
      //
      // NOTE: This value is used as a fallback only. The code below attempts to sample
      // Cesium terrain provider for the actual ellipsoidal height, which is more accurate.
      // If terrain sampling succeeds, OHIO_GEOID_UNDULATION is NOT used.
      const OHIO_GEOID_UNDULATION = -33.5;
      let cesiumGroundElev = googleGroundElev + OHIO_GEOID_UNDULATION;

      try {
        const terrainProvider = viewer.terrainProvider;
        if (terrainProvider && typeof C.sampleTerrainMostDetailed === 'function') {
          const positions = [C.Cartographic.fromDegrees(lng, lat)];
          const sampledPositions = await C.sampleTerrainMostDetailed(terrainProvider, positions);
          if (sampledPositions?.[0] && isFinite(sampledPositions[0].height) && sampledPositions[0].height > 0) {
            cesiumGroundElev = sampledPositions[0].height;
            addLog('BOOT', `Cesium terrain sampled: ${cesiumGroundElev.toFixed(1)}m (Google: ${googleGroundElev.toFixed(1)}m, geoidOffset: ${(cesiumGroundElev - googleGroundElev).toFixed(1)}m)`);
          } else {
            addLog('BOOT', `Terrain sample returned invalid height, using geoid estimate: ${cesiumGroundElev.toFixed(1)}m`);
          }
        } else {
          addLog('BOOT', `sampleTerrainMostDetailed not available, using geoid estimate: ${cesiumGroundElev.toFixed(1)}m`);
        }
      } catch (e: any) {
        addLog('WARN', `Terrain sampling failed: ${e.message}, using geoid estimate: ${cesiumGroundElev.toFixed(1)}m`);
      }
      cesiumGroundElevRef.current = cesiumGroundElev;
      setTerrainReady(true);
      // NOW set twin state - cesiumGroundElevRef is ready, so drawOverlays will use correct elevation
      if (twinData) setTwin(twinData);

      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lng, lat, cesiumGroundElev + 200),
        orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
        duration: 1.5,
      });

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

      if (cesiumRef.current) {
        const ro = new ResizeObserver(() => {
          try { viewer.resize(); viewer.scene.requestRender(); } catch {}
        });
        ro.observe(cesiumRef.current);
      }

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

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setStage('error'); setStageMsg(`Error: ${msg}`);
      addLog('ERROR', `Boot failed: ${msg}`);
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
      const timeout = setTimeout(() => reject(new Error('CesiumJS load timeout')), 20000);
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
    viewer.scene.postRender.addEventListener(() => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(Math.round(frameCount * 1000 / (now - lastTime)));
        frameCount = 0; lastTime = now;
      }
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
        const h = viewer.camera.positionCartographic?.height ?? 500;
        // Only update when height changes by more than 50m (avoid thrashing)
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
        if (tilesetRef.current) {
          if (h > 1000) {
            tilesetRef.current.maximumScreenSpaceError = 32; // fast overview
          } else if (h > 400) {
            tilesetRef.current.maximumScreenSpaceError = 16; // balanced
          } else {
            tilesetRef.current.maximumScreenSpaceError = 4;  // full quality close-up
          }
        }
      } catch {}
    });
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
    const cesiumElev = cesiumGroundElevRef.current > 0
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
      } catch (e: any) { addLog('WARN', `Parcel overlay: ${e.message}`); }
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
        } catch (e: any) { addLog('WARN', `Segment ${i} overlay: ${e.message}`); }
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
  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[], forceFullRebuild = false) {
    const prev = lastRenderedPanelsRef.current;

    // Full rebuild path: shade mode changed, or first render, or forced
    if (forceFullRebuild || (prev.length === 0 && panelList.length > 0)) {
      panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      panelMapRef.current.clear();
      panelList.forEach(p => addPanelEntity(viewer, C, p));
      lastRenderedPanelsRef.current = panelList;
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
        const entity = panelMapRef.current.get(id);
        if (entity) {
          try { viewer.entities.remove(entity); } catch {}
          panelMapRef.current.delete(id);
          changed = true;
        }
      }
    });

    // Add new panels (not in prev)
    nextMap.forEach((panel, id) => {
      if (!prevMap.has(id)) {
        addPanelEntity(viewer, C, panel);
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
        const oldEntity = panelMapRef.current.get(id);
        // Try in-place update first (avoids entity remove+add flicker)
        if (oldEntity && oldEntity.position && oldEntity.orientation && !typeChanged) {
          try {
            const pos = safeCartesian3(C, panel.lng, panel.lat, panel.height ?? 0);
            if (pos && C.Cartesian3.magnitude(pos) > 1000) {
              const heading = isFinite(panel.heading ?? NaN) ? panel.heading! : headingFromAzimuth(panel.azimuth ?? 180);
              const pitchRad = -(panel.tilt ?? 0) * Math.PI / 180;
              const rollRad = (panel.roll ?? 0) * Math.PI / 180;
              const hpr = new C.HeadingPitchRoll(heading, pitchRad, rollRad);
              const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
              if (orientation && isFinite(orientation.x)) {
                oldEntity.position = new C.ConstantPositionProperty(pos);
                oldEntity.orientation = new C.ConstantProperty(orientation);
                changed = true;
                return; // in-place update succeeded
              }
            }
          } catch {}
        }
        // Fallback: remove + re-add (for type changes or if in-place failed)
        if (oldEntity) {
          try { viewer.entities.remove(oldEntity); } catch {}
          panelMapRef.current.delete(id);
        }
        addPanelEntity(viewer, C, panel);
        changed = true;
      }
    });

    lastRenderedPanelsRef.current = panelList;
    if (changed) {
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
  function addPanelEntity(viewer: any, C: any, panel: PlacedPanel) {
    try {
      const h = panel.height ?? 0;
      const tiltDeg = panel.tilt ?? 0;
      const azDeg = panel.azimuth ?? 180;

      if (!isValidCoord(panel.lat, panel.lng, h)) {
        addLog('ERROR', `Panel ${panel.id} invalid coords`); return;
      }
      if (!isFinite(tiltDeg) || !isFinite(azDeg)) {
        addLog('ERROR', `Panel ${panel.id} invalid tilt/az`); return;
      }

      const heading = isFinite(panel.heading ?? NaN) ? panel.heading! : headingFromAzimuth(azDeg);
      const pitchRad = -tiltDeg * Math.PI / 180;
      const rollRad = (panel.roll ?? 0) * Math.PI / 180;

      if (!isFinite(heading) || !isFinite(pitchRad) || !isFinite(rollRad)) return;

      const pos = safeCartesian3(C, panel.lng, panel.lat, h);
      if (!pos || C.Cartesian3.magnitude(pos) < 1000) {
        addLog('ERROR', `Panel ${panel.id} invalid Cartesian3`); return;
      }

      const hpr = new C.HeadingPitchRoll(heading, pitchRad, rollRad);
      const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
      if (!orientation || !isFinite(orientation.x) || !isFinite(orientation.y) ||
          !isFinite(orientation.z) || !isFinite(orientation.w)) {
        addLog('ERROR', `Panel ${panel.id} invalid quaternion`); return;
      }

      const sType = (panel.systemType ?? 'roof') as SystemType;
      let color: any;
      if (showShadeRef.current && twinRef.current) {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear(), 5, 21);
        d.setUTCHours(Math.floor(simHourRef.current), Math.round((simHourRef.current % 1) * 60), 0, 0);
        const sunPos = getSunPosition(lat, lng, d);
        color = new C.ColorMaterialProperty(shadeToColor(C, computeShade(panel, sunPos)));
      } else {
        color = new C.ColorMaterialProperty(systemTypeColor(C, sType));
      }

      // Use stored orientation on the panel, fallback to current ref
      const orient: PanelOrientation = (panel as any).orientation ?? panelOrientationRef.current;
      const { pw, ph } = panelDims(orient);
      const entity = viewer.entities.add({
        position: pos, orientation,
        box: {
          dimensions: new C.Cartesian3(pw, ph, PT),
          material: color, outline: true,
          outlineColor: C.Color.fromCssColorString('#1a1a2e').withAlpha(0.8),
          outlineWidth: 1, shadows: C.ShadowMode.ENABLED,
          // disableDepthTestDistance ensures panels are always visible even if
          // elevation math is slightly off (prevents clipping by 3D tile mesh)
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      panelMapRef.current.set(panel.id, entity);
      return entity;
    } catch (err: any) {
      addLog('ERROR', `addPanelEntity ${panel.id}: ${err.message}`);
    }
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
    const hour = simHourRef.current;
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
    } catch (e: any) {
      addLog('WARN', `updateShadeColors clock sync: ${e.message}`);
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
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    handler.setInputAction((event: any) => {
      try {
        const mode = modeRef.current;
        const screenPos = event.position;
        if (mode === 'select')      handleSelectClick(viewer, C, screenPos);
        else if (mode === 'roof')   handleRoofClick(viewer, C, screenPos);
        else if (mode === 'ground') handleGroundClick(viewer, C, screenPos);
        else if (mode === 'ground_array') handleGroundArrayClick(viewer, C, screenPos);
        else if (mode === 'fence')  handleFenceClick(viewer, C, screenPos);
        else if (mode === 'plane')  handlePlaneClick(viewer, C, screenPos);
        else if (mode === 'row')    handleRowClick(viewer, C, screenPos);
        else if (mode === 'measure') handleMeasureClick(viewer, C, screenPos);
        else if (mode === 'auto_roof') handleAutoRoof(viewer, C);
      } catch (err: any) {
        addLog('ERROR', `Click handler: ${err.message}`);
      }
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => {
      if (modeRef.current === 'plane' && planePtsRef.current.length >= 3) {
        finalizePlane(viewer, C);
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
        const ray = viewer.camera.getPickRay(event.endPosition);
        if (!ray) return;
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (cartesian) {
          const carto = C.Cartographic.fromCartesian(cartesian);
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
          cartesian = pp; pickMethod = '3dtiles';
        }
      }
    } catch (e) { handleCesiumError('3D tiles pick', e, true); }

    // Fallback: globe terrain pick
    if (!cartesian) {
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

      const { tiltDeg, azimuthDeg } = computeSurfaceNormal(viewer, C, screenPos, cartesian, pickMethod);
      const panel = createPanel({
        lat: pLat, lng: pLng, height: pHeight + PANEL_OFFSET,
        tilt: tiltDeg, azimuth: azimuthDeg, systemType: 'roof',
        heading: headingFromAzimuth(azimuthDeg), pitch: tiltDeg, roll: 0,
      });

      addPanelEntity(viewer, C, panel);
      const newPanels = [...panelsRef.current, panel];
      panelsRef.current = newPanels;
      onPanelsChange(newPanels);
      setPanelCount(newPanels.length);
      setStatusMsg(`✅ Roof panel placed (${tiltDeg.toFixed(0)}° pitch, ${azimuthDeg.toFixed(0)}° az) — click to continue, right-click to stop`);
      showGhostPanel(viewer, C, pLat, pLng, pHeight, tiltDeg, azimuthDeg);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) {
      addLog('ERROR', `handleRoofClick: ${err.message}`);
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
      const pHeight = carto.height;
      if (!isValidCoord(pLat, pLng, pHeight)) return;

      const groundTilt = gTiltRef.current;
      const groundAz = azimuthRef.current;
      const panel = createPanel({
        lat: pLat, lng: pLng,
        height: pHeight + PANEL_OFFSET + (PH * Math.sin(groundTilt * Math.PI / 180)) / 2,
        tilt: groundTilt, azimuth: groundAz, systemType: 'ground',
        heading: headingFromAzimuth(groundAz), pitch: groundTilt, roll: 0,
      });

      addPanelEntity(viewer, C, panel);
      const newPanels = [...panelsRef.current, panel];
      panelsRef.current = newPanels;
      onPanelsChange(newPanels);
      setPanelCount(newPanels.length);
      setStatusMsg(`✅ Ground panel placed (${groundTilt}° tilt)`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) {
      addLog('ERROR', `handleGroundClick: ${err.message}`);
    }
  }

  // ── Ground Array placement ────────────────────────────────────────────────────
  // Two-phase: Click 1 = row start, Click 2 = row end (defines direction + length).
  // Subsequent clicks add more rows at auto-calculated spacing (winter solstice formula).
  // Press Enter or right-click to finalize the array.
  function handleGroundArrayClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { setStatusMsg('\u274c No ground detected \u2014 click on open ground'); return; }
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const pt = {
        lat:    C.Math.toDegrees(carto.latitude),
        lng:    C.Math.toDegrees(carto.longitude),
        height: carto.height,
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;

      const pendingStart = groundArrayFirstRowRef.current;

      // Phase 1a: no start yet \u2014 store start point
      if (!pendingStart) {
        groundArrayFirstRowRef.current = { start: pt, end: pt, azimuthDeg: azimuthRef.current, rowSpacingM: 0 };
        try {
          const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.5);
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
        const rowAzDeg  = (Math.atan2(localVec.x, localVec.y) * 180 / Math.PI + 360) % 360;
        const orient = panelOrientationRef.current;
        const { ph } = panelDims(orient);
        const rowSpacingM = calcMinRowSpacing(gTiltRef.current, ph, lat);
        const row1 = placeGroundArrayRow(viewer, C, pendingStart.start, pt, rowAzDeg);
        if (row1.length === 0) { setStatusMsg('\u274c No panels fit \u2014 try a longer line'); return; }
        groundArrayFirstRowRef.current = { start: pendingStart.start, end: pt, azimuthDeg: rowAzDeg, rowSpacingM };
        groundArrayRowsRef.current = [row1];
        setGroundArrayRowCount(1);
        setGroundArrayPanelCount(row1.length);
        try {
          const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.height + 0.5);
          if (mPos) {
            const m = viewer.entities.add({ position: mPos,
              point: { pixelSize: 10, color: C.Color.fromCssColorString('#fbbf24'),
                outlineColor: C.Color.WHITE, outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY } });
            overlayRef.current.push(m);
          }
        } catch {}
        const kw = (row1.length * 400 / 1000).toFixed(1);
        setStatusMsg(`\u2705 Row 1: ${row1.length} panels (${kw} kW) \u2014 click to add Row 2, or press Enter to finish`);
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      // Phase 2+: add subsequent rows at auto-calculated offset
      const ref = groundArrayFirstRowRef.current;
      if (!ref || ref.rowSpacingM === 0) return;
      const rowCount = groundArrayRowsRef.current.length;
      const offsetAzDeg = (azimuthRef.current + 180) % 360;
      const offsetRad   = offsetAzDeg * Math.PI / 180;
      const totalOffset = ref.rowSpacingM * rowCount;
      const c1Base = C.Cartesian3.fromDegrees(ref.start.lng, ref.start.lat, ref.start.height);
      const enuMat = C.Transforms.eastNorthUpToFixedFrame(c1Base);
      const localOff = new C.Cartesian3(totalOffset * Math.sin(offsetRad), totalOffset * Math.cos(offsetRad), 0);
      const worldOff = C.Matrix4.multiplyByPoint(enuMat, localOff, new C.Cartesian3());
      const newC1 = C.Cartesian3.add(c1Base, worldOff, new C.Cartesian3());
      const c2Base = C.Cartesian3.fromDegrees(ref.end.lng, ref.end.lat, ref.end.height);
      const newC2  = C.Cartesian3.add(c2Base, worldOff, new C.Cartesian3());
      const newCarto1 = C.Cartographic.fromCartesian(newC1);
      const newCarto2 = C.Cartographic.fromCartesian(newC2);
      if (!newCarto1 || !newCarto2) return;
      const newStart = { lat: C.Math.toDegrees(newCarto1.latitude), lng: C.Math.toDegrees(newCarto1.longitude), height: newCarto1.height };
      const newEnd   = { lat: C.Math.toDegrees(newCarto2.latitude), lng: C.Math.toDegrees(newCarto2.longitude), height: newCarto2.height };
      const newRow = placeGroundArrayRow(viewer, C, newStart, newEnd, ref.azimuthDeg);
      if (newRow.length === 0) { setStatusMsg('\u26a0\ufe0f No panels fit in this row'); return; }
      groundArrayRowsRef.current = [...groundArrayRowsRef.current, newRow];
      const totalPanels = groundArrayRowsRef.current.reduce((s, r) => s + r.length, 0);
      setGroundArrayRowCount(groundArrayRowsRef.current.length);
      setGroundArrayPanelCount(totalPanels);
      const kw2 = (totalPanels * 400 / 1000).toFixed(1);
      setStatusMsg(`\u2705 ${groundArrayRowsRef.current.length} rows \u00b7 ${totalPanels} panels \u00b7 ${kw2} kW \u2014 click for Row ${groundArrayRowsRef.current.length + 1} or Enter to finish`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) {
      addLog('ERROR', `handleGroundArrayClick: ${err.message}`);
    }
  }

  // Places one row of ground panels between two points, returns the placed panels
  function placeGroundArrayRow(
    viewer: any, C: any,
    p1: { lat: number; lng: number; height: number },
    p2: { lat: number; lng: number; height: number },
    rowAzDeg: number,
  ): PlacedPanel[] {
    const c1 = C.Cartesian3.fromDegrees(p1.lng, p1.lat, p1.height);
    const c2 = C.Cartesian3.fromDegrees(p2.lng, p2.lat, p2.height);
    const rowVec = C.Cartesian3.subtract(c2, c1, new C.Cartesian3());
    const worldLen = C.Cartesian3.magnitude(rowVec);
    if (!isFinite(worldLen) || worldLen < 0.5) return [];
    C.Cartesian3.normalize(rowVec, rowVec);
    const orient = panelOrientationRef.current;
    const { pw } = panelDims(orient);
    const spacing = pw + 0.025;
    const count = Math.max(1, Math.floor(worldLen / spacing));
    const heading = rowAzDeg * Math.PI / 180;
    const groundTilt = gTiltRef.current;
    const groundAz   = azimuthRef.current;
    const newPanels: PlacedPanel[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const worldPos = new C.Cartesian3(
        c1.x + rowVec.x * worldLen * t,
        c1.y + rowVec.y * worldLen * t,
        c1.z + rowVec.z * worldLen * t,
      );
      const panelCarto = C.Cartographic.fromCartesian(worldPos);
      if (!panelCarto) continue;
      const pLat = C.Math.toDegrees(panelCarto.latitude);
      const pLng = C.Math.toDegrees(panelCarto.longitude);
      const pHeight = panelCarto.height;
      if (!isValidCoord(pLat, pLng, pHeight)) continue;
      const panel = createPanel({
        lat: pLat, lng: pLng,
        height: pHeight + PANEL_OFFSET + (PH * Math.sin(groundTilt * Math.PI / 180)) / 2,
        tilt: groundTilt, azimuth: groundAz, systemType: 'ground',
        heading, pitch: groundTilt, roll: 0, orientation: orient,
      });
      newPanels.push(panel);
      addPanelEntity(viewer, C, panel);
    }
    return newPanels;
  }

  // Finalize ground array \u2014 commit all rows to the panel list
  function finalizeGroundArray() {
    const allNewPanels = groundArrayRowsRef.current.flat();
    if (allNewPanels.length === 0) { cancelGroundArray(); return; }
    const allPanels = [...panelsRef.current, ...allNewPanels];
    panelsRef.current = allPanels;
    lastRenderedPanelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    const kw = (allNewPanels.length * 400 / 1000).toFixed(1);
    setStatusMsg(`\u2705 Ground array placed: ${groundArrayRowsRef.current.length} rows \u00b7 ${allNewPanels.length} panels \u00b7 ${kw} kW`);
    resetGroundArray();
    setShowGroundArrayConfirm(false);
    try { const viewer = viewerRef.current; if (viewer) viewer.scene.requestRender(); } catch {}
  }

  function cancelGroundArray() {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    const ghostPanels = groundArrayRowsRef.current.flat();
    if (viewer && C) {
      ghostPanels.forEach(p => {
        const ent = panelMapRef.current.get(p.id);
        if (ent) { try { viewer.entities.remove(ent); } catch {} panelMapRef.current.delete(p.id); }
      });
      try { viewer.scene.requestRender(); } catch {}
    }
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
      const pHeight = carto.height;
      if (!isValidCoord(pLat, pLng, pHeight)) return;

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
    } catch (err: any) {
      addLog('ERROR', `handleFenceClick: ${err.message}`);
    }
  }

  // -- Finalize fence (Phase 5-9: Path interpolation algorithm) --
  // Panels are placed edge-to-edge along the fence polyline using true path distance.
  // Each panel is oriented with the local tangent vector of the path (Phase 7).
  // Curved fences are supported: orientation rotates smoothly along each segment (Phase 8).
  function finalizeFence(viewer: any, C: any) {
    const pts = fencePtsRef.current;
    if (pts.length < 2) return;

    const fenceH = fenceHRef.current;
    const orient = panelOrientationRef.current;
    const { pw } = panelDims(orient);
    // Phase 6: panel spacing = panel width (portrait: 1.134m) for edge-to-edge snapping
    const panelSpacing = pw; // 1.134m portrait, 1.722m landscape

    // Phase 5: computePathLength - total length of the fence polyline in meters
    function computeSegmentLength(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
      const dLat = (p2.lat - p1.lat) * metersPerDegLat();
      const dLng = (p2.lng - p1.lng) * metersPerDegLng(p1.lat);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    }

    // Build cumulative distances array for path interpolation
    const segLengths: number[] = [];
    const cumDist: number[] = [0];
    for (let i = 0; i < pts.length - 1; i++) {
      const len = computeSegmentLength(pts[i], pts[i + 1]);
      segLengths.push(len);
      cumDist.push(cumDist[i] + len);
    }
    const pathLength = cumDist[cumDist.length - 1];

    if (pathLength < panelSpacing) {
      setStatusMsg('Fence too short for panels');
      return;
    }

    // Phase 6: getPointAlongPath - interpolate position at distance d along polyline
    function getPointAlongPath(d: number): { lat: number; lng: number; height: number } {
      // Clamp to path
      const dc = Math.max(0, Math.min(d, pathLength));
      // Find which segment contains distance dc
      let seg = 0;
      for (let i = 0; i < segLengths.length; i++) {
        if (cumDist[i + 1] >= dc) { seg = i; break; }
        seg = i;
      }
      const segStart = cumDist[seg];
      const segLen = segLengths[seg];
      const t = segLen > 0.001 ? (dc - segStart) / segLen : 0;
      const p1 = pts[seg];
      const p2 = pts[seg + 1];
      return {
        lat: p1.lat + (p2.lat - p1.lat) * t,
        lng: p1.lng + (p2.lng - p1.lng) * t,
        height: p1.height + (p2.height - p1.height) * t,
      };
    }

    // Phase 7: getPathTangent - compute heading (radians) from local tangent at distance d
    // Returns heading in radians (0=North, PI/2=East) matching Cesium HeadingPitchRoll
    function getPathTangent(d: number): number {
      // Find which segment contains distance d
      const dc = Math.max(0, Math.min(d, pathLength));
      let seg = 0;
      for (let i = 0; i < segLengths.length; i++) {
        if (cumDist[i + 1] >= dc) { seg = i; break; }
        seg = i;
      }
      const p1 = pts[seg];
      const p2 = pts[seg + 1];
      const dLat = (p2.lat - p1.lat) * metersPerDegLat();
      const dLng = (p2.lng - p1.lng) * metersPerDegLng(p1.lat);
      // atan2(east, north) gives bearing from North, clockwise
      const bearing = Math.atan2(dLng, dLat);
      return bearing; // radians, 0=North
    }

    // Phase 6+7+8: Place panels at panelSpacing intervals along path
    // Start at panelSpacing/2 so first panel center is half-width from start
    const newPanels: PlacedPanel[] = [];
    let distance = panelSpacing / 2;

    while (distance <= pathLength - panelSpacing / 2) {
      const pt = getPointAlongPath(distance);
      const tangentHeading = getPathTangent(distance);

      if (!isValidCoord(pt.lat, pt.lng, pt.height)) {
        distance += panelSpacing;
        continue;
      }

      // Phase 7: Panel heading = path tangent (panel face perpendicular to fence line)
      // The panel's long axis runs along the fence; heading points along the fence direction
      const panel = createPanel({
        lat: pt.lat,
        lng: pt.lng,
        height: pt.height + fenceH / 2,
        tilt: 90,                          // vertical fence panel
        azimuth: azimuthRef.current,       // solar azimuth for energy calc
        systemType: 'fence',
        heading: tangentHeading,           // Phase 7: align with fence path tangent
        pitch: 90,
        roll: 0,
        orientation: orient,
      });
      newPanels.push(panel);
      addPanelEntity(viewer, C, panel);

      distance += panelSpacing;
    }

    const allPanels = [...panelsRef.current, ...newPanels];
    panelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    fencePtsRef.current = [];
    setFencePtCount(0);
    setStatusMsg(`Fence: ${newPanels.length} panels placed (${orient}, ${pathLength.toFixed(1)}m path)`);
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
    } catch (err: any) { addLog('ERROR', `handlePlaneClick: ${err.message}`); }
  }

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

  function finalizeRow(
    viewer: any, C: any,
    p1: { lat: number; lng: number; height: number },
    p2: { lat: number; lng: number; height: number },
    startScreenPos: { x: number; y: number },
  ) {
    // Reconstruct world-space Cartesian3 from stored cartographic coords.
    // fromDegrees guarantees correct ECEF position after scene reloads.
    const c1 = C.Cartesian3.fromDegrees(p1.lng, p1.lat, p1.height);
    const c2 = C.Cartesian3.fromDegrees(p2.lng, p2.lat, p2.height);
    if (!c1 || !c2 || !isFinite(c1.x) || !isFinite(c2.x)) return;

    // Row vector in world space — subtract + normalize in Cartesian3.
    // Correct regardless of terrain slope or camera orientation.
    const rowVec = C.Cartesian3.subtract(c2, c1, new C.Cartesian3());
    const worldLen = C.Cartesian3.magnitude(rowVec);
    if (!isFinite(worldLen) || worldLen < 0.1) return;
    C.Cartesian3.normalize(rowVec, rowVec);

    // Compute row azimuth in ENU frame at p1 for correct Cesium heading.
    // ENU: East=x, North=y → atan2(East, North) = bearing clockwise from North.
    const enuMatrix = C.Transforms.eastNorthUpToFixedFrame(c1);
    const enuInv    = C.Matrix4.inverse(enuMatrix, new C.Matrix4());
    const localVec  = C.Matrix4.multiplyByPointAsVector(enuInv, rowVec, new C.Cartesian3());
    const rowAzDeg  = (Math.atan2(localVec.x, localVec.y) * 180 / Math.PI + 360) % 360;
    const heading   = rowAzDeg * Math.PI / 180; // clockwise from North = Cesium heading

    const orient  = panelOrientationRef.current;
    const { pw }  = panelDims(orient);
    const spacing = pw + 0.05;

    // Surface normal: use actual start-click screen position for correct tilt/azimuth.
    const { tiltDeg, azimuthDeg } = computeSurfaceNormal(viewer, C, startScreenPos, c1, '3dtiles');
    const pitchDeg = isFinite(tiltDeg) ? tiltDeg : tiltRef.current;

    // Panel count based on world-space distance
    const count = Math.max(1, Math.floor(worldLen / spacing));
    const newPanels: PlacedPanel[] = [];

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      // Interpolate along world-space vector → convert back to geo.
      const worldPos = new C.Cartesian3(
        c1.x + rowVec.x * worldLen * t,
        c1.y + rowVec.y * worldLen * t,
        c1.z + rowVec.z * worldLen * t,
      );
      const panelCarto = C.Cartographic.fromCartesian(worldPos);
      if (!panelCarto) continue;
      const pLat    = C.Math.toDegrees(panelCarto.latitude);
      const pLng    = C.Math.toDegrees(panelCarto.longitude);
      const pHeight = panelCarto.height;
      if (!isValidCoord(pLat, pLng, pHeight)) continue;
      const panel = createPanel({
        lat: pLat, lng: pLng, height: pHeight + PANEL_OFFSET,
        tilt: pitchDeg, azimuth: azimuthDeg, systemType: rowSystemTypeRef.current,
        heading, pitch: pitchDeg, roll: 0, orientation: orient,
      });
      newPanels.push(panel);
      addPanelEntity(viewer, C, panel);
    }
    const allPanels = [...panelsRef.current, ...newPanels];
    panelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    setStatusMsg(`✅ Row: ${newPanels.length} panels placed (${orient}) — click to start next row`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Panel selection & deletion ───────────────────────────────────────────
  const measureOverlayRef = useRef<any[]>([]);

  function clearMeasureOverlay() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    measureOverlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    measureOverlayRef.current = [];
    try { viewer.scene.requestRender(); } catch {}
  }

  function clearPanelSelection() {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    const prevId = selectedPanelIdRef.current;
    if (prevId && viewer && C) {
      const ent = panelMapRef.current.get(prevId);
      if (ent) {
        const panel = panelsRef.current.find(p => p.id === prevId);
        if (panel) {
          const sType = (panel.systemType ?? 'roof') as SystemType;
          ent.box.material = new C.ColorMaterialProperty(systemTypeColor(C, sType));
        }
      }
    }
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
  }

  function handleSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      // v31.1: Use drillPick to find panel entities even when occluded by terrain/3D tiles
      // drillPick returns ALL objects at the screen position in depth order
      let foundId: string | null = null;
      let foundEntity: any = null;

      try {
        const drilled = viewer.scene.drillPick(screenPos, 10); // max 10 objects deep
        for (const pickedObj of drilled) {
          if (!pickedObj || !pickedObj.id) continue;
          const entity = pickedObj.id;
          panelMapRef.current.forEach((ent, id) => {
            if (!foundId && ent === entity) { foundId = id; foundEntity = entity; }
          });
          if (foundId) break;
        }
      } catch {
        // Fallback to single pick if drillPick fails
        const picked = viewer.scene.pick(screenPos);
        if (picked && picked.id) {
          panelMapRef.current.forEach((ent, id) => {
            if (!foundId && ent === picked.id) { foundId = id; foundEntity = picked.id; }
          });
        }
      }

      if (!foundId || !foundEntity) { clearPanelSelection(); return; }
      clearPanelSelection();
      foundEntity.box.material = new C.ColorMaterialProperty(C.Color.fromCssColorString('#ff3333').withAlpha(0.92));
      selectedPanelIdRef.current = foundId;
      setSelectedPanelId(foundId);
      const panel = panelsRef.current.find(p => p.id === foundId);
      if (panel) setStatusMsg(`📌 Panel selected — ${panel.tilt?.toFixed(0) ?? '?'}° tilt, ${panel.azimuth?.toFixed(0) ?? '?'}° az | Press Delete or click 🗑️ to remove`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) { addLog('ERROR', `handleSelectClick: ${err.message}`); }
  }

  function deleteSelectedPanel() {
    const viewer = viewerRef.current;
    const id = selectedPanelIdRef.current;
    if (!id || !viewer) return;
    const ent = panelMapRef.current.get(id);
    if (ent) { try { viewer.entities.remove(ent); } catch {} }
    panelMapRef.current.delete(id);
    const newPanels = panelsRef.current.filter(p => p.id !== id);
    panelsRef.current = newPanels;
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    setStatusMsg('🗑️ Panel deleted');
    try { viewer.scene.requestRender(); } catch {}
  }

  function setupKeyboardHandler() {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select' && selectedPanelIdRef.current) {
        e.preventDefault();
        deleteSelectedPanel();
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
    } catch (err: any) { addLog('ERROR', `handleMeasureClick: ${err.message}`); }
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
    const pos = safeCartesian3(C, nextLng, nextLat, lastH + PANEL_OFFSET);
    if (!pos) return;
    const pitchRad = -tiltDeg * Math.PI / 180;
    const hpr = new C.HeadingPitchRoll(heading, pitchRad, 0);
    const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
    if (!orientation) return;
    try {
      const ghost = viewer.entities.add({
        position: pos, orientation,
        box: {
          dimensions: new C.Cartesian3(pw, ph, PT),
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
  function handleAutoRoof(viewer: any, C: any) {
    const twinData = twinRef.current;
    if (!twinData || twinData.roofSegments.length === 0) {
      setStatusMsg('❌ No roof segments — Solar API data required');
      return;
    }

    const newPanels: PlacedPanel[] = [];
    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;

    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    eligibleSegs.forEach((seg: any) => {
      const segPanels = fillRoofSegmentWithPanels(viewer, C, seg);
      newPanels.push(...segPanels);
    });

    const allPanels = [...panelsRef.current, ...newPanels];
    panelsRef.current = allPanels;
    onPanelsChange(allPanels);
    setPanelCount(allPanels.length);
    setStatusMsg(`✅ Auto-roof: ${newPanels.length} panels on ${eligibleSegs.length} segments`);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Fill roof segment with panels ─────────────────────────────────────────────────────────────────────
  // v31.5: Complete rewrite aligned with Row tool's world-space Cartesian3 approach.
  //
  // PRIMARY PATH  — seg.googlePanels (Google Solar API pre-computed positions)
  //   • Uses exact lat/lng from Google's roof analysis
  //   • Height computed via azimuth-projected slope offset from segment center
  //   • Capped at seg.maxPanels (area-based realistic limit)
  //
  // FALLBACK PATH — Row-tool-aligned Cartesian3 grid (when googlePanels is empty)
  //   • Builds grid in world-space using C.Cartesian3.fromDegrees
  //   • Walks along ridge direction (perpendicular to azimuth) and slope direction
  //   • Each panel position converted back to lat/lng via Cartographic.fromCartesian
  //   • Clips to seg.convexHull using point-in-polygon test
  //   • Capped at seg.maxPanels
  //
  // ELEVATION     — geoidOff uses OHIO_GEOID_UNDULATION fallback when terrain not yet sampled
  function fillRoofSegmentWithPanels(viewer: any, C: any, seg: any): PlacedPanel[] {
    const panels: PlacedPanel[] = [];

    if (!seg?.center || !isValidCoord(seg.center.lat, seg.center.lng)) return panels;

    // ── Upper bound: seg.maxPanels is computed from actual roof area with setbacks ──
    // This is the authoritative realistic limit per segment.
    const maxPanelsLimit = (isFinite(seg.maxPanels) && seg.maxPanels > 0) ? seg.maxPanels : 60;

    // ── Shared geometry constants ─────────────────────────────────────────────
    const OHIO_GEOID_UNDULATION = -33.5; // CONUS geoid approximation (meters)
    const mLat = 111320;
    const cosLat = Math.cos(seg.center.lat * Math.PI / 180);
    const mLng = isFinite(cosLat) && cosLat > 0.001 ? 111320 * cosLat : 111320;

    const azDeg    = isFinite(seg.azimuthDegrees) ? seg.azimuthDegrees : 180;
    const pitchDeg = isFinite(seg.pitchDegrees)   ? Math.max(0, Math.min(60, seg.pitchDegrees)) : 20;
    const heading  = headingFromAzimuth(azDeg);
    const tanPitch = Math.tan(pitchDeg * Math.PI / 180);
    if (!isFinite(tanPitch)) return panels;

    // ── Elevation: use cesiumGroundElevRef + seg.heightAboveGround ─────────────
    // seg.heightAboveGround = meters above terrain (from Google Solar API).
    // cesiumGroundElevRef = true Cesium ellipsoidal ground elevation (sampled from terrain).
    // This approach bypasses geoid undulation entirely — no OHIO_GEOID_UNDULATION needed.
    //
    // If cesiumGroundElevRef not yet set (terrain sampling still in progress),
    // fall back to Google orthometric elevation + OHIO_GEOID_UNDULATION estimate.
    // NOTE: handleAutoRoof now waits for cesiumGroundElevRef > 0 before calling this,
    // so the fallback should rarely be needed.
    const heightAboveGround = isFinite(seg.heightAboveGround) ? seg.heightAboveGround : 3.0;
    const segElev = cesiumGroundElevRef.current > 0
      ? cesiumGroundElevRef.current + heightAboveGround
      : (isFinite(seg.elevation) ? seg.elevation : 0) + OHIO_GEOID_UNDULATION;

    // ── Panel dimensions ──────────────────────────────────────────────────────
    const orient = panelOrientationRef.current ?? 'portrait';
    const { pw: PW_O, ph: PH_O } = panelDims(orient);
    const panelW = PW_O + 0.05;  // +5cm inter-panel gap (along ridge)
    const panelH = PH_O + 0.10;  // +10cm inter-panel gap (along slope)

    // ── Point-in-polygon (ray casting) ───────────────────────────────────────
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

    // ── Clip polygon: prefer convexHull (from Google panel centers), then polygon ──
    const clipPoly: Array<{ lat: number; lng: number }> =
      (seg.convexHull && seg.convexHull.length >= 3) ? seg.convexHull :
      (seg.polygon    && seg.polygon.length    >= 3) ? seg.polygon    : [];

    // ════════════════════════════════════════════════════════════════════════
    // PRIMARY PATH: Google's pre-computed panel positions
    // ════════════════════════════════════════════════════════════════════════
    const googlePanels: Array<{ lat: number; lng: number; orientation: string; yearlyEnergyDcKwh: number }>
      = seg.googlePanels ?? [];

    if (googlePanels.length > 0) {
      const limit  = Math.min(googlePanels.length, maxPanelsLimit);
      const azRad  = azDeg * Math.PI / 180;
      const slopeE = Math.sin(azRad);
      const slopeN = Math.cos(azRad);

      for (let i = 0; i < limit; i++) {
        const gp = googlePanels[i];
        if (!isValidCoord(gp.lat, gp.lng)) continue;

        // Height: segment center elevation + slope rise to this panel position
        const dN = (gp.lat - seg.center.lat) * mLat;
        const dE = (gp.lng - seg.center.lng) * mLng;
        const alongSlope = dE * slopeE + dN * slopeN;
        const pHeight = segElev + tanPitch * alongSlope + PANEL_OFFSET;

        if (!isValidCoord(gp.lat, gp.lng, pHeight)) continue;

        const gpOrient: PanelOrientation =
          gp.orientation?.toUpperCase() === 'PORTRAIT' ? 'portrait' : 'landscape';

        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        addPanelEntity(viewer, C, panel);
      }
      if (panels.length > 0) return panels;
    }

    // ════════════════════════════════════════════════════════════════════════
    // FALLBACK PATH: Row-tool-aligned Cartesian3 grid
    // Mirrors finalizeRow() logic: work in world-space Cartesian3, walk along
    // ridge and slope direction vectors, convert back to lat/lng per panel.
    // ════════════════════════════════════════════════════════════════════════
    if (!seg.boundingBox?.sw || !seg.boundingBox?.ne) return panels;

    const SETBACK = 0.5; // meters from roof edge

    // Build world-space origin at segment center
    const originCart = C.Cartesian3.fromDegrees(seg.center.lng, seg.center.lat, segElev);
    if (!originCart || !isFinite(originCart.x)) return panels;

    // ENU frame at segment center — same approach as finalizeRow()
    const enuMatrix = C.Transforms.eastNorthUpToFixedFrame(originCart);

    // Ridge direction = perpendicular to azimuth (along the roof peak)
    // Slope direction = along azimuth (downhill direction)
    const azRad  = azDeg * Math.PI / 180;
    // In ENU: East=x, North=y
    // Slope direction (down-slope): East=sin(az), North=cos(az)
    // Ridge direction (along ridge): East=cos(az), North=-sin(az)
    const slopeLocal = new C.Cartesian3(Math.sin(azRad),  Math.cos(azRad),  0);
    const ridgeLocal = new C.Cartesian3(Math.cos(azRad), -Math.sin(azRad),  0);

    // Convert local ENU direction vectors to world-space Cartesian3
    const slopeWorld = C.Matrix4.multiplyByPointAsVector(enuMatrix, slopeLocal, new C.Cartesian3());
    const ridgeWorld = C.Matrix4.multiplyByPointAsVector(enuMatrix, ridgeLocal, new C.Cartesian3());
    C.Cartesian3.normalize(slopeWorld, slopeWorld);
    C.Cartesian3.normalize(ridgeWorld, ridgeWorld);

    // Compute roof extent in azimuth-rotated frame by projecting BB corners
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
    if (!isFinite(roofW) || !isFinite(roofH) || roofW <= 0 || roofH <= 0) return panels;

    const usableW = Math.max(0, roofW - 2 * SETBACK);
    const usableH = Math.max(0, roofH - 2 * SETBACK);
    if (usableW < panelW || usableH < panelH) return panels;

    const cols = Math.floor(usableW / panelW);
    const rows = Math.floor(usableH / panelH);
    if (cols < 1 || rows < 1) return panels;

    // Center the grid within the usable area
    const ridgeStart = minRidge + SETBACK + (usableW - cols * panelW) / 2;
    const slopeStart = minSlope + SETBACK + (usableH - rows * panelH) / 2;

    // Walk grid row by row — same pattern as finalizeRow() panel loop
    for (let r = 0; r < rows && panels.length < maxPanelsLimit; r++) {
      for (let c = 0; c < cols && panels.length < maxPanelsLimit; c++) {
        const alongRidge = ridgeStart + (c + 0.5) * panelW;
        const alongSlope = slopeStart + (r + 0.5) * panelH;

        // World-space panel position: origin + ridge_offset + slope_offset
        // This mirrors how finalizeRow() interpolates along the row vector
        const worldPos = new C.Cartesian3(
          originCart.x + ridgeWorld.x * alongRidge + slopeWorld.x * alongSlope,
          originCart.y + ridgeWorld.y * alongRidge + slopeWorld.y * alongSlope,
          originCart.z + ridgeWorld.z * alongRidge + slopeWorld.z * alongSlope,
        );

        // Convert back to lat/lng — same as finalizeRow()'s Cartographic.fromCartesian
        const panelCarto = C.Cartographic.fromCartesian(worldPos);
        if (!panelCarto) continue;
        const pLat    = C.Math.toDegrees(panelCarto.latitude);
        const pLng    = C.Math.toDegrees(panelCarto.longitude);
        const pHeight = panelCarto.height + PANEL_OFFSET;

        if (!isValidCoord(pLat, pLng, pHeight)) continue;

        // Polygon clipping: discard panels outside the roof polygon
        if (clipPoly.length >= 3 && !pointInPolygon(pLat, pLng, clipPoly)) continue;

        const panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: orient,
        });
        panels.push(panel);
        addPanelEntity(viewer, C, panel);
      }
    }
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
  }): PlacedPanel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    };
    return p;
  }

  // ── Clear all panels ───────────────────────────────────────────────────────
  function clearPanels() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    lastRenderedPanelsRef.current = []; // reset incremental diff state
    panelsRef.current = [];
    onPanelsChange([]);
    setPanelCount(0);
    setStatusMsg('🗑️ All panels cleared');
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── Sun animation ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (animating) {
      const interval = setInterval(() => {
        setSimHour(h => {
          const next = h >= 20 ? 5 : h + 0.25;
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
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    const elevation = twinRef.current?.elevation ?? 0;
    viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lng, lat, elevation + 200),
      orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
      duration: 2,
    });
  }

  function formatHour(h: number): string {
    const hh = Math.floor(h);
    const mm = Math.round((h % 1) * 60);
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }

  // Sun position for display — use UTC hours to match fixed getSunPosition
  const sunPos = getSunPosition(lat, lng, (() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear(), 5, 21);
    d.setUTCHours(Math.floor(simHour), Math.round((simHour % 1) * 60), 0, 0);
    return d;
  })());
  // Local solar time = UTC + longitude/15 (4 min per degree)
  const solarNoonUTC = 12 - lng / 15;
  const localSolarHourRaw = simHour + lng / 15;
  const localSolarHourClamped = ((localSolarHourRaw % 24) + 24) % 24;
  const lsh = Math.floor(localSolarHourClamped);
  const lsm = Math.round((localSolarHourClamped % 1) * 60);
  const localSolarTimeStr = `${lsh.toString().padStart(2,'0')}:${lsm.toString().padStart(2,'0')}`;
  const azToDir = (az: number) => {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(az / 22.5) % 16];
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a1a', overflow: 'hidden' }}>

      {/* Cesium container */}
      <div ref={cesiumRef} style={{ width: '100%', height: '100%' }} />

      {/* Phase 0: Debug Panel — always visible for QA */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', top: 36, left: 8, zIndex: 200,
          background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(0,255,100,0.3)',
          borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 10,
          color: '#aaffaa', lineHeight: 1.7, minWidth: 260, backdropFilter: 'blur(4px)',
        }}>
          <div style={{ color: '#00ff88', fontWeight: 700, marginBottom: 4 }}>[DBG] Debug Panel</div>
          <div><span style={{ color: '#888' }}>renderMode:</span> <span style={{ color: renderMode === 'TILES' ? '#44ff88' : '#ffaa44' }}>{renderMode}</span></div>
          <div><span style={{ color: '#888' }}>terrainReady:</span> <span style={{ color: terrainReady ? '#44ff88' : '#ff4444' }}>{String(terrainReady)}</span></div>
          <div><span style={{ color: '#888' }}>tilesetReady:</span> <span style={{ color: tilesetReady ? '#44ff88' : '#ffaa44' }}>{String(tilesetReady)}</span></div>
          <div><span style={{ color: '#888' }}>activeTool:</span> <span style={{ color: '#00ccff' }}>{placementMode}</span></div>
          <div><span style={{ color: '#888' }}>clickCount:</span> <span style={{ color: '#ffd700' }}>{clickCountForTool}</span></div>
          <div><span style={{ color: '#888' }}>pickMethod:</span> <span style={{ color: '#ff88ff' }}>{lastPickMethod}</span></div>
          <div style={{ color: '#888' }}>lastPick:</div>
          <div style={{ color: '#aaaaff', fontSize: 9, paddingLeft: 8 }}>{lastPickLatLon}</div>
        </div>
      )}

      {/* Loading overlay */}
      {stage !== 'done' && stage !== 'error' && (
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
      )}

            {/* Error overlay */}
      {stage === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(10,10,26,0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ color: '#ff4444', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>3D Engine Error</div>
          <div style={{ color: '#aaa', fontSize: 13, maxWidth: 400, textAlign: 'center', marginBottom: 24 }}>{stageMsg}</div>
          <button
            onClick={() => { initDone.current = false; setStage('idle'); boot(); }}
            style={{ padding: '10px 24px', background: '#ff8c00', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Top toolbar */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 4, alignItems: 'center',
          background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 10px', zIndex: 50,
        }}>
          {([
            { mode: 'select' as PlacementMode, icon: '↖', label: 'Select' },
            { mode: 'roof' as PlacementMode, icon: '🏠', label: 'Roof' },
            { mode: 'ground' as PlacementMode, icon: '🌍', label: 'Ground' },
            { mode: 'ground_array' as PlacementMode, icon: '🌱', label: 'G-Array' },
            { mode: 'fence' as PlacementMode, icon: '⚡', label: 'Fence' },
            { mode: 'plane' as PlacementMode, icon: '📐', label: 'Plane' },
            { mode: 'row' as PlacementMode, icon: '➡', label: 'Row' },
            { mode: 'measure' as PlacementMode, icon: '📏', label: 'Measure' },
            { mode: 'auto_roof' as PlacementMode, icon: '✨', label: 'Auto' },
          ] as { mode: PlacementMode; icon: string; label: string }[]).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => {
                onPlacementModeChange(mode);
                if (mode === 'auto_roof') {
                  const viewer = viewerRef.current;
                  const C = (window as any).Cesium;
                  if (viewer && C) handleAutoRoof(viewer, C);
                }
                // Cancel any in-progress ground array when switching modes
                if (mode !== 'ground_array' && groundArrayRowsRef.current.length > 0) {
                  cancelGroundArray();
                }
                // Track system type context for row tool (row inherits from last non-row mode)
                if (mode === 'roof' || mode === 'ground' || mode === 'ground_array' || mode === 'fence') {
                  rowSystemTypeRef.current = (mode === 'ground_array' ? 'ground' : mode) as SystemType;
                }
                if (mode !== 'fence') { fencePtsRef.current = []; setFencePtCount(0); }
                if (mode !== 'plane') { planePtsRef.current = []; setPlanePtCount(0); }
                if (mode !== 'row')   { rowPtsRef.current = [];   setRowPtCount(0); rowStartScreenPosRef.current = null; }
                if (mode !== 'measure') { measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay(); }
                if (mode !== 'select')  { clearPanelSelection(); }
              }}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: placementMode === mode ? 'linear-gradient(135deg, #ff8c00, #ffd700)' : 'rgba(255,255,255,0.08)',
                color: placementMode === mode ? '#000' : '#ccc', transition: 'all 0.15s',
              }}
            >
              {icon} {label}
            </button>
          ))}

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* v31.1: Active tool indicator */}
          <div style={{
            fontSize: 10, color: '#888', padding: '2px 6px',
            background: 'rgba(255,255,255,0.05)', borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.08)',
            whiteSpace: 'nowrap',
          }}>
            <span style={{ color: '#555' }}>Tool: </span>
            <span style={{ color: placementMode === 'select' ? '#10b981' : '#ff8c00', fontWeight: 700 }}>
              {placementMode === 'select' ? '↖ Select' :
               placementMode === 'roof' ? '🏠 Place Roof' :
               placementMode === 'ground' ? '🌍 Place Ground' :
               placementMode === 'ground_array' ? '🌱 G-Array' :
               placementMode === 'fence' ? '⚡ Fence' :
               placementMode === 'plane' ? '📐 Plane' :
               placementMode === 'row' ? '➡ Row' :
               placementMode === 'measure' ? '📏 Measure' :
               placementMode === 'auto_roof' ? '✨ Auto Fill' : placementMode}
            </span>
          </div>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* Ground tilt selector — shown for both Ground and Ground Array modes */}
          {(placementMode === 'ground' || placementMode === 'ground_array') && (
            <select value={gTilt} onChange={e => setGTilt(Number(e.target.value))}
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
              <option value={0}>0° Flat</option>
              <option value={10}>10°</option>
              <option value={20}>20°</option>
              <option value={25}>25°</option>
              <option value={30}>30°</option>
              <option value={35}>35°</option>
              <option value={40}>40°</option>
              <option value={90}>90° Vertical</option>
            </select>
          )}

          {/* Ground Array status + confirm/cancel buttons */}
          {placementMode === 'ground_array' && groundArrayRowCount > 0 && (
            <>
              <div style={{ color: '#14b8a6', fontSize: 12, padding: '4px 8px', fontWeight: 600 }}>
                {groundArrayRowCount} row{groundArrayRowCount !== 1 ? 's' : ''} · {groundArrayPanelCount} panels
              </div>
              <button
                onClick={finalizeGroundArray}
                style={{ padding: '4px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', border: 'none',
                  background: 'linear-gradient(135deg, #14b8a6, #0d9488)', color: '#fff' }}>
                ✓ Confirm
              </button>
              <button
                onClick={cancelGroundArray}
                style={{ padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                ✗ Cancel
              </button>
            </>
          )}

          {/* Ground Array hint when no rows yet */}
          {placementMode === 'ground_array' && groundArrayRowCount === 0 && (
            <div style={{ color: '#14b8a6', fontSize: 11, padding: '4px 8px', opacity: 0.8 }}>
              Click start → end → more rows → Enter
            </div>
          )}

          {/* Plane info + finish button */}
          {placementMode === 'plane' && (
            <>
              <div style={{ color: '#00ccff', fontSize: 12, padding: '4px 8px' }}>
                {planePtCount === 0 ? 'Click roof corners' : `${planePtCount} pts`}
              </div>
              {planePtCount >= 3 && (
                <button
                  onClick={() => {
                    const viewer = viewerRef.current;
                    const C = (window as any).Cesium;
                    if (viewer && C) finalizePlane(viewer, C);
                  }}
                  style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                    background: 'rgba(0,180,255,0.2)', color: '#00ccff',
                    border: '1px solid rgba(0,180,255,0.4)', cursor: 'pointer' }}
                >
                  ✅ Fill Plane
                </button>
              )}
            </>
          )}

          {/* Fence info + finish button */}
          {placementMode === 'fence' && fencePtCount > 0 && (
            <>
              <div style={{ color: '#ff8800', fontSize: 12, padding: '4px 8px' }}>
                {fencePtCount} pts
              </div>
              {fencePtCount >= 2 && (
                <button
                  onClick={() => {
                    const viewer = viewerRef.current;
                    const C = (window as any).Cesium;
                    if (viewer && C) finalizeFence(viewer, C);
                  }}
                  style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                    background: 'rgba(0,200,100,0.2)', color: '#00cc66',
                    border: '1px solid rgba(0,200,100,0.4)', cursor: 'pointer' }}
                >
                  ✅ Finish Fence
                </button>
              )}
            </>
          )}

          {/* Row mode status */}
          {placementMode === 'row' && (
            <div style={{ color: '#00ffcc', fontSize: 12, padding: '4px 8px' }}>
              {rowPtCount === 0 ? 'Click row start' : 'Click row end'}
            </div>
          )}

          {/* Measure mode status + clear */}
          {placementMode === 'measure' && (
            <>
              <div style={{ color: '#00ffff', fontSize: 12, padding: '4px 8px' }}>
                {measurePtCount === 0 ? 'Click point 1' : measurePtCount === 1 ? 'Click point 2' : `${measurePtCount} pts`}
              </div>
              {measurePtCount > 0 && (
                <button
                  onClick={() => { measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay(); }}
                  style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                    background: 'rgba(0,200,255,0.15)', color: '#00ffff',
                    border: '1px solid rgba(0,200,255,0.3)', cursor: 'pointer' }}
                >
                  🗑 Clear
                </button>
              )}
            </>
          )}

          {/* Select mode — delete selected panel */}
          {placementMode === 'select' && selectedPanelId && (
            <>
              <div style={{ color: '#ff6666', fontSize: 12, padding: '4px 8px' }}>1 selected</div>
              <button onClick={deleteSelectedPanel}
                style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                  background: 'rgba(255,50,50,0.2)', color: '#ff6666',
                  border: '1px solid rgba(255,50,50,0.4)', cursor: 'pointer' }}>
                🗑 Delete
              </button>
              <button onClick={clearPanelSelection}
                style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11,
                  background: 'rgba(255,255,255,0.08)', color: '#aaa',
                  border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>
                ✕
              </button>
            </>
          )}

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* Portrait / Landscape toggle */}
          <button
            onClick={() => {
              const next: PanelOrientation = panelOrientation === 'portrait' ? 'landscape' : 'portrait';
              setPanelOrientation(next);
              panelOrientationRef.current = next;
            }}
            title="Toggle panel orientation"
            style={{
              padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer',
              background: panelOrientation === 'landscape' ? 'rgba(255,140,0,0.25)' : 'rgba(255,255,255,0.08)',
              color: panelOrientation === 'landscape' ? '#ffd700' : '#aaa',
              border: panelOrientation === 'landscape' ? '1px solid rgba(255,200,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {panelOrientation === 'portrait' ? '▯ Portrait' : '▭ Landscape'}
          </button>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          <div style={{ color: '#ffd700', fontSize: 13, fontWeight: 700, padding: '0 4px' }}>{panelCount} panels</div>
          <div style={{ color: '#4caf50', fontSize: 13, fontWeight: 700 }}>{totalKw} kW</div>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          <button onClick={flyToProperty} title="Fly to property"
            style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'rgba(255,255,255,0.08)', color: '#ccc', border: 'none', cursor: 'pointer' }}>
            🏠
          </button>
          <button
            onClick={() => {
              const viewer = viewerRef.current;
              if (!viewer) return;
              const C = (window as any).Cesium;
              if (!C) return;
              const elev = cesiumGroundElevRef.current;
              viewer.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(lng, lat, elev + 200),
                orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
                duration: 1.5,
              });
              setStatusMsg('🧭 Oriented: North up — South is at bottom of view');
            }}
            title="Orient view: North up (South at bottom)"
            style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'rgba(255,140,0,0.12)', color: '#ffaa44', border: '1px solid rgba(255,140,0,0.25)', cursor: 'pointer' }}>
            🧭 S↓
          </button>
          <button onClick={clearPanels} title="Clear all panels"
            style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, background: 'rgba(255,60,60,0.15)', color: '#ff6666', border: '1px solid rgba(255,60,60,0.3)', cursor: 'pointer' }}>
            🗑
          </button>
        </div>
      )}

      {/* Overlay toggles (left side) */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 8px', zIndex: 50,
        }}>
          {[
            { key: 'parcel', label: '📐 Parcel', value: showParcel, color: '#00ff88' },
            { key: 'roof', label: '🏠 Roof Segs', value: showRoofSegs, color: '#ffd700' },
            { key: 'shade', label: '🌡 Shade', value: showShadeLocal, color: '#ff6644' },
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
      )}

      {/* Sun simulator (bottom) */}
      {stage === 'done' && (
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
                <div style={{ color: '#888', fontSize: 10 }}>UTC: {formatHour(simHour)}</div>
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

          {/* Row 2: slider with hour ticks + solar noon marker */}
          <div style={{ width: '100%', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              {Array.from({length: 16}, (_, i) => i + 5).map(h => (
                <div key={h} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <div style={{ width: 1, height: h % 3 === 0 ? 7 : 3,
                    background: h % 3 === 0 ? 'rgba(255,200,0,0.5)' : 'rgba(255,255,255,0.15)' }} />
                  {h % 3 === 0 && <div style={{ color: 'rgba(255,200,0,0.55)', fontSize: 9 }}>{h}</div>}
                </div>
              ))}
            </div>
            <input type="range" min={5} max={20} step={0.25} value={simHour}
              onChange={e => { const v = Number(e.target.value); simHourRef.current = v; setSimHour(v); updateShadeColors(); }}
              style={{ width: '100%', accentColor: '#ff8c00', cursor: 'pointer' }} />
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${Math.max(0, Math.min(100, (solarNoonUTC - 5) / 15 * 100))}%`,
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
      )}

      {/* Compass rose */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', bottom: 120, right: 12, width: 64, height: 64, zIndex: 50,
          background: 'rgba(10,12,24,0.85)', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <svg width="52" height="52" viewBox="0 0 52 52">
            <polygon points="26,4 22,26 26,22 30,26" fill="#ff4444" opacity="0.9"/>
            <polygon points="26,48 22,26 26,30 30,26" fill="rgba(255,255,255,0.7)" opacity="0.9"/>
            <circle cx="26" cy="26" r="3" fill="rgba(255,255,255,0.9)"/>
            <text x="26" y="14" textAnchor="middle" fill="#ff4444" fontSize="9" fontWeight="bold" fontFamily="sans-serif">N</text>
            <text x="26" y="46" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="9" fontWeight="bold" fontFamily="sans-serif">S</text>
            <text x="46" y="29" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="sans-serif">E</text>
            <text x="6" y="29" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="sans-serif">W</text>
          </svg>
        </div>
      )}

      {/* Status bar */}
      {stage === 'done' && statusMsg && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 16px',
          color: '#ccc', fontSize: 12, zIndex: 50, maxWidth: '80%', textAlign: 'center',
        }}>
          {statusMsg}
        </div>
      )}

      {/* Coordinates bar */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '3px 8px',
          color: '#666', fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {lat.toFixed(5)}, {lng.toFixed(5)} | h={ftStr(cesiumGroundElevRef.current)} ({cesiumGroundElevRef.current.toFixed(0)}m)
        </div>
      )}

      {/* Tile status indicator */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', top: 8, right: 60,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 7px',
          color: tileStatus === 'loaded' ? '#44ff88' : tileStatus === 'failed' ? '#ff6644' : '#ffaa44',
          fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {tileStatus === 'loaded' ? '🟢 3D' : tileStatus === 'failed' ? '🔴 3D' : '🟡 3D'}
        </div>
      )}

      {/* FPS counter */}
      {stage === 'done' && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 7px',
          color: fps < 30 ? '#ff4444' : '#44ff88', fontSize: 10, zIndex: 50, fontFamily: 'monospace',
        }}>
          {fps} FPS
        </div>
      )}

      {/* Last log */}
      {stage === 'done' && lastLog && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 8px',
          color: '#555', fontSize: 9, zIndex: 50, fontFamily: 'monospace', maxWidth: 300,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lastLog}
        </div>
      )}
    </div>
  );
}

// ── React.memo wrapper ─────────────────────────────────────────────────────
// Prevents SolarEngine3D from re-rendering when unrelated parent state changes
// (e.g. right-panel config edits, proposal values, etc.)
// Only re-renders when 3D-relevant props actually change.
export default React.memo(SolarEngine3D, (prev, next) => {
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
    prev.onPlacementModeChange === next.onPlacementModeChange
  );
});
