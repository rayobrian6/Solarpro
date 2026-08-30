// ═══════════════════════════════════════════════════════════════════════════
// WHEN THE GOVERNMENT IS KNOWN AND THE PERMIT OFFICE IS NOT.
//
// Ray's ruling, 2026-08-30:
//
//   "Automatically queue governed authority discovery and hold only
//    authority-dependent permit release. Do not block design work. Do not
//    release a permit-ready package with the government merely substituted as
//    the AHJ. A design-review package may identify the verified legal government
//    and explicitly state that permitting-authority verification is in progress.
//    Once discovery establishes the permit department, applicable scopes,
//    provenance, and required code authority, persist the governed record,
//    re-resolve the project, rebuild the authority-dependent snapshot, and clear
//    the hold. Failure to discover must terminate in a typed manual-review
//    state, never fallback substitution."
//
// ── THE DISTINCTION THIS FILE PROTECTS ────────────────────────────────────
// "We do not know who governs" and "we know exactly who governs and have no
// record of their permit office" are different problems with different answers.
// The first is a geography failure. The second is a REGISTRY GAP against a named
// government — nationally the ordinary case, since SolarPro holds a record for
// about 22% of the governments that plausibly issue building permits.
//
// A registry gap must never be answered by substitution. It is answered by
// discovery, and until discovery completes the package is held at exactly one
// point: authority-dependent permit RELEASE. Design continues.
// ═══════════════════════════════════════════════════════════════════════════

import type { AuthorityScope } from './delegationPolicy';
import type { LegalGovernmentIdentity } from './legalGovernmentIdentity';

/**
 * The lifecycle of a permitting authority we do not yet hold.
 *
 * Every terminal state is TYPED. There is deliberately no state meaning "we gave
 * up and used the county instead".
 */
export type AuthorityDiscoveryState =
  /** geography named the government; we hold no permitting record for it. */
  | 'PERMITTING_AUTHORITY_RECORD_MISSING'
  /** queued automatically — no operator action was required to get here. */
  | 'DISCOVERY_QUEUED'
  | 'DISCOVERY_IN_PROGRESS'
  /** an official source named the department; scopes/codes not yet established. */
  | 'AUTHORITY_DISCOVERED'
  /** department, applicable scopes, provenance and code authority all established. */
  | 'AUTHORITY_VERIFIED'
  /** the governed record is persisted; the project must be re-resolved. */
  | 'GOVERNED_RECORD_PERSISTED'
  /** discovery ran and could not establish the authority. A HUMAN decides next.
   *  This is a terminal state, and it is NOT a licence to substitute. */
  | 'MANUAL_REVIEW_REQUIRED';

export const DISCOVERY_TERMINAL_STATES: readonly AuthorityDiscoveryState[] = [
  'GOVERNED_RECORD_PERSISTED', 'MANUAL_REVIEW_REQUIRED',
];

/** What a discovered authority must carry before it counts as verified (§14). */
export interface DiscoveredAuthorityEvidence {
  departmentName: string;
  scopes: AuthorityScope[];
  /** the official page/document the department was read from. */
  sourceUrl: string;
  retrievedAtIso: string;
  /** adopted-code evidence — a bare edition year is a claim, not an adoption. */
  codeAuthority: { sourceUrl: string; retrievedAtIso: string } | null;
}

export interface AuthorityDiscoveryRecord {
  state: AuthorityDiscoveryState;
  /** the government we are discovering an office FOR. Always present: this
   *  lifecycle only exists because the government is already established. */
  government: LegalGovernmentIdentity;
  /** display name for the reviewer, from the legal-geography source. */
  governmentName: string;
  evidence: DiscoveredAuthorityEvidence | null;
  /** why discovery failed, when it did. Never null in MANUAL_REVIEW_REQUIRED. */
  failureReason: string | null;
  queuedAtIso: string | null;
}

/** A newly identified gap enters the lifecycle already queued — automatically. */
export function openDiscovery(
  government: LegalGovernmentIdentity, governmentName: string, nowIso: string,
): AuthorityDiscoveryRecord {
  return {
    state: 'DISCOVERY_QUEUED',
    government, governmentName,
    evidence: null, failureReason: null, queuedAtIso: nowIso,
  };
}

/** Discovery succeeded only when every element §14 demands is present. */
export function isFullyVerified(e: DiscoveredAuthorityEvidence | null): boolean {
  return !!e && !!e.departmentName.trim() && e.scopes.length > 0
    && !!e.sourceUrl.trim() && !!e.retrievedAtIso.trim()
    && !!e.codeAuthority?.sourceUrl && !!e.codeAuthority?.retrievedAtIso;
}

