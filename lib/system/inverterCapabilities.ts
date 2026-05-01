// ============================================================================
// lib/system/inverterCapabilities.ts — CORE ENGINEERING BRAIN — Phase 1
//
// CANONICAL CAPABILITY PROFILE TYPES
//
// This module defines the ground-truth type system for the new layout solver.
// It is the single source of truth for what an inverter CAN do (CapabilityProfile)
// and what a solved layout LOOKS LIKE (LayoutCandidate).
//
// DESIGN PRINCIPLES:
//   • Pure types — no logic, no I/O, no side-effects.
//   • Topology-agnostic at the type level; topology is a discriminant field.
//   • LayoutCandidate is self-describing: every field needed for BOM, SLD,
//     interconnection, and permit is present without further lookups.
//   • CapabilityProfile is derived from equipment-db + brand rules; it is
//     NOT a replacement for BrandProfile — it is a refined, solver-ready
//     view of the constraints the solver needs to reason about.
//   • Both types are plain serialisable objects (no class instances, no
//     circular refs) so they can cross React server/client boundaries safely.
//
// RELATIONSHIPS:
//   BrandProfile (brandProfiles/types.ts)
//     └─ drives ─► CapabilityProfile (this file) — solver-ready constraints
//                    └─ used by ─► layoutCandidateGenerator.ts → LayoutCandidate[]
//                                  └─ scored by ─► layoutScoring.ts
//                                                    └─ selected ─► sizeSystemFromBrand()
//
// NOT A REPLACEMENT for:
//   • BrandProfile — the full brand configuration system remains.
//   • BrandInverterModelRef — the lightweight equipment-db reference remains.
//   • FeasibilityEvaluator — electrical hard-gate remains. CapabilityProfile
//     encodes the same constraints in a more solver-friendly shape.
// ============================================================================

import type { TopologyFamily } from './brandProfiles/types';

// ─── Re-export topology so callers don't need two imports ───────────────────
export type { TopologyFamily };

// ─── Inverter Topology (discriminant for capability rules) ──────────────────

/**
 * The electrical topology discriminant used by the layout solver.
 * Matches TopologyFamily but made explicit here to avoid coupling.
 *
 * - 'string'    : plain series strings, no per-module electronics (Fronius, SMA)
 * - 'optimizer' : DC optimizers regulate string voltage/current (SolarEdge)
 * - 'micro'     : AC module approach, one micro per panel (Enphase)
 * - 'hybrid'    : string inverter with integrated battery port
 */
export type InverterTopology = 'string' | 'optimizer' | 'micro' | 'hybrid';

// ─── MPPT Channel Specification ─────────────────────────────────────────────

/**
 * Electrical specification for a single MPPT channel on a string/optimizer
 * inverter. Micro topology inverters do not have MPPT channels.
 */
export interface MpptChannelSpec {
  /** Maximum DC input voltage this channel accepts (V). NEC clamp point. */
  maxDcVoltage: number;
  /** Minimum MPPT operating voltage (V). */
  mpptVoltageMin: number;
  /** Maximum MPPT operating voltage (V). */
  mpptVoltageMax: number;
  /**
   * Maximum DC input current for this MPPT channel (A).
   * For optimizer topology: regulator caps this to optimizerMaxOutputCurrent
   * per string × maxParallelStringsPerMppt.
   * For string topology: design current = panelIsc × 1.25 × parallelStrings.
   */
  maxInputCurrentPerMppt: number;
  /**
   * Maximum number of parallel strings allowed on this MPPT channel.
   * Default: 2 (residential norm per NEC 690.8).
   */
  maxParallelStringsPerMppt: number;
  /**
   * Minimum number of panels per series string on this MPPT channel.
   * Driven by mpptVoltageMin / panelVmp at worst-case temperature.
   */
  minPanelsPerString: number;
  /**
   * Maximum number of panels per series string on this MPPT channel.
   * Driven by maxDcVoltage / (panelVoc × NEC cold-temp correction factor).
   * For optimizer topology: driven by optimizer bus voltage cap instead.
   */
  maxPanelsPerString: number;
}

