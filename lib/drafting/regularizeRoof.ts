// ============================================================
// Roof plan regularizer — squares up hand-traced roof geometry
// lib/drafting/regularizeRoof.ts
//
// Hand-stitched roof planes carry ±1-2 ft vertex noise: eaves that aren't
// straight, a ridge with a dogleg, asymmetric hips. Rendered at plan scale
// that reads as amateur linework (Ray, 2026-07-01). This pass:
//   1. WELDS coincident vertices across facets (shared corners/ridges become
//      one point, so facet borders can no longer disagree),
//   2. finds the building's DOMINANT AXIS (length-weighted edge angles mod 90°),
//   3. SNAPS near-axis edges exactly straight in the rotated frame (both
//      endpoints to their length-weighted mean coordinate; diagonal hips are
//      left alone and inherit clean endpoints),
//   4. caps total vertex displacement (default 2 ft) so regularization can
//      never redraw the building, only tidy it.
//
// Pure + deterministic — operates on fake-degree CAD units (1 unit ≈ 1 ft).
// Display-only: callers regularize a COPY for rendering; stored geometry and
// panel positions are untouched.
// ============================================================

export interface RoofPlaneLike {
  vertices: Array<{ lat: number; lng: number }>;
  [k: string]: unknown;
}

export interface RegularizeOptions {
  /** Vertices closer than this (ft) are welded into one point. */
  weldTolFt?: number;
  /** Edges within this many degrees of the dominant axes get snapped straight. */
  angleSnapDeg?: number;
  /** Max distance (ft) any vertex may move — hard cap on the whole pass. */
  maxShiftFt?: number;
  /** Dominant-axis tilts under this (deg) snap square to the sheet axes. */
  axisAlignDeg?: number;
}

type Pt = { x: number; y: number }; // x=lng, y=lat (1 unit ≈ 1 ft)

export function regularizeRoofPlanes<T extends RoofPlaneLike>(
  planes: T[],
  opts: RegularizeOptions = {},
): T[] {
  const weldTol   = opts.weldTolFt   ?? 1.6;
  const snapDeg   = opts.angleSnapDeg ?? 8;
  const maxShift  = opts.maxShiftFt  ?? 2.0;
  if (!planes.length) return planes;

  // ── 1. Weld: transitive union-find over ALL vertices (order-independent —
  // a running-means pass split real ridge endpoints that chained 1.3 ft apart) ──
  const raw: Pt[] = [];
  const vmap: number[][] = [];             // vmap[pi][vi] = raw point index (then cluster index)
  for (let pi = 0; pi < planes.length; pi++) {
    vmap.push([]);
    for (const v of planes[pi].vertices ?? []) {
      vmap[pi].push(raw.length);
      raw.push({ x: v.lng, y: v.lat });
    }
  }
  const parent = raw.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      if (Math.hypot(raw[i].x - raw[j].x, raw[i].y - raw[j].y) < weldTol) {
        parent[find(i)] = find(j);
      }
    }
  }
  const rootToCluster = new Map<number, number>();
  const clusters: Pt[] = [];
  const clusterN: number[] = [];
  const rawToCluster: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = find(i);
    let ci = rootToCluster.get(r);
    if (ci === undefined) {
      ci = clusters.length;
      rootToCluster.set(r, ci);
      clusters.push({ x: 0, y: 0 });
      clusterN.push(0);
    }
    clusters[ci].x += raw[i].x; clusters[ci].y += raw[i].y; clusterN[ci]++;
    rawToCluster.push(ci);
  }
  for (let ci = 0; ci < clusters.length; ci++) {
    clusters[ci].x /= clusterN[ci]; clusters[ci].y /= clusterN[ci];
  }
  for (let pi = 0; pi < vmap.length; pi++) {
    vmap[pi] = vmap[pi].map(ri => rawToCluster[ri]);
  }
  const original = clusters.map(c => ({ ...c }));

  // ── unique edges on the welded graph (cluster-index pairs) ──
  const edgeSet = new Map<string, [number, number]>();
  for (let pi = 0; pi < planes.length; pi++) {
    const ring = vmap[pi];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeSet.has(key)) edgeSet.set(key, [a, b]);
    }
  }
  const edges = [...edgeSet.values()];

  // ── 2. Dominant axis: length-weighted mean of edge angles folded mod 90° ──
  // (doubled-angle vector average on 4·angle so 0° and 90° reinforce)
  let sx = 0, sy = 0;
  for (const [a, b] of edges) {
    const dx = clusters[b].x - clusters[a].x, dy = clusters[b].y - clusters[a].y;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const ang4 = Math.atan2(dy, dx) * 4;
    sx += Math.cos(ang4) * len; sy += Math.sin(ang4) * len;
  }
  let theta = Math.atan2(sy, sx) / 4;   // dominant axis angle
  // A near-axis building is axis-aligned trace noise, not a rotated building —
  // snap the frame square to the sheet instead of preserving a 0.3° tilt.
  if (Math.abs(theta) < ((opts.axisAlignDeg ?? 3) * Math.PI) / 180) theta = 0;
  const cosT = Math.cos(-theta), sinT = Math.sin(-theta);
  const rot   = (p: Pt): Pt => ({ x: p.x * cosT - p.y * sinT, y: p.x * sinT + p.y * cosT });
  const unrot = (p: Pt): Pt => ({ x: p.x * cosT + p.y * sinT, y: -p.x * sinT + p.y * cosT });
  const work = clusters.map(rot);

  // ── 3. Snap near-axis edges straight (two passes so shared corners settle) ──
  const snapRad = (snapDeg * Math.PI) / 180;
  for (let pass = 0; pass < 2; pass++) {
    // accumulate per-cluster target means so multiple edges negotiate
    const accX: Array<{ sum: number; w: number }> = clusters.map(() => ({ sum: 0, w: 0 }));
    const accY: Array<{ sum: number; w: number }> = clusters.map(() => ({ sum: 0, w: 0 }));
    for (const [a, b] of edges) {
      const dx = work[b].x - work[a].x, dy = work[b].y - work[a].y;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;
      const ang = Math.abs(Math.atan2(dy, dx));           // 0..π
      const toH = Math.min(ang, Math.PI - ang);           // distance to horizontal
      const toV = Math.abs(ang - Math.PI / 2);            // distance to vertical
      if (toH < snapRad) {
        const my = (work[a].y * len + work[b].y * len) / (2 * len);
        accY[a].sum += my * len; accY[a].w += len;
        accY[b].sum += my * len; accY[b].w += len;
      } else if (toV < snapRad) {
        const mx = (work[a].x * len + work[b].x * len) / (2 * len);
        accX[a].sum += mx * len; accX[a].w += len;
        accX[b].sum += mx * len; accX[b].w += len;
      }
    }
    for (let ci = 0; ci < clusters.length; ci++) {
      if (accX[ci].w > 0) work[ci].x = accX[ci].sum / accX[ci].w;
      if (accY[ci].w > 0) work[ci].y = accY[ci].sum / accY[ci].w;
    }
  }

  // ── 4. Cap displacement, rotate back ──
  const out = work.map((p, ci) => {
    const back = unrot(p);
    const dx = back.x - original[ci].x, dy = back.y - original[ci].y;
    const d = Math.hypot(dx, dy);
    if (d > maxShift) {
      const s = maxShift / d;
      return { x: original[ci].x + dx * s, y: original[ci].y + dy * s };
    }
    return back;
  });

  // ── rebuild planes with welded/snapped vertices ──
  return planes.map((pl, pi) => ({
    ...pl,
    vertices: (pl.vertices ?? []).map((v, vi) => {
      const c = out[vmap[pi][vi]];
      return { ...v, lat: c.y, lng: c.x };
    }),
  }));
}

