// ═══════════════════════════════════════════════════════════════════════════
// WS-2C/D/E/F — THE CANONICAL Q-CABLE PROCUREMENT RESOLUTION.
//
// The package used to state a shortage and stop: "deficit 24.2 ft — NON-ORDERABLE
// / PENDING A VERIFIED LISTED EXTENSION". That is a measurement, not a
// procurement design. This module turns the measurement into what an installer
// actually buys, from archived manufacturer authority only.
//
// ── THE DISTINCTION THIS MODULE EXISTS TO ENFORCE ────────────────────────────
//   INSTALLED USABLE LENGTH   what goes on the roof (per branch, non-transferable)
//   PURCHASED STOCK           whole packages, in the manufacturer's purchase unit
//   REMAINDER                 purchased − installed, which is NOT a defect
//
// 24.2 ft is an INSTALLED requirement. It is never a purchase quantity, and no
// sheet may print it as one.
//
// ── WHY THE PURCHASE UNIT IS A BOX OF CONNECTORS ─────────────────────────────
// The archived IOM tables the IQ Cable by "Connector count per box" — 240 for
// Q-12-10-240. The cable is bought by the box and CUT ("Cut each segment of
// cable to meet your planned needs"), so the purchase unit is a box of N
// connector-sections, and the usable length of one box is N × the connector
// pitch. Deriving a purchase from a footage would invent a purchase unit the
// manufacturer does not sell.
//
// ── WHY NOT THE RAW-STOCK SKU ────────────────────────────────────────────────
// The catalog's Q-12-RAW-300 is `unverified-catalog`: it appears in no archived
// manufacturer document (WS-2B). An unverified stock item may be REPORTED and
// may never be purchased against, so this resolver refuses it and uses the
// documented method — cut the listed cable, join with a field-wireable pair.
//
// ── BRANCH ALLOCATION (WS-2D) ────────────────────────────────────────────────
// A Q-Cable branch is a continuous run. Surplus sitting on one branch is not
// available to another, so the governing requirement is Σ per-branch shortfall,
// NOT the aggregate subtraction. Both numbers are carried; the topology-
// constrained one governs; the surplus is retained as explicitly
// non-redistributable. This module never nets one against the other.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  Provenance, QCableTopology, ListedCableAssembly, ProcurementSufficiency,
} from './types';
import type { EnphaseFieldTerminationAuthority } from './enphaseFieldTerminationEvidence';
import type { TrunkCableSystem } from '@/lib/equipment/trunkCable';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The scoped requirement codes this resolution can raise. Each names ONE fact.
 *  The broad QCABLE-PROCUREMENT-INSUFFICIENT survives only for the case it was
 *  always about: a real shortage with no procurement design at all. */
export type QCableResidualCode =
  | 'QCABLE-PROCUREMENT-INSUFFICIENT'
  | 'QCABLE-STOCK-PACKAGING-UNVERIFIED'
  | 'QCABLE-FIELD-CONNECTOR-SKU-MISSING'
  | 'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED';

/** One branch's cable arithmetic, kept separate from every other branch. */
export interface QCableBranchAllocation {
  branchId: string;
  branchLabel: string;
  /** connector sections the CURRENT order provides this branch. */
  existingUsableLengthFt: number;
  /** the branch's as-routed requirement (molded path × waste + allowance share). */
  requiredUsableLengthFt: number;
  /** requirement − existing, floored at 0. */
  shortageFt: number;
  /** surplus that exists on this branch and CANNOT move to another. */
  nonRedistributableSurplusFt: number;
  /** new usable length allocated to THIS branch by this resolution. */
  allocatedNewUsableLengthFt: number;
  /** additional connector sections this branch's allocation consumes. */
  allocatedSections: number;
  allocationSource: string;
}

/** One accessory line, derived from an actual branch modification. */
export interface QCableAccessoryLine {
  sku: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'box';
  purpose: string;
  /** the branch this quantity belongs to, or null for a package-level item. */
  branchId: string | null;
  /** the archived document + section the quantity rule comes from. */
  evidenceId: string;
  evidenceSection: string;
  compatibilityState: 'VERIFIED' | 'INCOMPATIBLE' | 'INCOMPLETE';
}

