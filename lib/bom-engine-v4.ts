// ============================================================
// BOM Intelligence Engine V4
// Derives BOM from: equipment registry + topology + mount +
//                   conduit type + wiring runs + jurisdiction
// NO static templates. All items derived from registry rules.
// Quantities auto-update on any input change.
// ============================================================

import {
  TopologyType,
  getRegistryEntryV4,
  evaluateQuantityFormulaV4,
  normalizeTopologyV4,
  EQUIPMENT_REGISTRY_V4,
  EquipmentRegistryEntry,
} from './equipment-registry-v4';

import {
  resolveTopology,
  TopologyManagerContext,
  BOMStageDefinition,
} from './topology-manager';
import { resolveIntegratedEquipment } from './equipment/integratedBos';
import { nextStandardOcpd, nextEnclosure } from './electrical/stdSizes';
import { resolveTrunkCablePlan } from './equipment/trunkCable';
import { resolveSuggestedTools } from './equipment/suggestedTools';
import { getPanelById, getMicroinverterById, getInverterById } from './equipment-db';

import { racewayNecArticle, type RunSegment } from './computed-system';
import type { RackingBOM } from './structural-engine-v4';
import { getGeneratorById, getATSById, getBackupInterfaceById } from './equipment-db';
// MASTER TASK: deriveStructuralBOM removed from V4 — now called in API route merge layer
import type { BOMLineItemV4, BOMStageId, BOMSystemType } from './bom-types-v4';
// Wave 2c (docs/ARCHITECTURE-per-subsystem-equipment.md §1.7): per-sub-system
// equipment map — Stages 1–3 run PER SUB, Stage 4 (service AC) runs ONCE.
import type { SubSystemKey, SubSystemEquipment } from './system/subSystemEquipment';

// ─── BOM shared line/stage types are defined in ./bom-types-v4 ─────────────

export type { BOMLineItemV4, BOMStageId, BOMSystemType } from './bom-types-v4';

// ─── BOM Generation Input ─────────────────────────────────────────────────────

export interface BOMGenerationInputV4 {
  // Equipment selection
  inverterId: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;
  panelId?: string;

  // System sizing
  moduleCount: number;
  deviceCount?: number;       // micro: ceil(panelCount / modulesPerDevice); if omitted falls back to moduleCount
  /** §13 — canonical AC-branch count from the plane-aware branch plan
   *  (snapshot.electrical.branches.length). Governs micro terminator/cap qty so
   *  3 branches never materialize 4 terminators. Undefined ⇒ resolver heuristic. */
  branchCount?: number;
  stringCount: number;
  inverterCount: number;
  systemKw: number;
  acOutputKw?: number;        // AC nameplate kW — sizes AC-side gear (disconnect/fuse/backfeed); systemKw is DC and oversizes them

  // Wiring
  dcWireGauge: string;
  acWireGauge: string;
  dcWireLength: number;       // feet (DC home run, INCLUDES trenchRunLengthFt for ground/fence)
  trenchRunLengthFt?: number; // feet — buried ground/fence array→service portion (NEC 300.5 PVC); subset of dcWireLength
  acWireLength: number;       // feet (AC home run)
  conduitType: 'EMT' | 'PVC' | 'RMC' | 'LFMC';
  conduitSizeInch: string;    // e.g. "3/4"
  
  // ComputedSystem.runs — single source of truth for wire/conduit quantities
  runs?:                   RunSegment[];
  
  // ComputedSystem.bomQuantities — pre-calculated wire/conduit quantities from segmentSchedule
  // When provided, these are used DIRECTLY for wire line items (guarantees exact match with summary cards)
  bomQuantities?: {
    wire10AWG?: number;
    wire8AWG?: number;
    wire6AWG?: number;
    wire4AWG?: number;
    conduitEMT?: number;
    conduitPVC?: number;
  };

  // Structural
  roofType: string;
  attachmentCount: number;    // computed from layout
  railSections: number;       // computed from layout
  // Real racking quantities from the structural engine (calcRackingBOM). When
  // present (roof), Stage 5 emits rails/splices/mounts/clamps/lag+rail bolts
  // FROM this single source instead of the registry accessory formulas — so the
  // BOM matches the structural sheets. Absent (design-studio) → registry fallback.
  rackingBOM?: RackingBOM;

  // Layout (Phase 3 - Future Layout Engine)
  rowCount?: number;          // number of rows in array layout
  columnCount?: number;       // columns per row
  layoutOrientation?: 'portrait' | 'landscape';
  /**
   * Distinct sub-arrays / roof planes from the REAL design (arrayLayout
   * selector) — each extra sub-array forces one trunk-cable bridge splice
   * (field-wireable M+F pair). Default 1 (single contiguous plane).
   */
  subArrayCount?: number;
  /**
   * Installer preference: cut the trunk at row transitions (short cut-lengths /
   * crew habit) instead of the cheapest-option service loop. Splice pairs then
   * = (rows-1) - (branches-1), since branch boundaries absorb transitions.
   */
  spliceAtRows?: boolean;
  /**
   * Emit the "Truck Stock — Recommended Extras" stage (default true). The
   * permit BOM passes false — the SCHED shows installed materials only.
   */
  includeTruckStock?: boolean;
  /**
   * Emit the "Suggested Tools — This Job" stage (default true). Advice, not
   * materials: never priced, excluded from the permit. Permit BOM passes false.
   */
  includeSuggestedTools?: boolean;
  /**
   * Hybrid (P2): per-sub-system module counts. Drives quantities that are
   * MOUNT-LOCATION-specific — NEC 690.12 module-level RSD applies to the ROOF
   * subset even when the project's winning systemType is fence/ground (the
   * project-wide exemption wrongly skipped RSD for on-roof panels — Stowell).
   */
  subSystemCounts?: { roof: number; ground: number; fence: number };
  /**
   * Hybrid (P3): explicit roof-subset row/string count (from roofData.stringCount).
   * When absent and subSystemCounts is present, Stage 5 pro-rates the project
   * rows by the roof share: ceil(roofModules / (moduleCount / rows)).
   */
  roofStringCount?: number;
  /**
   * Wave 2c (contract §1.7): the per-sub-system equipment map. When present
   * with 2+ entries AND subSystemCounts provides the module split, the engine
   * runs Stages 1–3 PER SUB-SYSTEM (each sub's own panel / inverter ecosystem /
   * trunk plan / RSD authority), resolves integrated BOS per BRAND GROUP with
   * that group's real branch count, and emits Stage 4 (service-side AC gear)
   * exactly ONCE from aggregate values (Invariant I-6). Every sub-scoped line
   * is stamped `subSystem`; shared service lines stay unstamped.
   *
   * ABSENT or single-entry ⇒ the exact legacy code path (Invariant I-1: the
   * Wave-0 goldens pin byte identity, including the nextId() sequence).
   * Routes wire this in Wave 3/4; until then the field is inert in prod.
   */
  subSystemEquipment?: Partial<Record<SubSystemKey, SubSystemEquipment>>;

  // Electrical
  mainPanelAmps: number;
  backfeedAmps: number;
  acOCPD: number;
  dcOCPD: number;
  /** Hybrid only: the system AC-disconnect rating from the shared AC-collection
   *  (Σ per-source backfeed OCPD → next standard, the SAME value E-1 draws).
   *  When set, the per-sub Stage-4 disconnect sizes to this instead of the
   *  aggregate-kW×1.25 basis, so BOM/SCHED/E-1 print the identical rating.
   *  Undefined ⇒ legacy kW basis (single-system stays byte-identical). */
  systemAcDisconnectA?: number;
  acVoltage?: number;         // AC system voltage (default: 240V)
  dcVoltage?: number;         // DC string voltage (default: 400V)
  phases?: number;            // 1 or 3 phase (default: 1)
  moduleWatts?: number;       // module wattage (for BOM display)

  // Jurisdiction
  jurisdiction?: string;
  requiresProductionMeter?: boolean;
  requiresACDisconnect?: boolean;
  requiresDCDisconnect?: boolean;
  requiresRapidShutdown?: boolean;
  /** §7 GROUNDING AUTHORITY (post-campaign correction 07-22): a grid-tied PV
   *  interconnection bonds to the EXISTING service grounding electrode system
   *  (NEC 250.64 / 690.47) — it does NOT add a new electrode. A ground rod +
   *  acorn clamp + #6 GEC are materialized ONLY when an authoritative design
   *  input requires a NEW electrode (e.g. a detached structure / no existing
   *  GES). Undefined/false ⇒ no auto electrode hardware (the canonical
   *  groundingObjects record GEC as none-required). */
  requiresGroundingElectrode?: boolean;

  // Labels (NEC 690.31, 690.54, 690.56)
  requiresWarningLabels?: boolean;

  // Interconnection method — controls whether backfed breaker appears in BOM
  // 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE' | 'BACKFED_BREAKER'
  interconnectionMethod?: string;
  panelBusRating?: number;  // For NEC 705.12(B) 120% rule calculation

  // Generator / ATS / BUI — for BOM line items
  generatorId?: string;
  atsId?: string;
  backupInterfaceId?: string;
  generatorKw?: number;
  atsAmpRating?: number;
  backupInterfaceMaxA?: number;
  generatorWireLength?: number;  // ft — distance from generator to ATS, drives the whip cable line item
  batteryCount?: number;        // qty of battery units

  // System type — enables fence/ground structural BOM via bom-system-profiles
  systemType?: BOMSystemType;

  // Error 7b fix: topologyType accessed via `(input as any).topologyType` in debug log
  topologyType?: TopologyType;

  // Fence structural input (from CADFenceModel)
  fenceData?: {
    totalPosts: number;
    postSpacingFt: number;
    postEmbedFt: number;
    postHeightFt: number;
    railCount: number;
    totalFenceLengthFt: number;
    segmentCount: number;
    gateCount: number;
    gateWidthsFt: number[];
    solarSectionCount: number;
    vinylSectionCount: number;
    panelWidthFt: number;
    panelHeightFt: number;
  };

  // Ground structural input (from CADGroundArray / structural engine)
  groundData?: {
    pileCount: number;
    pileSpacingFt: number;
    pileEmbedmentFt: number;
    structureType: string;
    rowCount: number;
    panelsPerRow: number;
    arrayWidthFt: number;
    railsPerRow: number;
    groundClearanceFt: number;
  };
}

// ─── BOM Generation Result ────────────────────────────────────────────────────

export interface BOMGenerationResultV4 {
  items: BOMLineItemV4[];
  stages: BOMStageResult[];
  totalLineItems: number;
  totalCost?: number;
  generatedAt: string;
  topology: TopologyType;
  topologyLabel: string;
  derivationLog: BOMDerivationEntry[];
  warnings: string[];
  complianceNotes: string[];
  /** §5 closeout — machine-readable branch/feeder conductor reconciliation
   *  (per-segment conductor-by-conductor calc + per-gauge aggregation proof).
   *  Present only on the object-derived (runs-fed) path; the closer packages it
   *  as the B1/B2/B3 evidence artifact. */
  branchWireReconciliation?: BranchWireReconciliation;
  /** §6 closeout — the physical raceways the conduit BOM iterated (each row is
   *  labeled with its physicalRacewayId; no project-level "all runs" roll-up). */
  physicalRaceways?: DerivedRaceway[];
}

export interface BOMStageResult {
  id: BOMStageId;
  label: string;
  order: number;
  items: BOMLineItemV4[];
  itemCount: number;
}

export interface BOMDerivationEntry {
  stageId: BOMStageId;
  category: string;
  item: string;
  quantity: number;
  derivedFrom: string;
  formula: string;
  necReference?: string;
}

// ─── Standard OCPD Sizes ──────────────────────────────────────────────────────

// P0-5c: delegates to lib/electrical/stdSizes.ts — the old local copy stopped
// at 200 A and fell back to non-standard next-10A sizes above it.
function nextStandardBreaker(amps: number): number {
  return nextStandardOcpd(amps);
}

// ─── Wire Length with Fitting Allowance ──────────────────────────────────────

function conduitLength(wireLength: number, fittingAllowance = 1.15): number {
  return Math.ceil(wireLength * fittingAllowance);
}

// ─── Open-Air / Conduit-Less Run Detection ───────────────────────────────────
// Micro ROOF_RUN / BRANCH_RUN segments carry conduitType 'NONE' + isOpenAir
// (open-air PV wire / trunk cable per NEC 690.31 — no raceway until the roof
// junction box). These runs must produce NO conduit line item and must NOT
// feed the conduit-fitting counts: the Stowell hybrid CSV billed 58 ft of
// '"N/A" NONE Conduit' (SKU NONE-N-A, $43.50) off the 50-ft branch run.
// Wire line items from these runs still emit — the conductors are real.
function runHasNoConduit(r: RunSegment): boolean {
  if (r.isOpenAir === true) return true;
  const t = String(r.conduitType ?? '').trim().toUpperCase();
  return t === 'NONE' || t === 'N/A' || t === 'NA'
    || t === 'FREE AIR' || t === 'FREE_AIR' || t === 'OPEN AIR' || t === 'OPEN_AIR';
}

// ═══════════════════════════════════════════════════════════════════════════
// §5/§6/§7 CLOSEOUT (2026-07-23) — object-derived branch/raceway BOM
// The BOM no longer prices AC conductors from one flat `acWireLength` scalar nor
// rolls every conduit into one "— all runs" line. It iterates the canonical
// PHYSICAL RACEWAYS (CO-A: ComputedSystem.physicalRaceways / RunSegment
// .physicalRacewayId) and derives per-segment conductor footage with the
// shared-circuit-count semantics. Every emitted row carries its source segment
// IDs / physicalRacewayId, and every code citation comes from the raceway TYPE
// authority (racewayNecArticle) — never a hardcoded 'NEC 358'.
// ═══════════════════════════════════════════════════════════════════════════

const _WASTE = 1.15; // fitting/termination waste allowance (matches legacy)

/** One physical raceway derived from the run graph (the shared branch home-run
 *  appears ONCE with sharedCircuitCount>1 — its conduit is counted a single
 *  time even though it carries N branch circuits). */
interface DerivedRaceway {
  physicalRacewayId: string;
  racewayType: string;        // 'PVC Sch 80' | 'EMT' | …
  sizeIn: string;             // trade size, no inch mark ('1-1/4')
  necArticle: string;         // '352' | '358' | … (from raceway type)
  supportArticle: string;     // '352.30' | '358.30' | …
  sharedCircuitCount: number;
  lengthFt: number;           // Σ member run one-way lengths × waste (whole ft)
  segmentIds: string[];
}

/** Group in-conduit runs into their physical raceways. Open-air (Q-Cable /
 *  free-air) and utility-owned runs carry NO raceway and are skipped. Uses the
 *  run's attached PhysicalRaceway authority object where present (the declaring
 *  home-run carrier), else synthesizes the article from the raceway TYPE — the
 *  SAME single source computeSystem uses (racewayNecArticle). */
function derivePhysicalRacewaysFromRuns(runs: RunSegment[]): DerivedRaceway[] {
  const byId = new Map<string, DerivedRaceway>();
  const order: string[] = [];
  for (const r of runs) {
    if (r.isUtilityOwned || runHasNoConduit(r)) continue;
    const rid = r.physicalRacewayId ?? `RW-${r.id}`;
    const type = String(r.physicalRaceway?.racewayType ?? r.conduitType ?? 'EMT').trim();
    const art = r.physicalRaceway
      ? { article: r.physicalRaceway.necArticle, supportArticle: r.physicalRaceway.supportArticle }
      : racewayNecArticle(type);
    const size = String(r.physicalRaceway?.selectedRacewaySize ?? r.conduitSize ?? '3/4')
      .trim().replace(/"$/, '');
    const shared = r.physicalRaceway?.sharedCircuitCount ?? r.sharedCircuitCount ?? 1;
    const lenFt = Math.ceil((r.onewayLengthFt ?? 30) * _WASTE);
    const ex = byId.get(rid);
    if (ex) {
      ex.lengthFt += lenFt;
      if (!ex.segmentIds.includes(String(r.id))) ex.segmentIds.push(String(r.id));
      ex.sharedCircuitCount = Math.max(ex.sharedCircuitCount, shared);
    } else {
      byId.set(rid, {
        physicalRacewayId: rid, racewayType: type, sizeIn: size,
        necArticle: art.article, supportArticle: art.supportArticle,
        sharedCircuitCount: shared, lengthFt: lenFt, segmentIds: [String(r.id)],
      });
      order.push(rid);
    }
  }
  return order.map(id => byId.get(id)!);
}

/** §6/§7 — emit one physical raceway's conduit material + its matching fittings
 *  (couplings, connectors, straps/supports, bushings, bends, PVC expansion where
 *  applicable). Every row is labeled with the physicalRacewayId + source
 *  segments, and cites the raceway's OWN NEC article (never a template '358'). */
function emitRacewayConduitBom(rw: DerivedRaceway): BOMLineItemV4[] {
  const out: BOMLineItemV4[] = [];
  const { sizeIn: size, racewayType: type, lengthFt: ft } = rw;
  const typeTag = type.replace(/\s+/g, '-');
  const sizeTag = size.replace(/\//g, '-').replace(/"/g, '');
  const idTag = rw.physicalRacewayId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const src = rw.segmentIds.join(', ');
  const necConduit = `NEC ${rw.necArticle}`;
  const necSupport = `NEC ${rw.supportArticle}`;
  const sharedNote = rw.sharedCircuitCount > 1
    ? ` — shared home-run (${rw.sharedCircuitCount} branch circuits, conduit counted once)`
    : '';

  // Conduit material — per raceway (kills the project-level "all runs" roll-up)
  out.push(addItem('ac', 'conduit', 'Generic', `${size}" ${type} Conduit`,
    `${typeTag}-${sizeTag}-${idTag}`,
    `${size}" ${type} conduit — ${rw.physicalRacewayId} [${src}]${sharedNote}`,
    ft, 'ft', necConduit, `${rw.physicalRacewayId}: Σ segment length × ${_WASTE}`, `[${src}] × ${_WASTE}`, true));

  // Couplings — join 10-ft sticks
  const coupQty = Math.max(1, Math.ceil(ft / 10) - 1);
  out.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${size}" ${type} Coupling`,
    `${typeTag}-COUP-${sizeTag}-${idTag}`,
    `${size}" ${type} coupling — ${rw.physicalRacewayId} (joins conduit sticks)`,
    coupQty, 'ea', necSupport, `${rw.physicalRacewayId}: ceil(${ft}/10)-1`, `ceil(${ft}/10)-1`, true));

  // Terminal connectors — both raceway ends
  out.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${size}" ${type} Connector`,
    `${typeTag}-CONN-${sizeTag}-${idTag}`,
    `${size}" ${type} terminal connector — ${rw.physicalRacewayId} (both raceway ends per NEC 300.15)`,
    2, 'ea', 'NEC 300.15', `${rw.physicalRacewayId}: both terminations`, '2', true));

  // Straps / supports — ≤10 ft + within 3 ft of each box (raceway-type support rule)
  const strapQty = Math.max(2, Math.ceil(ft / 10) + 1);
  out.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${size}" ${type} One-Hole Strap`,
    `${typeTag}-STRAP-${sizeTag}-${idTag}`,
    `${size}" ${type} one-hole strap — ${rw.physicalRacewayId} support per ${necSupport} (≤10 ft + within 3 ft of boxes)`,
    strapQty, 'ea', necSupport, `${rw.physicalRacewayId}: ceil(${ft}/10)+1`, `ceil(${ft}/10)+1`, true));

  // Insulated throat bushings — both ends
  out.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${size}" Insulated Bushing`,
    `BUSH-INS-${sizeTag}-${idTag}`,
    `${size}" insulated throat bushing — ${rw.physicalRacewayId} (protects conductors at each raceway end per NEC 300.15)`,
    2, 'ea', 'NEC 300.15', `${rw.physicalRacewayId}: both terminations`, '2', true));

  // Bends / sweeps — rough-in allowance (exact count pending field routing)
  out.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${size}" ${type} 90° Sweep`,
    `${typeTag}-ELL-${sizeTag}-${idTag}`,
    `${size}" ${type} 90° sweep/elbow — ${rw.physicalRacewayId} (rough-in allowance; exact bend count pending field routing)`,
    2, 'ea', necSupport, `${rw.physicalRacewayId}: rough-in allowance`, '2', true));

  // PVC expansion fitting — NEC 352.44 thermal, applicable on longer exposed PVC runs
  if (/PVC/i.test(type) && ft >= 25) {
    out.push(addItem('ac', 'conduit_fitting', 'Carlon', `${size}" PVC Expansion Fitting`,
      `PVC-EXP-${sizeTag}-${idTag}`,
      `${size}" PVC expansion coupling — ${rw.physicalRacewayId} (NEC 352.44 thermal expansion, exposed run ≥ 25 ft)`,
      1, 'ea', 'NEC 352.44', `${rw.physicalRacewayId}: PVC exposed run ≥ 25 ft`, '1', true));
  }
  return out;
}

/** §5 — per-conductor calc row for the machine-readable reconciliation evidence. */
interface BranchWireCalcRow {
  segmentId: string;
  physicalRacewayId: string | null;
  gauge: string;
  egcGauge: string;
  conductorsPerCircuit: number;
  sharedCircuitCount: number;
  oneWayFt: number;
  hotConductors: number;   // conductorsPerCircuit × sharedCircuitCount
  hotFt: number;           // ceil(oneWayFt × hotConductors × waste)
  egcFt: number;           // ceil(oneWayFt × 1 × waste) — one shared EGC per raceway
}

interface BranchWireReconciliation {
  waste: number;
  segments: BranchWireCalcRow[];
  hotByGauge: { gauge: string; ft: number; segmentIds: string[] }[];
  egcByGauge: { gauge: string; ft: number; segmentIds: string[] }[];
  openAirTrunkSegments: string[]; // billed as trunk cable, NOT THWN
}

/** §5 — derive AC field-conductor quantities from the actual in-conduit route
 *  segments. Open-air Q-Cable trunk sections are EXCLUDED (billed as trunk
 *  cable). Hots = conductorsPerCircuit × sharedCircuitCount × length; the EGC is
 *  one shared conductor per raceway (NEC 250.122(C)). Hots and EGCs are kept as
 *  SEPARATE rows (green EGC ≠ black hot) so a #10 branch hot is never merged
 *  with a #10 feeder EGC into one undifferentiated "AC wiring" line. */
