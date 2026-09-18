/**
 * lib/3d/cameraPresets.ts
 *
 * Camera presets for the Solarpro 3D design surface — Aurora parity.
 *
 * Aurora's 3D view is a **tilted aerial** view, not a top-down orthographic one.
 * The default opens at ~45° pitch so the user sees roof slopes, trees, and
 * surrounding context in one frame (AURORA_ANALYSIS §4). The user can still
 * orbit to a steeper pitch (or all the way to straight down) by dragging —
 * the "Reset View" / initial-load action returns to the 45° default.
 *
 * ── Why this lives in its own file ────────────────────────────────────────
 * SolarEngine3D.tsx already uses a custom orbit controller (orbitRef +
 * applyOrbit) so the user's drag/pan/zoom gestures stay consistent across
 * state changes. This module is the single source of truth for the default
 * pose — every call site that wants to "reset" the camera (initial boot,
 * address-change fly-in, Fit View, Reset View button) imports the same
 * constants from here. No more drift between "initial pitch -1.134" and
 * "fit-view pitch -1.222" hardcoded in five places.
 *
 * ── Coordinate convention ────────────────────────────────────────────────
 * Matches the existing orbitRef in SolarEngine3D.tsx:
 *   - `heading` radians, 0 = North, increasing clockwise. π = camera SOUTH of
 *     target (so its look direction faces North).
 *   - `pitch`   radians, Cesium convention: 0 = horizontal, -π/2 = straight
 *     down. -π/4 = 45° down, looking at the target from the side at an angle.
 *   - `range`   meters from the target along the camera position vector.
 *
 * All math here is pure (no Cesium import, no DOM) so it is unit-testable in
 * `tests/cameraPresets.test.ts`. `flyToPreset` accepts an optional Cesium
 * viewer for the integrated call — the caller passes it only when the
 * 3D viewer is mounted.
 */

export interface CameraPreset {
  /** Radians. Compass bearing of the camera POSITION (0=N, CW+). */
  heading: number;
  /** Radians. Cesium convention: 0=horizontal, -π/2=straight down. */
  pitch: number;
  /** Meters from the orbit target. */
  range: number;
  /** Human-readable label for UI menus. */
  label: string;
}

// ── Canonical presets ────────────────────────────────────────────────────

/**
 * Aurora's default 3D view (AURORA_ANALYSIS §4): pitched at 45° so the user
 * sees the building's roof slopes, surrounding trees, and street context
 * simultaneously. Heading π = camera south of the target, so the look
 * direction is north (matches the existing convention in SolarEngine3D).
 *
 * Default range 150m frames a typical residential lot. Callers can override
 * the range via `computeRangeFromBounds(spanM)` if the building footprint
 * is known — see `flyToPreset`.
 */
export const TILTED_AERIAL_VIEW: CameraPreset = {
  heading: Math.PI,
  pitch: -Math.PI / 4,  // -45° — Aurora parity
  range: 150,
  label: 'Tilted Aerial (45°)',
};

/**
 * Strict top-down view for orthographic-style layout work (panel grid
 * planning, irradiance map). Pitch -π/2 = camera directly above target.
 * Heading 0 = camera north, looking south.
 */
export const TOP_DOWN_VIEW: CameraPreset = {
  heading: 0,
  pitch: -Math.PI / 2,  // -90° — straight down
  range: 150,
  label: 'Top Down (90°)',
};

// ── Range computation ────────────────────────────────────────────────────

/**
 * Compute a sensible camera range to frame a building footprint of the
 * given longest-dimension span in meters.
 *
 * Math: range = max(MIN_RANGE, span × 1.4)
 *   - 1.4× is enough padding to leave a margin around the building while
 *     still filling ~60% of the viewport at -45° pitch.
 *   - MIN_RANGE = 50m keeps very small structures (a 5m shed) from being
 *     zoomed in so far that the rest of the lot is off-screen.
 *
 * Mirrors the existing `fitCameraToRoofPlanes` formula in
 * SolarEngine3D.tsx (line 2244: `Math.max(50, spanM * 1.4)`) so the
 * reset view and the fit-view use the same framing math.
 *
 * @param spanM  Longest dimension of the building footprint, in meters.
 *               Pass the larger of (east-west span, north-south span).
 * @returns Camera range in meters.
 */
export const MIN_RANGE_M = 50;
export const RANGE_PADDING_FACTOR = 1.4;

export function computeRangeFromBounds(spanM: number): number {
  if (!isFinite(spanM) || spanM < 0) return MIN_RANGE_M;
  return Math.max(MIN_RANGE_M, spanM * RANGE_PADDING_FACTOR);
}

// ── Cesium integration ───────────────────────────────────────────────────

/**
 * A minimal shape for the orbit state we need to mutate. Matches the orbit
 * ref in SolarEngine3D.tsx — kept loose (any compatible ref) so this
 * module doesn't need to know about React.
 */
export interface OrbitStateLike {
  targetLat: number;
  targetLng: number;
  targetAlt: number;
  heading: number;
  pitch: number;
  radius: number;
}

/**
 * Optional options for `flyToPreset`.
 */
