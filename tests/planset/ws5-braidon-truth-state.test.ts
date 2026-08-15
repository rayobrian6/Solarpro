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
  it('four project-owned runs are UNRESOLVED (estimate-grade)', () => {
    const unresolved = segs.filter(s => applic(s) === 'REQUIRED' && s.lengthSource === 'cad-derived-estimate');
    expect(unresolved.map(s => s.segmentId).sort()).toEqual(
      ['BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'DISCO_TO_METER_RUN', 'ROOF_RUN'],
    );
    expect(unresolved).toHaveLength(4);
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

describe('WS-5 §16 — ROUTE-LENGTH-ESTIMATE is OPEN, and was not suppressed', () => {
  const blocker = (snap.permitReadiness?.blockers ?? []).find(b => b.code === 'ROUTE-LENGTH-ESTIMATE');

  it('the requirement is present', () => {
    expect(blocker, 'ROUTE-LENGTH-ESTIMATE must remain OPEN on a project with no field measurements').toBeTruthy();
  });

  it('it names the four unresolved runs and excuses neither the derived nor the excluded one', () => {
    expect(blocker!.message).toContain('4 of 5 PROJECT-OWNED');
    for (const id of ['ROOF_RUN', 'BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'DISCO_TO_METER_RUN']) {
      expect(blocker!.message).toContain(id);
    }
    expect(blocker!.message).toContain('BRANCH_RUN');
    expect(blocker!.message).toContain('MSP_TO_UTILITY_RUN');
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
      expect(g.basis, s.segmentId).toMatch(/CAD-routed geometry|CAD-derived estimate/);
      expect(g.basis, s.segmentId).toMatch(/Field-verified route length required/);
    }
  });
});
