// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-10 — PLANSET OUTPUT PROFILE.  (+ post-AAC regression repair: the
// DESIGN_REVIEW profile and the explicit three-profile output contract.)
//
// THE PROBLEM the profile solves: one page set was serving two different
// readers. The AHJ plan reviewer needs the drawings; the internal reviewer
// needs the resolver evidence, the release registry, the full BOM and the
// certification placeholders. Printing both audiences onto one submittal made
// the permit set grow every time the engine learned to say something new —
// exactly backwards from the directive's rule 9 ("the planset must get SMALLER
// as automation improves").
//
// THE PROFILE IS A COMPOSITION DECISION, NOT A TRUTH DECISION:
//   • the SNAPSHOT is profile-independent. The release registry, every
//     requirement, every gate, every piece of resolver evidence and the BOM are
//     built identically under all profiles and stay snapshot-bound. Removing a
//     PAGE never removes a REQUIREMENT (proved by the registry-integrity test).
//   • 'full' (FULL_INTERNAL) — the internal package: every sheet the engine can
//     draw, including RS-1(.n) review status, SCHED continuations, APP-A, the
//     CERT / PE-1 certification placeholders in their CURRENT state and the
//     DS-n datasheets inline. This is what the in-app viewer, the goldens and
//     the RGM/ECD/BAR evidence harnesses consume; byte-identical to pre-WS-10.
//   • 'design-review' (DESIGN_REVIEW) — the compact drawing set PLUS PE-1 as
//     the FINAL engineer-review sheet. PE-1 in this profile is the unsigned
//     review document: it states PENDING ENGINEERING REVIEW, asserts no
//     certification, carries the project-specific structural results and the
//     blank engineer/signature/seal fields, is bound to the current snapshot
//     digest, and the package is marked NOT FOR PERMIT SUBMISSION.
//   • 'permit' (PERMIT_SUBMISSION) — the AHJ submittal: the compact drawing set
//     plus a MANUFACTURER ATTACHMENT appendix. CERT/PE-1 appear ONLY when a
//     digest-bound engineering approval covers this snapshot. While the review
//     is pending this profile may only be produced as an explicitly-marked
//     NON-SUBMITTABLE PREVIEW (see permitSubmissionPreviewState) — it is never
//     emitted silently as if it were the submittal.
//     Unresolved work is NOT hidden under any profile: the cover carries one
//     concise release-status line naming every open gate and the requirement
//     count, and the per-sheet banner survives on sheets whose OWN content is
//     gated (see sheetIsDirectlyGated).
//
// DEFAULTS: the library default is 'full' (no caller changes behaviour by
// accident). The permit ARTIFACT — the HTML/PDF the permit route emits — asks
// for 'design-review' explicitly while the engineering review is pending;
// callers may pass `plansetProfile` to select any profile.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from './types';
import type { PermitReadinessBlocker } from './snapshot/types';
import { peekSnapshot } from './snapshot/read';

export type PlansetProfile = 'permit' | 'full' | 'design-review';

/** The engine default — unchanged behaviour for every existing caller. */
export const DEFAULT_PLANSET_PROFILE: PlansetProfile = 'full';

/** The default for the PERMIT ARTIFACT (the route's HTML/PDF deliverable).
 *  DESIGN_REVIEW: the compact set with PE-1 as the final engineer-review sheet.
 *  A caller that explicitly wants the PERMIT_SUBMISSION output asks for
 *  'permit' — and while the review is pending gets the marked preview. */
export const PERMIT_ARTIFACT_PROFILE: PlansetProfile = 'design-review';

/** Display names for the printed OUTPUT PROFILE line — the human-readable
 *  contract names. One map so every surface prints the same words. */
export const PROFILE_DISPLAY_NAMES: Record<PlansetProfile, string> = {
  'full': 'FULL INTERNAL',
  'design-review': 'DESIGN REVIEW',
  'permit': 'PERMIT SUBMISSION',
};

interface ProfileCarrier {
  plansetProfile?: PlansetProfile;
  permitOptions?: { plansetProfile?: PlansetProfile } | null;
  planSetOptions?: { plansetProfile?: PlansetProfile } | null;
}

/** Read the requested profile off the input. Unknown/absent ⇒ the engine
 *  default. ONE reader so the manifest, the page assembly, the cover and the
 *  banner can never disagree about which profile is being generated. */
