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

// ═══════════════════════════════════════════════════════════════════════════
// D11 — THE CALENDAR DATE WALKED THROUGH THE SAME DOOR.
//
// The MCC §0 note above says `capturedAtIso` was left out "because it did NOT
// vary". That measurement was taken between two builds SECONDS apart, and none
// of these vary on that timescale. They vary by DAY.
//
// `meta.generatedAtIso` is the resolved jurisdiction-zone issue date, and
// `generatePermit.ts` overwrites `project.date` with it on EVERY render — so an
// unchanged design regenerates to a different digest after midnight in the
// project's zone. A PE approves digest D today; tomorrow the same design is D′
// and the approval is dropped as stale by the very mechanism built to protect
// it. The archived Braidon snapshot on disk reads 7/30/2026 against a live
// 8/6/2026: different digests, no design change between them. That is MCC §0's
// defect at day granularity, and D11's whole premise — that a row naming digest
// D can invalidate an approval of D — is meaningless until it is closed.
//
// EXCLUDED BY PATH, NOT BY KEY NAME. Measured, not assumed: every leaf in the
// live snapshot equal to the generation stamp was enumerated, and the six paths
// below are the whole set. `capturedAtIso` is NOT excludable by key —
// `equipment.*.datasheet.capturedAtIso` is a DOCUMENT capture date and is real
// provenance that must keep moving the digest. Excluding it by name would have
// quietly deleted that.
//
// WHEN a package was generated is not WHAT was designed. Every one of these
// stays in the stored snapshot and on every stamped sheet; only the DESIGN
// digest stops seeing them.
const BUILD_STAMP_PATHS: ReadonlySet<string> = new Set([
  'meta.generatedAtIso',              // D14 — the generation stamp itself
  'meta.generatedAtPrecision',        // D14 — its form: a property of the build
  'meta.generatedAtBasis',            // D14 — why it has that form
  'codeAuthority.capturedAtIso',      // when the code authority was captured
  'projectAuthority.capturedAtIso',   // when the project authority was captured
  'projectAuthority.issueDate',       // the DOCUMENT issue date, not a design fact
  'project.ahj.recordCapturedAtIso',  // when the AHJ record was read
  'permitReadiness.registry[].createdAtIso', // the same stamp, once per row
]);

/** `projectAuthority.revisionHistory[].date` is NOT excluded wholesale: a
 *  genuine historical revision dated last June is design provenance and must
 *  keep moving the digest. Only an entry stamped BY THIS BUILD is excluded —
 *  the auto-generated current revision (live: one Rev A row).
 *
 *  It is matched against `projectAuthority.issueDate`, NOT `meta.generatedAtIso`:
 *  the revision row carries the LOCALISED issue date ('7/30/2026') while the meta
 *  stamp may be an injected ISO instant ('2026-07-30T12:00:00.000Z'). Comparing
 *  against the meta stamp — which is what this first did — silently never matched
 *  on any frozen-clock build, and the digest went on moving with the calendar. */
const REVISION_DATE_PATH = 'projectAuthority.revisionHistory[].date';
const ISSUE_DATE_PATH = 'projectAuthority.issueDate';

/** Replace run-instant and build-stamp provenance with a constant, recursively.
 *  Pure; the input is never mutated, so the stored snapshot keeps its real
 *  timestamps. `path` is the normalized location (`[]` for any array index) so
 *  D11's exclusions can be scoped to the exact fields measured to carry the
 *  build stamp, rather than to every field that shares their name. */
function normalizeRunInstants(v: unknown, path = '', buildDates: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(v)) return v.map(x => normalizeRunInstants(x, `${path}[]`, buildDates));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const at = path ? `${path}.${k}` : k;
      if (RUN_INSTANT_KEYS.has(k) && (typeof val === 'string' || val === null)) {
        out[k] = val === null ? null : RUN_INSTANT_SENTINEL;
      } else if (BUILD_STAMP_PATHS.has(at) && (typeof val === 'string' || val === null)) {
        out[k] = val === null ? null : RUN_INSTANT_SENTINEL;
      } else if (at === REVISION_DATE_PATH && typeof val === 'string' && buildDates.has(val)) {
        // stamped by THIS build; a historical revision date falls through and
        // keeps its place in the digest.
        out[k] = RUN_INSTANT_SENTINEL;
      } else if (AUDIT_REF_KEYS.has(k) && typeof val === 'string') {
        // keep the resolver + evidence references, drop only the instant
        out[k] = val.replace(AUDIT_REF_INSTANT_RE, `@${RUN_INSTANT_SENTINEL}`);
      } else {
        out[k] = normalizeRunInstants(val, at, buildDates);
      }
    }
    return out;
  }
  return v;
}

