// ═══════════════════════════════════════════════════════════════════════
// Smart Defaults — Phase 13 initialization layer
// lib/system/smartDefaults.ts
//
// PURPOSE:
//   Provide a SAFE, ONCE-ONLY bootstrap that turns an empty project into
//   a valid working system, WITHOUT introducing new sizing logic or
//   ever fighting the user later.
//
// ARCHITECTURAL LAWS (NON-NEGOTIABLE):
//   ✗ This module NEVER overrides a user's choice.
//   ✗ This module NEVER duplicates sizing logic — it calls sizeSystemFromBrand().
//   ✗ This module NEVER mutates inputs — returns a patch.
//   ✗ This module NEVER runs more than once per project without an
//     explicit user-initiated reset.
//   ✓ This module ONLY fires when the config is factory-fresh AND the
//     `defaultsApplied` sentinel is not yet set.
//
// PIPELINE POSITION:
//     raw config
//   → applySmartDefaultsOnce()     ← this module
//   → normalizeInverterState()
//   → validationEngine
//   → UI
//
// The existing sizing engine (sizeSystemFromBrand) remains the ONLY
// source of system logic. This module is pure bookkeeping + a thin
// call to the engine, then hydration of the result back into config.
// ═══════════════════════════════════════════════════════════════════════

import type { SystemType, SystemDefinition } from './systemDefinition';
import type { SystemSizingResult } from './sizingEngine';
import { sizeSystemFromBrand } from './sizingEngine';
import { getRecommendedBrandForSystem, BRAND_PROFILES } from './brandProfiles';

// ─── Minimal config shape (structurally compatible with ProjectConfig) ─
// We intentionally type against a MINIMAL shape so unit tests can pass
// lean fixtures and the engineering page can pass its full ProjectConfig
// via TS structural typing. Only the fields this module actually reads
// and writes are declared here.

export interface SmartDefaultsConfigShape {
  systemType: SystemType;
  /** One UI inverter card per entry. Empty array also counts as uninitialized. */
  inverters: ReadonlyArray<SmartDefaultsInverter>;
  /** Sentinel — true once defaults have been applied. Protects against re-entry. */
  defaultsApplied?: boolean;
  /** Optional user brand selection; respected when present. */
  selectedBrand?: string;
  /**
   * Phase 13.1 — USER INTENT LOCK. When true, the user has edited the
   * inverter config directly. Smart defaults must NEVER fire while this
   * is true — even if `defaultsApplied` somehow got cleared.
   */
  userHasEditedInverters?: boolean;
}

export interface SmartDefaultsInverter {
  id: string;
  inverterId: string;
  type: string; // 'string' | 'micro' | 'optimizer' | 'ecoflow'
  strings: ReadonlyArray<SmartDefaultsString>;
}

export interface SmartDefaultsString {
  id: string;
  panelCount: number;
  panelId: string;
}

// ─── STEP 1 — uninitialized detector ───────────────────────────────────

/**
 * A system is uninitialized when it carries the FACTORY DEFAULT shape
 * and has never been touched by the user or by a prior smart-defaults
 * pass. Concretely:
 *
 *   - `defaultsApplied` flag is falsy (we haven't run yet)
 *   - AND either:
 *     (a) there are no inverters at all, OR
 *     (b) there is exactly ONE inverter whose strings all look like
 *         the factory placeholder (no inverterId customization beyond
 *         the baseline, and only the single 0/10-panel placeholder string)
 *
 * This is intentionally strict — the moment the user adds a second
 * inverter, changes a panel count off the default, or switches models,
 * this returns false and the defaults will never fire.
 *
 * IMPORTANT: This function is PURE — it never mutates the config.
 */
