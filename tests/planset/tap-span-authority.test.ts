// ═══════════════════════════════════════════════════════════════════════════
// THE SUPPLY-SIDE TAP SPAN — BEHAVIOURAL LIFECYCLE (2026-08-28)
//
// `DISCO_TO_METER_RUN` and `svc-tap-conductors` are ONE physical span: fused AC
// disconnect ↔ supply-side tap point. These tests exercise the state machine end
// to end rather than merely asserting that codes are registered — a registered
// code that can never fire is the vacuous pass, and a registered code that can
// never CLEAR is the same defect pointed the other way.
//
//   PASS BY DESIGN  design fixes the span at ≤10 ft  → no requirement
//   PASS VERIFIED   a field measurement ≤10 ft        → no requirement
//   FAIL            positional authority >10 ft       → …-EXCEEDED (blocking)
//   PENDING         nothing constrains the span       → …-PENDING  (blocking)
//
// The unit-level tests drive `buildTapSpanAuthority` directly (every branch,
// including the ones the live fixture cannot reach); the snapshot-level tests
// prove the same transitions survive the full build → registry → sheet path.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  buildTapSpanAuthority,
  isSupplySideMethod,
  NEC_705_11_C_TAP_LIMIT_FT,
  TAP_SPAN_PHYSICAL_SEGMENT_ID,
  TAP_SPAN_EXCEEDED_CODE,
  TAP_SPAN_PENDING_CODE,
} from '@/lib/electrical/tapSpan';
import { REQUIREMENT_DECLARATIONS, UNMAPPED_GATE_ID } from '@/lib/permit/snapshot/releaseGates';
import { SEVERITY_POLICY } from '@/lib/permit/snapshot/severityPolicy';
import { classifyBlockerDomain } from '@/lib/permit/snapshot/projectAuthority';
import { BLOCKER_PAYLOAD_SCHEMA } from '@/lib/permit/sections/reviewStatus';
import { sourceClosesRouteLengthRequirement } from '@/lib/fieldMeasurement/resolver';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const seg = (oneWayFt: number | null, lengthSource: string | null) => ({
  segmentId: TAP_SPAN_PHYSICAL_SEGMENT_ID,
  oneWayFt,
  lengthSource,
  sourceNode: 'AC DISCONNECT',
  destinationNode: 'SUPPLY-SIDE TAP POINT',
});

describe('tapSpanAuthority — the state machine', () => {
  it('does not exist on a load-side design (there is no tap span to grade)', () => {
    expect(isSupplySideMethod('LOAD_SIDE')).toBe(false);
    expect(buildTapSpanAuthority({ interconnectionMethod: 'LOAD_SIDE', physicalSegment: seg(10, 'known-design') }))
      .toBeNull();
  });

  it('PASS BY DESIGN — the design fixes the span at the 705.11(C) maximum', () => {
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(NEC_705_11_C_TAP_LIMIT_FT, 'known-design'),
    })!;
    expect(t.state).toBe('pass-by-design');
    expect(t.positionalAuthority).toBe('design-constraint');
    expect(t.designConstraintEnforced).toBe(true);
    expect(t.spanLengthFt).toBe(NEC_705_11_C_TAP_LIMIT_FT);
    expect(t.resolutionAction).toBeNull();
    // it names the ONE physical object rather than carrying a second one
    expect(t.physicalRouteSegmentId).toBe(TAP_SPAN_PHYSICAL_SEGMENT_ID);
  });

  it('PASS VERIFIED — a field measurement inside the limit', () => {
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(7, 'field-measurement'),
    })!;
    expect(t.state).toBe('pass-verified');
    expect(t.positionalAuthority).toBe('field-measurement');
    expect(t.statement).toMatch(/field-measured/);
  });

  it('FAIL — a field measurement OVER the limit is a layout defect, not an unknown', () => {
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(18, 'field-measurement'),
    })!;
    expect(t.state).toBe('fail');
    expect(t.statement).toMatch(/EXCEEDS/);
    expect(t.statement).toMatch(/LAYOUT defect/);
    expect(t.resolutionAction).toMatch(/[Rr]elocate/);
  });

  it('FAIL — a ROUTED CAD geometry over the limit fails too (positional authority, not an estimate)', () => {
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(14, 'cad-route'),
    })!;
    expect(t.state).toBe('fail');
    expect(t.positionalAuthority).toBe('cad-route');
  });

  it('PENDING — nothing constrains the span; a bare estimate neither certifies nor condemns', () => {
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(15, 'cad-derived-estimate'),
    })!;
    expect(t.state).toBe('pending');
    expect(t.positionalAuthority).toBe('none');
    // the estimate is reported, and it is reported as an ADVISORY, never a grade
    expect(t.spanLengthFt).toBeNull();
    expect(t.advisoryEstimateFt).toBe(15);
    expect(t.estimateExceedsLimit).toBe(true);
    expect(t.statement).toMatch(/ADVISORY/);
    expect(t.statement).toMatch(/asserts no violation/);
    // an estimate INSIDE the limit is equally not a pass
    const inside = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(6, 'cad-derived-estimate'),
    })!;
    expect(inside.state).toBe('pending');
    expect(inside.estimateExceedsLimit).toBe(false);
  });

  it('PENDING — a missing physical segment is not silently a pass', () => {
    const t = buildTapSpanAuthority({ interconnectionMethod: 'SUPPLY_SIDE_TAP', physicalSegment: null })!;
    expect(t.state).toBe('pending');
    expect(t.spanLengthFt).toBeNull();
  });

  it('a design source ABOVE the limit is not accepted as a design constraint', () => {
    // fail-closed: `known-design` is only a constraint if it is inside the limit.
    const t = buildTapSpanAuthority({
      interconnectionMethod: 'SUPPLY_SIDE_TAP',
      physicalSegment: seg(25, 'known-design'),
    })!;
    expect(t.state).toBe('pending');
    expect(t.designConstraintEnforced).toBe(false);
  });
});