// ── THE HOLD ──────────────────────────────────────────────────────────────

/** What a missing permitting authority is allowed to stop. */
export interface AuthorityHold {
  /** design work — layout, engineering, BOM. NEVER held. */
  blocksDesign: false;
  /** a design-review package may go out, naming the verified government and
   *  saying plainly that permitting-authority verification is in progress. */
  blocksDesignReview: false;
  /** authority-dependent permit RELEASE. Held until discovery completes. */
  blocksPermitRelease: boolean;
  /** the sentence a reviewer reads. Names the government; never a substitute. */
  basis: string;
}

/**
 * Decide the hold for a discovery record.
 *
 * The shape is deliberately asymmetric: `blocksDesign` and `blocksDesignReview`
 * are the literal type `false`, so no future edit can widen the hold into design
 * work without changing the type and being noticed. Only permit release is a
 * variable.
 */
export function authorityHoldFor(rec: AuthorityDiscoveryRecord | null): AuthorityHold {
  if (!rec) {
    return {
      blocksDesign: false, blocksDesignReview: false, blocksPermitRelease: false,
      basis: 'no permitting-authority gap is open for this project.',
    };
  }
  const who = `${rec.governmentName} (${rec.government.entityType}, `
    + `${rec.government.placeGeoid ? `place ${rec.government.placeGeoid}`
      : rec.government.mcdGeoid ? `MCD ${rec.government.mcdGeoid}`
      : rec.government.countyFips ? `county ${rec.government.countyFips}`
      : `state ${rec.government.stateFips}`})`;

  if (rec.state === 'GOVERNED_RECORD_PERSISTED') {
    return {
      blocksDesign: false, blocksDesignReview: false, blocksPermitRelease: false,
      basis: `The permitting authority for ${who} has been established and persisted; `
        + 'the project must be re-resolved against the governed record before release.',
    };
  }

  if (rec.state === 'MANUAL_REVIEW_REQUIRED') {
    return {
      blocksDesign: false, blocksDesignReview: false, blocksPermitRelease: true,
      basis: `Automatic discovery could not establish the permitting authority for ${who}`
        + `${rec.failureReason ? ` — ${rec.failureReason}` : ''}. A person must identify the permit `
        + 'office before this package can be released for permit. No county, mailing city or '
        + 'neighbouring jurisdiction has been substituted, and none will be.',
    };
  }

  return {
    blocksDesign: false, blocksDesignReview: false, blocksPermitRelease: true,
    basis: `The governing legal authority for this parcel is ${who}. SolarPro holds no verified `
      + 'permitting-authority record for it, so authority verification is IN PROGRESS and permit '
      + 'release is held. Design and design review are unaffected. The government is named above; '
      + 'it has not been replaced by a substitute.',
  };
}

/**
 * Advance the lifecycle on a discovery result.
 *
 * Partial evidence does NOT verify. A department name with no adopted-code
 * provenance leaves the record at AUTHORITY_DISCOVERED and the hold in place,
 * because a permit package cites codes.
 */
export function applyDiscoveryResult(
  rec: AuthorityDiscoveryRecord,
  result: { evidence: DiscoveredAuthorityEvidence | null; failureReason?: string | null },
): AuthorityDiscoveryRecord {
  if (!result.evidence) {
    return { ...rec, state: 'MANUAL_REVIEW_REQUIRED', evidence: null,
      failureReason: result.failureReason ?? 'no official source established the permit office' };
  }
  return {
    ...rec,
    state: isFullyVerified(result.evidence) ? 'AUTHORITY_VERIFIED' : 'AUTHORITY_DISCOVERED',
    evidence: result.evidence,
    failureReason: isFullyVerified(result.evidence) ? null
      : 'discovered, but the record is not yet complete — a permit package cites adopted codes, '
        + 'so an authority without code-adoption provenance cannot clear the hold',
  };
}

/** Persisting is only permitted from a fully verified record (§14). */
export function persistGovernedRecord(rec: AuthorityDiscoveryRecord): AuthorityDiscoveryRecord {
  if (rec.state !== 'AUTHORITY_VERIFIED' || !isFullyVerified(rec.evidence)) {
    throw new Error(
      `refusing to persist an unverified permitting authority for ${rec.governmentName}: `
      + `state=${rec.state}. A record born without department, scopes, provenance and code `
      + 'authority is exactly the keyless row this campaign removed.');
  }
  return { ...rec, state: 'GOVERNED_RECORD_PERSISTED' };
}
