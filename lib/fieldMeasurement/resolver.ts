// lib/fieldMeasurement/resolver.ts
// WS-5 — THE CANONICAL ROUTE-LENGTH RESOLVER'S FIELD-MEASUREMENT HALF.
//
// SELECTION PRECEDENCE IS NOT RELEASE AUTHORITY, and conflating them is the
// defect this file is shaped to prevent. Two separate questions:
//
//   WHICH LENGTH DOES THE CALCULATION USE?
//     active FIELD_VERIFIED > active FIELD_REPORTED > CAD_ROUTE > CAD_ESTIMATE
//     An operator who walked the run knows more than a heuristic, so their
//     report DOES become the calculation basis.
//
//   WHICH LENGTH CLOSES THE FIELD-VERIFICATION REQUIREMENT?
//     FIELD_VERIFIED only.
//     A field REPORT supports a PROVISIONAL conclusion and closes nothing.
//
// DETERMINISM. "The latest verified measurement" is ambiguous when two share a
// timestamp, and "whatever the database returned first" is not an answer — row
// order is not a rule. The rule is stated, applied in one function and tested:
//   1. VERIFIED outranks REPORTED_UNVERIFIED;
//   2. within a rank, the later `verifiedAt` (or `recordedAt`) wins;
//   3. ties break on the descending measurement id — an arbitrary but STABLE
//      total order, so the same rows always select the same record.
// Superseded and rejected records are excluded before ranking, never ranked low.

