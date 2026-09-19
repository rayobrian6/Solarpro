/**
 * lib/3d/regularizeOutline.ts
 *
 * Square up a hand-traced roof outline.
 *
 * Ray: "when I place my points, because of the shitty google imaging, one plane
 * is larger than the other after marking my points. Need to correct."
 *
 * Buildings are overwhelmingly rectilinear. A trace of one is not, because the
 * clicks are eyeballed on blurry aerial imagery: edges that should be parallel
 * are a few degrees off, corners that should be square are 87 or 93 degrees, and
 * two halves of a symmetric roof come out different depths. Every downstream
 * number — area, panel count, pitch, where the ridge lands — inherits that
 * scatter.
 *
 * 🚨 THIS MOVES THE USER'S TRACED CORNERS, so it is the one operation in this
 * area that must never run on its own. An earlier automatic rebuild rewrote
 * traced corners behind the user's back, desynchronised Stitch and shifted
 * faces; the lesson was that correction has to be an explicit, inspectable,
 * revertible action. Everything here is a pure function returning a NEW ring
 * plus a report of what it changed, so the caller can show the change, let the
 * user accept it, and keep the original to revert to.
 *
 * All maths is done in a local east/north metre frame around the ring's own
 * centroid. Over a building (tens of metres) that frame is exact enough that
 * the error is far below click scatter, and it keeps the geometry readable.
 */

export interface LatLng { lat: number; lng: number }

export interface RegularizeOptions {
  /**
   * Vertices closer than this collapse into one. Default 0.30 m.
   * A double-click or a shaky hand puts two points essentially on top of each
   * other; left in, they create zero-length edges whose direction is undefined,
   * which then poisons every angle test below.
   */
  mergeDistM?: number;
  /**
   * Corners straighter than this are dropped as redundant. Default 4 degrees.
   * A traced "straight" wall often gets an extra point partway along it.
   */
  collinearDeg?: number;
  /**
   * Edges within this of parallel (or perpendicular) to the dominant axis are
   * snapped onto it. Default 12 degrees.
   *
   * This is the load-bearing tolerance. Too small and nothing is corrected on a
   * genuinely sloppy trace; too large and a real angled wing — a 30-degree
   * addition, a chamfered corner — is wrongly straightened into the main block,
   * which silently destroys real geometry. 12 degrees is comfortably more than
   * observed click scatter on blurry imagery and comfortably less than any
   * intentional architectural angle (the shallowest common one is 45).
   */
  snapDeg?: number;
}

export interface RegularizeReport {
  /** Vertices removed because they were duplicates or redundant. */
  removed: number;
  /** Edges rotated onto the dominant axis. */
  snapped: number;
  /** Largest distance any surviving vertex moved, metres. */
  maxShiftM: number;
  /** Bearing of the dominant axis, degrees [0,180). */
  dominantAxisDeg: number;
}

export interface RegularizeResult {
  outline: LatLng[];
  report: RegularizeReport;
  /** False when the input could not be regularized; `outline` is then the input. */
  changed: boolean;
}

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;

const DEFAULTS = { mergeDistM: 0.30, collinearDeg: 4, snapDeg: 12 };

interface Frame { cLat: number; cLng: number; mLng: number }

function makeFrame(ring: readonly LatLng[]): Frame {
  const cLat = ring.reduce((s, v) => s + v.lat, 0) / ring.length;
  const cLng = ring.reduce((s, v) => s + v.lng, 0) / ring.length;
  const cos = Math.cos(cLat * DEG);
  return { cLat, cLng, mLng: M_PER_DEG_LAT * (cos > 0.01 ? cos : 1) };
}
const toXY = (v: LatLng, f: Frame) => ({
  x: (v.lng - f.cLng) * f.mLng,
  y: (v.lat - f.cLat) * M_PER_DEG_LAT,
});
const toLL = (p: { x: number; y: number }, f: Frame): LatLng => ({
  lat: f.cLat + p.y / M_PER_DEG_LAT,
  lng: f.cLng + p.x / f.mLng,
});

/** Smallest angle between two undirected bearings, degrees. */
function axisDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 180 + 180) % 180);
  return Math.min(d, 180 - d);
}

