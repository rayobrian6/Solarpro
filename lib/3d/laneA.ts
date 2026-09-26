/**
 * lib/3d/laneA.ts
 *
 * LANE A — the conversion half. Google Solar roof segments in, canonical
 * RoofPlanes out, with provenance and site ownership stamped.
 *
 * WHY THIS IS A MODULE AND NOT AN INNER FUNCTION
 * ----------------------------------------------
 * This logic lived inside SolarEngine3D.tsx, a ~13,800-line client component
 * that cannot be instantiated in a test: it needs Cesium, a WebGL context, a
 * viewer, terrain and a Google API key, none of which exist in CI or on the
 * dev machine. So the only automated cover the roof-acquisition path could ever
 * have was of its *trigger predicate*, never of the geometry or the
 * provenance — the parts that actually reach a permit drawing.
 *
 * Extracting it lets the integration harness run the REAL production
 * conversion against archived Google Solar payloads, rather than a
 * reimplementation in a test that would drift from it. SolarEngine3D imports
 * these and keeps its Cesium-bound work (entity rendering, picking) to itself.
 *
 * 🚨 The geometry below is PROVEN and load-bearing. Do not "simplify" it:
 *   • the hull is built at its REAL shape so the panel grid CLIPS to the face
 *     rather than overshooting onto the ground;
 *   • __eaveDirENU is attached so the grid runs columns along the eave instead
 *     of along whichever hull edge happens to be most horizontal — that is what
 *     stops panels marching sideways across an irregular roof;
 *   • heights are baseH - along*tan(pitch), so downslope is LOWER.
 */

import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import {
  nativeAcquisitionPermitted,
  type NativeGeometryDisposition,
} from '@/lib/design/nativeGeometryDisposition';
import {
  acquisitionPermittedByLifecycle,
  type DesignGeometryLifecycle,
} from '@/lib/design/deletionAuthority';
import type { RoofPlane } from '@/types';

/** The shape Lane A consumes. This is `RoofSegment` as lib/digitalTwin.ts emits
 *  it — convexHull is a MEASURED footprint derived from Google's own solarPanels
 *  centres, not the bounding box that roofSegmentStats gives. */
export interface LaneASegment {
  center?: { lat: number; lng: number } | null;
  convexHull?: Array<{ lat: number; lng: number }> | null;
  pitchDegrees?: number;
  azimuthDegrees?: number;
  /** Already converted from Google's sea-level planeHeightAtCenterMeters by
   *  lib/digitalTwin.ts. 🚨 app/api/solar/route.ts forwards the sea-level value
   *  UNCONVERTED, which is one reason Lane A does not use that endpoint. */
  heightAboveGround?: number;
}

/** Minimum face extent, in metres, along both the eave and the slope. Below
 *  this a "segment" is noise — a chimney flashing or a bay window — and a panel
 *  grid on it would be meaningless. */
export const MIN_FACE_EXTENT_M = 0.5;
/** Pitch is clamped to this range. Google occasionally returns absurd values on
 *  low-quality imagery, and a 90° "roof" produces a vertical plane. */
export const PITCH_CLAMP_DEG = { min: 0, max: 60 } as const;
/** Fallbacks for a segment missing a value. Chosen to be obviously ordinary
 *  rather than clever — a wrong-but-plausible roof is easier for an operator to
 *  spot and correct than a wrong-and-exotic one. */
export const SEGMENT_DEFAULTS = { pitchDeg: 20, azimuthDeg: 180, heightAboveGroundM: 3.0 } as const;

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

/**
 * Convert ONE Google Solar roof segment into a tilted 3D RoofPlane.
 *
 * Returns null — never a fabricated plane — when the segment cannot support
 * one: no hull, fewer than 3 hull points, an invalid centre, or a face smaller
 * than MIN_FACE_EXTENT_M in either direction. A caller that wants to know
 * "did this address have coverage?" must count the nulls, not assume.
 *
 * 🚨 `groundElevM` must be the RESOLVED ground elevation. lib/surfaceGeometry3D
 * treats 0 as the "unresolved" sentinel, so passing 0 in a test produces a
 * false green: the plane lands at sea level and nothing complains.
 */