function emitAcConductorBom(runs: RunSegment[]): { items: BOMLineItemV4[]; evidence: BranchWireReconciliation } {
  const hotMap = new Map<string, { ft: number; segs: string[] }>();
  const egcMap = new Map<string, { ft: number; segs: string[] }>();
  const calc: BranchWireCalcRow[] = [];
  const openAir: string[] = [];

  for (const r of runs) {
    if (r.isUtilityOwned) continue;
    // Open-air AC sections (the Q-Cable trunk) are billed as trunk cable, never
    // THWN field conductor — record them so the reconciliation is auditable.
    if (runHasNoConduit(r)) { openAir.push(String(r.id)); continue; }
    const gauge = r.wireGauge ?? '#10 AWG';
    const egcGauge = r.egcGauge ?? '#10 AWG';
    const perCircuit = r.conductorCount ?? 2;
    const shared = r.sharedCircuitCount ?? r.physicalRaceway?.sharedCircuitCount ?? 1;
    const lenOneWay = r.onewayLengthFt ?? 30;
    const hotConductors = perCircuit * shared;
    const hotFt = Math.ceil(lenOneWay * hotConductors * _WASTE);
    const egcFt = Math.ceil(lenOneWay * 1 * _WASTE);
    const h = hotMap.get(gauge);
    if (h) { h.ft += hotFt; if (!h.segs.includes(String(r.id))) h.segs.push(String(r.id)); }
    else hotMap.set(gauge, { ft: hotFt, segs: [String(r.id)] });
    const e = egcMap.get(egcGauge);
    if (e) { e.ft += egcFt; if (!e.segs.includes(String(r.id))) e.segs.push(String(r.id)); }
    else egcMap.set(egcGauge, { ft: egcFt, segs: [String(r.id)] });
    calc.push({
      segmentId: String(r.id), physicalRacewayId: r.physicalRacewayId ?? null,
      gauge, egcGauge, conductorsPerCircuit: perCircuit, sharedCircuitCount: shared,
      oneWayFt: lenOneWay, hotConductors, hotFt, egcFt,
    });
  }

  const gaugeNum = (g: string) => parseInt(g.replace('#', '').replace(' AWG', '')) || 99;
  const items: BOMLineItemV4[] = [];
  for (const [gauge, { ft, segs }] of [...hotMap.entries()].sort((a, b) => gaugeNum(a[0]) - gaugeNum(b[0]))) {
    const gn = gauge.replace('#', '').replace(' AWG', '');
    items.push(addItem('ac', 'wire', 'Southwire', `${gauge} THWN-2`, `THWN2-${gn}`,
      `${gauge} THWN-2 — AC circuit conductors (${segs.join(', ')})`,
      ft, 'ft', 'NEC 310.15', `Σ length × conductorsPerCircuit × sharedCircuitCount × ${_WASTE}`, `[${segs.join(', ')}]`, true));
  }
  for (const [gauge, { ft, segs }] of [...egcMap.entries()].sort((a, b) => gaugeNum(a[0]) - gaugeNum(b[0]))) {
    const gn = gauge.replace('#', '').replace(' AWG', '');
    items.push(addItem('ac', 'wire', 'Southwire', `${gauge} THWN-2 Green EGC`, `THWN2-GRN-${gn}`,
      `${gauge} green THWN-2 equipment grounding conductor — one per raceway, NEC 250.122(C) (${segs.join(', ')})`,
      ft, 'ft', 'NEC 250.122', `Σ length × 1 × ${_WASTE} (one shared EGC per raceway)`, `[${segs.join(', ')}]`, true));
  }

  const evidence: BranchWireReconciliation = {
    waste: _WASTE,
    segments: calc,
    hotByGauge: [...hotMap.entries()].map(([gauge, v]) => ({ gauge, ft: v.ft, segmentIds: v.segs })),
    egcByGauge: [...egcMap.entries()].map(([gauge, v]) => ({ gauge, ft: v.ft, segmentIds: v.segs })),
    openAirTrunkSegments: openAir,
  };
  return { items, evidence };
}

// ─── ID Generator ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  return `bom-v4-${(++_idCounter).toString().padStart(4, '0')}`;
}

// ─── Stage Label Map ──────────────────────────────────────────────────────────

const STAGE_LABELS: Record<BOMStageId, string> = {
  array:      'Stage 1 — Array',
  dc:         'Stage 2 — DC',
  inverter:   'Stage 3 — Inverter / Storage / Combiner',
  ac:         'Stage 4 — AC',
  structural: 'Stage 5 — Structural',
  monitoring: 'Stage 6 — Monitoring',
  labels:     'Stage 7 — Labels',
  truck_stock: 'Truck Stock — Recommended Extras',
  tools:       'Suggested Tools — This Job',
};

const STAGE_ORDER: Record<BOMStageId, number> = {
  array: 1, dc: 2, inverter: 3, ac: 4, structural: 5, monitoring: 6, labels: 7,
  truck_stock: 8, tools: 9,
};

// Rail-less roof racking. RAY RULING (2026-07-11, Addendum A): RT-MINI is NOT
// rail-less — the flashed pad is the roof ATTACHMENT and a rail system rides
// on it via L-feet (IronRidge is Ray's default pairing). The set stays as the
// mechanism for genuine direct-attach systems; intentionally EMPTY until one
// is cataloged. (Module scope — shared by the legacy and per-sub paths.)
const RAIL_LESS_ROOF_RACKING = new Set<string>([]);
const RAIL_FORMULA_CATEGORIES = new Set(['rail', 'splice', 'mid_clamp', 'end_clamp', 'l_foot']);

/** Contract §1.4 fixed order — also the per-sub emission order. */
const SUB_SYSTEM_EMIT_ORDER: readonly SubSystemKey[] = ['roof', 'ground', 'fence'];

// ─── Shared racking-BOM emitter (legacy + per-sub Stage 5) ───────────────────
// Emits the structural engine's real rackingBOM lines. NB: rb.mounts is covered
// by the racking "lot"/attachment lines and rb.groundLugs is subsumed by the
// per-module bonding clips — both omitted to avoid double-counting.
function emitRackingBOMInto(
  items: BOMLineItemV4[],
  log: BOMDerivationEntry[],
  rb: RackingBOM,
  mfr: string,
  subSystem?: BOMSystemType,
): void {
  const emitRB = (category: string, r: { qty: number; unit?: string; description: string; partNumber: string } | undefined, nec: string) => {
    if (!r || r.qty <= 0) return;
    items.push(addItem('structural', category, mfr,
      r.description, r.partNumber ?? 'TBD', r.description,
      Math.ceil(r.qty), 'ea', nec, 'structuralEngine.rackingBOM', 'calcRackingBOM', true,
      undefined, undefined, undefined, subSystem));
    log.push({ stageId: 'structural', category, item: r.partNumber,
      quantity: Math.ceil(r.qty), derivedFrom: 'structuralEngine.rackingBOM',
      formula: 'calcRackingBOM', necReference: nec });
  };
  emitRB('rail', rb.rails, 'UL 2703');
  emitRB('splice', rb.railSplices, 'UL 2703');
  emitRB('l_foot', rb.lFeet, 'ASCE 7-22');
  emitRB('lag_bolt', rb.lagBolts, 'ASCE 7-22');
  emitRB('mount_hardware', rb.mountingBolts, 'UL 2703');
  emitRB('mid_clamp', rb.midClamps, 'UL 2703');
  emitRB('end_clamp', rb.endClamps, 'UL 2703');
  emitRB('flashing', rb.flashingKits, 'UL 2703');
  emitRB('grounding', rb.bondingClips, 'UL 2703');
}

// ─── Main BOM Generation Function ────────────────────────────────────────────

