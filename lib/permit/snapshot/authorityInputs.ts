// ═══════════════════════════════════════════════════════════════════════════
// W4 §8/§9/§12 — ASYNC snapshot-authority resolver (closer wiring).
// AAC WS-1 (2026-07-27) — EXTENDED INTO THE RESOLUTION LIFECYCLE.
//
// buildPermitDesignSnapshot is a PURE, SYNCHRONOUS, deterministic build (its
// output digest must be reproducible). The manufacturer-document registry
// (lib/documents) and the digest-invalidation ledger (lib/reconciliation) are
// ASYNC database reads. This helper runs in the ONE genuinely-async path — the
// permit routes — BEFORE the sync build, resolves those authorities, and
// threads the result into buildPermitDesignSnapshot's opts.
//
// WHAT CHANGED IN AAC WS-1: the body of this function used to be five inline
// document LOOKUPS. They are now REGISTERED RESOLVERS run by a bounded
// lifecycle (`lib/permit/snapshot/resolution`): determine automatic requirements
// → AUTO_DERIVED → persist results + evidence → invalidate dependents →
// recalculate → AUTO_RETRIEVED → persist retrieved authority + source evidence →
// recalculate → repeat to stability (bound 3) → hand the STABILISED bundle to
// the sync build. Same fail-soft discipline, same defaults, same digest when
// nothing resolves — plus a per-requirement RequirementResolutionState and an
// evidence trail, so an automatic requirement can no longer be emitted
// unresolved merely because nobody called its resolver.
//
// FAIL-SOFT: a DB-unavailable test/harness run resolves everything to the
// pre-wiring defaults (no document ⇒ RT-MINI blockers stay; docs-archived null ⇒
// the ISSUED-FOR-PERMIT gate is not satisfied), so generation never crashes and
// the snapshot digest is unchanged when no verified document exists.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import { runResolutionLifecycle, type ResolutionDeps } from './resolution/lifecycle';
import type { SnapshotAuthorityInputs } from './resolution/types';

// THE bundle type lives with the lifecycle that produces it (audit §5 "no
// duplicate abstraction"); re-exported here so every existing importer —
// generatePermit, the regen scripts, the harnesses, the tests — is unchanged.
export type { SnapshotAuthorityInputs } from './resolution/types';

/**
 * Resolve the async document + ledger authority for a permit input, through the
 * full resolver lifecycle. Never throws — every DB read goes through the shared
 * `safeDbRead` guard and fails soft to the BLOCKER-FIRING state.
 *
 * Migrations 113 (manufacturer_document_registry) / 114
 * (equipment_reconciliation_audit + snapshot_digest_invalidations) are NOT yet
 * run, so on production today every document read resolves to the fail-soft
 * default — and, unlike before, that failure is now EVIDENCED (source queried,
 * exact error incl. the 42P01 table-absent hint, retryability, operator action)
 * instead of silently swallowed.
 */
export async function resolveSnapshotAuthorityInputs(
  input: PermitInput,
  deps?: ResolutionDeps,
): Promise<SnapshotAuthorityInputs> {
  const { authority, outcome } = await runResolutionLifecycle(input, deps);
  // the lifecycle record rides WITH the bundle so generatePermit can thread the
  // per-requirement resolution state into the registry payload.
  authority.resolution = outcome;
  return authority;
}

/** Explicit alias for callers that want the lifecycle outcome separately (the
 *  evidence harness, the closure doc, tests). */
export async function resolveSnapshotAuthority(
  input: PermitInput,
  deps?: ResolutionDeps,
): Promise<{ authority: SnapshotAuthorityInputs; outcome: NonNullable<SnapshotAuthorityInputs['resolution']> }> {
  const { authority, outcome } = await runResolutionLifecycle(input, deps);
  authority.resolution = outcome;
  return { authority, outcome };
}
