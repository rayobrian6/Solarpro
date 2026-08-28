// ═══════════════════════════════════════════════════════════════════════════
// THE DESIGN LENGTH BOUND (2026-08-28)
//
// ROUTE-LENGTH-ESTIMATE admitted two answers — routed CAD geometry, or a field
// measurement — so on a nationwide product no package closed until somebody
// walked the attic. There is a third: the DESIGN BOUNDS the run, by stating the
// maximum one-way length at which the selected conductor still meets the
// voltage-drop limit the schedule grades it against.
//
// The bound is not free, and these tests are the proof. It cannot be computed
// without a real conductor, it is rounded DOWN, it uses the same limit the
// schedule grades with, it FAILS when the estimate already exceeds it, and the
// drawing has to state it or "pass by design" is a claim about a document that
// does not carry the requirement.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  deriveRouteLengthBound, maxOneWayLengthFt, vdLimitPctForSegment, ROUTE_VD_LIMIT_PCT,
  ROUTE_LENGTH_EXCEEDS_BOUND_CODE,
} from '@/lib/electrical/routeLengthBound';
import { calcVoltageDrop } from '@/lib/manufacturer-specs';
import { REQUIREMENT_DECLARATIONS, UNMAPPED_GATE_ID } from '@/lib/permit/snapshot/releaseGates';
import { SEVERITY_POLICY } from '@/lib/permit/snapshot/severityPolicy';
import { classifyBlockerDomain } from '@/lib/permit/snapshot/projectAuthority';
import { BLOCKER_PAYLOAD_SCHEMA } from '@/lib/permit/sections/reviewStatus';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const seg = (over: Partial<Parameters<typeof deriveRouteLengthBound>[0]> = {}) =>
  deriveRouteLengthBound({
    segmentId: 'COMBINER_TO_DISCO_RUN',
    conductorGauge: '#6 AWG',
    currentA: 56.3,
    systemVoltage: 240,
    vdLimitPct: 3,
    estimatedOneWayFt: 20,
    ...over,
  });

describe('the bound is a real calculation', () => {
  it('the length it returns actually meets the limit — and one foot more does not', () => {
    const max = maxOneWayLengthFt('#10 AWG', 20, 240, 2)!;
    expect(max).toBeGreaterThan(0);
    expect(calcVoltageDrop(20, max, '#10 AWG', 240)).toBeLessThanOrEqual(2);
    // rounded DOWN: a bound rounded up would permit a length the conductor fails at
    expect(calcVoltageDrop(20, max + 1, '#10 AWG', 240)).toBeGreaterThan(2);
    expect(Number.isInteger(max)).toBe(true);
  });

  it('scales the way voltage drop does — halve the current, double the length', () => {
    const a = maxOneWayLengthFt('#10 AWG', 20, 240, 2)!;
    const b = maxOneWayLengthFt('#10 AWG', 10, 240, 2)!;
    expect(b).toBeGreaterThanOrEqual(a * 2 - 1);
    expect(b).toBeLessThanOrEqual(a * 2 + 1);
  });

  it('refuses an unrecognised gauge instead of returning a perfect zero', () => {
    // calcVoltageDrop returns 0 for a gauge it does not know — a refusal wearing
    // the shape of a great result. It must never become an infinite bound.
    expect(maxOneWayLengthFt('#999 AWG', 20, 240, 2)).toBeNull();
    expect(maxOneWayLengthFt('#10 AWG', 0, 240, 2)).toBeNull();
    expect(maxOneWayLengthFt('#10 AWG', 20, 0, 2)).toBeNull();
  });
});

describe('the three states', () => {
  it('BOUNDED — the estimate is inside the maximum the conductor permits', () => {
    const b = seg();
    expect(b.state).toBe('bounded');
    expect(b.maxOneWayFt!).toBeGreaterThan(b.estimatedOneWayFt!);
    expect(b.constructionNote).toMatch(/MAXIMUM ONE-WAY LENGTH \d+ FT/);
    expect(b.constructionNote).toMatch(/requires upsizing/);
  });

  it('EXCEEDS-BOUND — the run as laid out fails its own voltage-drop limit', () => {
    const b = seg({ estimatedOneWayFt: 5000 });
    expect(b.state).toBe('exceeds-bound');
    expect(b.basis).toMatch(/EXCEEDS/);
    expect(b.basis).toMatch(/Upsize the conductor or shorten the route/);
    // it still STATES the bound — the reader needs the number to act on
    expect(b.maxOneWayFt).not.toBeNull();
  });

  it('UNBOUNDED — no conductor, no bound, and the requirement stands', () => {
    for (const over of [
      { conductorGauge: null }, { currentA: null }, { systemVoltage: null }, { vdLimitPct: null },
    ] as Array<Partial<Parameters<typeof deriveRouteLengthBound>[0]>>) {
      const b = seg(over);
      expect(b.state, JSON.stringify(over)).toBe('unbounded');
      expect(b.maxOneWayFt).toBeNull();
      expect(b.constructionNote).toBeNull();
    }
  });

  it('an unrecognised conductor is unbounded, not silently permitted', () => {
    expect(seg({ conductorGauge: '#999 AWG' }).state).toBe('unbounded');
  });
});

