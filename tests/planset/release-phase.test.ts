// ═══════════════════════════════════════════════════════════════════════════
// THE FOUR RELEASE PHASES (2026-08-28)
//
// Every unissued package printed the same two hardcoded lines, in the same red:
// the count headline, then "PENDING ENGINEERING REVIEW — NOT FOR PERMIT
// SUBMISSION". A set missing ten facts and a set that is finished and waiting on
// a signature were indistinguishable.
//
// These tests drive all four phases — including the three the live fixture
// cannot reach — because a phase model that only ever produces one phase is
// decoration. Each asserts the lane split, the statement, and that the STYLE
// stops treating a correct workflow step as a defect.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  deriveReleasePhase, requirementLane, submissionLine, RELEASE_PHASE_STYLE,
} from '@/lib/permit/snapshot/releasePhase';
import type { ReleaseGateModel } from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A minimal model carrying just the requirements a phase decision reads. */
function modelWith(
  reqs: Array<{ code: string; status?: 'OPEN' | 'CLEARED'; severity?: 'blocking' | 'warning'; title?: string }>,
  advisoryCount = 0,
): ReleaseGateModel {
  return {
    requirements: reqs.map(r => ({
      requirementCode: r.code,
      status: r.status ?? 'OPEN',
      severity: r.severity ?? 'blocking',
      title: r.title ?? r.code,
    })),
    summary: { advisoryCount },
  } as unknown as ReleaseGateModel;
}

describe('the lane is read from the declaration, not a hand-kept list', () => {
  it('a PROFESSIONAL_RELEASE finding is a professional requirement', () => {
    expect(requirementLane('ENGINEERING-REVIEW-PENDING')).toBe('professional');
  });

  it('a requirement whose TERMINAL mode is PROFESSIONAL_APPROVAL is too', () => {
    // FRAMING-AUTHORITY-UNVERIFIED is PENDING_AUTHORITY / AUTO_RETRIEVED, but its
    // RESIDUAL is PROFESSIONAL_APPROVAL — a licensed acceptance is what actually
    // closes it, so the design is not "incomplete" for carrying it.
    expect(requirementLane('FRAMING-AUTHORITY-UNVERIFIED')).toBe('professional');
  });

  it('data / retrieval / operator requirements are DESIGN requirements', () => {
    for (const c of [
      'ROUTE-LENGTH-ESTIMATE',
      'PROJECT-AUTHORITY-UNVERIFIED',
      'MODULE-EXACT-DATASHEET-PENDING',
      'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
    ]) expect(requirementLane(c), c).toBe('design');
  });

  it('fails CLOSED — an undeclared code is a design requirement, not a signature', () => {
    expect(requirementLane('SOME-BRAND-NEW-CODE')).toBe('design');
  });
});

