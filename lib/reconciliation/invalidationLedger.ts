// ═══════════════════════════════════════════════════════════════════════════
// D11 — THE INVALIDATION LEDGER: SCOPE, AND THE ABILITY TO BE LIFTED.
//
// `snapshot_digest_invalidations` (migration 114) has carried `superseded_at` /
// `superseded_by` since the day it was created, and `listActiveInvalidations`
// filters on them — but NOTHING in the codebase has ever written them. An
// invalidation, once recorded, was permanent. PRR softened the consequence by
// making the DECISION row-scoped rather than a bare count; it could not make an
// invalidation liftable, because there was no writer.
//
// AND THE LEDGER HAS TWO WRITERS WITH TWO BEHAVIOURS. `reconcile.ts` records the
// PRE-change digest (`knownSnapshot?.digest`) — the form `invalidationApplies`
// can scope to one approval. `InvalidationSink.invalidate` had no digest
// parameter at all, so the field-measurement sink wrote `digest: null` by
// construction: a blunt time watermark invalidating EVERY approval on the
// project made at or before it, including approvals for designs the measurement
// never touched.
//
// WHAT MUST NEVER HAPPEN. The live NULL-digest rows must not be backfilled with
// a reconstructed digest. Their pre-change digests were never captured and
// cannot be recovered; inventing one is fabricated authority. They stay legacy
// watermarks, they are classified as such out loud, and a rebuild never lifts
// them — only an explicit operator act can, because only a person can attest to
// what a watermark was protecting.
// ═══════════════════════════════════════════════════════════════════════════

/** What a ledger row can actually scope to. */
export type InvalidationRowKind =
  /** the row names a digest — it invalidates exactly that design. */
  | 'digest-scoped'
  /** the row names no digest — it invalidates every approval at or before its
   *  instant, which is far broader than any single change warrants. */
  | 'time-watermark';

export interface InvalidationRowClassification {
  kind: InvalidationRowKind;
  digest: string | null;
  /** WHY this row means what it means, in one sentence. */
  basis: string;
  /** true ⇔ a rebuild that is re-reviewed can lift this row. A watermark cannot
   *  be: it names no design, so nothing about a rebuild can prove it satisfied. */
  supersedableByRebuild: boolean;
}

/** Read what a row says. This is a READ, never a repair: it does not and must
 *  not reconstruct a digest a row never recorded. */
export function classifyInvalidationRow(
  row: { digest?: string | null } | null | undefined,
): InvalidationRowClassification {
  const digest = row?.digest ?? null;
  if (digest) {
    return {
      kind: 'digest-scoped', digest, supersedableByRebuild: true,
      basis: `names design digest ${digest.slice(0, 12)}… — it invalidates approvals of that design and no other`,
    };
  }
  return {
    kind: 'time-watermark', digest: null, supersedableByRebuild: false,
    basis: 'names NO digest — it invalidates every approval on the project recorded at or before its instant, '
      + 'whatever design those approvals covered. The pre-change digest was not captured when it was written '
      + 'and may not be reconstructed, so only an explicit operator act can clear it',
  };
}

export interface SupersessionCandidate {
  id: string;
  digest: string | null;
  invalidatedAtIso: string | null;
}

export interface SupersessionPlan {
  /** rows a new approval of the rebuilt digest legitimately clears. */
  supersede: Array<{ id: string; supersededBy: string; supersededAtIso: string; reason: string }>;
  /** rows that stay active. */
  retained: SupersessionCandidate[];
  /** why each retained row stays — keyed by row id, never empty for a retained row. */
  retainedReasons: Record<string, string>;
}

/**
 * Plan which ledger rows a NEW approval of the REBUILT digest supersedes.
 *
 * Pure and total: every input row appears in exactly one of `supersede` /
 * `retained`, and every retained row carries a stated reason. Nothing is
 * silently dropped, because a silently dropped invalidation is an authority
 * failure that looks like success.
 *
 * THE RULE, stated once:
 *   • a row naming a digest OTHER than the rebuilt one is superseded — the
 *     design it invalidated has been rebuilt and the rebuild re-reviewed;
 *   • a row naming the REBUILT digest is RETAINED. An approval may not clear
 *     the invalidation raised against the very design it is approving;
 *   • a NULL-digest watermark is RETAINED, always — see `classifyInvalidationRow`;
 *   • a row recorded AFTER the approval is RETAINED. An approval cannot answer
 *     an objection that did not exist when it was made.
 */
export function planInvalidationSupersession(args: {
  rows: readonly SupersessionCandidate[];
  /** the digest of the rebuilt design the new approval covers. */
  rebuiltDigest: string;
  /** the approval clearing them — recorded in `superseded_by`. */
  approvalRef: string;
  /** when the approval was made. */
  atIso: string;
}): SupersessionPlan {
  const supersede: SupersessionPlan['supersede'] = [];
  const retained: SupersessionCandidate[] = [];
  const retainedReasons: Record<string, string> = {};
  const approvedAt = Date.parse(args.atIso);
  const rebuilt = args.rebuiltDigest.toLowerCase();

  const keep = (r: SupersessionCandidate, why: string) => { retained.push(r); retainedReasons[r.id] = why; };

  for (const r of args.rows) {
    const cls = classifyInvalidationRow(r);
    if (!cls.supersedableByRebuild) {
      keep(r, `retained: this row is a time watermark and ${cls.basis}`);
      continue;
    }
    if ((r.digest ?? '').toLowerCase() === rebuilt) {
      keep(r, 'retained: this row names the digest being approved — an approval may not clear the invalidation raised against the design it approves');
      continue;
    }
    const invalidatedAt = r.invalidatedAtIso ? Date.parse(r.invalidatedAtIso) : NaN;
    // Unknown timestamps cannot be ordered ⇒ fail closed, exactly as the reader does.
    if (Number.isNaN(invalidatedAt) || Number.isNaN(approvedAt) || invalidatedAt >= approvedAt) {
      keep(r, `retained: recorded ${r.invalidatedAtIso ?? 'at an unrecorded time'}, at or after the approval at ${args.atIso} — `
        + 'an approval cannot answer an objection that did not exist when it was made');
      continue;
    }
    supersede.push({
      id: r.id,
      supersededBy: args.approvalRef,
      supersededAtIso: args.atIso,
      reason: `design digest ${(r.digest ?? '').slice(0, 12)}… was rebuilt to ${rebuilt.slice(0, 12)}… and re-reviewed by ${args.approvalRef}`,
    });
  }

  return { supersede, retained, retainedReasons };
}
