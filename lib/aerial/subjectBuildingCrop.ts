// ============================================================
// Subject-building crop for Nearmap aerial detection (PURE)
// ============================================================
// Nearmap's AI Feature call returns EVERY roof inside the ~45 m AOI box — the
// subject house plus every neighbour on the block (716 panels in the worst
// case). Design Studio only wants the ONE building the user is designing on.
//
// This module crops the raw Nearmap roof planes down to just the subject
// building using pure geometry — no parcel-data provider required:
//   1. Seed = the roof facet under the subject point (map centre / geocode);
//      if the point lands in a gap, the nearest facet by centroid.
//   2. Grow the seed into a building by facet adjacency — two facets belong to
//      the same building when their outlines come within `adjacencyGapM` of
//      each other (they share a ridge / hip / valley). Union-find the clusters.
//   3. Keep only the seed's cluster; drop the rest of the block.
// Obstructions (vents/chimneys/…) are cropped the same way — kept only if they
// sit on (or within a small margin of) a kept plane.
//
// Fails OPEN: any degenerate input (0/1 plane, no seed found) returns the input
// unchanged, so detection never regresses to zero.
//
// LIMITATION: attached homes (row-houses / party-wall) whose roofs touch within
// `adjacencyGapM` will cluster together. Suburban detached homes (Ray's typical
// use) sit >3 m apart, so the default 1.2 m gap cleanly separates them.

import type { NearmapRoofPlane, NearmapObstruction } from '@/lib/aerial/nearmap';

/** Max gap (m) between two facet outlines to treat them as one building. */
export const DEFAULT_ADJACENCY_GAP_M = 1.2;
/** Keep an obstruction only if within this margin (m) of a kept plane. */
export const DEFAULT_OBSTRUCTION_MARGIN_M = 2.0;

const METERS_PER_DEG_LAT = 111_320;
const DEG_TO_RAD = Math.PI / 180;

export interface CropOptions {
  adjacencyGapM?: number;
  obstructionMarginM?: number;
  /** Hard cap (m): drop any kept facet whose centroid is farther than this from
   *  the subject point, even if adjacency clustering bridged to it. Guards against
   *  spurious/over-segmented planes that land on another building ("elsewhere").
   *  Unset = no cap (the Nearmap AOI crop wants the full connected cluster). */
  maxDistM?: number;
}

export interface CropResult {
  planes: NearmapRoofPlane[];
  /** Indices (into the input array) that were kept. */
  keptIndices: number[];
  /** Index of the seed facet, or null when none could be chosen (fail-open). */
  seedIndex: number | null;
  /** True when a real crop happened (input had >1 building's worth of facets). */
  cropped: boolean;
}

type XY = { x: number; y: number };
type LatLng = { lat: number; lng: number };

/** Equirectangular projector anchored at `ref` → local metres (+x East, +y North). */
function makeProject(ref: LatLng): (p: LatLng) => XY {
  const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(ref.lat * DEG_TO_RAD);
  return (p: LatLng): XY => ({
    x: (p.lng - ref.lng) * mPerDegLng,
    y: (p.lat - ref.lat) * METERS_PER_DEG_LAT,
  });
}