export function isSystemUninitialized(config: SmartDefaultsConfigShape): boolean {
  if (config.defaultsApplied) return false;

  // No inverters → definitely uninitialized.
  if (!config.inverters || config.inverters.length === 0) return true;

  // More than one inverter card → user has been here.
  if (config.inverters.length > 1) return false;

  const inv = config.inverters[0];

  // No strings at all → treat as uninitialized (still factory-fresh).
  if (!inv.strings || inv.strings.length === 0) return true;

  // More than one string → user has been editing.
  if (inv.strings.length > 1) return false;

  // One string, factory-default panelCount? The default from
  // newString() is 10. We accept 0 or 10 as "untouched". Any other
  // value indicates the user has been editing.
  const s = inv.strings[0];
  const isPlaceholderCount = s.panelCount === 0 || s.panelCount === 10;
  return isPlaceholderCount;
}

// ─── STEP 2 — default brand selection (SEED ONLY) ──────────────────────

/**
 * Return the recommended seed brand for a given system type. This is
 * ONLY a suggestion handed to sizeSystemFromBrand() — the sizing engine
 * is still the authoritative decider about topology / models / strings.
 *
 * Selection priority:
 *   1. The brand whose recommendedFor[] contains the systemType.
 *   2. First brand in the registry that supports the systemType.
 *   3. Hardcoded fallback per prompt:
 *        roof   → 'enphase'
 *        ground → 'fronius'
 *        fence  → 'enphase'  (SolFence is "just solar", battery-agnostic — IQ8 micro)
 *
 * The hardcoded fallback is a safety net for the (impossible) case where
 * the brand registry is empty. Under normal operation, rule #1 always
 * wins because the profiles already declare recommendedFor correctly.
 */
export function getDefaultBrand(systemType: SystemType): string {
  const recommended = getRecommendedBrandForSystem(systemType);
  if (recommended) return recommended.id;

  const firstSupported = BRAND_PROFILES.find(p =>
    p.supportedSystemTypes.includes(systemType),
  );
  if (firstSupported) return firstSupported.id;

  // Unreachable under normal operation — every registered brand covers at
  // least one systemType. Keep a defensive fallback to satisfy the prompt.
  if (systemType === 'roof')   return 'enphase';
  if (systemType === 'ground') return 'fronius';
  if (systemType === 'fence')  return 'enphase';  // SolFence = just solar + battery-agnostic → Enphase IQ8 micro (AC out, any battery AC-couples later)
  return 'generic-string';
}

// ─── STEP 3 — apply smart defaults ONCE ────────────────────────────────

export interface ApplySmartDefaultsInput {
  /** The current project config. Treated as read-only. */
  config: SmartDefaultsConfigShape;
  /**
   * CAD-resolved panel count. MUST be > 0 for defaults to fire — the
   * sizing engine can't produce a meaningful result without it. When 0
   * the function is a no-op (applied=false) and waits for CAD.
   */
  systemPanelCount: number;
  /** Optional SystemDefinition for traceability. Not strictly required. */
  systemDefinition?: SystemDefinition | null;
  /** Optional panel wattage (used by the engine's DC kW math). */
  panelWattage?: number;
}

export interface ApplySmartDefaultsResult {
  /**
   * Whether defaults were actually applied this call. `false` means
   * either:
   *   - The config was already initialized, OR
   *   - defaultsApplied was already true, OR
   *   - systemPanelCount was 0 (not enough CAD info yet).
   * The caller should NOT merge the patch when applied === false.
   */
  applied: boolean;
  /** Fields to patch onto the current config. Empty object when applied=false. */
  patch: SmartDefaultsPatch;
  /** The raw sizing result the patch was derived from (null when applied=false). */
  sizingResult: SystemSizingResult | null;
  /** Short human-readable reason for diagnostics. */
  reason: string;
  /** The seed brand that was handed to the sizing engine (undefined when applied=false). */
  seedBrand?: string;
}

/**
 * Patch shape produced by applySmartDefaultsOnce. Callers spread this
 * onto the current config. We intentionally emit STRUCTURAL fields only
 * (no cosmetic defaults, no project-metadata), so the patch is safe to
 * merge via `{ ...config, ...patch }`.
 */