export interface QCableProcurementResolution {
  resolutionId: string;
  present: boolean;

  selectedCableAssemblySku: string | null;
  connectorArchitecture: string | null;

  // ── the two deficits, never netted ────────────────────────────────────────
  aggregateInstalledDeficitFt: number;
  topologyConstrainedInstalledDeficitFt: number;
  nonRedistributableSurplusFt: number;
  /** which number governs the purchase. Always the topology-constrained one. */
  governingBasis: 'topology-constrained';
  deficitArithmeticNote: string;

  branchAllocations: QCableBranchAllocation[];

  // ── the purchase, in the manufacturer's own unit ──────────────────────────
  /** the stock item actually purchased. Null ⇒ nothing established. */
  selectedStockSku: string | null;
  stockUnitDescription: string | null;
  /** connector sections in one purchasable package. */
  stockUnitConnectorSections: number | null;
  /** usable length of one package = sections × pitch. */
  stockUnitLengthFt: number | null;

  // ── sections: the design's own unit, before packaging ─────────────────────
  /** connector sections the BASE order already covers (one per micro). */
  baseSectionsOrdered: number;
  /** ADDITIONAL sections this resolution allocates to the short branches. */
  additionalSectionsRequired: number;
  /** base + additional — the whole job. */
  totalSectionsRequired: number;

  // ── packages: what is actually bought ─────────────────────────────────────
  /** whole packages the WHOLE JOB needs. */
  stockUnitsRequired: number | null;
  /** packages the BASE order alone would have needed. */
  baseStockUnitsRequired: number | null;
  /** stockUnitsRequired − baseStockUnitsRequired. ZERO when the additional
   *  sections fit inside the package the base order already buys — which is the
   *  honest answer, and the one a phantom second box would get wrong. */
  additionalStockUnitsRequired: number | null;
  totalStockPurchasedFt: number | null;
  /** the NEW usable length this resolution installs (Σ branch allocations). */
  totalUsableInstalledFt: number | null;
  expectedRemainingStockFt: number | null;
  remainderNote: string | null;

  /** the raw-stock SKU the catalog carries and why it was NOT used. */
  rejectedStockCandidates: { sku: string; reason: string }[];

  accessories: QCableAccessoryLine[];

  compatibilityStatus: 'VERIFIED' | 'INCOMPATIBLE' | 'INCOMPLETE';
  /** every condition still unmet. Empty ⇔ compatibilityStatus VERIFIED. */
  unresolved: string[];
  /** WS-2 registry contract: a NARROWLY SCOPED requirement per genuinely
   *  unresolved fact, instead of one broad Q-Cable blocker standing in for
   *  whatever happens to be missing. Empty ⇔ nothing to raise. */
  residuals: { code: QCableResidualCode; message: string }[];
  evidenceIds: string[];
  calculationId: string;
  derivation: string;
  provenance: Provenance;
}

export interface ResolveQCableProcurementArgs {
  topology: QCableTopology | null;
  assembly: ListedCableAssembly | null;
  system: TrunkCableSystem | null;
  /** the archived field-termination authority; null ⇒ nothing may be resolved. */
  authority: EnphaseFieldTerminationAuthority | null;
  /** THE sufficiency gate's own per-branch rows — the SAME measurement every
   *  sheet prints (designed-installed vs ordered, per branch). The resolution is
   *  built on this basis and no other: reading the topology's alternate order
   *  COMPOSITION instead would answer a shortage the package never stated. */
  sufficiency: ProcurementSufficiency | null;
}