// ─── Branch Circuit Specification (Micro topology only) ─────────────────────

/**
 * AC branch circuit constraints for micro-inverter systems.
 * Replaces MPPT channel specs for 'micro' topology.
 */
export interface BranchCircuitSpec {
  /**
   * Maximum number of micro-inverters per AC branch circuit.
   * Driven by the branch breaker ampacity and micro AC output current.
   * Typical: IQ8+ on 20A branch → 16 units (NEC 80% rule).
   */
  maxMicrosPerBranch: number;
  /**
   * AC output current per micro-inverter unit (A).
   * Used to compute branch loading and OCPD sizing.
   */
  acOutputCurrentPerUnit: number;
  /**
   * AC output voltage (V). Typically 240V split-phase in North America.
   */
  acOutputVoltage: number;
  /**
   * Number of panels served per micro unit.
   * 1 for IQ8+/IQ8M (single panel), 2 for IQ8A (dual-panel variant).
   */
  modulesPerDevice: number;
}

// ─── CapabilityProfile ───────────────────────────────────────────────────────

/**
 * CapabilityProfile — solver-ready summary of what one inverter MODEL can do.
 *
 * Created once per model at startup by brandCapabilities/*.ts files.
 * The layout solver reads ONLY CapabilityProfiles — it never touches
 * BrandProfile directly.
 *
 * Key difference from BrandInverterModelRef:
 *   - ModelRef is a lightweight ID + kW reference for the sizing tier lookup.
 *   - CapabilityProfile is a complete electrical + design-rule object the
 *     solver needs to reason about string lengths, MPPT allocation, branch
 *     circuits, and DC/AC ratios without further lookups.
 */
export interface CapabilityProfile {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Equipment-db canonical id (e.g. 'se-11400h', 'enphase-iq8plus'). */
  equipmentDbId: string;
  /** Human-readable model name (e.g. 'SE11400H-US', 'IQ8+'). */
  modelName: string;
  /** Brand id (e.g. 'solaredge', 'enphase', 'sma', 'fronius'). */
  brandId: string;
  /** Brand display name (e.g. 'SolarEdge', 'Enphase'). */
  brandDisplayName: string;
  /** Electrical topology driving all solver rules. */
  topology: InverterTopology;

  // ── AC / DC Ratings ───────────────────────────────────────────────────────
  /** Nominal AC output power (kW). */
  acKw: number;
  /** Maximum DC input power (kW). */
  dcKwMax: number;
  /**
   * Allowed DC/AC oversizing ratio range.
   * Solver only recommends configs where dcKw/acKw is within [min, max].
   * Source: brand engineering rules + NEC 690.11 / UL 1741 clipping limits.
   */
  dcAcRatioRange: { min: number; max: number };
  /**
   * Ideal DC/AC ratio target for scoring.
   * Configs closest to this value score highest on the ratio component.
   * Typically 1.25 for residential installs (matches PREFERRED_DC_AC_RATIO_TARGET).
   */
  dcAcRatioTarget: number;

  // ── Topology-specific electrical specs ────────────────────────────────────
  /**
   * MPPT channels. Length = mpptCount.
   * Present for 'string', 'optimizer', 'hybrid' topologies.
   * Empty array for 'micro' topology.
   */
  mpptChannels: MpptChannelSpec[];

  /**
   * Branch circuit spec.
   * Present for 'micro' topology only.
   * null for string/optimizer/hybrid.
   */
  branchCircuit: BranchCircuitSpec | null;

  // ── String design rules (string/optimizer/hybrid) ─────────────────────────
  /**
   * For optimizer topology: the maximum regulated output current (A) from
   * each optimizer module. This is the design current per string for
   * NEC 690.8(A)(2) instead of panel Isc × 1.25.
   * Null for string/hybrid topology and micro.
   */
  optimizerMaxOutputCurrent: number | null;

  /**
   * For optimizer topology: the nominal DC bus voltage (V) the inverter
   * holds. Used to compute operating current (stringPower / busVoltage).
   * Null for string/hybrid topology and micro.
   */
  optimizerBusVoltage: number | null;

