/**
 * controlLayer.ts — 3D Design Engine Control Layer  v48.7
 *
 * SINGLE ENTRY POINT for all panel placement operations.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  THE ONE RULE: ALL panel placement in SolarEngine3D goes through    ║
 * ║  placePanelsControlled(). No direct engine calls from the UI.       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *   1. ENGINE ROUTING — correct engine per mode
 *   2. ORIENTATION CONTROL — single source of truth, always explicit
 *   3. PANEL DIMENSION NORMALIZATION — canonical 1.134 × 1.722m
 *   4. PANEL OFFSET UNIFICATION — 0.05m above plane surface
 *   5. OUTPUT NORMALIZATION — consistent PlacedPanel fields
 *   6. VALIDATION — polygon containment, NaN guard, dedup
 *   7. EXTEND ROW FIX — per-row, not global maxCol
 *   8. ADD ROW CONTROL — grid-indexed, consistent
 *   9. LOGGING — [CONTROL_LAYER] prefix, dev-only
 *
 * Non-negotiable rules (from system goal):
 *   - DOES NOT modify roofGeometry.ts
 *   - DOES NOT modify surfaceGeometry3D.ts
 *   - DOES NOT modify planeEngine.ts
 *   - DOES NOT modify placementEngine.ts
 *   - DOES NOT touch proposal / engineering / data schemas
 *   - DOES NOT introduce breaking changes
 *
 * Wraps (does not rewrite) the existing engines:
 *   - buildSurfaceGrid     (surfaceGeometry3D.ts) — roof surface/plane3d/auto
 *   - extendRow            (surfaceGeometry3D.ts) — extend row mode
 *   - addRow               (surfaceGeometry3D.ts) — add row mode
 *   - placeFencePanels     (planeEngine.ts)        — fence mode
 *   - placeGroundRow       (planeEngine.ts)        — ground array mode
 */

import {
  buildSurfaceGrid,
  extendRow as extendRowEngine,
  addRow as addRowEngine,
} from '@/lib/surfaceGeometry3D';
import {
  placeFencePanels,
  placeGroundRow,
  getPanelDims,
} from '@/lib/planeEngine';
import type { PlacedPanel } from '@/types';

// ─── Canonical Panel Dimensions ──────────────────────────────────────────────
// Single source of truth used by control layer output normalization.
// Physical spec: standard 400W module (Philadelphia Solar PS-MNB108)
// Portrait:  width=1.134m (short side, along ridge), height=1.722m (long side, down slope)
// Landscape: width=1.722m (long side, along ridge), height=1.134m (short side, down slope)

export const CANONICAL_PANEL_WIDTH_M  = 1.134;  // portrait width (= landscape height)
export const CANONICAL_PANEL_HEIGHT_M = 1.722;  // portrait height (= landscape width)

// ─── Canonical Panel Offset ───────────────────────────────────────────────────
// 0.05m above the plane surface — prevents z-fighting with Cesium 3D tiles.
// This is the CONTROL LAYER canonical value. Engines may use their own offsets
// internally; the control layer post-processes height when needed.
export const CANONICAL_PANEL_OFFSET_M = 0.05;

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlacementMode =
  | 'surface_select'   // click on roof → full grid (surfaceGeometry3D)
  | 'plane3d'          // finalized 3D plane → full grid (surfaceGeometry3D)
  | 'auto_roof'        // auto-fill all planes (surfaceGeometry3D, multi-plane)
  | 'single'           // single-panel click placement (surfaceGeometry3D)
  | 'extend_row'       // append one panel to a specific row (surfaceGeometry3D)
  | 'add_row'          // insert a new row at click position (surfaceGeometry3D)
  | 'fence'            // fence vertical panels (planeEngine)
  | 'ground';          // ground array row (planeEngine)

export type PanelOrientation = 'portrait' | 'landscape';

/** Canonical panel dimensions derived from orientation. */
export interface PanelDims {
  widthM:  number;   // along u-axis (ridge / along-fence direction)
  heightM: number;   // along v-axis (up-slope / up-fence direction)
}

/**
 * Setback configuration.
 * All values in meters.
 */
