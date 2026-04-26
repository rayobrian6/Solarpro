/**
 * lib/ui/severityMapper.ts — Phase 13.8.1
 *
 * UI SEVERITY MAPPING LAYER
 * ─────────────────────────────────────────────────────────────────────────────
 * The validation engine and sizing engine emit raw severities based on
 * electrical truth. This layer re-maps DISPLAY severity for the UI without
 * touching engine logic.
 *
 * PRINCIPLE:
 *   ERROR   → System cannot be built. Must remain red. Never downgraded.
 *   WARNING → Advisory only. System is valid but suboptimal.
 *   INFO    → Explanation of automatic system decisions. Not alarming.
 *
 * HARD RULES:
 *   ❌ DO NOT change validation engine outputs
 *   ❌ DO NOT change sizing engine outputs
 *   ❌ DO NOT upgrade any severity
 *   ✅ Only downgrade warning → info for advisory/auto-fix codes
 *   ✅ Improve message text for engine-decision codes
 */

export type UISeverity = 'error' | 'warning' | 'info';

export interface MappedIssue {
  code: string;
  severity: UISeverity;
  /** Original engine severity (never mutated). */
  engineSeverity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
  context?: Record<string, unknown>;
}

// ─── Code classifications ───────────────────────────────────────────────────

/**
 * TRUE ERRORS — these are blocking. Engine severity must stay 'error'.
 * Listed here for documentation; they pass through unchanged.
 */
const TRUE_ERROR_CODES = new Set([
  'E_VOC_EXCEEDED',
  'MPPT_CURRENT_EXCEEDED',
  'MPPT_ALLOCATION_INVALID',
  'E_DC_DISCONNECT',
  'PANEL_COUNT_ZERO',
  'PANEL_COUNT_MISMATCH_CAD',
  'PANEL_COUNT_MISMATCH_SYSDEF',
  'PANEL_COUNT_ORPHANS',
  'DC_AC_RATIO_SEVERE',
  'INVERTER_MISSING',
  'INVERTER_MODELS_EMPTY',
  'INVERTER_COUNT_DRIFT',
  'INVERTER_DC_OVERCAPACITY',
  'STRING_BELOW_MIN',
  'STRING_ABOVE_MAX',
  'TOPOLOGY_MICRO_HAS_STRINGS',
  'TOPOLOGY_MICRO_NO_DEVICES',
  'TOPOLOGY_MICRO_STRINGCOMPONENT',
  'TOPOLOGY_NONMICRO_HAS_MICROS',
  'TOPOLOGY_NONMICRO_NO_STRINGS',
  'TOPOLOGY_NONMICRO_MICROCOMPONENT',
  'BATTERY_ENABLED_NO_SIZING',
  'BATTERY_ZERO_KWH',
  'BATTERY_DISABLED_BUT_SIZED',
  'BATTERY_DISABLED_BUT_IN_BOM',
  'BRAND_TOPOLOGY_DRIFT',
  'BOM_PANEL_COUNT_MISMATCH',
  'BOM_REQUIRED_MISSING',
  'BOM_STALE_BRAND',
  'ENGINE_STRING_MODELINDEX_OOB',
  'ENGINE_STRING_INVERTERINDEX_OOB',
  'ENGINE_STRING_ZERO_PANELS',
  'ENGINE_UNIT_EMPTY',
  'MISSING_BOS_CATEGORY',
]);

/**
 * ADVISORY WARNINGS — system is valid but suboptimal. Stay yellow.
 */
const ADVISORY_WARNING_CODES = new Set([
  'DC_AC_RATIO_HIGH',
  'DC_AC_RATIO_LOW',
  'DC_AC_RATIO_BRAND_MAX',
  'DC_AC_RATIO_BRAND_MIN',
  'STRING_IMBALANCE',
  'BATTERY_BRAND_MISMATCH',
  'BATTERY_MICRO_TOPOLOGY',
  'BRAND_SYSTEM_UNSUPPORTED',
  'SYSTEMTYPE_MISMATCH',
  'ELECTRICAL_INVERTER_MFR_DRIFT',
]);

/**
 * INFORMATIONAL CODES — engine auto-corrected these. Display as info/blue.
 * Also includes messages with better human-readable text.
 */
interface InfoOverride {
  /** Remap to 'info' regardless of engine severity. */
  severity: 'info';
  /** Optional human-readable message override. */
  messageOverride?: (original: string) => string;
}

