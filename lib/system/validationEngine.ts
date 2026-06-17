// ═════════════════════════════════════════════════════════════════════════════
// System-Wide Validation Layer (Phase 12)
// lib/system/validationEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// CORE PRINCIPLE:
//   - Sizing engine = decides what SHOULD exist.
//   - Validation layer = verifies it is SAFE and VALID.
//
// Validation NEVER mutates config, NEVER overrides user selection.
// Validation ONLY analyzes, classifies, and reports.
//
// Entry point:
//   validateSystem(input: ValidationInput): ValidationResult
//
// Called by:
//   - Engineering page UI (renders ValidationPanel.tsx)
//   - Plan-set / permit export hooks (block on ERROR)
//   - BOM export hook (optional block based on severity)
//
// Severity rules:
//   ERROR   → system is invalid; must be fixed before downstream export
//   WARNING → system is valid but suboptimal or risky
//   INFO    → informational insight (e.g., inverter was upsized)
// ═════════════════════════════════════════════════════════════════════════════

import type { SystemSizingResult } from './sizingEngine';
import type { SystemDefinition, SystemType } from './systemDefinition';
import type { StructuralBOMItem } from '../bom-system-profiles';
import { getBrandProfile } from './brandProfiles';
import type { TopologyFamily } from './brandProfiles/types';
import { DC_AC_CLIPPING_BANDS } from './dcAcConstants';
// Phase 15 — centralized compatibility matrix.
import {
  evaluateCompatibility,
  findMissingBosCategories,
  type CompatibilityIssue,
} from './brandCompatibility';

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * A single validation finding. Severity drives bucketing in ValidationResult.
 *
 * `code` is a stable programmatic identifier (e.g. 'PANEL_COUNT_MISMATCH').
 * `message` is human-readable for the UI.
 * `context` carries structured detail for auto-fix or drill-down (e.g.
 *   the two mismatched numbers, the offending string index, etc.).
 * `recommendation` is an optional human-readable hint for how to fix.
 */
export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  context?: Record<string, unknown>;
  recommendation?: string;
}

/**
 * The full validation report. Consumers should check `errors.length` to
 * decide whether to block downstream actions (permit export, plan-set
 * generation). Warnings and info are surfaced to the user but non-blocking.
 */
export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  /** Convenience: errors.length === 0 && warnings.length === 0 */
  isClean: boolean;
  /** Convenience: errors.length === 0 (downstream-safe) */
  isPassing: boolean;
}

/**
 * Minimal CAD model shape that validation needs. Callers can pass the full
 * project layout or a derived snapshot — validation only reads what it uses.
 */
export interface ValidationCadModel {
  panels?: Array<unknown> | null;
  totalPanels?: number;
}

/**
 * Full input to validateSystem(). Only `sizingResult` is strictly required —
 * the other sources are optional so validation can run early in the pipeline
 * (before BOM is computed, before CAD is finalized, etc.). Each rule checks
 * availability and skips gracefully when its inputs aren't present.
 */
