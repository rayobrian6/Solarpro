// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-5 (2026-07-27) — THE Q-CABLE TOPOLOGY + PROCUREMENT SOLUTION ENGINE.
//
// WHAT WAS WRONG (audit §2.16): the engine ANNOUNCED a shortage. It compared a
// geometric installed path against a `drops × pitch × waste` estimate, and when
// the estimate lost it emitted a blocker whose "resolution options" were four
// static labels (`procurementSufficiency.resolutionOptions`) and whose only
// wired clearing path (`resolveCableExtensionSolutions`) returned `[]` under all
// inputs. Nothing evaluated anything.
//
// WHAT THIS MODULE IS: the deterministic topology object the directive
// specifies (branch id, ordered modules, drop coordinates, inter-module segment
// lengths, row transitions, array transitions, branch start/end, home-run
// transition, service-loop allowance, dead-drop treatment, cable ends,
// terminators, sealing caps, extension requirements, installed length,
// procurement length, selected stock configuration, geometry coverage,
// confidence, field-dependent portion) — plus the SOLUTION EVALUATOR that walks
// the real option space and produces a complete solution or a precise
// unresolved reason.
//
// PURE. No DB, no clock, no I/O. Identical inputs ⇒ identical output, so the
// snapshot digest stays reproducible.
//
// NO PROJECT CONSTANTS. Every number is an input: module coordinates and plane/
// row indices from the canonical layout, connector pitch / branch limits /
// dead-drop rule from the brand catalog, waste factor and service-loop
// allowance from their own recorded authorities. There is no drop count, no
// branch count and no footage literal anywhere in this file — a grep-proof
// test enforces it.
//
// THE ONE DERIVATION (the reconciliation the directive demands): a branch's
// ordered cable is
//
//   orderedSections = max(dropCount, ceil((installedFt × waste + allowanceShare) ÷ pitch))
//   procurementFt   = orderedSections × pitch
//
// The `dropCount` term IS the old drop-count order (Σ drops × pitch × waste is
// its aggregate form), so the previous BOM quantity is the LOWER BOUND of the
// same formula — the two numbers can never disagree again. When the geometry
// needs more cable than one section per micro (a row/array transition longer
// than the molded pitch), the extra sections are ordered and the molded
// connectors that land in the gap become DEAD DROPS, each closed with the
// manufacturer's listed sealing cap — which is the manufacturer's own
// documented practice, carried in the brand catalog as `spliceInstallRule`
// (never assumed: a brand that publishes no such rule cannot use this option).
// ═══════════════════════════════════════════════════════════════════════════

import {
  orderBranchCableChain, branchChainSegmentsFt,
} from '@/lib/bom/deriveRunLengths';
import {
  listTrunkCableVariants,
  type TrunkCableSpec, type TrunkCableSystem, type TrunkOrientation,
} from '@/lib/equipment/trunkCable';
import { evaluateCableExtensionClearance, type QCableServiceLoopAllowance } from './procurementSufficiency';
import type {
  CableExtensionSolution, QCableBranchTopology, QCableBridgeRequirement, QCableDropRecord, QCableEndRecord,
  QCableSolutionEvaluation, QCableSolutionOption, QCableTopology, QCableTransitionClass,
} from './types';

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// §1 — INPUTS (all canonical objects the build already holds)
// ═══════════════════════════════════════════════════════════════════════════

export interface QCableModulePoint {
  moduleInstanceId: string | null;
  roofPlaneId: string | null;
  row: number | null;
  col: number | null;
  xFt: number;
  yFt: number;
}

export interface QCableBranchInput {
  branchId: string;
  branchLabel: string;
  /** the canonical device count for the branch (one micro ⇒ one drop). */
  moduleCount: number;
  /** the branch's module centres, unordered — the engine orders them. */
  modules: QCableModulePoint[];
}

