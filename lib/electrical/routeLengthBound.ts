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
  /** PV SOURCE / DC OUTPUT circuit — SolarPro's DC design target, and the same
   *  number `maxDCVoltageDropPct` carries through the engine (3). See
   *  `classifyVdRole` below for why a DC circuit needed its own row. */
  dcSource: 3,
} as const;

// ══ 2026-08-29 — WHAT KIND OF LIMIT IS 2 %? ═══════════════════════
// The schedule graded a branch against ROUTE_VD_LIMIT_PCT.branch as a HARD
// compliance check, so a 2.11 % branch rendered as
//     "FAIL — 2.11 % > 2.0 %"  under a column headed  "RELEASE / REVIEW"
// on a package whose PV-4A summary read "0 BLOCKING / 0 PENDING / COMPLIES".
//
// 2 % is not a code limit. The NEC states voltage drop ONLY in informational
// notes — 210.19(A) Inf. Note 4 (branch circuits) and 215.2(A)(1) Inf. Note 2
// (feeders) recommend 3 % on the branch or feeder and 5 % on the combined run —
// and NEC 90.5(C) says informational notes are explanatory and NOT enforceable
// as requirements. SolarPro's 2 % branch figure is a DESIGN TARGET: it reserves
// the remaining 1 % so the branch-plus-feeder total stays inside the 3 %
// recommendation.
//
// Presenting a company target as a code failure is the same class of error as a
// sheet inventing its own release model. The two limits are named separately
// here and graded separately below; exceeding the TARGET is an advisory, and
// only exceeding the published recommendation is a definitive failure.
export const NEC_VD_RECOMMENDATION_PCT = {
  /** NEC 210.19(A) Inf. Note 4 — branch circuit */
  branch: 3,
  /** NEC 215.2(A)(1) Inf. Note 2 — feeder */
  feeder: 3,
  /** both notes — feeder + branch combined */
  combined: 5,
  /** 🚨 NULL, NOT 3. See `classifyVdRole`: the NEC states no voltage-drop
   *  recommendation for a PV source circuit at all, so there is no published
   *  figure a DC run can "exceed". A number here would be an invented code
   *  requirement, which is the thing this whole policy block exists to stop. */
  dcSource: null,
} as const;

export const NEC_VD_CITATION = {
  branch: 'NEC 210.19(A) Informational Note 4',
  feeder: 'NEC 215.2(A)(1) Informational Note 2',
  /** Named as the absence it is — an AHJ reading this row must not be told a
   *  branch-circuit note governs a PV source circuit. */
  dcSource: 'no NEC voltage-drop requirement applies to a PV source circuit '
    + '(NEC 210.19(A) Inf. Note 4 is a BRANCH-CIRCUIT note; 215.2(A)(1) Inf. Note 2 is a FEEDER note)',
} as const;

// ══ 2026-09-26 — A DC STRING WAS GRADED AS A 240 V AC BRANCH CIRCUIT ═══════
//
// 🚨 WHAT WAS HERE: `vdLimitPctForSegment` tested for a feeder id and DEFAULTED
// everything else to `branch`. `DC_STRING_RUN`, `DC_DISCO_TO_INV_RUN` and
// `ROOF_RUN` are PV source / DC output circuits and match neither pattern, so all
// three were graded as module-level AC branch circuits:
//
//   · design target 2 %, where the engine's own DC target (`maxDCVoltageDropPct`)
//     is 3 % — so the bound printed on the drawing was derived from one limit
//     while the engine sized the conductor against another;
//   · recommendation 3 % cited as **NEC 210.19(A) Informational Note 4**, a
//     BRANCH-CIRCUIT note. A PV source circuit is not a branch circuit (NEC 690.2
//     defines it as the conductors between modules and the inverter; Article 210
//     governs branch circuits from the final OCPD to the outlet). The note does
//     not reach it, so `definitiveFailure: true` from that citation asserted a
//     violation of a code section that does not apply;
//   · and because `compliant: false` rides on that, a DC run over 3 % produced a
//     BLOCKING compliance failure on a stamped sheet.
//
// The fix is an EXPLICIT third role, not a wider default. A segment id nobody has
// classified still falls to `branch` (the tighter limit) — fail-closed is right for
// an unknown AC run — but a DC circuit is now named, given the DC target, and
// carries the honest statement that the NEC recommends nothing here at all.
export type VdRunRole = 'branch' | 'feeder' | 'dcSource';

/** PV source / DC output circuits. Named explicitly — never a default. */
const DC_SOURCE_SEGMENT_RE = /^(?:DC_STRING_RUN|DC_DISCO_TO_INV_RUN|ROOF_RUN)$/i;
const FEEDER_SEGMENT_RE = /COMBINER_TO_DISCO|INV_TO_DISCO|DISCO_TO_|MSP_TO_|METER_TO_/i;

/**
 * Which voltage-drop role a run plays, from its segment id.
 *
 * Order matters: DC is tested FIRST, because `DC_DISCO_TO_INV_RUN` contains
 * `DISCO_TO_` and would otherwise be graded as an AC feeder.
 *
 * NOTE (deliberately unchanged): the battery / generator / ATS segments
 * (`BATTERY_TO_BUI_RUN`, `BUI_TO_MSP_RUN`, `GENERATOR_TO_ATS_RUN`,
 * `ATS_TO_MSP_RUN`) are NOT classified here. `BUI_TO_MSP_RUN` and
 * `ATS_TO_MSP_RUN` are AC and already match the feeder pattern;
 * `BATTERY_TO_BUI_RUN` may be DC or AC depending on the product and cannot be
 * decided from its id alone. Guessing would move those packages' digests with no
 * finding behind it.
 */
