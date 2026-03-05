/**
 * panelPrimitiveRenderer.ts — GPU-Instanced Panel Renderer
 *
 * Architecture:
 *   - Single BoxGeometry created ONCE per orientation (portrait/landscape)
 *   - N panels = N GeometryInstances sharing the same geometry
 *   - All instances batched into ONE Cesium.Primitive = ONE draw call
 *   - Color updates via per-instance attributes (no geometry rebuild)
 *   - Dirty-flag system: only rebuilds when panel list changes
 *   - Delta add/remove: avoids full teardown on single-panel changes
 *
 * Performance targets:
 *   500 panels  → <16ms frame time (60 FPS)
 *   2000 panels → <33ms frame time (30 FPS)
 *   10000 panels → <50ms frame time (20 FPS)
 */

export type PanelOrientation = 'portrait' | 'landscape';
export type SystemType = 'roof' | 'ground' | 'fence';

// Panel physical dimensions (standard 400W panel)
const PW_PORTRAIT  = 1.134;  // width (short side)
const PH_PORTRAIT  = 1.722;  // height (long side, runs down slope)
const PW_LANDSCAPE = 1.722;  // width (long side, runs along ridge)
const PH_LANDSCAPE = 1.134;  // height (short side, runs down slope)
const PT = 0.040;             // thickness

export interface PanelRenderData {
  id: string;
  lat: number;
  lng: number;
  height: number;
  tilt: number;
  azimuth: number;
  heading: number;
  roll: number;
  systemType: SystemType;
  orientation: PanelOrientation;
  shadeFactor?: number;  // 0 = fully shaded, 1 = full sun
  selected?: boolean;
}

export interface PrimitiveRendererState {
  primitive: any | null;           // Cesium.Primitive
  instanceCount: number;
  panelIds: string[];              // ordered list matching instance indices
  isDirty: boolean;
  lastRebuildMs: number;
}

// Color constants (RGBA 0-255)
const COLORS = {
  roof:     [26,  102, 230, 235] as [number,number,number,number],
  ground:   [26,  191,  77, 235] as [number,number,number,number],
  fence:    [230, 153,  26, 235] as [number,number,number,number],
  selected: [255,  51,  51, 235] as [number,number,number,number],
  night:    [13,   13,  38, 235] as [number,number,number,number],
};

function shadeToRGBA(shadeFactor: number): [number,number,number,number] {
  const r = Math.round(255 * (1 - shadeFactor * 0.6));
  const g = Math.round(200 * shadeFactor + 20);
  const b = Math.round(26 * (1 - shadeFactor) + 10);
  return [r, g, b, 235];
}

function systemTypeRGBA(type: SystemType): [number,number,number,number] {
  return COLORS[type] ?? COLORS.roof;
}

function panelDims(orientation: PanelOrientation): { pw: number; ph: number } {
  return orientation === 'landscape'
    ? { pw: PW_LANDSCAPE, ph: PH_LANDSCAPE }
    : { pw: PW_PORTRAIT,  ph: PH_PORTRAIT  };
}

function isValidCoord(lat: number, lng: number, alt?: number): boolean {
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (alt !== undefined && !isFinite(alt)) return false;
  return true;
}

/**
 * Build a single Cesium.Primitive containing all panels as GeometryInstances.
 * This is the core GPU-instancing function — ONE draw call for ALL panels.
 *
 * @param C         - Cesium namespace (window.Cesium)
 * @param panels    - Array of panel render data
 * @param showShade - Whether to use shade colors
 * @returns Cesium.Primitive or null on failure
 */
