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
  // PROCUREMENT IS NOT A PERMIT AXIS (2026-08-27). This severity is the PERMIT-readiness verdict —
  // "may this package be issued". Procurement readiness is a different release with its own
  // authority: ECD W1-B tracks it per BOM row (`procurement.blockingRequirementCodes`) and rows are
  // held non-orderable there. Counting procurement here as well double-counted it, and made a
  // package unissuable over a missing distributor part number — which no AHJ asks for.
  // A requirement that touches procurement AND a permit axis still blocks, on that other axis.
  // Blast radius when this changed: exactly one code, RACKING-ASSEMBLY-SKU-PROCUREMENT (measured;
  // 18 other codes declare procurement alongside a permit axis and are unaffected).
  return (i.safety || i.codeCompliance || i.engineeringApproval || i.permitAcceptance)
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

  // §13 (CO-C) — the roof-attachment fastener assembly is UNVERIFIED (its
  // withdrawal-capacity source document is not archived / the racking-capacity
  // authority is gated). This is mount-BASE hardware, verifiable independent of
  // the rail selection, so it carries its OWN blocker code (a relationship note
  // to PENDING-RACKING-ASSEMBLY-SELECTION is rendered on RS-1, not a parent code).
  // It affects the attachment uplift path (safety), cannot show the NEC/IBC
  // attachment detail satisfied (code), fixes the ordered fastener SKU
  // (procurement), and the PE stamp depends on a verified fastener assembly
  // (engineering) — so it is BLOCKING.
  'FASTENER-ASSEMBLY-UNVERIFIED': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // §12 (CO-C) — the cited manufacturer install/detail document covers a DIFFERENT
  // product version than the selected mount (RT-MINI II manual vs selected RT-MINI)
  // and no VERIFIED cross-reference/alias evidence record establishes applicability.
  // The attachment detail / spacing / fastener callouts on PV-3 / DS-3 / APP-A
  // cannot be shown applicable to the selected SKU (code + engineering approval),
  // and an AHJ requires the applicable-product document — so it is BLOCKING.
  'EQUIPMENT-DOCUMENT-APPLICABILITY': {
    impact: { safety: false, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // §Q (2026-07-24) — Q-CABLE PROCUREMENT INSUFFICIENCY. The Σ geometric
  // designed-installed cable path exceeds the drop-based procurement footage (the
  // ordered listed cable is SHORT of the as-routed installed path). This directly
  // affects WHAT GETS ORDERED (procurement — the base cable quantity cannot be the
  // orderable total), the ENGINEERING APPROVAL (a design whose ordered cable does
  // not reach the installed path cannot be approved by assertion — "jumpers
  // required" is not a solution without a verified extension product), and PERMIT
  // ACCEPTANCE (the reviewer/AHJ sees a package whose BOM cannot build the drawn
  // circuit). Cleared ONLY by a VERIFIED CableExtensionSolution — never by a
  // free-text note. So it is BLOCKING.
  'QCABLE-PROCUREMENT-INSUFFICIENT': {
    impact: { safety: false, codeCompliance: false, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // GROUNDING AUTHORITY (2026-07-25) — QCABLE-GROUNDING-AUTHORITY-UNVERIFIED. The
  // equipment grounding / bonding method for the OPEN-AIR microinverter branch
  // (listed cable assembly) section is not established by a verified,
  // exactly-applicable manufacturer document. An unestablished equipment-grounding
  // path is a fault-clearing / touch-safety question (safety); NEC 110.3(B) cannot
  // be shown satisfied and neither 250.122 nor 690.43(C) may be concluded (code);
  // whether an EGC is ordered at all — and the racking/bonding hardware that
  // accompanies it — depends on the outcome (procurement); no PE stamps a grounding
  // method that no document supports (engineering approval); and an AHJ rejects a
  // package whose grounding method is asserted without the manufacturer instruction
  // (permit acceptance). All five axes ⇒ BLOCKING. Conductor count, a family
  // document or an engineering opinion can never clear it.
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // §2 (BAR, 2026-07-25) — ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED (successor to
  // WIND-SNOW-AUTHORITY-UNRESOLVED, subsuming BOTH the null/code-minimum-default
  // and the operator-entered-without-provenance cases). Unverified wind/snow/
  // exposure/risk directly drive the structural demand (attachment uplift, rail /
  // framing loads → safety), cannot show the ASCE 7 wind/snow criteria satisfied
  // (code), the PE stamp depends on verified design criteria (engineering), and an
  // AHJ will not accept design loads presented as verified without an archived
  // climate-hazard source (permit acceptance). So it is BLOCKING. (Fail-closed
  // would already block it; the explicit entry documents the impact.)
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RGM (2026-07-26) — IMPACT-AXIS COMPLETION. Every code the snapshot build can
  // emit now carries an EXPLICIT impact declaration, so the five permit-acceptance
  // axes are complete at their single source and the hierarchical release-gate
  // model (releaseGates.ts) can DERIVE each requirement's release impact from
  // here rather than from a per-code list of its own.
  //
  // NO SEVERITY OUTCOME CHANGES: every entry below touches ≥1 axis, so each
  // classifies BLOCKING with an empty justification — byte-identical to the
  // fail-closed result these codes already produced. The registry (and therefore
  // the snapshot digest) is unaffected. Advisory reclassification is impossible
  // here: that still requires an entry whose impact touches NO axis plus a
  // written justification, and none is added.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── electrical ───────────────────────────────────────────────────────────────
  // Run lengths that are CAD ESTIMATES: voltage drop cannot be shown satisfied
  // (code), the ordered conductor/raceway footage derives from them (procurement),
  // and no PE/AHJ accepts length-dependent results presented as authoritative
  // (engineering + acceptance). Ampacity/OCPD do not depend on length ⇒ safety
  // is NOT touched by the estimate itself.
  'ROUTE-LENGTH-ESTIMATE': {
    impact: { safety: false, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // No resolved feeder raceway/conduit type: derating + bonding are unknown
  // (safety), NEC raceway/bonding articles cannot be shown satisfied (code), the
  // raceway is an ordered item (procurement), and the set is not reviewable.
  'FEEDER-RACEWAY-AUTHORITY': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // An ambiguous branch raceway model (open-air trunk vs shared home-run) hides
  // the shared-circuit count and its fill/derating — all five axes.
  'BRANCH-RACEWAY-AUTHORITY': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // One physical run resolving to two raceway types/sizes is a contradiction the
  // schedule would print — all five axes.
  'RACEWAY-SEGMENT-CONFLICT': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // ── equipment identity / documents ───────────────────────────────────────────
  // Two stored authorities disagree about WHICH module is installed: conductor
  // sizing + structural inputs follow the module (code + engineering), the ordered
  // module is the conflict itself (procurement), and the AHJ set would name the
  // wrong equipment (acceptance). Operator-only reconciliation.
  'EQUIPMENT-IDENTITY-CONFLICT': {
    impact: { safety: false, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Module catalog dimensions absent: footprints/layout cannot be built and the
  // ordered module identity is not pinned.
  'MODULE-DIMENSIONS-UNVERIFIED': {
    impact: { safety: false, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // ── code / project identity / professional workflow ──────────────────────────
  // Adopted editions unknown: no code rule can be shown satisfied against a known
  // edition, and the PE/AHJ require the governing editions.
  'CODE-AUTHORITY-INCOMPLETE': {
    impact: { safety: false, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Governed ordinances disagree. A stated basis IS printed (the state adoption) and both claims
  // are disclosed, so the set is reviewable — but the LOCAL edition cannot be called established,
  // and a code rule shown satisfied against the wrong edition is a code-compliance exposure.
  'CODE-AUTHORITY-CONFLICT': {
    impact: { safety: false, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Project legal authority operator-posted / postally inferred: the AHJ would
  // reject or question the submitted identity. No engineering value changes.
  'PROJECT-AUTHORITY-UNVERIFIED': {
    impact: { safety: false, codeCompliance: false, procurement: false, engineeringApproval: false, permitAcceptance: true },
    justification: '',
  },
  // A non-production ("TEST") identity is an ADMINISTRATIVE hold: nothing
  // computed is wrong, but the set can never be accepted / issued as shown.
  'PROJECT-NAME-NONPRODUCTION': {
    impact: { safety: false, codeCompliance: false, procurement: false, engineeringApproval: false, permitAcceptance: true },
    justification: '',
  },
  // No designer / engineer-of-record: nothing can be stamped or accepted.
  'DESIGNER-OF-RECORD-MISSING': {
    impact: { safety: false, codeCompliance: false, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // No approved engineering review covering the CURRENT digest — the stamp is the
  // missing fact itself; a workflow requirement, not an engineering defect.
  'ENGINEERING-REVIEW-PENDING': {
    impact: { safety: false, codeCompliance: false, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },

  // ── structural authority lane ────────────────────────────────────────────────
  // No verified framing CAPACITY authority: the attachment/framing demand path is
  // unproven (safety), IBC/IRC cannot be shown satisfied (code), the stamp depends
  // on it (engineering), and the AHJ requires the basis (acceptance). Nothing
  // ordered changes ⇒ procurement untouched.
  'FRAMING-AUTHORITY-UNVERIFIED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  'STRUCTURAL-FRAMING-UNVERIFIED': {   // legacy alias of the above
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Exact rail/splice SKU unpinned ⇒ the ordered assembly is undetermined AND its
  // span/capacity basis is unverified — all five axes.
  // GOVERNING-CANDIDATE ENVELOPE (2026-08-27) — an unpinned rail SKU used to declare all five axes
  // and hold an entire drawing set on a distributor line item. It only fires now when the rail
  // bending envelope HAS been bounded: the demand M = w·L²/8 does not depend on which rail is
  // fitted, so when the WEAKEST span-screened candidate carries it, every listed candidate does.
  // The drawing specifies the rail by performance and is complete; only the orderable part number
  // is outstanding, which touches procurement ALONE. When the envelope canNOT be bounded, the
  // design really does depend on the rail and RACKING-RAIL-CAPACITY-UNBOUNDED fires instead —
  // blocking, with all five axes, exactly as this code used to.
  'PENDING-RACKING-ASSEMBLY-SELECTION': {
    impact: { safety: false, codeCompliance: false, procurement: true, engineeringApproval: false, permitAcceptance: false },
    justification: 'The rail is specified by performance on the drawing and the weakest span-screened listed '
      + 'candidate carries the bending demand (M = w·L²/8 does not depend on the rail fitted), so every listed '
      + 'candidate is adequate and the design does not change with the choice. Only the orderable part number is '
      + 'outstanding: it is held on the BOM row by the procurement authority, and no AHJ conditions a permit on a '
      + 'distributor line item.',
  },
  // The blocking sibling: the SKU is unpinned AND the bending envelope could not be bounded from
  // the screened candidates, so the design genuinely depends on which rail is fitted.
  'RACKING-RAIL-CAPACITY-UNBOUNDED': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Capacity source NOT ARCHIVED / not applicable to the exact assembly: the
  // allowable cannot be verified against a source of record. Capacity is NOT YET
  // ESTABLISHED — no capacity has been shown to fail. The ordered hardware does
  // not change ⇒ procurement untouched.
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  'RACKING-CAPACITY-APPLICABILITY-GAP': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // An ultimate-basis value refused as an ASD allowable — the allowable in use is
  // not traceable to a stamped report.
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // No published allowable attachment-capacity source resolved at all.
  'ATTACHMENT-CAPACITY-SOURCE-MISSING': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Fastener model / count / embedment incomplete: the uplift path is unproven and
  // the ordered fastener is undetermined.
  'FASTENER-CONFIG-MISSING': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Mixed-manufacturer assembly with no documented compatibility/capacity.
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Mounting topology not DECLARED (product-name inference is prohibited): rails,
  // attachment pattern, BOM and load path all follow the topology.
  'MOUNT-TOPOLOGY-UNKNOWN': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Rail-less attachment coordinates not derivable ⇒ mount coordinates and
  // reactions are not traceable, and the attachment count drives procurement.
  'DIRECT-MOUNT-GEOMETRY-MISSING': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Reactions / rail quantities / BOM that do not reconcile with the canonical
  // objects: a computed result cannot be presented as authoritative.
  'REACTIONS-UNTRACEABLE': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  'RAIL-QUANTITY-UNTRACEABLE': {
    impact: { safety: false, codeCompliance: false, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  'STRUCTURAL-BOM-RECONCILIATION-FAILED': {
    impact: { safety: false, codeCompliance: false, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // A computed demand EXCEEDS its allowable — a verified engineering deficiency.
  'STRUCTURAL-UTILIZATION-EXCEEDED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // TS4-A-F devices with no established keep-alive source. Safety AND code:
  // without a transmitter the modules sit at 0.6 V and the array never energizes,
  // and the 690.12 shutdown path is not shown to exist. Procurement too — the
  // transmitter row is a candidate and cannot be ordered as specified.
  'TIGO-RSS-TRANSMITTER-UNVERIFIED': {
    impact: { safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // No canonical roof-plane geometry: nothing structural can be shown at all.
  'SITE-GEOMETRY-MISSING': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
    justification: '',
  },
  // Legacy environmental-load code (subsumed by ENVIRONMENTAL-LOAD-AUTHORITY-
  // UNVERIFIED); declared so the retired code carries the same impact.
  'WIND-SNOW-AUTHORITY-UNRESOLVED': {
    impact: { safety: true, codeCompliance: true, procurement: false, engineeringApproval: true, permitAcceptance: true },
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
