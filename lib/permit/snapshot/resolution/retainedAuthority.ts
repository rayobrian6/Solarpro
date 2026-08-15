// ═══════════════════════════════════════════════════════════════════════════
// OAR §0 — A REFRESH FAILURE IS NOT AN AUTHORITY CHANGE.
//
// Two resolvers treated "I could not look this up right now" as "this is not
// established", and both silently replaced accepted authority with something
// weaker.
//
// DEFECT A — measured, real path, one fixed design, Census forced to time out:
//     bundle.legalJurisdiction
//       "Madison County Building & Zoning"  [verified]   id=il-madison-county
//         → "City of Granite City Building & Zoning" [unverified] id=il-madison-granite-city
//     resolutionAuthority.projectLegalAuthority   PRESENT → NULL
//     project.ahjName (RENDERED on the sheets)    Madison County → City of Granite City
// The county is the legal AHJ; Granite City is the MAILING city, seeded by
// `project-authority-key@v1` from the posted record. So a one-second Census
// outage did not merely reopen a requirement and move the digest — it re-stamped
// the package with the wrong jurisdiction, and (because `legalUsable` gates
// document archival in structuralResolvers) blocked archival at the same time.
// This is D4's defect reappearing at runtime, driven by transport health.
//
// DEFECT B — `racking-documents@v1` builds `documentRegistryIdentities` ONLY
// from attempts whose `outcome === 'RETRIEVED'` in THIS run. The registry rows
// are durable in Postgres and the document id is content-derived, but the
// resolver only ever reaches them through `getDocument(id)` AFTER a successful
// fetch produced the hash. So zero retrievals ⇒ zero identities ⇒
// `selectEquipmentDocument` falls from REGISTRY_CANDIDATE to STATIC_ASSET and
// the design cites an unhashed render cache instead of the archived document it
// already had. Measured: 111 canonical-body leaf paths moved.
//
// THE RULE, for both:
//     accepted durable authority  >  temporary retrieval health
//
// A refresh that cannot complete leaves the accepted authority exactly as it
// was and records the failure operationally. Authority changes only through a
// governed material event — a new verified determination, an explicit
// invalidation, a proven-corrupt source, an operator correction.
//
// WHAT THIS MUST NOT DO — retention is not promotion. An unverified retained
// record stays unverified; a withdrawn document stays withdrawn; a missing hash
// stays missing. Preserving identity never authorises inventing evidence, and
// the D4 rule that only a VERIFIED boundary may stamp a document is untouched.
// ═══════════════════════════════════════════════════════════════════════════

import type { LegalJurisdictionAuthority } from './types';
import type { ProjectLegalAuthorityRecord } from './jurisdictionAuthority';
import type { RegistryDocumentIdentity } from '../documentAuthority';
import type { RegistryDocument } from '@/lib/documents/types';
import { OPERATIONAL_FAILURE_KINDS } from './authorityProjection';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE STATES
// ═══════════════════════════════════════════════════════════════════════════

/** What happened to the LEGAL JURISDICTION authority on this run. */
export type LegalAuthorityRetentionState =
  /** nothing has ever been established — a failure here is honestly unresolved. */
  | 'NO_RETAINED_AUTHORITY'
  /** a governed retained authority exists and no refresh was attempted. */
  | 'RETAINED_AUTHORITY_CURRENT'
  /** the refresh completed and named the same authority. */
  | 'REFRESH_SUCCEEDED_SAME_AUTHORITY'
  /** the refresh completed and named a DIFFERENT verified authority — a governed
   *  supersession. The digest moves; D11 handles the approval. */
  | 'REFRESH_SUCCEEDED_CHANGED_AUTHORITY'
  /** the refresh could not complete. The retained authority stands. */
  | 'REFRESH_FAILED_RETAINED'
  /** the refresh disagrees with the retained authority but is not itself
   *  governed. Neither side is auto-adopted. */
  | 'AUTHORITY_CONFLICT';