/** Read the date values THIS build stamped, so a revision row it wrote can be
 *  told apart from a historical one. Both forms are collected because the two
 *  fields use different formats (an ISO instant vs the localised issue date). */
function buildStampedDates(snapshot: Record<string, unknown>): ReadonlySet<string> {
  const out = new Set<string>();
  const meta = snapshot.meta as Record<string, unknown> | undefined;
  if (typeof meta?.generatedAtIso === 'string' && meta.generatedAtIso) out.add(meta.generatedAtIso);
  const pa = snapshot[ISSUE_DATE_PATH.split('.')[0]] as Record<string, unknown> | undefined;
  const issue = pa?.[ISSUE_DATE_PATH.split('.')[1]];
  if (typeof issue === 'string' && issue) out.add(issue);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// TR — THE OPERATIONAL-EVIDENCE CONTAINER.
//
// MCC §0 above excludes WHEN a resolver ran. It does not exclude WHAT the
// resolver recorded about the attempt — and that is the door the defect walked
// through next. Measured, real path, fixed clock: forcing a transient
// `safeDbRead` failure on `resolveRackingCapacityDocument` changed only
//   permitReadiness.registry[…].payload.resolutionEvidence[0].failureReason
//   permitReadiness.registry[…].payload.resolutionEvidence[0].retryability
// and moved the snapshot digest plus 31 lines of the signed artifact, with the
// accepted authority, the release verdict and every gate byte-identical. Two
// different wordings of the SAME temporary failure produced two different
// digests.
//
// The repair is a TYPED PROJECTION BOUNDARY (resolution/authorityProjection.ts),
// not another key-name rule — a recursive "drop anything called failure/reason/
// source" would have deleted `equipment.*.datasheet.capturedAtIso`, which is real
// document provenance and must keep moving the digest (D11).
//
// This constant is the structural half of that boundary: ONE declared top-level
// container, skipped exactly the way `meta.digest` is. It is a CONTAINER
// exclusion, not a key-name exclusion — a field of any name elsewhere in the
// snapshot is untouched. The evidence stays IN the stored snapshot (rather than
// being attached after the hash, as the PRR review record is), so an archived
// package still re-digests to its own `meta.digest`.
const OPERATIONAL_EVIDENCE_KEY = 'resolverAttemptEvidence';

/** THE EXACT VALUE THE DIGEST IS TAKEN OVER.
 *
 *  Exported as durable diagnostic tooling: "the digest moved" is a fact, but
 *  "WHICH leaf moved" is the fact that makes a drift investigable. Every
 *  digest-stability test and every drift harness reads the body through this
 *  accessor rather than re-implementing the normalisation, so a diagnostic can
 *  never disagree with the hash it is explaining.
 *
 *  Pure; the input is not mutated. */
export function canonicalDigestBody(snapshot: Record<string, unknown>): unknown {
  const meta = { ...(snapshot.meta as Record<string, unknown>) };
  delete meta.digest;
  delete meta.snapshotId;
  const body: Record<string, unknown> = { ...snapshot, meta };
  delete body[OPERATIONAL_EVIDENCE_KEY];
  return normalizeRunInstants(body, '', buildStampedDates(snapshot));
}

/** SHA-256 hex over the canonical JSON of the snapshot WITHOUT meta.digest /
 *  meta.snapshotId (they derive from this), WITHOUT run-instant provenance and
 *  WITHOUT the build stamp (see above — the digest identifies the DESIGN, not
 *  the build that produced it, nor the day it ran). */
export function computeSnapshotDigest(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(canonicalDigestBody(snapshot)), 'utf8').digest('hex');
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