  // ── Capability flags ──────────────────────────────────────────────────────
  /** True if the model supports integrated battery storage. */
  batteryCapable: boolean;
  /**
   * True if the model requires a battery to operate
   * (e.g. EcoFlow off-grid hybrid).
   */
  batteryRequired: boolean;

  // ── Metadata ──────────────────────────────────────────────────────────────
  /**
   * Source version tag so audit logs can trace which data revision
   * produced a given recommendation.
   */
  dataVersion: string;
  /** Optional notes for engineering review. */
  notes?: string;
}

// ─── String Layout Plan ──────────────────────────────────────────────────────

/**
 * A concrete string wiring plan produced by the layout solver for one
 * LayoutCandidate. Describes exactly how panels are distributed across
 * MPPT channels and parallel strings.
 *
 * Used directly by:
 *   - SLD generator (string count per MPPT)
 *   - Interconnection engine (conductor sizing per string current)
 *   - BOM (DC combiner qty = max parallel strings on any MPPT)
 *   - Validation engine (Voc/Vmp checks per string)
 */
export interface StringLayoutPlan {
  /**
   * Per-MPPT channel allocation.
   * Index i corresponds to MPPT channel i (0-based).
   */
  mpptAllocations: Array<{
    /** MPPT channel index (0-based). */
    mpptIndex: number;
    /** Number of parallel strings on this MPPT. */
    parallelStrings: number;
    /** Panels per series string on this MPPT. */
    panelsPerString: number;
    /** Total panels on this MPPT = parallelStrings × panelsPerString. */
    totalPanels: number;
    /** Computed open-circuit string voltage (V) at design min temp. */
    stringVoc?: number;
    /** Computed minimum power-point string voltage (V) at design max temp. */
    stringVmpMin?: number;
  }>;
  /** Total panels across all MPPT channels for this inverter unit. */
  totalPanels: number;
  /** True if all strings are equal length (preferred for production). */
  stringsAreBalanced: boolean;
}

// ─── Branch Layout Plan (Micro topology) ────────────────────────────────────

/**
 * A concrete branch circuit plan for micro-inverter systems.
 * Describes how micro units are distributed across AC branch circuits.
 */
export interface BranchLayoutPlan {
  /** Number of AC branch circuits. */
  branchCount: number;
  /** Micro units per branch (array length = branchCount). */
  unitsPerBranch: number[];
  /** Total micro units across all branches. */
  totalUnits: number;
  /** Panels served per branch (= units × modulesPerDevice). */
  panelsPerBranch: number[];
  /** Branch OCPD size (A). Computed: max(unitsPerBranch) × acOutputCurrentPerUnit / 0.8. */
  branchOcpdAmps: number;
  /** True if all branches have equal unit count. */
  branchesAreBalanced: boolean;
}

// ─── LayoutCandidate ─────────────────────────────────────────────────────────

/**
 * LayoutCandidate — a complete, self-describing, electrically-valid system
 * layout produced by generateLayoutCandidates().
 *
 * CONTRACT:
 *   • Every LayoutCandidate has already passed all electrical hard-gates.
 *   • The solver NEVER returns an infeasible candidate.
 *   • All fields are populated — callers never need to re-derive values.
 *   • Candidates are immutable once produced (treat as value objects).
 *
 * DOWNSTREAM CONSUMERS:
 *   - layoutScoring.ts: scores and selects the best candidate
 *   - sizeSystemFromBrand(): extracts inverter/string config
 *   - sizingToBom.ts: consumes bos + stringLayout/branchLayout
 *   - interconnection engine: consumes stringLayout for conductor sizing
 *   - SLD generator: consumes stringLayout for diagram
 *   - ValidationPanel: shows "Why this inverter" explanation
 *   - EngineeringTruth: stores selectedCandidate on project
 */
export interface LayoutCandidate {
  // ── Identity ──────────────────────────────────────────────────────────────
  /**
   * Stable unique key for this candidate configuration.
   * Format: '{equipmentDbId}×{qty}@{dcAcRatio.toFixed(2)}'
   * Example: 'se-11400h×1@1.26', 'enphase-iq8plus×30@1.03'
   */
  key: string;