export function resolvePlansetProfile(input: PermitInput | null | undefined): PlansetProfile {
  const c = (input ?? {}) as unknown as ProfileCarrier;
  const raw = c.plansetProfile ?? c.permitOptions?.plansetProfile ?? c.planSetOptions?.plansetProfile;
  return raw === 'permit' || raw === 'full' || raw === 'design-review' ? raw : DEFAULT_PLANSET_PROFILE;
}

export const isPermitProfile = (input: PermitInput | null | undefined): boolean =>
  resolvePlansetProfile(input) === 'permit';

/** The two COMPACT profiles share the same drawing-set composition (RS-1(.n),
 *  SCHED continuations, APP-A, VAL-1 out; PV-6 folded onto PV-5; DS-n as the
 *  attachment appendix). They differ ONLY in the certification tail: see
 *  profileCarriesPendingPE1 / certificationIsCompleted. */
export const isCompactProfile = (profile: PlansetProfile): boolean =>
  profile === 'permit' || profile === 'design-review';

/** DESIGN_REVIEW carries PE-1 in its CURRENT (possibly unsigned, pending)
 *  state as the final engineer-review sheet. PERMIT_SUBMISSION never does —
 *  an unsigned document that could read as certified is excluded until a
 *  digest-bound approval exists. FULL always carries the current state. */
export const profileCarriesPendingPE1 = (profile: PlansetProfile): boolean =>
  profile === 'design-review' || profile === 'full';

/**
 * WS-10 — is a certification sheet (CERT / PE-1) APPLICABLE AND COMPLETED?
 *
 * The directive keeps PE-1 "only when applicable + completed". A placeholder
 * "PENDING ENGINEERING REVIEW — UNSIGNED" certification page is not a permit
 * document; it is an internal status report, and it lives in the full profile.
 * COMPLETED means the snapshot carries a digest-bound engineering approval that
 * covers THIS snapshot digest — the same test certPages and the issue-state
 * gate already apply. Nothing here can invent an approval.
 */
export function certificationIsCompleted(input: PermitInput | null | undefined): boolean {
  const snap = peekSnapshot(input ?? undefined);
  if (!snap) return false;
  const approved = snap.certification?.engineeringReviewApproved;
  const digest = snap.meta?.digest ?? '';
  if (!approved) return false;
  return !!digest && approved.reviewedDigest === digest;
}

/** PERMIT_SUBMISSION requested while the engineering review is still pending:
 *  the output is a NON-SUBMITTABLE PREVIEW and must say so explicitly. This is
 *  the fail-closed half of the profile contract — the system never silently
 *  produces a permit-submission package for an unreviewed snapshot. */
export function permitSubmissionPreviewState(input: PermitInput | null | undefined): {
  isPreview: boolean;
} {
  return {
    isPreview: resolvePlansetProfile(input) === 'permit' && !certificationIsCompleted(input),
  };
}

/**
 * WS-10 — does a sheet's OWN content sit behind an open requirement?
 *
 * The registry already records, per requirement, the sheets its authority is
 * projected onto (`blocker.sheets`). That is the ONE fact that decides whether
 * a sheet still carries the per-sheet banner in the permit profile: a structural
 * sheet keeps it while a structural gate is open, and a sheet with no gated
 * content stops repeating the package headline. Nothing is suppressed on a
 * sheet whose own content is affected.
 */
export function sheetIsDirectlyGated(
  input: PermitInput | null | undefined,
  sheetId: string | null | undefined,
): boolean {
  if (!sheetId) return true;                     // unknown sheet ⇒ never suppress
  const snap = peekSnapshot(input ?? undefined);
  const registry: readonly PermitReadinessBlocker[] = snap?.permitReadiness?.registry ?? [];
  if (!registry.length) return false;
  // hybrid detail sheets (PV-3G / PE-1F …) inherit their base sheet's gating.
  const base = sheetId.replace(/^(PV-\d+[A-Z]?(?:\.\d+)?|PE-1|E-1|SCHED|CERT|APP-A|RS-1)[GFR]?$/, '$1');
  return registry.some(r => !r.resolved
    && (r.affectedSheets ?? []).some(s => s === sheetId || s === base));
}
