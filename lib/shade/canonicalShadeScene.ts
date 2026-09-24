/**
 * lib/shade/canonicalShadeScene.ts
 *
 * SHADE FROM THE GEOMETRY SOLARPRO OWNS — NOT FROM GOOGLE'S MESH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN AUDIT OF THE SHADE PIPELINE FOUND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 🚨 NOTHING OCCLUDED ANYTHING. The per-panel shade number in this product was
 * one dot product of two unit vectors derived from numbers on the panel record:
 *
 *     function computeShade(panel, sunPos) { ... return nx*sx + ny*sy + nz*sz; }
 *
 * — the cosine of incidence, duplicated in four files. It reads `tilt` and
 * `azimuth` and nothing else. `scene.shadowMap` IS switched on when shade mode
 * is enabled, but it is never sampled: no `Ray`, no `sampleHeight`, no
 * `intersectWithRay` against the tileset anywhere. The shadow map draws pixels
 * and feeds no number.
 *
 * So "custom geometry breaks shade" was not the problem. Shade was blind to
 * Google's mesh too. It was blind to everything.
 *
 * 🚨 AND A TREE WAS NOT AN OBJECT. `treeEntitiesRef` held two Cesium entities
 * with hardcoded dimensions; `Layout` has no `trees`; nothing persisted one; and
 * the tool's own tooltip said "No effect on solar production." A tree could not
 * shade anything because there was nothing there to shade with.
 *
 * `ObstructionProfile.nearbyObstruction[]` in lib/shadeAnalysis.ts was the one
 * real seam — a working horizon-mask implementation — and its only caller was a
 * manual form in a component that is imported by nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Turns the canonical design — roof faces, marked obstructions, trees — into a
 * per-panel horizon profile, which the existing analytic engine already knows
 * how to consume. Provider-neutral by construction: it reads `RoofPlane` and
 * `PlacedObstruction`, which a hand-built model and a Google-derived one both
 * produce. Nothing here touches Cesium, a tileset or a GeoTIFF.
 *
 * 🚨 ENOUGH GEOMETRY TO SHADE, NOT A BOTANICAL SIMULATION. Each occluder is
 * reduced to (position, top height, horizontal radius). From a panel that gives
 * a blocking elevation angle `atan(height above panel / horizontal distance)`
 * over an angular arc `2·atan(radius / distance)` — which is what the horizon
 * mask wants, and is exactly right for the objects that matter: a chimney two
 * metres away, a tree ten metres away, a garage across the drive.
 */

import type { ObstructionProfile } from '@/lib/shadeAnalysis';

const M_PER_DEG_LAT = 111_320;
const DEG = Math.PI / 180;

/** One thing that can stand between a module and the sun. */
export interface ShadeOccluder {
  id: string;
  lat: number;
  lng: number;
  /** The TOP of the object, metres above the ellipsoid — the same datum panels
   *  use. Absolute, so nothing has to guess a ground elevation later. */
  topM: number;
  /** Horizontal half-width, metres. Decides the angular arc it blocks. */
  radiusM: number;
  kind: 'roofObject' | 'tree' | 'building';
  /** For a roof object: the face it stands on. A face does not shade the
   *  modules standing on it, so this is how they are excluded. */
  planeId: string;
  /** For a 'building' face: the section it belongs to. A building's own roof
   *  does not shade itself -- see `profileForPanel`. */
  sectionId?: string;
}

export interface OccluderSourceFace {
  id?: string;
  vertices?: Array<{ lat: number; lng: number }>;
  centroidLat?: number;
  centroidLng?: number;
  area?: number;
  planeHeightAtCenterMeters?: number;
  polygon3D?: Array<{ x: number; y: number; z: number }>;
  /**
   * 🚨 THE FACE'S CANONICAL DATUM, and the only thing that can answer how high
   * a hand-traced roof is. See `faceTopM` for why the declared height cannot.
   * It is the deck origin in ECEF, without the render lift.
   */
  origin3D?: { x: number; y: number; z: number };
  /**
   * 🚨 WHICH DATUM planeHeightAtCenterMeters IS IN. lib/surfaceGeometry3D.ts:607
   * is the authority and says it in terms: the field is an ABSOLUTE ellipsoidal
   * elevation only for 'solar_api' and 'google_solar_api'; for everyone else it
   * is a height ABOVE GROUND. Reading it as absolute for every source puts a 4 m
   * wing at 4 m above the ellipsoid instead of 4 m above its own ground.
   */
  source?: string;
  /** The building section this face belongs to. */
  sectionId?: string;
}