export function segmentToRoofPlane(seg: LaneASegment | null | undefined, groundElevM: number): RoofPlane | null {
  try {
    const hull = (seg?.convexHull && seg.convexHull.length >= 3) ? seg.convexHull : null;
    if (!hull || !seg?.center || !isValidCoord(seg.center.lat, seg.center.lng)) return null;

    const DEG = Math.PI / 180;
    const pitch = Number.isFinite(seg.pitchDegrees as number)
      ? Math.max(PITCH_CLAMP_DEG.min, Math.min(PITCH_CLAMP_DEG.max, seg.pitchDegrees as number))
      : SEGMENT_DEFAULTS.pitchDeg;
    const az = Number.isFinite(seg.azimuthDegrees as number)
      ? (seg.azimuthDegrees as number) : SEGMENT_DEFAULTS.azimuthDeg;
    const hAG = Number.isFinite(seg.heightAboveGround as number)
      ? (seg.heightAboveGround as number) : SEGMENT_DEFAULTS.heightAboveGroundM;

    const baseH = groundElevM + hAG;
    const tanP = Math.tan(pitch * DEG);
    const cosLat = Math.cos(seg.center.lat * DEG);
    const mLat = 111320, mLng = 111320 * (cosLat > 0.01 ? cosLat : 1);

    // Downslope (azimuth) + eave (perpendicular) horizontal unit vectors in (E,N).
    const dsE = Math.sin(az * DEG), dsN = Math.cos(az * DEG);
    const evE = Math.cos(az * DEG), evN = -Math.sin(az * DEG);

    // Size guard from the face extent along eave + slope.
    let minEv = Infinity, maxEv = -Infinity, minSl = Infinity, maxSl = -Infinity;
    for (const v of hull) {
      if (!Number.isFinite(v?.lat) || !Number.isFinite(v?.lng)) return null;
      const dE = (v.lng - seg.center.lng) * mLng;
      const dN = (v.lat - seg.center.lat) * mLat;
      const ev = dE * evE + dN * evN;
      const sl = dE * dsE + dN * dsN;
      if (ev < minEv) minEv = ev; if (ev > maxEv) maxEv = ev;
      if (sl < minSl) minSl = sl; if (sl > maxSl) maxSl = sl;
    }
    if (!(maxEv - minEv > MIN_FACE_EXTENT_M) || !(maxSl - minSl > MIN_FACE_EXTENT_M)) return null;

    const hullPts3D = hull.map(v => {
      const dE = (v.lng - seg.center!.lng) * mLng;
      const dN = (v.lat - seg.center!.lat) * mLat;
      const along = dE * dsE + dN * dsN; // metres downslope (+ = lower)
      return latLngToECEF(v.lat, v.lng, baseH - along * tanP);
    });
    if (hullPts3D.length < 3) return null;

    const plane = buildRoofPlane3D(hullPts3D);
    (plane as any).__eaveDirENU = { x: evE, y: evN };
    return plane;
  } catch {
    return null;
  }
}

/** Everything Lane A stamps onto a detected plane, in one place. */
export interface LaneAProvenance {
  /** The physical site this detection answers for, captured at FIRE time. */
  siteKey?: string;
}

/**
 * Stamp machine-detection provenance onto converted planes.
 *
 * 🚨 These came from Google Solar, not from a person. buildRoofPlane3D
 * hardcodes source:'manual' and confirmed:true because it was only ever called
 * for hand-traced faces — so both are overridden here rather than letting a
 * detection assert itself as somebody's decision. A reviewer, the sidebar and
 * the permit path all key off these fields to tell a guess from a commitment.
 */
export function stampDetectedProvenance(
  planes: readonly RoofPlane[],
  provenance: LaneAProvenance = {},
): RoofPlane[] {
  return planes.map((p, i) => {
    p.source = 'solar_api';
    p.confirmed = false;
    if (p.solarSegmentIndex == null) p.solarSegmentIndex = i;
    if (provenance.siteKey) p.siteKey = provenance.siteKey;
    return p;
  });
}