export interface ValidationInput {
  sizingResult: SystemSizingResult;
  systemDefinition?: SystemDefinition | null;
  cadModel?: ValidationCadModel | null;
  bomItems?: StructuralBOMItem[] | null;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

/**
 * Main entry. Runs every rule module in deterministic order, collects
 * issues, and buckets them by severity. Never throws — if a rule itself
 * errors, the orchestrator swallows it and emits an internal warning.
 */
export function validateSystem(input: ValidationInput): ValidationResult {
  const all: ValidationIssue[] = [];

  const rules: Array<(i: ValidationInput) => ValidationIssue[]> = [
    validatePanelConsistency,      // 1
    validateDcAcRatio,             // 2
    validateInverter,              // 3
    validateStrings,               // 4
    validateTopologyConsistency,   // 5
    validateBattery,               // 6
    validateBrandCompatibility,    // 7
    validateBomConsistency,        // 8
    validateStructuralElectrical,  // 9
    validateEngineOutputConsistency, // 10
    validateBrandEcosystem,          // 11 (Phase 15)
    validateBosRequirements,         // 12 (Phase 15)
  ];

  for (const rule of rules) {
    try {
      const issues = rule(input);
      if (issues.length) all.push(...issues);
    } catch (err) {
      // Defensive: a broken rule must not take the whole validation down.
      all.push({
        code: 'VALIDATION_RULE_FAILED',
        severity: 'warning',
        message: `Validation rule threw internally: ${rule.name}`,
        context: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // Carry sizing-engine warnings (INVERTER_UPSIZED, etc.) into the
  // validation report so the UI has a single source of truth.
  for (const w of input.sizingResult.warnings) {
    all.push({
      code: w.code,
      severity: w.severity,
      message: w.message,
      context: { source: 'sizingEngine' },
    });
  }

  const errors = all.filter(i => i.severity === 'error');
  const warnings = all.filter(i => i.severity === 'warning');
  const info = all.filter(i => i.severity === 'info');

  return {
    errors,
    warnings,
    info,
    isPassing: errors.length === 0,
    isClean: errors.length === 0 && warnings.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 1 — Panel / system consistency
// ═════════════════════════════════════════════════════════════════════════════
//
// Panel count must agree across every source we know about. Mismatches
// between CAD, SystemDefinition, and the sizing input are a classic
// root cause of "wrong-count inverter" bugs.
// ─────────────────────────────────────────────────────────────────────────────

export function validatePanelConsistency(input: ValidationInput): ValidationIssue[] {
  const { sizingResult, systemDefinition, cadModel } = input;
  const issues: ValidationIssue[] = [];

  const sizingCount = sizingResult.input.panelCount;
  const cadCount = resolveCadPanelCount(cadModel);
  const sysDefCount = systemDefinition?.layout?.totalPanels ?? null;

  if (sizingCount <= 0) {
    issues.push({
      code: 'PANEL_COUNT_ZERO',
      severity: 'error',
      message: 'Sizing input panel count is 0 or missing.',
      context: { sizingCount },
      recommendation: 'Place panels in the CAD view or enter a system size.',
    });
  }

  if (cadCount !== null && cadCount !== sizingCount) {
    issues.push({
      code: 'PANEL_COUNT_MISMATCH_CAD',
      severity: 'error',
      message: `CAD has ${cadCount} panels but sizing used ${sizingCount}.`,
      context: { cadCount, sizingCount },
      recommendation: 'Re-run sizing against the current CAD layout.',
    });
  }

  if (sysDefCount !== null && sysDefCount !== sizingCount) {
    issues.push({
      code: 'PANEL_COUNT_MISMATCH_SYSDEF',
      severity: 'error',
      message: `SystemDefinition says ${sysDefCount} panels but sizing used ${sizingCount}.`,
      context: { sysDefCount, sizingCount },
      recommendation: 'Update SystemDefinition.layout.totalPanels or re-run sizing.',
    });
  }

  // String/optimizer: strings should sum to the sizing input count (no orphans).
  if (sizingResult.topology !== 'micro' && sizingResult.strings.length > 0) {
    const onStrings = sizingResult.strings.reduce((s, x) => s + x.panelCount, 0);
    if (onStrings !== sizingCount) {
      issues.push({
        code: 'PANEL_COUNT_ORPHANS',
        severity: 'error',
        message: `${Math.abs(sizingCount - onStrings)} panels are not assigned to any string (${onStrings} on strings vs ${sizingCount} expected).`,
        context: { onStrings, expected: sizingCount },
        recommendation: 'Re-run the sizing engine to rebuild string layout.',
      });
    }
  }

  return issues;
}

function resolveCadPanelCount(cad?: ValidationCadModel | null): number | null {
  if (!cad) return null;
  if (Array.isArray(cad.panels) && cad.panels.length > 0) return cad.panels.length;
  if (typeof cad.totalPanels === 'number' && cad.totalPanels > 0) {
    return Math.floor(cad.totalPanels);
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 2 — DC / AC ratio
// ═════════════════════════════════════════════════════════════════════════════
// Industry thresholds (v58.0 — updated):
//   < 1.00 → AC output exceeds DC array (hard AUTO-mode failure)
//   < 0.8  → inverter is significantly oversized (WARNING in manual mode)
//   > 1.6  → mild clipping acceptable but design attention required (WARN)
//   > 2.0  → severe clipping / code issue (ERROR)
//
// Brand profile may tighten these via compatibility.dcAcRatioRange.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function validateDcAcRatio(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  // Micro topology has 1:1 DC:AC at the panel level — ratio is meaningless.
  if (sizingResult.topology === 'micro') return issues;

  const totalAcKw = sizingResult.inverterModels.reduce(
    (s, m) => s + m.acKw * m.qty, 0,
  );
  if (totalAcKw <= 0) {
    // Already caught by RULE 3 (no valid inverter). Skip ratio math.
    return issues;
  }

  const panelWattage = sizingResult.input.panelWattage ?? 400;
  const totalDcKw = (sizingResult.input.panelCount * panelWattage) / 1000;
  const ratio = totalDcKw / totalAcKw;
  const roundedRatio = Math.round(ratio * 100) / 100;

  // Hard failure: AC output exceeds DC array capacity (ratio < 1.00).
  // This means more inverter AC capacity than the panels can ever deliver.
  // Auto-selection must never produce this; if it appears the config was
  // manually set or a stale state leaked through.
  if (ratio < 1.0) {
    issues.push({
      code: 'DC_AC_RATIO_AC_EXCEEDS_DC',
      severity: 'error',
      message:
        `DC/AC ratio ${roundedRatio} is below 1.00 — AC output capacity ` +
        `(${totalAcKw.toFixed(2)} kW) exceeds DC array size (${totalDcKw.toFixed(2)} kW). ` +
        `Inverter is oversized for this array.`,
      context: { ratio, totalDcKw, totalAcKw, threshold: 1.0 },
      recommendation:
        'Upsize the PV array, switch to a smaller inverter, or reduce inverter count.',
    });
    return issues; // DC_AC_RATIO_LOW would be redundant — skip further checks.
  }

  // Absolute thresholds.
  if (ratio > DC_AC_CLIPPING_BANDS.CRITICAL_THRESHOLD) {
    issues.push({
      code: 'DC_AC_RATIO_SEVERE',
      severity: 'error',
      // v61.9: Explicit upsizing-first language. Never imply panel reduction is primary fix.
      message: `DC/AC ratio ${roundedRatio} exceeds ${DC_AC_CLIPPING_BANDS.CRITICAL_THRESHOLD} ` +
        `(${totalDcKw.toFixed(2)} kW DC / ${totalAcKw.toFixed(2)} kW AC) — severe economic clipping. ` +
        `The system is not electrically invalid, but will lose significant production.`,
      context: { ratio, totalDcKw, totalAcKw, threshold: DC_AC_CLIPPING_BANDS.CRITICAL_THRESHOLD },
      recommendation:
        `Upsize inverter to a larger model or add a second unit. ` +
        `For EcoFlow: the OCEAN Pro 24 kW would bring ratio to ${(totalDcKw/24).toFixed(2)}. ` +
        `Do not reduce panel count unless inverter upsizing is impossible.`,
    });
  } else if (ratio > DC_AC_CLIPPING_BANDS.WARNING_MAX) {
    // 1.75 < ratio ≤ 2.0 — severe clipping
    issues.push({
      code: 'DC_AC_RATIO_HIGH',
      severity: 'warning',
      // v61.9: Explicit upsizing-first recommendation. Panel reduction is last resort.
      message: `DC/AC ratio ${roundedRatio} is high (${totalDcKw.toFixed(2)} kW DC / ${totalAcKw.toFixed(2)} kW AC) — ` +
        `significant clipping expected. System is electrically valid but may lose production during peak irradiance.`,
      context: { ratio, totalDcKw, totalAcKw, threshold: DC_AC_CLIPPING_BANDS.WARNING_MAX },
      recommendation:
        `Preferred fix: upsize inverter to a larger model or add a second unit to increase AC capacity. ` +
        `Reducing panel count is a last resort only if no larger inverter option exists.`,
    });
  } else if (ratio > DC_AC_CLIPPING_BANDS.MILD_MAX) {
    // 1.55 < ratio ≤ 1.75 — warning / aggressive oversize
    issues.push({
      code: 'DC_AC_RATIO_HIGH',
      severity: 'warning',
      message: `DC/AC ratio ${roundedRatio} is moderately high (${totalDcKw.toFixed(2)} kW DC / ${totalAcKw.toFixed(2)} kW AC) — ` +
        `some clipping expected at peak irradiance.`,
      context: { ratio, totalDcKw, totalAcKw, threshold: DC_AC_CLIPPING_BANDS.MILD_MAX },
      recommendation:
        `System is electrically feasible. Consider inverter upsizing to bring ratio to 1.20–1.55 if clipping is a concern.`,
    });
  }
  // (Removed an unreachable `ratio < 0.8` branch: every ratio < 1.0 already
  // returns via DC_AC_RATIO_AC_EXCEEDS_DC above, so it could never fire.)

  // Brand-specific tightening — only emit if we haven't already failed.
  const brand = getBrandProfile(sizingResult.brand.id);
  const range = brand?.compatibility?.dcAcRatioRange;
  if (range && issues.length === 0) {
    if (ratio > range.max) {
      issues.push({
        code: 'DC_AC_RATIO_BRAND_MAX',
        severity: 'warning',
        message: `DC/AC ratio ${roundedRatio} exceeds ${sizingResult.brand.displayName}'s recommended max (${range.max}).`,
        context: { ratio, brandMax: range.max, totalDcKw, totalAcKw },
      });
    } else if (ratio < range.min) {
      // When the brand requires DC/AC >= 1.0 (e.g. SolarEdge min=1.0), treat
      // brand-min violation as an error (not just a warning) because the brand
      // spec explicitly forbids it.
      const brandMinSeverity = range.min >= 1.0 ? 'error' : 'warning';
      issues.push({
        code: 'DC_AC_RATIO_BRAND_MIN',
        severity: brandMinSeverity,
        message: `DC/AC ratio ${roundedRatio} is below ${sizingResult.brand.displayName}'s required minimum (${range.min}).`,
        context: { ratio, brandMin: range.min, totalDcKw, totalAcKw },
      });
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 3 — Inverter validation
// ═════════════════════════════════════════════════════════════════════════════

/**
 * NOTE (v47.370, Phase 12.5): `sizingResult.inverterCount` represents
 * PHYSICAL units (i.e. real hardware count — for micro topology this is
 * the number of microinverters, for string this is the number of string
 * inverters, etc). It is NEVER the count of UI inverter cards. This
 * function's checks are all in the physical-unit semantic space. If any
 * future check needs to compare against UI config, it MUST route through
 * lib/system/normalizedInverter.ts — never via raw length arithmetic.
 */
export function validateInverter(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  if (sizingResult.inverterCount <= 0) {
    issues.push({
      code: 'INVERTER_MISSING',
      severity: 'error',
      message: 'System has no valid inverter.',
      context: { inverterCount: sizingResult.inverterCount },
      recommendation: 'Select a brand/inverter or re-run sizing.',
    });
    return issues;
  }

  if (sizingResult.inverterModels.length === 0) {
    issues.push({
      code: 'INVERTER_MODELS_EMPTY',
      severity: 'error',
      message: 'Inverter count > 0 but no model data is attached.',
      context: { inverterCount: sizingResult.inverterCount },
    });
    return issues;
  }

  // Total inverterCount must equal sum of model qty.
  const sumQty = sizingResult.inverterModels.reduce((s, m) => s + m.qty, 0);
  if (sumQty !== sizingResult.inverterCount) {
    issues.push({
      code: 'INVERTER_COUNT_DRIFT',
      severity: 'error',
      message: `inverterCount (${sizingResult.inverterCount}) does not match sum of model qty (${sumQty}).`,
      context: { inverterCount: sizingResult.inverterCount, sumQty },
    });
  }

  // Capacity must support DC size (micro topology exempt — DC/AC is 1:1).
  if (sizingResult.topology !== 'micro') {
    const panelWattage = sizingResult.input.panelWattage ?? 400;
    const totalDcKw = (sizingResult.input.panelCount * panelWattage) / 1000;
    const totalDcKwMax = sizingResult.inverterModels.reduce(
      (s, m) => s + m.dcKwMax * m.qty, 0,
    );
    if (totalDcKwMax > 0 && totalDcKw > totalDcKwMax * 1.05) {
      // Allow 5% tolerance — some designers intentionally slightly overclock.
      issues.push({
        code: 'INVERTER_DC_OVERCAPACITY',
        severity: 'error',
        message: `System DC size ${totalDcKw.toFixed(2)} kW exceeds inverter DC capacity ${totalDcKwMax.toFixed(2)} kW by >5%.`,
        context: { totalDcKw, totalDcKwMax },
        recommendation: 'Add an inverter unit or upsize to a larger model.',
      });
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 4 — String validation
// ═════════════════════════════════════════════════════════════════════════════
//
// Each string must respect min/max panels per string. Non-conforming strings
// cause real-world commissioning failures. Balance check emits a WARNING
// when strings on the SAME MPPT vary wildly (imbalance causes losses).
// ─────────────────────────────────────────────────────────────────────────────

export function validateStrings(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  // Micro / no strings → nothing to validate here.
  if (sizingResult.topology === 'micro' || sizingResult.strings.length === 0) {
    return issues;
  }

  const brand = getBrandProfile(sizingResult.brand.id);
  if (!brand) return issues;

  for (const s of sizingResult.strings) {
    // Find the model this string belongs to.
    const modelRef = brand.supportedInverterModels.find(m => {
      const sized = sizingResult.inverterModels[s.modelIndex];
      return sized && m.equipmentDbId === sized.equipmentDbId;
    });
    if (!modelRef) continue; // Unknown model — RULE 8 would catch it elsewhere.

    const min = modelRef.minPanelsPerString;
    const max = modelRef.maxPanelsPerString;

    if (min !== undefined && s.panelCount < min) {
      issues.push({
        code: 'STRING_BELOW_MIN',
        severity: 'error',
        message: `String ${s.index + 1} has ${s.panelCount} panels (minimum is ${min}).`,
        context: { stringIndex: s.index, panelCount: s.panelCount, min },
        recommendation: `Add at least ${min - s.panelCount} panel(s) or remove the string.`,
      });
    }
    if (max !== undefined && s.panelCount > max) {
      issues.push({
        code: 'STRING_ABOVE_MAX',
        severity: 'error',
        message: `String ${s.index + 1} has ${s.panelCount} panels (maximum is ${max}).`,
        context: { stringIndex: s.index, panelCount: s.panelCount, max },
        recommendation: `Remove ${s.panelCount - max} panel(s) or split the string.`,
      });
    }
  }

  // Balance check: within each physical inverter unit, panel counts across
  // its strings should be within ±30% of that unit's mean. Wild imbalance
  // causes MPPT inefficiency.
  const byUnit = new Map<number, number[]>();
  for (const s of sizingResult.strings) {
    if (!byUnit.has(s.inverterIndex)) byUnit.set(s.inverterIndex, []);
    byUnit.get(s.inverterIndex)!.push(s.panelCount);
  }
  for (const [unitIdx, counts] of byUnit) {
    if (counts.length < 2) continue; // Single-string unit, nothing to balance.
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean <= 0) continue;
    const maxDeviation = Math.max(...counts.map(c => Math.abs(c - mean) / mean));
    if (maxDeviation > 0.30) {
      issues.push({
        code: 'STRING_IMBALANCE',
        severity: 'warning',
        message: `Inverter #${unitIdx + 1} strings are imbalanced (${counts.join(', ')} panels; >30% deviation from mean).`,
        context: { inverterIndex: unitIdx, counts, mean, maxDeviation },
        recommendation: 'Rebalance strings for even MPPT input.',
      });
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 5 — Topology consistency
// ═════════════════════════════════════════════════════════════════════════════
//
// A micro-topology system must have no string-layout artifacts. A string
// or hybrid system must have no micro components. Catches cross-contamination
// from stale state (switched brand but old components stuck around).
// ─────────────────────────────────────────────────────────────────────────────

export function validateTopologyConsistency(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  const topo: string = sizingResult.topology;
  const isMicro = topo === 'micro';

  // Category sets used by the cross-contamination check below.
  const microOnly = new Set(['microinverter', 'trunk_cable', 'terminator', 'micro_combiner']);
  const stringOnly = new Set(['string_inverter', 'optimizer', 'dc_combiner']);

  if (isMicro) {
    // Micro: strings[] should be empty; microDeviceCount > 0.
    if (sizingResult.strings.length > 0) {
      issues.push({
        code: 'TOPOLOGY_MICRO_HAS_STRINGS',
        severity: 'error',
        message: `Micro topology should not have string layout (${sizingResult.strings.length} strings present).`,
        context: { topology: topo, stringCount: sizingResult.strings.length },
      });
    }
    if (sizingResult.microDeviceCount <= 0) {
      issues.push({
        code: 'TOPOLOGY_MICRO_NO_DEVICES',
        severity: 'error',
        message: 'Micro topology has 0 microinverter devices.',
        context: { topology: topo },
      });
    }
    // Cross-contamination: micro topology must not carry string components.
    for (const rc of sizingResult.requiredComponents) {
      if (stringOnly.has(rc.category)) {
        issues.push({
          code: 'TOPOLOGY_MICRO_STRINGCOMPONENT',
          severity: 'error',
          message: `Micro topology has forbidden component category '${rc.category}'.`,
          context: { topology: topo, category: rc.category },
        });
      }
    }
    return issues;
  }

  // Non-micro: microDeviceCount must be 0; strings[] must be present.
  if (sizingResult.microDeviceCount > 0) {
    issues.push({
      code: 'TOPOLOGY_NONMICRO_HAS_MICROS',
      severity: 'error',
      message: `${topo} topology should not have microinverters (${sizingResult.microDeviceCount} present).`,
      context: { topology: topo, microDeviceCount: sizingResult.microDeviceCount },
      recommendation: 'Re-run sizing to strip stale micro components.',
    });
  }
  if (sizingResult.strings.length === 0 && sizingResult.input.panelCount > 0) {
    issues.push({
      code: 'TOPOLOGY_NONMICRO_NO_STRINGS',
      severity: 'error',
      message: `${topo} topology requires strings but none were generated.`,
      context: { topology: topo, panelCount: sizingResult.input.panelCount },
    });
  }
  // Cross-contamination: non-micro topology must not carry micro components.
  for (const rc of sizingResult.requiredComponents) {
    if (microOnly.has(rc.category)) {
      issues.push({
        code: 'TOPOLOGY_NONMICRO_MICROCOMPONENT',
        severity: 'error',
        message: `${topo} topology has forbidden micro component category '${rc.category}'.`,
        context: { topology: topo, category: rc.category },
      });
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 6 — Battery validation
// ═════════════════════════════════════════════════════════════════════════════

export function validateBattery(input: ValidationInput): ValidationIssue[] {
  const { sizingResult, bomItems } = input;
  const issues: ValidationIssue[] = [];

  const batteryEnabled = sizingResult.input.batteryEnabled === true;
  const battery = sizingResult.battery;

  if (batteryEnabled) {
    if (!battery) {
      issues.push({
        code: 'BATTERY_ENABLED_NO_SIZING',
        severity: 'error',
        message: 'Battery is enabled but no battery sizing was produced.',
        context: {},
        recommendation: 'Re-run sizing with a battery-capable brand.',
      });
    } else {
      if (battery.installedKwh <= 0) {
        issues.push({
          code: 'BATTERY_ZERO_KWH',
          severity: 'error',
          message: 'Battery is enabled but installed kWh is 0.',
          context: { installedKwh: battery.installedKwh },
        });
      }
      // Brand ecosystem compatibility: if brand profile declares
      // recommendedBatteryBrands, warn when battery.brandId doesn't match.
      const brand = getBrandProfile(sizingResult.brand.id);
      const recommended = brand?.battery?.recommendedBatteryBrands;
      if (recommended && recommended.length > 0 && !recommended.includes(battery.brandId)) {
        issues.push({
          code: 'BATTERY_BRAND_MISMATCH',
          severity: 'warning',
          message: `Battery brand '${battery.brandId}' is not a recommended match for ${sizingResult.brand.displayName} (recommended: ${recommended.join(', ')}).`,
          context: { batteryBrand: battery.brandId, recommended },
        });
      }
      // Topology compatibility: micro systems usually don't take a DC-coupled
      // battery without AC-coupled inverter; warn.
      if (sizingResult.topology === 'micro' && battery.strategy !== 'single_pack') {
        issues.push({
          code: 'BATTERY_MICRO_TOPOLOGY',
          severity: 'warning',
          message: 'Battery is enabled on a micro-topology system — verify AC-coupling strategy.',
          context: { topology: sizingResult.topology, strategy: battery.strategy },
        });
      }
    }
  } else {
    // Battery disabled: sizingResult.battery must be null, and BOM must have
    // no battery items.
    if (battery !== null) {
      issues.push({
        code: 'BATTERY_DISABLED_BUT_SIZED',
        severity: 'error',
        message: 'Battery is disabled but sizing engine produced a battery block.',
        context: { battery },
      });
    }
    if (bomItems) {
      const batteryItems = bomItems.filter(bi =>
        bi.category === 'battery' ||
        bi.category === 'battery_module' ||
        bi.category === 'battery_combiner' ||
        bi.category === 'smart_meter',
      );
      if (batteryItems.length > 0) {
        issues.push({
          code: 'BATTERY_DISABLED_BUT_IN_BOM',
          severity: 'error',
          message: `Battery is disabled but BOM still contains ${batteryItems.length} battery-related item(s).`,
          context: { count: batteryItems.length, categories: batteryItems.map(b => b.category) },
          recommendation: 'Rebuild BOM after toggling battery off.',
        });
      }
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 7 — Brand compatibility
// ═════════════════════════════════════════════════════════════════════════════

export function validateBrandCompatibility(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  const brand = getBrandProfile(sizingResult.brand.id);
  if (!brand) return issues;

  const sysType = sizingResult.input.systemType;
  if (!brand.supportedSystemTypes.includes(sysType)) {
    issues.push({
      code: 'BRAND_SYSTEM_UNSUPPORTED',
      severity: 'warning',
      message: `${brand.displayName} does not officially support ${sysType} systems (supports: ${brand.supportedSystemTypes.join(', ')}).`,
      context: { brand: brand.id, systemType: sysType, supported: brand.supportedSystemTypes },
      recommendation: 'Consider a brand that officially supports this system type.',
    });
  }

  // Topology contradiction: brand.topology should equal sizingResult.topology.
  if (brand.topology !== sizingResult.topology) {
    issues.push({
      code: 'BRAND_TOPOLOGY_DRIFT',
      severity: 'error',
      message: `Brand ${brand.displayName} declares '${brand.topology}' topology but sizing produced '${sizingResult.topology}'.`,
      context: { brandTopology: brand.topology, actualTopology: sizingResult.topology },
    });
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 8 — BOM consistency
// ═════════════════════════════════════════════════════════════════════════════
//
// Only runs when bomItems is provided. Checks: panel count agrees with
// sizing, required components from sizingResult are present in BOM, no
// cross-brand contamination (e.g., EcoFlow-branded items present on a
// SolarEdge system).
// ─────────────────────────────────────────────────────────────────────────────

export function validateBomConsistency(input: ValidationInput): ValidationIssue[] {
  const { sizingResult, bomItems } = input;
  const issues: ValidationIssue[] = [];

  if (!bomItems || bomItems.length === 0) return issues;

  // Panel count in BOM should agree with sizing.
  const panelItems = bomItems.filter(bi => bi.category === 'panel' || bi.category === 'module');
  const totalPanelQty = panelItems.reduce((s, p) => s + p.quantity, 0);
  if (totalPanelQty > 0 && totalPanelQty !== sizingResult.input.panelCount) {
    issues.push({
      code: 'BOM_PANEL_COUNT_MISMATCH',
      severity: 'error',
      message: `BOM has ${totalPanelQty} panels but sizing expects ${sizingResult.input.panelCount}.`,
      context: { bomCount: totalPanelQty, sizingCount: sizingResult.input.panelCount },
      recommendation: 'Rebuild BOM from the current sizing result.',
    });
  }

  // Required components from sizing should be represented in BOM.
  const bomCategories = new Set(bomItems.map(bi => bi.category));
  for (const rc of sizingResult.requiredComponents) {
    if (rc.required && rc.qty > 0 && !bomCategories.has(rc.category)) {
      issues.push({
        code: 'BOM_REQUIRED_MISSING',
        severity: 'error',
        message: `Required component '${rc.category}' (qty ${rc.qty}) is missing from BOM.`,
        context: { category: rc.category, requiredQty: rc.qty },
        recommendation: 'Rebuild BOM to include sizing engine required components.',
      });
    }
  }

  // Cross-brand contamination: ensure BOM manufacturers align with the
  // sized brand (best-effort — not all items carry a clean manufacturer
  // string, so we only flag when we're sure).
  const brandMfr = sizingResult.brand.manufacturer.toLowerCase();
  const stalePrefixes = ['ecoflow', 'enphase', 'fronius', 'solaredge']
    .filter(p => p !== brandMfr.toLowerCase());
  for (const bi of bomItems) {
    const mfr = (bi.manufacturer ?? '').toLowerCase();
    if (!mfr) continue;
    // Only flag inverter-stage categories to avoid false positives on
    // commodity items (wire, fasteners, etc.).
    const isInverterCategory =
      bi.category === 'inverter' ||
      bi.category === 'microinverter' ||
      bi.category === 'optimizer' ||
      bi.category === 'hybrid_inverter';
    if (!isInverterCategory) continue;
    for (const stale of stalePrefixes) {
      if (mfr.includes(stale)) {
        issues.push({
          code: 'BOM_STALE_BRAND',
          severity: 'error',
          message: `BOM contains stale ${stale} component '${bi.model}' (current brand: ${sizingResult.brand.displayName}).`,
          context: { model: bi.model, manufacturer: bi.manufacturer, category: bi.category, currentBrand: brandMfr },
          recommendation: 'Rebuild BOM to remove stale components from prior brand.',
        });
        break;
      }
    }
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 9 — Structural / electrical cross-check
// ═════════════════════════════════════════════════════════════════════════════

export function validateStructuralElectrical(input: ValidationInput): ValidationIssue[] {
  const { sizingResult, systemDefinition } = input;
  const issues: ValidationIssue[] = [];

  if (!systemDefinition) return issues;

  // systemType alignment: SystemDefinition.systemType should match sizing input.
  if (systemDefinition.systemType !== sizingResult.input.systemType) {
    issues.push({
      code: 'SYSTEMTYPE_MISMATCH',
      severity: 'warning',
      message: `SystemDefinition systemType '${systemDefinition.systemType}' does not match sizing input '${sizingResult.input.systemType}'.`,
      context: {
        sysDefType: systemDefinition.systemType,
        sizingType: sizingResult.input.systemType,
      },
      recommendation: 'Reconcile SystemDefinition and sizing inputs.',
    });
  }

  // Electrical definition sanity: if it declares an inverterManufacturer
  // that differs from the sized brand, warn (user may have stale state).
  const elecMfr = systemDefinition.electrical?.inverterManufacturer;
  if (elecMfr && elecMfr.toLowerCase() !== sizingResult.brand.manufacturer.toLowerCase()) {
    issues.push({
      code: 'ELECTRICAL_INVERTER_MFR_DRIFT',
      severity: 'warning',
      message: `SystemDefinition.electrical.inverterManufacturer '${elecMfr}' differs from sized brand '${sizingResult.brand.manufacturer}'.`,
      context: {
        sysDefMfr: elecMfr,
        sizedMfr: sizingResult.brand.manufacturer,
      },
      recommendation: 'Update SystemDefinition.electrical or reselect brand.',
    });
  }

  return issues;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 10 — Engine output consistency
// ═════════════════════════════════════════════════════════════════════════════
//
// Internal sanity check on the sizing result itself. Catches bugs where the
// engine produced self-inconsistent output (string indices out of range,
// orphaned modelIndex references, etc.).
// ─────────────────────────────────────────────────────────────────────────────

export function validateEngineOutputConsistency(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;
  const issues: ValidationIssue[] = [];

  // modelIndex on every string must be in range.
  for (const s of sizingResult.strings) {
    if (s.modelIndex < 0 || s.modelIndex >= sizingResult.inverterModels.length) {
      issues.push({
        code: 'ENGINE_STRING_MODELINDEX_OOB',
        severity: 'error',
        message: `String ${s.index + 1} has modelIndex=${s.modelIndex} out of range (${sizingResult.inverterModels.length} models).`,
        context: { stringIndex: s.index, modelIndex: s.modelIndex },
      });
    }
    // inverterIndex range: 0..inverterCount-1.
    if (s.inverterIndex < 0 || s.inverterIndex >= sizingResult.inverterCount) {
      issues.push({
        code: 'ENGINE_STRING_INVERTERINDEX_OOB',
        severity: 'error',
        message: `String ${s.index + 1} has inverterIndex=${s.inverterIndex} out of range (${sizingResult.inverterCount} units).`,
        context: { stringIndex: s.index, inverterIndex: s.inverterIndex, inverterCount: sizingResult.inverterCount },
      });
    }
    if (s.panelCount <= 0) {
      issues.push({
        code: 'ENGINE_STRING_ZERO_PANELS',
        severity: 'error',
        message: `String ${s.index + 1} has 0 panels.`,
        context: { stringIndex: s.index },
      });
    }
  }

  // Every physical unit should have at least one string (except for the
  // degenerate zero-panel case, which RULE 1 already caught).
  if (
    sizingResult.topology !== 'micro' &&
    sizingResult.input.panelCount > 0 &&
    sizingResult.inverterCount > 0
  ) {
    const coveredUnits = new Set(sizingResult.strings.map(s => s.inverterIndex));
    for (let i = 0; i < sizingResult.inverterCount; i++) {
      if (!coveredUnits.has(i)) {
        issues.push({
          code: 'ENGINE_UNIT_EMPTY',
          severity: 'error',
          message: `Inverter unit #${i + 1} has no strings assigned.`,
          context: { inverterIndex: i, inverterCount: sizingResult.inverterCount },
          recommendation: 'Remove the extra unit or rebalance strings.',
        });
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 11 — Brand Ecosystem compatibility (Phase 15)
// ═══════════════════════════════════════════════════════════════════════
//
// Runs the centralized compatibility matrix and maps its findings into
// validation issues. Covers:
//   - inverter ↔ battery ecosystem (hard + soft)
//   - brand ↔ systemType support
//   - cross-brand exclusions
//   - topology drift from declared brand
//   - battery required-but-disabled (and inverse)
//
// This is intentionally distinct from RULE 7 (validateBrandCompatibility):
//   RULE 7 checks that the sizing RESULT is internally consistent with its
//   own brand profile (topology/systemType sanity of the engine's output).
//   RULE 11 checks the USER'S COMBINATION against the cross-brand matrix
//   (e.g., user picked Enphase inverter + EcoFlow battery — a scenario
//   the sizing engine wouldn't produce on its own but the user CAN
//   configure manually).
// ═══════════════════════════════════════════════════════════════════════

export function validateBrandEcosystem(input: ValidationInput): ValidationIssue[] {
  const { sizingResult } = input;

  // The user's effective inverter brand is already baked into sizingResult.brand.
  // The battery brand comes either from the sized battery block or the input.
  const inverterBrandId = sizingResult.brand.id;
  const batteryEnabled = !!sizingResult.battery || !!sizingResult.input.batteryEnabled;
  const batteryBrandId =
    sizingResult.battery?.brandId ??
    sizingResult.input.selectedBatteryBrand ??
    null;

  const compat = evaluateCompatibility({
    inverterBrandId,
    batteryBrandId,
    batteryEnabled,
    systemType: sizingResult.input.systemType,
    topology: sizingResult.topology,
  });

  // Map compatibility issues to validation issues (same shape, just a
  // different enum universe for the code field).
  return compat.issues.map((ci: CompatibilityIssue) => ({
    code: ci.code, // Already a stable token (e.g. INCOMPATIBLE_CROSS_BRAND).
    severity: ci.severity,
    message: ci.message,
    context: {
      ...(ci.context ?? {}),
      // Attach the matrix's corrective suggestion when present so the
      // UI can surface a one-click fix alongside this issue.
      ...(compat.suggestion ? { suggestion: compat.suggestion } : {}),
    },
    recommendation: ci.recommendation,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// RULE 12 — BOS (Balance-of-System) requirements (Phase 15)
// ═══════════════════════════════════════════════════════════════════════
//
// When a BOM is provided, confirm it contains every BOS category the
// topology requires (per REQUIRED_BOS_BY_TOPOLOGY). This complements
// RULE 8 (validateBomConsistency) which only checks the *specific*
// requiredComponents list emitted by the sizing engine. RULE 12 is
// the topology-level safety net — e.g., "an optimizer system MUST
// have 'optimizer' category in BOM" regardless of which optimizer
// equipment-db id was chosen.
// ═══════════════════════════════════════════════════════════════════════

export function validateBosRequirements(input: ValidationInput): ValidationIssue[] {
  const { sizingResult, bomItems } = input;
  const issues: ValidationIssue[] = [];

  // Skip when no BOM is present — RULE 8 already handles the "no bom"
  // case by being a no-op.
  if (!bomItems || bomItems.length === 0) return issues;

  const bomCategories = bomItems.map(bi => bi.category);
  const missing = findMissingBosCategories(sizingResult.topology, bomCategories);

  for (const cat of missing) {
    issues.push({
      code: 'MISSING_BOS_CATEGORY',
      severity: 'error',
      message: `Topology '${sizingResult.topology}' requires BOM category '${cat}' but it is missing.`,
      context: {
        topology: sizingResult.topology,
        missingCategory: cat,
        presentCategories: Array.from(new Set(bomCategories)),
      },
      recommendation:
        `Add the required '${cat}' component to the BOM (rebuild from the current sizing result).`,
    });
  }

  return issues;
}

// ─── Local re-exports for consumers that want types without pulling the whole module
export type { SystemType, TopologyFamily };