export function generateBOMV4(input: BOMGenerationInputV4): BOMGenerationResultV4 {
  // ── Wave 2c fork: hybrid (N>1 sub-systems) takes the per-sub path ──────────
  // Gate is N>1 MAP ENTRIES (contract §1.7 — never tag presence): absent map,
  // single-entry map, or missing subSystemCounts ⇒ the EXACT legacy code path
  // below (Invariant I-1 — Wave-0 goldens pin it byte-for-byte).
  {
    const _subMap = input.subSystemEquipment;
    const _present = _subMap
      ? SUB_SYSTEM_EMIT_ORDER.filter(k => !!_subMap[k])
      : [];
    if (_present.length > 1) {
      if (input.subSystemCounts) {
        return generateBOMV4PerSubSystem(input, _subMap!, _present);
      }
      console.warn('[BOM V4] subSystemEquipment has N>1 entries but subSystemCounts is missing — cannot apportion modules; falling back to the legacy single-system path.');
    }
  }
  console.log('[V4 RECEIVED]', {
    rackingId: input.rackingId,
    roofType: input.roofType,
    attachmentCount: input.attachmentCount,
    railSections: input.railSections,
    moduleCount: input.moduleCount,
    topologyType: input.topologyType,
  });
  _idCounter = 0;
  const items: BOMLineItemV4[] = [];
  const log: BOMDerivationEntry[] = [];
  const warnings: string[] = [];
  const complianceNotes: string[] = [];
  // §5/§6 closeout — machine-readable evidence (attached to the result below).
  let _branchWireReconciliation: BranchWireReconciliation | undefined;
  let _physicalRaceways: DerivedRaceway[] | undefined;

  // Resolve topology
  const topoCtx: TopologyManagerContext = {
    inverterId: input.inverterId,
    optimizerId: input.optimizerId,
    rackingId: input.rackingId,
    batteryId: input.batteryId,
    moduleCount: input.moduleCount,
    stringCount: input.stringCount,
    inverterCount: input.inverterCount,
    roofType: input.roofType,
  };
  const topoResult = resolveTopology(topoCtx);
  const topology = topoResult.topology;
  let norm = normalizeTopologyV4(topology);
  // ── W4a — the caller's DESIGN topologyType is AUTHORITY over the id-round-trip
  // resolver. resolveTopology() falls to STRING_INVERTER whenever
  // getRegistryEntryV4(inverterId) misses (topology-manager.ts:426-427); on a
  // PURE-MICRO design that silently flipped `isMicro` false and emitted phantom
  // "#10/#12 AWG USE-2 — DC roof wiring" rows + a DC disconnect for a DC string
  // circuit that PHYSICALLY DOES NOT EXIST (gate 6). When the design declares a
  // micro topology but the resolver returned a DC/string topology, honor the
  // design and record the resolver miss (never silent). ──
  if (input.topologyType) {
    const _declared = normalizeTopologyV4(input.topologyType);
    const _declaredMicro = _declared === 'MICROINVERTER' || _declared === 'AC_MODULE';
    const _resolvedMicro = norm === 'MICROINVERTER' || norm === 'AC_MODULE' || norm === 'AC_COUPLED_BATTERY';
    if (_declaredMicro && !_resolvedMicro) {
      warnings.push(`[V4 topology] resolver returned ${norm} but the design declares ${_declared}; honoring the design topology — NO DC string wiring/conduit/disconnect emitted (pure micro AC branch). Verify inverter registry id "${input.inverterId}".`);
      norm = _declared;
    }
  }

  // FIX v57.2: For microinverter topology, stringCount=0 (no DC strings).
  // Structural rail/clamp formulas use 'strings' as a proxy for "rows of modules".
  // Compute effectiveRows: use explicit rowCount if provided, else derive from
  // railSections (2 rails per row) or estimate ceil(modules / 4) as default.
  // This ensures rails, end-clamps, and mid-clamps produce correct non-zero quantities.
  const isMicroTopo = norm === 'MICROINVERTER' || norm === 'AC_MODULE';
  const effectiveRows: number = isMicroTopo && input.stringCount === 0
    ? (input.rowCount
        ?? (input.railSections > 0 ? Math.round(input.railSections / 2) : null)
        ?? Math.max(1, Math.ceil(input.moduleCount / 4)))
    : (input.stringCount > 0 ? input.stringCount : Math.max(1, Math.ceil(input.moduleCount / 4)));

  const formulaCtx = {
    modules: input.moduleCount,
    strings: effectiveRows,           // FIX v57.2: use effectiveRows, not raw stringCount
    inverters: input.inverterCount,
    branches: effectiveRows,          // branches = rows for micro (AC branch per row)
    railSections: input.railSections,
    attachments: input.attachmentCount,
    systemKw: input.systemKw,
  };

  // Get equipment entries
  const inverterEntry = getRegistryEntryV4(input.inverterId);
  // Same equipment-db fallback for the inverter when the V4 registry misses.
  const microDb = (!inverterEntry && input.inverterId) ? getMicroinverterById(input.inverterId) : undefined;
  const invDb = (!inverterEntry && !microDb && input.inverterId) ? getInverterById(input.inverterId) : undefined;
  const optimizerEntry = input.optimizerId ? getRegistryEntryV4(input.optimizerId) : undefined;
  const rackingEntry = input.rackingId ? getRegistryEntryV4(input.rackingId) : undefined;
  const batteryEntry = input.batteryId ? getRegistryEntryV4(input.batteryId) : undefined;
  const panelEntry = input.panelId ? getRegistryEntryV4(input.panelId) : undefined;
  // Fallback to the MAIN equipment catalog when the sparse V4 registry misses
  // (the design and the BOM registry use different id namespaces — e.g.
  // 'rec-alpha-pure-405' vs 'rec-alpha-pure-r-405' — which silently produced a
  // generic "specify model" panel). Resolve the REAL selected equipment so the
  // BOM shows the actual make/model instead of TBD.
  const panelDb = (!panelEntry && input.panelId) ? getPanelById(input.panelId) : undefined;

  // ── STAGE 1: ARRAY ──────────────────────────────────────────────────────────

  // Solar Panels
  if (panelEntry) {
    items.push(addItem('array', panelEntry.category, panelEntry.manufacturer, panelEntry.model,
      panelEntry.partNumber ?? panelEntry.id.toUpperCase(),
      `${panelEntry.electricalSpecs.watts ?? ''}W Solar Panel`,
      input.moduleCount, 'ea', 'NEC 690', 'moduleCount', 'modules', true));
    log.push({ stageId: 'array', category: 'solar_panel', item: 'Solar Panels',
      quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690' });
  } else if (panelDb) {
    items.push(addItem('array', 'solar_panel', panelDb.manufacturer, panelDb.model,
      (panelDb as { partNumber?: string }).partNumber ?? panelDb.id.toUpperCase(),
      `${panelDb.watts}W Solar Panel`,
      input.moduleCount, 'ea', 'NEC 690', 'moduleCount', 'modules (equipment-db)', true));
    log.push({ stageId: 'array', category: 'solar_panel', item: `${panelDb.manufacturer} ${panelDb.model}`,
      quantity: input.moduleCount, derivedFrom: 'equipment-db fallback', formula: 'modules', necReference: 'NEC 690' });
  } else {
    items.push(addItem('array', 'solar_panel', 'TBD', 'Solar Panel (specify model)',
      'PANEL-TBD', 'Solar Panel', input.moduleCount, 'ea', 'NEC 690', 'moduleCount', 'modules', true));
  }

  // Microinverters (if MICROINVERTER topology)
  // PHASE 1 FIX: use deviceCount (ceil(panels/modulesPerDevice)), NOT moduleCount
  if (norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY') {
    const microQty = input.deviceCount ?? input.moduleCount;
    if (inverterEntry) {
      items.push(addItem('array', 'microinverter', inverterEntry.manufacturer, inverterEntry.model,
        inverterEntry.partNumber ?? inverterEntry.id,
        `Microinverter — ${inverterEntry.electricalSpecs.acOutputKw ?? ''}kW AC output`,
        microQty, 'ea', 'NEC 690', 'deviceCount', 'ceil(panels/modulesPerDevice)', true));
      log.push({ stageId: 'array', category: 'microinverter', item: inverterEntry.model,
        quantity: microQty, derivedFrom: 'deviceCount', formula: 'ceil(panels/modulesPerDevice)', necReference: 'NEC 690' });
    } else if (microDb) {
      items.push(addItem('array', 'microinverter', microDb.manufacturer, microDb.model,
        (microDb as { partNumber?: string }).partNumber ?? microDb.id.toUpperCase(),
        `Microinverter — ${(microDb.acOutputW / 1000).toFixed(3)}kW AC output`,
        microQty, 'ea', 'NEC 690', 'deviceCount', 'equipment-db fallback', true));
      log.push({ stageId: 'array', category: 'microinverter', item: `${microDb.manufacturer} ${microDb.model}`,
        quantity: microQty, derivedFrom: 'equipment-db fallback', formula: 'ceil(panels/modulesPerDevice)', necReference: 'NEC 690' });
    }
  }

  // Optimizers (if STRING_WITH_OPTIMIZER or HYBRID or DC_COUPLED)
  // v58.7 FIX: Guard against string_inverter being passed as optimizerId.
  // When inverterId='se-11400h' is mistakenly sent as optimizerId (legacy/no-peripheral config),
  // getRegistryEntryV4('se-11400h') returns category='string_inverter' — NOT an optimizer.
  // Using it in Stage 1 shows SE11400H×36 as if it were an optimizer peripheral (WRONG).
  // Fix: only use optimizerEntry if category === 'optimizer'.
  // Fallback: use default optimizer from inverterEntry.requiredAccessories.
  const safeOptimizerEntry = (() => {
    // Case 1: Valid optimizer peripheral passed explicitly — use it
    if (optimizerEntry && optimizerEntry.category === 'optimizer') return optimizerEntry;
    // Case 2: optimizerEntry is wrong category (e.g. string_inverter ID passed as optimizerId)
    // OR no optimizerId sent — look up default optimizer from inverter's requiredAccessories
    if (inverterEntry && (norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY')) {
      const defaultOptimizerAcc = inverterEntry.requiredAccessories.find((a: any) => a.category === 'optimizer');
      if (defaultOptimizerAcc) {
        // Find optimizer in registry by matching manufacturer + part number
        const found = EQUIPMENT_REGISTRY_V4.find((e: any) =>
          e.category === 'optimizer' &&
          e.manufacturer === defaultOptimizerAcc.defaultManufacturer &&
          (e.partNumber === defaultOptimizerAcc.defaultPartNumber || e.model?.includes(defaultOptimizerAcc.defaultModel?.split(' ')[0] ?? ''))
        );
        if (found) {
          console.warn('[BOM V4] safeOptimizerEntry fallback to inverter default:', found.id,
            optimizerEntry ? '(optimizerId was wrong category: ' + optimizerEntry.category + ')' : '(no optimizerId sent)');
          return found;
        }
      }
    }
    return undefined;
  })();
  if ((norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY') && safeOptimizerEntry) {
    items.push(addItem('array', 'optimizer', safeOptimizerEntry.manufacturer, safeOptimizerEntry.model,
      safeOptimizerEntry.partNumber ?? safeOptimizerEntry.id,
      `DC Power Optimizer — 1 per module`,
      input.moduleCount, 'ea', 'NEC 690.8', 'moduleCount', 'modules', true));
    log.push({ stageId: 'array', category: 'optimizer', item: safeOptimizerEntry.model,
      quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690.8' });
  }

  // ── STAGE 2: DC ─────────────────────────────────────────────────────────────

  const isMicro = norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY';

  if (isMicro) {
    // ── AC trunk/bus cable — BRAND-AGNOSTIC resolver (lib/equipment/trunkCable) ──
    // Real install logic: the trunk is CONTINUOUS PER BRANCH CIRCUIT (branches
    // are separate runs — all panels are NOT wired together). Row transitions
    // use the continuous cable + service loop + sealing cap (cheapest option);
    // field-wireable M+F splices only where forced (sub-array/plane bridges) or
    // when the installer opts to cut at rows. Devices/branch, SKUs (portrait vs
    // landscape trunk where the brand has them), and connector hardware all come
    // from the brand catalog (Enphase Q-Cable, APsystems AC Bus, …).
    const trunkDeviceCount = input.deviceCount ?? input.moduleCount;
    const microBrand = inverterEntry?.manufacturer ?? microDb?.manufacturer ?? 'Enphase';
    const microModel = inverterEntry?.model ?? microDb?.model;
    // §13 — the AC-branch COUNT that governs terminator/cap quantities is the
    // ACTUAL branch-cable topology (the plane-aware planMicroBranches result the
    // snapshot carries as electrical.branches), NOT the resolver's flat
    // ceil(devices / perModelMax) heuristic which yielded branches+1 on Braidon
    // (3 real branches → 4 terminators). Absent ⇒ resolver heuristic (unchanged).
    const branchCountOverride = (typeof input.branchCount === 'number' && input.branchCount > 0)
      ? input.branchCount : undefined;
    const plan = resolveTrunkCablePlan({
      brand: microBrand,
      model: microModel,
      deviceCount: trunkDeviceCount,
      orientation: input.layoutOrientation === 'landscape' ? 'landscape' : 'portrait',
      rowCount: input.rowCount,
      // Real design geometry: distinct sub-arrays/planes force bridge splices.
      subArrayCount: input.subArrayCount,
      // Installer preference: cut at rows instead of service-looping.
      spliceAtRows: input.spliceAtRows,
      // Canonical AC-branch count (terminators/caps derive from THIS).
      branchCountOverride,
    });

    if (plan) {
      const { system, cable } = plan;
      const orientLabel = cable.orientation === 'fixed' ? '' : ` (${cable.orientation})`;
      // §13 — Enphase Q-Cable / AC trunk is AC BRANCH-CIRCUIT equipment (240 V AC
      // output of each microinverter), NOT DC. It files under Stage 4 — AC. The
      // terminator/sealing-cap COUNT derives from the ACTUAL AC-branch topology
      // (branchCount below), never a branches+1 heuristic.
      items.push(addItem('ac', 'trunk_cable', system.brand, `${system.ecosystem}${orientLabel}`,
        cable.sku, `AC trunk — 1 drop per micro @ ${cable.connectorSpacingFt} ft pitch (≈${plan.approxFeet} ft), continuous per branch × ${plan.branchCount}`,
        plan.dropCount, 'ea', 'NEC 690.31', 'one connector-drop per device', `${trunkDeviceCount} drops`, true));
      log.push({ stageId: 'ac', category: 'trunk_cable', item: `${system.ecosystem}${orientLabel}`,
        quantity: plan.dropCount, derivedFrom: 'trunkCable resolver (drops)', formula: `${trunkDeviceCount} drops ≈ ${plan.approxFeet} ft`, necReference: 'NEC 690.31' });

      if (plan.splicePairs > 0) {
        items.push(addItem('ac', 'connector', system.brand, system.connectors.male.description,
          system.connectors.male.sku, `${system.connectors.male.description} — trunk jump (${plan.spliceBasis})`,
          plan.splicePairs, 'ea', 'NEC 690.31', plan.spliceBasis, `${plan.splicePairs}`, false));
        items.push(addItem('ac', 'connector', system.brand, system.connectors.female.description,
          system.connectors.female.sku, `${system.connectors.female.description} — trunk jump (${plan.spliceBasis})`,
          plan.splicePairs, 'ea', 'NEC 690.31', plan.spliceBasis, `${plan.splicePairs}`, false));
        log.push({ stageId: 'ac', category: 'connector', item: 'Field-wireable splice (M/F pair)',
          quantity: plan.splicePairs, derivedFrom: plan.spliceBasis, formula: `${plan.splicePairs}`, necReference: 'NEC 690.31' });
      }

      items.push(addItem('ac', 'terminator', system.brand, system.connectors.terminator.description,
        system.connectors.terminator.sku, `${system.connectors.terminator.description} — 1 per AC branch end`,
        plan.terminators, 'ea', 'NEC 690.31', '1 per AC branch', `${plan.branchCount} branches`, true));
      log.push({ stageId: 'ac', category: 'terminator', item: system.connectors.terminator.description,
        quantity: plan.terminators, derivedFrom: '1 per AC branch', formula: `${plan.branchCount}`, necReference: 'NEC 690.31' });

      if (system.connectors.sealingCap) {
        items.push(addItem('ac', 'sealing_cap', system.brand, system.connectors.sealingCap.description,
          system.connectors.sealingCap.sku, `${system.connectors.sealingCap.description} — service-loop unused drops (1 per AC branch)`,
          plan.sealingCaps, 'ea', 'NEC 690.31', '1 per AC branch', `${plan.branchCount}`, false));
      }
    } else {
      // Unknown micro brand — generic AC trunk line so the wire never silently vanishes.
      const genericSections = branchCountOverride ?? Math.ceil(trunkDeviceCount / 13);
      items.push(addItem('ac', 'trunk_cable', microBrand, 'AC Trunk Cable (brand TBD)',
        'TRUNK-TBD', `AC trunk cable — 1 drop per micro (${trunkDeviceCount} devices, brand not in trunk catalog)`,
        trunkDeviceCount, 'ea', 'NEC 690.31', 'one drop per device', `${trunkDeviceCount}`, true));
      items.push(addItem('ac', 'terminator', microBrand, 'Trunk Terminator (brand TBD)',
        'TERM-TBD', 'Trunk terminator — 1 per AC branch end', genericSections, 'ea', 'NEC 690.31', '1 per AC branch', `${genericSections}`, true));
      log.push({ stageId: 'ac', category: 'trunk_cable', item: 'AC Trunk (brand TBD)',
        quantity: trunkDeviceCount, derivedFrom: 'generic fallback (brand not in trunkCable catalog)', formula: `${trunkDeviceCount}`, necReference: 'NEC 690.31' });
    }

  } else {
    // DC Wire (string inverter topology) — defensive defaults for all wire/conduit fields
    const resolvedDcWireGauge   = input.dcWireGauge   ?? '#10 AWG';
    const resolvedDcWireLength  = input.dcWireLength  ?? 50;
    const resolvedConduitType   = input.conduitType   ?? 'EMT';
    const resolvedDcConduitSize = input.conduitSizeInch ?? '3/4';
    const dcWireQty = conduitLength(resolvedDcWireLength * 2); // 2 conductors (+ and -)
    items.push(addItem('dc', 'wire', 'Southwire', `${resolvedDcWireGauge} USE-2 PV Wire`,
      `USE2-${resolvedDcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${resolvedDcWireGauge} USE-2 PV Wire — DC home run`,
      dcWireQty, 'ft', 'NEC 690.31', 'dcWireLength × 2 × 1.15', `${resolvedDcWireLength} × 2 × 1.15`, true));
    log.push({ stageId: 'dc', category: 'wire', item: `${resolvedDcWireGauge} USE-2`,
      quantity: dcWireQty, derivedFrom: 'dcWireLength × 2 conductors × 1.15 fitting', formula: 'dcWireLength * 2 * 1.15', necReference: 'NEC 690.31' });

    // DC Conduit. For ground/fence the buried array→service portion (trench) uses
    // underground-rated PVC Sch 40 (NEC 300.5, min 18" burial); the above-ground
    // portion uses the standard conduit type. trenchRunLengthFt is a subset of
    // resolvedDcWireLength (the page already folded it into the DC home run).
    const _trenchFt      = Math.max(0, Math.min(input.trenchRunLengthFt ?? 0, resolvedDcWireLength));
    const _aboveGroundDc = Math.max(0, resolvedDcWireLength - _trenchFt);
    if (_aboveGroundDc > 0) {
      const dcConduitQty = conduitLength(_aboveGroundDc);
      items.push(addItem('dc', 'conduit', 'Generic', `${resolvedDcConduitSize}" ${resolvedConduitType} Conduit`,
        `${resolvedConduitType}-${resolvedDcConduitSize.replace('/', '-')}`,
        `${resolvedDcConduitSize}" ${resolvedConduitType} conduit — DC home run`,
        dcConduitQty, 'ft', 'NEC 690.31', 'dcWireLength × 1.15', `${_aboveGroundDc} × 1.15`, true));
    }
    if (_trenchFt > 0) {
      const pvcQty = conduitLength(_trenchFt);
      items.push(addItem('dc', 'conduit', 'Cantex', `${resolvedDcConduitSize}" PVC Sch 40 — Underground`,
        `PVC40-${resolvedDcConduitSize.replace('/', '-')}`,
        `${resolvedDcConduitSize}" PVC Sch 40 underground conduit — buried DC trench run (NEC 300.5, min 18" burial)`,
        pvcQty, 'ft', 'NEC 300.5', 'trenchRunLengthFt × 1.15', `${_trenchFt} × 1.15`, true));
    }

    // DC Disconnect
    if (input.requiresDCDisconnect !== false) {
      // DC disconnect: part number derived from dcOCPD (e.g. DU30RB = 30A, DU60RB = 60A)
      const dcDiscAmps = nextStandardBreaker(input.dcOCPD > 0 ? input.dcOCPD : 30);
      const dcDiscPartNum = `DU${dcDiscAmps}RB`;
      items.push(addItem('dc', 'disconnect', 'Square D', `${dcDiscAmps}A DC Disconnect`,
        dcDiscPartNum, `${dcDiscAmps}A DC disconnect switch per NEC 690.15`,
        input.inverterCount, 'ea', 'NEC 690.15', 'inverterCount', 'inverters', true));
      log.push({ stageId: 'dc', category: 'dc_disconnect', item: `${dcDiscAmps}A DC Disconnect`,
        quantity: input.inverterCount, derivedFrom: 'inverterCount', formula: 'inverters', necReference: 'NEC 690.15' });
    }

    // Rapid Shutdown (string inverter without integrated RSD)
    // NEC 690.12 applies to PV circuits ON or IN buildings. A free-standing
    // ground-mount or fence array is not on a building, so module-level rapid
    // shutdown is NOT required (NEC 690.12(B)(2)). Don't force per-module RSD there.
    const rsdIntegrated = inverterEntry?.electricalSpecs?.rapidShutdownCompliant ?? false;
    const isOptimizer = norm === 'STRING_WITH_OPTIMIZER';
    // NEC 690.12 is a MOUNT-LOCATION rule, not a project-tag rule: the roof
    // subset of a hybrid needs module-level RSD even when the project's winning
    // systemType is fence/ground (the old project-wide exemption skipped RSD for
    // Stowell's ON-ROOF panels — a code violation).
    const _roofModules = input.subSystemCounts
      ? input.subSystemCounts.roof
      : (input.systemType === 'ground' || input.systemType === 'fence' ? 0 : input.moduleCount);
    const _offBuildingModules = input.moduleCount - _roofModules;
    const _rsdExemptMount = _roofModules <= 0;
    if (input.requiresRapidShutdown !== false && !rsdIntegrated && !isOptimizer && !_rsdExemptMount) {
      items.push(addItem('dc', 'rapid_shutdown', 'Tigo', 'TS4-A-F Rapid Shutdown',
        'TS4-A-F', 'Rapid shutdown device per NEC 690.12 — 1 per ON-BUILDING module',
        _roofModules, 'ea', 'NEC 690.12', 'roof-mounted modules', `${_roofModules} on-building`, true));
      log.push({ stageId: 'dc', category: 'rapid_shutdown', item: 'TS4-A-F',
        quantity: _roofModules, derivedFrom: 'roof-mounted modules', formula: `${_roofModules} on-building`, necReference: 'NEC 690.12' });
      complianceNotes.push(`NEC 690.12: Rapid shutdown devices added — 1 per on-building module (${_roofModules})`);
      if (_offBuildingModules > 0) {
        complianceNotes.push(`NEC 690.12(B)(2): ${_offBuildingModules} ground/fence module(s) exempt — not on/in a building`);
      }
    } else if (_rsdExemptMount) {
      complianceNotes.push(`NEC 690.12(B)(2): module-level rapid shutdown not required — ${input.systemType} array is not on/in a building`);
    } else if (rsdIntegrated || isOptimizer) {
      complianceNotes.push(`NEC 690.12: Rapid shutdown integrated in ${isOptimizer ? 'optimizers' : inverterEntry?.model ?? 'inverter'}`);
    }
  }

  // ── STAGE 3: INVERTER ────────────────────────────────────────────────────────

  if (!isMicro && inverterEntry) {
    items.push(addItem('inverter', inverterEntry.category, inverterEntry.manufacturer, inverterEntry.model,
      inverterEntry.partNumber ?? inverterEntry.id,
      `${inverterEntry.electricalSpecs.acOutputKw ?? ''}kW ${inverterEntry.category === 'string_inverter' ? 'String Inverter' : 'Inverter'}`,
      input.inverterCount, 'ea', 'NEC 690', 'inverterCount', 'inverters', true));
    log.push({ stageId: 'inverter', category: inverterEntry.category, item: inverterEntry.model,
      quantity: input.inverterCount, derivedFrom: 'inverterCount', formula: 'inverters', necReference: 'NEC 690' });
  } else if (!isMicro && invDb) {
    items.push(addItem('inverter', 'string_inverter', invDb.manufacturer, invDb.model,
      (invDb as { partNumber?: string }).partNumber ?? invDb.id.toUpperCase(),
      `${invDb.acOutputKw ?? ''}kW String Inverter`,
      input.inverterCount, 'ea', 'NEC 690', 'inverterCount', 'equipment-db fallback', true));
    log.push({ stageId: 'inverter', category: 'string_inverter', item: `${invDb.manufacturer} ${invDb.model}`,
      quantity: input.inverterCount, derivedFrom: 'equipment-db fallback', formula: 'inverters', necReference: 'NEC 690' });
  }

  // Battery
  if (batteryEntry) {
    const batQty = input.batteryCount && input.batteryCount > 1 ? input.batteryCount : 1;
    items.push(addItem('inverter', 'battery', batteryEntry.manufacturer, batteryEntry.model,
      batteryEntry.partNumber ?? batteryEntry.id,
      `Battery Storage System — ${batteryEntry.electricalSpecs.acOutputKw ?? ''}kW`,
      batQty, 'ea', 'NEC 706', 'batteryCount', String(batQty), true));
    log.push({ stageId: 'inverter', category: 'battery', item: batteryEntry.model,
      quantity: batQty, derivedFrom: 'batteryCount', formula: String(batQty), necReference: 'NEC 706' });
  }

  // Generator — add to BOM if configured (NEC 702 Optional Standby Systems)
  if (input.generatorId) {
    const gen = getGeneratorById(input.generatorId);
    if (gen) {
      items.push(addItem('inverter', 'generator', gen.manufacturer, gen.model,
        input.generatorId.toUpperCase(),
        `Standby Generator — ${gen.ratedOutputKw}kW / ${gen.fuelType.replace('_', ' ')} / ${gen.outputBreakerA}A output breaker`,
        1, 'ea', 'NEC 702', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'generator', item: gen.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 702' });
    }
  } else if (input.generatorKw && input.generatorKw > 0) {
    // Fallback: no ID but kW provided
    items.push(addItem('inverter', 'generator', 'TBD', `${input.generatorKw}kW Standby Generator`,
      'GEN-TBD',
      `Standby Generator — ${input.generatorKw}kW — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702', 'perSystem', '1', true));
  }

  // ATS — add to BOM if configured (NEC 702.5 Transfer Equipment)
  if (input.atsId) {
    const ats = getATSById(input.atsId);
    if (ats) {
      items.push(addItem('inverter', 'ats', ats.manufacturer, ats.model,
        input.atsId.toUpperCase(),
        `Automatic Transfer Switch — ${ats.ampRating}A / ${ats.voltageV}V${ats.serviceEntranceRated ? ' — Service Entrance Rated' : ''}`,
        1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'ats', item: ats.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 702.5' });
    }
  } else if (input.atsAmpRating && input.atsAmpRating > 0) {
    // Fallback: no ID but amp rating provided
    items.push(addItem('inverter', 'ats', 'TBD', `${input.atsAmpRating}A Automatic Transfer Switch`,
      'ATS-TBD',
      `Automatic Transfer Switch — ${input.atsAmpRating}A — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
  }

  // Backup Interface Unit (BUI) — add to BOM if configured (NEC 706 / NEC 230.82)
  if (input.backupInterfaceId) {
    const bui = getBackupInterfaceById(input.backupInterfaceId);
    if (bui) {
      const isIQSC3 = bui.model?.toLowerCase().includes('sc3') || bui.model?.toLowerCase().includes('system controller 3');
      items.push(addItem('inverter', 'backup_interface', bui.manufacturer, bui.model,
        input.backupInterfaceId.toUpperCase(),
        `Backup Interface Unit${isIQSC3 ? ' / ATS (Service Entrance Rated)' : ''} — ${bui.maxContinuousOutputA}A / 240V`,
        1, 'ea', isIQSC3 ? 'NEC 706 / NEC 230.82' : 'NEC 706', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'backup_interface', item: bui.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 706' });
    }
  } else if (input.backupInterfaceMaxA && input.backupInterfaceMaxA > 0) {
    // Fallback: no ID but max amps provided
    items.push(addItem('inverter', 'backup_interface', 'TBD', `${input.backupInterfaceMaxA}A Backup Interface Unit`,
      'BUI-TBD',
      `Backup Interface Unit — ${input.backupInterfaceMaxA}A / 240V — NEC 706`,
      1, 'ea', 'NEC 706', 'perSystem', '1', true));
  }

  // Generator whip wire — driven by generatorWireLength (distance gen → ATS).
  // Gauge pulled from the canonical generator's outputWireGaugeMin in equipment-db;
  // quantity uses the same 15% fitting allowance as conduit runs elsewhere.
  if (input.generatorId && input.generatorWireLength && input.generatorWireLength > 0) {
    const gen = getGeneratorById(input.generatorId);
    const gauge = gen?.outputWireGaugeMin ?? '#6 AWG';
    const ft = Math.ceil(input.generatorWireLength * 1.15);
    const unitCost = 1.85; // ballpark THWN-2 copper per-ft; align with distributor at next price refresh
    items.push(addItem(
      'inverter',
      'wire',
      'Generic',
      gauge,
      `WHIP-${gauge.replace(/\s|#/g, '')}`,
      `Generator-to-ATS whip cable, ${gauge} THWN-2`,
      ft,
      'ft',
      'NEC 702.4, NEC 215',
      `config.generatorWireLength = ${input.generatorWireLength} ft × 1.15 fitting allowance`,
      `${input.generatorWireLength} ft × 1.15 = ${ft} ft`,
      true,
      undefined,
      unitCost,
      ft * unitCost,
    ));
    log.push({ stageId: 'inverter', category: 'wire', item: `Generator whip ${gauge}`,
      quantity: ft, derivedFrom: 'generatorWireLength', formula: `${input.generatorWireLength} × 1.15`, necReference: 'NEC 702.4, NEC 215' });
  }

  // Brand-integrated combiner/gateway ("the brains") — single-sourced from
  // lib/equipment/integratedBos so the BOM matches the SLD + permit sheets and
  // gets the real SKU (the registry accessory strings had a fabricated 4C and
  // no combiner at all for IQ8H/IQ8A/IQ8AC). Falls back to the legacy
  // requiredAccessories for non-integrated ecosystems (e.g. SolarEdge gateway).
  const _bosPlan = resolveIntegratedEquipment({
    inverterManufacturer: inverterEntry?.manufacturer ?? '',
    inverterModel: inverterEntry?.model ?? '',
    isMicro,
    totalDevices: isMicro ? (input.deviceCount ?? input.moduleCount ?? 0) : 0,
    branchCount: 0,
    hasBattery: !!input.batteryId || (input.batteryCount ?? 0) > 0,
  });
  const _bosEmitted = new Set<string>();
  // An integrated combiner (e.g. IQ Combiner 6C) HOUSES the gateway — don't also
  // emit a separate standalone gateway line (double-count).
  if (_bosPlan.hasIntegratedGateway) _bosEmitted.add('gateway');
  for (const d of _bosPlan.devices) {
    const cat = d.kind === 'gateway' ? 'gateway' : 'combiner';
    _bosEmitted.add(cat);
    items.push(addItem(cat === 'gateway' ? 'monitoring' : 'inverter', cat, d.brand, d.model,
      d.partNumber ?? '—', `Integrated ${d.roleSummary}`, 1, 'ea',
      (d.necRefs && d.necRefs[0]) ?? 'NEC 690.4', 'integrated-bos', '1', true));
    log.push({ stageId: cat === 'gateway' ? 'monitoring' : 'inverter', category: cat, item: d.model,
      quantity: 1, derivedFrom: 'integrated-bos resolver', formula: '1', necReference: (d.necRefs && d.necRefs[0]) });
  }

  // Gateway (optimizer or microinverter topology)
  const needsGateway = norm === 'STRING_WITH_OPTIMIZER' || norm === 'MICROINVERTER' ||
    norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY' || norm === 'AC_COUPLED_BATTERY';
  if (needsGateway && !_bosEmitted.has('gateway')) {
    // Find gateway from inverter accessories
    const gatewayAcc = inverterEntry?.requiredAccessories.find(a => a.category === 'gateway');
    if (gatewayAcc) {
      items.push(addItem('monitoring', 'gateway', gatewayAcc.defaultManufacturer ?? 'TBD',
        gatewayAcc.defaultModel ?? 'Gateway', gatewayAcc.defaultPartNumber ?? 'GW-TBD',
        'Communication/monitoring gateway', 1, 'ea', gatewayAcc.necReference ?? 'NEC 690.4',
        'perSystem', '1', true));
      log.push({ stageId: 'monitoring', category: 'gateway', item: gatewayAcc.defaultModel ?? 'Gateway',
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: gatewayAcc.necReference });
    }
  }

  // Combiner (microinverter topology) — only when no integrated BOS combiner
  // (e.g. Enphase IQ Combiner) already covers the branch aggregation.
  if (isMicro && !_bosEmitted.has('combiner')) {
    const combinerAcc = inverterEntry?.requiredAccessories.find(a => a.category === 'combiner');
    if (combinerAcc) {
      items.push(addItem('inverter', 'combiner', combinerAcc.defaultManufacturer ?? 'TBD',
        combinerAcc.defaultModel ?? 'AC Combiner', combinerAcc.defaultPartNumber ?? 'COMB-TBD',
        'AC branch combiner — aggregates branch circuits', 1, 'ea',
        combinerAcc.necReference ?? 'NEC 690.4', 'perSystem', '1', true));
    }
  }

  // Rooftop junction / transition box (microinverter topology) — INDEPENDENT of
  // the combiner. The AC trunk runs open-air across the array then transitions to
  // conduit at a roof-flashed junction box before entering the building; this is
  // required whether the branches aggregate at a separate AC combiner OR at an
  // integrated BOS device (IQ Combiner) mounted downstream near the service.
  // (Bug: this was nested under `!_bosEmitted.has('combiner')`, so every Enphase
  // system with an IQ Combiner emitted NO rooftop transition box.)
  if (isMicro) {
    // Derive from run segments ending at a rooftop junction/transition, else
    // fall back to ~1 box per AC trunk (16 devices).
    let junctionBoxQty = 0;
    if (input.runs && input.runs.length > 0) {
      junctionBoxQty = input.runs.filter(r =>
        r.to === 'JUNCTION BOX' || r.to === 'AC COMBINER' || r.to === 'COMBINER'
      ).length;
    }
    if (junctionBoxQty === 0) {
      junctionBoxQty = Math.ceil((input.deviceCount ?? input.moduleCount) / 16);
    }
    if (junctionBoxQty > 0) {
      items.push(addItem('ac', 'junction_box', 'Soladeck', 'PV Junction Box',
        '0786-41', 'Roof-flashed PV junction box — transitions open-air PV wire to conduit',
        junctionBoxQty, 'ea', 'NEC 690.31', 'runSegments.to=JUNCTION BOX', 'ceil(deviceCount/16)', true));
      log.push({ stageId: 'ac', category: 'junction_box', item: 'PV Junction Box',
        quantity: junctionBoxQty, derivedFrom: 'runSegments', formula: 'segments ending at JUNCTION BOX', necReference: 'NEC 690.31' });
      complianceNotes.push(`NEC 690.31: ${junctionBoxQty} junction box(es) — transitions open-air PV wire to conduit`);
    }
  }

  // ── STAGE 4: AC ──────────────────────────────────────────────────────────────

  // Wire & Conduit — use ComputedSystem.runs as single source of truth
  // Generate ONE line item per wire gauge and ONE per conduit type/size
  // This ensures BOM line items match the summary card quantities (wire10AWG, wire8AWG, etc.)

  if (input.runs && input.runs.length > 0) {
    // ── All customer-owned runs (exclude utility-owned service conductors) ──
    // Error 7b fix: RunSegment already declares wireGauge, egcGauge, conductorCount,
    // onewayLengthFt, conduitType, conduitSize, isUtilityOwned, id — no `as any` needed.
    const allBomRuns = input.runs.filter(r => !r.isUtilityOwned);

    // ── DC wire runs (ROOF_RUN for micro, DC_STRING_RUN / DC_DISCO_TO_INV_RUN for string) ──
    // For string topology, DC wire is already added in Stage 2 (USE-2 PV wire).
    // For micro topology, ROOF_RUN is open-air DC wiring — add as separate BOM line item.
    const dcRunIds = new Set(['ROOF_RUN', 'DC_STRING_RUN', 'DC_DISCO_TO_INV_RUN']);
    const dcBomRuns = allBomRuns.filter(r => dcRunIds.has(r.id));
    const acBomRuns = allBomRuns.filter(r => !dcRunIds.has(r.id));
    // ── W4a — on a PURE micro the module→micro DC connection (ROOF_RUN) is the
    // module's FACTORY leads / MC4 connectors, NOT installer-run USE-2 DC roof
    // wiring. Emitting ROOF_RUN as bulk "#10/#12 USE-2 — DC roof wiring" invented
    // a field-run DC home run for a circuit that ships integral to the module
    // (gate 6: no DC string materials in pure micro topology without a real DC
    // string segment). Exclude ROOF_RUN from the micro DC-wire rows; a genuine DC
    // string segment (DC_STRING_RUN / DC_DISCO_TO_INV_RUN — string/optimizer only)
    // is unaffected. ──
    const MICRO_FACTORY_LEAD_IDS = new Set(['ROOF_RUN']);
    const dcFieldRuns = isMicro ? dcBomRuns.filter(r => !MICRO_FACTORY_LEAD_IDS.has(r.id)) : dcBomRuns;
    if (isMicro && dcBomRuns.length > 0 && dcFieldRuns.length === 0) {
      complianceNotes.push('Module-to-microinverter DC connection uses the module’s factory-integrated leads/MC4 connectors (NEC 690.31) — no separately-run DC roof conductor; the field wiring is the AC branch (Q-Cable trunk).');
    }

    // ── Group DC runs by wire gauge → one line item per gauge (micro only, matches calcBOMFromSegments) ──
    // Key insight: EGC can be a DIFFERENT gauge than DC conductors
    if (isMicro && dcFieldRuns.length > 0) {
      const dcGaugeMap = new Map<string, { qty: number; runIds: string[] }>();

      for (const r of dcFieldRuns) {
        const gauge: string = r.wireGauge ?? '#10 AWG';
        const egcGauge: string = r.egcGauge ?? '#10 AWG';
        const conductors: number = r.conductorCount ?? 2;
        const length: number = r.onewayLengthFt ?? 30;
        
        // Add DC conductor quantity (gauge = wireGauge)
        const dcQty = Math.ceil(length * conductors * 1.15);
        const dcExisting = dcGaugeMap.get(gauge);
        if (dcExisting) {
          dcExisting.qty += dcQty;
          dcExisting.runIds.push(r.id);
        } else {
          dcGaugeMap.set(gauge, { qty: dcQty, runIds: [r.id] });
        }
        
        // Add EGC quantity (gauge = egcGauge, may differ from wireGauge)
        const egcQty = Math.ceil(length * 1 * 1.15);
        const egcExisting = dcGaugeMap.get(egcGauge);
        if (egcExisting) {
          egcExisting.qty += egcQty;
          if (!egcExisting.runIds.includes(r.id)) {
            egcExisting.runIds.push(r.id);
          }
        } else {
          dcGaugeMap.set(egcGauge, { qty: egcQty, runIds: [r.id] });
        }
      }
      
      for (const [gauge, { qty, runIds }] of dcGaugeMap.entries()) {
        const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
        items.push(addItem('dc', 'wire', 'Southwire', `${gauge} USE-2/THWN-2`,
          `USE2-${gaugeNum}`,
          `${gauge} USE-2 — DC roof wiring (open-air, panels to microinverters)`,
          qty, 'ft', 'NEC 690.31',
          'Sum(length x conductors x 1.15)',
          `${gauge} DC runs x 1.15`, true));
        log.push({ stageId: 'dc', category: 'wire', item: `${gauge} USE-2`,
          quantity: qty, derivedFrom: runIds.join(', '),
          formula: 'Sum(length x conductors x 1.15)', necReference: 'NEC 690.31' });
      }
    }

    // ── §5 — AC circuit conductors from the ACTUAL route segments ────────────
    // Open-air Q-Cable trunk sections are excluded (billed as trunk cable); hots
    // scale by conductorsPerCircuit × sharedCircuitCount (the shared home-run
    // carries N branches in ONE raceway); the shared EGC is one per raceway.
    // Hots and EGCs stay SEPARATE rows — no undifferentiated "AC wiring" merge.
    {
      const _ac = emitAcConductorBom(acBomRuns);
      _branchWireReconciliation = _ac.evidence;
      for (const it of _ac.items) {
        items.push(it);
        log.push({ stageId: 'ac', category: 'wire', item: it.model,
          quantity: it.quantity, derivedFrom: it.formula,
          formula: it.derivedFrom, necReference: it.necReference });
      }
    }

    // ── §6/§7 — conduit + fittings PER PHYSICAL RACEWAY (no "— all runs" roll-up;
    // the shared branch home-run is counted ONCE; each raceway cites its OWN NEC
    // article from the raceway type — never a template 'NEC 358'). ────────────
    {
      const _raceways = derivePhysicalRacewaysFromRuns(allBomRuns);
      _physicalRaceways = _raceways;
      for (const rw of _raceways) {
        for (const it of emitRacewayConduitBom(rw)) items.push(it);
        log.push({ stageId: 'ac', category: 'conduit', item: `${rw.sizeIn}" ${rw.racewayType} (${rw.physicalRacewayId})`,
          quantity: rw.lengthFt, derivedFrom: rw.segmentIds.join(', '),
          formula: `${rw.physicalRacewayId}: Σ segment length × ${_WASTE}`, necReference: `NEC ${rw.necArticle}` });
      }
    }

  } else {
    // ── Fallback when no runs provided ──
    const resolvedAcWireGauge = input.acWireGauge ?? '#8 AWG';
    const resolvedConduitSize = input.conduitSizeInch ?? '3/4';
    // AC home run: 3 current-carrying conductors + 1 EGC = 4 total
    const acWireQty = conduitLength(input.acWireLength * 4);
    const acConduitQty = conduitLength(input.acWireLength);

    items.push(addItem('ac', 'wire', 'Southwire', `${resolvedAcWireGauge} THWN-2`,
      `THWN2-${resolvedAcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${resolvedAcWireGauge} THWN-2 — AC home run (3 CC + 1 EGC = 4 conductors)`,
      acWireQty, 'ft', 'NEC 310.15 / 250.122',
      'acWireLength x 4 x 1.15', `${input.acWireLength} x 4 x 1.15`, true));
    log.push({ stageId: 'ac', category: 'wire', item: `${resolvedAcWireGauge} THWN-2`,
      quantity: acWireQty, derivedFrom: 'acWireLength x 4 conductors x 1.15 fitting',
      formula: 'acWireLength * 4 * 1.15', necReference: 'NEC 310.15 / 250.122' });

    items.push(addItem('ac', 'conduit', 'Generic', `${resolvedConduitSize}" ${input.conduitType} Conduit`,
      `${input.conduitType}-${resolvedConduitSize.replace('/', '-')}`,
      `${resolvedConduitSize}" ${input.conduitType} conduit — AC home run`,
      acConduitQty, 'ft', 'NEC 358',
      'acWireLength x 1.15', `${input.acWireLength} x 1.15`, true));
  }

  // ── Conduit Fittings — FLAT FALLBACK ONLY (no runs) ─────────────────────────
  // When runs ARE present the §6 per-physical-raceway pass above already emitted
  // each raceway's own conduit + fittings (couplings/connectors/straps/bushings/
  // bends), labeled with its physicalRacewayId and citing its raceway-type NEC
  // article. This flat block only covers the design-studio fallback path where
  // no sized runs exist (env-based single AC home run).
  if (!(input.runs && input.runs.length > 0)) {
    const _fitGroups = new Map<string, { size: string; type: string; ft: number }>();
    if (_fitGroups.size === 0) {
      const size = input.conduitSizeInch ?? '3/4';
      const type = input.conduitType ?? 'EMT';
      _fitGroups.set(`${size}|${type}`, { size, type, ft: conduitLength(input.acWireLength) });
    }

    let _fitTotal = 0;
    for (const { size: conduitSize, type: conduitType, ft: totalConduitFt } of _fitGroups.values()) {
      const _typeTag = conduitType.replace(/\s+/g, '-');
      const _sizeTag = conduitSize.replace('/', '-').replace(/"/g, '');
      // Connectors — 1 per 10 ft (termination at each end + mid-run joins)
      const connQty = Math.max(2, Math.ceil(totalConduitFt / 10));
      items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Connector`,
        `${_typeTag}-CONN-${_sizeTag}`,
        `${conduitSize}" ${conduitType} set-screw connector — NEC 300.15`,
        connQty, 'ea', 'NEC 300.15 / 358.30', 'ceil(runConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

      // Couplings — 1 per 10 ft (joins 10-ft sticks)
      const couplingQty = Math.max(1, Math.ceil(totalConduitFt / 10));
      items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Coupling`,
        `${_typeTag}-COUP-${_sizeTag}`,
        `${conduitSize}" ${conduitType} coupling — joins conduit sticks`,
        couplingQty, 'ea', 'NEC 358.30', 'ceil(runConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

      // Insulated bushings — 1 per conduit termination end (min 2 per run segment)
      const bushingQty = Math.max(2, Math.ceil(totalConduitFt / 50) * 2);
      items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" Insulated Bushing`,
        `BUSH-INS-${_sizeTag}`,
        `${conduitSize}" insulated throat bushing — protects conductors at conduit end per NEC 300.15`,
        bushingQty, 'ea', 'NEC 300.15', 'ceil(runConduitFt/50)*2', `ceil(${totalConduitFt}/50)*2`, true));

      // One-hole straps — 1 per 10 ft (NEC 358.30 support every 10 ft)
      const strapQty = Math.max(2, Math.ceil(totalConduitFt / 10));
      items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} One-Hole Strap`,
        `${_typeTag}-STRAP-${_sizeTag}`,
        `${conduitSize}" ${conduitType} one-hole strap — NEC 358.30 support every 10 ft`,
        strapQty, 'ea', 'NEC 358.30', 'ceil(runConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

      _fitTotal += connQty + couplingQty + bushingQty + strapQty;
    }

    log.push({ stageId: 'ac', category: 'conduit_fitting', item: 'Conduit Fittings Set',
      quantity: _fitTotal,
      derivedFrom: 'per-raceway run conduit footage',
      formula: 'connectors + couplings + bushings + straps derived per raceway (matching each segment)',
      necReference: 'NEC 300.15 / 358.30' });
  }

  // Interconnection method — needed for fused/non-fused disconnect decision
  // (also used below in Backfeed Breaker section)
  const interconMethod = String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
  const isSupplySideTap = interconMethod === 'SUPPLY_SIDE_TAP' ||
    interconMethod.includes('SUPPLY_SIDE') ||
    interconMethod.includes('LINE_SIDE') ||
    interconMethod.includes('LINE_TAP');

  // ── AC Disconnect Sizing Engine — NEC 690.14 / 705.60 / 705.11 ─────────────
  //
  // ONE combined disconnect for the whole system (NEC 690.14).
  // Sizing:
  //   1. Continuous current = systemKw × 1000 ÷ voltage  (NEC 705.60)
  //   2. Required amps      = continuous × 1.25           (125% continuous load rule)
  //   3. Fuse size          = next standard fuse ≥ required amps (fused disconnect only)
  //   4. Enclosure size     = next standard enclosure ≥ required amps
  //      Standard enclosures: 30A, 60A, 100A, 200A, 400A, 600A
  //
  // Fused vs Non-Fused:
  //   SUPPLY_SIDE_TAP (NEC 705.11) → FUSED — disconnect IS the OCPD (no panel breaker)
  //   LOAD_SIDE / MAIN_BREAKER_DERATE / PANEL_UPGRADE (NEC 705.12) → NON-FUSED
  //     — backfed breaker at panel IS the OCPD; disconnect just interrupts
  //
  if (input.requiresACDisconnect !== false) {
    const acVoltage = input.acVoltage ?? 240;

    // Step 1-2: Continuous current × 125% — from AC nameplate (DC kW would oversize the disco/fuse)
    const acContCurrent = ((input.acOutputKw ?? input.systemKw) * 1000) / acVoltage;
    const acRequiredAmps = acContCurrent * 1.25;

    // Step 3: Determine fused or non-fused from interconnection method
    const isFusedDisc = isSupplySideTap; // supply-side = fused; load-side = non-fused

    // Step 4: Standard sizes — single-sourced from lib/electrical/stdSizes.ts
    // (P0-5c/P2-2; the old local fuse copy stopped at 200 A with a fictional
    // next-10A fallback). NEC 240.6(A) fuse sizes; Littelfuse LLNRK Class RK5
    // is catalogued through 600 A — above that the generic part-number
    // fallback (`DPF-…`) already flags a non-standard pick for review.
    const nextFuse = (a: number) => nextStandardOcpd(a);

    // Fuse size = next standard fuse ≥ required amps (fused only).
    // When the caller supplies the system disconnect / tap OCPD target
    // (conductorAuthority POI via bomForPermit — Σ per-source backfeed OCPDs),
    // the fuse sizes from IT: the kW basis goes stale on hybrids and shipped
    // 110A fuses against E-1's 200A tap OCPD (verify-lead, 2026-07-18).
    const _targetDiscA = input.systemAcDisconnectA;
    const fuseAmps = isFusedDisc ? nextFuse(_targetDiscA ?? acRequiredAmps) : null;

    // Enclosure size = next standard enclosure ≥ required amps
    // For fused: enclosure must hold the fuse, so enclosure ≥ fuse amps
    // For non-fused: enclosure ≥ required amps (or the E-1 target when given)
    const enclosureRequirement = isFusedDisc ? (fuseAmps ?? acRequiredAmps) : (_targetDiscA ?? acRequiredAmps);
    const acDiscAmps = nextEnclosure(enclosureRequirement);

    // Part number:
    //   Non-fused: Square D DU{amps}RB  (e.g. DU60RB, DU100RB)
    //   Fused:     Eaton DPF2{code}RP   (30A→DPF221RP, 60A→DPF222RP, 100A→DPF222RB, 200A→DPF224RB)
    const nonFusedPartNum = `DU${acDiscAmps}RB`;
    const fusedPartNumMap: Record<number, string> = {
      30: 'DPF221RP', 60: 'DPF222RP', 100: 'DPF222RB', 200: 'DPF224RB',
    };
    const fusedPartNum = fusedPartNumMap[acDiscAmps] ?? `DPF-${acDiscAmps}A`;
    const acDiscPartNum = isFusedDisc ? fusedPartNum : nonFusedPartNum;
    const acDiscMfr     = isFusedDisc ? 'Eaton' : 'Square D';
    const discTypeLabel = isFusedDisc ? 'Fusible' : 'Non-Fusible';

    items.push(addItem('ac', 'disconnect', acDiscMfr,
      `${acDiscAmps}A ${discTypeLabel} AC Disconnect`,
      acDiscPartNum,
      `${acDiscAmps}A ${discTypeLabel} AC disconnect — NEC 690.14` +
        (isFusedDisc ? ` / NEC 705.11 supply-side (fuse: ${fuseAmps}A)` : ' / NEC 705.12 load-side'),
      1, 'ea', 'NEC 690.14', 'perSystem',
      `nextEnclosure(${acRequiredAmps.toFixed(1)}A × 1.25) = ${acDiscAmps}A`, true));

    // Add fuse line item for fused disconnect
    if (isFusedDisc && fuseAmps !== null) {
      items.push(addItem('ac', 'fuse', 'Littelfuse',
        `${fuseAmps}A Class RK5 Fuse`,
        `LLNRK${fuseAmps}SP`,
        `${fuseAmps}A 250V Class RK5 time-delay fuse — 2 per fused disconnect (NEC 690.9)`,
        2, 'ea', 'NEC 690.9', 'perSystem', '2 per fused disconnect', true));
      log.push({ stageId: 'ac', category: 'fuse', item: `${fuseAmps}A Class RK5 Fuse`,
        quantity: 2, derivedFrom: 'fused disconnect',
        formula: `nextFuse(continuous × 1.25) = ${fuseAmps}A × 2 poles`,
        necReference: 'NEC 690.9' });
    }

    log.push({ stageId: 'ac', category: 'ac_disconnect', item: `${acDiscAmps}A ${discTypeLabel} AC Disconnect`,
      quantity: 1, derivedFrom: 'perSystem',
      formula: `nextEnclosure(${acContCurrent.toFixed(1)}A × 1.25 = ${acRequiredAmps.toFixed(1)}A) = ${acDiscAmps}A enclosure`,
      necReference: 'NEC 690.14' });
    complianceNotes.push(
      `NEC 690.14 / NEC 705.60: 1× ${acDiscAmps}A ${discTypeLabel} disconnect — ` +
      `${acContCurrent.toFixed(1)}A output × 1.25 = ${acRequiredAmps.toFixed(1)}A → ${acDiscAmps}A enclosure` +
      (isFusedDisc ? ` + ${fuseAmps}A fuse (NEC 705.11 supply-side)` : ' (NEC 705.12 load-side)')
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backfeed Breaker — NEC 705.12(B) Load-Side vs NEC 705.11 Supply-Side
  //
  // NEC interconnection methods:
  //   LOAD_SIDE (NEC 705.12(B))    → backfed breaker in main load center.
  //                                   120% rule: (busRating × 1.2) − mainAmps.
  //                                   FIX v57.3: Was incorrectly skipping breaker
  //                                   for LOAD_SIDE. NEC 705.12(B) REQUIRES it.
  //   BACKFED_BREAKER              → alias for LOAD_SIDE (same NEC code path).
  //   SUPPLY_SIDE_TAP (NEC 705.11) → line-side tap before main breaker.
  //                                   No backfed breaker in load center.
  //   MAIN_BREAKER_DERATE          → main breaker derated per 705.12(B)(3).
  //                                   No separate backfed breaker BOM item.
  //   PANEL_UPGRADE                → new panel with headroom.
  //                                   No dedicated backfed breaker.
  // ─────────────────────────────────────────────────────────────────────────
  // interconMethod and isSupplySideTap already declared above (before AC Disconnect block)
  // LOAD_SIDE and BACKFED_BREAKER both require a backfed breaker per NEC 705.12(B)
  const isLoadSide = interconMethod === 'LOAD_SIDE' ||
    interconMethod === 'BACKFED_BREAKER' ||
    (interconMethod.includes('BACKFED') && !interconMethod.includes('SUPPLY')) ||
    (interconMethod.includes('LOAD') && !interconMethod.includes('SUPPLY'));
  // Main breaker derate or panel upgrade — no separate backfed breaker
  const isMainBreakerDerate = interconMethod === 'MAIN_BREAKER_DERATE';
  const isPanelUpgrade = interconMethod === 'PANEL_UPGRADE';

  if (isLoadSide) {
    // NEC 705.12(B) — backfed breaker required in main load center. Enforce 120% rule.
    const busRating    = input.panelBusRating ?? input.mainPanelAmps ?? 200;
    const mainAmps     = input.mainPanelAmps ?? 200;
    const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
    // If backfeedAmps not provided (0 or missing), derive from system kW:
    // NEC 705.12(B): continuous AC output current × 1.25 → next standard breaker
    const derivedBackfeedAmps = (input.backfeedAmps ?? 0) > 0
      ? input.backfeedAmps
      : ((input.acOutputKw ?? input.systemKw) * 1000 / (input.acVoltage ?? 240)) * 1.25;
    const requestedBreaker = nextStandardBreaker(derivedBackfeedAmps);
    const backfeedAmps = Math.min(requestedBreaker, maxPVBreaker);
    if (requestedBreaker > maxPVBreaker) {
      warnings.push(
        `NEC 705.12(B) VIOLATION: Requested ${requestedBreaker}A backfeed exceeds 120% max (${maxPVBreaker}A) ` +
        `for ${busRating}A bus / ${mainAmps}A main. ` +
        `BOM capped to ${backfeedAmps}A — use SUPPLY_SIDE_TAP (NEC 705.11) to use full ${requestedBreaker}A.`
      );
    }
    items.push(addItem('ac', 'breaker', 'Square D', `${backfeedAmps}A Backfeed Breaker`,
      `QO${backfeedAmps}`,
      `${backfeedAmps}A 2-pole backfeed breaker — NEC 705.12(B) load-side (bus: ${busRating}A, max: ${maxPVBreaker}A)`,
      1, 'ea', 'NEC 705.12(B)', 'perSystem', '1', true));
    log.push({ stageId: 'ac', category: 'breaker', item: `${backfeedAmps}A Backfeed Breaker`,
      quantity: 1, derivedFrom: 'backfeedAmps',
      formula: 'min(nextStandardBreaker(backfeedAmps), floor(busRating×1.2−mainPanelAmps))',
      necReference: 'NEC 705.12(B)' });
    complianceNotes.push(
      `NEC 705.12(B): Backfeed breaker ${backfeedAmps}A — 120% rule: (${busRating}A × 1.2) − ${mainAmps}A = ${maxPVBreaker}A max`
    );
  } else if (isSupplySideTap) {
    // NEC 705.11 — supply-side tap, no backfed breaker in load center.
    // The tap itself needs PHYSICAL connectors (was a compliance note only —
    // the BOM shipped a supply-side job with a fused disco but nothing to make
    // the tap): insulation-piercing / Polaris-style insulated multi-tap
    // connectors on the service-entrance conductors — L1 + L2 + N = 3.
    items.push(addItem('ac', 'connector', 'NSI Polaris',
      'Insulated Multi-Tap Connector (350 kcmil–#6)',
      'IPLD350-3', 'Polaris-style insulated tap connector — supply-side tap of service-entrance conductor (1 per conductor: L1/L2/N). Verify lug range against actual service conductor size.',
      3, 'ea', 'NEC 705.11(C)', 'perSystem (supply-side tap)', 'L1+L2+N = 3', true));
    log.push({ stageId: 'ac', category: 'connector', item: 'Polaris Insulated Multi-Tap',
      quantity: 3, derivedFrom: 'supply-side tap (L1/L2/N)', formula: '3', necReference: 'NEC 705.11(C)' });
    complianceNotes.push(
      `NEC 705.11: Supply-side tap — no backfed breaker in load center. ` +
      `Connection is utility-side (before main breaker) via insulated multi-tap connectors; ` +
      `tap conductors terminate in the fused disconnect (OCPD) per 705.11(C).`
    );
  } else if (isMainBreakerDerate) {
    // NEC 705.12(B)(3) — main breaker derated, no separate backfed breaker
    complianceNotes.push(
      `NEC 705.12(B)(3): Main breaker derate — main OCPD derated to allow PV backfeed. ` +
      `No dedicated backfed breaker in BOM.`
    );
  } else if (isPanelUpgrade) {
    // Panel upgrade — new panel has headroom, no dedicated backfed breaker needed
    complianceNotes.push(
      `NEC 705.12(B): Panel upgrade — new load center with sufficient headroom. ` +
      `No dedicated backfed breaker required.`
    );
  }

  // Production Meter
  if (input.requiresProductionMeter) {
    items.push(addItem('ac', 'meter', 'Itron', 'Production Meter',
      'ITRON-PROD-1', 'Revenue-grade production meter', 1, 'ea', 'NEC 690.4', 'perSystem', '1', false));
  }

  // ── STAGE 5: STRUCTURAL ──────────────────────────────────────────────────────

  // Real structural quantities (roof) — usable with OR without a registry entry.
  const _roofRB = (input.rackingBOM && input.systemType === 'roof') ? input.rackingBOM : undefined;

  // Emit the real rackingBOM lines (single source: calcRackingBOM from real
  // ArrayGeometry). NB: rb.mounts (pad/standoff) is covered by the racking "lot"
  // line, and rb.groundLugs is subsumed by the per-module bonding clips — both
  // omitted to avoid double-counting.
  const emitRackingBOM = (rb: NonNullable<typeof _roofRB>, mfr: string) =>
    emitRackingBOMInto(items, log, rb, mfr);

  if (!rackingEntry && _roofRB) {
    // No equipment-registry entry resolved for the racking id — the OLD code
    // skipped Stage 5 entirely here, silently shipping a BOM with NO pads, rails,
    // splices, bolts or clamps (SCHED-2 showed grounding only). The structural
    // engine's rackingBOM is self-sufficient (manufacturer + real quantities), so
    // emit the racking system + hardware from it instead of vanishing.
    items.push(addItem('structural', 'racking', _roofRB.manufacturer, _roofRB.systemModel,
      _roofRB.mounts.partNumber ?? _roofRB.systemModel,
      `${_roofRB.manufacturer} ${_roofRB.systemModel} mounting system — quantities per structural analysis (PV-4C)`,
      1, 'lot', 'UL 2703', 'perSystem', '1', true));
    items.push(addItem('structural', 'attachment', _roofRB.manufacturer,
      _roofRB.mounts.description, _roofRB.mounts.partNumber ?? 'TBD', _roofRB.mounts.description,
      Math.ceil(_roofRB.mounts.qty), 'ea', 'ASCE 7-22', 'structuralEngine.rackingBOM', 'calcRackingBOM', true));
    log.push({ stageId: 'structural', category: 'racking', item: _roofRB.systemModel,
      quantity: 1, derivedFrom: 'structuralEngine.rackingBOM (no registry entry)', formula: '1', necReference: 'UL 2703' });
    emitRackingBOM(_roofRB, _roofRB.manufacturer);
  }

  // ── HYBRID (P3) roof-subset basis for the registry racking formulas ────────
  // V4's Stage 5 registry path is the ROOF racking authority. In a hybrid
  // project (subSystemCounts present) its per-module / per-string accessory
  // formulas must scale to the ROOF SUBSET, not the project totals — the
  // Stowell CSV billed WEEB lugs ×94 and UFO mid clamps (94−strings)×2 for a
  // 51-module roof. attachments/railSections need no scaling here: the route
  // already threads the roof-subset values from roofData.
  const _hybridSubset = !!input.subSystemCounts;
  const _roofBasisModules = _hybridSubset
    ? Math.max(0, input.subSystemCounts!.roof)
    : input.moduleCount;
  // Roof-subset row/string basis: explicit input.roofStringCount wins; else
  // pro-rate: ceil(roofModules / (moduleCount / rows)) — rows = stringCount
  // when the topology has strings, else effectiveRows (micro row proxy).
  const _roofBasisStrings = (() => {
    if (!_hybridSubset) return effectiveRows;
    if (input.roofStringCount && input.roofStringCount > 0) return Math.ceil(input.roofStringCount);
    if (_roofBasisModules <= 0) return 0;
    const _rows = input.stringCount > 0 ? input.stringCount : effectiveRows;
    const _modulesPerRow = _rows > 0 ? input.moduleCount / _rows : 4;
    return Math.max(1, Math.ceil(_roofBasisModules / Math.max(1, _modulesPerRow)));
  })();

  // Rail-less roof racking / rail-formula categories: module scope (shared
  // with the per-sub path) — see RAIL_LESS_ROOF_RACKING above (Addendum A:
  // RT-MINI pairs WITH a rail; the IronRidge accessories are Ray's default
  // pairing, not a copy-paste bug; set intentionally EMPTY).
  // Scaling/suppression applies only to ROOF racking entries — a hybrid whose
  // resolved rackingId is a ground/fence system keeps legacy behavior (its
  // structural truth comes from bom-system-profiles, not this stage).
  const _isRoofRackingEntry = !!rackingEntry
    && String(rackingEntry.mountTopology ?? rackingEntry.topologyType ?? 'ROOF').toUpperCase().startsWith('ROOF');
  const _scaleToRoofSubset = _hybridSubset && _isRoofRackingEntry;
  const _suppressRailFormulas = _scaleToRoofSubset && !_roofRB
    && RAIL_LESS_ROOF_RACKING.has(rackingEntry!.id);

  if (rackingEntry && _scaleToRoofSubset && _roofBasisModules <= 0) {
    // Hybrid with ZERO roof modules — no roof racking system at all.
    log.push({ stageId: 'structural', category: 'racking', item: rackingEntry.model,
      quantity: 0, derivedFrom: 'subSystemCounts.roof = 0 — roof racking suppressed',
      formula: '0', necReference: rackingEntry.iccEsReport });
  } else if (rackingEntry) {
    // Primary racking system
    items.push(addItem('structural', 'racking', rackingEntry.manufacturer, rackingEntry.model,
      rackingEntry.partNumber ?? rackingEntry.id,
      `${rackingEntry.manufacturer} ${rackingEntry.model} — ${_suppressRailFormulas ? 'rail-less' : (rackingEntry.structuralSpecs?.requiresRail ? 'rail-based' : 'rail-less')} mount`,
      1, 'lot', rackingEntry.iccEsReport ?? 'UL 2703', 'perSystem', '1', true));
    log.push({ stageId: 'structural', category: 'racking', item: rackingEntry.model,
      quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: rackingEntry.iccEsReport });

    // Racking accessories — SINGLE SOURCE. When the structural engine's real
    // rackingBOM is provided (roof), emit rails/splices/L-feet/clamps/lag+rail
    // bolts/grounding from it so the BOM's rail COUNT + rail BOLTS match the
    // structural sheets (calcRackingBOM derives them from real ArrayGeometry).
    // Otherwise fall back to the registry accessory formulas (design-studio path).
    if (_roofRB) {
      emitRackingBOM(_roofRB, rackingEntry.manufacturer);
    } else {
      // Resolve all racking accessories (registry formulas — design-studio fallback)
      for (const acc of rackingEntry.requiredAccessories) {
        // Rail-less system in a hybrid payload: the generic rail-formula lines
        // (rails/splices/clamps/L-feet — IronRidge-branded defaults on the
        // RT-MINI entry) must not bill alongside the flashed pads.
        if (_suppressRailFormulas && RAIL_FORMULA_CATEGORIES.has(acc.category)) {
          log.push({ stageId: 'structural', category: acc.category,
            item: acc.defaultModel ?? acc.description, quantity: 0,
            derivedFrom: `suppressed — ${rackingEntry.id} is rail-less (pads include the attachment)`,
            formula: '0', necReference: acc.necReference });
          continue;
        }
        // Check conditional
        if (acc.conditional) {
          const conditionMet = evaluateConditionBOM(acc.conditional, input.roofType);
          if (!conditionMet) continue;
        }

        // HYBRID: module/string bases scale to the roof subset (51 of 94 —
        // Stowell); legacy payloads keep the project-wide values verbatim.
        const _accModules = _scaleToRoofSubset ? _roofBasisModules : input.moduleCount;
        const _accStrings = _scaleToRoofSubset ? _roofBasisStrings : input.stringCount;

        let qty = 1;
        if (acc.quantityRule === 'formula' && acc.quantityFormula) {
          qty = evaluateQuantityFormulaV4(acc.quantityFormula, {
            ...formulaCtx,
            ...(_scaleToRoofSubset ? {
              modules: _roofBasisModules,
              strings: _roofBasisStrings,
              branches: _roofBasisStrings,
            } : {}),
            attachments: input.attachmentCount,
            railSections: input.railSections,
          });
        } else if (acc.quantityRule === 'perModule') {
          qty = _accModules;
        } else if (acc.quantityRule === 'perString') {
          qty = _accStrings;
        } else if (acc.quantityRule === 'perAttachment') {
          qty = input.attachmentCount;
        } else if (acc.quantityRule === 'perSystem') {
          qty = 1;
        }

        if (acc.quantityMultiplier) qty *= acc.quantityMultiplier;
        qty = Math.ceil(qty);

        if (qty > 0) {
          items.push(addItem('structural', acc.category,
            acc.defaultManufacturer ?? rackingEntry.manufacturer,
            acc.defaultModel ?? acc.description,
            acc.defaultPartNumber ?? 'TBD',
            acc.description,
            qty, 'ea', acc.necReference ?? 'UL 2703',
            acc.quantityFormula ?? acc.quantityRule,
            acc.quantityFormula ?? acc.quantityRule,
            acc.required));
          log.push({ stageId: 'structural', category: acc.category,
            item: acc.defaultModel ?? acc.description, quantity: qty,
            derivedFrom: acc.quantityFormula ?? acc.quantityRule,
            formula: acc.quantityFormula ?? acc.quantityRule,
            necReference: acc.necReference });
        }
      }
    }
  }

  // ── Equipment Grounding Conductor — FLAT FALLBACK ONLY (no runs) ────────────
  // §5 closeout: when sized runs are present, the per-segment EGC is emitted ONCE
  // per raceway by emitAcConductorBom (one shared green EGC per raceway,
  // NEC 250.122(C)) — this flat `acWireLength × 1.15` row was the SECOND,
  // independent EGC emitter that double-billed grounding on two bases. It now
  // only covers the design-studio fallback path (no per-segment conductors).
  if (!(input.runs && input.runs.length > 0)) {
    const egcLength = conduitLength(input.acWireLength);
    // EGC gauge: NEC 250.122 — based on OCPD size
    const ocpdForEgc = input.acOCPD > 0 ? input.acOCPD : nextStandardBreaker(
      ((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25
    );
    const egcGauge = ocpdForEgc <= 60 ? '#10 AWG' : ocpdForEgc <= 100 ? '#8 AWG' : '#6 AWG';
    items.push(addItem('structural', 'wire', 'Southwire', `${egcGauge} THWN-2 Green EGC`,
      `THWN2-GRN-${egcGauge.replace('#', '').replace(' AWG', '')}`,
      `${egcGauge} green THWN-2 equipment grounding conductor — NEC 250.122`,
      egcLength, 'ft', 'NEC 690.43 / 250.122', 'acWireLength × 1.15', `${input.acWireLength} × 1.15`, true));
    log.push({ stageId: 'structural', category: 'wire', item: `${egcGauge} EGC`,
      quantity: egcLength, derivedFrom: 'acWireLength × 1.15',
      formula: 'acWireLength * 1.15', necReference: 'NEC 690.43 / 250.122' });
  }

  // Ground Rod & GEC — NEC 250.52(A)(5) / 250.66
  // §7 (07-22): a grid-tied PV interconnection bonds to the EXISTING service
  // grounding electrode system (NEC 250.64 / 690.47) — NO new electrode. Only
  // materialize a ground rod + acorn clamp + GEC when an authoritative design
  // input requires a NEW electrode. Previously this ran unconditionally and put
  // a phantom 5/8"×8ft rod + acorn + #6 GEC on every microinverter package.
  if (input.requiresGroundingElectrode === true) {
    // Ground rod: 8-ft copper-clad per NEC 250.52(A)(5)
    items.push(addItem('structural', 'grounding', 'Erico/Harger', '5/8" × 8 ft Copper-Clad Ground Rod',
      'GR-5/8-8',
      '5/8" × 8 ft copper-clad steel ground rod — NEC 250.52(A)(5)',
      1, 'ea', 'NEC 250.52(A)(5)', 'perSystem', '1', true));

    // Ground rod clamp
    items.push(addItem('structural', 'grounding', 'Erico/Harger', '5/8" Ground Rod Acorn Clamp',
      'GRC-5/8',
      '5/8" ground rod acorn clamp — bonds GEC to ground rod per NEC 250.70',
      1, 'ea', 'NEC 250.70', 'perSystem', '1', true));

    // GEC: Grounding Electrode Conductor — NEC 250.66
    // Sized by largest service conductor or 6 AWG minimum for PV systems ≤ 200A
    const gecOcpd = input.acOCPD > 0 ? input.acOCPD
      : nextStandardBreaker(((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25);
    const gecGauge = gecOcpd <= 60 ? '#6 AWG' : gecOcpd <= 100 ? '#4 AWG' : '#2 AWG';
    const gecLength = 50; // standard 50-ft run from inverter to grounding electrode
    items.push(addItem('structural', 'wire', 'Southwire', `${gecGauge} Bare Copper GEC`,
      `BARE-CU-${gecGauge.replace('#', '').replace(' AWG', '')}`,
      `${gecGauge} bare copper grounding electrode conductor — NEC 250.66`,
      gecLength, 'ft', 'NEC 250.66', 'perSystem', '50', true));

    log.push({ stageId: 'structural', category: 'grounding', item: 'Grounding Electrode System',
      quantity: 3, derivedFrom: 'perSystem',
      formula: '1 ground rod + 1 clamp + 50ft GEC',
      necReference: 'NEC 250.52 / 250.66 / 250.70' });
    complianceNotes.push(
      `NEC 250.52(A)(5): 5/8"×8ft copper-clad ground rod + acorn clamp + ${gecGauge} GEC (50ft) required`
    );
  }

  // STAGE 5b REMOVED (MASTER TASK): Structural items now handled by merge layer.
  // V4 engine owns ONLY electrical. Structural (fence/ground) is derived by
  // v47.432: bom-system-profiles.ts now generates these items directly; bom-merge.ts
  // was deleted in Stage 8.1 (only bom-engine-v4 remains as the canonical BOM engine).
  // See: app/api/engineering/bom/route.ts

  // ── STAGE 6: MONITORING ──────────────────────────────────────────────────────

  // Gateway already added above in Stage 3 if needed
  // Add monitoring accessories from inverter entry
  if (inverterEntry) {
    const monitoringAcc = inverterEntry.requiredAccessories.find(a => a.category === 'monitoring');
    if (monitoringAcc) {
      items.push(addItem('monitoring', 'monitoring',
        monitoringAcc.defaultManufacturer ?? inverterEntry.manufacturer,
        monitoringAcc.defaultModel ?? 'Monitoring System',
        monitoringAcc.defaultPartNumber ?? 'MON-TBD',
        monitoringAcc.description, 1, 'ea',
        monitoringAcc.necReference ?? 'NEC 690.4', 'perSystem', '1', false));
    }
  }

  // SolarEdge RS485 communication cables — 1 per inverter to SEG-HUB-1 gateway
  // Required for all SolarEdge optimizer-based systems (STRING_WITH_OPTIMIZER topology)
  if (inverterEntry && inverterEntry.manufacturer === 'SolarEdge' &&
      (norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY')) {
    const rs485Qty = Math.max(1, input.inverterCount ?? 1);
    items.push(addItem('monitoring', 'communication_cable', 'SolarEdge', 'RS485 Communication Cable',
      'SE-RS485-10FT',
      `RS485 communication cable — inverter to SEG-HUB-1 gateway (${rs485Qty} inverter${rs485Qty > 1 ? 's' : ''})`,
      rs485Qty, 'ea', 'NEC 690.4', 'inverterCount', 'inverters', true));
    log.push({ stageId: 'monitoring', category: 'communication_cable', item: 'RS485 Communication Cable',
      quantity: rs485Qty, derivedFrom: 'inverterCount', formula: 'inverters',
      necReference: 'NEC 690.4' });
    complianceNotes.push(
      `SolarEdge RS485: ${rs485Qty} communication cable(s) required — inverter(s) to SEG-HUB-1 gateway`
    );
  }

  // ── STAGE 7: LABELS ──────────────────────────────────────────────────────────

  if (input.requiresWarningLabels !== false) {
    // NEC 690.31 — DC conductor labels. §13: a microinverter design has NO DC
    // source/output circuits (each module is paired 1:1 with a micro; the only
    // DC is the factory MC4 module lead). A "DC Conductor Label Set" sized on a
    // phantom stringCount is a string-system artifact — omit it for micro.
    if (!isMicro) {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'DC Conductor Label Set',
        'LABEL-DC-SET', 'DC conductor warning labels per NEC 690.31',
        input.stringCount * 2, 'ea', 'NEC 690.31', 'stringCount × 2', 'strings * 2', true));
    }

    // NEC 690.54 — Equipment labels
    items.push(addItem('labels', 'label', 'HellermannTyton', 'PV System Warning Label',
      'LABEL-PV-WARN', 'PV system warning label per NEC 690.54',
      1, 'ea', 'NEC 690.54', 'perSystem', '1', true));

    // NEC 690.56 — Rapid shutdown label
    if (input.requiresRapidShutdown !== false) {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Rapid Shutdown Label',
        'LABEL-RSD', 'Rapid shutdown label per NEC 690.56',
        1, 'ea', 'NEC 690.56', 'perSystem', '1', true));
    }

    // Point-of-interconnection label — method-specific. A supply-side tap job
    // has no backfeed breaker; ordering a "backfeed breaker label" for it
    // contradicted E-1/PV-4A ("Backfed Breaker: N/A — Tap Connection").
    if (String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase() === 'SUPPLY_SIDE_TAP') {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Supply-Side Tap POI Label',
        'LABEL-SST', 'Point-of-interconnection label per NEC 705.10 (supply-side tap, NEC 705.11)',
        1, 'ea', 'NEC 705.10', 'perSystem', '1', true));
    } else {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Backfeed Breaker Label',
        'LABEL-BF', 'Backfeed breaker label per NEC 705.12',
        1, 'ea', 'NEC 705.12', 'perSystem', '1', true));
    }

    // Disconnecting means label — NEC 690.13 labels the DISCONNECTING MEANS
    // (AC disco + point of interconnection), not every inverter: the old
    // inverterCount+1 derivation printed "qty 53" for a 52-micro job.
    const discLabelQty = (input.requiresACDisconnect !== false ? 1 : 0)
      + (input.requiresDCDisconnect ? 1 : 0) + 1;   // +1 = point of interconnection
    items.push(addItem('labels', 'label', 'HellermannTyton', 'Disconnecting Means Label',
      'LABEL-DISC', 'Disconnecting means label per NEC 690.13',
      discLabelQty, 'ea', 'NEC 690.13', 'disconnecting means (AC/DC disco + POI)', 'AC disco + DC disco + POI', true));

    log.push({ stageId: 'labels', category: 'label', item: 'Warning Label Set',
      quantity: 5, derivedFrom: 'NEC 690.31, 690.54, 690.56, 705.12, 690.13', formula: 'perSystem', necReference: 'NEC 690' });
  }

  // ── TRUCK STOCK — recommended extras / consumables (Ray, 2026-07-11) ─────────
  // NOT installed quantities: what the crew should carry beyond the exact BOM.
  // Data-driven off job size (conduit feet, attachments, devices); gated by
  // topology/interconnection; every line required:false and stage 'truck_stock'
  // so consumers subtotal it separately ($/W stays on required materials) and
  // the permit SCHED can exclude it. Quantity rules are DEFAULTS — tune with
  // Ray's real truck list (see TRUCK_STOCK_RULES).
  if (input.includeTruckStock !== false) {
    const _tsConduitFt = Math.ceil((input.acWireLength ?? 60) * 1.15)
      + (isMicro ? 0 : Math.ceil((input.dcWireLength ?? 50) * 1.15));
    const _tsAttach = input.attachmentCount ?? 0;
    const _tsDevices = input.deviceCount ?? input.moduleCount;
    const _tsTrunkSections = isMicro ? Math.ceil(_tsDevices / 13) : 0;
    const ts = (category: string, mfr: string, model: string, pn: string, desc: string, qty: number, basis: string) => {
      if (qty <= 0) return;
      items.push(addItem('truck_stock', category, mfr, model, pn,
        `${desc} — recommended truck stock (not installed qty)`,
        Math.ceil(qty), 'ea', 'BEST PRACTICE', `truck stock: ${basis}`, basis, false));
      log.push({ stageId: 'truck_stock', category, item: model, quantity: Math.ceil(qty),
        derivedFrom: `truck stock: ${basis}`, formula: basis, necReference: 'BEST PRACTICE' });
    };

    // Conduit routing extras — bodies for the bends you find in the field.
    ts('conduit_body', 'Generic', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} LB Conduit Body`, `LB-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'LB pull elbow (back access)', 2, '2 per job');
    ts('conduit_body', 'Generic', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} LR Conduit Body`, `LR-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'LR pull elbow (right access)', 2, '2 per job');
    ts('conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} Coupling (extra)`, `EMT-COUP-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare couplings', Math.max(3, _tsConduitFt * 0.10 / 10), 'max(3, 10% of couplings)');
    ts('conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} Connector (extra)`, `EMT-CONN-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare box connectors', Math.max(4, _tsConduitFt * 0.10 / 10), 'max(4, 10% of connectors)');
    ts('conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" One-Hole Straps (extra)`, `EMT-STRAP-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare straps', Math.max(5, _tsConduitFt * 0.15 / 10), 'max(5, 15% of straps)');

    // Terminations & connections.
    ts('consumable', 'Ideal/Wago', 'Wire Connector Assortment (winged + lever)', 'WIRENUT-ASST',
      'Wire nuts / Wago levers, assorted', 1, '1 assortment per job');
    if (isSupplySideTap) {
      ts('connector', 'NSI Polaris', 'Insulated Multi-Tap Connector (spare)', 'IPLD350-3',
        'Spare Polaris tap (drop/strip mistakes are one-way)', 1, 'supply-side: 1 spare');
    }

    // Micro trunk spares — cut ends and damaged drops are field realities.
    if (isMicro && _tsTrunkSections > 0) {
      ts('connector', 'Enphase', 'Q Field-Wireable Connector, Male (spare)', 'Q-CONN-10M',
        'Spare trunk field splice, male', 1, 'micro: 1 spare');
      ts('connector', 'Enphase', 'Q Field-Wireable Connector, Female (spare)', 'Q-CONN-10F',
        'Spare trunk field splice, female', 1, 'micro: 1 spare');
      ts('sealing_cap', 'Enphase', 'Q Cable Sealing Cap (spares)', 'Q-SEAL-10',
        'Spare sealing caps for unused/opened drops', Math.max(2, _tsTrunkSections), 'max(2, 1 per branch)');
      ts('terminator', 'Enphase', 'Q Cable Terminator (spare)', 'Q-TERM-10',
        'Spare branch terminator (single-use part)', 1, 'micro: 1 spare');
    }

    // Roof attachment extras.
    if (_tsAttach > 0) {
      ts('lag_bolt', 'Generic', 'Structural Lag/Screw (extras)', 'LAG-X',
        'Spare lags for split rafters / misses', Math.max(6, _tsAttach * 0.05), 'max(6, 5% of lags)');
      ts('consumable', 'Chemlink/Geocel', 'Roof Sealant Tube', 'SEALANT-TUBE',
        'Roof-rated sealant', Math.max(2, _tsAttach / 20), '1 tube per ~20 penetrations (min 2)');
    }

    // Electrical spares.
    ts('breaker', 'Square D', `${input.acOCPD || 20}A 2-Pole Breaker (spare)`, `QO${input.acOCPD || 20}-SPARE`,
      'Spare OCPD matching the PV breaker', 1, '1 spare');
  }

  // ── SUGGESTED TOOLS — job-specific tooling advice (Ray, 2026-07-11) ──────────
  // "Like a bandsaw for cutting rails, wire caddys, rolls of thhn" — resolved
  // from what THIS job involves (lib/equipment/suggestedTools; manufacturer
  // provenance in lib/data/equipment/install-tools-*.json). Advice, not
  // materials: qty 1, required:false, never priced (pricing layer skips the
  // 'tools' stage entirely), excluded from the permit SCHED.
  if (input.includeSuggestedTools !== false) {
    const _railBased = !!(rackingEntry?.structuralSpecs?.requiresRail
      ?? ((input.rackingBOM?.rails?.qty ?? 0) > 0 || input.railSections > 0));
    const _tools = resolveSuggestedTools({
      isRailBased: _railBased,
      rackingBrand: input.rackingBOM?.manufacturer ?? rackingEntry?.manufacturer,
      isMicro,
      microBrand: inverterEntry?.manufacturer ?? microDb?.manufacturer,
      conduitType: input.conduitType,
      isSupplySideTap,
      hasRoofAttachments: (input.attachmentCount ?? 0) > 0 && input.systemType === 'roof',
      hasWirePull: (input.acWireLength ?? 0) > 0,
    });
    for (const t of _tools) {
      items.push(addItem('tools', 'tool', t.manufacturer ?? '—', t.tool,
        t.partNumber ?? '—',
        `${t.use}${t.why ? ` — ${t.why}` : ''}`,
        1, 'ea', t.why?.includes('NEC') ? 'NEC 110.14(D)' : 'BEST PRACTICE',
        'suggested tools (job-specific)', 'per job', false));
    }
    if (_tools.length > 0) {
      log.push({ stageId: 'tools', category: 'tool', item: 'Suggested tool set',
        quantity: _tools.length, derivedFrom: 'job context (racking/topology/conduit/interconnection)',
        formula: 'resolveSuggestedTools', necReference: 'BEST PRACTICE' });
    }
  }

  // ── Build Stage Results ───────────────────────────────────────────────────────

  const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
  for (const item of items) {
    if (!stageMap.has(item.stageId)) stageMap.set(item.stageId, []);
    stageMap.get(item.stageId)!.push(item);
  }

  const stages: BOMStageResult[] = (Object.keys(STAGE_LABELS) as BOMStageId[]).map(id => ({
    id,
    label: STAGE_LABELS[id],
    order: STAGE_ORDER[id],
    items: stageMap.get(id) ?? [],
    itemCount: stageMap.get(id)?.length ?? 0,
  })).sort((a, b) => a.order - b.order);

  return {
    items,
    stages,
    totalLineItems: items.length,
    generatedAt: new Date().toISOString(),
    topology,
    topologyLabel: topoResult.label,
    derivationLog: log,
    warnings,
    complianceNotes,
    ...(_branchWireReconciliation ? { branchWireReconciliation: _branchWireReconciliation } : {}),
    ...(_physicalRaceways ? { physicalRaceways: _physicalRaceways } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Wave 2c — PER-SUB-SYSTEM GENERATION (hybrid, N>1 sub-systems)
// docs/ARCHITECTURE-per-subsystem-equipment.md §1.7 / §3 Wave 2c.
//
// Stages 1–3 run PER SUB-SYSTEM from THAT sub's own equipment (Invariant I-3 —
// never a project-wide winner): each sub's panel line at its subset count, each
// micro sub's trunk plan from ITS brand via resolveTrunkCablePlan, each string
// sub's DC wiring/disconnect, RSD keyed on the ROOF sub's own inverter
// capability. Integrated BOS resolves per BRAND GROUP with that group's REAL
// summed branch count (replaces the legacy hardcoded 0). Stage 4 (service-side
// AC wire/conduit/fittings/disconnect/POI) runs exactly ONCE from aggregate
// values (Invariant I-6). Every sub-scoped line is stamped `subSystem`; shared
// service lines stay unstamped.
// ═══════════════════════════════════════════════════════════════════════════

interface SubGenCtx {
  key: SubSystemKey;
  eq: SubSystemEquipment;
  modules: number;
  /** Micro devices = ceil(modules / modulesPerDevice); 0 for non-micro subs. */
  deviceCount: number;
  norm: TopologyType;
  isMicro: boolean;
  entry?: EquipmentRegistryEntry;
  microDb?: ReturnType<typeof getMicroinverterById>;
  invDb?: ReturnType<typeof getInverterById>;
  brand: string;
  model?: string;
  trunkPlan: ReturnType<typeof resolveTrunkCablePlan>;
}

function generateBOMV4PerSubSystem(
  input: BOMGenerationInputV4,
  subMap: Partial<Record<SubSystemKey, SubSystemEquipment>>,
  presentKeys: readonly SubSystemKey[],
): BOMGenerationResultV4 {
  console.log('[V4 RECEIVED — PER-SUB]', {
    subs: presentKeys, counts: input.subSystemCounts, moduleCount: input.moduleCount,
  });
  _idCounter = 0;
  const items: BOMLineItemV4[] = [];
  const log: BOMDerivationEntry[] = [];
  const warnings: string[] = [];
  const complianceNotes: string[] = [];
  // §5/§6 closeout — machine-readable evidence (attached to the result below).
  let _branchWireReconciliation: BranchWireReconciliation | undefined;
  let _physicalRaceways: DerivedRaceway[] | undefined;
  const counts = input.subSystemCounts!;

  /** Push a line, stamping the owning sub-system when the context is sub-scoped. */
  const push = (sub: BOMSystemType | undefined, item: BOMLineItemV4): void => {
    if (sub !== undefined) item.subSystem = sub;
    items.push(item);
  };

  // Namespaced run ids (`${key}:${RunSegmentId}` at N>1 — contract §1.7) AND
  // the explicit RunSegment.subSystem tag are both honored.
  const baseRunId = (r: RunSegment): string => {
    const sid = String(r.id);
    const m = /^(roof|ground|fence):(.+)$/.exec(sid);
    return m ? m[2] : sid;
  };
  const runSubOf = (r: RunSegment): SubSystemKey | undefined => {
    if (r.subSystem) return r.subSystem;
    const m = /^(roof|ground|fence):/.exec(String(r.id));
    return m ? (m[1] as SubSystemKey) : undefined;
  };

  // ── Resolve each sub-system's own equipment context ────────────────────────
  const subs: SubGenCtx[] = [];
  for (const key of SUB_SYSTEM_EMIT_ORDER) {
    const eq = subMap[key];
    if (!eq) continue;
    const modules = Math.max(0, Math.floor(counts[key] ?? 0));
    const entry = eq.inverterId ? getRegistryEntryV4(eq.inverterId) : undefined;
    const microDb = (!entry && eq.inverterId) ? getMicroinverterById(eq.inverterId) : undefined;
    const invDb = (!entry && !microDb && eq.inverterId) ? getInverterById(eq.inverterId) : undefined;
    // Topology from the SUB's OWN inverterId (contract §1.7); the explicit
    // eq.topology only breaks ties when the registries miss the id entirely.
    let norm: TopologyType = entry ? normalizeTopologyV4(entry.topologyType)
      : microDb ? 'MICROINVERTER'
      : eq.topology === 'micro' ? 'MICROINVERTER'
      : eq.topology === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
      : 'STRING_INVERTER';
    if ((eq.optimizerId || eq.topology === 'optimizer') && norm === 'STRING_INVERTER') norm = 'STRING_WITH_OPTIMIZER';
    if (eq.batteryId && norm === 'HYBRID_INVERTER') norm = 'DC_COUPLED_BATTERY';
    if (eq.batteryId && norm === 'MICROINVERTER') norm = 'AC_COUPLED_BATTERY';
    const isMicro = norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY';
    const mpd = isMicro
      ? (getMicroinverterById(eq.inverterId ?? '')?.modulesPerDevice ?? microDb?.modulesPerDevice ?? 1)
      : 1;
    const deviceCount = isMicro ? Math.ceil(modules / Math.max(1, mpd)) : 0;
    const brand = entry?.manufacturer ?? microDb?.manufacturer ?? invDb?.manufacturer ?? eq.ecosystemBrand ?? 'TBD';
    const model = entry?.model ?? microDb?.model ?? invDb?.model;
    const trunkPlan = (isMicro && deviceCount > 0)
      ? resolveTrunkCablePlan({
          brand, model, deviceCount,
          orientation: input.layoutOrientation === 'landscape' ? 'landscape' : 'portrait',
          // Roof array-geometry hints (rows / sub-array bridges / installer
          // row-splice preference) describe the ROOF layout — never applied
          // to ground/fence micro subs.
          rowCount: key === 'roof' ? input.rowCount : undefined,
          subArrayCount: key === 'roof' ? input.subArrayCount : undefined,
          spliceAtRows: key === 'roof' ? input.spliceAtRows : undefined,
        })
      : null;
    subs.push({ key, eq, modules, deviceCount, norm, isMicro, entry, microDb, invDb, brand, model, trunkPlan });
  }

  // Result header topology = the PRIMARY sub (fixed roof > ground > fence —
  // contract §1.4 mirror rule), never a panel-count vote.
  const primary = subs[0];
  const topoResult = resolveTopology({
    inverterId: primary.eq.inverterId ?? input.inverterId,
    optimizerId: primary.eq.optimizerId,
    rackingId: primary.eq.mountingId ?? input.rackingId,
    batteryId: primary.eq.batteryId ?? undefined,
    moduleCount: primary.modules,
    stringCount: input.stringCount,
    inverterCount: input.inverterCount,
    roofType: subMap.roof?.roofType ?? input.roofType,
  });

  complianceNotes.push(
    `Hybrid multi-system BOM: ${subs.map(s => `${s.key} = ${s.modules} module(s) · ${s.brand}${s.model ? ` ${s.model}` : ''} [${s.norm}]`).join('; ')}. ` +
    'Stages 1-3 derived per sub-system; service-side AC (Stage 4) sized once at the POI.'
  );

  // Addendum B ruling 1: trench may combine, raceways never do.
  const trenchSubs = subs.filter(s => s.key !== 'roof' && (s.eq.trenchRunLengthFt ?? 0) > 0 && s.modules > 0);
  if (trenchSubs.length > 1) {
    complianceNotes.push(
      'Trenching (Ray ruling 2026-07-12): ' + trenchSubs.map(s => `${s.key} ${s.eq.trenchRunLengthFt} ft`).join(' + ') +
      ' may share ONE combined trench, but each sub-system keeps its OWN conduit — shared raceways are not supported (no conductor-derating scenario in v1).'
    );
  }

  // Pre-scan: subs whose DC wiring is carried by real computed runs — their
  // Stage-2 env-length wire/conduit is skipped (single source, no double bill).
  const DC_RUN_IDS = new Set(['ROOF_RUN', 'DC_STRING_RUN', 'DC_DISCO_TO_INV_RUN']);
  const subsWithDcRuns = new Set<SubSystemKey>();
  for (const r of input.runs ?? []) {
    const sub = runSubOf(r);
    if (sub && DC_RUN_IDS.has(baseRunId(r)) && !r.isUtilityOwned) subsWithDcRuns.add(sub);
  }

  // ═══ Stages 1–3 — PER SUB-SYSTEM ═══════════════════════════════════════════
  for (const s of subs) {
    const { key, eq } = s;
    if (s.modules <= 0) {
      log.push({ stageId: 'array', category: 'sub_system', item: `${key} sub-system`, quantity: 0,
        derivedFrom: `subSystemCounts.${key} = 0 — equipment present but no modules; sub skipped`, formula: '0' });
      continue;
    }

    // ── Stage 1 — Array ──
    const panelEntry = eq.panelId ? getRegistryEntryV4(eq.panelId) : undefined;
    const panelDb = (!panelEntry && eq.panelId) ? getPanelById(eq.panelId) : undefined;
    if (panelEntry) {
      push(key, addItem('array', panelEntry.category, panelEntry.manufacturer, panelEntry.model,
        panelEntry.partNumber ?? panelEntry.id.toUpperCase(),
        `${panelEntry.electricalSpecs.watts ?? ''}W Solar Panel — ${key} sub-system`,
        s.modules, 'ea', 'NEC 690', `subSystemCounts.${key}`, 'modules', true));
      log.push({ stageId: 'array', category: 'solar_panel', item: `${panelEntry.manufacturer} ${panelEntry.model}`,
        quantity: s.modules, derivedFrom: `subSystemCounts.${key}`, formula: 'modules', necReference: 'NEC 690' });
    } else if (panelDb) {
      push(key, addItem('array', 'solar_panel', panelDb.manufacturer, panelDb.model,
        (panelDb as { partNumber?: string }).partNumber ?? panelDb.id.toUpperCase(),
        `${panelDb.watts}W Solar Panel — ${key} sub-system`,
        s.modules, 'ea', 'NEC 690', `subSystemCounts.${key}`, 'modules (equipment-db)', true));
      log.push({ stageId: 'array', category: 'solar_panel', item: `${panelDb.manufacturer} ${panelDb.model}`,
        quantity: s.modules, derivedFrom: `subSystemCounts.${key} (equipment-db fallback)`, formula: 'modules', necReference: 'NEC 690' });
    } else {
      push(key, addItem('array', 'solar_panel', 'TBD', 'Solar Panel (specify model)', 'PANEL-TBD',
        `Solar Panel — ${key} sub-system`, s.modules, 'ea', 'NEC 690', `subSystemCounts.${key}`, 'modules', true));
      warnings.push(`${key} sub-system has no resolvable panelId (${eq.panelId ?? 'none'}) — BOM shows a TBD panel line.`);
    }

    // Microinverter devices (this sub's own ecosystem).
    if (s.isMicro) {
      if (s.entry) {
        push(key, addItem('array', 'microinverter', s.entry.manufacturer, s.entry.model,
          s.entry.partNumber ?? s.entry.id,
          `Microinverter — ${s.entry.electricalSpecs.acOutputKw ?? ''}kW AC output — ${key} sub-system`,
          s.deviceCount, 'ea', 'NEC 690', `subSystemCounts.${key}`, 'ceil(panels/modulesPerDevice)', true));
        log.push({ stageId: 'array', category: 'microinverter', item: s.entry.model,
          quantity: s.deviceCount, derivedFrom: `subSystemCounts.${key}`, formula: 'ceil(panels/modulesPerDevice)', necReference: 'NEC 690' });
      } else if (s.microDb) {
        push(key, addItem('array', 'microinverter', s.microDb.manufacturer, s.microDb.model,
          (s.microDb as { partNumber?: string }).partNumber ?? s.microDb.id.toUpperCase(),
          `Microinverter — ${(s.microDb.acOutputW / 1000).toFixed(3)}kW AC output — ${key} sub-system`,
          s.deviceCount, 'ea', 'NEC 690', `subSystemCounts.${key}`, 'equipment-db fallback', true));
        log.push({ stageId: 'array', category: 'microinverter', item: `${s.microDb.manufacturer} ${s.microDb.model}`,
          quantity: s.deviceCount, derivedFrom: `subSystemCounts.${key} (equipment-db fallback)`, formula: 'ceil(panels/modulesPerDevice)', necReference: 'NEC 690' });
      }
    }

    // Optimizers (this sub's own MLPE — SolFence optimizer fence, SolarEdge…).
    const wantsOptimizer = s.norm === 'STRING_WITH_OPTIMIZER' || s.norm === 'HYBRID_INVERTER' || s.norm === 'DC_COUPLED_BATTERY';
    if (wantsOptimizer) {
      let optEntry = eq.optimizerId ? getRegistryEntryV4(eq.optimizerId) : undefined;
      if (optEntry && optEntry.category !== 'optimizer') optEntry = undefined; // v58.7 guard
      if (!optEntry && s.entry) {
        const acc = s.entry.requiredAccessories.find(a => a.category === 'optimizer');
        if (acc) {
          optEntry = EQUIPMENT_REGISTRY_V4.find(e => e.category === 'optimizer'
            && e.manufacturer === acc.defaultManufacturer
            && (e.partNumber === acc.defaultPartNumber || e.model?.includes(acc.defaultModel?.split(' ')[0] ?? '')));
        }
      }
      if (optEntry) {
        push(key, addItem('array', 'optimizer', optEntry.manufacturer, optEntry.model,
          optEntry.partNumber ?? optEntry.id, `DC Power Optimizer — 1 per module — ${key} sub-system`,
          s.modules, 'ea', 'NEC 690.8', `subSystemCounts.${key}`, 'modules', true));
        log.push({ stageId: 'array', category: 'optimizer', item: optEntry.model,
          quantity: s.modules, derivedFrom: `subSystemCounts.${key}`, formula: 'modules', necReference: 'NEC 690.8' });
      }
    }

    // ── Stage 4 — AC trunk / Q-Cable (this sub's own brand rules) ──
    // §13 (07-22): a micro sub's Q-Cable / AC trunk + terminators + sealing caps
    // are AC BRANCH-CIRCUIT equipment (Stage 4 — AC), consistent with the
    // single-system path — never filed under DC.
    if (s.isMicro) {
      const plan = s.trunkPlan;
      if (plan) {
        const { system, cable } = plan;
        const orientLabel = cable.orientation === 'fixed' ? '' : ` (${cable.orientation})`;
        push(key, addItem('ac', 'trunk_cable', system.brand, `${system.ecosystem}${orientLabel}`,
          cable.sku, `AC trunk — 1 drop per micro @ ${cable.connectorSpacingFt} ft pitch (≈${plan.approxFeet} ft), continuous per branch × ${plan.branchCount} — ${key} sub-system`,
          plan.dropCount, 'ea', 'NEC 690.31', `${key} sub-system: one connector-drop per device`, `${s.deviceCount} drops`, true));
        log.push({ stageId: 'ac', category: 'trunk_cable', item: `${system.ecosystem}${orientLabel}`,
          quantity: plan.dropCount, derivedFrom: `trunkCable resolver (${key} sub-system drops)`, formula: `${s.deviceCount} drops ≈ ${plan.approxFeet} ft`, necReference: 'NEC 690.31' });

        if (plan.splicePairs > 0) {
          push(key, addItem('ac', 'connector', system.brand, system.connectors.male.description,
            system.connectors.male.sku, `${system.connectors.male.description} — trunk jump (${plan.spliceBasis})`,
            plan.splicePairs, 'ea', 'NEC 690.31', plan.spliceBasis, `${plan.splicePairs}`, false));
          push(key, addItem('ac', 'connector', system.brand, system.connectors.female.description,
            system.connectors.female.sku, `${system.connectors.female.description} — trunk jump (${plan.spliceBasis})`,
            plan.splicePairs, 'ea', 'NEC 690.31', plan.spliceBasis, `${plan.splicePairs}`, false));
          log.push({ stageId: 'ac', category: 'connector', item: 'Field-wireable splice (M/F pair)',
            quantity: plan.splicePairs, derivedFrom: plan.spliceBasis, formula: `${plan.splicePairs}`, necReference: 'NEC 690.31' });
        }

        push(key, addItem('ac', 'terminator', system.brand, system.connectors.terminator.description,
          system.connectors.terminator.sku, `${system.connectors.terminator.description} — 1 per AC branch end — ${key} sub-system`,
          plan.terminators, 'ea', 'NEC 690.31', '1 per AC branch', `${plan.branchCount} branches`, true));
        log.push({ stageId: 'ac', category: 'terminator', item: system.connectors.terminator.description,
          quantity: plan.terminators, derivedFrom: `1 per AC branch (${key})`, formula: `${plan.branchCount}`, necReference: 'NEC 690.31' });

        if (system.connectors.sealingCap) {
          push(key, addItem('ac', 'sealing_cap', system.brand, system.connectors.sealingCap.description,
            system.connectors.sealingCap.sku, `${system.connectors.sealingCap.description} — service-loop unused drops (1 per AC branch) — ${key} sub-system`,
            plan.sealingCaps, 'ea', 'NEC 690.31', '1 per AC branch', `${plan.branchCount}`, false));
        }
      } else {
        // Unknown micro brand — generic AC trunk so the wire never silently vanishes.
        const genericSections = Math.ceil(s.deviceCount / 13);
        push(key, addItem('ac', 'trunk_cable', s.brand, 'AC Trunk Cable (brand TBD)',
          'TRUNK-TBD', `AC trunk cable — 1 drop per micro (${s.deviceCount} devices, ${key} sub-system, brand not in trunk catalog)`,
          s.deviceCount, 'ea', 'NEC 690.31', 'one drop per device', `${s.deviceCount}`, true));
        push(key, addItem('ac', 'terminator', s.brand, 'Trunk Terminator (brand TBD)',
          'TERM-TBD', 'Trunk terminator — 1 per AC branch end', genericSections, 'ea', 'NEC 690.31', '1 per AC branch', `${genericSections}`, true));
        log.push({ stageId: 'ac', category: 'trunk_cable', item: 'AC Trunk (brand TBD)',
          quantity: s.deviceCount, derivedFrom: `generic fallback (${s.brand} not in trunkCable catalog)`, formula: `${s.deviceCount}`, necReference: 'NEC 690.31' });
      }
    } else if (!subsWithDcRuns.has(key)) {
      // String/optimizer/hybrid DC home run from this sub's own env lengths.
      const dcGauge = input.dcWireGauge ?? '#10 AWG';
      const dcLen = eq.env?.wireLengthFt ?? input.dcWireLength ?? 50;
      const condType = (eq.env?.conduitType ?? input.conduitType ?? 'EMT') as string;
      const condSize = input.conduitSizeInch ?? '3/4';
      const dcWireQty = conduitLength(dcLen * 2); // 2 conductors (+ and −)
      push(key, addItem('dc', 'wire', 'Southwire', `${dcGauge} USE-2 PV Wire`,
        `USE2-${dcGauge.replace('#', '').replace(' AWG', '')}`,
        `${dcGauge} USE-2 PV Wire — DC home run (${key} sub-system)`,
        dcWireQty, 'ft', 'NEC 690.31', `${key}.env.wireLengthFt × 2 × 1.15`, `${dcLen} × 2 × 1.15`, true));
      log.push({ stageId: 'dc', category: 'wire', item: `${dcGauge} USE-2 (${key})`,
        quantity: dcWireQty, derivedFrom: `${key} DC home run × 2 conductors × 1.15 fitting`, formula: 'wireLengthFt * 2 * 1.15', necReference: 'NEC 690.31' });

      // Buried trench portion (ground/fence) — underground PVC; above-ground
      // remainder keeps the sub's conduit type. SEPARATE raceway per sub.
      const trenchFt = key !== 'roof' ? Math.max(0, Math.min(eq.trenchRunLengthFt ?? 0, dcLen)) : 0;
      const aboveFt = Math.max(0, dcLen - trenchFt);
      if (aboveFt > 0) {
        push(key, addItem('dc', 'conduit', 'Generic', `${condSize}" ${condType} Conduit`,
          `${condType}-${condSize.replace('/', '-')}`,
          `${condSize}" ${condType} conduit — DC home run (${key} sub-system)`,
          conduitLength(aboveFt), 'ft', 'NEC 690.31', `${key} above-ground DC × 1.15`, `${aboveFt} × 1.15`, true));
      }
      if (trenchFt > 0) {
        push(key, addItem('dc', 'conduit', 'Cantex', `${condSize}" PVC Sch 40 — Underground`,
          `PVC40-${condSize.replace('/', '-')}`,
          `${condSize}" PVC Sch 40 underground conduit — buried DC trench run, ${key} sub-system (NEC 300.5, min 18" burial)`,
          conduitLength(trenchFt), 'ft', 'NEC 300.5', `${key}.trenchRunLengthFt × 1.15`, `${trenchFt} × 1.15`, true));
      }

      if (input.requiresDCDisconnect !== false) {
        const dcDiscAmps = nextStandardBreaker(input.dcOCPD > 0 ? input.dcOCPD : 30);
        push(key, addItem('dc', 'disconnect', 'Square D', `${dcDiscAmps}A DC Disconnect`,
          `DU${dcDiscAmps}RB`, `${dcDiscAmps}A DC disconnect switch per NEC 690.15 — ${key} sub-system`,
          1, 'ea', 'NEC 690.15', `${key} sub-system inverter`, '1', true));
        log.push({ stageId: 'dc', category: 'dc_disconnect', item: `${dcDiscAmps}A DC Disconnect (${key})`,
          quantity: 1, derivedFrom: `${key} sub-system inverter`, formula: '1', necReference: 'NEC 690.15' });
      }
    } else if (input.requiresDCDisconnect !== false) {
      // DC wiring carried by computed runs (emitted in the aggregate pass) —
      // the sub still owns its DC disconnect.
      const dcDiscAmps = nextStandardBreaker(input.dcOCPD > 0 ? input.dcOCPD : 30);
      push(key, addItem('dc', 'disconnect', 'Square D', `${dcDiscAmps}A DC Disconnect`,
        `DU${dcDiscAmps}RB`, `${dcDiscAmps}A DC disconnect switch per NEC 690.15 — ${key} sub-system`,
        1, 'ea', 'NEC 690.15', `${key} sub-system inverter`, '1', true));
    }

    // ── RSD — NEC 690.12 scopes to BUILDINGS: only the roof sub can require it,
    //    and the requirement keys on the ROOF sub's OWN inverter capability. ──
    if (key === 'roof') {
      const rsdIntegrated = s.entry?.electricalSpecs?.rapidShutdownCompliant
        ?? (s.microDb ? true : false);
      if (input.requiresRapidShutdown === false) {
        // AHJ opt-out — nothing to add.
      } else if ((s.isMicro && rsdIntegrated) || (!s.entry && s.microDb)) {
        complianceNotes.push(`NEC 690.12: Rapid shutdown integrated in ${s.model ?? 'roof microinverters'} — 0 add-on devices (roof sub-system)`);
      } else if (s.norm === 'STRING_WITH_OPTIMIZER') {
        complianceNotes.push('NEC 690.12: Rapid shutdown integrated in optimizers — 0 add-on devices (roof sub-system)');
      } else if (rsdIntegrated) {
        complianceNotes.push(`NEC 690.12: Rapid shutdown integrated in ${s.model ?? 'roof inverter'} — 0 add-on devices (roof sub-system)`);
      } else {
        push('roof', addItem('dc', 'rapid_shutdown', 'Tigo', 'TS4-A-F Rapid Shutdown', 'TS4-A-F',
          'Rapid shutdown device per NEC 690.12 — 1 per ON-BUILDING module (roof sub-system)',
          s.modules, 'ea', 'NEC 690.12', 'roof sub-system modules', `${s.modules} on-building`, true));
        log.push({ stageId: 'dc', category: 'rapid_shutdown', item: 'TS4-A-F',
          quantity: s.modules, derivedFrom: 'roof sub-system modules (own inverter lacks integrated RSD)', formula: `${s.modules} on-building`, necReference: 'NEC 690.12' });
        complianceNotes.push(`NEC 690.12: Rapid shutdown devices added — 1 per on-building module (${s.modules}, roof sub-system)`);
      }
    } else {
      complianceNotes.push(`NEC 690.12(B)(2): ${key} sub-system (${s.modules} modules) exempt — not on/in a building`);
    }

    // ── Stage 3 — Inverter / storage (this sub's own ecosystem) ──
    if (!s.isMicro) {
      if (s.entry) {
        push(key, addItem('inverter', s.entry.category, s.entry.manufacturer, s.entry.model,
          s.entry.partNumber ?? s.entry.id,
          `${s.entry.electricalSpecs.acOutputKw ?? ''}kW ${s.entry.category === 'string_inverter' ? 'String Inverter' : 'Inverter'} — ${key} sub-system`,
          1, 'ea', 'NEC 690', `${key} sub-system`, '1 per sub-system', true));
        log.push({ stageId: 'inverter', category: s.entry.category, item: s.entry.model,
          quantity: 1, derivedFrom: `${key} sub-system`, formula: '1', necReference: 'NEC 690' });
      } else if (s.invDb) {
        push(key, addItem('inverter', 'string_inverter', s.invDb.manufacturer, s.invDb.model,
          (s.invDb as { partNumber?: string }).partNumber ?? s.invDb.id.toUpperCase(),
          `${s.invDb.acOutputKw ?? ''}kW String Inverter — ${key} sub-system`,
          1, 'ea', 'NEC 690', `${key} sub-system (equipment-db)`, '1 per sub-system', true));
        log.push({ stageId: 'inverter', category: 'string_inverter', item: `${s.invDb.manufacturer} ${s.invDb.model}`,
          quantity: 1, derivedFrom: `${key} sub-system (equipment-db fallback)`, formula: '1', necReference: 'NEC 690' });
      } else {
        // Neither registry hit — but the sub HAS a string/optimizer topology, so
        // its inverter must still appear on the schedule (a permit BOM that omits
        // the ground/fence inverter is worse than a brand-only "specify model"
        // line). Emit a TBD inverter under the sub's ecosystem brand rather than
        // dropping it — mirrors the Stage-1 TBD-panel behavior.
        const invCat = s.norm === 'STRING_WITH_OPTIMIZER' ? 'string_inverter' : 'string_inverter';
        push(key, addItem('inverter', invCat, s.brand, 'Inverter (specify model)', 'INV-TBD',
          `${s.norm === 'STRING_WITH_OPTIMIZER' ? 'Optimizer-string' : 'String'} inverter — ${key} sub-system (model unresolved — verify equipment id)`,
          1, 'ea', 'NEC 690', `${key} sub-system`, '1 per sub-system', true));
        log.push({ stageId: 'inverter', category: invCat, item: `${s.brand} Inverter (TBD)`,
          quantity: 1, derivedFrom: `${key} sub-system (id unresolved)`, formula: '1', necReference: 'NEC 690' });
        warnings.push(`${key} sub-system has no resolvable inverterId (${eq.inverterId ?? 'none'}) — emitted a brand-only TBD inverter line.`);
      }
    }

    // Battery (per sub — batteryKwhPerUnit is per-unit by contract).
    if (eq.batteryId) {
      const batteryEntry = getRegistryEntryV4(eq.batteryId);
      if (batteryEntry) {
        const batQty = eq.batteryCount && eq.batteryCount > 1 ? eq.batteryCount : 1;
        push(key, addItem('inverter', 'battery', batteryEntry.manufacturer, batteryEntry.model,
          batteryEntry.partNumber ?? batteryEntry.id,
          `Battery Storage System — ${key} sub-system${eq.batteryKwhPerUnit ? ` (${eq.batteryKwhPerUnit} kWh/unit)` : ''}`,
          batQty, 'ea', 'NEC 706', `${key}.batteryCount`, String(batQty), true));
        log.push({ stageId: 'inverter', category: 'battery', item: batteryEntry.model,
          quantity: batQty, derivedFrom: `${key}.batteryCount`, formula: String(batQty), necReference: 'NEC 706' });
      }
    }

    // Array junction / transition box (micro subs — open-air trunk → conduit).
    if (s.isMicro) {
      let jbQty = 0;
      if (input.runs && input.runs.length > 0) {
        jbQty = input.runs.filter(r => {
          const sub = runSubOf(r) ?? 'roof';
          return sub === key && (r.to === 'JUNCTION BOX' || r.to === 'AC COMBINER' || r.to === 'COMBINER');
        }).length;
      }
      if (jbQty === 0) jbQty = Math.ceil(s.deviceCount / 16);
      if (jbQty > 0) {
        push(key, addItem('ac', 'junction_box', 'Soladeck', 'PV Junction Box',
          '0786-41', `Flashed PV junction box — transitions open-air PV wire to conduit (${key} sub-system)`,
          jbQty, 'ea', 'NEC 690.31', `${key} runSegments / ceil(deviceCount/16)`, 'ceil(deviceCount/16)', true));
        complianceNotes.push(`NEC 690.31: ${jbQty} junction box(es) — ${key} sub-system open-air PV wire to conduit`);
      }
    }

    // Per-sub monitoring accessory (e.g. EcoFlow PowerOcean Monitoring Gateway).
    const monAcc = s.entry?.requiredAccessories.find(a => a.category === 'monitoring');
    if (monAcc) {
      push(key, addItem('monitoring', 'monitoring',
        monAcc.defaultManufacturer ?? s.brand, monAcc.defaultModel ?? 'Monitoring System',
        monAcc.defaultPartNumber ?? 'MON-TBD',
        `${monAcc.description} — ${key} sub-system`, 1, 'ea',
        monAcc.necReference ?? 'NEC 690.4', `${key} sub-system`, '1', false));
    }

    // SolarEdge RS485 (optimizer ecosystems) — per sub, its own inverter count (1).
    if (s.entry && s.entry.manufacturer === 'SolarEdge' && wantsOptimizer) {
      push(key, addItem('monitoring', 'communication_cable', 'SolarEdge', 'RS485 Communication Cable',
        'SE-RS485-10FT', `RS485 communication cable — inverter to gateway (${key} sub-system)`,
        1, 'ea', 'NEC 690.4', `${key} sub-system inverter`, '1', true));
    }
  }

  // ═══ Integrated BOS — per BRAND GROUP with the group's REAL branch count ═══
  const microSubs = subs.filter(s => s.isMicro && s.deviceCount > 0);
  const brandGroups = new Map<string, SubGenCtx[]>();
  for (const s of microSubs) {
    const k = s.brand.toLowerCase();
    brandGroups.set(k, [...(brandGroups.get(k) ?? []), s]);
  }
  for (const [, group] of brandGroups) {
    const branchCount = group.reduce((n, s) => n + (s.trunkPlan?.branchCount ?? Math.max(1, Math.ceil(s.deviceCount / 13))), 0);
    const totalDevices = group.reduce((n, s) => n + s.deviceCount, 0);
    const stamp: BOMSystemType | undefined = group.length === 1 ? group[0].key : undefined;
    const plan = resolveIntegratedEquipment({
      inverterManufacturer: group[0].brand,
      inverterModel: group[0].model ?? '',
      isMicro: true,
      totalDevices,
      branchCount, // REAL summed branch count (legacy passed hardcoded 0)
      hasBattery: group.some(s => !!s.eq.batteryId || (s.eq.batteryCount ?? 0) > 0),
    });
    if (plan.branchSlotWarning) warnings.push(plan.branchSlotWarning);
    const emitted = new Set<string>();
    if (plan.hasIntegratedGateway) emitted.add('gateway');
    for (const d of plan.devices) {
      const cat = d.kind === 'gateway' ? 'gateway' : 'combiner';
      emitted.add(cat);
      push(stamp, addItem(cat === 'gateway' ? 'monitoring' : 'inverter', cat, d.brand, d.model,
        d.partNumber ?? '—', `Integrated ${d.roleSummary} — ${group[0].brand} ecosystem (${branchCount} AC branch(es))`,
        1, 'ea', (d.necRefs && d.necRefs[0]) ?? 'NEC 690.4', 'integrated-bos (per brand group)', `branches=${branchCount}`, true));
      log.push({ stageId: cat === 'gateway' ? 'monitoring' : 'inverter', category: cat, item: d.model,
        quantity: 1, derivedFrom: `integrated-bos resolver (${group[0].brand} group, ${branchCount} branches)`, formula: '1', necReference: (d.necRefs && d.necRefs[0]) });
    }
    // Fallbacks from the group's inverter accessories when nothing integrated.
    const entry0 = group[0].entry;
    if (!emitted.has('gateway')) {
      const acc = entry0?.requiredAccessories.find(a => a.category === 'gateway');
      if (acc) {
        push(stamp, addItem('monitoring', 'gateway', acc.defaultManufacturer ?? 'TBD',
          acc.defaultModel ?? 'Gateway', acc.defaultPartNumber ?? 'GW-TBD',
          `Communication/monitoring gateway — ${group[0].brand} ecosystem`, 1, 'ea',
          acc.necReference ?? 'NEC 690.4', 'per brand group', '1', true));
      }
    }
    if (!emitted.has('combiner')) {
      const acc = entry0?.requiredAccessories.find(a => a.category === 'combiner');
      if (acc) {
        push(stamp, addItem('inverter', 'combiner', acc.defaultManufacturer ?? 'TBD',
          acc.defaultModel ?? 'AC Combiner', acc.defaultPartNumber ?? 'COMB-TBD',
          `AC branch combiner — ${group[0].brand} ecosystem (${branchCount} branch(es))`, 1, 'ea',
          acc.necReference ?? 'NEC 690.4', 'per brand group', '1', true));
      }
    }
  }

  // Non-micro ecosystems that need their own gateway (optimizer / hybrid).
  for (const s of subs) {
    if (s.isMicro || s.modules <= 0) continue;
    const needsGw = s.norm === 'STRING_WITH_OPTIMIZER' || s.norm === 'HYBRID_INVERTER' || s.norm === 'DC_COUPLED_BATTERY';
    if (!needsGw) continue;
    const acc = s.entry?.requiredAccessories.find(a => a.category === 'gateway');
    if (acc) {
      push(s.key, addItem('monitoring', 'gateway', acc.defaultManufacturer ?? 'TBD',
        acc.defaultModel ?? 'Gateway', acc.defaultPartNumber ?? 'GW-TBD',
        `Communication/monitoring gateway — ${s.key} sub-system`, 1, 'ea',
        acc.necReference ?? 'NEC 690.4', `${s.key} sub-system`, '1', true));
    }
  }

  // ═══ Project-level backup gear (generator / ATS / BUI) — ONCE ══════════════
  if (input.generatorId) {
    const gen = getGeneratorById(input.generatorId);
    if (gen) {
      push(undefined, addItem('inverter', 'generator', gen.manufacturer, gen.model,
        input.generatorId.toUpperCase(),
        `Standby Generator — ${gen.ratedOutputKw}kW / ${gen.fuelType.replace('_', ' ')} / ${gen.outputBreakerA}A output breaker`,
        1, 'ea', 'NEC 702', 'perSystem', '1', true));
    }
  } else if (input.generatorKw && input.generatorKw > 0) {
    push(undefined, addItem('inverter', 'generator', 'TBD', `${input.generatorKw}kW Standby Generator`,
      'GEN-TBD', `Standby Generator — ${input.generatorKw}kW — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702', 'perSystem', '1', true));
  }
  if (input.atsId) {
    const ats = getATSById(input.atsId);
    if (ats) {
      push(undefined, addItem('inverter', 'ats', ats.manufacturer, ats.model,
        input.atsId.toUpperCase(),
        `Automatic Transfer Switch — ${ats.ampRating}A / ${ats.voltageV}V${ats.serviceEntranceRated ? ' — Service Entrance Rated' : ''}`,
        1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
    }
  } else if (input.atsAmpRating && input.atsAmpRating > 0) {
    push(undefined, addItem('inverter', 'ats', 'TBD', `${input.atsAmpRating}A Automatic Transfer Switch`,
      'ATS-TBD', `Automatic Transfer Switch — ${input.atsAmpRating}A — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
  }
  if (input.backupInterfaceId) {
    const bui = getBackupInterfaceById(input.backupInterfaceId);
    if (bui) {
      const isIQSC3 = bui.model?.toLowerCase().includes('sc3') || bui.model?.toLowerCase().includes('system controller 3');
      push(undefined, addItem('inverter', 'backup_interface', bui.manufacturer, bui.model,
        input.backupInterfaceId.toUpperCase(),
        `Backup Interface Unit${isIQSC3 ? ' / ATS (Service Entrance Rated)' : ''} — ${bui.maxContinuousOutputA}A / 240V`,
        1, 'ea', isIQSC3 ? 'NEC 706 / NEC 230.82' : 'NEC 706', 'perSystem', '1', true));
    }
  } else if (input.backupInterfaceMaxA && input.backupInterfaceMaxA > 0) {
    push(undefined, addItem('inverter', 'backup_interface', 'TBD', `${input.backupInterfaceMaxA}A Backup Interface Unit`,
      'BUI-TBD', `Backup Interface Unit — ${input.backupInterfaceMaxA}A / 240V — NEC 706`,
      1, 'ea', 'NEC 706', 'perSystem', '1', true));
  }
  if (input.generatorId && input.generatorWireLength && input.generatorWireLength > 0) {
    const gen = getGeneratorById(input.generatorId);
    const gauge = gen?.outputWireGaugeMin ?? '#6 AWG';
    const ft = Math.ceil(input.generatorWireLength * 1.15);
    const unitCost = 1.85;
    push(undefined, addItem('inverter', 'wire', 'Generic', gauge, `WHIP-${gauge.replace(/\s|#/g, '')}`,
      `Generator-to-ATS whip cable, ${gauge} THWN-2`, ft, 'ft', 'NEC 702.4, NEC 215',
      `config.generatorWireLength = ${input.generatorWireLength} ft × 1.15 fitting allowance`,
      `${input.generatorWireLength} ft × 1.15 = ${ft} ft`, true, undefined, unitCost, ft * unitCost));
  }

  // ═══ Stage 4 — service-side AC, emitted ONCE from aggregate values ═════════
  // (Invariant I-6: exactly one emission of shared wire/conduit/fittings/
  //  disconnect/POI gear regardless of N.)

  if (input.runs && input.runs.length > 0) {
    const allBomRuns = input.runs.filter(r => !r.isUtilityOwned);
    // W4a — ROOF_RUN is the micro module→microinverter connection = the module's
    // FACTORY leads/MC4 connectors (string roofs use DC_STRING_RUN), never a
    // field-run DC conductor. Exclude it from bulk DC-wire emission (gate 6);
    // real DC string segments (DC_STRING_RUN / DC_DISCO_TO_INV_RUN) still emit.
    const dcBomRuns = allBomRuns.filter(r => DC_RUN_IDS.has(baseRunId(r)) && baseRunId(r) !== 'ROOF_RUN');
    const acBomRuns = allBomRuns.filter(r => !DC_RUN_IDS.has(baseRunId(r)));

    // DC runs — grouped per (owning sub, gauge); stamped when the sub is known.
    if (dcBomRuns.length > 0) {
      const dcGaugeMap = new Map<string, { sub: SubSystemKey | undefined; gauge: string; qty: number; runIds: string[] }>();
      const addDc = (sub: SubSystemKey | undefined, gauge: string, qty: number, runId: string) => {
        const k = `${sub ?? ''}|${gauge}`;
        const existing = dcGaugeMap.get(k);
        if (existing) {
          existing.qty += qty;
          if (!existing.runIds.includes(runId)) existing.runIds.push(runId);
        } else {
          dcGaugeMap.set(k, { sub, gauge, qty, runIds: [runId] });
        }
      };
      for (const r of dcBomRuns) {
        const sub = runSubOf(r) ?? (subMap.roof ? 'roof' : undefined);
        const gauge: string = r.wireGauge ?? '#10 AWG';
        const egcGauge: string = r.egcGauge ?? '#10 AWG';
        const conductors: number = r.conductorCount ?? 2;
        const length: number = r.onewayLengthFt ?? 30;
        addDc(sub, gauge, Math.ceil(length * conductors * 1.15), String(r.id));
        addDc(sub, egcGauge, Math.ceil(length * 1 * 1.15), String(r.id));
      }
      for (const { sub, gauge, qty, runIds } of dcGaugeMap.values()) {
        const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
        push(sub, addItem('dc', 'wire', 'Southwire', `${gauge} USE-2/THWN-2`,
          `USE2-${gaugeNum}`,
          `${gauge} USE-2 — DC wiring (${runIds.join(', ')})${sub ? ` — ${sub} sub-system` : ''}`,
          qty, 'ft', 'NEC 690.31', 'Sum(length x conductors x 1.15)', `${gauge} DC runs x 1.15`, true));
        log.push({ stageId: 'dc', category: 'wire', item: `${gauge} USE-2${sub ? ` (${sub})` : ''}`,
          quantity: qty, derivedFrom: runIds.join(', '), formula: 'Sum(length x conductors x 1.15)', necReference: 'NEC 690.31' });
      }
    }

    // §5 — AC circuit conductors from the ACTUAL route segments (open-air Q-Cable
    // excluded / billed as trunk cable; hots scale by conductorsPerCircuit ×
    // sharedCircuitCount; the shared EGC is one per raceway; hots and EGCs are
    // SEPARATE rows — no undifferentiated "AC wiring" merge).
    {
      const _ac = emitAcConductorBom(acBomRuns);
      _branchWireReconciliation = _ac.evidence;
      for (const it of _ac.items) {
        push(undefined, it);
        log.push({ stageId: 'ac', category: 'wire', item: it.model,
          quantity: it.quantity, derivedFrom: it.formula, formula: it.derivedFrom, necReference: it.necReference });
      }
    }

    // §6/§7 — conduit + fittings PER PHYSICAL RACEWAY (no "— all runs"; the shared
    // branch home-run counted ONCE; each raceway cites its OWN NEC article).
    {
      const _raceways = derivePhysicalRacewaysFromRuns(allBomRuns);
      _physicalRaceways = _raceways;
      for (const rw of _raceways) {
        for (const it of emitRacewayConduitBom(rw)) push(undefined, it);
        log.push({ stageId: 'ac', category: 'conduit', item: `${rw.sizeIn}" ${rw.racewayType} (${rw.physicalRacewayId})`,
          quantity: rw.lengthFt, derivedFrom: rw.segmentIds.join(', '),
          formula: `${rw.physicalRacewayId}: Σ segment length × ${_WASTE}`, necReference: `NEC ${rw.necArticle}` });
      }
    }
  } else {
    // No runs provided — flat aggregate AC home run (legacy fallback shape).
    const resolvedAcWireGauge = input.acWireGauge ?? '#8 AWG';
    const resolvedConduitSize = input.conduitSizeInch ?? '3/4';
    const acWireQty = conduitLength(input.acWireLength * 4);
    const acConduitQty = conduitLength(input.acWireLength);
    push(undefined, addItem('ac', 'wire', 'Southwire', `${resolvedAcWireGauge} THWN-2`,
      `THWN2-${resolvedAcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${resolvedAcWireGauge} THWN-2 — AC home run (3 CC + 1 EGC = 4 conductors)`,
      acWireQty, 'ft', 'NEC 310.15 / 250.122', 'acWireLength x 4 x 1.15', `${input.acWireLength} x 4 x 1.15`, true));
    push(undefined, addItem('ac', 'conduit', 'Generic', `${resolvedConduitSize}" ${input.conduitType} Conduit`,
      `${input.conduitType}-${resolvedConduitSize.replace('/', '-')}`,
      `${resolvedConduitSize}" ${input.conduitType} conduit — AC home run`,
      acConduitQty, 'ft', 'NEC 358', 'acWireLength x 1.15', `${input.acWireLength} x 1.15`, true));
  }

  // Conduit fittings — FLAT FALLBACK ONLY (no runs). When runs are present the
  // §6 per-physical-raceway pass already emitted each raceway's own conduit +
  // fittings (labeled with its physicalRacewayId, citing its raceway-type NEC
  // article) — running this project-level roll-up too would double-bill fittings.
  if (!(input.runs && input.runs.length > 0)) {
    const totalConduitFt = (() => {
      // env-based: AC home run + each string sub's DC raceway footage.
      return conduitLength(input.acWireLength)
        + subs.filter(s => !s.isMicro && s.modules > 0 && !subsWithDcRuns.has(s.key))
            .reduce((sum, s) => sum + conduitLength(s.eq.env?.wireLengthFt ?? input.dcWireLength ?? 50), 0);
    })();
    const conduitType = input.conduitType ?? 'EMT';
    const conduitSize = input.conduitSizeInch ?? '3/4';
    const connQty = Math.max(2, Math.ceil(totalConduitFt / 10));
    push(undefined, addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Connector`,
      `${conduitType}-CONN-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} set-screw connector — NEC 300.15`,
      connQty, 'ea', 'NEC 300.15 / 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));
    const couplingQty = Math.max(1, Math.ceil(totalConduitFt / 10));
    push(undefined, addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Coupling`,
      `${conduitType}-COUP-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} coupling — joins conduit sticks`,
      couplingQty, 'ea', 'NEC 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));
    const bushingQty = Math.max(2, Math.ceil(totalConduitFt / 50) * 2);
    push(undefined, addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" Insulated Bushing`,
      `BUSH-INS-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" insulated throat bushing — protects conductors at conduit end per NEC 300.15`,
      bushingQty, 'ea', 'NEC 300.15', 'ceil(totalConduitFt/50)*2', `ceil(${totalConduitFt}/50)*2`, true));
    const strapQty = Math.max(2, Math.ceil(totalConduitFt / 10));
    push(undefined, addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} One-Hole Strap`,
      `${conduitType}-STRAP-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} one-hole strap — NEC 358.30 support every 10 ft`,
      strapQty, 'ea', 'NEC 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));
    log.push({ stageId: 'ac', category: 'conduit_fitting', item: 'Conduit Fittings Set',
      quantity: connQty + couplingQty + bushingQty + strapQty, derivedFrom: 'totalConduitFt',
      formula: 'connectors + couplings + bushings + straps derived from total conduit footage',
      necReference: 'NEC 300.15 / 358.30' });
  }

  const interconMethod = String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
  const isSupplySideTap = interconMethod === 'SUPPLY_SIDE_TAP' ||
    interconMethod.includes('SUPPLY_SIDE') ||
    interconMethod.includes('LINE_SIDE') ||
    interconMethod.includes('LINE_TAP');

  // AC disconnect — ONE combined disconnect for the whole system (NEC 690.14),
  // sized from the AGGREGATE AC nameplate.
  if (input.requiresACDisconnect !== false) {
    const acVoltage = input.acVoltage ?? 240;
    const acContCurrent = ((input.acOutputKw ?? input.systemKw) * 1000) / acVoltage;
    const acRequiredAmps = acContCurrent * 1.25;
    const isFusedDisc = isSupplySideTap;
    // Standard sizes — single-sourced from lib/electrical/stdSizes.ts
    // (P0-5c/P2-2; was the second in-file copy of the fuse/enclosure ladders).
    const nextFuse = (a: number) => nextStandardOcpd(a);
    // Stage D — single-source the system disconnect to E-1: when the hybrid AC
    // collection supplies a Σ-backfeed rating, size BOTH the enclosure AND the
    // supply-side fuse to it. The fuse previously kept the AC-kW basis, which
    // goes stale on hybrids: Stowell's legacy 19.39 kW total → 110A fuses
    // inside the 200A disco while E-1 printed a 200A tap OCPD, and 110A is
    // undersized for the 190A source-OCPD sum (verify-lead, 2026-07-18). The
    // tap OCPD must carry the Σ of source backfeeds — NEC 705.11/705.12(B).
    const _targetDiscA = input.systemAcDisconnectA;
    const fuseAmps = isFusedDisc ? nextFuse(_targetDiscA ?? acRequiredAmps) : null;
    const enclosureRequirement = isFusedDisc
      ? (fuseAmps ?? acRequiredAmps)
      : (_targetDiscA ?? acRequiredAmps);
    const acDiscAmps = nextEnclosure(enclosureRequirement);
    const fusedPartNumMap: Record<number, string> = { 30: 'DPF221RP', 60: 'DPF222RP', 100: 'DPF222RB', 200: 'DPF224RB' };
    const acDiscPartNum = isFusedDisc ? (fusedPartNumMap[acDiscAmps] ?? `DPF-${acDiscAmps}A`) : `DU${acDiscAmps}RB`;
    const acDiscMfr = isFusedDisc ? 'Eaton' : 'Square D';
    const discTypeLabel = isFusedDisc ? 'Fusible' : 'Non-Fusible';
    push(undefined, addItem('ac', 'disconnect', acDiscMfr,
      `${acDiscAmps}A ${discTypeLabel} AC Disconnect`, acDiscPartNum,
      `${acDiscAmps}A ${discTypeLabel} AC disconnect — NEC 690.14` +
        (isFusedDisc ? ` / NEC 705.11 supply-side (fuse: ${fuseAmps}A)` : ' / NEC 705.12 load-side'),
      1, 'ea', 'NEC 690.14',
      _targetDiscA && !isFusedDisc ? 'hybrid AC collection (Σ backfeed OCPD — matches E-1)' : 'perSystem (aggregate of all sub-systems)',
      _targetDiscA && !isFusedDisc
        ? `Σ source backfeed OCPD = ${_targetDiscA}A → ${acDiscAmps}A enclosure (matches E-1)`
        : `nextEnclosure(${acRequiredAmps.toFixed(1)}A × 1.25) = ${acDiscAmps}A`, true));
    if (isFusedDisc && fuseAmps !== null) {
      push(undefined, addItem('ac', 'fuse', 'Littelfuse', `${fuseAmps}A Class RK5 Fuse`,
        `LLNRK${fuseAmps}SP`, `${fuseAmps}A 250V Class RK5 time-delay fuse — 2 per fused disconnect (NEC 690.9)`,
        2, 'ea', 'NEC 690.9', 'perSystem', '2 per fused disconnect', true));
    }
    log.push({ stageId: 'ac', category: 'ac_disconnect', item: `${acDiscAmps}A ${discTypeLabel} AC Disconnect`,
      quantity: 1, derivedFrom: 'perSystem (aggregate)',
      formula: `nextEnclosure(${acContCurrent.toFixed(1)}A × 1.25 = ${acRequiredAmps.toFixed(1)}A) = ${acDiscAmps}A enclosure`,
      necReference: 'NEC 690.14' });
    complianceNotes.push(
      `NEC 690.14 / NEC 705.60: 1× ${acDiscAmps}A ${discTypeLabel} disconnect — ` +
      (_targetDiscA && !isFusedDisc
        ? `Σ per-source backfeed OCPD = ${_targetDiscA}A → ${acDiscAmps}A enclosure (single system disconnect after the shared AC combiner panel — matches E-1)`
        : `${acContCurrent.toFixed(1)}A aggregate output × 1.25 = ${acRequiredAmps.toFixed(1)}A → ${acDiscAmps}A enclosure`) +
      (isFusedDisc ? ` + ${fuseAmps}A fuse (NEC 705.11 supply-side)` : ' (NEC 705.12 load-side)')
    );
  }

  // POI — backfeed breaker / supply-side tap hardware, ONCE from aggregate.
  const isLoadSide = interconMethod === 'LOAD_SIDE' ||
    interconMethod === 'BACKFED_BREAKER' ||
    (interconMethod.includes('BACKFED') && !interconMethod.includes('SUPPLY')) ||
    (interconMethod.includes('LOAD') && !interconMethod.includes('SUPPLY'));
  const isMainBreakerDerate = interconMethod === 'MAIN_BREAKER_DERATE';
  const isPanelUpgrade = interconMethod === 'PANEL_UPGRADE';
  if (isLoadSide) {
    const busRating = input.panelBusRating ?? input.mainPanelAmps ?? 200;
    const mainAmps = input.mainPanelAmps ?? 200;
    const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
    const derivedBackfeedAmps = (input.backfeedAmps ?? 0) > 0
      ? input.backfeedAmps
      : ((input.acOutputKw ?? input.systemKw) * 1000 / (input.acVoltage ?? 240)) * 1.25;
    const requestedBreaker = nextStandardBreaker(derivedBackfeedAmps);
    const backfeedAmps = Math.min(requestedBreaker, maxPVBreaker);
    if (requestedBreaker > maxPVBreaker) {
      warnings.push(
        `NEC 705.12(B) VIOLATION: Requested ${requestedBreaker}A backfeed exceeds 120% max (${maxPVBreaker}A) ` +
        `for ${busRating}A bus / ${mainAmps}A main. ` +
        `BOM capped to ${backfeedAmps}A — use SUPPLY_SIDE_TAP (NEC 705.11) to use full ${requestedBreaker}A.`
      );
    }
    push(undefined, addItem('ac', 'breaker', 'Square D', `${backfeedAmps}A Backfeed Breaker`,
      `QO${backfeedAmps}`,
      `${backfeedAmps}A 2-pole backfeed breaker — NEC 705.12(B) load-side (bus: ${busRating}A, max: ${maxPVBreaker}A)`,
      1, 'ea', 'NEC 705.12(B)', 'perSystem (aggregate of all sub-systems)', '1', true));
    complianceNotes.push(
      `NEC 705.12(B): Backfeed breaker ${backfeedAmps}A — 120% rule: (${busRating}A × 1.2) − ${mainAmps}A = ${maxPVBreaker}A max`
    );
  } else if (isSupplySideTap) {
    push(undefined, addItem('ac', 'connector', 'NSI Polaris',
      'Insulated Multi-Tap Connector (350 kcmil–#6)', 'IPLD350-3',
      'Polaris-style insulated tap connector — supply-side tap of service-entrance conductor (1 per conductor: L1/L2/N). Verify lug range against actual service conductor size.',
      3, 'ea', 'NEC 705.11(C)', 'perSystem (supply-side tap)', 'L1+L2+N = 3', true));
    complianceNotes.push(
      'NEC 705.11: Supply-side tap — no backfed breaker in load center. ' +
      'Connection is utility-side (before main breaker) via insulated multi-tap connectors; ' +
      'tap conductors terminate in the fused disconnect (OCPD) per 705.11(C).'
    );
  } else if (isMainBreakerDerate) {
    complianceNotes.push('NEC 705.12(B)(3): Main breaker derate — main OCPD derated to allow PV backfeed. No dedicated backfed breaker in BOM.');
  } else if (isPanelUpgrade) {
    complianceNotes.push('NEC 705.12(B): Panel upgrade — new load center with sufficient headroom. No dedicated backfed breaker required.');
  }

  if (input.requiresProductionMeter) {
    push(undefined, addItem('ac', 'meter', 'Itron', 'Production Meter',
      'ITRON-PROD-1', 'Revenue-grade production meter', 1, 'ea', 'NEC 690.4', 'perSystem', '1', false));
  }

  // ═══ Stage 5 — structural (roof racking from the ROOF sub's mountingId) ════
  // Ground/fence structural stays route-owned (bom-system-profiles) — unchanged.
  const roofSub = subs.find(s => s.key === 'roof');
  const roofModules = roofSub ? roofSub.modules : 0;
  const roofRackingId = subMap.roof?.mountingId ?? input.rackingId;
  const rackingEntry = roofRackingId ? getRegistryEntryV4(roofRackingId) : undefined;
  const _roofRB = (input.rackingBOM && roofModules > 0) ? input.rackingBOM : undefined;
  const roofStrings = (() => {
    if (roofModules <= 0) return 0;
    if (input.roofStringCount && input.roofStringCount > 0) return Math.ceil(input.roofStringCount);
    return input.rowCount
      ?? (input.railSections > 0 ? Math.max(1, Math.round(input.railSections / 2)) : Math.max(1, Math.ceil(roofModules / 4)));
  })();

  if (!rackingEntry && _roofRB) {
    push('roof', addItem('structural', 'racking', _roofRB.manufacturer, _roofRB.systemModel,
      _roofRB.mounts.partNumber ?? _roofRB.systemModel,
      `${_roofRB.manufacturer} ${_roofRB.systemModel} mounting system — quantities per structural analysis (PV-4C)`,
      1, 'lot', 'UL 2703', 'perSystem', '1', true));
    push('roof', addItem('structural', 'attachment', _roofRB.manufacturer,
      _roofRB.mounts.description, _roofRB.mounts.partNumber ?? 'TBD', _roofRB.mounts.description,
      Math.ceil(_roofRB.mounts.qty), 'ea', 'ASCE 7-22', 'structuralEngine.rackingBOM', 'calcRackingBOM', true));
    emitRackingBOMInto(items, log, _roofRB, _roofRB.manufacturer, 'roof');
  } else if (rackingEntry && roofModules <= 0) {
    log.push({ stageId: 'structural', category: 'racking', item: rackingEntry.model,
      quantity: 0, derivedFrom: 'no roof sub-system modules — roof racking suppressed',
      formula: '0', necReference: rackingEntry.iccEsReport });
  } else if (rackingEntry) {
    const suppressRail = RAIL_LESS_ROOF_RACKING.has(rackingEntry.id) && !_roofRB;
    push('roof', addItem('structural', 'racking', rackingEntry.manufacturer, rackingEntry.model,
      rackingEntry.partNumber ?? rackingEntry.id,
      `${rackingEntry.manufacturer} ${rackingEntry.model} — ${suppressRail ? 'rail-less' : (rackingEntry.structuralSpecs?.requiresRail ? 'rail-based' : 'rail-less')} mount`,
      1, 'lot', rackingEntry.iccEsReport ?? 'UL 2703', 'perSystem (roof sub-system)', '1', true));
    if (_roofRB) {
      emitRackingBOMInto(items, log, _roofRB, rackingEntry.manufacturer, 'roof');
    } else {
      for (const acc of rackingEntry.requiredAccessories) {
        if (suppressRail && RAIL_FORMULA_CATEGORIES.has(acc.category)) {
          log.push({ stageId: 'structural', category: acc.category,
            item: acc.defaultModel ?? acc.description, quantity: 0,
            derivedFrom: `suppressed — ${rackingEntry.id} is rail-less (pads include the attachment)`,
            formula: '0', necReference: acc.necReference });
          continue;
        }
        if (acc.conditional) {
          const conditionMet = evaluateConditionBOM(acc.conditional, subMap.roof?.roofType ?? input.roofType);
          if (!conditionMet) continue;
        }
        let qty = 1;
        if (acc.quantityRule === 'formula' && acc.quantityFormula) {
          qty = evaluateQuantityFormulaV4(acc.quantityFormula, {
            modules: roofModules,
            strings: roofStrings,
            inverters: roofSub?.isMicro ? roofSub.deviceCount : 1,
            branches: roofStrings,
            railSections: input.railSections,
            attachments: input.attachmentCount,
            systemKw: input.systemKw,
          });
        } else if (acc.quantityRule === 'perModule') {
          qty = roofModules;
        } else if (acc.quantityRule === 'perString') {
          qty = roofStrings;
        } else if (acc.quantityRule === 'perAttachment') {
          qty = input.attachmentCount;
        } else if (acc.quantityRule === 'perSystem') {
          qty = 1;
        }
        if (acc.quantityMultiplier) qty *= acc.quantityMultiplier;
        qty = Math.ceil(qty);
        if (qty > 0) {
          push('roof', addItem('structural', acc.category,
            acc.defaultManufacturer ?? rackingEntry.manufacturer,
            acc.defaultModel ?? acc.description,
            acc.defaultPartNumber ?? 'TBD', acc.description,
            qty, 'ea', acc.necReference ?? 'UL 2703',
            acc.quantityFormula ?? acc.quantityRule,
            acc.quantityFormula ?? acc.quantityRule, acc.required));
          log.push({ stageId: 'structural', category: acc.category,
            item: acc.defaultModel ?? acc.description, quantity: qty,
            derivedFrom: `${acc.quantityFormula ?? acc.quantityRule} (roof sub-system basis)`,
            formula: acc.quantityFormula ?? acc.quantityRule, necReference: acc.necReference });
        }
      }
    }
  }

  // Grounding electrode system — shared service infrastructure, ONCE.
  {
    const egcLength = conduitLength(input.acWireLength);
    const ocpdForEgc = input.acOCPD > 0 ? input.acOCPD : nextStandardBreaker(
      ((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25
    );
    const egcGauge = ocpdForEgc <= 60 ? '#10 AWG' : ocpdForEgc <= 100 ? '#8 AWG' : '#6 AWG';
    // §5 closeout — the flat acWireLength×1.15 EGC row is the design-studio
    // fallback only. When sized runs exist, emitAcConductorBom already emits the
    // per-raceway shared green EGC (NEC 250.122(C)); this line would double-bill.
    if (!(input.runs && input.runs.length > 0)) {
      push(undefined, addItem('structural', 'wire', 'Southwire', `${egcGauge} THWN-2 Green EGC`,
        `THWN2-GRN-${egcGauge.replace('#', '').replace(' AWG', '')}`,
        `${egcGauge} green THWN-2 equipment grounding conductor — NEC 250.122`,
        egcLength, 'ft', 'NEC 690.43 / 250.122', 'acWireLength × 1.15', `${input.acWireLength} × 1.15`, true));
    }
    push(undefined, addItem('structural', 'grounding', 'Erico/Harger', '5/8" × 8 ft Copper-Clad Ground Rod',
      'GR-5/8-8', '5/8" × 8 ft copper-clad steel ground rod — NEC 250.52(A)(5)',
      1, 'ea', 'NEC 250.52(A)(5)', 'perSystem', '1', true));
    push(undefined, addItem('structural', 'grounding', 'Erico/Harger', '5/8" Ground Rod Acorn Clamp',
      'GRC-5/8', '5/8" ground rod acorn clamp — bonds GEC to ground rod per NEC 250.70',
      1, 'ea', 'NEC 250.70', 'perSystem', '1', true));
    const gecOcpd = input.acOCPD > 0 ? input.acOCPD
      : nextStandardBreaker(((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25);
    const gecGauge = gecOcpd <= 60 ? '#6 AWG' : gecOcpd <= 100 ? '#4 AWG' : '#2 AWG';
    push(undefined, addItem('structural', 'wire', 'Southwire', `${gecGauge} Bare Copper GEC`,
      `BARE-CU-${gecGauge.replace('#', '').replace(' AWG', '')}`,
      `${gecGauge} bare copper grounding electrode conductor — NEC 250.66`,
      50, 'ft', 'NEC 250.66', 'perSystem', '50', true));
    complianceNotes.push(
      `NEC 250.52(A)(5): 5/8"×8ft copper-clad ground rod + acorn clamp + ${gecGauge} GEC (50ft) required`
    );
  }

  // ═══ Stage 7 — labels (one POI ⇒ one label set) ════════════════════════════
  if (input.requiresWarningLabels !== false) {
    push(undefined, addItem('labels', 'label', 'HellermannTyton', 'DC Conductor Label Set',
      'LABEL-DC-SET', 'DC conductor warning labels per NEC 690.31',
      input.stringCount * 2, 'ea', 'NEC 690.31', 'stringCount × 2', 'strings * 2', true));
    push(undefined, addItem('labels', 'label', 'HellermannTyton', 'PV System Warning Label',
      'LABEL-PV-WARN', 'PV system warning label per NEC 690.54',
      1, 'ea', 'NEC 690.54', 'perSystem', '1', true));
    if (input.requiresRapidShutdown !== false && roofModules > 0) {
      push(undefined, addItem('labels', 'label', 'HellermannTyton', 'Rapid Shutdown Label',
        'LABEL-RSD', 'Rapid shutdown label per NEC 690.56',
        1, 'ea', 'NEC 690.56', 'perSystem (roof sub-system present)', '1', true));
    }
    if (interconMethod === 'SUPPLY_SIDE_TAP') {
      push(undefined, addItem('labels', 'label', 'HellermannTyton', 'Supply-Side Tap POI Label',
        'LABEL-SST', 'Point-of-interconnection label per NEC 705.10 (supply-side tap, NEC 705.11)',
        1, 'ea', 'NEC 705.10', 'perSystem', '1', true));
    } else {
      push(undefined, addItem('labels', 'label', 'HellermannTyton', 'Backfeed Breaker Label',
        'LABEL-BF', 'Backfeed breaker label per NEC 705.12',
        1, 'ea', 'NEC 705.12', 'perSystem', '1', true));
    }
    const dcDiscCount = subs.filter(s => !s.isMicro && s.modules > 0).length;
    const discLabelQty = (input.requiresACDisconnect !== false ? 1 : 0)
      + (input.requiresDCDisconnect !== false ? dcDiscCount : 0) + 1; // +1 = POI
    push(undefined, addItem('labels', 'label', 'HellermannTyton', 'Disconnecting Means Label',
      'LABEL-DISC', 'Disconnecting means label per NEC 690.13',
      discLabelQty, 'ea', 'NEC 690.13', 'disconnecting means (AC disco + per-sub DC discos + POI)', 'AC disco + DC discos + POI', true));
  }

  // ═══ Truck stock — spares PER PRESENT BRAND GROUP (genericized) ════════════
  if (input.includeTruckStock !== false) {
    const stringSubs = subs.filter(s => !s.isMicro && s.modules > 0);
    const _tsConduitFt = Math.ceil((input.acWireLength ?? 60) * 1.15)
      + stringSubs.reduce((sum, s) => sum + Math.ceil((s.eq.env?.wireLengthFt ?? input.dcWireLength ?? 50) * 1.15), 0);
    const _tsAttach = input.attachmentCount ?? 0;
    const ts = (sub: BOMSystemType | undefined, category: string, mfr: string, model: string, pn: string, desc: string, qty: number, basis: string) => {
      if (qty <= 0) return;
      push(sub, addItem('truck_stock', category, mfr, model, pn,
        `${desc} — recommended truck stock (not installed qty)`,
        Math.ceil(qty), 'ea', 'BEST PRACTICE', `truck stock: ${basis}`, basis, false));
      log.push({ stageId: 'truck_stock', category, item: model, quantity: Math.ceil(qty),
        derivedFrom: `truck stock: ${basis}`, formula: basis, necReference: 'BEST PRACTICE' });
    };

    ts(undefined, 'conduit_body', 'Generic', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} LB Conduit Body`, `LB-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'LB pull elbow (back access)', 2, '2 per job');
    ts(undefined, 'conduit_body', 'Generic', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} LR Conduit Body`, `LR-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'LR pull elbow (right access)', 2, '2 per job');
    ts(undefined, 'conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} Coupling (extra)`, `EMT-COUP-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare couplings', Math.max(3, _tsConduitFt * 0.10 / 10), 'max(3, 10% of couplings)');
    ts(undefined, 'conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" ${input.conduitType ?? 'EMT'} Connector (extra)`, `EMT-CONN-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare box connectors', Math.max(4, _tsConduitFt * 0.10 / 10), 'max(4, 10% of connectors)');
    ts(undefined, 'conduit_fitting', 'Raco/Allied', `${input.conduitSizeInch ?? '3/4'}" One-Hole Straps (extra)`, `EMT-STRAP-X-${(input.conduitSizeInch ?? '3/4').replace('/', '-')}`,
      'Spare straps', Math.max(5, _tsConduitFt * 0.15 / 10), 'max(5, 15% of straps)');
    ts(undefined, 'consumable', 'Ideal/Wago', 'Wire Connector Assortment (winged + lever)', 'WIRENUT-ASST',
      'Wire nuts / Wago levers, assorted', 1, '1 assortment per job');
    if (isSupplySideTap) {
      ts(undefined, 'connector', 'NSI Polaris', 'Insulated Multi-Tap Connector (spare)', 'IPLD350-3',
        'Spare Polaris tap (drop/strip mistakes are one-way)', 1, 'supply-side: 1 spare');
    }

    // Micro trunk spares — one set PER PRESENT BRAND GROUP, using THAT brand's
    // connector hardware (kills the legacy Enphase-only Q-CONN assumption).
    for (const [, group] of brandGroups) {
      const sys = group[0].trunkPlan?.system;
      if (!sys) continue;
      const stamp: BOMSystemType | undefined = group.length === 1 ? group[0].key : undefined;
      const branches = group.reduce((n, s) => n + (s.trunkPlan?.branchCount ?? 0), 0);
      ts(stamp, 'connector', sys.brand, `${sys.connectors.male.description} (spare)`, sys.connectors.male.sku,
        'Spare trunk field splice, male', 1, `${sys.brand} micro: 1 spare`);
      ts(stamp, 'connector', sys.brand, `${sys.connectors.female.description} (spare)`, sys.connectors.female.sku,
        'Spare trunk field splice, female', 1, `${sys.brand} micro: 1 spare`);
      if (sys.connectors.sealingCap) {
        ts(stamp, 'sealing_cap', sys.brand, `${sys.connectors.sealingCap.description} (spares)`, sys.connectors.sealingCap.sku,
          'Spare sealing caps for unused/opened drops', Math.max(2, branches), 'max(2, 1 per branch)');
      }
      ts(stamp, 'terminator', sys.brand, `${sys.connectors.terminator.description} (spare)`, sys.connectors.terminator.sku,
        'Spare branch terminator (single-use part)', 1, `${sys.brand} micro: 1 spare`);
    }

    if (_tsAttach > 0 && roofModules > 0) {
      ts('roof', 'lag_bolt', 'Generic', 'Structural Lag/Screw (extras)', 'LAG-X',
        'Spare lags for split rafters / misses', Math.max(6, _tsAttach * 0.05), 'max(6, 5% of lags)');
      ts('roof', 'consumable', 'Chemlink/Geocel', 'Roof Sealant Tube', 'SEALANT-TUBE',
        'Roof-rated sealant', Math.max(2, _tsAttach / 20), '1 tube per ~20 penetrations (min 2)');
    }
    ts(undefined, 'breaker', 'Square D', `${input.acOCPD || 20}A 2-Pole Breaker (spare)`, `QO${input.acOCPD || 20}-SPARE`,
      'Spare OCPD matching the PV breaker', 1, '1 spare');
  }

  // ═══ Suggested tools — once, from the union of job contexts ════════════════
  if (input.includeSuggestedTools !== false) {
    const anyMicro = microSubs.length > 0;
    const _railBased = !!(rackingEntry?.structuralSpecs?.requiresRail
      ?? ((input.rackingBOM?.rails?.qty ?? 0) > 0 || input.railSections > 0));
    const _tools = resolveSuggestedTools({
      isRailBased: _railBased,
      rackingBrand: input.rackingBOM?.manufacturer ?? rackingEntry?.manufacturer,
      isMicro: anyMicro,
      microBrand: microSubs[0]?.brand,
      conduitType: input.conduitType,
      isSupplySideTap,
      hasRoofAttachments: (input.attachmentCount ?? 0) > 0 && roofModules > 0,
      hasWirePull: (input.acWireLength ?? 0) > 0,
    });
    for (const t of _tools) {
      push(undefined, addItem('tools', 'tool', t.manufacturer ?? '—', t.tool,
        t.partNumber ?? '—', `${t.use}${t.why ? ` — ${t.why}` : ''}`,
        1, 'ea', t.why?.includes('NEC') ? 'NEC 110.14(D)' : 'BEST PRACTICE',
        'suggested tools (job-specific)', 'per job', false));
    }
    if (_tools.length > 0) {
      log.push({ stageId: 'tools', category: 'tool', item: 'Suggested tool set',
        quantity: _tools.length, derivedFrom: 'job context (racking/topology/conduit/interconnection)',
        formula: 'resolveSuggestedTools', necReference: 'BEST PRACTICE' });
    }
  }

  // ── Build stage results ────────────────────────────────────────────────────
  const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
  for (const item of items) {
    if (!stageMap.has(item.stageId)) stageMap.set(item.stageId, []);
    stageMap.get(item.stageId)!.push(item);
  }
  const stages: BOMStageResult[] = (Object.keys(STAGE_LABELS) as BOMStageId[]).map(id => ({
    id,
    label: STAGE_LABELS[id],
    order: STAGE_ORDER[id],
    items: stageMap.get(id) ?? [],
    itemCount: stageMap.get(id)?.length ?? 0,
  })).sort((a, b) => a.order - b.order);

  return {
    items,
    stages,
    totalLineItems: items.length,
    generatedAt: new Date().toISOString(),
    topology: topoResult.topology,
    topologyLabel: topoResult.label,
    derivationLog: log,
    warnings,
    complianceNotes,
    ...(_branchWireReconciliation ? { branchWireReconciliation: _branchWireReconciliation } : {}),
    ...(_physicalRaceways ? { physicalRaceways: _physicalRaceways } : {}),
  };
}

// ─── Helper: Add Item ─────────────────────────────────────────────────────────

function addItem(
  stageId: BOMStageId,
  category: string,
  manufacturer: string,
  model: string,
  partNumber: string,
  description: string,
  quantity: number,
  unit: BOMLineItemV4['unit'],
  necReference: string,
  derivedFrom: string,
  formula: string,
  required: boolean,
  notes?: string,
  unitCost?: number,
  totalCost?: number,
  /** Wave 2c: owning sub-system — set ONLY by sub-scoped emission contexts.
   *  Conditionally spread so legacy lines stay byte-identical when serialized. */
  subSystem?: BOMSystemType
): BOMLineItemV4 {
  return {
    id: nextId(),
    stageId,
    stageLabel: STAGE_LABELS[stageId],
    category,
    manufacturer,
    model,
    partNumber,
    description,
    quantity: Math.max(0, Math.ceil(quantity)),
    unit,
    necReference,
    derivedFrom,
    formula,
    required,
    notes,
    unitCost,
    totalCost,
    ...(subSystem !== undefined ? { subSystem } : {}),
  };
}

// ─── Helper: Evaluate Conditional ────────────────────────────────────────────

function evaluateConditionBOM(condition: string, roofType: string): boolean {
  const parts = condition.split('||').map(p => p.trim());
  return parts.some(part => {
    const match = part.match(/roofType\s*===\s*(\w+)/);
    if (match) return roofType === match[1];
    return false;
  });
}

// ─── BOM Export Helpers ───────────────────────────────────────────────────────

export function bomToCSV(result: BOMGenerationResultV4): string {
  const header = ['Stage', 'Category', 'Manufacturer', 'Model', 'Part Number', 'Description', 'Qty', 'Unit', 'NEC Ref', 'Required', 'Derived From'];
  const rows = result.items.map(item => [
    item.stageLabel,
    item.category,
    item.manufacturer,
    item.model,
    item.partNumber,
    item.description,
    String(item.quantity),
    item.unit,
    item.necReference ?? '',
    item.required ? 'Yes' : 'No',
    item.derivedFrom,
  ]);
  return [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
}

export function bomToMarkdown(result: BOMGenerationResultV4): string {
  const lines: string[] = [
    `# Bill of Materials`,
    `**Topology:** ${result.topologyLabel}`,
    `**Generated:** ${new Date(result.generatedAt).toLocaleString()}`,
    `**Total Line Items:** ${result.totalLineItems}`,
    '',
  ];

  for (const stage of result.stages) {
    if (stage.items.length === 0) continue;
    lines.push(`## ${stage.label}`);
    lines.push('');
    lines.push('| # | Manufacturer | Model | Part Number | Description | Qty | Unit | NEC Ref |');
    lines.push('|---|---|---|---|---|---|---|---|');
    stage.items.forEach((item, i) => {
      lines.push(`| ${i + 1} | ${item.manufacturer} | ${item.model} | ${item.partNumber} | ${item.description} | ${item.quantity} | ${item.unit} | ${item.necReference ?? ''} |`);
    });
    lines.push('');
  }

  if (result.complianceNotes.length > 0) {
    lines.push('## Compliance Notes');
    result.complianceNotes.forEach(note => lines.push(`- ${note}`));
    lines.push('');
  }

  return lines.join('\n');
}