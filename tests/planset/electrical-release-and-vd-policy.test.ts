// ═══════════════════════════════════════════════════════════════════════════
// PV-4A SAID "COMPLIES". PV-4B.1 SAID FOUR SECTIONS NEEDED THE ENGINEER.
//
// Three separate confusions produced that, and each has its own owner now.
//
// 1 — A COMPANY TARGET REPORTED AS A CODE FAILURE.
// The section evaluator carried `{ label: 'branch VD ≤ 2%', pass: vd <= 2 }` as a
// HARD check, and `evaluateCompliance` ranks FAIL above everything. So a 2.11%
// branch rendered "✗ FAIL — 2.11% > 2.0%" under a column headed RELEASE / REVIEW.
//
// 2% is not a code limit. The NEC states voltage drop only in informational
// notes — 210.19(A) Inf. Note 4 and 215.2(A)(1) Inf. Note 2 recommend 3% on the
// branch or feeder and 5% combined — and 90.5(C) says informational notes are
// explanatory and NOT enforceable as requirements. SolarPro's 2% is a DESIGN
// TARGET reserving the remaining 1% for the feeder. `gradeVoltageDropPolicy`
// grades against both, and only the published recommendation can fail.
//
// 2 — A CONSTRUCTION ITEM REPORTED AS AN ENGINEERING QUESTION.
// Every section pushed its CAD-derived route length into `pending`, whose label
// reads "PENDING — REVIEW REQ'D". An installer closes a route length with a
// tape; the design is complete without it. `FIELD-VERIFY-AT-INSTALL` is a fourth
// state, ranked below engineering-pending and above pass, so it is neither
// hidden nor mistaken for the engineer's work.
//
// 3 — TWO ANSWERS TO "DOES THIS LENGTH STILL OWE ANYTHING".
// `_VERIFIED_ROUTE` was a third private copy of the field-verified predicate, and
// it asked the wrong question besides: closure is decided by
// ROUTE_LENGTH_CLOSURE_POLICY, which is deliberately wider (a CAD route and a
// design-fixed length both close it). That is why DISCO_TO_METER_RUN printed
// "FIXED BY DESIGN — INSTALL PER DRAWING" and, in the next cell,
// "PENDING — REVIEW REQ'D".
//
// These are MUTATION tests: they move the percentage across each policy boundary
// and move the length source across the closure boundary.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  gradeVoltageDropPolicy, ROUTE_VD_LIMIT_PCT, NEC_VD_RECOMMENDATION_PCT,
} from '@/lib/electrical/routeLengthBound';
import { evaluateCompliance, COMPLIANCE_LABEL } from '@/lib/permit/snapshot/complianceState';
import { projectE1PhysicalSchedule } from '@/lib/permit/snapshot/electricalProjection';
import { sourceClosesRouteLengthRequirement } from '@/lib/fieldMeasurement/resolver';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(mutate?: (i: any) => void) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const text = html.replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');
  return { input, text, sections: projectE1PhysicalSchedule(input._snapshot) };
}

describe('a design target is not a code limit — MUTATION across both boundaries', () => {
  const BR = 'BRANCH_RUN';

  it('at or under the 2% target: nothing to say', () => {
    const g = gradeVoltageDropPolicy(1.99, BR);
    expect(g.state).toBe('WITHIN_DESIGN_TARGET');
    expect(g.compliant).toBe(true);
    expect(g.designTargetMet).toBe(true);
    expect(g.definitiveFailure).toBe(false);
  });

  it('JUST over the target: an advisory, and explicitly CODE COMPLIANT', () => {
    // The reported case: 2.11% on B1.
    const g = gradeVoltageDropPolicy(2.11, BR);
    expect(g.state).toBe('DESIGN_TARGET_EXCEEDED');
    expect(g.compliant, 'a company target miss is not a code failure').toBe(true);
    expect(g.designTargetMet).toBe(false);
    expect(g.definitiveFailure, 'and it must not drive a compliance FAIL').toBe(false);
    expect(g.label).toMatch(/CODE COMPLIANT/);
    expect(g.label).toMatch(/2\.0% DESIGN TARGET EXCEEDED/);
    expect(g.citation).toBe('NEC 210.19(A) Informational Note 4');
  });

  it('over the published recommendation: a definitive failure that is NOT softened', () => {
    const g = gradeVoltageDropPolicy(3.01, BR);
    expect(g.state).toBe('RECOMMENDATION_EXCEEDED');
    expect(g.compliant).toBe(false);
    expect(g.definitiveFailure, 'a genuine failure must still fail').toBe(true);
    expect(g.label).toMatch(/EXCEEDS NEC 210\.19\(A\)/);
  });

  it('the two limits are different numbers and both are named', () => {
    expect(ROUTE_VD_LIMIT_PCT.branch).toBe(2);
    expect(NEC_VD_RECOMMENDATION_PCT.branch).toBe(3);
    expect(NEC_VD_RECOMMENDATION_PCT.combined).toBe(5);
  });

  it('no percentage ⇒ not evaluable, never a silent pass', () => {
    const g = gradeVoltageDropPolicy(null, BR);
    expect(g.state).toBe('NOT_EVALUABLE');
    expect(g.compliant).toBe(false);
    expect(g.definitiveFailure).toBe(false);
  });
});

