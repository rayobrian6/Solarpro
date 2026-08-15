// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — EVIDENCE CONVENTIONS
// ───────────────────────────────────────────────────────────────────────────
// Evidence records follow the provenance vocabulary the codebase already uses:
// `authority:` / `provenance:` / `document:` / `sha256:` / `assembly:` — the
// exact strings deriveEvidenceReferences synthesises (releaseGates.ts:695-709).
//
// THE AUDIT-REF CONTRACT (audit §5 Seam 4): deriveRequirementStatus
// (releaseGates.ts:685-691) keeps `resolved: true` OPEN unless a
// `resolutionAuditRef` is present. So flipping a requirement to resolved REQUIRES
// an audit reference naming the resolver, its evidence and its timestamp. That
// single existing rule enforces "empty evidence / truthy flags are never proof"
// for free — this module is how a resolver satisfies it, and it may never be
// weakened.
// ═══════════════════════════════════════════════════════════════════════════

import { projectResolvedAuthority } from './authorityProjection';
import type { RequirementResolutionState, ResolutionEvidenceRecord } from './types';

export const RESOLUTION_AUDIT_PREFIX = 'AAC-RESOLVER:';

/**
 * The audit reference a CLEARING resolution must write. Non-empty by
 * construction (deriveRequirementStatus fails closed on an empty ref) and
 * self-describing: resolver, evidence references, timestamp.
 */
export function buildResolutionAuditRef(args: {
  resolverId: string;
  sourceRefs?: string[];
  atIso: string;
}): string {
  const refs = (args.sourceRefs ?? []).filter(Boolean);
  const tail = refs.length ? ` ${refs.join(' ')}` : '';
  return `${RESOLUTION_AUDIT_PREFIX}${args.resolverId}${tail} @${args.atIso}`;
}

/** `document:` / `sha256:` reference strings for a resolved registry document. */
export function documentSourceRefs(doc: { id?: string | null; documentId?: string | null; sha256?: string | null; documentHash?: string | null } | null | undefined): string[] {
  if (!doc) return [];
  const out: string[] = [];
  const id = doc.documentId ?? doc.id ?? null;
  const hash = doc.documentHash ?? doc.sha256 ?? null;
  if (id) out.push(`document:${id}`);
  if (hash) out.push(`sha256:${String(hash).slice(0, 16)}`);
  return out;
}

/**
 * PERMIT-SAFE display wording for a resolution result (RGM permanent gate 10:
 * "pending authority is NEVER a verified failure"; the directive: no repeated
 * failure language on the sheets). The MACHINE vocabulary the directive mandates
 * (`RESOLVED | FAILED | SKIPPED | NOT_ATTEMPTED`) is preserved verbatim on
 * `RequirementResolutionState.lastResolutionResult` and on every evidence
 * record; only the RENDERED scalar is stated in authority terms. A resolver
 * attempt that did not establish an authority has not "failed" a code check —
 * the authority is simply NOT ESTABLISHED.
 */
export const RESOLUTION_RESULT_DISPLAY: Record<string, string> = {
  RESOLVED: 'RESOLVED',
  FAILED: 'ATTEMPTED — NOT ESTABLISHED',
  SKIPPED: 'SKIPPED',
  NOT_ATTEMPTED: 'NOT YET ATTEMPTED',
};

/**
 * The FLAT projection of a resolution state onto a blocker payload. It rides in
 * the EXISTING RS-1 payload machinery (`renderBlockerPayload` →
 * `payloadGeneric`, reviewStatus.ts:236) — scalars print as honest key/value
 * pairs. NO visual redesign: the payload SCHEMA changes, the components are
 * untouched.
 *
 * TR — THIS IS THE DIGEST BOUNDARY. The registry payload is digest input, so
 * everything returned here becomes part of the DESIGN's identity. It therefore
 * returns EXACTLY `ResolvedAuthorityProjection` and nothing else.
 *
 * What used to be here and is not any more: `resolutionEvidence[]` (the attempt
 * records, carrying the raw transport error and its retryability),
 * `resolutionEvidenceCount` (the attempt count), `attemptedResolvers` (the
 * attempt order), `retryability`, `resolutionConfidence` and
 * `lastResolutionAttempt`. Measured: a transient `safeDbRead` failure on
 * `resolveRackingCapacityDocument` moved three of those payloads, the snapshot
 * digest and 31 lines of the signed artifact, while the accepted authority and
 * every release gate were byte-identical.
 *
 * NONE OF IT IS LOST. All of it now travels on
 * `snapshot.resolverAttemptEvidence`, which the digest does not read — see
 * `./authorityProjection`.
 */
export function resolutionStatePayload(s: RequirementResolutionState): Record<string, unknown> {
  return { ...projectResolvedAuthority(s) };
}

/** A compact, deterministic evidence line for the closure document / harness. */
export function evidenceLine(e: ResolutionEvidenceRecord): string {
  const codes = e.requirementCodes.length ? e.requirementCodes.join('+') : '(infrastructure)';
  const src = e.sourceQueried ?? 'n/a';
  const why = e.failureReason ? ` — ${e.failureReason}` : '';
  return `[${e.outcome}] ${e.resolverId} (${e.resolverMode}) i${e.iteration} ${codes} src=${src}${why}`;
}
