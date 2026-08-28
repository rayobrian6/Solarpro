// ═══════════════════════════════════════════════════════════════════════════
// routeLengthBound.ts — THE MAXIMUM ONE-WAY LENGTH THE DESIGN PERMITS.
//
// ── THE PROBLEM ───────────────────────────────────────────────────────────
// `ROUTE-LENGTH-ESTIMATE` blocked every package with an un-routed conductor run,
// and its only clearance was routed CAD geometry or a field measurement. On a
// nationwide product that means: no package closes until somebody walks the
// attic. The requirement asks a sharp question — "is this length an ESTIMATE?" —
// and there is a third answer it never admitted.
//
// ── THE THIRD ANSWER ──────────────────────────────────────────────────────
// A run whose length the DESIGN BOUNDS is not an estimate of anything. Every
// permit set in the trade sizes a conductor and then states the length at which
// that conductor stops meeting the voltage-drop limit:
//
//     "#10 AWG THWN-2 — MAXIMUM ONE-WAY LENGTH 118 FT AT 2% Vd.
//      A FIELD ROUTE LONGER THAN THIS REQUIRES UPSIZING PER THE SCHEDULE."
//
// That is a design decision with an inspectable consequence, not a guess. The
// installation is bound by the drawing; the AHJ inspects against it; the
// conductor is valid for ANY installed length at or under the bound. It is the
// same move the supply-side tap span already makes (lib/electrical/tapSpan.ts),
// applied to the runs whose route nobody has walked.
//
// ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
// It does not certify the estimate, and it does not replace it. The estimate
// stays exactly what it is — an indicative figure the BOM orders from, printed
// and labelled as an estimate. The BOUND is the compliance basis, and it fails
// in a way an estimate never could: when the estimated route ALREADY EXCEEDS the
// bound, the design as drawn will not meet its own voltage-drop limit, and that
// is a real, blocking defect rather than a missing measurement.
//
// It also cannot be reached without a real conductor. No gauge, no current, no
// system voltage ⇒ no bound ⇒ the requirement stands, unchanged.
//
// PURE + deterministic (digest-safe).
// ═══════════════════════════════════════════════════════════════════════════
import { calcVoltageDrop } from '@/lib/manufacturer-specs';

// ══ THE VOLTAGE-DROP LIMIT PER RUN ROLE ══════════════════════════
// These four numbers existed as literals inside the E-1 schedule projection
// (electricalProjection.ts), which is the only place that graded a run against
// them. The bound below has to use the SAME limit the schedule grades against,
// or the drawing would state a maximum length derived from one limit beside a
// pass/fail computed from another. So the policy is named ONCE, here, and the
// projection reads it.
//
// The values are unchanged from the schedule: 2 % on the module-level branch and
// its shared home-run, 3 % on the AC feeder and the downstream service runs.
export const ROUTE_VD_LIMIT_PCT = {
  /** module-level AC branch and the shared jbox→combiner home-run */
  branch: 2,
  /** combiner→disconnect feeder and the downstream service runs */
  feeder: 3,
} as const;

/** Which limit governs a run, from its segment id. Fail-closed to the TIGHTER
 *  limit: a bound computed against a looser limit than the schedule grades with
 *  would permit a length the run then fails at. */
export function vdLimitPctForSegment(segmentId: string): number {
  return /BRANCH/i.test(segmentId) ? ROUTE_VD_LIMIT_PCT.branch
    : /COMBINER_TO_DISCO|INV_TO_DISCO|DISCO_TO_|MSP_TO_|METER_TO_/i.test(segmentId) ? ROUTE_VD_LIMIT_PCT.feeder
    : ROUTE_VD_LIMIT_PCT.branch;
}

export type RouteBoundState =
  /** the design states a maximum and the run is within it */
  | 'bounded'
  /** a bound exists and the estimated route ALREADY exceeds it */
  | 'exceeds-bound'
  /** no bound can be computed from what the segment carries */
  | 'unbounded';

export interface RouteLengthBound {
  segmentId: string;
  state: RouteBoundState;
  /** the maximum one-way length, in whole feet, at which the SELECTED conductor
   *  still meets the voltage-drop limit. null when no bound could be computed. */
  maxOneWayFt: number | null;
  vdLimitPct: number | null;
  conductorGauge: string | null;
  currentA: number | null;
  systemVoltage: number | null;
  /** the indicative (estimated) route length, carried for the comparison only. */
  estimatedOneWayFt: number | null;
  /** the construction requirement the drawing prints. null when unbounded. */
  constructionNote: string | null;
  /** why this state — one sentence, always true. */
  basis: string;
}

