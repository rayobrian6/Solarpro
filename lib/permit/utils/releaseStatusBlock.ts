// ═══════════════════════════════════════════════════════════════════════════
// RGM §6 — THE COVER RELEASE-STATUS BLOCK.
//
// What it replaces: the cover printed the structural-review banner's blocker
// LIST — eight verbatim blocker messages plus "+ 11 more active release
// blockers". A reviewer's first impression of the package was therefore
// "nineteen unrelated engineering failures", when the truth is SEVEN unresolved
// root release gates that CONTAIN those nineteen requirements.
//
// What it prints instead (§6): the release headline in gate semantics, the
// PENDING ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION identity (unchanged —
// nothing is weakened), the OPEN root gates NUMBERED with their own child
// counts, an explicit pointer "SEE RS-1 FOR ALL <n> REQUIREMENTS", and — only
// when one actually exists — the single most severe CONFIRMED condition
// (technical conflict / verified deficiency by the model's finding-type
// precedence). It never duplicates the registry: no requirement text is
// reproduced here, and RS-1 remains the one place every requirement is listed.
//
// Every value is read from the canonical release-gate model
// (projectReleaseGatesFromInput). Nothing is counted, grouped or re-worded here.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import {
  projectReleaseGatesFromInput, releaseHeadline, openReleaseGates, topConfirmedConflict,
} from '../snapshot/releaseGates';
import {
  deriveReleasePhase, RELEASE_PHASE_STYLE, submissionLine, type ReleasePhase,
} from '../snapshot/releasePhase';
import { peekSnapshot } from '../snapshot/read';
import { escapeH } from './drawing';
import { sheetRef } from './sheetRef';
import {
  resolvePlansetProfile, isCompactProfile, permitSubmissionPreviewState, PROFILE_DISPLAY_NAMES,
} from '../plansetProfile';

const FINDING_LABEL: Record<string, string> = {
  TECHNICAL_CONFLICT: 'TECHNICAL CONFLICT',
  VERIFIED_DEFICIENCY: 'VERIFIED DEFICIENCY',
};

/**
 * The cover's §6 release-status block. Returns '' when the package has no open
 * release gate AND the snapshot reports ready (nothing to state) — the same
 * show-gate discipline the retired banner used, so a clean package does not
 * grow a banner it never had.
 */