/**
 * The building's dominant axis: the bearing that the most edge LENGTH lies
 * along, counting perpendicular edges as the same axis.
 *
 * Length-weighted on purpose. Counting edges would let three short jogs on a
 * porch outvote the two long walls that actually define the building.
 */
export function dominantAxis(ring: readonly LatLng[]): number {
  if (!ring || ring.length < 3) return 0;
  const f = makeFrame(ring);
  const pts = ring.map(v => toXY(v, f));
  let best = 0, bestScore = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) continue;
    const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) / DEG) % 180 + 180) % 180;
    // Score this candidate by how much total edge length aligns with it.
    let score = 0;
    for (let j = 0; j < pts.length; j++) {
      const c = pts[j], d = pts[(j + 1) % pts.length];
      const l = Math.hypot(d.x - c.x, d.y - c.y);
      if (l < 0.5) continue;
      const bb = ((Math.atan2(d.x - c.x, d.y - c.y) / DEG) % 180 + 180) % 180;
      const off = Math.min(axisDelta(bb, bearing), axisDelta(bb, (bearing + 90) % 180));
      if (off <= 15) score += l * (1 - off / 15);
    }
    if (score > bestScore) { bestScore = score; best = bearing; }
  }
  return best;
}

/**
 * Regularize a traced outline: collapse duplicates, drop redundant collinear
 * corners, and snap near-axis edges onto the building's dominant axis.
 *
 * Returns the input unchanged (changed: false) rather than throwing when the
 * ring is too small or degenerate to reason about.
 */
export function regularizeOutline(
  ring: readonly LatLng[],
  options: RegularizeOptions = {},
): RegularizeResult {
  const mergeDistM = options.mergeDistM ?? DEFAULTS.mergeDistM;
  const collinearDeg = options.collinearDeg ?? DEFAULTS.collinearDeg;
  const snapDeg = options.snapDeg ?? DEFAULTS.snapDeg;

  const noChange = (r: readonly LatLng[]): RegularizeResult => ({
    outline: r.slice(),
    report: { removed: 0, snapped: 0, maxShiftM: 0, dominantAxisDeg: 0 },
    changed: false,
  });

  if (!ring || ring.length < 3) return noChange(ring ?? []);
  if (!ring.every(v => isFinite(v.lat) && isFinite(v.lng))) return noChange(ring);

  const f = makeFrame(ring);
  let pts = ring.map(v => toXY(v, f));
  const original = pts.slice();
  let removed = 0;

  // ── 1. Collapse near-duplicate vertices ────────────────────────────────────
  {
    const kept: typeof pts = [];
    for (const p of pts) {
      const last = kept[kept.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < mergeDistM) { removed++; continue; }
      kept.push(p);
    }
    // The ring closes, so check the last against the first too.
    while (kept.length > 3) {
      const a = kept[kept.length - 1], b = kept[0];
      if (Math.hypot(a.x - b.x, a.y - b.y) >= mergeDistM) break;
      kept.pop(); removed++;
    }
    pts = kept;
  }
  if (pts.length < 3) return noChange(ring);

  // ── 2. Drop redundant collinear corners ────────────────────────────────────
  {
    const kept: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const b1 = Math.atan2(cur.x - prev.x, cur.y - prev.y) / DEG;
      const b2 = Math.atan2(next.x - cur.x, next.y - cur.y) / DEG;
      if (axisDelta(b1, b2) < collinearDeg && pts.length - kept.length > 3) { removed++; continue; }
      kept.push(cur);
    }
    if (kept.length >= 3) pts = kept;
  }

  // ── 3. Snap near-axis edges onto the dominant axis ─────────────────────────
  // Each edge is rotated about its own midpoint onto whichever of the two axis
  // directions it is closest to. Rotating about the midpoint rather than an
  // endpoint keeps the footprint centred and halves the movement any one
  // vertex sees. Neighbouring edges then disagree at their shared corner, so
  // the corner is resolved as the INTERSECTION of the two snapped lines —
  // which is what actually produces a square building rather than a wobbly one
  // with square-ish edges.
  const axis = dominantAxis(ring);
  let snapped = 0;
  const lines: Array<{ px: number; py: number; dx: number; dy: number } | null> = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) { lines.push(null); continue; }
    const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) / DEG) % 180 + 180) % 180;
    const dA = axisDelta(bearing, axis);
    const dB = axisDelta(bearing, (axis + 90) % 180);
    const target = dA <= dB ? axis : (axis + 90) % 180;
    const off = Math.min(dA, dB);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (off > snapDeg) {
      // Genuinely angled edge — a real wing or chamfer. Leave it alone.
      lines.push({ px: mx, py: my, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
      continue;
    }
    snapped++;
    // Keep the edge's own direction sense so the ring does not reverse.
    let ux = Math.sin(target * DEG), uy = Math.cos(target * DEG);
    if (ux * (b.x - a.x) + uy * (b.y - a.y) < 0) { ux = -ux; uy = -uy; }
    lines.push({ px: mx, py: my, dx: ux, dy: uy });
  }

  if (snapped > 0) {
    const out: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      const prevLine = lines[(i - 1 + lines.length) % lines.length];
      const curLine = lines[i];
      if (!prevLine || !curLine) { out.push(pts[i]); continue; }
      const cross = prevLine.dx * curLine.dy - prevLine.dy * curLine.dx;
      if (Math.abs(cross) < 1e-6) { out.push(pts[i]); continue; } // parallel: no corner
      const t = ((curLine.px - prevLine.px) * curLine.dy - (curLine.py - prevLine.py) * curLine.dx) / cross;
      const ix = prevLine.px + prevLine.dx * t;
      const iy = prevLine.py + prevLine.dy * t;
      // Reject a wild intersection — near-parallel lines can meet far away, and
      // a corner that jumps metres is worse than one left slightly off.
      if (Math.hypot(ix - pts[i].x, iy - pts[i].y) > 5) { out.push(pts[i]); continue; }
      out.push({ x: ix, y: iy });
    }
    pts = out;
  }

  // How far did anything actually move? Reported so the caller can warn before
  // committing a correction that is really a redraw.
  let maxShiftM = 0;
  for (const p of pts) {
    let nearest = Infinity;
    for (const o of original) nearest = Math.min(nearest, Math.hypot(p.x - o.x, p.y - o.y));
    if (nearest > maxShiftM) maxShiftM = nearest;
  }

  const changed = removed > 0 || snapped > 0;
  return {
    outline: pts.map(p => toLL(p, f)),
    report: { removed, snapped, maxShiftM, dominantAxisDeg: axis },
    changed,
  };
}