/** What happened to the accepted REGISTRY DOCUMENT authority on this run. */
export type RegistryAuthorityRetentionState =
  | 'NO_REGISTRY_AUTHORITY'
  /** durable registry rows exist for the selected equipment. */
  | 'REGISTRY_AUTHORITY_ACCEPTED'
  | 'RETRIEVAL_SUCCEEDED'
  /** retrieval failed; the accepted registry rows still stand. */
  | 'RETRIEVAL_FAILED_RETAINED'
  | 'REGISTRY_DOCUMENT_CHANGED'
  /** withdrawn / unarchived / unhashed — genuinely not usable authority. */
  | 'REGISTRY_AUTHORITY_INVALID';

// ═══════════════════════════════════════════════════════════════════════════
// §2 — WHAT MAY BE RETAINED (the D4 guard)
// ═══════════════════════════════════════════════════════════════════════════

/** The accepted legal authority carried forward from the last governed run. */
export interface RetainedLegalAuthority {
  jurisdiction: LegalJurisdictionAuthority;
  record: ProjectLegalAuthorityRecord | null;
}

/**
 * GOVERNED, not merely present.
 *
 * Retention is only allowed for an authority that was VERIFIED when it was
 * accepted and that carries a stable `ahjRecordId` — exactly the two conditions
 * `structuralResolvers` already requires before a document may be stamped
 * (`legalUsable`). An `unverified` or `conflict` record is NOT retained as
 * authority: carrying it forward would let retention quietly promote something
 * the D4 rules refuse, which is the opposite of the point.
 */
export function isGovernedLegalAuthority(
  j: LegalJurisdictionAuthority | null | undefined,
): j is LegalJurisdictionAuthority {
  return !!j
    && j.verificationState === 'verified'
    && typeof j.ahjRecordId === 'string'
    && j.ahjRecordId.trim().length > 0;
}

/** Two accepted legal authorities are the SAME authority when they name the same
 *  jurisdiction record at the same verification state from the same evidence.
 *  Identity is `ahjRecordId`; the name is a display projection (D4). */