// ── Panel co-transform ────────────────────────────────────────────────────────
// Regularization moves roof edges by up to maxShiftFt; panels placed against the
// ORIGINAL edges then overhang the straightened linework (the top eave row read
// as a layout error). Each panel is carried along by the least-squares AFFINE
// map fitted from its plane's original → regularized vertices, so relative
// position within the facet is preserved. Display-only, like the planes.

type LatLng = { lat: number; lng: number };

/** Least-squares affine fit (x,y)→(x',y') from point correspondences. */
function fitAffine(src: Pt[], dst: Pt[]): ((p: Pt) => Pt) | null {
  const n = src.length;
  if (n < 3) return null;
  // Normal equations for [a b c] with basis (x, y, 1) — same matrix for both axes.
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, s1 = n;
  let bx1 = 0, bx2 = 0, bx3 = 0, by1 = 0, by2 = 0, by3 = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i], u = dst[i].x, v = dst[i].y;
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bx1 += x * u; bx2 += y * u; bx3 += u;
    by1 += x * v; by2 += y * v; by3 += v;
  }
  // Solve the 3x3 symmetric system via Cramer's rule.
  const M = [sxx, sxy, sx, sxy, syy, sy, sx, sy, s1];
  const det = (m: number[]) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return null;   // degenerate (collinear vertices)
  const solve = (b1: number, b2: number, b3: number) => {
    const c0 = det([b1, M[1], M[2], b2, M[4], M[5], b3, M[7], M[8]]) / D;
    const c1 = det([M[0], b1, M[2], M[3], b2, M[5], M[6], b3, M[8]]) / D;
    const c2 = det([M[0], M[1], b1, M[3], M[4], b2, M[6], M[7], b3]) / D;
    return [c0, c1, c2];
  };
  const [a, b, c] = solve(bx1, bx2, bx3);
  const [d, e, f] = solve(by1, by2, by3);
  return (p: Pt) => ({ x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f });
}

/**
 * Map panels through their containing plane's original→regularized affine.
 * Panels not inside any original plane fall back to the nearest-centroid plane;
 * panels stay untouched when no transform can be fitted. Pure, display-only.
 */
export function coTransformPanels<P extends LatLng>(
  originalPlanes: RoofPlaneLike[],
  regularizedPlanes: RoofPlaneLike[],
  panels: P[],
): P[] {
  const xforms = originalPlanes.map((op, i) => {
    const src = (op.vertices ?? []).map(v => ({ x: v.lng, y: v.lat }));
    const dst = (regularizedPlanes[i]?.vertices ?? []).map(v => ({ x: v.lng, y: v.lat }));
    return src.length === dst.length ? fitAffine(src, dst) : null;
  });
  const inRing = (lat: number, lng: number, ring: LatLng[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
      if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  const centroids = originalPlanes.map(op => {
    const vs = op.vertices ?? [];
    return {
      lat: vs.reduce((s, v) => s + v.lat, 0) / (vs.length || 1),
      lng: vs.reduce((s, v) => s + v.lng, 0) / (vs.length || 1),
    };
  });
  return panels.map(p => {
    let pi = originalPlanes.findIndex(op => inRing(p.lat, p.lng, op.vertices ?? []));
    if (pi === -1) {
      let best = Infinity;
      centroids.forEach((c, i) => {
        const d = Math.hypot(c.lat - p.lat, c.lng - p.lng);
        if (d < best) { best = d; pi = i; }
      });
    }
    const xf = pi >= 0 ? xforms[pi] : null;
    if (!xf) return p;
    const q = xf({ x: p.lng, y: p.lat });
    return { ...p, lat: q.y, lng: q.x };
  });
}
