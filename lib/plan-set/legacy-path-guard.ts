// ═══════════════════════════════════════════════════════════════════════════
// W3.1 §3 — PARALLEL-PATH CONTAINMENT (fail closed).
//
// The reachable `lib/plan-set/*` generators and the `/api/engineering/plan-set`
// route are a SECOND, divergent structural/compliance surface that historically
// hardcoded `structuralStatus = 'PASS'` and `overallCompliance: 'PASS'` without
// ever consuming or validating the canonical PermitDesignSnapshot.
//
// This module makes a PASS / permit-ready declaration STRUCTURALLY IMPOSSIBLE on
// that path unless a VALID canonical PermitDesignSnapshot (real snapshot id +
// digest + completed validators with zero blockers) is consumed and validated.
// The route does NOT consume a snapshot, so `resolveLegacyPathStatus(null)` is
// forced into the explicit LEGACY state every time it runs today.
//
// Fail closed: absence/invalid snapshot ⇒ LEGACY state, never PASS.
// This is a CONTAINMENT (not a conversion). The permanent convert-or-delete
// decision is W4; the bypass is neutralized now.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

/** The exact visible/status string stamped on legacy-path outputs. */
export const LEGACY_PATH_BANNER = 'LEGACY PATH — NOT FOR PERMIT / PENDING CANONICAL MIGRATION';

/** Status enum for the parallel plan-set path. A structural PASS can ONLY be
 *  emitted as `STRUCTURAL_PASS`; every fail-closed path yields the legacy value. */
export type PlanSetStructuralStatus = 'STRUCTURAL_PASS' | 'LEGACY_NOT_FOR_PERMIT';

/** The sole legacy status value. Sheets detect this to render the banner. */
export const LEGACY_STRUCTURAL_STATUS: PlanSetStructuralStatus = 'LEGACY_NOT_FOR_PERMIT';

export interface PlanSetPathResolution {
  isLegacy: boolean;
  /** structuralStatus fed into the S-1 / C-1 sheet builders. */
  structuralStatus: PlanSetStructuralStatus;
  permitReady: boolean;
  approved: boolean;
  compliant: boolean;
  /** overall compliance string for the API response — 'PASS' ONLY when canonical. */
  overallCompliance: string;
  /** the visible banner (LEGACY_PATH_BANNER) when legacy, else null. */
  banner: string | null;
  reason: string;
}

/**
 * A snapshot is PERMIT-VALID only when it carries a real snapshot id + digest AND
 * its validators completed clean: permitReadiness.ready === true with an EMPTY
 * blockers list. Anything missing, malformed, not-ready, or still-blocked ⇒ NOT
 * valid. Fail closed.
 */
export function isSnapshotPermitValid(
  s: PermitDesignSnapshot | null | undefined,
): s is PermitDesignSnapshot {
  if (!s || typeof s !== 'object' || !s.meta) return false;
  const id = s.meta.snapshotId;
  const digest = s.meta.digest;
  // snapshot id is content-derived: 'PDS-' + digest prefix
  if (typeof id !== 'string' || !/^PDS-/.test(id)) return false;
  // digest is a SHA-256 hex — require a non-trivial hex string
  if (typeof digest !== 'string' || !/^[0-9a-f]{16,}$/i.test(digest)) return false;
  const pr = s.permitReadiness;
  if (!pr || pr.ready !== true) return false;
  if (!Array.isArray(pr.blockers) || pr.blockers.length > 0) return false;
  return true;
}

/**
 * Resolve the legacy-path status. Pass the snapshot the path actually consumed
 * and validated (the plan-set route consumes NONE, so it passes null → LEGACY).
 * A PASS/permit-ready declaration is returned ONLY for a valid canonical snapshot.
 */
export function resolveLegacyPathStatus(
  snapshot: PermitDesignSnapshot | null | undefined,
): PlanSetPathResolution {
  if (isSnapshotPermitValid(snapshot)) {
    return {
      isLegacy: false,
      structuralStatus: 'STRUCTURAL_PASS',
      permitReady: true,
      approved: true,
      compliant: true,
      overallCompliance: 'PASS',
      banner: null,
      reason: 'validated canonical PermitDesignSnapshot consumed (id + digest + validators complete)',
    };
  }
  return {
    isLegacy: true,
    structuralStatus: LEGACY_STRUCTURAL_STATUS,
    permitReady: false,
    approved: false,
    compliant: false,
    overallCompliance: LEGACY_PATH_BANNER,
    banner: LEGACY_PATH_BANNER,
    reason: snapshot
      ? 'snapshot present but failed permit-validation — fail closed to legacy state'
      : 'no canonical PermitDesignSnapshot consumed on this path — fail closed to legacy state',
  };
}

/** True when a sheet builder was handed the legacy status. */
export function isLegacyStructuralStatus(status: string | null | undefined): boolean {
  return status === LEGACY_STRUCTURAL_STATUS;
}
