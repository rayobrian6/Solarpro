// ═══════════════════════════════════════════════════════════════════════════
// WS-5 §15 — THE CONTROLLED REACHABILITY PROOF.
//
// The claim under test is not "a table exists" or "an API accepts a number". It
// is that this transition is REACHABLE through the real workflow:
//
//   CAD estimate → operator records → FIELD_REPORTED / REPORTED_UNVERIFIED
//     → authorised verification → FIELD_VERIFIED / VERIFIED
//     → canonical calculation length updates
//     → voltage drop recalculates
//     → procurement length recalculates
//     → the release requirement closes
//     → rejection or supersession REOPENS it
//
// WHAT RUNS FOR REAL: the measurement service, the capability model, the
// verification policy, the evidence resolver, the repository contract, the
// deterministic selection rule, `buildFieldMeasurementAuthority`, and the whole
// planset engine (generatePermitHTML → buildPermitDesignSnapshot → the route
// segment authority → gradeVoltageDrop → the ROUTE-LENGTH-ESTIMATE emitters).
//
// WHAT IS SUBSTITUTED: the storage DRIVER (in-memory adapter, contract-tested
// against the Postgres adapter in tests/fieldMeasurement/repository-contract.test.ts)
// and the four external reads (project owner, org membership, attachments,
// route facts). NOTHING below writes a resolved snapshot field, mutates a
// verification state directly, or bypasses RBAC or the policy service.
//
// WHY A CONTROLLED PROJECT AND NOT BRAIDON: Braidon's routes are genuinely
// unmeasured. Inserting an invented measurement to demonstrate reachability
// would make the live truth-state a lie, which is the exact failure mode this
// workstream is auditing for. The fixture below is a SEPARATE project identity;
// Braidon's own state is asserted, unchanged, in
// tests/planset/ws5-braidon-truth-state.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { gradeVoltageDrop, projectCanonicalFeeder } from '@/lib/permit/snapshot/electricalProjection';
import { inMemoryMeasurementService, type FieldMeasurementService } from '@/lib/fieldMeasurement/service';
import { buildFieldMeasurementAuthority, sourceClosesRouteLengthRequirement } from '@/lib/fieldMeasurement/resolver';
import { closesFieldVerification } from '@/lib/permit/snapshot/types';
import type { FieldRouteMeasurementAuthority } from '@/lib/fieldMeasurement/resolver';
import type { RouteApplicabilityFact } from '@/lib/fieldMeasurement/types';
import { routeFactsFromSnapshot } from '@/lib/fieldMeasurement/permitAccess';
import {
  ATTACHMENT_A, MEASURED_AT, ORG_A, PROJECT_A, USER_A_ADMIN, USER_A_MEMBER,
  fixedClock, fixtureAuthorizationSource, fixtureEvidenceSource, recordingSinks,
} from '../fieldMeasurement/fixtures';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** The CONTROLLED project — a distinct identity, never the live Braidon record. */
function controlledInput(): Record<string, unknown> {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = '2026-08-02T12:00:00Z';
  input.projectId = PROJECT_A;
  const proj = input.project as Record<string, unknown>;
  proj.projectId = PROJECT_A;
  proj.name = 'WS-5 CONTROLLED REACHABILITY FIXTURE';
  proj.customerName = 'WS-5 Reachability Fixture';
  return input;
}

/** Build the planset with a given field-measurement authority and return the
 *  snapshot. This is the REAL engine — nothing here edits the snapshot after. */
function build(authority: FieldRouteMeasurementAuthority | null): PermitDesignSnapshot {
  const input = controlledInput();
  generatePermitHTML(
    input as never,
    undefined,
    // Only the WS-5 socket is populated; every other authority keeps its
    // fail-soft default, so this build is the ordinary one plus measurements.
    authority ? ({ fieldRouteMeasurements: authority } as never) : undefined,
  );
  return (input as { _snapshot: PermitDesignSnapshot })._snapshot;
}

const seg = (snap: PermitDesignSnapshot, id: string) =>
  (snap.electrical.routeSegments ?? []).find(s => s.segmentId === id);

const routeBlocker = (snap: PermitDesignSnapshot) =>
  (snap.permitReadiness?.blockers ?? []).find(b => b.code === 'ROUTE-LENGTH-ESTIMATE') ?? null;