function centroidXY(poly: XY[]): XY {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

/** Ray-cast point-in-polygon (poly is an open or closed ring in local metres). */
function pointInPolygon(pt: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment ab (metres). */
function distPointToSegment(p: XY, a: XY, b: XY): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const apx = p.x - a.x, apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  const cx = a.x + t * abx, cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Min distance from point p to a polygon boundary (metres). */
function distPointToPolygonEdge(p: XY, poly: XY[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distPointToSegment(p, poly[j], poly[i]);
    if (d < min) min = d;
  }
  return min;
}

/** Minimum gap between two polygon outlines (0 if they overlap/touch). */
function polygonGap(a: XY[], b: XY[]): number {
  // Overlap → gap 0 (any vertex of one inside the other).
  if (a.some(pt => pointInPolygon(pt, b)) || b.some(pt => pointInPolygon(pt, a))) return 0;
  let min = Infinity;
  for (const pt of a) { const d = distPointToPolygonEdge(pt, b); if (d < min) min = d; }
  for (const pt of b) { const d = distPointToPolygonEdge(pt, a); if (d < min) min = d; }
  return min;
}

// ── Union-Find ──────────────────────────────────────────────────────────────
class UnionFind {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number {
    while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; }
    return i;
  }
  union(a: number, b: number): void { this.parent[this.find(a)] = this.find(b); }
}

/**
 * Core clustering: given each facet's outline ring (lat/lng) and a subject point,
 * return the indices of the facets belonging to the SINGLE building under the
 * subject. Provider-agnostic — used by both the Nearmap crop and the Design
 * Studio "only my building" fill guard. Fails open (keeps all) on degenerate input.
 */
export function subjectBuildingIndices(
  rings: LatLng[][],
  subject: LatLng,
  opts: CropOptions = {},
): { keptIndices: number[]; seedIndex: number | null; cropped: boolean } {
  const all = { keptIndices: rings.map((_, i) => i), seedIndex: rings.length ? 0 : null, cropped: false };
  if (rings.length <= 1) return all;

  const gap = opts.adjacencyGapM ?? DEFAULT_ADJACENCY_GAP_M;
  const project = makeProject(subject);
  const polys = rings.map(r => r.map(project));
  const subjXY: XY = { x: 0, y: 0 };

  // 1. Seed: facet under the subject point, else nearest facet centroid.
  let seed = polys.findIndex(poly => pointInPolygon(subjXY, poly));
  if (seed === -1) {
    let best = Infinity;
    for (let i = 0; i < polys.length; i++) {
      const c = centroidXY(polys[i]);
      const d = Math.hypot(c.x, c.y);
      if (d < best) { best = d; seed = i; }
    }
  }
  if (seed === -1) return all;

  // 2. Cluster facets into buildings by adjacency.
  const uf = new UnionFind(polys.length);
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (polygonGap(polys[i], polys[j]) <= gap) uf.union(i, j);
    }
  }

  // 3. Keep only the seed's cluster.
  const seedRoot = uf.find(seed);
  let keptIndices: number[] = [];
  for (let i = 0; i < polys.length; i++) if (uf.find(i) === seedRoot) keptIndices.push(i);

  // 4. Optional hard distance cap from the subject point (0,0 in the local frame)
  //    — drops far spurious/bridged facets that landed on another building.
  if (opts.maxDistM != null) {
    const capped = keptIndices.filter(i => {
      const c = centroidXY(polys[i]);
      return Math.hypot(c.x, c.y) <= opts.maxDistM!;
    });
    if (capped.length > 0) keptIndices = capped;   // never let the cap empty the result
  }

  return { keptIndices, seedIndex: seed, cropped: keptIndices.length < rings.length };
}

/**
 * Filter any array of roof-plane-like objects down to the subject building,
 * given an accessor for each object's lat/lng outline ring. Generic sibling of
 * cropToSubjectBuilding for the Design Studio (RoofPlane.vertices) side.
 */
export function filterToSubjectBuilding<T>(
  items: T[],
  getRing: (item: T) => LatLng[],
  subject: LatLng,
  opts: CropOptions = {},
): { kept: T[]; keptIndices: number[]; cropped: boolean } {
  const { keptIndices, cropped } = subjectBuildingIndices(items.map(getRing), subject, opts);
  return { kept: keptIndices.map(i => items[i]), keptIndices, cropped };
}

/**
 * Crop raw Nearmap roof planes down to the single building under `subject`.
 * Pure — no I/O. Fails open (returns input) on degenerate input.
 */
export function cropToSubjectBuilding(
  planes: NearmapRoofPlane[],
  subject: LatLng,
  opts: CropOptions = {},
): CropResult {
  const { keptIndices, seedIndex, cropped } = subjectBuildingIndices(
    planes.map(p => p.worldPolygon), subject, opts,
  );
  return { planes: keptIndices.map(i => planes[i]), keptIndices, seedIndex, cropped };
}

/**
 * Crop obstructions to just those sitting on (or within `obstructionMarginM` of)
 * one of the kept planes. Returns input unchanged when there are no kept planes
 * (fail-open — never silently drop everything without a roof reference).
 */
export function cropObstructionsToPlanes(
  obstructions: NearmapObstruction[],
  keptPlanes: NearmapRoofPlane[],
  subject: LatLng,
  opts: CropOptions = {},
): NearmapObstruction[] {
  if (obstructions.length === 0 || keptPlanes.length === 0) return obstructions;
  const margin = opts.obstructionMarginM ?? DEFAULT_OBSTRUCTION_MARGIN_M;
  const project = makeProject(subject);
  const planePolys = keptPlanes.map(p => p.worldPolygon.map(project));
  return obstructions.filter(o => {
    if (o.polygon.length === 0) return false;
    const c = centroidXY(o.polygon.map(project));
    return planePolys.some(poly => pointInPolygon(c, poly) || distPointToPolygonEdge(c, poly) <= margin);
  });
}
