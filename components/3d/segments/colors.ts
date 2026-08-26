/**
 * components/3d/segments/colors.ts
 *
 * Per-face outline color palette + assignment algorithm for the 3D roof
 * design surface. Satisfies the Aurora 2017 "Segments color-coded"
 * parity requirement (see HANDOFF_2026-08-25_AURORA_ANALYSIS.md §3,
 * frames 110 / 115 / 120).
 *
 * Aurora reference: each roof face gets a distinct outline color from a
 * fixed 4-color palette. Edges of the same face share that color, so
 * you can visually group edges into a roof plane. Palette is sampled
 * from the Aurora frames (red / yellow / green / blue in that order).
 *
 * This file is PURE — no DOM, no Cesium, no module-level state, no
 * side effects. The integrator (SolarEngine3D.tsx / lib/roofPlane3D.ts
 * at integration time) reads the Map returned by assignFaceColors()
 * and applies each color at the polygon.outlineColor site. The
 * algorithm itself never touches the 3D scene.
 *
 * Coordination contract: see components/3d/segments/SHARED.md.
 * Design rationale: see components/3d/segments/COLORS.md.
 */

/**
 * The 4-color face outline palette, in assignment order.
 *
 * Index 0 → first face in the input array → red.
 * Index 1 → second face → yellow.
 * Index 2 → third face → green.
 * Index 3 → fourth face → blue.
 *
 * Values are sampled byte-for-byte from the Aurora 2017 reference
 * frames in `aurora_frames/frame_0110.jpg`, `frame_0115.jpg`, and
 * `frame_0120.jpg`. Do NOT adjust them without re-sampling the source.
 */
export const FACE_COLORS: readonly string[] = Object.freeze([
  '#E63E2A', // 0 — red
  '#F2C641', // 1 — yellow
  '#3DAA5C', // 2 — green
  '#3A7BD5', // 3 — blue
]);

/** Length of the palette. Exposed so callers don't hardcode 4 elsewhere. */
export const FACE_COLORS_LENGTH: number = FACE_COLORS.length;

/**
 * Default outline width in CSS pixels for an unselected face.
 * Exposed here (not in arrows.ts) because it applies to the polygon
 * outline, which is the color agent's territory. The selected-face
 * width (3px) is the integrator's choice and not re-exported.
 */
export const EDGE_OUTLINE_WIDTH_PX: number = 2;

/**
 * Minimal structural type for a face. A real `RoofPlane` (from
 * `types/index.ts`) is assignable to this — we accept the structural
 * minimum so the segments module does not take a hard dependency on
 * the full plane type. This is the contract the arrows agent also
 * consumes; see SHARED.md.
 */
export interface SegmentFace {
  readonly id: string;
}

/**
 * Returns the palette color for a given zero-based face index.
 *
 * Cycles through FACE_COLORS in order. Negative indices wrap
 * gracefully — `colorForIndex(-1)` returns the last palette entry
 * (blue), matching the modular-arithmetic intuition.
 *
 * @param index Zero-based face index. May be any integer.
 * @returns A hex color string from FACE_COLORS, in cycle order.
 */
export function colorForIndex(index: number): string {
  // Manual mod for negative-safe behavior: ((n % m) + m) % m
  // For typical non-negative indices this collapses to n % m.
  const len = FACE_COLORS.length;
  const safeIndex = ((index % len) + len) % len;
  return FACE_COLORS[safeIndex];
}

/**
 * Assigns an outline color to every face in `faces`, in the order
 * they appear. The first face gets FACE_COLORS[0], the second gets
 * FACE_COLORS[1], and so on. After 4 faces the palette cycles.
 *
 * The output is a `Map` so callers can do O(1) lookup by faceId.
 * The Map is mutable (for caller convenience) but logically
 * read-only — do not add or remove entries.
 *
 * **Stability contract:** if `faces` does not change between calls
 * (same array, same order, same ids), the returned Map assigns the
 * same color to each id. This is how the renderer avoids color
 * flicker on re-render.
 *
 * **Duplicate ids:** if two entries in `faces` share the same id,
 * the last one wins. This is deterministic but almost always
 * indicates a bug upstream — the integrator should de-duplicate
 * roof planes before passing them in.
 *
 * @param faces Array of face objects, in assignment order.
 * @returns Map from faceId to hex color string.
 */
export function assignFaceColors(
  faces: readonly SegmentFace[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    if (face === undefined) continue; // satisfies noUncheckedIndexedAccess
    map.set(face.id, colorForIndex(i));
  }
  return map;
}

/**
 * Returns the outline color for a single face, given the list of
 * known faces. Throws if `faceId` is not in `knownFaces` — silent
 * fallbacks would hide integration bugs (e.g., a stale id from a
 * deleted plane that the caller forgot to remove from a ref).
 *
 * For repeated lookups in a render loop, prefer `assignFaceColors`
 * to avoid re-scanning the array per face.
 *
 * @param faceId The id of the face to look up.
 * @param knownFaces The full list of faces (same array you would
 *                   pass to `assignFaceColors`).
 * @returns The face's hex color string.
 * @throws Error if `faceId` is not present in `knownFaces`.
 */
export function getFaceColor(
  faceId: string,
  knownFaces: readonly SegmentFace[],
): string {
  for (let i = 0; i < knownFaces.length; i++) {
    const face = knownFaces[i];
    if (face === undefined) continue;
    if (face.id === faceId) {
      return colorForIndex(i);
    }
  }
  throw new Error(
    `[segment-colors] getFaceColor: faceId "${faceId}" not found in ` +
      `knownFaces (${knownFaces.length} face(s)). Pass the same faces ` +
      `list you would pass to assignFaceColors().`,
  );
}