describe('the limit comes from ONE place', () => {
  it('branch runs are graded at 2%, feeder and service runs at 3%', () => {
    expect(vdLimitPctForSegment('BRANCH_RUN')).toBe(ROUTE_VD_LIMIT_PCT.branch);
    expect(vdLimitPctForSegment('BRANCH_HOMERUN_RUN')).toBe(ROUTE_VD_LIMIT_PCT.branch);
    expect(vdLimitPctForSegment('COMBINER_TO_DISCO_RUN')).toBe(ROUTE_VD_LIMIT_PCT.feeder);
    expect(vdLimitPctForSegment('DISCO_TO_METER_RUN')).toBe(ROUTE_VD_LIMIT_PCT.feeder);
  });

  it('an unrecognised run falls to the TIGHTER limit, never the looser one', () => {
    expect(vdLimitPctForSegment('SOME_NEW_RUN')).toBe(ROUTE_VD_LIMIT_PCT.branch);
    expect(ROUTE_VD_LIMIT_PCT.branch).toBeLessThan(ROUTE_VD_LIMIT_PCT.feeder);
  });

  it('the E-1 schedule grades against the SAME limit the bound was computed from', () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    generatePermitHTML(input as never);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    // a bound derived from one limit beside a pass/fail computed from another
    // would be two circuits described as one
    const seg2 = (snap.electrical.routeSegments ?? []).find(r => r.segmentId === 'COMBINER_TO_DISCO_RUN')!;
    expect(seg2.designMaxOneWayFt).not.toBeNull();
    expect(calcVoltageDrop(
      seg2.continuousCurrentA ?? seg2.operatingCurrentA ?? 0,
      seg2.designMaxOneWayFt as number, seg2.conductorGauge as string, 240,
    )).toBeLessThanOrEqual(vdLimitPctForSegment('COMBINER_TO_DISCO_RUN') + 0.001);
  });
});

describe('registration completeness for the failure code', () => {
  it(`${ROUTE_LENGTH_EXCEEDS_BOUND_CODE} is registered everywhere`, () => {
    const d = REQUIREMENT_DECLARATIONS[ROUTE_LENGTH_EXCEEDS_BOUND_CODE];
    expect(d).toBeTruthy();
    expect(d.gateId).not.toBe(UNMAPPED_GATE_ID);
    expect(d.findingType).toBe('VERIFIED_DEFICIENCY');
    expect(SEVERITY_POLICY[ROUTE_LENGTH_EXCEEDS_BOUND_CODE]).toBeTruthy();
    expect(classifyBlockerDomain(ROUTE_LENGTH_EXCEEDS_BOUND_CODE)).toBe('electrical');
    expect(BLOCKER_PAYLOAD_SCHEMA[ROUTE_LENGTH_EXCEEDS_BOUND_CODE]).toBeTruthy();
  });
});

describe('the live Braidon package', () => {
  const build = () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('ROUTE-LENGTH-ESTIMATE clears — because every residual run is BOUNDED', () => {
    const { snap } = build();
    expect(snap.permitReadiness.registry.map(r => r.code)).not.toContain('ROUTE-LENGTH-ESTIMATE');
    // ANTI-VACUITY: it cleared because bounds exist, not because the gate stopped
    // asking. Each estimate-grade project-owned run carries a real maximum.
    const est = (snap.electrical.routeSegments ?? []).filter(r =>
      (r.routeAuthorityApplicability ?? 'REQUIRED') === 'REQUIRED'
      && r.lengthSource === 'cad-derived-estimate');
    expect(est.length).toBeGreaterThan(0);
    for (const r of est) {
      expect(r.lengthBoundState, r.segmentId).toBe('bounded');
      expect(r.designMaxOneWayFt, r.segmentId).toBeGreaterThan(0);
      expect(r.designMaxOneWayFt as number, r.segmentId).toBeGreaterThanOrEqual(r.oneWayFt as number);
    }
  });

  it('the DRAWING states the maximum — every bounded run, not just the ones with rows', () => {
    const { html, snap } = build();
    expect(html).toContain('CONSTRUCTION REQUIREMENT &mdash; MAXIMUM ONE-WAY CONDUCTOR LENGTHS');
    const bounded = (snap.electrical.routeSegments ?? []).filter(r => r.lengthBoundState === 'bounded');
    expect(bounded.length).toBeGreaterThan(0);
    for (const r of bounded) {
      expect(html, r.segmentId).toContain(`${r.segmentId} ≤ ${r.designMaxOneWayFt} FT`);
    }
    // the estimate is still labelled an estimate — the bound did not certify it
    expect(html).toMatch(/lengths shown above are ESTIMATES for procurement/);
  });

  it('the estimate is untouched — the bound is a limit, not a replacement', () => {
    const { snap } = build();
    const roof = (snap.electrical.routeSegments ?? []).find(r => r.segmentId === 'ROOF_RUN')!;
    expect(roof.oneWayFt).toBe(22);            // the estimate, unchanged
    expect(roof.lengthSource).toBe('cad-derived-estimate');
    expect(roof.designMaxOneWayFt).toBe(26);   // the design limit, additional
  });
});
