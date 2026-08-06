// ═══════════════════════════════════════════════════════════════════════════
// TR §0 — THE RESOLVER AUTHORITY BOUNDARY.
//
// A resolver produces TWO different kinds of fact, and until now they travelled
// together into the design digest:
//
//   WHAT THE DESIGN ACCEPTS      — the authority state, the accepted value, the
//                                  selected document, the release-relevant
//                                  unresolved reason. This IS the design.
//   HOW THE ATTEMPT WENT         — the transport error text, the retry count,
//                                  whether the source answered, the latency, the
//                                  attempt instant. This is a fact about the RUN.
//
// MEASURED, not assumed. Injecting a transient `safeDbRead` failure on
// `resolveRackingCapacityDocument` through the REAL lifecycle — same stored
// design, same fixed clock, same accepted authority, same open gates — moved the
// snapshot digest and 31 of the artifact's lines. The whole leaf diff was:
//
//   permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].failureReason
//     "no matching verified capacity document"
//       → "resolveRackingCapacityDocument: ETIMEDOUT connection timed out after 30000ms"
//   permitReadiness.registry[4|6|7].payload.resolutionEvidence[0].retryability
//     "REQUIRES_INPUT" → "RETRYABLE"
//
// Two DIFFERENT wordings of the same temporary failure produced two DIFFERENT
// digests. A PE approves digest D; the registry blips for one second on the next
// regeneration; the digest is D′ and the approval is dropped as stale by the very
// mechanism built to protect it. That is MCC §0's defect again — a fact about the
// act of BUILDING leaking into the identity of the thing built — this time
// carried by WHAT the resolver recorded rather than WHEN it ran, which is exactly
// why the RUN_INSTANT_KEYS exclusion did not catch it.
//
// THE FIX IS A TYPED BOUNDARY, NOT A KEY-NAME EXCLUSION. A recursive
// "drop anything called `reason` / `source` / `failure`" would have deleted real
// design authority — `equipment.*.datasheet.capturedAtIso` is genuine document
// provenance and MUST keep moving the digest (D11). So the split is made by
// EXPLICIT PROJECTION: the material half is constructed here, field by field, and
// the operational half is routed to ONE declared container that the digest does
// not read.
//
// NOTHING IS DELETED. Every attempt record, every transport error and every retry
// stays in the stored snapshot under `resolverAttemptEvidence`, and on the
// lifecycle outcome, for troubleshooting and audit.
// ═══════════════════════════════════════════════════════════════════════════