export interface BuildQCableTopologyArgs {
  /** the brand trunk system (catalog). null ⇒ no topology (unknown brand). */
  system: TrunkCableSystem | null;
  /** the SELECTED listed cable variant. null ⇒ no topology. */
  cable: TrunkCableSpec | null;
  orientation: TrunkOrientation;
  /** the array's module centre-to-centre pitch (ft) — the reach a molded
   *  connector must span. null ⇒ applicability cannot be checked. */
  modulePitchFt: number | null;
  branches: QCableBranchInput[];
  /** the slack/waste multiplier (the same authority the BOM footage uses). */
  wasteFactor: number;
  /** the DOCUMENTED service-loop / transition allowance (stricter-only). */
  serviceLoopAllowance?: QCableServiceLoopAllowance | null;
  assemblyId?: string | null;
  provenanceSource?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE TOPOLOGY DERIVATION
// ═══════════════════════════════════════════════════════════════════════════

/** The transition class of the hop from `a` to `b`, from the canonical layout
 *  indices ONLY (plane id, then row index) — never a length threshold. */
function classifyTransition(a: QCableModulePoint, b: QCableModulePoint): QCableTransitionClass {
  if (a.roofPlaneId != null && b.roofPlaneId != null && a.roofPlaneId !== b.roofPlaneId) return 'array-transition';
  if (a.row != null && b.row != null && a.row !== b.row) return 'row-transition';
  return 'in-row';
}

/** Sections a hop of `lenFt` consumes at `pitch`, and the molded connectors that
 *  land inside it with no micro to serve (dead drops). A hop is served by ONE
 *  connector at its far end; every additional section it consumes contributes a
 *  dead drop. */
function sectionsForHop(lenFt: number, pitch: number): { sections: number; deadDrops: number } {
  if (!(pitch > 0)) return { sections: 1, deadDrops: 0 };
  const sections = Math.max(1, Math.ceil(r2(lenFt) / pitch));
  return { sections, deadDrops: sections - 1 };
}

/**
 * Build THE deterministic Q-Cable topology object. Returns null when there is no
 * listed cable system/variant to build it from (never a fabricated topology).
 */
export function buildQCableTopology(args: BuildQCableTopologyArgs): QCableTopology | null {
  const { system, cable, branches } = args;
  if (!system || !cable || branches.length === 0) return null;

  const pitch = cable.connectorSpacingFt > 0 ? cable.connectorSpacingFt : null;
  const waste = args.wasteFactor > 0 ? args.wasteFactor : 1;
  const allow = args.serviceLoopAllowance ?? null;
  const allowanceFt = allow && allow.allowanceFt > 0 ? r1(allow.allowanceFt) : 0;
  const allowanceProvenance = allowanceFt > 0 ? allow!.provenance : 'no-allowance-authority-recorded';

  // ── per-branch geometry ────────────────────────────────────────────────────
  interface Pre {
    input: QCableBranchInput;
    ordered: QCableModulePoint[];
    segs: number[];
    hasGeometry: boolean;
    installedNoAllowance: number;
  }
  const pre: Pre[] = branches.map(b => {
    const pts = (b.modules ?? []).filter(m => Number.isFinite(m?.xFt) && Number.isFinite(m?.yFt));
    // geometry is only USABLE when every device on the branch has a coordinate.
    const hasGeometry = pts.length >= 2 && pts.length === b.moduleCount;
    const order = hasGeometry ? orderBranchCableChain(pts.map(p => ({ x: p.xFt, y: p.yFt }))) : [];
    const ordered = order.map(i => pts[i]);
    const segs = hasGeometry ? branchChainSegmentsFt(pts.map(p => ({ x: p.xFt, y: p.yFt })), order) : [];
    // the home-run LEAD-IN: one molded section at whichever end carries the
    // transition. The transition POINT (roof J-box) is not carried in the CAD
    // model, so the lead-in is the manufacturer pitch and is declared as such.
    const leadIn = pitch ?? 0;
    const interSum = segs.reduce((s, d) => s + d, 0);
    const installed = hasGeometry
      ? r1(interSum + leadIn)
      // no coordinates ⇒ the honest fallback is the pitch estimate, labelled.
      : (pitch != null ? r1(b.moduleCount * pitch) : 0);
    return { input: b, ordered, segs, hasGeometry, installedNoAllowance: installed };
  });

  const totalInstalled = pre.reduce((s, p) => s + p.installedNoAllowance, 0);

  // ── the service-loop allowance is counted EXACTLY ONCE and apportioned to the
  //    branches path-proportionally (Σ shares === the total, to the tenth). ────
  const shares: number[] = (() => {
    if (allowanceFt <= 0 || totalInstalled <= 0) return pre.map(() => 0);
    const raw = pre.map(p => (p.installedNoAllowance / totalInstalled) * allowanceFt);
    const rounded = raw.map(v => r1(v));
    // put the rounding residue on the longest branch so Σ is exact.
    const residue = r1(allowanceFt - rounded.reduce((s, v) => s + v, 0));
    if (residue !== 0) {
      let longest = 0;
      for (let i = 1; i < pre.length; i++) if (pre[i].installedNoAllowance > pre[longest].installedNoAllowance) longest = i;
      rounded[longest] = r1(rounded[longest] + residue);
    }
    return rounded;
  })();

  const capRule = system.spliceInstallRule ?? null;
  const capSku = system.connectors.sealingCap?.sku ?? null;
  const deadDropCappable = !!(capRule?.sealingCapPerUnusedConnector && capSku);

  const branchTopologies: QCableBranchTopology[] = pre.map((p, bi) => {
    const b = p.input;
    const share = shares[bi];
    const drops: QCableDropRecord[] = [];
    let rowTransitionCount = 0, rowTransitionFt = 0, arrayTransitionCount = 0, arrayTransitionFt = 0;
    let hopSections = 0, hopDeadDrops = 0;

    const bridges: QCableBridgeRequirement[] = [];
    if (p.hasGeometry) {
      p.ordered.forEach((m, i) => {
        const segFt = i === 0 ? null : r2(p.segs[i - 1]);
        const transition: QCableTransitionClass = i === 0 ? 'branch-start' : classifyTransition(p.ordered[i - 1], m);
        const hop = i === 0
          ? { sections: 1, deadDrops: 0 }                       // the drop itself
          : sectionsForHop(segFt ?? 0, pitch ?? 0);
        if (i > 0) {
          hopSections += hop.sections;
          hopDeadDrops += hop.deadDrops;
          if (transition === 'row-transition') { rowTransitionCount++; rowTransitionFt += segFt ?? 0; }
          if (transition === 'array-transition') {
            arrayTransitionCount++; arrayTransitionFt += segFt ?? 0;
            // THE MANUFACTURER'S OWN RULE (brand catalog `spliceInstallRule`):
            // a within-plane transition is bridged with continuous cable + a
            // service loop (capping any unused molded connector), but a gap to
            // ANOTHER sub-array / roof plane that exceeds the molded connector
            // spacing is bridged with a custom-length JUMPER fabricated from raw
            // cable and a field-wireable connector pair. Ordering more molded
            // cable is NOT the documented method for that case, so the engine
            // records it as a distinct requirement instead of quietly padding
            // the order.
            if (pitch != null && (segFt ?? 0) > pitch) {
              bridges.push({
                branchId: b.branchId,
                atDropIndex: i + 1,
                gapFt: segFt ?? 0,
                fromRoofPlaneId: p.ordered[i - 1].roofPlaneId,
                toRoofPlaneId: m.roofPlaneId,
                rawCableFt: r1((segFt ?? 0) * waste),
                rawCableSku: system.rawCable?.sku ?? null,
                connectorPairs: system.spliceInstallRule?.splicesPerRoofPlaneBridge ?? 1,
                connectorMaleSku: system.connectors.male?.sku ?? null,
                connectorFemaleSku: system.connectors.female?.sku ?? null,
                basis: system.spliceInstallRule?.source
                  ?? `${system.brand}: no documented sub-array bridge rule in the trunk-cable catalog`,
                // ECD W1-E (standing): a field-wireable connector solution is
                // ESTABLISHED only by a verified cable-extension solution.
                established: false,
              });
            }
          }
        }
        drops.push({
          index: i + 1,
          moduleInstanceId: m.moduleInstanceId,
          roofPlaneId: m.roofPlaneId,
          row: m.row, col: m.col,
          xFt: r2(m.xFt), yFt: r2(m.yFt),
          segmentFromPreviousFt: segFt,
          transition,
          sectionsFromPrevious: i === 0 ? 0 : hop.sections,
          deadDropsInSegment: i === 0 ? 0 : hop.deadDrops,
        });
      });
    }

    const installed = p.installedNoAllowance;
    // the MOLDED cable carries the path minus any documented jumper bridge.
    const bridgeGapTotal = bridges.reduce((sum, br) => sum + br.gapFt, 0);
    const moldedPath = r1(Math.max(0, installed - bridgeGapTotal));
    const required = r1(moldedPath * waste + share);
    const geometricSections = pitch != null ? Math.ceil(r2(required) / pitch) : b.moduleCount;
    const orderedSections = Math.max(b.moduleCount, geometricSections);
    const procurement = pitch != null ? r1(orderedSections * pitch) : 0;
    const deadDropCount = Math.max(0, orderedSections - b.moduleCount);

    const first = p.ordered[0] ?? null;
    const last = p.ordered[p.ordered.length - 1] ?? null;
    const cableEnds: QCableEndRecord[] = p.hasGeometry && first && last ? [
      {
        endId: `${b.branchId}-START`, branchId: b.branchId, kind: 'homerun-transition',
        atDropIndex: 1, xFt: r2(first.xFt), yFt: r2(first.yFt),
        treatment: 'homerun-transition', treatmentSku: null,
        basis: 'the cable end that leaves the array for the roof junction box — the transition POINT is not carried in the CAD model, so only the END is established here',
      },
      {
        endId: `${b.branchId}-END`, branchId: b.branchId, kind: 'far-end',
        atDropIndex: p.ordered.length, xFt: r2(last.xFt), yFt: r2(last.yFt),
        treatment: system.connectors.terminator?.sku ? 'terminator' : 'not-established',
        treatmentSku: system.connectors.terminator?.sku ?? null,
        basis: 'branch far end — closed with the manufacturer listed single-use cable-end terminator',
      },
    ] : [];

    return {
      branchId: b.branchId, branchLabel: b.branchLabel,
      moduleCount: b.moduleCount, dropCount: b.moduleCount,
      orderedModuleIds: p.ordered.map(m => m.moduleInstanceId ?? ''),
      drops,
      interModuleSegmentsFt: p.segs.map(r2),
      rowTransitionCount, rowTransitionFt: r1(rowTransitionFt),
      arrayTransitionCount, arrayTransitionFt: r1(arrayTransitionFt),
      branchStartDropIndex: p.hasGeometry ? 1 : 0,
      branchEndDropIndex: p.hasGeometry ? p.ordered.length : 0,
      homerunTransition: {
        atEnd: 'start',
        leadInFt: pitch ?? 0,
        established: false,
        basis: pitch != null
          ? 'one molded connector section at the transition end (manufacturer pitch). The roof junction-box POSITION is not carried in the CAD model, so the end-dependent lead-in is not established from geometry.'
          : 'no connector pitch on the selected cable — no lead-in basis',
      },
      cableEnds,
      serviceLoopAllowanceShareFt: share,
      bridgeRequirements: bridges,
      installedLengthFt: installed,
      moldedPathLengthFt: moldedPath,
      requiredLengthFt: required,
      orderedSections,
      procurementLengthFt: procurement,
      deadDropCount,
      sealingCapsRequired: deadDropCappable ? deadDropCount : 0,
      terminatorsRequired: cableEnds.some(e => e.kind === 'far-end' && e.treatment === 'terminator') ? 1 : 0,
      // a branch is sufficient only when the ordered molded cable covers its
      // molded requirement AND every bridge it contains is established.
      sufficient: procurement + 1e-9 >= required && bridges.every(br => br.established),
      geometryCoverage: p.hasGeometry ? 'geometry-derived' : (b.modules.length ? 'estimated' : 'none'),
      confidence: p.hasGeometry ? 1 : 0.5,
      derivation: p.hasGeometry
        ? `Σ ${p.segs.length} inter-module hop(s) ${r1(p.segs.reduce((s, d) => s + d, 0))} ft + ${r1(pitch ?? 0)} ft home-run lead-in = ${installed} ft installed; `
          + `required = ${installed} × ${waste} waste + ${share} ft allowance share = ${required} ft; `
          + `ordered = max(${b.moduleCount} drops, ceil(${required} ÷ ${pitch ?? '—'} ft pitch) = ${geometricSections}) = ${orderedSections} section(s) = ${procurement} ft`
        + (bridges.length ? `; ${bridges.length} sub-array/plane bridge(s) totalling ${r1(bridgeGapTotal)} ft are NOT molded cable — the manufacturer's documented method is a raw-cable jumper with a field-wireable connector pair` : '')
        : `no per-device coordinates for this branch — installed length is the ${pitch ?? '—'} ft pitch × ${b.moduleCount} drops ESTIMATE, not a routed path`,
    };
  });

  const allBridges = branchTopologies.flatMap(b => b.bridgeRequirements);
  const totals = {
    branchCount: branchTopologies.length,
    dropCount: branchTopologies.reduce((s, b) => s + b.dropCount, 0),
    installedLengthFt: r1(branchTopologies.reduce((s, b) => s + b.installedLengthFt, 0)),
    moldedPathLengthFt: r1(branchTopologies.reduce((s, b) => s + b.moldedPathLengthFt, 0)),
    requiredLengthFt: r1(branchTopologies.reduce((s, b) => s + b.requiredLengthFt, 0)),
    bridgeCount: allBridges.length,
    bridgeGapFt: r1(allBridges.reduce((s, br) => s + br.gapFt, 0)),
    jumperRawCableFt: r1(allBridges.reduce((s, br) => s + br.rawCableFt, 0)),
    jumperConnectorPairs: allBridges.reduce((s, br) => s + br.connectorPairs, 0),
    orderedSections: branchTopologies.reduce((s, b) => s + b.orderedSections, 0),
    procurementLengthFt: r1(branchTopologies.reduce((s, b) => s + b.procurementLengthFt, 0)),
    dropBasisProcurementLengthFt: pitch != null
      ? branchTopologies.reduce((s, b) => s + Math.ceil(b.dropCount * pitch * waste), 0) : 0,
    deadDropCount: branchTopologies.reduce((s, b) => s + b.deadDropCount, 0),
    sealingCapsRequired: branchTopologies.reduce((s, b) => s + b.sealingCapsRequired, 0),
    terminatorsRequired: branchTopologies.reduce((s, b) => s + b.terminatorsRequired, 0),
    rowTransitionCount: branchTopologies.reduce((s, b) => s + b.rowTransitionCount, 0),
    arrayTransitionCount: branchTopologies.reduce((s, b) => s + b.arrayTransitionCount, 0),
  };

  const geomCount = branchTopologies.filter(b => b.geometryCoverage === 'geometry-derived').length;
  const coverage: QCableTopology['geometryCoverage'] =
    geomCount === branchTopologies.length ? 'geometry-derived'
      : geomCount === 0 ? 'estimated' : 'partial';

  const fieldDependent: string[] = [];
  fieldDependent.push('roof junction-box / home-run transition POINT (not carried in the CAD model) — the end-dependent lead-in and the home-run raceway route');
  for (const b of branchTopologies) {
    if (b.geometryCoverage !== 'geometry-derived') {
      fieldDependent.push(`branch ${b.branchLabel}: per-device coordinates unavailable — its cable path is an estimate, not a routed length`);
    }
  }
  for (const br of allBridges) {
    fieldDependent.push(
      `branch ${br.branchId}: a ${r1(br.gapFt)} ft sub-array/roof-plane bridge at drop ${br.atDropIndex} exceeds the `
      + `${pitch ?? '—'} ft molded connector pitch — the manufacturer's documented method is a raw-cable jumper `
      + `(${br.rawCableSku ?? 'raw cable'} ${br.rawCableFt} ft + ${br.connectorPairs} × ${br.connectorMaleSku ?? 'M'}/${br.connectorFemaleSku ?? 'F'} field-wireable pair), `
      + 'which is a SEPARATE listed product and is established only by a verified cable-extension solution (ECD W1-E)');
  }
  if (!deadDropCappable) {
    fieldDependent.push(`${system.brand}: no documented unused-connector (sealing-cap) rule in the brand catalog — dead drops cannot be treated as cappable`);
  }

  return {
    present: true,
    assemblyId: args.assemblyId ?? null,
    sku: cable.sku,
    systemBrand: system.brand,
    ecosystem: system.ecosystem,
    connectorSpacingFt: pitch,
    wasteFactor: waste,
    modulePitchFt: args.modulePitchFt != null && Number.isFinite(args.modulePitchFt) ? r2(args.modulePitchFt) : null,
    orientation: args.orientation,
    branches: branchTopologies,
    bridgeRequirements: allBridges,
    totals,
    serviceLoopAllowanceFt: allowanceFt,
    allowanceProvenance,
    deadDropTreatment: {
      established: deadDropCappable,
      method: deadDropCappable ? 'listed-sealing-cap' : 'not-established',
      sku: deadDropCappable ? capSku : null,
      basis: deadDropCappable
        ? (capRule!.source)
        : `no documented unused-connector rule for ${system.brand} in the trunk-cable catalog`,
    },
    extensionStock: {
      rawCableSku: system.rawCable?.sku ?? null,
      fieldWireableMaleSku: system.connectors.male?.sku ?? null,
      fieldWireableFemaleSku: system.connectors.female?.sku ?? null,
      basis: system.rawCable?.source ?? null,
    },
    geometryCoverage: coverage,
    confidence: coverage === 'geometry-derived' ? 1 : coverage === 'partial' ? 0.75 : 0.5,
    fieldDependentPortion: fieldDependent,
    derivation:
      `ordered = Σ per branch max(drops, ceil((installed × ${waste} waste + allowance share) ÷ ${pitch ?? '—'} ft pitch)) × pitch `
      + `= ${totals.procurementLengthFt} ft over ${totals.orderedSections} section(s); the drop-count basis `
      + `Σ ceil(drops × pitch × waste) = ${totals.dropBasisProcurementLengthFt} ft is the LOWER BOUND of the same derivation`,
    provenance: {
      source: args.provenanceSource ?? 'buildQCableTopology (AAC WS-5 — canonical layout geometry + brand trunk catalog)',
      ref: cable.sku,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE SOLUTION EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════

export interface EvaluateQCableSolutionsArgs {
  topology: QCableTopology;
  system: TrunkCableSystem;
  /** the exact selected system label for extension compatibility checks. */
  selectedSystem: string;
  /** operator-selected, registry-backed extension solutions (may be empty). */
  cableExtensionSolutions?: CableExtensionSolution[];
  /** the per-branch micro device limit (catalog, per model) for a reassignment. */
  maxDevicesPerBranch: number;
  /** the source of the extension-solution lookup (recorded on the option even
   *  when it returned nothing, so a failed retrieval is never swallowed). */
  extensionLookupNote?: string | null;
  /** D-1 (Ray, 2026-07-20): branch COUNT is the manufacturer minimum and planes
   *  are a routing preference — a chunk-boundary plane crossing is PERMITTED.
   *  Kept as an explicit input so the ruling is visible at the call site; the
   *  reassignment evaluator refuses any partition that needs extra homeruns. */
  planeContainmentPreferred?: boolean;
}

function perBranchView(t: QCableTopology, providedFor: (b: QCableBranchTopology) => number): {
  perBranch: QCableSolutionOption['perBranch']; aggregateProvided: number; aggregateRequired: number; allSufficient: boolean;
} {
  const perBranch = t.branches.map(b => {
    const provided = r1(providedFor(b));
    return { branchId: b.branchId, requiredFt: b.requiredLengthFt, providedFt: provided, sufficient: provided + 1e-9 >= b.requiredLengthFt };
  });
  return {
    perBranch,
    aggregateProvided: r1(perBranch.reduce((s, p) => s + p.providedFt, 0)),
    aggregateRequired: r1(perBranch.reduce((s, p) => s + p.requiredFt, 0)),
    allSufficient: perBranch.every(p => p.sufficient),
  };
}

/**
 * Evaluate the WHOLE option space against the topology's own requirement and
 * return a complete solution or a precise unresolved reason.
 *
 * The options, in the directive's order:
 *   (a) the stock cable AS ORDERED (drop-count basis) — per branch AND aggregate
 *   (b) a different LISTED STOCK CONFIGURATION of the same product family:
 *       (b1) the SAME cable ordered by geometry-derived section count
 *            (auto-adoptable: nothing physical changes, only the quantity)
 *       (b2) an alternate listed connector pitch from the catalog
 *   (c) a VERIFIED listed extension solution (registry-backed)
 *   (d) a cable-END PLACEMENT change (which end carries the home-run transition)
 *   (e) a branch REASSIGNMENT (proposed, never silently applied)
 *   (f) the genuine unknown-field-route residual
 */
export function evaluateQCableSolutions(args: EvaluateQCableSolutionsArgs): QCableSolutionEvaluation {
  const t = args.topology;
  const pitch = t.connectorSpacingFt;
  const waste = t.wasteFactor;
  const options: QCableSolutionOption[] = [];

  const sizingRequirementFt = t.totals.requiredLengthFt;
  const currentFt = t.totals.dropBasisProcurementLengthFt;

  /** A solution is COMPLETE only when the molded cable covers the molded path AND
   *  every sub-array/plane bridge is established (or eliminated). An option that
   *  only orders molded cable leaves an unestablished bridge — the path is not
   *  continuous — so it can never be viable while one exists. */
  const unestablishedBridges = t.bridgeRequirements.filter(br => !br.established);
  const bridgeBlock = unestablishedBridges.map(br =>
    `branch ${br.branchId}: the ${r1(br.gapFt)} ft sub-array/roof-plane bridge at drop ${br.atDropIndex} is not spanned by molded cable `
    + 'and no established jumper covers it — this option does not complete the cable path');

  // ── (a) the stock cable AS ORDERED (the drop-count basis) ──────────────────
  const asOrdered = perBranchView(t, b => (pitch != null ? Math.ceil(b.dropCount * pitch * waste) : 0));
  options.push({
    optionId: 'stock-as-ordered',
    kind: 'stock-as-ordered',
    title: `Current order — ${t.sku ?? 'selected cable'} at one connector-drop per micro`,
    description: `Σ drops × ${pitch ?? '—'} ft pitch × ${waste} waste = ${currentFt} ft. Checked PER BRANCH and in aggregate against the as-routed path.`,
    viable: asOrdered.allSufficient && asOrdered.aggregateProvided + 1e-9 >= sizingRequirementFt
      && unestablishedBridges.length === 0,
    autoAdoptable: true,
    adopted: false,
    changesPhysicalDesign: false,
    perBranch: asOrdered.perBranch,
    aggregateRequiredFt: sizingRequirementFt,
    aggregateProvidedFt: asOrdered.aggregateProvided,
    aggregateSufficient: asOrdered.aggregateProvided + 1e-9 >= sizingRequirementFt,
    requiresAction: null,
    blockingReasons: [
      ...(asOrdered.aggregateProvided + 1e-9 < sizingRequirementFt
        ? [`aggregate ${asOrdered.aggregateProvided} ft is short of the ${sizingRequirementFt} ft requirement by ${r1(sizingRequirementFt - asOrdered.aggregateProvided)} ft`] : []),
      ...asOrdered.perBranch.filter(p => !p.sufficient)
        .map(p => `branch ${p.branchId}: ordered ${p.providedFt} ft is short of its ${p.requiredFt} ft as-routed requirement by ${r1(p.requiredFt - p.providedFt)} ft`),
      ...bridgeBlock,
    ],
    evidenceRefs: [`provenance:qcable-topology#${t.sku ?? 'cable'}`],
    rank: null,
    payload: null,
  });

  // ── (b1) the SAME listed cable, geometry-derived ORDER COMPOSITION ─────────
  // Nothing physical changes: same product, same layout, same branch assignment.
  // Only the ordered section count rises, and the molded connectors that land in
  // a transition gap become dead drops closed with the manufacturer's listed
  // sealing cap — the brand's OWN documented practice. Not available to a brand
  // that publishes no unused-connector rule.
  const composition = perBranchView(t, b => b.procurementLengthFt);
  const compositionBlocking: string[] = [];
  if (!t.deadDropTreatment.established && t.totals.deadDropCount > 0) {
    compositionBlocking.push(t.deadDropTreatment.basis
      + ' — the extra molded connectors this composition creates cannot be closed out, so the composition is not established');
  }
  if (t.geometryCoverage !== 'geometry-derived') {
    compositionBlocking.push('the as-routed path is not established for every branch (see the field-dependent portion) — an order composition cannot be certified against an estimated path');
  }
  if (!composition.allSufficient) {
    compositionBlocking.push(...composition.perBranch.filter(p => !p.sufficient)
      .map(p => `branch ${p.branchId}: composed ${p.providedFt} ft still short of ${p.requiredFt} ft`));
  }
  // A sub-array / roof-plane BRIDGE is not solved by ordering more molded cable:
  // the manufacturer documents a raw-cable jumper + field-wireable pair for a gap
  // larger than the connector spacing. The composition therefore cannot be the
  // complete solution for a design that contains one.
  for (const br of t.bridgeRequirements) {
    compositionBlocking.push(
      `branch ${br.branchId}: the ${r1(br.gapFt)} ft sub-array/roof-plane bridge at drop ${br.atDropIndex} exceeds the `
      + `${t.connectorSpacingFt ?? '—'} ft molded connector pitch — more molded cable is NOT the manufacturer's method for this gap `
      + '(a raw-cable jumper with a field-wireable connector pair is)');
  }
  options.push({
    optionId: 'derived-stock-order-composition',
    kind: 'derived-stock-order-composition',
    title: `Order composition — ${t.sku ?? 'selected cable'}, ${t.totals.orderedSections} connector section(s) from the as-routed path`,
    description:
      `Same listed cable, same layout, same branch assignment: order ${t.totals.orderedSections} section(s) `
      + `(${t.totals.procurementLengthFt} ft) instead of ${t.totals.dropCount} (${currentFt} ft), because ${t.totals.rowTransitionCount} row `
      + `and ${t.totals.arrayTransitionCount} array transition(s) consume more than one molded section. `
      + `${t.totals.deadDropCount} unused connector(s) are closed with ${t.deadDropTreatment.sku ?? 'the listed sealing cap'}.`,
    viable: compositionBlocking.length === 0,
    autoAdoptable: true,
    adopted: false,
    changesPhysicalDesign: false,
    perBranch: composition.perBranch,
    aggregateRequiredFt: sizingRequirementFt,
    aggregateProvidedFt: composition.aggregateProvided,
    aggregateSufficient: composition.aggregateProvided + 1e-9 >= sizingRequirementFt,
    requiresAction: null,
    blockingReasons: compositionBlocking,
    evidenceRefs: [
      `provenance:qcable-topology#${t.sku ?? 'cable'}`,
      ...(t.deadDropTreatment.established ? [`document:${t.deadDropTreatment.basis}`] : []),
    ],
    rank: null,
    payload: {
      orderedSections: t.totals.orderedSections,
      sealingCapSku: t.deadDropTreatment.sku,
      sealingCapsRequired: t.totals.sealingCapsRequired,
      perBranchSections: t.branches.map(b => ({ branchId: b.branchId, sections: b.orderedSections, deadDrops: b.deadDropCount })),
    },
  });

  // ── (b2) alternate LISTED stock variants (different molded pitch) ──────────
  const variants = listTrunkCableVariants(args.system, { orientation: t.orientation, modulePitchFt: t.modulePitchFt });
  for (const v of variants) {
    if (v.cable.sku === t.sku) continue;
    const alt = perBranchView(t, b => (v.cable.connectorSpacingFt > 0 ? Math.ceil(b.dropCount * v.cable.connectorSpacingFt * waste) : 0));
    const blocking: string[] = [];
    if (!v.applicable) blocking.push(v.reason ?? 'variant not applicable to this array');
    if (!alt.allSufficient) {
      blocking.push(...alt.perBranch.filter(p => !p.sufficient)
        .map(p => `branch ${p.branchId}: ${v.cable.sku} provides ${p.providedFt} ft, short of ${p.requiredFt} ft`));
    }
    if (alt.aggregateProvided + 1e-9 < sizingRequirementFt) {
      blocking.push(`aggregate ${alt.aggregateProvided} ft short of ${sizingRequirementFt} ft`);
    }
    blocking.push(...bridgeBlock);
    options.push({
      optionId: `alternate-listed-cable:${v.cable.sku}`,
      kind: 'alternate-listed-cable',
      title: `Alternate listed cable ${v.cable.sku} (${v.cable.connectorSpacingFt} ft molded pitch)`,
      description: `${v.cable.forCells ?? v.cable.orientation} — ordered at one drop per micro: Σ ceil(drops × ${v.cable.connectorSpacingFt} × ${waste}).`
        + (v.orientationMatch ? '' : ` NOTE: the manufacturer states this pitch for ${v.cable.orientation} arrays; on a ${t.orientation} array the excess is absorbed as slack.`),
      viable: blocking.length === 0,
      autoAdoptable: false,
      adopted: false,
      changesPhysicalDesign: true,      // a different ordered product
      perBranch: alt.perBranch,
      aggregateRequiredFt: sizingRequirementFt,
      aggregateProvidedFt: alt.aggregateProvided,
      aggregateSufficient: alt.aggregateProvided + 1e-9 >= sizingRequirementFt,
      requiresAction: blocking.length === 0
        ? `Select ${v.cable.sku} as the branch trunk cable (a product-selection change; the drawings, schedules and BOM re-derive from it).`
        : null,
      blockingReasons: blocking,
      evidenceRefs: [`document:${v.cable.source ?? 'brand trunk-cable catalog'}`],
      rank: null,
      payload: { sku: v.cable.sku, connectorSpacingFt: v.cable.connectorSpacingFt, orientationMatch: v.orientationMatch },
    });
  }

  // ── (b3) the manufacturer's documented RAW-CABLE JUMPER for each bridge ────
  // The exact stock is named (raw cable footage + field-wireable pairs) from the
  // brand catalog. It is NOT viable on the engine's own say-so: the standing ECD
  // W1-E ruling is that a field-wireable connector solution is established only
  // by a VERIFIED cable-extension solution naming the exact product. So the
  // engine states the complete recipe AND the exact reason it is not established.
  if (t.bridgeRequirements.length > 0) {
    const jumperEstablished = t.bridgeRequirements.every(br => br.established);
    const withJumpers = perBranchView(t, b => b.procurementLengthFt);
    options.push({
      optionId: 'raw-cable-jumper',
      kind: 'raw-cable-jumper',
      title: `Raw-cable jumper at ${t.bridgeRequirements.length} sub-array/roof-plane bridge(s)`,
      description:
        `${t.totals.jumperRawCableFt} ft of ${t.extensionStock.rawCableSku ?? 'raw cable'} + `
        + `${t.totals.jumperConnectorPairs} × ${t.extensionStock.fieldWireableMaleSku ?? 'M'}/${t.extensionStock.fieldWireableFemaleSku ?? 'F'} `
        + `field-wireable connector pair(s), bridging ${t.totals.bridgeGapFt} ft of gap that the molded cable cannot span. `
        + `Molded cable then covers the remaining ${t.totals.moldedPathLengthFt} ft of path.`,
      viable: jumperEstablished,
      autoAdoptable: false,
      adopted: false,
      changesPhysicalDesign: true,
      perBranch: withJumpers.perBranch,
      aggregateRequiredFt: sizingRequirementFt,
      aggregateProvidedFt: withJumpers.aggregateProvided,
      aggregateSufficient: withJumpers.aggregateProvided + 1e-9 >= sizingRequirementFt,
      requiresAction:
        'Select the listed raw-cable + field-wireable connector jumper as a cable-extension solution and archive + verify its manufacturer document through the document registry.',
      blockingReasons: jumperEstablished ? [] : [
        'the field-wireable jumper is a SEPARATE listed product: per the standing ECD W1-E ruling it is established only by a VERIFIED cable-extension solution naming the exact product, never by the engine asserting the manufacturer practice',
      ],
      evidenceRefs: t.bridgeRequirements.map(br => `document:${br.basis}`),
      rank: null,
      payload: { bridges: t.bridgeRequirements },
    });
  }

  // ── (c) VERIFIED listed extension solutions (registry-backed) ──────────────
  const sols = args.cableExtensionSolutions ?? [];
  // the length a solution must ADD to complete the path: the molded shortfall
  // against the current order PLUS every bridge no established jumper spans.
  const deficitAgainstCurrent = r1(
    Math.max(0, sizingRequirementFt - currentFt)
    + unestablishedBridges.reduce((sum, br) => sum + br.rawCableFt, 0));
  if (sols.length === 0) {
    options.push({
      optionId: 'verified-listed-extension',
      kind: 'verified-listed-extension',
      title: 'Verified listed extension / jumper product',
      description: 'A listed extension product backed by a VERIFIED, current, archived manufacturer document covering the exact SKU and stating compatibility with the selected system.',
      viable: false,
      autoAdoptable: false,
      adopted: false,
      changesPhysicalDesign: true,
      perBranch: t.branches.map(b => ({ branchId: b.branchId, requiredFt: b.requiredLengthFt, providedFt: 0, sufficient: false })),
      aggregateRequiredFt: sizingRequirementFt,
      aggregateProvidedFt: 0,
      aggregateSufficient: false,
      requiresAction: 'Select a listed extension product and archive + verify its manufacturer document through the document registry.',
      blockingReasons: [args.extensionLookupNote
        ?? 'no operator-selected listed extension product, and no verified extension document resolved from the document registry'],
      evidenceRefs: [],
      rank: null,
      payload: null,
    });
  } else {
    for (const sol of sols) {
      const clearance = evaluateCableExtensionClearance(
        { selectedSystem: args.selectedSystem, deficitFt: deficitAgainstCurrent }, sol);
      const added = sol.addedLengthFt ?? 0;
      const view = perBranchView(t, b => {
        // an extension is placed on named branches; a branch it does not name
        // receives nothing (an aggregate cannot rescue a per-branch shortfall).
        const names = new Set([...(sol.locations ?? []), ...(sol.cableSegmentIds ?? [])]);
        const share = names.has(b.branchId) ? added / Math.max(1, [...names].length) : 0;
        return (pitch != null ? Math.ceil(b.dropCount * pitch * waste) : 0) + share;
      });
      const blocking = [...clearance.reasons];
      // a listed extension that names the bridge locations establishes them;
      // otherwise the bridge remains unspanned.
      const namesBridge = new Set([...(sol.locations ?? []), ...(sol.cableSegmentIds ?? [])]);
      blocking.push(...unestablishedBridges
        .filter(br => !namesBridge.has(br.branchId))
        .map(br => `branch ${br.branchId}: the ${r1(br.gapFt)} ft sub-array/roof-plane bridge is not named by this solution`));
      if (!view.allSufficient) {
        blocking.push(...view.perBranch.filter(p => !p.sufficient)
          .map(p => `branch ${p.branchId}: still ${r1(p.requiredFt - p.providedFt)} ft short after the extension`));
      }
      options.push({
        optionId: `verified-listed-extension:${sol.solutionId}`,
        kind: 'verified-listed-extension',
        title: `Verified listed extension ${sol.selectedSku ?? '(no SKU selected)'}`,
        description: `${sol.kind} — ${added} ft added at ${(sol.locations ?? []).join(', ') || 'no stated location'}.`,
        // viable ⇔ the clearance passes, every branch is covered, AND nothing
        // remains blocking (an unnamed bridge is still an incomplete path).
        viable: clearance.cleared && view.allSufficient && blocking.length === 0,
        autoAdoptable: false,
        adopted: false,
        changesPhysicalDesign: true,
        perBranch: view.perBranch,
        aggregateRequiredFt: sizingRequirementFt,
        aggregateProvidedFt: view.aggregateProvided,
        aggregateSufficient: view.aggregateProvided + 1e-9 >= sizingRequirementFt,
        requiresAction: clearance.cleared ? null : 'Complete the listed-extension selection record (see the missing conditions).',
        blockingReasons: blocking,
        evidenceRefs: sol.manufacturerDocument?.documentId ? [`document:${sol.manufacturerDocument.documentId}`] : [],
        rank: null,
        payload: { solutionId: sol.solutionId, missing: clearance.missing },
      });
    }
  }

  // ── (d) cable-END PLACEMENT (which end carries the home-run transition) ────
  // The chain length is END-INVARIANT (the same ordered path is traversed either
  // way); the only end-dependent term is the home-run lead-in, and the roof
  // junction-box POSITION is not carried in the CAD model. So this option is
  // evaluated and reported as NOT ESTABLISHED, naming the exact missing input —
  // never a fabricated improvement.
  options.push({
    optionId: 'cable-end-placement',
    kind: 'cable-end-placement',
    title: 'Move the home-run transition to the other cable end',
    description: 'The ordered chain through the micros is identical from either end, so the as-routed length is end-invariant; only the home-run lead-in depends on which end leaves the array.',
    viable: false,
    autoAdoptable: false,
    adopted: false,
    changesPhysicalDesign: true,
    perBranch: t.branches.map(b => ({ branchId: b.branchId, requiredFt: b.requiredLengthFt, providedFt: b.procurementLengthFt, sufficient: b.sufficient })),
    aggregateRequiredFt: sizingRequirementFt,
    aggregateProvidedFt: t.totals.procurementLengthFt,
    aggregateSufficient: t.totals.procurementLengthFt + 1e-9 >= sizingRequirementFt,
    requiresAction: null,
    blockingReasons: [
      'the roof junction-box / home-run transition POINT is not carried in the CAD model, so the end-dependent lead-in cannot be evaluated — the cable path itself is unchanged by the choice of end',
    ],
    evidenceRefs: [],
    rank: null,
    payload: {
      branchEnds: t.branches.flatMap(b => b.cableEnds.map(e => ({ endId: e.endId, kind: e.kind, xFt: e.xFt, yFt: e.yFt }))),
    },
  });

  // ── (e) branch REASSIGNMENT (proposed, never silently applied) ─────────────
  const rebranch = evaluateBranchReassignment(t, args);
  if (rebranch) options.push(rebranch);

  // ── (f) the genuine field-route residual ───────────────────────────────────
  options.push({
    optionId: 'field-route-residual',
    kind: 'field-route-residual',
    title: 'Field-measured route',
    description: 'The portion of the cable route that no record carries: the home-run transition point and any branch whose per-device coordinates are unavailable.',
    viable: false,
    autoAdoptable: false,
    adopted: false,
    changesPhysicalDesign: false,
    perBranch: [],
    aggregateRequiredFt: sizingRequirementFt,
    aggregateProvidedFt: 0,
    aggregateSufficient: false,
    requiresAction: 'Record the field-measured route for the named items.',
    blockingReasons: t.fieldDependentPortion,
    evidenceRefs: [],
    rank: null,
    payload: null,
  });

  // ── RANK + ADOPT ───────────────────────────────────────────────────────────
  // Preference: viable ⇒ nothing physical changes ⇒ auto-adoptable ⇒ least
  // excess cable. A NON-viable option is never ranked and never adopted.
  const viable = options.filter(o => o.viable);
  viable.sort((a, b) => {
    const phys = Number(a.changesPhysicalDesign) - Number(b.changesPhysicalDesign);
    if (phys !== 0) return phys;
    const auto = Number(b.autoAdoptable) - Number(a.autoAdoptable);
    if (auto !== 0) return auto;
    return (a.aggregateProvidedFt - a.aggregateRequiredFt) - (b.aggregateProvidedFt - b.aggregateRequiredFt);
  });
  viable.forEach((o, i) => { o.rank = i + 1; });

  const recommended = viable[0] ?? null;
  const adoptable = viable.find(o => o.autoAdoptable && !o.changesPhysicalDesign) ?? null;
  if (adoptable) adoptable.adopted = true;

  const resolved = adoptable != null;
  // The unresolved reason is PRECISE and SHORT: the primary cause, then the
  // nearest complete solution and the exact action that would establish it.
  // (Never a bare deficit, and never a wall of every option's first reason —
  // the full per-option evaluation rides in the payload.)
  const nearest = options
    .filter(o => !o.viable && o.requiresAction)
    .sort((a, b) => a.blockingReasons.length - b.blockingReasons.length)[0] ?? null;
  const primaryCause = unestablishedBridges.length
    ? `${unestablishedBridges.length} sub-array/roof-plane bridge(s) totalling ${t.totals.bridgeGapFt} ft exceed the `
      + `${pitch ?? '—'} ft molded connector pitch, so molded cable alone cannot complete the path`
    : `the ordered ${currentFt} ft does not cover the ${sizingRequirementFt} ft as-routed requirement`;
  const unresolvedReason = resolved ? null
    : recommended
      ? `no solution is auto-adoptable without a design or product change; the ranked viable option is "${recommended.title}" — ${recommended.requiresAction ?? 'adoption is a design decision'}`
      : `${primaryCause}. ${options.length} option(s) evaluated, none complete. `
        + (nearest ? `Nearest: "${nearest.title}" — ${nearest.requiresAction}` : 'No option states an action that would complete it.');

  return {
    evaluated: true,
    measuredDeficitFt: deficitAgainstCurrent,
    sizingRequirementFt,
    currentProcurementFt: currentFt,
    options,
    recommendedOptionId: recommended?.optionId ?? null,
    adoptedOptionId: adoptable?.optionId ?? null,
    resolved,
    unresolvedReason,
    residualFieldDependent: t.fieldDependentPortion,
    derivation: t.derivation,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — BRANCH REASSIGNMENT (proposed; adoption is a DESIGN action)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a VALID branch reassignment eliminates the sub-array bridges
 * (and therefore the deficit).
 *
 * IT IS BOUND BY RAY'S D-1 RULING (2026-07-20, lib/permit/utils/branching.ts:233):
 * "Physical roof grouping does not define electrical branch boundaries. The
 * branch-assignment engine must optimize routing while satisfying manufacturer
 * limits." Branch COUNT is fixed at the manufacturer minimum
 * `ceil(N / maxPerBranch)`, sizes are balanced, and planes are a ROUTING
 * PREFERENCE ONLY - a branch crossing onto an adjacent plane at a chunk boundary
 * is explicitly PERMITTED. So this evaluator may NEVER propose extra homeruns to
 * make the cable arithmetic easier: a partition that needs more than the minimum
 * branch count is REFUSED, with the arithmetic that proves it.
 *
 * When a plane-contained partition DOES fit inside the minimum branch count it
 * is PROPOSED - never applied, because the branch assignment is design data.
 */
export function evaluateBranchReassignment(
  t: QCableTopology,
  args: Pick<EvaluateQCableSolutionsArgs, 'maxDevicesPerBranch'>,
): QCableSolutionOption | null {
  const pitch = t.connectorSpacingFt;
  if (pitch == null) return null;
  const maxPer = args.maxDevicesPerBranch > 0 ? args.maxDevicesPerBranch : 0;
  if (maxPer <= 0) return null;

  const base = {
    optionId: 'branch-reassignment',
    kind: 'branch-reassignment' as const,
    autoAdoptable: false,
    adopted: false,
    changesPhysicalDesign: true,
    aggregateRequiredFt: t.totals.requiredLengthFt,
    evidenceRefs: ['provenance:qcable-topology#branch-reassignment', 'authority:D-1 branch-assignment ruling (2026-07-20)'],
    rank: null as number | null,
  };

  const all = t.branches.flatMap(b => b.drops.map(d => ({ ...d, fromBranch: b.branchId })));
  if (all.length === 0 || t.geometryCoverage !== 'geometry-derived') {
    return {
      ...base,
      title: 'Branch reassignment',
      description: 'Re-partition the micros so no branch cable contains a sub-array bridge, within the D-1 minimum branch count.',
      viable: false,
      perBranch: [], aggregateProvidedFt: 0, aggregateSufficient: false,
      requiresAction: null,
      blockingReasons: ['per-device coordinates are not established for every branch - a reassignment cannot be evaluated without the layout geometry'],
      payload: null,
    };
  }

  const deviceCount = all.length;
  // D-1: the branch COUNT is the manufacturer minimum. It is not a free variable.
  const minBranchCount = Math.max(1, Math.ceil(deviceCount / maxPer));

  const byPlane = new Map<string, typeof all>();
  for (const d of all) {
    const key = d.roofPlaneId ?? '(no-plane)';
    const arr = byPlane.get(key) ?? [];
    arr.push(d);
    byPlane.set(key, arr);
  }
  const planeKeys = [...byPlane.keys()].sort();
  const perPlaneBranches = planeKeys.map(k => ({
    plane: k, devices: byPlane.get(k)!.length, branches: Math.ceil(byPlane.get(k)!.length / maxPer),
  }));
  const planeContainedCount = perPlaneBranches.reduce((s, p) => s + p.branches, 0);

  if (planeContainedCount > minBranchCount) {
    // PROVABLY impossible within the ruling: state the arithmetic, refuse.
    return {
      ...base,
      title: 'Branch reassignment',
      description:
        `Re-partitioning so that no branch crosses a roof plane would need ${planeContainedCount} branch(es) `
        + `(${perPlaneBranches.map(p => `plane ${p.plane}: ${p.devices} device(s) / ${maxPer} per branch => ${p.branches}`).join('; ')}).`,
      viable: false,
      perBranch: t.branches.map(b => ({ branchId: b.branchId, requiredFt: b.requiredLengthFt, providedFt: b.procurementLengthFt, sufficient: b.sufficient })),
      aggregateProvidedFt: t.totals.procurementLengthFt,
      aggregateSufficient: false,
      requiresAction: null,
      blockingReasons: [
        `no valid reassignment exists: the D-1 branch-assignment ruling (Ray, 2026-07-20) fixes the branch count at the `
        + `manufacturer minimum ceil(${deviceCount} / ${maxPer}) = ${minBranchCount} and explicitly PERMITS a branch crossing onto an `
        + `adjacent plane at a chunk boundary. A plane-contained partition needs ${planeContainedCount} branch(es), i.e. `
        + `${planeContainedCount - minBranchCount} extra homerun(s) - the engine may not propose that to make the cable arithmetic easier.`,
      ],
      payload: { minBranchCount, planeContainedCount, perPlaneBranches, ruling: 'D-1 (2026-07-20) - branch count = ceil(N / maxPerBranch); planes are a routing preference' },
    };
  }

  // A plane-contained partition FITS inside the D-1 minimum count - propose it.
  const proposed: { branchId: string; label: string; planeId: string; drops: typeof all }[] = [];
  let n = 0;
  for (const plane of planeKeys) {
    const devs = [...byPlane.get(plane)!].sort((a, b) =>
      (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0) || a.xFt - b.xFt || a.yFt - b.yFt);
    const groups = Math.max(1, Math.ceil(devs.length / maxPer));
    const per = Math.ceil(devs.length / groups);
    for (let g = 0; g < groups; g++) {
      const chunk = devs.slice(g * per, (g + 1) * per);
      if (chunk.length === 0) continue;
      n++;
      proposed.push({ branchId: `rb-${n}`, label: `RB${n}`, planeId: plane, drops: chunk });
    }
  }

  const measured = proposed.map(p => {
    const pts = p.drops.map(d => ({ x: d.xFt, y: d.yFt }));
    const segs = branchChainSegmentsFt(pts);
    return { ...p, installed: r1(segs.reduce((s, d) => s + d, 0) + pitch) };
  });
  const totalInstalled = measured.reduce((s, m) => s + m.installed, 0);
  const perBranch = measured.map(m => {
    const allowShare = totalInstalled > 0 ? r1((m.installed / totalInstalled) * t.serviceLoopAllowanceFt) : 0;
    const required = r1(m.installed * t.wasteFactor + allowShare);
    const provided = r1(Math.ceil(m.drops.length * pitch * t.wasteFactor));
    return { branchId: m.branchId, requiredFt: required, providedFt: provided, sufficient: provided + 1e-9 >= required };
  });
  const aggregateProvided = r1(perBranch.reduce((s, p) => s + p.providedFt, 0));
  const aggregateRequired = r1(perBranch.reduce((s, p) => s + p.requiredFt, 0));
  const identical = proposed.length === t.branches.length
    && measured.every((m, i) => t.branches[i] && t.branches[i].dropCount === m.drops.length
      && t.branches[i].drops.every((d, j) => d.moduleInstanceId === m.drops[j]?.moduleInstanceId));
  const blocking = [
    ...perBranch.filter(p => !p.sufficient).map(p => `proposed branch ${p.branchId}: ${p.providedFt} ft short of ${p.requiredFt} ft`),
    ...(aggregateProvided + 1e-9 < aggregateRequired ? [`proposed aggregate ${aggregateProvided} ft short of ${aggregateRequired} ft`] : []),
    ...(identical ? ['the proposed partition is identical to the current branch assignment - reassignment offers nothing'] : []),
  ];

  return {
    ...base,
    title: `Branch reassignment - ${proposed.length} branch(es) of ${measured.map(m => m.drops.length).join('/')}`,
    description:
      `Re-partition the micros so every branch stays within one roof plane, at the D-1 minimum branch count `
      + `(ceil(${deviceCount} / ${maxPer}) = ${minBranchCount}). PROPOSED ONLY: the branch assignment is design data - the engine `
      + `states the exact reassignment, it does not apply it.`,
    viable: blocking.length === 0,
    perBranch,
    aggregateProvidedFt: aggregateProvided,
    aggregateSufficient: aggregateProvided + 1e-9 >= aggregateRequired,
    requiresAction: blocking.length === 0
      ? 'Adopt the proposed branch assignment in the design (a DESIGN action - the layout, branch map, SLD and BOM re-derive from it).'
      : null,
    blockingReasons: blocking,
    payload: {
      minBranchCount,
      branchDeviceLimit: maxPer,
      proposedBranches: measured.map(m => ({
        branchId: m.branchId, label: m.label, roofPlaneId: m.planeId,
        deviceCount: m.drops.length,
        moduleInstanceIds: m.drops.map(d => d.moduleInstanceId),
        installedLengthFt: m.installed,
      })),
      ruling: 'D-1 (2026-07-20) - branch count = ceil(N / maxPerBranch); planes are a routing preference only',
    },
  };
}
