// ═══════════════════════════════════════════════════════════════════════════
// THE CERTIFICATION GATE, AND WHAT V13 ACTUALLY PROTECTS (2026-08-28)
//
// `certificationGateBanner` (certPages.ts) is the SECOND release banner in the
// package — the one on CERT and the PE letters. It carried the same three
// defects the drawing banner did, plus one of its own:
//
//   1. Its headline was the constant 'PENDING ENGINEERING REVIEW', so a package
//      missing ten facts and a package whose design and authority data are
//      COMPLETE and which is genuinely waiting on a reviewer read identically —
//      on the one sheet an engineer picks up first.
//   2. Its rows printed the review-record EXPLANATION, truncated at 200
//      characters with "… (full text on RS-1)" — a certification sheet carrying
//      200 characters of a moment-envelope derivation, cut off mid-sentence.
//   3. 'STRUCTURAL ENGINEERING REVIEW REQUIRED' was gated on
//      `structuralBlockers.length > 0`, which counts the rail-SKU ADVISORY. An
//      unpinned part number summoned a demand for structural review.
//
// And invariant V13 asserted the literal 'PENDING ENGINEERING REVIEW' appeared
// somewhere on the page. That was never a sound test: the revision block on the
// same sheet prints `projectAuthority.issueStatus`, and that string is one of
// its eight legal values — so a cert sheet that had LOST its gate entirely could
// still satisfy V13 off a title-block field, while a sheet in a different but
// perfectly honest state ('PENDING STRUCTURAL REVIEW') failed it while carrying
// a correct gate. V13 now asserts the property it always meant: an unapproved
// certification sheet CARRIES THE GATE, and that gate does not claim release.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { REQUIREMENT_DECLARATIONS, SHEET_LINE_MAX_CHARS } from '@/lib/permit/snapshot/releaseGates';
import { certGateViolationReason } from '@/lib/permit/utils/peLetterIdentity';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const HTML: string = generatePermitHTML(clone(braidonOriginalAuditFixture) as any);

