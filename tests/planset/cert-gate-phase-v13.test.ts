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
//
// ── RAY'S RULING 2026-09-18 — THE GATE BOX CAME OFF THE OUTBOUND SHEETS ─────
// PE-1 is the letter we hand a PE so that he stamps it. Ray ruled every internal
// release/status ornament off it: `certificationGateBanner` now emits ONLY a
// hidden `data-cert-gate` element (phase, phase kind, package-line flag,
// remainder count, structural-review flag) and prints no headline, no
// requirement rows, no package line and no "PRELIMINARY — NOT FOR CONSTRUCTION ·
// NOT FOR PERMIT SUBMISSION — UNSIGNED / UNSEALED" line. V13 was retargeted with
// it: it now anchors on the ENGINEER'S CERTIFICATION STATEMENT's machine-readable
// `data-cert-asserted`, which is a STRONGER anchor than the page-wide literal it
// replaced.
//
// Nothing below was deleted to make the file pass. Every claim that used to be
// read off the gate box is read where the property now lives — the hidden gate
// attributes, the certification statement, or RS-1 (+ RS-1.1: the registry
// paginates, so a code may sit on either sheet) — and every printed form Ray
// removed is pinned as an explicit ABSENCE so it cannot creep back.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { REQUIREMENT_DECLARATIONS, SHEET_LINE_MAX_CHARS } from '@/lib/permit/snapshot/releaseGates';
import { certGateViolationReason } from '@/lib/permit/utils/peLetterIdentity';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const HTML: string = generatePermitHTML(clone(braidonOriginalAuditFixture) as any);

// ── HELPERS, RETARGETED 2026-09-18 (RAY'S RULING) ──────────────────────────
// The old split was `/(?=<div class="page)/`, which ALSO matched
// `<div class="page-content">` — so a "certification page" was in truth only the
// TITLE-BLOCK chunk of the sheet. That was invisible while every claim under
// test lived inside the gate box (which sits in that chunk); with the box gone
// the claims live in the sheet BODY (the certification statement), so the split
// has to yield whole sheets. `[ ">]` after `page` admits `page"`,
// `page cert-compact` and `page" data-sheet-id=…` while excluding
// page-content / page-body / page-draw. Same shape as the SHEET_SPLIT in
// release-gate-rendering-rgm.test.ts.
const SHEET_SPLIT = /(?=<div class="page[ ">])/;
const sheets = (html: string): string[] => html.split(SHEET_SPLIT);
/** the title-block SHEET ID of a rendered sheet ('' when it is not a sheet) */
const sheetIdOf = (page: string): string =>
  /class="tb-sheet-id">\s*([^<]*?)\s*</.exec(page)?.[1] ?? '';
/** the certification SHEETS (CERT / PE-1), each as raw HTML */
function certPages(html: string): string[] {
  return sheets(html).filter(p => p.includes('data-cert-gate="1"'));
}
/** RGM §5 — the review record is RS-1 UNION its RS-1.n continuation sheets: a
 *  requirement code lands on whichever one the pagination put it on, so a
 *  lookup against RS-1 alone silently misses half the registry. Found by the
 *  title block, never by page ordinal. */
const rs1Union = (html: string): string =>
  sheets(html).filter(p => /^RS-1/.test(sheetIdOf(p))).join('\n');
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** the gate ELEMENT on a certification page. It is now a single empty hidden
 *  div, so this matches it exactly rather than slicing a 4000-char window —
 *  a window that would now be mostly sheet body and would make the
 *  "the gate must not print X" assertions below mean something else. */
const gateOf = (page: string): string =>
  /<div data-cert-gate="1"[\s\S]*?<\/div>/.exec(page)?.[0] ?? '';

