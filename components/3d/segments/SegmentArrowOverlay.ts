/**
 * components/3d/segments/SegmentArrowOverlay.ts
 *
 * Cesium overlay that renders per-segment yellow chevron arrows at the
 * midpoint of each polyline edge. Matches Aurora Smart Roof parity —
 * see components/3d/segments/DESIGN.md.
 *
 * Pattern follows the rest of SolarEngine3D.tsx: an imperative factory
 * that takes the Cesium viewer + Cesium namespace and returns
 * `update / clear / onPick` methods. The math (midpoint, normal,
 * bearing) lives in lib/3d/segmentArrows.ts and is unit-tested in
 * tests/segmentArrows.test.ts.
 *
 * Visual: a 32×32 yellow chevron arrow (filled triangle with shaft),
 * rendered as a Cesium Billboard. Rotation = -bearing, where bearing
 * is "clockwise from north" of the signed normal vector
 * (defaultOutwardNormal × normalDir).
 *
 * Click-to-flip: a self-contained LEFT_CLICK handler is installed
 * while arrows are visible. When a tagged arrow is picked, all
 * registered `onPick` handlers fire with the segment id. The caller
 * mutates its flipped set and re-calls update().
 */

import { safeCartesian3 } from '@/lib/3d/utils';
import {
  defaultOutwardNormal,
  bearingOf,
  midpoint as computeMidpoint,
  type SegmentDescriptor,
} from '@/lib/3d/segmentArrows';

// Inline SVG: yellow chevron pointing up by default. 32×32 viewBox.
// 32 px square so the arrow reads cleanly at 24 px display size.
const ARROW_IMAGE_DATA_URL =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBkPSJNMTYgMyBMMjYgMTggTDIxIDE4IEwyMSAyOCBMMTEgMjggTDExIDE4IEw2IDE4IFoiIGZpbGw9IiNmZmQ0MDAiIHN0cm9rZT0iIzFhMWExYSIgc3Ryb2tlLXdpZHRoPSIxLjIiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=';

/** Options to update() / clear(). */
export type SegmentArrowUpdateOpts = {
  segments: SegmentDescriptor[];
  /** Reference latitude for ENU scaling (use the polyline's first point). */
  refLat: number;
  /** Base height (m above WGS84 ellipsoid) for the arrow position. */
  refHeightM: number;
};

export type SegmentArrowOverlay = {
  /** Replace the rendered arrow set. Idempotent. */
  update: (opts: SegmentArrowUpdateOpts) => void;
  /** Remove all arrow entities + tear down the pick handler. */
  clear: () => void;
  /**
   * Subscribe to "user clicked arrow" events. Returns an unsubscribe
   * function. The handler receives the segment id; the caller decides
   * how to update its flipped set.
   */
  onPick: (handler: (segmentId: string) => void) => () => void;
};

/**
 * Compute the polygon centroid from a list of segments. Used as the
 * "outward" reference for defaultOutwardNormal — every edge's normal
 * is chosen to point away from this point.
 *
 * This is a 2D lat/lng centroid (not a 3D one) since the normal math
 * is ENU. For a closed polygon this is just the average of all unique
 * vertices.
 */