/** the certification pages, each as raw HTML */
function certPages(html: string): string[] {
  return html.split(/(?=<div class="page)/).filter(p => p.includes('data-cert-gate="1"'));
}
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** the gate box on a certification page */
const gateOf = (page: string): string => {
  const i = page.indexOf('<div data-cert-gate="1"');
  return page.slice(i, i + 4000);
};

describe('the certification gate states the PHASE, not a constant', () => {
  it('renders on the unapproved package and carries a derived phase id', () => {
    const pages = certPages(HTML);
    expect(pages.length, 'CERT / PE-1 must carry the gate while unapproved').toBeGreaterThan(0);
    for (const g of pages.map(gateOf)) {
      const id = /data-release-phase="([A-Z_]+)"/.exec(g)?.[1];
      expect(id, 'the gate must name the phase it is in').toBeTruthy();
      expect(id).not.toBe('ISSUED_FOR_PERMIT');
      // the headline IS the phase label, not the retired constant
      const label = /data-banner-phase-label="1"[^>]*>([^<]+)</.exec(g)?.[1]?.trim();
      expect(label, 'the headline must be the phase label').toBeTruthy();
      expect(label).not.toBe('PENDING ENGINEERING REVIEW');
    }
  });

  it('the cert gate and the drawing banner never state different phases', () => {
    // Two banners, one package. Before the migration one was hardcoded and the
    // other derived, so they could not have agreed even in principle.
    const cert = new Set(certPages(HTML).map(p => /data-cert-gate="1"[^>]*data-release-phase="([A-Z_]+)"/.exec(p)?.[1]));
    const draw = new Set([...HTML.matchAll(/class="struct-review-banner" data-release-phase="([A-Z_]+)"/g)].map(m => m[1]));
    expect(cert.size).toBe(1);
    for (const d of draw) expect(cert.has(d), `drawing says ${d}, cert says ${[...cert][0]}`).toBe(true);
  });
});

describe('a certification sheet carries one line per requirement', () => {
  it('no gate row is a review-record paragraph, and none is truncated', () => {
    // 2026-08-29 - at least ONE certification page carries rows, not every one:
    // 'CERT' was removed from every requirement's affectedSheets because the
    // package does not contain a CERT sheet (the content merged into PE-1), so a
    // CERT page in the full profile now correctly owns nothing.
    const _allRows = certPages(HTML).map(gateOf).flatMap(g =>
      [...g.matchAll(/<li style="margin:0 0 1px 0;[^"]*"[^>]*data-banner-requirement[^>]*>([\s\S]*?)<\/li>/g)]);
    expect(_allRows.length, 'the fixture gates a certification sheet').toBeGreaterThan(0);
    for (const g of certPages(HTML).map(gateOf)) {
      const rows = [...g.matchAll(/<li style="margin:0 0 1px 0;[^"]*"[^>]*data-banner-requirement[^>]*>([\s\S]*?)<\/li>/g)];
      for (const m of rows) {
        const row = text(m[1]);
        expect(row.length, `row too long for a sheet: ${row}`).toBeLessThanOrEqual(SHEET_LINE_MAX_CHARS + 12);
        expect(row, 'the 200-char explanation truncation must be gone').not.toMatch(/full text on RS-1/);
      }
    }
  });

  it('no certification sheet prints an engineering derivation', () => {
    // The exact content that used to reach these sheets through `explanation`.
    for (const g of certPages(HTML).map(gateOf)) {
      expect(text(g)).not.toMatch(/w·L|in-lb|GOVERNING-CANDIDATE/i);
    }
  });

  it('an advisory is labelled as one', () => {
    const adv = certPages(HTML).map(gateOf)
      .flatMap(g => [...g.matchAll(/data-banner-advisory="1"[^>]*>([\s\S]*?)<\/li>/g)]);
    expect(adv.length, 'the fixture carries the rail advisory').toBeGreaterThan(0);
    for (const a of adv) expect(text(a[1])).toMatch(/^ADVISORY/);
  });

  it('every code a cert gate can print has a declared sheet line', () => {
    const codes = certPages(HTML).map(gateOf)
      .flatMap(g => [...g.matchAll(/data-banner-requirement="([^"]+)"/g)].map(m => m[1]));
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) {
      expect(REQUIREMENT_DECLARATIONS[c]?.sheetLine, `${c} falls back to naming itself`).toBeTruthy();
    }
  });
});

describe('V13 — the rewritten invariant still catches what it was for', () => {
  // These mutate a REAL rendered certification page and run V13's OWN predicate
  // over it -- `certGateViolationReason` is the function the invariant calls, not
  // a copy of it. A test that re-implemented the check would prove only its own
  // regex, which is precisely how the old literal check survived for so long.
  const realCertPage = (): string => {
    const p = certPages(HTML)[0];
    expect(p, 'a real unapproved certification page').toBeTruthy();
    return p;
  };

  it('PASSES on the real unapproved certification sheet', () => {
    expect(certGateViolationReason(realCertPage())).toBeNull();
  });

  it('FIRES when the gate banner is removed entirely', () => {
    // The old literal check could MISS this: 'PENDING ENGINEERING REVIEW' is a
    // legal projectAuthority.issueStatus and the revision block prints it, so a
    // sheet stripped of its gate could still satisfy V13.
    expect(certGateViolationReason(realCertPage().replace(/data-cert-gate="1"/, 'data-cert-gate="0"')))
      .toMatch(/lacks the certification gate/);
  });

  it('FIRES when an unapproved gate claims ISSUED FOR PERMIT', () => {
    expect(certGateViolationReason(realCertPage().replace(/data-release-phase="[A-Z_]+"/, 'data-release-phase="ISSUED_FOR_PERMIT"')))
      .toMatch(/ISSUED_FOR_PERMIT/);
  });

  it('FIRES when the not-for-submission statement is dropped', () => {
    expect(certGateViolationReason(realCertPage().replace(/NOT FOR PERMIT SUBMISSION/g, 'READY'))).toBeTruthy();
  });

  it('does NOT fire merely because the issue state is worded differently', () => {
    // The old predicate failed a package in 'PENDING STRUCTURAL REVIEW' — an
    // honest, legal issue state — while it carried a perfectly correct gate.
    expect(certGateViolationReason(realCertPage().replace(/PENDING ENGINEERING REVIEW/g, 'PENDING STRUCTURAL REVIEW'))).toBeNull();
  });
});
