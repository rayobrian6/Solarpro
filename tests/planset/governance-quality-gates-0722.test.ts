// ============================================================================
// tests/planset/governance-quality-gates-0722.test.ts
//
// W4 POST-CAMPAIGN CORRECTION (2026-07-22) — GOVERNANCE / IDENTITY / QUALITY.
// Permanent PACKAGE-LEVEL quality gates: generate the FULL Braidon planset (the
// exact audited design) and scan the rendered HTML across ALL sheets for the
// truth-authority regressions Ray's audit found. These scans are the render-
// level half of the corrections (the snapshot-level half lives in validate.ts).
//
//   §1  — no "ISSUED FOR PERMIT" / "Initial Issue for Permit" while PENDING
//   §2  — no affirmative certification phrases without an approved review record
//   §11 — no code-edition literal ("IBC 2021" / "IFC 2021") in body/BOM/labels
//   §15 — no mojibake; human utility name (not the slug); no premature install
//         date; TEST project / blank designer never reaches an issued state
// ============================================================================
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** The audited package was "...Solar TEST" on the utility slug. Reconstruct that
 *  exact defect surface so the gates prove the fixes on the ORIGINAL inputs. */
function auditInput(): any {
  const input = clone(braidonOriginalAuditFixture) as any;
  input.project.projectName = `${input.project.projectName} — Solar TEST`;
  input.project.utilityName = 'il-ameren-illinois';        // §15b: raw registry slug
  if (input.compliance?.jurisdiction) input.compliance.jurisdiction.utilityName = 'il-ameren-illinois';
  return input;
}

