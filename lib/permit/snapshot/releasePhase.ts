// ═══════════════════════════════════════════════════════════════════════════
// releasePhase.ts — WHERE THE PACKAGE ACTUALLY IS.
//
// ── THE DEFECT ────────────────────────────────────────────────────────────
// Every unissued package printed the same sentence, in the same red, in the
// same place:
//
//     RELEASE STATUS — 6 OPEN RELEASE GATES / 6 UNRESOLVED REQUIREMENTS /
//     1 ADVISORY / NOT FOR PERMIT SUBMISSION
//     PENDING ENGINEERING REVIEW — NOT FOR PERMIT SUBMISSION
//
// Those two lines were hardcoded. A package missing ten facts and a package that
// is finished and waiting on a signature were indistinguishable — same words,
// same colour, same alarm. An unstamped engineering set is the TERMINAL state of
// a correct workflow, not a defect, and presenting it as one trains reviewers to
// ignore the banner that is supposed to stop them.
//
// ── THE FOUR PHASES ───────────────────────────────────────────────────────
//   DESIGN INCOMPLETE                 real data / engineering / software
//                                     requirements are outstanding
//   DESIGN COMPLETE —                 the design and its authority data are
//     AWAITING PROFESSIONAL REVIEW    finished; licensed review is next
//   REVIEWED —                        review covers the exact frozen digest;
//     AWAITING SIGNATURE / SEAL       formal release authority not established
//   ISSUED FOR PERMIT                 all release authority exists
//
// ── HOW THE LANE IS DECIDED ───────────────────────────────────────────────
// NOT from a hand-maintained list of codes — from the release-gate declaration
// each requirement already carries. A requirement belongs to the PROFESSIONAL
// lane when its finding type is PROFESSIONAL_RELEASE, or when its TERMINAL
// resolution mode (the residual if one is declared, else the primary) is
// PROFESSIONAL_APPROVAL. Everything else is a DESIGN requirement.
//
// That is deliberate. It means a new requirement lands in the right phase by
// declaring what it is, and it means the phase cannot drift from the release
// model the rest of the package is computed from.
//
// PURE + deterministic. Reads the model; counts, groups and words nothing twice.
// ═══════════════════════════════════════════════════════════════════════════
import {
  REQUIREMENT_DECLARATIONS, requirementLane,
  type ReleaseGateModel, type ReleaseRequirement,
} from './releaseGates';

export type ReleasePhaseId =
  | 'DESIGN_INCOMPLETE'
  | 'AWAITING_PROFESSIONAL_REVIEW'
  | 'AWAITING_SEAL_AND_ISSUE'
  | 'ISSUED_FOR_PERMIT';

// RequirementLane + requirementLane() MOVED to releaseGates.ts (2026-08-29):
// the release SUMMARY now counts by lane too, and releaseGates cannot import
// from this module without a cycle. It lives beside REQUIREMENT_DECLARATIONS,
// which is the table it reads. Re-exported here so every existing caller is
// unaffected and there is still exactly ONE implementation.
export { requirementLane, type RequirementLane } from './releaseGates';

/** How the phase should READ. A defect state warns; a workflow state informs; a
 *  released state states. The renderer takes its colour from this, so nothing
 *  downstream re-decides whether the package is in trouble. */
export type ReleasePhaseKind = 'defect' | 'workflow' | 'released';

export interface ReleasePhase {
  id: ReleasePhaseId;
  /** the phase name, as printed. */
  label: string;
  /** ONE actionable sentence. This is what a construction drawing carries. */
  statement: string;
  kind: ReleasePhaseKind;
  /** true ⇔ the package may be submitted to the AHJ. */
  submittable: boolean;
  /** open requirement codes in each lane, in model order. */
  designRequirementCodes: string[];
  professionalRequirementCodes: string[];
  advisoryCount: number;
  /** why this phase and not the next one — for the review record, never the drawing. */
  basis: string;
}

/** The requirement's short human title, for the one-sentence statement.
 *
 *  Declaration titles are written for the review record and run long ("project
 *  legal authority (address, APN, boundary, AHJ, fire) not verified from an
 *  official source"). A drawing gets the head of that clause — enough to name
 *  the thing, not enough to become a paragraph. The full title, the explanation
 *  and the evidence stay in the Project Review Record. Falls back to the code so
 *  a new requirement is never silently unnamed. */