function polygonCentroid(segs: SegmentDescriptor[]): { lat: number; lng: number } | null {
  if (segs.length === 0) return null;
  const seen = new Set<string>();
  const pts: Array<{ lat: number; lng: number }> = [];
  for (const s of segs) {
    const a = `${s.from.lat.toFixed(7)},${s.from.lng.toFixed(7)}`;
    const b = `${s.to.lat.toFixed(7)},${s.to.lng.toFixed(7)}`;
    if (!seen.has(a)) { seen.add(a); pts.push(s.from); }
    if (!seen.has(b)) { seen.add(b); pts.push(s.to); }
  }
  if (pts.length === 0) return null;
  let lat = 0, lng = 0;
  for (const p of pts) { lat += p.lat; lng += p.lng; }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

/**
 * Build a fresh overlay against the given Cesium viewer. Caller is
 * responsible for invoking `clear()` when the lifecycle ends (mode
 * change, finalize, cancel, unmount).
 */
export function createSegmentArrowOverlay(viewer: any, C: any): SegmentArrowOverlay {
  let entities: any[] = [];
  let pickHandlers: Array<(id: string) => void> = [];
  let ssHandler: any = null;

  function clear(): void {
    for (const e of entities) {
      try { viewer.entities.remove(e); } catch { /* ignore */ }
    }
    entities = [];
    if (ssHandler) {
      try { ssHandler.destroy(); } catch { /* ignore */ }
      ssHandler = null;
    }
  }

  function update(opts: SegmentArrowUpdateOpts): void {
    clear();
    const { segments, refLat, refHeightM } = opts;
    if (!segments || segments.length === 0) return;
    if (!viewer || !C) return;

    // Install the LEFT_CLICK handler. We always install it fresh on
    // every update so the closure captures the current entity set —
    // a single global handler would risk stale references after clear.
    try {
      ssHandler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
      ssHandler.setInputAction((event: any) => {
        try {
          const pos = event?.position;
          if (!pos) return;
          const picked = viewer.scene.pick(pos);
          if (!picked || !picked.id) return;
          const segId = (picked.id as any).__segmentId;
          if (typeof segId !== 'string' || !segId) return;
          for (const h of pickHandlers) {
            try { h(segId); } catch { /* don't let one bad handler break others */ }
          }
        } catch { /* swallow — pick is best-effort */ }
      }, C.ScreenSpaceEventType.LEFT_CLICK);
    } catch { /* if ScreenSpaceEventHandler is unavailable, just skip picks */ }

    // Outward reference = polygon centroid. For a 2-point polyline
    // (single edge, no centroid) the defaultOutwardNormal function
    // falls back to a deterministic perpendicular.
    const centroid = polygonCentroid(segments);

    for (const seg of segments) {
      try {
        const mid = computeMidpoint(seg.from, seg.to);
        const base = defaultOutwardNormal(seg.from, seg.to, centroid, refLat);
        const signed = {
          east:  base.east  * seg.normalDir,
          north: base.north * seg.normalDir,
        };
        const bearing = bearingOf(signed);
        // Lift the arrow ~0.6m above the base height so it floats
        // above the satellite drape and is not z-fought by the
        // existing orange preview polyline. disableDepthTestDistance
        // (set on the billboard below) makes the lift optional, but
        // a small lift keeps the arrow from being half-occluded by
        // the drape at oblique camera angles.
        const h = (Number.isFinite(refHeightM) ? refHeightM : 0) + 0.6;
        const position = safeCartesian3(C, mid.lng, mid.lat, h);
        if (!position) continue;
        const ent = viewer.entities.add({
          id: `seg-arrow-${seg.id}`,
          name: `Segment arrow ${seg.id}`,
          position,
          billboard: {
            image: ARROW_IMAGE_DATA_URL,
            // 24 px display is the visual sweet spot — large enough
            // to read against the satellite imagery, small enough to
            // not crowd a 4-edge block. The image is 32×32 with
            // built-in padding, so the visible arrow is ~20 px.
            width: 24,
            height: 24,
            // Cesium billboard rotation is counter-clockwise from up
            // (north). Our bearing is clockwise from north, so we
            // negate.
            rotation: -bearing,
            // Center the rotation pivot on the arrow body
            verticalOrigin: C.VerticalOrigin.CENTER,
            horizontalOrigin: C.HorizontalOrigin.CENTER,
            // Always visible — depth test off so the arrow never
            // disappears behind terrain or the block preview polyline.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // tint white (no color shift) so the SVG's yellow comes
            // through unchanged
            color: C.Color.WHITE,
          },
        });
        (ent as any).__segmentId = seg.id;
        entities.push(ent);
      } catch { /* skip this segment on any error, continue with the rest */ }
    }
  }

  function onPick(handler: (id: string) => void): () => void {
    pickHandlers.push(handler);
    return () => {
      pickHandlers = pickHandlers.filter(h => h !== handler);
    };
  }

  return { update, clear, onPick };
}

// Re-export the shared SegmentDescriptor so callers can import it
// from the overlay path too (avoids the two-import dance).
export type { SegmentDescriptor };

// Re-export the factory for the buildSegmentsFromPoints convenience
// so the segments/ folder is the single import surface for the
// block line-trace integration.
export {
  buildSegmentsFromPoints,
  defaultOutwardNormal,
  bearingOf,
  flipNormalDir,
  midpoint,
} from '@/lib/3d/segmentArrows';