export function classifyVdRole(segmentId: string): VdRunRole {
  if (DC_SOURCE_SEGMENT_RE.test(segmentId)) return 'dcSource';
  if (/BRANCH/i.test(segmentId)) return 'branch';
  if (FEEDER_SEGMENT_RE.test(segmentId)) return 'feeder';
  return 'branch';
}

export type VoltageDropPolicyState =
  /** at or under the SolarPro design target — nothing to say */
  | 'WITHIN_DESIGN_TARGET'
  /** over the target, under the published recommendation — ADVISORY, not a defect */
  | 'DESIGN_TARGET_EXCEEDED'
  /** over the published recommendation — a definitive design failure */
  | 'RECOMMENDATION_EXCEEDED'
  /** no percentage to grade */
  | 'NOT_EVALUABLE';

export interface VoltageDropPolicyGrade {
  state: VoltageDropPolicyState;
  /** which role this run plays — `dcSource` has no NEC recommendation at all. */
  role: VdRunRole;
  /** SolarPro's design target for this run role. */
  designTargetPct: number;
  /** the NEC informational-note recommendation for this run role, or **null**
   *  when the NEC publishes none (a PV source circuit). Null can never be
   *  exceeded, so a DC run's `definitiveFailure` is always false. */
  recommendationPct: number | null;
  /** the citation for that recommendation, named as the informational note it is. */
  citation: string;
  /** true ⇔ within the published recommendation. A design target miss does NOT
   *  make a run non-compliant. */
  compliant: boolean;
  /** true ⇔ at or under SolarPro's own target. */
  designTargetMet: boolean;
  /** the sheet label — one wording, so no sheet composes its own. */
  label: string;
  /** true ⇔ this is a definitive failure a compliance verdict must carry. */
  definitiveFailure: boolean;
}

/** Grade ONE run's voltage drop against BOTH limits. Pure. */
export function gradeVoltageDropPolicy(
  pct: number | null | undefined,
  segmentId: string,
): VoltageDropPolicyGrade {
  const role = classifyVdRole(segmentId);
  const designTargetPct = vdLimitPctForSegment(segmentId);
  const recommendationPct: number | null =
    role === 'dcSource' ? NEC_VD_RECOMMENDATION_PCT.dcSource
      : role === 'feeder' ? NEC_VD_RECOMMENDATION_PCT.feeder
      : NEC_VD_RECOMMENDATION_PCT.branch;
  const citation =
    role === 'dcSource' ? NEC_VD_CITATION.dcSource
      : role === 'feeder' ? NEC_VD_CITATION.feeder
      : NEC_VD_CITATION.branch;
  const base = { role, designTargetPct, recommendationPct, citation };

  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return {
      ...base, state: 'NOT_EVALUABLE', compliant: false, designTargetMet: false,
      definitiveFailure: false,
      label: 'VOLTAGE DROP NOT EVALUABLE — no percentage computed',
    };
  }
  if (pct <= designTargetPct) {
    return {
      ...base, state: 'WITHIN_DESIGN_TARGET', compliant: true, designTargetMet: true,
      definitiveFailure: false,
      label: `WITHIN DESIGN TARGET — ${pct.toFixed(2)}% ≤ ${designTargetPct.toFixed(1)}%`,
    };
  }
  // 🚨 NO PUBLISHED RECOMMENDATION ⇒ NOTHING TO EXCEED. A PV source circuit over
  // SolarPro's own DC target is an advisory about a company target, never a code
  // failure — the NEC states no voltage-drop requirement for it at all.
  if (recommendationPct == null) {
    return {
      ...base, state: 'DESIGN_TARGET_EXCEEDED', compliant: true, designTargetMet: false,
      definitiveFailure: false,
      label: `CODE COMPLIANT — ${designTargetPct.toFixed(1)}% DC DESIGN TARGET EXCEEDED `
        + `(${pct.toFixed(2)}%); ${citation}`,
    };
  }
  if (pct <= recommendationPct) {
    return {
      ...base, state: 'DESIGN_TARGET_EXCEEDED', compliant: true, designTargetMet: false,
      definitiveFailure: false,
      label: `CODE COMPLIANT — ${designTargetPct.toFixed(1)}% DESIGN TARGET EXCEEDED `
        + `(${pct.toFixed(2)}% ≤ ${recommendationPct.toFixed(1)}% per ${citation})`,
    };
  }
  return {
    ...base, state: 'RECOMMENDATION_EXCEEDED', compliant: false, designTargetMet: false,
    definitiveFailure: true,
    label: `EXCEEDS ${citation} — ${pct.toFixed(2)}% > ${recommendationPct.toFixed(1)}%`,
  };
}

/** Which limit governs a run, from its segment id. Fail-closed to the TIGHTER
 *  limit for an UNCLASSIFIED id: a bound computed against a looser limit than the
 *  schedule grades with would permit a length the run then fails at. A DC source
 *  circuit is not "unclassified" — it is named (see `classifyVdRole`) and takes
 *  the engine's own 3 % DC target, which is the limit the conductor was sized
 *  against. */
export function vdLimitPctForSegment(segmentId: string): number {
  const role = classifyVdRole(segmentId);
  return role === 'dcSource' ? ROUTE_VD_LIMIT_PCT.dcSource
    : role === 'feeder' ? ROUTE_VD_LIMIT_PCT.feeder
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