export interface SmartDefaultsPatch {
  inverters?: SmartDefaultsInverter[];
  /** Sentinel flag — set to true once defaults have been applied. */
  defaultsApplied?: boolean;
  /** Seed brand, recorded only if the user hadn't already picked one. */
  selectedBrand?: string;
  /**
   * Phase 13.1 — cleared (to false) by clearDefaultsAppliedFlag() so a
   * reset also drops the user-edit lock. `applySmartDefaultsOnce` itself
   * does NOT emit this field (it short-circuits when the lock is on).
   */
  userHasEditedInverters?: boolean;
}

/**
 * Apply smart defaults exactly ONCE to a fresh config.
 *
 * Hard invariants:
 *   - If `defaultsApplied` is already truthy → NO-OP.
 *   - If the config is NOT uninitialized → NO-OP.
 *   - If `systemPanelCount` is 0 → NO-OP (wait for CAD).
 *
 * On firing:
 *   - Calls the existing sizing engine with the seed brand.
 *   - Builds a minimal patch (inverters + defaultsApplied sentinel).
 *   - DOES NOT alter any other field (keeps site metadata, contractor,
 *     utility, battery, etc. untouched).
 *
 * User's existing selectedBrand takes precedence over the seed brand
 * (we only fill it in if the user didn't already choose one).
 */
export function applySmartDefaultsOnce(
  input: ApplySmartDefaultsInput,
): ApplySmartDefaultsResult {
  const { config, systemPanelCount, panelWattage } = input;

  // GUARD 1 — already applied. Authoritative short-circuit.
  if (config.defaultsApplied) {
    return {
      applied: false,
      patch: {},
      sizingResult: null,
      reason: 'defaults already applied — no-op (respects user edits from here on)',
    };
  }

  // GUARD 1b — USER INTENT LOCK (Phase 13.1). If the user has already
  // touched the inverter config, NEVER apply defaults. This is a hard
  // architectural invariant: user config is the source of truth.
  if (config.userHasEditedInverters) {
    return {
      applied: false,
      patch: {},
      sizingResult: null,
      reason: 'user intent lock engaged — user has edited inverters, defaults are frozen',
    };
  }

  // GUARD 2 — config is not uninitialized. Don't touch user's work.
  if (!isSystemUninitialized(config)) {
    return {
      applied: false,
      patch: {},
      sizingResult: null,
      reason: 'config is not uninitialized — user has already been editing',
    };
  }

  // GUARD 3 — panel count required for the sizing engine.
  if (!systemPanelCount || systemPanelCount <= 0) {
    return {
      applied: false,
      patch: {},
      sizingResult: null,
      reason: 'no CAD panel count yet — waiting for design input',
    };
  }

  // ── Run the (existing) sizing engine with a seed brand ──────────────
  const seedBrand = config.selectedBrand ?? getDefaultBrand(config.systemType);

  const sizingResult = sizeSystemFromBrand({
    systemType: config.systemType,
    panelCount: systemPanelCount,
    panelWattage,
    selectedBrand: seedBrand,
    batteryEnabled: false, // defaults ALWAYS start without battery
  });

  // ── Hydrate the config from the sizing result ───────────────────────
  // We build the minimum inverter structure the existing engineering
  // page expects, grouping strings by their inverterIndex (physical
  // unit). For micro topology we emit a single UI card holding every
  // panel as one string (consistent with applySizingRecommendation()).
  const hydratedInverters = hydrateInvertersFromSizing(sizingResult, config);

  const patch: SmartDefaultsPatch = {
    inverters: hydratedInverters,
    defaultsApplied: true,
  };
  // Only fill in selectedBrand if the user didn't already set one.
  if (!config.selectedBrand) {
    patch.selectedBrand = seedBrand;
  }

  return {
    applied: true,
    patch,
    sizingResult,
    reason: `applied seed brand '${seedBrand}' with ${systemPanelCount} panels`,
    seedBrand,
  };
}

// ─── Helper: hydrate inverters array from a sizing result ──────────────

