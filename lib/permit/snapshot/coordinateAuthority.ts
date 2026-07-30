// ═══════════════════════════════════════════════════════════════════════════
// W3.1 §2 — Canonical coordinate authority: transform math + render parity.
//
// One canonical coordinate system (CANONICAL_COORDINATE_SYSTEM_ID). Every
// physical object carries CoordinateMeta pointing at a snapshot-carried
// DrawingTransform. The renderer applies transform → viewport; it may not
// re-derive positions. The render-parity checker proves, at whatever seam is
// honest, that:
//   (a) every rendered attachment coord == transform(canonical) ± tolerance
//   (b) every rendered rail endpoint == transform(canonical) ± tolerance
//   (c) every rendered module polygon (centroid) == transform(canonical) ± tol
//   (d) no rendered physical object without a canonical object ID
//   (e) no canonical physical object omitted from the drawing
// The comparison seam is a renderer placement manifest (objectId → sheet coords
// + the canonical coord consumed); the harness can additionally cross-check the
// manifest against data-object-id attributes on the rendered SVG/HTML.
// ═══════════════════════════════════════════════════════════════════════════
import { contentRevision } from './digest';
import {
  CANONICAL_COORDINATE_SYSTEM_ID,
  type DrawingTransform, type CoordinateMeta, type Provenance,
  type PlacementManifest, type PlacementEntry, type PermitDesignSnapshot,
} from './types';

export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Apply a 2×3 affine to a point: x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export function applyAffine(m: Affine, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Invert a 2×3 affine (throws-free; returns identity if singular). */
export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { ...IDENTITY_AFFINE };
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}

/** Least-squares fit of the affine mapping src[i] → dst[i] (≥3 non-collinear
 *  points). Returns null when under-determined/degenerate. Solves the two
 *  independent 3-param systems [x'|y'] = [x y 1]·coeffs via normal equations. */
export function fitAffine(
  src: { x: number; y: number }[], dst: { x: number; y: number }[],
): Affine | null {
  const n = Math.min(src.length, dst.length);
  if (n < 3) return null;
  // normal matrix M = Σ [x y 1]^T[x y 1] (3×3, symmetric); rhs vectors for x',y'
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = src[i].x, y = src[i].y;
    const r = [x, y, 1];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b];
      bx[a] += r[a] * dst[i].x;
      by[a] += r[a] * dst[i].y;
    }
  }
  const cx = solve3(M, bx), cy = solve3(M, by);
  if (!cx || !cy) return null;
  // coeffs: x' = cx0·x + cx1·y + cx2 ; y' = cy0·x + cy1·y + cy2
  return { a: cx[0], c: cx[1], e: cx[2], b: cy[0], d: cy[1], f: cy[2] };
}

/** Solve a 3×3 system M·v = b via Gaussian elimination (null if singular). */
function solve3(M0: number[][], b0: number[]): number[] | null {
  const M = M0.map(r => r.slice()), b = b0.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = 0; c < 3; c++) M[r][c] -= f * M[col][c];
      b[r] -= f * b[col];
    }
  }
  return [b[0] / M[0][0], b[1] / M[1][1], b[2] / M[2][2]];
}

/** Dominant-axis angle (deg, CCW from +x) of a point cloud via the principal
 *  eigenvector of the centered covariance — the array's squaring angle. */
export function dominantAxisDeg(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // principal-axis angle
  return (theta * 180) / Math.PI;
}

/** Compose two affines: (outer ∘ inner)(p) = outer(inner(p)). */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Rotation (deg, CCW) about a pivot, as a 2×3 affine in feet. */
export function planRotationAffine(rotationDeg: number, pivot: { x: number; y: number }): Affine {
  const th = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return {
    a: r6(cos), b: r6(sin), c: r6(-sin), d: r6(cos),
    e: r6(pivot.x - cos * pivot.x + sin * pivot.y),
    f: r6(pivot.y - sin * pivot.x - cos * pivot.y),
  };
}

/** Stable digest of a transform's parameters — the evidence-exposed value. */
export function transformDigestOf(matrix: Affine, params: DrawingTransform['params']): string {
  return contentRevision({
    matrix: { a: r6(matrix.a), b: r6(matrix.b), c: r6(matrix.c), d: r6(matrix.d), e: r6(matrix.e), f: r6(matrix.f) },
    params: { kind: params.kind, rotationDeg: r6(params.rotationDeg), pivot: { x: r6(params.pivot.x), y: r6(params.pivot.y) } },
  });
}

export interface BuildTransformOpts {
  transformId: string;
  scope: string;                    // 'site' | planeId
  kind: 'identity' | 'plan-rotation';
  rotationDeg?: number;
  pivot?: { x: number; y: number };
  provenanceNote?: string;
}