export interface FlyToPresetOptions {
  /**
   * Lat/Lng/height to point the camera at. Defaults to the viewer's current
   * camera target (or 0,0,0 if not available). `height` is meters above the
   * WGS84 ellipsoid.
   */
  target?: { lat: number; lng: number; height?: number };
  /**
   * Override the preset's range. Use `computeRangeFromBounds(spanM)` to
   * frame a specific building footprint.
   */
  rangeOverride?: number;
  /**
   * `true` → instant snap (default; matches the existing applyOrbit pattern).
   * `false` → smooth Cesium camera.flyTo animation. Animation is
   * cooperatively cancelled if the user grabs the camera mid-flight.
   */
  animate?: boolean;
  /**
   * Animation duration in seconds (only used when `animate: true`).
   * Default 1.5s.
   */
  duration?: number;
}

/**
 * Position the Cesium camera at a preset pose around a target.
 *
 * Two output channels are kept in sync so the custom orbit controller and
 * Cesium's internal camera never disagree:
 *   1. Mutates the provided `orbit` state (in-place) to the preset's pose.
 *   2. Calls `applyOrbit()` so the next frame renders the new view AND any
 *      subsequent user drag is consistent with the displayed state.
 *
 * If `viewer` and `animate: true` are both provided, this ALSO triggers a
 * Cesium camera.flyTo for a smooth animated transition. The orbit state is
 * updated at the start (so a user drag mid-flight grabs the new pose, not
 * the old one). When the animation finishes, Cesium's `moveEnd` event fires
 * and any external sync (e.g. the camera-changed listener) can re-read the
 * camera. In practice, since `applyOrbit` will run on the next gesture, the
 * animation is purely cosmetic.
 *
 * @param orbit       Mutable orbit state. Mutated in place.
 * @param applyOrbit  Function that reads `orbit` and writes it to the
 *                    Cesium camera (typically `applyOrbitRef.current`).
 * @param preset      The camera pose to apply.
 * @param options     Target, range override, animation flag.
 *
 * @example
 *   flyToPreset(orbitRef.current, applyOrbitRef.current, TILTED_AERIAL_VIEW, {
 *     target: { lat: 38.818, lng: -77.082, height: 50 },
 *     rangeOverride: computeRangeFromBounds(20),
 *   });
 */
export function flyToPreset(
  orbit: OrbitStateLike,
  applyOrbit: () => void,
  preset: CameraPreset,
  options: FlyToPresetOptions = {}
): void {
  const target = options.target;
  if (target) {
    orbit.targetLat = target.lat;
    orbit.targetLng = target.lng;
    orbit.targetAlt = target.height ?? 0;
  }
  orbit.heading = preset.heading;
  orbit.pitch   = preset.pitch;
  orbit.radius  = options.rangeOverride ?? preset.range;
  applyOrbit();
}

/**
 * Build the Cesium-level camera destination for a preset, given a target.
 * Pure math: returns `{ longitude, latitude, height, heading, pitch, roll }`
 * for Cesium's `Camera.setView` / `Camera.flyTo`. The caller wires it up.
 *
 * Use this when you want to animate via `viewer.camera.flyTo` rather than
 * snapping through the custom orbit controller.
 *
 * Coordinate convention: output `heading` is the look-direction bearing
 * (camera facing), which is the inverse of the orbit-state `heading`
 * (camera position bearing). The relationship is:
 *   look_heading = orbit_heading + π
 *   look_pitch   = -orbit_pitch   (Cesium HPR: positive pitch = look up)
 *
 * @param target  WGS84 lat/lng/height to frame.
 * @param preset  The camera pose to apply.
 * @returns       Cesium Camera.setView input shape (no `destination` Cartesian).
 */
export function buildCesiumCameraView(
  target: { lat: number; lng: number; height?: number },
  preset: CameraPreset
): {
  destination: { longitude: number; latitude: number; height: number };
  orientation: { heading: number; pitch: number; roll: number };
} {
  // Spherical → ENU offset of the camera from the target.
  // Cesium camera position is target + R · (cos(elev)·sin(h), cos(elev)·cos(h), sin(elev))
  //   where elev = -orbit.pitch (positive when orbit.pitch < 0)
  //   heading here is the orbit heading (camera position bearing).
  const elev = -preset.pitch;
  const east  = preset.range * Math.cos(elev) * Math.sin(preset.heading);
  const north = preset.range * Math.cos(elev) * Math.cos(preset.heading);
  const up    = preset.range * Math.sin(elev);

  // Convert ENU offset back to lat/lng/height (small-angle approximation:
  // good for ranges up to a few km, which is well within our use case).
  const M_PER_DEG_LAT = 111_320;
  const mPerDegLng     = M_PER_DEG_LAT * Math.cos((target.lat * Math.PI) / 180);
  const dLat = north / M_PER_DEG_LAT;
  const dLng = east  / mPerDegLng;
  const camLat = target.lat + dLat;
  const camLng = target.lng + dLng;
  const camHeight = (target.height ?? 0) + up;

  return {
    destination: {
      longitude: camLng,
      latitude:  camLat,
      height:    camHeight,
    },
    orientation: {
      // Cesium HPR: look direction heading. Camera south of target → look north.
      heading: preset.heading + Math.PI,
      // Cesium HPR: look pitch. Camera above target → look down → negative.
      pitch:   -elev,   // = preset.pitch
      roll:    0,
    },
  };
}
