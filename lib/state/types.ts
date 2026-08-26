/**
 * lib/state/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scene state + Action discriminated unions for the Aurora-style
 * Save / Undo / Redo ring-buffer history.
 *
 * Scope (see lib/state/DESIGN.md):
 *   - "Primitives" = the full set of drawable scene elements that
 *     Solarpro's 3D surface places today (block, gable, hip, tree, obstruction)
 *     plus the panel group.
 *   - The store does not interpret a primitive's fields. It treats them as
 *     opaque, serializable data and re-emits them on undo/redo.
 *   - `SceneState.view` carries the small, free-form UI flags that
 *     participate in undo (placement mode + 3D-primitive input values).
 *
 * Why a discriminated union and not a generic Map<string, any>?
 *   - The union is the *contract* with the rest of Solarpro — anything that
 *     dispatches through this store is statically constrained.
 *   - The store can dedupe by id at the type level (a `BlockPrimitive` is
 *     never a `TreePrimitive`).
 */

'use client';

// ─── Primitives ──────────────────────────────────────────────────────────────

export type PrimitiveKind =
  | 'block'
  | 'gable'
  | 'hip'
  | 'tree'
  | 'obstruction'
  | 'panels';

export interface BasePrimitive {
  /** Stable, unique id within the scene. */
  id: string;
  /** Discriminator — matches one of PrimitiveKind. */
  kind: PrimitiveKind;
  /** Epoch ms at creation. Used for stable ordering + audit. */
  createdAt: number;
}

/**
 * Block — a line-traced polygon extruded into a 3D prism. Used for
 * buildings where Google 3D Tiles has no coverage.
 */
export interface BlockPrimitive extends BasePrimitive {
  kind: 'block';
  /** Footprint vertices in [lng, lat] order (GeoJSON convention). */
  vertices: Array<{ lng: number; lat: number }>;
  /** Eave height in meters above the terrain. */
  eaveHeightM: number;
  /** Optional label shown in the 3D Primitives panel. */
  label?: string;
}

/** Gable roof — 2 eave corners, 2 sloped faces meeting at a ridge. */
export interface GablePrimitive extends BasePrimitive {
  kind: 'gable';
  /** Two eave corner points (GeoJSON [lng, lat]). */
  eaves: [
    { lng: number; lat: number },
    { lng: number; lat: number },
  ];
  /** Eave height in meters. */
  eaveHeightM: number;
  /** Roof pitch in degrees (e.g. 30 = 6:12). */
  pitchDeg: number;
  label?: string;
}

/** Hip roof — 2 eave corners, 4 sloped faces meeting at a shorter ridge. */
export interface HipPrimitive extends BasePrimitive {
  kind: 'hip';
  eaves: [
    { lng: number; lat: number },
    { lng: number; lat: number },
  ];
  eaveHeightM: number;
  pitchDeg: number;
  label?: string;
}

/** Decorative tree — green sphere on a brown trunk. */
export interface TreePrimitive extends BasePrimitive {
  kind: 'tree';
  lng: number;
  lat: number;
  /** Trunk height in meters. */
  trunkHeightM: number;
  /** Canopy radius in meters. */
  canopyRadiusM: number;
  label?: string;
}

/** Obstruction (vent, skylight, chimney, etc.) — excludes nearby panels. */
export interface ObstructionPrimitive extends BasePrimitive {
  kind: 'obstruction';
  lng: number;
  lat: number;
  /** Height above ellipsoid (meters). */
  height: number;
  /** Exclusion radius in meters. */
  radiusM: number;
  type: 'vent' | 'skylight' | 'chimney' | 'hvac' | 'other';
  label?: string;
}

/**
 * Panel group — references the array of PlacedPanel IDs that belong to
 * this design. We don't duplicate PlacedPanel here (that would blow up the
 * snapshot size); the surface owns the canonical panel list and looks up
 * by id at render time.
 */
export interface PanelGroupPrimitive extends BasePrimitive {
  kind: 'panels';
  panelIds: string[];
  /** Free-form metadata (system type, system size, etc.) for the group. */
  meta?: Record<string, unknown>;
  label?: string;
}

export type Primitive =
  | BlockPrimitive
  | GablePrimitive
  | HipPrimitive
  | TreePrimitive
  | ObstructionPrimitive
  | PanelGroupPrimitive;

// ─── Scene state ─────────────────────────────────────────────────────────────

/**
 * The full state that the history buffer snapshots. Designed to be
 * JSON-serializable end-to-end (used for both the dirty comparison and
 * the future Save endpoint).
 */
export interface SceneState {
  /** Every primitive currently in the design. */
  primitives: Primitive[];
  /** Currently selected primitive, or null. */
  selectedId: string | null;
  /** Free-form UI flags that participate in undo. Kept small on purpose. */
  view: SceneView;
}

export interface SceneView {
  /** Active placement mode (matches the union in SolarEngine3D). */
  placementMode: string;
  /** Slider value for "New block eave" (meters). */
  newBlockEaveHeightM: number;
  /** Slider value for "New roof eave" (meters). */
  newRoofEaveHeightM: number;
  /** Slider value for "New roof pitch" (degrees). */
  newRoofPitchDeg: number;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Closed set of mutations the store understands. Anything more exotic
 * (compound operations) should use `BULK` to ship a fully formed state.
 */
export type Action =
  | { type: 'ADD'; primitive: Primitive }
  | { type: 'REMOVE'; id: string }
  | { type: 'MOVE'; id: string; to: { lat: number; lng: number } }
  | { type: 'UPDATE'; id: string; patch: Partial<Primitive> }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SET_VIEW'; patch: Partial<SceneView> }
  | { type: 'BULK'; state: SceneState };

/**
 * Factory for a fresh SceneState. The default view mirrors the
 * "select" mode + a 6m eave + 30° pitch — typical starting values.
 */
export function createEmptySceneState(): SceneState {
  return {
    primitives: [],
    selectedId: null,
    view: {
      placementMode: 'select',
      newBlockEaveHeightM: 6,
      newRoofEaveHeightM: 6,
      newRoofPitchDeg: 30,
    },
  };
}
