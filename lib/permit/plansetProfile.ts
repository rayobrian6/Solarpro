// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-10 — PLANSET OUTPUT PROFILE.
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
//     built identically under both profiles and stay snapshot-bound. Removing a
//     PAGE never removes a REQUIREMENT (proved by the registry-integrity test).
//   • 'full'   — the internal package: every sheet the engine can draw,
//     including RS-1(.n) review status, SCHED continuations, APP-A, the CERT /
//     PE-1 certification placeholders and the DS-n datasheets inline. This is
//     what the in-app viewer, the goldens and the RGM/ECD/BAR evidence
//     harnesses consume, and it is byte-identical to the pre-WS-10 output.
//   • 'permit' — the AHJ submittal: the compact drawing set plus a MANUFACTURER
//     ATTACHMENT appendix. Unresolved work is NOT hidden: the cover carries one
//     concise release-status line naming every open gate and the requirement
//     count, and the per-sheet banner survives on sheets whose OWN content is
//     gated (see sheetIsDirectlyGated).
//
// DEFAULTS: the library default is 'full' (no caller changes behaviour by
// accident). The permit ARTIFACT — the HTML/PDF the permit route emits — asks
// for 'permit' explicitly; callers may pass `plansetProfile: 'full'` to get the
// internal package instead.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from './types';
import type { PermitReadinessBlocker } from './snapshot/types';
import { peekSnapshot } from './snapshot/read';

export type PlansetProfile = 'permit' | 'full';

/** The engine default — unchanged behaviour for every existing caller. */
export const DEFAULT_PLANSET_PROFILE: PlansetProfile = 'full';

/** The default for the PERMIT ARTIFACT (the route's HTML/PDF deliverable). */
export const PERMIT_ARTIFACT_PROFILE: PlansetProfile = 'permit';

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
  return raw === 'permit' || raw === 'full' ? raw : DEFAULT_PLANSET_PROFILE;
}

export const isPermitProfile = (input: PermitInput | null | undefined): boolean =>
  resolvePlansetProfile(input) === 'permit';

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
