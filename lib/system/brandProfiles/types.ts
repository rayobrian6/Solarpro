// ════════════════════════════════════════════════════════════════════
// Brand Profile — Type definitions
// lib/system/brandProfiles/types.ts
//
// A BrandProfile is the centralized source of truth for:
//   - What systems a brand supports (roof / ground / fence)
//   - What topology the brand uses (micro / string / optimizer / hybrid)
//   - Which inverter models are valid for this brand
//   - MPPT count / string design rules per inverter
//   - Whether the brand pairs with a battery ecosystem
//   - Which supporting equipment families (BOS) are required
//   - Compatibility constraints (hard rules)
//
// The sizing engine reads profiles. BOM reads the sizing engine output.
// No layer invents brand behavior.
// ════════════════════════════════════════════════════════════════════

import type { SystemType, InverterType } from '../systemDefinition';

// ─── Topology brand classification ─────────────────────────────────
/** Canonical topology families supported by brand profiles. */
export type TopologyFamily = 'micro' | 'string' | 'optimizer' | 'hybrid';

// ─── Battery support ───────────────────────────────────────────────
export interface BrandBatterySupport {
  /** True if the inverter family supports batteries natively. */
  capable: boolean;
  /** True if the inverter family REQUIRES a battery (e.g. EcoFlow). */
  required: boolean;
  /** Recommended battery brand(s) (id tokens — not equipment-db ids). */
  recommendedBatteryBrands?: string[];
  /** Sizing strategy: modular stack (EcoFlow), single-pack (Tesla), etc. */
  sizingStrategy?: 'modular_stack' | 'single_pack' | 'per_module' | 'custom';
  /** Default target kWh if the user hasn't specified. */
  defaultTargetKwh?: number;
  /** Minimum battery kWh the brand supports. */
  minKwh?: number;
  /** Maximum battery kWh the brand supports (per stack / controller). */
  maxKwh?: number;
}

// ─── Inverter model entry (light reference) ────────────────────────
export interface BrandInverterModelRef {
  /** Equipment-db id (e.g. 'enphase-iq8plus', 'ecoflow-power-ocean-10kw'). */
  equipmentDbId: string;
  /** AC output kW (nominal). */
  acKw: number;
  /** Max DC input kW. */
  dcKwMax: number;
  /** MPPT channel count. */
  mpptCount: number;
  /** String design: min panels per string. undefined for micro. */
  minPanelsPerString?: number;
  /** String design: max panels per string. undefined for micro. */
  maxPanelsPerString?: number;
  /**
   * Phase 13.2 — Parallel strings supported PER MPPT channel.
   * String / optimizer / hybrid inverters accept multiple series strings
   * wired in parallel on a single MPPT input. Max panels the UNIT can
   * accept is therefore:
   *   mpptCount × maxParallelStringsPerMppt × maxPanelsPerString
   * Default when undefined: 2 (conservative residential norm).
   * Micro topology: irrelevant (no strings).
   */
  maxParallelStringsPerMppt?: number;
  /** Modules-per-device (micro-only: IQ8+=1, IQ8M=2 etc.). */
  modulesPerDevice?: number;

  /**
   * v47.432 Stage 8.2 — opt-out flag for the brand-profile drift-guard CI test.
   *
   * When true, the drift-guard (lib/system/brandProfileDriftGuard.test.ts)
   * will SKIP value-equality checks for this SKU against equipment-db's
   * STRING_INVERTERS entry. Use ONLY when a brand profile INTENTIONALLY
   * overrides datasheet values (e.g. brand-enforced design rule stricter
   * than the raw inverter spec — typically maxParallelStringsPerMppt=1 on
   * a hardware-capable 2-parallel inverter to enforce a conservative
   * design standard).
   *
   * Setting this flag requires a code-review comment explaining WHY the
   * brand profile intentionally disagrees with the equipment-db canonical
   * value. The drift-guard emits a self-documenting "overridesEquipmentDb:
   * true" log line in CI so reviewers can audit the override list.
   *
   * Default: false (drift-guard enforces value equality).
   */
  overridesEquipmentDb?: boolean;