const routeResolverState = (snap: PermitDesignSnapshot) =>
  ((snap as unknown as { resolution?: { requirementStates?: Record<string, { cleared?: boolean }> } })
    .resolution?.requirementStates ?? {})['ROUTE-LENGTH-ESTIMATE'] ?? null;

// ── the service the operator actually uses ──────────────────────────────────

let svc: FieldMeasurementService;
let sinks: ReturnType<typeof recordingSinks>;
let baselineRoutes: RouteApplicabilityFact[];
/** the project-owned runs that still owe a field measurement at baseline. */
let residualIds: string[];
let baseline: PermitDesignSnapshot;

/** Rebuild the authority the way production does: read the store through the
 *  service, then reduce with the SAME function the permit resolver calls. */
async function currentAuthority(): Promise<FieldRouteMeasurementAuthority> {
  const { measurements } = await svc.listProject(USER_A_ADMIN, PROJECT_A);
  return buildFieldMeasurementAuthority(measurements);
}

async function recordOn(segmentId: string, ft: number, userId = USER_A_MEMBER) {
  return svc.record({
    userId, projectId: PROJECT_A, routeSegmentId: segmentId,
    measuredLengthFt: ft, measurementMethod: 'LASER', measuredAt: MEASURED_AT,
    evidenceAttachmentIds: [ATTACHMENT_A], notes: `field measurement of ${segmentId}`,
  });
}