describe('the four phases', () => {
  const base = { reviewCoversCurrentDigest: false, gatePasses: false, hasDesign: true };

  it('DESIGN INCOMPLETE — a design requirement is outstanding', () => {
    const p = deriveReleasePhase({
      ...base,
      model: modelWith([
        { code: 'PROJECT-AUTHORITY-UNVERIFIED', title: 'Project legal authority not verified' },
        { code: 'ENGINEERING-REVIEW-PENDING', title: 'Engineering review pending' },
      ]),
    });
    expect(p.id).toBe('DESIGN_INCOMPLETE');
    expect(p.kind).toBe('defect');
    expect(p.submittable).toBe(false);
    expect(p.designRequirementCodes).toEqual(['PROJECT-AUTHORITY-UNVERIFIED']);
    expect(p.professionalRequirementCodes).toEqual(['ENGINEERING-REVIEW-PENDING']);
    expect(p.statement).toMatch(/^DESIGN INCOMPLETE — 1 design requirement outstanding/);
    // it warns that closing the data is not the end of it
    expect(p.statement).toMatch(/Licensed review follows/);
  });

  it('DESIGN COMPLETE — READY FOR PROFESSIONAL REVIEW is a WORKFLOW state, not a defect', () => {
    const p = deriveReleasePhase({
      ...base,
      model: modelWith([
        { code: 'FRAMING-AUTHORITY-UNVERIFIED', title: 'Existing framing capacity not verified' },
        { code: 'ENGINEERING-REVIEW-PENDING', title: 'Engineering review pending' },
      ]),
    });
    expect(p.id).toBe('AWAITING_PROFESSIONAL_REVIEW');
    // THE POINT OF THE WHOLE CHANGE: an unstamped set is the terminal state of a
    // correct workflow, not something wrong with the package.
    expect(p.kind).toBe('workflow');
    expect(p.kind).not.toBe('defect');
    expect(p.designRequirementCodes).toEqual([]);
    // 2026-08-29 - the statement leads with the achievement and then names the
    // reviewer's task; the LABEL carries 'READY FOR PROFESSIONAL REVIEW'.
    expect(p.label).toBe('DESIGN COMPLETE — READY FOR PROFESSIONAL REVIEW');
    expect(p.statement).toMatch(/DESIGN COMPLETE — no design requirement is outstanding/);
    expect(p.statement).toMatch(/Ready for engineer-of-record review and seal/);
    expect(p.statement).toMatch(/existing framing capacity/i);
    // …and it is still honestly not submittable
    expect(p.submittable).toBe(false);
    expect(submissionLine(p)).toMatch(/NOT FOR PERMIT SUBMISSION UNTIL REVIEWED/);
  });

  it('REVIEWED — AWAITING SIGNATURE / SEAL / ISSUE', () => {
    const p = deriveReleasePhase({
      ...base, reviewCoversCurrentDigest: true, model: modelWith([]),
    });
    expect(p.id).toBe('AWAITING_SEAL_AND_ISSUE');
    expect(p.kind).toBe('workflow');
    expect(p.statement).toMatch(/covers this exact design digest/);
    expect(submissionLine(p)).toMatch(/UNTIL SIGNED AND SEALED/);
  });

  it('ISSUED FOR PERMIT', () => {
    const p = deriveReleasePhase({
      ...base, reviewCoversCurrentDigest: true, gatePasses: true, model: modelWith([]),
    });
    expect(p.id).toBe('ISSUED_FOR_PERMIT');
    expect(p.kind).toBe('released');
    expect(p.submittable).toBe(true);
    expect(submissionLine(p)).toBe('RELEASED FOR PERMIT SUBMISSION');
  });

  it('an empty design is DESIGN INCOMPLETE, never "awaiting review"', () => {
    const p = deriveReleasePhase({ ...base, hasDesign: false, model: modelWith([]) });
    expect(p.id).toBe('DESIGN_INCOMPLETE');
    expect(p.statement).toMatch(/no modules/);
  });

  it('an ADVISORY never holds the package in a phase', () => {
    const p = deriveReleasePhase({
      ...base, reviewCoversCurrentDigest: true, gatePasses: true,
      model: modelWith([{ code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' }], 1),
    });
    expect(p.id).toBe('ISSUED_FOR_PERMIT');
    expect(p.advisoryCount).toBe(1);
    expect(p.designRequirementCodes).toEqual([]);
  });

  it('each phase kind has a DISTINCT palette — a workflow state is not red', () => {
    expect(RELEASE_PHASE_STYLE.defect.border).not.toBe(RELEASE_PHASE_STYLE.workflow.border);
    expect(RELEASE_PHASE_STYLE.workflow.border).not.toBe(RELEASE_PHASE_STYLE.released.border);
  });
});

describe('the drawing carries the statement, not the forensics', () => {
  const build = () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('the cover block leads with the PHASE and names it in the markup', () => {
    const { html } = build();
    expect(html).toMatch(/data-release-phase="DESIGN_INCOMPLETE"/);
    expect(html).toMatch(/data-release-phase-kind="defect"/);
    expect(html).toMatch(/data-release-phase-statement="1"/);
  });

  it('the statement is ONE actionable sentence, not a paragraph', () => {
    const { html } = build();
    const m = html.match(/data-release-phase-statement="1"[^>]*>\s*([^<]+)</);
    expect(m, 'the statement must be rendered').toBeTruthy();
    const text = m![1].replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeLessThan(320);
    expect(text).toMatch(/^DESIGN INCOMPLETE/);
    // it NAMES what is outstanding …
    expect(text).toMatch(/design requirements outstanding/);
    // … and never reproduces a requirement's evidence, emitter or remediation
    expect(text).not.toMatch(/authorityPath|resolver|snapshot digest|sha256|https?:\/\//i);
  });

  it('the forensic detail still exists — in the review record, not on the cover', () => {
    const { html, snap } = build();
    // every open requirement keeps its full explanation in the registry
    for (const r of snap.permitReadiness.registry.filter(x => !x.resolved)) {
      expect(r.explanation.length, r.code).toBeGreaterThan(40);
      expect(r.authorityPath, r.code).toBeTruthy();
    }
    // and the cover points at the record rather than restating it
    expect(html).toMatch(/data-release-record-pointer="1"|SEE RS-1 FOR ALL/);
  });

  it('the retired hardcoded pairing is gone', () => {
    const { html } = build();
    // the block no longer asserts PENDING ENGINEERING REVIEW regardless of state
    const i = html.indexOf('data-release-status-block');
    const block = html.slice(i, i + 3000);
    expect(block).not.toMatch(/PENDING ENGINEERING REVIEW &mdash; NOT FOR PERMIT SUBMISSION/);
  });
});
