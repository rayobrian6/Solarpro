// ═══════════════════════════════════════════════════════════════════════════
// D5 (Planset 19) — PV-4B AND PV-4B.1 CONSUME THE SAME VOLTAGE-DROP CONCLUSION.
//
// Planset 19 printed, for ONE circuit — the combiner→disconnect feeder, 20 ft,
// 0.37 %, criterion ≤ 3 % — two different verdicts on two sheets:
//
//     PV-4B    20 ft   0.37 %   PROVISIONAL PASS
//     PV-4B.1  20 ft   0.37 %   PENDING — REVIEW REQ’D
//
// Same numbers, same physics, contradictory conclusions. The cause was not a
// second calculation: PV-4B graded through `gradeVoltageDrop`, while PV-4B.1's
// verdict column rendered the RELEASE tri-state (`evaluateCompliance`) — whose
// `pending` list contains "route length is a CAD-derived estimate". An OPEN
// REVIEW ITEM was standing in for a CALCULATION CONCLUSION.
//
// The repair projects two independent facts per row and lets neither substitute
// for the other:
//
//     CALCULATION      the graded conclusion, at the grade of its input length
//     LENGTH AUTHORITY where the length came from + whether field verification
//                      is still open
//
// A failure stays a failure at every grade — an estimate never softens an
// over-limit result — and closing a review item never upgrades one.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  gradeVoltageDrop, voltageDropDisplayFields, projectE1PhysicalSchedule,
} from '@/lib/permit/snapshot/electricalProjection';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-08-02T12:00:00Z';
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

const { html, snap } = build();

/** the sheet's own `.page` div, selected by its title-block sheet id. */
function sheet(id: string): string {
  const pages = html.split(/<div class="page"[ >]/).slice(1);
  const hit = pages.find(p => (p.match(/class="tb-sheet-id">([^<]+)</) ?? [])[1] === id);
  if (!hit) throw new Error(`sheet ${id} not found in the rendered package`);
  return hit;
}

/** every tagged voltage-drop cell on a sheet, as machine-readable facts. */
function vdCells(id: string): Array<{ conclusion: string; lengthAuthority: string; fieldPending: string }> {
  const re = /data-vd-conclusion="([^"]*)"\s+data-vd-length-authority="([^"]*)"\s+data-vd-field-verification-pending="([^"]*)"/g;
  const out: Array<{ conclusion: string; lengthAuthority: string; fieldPending: string }> = [];
  let m: RegExpExecArray | null;
  const s = sheet(id);
  while ((m = re.exec(s))) out.push({ conclusion: m[1], lengthAuthority: m[2], fieldPending: m[3] });
  return out;
}