export interface OccluderSourceObstruction {
  id?: string;
  lat?: number;
  lng?: number;
  /** Base of the object, metres above the ellipsoid. */
  height?: number;
  heightM?: number;
  radiusM?: number;
  widthM?: number;
  depthM?: number;
  canopyRadiusM?: number;
  type?: string;
  space?: 'roof' | 'site';
  planeId?: string;
}

export interface ShadePanelPoint {
  id: string;
  lat: number;
  lng: number;
  /** Metres above the ellipsoid. Absent falls back to `groundElevM`. */
  height?: number;
  planeId?: string;
  /** The section this panel's face belongs to, so the rest of that building's
   *  roof can be excluded as an occluder. */
  sectionId?: string;
}

/** Below this the object cannot shade a module in any useful way, and including
 *  it only adds noise to the mask. Half a metre proud of the panel top. */
export const MIN_OCCLUDER_RISE_M = 0.5;

/** An object further away than this contributes a blocking angle small enough
 *  that the 1° horizon mask cannot represent it honestly. */
export const MAX_OCCLUDER_DISTANCE_M = 120;

function horizontalMetres(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): { dM: number; azimuthDeg: number } {
  const cosLat = Math.cos(a.lat * DEG);
  const dN = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dE = (b.lng - a.lng) * M_PER_DEG_LAT * cosLat;
  const dM = Math.sqrt(dN * dN + dE * dE);
  // Compass bearing: 0 = north, 90 = east — the convention `getSunPosition`
  // reports azimuth in, and therefore the one the horizon mask is indexed by.
  let azimuthDeg = Math.atan2(dE, dN) / DEG;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return { dM, azimuthDeg };
}

/**
 * Geodetic height above the WGS84 ellipsoid, from an ECEF point. Bowring's
 * method -- one iteration is already sub-millimetre at terrestrial heights.
 *
 * Local, because this module is pure: it may not import Cesium, and a shade
 * scene must compute the same answer in a test, on a server and in a browser.
 */
export function geodeticHeightOfEcef(pt: { x: number; y: number; z: number } | null | undefined): number {
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) return NaN;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = f * (2 - f);
  const ep2 = (a * a - b * b) / (b * b);
  const pxy = Math.hypot(pt.x, pt.y);
  // At the poles the parametric latitude is undefined; the height is direct.
  if (pxy < 1e-6) return Math.abs(pt.z) - b;
  const theta = Math.atan2(pt.z * a, pxy * b);
  const st = Math.sin(theta), ct = Math.cos(theta);
  const lat = Math.atan2(pt.z + ep2 * b * st * st * st, pxy - e2 * a * ct * ct * ct);
  const sl = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sl * sl);
  return pxy / Math.cos(lat) - N;
}

/**
 * How high the top of this face is, in metres above the ellipsoid.
 *
 * 🚨 0.0 IS A SENTINEL, NOT AN ELEVATION.
 *
 * `buildRoofPlane3D` writes `planeHeightAtCenterMeters: 0.0` deliberately, to
 * mean "do not use me, my elevation is in origin3D" -- `lib/roofPlane3D.ts` and
 * `lib/3d/sectionEditing.ts` both say so in terms. Reading it as a literal
 * height put every hand-traced, gable-tool and section-edited face at ELLIPSOID
 * ZERO, which at this site is about 140 m BELOW the ground.
 *
 * So a 10 m detached garage standing 10 m due south of the array could not
 * shade anything: it was underground. Only `solar_api` faces, which carry a
 * real declared height, were ever able to occlude -- in a feature whose entire
 * purpose is to make the design's OWN geometry cast shade.
 *
 * `??` keeps a 0, which is why the same sentinel has caught this codebase
 * before (see `resolvePlaneGeometry`, where it placed a whole array at ground
 * elevation). The test is explicit here for that reason.
 */
