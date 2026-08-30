// ═══════════════════════════════════════════════════════════════════════════
// THE GOVERNING ROOF SLOPE — one value, and it names the plane it came from.
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
// `buildStructuralInputForPermit` opened with:
//
//     const roofPitchDeg = cad.roof?.planes?.[0]?.pitch ?? input.project.roofPitch ?? 20;
//
// Three defects in one line.
//
// 1. THE FABRICATED 20°. When no CAD plane carries a pitch and the project
//    field is empty, this invents a 20° roof — and that number is not
//    decoration. It feeds `rooftopSolarPressureCoefficient` (which decides
//    whether ASCE 7-22 Fig. 29.4-7 governs at all: the test is `slope > 7°`)
//    and `calcRoofSnowLoad` (the Cs slope factor). So PV-4C printed
//
//        "ASCE 7-22 Fig. 29.4-7 applies to roof slopes LESS THAN 7°;
//         this roof is 20.0°."
//
//    about a roof whose canonical planes are 16.5° and 18.2°. A reviewer reads
//    a slope this package never measured, attached to an engineering assumption
//    the engineer of record is asked to accept.
//
// 2. A SECOND FABRICATED DEFAULT FOR THE SAME FACT. The drafting layer's
//    `resolveRoofPitch` ends `?? 5` — so with the same missing data the
//    drawings said 5° and the structural analysis said 20°. Two invented roofs,
//    one design.
//
// 3. `planes[0]` STANDS FOR THE WHOLE ROOF. Braidon has two planes at
//    different slopes. Which one governs a wind-applicability question is an
//    engineering choice, and taking whichever plane happens to be first in an
//    array is not that choice.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
// A structural roof slope must trace to a canonical roof plane. This resolver
// reads every place planes are recorded, prefers the planes that actually carry
// modules, names the governing plane's id, and — when nothing is on file —
// returns `established: false` with a NAMED non-authoritative nominal rather
// than a bare number that reads like a measurement.
//
// The nominal follows the pattern this codebase already uses for an unknown
// span (`NON_AUTHORITATIVE_NOMINAL_SPAN_FT`): it exists so a downstream
// calculation can still run and be marked unverified, and it is never allowed
// to masquerade as project authority.
// ═══════════════════════════════════════════════════════════════════════════

/** A slope carried by a canonical roof plane. */
export interface RoofPlaneSlope {
  /** the plane's canonical id — what a structural slope must trace to. */
  planeId: string;
  slopeDeg: number;
  /** modules placed on this plane, when the caller can attribute them. */
  moduleCount: number | null;
  /** which record the plane was read from, for the review trail. */
  source: string;
}

export interface GoverningRoofSlope {
  /** true ⇔ the slope came from a real plane. False means NOTHING measured it. */
  established: boolean;
  /** the governing slope in degrees. Never null so calculations can run; read
   *  `established` before presenting it as a fact. */
  slopeDeg: number;
  /** the canonical plane the governing slope came from — null when fabricated. */
  planeId: string | null;
  /** every plane considered, steepest first. */
  planes: RoofPlaneSlope[];
  /** the shallowest populated plane — the governing case for a SNOW slope
   *  factor, where a flatter roof retains more (ASCE 7-22 Fig. 7.4-1). */
  shallowestDeg: number | null;
  /** one sentence a reviewer can act on. */
  basis: string;
}

/**
 * The slope used when no plane is on file. NAMED so it can never be mistaken
 * for a measurement, and `established:false` travels with it.
 *
 * 0° is deliberate. A fabricated 20° silently ANSWERS the Fig. 29.4-7
 * applicability question in the negative — it declares the figure inapplicable
 * for a roof nobody measured. 0° keeps the figure applicable, which is the
 * assumption the rest of the rooftop-solar coefficient set is written for, and
 * leaves the unverified-geometry gate to say what is actually missing.
 */
export const NON_AUTHORITATIVE_NOMINAL_SLOPE_DEG = 0;

const isSlope = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 90;

interface PlaneLike {
  id?: unknown; planeId?: unknown; label?: unknown; name?: unknown;
  pitch?: unknown; slopeDeg?: unknown; pitchDegrees?: unknown; tilt?: unknown;
  moduleCount?: unknown; panelCount?: unknown;
}