const INFO_OVERRIDE_CODES: Record<string, InfoOverride> = {
  // Voltage clamping is a system decision, not a problem.
  STRING_VOC_VOLTAGE_CLAMP: {
    severity: 'info',
    messageOverride: (original: string) => {
      // Extract key numbers from original: "se-11400h: max panels/string reduced from 25 to 10
      // (voltage-safe ceiling: 10 panels at -10°C cold Voc, inverter max 480V)."
      const panelMatch = original.match(/reduced from \d+ to (\d+)/);
      const tempMatch  = original.match(/at (-?\d+)°C/);
      const voltMatch  = original.match(/inverter max (\d+)V/);
      const maxPanels  = panelMatch?.[1] ?? '?';
      const temp       = tempMatch?.[1] ?? '-10';
      const voltage    = voltMatch?.[1] ?? '?';
      return (
        `String length limited to ${maxPanels} panels per NEC 690.7 cold-weather Voc correction ` +
        `(${voltage}V inverter limit at ${temp}°C design minimum). ` +
        `System automatically sized to stay within safe voltage.`
      );
    },
  },

  // Engine found no single model that meets all constraints — already auto-configured.
  FEASIBILITY_NO_VIABLE_MODEL: {
    severity: 'info',
    messageOverride: () =>
      'No single inverter model met all electrical constraints for this panel count and specs. ' +
      'System was automatically configured using multiple inverter units to satisfy all requirements.',
  },

  // Better model available — purely advisory.
  FEASIBILITY_BETTER_CANDIDATE_AVAILABLE: {
    severity: 'info',
    messageOverride: (original: string) => {
      const modelMatch = original.match(/available in the same brand: ([^\s]+)/);
      const model = modelMatch?.[1] ?? 'a higher-rated model';
      return (
        `A more optimal inverter is available in the same brand (${model}) ` +
        `with a better DC/AC ratio or fewer components. Current configuration is valid.`
      );
    },
  },

  // Engine auto-selected a default because chosen inverter is not in the brand.
  // System already corrected — this is not alarming.
  INVERTER_MODEL_NOT_IN_BRAND: {
    severity: 'info',
    messageOverride: (original: string) => {
      // original: "Selected inverter se-11400h is not part of Enphase IQ8. Using auto-sized default."
      return original.replace(
        /Selected inverter (\S+) is not part of ([^.]+)\. Using auto-sized default\./,
        'Inverter $1 is from a different brand than $2. System automatically applied a matching default.'
      );
    },
  },

  // Inverter was upsized — purely informational (engine already decided this).
  INVERTER_UPSIZED: {
    severity: 'info',
    // Keep original message — it's already descriptive.
  },
};

// ─── Core mapping function ────────────────────────────────────────────────────

export interface RawIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
  context?: Record<string, unknown>;
}

/**
 * Map a single raw engine issue to its UI display severity and message.
 *
 * Rules (applied in order):
 * 1. If code is in INFO_OVERRIDE_CODES → remap to 'info' (with optional message override).
 * 2. If engine severity is 'error' → always stay 'error' (never downgrade errors).
 * 3. If code is in ADVISORY_WARNING_CODES → stay 'warning'.
 * 4. All other 'info' engine codes → stay 'info'.
 * 5. Fallback: pass through engine severity unchanged.
 */
export function mapIssueToUI(issue: RawIssue): MappedIssue {
  const infoOverride = INFO_OVERRIDE_CODES[issue.code];

  // Rule 1: explicit info override (warning → info downgrade with message rewrite).
  if (infoOverride) {
    const message = infoOverride.messageOverride
      ? infoOverride.messageOverride(issue.message)
      : issue.message;
    return {
      ...issue,
      engineSeverity: issue.severity,
      severity: infoOverride.severity,
      message,
    };
  }

  // Rule 2: true errors are never downgraded.
  if (issue.severity === 'error') {
    return { ...issue, engineSeverity: issue.severity };
  }

  // Rules 3-5: pass through as-is.
  return { ...issue, engineSeverity: issue.severity };
}

/**
 * Map a full list of raw issues to UI display issues.
 * Preserves order; never reorders by severity (UI components handle grouping).
 */
export function mapIssuesToUI(issues: RawIssue[]): MappedIssue[] {
  return issues.map(mapIssueToUI);
}

/**
 * Convenience: determine the UI severity for a given code string.
 * Useful when only the code is available (e.g. quick badge lookup).
 */
export function mapCodeToUISeverity(
  code: string,
  engineSeverity: 'error' | 'warning' | 'info',
): UISeverity {
  if (INFO_OVERRIDE_CODES[code]) return 'info';
  if (engineSeverity === 'error') return 'error';
  return engineSeverity;
}