/**
 * Make two faces that share a ridge agree on it exactly.
 *
 * Averages the two rings' ridge endpoints and writes the average back into
 * both, so the halves meet on a single straight segment instead of two
 * near-miss ones. Returns new rings; neither input is mutated.
 *
 * 🚨 Deliberately does NOT equalise the two halves' depths. Plenty of real
 * roofs are asymmetric — saltboxes, additions, lean-tos — and forcing symmetry
 * would silently destroy a correct trace of one. Getting the ridge to agree is
 * what closes the roof; the shared-ridge construction then handles unequal
 * depths honestly by giving each half the pitch its own depth implies.
 */
export function alignSharedRidge(
  ringA: readonly LatLng[],
  ringB: readonly LatLng[],
  tolM = 1.5,
): { a: LatLng[]; b: LatLng[]; alignedPairs: number } {
  const a = ringA.map(v => ({ ...v }));
  const b = ringB.map(v => ({ ...v }));
  if (a.length < 3 || b.length < 3) return { a, b, alignedPairs: 0 };

  const f = makeFrame([...ringA, ...ringB]);
  const distM = (p: LatLng, q: LatLng) => {
    const pa = toXY(p, f), qa = toXY(q, f);
    return Math.hypot(pa.x - qa.x, pa.y - qa.y);
  };

  let alignedPairs = 0;
  const usedB = new Set<number>();
  for (let i = 0; i < a.length; i++) {
    let bestJ = -1, bestD = tolM;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      const d = distM(a[i], b[j]);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    if (bestJ < 0) continue;
    usedB.add(bestJ);
    alignedPairs++;
    const mid = { lat: (a[i].lat + b[bestJ].lat) / 2, lng: (a[i].lng + b[bestJ].lng) / 2 };
    a[i] = mid;
    b[bestJ] = { ...mid };
  }
  return { a, b, alignedPairs };
}
