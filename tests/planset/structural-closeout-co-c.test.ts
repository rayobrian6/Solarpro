// ═══════════════════════════════════════════════════════════════════════════
// Closeout pass — CO-C (structural) gates §11 / §12 / §13 / §14.
//   §11 (Gate 11) RT-MINI always projects rail_paired — no name-based inference;
//        PV-3 says RAIL-PAIRED ROOF ATTACHMENT BASE, never DIRECT-ATTACH MOUNT.
//   §12 (Gate 12) ONE canonical fastener assembly projected IDENTICALLY onto
//        APP-A / PE-1 / SCHED; PE-1 prints PENDING VERIFIED FASTENER ASSEMBLY
//        while unverified and carries no generic lag/5-16/stainless text.
//   §13 (Gate 13) unverified framing renders NO capacity/utilization/adequate.
//   §14 (Gate 14) screening-envelope statement is complete (corner-zone, ASD,
//        area ratio, never exact tributary geometry).
// (Gate 10 — DS-4 omission — lives in equipment-document-authority-w5.test.ts.)
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { classifyMountTopology, getMountingSystemById } from '@/lib/mounting-hardware-db';
import {
  projectFastenerAssembly, projectStructuralFromInput, resolveFastenerVerification,
} from '@/lib/permit/snapshot/structuralProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function genWith(mountId?: string): { html: string; input: any } {
  const input = clone(roofProject) as any;
  if (mountId) input.project.mountingSystemId = mountId;
  const html = generatePermitHTML(input);
  return { html, input };
}

const cellOf = (html: string, field: string): string | null => {
  const m = html.match(new RegExp(`data-${field}-field="fastener"[^>]*>([^<]*)<`, 'i'));
  return m ? m[1] : null;
};

// ── §11 ─────────────────────────────────────────────────────────────────────
describe('§11 (Gate 11) — RT-MINI projects rail_paired, no name-based inference', () => {
  it('classifyMountTopology(rooftech-mini) === rail_paired (canonical, not the name)', () => {
    const rt = getMountingSystemById('rooftech-mini')!;
    expect(classifyMountTopology(rt).topology).toBe('rail_paired');
  });

  it('PV-3 attachment callout is RAIL-PAIRED ROOF ATTACHMENT BASE, never DIRECT-ATTACH MOUNT', () => {
    const { html } = genWith('rooftech-mini');
    expect(html).toContain('RAIL-PAIRED ROOF ATTACHMENT BASE');
    expect(html).not.toContain('DIRECT-ATTACH MOUNT');
  });

  it('a conventional railed mount (XR100) also projects the rail-paired base label', () => {
    const { html } = genWith('ironridge-xr100');
    expect(html).toContain('RAIL-PAIRED ROOF ATTACHMENT BASE');
    expect(html).not.toContain('DIRECT-ATTACH MOUNT');
  });
});