import {
  closesFieldVerification,
  type RouteLengthSource, type RouteVerificationState,
} from '@/lib/permit/snapshot/types';
import {
  isSelectableMeasurement, measurementAuthorityPair, measurementSelectionRank,
  type FieldRouteMeasurement,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — DETERMINISTIC ACTIVE SELECTION
// ═══════════════════════════════════════════════════════════════════════════

/** The instant a record's rank was established — verification time for a
 *  verified record, record time for a report. */
function rankInstant(m: FieldRouteMeasurement): number {
  const t = m.verificationState === 'VERIFIED' ? (m.verifiedAt ?? m.recordedAt) : m.recordedAt;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * THE active measurement for one route segment, or null. Pure and total: the
 * same set of rows always yields the same record, regardless of input order.
 */
export function selectActiveMeasurement(
  measurements: readonly FieldRouteMeasurement[],
): FieldRouteMeasurement | null {
  const candidates = measurements.filter(isSelectableMeasurement);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const r = measurementSelectionRank(b.verificationState) - measurementSelectionRank(a.verificationState);
    if (r !== 0) return r;
    const t = rankInstant(b) - rankInstant(a);
    if (t !== 0) return t;
    // Stable, arbitrary, TOTAL — never database row order.
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return sorted[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE PER-SEGMENT AUTHORITY RECORD
// ═══════════════════════════════════════════════════════════════════════════

/** How far this length may be relied on. Named separately from the length
 *  itself so a sheet can print the number AND its standing. */
export type ReleaseSufficiency =
  /** field-verified: may support a final, permit-grade conclusion. */
  | 'FINAL_RELEASE_READY'
  /** estimate, CAD route or unverified field report: design review only. */
  | 'DESIGN_REVIEW_ONLY';

export interface FieldRouteLengthAuthority {
  routeSegmentId: string;
  /** the length the CALCULATIONS consume. */
  calculationLengthFt: number;
  lengthSource: RouteLengthSource;
  verificationState: RouteVerificationState;
  releaseSufficiency: ReleaseSufficiency;
  /** does this authority CLOSE a field-verification requirement? */
  closesFieldVerification: boolean;
  /** the selected record + the evidence behind it. IDs only — never content. */
  measurementId: string;
  measurementMethod: string;
  measuredByUserId: string;
  measuredAt: string;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  verificationMode: string | null;
  evidenceAttachmentIds: string[];
  evidenceCount: number;
  /** one sentence naming where the number came from, for the sheet. */
  provenance: string;
}

export function toLengthAuthority(m: FieldRouteMeasurement): FieldRouteLengthAuthority | null {
  const pair = measurementAuthorityPair(m.verificationState);
  if (!pair) return null;
  const closes = closesFieldVerification(pair.verificationState);
  return {
    routeSegmentId: m.routeSegmentId,
    calculationLengthFt: m.measuredLengthFt,
    lengthSource: pair.lengthSource,
    verificationState: pair.verificationState,
    releaseSufficiency: closes ? 'FINAL_RELEASE_READY' : 'DESIGN_REVIEW_ONLY',
    closesFieldVerification: closes,
    measurementId: m.id,
    measurementMethod: m.measurementMethod,
    measuredByUserId: m.measuredByUserId,
    measuredAt: m.measuredAt,
    verifiedByUserId: m.verifiedByUserId,
    verifiedAt: m.verifiedAt,
    verificationMode: m.verificationMode,
    evidenceAttachmentIds: [...m.evidenceAttachmentIds],
    evidenceCount: m.evidenceAttachmentIds.length,
    provenance: closes
      ? `FIELD-VERIFIED measurement ${m.id.slice(0, 8)}… — ${m.measuredLengthFt} ft by ${m.measurementMethod}, `
        + `measured ${m.measuredAt}, verified ${m.verifiedAt} (${m.verificationMode}), `
        + `${m.evidenceAttachmentIds.length} evidence attachment(s)`
      : `FIELD-REPORTED measurement ${m.id.slice(0, 8)}… — ${m.measuredLengthFt} ft by ${m.measurementMethod}, `
        + `measured ${m.measuredAt}, NOT VERIFIED — supports provisional conclusions only`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE AUTHORITY BUNDLE THREADED INTO THE SNAPSHOT BUILD
// ═══════════════════════════════════════════════════════════════════════════

export interface FieldRouteMeasurementAuthority {
  /** per-segment, keyed by RouteSegmentRecord.segmentId. */
  bySegmentId: Record<string, FieldRouteLengthAuthority>;
  /** segments that have measurement HISTORY but no active authority (all
   *  rejected/superseded). Carried so the operator panel and the release
   *  resolver can say "there were measurements and none of them stand" rather
   *  than the indistinguishable "there were never any". */
  segmentsWithOnlyRetiredRecords: string[];
  /** how many VERIFIED measurements are active in this project. */
  verifiedCount: number;
  /** how many REPORTED_UNVERIFIED measurements are active. */
  reportedCount: number;
  /** true ⇒ the measurement store could not be read. FAIL-CLOSED: the CAD
   *  source stands, nothing is closed, and the reason is reported. */
  storeUnavailable: boolean;
  storeError: string | null;
  /** what was read, for the evidence trail. */
  basis: string;
}

export function emptyFieldMeasurementAuthority(reason: string): FieldRouteMeasurementAuthority {
  return {
    bySegmentId: {},
    segmentsWithOnlyRetiredRecords: [],
    verifiedCount: 0,
    reportedCount: 0,
    storeUnavailable: false,
    storeError: null,
    basis: reason,
  };
}

export function unavailableFieldMeasurementAuthority(error: string): FieldRouteMeasurementAuthority {
  return {
    bySegmentId: {},
    segmentsWithOnlyRetiredRecords: [],
    verifiedCount: 0,
    reportedCount: 0,
    storeUnavailable: true,
    storeError: error,
    // FAIL-CLOSED, and said out loud: an unreadable store is not "no
    // measurement", it is "we do not know", and the two are only the same
    // because both refuse to close anything.
    basis: `the field-measurement store could not be read (${error}) — no field authority is asserted, `
      + 'the CAD length source stands, and no field-verification requirement is closed',
  };
}

/**
 * Build the authority bundle from every measurement row in a project.
 * PURE — the rows are already fetched, so the same rows always produce the same
 * bundle and the bundle can be recorded as resolution evidence.
 */
export function buildFieldMeasurementAuthority(
  measurements: readonly FieldRouteMeasurement[],
): FieldRouteMeasurementAuthority {
  const bySegment = new Map<string, FieldRouteMeasurement[]>();
  for (const m of measurements) {
    const list = bySegment.get(m.routeSegmentId) ?? [];
    list.push(m);
    bySegment.set(m.routeSegmentId, list);
  }

  const out: Record<string, FieldRouteLengthAuthority> = {};
  const retiredOnly: string[] = [];
  let verifiedCount = 0;
  let reportedCount = 0;

  // Deterministic segment order so the bundle serialises identically run to run
  // (the snapshot digest is computed over it).
  for (const segmentId of [...bySegment.keys()].sort()) {
    const rows = bySegment.get(segmentId) ?? [];
    const active = selectActiveMeasurement(rows);
    if (!active) {
      if (rows.length > 0) retiredOnly.push(segmentId);
      continue;
    }
    const authority = toLengthAuthority(active);
    if (!authority) { retiredOnly.push(segmentId); continue; }
    out[segmentId] = authority;
    if (authority.closesFieldVerification) verifiedCount++; else reportedCount++;
  }

  return {
    bySegmentId: out,
    segmentsWithOnlyRetiredRecords: retiredOnly.sort(),
    verifiedCount,
    reportedCount,
    storeUnavailable: false,
    storeError: null,
    basis: `${measurements.length} field-measurement record(s) read; `
      + `${verifiedCount} segment(s) hold an active FIELD-VERIFIED length, `
      + `${reportedCount} hold an active FIELD-REPORTED (unverified) length, `
      + `${retiredOnly.length} have only rejected/superseded history`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE EXPLICIT CLOSURE POLICY FOR ROUTE-LENGTH-ESTIMATE
// ───────────────────────────────────────────────────────────────────────────
// WS-5 §14: "A CAD route does not close a field-verification requirement unless
// that segment has an explicit policy declaring CAD geometry sufficient."
//
// SolarPro HAS such a policy, and it predates this workstream: the AAC §2.13
// SPLIT ruling. The branch cable path is not a heuristic — it is the ordered
// chain through the module coordinates the CAD model actually carries, so its
// length is a DERIVATION from geometry rather than an estimate of one, and
// ROUTE-LENGTH-ESTIMATE was narrowed to the runs whose route is genuinely absent
// from the model. That ruling has been in force since AAC-4 and is what produces
// Braidon's "4 unresolved, 1 geometry-derived" split.
//
// What was missing was that it lived in a `const ROUTE_GEOMETRY_SOURCES` array
// in one resolver, where it read as an implementation detail rather than as a
// policy anyone decided. Naming it here makes it reviewable and testable, and
// makes the exception EXPLICIT in the sense §14 requires. It does not widen it:
// geometry closes ROUTE-LENGTH-ESTIMATE and nothing else, and it still never
// produces a VERIFIED_PASS voltage-drop grade.
// ═══════════════════════════════════════════════════════════════════════════

export const ROUTE_LENGTH_CLOSURE_POLICY = {
  requirementCode: 'ROUTE-LENGTH-ESTIMATE',
  /** the length SOURCES that satisfy this requirement's closure. */
  sufficientSources: ['cad-route', 'field-measurement', 'field-verified'] as const,
  /** …and the ones that never do, restated so the exclusion is visible. */
  insufficientSources: ['cad-derived-estimate', 'field-reported'] as const,
  basis:
    'AAC §2.13 SPLIT (in force since AAC-4): a CAD ROUTE is a derivation from coordinates the model carries, '
    + 'not an estimate of a route nobody has, so it satisfies ROUTE-LENGTH-ESTIMATE — which asks whether the run '
    + 'length is an ESTIMATE, not whether a tape was on the run. A bare FIELD REPORT does NOT satisfy it: an '
    + 'operator-entered number that no one has checked is a claim, and the requirement it would close is the one '
    + 'that exists to catch exactly that. Geometry never produces a VERIFIED_PASS voltage-drop grade — that '
    + 'remains field evidence only (gradeVoltageDrop).',
} as const;

/** Does this length source satisfy ROUTE-LENGTH-ESTIMATE closure? Fail-closed:
 *  an unrecognised source does not. */
export function sourceClosesRouteLengthRequirement(source: string | null | undefined): boolean {
  return (ROUTE_LENGTH_CLOSURE_POLICY.sufficientSources as readonly string[]).includes(String(source ?? ''));
}
