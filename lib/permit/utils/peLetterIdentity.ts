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
  // RAY'S RULING 2026-09-18 — the red sub-heading "PENDING PROFESSIONAL APPROVAL
  // — NOT A LETTER OF COMPLIANCE" came off. The heading already says STRUCTURAL
  // ENGINEERING REVIEW (not LETTER OF COMPLIANCE — the approved set uses that
  // title, and the identity swap IS the distinction), and the certification
  // statement in the signature area states exactly what is and is not asserted.
  // Repeating it in red under the title told the engineer he is the engineer.
  headingQualifier: '',
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
// ── V13, RETARGETED 2026-09-18 (RAY'S RULING) ──────────────────────────────
// V13 exists to stop ONE thing: an unapproved certification sheet going out
// looking certified. That property is unchanged and is enforced more directly
// here than it was before.
//
// It used to require the literal 'NOT FOR PERMIT SUBMISSION' anywhere on the
// page. Two problems with that, one of them ours:
//   1. It was satisfiable PAGE-WIDE, so the string could come from anywhere on
//      the sheet while the certification statement itself said nothing — the
//      absence-keyed vacuity this codebase has been burned by repeatedly.
//   2. It forced a red not-for-submission banner onto the top of the very
//      document we send an engineer TO BE STAMPED. Ray ruled that off the set;
//      an invariant is not a reason to keep printing it, because the invariant
//      is ours to state correctly.
//
// It now anchors on the ENGINEER'S CERTIFICATION STATEMENT — the letter's own
// body, in the signature area, which is where a reviewer actually looks and
// which must be present on any certification sheet whatever its state. The
// sheet must declare, in machine-readable form, whether certification is
// ASSERTED, and that declaration must agree with the release phase.
export function certGateViolationReason(page: string): string | null {
  const gate = /data-cert-gate="1"[^>]*data-release-phase="([A-Z_]+)"/.exec(page);
  if (!gate) return 'lacks the certification state marker';
  // THE AFFIRMATIVE CLAIM IS THE THING TO CATCH. Every block on a cert sheet
  // that actually asserts certification ("I, the undersigned, … hereby certify")
  // is tagged data-cert-asserted="1", and every such block is gated on
  // certificationApproved(). So if ONE of them ever leaks onto a sheet with no
  // approval covering the current digest, it announces itself here.
  //
  // This is a stronger test than the literal-string check it replaces: that one
  // was satisfied by the phrase 'NOT FOR PERMIT SUBMISSION' appearing ANYWHERE
  // on the page, so it could pass off an unrelated paragraph while the
  // certification block said whatever it liked.
  if (/data-cert-asserted="1"/.test(page)) {
    return 'is unapproved but carries an affirmative engineer certification';
  }
  if (gate[1] === 'ISSUED_FOR_PERMIT') {
    return `is unapproved but its state reads "${gate[1]}"`;
  }
  return null;
}