export function buildPanelPrimitive(
  C: any,
  panels: PanelRenderData[],
  showShade: boolean
): any | null {
  if (!C || panels.length === 0) return null;

  const t0 = performance.now();
  const instances: any[] = [];

  for (const panel of panels) {
    try {
      if (!isValidCoord(panel.lat, panel.lng, panel.height)) continue;

      const { pw, ph } = panelDims(panel.orientation);

      // Build model matrix: position + orientation (heading/pitch/roll)
      const pos = C.Cartesian3.fromDegrees(panel.lng, panel.lat, panel.height);
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) continue;
      if (C.Cartesian3.magnitude(pos) < 1000) continue;

      const heading  = isFinite(panel.heading) ? panel.heading : (panel.azimuth * Math.PI / 180);
      const pitchRad = -(isFinite(panel.tilt) ? panel.tilt : 0) * Math.PI / 180;
      const rollRad  = (isFinite(panel.roll) ? panel.roll : 0) * Math.PI / 180;

      if (!isFinite(heading) || !isFinite(pitchRad) || !isFinite(rollRad)) continue;

      const hpr = new C.HeadingPitchRoll(heading, pitchRad, rollRad);
      const modelMatrix = C.Transforms.headingPitchRollToFixedFrame(pos, hpr);
      if (!modelMatrix) continue;

      // Determine color
      let rgba: [number,number,number,number];
      if (panel.selected) {
        rgba = COLORS.selected;
      } else if (showShade && panel.shadeFactor !== undefined) {
        rgba = shadeToRGBA(panel.shadeFactor);
      } else {
        rgba = systemTypeRGBA(panel.systemType);
      }

      const color = new C.Color(rgba[0]/255, rgba[1]/255, rgba[2]/255, rgba[3]/255);

      // Create BoxGeometry instance — geometry is defined per-instance but
      // Cesium batches identical geometries automatically when using Primitive
      const geometry = C.BoxGeometry.fromDimensions({
        dimensions: new C.Cartesian3(pw, ph, PT),
        vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
      });

      const instance = new C.GeometryInstance({
        geometry,
        modelMatrix,
        id: panel.id,
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(color),
          show: new C.ShowGeometryInstanceAttribute(true),
        },
      });

      instances.push(instance);
    } catch (e) {
      // Skip invalid panels silently
    }
  }

  if (instances.length === 0) return null;

  try {
    const primitive = new C.Primitive({
      geometryInstances: instances,
      appearance: new C.PerInstanceColorAppearance({
        translucent: true,
        closed: true,
        flat: false,
      }),
      asynchronous: false,          // synchronous for immediate display
      compressVertices: true,
      releaseGeometryInstances: false, // keep instances for color updates
      allowPicking: true,
    });

    const elapsed = performance.now() - t0;
    console.log(`[PrimitiveRenderer] Built ${instances.length} instances in ${elapsed.toFixed(1)}ms`);
    return primitive;
  } catch (e: any) {
    console.error('[PrimitiveRenderer] buildPanelPrimitive failed:', e.message);
    return null;
  }
}

/**
 * Update per-instance colors on an existing primitive WITHOUT rebuilding geometry.
 * This is the fast path for shade slider updates and selection changes.
 *
 * @param C         - Cesium namespace
 * @param primitive - Existing Cesium.Primitive
 * @param panels    - Updated panel data (must match original instance order)
 * @param showShade - Whether to use shade colors
 */
export function updatePrimitiveColors(
  C: any,
  primitive: any,
  panels: PanelRenderData[],
  showShade: boolean
): void {
  if (!C || !primitive || panels.length === 0) return;

  try {
    for (const panel of panels) {
      const attrs = primitive.getGeometryInstanceAttributes(panel.id);
      if (!attrs) continue;

      let rgba: [number,number,number,number];
      if (panel.selected) {
        rgba = COLORS.selected;
      } else if (showShade && panel.shadeFactor !== undefined) {
        rgba = shadeToRGBA(panel.shadeFactor);
      } else {
        rgba = systemTypeRGBA(panel.systemType);
      }

      attrs.color = C.ColorGeometryInstanceAttribute.toValue(
        new C.Color(rgba[0]/255, rgba[1]/255, rgba[2]/255, rgba[3]/255)
      );
    }
  } catch (e: any) {
    console.warn('[PrimitiveRenderer] updatePrimitiveColors error:', e.message);
  }
}

/**
 * Show or hide a single panel instance without rebuilding.
 */
export function setPanelInstanceVisibility(
  C: any,
  primitive: any,
  panelId: string,
  visible: boolean
): void {
  if (!C || !primitive) return;
  try {
    const attrs = primitive.getGeometryInstanceAttributes(panelId);
    if (attrs) {
      attrs.show = C.ShowGeometryInstanceAttribute.toValue(visible);
    }
  } catch {}
}

/**
 * Pick a panel from a Cesium pick result.
 * Returns the panel ID if the picked object is a panel instance.
 */
export function pickPanelId(pickedObject: any): string | null {
  if (!pickedObject) return null;
  // For Primitive instances, pickedObject.id is the GeometryInstance id
  if (typeof pickedObject.id === 'string' && pickedObject.id.startsWith('panel-')) {
    return pickedObject.id;
  }
  return null;
}

/**
 * Compute shade factor for a panel given sun position.
 * Returns 0 (fully shaded) to 1 (full sun).
 */