describe('the certification gate states the PHASE, not a constant', () => {
  it('renders on the unapproved package and carries a derived phase id', () => {
    const pages = certPages(HTML);
    expect(pages.length, 'CERT / PE-1 must carry the gate while unapproved').toBeGreaterThan(0);
    for (const page of pages) {
      const g = gateOf(page);
      // NON-VACUITY: gateOf returns '' when the element is missing, and every
      // not.toMatch below would then pass against the empty string.
      expect(g, `${sheetIdOf(page)} must carry the gate element itself`).toBeTruthy();
      const id = /data-release-phase="([A-Z_]+)"/.exec(g)?.[1];
      expect(id, 'the gate must name the phase it is in').toBeTruthy();
      expect(id).not.toBe('ISSUED_FOR_PERMIT');
      // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────
      // The gate no longer PRINTS the phase label. It read "ISSUED FOR
      // ENGINEERING REVIEW" here and would read "DESIGN COMPLETE — READY FOR
      // PROFESSIONAL REVIEW" once the design closed — on the letter we hand a
      // PE. The property this guarded (the phase is DERIVED, not the retired
      // constant) is asserted on the derived id above, which is the form V13
      // itself reads.
      expect(g, 'the phase label must not print on the certification sheet')
        .not.toMatch(/data-banner-phase-label="1"/);
      expect(g).not.toMatch(/DESIGN COMPLETE|DESIGN INCOMPLETE|PACKAGE RELEASE STATUS/);
      // 🚨 AND V13's OWN PRECONDITION STILL HOLDS ON THIS GATE, in the exact
      // shape the predicate reads it: marker and phase in ONE tag. V13 scans the
      // whole page, so without this a marker on one element and a phase on
      // another would satisfy it; here the pairing is proved on the gate itself.
      // (2026-09-18: this is now V13's only structural precondition — the
      // page-wide 'NOT FOR PERMIT SUBMISSION' literal it also required is gone.)
      expect(g).toMatch(/data-cert-gate="1"[^>]*data-release-phase="[A-Z_]+"/);
      // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────
      // This used to require the gate to CONTAIN 'NOT FOR PERMIT SUBMISSION'.
      // That line — "PRELIMINARY - NOT FOR CONSTRUCTION · NOT FOR PERMIT
      // SUBMISSION - UNSIGNED / UNSEALED" — came off PE-1 and CERT entirely:
      // this sheet IS the letter we send an engineer so that he stamps it, and
      // telling him in red that it is not yet stamped is the one thing he
      // already knows. It has no other home on these sheets, so the removal is
      // pinned here as an ABSENCE, sheet-wide, and cannot silently come back.
      // (It legitimately survives on RS-1's release headline and in APP-A's
      // rail-profile cell; neither is a certification sheet.)
      expect(page, `${sheetIdOf(page)} must not shout not-for-submission at the engineer`)
        .not.toContain('NOT FOR PERMIT SUBMISSION');
      // The property that line stood for — this sheet asserts NO certification —
      // now lives on the certification statement as data-cert-asserted, which is
      // exactly what V13 reads. Asserted here on the same real pages V13 runs on.
      expect(page, `${sheetIdOf(page)} must not carry an affirmative certification`)
        .not.toMatch(/data-cert-asserted="1"/);
      expect(certGateViolationReason(page), `V13 must pass on ${sheetIdOf(page)}`).toBeNull();
    }
    // 🚨 NON-VACUITY FOR THE TWO ABSENCES ABOVE. `data-cert-asserted="1"` is
    // absent from a sheet that carries no certification statement at all, so
    // prove the statement really renders — and renders in the "0" state.
    const stated = pages.filter(p => /data-cert-statement="1"/.test(p));
    expect(stated.length, "PE-1 must carry the ENGINEER'S CERTIFICATION STATEMENT").toBeGreaterThan(0);
    for (const p of stated) {
      expect(p, `${sheetIdOf(p)} must declare that nothing is certified yet`)
        .toContain('data-cert-asserted="0"');
      expect(text(p)).toContain('NO CERTIFICATION ASSERTED');
    }
  });

  it('the cert gate states ONE phase, and the drawing banner it had to agree with is gone', () => {
    // Two banners, one package. Before the migration one was hardcoded and the
    // other derived, so they could not have agreed even in principle.
    //
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // `structuralBannerHtml()` is RETIRED (it returns '' and every call site in
    // arrayPages/structuralPages was deleted), so the `draw` set is now EMPTY
    // and the agreement loop below passed over nothing — a vacuous green of
    // exactly the shape this repo has been burned by. The half of the claim that
    // still has a referent (the cert gate derives ONE phase for the package) is
    // asserted directly; the half Ray removed is converted to an explicit
    // ABSENCE, so a red status banner cannot reappear on PV-1 / PV-1B / PV-3 /
    // PV-4C / PV-4C.1 without failing here.
    const certIds = certPages(HTML)
      .map(p => /data-cert-gate="1"[^>]*data-release-phase="([A-Z_]+)"/.exec(p)?.[1]);
    // NON-VACUITY: a Set of `undefined` would also have size 1.
    expect(certIds.length, 'the fixture renders certification sheets').toBeGreaterThan(0);
    for (const id of certIds) expect(id, 'every cert gate names its phase').toBeTruthy();
    expect(new Set(certIds).size, 'one package, one derived phase').toBe(1);
    expect(HTML, 'the drawing status banner came off every sheet')
      .not.toMatch(/struct-review-banner|data-banner-phase-label="1"/);
  });
});