/** Build a snapshot DrawingTransform (matrix + params + digest + revision). */
export function buildDrawingTransform(o: BuildTransformOpts): DrawingTransform {
  const rotationDeg = o.kind === 'plan-rotation' ? (o.rotationDeg ?? 0) : 0;
  const pivot = o.pivot ?? { x: 0, y: 0 };
  const matrix = o.kind === 'plan-rotation' ? planRotationAffine(rotationDeg, pivot) : { ...IDENTITY_AFFINE };
  const params: DrawingTransform['params'] = { kind: o.kind, rotationDeg, pivot };
  const transformDigest = transformDigestOf(matrix, params);
  const provenance: Provenance = {
    source: 'W3.1 coordinate authority',
    note: o.provenanceNote
      ?? (o.kind === 'identity'
        ? 'canonical site-plan-ft IS the registration frame (identity); renderer applies viewport scale/paper only'
        : `plan-rotation ${rotationDeg}° about pivot — geo-registration owned by the snapshot`),
  };
  return {
    transformId: o.transformId,
    revision: transformDigest,      // params ARE the revision basis (change ⇒ new revision)
    scope: o.scope,
    fromCoordinateSystemId: CANONICAL_COORDINATE_SYSTEM_ID,
    toFrame: 'registration-ft',
    units: 'ft',
    matrix, params, transformDigest, provenance,
  };
}

/** CoordinateMeta referencing a built transform. */
export function coordMetaFor(
  t: DrawingTransform, sourceFrame: CoordinateMeta['sourceFrame'], note?: string,
): CoordinateMeta {
  return {
    coordinateSystemId: CANONICAL_COORDINATE_SYSTEM_ID,
    units: 'ft',
    sourceFrame,
    transformId: t.transformId,
    transformRevision: t.revision,
    transformProvenance: { source: 'W3.1 coordinate authority', ref: t.transformId, note },
  };
}

// ── render-parity checker ────────────────────────────────────────────────────

export type ParityCode =
  | 'RENDERED-OBJECT-NO-CANONICAL-ID'   // (d)
  | 'CANONICAL-OBJECT-OMITTED'          // (e)
  | 'RENDERER-REDERIVED-COORDINATE'     // consumed coord ≠ snapshot canonical
  | 'RENDER-COORD-PARITY-EXCEEDED'      // (a)/(b)/(c) sheet coord ≠ transform(canonical)
  | 'TRANSFORM-UNRESOLVED';             // manifest.transformId not in snapshot

export interface ParityViolation {
  code: ParityCode;
  objectId?: string;
  kind?: PlacementEntry['kind'];
  detail: string;
  delta?: number;
}

export interface ParityOptions {
  /** sheet-space rounding tolerance (why: renderers round coords to 0.1 px and
   *  the manifest stores 0.01-ft canonical values → ≤ 0.5 sheet unit is noise). */
  tolSheet?: number;
  /** canonical-frame tolerance for "renderer consumed the snapshot coord" (ft) */
  tolCanonical?: number;
  /** require every canonical physical object to appear in the manifest (e) */
  requireCoverage?: boolean;
  /** restrict the coverage/parity check to these kinds (e.g. ['module']) */
  kinds?: PlacementEntry['kind'][];
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Canonical reference point per physical object, in the canonical frame:
 *  modules = polygon centroid; rails = start/end midpoint; attachments = xy. */
export function canonicalPointsById(
  snap: PermitDesignSnapshot,
): Map<string, { x: number; y: number; kind: PlacementEntry['kind'] }> {
  const m = new Map<string, { x: number; y: number; kind: PlacementEntry['kind'] }>();
  for (const mi of snap.geometry.moduleInstances ?? []) {
    // module parity is against the DRAWN polygon centroid (what the renderer
    // projects); the raw `polygon` feeds the area invariant, not placement.
    const pts = (mi.drawnPolygon ?? mi.polygon).points;
    if (pts.length) {
      m.set(mi.instanceId, {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        kind: 'module',
      });
    }
  }
  for (const r of snap.structural.rails ?? []) {
    m.set(r.railId, { x: (r.startXY.x + r.endXY.x) / 2, y: (r.startXY.y + r.endXY.y) / 2, kind: 'rail' });
    (r.splicePointsXY ?? []).forEach((sp, k) => {
      m.set(`splice-${r.railId}-${k + 1}`, { x: sp.x, y: sp.y, kind: 'splice' });
    });
  }
  for (const a of snap.structural.attachments ?? []) {
    m.set(a.attachmentId, { x: a.xy.x, y: a.xy.y, kind: 'attachment' });
  }
  return m;
}

// ── placement-manifest transport (HTML comment) ──────────────────────────────
// Renderers emit `<!--PLACEMENT-MANIFEST:{json}-->` per sheet (self-contained,
// no RenderContext mutation). generatePermit + the evidence harness parse these
// and run checkRenderParity. JSON never contains '-->' so the comment is safe.
export const MANIFEST_COMMENT_PREFIX = 'PLACEMENT-MANIFEST:';

export function emitPlacementManifestComment(manifest: PlacementManifest): string {
  return `<!--${MANIFEST_COMMENT_PREFIX}${JSON.stringify(manifest)}-->`;
}

export function parsePlacementManifests(html: string): PlacementManifest[] {
  const out: PlacementManifest[] = [];
  const re = /<!--PLACEMENT-MANIFEST:(\{.*?\})-->/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) {
    try { out.push(JSON.parse(mm[1]) as PlacementManifest); } catch { /* skip malformed */ }
  }
  return out;
}

