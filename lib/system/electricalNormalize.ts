// ============================================================
// electricalNormalize — Electrical String Validity Enforcer
// ============================================================
//
// PURPOSE:
//   Detect and repair a 1×N electrical violation:
//     A single string carrying more panels than the inverter's
//     maxPanelsPerString allows for non-micro topology.
//
// This is a SEPARATE concern from buildInverterConfig's metadata
// invariants (stringsPerInverter === strings.length). That check
// catches structural inconsistency. This check catches electrical
// invalidity — a structurally consistent but electrically wrong
// config like strings:[{panelCount:44}] for a Solis inverter
// whose maxPanelsPerString is 13.
//
// DETECTION RULE:
//   For non-micro topology:
//     if (strings.length === 1 && strings[0].panelCount > maxPanelsPerString)
//     → 1×N violation — must rebuild
//
// REPAIR STRATEGY (closure review: ONE string engine, no defaulted facts):
//   1. Look up maxPanelsPerString from brand profile (detection only)
//   2. String the entry's modules through the canonical string engine
//      (lib/system/fleetStringWriters.ts → canonicalStringPartition) for its
//      OWN inverter, with the module's catalogued facts and the caller's
//      design low temperature — never sizeSystemFromBrand on 49.6 V / −10 °C
//      defaults
//   3. Rebuild the entry as one InverterConfig per unit the engine needs —
//      every module kept (this kept only inverterIndex 0 and dropped the rest)
//   No design temperature, no catalogued module, or no valid layout ⇒ the
//   entry is left exactly as it is: the violation stays visible.
//
// IDEMPOTENT: safe to call on already-normalized configs.
// ============================================================

import { getBrandProfileByInverterId } from './brandProfiles';
import { fleetEntryHasEndpoint } from '@/lib/electrical/canonicalStrings';
import { canonicalFleetEntries } from './fleetStringWriters';
import { getPanelById } from '@/lib/equipment-db';
import {
  type InverterConfig,
  type RoofType,
} from './buildInverterConfig';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Conservative ceiling used when no brand profile is found.
 * Any string with more than this many panels is almost certainly
 * a 1×N bug regardless of the inverter model.
 */
export const CONSERVATIVE_MAX_PANELS_PER_STRING = 20;

/**
 * Micro topologies legitimately store all panels in a single
 * logical "string" — never treat that as a 1×N violation.
 */
const MICRO_TYPES = new Set<string>(['micro']);

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns the maximum panels per string for the given inverterId.
 * Looks up the brand profile and finds the matching inverter model.
 * Falls back to CONSERVATIVE_MAX_PANELS_PER_STRING if not found.
 */
export function getMaxPanelsPerString(inverterId: string): number {
  const profile = getBrandProfileByInverterId(inverterId);
  if (!profile) return CONSERVATIVE_MAX_PANELS_PER_STRING;
  const model = profile.supportedInverterModels.find(m => m.equipmentDbId === inverterId);
  return model?.maxPanelsPerString ?? CONSERVATIVE_MAX_PANELS_PER_STRING;
}

/**
 * Returns true if this inverter config is in an electrically invalid
 * 1×N state: a single string carrying more panels than the inverter's
 * maxPanelsPerString allows (non-micro topology only).
 */
export function isElectricallyInvalid(inv: InverterConfig): boolean {
  if (MICRO_TYPES.has(inv.type)) return false; // micro: single string is always valid
  // 🚨 NOTHING TO LAND ON ⇒ NOTHING TO REPAIR. An entry whose inverter the catalogue does not hold
  // (an empty id on a fresh project) has no input window, so it has no string partition to be wrong —
  // it is the "choose a PV inverter" state. Treating it as a 1×N violation is what split a fresh
  // 37-module project into 20 / 17 at CONSERVATIVE_MAX_PANELS_PER_STRING (closure brief §2).
  if (!fleetEntryHasEndpoint(inv)) return false;
  if (inv.strings.length !== 1) return false;  // only 1×N is the known violation pattern
  const totalPanels = inv.strings[0].panelCount;
  if (totalPanels <= 1) return false;           // trivial / empty — not this bug
  const max = getMaxPanelsPerString(inv.inverterId);
  return totalPanels > max;
}

// ── Repair ───────────────────────────────────────────────────────────────────

/**
 * Repair a single 1×N inverter through the one string engine.
 *
 * @param inv     - the invalid InverterConfig (must pass isElectricallyInvalid)
 * @param options - `designTempMin` (the project's NEC 690.7 cold basis) is REQUIRED for a repair:
 *                  without it nothing is re-strung (no −10 °C default)
 * @returns one InverterConfig per unit the engine lays the entry's modules across (every module
 *          kept), or `[inv]` unchanged when no valid layout can be derived — fail-safe: better to show
 *          the violation than to invent a partition
 */