/** Collect plane slopes from ONE record array, tagged with where they came from. */
function readPlanes(planes: unknown, source: string): RoofPlaneSlope[] {
  if (!Array.isArray(planes)) return [];
  const out: RoofPlaneSlope[] = [];
  planes.forEach((p: PlaneLike, i) => {
    if (!p || typeof p !== 'object') return;
    const slope = [p.pitch, p.slopeDeg, p.pitchDegrees, p.tilt].find(isSlope);
    if (slope == null) return;
    const id = [p.id, p.planeId, p.label, p.name]
      .find(v => typeof v === 'string' && v.trim().length > 0) as string | undefined;
    const mc = [p.moduleCount, p.panelCount]
      .find(v => typeof v === 'number' && Number.isFinite(v)) as number | undefined;
    out.push({
      planeId: id ?? `${source}[${i}]`,
      slopeDeg: slope,
      moduleCount: mc ?? null,
      source,
    });
  });
  return out;
}

export interface RoofSlopeSources {
  /** the solved CAD model's roof planes — the first place to look. */
  cadPlanes?: unknown;
  /** the design's own roof-plane records (project.roofPlanes). */
  projectPlanes?: unknown;
  /** the layout geometry's roof planes. */
  layoutPlanes?: unknown;
  /** an operator-entered single roof pitch, in degrees. */
  projectRoofPitchDeg?: unknown;
}

/**
 * Resolve THE governing roof slope. Pure; never throws.
 *
 * Ordering: a plane that carries modules governs over one that does not (the
 * array's own roof is the roof the analysis is about). Among those, the
 * STEEPEST governs, because every question this value answers — does Fig.
 * 29.4-7 apply, which pressure zone, how much does snow shed — is asked about
 * the worst plane the array sits on, and answering it on a shallower plane
 * understates the case the engineer must accept.
 */
export function projectGoverningRoofSlope(src: RoofSlopeSources): GoverningRoofSlope {
  // Deduplicate by (source, slope): the same plane set is frequently mirrored
  // into two records, and counting it twice would misreport how many planes the
  // design actually has.
  const all = [
    ...readPlanes(src.cadPlanes, 'cad.roof.planes'),
    ...readPlanes(src.projectPlanes, 'project.roofPlanes'),
    ...readPlanes(src.layoutPlanes, 'layout.geometry.roofPlanes'),
  ];
  const seen = new Set<string>();
  const planes: RoofPlaneSlope[] = [];
  for (const p of all) {
    const key = `${p.slopeDeg.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planes.push(p);
  }
  planes.sort((a, b) => b.slopeDeg - a.slopeDeg);

  if (planes.length > 0) {
    const bearing = planes.filter(p => (p.moduleCount ?? 0) > 0);
    const pool = bearing.length > 0 ? bearing : planes;
    const governing = pool[0];
    const shallowest = pool[pool.length - 1];
    return {
      established: true,
      slopeDeg: governing.slopeDeg,
      planeId: governing.planeId,
      planes,
      shallowestDeg: shallowest.slopeDeg,
      basis: planes.length === 1
        ? `the design's single roof plane ${governing.planeId} (${governing.slopeDeg.toFixed(1)}°, from ${governing.source})`
        : `the steepest of ${planes.length} roof planes${bearing.length > 0 ? ' carrying modules' : ''}: `
          + `${governing.planeId} at ${governing.slopeDeg.toFixed(1)}° (from ${governing.source})`,
    };
  }

  // An operator-entered single pitch is a STATEMENT about the roof, not a
  // plane — usable, but it cannot name a plane id.
  const stated = [src.projectRoofPitchDeg].find(isSlope);
  if (stated != null) {
    return {
      established: true,
      slopeDeg: stated,
      planeId: null,
      planes: [],
      shallowestDeg: stated,
      basis: `operator-entered roof pitch (${stated.toFixed(1)}°); no roof plane geometry is on file to trace it to`,
    };
  }

  return {
    established: false,
    slopeDeg: NON_AUTHORITATIVE_NOMINAL_SLOPE_DEG,
    planeId: null,
    planes: [],
    shallowestDeg: null,
    basis: 'NO roof slope is established — no roof plane carries a pitch and no operator pitch is recorded; '
      + 'calculations run on a non-authoritative nominal and the geometry is UNVERIFIED',
  };
}