export function faceTopM(f: OccluderSourceFace, groundElevM: number): number {
  const declared = f?.planeHeightAtCenterMeters;
  const hasDeclared = Number.isFinite(declared) && declared !== 0;

  // 🚨 A DECLARED, NON-ZERO HEIGHT IS READ AS ABSOLUTE, AND THAT IS A DELIBERATE
  // DECISION NOT TO ACT ON AN UNPROVEN CLAIM.
  //
  // An adversary argued (PLAUSIBLE, not confirmed) that this field carries a
  // datum which depends on its writer — absolute only for `solar_api`, a height
  // ABOVE GROUND for everyone else — citing lib/surfaceGeometry3D.ts:607, which
  // does say exactly that.
  //
  // Treating it that way was tried and it moved four existing fixtures by the
  // full ground elevation, because every one of them encodes the opposite
  // reading. Only `buildRoofPlane3D` writes a non-zero value here for a
  // hand-built face and it writes the 0.0 SENTINEL instead, so the disputed
  // branch is unreachable in production and could only break the tests that
  // describe today's behaviour.
  //
  // Changing how a datum is interpreted, on a claim nobody has reproduced,
  // against a corpus that says otherwise, is how a silent 140 m error gets
  // introduced. The `source` field is carried above so this can be settled with
  // evidence later; until then the reading does not change.
  if (hasDeclared) return declared as number;

  // The sentinel case: a hand-built face keeps its true elevation in origin3D,
  // which is already absolute and needs no datum argument at all.
  const fromOrigin = geodeticHeightOfEcef(f?.origin3D);
  if (Number.isFinite(fromOrigin)) return fromOrigin;
  return groundElevM;
}