export interface RouteLengthBoundInput {
  segmentId: string;
  conductorGauge: string | null | undefined;
  /** the current the voltage-drop formula consumes (continuous preferred). */
  currentA: number | null | undefined;
  systemVoltage: number | null | undefined;
  /** the design's voltage-drop limit for this run, in percent. */
  vdLimitPct: number | null | undefined;
  /** the indicative route estimate, when one exists. */
  estimatedOneWayFt: number | null | undefined;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * The maximum one-way length at which `gauge` carrying `currentA` at
 * `systemVoltage` still meets `vdLimitPct`.
 *
 * Voltage drop is LINEAR in length, so this is a direct solve rather than a
 * search: compute the drop at a probe length and scale. Returns null when
 * `calcVoltageDrop` refuses the inputs (it returns 0 for an unrecognised gauge —
 * a refusal wearing the shape of a perfect result, so 0 is never treated as a
 * usable answer here).
 */
export function maxOneWayLengthFt(
  gauge: string, currentA: number, systemVoltage: number, vdLimitPct: number,
): number | null {
  if (!gauge.trim() || !(currentA > 0) || !(systemVoltage > 0) || !(vdLimitPct > 0)) return null;
  const PROBE_FT = 100;
  const pctAtProbe = calcVoltageDrop(currentA, PROBE_FT, gauge, systemVoltage);
  if (!Number.isFinite(pctAtProbe) || pctAtProbe <= 0) return null;
  const maxFt = (vdLimitPct / pctAtProbe) * PROBE_FT;
  if (!Number.isFinite(maxFt) || maxFt <= 0) return null;
  // Round DOWN — a bound rounded up would permit a length the conductor fails at.
  return Math.floor(maxFt);
}

/**
 * Bound one run. Returns `unbounded` (and leaves the requirement standing)
 * whenever the segment does not carry enough to compute a real limit.
 */
export function deriveRouteLengthBound(input: RouteLengthBoundInput): RouteLengthBound {
  const gauge = typeof input.conductorGauge === 'string' && input.conductorGauge.trim()
    ? input.conductorGauge.trim() : null;
  const currentA = finite(input.currentA);
  const systemVoltage = finite(input.systemVoltage);
  const vdLimitPct = finite(input.vdLimitPct);
  const estimatedOneWayFt = finite(input.estimatedOneWayFt);

  const base = {
    segmentId: input.segmentId,
    conductorGauge: gauge, currentA, systemVoltage, vdLimitPct, estimatedOneWayFt,
  };

  const missing: string[] = [];
  if (!gauge) missing.push('conductor gauge');
  if (currentA == null || currentA <= 0) missing.push('conductor current');
  if (systemVoltage == null || systemVoltage <= 0) missing.push('system voltage');
  if (vdLimitPct == null || vdLimitPct <= 0) missing.push('voltage-drop limit');
  if (missing.length > 0) {
    return {
      ...base, state: 'unbounded', maxOneWayFt: null, constructionNote: null,
      basis: `no design length bound can be computed for ${input.segmentId} — missing ${missing.join(', ')}. `
        + 'A run with no conductor selected has no limit to state.',
    };
  }

  const maxFt = maxOneWayLengthFt(gauge as string, currentA as number, systemVoltage as number, vdLimitPct as number);
  if (maxFt == null) {
    return {
      ...base, state: 'unbounded', maxOneWayFt: null, constructionNote: null,
      basis: `no design length bound can be computed for ${input.segmentId} — the voltage-drop calculation `
        + `refused the conductor spec (${gauge}).`,
    };
  }

  const note =
    `MAXIMUM ONE-WAY LENGTH ${maxFt} FT for ${gauge} at ${vdLimitPct}% Vd. `
    + `A field route longer than this requires upsizing per the conductor schedule.`;

  if (estimatedOneWayFt != null && estimatedOneWayFt > maxFt) {
    return {
      ...base, state: 'exceeds-bound', maxOneWayFt: maxFt, constructionNote: note,
      basis: `${input.segmentId}: the routed estimate (${estimatedOneWayFt} ft) EXCEEDS the ${maxFt} ft the `
        + `selected ${gauge} permits at ${vdLimitPct}% Vd — the run as laid out will not meet its own `
        + 'voltage-drop limit. Upsize the conductor or shorten the route.',
    };
  }

  return {
    ...base, state: 'bounded', maxOneWayFt: maxFt, constructionNote: note,
    basis: `${input.segmentId}: the design bounds this run at ${maxFt} ft one-way for ${gauge} at `
      + `${vdLimitPct}% Vd, and the drawing states it. The conductor is valid for any installed length at or `
      + 'under the bound; field inspection verifies the installation follows the drawing.',
  };
}

/** The requirement raised when a run's own drawn/estimated route busts the bound
 *  the selected conductor permits. Distinct from ROUTE-LENGTH-ESTIMATE: this is
 *  a known deficiency, not an unknown. */
export const ROUTE_LENGTH_EXCEEDS_BOUND_CODE = 'ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND';