  // ── Inverter selection ────────────────────────────────────────────────────
  /** The capability profile driving this candidate. */
  profile: CapabilityProfile;
  /** Number of inverter units in this candidate. */
  inverterQty: number;
  /** Total AC output across all inverter units (kW). */
  totalAcKw: number;

  // ── System sizing ─────────────────────────────────────────────────────────
  /** Total DC power of the panel array (kW). */
  totalDcKw: number;
  /** Panel count served by this candidate. */
  panelCount: number;
  /** Individual panel wattage (W). */
  panelWattage: number;
  /**
   * DC/AC ratio for this candidate: totalDcKw / totalAcKw.
   * Pre-computed and always present.
   */
  dcAcRatio: number;

  // ── String/branch layout ──────────────────────────────────────────────────
  /**
   * Concrete string wiring plan.
   * Present for string/optimizer/hybrid topology.
   * null for micro topology.
   */
  stringLayout: StringLayoutPlan | null;

  /**
   * Concrete branch circuit plan.
   * Present for micro topology.
   * null for string/optimizer/hybrid.
   */
  branchLayout: BranchLayoutPlan | null;

  // ── Electrical validation results ─────────────────────────────────────────
  /**
   * True if this candidate passed ALL hard electrical gates:
   *   - String Voc ≤ inverter maxDcVoltage (NEC 690.7)
   *   - String Voc ≥ mpptVoltageMin at design max temp
   *   - Per-MPPT design current ≤ maxInputCurrentPerMppt
   *   - DC/AC ratio within dcAcRatioRange
   * Always true for candidates returned by the solver (infeasible
   * candidates are filtered out before being returned).
   */
  feasible: boolean;
  /**
   * Validation notes about this candidate.
   * Empty for fully clean candidates; may contain informational
   * messages (e.g. 'Strings balanced: 2×13 on MPPT1').
   */
  validationNotes: string[];

  // ── Scoring ───────────────────────────────────────────────────────────────
  /**
   * Composite solver score (higher = better).
   * Set by layoutScoring.ts after calling scoreLayoutCandidate().
   * 0 before scoring.
   */
  score: number;
  /**
   * Score component breakdown for UI transparency ("Why this inverter?").
   * Set by layoutScoring.ts after calling scoreLayoutCandidate().
   */
  scoreBreakdown: ScoreBreakdown | null;

  // ── Bill of materials hints ───────────────────────────────────────────────
  /**
   * BOS (balance-of-system) items implied by this candidate.
   * The BOM engine reads these instead of deriving them from the brand profile
   * so that candidate-specific choices (e.g. DC combiner only when parallel
   * strings > 1) are captured correctly.
   */
  bos: BosHint[];

  // ── Engineering provenance ────────────────────────────────────────────────
  /**
   * Human-readable explanation of why this candidate was selected.
   * Generated by layoutScoring.ts; shown in the "Why this inverter?" panel.
   */
  selectionRationale: string;
  /**
   * The generator version that produced this candidate.
   * Used for cache invalidation and audit logging.
   */
  generatorVersion: string;
}

// ─── Score Breakdown ─────────────────────────────────────────────────────────

/**
 * Decomposed scoring result for a single LayoutCandidate.
 * Shown in the UI to explain the recommendation.
 */
export interface ScoreBreakdown {
  /** Total composite score. */
  total: number;
  /**
   * DC/AC ratio fitness score (0–40 points).
   * Maximum at dcAcRatioTarget (1.25); decays linearly outside ideal band.
   */
  dcAcRatioScore: number;
  /**
   * Simplicity score (0–25 points).
   * Prefers fewer inverter units; 25 points for 1 unit, 15 for 2, etc.
   */
  simplicityScore: number;
  /**
   * String balance score (0–20 points).
   * Maximum when all strings are equal length.
   */
  stringBalanceScore: number;
  /**
   * Economic score (0–15 points).
   * Prefers configurations with lower expected installed cost
   * (fewer, larger inverters beat many small ones at equal functionality).
   */
  economicScore: number;
  /**
   * Penalty applied when candidate is non-ideal.
   * Typical penalties: below-floor ratio (−30), unbalanced strings (−5),
   * mixed models (−8), infeasibility violation (−50).
   */
  penalty: number;
}