const EMPTY = (reason: string): QCableProcurementResolution => ({
  resolutionId: 'QCABLE-PROCUREMENT-RESOLUTION',
  present: false,
  selectedCableAssemblySku: null, connectorArchitecture: null,
  aggregateInstalledDeficitFt: 0, topologyConstrainedInstalledDeficitFt: 0,
  nonRedistributableSurplusFt: 0, governingBasis: 'topology-constrained',
  deficitArithmeticNote: reason,
  branchAllocations: [],
  selectedStockSku: null, stockUnitDescription: null, stockUnitConnectorSections: null,
  stockUnitLengthFt: null,
  baseSectionsOrdered: 0, additionalSectionsRequired: 0, totalSectionsRequired: 0,
  stockUnitsRequired: null, baseStockUnitsRequired: null, additionalStockUnitsRequired: null,
  totalStockPurchasedFt: null,
  totalUsableInstalledFt: null, expectedRemainingStockFt: null, remainderNote: null,
  rejectedStockCandidates: [], accessories: [],
  compatibilityStatus: 'INCOMPLETE', unresolved: [reason],
  residuals: [{ code: 'QCABLE-PROCUREMENT-INSUFFICIENT', message: reason }],
  evidenceIds: [],
  calculationId: 'calc:qcable-procurement',
  derivation: reason,
  provenance: { source: 'resolveQCableProcurement', note: reason },
});

/**
 * PURE. Builds the procurement design from the topology + the archived
 * field-termination authority. Every quantity is derived from an actual branch
 * modification or an actual documented per-unit rule; nothing is a default.
 */
