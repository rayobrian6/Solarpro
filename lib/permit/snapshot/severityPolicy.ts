// ═══════════════════════════════════════════════════════════════════════════
// BLOCKER SEVERITY POLICY (closeout §17 — CO-E, 2026-07-23)
// ───────────────────────────────────────────────────────────────────────────
// THE single, pure authority that decides whether a permit-readiness blocker is
// BLOCKING (prevents permit-ready / issue) or ADVISORY (surfaced, not gating).
//
// THE DOCUMENTED RULE (Ray's §17 contract):
//   A missing/unresolved fact is BLOCKING if it can affect ANY of the five
//   permit-acceptance axes — safety, code compliance, procurement, engineering
//   approval, or permit acceptance. It may be classified ADVISORY ONLY when it
//   can affect NONE of them, and every advisory classification MUST carry a
//   written justification string (rendered on RS-1) stating why.
//
// FAIL-CLOSED: any code without an explicit, justified policy entry is BLOCKING.
// A blocker can NEVER become advisory implicitly — the only path to advisory is
// an entry here whose impact touches no axis and whose justification is written.
//
// This module performs no engineering calculation and reads no snapshot — it is
// a pure classification over a static, documented policy table, so it is trivially
// testable (gate 19) and deterministic in the digest path.
// ═══════════════════════════════════════════════════════════════════════════

export type BlockerSeverity = 'blocking' | 'warning';

/** The five permit-acceptance impact axes (§17). A missing fact is BLOCKING if it
 *  can affect ANY of these; it may be ADVISORY only when it affects NONE. */
export interface SeverityImpact {
  /** personnel / equipment / fire safety — ampacity, derating, disconnect, RSD, fill. */
  safety: boolean;
  /** a code rule cannot be shown satisfied — NEC / IBC / IRC / IFC / ASCE. */
  codeCompliance: boolean;
  /** what gets ordered / installed — equipment identity, conductor/raceway, fastener, module. */
  procurement: boolean;
  /** the PE review / stamp depends on it — structural authority, engineering review. */
  engineeringApproval: boolean;
  /** the AHJ would reject or question the submitted set — project identity, legal authority. */
  permitAcceptance: boolean;
}

const NO_IMPACT: SeverityImpact = {
  safety: false, codeCompliance: false, procurement: false,
  engineeringApproval: false, permitAcceptance: false,
};

/** The documented rule made executable: advisory IFF the fact can affect none of
 *  the five axes; blocking as soon as any single axis is touched. */
export function severityFromImpact(i: SeverityImpact): BlockerSeverity {
  return (i.safety || i.codeCompliance || i.procurement || i.engineeringApproval || i.permitAcceptance)
    ? 'blocking'
    : 'warning';
}

export interface SeverityRule {
  /** which of the five axes the missing fact can affect. */
  impact: SeverityImpact;
  /** REQUIRED when the rule resolves to advisory: the written justification that
   *  the missing fact cannot affect any axis. Rendered on RS-1. Empty for blocking. */
  justification: string;
}

/**
 * Canonical, per-code severity policy. A code that is NOT listed here is treated
 * as BLOCKING (fail-closed): the ONLY way a blocker is advisory is an explicit,
 * justified entry whose impact touches no axis.
 */
export const SEVERITY_POLICY: Record<string, SeverityRule> = {
  // ── §17 PROMOTIONS — permit-critical missing facts, each affects ≥1 axis ─────
  // Unresolved required feeder conduit fill: an uncomputed fill can hide a
  // thermal-derating / ampacity violation (safety), cannot show NEC Ch.9 Table 1
  // satisfied (code), and an AHJ / PE will reject a raceway schedule that presents
  // PENDING as a passing zero-error result (engineering + permit acceptance).
  'CONDUIT-FILL-PENDING': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Unresolved supply-side tap-conductor length: the NEC 705.11(C) ≤10-ft rule
  // cannot be evaluated (code + safety), and no compliant claim may be made without
  // a length — the AHJ / PE will not accept the interconnection as shown.
  'TAP-CONDUCTOR-LENGTH-PENDING': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Missing exact selected-module electrical/mechanical datasheet: a family/range
  // page is not the exact source — the exact module drives conductor sizing /
  // structural load inputs (code + engineering), fixes procurement identity, and
  // an AHJ requires the exact-wattage datasheet for acceptance.
  'MODULE-EXACT-DATASHEET-PENDING': {
    impact: { safety: false, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // ── LEGITIMATELY ADVISORY (impact touches no axis; justification required) ────
  // The microinverter's electrical parameters are already taken from the canonical
  // equipment-db record the engine itself uses; only the archived manufacturer PDF
  // copy is absent, and APP-A openly discloses the equipment-db-unverified state.
  'EQUIPMENT-DOCUMENT-UNVERIFIED': {
    impact: NO_IMPACT,
    justification:
      'The microinverter electrical parameters are sourced from the canonical equipment-db record the engine already '
      + 'uses; only the archived manufacturer datasheet PDF is missing. No computed value, procurement selection, or code '
      + 'evaluation changes, and APP-A discloses the equipment-db-unverified state — so the missing archived document cannot '
      + 'affect safety, code compliance, procurement, engineering approval, or permit acceptance.',
  },
};

export interface SeverityClassification {
  severity: BlockerSeverity;
  /** non-empty IFF severity === 'warning'; '' for blocking. */
  justification: string;
}

/**
 * THE single authority for a blocker's severity + advisory justification.
 *
 * A code with a policy entry is classified from its declared impact (advisory only
 * when it touches no axis). Any UNMAPPED code fails closed to BLOCKING — a blocker
 * can never be downgraded to advisory without an explicit, justified policy entry.
 */
export function classifyBlockerSeverity(code: string): SeverityClassification {
  const rule = SEVERITY_POLICY[code];
  if (!rule) return { severity: 'blocking', justification: '' };   // fail-closed
  const severity = severityFromImpact(rule.impact);
  return { severity, justification: severity === 'warning' ? rule.justification : '' };
}

/**
 * Gate-19 self-consistency check for the policy table. Returns a list of human
 * error strings (empty ⇒ consistent):
 *  - an advisory entry MUST carry a non-empty justification;
 *  - a blocking entry MUST NOT carry an advisory justification;
 *  - (severityFromImpact is the sole classifier, so the two invariants above
 *    are the complete contract — impact→severity is total.)
 */
export function validateSeverityPolicy(): string[] {
  const errors: string[] = [];
  for (const [code, rule] of Object.entries(SEVERITY_POLICY)) {
    const sev = severityFromImpact(rule.impact);
    if (sev === 'warning' && !rule.justification.trim()) {
      errors.push(`${code}: advisory classification requires a written justification`);
    }
    if (sev === 'blocking' && rule.justification.trim()) {
      errors.push(`${code}: blocking classification must not carry an advisory justification`);
    }
  }
  return errors;
}
