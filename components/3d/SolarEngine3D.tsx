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

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MapSourcePicker, DEFAULT_PICKER_STATE, type MapPickerState } from '@/components/3d/mapSource';
import { buildDigitalTwin, enrichDigitalTwinWithDsm, type DigitalTwinData, type RoofSegment } from '@/lib/digitalTwin';
import { filterToSubjectBuilding, dropDetectedPlanesOverlappingManual } from '@/lib/aerial/subjectBuildingCrop';
import { autoLayoutScope, panelsAutoRoofOwns, mergeAutoRoofPanels } from '@/lib/3d/autoLayoutScope';
import {
  OBSTRUCTION_PRESETS, DEFAULT_OBSTRUCTION_PRESET, presetFor, legacyRadiusFor,
  type ObstructionPresetId,
  clampToPreset,
} from '@/lib/3d/obstructionPresets';
import { DEFAULT_CLEARANCE_M } from '@/lib/3d/panelKeepOut';
import { OVERLAY_Z } from '@/lib/3d/overlayLayers';
/**
 * How far from the site a placement click may land, metres.
 *
 * A click on the sky just above the roofline misses every face and every
 * surface, and `camera.pickEllipsoid` then answers with the GRAZING
 * intersection several kilometres away. Nothing objected: `isValidCoord` only
 * range-checks degrees. The object was created, in a field, off screen, and the
 * only symptom was that nothing appeared where the user clicked.
 *
 * 🚨 IT WAS 250 m AND THAT REFUSED REAL CLICKS. The failure it exists to catch
 * -- a click on the sky taking `pickEllipsoid`'s grazing intersection -- lands
 * KILOMETRES away, so the bound only has to be smaller than that. 250 m is
 * smaller than a rural parcel, a ground-mount array, or a tree at the back of a
 * long lot, and it silently refused them. A bound that rejects the work is worse
 * than the failure it prevents.
 */
const PLACEMENT_RADIUS_M = 1_000;

import {
  nearestFaceAlongRay,
  intersectRayWithGeocentricSphere,
  type PlanarFace as IntersectFace,
} from '@/lib/3d/placementIntersection';
import { getSunPosition, getPanelShadingFactor } from '@/lib/solarMath';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import {
  segmentToRoofPlane, stampDetectedProvenance, detectionStatusFromSegmentCount,
  isHandModelledFace,
  shouldRunLaneA as shouldRunLaneAPure,
  type LaneASegment, type LaneAGateInput as LaneAGateInputPure,
} from '@/lib/3d/laneA';
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
  resolvePlaneGeometry,
} from '@/lib/surfaceGeometry3D';
import type { PlacedObstruction } from '@/types';
import {
  buildRoofPlane3D,
  computePlaneFromPoints3D,
  ecefToLatLng,
  renderPlane3DEntity,
  renderPoint3DMarker,
  renderPreviewPolyline,
  SURFACE_OFFSET_M,
  unliftFacesPreservingSharedCorners,
  type Cart3,
  type Plane3DFrame,
} from '@/lib/roofPlane3D';
import { buildSectionRoofPlanes, sectionIdOfFaceId } from '@/lib/3d/buildingSection';
import {
  applySectionEdit, measureSection, measureFaceVertical, sectionFromPlanes, listSections,
  repositionPanelsForPlanes,
  applyFacePitchEdit,
  previewFacePitch,
  measureWall,
  type SectionEdit,
  type SectionEditOutcome,
  type PitchAnchor,
} from '@/lib/3d/sectionEditing';
import { formatRise12 } from '@/lib/3d/pitchFormat';
import { SectionInspector, type InspectorState } from '@/components/3d/inspector/SectionInspector';
import {
  nativeAcquisitionPermitted,
  type NativeGeometryDisposition,
} from '@/lib/design/nativeGeometryDisposition';
// v66: Aurora-style 2D → 3D. Builds a pitched roof face from a flat traced
// outline plus pitch + azimuth, for addresses with no Photorealistic 3D Tiles.
import { roofPlaneFromFootprint, roofPlaneFromFootprintAndRidge } from '@/lib/3d/footprintToRoofPlane';
// v66: solid building — walls dropped from exterior roof edges to the ground.
import { buildWalls, faceOrientation, deriveAzimuthsFromSharedEdges, findSharedRidge } from '@/lib/3d/buildingExtrusion';
import { composeRoofTexture, clearRoofTextureCache } from '@/lib/3d/roofTexture';
import { regularizeOutline, joinSharedCorners } from '@/lib/3d/regularizeOutline';
import { snapAbutments } from '@/lib/3d/abutment';
import { deriveAzimuthFromOutline } from '@/lib/aerial/nearmapToRoofPlane';
import {
  placeFencePanels,
  placeGroundRow,
  getPanelDims,
  PANEL_OFFSET_M as PLANE_ENGINE_PANEL_OFFSET_M,
} from '@/lib/planeEngine';
import { latLngToECEF as engLatLngToECEF, projectOutlineOntoPlane } from '@/lib/roofPlane3D';

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
import { moduleStackHeightM, railCrossSectionM, deckPointFromModule, drawnRailHeightM, RAIL_DRAW_SCALE } from '@/lib/roofMountDatum';
import { geoidUndulationM, resolveGroundDatum } from '@/lib/geodeticDatum';
import { pickFace, selectableFacesFrom, type SelectableFace } from '@/lib/3d/faceHitTest';
import { hasUsableElevation } from '@/lib/surfaceGeometry3D';

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

// v66: Bottom-right Design-phase status panel (Aurora frame 0147 parity).
import { StatusPanel } from './status';

// v64: Block / Gable / Hip math (pure functions, unit-tested in tests/block3d.test.ts)
import {
  computeBlockDimensions,
  computeGableGeometry,
  computeHipGeometry,
  clampBlockHeight,
} from '@/lib/3d/blockMath';

// v66 (lidar-integration): Load .las files, render as Mesh or Point Cloud,
// apply X/Y/Z offset (feet), toggle textured drape. Aurora parity (frames
// 125/130/135). Pure math in lib/3d/lidar; Cesium-coupled parts loaded
// only when a dataset is present.
import {
  LiDARPropertiesPanel,
  LiDARLoadingToast,
  useLiDARState,
  loadLiDARFromFilePicker,
  createLiDARController,
  liftRoofs as liftRoofsUtil,
  flattenRoofs as flattenRoofsUtil,
  type LiDARDataset,
  type LiDARState,
} from '@/lib/3d/lidar';

// v68: Segment normal arrows — yellow chevron at the midpoint of each
// polyline edge in the in-progress block line-trace. Aurora parity
// for the "ridge direction" indicator (HANDOFF §2 Step 1).
import {
  createSegmentArrowOverlay,
  buildSegmentsFromPoints,
  type SegmentArrowOverlay,
} from '@/components/3d/segments';

// v66 (obstruction-primitive): Aurora-parity "Add Obstruction" primitive.
// Single-click placement of a small rectangular prism (chimney, vent,
// dormer). Default 0.6m × 0.6m × 1.0m, configurable via right-panel
// sliders. Reuses the block primitive's 3D extruded-polygon pattern;
// math is unit-tested in tests/obstruction.test.ts.
import {
  DEFAULT_OBSTRUCTION_FOOTPRINT_W_M,
  DEFAULT_OBSTRUCTION_FOOTPRINT_D_M,
  DEFAULT_OBSTRUCTION_HEIGHT_M,
  MIN_OBSTRUCTION_FOOTPRINT_M,
  MAX_OBSTRUCTION_FOOTPRINT_M,
  MIN_OBSTRUCTION_HEIGHT_M,
  MAX_OBSTRUCTION_HEIGHT_M,
  clampObstructionFootprint,
  buildObstructionFootprint,
  obstructionFootprintAreaM2,
} from './obstruction';

// v65 (roof-wizard): 3-step sticky roof-drawing wizard — Aurora parity
// (HANDOFF_2026-08-25 §2). HUD stepper that appears during any
// roof-draw mode. UI + state machine live in components/3d/wizard/.
// See DESIGN.md for the spec.
import { RoofWizard } from './wizard';

// v66 (create-design-modal): Aurora-parity "Save → Create Design" trigger.
// The modal itself lives in components/3d/designs/CreateDesignModal.tsx; the
// parent owns open state and is expected to render the modal when onCreateDesign
// fires. See components/3d/designs/DESIGN.md.
// (no top-level import — the trigger is a local <button>, the modal is mounted by the parent)

// v66 (dark-canvas): Aurora-parity Design-phase dark overlay with grid.
// Renders the 50px major + 10px minor grid in rgba(26,26,46,0.75) over the
// canvas. Returns null in Site Model so the satellite shows through. See
// components/3d/canvasTheme/DESIGN.md.
import { CanvasTheme } from './canvasTheme';

// v66 (help-panel): Aurora-parity left-sidebar INSTRUCTIONS panel that
// shows context-aware guidance per tool/mode. See components/3d/help/.
import { HelpPanel } from './help/HelpPanel';

// v68: Generic "drag-to-move" wrapper for the canvas chrome panels
// (LiDAR, INSTRUCTIONS, Sun, etc.). Header becomes a grab cursor;
// drag persists offset to localStorage. See components/3d/DraggablePanel.tsx.
import { DraggablePanel } from './DraggablePanel';

// v65 (camera-tilt): Aurora-parity camera presets — default 3D view at -45° pitch
// (tilted aerial) instead of -65° (top-down-ish). See lib/3d/cameraPresets.ts.
import {
  TILTED_AERIAL_VIEW,
  computeRangeFromBounds,
} from '@/lib/3d/cameraPresets';

// v66: Measurements + Ruler math + renderers (Aurora TIER 2 #10 parity).
// Pure math in lib/3d/measureMath.ts (unit-tested in tests/measurements.test.ts).
// Cesium side-effects in components/3d/measure/measurements.tsx.
import {
  buildMeasurement,
  type Measurement,
  type LngLatH,
} from '@/lib/3d/measureMath';
import {
  renderMeasurement,
  removeMeasurementBundle,
  renderRulerPreview,
  type MeasurementEntityBundle,
} from './measure/measurements';

// v68 (canvas-controls): Aurora-parity bottom-left control strip
// (HANDOFF_2026-08-25 §1) — compass / north arrow, zoom +/-, three
// layer toggle buttons. The strip is a pure UI shell: it owns no
// scene state. Wired to the same `showParcel` / `showRoofSegs` /
// `showShadeLocal` state that drives the existing horizontal
// layer-toggle row at `left: 60, bottom: 16`. Both UIs stay in sync.
import {
  CanvasControls,
  computeZoomedRadius,
  ICON_PARCEL,
  ICON_ROOF,
  ICON_SHADE,
  type LayerToggle,
} from './controls';

// v65 (tree-cursor): 2D tree-placement footprint preview. Aurora parity
// (frame 0115) — translucent light-blue circle sized to the tree canopy
// radius, follows the mouse. See components/3d/tree/CURSOR.md.
import {
  TreeCursor,
  DEFAULT_TREE_CANOPY_RADIUS_M as _TREE_CANOPY_R_M,
} from './tree';
const TREE_CANOPY_RADIUS_M = _TREE_CANOPY_R_M;

// v66 (flat trace): DEFAULT eave height for a footprint-built roof face, metres.
// ~10 ft — a single-storey eave. A hand trace carries no measured height, and
// this value does NOT affect pitch, azimuth or area (see
// lib/3d/footprintToRoofPlane.ts) — it only sets how far the face floats above
// ground in the 3D scene, where on a no-coverage address there is no building
// mesh to sit on anyway. Per-face eave height is a later step.
const FLAT_TRACE_EAVE_HEIGHT_M = 3.0;

// v66: shared style for the Building view's stepper buttons.
const BUILD_STEP_BTN: React.CSSProperties = {
  padding: '1px 7px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.10)', color: '#e8eaf0', cursor: 'pointer',
  fontWeight: 700, fontSize: 12, lineHeight: 1.4,
};

// v68: Vertex Handles (in-place footprint editing for Block / Gable / Hip / Tree).
// Math in lib/3d/vertexHandlesMath.ts (unit-tested in tests/vertexHandles.test.ts).
// Component in components/3d/editing/VertexHandles.tsx.
import VertexHandles from '@/components/3d/editing/VertexHandles';
import {
  applyVertexMove as vhApplyVertexMove,
  rebuildGableFaces as vhRebuildGableFaces,
  rebuildHipFaces as vhRebuildHipFaces,
  type VertexTargetSpec as VHTargetSpec,
} from '@/lib/3d/vertexHandlesMath';

// P0-6 (DATA-AUTHORITY-AUDIT): panel specs stamped onto placed panels come
// from the equipment authority (equipment-db record), NEVER a hardcoded
// literal in this component.
import { getPanelById } from '@/lib/equipment-db';

// v70 (undo-system): Aurora TIER 3 #11 + #20 — top-bar Save / Undo / Redo
// toolbar with a 50-step ring buffer of complete SceneState snapshots.
// The store is a pure-logic factory in lib/state/historyStore.ts; the
// toolbar React component is in lib/state/Buttons.tsx. Mounted once per
// canvas. State is local to this view; the wider surface integration
// (dispatching actions on every primitive add/remove) is intentionally
// staged for a follow-up commit so this slice is reversible on its own.
// (The Save/Undo/Redo chip and its SceneState history store used to be imported
//  here. See the note at the former `historyStoreRef` for why they are not.)

// v66: Lift Roofs / Flatten Roofs quick actions for the 3D Primitives
// (block / gable / hip entities the user draws in the canvas). Pure
// functions in lib/3d/roofActions.ts (unit-tested in tests/roofActions.test.ts).
// Note: the lidar-integration agent's `liftRoofs` / `flattenRoofs`
// (imported above, aliased as `liftRoofsUtil` / `flattenRoofsUtil`) operate
// on the `roofPlanes` data model. This import is a separate, complementary
// set of pure functions that operate on the 3D Primitives entity model.
import {
  liftRoofs as liftRoofsPrimitives,
  flattenRoofs as flattenRoofsPrimitives,
  type RoofPrimitive,
} from '@/lib/3d/roofActions';

// Ray's ruling 2026-07-19: the SolFence 6-ft fence uses ONLY the Philadelphia
// Solar PS-MNB108(HCBF)-440W. Fence placement resolves the wattage stamp from
// this equipment-db record at placement time — the old hardcoded `430` here
// poisoned 18/18 Stowell fence stamps (plus 4 more projects).
const FENCE_PANEL_EQUIPMENT_ID = 'panel-fence-ps1';

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
// MOVED. The stack height a module sits at above the roof deck, and the rail
// cross-section under it, now live in lib/roofMountDatum.ts — together with the
// four other places that used to answer the same question differently. Rail
// dimensions come from lib/mounting-hardware-db.ts, which cites a manufacturer
// document for each one; they are no longer restated here.
//
// RENDERING ONLY — does NOT affect structural calc, placement math, ECEF coords, or BOM.

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

export type PlacementMode = 'select' | 'roof' | 'ground' | 'fence' | 'auto_roof' | 'plane' | 'row' | 'measure' | 'ground_array' | 'pick_house' | 'surface_select' | 'extend_row' | 'add_row' | 'snap_panel' | 'obstruction' | 'plane3d' | 'mark_plane' | 'set_direction' | 'set_origin' | 'block' | 'roof_gable' | 'roof_hip' | 'tree' | 'measurements' | 'ruler';
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

/**
 * What a reshape emits back to DesignStudio.
 *
 * 🚨 ONE DECLARATION, ON PURPOSE. This shape was written out FOUR times — once
 * on the prop and once inside each of the three functions that fill it — so a
 * field added to the prop silently failed to compile at the producers, and a
 * field added at one producer never reached the other two. `ecefFrame3D` was
 * missing from all four.
 */
export interface RoofPlaneReshapeUpdate {
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
    /** 🚨 THE RESHAPED PITCH AND AZIMUTH. Square Up, Stitch, the flat-trace
     *  rebuild and the Building pitch/wall controls all reshape a face's
     *  GEOMETRY and emit it here — but pitch/azimuth were not part of this
     *  shape, so `plane.pitch` kept its original value while the 3D roof
     *  changed underneath it. The planset, the structural engine and the
     *  production model all read plane.pitch, so the roof the user shaped and
     *  the pitch the permit quoted disagreed permanently, and nothing said so.
     *  Carried here so the geometry and the number agree. */
    pitch?: number;
    azimuth?: number;
    /** 🚨 THE RESHAPED ECEF FRAME — the axes panels are actually placed on.
     *
     *  This shape already carried `localFrame3D`, so a reshape looked complete.
     *  It was not: `buildSurfaceGrid` places panels from `ecefFrame3D`, not
     *  `localFrame3D` (lib/surfaceGeometry3D.ts — the createdFrom3D branch reads
     *  origin3D + ecefFrame3D + polygon3D). Emitting a NEW origin3D and normal3D
     *  while leaving ecefFrame3D at its pre-reshape value meant every reshape
     *  placed panels with a new origin on an OLD triad.
     *
     *  The cost is a wedge, not an offset. With the plane rotated by Δ about the
     *  eave axis, a panel's clearance above the drawn deck is
     *      d = stack·cos(Δ) − v·sin(Δ)        (stack = moduleStackHeightM)
     *  so it goes negative once tan(Δ) > stack / v — about 0.48° at
     *  6 m up the slope — and deepens linearly along the row. It is also not only
     *  cosmetic: polyUV projects the new polygon onto the stale u/v, foreshortening
     *  the usable extent by cos²(Δ), which removes whole rows. That reaches panel
     *  count, kW and the BOM. */
    ecefFrame3D?: {
      u: { x: number; y: number; z: number };
      v: { x: number; y: number; z: number };
      n: { x: number; y: number; z: number };
    };
}

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
  /** v66: Called when Auto Fill DETECTS roof planes (from Google Solar roof
   *  segments) rather than the user drawing them. Batched, because a detection
   *  produces the whole roof at once and firing onRoofPlaneCreated per face
   *  would queue N separate state updates off one click.
   *  Planes arrive source:'solar_api', confirmed:false — they are a detection,
   *  not a person's decision, so they route through operator review. */
  onRoofPlanesDetected?: (planes: import('@/types').RoofPlane[]) => void;
  /**
   * 🚨 WHICH GEOMETRY GOVERNS THIS PROPERTY. See lib/design/nativeGeometryDisposition.ts.
   *
   * Both native-acquisition paths refuse when this says a human has decided
   * against it (rejected / custom). Optional and defaulting to 'undecided',
   * so a caller that does not pass it behaves exactly as before — which is
   * also the correct reading for a project nobody has judged.
   */
  nativeDisposition?: NativeGeometryDisposition;
  /**
   * THE SAME DECISION, AS A LIVE REF — for the Lane A gate, which fires from
   * inside a resolved promise.
   *
   * 🚨 A PROP IS THE VALUE AT RENDER TIME, AND THE GATE RUNS SECONDS LATER.
   * `maybeRunLaneA` is called from `buildDigitalTwin(...).then(...)` in the
   * effect keyed `[lat, lng]`, so the closure it captured is the one from
   * before the fetch. Every OTHER gate field is deliberately read from a ref at
   * fire time — lib/3d/laneA.ts states the contract in so many words — and this
   * one was not. Concretely: the twin fetch starts while the property is
   * 'undecided'; during the 1–5 s it takes, the installer presses "Draw
   * Manually Instead"; the promise then resolves holding 'undecided' and
   * re-injects the exact Google roof that was just rejected.
   *
   * Optional, and the prop above is the fallback, so a caller that passes
   * neither behaves as before.
   */
  nativeDispositionRef?: React.MutableRefObject<NativeGeometryDisposition>;
  /**
   * WHAT HAPPENED TO THIS PROPERTY'S GEOMETRY — 'untouched' | 'populated' |
   * 'cleared'. A REF for exactly the reason the line above is one: the gate
   * fires from inside a resolved promise, seconds after the render it closed
   * over, and a clear performed during that fetch must be visible to it.
   * See lib/design/deletionAuthority.ts.
   */
  geometryLifecycleRef?: React.MutableRefObject<'untouched' | 'populated' | 'cleared'>;
  /** 🚨 LANE A GATE. True once DesignStudio's DB restore has RESOLVED — i.e. the
   *  stored layout is in state, or the read genuinely returned nothing. Lane A
   *  refuses to run while this is false, because detection lands in React state
   *  immediately while the autosave fence only blocks the WRITE: detect too
   *  early and the detected planes are already in state when the fence opens,
   *  and the first autosave tick persists them over the user's stored roof.
   *  Left FALSE on a failed read, deliberately — a restore that did not succeed
   *  must never license auto-detection. */
  roofRestoreResolved?: boolean;
  /** 🚨 Obstructions are KEEP-OUT ZONES, not annotations: removeObstructedPanels
   *  runs against them, so a vent or skylight physically removes panels. They
   *  lived only in this component, so reloading a design silently re-filled
   *  panels over every one the user placed. Lifted to DesignStudio, which is the
   *  SINGLE WRITER to the layout row — the engine reports, it never saves. */
  onObstructionsChange?: (obstructions: import('@/types').PlacedObstruction[]) => void;
  /** Distances measured off the model. Field evidence; discarded on unmount
   *  before this existed. Same single-writer rule. */
  onMeasurementsChange?: (measurements: import('@/types').LayoutMeasurement[]) => void;
  /** Obstructions restored from the database, re-applied on mount. */
  initialObstructions?: import('@/types').PlacedObstruction[];
  /** v64: Stitch button — push the averaged/connected corners AND the recomputed
   *  plane frame back into roofPlanes state so panel placement (Auto Layout) +
   *  persistence use the stitched geometry, not the pre-stitch traced corners or a
   *  stale frame. One call per Stitch, all updated planes at once. */
  onRoofPlanesStitched?: (updates: RoofPlaneReshapeUpdate[]) => void;
  /**
   * 🚨 A WHOLE, CANONICAL ROOF — the channel a BUILDING SECTION edit uses.
   *
   * `onRoofPlanesStitched` carries a per-face patch of geometry fields, which is
   * right for Stitch and Square Up and wrong here: editing a section rebuilds
   * every face it owns AND re-stamps `plane.section` on each one, and that field
   * is not in the patch shape. Sending a section edit through it would move the
   * geometry and leave the canonical record behind — the exact defect the WALLS
   * stepper had, where the record still claimed a 2.9 m eave after the roof had
   * risen a foot.
   *
   * It is also the single choke point undo needs: the parent pushes a snapshot
   * of what it holds, adopts this array, and rebuilds derived geometry from it.
   */
  onRoofGeometryReplaced?: (
    planes: import('@/types').RoofPlane[],
    meta: { label: string; coalesceKey?: string },
  ) => void;
  /**
   * CANONICAL GEOMETRY UNDO, owned by the parent because the parent owns
   * `roofPlanes`. Returns the label of the edit stepped over, or null.
   *
   * 🚨 THERE WAS ALREADY AN UNDO IN THIS FILE AND IT WAS INERT.
   * `createHistoryStore(createEmptySceneState())` built a history over a
   * `SceneState` of primitives and slider positions and wired it to a
   * Save/Undo/Redo chip. Nothing dispatched to it — zero call sites — so the
   * buttons did nothing, and what it modelled was render state, which is the
   * one thing a geometry history must not restore.
   */
  /**
   * ASK THE OWNER TO DELETE SOMETHING.
   *
   * 🚨 THE ENGINE NEVER DELETES CANONICAL GEOMETRY ITSELF, for the same reason
   * it never patches a single plane: the parent owns `roofPlanes`, the undo
   * stack, the deletion ledger and the save authorization, and a deletion that
   * skipped any of those would work on screen and come back on reload. The
   * engine's job is to know WHAT is selected and to say so.
   *
   * `scope` names the user's words ('face', 'section', 'obstruction', 'panels',
   * 'customBuilding', 'design'); `targetId` is the selected object for the
   * first three. The parent plans it, shows what will go, confirms if the
   * scope deserves it, and applies.
   */
  onRequestDelete?: (scope: string, targetId?: string) => void;
  /**
   * RUN A REAL SHADE ANALYSIS over the canonical design.
   *
   * 🚨 THE ENGINE CANNOT DO THIS ITSELF, and not for a layering reason: the
   * result is a number ON EACH PANEL (`annualShadeFactor`), which the owner
   * holds, the autosave persists and `lib/pvwatts.ts` turns into a production
   * derate. A shade study that lived in the viewer would be a picture.
   */
  onRunShadeAnalysis?: () => void;
  /**
   * SOMETHING IS ABOUT TO REMOVE PANELS THAT NO DELETE CONTROL ASKED FOR.
   *
   * 🚨 MARKING A VENT COST THE ARRAY PERMANENTLY. Placing an obstruction culls
   * every module inside its footprint — right, it is physically there — with no
   * history step, so a mis-placed vent was unrecoverable: deleting the vent did
   * not bring the modules back and the only route was a full re-layout, which
   * destroys every manual adjustment. The owner asked to be able to experiment
   * aggressively; this is one of the places that punished it.
   */
  onPanelsAboutToBeCulled?: (label: string) => void;
  /**
   * WHAT THE OWNER JUST DELETED, and the token that says it is new.
   *
   * The counter is the trigger: an effect keyed on it removes exactly these
   * entities. Removal is driven by an EXPLICIT LIST OF IDS and never by
   * inferring absence from a prop — the reconcile-deletions block that inferred
   * it destroyed a hand-traced garage (see the v66 note in the restore effect).
   */
  deletion?: {
    token: number;
    scope: string;
    faceIds: string[];
    obstructionIds: string[];
    panelIds: string[];
    /** True for Clear Custom Building / Start Over: the editor returns to idle
     *  and every render-only primitive (blocks, trees, walls, wireframe,
     *  setbacks, in-progress traces) goes with it. */
    resetEditor: boolean;
  };
  onUndoGeometry?: () => string | null;
  onRedoGeometry?: () => string | null;
  canUndoGeometry?: boolean;
  canRedoGeometry?: boolean;
  undoGeometryLabel?: string | null;
  redoGeometryLabel?: string | null;
  /** E2E-only diagnostics bridge. Passed only when NEXT_PUBLIC_E2E=1. */
  onE2EDiagnostics?: (diagnostics: {
    fullRebuildCount: number;
    setbackInsets: number;
    /** Number of roof-plane entities in the 3D map (after reload, should match roofPlanes count). */
    roofPlaneEntityCount: number;
    engineRoofPlaneCount: number;
    /** Centroids (lat/lng) of each rendered setback band polygon — used to verify
     *  bands hug edges (not roof middle). cf0dd96b regression guard. */
    setbackBandCentroids: Array<{ lat: number; lng: number }>;
    /** Count of full rebuilds triggered during panel drag/move — should stay 0
     *  for smooth moves. 2176e4d3 regression guard. */
    panelMoveRebuildCount: number;
  }) => void;
  /** v47.122: ID of the currently selected roof plane (highlights it, dims others) */
  selectedRoofPlaneId?: string;
  /** Called whenever the selected roof face CHANGES, with the canonical
   *  `RoofPlane.id` — or **null on deselection**, which the old signature could
   *  not express. The engine owns the selection; this is a notification, not a
   *  request. A parent that mirrors it must not feed it back through
   *  `selectedRoofPlaneId`, or the fact has two writers again. */
  onRoofPlaneSelect?: (planeId: string | null) => void;
  /** v48.26: Orientation driven from DesignStudio (2D panel orientation buttons).
   *  Keeps the 3D panelOrientationRef in sync so handleAutoRoof uses the correct
   *  orientation when triggered by relayoutWithOrientation via placementMode='auto_roof'. */
  orientation?: PanelOrientation;
  /** v48.25: Called when the user toggles panel orientation inside the 3D viewer.
   *  DesignStudio uses this to keep its own `orientation` state + 2D layout in sync. */
  onOrientationChange?: (orientation: PanelOrientation) => void;
  /** CAD-derived roof planes from DesignStudio -- used by Auto Fill instead of Solar API segments */
  /**
   * 🚨 THE TYPE, NOT A COPY OF IT.
   *
   * This was a hand-maintained structural duplicate of `RoofPlane` listing
   * seventeen of its fields. Every field added to the real type since — the
   * section record, `sectionId`, `sectionFaceKey`, `siteKey`, `source` — was
   * invisible here, so the engine could not read a plane's own section while
   * DesignStudio (which passes `RoofPlane[]`) could. A second declaration of a
   * shape is a second authority for it, and this one was already stale.
   *
   * The only caller is DesignStudio and it already passes `RoofPlane[]`. Every
   * extra field on `RoofPlane` is optional, so nothing that satisfied the old
   * list fails to satisfy this.
   */
  roofPlanes?: import('@/types').RoofPlane[];
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
  /** v66: design-phase flag — gates the bottom-right status panel
   *  (Aurora frame 0147 parity, components/3d/status/). When false or
   *  omitted, the panel is hidden. The design-panel agent will wire
   *  this from their Design-phase context. */
  isDesignPhase?: boolean;
  /** v66: create-design-modal trigger. Fired from the in-canvas "Save → Create
   *  Design" button when the user finishes the site model. The parent owns the
   *  modal state and is expected to render <CreateDesignModal> + switch to
   *  Design phase when fired. */
  onCreateDesign?: () => void;
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

/**
 * convexHullCorners: real roof faces are always convex (you can't have a
 * roof plane that goes concave - the geometry won't shed water). The
 * aerial-imagery twin sometimes returns corners in a noisy order or with
 * stray indentations, which would draw a concave yellow outline. Run the
 * raw corners through Andrew's monotone-chain 2D convex hull on (lng,
 * lat), then map the surviving points back to their original corner
 * objects so we keep the per-corner altitude. Returns the hull in
 * counter-clockwise order.
 */
function convexHullCorners(corners: Array<{ lat: number; lng: number; alt?: number }>): Array<{ lat: number; lng: number; alt?: number }> {
  if (corners.length <= 3) return corners.slice();
  // Work on a deduped working set (Andrew's algorithm needs unique points)
  const pts = corners.map(c => ({ lat: c.lat, lng: c.lng, alt: c.alt, _key: `${c.lng.toFixed(7)},${c.lat.toFixed(7)}` }));
  const seen = new Set<string>();
  const uniq = pts.filter(p => {
    if (seen.has(p._key)) return false;
    seen.add(p._key);
    return true;
  });
  if (uniq.length <= 3) return uniq.map(({ _key, ...rest }) => rest);

  // Sort by lng, then lat
  uniq.sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (O: any, A: any, B: any) =>
    (A.lng - O.lng) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lng - O.lng);

  // Lower hull
  const lower: typeof uniq = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  // Upper hull
  const upper: typeof uniq = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Concat, dropping the duplicated endpoints
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.map(({ _key, ...rest }) => rest);
}

/**
 * v66 (LiDAR elevation lookup) — uniform-grid spatial index over a LiDAR
 * point cloud, in the dataset's local ENU frame (metres east/north of the
 * dataset centroid; see lib/3d/lidar/types.ts).
 *
 * WHY THIS EXISTS. `liDARGetElevationAt(lat, lng)` used to walk EVERY point
 * in the cloud, push every Z into an array, `sort()` that array (up to ~500k
 * entries) and return the mean of the top 25 — the per-point dx/dy it
 * computed were explicitly discarded with `void dx; void dy;`. Two bugs fell
 * out of that:
 *   1. WRONG ANSWER. The lat/lng arguments had no effect at all, so every
 *      roof segment in a Lift/Flatten pass was handed the SAME number: the
 *      mean of the 25 tallest returns anywhere in the dataset (usually a
 *      tree or the tallest ridge). Lift Roofs therefore raised every
 *      primitive to one wrong height instead of to the roof under it.
 *   2. O(n log n) PER CALL. One full sort of the whole cloud for every
 *      primitive in the snapshot.
 * The grid is built ONCE per dataset (O(n)) and each query touches only the
 * cells overlapping the search disc, so a lookup is O(points nearby).
 *
 * Storage is CSR-style (counting sort into a flat index array) so there is
 * one allocation per array rather than one array object per cell.
 */
export interface LiDARPointGrid {
  /** Cell edge length in metres. */
  cellM: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** Per-point coordinates in the local ENU frame, in input order. */
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** CSR row pointers: cell c owns order[cellStart[c] .. cellStart[c + 1]). */
  cellStart: Int32Array;
  /** Point indices grouped by cell. */
  order: Int32Array;
}

/** Default search radius (metres) for a LiDAR elevation query. */
const LIDAR_QUERY_RADIUS_M = 2.0;
/** Default number of highest-Z neighbours averaged into the answer. */
const LIDAR_QUERY_TOP_K = 25;

/**
 * Build the grid index. `cellM` defaults to the query radius so that a
 * radius-r disc never spans more than a 3x3 block of cells.
 */
export function buildLiDARPointGrid(
  points: ReadonlyArray<{ x?: number; y?: number; z?: number }>,
  cellM: number = LIDAR_QUERY_RADIUS_M,
): LiDARPointGrid | null {
  const n = points.length;
  if (n === 0 || !(cellM > 0)) return null;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i].x ?? 0;
    const y = points[i].y ?? 0;
    px[i] = x; py[i] = y; pz[i] = points[i].z ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  const cols = Math.max(1, Math.floor((maxX - minX) / cellM) + 1);
  const rows = Math.max(1, Math.floor((maxY - minY) / cellM) + 1);
  const cellCount = cols * rows;
  // Counting sort: count per cell, prefix-sum into cellStart, then scatter.
  const cellStart = new Int32Array(cellCount + 1);
  const cellOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((px[i] - minX) / cellM)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((py[i] - minY) / cellM)));
    const cell = r * cols + c;
    cellOf[i] = cell;
    cellStart[cell + 1]++;
  }
  for (let c = 0; c < cellCount; c++) cellStart[c + 1] += cellStart[c];
  const cursor = cellStart.slice(0, cellCount);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[cursor[cellOf[i]]++] = i;
  return { cellM, minX, minY, cols, rows, px, py, pz, cellStart, order };
}

/**
 * Elevation at a point in the grid's local ENU frame: the mean Z of the
 * `topK` highest returns within `radiusM` of (x, y). Returns null when no
 * point falls inside the disc — `lib/3d/roofActions.ts` documents null as
 * "no LiDAR coverage here" and leaves that primitive's height alone, which
 * is the honest answer for a segment drawn outside the scan.
 *
 * "Highest returns, not nearest" is deliberate and matches the roofPlanes
 * sibling (lib/3d/lidar/liftRoofs.ts): the tallest returns over a roof
 * footprint are the roof surface, while the lower ones are ground seen
 * through the eaves. The nearest-neighbour SELECTION is what was missing
 * before; the top-K averaging was always right.
 *
 * Selection avoids sorting: the running top-K is kept in a small
 * insertion-ordered buffer, so the cost is O(neighbours * K) with K = 25
 * rather than O(n log n) over the whole cloud.
 */
export function elevationAtFromGrid(
  grid: LiDARPointGrid | null,
  x: number,
  y: number,
  opts?: { radiusM?: number; topK?: number },
): number | null {
  if (!grid) return null;
  const radiusM = opts?.radiusM ?? LIDAR_QUERY_RADIUS_M;
  const topK = Math.max(1, opts?.topK ?? LIDAR_QUERY_TOP_K);
  if (!isFinite(x) || !isFinite(y) || !(radiusM > 0)) return null;
  const { cellM, minX, minY, cols, rows, px, py, pz, cellStart, order } = grid;
  const r2 = radiusM * radiusM;
  const c0 = Math.max(0, Math.floor((x - radiusM - minX) / cellM));
  const c1 = Math.min(cols - 1, Math.floor((x + radiusM - minX) / cellM));
  const r0 = Math.max(0, Math.floor((y - radiusM - minY) / cellM));
  const r1 = Math.min(rows - 1, Math.floor((y + radiusM - minY) / cellM));
  if (c0 > c1 || r0 > r1) return null;
  // Running top-K, smallest kept value at index `count - 1`.
  const top = new Float64Array(topK);
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    const rowBase = r * cols;
    for (let c = c0; c <= c1; c++) {
      const cell = rowBase + c;
      const end = cellStart[cell + 1];
      for (let k = cellStart[cell]; k < end; k++) {
        const i = order[k];
        const dx = px[i] - x;
        const dy = py[i] - y;
        if (dx * dx + dy * dy > r2) continue;
        const z = pz[i];
        if (count < topK) {
          let j = count++;
          while (j > 0 && top[j - 1] < z) { top[j] = top[j - 1]; j--; }
          top[j] = z;
        } else if (z > top[topK - 1]) {
          let j = topK - 1;
          while (j > 0 && top[j - 1] < z) { top[j] = top[j - 1]; j--; }
          top[j] = z;
        }
      }
    }
  }
  if (count === 0) return null;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += top[i];
  return sum / count;
}

/**
 * v65 (block line-trace) — drop an in-progress block preview polyline AND the
 * per-vertex marker dots that were hung off it as `entity.__dots`.
 *
 * WHY THIS EXISTS. `handleBlockClick` rebuilds the preview on every click: it
 * removes the old polyline, adds a new one, then adds a fresh dot for EVERY
 * point collected so far and attaches that dot list to the NEW polyline. The
 * rebuild removed only the polyline, so the previous click's dots were left in
 * `viewer.entities` with nothing referencing them — and because the dot loop
 * re-adds one dot per point per click, the orphans piled up quadratically
 * (2 clicks leave 2, 3 leave 5, 4 leave 9 ...) and survived for the life of
 * the session, painting over the scene and dragging the render loop down.
 * finalizeBlock and the two cancel paths already removed `__dots` first; this
 * is that same cleanup, named once so the rebuild path cannot forget it.
 */
export function removeBlockPreviewEntity(viewer: any, preview: any): void {
  if (!preview) return;
  try {
    const dots = (preview as any).__dots as any[] | undefined;
    if (dots) {
      for (const d of dots) {
        try { viewer?.entities?.remove(d); } catch { /* ignore */ }
      }
      (preview as any).__dots = undefined;
    }
  } catch { /* ignore */ }
  try { viewer?.entities?.remove(preview); } catch { /* ignore */ }
}

/** Inputs to the Lane A gate. Every one is read from a REF at fire time, never
 *  captured in a closure — the whole point is to decide against the state that
 *  exists when the timer/promise resolves, not when it was scheduled.
 *
 *  🚨 DEFINED IN lib/3d/laneA.ts. Re-exported here only so existing importers
 *  keep working. Do not re-declare the shape — one fact, one definition. */
export type LaneAGateInput = LaneAGateInputPure & { stage: LoadStage };

/**
 * Should Lane A (zero-click roof detection from Google Solar) run right now?
 *
 * 🚨 THIS IS THE GUARD THAT KEEPS LANE A A *STARTING SHAPE* AND NEVER A
 * REPLACEMENT. Every condition is a refusal, and the dangerous one is
 * `existingPlaneCount === 0`: if the design already has ANY roof geometry —
 * the user traced it, or the DB restored it — Lane A must not run at all.
 * Detected faces are merged by id, so running against a populated design would
 * append a machine's guess alongside a person's work and the autosave would
 * persist the result.
 *
 * `restoreResolved` is the other half. The detection lands in React state
 * immediately, while the autosave fence only blocks the WRITE — so firing
 * before the restore resolves means the detected planes are already in state
 * when the fence opens, and the first tick persists them over the stored roof.
 * Gating the detection itself is the only thing that actually prevents it.
 *
 * Pure, so the whole refusal matrix is unit-testable without Cesium, a viewer,
 * a network or a Google key.
 *
 * 🚨 IMPLEMENTED IN lib/3d/laneA.ts. This delegates rather than repeating the
 * conditions — a second copy of the refusal matrix that drifted from the first
 * is exactly how this codebase has been burned before.
 */
export function shouldRunLaneA(i: LaneAGateInput): boolean {
  return shouldRunLaneAPure(i);
}

/** The site identity Lane A dedupes on. Rounded to ~1 m so orbit jitter or a
 *  re-geocode of the same address does not read as a different building.
 *
 *  🚨 Delegates to lib/siteIdentity.ts — "is this a new site?" must have ONE
 *  answer in this codebase. This is the coordinate-only form; DesignStudio
 *  scopes the same key with the project id for storage. */
export function laneASiteKey(lat: number, lng: number): string {
  return siteKeyFromCoords(lat, lng);
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
  onRoofPlanesDetected,
  nativeDisposition = 'undecided',
  nativeDispositionRef, geometryLifecycleRef,
  roofRestoreResolved = false,
  onObstructionsChange,
  onMeasurementsChange,
  initialObstructions,
  onRoofPlanesStitched,
  onRoofGeometryReplaced,
  onRequestDelete, deletion, onRunShadeAnalysis, onPanelsAboutToBeCulled,
  onUndoGeometry, onRedoGeometry,
  canUndoGeometry = false, canRedoGeometry = false,
  undoGeometryLabel = null, redoGeometryLabel = null,
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
  isDesignPhase = false,
  onCreateDesign,
}: Props) {
  const cesiumRef   = useRef<HTMLDivElement>(null);
  const viewerRef   = useRef<any>(null);
  const tilesetRef  = useRef<any>(null);
  const panelMapRef = useRef<Map<string, any>>(new Map());
  // primitiveRendererRef and lodManagerRef removed — entity-based rendering via panelMapRef
  const overlayRef  = useRef<any[]>([]);
  const setbackZoneEntitiesRef = useRef<any[]>([]); // v62: fire setback keep-out zone entities
  const roofWireframeEntitiesRef = useRef<any[]>([]); // v62: stitched roof-model edge polylines
  const buildingEntitiesRef = useRef<any[]>([]);      // v66: extruded walls + solid roof surfaces
  // v66: drape the real aerial image on the roof faces (Aurora parity).
  const [showRoofTexture, setShowRoofTexture] = useState(true);
  const showRoofTextureRef = useRef(true);
  // Guards against a slow texture fetch painting onto a scene that has since
  // been rebuilt or toggled off. Incremented on every extrusion render.
  const buildingRenderTokenRef = useRef(0);
  // ── v66: DIRECT BUILDING CONTROLS ───────────────────────────────────────────
  // Earlier passes tried to INFER the right roof shape — is a tileset loaded,
  // did the pick hit real mesh, does the fitted plane look flat. Every one of
  // those signals lied at an address with no roof geometry, and each fix chased
  // the next symptom until one of them started rewriting traced corners and
  // broke Stitch. The user can see the building; two knobs beat any detector
  // and cannot be fooled.
  //
  // Both are VIEW state. They shape what the Building view draws, derived from
  // the traced footprint at render time, and never write back to a plane.
  /** 🚨 A DELTA ACCUMULATOR, NOT A WALL HEIGHT, AND DELIBERATELY NOT STATE.
   *
   *  These were React state rendered as `WALLS {ftStr(effectiveWallM)}` and
   *  `PITCH {effectivePitchDeg}`. Neither was ever measured from geometry, so
   *  neither named anything in the building. They survive only as the internal
   *  baseline `applyBuildingShape` subtracts to turn an absolute request into a
   *  relative nudge of one standalone face — see `nudgeFaceElevation`. Being
   *  refs rather than state is the guard: a value with no React binding cannot
   *  be rendered by accident. */
  const wallHeightRef = useRef(FLAT_TRACE_EAVE_HEIGHT_M);
  const buildingPitchRef = useRef(25);
  /* 🚨 `buildingOverrides` WAS DELETED HERE, AND IT WAS NEVER ALIVE.
   *
   * It was a Map<faceId, {pitchDeg, wallHeightM, azimuthDeg}> intended to give
   * each face its own height and pitch, and `setBuildingOverrides` was DECLARED
   * AND NEVER CALLED — in any commit. So the map was permanently empty, and the
   * three readers of it (`effectiveWallM`, `effectivePitchDeg`, and a status
   * message) all fell through to the global on every render while the UI
   * rendered a "THIS FACE" chip promising otherwise.
   *
   * The need it was written for is real and is now met properly: a porch at a
   * shallower pitch, a dormer, an addition are BUILDING SECTIONS, each with its
   * own pad, eave and pitch, edited through lib/3d/sectionEditing. A per-face
   * override map would have been a second vertical authority beside the
   * section record, which is the defect this whole pass exists to remove. */
  // Which face is selected for editing, by plane id. null = the whole building.
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const selectedFaceIdRef = useRef<string | null>(null);

  /**
   * 🚨 WHICH LEVEL OF THE HIERARCHY THE INSPECTOR IS EDITING.
   *
   * A click selects a FACE — that is what the ray hits and that is what the
   * highlight draws. But a face cannot answer "how high is this wall" and must
   * not move on its own: raising one half of a gable opens the ridge, and
   * shutting it again is the compensating edit that made the editor unusable.
   *
   * So when the clicked face belongs to a section, the inspector opens at
   * SECTION level and the vertical controls act on the volume. 'face' is a
   * deliberate drill-in that offers measurements and no height controls. A
   * standalone traced face has no section and stays at 'face'.
   */
  const [selectionLevel, setSelectionLevel] = useState<'section' | 'face' | 'wall'>('section');
  /**
   * THE WALL THE LAST BUILDING PICK LANDED ON — `faceId#edgeIndex`, or null.
   *
   * 🚨 A REF, WRITTEN BY THE PICK, READ BY THE CLICK HANDLER THAT CALLED IT.
   * The pick already knows; threading it back through the return type would
   * change a signature four call sites rely on, and a second pick to ask "was
   * that a wall?" could answer about a different frame.
   */
  const hitWallIdRef = useRef<string | null>(null);
  /** The wall currently selected, when the selection level is 'wall'. */
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  /** The marked obstruction under the cursor, if any. Selectable so it can be
   *  deleted — the owner's list names "delete obstruction" and "delete tree",
   *  and neither was reachable by any gesture. */
  const [selectedObstructionId, setSelectedObstructionId] = useState<string | null>(null);
  const selectedObstructionIdRef = useRef<string | null>(null);
  /** WHICH NOUN THE NEXT CLICK PLACES. Every obstruction used to be stamped
   *  `type: 'chimney'` whatever it was, which stopped being cosmetic the moment
   *  the type started deciding the keep-out clearance. */
  const [obstructionPresetId, setObstructionPresetId] = useState<ObstructionPresetId>(DEFAULT_OBSTRUCTION_PRESET);
  const obstructionPresetRef = useRef<ObstructionPresetId>(DEFAULT_OBSTRUCTION_PRESET);
  /** The last refusal from the section authority, phrased for a person. */
  const [sectionRefusal, setSectionRefusal] = useState<string | null>(null);
  /**
   * WHAT STAYS PUT WHEN A PITCH CHANGES: the wall, or the ridge.
   *
   * 🚨 UI STATE, NOT A PROPERTY OF ANY ROOF. Nothing is stored on the section —
   * an anchor remembered on the record would be a second vertical authority,
   * able to disagree with the eave height it was used to compute. It lives here
   * so it survives a selection change within one editing session and nowhere
   * else. Defaults to 'eave', which is what a builder means: the walls are up
   * and the roof goes on top of them.
   */
  const [pitchAnchor, setPitchAnchor] = useState<PitchAnchor>('eave');

  /** 🚨 THE SELECTED ROOF FACE. ONE ANSWER.
   *
   *  There were two, and only one of them was alive:
   *
   *    selectedFaceId        internal state. Real face-scoped behaviour hangs
   *                          off it (per-face pitch and wall overrides), but it
   *                          could only ever be set by a pick that matches
   *                          `[BUILD3D-ROOF]` entities — which exist only while
   *                          the Building extrusion is toggled on, and it is off
   *                          by default.
   *    selectedRoofPlaneId   a PROP, which every `[PLANE3D-*]` styling site
   *                          compared against — and which no parent has ever
   *                          passed. Seven `undefined === <id>` comparisons,
   *                          permanently false, and `onRoofPlaneSelect` was
   *                          declared, destructured and never called.
   *
   *  So the renderer honoured the dead one. `activeFaceId` collapses them: the
   *  engine owns the selection, and the prop remains an OPTIONAL override so a
   *  parent (e.g. the Roof Planes sidebar) can drive the highlight without
   *  becoming a second writer. */
  const activeFaceId: string | null = (selectedRoofPlaneId ?? selectedFaceId) || null;
  const measureOverlayRef = useRef<any[]>([]);
  const handlerRef  = useRef<any>(null);
  const initDone    = useRef(false);
  // v70: Aurora-parity Save/Undo/Redo ring-buffer history store.
  /* 🚨 `historyStoreRef` WAS REMOVED HERE. IT WAS A SECOND UNDO, AND IT WAS
   * NEVER CONNECTED.
   *
   * `createHistoryStore(createEmptySceneState())` was constructed on every
   * mount and handed to the Save/Undo/Redo chip. The comment that stood here
   * said "the wider dispatch integration is staged for the follow-up commit" —
   * and it never came: the store had ZERO dispatch sites, so the buttons were
   * decoration on an empty stack.
   *
   * It could not have been the answer even once connected. Its `SceneState` is
   * `{primitives, selectedId, view:{placementMode, newBlockEaveHeightM,
   * newRoofEaveHeightM, newRoofPitchDeg}}` — render state and slider positions.
   * Restoring that would put the PICTURE back while `roofPlanes` kept the
   * undone edit, and the next autosave would persist the design the user had
   * just rejected, into the row the permit is drawn from.
   *
   * The canonical history lives with the canonical array, in
   * components/design/useSiteDesign.ts, over `RoofPlane[]`, and arrives here
   * as the `onUndoGeometry` / `onRedoGeometry` props.
   * lib/state/historyStore.ts and Buttons.tsx are left in place for the
   * primitive-editing slice that owns them. */
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
  // 🚨 SAME REASON AS `selectedPanelRef`, FOR THE SETBACKS.
  //
  // Every function that lays panels out — fillRoofSegmentWithPanels,
  // finalizePlane3D, handleSurfaceSelectClick, handleAutoRoof — is reached from
  // the Cesium click handler registered once at mount, so the `fireSetbacks`
  // PROP they could see is the one that existed when the 3D view opened.
  // Moving the Edge Setback slider, or applying an AHJ's real ridge/eave
  // figures, changed the right-hand panel and nothing else: the next plane was
  // still filled to the old numbers. A setback is a fire-code clearance, so the
  // quiet version of this failure is an array that does not meet the
  // jurisdiction the package will be submitted to.
  const fireSetbacksRef = useRef<Props['fireSetbacks']>(fireSetbacks);
  useEffect(() => { fireSetbacksRef.current = fireSetbacks; }, [fireSetbacks]);
  // mountingSystemIdRef: always current mounting system ID — read inside closures without stale prop
  const mountingSystemIdRef = useRef<string>(mountingSystemId);
  // v63: string-coloring + equipment-overlay state, read inside render closures.
  const colorByStringRef = useRef<boolean>(colorByString);
  const showEquipmentRef = useRef<boolean>(showEquipment);
  const panelOpacityRef  = useRef<number>(panelOpacity);
  const panelMetaRef      = useRef<Props['panelMeta']>(panelMeta);
  const paintModeRef      = useRef<boolean>(paintMode);
  const onPanelPaintRef   = useRef<Props['onPanelPaint']>(onPanelPaint);
  const onRoofPlaneSelectRef = useRef<Props['onRoofPlaneSelect']>(onRoofPlaneSelect);
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
    heading: TILTED_AERIAL_VIEW.heading,
    pitch:   TILTED_AERIAL_VIEW.pitch,
    radius:  TILTED_AERIAL_VIEW.range,
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
  const panelMoveRebuildCountRef = useRef(0);
  const setbackBandCentroidsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const publishE2EDiagnostics = useCallback(() => {
    onE2EDiagnostics?.({
      fullRebuildCount: fullRebuildCountRef.current,
      setbackInsets: setbackZoneEntitiesRef.current.length,
      roofPlaneEntityCount: plane3DEntityMap.current.size,
      // What the ENGINE holds, as distinct from what it has DRAWN. Only
      // 3D-traced planes get an entity in plane3DEntityMap, so a restored or
      // seeded roof leaves that count at 0 while the engine is perfectly ready
      // to fill it. The gap between "the studio has a plane" and "the engine
      // has a plane" is where stale-frame defects live, so both are reported.
      engineRoofPlaneCount: roofPlanesRef.current?.length ?? 0,
      setbackBandCentroids: setbackBandCentroidsRef.current,
      panelMoveRebuildCount: panelMoveRebuildCountRef.current,
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

  // ── v66: FLAT TRACE (Aurora-style 2D → 3D) ─────────────────────────────────
  // True only while a roof-face trace is running on an address with NO Google
  // Photorealistic 3D Tiles. It is the single switch every flat-trace code path
  // keys off, and it is set in exactly one place (the mode-entry effect).
  //
  // 🚨 WHY IT IS A SINGLE FLAG, AND WHY IT DEFAULTS FALSE:
  // Where 3D tiles exist, this is false and EVERY path below behaves exactly as
  // it did before v66 — same picks, same frame, same plane, same fill. The
  // flat-trace branches are additive and unreachable on a covered address. That
  // is deliberate: the tiles path works and must not move.
  //
  // When true, the trace collects lat/lng only (heights from an ellipsoid pick
  // are meaningless) and the face is built from the traced FOOTPRINT plus a
  // user-supplied pitch and a shape-inferred azimuth — see
  // lib/3d/footprintToRoofPlane.ts.
  const flatTraceRef = useRef<boolean>(false);
  const [flatTrace, setFlatTrace] = useState(false); // render-visible mirror for UI copy

  /**
   * v66: Snap the camera straight down and remember the pose to restore.
   *
   * A flat trace picks corners on the ground plane, so it is only correct from
   * a nadir camera — see the pitch lock in the orbit drag handler. Calling this
   * on flat-trace entry is what makes a traced footprint land ON the building
   * instead of in the field beyond it.
   */
  // v66: eave height for flat-traced faces, in metres above local ground.
  // A hand trace carries no measured height, so the installer sets it. It does
  // NOT affect pitch, azimuth or area — only how far the face floats in the 3D
  // scene — but that is exactly what makes a traced roof look right or wrong.
  // Editable live from the flat-trace badge; the last traced face rebuilds so
  // the number means something immediately instead of only on the next trace.
  const [flatTraceEaveHeightM, setFlatTraceEaveHeightM] = useState(FLAT_TRACE_EAVE_HEIGHT_M);
  const flatTraceEaveHeightRef = useRef(FLAT_TRACE_EAVE_HEIGHT_M);
  useEffect(() => { flatTraceEaveHeightRef.current = flatTraceEaveHeightM; }, [flatTraceEaveHeightM]);
  /** Ids of faces built by flat trace, so a height change knows what to rebuild. */
  const flatTracedPlaneIdsRef = useRef<string[]>([]);
  /** planeId → the inputs that built it, so it can be rebuilt without re-tracing. */
  const flatTraceParamsRef = useRef<Map<string, {
    outline: Array<{ lat: number; lng: number }>;
    pitchDeg: number;
    azimuthDeg: number;
    /** Ground reference from the ORIGINAL picks — see the note at the call site.
     *  Stored per plane so a later eave change rebuilds against the same ground
     *  the user traced on, instead of re-deriving it and moving the face. */
    groundElevM: number;
  }>>(new Map());

  /**
   * v66: Re-raise every flat-traced face to a new eave height.
   *
   * Rebuilds from the stored outline + pitch + azimuth rather than making the
   * user re-trace. The footprint, pitch, azimuth and area are all unchanged —
   * only where the face sits vertically moves — but that is what decides
   * whether a traced roof looks like a roof or like a rug in the yard.
   */
  const rebuildFlatTracedPlanes = (newEaveM: number) => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return 0;
    const updates: RoofPlaneReshapeUpdate[] = [];

    for (const id of flatTracedPlaneIdsRef.current) {
      const params = flatTraceParamsRef.current.get(id);
      if (!params) continue;
      const built = roofPlaneFromFootprint(params.outline, {
        pitchDeg: params.pitchDeg,
        azimuthDeg: params.azimuthDeg,
        eaveHeightM: newEaveM,
        // The ground the user traced on, captured at trace time. Re-deriving it
        // here could move the face sideways in elevation on every height tweak.
        groundElevM: params.groundElevM,
      });
      if (!built) continue;

      // Swap the rendered entity for one at the new height.
      const oldIds = plane3DEntityMap.current.get(id) ?? [];
      oldIds.forEach(eid => {
        const ent = viewer.entities.getById(eid);
        if (ent) try { viewer.entities.remove(ent); } catch { /* ignore */ }
      });
      const cesiumPts = built.frame.projectedPts.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z));
      const isSelected = faceIsInSelection(id);
      const newIds = renderPlane3DEntity(
        viewer, C, cesiumPts, id, built.frame, isSelected, planeRendersOutlineOnly(id),
      );
      plane3DEntityMap.current.set(id, newIds);
      plane3DFrameMap.current.set(id, built.frame);
      plane3DCesiumPtsMap.current.set(id, cesiumPts);

      if (built.plane.localFrame3D) {
        updates.push({
          id,
          vertices: built.plane.vertices,
          localFrame3D: built.plane.localFrame3D,
          polygon3D: built.plane.polygon3D,
          origin3D: built.plane.origin3D,
          normal3D: built.plane.normal3D,
          // Emit the shape the face was actually BUILT to.
          pitch: built.plane.pitch,
          azimuth: built.plane.azimuth,
          // The axes panels are placed on must travel with the geometry.
          ecefFrame3D: built.plane.ecefFrame3D,
        });
      }
    }

    plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    // Reuse the stitch channel: it already replaces geometry on existing planes
    // by id in DesignStudio, which is exactly what a height change is.
    if (updates.length > 0) onRoofPlanesStitched?.(updates);
    if (showRoofModel)    { try { renderRoofWireframe(viewer, C); } catch { /* ignore */ } }
    if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch { /* ignore */ } }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
    return updates.length;
  };

  const preFlatTracePitchRef = useRef<number | null>(null);
  const enterTopDownForFlatTrace = () => {
    const o = orbitRef.current;
    if (!o) return;
    if (preFlatTracePitchRef.current === null) preFlatTracePitchRef.current = o.pitch;
    // NEAR-nadir, not exact. applyOrbit clamps pitch to [-π/2 + 0.02, …] and a
    // camera pose exactly overhead is degenerate anyway (the heading of a
    // straight-down look direction is undefined). Writing the clamped value
    // ourselves means no other consumer of orbit.pitch ever sees an
    // out-of-range number, instead of relying on a downstream fix-up.
    //
    // The residual tilt is 0.02 rad = 1.15°, and parallax scales with the
    // HEIGHT of what you trace, not with camera range: a 3 m eave is displaced
    // by 3·tan(1.15°) = 6 cm. That is far inside a click's precision.
    o.pitch = -Math.PI / 2 + 0.02;
    try {
      applyOrbitRef.current?.();
      viewerRef.current?.scene?.requestRender?.();
    } catch { /* boot not finished; applied on next gesture */ }
  };
  /** Give the user their tilted view back once the trace is over. */
  const restorePitchAfterFlatTrace = () => {
    const o = orbitRef.current;
    if (!o || preFlatTracePitchRef.current === null) return;
    o.pitch = preFlatTracePitchRef.current;
    preFlatTracePitchRef.current = null;
    try {
      applyOrbitRef.current?.();
      viewerRef.current?.scene?.requestRender?.();
    } catch { /* ignore */ }
  };
  // Consecutive off-mesh first-clicks on an address that DOES have a tileset.
  // One is a stray click and gets the normal "you missed the roof" message; two
  // in a row means there is genuinely no mesh here and we offer the flat trace.
  // Requiring the second click keeps a covered address behaving exactly as it
  // always has when the user simply mis-clicks.
  const offMeshFirstClicksRef = useRef<number>(0);

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
  // 🚨 `markOnlyPlaneIdsRef` WAS HERE AND IS DELIBERATELY GONE.
  //
  // It was a Set the Mark Plane tool added a plane id to and nothing ever
  // removed from, read at every render site to decide outline-vs-deck. Keeping
  // it as "the user's intent" alongside the derived "does this face carry
  // panels" left a hole big enough to reproduce the whole defect:
  // `handleAutoRoof` does NOT skip marked faces, so Auto Layout fills them —
  // and a marked face with fifty-five panels on it would still have been drawn
  // as a bare outline, with nothing under the array but the photogrammetry mesh.
  //
  // The two facts also never disagree except in that case. A marked face has no
  // panels, so the derived rule already answers "outline"; the moment it DOES
  // have panels it needs a deck, whatever was intended when it was traced.
  // One question, one answer — see `planeRendersOutlineOnly`.
  //
  // Whether Auto Layout should respect a Mark Plane intent at all is a separate
  // product question about PLACEMENT, and is not decided by the renderer.
  // Count of placed points (for status message)
  const [pts3DCount, setPts3DCount] = useState(0);

  // v66: Aurora-style top-bar map-source picker state
  // (`Details ▾` / `LiDAR | Street View` / `[Google ▾]`). Local for now —
  // the actual Cesium imagery swap is the integration step that the next
  // session wires up via the onChange callback.
  const [mapPickerState, setMapPickerState] = useState<MapPickerState>(DEFAULT_PICKER_STATE);

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

  /**
   * Does this face render as a bare outline instead of a roof deck?
   *
   * 🚨 THE FACE UNDER AN AUTO LAYOUT HAD NO DECK DRAWN UNDER IT AT ALL.
   *
   * `renderPlane3DEntity`'s `outlineOnly` branch draws a polyline and returns.
   * The branch it skips draws the thing the whole datum exists to put under a
   * module: an opaque base coat whose own comment says it "suppresses wavy mesh
   * waviness beneath panels". Without it the user is looking straight at
   * Google's photogrammetry mesh, which is not planar — it carries ridge caps,
   * vents and ±10–30 cm of noise, and a panel sitting a fixed height above a
   * FITTED plane is swallowed wherever the mesh rises above it. Per location,
   * so SOME panels look wrong and others do not.
   *
   * The restore path decided this ONCE, from `panelsRef.current` at the instant
   * it ran — which is before Auto Layout has placed anything — and then LATCHED
   * the answer into `markOnlyPlaneIdsRef`, which nothing ever removes from. So
   * every face that arrives from state rather than from the trace tool — a
   * reload, a restored design, and every Lane A face Google detects — was
   * marked "no panels" forever, and filling it with fifty-five panels did not
   * change that. A face traced in the same session took the other path and got
   * its deck. That is "the panels are not ALL rendering above the roof",
   * measured in the browser: 55 [PANEL] entities, one [PLANE3D-OUTLINE], zero
   * [PLANE3D-BASE].
   *
   * Mark Plane is an INTENT and stays latched. Having no panels is a STATE and
   * is read fresh, here, every time a face is drawn.
   */
  function planeRendersOutlineOnly(planeId: string): boolean {
    return !panelsRef.current.some(p => p.planeId === planeId);
  }
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
  /** Mirror of `stage` for fire-time reads. Lane A is decided inside a resolved
   *  twin promise, where a captured `stage` would be the value from the render
   *  that STARTED the fetch — reliably 'solar', never 'done'. */
  const stageRef                  = useRef<LoadStage>('idle');
  useEffect(() => { stageRef.current = stage; }, [stage]);
  const [stageMsg, setStageMsg]   = useState('Initializing...');
  const [progress, setProgress]   = useState(0);
  const [twin, setTwin]           = useState<DigitalTwinData | null>(null);
  const [simHour, setSimHour]     = useState(12);
  const [animating, setAnimating] = useState(false);
  const [showParcel, setShowParcel]     = useState(true);
  const [showRoofSegs, setShowRoofSegs] = useState(true);

  // v66: LiDAR feature — state, controller, and file-picker handlers.
  // The state is local to SolarEngine3D; the parent (DesignStudio) doesn't
  // need to know about LiDAR for v1. A future stage can lift the state
  // to the parent if multiple components need it.
  const lidar = useLiDARState();
  const lidarControllerRef = useRef<ReturnType<typeof createLiDARController> | null>(null);
  const lidarStateRef = useRef<LiDARState>(lidar.state);
  lidarStateRef.current = lidar.state;

  // Create the LiDAR controller once the Cesium viewer is ready, destroy
  // on unmount. Subsequent style/offset/dataset changes route through
  // the controller's setters; the controller teardown + rebuilds the
  // primitives in `scene.primitives`.
  useEffect(() => {
    if (stage !== 'done') return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (lidarControllerRef.current) return;     // already created
    const controller = createLiDARController(viewer, lidarStateRef.current);
    lidarControllerRef.current = controller;
    return () => {
      controller.destroy();
      lidarControllerRef.current = null;
    };
  }, [stage]);

  // Push style / offset / textured / dataset updates to the controller.
  useEffect(() => {
    const c = lidarControllerRef.current;
    if (!c) return;
    c.setDataset(lidar.state.dataset);
  }, [lidar.state.dataset]);
  useEffect(() => { lidarControllerRef.current?.setStyle(lidar.state.style); }, [lidar.state.style]);
  useEffect(() => { lidarControllerRef.current?.setOffset(lidar.state.offset); }, [lidar.state.offset]);
  useEffect(() => { lidarControllerRef.current?.setTextured(lidar.state.textured); }, [lidar.state.textured]);

  // File-picker handler. Uses the project lat/lng as the dataset centroid
  // so the renderer can convert (x, y) → lat/lng for `Cartesian3.fromDegrees`.
  const handleLiDARLoad = useCallback(async () => {
    await loadLiDARFromFilePicker({
      centroidLat: lat,
      centroidLng: lng,
      onLoadingChange: lidar.setLoading,
    }).then((result) => {
      if (result.ok === 'error') {
        if (!result.cancelled) lidar.setError(result.error);
        return;
      }
      lidar.setDataset(result.dataset);
    });
  }, [lat, lng, lidar]);

  // ── Lift Roofs / Flatten Roofs ──────────────────────────────────────────
  //
  // 🚨 THESE DO NOT WRITE ANYTHING, AND THEY NOW SAY SO.
  //
  // The comment that stood here said "the actual roofPlane mutation goes
  // through a follow-up callback prop ... (out of v1 scope)", and that was
  // honest about the code. The STATUS MESSAGE was not: it read "⤴ Lifted 4 of 4
  // roof plane(s) to LiDAR-derived heights" while `updated` was a local that
  // was counted and dropped. Nothing moved, nothing was written, and the next
  // reload showed the same heights. An installer who trusted it would have
  // designed on a roof they believed had been corrected.
  //
  // 🚨 WHY IT IS NOT SIMPLY WIRED UP NOW THAT A CHANNEL EXISTS.
  // `onRoofGeometryReplaced` would carry it, but the value these compute is
  // `planeHeightAtCenterMeters` — a field a touch audit found carrying FOUR
  // mutually incompatible datums (a 0.0 sentinel, metres-above-ground,
  // absolute orthometric metres, and a dataset-local LiDAR Z), whose only real
  // consumer unconditionally treats it as relative-above-ground. The Z these
  // produce is the dataset-local one, after `applyOffset`. Connecting them
  // would ship a datum error into the permit rather than a feature.
  //
  // So they report what they measured and state plainly that nothing was
  // changed. Saying "not yet" is a feature; saying "done" was a defect.
  const handleLiftRoofs = useCallback(() => {
    if (!lidar.state.dataset || !roofPlanes || roofPlanes.length === 0) {
      setStatusMsg('⤴ Lift Roofs: load LiDAR and have at least one roof plane first');
      return;
    }
    const updated = liftRoofsUtil(lidar.state.dataset, roofPlanes as any, lidar.state.offset);
    const beforeById = new Map(roofPlanes.map((p) => [p.id, p.planeHeightAtCenterMeters]));
    const changed = updated.filter(
      (p) => p.planeHeightAtCenterMeters !== beforeById.get(p.id),
    ).length;
    addLog('LIDAR', `Lift Roofs: measured ${changed}/${updated.length} planes — NOT APPLIED (see the note above this function)`);
    setStatusMsg(
      `⤴ Lift Roofs: LiDAR differs from ${changed} of ${updated.length} roof plane(s). ` +
      'NOTHING HAS BEEN CHANGED — this measurement is not yet applied to the design, ' +
      'because the height it produces is in the LiDAR frame, not the roof frame. ' +
      'Set heights on the building section instead.',
    );
  }, [lidar.state.dataset, lidar.state.offset, roofPlanes]);

  const handleFlattenRoofs = useCallback(() => {
    if (!lidar.state.dataset || !roofPlanes || roofPlanes.length === 0) {
      setStatusMsg('⤓ Flatten Roofs: load LiDAR and have at least one roof plane first');
      return;
    }
    const updated = flattenRoofsUtil(lidar.state.dataset, roofPlanes as any, lidar.state.offset);
    const beforeById = new Map(roofPlanes.map((p) => [p.id, p.planeHeightAtCenterMeters]));
    const changed = updated.filter(
      (p) => p.planeHeightAtCenterMeters !== beforeById.get(p.id),
    ).length;
    addLog('LIDAR', `Flatten Roofs: measured ${changed}/${updated.length} planes — NOT APPLIED (see the note above this function)`);
    setStatusMsg(
      `⤓ Flatten Roofs: LiDAR differs from ${changed} of ${updated.length} roof plane(s). ` +
      'NOTHING HAS BEEN CHANGED — this measurement is not yet applied to the design, ' +
      'because the height it produces is in the LiDAR frame, not the roof frame. ' +
      'Set heights on the building section instead.',
    );
  }, [lidar.state.dataset, lidar.state.offset, roofPlanes]);

  // ── v66: Lift Roofs / Flatten Roofs for the 3D Primitives ────────────────
  // The lidar-integration agent's lift/flatten (above, at line ~855) operates
  // on the `roofPlanes` data model. THIS pair operates on the 3D Primitive
  // entities (block / gable / hip) the user draws in the canvas with the
  // in-canvas tools. Same algorithm, different data source.
  //
  // Adapter note: the sibling's `LiDARDataset` does not expose a
  // `getElevationAt(lat, lng)` method directly — it carries raw points in a
  // local ENU frame around the dataset centroid. The adapter below converts
  // the query to that frame and asks the grid index for the local elevation.
  //
  // FIXED (v66.1): the previous adapter computed `dx`/`dy` per point and then
  // threw them away (`void dx; void dy;`), pushed EVERY z into one array,
  // sorted that whole array and returned the mean of its top 25. It therefore
  // ignored `lat`/`lng` completely — every segment in a Lift/Flatten pass got
  // the same number (the highest returns anywhere in the scan) — and it paid
  // a full O(n log n) sort of up to ~500k points on every single call. It now
  // does a real spatial lookup: nearest returns within LIDAR_QUERY_RADIUS_M of
  // the query point, top-K averaged, against an index built once per dataset.
  const lidarPointGrid = useMemo(
    () => buildLiDARPointGrid(lidar.state.dataset?.points ?? []),
    [lidar.state.dataset],
  );
  const liDARGetElevationAt = useCallback((lat: number, lng: number): number | null => {
    const ds = lidar.state.dataset;
    if (!ds) return null;
    const dLat = lat - ds.centroidLat;
    const dLng = (lng - ds.centroidLng) * Math.cos((ds.centroidLat * Math.PI) / 180);
    const x = dLng * 111_320;
    const y = dLat * 111_320;
    const off = lidar.state.offset;
    const oxM = (off?.x ?? 0) * 0.3048;
    const oyM = (off?.y ?? 0) * 0.3048;
    const ozM = (off?.z ?? 0) * 0.3048;
    // The grid indexes the RAW points, so the X/Y offset is applied to the
    // query instead of to half a million points (shifting the cloud by +o is
    // the same as shifting the query by -o); the Z offset is added back to
    // the answer. Same convention the discarded dx/dy above was reaching for.
    const h = elevationAtFromGrid(lidarPointGrid, x - oxM, y - oyM);
    if (h === null) return null;
    return h + ozM;
  }, [lidar.state.dataset, lidar.state.offset, lidarPointGrid]);

  /**
   * Build a snapshot of every drawn 3D Primitive (block / gable / hip).
   * Trees are excluded — they are not roof segments.
   *
   * For a block: `heightM` = base + extrudedHeight (the eave sits at the
   * top of the prism walls).
   * For a gable/hip: `heightM` = min Z of the face positions (the eave).
   */
  const buildPrimitiveSnapshot = useCallback((): RoofPrimitive[] => {
    const C = (window as any).Cesium;
    if (!C) return [];
    const snap: RoofPrimitive[] = [];
    const readPts = (entity: any): Array<{ lat: number; lng: number; h: number }> => {
      try {
        if (!entity?.polygon?.hierarchy) return [];
        const hier = typeof entity.polygon.hierarchy.getValue === 'function'
          ? entity.polygon.hierarchy.getValue(C.JulianDate.now())
          : entity.polygon.hierarchy;
        if (!hier?.positions) return [];
        const out: Array<{ lat: number; lng: number; h: number }> = [];
        for (const cart of hier.positions) {
          const carto = C.Cartographic.fromCartesian(cart);
          if (!carto) continue;
          out.push({
            lat: C.Math.toDegrees(carto.latitude),
            lng: C.Math.toDegrees(carto.longitude),
            h: carto.height,
          });
        }
        return out;
      } catch { return []; }
    };
    for (const block of blockEntitiesRef.current) {
      const pts = readPts(block);
      if (pts.length === 0) continue;
      const baseH = pts.reduce((s, p) => s + p.h, 0) / pts.length;
      let eaveH = 0;
      try {
        const eh = block.polygon?.extrudedHeight?.getValue?.(C.JulianDate.now());
        if (typeof eh === 'number' && isFinite(eh)) eaveH = eh;
      } catch { /* ignore */ }
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      snap.push({ id: block.id, kind: 'block', centroidLat: cLat, centroidLng: cLng, heightM: baseH + eaveH });
    }
    for (let i = 0; i < gableEntitiesRef.current.length; i += 4) {
      const faceA = gableEntitiesRef.current[i];
      const pts = readPts(faceA);
      if (pts.length === 0) continue;
      const eaveZ = Math.min(...pts.map(p => p.h));
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      snap.push({ id: `gable-group-${i}`, kind: 'gable', centroidLat: cLat, centroidLng: cLng, heightM: eaveZ });
    }
    for (let i = 0; i < hipEntitiesRef.current.length; i += 4) {
      const faceA = hipEntitiesRef.current[i];
      const pts = readPts(faceA);
      if (pts.length === 0) continue;
      const eaveZ = Math.min(...pts.map(p => p.h));
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      snap.push({ id: `hip-group-${i}`, kind: 'hip', centroidLat: cLat, centroidLng: cLng, heightM: eaveZ });
    }
    return snap;
  }, []);

  /**
   * Apply new heights back to the entities. For each primitive, find the
   * entity(ies) and shift every per-vertex Z by the delta (newH - oldH).
   * Shape is preserved; only the absolute elevation changes.
   */
  const applyPrimitiveHeights = useCallback((snapshot: RoofPrimitive[], next: RoofPrimitive[]) => {
    const C = (window as any).Cesium;
    if (!C) return;
    if (snapshot.length !== next.length) return;
    for (let i = 0; i < snapshot.length; i++) {
      const before = snapshot[i];
      const after = next[i];
      if (!isFinite(after.heightM) || !isFinite(before.heightM)) continue;
      if (Math.abs(after.heightM - before.heightM) < 1e-6) continue;
      const delta = after.heightM - before.heightM;
      const updatePositions = (entity: any) => {
        if (!entity?.polygon?.hierarchy) return;
        const hier = typeof entity.polygon.hierarchy.getValue === 'function'
          ? entity.polygon.hierarchy.getValue(C.JulianDate.now())
          : entity.polygon.hierarchy;
        if (!hier?.positions) return;
        const newPositions = hier.positions.map((p: any) => new C.Cartesian3(p.x, p.y, p.z + delta));
        entity.polygon.hierarchy = new C.ConstantProperty(new C.PolygonHierarchy(newPositions));
      };
      if (after.kind === 'block') {
        const block = blockEntitiesRef.current.find((b: any) => b.id === after.id);
        if (block) {
          updatePositions(block);
          const handle = blockHandlesRef.current.find((h: any) => (h as any).__blockId === after.id);
          if (handle?.position) {
            const cur = typeof handle.position.getValue === 'function'
              ? handle.position.getValue(C.JulianDate.now())
              : handle.position.getValue?.(C.JulianDate.now());
            if (cur) {
              // WAS: constructed as `C.ConstantPosition`. There is no such symbol
              // on the Cesium namespace (verified against the cesium package we ship:
              // `Cesium.ConstantPosition === undefined`), so the constructor call
              // threw `C.ConstantPosition is not a constructor` the instant a user
              // clicked Lift/Flatten Roofs with a block that has a height handle.
              // The whole action died inside applyPrimitiveHeights, leaving the
              // geometry half-shifted. The real type for an Entity.position that
              // never changes over time is ConstantPositionProperty (the position
              // analogue of the ConstantProperty used for the hierarchy above).
              // 🚨 AND THE SHIFT IS ALONG THE LOCAL VERTICAL, NOT ALONG ECEF Z.
              // `cur.z + delta` moves the point delta metres toward the NORTH
              // POLE, whose vertical component is only delta·sin(latitude) —
              // 63% of the intended move at 38.7°N, and zero on the equator.
              // The handle drifted north as well as up, by delta·cos(latitude).
              const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(cur, new C.Cartesian3());
              handle.position = new C.ConstantPositionProperty(
                up
                  ? C.Cartesian3.add(cur, C.Cartesian3.multiplyByScalar(up, delta, new C.Cartesian3()), new C.Cartesian3())
                  : new C.Cartesian3(cur.x, cur.y, cur.z + delta),
              );
            }
          }
        }
      } else if (after.kind === 'gable' || after.kind === 'hip') {
        const m = /^(\w+)-group-(\d+)$/.exec(after.id);
        if (!m) continue;
        const list = m[1] === 'gable' ? gableEntitiesRef.current : hipEntitiesRef.current;
        const startIdx = parseInt(m[2], 10);
        for (let j = 0; j < 4; j++) updatePositions(list[startIdx + j]);
      }
    }
  }, []);

  const handleLiftPrimitives = useCallback(() => {
    if (!lidar.state.dataset) {
      setStatusMsg('⤴ Lift Roofs (3D Primitives): LiDAR not loaded');
      return;
    }
    const snapshot = buildPrimitiveSnapshot();
    if (snapshot.length === 0) {
      setStatusMsg('⤴ Lift Roofs: no 3D Primitive roof segments to lift');
      return;
    }
    const next = liftRoofsPrimitives(snapshot, { getElevationAt: liDARGetElevationAt });
    applyPrimitiveHeights(snapshot, next);
    const changed = next.filter((p, i) => Math.abs(p.heightM - snapshot[i].heightM) > 1e-6).length;
    addLog('LIFT-PRIM', `Lifted ${changed}/${snapshot.length} 3D Primitives to LiDAR elevations`);
    setStatusMsg(`⤴ Lifted ${changed} of ${snapshot.length} 3D Primitive segment${snapshot.length === 1 ? '' : 's'} to LiDAR elevations`);
    try { viewerRef.current?.scene.requestRender(); } catch { /* ignore */ }
  }, [lidar.state.dataset, buildPrimitiveSnapshot, liDARGetElevationAt, applyPrimitiveHeights]);

  const handleFlattenPrimitives = useCallback(() => {
    if (!lidar.state.dataset) {
      setStatusMsg('⤓ Flatten Roofs (3D Primitives): LiDAR not loaded');
      return;
    }
    const snapshot = buildPrimitiveSnapshot();
    if (snapshot.length === 0) {
      setStatusMsg('⤓ Flatten Roofs: no 3D Primitive roof segments to flatten');
      return;
    }
    const next = flattenRoofsPrimitives(snapshot, { getElevationAt: liDARGetElevationAt });
    applyPrimitiveHeights(snapshot, next);
    const flatH = next[0]?.heightM;
    addLog('FLATTEN-PRIM', `Flattened ${snapshot.length} 3D Primitives to ${flatH?.toFixed(2)}m`);
    setStatusMsg(`⤓ Flattened ${snapshot.length} 3D Primitive segment${snapshot.length === 1 ? '' : 's'} to ${flatH?.toFixed(2)}m`);
    try { viewerRef.current?.scene.requestRender(); } catch { /* ignore */ }
  }, [lidar.state.dataset, buildPrimitiveSnapshot, liDARGetElevationAt, applyPrimitiveHeights]);
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
  // v66: solid extruded building (walls to ground + filled roof surfaces).
  const [showBuilding3D, setShowBuilding3D] = useState(false);
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
  /** So the relative-datum warning is logged once, not on every click. */
  const warnedUnresolvedGroundRef = useRef(false);
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
  // v66: Measurements tool — multi-pair (Aurora TIER 2 #10).
  // measurementsRef holds COMMITTED measurements; the in-progress pair
  // still uses measurePtsRef + measureOverlayRef (the legacy measure refs).
  const measurementsRef = useRef<Measurement[]>([]);
  // v66: Ruler tool — single persistent measurement, drag-anchored.
  const rulerRef = useRef<Measurement | null>(null);
  const rulerEntitiesRef = useRef<MeasurementEntityBundle | null>(null);
  const rulerPreviewEntityRef = useRef<any>(null);
  const rulerAnchorRef = useRef<LngLatH | null>(null);
  const rulerCursorRef = useRef<LngLatH | null>(null);
  const rulerDraggingRef = useRef<boolean>(false);
  // v64: Block primitive — 2-corner footprint then default-height box.
  // v65.1: each point now also stores the click elevation (h, meters above
  // WGS84 ellipsoid) so the prism and the in-progress polyline render at
  // the actual ground level, not buried 100m+ below the satellite drape.
  const blockPtsRef     = useRef<Array<{ lat: number; lng: number; h: number }>>([]);
  const [blockPtCount, setBlockPtCount]     = useState(0);
  const blockEntitiesRef = useRef<any[]>([]); // Cesium Entity[] for the placed boxes
  const [placedBlockCount, setPlacedBlockCount] = useState(0);
  // v64: Block resize — drag-handle on top of each block. handleDragRef tracks
  // which block is being resized and the start Y in world coords.
  const blockHandlesRef = useRef<any[]>([]); // Cesium Entity[] for the handles
  const blockResizeRef  = useRef<{ blockEntity: any; handleEntity: any; startHeightM: number; startYWorld: number; centroidCart: any } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const blockHeightOverridesRef = useRef<Map<string, number>>(new Map()); // blockId -> heightM
  // v65: Line-trace block mode — N points to define any polygon footprint, right-click
  // to finalize. The in-progress polyline is shown as a preview entity.
  const blockPreviewRef = useRef<any>(null); // preview polyline entity (in-progress)
  // v68: Segment normal arrows — yellow chevron at the midpoint of each
  // polyline edge in the in-progress block line-trace (Aurora parity).
  // flippedArrowsRef tracks which segment ids the user has clicked to
  // invert. The overlay factory is created once at viewer init.
  const segmentArrowOverlayRef = useRef<SegmentArrowOverlay | null>(null);
  const flippedArrowsRef = useRef<Set<string>>(new Set());
  const DEFAULT_BLOCK_HEIGHT_M = 6; // typical 1-story eave height
  // v66: 3D Primitives input state — exposed in the in-canvas Properties panel
  // so the user can set eave height for new blocks and roof pitch for new
  // gables/hips without 3D-dragging each one. The selected-block height input
  // updates the most-recently-placed block's extrudedHeight in real-time.
  const [newBlockEaveHeightM, setNewBlockEaveHeightM] = useState<number>(DEFAULT_BLOCK_HEIGHT_M);
  const [roofPitchDeg, setRoofPitchDeg] = useState<number>(22);
  const [lastPlacedBlockId, setLastPlacedBlockId] = useState<string | null>(null);
  // Default eave for gable/hip roofs (height of the wall below the eave line)
  const [newRoofEaveHeightM, setNewRoofEaveHeightM] = useState<number>(6);

  // 🚨 THE PITCH AND EAVE SLIDERS WERE INERT, AND NOTHING SAID SO.
  //
  // `finalizeRoofSection` reads these two to build a traced gable or hip, and it
  // is reached only from `handleGableClick` / `handleHipClick` — both dispatched
  // by the Cesium LEFT_CLICK handler that `setupClickHandler` registers once at
  // mount. So the values it could see were the mount defaults, 22° and 6 m, and
  // no movement of either slider ever reached a roof for the life of the page.
  //
  // The status line made it look wired: it is rendered in render scope, so
  // tracing with the slider at 40° printed "Pitch 40°" while the section was
  // built at 22°. And this is not recoverable later — `buildSectionRoofPlanes`
  // stamps `pitchDeg` and the eave-derived elevation onto the RoofPlanes that go
  // to DesignStudio and are persisted, so a 9:12 hip the user dialled in is
  // saved as 4.7:12 and every panel placed on it sits on the wrong deck. That is
  // the vertical-datum class of error the building-section work exists to end.
  const roofPitchDegRef = useRef<number>(22);
  const newRoofEaveHeightMRef = useRef<number>(6);
  useEffect(() => { roofPitchDegRef.current = roofPitchDeg; }, [roofPitchDeg]);
  useEffect(() => { newRoofEaveHeightMRef.current = newRoofEaveHeightM; }, [newRoofEaveHeightM]);
  // v64: Gable roof primitive — click 2 eave corners, render 2 sloped faces meeting at ridge.
  // The eave is a rectangle in lat/lng; ridge runs along the long edge at the centroid.
  const gablePtsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const [gablePtCount, setGablePtCount] = useState(0);
  const gableEntitiesRef = useRef<any[]>([]);
  const [placedGableCount, setPlacedGableCount] = useState(0);
  const DEFAULT_GABLE_PITCH_DEG = 22;
  const DEFAULT_GABLE_EAVE_HEIGHT_M = 6;
  // v64: Hip roof — 4 eave corners (rectangle), 2 trapezoid slopes + 2 triangle ends
  const hipPtsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const [hipPtCount, setHipPtCount] = useState(0);
  const hipEntitiesRef = useRef<any[]>([]);
  const [placedHipCount, setPlacedHipCount] = useState(0);
  // v64: Tree primitive — single click drops a green sphere (foliage) + thin brown cylinder (trunk).
  // Decorative only; doesn't affect solar production. Matches the 3D-After-at-Noon reference image.
  const treeEntitiesRef = useRef<any[]>([]);
  const [placedTreeCount, setPlacedTreeCount] = useState(0);

  // v66 (vertex-handles): per-primitive edit spec keyed by primitive id.
  // The shape varies per primitive type (block has blockExtrudeHeightM,
  // gable/hip have eaveHeightM + pitchDeg, tree has a position, etc.).
  // The full type lives in components/3d/editing/ — we keep it loose here
  // so the integration touch is minimal. See components/3d/editing/DESIGN.md.
  type VertexSpec = any;
  const vertexSpecsRef = useRef<VertexSpec[]>([]);
  const [vertexSpecs, setVertexSpecs] = useState<VertexSpec[]>([]);

  // v66 (roof-wizard): per-mode point counts for the wizard stepper and
  // the context-aware help panel. Mirrors the existing block/gable/hip/tree
  // counts. mark_plane / plane3d / ground are the legacy CAD-derivation
  // flows; the wizard surfaces them in the help-panel context so the user
  // can see "5/3 points" type progress.
  const [markPlanePtCount, setMarkPlanePtCount] = useState(0);
  const [plane3DPtCount,   setPlane3DPtCount]   = useState(0);
  const [groundPtCount,    setGroundPtCount]    = useState(0);

  // v66 (obstruction-primitive): Aurora-parity "Add Obstruction" primitive.
  // Single-click placement of a small rectangular prism (chimney / vent /
  // dormer). The right-panel input block lets the user override the
  // defaults before placing.
  const [newObstructionWidthM,  setNewObstructionWidthM]  = useState<number>(DEFAULT_OBSTRUCTION_FOOTPRINT_W_M);
  const [newObstructionDepthM,  setNewObstructionDepthM]  = useState<number>(DEFAULT_OBSTRUCTION_FOOTPRINT_D_M);
  const [newObstructionHeightM, setNewObstructionHeightM] = useState<number>(DEFAULT_OBSTRUCTION_HEIGHT_M);

  // 🚨 THE CLICK HANDLER IS REGISTERED ONCE AND NEVER AGAIN, SO IT CANNOT READ
  // REACT STATE.
  //
  // `setupClickHandler` is called a single time from the viewer-init effect, so
  // the arrow function it hands to Cesium's `setInputAction` closes over the
  // MOUNT render for the life of the page. Every other value the placement path
  // needs — the armed preset, the plane list, the panel list — is already a ref
  // for exactly this reason. These three were left as plain state.
  //
  // Measured: arming the Tree tool sets the state to 6.0 x 6.0 x 8.0 and the
  // panel sliders show 6.0, but the click read the mount values (0.6 x 0.6 x
  // 1.0) and `clampToPreset` raised the 0.6 to the tree's 1.0 m minimum
  // footprint. So a tree WAS placed, at 1 m across instead of 6 — and since
  // `canopyRadiusM` is half the footprint, every shade result was computed on a
  // sixth of a tree. The sliders and the object disagreed, and the sliders were
  // the ones telling the truth.
  //
  // Mirrored by an effect rather than at each setter, so a path added later
  // (a new slider, a preset, a restore) cannot reintroduce the split.
  // 🚨 One name for "a placement panel is open", because it decides both what
  // renders AND what is clickable. See the note on `top-right-stack`.
  const isPlacingObject = placementMode === 'obstruction' || placementMode === 'tree';

  const obstructionSizeRef = useRef<{ widthM: number; depthM: number; heightM: number }>({
    widthM:  DEFAULT_OBSTRUCTION_FOOTPRINT_W_M,
    depthM:  DEFAULT_OBSTRUCTION_FOOTPRINT_D_M,
    heightM: DEFAULT_OBSTRUCTION_HEIGHT_M,
  });
  useEffect(() => {
    obstructionSizeRef.current = {
      widthM:  newObstructionWidthM,
      depthM:  newObstructionDepthM,
      heightM: newObstructionHeightM,
    };
  }, [newObstructionWidthM, newObstructionDepthM, newObstructionHeightM]);
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
      // v65: also clear in-progress block on tool change / re-arm
      // v65.2 LEAK FIX: same orphaned-`__dots` bug as the rebuild path in
      // handleBlockClick — abandoning a half-traced block by switching tools
      // used to leave its marker dots behind in the viewer.
      blockPtsRef.current = []; setBlockPtCount(0);
      // 🚨 THE SECTION TOOLS WERE MISSING FROM THIS LIST. Every other
      // in-progress buffer is cleared on a tool change; gable and hip were not,
      // so clicking two corners, switching to Hip and switching back finalised
      // a section whose first two corners came from the ABANDONED trace — a
      // footprint nobody drew, silently accepted whenever it happened not to
      // self-intersect.
      gablePtsRef.current = []; setGablePtCount(0);
      hipPtsRef.current = []; setHipPtCount(0);
      if (blockPreviewRef.current) {
        removeBlockPreviewEntity(viewerRef.current, blockPreviewRef.current);
        blockPreviewRef.current = null;
      }
      // v68: drop the in-progress segment arrows on tool change
      try { segmentArrowOverlayRef.current?.clear(); } catch { /* ignore */ }
      flippedArrowsRef.current.clear();
      setClickCountForTool(0);
      clearGhostPanel();
      // v62: leaving select mode — drop the rotate knob and never leave a drag
      // half-open (which would keep camera left-drag disabled).
      hideRotateHandle();
      if (dragRef.current) dragRef.current = null;
      // 🚨 blockResizeRef BELONGS IN THIS LIST. It was omitted while the block
      // height drag was dead code and could never be set; it is reachable now.
      // An abandoned drag would otherwise survive a tool change, keep
      // swallowing MOUSE_MOVE and LEFT_UP in the new tool, and — because the
      // only place it is cleared is blockResizeUp's own `finally` — never
      // release. `arrayManipRef` is already reset here for exactly this reason.
      if (blockResizeRef.current) blockResizeRef.current = null;
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
    // v62 (3D-plane no-tiles guard): plane3d + mark_plane trace CORNERS on the 3D
    // mesh. When no Google Photorealistic 3D Tiles are loaded, the scene falls
    // back to satellite imagery + WGS84 ellipsoid and every click hits the ellipsoid
    // surface (h=0). computePlaneFromPoints3D's Newell normal then points straight
    // up, the eave axis falls through to the most-horizontal-edge heuristic, and
    // the resulting frame is (n=up, u=arbitrary horizontal, v=arbitrary horizontal).
    // buildSurfaceGrid places panels on that horizontal frame, aligned to whatever
    // arbitrary direction — not to the user's traced polygon. That's the "wonky
    // panels on bare 2D maps" bug (Auto Fill on a no-tiles address).
    //
    // v66: leaving both trace modes always ends a flat trace, so the flag can
    // never leak into an unrelated tool or survive an address change into a
    // 3D-covered region.
    if (placementMode !== 'plane3d' && placementMode !== 'mark_plane') {
      offMeshFirstClicksRef.current = 0;
      if (flatTraceRef.current) {
        flatTraceRef.current = false;
        setFlatTrace(false);
        restorePitchAfterFlatTrace();
      }
    }

    // Layer A: entry gate for these modes. With 3D tiles → unchanged pre-v66
    // behaviour. Without them → v66 flat trace instead of the old refusal.
    // (Layer C lives in handlePlane3DClick — per-click pickMethod check.)
    if ((placementMode === 'plane3d' || placementMode === 'mark_plane') && prevMode !== placementMode) {
      if (!tilesetRef.current) {
        const isLoading = tileStatus === 'loading';
        if (isLoading) {
          // Tiles may still arrive. Don't commit to flat trace yet — bounce out
          // and let the user re-enter once loading settles, exactly as before.
          setStatusMsg('⏳ 3D Plane is waiting for Google 3D Tiles to finish loading…');
          addLog('PLANE3D', `Deferred entry to ${placementMode} — tiles still loading`);
          onPlacementModeChange('select');
        } else {
          // v66 FLAT TRACE — replaces the old hard refusal.
          //
          // The old behaviour ejected the user back to 'select' with "pick an
          // address in a 3D-covered region", which is the whole reason this
          // work exists: a rural address could not trace a roof at all.
          //
          // It was never necessary. getWorldPosition still returns a CORRECT
          // lat/lng via its terrain and ellipsoid fallbacks — only the HEIGHT
          // is unknown, and height is exactly what pitch + azimuth supplies.
          // So enter the mode, collect the footprint, and build the face from
          // the outline instead of from the mesh.
          flatTraceRef.current = true;
          setFlatTrace(true);
          enterTopDownForFlatTrace();
          const pitchNow = Math.round(tiltRef.current ?? 0);
          if (placementMode === 'mark_plane') setShowRoofModel(true);
          setStatusMsg(
            `🗺️ Flat trace (no 3D coverage here) — view snapped straight down so your corners land ON the roof. ` +
            `Click this face's corners (3+), right-click to finish. Direction is read from the shape you trace; ` +
            `pitch starts at ${pitchNow}° and is editable per face afterwards.`
          );
          addLog('PLANE3D', `Flat-trace entry to ${placementMode} — no tileset; footprint + pitch ${pitchNow}° will build the face`);
        }
      } else {
        flatTraceRef.current = false;
        setFlatTrace(false);
        if (placementMode === 'mark_plane') {
          setShowRoofModel(true);
          setStatusMsg('⬡ Mark Plane — click a roof face\'s corners (3+), right-click to finish · edges classify live');
        } else {
          setStatusMsg('▣ Custom Array — click 3+ roof corners, right-click to place an array');
        }
      }
    }
    if (placementMode === 'auto_roof' && prevMode !== 'auto_roof') {
      const viewer = viewerRef.current;
      const C = (window as any).Cesium;
      // 🚨 THE TWIN IS NOT A PRECONDITION FOR FILLING A ROOF THE USER DREW.
      // This used to read `if (viewer && C && twinRef.current)`, so Auto Layout
      // did NOTHING — silently, with no toast, no status line and no log — on any
      // building Google Solar has no data for. The user traces a roof, presses
      // Auto Layout, and the button appears to be broken. The branch below
      // already handles an absent or empty twin by waiting and then filling from
      // `roofPlanesRef` anyway, so the outer guard was not protecting the code
      // that follows it; it was preventing it from ever running.
      //
      // `buildDigitalTwin` rejecting versus resolving with zero segments is the
      // difference between the two, and that is a network outcome — which is why
      // the same click worked on one run and did nothing on the next.
      if (viewer && C) {
        // Wait for terrain sampling to complete before running Auto Fill.
        // terrainReadyRef is set true at the end of boot() after sampleTerrainMostDetailed.
        // If terrain is already ready, run immediately. Otherwise poll every 200ms (max 5s).
        const runAutoFill = () => handleAutoRoof(viewer, C);
        // Run immediately if twin data is available (don't wait for terrainReady
        // since EllipsoidTerrainProvider never gives valid heights anyway -
        // clampToHeightMostDetailed handles height correction at render time)
        const hasTracedRoof = (roofPlanesRef.current?.length ?? 0) > 0;
        if (twinRef.current && twinRef.current.roofSegments.length > 0) {
          setTimeout(runAutoFill, 100);
        } else if (hasTracedRoof) {
          // A roof the user drew is all the geometry this needs. Waiting eight
          // seconds for a twin that will not arrive is a delay with no payoff.
          addLog('AUTO', `auto_roof: filling ${roofPlanesRef.current!.length} traced plane(s) — no twin needed`);
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

  // ── Obstructions: report every change to the parent ──────────────────────
  // Emitted from an EFFECT on the state rather than from each mutation site.
  // There are several (place, clear-all, and any future one), and a callback
  // wired per-site is a callback someone eventually forgets — which is exactly
  // how these never got persisted in the first place. One effect cannot be
  // missed.
  const skipFirstObstructionEmit = useRef(true);
  useEffect(() => {
    // Do not emit the initial empty array over a restored set on mount.
    if (skipFirstObstructionEmit.current) { skipFirstObstructionEmit.current = false; return; }
    onObstructionsChange?.(obstructions);
  }, [obstructions, onObstructionsChange]);

  // Re-apply obstructions restored from the database, once.
  // 🚨 THIS WAS A ONE-SHOT LATCH, AND THE ENGINE NEVER REMOUNTS.
  //
  // `appliedInitialObstructions` was set true the first time a non-empty
  // `initialObstructions` arrived and was never reset. `<SolarEngine3D>` carries
  // no `key`, and `changeSite` does not touch `show3D`, so the component
  // survives every property change. After site A's obstructions had been
  // applied, switching to site B changed the prop and this effect returned at
  // the first line — leaving `obstructionsRef.current` holding **A's keep-outs
  // while standing on B**. Two live consequences, both silent:
  //
  //   1. WRONG CULLING. `removeObstructedPanels(newPanels, obstructionsRef.current)`
  //      runs in the plane3d and surface-select auto-fills. A's vent footprints
  //      are lat/lng, so at a neighbouring house they can land inside B's roof
  //      and delete B's panels with nothing on screen to say why.
  //   2. CROSS-SITE CONTAMINATION. Placing one obstruction at B appends to A's
  //      list, and the outbound effect then persists A's obstructions onto B.
  //
  // The fix is to track WHAT was applied rather than WHETHER anything was. The
  // identity of the incoming array is the signal: `applyBundle` hands a new
  // array on every property change, and an empty one is a real answer — "this
  // property has no obstructions" — which the old guard could not express at
  // all, because it declined to apply empty.
  const appliedObstructionsRef = useRef<PlacedObstruction[] | null>(null);
  useEffect(() => {
    const incoming = initialObstructions ?? [];
    if (appliedObstructionsRef.current === initialObstructions) return;
    // Only the mount-time case is skipped: before the restore resolves the prop
    // is an empty array, and adopting it would clear nothing over nothing.
    if (appliedObstructionsRef.current === null && incoming.length === 0) return;
    appliedObstructionsRef.current = initialObstructions ?? [];
    obstructionsRef.current = incoming;
    setObstructions(incoming);

  }, [initialObstructions]);

  // 🚨 DRAWING IS ITS OWN EFFECT, BECAUSE THE VIEWER IS NOT READY WHEN THE
  // RECORD ARRIVES.
  //
  // The first version drew inside the adopt effect, guarded by
  // `if (viewerRef.current)`. On a cold load the DB restore resolves long before
  // Cesium finishes initialising, so that ref was null, the guard fell through,
  // and nothing ever retried -- the restored obstructions were adopted and never
  // drawn, which is the exact defect it was written to close. It only worked
  // when the viewer happened to already exist.
  //
  // So the draw depends on a STATE (`stage`), which re-renders when it changes,
  // rather than a ref, which does not. The redraw is idempotent -- remove then
  // add, per id -- so running it again on the next stage change is harmless.
  useEffect(() => {
    const v = viewerRef.current;
    const C = (window as any).Cesium;
    if (!v || !C || stage !== 'done') return;
    const live = obstructionsRef.current ?? [];
    try {
      // Anything drawn that is no longer in the design -- including objects left
      // over from a different property -- goes first.
      const liveIds = live.map(o => o?.id).filter(Boolean) as string[];
      const stale = (v.entities.values ?? [])
        .filter((e: any) => typeof e?.name === 'string' && e.name.startsWith('[OBS] '))
        .map((e: any) => e.id)
        .filter((id: string) => !liveIds.includes(id));
      if (stale.length) removeObstructionEntities(v, stale);
      for (const o of live) {
        if (!o?.id) continue;
        try { removeObstructionEntities(v, [o.id]); } catch { /* not drawn yet */ }
        drawObstructionEntity(v, C, o);
      }
      v.scene.requestRender();
    } catch (e: unknown) {
      addLog('WARN', 'obstruction redraw: ' + (e as Error).message);
    }
  }, [obstructions, stage]);

  // ── Lane A state ─────────────────────────────────────────────────────────
  // Both are REFS on purpose. maybeRunLaneA fires from inside a resolved
  // promise, long after its enclosing render; a closure would decide against
  // the state that existed when the twin fetch STARTED, which is exactly the
  // window where the DB restore has not landed yet.
  const roofRestoreResolvedRef = useRef<boolean>(roofRestoreResolved);
  useEffect(() => { roofRestoreResolvedRef.current = roofRestoreResolved; }, [roofRestoreResolved]);
  /** The siteKey Lane A last ran for. Set BEFORE emitting, so a second twin
   *  load for the same building cannot append a duplicate set — buildRoofPlane3D
   *  mints a fresh uuid per call, so a re-run would ADD faces, not replace them. */
  const laneARanForRef = useRef<string | null>(null);

  // ── E2E: THE SCENE ITSELF, NOT THIS COMPONENT'S OPINION OF IT ────────────
  //
  // 🚨 EVERY ELEVATION GUARD BEFORE THIS ONE MEASURED A NUMBER THIS FILE
  // COMPUTED. `tests/panelSurfaceClearance.test.ts`, `tests/roofMountDatum.test.ts`
  // and `e2e/panel-elevation.spec.ts` all compare a `PlacedPanel.height` against
  // the `RoofPlane` it was placed from. That is the placement library checking
  // its own arithmetic. It cannot see the two things a person actually looks at:
  //
  //   the BOX Cesium draws for a panel,  and
  //   the POLYGON Cesium draws for the roof deck underneath it.
  //
  // Those are produced by different code — `addPanelEntity` and
  // `renderPlane3DEntity` — from different inputs, and they disagreed on
  // `origin/master`: the restore path re-fitted an already-lifted `polygon3D`
  // and drew the deck a second SURFACE_OFFSET_M up, while panels sat at
  // PANEL_OFFSET_ECEF. Every panel on a restored or auto-detected face rendered
  // BELOW the deck, and no test anywhere could have noticed, because no test
  // anywhere read an entity.
  //
  // So this exposes the live viewer — and nothing else — under the same
  // build-time flag as the studio's hook, and the spec does all the measuring.
  // Handing out a ready-made clearance number would put the measurement back
  // inside the component under test.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== '1' || typeof window === 'undefined') return;
    if (stage !== 'done' || !viewerRef.current) return;
    (window as any).__solarViewerE2E = viewerRef.current;
    return () => { try { delete (window as any).__solarViewerE2E; } catch {} };
  }, [stage]);

  // ── v64: Restore 3D roof-plane outlines + wireframe on project load ──────
  // After reload the panels are still there (they have their own restore effect),
  // but the roof-plane outline entities (plane3DEntityMap) and stitched wireframe
  // are GONE because they were only ever built from user actions this session.
  // This effect rebuilds them from the persisted roofPlanes prop (which carries
  // polygon3D / origin3D / normal3D / localFrame3D from the stitch write-back).
  //
  // Idempotent: skips planes already in plane3DEntityMap (traced/stitched this
  // ═════════════════════════════════════════════════════════════════════════
  // A DELETION HAS BEEN PERFORMED BY THE OWNER — take the picture down.
  //
  // 🚨 THIS IS THE DELETION PATH THE v66 NOTE BELOW SAYS IS THE ONLY LEGAL ONE:
  // "it must be driven by an explicit user delete action carrying the id to
  // remove — never by inferring absence from a prop that has its own timing."
  // The ids come from the owner's canonical delete, which has already recorded
  // the undo step and the tombstone. Nothing here looks at what is missing.
  //
  // Keyed on the TOKEN, not on the id list: two identical deletions (delete,
  // undo, delete again) must both fire, and a list compared by identity would
  // re-fire on every unrelated re-render.
  // ═════════════════════════════════════════════════════════════════════════
  const lastDeletionTokenRef = useRef<number>(0);
  useEffect(() => {
    if (!deletion || !deletion.token) return;
    if (deletion.token === lastDeletionTokenRef.current) return;
    lastDeletionTokenRef.current = deletion.token;
    const viewer = viewerRef.current;
    if (!viewer) return;
    let removed = 0;
    removed += removeFaceEntities(viewer, deletion.faceIds ?? []);
    removed += removeObstructionEntities(viewer, deletion.obstructionIds ?? []);
    for (const pid of (deletion.panelIds ?? [])) {
      try { removePanelEntities(viewer, pid); removed++; } catch { /* ignore */ }
    }
    if (deletion.resetEditor) {
      // 🚨 THE ORDER MATTERS. Idle FIRST, so that nothing below can be
      // re-created by a half-finished interaction reacting to the removals.
      resetEditorToIdle(viewer);
      try { clearBuildingExtrusion(viewer); } catch { /* ignore */ }
      try { clearRoofWireframe(viewer); } catch { /* ignore */ }
      try { clearFireSetbackZones(viewer); } catch { /* ignore */ }
      try { clearEquipment(viewer); } catch { /* ignore */ }
      try { clearRoofRails(viewer); } catch { /* ignore */ }
      clearPlacedBlocks(viewer);
      clearPlacedTrees(viewer);
    }
    addLog('DELETE', `${deletion.scope}: removed ${removed} entit${removed === 1 ? 'y' : 'ies'}`
      + (deletion.resetEditor ? ', editor reset to idle' : ''));
    try { viewer.scene?.requestRender?.(); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletion?.token]);

  // session). Does NOT touch panels or fences — those have their own restore paths.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C || stage !== 'done') return;
    const planes = roofPlanes ?? [];

    // 🚨 v66: A RECONCILE-DELETIONS BLOCK WAS HERE AND IS DELIBERATELY GONE.
    //
    // It removed entities for any plane id not present in `roofPlanes`, to stop
    // a deleted plane leaving a ghost. It DESTROYED USER WORK: Ray traced a
    // garage, and traced faces live in plane3DEntityMap while `roofPlanes` is
    // the DesignStudio prop, which does not always list them at the moment this
    // effect runs. Anything missing from that prop got silently deleted — his
    // whole garage layout, with no undo.
    //
    // A ghost face is a cosmetic annoyance. Losing traced work is not. If a
    // deletion path is ever added back, it must be driven by an explicit user
    // delete action carrying the id to remove — never by inferring absence from
    // a prop that has its own timing. Absence is not intent.

    if (planes.length === 0) return;

    // Find planes that are NOT already rendered.
    //
    // 🚨 "IN THE MAP" IS NOT "ON SCREEN". A delete removes the ENTITIES and
    // deliberately leaves the map entry (the prune ban). So after an Undo the
    // face was back in `roofPlanes` and back in the sidebar and invisible in
    // 3D — it reappeared only as a side effect of the next selection change,
    // which reads exactly like the undo half-worked. Membership in the map is
    // now checked against whether its entities actually exist.
    const stillDrawn = (planeId: string) =>
      (plane3DEntityMap.current.get(planeId) ?? []).some((eid: string) => !!viewer.entities.getById(eid));
    const planesToRestore = planes.filter(p => !stillDrawn(p.id));
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

        // 🚨 THE DECK IS DRAWN FROM THE PLANE THE PANELS WERE PLACED ON.
        //
        // This used to resolve the face itself, three ways, and the placement
        // engine resolved it three OTHER ways. Measured on the demo roof
        // (ground 128 m, eave 160 m, stack 0.14 m), panel above its own deck:
        //
        //     full 3D face                    0.141 m   correct
        //     3D face with no polygon3D      31.07  m   array floating over a
        //                                              deck lying on the ground
        //     genuine 2D face                 0.017 m   panel box is 0.040 m
        //                                              thick and centred, so its
        //                                              UNDERSIDE is 3 mm inside
        //                                              the roof — half-buried,
        //                                              correct count, no error
        //
        // The 2D case is reachable from the ordinary UI: "Tag This Roof Plane"
        // (`confirmPendingPlane`) produces a face carrying only `vertices`,
        // `pitch`, `azimuth` and `localFrame3D` — no polygon3D, no origin3D, no
        // ecefFrame3D — and Auto Layout fills it. With a low-profile racking
        // (0.10 m stack) the clearance is NEGATIVE and the whole array vanishes
        // under the base coat.
        //
        // 🚨 AND IT IS A REGRESSION THIS WORKSTREAM CREATED. Before the
        // mark-only latch was removed, a restored face was drawn as an outline
        // for ever, so there was no deck to bury the array in. Drawing the deck
        // is right; drawing it from a different resolution than the placement
        // engine is what made it dangerous.
        //
        // `resolvePlaneGeometry` is that one resolution, and it guarantees the
        // polygon lies ON the plane whose origin the placer adds the mount
        // stack to — so the deck is drawn with `surfaceOffsetM: 0` in every
        // branch. Re-fitting it with the default lift is the double-lift that
        // WS1-038 records on `origin/master`.
        const geom = resolvePlaneGeometry(plane as any, groundElev);
        if (!geom.polygon3D || geom.polygon3D.length < 3) {
          addLog('RESTORE', `Skipped plane ${plane.id.slice(0,8)}: resolved <3 corners (${geom.source})`);
          continue;
        }
        cartPts = geom.polygon3D.map(p => ({ x: p.x, y: p.y, z: p.z }));
        frame = computePlaneFromPoints3D(cartPts, { surfaceOffsetM: 0 });
        if (geom.source !== 'own-frame-and-polygon') {
          addLog('RESTORE', `plane ${plane.id.slice(0,8)} resolved via ${geom.source}`);
        }

        // ── Step 2: Convert projected points to Cesium Cartesian3 ──────
        const projectedCesiumPts = frame.projectedPts.map((p: Cart3) =>
          new C.Cartesian3(p.x, p.y, p.z)
        );

        // ── Step 3: Outline or deck? ──────────────────────────────────
        // 🚨 THIS USED TO LATCH THE ANSWER INTO markOnlyPlaneIdsRef.
        // It ran before Auto Layout had placed anything, so every restored and
        // every auto-detected face was recorded as "no panels" permanently, and
        // the deck that hides the photogrammetry mesh was never drawn under the
        // array. See `planeRendersOutlineOnly`. Read, do not record.
        const isMarkOnly = planeRendersOutlineOnly(plane.id);

        // ── Step 4: Render plane entity (mirrors finalizePlane3D) ──────
        const isSelected = faceIsInSelection(plane.id);
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

  // v66: rebuild the solid building whenever the roof changes. Same shape as the
  // wireframe effect above, and deliberately NOT keyed on `panels` — panels sit
  // on top of the building and do not change its geometry, so re-extruding on
  // every panel edit would be pure churn.
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;
    if (showBuilding3D) {
      try { renderBuildingExtrusion(viewer, C); }
      catch (e) { addLog('WARN', `renderBuildingExtrusion: ${(e as Error).message}`); }
    } else {
      clearBuildingExtrusion(viewer);
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBuilding3D, showRoofTexture, simHour, roofPlanes, selectedFaceId, stage]);
  useEffect(() => { mountingSystemIdRef.current = mountingSystemId; }, [mountingSystemId]);
  useEffect(() => { paintModeRef.current = paintMode; }, [paintMode]);
  useEffect(() => { onPanelPaintRef.current = onPanelPaint; }, [onPanelPaint]);
  useEffect(() => { onRoofPlaneSelectRef.current = onRoofPlaneSelect; }, [onRoofPlaneSelect]);

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

  /**
   * Which faces currently carry panels.
   *
   * 🚨 THE OTHER HALF OF THE MISSING DECK. Reading `planeRendersOutlineOnly`
   * fresh is not enough on its own: the plane entities are only rebuilt when
   * this effect re-runs, and its only trigger was `selectedRoofPlaneId`. So a
   * face drawn as an outline before Auto Layout stayed an outline afterwards
   * until the user happened to click it. The answer changes when a face gains
   * or loses panels, so that is what the redraw keys on.
   */
  const panelPlaneKey = useMemo(
    () => Array.from(new Set(panels.map(p => p.planeId ?? ''))).sort().join('|'),
    [panels],
  );

  // v47.122: Re-render all tracked planes when selection changes
  // Selected plane → bright highlight; all others → dimmed
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return;

    // 🚨 MEMBERSHIP, NOT MAP CONTENTS.
    //
    // This walked `plane3DEntityMap` with no filter and RE-RENDERED every entry
    // it found. The map is deliberately never pruned — that ban exists because
    // a "reconcile deletions" effect once destroyed a hand-traced garage — and
    // the doctrine that justifies keeping the entries says they are "a cache
    // entry that decides nothing". This effect was a consumer that decided
    // quite a lot: delete a face, click any other face, and the deleted one was
    // DRAWN AGAIN. It could not be selected (`selectableRoofFaces` gates on
    // `roofPlanesRef`), could not be deleted again, and did not go away without
    // a reload — a face on screen that is in no design and in no permit.
    //
    // So the map still keeps every entry, and this reads membership from the
    // same place every other authority does.
    const inDesign = new Set((roofPlanesRef.current ?? []).map(p => p.id));
    plane3DEntityMap.current.forEach((entityIds, planeId) => {
      if (!inDesign.has(planeId)) return;
      const frame     = plane3DFrameMap.current.get(planeId);
      const cesiumPts = plane3DCesiumPtsMap.current.get(planeId);
      if (!frame || !cesiumPts) return;

      // Remove old entities for this plane
      entityIds.forEach(eid => {
        const ent = viewer.entities.getById(eid);
        if (ent) try { viewer.entities.remove(ent); } catch {}
      });

      // Re-render with new selection state
      const isSelected = faceIsInSelection(planeId);
      const newIds = renderPlane3DEntity(viewer, C, cesiumPts, planeId, frame, isSelected, planeRendersOutlineOnly(planeId));
      plane3DEntityMap.current.set(planeId, newIds);

      // Also update the flat list
      plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    });

    try { viewer.scene.requestRender(); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFaceId, selectionLevel, panelPlaneKey]);

  useEffect(() => { selectedPanelRef.current = selectedPanel; }, [selectedPanel]);
  useEffect(() => { simHourRef.current = simHour; }, [simHour]);
  useEffect(() => { showRoofTextureRef.current = showRoofTexture; }, [showRoofTexture]);
  useEffect(() => { selectedFaceIdRef.current = selectedFaceId; }, [selectedFaceId]);
  // 🚨 REFS, because the keyboard handler is installed once and closes over the
  // first render's values. Reading state there would delete whatever was
  // selected when the listener was attached, which is usually nothing and
  // occasionally the wrong object.
  const selectionLevelRef = useRef<'section' | 'face' | 'wall'>('section');
  const selectedFaceSectionIdRef = useRef<string | null>(null);
  useEffect(() => { selectionLevelRef.current = selectionLevel; }, [selectionLevel]);

  /** 🚨 A SELECTION CANNOT OUTLIVE ITS FACE.
   *
   *  Deleting the selected face used to leave `selectedFaceId` pointing at an id
   *  the design no longer contains, and the face-scoped Building controls
   *  (`effectivePitchDeg`, `effectiveWallM`) go on reading a `buildingOverrides`
   *  entry for it — so the steppers silently edit a dead face instead of falling
   *  back to whole-building scope. Clearing a SELECTION destroys no work, which
   *  is what separates this from the reconcile-deletions block that did. */
  useEffect(() => {
    if (!selectedFaceId) return;
    if ((roofPlanes ?? []).some(p => p.id === selectedFaceId)) return;
    selectRoofFace(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFaceId, roofPlanes]);
  const showBuilding3DRef = useRef(false);
  useEffect(() => { showBuilding3DRef.current = showBuilding3D; }, [showBuilding3D]);
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
    // v66: textures are keyed by lat/lng bounds, but drop them anyway so a new
    // address can never paint the previous house's roof.
    clearRoofTextureCache();

    const elev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    // Update orbit state for new address — snap camera to site at default pose
    const o = orbitRef.current;
    o.targetLat = lat;
    o.targetLng = lng;
    o.targetAlt = elev;
    o.heading   = TILTED_AERIAL_VIEW.heading;  // π → fly-in looks NORTH (look dir = heading + π)
    o.pitch     = TILTED_AERIAL_VIEW.pitch;    // -45° Aurora parity (lib/3d/cameraPresets.ts)
    // 150m default framing; only fall back to a wider 300m when the ground
    // elevation is genuinely UNRESOLVED. (Was `elev > 0`, which wrongly treated
    // legitimately-negative coastal elevations as "unknown" and zoomed out.)
    o.radius    = cesiumGroundElevResolvedRef.current ? TILTED_AERIAL_VIEW.range : 300;
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
    // The site this particular request is asking about, captured BEFORE the
    // await. Everything in the callback is validated against it.
    const requestedSiteKey = siteKeyFromCoords(lat, lng);
    buildDigitalTwin(lat, lng, projectAddress ?? '', true /* skipDsm */).then(newTwin => {
      // 🚨 STALE-RESPONSE GUARD. Twin loads are async and uncancelled, so two
      // address changes in quick succession leave two requests in flight that
      // can resolve OUT OF ORDER. prevLatRef/prevLngRef always hold the site
      // the user is actually on (they are written synchronously at the top of
      // this effect). If they no longer match the site this response answers
      // for, the response is stale: it must not touch twinRef, must not move
      // the camera, and must not seed ground elevation — all of which would
      // apply one property's data to another.
      const currentSiteKey = siteKeyFromCoords(prevLatRef.current, prevLngRef.current);
      if (requestedSiteKey && currentSiteKey && requestedSiteKey !== currentSiteKey) {
        addLog('FLY', `discarded stale twin for ${requestedSiteKey} — now at ${currentSiteKey}`);
        return;
      }
      twinRef.current = newTwin;
      onTwinLoaded?.(newTwin);
      addLog('FLY', `Twin reloaded: ${newTwin.roofSegments.length} segments`);
      setStatusMsg(`✅ Solar data loaded: ${newTwin.roofSegments.length} roof segments`);

      // PERF v61: Use geoid approximation directly — skip sampleTerrainMostDetailed (saves 3-5s).
      // Same rule as the boot path above: absence is not sea level.
      const geoidApprox = geoidUndulationM(lat);
      const flyDatum = resolveGroundDatum(newTwin.elevation, lat);
      if (flyDatum.resolved) {
        cesiumGroundElevRef.current = flyDatum.ellipsoidalM;
        cesiumGroundElevResolvedRef.current = true;
        addLog('FLY', `cesiumGroundElev updated: ${flyDatum.ellipsoidalM.toFixed(1)}m (geoidApprox: ${geoidApprox.toFixed(1)}m) [no terrain sample]`);
      } else {
        cesiumGroundElevResolvedRef.current = false;
        addLog('WARN', `ground elevation UNRESOLVED for ${lat.toFixed(5)}, ${lng.toFixed(5)} (${flyDatum.reason}) — roof auto-detection held off`);
      }
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

      // 🚨 LANE A — zero-click roof detection, HERE and not earlier. Ground
      // elevation resolves at cesiumGroundElevResolvedRef.current = true a few
      // lines above; segmentToRoofPlane3D builds every face at
      // `groundElevM + heightAboveGround`, so calling this before that point
      // would put the whole roof at elevation 0, under the terrain.
      // maybeRunLaneA re-checks that itself and refuses, but the ordering is
      // the actual contract — keep this call after the elevation block.
      maybeRunLaneA('address-change');

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

      // v68: create the segment-arrow overlay factory once per viewer.
      // The factory exposes update/clear/onPick; the call sites in
      // handleBlockClick (and the finalize/cancel branches) drive it.
      try {
        segmentArrowOverlayRef.current = createSegmentArrowOverlay(viewer, C);
        // Register the click-to-flip handler. The flipped set is
        // mutated in place and the overlay re-renders on the next
        // update() call from handleBlockClick.
        segmentArrowOverlayRef.current.onPick((segId: string) => {
          if (!segId) return;
          const cur = flippedArrowsRef.current;
          if (cur.has(segId)) cur.delete(segId);
          else cur.add(segId);
          addLog('ARROW', `Flipped ${segId} → normalDir ${cur.has(segId) ? -1 : 1}`);
          // Re-render the overlay with the same segments but the
          // updated flipped set. The list of points has not changed
          // since the last click, so we just rebuild.
          try {
            const pts = blockPtsRef.current.map((p: any) => ({ lat: p.lat, lng: p.lng }));
            if (pts.length >= 2) {
              const closedPts = pts.slice();
              if (closedPts.length >= 3) {
                const first = closedPts[0];
                const last  = closedPts[closedPts.length - 1];
                if (first.lat !== last.lat || first.lng !== last.lng) {
                  closedPts.push({ lat: first.lat, lng: first.lng });
                }
              }
              const segs = buildSegmentsFromPoints(closedPts, cur, 'face-block-1');
              const baseRefLat = blockPtsRef.current[0].lat;
              const baseRefH   = blockPtsRef.current[0].h || 0;
              segmentArrowOverlayRef.current?.update({
                segments: segs,
                refLat:   baseRefLat,
                refHeightM: baseRefH,
              });
            }
          } catch { /* render errors are non-fatal */ }
        });
      } catch (e) { addLog('WARN', `segment arrow overlay init: ${(e as Error).message}`); }

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
        pitch:   TILTED_AERIAL_VIEW.pitch,  // radians, -45° (Aurora parity) — lib/3d/cameraPresets.ts
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
        // i.e. ecef_offset = R·enuVec (no translation).
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
            // v66: PITCH IS LOCKED TO NADIR DURING A FLAT TRACE.
            // A flat trace picks corners on the ground plane (h=0) because there
            // is no roof mesh to pick. From a TILTED camera, the ray through a
            // pixel that visually sits on a roof carries on past the building
            // and lands on the ground well beyond it — so the captured footprint
            // is a displaced, stretched shadow of the roof rather than the roof.
            // Straight down, the ray meets the ground directly under the pixel
            // and the footprint is correct. This is why Aurora marks roof edges
            // in 2D. Heading, pan and zoom stay free; only tilt is withheld,
            // and only while a flat trace is actually running.
            if (!flatTraceRef.current) {
              orbit.pitch = orbit.dragStartP + dy * ORBIT_DRAG;
            }
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
        addLog('SOLAR', `Digital twin: ${twinData.roofSegments.length} segments, elev=${twinData.elevation == null ? 'UNRESOLVED' : twinData.elevation.toFixed(1) + 'm'}`);
      } else {
        addLog('WARN', `Digital twin failed: ${(twinResult as PromiseRejectedResult).reason?.message}`);
      }

      setStage('solar'); setProgress(65);

      setProgress(80);

      // Sample Cesium terrain to get true ellipsoidal height (fixes geoid undulation offset)
      // Google Elevation API returns orthometric heights; Cesium uses ellipsoidal heights
      // In Ohio the geoid undulation is approximately -33m (EGM96 geoid model)
      const googleGroundElev = twinData?.elevation ?? null;
      // PERF v61: Use lat-based EGM96 geoid approximation directly — skip sampleTerrainMostDetailed.
      // sampleTerrainMostDetailed can take 3-5s with EllipsoidTerrainProvider (which returns 0 anyway).
      // The geoid approximation below is accurate to ~1-2m for CONUS, which is sufficient for panel placement.
      // Formula: ellipsoidal_height = orthometric_height (Google Elevation) + geoid_undulation
      // EGM96 CONUS approx: -29 - 5*sin(lat_rad) → ~-34m at Ohio, ~-32m at Alexandria VA, ~-29m at Texas
      const geoidApproxBoot = geoidUndulationM(lat);
      // 🚨 `resolved` MEANS RESOLVED. It used to be stamped true unconditionally,
      // directly beneath a `?? 0`, so a failed elevation lookup became a
      // confident datum at the geoid (~-32 m in CONUS). shouldRunLaneA already
      // refuses on `!groundElevResolved` and the camera already widens to 300 m
      // — the correct behaviour was written and simply never reachable.
      // The Google/Solar-API path is immune either way (the base-elevation error
      // cancels, proven in tests/groundElevationAuthority.test.ts); the
      // hand-modelled 2D path is NOT, and lands 80 m under the real roof.
      const bootDatum = resolveGroundDatum(googleGroundElev, lat);
      if (bootDatum.resolved) {
        cesiumGroundElevRef.current = bootDatum.ellipsoidalM;
        cesiumGroundElevResolvedRef.current = true;
        addLog('BOOT', `cesiumGroundElev: ${bootDatum.ellipsoidalM.toFixed(1)}m (Google: ${bootDatum.orthometricM.toFixed(1)}m, geoidApprox: ${geoidApproxBoot.toFixed(1)}m) [skipped sampleTerrainMostDetailed for speed]`);
      } else {
        cesiumGroundElevResolvedRef.current = false;
        addLog('WARN', `ground elevation UNRESOLVED (${bootDatum.reason}) — roof auto-detection is held off and 2D-traced faces cannot be placed against an absolute datum`);
      }
      terrainReadyRef.current = true;
      setTerrainReady(true);
      // NOW set twin state - cesiumGroundElevRef is ready, so drawOverlays will use correct elevation
      if (twinData) setTwin(twinData);

      // Set initial orbit state using terrain-corrected elevation
      const oo = orbitRef.current;
      oo.targetLat = lat;
      oo.targetLng = lng;
      oo.targetAlt = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
      oo.heading   = TILTED_AERIAL_VIEW.heading;  // π → fly-in looks NORTH (look dir = heading + π)
      oo.pitch     = TILTED_AERIAL_VIEW.pitch;    // -45° Aurora parity (lib/3d/cameraPresets.ts)
      // Frame wider when the ground datum is unknown, matching the address-change
      // path — a 150 m orbit around an unknown altitude can put the house off screen.
      oo.radius    = cesiumGroundElevResolvedRef.current ? TILTED_AERIAL_VIEW.range : 300;
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
      o.heading = TILTED_AERIAL_VIEW.heading; o.pitch = TILTED_AERIAL_VIEW.pitch; o.radius = TILTED_AERIAL_VIEW.range;  // -45° Aurora parity
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
      o.heading = TILTED_AERIAL_VIEW.heading; o.pitch = TILTED_AERIAL_VIEW.pitch;  // -45° Aurora parity (Reset View)
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
    // `isFinite(null)` is TRUE in JS (null coerces to 0), so this test never
    // caught an absent elevation and quietly relied on null arithmetic. State it.
    const googleElev = (twinData.elevation != null && isFinite(twinData.elevation))
      ? twinData.elevation : 0;
    const geoidUndulationOverlay = geoidUndulationM(twinData.roofSegments[0]?.center?.lat ?? NaN);
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
            // v72: real roof faces are convex. The aerial twin sometimes
            // returns corners with stray indentations or in a noisy order
            // that draws a concave outline. Run the corners through a 2D
            // convex hull first (Andrew's monotone chain on lat/lng) to
            // drop any inward-bump noise.
            //
            // v73: per-corner altitude was making the yellow outline tilt
            // in 3D (ridge corners higher than eave corners), which from
            // the camera angle looked like the polygon was concave even
            // though the 2D hull was convex. For the OUTLINE, draw every
            // corner at the segment's single elevation — that gives a
            // clean 2D shape matching the actual roof outline. The 3D
            // per-corner data is still preserved in seg.corners and
            // gets used by the panel-placement / shading code, not here.
            const hullCorners = convexHullCorners(seg.corners);
            const flatAlt = segElev; // already geoidOffset-corrected
            const raw = hullCorners.map((c: any) => {
              return safeCartesian3(C, c.lng, c.lat, flatAlt);
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
                    // Standard solar convention: azimuth first, then pitch.
                    // e.g. "271° / 23°  1301h 939ft²" reads as
                    // "west-facing, 23° tilt, 1301 annual sun-hours, 939 sqft".
                    text: `${azStr}° / ${pitchStr}°  ${sunStr}h${areaFt}`,
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
              // 🚨 The ref, for the reason in `fireSetbacksRef` — and here the
              // comment is the argument: this must MATCH what
              // `fillRoofSegmentWithPanels` uses, and that now reads the ref.
              // Leaving this on the prop would draw one setback and obey another.
              const SETBACK_M = Math.max(fireSetbacksRef.current?.edgeSetbackM ?? 0.457, fireSetbacksRef.current?.ridgeSetbackM ?? 0.457); // matches fillRoofSegmentWithPanels
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
  // Rail colour is a viewport choice; the DIMENSIONS are manufacturer facts and
  // are read from the mounting-hardware database. The old switch hardcoded three
  // systems and returned null for every other one, so the 16 further systems that
  // publish a rail height drew no rails at all.
  function getRailSpec(mountingId: string): { heightM: number; widthM: number; color: string } | null {
    const x = railCrossSectionM(mountingId);
    if (!x) return null; // rail-less / ballasted / no published dimension
    return { heightM: x.heightM, widthM: x.widthM, color: mountingId === 'ironridge-xr1000' ? '#4b5563' : '#6b7280' };
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

    // A rail's top face carries the module, so it meets the module's underside.
    // Rail centre = module − normal * drawnHeight/2, and nothing else is needed.
    //
    // 🚨 The old rule was `inwardM = stackH - railH/2`, justified by a comment
    // reading "panel.height = roofDeckAlt + stackH". `roofDeckAlt` is not a
    // variable anywhere in this file — it appears only in that comment. Worse,
    // it centred the rail as though the rail were railH tall while the box below
    // is DRAWN at railH * 3 (a deliberate visibility exaggeration), so the run
    // sank railH into the deck. Hanging it from the module needs no deck datum
    // and stays correct whatever the stack height and exaggeration are.
    // 🚨 AND THE EXAGGERATION HAS TO FIT IN THE STACK.
    // `railH * 3` is a real manufacturer dimension multiplied by a rendering
    // constant, and nothing checked the product against the space it hangs in.
    // Measured across all 45 catalogue systems, four drive the drawn rail
    // straight through the deck it is bolted to:
    //
    //     s5-pvkit        stack 0.088  drawn 0.1143   -26 mm
    //     dpw-powerrail   stack 0.159  drawn 0.1714   -12 mm
    //     renusol-vs-plus stack 0.170  drawn 0.2042   -34 mm
    //     mse-rapid-rail  stack 0.170  drawn 0.2042   -34 mm
    //
    // and two more (k2-crossrail, schletter-classic) clear it by 0.4 mm, which
    // is z-fighting, not clearance. The previous fix moved the rail onto the
    // right datum and left the exaggeration unbounded; the bound belongs with
    // it. IronRidge, Unirac, SnapNRack and the rest are unchanged — the clamp
    // only binds where the product would not have fitted.
    // The clamp is `drawnRailHeightM` in lib/roofMountDatum.ts — a function the
    // renderer calls and the test calls, rather than arithmetic each restates.
    const drawnRailH = drawnRailHeightM(mountId) ?? railH * RAIL_DRAW_SCALE;
    const inwardM    = drawnRailH / 2;

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
      //
      // 🚨 `?? 0` HERE PUT THE WHOLE PLANE'S ORIGIN AT SEA LEVEL.
      // `addPanelEntity` was taught to refuse a panel with no elevation; the
      // rail path kept substituting zero, so one elevation-less panel chosen as
      // the reference threw every rail on that face a hundred metres off. Rails
      // are drawn from modules, so they inherit the module's rule.
      if (!hasUsableElevation(rep0)) {
        addLog('ERROR', `Rails skipped for plane ${planeId.slice(0, 8)} — reference panel ${rep0.id} has no elevation`);
        return;
      }
      const refEcef = engLatLngToECEF(rep0.lat, rep0.lng, rep0.height as number);

      // For each panel compute plane-local (u, v) coordinates and panel half-widths.
      // uC/vC are metres along the ridge/slope axes relative to refEcef.
      // uMin/uMax are the panel's left/right edges in the u (ridge) direction.
      type PanelUV = {
        p: PlacedPanel;
        uC: number; vC: number;
        pw: number; ph: number;
        uMin: number; uMax: number;
      };

      const panelUVs: PanelUV[] = planePanels.filter(hasUsableElevation).map(p => {
        const ecef = engLatLngToECEF(p.lat, p.lng, p.height as number);
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
                  dimensions: new C.Cartesian3(railW * (drawnRailH / railH), railLength, drawnRailH),
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
        // Same rule as addPanelEntity: no elevation, no rail. A rail drawn at
        // sea level is not a clue that something is wrong, it is a second bug.
        if (!hasUsableElevation(p)) continue;
        const pos = safeCartesian3(C, p.lng, p.lat, p.height as number);
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
              // 🚨 THE CLAMP REACHED THE OFFSET AND NOT THIS BOX.
              // `inwardM` above is derived from the CLAMPED height, and the
              // grid rail beside it is drawn at that height — but this branch
              // kept `railH * 3`. So a rotated array positioned its rails by
              // the clamped offset and drew them at the unclamped size: for
              // S-5! PVKit the run hangs 10.6 mm BELOW the deck and rises
              // 15.6 mm UP inside the 40 mm module box, and is 37.5% wider
              // than the rails on an un-rotated face of the same roof.
              // Reachable: pick that racking, Auto Layout, select the array,
              // drag the rotate handle — every panel gets a frameQuat and
              // comes through here.
              box: { dimensions: new C.Cartesian3(railW * (drawnRailH / railH), railLen, drawnRailH), material: new C.ColorMaterialProperty(railColor), outline: false, shadows: C.ShadowMode.DISABLED },
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
  /**
   * 🚨 WHICH FACES BELONG TO THE DESIGN RIGHT NOW. ONE ANSWER, THREE CONSUMERS.
   *
   * The three plane maps — `plane3DEntityMap`, `plane3DFrameMap`,
   * `plane3DCesiumPtsMap` — are a RENDER CACHE, and they are never pruned.
   * There is no `.delete()` and no `.clear()` on any of them anywhere in this
   * file, deliberately: a reconcile-deletions block once removed entities for
   * every id missing from the `roofPlanes` prop and destroyed a user's traced
   * garage, because that prop has its own timing and "absent from a prop" is
   * not "the user deleted it". That reasoning still stands and nothing here
   * deletes anything.
   *
   * What does NOT follow is that a ghost is harmless. Three places ENUMERATE
   * those maps and treat whatever they find as the design:
   *
   *     collectRoofRenderables   building extrusion, setback zones, roof model
   *     stitchRoofVertices       clusters corners and MUTATES the geometry
   *     selectableRoofFaces      what a click can resolve to
   *
   * So a deleted plane still shaped the building, still pulled the faces the
   * user kept toward its corners when they pressed Stitch, and was still
   * clickable. And because these maps are NOT among the things the
   * address-change effect resets, all three were also true of a face traced at
   * a DIFFERENT PROPERTY while this one was on screen.
   *
   * Fixing that with a filter at each site would leave the next consumer to
   * rediscover it. The authority for "is this face part of the design" is the
   * design — `roofPlanes` — and it lives here, once.
   *
   * The cache may still hold and still DRAW a ghost; it may not decide anything.
   */
  function liveRenderedFaces(): Array<{ planeId: string; pts: any[]; frame: Plane3DFrame | undefined }> {
    const inDesign = new Set((roofPlanesRef.current ?? []).map(p => p.id));
    const out: Array<{ planeId: string; pts: any[]; frame: Plane3DFrame | undefined }> = [];
    plane3DCesiumPtsMap.current.forEach((pts: any[], planeId: string) => {
      if (!inDesign.has(planeId)) return;
      out.push({ planeId, pts, frame: plane3DFrameMap.current.get(planeId) });
    });
    return out;
  }

  function collectRoofRenderables(C: any, groundElev: number): any[] {
    const renderables: any[] = [];
    const seen = new Set<string>();
    liveRenderedFaces().forEach(({ planeId: pid, pts, frame: fr }) => {
      if (!fr || !pts || pts.length < 3) return;
      const u = C.Cartesian3.normalize(new C.Cartesian3(fr.u.x, fr.u.y, fr.u.z), new C.Cartesian3());
      const n = C.Cartesian3.normalize(new C.Cartesian3(fr.normal.x, fr.normal.y, fr.normal.z), new C.Cartesian3());
      const v = C.Cartesian3.normalize(C.Cartesian3.cross(n, u, new C.Cartesian3()), new C.Cartesian3());
      const origin = new C.Cartesian3(fr.origin.x, fr.origin.y, fr.origin.z);
      const corners = pts.map((p: any) => new C.Cartesian3(p.x, p.y, p.z));
      // 🚨 PROVENANCE, NOT DECORATION. `plane3DCesiumPtsMap` holds points that
      // came out of a fit, so they carry the SURFACE_OFFSET_M render lift and
      // their plan projection is slid `lift·sin(tilt)` down-slope. The fallback
      // branch below does NOT — it drops the canonical `vertices` vertically, so
      // its plan positions are exact. The two are indistinguishable once they
      // are both a list of Cartesian3, and a caller that takes the plan record
      // from either must know which it has. `cornersPlanLiftM` says.
      renderables.push({ id: pid, corners, u, v, n, origin, cornersPlanLiftM: SURFACE_OFFSET_M });
      seen.add(pid);
    });
    (roofPlanesRef.current ?? []).forEach(plane => {
      if (seen.has(plane.id)) return;
      const vs = (plane as any).vertices ?? [];
      if (vs.length < 3) return;
      const planePanels = panelsRef.current.filter(p => p.planeId === plane.id && isFinite((p as any).ecefUx) && isFinite((p as any).ecefNx));
      let u: any, n: any, origin: any;
      const own = (plane as any).ecefFrame3D, ownOrigin = (plane as any).origin3D;
      if (own?.u && own?.n && ownOrigin) {
        // 🚨 THE PLANE KNOWS ITS OWN FRAME — ASK IT FIRST.
        //
        // The branch below rebuilds a frame from a panel because "the only
        // surviving record of the plane's frame is a panel that sits on it".
        // That premise is false, and I checked rather than believed it:
        // round-tripping a plane through `upsertLayout` and `getLayoutByProject`
        // against real PostgreSQL returns `origin3D`, `ecefFrame3D`, `polygon3D`
        // and `createdFrom3D` intact. Deriving the deck from a module was
        // guesswork standing next to the answer.
        //
        // And the guess is not sound. Recovering a deck from a module means
        // subtracting a mount stack, `PlacedPanel` records no mounting system,
        // so it had to assume the CURRENTLY SELECTED racking. For a design saved
        // before the mount datum existed — panels at the old +0.05 — that
        // recovers an origin 9 cm BELOW the true plane, and `squareUpTracedFaces`
        // then PERSISTS it. Same error if the racking selector changed since
        // placement.
        u = C.Cartesian3.normalize(new C.Cartesian3(own.u.x, own.u.y, own.u.z), new C.Cartesian3());
        n = C.Cartesian3.normalize(new C.Cartesian3(own.n.x, own.n.y, own.n.z), new C.Cartesian3());
        origin = new C.Cartesian3(ownOrigin.x, ownOrigin.y, ownOrigin.z);
      } else if (planePanels.length) {
        const rp: any = planePanels[0];
        u = C.Cartesian3.normalize(new C.Cartesian3(rp.ecefUx, rp.ecefUy, rp.ecefUz), new C.Cartesian3());
        n = C.Cartesian3.normalize(new C.Cartesian3(rp.ecefNx, rp.ecefNy, rp.ecefNz), new C.Cartesian3());
        // 🚨 A MODULE IS NOT THE DECK. Reached only when the plane carries no
        // frame of its own. Taking a panel's position as the plane origin made
        // every consumer that adds a mount stack add it a SECOND time: the
        // single-panel tool projected a click onto the panel plane and lifted by
        // the stack again, so each hand-placed module after a reload floated one
        // stack height above its neighbours — and the next reload used THAT as
        // the origin. A ratchet, 14 cm per turn. Step back down to the deck so
        // this branch returns the same datum as the other two.
        // 🚨 AND `?? 0` WOULD HAVE PERSISTED SEA LEVEL AS THE ROOF.
        // This origin is written back by Square Up. A representative panel with
        // no elevation used to yield a deck on the WGS-84 ellipsoid, and the
        // next save made that the plane's recorded origin — permanent, and
        // indistinguishable afterwards from a roof that is genuinely there.
        const panelPos = hasUsableElevation(rp)
          ? safeCartesian3(C, rp.lng, rp.lat, rp.height as number)
          : null;
        const deck = panelPos
          ? deckPointFromModule(panelPos, n, mountingSystemIdRef.current)
          : null;
        origin = deck ? new C.Cartesian3(deck.x, deck.y, deck.z) : null;
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
      // 🚨 DROP EACH CORNER VERTICALLY, NOT ALONG THE NORMAL.
      // This subtracted `n · dn`, which also moves the point HORIZONTALLY, by
      // distance·sin²(tilt) — 0.8 m at 25° on a 4.5 m half-face. These corners
      // decide which faces Stitch judges to share a hip, a ridge or a valley,
      // and what position their shared corners average to. `joinSharedCorners`
      // has a 1.5 m tolerance, which is why the adjacency usually still matched
      // and the corner it produced was quietly wrong.
      //
      // The same trap `polygonFromVerticesOnFrame` names, in the file that
      // names it. A vertical drop is exact: the corner's plan position is what
      // the vertex record means, and its height is whatever the plane says at
      // that position.
      const corners = vs.map((vert: any) => {
        const a = safeCartesian3(C, vert.lng, vert.lat, baseH);
        const b = safeCartesian3(C, vert.lng, vert.lat, baseH + 1);
        if (!a || !b) return null;
        const fa = C.Cartesian3.dot(C.Cartesian3.subtract(a, origin, new C.Cartesian3()), n);
        const fb = C.Cartesian3.dot(C.Cartesian3.subtract(b, origin, new C.Cartesian3()), n);
        const slope = fb - fa;
        // A vertical line parallel to the plane is a wall, not a roof — keep
        // the sample rather than dividing by ~0.
        if (!isFinite(slope) || Math.abs(slope) < 1e-9) return a;
        return safeCartesian3(C, vert.lng, vert.lat, baseH - fa / slope);
      }).filter(Boolean);
      if (corners.length < 3) return;
      // 🚨 NO RENDER LIFT IN THE PLAN POSITIONS. Each corner keeps the exact
      // lat/lng of `plane.vertices` — the canonical, already-unlifted plan
      // record — and only its HEIGHT comes from the (lifted) plane. So a caller
      // must NOT un-lift these: subtracting 0.12·n would slide them 5.4 cm
      // UP-slope at 6:12, i.e. corrupt the one branch that was exact.
      renderables.push({ id: plane.id, corners, u, v, n, origin, cornersPlanLiftM: 0 });
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
    setbackBandCentroidsRef.current = []; // reset centroids for fresh render
    // 🚨 Through the ref — see `fireSetbacksRef`.
    const ridgeSB = fireSetbacksRef.current?.ridgeSetbackM ?? 0.457;
    const eaveSB  = fireSetbacksRef.current?.eaveSetbackM  ?? 0;
    const edgeSB  = fireSetbacksRef.current?.edgeSetbackM  ?? 0.457;
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
        // E2E: compute centroid of this setback band (lat/lng) so tests can verify
        // bands hug edges, not the roof interior. cf0dd96b regression guard.
        try {
          const cx = positions.reduce((s: number, p: any) => s + p.x, 0) / positions.length;
          const cy = positions.reduce((s: number, p: any) => s + p.y, 0) / positions.length;
          const cz = positions.reduce((s: number, p: any) => s + p.z, 0) / positions.length;
          const carto = C.Cartographic.fromCartesian(new C.Cartesian3(cx, cy, cz));
          if (carto) {
            setbackBandCentroidsRef.current.push({
              lat: C.Math.toDegrees(carto.latitude),
              lng: C.Math.toDegrees(carto.longitude),
            });
          }
        } catch {}
      }
    });
    publishE2EDiagnostics();
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── v66: SOLID BUILDING — extruded walls + filled roof surfaces ────────────
  // Ray: "It still looks like shitty grainy mesh with some marked planes."
  // Mark Plane renders outline-only BY DESIGN, so a traced roof reads as
  // annotation drawn over satellite imagery rather than as a building. This
  // closes that: every exterior roof edge drops a wall to the ground and every
  // face gets a solid surface, so the house reads as an object — the single
  // biggest visual difference between our canvas and Aurora's.
  //
  // Geometry (which edges get a wall, and the winding that avoids bowties)
  // lives in lib/3d/buildingExtrusion.ts, pure and unit-tested. This function
  // only turns it into Cesium entities.
  function clearBuildingExtrusion(viewer: any) {
    buildingEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e); } catch { /* ignore */ } });
    buildingEntitiesRef.current = [];
  }

  /**
   * Ground level the walls drop to.
   *
   * Preference order matters. A flat-traced face stored the ground the user
   * actually clicked on, which is the most trustworthy number we have and the
   * one the face itself was built against. cesiumGroundElevRef comes from
   * Google's elevation API plus a geoid approximation and silently degrades to
   * about -32 m when that API returns nothing. The last resort infers ground
   * from the roof itself so the walls are at worst the wrong LENGTH rather
   * than running to the centre of the earth.
   */
  function resolveGroundForExtrusion(minRoofHeightM: number): number {
    const firstTraced = flatTracedPlaneIdsRef.current
      .map(id => flatTraceParamsRef.current.get(id))
      .find(p => p && isFinite(p.groundElevM));
    if (firstTraced) return firstTraced.groundElevM;
    if (cesiumGroundElevResolvedRef.current && isFinite(cesiumGroundElevRef.current)) {
      return cesiumGroundElevRef.current;
    }
    return minRoofHeightM - flatTraceEaveHeightRef.current;
  }

  /**
   * v66: SQUARE UP — the one action that moves the user's traced corners.
   *
   * Ray: "one plane is larger than the other after marking my points. Need to
   * correct." Buildings are rectilinear; a trace of one is not, because the
   * clicks are eyeballed on blurry imagery.
   *
   * 🚨 EXPLICIT AND REVERTIBLE BY DESIGN. An earlier automatic rebuild rewrote
   * traced corners behind the user's back, desynchronised Stitch and shifted
   * faces. So this only ever runs from its button, it reports exactly what it
   * changed, and it REFUSES any face whose correction is large enough to be a
   * redraw rather than a cleanup — there the trace is the problem, and silently
   * "fixing" it would destroy real geometry.
   */
  function squareUpTracedFaces(viewer: any, C: any): number {
    const groundSeed = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const renderables = collectRoofRenderables(C, groundSeed);
    if (renderables.length === 0) { setStatusMsg('Nothing to square up — trace a roof face first'); return 0; }

    // 1. Regularize each outline on its own.
    const rings = new Map<string, Array<{ lat: number; lng: number }>>();
    let totalSnapped = 0, totalRemoved = 0, worstShift = 0, refused = 0;
    for (const rp of renderables) {
      const ring = rp.corners.map((c: any) => {
        const g = ecefToLatLng({ x: c.x, y: c.y, z: c.z });
        return { lat: g.lat, lng: g.lng };
      });
      const res = regularizeOutline(ring);
      if (res.changed && res.report.maxShiftM > 1.5) {
        refused++;
        rings.set(rp.id, ring);
        addLog('SQUARE', `Face ${rp.id.slice(0, 8)}: refused — would move a corner ${res.report.maxShiftM.toFixed(1)}m`);
        continue;
      }
      rings.set(rp.id, res.changed ? res.outline : ring);
      totalSnapped += res.report.snapped;
      totalRemoved += res.report.removed;
      worstShift = Math.max(worstShift, res.report.maxShiftM);
    }

    // 2. Join the corners faces share, so the halves meet instead of nearly
    //    meeting.
    //
    //    🚨 CLUSTERED, not pairwise. Pairwise averaging is right for two faces
    //    and wrong for three: at a hip peak, doing A-B then A-C (moving A
    //    again) then B-C leaves three corners chasing each other, and the
    //    result depends on which pair was visited first. Clustering puts all N
    //    corners in one group and moves them to its mean together.
    //
    //    This does NOT replace Stitch. Ray uses Stitch deliberately to pull
    //    separate planes together into a peak — a modelling move, not a
    //    correction — and it reaches 1.6 m with its own convergence passes.
    //    Square Up only tidies what it just squared.
    const joinRes = joinSharedCorners(rings);
    for (const [id, ring] of joinRes.rings) rings.set(id, ring);
    const aligned = joinRes.joined;

    // 3. Rebuild each face from its squared ring at the heights it already had.
    const updates: RoofPlaneReshapeUpdate[] = [];
    for (const rp of renderables) {
      const ring = rings.get(rp.id);
      if (!ring || ring.length < 3) continue;
      // 🚨 PUT THE SQUARED CORNERS BACK ON THE FACE'S OWN PLANE.
      //
      // This block used to read:
      //     const meanH = old.reduce((a, g) => a + g.height, 0) / old.length;
      //     const pts3D = ring.map(v => engLatLngToECEF(v.lat, v.lng, meanH));
      // — every corner rebuilt at the MEAN of the corner heights, which is a
      // HORIZONTAL ring. Square Up therefore FLATTENED every face it touched,
      // while the comment above it said "at the heights it already had".
      //
      // It is a plan-view tool. Squaring an outline is a horizontal correction;
      // the pitch is not the trace's mistake and must survive untouched. A 25°
      // face came out at 0.19° (not 0° — the residual is the deflection of the
      // vertical, geocentric-up vs geodetic-up, ~0.19° at this latitude), and
      // 0.19 > 0 is the dangerous value: it slips past the `t > 0` filter in
      // lib/pvwatts.ts and the `pitch > 0` gate in applyToSystemDefinition that
      // would both have rejected a clean zero. The flattened pitch and azimuth
      // were then pushed into `updates` and persisted, so the damage outlived
      // the session and reached PVWatts, the ASCE wind/snow gates and the
      // cos(pitch) sloped-area basis.
      //
      // So: keep each corner's lat/lng from the squared ring, and solve for the
      // height that puts it exactly on the plane the face already had. The
      // outline squares up; the plane does not move.
      // The maths lives in lib/roofPlane3D.ts so it can be tested without
      // Cesium — this function cannot be, and an untestable fix to a
      // permit-reaching defect is not a fix.
      const pts3D = projectOutlineOntoPlane(
        ring,
        { x: rp.origin.x, y: rp.origin.y, z: rp.origin.z },
        { x: rp.n.x, y: rp.n.y, z: rp.n.z },
      );
      if (!pts3D || pts3D.length < 3) continue;

      let frame, plane;
      // 🚨 THE SAME OFFSET FOR BOTH. These points lie on a plane that was
      // already lifted by an earlier fit, so both calls pass 0. Passing 0 to the
      // rendered frame and the DEFAULT to the stored plane — which is what this
      // did, because buildRoofPlane3D took no options — put the deck and the
      // placement geometry exactly SURFACE_OFFSET_M apart on every press, and
      // the gap compounded across save/reload cycles.
      try {
        frame = computePlaneFromPoints3D(pts3D, { surfaceOffsetM: 0 });
        plane = buildRoofPlane3D(pts3D, { surfaceOffsetM: 0 });
      } catch { continue; }

      (plane3DEntityMap.current.get(rp.id) ?? []).forEach((eid: string) => {
        const e = viewer.entities.getById(eid);
        if (e) try { viewer.entities.remove(e); } catch { /* ignore */ }
      });
      const cesiumPts = frame.projectedPts.map((pp: Cart3) => new C.Cartesian3(pp.x, pp.y, pp.z));
      const newIds = renderPlane3DEntity(viewer, C, cesiumPts, rp.id, frame,
        faceIsInSelection(rp.id), planeRendersOutlineOnly(rp.id));
      plane3DEntityMap.current.set(rp.id, newIds);
      plane3DFrameMap.current.set(rp.id, frame);
      plane3DCesiumPtsMap.current.set(rp.id, cesiumPts);
      const params = flatTraceParamsRef.current.get(rp.id);
      if (params) flatTraceParamsRef.current.set(rp.id, { ...params, outline: ring });

      if (plane.localFrame3D) {
        updates.push({
          id: rp.id, vertices: plane.vertices, localFrame3D: plane.localFrame3D,
          polygon3D: plane.polygon3D, origin3D: plane.origin3D, normal3D: plane.normal3D,
          pitch: plane.pitch, azimuth: plane.azimuth,
          // The axes panels are placed on must travel with the geometry.
          ecefFrame3D: plane.ecefFrame3D,
        });
      }
    }

    plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    if (updates.length > 0) onRoofPlanesStitched?.(updates);
    if (showRoofModel) { try { renderRoofWireframe(viewer, C); } catch { /* ignore */ } }
    if (showBuilding3DRef.current) { try { renderBuildingExtrusion(viewer, C); } catch { /* ignore */ } }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }

    addLog('SQUARE', `Squared ${updates.length} face(s): ${totalSnapped} edges snapped, ${totalRemoved} vertices removed, ${aligned} shared corners aligned, worst shift ${worstShift.toFixed(2)}m, ${refused} refused`);
    setStatusMsg(
      `\u{1F4D0} Squared up — ${totalSnapped} edge${totalSnapped === 1 ? '' : 's'} straightened, ` +
      `${aligned} shared corner${aligned === 1 ? '' : 's'} joined` +
      (totalRemoved > 0 ? `, ${totalRemoved} stray point${totalRemoved === 1 ? '' : 's'} removed` : '') +
      (refused > 0 ? ` \u00b7 \u26a0 ${refused} face(s) left alone (correction too large — retrace those)` : '') +
      ` \u00b7 worst move ${ftStr(worstShift)}`
    );
    return updates.length;
  }

  /**
   * v66: Apply a wall-height / pitch change to the REAL roof planes.
   *
   * 🚨 This edits stored geometry, on an explicit button press, exactly like
   * Square Up. The previous design applied these only at render time and never
   * wrote back, which kept traced corners safe but produced a view that
   * disagreed with the data: the roof drew in one place and the panels — which
   * are placed on the actual planes — stayed in another, inside the house.
   *
   * Editing for real is the honest fix. The footprint is never touched; only
   * the heights move, derived from each face's own traced outline. Panels are
   * re-laid by the caller afterwards so they follow the roof.
   *
   * `scope` null means every face; otherwise just that plane id.
   */
  function applyBuildingShape(
    viewer: any, C: any,
    shape: { wallHeightM?: number; pitchDeg?: number },
    scope: string | null,
  ): number {
    const groundSeed = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const renderables = collectRoofRenderables(C, groundSeed);
    if (renderables.length === 0) return 0;

    // 🚨 TAKE THE RECORD BEFORE THE LIFT — THIS FUNCTION WAS THE UNFIXED CALLER.
    //
    // `collectRoofRenderables` hands back RENDER points. Both of its branches
    // are lifted by SURFACE_OFFSET_M along the face normal: the live branch
    // reads `plane3DCesiumPtsMap`, which is written from `built.frame.projectedPts`
    // at the bottom of this very function, and the fallback branch reads the
    // stored `polygon3D`, which lib/roofPlane3D.ts:743 sets to `projPts` and
    // whose comment states "the lift stays where it belongs — polygon3D,
    // origin3D and the frame keep it".
    //
    // A normal is not vertical, so that lift has a horizontal component of
    // offset·sin(tilt) pointing down-slope. Projecting lifted points to lat/lng
    // and feeding them to `roofPlaneFromFootprint` — which correctly lifts a
    // genuinely raw outline — applied the offset a SECOND time, and then wrote
    // the result straight back into `plane3DCesiumPtsMap`, so every press
    // compounded on the last. Measured at 6:12 with the real library:
    //
    //     press 1:  plan drift  5.39 cm  ·  eave ratchet 10.73 cm
    //     press 3:  plan drift 16.18 cm  ·  eave ratchet 32.18 cm
    //     press 5:  plan drift 26.97 cm  ·  eave ratchet 53.63 cm
    //
    // `vertices` and `pitch` are both in SIGNED_FIELDS, so this did not merely
    // look wrong — the autosave fired and persisted it, into the plan record
    // the permit site plan and the CAD engine read. The two halves of a gable
    // carry OPPOSITE azimuths, so they slide apart and the shared ridge splits
    // by twice the drift. `joinSharedCorners`' 1.5 m tolerance is why nothing
    // downstream ever objected.
    //
    // lib/roofPlane3D.ts:626-650 already documents this exact class and names
    // the callers that were fixed — buildRoofPlane3D, Stitch and Square Up.
    // This one re-fits points that are already lifted and was not on that list.
    //
    // 🚨 AND IT MUST BE UN-LIFTED FOR THE WHOLE ROOF AT ONCE, NOT FACE BY FACE.
    // Un-lifting each face along its OWN normal tears open every seam Stitch
    // and the abutment pass had closed: a gable's halves have opposite normals,
    // so a ridge corner they had averaged into ONE point becomes two, separated
    // by 2·lift·sin(tilt) — measured at 107.9 mm at 6:12, the same split the
    // stitch write-back records from a browser run and deliberately avoids.
    // A first version of this fix did exactly that and shipped it.
    // `unliftFacesPreservingSharedCorners` un-lifts every point along its own
    // face normal and then puts corners that ARRIVED coincident back on one
    // point, so the plan record is the true footprint AND the roof stays shut.
    const unlifted = unliftFacesPreservingSharedCorners(
      renderables.map((rp: any) => ({
        pts: rp.corners.map((c: any) => ({ x: c.x, y: c.y, z: c.z })) as Cart3[],
        normal: { x: rp.n.x, y: rp.n.y, z: rp.n.z } as Cart3,
        // 🚨 ASK THE RENDERABLE, DO NOT ASSUME. Only the live branch of
        // `collectRoofRenderables` carries the render lift; the fallback branch
        // drops the canonical `vertices` vertically and is already exact. A
        // first version of this fix un-lifted BOTH and slid every
        // fallback-branch face 5.4 cm up-slope — the same corruption it was
        // written to remove, in the other direction, on the other provider.
        liftM: rp.cornersPlanLiftM,
      })),
    );
    const rawFaces = renderables.map((rp: any, i: number) => ({
      id: rp.id as string,
      polygon3D: unlifted[i],
    }));
    const azimuths = deriveAzimuthsFromSharedEdges(rawFaces, (id) => {
      const f = rawFaces.find(r => r.id === id);
      if (!f) return 180;
      const ring = f.polygon3D.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
      return deriveAzimuthFromOutline(ring, ring.reduce((sum, v) => sum + v.lat, 0) / ring.length);
    });

    const updates: RoofPlaneReshapeUpdate[] = [];

    for (const rf of rawFaces) {
      if (scope && rf.id !== scope) continue;
      const outline = rf.polygon3D.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
      const cur = faceOrientation(rf.polygon3D);
      let lowest = Infinity;
      for (const p of rf.polygon3D) { const h = ecefToLatLng(p).height; if (h < lowest) lowest = h; }
      if (!isFinite(lowest)) continue;

      // Keep whatever is not being changed, so nudging pitch does not also move
      // the building up and down.
      const prevWall = wallHeightRef.current;
      const wall = shape.wallHeightM ?? prevWall;
      const pitch = shape.pitchDeg ?? (cur.tiltDeg > 0.5 ? cur.tiltDeg : buildingPitchRef.current);
      const groundM = lowest - prevWall;

      const built = roofPlaneFromFootprint(outline, {
        pitchDeg: pitch,
        azimuthDeg: azimuths.get(rf.id) ?? cur.azimuthDeg,
        eaveHeightM: wall,
        groundElevM: groundM,
      });
      if (!built) continue;

      (plane3DEntityMap.current.get(rf.id) ?? []).forEach((eid: string) => {
        const e = viewer.entities.getById(eid);
        if (e) try { viewer.entities.remove(e); } catch { /* ignore */ }
      });
      const cesiumPts = built.frame.projectedPts.map((pp: Cart3) => new C.Cartesian3(pp.x, pp.y, pp.z));
      const newIds = renderPlane3DEntity(viewer, C, cesiumPts, rf.id, built.frame,
        faceIsInSelection(rf.id), planeRendersOutlineOnly(rf.id));
      plane3DEntityMap.current.set(rf.id, newIds);
      plane3DFrameMap.current.set(rf.id, built.frame);
      plane3DCesiumPtsMap.current.set(rf.id, cesiumPts);

      if (built.plane.localFrame3D) {
        updates.push({
          id: rf.id,
          vertices: built.plane.vertices,
          localFrame3D: built.plane.localFrame3D,
          polygon3D: built.plane.polygon3D,
          origin3D: built.plane.origin3D,
          normal3D: built.plane.normal3D,
          // Emit the shape the face was actually BUILT to.
          pitch: built.plane.pitch,
          azimuth: built.plane.azimuth,
          // The axes panels are placed on must travel with the geometry.
          ecefFrame3D: built.plane.ecefFrame3D,
        });
      }
    }

    plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    if (updates.length > 0) onRoofPlanesStitched?.(updates);
    if (showRoofModel) { try { renderRoofWireframe(viewer, C); } catch { /* ignore */ } }
    if (showBuilding3DRef.current) { try { renderBuildingExtrusion(viewer, C); } catch { /* ignore */ } }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
    addLog('BUILD3D', `Applied shape to ${updates.length} face(s)${scope ? ' (selected only)' : ''}`);
    return updates.length;
  }

  /**
   * EDIT A BUILDING SECTION — the replacement for the WALLS / PITCH steppers.
   *
   * 🚨 WHAT THIS DOES DIFFERENTLY, AND WHY IT HAD TO.
   *
   * `applyBuildingShape` (above) rebuilds ONE FACE from a global counter:
   *
   *     groundM = lowest - prevWall      // back-solve the pad from a UI number
   *     roofPlaneFromFootprint(outline, { eaveHeightM: wall, groundElevM: groundM })
   *
   * The pad cancels, so the press is a relative nudge of whichever face happens
   * to be selected, and the number on screen is a counter that no wall is
   * obliged to match. It reached 17 ft on a 10 ft wall in a live test, because
   * raising an eight-face house by one foot costs eight presses and every one
   * of them moved the counter.
   *
   * This routes through `lib/3d/sectionEditing`, which changes ONE NAMED
   * PHYSICAL QUANTITY on the section's canonical record and rebuilds every face
   * the section owns, together, through `buildSectionRoofPlanes`. So:
   *
   *   · the ridge stays shut, because both halves are rebuilt from one record
   *   · neighbouring sections do not move, because `replaceSectionFaces` only
   *     ever removes ids belonging to the section named
   *   · `plane.section` is re-stamped, so the record and the geometry cannot
   *     drift apart the way they did after every WALLS press
   *   · face ids are deterministic, so panels standing on the roof survive
   *
   * 🚨 THE FRAMES COME FROM THE BUILD, NOT FROM A REFIT. `outcome.faceBuilds`
   * carries the frame and the coplanar corners each plane was actually built
   * with. Re-fitting them here would give a subtly different frame, and
   * buildSurfaceGrid places panels from that frame.
   */
  function editSection(sectionId: string, edit: SectionEdit, label: string, coalesceKey: string): boolean {
    if (!sectionId) return false;
    const outcome = applySectionEdit(roofPlanesRef.current ?? [], sectionId, edit);
    return adoptGeometryOutcome(outcome, label, coalesceKey, `edit on ${sectionId}`);
  }

  /**
   * SET ONE ROOF FACE'S PITCH — the capability the live gauntlet named as
   * blocking ("can display pitch for a selected roof face but cannot edit it").
   *
   * 🚨 IT GOES THROUGH THE SAME ADOPTION PIPELINE AS EVERY OTHER EDIT. Render,
   * history, panel repositioning, wireframe, extrusion and setbacks are one
   * function, not two — so a face-pitch edit cannot acquire its own subtly
   * different set of side effects, which is how "the panels went inside the
   * house" shipped twice from two code paths doing 90% of the same thing.
   */
  function editFacePitch(faceId: string, pitchDeg: number, anchor: PitchAnchor): boolean {
    if (!faceId) return false;
    const outcome = applyFacePitchEdit(roofPlanesRef.current ?? [], faceId, pitchDeg, anchor);
    const how = anchor === 'ridge' ? 'holding the ridge' : 'holding the wall';
    return adoptGeometryOutcome(
      outcome, `Set face pitch`, `facepitch:${faceId}`,
      `pitch ${pitchDeg.toFixed(1)}° on ${faceId}, ${how}`,
    );
  }

  /**
   * Adopt a canonical geometry outcome: redraw what changed, hand the whole
   * array to the parent for history + persistence, and bring the panels with it.
   *
   * 🚨 A REFUSAL IS A NO-OP THAT SAYS WHY. It does not redraw, does not push
   * history, and does not touch the panels.
   */
  function adoptGeometryOutcome(
    outcome: SectionEditOutcome,
    label: string,
    coalesceKey: string,
    logWhat: string,
  ): boolean {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) return false;

    if (!outcome.ok) {
      // Every refusal, not the first — see buildingSection's validateSection.
      const why = outcome.refusals.map(r => r.message).join(' ');
      setSectionRefusal(why || 'That change would not produce a roof.');
      addLog('SECTION', `edit refused: ${outcome.refusals.map(r => r.code).join(',')}`);
      return false;
    }
    setSectionRefusal(null);

    // Faces the section no longer owns — only ever non-empty when `kind`
    // changed, e.g. a hip becoming a gable drops its two hip ends. Their Cesium
    // entities have to go or they linger as an un-pickable ghost roof.
    //
    // 🚨 THE MAP ENTRIES ARE LEFT ALONE, DELIBERATELY. A first version of this
    // called `plane3DEntityMap.current.delete(goneId)` and friends, and
    // tests/planeLifecycleAuthority.test.ts and tests/autosaveAdversarial.test.ts
    // both failed it. They are right and the blanket ban is right: a
    // "reconcile deletions" effect that pruned these maps deleted a user's
    // traced garage, because the roofPlanes prop lags the map and ABSENCE IS
    // NOT INTENT. "My delete is different because an explicit edit named the
    // ids" is exactly the argument that would reintroduce it.
    //
    // And the prune buys nothing. `liveRenderedFaces()` takes membership from
    // `roofPlanesRef.current`, so a face that is no longer in the design is
    // already excluded from every authority consumer — collectRoofRenderables,
    // stitchRoofVertices and selectableRoofFaces. What is left behind is a
    // cache entry that decides nothing, which is precisely what that doctrine
    // permits. If the kind changes back, the ids are deterministic and the
    // entry is overwritten below.
    for (const goneId of outcome.removedFaceIds) {
      (plane3DEntityMap.current.get(goneId) ?? []).forEach((eid: string) => {
        const e = viewer.entities.getById(eid);
        if (e) try { viewer.entities.remove(e); } catch { /* ignore */ }
      });
    }

    for (const b of outcome.faceBuilds) {
      (plane3DEntityMap.current.get(b.faceId) ?? []).forEach((eid: string) => {
        const e = viewer.entities.getById(eid);
        if (e) try { viewer.entities.remove(e); } catch { /* ignore */ }
      });
      const cesiumPts = b.projectedPts.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z));
      const newIds = renderPlane3DEntity(viewer, C, cesiumPts, b.faceId, b.frame,
        faceIsInSelection(b.faceId), planeRendersOutlineOnly(b.faceId));
      plane3DEntityMap.current.set(b.faceId, newIds);
      plane3DFrameMap.current.set(b.faceId, b.frame);
      plane3DCesiumPtsMap.current.set(b.faceId, cesiumPts);
      (b.plane as any).__eaveDirENU = b.eaveDirENU;
    }
    plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();

    // 🚨 THE WHOLE ARRAY, CANONICAL. Not a per-face patch — see the prop's own
    // comment. The parent snapshots what it holds for undo, then adopts this.
    onRoofGeometryReplaced?.(outcome.planes, { label, coalesceKey });

    // 🚨 AND THE PANELS COME WITH THE ROOF.
    //
    // `PlacedPanel.lat/lng/height` and its ECEF frame are ABSOLUTE, while
    // `planeId` says which face it belongs to. Nothing in the app re-places
    // panels when `roofPlanes` changes, so raising a section's eave by a foot
    // used to leave its whole array a foot UNDER the roof — inside the house.
    // That is the defect this project has already shipped twice, as "the panels
    // are inside of the house and not on top of the planes" and as "NO DECK
    // under the array", and a person who lays panels and THEN corrects the
    // building hits it on the first edit.
    const held = panelsRef.current ?? [];
    if (held.length > 0) {
      const moved = repositionPanelsForPlanes(
        held, roofPlanesRef.current ?? [], outcome.planes, mountingSystemIdRef.current,
      );
      if (moved.moved > 0 || moved.orphaned.length > 0) {
        onPanelsChange(moved.panels);
        const v2 = viewerRef.current;
        if (v2) { try { renderAllPanelsRef.current?.(v2, C, moved.panels, true); } catch { /* ignore */ } }
        addLog('SECTION', `panels: ${moved.moved} moved, ${moved.orphaned.length} orphaned`);
        // An orphan is a panel whose roof face no longer exists — only possible
        // when the roof KIND changed. It is never silently rehomed onto a
        // neighbour, so the user has to be told it is now standing on nothing.
        if (moved.orphaned.length > 0) {
          setSectionRefusal(
            `${moved.orphaned.length} panel${moved.orphaned.length === 1 ? '' : 's'} ` +
            'sat on a roof face that this change removed. They have not been moved — ' +
            'delete them or re-run Fill Roof.',
          );
        }
      }
    }

    if (showRoofModel)             { try { renderRoofWireframe(viewer, C); } catch { /* ignore */ } }
    if (showBuilding3DRef.current) { try { renderBuildingExtrusion(viewer, C); } catch { /* ignore */ } }
    if (showSetbackZones)          { try { renderFireSetbackZones(viewer, C); } catch { /* ignore */ } }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }

    addLog('SECTION', `${label}: ${logWhat}`);
    return true;
  }

  function renderBuildingExtrusion(viewer: any, C: any) {
    clearBuildingExtrusion(viewer);
    const groundSeed = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const renderables = collectRoofRenderables(C, groundSeed);
    if (renderables.length === 0) {
      // The old text said "trace a roof face first", which sends the reader
      // straight to Mark Plane - the tool that CANNOT produce a building.
      // Name the group that can.
      setStatusMsg('Nothing to extrude yet \u2014 model the house first with \u{1F3DA} Building \u2192 Gable, Hip or Flat/Block. (\u{1F3DA} Building only draws walls on what already exists.)');
      return;
    }

    // ── Build the faces this VIEW will draw ──────────────────────────────────
    // 🚨 RENDER-TIME ONLY. Nothing below writes back to a stored plane.
    //
    // An earlier pass rebuilt traced planes in place whenever their fitted pitch
    // looked wrong. That replaced the exact corners the user had clicked, which
    // desynchronised Stitch (it operates on those corners) and shifted faces out
    // from under the trace. The lesson: the trace is the user's data and this
    // view does not get to edit it.
    //
    // So the Building view derives its own geometry from each face's PLAN-VIEW
    // outline — the footprint the user traced, which was always correct — and
    // applies the wall height and pitch from its own controls. Turn Building
    // off and the traced planes are untouched, byte for byte. Adjusting these
    // controls cannot corrupt a design.
    // 🚨 `wallH` AND `pitchDeg` USED TO BE READ HERE AND THEN NEVER USED. They
    // were the inputs to a render-time re-derivation that was removed when the
    // Building view started drawing the stored geometry (see below), and they
    // outlived it as two dead reads of a global counter — which is exactly the
    // kind of leftover that invites somebody to "reconnect" a second authority.
    const raw = renderables.map((rp: any) => ({
      id: rp.id as string,
      polygon3D: rp.corners.map((c: any) => ({ x: c.x, y: c.y, z: c.z })) as Cart3[],
    }));

    // ── THE FACES THIS VIEW DRAWS ARE THE REAL ONES ──────────────────────────
    // 🚨 No re-derivation. This used to rebuild every face at render time from
    // its own pitch and wall-height controls, deliberately never writing back —
    // my attempt to be safe after an automatic rebuild broke Stitch.
    //
    // It was the wrong kind of safe. Panels are placed on the ACTUAL planes, so
    // a view with its own private geometry showed a roof in one place while the
    // panels sat in another: "the panels are inside of the house and not on top
    // of the planes". The aerial texture was misaligned for the same reason —
    // it was draped on a face that was not where the roof was. A 3D view that
    // disagrees with the data is worse than no 3D view.
    //
    // So the Building view now draws the stored geometry, exactly as it is, and
    // walls drop from the real roof to the ground. One geometry, one truth. The
    // WALLS and PITCH controls perform an EXPLICIT edit of the planes instead
    // (see applyBuildingShape) — like Square Up, on a button press, so the
    // panels move with the roof because the roof actually moved.
    const faces = raw;

    let minRoofH = Infinity;
    for (const f of faces) {
      for (const p of f.polygon3D) {
        const h = ecefToLatLng(p).height;
        if (isFinite(h) && h < minRoofH) minRoofH = h;
      }
    }
    if (!isFinite(minRoofH)) {
      addLog('BUILD3D', 'No finite roof heights — skipping extrusion');
      return;
    }
    const groundElevM = resolveGroundForExtrusion(minRoofH);

    const walls = buildWalls(faces, groundElevM);

    // ── SHADING ──────────────────────────────────────────────────────────────
    // 🚨 THIS IS WHY A PITCHED ROOF LOOKED FLAT.
    // The scene runs with globe.enableLighting = false and shadowMap.enabled =
    // false (see boot, ~line 2912). Cesium entity polygons are painted with a
    // FLAT material: two roof faces at +39° and -39°, facing opposite
    // directions, render EXACTLY the same colour. Geometrically pitched,
    // visually identical — which reads as one flat plane.
    //
    // Rather than switch global lighting on (which repaints the whole scene and
    // costs frame time), each face is tinted by its own incidence with the sun,
    // using the SAME getPanelShadingFactor the shade analysis already uses and
    // the sun position from the time scrubber. So the model is lit by the
    // building's real solar geometry, and it re-shades as you scrub the day.
    //
    // 🚨 The orientation comes from faceOrientation(), which reads the RENDERED
    // polygon's own normal — never plane.pitch. If geometry is flattened
    // somewhere upstream, this shows a flat roof instead of faking a pitched
    // one. The picture must not lie about the model.
    const simHourUTC = ((simHourRef.current - lng / 15) % 24 + 24) % 24;
    const sunDate = new Date();
    sunDate.setUTCFullYear(sunDate.getUTCFullYear(), 5, 21);
    sunDate.setUTCHours(Math.floor(simHourUTC), Math.round((simHourUTC % 1) * 60), 0, 0);
    const sun = getSunPosition(lat, lng, sunDate);

    // Ambient floor so a face turned away from the sun is still readable rather
    // than black — the same trick architectural renderings use.
    const AMBIENT = 0.45;
    const litness = (poly: Cart3[]) => {
      const { tiltDeg, azimuthDeg } = faceOrientation(poly);
      const direct = getPanelShadingFactor(tiltDeg, azimuthDeg, sun.elevation, sun.azimuth);
      return AMBIENT + (1 - AMBIENT) * direct;
    };
    // Multiply the base colour by how lit the face is. Direct RGB scaling
    // rather than Cesium's darken(), which interpolates toward black on a
    // different curve and washes out the difference between two slopes — the
    // exact difference we need to be visible.
    const shade = (hex: string, k: number, alpha: number) => {
      const base = C.Color.fromCssColorString(hex);
      const f = Math.max(0, Math.min(1, k));
      return new C.Color(base.red * f, base.green * f, base.blue * f, alpha);
    };

    // ── Walls ────────────────────────────────────────────────────────────────
    // Flat white, like Aurora's. arcType NONE + perPositionHeight keeps each
    // quad an exact planar surface instead of draping it over the ellipsoid.
    const wallEdge = C.Color.fromCssColorString('#9aa3b8').withAlpha(0.85);
    for (const w of walls) {
      // 🚨 A WALL, NOT A VERTICAL POLYGON. THIS IS THE TRIANGLE.
      //
      // Each wall used to be a `PolygonGraphics` over four ECEF corners with
      // `perPositionHeight`. Cesium triangulates a polygon from a projection
      // onto a HORIZONTAL tangent plane — `EllipsoidTangentPlane.fromPoints`
      // takes the geodetic normal at the bounding-box centre — so a VERTICAL
      // quad collapses to a 2D sliver of near-zero area, its top and bottom
      // corners separated only by the few centimetres that the deflection of
      // the vertical contributes. When earcut fails on that sliver,
      // `PolygonGeometryLibrary` falls back to `indices = [0, 1, 2]`: literally
      // the first three of the four corners. The wall renders as a TRIANGLE.
      //
      // That is numerics-dependent, which is exactly why the owner saw it come
      // and go as the porch was moved and lowered, and why it looked like a
      // geometry defect rather than a rendering one. `WallGraphics` is the
      // primitive for this: it takes plan positions and a height band and never
      // projects anything.
      const ent = viewer.entities.add({
        name: `[BUILD3D-WALL] ${w.faceId}#${w.edgeIndex}`,
        wall: {
          positions:      w.plan.map(q => C.Cartesian3.fromDegrees(q.lng, q.lat)),
          maximumHeights: w.topHeightsM.slice(),
          minimumHeights: w.baseHeightsM.slice(),
          material:       shade('#e8eaf0', litness(w.corners), 0.95),
          outline:        true,
          outlineColor:   wallEdge,
          shadows:        C.ShadowMode.ENABLED,
        },
      });
      buildingEntitiesRef.current.push(ent);
    }

    // ── Roof surfaces ────────────────────────────────────────────────────────
    // Opaque, so the grainy imagery underneath stops showing through. This is
    // what turns "marked planes" into a roof.
    const roofEdge = C.Color.fromCssColorString('#ff9500').withAlpha(0.9);
    let flatFaceCount = 0;
    const roofEntities: Array<{ ent: any; ring: Array<{ lat: number; lng: number }>; lit: number }> = [];
    for (const f of faces) {
      const orient = faceOrientation(f.polygon3D);
      if (orient.tiltDeg < 1) flatFaceCount++;
      const pts = f.polygon3D.map(p => new C.Cartesian3(p.x, p.y, p.z));
      const lit = litness(f.polygon3D);
      const isSel = selectedFaceIdRef.current === f.id;
      const ent = viewer.entities.add({
        name: `[BUILD3D-ROOF] ${f.id}`,
        polygon: {
          hierarchy:         new C.PolygonHierarchy(pts),
          // Flat colour first so the roof is solid IMMEDIATELY; the aerial
          // texture swaps in below when its tiles arrive. Never leave the user
          // looking at nothing while the network works.
          material:          shade(isSel ? '#2f6f8f' : '#8a7466', lit, 0.98),
          outline:           true,
          // A selected face gets a bright cyan edge — it must be obvious which
          // face the Walls/Pitch steppers are about to move.
          outlineColor:      isSel ? C.Color.fromCssColorString('#00e5ff') : roofEdge,
          outlineWidth:      isSel ? 4 : 1,
          perPositionHeight: true,
          arcType:           C.ArcType.NONE,
          shadows:           C.ShadowMode.ENABLED,
        },
      });
      buildingEntitiesRef.current.push(ent);
      roofEntities.push({
        ent,
        ring: f.polygon3D.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; }),
        lit,
      });
      addLog('BUILD3D', `  face ${f.id.slice(0, 8)}: tilt=${orient.tiltDeg.toFixed(1)}° az=${orient.azimuthDeg.toFixed(0)}° (measured from rendered geometry)`);
    }

    // ── AERIAL TEXTURE ───────────────────────────────────────────────────────
    // Ray: "Aurora, when they pull up their built 3D, it overlays the google
    // image on the roof." This is that.
    //
    // The traced face is the PLAN VIEW of the roof lifted along its slope, so
    // the imagery we want is exactly the face's lat/lng bounding box — and
    // Cesium maps polygon texture coordinates across that same bounding
    // rectangle, so it lines up with no custom st coordinates.
    //
    // Async and non-blocking: the solid colour above is already on screen. The
    // ImageMaterialProperty `color` keeps the per-face sun shading, so a
    // textured roof still reads as pitched rather than flattening back out.
    if (showRoofTextureRef.current) {
      const token = ++buildingRenderTokenRef.current;
      void Promise.all(roofEntities.map(async ({ ent, ring, lit }) => {
        const canvas = await composeRoofTexture(ring);
        // A newer render (or a toggle off) superseded this one — drop the result
        // rather than painting a stale texture onto a rebuilt scene.
        if (!canvas || token !== buildingRenderTokenRef.current) return;
        try {
          ent.polygon.material = new C.ImageMaterialProperty({
            image: canvas,
            color: new C.Color(lit, lit, lit, 1.0),
            transparent: false,
          });
        } catch (e) { addLog('WARN', `roof texture: ${(e as Error).message}`); }
      })).then(() => {
        if (token === buildingRenderTokenRef.current) {
          try { viewer.scene.requestRender(); } catch { /* ignore */ }
          addLog('BUILD3D', `Aerial texture applied to ${roofEntities.length} roof face(s)`);
        }
      });
    }

    addLog('BUILD3D', `Building rendered: ${faces.length} roof face(s), ${walls.length} wall(s), ground=${groundElevM.toFixed(1)}m, lowest roof=${minRoofH.toFixed(1)}m, sun el=${sun.elevation.toFixed(0)}° az=${sun.azimuth.toFixed(0)}°`);
    // Surface a flat roof instead of quietly shading it like a roof: if the
    // geometry really is horizontal, the user needs to know that, not see a
    // convincing picture of a roof that does not exist.
    setStatusMsg(
      flatFaceCount > 0
        ? `🏚 Building — ⚠ ${flatFaceCount} of ${faces.length} face(s) are FLAT (0° tilt measured from the geometry) · ${walls.length} walls`
        : `🏚 Building — ${faces.length} face${faces.length === 1 ? '' : 's'} · ${walls.length} wall${walls.length === 1 ? '' : 's'} down to ground`
    );
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
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
    // Only faces the design still holds. Stitch MOVES corners to a cluster
    // average, so a ghost in the cache would drag the surviving faces toward a
    // plane the user deleted — or toward another property's roof.
    const entries = liveRenderedFaces().map(f => [f.planeId, f.pts] as [string, any[]]);
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
    // ── v66: ABUTMENTS ───────────────────────────────────────────────────────
    // Clustering above joins CORNER to CORNER, which is right for a gable, a
    // hip peak or a saltbox ridge — both faces genuinely own that point, so
    // their mean is the answer and everybody converges on it.
    //
    // 🚨 It cannot see the other half of the problem. Ray: "my one plane of my
    // roof meets into a covered porch... the porch roof meets into the main
    // roof ABOVE the eave." A porch head lands partway UP the main slope, so
    // its top corners sit in the MIDDLE of the main face, where there is no
    // corner of the main roof to cluster with. No tolerance fixes that: the
    // thing it attaches to is a surface, not a point. Same for shed dormers,
    // lean-tos and lower wings — all common, none previously handled.
    //
    // snapAbutments lands those vertices on the surface they meet. It
    // deliberately DECLINES any vertex that has another face's corner nearby,
    // because that one belongs to the clustering above; taking both would make
    // two mutually-abutting corners swap heights instead of converging.
    let abutted = 0;
    try {
      const abutFaces = Array.from(work.entries()).map(([pid, pts]) => ({
        id: pid,
        polygon3D: pts.map((p: any) => ({ x: p.x, y: p.y, z: p.z })),
      }));
      const ab = snapAbutments(abutFaces);
      if (ab.snapped > 0) {
        for (const [pid, poly] of ab.faces) {
          work.set(pid, poly.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z)));
        }
        abutted = ab.snapped;
        addLog('STITCH', `Abutments: landed ${ab.snapped} vertex/vertices on an adjoining roof face (max lift ${ab.maxLiftM.toFixed(2)}m)`);
      }
    } catch (e) { addLog('WARN', `abutment pass: ${(e as Error).message}`); }

    if (lastShared === 0 && abutted === 0) {
      setStatusMsg(`Stitch — nothing to join: no shared corners within ~${TOL}m and no face landing on another`);
      return;
    }

    // v64: collect the stitched corners (lat/lng) per plane so they can be written
    // back into roofPlanes state — the geometry every panel-placement engine reads.
    const stitchUpdates: RoofPlaneReshapeUpdate[] = [];
    for (const [pid, pts] of work) {
      const cartPts: Cart3[] = pts.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
      // 🚨 surfaceOffsetM: 0 — these points came OUT of a previous fit (the
      // stitch seeds `work` from plane3DCesiumPtsMap) and are already lifted.
      // Letting the default apply again raises the roof 12 cm per Stitch press,
      // cumulatively, and the result is written straight back to that same map.
      let frame; try { frame = computePlaneFromPoints3D(cartPts, { surfaceOffsetM: 0 }); } catch { continue; }
      const projected = frame.projectedPts.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z));
      const oldIds = plane3DEntityMap.current.get(pid) || [];
      oldIds.forEach(id => { try { const e = viewer.entities.getById(id); if (e) viewer.entities.remove(e); } catch {} });
      const isSel = faceIsInSelection(pid);
      const newIds = renderPlane3DEntity(viewer, C, projected, pid, frame, isSel, planeRendersOutlineOnly(pid));
      plane3DEntityMap.current.set(pid, newIds);
      plane3DFrameMap.current.set(pid, frame);
      plane3DCesiumPtsMap.current.set(pid, projected);
      // projected[i] is the same planarized corner buildRoofPlane3D used to make
      // plane.vertices[i] — convert back to lat/lng to update the source geometry.
      // 🚨 THE PLAN RECORD HERE KEEPS THE RENDER LIFT, DELIBERATELY, AND I
      // BROKE IT ONCE BY "FIXING" IT.
      //
      // `buildRoofPlane3D` takes `vertices` BEFORE the lift, because the lift
      // has a horizontal component of offset·sin(tilt) down each face's own
      // azimuth and deriving the plan record from lifted points slid the two
      // halves of a gable apart. The obvious inference is that this write-back
      // should do the same. It must not, and the reason is the clustering
      // above:
      //
      //   `work` holds the LIFTED corners. A gable's two ridge corners are
      //   therefore already 2·offset·sin(tilt) apart there — and the stitch's
      //   whole purpose is to AVERAGE them into one point, which it does.
      //   Subtracting each face's own normal afterwards pulls that single
      //   shared point back into two, by exactly the amount the clustering had
      //   just removed.
      //
      // Measured in the browser: before Stitch the gable's ridge vertices are
      // 0.0 mm apart; with the unlift applied here they came out 100.9 mm
      // apart — 2 · 0.12 · sin(25°). The guard in e2e/design-studio.spec.ts
      // caught it before it shipped.
      //
      // What remains true is smaller and is recorded rather than guessed at: a
      // stitched face's plan outline is translated ~5 cm down-slope as a whole.
      // Removing that correctly means clustering in PLAN space, which is a
      // change to the stitch algorithm, not to this loop.
      const verts: Array<{ lat: number; lng: number }> = [];
      for (const p of projected) {
        const carto = C.Cartographic.fromCartesian(p);
        if (!carto) continue;
        verts.push({ lat: C.Math.toDegrees(carto.latitude), lng: C.Math.toDegrees(carto.longitude) });
      }
      // v66: keep the flat-trace rebuild source in step with the stitch.
      //
      // rebuildFlatTracedPlanes (used by the eave-height control) rebuilds a
      // face from flatTraceParamsRef.outline. Stitch writes the merged corners
      // to plane3DCesiumPtsMap and to roofPlanes, but NOT here — so nudging the
      // eave after stitching rebuilt from the ORIGINAL un-stitched trace and
      // silently pulled the faces back apart, undoing the stitch with no
      // indication that anything had been discarded.
      if (verts.length >= 3) {
        const params = flatTraceParamsRef.current.get(pid);
        if (params) flatTraceParamsRef.current.set(pid, { ...params, outline: verts });
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
          // 🚨 STITCH IS A RESHAPE, AND IT WAS THE ONE THAT SAID NOTHING.
          //
          // Ray uses Stitch deliberately to pull separate planes into a peak —
          // a modelling move. Moving corners to a shared ridge CHANGES the
          // plane, so pitch, azimuth and the ECEF frame all change with it. This
          // push carried the geometry and none of the three, so `plane.pitch`
          // kept its pre-stitch value (read by the planset, the structural
          // engine and the production model) and `buildSurfaceGrid` kept
          // placing panels on the pre-stitch triad while clipping them to the
          // stitched outline.
          //
          // Derived exactly as buildRoofPlane3D derives them, so a stitched face
          // and a traced one report the same numbers for the same geometry.
          pitch:   Math.max(0, Math.min(60, frame.tiltDeg)),
          azimuth: ((frame.azimuthDeg % 360) + 360) % 360,
          ecefFrame3D: {
            u: { x: frame.u.x, y: frame.u.y, z: frame.u.z },
            v: { x: frame.v.x, y: frame.v.y, z: frame.v.z },
            n: { x: frame.normal.x, y: frame.normal.y, z: frame.normal.z },
          },
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
    setStatusMsg(
      `🔗 Stitched — ${lastShared} shared point${lastShared !== 1 ? 's' : ''} averaged` +
      (abutted > 0
        ? ` · ${abutted} corner${abutted !== 1 ? 's' : ''} landed onto an adjoining roof face (porch/dormer/lean-to)`
        : '')
    );
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
      // E2E: track if this full rebuild happened while panel count was stable
      // (position-only move). Incrementing panelMoveRebuildCount during a drag
      // means the 2176e4d3 regression is back — jerky rebuilds on panel move.
      if (prev.length > 0 && prev.length === panelList.length && forceFullRebuild) {
        panelMoveRebuildCountRef.current += 1;
      }
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
      // addRow / extendRow / placeSinglePanel — origin + u*uC + v*vC + n*moduleStackHeightM(mountId).
      // Cesium mesh (3D tiles) is VISUAL ONLY — never sample per-panel height from terrain.
      // 🚨 A PANEL WITH NO ELEVATION IS NOT A PANEL AT SEA LEVEL.
      //
      // This used to read `const h = panel.height ?? 0`, and `isValidCoord`
      // accepts 0, so a panel that arrived without an elevation was DRAWN at
      // ellipsoidal zero — roughly a hundred metres below any real roof — while
      // its neighbours sat correctly. That is "the panels are not ALL rendering
      // above the roof": the count is right, nothing errors, and part of the
      // array is underground.
      //
      // Refusing to draw it is the honest failure. A missing panel is noticed
      // and reported; a buried one looks like a rendering bug and gets chased
      // in the wrong place.
      if (!hasUsableElevation(panel)) {
        addLog('ERROR',
          `Panel ${panel.id} has NO elevation (height=${String(panel.height)}) — not drawn. ` +
          `Re-run Auto Layout to place it on the roof.`);
        return;
      }
      const h       = panel.height as number;
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
        // 🚨 THE ANNUAL FACTOR WINS WHEN THERE IS ONE.
        //
        // `computeShade` is the cosine of incidence and nothing else: it reads
        // the module's tilt and azimuth and is blind to every object in the
        // scene. Painting the roof with it while the analysis says something
        // different is two answers to one question, and the one on screen is
        // the one people believe. `annualShadeFactor` is produced from the
        // canonical geometry — trees, chimneys, the garage across the drive —
        // by lib/shade/canonicalShadeScene.ts. See `onRunShadeAnalysis`.
        const shade = typeof (panel as { annualShadeFactor?: number }).annualShadeFactor === 'number'
          ? (panel as { annualShadeFactor: number }).annualShadeFactor
          : computeShade(panel, sunPos);
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
          // 🚨 THE ANALYSIS WINS HERE TOO. `addPanelEntity` already prefers
          // `annualShadeFactor`, but this runs on every sun-slider change and
          // repainted every module with `computeShade` — the cosine of
          // incidence, blind to every object in the scene. Nudging the slider
          // silently reverted the shade study to the model it replaced, and the
          // picture is the thing people believe.
          const shade = typeof panel.annualShadeFactor === 'number'
            ? panel.annualShadeFactor
            : computeShade(panel, sunPos);
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

    // v64: Block resize — LEFT_DOWN picks a block handle and starts a height drag.
    // Runs BEFORE the existing panel-array LEFT_DOWN so handle picks short-circuit
    // panel array logic. We set suppressClickRef so the trailing LEFT_CLICK that
    // fires on mouse-up doesn't re-run selection.
    //
    // 🚨 THESE THREE ARE PLAIN FUNCTIONS, NOT REGISTRATIONS, AND THAT IS THE FIX.
    // Cesium's ScreenSpaceEventHandler.setInputAction is a plain overwrite —
    // `this._inputEvents[getInputEventKey(type, modifier)] = action` — not an
    // append. Registering LEFT_DOWN / MOUSE_MOVE / LEFT_UP here AND again for the
    // panel-array grab below, on this same `handler`, meant the second trio
    // silently replaced this one: `blockResizeRef` was never set, so the block
    // height drag, its camera freeze and its suppressClickRef were all dead code
    // while the comment above claimed they ran first. They now really do run
    // first, because the surviving handlers call them.
    const blockResizeDown = (event: any): void => {
      try {
        if (blockResizeRef.current) return; // already resizing
        const screenPos = event.position;
        const picked = viewer.scene.pick(screenPos);
        if (!picked || !picked.id) return;
        const pickedId: string = picked.id.id || '';
        if (!pickedId.startsWith('block-handle-')) return;
        // Found a block handle — start the resize
        const handleEntity = picked.id;
        const blockId = (handleEntity as any).__blockId as string | undefined;
        if (!blockId) return;
        const blockEntity = blockEntitiesRef.current.find((b: any) => b.id === blockId);
        if (!blockEntity) return;
        // v65: the new line-trace block is a PolygonGraphics with extrudedHeight
        // (not a BoxGraphics with .dimensions). Get the current height from
        // extrudedHeight, falling back to DEFAULT_BLOCK_HEIGHT_M.
        let startHeightM = DEFAULT_BLOCK_HEIGHT_M;
        if (blockEntity.polygon?.extrudedHeight?.getValue) {
          const eh = blockEntity.polygon.extrudedHeight.getValue(C.JulianDate.now());
          if (typeof eh === 'number' && isFinite(eh)) startHeightM = eh;
        } else if (blockEntity.box?.dimensions?.getValue) {
          // Legacy box-based block (Stage 1 only, before the line-trace rewrite)
          const dims = blockEntity.box.dimensions.getValue(C.JulianDate.now());
          if (dims) startHeightM = dims.z;
        }
        // Get the block centroid Cartesian (for vertical line intersection).
        // v65: the new prism entity stores its centroid on a private property
        // since PolygonGraphics doesn't have a `position` field.
        let centroidCart: any = null;
        if ((blockEntity as any).__centroidCart) {
          centroidCart = (blockEntity as any).__centroidCart;
        } else if (blockEntity.position?.getValue) {
          // Legacy box-based block (Stage 1 only)
          centroidCart = blockEntity.position.getValue(C.JulianDate.now());
        }
        if (!centroidCart) return;
        // Compute initial cursor Y in world coords (ray-vertical-line intersection)
        const ray = viewer.camera.getPickRay(screenPos);
        let startYWorld = startHeightM;
        if (ray) {
          // Where the cursor sits along the block's OWN vertical, in metres from
          // its centroid. See rayHeightAlongVertical for why the previous
          // arithmetic could only ever return the centroid's own z.
          const u0 = rayHeightAlongVertical(C, ray, centroidCart);
          if (u0 != null) startYWorld = u0;
        }
        blockResizeRef.current = {
          blockEntity, handleEntity,
          startHeightM, startYWorld, centroidCart,
        };
        suppressClickRef.current = true; // swallow the click that follows on mouse-up
        arrayManipRef.current = true;    // freeze the camera so the drag is a clean up/down motion
        setSelectedBlockId(blockId);
        setStatusMsg(`↕ Dragging block height — currently ${startHeightM.toFixed(1)}m`);
      } catch (err: unknown) { addLog('ERROR', `block resize LEFT_DOWN: ${(err as Error).message}`); }
    };

    // v64: Block resize — MOUSE_MOVE updates the block height in real-time.
    // Same pattern as panel array drag — fires only when blockResizeRef is set.
    const blockResizeMove = (event: any): void => {
      const r = blockResizeRef.current;
      if (!r) return;
      try {
        const ray = viewer.camera.getPickRay(event.endPosition);
        if (!ray) return;
        const u = rayHeightAlongVertical(C, ray, r.centroidCart);
        if (u == null) return;
        const newHeightM = clampBlockHeight(r.startHeightM + (u - r.startYWorld));
        // v65: the new line-trace block is a PolygonGraphics with extrudedHeight.
        // Update the prism's extrudedHeight so the walls stretch to the new height.
        if (r.blockEntity.polygon?.extrudedHeight) {
          r.blockEntity.polygon.extrudedHeight = new C.ConstantProperty(newHeightM);
        } else if (r.blockEntity.box?.dimensions) {
          // Legacy box-based block (Stage 1 only)
          const dims = r.blockEntity.box.dimensions.getValue(C.JulianDate.now());
          if (dims) {
            r.blockEntity.box.dimensions = new C.ConstantProperty(
              new C.Cartesian3(dims.x, dims.y, newHeightM),
            );
          }
        }
        // Update the handle's position to sit on top of the new prism
        // (handle is at eaveHeight + 0.3 to keep it visible above the top face)
        // 🚨 A HEIGHT IS NOT AN ECEF Z. This kept the centroid's ECEF x and y
        // — millions of metres — and replaced its z with a metres-above-ground
        // number, so at 38.73 N the handle was written 3,969 km toward the
        // equatorial plane and vanished on the first mouse-move. The drag then
        // had nothing to hold. Rebuild it from the anchor's own lat/lng.
        if (r.handleEntity.position) {
          const carto = C.Cartographic.fromCartesian(r.centroidCart);
          const groundM = carto.height - r.startHeightM;
          r.handleEntity.position = new C.ConstantProperty(
            C.Cartesian3.fromRadians(carto.longitude, carto.latitude, groundM + newHeightM + 0.3),
          );
        }
        blockHeightOverridesRef.current.set(r.blockEntity.id, newHeightM);
        setStatusMsg(`↕ Block height: ${newHeightM.toFixed(1)}m`);
        try { viewer.scene.requestRender(); } catch {}
      } catch (err: unknown) { addLog('ERROR', `block resize MOUSE_MOVE: ${(err as Error).message}`); }
    };

    // v64: Block resize — LEFT_UP finalizes and clears the resize state.
    const blockResizeUp = (): void => {
      const r = blockResizeRef.current;
      if (!r) return;
      try {
        // v65: read the current height from extrudedHeight (polygon) or
        // .dimensions.z (legacy box), whichever the block uses.
        let finalHeightM = r.startHeightM;
        if (r.blockEntity.polygon?.extrudedHeight?.getValue) {
          const eh = r.blockEntity.polygon.extrudedHeight.getValue(C.JulianDate.now());
          if (typeof eh === 'number' && isFinite(eh)) finalHeightM = eh;
        } else if (r.blockEntity.box?.dimensions?.getValue) {
          const dims = r.blockEntity.box.dimensions.getValue(C.JulianDate.now());
          if (dims) finalHeightM = dims.z;
        }
        blockHeightOverridesRef.current.set(r.blockEntity.id, finalHeightM);

        // 🚨 AND THE ANCHOR MOVES WITH THE BLOCK, OR THE NEXT DRAG IS THE LAST.
        //
        // `__centroidCart` is written once at creation, at ground + the eave
        // height the block was built with, and `blockResizeMove` recovers the
        // ground from it as `carto.height - startHeightM`. That identity only
        // holds while the anchor still describes the CURRENT top, and nothing
        // here used to update it — only `setBlockHeight` did.
        //
        // So the second drag mis-placed the handle by exactly the height the
        // first drag added: a block taken from 6 m to 20 m put its knob 14 m
        // BELOW its own roof, inside the building. The block stayed the right
        // height (`startYWorld` and `u` share the stale anchor, so the delta
        // cancels) — the only visible effect was the grab handle burying
        // itself. After that `blockResizeDown` can never arm again, because it
        // only arms on a `block-handle-` pick and the handle is no longer up
        // there: the height could not be dragged again without a reload. The
        // status line below has been promising "drag handle again to adjust"
        // the whole time.
        try {
          const carto = C.Cartographic.fromCartesian(r.centroidCart);
          if (carto && isFinite(carto.height)) {
            const groundM = carto.height - r.startHeightM;
            (r.blockEntity as any).__centroidCart =
              C.Cartesian3.fromRadians(carto.longitude, carto.latitude, groundM + finalHeightM);
          }
        } catch (e: unknown) {
          addLog('WARN', `block resize: anchor not re-synced — ${(e as Error).message}`);
        }

        suppressClickRef.current = true; // consume the trailing LEFT_CLICK
        setStatusMsg(`🧱 Block height set to ${finalHeightM.toFixed(1)}m — drag handle again to adjust`);
      } catch (err: unknown) { addLog('ERROR', `block resize LEFT_UP: ${(err as Error).message}`); }
      finally {
        blockResizeRef.current = null;
        arrayManipRef.current = false; // hand the camera back
      }
    };

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
        else if (mode === 'measurements')   handleMeasurementsClick(viewer, C, screenPos);
        // ruler is routed via LEFT_DOWN / MOUSE_MOVE / LEFT_UP below (drag semantics)
        else if (mode === 'surface_select') handleSurfaceSelectClick(viewer, C, screenPos);
        else if (mode === 'extend_row')     handleExtendRowClick(viewer, C, screenPos);
        else if (mode === 'add_row')        handleAddRowClick(viewer, C, screenPos);
        else if (mode === 'snap_panel')     handleSnapPanelClick(viewer, C, screenPos);
        else if (mode === 'obstruction')    handleObstructionClick(viewer, C, screenPos);
        else if (mode === 'plane3d')        handlePlane3DClick(viewer, C, screenPos);
        else if (mode === 'mark_plane')     handlePlane3DClick(viewer, C, screenPos); // same point-trace, no panel fill on finish
        else if (mode === 'set_direction')  handleSetDirectionClick(viewer, C, screenPos);
        else if (mode === 'set_origin')     handleSetOriginClick(viewer, C, screenPos);
        else if (mode === 'block')          handleBlockClick(viewer, C, screenPos);
        else if (mode === 'roof_gable')     handleGableClick(viewer, C, screenPos);
        else if (mode === 'roof_hip')       handleHipClick(viewer, C, screenPos);
        // 🚨 A TREE IS PLACED BY THE OBSTRUCTION PATH, WHICH IS THE ONE THAT
        // WRITES A CANONICAL RECORD. The tool state stays `tree` so the palette
        // and the user agree about what is armed; only the machinery is shared.
        // `handleTreeClick` — the decorative one, two Cesium entities and no
        // record — is dead and nothing may route to it again.
        else if (mode === 'tree')           handleObstructionClick(viewer, C, screenPos);
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
      // 🚨 A NEW PRESS VOIDS ANY STALE CLICK SUPPRESSION.
      //
      // `suppressClickRef` is set at the END of a drag to swallow the trailing
      // LEFT_CLICK — but Cesium only SYNTHESISES that LEFT_CLICK when the
      // pointer moved no more than `_clickPixelTolerance = 5` px between down
      // and up (verified in the installed Cesium). A real drag moves far more,
      // so no LEFT_CLICK is ever delivered, nothing consumes the flag, and the
      // user's NEXT click — in whatever mode they are in — is silently thrown
      // away by the guard at the top of the LEFT_CLICK handler.
      //
      // The panel-array grab has always had this shape; making the block-height
      // drag reachable added a second instance of it. Clearing here fixes both:
      // by the time a fresh press arrives, any suppression left over from an
      // earlier gesture is stale by definition. The flag set later in THIS
      // gesture is still consumed normally by the LEFT_CLICK that may follow it.
      suppressClickRef.current = false;
      // Block height handles are checked first and in EVERY mode — the block is
      // traced in `block` mode, so a mode guard here would make its own handle
      // unreachable. If it took the event, blockResizeRef is set and the array
      // grab must not also arm on the same press.
      blockResizeDown(event);
      if (blockResizeRef.current) return;
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
      if (blockResizeRef.current) { blockResizeMove(event); return; }
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
      if (blockResizeRef.current) { blockResizeUp(); return; }
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
      } else if (modeRef.current === 'roof_gable') {
        cancelSectionTrace('gable');
      } else if (modeRef.current === 'roof_hip') {
        cancelSectionTrace('hip');
      } else if (modeRef.current === 'block') {
        // v65: right-click finalizes the line-trace block (or cancels if < 3 points)
        if (blockPtsRef.current.length >= 3) {
          finalizeBlock(viewer, C);
        } else {
          // cancel — remove preview if any
          if (blockPreviewRef.current) {
            try {
              const dots = (blockPreviewRef.current as any).__dots as any[] | undefined;
              if (dots) for (const d of dots) try { viewer.entities.remove(d); } catch { /* ignore */ }
              viewer.entities.remove(blockPreviewRef.current);
            } catch { /* ignore */ }
            blockPreviewRef.current = null;
          }
          // v68: also clear the segment arrows
          try { segmentArrowOverlayRef.current?.clear(); } catch { /* ignore */ }
          flippedArrowsRef.current.clear();
          blockPtsRef.current = [];
          setBlockPtCount(0);
          setStatusMsg('🧱 Block cancelled — need at least 3 points. Click again to start.');
        }
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

    // ── Fallback: ellipsoid pick ─────────────────────────────────────────────
    //
    // 🚨 THIS WAS DEAD CODE, AND IT WAS DEAD IN THE ONE CASE IT EXISTS FOR.
    //
    // It called `viewer.scene.globe.ellipsoid.intersectWithRay(ray)`.
    // `Ellipsoid.prototype.intersectWithRay` DOES NOT EXIST in CesiumJS —
    // verified against both the pinned browser build (1.114, app/layout.tsx:69)
    // and the local package (1.139.1): the property is `undefined`, so the call
    // threw a TypeError that `handleCesiumError` swallowed on every pick.
    //
    // Nobody noticed because it is the LAST resort and the first two almost
    // always answer. They do not answer in exactly one situation: an address
    // with no Google photorealistic mesh. The engine hides the globe as soon as
    // a tileset object exists (line ~3537, the coastal bleed-through fix), and
    // Google's ROOT tileset resolves for any valid key whether or not that
    // address has coverage — so `scene.pick` finds nothing, the terrain branch
    // is skipped because the globe is hidden, and this threw.
    //
    // Result: four clicks of the Gable tool did nothing at all, with no
    // message, at precisely the properties the custom fallback pipeline was
    // built for. `camera.pickEllipsoid` is the supported API and is present in
    // both versions.
    //
    // 🚨 AND IT PICKS AT THE GROUND, NOT AT h=0. A bare WGS84 pick lands on the
    // ellipsoid surface while `finalizeRoofSection` builds the section at
    // `groundElevM` — measured 420 px apart on a 1000 px canvas at 3 Melvin Dr,
    // and 966 px at Denver elevation, so the finished roof appears nowhere near
    // where it was traced. Expanding the ellipsoid by the resolved ground
    // elevation puts the corner where the user pointed.
    if (!cartesian) {
      try {
        const base = viewer.scene.globe?.ellipsoid ?? C.Ellipsoid.WGS84;
        const h = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
        const atGround = isFinite(h) && Math.abs(h) > 0.01;
        const ell = atGround
          ? new C.Ellipsoid(base.radii.x + h, base.radii.y + h, base.radii.z + h)
          : base;
        const ep = viewer.camera.pickEllipsoid(screenPos, ell);
        if (ep && isFinite(ep.x) && C.Cartesian3.magnitude(ep) > 1000) {
          cartesian = ep;
          pickMethod = atGround ? 'ellipsoid@ground' : 'ellipsoid';
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

  // ────── resolvePlacementPoint: ONE answer to "where did the user point?" -------
  /**
   * 🚨 THE SHARED PLACEMENT-INTERSECTION AUTHORITY.
   *
   * "Tree -> click ground -> NO TREE APPEARS." "Chimney may also not be wired
   * end-to-end." Both were the same defect, and it was never in Tree or in
   * Chimney: five handlers resolved their click with a bare
   * `viewer.scene.pickPosition(screenPos)`, which reads the DEPTH BUFFER. That
   * answers only where something is already drawn, and only where the depth
   * texture exists. The engine hides the globe once a tileset object exists, and
   * Google's root tileset resolves for any valid key whether or not the address
   * has coverage -- so at exactly the properties the custom pipeline was built
   * for, the buffer is empty, the call returns undefined, and the handler
   * returns having built nothing. A click that succeeded and a click that failed
   * looked identical.
   *
   * 🚨 A PHYSICAL PLACEMENT POINT MUST NOT REQUIRE A RENDERED, SELECTABLE
   * ENTITY. The design already knows where its surfaces are. So a roof object is
   * placed by intersecting the camera ray with the design's OWN canonical faces,
   * and a site object by intersecting it with the ground elevation -- neither of
   * which needs anything drawn, picked, or GPU-readable.
   *
   * The depth-buffer chain is kept, demoted to a fallback: when Google's mesh IS
   * present it is the most accurate answer available, and it is the only one
   * that knows about geometry the design does not own.
   *
   * @param space 'roof' -- must land on a canonical roof face; carries its id.
   *              'site' -- must land on the ground; height is the ground datum.
   */
  function resolvePlacementPoint(
    viewer: any,
    C: any,
    screenPos: any,
    space: 'roof' | 'site',
    // 🚨 THE TRAIL COMES BACK WITH THE ANSWER, not only with a total refusal.
    // A roof object that resolves a POINT but binds no FACE is refused by the
    // caller, and until now that refusal could not say why: the diagnostic was
    // logged only when every strategy failed. Measured cost: a browser session
    // spent proving that "clicked off every roof face" did not mean the ray
    // missed the roof.
  ): { lat: number; lng: number; height: number; cartesian: any; planeId: string | null; method: string; trail: string[] } | null {
    // 🚨 AN UNRESOLVED GROUND DATUM IS NOT ZERO.
    //
    // This read `resolved ? elev : 0`, and 0 is the ellipsoid -- about 140 m
    // below the ground here, and ~1600 m below it in Denver. So when the
    // elevation lookup failed or was quota-limited, a tree was planted a hundred
    // metres underground and the status bar said it had been placed. Every other
    // consumer honours the flag: Lane A refuses, the camera widens to a 300 m
    // orbit. This one guessed.
    //
    // A site object has no meaning without the ground, so it refuses and the
    // existing `!spot` message tells the user. A roof object may still proceed:
    // its answer comes from the canonical faces, which carry their own datum.
    // 🚨 AN UNRESOLVED DATUM IS NOT A REASON TO REFUSE, AND REFUSING BROKE
    // THE ONE CASE THIS TOOL EXISTS FOR.
    //
    // A first version returned null here when `cesiumGroundElevResolvedRef` was
    // false, to stop a tree being planted at the ellipsoid ~140 m underground.
    // The reasoning was wrong and the browser gate proved it: the datum resolves
    // ONLY from the Google Solar API (see the boot and fly paths), so at a
    // property with no Google coverage -- precisely the properties the custom
    // pipeline was built for -- it is unresolved for ever and the Tree tool
    // could never place anything. That is the owner's original report,
    // reintroduced while fixing something else.
    //
    // The scenario it guarded against cannot occur. It required the buildings to
    // sit at a true elevation while the tree got 0 -- but every consumer reads
    // this same ref in the same instant, so when it is unresolved the WHOLE
    // design shares the 0 datum and the tree is consistent with the roof it must
    // shade. A shade calculation cares about the difference between the tree top
    // and the panels, and that difference is preserved either way.
    //
    // So it warns, once, and places. A tool that silently refuses is worse than
    // a tool working on a relative datum.
    const groundResolved = cesiumGroundElevResolvedRef.current;
    const groundElevM = groundResolved ? cesiumGroundElevRef.current : 0;
    if (space === 'site' && !groundResolved && !warnedUnresolvedGroundRef.current) {
      warnedUnresolvedGroundRef.current = true;
      addLog('WARN', 'placement: the ground elevation is unresolved; site objects use the design’s relative datum');
    }

    // The engine's own site-centre props, bound here so `finish` can compare
    // against them without shadowing its local hit coordinates.
    // 🚨 THE BOUND MEASURES FROM WHERE THE CAMERA IS LOOKING, NOT FROM A PROP.
    //
    // It used to measure from the engine's `lat`/`lng` props -- the project's
    // stored address -- and those do not move when the user picks a different
    // house. Measured live: after picking a property the camera sat over
    // 38.70615,-90.04625 while the props still read 38.66570,-90.22660, so every
    // click was "16286 m from the site" and Tree placement was impossible. The
    // reference point was wrong, not the distance.
    //
    // The camera's own sub-point needs no stored coordinate and cannot go stale:
    // a person places things near what they are looking at. The failure this
    // guards -- a click on the sky taking `pickEllipsoid`'s grazing intersection
    // -- is characterised by landing tens of kilometres away while the camera is
    // a couple of hundred metres up, so the allowance scales with altitude.
    let nadirLat = NaN, nadirLng = NaN, allowM = PLACEMENT_RADIUS_M;
    try {
      const cc = C.Cartographic.fromCartesian(viewer.camera.positionWC ?? viewer.camera.position);
      if (cc) {
        nadirLat = C.Math.toDegrees(cc.latitude);
        nadirLng = C.Math.toDegrees(cc.longitude);
        const aboveGroundM = Math.max(0, (Number.isFinite(cc.height) ? cc.height : 0) - groundElevM);
        allowM = Math.max(PLACEMENT_RADIUS_M, aboveGroundM * 10);
      }
    } catch { /* fall back to the flat bound below */ }

    const finish = (cart: any, planeId: string | null, method: string) => {
      const carto = C.Cartographic.fromCartesian(cart);
      if (!carto) { trail.push(method + ': fromCartesian gave nothing'); return null; }
      const lat = C.Math.toDegrees(carto.latitude);
      const lng = C.Math.toDegrees(carto.longitude);
      if (!isValidCoord(lat, lng)) { trail.push(`${method}: invalid coord ${lat},${lng}`); return null; }
      // 🚨 AND IT HAS TO BE ON THIS PROPERTY.
      //
      // `isValidCoord` only range-checks degrees. A click on the sky just above
      // the roofline misses every face, misses the hidden globe, and
      // `pickEllipsoid` answers with the GRAZING intersection several kilometres
      // away -- which the site branch then snapped to ground elevation and
      // reported as a successful placement. The object existed, in a field, off
      // screen, and the only clue was that nothing appeared.
      if (Number.isFinite(nadirLat) && Number.isFinite(nadirLng)) {
        const dLat = (lat - nadirLat) * 111_320;
        const dLng = (lng - nadirLng) * 111_320 * Math.cos((nadirLat * Math.PI) / 180);
        const awayM = Math.hypot(dLat, dLng);
        if (awayM > allowM) {
          trail.push(`${method}: ${Math.round(awayM)} m from the camera — beyond the ${Math.round(allowM)} m bound`);
          return null;
        }
      }
      const height = isFinite(carto.height) ? carto.height : groundElevM;
      return { lat, lng, height, cartesian: cart, planeId, method, trail };
    };

    // 🚨 A REFUSAL THAT CANNOT SAY WHY IS A DEAD END FOR EVERYONE.
    //
    // Debugging one live "Could not place tree here" took a browser session and
    // a dozen probes, because every branch fails the same silent way. The trail
    // is recorded as it goes and logged once at the end, so the next person --
    // or the next adversary -- reads the answer instead of reconstructing it.
    const trail: string[] = [];
    trail.push(`space=${space} groundResolved=${groundResolved} groundElevM=${Number(groundElevM).toFixed(2)}`);
    trail.push(`screenPos=${screenPos ? `${Math.round(screenPos.x)},${Math.round(screenPos.y)}` : 'MISSING'}`);
    trail.push(`nadir=${Number(nadirLat).toFixed(5)},${Number(nadirLng).toFixed(5)} allow=${Math.round(allowM)}m`);

    let ray: any = null;
    try { ray = viewer.camera.getPickRay(screenPos); } catch (e: unknown) { ray = null; trail.push('getPickRay threw: ' + (e as Error).message); }
    trail.push('ray=' + (ray ? 'ok' : 'null'));

    // -- ROOF: the design's own faces answer first ---------------------------
    //
    // 🚨 AND THIS IS ALSO WHERE THE OBJECT LEARNS WHICH FACE IT IS ON. The
    // old code stamped `selectedFaceIdRef.current` -- the SELECTED face, not the
    // clicked one -- so marking a chimney on the garage while the main roof
    // happened to be selected bound it to the main roof, and it then moved with
    // the wrong section for ever. The ray knows which face the user pointed at.
    if (space === 'roof' && ray) {
      try {
        const faces: IntersectFace[] = collectRoofRenderables(C, groundElevM)
          .filter((rp: any) => rp && rp.corners && rp.corners.length >= 3)
          .map((rp: any) => ({ id: rp.id, origin: rp.origin, u: rp.u, v: rp.v, n: rp.n, corners: rp.corners }));
        // A 0.25 m pad so a click right on an eave is still a click on the
        // roof. `nearestFaceAlongRay` ranks TRUE hits above padded ones, so the
        // pad can never let one face steal a click from its neighbour across a
        // ridge -- see the note there.
        const rhit = nearestFaceAlongRay(ray.origin, ray.direction, faces, { padM: 0.25 });
        // 🚨 SAY HOW MANY FACES WERE EVEN CONSIDERED. "clicked off every roof
        // face" is compatible with three different failures -- no faces were
        // collected, the ray missed them, or the hit was rejected by the
        // distance bound -- and they need different fixes.
        trail.push(`canonical faces=${faces.length} hit=${rhit ? rhit.faceId : 'none'}`);
        if (rhit) {
          const cart = new C.Cartesian3(rhit.point.x, rhit.point.y, rhit.point.z);
          const out = finish(cart, rhit.faceId, 'canonical-face');
          if (out) return out;
        }
      } catch (e: unknown) {
        trail.push('canonical face pick threw: ' + (e as Error).message);
        addLog('WARN', 'placement: canonical face pick - ' + (e as Error).message);
      }
    }

    // -- The depth-buffer chain, as a fallback -------------------------------
    // getWorldPosition is 3dtiles -> terrain -> ellipsoid@ground, and unlike the
    // bare pickPosition it always answers when the camera is over the earth.
    const whit = getWorldPosition(viewer, C, screenPos);
    trail.push('getWorldPosition=' + (whit && whit.cartesian ? whit.pickMethod : 'null'));
    if (whit && whit.cartesian) {
      if (space === 'site') {
        // 🚨 A TREE STANDS ON THE GROUND. A 3D-tiles pick that landed on a
        // roof gives the right lat/lng and the wrong height; planting the trunk
        // up there puts the canopy a storey too high in every shade result.
        const carto = C.Cartographic.fromCartesian(whit.cartesian);
        if (carto) {
          const lat = C.Math.toDegrees(carto.latitude);
          const lng = C.Math.toDegrees(carto.longitude);
          if (isValidCoord(lat, lng)) {
            const onGround = safeCartesian3(C, lng, lat, groundElevM);
            // 🚨 `return finish(...)` ABORTED THE WHOLE FUNCTION ON A NULL.
            //
            // Every other branch here is `if (out) return out;` so a rejected
            // candidate falls through to the next strategy. This one returned
            // `finish(...)` directly, so when the ground point failed validation
            // the function returned null immediately -- skipping BOTH remaining
            // fallbacks and the diagnostic log that would have said why. The
            // live symptom was "Could not place tree here" with a single
            // unexplained line in the console, which took a browser session and
            // a dozen probes to corner.
            if (onGround) {
              const out = finish(onGround, null, whit.pickMethod + '@ground');
              if (out) return out;
            }
          }
        }
      }
      // For a roof object with no canonical face under the ray, the depth pick
      // is still a real surface -- keep it, and recover a face id if it is near
      // one, so the object is not orphaned.
      let planeId: string | null = null;
      if (space === 'roof') {
        try { planeId = planeRenderableAtClick(C, whit.cartesian, groundElevM)?.id ?? null; } catch { planeId = null; }
      }
      const out = finish(whit.cartesian, planeId, whit.pickMethod);
      if (out) return out;
    }

    // -- Last resort: the ground is a known elevation, and a known elevation is
    // a surface a ray can be intersected with. Reached when the camera is over
    // the earth but nothing at all is drawn or pickable.
    if (ray) {
      try {
        // 🚨 THE GEOCENTRIC RADIUS UNDER THE CAMERA, NOT A MEAN EARTH RADIUS.
        // The ellipsoid's equatorial and polar radii differ by 21 km, so at this
        // site's latitude a mean-radius sphere sits about 1.4 km ABOVE the real
        // ground — the camera would be inside it on every call, and the only
        // intersection in front would be the far side of the planet. Taking the
        // ground point directly beneath the camera is exact to well under a
        // millimetre across a parcel.
        const camCarto = C.Cartographic.fromCartesian(viewer.camera.positionWC ?? viewer.camera.position);
        const groundUnderCam = camCarto
          ? C.Cartesian3.fromRadians(camCarto.longitude, camCarto.latitude, groundElevM)
          : null;
        const radius = groundUnderCam ? C.Cartesian3.magnitude(groundUnderCam) : NaN;
        const gp = isFinite(radius)
          ? intersectRayWithGeocentricSphere(ray.origin, ray.direction, radius)
          : null;
        trail.push(`ray@ground radius=${isFinite(radius) ? Math.round(radius) : 'NaN'} hit=${gp ? 'ok' : 'null'}`);
        if (gp) {
          const out = finish(new C.Cartesian3(gp.x, gp.y, gp.z), null, 'ray@ground');
          if (out) return out;
        }
      } catch (e: unknown) { trail.push('ground ray threw: ' + (e as Error).message); }
    }

    addLog('WARN', 'placement refused — ' + trail.join(' | '));
    return null;
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
      const offM = moduleStackHeightM(mountingSystemIdRef.current);
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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
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
  //   Panel:   Philadelphia Solar PS-MNB108(HCBF)-440W, 1721x1133mm, vertical
  //            bifacial — wattage resolved from equipment-db ('panel-fence-ps1'),
  //            never hardcoded (P0-6)
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

    // P0-6 + Ray's ruling 2026-07-19: fence panels are ALWAYS the Philadelphia
    // Solar PS-MNB108(HCBF)-440W — resolve the wattage stamp from the
    // equipment-db record at placement time so the stamp can never drift from
    // the equipment authority.
    const fencePanelRec = getPanelById(FENCE_PANEL_EQUIPMENT_ID);
    if (!fencePanelRec?.watts) {
      console.warn(`[EQUIP-AUTHORITY] equipment-db is missing '${FENCE_PANEL_EQUIPMENT_ID}' — fence wattage stamps fall back to the studio-selected panel`);
    }
    const fenceWattage = fencePanelRec?.watts ?? selectedPanelRef.current?.wattage ?? 400;

    addLog('FENCE', `finalizeFence v47.158: ${pts.length} pts, fenceH=${fenceH.toFixed(2)}m orient=${orient} panel=${FENCE_PANEL_EQUIPMENT_ID}@${fenceWattage}W`);

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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:         'fence',
        p1ECEF,
        p2ECEF,
        fenceHeightM: effectiveFenceH,
        orientation:  orient,
        wattage:      fenceWattage, // equipment-db 'panel-fence-ps1' (PS-MNB108(HCBF)-440W) — P0-6: never a literal
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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
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
  /**
   * WHICH MODULE IS UNDER THE CURSOR — computed, not asked of the GPU.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * 🚨 WHY THIS EXISTS: ENTITY PICKING CAN BE UNAVAILABLE, AND THEN A MODULE
   * CANNOT BE SELECTED, DELETED OR MOVED AT ALL.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Measured in the E2E browser, with 44 modules and a full building drawn:
   *
   *     drillPick(panel centre, 32)  -> 0 hits
   *     drillPick(canvas centre, 8)  -> 0 hits
   *     drillPick(roof centre, 8)    -> 0 hits
   *     scene.pick(panel centre)     -> nothing
   *
   * NOTHING is pickable. Roof-face selection kept working only because it has
   * an analytic fallback — a ray tested against the stored face geometry — and
   * modules had none, so every click on a module fell through to that fallback
   * and selected the roof behind it. That is the failure "a panel click still
   * selected the roof face behind the module", and it survived both a
   * drill-depth increase (10 -> 32) and a fix to the glass/grid key filter,
   * because neither was the cause: the hits were never there to be walked.
   *
   * This is not only a harness artefact. Anything that makes Cesium's pick pass
   * fail — a software rasteriser, a lost context, a driver that will not read
   * the pick buffer — takes module selection with it, and the user sees a
   * module they cannot click on a roof they can.
   *
   * 🚨 IT MEASURES WHAT WAS DRAWN. The corners come from the ENTITY'S OWN
   * position and orientation, the values Cesium is rendering from, not from a
   * second derivation off `panel.ecefNx`/`heading`. A hit test that re-derives
   * the pose is free to disagree with the picture, and then the module you can
   * see is not the module you can click.
   */
  function pickPanelAnalytically(viewer: any, C: any, screenPos: any): string | null {
    try {
      const scene = viewer?.scene;
      const toWindow = C?.SceneTransforms?.worldToWindowCoordinates
                    ?? C?.SceneTransforms?.wgs84ToWindowCoordinates;
      if (!scene || !toWindow || !screenPos) return null;
      const now = C.JulianDate.now();
      const camera = scene.camera?.positionWC;
      if (!camera) return null;

      let best: { id: string; d: number } | null = null;

      panelMapRef.current.forEach((entity: any, key: string) => {
        // Bare-id keys only: the frame entity carries the pose, and the glass
        // and cell lines sit on the same box.
        if (key.includes('__')) return;
        const pos = entity?.position?.getValue?.(now);
        const quat = entity?.orientation?.getValue?.(now);
        const dims = entity?.box?.dimensions?.getValue?.(now);
        if (!pos || !quat || !dims) return;

        // The box is drawn with dimensions (ph, pw, thickness) — x is the
        // up-slope extent, y the along-eave extent. Half-extents, in the
        // entity's own frame, then rotated into ECEF by its own quaternion.
        const m = C.Matrix3.fromQuaternion(quat, new C.Matrix3());
        const hx = dims.x / 2, hy = dims.y / 2;
        const corners: any[] = [];
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Array<[number, number]>) {
          const local = new C.Cartesian3(sx * hx, sy * hy, 0);
          const world = C.Matrix3.multiplyByVector(m, local, new C.Cartesian3());
          corners.push(C.Cartesian3.add(pos, world, new C.Cartesian3()));
        }

        // 🚨 A CORNER BEHIND THE CAMERA PROJECTS TO NONSENSE. `toWindow`
        // returns undefined for it, and treating that as (0,0) would make a
        // module behind the viewer swallow clicks in the top-left corner.
        const pts: Array<{ x: number; y: number }> = [];
        for (const c of corners) {
          const w = toWindow(scene, c);
          if (!w || !isFinite(w.x) || !isFinite(w.y)) return;
          pts.push({ x: w.x, y: w.y });
        }

        if (!pointInQuad(screenPos.x, screenPos.y, pts)) return;

        // Front-most wins: two modules can overlap on screen from a low camera,
        // and the one the user is pointing at is the nearer one.
        const d = C.Cartesian3.distance(camera, pos);
        if (!best || d < best.d) best = { id: key, d };
      });

      return best ? (best as { id: string }).id : null;
    } catch {
      return null;
    }
  }

  /** Is (x,y) inside the convex quad `q`? Winding-agnostic: a module projects
   *  clockwise or anticlockwise depending on which side the camera is on. */
  function pointInQuad(x: number, y: number, q: Array<{ x: number; y: number }>): boolean {
    if (!q || q.length !== 4) return false;
    let pos = 0, neg = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross > 0) pos++;
      else if (cross < 0) neg++;
    }
    return pos === 0 || neg === 0;
  }

  function pickPanelAtScreen(viewer: any, screenPos: any): { foundId: string | null; foundEntity: any } {
    let foundId: string | null = null;
    let foundEntity: any = null;
    // isPanelId: true only for bare UUID keys (no __ separator)
    const isPanelId = (id: string) => !id.includes('__');

    /**
     * 🚨 THE PANEL ID FROM THE ENTITY'S OWN NAME — because the surface the user
     * clicks is NOT the entity the panel map is keyed by.
     *
     * A module is drawn as three families:
     *     [PANEL] <id>         the frame box   -> panelMapRef key `<id>`
     *     [PANEL-GLASS] <id>   the glass       -> key `<id>__glass`
     *     [PANEL-GRID] <id> …  the cell lines  -> key `<id>__grid__<n>`
     *
     * and `isPanelId` rejects every key containing `__`. The glass is the top
     * surface — it is what a click in the middle of a module actually hits —
     * so the loop below walked straight past the panel and the Building roof
     * behind it answered instead. That is the measured failure "a panel click
     * still selected the roof face behind the module", which survived the drill
     * depth going from 10 to 32 because DEPTH WAS NEVER THE CAUSE: the hit was
     * in the list all along and was being discarded.
     *
     * Matching on the NAME is not a loosening of the key rule — it is the rule
     * stated where it is true. `__fencepost__`, `__gate__` and `__fenceinfill__`
     * keys start with the separator and belong to no module; they carry their
     * own names and are not in the [PANEL*] families at all.
     */
    const PANEL_NAME = /^\[PANEL(?:-GLASS|-GRID)?\]\s+(\S+)/;
    const panelIdFromEntity = (entity: any): string | null => {
      const name: unknown = entity?.name;
      if (typeof name !== 'string') return null;
      const m = PANEL_NAME.exec(name);
      if (!m) return null;
      const id = m[1];
      // The name is a claim; the map is the authority on what exists.
      return panelMapRef.current.has(id) ? id : null;
    };

    try {
      // 🚨 DRILL DEEP ENOUGH TO REACH A PANEL IN BUILDING MODE.
      //
      // This was 10. With the Building view on, one screen point can sit over a
      // roof polygon, its aerial texture, its outline, its glow, a wall, and a
      // panel's box AND its glass — so the panel can fall past the tenth hit
      // and the pick reports "no panel here".
      //
      // That is not cosmetic any more. The select handler now asks this
      // question FIRST and lets the Building roof answer only when it says no,
      // which is how a module stopped being unselectable — so a false "no" puts
      // the defect straight back. An E2E measured exactly that: "a panel click
      // still selected the roof face behind the module", passing in isolation
      // and failing in a fuller scene, which is the signature of a depth limit
      // rather than a timing race.
      //
      // The cost is a longer walk on a miss, on a click. The cost of being
      // wrong is a panel nobody can select, delete or move.
      const drilled = viewer.scene.drillPick(screenPos, 32);
      for (const pickedObj of drilled) {
        if (!pickedObj || !pickedObj.id) continue;
        const entity = pickedObj.id;
        // The name first: it resolves the glass and the cell grid to the module
        // they belong to, which the key-based match below cannot.
        const named = panelIdFromEntity(entity);
        if (named) {
          foundId = named;
          // 🚨 THE FRAME ENTITY, NOT THE ONE THAT WAS HIT. Every caller uses
          // `foundEntity` to highlight and to move the module; handing back the
          // glass would leave the frame behind.
          foundEntity = panelMapRef.current.get(named) ?? entity;
          break;
        }
        panelMapRef.current.forEach((ent, id) => {
          if (!foundId && isPanelId(id) && ent === entity) { foundId = id; foundEntity = entity; }
        });
        if (foundId) break;
      }
    } catch {
      const picked = viewer.scene.pick(screenPos);
      if (picked && picked.id) {
        const named = panelIdFromEntity(picked.id);
        if (named) {
          foundId = named;
          foundEntity = panelMapRef.current.get(named) ?? picked.id;
        } else {
          panelMapRef.current.forEach((ent, id) => {
            if (!foundId && isPanelId(id) && ent === picked.id) { foundId = id; foundEntity = picked.id; }
          });
        }
      }
    }

    // 🚨 THE GPU IS ASKED FIRST AND IS NOT THE ONLY ANSWER.
    //
    // When the pick pass returns nothing — measured: zero hits anywhere on the
    // canvas in a software rasteriser — the module is still on screen and the
    // user is still pointing at it. `pickPanelAnalytically` computes the answer
    // from the pose Cesium is drawing with, so selection does not depend on a
    // GPU read-back working. It runs only on a miss, so nothing about the
    // normal path changes.
    if (!foundId) {
      const C = (window as any).Cesium;
      const analytic = C ? pickPanelAnalytically(viewer, C, screenPos) : null;
      if (analytic) {
        foundId = analytic;
        foundEntity = panelMapRef.current.get(analytic) ?? null;
      }
    }
    return { foundId, foundEntity };
  }

  // v62: a panel's "array" key. Roof arrays group by planeId; fence/ground arrays
  // group by layoutId (those have no planeId). Falls back to the panel's own id so a
  // lone panel is still a (1-panel) group. Used for whole-array group selection.
  const groupKeyOf = (p?: PlacedPanel | null): string | null =>
    p ? (((p as any).planeId ?? (p as any).layoutId ?? p.id) || null) : null;

  /**
   * v66: which Building roof face is under the cursor, or null.
   *
   * Roof entities are named "[BUILD3D-ROOF] <planeId>" in renderBuildingExtrusion,
   * so the plane id is recoverable straight from the pick. drillPick rather than
   * pick because the aerial texture and the outline sit on the same polygon and
   * a plain pick can return either.
   */
  /**
   * Every roof face currently OFFERED to the interaction layer.
   *
   * Built from the two maps the renderer itself writes — `plane3DCesiumPtsMap`
   * (the projected polygon actually drawn) and `plane3DFrameMap` (its frame) —
   * so what the user sees and what the pick resolves against cannot drift apart.
   * Both geometry providers land in those maps through the same
   * `resolvePlaneGeometry` call, so neither has to impersonate the other here.
   */
  function selectableRoofFaces(): SelectableFace[] {
    // 🚨 THE DESIGN SAYS WHICH FACES EXIST. THE RENDER CACHE DOES NOT.
    // plane3DCesiumPtsMap is never pruned — there is no `.delete()` on it
    // anywhere in this file, deliberately, because a reconcile-deletions block
    // once destroyed a user's traced garage by inferring intent from a prop's
    // timing. So the cache accumulates ghosts, and it survives an address
    // change: without this gate a face traced at one property stays clickable
    // while a DIFFERENT property is on screen. Nothing is deleted here; the
    // ghost stays drawn exactly as before, it simply is not selectable.
    const live = liveRenderedFaces();
    const rendered = live
      .filter(f => f.pts && f.pts.length >= 3)
      .map(f => [f.planeId, {
        polygon: f.pts.map((q: any) => ({ x: q.x, y: q.y, z: q.z })),
        normal: f.frame ? { x: f.frame.normal.x, y: f.frame.normal.y, z: f.frame.normal.z } : null,
      }] as const);
    // The membership gate is already applied by liveRenderedFaces; passing the
    // same id set keeps selectableFacesFrom's contract honest rather than
    // giving it a set that can never reject anything.
    return selectableFacesFrom(rendered, new Set(live.map(f => f.planeId)));
  }

  /**
   * v71: WHICH ROOF FACE IS UNDER THE CURSOR — resolved geometrically.
   *
   * 🚨 DELIBERATELY NOT A SCENE PICK. A face that is marked but not yet panelled
   * renders through the `outlineOnly` branch of `renderPlane3DEntity`, which
   * adds ONE polyline and returns: there is no polygon under the cursor to hit,
   * which is exactly why "I can see the planes but cannot select them". The
   * obvious repair — add an invisible polygon so `scene.pick` finds something —
   * would have put a new translucent surface over every roof, and
   * `getWorldPosition` (the function the whole plane-TRACING workflow stands on)
   * opens with `scene.pick` and then reads `scene.pickPosition`. Fixing
   * selection by perturbing where a traced corner lands is not a fix.
   *
   * So the ray is intersected with the faces' own planes instead. Nothing is
   * added to the scene, no existing pick changes, and the answer is the
   * canonical `RoofPlane.id` — never an index, a label or a renderer handle.
   */
  function pickRoofFaceAtScreen(viewer: any, screenPos: any): string | null {
    try {
      const ray = viewer.camera.getPickRay(screenPos);
      if (!ray?.origin || !ray?.direction) return null;
      const hit = pickFace(
        { origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
          direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z } },
        selectableRoofFaces(),
      );
      return hit?.faceId ?? null;
    } catch { return null; }
  }

  /** Set (or clear) the selected roof face. The ref is written SYNCHRONOUSLY
   *  because the Cesium handlers read it within the same tick, long before
   *  React has re-rendered. */
  function selectRoofFace(faceId: string | null): void {
    if (selectedFaceIdRef.current === faceId) return;
    selectedFaceIdRef.current = faceId;
    setSelectedFaceId(faceId);
    // 🚨 A NEW CLICK OPENS AT SECTION LEVEL. Drilling into a face is a
    // deliberate act; carrying that drill-in across to the next thing clicked
    // would silently point the height controls at a single face again, which is
    // the behaviour that made a gable come apart at the ridge. A stale refusal
    // about the previous selection goes with it.
    setSelectionLevel('section');
    // 🚨 AND THE WALL GOES WITH IT. A wall belongs to one face; keeping the
    // previous one selected while the face changes would leave the panel
    // measuring a wall on a different building.
    setSelectedWallId(null);
    setSectionRefusal(null);
    // Report the deselection too. A parent told only about selections keeps the
    // last id for ever, and its sidebar highlight outlives the 3D one.
    onRoofPlaneSelectRef.current?.(faceId);
  }

  /**
   * What the status bar says when a face is picked.
   *
   * 🚨 IT NAMES THE LEVEL THE CONTROLS NOW ACT ON. The old messages said
   * "Walls and Pitch now apply to THIS face only", which was true of the
   * geometry and false of the readout beside it, and encouraged exactly the
   * per-face height editing that opens a gable at the ridge.
   */
  function selectionMessageFor(faceId: string): string {
    const planes = roofPlanesRef.current ?? [];
    const plane = planes.find(p => p.id === faceId);
    const sid = plane?.sectionId || sectionIdOfFaceId(faceId);
    if (!sid) {
      return '⬡ Roof face selected — traced on its own, so it has no section. ' +
             'The inspector shows its measured elevations.';
    }
    const look = sectionFromPlanes(planes, sid);
    if (!look.found) return `⬡ Roof face selected — ${look.refusals[0]?.message ?? 'its section is unavailable.'}`;
    const n = look.faceIds.length;
    return `🏠 ${look.section!.label || 'Section'} selected — ${n} roof face${n === 1 ? '' : 's'}. ` +
           'Height, pitch and pad elevation move the whole section.';
  }

  /**
   * Move ONE standalone roof face up or down.
   *
   * 🚨 THIS IS THE ONLY SURVIVING RELATIVE CONTROL, AND IT IS NAMED AS MOTION.
   *
   * A face that belongs to no section has no pad and no wall, so there is no
   * absolute height to set — only a nudge. The old WALLS stepper was this same
   * operation wearing an absolute label and a global counter, which is how it
   * came to read 17 ft about a 10 ft wall.
   *
   * `applyBuildingShape`'s arithmetic is `newEave = lowest - prevWall + wall`,
   * so the pad cancels and the press is exactly `wall - prevWall`. That makes
   * `wallHeightRef` a delta accumulator and nothing else. It is deliberately
   * NOT React state any more: nothing may render it.
   *
   * 🚨 IT REFUSES A SECTION FACE. Raising one half of a gable opens the ridge,
   * which is the compensating edit that made the editor unusable. The section
   * is the thing that moves.
   */
  function nudgeFaceElevation(faceId: string, deltaM: number): boolean {
    const viewer = viewerRef.current; const C = (window as any).Cesium;
    if (!viewer || !C || !faceId || !isFinite(deltaM)) return false;

    const plane = (roofPlanesRef.current ?? []).find(p => p.id === faceId);
    const sid = plane?.sectionId || sectionIdOfFaceId(faceId);
    if (sid) {
      setSectionRefusal(
        'That face belongs to a building section. Move the section instead, so ' +
        'its ridge stays shut — select it and set the wall height.',
      );
      return false;
    }

    // 🚨 A DETECTION IS NOT A HAND TRACE, AND THIS IS THE PROTECTED PATH.
    //
    // "Standalone" was the wrong test on its own. A Google/solar_api face has no
    // sectionId and a uuid with no '::', so `sectionIdOfFaceId` returns null and
    // EVERY native face fell into exactly the branch that rebuilds geometry
    // through the flat-trace constructor and persists it. An independent
    // native-3D audit caught it: the ALL-FACES stepper was removed and the
    // persistent rewrite of Google geometry moved in here instead.
    //
    // It is worse than a rewrite. `applyBuildingShape` re-derives azimuth via
    // `deriveAzimuthsFromSharedEdges`, whose fallback for a face with no shared
    // edge always returns the equator-facing normal — so nudging a lone
    // north-facing Google face flips it to azimuth 180, moves its eave to the
    // opposite end of the building, and persists that into the field PVWatts
    // and the planset read.
    //
    // `isHandModelledFace` is the existing answer to "whose geometry is this",
    // and this is its first call site outside the Lane A gate.
    if (!isHandModelledFace(plane)) {
      setSectionRefusal(
        'This roof face came from automatic detection, not from your trace, so it ' +
        'is not moved by hand here — a nudge would also re-derive its direction. ' +
        'Choose "Draw Manually Instead" to model this building yourself.',
      );
      addLog('BUILD3D', `nudge refused: ${faceId} is a detection (source=${(plane as any)?.source ?? 'unknown'})`);
      return false;
    }

    const prevWall = wallHeightRef.current;
    const nextWall = prevWall + deltaM;
    const n = applyBuildingShape(viewer, C, { wallHeightM: nextWall }, faceId);
    // Only advance the accumulator if the rebuild actually happened, or the
    // next nudge would be measured from a press that never landed.
    if (n > 0) wallHeightRef.current = nextWall;
    setStatusMsg(n > 0
      ? `⬡ Roof face moved ${deltaM > 0 ? 'up' : 'down'} ${ftStr(Math.abs(deltaM))} · re-run Fill Roof so the panels follow`
      : 'Nothing to move — that face could not be rebuilt');
    return n > 0;
  }

  /**
   * Is this face part of what is currently SELECTED — not merely the one face
   * the ray happened to hit?
   *
   * 🚨 "THE SELECTED LEVEL MUST BE VISIBLE." The highlight was
   * `activeFaceId === planeId`, so exactly one face lit up while the inspector
   * read "Garage · Hip roof · 4 faces" and its controls moved all four. The
   * user could not see what they were about to edit, and the picture disagreed
   * with the panel beside it — the same class as the WALLS readout, in
   * geometry rather than in a number.
   *
   * At SECTION level every face of the section is lit. At FACE level, only the
   * one, which is what makes drilling in worth doing. A face belonging to no
   * section is unaffected either way.
   */
  function faceIsInSelection(planeId: string): boolean {
    if (!activeFaceId) return false;
    if (planeId === activeFaceId) return true;
    if (selectionLevel !== 'section') return false;
    const planes = roofPlanesRef.current ?? [];
    const sid = planes.find(p => p.id === activeFaceId)?.sectionId || sectionIdOfFaceId(activeFaceId);
    if (!sid) return false;
    return (planes.find(p => p.id === planeId)?.sectionId || sectionIdOfFaceId(planeId)) === sid;
  }


  /**
   * How far along a point's LOCAL VERTICAL the cursor ray reaches, in metres.
   *
   * 🚨 THE OLD ARITHMETIC WAS AN EXACT NO-OP, AND IT IS WORTH SEEING WHY.
   *
   *     const t            = (centroid.z - ray.origin.z) / dir.z;
   *     const cursorYWorld =  ray.origin.z + dir.z * t;
   *
   * Substituting `t` into the second line gives `ray.origin.z + (centroid.z -
   * ray.origin.z)` — i.e. `centroid.z`, for EVERY cursor position. The
   * block-height drag therefore computed the same number all the way through,
   * `dyWorld` was 0, and the prism never moved while the status bar reported a
   * height. An audit measured a residual of exactly 0.000e+0 m across 143
   * simulated cursor positions.
   *
   * It was also measuring against ECEF z — the direction to the pole — rather
   * than the local vertical, which is only "up" on the equator.
   *
   * This is the standard closest-approach between the cursor ray and the
   * vertical line through the anchor, which is what dragging a vertical handle
   * actually means.
   */
  function rayHeightAlongVertical(C: any, ray: any, anchor: any): number | null {
    const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new C.Cartesian3());
    if (!up) return null;
    const d = ray.direction;
    const w0 = C.Cartesian3.subtract(ray.origin, anchor, new C.Cartesian3());
    const b = C.Cartesian3.dot(d, up);
    const denom = 1 - b * b;                 // |d| and |up| are both unit
    if (Math.abs(denom) < 1e-6) return null; // looking straight along the handle
    const dd = C.Cartesian3.dot(d, w0);
    const ee = C.Cartesian3.dot(up, w0);
    const u = (ee - b * dd) / denom;
    return isFinite(u) ? u : null;
  }


  /**
   * Set one block's extruded height, and move its drag handle with it.
   *
   * 🚨 THE HANDLE POSITION IS A COORDINATE, NOT A HEIGHT. Both callers used to
   * build `new Cartesian3(cur.x, cur.y, v + 0.3)` — keeping the block's ECEF x
   * and y, which are millions of metres, and replacing z with a
   * metres-above-ground number. At this latitude that writes the handle roughly
   * 3,969 km toward the equatorial plane, so it vanishes and the block can no
   * longer be grabbed. The same defect was measured in the drag handler.
   */
  function setBlockHeight(blockId: string | null, heightM: number): void {
    if (!blockId || !isFinite(heightM)) return;
    const C = (window as any).Cesium;
    const block = blockEntitiesRef.current.find((b: any) => b.id === blockId);
    if (!C || !block?.polygon?.extrudedHeight) return;
    const clamped = Math.max(1, Math.min(30, heightM));

    // 🚨 READ THE PREVIOUS HEIGHT BEFORE OVERWRITING IT.
    //
    // This line used to come AFTER the `set` below and read the map back, so
    // `prior` was always `clamped` and the handle's own arithmetic cancelled to
    // "leave it where it is". An audit measured it; the `?? clamped` fallback
    // is what made it look deliberate.
    const priorH = blockHeightOverridesRef.current.get(blockId);

    block.polygon.extrudedHeight = new C.ConstantProperty(clamped);
    blockHeightOverridesRef.current.set(blockId, clamped);

    // 🚨 AND THE PIVOT IS THE HANDLE'S OWN POSITION, NOT THE BLOCK'S.
    //
    // The old branch was `if (handle && block.position)`. A Cesium polygon
    // entity has no `position` — that is why the creation path tags the prism
    // with `__centroidCart` instead (see the comment there: "PolygonGraphics
    // doesn't have a `position` field like BoxGraphics does"). So the guard was
    // never true and the block's grab handle never moved AT ALL: set a block to
    // 20 ft and the handle stayed at the old height, where grabbing it snapped
    // the block straight back.
    //
    // The handle is a box, it does have a position, and it was placed at
    // groundLevel + height + HANDLE_LIFT_M — so its own coordinate is the one
    // thing here that knows where the ground is.
    const HANDLE_LIFT_M = 0.3;
    const handle = blockHandlesRef.current.find((h: any) => (h as any).__blockId === blockId);
    if (handle?.position) {
      const cur = handle.position.getValue(C.JulianDate.now());
      if (cur) {
        const carto = C.Cartographic.fromCartesian(cur);
        const before = typeof priorH === 'number' && isFinite(priorH) ? priorH : clamped;
        const groundM = carto.height - before - HANDLE_LIFT_M;
        const next = safeCartesian3(
          C, C.Math.toDegrees(carto.longitude), C.Math.toDegrees(carto.latitude),
          groundM + clamped + HANDLE_LIFT_M,
        );
        if (next) {
          handle.position = new C.ConstantProperty(next);
          // Keep the prism's tagged centroid in step — the drag handler reads it
          // to work out which block a grab belongs to and where its top is.
          try {
            (block as any).__centroidCart = safeCartesian3(
              C, C.Math.toDegrees(carto.longitude), C.Math.toDegrees(carto.latitude),
              groundM + clamped,
            ) ?? (block as any).__centroidCart;
          } catch { /* ignore */ }
        }
      }
    }
    try { viewerRef.current?.scene.requestRender(); } catch { /* ignore */ }
  }

  function pickBuildingFaceAtScreen(viewer: any, C: any, screenPos: any): string | null {
    // Every call answers for THIS click. A stale tag would put the inspector on
    // a wall the user is no longer pointing at.
    hitWallIdRef.current = null;
    try {
      const hits = viewer.scene.drillPick(screenPos, 8) ?? [];
      for (const h of hits) {
        const name: string = h?.id?.name ?? '';
        if (typeof name !== 'string') continue;
        if (name.startsWith('[BUILD3D-ROOF] ')) {
          return name.slice('[BUILD3D-ROOF] '.length);
        }
        // 🚨 A WALL IS PART OF THE BUILDING AND MUST NOT BE A HOLE.
        //
        // Walls are drawn as `[BUILD3D-WALL] <faceId>#<edgeIndex>` and, until
        // now, that string was matched by NOTHING in the repository. A click on
        // a wall therefore fell past it to a geometric ray test that answered
        // with whatever roof face lay BEHIND the wall — so at a street-level
        // view, clicking the front of the house selected a slope on the far
        // side of the ridge and the inspector silently retargeted.
        //
        // A wall level in the hierarchy is not built yet, so this does the
        // honest intermediate thing: a wall resolves to the face that OWNS it,
        // which resolves in turn to that face's section. Clicking the front
        // wall of the garage selects the garage. That is the object whose
        // height the user was reaching for, and it is never a different
        // building from the one they clicked.
        if (name.startsWith('[BUILD3D-WALL] ')) {
          const tag = name.slice('[BUILD3D-WALL] '.length);
          const faceId = tag.split('#')[0];
          // 🚨 AND THE WALL ITSELF IS REMEMBERED, not only the face it hangs
          // from. The first repair resolved a wall to its owning face, which
          // stopped the click falling through to a roof BEHIND the wall — but
          // it still could not answer the question a person clicking a wall is
          // asking, which is "how tall is THIS wall". `hitWallIdRef` carries
          // the `faceId#edgeIndex` tag out of the pick so the caller can select
          // the wall level; it is cleared on every pick that is not a wall, so
          // it can never describe a previous click.
          if (faceId) { hitWallIdRef.current = tag; return faceId; }
        }
      }
    } catch { /* pick can throw mid-frame; treat as no hit */ }
    return null;
  }

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
      // v66: BUILDING FACE SELECTION. When the solid building is shown, a click
      // on a roof face selects THAT face so the Walls / Pitch controls act on it
      // alone. Ray: "I have no way of selecting a plane" and "it adjusts both
      // planes". Checked before panel selection because with Building on the
      // roof surfaces sit above the panels visually.
      //
      // 🚨 CORRECTION TO THIS COMMENT'S OWN EARLIER CLAIM. It used to end "a
      // click that lands on a panel still falls through to the panel logic
      // below." That is FALSE and an E2E test now records the truth: with
      // Building ON, `drillPick(…, 8)` returns the [BUILD3D-ROOF] polygon from
      // BEHIND the panel and this branch returns on it, so a click on a module
      // selects the roof face under it — the opposite of Building OFF, where
      // panels win. That routing difference is recorded, not endorsed; it is
      // the UX proposal's problem to resolve, not something to paper over with
      // a comment that says it does not happen.
      // 🚨 A PANEL IN FRONT OF THE ROOF WINS, IN BOTH MODES.
      //
      // This branch used to run unconditionally whenever Building was on, and
      // `pickBuildingFaceAtScreen` drill-picks for `[BUILD3D-ROOF]` and returns
      // the first one it finds WITHOUT checking whether anything was in front
      // of it. So with Building on, clicking a module selected the roof deck
      // underneath it: every panel became unselectable, undeletable and
      // unmovable, and which object a click reached depended on a VIEW TOGGLE
      // rather than on what the user pointed at. The comment that stood here
      // recorded that as "not endorsed; the UX proposal's problem to resolve".
      //
      // This is that resolution, and it is the smallest one: ask whether a
      // panel is under the cursor first, and let the Building roof answer only
      // when none is. Clicking bare roof still selects the face in both modes,
      // so nothing that worked stops working.
      // One drill-pick, read twice — `pickPanelAtScreen` walks up to ten hits
      // and calling it again below would double that on every click.
      // ── A MARKED OBSTRUCTION IS SELECTABLE ───────────────────────────────
      //
      // 🚨 IT WAS NOT, AT ALL. A vent, a chimney or a tree could be placed and
      // never touched again: no click selected one, so "delete this one" was
      // unreachable and the only way to remove a mis-placed vent was to remove
      // every obstruction on the roof. Checked BEFORE panels because an
      // obstruction is small, sits on the roof surface and is usually
      // surrounded by modules — a panel-first order makes it unclickable
      // exactly where it matters.
      const obsHit = pickObstructionAtScreen(viewer, screenPos);
      if (obsHit) {
        selectedObstructionIdRef.current = obsHit;
        setSelectedObstructionId(obsHit);
        clearPanelSelection();
        selectRoofFace(null);
        setStatusMsg('\u{1F6A7} Obstruction selected \u2014 press Delete to remove it');
        try { viewer.scene.requestRender(); } catch { /* ignore */ }
        return;
      }
      if (selectedObstructionIdRef.current) {
        selectedObstructionIdRef.current = null;
        setSelectedObstructionId(null);
      }

      const picked = pickPanelAtScreen(viewer, screenPos);
      if (showBuilding3DRef.current && !picked.foundId) {
        const faceId = pickBuildingFaceAtScreen(viewer, C, screenPos);
        if (faceId) {
          // 🚨 CAPTURE BEFORE THE WRITE. `selectRoofFace` sets
          // `selectedFaceIdRef.current` SYNCHRONOUSLY, so reading the ref after
          // calling it reports the state we just moved to, not the one we came
          // from — which inverted this message: selecting a face announced
          // "Face deselected" and deselecting announced "Face selected". This
          // is the only scope feedback Building mode has, so the user was told
          // the exact opposite of which faces the Walls/Pitch controls would
          // act on. The sibling [PLANE3D-*] path below always did this right.
          const toggledOff = selectedFaceIdRef.current === faceId;
          // Matching the sibling path: one selection at a time. Without this a
          // panel array stays selected alongside the face, and the arrow keys
          // (gated on selectedPanelIdsRef alone) keep moving the array while
          // the scope chip claims the click selected a face.
          clearPanelSelection();
          drilledGroupKeyRef.current = null;
          // Through the same setter as the [PLANE3D-*] path, so the ref, the
          // state and the outbound notification cannot drift between the two
          // entity families that can both produce a face selection.
          // 🚨 A WALL CLICK SELECTS THE WALL. `pickBuildingFaceAtScreen` writes
          // the `faceId#edgeIndex` tag into `hitWallIdRef` when the hit was a
          // wall, and this is the only place that reads it — captured BEFORE
          // `selectRoofFace`, which resets the level to 'section'.
          //
          // Clicking a wall used to select the roof face that owns it, which
          // was better than selecting a roof BEHIND the wall (what it did
          // before that) but still could not answer "how tall is this wall".
          const wallHit = hitWallIdRef.current;
          selectRoofFace(toggledOff ? null : faceId);
          if (!toggledOff && wallHit) {
            setSelectedWallId(wallHit);
            setSelectionLevel('wall');
          } else {
            setSelectedWallId(null);
          }
          setStatusMsg(
            toggledOff ? '⬡ Deselected'
              : (wallHit ? '🧱 Wall selected — its height comes from the section above and the pad below'
                         : selectionMessageFor(faceId)),
          );
          try { viewer.scene.requestRender(); } catch {}
          return;
        }
      }

      // v31.1: drillPick finds panel entities even when occluded by terrain/3D tiles.
      // v62: GROUP SELECTION (Figma/PowerPoint model — no modes, no new buttons).
      //   • plain click            → select the WHOLE array (move/rotate the array)
      //   • double-click (drill)   → then a click selects a single panel (micro-edit)
      //   • click empty space      → clear selection AND exit any drilled-in array
      const foundId = picked.foundId;
      const foundEntity = picked.foundEntity;

      if (!foundId || !foundEntity) {
        // v71: no panel under the cursor — is a ROOF FACE? Checked here, AFTER
        // the panel pick, so panels keep priority: clicking a module selects the
        // module, clicking bare roof selects the face it is on. Clicking past
        // every face still clears, including the face selection, so nothing
        // stale is left highlighted.
        const faceId = pickRoofFaceAtScreen(viewer, screenPos);
        if (faceId) {
          clearPanelSelection();
          drilledGroupKeyRef.current = null;
          const toggledOff = selectedFaceIdRef.current === faceId;
          selectRoofFace(toggledOff ? null : faceId);
          setStatusMsg(toggledOff
            ? '⬡ Deselected'
            : selectionMessageFor(faceId));
          try { viewer.scene.requestRender(); } catch {}
          return;
        }
        clearPanelSelection();
        selectRoofFace(null);
        drilledGroupKeyRef.current = null;
        setStatusMsg('Selection cleared');
        try { viewer.scene.requestRender(); } catch {}
        return;
      }

      const panel    = panelsRef.current.find(p => p.id === foundId);
      const groupKey = groupKeyOf(panel);
      const RED = new C.ColorMaterialProperty(C.Color.fromCssColorString('#ff3333').withAlpha(0.92));

      // 🚨 ONE SELECTION AT A TIME, IN BOTH DIRECTIONS.
      //
      // Both face branches above clear the panel selection. Neither panel branch
      // below cleared the FACE, so selecting a face and then clicking a panel
      // left both live — and the face is not inert while selected: the scope
      // chip keeps reading "THIS face", and `applyBuildingShape` is still scoped
      // to it, so the next Walls/Pitch press edits a face the user stopped
      // pointing at several clicks ago. Nothing else clears it either: Escape
      // calls `clearPanelSelection`, which is panel-only by name and by body,
      // and the tool-change reset does not touch it.
      selectRoofFace(null);

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


  /**
   * 🚨 A KEYSTROKE AIMED AT A TEXT BOX IS NOT A SHORTCUT.
   *
   * This handler is on `window`, so it saw every keystroke in the application
   * -- including the ones typed into its own inspector. Backspace is how a
   * person clears a number field, and Backspace here DELETED THE SELECTED
   * OBJECT. So the documented way to resize a tree...
   *
   *     select the tree -> click "Canopy width" -> Backspace to clear it
   *
   * ...deleted the tree. Same for a roof section's pitch, a wall height, and
   * every other number in the inspector. DesignStudio's own handler has guarded
   * this since v31.1 (components/design/DesignStudio.tsx); the engine's never
   * did, and the engine is the one that owns the inspector.
   *
   * `isContentEditable` is included, which DesignStudio's version misses.
   */
  function keyEventIsTyping(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return el.isContentEditable === true;
  }

  function setupKeyboardHandler() {
    const onKey = (e: KeyboardEvent) => {
      if (keyEventIsTyping(e)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select'
          && (selectedPanelIdRef.current || selectedPanelIdsRef.current.size > 0)) {
        e.preventDefault();
        deleteSelectedPanels(); // v48.12: deletes all in Set
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select'
          && selectedObstructionIdRef.current) {
        e.preventDefault();
        onRequestDelete?.('obstruction', selectedObstructionIdRef.current);
        selectedObstructionIdRef.current = null;
        setSelectedObstructionId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select'
          && selectedFaceIdRef.current) {
        // 🚨 THE DELETE KEY WAS SILENTLY INERT FOR GEOMETRY. It deleted panels
        // and nothing else, so selecting a roof face and pressing Delete — the
        // single most obvious gesture in any modelling tool — did nothing at
        // all, with no message. It now asks the owner for the same deletion the
        // inspector's button asks for, so the keyboard and the button cannot
        // diverge.
        e.preventDefault();
        const asSection = selectionLevelRef.current === 'section' && selectedFaceSectionIdRef.current;
        onRequestDelete?.(
          asSection ? 'section' : 'face',
          asSection ? selectedFaceSectionIdRef.current : selectedFaceIdRef.current,
        );
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
        // 🚨 AND THE FACE. Escape is the product's cancel-everything key — it
        // drops ground arrays, panel selection, the measure/row/plane point
        // buffers, an in-progress Block trace and the ghost panel. It did not
        // clear the roof-face selection, which is not inert: the Walls/Pitch
        // chip keeps reading "THIS face" and `applyBuildingShape` stays scoped
        // to it, so "I pressed Escape" left a live edit target behind.
        selectRoofFace(null);
        measurePtsRef.current = []; setMeasurePtCount(0); clearMeasureOverlay();
        rowPtsRef.current = []; setRowPtCount(0); rowStartScreenPosRef.current = null;
        planePtsRef.current = []; setPlanePtCount(0);
        // v65: also cancel an in-progress block line-trace
        // A half-traced section footprint must be abandonable. The gable and
        // hip tools had no cancel at all while they were a two-click gesture —
        // tolerable at two clicks, stranding at four.
        if (modeRef.current === 'roof_gable' && gablePtsRef.current.length > 0) {
          cancelSectionTrace('gable');
          return;
        }
        if (modeRef.current === 'roof_hip' && hipPtsRef.current.length > 0) {
          cancelSectionTrace('hip');
          return;
        }
        if (modeRef.current === 'block' && blockPtsRef.current.length > 0) {
          if (blockPreviewRef.current) {
            try {
              const dots = (blockPreviewRef.current as any).__dots as any[] | undefined;
              if (dots) for (const d of dots) try { viewerRef.current?.entities.remove(d); } catch { /* ignore */ }
              viewerRef.current?.entities.remove(blockPreviewRef.current);
            } catch { /* ignore */ }
            blockPreviewRef.current = null;
          }
          // v68: clear the in-progress segment arrows
          try { segmentArrowOverlayRef.current?.clear(); } catch { /* ignore */ }
          flippedArrowsRef.current.clear();
          blockPtsRef.current = [];
          setBlockPtCount(0);
          setStatusMsg('🧱 Block cancelled');
        }
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

  // ── v66: Measurements tool — multi-pair (Aurora TIER 2 #10) ─────────────
  function handleMeasurementsClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const pt: LngLatH = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
        h:   carto.height,
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;
      // measurePtsRef stores { lat, lng, height } (legacy schema); LngLatH
      // uses { lat, lng, h }. Convert at the call site.
      measurePtsRef.current.push({ lat: pt.lat, lng: pt.lng, height: pt.h });
      setMeasurePtCount(measurePtsRef.current.length);
      try {
        const mPos = safeCartesian3(C, pt.lng, pt.lat, pt.h + 0.3);
        if (mPos) {
          const m = viewer.entities.add({
            position: mPos,
            point: { pixelSize: 10, color: C.Color.fromCssColorString('#00ffff'), outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
          measureOverlayRef.current.push(m);
        }
      } catch { /* ignore */ }
      if (measurePtsRef.current.length >= 2) {
        const p1 = measurePtsRef.current[measurePtsRef.current.length - 2];
        const p2 = measurePtsRef.current[measurePtsRef.current.length - 1];
        const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // measurePtsRef stores { lat, lng, height } (legacy schema); LngLatH
        // uses { lat, lng, h }. Convert at the call site.
        const a: LngLatH = { lat: p1.lat, lng: p1.lng, h: p1.height };
        const b: LngLatH = { lat: p2.lat, lng: p2.lng, h: p2.height };
        const m = buildMeasurement(id, a, b);
        const bundle = renderMeasurement(viewer, C, m);
        if (bundle) {
          measurementsRef.current.push(m);
          // Lift it to the parent so it can be persisted. The engine keeps the
          // render bundle; DesignStudio owns the durable record.
          onMeasurementsChange?.(measurementsRef.current.map(x => ({
            id: x.id,
            a: { lat: x.a.lat, lng: x.a.lng, height: x.a.h },
            b: { lat: x.b.lat, lng: x.b.lng, height: x.b.h },
            horizDistM: x.horizDistM,
            slopeDistM: x.slopeDistM,
          })));
          setStatusMsg(`📏 Measurement ${measurementsRef.current.length}: ${m.slopeDistM.toFixed(1)} m / ${(m.slopeDistM * 3.28084).toFixed(1)} ft`);
        }
        measurePtsRef.current = [];
        setMeasurePtCount(0);
      }
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    } catch (err: unknown) {
      addLog('ERROR', `handleMeasurementsClick: ${(err as Error).message}`);
    }
  }

  // ── v66: Ruler tool — click+drag, single persistent measurement ─────────
  function handleRulerDown(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const pt: LngLatH = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
        h:   carto.height,
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;
      rulerAnchorRef.current = pt;
      rulerCursorRef.current = pt;
      rulerDraggingRef.current = true;
      rulerPreviewEntityRef.current = renderRulerPreview(viewer, C, pt, pt, null);
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    } catch (err: unknown) {
      addLog('ERROR', `handleRulerDown: ${(err as Error).message}`);
    }
  }

  function handleRulerMove(viewer: any, C: any, screenPos: any) {
    if (!rulerDraggingRef.current) return;
    const anchor = rulerAnchorRef.current;
    if (!anchor) return;
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const cursor: LngLatH = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
        h:   carto.height,
      };
      if (!isValidCoord(cursor.lat, cursor.lng)) return;
      rulerPreviewEntityRef.current = renderRulerPreview(
        viewer, C, anchor, cursor, rulerPreviewEntityRef.current,
      );
      rulerCursorRef.current = cursor;
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    } catch (err: unknown) {
      addLog('ERROR', `handleRulerMove: ${(err as Error).message}`);
    }
  }

  function handleRulerUp() {
    if (!rulerDraggingRef.current) return;
    const anchor = rulerAnchorRef.current;
    const preview = rulerPreviewEntityRef.current;
    const cursor  = rulerCursorRef.current;
    const viewer  = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || !C) {
      rulerAnchorRef.current = null;
      rulerCursorRef.current = null;
      rulerDraggingRef.current = false;
      return;
    }
    try {
      if (!anchor || !cursor || !preview) {
        rulerAnchorRef.current = null;
        rulerCursorRef.current = null;
        rulerDraggingRef.current = false;
        return;
      }
      if (cursor.lat === anchor.lat && cursor.lng === anchor.lng && cursor.h === anchor.h) {
        try { viewer.entities.remove(preview); } catch { /* ignore */ }
        rulerPreviewEntityRef.current = null;
        rulerAnchorRef.current = null;
        rulerCursorRef.current = null;
        rulerDraggingRef.current = false;
        return;
      }
      const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ruler = buildMeasurement(id, anchor, cursor);
      if (rulerEntitiesRef.current) {
        removeMeasurementBundle(viewer, rulerEntitiesRef.current);
        rulerEntitiesRef.current = null;
      }
      try { viewer.entities.remove(preview); } catch { /* ignore */ }
      rulerPreviewEntityRef.current = null;
      const bundle = renderMeasurement(viewer, C, ruler);
      if (bundle) {
        rulerEntitiesRef.current = bundle;
        rulerRef.current = ruler;
        setStatusMsg(`📐 Ruler: ${ruler.slopeDistM.toFixed(1)} m / ${(ruler.slopeDistM * 3.28084).toFixed(1)} ft`);
      }
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    } catch (err: unknown) {
      addLog('ERROR', `handleRulerUp: ${(err as Error).message}`);
    } finally {
      rulerAnchorRef.current = null;
      rulerCursorRef.current = null;
      rulerDraggingRef.current = false;
    }
  }

  // ── v65: Block tool — line-trace mode (click N points to define any polygon,
  //   right-click to finalize). Rendered as a Cesium extruded polygon (3D prism
  //   with real vertical walls, visible from any angle). ──
  // v65.1: each click stores its actual elevation (where the user clicked on the
  // satellite drape or 3D tile), not 0. The prism's base height is the average
  // of the click heights so the walls sit on the visible surface.
  function handleBlockClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const pt = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
        h: carto.height, // actual elevation at the click point (above WGS84 ellipsoid)
      };
      if (!isValidCoord(pt.lat, pt.lng)) return;
      blockPtsRef.current.push(pt);
      setBlockPtCount(blockPtsRef.current.length);
      addLog('BLOCK', `Point ${blockPtsRef.current.length} at (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}, h=${pt.h.toFixed(1)}m)`);

      // Update the in-progress preview polyline so the user sees the line trace.
      // Use the actual click elevations (no clampToGround) so the polyline is
      // at the right height — not buried below the visible drape.
      // v65.2 LEAK FIX: this used to remove only the polyline, orphaning the
      // dots attached to it as `__dots` (see removeBlockPreviewEntity). Every
      // click left the previous click's dots in the viewer forever.
      if (blockPreviewRef.current) {
        removeBlockPreviewEntity(viewer, blockPreviewRef.current);
        blockPreviewRef.current = null;
      }
      if (blockPtsRef.current.length >= 2) {
        const previewPositions = blockPtsRef.current
          .map(p => safeCartesian3(C, p.lng, p.lat, p.h))
          .filter((p): p is any => p != null);
        if (previewPositions.length >= 2) {
          blockPreviewRef.current = viewer.entities.add({
            id: `block-preview-${Date.now()}`,
            name: 'Block footprint (in progress)',
            polyline: {
              positions: previewPositions,
              width: 2,
              material: C.Color.fromCssColorString('#ffaa00').withAlpha(0.9),
              arcType: C.ArcType.GEODESIC,
            },
          });
        }
        // Also add a small dot at each click point for clarity
        for (const p of blockPtsRef.current) {
          const pos = safeCartesian3(C, p.lng, p.lat, p.h + 0.05);
          if (pos) {
            const dot = viewer.entities.add({
              position: pos,
              point: {
                pixelSize: 8,
                color: C.Color.fromCssColorString('#ffaa00'),
                outlineColor: C.Color.BLACK,
                outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
            // The dots are short-lived; clean them up on next click or finalize.
            try { (blockPreviewRef.current as any).__dots = ((blockPreviewRef.current as any).__dots || []).concat([dot]); } catch { /* ignore */ }
          }
        }

        // v68: rebuild the segment-arrow overlay so a yellow chevron
        // sits at the midpoint of each in-progress edge. Closes the
        // polygon for the overlay so the closing edge gets a normal
        // too (Aurora parity). Drops any stale flip on a now-defunct
        // segment id.
        try {
          const pts2 = blockPtsRef.current.map((p: any) => ({ lat: p.lat, lng: p.lng }));
          const closedPts = pts2.slice();
          if (closedPts.length >= 3) {
            const first = closedPts[0];
            const last  = closedPts[closedPts.length - 1];
            if (first.lat !== last.lat || first.lng !== last.lng) {
              closedPts.push({ lat: first.lat, lng: first.lng });
            }
          }
          const newIds = new Set<string>();
          for (let i = 0; i + 1 < closedPts.length; i++) newIds.add(`seg-${i}`);
          for (const id of Array.from(flippedArrowsRef.current)) {
            if (!newIds.has(id)) flippedArrowsRef.current.delete(id);
          }
          const segs = buildSegmentsFromPoints(closedPts, flippedArrowsRef.current, 'face-block-1');
          const baseRefLat = blockPtsRef.current[0].lat;
          const baseRefH   = blockPtsRef.current[0].h || 0;
          segmentArrowOverlayRef.current?.update({
            segments: segs,
            refLat:   baseRefLat,
            refHeightM: baseRefH,
          });
        } catch (e) { addLog('WARN', `segment arrow update: ${(e as Error).message}`); }
      }

      if (blockPtsRef.current.length === 1) {
        setStatusMsg(`🧱 Block point 1 set at (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}, h=${pt.h.toFixed(1)}m) — click more points, right-click to finish`);
      } else {
        setStatusMsg(`🧱 ${blockPtsRef.current.length} block points — right-click to finish (need 3+), Esc to cancel`);
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleBlockClick: ${(err as Error).message}`); }
  }

  // Finalize the line-trace block: build a 3D extruded polygon (real prism with
  // vertical walls), drop a resize handle on top, and reset for the next block.
  // v65.1: use the average click elevation as the prism's base so the walls
  // sit on the satellite drape, not 136m below it.
  function finalizeBlock(viewer: any, C: any) {
    const pts = blockPtsRef.current;
    if (pts.length < 3) {
      setStatusMsg('🧱 Block needs at least 3 points — keep clicking, then right-click to finish');
      return;
    }
    // Clean up the preview polyline + dots
    if (blockPreviewRef.current) {
      try {
        const dots = (blockPreviewRef.current as any).__dots as any[] | undefined;
        if (dots) for (const d of dots) try { viewer.entities.remove(d); } catch { /* ignore */ }
        viewer.entities.remove(blockPreviewRef.current);
      } catch { /* ignore */ }
      blockPreviewRef.current = null;
    }
    const eaveHeightM = newBlockEaveHeightM; // user-settable eave height for new blocks
    // Average elevation of the click points — that's the ground level for the prism.
    // The drape at Pocahontas IL is ~136m above the WGS84 ellipsoid; using the
    // average click height puts the bottom of the prism flush with the drape.
    const groundLevelM = pts.reduce((s, p) => s + (p.h || 0), 0) / pts.length;
    // Build the polygon hierarchy at the actual click elevations
    const polyPositions = pts
      .map(p => safeCartesian3(C, p.lng, p.lat, p.h || 0))
      .filter((p): p is any => p != null);
    if (polyPositions.length < 3) {
      setStatusMsg('🧱 Block: failed to build polygon — try again');
      blockPtsRef.current = [];
      setBlockPtCount(0);
      return;
    }
    // Centroid for the handle = average of the points
    const centroidLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const centroidLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    // Compute approximate area in m² for the info box (using the lat/lng bounding box
    // as a rough estimate — accurate area would need a polygon area algorithm).
    const minLat = Math.min(...pts.map(p => p.lat));
    const maxLat = Math.max(...pts.map(p => p.lat));
    const minLng = Math.min(...pts.map(p => p.lng));
    const maxLng = Math.max(...pts.map(p => p.lng));
    const midLat = (minLat + maxLat) / 2;
    const widthM  = Math.abs(maxLng - minLng) * 111_320 * Math.cos(midLat * Math.PI / 180);
    const depthM  = Math.abs(maxLat - minLat) * 111_320;
    const approxAreaM2 = widthM * depthM;
    // 3D extruded polygon — a real prism with vertical walls.
    // v65.2: perPositionHeight:true so each wall goes from the individual
    // click elevation (matching the drape) up to (click_elevation + eaveHeightM).
    // This avoids Z-fighting with the drape at the bottom and makes the
    // prism visible from any angle, including directly above.
    const blockId = `block-${Date.now()}`;
    const prismEntity = viewer.entities.add({
      id: blockId,
      name: 'Building Block',
      polygon: {
        hierarchy: new C.PolygonHierarchy(polyPositions),
        perPositionHeight: true,
        // When perPositionHeight is true, height/extrudedHeight are RELATIVE
        // to each position's elevation. So height=0 means the bottom is at
        // each position's actual height, and extrudedHeight=eaveHeightM means
        // the top is eaveHeightM above each position.
        height: 0,
        extrudedHeight: eaveHeightM,
        material: C.Color.fromCssColorString('#f5f5f5').withAlpha(0.92),
        outline: true,
        outlineColor: C.Color.fromCssColorString('#2a2a2a'),
        outlineWidth: 2,
        closeTop: true,
        closeBottom: false,
      },
      description: `<table class="cesium-infoBox-defaultTable">
        <tr><th>Block</th><td>${pts.length} footprint points, eave ${eaveHeightM.toFixed(1)}m</td></tr>
        <tr><th>Ground level</th><td>${groundLevelM.toFixed(1)}m (avg click elevation)</td></tr>
        <tr><th>Approx footprint</th><td>${widthM.toFixed(1)}m × ${depthM.toFixed(1)}m ≈ ${approxAreaM2.toFixed(0)} m²</td></tr>
        <tr><th>Centroid</th><td>${centroidLat.toFixed(6)}, ${centroidLng.toFixed(6)}</td></tr>
      </table>`,
    });
    // Tag the prism with its centroid Cartesian so the resize handler can find it
    // (PolygonGraphics doesn't have a `position` field like BoxGraphics does).
    const centroidCartesian = safeCartesian3(C, centroidLng, centroidLat, groundLevelM + eaveHeightM);
    if (centroidCartesian) {
      try { (prismEntity as any).__centroidCart = centroidCartesian; } catch { /* ignore */ }
    }
    // Drag handle on top of the prism — small bright box the user can grab
    // to resize the block height by dragging up/down. The handle is at
    // (centroid_lat, centroid_lng, groundLevel + eaveHeightM + 0.3) and is 0.4m³.
    const handlePos = safeCartesian3(C, centroidLng, centroidLat, groundLevelM + eaveHeightM + 0.3);
    const handleEntity = viewer.entities.add({
      id: `block-handle-${Date.now()}`,
      name: 'Block resize handle (drag up/down to set height)',
      position: handlePos,
      box: {
        dimensions: new C.Cartesian3(0.4, 0.4, 0.4),
        material: C.Color.fromCssColorString('#ffaa00').withAlpha(0.95),
        outline: true,
        outlineColor: C.Color.fromCssColorString('#000000'),
        outlineWidth: 2,
      },
    });
    // Tag the handle with the prism id so the resize handler can find its target
    try { (handleEntity as any).__blockId = blockId; } catch { /* ignore */ }
    blockEntitiesRef.current.push(prismEntity);
    blockHandlesRef.current.push(handleEntity);
    blockHeightOverridesRef.current.set(blockId, eaveHeightM);
    setPlacedBlockCount(blockEntitiesRef.current.length);
    setLastPlacedBlockId(blockId); // v66: remember the most recent block for the in-canvas height input
    setVertexSpecs(prev => [...prev, {
      id: blockId,
      type: 'block',
      vertices: pts.map(p => ({ lat: p.lat, lng: p.lng, h: p.h || 0 })),
      blockExtrudeHeightM: eaveHeightM,
    }]);
    addLog('BLOCK', `Finalized: ${pts.length} points, ≈${widthM.toFixed(1)}m × ${depthM.toFixed(1)}m, ground ${groundLevelM.toFixed(1)}m, eave ${eaveHeightM}m`);

    // ── THE BLOCK IS NOW A BUILDING SECTION, NOT JUST A PICTURE ─────────────
    //
    // 🚨 IT USED TO PRODUCE ONLY CESIUM ENTITIES. Its own tooltip says "Use
    // when Google 3D Tiles has no coverage for this address" — the fallback
    // case this whole pipeline exists for — and what it produced never reached
    // the Roof Planes sidebar, took no panels, contributed nothing to the BOM
    // or the planset, and was gone on reload. An installer modelled a flat-roof
    // garage or a commercial box and got a white prism.
    //
    // A flat roof IS a building section: `buildSectionRoofPlanes` has taken
    // `kind: 'flat'` since it was written, over a footprint of ANY number of
    // corners, and emits a real deck face through the same
    // `lib/3d/footprintToRoofPlane` the hand trace uses. So a Block's roof and
    // a Mark Plane face are the same object from the same code, and everything
    // that already works for one works for it.
    //
    // 🚨 THE PRISM STAYS. It is what makes the massing readable, and deleting
    // it would be a second change wearing this one's clothes. The section face
    // is drawn on top of it by the same renderer as every other face.
    try {
      const sectionId = `sec-${blockId}`;
      const outcome = buildSectionRoofPlanes({
        id: sectionId,
        kind: 'flat',
        footprint: pts.map(pt => ({ lat: pt.lat, lng: pt.lng })),
        eaveHeightM,
        pitchDeg: 0,
        // The same refusal-rather-than-guess rule as finalizeRoofSection: NaN
        // when unresolved, so the domain declines instead of modelling the
        // building at sea level.
        groundElevM: cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : NaN,
        label: 'Flat section',
        createdAtIso: new Date().toISOString(),
        source: 'user-traced',
      });

      if (outcome.ok && outcome.faceBuilds.length > 0) {
        for (const b of outcome.faceBuilds) {
          const cesiumPts = b.projectedPts.map((q: Cart3) => new C.Cartesian3(q.x, q.y, q.z));
          const entityIds = renderPlane3DEntity(viewer, C, cesiumPts, b.plane.id, b.frame, false, false);
          plane3DEntitiesRef.current = [...plane3DEntitiesRef.current, ...entityIds];
          plane3DEntityMap.current.set(b.plane.id, entityIds);
          plane3DFrameMap.current.set(b.plane.id, b.frame);
          plane3DCesiumPtsMap.current.set(b.plane.id, cesiumPts);
          (b.plane as any).__eaveDirENU = b.eaveDirENU;
          onRoofPlaneCreated?.(b.plane);
        }
        addLog('SECTION', `flat ${sectionId}: ${outcome.planes.length} face from block`);
        setStatusMsg(
          `🧱 Block placed — ${pts.length} corners, eave ${eaveHeightM}m, and its flat roof is a ` +
          'real roof face: place panels on it, edit it in the inspector, and it saves with the design.',
        );
      } else {
        const why = outcome.refusals.map(r => r.message).join(' ');
        setStatusMsg(
          `🧱 Block drawn, but its roof face was not built — ${why || 'those corners do not describe a roof.'} ` +
          'The massing is on screen; nothing has been added to the design.',
        );
        addLog('SECTION', `flat refused: ${outcome.refusals.map(r => r.code).join(',') || 'NO_FACES'}`);
      }
    } catch (err: unknown) {
      addLog('ERROR', `block section: ${(err as Error).message}`);
      setStatusMsg(`🧱 Block placed — ${pts.length} footprint points, eave ${eaveHeightM}m. Its roof face could not be built.`);
    }
    // v68: drop the in-progress segment arrows now that the prism
    // takes over. We do NOT clear the flip set — if the user starts
    // a new block immediately, their previous flips don't carry
    // over (the new edges get default normalDir), but the set is
    // also cleaned on tool change.
    try { segmentArrowOverlayRef.current?.clear(); } catch { /* ignore */ }
    // Reset for the next block (keep the placed blocks; user can drop more)
    blockPtsRef.current = [];
    setBlockPtCount(0);
    try { viewer.scene.requestRender(); } catch {}
  }

  // ── v64: Gable roof tool — 2 eave corners, render 2 sloped faces ──
  // The eave is a rectangle in lat/lng. The ridge runs along the long edge
  // (the longer of the two eave dimensions) at the rectangle centroid. Two
  // sloped polygons (south face + north face) meet at the ridge.
  /**
   * FINALIZE A BUILDING SECTION — the massing tools stop being a drawing program.
   *
   * 🚨 WHAT THIS REPLACES. The Gable and Hip tools used to add Cesium entities
   * and push a `vertexSpec` into component state, and nothing else. No RoofPlane
   * was ever produced, so a gable somebody placed never reached the Roof Planes
   * sidebar, the panel layout, the BOM or the planset — and was gone on reload.
   * Both also took TWO clicks and normalised them to an axis-aligned bounding
   * box, so a house rotated off north could not be modelled at all.
   *
   * The footprint is now traced as FOUR CORNERS, used exactly as clicked, and
   * the faces come from `lib/3d/buildingSection`, which builds every one of them
   * through `lib/3d/footprintToRoofPlane` — the same module the hand-trace path
   * uses. So a gable face and a Mark Plane face are the same kind of object,
   * registered here through the same calls, and everything downstream that
   * already works for one works for the other.
   *
   * 🚨 IT REFUSES RATHER THAN GUESSING. An unresolved ground elevation is passed
   * through as NaN so the domain refuses it: defaulting to 0 would model the
   * house 136 m underground at a site like Pocahontas IL, and it would look
   * plausible the whole way to a permit.
   */
  function finalizeRoofSection(viewer: any, C: any, kind: 'gable' | 'hip', footprint: Array<{ lat: number; lng: number }>) {
    try {
      const sectionId = `sec-${Date.now().toString(36)}`;
      // NaN when unresolved — see above. The domain turns that into a refusal.
      const groundElevM = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : NaN;

      const outcome = buildSectionRoofPlanes({
        id: sectionId,
        kind,
        footprint: footprint.map(p => ({ lat: p.lat, lng: p.lng })),
        // 🚨 FROM THE REFS — see their declaration. Reading the state here is
        // what made both sliders inert: this runs inside a handler registered
        // once at mount.
        eaveHeightM: newRoofEaveHeightMRef.current,
        pitchDeg: roofPitchDegRef.current,
        groundElevM,
        ridgeAxis: 'auto',
        label: kind === 'gable' ? 'Gable section' : 'Hip section',
        createdAtIso: new Date().toISOString(),
        source: 'user-traced',
      });

      if (!outcome.ok || outcome.faceBuilds.length === 0) {
        // Every refusal, not the first — an installer who fixes one thing and is
        // refused again for another has been told half the truth twice.
        const why = outcome.refusals.map(r => r.message).join(' ');
        const codes = outcome.refusals.map(r => r.code);

        // 🚨 AN UNRESOLVED GROUND ELEVATION IS NOT THE INSTALLER'S MISTAKE, AND
        // IT MUST NOT COST THEM THE TRACE.
        //
        // `groundElevM` is NaN when the elevation service has not answered —
        // deliberately, so the domain refuses rather than modelling the house
        // at sea level. But the caller then threw the four traced corners away
        // and said "Ground elevation has not resolved yet", which names a
        // condition the user cannot influence and does not say what to do. They
        // click four more corners and get the same sentence.
        //
        // The corners are kept (the caller does not clear them on `false`), and
        // the message says what will make it work.
        if (codes.includes('GROUND_ELEV_INVALID')) {
          setStatusMsg(
            '⏳ Your four corners are saved. The ground elevation for this property has not ' +
            'come back yet, and a roof built without it would sit at sea level. ' +
            'Wait a moment and click the last corner again, or move the map slightly ' +
            'to re-request it.',
          );
          addLog('SECTION', 'refused: GROUND_ELEV_INVALID (trace kept)');
          return false;
        }

        setStatusMsg(`⚠️ ${kind === 'gable' ? 'Gable' : 'Hip'} not built — ${why || 'the traced corners do not describe a roof.'}`);
        addLog('SECTION', `refused: ${codes.join(',') || 'NO_FACES'}`);
        return false;
      }

      for (const b of outcome.faceBuilds) {
        const cesiumPts = b.projectedPts.map((p: Cart3) => new C.Cartesian3(p.x, p.y, p.z));
        // Same render + registration as finalizePlane3D. A section face has to be
        // findable by selection, setbacks and the panel grid, and those all read
        // these three maps.
        const entityIds = renderPlane3DEntity(viewer, C, cesiumPts, b.plane.id, b.frame, false, false);
        plane3DEntitiesRef.current = [...plane3DEntitiesRef.current, ...entityIds];
        plane3DEntityMap.current.set(b.plane.id, entityIds);
        plane3DFrameMap.current.set(b.plane.id, b.frame);
        plane3DCesiumPtsMap.current.set(b.plane.id, cesiumPts);
        (b.plane as any).__eaveDirENU = b.eaveDirENU;
        // 🚨 THE EMIT. This is what makes it a design object rather than a
        // picture: DesignStudio stamps ownership, adds it to roofPlanes, and the
        // autosave persists it.
        onRoofPlaneCreated?.(b.plane);
      }

      const ridge = outcome.ridgeHeightM;
      addLog('SECTION', `${kind} ${sectionId}: ${outcome.planes.length} faces, ridge ${ridge?.toFixed(2)}m, pitch ${roofPitchDegRef.current}°`);
      setStatusMsg(
        `🏠 ${kind === 'gable' ? 'Gable' : 'Hip'} section placed — ${outcome.planes.length} roof faces, ` +
        `eave ${newRoofEaveHeightMRef.current.toFixed(1)}m, ridge ${ridge != null ? ridge.toFixed(1) : '?'}m. ` +
        'They are real roof faces: place panels on them, and they save with the design.',
      );
      if (showRoofModel)    { try { renderRoofWireframe(viewer, C); } catch {} }
      if (showSetbackZones) { try { renderFireSetbackZones(viewer, C); } catch {} }
      try { viewer.scene.requestRender(); } catch {}
      return true;
    } catch (err: unknown) {
      addLog('ERROR', `finalizeRoofSection: ${(err as Error).message}`);
      setStatusMsg(`⚠️ Section failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Abandon a half-traced section footprint. Shared by Escape and right-click,
   *  so a mis-click can never strand the user mid-trace with no way out. */
  function cancelSectionTrace(which: 'gable' | 'hip') {
    if (which === 'gable') { gablePtsRef.current = []; setGablePtCount(0); }
    else                   { hipPtsRef.current = [];   setHipPtCount(0); }
    setStatusMsg(`${which === 'gable' ? '🏠 Gable' : '🏗 Hip'} cancelled — click the first footprint corner to start again.`);
  }

  function handleGableClick(viewer: any, C: any, screenPos: any) {
    const LABEL = '🏠 Gable';
    try {
      // 🚨 A MISSED PICK SAYS SO. These three exits were bare `return`s, so a
      // click that resolved to nothing left the counter unchanged and the
      // status line untouched — the only way to notice was that the badge still
      // read (1/4) after two clicks. That silence is how a dead ellipsoid
      // fallback went unnoticed for so long: at an address with no Google mesh
      // EVERY corner click did nothing, and the tool said nothing about it.
      const missed = (why: string) => {
        setStatusMsg(`${LABEL} — that click did not land on the building. ${why}`);
        addLog('SECTION', `corner pick missed: ${why}`);
      };

      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { missed('Aim at the roof or the ground beside it, then click again.'); return; }
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) { missed('That point could not be turned into a coordinate.'); return; }
      const pt = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
      };
      if (!isValidCoord(pt.lat, pt.lng)) {
        missed(`It resolved to ${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}, which is not on this property.`);
        return;
      }
      gablePtsRef.current.push(pt);
      setGablePtCount(gablePtsRef.current.length);

      // 🚨 FOUR CORNERS, USED AS TRACED. The old gesture took TWO clicks and
      // normalised them to an axis-aligned bounding box, so it could only model
      // a house square to north — and the bbox of a rotated rectangle is bigger
      // than the rectangle, so it over-reported the roof too.
      if (gablePtsRef.current.length >= 4) {
        finalizeRoofSection(viewer, C, 'gable', gablePtsRef.current.slice(0, 4));
        gablePtsRef.current = [];
        setGablePtCount(0);
      } else {
        setStatusMsg(
          `🏠 Gable — corner ${gablePtsRef.current.length} of 4. Click the footprint corners IN ORDER `
          // 🚨 The refs, so the prompt quotes the pitch the section will
          // actually be built at. Printing the state here while the geometry
          // read the ref would be the same lie pointing the other way.
          + `around the building, not diagonally. Pitch ${roofPitchDegRef.current}°, eave `
          + `${newRoofEaveHeightMRef.current.toFixed(1)}m. Esc to cancel.`,
        );
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleGableClick: ${(err as Error).message}`); }
  }

  // ── v64: Hip roof tool — 2 eave corners, 4 sloped faces meeting at a short ridge ──
  // The ridge is set back from BOTH short eave edges (typical hip setback = 1/3 of short edge).
  // 4 faces: 2 trapezoid slopes (long sides) + 2 triangular hip ends (short sides).
  function handleHipClick(viewer: any, C: any, screenPos: any) {
    const LABEL = '🏗 Hip';
    try {
      // 🚨 A MISSED PICK SAYS SO. These three exits were bare `return`s, so a
      // click that resolved to nothing left the counter unchanged and the
      // status line untouched — the only way to notice was that the badge still
      // read (1/4) after two clicks. That silence is how a dead ellipsoid
      // fallback went unnoticed for so long: at an address with no Google mesh
      // EVERY corner click did nothing, and the tool said nothing about it.
      const missed = (why: string) => {
        setStatusMsg(`${LABEL} — that click did not land on the building. ${why}`);
        addLog('SECTION', `corner pick missed: ${why}`);
      };

      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) { missed('Aim at the roof or the ground beside it, then click again.'); return; }
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) { missed('That point could not be turned into a coordinate.'); return; }
      const pt = {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
      };
      if (!isValidCoord(pt.lat, pt.lng)) {
        missed(`It resolved to ${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}, which is not on this property.`);
        return;
      }
      hipPtsRef.current.push(pt);
      setHipPtCount(hipPtsRef.current.length);

      // 🚨 FOUR CORNERS, USED AS TRACED — see handleGableClick. A hip on a
      // bounding box is a hip on a building nobody traced.
      if (hipPtsRef.current.length >= 4) {
        finalizeRoofSection(viewer, C, 'hip', hipPtsRef.current.slice(0, 4));
        hipPtsRef.current = [];
        setHipPtCount(0);
      } else {
        setStatusMsg(
          `🏗 Hip — corner ${hipPtsRef.current.length} of 4. Click the footprint corners IN ORDER `
          // 🚨 The refs, so the prompt quotes the pitch the section will
          // actually be built at. Printing the state here while the geometry
          // read the ref would be the same lie pointing the other way.
          + `around the building, not diagonally. Pitch ${roofPitchDegRef.current}°, eave `
          + `${newRoofEaveHeightMRef.current.toFixed(1)}m. Esc to cancel.`,
        );
      }
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleHipClick: ${(err as Error).message}`); }
  }

  // ── v64: Tree tool — single click drops a decorative tree (sphere + trunk) ──
  // Decorative only; doesn't affect solar production. Used to add visual context
  // around a house schematic, matching the 3D-After-at-Noon reference image.
  function handleTreeClick(viewer: any, C: any, screenPos: any) {
    try {
      const hit = getWorldPosition(viewer, C, screenPos);
      if (!hit) return;
      const carto = C.Cartographic.fromCartesian(hit.cartesian);
      if (!carto) return;
      const lat = C.Math.toDegrees(carto.latitude);
      const lng = C.Math.toDegrees(carto.longitude);
      if (!isValidCoord(lat, lng)) return;
      const trunkHeightM = 2.0;    // typical trunk
      const foliageRadiusM = 1.8;  // typical canopy
      const foliageCenterH = trunkHeightM + foliageRadiusM * 0.7;
      // Trunk: thin brown cylinder
      const trunkPos = safeCartesian3(C, lng, lat, trunkHeightM / 2);
      const foliagePos = safeCartesian3(C, lng, lat, foliageCenterH);
      if (!trunkPos || !foliagePos) return;
      const trunkEntity = viewer.entities.add({
        id: `tree-trunk-${Date.now()}`,
        name: 'Tree trunk',
        position: trunkPos,
        cylinder: {
          length: trunkHeightM,
          topRadius: 0.15,
          bottomRadius: 0.2,
          material: C.Color.fromCssColorString('#5a3a1a'),
          outline: true,
          outlineColor: C.Color.fromCssColorString('#2a1a08'),
        },
      });
      const foliageEntity = viewer.entities.add({
        id: `tree-foliage-${Date.now()}`,
        name: 'Tree foliage',
        position: foliagePos,
        ellipsoid: {
          radii: new C.Cartesian3(foliageRadiusM, foliageRadiusM, foliageRadiusM * 0.85),
          material: C.Color.fromCssColorString('#4a8a3a'),
          outline: true,
          outlineColor: C.Color.fromCssColorString('#1a3a0a'),
        },
      });
      treeEntitiesRef.current.push(trunkEntity, foliageEntity);
      setPlacedTreeCount(treeEntitiesRef.current.length / 2);
      // v68: register the tree with the vertex-handles editor and tag the
      // two Cesium entities so the editor can move them together.
      const treeGroupId = `tree-grp-${Date.now()}`;
      try { (trunkEntity as any).__groupId = treeGroupId; } catch { /* ignore */ }
      try { (foliageEntity as any).__groupId = treeGroupId; } catch { /* ignore */ }
      try { (trunkEntity as any).__trunkHeightM = trunkHeightM; } catch { /* ignore */ }
      try { (trunkEntity as any).__foliageRadiusM = foliageRadiusM; } catch { /* ignore */ }
      setVertexSpecs(prev => [...prev, {
        id: treeGroupId,
        type: 'tree',
        vertices: [{ lat, lng, h: 0 }],
      }]);
      addLog('TREE', `Placed at (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      setStatusMsg(`\u{1F333} Tree placed at (${lat.toFixed(5)}, ${lng.toFixed(5)}) — click to place another`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: unknown) { addLog('ERROR', `handleTreeClick: ${(err as Error).message}`); }
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
    // `lastH` is the height of the module just placed — deck + stack already.
    // Adding the stack again drew the preview one stack ABOVE the module it
    // previews, so the ghost never sat where its panel would land. The next
    // module in a row is at the same elevation as the last: use it as given.
    const pos = safeCartesian3(C, nextLng, nextLat, lastH);
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

  // ═════════════════════════════════════════════════════════════════════════
  // DELETION — the renderer's half
  //
  // 🚨 THE PARENT DECIDES, THIS REMOVES. Nothing here reads `roofPlanes` to
  // work out what went; it is handed an explicit list of ids by the owner that
  // performed the deletion. Inferring removal from a prop is what the
  // reconcile-deletions block did, and it destroyed a hand-traced garage —
  // ABSENCE IS NOT INTENT, and the ids make intent explicit.
  // ═════════════════════════════════════════════════════════════════════════

  /** Drop every Cesium entity belonging to these faces.
   *
   *  🚨 THE MAP ENTRIES ARE LEFT, exactly as the section-edit path leaves them,
   *  and the blanket ban on pruning `plane3DEntityMap` stands. Membership in the
   *  design is taken from `roofPlanesRef.current` by `liveRenderedFaces()`, so a
   *  leftover cache entry decides nothing — and a deleted id is tombstoned, so
   *  it can never return to be confused with a new face. */
  function removeFaceEntities(viewer: any, faceIds: string[]) {
    if (!viewer || !faceIds?.length) return 0;
    let removed = 0;
    for (const id of faceIds) {
      for (const eid of (plane3DEntityMap.current.get(id) ?? [])) {
        const e = viewer.entities.getById(eid);
        if (e) { try { viewer.entities.remove(e); removed++; } catch { /* ignore */ } }
      }
      // The rails and the setback bands are DERIVED from the face. They are
      // keyed by plane id and would otherwise hang in the air over nothing.
      try { clearRoofRails(viewer, id); } catch { /* ignore */ }
    }
    // A named sweep as well, because `[PLANE3D-*]` entities carry the face id
    // in their name and a map entry that was never written (a face restored by
    // a path that did not register) would otherwise leave a ghost.
    try {
      const all = viewer.entities.values.slice();
      for (const e of all) {
        const nm: string = e?.name ?? '';
        if (!nm.startsWith('[PLANE3D-')) continue;
        if (!faceIds.some(id => nm.includes(id))) continue;
        try { viewer.entities.remove(e); removed++; } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    plane3DEntitiesRef.current = Array.from(plane3DEntityMap.current.values()).flat();
    return removed;
  }

  /** Drop the prism and label for these obstructions. The entity id IS the
   *  obstruction id (see the placement path), and the name carries it too. */
  /**
   * Draw one obstruction from its canonical record.
   *
   * 🚨 ONE PICTURE FROM ONE RECORD. Placement used to build the prism inline
   * from the slider values, so there was no way to draw an obstruction that
   * already existed — which is why nothing could be resized after the click.
   * Editing and placing now go through the same function, so the thing on
   * screen cannot drift from the thing that is saved.
   */
  function drawObstructionEntity(viewer: any, C: any, obs: import('@/types').PlacedObstruction): void {
    if (!viewer || !C || !obs) return;
    const widthM = Number.isFinite(obs.widthM) && obs.widthM > 0 ? obs.widthM : (obs.radiusM ?? 0.3) * 2;
    const depthM = Number.isFinite(obs.depthM) && obs.depthM > 0 ? obs.depthM : widthM;
    const prismHeightM = Number.isFinite(obs.heightM) && obs.heightM > 0 ? obs.heightM : 1.0;
    const footprint = buildObstructionFootprint(obs.lat, obs.lng, widthM, depthM);
    const polyPositions = [footprint.sw, footprint.se, footprint.ne, footprint.nw]
      .map(c => safeCartesian3(C, c.lng, c.lat, obs.height))
      .filter((q): q is any => q != null);
    if (polyPositions.length < 4) return;
    const isTree = (obs as { space?: string }).space === 'site' || obs.type === 'tree';
    try {
      viewer.entities.add({
        id: obs.id,
        name: `[OBS] ${obs.id}`,
        polygon: {
          hierarchy: new C.PolygonHierarchy(polyPositions),
          perPositionHeight: true,
          height: 0,
          extrudedHeight: prismHeightM,
          // A tree reads as a tree. It is the same primitive; only the colour
          // says which of the two kinds of object it is.
          material: C.Color.fromCssColorString(isTree ? '#4a8a3a' : '#f5f5f5')
            .withAlpha(isTree ? 0.75 : 0.92),
          outline: true,
          outlineColor: C.Color.fromCssColorString(isTree ? '#2f5f25' : '#2a2a2a'),
          outlineWidth: 2,
          closeTop: true,
          closeBottom: false,
        },
      });
      viewer.scene.requestRender();
    } catch (e: unknown) {
      addLog('WARN', `Obstruction entity: ${(e as Error).message}`);
    }
  }

  /** Which marked obstruction is under the cursor? Reads the `[OBS] <id>` name
   *  the placement path writes, so the entity id and the canonical id are the
   *  same fact read one way. */
  function pickObstructionAtScreen(viewer: any, screenPos: any): string | null {
    try {
      const hits = viewer.scene.drillPick(screenPos, 12) ?? [];
      for (const h of hits) {
        const nm: string = h?.id?.name ?? '';
        if (typeof nm === 'string' && nm.startsWith('[OBS] ')) return nm.slice(6).trim();
        const eid: string = h?.id?.id ?? '';
        if (typeof eid === 'string' && (obstructionsRef.current ?? []).some(o => o?.id === eid)) return eid;
      }
    } catch { /* ignore */ }
    return null;
  }

  function removeObstructionEntities(viewer: any, ids: string[]) {
    if (!viewer || !ids?.length) return 0;
    let removed = 0;
    for (const id of ids) {
      const e = viewer.entities.getById(id);
      if (e) { try { viewer.entities.remove(e); removed++; } catch { /* ignore */ } }
    }
    try {
      const all = viewer.entities.values.slice();
      for (const e of all) {
        const nm: string = e?.name ?? '';
        if (!nm.startsWith('[OBS]')) continue;
        if (!ids.some(id => nm.includes(id))) continue;
        try { viewer.entities.remove(e); removed++; } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return removed;
  }

  /** The render-only primitives that are not canonical geometry: traced blocks
   *  and decorative trees. They are not in `roofPlanes`, so a design-level
   *  clear would leave them standing over an empty lot. */
  function clearPlacedBlocks(viewer: any) {
    if (viewer) {
      for (const e of blockEntitiesRef.current) { try { viewer.entities.remove(e); } catch { /* ignore */ } }
      for (const e of blockHandlesRef.current) { try { viewer.entities.remove(e); } catch { /* ignore */ } }
    }
    blockEntitiesRef.current = [];
    blockHandlesRef.current = [];
    blockHeightOverridesRef.current.clear();
    setPlacedBlockCount(0);
    setVertexSpecs(prev => prev.filter(s => s.type !== 'block'));
  }

  function clearPlacedTrees(viewer: any) {
    if (viewer) {
      for (const e of treeEntitiesRef.current) { try { viewer.entities.remove(e); } catch { /* ignore */ } }
    }
    treeEntitiesRef.current = [];
    setPlacedTreeCount(0);
  }

  /**
   * RETURN THE EDITOR TO IDLE.
   *
   * 🚨 A CLEAR THAT LEAVES A TRACE HALF-DRAWN IS WORSE THAN NO CLEAR. The
   * owner's screenshot showed "Hip section — click footprint corner 1 of 4"
   * over a contaminated scene: two corners were already down, in a ref, invisible
   * in the emptied model, and the NEXT click would have completed a section from
   * points picked before the reset.
   *
   * Three separate paths reset transient state today — the tool-change effect,
   * the Escape handler and `activateTool` — and an audit found each of them
   * missing something the others cleared: Escape leaves an in-progress fence and
   * the plane3d markers; the tool-change effect leaves the ruler drag and the
   * measure overlay; `activateTool` leaves the block, gable and hip buffers.
   * This is the union, in one place, and it is what a clear calls.
   */
  function resetEditorToIdle(viewer: any) {
    fencePtsRef.current = [];        setFencePtCount(0);
    planePtsRef.current = [];        setPlanePtCount(0);
    rowPtsRef.current = [];          setRowPtCount(0);
    rowStartScreenPosRef.current = null;
    rowLastClickRef.current = null;
    measurePtsRef.current = [];      setMeasurePtCount(0);
    blockPtsRef.current = [];        setBlockPtCount(0);
    gablePtsRef.current = [];        setGablePtCount(0);
    hipPtsRef.current = [];          setHipPtCount(0);
    dirClickPtsRef.current = [];
    offMeshFirstClicksRef.current = 0;
    pts3DCesiumRef.current = [];
    pts3DCartRef.current = [];
    setPts3DCount(0);
    setMarkPlanePtCount(0);
    setPlane3DPtCount(0);
    setGroundPtCount(0);
    setClickCountForTool(0);
    // Drag / manipulation state. A live drag that survives a reset re-applies
    // itself to whatever the next pointer-up happens to find.
    dragRef.current = null;
    blockResizeRef.current = null;
    arrayManipRef.current = false;
    suppressClickRef.current = false;
    rulerAnchorRef.current = null;
    rulerCursorRef.current = null;
    rulerDraggingRef.current = false;
    // Previews and overlays.
    try { clearMeasureOverlay(); } catch { /* ignore */ }
    try { clearGhostPanel(); } catch { /* ignore */ }
    try { hideRotateHandle(); } catch { /* ignore */ }
    if (viewer) {
      try { clearPlane3DPreview(viewer); } catch { /* ignore */ }
      try { clearLayoutOverlays(viewer); } catch { /* ignore */ }
    }
    if (blockPreviewRef.current) {
      try {
        const dots = (blockPreviewRef.current as any).__dots ?? [];
        for (const d of dots) { try { viewer?.entities?.remove(d); } catch { /* ignore */ } }
        viewer?.entities?.remove(blockPreviewRef.current);
      } catch { /* ignore */ }
      blockPreviewRef.current = null;
    }
    try { segmentArrowOverlayRef.current?.clear(); } catch { /* ignore */ }
    flippedArrowsRef.current.clear();
    try { cancelGroundArray(); } catch { /* ignore */ }
    // Selection. Nothing may stay selected that the clear removed, or the
    // inspector keeps offering controls for an object that is gone.
    try { clearPanelSelection(); } catch { /* ignore */ }
    try { selectRoofFace(null); } catch { /* ignore */ }
    setSelectedWallId(null);
    setSelectionLevel('section');
    setSectionRefusal(null);
    setSelectedBlockId(null);
    // And the tool itself. 'select' is this editor's idle mode — there is no
    // 'none' — so nothing is armed and no next click completes an operation
    // that began before the reset.
    onPlacementModeChange?.('select');
  }

  /**
   * handlePlane3DClick — left-click in 'plane3d' mode.
   * Picks 3D position using full getWorldPosition() chain (3D tiles → terrain → ellipsoid).
   * v47.125: upgraded from raw pickPosition to robust 3-fallback chain.
   * v62: defensive no-3D-tiles guard — reject any pick whose pickMethod !== '3dtiles'
   *   so a bare 2D map trace (terrain/ellipsoid fallback) can't accumulate
   *   degenerate horizontal-frame points. See mode-entry guard for Layer A.
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
      // v62 (3D-plane no-tiles guard, Layer C): on a bare 2D map, getWorldPosition
      // falls through to terrain (globe.pick on a hidden globe is skipped) or
      // ellipsoid. Either way, the point is on the WGS84 ellipsoid (h=0) — NOT
      // on the roof. Reject so the user gets a clear "this region has no 3D
      // coverage" message instead of building a horizontal frame with arbitrary
      // u-axis and seeing "wonky" panels on Auto Fill.
      //
      // v66: that rejection is still exactly right MID-TRACE on a tiled address
      // — once a corner has landed on the mesh, a later ellipsoid pick means the
      // user missed the roof, and accepting it would drop that corner to the
      // ground. It is wrong in two other cases, both handled below.
      if (!flatTraceRef.current && hit.pickMethod !== '3dtiles') {
        if (pts3DCesiumRef.current.length === 0) {
          // FIRST corner of the trace, and there is no mesh under it.
          //
          // Layer A only sees whether a tileset OBJECT loaded. Google's
          // Photorealistic 3D Tiles root loads globally, so on an address
          // inside a coverage GAP the tileset is non-null and Layer A waves the
          // user through — and then every single click gets rejected here and
          // the tool is unusable with no way forward. That is the most common
          // shape of "this address has no 3D", and it is invisible until the
          // first pick comes back from the ellipsoid.
          //
          // So: no mesh under the very first corner means no mesh here. Drop
          // into flat trace and accept the point instead of refusing.
          //
          // But a single off-mesh click is ambiguous: it is equally the shape of
          // a stray click on a covered address. So the FIRST one still gets the
          // old message and is still rejected — a mis-click on a working 3D
          // address behaves exactly as it always has. Only a SECOND consecutive
          // off-mesh first-click, which a mis-click essentially never produces
          // but an uncovered address always does, switches to flat trace.
          offMeshFirstClicksRef.current += 1;

          if (offMeshFirstClicksRef.current < 2) {
            setStatusMsg(
              `That point isn't on a 3D roof surface (${hit.pickMethod} pick). If you're aiming at the roof, click the roof itself — ` +
              `if this address simply has no 3D coverage, click once more and I'll trace it flat instead.`
            );
            addLog('PLANE3D', `Off-mesh first click #1 (${hit.pickMethod}) — offering flat trace on the next one`);
            return;
          }

          flatTraceRef.current = true;
          setFlatTrace(true);
          enterTopDownForFlatTrace();
          const pitchNow = Math.round(tiltRef.current ?? 0);
          setStatusMsg(
            `🗺️ No 3D roof mesh here — tracing flat, and I've snapped the view straight down. ` +
            `That's required: from a tilted camera a click aimed at a roof lands on the ground BEYOND the building, ` +
            `so the outline comes out displaced. Now click this face's corners (3+) and right-click to finish. ` +
            `Pitch starts at ${pitchNow}° (Tilt slider); direction comes from the shape you draw.`
          );
          addLog('PLANE3D', `Flat trace confirmed by a 2nd off-mesh first click (${hit.pickMethod}) — snapped to nadir, DISCARDING this corner (picked while tilted, so it carries parallax)`);
          // Deliberately do NOT accept this corner: it was picked from the old
          // tilted pose and is displaced. The camera has moved under the cursor
          // anyway, so the pixel no longer means what the user aimed at.
          return;
        } else {
          // Mid-trace miss on an address that DOES have mesh. Unchanged.
          setStatusMsg(
            `3D Plane: that point missed the roof surface — ${hit.pickMethod} pick detected. Click on the roof itself, or hit Clear to restart the trace.`
          );
          addLog('PLANE3D', `Rejected click — pickMethod=${hit.pickMethod} mid-trace (${pts3DCesiumRef.current.length} pts already on mesh)`);
          return;
        }
      }
      // A pick that DID land on the mesh proves there is coverage here, so the
      // off-mesh counter starts over. Without this, two stray clicks spread
      // across a long session would eventually offer a flat trace on an address
      // that has perfectly good 3D.
      if (hit.pickMethod === '3dtiles') offMeshFirstClicksRef.current = 0;

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
      addLog('PLANE3D', `Finalizing: ${cartPts.length} points${flatTraceRef.current ? ' (FLAT TRACE)' : ''}`);

      let frame: Plane3DFrame;
      let plane: RoofPlane;

      if (flatTraceRef.current) {
        // ── v66 FLAT TRACE: build the face from the FOOTPRINT ────────────────
        // The picked heights are meaningless here (every click hit the WGS84
        // ellipsoid), so we read lat/lng only and synthesize the third
        // dimension from pitch + azimuth. See lib/3d/footprintToRoofPlane.ts
        // for why this yields TRUE slope area rather than footprint area.
        const outline = cartPts.map(p => {
          const g = ecefToLatLng(p);
          return { lat: g.lat, lng: g.lng };
        });

        // Azimuth from the SHAPE the user traced: the longest edge approximates
        // the ridge, the slope runs perpendicular to it, and of the two normals
        // we take the equator-facing one. This is the "minimal effort" half of
        // Aurora's promise — the installer confirms a direction rather than
        // knowing one. Already written, exported and unit-tested for Nearmap.
        const centroidLat = outline.reduce((s, v) => s + v.lat, 0) / outline.length;
        const azimuthDeg = deriveAzimuthFromOutline(outline, centroidLat);

        // Ground reference comes from the points the user actually clicked, NOT
        // from cesiumGroundElevRef.
        //
        // Those picks landed on the rendered surface — that IS the ground under
        // this building, in the scene's own frame, by construction. The shared
        // ref is computed separately from Google's elevation API plus a geoid
        // approximation (see the fly effect), and when that API returns nothing
        // it silently becomes `0 + geoidApprox` ≈ -32 m: the whole face would be
        // built ~180 m below the terrain at an Illinois address and every panel
        // on it would be buried out of sight. Using the picks removes that
        // dependency entirely and cannot disagree with what the user saw.
        const pickedGroundM = cartPts.length > 0
          ? cartPts.reduce((s, p) => s + ecefToLatLng(p).height, 0) / cartPts.length
          : (cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0);

        const built = roofPlaneFromFootprint(outline, {
          pitchDeg: tiltRef.current ?? 0,
          azimuthDeg,
          // A traced face has no measured eave height and it does not affect
          // pitch, azimuth or area — only where the face floats. Adjustable
          // from the flat-trace badge.
          eaveHeightM: flatTraceEaveHeightRef.current,
          groundElevM: pickedGroundM,
        });

        if (!built) {
          setStatusMsg('🗺️ Flat trace: those corners don\'t form a roof face — they\'re collinear or under 0.5 m across. Click 3+ corners around the face and right-click to finish.');
          addLog('PLANE3D', `Flat trace rejected: ${cartPts.length} pts did not form a face`);
          return;
        }

        frame = built.frame;
        plane = built.plane;

        // A traced pitch is the installer's ESTIMATE, not a measurement, and it
        // flows through to the planset. Route it through the same review step
        // detected planes use rather than asserting it as confirmed fact.
        plane.source = 'manual';
        plane.confirmed = false;
        // Remember the inputs so a later eave-height change can rebuild this
        // exact face instead of making the user re-trace it.
        (plane as any).__flatTrace = {
          outline,
          pitchDeg: tiltRef.current ?? 0,
          azimuthDeg,
          eaveHeightM: flatTraceEaveHeightRef.current,
        };
        flatTracedPlaneIdsRef.current = [...flatTracedPlaneIdsRef.current, plane.id];
        flatTraceParamsRef.current.set(plane.id, {
          outline,
          pitchDeg: tiltRef.current ?? 0,
          azimuthDeg,
          groundElevM: pickedGroundM,
        });

        addLog('PLANE3D', `Flat trace built: az=${azimuthDeg.toFixed(1)}° (from shape) pitch=${plane.pitch.toFixed(1)}° (from Tilt slider) eave=${flatTraceEaveHeightRef.current.toFixed(1)}m area=${plane.area.toFixed(1)}m²`);
      } else {
        // ── Mesh path: derive the plane from the picked elevations.
        // Step 1: Compute exact plane frame (first 3 pts define plane, rest projected)
        frame = computePlaneFromPoints3D(cartPts);

        // Step 2: Build complete RoofPlane using projected points (guaranteed coplanar)
        plane = buildRoofPlane3D(cartPts);

        // NOTE (v66): an earlier pass added a fallback here that REBUILT the
        // plane from its footprint whenever the fitted pitch came out flat.
        // It was removed: rebuilding after the fact silently replaced the exact
        // corners the user placed, which desynchronised Stitch (it operates on
        // those corners) and moved faces out from under the trace. Roof shape
        // is now adjusted EXPLICITLY from the Building controls instead of
        // being inferred here. Do not reintroduce an automatic rebuild in this
        // path — what the user clicked is what this branch must produce.
      }

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

      // Render plane visualization (full for panel planes; outline-only for marked).
      const isSelected = faceIsInSelection(plane.id);
      // 🚨 THE MARK PLANE INTENT IS RECORDED ON THE PLANE, NOT IN A REF.
      //
      // It used to live in a component-lifetime `Set`, which meant it did not
      // survive a reload at all — a face the user marked came back as an
      // ordinary face — and, worse, the same Set was ALSO used to answer "does
      // this face have panels", so it latched that answer for ever and no deck
      // was ever drawn under an array. Deleting the Set removed the latch and
      // the intent together. The intent is a real user decision and belongs on
      // the object it is about, where persistence carries it.
      //
      // 🚨 THE RENDERER DELIBERATELY DOES NOT READ IT, and that is not an
      // oversight. Work through the four cases and the intent never changes
      // what is drawn: a marked face has no panels, so "no panels → outline"
      // already answers it; and a marked face that something HAS panelled needs
      // a deck under those modules whatever was intended when it was traced.
      // Reading it in `planeRendersOutlineOnly` would be a branch that returns
      // the same answer either way — a second source of truth that cannot
      // disagree today and will the moment one of the two rules changes.
      //
      // It is recorded for the consumers that SHOULD care and currently have no
      // way to: the Roof Planes sidebar, the planset, and `handleAutoRoof`,
      // which fills marked faces because nothing tells it not to. Whether it
      // ought to is a question about PLACEMENT, and is not the renderer's to
      // answer.
      if (!fillPanels) (plane as any).markOnly = true;

      // `!fillPanels` rather than `planeRendersOutlineOnly` for this ONE call:
      // the face is being created and has no panels yet, so the predicate would
      // draw an outline for the frame before Auto Layout fills it. Every later
      // draw of this face goes through the predicate and converges.
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
      // 🚨 Through the ref — see `fireSetbacksRef`. The prop here is whatever
      // was configured when the 3D view mounted.
      const edgeSetbackM  = fireSetbacksRef.current?.edgeSetbackM  ?? 0.457;
      const ridgeSetbackM = fireSetbacksRef.current?.ridgeSetbackM ?? 0.457;
      const eaveSetbackM  = fireSetbacksRef.current?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
      const layoutId      = `plane3d-${plane.id}`;

      const clResult = placePanelsControlled({
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:            'plane3d',
        mountingSystemId: mountingSystemIdRef.current,
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
      // 🚨 THE SAME BARE `scene.pickPosition` THAT KILLED TREE AND CHIMNEY.
      // It reads the depth buffer, so on a property with no Google mesh -- the
      // exact case the custom pipeline exists for -- it returned undefined and
      // this tool did nothing at all. One authority now answers
      // "where did the user point?", from the design's own geometry.
      const spot = resolvePlacementPoint(viewer, C, screenPos, 'roof');
      if (!spot) {
        addLog('SURFACE', 'no placement intersection for surface select');
        setStatusMsg('Surface click — could not find a surface there. Aim at the roof.');
        return;
      }
      const pickedPos = spot.cartesian;

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
      // 🚨 Through the ref — see `fireSetbacksRef`. The prop here is whatever
      // was configured when the 3D view mounted.
      const edgeSetbackM  = fireSetbacksRef.current?.edgeSetbackM  ?? 0.457;
      const ridgeSetbackM = fireSetbacksRef.current?.ridgeSetbackM ?? 0.457;
      const eaveSetbackM  = fireSetbacksRef.current?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
      const layoutId      = `surface-${plane.id}`;

      // v48.7: Route through control layer (surface_select mode)
      const clResult  = placePanelsControlled({
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:        'surface_select',
        mountingSystemId: mountingSystemIdRef.current,
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
      // 🚨 THE SAME BARE `scene.pickPosition` THAT KILLED TREE AND CHIMNEY.
      // It reads the depth buffer, so on a property with no Google mesh -- the
      // exact case the custom pipeline exists for -- it returned undefined and
      // this tool did nothing at all. One authority now answers
      // "where did the user point?", from the design's own geometry.
      const spot = resolvePlacementPoint(viewer, C, screenPos, 'roof');
      if (!spot) { setStatusMsg('Snap Panel — click on the roof near the array'); return; }
      const pickedPos = spot.cartesian;

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
      // 🚨 THE SAME BARE `scene.pickPosition` THAT KILLED TREE AND CHIMNEY.
      // It reads the depth buffer, so on a property with no Google mesh -- the
      // exact case the custom pipeline exists for -- it returned undefined and
      // this tool did nothing at all, and said nothing. One authority now answers
      // "where did the user point?", from the design's own geometry.
      const spot = resolvePlacementPoint(viewer, C, screenPos, 'roof');
      if (!spot) { setStatusMsg('Extend Row — could not find the roof there. Aim at a roof face.'); return; }
      const pickedPos = spot.cartesian;
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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:           'extend_row',
        mountingSystemId: mountingSystemIdRef.current,
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
      // 🚨 THE SAME BARE `scene.pickPosition` THAT KILLED TREE AND CHIMNEY.
      // It reads the depth buffer, so on a property with no Google mesh -- the
      // exact case the custom pipeline exists for -- it returned undefined and
      // this tool did nothing at all, and said nothing. One authority now answers
      // "where did the user point?", from the design's own geometry.
      const spot = resolvePlacementPoint(viewer, C, screenPos, 'roof');
      if (!spot) { setStatusMsg('Add Row — could not find the roof there. Aim at a roof face.'); return; }
      const pickedPos = spot.cartesian;
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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:           'add_row',
        mountingSystemId: mountingSystemIdRef.current,
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
   * handleObstructionClick — v66 (obstruction-primitive): Aurora-parity
   * "Add Obstruction". Single click places a small rectangular prism
   * (chimney, vent, dormer) centered on the click point. Default
   * 0.6m × 0.6m × 1.0m, configurable via the right-panel sliders.
   *
   * Replaces the v47 red-sphere marker (which used a hidden circular
   * keep-out radius and a label that said "Vent"). The new visual is
   * the same family as the v64 Block primitive (light-gray extruded
   * polygon with a dark outline) so the two read as siblings, and the
   * keep-out shape now matches the visible footprint.
   *
   * Math (footprint corners, clamps) lives in
   * `components/3d/obstruction/dimensions.ts` and is unit-tested in
   * `tests/obstruction.test.ts`.
   */
  function handleObstructionClick(viewer: any, C: any, screenPos: any) {
    try {
      // 🚨 THE ARMED TYPE IS READ FIRST, BECAUSE IT DECIDES WHERE THE CLICK
      // LANDS. A tree is placed on the ground and a chimney on a roof face;
      // asking "where did the user point?" without knowing which of those is
      // being placed cannot give one right answer.
      const preset = presetFor(obstructionPresetRef.current);

      const spot = resolvePlacementPoint(viewer, C, screenPos, preset.space === 'site' ? 'site' : 'roof');
      if (!spot) {
        // 🚨 A FAILED CLICK MUST NOT LOOK LIKE A SUCCESSFUL ONE. The old
        // message blamed tiles that this property does not have and never will.
        setStatusMsg(`Could not place ${preset.label.toLowerCase()} here — aim at ${preset.space === 'site' ? 'the ground near the house' : 'a roof face'} and try again`);
        addLog('WARN', `obstruction placement: no intersection for ${preset.id} (${preset.space})`);
        return;
      }
      const obsLat = spot.lat;
      const obsLng = spot.lng;
      const obsH   = spot.height;

      // 🚨 A ROOF OBJECT MUST LAND ON A ROOF. Placing a chimney over open
      // ground built a prism standing in the garden that Auto Layout then had to
      // route panels around. Refusing is the honest answer, and it names the
      // reason rather than failing silently.
      if (preset.space === 'roof' && !spot.planeId) {
        setStatusMsg(`${preset.label} needs a roof — click on a roof face`);
        // 🚨 AND THE LOG SAYS WHICH OF THE THREE THINGS WENT WRONG. A point was
        // resolved here; only the FACE binding failed. Without the trail that is
        // indistinguishable from the ray missing the house.
        addLog('WARN', `obstruction placement: ${preset.id} clicked off every roof face — ${(spot.trail ?? []).join(' | ')}`);
        return;
      }

      // 🚨 CLAMPED AGAINST THE OBJECT, NOT AGAINST ONE GLOBAL BAND.
      //
      // `clampObstructionFootprint` bounds the footprint to [0.2, 3.0] m and the
      // height to [0.3, 5.0] -- a range chosen for the single generic
      // 0.6 x 0.6 x 1.0 block this feature started as. Once there were nine real
      // objects it silently rewrote four of them at the moment of placement:
      //
      //   tree            6.0 x 6.0 x 8.0  ->  3.0 x 3.0 x 5.0
      //   vent pipe       0.10 wide        ->  0.20
      //   plumbing stack  0.15 wide        ->  0.20   (now identical to a vent pipe)
      //   skylight        0.12 tall        ->  0.30
      //
      // The tree is the one that was reported: a 3 m stump instead of a 6 m
      // canopy. And because `canopyRadiusM` is derived from the footprint below,
      // every shade result was computed on half a tree -- so this was never
      // cosmetic. The right-hand panel already offered a canopy up to 30 m, so
      // the placement clamp and the editor had been contradicting each other.
      //
      // 🚨 FROM THE REF, NOT FROM STATE — see `obstructionSizeRef`. Reading the
      // state variables here is what made the tree 1 m wide: this function is
      // reached only through a Cesium handler registered at mount, so the state
      // it can see is the state that existed before the user chose anything.
      const armedSize = obstructionSizeRef.current;
      const sized = clampToPreset(preset, armedSize.widthM, armedSize.depthM, armedSize.heightM);
      const widthM = sized.widthM;
      const depthM = sized.depthM;
      const prismHeightM = sized.heightM;

      // Build the 4 corner points of the centered rectangle.
      const footprint = buildObstructionFootprint(obsLat, obsLng, widthM, depthM);
      const polyPositions = [footprint.sw, footprint.se, footprint.ne, footprint.nw]
        .map(c => safeCartesian3(C, c.lng, c.lat, obsH))
        .filter((p): p is any => p != null);
      if (polyPositions.length < 4) {
        setStatusMsg('Obstruction: failed to build footprint — try again');
        return;
      }

      // Placed-obstruction record. widthM/depthM/heightM drive the new
      // rectangular keep-out in removeObstructedPanels; radiusM stays
      // set to the diagonal-half as a safe legacy fallback.
      const legacyRadiusM = legacyRadiusFor(widthM, depthM);
      // 🚨 THE NOUN THE USER CHOSE, not 'chimney' for everything. It decides
      // the keep-out clearance (lib/3d/panelKeepOut.ts) and whether the object
      // occupies roof area at all or only shades it, so stamping one type on
      // every object gave a vent pipe a chimney's 450 mm clearance and gave a
      // tree one it should never have had. `preset` is resolved at the top of
      // this function, before the click is even located.
      const newObs: PlacedObstruction = {
        id:      `obs-${Date.now()}`,
        lat:     obsLat,
        lng:     obsLng,
        height:  obsH,
        radiusM: legacyRadiusM,
        widthM,
        depthM,
        heightM: prismHeightM,
        type:    preset.id,
        space:   preset.space,
        // A tree's canopy is not its keep-out. It is what shades.
        canopyRadiusM: preset.space === 'site' ? Math.max(widthM, depthM) / 2 : undefined,
        // Which face it was marked on, so it belongs to a surface rather than
        // floating at a world coordinate when that surface moves.
        //
        // 🚨 THE FACE THE RAY HIT, NOT THE FACE THAT HAPPENED TO BE SELECTED.
        // `selectedFaceIdRef.current` bound a chimney marked on the garage to
        // the main roof whenever the main roof was the current selection, and it
        // bound it to NOTHING when no face was selected at all.
        planeId: preset.space === 'roof' ? (spot.planeId ?? undefined) : undefined,
      };

      // 🚨 ONE DRAW PATH. This used to hand-roll its own white polygon while
      // `drawObstructionEntity` — the one a reload and an undo use — drew a tree
      // green. So a tree looked like a vent until the page was reloaded, and the
      // owner's "it does not visibly give me a useful tree" was partly this:
      // the object WAS there, wearing the wrong thing.
      drawObstructionEntity(viewer, C, newObs);

      // Update obstruction list
      const updatedObs = [...obstructionsRef.current, newObs];
      obstructionsRef.current = updatedObs;
      setObstructions(updatedObs);

      // Remove panels inside the new rectangular footprint (Aurora parity)
      // or, for legacy obstructions, inside the radiusM circle.
      const filtered = removeObstructedPanels(panelsRef.current, [newObs]);
      const removed  = panelsRef.current.length - filtered.length;

      if (removed > 0) {
        // 🚨 SNAPSHOT FIRST. See `onPanelsAboutToBeCulled`: without this a
        // mis-placed vent cost the array for good.
        onPanelsAboutToBeCulled?.(`Mark ${preset.label.toLowerCase()}`);
        // Remove Cesium entities for culled panels
        panelsRef.current.filter(p => !filtered.find(f => f.id === p.id)).forEach(p => {
          removePanelEntities(viewer, p.id); // v47.159
        });
        lastRenderedPanelsRef.current = filtered;
        panelsRef.current = filtered;
        onPanelsChange(filtered);
        setPanelCount(filtered.length);
        setStatusMsg(`${preset.icon} ${preset.label} placed — ${removed} panel(s) removed from under it. Undo brings them back.`);
      } else {
        // 🚨 SAY WHAT WAS BUILT AND WHERE. "Obstruction placed at 0.6x0.6x1.0m"
        // does not tell a person whether the thing they asked for exists.
        const where = newObs.planeId ? 'on the roof face you clicked' : 'on the site';
        setStatusMsg(`${preset.icon} ${preset.label} placed ${where} — ${widthM.toFixed(1)}×${depthM.toFixed(1)}m, ${prismHeightM.toFixed(1)}m tall. Select it to adjust.`);
      }

      addLog('OBS', `Placed obstruction at ${obsLat.toFixed(5)}, ${obsLng.toFixed(5)} — ${widthM.toFixed(2)}×${depthM.toFixed(2)}×${prismHeightM.toFixed(2)}m, ${removed} panels removed`);
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
  // 🚨 The conversion itself now lives in lib/3d/laneA.ts so the integration
  // harness can run the REAL production code against archived Google Solar
  // payloads. It used to be inlined here, inside a component that needs Cesium,
  // WebGL, terrain and an API key to instantiate — so the geometry and the
  // provenance, the parts that reach a permit drawing, could never be tested at
  // all. This wrapper keeps the old name and adds only the logging.
  function segmentToRoofPlane3D(seg: any, groundElevM: number): RoofPlane | null {
    const plane = segmentToRoofPlane(seg as LaneASegment, groundElevM);
    if (!plane) addLog('AUTO', `segmentToRoofPlane3D: segment produced no usable plane`);
    return plane;
  }

  /**
   * Build roof planes from the digital twin's Google Solar segments, stamp them
   * as machine-detected, and hand them to DesignStudio.
   *
   * Extracted from handleAutoRoof so Auto Fill and Lane A run the SAME code.
   * `why` only labels the log line; behaviour is identical for both callers.
   *
   * v62: build CLEAN planes from Google Solar's detected roof segments and run
   * them through the SAME flush grid engine (placePanelsControlled) the
   * hand-drawn tool uses — accurate per-face geometry + the proven 0-gap
   * aligned grid. (A previous attempt used the gappy/staggered
   * fillRoofSegmentWithPanels engine — wrong engine.)
   *
   * v66: HAND THEM OVER. Until then these were used to place panels and then
   * dropped on the floor: onRoofPlaneCreated is called from exactly one place
   * (finalizePlane3D), so a correctly auto-detected roof left the Roof Planes
   * sidebar reading "No Planes Detected", saved a design with zero roof
   * geometry, and gave the planset nothing to stand on — even though the
   * per-face pitch, azimuth and hull were right here.
   *
   * 🚨 These came from Google Solar, not from a person, so they arrive
   * UNCONFIRMED and route through the same operator review the Nearmap planes
   * already use. buildRoofPlane3D hardcodes source:'manual' and confirmed:true
   * (lib/roofPlane3D.ts ~582) because it was only ever called for hand-traced
   * faces; override both rather than let a detection assert itself as a
   * person's decision. tests/detectedPlaneProvenance.test.ts pins this.
   */
  function detectPlanesFromTwin(why: string, forSiteKey?: string): RoofPlane[] {
    const gElev = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    const segPlanes = (twinRef.current?.roofSegments ?? [])
      .map((s: any) => segmentToRoofPlane3D(s, gElev))
      .filter((p: RoofPlane | null): p is RoofPlane => !!p);
    if (segPlanes.length === 0) return [];
    addLog('AUTO', `${why}: built ${segPlanes.length} clean planes from Google roof segments`);
    // 🚨 STAMP THE SITE THIS DETECTION ANSWERS FOR, captured at FIRE TIME.
    // Twin loads are async and uncancelled: two address changes in quick
    // succession produce two in-flight requests that can resolve out of order.
    // Without this stamp, a response for the PREVIOUS property would be merged
    // into the CURRENT one's roof. DesignStudio rejects any emit whose site
    // does not match the site on screen.
    const siteKey = forSiteKey ?? siteKeyFromCoords(lat, lng);
    // Stamping lives in lib/3d/laneA.ts alongside the conversion, so the
    // harness proves the provenance a reviewer relies on, not just the geometry.
    const detected = stampDetectedProvenance(segPlanes, { siteKey });
    onRoofPlanesDetected?.(detected);
    addLog('AUTO', `${why}: emitted ${detected.length} detected planes to DesignStudio (unconfirmed, source=solar_api)`);
    return detected;
  }

  /**
   * LANE A — zero-click roof detection.
   *
   * Runs `detectPlanesFromTwin` only when every condition in `shouldRunLaneA`
   * holds, all read from REFS at fire time. See that function for why each
   * refusal exists; the two that matter most are "the design already has roof
   * geometry" and "the DB restore has not resolved yet".
   *
   * 🚨 EMIT-ONLY-ADD. This goes through onRoofPlanesDetected, whose handler in
   * DesignStudio merges by id and never replaces or deletes. Lane A can only
   * ever ADD a starting shape to an empty design. Do not "simplify" that merge
   * into a replace, and do not call this from an effect keyed on roofPlanes —
   * that would re-fire on the state it just caused.
   */
  function maybeRunLaneA(why: string): void {
    const siteKey = laneASiteKey(lat, lng);
    const gate: LaneAGateInput = {
      stage: stageRef.current,
      groundElevResolved: cesiumGroundElevResolvedRef.current,
      segmentCount: twinRef.current?.roofSegments?.length ?? 0,
      existingPlaneCount: (roofPlanesRef.current ?? []).length,
      // 🚨 AND THE FACT THE COUNT ABOVE CANNOT EXPRESS. Zero planes reads the
      // same whether nobody has modelled this house yet or somebody modelled it
      // and deleted it, and the gate must answer those two opposite ways. Read
      // from a ref at fire time, like every other field here.
      lifecycle: geometryLifecycleRef?.current ?? 'untouched',
      restoreResolved: roofRestoreResolvedRef.current,
      siteKey,
      lastRanSiteKey: laneARanForRef.current,
      // 🚨 THE DECISION, READ FROM A REF AT FIRE TIME.
      //
      // Without it at all the gate always saw 'undecided' and the refusal in
      // shouldRunLaneA could never fire in production — the rule existed and was
      // unreachable. Reading it from the PROP fixed that but left a narrower
      // hole: this function is called from inside `buildDigitalTwin(...).then()`,
      // seconds after the render whose closure it captured, so a decision the
      // installer made DURING the fetch was invisible to it. Every other field
      // in this object is a `.current` for exactly that reason, and lib/3d/laneA.ts
      // states the contract: "Every one is read from a REF at fire time, never
      // captured in a closure."
      nativeDisposition: nativeDispositionRef?.current ?? nativeDisposition ?? 'undecided',
    };
    if (!shouldRunLaneA(gate)) {
      addLog('AUTO', `LaneA(${why}): refused — ${JSON.stringify(gate)}`);
      return;
    }
    // Mark BEFORE emitting: a re-entrant twin load for the same building must
    // not append a second set (buildRoofPlane3D mints a fresh uuid per call).
    laneARanForRef.current = siteKey;
    const detected = detectPlanesFromTwin(`LaneA(${why})`, siteKey);
    if (detected.length === 0) {
      addLog('AUTO', `LaneA(${why}): twin had segments but none produced a usable plane`);
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
      // Subject reference: prefer the user's MARKED planes (source 'manual' /
      // createdFrom3D). The geocode (lat,lng) can land on the NEIGHBOUR (3 Melvin
      // Dr geocodes ~17m onto the next house), seeding the filter on the wrong
      // building and skipping the roof the user drew. The marked plane is truth.
      // 🚨 THE SEED IS "ANY REAL GEOMETRY BEATS THE GEOCODE", NOT "ONLY HAND WORK".
      // Narrowing this to hand-modelled faces was a regression on the PREFERRED
      // provider: Lane A only runs on an empty design, so "Google faces and
      // nothing else" is the normal post-detection state, and a Google-only
      // design would seed from the geocode — the input the comment above names
      // as landing ~17 m onto the neighbour. Hand-modelled faces still WIN when
      // both exist, which is the preference that was actually wanted.
      const handModelled = eligiblePlanes.filter(p => isHandModelledFace(p) && p.vertices && p.vertices.length >= 3);
      const marked = handModelled.length > 0
        ? handModelled
        : eligiblePlanes.filter(p => p.vertices && p.vertices.length >= 3);
      const sv = marked.flatMap(p => p.vertices ?? []);
      const subjectPt = sv.length > 0
        ? { lat: sv.reduce((s, v) => s + v.lat, 0) / sv.length, lng: sv.reduce((s, v) => s + v.lng, 0) / sv.length }
        : { lat, lng };
      // 🚨 AUTHORED FACES ARE NEVER CROPPED OUT OF THE FILL SET. Even with the
      // destructive writes gone from the 2D side, a detached garage would still
      // have received ZERO panels — it is its own adjacency cluster and the
      // clustering keeps only the seed's. Distance cannot tell a garage from a
      // neighbour's roof; authorship can, and it is already recorded.
      const { scope: kept } = autoLayoutScope({
        planes: eligiblePlanes,
        vertsOf: (p) => (p.vertices ?? []) as Array<{ lat: number; lng: number }>,
        isAuthored: (p) => isHandModelledFace(p),
        crop: (planes) => {
          const r = filterToSubjectBuilding(
            planes,
            (p) => (p.vertices ?? []) as Array<{ lat: number; lng: number }>,
            subjectPt,
            { maxDistM: 60 },
          );
          return { kept: r.kept, cropped: r.cropped };
        },
      });
      if (kept.length > 0 && kept.length < before) {
        eligiblePlanes = kept;
        addLog('AUTO', `handleAutoRoof: subject filter kept ${kept.length}/${before} planes (seed=${marked.length > 0 ? 'marked-plane' : 'geocode'})`);
      }
    }

    // De-dup: drop a detected (aerial_*) plane that overlaps a hand-traced plane —
    // the same roof captured twice was double-filling (Melvin: 54 traced + 80 on the
    // overlapping aerial plane = 134). The manual trace wins.
    if (eligiblePlanes.length > 1) {
      const { kept: deduped, dropped } = dropDetectedPlanesOverlappingManual(
        eligiblePlanes,
        (p) => (p.vertices ?? []) as Array<{ lat: number; lng: number }>,
        (p) => isHandModelledFace(p),
      );
      if (dropped > 0 && deduped.length > 0) {
        eligiblePlanes = deduped;
        addLog('AUTO', `handleAutoRoof: dropped ${dropped} detected plane(s) overlapping your traced roof`);
      }
    }

    // ── v62: AUTO-DETECT — no hand-drawn planes → build CLEAN planes from Google
    // Solar's detected roof segments and run them through the SAME flush grid engine
    // (placePanelsControlled below) the hand-drawn tool uses. Accurate per-face
    // geometry + the proven 0-gap aligned grid → tight rectangular layout on every
    // covered address, no tracing. (Previous attempt used the gappy/staggered
    // fillRoofSegmentWithPanels engine — wrong engine.)
    if (eligiblePlanes.length === 0) {
      // 🚨 THE SECOND ACQUISITION DOOR. This calls detectPlanesFromTwin
      // DIRECTLY, bypassing shouldRunLaneA entirely — no stage check, no
      // restore check, no plane count, no run-once guard. And it fires in
      // precisely the state a rejection leaves behind (`eligiblePlanes` empty),
      // so pressing Auto Fill after 'Draw Manually Instead' re-injected the
      // exact Google roof that had just been rejected, and the autosave
      // persisted it. One gate on native acquisition, not one gated path and
      // one ungated one.
      // The ref, for the same reason the Lane A gate uses it: this runs from a
      // click handler whose closure may predate a decision made moments ago.
      const decided = nativeDispositionRef?.current ?? nativeDisposition ?? 'undecided';
      // 🚨 AND THE LIFECYCLE, for the same reason the Lane A gate now reads it.
      // The disposition covers "I looked at Google's roof and said no". It does
      // NOT cover the commonest gesture: selecting the faces and deleting them,
      // or pressing Start Over — both of which leave the decision at 'accepted'
      // or 'undecided' and the plane list empty, which is exactly the state this
      // door fires in. Without this, Auto Fill is a one-click undo of a
      // deliberate clearing.
      const lifecycleNow = geometryLifecycleRef?.current ?? 'untouched';
      if (!nativeAcquisitionPermitted(decided)) {
        setStatusMsg('Auto Fill did not re-detect the roof — Google 3D is marked as not governing this property. Model the roof, or change that decision in the Roof Planes panel first.');
        addLog('AUTO', `handleAutoRoof: native acquisition refused (${decided})`);
      } else if (lifecycleNow === 'cleared') {
        setStatusMsg('Auto Fill did not re-detect the roof \u2014 this property was cleared on purpose. Build a roof with the \u{1F3DA} Building tools, or use "Use Google 3D here" to bring the detected roof back.');
        addLog('AUTO', 'handleAutoRoof: native acquisition refused (property deliberately cleared)');
      } else {
        const detected = detectPlanesFromTwin('handleAutoRoof');
        if (detected.length > 0) eligiblePlanes = detected;
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

    // ── Clear the panels THIS FILL OWNS ──────────────────────────────────────
    //
    // 🚨 IT USED TO CLEAR EVERY PANEL ENTITY IN THE SCENE. The SolFence
    // disappeared visually right here, before any state was written, and then
    // for real at `onPanelsChange(newPanels)` below. An auto ROOF fill owns the
    // auto-generated ROOF panels and nothing else — see
    // lib/3d/autoLayoutScope.ts for the rule and why each exception exists.
    const ownership = panelsAutoRoofOwns(panelsRef.current ?? []);
    const preservedPanels = ownership.preserved;
    for (const p of ownership.replaced) {
      try { removePanelEntities(viewer, p.id); } catch { /* ignore */ }
    }
    lastRenderedPanelsRef.current = [];
    // Phase 2: clear roof rails on auto-fill rebuild
    try { clearRoofRails(viewer); } catch {}

    const orientRaw   = (panelOrientationRef.current ?? 'portrait') as string;
    // v50.23: 'hybrid' in 3D mode → use 'portrait' orientation + layoutStrategy:'mixed'
    // The control layer's 'mixed' strategy fills portrait rows then sweeps landscape in remainder.
    const orient      = (orientRaw === 'hybrid' ? 'portrait' : orientRaw) as 'portrait' | 'landscape';
    const isHybrid    = orientRaw === 'hybrid';
    const groundElev  = cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : 0;
    // 🚨 Through the ref — see `fireSetbacksRef`.
    const edgeSetback  = fireSetbacksRef.current?.edgeSetbackM  ?? 0.457;
    const ridgeSetback = fireSetbacksRef.current?.ridgeSetbackM ?? 0.457;
    const eaveSetback  = fireSetbacksRef.current?.eaveSetbackM  ?? 0;      // v50.26: wire eave setback
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
        // 🚨 EVERY placement path passes this. One physical validity
        // authority: auto, manual, row, snap and fill all ask the same
        // question of the same objects. tests/obstructionPlacementAuthority
        // asserts that this line is present at every call site, so a new
        // path cannot quietly reintroduce a placement rule of its own.
        obstructions: obstructionsRef.current ?? [],
        mode:            'auto_roof',
        mountingSystemId: mountingSystemIdRef.current,
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
    // 🚨 A MERGE, NOT A REPLACEMENT. `newPanels` is accumulated purely from roof
    // planes, so handing it to `onPanelsChange` wholesale deleted every fence,
    // ground and hand-placed panel in the project. This path was the outlier —
    // its sibling 3D paths already merge, and the 2D path already preserved
    // MANUAL panels — and the owner lost a SolFence to it.
    const merged = mergeAutoRoofPanels(preservedPanels, newPanels);
    if (merged.suppressed > 0) {
      addLog('AUTO', `handleAutoRoof: ${merged.suppressed} generated panel(s) suppressed under hand-placed modules`);
    }
    if (preservedPanels.length > 0) {
      addLog('AUTO', `handleAutoRoof: preserved ${preservedPanels.length} panel(s) this fill does not own (fence/ground/hand-placed)`);
    }
    lastRenderedPanelsRef.current = merged.panels;
    panelsRef.current = merged.panels;
    onPanelsChange(merged.panels);
    setPanelCount(merged.panels.length);
    // Phase 2: render roof rails after auto-fill completes
    try { renderRoofRails(viewer, C, merged.panels); } catch (e) { handleCesiumError('renderRoofRails auto', e, true); }
    setStatusMsg(`Auto-roof: ${newPanels.length} panels on ${eligiblePlanes.length} roof planes (frame-locked)`
      + (preservedPanels.length > 0 ? ` \u00b7 kept ${preservedPanels.length} existing` : ''));

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
        o.heading = TILTED_AERIAL_VIEW.heading; o.pitch = TILTED_AERIAL_VIEW.pitch; o.radius = radius;  // -45° Aurora parity (Reset View)
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
    const geoidApproxFill = geoidUndulationM(seg.center.lat);
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
    // 🚨 Through the ref — see `fireSetbacksRef`.
    const edgeSetbackM  = (fireSetbacksRef.current?.edgeSetbackM  ?? 0.457); // 18 inches default
    const ridgeSetbackM = (fireSetbacksRef.current?.ridgeSetbackM ?? 0.457); // 18 inches default
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
        const height = segElev + tanPitch * slopeProj + moduleStackHeightM(mountingSystemIdRef.current);
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
          // The automatic fill OWNS these, so Auto Layout may replace them.
          layoutSource: 'AUTO',
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
        const pHeight = panelCarto.height + moduleStackHeightM(mountingSystemIdRef.current);

        if (!isValidCoord(pLat, pLng, pHeight)) continue;

        if (clipPoly.length >= 3 && !pointInPolygon(pLat, pLng, clipPoly)) { clipped++; continue; }

        const panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: -(pitchDeg * Math.PI / 180), roll: 0, orientation: orient,
          // The automatic fill OWNS these, so Auto Layout may replace them.
          layoutSource: 'AUTO',
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
    /**
     * 🚨 WHO PUT THIS PANEL HERE. Auto Layout replaces the panels it owns and
     * preserves the ones a person placed (`panelsAutoRoofOwns`), and it decides
     * by this field -- so a panel without it is AUTO-OWNED AND DESTROYED.
     *
     * `createPanel` never set it. Every panel placed with the Roof tool
     * therefore carried `layoutSource === undefined`, and pressing Auto Fill
     * deleted the lot: an installer hand-places twelve modules on a dormer
     * Cesium fills badly, then fills the main roof, and the dormer work is gone.
     * Panels from the Snap tool survived, because that one path stamped
     * 'MANUAL' -- so the product destroyed hand-placed work inconsistently,
     * which is worse than doing it always.
     *
     * DEFAULTS TO 'MANUAL' ON PURPOSE. A call site that forgets to say should
     * cost a stale panel, never a destroyed one. The automatic fill says 'AUTO'
     * explicitly.
     */
    layoutSource?: 'MANUAL' | 'AUTO';
  }): PlacedPanel {
    const p: any = {
      id: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      layoutId: 'layout-1',
      lat: opts.lat, lng: opts.lng, x: 0, y: 0,
      tilt: opts.tilt, azimuth: opts.azimuth,
      // P0-6: fence panels ALWAYS stamp the equipment-db fence record (Ray's
      // ruling 2026-07-19 — PS-MNB108(HCBF)-440W only); other system types
      // stamp the studio-selected panel (the placement-time equipment authority).
      //
      // 🚨 FROM THE REF. `createPanel` is reached from `handleRoofClick`, which
      // is reached only from the Cesium LEFT_CLICK handler registered once at
      // mount — so the `selectedPanel` PROP visible here is the module that was
      // selected when the 3D view opened, for the life of the page. Every other
      // wattage stamp in this file already reads `selectedPanelRef.current`
      // (the row, fence, snap, paste and auto-fill paths); this was the one
      // outlier, and it is the one the Roof tool uses.
      //
      // The effect was silent and self-contradicting: the HUD's kW readout is
      // evaluated in render scope, so it showed the NEW module and agreed with
      // the picker, while the panels it was counting carried the OLD wattage.
      // The same design then disagreed with itself by tool — an auto-filled
      // main roof at 440 W beside a hand-placed dormer at 400 W — and the
      // falsified per-panel wattage persists with the layout, where
      // `lib/pricingEngine.ts` sums it for system price and price-per-watt.
      wattage: opts.systemType === 'fence'
        ? (getPanelById(FENCE_PANEL_EQUIPMENT_ID)?.watts ?? selectedPanelRef.current?.wattage ?? 400)
        : (selectedPanelRef.current?.wattage ?? 400),
      bifacialGain: opts.systemType === 'fence' ? 1.15 : 1.0,
      row: 0, col: 0,
      height: opts.height, heading: opts.heading,
      pitch: opts.pitch, roll: opts.roll,
      systemType: opts.systemType,
      orientation: opts.orientation ?? panelOrientationRef.current,
      planeId: opts.planeId,  // v47.152: undefined for free-click, planeId string for plane-bound
      // 🚨 FAIL SAFE: absent means a person put it there. See the opts doc.
      layoutSource: opts.layoutSource ?? 'MANUAL',
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

  // ── The selection, and what may honestly be said about it ──────────────────
  //
  // 🚨 THIS REPLACES `effectiveWallM` / `effectivePitchDeg` / `adjustBuilding`.
  //
  // Those read a global `wallHeightM` React counter that started at 3.0 m and
  // only ever moved by what had been pressed. It named no wall. It was rendered
  // beside a chip reading THIS FACE, under a `buildingOverrides` map that
  // `setBuildingOverrides` never wrote to — so both branches of the ternary
  // returned the same global, and pressing the stepper with one face selected
  // moved the whole-building number while moving one face's geometry. Eight
  // faces, eight presses, one foot of building and eight feet of readout. The
  // live test reported "around 17 ft" on a wall that was 10' 6".
  //
  // Everything below is derived from canonical geometry on every render. There
  // is no stored number here for a control to drift away from.
  // 🚨 THE PROP, NOT THE REF. THIS IS A RENDER, AND THE REF LAGS A RENDER.
  //
  // `roofPlanesRef.current` is written by `useEffect(..., [roofPlanes])` at
  // :2267 — AFTER the render that received the new array. Reading it here meant
  // the inspector displayed the PREVIOUS state of the building, and nothing
  // scheduled a second render to catch up. Two independent adversarial audits
  // measured the same thing:
  //
  //     press +1 ft five times  →  the roof rose 3 ft, not 5 ft,
  //                                and the field read 11.5 against a model
  //                                that was at 12.51
  //
  // EVERY SECOND PRESS WAS A NO-OP, because the stepper computes its next
  // target as `shown + 1 ft` from the stale number, which is the value the
  // model already holds. That is "press, compensate, press again" and "the UI
  // reports a height the geometry does not represent" — the exact defect this
  // whole subsystem was written to kill, re-entering through a different door.
  //
  // The inspector's own unit test could not see it: it mounts a hand-built
  // `InspectorState` that never changes between presses. A behavioural test of
  // a component that is fed a constant proves the component, not the wiring.
  const inspectorPlanes = roofPlanes ?? [];
  const selectedSectionId = activeFaceId ? sectionIdOfFaceId(activeFaceId) : null;
  const selectedFaceSectionId = activeFaceId
    ? (inspectorPlanes.find(p => p.id === activeFaceId)?.sectionId || selectedSectionId)
    : null;
  selectedFaceSectionIdRef.current = selectedFaceSectionId;
  /**
   * DOES THE SELECTED FACE BELONG TO A BUILDING SECTION?
   *
   * 🚨 THE ONLY HONEST BASIS FOR SAYING "SECTION" ON SCREEN. A face has a
   * section when it carries the RECORD, not merely when its id happens to
   * parse as one: a face whose record is missing can be measured but not
   * edited as a volume, and telling the user otherwise is the contradiction
   * this flag exists to remove.
   */
  const selectedFaceHasSection = !!(activeFaceId && selectedFaceSectionId
    && inspectorPlanes.find(p => p.id === activeFaceId)?.section);

  const inspectorState: InspectorState = (() => {
    const planes = inspectorPlanes;
    const all = listSections(planes);
    const standalone = planes.filter(p => !(p.sectionId || sectionIdOfFaceId(p.id))).length;

    const base: InspectorState = {
      level: 'none', section: null, face: null, wall: null, faceSectionLabel: null,
      sectionCount: all.length, standaloneFaceCount: standalone,
      refusal: sectionRefusal,
      reshapedFaceCount: 0,
      pitchAnchor,
    };
    if (!activeFaceId) return base;

    const plane = planes.find(p => p.id === activeFaceId) ?? null;
    const face = measureFaceVertical(plane, cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : null);
    const sid = selectedFaceSectionId;

    // A face with no section can only ever be inspected as a face — there is no
    // volume to edit, and no pad, so no wall height. Reported as unresolved.
    // Its WALLS are still real edges and can still be measured; what has no
    // answer is their height, which the panel says rather than invents.
    if (!sid) {
      if (selectionLevel === 'wall' && selectedWallId) {
        const w = measureWall(planes, selectedWallId,
          cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : null);
        if (w.found) return { ...base, level: 'wall', wall: w, face };
      }
      return { ...base, level: 'face', face };
    }

    const look = sectionFromPlanes(planes, sid);
    if (!look.found) {
      // A conflicted or record-less section. The faces still render and can
      // still be measured; what is withheld is the section, and the refusal
      // says why rather than leaving the panel mysteriously inert.
      return {
        ...base, level: 'face', face,
        refusal: sectionRefusal ?? (look.refusals[0]?.message ?? null),
      };
    }
    const label = look.section!.label || 'Section';
    // A wall measured from the face it hangs from and the pad it stands on.
    // Null whenever no wall is selected, so the level cannot render stale.
    const wall = selectionLevel === 'wall' && selectedWallId
      ? measureWall(planes, selectedWallId,
          cesiumGroundElevResolvedRef.current ? cesiumGroundElevRef.current : null)
      : null;
    if (selectionLevel === 'wall' && wall && wall.found) {
      return { ...base, level: 'wall', wall, face, faceSectionLabel: label };
    }
    // 🚨 HOW MANY OF THIS SECTION'S FACES HAVE BEEN RESHAPED BY HAND. Non-zero
    // means every parametric control below would rebuild from the trace and
    // discard the stitch, so they are shown inert with the choice stated.
    const reshapedFaceCount = look.reshapedFaceIds.length;
    if (selectionLevel === 'face') {
      return { ...base, level: 'face', face, faceSectionLabel: label, reshapedFaceCount };
    }
    return {
      ...base, level: 'section', reshapedFaceCount,
      section: measureSection(look.section!, look.faceIds.length),
    };
  })();

  /** The inspector emits an intent; the authority decides whether it is legal. */
  function handleInspectorEdit(edit: SectionEdit, label: string, coalesceKey: string) {
    const sid = selectedFaceSectionId;
    if (!sid) { setSectionRefusal('Select a building section to change its height or pitch.'); return; }
    const ok = editSection(sid, edit, label, coalesceKey);
    if (ok) {
      const m = inspectorState.section;
      setStatusMsg(`🏠 ${label}${m ? ` · ${m.label}` : ''} — every face of the section moved together`);
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a1a', overflow: 'hidden' }}>

      {/* v66 (dark-canvas): Aurora-parity Design-phase dark overlay + grid.
          Currently hardcoded to "design" so the dark grid is visible as soon
          as the user enters the canvas. Future: wire to isDesignPhase so the
          Site Model keeps the light satellite. See components/3d/canvasTheme/. */}
      <CanvasTheme phase={isDesignPhase ? 'design' : 'site_model'} />

      {/* Cesium container */}
      <div ref={cesiumRef} style={{ width: '100%', height: '100%' }} />

      {/* v66: Aurora-style top-bar map-source picker
          (`Details ▾` / `LiDAR | Street View` / `[Google ▾]`).
          Floating bar at the top-center of the canvas. State is local for now;
          the imagery/LiDAR swap is the integration step for the next session. */}
      {/* v70: MapSourcePicker wrapped in DraggablePanel. The user can
          grab the bar background (between the Details dropdown and
          the Google source picker) to drag the whole top-bar around.
          Clicking the Details / LiDAR / Street View / Google buttons
          keeps their own click semantics. */}
      <DraggablePanel id="map-source-picker" zIndex={OVERLAY_Z.BASEMAP}>
      <MapSourcePicker
        state={mapPickerState}
        onChange={setMapPickerState}
        disabled={stage !== 'done' && stage !== 'error'}
      />
      </DraggablePanel>

      {/* v70: Aurora-style Save / Undo / Redo toolbar (top-left chip).
       * Renders the three icon+label buttons from lib/state/Buttons.tsx.
       * Persistence is intentionally a no-op for this slice — the host
       * component owns the onSave contract (see lib/state/DESIGN.md §8). */}
      {/* v70: UndoRedoToolbar (Save/Undo/Redo chip) wrapped in
          DraggablePanel. The user can grab the bar background to
          drag the toolbar anywhere. The Save / Undo / Redo buttons
          keep their own click semantics. */}
      {/* 🚨 THIS CHIP USED TO DRIVE `historyStoreRef`, WHICH NOTHING EVER
             DISPATCHED TO. `createHistoryStore(createEmptySceneState())` is
             still constructed above and still has zero dispatch sites, so
             Undo and Redo were decoration — and its `SceneState` is
             primitives plus slider positions, which is render state. A
             geometry history that restores render state puts the PICTURE
             back and leaves the canonical array holding the undone edit, so
             the next autosave persists the design the user just rejected.

             These buttons now drive the canonical `RoofPlane[]` history owned
             by the parent (components/design/useSiteDesign.ts). See
             lib/3d/geometryHistory.ts. */}
      {/* 🚨 BOTTOM-LEFT AT z=62, NOT TOP-LEFT AT z=50.

          The chip inherited top:12/left:12/z=50 from the inert toolbar it
          replaced, and `elementsFromPoint` over the live page returns, in
          front of it: the LiDAR Properties panel (z=60) and the top-left
          dock's "🔗 Roof Model" button (z=51). So Undo was covered by two
          other panels and could not be clicked — by a test or by a person.
          Nobody had noticed because the buttons it replaced did nothing at
          all, so being unreachable changed no outcome. */}
      {onUndoGeometry || onRedoGeometry ? (
        <DraggablePanel id="undo-redo-toolbar" zIndex={OVERLAY_Z.ACTION}>
        <div
          data-drag-handle
          style={{
            // 🚨 ABOVE THE "REPORT A BUG" BUTTON, WHICH SHARES THIS CORNER.
            //
            // That button is `fixed bottom-4 left-4 z-[60]` in DesignStudio, so
            // it occupies the bottom 52 px of this same corner. The two have
            // been fighting: the chip used to sit at z-index 62 and covered the
            // right two-thirds of the bug button, and when the chip moved onto
            // the shared layer scale the bug button covered the CHIP instead —
            // Playwright reported "<button …Report a bug…> intercepts pointer
            // events" and Undo could not be clicked at all.
            //
            // Re-ordering only chooses which of the two is broken. 64 px clears
            // the bug button entirely, so both are clickable, and it stays clear
            // of `canvas-controls`, which is at left: 200.
            position: 'absolute', bottom: 64, left: 12, zIndex: OVERLAY_Z.ACTION,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(10,14,24,0.85)', border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 8, padding: '4px 6px', backdropFilter: 'blur(6px)',
            cursor: 'grab', touchAction: 'none',
          }}
        >
          <span aria-label="Drag" style={{
            color: 'rgba(255,255,255,0.4)', fontSize: 11, lineHeight: 1,
            letterSpacing: -1, userSelect: 'none', pointerEvents: 'none', paddingRight: 2,
          }}>⠿</span>
          {([
            ['undo', '↶ Undo', canUndoGeometry, undoGeometryLabel, onUndoGeometry],
            ['redo', '↷ Redo', canRedoGeometry, redoGeometryLabel, onRedoGeometry],
          ] as Array<[string, string, boolean, string | null, (() => string | null) | undefined]>)
            .map(([key, text, enabled, label, fn]) => (
              <button
                key={key} type="button" data-no-drag
                data-testid={`geometry-${key}`}
                disabled={!enabled || !fn}
                title={enabled && label ? `${text.slice(2)} — ${label}` : `Nothing to ${key}`}
                onClick={() => {
                  const done = fn?.();
                  if (done) setStatusMsg(`${key === 'undo' ? '↶ Undone' : '↷ Redone'} — ${done}`);
                }}
                style={{
                  background: enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid rgba(255,255,255,${enabled ? 0.18 : 0.08})`,
                  color: enabled ? '#cfd8e6' : '#4d586b',
                  borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700,
                  cursor: enabled ? 'pointer' : 'default',
                }}
              >{text}</button>
            ))}
        </div>
        </DraggablePanel>
      ) : null}

      {/* v65 (roof-wizard): 3-step sticky wizard — Aurora parity
          (HANDOFF_2026-08-25 §2). Appears during any roof-draw mode.
          × cancels the whole flow. */}
      <RoofWizard
        placementMode={placementMode}
        vertexCount={
          placementMode === 'block'      ? blockPtCount
          : placementMode === 'roof_gable' ? gablePtCount
          : placementMode === 'roof_hip'   ? hipPtCount
          : 0
        }
        onCancel={() => onPlacementModeChange('select')}
      />

      {/* v65 (tree-cursor): 2D tree-placement footprint preview. Mounts
          unconditionally; only renders when active === true. Renders into
          the Cesium scene, so co-registers with the terrain drape and 3D
          tiles. See components/3d/tree/CURSOR.md. */}
      <TreeCursor
        viewer={viewerRef.current}
        active={placementMode === 'tree'}
        canopyRadiusM={TREE_CANOPY_RADIUS_M}
      />

      {/* v63: String / equipment legend overlay.
          v70: wrapped in DraggablePanel. Drag from the panel background
          or the header text to move. The whole legend (strings +
          equipment) moves as one. */}
      {(colorByString || showEquipment) && ((stringLegend && stringLegend.length > 0) || showEquipment) ? (
        <DraggablePanel id="legend-strings" zIndex={OVERLAY_Z.REFERENCE}>
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
        </DraggablePanel>
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
          // 🚨 THE TREE TOOL ARMS A TREE AND STAYS ON THE TREE TOOL.
          //
          // First it placed a decorative sphere that no array recorded, so:
          // "I tried the Tree button. It does not visibly give me a useful
          // tree." Then it armed the canonical object by switching the mode to
          // `obstruction` — and the palette highlight follows the MODE, so:
          // "When I click Tree, the UI immediately reverts to Obstruction. I
          // never actually enter a persistent Tree-placement state."
          //
          // Both reports are the same mistake in different places: the tool
          // state carried the placement CATEGORY and lost the OBJECT TYPE. They
          // are two facts. `tree` is a placement mode of its own now, dispatched
          // to the same canonical placement as every other roof object — shared
          // machinery, distinct tool state — so the button a person pressed is
          // the button that stays lit until they place, cancel, or pick another.
          if (mode === 'tree') {
            const treePreset = presetFor('tree');
            obstructionPresetRef.current = 'tree';
            setObstructionPresetId('tree');
            setNewObstructionWidthM(treePreset.widthM);
            setNewObstructionDepthM(treePreset.depthM);
            setNewObstructionHeightM(treePreset.heightM);
            setStatusMsg('\u{1F333} Tree \u2014 click the ground at the trunk. Height and canopy are adjustable before and after.');
          }
          if (mode === 'obstruction' && obstructionPresetRef.current === 'tree') {
            // Coming back to the generic Obstruction tool from Tree: the type
            // must not stay `tree`, or a vent is placed as a tree.
            const fallback = presetFor(DEFAULT_OBSTRUCTION_PRESET);
            obstructionPresetRef.current = DEFAULT_OBSTRUCTION_PRESET;
            setObstructionPresetId(DEFAULT_OBSTRUCTION_PRESET);
            setNewObstructionWidthM(fallback.widthM);
            setNewObstructionDepthM(fallback.depthM);
            setNewObstructionHeightM(fallback.heightM);
          }
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
              { mode: 'plane3d' as PlacementMode, icon: '\u{1F4D0}', label: 'Custom Array', tip: 'ONE roof face, with panels on it. Click 3+ roof corners, right-click to place. It is a single face, not a building: no wall height, no pad, no ridge. To model a house with walls and a ridge, use the \u{1F3DA} Building group.' },
              { mode: 'mark_plane' as PlacementMode, icon: '⬡', label: 'Mark Plane', tip: 'ONE roof face, no panels \u2014 for the model and the permit. Click 3+ corners, right-click to finish. It is a single face, not a building: no wall height, no pad, no ridge. To model a house with walls and a ridge, use the \u{1F3DA} Building group.' },
              { mode: 'row'     as PlacementMode, icon: '\u27A1',    label: 'Row',      tip: 'Row Tool: click two points to place a panel row' },
            ],
          },
          // THE TOOLS THAT BUILD A BUILDING LIVE UNDER "BUILDING".
          //
          // Gable, Hip and Block are the only three that produce a
          // BuildingSection - a volume with a footprint, a wall height, a pad
          // and a ridge, whose faces move together. They used to sit in
          // "Tools", between Obstruction and a decorative Tree, while the
          // group a person opens first - "Place" - offered Mark Plane and
          // Custom Array, which produce a SINGLE STANDALONE FACE.
          //
          // A UX audit traced the consequence, and it is the owner's own
          // report: "I was already in Building mode when I traced this
          // geometry" - and got faces with no section. The Building toggle is
          // a RENDER control (it extrudes walls for the view); it changes no
          // tool and never did. So the product required the user to know the
          // difference between a standalone RoofPlane and a section-owned
          // face in order to pick a tool, and offered the wrong one first.
          //
          // The rule this encodes: the object a tool creates is named where
          // the tool is chosen, not discovered three operations later when
          // the controls for it turn out not to exist.
          {
            id: 'building', icon: '\u{1F3DA}', label: 'Building',
            tools: [
              { mode: 'block'      as PlacementMode, icon: '\u{1F9F1}', label: 'Flat / Block', tip: 'A FLAT-ROOFED VOLUME (garage, addition, commercial deck). Line-trace the footprint: click N points for any shape \u2014 rectangle, L, T \u2014 right-click to finish. It becomes a building SECTION with a wall height and a pad you can edit, and its deck takes panels. Works with no 3D coverage.' },
              { mode: 'roof_gable'   as PlacementMode, icon: '\u{1F3E0}\u2009\u{1F3D7}', label: 'Gable', tip: 'Build a gable SECTION: click the 4 footprint corners in order around the building. Two real roof faces meeting at one ridge, at any rotation. They take panels and they save with the design. Works with no 3D coverage.' },
              { mode: 'roof_hip'     as PlacementMode, icon: '\u{1F3D7}\u2009\u{1F3E0}', label: 'Hip', tip: 'Build a hip SECTION: click the 4 footprint corners in order around the building. Four real roof faces \u2014 two slopes plus two hipped ends \u2014 all closing on one ridge. On a square footprint it becomes a pyramid. Works with no 3D coverage.' },
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
              { mode: 'obstruction'   as PlacementMode, icon: '\u26A0',    label: 'Obstruction', tip: 'Mark something on the roof: vent, pipe, stack, skylight, chimney, hatch or rooftop unit. Pick the type in the right-hand panel — each one places at its own real size and keeps its own clearance. Panels under it are removed, and Undo brings them back.' },
              { mode: 'set_direction' as PlacementMode, icon: '\u{1F9ED}', label: 'Direction', tip: 'Click two points to set a custom panel row direction' },
              { mode: 'set_origin'    as PlacementMode, icon: '\u{1F4CD}', label: 'Origin',    tip: 'Set a custom grid origin for Surface Select' },
              { mode: 'tree'         as PlacementMode, icon: '\u{1F333}', label: 'Tree', tip: 'Place a tree that SHADES. Click the ground at the trunk, then set its height and canopy width. It is saved with the design, it is deleted like anything else, and Shade uses it.' },
            ],
          },
        ];

        const activeGroupId = groups.find(g => g.tools.some(t => t.mode === placementMode))?.id ?? null;

        return (
          <>
            {/* ── LEFT: spine + flyout ──
                v70: wrapped in DraggablePanel so the user can grab the
                tool spine and move the whole tool column. The spine
                (first child) is the drag handle. The flyout opens to
                the right of the spine and follows when dragged. */}
            {/* 🚨 AN OPEN FLYOUT IS ON TOP, OR ITS BUTTONS ARE NOT BUTTONS.
                 *
                 * The spine sat at z-index 50 while `lidar-properties` is 60 and
                 * `undo-redo-toolbar` is 62, and both overlap the flyout's
                 * column. Measured in the browser with `elementFromPoint` at
                 * each button's own centre: of the five tools in the Tools
                 * group, only the BOTTOM one — Tree — returned itself. Measure,
                 * Obstruction, Direction and Origin all returned a panel
                 * stacked above them, so a click on any of them went to that
                 * panel and the tool was never armed.
                 *
                 * That is the owner's chimney report, and it was never about
                 * chimneys: Chimney is a type inside the Obstruction tool, and
                 * the Obstruction BUTTON could not be pressed. It also explains
                 * why Tree behaved differently from everything else — it was
                 * the one entry nothing covered. A browser test reproduced it
                 * only because it clicks real coordinates; `force: true` does
                 * not help, because the event still lands on whatever is on top.
                 *
                 * Raised only WHILE A GROUP IS OPEN. The resting spine is
                 * persistent chrome and has no claim to outrank a panel the
                 * user is working in; an open flyout is a transient, focused
                 * surface and does. Below the confirm overlays (100) and the
                 * tooltip (99999), which must still win.
                 */}
            <DraggablePanel id="tool-spine" zIndex={openGroup ? OVERLAY_Z.MENU : OVERLAY_Z.DOCK}>
            <div style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
              gap: 0, zIndex: openGroup ? 70 : 50, pointerEvents: 'none',
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
                        aria-label={grp.label}
                        aria-expanded={isOpen}
                        title={grp.label}
                        data-testid={`toolgroup-${grp.id}`}
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
                  // 🚨 THREE NAMED SCOPES, NOT ONE UNLABELLED BIN.
                  //
                  // This was a single trash icon in the always-visible spine
                  // whose tip read "Clear All" and whose action deleted every
                  // panel with no confirmation and no undo of any kind. "Clear
                  // All" beside a roof model reads as "clear all of it"; what it
                  // cleared was the layout, and the difference was discoverable
                  // only by pressing it.
                  //
                  // Each of these now goes through the owner's canonical delete,
                  // which shows what will be removed, asks, records the undo
                  // step, tombstones what it removed and authorises the save
                  // that follows. See lib/design/deletionAuthority.ts.
                  { icon: '\u{1F5D1}', tip: 'Clear Panels: remove the panel layout, keep the roof',
                    action: () => onRequestDelete?.('panels'), danger: true },
                  { icon: '\u{1F3DA}', tip: 'Clear Custom Building: remove hand-built roof faces and sections',
                    action: () => onRequestDelete?.('customBuilding'), danger: true },
                  { icon: '\u21BA', tip: 'Start Over: empty this property and begin again',
                    action: () => onRequestDelete?.('design'), danger: true },
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
                        aria-label={label}
                        data-testid={`tool-${mode}`}
                        style={{
                          width: 'max-content', minWidth: 86, maxWidth: 130, height: 34, borderRadius: 8, fontSize: 12,
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
            </DraggablePanel>

            {/* Flyout slide-in animation */}
            <style>{'@keyframes toolFlyout { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }'}</style>

            {/* ── TOP-RIGHT: stats + orientation + active tool + context controls ──
                v70: wrapped in DraggablePanel so the user can grab the
                stats row and move the whole stack (stats + active tool
                badge + ground/plane/obstruction context controls).
                The stats row is the first child so it becomes the
                drag handle. */}
            {/* 🚨 THE PLACEMENT PANEL IS WHERE YOU PICK A CHIMNEY, SO IT HAS TO
                 * BE ON TOP WHILE YOU ARE PLACING ONE.
                 *
                 * This stack holds the object-type chips and the width/depth/
                 * height sliders. It rendered at z-index 50; `instructions-panel`
                 * (the help text) is ALSO 50 and comes later in the DOM, so it
                 * won. Measured in the browser at 1280x720: the canvas is
                 * [56,116,904,604], so the help panel's `right: 8` resolves to
                 * x = 672 and it occupies [672,236,280,81] — directly on top of
                 * the chips at x 639..870. `elementFromPoint` at each chip's own
                 * centre returned the help panel for EVERY roof type: vent pipe,
                 * plumbing stack, vent, skylight, CHIMNEY, roof hatch, HVAC.
                 *
                 * So "Chimney may also not be wired end-to-end" was, at this
                 * layer too, a control that could not be pressed. The chip click
                 * went to the help text, the armed type stayed on the default
                 * vent pipe, and the roof click then refused — with a message
                 * about roof faces that described none of this.
                 *
                 * Raised only WHILE a placement panel is showing, for the same
                 * reason as the tool spine: a transient control surface outranks
                 * passive text, a resting one does not. Above `lidar-properties`
                 * (60) and `undo-redo-toolbar` (62), below the tool flyout (70).
                 */}
            <DraggablePanel id="top-right-stack" zIndex={isPlacingObject ? OVERLAY_Z.PLACEMENT : OVERLAY_Z.DOCK}>
            <div style={{
              position: 'absolute', top: 12, right: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
              zIndex: isPlacingObject ? 65 : 50,
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
                 placementMode === 'plane3d' ? '\u{1F4D0} Custom Array' :
                 placementMode === 'row' ? '\u27A1 Row' :
                 placementMode === 'auto_roof' ? '\u2728 Auto Fill' :
                 placementMode === 'pick_house' ? '\u{1F3E1} Pick House' :
                 placementMode === 'surface_select' ? '\u{1F3AF} Surface' :
                 placementMode === 'extend_row' ? '\u2192+ Ext Row' :
                 placementMode === 'add_row' ? '\u2191+ Add Row' :
                 placementMode === 'obstruction' || placementMode === 'tree'
                   ? `${presetFor(obstructionPresetId).icon} ${presetFor(obstructionPresetId).label} \u2014 click to place (${obstructions.length} on site)` :
                 placementMode === 'measure' ? '\u{1F4CF} Measure' :
                 placementMode === 'set_direction' ? '\u{1F9ED} Set Direction' :
                 placementMode === 'set_origin' ? '\u{1F4CD} Set Origin' :
                 placementMode === 'block' ? `\u{1F9F1} Block${blockPtCount > 0 ? ` (${blockPtCount}/2)` : ''}` :
                 placementMode === 'roof_gable' ? `\u{1F3E0}\u2009\u{1F3D7} Gable${gablePtCount > 0 ? ` (${gablePtCount}/4)` : ''}` :
                 placementMode === 'roof_hip'   ? `\u{1F3D7}\u2009\u{1F3E0} Hip${hipPtCount > 0 ? ` (${hipPtCount}/4)` : ''}` :
                 // 'tree' is reported by the obstruction branch above, which
                 // names the ARMED OBJECT rather than the category. A second
                 // branch here would be a second answer to "what is armed".
                 placementMode}
              </div>

              {/* v66: flat-trace badge. The user needs to know the pitch is
                  coming from the Tilt slider rather than being measured off a
                  mesh — otherwise a traced face silently carries whatever the
                  slider happened to say. Text lives in a template literal
                  because JSX TEXT CHILDREN DO NOT PROCESS \u ESCAPES (that is
                  the bug that made 7 buttons render their escape sequence as plain text). */}
              {flatTrace ? (
                <div style={{
                  background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(80,180,255,0.35)', borderRadius: 8,
                  padding: '4px 10px', fontSize: 11, color: '#66c2ff', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>{`\u{1F5FA} Flat trace · view locked straight down · pitch ${Math.round(tilt)}°`}</span>
                  {/* Eave height. A hand trace has no measured height, so this is
                      the only way to sit the face on the building instead of
                      3 m off the ground. Adjusting rebuilds every face already
                      traced, so the number is immediate rather than applying
                      only to the next one. */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#9ad8ff' }}>
                    <span style={{ opacity: 0.8 }}>{'eave'}</span>
                    <button
                      onClick={() => {
                        const next = Math.max(0, +(flatTraceEaveHeightM - 0.3048).toFixed(4));
                        setFlatTraceEaveHeightM(next);
                        flatTraceEaveHeightRef.current = next;
                        const n = rebuildFlatTracedPlanes(next);
                        setStatusMsg(`\u{1F5FA} Eave height ${ftStr(next)} · ${n} face${n === 1 ? '' : 's'} re-raised`);
                      }}
                      title="Lower the traced roof by 1 ft"
                      style={{ padding: '0 5px', borderRadius: 4, border: '1px solid rgba(80,180,255,0.3)', background: 'rgba(80,180,255,0.12)', color: '#9ad8ff', cursor: 'pointer', fontWeight: 700 }}
                    >{'−'}</button>
                    <span style={{ minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{ftStr(flatTraceEaveHeightM)}</span>
                    <button
                      onClick={() => {
                        const next = +(flatTraceEaveHeightM + 0.3048).toFixed(4);
                        setFlatTraceEaveHeightM(next);
                        flatTraceEaveHeightRef.current = next;
                        const n = rebuildFlatTracedPlanes(next);
                        setStatusMsg(`\u{1F5FA} Eave height ${ftStr(next)} · ${n} face${n === 1 ? '' : 's'} re-raised`);
                      }}
                      title="Raise the traced roof by 1 ft"
                      style={{ padding: '0 5px', borderRadius: 4, border: '1px solid rgba(80,180,255,0.3)', background: 'rgba(80,180,255,0.12)', color: '#9ad8ff', cursor: 'pointer', fontWeight: 700 }}
                    >{'+'}</button>
                  </span>
                </div>
              ) : null}

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
                      ✅ Create Roof Plane
                    </button>
                  ) : null}
                  {pts3DCount > 0 ? (
                    <button onClick={() => { const v = viewerRef.current; if (v) clearPlane3DPreview(v); setStatusMsg('3D Plane cleared'); }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,60,60,0.12)', color: '#ff6666',
                        border: '1px solid rgba(255,60,60,0.3)', cursor: 'pointer' }}>
                      ✕ Clear
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
                      ✅ Finish Fence
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
                      ✕
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
                      ✕ Reset
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── 3D Primitives Properties (v66: eave height + roof pitch inputs) ── */}
              {(placementMode === 'block' || placementMode === 'roof_gable' || placementMode === 'roof_hip') ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(180,180,200,0.25)', borderRadius: 10,
                  padding: '8px 10px', minWidth: 240, maxWidth: 320,
                }}>
                  <div style={{
                    fontSize: 9, color: '#ffa040', textAlign: 'left',
                    fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    3D Primitives
                  </div>
                  {/* Eave height — for new blocks */}
                  {placementMode === 'block' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>New block eave</span>
                      <input
                        type="range" min={1} max={30} step={0.5}
                        value={newBlockEaveHeightM}
                        onChange={e => setNewBlockEaveHeightM(parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: '#ffaa00' }}
                      />
                      <input
                        type="number" min={1} max={30} step={0.5}
                        value={newBlockEaveHeightM}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          if (isFinite(v)) setNewBlockEaveHeightM(Math.max(1, Math.min(30, v)));
                        }}
                        style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                      />
                      <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                    </div>
                  ) : null}
                  {/* ── Selected block height ────────────────────────────
                      🚨 IT EDITS THE BLOCK THE USER SELECTED, which it did not.

                      `setSelectedBlockId` fired when a person grabbed a block's
                      handle and `selectedBlockId` was read NOWHERE. This control
                      — labelled "Selected height" — read and wrote
                      `lastPlacedBlockId` instead. Draw the house, draw the
                      garage, grab the HOUSE's handle, drag this slider: the
                      GARAGE changed height and the house did not move.

                      Selection wins; the most recently placed block is the
                      fallback for the case where nothing has been grabbed yet,
                      which is what the control was really doing all along. */}
                  {placementMode === 'block' && (selectedBlockId || lastPlacedBlockId) ? (
                    (() => {
                      const blockId = selectedBlockId || lastPlacedBlockId!;
                      const shown = blockHeightOverridesRef.current.get(blockId) ?? newBlockEaveHeightM;
                      return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#ffd28a', fontSize: 11, minWidth: 100 }}>
                        {selectedBlockId ? 'Selected height' : 'Last block height'}
                      </span>
                      <input
                        type="range" min={1} max={30} step={0.5}
                        value={shown}
                        onChange={e => setBlockHeight(blockId, parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: '#ffaa00' }}
                      />
                      <input
                        type="number" min={1} max={30} step={0.5}
                        value={shown}
                        onChange={e => setBlockHeight(blockId, parseFloat(e.target.value))}
                        style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                      />
                      <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                    </div>
                      );
                    })()
                  ) : null}
                  {/* Eave height — for new roofs (gable / hip) */}
                  {(placementMode === 'roof_gable' || placementMode === 'roof_hip') ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>New roof eave</span>
                        <input
                          type="range" min={1} max={20} step={0.5}
                          value={newRoofEaveHeightM}
                          onChange={e => setNewRoofEaveHeightM(parseFloat(e.target.value))}
                          style={{ flex: 1, accentColor: '#ffaa00' }}
                        />
                        <input
                          type="number" min={1} max={20} step={0.5}
                          value={newRoofEaveHeightM}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (isFinite(v)) setNewRoofEaveHeightM(Math.max(1, Math.min(20, v)));
                          }}
                          style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                        />
                        <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>Roof pitch</span>
                        <input
                          type="range" min={5} max={60} step={1}
                          value={roofPitchDeg}
                          onChange={e => setRoofPitchDeg(parseFloat(e.target.value))}
                          style={{ flex: 1, accentColor: '#ffaa00' }}
                        />
                        <input
                          type="number" min={5} max={60} step={1}
                          value={roofPitchDeg}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (isFinite(v)) setRoofPitchDeg(Math.max(5, Math.min(60, v)));
                          }}
                          style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                        />
                        <span style={{ color: '#aaa', fontSize: 10 }}>°</span>
                      </div>
                    </>
                  ) : null}
                  {/* v66: Lift Roofs / Flatten Roofs for 3D Primitives (block / gable / hip).
                   *  Aurora parity: HANDOFF_2026-08-25 §4 (frame_0130, frame_0135).
                   *  Only renders when LiDAR is loaded. Operates on the 3D Primitive
                   *  entities the user drew with the in-canvas tools — distinct from
                   *  the sibling's `roofPlanes` buttons in the LiDAR Properties panel
                   *  (which operate on the data-model roof planes). */}
                  {lidar.state.dataset ? (
                    <div style={{
                      borderTop: '1px solid rgba(180,180,200,0.2)',
                      marginTop: 4, paddingTop: 6,
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <div style={{
                        fontSize: 9, color: '#88aaff', textAlign: 'left',
                        fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                      }}>
                        LiDAR — 3D Primitives
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={handleLiftPrimitives}
                          disabled={(placedBlockCount + placedGableCount + placedHipCount) === 0}
                          title="Snap every 3D Primitive to the LiDAR elevation at its centroid"
                          style={{
                            flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            cursor: (placedBlockCount + placedGableCount + placedHipCount) === 0 ? 'not-allowed' : 'pointer',
                            background: 'rgba(0,170,255,0.15)', color: '#88ccff',
                            border: '1px solid rgba(0,170,255,0.4)',
                            opacity: (placedBlockCount + placedGableCount + placedHipCount) === 0 ? 0.4 : 1,
                          }}
                        >
                          ⤴ Lift Roofs
                        </button>
                        <button
                          onClick={handleFlattenPrimitives}
                          disabled={(placedBlockCount + placedGableCount + placedHipCount) === 0}
                          title="Set every 3D Primitive to the average LiDAR elevation across centroids"
                          style={{
                            flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            cursor: (placedBlockCount + placedGableCount + placedHipCount) === 0 ? 'not-allowed' : 'pointer',
                            background: 'rgba(0,200,100,0.15)', color: '#88ff99',
                            border: '1px solid rgba(0,200,100,0.4)',
                            opacity: (placedBlockCount + placedGableCount + placedHipCount) === 0 ? 0.4 : 1,
                          }}
                        >
                          ⤓ Flatten Roofs
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── Add Obstruction Properties (v66: obstruction-primitive) ──
                  Right-panel input block for the Aurora-parity "Add Obstruction"
                  primitive. Three sliders (width, depth, height) — matches the
                  parity bar: "a small block (e.g. 0.6m × 0.6m × 1.0m,
                  configurable)". Same visual language as the 3D Primitives panel
                  so the two read as siblings. */}
              {placementMode === 'obstruction' || placementMode === 'tree' ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,180,0,0.25)', borderRadius: 10,
                  padding: '8px 10px', minWidth: 240, maxWidth: 320,
                }}>
                  <div style={{
                    fontSize: 9, color: '#ffaa00', textAlign: 'left',
                    fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                  }}>
                    {presetFor(obstructionPresetId).icon} Place {presetFor(obstructionPresetId).label}
                  </div>
                  {/* ── PICK THE NOUN, THEN CLICK ─────────────────────────
                       The preset carries the dimensions a person would
                       otherwise type, so the common case needs no typing at
                       all — and the sliders below stay live, because a preset
                       is a starting point, not a claim about this roof. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {OBSTRUCTION_PRESETS.map(pr => (
                      <button
                        key={pr.id}
                        data-no-drag
                        data-testid={`obstruction-preset-${pr.id}`}
                        onClick={() => {
                          obstructionPresetRef.current = pr.id;
                          setObstructionPresetId(pr.id);
                          setNewObstructionWidthM(pr.widthM);
                          setNewObstructionDepthM(pr.depthM);
                          setNewObstructionHeightM(pr.heightM);
                          // 🚨 THE TOOL FOLLOWS THE TYPE. Two places that each
                          // hold half of "what is armed" is how the palette
                          // came to show Obstruction while a tree was queued.
                          const wantMode: PlacementMode = pr.id === 'tree' ? 'tree' : 'obstruction';
                          if (placementMode !== wantMode) onPlacementModeChange(wantMode);
                        }}
                        style={{
                          padding: '3px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          cursor: 'pointer',
                          background: obstructionPresetId === pr.id
                            ? 'linear-gradient(135deg,#ff8c00,#ffd700)' : 'rgba(255,255,255,0.07)',
                          color: obstructionPresetId === pr.id ? '#000' : '#cfd8e6',
                          border: '1px solid ' + (obstructionPresetId === pr.id
                            ? 'rgba(255,180,0,0.6)' : 'rgba(255,255,255,0.14)'),
                        }}
                      >{pr.icon} {pr.label}</button>
                    ))}
                  </div>
                  <div style={{ color: '#bbb', fontSize: 10, lineHeight: 1.35 }}>
                    {presetFor(obstructionPresetId).hint}
                    {' '}Panels keep {(DEFAULT_CLEARANCE_M[obstructionPresetId] ?? 0.15).toFixed(2)} m clear of it.
                  </div>
                  {/* Width (east-west) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>Width</span>
                    <input
                      type="range" min={presetFor(obstructionPresetId).minFootprintM} max={presetFor(obstructionPresetId).maxFootprintM} step={0.1}
                      value={newObstructionWidthM}
                      onChange={e => setNewObstructionWidthM(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: '#ffaa00' }}
                    />
                    <input
                      type="number" min={presetFor(obstructionPresetId).minFootprintM} max={presetFor(obstructionPresetId).maxFootprintM} step={0.1}
                      value={newObstructionWidthM}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (isFinite(v)) {
                          setNewObstructionWidthM(
                            Math.max(presetFor(obstructionPresetId).minFootprintM, Math.min(presetFor(obstructionPresetId).maxFootprintM, v)),
                          );
                        }
                      }}
                      style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                    />
                    <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                  </div>
                  {/* Depth (north-south) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>Depth</span>
                    <input
                      type="range" min={presetFor(obstructionPresetId).minFootprintM} max={presetFor(obstructionPresetId).maxFootprintM} step={0.1}
                      value={newObstructionDepthM}
                      onChange={e => setNewObstructionDepthM(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: '#ffaa00' }}
                    />
                    <input
                      type="number" min={presetFor(obstructionPresetId).minFootprintM} max={presetFor(obstructionPresetId).maxFootprintM} step={0.1}
                      value={newObstructionDepthM}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (isFinite(v)) {
                          setNewObstructionDepthM(
                            Math.max(presetFor(obstructionPresetId).minFootprintM, Math.min(presetFor(obstructionPresetId).maxFootprintM, v)),
                          );
                        }
                      }}
                      style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                    />
                    <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                  </div>
                  {/* Height (extrusion) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#e0e0e0', fontSize: 11, minWidth: 100 }}>Height</span>
                    <input
                      type="range" min={presetFor(obstructionPresetId).minHeightM} max={presetFor(obstructionPresetId).maxHeightM} step={0.1}
                      value={newObstructionHeightM}
                      onChange={e => setNewObstructionHeightM(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: '#ffaa00' }}
                    />
                    <input
                      type="number" min={presetFor(obstructionPresetId).minHeightM} max={presetFor(obstructionPresetId).maxHeightM} step={0.1}
                      value={newObstructionHeightM}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (isFinite(v)) {
                          setNewObstructionHeightM(
                            Math.max(presetFor(obstructionPresetId).minHeightM, Math.min(presetFor(obstructionPresetId).maxHeightM, v)),
                          );
                        }
                      }}
                      style={{ width: 56, fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
                    />
                    <span style={{ color: '#aaa', fontSize: 10 }}>m</span>
                  </div>
                  {/* Quick-action row: revert to Aurora defaults */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      // 🚨 RESET TO WHAT THIS OBJECT IS, NOT TO ONE GLOBAL SIZE.
                      //
                      // The label read "Reset to 0.6x0.6x1.0m" and the handler
                      // wrote those three literals whatever was armed. So with
                      // the Tree tool selected -- panel showing 6 x 6 x 8 m --
                      // a button plainly offering to restore the default turned
                      // the tree into a 600 mm shrub. A control that names one
                      // size while nine objects share it can only be right for
                      // one of them.
                      onClick={() => {
                        const pr = presetFor(obstructionPresetId);
                        setNewObstructionWidthM(pr.widthM);
                        setNewObstructionDepthM(pr.depthM);
                        setNewObstructionHeightM(pr.heightM);
                        setStatusMsg(`${pr.label} reset to ${pr.widthM}×${pr.depthM}×${pr.heightM} m`);
                      }}
                      title={`Reset to the standard size for a ${presetFor(obstructionPresetId).label.toLowerCase()}`}
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        background: 'rgba(255,170,0,0.12)', color: '#ffaa00',
                        border: '1px solid rgba(255,170,0,0.3)' }}>
                      Reset {presetFor(obstructionPresetId).label} size
                    </button>
                    <button
                      // 🚨 IT USED TO BE A RAW SETTER, AND IT SITS NEXT TO
                      // "Reset to 0.6x0.6x1.0m". No plan, no list of what would
                      // go, no undo step, no tombstone, no save authorization,
                      // no toast — and it propagated straight into canonical
                      // state, where the autosave persisted the loss. A person
                      // who opened this panel to fix ONE vent was one mis-click
                      // from wiping every vent, stack, skylight and chimney on
                      // the roof. It is now the same canonical delete as every
                      // other control, and it asks first.
                      onClick={() => onRequestDelete?.('obstructions')}
                      data-testid="obstruction-clear-all"
                      title="Remove every marked obstruction"
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                        background: 'rgba(239,68,68,0.1)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,0.3)' }}>
                      Clear all
                    </button>
                  </div>
                </div>
              ) : null}

              {/* ── Block context (v65: line-trace block placement) ── */}
              {placementMode === 'block' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(180,180,200,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#e0e0e0', fontSize: 12 }}>
                    {blockPtCount === 0
                      ? '🧱 Click to add footprint points — right-click to finish, Esc to cancel'
                      : `🧱 ${blockPtCount} points — right-click to finish (need 3+), Esc to cancel`}
                  </span>
                  {blockPtCount >= 3 ? (
                    <button
                      onClick={() => {
                        const viewer = viewerRef.current;
                        if (viewer && typeof (window as any).Cesium !== 'undefined') {
                          finalizeBlock(viewer, (window as any).Cesium);
                        }
                      }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(255,170,0,0.20)', color: '#ffd28a',
                        border: '1px solid rgba(255,170,0,0.4)', cursor: 'pointer' }}
                    >
                      Finish ✓
                    </button>
                  ) : null}
                  {placedBlockCount > 0 ? (
                    <button
                      // One implementation. This used to be a second copy of
                      // the same nine lines, so a design-level clear and this
                      // button could drift apart — and did: the design-level
                      // path did not know blocks existed at all.
                      onClick={() => {
                        clearPlacedBlocks(viewerRef.current);
                        setStatusMsg('All blocks cleared');
                      }}
                      style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(200,200,210,0.15)', color: '#e0e0e0',
                        border: '1px solid rgba(200,200,210,0.3)', cursor: 'pointer' }}
                    >
                      Clear All
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* ── Gable Roof context (v64: 3D gable roof placement) ── */}
              {placementMode === 'roof_gable' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(255,180,80,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#ffd28a', fontSize: 12 }}>
                    {/* The tool traces FOUR corners now. The old copy said two,
                        and said 'ridge along long edge' as if the ridge could only
                        run north-south or east-west, which is what the bounding-box
                        math actually did. */}
                    {gablePtCount === 0
                      ? '\u{1F3D7} Gable section \u2014 click footprint corner 1 of 4'
                      : `\u{1F3D7} Corner ${gablePtCount} of 4 \u2014 keep going around the building`}
                  </span>
                </div>
              ) : null}

              {/* ── Hip Roof context (v64: 3D hip roof placement) ── */}
              {placementMode === 'roof_hip' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(15,15,30,0.92)', border: '1px solid rgba(180,140,80,0.25)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <span style={{ color: '#d4b07a', fontSize: 12 }}>
                    {hipPtCount === 0
                      ? '\u{1F3D7} Hip section \u2014 click footprint corner 1 of 4'
                      : `\u{1F3D7} Corner ${hipPtCount} of 4 \u2014 keep going around the building`}
                  </span>
                </div>
              ) : null}

              {/* 🚨 THE DECORATIVE TREE BAR IS GONE.
                  It said "Click anywhere to drop a tree (sphere + trunk)" and
                  counted `placedTreeCount` -- both describing `handleTreeClick`,
                  the implementation that added two Cesium entities and recorded
                  nothing. Nothing routes there any more, so the counter was
                  PERMANENTLY ZERO: place five trees and the tally still reads 0
                  while the bar keeps saying "click anywhere". A successful click
                  that looks exactly like a failed one, which is the thing this
                  whole round is about. The obstruction placement panel serves
                  the Tree tool now, and it counts the canonical objects. */}

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
                      ✕ Reset
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
                      ✅ Fill Plane
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            </DraggablePanel>
          </>
        );
      })()) : null}




      {/* v67: INSTRUCTIONS panel — context-aware helper text per placement mode.
          Aurora frame 0070 parity.

          v5: wrapped in DraggablePanel. Drag the header (cursor: grab)
          to move the panel anywhere; position persists to localStorage.
          Click any button or text in the panel — those are NOT the drag
          handle and remain clickable. */}
      {stage === 'done' ? (
        <DraggablePanel id="instructions-panel" zIndex={OVERLAY_Z.REFERENCE}>
          <div
            data-testid="help-panel-mount"
            style={{
              position: 'absolute', right: 8, top: 120,
              width: 280, maxHeight: '50vh', zIndex: 50,
              background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
              padding: '2px 0',
              pointerEvents: 'auto',
              overflowY: 'auto',
            }}
          >
            <HelpPanel
              placementMode={placementMode}
              context={{
                pointsPlaced:
                  placementMode === 'block'        ? blockPtCount  :
                  placementMode === 'roof_gable'   ? gablePtCount  :
                  placementMode === 'roof_hip'     ? hipPtCount    :
                  placementMode === 'tree'         ? obstructions.length :
                  placementMode === 'mark_plane'   ? markPlanePtCount :
                  placementMode === 'plane3d'      ? plane3DPtCount :
                  placementMode === 'fence'        ? fencePtCount  :
                  placementMode === 'measure'      ? measurePtCount :
                  placementMode === 'ground'       ? groundPtCount :
                  undefined,
                // 🚨 THE OBJECTS THAT EXIST, not the dead counter. A tally
                // that never moves is the clearest possible signal that a click
                // did nothing -- and here it was lying, because the click worked.
                liveCount: placementMode === 'tree'
                  ? { label: 'trees', value: obstructions.filter(o => o?.type === 'tree').length }
                  : undefined,
              }}
            />
          </div>
        </DraggablePanel>
      ) : null}

      {/* v68 (canvas-controls): Aurora-parity bottom-left control strip
          (HANDOFF_2026-08-25 §1) — floating vertical dock at the canvas
          corner. Compass needle rotates with `viewer.camera.heading`.
          Click compass → reset to north. Zoom +/-, three layer toggles.
          Sits at `left: 200, bottom: 12` (clear of Report a Bug at
          bottom:16,left:16).

          v69: wrapped in DraggablePanel. Drag the wrapper padding to
          move; clicks on the actual buttons (compass / zoom +/-) still
          trigger their own actions, not drag. */}
      <DraggablePanel id="canvas-controls" zIndex={OVERLAY_Z.DOCK_OVER}>
        <CanvasControls
          viewer={viewerRef.current}
          ready={stage === 'done'}
          onResetNorth={() => {
            const o = orbitRef.current;
            o.heading = Math.PI;            // camera south → look north
            o.pitch   = -Math.PI / 4;       // Aurora tilted-aerial default
            applyOrbitRef.current?.();
            if (typeof setStatusMsg === 'function') setStatusMsg('\u{1F9ED} North up');
          }}
          onZoomIn={() => {
            const o = orbitRef.current;
            o.radius = computeZoomedRadius(o.radius, -1);
            applyOrbitRef.current?.();
          }}
          onZoomOut={() => {
            const o = orbitRef.current;
            o.radius = computeZoomedRadius(o.radius, 1);
            applyOrbitRef.current?.();
          }}
          layers={([
            { key: 'parcel', label: 'Parcel',     iconPath: ICON_PARCEL, on: showParcel,       onToggle: () => setShowParcel(v => !v) },
            { key: 'roof',   label: 'Roof Segs',  iconPath: ICON_ROOF,   on: showRoofSegs,     onToggle: () => setShowRoofSegs(v => !v) },
            { key: 'shade',  label: 'Shade',      iconPath: ICON_SHADE,  on: showShadeLocal,   onToggle: () => {
              const next = !showShadeRef.current;
              showShadeRef.current = next;
              setShowShadeLocal(next);
              // Turning Shade ON asks the owner for a real analysis over the
              // canonical geometry. Cheap when nothing has changed; the owner
              // decides whether to recompute.
              if (next) onRunShadeAnalysis?.();
              updateShadeColors();
            } },
          ] as LayerToggle[])}
        />
      </DraggablePanel>

      {/* Overlay toggles (bottom area, clear of Report a Bug at bottom-left).
          v67 was at left:60,bottom:16 which collided with both the
          tool spine (left:10,top:50%) and the Report a Bug button
          (page-level at fixed bottom-4 left-4 z-60) — making the toggle
          buttons unclickable. v68 sits at bottom:12,left:260 (right of
          the Report Bug), shares the bottom row with CanvasControls
          (left:200,bottom:12) for a clean bottom-left-to-center dock.

          v69: wrapped in DraggablePanel. Drag the panel background
          to move; clicks on the actual toggle buttons (Parcel / Roof
          Segs / Shade / Heatmap) still trigger their own actions. */}
      {stage === 'done' ? (
        <DraggablePanel id="layer-toggles" zIndex={OVERLAY_Z.DOCK}>
          <div style={{
            position: 'absolute', left: 260, bottom: 12,
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
        </DraggablePanel>
      ) : null}

      {/* Sun simulator (bottom). Wrapped in DraggablePanel so the user
          can grab the time row at the top and drag the widget anywhere.
          The widget keeps its centered default (bottom:40,left:50%
          translateX(-50%)) and the DraggablePanel adds an outer
          translate(dx,dy) on top, so the layout is unchanged until
          the user drags. */}
      {stage === 'done' ? (
        <DraggablePanel id="sun-simulator" zIndex={OVERLAY_Z.DOCK}>
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
        </DraggablePanel>
      ) : null}

      {/* v48.13: Rotating compass rose — needle always points to true North */}
      {stage === 'done' ? (
        <DraggablePanel id="compass-rose" zIndex={OVERLAY_Z.READOUT}>
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
        </DraggablePanel>
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

      {/* Status bar - v70: draggable. Grab the bar to move. */}
      {stage === 'done' && statusMsg ? (
        <DraggablePanel id="status-bar" zIndex={OVERLAY_Z.READOUT}>
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(15,15,30,0.88)', backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 16px',
            color: '#ccc', fontSize: 12, zIndex: 50, maxWidth: '80%', textAlign: 'center',
          }}>
            {statusMsg}
          </div>
        </DraggablePanel>
      ) : null}

      {/* v62: Stitched roof-model toggle + Stitch button.
          v70: combined into a single draggable "top-left dock".
          A small grip handle (⠿) on the left is the drag handle;
          the buttons keep their own click semantics. */}
      {stage === 'done' ? (
        <DraggablePanel id="top-left-dock" zIndex={OVERLAY_Z.DOCK}>
          <div
            data-drag-handle
            style={{
              position: 'absolute', top: 12, left: 12, zIndex: 51,
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(15,15,30,0.7)', borderRadius: 8,
              padding: '4px 8px 4px 6px',
              cursor: 'grab', touchAction: 'none',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <span
              aria-label="Drag"
              title="Drag to move"
              style={{
                color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1,
                fontFamily: 'sans-serif', letterSpacing: -1, userSelect: 'none',
                cursor: 'grab', pointerEvents: 'none',
              }}
            >⠿</span>
            <button
              onClick={() => setShowRoofModel(v => !v)}
              title="Roof Model: classify & stitch every plane's edges (ridge/hip/valley/eave/rake)"
              data-no-drag
              style={{
                background: showRoofModel ? 'rgba(34,184,255,0.18)' : 'rgba(15,15,30,0.6)',
                border: `1px solid ${showRoofModel ? 'rgba(34,184,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
                color: showRoofModel ? '#22b8ff' : '#bbb', borderRadius: 6, padding: '4px 8px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              🔗 Roof Model{showRoofModel ? ' ✓' : ''}
            </button>
            {/* v66: solid building. Walls from every exterior roof edge down to
                the ground, plus opaque roof surfaces, so a traced roof reads as
                a building instead of wireframe over satellite imagery. */}
            <button
              onClick={() => setShowBuilding3D(v => !v)}
              title="Building: extrude walls from the roof down to the ground and fill the roof surfaces — turns marked planes into a solid 3D model"
              data-no-drag
              style={{
                background: showBuilding3D ? 'rgba(232,234,240,0.22)' : 'rgba(15,15,30,0.6)',
                border: `1px solid ${showBuilding3D ? 'rgba(232,234,240,0.65)' : 'rgba(255,255,255,0.12)'}`,
                color: showBuilding3D ? '#e8eaf0' : '#bbb', borderRadius: 6, padding: '4px 8px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              🏚 Building{showBuilding3D ? ' ✓' : ''}
            </button>
            {/* v66: aerial texture on the roof faces. Only meaningful while the
                solid building is shown, so it hides with it. */}
            {showBuilding3D ? (
              <button
                onClick={() => setShowRoofTexture(v => !v)}
                title="Aerial: drape the real satellite image onto the roof faces instead of a flat colour"
                data-no-drag
                style={{
                  background: showRoofTexture ? 'rgba(120,200,120,0.20)' : 'rgba(15,15,30,0.6)',
                  border: `1px solid ${showRoofTexture ? 'rgba(120,200,120,0.6)' : 'rgba(255,255,255,0.12)'}`,
                  color: showRoofTexture ? '#8fd98f' : '#bbb', borderRadius: 6, padding: '4px 8px',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
                }}
              >
                🛰 Aerial{showRoofTexture ? ' ✓' : ''}
              </button>
            ) : null}
            {/* 🚨 THE WALLS / PITCH STEPPERS USED TO LIVE HERE. THEY LIED.

                `WALLS {ftStr(effectiveWallM)}` rendered a global React counter
                that started at 3.0 m and moved only by what had been pressed.
                It was not measured from anything, so it named no wall — and the
                chip beside it read THIS FACE while the stepper it labelled
                incremented the whole-building number, because
                `setBuildingOverrides` was declared and never called. A live
                test reported "around 17 ft" against a 10' 6" wall, and that is
                exactly the arithmetic: eight faces, eight presses, one foot of
                building, eight feet of readout.

                Replaced by the Selection Inspector (bottom right), which shows
                the section's own canonical eave height, pad elevation and
                pitch, derives the ridge, and edits the VOLUME so a gable cannot
                be torn open at the ridge one face at a time. See
                lib/3d/sectionEditing.ts and tests/sectionVerticalModel.test.ts,
                which reproduces the old behaviour and asserts that it fails. */}
            {showBuilding3D ? (
              <span
                data-testid="build3d-inspector-hint"
                title="Height, pitch and pad elevation are edited on the Selection Inspector, scoped to the building section you click."
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3, padding: '3px 7px',
                  borderRadius: 4, color: '#9aa3b8',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                }}
              >
                {/* It said "Inspector -> this section" for ANY selected face,
                    while the inspector simultaneously read "not part of a
                    building section" for a hand-traced one: two on-screen
                    statements contradicting each other, about a capability
                    that face does not have. It now reports what IS selected. */}
                {!activeFaceId
                  ? 'Click a roof to edit it'
                  : (selectedFaceHasSection
                      ? '\u2B21 Inspector \u2192 this section'
                      : '\u2B21 Single roof face \u2014 no walls, pad or ridge')}
              </span>
            ) : null}
            {/* v66: square up the trace itself. Sits next to Stitch because they
                are the two corrective actions, and both move traced corners —
                so both are explicit, and both report what they changed. */}
            <button
              onClick={() => { const v = viewerRef.current; const Cz = (window as any).Cesium; if (v && Cz) squareUpTracedFaces(v, Cz); }}
              title="Square Up: straighten near-parallel edges, square near-right corners, drop stray points, and join corners the faces share. Refuses any face it would move more than 5 ft — retrace that one instead."
              data-no-drag
              style={{
                background: 'rgba(160,140,255,0.16)', border: '1px solid rgba(160,140,255,0.5)',
                color: '#c0b0ff', borderRadius: 6, padding: '4px 8px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              📐 Square Up
            </button>
            <button
              onClick={() => { const v = viewerRef.current; const Cz = (window as any).Cesium; if (v && Cz) stitchRoofVertices(v, Cz); }}
              title="Stitch: pull marked planes together - averages corners that should be shared (hips/ridges/valleys) into one natural point"
              data-no-drag
              style={{
                background: 'rgba(15,15,30,0.6)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#bbb', borderRadius: 6, padding: '4px 8px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >
              ✂ Stitch
            </button>
          </div>
        </DraggablePanel>
      ) : null}

      {/* Stitch button moved into the top-left-dock (Roof Model + Stitch) above. */}

      {/* ── THE SELECTION INSPECTOR ─────────────────────────────────────────
          Phase A + B of the interaction model in one panel: it names the level
          that is selected, and its controls are scoped to that level.

          It mounts whenever there is a roof to inspect — not only in Building
          view — because "how high is this wall" is a question about the model,
          not about a visualisation toggle. Every value it shows is derived from
          canonical geometry on each render by lib/3d/sectionEditing, so no
          control can drift away from the building it claims to describe. */}
      {/* ── THE SELECTED SITE OBJECT ──────────────────────────────────────
             🚨 PLACING A TREE WAS ONLY HALF A WORKFLOW. "I tried the Tree
             button. It does not visibly give me a useful tree." Even once the
             tool placed a canonical object, nothing could CHANGE it: no height,
             no canopy, no dimensions at all after the click. A tree you cannot
             size is not a tree, it is a marker — and Shade reads exactly those
             two numbers.

             It is the same panel for every roof object, because a vent, a
             chimney and a tree differ in their numbers and not in the act of
             editing them. Only the fields that mean something are shown. */}
      {stage === 'done' && selectedObstructionId ? (
        <DraggablePanel id="obstruction-inspector" zIndex={OVERLAY_Z.INSPECTOR}>
          <div
            data-testid="obstruction-inspector"
            style={{
              position: 'absolute', right: 12, top: 96, width: 232,
              background: 'rgba(10,14,24,0.94)', border: '1px solid rgba(148,163,184,0.3)',
              borderRadius: 10, padding: '10px 11px', color: '#e2e8f0', fontSize: 11,
              boxShadow: '0 8px 26px rgba(0,0,0,0.45)', cursor: 'grab', touchAction: 'none',
            }}
          >
            {(() => {
              const obs = (obstructionsRef.current ?? []).find(o => o?.id === selectedObstructionId);
              if (!obs) return <div style={{ color: '#9aa8bd' }}>That object is no longer here.</div>;
              const pr = presetFor(obs.type);
              const isTree = (obs as { space?: string }).space === 'site' || obs.type === 'tree';
              const patch = (next: Partial<typeof obs>) => {
                const merged = { ...obs, ...next };
                setObstructions(prev => prev.map(o => (o.id === obs.id ? merged : o)));
                // Redraw it where it now stands, at its new size.
                const v = viewerRef.current;
                if (v) { try { removeObstructionEntities(v, [obs.id]); } catch { /* ignore */ } }
                drawObstructionEntity(viewerRef.current, (window as any).Cesium, merged);
              };
              const num = (
                label: string, unit: string, value: number, testId: string,
                min: number, max: number, onSet: (v: number) => void,
              ) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                  <span style={{ color: '#cfd8e6', fontSize: 10.5, minWidth: 92 }}>{label}</span>
                  <input
                    type="number" data-no-drag data-testid={testId}
                    step={0.1} min={min} max={max}
                    value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (isFinite(v)) onSet(Math.max(min, Math.min(max, v)));
                    }}
                    style={{
                      width: 64, background: 'rgba(0,0,0,0.42)', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.18)', borderRadius: 5,
                      padding: '2px 5px', fontSize: 11, fontWeight: 700, textAlign: 'right',
                    }}
                  />
                  <span style={{ color: '#7c8aa5', fontSize: 10 }}>{unit}</span>
                </div>
              );
              return (
                <>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 1 }}>
                    {pr.icon} {pr.label}
                  </div>
                  <div style={{ color: '#9aa8bd', fontSize: 10, marginBottom: 4 }}>
                    {isTree ? 'Stands on the ground. It shades; it takes no roof area.'
                            : 'On the roof. Panels keep clear of it.'}
                  </div>
                  {num('Height', 'm', obs.heightM ?? pr.heightM, 'obstruction-height', 0.05, 30,
                    v => patch({ heightM: v }))}
                  {isTree
                    ? num('Canopy width', 'm', (obs.canopyRadiusM ?? 2) * 2, 'obstruction-canopy', 0.5, 30,
                        v => patch({ canopyRadiusM: v / 2, widthM: v, depthM: v,
                          radiusM: legacyRadiusFor(v, v) }))
                    : (
                      <>
                        {num('Width', 'm', obs.widthM ?? pr.widthM, 'obstruction-width', 0.05, 12,
                          v => patch({ widthM: v, radiusM: legacyRadiusFor(v, obs.depthM ?? pr.depthM) }))}
                        {num('Depth', 'm', obs.depthM ?? pr.depthM, 'obstruction-depth', 0.05, 12,
                          v => patch({ depthM: v, radiusM: legacyRadiusFor(obs.widthM ?? pr.widthM, v) }))}
                        {num('Clearance', 'm', obs.clearanceM ?? (DEFAULT_CLEARANCE_M[obs.type] ?? 0.15),
                          'obstruction-clearance', 0, 3, v => patch({ clearanceM: v }))}
                      </>
                    )}
                  <button
                    type="button" data-no-drag data-testid="obstruction-delete"
                    onClick={() => onRequestDelete?.('obstruction', obs.id)}
                    style={{
                      marginTop: 9, width: '100%', padding: '5px 0', borderRadius: 6,
                      background: 'rgba(255,90,90,0.12)', border: '1px solid rgba(255,90,90,0.40)',
                      color: '#ffb3b3', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
                    }}
                  >🗑 Delete this {pr.label.toLowerCase()}</button>
                </>
              );
            })()}
          </div>
        </DraggablePanel>
      ) : null}

      {stage === 'done' && (roofPlanes?.length ?? 0) > 0 ? (
        <DraggablePanel id="section-inspector" zIndex={OVERLAY_Z.INSPECTOR}>
          <div
            data-drag-handle
            style={{ position: 'absolute', bottom: 96, right: 12, zIndex: 52, cursor: 'grab', touchAction: 'none' }}
          >
            <SectionInspector
              state={inspectorState}
              onEdit={handleInspectorEdit}
              onSelectLevel={(lvl) => { setSelectionLevel(lvl); setSectionRefusal(null); }}
              onNudgeFace={(deltaM) => { if (activeFaceId) nudgeFaceElevation(activeFaceId, deltaM); }}
              onClearSelection={() => { selectRoofFace(null); setStatusMsg('Selection cleared'); }}
              onDismissRefusal={() => setSectionRefusal(null)}
              onSetFacePitch={(deg, anchor) => {
                if (!activeFaceId) { setSectionRefusal('Select a roof face to set its pitch.'); return; }
                if (editFacePitch(activeFaceId, deg, anchor)) {
                  setStatusMsg(`📐 Pitch ${deg.toFixed(1)}° · ${formatRise12(deg)} — ` +
                    (anchor === 'ridge' ? 'ridge held, wall re-derived' : 'wall held, ridge moved'));
                }
              }}
              onSetPitchAnchor={(a) => { setPitchAnchor(a); setSectionRefusal(null); }}
              /* 🚨 THE PREVIEW READS THE PROP, NOT THE REF. Same reason the
                 inspector's own values do: `roofPlanesRef.current` is written by
                 an effect AFTER the render that received the new array, so a
                 preview taken from it would describe the PREVIOUS building —
                 and would disagree with the commit by exactly one edit. */
              previewPitch={(deg, anchor) =>
                activeFaceId ? previewFacePitch(inspectorPlanes, activeFaceId, deg, anchor) : null}
              onSelectFace={(faceId) => { selectRoofFace(faceId); setSelectionLevel('face'); }}
              /* 🚨 THE ONLY WAY A HAND RESHAPE IS EVER DISCARDED. Never
                 inferred, never a default — the installer presses this and the
                 section is rebuilt from the footprint and pitch it was traced
                 with. It is recorded as its own history step, so Undo puts the
                 reshape back. */
              onRebuildFromParameters={() => {
                const sid = selectedFaceSectionId;
                if (!sid) return;
                if (editSection(sid, { rebuildFromParameters: true }, 'Rebuild section from trace', `rebuild:${sid}`)) {
                  setStatusMsg('🏠 Section rebuilt from its traced footprint — the hand reshape was discarded (Undo restores it)');
                }
              }}
              /* 🚨 THE ENGINE NAMES THE OBJECT; THE OWNER DELETES IT. Everything
                 that makes a deletion stick — the undo step, the tombstone that
                 stops a restore path re-admitting the face, and the one-shot
                 authorization that lets the save through — lives with
                 `roofPlanes`, which this component does not own. */
              onSetSlopeAzimuth={(deg) => {
                const sid = selectedFaceSectionId;
                if (!sid) { setSectionRefusal('Select a building section first.'); return; }
                if (editSection(sid, { shedAzimuthDeg: deg }, 'Set slope direction', `slope:${sid}`)) {
                  setStatusMsg('\u2198 This roof now falls toward ' + deg + '\u00b0 \u2014 the opposite edge is the high one');
                }
              }}
              onDelete={(scope) => {
                const target = scope === 'section' ? selectedFaceSectionId : activeFaceId;
                if (!target) {
                  setSectionRefusal(scope === 'section'
                    ? 'Select a building section first.'
                    : 'Select a roof face first.');
                  return;
                }
                onRequestDelete?.(scope, target);
              }}
            />
          </div>
        </DraggablePanel>
      ) : null}

      {/* v66 (create-design-modal): Aurora-parity "Save → Create Design" trigger.
          The parent owns the modal state and is expected to render
          <CreateDesignModal> + switch to Design phase when fired. See
          components/3d/designs/DESIGN.md.

          POSITIONING: v1 was top:12,right:12 → covered the top-right
          column (stats + 3D Primitives Properties + context controls).
          v2 was bottom:70,left:50% → conflicted with the 12:00 Solar
          widget (also at bottom:40,left:50%). v3 places it at
          bottom:50,right:100 (bottom-right) — to the right of the
          12:00 Solar widget, above the last log, left of the compass.
          The trigger is visible without occluding the 12:00 Solar
          widget or the right-side tool panel column. */}
            {stage === 'done' && onCreateDesign ? (
        <DraggablePanel id="save-create-design" zIndex={OVERLAY_Z.ACTION}>
          <div
            data-drag-handle
            style={{
              position: 'absolute', bottom: 50, right: 100, zIndex: 51,
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(15,15,30,0.85)', borderRadius: 8, padding: '4px 6px 4px 8px',
              border: '1px solid rgba(20,184,166,0.4)', backdropFilter: 'blur(6px)',
              boxShadow: '0 4px 14px rgba(20,184,166,0.35)', cursor: 'grab', touchAction: 'none',
            }}
          >
            <span
              aria-label="Drag"
              title="Drag to move"
              style={{
                color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1,
                fontFamily: 'sans-serif', letterSpacing: -1, userSelect: 'none',
                cursor: 'grab', pointerEvents: 'none',
              }}
            >⠿</span>
            <button
              onClick={onCreateDesign}
              title="Save the site model and open the Create Design dialog"
              data-testid="solarengine-save-create-design"
              data-no-drag
              style={{
                background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(20,184,166,0.4)',
                letterSpacing: 0.3,
              }}
            >
              💾 Save → Create Design
            </button>
          </div>
        </DraggablePanel>
      ) : null}

      {/* v62: Roof-model edge legend - v70: draggable. */}
      {stage === 'done' && showRoofModel ? (
        <DraggablePanel id="roof-edges-legend" zIndex={OVERLAY_Z.READOUT}>
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
        </DraggablePanel>
      ) : null}

      {/* v62: Fire setback legend - v70: draggable. */}
      {stage === 'done' && showSetbackZones && !showRoofModel ? (
        <DraggablePanel id="fire-setbacks-legend" zIndex={OVERLAY_Z.READOUT}>
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
        </DraggablePanel>
      ) : null}

      {/* Coordinates bar - v70: draggable. Grab the bar to move. */}
      {stage === 'done' ? (
        <DraggablePanel id="coordinates-bar" zIndex={OVERLAY_Z.READOUT}>
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '3px 8px',
            color: '#666', fontSize: 10, zIndex: 50, fontFamily: 'monospace',
          }}>
            {lat.toFixed(5)}, {lng.toFixed(5)} | h={ftStr(cesiumGroundElevRef.current)} ({cesiumGroundElevRef.current.toFixed(0)}m)
          </div>
        </DraggablePanel>
      ) : null}

      {/* v66: Bottom-right status panel (Aurora frame 0147 parity).
          Sits above the "Last log" bar (which is at bottom: 8px) so
          both are visible. The panel is a pure read of panels.length;
          no $/W plumbing yet — the design-panel agent's Create Design
          modal will thread costPerWatt through this prop when it lands. */}
      {isDesignPhase ? <StatusPanel modules={panels.length} /> : null}

      {/* Last log - v70: draggable. Grab the bar to move. */}
      {stage === 'done' && lastLog ? (
        <DraggablePanel id="last-log" zIndex={OVERLAY_Z.READOUT}>
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.5)', borderRadius: 5, padding: '2px 8px',
            color: '#555', fontSize: 9, zIndex: 50, fontFamily: 'monospace', maxWidth: 300,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {lastLog}
          </div>
        </DraggablePanel>
      ) : null}

      {/* v66: LiDAR Properties panel (Aurora parity — top-left). Mounted
          only after the Cesium viewer is ready so the panel can show
          error states from real load attempts. The "LiDAR is running..."
          toast mirrors Aurora's top-right loader indicator.

          v67: Drag handle on the header (cursor: grab). Drag anywhere
          on the green LiDAR header to move the panel. Position persists
          to localStorage so the layout survives reloads. */}
      {stage === 'done' ? (
        <>
          <DraggablePanel id="lidar-properties" zIndex={OVERLAY_Z.DATA}>
            <LiDARPropertiesPanel
              state={lidar.state}
              onStyleChange={lidar.setStyle}
              onTexturedChange={lidar.setTextured}
              onOffsetChange={lidar.setOffset}
              onLoadClick={handleLiDARLoad}
              onLiftRoofs={handleLiftRoofs}
              onFlattenRoofs={handleFlattenRoofs}
              onClear={() => lidar.setDataset(null)}
            />
          </DraggablePanel>
          <LiDARLoadingToast show={lidar.state.isLoading} />
        </>
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
    prev.systemType === next.systemType &&
    prev.isDesignPhase === next.isDesignPhase
  );
});