// ── 1. THE CANONICAL RESOLVER — one enum, and a FAIL that stays a FAIL ──────
describe('D5 §1 — the canonical voltage-drop conclusion', () => {
  it('1. a verified length within the criterion is VERIFIED_PASS', () => {
    const g = gradeVoltageDrop({
      pct: 0.37, limitPct: 3, lengthFt: 20,
      lengthSource: 'field-verified', verificationState: 'field-verified',
    });
    expect(g.conclusion).toBe('VERIFIED_PASS');
    expect(g.lengthAuthorityLabel).toBe('FIELD VERIFIED');
    expect(g.fieldVerificationPending).toBe(false);
  });

  it('2. a CAD ROUTE within the criterion is PROVISIONAL_PASS, not verified', () => {
    const g = gradeVoltageDrop({
      pct: 0.37, limitPct: 3, lengthFt: 20,
      lengthSource: 'cad-route', verificationState: 'geometry-derived',
    });
    expect(g.conclusion).toBe('PROVISIONAL_PASS');
    expect(g.lengthAuthorityLabel).toBe('CAD ROUTE — GEOMETRY DERIVED');
    expect(g.fieldVerificationPending).toBe(true);
  });

  it('3. a CAD ESTIMATE within the criterion is PROVISIONAL_PASS', () => {
    const g = gradeVoltageDrop({
      pct: 0.37, limitPct: 3, lengthFt: 20,
      lengthSource: 'cad-derived-estimate', verificationState: 'cad-derived-estimate',
    });
    expect(g.conclusion).toBe('PROVISIONAL_PASS');
    expect(g.lengthAuthorityLabel).toBe('CAD-DERIVED ESTIMATE');
  });

  it('4. an UNVERIFIED field report within the criterion is PROVISIONAL_PASS — entry is not authority', () => {
    const g = gradeVoltageDrop({
      pct: 0.37, limitPct: 3, lengthFt: 20,
      lengthSource: 'field-reported', verificationState: 'field-reported',
    });
    expect(g.conclusion).toBe('PROVISIONAL_PASS');
    expect(g.lengthAuthorityLabel).toBe('FIELD-REPORTED (UNVERIFIED)');
    expect(g.fieldVerificationPending).toBe(true);
  });

  it('5. an over-limit result is FAIL at EVERY grade — an estimate never softens it', () => {
    for (const [src, st] of [
      ['cad-derived-estimate', 'cad-derived-estimate'],
      ['cad-route', 'geometry-derived'],
      ['field-reported', 'field-reported'],
      ['field-verified', 'field-verified'],
    ] as const) {
      const g = gradeVoltageDrop({ pct: 4.2, limitPct: 3, lengthFt: 120, lengthSource: src, verificationState: st });
      expect(g.conclusion, `${src}/${st}`).toBe('FAIL');
    }
  });

  it('6. a FAIL is never relabelled provisional or pending, and closing the field requirement does not upgrade it', () => {
    const g = gradeVoltageDrop({
      pct: 4.2, limitPct: 3, lengthFt: 120,
      lengthSource: 'field-verified', verificationState: 'field-verified',
    });
    expect(g.conclusion).toBe('FAIL');
    expect(g.fieldVerificationPending).toBe(false);
    expect(g.label).not.toMatch(/PROVISIONAL|PENDING/i);
  });

  it('7. a missing percentage or a missing length is INDETERMINATE', () => {
    expect(gradeVoltageDrop({ pct: null, lengthFt: 20 }).conclusion).toBe('INDETERMINATE');
    expect(gradeVoltageDrop({ pct: 0.37, lengthFt: null }).conclusion).toBe('INDETERMINATE');
    expect(gradeVoltageDrop({ pct: null, lengthFt: null }).lengthAuthorityLabel).toBe('NOT ESTABLISHED');
  });

  it('8. the length SOURCE vocabulary the snapshot actually stamps is honoured — a walked run is never called CAD', () => {
    // build.ts stamps `field-measurement` / `operator-entry`; the resolver's own
    // union spells them `field-verified` / `field-reported`. Both must resolve.
    const verified = gradeVoltageDrop({
      pct: 1.1, limitPct: 3, lengthFt: 87,
      lengthSource: 'field-measurement', verificationState: 'field-verified',
    });
    expect(verified.basis).toContain('FIELD-VERIFIED');
    expect(verified.basis).not.toMatch(/CAD-derived estimate/);
    const reported = gradeVoltageDrop({
      pct: 1.1, limitPct: 3, lengthFt: 87,
      lengthSource: 'operator-entry', verificationState: 'field-reported',
    });
    expect(reported.basis).toMatch(/UNVERIFIED/);
    expect(reported.basis).not.toMatch(/CAD-derived estimate/);
  });

  it('9. the two display fields are separate strings — the calculation never states the release state', () => {
    const g = gradeVoltageDrop({
      pct: 0.37, limitPct: 3, lengthFt: 20,
      lengthSource: 'cad-derived-estimate', verificationState: 'cad-derived-estimate',
    });
    const f = voltageDropDisplayFields(g);
    expect(f.calculation).toBe('PROVISIONAL PASS — 0.37% ≤ 3.0%');
    expect(f.lengthAuthority).toBe('CAD-DERIVED ESTIMATE — FIELD VERIFICATION PENDING');
    expect(f.calculation).not.toMatch(/PENDING/);
  });
});

