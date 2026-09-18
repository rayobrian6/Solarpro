// ═══════════════════════════════════════════════════════════════════════════
// THE COVER RELEASE-STATUS PROVENANCE BLOCK — MACHINE-READABLE, NOT PRINTED.
//
// HISTORY. This began as RGM §6, the block that replaced the cover's flat
// blocker LIST (eight verbatim messages + "+ 11 more active release blockers",
// which read as nineteen unrelated engineering failures rather than seven root
// gates containing nineteen requirements). That was a real improvement to how
// our internal bookkeeping READ — but it was still our internal bookkeeping,
// printed on the cover of an outbound drawing set.
//
// 2026-09-18 — RAY'S RULING: it comes off the sheet entirely. The planset is
// sent to a licensed engineer, a client and an AHJ; the engineer cannot strip
// our boxes, so whatever we print ships permanently. See the doc comment on
// releaseStatusBlockHtml below for the ruling and for what replaced it.
//
// The block still EXISTS and still reads the canonical release-gate model
// (projectReleaseGatesFromInput) — it emits every `data-release-*` attribute it
// ever carried, and nothing else. Zero text nodes. The place a human reads this
// information is RS-1 / RS-1.1, the internal design-review record.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import { projectReleaseGatesFromInput, openReleaseGates } from '../snapshot/releaseGates';
import { releasePhaseFor } from '../snapshot/releasePhase';
import { peekSnapshot } from '../snapshot/read';
import { escapeH } from './drawing';
import { sheetRef } from './sheetRef';
import { resolvePlansetProfile, isCompactProfile, permitSubmissionPreviewState } from '../plansetProfile';

/**
 * The cover's release-status PROVENANCE block. Returns '' when the package has
 * no open release gate AND the snapshot reports ready — the same show-gate
 * discipline as before.
 *
 * ── RAY'S RULING, 2026-09-18 — THIS BLOCK NO LONGER PRINTS ────────────────
 *     "There is no reason whatsoever to be looking at a fucking release gate.
 *      That is beyond ridiculous. Also, the design complete box. Needs to go!
 *      The engineer isn't going to remove it. How do we expect to send this off
 *      and it come with a 'Design complete' still on it."
 *
 * This block used to print the package's release bookkeeping on the COVER of a
 * set that is sent to a licensed engineer, then to a client and an AHJ: the
 * phase label (DESIGN INCOMPLETE / DESIGN COMPLETE — READY FOR PROFESSIONAL
 * REVIEW), the gate and requirement counters, the output profile, and a pointer
 * at our internal review record. The engineer cannot strip our boxes — whatever
 * we print ships on that document permanently. Release-gate bookkeeping is an
 * internal workflow artifact and has no business on an outbound drawing set.
 *
 * NOTHING IS HIDDEN AND NOTHING IS WEAKENED:
 *   - RS-1 / RS-1.1 — the internal design-review record, already excluded from
 *     the AHJ permit profile by sheetManifest — still carry every gate, every
 *     requirement and its resolution evidence, in full.
 *   - Every machine-readable `data-release-*` attribute this block ever carried
 *     is STILL EMITTED HERE, so the four evidence harnesses that read the cover
 *     (planset-evidence rgm / ecd / ppc / bar) keep their anchor.
 * What changed is that the block renders NO VISIBLE TEXT.
 *
 * Two deliberate fixes came with the rewrite:
 *   1. `data-release-open-gate` is now emitted on EVERY profile. The compact
 *      branch never emitted it, so the harnesses counting it on the cover were
 *      reading ZERO on exactly the profile we ship.
 *   2. The per-gate child count is `data-release-gate-requirement-count`, NOT
 *      `data-release-open-gate-count`. The old pair would both match a harness
 *      regex for `data-release-open-gate-count="(\d+)"`.
 */
export function releaseStatusBlockHtml(input: PermitInput, opts?: { compact?: boolean }): string {
  const snap = peekSnapshot(input);
  const model = projectReleaseGatesFromInput(input);
  const open = openReleaseGates(model);
  const notReady = snap ? snap.permitReadiness.ready === false : false;
  if (!open.length && !notReady) return '';

  const total = model.summary.unresolvedRequirementCount + model.summary.advisoryCount;
  const phase = releasePhaseFor(model, snap);
  const _profile = resolvePlansetProfile(input);
  const _preview = permitSubmissionPreviewState(input).isPreview;
  const _rs = sheetRef(input, 'review-status');

  // One hidden, EMPTY element per open root gate — the anchor the evidence
  // harnesses count. No text node, so nothing reaches the sheet.
  const gateAnchors = open.map(g =>
    `<span data-release-open-gate="${escapeH(g.gateId)}"`
    + ` data-release-open-gate-title="${escapeH(g.title)}"`
    + ` data-release-gate-requirement-count="${g.unresolvedCount}"></span>`).join('');

  // 🚨 THE COUNTER SEMANTICS ARE PROFILE-DEPENDENT, AND MUST STAY THAT WAY.
  // The two printed branches this replaced did NOT emit the same numbers:
  //   compact  (permit / design-review) -> openDesignGateCount / designRequirementCount
  //   full     (internal)               -> openGateCount       / unresolvedRequirementCount
  // The compact pair deliberately counts only the DESIGN lane, so a package that
  // owes nothing but a seal does not read as unresolved (2026-08-29). The full
  // profile states the whole model. Collapsing them onto one pair silently
  // re-numbers the cover for the internal profile, which is what the
  // cover-equals-RS-1 gate measures — so the split is preserved verbatim.
  // `data-release-design-complete` stays PRESENCE-keyed, as before — emitted
  // only when the design is genuinely complete, never as ="0".
  const _compact = isCompactProfile(_profile);
  const _gateCount = _compact ? model.summary.openDesignGateCount : model.summary.openGateCount;
  const _reqCount = _compact ? model.summary.designRequirementCount : model.summary.unresolvedRequirementCount;
  return `
  <div class="release-status-block" data-release-status-block="1" data-release-status-profile="${_profile}"${_preview ? ' data-permit-submission-preview="1"' : ''}
       data-release-phase="${phase.id}" data-release-phase-kind="${phase.kind}"
       data-release-open-gate-count="${_gateCount}"
       data-release-requirement-count="${_reqCount}"
       data-release-professional-count="${model.summary.professionalRequirementCount}"${model.summary.designComplete ? ' data-release-design-complete="1"' : ''}
       data-release-total-item-count="${total}"${_rs.present ? ` data-release-record-sheet="${_rs.sheetId}"` : ''}
       style="display:none;">${gateAnchors}</div>`;
}