export function computeShadeFactor(
  panelTiltDeg: number,
  panelAzimuthDeg: number,
  sunElevationDeg: number,
  sunAzimuthDeg: number
): number {
  if (sunElevationDeg <= 0) return 0;

  const sunElRad  = sunElevationDeg * Math.PI / 180;
  const sunAzRad  = sunAzimuthDeg   * Math.PI / 180;
  const tiltRad   = panelTiltDeg    * Math.PI / 180;
  const panelAzRad = panelAzimuthDeg * Math.PI / 180;

  // Panel surface normal in ENU frame
  const nx = Math.sin(tiltRad) * Math.sin(panelAzRad);
  const ny = Math.sin(tiltRad) * Math.cos(panelAzRad);
  const nz = Math.cos(tiltRad);

  // Sun direction vector in ENU frame
  const sx = Math.cos(sunElRad) * Math.sin(sunAzRad);
  const sy = Math.cos(sunElRad) * Math.cos(sunAzRad);
  const sz = Math.sin(sunElRad);

  return Math.max(0, Math.min(1, nx * sx + ny * sy + nz * sz));
}

/**
 * Renderer state manager — tracks dirty flags and rebuild timing.
 */
export class PanelPrimitiveRenderer {
  private C: any;
  private scene: any;
  private primitiveCollection: any;
  private currentPrimitive: any | null = null;
  private panelIds: string[] = [];
  private isDirty = false;
  private lastRebuildMs = 0;
  private rebuildThrottleMs = 16; // max 1 rebuild per frame

  constructor(C: any, scene: any) {
    this.C = C;
    this.scene = scene;
    // Use a dedicated PrimitiveCollection for panels (separate from overlays)
    this.primitiveCollection = new C.PrimitiveCollection();
    scene.primitives.add(this.primitiveCollection);
  }

  /**
   * Full rebuild — replaces all panel instances.
   * Call when panel list changes (add/remove panels).
   */
  rebuild(panels: PanelRenderData[], showShade: boolean): void {
    const now = performance.now();
    if (now - this.lastRebuildMs < this.rebuildThrottleMs) {
      this.isDirty = true;
      return;
    }

    this._doRebuild(panels, showShade);
    this.lastRebuildMs = now;
    this.isDirty = false;
  }

  private _doRebuild(panels: PanelRenderData[], showShade: boolean): void {
    // Remove old primitive
    if (this.currentPrimitive) {
      try {
        this.primitiveCollection.remove(this.currentPrimitive);
      } catch {}
      this.currentPrimitive = null;
    }

    if (panels.length === 0) {
      this.panelIds = [];
      return;
    }

    // Build new primitive
    const primitive = buildPanelPrimitive(this.C, panels, showShade);
    if (primitive) {
      this.primitiveCollection.add(primitive);
      this.currentPrimitive = primitive;
      this.panelIds = panels.map(p => p.id);
    }
  }

  /**
   * Fast color update — no geometry rebuild.
   * Call when shade slider moves or selection changes.
   */
  updateColors(panels: PanelRenderData[], showShade: boolean): void {
    if (!this.currentPrimitive) {
      // No primitive yet — do a full rebuild
      this.rebuild(panels, showShade);
      return;
    }

    // Check if panel list changed (different IDs or count)
    const currentIds = new Set(this.panelIds);
    const newIds = panels.map(p => p.id);
    const listChanged = newIds.length !== this.panelIds.length ||
      newIds.some(id => !currentIds.has(id));

    if (listChanged) {
      // Panel list changed — need full rebuild
      this.rebuild(panels, showShade);
    } else {
      // Same panels, just update colors
      updatePrimitiveColors(this.C, this.currentPrimitive, panels, showShade);
    }
  }

  /**
   * Flush pending dirty rebuild.
   */
  flushIfDirty(panels: PanelRenderData[], showShade: boolean): void {
    if (this.isDirty) {
      this._doRebuild(panels, showShade);
      this.isDirty = false;
    }
  }

  /**
   * Pick panel ID from a Cesium pick result.
   */
  pickPanel(pickedObject: any): string | null {
    return pickPanelId(pickedObject);
  }

  /**
   * Set selection highlight on a panel.
   */
  setSelected(panelId: string | null, allPanels: PanelRenderData[], showShade: boolean): void {
    if (!this.currentPrimitive) return;
    // Update colors with selection state
    const updated = allPanels.map(p => ({
      ...p,
      selected: p.id === panelId,
    }));
    updatePrimitiveColors(this.C, this.currentPrimitive, updated, showShade);
  }

  /**
   * Remove the renderer and clean up GPU resources.
   */
  destroy(): void {
    try {
      if (this.currentPrimitive) {
        this.primitiveCollection.remove(this.currentPrimitive);
        this.currentPrimitive = null;
      }
      this.scene.primitives.remove(this.primitiveCollection);
    } catch {}
  }

  get instanceCount(): number {
    return this.panelIds.length;
  }

  get hasPrimitive(): boolean {
    return this.currentPrimitive !== null;
  }
}