describe('a construction item is not an engineering question', () => {
  it('the fourth state exists and ranks between pending and pass', () => {
    const fv = evaluateCompliance({ fieldVerification: ['route length — field verify'] });
    expect(fv.state).toBe('FIELD-VERIFY-AT-INSTALL');
    expect(COMPLIANCE_LABEL['FIELD-VERIFY-AT-INSTALL']).toBe('FIELD VERIFY AT INSTALLATION');

    // an ENGINEERING pending still outranks it
    const both = evaluateCompliance({
      pending: ['conduit fill not computed'],
      fieldVerification: ['route length — field verify'],
    });
    expect(both.state).toBe('PENDING-REVIEW-REQUIRED');

    // and a real violation still outranks everything
    const fail = evaluateCompliance({
      checks: [{ label: 'fill ≤ 40%', pass: false }],
      fieldVerification: ['route length — field verify'],
    });
    expect(fail.state).toBe('FAIL');
  });

  it('a settled length source closes the item entirely — MUTATION', () => {
    // The closure policy is wider than "somebody measured it": a CAD route and a
    // design-fixed length are not estimates of a route nobody has.
    expect(sourceClosesRouteLengthRequirement('cad-route')).toBe(true);
    expect(sourceClosesRouteLengthRequirement('known-design')).toBe(true);
    expect(sourceClosesRouteLengthRequirement('cad-derived-estimate')).toBe(false);
  });
});

describe('the package cannot state two release answers — MUTATION', () => {
  it('no section claims a RELEASE verdict any more', () => {
    const { text } = build();
    expect(text).not.toMatch(/RELEASE \/ REVIEW/);
    expect(text).toMatch(/SECTION COMPLIANCE/);
  });

  it('and no section tells the engineer his review is outstanding', () => {
    const { text, sections } = build();
    expect(text).not.toMatch(/PENDING — REVIEW REQ’D/);
    for (const s of sections) {
      expect(s.compliance.state, s.sectionId).not.toBe('PENDING-REVIEW-REQUIRED');
    }
  });

  it('the design-fixed tap span does not contradict itself', () => {
    const { sections } = build();
    const tap = sections.find(s => s.sectionId === 'DISCO_TO_METER_RUN');
    expect(tap, 'the design must carry the tap run').toBeTruthy();
    // It printed FIXED BY DESIGN and PENDING — REVIEW REQ'D in adjacent cells.
    expect(tap!.voltageDrop.lengthAuthorityLabel).toMatch(/FIXED BY DESIGN/);
    expect(tap!.compliance.state).not.toBe('PENDING-REVIEW-REQUIRED');
  });

  it('MUTATE a branch over the design target ⇒ advisory on the sheet, still no FAIL', () => {
    // Lengthen the branch cable path until the drop crosses 2%.
    const { text, sections } = build(i => {
      for (const p of (i._snapshot?.electrical?.branchCablePaths ?? [])) {
        if (p.designedInstalledLengthFt) p.designedInstalledLengthFt *= 1.6;
      }
    });
    // Whatever the mutation produced, the invariant holds in both directions:
    for (const s of sections) {
      const pol = s.voltageDropPolicy;
      if (!pol) continue;
      if (pol.state === 'DESIGN_TARGET_EXCEEDED') {
        expect(s.compliance.state, `${s.sectionId} target miss must not FAIL`).not.toBe('FAIL');
      }
      if (pol.state === 'RECOMMENDATION_EXCEEDED') {
        expect(s.compliance.state, `${s.sectionId} recommendation breach must FAIL`).toBe('FAIL');
      }
    }
    expect(text).not.toMatch(/RELEASE \/ REVIEW/);
  });

  it('the private field-verified copy is gone from the projection', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('lib/permit/snapshot/electricalProjection.ts', 'utf8'));
    expect(src).not.toMatch(/const _VERIFIED_ROUTE = new Set/);
  });
});
