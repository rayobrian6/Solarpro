// ═══════════════════════════════════════════════════════════════════════════
// tapSpanAuthority.ts — THE ONE PHYSICAL SPAN between the fused AC disconnect
// and the supply-side tap point (NEC 705.11(C) / 240.21(B)).
//
// ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
// SolarPro modelled that span TWICE:
//
//   • `DISCO_TO_METER_RUN`  — a RouteSegmentRecord carrying endpoints, conductor
//     inventory, raceway, EGC, fill, voltage drop and a length. On Braidon it
//     carried 15 ft with `lengthSource: 'cad-derived-estimate'` — which was not
//     even true: no CAD route exists on that project and 15 is the hardcoded
//     `defaultRunLengths.DISCO_TO_METER_RUN ?? 15` fallback.
//   • `svc-tap-conductors` — a ServiceTopologyObject carrying `lengthFt: null`,
//     `lengthSource: 'unknown'` and the ≤10 ft constraint, permanently PENDING.
//
// They are the same two devices. PV-4B.1 printed both rows adjacent: one saying
// the ≤10-ft rule cannot be evaluated because no length exists, directly below a
// row asserting 15 ft for that very span. Two independently authoritative
// lengths for one physical installation.
//
// ── THE RULING THIS IMPLEMENTS ────────────────────────────────────────────
// The ≤10-ft rule is a DESIGN CONSTRAINT, not a measurement to wait on. A
// nationwide product cannot hold a permit package open pending a tape measure on
// a placement the drawing itself dictates. The design says where the disconnect
// goes; the AHJ inspects that the installation follows the drawing.
//
// So the span has ONE physical authority (the route segment) and ONE compliance
// view (the topology object, which REFERENCES it — it does not copy it), and the
// grade is:
//
//   positional authority (a routed CAD geometry between the two placed devices,
//   or a field measurement) exists
//     → grade the NUMBER:  ≤ limit ⇒ PASS_VERIFIED,  > limit ⇒ FAIL (blocking)
//   no positional authority, but the design FIXES the span at/below the limit
//     → PASS_BY_DESIGN. The drawing carries the enforceable placement
//       requirement; field inspection verifies the installation follows it.
//   neither
//     → PENDING (blocking) — there is genuinely no constraint to inspect against.
//
// A heuristic route ESTIMATE is never positional authority. It cannot certify
// (the original bug) and it cannot condemn (the same over-claim pointed the
// other way). When an estimate exceeds the limit it raises a design ADVISORY on
// the span, because it is evidence the placement wants attention — never a
// permit blocker, and never a compliance verdict.
//
// PURE + deterministic (digest-safe).
// ═══════════════════════════════════════════════════════════════════════════

/** NEC 705.11(C) / 240.21(B)(1) — the tap conductors terminate in an overcurrent
 *  device within 10 ft of the tap. This is the DESIGN MAXIMUM for the span. */
export const NEC_705_11_C_TAP_LIMIT_FT = 10;

/** The ONE route segment that IS this physical span. Named once. Everything
 *  else references this constant rather than restating the id. */
export const TAP_SPAN_PHYSICAL_SEGMENT_ID = 'DISCO_TO_METER_RUN';

/** The enforceable placement requirement the drawing prints. This is the design
 *  constraint an inspector checks the installation against — it is the reason
 *  the span can PASS BY DESIGN rather than wait for an as-built measurement. */
/** The SHORT form for the construction drawing. A drawing carries the actionable
 *  instruction; the reasoning belongs in the Project Review Record. */
export const TAP_SPAN_DESIGN_CONSTRAINT_NOTE =
  `LOCATE THE FUSED AC DISCONNECT WITHIN ${NEC_705_11_C_TAP_LIMIT_FT} FT OF THE TAP POINT.`;