// ── 2. THE SECTION PROJECTION CARRIES THE CANONICAL GRADE ───────────────────
describe('D5 §2 — every physical section is graded through the ONE resolver', () => {
  const sections = projectE1PhysicalSchedule(snap);

  it('10. the Braidon package has physical sections to grade', () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it('11. every section carries a voltage-drop grade and a calculation length', () => {
    const missing = sections.filter(s => !s.voltageDrop?.conclusion).map(s => s.sectionId);
    expect(missing).toEqual([]);
    expect(sections.every(s => 'vdCalculationLengthFt' in s)).toBe(true);
  });

  it('12. each section grade equals what the canonical resolver returns for that section — no re-derivation', () => {
    for (const s of sections) {
      const expected = gradeVoltageDrop({
        pct: s.voltageDropPct, limitPct: s.vdLimitPct, lengthFt: s.vdCalculationLengthFt,
        lengthSource: s.voltageDrop.lengthSource, verificationState: s.voltageDrop.verificationState,
      });
      expect(s.voltageDrop.conclusion, s.sectionId).toBe(expected.conclusion);
      expect(s.voltageDrop.label, s.sectionId).toBe(expected.label);
    }
  });

  it('13. a section within its own limit is never FAIL, and one over its limit is never a pass', () => {
    for (const s of sections) {
      if (s.voltageDropPct == null) { expect(s.voltageDrop.conclusion, s.sectionId).toBe('INDETERMINATE'); continue; }
      if (s.voltageDropPct > s.vdLimitPct) expect(s.voltageDrop.conclusion, s.sectionId).toBe('FAIL');
      else expect(s.voltageDrop.conclusion, s.sectionId).toMatch(/^(VERIFIED_PASS|PROVISIONAL_PASS)$/);
    }
  });

  it('14. the RELEASE state and the CALCULATION grade are independent objects', () => {
    // Braidon: every section's release state is pending (open route requirement)
    // while its calculation is a graded pass. That combination is the whole point.
    const feeder = sections.find(s => s.sectionId === 'COMBINER_TO_DISCO_RUN');
    expect(feeder, 'the combiner feeder section').toBeTruthy();
    expect(feeder!.compliance.state).toBe('PENDING-REVIEW-REQUIRED');
    expect(feeder!.voltageDrop.conclusion).toBe('PROVISIONAL_PASS');
  });
});

// ── 3. THE TWO SHEETS AGREE ────────────────────────────────────────────────
describe('D5 §3 — PV-4B and PV-4B.1 cannot contradict each other', () => {
  it('15. both sheets emit tagged voltage-drop cells', () => {
    expect(vdCells('PV-4B').length).toBeGreaterThan(0);
    expect(vdCells('PV-4B.1').length).toBeGreaterThan(0);
  });

  it('16. THE DEFECT: the shared feeder carries the SAME conclusion on both sheets', () => {
    const sections = projectE1PhysicalSchedule(snap);
    const feeder = sections.find(s => s.sectionId === 'COMBINER_TO_DISCO_RUN')!;
    const pv4b = vdCells('PV-4B');
    expect(pv4b).toHaveLength(1);
    expect(pv4b[0].conclusion).toBe(feeder.voltageDrop.conclusion);
    expect(pv4b[0].lengthAuthority).toBe(feeder.voltageDrop.lengthAuthorityLabel);
    expect(pv4b[0].fieldPending).toBe(String(feeder.voltageDrop.fieldVerificationPending));
  });

  it('17. the feeder percentage and length agree across the two sheets', () => {
    const sections = projectE1PhysicalSchedule(snap);
    const feeder = sections.find(s => s.sectionId === 'COMBINER_TO_DISCO_RUN')!;
    const pv4bText = sheet('PV-4B');
    const pct = feeder.voltageDropPct!.toFixed(2);
    expect(pv4bText).toContain(`${pct}%`);
    expect(pv4bText).toContain(`${feeder.vdCalculationLengthFt} ft`);
    const pv4b1Text = sheet('PV-4B.1');
    expect(pv4b1Text).toContain(`${pct}%`);
  });

  it('18. PV-4B.1 no longer prints a review state in the CALCULATION position', () => {
    for (const c of vdCells('PV-4B.1')) {
      expect(c.conclusion).toMatch(/^(VERIFIED_PASS|PROVISIONAL_PASS|FAIL|INDETERMINATE)$/);
      expect(c.conclusion).not.toMatch(/PENDING|REVIEW/);
    }
  });

  it('19. the RELEASE state is still displayed — separately, and still pending', () => {
    const s = sheet('PV-4B.1');
    expect(s).toContain('RELEASE / REVIEW');
    expect(s).toContain('PENDING — REVIEW REQ’D');
  });

  it('20. an open route requirement does not replace any calculation conclusion', () => {
    const cells = vdCells('PV-4B.1');
    const pendingCells = cells.filter(c => c.fieldPending === 'true');
    expect(pendingCells.length).toBeGreaterThan(0);
    // every one of them STILL states a real calculation grade
    expect(pendingCells.every(c => c.conclusion !== '')).toBe(true);
  });
});

// ── 4. BRAIDON STAYS HONEST ────────────────────────────────────────────────
describe('D5 §4 — Braidon has measured nothing and the sheets say so', () => {
  it('21. no rendered voltage-drop cell claims VERIFIED_PASS', () => {
    const all = [...vdCells('PV-4B'), ...vdCells('PV-4B.1')];
    expect(all.filter(c => c.conclusion === 'VERIFIED_PASS')).toEqual([]);
  });

  it('22. the phrase "VERIFIED PASS" appears nowhere in the package', () => {
    expect(html).not.toContain('VERIFIED PASS');
  });

  it('23. every ESTIMATED voltage-drop cell reports field verification as still pending', () => {
    // 2026-08-29 - ONE SEGMENT IS NOT AN ESTIMATE. DISCO_TO_METER_RUN is the
    // NEC 705.11(C) supply-side tap span: the DESIGN fixes it at the 10 ft
    // maximum, the conductors are sized on that, and the snapshot has always
    // recorded it as `design-constraint` / `known-design`. The grader had no
    // branch for either value, so it flattened them to "CAD-derived estimate" -
    // the row printed `design-constraint` in its provenance column and
    // CAD-DERIVED ESTIMATE two columns to the right, and told the installer to
    // field-verify a distance the drawing REQUIRES them to achieve.
    //
    // The rule these cases defend is unchanged: nothing claims VERIFIED PASS,
    // and every genuinely estimated length still reports its field requirement
    // as open. What is corrected is the one segment where that was never true.
    const all = [...vdCells('PV-4B'), ...vdCells('PV-4B.1')];
    const designFixed = all.filter(c => /FIXED BY DESIGN/i.test(c.lengthAuthority ?? ''));
    const estimated = all.filter(c => !/FIXED BY DESIGN/i.test(c.lengthAuthority ?? ''));
    expect(estimated.length).toBeGreaterThan(0);
    expect(estimated.every(c => c.fieldPending === 'true')).toBe(true);
    // ...and the design-fixed one does NOT carry a field requirement it cannot owe.
    expect(designFixed.every(c => c.fieldPending !== 'true')).toBe(true);
  });

  it('24. no voltage-drop conclusion is an unqualified tick — a pass is always graded', () => {
    const all = [...vdCells('PV-4B'), ...vdCells('PV-4B.1')];
    for (const c of all) expect(c.conclusion).not.toBe('PASS');
  });

  it('25. no section length is described as field-verified', () => {
    const all = [...vdCells('PV-4B'), ...vdCells('PV-4B.1')];
    expect(all.filter(c => c.lengthAuthority === 'FIELD VERIFIED')).toEqual([]);
  });

  it('26. the route-length requirement is CLEARED by the design bound', () => {
    // 2026-08-28 ROUTE-BOUND MIGRATION - ROUTE-LENGTH-ESTIMATE no longer fires:
    // the DESIGN bounds each un-routed run by stating the maximum one-way length
    // at which the selected conductor still meets its Vd limit, and the drawing
    // carries that requirement. Nothing was relaxed - an unbounded run still
    // blocks, an estimate over its bound raises ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND,
    // and the BOM quantity is still ESTIMATED. See route-length-bound.test.ts.
    const blockers = (snap.permitReadiness?.blockers ?? []).map(b => b.code);
    expect(blockers).not.toContain('ROUTE-LENGTH-ESTIMATE');
    // ANTI-VACUITY: it cleared because bounds exist, not because the gate stopped
    // asking. Every estimate-grade project-owned run carries a real maximum.
    const est = (snap.electrical.routeSegments ?? []).filter(r =>
      (r.routeAuthorityApplicability ?? 'REQUIRED') === 'REQUIRED'
      && r.lengthSource === 'cad-derived-estimate');
    expect(est.length).toBeGreaterThan(0);
    for (const r of est) expect(r.designMaxOneWayFt, r.segmentId).toBeGreaterThan(0);
  });

  it('27. no route segment carries a field measurement', () => {
    const segs = snap.electrical.routeSegments ?? [];
    const measured = segs.filter(s => s.verifiedFieldLengthFt != null).map(s => s.segmentId);
    expect(measured).toEqual([]);
  });
});
