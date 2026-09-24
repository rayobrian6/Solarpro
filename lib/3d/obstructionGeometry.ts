/**
 * lib/3d/obstructionGeometry.ts
 *
 * WHAT SHAPE IS THIS OBJECT, AND WHERE DOES IT STAND?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every placed object — vent, plumbing stack, skylight, chimney, roof hatch,
 * rooftop unit, tree — was drawn by one call that built a single extruded
 * rectangle from widthM × depthM × heightM. The only difference between a tree
 * and a chimney was the fill colour, and the source said so:
 *
 *     // A tree reads as a tree. It is the same primitive; only the colour
 *     // says which of the two kinds of object it is.
 *
 * 🚨 IT DOES NOT READ AS A TREE. IT IS A GREEN BOX. The owner's test is
 * "can I look at the screen and see a tree roughly 35 ft tall with a 20 ft
 * canopy", and a box answers neither half.
 *
 * There WAS tree-shaped code — `handleTreeClick` built a trunk cylinder and a
 * foliage ellipsoid — but it is dead, it wrote no canonical record, and it
 * hardcoded `trunkHeightM = 2.0` / `foliageRadiusM = 1.8`. So the two halves
 * were never together: one path had the shape and fake dimensions, the other
 * had the dimensions and no shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 AND THE EXTRUSION DATUM WAS ABSOLUTE, NOT RELATIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The draw call passed `perPositionHeight: true, height: 0, extrudedHeight: H`,
 * under a comment claiming those are "RELATIVE to each position's elevation".
 * Measured in real Cesium, in the browser, with positions at 150 m and
 * extrudedHeight 8:
 *
 *     rendered bottom 8 m · rendered top 150 m · 142 m tall
 *
 * `extrudedHeight` is the ALTITUDE OF THE TOP FACE above the ellipsoid. So at
 * any property with a real elevation every object was drawn as a spike running
 * from near the ellipsoid up to the ground, not as an object standing on it.
 *
 * It looked correct in the browser gate for one reason: the ground elevation
 * resolves only from the Google Solar API, so on the test property it is
 * unresolved and reads 0 — and with a base of 0 an absolute top of 8 and a
 * relative top of 8 are the same number. The bug is invisible exactly where it
 * is measured and fatal everywhere it is used.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONE PHYSICAL OBJECT TRUTH. This module turns a canonical `PlacedObstruction`
 * into the parts to draw, and every number it emits is derived from that record.
 * There is no renderer-only dimension, and nothing here invents a size. A part
 * list is plain data with no Cesium in it, so the shape of a 35 ft tree is
 * proven by arithmetic rather than by looking at a screenshot.
 *
 * The same record then drives selection, the inspector, panel exclusion, shade
 * and persistence. If a consumer wants a canopy radius it reads the record's
 * canopy radius — it does not re-derive one.
 */

/** Absolute altitude in metres above the ellipsoid. Never a height above ground. */
export type AbsoluteAltitudeM = number;

export interface ObstructionGeometryInput {
  /** Canonical footprint, east–west, metres. For a tree this is the canopy diameter. */
  widthM: number;
  /** Canonical footprint, north–south, metres. */
  depthM: number;
  /** Canonical height of the object itself, metres. NOT an altitude. */
  heightM: number;
  /** Altitude of the object's BASE — the ground under a tree, the roof under a chimney. */
  baseAltitudeM: AbsoluteAltitudeM;
  /** The preset id, e.g. 'tree', 'chimney'. */
  type?: string;
  /** 'site' objects stand on the ground; 'roof' objects stand on a face. */
  space?: 'roof' | 'site';
}

/** A vertical prism: the footprint rectangle extruded between two ALTITUDES. */
export interface PrismPart {
  kind: 'prism';
  widthM: number;
  depthM: number;
  /** Altitude of the bottom face. */
  bottomAltitudeM: AbsoluteAltitudeM;
  /** Altitude of the top face. Always > bottom. */
  topAltitudeM: AbsoluteAltitudeM;
  role: 'body';
}

/** A cylinder centred on the object's lat/lng. */
export interface CylinderPart {
  kind: 'cylinder';
  radiusM: number;
  lengthM: number;
  /** Altitude of the cylinder's CENTRE, which is how Cesium positions it. */
  centreAltitudeM: AbsoluteAltitudeM;
  role: 'trunk';
}

/** An ellipsoid centred on the object's lat/lng. */
export interface EllipsoidPart {
  kind: 'ellipsoid';
  /** Horizontal semi-axis, metres — half the canopy width. */
  radiusXM: number;
  radiusYM: number;
  /** Vertical semi-axis, metres. */
  radiusZM: number;
  centreAltitudeM: AbsoluteAltitudeM;
  role: 'canopy';
}

export type ObstructionPart = PrismPart | CylinderPart | EllipsoidPart;