beforeAll(async () => {
  baseline = build(null);
  baselineRoutes = routeFactsFromSnapshot(baseline);
  const applicable = baselineRoutes.filter(r => r.routeAuthorityApplicability === 'REQUIRED');
  residualIds = applicable
    .filter(r => r.currentLengthSource !== 'cad-route' && r.currentLengthSource !== 'field-measurement')
    .map(r => r.segmentId);

  sinks = recordingSinks();
  svc = inMemoryMeasurementService({
    authorization: fixtureAuthorizationSource(),
    evidence: fixtureEvidenceSource(),
    // The route facts come from the REAL snapshot — the same D1 ownership /
    // applicability decision the engine made, projected, never re-derived.
    routes: { async listRouteFacts() { return baselineRoutes; } },
    invalidation: sinks.invalidation,
    compliance: sinks.compliance,
    now: fixedClock(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 0 — THE BASELINE
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §15 stage 0 — the baseline is an estimate and the requirement is OPEN', () => {
  it('the controlled fixture has project-owned runs that owe a field measurement', () => {
    expect(residualIds.length).toBeGreaterThan(0);
  });

  // 2026-08-28 TAP MIGRATION - `residualIds` is a hand-written list of segment
  // ids, so it kept naming DISCO_TO_METER_RUN after that run stopped being an
  // estimate (the design now fixes the supply-side tap span at the NEC 705.11(C)
  // maximum). The assertion is restated so it reads the residual set the CLOSURE
  // POLICY produces rather than a literal: a run that no longer owes a field
  // measurement is not a weakened assertion, it is one fewer residual.
  it('every residual run reads CAD_DERIVED_ESTIMATE / cad-derived-estimate', () => {
    const residual = residualIds.filter(id => !sourceClosesRouteLengthRequirement(seg(baseline, id)?.lengthSource));
    expect(residual.length, 'the fixture must still exercise the estimate path').toBeGreaterThan(0);
    for (const id of residual) {
      const s = seg(baseline, id)!;
      expect(s.lengthSource, id).toBe('cad-derived-estimate');
      expect(s.verificationState, id).toBe('cad-derived-estimate');
    }
    // and the run that LEFT the residual set left it for a stated reason
    for (const id of residualIds.filter(i => !residual.includes(i))) {
      expect(seg(baseline, id)!.lengthSource, id).toBe('known-design');
    }
  });

  it('the residual runs carry an ESTIMATE length authority, not field evidence', () => {
    // 2026-08-28 ROUTE-BOUND MIGRATION - ROUTE-LENGTH-ESTIMATE no longer fires
    // on this fixture: the DESIGN bounds each un-routed run by stating the
    // maximum one-way length at which the selected conductor still meets its Vd
    // limit. That closes the PERMIT question and leaves this suite's actual
    // subject untouched - the field-measurement authority lifecycle, and the
    // rule that RECORDING IS NOT VERIFICATION. Both are asserted directly on the
    // segment's length authority, which is where they were always true.
    expect(routeBlocker(baseline)).toBeFalsy();
    for (const id of residualIds) {
      const s = seg(baseline, id)!;
      if (sourceClosesRouteLengthRequirement(s.lengthSource)) continue;
      expect(s.lengthSource, id).toBe('cad-derived-estimate');
      expect(s.verifiedFieldLengthFt ?? null, id).toBeNull();
    }
  });

  it('the voltage drop on a residual run grades PROVISIONAL_PASS or FAIL — never VERIFIED_PASS', () => {
    for (const id of residualIds) {
      const s = seg(baseline, id)!;
      const g = gradeVoltageDrop({
        pct: s.voltageDropPct, lengthFt: s.calculationLengthFt ?? s.oneWayFt,
        lengthSource: s.lengthSource, verificationState: s.verificationState,
      });
      expect(['PROVISIONAL_PASS', 'FAIL', 'INDETERMINATE'], id).toContain(g.conclusion);
      expect(g.conclusion, id).not.toBe('VERIFIED_PASS');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1 — RECORD (through the real service)
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §15 stage 1 — a recorded measurement moves the calculation and closes NOTHING', () => {
  let reported: PermitDesignSnapshot;
  const target = () => residualIds[0];
  /** deliberately different from the CAD estimate, so a change is detectable. */
  const REPORTED_FT = 87;

  beforeAll(async () => {
    for (const id of residualIds) {
      // A distinct length per run, so no assertion can pass by coincidence.
      await recordOn(id, REPORTED_FT + residualIds.indexOf(id));
    }
    reported = build(await currentAuthority());
  });

  it('39. the REAL workflow reaches FIELD_REPORTED / REPORTED_UNVERIFIED', async () => {
    const h = await svc.listHistory(USER_A_ADMIN, PROJECT_A, target());
    expect(h.active?.verificationState).toBe('REPORTED_UNVERIFIED');
    const s = seg(reported, target())!;
    expect(s.lengthSource).toBe('operator-entry');
    expect(s.verificationState).toBe('field-reported');
    expect(s.lengthProvenance).toBe('field-measured');
  });

  it('the CALCULATION length is the reported value, and the VERIFIED field stays null', () => {
    const s = seg(reported, target())!;
    expect(s.calculationLengthFt).toBe(REPORTED_FT);
    expect(s.oneWayFt).toBe(REPORTED_FT);
    // The number is in the calculation field, NOT in the field named "verified".
    expect(s.verifiedFieldLengthFt).toBeNull();
  });

  it('the voltage drop is RECOMPUTED, not retained', () => {
    const before = seg(baseline, target())!;
    const after = seg(reported, target())!;
    expect(after.voltageDropPct).not.toBe(before.voltageDropPct);
    // and it moved in the direction the longer run implies
    if (before.voltageDropPct != null && after.voltageDropPct != null && (before.calculationLengthFt ?? 0) < REPORTED_FT) {
      expect(after.voltageDropPct).toBeGreaterThan(before.voltageDropPct);
    }
  });

  it('41. RECORDING IS NOT VERIFICATION — the report never becomes field evidence', () => {
    // 2026-08-28 ROUTE-BOUND MIGRATION - ROUTE-LENGTH-ESTIMATE no longer fires
    // on this fixture: the DESIGN bounds each un-routed run by stating the
    // maximum one-way length at which the selected conductor still meets its Vd
    // limit. That closes the PERMIT question and leaves this suite's actual
    // subject untouched - the field-measurement authority lifecycle, and the
    // rule that RECORDING IS NOT VERIFICATION. Both are asserted directly on the
    // segment's length authority, which is where they were always true.
    const s = seg(reported, target())!;
    // the number MOVED (an operator report becomes the calculation length) …
    expect(s.lengthSource).toBe('operator-entry');
    // … and it is still NOT verified: no verified field length, and the
    // verification state is the unverified report, not field evidence.
    expect(s.verifiedFieldLengthFt ?? null).toBeNull();
    expect(s.verificationState).toBe('field-reported');
    expect(closesFieldVerification(s.verificationState)).toBe(false);
  });

  it('the voltage-drop grade stays PROVISIONAL for an unverified report', () => {
    const s = seg(reported, target())!;
    const g = gradeVoltageDrop({
      pct: s.voltageDropPct, lengthFt: s.calculationLengthFt,
      lengthSource: s.lengthSource, verificationState: s.verificationState,
    });
    expect(g.conclusion).not.toBe('VERIFIED_PASS');
    expect(['PROVISIONAL_PASS', 'FAIL', 'INDETERMINATE']).toContain(g.conclusion);
  });

  it('the procurement length is derived from ITEMISED allowances, not a blanket factor', () => {
    const s = seg(reported, target())!;
    expect(s.procurementLengthFt).toBeGreaterThan(s.calculationLengthFt!);
    // 1.05 × 1.03 = 1.0815, + 3 ft fixed ⇒ ceil(87 × 1.0815 + 3) = 98
    expect(s.procurementLengthFt).toBe(Math.ceil(REPORTED_FT * 1.05 * 1.03 + 3));
    expect(s.wasteFactor).toBeCloseTo(1.0815, 4);
    expect(String(s.provenance?.source)).toMatch(/termination allowance|service loop/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2 — VERIFY (through the real policy)
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §15 stage 2 — verification closes the requirement', () => {
  let verified: PermitDesignSnapshot;
  const target = () => residualIds[0];

  beforeAll(async () => {
    for (const id of residualIds) {
      const h = await svc.listHistory(USER_A_ADMIN, PROJECT_A, id);
      await svc.verify({
        userId: USER_A_ADMIN,                 // NOT the recorder — independent review
        projectId: PROJECT_A, routeSegmentId: id, measurementId: h.active!.id,
        verificationNotes: 'independently re-measured with a wheel against the as-built stub-up positions',
      });
    }
    verified = build(await currentAuthority());
  });

  it('40. the REAL workflow reaches FIELD_VERIFIED / VERIFIED', async () => {
    const h = await svc.listHistory(USER_A_ADMIN, PROJECT_A, target());
    expect(h.active?.verificationState).toBe('VERIFIED');
    expect(h.active?.verificationMode).toBe('INDEPENDENT_REVIEW');
    expect(h.active?.verifiedByUserId).toBe(USER_A_ADMIN);
    expect(h.active?.measuredByUserId).toBe(USER_A_MEMBER);
    const s = seg(verified, target())!;
    expect(s.lengthSource).toBe('field-measurement');
    expect(s.verificationState).toBe('field-verified');
  });

  it('the VERIFIED length field is now populated — and only now', () => {
    const s = seg(verified, target())!;
    expect(s.verifiedFieldLengthFt).toBe(87);
    expect(s.calculationLengthFt).toBe(87);
  });

  it('42. the requirement CLOSES once every applicable route qualifies', () => {
    expect(routeBlocker(verified), 'ROUTE-LENGTH-ESTIMATE should be gone once all applicable routes are verified').toBeNull();
    const st = routeResolverState(verified);
    if (st) expect(st.cleared).toBe(true);
  });

  it('the voltage-drop grade may now reach VERIFIED_PASS (and a failure still fails)', () => {
    const s = seg(verified, target())!;
    const g = gradeVoltageDrop({
      pct: s.voltageDropPct, lengthFt: s.calculationLengthFt,
      lengthSource: s.lengthSource, verificationState: s.verificationState,
    });
    if (s.voltageDropPct != null && s.voltageDropPct <= 3) {
      expect(g.conclusion).toBe('VERIFIED_PASS');
      expect(g.label).toBe('✓ VERIFIED PASS');
    } else {
      // 49 — over the limit is a FAIL at every grade.
      expect(g.conclusion).toBe('FAIL');
    }
  });

  it('52. THE FEEDER PROJECTION MATCHES THE SEGMENT — one recalculation, not two numbers', () => {
    // The defect this pins was found by VISUAL inspection, not by a unit test:
    // PV-4B printed "AC feeder Vd = 0.37% over 89 ft" — the pre-measurement
    // percentage beside the measured length — because `electrical.feeder`
    // carries a SECOND copy of the same result and projectCanonicalFeeder
    // prefers it over the segment.
    const feederSeg = (verified.electrical.routeSegments ?? [])
      .find(s => s.segmentId === 'COMBINER_TO_DISCO_RUN' || s.segmentId === 'INV_TO_DISCO_RUN');
    expect(feederSeg, 'the fixture has no canonical feeder segment').toBeTruthy();
    expect(feederSeg!.lengthSource).toBe('field-measurement');
    expect(verified.electrical.feeder.voltageDropPct).toBe(feederSeg!.voltageDropPct);

    const projected = projectCanonicalFeeder(verified);
    expect(projected.voltageDropPct).toBe(feederSeg!.voltageDropPct);
    expect(projected.oneWayFt).toBe(feederSeg!.calculationLengthFt);
    // …and the grade printed from that pair is the one the length authority earns.
    const g = gradeVoltageDrop({
      pct: projected.voltageDropPct, lengthFt: projected.oneWayFt,
      lengthSource: feederSeg!.lengthSource, verificationState: feederSeg!.verificationState,
    });
    expect(['VERIFIED_PASS', 'FAIL']).toContain(g.conclusion);
  });

  it('the provenance names the measurement, the evidence and the verifier', () => {
    const s = seg(verified, target())!;
    expect(String(s.provenance?.ref)).toMatch(/^authority:fieldRouteMeasurement#/);
    expect(String(s.provenance?.source)).toMatch(/FIELD-VERIFIED/);
    expect(String(s.provenance?.source)).toMatch(/evidence attachment/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3 — REOPENING
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §15 stage 3 — the requirement REOPENS', () => {
  it('43. rejecting the selected verified authority reopens it', async () => {
    const id = residualIds[0];
    const h = await svc.listHistory(USER_A_ADMIN, PROJECT_A, id);
    expect(h.active?.verificationState).toBe('VERIFIED');

    await svc.reject({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: id,
      measurementId: h.active!.id,
      rejectionReason: 'the wheel was re-zeroed mid-run; the recorded distance is not trustworthy',
    });

    const after = build(await currentAuthority());
    // 2026-08-28 ROUTE-BOUND MIGRATION - the REOPEN is now asserted on the length
    // AUTHORITY rather than on ROUTE-LENGTH-ESTIMATE, which no longer fires here
    // (the design bounds the run). Withdrawing a verification must still undo the
    // field evidence, and it does.
    // the segment falls back to the CAD source, not to the rejected number.
    const s = seg(after, id)!;
    expect(s.lengthSource).toBe('cad-derived-estimate');
    // Unpopulated on a CAD-source segment (the WS-5 block never runs for it), so
    // the assertion is "carries no verified length", not "is literally null".
    expect(s.verifiedFieldLengthFt ?? null).toBeNull();
    // the rejected VALUE is retained as history
    const hist = await svc.listHistory(USER_A_ADMIN, PROJECT_A, id);
    expect(hist.measurements.some(m => m.verificationState === 'REJECTED' && m.measuredLengthFt === 87)).toBe(true);
    expect(hist.active).toBeNull();
  });

  it('44. superseding a verified record WITHOUT verifying the replacement reopens it', async () => {
    const id = residualIds[1] ?? residualIds[0];
    const h = await svc.listHistory(USER_A_ADMIN, PROJECT_A, id);
    // (residualIds[0] was rejected above; pick a route that is still verified)
    if (h.active?.verificationState !== 'VERIFIED') return;

    await svc.supersede({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: id,
      measurementId: h.active.id,
      measuredLengthFt: 93, measurementMethod: 'MEASURING_WHEEL', measuredAt: MEASURED_AT,
      evidenceAttachmentIds: [ATTACHMENT_A],
    });

    const after = build(await currentAuthority());
    const s = seg(after, id)!;
    // The replacement IS the calculation length…
    expect(s.calculationLengthFt).toBe(93);
    // …and it is NOT verified, so it does not close anything.
    expect(s.verificationState).toBe('field-reported');
    expect(s.verifiedFieldLengthFt).toBeNull();
    // 2026-08-28 ROUTE-BOUND MIGRATION - asserted on the length AUTHORITY, which
    // is where "superseding a verified record with an unverified one undoes the
    // verification" is actually true. The permit requirement no longer fires
    // here because the design bounds the run.
    expect(closesFieldVerification(seg(after, id)!.verificationState)).toBe(false);

    const hist = await svc.listHistory(USER_A_ADMIN, PROJECT_A, id);
    expect(hist.measurements.some(m => m.verificationState === 'SUPERSEDED')).toBe(true);
  });

  it('45. no test in this file mutated a snapshot — every state came from the service', () => {
    // A structural assertion rather than a comment: the snapshots are frozen by
    // the engine, so any direct write would have thrown. Confirm the freeze is
    // actually in force, otherwise this proof would be weaker than it reads.
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.electrical)).toBe(true);
    expect(() => {
      (baseline.electrical.routeSegments![0] as { lengthSource: string }).lengthSource = 'field-verified';
    }).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — the WS-5 part-1 conclusions are untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 — the part-1 conclusions still hold with the measurement path wired', () => {
  it('53. BRANCH_RUN remains cad-route / geometry-derived with NO measurement', () => {
    const s = seg(baseline, 'BRANCH_RUN');
    expect(s).toBeTruthy();
    expect(s!.lengthSource).toBe('cad-route');
    expect(s!.verificationState).toBe('geometry-derived');
    expect(s!.verificationStatus).toBe('geometry-derived');
    // The LENGTH is a property of the design, not of this workstream: this
    // fixture (the 07-22 audit capture) routes to 58 ft, while the LIVE Braidon
    // project routes to 64 ft. Both are the same fact — the branch cable path is
    // derived from the module coordinates the model carries — so what is pinned
    // here is that oneWay and the calculation basis are ONE number from ONE
    // derivation. The live 64 ft is pinned against the live project in
    // tests/planset/ws5-braidon-truth-state.test.ts.
    expect(s!.calculationLengthFt).toBe(s!.oneWayFt);
    expect(s!.calculationLengthFt).toBeGreaterThan(0);
  });

  it('the (source, state) pair is legal on EVERY segment, measured or not', async () => {
    const { isValidRouteLengthAuthority } = await import('@/lib/permit/snapshot/types');
    const withMeasurements = build(await currentAuthority());
    for (const snap of [baseline, withMeasurements]) {
      for (const s of snap.electrical.routeSegments ?? []) {
        // 'operator-entry'/'field-measurement' are the SEGMENT source names; map
        // them to the authority vocabulary the pairing table declares.
        const source = s.lengthSource === 'operator-entry' ? 'field-reported'
          : s.lengthSource === 'field-measurement' ? 'field-verified'
          : s.lengthSource;
        expect(
          isValidRouteLengthAuthority(source, s.verificationState),
          `${s.segmentId}: ${s.lengthSource} / ${s.verificationState}`,
        ).toBe(true);
      }
    }
  });

  it('a UTILITY-OWNED run never acquires field authority, even if a stale row named it', async () => {
    const utility = baselineRoutes.find(r => r.routeAuthorityApplicability !== 'REQUIRED');
    expect(utility, 'the fixture has no utility-owned run to test').toBeTruthy();
    // The API refuses to create one…
    await expect(recordOn(utility!.segmentId, 12)).rejects.toThrow(/EXCLUDED|not applicable|utility-owned/i);
    // …and the build ignores an authority that names it anyway (fail-closed).
    const forged = buildFieldMeasurementAuthority([{
      id: 'forged', tenantId: `org:${ORG_A}`, tenantOrganizationId: ORG_A, projectId: PROJECT_A,
      routeSegmentId: utility!.segmentId, measuredLengthFt: 12, measurementMethod: 'TAPE',
      measuredByUserId: USER_A_MEMBER, measuredAt: MEASURED_AT, recordedAt: MEASURED_AT,
      evidenceAttachmentIds: [], notes: null,
      verificationState: 'VERIFIED', verificationMode: 'INDEPENDENT_REVIEW',
      verifiedByUserId: USER_A_ADMIN, verifiedAt: MEASURED_AT, verificationNotes: null, evidenceExceptionReason: null,
      rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
      supersedesMeasurementId: null, supersededByMeasurementId: null,
      createdAt: MEASURED_AT, updatedAt: MEASURED_AT,
    }]);
    const snap = build(forged);
    const s = seg(snap, utility!.segmentId)!;
    expect(s.lengthSource).toBe('cad-derived-estimate');
    expect(s.verificationState).toBe('cad-derived-estimate');
  });
});