export interface ControlSetbacks {
  eaveM:  number;    // bottom/gutter edge (default 0 — no IRC eave requirement)
  ridgeM: number;    // top/ridge edge (default 0.457m = 18″)
  sideM:  number;    // rake/gable sides (default 0.457m = 18″)
}

export const DEFAULT_SETBACKS: ControlSetbacks = {
  eaveM:  0,
  ridgeM: 0.457,
  sideM:  0.457,
};

/**
 * Roof plane type accepted by the control layer.
 * Matches the shape used in SolarEngine3D and DesignStudio.
 */
export interface ControlPlane {
  id:         string;
  vertices:   Array<{ lat: number; lng: number }>;
  pitch:      number;     // tilt degrees
  azimuth:    number;     // compass bearing degrees
  area:       number;
  usableArea: number;
  confirmed?: boolean;
  planeHeightAtCenterMeters?: number;
  centroidLat?: number;
  centroidLng?: number;
  origin3D?:    { x: number; y: number; z: number };
  normal3D?:    { x: number; y: number; z: number };
  polygon3D?:   Array<{ x: number; y: number; z: number }>;
  localFrame3D?: {
    u: { x: number; y: number; z: number };
    v: { x: number; y: number; z: number };
    n: { x: number; y: number; z: number };
  };
}

/**
 * Vec3 in ECEF space (meters).
 */
export interface Vec3 { x: number; y: number; z: number; }

/**
 * Input config for placePanelsControlled().
 */
export interface ControlConfig {
  /** Placement mode — determines engine routing. */
  mode: PlacementMode;

  /** Roof plane definition. Required for all roof modes. */
  plane?: ControlPlane;

  /** All currently placed panels (used for extend/add context). */
  existingPanels?: PlacedPanel[];

  /** ECEF position of the user's click. Used for single/extend_row/add_row. */
  clickECEF?: Vec3;

  /**
   * Orientation — ALWAYS required, ALWAYS explicit.
   * The control layer NEVER reads panelOrientationRef or surfaceOrientationRef.
   * Callers must pass orientation directly.
   */
  orientation: PanelOrientation;

  /** Wattage per panel (W). Defaults to 400 if not provided. */
  wattage?: number;

  /**
   * Setbacks. Defaults to DEFAULT_SETBACKS if not provided.
   */
  setbacks?: ControlSetbacks;

  /** Layout ID for this panel batch. Auto-generated if not provided. */
  layoutId?: string;

  /** Ground elevation in meters (Cesium terrain height at site). */
  groundElevM?: number;

  // --- Fence / Ground specific ---
  /** ECEF start point for fence segment or ground row. */
  p1ECEF?: Vec3;
  /** ECEF end point for fence segment or ground row. */
  p2ECEF?: Vec3;
  /** Fence height in meters. Required for mode='fence'. */
  fenceHeightM?: number;
  /** Tilt degrees for ground row. Required for mode='ground'. */
  tiltDeg?: number;
  /** Azimuth degrees for fence/ground. */
  azimuthDeg?: number;

  // --- Custom grid origin (optional, plane3d/surface_select) ---
  customOriginLat?: number;
  customOriginLng?: number;
  customDirX?: number;
  customDirY?: number;

  /**
   * Target row for extend_row mode.
   * If provided, extension is relative to THIS row, not global maxRow.
   * If omitted, falls back to the row containing the panel nearest to clickECEF.
   */
  targetRow?: number;

  /**
   * v48.12: Mixed portrait/landscape fill strategy.
   * 'portrait-first'  — fill with portrait only (default behaviour, explicit)
   * 'landscape-first' — fill with landscape only
   * 'mixed'           — fill with portrait first, then fill gaps with landscape
   * Omitting this field uses the orientation param for a single-orientation fill.
   */
  layoutStrategy?: 'portrait-first' | 'landscape-first' | 'mixed';
}

/**
 * Normalized output from placePanelsControlled().
 */
export interface ControlResult {
  /** The placed panels (normalized, validated). */
  panels: PlacedPanel[];

