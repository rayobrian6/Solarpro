// ═══════════════════════════════════════════════════════════════
// PV-1 design→imagery EDGE-SNAP registration (Google-fallback aerials)
//
// The Nearmap path registers the design layer to the pixels with Nearmap's
// own AI roof polygons (vector data that shares the imagery's registration).
// The Google Static Maps fallback has NO such layer: Solar API roofSegments
// routinely belong to a NEIGHBOR building (buildingInsights:findClosest —
// measured 14 m off on the Melvin apartment complex), so they must never
// drive registration. Without a shift the module layer renders at raw design
// GPS, ~1-2 m off Google's own orthorectification — modules visibly hang
// past the eave (Ray's 07-06 render).
//
// This registers against the IMAGE itself: project the design roof's outer
// hull into pixel space, then grid-search a small translation that lands the
// hull on the strongest image edges (Sobel gradients, oriented — only the
// gradient component perpendicular to each hull edge counts, so a crossing
// sidewalk doesn't score). Eaves are the highest-contrast lines around a
// roof; on real imagery the true alignment wins by >3× over unshifted.
//
// Fail-open by design: low confidence, hull off-frame, oversized shift, or
// a missing/undecodable image all return null → the caller draws unshifted
// (today's behavior).
// ═══════════════════════════════════════════════════════════════

import { lngToGlobalPx, latToGlobalPx } from '@/lib/aerial/nearmap';

export interface EdgeSnapShift {
  dLat: number;        // degrees to ADD to every design lat before projecting
  dLng: number;        // degrees to ADD to every design lng
  shiftM: number;      // magnitude in meters (diagnostic)
  scoreRatio: number;  // best edge score / unshifted score (diagnostic)
  method: 'edge-snap';
}

// Search box half-width. Provider-registration offsets are 1-2 m; anything
// bigger than ~3.5 m is a different feature (a neighbor roof), not a shift.
const SEARCH_RADIUS_M = 3.5;
// Grid step in logical (declared-size) pixels.
const STEP_PX = 0.5;
// Best score must beat the unshifted score by this factor, else no shift —
// an already-aligned trace scores ~1.0 and stays put.
const MIN_SCORE_RATIO = 1.3;
// ...and clear this absolute floor (mean oriented Sobel per sample, 0-1442
// scale) so a featureless/flat frame can't produce a noise lock.
const MIN_ABS_SCORE = 12;
// A real roof lock lands MOST of the hull perimeter on edges (0.74 measured
// on Melvin); a partial lock — one design eave riding a NEIGHBOR building's
// edge, everything else on grass — only reaches ~0.25-0.3. Candidates below
// this on-edge fraction are rejected outright, which is what keeps a 14 m
// wrong-building offset from producing a confident-looking single-edge match.
const MIN_EDGE_FRACTION = 0.5;
// Per-sample oriented-gradient magnitude that counts as "on an edge".
const EDGE_THRESHOLD = 60;
// Sample spacing along the hull perimeter, logical px.
const SAMPLE_SPACING_PX = 0.75;

interface AerialForSnap {
  imageBase64?: string;
  imageWidth?: number;
  imageHeight?: number;
  lat?: number;
  lng?: number;
  zoom?: number;
}

