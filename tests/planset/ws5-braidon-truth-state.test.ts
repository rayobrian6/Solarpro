// ═══════════════════════════════════════════════════════════════════════════
// WS-5 §16 — BRAIDON REMAINS HONESTLY PENDING.
//
// The reachability proof (ws5-field-measurement-reachability.test.ts) shows the
// workflow can close ROUTE-LENGTH-ESTIMATE. This file exists to show that it did
// NOT close it here, and that nothing about wiring the measurement path changed
// what Braidon says about itself.
//
// The distinction WS-5 §16 asks for, made concrete:
//   WORKFLOW CLOSURE  — the workflow is complete and demonstrably reachable.
//   PROJECT CLOSURE   — this project's routes are still unmeasured, so its
//                       requirement is still open. That is the correct answer,
//                       and a WS-5 that produced any other one would have
//                       fabricated field evidence to look finished.
//
// No measurement is recorded, read, injected or implied below. The build runs
// with NO field-measurement authority — which is exactly what production does
// for a project with no rows.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { sourceClosesRouteLengthRequirement } from '@/lib/fieldMeasurement/resolver';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { gradeVoltageDrop } from '@/lib/permit/snapshot/electricalProjection';
import { buildFieldMeasurementAuthority, emptyFieldMeasurementAuthority } from '@/lib/fieldMeasurement/resolver';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(): PermitDesignSnapshot {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = '2026-08-02T12:00:00Z';
  generatePermitHTML(input as never);
  return (input as { _snapshot: PermitDesignSnapshot })._snapshot;
}

const snap = build();
const segs = snap.electrical.routeSegments ?? [];
const applic = (s: (typeof segs)[number]) => s.routeAuthorityApplicability ?? 'REQUIRED';

describe('WS-5 §16 — Braidon carries ZERO field measurements', () => {
  it('no segment claims field-measured or field-verified authority', () => {
    for (const s of segs) {
      expect(s.lengthSource, s.segmentId).not.toBe('field-measurement');
      expect(s.lengthSource, s.segmentId).not.toBe('operator-entry');
      expect(s.verificationState, s.segmentId).not.toBe('field-verified');
      expect(s.verificationState, s.segmentId).not.toBe('field-reported');
    }
  });

  it('verifiedFieldLengthFt is unset on EVERY segment — the field named "verified" holds nothing', () => {
    for (const s of segs) {
      expect(s.verifiedFieldLengthFt ?? null, s.segmentId).toBeNull();
    }
  });

  it('no provenance references a field measurement', () => {
    for (const s of segs) {
      expect(String(s.provenance?.ref ?? ''), s.segmentId).not.toMatch(/fieldRouteMeasurement/);
      expect(String(s.provenance?.source ?? ''), s.segmentId).not.toMatch(/FIELD-VERIFIED|FIELD-REPORTED/);
    }
  });

  it('an EMPTY authority bundle reports zero verified and zero reported', () => {
    const bundle = buildFieldMeasurementAuthority([]);
    expect(bundle.verifiedCount).toBe(0);
    expect(bundle.reportedCount).toBe(0);
    expect(Object.keys(bundle.bySegmentId)).toEqual([]);
    expect(emptyFieldMeasurementAuthority('x').storeUnavailable).toBe(false);
  });
});