export interface ObstructionGeometry {
  parts: ObstructionPart[];
  /** Altitude of the highest point of the object, for shade and for assertions. */
  topAltitudeM: AbsoluteAltitudeM;
  /** The object's own height, base to top. Must equal the canonical heightM. */
  totalHeightM: number;
  /** The widest horizontal extent, metres. For a tree, the canopy diameter. */
  maxWidthM: number;
}

/**
 * A tree's canopy occupies the top of its height and its trunk the bottom.
 *
 * 0.35 is chosen so a mature deciduous tree reads correctly at a glance: for a
 * 35 ft tree that is a 12 ft trunk under a 23 ft canopy. It is a proportion of
 * the canonical height, never a fixed metre value, so the shape stays truthful
 * at 3 m and at 30 m.
 */
export const TRUNK_FRACTION_OF_HEIGHT = 0.35;

/** Trunk thickness as a fraction of canopy width, with sane absolute bounds. */
export const TRUNK_RADIUS_FRACTION = 0.045;
export const MIN_TRUNK_RADIUS_M = 0.06;
export const MAX_TRUNK_RADIUS_M = 0.6;

function finitePositive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Is this object a tree — i.e. does it get a trunk and a canopy? */
export function isTreeLike(input: { type?: string; space?: string }): boolean {
  return input.type === 'tree';
}

/**
 * Build the parts for one canonical object.
 *
 * 🚨 EVERY ALTITUDE THAT COMES OUT OF HERE IS ABSOLUTE, because that is what
 * Cesium wants and because the previous bug was precisely a height being passed
 * where an altitude was expected. The type alias exists to make that hard to
 * get wrong again.
 */
export function buildObstructionGeometry(input: ObstructionGeometryInput): ObstructionGeometry {
  const widthM = finitePositive(input.widthM, 0.6);
  const depthM = finitePositive(input.depthM, widthM);
  const heightM = finitePositive(input.heightM, 1.0);
  const base = Number.isFinite(input.baseAltitudeM) ? input.baseAltitudeM : 0;

  if (isTreeLike(input)) {
    // ── TREE ────────────────────────────────────────────────────────────────
    // The canopy is an ellipsoid whose horizontal diameter IS the canonical
    // width, and whose top IS the canonical height. Those two identities are
    // what make the object truthful, and they are asserted in the tests.
    const canopyDiameterM = Math.max(widthM, depthM);
    const trunkHeightM = heightM * TRUNK_FRACTION_OF_HEIGHT;
    // The canopy fills the remaining height exactly, so trunk + canopy = height.
    const canopyRadiusZM = (heightM - trunkHeightM) / 2;
    const canopyCentre = base + trunkHeightM + canopyRadiusZM;
    const trunkRadiusM = Math.min(
      MAX_TRUNK_RADIUS_M,
      Math.max(MIN_TRUNK_RADIUS_M, canopyDiameterM * TRUNK_RADIUS_FRACTION),
    );

    return {
      parts: [
        {
          kind: 'cylinder',
          radiusM: trunkRadiusM,
          lengthM: trunkHeightM,
          // Cesium positions a cylinder by its centre, so the trunk's centre is
          // half its length above the ground — not at the ground.
          centreAltitudeM: base + trunkHeightM / 2,
          role: 'trunk',
        },
        {
          kind: 'ellipsoid',
          radiusXM: canopyDiameterM / 2,
          radiusYM: canopyDiameterM / 2,
          radiusZM: canopyRadiusZM,
          centreAltitudeM: canopyCentre,
          role: 'canopy',
        },
      ],
      topAltitudeM: base + heightM,
      totalHeightM: heightM,
      maxWidthM: canopyDiameterM,
    };
  }

  // ── EVERYTHING ELSE: a prism standing on its base ────────────────────────
  // Correct for a chimney, a rooftop unit, a curb-mounted skylight and a hatch.
  // A vent pipe is round rather than square, which is a refinement, not a lie
  // about its size — its footprint and height are still its own.
  return {
    parts: [{
      kind: 'prism',
      widthM,
      depthM,
      bottomAltitudeM: base,
      // 🚨 BASE PLUS HEIGHT. This is the whole of the extrusion-datum fix: the
      // top face's ALTITUDE, not the object's height passed as if it were one.
      topAltitudeM: base + heightM,
      role: 'body',
    }],
    topAltitudeM: base + heightM,
    totalHeightM: heightM,
    maxWidthM: Math.max(widthM, depthM),
  };
}

/**
 * The canopy radius a tree shades with, derived from the same width the
 * renderer draws.
 *
 * Exported so no consumer has to reach for `Math.max(w, d) / 2` itself. Two
 * places computing "the canopy radius" is how a renderer and a shade model come
 * to disagree about the same tree.
 */
export function canopyRadiusFor(widthM: number, depthM: number): number {
  return Math.max(finitePositive(widthM, 0), finitePositive(depthM, 0)) / 2;
}