describe('a certification sheet carries one line per requirement', () => {
  // The requirement codes this package actually raises, read off the review
  // record (RS-1 ∪ RS-1.n). This is the surface that survived Ray's ruling
  // intact — RS-1 stays in the design-review profile and still lists every open
  // requirement in full — so it is where the claims below are anchored now.
  const liveCodes = (): string[] => {
    const rs1 = rs1Union(HTML);
    expect(rs1.length, 'RS-1 must render in the design-review profile').toBeGreaterThan(0);
    const codes = [...new Set([...rs1.matchAll(/data-release-requirement="([^"]+)"/g)].map(m => m[1]))];
    expect(codes.length, 'the fixture raises requirements to read').toBeGreaterThan(0);
    return codes;
  };

  it('no requirement line is a review-record paragraph, and none is truncated', () => {
    // 2026-08-29 - at least ONE certification page carries rows, not every one:
    // 'CERT' was removed from every requirement's affectedSheets because the
    // package does not contain a CERT sheet (the content merged into PE-1), so a
    // CERT page in the full profile now correctly owns nothing.
    //
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // The gate prints NO requirement rows at all any more — the whole bulleted
    // list came off the outbound letter with the box. So the row-shaped read
    // above found nothing and the length/truncation loop ran zero times. Both
    // halves are kept: the removal is pinned as an explicit ABSENCE on the cert
    // sheets, and the real property — one requirement is one SHORT DECLARED
    // LINE, never 200 characters of a moment-envelope derivation cut off
    // mid-sentence — is asserted on the declarations behind the codes this
    // package actually raises. That is where `sheetLine` is authored and where
    // a regression would be introduced.
    const pages = certPages(HTML);
    expect(pages.length, 'the fixture renders certification sheets').toBeGreaterThan(0);
    for (const page of pages) {
      expect(page, `${sheetIdOf(page)} must print no requirement rows`)
        .not.toMatch(/data-banner-requirement=/);
      expect(page, 'the 200-char explanation truncation must be gone')
        .not.toMatch(/full text on RS-1/);
    }
    for (const c of liveCodes()) {
      const line = REQUIREMENT_DECLARATIONS[c]?.sheetLine;
      // NON-VACUITY: an undefined line would make every check below pass.
      expect(line, `${c} has no declared sheet line to check`).toBeTruthy();
      expect(line!.length, `line too long for a sheet: ${line}`).toBeLessThanOrEqual(SHEET_LINE_MAX_CHARS + 12);
      expect(line!, 'the 200-char explanation truncation must be gone').not.toMatch(/full text on RS-1/);
      // A declared line is a CALLOUT, not a paragraph: no derivation may reach it.
      expect(line!, `${c} carries a derivation, not a callout`).not.toMatch(/w·L|in-lb|GOVERNING-CANDIDATE/i);
    }
  });

  it('no certification sheet prints an engineering derivation', () => {
    // The exact content that used to reach these sheets through `explanation`.
    //
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // This read the gate BOX, which is now an empty hidden div, so it passed
    // against ''. Retargeted to the whole certification SHEET — which is what
    // the case has always been named for, and is strictly stronger: the
    // derivation ("M = w·L²/8", in-lb envelopes, the GOVERNING-CANDIDATE
    // shortlist) stays in the registry and prints in full on RS-1, never on
    // CERT / PE-1.
    const pages = certPages(HTML);
    expect(pages.length, 'the fixture renders certification sheets').toBeGreaterThan(0);
    for (const page of pages) {
      expect(text(page), `${sheetIdOf(page)} prints an engineering derivation`)
        .not.toMatch(/w·L|in-lb|GOVERNING-CANDIDATE/i);
    }
    // 🚨 NON-VACUITY: the absence above is only evidence if the derivation
    // genuinely exists in this package. It does — on the review record.
    expect(text(rs1Union(HTML)), 'the derivation must still be recorded on RS-1')
      .toMatch(/GOVERNING-CANDIDATE/);
  });

  it('an advisory is labelled as one', () => {
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // Advisory ROWS came off the cert gate with the rest of the box, so the
    // `data-banner-advisory` read found nothing. The property is unchanged — an
    // advisory (the unpinned rail SKU) must never be presented as a blocking
    // requirement — and it is asserted where the advisory still prints: the
    // RS-1 registry row, which carries it in its own markup AND in a visible
    // badge. The cert-sheet removal is pinned as an absence.
    const pages = certPages(HTML);
    expect(pages.length, 'the fixture renders certification sheets').toBeGreaterThan(0);
    for (const page of pages) {
      expect(page, `${sheetIdOf(page)} must print no advisory rows`).not.toMatch(/data-banner-advisory=/);
    }
    const rs1 = rs1Union(HTML);
    expect(rs1.length, 'RS-1 must render in the design-review profile').toBeGreaterThan(0);
    const adv = [...rs1.matchAll(/<tr data-release-requirement="([^"]+)" data-finding-type="ADVISORY"[\s\S]*?<\/tr>/g)];
    expect(adv.length, 'the fixture carries the rail advisory').toBeGreaterThan(0);
    for (const a of adv) {
      expect(a[0], `${a[1]} must be TREATED as an advisory`).toContain('data-finding-treatment="advisory"');
      expect(text(a[0]), `${a[1]} must READ as an advisory`).toMatch(/ADVISORY/);
    }
    // …and it is the rail SKU, not some other row that happens to be advisory.
    expect(adv.map(a => a[1])).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
  });

  it('every requirement code this package raises has a declared sheet line', () => {
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // "every code a cert gate can print" has no referent: the cert gate prints
    // no codes. The property — a requirement never falls back to naming itself
    // on a sheet, because a declared one-line `sheetLine` exists for it — is
    // unchanged and reads STRONGER over the whole package, so the codes now come
    // from the review record (RS-1 ∪ RS-1.1 — the registry paginates, and a
    // lookup against RS-1 alone would have missed three of the five here).
    for (const c of liveCodes()) {
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
  /** the PE letter itself — the certification sheet that carries the ENGINEER'S
   *  CERTIFICATION STATEMENT, which is V13's anchor since 2026-09-18. CERT does
   *  not carry one, so a case about the statement must render on this sheet. */
  const realPeLetter = (): string => {
    const p = certPages(HTML).find(x => /data-cert-statement="1"/.test(x));
    expect(p, 'a real unapproved PE letter carrying the certification statement').toBeTruthy();
    return p!;
  };

  it('PASSES on the real unapproved certification sheet', () => {
    expect(certGateViolationReason(realCertPage())).toBeNull();
  });

  it('FIRES when the gate marker is removed entirely', () => {
    // The old literal check could MISS this: 'PENDING ENGINEERING REVIEW' is a
    // legal projectAuthority.issueStatus and the revision block prints it, so a
    // sheet stripped of its gate could still satisfy V13.
    //
    // RAY'S RULING 2026-09-18 — the visible gate BOX is gone; what remains is
    // the hidden state MARKER, and the predicate's wording followed it
    // ('lacks the certification state marker'). Same defect, same firing.
    const real = realCertPage();
    const stripped = real.replace(/data-cert-gate="1"/, 'data-cert-gate="0"');
    // NON-VACUITY: prove the mutation bit. A replace that matched nothing would
    // leave a page that legitimately passes, and this case would assert nothing.
    expect(stripped, 'the real page must carry the marker to begin with').not.toBe(real);
    expect(certGateViolationReason(stripped)).toMatch(/lacks the certification state marker/);
  });

  it('FIRES when an unapproved gate claims ISSUED FOR PERMIT', () => {
    expect(certGateViolationReason(realCertPage().replace(/data-release-phase="[A-Z_]+"/, 'data-release-phase="ISSUED_FOR_PERMIT"')))
      .toMatch(/ISSUED_FOR_PERMIT/);
  });

  it('FIRES when an unapproved sheet carries an affirmative engineer certification', () => {
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // This case dropped the literal 'NOT FOR PERMIT SUBMISSION' from the page
    // and expected V13 to fire. That literal is off the outbound certification
    // sheets (pinned as an absence in the first describe), and V13 no longer
    // requires it anywhere — so the mutation now changes nothing and the case
    // had no referent.
    //
    // It is replaced by the thing V13 actually exists to stop, tested directly:
    // an UNAPPROVED sheet that makes an affirmative certification claim. Every
    // "I, the undersigned, … hereby certify" block is tagged
    // data-cert-asserted="1" and is gated on certificationApproved(), so leaking
    // one onto an unapproved sheet is precisely the catastrophe. This is a
    // STRONGER test than the one it replaces: the old literal was satisfiable
    // page-wide by any unrelated paragraph, while this reads the certification
    // block's own declaration. The marker is injected into a REAL rendered PE
    // letter — not a hand-built string — so the mutation is one the renderer
    // could actually produce.
    const real = realPeLetter();
    expect(real, 'the real letter must assert nothing').toContain('data-cert-asserted="0"');
    expect(certGateViolationReason(real), 'and so V13 passes on it untouched').toBeNull();
    const leaked = real.replace(/data-cert-asserted="0"/g, 'data-cert-asserted="1"');
    // NON-VACUITY: prove the mutation bit before reading the verdict.
    expect(leaked, 'the injection must have changed the page').not.toBe(real);
    expect(certGateViolationReason(leaked)).toMatch(/affirmative engineer certification/);
  });

  it('does NOT fire merely because the issue state is worded differently', () => {
    // The old predicate failed a package in 'PENDING STRUCTURAL REVIEW' — an
    // honest, legal issue state — while it carried a perfectly correct gate.
    expect(certGateViolationReason(realCertPage().replace(/PENDING ENGINEERING REVIEW/g, 'PENDING STRUCTURAL REVIEW'))).toBeNull();
  });
});