function titleOf(r: ReleaseRequirement): string {
  const full = (r.title ?? REQUIREMENT_DECLARATIONS[r.requirementCode]?.title ?? r.requirementCode).trim();
  // cut at the first parenthetical or em-dash aside, then cap on a word boundary
  const head = full.split(/\s+\(|\s+—\s+/)[0].trim();
  if (head.length <= 46) return head;
  const cut = head.slice(0, 46);
  const sp = cut.lastIndexOf(' ');
  // 2026-08-29 - NO ELLIPSIS. The caller appends a full stop to the joined list,
  // so a truncated title produced "...engineering-review record....' on the cover
  // - an ellipsis immediately followed by a period. A clipped clause reads as a
  // clause; the full title is on RS-1 either way.
  return (sp > 20 ? cut.slice(0, sp) : cut).trim();
}

/** Join a few titles readably; beyond `max`, count the remainder rather than
 *  running a drawing line off the sheet. */
function listTitles(titles: string[], max = 3): string {
  if (titles.length === 0) return '';
  const lower = titles.map(t => t.charAt(0).toLowerCase() + t.slice(1));
  if (lower.length <= max) {
    return lower.length === 1 ? lower[0]
      : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
  }
  return `${lower.slice(0, max).join(', ')} and ${lower.length - max} more`;
}

export interface ReleasePhaseInput {
  model: ReleaseGateModel;
  /** does an approved engineering review cover the CURRENT snapshot digest? */
  reviewCoversCurrentDigest: boolean;
  /** every ISSUED-FOR-PERMIT precondition passes. */
  gatePasses: boolean;
  /** the design has real modules. An empty design is not "awaiting review". */
  hasDesign: boolean;
}

/**
 * Derive the release phase. Ordered so the FIRST true condition wins, and the
 * order is the workflow's own: you cannot be awaiting review while data is
 * missing, and you cannot be awaiting a seal while review is outstanding.
 */
export function deriveReleasePhase(input: ReleasePhaseInput): ReleasePhase {
  // BLOCKING only. An advisory is reported as a count, never as a thing that
  // holds the package in a phase — counting the rail-SKU advisory here made the
  // banner claim "5 design requirements outstanding" when four were.
  const open = input.model.requirements.filter(r => r.status === 'OPEN' && r.severity === 'blocking');
  const design = open.filter(r => requirementLane(r.requirementCode) === 'design');
  const professional = open.filter(r => requirementLane(r.requirementCode) === 'professional');
  const advisoryCount = input.model.summary.advisoryCount;

  const designCodes = design.map(r => r.requirementCode);
  const professionalCodes = professional.map(r => r.requirementCode);

  const make = (
    id: ReleasePhaseId, label: string, statement: string,
    kind: ReleasePhaseKind, submittable: boolean, basis: string,
  ): ReleasePhase => ({
    id, label, statement, kind, submittable,
    designRequirementCodes: designCodes,
    professionalRequirementCodes: professionalCodes,
    advisoryCount, basis,
  });

  if (!input.hasDesign) {
    return make('DESIGN_INCOMPLETE', 'DESIGN INCOMPLETE',
      'DESIGN INCOMPLETE — no modules are placed in this design.',
      'defect', false, 'the design carries no modules');
  }

  if (design.length > 0) {
    const what = listTitles(design.map(titleOf));
    // When professional items are ALSO outstanding, say so in the same breath:
    // the reader needs to know that closing the data does not release the set.
    const then = professional.length > 0
      ? ` Licensed review follows once these are closed.`
      : '';
    return make('DESIGN_INCOMPLETE', 'DESIGN INCOMPLETE',
      `DESIGN INCOMPLETE — ${design.length} design requirement${design.length === 1 ? '' : 's'} outstanding: `
      + `${what}.${then}`,
      'defect', false,
      `${design.length} open requirement(s) resolve by data, derivation, retrieval or operator entry `
      + `[${designCodes.join(', ')}]`);
  }

  if (!input.reviewCoversCurrentDigest) {
    const what = professional.length > 0 ? listTitles(professional.map(titleOf)) : 'engineering review';
    // 2026-08-29 - READY FOR, not AWAITING. Ray's ruling: the engineer-of-
    // record step is not a qualifier against us, and an unstamped set that owes
    // nothing else IS the finished product. The label states what the package
    // has ACHIEVED; the sentence still names exactly what the reviewer must do.
    return make('AWAITING_PROFESSIONAL_REVIEW', 'DESIGN COMPLETE — READY FOR PROFESSIONAL REVIEW',
      `DESIGN COMPLETE — no design requirement is outstanding. Ready for engineer-of-record review and seal: ${what}.`,
      // NOT a defect. Every design and authority requirement is closed; what
      // remains is a licensed professional's judgement, which is the next step
      // in a correct workflow rather than something wrong with the package.
      'workflow', false,
      'no design requirement is outstanding; no approved engineering review covers the current snapshot digest');
  }

  if (!input.gatePasses) {
    return make('AWAITING_SEAL_AND_ISSUE', 'REVIEWED — AWAITING SIGNATURE / SEAL / ISSUE',
      'REVIEWED — AWAITING SIGNATURE / SEAL / ISSUE. The review covers this exact design digest; '
      + 'formal release authority is not yet established.',
      'workflow', false,
      'an approved review covers the current digest, but an ISSUED-FOR-PERMIT precondition is unsatisfied');
  }

  return make('ISSUED_FOR_PERMIT', 'ISSUED FOR PERMIT',
    'ISSUED FOR PERMIT.', 'released', true,
    'review covers the current digest and every ISSUED-FOR-PERMIT precondition passes');
}

/** The palette a renderer takes from the phase. Kept here so no sheet decides
 *  independently whether the package looks alarming. */
export const RELEASE_PHASE_STYLE: Record<ReleasePhaseKind, { border: string; bg: string; fg: string }> = {
  // a real defect — the package is missing something
  defect: { border: '#b91c1c', bg: '#fef2f2', fg: '#b91c1c' },
  // a correct workflow state — informational, not an alarm
  workflow: { border: '#b45309', bg: '#fffbeb', fg: '#92400e' },
  released: { border: '#15803d', bg: '#f0fdf4', fg: '#166534' },
};

/** The secondary line. An unissued set is genuinely not submittable and must say
 *  so — but as a STATEMENT OF STATE, not as the headline, and never implying a
 *  defect when the package is merely awaiting a signature. */
export function submissionLine(phase: ReleasePhase): string {
  switch (phase.id) {
    case 'ISSUED_FOR_PERMIT':
      return 'RELEASED FOR PERMIT SUBMISSION';
    case 'AWAITING_SEAL_AND_ISSUE':
      return 'NOT FOR PERMIT SUBMISSION UNTIL SIGNED AND SEALED';
    case 'AWAITING_PROFESSIONAL_REVIEW':
      return 'NOT FOR PERMIT SUBMISSION UNTIL REVIEWED, SIGNED AND SEALED';
    default:
      return 'NOT FOR PERMIT SUBMISSION';
  }
}