describe('WS-5 §16 — the route source distribution is unchanged', () => {
// 2026-08-28 TAP MIGRATION - DISCO_TO_METER_RUN left this list.
  // It is the supply-side tap span, whose length the DESIGN now fixes at the NEC
  // 705.11(C) 10-ft maximum (the drawing prints the placement requirement). It is
  // therefore no longer an ESTIMATE of anything, which is precisely the question
  // ROUTE-LENGTH-ESTIMATE asks. The three runs below genuinely have no route in
  // the model and are unchanged.
  it('three project-owned runs are UNRESOLVED (estimate-grade)', () => {
    const unresolved = segs.filter(s => applic(s) === 'REQUIRED' && s.lengthSource === 'cad-derived-estimate');
    expect(unresolved.map(s => s.segmentId).sort()).toEqual(
      ['BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'ROOF_RUN'],
    );
    expect(unresolved).toHaveLength(3);
  });

  it('the tap span is DESIGN-FIXED, not an estimate and not field evidence', () => {
    const tap = segs.find(s => s.segmentId === 'DISCO_TO_METER_RUN')!;
    expect(applic(tap)).toBe('REQUIRED');
    expect(tap.lengthSource).toBe('known-design');
    expect(tap.verificationState).toBe('design-constraint');
    // it closes ROUTE-LENGTH-ESTIMATE and NOTHING else
    expect(tap.verifiedFieldLengthFt ?? null).toBeNull();
  });

  it('one project-owned run is GEOMETRY-DERIVED — BRANCH_RUN, cad-route', () => {
    const derived = segs.filter(s => applic(s) === 'REQUIRED' && s.lengthSource === 'cad-route');
    expect(derived.map(s => s.segmentId)).toEqual(['BRANCH_RUN']);
    expect(derived[0].verificationState).toBe('geometry-derived');
    expect(derived[0].verificationStatus).toBe('geometry-derived');
    // The pair reconciles — the WS-5 part-1 conclusion, still true.
    expect(derived[0].calculationLengthFt).toBe(derived[0].oneWayFt);
  });

  it('one run is UTILITY-OWNED and EXCLUDED', () => {
    const excluded = segs.filter(s => applic(s) !== 'REQUIRED');
    expect(excluded.map(s => s.segmentId)).toEqual(['MSP_TO_UTILITY_RUN']);
    expect(excluded[0].routeOwnership).toBe('UTILITY_OWNED');
  });
});

// 2026-08-28 ROUTE-BOUND MIGRATION — this describe pinned the requirement OPEN.
// It no longer fires: the DESIGN bounds each un-routed run by stating the maximum
// one-way length at which the selected conductor still meets its Vd limit, and
// the drawing carries that requirement.
//
// WS-5 §16's real subject is that NOTHING WAS SUPPRESSED — every run is still
// accounted for, by name, with the reason it is or is not blocked. That is what
// is asserted now, on the segments themselves.
describe('WS-5 §16 — every project run is accounted for, and nothing was suppressed', () => {
  const blocker = (snap.permitReadiness?.blockers ?? []).find(b => b.code === 'ROUTE-LENGTH-ESTIMATE');

  it('the requirement is CLEARED, and cleared by a stated design bound', () => {
    expect(blocker).toBeFalsy();
    for (const id of ['ROOF_RUN', 'BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN']) {
      const s = segs.find(x => x.segmentId === id)!;
      expect(s.lengthBoundState, id).toBe('bounded');
      expect(s.designMaxOneWayFt, id).toBeGreaterThan(0);
    }
  });

  it('every run is still accounted for — routed, design-fixed, bounded or excluded', () => {
    for (const s of segs) {
      const accounted =
        sourceClosesRouteLengthRequirement(s.lengthSource)
        || s.lengthBoundState === 'bounded'
        || (s.routeAuthorityApplicability ?? 'REQUIRED') !== 'REQUIRED';
      expect(accounted, `${s.segmentId} is unaccounted for`).toBe(true);
    }
    // the utility-owned run is EXCLUDED, not silently dropped
    const msp = segs.find(x => x.segmentId === 'MSP_TO_UTILITY_RUN')!;
    expect(msp.routeAuthorityApplicability).toBe('EXCLUDED');
  });
});

describe('WS-5 §16 — every printed conclusion carries its grade', () => {
  it('no route produces a VERIFIED_PASS voltage-drop grade', () => {
    for (const s of segs) {
      const g = gradeVoltageDrop({
        pct: s.voltageDropPct, lengthFt: s.calculationLengthFt ?? s.oneWayFt,
        lengthSource: s.lengthSource, verificationState: s.verificationState,
      });
      expect(g.conclusion, s.segmentId).not.toBe('VERIFIED_PASS');
    }
  });

  it('a within-criterion result is PROVISIONAL PASS and names its length basis', () => {
    const within = segs.filter(s => s.voltageDropPct != null && s.voltageDropPct <= 3 && s.calculationLengthFt != null);
    expect(within.length).toBeGreaterThan(0);
    for (const s of within) {
      const g = gradeVoltageDrop({
        pct: s.voltageDropPct, lengthFt: s.calculationLengthFt,
        lengthSource: s.lengthSource, verificationState: s.verificationState,
      });
      expect(g.conclusion, s.segmentId).toBe('PROVISIONAL_PASS');
      expect(g.label).toBe('PROVISIONAL PASS');
      // 2026-08-29 - the tap span is FIXED BY DESIGN, not estimated. See the note
      // in d5-voltage-drop-cross-sheet.test.ts case 23. It is still PROVISIONAL
      // (inspection confirms the install follows the drawing); what it does not
      // owe is a measurement, because the number is a requirement.
      const designFixed = s.verificationState === 'design-constraint' || s.lengthSource === 'known-design';
      if (designFixed) {
        expect(g.basis, s.segmentId).toMatch(/FIXED BY DESIGN/);
        expect(g.basis, s.segmentId).toMatch(/inspection confirms the installation follows it/);
        expect(g.fieldVerificationPending, s.segmentId).toBe(false);
      } else {
        expect(g.basis, s.segmentId).toMatch(/CAD-routed geometry|CAD-derived estimate/);
        expect(g.basis, s.segmentId).toMatch(/Field-verified route length required/);
      }
    }
  });
});