// ─── BOS Hint ────────────────────────────────────────────────────────────────

/**
 * A single Bill-of-System item hint emitted by the layout solver.
 * BOM engine aggregates these and matches them to equipment-db SKUs.
 */
export interface BosHint {
  /** Canonical BOS category (matches RequiredBOSFamily.category). */
  category: string;
  /**
   * Quantity policy for this item.
   *   - 'per_module'   : qty = panelCount
   *   - 'per_inverter' : qty = inverterQty
   *   - 'per_branch'   : qty = branchCount
   *   - 'fixed_count'  : qty = fixedQty
   *   - 'derived'      : BOM derives qty from other fields
   */
  qtyPolicy: 'per_module' | 'per_inverter' | 'per_branch' | 'fixed_count' | 'derived';
  /** Fixed quantity when qtyPolicy = 'fixed_count'. */
  fixedQty?: number;
  /** Optional specific equipment-db id to use. */
  equipmentDbId?: string;
  /** Whether this item is required (true) or optional (false). */
  required: boolean;
  /** Human-readable note for BOM line item. */
  note?: string;
}

// ─── Layout Generation Input ─────────────────────────────────────────────────

/**
 * Input to generateLayoutCandidates().
 * Contains all system parameters needed to produce valid LayoutCandidates.
 */
export interface LayoutGeneratorInput {
  // ── Array sizing ──────────────────────────────────────────────────────────
  /** Total panel count. */
  panelCount: number;
  /** Individual panel wattage (W). */
  panelWattage: number;
  /** Total DC power (kW). Derived: panelCount × panelWattage / 1000. */
  totalDcKw: number;

  // ── Panel electrical specs (optional — enables voltage/current checks) ────
  /** Panel open-circuit voltage at STC (V). */
  panelVoc?: number;
  /** Panel max-power-point voltage at STC (V). */
  panelVmp?: number;
  /** Panel short-circuit current at STC (A). */
  panelIsc?: number;
  /** Panel Voc temperature coefficient (%/°C, negative). */
  panelTempCoeffVoc?: number;
  /** Panel Vmp temperature coefficient (%/°C, negative). */
  panelTempCoeffVmp?: number;
  /** Site design minimum ambient temperature (°C). Default: −10°C. */
  designTempMin?: number;

  // ── Candidate filtering ───────────────────────────────────────────────────
  /**
   * If set, only generate candidates for this specific equipment-db model.
   * Used when the user has explicitly selected an inverter model.
   */
  selectedInverterId?: string;
  /**
   * If set, only generate candidates from profiles with this topology.
   * Typically driven by the brand profile topology.
   */
  topologyFilter?: InverterTopology;

  // ── Optimizer-specific ───────────────────────────────────────────────────
  /**
   * Optimizer max regulated output current (A).
   * Required when topology = 'optimizer'.
   * Default: 15.0A (covers SolarEdge P-series + Tigo TS4-A-O).
   */
  optimizerMaxOutputCurrent?: number;
}

// ─── Layout Generation Output ────────────────────────────────────────────────

/**
 * Output of generateLayoutCandidates().
 */
export interface LayoutGeneratorOutput {
  /**
   * All feasible candidates, sorted by score descending.
   * Empty only when no inverter model in the profile set can serve
   * the given panel count (should be surfaced as a hard error).
   */
  candidates: LayoutCandidate[];
  /**
   * The top-scored candidate. Null only when candidates is empty.
   */
  recommended: LayoutCandidate | null;
  /**
   * Candidates that were evaluated but failed electrical hard-gates.
   * Provided for debugging and ValidationPanel "why not" explanations.
   */
  rejected: Array<{
    profile: CapabilityProfile;
    inverterQty: number;
    failureReasons: string[];
  }>;
  /**
   * Generator metadata for audit logging.
   */
  meta: {
    profilesEvaluated: number;
    candidatesGenerated: number;
    candidatesRejected: number;
    generatorVersion: string;
  };
}