/**
 * DID A PERSON MODEL THIS FACE, OR DID A MACHINE DETECT IT?
 *
 * 🚨 THE ANSWER LIVED IN THE WRONG FIELD, AND IT ANSWERED "PERSON" FOR EVERY
 * GOOGLE DETECTION.
 *
 * Four call sites asked it as `source === 'manual' || createdFrom3D === true`:
 *
 *     components/3d/SolarEngine3D.tsx   the Auto Layout subject-building seed
 *     components/3d/SolarEngine3D.tsx   the "a manual trace wins" de-dup
 *     components/design/DesignStudio.tsx  the same two, on the 2D side
 *
 * But `createdFrom3D` does not mean "a human made this". It means "this face
 * carries exact 3D geometry", and `lib/surfaceGeometry3D.ts` gates the good
 * ECEF placement branch on it. Lane A builds its planes with the same
 * `buildRoofPlane3D` the tracing tool uses, and `stampDetectedProvenance`
 * deliberately does NOT clear that flag — clearing it would push every Google
 * face onto the legacy 2D branch, which is a real regression on the preferred
 * provider.
 *
 * So every `source: 'solar_api'` plane also carries `createdFrom3D: true`, and
 * `dropDetectedPlanesOverlappingManual` — whose entire job is "the same roof
 * captured twice was double-filling, the manual trace wins" — returned `true`
 * at its first line for the detection as well, and dropped nothing. It worked
 * for `aerial_nearmap` (which is built elsewhere and has no such flag) and was
 * inert for Google. That is precisely the case a person hits after tracing over
 * a Google roof they judged wrong, which is the fallback workflow.
 *
 * Authorship is `source`. Geometry is `createdFrom3D`. They are different facts.
 *
 * The `createdFrom3D` fallback is KEPT for a face that records no `source` at
 * all — a pre-provenance plane whose exact 3D geometry can only have come from
 * someone tracing it. It is a legacy adoption rule, not the rule.
 */
export function isHandModelledFace(plane: unknown): boolean {
  const p = plane as { source?: string; createdFrom3D?: boolean } | null | undefined;
  if (!p) return false;
  if (p.source === 'manual' || p.source === 'imported') return true;
  // A DETECTION is a detection whatever its geometry is made of.
  if (p.source === 'solar_api' || p.source === 'aerial_nearmap') return false;
  return p.createdFrom3D === true;
}

/**
 * The whole conversion: segments in, stamped RoofPlanes out.
 *
 * Segments that cannot produce a plane are DROPPED, not faked — so an empty
 * result is a real "no usable coverage here" answer and callers may report it
 * as such.
 */
export function laneAPlanesFromSegments(
  segments: readonly LaneASegment[] | null | undefined,
  groundElevM: number,
  provenance: LaneAProvenance = {},
): RoofPlane[] {
  const converted = (segments ?? [])
    .map(s => segmentToRoofPlane(s, groundElevM))
    .filter((p): p is RoofPlane => !!p);
  return stampDetectedProvenance(converted, provenance);
}

/** Inputs to the Lane A gate. Every one is read from a REF at fire time, never
 *  captured in a closure — the decision must reflect the state that exists when
 *  the twin promise resolves, not when it was scheduled. */
export interface LaneAGateInput {
  stage: string;
  groundElevResolved: boolean;
  segmentCount: number;
  /**
   * 🚨 NO LONGER THE AUTHORITY, AND KEPT ONLY AS A CONSISTENCY CHECK.
   *
   * This integer was asked a question it cannot answer. Zero planes is the same
   * number whether nobody has modelled this house yet or somebody modelled it
   * and threw it away — and those two facts must produce OPPOSITE answers here.
   * Emptying the roof is how a person says a Google model is not good enough,
   * so reading zero as "go ahead and acquire" re-injected exactly what had just
   * been removed. It is still read, because a design that HAS geometry must
   * never have a machine's guess appended to it, but "may we acquire at an
   * empty property" is now `lifecycle`'s question.
   */
  existingPlaneCount: number;
  /**
   * WHAT HAPPENED TO THIS PROPERTY'S GEOMETRY, as a fact rather than an
   * inference. See lib/design/deletionAuthority.ts.
   *
   * Optional so every existing caller and test keeps compiling; absent is read
   * as derived-from-the-count, which is exactly the behaviour before this
   * existed.
   *
   * 🚨 THERE IS NO "NOT YET KNOWN" MEMBER, ON PURPOSE. It was proposed: the
   * production caller's ref starts at `untouched` and is only assigned the real
   * answer once the design hydrates, so a deliberately cleared property — which
   * also has zero planes — would be granted acquisition if the gate could be
   * evaluated in that window. It cannot be. The caller cannot open
   * `restoreResolved` until after the ledger is installed, and the two values
   * sit on opposite sides of React's render/effect boundary in the right order.
   * See tests/laneAAcquisitionOrdering.test.tsx, which pins every step of that
   * ordering.
   *
   * 🚨 AND ADDING ONE WOULD HAVE BEEN WORSE THAN THE BUG. Nothing consumes this
   * union exhaustively — there is no `switch` on it anywhere. Every consumer
   * asks `=== 'cleared'` or `!== 'cleared'` (the Auto Fill door in
   * SolarEngine3D, the aerial-detect door and the three Roof Planes controls in
   * DesignStudio), so a fourth member would have fallen into each `else` and
   * been treated as PERMISSIVE, at the one door that re-acquires geometry. Only
   * `acquisitionPermittedByLifecycle` would have refused it, and `tsc` could not
   * have flagged any of the rest.
   */
  lifecycle?: DesignGeometryLifecycle;
  restoreResolved: boolean;
  siteKey: string;
  lastRanSiteKey: string | null;
  /**
   * What the installer has decided about this property's native geometry.
   * Optional so every existing caller and test keeps compiling; absent is read
   * as `undecided`, which is exactly the behaviour before this existed.
   * See lib/design/nativeGeometryDisposition.ts.
   */
  nativeDisposition?: NativeGeometryDisposition;
}

