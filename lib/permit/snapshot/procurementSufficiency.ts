// ═══════════════════════════════════════════════════════════════════════════
// Q-CABLE PROCUREMENT SUFFICIENCY GATE (2026-07-24) — pure authority + clearing.
//
// THE fail-closed evaluator for the Q-Cable procurement deficit. Given the §7
// per-branch geometric cable paths (designed-installed length) and the drop-based
// procurement footage (Σ ceil(drops × pitch × waste) — the BOM base quantity), it
// decides whether the ordered cable is SHORT of the as-routed installed path:
//
//   insufficient  ⇔  procurement < Σ designed-installed + requiredServiceLoopAllowance
//
// ALLOWANCE HONESTY: there is NO manufacturer/design rule for a Q-Cable service-
// loop / transition allowance archived in this repo, so the allowance is 0 with
// provenance 'no-allowance-authority-recorded'. A manufacturer-documented allowance
// would RAISE the threshold (making the gate stricter). We never invent a number.
//
// CLEARING: the blocker clears ONLY when a canonical CableExtensionSolution passes
// evaluateCableExtensionClearance — exact selected listed product SKU, verified
// compatibility with the selected IQ8A/Q-Cable system, a VERIFIED manufacturer
// document (resolved THROUGH lib/documents), quantity/location as canonical data,
// representation in the drawings/schedules/BOM, recalculated VD/installation, AND
// enough added length to cover the deficit. An unverified free-text note can NEVER
// clear it. No solutions are wired on a live design today, so the blocker stays
// active — by design. This module is PURE (no DB, deterministic) so the snapshot
// digest stays reproducible.
// ═══════════════════════════════════════════════════════════════════════════
import type {
  BranchCablePath, ListedCableAssembly, CableExtensionSolution,
  ProcurementResolutionOption, ProcurementSufficiency,
  QCableSolutionEvaluation, QCableTopology,
} from './types';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The four enumerated resolution options, each honestly SELECTED / NOT SELECTED
 *  from the supplied solutions (a matching kind whose clearance passes is selected). */
function resolutionOptions(
  clearingSolutionKind: CableExtensionSolution['kind'] | null,
): ProcurementResolutionOption[] {
  const opts: { kind: CableExtensionSolution['kind']; description: string }[] = [
    { kind: 'verified-jumper-extension',
      description: 'Verified listed jumper / extension cable product covering the deficit (exact SKU + verified manufacturer document + system compatibility).' },
    { kind: 'alternate-listed-cable',
      description: 'Alternate listed AC trunk cable assembly whose procurement footage envelopes the designed-installed path.' },
    { kind: 'route-layout-revision',
      description: 'Route / layout revision that reduces the per-branch cable path below the procured footage.' },
    { kind: 'field-wireable-connector',
      description: 'Field-wireable / field-cut listed connector solution with a verified manufacturer document.' },
  ];
  return opts.map(o => ({ ...o, selected: o.kind === clearingSolutionKind }));
}

export interface CableExtensionClearanceContext {
  /** the exact selected micro/trunk system the solution must be compatible with. */
  selectedSystem: string;          // e.g. 'Enphase IQ8A / Q Cable'
  /** the deficit (ft) the solution's added length must cover. */
  deficitFt: number;
}