export function sameLegalAuthority(
  a: LegalJurisdictionAuthority | null | undefined,
  b: LegalJurisdictionAuthority | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.ahjRecordId === b.ahjRecordId
    && a.verificationState === b.verificationState
    && a.jurisdictionType === b.jurisdictionType
    && a.county === b.county
    && a.stateCode === b.stateCode
    && a.unincorporated === b.unincorporated
    && (a.provenance?.ref ?? null) === (b.provenance?.ref ?? null);
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — READING THE RETAINED AUTHORITY OFF THE PRIOR SNAPSHOT
//
// There is no separate authority store, and this phase does not create one: the
// last accepted authority is already durable, inside the snapshot the last
// governed run froze into `permit_input.json`. The route already reaches into
// exactly that file for `_priorSnapshotDigest`; this reads two more fields from
// the same place.
// ═══════════════════════════════════════════════════════════════════════════

interface PriorSnapshotCarrier {
  _priorSnapshot?: unknown;
  _snapshot?: unknown;
}

/** The prior snapshot, if the input carries one. `_priorSnapshot` is written by
 *  the route from the stored artifact; `_snapshot` is the in-memory copy a
 *  regeneration still holds when the resolvers run (generatePermit overwrites it
 *  only after the build). */
export function readPriorSnapshot(input: unknown): Record<string, unknown> | null {
  const c = (input ?? {}) as PriorSnapshotCarrier;
  const s = (c._priorSnapshot ?? c._snapshot) as Record<string, unknown> | undefined;
  return s && typeof s === 'object' ? s : null;
}

/**
 * The GOVERNED retained legal authority, or null.
 *
 * Returns null — never a guess — when there is no prior snapshot, when it holds
 * no accepted jurisdiction, or when what it holds was not verified.
 */
export function readRetainedLegalAuthority(input: unknown): RetainedLegalAuthority | null {
  const snap = readPriorSnapshot(input);
  const ra = snap?.resolutionAuthority as Record<string, unknown> | undefined;
  if (!ra) return null;
  const jurisdiction = ra.legalJurisdiction as LegalJurisdictionAuthority | null | undefined;
  if (!isGovernedLegalAuthority(jurisdiction)) return null;
  const record = (ra.projectLegalAuthority as ProjectLegalAuthorityRecord | null | undefined) ?? null;
  // A record that was not itself verified cannot back a 'verified' jurisdiction.
  // Refuse rather than retain a jurisdiction whose evidence disagrees with it.
  if (record && record.verified !== true) return null;
  return { jurisdiction, record };
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — WHEN A FAILURE IS "WE COULD NOT LOOK"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retention applies to a failure that means the lookup did not COMPLETE —
 * `TRANSPORT` / `PARSE`. It deliberately does NOT apply to `NO_COVERAGE` or
 * `AMBIGUOUS`: those are the source ANSWERING about this site, and masking a
 * genuine "this parcel is no longer in that jurisdiction" as an outage is the
 * failure mode this whole area exists to prevent. `NOT_CONFIGURED` /
 * `INSUFFICIENT_QUERY` are deployment or input facts and are equally not outages.
 */
export function isRefreshOutage(failureKind: string | null | undefined): boolean {
  return !!failureKind && OPERATIONAL_FAILURE_KINDS.has(failureKind);
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — DURABLE REGISTRY DOCUMENT AUTHORITY
//
// The registry row IS the accepted authority. Retrieval is the INGESTION path
// that puts bytes and a hash into it — `racking-documents@v1` says so itself
// ("Retrieval establishes existence + bytes, never applicability"). So the
// candidate pool `selectEquipmentDocument` reasons over must be read from the
// registry, not re-derived from whichever fetches happened to succeed today.
// ═══════════════════════════════════════════════════════════════════════════

/** Project a durable registry row onto the identity shape the document
 *  precedence rule consumes. NOTHING is invented: every field is reported
 *  exactly as the registry holds it, and a row with no archive or no hash stays
 *  un-archived and un-hashed so `selectEquipmentDocument` refuses to promote it. */
export function registryRowToIdentity(d: RegistryDocument): RegistryDocumentIdentity {
  return {
    documentId: d.id,
    documentClass: d.documentClass,
    manufacturerOrIssuer: d.manufacturerOrIssuer ?? null,
    equipmentId: d.equipmentId ?? null,
    equipmentModelApplicability: d.equipmentModelApplicability ?? null,
    title: d.title ?? null,
    revision: d.revision ?? null,
    documentDate: d.documentDate ?? null,
    sourceUrl: d.source ?? d.archivedFileIdentity ?? null,
    archivedFileIdentity: d.archivedFileIdentity ?? null,
    archivedInRepo: d.archivedInRepo === true,
    sha256: d.sha256 ?? null,
    status: d.status ?? null,
    verificationState: d.verificationState ?? 'unverified',
    verificationActor: d.verifiedBy ?? null,
    verificationActorKind: null,
    verificationBasis: d.verificationNotes ?? null,
    jurisdictionAuthorityId: d.jurisdictionAuthorityId ?? null,
    jurisdictionBoundary: d.jurisdictionBoundary ?? null,
  };
}

/** A registry row is USABLE authority when it is archived, hashed and not
 *  withdrawn — the same three conditions `selectEquipmentDocument` applies
 *  before it will cite a row at all. Anything else is REGISTRY_AUTHORITY_INVALID
 *  and must not be masked as an outage. */
export function isUsableRegistryAuthority(d: RegistryDocumentIdentity): boolean {
  return d.archivedInRepo === true
    && typeof d.sha256 === 'string' && d.sha256.trim().length > 0
    && (d.status ?? '').toLowerCase() !== 'withdrawn';
}

/** Merge durable rows with this run's freshly-retrieved ones, newest identity
 *  winning per documentId. Deterministic: sorted by documentId so the projection
 *  cannot depend on query or retrieval order. */
export function mergeRegistryIdentities(
  durable: readonly RegistryDocumentIdentity[],
  retrieved: readonly RegistryDocumentIdentity[],
): RegistryDocumentIdentity[] {
  const byId = new Map<string, RegistryDocumentIdentity>();
  for (const d of durable) byId.set(d.documentId, d);
  for (const r of retrieved) byId.set(r.documentId, r);   // a fresh read supersedes
  return [...byId.values()].sort((a, b) => a.documentId.localeCompare(b.documentId));
}
