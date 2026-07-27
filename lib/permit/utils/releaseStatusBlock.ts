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
import { peekSnapshot } from '../snapshot/read';
import { escapeH } from './drawing';

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
       style="margin:${opts?.compact ? '4px 0' : '6px 0'};border:2px solid #b91c1c;background:#fef2f2;padding:${pad};page-break-inside:avoid;">
    <div data-release-headline="1" style="font-weight:900;font-size:12.5px;letter-spacing:0.6px;color:#b91c1c;text-align:center;">
      RELEASE STATUS &mdash; ${escapeH(releaseHeadline(model.summary))}
    </div>
    <div style="font-weight:900;font-size:10px;letter-spacing:0.6px;color:#b91c1c;text-align:center;margin-top:1px;">
      PENDING ENGINEERING REVIEW &mdash; NOT FOR PERMIT SUBMISSION
    </div>
    <div style="font-size:7.2px;color:#7f1d1d;text-align:center;line-height:1.25;margin-top:1px;">
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
      SEE RS-1 FOR ALL ${total} REQUIREMENT${total === 1 ? '' : 'S'}
    </div>
  </div>`;
}