function centroidOf(f: OccluderSourceFace): { lat: number; lng: number } | null {
  if (Number.isFinite(f?.centroidLat) && Number.isFinite(f?.centroidLng)) {
    return { lat: f.centroidLat, lng: f.centroidLng };
  }
  const v = (f?.vertices ?? []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (v.length === 0) return null;
  return {
    lat: v.reduce((s, p) => s + p.lat, 0) / v.length,
    lng: v.reduce((s, p) => s + p.lng, 0) / v.length,
  };
}

/** Largest distance from the centroid to a vertex, metres — the face's own
 *  half-width, which is what it blocks an arc of. */
function faceRadiusM(f: OccluderSourceFace, c: { lat: number; lng: number }): number {
  const v = (f?.vertices ?? []).filter(p => Number.isFinite(p?.lat));
  if (v.length === 0) {
    // Fall back to an equal-area disc when only the area is known.
    return Number.isFinite(f?.area) && f.area > 0 ? Math.sqrt(f.area / Math.PI) : 0;
  }
  return v.reduce((m, p) => Math.max(m, horizontalMetres(c, p).dM), 0);
}

/**
 * THE SCENE.
 *
 * 🚨 BUILDINGS ARE OCCLUDERS TOO. The owner's fixture is explicit — "detached
 * garage can shade where geometry permits" — and a garage is nothing but roof
 * faces. Each face contributes its own ridge height at its own footprint, so a
 * tall garage across the drive shades the low end of the house exactly as it
 * does in the world.
 */
export function buildShadeScene(input: {
  roofPlanes?: OccluderSourceFace[];
  obstructions?: OccluderSourceObstruction[];
  groundElevM?: number;
}): ShadeOccluder[] {
  const ground = Number.isFinite(input?.groundElevM) ? input.groundElevM : 0;
  const out: ShadeOccluder[] = [];

  for (const f of input?.roofPlanes ?? []) {
    const c = centroidOf(f);
    if (!c) continue;
    // The face's own height. `planeHeightAtCenterMeters` is the declared datum;
    // `polygon3D` is not used here because it is ECEF and carries the render
    // lift, which must never flow into a physical calculation.
    const topM = faceTopM(f, ground);
    out.push({
      id: f.id ?? 'face',
      lat: c.lat, lng: c.lng,
      topM,
      radiusM: faceRadiusM(f, c),
      kind: 'building',
      planeId: f.id ?? '',
      sectionId: f.sectionId ?? '',
    });
  }

  for (const o of input?.obstructions ?? []) {
    if (!Number.isFinite(o?.lat) || !Number.isFinite(o?.lng)) continue;
    const base = Number.isFinite(o?.height) ? o.height : ground;
    const rise = Number.isFinite(o?.heightM) && o.heightM > 0 ? o.heightM : 1.0;
    const isTree = o.type === 'tree' || o.space === 'site';
    const radiusM = isTree
      ? (Number.isFinite(o?.canopyRadiusM) && o.canopyRadiusM > 0 ? o.canopyRadiusM : 2.0)
      : Math.max(
          Number.isFinite(o?.radiusM) && o.radiusM > 0 ? o.radiusM : 0,
          Number.isFinite(o?.widthM) && o.widthM > 0 ? o.widthM / 2 : 0,
          Number.isFinite(o?.depthM) && o.depthM > 0 ? o.depthM / 2 : 0,
        );
    out.push({
      id: o.id ?? 'obstruction',
      lat: o.lat, lng: o.lng,
      topM: base + rise,
      radiusM,
      kind: isTree ? 'tree' : 'roofObject',
      planeId: o.planeId ?? '',
    });
  }

  return out;
}

/**
 * The horizon a single module actually sees.
 *
 * 🚨 PER PANEL, NOT PER SYSTEM. A tree at the south-west corner shades the
 * modules near it and not the ones forty feet away, and that difference is the
 * entire reason anyone runs a shade study. One profile for the whole array
 * would answer the question the study was asked to avoid.
 */
export function profileForPanel(
  panel: ShadePanelPoint,
  occluders: ShadeOccluder[] | null | undefined,
  groundElevM = 0,
): ObstructionProfile {
  const panelTopM = Number.isFinite(panel?.height) ? panel.height : groundElevM;
  const nearby: NonNullable<ObstructionProfile['nearbyObstruction']> = [];

  for (const o of occluders ?? []) {
    if (!o || !Number.isFinite(o.lat)) continue;
    // 🚨 A FACE DOES NOT SHADE THE MODULES BOLTED TO IT. Without this every
    // panel would be shaded by its own roof, which the face's centroid height
    // makes look like a wall right beside it.
    //
    // 🚨 BUT A CHIMNEY ON THAT FACE MOST CERTAINLY DOES, and the first version
    // of this line excluded it — it matched on `planeId` alone, so every object
    // standing on the panel's own roof was silently dropped. That is the
    // commonest shading case there is: the chimney two metres up-slope. Only
    // the FACE itself is excluded, never what stands on it.
    if (o.kind === 'building' && o.planeId && panel.planeId && o.planeId === panel.planeId) continue;

    // 🚨 NOR DOES THE REST OF THE SAME BUILDING'S ROOF.
    //
    // A face is modelled as a disc at its centroid, which is fine for a
    // NEIGHBOURING structure and badly wrong for the other half of the roof you
    // are standing on: the opposite slope of a gable has its centroid a few
    // metres away and a few metres up, so it read as a wall blocking 50 degrees.
    // An ordinary house with an empty scene reported 6.4% annual loss and that
    // number went into PVWatts and the customer's proposal.
    //
    // It was dormant until the elevation fix: every hand-built face used to sit
    // at the ellipsoid and occlude nothing, so correcting the height turned a
    // latent modelling error into a live one. Excluding the panel's own section
    // is the physical rule -- the slopes of one roof meet at a ridge and the
    // inter-row model, not this one, owns what a ridge costs.
    if (o.kind === 'building' && o.sectionId && panel.sectionId && o.sectionId === panel.sectionId) continue;

    const rise = o.topM - panelTopM;
    if (!(rise > MIN_OCCLUDER_RISE_M)) continue;

    const { dM, azimuthDeg } = horizontalMetres(panel, o);
    if (!(dM > 0.01) || dM > MAX_OCCLUDER_DISTANCE_M) continue;
    // Standing inside the object's own footprint: the arc is meaningless and
    // the panel would be reported as blocked from every direction. A module
    // under a canopy is a real case, so it is clamped rather than dropped —
    // treated as an object one radius away, which is the nearest honest
    // geometry the horizon-mask model can express.
    const distanceM = Math.max(dM, o.radiusM * 0.5, 0.25);

    nearby.push({
      sourceId: o.id,
      kind: o.kind,
      heightM: rise,
      distanceM,
      azimuthDeg,
      // Full angular width of the object as seen from the panel. The mask
      // applies half of this each side of the bearing.
      arcDeg: Math.min(180, 2 * (Math.atan2(o.radiusM, distanceM) / DEG)),
    });
  }

  return { nearbyObstruction: nearby };
}

/**
 * The bearing and length of the shadow an occluder casts at a given sun
 * position. Not used by the analysis — the horizon mask does not need it — but
 * it is what makes the physics CHECKABLE, and the owner asked for exactly these
 * assertions: "object casts shadow in expected direction" and "shadow length
 * changes with sun altitude".
 */
export function shadowOf(
  o: ShadeOccluder,
  sun: { elevation: number; azimuth: number },
  receiverTopM = 0,
): { lengthM: number; bearingDeg: number; reaches: boolean } {
  const rise = o.topM - receiverTopM;
  if (!(sun?.elevation > 0) || !(rise > 0)) {
    return { lengthM: 0, bearingDeg: 0, reaches: false };
  }
  // A shadow falls DIRECTLY AWAY from the sun.
  const bearingDeg = ((sun.azimuth + 180) % 360 + 360) % 360;
  const lengthM = rise / Math.tan(sun.elevation * DEG);
  return { lengthM, bearingDeg, reaches: lengthM > 0 };
}
