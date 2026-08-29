// ═══════════════════════════════════════════════════════════════
// TAC WS-16 — PE-1 SHEET IDENTITY + the digest-bound certification predicate.
//
// The sheet called itself a "PE STRUCTURAL LETTER OF COMPLIANCE" and headed
// itself "LETTER OF STRUCTURAL COMPLIANCE" from SIXTEEN independent literals
// (three render sites, six manifest sites, the cover narrative, the in-app
// index) — every one of them unconditional. A document is not a letter of
// compliance because a template says so; it is one when a licensed engineer has
// reviewed THIS snapshot digest and sealed it. Until that record exists the same
// pages are a structural engineering REVIEW sheet, and they must say so in their
// title block, their heading and every index that lists them.
//
// `certificationApproved` is the single digest-bound predicate; the title set is
// derived from it and NOWHERE else. Adding a surface that names this sheet means
// calling one of these accessors.
//
// LEAF MODULE — type-only imports. The sheet manifest (which a client page
// imports) resolves titles through here without pulling in the drafting engine.
// `utils/peLetter` re-exports everything below, so either import path works.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';

export interface PELetterTitleSet {
  /** title-block SHEET NAME */
  sheetTitle: string;
  /** manifest / cover sheet index (a family suffix may be appended) */
  manifestTitle: string;
  /** the large page heading */
  heading: string;
  /** the state qualifier printed under the heading; '' once approved */
  headingQualifier: string;
  /** prose noun for the sheet, for narrative references on other sheets */
  noun: string;
}

const PE_LETTER_TITLES_APPROVED: PELetterTitleSet = {
  sheetTitle: 'PE STRUCTURAL LETTER OF COMPLIANCE',
  manifestTitle: 'PE STRUCTURAL LETTER — LETTER OF COMPLIANCE',
  heading: 'LETTER OF STRUCTURAL COMPLIANCE',
  headingQualifier: '',
  noun: 'PE structural letter',
};

const PE_LETTER_TITLES_PENDING: PELetterTitleSet = {
  sheetTitle: 'STRUCTURAL ENGINEERING REVIEW SHEET — PENDING',
  manifestTitle: 'STRUCTURAL ENGINEERING REVIEW — PENDING PROFESSIONAL APPROVAL',
  heading: 'STRUCTURAL ENGINEERING REVIEW',
  headingQualifier: 'PENDING PROFESSIONAL APPROVAL — NOT A LETTER OF COMPLIANCE',
  noun: 'PE structural review sheet',
};

export const PE_LETTER_TITLES = {
  approved: PE_LETTER_TITLES_APPROVED,
  pending: PE_LETTER_TITLES_PENDING,
} as const;

/** D-6 (Ray, binding 2026-07-20) / snapshot V13 / W4 correction Section 2:
 *  certification language may activate ONLY when the snapshot carries an
 *  approved engineering-review record covering the CURRENT digest plus complete
 *  engineer identity. Until that exists every CERT/PE sheet renders a DISABLED
 *  pending-review TEMPLATE — no "I hereby certify", "prepared under my
 *  supervision", "confirmed adequate" or equivalent affirmative conclusion may
 *  appear. This is the single predicate every affirmative block gates on, and
 *  (TAC WS-16) the predicate the sheet's own IDENTITY derives from. */
export function certificationApproved(input: PermitInput): boolean {
  const s = (input as unknown as {
    _snapshot?: { meta?: { digest?: string };
      certification?: { engineeringReviewApproved: false | { reviewedDigest: string }; engineer: unknown } };
  })._snapshot;
  const cert = s?.certification;
  return !!(cert && cert.engineeringReviewApproved
    && typeof cert.engineeringReviewApproved === 'object'
    && cert.engineeringReviewApproved.reviewedDigest === s?.meta?.digest
    && cert.engineer);
}

/** The title set for a KNOWN approval state (manifest builders hold the boolean
 *  rather than the input). */
export function peLetterTitles(approved: boolean): PELetterTitleSet {
  return approved ? PE_LETTER_TITLES_APPROVED : PE_LETTER_TITLES_PENDING;
}

/** The title set for a rendering sheet — derived from the snapshot itself. */
export function peLetterTitlesFromInput(input: PermitInput): PELetterTitleSet {
  return peLetterTitles(certificationApproved(input));
}

/** Title-block SHEET NAME for PE-1 / PE-1G / PE-1F. */
export function peLetterSheetTitle(input: PermitInput): string {
  return peLetterTitlesFromInput(input).sheetTitle;
}

/** Manifest / cover-index title. `suffix` carries the hybrid family label
 *  (' — GROUND'), unchanged from the pre-WS-16 call sites. */
export function peLetterManifestTitle(approved: boolean, suffix = ''): string {
  return `${peLetterTitles(approved).manifestTitle}${suffix}`;
}

/** The heading block every family letter opens with. `subject` is the family
 *  line ("Solar Photovoltaic System &mdash; Roof-Mounted Array"); `codeLine` is
 *  the "Prepared under …" line. Pending state gets an explicit disclaimer line
 *  so the heading can never be read as a compliance conclusion. */
export function peLetterHeadingBlock(input: PermitInput, subject: string, codeLine: string): string {
  const approved = certificationApproved(input);
  const t = peLetterTitles(approved);
  // TAGGED (data-pe-letter-heading / -state): the sheet's identity is the thing
  // under audit, so it carries a machine-readable state stamp. Anchor tests and
  // evidence harnesses on the attribute, never on the title text — the title
  // text is precisely what changes with the approval state.
  return `<div class="f-3xl fw9" style="letter-spacing:1px;" data-pe-letter-heading="1" data-pe-letter-state="${approved ? 'approved' : 'pending'}">${t.heading}</div>
        ${t.headingQualifier ? `<div class="f-sm fw9" style="color:#b00000;letter-spacing:0.6px;margin-top:1px;">${t.headingQualifier}</div>` : ''}
        <div class="f-lg c555 mt-xs">${subject}</div>
        <div class="f-sm muted">${codeLine}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CERTIFICATION GATE PREDICATE (invariant V13's reader)
//
// V13 used to assert the literal 'PENDING ENGINEERING REVIEW' appeared
// somewhere on an unapproved CERT / PE-1 page. That was never a sound test.
// The revision block on the SAME sheet prints `projectAuthority.issueStatus`,
// and that exact string is one of its eight legal values -- so a cert sheet
// that had lost its gate banner entirely could still satisfy V13 off a
// title-block field, while a sheet in a different but perfectly honest state
// ('PENDING STRUCTURAL REVIEW') failed it while carrying a correct gate.
//
// It lives HERE, next to certificationApproved(), so the invariant and its
// tests read the same function. A test that re-implements the predicate proves
// only its own copy -- exactly the closed loop this file exists to avoid.
// ═══════════════════════════════════════════════════════════════════════════

/** Why this unapproved certification page violates V13, or null if it does not.
 *  Reads the rendered page, which is what the invariant itself has to work
 *  from -- the gate is HTML by the time V13 runs. */
export function certGateViolationReason(page: string): string | null {
  const gate = /data-cert-gate="1"[^>]*data-release-phase="([A-Z_]+)"/.exec(page);
  if (!gate) return 'lacks the certification gate banner';
  // A gate that says the package is issued, on a sheet with no approval
  // covering the digest, is the affirmative lie V13 exists to stop.
  if (gate[1] === 'ISSUED_FOR_PERMIT' || !page.includes('NOT FOR PERMIT SUBMISSION')) {
    return `is unapproved but its gate reads "${gate[1]}" without a not-for-submission statement`;
  }
  return null;
}