export function releaseStatusBlockHtml(input: PermitInput, opts?: { compact?: boolean }): string {
  const snap = peekSnapshot(input);
  const model = projectReleaseGatesFromInput(input);
  const open = openReleaseGates(model);
  const notReady = snap ? snap.permitReadiness.ready === false : false;
  if (!open.length && !notReady) return '';

  const total = model.summary.unresolvedRequirementCount + model.summary.advisoryCount;

  // ══ WHERE THE PACKAGE ACTUALLY IS ══════════════════════════════
  // Both branches below used to open with a hardcoded pair of lines — the count
  // headline, then "PENDING ENGINEERING REVIEW — NOT FOR PERMIT SUBMISSION" — in
  // the same red whatever the package's actual state. A set missing ten facts
  // and a set that is finished and waiting on a signature read identically.
  //
  // The phase is now derived (lib/permit/snapshot/releasePhase.ts) and LEADS:
  // one actionable sentence, coloured by whether the state is a defect or a
  // correct workflow step. The counts and the gate names stay — underneath,
  // where they inform rather than alarm.
  const phase = deriveReleasePhase({
    model,
    reviewCoversCurrentDigest: model.issueStatePredicates.professionalReleaseComplete,
    gatePasses: model.issueStatePredicates.readyForPermitSubmission,
    hasDesign: (snap?.derived?.moduleCount ?? 0) > 0,
  });
  const style = RELEASE_PHASE_STYLE[phase.kind];

  // ── AAC WS-10 — the PERMIT profile prints ONE concise release status ───────
  // The gate-count line, the open gates named, and one pointer to the in-app
  // review record (RS-1 is not in the permit set, so pointing at it would be a
  // dangling reference). Nothing is softened: the same headline, the same
  // PENDING ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION identity, the same
  // counts, and every open gate is still named. What is dropped is the repeated
  // HIERARCHY explanation — that lesson belongs in the review record, not on
  // every submittal.
  const _profile = resolvePlansetProfile(input);
  if (isCompactProfile(_profile)) {
    const names = open.map(g => `${escapeH(g.title)} (${g.unresolvedCount})`).join(' &nbsp;·&nbsp; ');
    // Post-AAC profile contract — the profile distinction is EXPLICIT on the
    // artifact: the block names the output profile, and a PERMIT_SUBMISSION
    // package generated while the engineering review is pending is marked a
    // NON-SUBMITTABLE PREVIEW (never silently emitted as the submittal).
    const _preview = permitSubmissionPreviewState(input).isPreview;
    // THE POINTER NAMES WHAT THIS PACKAGE ACTUALLY CONTAINS. This hardcoded
    // "SEE THE PROJECT REVIEW RECORD IN THE APPLICATION" on every compact
    // profile - and the application has no such screen: no API returns
    // permitReadiness.registry and no component renders it. RS-1 is back in the
    // design-review set, so `sheetRef` resolves to "see sheet RS-1"; on the AHJ
    // permit submittal, which correctly omits our internal review record, it
    // still falls back to the application wording rather than a dangling
    // reference to a sheet the reader does not have.
    const _rs = sheetRef(input, 'review-status');
    const _profileLine = _preview
      ? `OUTPUT PROFILE: ${PROFILE_DISPLAY_NAMES[_profile]} &mdash; NON-SUBMITTABLE PREVIEW (ENGINEERING REVIEW PENDING)`
      : `OUTPUT PROFILE: ${PROFILE_DISPLAY_NAMES[_profile]}${_profile === 'design-review' ? ' &mdash; NOT FOR PERMIT SUBMISSION' : ''}`;
    return `
  <div class="release-status-block" data-release-status-block="1" data-release-status-profile="${_profile}"${_preview ? ' data-permit-submission-preview="1"' : ''}
       data-release-phase="${phase.id}" data-release-phase-kind="${phase.kind}"
       style="margin:${opts?.compact ? '4px 0' : '6px 0'};border:2px solid ${style.border};background:${style.bg};padding:${opts?.compact ? '4px 8px' : '8px 12px'};page-break-inside:avoid;">
    <div data-release-phase-label="1" style="font-weight:900;font-size:12.5px;letter-spacing:0.6px;color:${style.fg};text-align:center;">
      ${escapeH(phase.label)}
    </div>
    <div data-release-phase-statement="1" style="font-weight:700;font-size:9px;line-height:1.3;color:${style.fg};text-align:center;margin-top:1px;">
      ${escapeH(phase.statement)}
    </div>
    <div data-release-submission-line="1" style="font-weight:900;font-size:8.5px;letter-spacing:0.6px;color:${style.fg};text-align:center;margin-top:1px;">
      ${escapeH(submissionLine(phase))}
    </div>
    <div data-release-output-profile="${_profile}" style="font-weight:900;font-size:8.5px;letter-spacing:0.5px;color:#111;text-align:center;margin-top:1px;">
      ${_profileLine}
    </div>
    <div data-release-headline="1" style="font-size:8px;color:${style.fg};text-align:center;line-height:1.3;margin-top:2px;">
      <span data-release-open-gate-count="${model.summary.openGateCount}" style="font-weight:900;">${model.summary.openGateCount}</span> open release gate${model.summary.openGateCount === 1 ? '' : 's'}
      / <span data-release-requirement-count="${model.summary.unresolvedRequirementCount}" style="font-weight:900;">${model.summary.unresolvedRequirementCount}</span> unresolved requirement${model.summary.unresolvedRequirementCount === 1 ? '' : 's'}
      &mdash; ${names || '—'}
    </div>
    <div data-release-record-pointer="1"${_rs.present ? ` data-release-record-sheet="${_rs.sheetId}"` : ''} style="margin-top:2px;font-weight:900;font-size:8.5px;letter-spacing:0.5px;color:#111;text-align:center;">
      ${escapeH(_rs.see.toUpperCase())} FOR ALL ${total} ITEM${total === 1 ? '' : 'S'} AND THEIR RESOLUTION EVIDENCE
    </div>
  </div>`;
  }

  // the OPEN gates, NUMBERED, each with its own unresolved child count. Two
  // columns so seven gates cost four lines on a dense cover sheet.
  const gateItems = open.map((g, i) => `
        <div data-release-open-gate="${g.gateId}" style="display:flex;gap:4px;align-items:baseline;">
          <span style="font-weight:900;font-size:8.5px;min-width:11px;">${i + 1}.</span>
          <span style="font-weight:900;font-size:8.5px;letter-spacing:0.3px;">${escapeH(g.title)}</span>
          <span style="font-size:7.5px;color:#7f1d1d;white-space:nowrap;">(${g.unresolvedCount} REQ)</span>
        </div>`).join('');

  // §6 — the most severe CONFIRMED condition, when the package carries one. A
  // package of pending authorities prints NO conflict line: an unestablished
  // authority is never presented as a confirmed failure (§7).
  const conflict = topConfirmedConflict(model);
  const conflictLine = conflict ? `
      <div data-release-top-conflict="${escapeH(conflict.requirementCode)}" style="margin-top:2px;border-left:5px double #000;background:#e4e4e4;padding:1px 6px;">
        <span style="font-weight:900;font-size:8px;letter-spacing:0.4px;text-decoration:underline;color:#7f1d1d;">MOST SEVERE CONFIRMED CONDITION &mdash; ${escapeH(FINDING_LABEL[conflict.findingType] ?? conflict.findingType)}:</span>
        <span class="mono" style="font-weight:900;font-size:8px;">${escapeH(conflict.requirementCode)}</span>
        <span style="font-size:8px;">&mdash; ${escapeH(conflict.title)} (GATE ${escapeH(conflict.gateId)}; see RS-1)</span>
      </div>` : '';

  const pad = opts?.compact ? '4px 8px' : '8px 12px';
  return `
  <div class="release-status-block" data-release-status-block="1"
       data-release-phase="${phase.id}" data-release-phase-kind="${phase.kind}"
       style="margin:${opts?.compact ? '4px 0' : '6px 0'};border:2px solid ${style.border};background:${style.bg};padding:${pad};page-break-inside:avoid;">
    <div data-release-phase-label="1" style="font-weight:900;font-size:12.5px;letter-spacing:0.6px;color:${style.fg};text-align:center;">
      ${escapeH(phase.label)}
    </div>
    <div data-release-phase-statement="1" style="font-weight:700;font-size:8.5px;line-height:1.3;color:${style.fg};text-align:center;margin-top:1px;">
      ${escapeH(phase.statement)}
    </div>
    <div data-release-submission-line="1" style="font-weight:900;font-size:8.5px;letter-spacing:0.6px;color:${style.fg};text-align:center;margin-top:1px;">
      ${escapeH(submissionLine(phase))}
    </div>
    <div data-release-headline="1" style="font-size:7.2px;color:${style.fg};text-align:center;line-height:1.25;margin-top:1px;">
      <span data-release-open-gate-count="${model.summary.openGateCount}">${model.summary.openGateCount}</span> unresolved ROOT release gate${model.summary.openGateCount === 1 ? '' : 's'}
      contain <span data-release-requirement-count="${model.summary.unresolvedRequirementCount}">${model.summary.unresolvedRequirementCount}</span> unresolved requirement${model.summary.unresolvedRequirementCount === 1 ? '' : 's'}
      &mdash; not ${model.summary.unresolvedRequirementCount} unrelated engineering failures. A gate is OPEN while ANY of its child requirements is unresolved.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;margin-top:2px;">
      <div style="grid-column:1 / span 2;font-weight:900;font-size:8px;letter-spacing:0.8px;color:#111;border-top:1px solid #b91c1c;padding-top:1px;">OPEN RELEASE GATES</div>
      ${gateItems}
    </div>
    ${conflictLine}
    <div style="margin-top:2px;font-weight:900;font-size:8.5px;letter-spacing:0.6px;color:#111;text-align:center;">
      SEE RS-1 FOR ALL ${total} ITEM${total === 1 ? '' : 'S'}
    </div>
  </div>`;
}