export async function computeAerialEdgeSnap(
  aerial: AerialForSnap,
  roofPlanes: Array<{ vertices?: Array<{ lat: number; lng: number }> }>,
): Promise<EdgeSnapShift | null> {
  const b64 = aerial?.imageBase64;
  const cLat = aerial?.lat, cLng = aerial?.lng;
  if (!b64 || !isFinite(cLat as number) || !isFinite(cLng as number)) return null;
  const imgW = aerial.imageWidth || 640;
  const imgH = aerial.imageHeight || 360;
  const z = aerial.zoom || 20;

  // Same projection as sitePlan's toPx — must stay identical or the computed
  // shift lands the overlay somewhere other than where it was scored.
  const toPx = (lat: number, lng: number) => ({
    x: imgW / 2 + (lngToGlobalPx(lng, z) - lngToGlobalPx(cLng as number, z)),
    y: imgH / 2 + (latToGlobalPx(lat, z) - latToGlobalPx(cLat as number, z)),
  });

  // ── Design outer hull (the building outline = the eave constellation) ──
  const pts: Array<{ x: number; y: number }> = [];
  for (const rp of roofPlanes ?? []) {
    for (const v of rp?.vertices ?? []) {
      if (isFinite(v?.lat) && isFinite(v?.lng) && Math.abs(v.lat) > 0.001) pts.push(toPx(v.lat, v.lng));
    }
  }
  if (pts.length < 3) return null;
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Array<{ x: number; y: number }> = [], upper: Array<{ x: number; y: number }> = [];
  for (const q of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;

  // Perimeter samples, each carrying its edge's unit normal for the
  // orientation-weighted score.
  const samples: Array<{ x: number; y: number; nx: number; ny: number }> = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const n = Math.max(2, Math.ceil(len / SAMPLE_SPACING_PX));
    const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
    for (let k = 0; k < n; k++) {
      samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, nx, ny });
    }
  }
  if (samples.length < 40) return null;

  // ── Decode + Sobel ──────────────────────────────────────────────────────
  let data: Buffer, W: number, H: number;
  try {
    const sharp = (await import('sharp')).default;
    const raw = Buffer.from(b64.replace(/^data:image\/[\w.+-]+;base64,/, ''), 'base64');
    const out = await sharp(raw).greyscale().raw().toBuffer({ resolveWithObject: true });
    data = out.data; W = out.info.width; H = out.info.height;
  } catch {
    return null; // sharp unavailable or image undecodable — draw unshifted
  }
  // Bitmap-vs-declared scale (Google Static Maps scale=2 → bitmap is 2× the
  // declared logical size). Reject weird aspect mismatches.
  const S = W / imgW;
  if (!isFinite(S) || S < 0.4 || S > 4.5 || Math.abs(H / imgH - S) > 0.05 * S) return null;

  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      gx[i] = -data[i - W - 1] - 2 * data[i - 1] - data[i + W - 1] + data[i - W + 1] + 2 * data[i + 1] + data[i + W + 1];
      gy[i] = -data[i - W - 1] - 2 * data[i - W] - data[i - W + 1] + data[i + W - 1] + 2 * data[i + W] + data[i + W + 1];
    }
  }

  const score = (dx: number, dy: number): { s: number; inFrame: number; frac: number } => {
    let s = 0, inFrame = 0, onEdge = 0;
    for (const q of samples) {
      const X = Math.round((q.x + dx) * S), Y = Math.round((q.y + dy) * S);
      if (X > 0 && X < W - 1 && Y > 0 && Y < H - 1) {
        const i = Y * W + X;
        const g = Math.abs(gx[i] * q.nx + gy[i] * q.ny);
        s += g;
        if (g > EDGE_THRESHOLD) onEdge++;
        inFrame++;
      }
    }
    return { s: inFrame ? s / samples.length : 0, inFrame, frac: inFrame ? onEdge / inFrame : 0 };
  };

  const base = score(0, 0);
  // Hull mostly outside the frame → nothing trustworthy to register against.
  if (base.inFrame < samples.length * 0.6) return null;

  const mpp = (156543.03392 / Math.pow(2, z)) * Math.cos((cLat as number) * Math.PI / 180);
  const radiusPx = SEARCH_RADIUS_M / mpp;
  let best: { dx: number; dy: number; s: number; frac: number } | null = null;
  for (let dy = -radiusPx; dy <= radiusPx; dy += STEP_PX) {
    for (let dx = -radiusPx; dx <= radiusPx; dx += STEP_PX) {
      const r = score(dx, dy);
      if (r.inFrame >= samples.length * 0.6 && r.frac >= MIN_EDGE_FRACTION && (!best || r.s > best.s)) {
        best = { dx, dy, s: r.s, frac: r.frac };
      }
    }
  }
  if (!best) return null;                                // no candidate put half the perimeter on edges

  const ratio = base.s > 1e-6 ? best.s / base.s : Infinity;
  const distPx = Math.hypot(best.dx, best.dy);
  if (best.s < MIN_ABS_SCORE) return null;               // featureless frame
  if (ratio < MIN_SCORE_RATIO && distPx > STEP_PX) return null;  // no confident win over unshifted
  if (distPx >= radiusPx * 0.95) return null;            // rode the search edge — true optimum may be a neighbor
  if (distPx <= STEP_PX) return null;                    // already aligned — nothing to apply

  // px → degrees via local numeric inversion of the same projection.
  const EPS = 1e-4;
  const pxPerDegLng = (lngToGlobalPx((cLng as number) + EPS, z) - lngToGlobalPx(cLng as number, z)) / EPS;
  const pxPerDegLat = (latToGlobalPx((cLat as number) + EPS, z) - latToGlobalPx(cLat as number, z)) / EPS;
  if (!isFinite(pxPerDegLng) || !isFinite(pxPerDegLat) || pxPerDegLng === 0 || pxPerDegLat === 0) return null;
  return {
    dLng: best.dx / pxPerDegLng,
    dLat: best.dy / pxPerDegLat,
    shiftM: distPx * mpp,
    scoreRatio: isFinite(ratio) ? ratio : 999,
    method: 'edge-snap',
  };
}

/**
 * Route-side pre-pass (generatePermitHTML is sync — the image analysis has to
 * happen in the async route before rendering). Mutates
 * input.aerialData.registrationShift when a confident shift is found; PV-1's
 * registration block applies it through the same toPxD path as the Nearmap
 * shift. Only runs on the Google fallback — the Nearmap path has real vector
 * registration and must not be double-shifted. Never throws.
 */
export async function applyAerialEdgeSnapRegistration(input: {
  aerialData?: AerialForSnap & { imageSource?: string; subjectRoofPolygons?: unknown[]; registrationShift?: unknown };
  project?: { roofPlanes?: Array<{ vertices?: Array<{ lat: number; lng: number }> }> };
}): Promise<void> {
  try {
    const aerial = input?.aerialData;
    if (!aerial?.imageBase64) return;
    if (aerial.imageSource !== 'google') return;
    if ((aerial.subjectRoofPolygons?.length ?? 0) > 0) return;
    const planes = input?.project?.roofPlanes ?? [];
    if (planes.length === 0) return;
    // Always recompute (deterministic, ~100 ms) — a shift persisted in an old
    // snapshot shouldn't pin renders to an older algorithm.
    const res = await computeAerialEdgeSnap(aerial, planes);
    if (res) {
      aerial.registrationShift = res;
      console.log(`[permit/aerial] edge-snap registration: ${res.shiftM.toFixed(2)} m (score ratio ${res.scoreRatio.toFixed(2)})`);
    } else {
      delete aerial.registrationShift;
      console.log('[permit/aerial] edge-snap registration: no confident shift — drawing unshifted');
    }
  } catch (e: unknown) {
    console.log('[permit/aerial] edge-snap registration skipped:', (e as Error)?.message);
  }
}
