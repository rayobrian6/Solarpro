/**
 * lib/solardog/controlMode.ts
 *
 * SolarPro v61 — Control Modes + Field Locking Engine
 *
 * Pure module — no DB, no React, no Next.js. Safe to import in tests,
 * server code, and client components alike.
 *
 * CONTROL MODES:
 *   auto    → system has full control; overrides user selections silently
 *   guided  → system suggests changes; user must approve overrides (DEFAULT)
 *   manual  → user selections locked; system can only warn, never override
 *
 * FIELD LOCKING:
 *   Per-field boolean map. When a field is locked, auto-config MUST NOT
 *   override it regardless of control mode (even in AUTO mode when
 *   userHasEditedInverters=true, guided/manual locks are respected).
 */

import type { ControlMode, SystemConfigLocks } from '@/types';

export type { ControlMode, SystemConfigLocks };

// ─── Lockable fields ──────────────────────────────────────────────────────────
export type LockableField = keyof SystemConfigLocks;

export const LOCKABLE_FIELDS: LockableField[] = [
  'panel', 'inverter', 'battery', 'strings', 'wiring',
];

// ─── Default locks (all unlocked) ────────────────────────────────────────────
export const DEFAULT_LOCKS: SystemConfigLocks = {
  panel:    false,
  inverter: false,
  battery:  false,
  strings:  false,
  wiring:   false,
};

// ─── Default control mode ────────────────────────────────────────────────────
export const DEFAULT_CONTROL_MODE: ControlMode = 'guided';

// ─── Core decision function ───────────────────────────────────────────────────
/**
 * shouldAllowOverride(field, mode, locks)
 *
 * Returns true if the auto-config engine is allowed to override the given field.
 *
 * Rules:
 *   1. If the field is explicitly locked → NEVER allow override
 *   2. AUTO mode → allow override for all unlocked fields
 *   3. GUIDED mode → do NOT allow silent override (return false; UI shows suggestion)
 *   4. MANUAL mode → NEVER allow override (return false; only warnings)
 *
 * Callers in GUIDED mode should present a SuggestionCard rather than
 * auto-applying. The function returns false so callers know to queue the
 * suggestion instead of applying it directly.
 */
export function shouldAllowOverride(
  field: LockableField,
  mode:  ControlMode,
  locks: SystemConfigLocks,
): boolean {
  // Rule 1: explicit lock always wins
  if (locks[field]) return false;

  // Rule 2: AUTO mode — unrestricted for unlocked fields
  if (mode === 'auto') return true;

  // Rules 3 & 4: GUIDED and MANUAL both require user approval / block override
  return false;
}

/**
 * shouldShowWarning(field, mode, locks)
 *
 * Returns true if the system should show a warning when the field's
 * current value is suboptimal (but the user or mode prevents override).
 *
 * - AUTO + unlocked → no warning (system will fix it)
 * - GUIDED + unlocked → show suggestion card (not a raw warning)
 * - MANUAL + any → show warning only
 * - Any + locked → show warning only
 */
export function shouldShowWarning(
  field: LockableField,
  mode:  ControlMode,
  locks: SystemConfigLocks,
): boolean {
  if (mode === 'auto' && !locks[field]) return false;  // auto fixes it silently
  return true;
}

// ─── Lock management ──────────────────────────────────────────────────────────
/**
 * lockField(locks, field)
 *
 * Returns a new SystemConfigLocks with the given field locked.
 * Immutable — does not mutate the input object.
 */
export function lockField(
  locks: SystemConfigLocks,
  field: LockableField,
): SystemConfigLocks {
  return { ...locks, [field]: true };
}

/**
 * unlockField(locks, field)
 *
 * Returns a new SystemConfigLocks with the given field unlocked.
 */
export function unlockField(
  locks: SystemConfigLocks,
  field: LockableField,
): SystemConfigLocks {
  return { ...locks, [field]: false };
}

/**
 * lockAll(locks)
 *
 * Returns a new SystemConfigLocks with all fields locked.
 */
export function lockAll(): SystemConfigLocks {
  return { panel: true, inverter: true, battery: true, strings: true, wiring: true };
}

/**
 * unlockAll()
 *
 * Returns DEFAULT_LOCKS (all fields unlocked).
 */
export function unlockAll(): SystemConfigLocks {
  return { ...DEFAULT_LOCKS };
}

// ─── Safe apply helper ────────────────────────────────────────────────────────
/**
 * Result of applySafely().
 */
export interface ApplySafelyResult {
  /** Whether the change was applied (true in AUTO mode for unlocked fields) */
  applied: boolean;
  /** Whether a warning should be shown to the user */
  warned:  boolean;
  /** Whether a suggestion card should be presented (GUIDED mode) */
  suggest: boolean;
}

/**
 * applySafely(field, mode, locks, applyFn, warnFn)
 *
 * Decides whether to apply, suggest, or warn based on control mode and locks.
 * Calls applyFn() only when allowed. Calls warnFn() when a warning should show.
 * Returns a result object describing what happened.
 *
 * @param field     The field the engine wants to change
 * @param mode      Current control mode
 * @param locks     Current lock state
 * @param applyFn   Callback to apply the change (called only when allowed)
 * @param warnFn    Callback to show a warning (called when not applied)
 */
export function applySafely(
  field:   LockableField,
  mode:    ControlMode,
  locks:   SystemConfigLocks,
  applyFn: () => void,
  warnFn:  () => void,
): ApplySafelyResult {
  const allowed = shouldAllowOverride(field, mode, locks);
  const warn    = shouldShowWarning(field, mode, locks);
  const suggest = !allowed && mode === 'guided' && !locks[field];

  if (allowed) {
    applyFn();
  } else if (warn) {
    warnFn();
  }

  return { applied: allowed, warned: warn && !allowed, suggest };
}

// ─── Effective locks ──────────────────────────────────────────────────────────
/**
 * effectiveLocks(mode, locks)
 *
 * In MANUAL mode, all fields are effectively locked regardless of the lock map.
 * In AUTO/GUIDED mode, the per-field locks apply normally.
 */
export function effectiveLocks(
  mode:  ControlMode,
  locks: SystemConfigLocks,
): SystemConfigLocks {
  if (mode === 'manual') return lockAll();
  return locks;
}

// ─── Human-readable labels ───────────────────────────────────────────────────
export const CONTROL_MODE_LABELS: Record<ControlMode, string> = {
  auto:    'Auto',
  guided:  'Guided',
  manual:  'Manual',
};

export const CONTROL_MODE_DESCRIPTIONS: Record<ControlMode, string> = {
  auto:    'System optimizes everything automatically. Your panel and inverter selections may be overridden.',
  guided:  'System suggests changes. You approve or reject each override. (Recommended)',
  manual:  'Your selections are locked. System warns but never overrides.',
};

export const FIELD_LABELS: Record<LockableField, string> = {
  panel:    'Panel',
  inverter: 'Inverter',
  battery:  'Battery',
  strings:  'Strings',
  wiring:   'Wiring',
};