// ── §12 ─────────────────────────────────────────────────────────────────────
describe('§12 (Gate 12) — one fastener assembly, identical projection across sheets', () => {
  const { html, input } = genWith('rooftech-mini');
  const fa = projectFastenerAssembly(input);

  it('the fastener projection is populated from canonical mount/racking data', () => {
    expect(fa.present).toBe(true);
    // 2026-08-28 RT-MINI MIGRATION - the roof fastener is the PE letter's
    // SS304 5.0 mm wood screw. The 5/16" the catalogue used to publish is the
    // L-FOOT FLANGE BOLT - a different fastener in a different joint.
    expect(fa.diameterLabel).toBe('M5 (5.0 mm)');
    expect(fa.fastenerType).toBe('SS304 5.0 mm x 90 mm wood screw (no pilot hole)');
    expect(fa.pilotHoleRequired).toBe(false);
    // 2026-08-28 RT-MINI MIGRATION - the RT-MINI II record carries the PE letter's
    // own fastener: an SS304 5.0 mm x 90 mm wood screw, embedding 3.07 in (90 mm
    // less 15/32 in sheathing). 2.5 in and 'structural wood screw' were the
    // gen-1 record's generic values.
    expect(fa.embedmentIn).toBe(3.07);
    // TAC WS-4 — element completeness is NOT verification. The elements are all
    // present (model + count + embedment), but the only cited source is
    // ICC-ES ESR-3575 — a FLASHING / water-resistance evaluation report, which
    // this codebase already refuses as capacity authority and which carries no
    // fastener-installation authority either; and the RT-MINI II document is not
    // verified applicable to the selected RT-MINI. So the ONE predicate says
    // UNVERIFIED, and every sheet says the same thing.
    expect(fa.verification).toBe('unverified');
    expect(fa.certLabel).toBe('PENDING VERIFIED FASTENER ASSEMBLY');
  });

  it('APP-A, PE-1 and SCHED render the SAME canonical fastener line', () => {
    const appA = cellOf(html, 'app-a');
    const pe1  = cellOf(html, 'pe');
    const sched = cellOf(html, 'sched');
    expect(appA).toBeTruthy();
    expect(pe1).toBeTruthy();
    expect(sched).toBeTruthy();
    expect(appA).toBe(pe1);
    expect(pe1).toBe(sched);
    // TAC WS-4: unverified ⇒ the ONE shared line is the design-quantity label on
    // every sheet and NO dimension may print (the §12 identity invariant is what
    // is being tested — that all three sheets say the SAME thing).
    expect(appA).toBe('DESIGN QUANTITY — NON-ORDERABLE / PENDING VERIFIED FASTENER ASSEMBLY');
    expect(appA).not.toContain('5/16');
    expect(appA).not.toContain('structural wood screw');
  });

  it('TAC WS-4 — the observed geometry is RETAINED for regeneration though withheld from the line', () => {
    // Unverified ⇒ dimensionless line, but the canonical fields keep the observed
    // geometry so the exact orderable row regenerates the moment an applicable,
    // evidence-bearing installation document is verified.
    expect(fa.nonOrderable).toBe(true);
    expect(fa.line).not.toContain('5/16');
    expect(fa.line).not.toContain('structural wood screw');
    // 2026-08-28 RT-MINI MIGRATION - the roof fastener is the PE letter's
    // SS304 5.0 mm wood screw. The 5/16" the catalogue used to publish is the
    // L-FOOT FLANGE BOLT - a different fastener in a different joint.
    expect(fa.diameterLabel).toBe('M5 (5.0 mm)');       // retained on the object
    // 2026-08-28 RT-MINI MIGRATION - the RT-MINI II record carries the PE letter's
    // own fastener: an SS304 5.0 mm x 90 mm wood screw, embedding 3.07 in (90 mm
    // less 15/32 in sheathing). 2.5 in and 'structural wood screw' were the
    // gen-1 record's generic values.
    expect(fa.embedmentIn).toBe(3.07);            // retained on the object
    // …and the ONE predicate names WHY it is not verified (the flashing report).
    const v = resolveFastenerVerification({
      elementsComplete: true,
      citedSourceDocument: 'ICC-ES ESR-3575',
      documentApplicabilityVerified: true,
    });
    expect(v.verified).toBe(false);
    expect(v.reason).toMatch(/flashing \/ water-resistance evaluation report/i);
    // a genuine installation document WITH verified applicability does verify.
    const ok = resolveFastenerVerification({
      elementsComplete: true,
      citedSourceDocument: 'Roof Tech RT-MINI Installation Manual (Jan 2021)',
      documentApplicabilityVerified: true,
    });
    expect(ok.verified).toBe(true);
  });

  it('TAC WS-4 — PE-1 prints the PENDING fastener state and drops generic lag/stainless text', () => {
    expect(html).toContain('PENDING VERIFIED FASTENER ASSEMBLY');
    // the specific generic triplet §12 named must be gone
    expect(html).not.toContain('Lag bolt w/ flashing');
    expect(html).not.toContain('>Stainless Steel<');
  });

  it('TAC WS-4/WS-5 — PV-3 withholds exact dims and never states a covering as embedment substrate', () => {
    // dimensions are gated on the instruction authority (unchanged PPC rule)…
    expect(html).not.toMatch(/5\/16"?\s*(DIA|diameter)/i);
    // …and no roof COVERING may appear as a structural embedment target.
    expect(html).not.toMatch(/embed\w*\s+into\s+[^<]{0,40}(asphalt|shingle|shake)/i);
  });
});

// ── §13 ─────────────────────────────────────────────────────────────────────
describe('§13 (Gate 13) — unverified framing renders no capacity/adequacy', () => {
  const { html, input } = genWith('rooftech-mini');
  const proj = projectStructuralFromInput(input);
  const reviewRequired = proj.engine?.engineeringReviewRequired === true;

  it('the fixture framing is unverified (engineering review required)', () => {
    expect(reviewRequired).toBe(true);
  });

  it('PV-4C DEAD LOAD INTERPRETATION states NOT VERIFIED and asserts no adequacy', () => {
    expect(html).toContain('EXISTING FRAMING CAPACITY NOT VERIFIED');
    // no path prints an adequacy/utilization verdict for the unverified framing
    expect(html).not.toContain('confirms the existing framing has adequate capacity');
    // 2026-08-29 - THE SENTENCE WAS NOT THE LEAK. This assertion pinned one
    // English phrase, so PE-1 could print a bare "bending - 60% (PASS)" - a
    // framing capacity conclusion computed from defaulted span/species/spacing -
    // and stay green. Assert on the TOKENS a conclusion is made of.
    const _t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    expect(_t, 'a framing limit state carries a utilization %')
      .not.toMatch(/(bending|deflection)\s*[—-]\s*\d+\s*%/i);
    expect(_t, 'a framing check carries a PASS')
      .not.toMatch(/(bending|deflection)[^.]{0,40}\(PASS\)/i);
  });

  it('the FRAMING-AUTHORITY-UNVERIFIED blocker covers the framing authority gap', () => {
    const snap: any = input._snapshot;
    const codes = (snap?.permitReadiness?.registry ?? snap?.permitReadiness?.blockers ?? [])
      .map((b: any) => b.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
  });
});

// ── §14 ─────────────────────────────────────────────────────────────────────
describe('§14 (Gate 14) — screening-envelope statement is complete + honest', () => {
  const { html } = genWith('rooftech-mini');

  it('states conservative corner-zone pressure, ASD basis and the area ratio', () => {
    expect(html).toContain('CONSERVATIVE SCREENING ENVELOPE');
    expect(html).toContain('GOVERNING corner');
    expect(html).toContain('ASD basis');
    // explicit area ratio (Σ tributary ÷ array area), printed as N.NNN×
    expect(html).toMatch(/\d\.\d{3}×/);
  });

  it('never claims an exact per-position tributary geometry', () => {
    expect(html).toContain('NOT an exact per-position zone or tributary geometry');
    expect(html).not.toContain('exact tributary geometry.');
  });
});