/**
 * Should Lane A run right now?
 *
 * 🚨 THIS IS THE GUARD THAT KEEPS LANE A A *STARTING SHAPE* AND NEVER A
 * REPLACEMENT. Every condition is a refusal. The two that matter most:
 *
 *  • `existingPlaneCount === 0` — detected planes merge by id, so running
 *    against a design that already has geometry would append a machine's guess
 *    beside a person's traced roof, and the autosave would persist it.
 *  • `restoreResolved` — detection lands in React state immediately while the
 *    autosave fence only blocks the WRITE. Detect too early and the planes are
 *    already in state when the fence opens, so the first tick persists them
 *    over the stored roof. Gating the detection is the only thing that prevents
 *    it.
 */
export function shouldRunLaneA(i: LaneAGateInput): boolean {
  if (i.stage !== 'done') return false;
  if (!i.groundElevResolved) return false;
  if (!i.restoreResolved) return false;
  if (i.segmentCount <= 0) return false;
  // 🚨 A JUDGEMENT OUTRANKS A PLANE COUNT, and must be checked even when the
  // count is zero — because clearing the bad planes IS how the installer says
  // no. Before this, "Draw Manually Instead" emptied the array, the empty
  // bundle was pruned rather than archived, and the next 2D map pan of more
  // than ~12 m produced a new site key, satisfied every remaining condition,
  // and re-injected the exact planes that had just been rejected. No address
  // change required. `existingPlaneCount` cannot express a decision; it can
  // only observe a consequence, and the consequence is what the rejection
  // removes.
  if (!nativeAcquisitionPermitted(i.nativeDisposition ?? 'undecided')) return false;
  if (i.existingPlaneCount !== 0) return false;
  // 🚨 AND A DELIBERATE CLEARING REFUSES TOO, which the count above cannot say.
  //
  // The disposition covers "I looked at Google's roof and rejected it" and "a
  // hand-built model governs here". It does NOT cover the commonest gesture of
  // all: selecting the bad faces and deleting them, or pressing Start Over.
  // Those leave the disposition at `accepted` or `undecided` — both of which
  // permit acquisition — and leave the plane count at zero, which used to BE
  // the permission. So the two guards together said yes to the one case the
  // whole feature exists to refuse. `lifecycle` is the fact that was missing.
  //
  // Absent means "derive it from the count", which is the behaviour that
  // existed before the ledger and keeps every older caller honest.
  if (!acquisitionPermittedByLifecycle(i.lifecycle ?? 'untouched')) return false;
  if (!i.siteKey) return false;
  if (i.lastRanSiteKey === i.siteKey) return false;
  return true;
}

/** What the UI should say about automatic detection at this address. Derived
 *  from the twin so a rural address reports "we tried and there is nothing"
 *  rather than "not tried yet", which is how the old copy read. */
export function detectionStatusFromSegmentCount(segmentCount: number | null | undefined): 'loading' | 'unavailable' {
  return segmentCount && segmentCount > 0 ? 'loading' : 'unavailable';
}
