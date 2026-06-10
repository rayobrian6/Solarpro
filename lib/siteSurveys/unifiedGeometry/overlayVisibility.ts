/**
 * Clean-view overlay visibility rules (Priority 4).
 *
 * Pure, dependency-free predicates so the overlay renderer's clean-vs-debug
 * decisions are unit-testable without importing React. DEBUG view must remain
 * behaviorally identical to today — these rules are applied ONLY when the
 * relevant debug toggle is OFF (clean view). They optimize readability, not
 * completeness; debug remains the full truth layer. No geometry is generated or
 * deleted — artifacts are only shown/hidden.
 */

/** Line subtypes that are trusted roof-perimeter/structural lines, shown in
 *  clean view. Raw/intermediate wall lines (wall_bottom_edge, wall_vertical)
 *  are hidden in clean (Commit A). */
export const CLEAN_ROOF_LINE_SUBTYPES: ReadonlySet<string> = new Set([
  'ridge', 'eave', 'rake', 'valley', 'hip',
]);

/** Plane geometry classes (Commit C). */
export const PLANE_CLASSES: ReadonlySet<string> = new Set([
  'roof_plane', 'wall_plane', 'consensus_plane', 'ground_plane',
]);

/** Minimum confidence for a plane to show in clean view (Commit C). Threshold,
 *  not a cap — removes low-confidence plane noise. Tunable. */
export const PLANE_CLEAN_MIN_CONFIDENCE = 60;

/** Max polygon area (fraction of the 0–1000 image) before a plane is treated as
 *  an oversized/full-frame artifact and hidden in clean view (Commit C). */
export const PLANE_CLEAN_MAX_AREA_RATIO = 0.85;

interface Vertex { x: number; y: number }

/** Minimal artifact shape the visibility rules need. */
export interface VisibilityArtifact {
  geometryClass: string;
  lineSubtype?: string | null;
  confidence?: number | null;
  polygon?: { vertices?: Vertex[] | null } | null;
}

/** Shoelace polygon area as a fraction of the 1000×1000 normalized image. */
export function polygonAreaRatio(vertices: Vertex[] | null | undefined): number {
  if (!vertices || vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % vertices.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area / 2) / 1_000_000;
}

/** Commit A — a roof_line is clean-visible only if it's a trusted roof subtype.
 *  Non-line artifacts are unaffected (return true). */
export function isCleanVisibleRoofLine(a: VisibilityArtifact): boolean {
  if (a.geometryClass !== 'roof_line') return true;
  return CLEAN_ROOF_LINE_SUBTYPES.has(a.lineSubtype ?? '');
}

/** Commit B — segmentation masks are hidden in clean view. */
export function isCleanHiddenMask(a: VisibilityArtifact): boolean {
  return a.geometryClass === 'segmentation_mask';
}

/** Commit C — a plane is clean-visible only if it has a real polygon, is not
 *  oversized/full-frame, and clears the confidence threshold. Non-plane
 *  artifacts are unaffected (return true). */
export function isCleanVisiblePlane(a: VisibilityArtifact): boolean {
  if (!PLANE_CLASSES.has(a.geometryClass)) return true;
  const verts = a.polygon?.vertices;
  if (!verts || verts.length < 3) return false;                       // polygon-less
  if (polygonAreaRatio(verts) > PLANE_CLEAN_MAX_AREA_RATIO) return false; // oversized/full-frame
  if ((a.confidence ?? 0) < PLANE_CLEAN_MIN_CONFIDENCE) return false; // low-confidence
  return true;
}