  /**
   * v61.13d — Maximum number of units of this model that may be installed
   * in parallel. Used by the sizing engine for hybrid ESS inverters that
   * explicitly support multi-unit configurations (e.g. EcoFlow OCEAN Pro:
   * "Power Scalability: Up to 2 units (48 kW)" per EF-PCS-24 datasheet).
   *
   * For hybrid topology the DC/AC floor is lowered to HYBRID_MIN_DC_AC_RATIO
   * (0.75) rather than MIN_DC_AC_RATIO (1.00), because the battery bank
   * supplements AC output when DC array power is below inverter AC rating.
   * Without this flag the engine never considers a 2-unit config whose
   * combined ratio falls below 1.0 even when it is a physically valid and
   * superior design (more MPPTs, better peak resilience, closer to the 1.25
   * preferred target per unit).
   *
   * Default: undefined (treated as 1 — no multi-unit stacking).
   * Only set for hybrid ESS inverters with explicit datasheet support.
   */
  maxUnits?: number;
}

// ─── Required BOS component family ─────────────────────────────────
/**
 * A required BOS family declares "this brand-topology system needs X equipment".
 * The sizing engine returns these; BOM counts and renders them.
 */
export interface RequiredBOSFamily {
  /** Canonical category (microinverter, trunk_cable, terminator, dc_disconnect, etc.). */
  category: string;
  /**
   * Quantity policy: how BOM should count this item.
   *   - 'per_module': qty = panelCount (e.g. microinverters)
   *   - 'per_inverter': qty = inverterCount (e.g. disconnect)
   *   - 'per_branch': qty = branchCount
   *   - 'per_stack': qty = battery stack count
   *   - 'fixed_one': single unit regardless
   *   - 'derived': BOM derives from other fields
   */
  qtyPolicy: 'per_module' | 'per_inverter' | 'per_branch' | 'per_stack' | 'fixed_one' | 'derived';
  /** Whether this family is REQUIRED or OPTIONAL. */
  required: boolean;
  /** Optional specific equipment-db id to use. */
  equipmentDbId?: string;
  /** Human-readable note. */
  note?: string;
}

// ─── Compatibility constraint ──────────────────────────────────────
export interface BrandCompatibilityConstraint {
  /** Topology families that must NEVER coexist with this brand. */
  incompatibleTopologies?: TopologyFamily[];
  /** Brand ids that must NEVER be selected alongside this brand. */
  incompatibleBrands?: string[];
  /**
   * DC/AC ratio allowed range — e.g. { min: 1.0, max: 1.35 }.
   * Sizing engine flags warnings if target totals fall outside.
   */
  dcAcRatioRange?: { min: number; max: number };
  /** Max DC kW per inverter (brand-wide cap). */
  maxDcKwPerInverter?: number;
}

// ─── Inverter sizing tier (input:DC kW → inverter model) ──────────
export interface InverterSizingTier {
  /** Lower-bound total DC kW (inclusive). */
  minDcKw: number;
  /** Upper-bound total DC kW (exclusive, use Infinity for top tier). */
  maxDcKw: number;
  /** Equipment-db id to use when total DC kW falls in this range. */
  equipmentDbId: string;
}

// ─── Main BrandProfile shape ───────────────────────────────────────
export interface BrandProfile {
  /** Canonical brand id (slug). */
  id: string;
  /** Display name. */
  displayName: string;
  /** Manufacturer reference (matches equipment-db manufacturer field). */
  manufacturer: string;
  /** System types this brand supports. */
  supportedSystemTypes: SystemType[];
  /** Topology family the brand uses. */
  topology: TopologyFamily;
  /** Legacy-mapped InverterType for the topology selector UI. */
  inverterType: InverterType;
  /** Supported inverter models (references to equipment-db). */
  supportedInverterModels: BrandInverterModelRef[];
  /** Sizing tiers — which model to pick based on total DC kW. */
  sizingTiers: InverterSizingTier[];
  /** Battery support specification. */
  battery: BrandBatterySupport;
  /** Required BOS equipment families. */
  requiredBOSFamilies: RequiredBOSFamily[];
  /** Compatibility rules. */
  compatibility: BrandCompatibilityConstraint;
  /** Default when no user brand is selected for a given system type. */
  recommendedFor: SystemType[];
  /**
   * v47.429 — Recommended racking brand tokens (Stage 6: Racking Visibility).
   * Token must match a manufacturer slug reachable from mounting-hardware-db.ts
   * (e.g. 'ironridge', 'unirac', 'snapnrack', 'k2-systems', 'quickmount-pv').
   * When present, the EcosystemPicker surfaces these as the preferred pairings.
   * When absent/empty, the UI shows a generic fallback message.
   * Invariant: every token MUST resolve to ≥1 system in mounting-hardware-db
   * (enforced by rackingEcosystemSmoke.test.ts — mirrors battery Global 2).
   */
  recommendedRackingBrands?: string[];
  /** Optional notes. */
  notes?: string;
}