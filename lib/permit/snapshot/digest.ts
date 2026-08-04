// Canonical-JSON SHA-256 digest for the PermitDesignSnapshot.
// snapshotId is CONTENT-DERIVED ('PDS-' + digest prefix) so identical designs
// produce identical ids (byte-identical re-render determinism holds).
import { createHash } from 'crypto';

/** Deterministic JSON: object keys sorted recursively, no whitespace.
 *  undefined values are dropped (JSON semantics); Maps/Sets are not allowed
 *  in the snapshot (plain data only). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════
// MCC §0 — RUN-INSTANT PROVENANCE IS NOT DESIGN CONTENT.
//
// Each of these records WHEN a resolver ran, never WHAT it found. They are real
// evidence and stay in the stored snapshot; they are excluded from the DESIGN
// digest because two builds of an unchanged design, twenty seconds apart, must
// be the same design.
//
// THE DEFECT THIS CLOSES: the live Braidon package regenerated to a different
// digest every single time — measured, two consecutive runs, 30 leaf diffs and
// every one of them one of these keys. That made the digest-bound professional
// approval unusable in production: a PE approves digest D, the operator
// regenerates, the digest is D′, and the approval is dropped as "stale" by the
// very mechanism built to protect it. It is the same defect class as the review
// circularity — a fact about the act of BUILDING leaking into the identity of
// the thing built.
//
// Adding a key here is a deliberate act. The guarantee that survives new keys is
// the determinism test (tests/planset/mcc-snapshot-determinism.test.ts), which
// builds the same design twice against a MOVING clock and compares digests, so
// any future run-instant field fails the suite rather than silently returning.
// EXACTLY the keys measured to vary between two consecutive builds of the
// unchanged live Braidon design. Nothing speculative: `capturedAtIso` is NOT
// here because it did NOT vary (it derives from the stable generation input),
// and excluding a stable field would move every existing digest for no reason.
const RUN_INSTANT_KEYS: ReadonlySet<string> = new Set([
  'lastResolutionAttempt',   // registry payload — when resolution was last attempted
  'atIso',                   // resolutionEvidence entries — when this evidence was produced
  'attemptedAtIso',          // framing / document retrieval attempt instant
  'startedAtIso',            // retrieval record start instant
  'retrievedAtIso',          // per-source retrieval instant (the CONTENT hash carries identity)
]);

/** The sentinel a run-instant value collapses to for hashing. Never stored. */
const RUN_INSTANT_SENTINEL = '<run-instant>';

// ── LA §6 — THE AUDIT REFERENCE CARRIES AN INSTANT TOO ──────────────────────
// `buildResolutionAuditRef` (resolution/evidence.ts) returns
// `AAC-RESOLVER:<resolver> <refs…> @<iso>`, and that string lands on the
// DIGESTED `resolutionAuditRef` (and inside payload.resolutionEvidence[]).
// Collapsing the whole value would be wrong — the resolver id and the
// `document:` / `sha256:` references ARE design authority and must stay in the
// digest, so that binding a DIFFERENT document changes it. Only the trailing
// instant is normalised.
//
// This had never fired: with zero requirements cleared, no audit ref existed.
// The first genuine clearance would have been the first one — silently
// reinstating the exact regenerate-and-the-approval-goes-stale defect the
// run-instant exclusion above was written to kill.
const AUDIT_REF_KEYS: ReadonlySet<string> = new Set(['resolutionAuditRef', 'auditRef']);
const AUDIT_REF_INSTANT_RE = /@\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;

/** Replace run-instant provenance with a constant, recursively. Pure; the input
 *  is never mutated, so the stored snapshot keeps its real timestamps. */
function normalizeRunInstants(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeRunInstants);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (RUN_INSTANT_KEYS.has(k) && (typeof val === 'string' || val === null)) {
        out[k] = val === null ? null : RUN_INSTANT_SENTINEL;
      } else if (AUDIT_REF_KEYS.has(k) && typeof val === 'string') {
        // keep the resolver + evidence references, drop only the instant
        out[k] = val.replace(AUDIT_REF_INSTANT_RE, `@${RUN_INSTANT_SENTINEL}`);
      } else {
        out[k] = normalizeRunInstants(val);
      }
    }
    return out;
  }
  return v;
}

/** SHA-256 hex over the canonical JSON of the snapshot WITHOUT meta.digest /
 *  meta.snapshotId (they derive from this) and WITHOUT run-instant provenance
 *  (see above — the digest identifies the DESIGN, not the build that produced it). */
export function computeSnapshotDigest(snapshot: Record<string, unknown>): string {
  const meta = { ...(snapshot.meta as Record<string, unknown>) };
  delete meta.digest;
  delete meta.snapshotId;
  const body = normalizeRunInstants({ ...snapshot, meta });
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

export function snapshotIdFromDigest(digest: string): string {
  return `PDS-${digest.slice(0, 12).toUpperCase()}`;
}

/** Short content-revision hash for a versioned record (module / racking
 *  assembly). Embedded on the canonical object so any equipment/assembly change
 *  propagates into the snapshot digest — the basis for approval invalidation
 *  (W3 §2: equipment changes invalidate layout geometry and snapshot digest). */
export function contentRevision(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').slice(0, 12);
}

/** Deep-freeze after validation — the snapshot is immutable authority (req. 2). */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