export interface CableExtensionClearanceResult {
  cleared: boolean;
  missing: string[];
  reasons: string[];
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * PURE, deterministic predicate: does the supplied CableExtensionSolution actually
 * resolve the Q-Cable procurement deficit? Returns cleared:false + the enumerated
 * missing conditions when ANY requirement is unmet. No DB, no side effects.
 *
 * This is the single gate for clearing QCABLE-PROCUREMENT-INSUFFICIENT, and the
 * refusal path for an unverified free-text "jumpers required" note.
 */
export function evaluateCableExtensionClearance(
  ctx: CableExtensionClearanceContext,
  solution: CableExtensionSolution | null | undefined,
): CableExtensionClearanceResult {
  const missing: string[] = [];
  const reasons: string[] = [];
  const fail = (field: string, why: string) => { missing.push(field); reasons.push(why); };

  if (!solution) {
    return { cleared: false, missing: ['solution'], reasons: ['no CableExtensionSolution supplied for the deficit'] };
  }

  // Exact selected listed product SKU.
  if (!norm(solution.selectedSku)) fail('selected_sku', 'no exact listed extension product SKU is selected (a note is not a product)');

  // Verified compatibility with the selected IQ8A / Q-Cable system.
  if (solution.compatibilityVerified !== true) fail('compatibility', 'compatibility with the selected system is not verified');

  // A VERIFIED manufacturer document (via lib/documents) — verified + current + archived + hashed.
  const doc = solution.manufacturerDocument;
  if (!doc) fail('manufacturer_document', 'no verified manufacturer document supplied for the extension product');
  else {
    if (norm(doc.verificationState) !== 'verified') fail('document_verification', `document is '${doc.verificationState}', not 'verified'`);
    if (norm(doc.status) !== 'current') fail('document_status', `document status is '${doc.status}', not 'current'`);
    if (!doc.archivedInRepo) fail('document_archived', 'the exact extension document is not archived (archivedInRepo=false)');
    if (!doc.sha256 || doc.sha256.trim().length < 16) fail('document_sha256', 'no SHA-256 recorded for the archived extension document');
    // The document must cover the EXACT selected product SKU.
    if (norm(doc.coversExtensionSku) && norm(solution.selectedSku) && norm(doc.coversExtensionSku) !== norm(solution.selectedSku)) {
      fail('document_sku_match', `document covers '${doc.coversExtensionSku}', not the selected extension '${solution.selectedSku}'`);
    } else if (!norm(doc.coversExtensionSku)) {
      fail('document_sku_match', 'document does not identify the exact extension product it covers');
    }
    // The document must state compatibility with the selected system.
    if (!norm(doc.compatibleSystem)) fail('document_compatibility', 'document does not state compatibility with a micro/trunk system');
    else if (norm(ctx.selectedSystem) && !norm(doc.compatibleSystem).includes(norm(ctx.selectedSystem).split(' ')[0])) {
      fail('document_compatibility', `document compatibility '${doc.compatibleSystem}' does not cover the selected system '${ctx.selectedSystem}'`);
    }
  }

  // Quantity / location as canonical data.
  if (solution.quantity == null || !(solution.quantity > 0)) fail('quantity', 'quantity not stated as canonical data');
  if (!Array.isArray(solution.locations) || solution.locations.length === 0) fail('locations', 'placement locations not stated as canonical data');

  // Represented in the drawings / schedules / BOM.
  if (solution.representedInDrawings !== true) fail('drawings', 'solution is not represented in the drawings');
  if (solution.representedInSchedules !== true) fail('schedules', 'solution is not represented in the schedules');
  if (solution.representedInBom !== true) fail('bom', 'solution is not represented in the BOM');

  // VD / installation recalculated where applicable.
  if (solution.vdInstallationRecalculated !== true) fail('vd_recalc', 'voltage-drop / installation not recalculated for the added length');

  // The added length must actually cover the deficit.
  if (solution.addedLengthFt == null || !(solution.addedLengthFt >= ctx.deficitFt)) {
    fail('added_length', `added length ${solution.addedLengthFt ?? '—'} ft does not cover the ${round1(ctx.deficitFt)} ft deficit`);
  }

  return { cleared: missing.length === 0, missing, reasons };
}

/**
 * A DOCUMENTED Q-Cable service-loop / transition allowance. The module contract
 * above already states the rule: a manufacturer- or design-documented allowance
 * RAISES the threshold and therefore makes this gate STRICTER — it can only ever
 * create or enlarge a deficit, never clear one (clearing is the exclusive job of
 * `evaluateCableExtensionClearance`). Absent (null) ⇒ the honest 0-allowance path
 * with provenance `no-allowance-authority-recorded`, byte-identical to before this
 * record existed, so the snapshot digest of a design without one is unchanged.
 */
export interface QCableServiceLoopAllowance {
  /** the allowance in feet applied to the Σ designed-installed path. */
  allowanceFt: number;
  /** the document / rule this number comes from (never a bare assertion). */
  documentId: string;
  /** free text recorded verbatim on the sufficiency object. */
  note: string;
  /** provenance tag rendered in place of 'no-allowance-authority-recorded'. */
  provenance: string;
}

export interface BuildProcurementSufficiencyArgs {
  assembly: ListedCableAssembly | null;
  branchPaths: BranchCablePath[];
  /** §Q — a DOCUMENTED service-loop allowance (stricter-only). null ⇒ allowance 0. */
  serviceLoopAllowance?: QCableServiceLoopAllowance | null;
  /** the exact selected system label for compatibility (IQ8A / Q Cable). */
  selectedSystem: string;
  /** candidate resolution solutions (empty on live today). */
  solutions?: CableExtensionSolution[];
  provenanceSource?: string;
  // ── AAC WS-5 (2026-07-27) — the deterministic topology + its option-space
  //    evaluation. Optional so every existing caller (tests, harnesses) is
  //    unchanged; when supplied the gate RECORDS the evaluation instead of
  //    announcing a bare deficit, and the drop-count basis stays visible beside
  //    the adopted composition so the two reconcile on the artifact itself. ────
  topology?: QCableTopology | null;
  evaluation?: QCableSolutionEvaluation | null;
}

/**
 * Build THE canonical procurement-sufficiency authority (pure). Emits `insufficient`
 * true when the drop-based procurement footage is short of the Σ geometric
 * designed-installed path + allowance; evaluates any supplied solutions and marks
 * the deficit RESOLVED only when a solution genuinely clears it.
 */
export function buildProcurementSufficiency(args: BuildProcurementSufficiencyArgs): ProcurementSufficiency | null {
  const { assembly, branchPaths } = args;
  const provenance = { source: args.provenanceSource ?? 'buildProcurementSufficiency (§Q Q-Cable procurement sufficiency)', ref: assembly?.assemblyId ?? null };
  if (!assembly || branchPaths.length === 0) {
    return {
      present: false, assemblyId: assembly?.assemblyId ?? null, sku: assembly?.sku ?? null,
      connectorSpacingFt: assembly?.connectorSpacingFt ?? null, wasteFactor: null,
      perBranch: [], totalDesignedInstalledFt: null, procurementLengthFt: null, procurementDerivation: null,
      requiredServiceLoopAllowanceFt: 0, allowanceProvenance: 'no-allowance-authority-recorded',
      allowanceNote: 'No manufacturer/design Q-Cable service-loop or transition allowance is recorded in-repo; allowance = 0. A manufacturer-documented allowance would RAISE this threshold.',
      thresholdFt: null, deficitFt: 0, insufficient: false, affectedBranchIds: [],
      aggregateFootageDeficitFt: 0, topologyConstrainedDeficitFt: 0,
      nonRedistributableSurplusFt: 0, requiredAdditionalPurchasableLengthFt: 0,
      deficitBasis: 'none' as const, deficitArithmeticNote: null,
      resolutionOptions: resolutionOptions(null), manufacturerDocumentAuthority: null,
      // ECD §4 (W1-E) — the supplied solutions are CARRIED even when there is no
      // deficit to clear. A CableExtensionSolution is also the only thing that
      // can PROMOTE a candidate field-splice connector BOM row (see
      // evaluateCableExtensionPromotion), and that question is independent of
      // whether the cable length is short — dropping them here made the
      // promotion path unreachable on a sufficient design.
      verificationStatus: 'sufficient', solutions: args.solutions ?? [],
      clearedBySolutionId: null, clearance: null,
      provenance,
    };
  }

  const pitch = assembly.connectorSpacingFt ?? null;
  const waste = branchPaths[0]?.wasteFactor ?? null;
  // TAC WS-1 — each branch carries its OWN deficit/surplus. A cable assembly is a
  // continuous run per branch: footage cannot move between branches, so a surplus
  // on one branch is NON-REDISTRIBUTABLE and cannot offset another branch's short
  // fall. Both quantities are recorded per branch so no surface has to (and none
  // may) infer them from the aggregates.
  const perBranch = branchPaths.map(p => {
    const _req = p.designedInstalledLengthFt ?? 0;
    const _alloc = p.procurementLengthFt ?? 0;
    const _delta = round1(_req - _alloc);
    return {
      branchId: p.branchId, branchLabel: p.branchLabel, dropCount: p.dropCount,
      designedInstalledLengthFt: p.designedInstalledLengthFt, procurementLengthFt: p.procurementLengthFt,
      /** > 0 ⇒ this branch is short by this much. */
      deficitFt: _delta > 0 ? _delta : 0,
      /** > 0 ⇒ this branch has spare cable that CANNOT serve another branch. */
      nonRedistributableSurplusFt: _delta < 0 ? round1(-_delta) : 0,
    };
  });
  const totalDesigned = round1(branchPaths.reduce((s, p) => s + (p.designedInstalledLengthFt ?? 0), 0));
  const procurement = Math.round(branchPaths.reduce((s, p) => s + (p.procurementLengthFt ?? 0), 0));
  const totalDrops = branchPaths.reduce((s, p) => s + (p.dropCount ?? 0), 0);

  // ── ALLOWANCE — honest 0 unless a DOCUMENTED allowance is supplied. ─────────
  // A documented allowance can only RAISE the threshold (stricter); it can never
  // clear a deficit. With none supplied the three values below are byte-identical
  // to the pre-record behaviour, so an unchanged design keeps its digest.
  const _allow = args.serviceLoopAllowance ?? null;
  const requiredServiceLoopAllowanceFt = _allow && _allow.allowanceFt > 0 ? round1(_allow.allowanceFt) : 0;
  const allowanceProvenance = _allow && _allow.allowanceFt > 0
    ? _allow.provenance : 'no-allowance-authority-recorded';
  const allowanceNote = _allow && _allow.allowanceFt > 0
    ? `Documented Q-Cable service-loop / transition allowance ${round1(_allow.allowanceFt)} ft per ${_allow.documentId}: ${_allow.note} `
      + 'A documented allowance RAISES this threshold (stricter); it can never clear a deficit.'
    : 'No manufacturer/design Q-Cable service-loop or transition allowance is recorded in-repo; allowance = 0. '
      + 'A manufacturer-documented allowance would RAISE this threshold (making the gate stricter).';

  const thresholdFt = round1(totalDesigned + requiredServiceLoopAllowanceFt);
  // AAC WS-5 — PER BRANCH **and** aggregate. A cable sufficient in aggregate
  // while ONE branch's ordered footage is short of that branch's as-routed path
  // is NOT sufficient: the branches are separate continuous runs and footage
  // cannot move between them. (Before this the gate compared the sums only, so a
  // short branch hid behind a long one.)
  const shortBranches = branchPaths.filter(p =>
    (p.designedInstalledLengthFt ?? 0) > (p.procurementLengthFt ?? 0));
  const aggregateShort = procurement < thresholdFt;
  const rawInsufficient = aggregateShort || shortBranches.length > 0;
  // ── TAC WS-1 — TWO DISTINCT DEFICITS, EACH NAMED ────────────────────────────
  // The governing deficit was `max(aggregate, Σ per-branch)` reported as ONE
  // number, which downstream prose then narrated with AGGREGATE operands:
  // "procurement 152 ft is SHORT of the 166.5 ft designed path by 24.2 ft"
  // — but 166.5 − 152 = 14.5. Both quantities were right; the SENTENCE was
  // mathematically false because it mixed the aggregate operands with the
  // topology-constrained result. Each is now its own field with its own basis,
  // and the governing basis is explicit so no surface can mix them.
  const aggregateFootageDeficitFt = aggregateShort ? round1(thresholdFt - procurement) : 0;
  const topologyConstrainedDeficitFt = round1(shortBranches.reduce(
    (s, p) => s + ((p.designedInstalledLengthFt ?? 0) - (p.procurementLengthFt ?? 0)), 0));
  /** Spare footage stranded on branches that are NOT short — it can never offset
   *  a short branch, which is exactly why the topology deficit can exceed the
   *  aggregate one. */
  const nonRedistributableSurplusFt = round1(perBranch.reduce(
    (s, p) => s + (p.nonRedistributableSurplusFt ?? 0), 0));
  const deficitBasis: 'aggregate-footage' | 'topology-constrained' | 'none' =
    !rawInsufficient ? 'none'
      : (topologyConstrainedDeficitFt >= aggregateFootageDeficitFt ? 'topology-constrained' : 'aggregate-footage');
  const deficitFt = rawInsufficient
    ? round1(Math.max(aggregateFootageDeficitFt, topologyConstrainedDeficitFt))
    : 0;
  /** The minimum ADDITIONAL cable that must actually be purchased — the
   *  governing (topology-aware) figure, because cable bought for one branch
   *  cannot complete another. */
  const requiredAdditionalPurchasableLengthFt = deficitFt;
  const deficitArithmeticNote = !rawInsufficient
    ? null
    : `AGGREGATE FOOTAGE: designed ${totalDesigned} ft + allowance ${requiredServiceLoopAllowanceFt} ft `
      + `− procured ${procurement} ft = ${aggregateFootageDeficitFt} ft. `
      + `TOPOLOGY-CONSTRAINED (GOVERNING): Σ per-branch shortfall = `
      + `${shortBranches.map(p => `${p.branchLabel} ${round1((p.designedInstalledLengthFt ?? 0) - (p.procurementLengthFt ?? 0))} ft`).join(' + ') || '0 ft'}`
      + ` = ${topologyConstrainedDeficitFt} ft`
      + (nonRedistributableSurplusFt > 0
        ? `; ${nonRedistributableSurplusFt} ft of surplus on non-short branch(es) is NON-REDISTRIBUTABLE (a cable assembly is a continuous run per branch), which is why the governing deficit exceeds the aggregate subtraction.`
        : '.');
  const affectedBranchIds = rawInsufficient ? shortBranches.map(p => p.branchId) : [];
  // When no single branch individually exceeds (only the Σ does), name all branches.
  const affected = affectedBranchIds.length ? affectedBranchIds : (rawInsufficient ? branchPaths.map(p => p.branchId) : []);

  const procurementDerivation = pitch != null
    ? `Σ drops × pitch × waste = ${totalDrops} drops × ${pitch} ft × ${waste ?? '—'} = ${procurement} ft (drop-count basis, NOT designed × waste)`
    : `Σ per-branch procurement = ${procurement} ft`;

  // ── CLEARING — evaluate any supplied solutions against the deficit. ─────────
  const solutions = args.solutions ?? [];
  let clearedBySolutionId: string | null = null;
  let clearance: { cleared: boolean; missing: string[]; reasons: string[] } | null = null;
  let clearingKind: CableExtensionSolution['kind'] | null = null;
  if (rawInsufficient && solutions.length > 0) {
    for (const sol of solutions) {
      const res = evaluateCableExtensionClearance({ selectedSystem: args.selectedSystem, deficitFt }, sol);
      // record the first attempted clearance for transparency
      if (clearance == null) clearance = res;
      if (res.cleared) { clearedBySolutionId = sol.solutionId; clearance = res; clearingKind = sol.kind; break; }
    }
  }

  const insufficient = rawInsufficient && clearedBySolutionId == null;
  // AAC WS-5 — the ADOPTED order composition (auto-adoptable only: same listed
  // cable, same layout, same branch assignment) is already reflected in
  // `procurement` above, because the caller passes the composed per-branch
  // footage. Its identity is recorded so the artifact states WHY the ordered
  // quantity differs from the drop-count basis.
  const adoptedOptionId = args.evaluation?.adoptedOptionId ?? null;
  /** did the ORDER AS PLACED (drop-count basis) already cover everything? If it
   *  did, nothing was resolved — the design was simply sufficient. */
  const stockAsOrderedViable = args.evaluation
    ? (args.evaluation.options.find(o => o.optionId === 'stock-as-ordered')?.viable ?? true) : true;
  const verificationStatus: ProcurementSufficiency['verificationStatus'] =
    !rawInsufficient
      ? ((adoptedOptionId === 'derived-stock-order-composition' && !stockAsOrderedViable)
          ? 'resolved-by-derived-order-composition' : 'sufficient')
      : clearedBySolutionId != null ? 'resolved-by-verified-solution'
        : 'insufficient-unresolved';

  return {
    present: true, assemblyId: assembly.assemblyId, sku: assembly.sku,
    connectorSpacingFt: pitch, wasteFactor: waste,
    perBranch, totalDesignedInstalledFt: totalDesigned, procurementLengthFt: procurement,
    procurementDerivation: args.topology ? args.topology.derivation : procurementDerivation,
    requiredServiceLoopAllowanceFt, allowanceProvenance, allowanceNote,
    thresholdFt, deficitFt, insufficient, affectedBranchIds: affected,
    // TAC WS-1 — the two named deficits + the governing basis + the exact
    // arithmetic every surface must print instead of composing its own.
    aggregateFootageDeficitFt, topologyConstrainedDeficitFt,
    nonRedistributableSurplusFt, requiredAdditionalPurchasableLengthFt,
    deficitBasis, deficitArithmeticNote,
    resolutionOptions: resolutionOptions(clearingKind),
    manufacturerDocumentAuthority: null,
    verificationStatus, solutions, clearedBySolutionId, clearance,
    dropBasisProcurementLengthFt: args.topology?.totals.dropBasisProcurementLengthFt ?? null,
    solutionEvaluation: args.evaluation ?? null,
    adoptedOptionId,
    provenance,
  };
}

/** Build the structured registry payload for a QCABLE-PROCUREMENT-INSUFFICIENT
 *  blocker from the sufficiency object (single source; RS-1 + evidence read it). */
export function procurementInsufficiencyPayload(ps: ProcurementSufficiency): Record<string, unknown> {
  return {
    selectedQCableSku: ps.sku,
    connectorDropSpacingFt: ps.connectorSpacingFt,
    wasteFactor: ps.wasteFactor,
    perBranchPaths: ps.perBranch.map(b => ({
      branchId: b.branchId, branchLabel: b.branchLabel, dropCount: b.dropCount,
      designedInstalledLengthFt: b.designedInstalledLengthFt, procurementLengthFt: b.procurementLengthFt,
    })),
    totalDesignedInstalledFt: ps.totalDesignedInstalledFt,
    procurementLengthFt: ps.procurementLengthFt,
    procurementDerivation: ps.procurementDerivation,
    requiredServiceLoopAllowanceFt: ps.requiredServiceLoopAllowanceFt,
    allowanceProvenance: ps.allowanceProvenance,
    thresholdFt: ps.thresholdFt,
    deficitFt: ps.deficitFt,
    affectedBranchIds: ps.affectedBranchIds,
    resolutionOptions: ps.resolutionOptions,
    manufacturerDocumentAuthority: ps.manufacturerDocumentAuthority,
    verificationStatus: ps.verificationStatus,
    // ── AAC WS-5 — the OPTION EVALUATION rides in the payload. The blocker no
    //    longer states a bare shortage: it states every option the engine
    //    evaluated, each option's per-branch and aggregate numbers, the ranked
    //    viable set, the recommendation and the precise unresolved reason. ────
    dropBasisProcurementLengthFt: ps.dropBasisProcurementLengthFt ?? null,
    adoptedOptionId: ps.adoptedOptionId ?? null,
    optionEvaluation: ps.solutionEvaluation
      ? {
          sizingRequirementFt: ps.solutionEvaluation.sizingRequirementFt,
          currentProcurementFt: ps.solutionEvaluation.currentProcurementFt,
          measuredDeficitFt: ps.solutionEvaluation.measuredDeficitFt,
          recommendedOptionId: ps.solutionEvaluation.recommendedOptionId,
          unresolvedReason: ps.solutionEvaluation.unresolvedReason,
          residualFieldDependent: ps.solutionEvaluation.residualFieldDependent,
          options: ps.solutionEvaluation.options.map(o => ({
            optionId: o.optionId, kind: o.kind, title: o.title, viable: o.viable, rank: o.rank,
            autoAdoptable: o.autoAdoptable, adopted: o.adopted, changesPhysicalDesign: o.changesPhysicalDesign,
            aggregateRequiredFt: o.aggregateRequiredFt, aggregateProvidedFt: o.aggregateProvidedFt,
            perBranch: o.perBranch, requiresAction: o.requiresAction, blockingReasons: o.blockingReasons,
          })),
        }
      : null,
  };
}
