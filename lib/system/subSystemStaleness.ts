// ═══════════════════════════════════════════════════════════════
// Per-subsystem STALENESS GATE — Wave 3 item 2 of
// docs/ARCHITECTURE-per-subsystem-equipment.md (FROZEN CONTRACT v1.0, §3).
//
// The engineering page's hydration gate historically compared the WHOLE
// saved inverter fleet's panel total against the WHOLE project panel count
// and discarded everything on mismatch. On a hybrid project that meant a
// fence CAD edit (fence 17→20 panels) nuked the roof AND ground engineering
// state too. This module re-keys the gate PER SUB:
//
//   • ≤1 sub present in the layout stamps → 'legacy-total' mode, decision
//     IDENTICAL to the historical gate (I-1/I-10: single-system projects
//     behave byte-for-byte like today).
//   • ≥2 subs present → each sub's fleet is compared against ITS OWN
//     stamped panel count; only MISMATCHED fleets are discarded. The
//     equipment CHOICE survives regardless — it lives in config.subSystems
//     (§1.1 authority hierarchy), which this gate never touches.
//
// Pure and dependency-light — unit-tested in tests/goldens/wave3-page.test.ts.
// ═══════════════════════════════════════════════════════════════

import { SUB_SYSTEM_KEYS, type SubSystemKey } from './subSystemEquipment';
import {
  fleetPanelTotal,
  partitionFleet,
  type FleetInverterLike,
} from './subSystemFleet';

export interface PerSubStalenessInput<T extends FleetInverterLike> {
  /** The saved config's inverters (tagged at the hydration boundary — Wave 3.1). */
  inverters: readonly T[];
  /**
   * Panel counts per sub from layouts.panels stamps (§1.1 membership
   * authority). Keys with 0/absent counts are treated as NOT present.
   */
  expectedBySub: Partial<Record<SubSystemKey, number>>;
  /** Whole-project authoritative panel count (layout > seed) — legacy-mode comparator. */
  expectedTotal: number;
  /** §1.5 inherit-chain key for untagged inverters (config.systemType ?? cad). */
  fallbackKey: SubSystemKey;
}

export interface PerSubStalenessResult<T extends FleetInverterLike> {
  /** Fleets that survive the gate (original relative order preserved). */
  keptInverters: T[];
  /** Sub keys whose fleets were discarded (empty in legacy mode unless all discarded). */
  discardedKeys: SubSystemKey[];
  anyDiscarded: boolean;
  mode: 'legacy-total' | 'per-sub';
}

/** Sub keys with a positive expected count, in fixed roof > ground > fence order. */
export function presentStampKeys(
  expectedBySub: Partial<Record<SubSystemKey, number>>,
): SubSystemKey[] {
  return SUB_SYSTEM_KEYS.filter(k => (expectedBySub[k] ?? 0) > 0);
}

/**
 * The gate. Decision table:
 *
 *  legacy-total (≤1 present sub): discard ALL inverters iff
 *    savedTotal > 0 && expectedTotal > 0 && savedTotal !== expectedTotal
 *  — byte-for-byte the historical behavior.
 *
 *  per-sub (≥2 present subs): for each fleet key K:
 *    fleetTotal(K) > 0 && fleetTotal(K) !== (expectedBySub[K] ?? 0) → discard K.
 *    (expected 0 means the layout no longer stamps panels for that sub —
 *     the fleet is stale by definition.)
 *  Fleets that match keep their inverters; subs with stamps but no fleet
 *  are left to per-sub smart defaults (Wave 3 item 4).
 */
export function gateStaleFleetPerSub<T extends FleetInverterLike>(
  input: PerSubStalenessInput<T>,
): PerSubStalenessResult<T> {
  const { inverters, expectedBySub, expectedTotal, fallbackKey } = input;
  const present = presentStampKeys(expectedBySub);

  if (present.length <= 1) {
    const savedTotal = fleetPanelTotal(inverters);
    const stale = savedTotal > 0 && expectedTotal > 0 && savedTotal !== expectedTotal;
    return {
      keptInverters: stale ? [] : [...inverters],
      discardedKeys: stale
        ? SUB_SYSTEM_KEYS.filter(k => (partitionFleet(inverters, fallbackKey)[k]?.length ?? 0) > 0)
        : [],
      anyDiscarded: stale,
      mode: 'legacy-total',
    };
  }

  const part = partitionFleet(inverters, fallbackKey);
  const discardedKeys: SubSystemKey[] = [];
  for (const key of SUB_SYSTEM_KEYS) {
    const fleet = part[key];
    if (!fleet || fleet.length === 0) continue;
    const fleetTotal = fleetPanelTotal(fleet);
    const expected = expectedBySub[key] ?? 0;
    if (fleetTotal > 0 && fleetTotal !== expected) discardedKeys.push(key);
  }

  if (discardedKeys.length === 0) {
    return { keptInverters: [...inverters], discardedKeys: [], anyDiscarded: false, mode: 'per-sub' };
  }

  const discarded = new Set(discardedKeys);
  const keptInverters = inverters.filter(inv => {
    const key = SUB_SYSTEM_KEYS.find(k => part[k]?.includes(inv))!;
    return !discarded.has(key);
  });
  return { keptInverters, discardedKeys, anyDiscarded: true, mode: 'per-sub' };
}

/**
 * Wave 3 item 2 — per-sub version of the v61.12 inactive-inverter gate.
 * Legacy behavior (≤1 fleet) checks inverters[0] only and discards the whole
 * array; per-sub (≥2 fleets) checks each fleet's PRIMARY inverter and
 * discards only the fleets whose primary is inactive/legacy-dead.
 */
export function gateInactiveInverterPerSub<T extends FleetInverterLike>(
  inverters: readonly T[],
  fallbackKey: SubSystemKey,
  isStaleInverterId: (inverterId: string) => boolean,
): PerSubStalenessResult<T> {
  const part = partitionFleet(inverters, fallbackKey);
  const presentKeys = SUB_SYSTEM_KEYS.filter(k => (part[k]?.length ?? 0) > 0);

  if (presentKeys.length <= 1) {
    const stale = inverters.length > 0 && isStaleInverterId(String(inverters[0]?.inverterId ?? ''));
    return {
      keptInverters: stale ? [] : [...inverters],
      discardedKeys: stale ? presentKeys : [],
      anyDiscarded: stale,
      mode: 'legacy-total',
    };
  }

  const discardedKeys = presentKeys.filter(k =>
    isStaleInverterId(String(part[k]![0]?.inverterId ?? '')),
  );
  if (discardedKeys.length === 0) {
    return { keptInverters: [...inverters], discardedKeys: [], anyDiscarded: false, mode: 'per-sub' };
  }
  const discarded = new Set(discardedKeys);
  const keptInverters = inverters.filter(inv => {
    const key = SUB_SYSTEM_KEYS.find(k => part[k]?.includes(inv))!;
    return !discarded.has(key);
  });
  return { keptInverters, discardedKeys, anyDiscarded: true, mode: 'per-sub' };
}