function generate(input: any): { html: string; snap: PermitDesignSnapshot } {
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

/** Split the full package into individual rendered sheets. */
function sheetsOf(html: string): string[] {
  return [...html.matchAll(/<div class="page"[\s\S]*?(?=<div class="page"|<\/body>|$)/g)].map(m => m[0]);
}

describe('W4 §1 — issue-state authority (no ISSUED FOR PERMIT while pending)', () => {
  const { html, snap } = generate(auditInput());

  it('the snapshot is NOT issued (pending review) for the audited design', () => {
    expect(snap.projectAuthority.issueState).not.toBe('ISSUED FOR PERMIT');
    expect(snap.projectAuthority.issueState).not.toBe('PERMIT-READY');
    // multi-domain authority gaps ⇒ PENDING ENGINEERING REVIEW
    expect(snap.projectAuthority.issueState).toMatch(/^PENDING|^DESIGN DRAFT|^REVISED/);
  });

  it('ZERO "ISSUED FOR PERMIT" occurrences across ALL rendered sheets', () => {
    const sheets = sheetsOf(html);
    expect(sheets.length).toBeGreaterThanOrEqual(15);
    const offenders = sheets.filter(s => s.includes('ISSUED FOR PERMIT'));
    expect(offenders.length).toBe(0);
  });

  it('CERT revision history does not say "Initial Issue for Permit"', () => {
    expect(html).not.toContain('Initial Issue for Permit');
  });

  it('every sheet REVISION block prints the DERIVED issue state', () => {
    const state = snap.projectAuthority.issueState;
    // The title-block REV A row appears on every sheet and carries the derived state.
    expect(html).toContain(state);
  });
});

describe('W4 §2 — certification gate (no affirmative cert without an approved review)', () => {
  const { html } = generate(auditInput());

  const AFFIRMATIVE = [
    'I hereby certify',
    'prepared under my direct supervision',
    'prepared under my supervision',
    'confirmed adequate',
    'is adequate to support',
    'are adequate to support',
    // BAR §3 / gate 3 (2026-07-25) — the SCHED global-compliance conclusion. No
    // package-wide PASS / compliance / VERIFIED claim may render while blocking
    // release blockers are active; SCHED's conclusion is registry-derived.
    'All equipment is UL-listed',
    'wire sizing verified per NEC 690.8 with derating',
  ];

  it('NONE of the affirmative certification phrases render while review is pending', () => {
    for (const phrase of AFFIRMATIVE) {
      expect(html.includes(phrase), `affirmative phrase leaked: "${phrase}"`).toBe(false);
    }
  });

  it('BAR §3 / gate 3 — no global compliance claim while blocking items exist; SCHED states the honest state', () => {
    const { html: h, snap } = generate(auditInput());
    const blocking = snap.permitReadiness.registry.filter(r => r.severity === 'blocking' && !r.resolved);
    expect(blocking.length).toBeGreaterThan(0);
    // the hardcoded PASS sentence and the wire-sizing VERIFIED badge are both gone
    expect(h).not.toMatch(/equipment complies with NEC\s*\d{4}\s*and UL 1741/i);
    expect(h).not.toContain('>VERIFIED</span>');
    // and SCHED states the registry-derived conclusion instead
    expect(h).toContain('COMPLIANCE NOT YET ESTABLISHED');
    expect(h).toContain('SEE RS-1 FOR ACTIVE RELEASE BLOCKERS');
  });

  it('CERT and PE-1 render the PENDING ENGINEERING REVIEW template', () => {
    expect(html).toContain('PENDING ENGINEERING REVIEW');
    expect(html).toContain('NOT FOR PERMIT SUBMISSION');
  });

  it('affirmative certification RENDERS once an approved review covers the current digest', async () => {
    const input = auditInput();
    input.project.projectName = 'BRAIDON PILLA SOLAR';
    generatePermitHTML(input);                                  // builds input._snapshot (deep-frozen)
    // The built snapshot is frozen — clone it to attach an approved review record
    // covering the CURRENT digest, then re-render the cert sheet from that.
    const snap = clone(input._snapshot) as PermitDesignSnapshot;
    (snap.certification as any).engineeringReviewApproved = { reviewedDigest: snap.meta.digest };
    (snap.certification as any).engineer = { name: 'Jane PE', license: 'PE-000', jurisdiction: 'IL' };
    input._snapshot = snap;
    const { pagePELetterRoof, certificationApproved } = await import('@/lib/permit/sections/certPages');
    expect(certificationApproved(input)).toBe(true);
    const cad = { systemType: 'roof', roof: { planes: [] } } as any;
    const letter = pagePELetterRoof(input, cad, 1, 1);
    // With an approved review, the affirmative certification statement activates.
    expect(letter).toContain('hereby certify');
  });
});

describe('W4 §11 — code-authority edition literals (none in body/BOM/labels)', () => {
  const { html, snap } = generate(auditInput());

  it('codeAuthority does NOT carry a verified IFC edition for this job (⇒ IFC pending)', () => {
    // Sanity: the IFC authority is unverified here, so any "IFC 2021" would be a
    // fabricated edition literal, not a projection of a real adoption.
    const ifc = (snap.codeAuthority as any)?.editions?.ifc?.edition ?? null;
    expect(ifc).toBeNull();
  });

  it('ZERO "IFC 2021" / "IBC 2021" edition literals across ALL sheets', () => {
    expect(html.includes('IFC 2021')).toBe(false);
    expect(html.includes('IBC 2021')).toBe(false);
  });

  it('the label schedule prints IFC PENDING (not a baked-in edition) when IFC is unverified', () => {
    // The placard code-basis cell must not leak the JSON literal edition.
    expect(html).not.toMatch(/IFC 20\d\d\s+120[0-9]/);
  });
});

describe('W4 §15 — quality gates (mojibake / utility slug / install date / TEST)', () => {
  const { html, snap } = generate(auditInput());

  it('(a) ZERO mojibake / replacement-character sequences in the rendered package', () => {
    // U+FFFD replacement char + classic double-encoded UTF-8 signatures.
    const MOJIBAKE = /�|â€|Ã[ -¿]|Â[¡-¿]/;
    const _m = html.match(MOJIBAKE);
    expect(_m ? html.slice(Math.max(0,(_m.index??0)-30),(_m.index??0)+30) : null).toBeNull();
  });

  it('(b) the HUMAN utility name renders, never the slug il-ameren-illinois', () => {
    expect(html.includes('il-ameren-illinois')).toBe(false);
    expect(snap.projectAuthority.utilityName).toBe('Ameren Illinois');
    expect(html).toContain('Ameren Illinois');
  });

  it('(c) the install-date field is NOT pre-populated with the issue date', () => {
    // The issue/package date must never appear as the INSTALL DATE value.
    expect(html).not.toMatch(/INSTALL DATE:<\/strong>\s*\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('(d) a TEST project name blocks the production/issued state + the identity gate', () => {
    expect(snap.projectAuthority.projectName).toMatch(/TEST/);
    const idPre = snap.projectAuthority.issuedForPermitGate.preconditions.find(p => p.id === 'project-identity-valid');
    expect(idPre?.satisfied).toBe(false);
    expect(snap.projectAuthority.issueState).not.toBe('ISSUED FOR PERMIT');
    expect(snap.projectAuthority.issueState).not.toBe('PERMIT-READY');
  });

  it('§14 — postal-inferred project authority is unverified-derived + blocks permit-ready', () => {
    expect(snap.projectAuthority.authorityAnyUnverified).toBe(true);
    expect(snap.projectAuthority.authorityVerification.municipalBoundary).toBe('unverified-derived');
    expect(snap.permitReadiness.blockers.some(b => b.code === 'PROJECT-AUTHORITY-UNVERIFIED')).toBe(true);
  });
});