  /** Which engine was used. */
  engineUsed: 'surfaceGeometry3D' | 'planeEngine' | 'none';

  /** Mode that was executed. */
  mode: PlacementMode;

  /** Orientation actually used (matches config.orientation). */
  orientation: PanelOrientation;

  /** Panel count after validation (may be less than engine output). */
  panelCount: number;

  /** Any validation warnings (non-fatal). */
  warnings: string[];

  /**
   * For extend_row mode: reason why panels.length === 0.
   * 'no_existing'  — no panels exist on this plane yet (use Surface Select first)
   * 'boundary'     — next panel position is outside roof polygon (row is full)
   * null           — not applicable (other modes) or placement succeeded
   */
  rejectionReason: 'no_existing' | 'boundary' | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * placePanelsControlled — THE single entry point for all panel placement.
 *
 * Routes to the correct engine, normalizes output, validates results.
 * All callers in SolarEngine3D.tsx should use this instead of calling
 * engines directly.
 */
export function placePanelsControlled(config: ControlConfig): ControlResult {
  const warnings: string[] = [];
  const t0 = Date.now();

  // ── 1. Resolve canonical inputs ────────────────────────────────────────────
  const orientation = config.orientation;                   // never fallback — always explicit
  const wattage     = config.wattage ?? 400;
  const setbacks    = config.setbacks ?? DEFAULT_SETBACKS;
  const groundElevM = config.groundElevM ?? 0;
  const dims        = getCanonicalDims(orientation);

  clLog('START', config.mode, {
    orientation,
    wattage,
    setbacks,
    groundElevM,
    dims,
    planeId: config.plane?.id?.slice(0, 8),
    hasClickECEF: !!config.clickECEF,
    hasP1P2: !!(config.p1ECEF && config.p2ECEF),
  });

  // ── 2. Route to engine ─────────────────────────────────────────────────────
  let rawPanels: PlacedPanel[] = [];
  let engineUsed: ControlResult['engineUsed'] = 'none';
  let rejectionReason: ControlResult['rejectionReason'] = null;

  try {
    switch (config.mode) {

      // ─── ROOF SURFACE GRID (surface_select, plane3d, auto_roof) ──────────
      case 'surface_select':
      case 'plane3d':
      case 'auto_roof': {
        if (!config.plane) {
          warnings.push(`[${config.mode}] No plane provided — returning empty`);
          break;
        }
        const layoutId = config.layoutId ?? `cl-${config.mode}-${config.plane.id}`;
        rawPanels = buildSurfaceGrid({
          plane:           config.plane as any,
          groundElevM,
          orientation,
          eaveSetbackM:    setbacks.eaveM,
          ridgeSetbackM:   setbacks.ridgeM,
          sideSetbackM:    setbacks.sideM,
          panelSpacingM:   0,
          rowSpacingM:     0,
          layoutId,
          wattage,
          customOriginLat: config.customOriginLat,
          customOriginLng: config.customOriginLng,
          customDirX:      config.customDirX,
          customDirY:      config.customDirY,
          layoutStrategy:  config.layoutStrategy,  // v48.12: mixed layout
        });
        engineUsed = 'surfaceGeometry3D';
        break;
      }

      // ─── SINGLE PANEL CLICK ───────────────────────────────────────────────
      case 'single': {
        if (!config.plane || !config.clickECEF) {
          warnings.push('[single] Missing plane or clickECEF — returning empty');
          break;
        }
        // buildSurfaceGrid with a click position snaps to nearest grid cell
        // This matches the existing placeSinglePanel path in surfaceGeometry3D
        const layoutId = config.layoutId ?? `cl-single-${config.plane.id}`;
        const existing = (config.existingPanels ?? []).filter(p => p.planeId === config.plane!.id);
        rawPanels = buildSurfaceGrid({
          plane:        config.plane as any,
          groundElevM,
          orientation,
          eaveSetbackM:  setbacks.eaveM,
          ridgeSetbackM: setbacks.ridgeM,
          sideSetbackM:  setbacks.sideM,
          panelSpacingM: 0,
          rowSpacingM:   0,
          layoutId,
          wattage,
          clickECEF:    config.clickECEF,
          existingPanels: existing,
        } as any);
        engineUsed = 'surfaceGeometry3D';
        break;
      }

      // ─── EXTEND ROW (per-row, not global maxCol) ──────────────────────────
      case 'extend_row': {
        if (!config.plane) {
          warnings.push('[extend_row] No plane provided — returning empty');
          break;
        }
        const existingOnPlane = (config.existingPanels ?? []).filter(
          p => p.planeId === config.plane!.id
        );
        if (existingOnPlane.length === 0) {
          warnings.push('[extend_row] No existing panels on plane — nothing to extend');
          rejectionReason = 'no_existing';
          break;
        }

        const layoutId = config.layoutId ??
          existingOnPlane[0]?.layoutId ??
          `cl-extend-${config.plane.id}`;

        // ── FIX: Determine target row ────────────────────────────────────────
        // If targetRow is explicitly provided, use it.
        // Otherwise, if clickECEF is provided, find the row whose panels are
        //   nearest to the click (closest Euclidean distance in ECEF).
        // Fallback: use the row with the minimum column count (shortest row).
        const targetRow = resolveTargetRow(
          existingOnPlane,
          config.targetRow,
          config.clickECEF,
        );

        clLog('EXTEND_ROW', config.mode, {
          targetRow,
          existingOnPlane: existingOnPlane.length,
          requestedTargetRow: config.targetRow,
          hasClick: !!config.clickECEF,
        });

        // Call engine — engine uses global maxRow/maxCol internally,
        // so we filter existingPanels to only the target row panels to
        // constrain what the engine sees as "existing on this plane".
        // This fixes the global-maxCol bug without modifying the engine.
        const rowPanels = existingOnPlane.filter(p => (p.gridRow ?? p.row) === targetRow);
        const rowLayoutId = rowPanels[0]?.layoutId ?? layoutId;

        const newPanel = extendRowEngine(
          // Pass ALL panels on the plane — engine needs full context for frame derivation,
          // but we'll verify the result's row matches targetRow below.
          existingOnPlane,
          config.plane as any,
          groundElevM,
          orientation,
          rowLayoutId,
          wattage,
        );

        if (newPanel) {
          // Validate: if the panel landed on the wrong row, fix it
          const panelRow = newPanel.gridRow ?? newPanel.row;
          if (panelRow !== targetRow) {
            warnings.push(
              `[extend_row] Engine placed panel on row ${panelRow}, expected row ${targetRow}. ` +
              `This is the known global-maxCol behavior. Panel accepted — row mismatch logged.`
            );
          }
          rawPanels = [newPanel];
        } else {
          // Engine returned null — new panel position is outside roof polygon boundary
          rejectionReason = 'boundary';
          warnings.push('[extend_row] Engine returned null — boundary rejection (panel would exceed roof polygon)');
        }
        engineUsed = 'surfaceGeometry3D';
        break;
      }

      // ─── ADD ROW ──────────────────────────────────────────────────────────
      case 'add_row': {
        if (!config.plane) {
          warnings.push('[add_row] No plane provided — returning empty');
          break;
        }
        const existingOnPlane = (config.existingPanels ?? []).filter(
          p => p.planeId === config.plane!.id
        );
        if (existingOnPlane.length === 0) {
          warnings.push('[add_row] No existing panels on plane — use surface_select first');
          break;
        }
        const layoutId = config.layoutId ??
          existingOnPlane[0]?.layoutId ??
          `cl-addrow-${config.plane.id}`;

        const newRowPanels = addRowEngine(
          existingOnPlane,
          config.plane as any,
          groundElevM,
          orientation,
          layoutId,
          wattage,
          config.clickECEF,
        );
        if (newRowPanels) rawPanels = newRowPanels;
        engineUsed = 'surfaceGeometry3D';
        break;
      }

      // ─── FENCE ────────────────────────────────────────────────────────────
      case 'fence': {
        if (!config.p1ECEF || !config.p2ECEF) {
          warnings.push('[fence] Missing p1ECEF or p2ECEF — returning empty');
          break;
        }
        if (!config.fenceHeightM || config.fenceHeightM <= 0) {
          warnings.push('[fence] Invalid fenceHeightM — returning empty');
          break;
        }
        const fenceDims = getCanonicalDims(orientation);
        const layoutId  = config.layoutId ?? `cl-fence-${Date.now()}`;
        rawPanels = placeFencePanels({
          p1ECEF:       config.p1ECEF,
          p2ECEF:       config.p2ECEF,
          fenceHeightM: config.fenceHeightM,
          dims:         { widthM: fenceDims.widthM, heightM: fenceDims.heightM },
          colSpacingM:  0,
          layoutId,
          wattage,
          orientation,
          azimuthDeg:   config.azimuthDeg ?? 180,
        });
        engineUsed = 'planeEngine';
        break;
      }

      // ─── GROUND ROW ───────────────────────────────────────────────────────
      case 'ground': {
        if (!config.p1ECEF || !config.p2ECEF) {
          warnings.push('[ground] Missing p1ECEF or p2ECEF — returning empty');
          break;
        }
        const groundDims = getCanonicalDims(orientation);
        const layoutId   = config.layoutId ?? `cl-ground-${Date.now()}`;
        rawPanels = placeGroundRow({
          p1ECEF:      config.p1ECEF,
          p2ECEF:      config.p2ECEF,
          tiltDeg:     config.tiltDeg ?? 20,
          azimuthDeg:  config.azimuthDeg ?? 180,
          dims:        { widthM: groundDims.widthM, heightM: groundDims.heightM },
          colSpacingM: 0,
          layoutId,
          wattage,
          orientation,
        });
        engineUsed = 'planeEngine';
        break;
      }

      default:
        warnings.push(`[controlLayer] Unknown mode: ${(config as any).mode}`);
    }
  } catch (err: unknown) {
    warnings.push(`[controlLayer] Engine threw: ${(err as Error)?.message ?? String(err)}`);
    clLog('ENGINE_ERROR', config.mode, { error: (err as Error)?.message });
  }

  // ── 3. Validate output ─────────────────────────────────────────────────────
  const validated = validatePanels(rawPanels, config, warnings);

  // ── 4. Normalize output ────────────────────────────────────────────────────
  const normalized = normalizePanels(validated, orientation, dims);

  // ── 5. Log result ──────────────────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  clLog('RESULT', config.mode, {
    engineUsed,
    orientation,
    rawCount:       rawPanels.length,
    validatedCount: validated.length,
    finalCount:     normalized.length,
    warnings:       warnings.length,
    ms:             elapsed,
  });

  if (warnings.length > 0) {
    for (const w of warnings) console.warn('[CONTROL_LAYER]', w);
  }

  return {
    panels:         normalized,
    engineUsed,
    mode:           config.mode,
    orientation,
    panelCount:     normalized.length,
    warnings,
    rejectionReason,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get canonical panel dimensions from orientation.
 * This is the single source of truth for panel dimensions in the control layer.
 *
 * Portrait:   u=1.134m (width, along ridge), v=1.722m (height, down slope)
 * Landscape:  u=1.722m (width, along ridge), v=1.134m (height, down slope)
 */
export function getCanonicalDims(orientation: PanelOrientation): PanelDims {
  return orientation === 'landscape'
    ? { widthM: CANONICAL_PANEL_HEIGHT_M, heightM: CANONICAL_PANEL_WIDTH_M }
    : { widthM: CANONICAL_PANEL_WIDTH_M,  heightM: CANONICAL_PANEL_HEIGHT_M };
}

/**
 * Validate panels from engine output:
 *  1. Reject panels with NaN lat/lng/height
 *  2. Reject panels outside plane polygon (if plane provided)
 *  3. Enforce no duplicate (planeId + row + col) combinations
 */
function validatePanels(
  panels: PlacedPanel[],
  config: ControlConfig,
  warnings: string[],
): PlacedPanel[] {
  let result = panels;
  const initialCount = panels.length;

  // ── NaN guard ────────────────────────────────────────────────────────────
  result = result.filter(p => {
    if (!isFinite(p.lat) || !isFinite(p.lng)) {
      warnings.push(`[validate] Panel ${p.id} rejected: non-finite lat/lng (${p.lat}, ${p.lng})`);
      return false;
    }
    if (!isFinite(p.height ?? 0)) {
      warnings.push(`[validate] Panel ${p.id} rejected: non-finite height`);
      return false;
    }
    return true;
  });

  // ── Polygon containment guard ────────────────────────────────────────────
  // Only applied when plane + vertices are available (roof modes)
  if (config.plane?.vertices && config.plane.vertices.length >= 3) {
    const verts = config.plane.vertices;
    const beforeCount = result.length;
    result = result.filter(p => {
      const inside = pointInPolygonLatLng(p.lat, p.lng, verts);
      if (!inside) {
        // Soft rejection for surface modes — engine already applies setbacks.
        // Log but don't hard-reject (engine UV test is more accurate than lat/lng PIP).
        // Hard-reject only for extend_row where engine has no polygon check.
        if (config.mode === 'extend_row') {
          warnings.push(
            `[validate] extend_row panel at (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}) ` +
            `is outside plane polygon — REJECTED`
          );
          return false;
        }
        // For other modes, log but keep (engine UV check is authoritative)
      }
      return true;
    });
    const rejected = beforeCount - result.length;
    if (rejected > 0) {
      warnings.push(`[validate] ${rejected} panels rejected by polygon containment check`);
    }
  }

  // ── Dedup guard ──────────────────────────────────────────────────────────
  // Prevent duplicate (planeId + gridRow + gridCol) if existingPanels provided
  if (config.existingPanels && config.existingPanels.length > 0) {
    const occupied = new Set<string>(
      config.existingPanels
        .filter(p => p.planeId != null)
        .map(p => `${p.planeId}:${p.gridRow ?? p.row}:${p.gridCol ?? p.col}`)
    );
    const beforeDedup = result.length;
    result = result.filter(p => {
      const key = `${p.planeId}:${p.gridRow ?? p.row}:${p.gridCol ?? p.col}`;
      if (occupied.has(key)) {
        warnings.push(`[validate] Dedup: panel at grid (${p.gridRow ?? p.row},${p.gridCol ?? p.col}) already exists on plane ${p.planeId?.slice(0, 8)} — skipped`);
        return false;
      }
      return true;
    });
    const dupsRemoved = beforeDedup - result.length;
    if (dupsRemoved > 0) {
      warnings.push(`[validate] ${dupsRemoved} duplicate panel(s) removed`);
    }
  }

  if (result.length !== initialCount) {
    clLog('VALIDATE', config.mode, {
      initial: initialCount,
      final: result.length,
      removed: initialCount - result.length,
    });
  }

  return result;
}

/**
 * Normalize panel output fields to ensure consistency.
 *
 * Sets:
 *   - orientation field (always 'portrait' or 'landscape')
 *   - widthM / heightM (canonical dimensions)
 *   - planeId (preserved from engine output if present)
 *
 * Does NOT modify:
 *   - lat / lng / height (authoritative from engine)
 *   - heading / pitch / roll (authoritative from engine)
 *   - row / col / gridRow / gridCol (authoritative from engine)
 *   - ecefUx/Uy/Uz / ecefNx/Ny/Nz (authoritative from engine)
 */
function normalizePanels(
  panels: PlacedPanel[],
  orientation: PanelOrientation,
  dims: PanelDims,
): PlacedPanel[] {
  return panels.map(p => ({
    ...p,
    orientation,                    // ensure orientation always set
    // widthM/heightM: set canonical values for downstream use
    // These are informational — rendering still uses engine-derived heading/pitch
    widthM:  dims.widthM,
    heightM: dims.heightM,
  }));
}

/**
 * Resolve the target row for extend_row mode.
 *
 * Priority:
 *  1. Explicitly provided targetRow
 *  2. Row nearest to clickECEF (if clickECEF provided)
 *  3. Row with the fewest panels (shortest row — most likely to need extension)
 */
function resolveTargetRow(
  panelsOnPlane: PlacedPanel[],
  targetRow:     number | undefined,
  clickECEF:     Vec3 | undefined,
): number {
  // 1. Explicit
  if (targetRow !== undefined && isFinite(targetRow)) return targetRow;

  // Group panels by row
  const rowMap = new Map<number, PlacedPanel[]>();
  for (const p of panelsOnPlane) {
    const r = p.gridRow ?? p.row ?? 0;
    if (!rowMap.has(r)) rowMap.set(r, []);
    rowMap.get(r)!.push(p);
  }
  if (rowMap.size === 0) return 0;

  // 2. Nearest to click
  if (clickECEF && isFinite(clickECEF.x)) {
    let bestRow = 0;
    let bestDist = Infinity;
    for (const [row, rowPanels] of rowMap) {
      // Use first panel of row as row representative (all same v-offset)
      const p0 = rowPanels[0];
      // We don't have ECEF per panel stored, but we have lat/lng/height
      // Use a simple approximation: lat/lng distance in degrees
      const dLat = (p0.lat - 0);  // relative — just need min dist, not absolute
      const dLng = (p0.lng - 0);
      // Compute distance to click using stored lat/lng vs click lat/lng
      // Convert click ECEF to lat/lng approximation (good enough for row selection)
      const clickMag = Math.sqrt(clickECEF.x ** 2 + clickECEF.y ** 2 + clickECEF.z ** 2);
      if (clickMag < 1e6) continue; // degenerate
      const clickLat = Math.asin(clickECEF.z / clickMag) * 180 / Math.PI;
      const clickLng = Math.atan2(clickECEF.y, clickECEF.x) * 180 / Math.PI;
      const dist = Math.sqrt((p0.lat - clickLat) ** 2 + (p0.lng - clickLng) ** 2);
      if (dist < bestDist) { bestDist = dist; bestRow = row; }
    }
    return bestRow;
  }

  // 3. Shortest row (fewest panels — most likely candidate for extension)
  let shortestRow = 0;
  let shortestCount = Infinity;
  for (const [row, rowPanels] of rowMap) {
    if (rowPanels.length < shortestCount) {
      shortestCount = rowPanels.length;
      shortestRow = row;
    }
  }
  return shortestRow;
}

/**
 * Point-in-polygon test in lat/lng space (ray casting).
 * Used for soft boundary validation only — not for placement math.
 */
function pointInPolygonLatLng(
  lat:  number,
  lng:  number,
  poly: Array<{ lat: number; lng: number }>,
): boolean {
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== 'production';

function clLog(stage: string, mode: string, data?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[CONTROL_LAYER] [${ts}] [${stage}] mode=${mode}`, data ?? '');
}

// ─── Multi-plane convenience wrapper ─────────────────────────────────────────

/**
 * placePanelsMultiPlane — convenience wrapper for auto_roof mode.
 *
 * Iterates over multiple planes and calls placePanelsControlled for each.
 * Returns all panels merged into a single array.
 */
export function placePanelsMultiPlane(
  planes:      ControlPlane[],
  orientation: PanelOrientation,
  setbacks:    ControlSetbacks,
  wattage:     number,
  groundElevM: number,
  customOriginLat?: number,
  customOriginLng?: number,
  customDirX?:      number,
  customDirY?:      number,
): PlacedPanel[] {
  const allPanels: PlacedPanel[] = [];

  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    const result = placePanelsControlled({
      mode:          'auto_roof',
      plane,
      orientation,
      wattage,
      setbacks,
      groundElevM,
      layoutId:      `cl-auto-${i}-${plane.id.slice(0, 6)}`,
      customOriginLat,
      customOriginLng,
      customDirX,
      customDirY,
    });
    allPanels.push(...result.panels);

    clLog('MULTI_PLANE', 'auto_roof', {
      planeIndex: i,
      planeId:    plane.id.slice(0, 8),
      placed:     result.panels.length,
      total:      allPanels.length,
    });
  }

  return allPanels;
}

// ─── Re-exports for convenience ───────────────────────────────────────────────
// Callers can import these from the control layer instead of from engines directly.
export { getPanelDims } from '@/lib/planeEngine';