describe('tapSpanAuthority — registration completeness (RG-UNMAPPED = 0)', () => {
  for (const code of [TAP_SPAN_PENDING_CODE, TAP_SPAN_EXCEEDED_CODE]) {
    it(`${code} is registered across every required registry`, () => {
      // 1. release-gate declaration (gate id + finding type + mode basis)
      const gate = REQUIREMENT_DECLARATIONS[code];
      expect(gate, 'release gate declaration').toBeTruthy();
      expect(gate.gateId).not.toBe(UNMAPPED_GATE_ID);
      expect(gate.modeBasis.length).toBeGreaterThan(20);
      expect(gate.findingType).toBeTruthy();
      // 2. severity policy impact axes
      expect(SEVERITY_POLICY[code], 'severity policy').toBeTruthy();
      // 3. domain map — through the PUBLIC accessor, so a code that is in the
      //    literal but unreachable through the resolver still fails here.
      expect(classifyBlockerDomain(code)).toBe('electrical');
      // 4. review-status payload schema (how the sheet renders it)
      expect(BLOCKER_PAYLOAD_SCHEMA[code], 'review-status payload schema').toBeTruthy();
    });
  }
});

describe('tapSpanAuthority — the live snapshot path', () => {
  const build = (mutate?: (input: Record<string, unknown>) => void) => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    mutate?.(input);
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('CLEARS on the live design — the span is design-constrained and no tap code is raised', () => {
    const { snap } = build();
    const codes = snap.permitReadiness.registry.map(r => r.code);
    expect(codes).not.toContain(TAP_SPAN_PENDING_CODE);
    expect(codes).not.toContain(TAP_SPAN_EXCEEDED_CODE);
    const s = (snap.electrical.routeSegments ?? []).find(x => x.segmentId === TAP_SPAN_PHYSICAL_SEGMENT_ID)!;
    expect(s.lengthSource).toBe('known-design');
    expect(s.oneWayFt!).toBeLessThanOrEqual(NEC_705_11_C_TAP_LIMIT_FT);
  });

  it('the design constraint is PRINTED on the drawing, not merely asserted in the model', () => {
    const { html } = build();
    // pass-by-design is only honest if the construction set states the placement
    // requirement an inspector checks the installation against.
    expect(html).toContain('CONSTRUCTION REQUIREMENT');
    expect(html).toMatch(/LOCATE THE FUSED AC DISCONNECT WITHIN 10 FT OF THE TAP POINT/i);
  });

  it('the design-fixed length does NOT close a FIELD-verification requirement', () => {
    // KNOWN-DESIGN closes ROUTE-LENGTH-ESTIMATE (the run length is not an
    // estimate) and nothing else. It is not field evidence.
    expect(sourceClosesRouteLengthRequirement('known-design')).toBe(true);
    const { snap } = build();
    const s = (snap.electrical.routeSegments ?? []).find(x => x.segmentId === TAP_SPAN_PHYSICAL_SEGMENT_ID)!;
    expect(s.verifiedFieldLengthFt ?? null).toBeNull();
    expect(s.verificationState).toBe('design-constraint');
  });

  it('ONE physical span: the BOM bills the conduit for it exactly once', () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    generatePermitHTML(input as never);
    const bom = ((input as { bom?: Array<Record<string, unknown>> }).bom ?? []);
    const conduitRows = bom.filter(r =>
      String(r.category) === 'conduit' && /DISCOTOMETER/i.test(String(r.partNumber)));
    expect(conduitRows).toHaveLength(1);
    // and no second conduit row exists for a "tap conductor" run
    expect(bom.some(r => /TAPCONDUCTOR/i.test(String(r.partNumber)))).toBe(false);
    // the tap connectors themselves are still ordered (L1+L2+N)
    expect(bom.some(r => /^IPLD/i.test(String(r.partNumber)) && r.quantity === 3)).toBe(true);
  });
});