export const TAP_SPAN_DESIGN_CONSTRAINT_TEXT =
  `LOCATE THE FUSED AC DISCONNECT WITHIN ${NEC_705_11_C_TAP_LIMIT_FT} FT OF THE SUPPLY-SIDE TAP POINT. `
  + `Tap conductors shall be sized ≥125% of PV output current and shall terminate in that disconnect `
  + `(NEC 705.11(C) / 240.21(B)(1)). Routing that cannot achieve the ${NEC_705_11_C_TAP_LIMIT_FT} ft limit `
  + `requires the tap point or the disconnect to be relocated — it is not an approved field deviation.`;

/** How the span's position is actually known. Only the first two are POSITIONAL
 *  AUTHORITY (they describe where the devices are); `design-constraint` is the
 *  design fixing the span, and `none` is the honest absence. */
export type TapSpanPositionalAuthority =
  | 'field-measurement'
  | 'cad-route'
  | 'design-constraint'
  | 'none';

export type TapSpanState = 'pass-verified' | 'pass-by-design' | 'fail' | 'pending';

export interface TapSpanAuthority {
  /** the ONE physical object this span is. The compliance view references this
   *  id; it never carries an independent length of its own. */
  physicalRouteSegmentId: string;
  /** the two physical endpoints, named from the design (not from a run label). */
  fromDevice: string;
  toDevice: string;

  limitFt: number;
  limitCode: string;
  /** the design requirement printed on the drawing, verbatim. */
  designConstraintText: string;
  /** does the canonical design FIX this span at or below the limit? */
  designConstraintEnforced: boolean;

  positionalAuthority: TapSpanPositionalAuthority;
  /** the length the grade was taken from — null only when nothing constrains it. */
  spanLengthFt: number | null;
  /** the physical segment's own length source, carried through unchanged. */
  spanLengthSource: string | null;

  /** an unrouted heuristic figure, kept for information ONLY. Never grades. */
  advisoryEstimateFt: number | null;
  /** set when that estimate busts the limit: the placement wants attention. */
  estimateExceedsLimit: boolean;

  state: TapSpanState;
  /** one-line human statement of the grade, for the constraint + the sheet. */
  statement: string;
  /** what has to happen next, if anything. */
  resolutionAction: string | null;
}

export interface BuildTapSpanArgs {
  /** the design's declared interconnection method. */
  interconnectionMethod: string;
  /** the physical route segment for the span (DISCO_TO_METER_RUN), if present. */
  physicalSegment: {
    segmentId: string;
    oneWayFt: number | null;
    lengthSource: string | null;
    sourceNode?: string | null;
    destinationNode?: string | null;
  } | null;
}

/** length sources that describe WHERE THE DEVICES ARE (positional authority),
 *  as opposed to how long somebody guesses the wire will be. */
const POSITIONAL_SOURCES = new Set(['field-measurement', 'cad-route']);

/** length sources the DESIGN fixes. `known-design` is written by the engine when
 *  a supply-side span is constrained to the 705.11(C) limit by the design. */
const DESIGN_SOURCES = new Set(['known-design']);

export function isSupplySideMethod(method: unknown): boolean {
  return /SUPPLY|LINE/i.test(String(method ?? ''));
}

/**
 * Build the single tap-span authority. Returns null for a non-supply-side design
 * — there is no tap span to have an authority about.
 */