export function resolveQCableProcurement(
  args: ResolveQCableProcurementArgs,
): QCableProcurementResolution {
  const { topology: t, assembly, system, authority, sufficiency } = args;
  if (!t?.present || !assembly) return EMPTY('no Q-Cable topology on this design');
  if (!sufficiency?.present) return EMPTY('no Q-Cable procurement sufficiency measurement on this design');
  if (!authority) {
    return EMPTY(
      'no archived manufacturer field-termination authority covers the selected microinverter + '
      + 'connector architecture, so no cable procurement may be resolved (fail-closed)');
  }

  const pitch = t.connectorSpacingFt;
  if (!pitch || !(pitch > 0)) return EMPTY('the selected cable has no connector pitch — no purchase unit can be derived');

  const evidenceIds = [`${authority.documentId}#${authority.documentSha256.slice(0, 12)}`];

  // ── WS-2D — per-branch allocation. Nothing is netted across branches. ──────
  const branchAllocations: QCableBranchAllocation[] = sufficiency.perBranch.map(b => {
    const shortage = Math.max(0, r1(b.deficitFt ?? 0));
    const surplus = Math.max(0, r1(b.nonRedistributableSurplusFt ?? 0));
    const sections = shortage > 0 ? Math.ceil(shortage / pitch) : 0;
    return {
      branchId: b.branchId,
      branchLabel: b.branchLabel,
      existingUsableLengthFt: r1(b.procurementLengthFt ?? 0),
      requiredUsableLengthFt: r1(b.designedInstalledLengthFt ?? 0),
      shortageFt: shortage,
      nonRedistributableSurplusFt: surplus,
      // A branch is allocated WHOLE connector sections — the cable is cut at a
      // connector, so a fractional foot is not a purchasable increment. The
      // allocation therefore lands on or above the shortage, never below it.
      allocatedNewUsableLengthFt: r1(sections * pitch),
      allocatedSections: sections,
      allocationSource: shortage > 0
        ? `${b.branchLabel} is ${shortage} ft short of its ${r1(b.designedInstalledLengthFt ?? 0)} ft `
          + `designed-installed path (ordered ${r1(b.procurementLengthFt ?? 0)} ft); allocated `
          + `${sections} × ${pitch} ft connector section(s) of ${assembly.sku}, cut to length`
        : surplus > 0
          ? `${b.branchLabel} carries ${surplus} ft of surplus, which is NON-REDISTRIBUTABLE — a Q-Cable `
            + 'branch is one continuous run, so this length cannot be moved to a short branch'
          : `${b.branchLabel} is exactly covered by the current order`,
    };
  });

  const topologyDeficit = r1(branchAllocations.reduce((s, a) => s + a.shortageFt, 0));
  const surplusTotal = r1(branchAllocations.reduce((s, a) => s + a.nonRedistributableSurplusFt, 0));
  const totalNewSections = branchAllocations.reduce((s, a) => s + a.allocatedSections, 0);
  const totalUsableInstalledFt = r1(branchAllocations.reduce((s, a) => s + a.allocatedNewUsableLengthFt, 0));

  // ── WS-2B/F — the stock item, in the manufacturer's purchase unit ──────────
  const rejected: { sku: string; reason: string }[] = [];
  if (system?.rawCable) {
    rejected.push({
      sku: system.rawCable.sku,
      reason: system.rawCable.verificationState === 'verified-archived'
        ? 'not required — the documented method for this design is cut listed cable + a field-wireable pair'
        : system.rawCable.verificationBasis,
    });
  }

  const packaging = authority.listedCablePackaging.value.find(c => c.sku === assembly.sku) ?? null;
  const unresolved: string[] = [];
  const residuals: { code: QCableResidualCode; message: string }[] = [];
  const raise = (code: QCableResidualCode, message: string) => {
    unresolved.push(message);
    if (!residuals.some(r => r.code === code)) residuals.push({ code, message });
  };
  if (!packaging) {
    raise('QCABLE-STOCK-PACKAGING-UNVERIFIED',
      `the archived manual does not table a purchasable package for the selected cable ${assembly.sku}, `
      + 'so the stock unit (connector sections per box) cannot be established and no purchase quantity '
      + 'may be stated');
  }

  const stockUnitSections = packaging?.connectorsPerBox ?? null;
  const stockUnitLengthFt = stockUnitSections != null ? r1(stockUnitSections * pitch) : null;
  // The design's own unit is the CONNECTOR SECTION (one per micro, plus the
  // sections allocated to the short branches). Packaging is applied ONCE, over
  // the whole job — computing packages for the shortfall alone would order a
  // second box for seven sections that fit in the box the base order already buys.
  const baseSectionsOrdered = t.totals.dropCount;
  const totalSectionsRequired = baseSectionsOrdered + totalNewSections;
  const boxesFor = (sections: number): number | null =>
    stockUnitSections == null ? null : (sections > 0 ? Math.ceil(sections / stockUnitSections) : 0);
  const stockUnitsRequired = boxesFor(totalSectionsRequired);
  const baseStockUnitsRequired = boxesFor(baseSectionsOrdered);
  const additionalStockUnitsRequired =
    stockUnitsRequired != null && baseStockUnitsRequired != null
      ? stockUnitsRequired - baseStockUnitsRequired : null;
  const totalStockPurchasedFt = stockUnitLengthFt != null && stockUnitsRequired != null
    ? r1(stockUnitLengthFt * stockUnitsRequired) : null;
  // The remainder is measured against the WHOLE installed path, not against the
  // shortfall allocation — the same package supplies both.
  const totalJobInstalledFt = r1(t.totals.installedLengthFt);
  const expectedRemainingStockFt = totalStockPurchasedFt != null
    ? r1(totalStockPurchasedFt - totalJobInstalledFt) : null;

  // ── WS-2E — accessories, each derived from an actual branch modification ───
  const accessories: QCableAccessoryLine[] = [];
  const doc = authority.documentId;

  // Field-wireable connector PAIRS: one per cut-and-join. Every branch that
  // receives new cable is joined once; every documented sub-array bridge is
  // joined once. Both are real modifications, counted per branch.
  for (const a of branchAllocations) {
    const bridges = t.branches.find(b => b.branchId === a.branchId)?.bridgeRequirements ?? [];
    const joins = (a.allocatedSections > 0 ? 1 : 0) + bridges.reduce((s, br) => s + br.connectorPairs, 0);
    if (joins <= 0) continue;
    for (const [sku, side] of [
      [authority.fieldWireableConnectorPair.value.maleSku, 'male'],
      [authority.fieldWireableConnectorPair.value.femaleSku, 'female'],
    ] as const) {
      accessories.push({
        sku, description: `IQ Field Wireable Connector (${side})`, quantity: joins, unit: 'ea',
        purpose: `${joins} field-terminated join(s) on ${a.branchLabel}`
          + (bridges.length ? ` (incl. ${bridges.length} sub-array/roof-plane bridge)` : ''),
        branchId: a.branchId,
        evidenceId: doc, evidenceSection: authority.fieldWireableConnectorPair.sectionOrPage,
        compatibilityState: 'VERIFIED',
      });
    }
  }

  // Terminators: the DOCUMENTED per-branch-circuit quantity, for every branch.
  const perBranchTerm = authority.terminator.value.perBranchCircuit;
  accessories.push({
    sku: authority.terminator.value.sku,
    description: 'IQ Terminator (branch-circuit end / cut cable end)',
    quantity: perBranchTerm * t.branches.length, unit: 'ea',
    purpose: `${perBranchTerm} per branch circuit × ${t.branches.length} branch(es), per the archived manual`,
    branchId: null,
    evidenceId: doc, evidenceSection: authority.terminator.sectionOrPage,
    compatibilityState: 'VERIFIED',
  });

  // Sealing caps: one per unused molded connector — a topology count, and one
  // the manual states as a per-unit rule rather than a guess.
  const deadDrops = t.totals.deadDropCount + totalNewSections; // new sections add connectors with no micro
  if (deadDrops > 0) {
    accessories.push({
      sku: authority.sealingCap.value.sku,
      description: 'IQ Sealing Cap (unused connector)',
      quantity: authority.sealingCap.value.perUnusedConnector * deadDrops, unit: 'ea',
      purpose: `${t.totals.deadDropCount} unused molded connector(s) on the ordered cable + `
        + `${totalNewSections} connector(s) on the newly allocated section(s)`,
      branchId: null,
      evidenceId: doc, evidenceSection: authority.sealingCap.sectionOrPage,
      compatibilityState: 'VERIFIED',
    });
  }

  // Cable clips: the documented maximum support spacing over the installed path.
  const supportFt = authority.cableSupport.value.maxSupportSpacingFt;
  const clips = Math.ceil(t.totals.installedLengthFt / supportFt);
  accessories.push({
    sku: authority.cableSupport.value.sku,
    description: 'IQ Cable Clip',
    quantity: clips, unit: 'ea',
    purpose: `support every ${supportFt} ft over the ${r1(t.totals.installedLengthFt)} ft installed path`,
    branchId: null,
    evidenceId: doc, evidenceSection: authority.cableSupport.sectionOrPage,
    compatibilityState: 'VERIFIED',
  });

  // ── the verdict ───────────────────────────────────────────────────────────
  if (assembly.connectorArchitecture == null) {
    raise('QCABLE-PROCUREMENT-INSUFFICIENT',
      'the selected cable assembly carries no connector architecture, so no installation method applies');
  }
  for (const acc of accessories) {
    const isTerm = acc.sku === authority.terminator.value.sku;
    const code: QCableResidualCode = isTerm
      ? 'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED' : 'QCABLE-FIELD-CONNECTOR-SKU-MISSING';
    if (!acc.sku) raise(code, `${acc.description}: no compatible SKU is established`);
    else if (acc.compatibilityState !== 'VERIFIED') {
      raise(code, `${acc.sku} (${acc.description}): compatibility is ${acc.compatibilityState}`);
    }
  }
  if (topologyDeficit > 0 && (stockUnitsRequired == null || stockUnitsRequired <= 0)) {
    raise('QCABLE-PROCUREMENT-INSUFFICIENT',
      `a ${topologyDeficit} ft per-branch shortage exists but no purchasable stock unit was established`);
  }

  const compatibilityStatus: QCableProcurementResolution['compatibilityStatus'] =
    unresolved.length === 0 ? 'VERIFIED' : 'INCOMPLETE';

  const deficitArithmeticNote =
    `AGGREGATE FOOTAGE: ${r1(sufficiency.aggregateFootageDeficitFt ?? 0)} ft. `
    + `TOPOLOGY-CONSTRAINED (GOVERNING): Σ per-branch shortfall = `
    + branchAllocations.filter(a => a.shortageFt > 0).map(a => `${a.branchLabel} ${a.shortageFt} ft`).join(' + ')
    + ` = ${topologyDeficit} ft. `
    + (surplusTotal > 0
      ? `${surplusTotal} ft of surplus on `
        + branchAllocations.filter(a => a.nonRedistributableSurplusFt > 0).map(a => a.branchLabel).join(', ')
        + ' is NON-REDISTRIBUTABLE — a Q-Cable branch is one continuous run — which is why the governing '
        + 'requirement exceeds the aggregate subtraction.'
      : 'No surplus exists on any branch.');

  return {
    resolutionId: 'QCABLE-PROCUREMENT-RESOLUTION',
    present: true,
    selectedCableAssemblySku: assembly.sku,
    connectorArchitecture: assembly.connectorArchitecture ?? null,
    aggregateInstalledDeficitFt: r1(sufficiency.aggregateFootageDeficitFt ?? 0),
    topologyConstrainedInstalledDeficitFt: topologyDeficit,
    nonRedistributableSurplusFt: surplusTotal,
    governingBasis: 'topology-constrained',
    deficitArithmeticNote,
    branchAllocations,
    selectedStockSku: packaging ? assembly.sku : null,
    stockUnitDescription: packaging
      ? `${packaging.sku} — box of ${packaging.connectorsPerBox} connector sections at ${packaging.connectorSpacing} spacing (${packaging.moduleOrientation})`
      : null,
    stockUnitConnectorSections: stockUnitSections,
    stockUnitLengthFt,
    baseSectionsOrdered,
    additionalSectionsRequired: totalNewSections,
    totalSectionsRequired,
    stockUnitsRequired,
    baseStockUnitsRequired,
    additionalStockUnitsRequired,
    totalStockPurchasedFt,
    totalUsableInstalledFt,
    expectedRemainingStockFt,
    remainderNote: expectedRemainingStockFt != null
      ? `The whole job needs ${totalSectionsRequired} connector section(s) (${baseSectionsOrdered} base `
        + `+ ${totalNewSections} allocated to the short branches), which is ${stockUnitsRequired} `
        + `package(s) — ${additionalStockUnitsRequired === 0
          ? 'the SAME package the base order already buys, so the shortfall costs no additional package'
          : `${additionalStockUnitsRequired} more than the base order alone`}. `
        + `${totalStockPurchasedFt} ft purchased − ${totalJobInstalledFt} ft installed path = `
        + `${expectedRemainingStockFt} ft remaining. The remainder is ordinary stock left in the box, `
        + 'not a shortfall and not waste attributable to this design.'
      : null,
    rejectedStockCandidates: rejected,
    accessories,
    compatibilityStatus,
    unresolved,
    residuals,
    evidenceIds,
    calculationId: 'calc:qcable-procurement',
    derivation:
      `Per-branch shortfalls allocated as whole ${pitch} ft connector sections of the listed cable `
      + `(${authority.cutToLengthPermitted.quote}), joined with the documented field-wireable pair `
      + `(${authority.fieldWireableConnectorPair.value.maleSku}/${authority.fieldWireableConnectorPair.value.femaleSku}). `
      + `Purchase unit = the manufacturer's own package (${stockUnitSections ?? '—'} connector sections), `
      + `so the ORDER is ${stockUnitsRequired ?? '—'} package(s) for the whole job, NOT the `
      + `${topologyDeficit} ft installed requirement — a footage is not a purchase quantity.`,
    provenance: {
      source: 'resolveQCableProcurement (archived IOM field-termination authority + canonical topology)',
      ref: `${authority.documentId} sha256:${authority.documentSha256.slice(0, 16)}`,
    },
  };
}