export function repairElectricallyInvalidInverter(
  inv: InverterConfig,
  options: ElectricalNormalizeOptions = {},
): InverterConfig[] {
  const totalPanels = inv.strings.reduce((s, str) => s + str.panelCount, 0);
  const baseStr = inv.strings[0];
  if (typeof options.designTempMin !== 'number' || !Number.isFinite(options.designTempMin)) return [inv];
  const panel = baseStr?.panelId ? getPanelById(baseStr.panelId) : undefined;
  if (!panel) return [inv];
  try {
    const r = canonicalFleetEntries({
      inverterId: inv.inverterId,
      inverterType: inv.type,
      optimizerPeripheralId: inv.optimizerPeripheralId,
      moduleCount: totalPanels,
      panel,
      designTempMin: options.designTempMin,
      stringFields: {
        panelId:        baseStr?.panelId,
        wireGauge:      baseStr?.wireGauge,
        wireLength:     baseStr?.wireLength,
        tilt:           baseStr?.tilt,
        azimuth:        baseStr?.azimuth,
        roofType:       baseStr?.roofType as RoofType,
        mountingSystem: baseStr?.mountingSystem,
      },
      existingIds: [inv.id],
      idPrefix: `${inv.id}-rs`,
      deviceRatioOverride: inv.deviceRatioOverride,
      // Wave 3 (I-2 corollary): an electrical repair must never strip the
      // subsystem tag — a healed fence fleet stays a fence fleet.
      subSystemKey: (inv as { subSystemKey?: 'roof' | 'ground' | 'fence' }).subSystemKey,
    });
    // 🚨 NO CONVENIENCE SPLIT and no defaulted facts: without a valid canonical layout the violation
    // is left visible; the installer re-strings through the engine.
    return r.entries ?? [inv];
  } catch (err) {
    console.warn('[electricalNormalize] the string engine failed; the layout is left as it is:', err);
    return [inv];
  }
}

// ── Config-level normalizer ───────────────────────────────────────────────────

export interface ElectricalNormalizeOptions {
  /** The project's NEC 690.7(A) design low, °C. Required for any repair (never defaulted). */
  designTempMin?: number;
}

export interface ElectricalNormalizeResult<T> {
  config: T;
  /** How many inverters were rebuilt due to 1×N violation */
  rebuiltCount: number;
  /** Debug: which inverters were invalid and why */
  log: ElectricalNormalizeLogEntry[];
}

export interface ElectricalNormalizeLogEntry {
  inverterId: string;
  topology: string;
  source: string;
  panelCount: number;
  maxPanelsPerString: number;
  incomingStringLayout: number[];
  outgoingStringLayout: number[];
  reason: 'preserved' | 'rebuilt_invalid_1xN';
}

/**
 * Inspect every inverter in config.inverters and repair any 1×N
 * electrically-invalid strings using sizeSystemFromBrand.
 *
 * Idempotent — no-op if all inverters are already valid.
 * Never modifies a micro inverter.
 *
 * @param config  - any object with an inverters?: InverterConfig[] field
 * @param options - optional panel specs passed to the sizing engine
 */
export function electricallyNormalizeInverterConfig<T extends { inverters?: unknown }>(
  config: T,
  options: ElectricalNormalizeOptions = {},
): ElectricalNormalizeResult<T> {
  const log: ElectricalNormalizeLogEntry[] = [];
  let rebuiltCount = 0;

  if (!Array.isArray(config.inverters) || config.inverters.length === 0) {
    return { config, rebuiltCount: 0, log };
  }

  const inverters = config.inverters as InverterConfig[];
  let anyChanged = false;

  const newInverters = inverters.flatMap(inv => {
    const incoming = inv.strings.map(s => s.panelCount);
    const maxPPS = getMaxPanelsPerString(inv.inverterId);
    const invalid = isElectricallyInvalid(inv);

    const entry: ElectricalNormalizeLogEntry = {
      inverterId:           inv.inverterId,
      topology:             inv.type,
      source:               '[electricalNormalize]',
      panelCount:           inv.strings.reduce((s, str) => s + str.panelCount, 0),
      maxPanelsPerString:   maxPPS,
      incomingStringLayout: incoming,
      outgoingStringLayout: incoming, // will be updated if repaired
      reason:               'preserved',
    };

    if (!invalid) {
      log.push(entry);
      return [inv];
    }

    console.warn(
      `[STRING NORMALIZE INPUT] inverterId=${inv.inverterId} topology=${inv.type}` +
      ` panelCount=${entry.panelCount} incomingLayout=[${incoming.join(',')}]` +
      ` maxPanelsPerString=${maxPPS} → REBUILDING`
    );

    const repaired = repairElectricallyInvalidInverter(inv, options);
    if (repaired.length === 1 && repaired[0] === inv) {
      log.push(entry);
      return [inv];
    }
    const outgoing = repaired.flatMap(r => r.strings.map(s => s.panelCount));

    entry.outgoingStringLayout = outgoing;
    entry.reason = 'rebuilt_invalid_1xN';
    log.push(entry);

    console.log(
      `[STRING NORMALIZE OUTPUT] inverterId=${inv.inverterId}` +
      ` outgoingLayout=[${repaired.map(r => r.strings.map(s => s.panelCount).join(',')).join(' | ')}]` +
      ` units=${repaired.length}` +
      ` reason=rebuilt_invalid_1xN`
    );

    anyChanged = true;
    rebuiltCount++;
    return repaired;
  });

  if (!anyChanged) {
    return { config, rebuiltCount: 0, log };
  }

  return {
    config: { ...config, inverters: newInverters } as T,
    rebuiltCount,
    log,
  };
}