/** Compare a renderer placement manifest against transform(canonical). Returns
 *  the parity violations (empty ⇒ the renderer placed every object via the
 *  snapshot transform with no independent geo-registration). */
export function checkRenderParity(
  snap: PermitDesignSnapshot, manifest: PlacementManifest, opts: ParityOptions = {},
): ParityViolation[] {
  const tolSheet = opts.tolSheet ?? 0.5;
  const tolCanon = opts.tolCanonical ?? 0.01;
  const viol: ParityViolation[] = [];
  const canon = canonicalPointsById(snap);
  const transform = (snap.geometry.drawingTransforms ?? []).find(t => t.transformId === manifest.transformId);
  if (!transform) {
    viol.push({ code: 'TRANSFORM-UNRESOLVED', detail: `manifest transformId '${manifest.transformId}' not in snapshot.geometry.drawingTransforms` });
    return viol;
  }
  const kindOk = (k: PlacementEntry['kind']) => !opts.kinds || opts.kinds.includes(k);
  const seen = new Set<string>();

  for (const e of manifest.entries) {
    if (!kindOk(e.kind)) continue;
    seen.add(e.objectId);
    const c = canon.get(e.objectId);
    if (!c) {
      viol.push({ code: 'RENDERED-OBJECT-NO-CANONICAL-ID', objectId: e.objectId, kind: e.kind,
        detail: `rendered ${e.kind} '${e.objectId}' has no canonical object in the snapshot` });
      continue;
    }
    // renderer must have CONSUMED the snapshot canonical coordinate
    const dConsumed = dist(e.canonicalXY, c);
    if (dConsumed > tolCanon) {
      viol.push({ code: 'RENDERER-REDERIVED-COORDINATE', objectId: e.objectId, kind: e.kind, delta: r6(dConsumed),
        detail: `consumed canonical (${e.canonicalXY.x},${e.canonicalXY.y}) ≠ snapshot canonical (${c.x},${c.y}) by ${dConsumed.toFixed(4)} ft — renderer re-derived the position` });
    }
    // sheet placement must equal viewport ∘ transform (canonical)
    const expectSheet = applyAffine(manifest.viewport, applyAffine(transform.matrix, e.canonicalXY));
    const dSheet = dist(e.sheetXY, expectSheet);
    if (dSheet > tolSheet) {
      viol.push({ code: 'RENDER-COORD-PARITY-EXCEEDED', objectId: e.objectId, kind: e.kind, delta: r6(dSheet),
        detail: `drawn sheet coord (${e.sheetXY.x},${e.sheetXY.y}) ≠ viewport∘transform(canonical) (${r6(expectSheet.x)},${r6(expectSheet.y)}) by ${dSheet.toFixed(3)} > ${tolSheet}` });
    }
  }
  if (opts.requireCoverage) {
    for (const [id, c] of canon) {
      if (!kindOk(c.kind)) continue;
      if (!seen.has(id)) {
        viol.push({ code: 'CANONICAL-OBJECT-OMITTED', objectId: id, kind: c.kind,
          detail: `canonical ${c.kind} '${id}' is not present in the drawing manifest` });
      }
    }
  }
  return viol;
}

// ── live HTML cross-check (harness / post-render) ────────────────────────────

/** Extract every data-object-id present on a rendered SVG/HTML string. */
export function scanRenderedObjectIds(html: string): string[] {
  const ids: string[] = [];
  const re = /data-object-id="([^"]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html)) !== null) ids.push(mm[1]);
  return ids;
}

export interface IdCoverageResult {
  orphanRenderedIds: string[];      // (d) rendered ids with no canonical object
  ok: boolean;
}

/** (d) — no rendered physical object without a canonical object ID. Verifies
 *  every data-object-id in the HTML resolves to a snapshot physical object.
 *  (Coverage of ALL canonical objects — (e) — is honest only per-sheet against
 *  the geo-valid drawn subset, so it is checked via the manifest, not here.) */
export function checkRenderedIdCoverage(snap: PermitDesignSnapshot, renderedIds: string[]): IdCoverageResult {
  const canon = canonicalPointsById(snap);
  const orphanRenderedIds = renderedIds.filter(id => !canon.has(id) && !canon.has(id.replace(/^mi-/, '')));
  return { orphanRenderedIds, ok: orphanRenderedIds.length === 0 };
}