export function buildTapSpanAuthority(args: BuildTapSpanArgs): TapSpanAuthority | null {
  const { interconnectionMethod, physicalSegment } = args;
  if (!isSupplySideMethod(interconnectionMethod)) return null;

  const limitFt = NEC_705_11_C_TAP_LIMIT_FT;
  const limitCode = 'NEC-705.11(C)-TAP-10FT';
  const segId = physicalSegment?.segmentId ?? TAP_SPAN_PHYSICAL_SEGMENT_ID;
  const ft = typeof physicalSegment?.oneWayFt === 'number' && isFinite(physicalSegment.oneWayFt)
    ? physicalSegment.oneWayFt : null;
  const src = physicalSegment?.lengthSource ?? null;

  const hasPositional = !!src && POSITIONAL_SOURCES.has(src) && ft != null;
  const hasDesign = !!src && DESIGN_SOURCES.has(src) && ft != null && ft <= limitFt;

  const base = {
    physicalRouteSegmentId: segId,
    fromDevice: physicalSegment?.sourceNode?.trim() || 'FUSED AC DISCONNECT',
    toDevice: physicalSegment?.destinationNode?.trim() || 'SUPPLY-SIDE TAP POINT',
    limitFt,
    limitCode,
    designConstraintText: TAP_SPAN_DESIGN_CONSTRAINT_TEXT,
  };

  // ── 1. POSITIONAL AUTHORITY — grade the number. ──────────────────────────
  if (hasPositional) {
    const within = (ft as number) <= limitFt;
    const authority: TapSpanPositionalAuthority = src === 'field-measurement' ? 'field-measurement' : 'cad-route';
    const how = authority === 'field-measurement' ? 'field-measured' : 'routed in the CAD model';
    return {
      ...base,
      designConstraintEnforced: true,
      positionalAuthority: authority,
      spanLengthFt: ft,
      spanLengthSource: src,
      advisoryEstimateFt: null,
      estimateExceedsLimit: false,
      state: within ? 'pass-verified' : 'fail',
      statement: within
        ? `Fused AC disconnect to supply-side tap point: ${ft} ft ${how} — within the ${limitFt} ft limit (${limitCode}).`
        : `Fused AC disconnect to supply-side tap point: ${ft} ft ${how} — EXCEEDS the ${limitFt} ft limit (${limitCode}). `
          + `This is a LAYOUT defect, not a missing measurement: relocate the disconnect or the tap point.`,
      resolutionAction: within
        ? null
        : `Relocate the fused AC disconnect (or the tap point) so the tap conductors are ≤${limitFt} ft, then re-route/re-measure the span.`,
    };
  }

  // ── 2. DESIGN CONSTRAINT — the drawing fixes the placement. ───────────────
  if (hasDesign) {
    return {
      ...base,
      designConstraintEnforced: true,
      positionalAuthority: 'design-constraint',
      spanLengthFt: ft,
      spanLengthSource: src,
      advisoryEstimateFt: null,
      estimateExceedsLimit: false,
      state: 'pass-by-design',
      statement:
        `Fused AC disconnect to supply-side tap point: ${ft} ft, FIXED BY DESIGN at the ${limitFt} ft `
        + `${limitCode} maximum. The drawing carries the placement requirement and the conductors are sized `
        + `on it; field inspection verifies the installation follows the drawing.`,
      resolutionAction: null,
    };
  }

  // ── 3. NOTHING CONSTRAINS THE SPAN — honest PENDING. ──────────────────────
  // An unrouted heuristic figure is reported as an advisory, never as a grade.
  const estimateExceedsLimit = ft != null && ft > limitFt;
  return {
    ...base,
    designConstraintEnforced: false,
    positionalAuthority: 'none',
    spanLengthFt: null,
    spanLengthSource: src,
    advisoryEstimateFt: ft,
    estimateExceedsLimit,
    state: 'pending',
    statement:
      `Fused AC disconnect to supply-side tap point: no design placement constraint and no routed geometry — `
      + `the ${limitFt} ft ${limitCode} limit cannot be enforced or inspected.`
      + (estimateExceedsLimit
        ? ` ADVISORY — the unrouted route estimate for ${segId} is ${ft} ft, above the limit; that figure is a `
          + `heuristic, not a position, so it asserts no violation, but the placement wants attention.`
        : ''),
    resolutionAction:
      `Constrain the span in the design (place the fused AC disconnect within ${limitFt} ft of the tap point) `
      + `or record a routed/field-measured length for ${segId}.`,
  };
}

/** The requirement code raised when a span with positional authority BUSTS the
 *  limit. Distinct from the PENDING code: a known violation must never be
 *  reported as "…LENGTH-PENDING". */
export const TAP_SPAN_EXCEEDED_CODE = 'TAP-CONDUCTOR-LENGTH-EXCEEDED';
/** The requirement code raised when nothing constrains the span at all. */
export const TAP_SPAN_PENDING_CODE = 'TAP-CONDUCTOR-LENGTH-PENDING';