import { RESOLUTION_RESULT_DISPLAY } from './evidence';
import type {
  RequirementResolutionState, ResolutionEvidenceRecord, ResolutionMode,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE OPERATIONAL HALF.
//
// `ResolutionEvidenceRecord` ALREADY is the attempt-evidence record the
// architecture asks for — attempt instant, raw failure message, retryability,
// last attempted source, the inputs consumed, the lifecycle iteration. It is
// NAMED here rather than duplicated: a second near-identical interface would be
// the "duplicate concept to satisfy a name" the directive forbids.
// ═══════════════════════════════════════════════════════════════════════════

/** THE operational record of one resolver ATTEMPT. Never digest input. */
export type ResolverAttemptEvidence = ResolutionEvidenceRecord;

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE MATERIAL HALF.
// ═══════════════════════════════════════════════════════════════════════════

/** The AUTHORITY STATE a requirement ended the lifecycle in.
 *
 *  Deliberately says nothing about WHY a lookup did not answer. "The registry
 *  holds no such document" and "the registry could not be reached this second"
 *  are genuinely different facts — and both are preserved, in full, on the
 *  attempt evidence. But they are the SAME DESIGN: no capacity authority is
 *  established, the requirement is open, the gate is closed. Letting a one-second
 *  outage flip this enum would put the transient outcome straight back into the
 *  digest through a differently-named door. */
export type ResolvedAuthorityState =
  | 'ESTABLISHED'             // an authority was accepted, with an audit reference
  | 'NOT_ESTABLISHED'         // attempted; nothing accepted
  | 'NOT_APPLICABLE'          // the requirement does not apply to this design
  | 'RESOLVER_NOT_IMPLEMENTED'// no owning resolver exists yet (a different fact)
  | 'NOT_YET_ATTEMPTED';      // nobody has run

/** The RELEASE-RELEVANT unresolved reason, enumerated and stable. Provider prose
 *  can never reach this: it is derived from the authority state alone. */
export type UnresolvedReasonCode =
  | 'AUTHORITY_NOT_ESTABLISHED'
  | 'RESOLVER_NOT_IMPLEMENTED'
  | 'NOT_YET_ATTEMPTED';

/**
 * THE canonical projection of one requirement's resolver authority — the ONLY
 * resolver-derived shape that may enter the design digest.
 *
 * Every field here answers "what does this design accept, and what does it still
 * owe?". No field answers "how did the attempt go?".
 */
export interface ResolvedAuthorityProjection {
  /** the DECLARED owning resolver (a declaration, not an attempt). */
  resolverId: string | null;
  resolverImplemented: boolean;
  resolutionMode: ResolutionMode;
  residualResolutionMode: ResolutionMode | null;
  plannedResolverPhase: string | null;
  /** the authority state — see the enum's note on why an outage does not move it. */
  authorityState: ResolvedAuthorityState;
  /** the permit-safe display scalar RS-1 has always printed (RGM gate 10). */
  lastResolutionResult: string;
  /** null once established. */
  unresolvedReasonCode: UnresolvedReasonCode | null;
  /** the MATERIAL reason the requirement is open — an applicability gap, a
   *  missing registration, a design fact. Never a transport error: the resolvers
   *  route `safeDbRead` failures to `failureReason` (operational) and leave the
   *  material sentence standing, so a one-second outage cannot reword this. */
  resolutionBlockingReason: string | null;
  /** the concrete facts the design still owes (clearance `missing[]`). */
  requiredInputs: string[];
}

/** True when the STATE carries an accepted authority: cleared AND holding the
 *  audit reference `deriveRequirementStatus` demands. Deliberately the same
 *  two-part predicate the registry record and the release gate both apply — a
 *  `cleared` flag with no audit reference has never been a clearance. */
function isEstablished(s: RequirementResolutionState): boolean {
  return s.cleared === true && !!s.resolutionAuditRef?.trim();
}

function authorityStateOf(s: RequirementResolutionState): ResolvedAuthorityState {
  if (isEstablished(s)) return 'ESTABLISHED';
  if (s.lastResolutionResult === 'SKIPPED') return 'NOT_APPLICABLE';
  if (!s.resolverImplemented && s.attemptedResolverIds.length === 0) return 'RESOLVER_NOT_IMPLEMENTED';
  if (s.lastResolutionResult === 'NOT_ATTEMPTED' && s.attemptedResolverIds.length === 0) return 'NOT_YET_ATTEMPTED';
  return 'NOT_ESTABLISHED';
}

function unresolvedReasonCodeOf(state: ResolvedAuthorityState): UnresolvedReasonCode | null {
  switch (state) {
    case 'ESTABLISHED': return null;
    case 'NOT_APPLICABLE': return null;
    case 'RESOLVER_NOT_IMPLEMENTED': return 'RESOLVER_NOT_IMPLEMENTED';
    case 'NOT_YET_ATTEMPTED': return 'NOT_YET_ATTEMPTED';
    default: return 'AUTHORITY_NOT_ESTABLISHED';
  }
}

/** THE projection. Pure and total. */
export function projectResolvedAuthority(s: RequirementResolutionState): ResolvedAuthorityProjection {
  const authorityState = authorityStateOf(s);
  return {
    resolverId: s.resolverId,
    resolverImplemented: s.resolverImplemented,
    resolutionMode: s.resolutionMode,
    residualResolutionMode: s.residualMode,
    plannedResolverPhase: s.plannedResolverPhase,
    authorityState,
    lastResolutionResult: RESOLUTION_RESULT_DISPLAY[s.lastResolutionResult] ?? s.lastResolutionResult,
    unresolvedReasonCode: unresolvedReasonCodeOf(authorityState),
    resolutionBlockingReason: s.blockingReason,
    requiredInputs: s.requiredInputs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE OPERATIONAL FIELDS CARRIED BY THE `resolutionAuthority` RECORDS.
//
// The registry payload was the PROVEN drift path, but it is not the only place a
// transient outcome reaches the digest. Three more were found by mutating each
// field of the live snapshot and recomputing the hash:
//
//   resolutionAuthority.structuralDocumentRetrieval.attempts[]
//       .httpStatus / .contentType / .byteLength / .failure / .proof / .notes
//       and .archival.failure / .archival.operatorAction
//   resolutionAuthority.projectPersonnel.storeError          (raw `read.error`)
//   resolutionAuthority.environmentalRetrieval.registryArchival.failure
//
// Each is declared HERE, by record and by field name, so the set is auditable and
// closed. This is NOT a recursive key-name exclusion: it names a field on ONE
// declared record type, and a field of the same name anywhere else in the
// snapshot is untouched. `attempts[].sha256`, `.archival.documentId`,
// `.coversSelectedModel`, `.documentProduct` and `.url` are DOCUMENT IDENTITY and
// stay in the digest — binding a different document must still move it.
// ═══════════════════════════════════════════════════════════════════════════

/** Field names that describe the ATTEMPT rather than the authority, per record. */
export const OPERATIONAL_AUTHORITY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  /** every element of `.attempts[]` is scrubbed of these. */
  'structuralDocumentRetrieval.attempts[]': [
    'proof', 'httpStatus', 'contentType', 'byteLength', 'failure', 'notes',
  ],
  'structuralDocumentRetrieval.attempts[].archival': ['failure', 'operatorAction'],
  projectPersonnel: ['storeError'],
  'environmentalRetrieval.registryArchival': ['failure', 'operatorAction'],
  engineeringReview: ['storeError'],
  /** the per-model registry lookup carries the RAW `read.error` on failure
   *  (resolvers.ts, module-datasheet binding). `boundDocumentId` — the accepted
   *  document identity — is NOT operational and stays in the digest. */
  'moduleDatasheetBinding.modules[].registryLookup': ['failure'],
};

/** The sentinel an operational field collapses to in the DIGESTED copy. The real
 *  value is never lost — it travels on `snapshot.resolverAttemptEvidence`. */
export const OPERATIONAL_ELIDED = '<operational>';

type Rec = Record<string, unknown>;

function scrubFields(obj: unknown, fields: readonly string[]): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const out: Rec = { ...(obj as Rec) };
  for (const f of fields) if (f in out && out[f] !== null && out[f] !== undefined) out[f] = OPERATIONAL_ELIDED;
  return out;
}

/**
 * Return a DIGEST-SAFE copy of the `resolutionAuthority` bag: identical in every
 * material respect, with the declared operational fields elided. Pure — the input
 * bag is not mutated, so the operational container still receives the real one.
 */
export function elideOperationalAuthority<T extends Rec>(bag: T): T {
  const out: Rec = { ...bag };

  const sdr = out.structuralDocumentRetrieval as Rec | null | undefined;
  if (sdr && Array.isArray(sdr.attempts)) {
    out.structuralDocumentRetrieval = {
      ...sdr,
      attempts: (sdr.attempts as unknown[]).map(a => {
        const scrubbed = scrubFields(a, OPERATIONAL_AUTHORITY_FIELDS['structuralDocumentRetrieval.attempts[]']) as Rec;
        if (scrubbed && typeof scrubbed.archival === 'object' && scrubbed.archival) {
          scrubbed.archival = scrubFields(scrubbed.archival, OPERATIONAL_AUTHORITY_FIELDS['structuralDocumentRetrieval.attempts[].archival']);
        }
        return scrubbed;
      }),
    };
  }

  const pp = out.projectPersonnel as Rec | null | undefined;
  if (pp) out.projectPersonnel = scrubFields(pp, OPERATIONAL_AUTHORITY_FIELDS.projectPersonnel) as Rec;

  const env = out.environmentalRetrieval as Rec | null | undefined;
  if (env && env.registryArchival && typeof env.registryArchival === 'object') {
    out.environmentalRetrieval = {
      ...env,
      registryArchival: scrubFields(env.registryArchival, OPERATIONAL_AUTHORITY_FIELDS['environmentalRetrieval.registryArchival']),
    };
  }

  const er = out.engineeringReview as Rec | null | undefined;
  if (er) out.engineeringReview = scrubFields(er, OPERATIONAL_AUTHORITY_FIELDS.engineeringReview) as Rec;

  const mdb = out.moduleDatasheetBinding as Rec | null | undefined;
  if (mdb && Array.isArray(mdb.modules)) {
    out.moduleDatasheetBinding = {
      ...mdb,
      modules: (mdb.modules as unknown[]).map(m => {
        const row = m as Rec;
        if (!row || typeof row !== 'object' || !row.registryLookup) return row;
        return {
          ...row,
          registryLookup: scrubFields(row.registryLookup, OPERATIONAL_AUTHORITY_FIELDS['moduleDatasheetBinding.modules[].registryLookup']),
        };
      }),
    };
  }

  return out as T;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3b — WHICH PROVIDER FAILURES ARE OPERATIONAL.
//
// `RetrievalFailure.failure` is one string carrying two different kinds of fact,
// and that is why collapsing it wholesale was wrong:
//
//   TRANSPORT / PARSE   — the attempt went wrong. "TimeoutError signal timed
//                         out". Says nothing about the site; varies run to run;
//                         must never reach the digest.
//   NO_COVERAGE         — the source ANSWERED and genuinely has nothing here.
//                         "ground snow load NOT retrieved". That is a fact about
//                         THIS SITE and is design authority.
//   AMBIGUOUS           — the source answered with MORE THAN ONE authority, both
//                         named. A real design finding requiring an operator.
//   NOT_CONFIGURED /    — a deployment or design fact, stable for a given
//   INSUFFICIENT_QUERY    deployment and design rather than per-run.
//
// So the split is by KIND, not by the string. The live 20-run observation is what
// forced this precision: three of twenty runs saw a Census outage, and the first
// (over-broad) repair would have thrown away the genuine "no AHJ record covers
// these coordinates" and "two authorities claim this parcel" findings with it.
// ═══════════════════════════════════════════════════════════════════════════

/** Failure kinds that describe the ATTEMPT rather than the site. */
export const OPERATIONAL_FAILURE_KINDS: ReadonlySet<string> = new Set(['TRANSPORT', 'PARSE']);

/**
 * The MATERIAL reason for a failed retrieval — safe to digest.
 *
 * Returns the provider's own sentence when the provider actually ANSWERED
 * (no coverage, ambiguity, an unformable query, a missing credential), and the
 * caller's stable sentence when the attempt merely failed to complete. The exact
 * provider text is never lost: it rides on `failureReason`, into
 * `snapshot.resolverAttemptEvidence`.
 */
export function materialRetrievalReason(args: {
  failureKind: string | null;
  providerFailure: string;
  /** the stable sentence used when the failure is operational. */
  whenOperational: string;
}): string {
  return args.failureKind && OPERATIONAL_FAILURE_KINDS.has(args.failureKind)
    ? args.whenOperational
    : args.providerFailure;
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE CONTAINER.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE declared home for operational resolver evidence on the snapshot.
 *
 * `computeSnapshotDigest` skips this ONE top-level key by name — the same
 * structural device it already uses for `meta.digest` / `meta.snapshotId`, and
 * deliberately NOT a recursive key-name rule. Keeping the evidence IN the stored
 * snapshot (rather than attaching it after the hash, as the PRR review record is)
 * means a stored snapshot still re-digests to its own `meta.digest`, so digest
 * re-verification of an archived package keeps working.
 */
export interface ResolverAttemptEvidenceBundle {
  /** the full lifecycle attempt trail, in execution order. */
  attempts: ResolverAttemptEvidence[];
  /** per requirement code — the attempts that bore on it, and the operational
   *  scalars that used to ride in the digested registry payload. */
  byRequirement: Record<string, {
    attemptedResolverIds: string[];
    attemptCount: number;
    lastResolutionAttempt: string | null;
    lastResolutionResult: string;
    retryability: string;
    confidence: number | null;
    evidence: ResolverAttemptEvidence[];
  }>;
  /** the operational fields elided from the digested `resolutionAuthority`
   *  records, kept verbatim so nothing is lost to troubleshooting. */
  authorityOperational: Record<string, unknown>;
}

/** Build the container from the lifecycle states + the untouched authority bag. */
export function buildResolverAttemptEvidence(
  states: Record<string, RequirementResolutionState>,
  attempts: readonly ResolverAttemptEvidence[],
  authorityBag: Rec | null,
): ResolverAttemptEvidenceBundle {
  const byRequirement: ResolverAttemptEvidenceBundle['byRequirement'] = {};
  for (const code of Object.keys(states).sort()) {
    const s = states[code];
    byRequirement[code] = {
      attemptedResolverIds: [...s.attemptedResolverIds],
      attemptCount: s.resolutionEvidence.length,
      lastResolutionAttempt: s.lastResolutionAttempt,
      lastResolutionResult: s.lastResolutionResult,
      retryability: s.retryability,
      confidence: s.confidence,
      evidence: [...s.resolutionEvidence],
    };
  }
  const authorityOperational: Record<string, unknown> = {};
  if (authorityBag) {
    const sdr = authorityBag.structuralDocumentRetrieval as Rec | null | undefined;
    if (sdr && Array.isArray(sdr.attempts)) authorityOperational.structuralDocumentRetrievalAttempts = sdr.attempts;
    const pp = authorityBag.projectPersonnel as Rec | null | undefined;
    if (pp && pp.storeError != null) authorityOperational.projectPersonnelStoreError = pp.storeError;
    const env = authorityBag.environmentalRetrieval as Rec | null | undefined;
    if (env && env.registryArchival) authorityOperational.environmentalRegistryArchival = env.registryArchival;
    const er = authorityBag.engineeringReview as Rec | null | undefined;
    if (er && er.storeError != null) authorityOperational.engineeringReviewStoreError = er.storeError;
    const mdb = authorityBag.moduleDatasheetBinding as Rec | null | undefined;
    if (mdb && Array.isArray(mdb.modules)) {
      authorityOperational.moduleDatasheetRegistryLookups = (mdb.modules as unknown[]).map(m => {
        const row = m as Rec;
        return { moduleModel: row?.moduleModel ?? null, registryLookup: row?.registryLookup ?? null };
      });
    }
  }
  return { attempts: [...attempts], byRequirement, authorityOperational };
}
