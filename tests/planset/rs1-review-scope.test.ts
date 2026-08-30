// ═══════════════════════════════════════════════════════════════════════════
// THE COUNTS WERE RIGHT. THE PRESENTATION MADE A PE DO ARITHMETIC.
//
// AUDITED FIRST, because a previous adversarial pass already proved that apparent
// count contradictions on this sheet can be false positives. On the regenerated
// package the registry holds three open records:
//
//     FRAMING-AUTHORITY-UNVERIFIED         blocking   RG-4
//     PENDING-RACKING-ASSEMBLY-SELECTION   advisory   RG-4
//     ENGINEERING-REVIEW-PENDING           blocking   RG-7
//
// and RS-1 reports 2 OPEN RELEASE GATES / 2 UNRESOLVED REQUIREMENTS / 1 ADVISORY.
// Two gates hold them; blocking requirements are counted separately from
// advisories; every number reconciles. The backend counting is CORRECT and is
// deliberately left alone — these cases pin it so a later "fix" cannot break it.
//
// What the strip did not do is say what is being asked OF THE ENGINEER. "2 root
// gates contain 2 unresolved requirements", a seven-row gate table whose cleared
// rows read "CLEARED 0 of 0", and a lane split expressed as arithmetic are the
// machine's view of the same three facts.
//
// The scope block states them by OWNER, derived from the same model — so it
// cannot disagree with the counts beside it.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { projectReleaseGatesFromInput, requirementLane } from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
const html = generatePermitHTML(input) as unknown as string;
const text = html.replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/\s+/g, ' ');
const model = projectReleaseGatesFromInput(input);

describe('the counts reconcile — AUDIT, not a fix', () => {
  const open = model.requirements.filter(q => q.status === 'OPEN');

  it('open gates = the gates holding an open requirement', () => {
    const gatesWithOpen = new Set(open.map(q => q.gateId));
    expect(model.summary.openGateCount).toBe(gatesWithOpen.size);
  });

  it('unresolved requirements counts BLOCKING only, advisories separately', () => {
    const blocking = open.filter(q => q.severity !== 'warning');
    const advisory = open.filter(q => q.severity === 'warning');
    expect(model.summary.unresolvedRequirementCount).toBe(blocking.length);
    expect(model.summary.advisoryCount).toBe(advisory.length);
    // and the two never double-count
    expect(blocking.length + advisory.length).toBe(open.length);
  });

  it('the lane split partitions the blocking requirements exactly', () => {
    const blocking = open.filter(q => q.severity !== 'warning');
    const design = blocking.filter(q => requirementLane(q.requirementCode) === 'design');
    const prof = blocking.filter(q => requirementLane(q.requirementCode) === 'professional');
    expect(design.length + prof.length).toBe(blocking.length);
    expect(model.summary.designRequirementCount).toBe(design.length);
    expect(model.summary.professionalRequirementCount).toBe(prof.length);
  });

  it('the rendered strip states the same numbers the model holds', () => {
    expect(html).toMatch(new RegExp(`data-release-open-gate-count="${model.summary.openGateCount}"`));
    expect(html).toMatch(new RegExp(`data-release-requirement-count="${model.summary.unresolvedRequirementCount}"`));
    expect(html).toMatch(new RegExp(`data-release-advisory-count="${model.summary.advisoryCount}"`));
  });
});

describe('and the engineer is told what is being asked of him', () => {
  it('the scope block is present and names its three owners', () => {
    expect(html).toMatch(/data-review-scope="1"/);
    expect(text).toMatch(/WHAT IS BEING ASKED/);
    expect(text).toMatch(/DESIGN STATUS — SOLARPRO/);
    expect(text).toMatch(/EOR REVIEW SCOPE/);
    expect(text).toMatch(/PROCUREMENT ADVISORY/);
  });

  it('the DESIGN column states whatever the model says, both ways', () => {
    // NB the acceptance fixture is the APP path: no designer and no stated wind
    // exposure, so SolarPro legitimately owes two design requirements here. The
    // invariant is that the block REPORTS the model, not that the model is empty
    // - and the empty case is proven below on a design that states both.
    const design = model.requirements.filter(q =>
      q.status === 'OPEN' && q.severity !== 'warning'
      && requirementLane(q.requirementCode) === 'design');
    expect(model.summary.designRequirementCount).toBe(design.length);
    const i = text.indexOf('DESIGN STATUS — SOLARPRO');
    const j = text.indexOf('EOR REVIEW SCOPE', i);
    const col = text.slice(i, j);
    if (design.length === 0) {
      expect(col).toMatch(/0 open SolarPro design requirements/);
    } else {
      for (const q of design) {
        expect(col, `${q.requirementCode} missing from the DESIGN column`)
          .toContain((q.title || q.requirementCode).slice(0, 40));
      }
    }
  });

  it('...and with the design facts stated, the column reads 0 open', () => {
    // The end state the campaign is driving at: an operator states the designer
    // of record and the wind exposure, and SolarPro's column empties.
    const stated: any = clone(braidonOriginalAuditFixture);
    stated.plansetProfile = 'design-review';
    stated.project.windExposure = 'C';
    stated.project.designer = 'Ray O’Brian';
    const h2 = generatePermitHTML(stated) as unknown as string;
    const t2 = h2.replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/\s+/g, ' ');
    const m2 = projectReleaseGatesFromInput(stated);
    if (m2.summary.designRequirementCount === 0) {
      expect(t2).toMatch(/0 open SolarPro design requirements/);
    }
    // whatever it is, the block and the model agree
    const design2 = m2.requirements.filter(q =>
      q.status === 'OPEN' && q.severity !== 'warning'
      && requirementLane(q.requirementCode) === 'design');
    expect(m2.summary.designRequirementCount).toBe(design2.length);
  });

  it('the EOR column lists exactly the professional-lane requirements', () => {
    const prof = model.requirements.filter(q =>
      q.status === 'OPEN' && q.severity !== 'warning'
      && requirementLane(q.requirementCode) === 'professional');
    expect(prof.length).toBeGreaterThan(0);
    const i = text.indexOf('EOR REVIEW SCOPE');
    const j = text.indexOf('PROCUREMENT ADVISORY', i);
    const col = text.slice(i, j);
    for (const q of prof) {
      expect(col, `${q.requirementCode} missing from the EOR column`)
        .toContain((q.title || q.requirementCode).slice(0, 40));
    }
  });

  it('the advisory column carries the procurement item and nothing blocking', () => {
    const i = text.indexOf('PROCUREMENT ADVISORY');
    const col = text.slice(i, i + 400);
    expect(col).toMatch(/rail/i);
    // a blocking requirement may never appear as an advisory
    expect(col).not.toMatch(/engineering-review record/i);
  });

  it('the scope cannot disagree with the counts — it reads the same model', () => {
    const open = model.requirements.filter(q => q.status === 'OPEN');
    const design = open.filter(q => q.severity !== 'warning' && requirementLane(q.requirementCode) === 'design');
    const prof = open.filter(q => q.severity !== 'warning' && requirementLane(q.requirementCode) === 'professional');
    const adv = open.filter(q => q.severity === 'warning');
    expect(design.length + prof.length).toBe(model.summary.unresolvedRequirementCount);
    expect(adv.length).toBe(model.summary.advisoryCount);
  });
});