/**
 * Convert a SystemSizingResult into the UI's InverterConfig-shaped
 * array. This mirrors the grouping logic used by the engineering
 * page's applySizingRecommendation(), but produces the lighter shape
 * declared in SmartDefaultsConfigShape so this module has no circular
 * dependency on page-level types.
 *
 * The engineering page's `applySizingRecommendation()` remains the
 * AUTHORITATIVE hydrator for user-initiated "Apply Recommended" flows.
 * This helper is intentionally structurally compatible but lives here
 * so the defaults path doesn't have to import from app/*.
 */
function hydrateInvertersFromSizing(
  rec: SystemSizingResult,
  config: SmartDefaultsConfigShape,
): SmartDefaultsInverter[] {
  const primaryModel = rec.inverterModels[0];
  if (!primaryModel) return [];

  // Preserve the user's panelId if one already exists on the placeholder
  // string — CAD may have assigned a brand-specific panel that we don't
  // want to stomp on. Fall back to the first string's default, then to
  // a known-safe string.
  const existingPanelId =
    config.inverters[0]?.strings[0]?.panelId ?? 'panel-default';

  const uiType =
    rec.topology === 'hybrid' ? 'ecoflow'
      : rec.topology === 'micro' ? 'micro'
      : rec.topology === 'optimizer' ? 'optimizer'
      : 'string';

  const now = Date.now();

  if (uiType === 'micro') {
    // Micro topology: 1 UI card holds every panel as a single string.
    // Use actual panel count (rec.input.panelCount), NOT rec.microDeviceCount.
    // For dual-module micros (e.g. APsystems DS3-L, modulesPerDevice=2),
    // microDeviceCount = ceil(panels / 2) which is HALF the actual panel count.
    // Storing device count as panelCount caused totalKw to show half the real DC size.
    const actualPanelCount = rec.input.panelCount > 0
      ? rec.input.panelCount
      : rec.microDeviceCount;
    return [{
      id: `inv-defaults-${now}`,
      inverterId: primaryModel.equipmentDbId,
      type: 'micro',
      strings: [{
        id: `str-defaults-${now}`,
        panelCount: actualPanelCount,
        panelId: existingPanelId,
      }],
    }];
  }

  // Non-micro: one UI card per physical unit, grouped by inverterIndex.
  const byInverter = new Map<number, SmartDefaultsString[]>();
  for (const s of rec.strings) {
    if (!byInverter.has(s.inverterIndex)) byInverter.set(s.inverterIndex, []);
    byInverter.get(s.inverterIndex)!.push({
      id: `str-defaults-${now}-${s.inverterIndex}-${s.index}`,
      panelCount: s.panelCount,
      panelId: existingPanelId,
    });
  }

  const out: SmartDefaultsInverter[] = [];
  for (let i = 0; i < rec.inverterCount; i++) {
    out.push({
      id: `inv-defaults-${now}-${i}`,
      inverterId: primaryModel.equipmentDbId,
      type: uiType,
      strings: byInverter.get(i) ?? [{
        id: `str-defaults-${now}-${i}-0`,
        panelCount: 0,
        panelId: existingPanelId,
      }],
    });
  }
  return out;
}

// ─── STEP 7 — explicit reset hook ──────────────────────────────────────

/**
 * Clear the `defaultsApplied` sentinel so the next evaluation of
 * applySmartDefaultsOnce() can fire again. Intended for USER-initiated
 * "Reset System" actions ONLY.
 *
 * Phase 13.1 — USER INTENT LOCK: a "Reset System" must also clear the
 * user-edit lock so the defaults layer is allowed to seed a fresh
 * system. Without this, the config would re-enter the uninitialized
 * state but the lock would still block defaults, leaving the user with
 * a broken project.
 *
 * This is a pure helper — it returns a patch; it does not mutate.
 */
export function clearDefaultsAppliedFlag(): SmartDefaultsPatch {
  return { defaultsApplied: false, userHasEditedInverters: false };
}