// ═══════════════════════════════════════════════════════════════════════════
// TIGO RAPID-SHUTDOWN COMPANION HARDWARE
//
// A TS4-A-F is a SLAVE device. It holds its module on only while it receives a
// PLC keep-alive; with no transmitter present it outputs 0.6 V and the array is
// DEAD, not merely unmonitored. The BOM engine emitted TS4-A-F units at one per
// on-building module and nothing to drive them — measured across the catalogue,
// 22 of 48 string inverters reached that branch and ALL 22 produced zero driver
// and zero gateway lines, while the package printed
// "NEC 690.12: Rapid shutdown devices added".
//
// Root cause: gateways are emitted only for STRING_WITH_OPTIMIZER / MICROINVERTER
// / HYBRID_INVERTER / DC_- / AC_COUPLED_BATTERY topologies and sourced from
// `inverterEntry.requiredAccessories`, while the TS4 units are hardcoded into the
// RSD branch carrying no accessory requirements of their own. A plain string
// inverter is in neither set, so the two paths never met.
//
// ─── THE FAMILY SWITCH ─────────────────────────────────────────────────────
// Tigo runs two signalling families that are, verbatim, "not inter-mixable
// within single systems or arrays":
//
//   F / 2F  (fire safety)  → RSS Transmitter + 12 V PSU + enclosure.  TAP = 0, CCA = 0
//   O / S / M (monitoring) → TAP + CCA + RS-485 cable + internet.     Transmitter = 0
//
// This module owns the F-family only — the branch the engine actually emits.
// Adding a TAP or a CCA here would be a category error, and it is the specific
// mistake the price table already contains (a `TAP-` prefixed optimizer row).
//
// Full audited specification, part numbers, prices and the three places Tigo's
// own documents contradict each other: docs/TIGO-TS4-COMPANION-HARDWARE-SPEC.md
// ═══════════════════════════════════════════════════════════════════════════

import type { ProcurementAuthorityState, BomQuantitySource } from '@/lib/bom-types-v4';

/** Strings one transmitter core can carry (Tigo: "up to ten strings with one
 *  core and up to twenty strings with two cores"). Dual-core capacity is
 *  deliberately NOT used to size quantity: the second core is equally often
 *  spent on reach (300-500 m home runs), and both cannot be had at once. */
export const STRINGS_PER_TRANSMITTER_CORE = 10;

/** Bare single-core RSS Transmitter, DIN rail. The 492-xx kit adds the 120/240 V
 *  PSU and an outdoor enclosure; 493-00000-52 is dual-core 277/480 V and ships
 *  with NO enclosure. `493-00000-51` does not exist — it is a plausible-looking
 *  part number that falls out of false symmetry with the 492 pair. */
export const RSS_TRANSMITTER_PART_NUMBER = '490-00000-51';
export const RSS_TRANSMITTER_KIT_PART_NUMBER = '492-00000-51';

/**
 * The TS4-A-F ORDERING NUMBER.
 *
 * `TS4-A-F` alone is a MODEL DESIGNATION, not a purchasable SKU — it was being
 * emitted as the BOM part number, so the row could never match a SKU-keyed price
 * and fell through to a category estimate on the largest DC line of the job.
 *
 * ⚠ VARIANT NOT DERIVED. Tigo publishes several current TS4-A-F ordering
 * numbers, and this is the standard 15 A / 700 W part. `481-00252-62` is the
 * SAME device with a long cable for 72-cell LANDSCAPE layouts, and there is no
 * verified rule in this repo mapping module format to cable length, so it is not
 * inferred — the description carries the condition instead of the code guessing
 * it. Datasheet 002-00093-00 also lists 481-00252-20, 481-00261-32/-62 and the
 * 486-/488- families. Pull the current sheet before locking a variant table.
 */
export const TS4_A_F_PART_NUMBER = '481-00252-32';

/** Named so the two BOM emitters cannot drift apart, and so the variant caveat
 *  travels with the SKU rather than living only in a comment. */
export const TS4_A_F_DESCRIPTION =
  'Rapid shutdown device per NEC 690.12 — 1 per ON-BUILDING module. 15 A / 700 W standard-cable '
  + 'variant; 72-cell LANDSCAPE layouts take the long-cable 481-00252-62 — verify against the '
  + 'module format before ordering.';

/** The facts that decide whether module-level RSD devices are needed at all.
 *  Shared so the BOM engine and the snapshot cannot disagree about it — the
 *  snapshot does not consume BOM rows, so without one predicate the two would be
 *  independent engines answering the same question. `tigoRsdBranchReached`
 *  reproduces the BOM engine's branch exactly; a guard test asserts they agree
 *  across the whole inverter catalogue. */
export interface TigoRsdBranchFacts {
  /** modules ON or IN a building — NEC 690.12 is a mount-location rule. */
  onBuildingModuleCount: number;
  /** false ⇒ AHJ opt-out recorded; nothing is added. */
  rapidShutdownRequired: boolean;
  /** the inverter's own `rapidShutdownCompliant` fact. */
  inverterRsdIntegrated: boolean;
  /** optimizer or microinverter topology — RSD is integrated in the MLPE. */
  topologyIsOptimizerOrMicro: boolean;
}

/** TRUE ⇔ the design needs add-on module-level RSD devices, and therefore a
 *  keep-alive source. Mirrors bom-engine-v4's TS4-A-F branch condition. */
export function tigoRsdBranchReached(f: TigoRsdBranchFacts): boolean {
  return f.rapidShutdownRequired
    && !f.inverterRsdIntegrated
    && !f.topologyIsOptimizerOrMicro
    && (Math.floor(f.onBuildingModuleCount) || 0) > 0;
}

export interface TigoRsdCompanionInput {
  /** modules carrying a TS4-A-F — the branch this companion serves. */
  ts4DeviceCount: number;
  /** total DC strings across the array. */
  stringCount: number;
  /** inverters the strings are distributed across. */
  inverterCount: number;
}

export interface TigoRsdCompanionLine {
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  necReference: string;
  derivedFrom: string;
  formula: string;
  authorityStateHint: ProcurementAuthorityState;
  authorityStateHintReason: string;
  quantitySource: BomQuantitySource;
}

export interface TigoRsdCompanionResult {
  /** empty when no TS4-A-F units are present — never speculative. */
  lines: TigoRsdCompanionLine[];
  /** the blocking requirement code, or null when nothing is emitted. */
  blockerCode: 'TIGO-RSS-TRANSMITTER-UNVERIFIED' | null;
  blockerMessage: string | null;
  /** how many transmitters the design needs, before the exemption is applied. */
  transmitterCount: number;
  /** auditable derivation of that count. */
  basis: string;
}

/**
 * Transmitters required, BEFORE the integrated-transmitter exemption.
 *
 * The rule is Σ over inverters of ceil(strings_i / 10) — **per inverter, never
 * global**. Tigo forbids conductors from two inverters passing through one core
 * and requires 8 in of separation between different transmitters' conductors, so
 * a global ceil(totalStrings / 10) can silently under-count: two inverters of
 * five strings each need TWO transmitters, not one.
 *
 * The engine input carries totals rather than a per-inverter string map, so the
 * strings are assumed evenly distributed. That assumption can only ever
 * OVER-count (an uneven split needs at least as many transmitters), which is the
 * safe direction for a device whose absence kills the array.
 */
export function transmittersRequired(stringCount: number, inverterCount: number): number {
  const inverters = Math.max(1, Math.floor(inverterCount) || 1);
  const strings = Math.max(inverters, Math.floor(stringCount) || inverters);
  const perInverter = Math.ceil(strings / inverters);
  return inverters * Math.ceil(perInverter / STRINGS_PER_TRANSMITTER_CORE);
}

/**
 * The companion line for a TS4-A-F / 2F deployment.
 *
 * ─── WHY THIS IS A CANDIDATE AND NOT AN ORDERABLE LINE ───────────────────────
 * The external transmitter drops to zero only when the inverter carries a
 * factory-integrated Tigo RSS transmitter. That is a per-MODEL fact published on
 * Tigo's UL PVRSS list, and the equipment catalogue has no field for it. The
 * shortcuts are all traps: of 355 UL-PVRSS-certified rows only 43 are "Tigo
 * Enhanced", so keying off certification under-BOMs ~88% of certified inverters;
 * "Tigo Enhanced" itself means an integrated transmitter OR an integrated CCA;
 * and the list's `method` column records what a system was certified WITH, not
 * what is built in (137 rows read "RSS Transmitter" including SMA, Solis and
 * GoodWe, none of which embed one).
 *
 * So the quantity is known and the SELECTION is not — the same shape as the
 * supply-side tap connector. The row is emitted visibly, excluded from the
 * authoritative procurement total, and carries a blocking requirement that
 * clears only when the inverter model is confirmed against the UL PVRSS list.
 * Nothing is guessed, and nothing is silently omitted.
 */
export function resolveTigoRsdCompanions(input: TigoRsdCompanionInput): TigoRsdCompanionResult {
  const devices = Math.max(0, Math.floor(input.ts4DeviceCount) || 0);
  if (devices <= 0) {
    return {
      lines: [], blockerCode: null, blockerMessage: null, transmitterCount: 0,
      basis: 'no TS4-A-F devices on this design — no keep-alive source is required',
    };
  }

  const qty = transmittersRequired(input.stringCount, input.inverterCount);
  const inverters = Math.max(1, Math.floor(input.inverterCount) || 1);
  const perInverter = Math.ceil(Math.max(inverters, input.stringCount || inverters) / inverters);
  const basis =
    `${inverters} inverter(s) × ceil(${perInverter} string(s) per inverter ÷ `
    + `${STRINGS_PER_TRANSMITTER_CORE} per core) = ${qty}`;

  const reason =
    'CANDIDATE TRANSMITTER — the selected inverter model has not been checked against Tigo\'s UL '
    + 'PVRSS list, so it is not established whether it carries a factory-integrated Tigo RSS '
    + 'transmitter. Quantity is derived; the SELECTION is not verified. Excluded from the '
    + 'authoritative procurement total and from every export.';

  return {
    transmitterCount: qty,
    basis,
    blockerCode: 'TIGO-RSS-TRANSMITTER-UNVERIFIED',
    blockerMessage:
      `${devices} TS4-A-F rapid-shutdown device(s) are specified. A TS4-A-F holds its module on only `
      + 'while it receives a PLC keep-alive and outputs 0.6 V without one, so a keep-alive source is '
      + 'required for the array to energize at all. It is NOT established whether the selected '
      + 'inverter carries an integrated Tigo RSS transmitter — confirm the exact inverter model '
      + `against Tigo's UL PVRSS list, or add ${qty} external RSS transmitter(s).`,
    lines: [{
      manufacturer: 'Tigo',
      model: 'RSS Transmitter (single core, DIN rail)',
      partNumber: RSS_TRANSMITTER_PART_NUMBER,
      description:
        'Rapid-shutdown keep-alive transmitter for TS4-A-F / TS4-A-2F devices. Bare unit: a 12 V '
        + '±2% / 1 A supply and, outdoors, a rated enclosure are separate items (the '
        + `${RSS_TRANSMITTER_KIT_PART_NUMBER} kit bundles both).`,
      quantity: qty,
      unit: 'ea',
      necReference: 'NEC 690.12',
      derivedFrom: 'strings per inverter (Tigo: ≤10 conductors per core, one inverter per core)',
      formula: basis,
      authorityStateHint: 'CANDIDATE_NON_ORDERABLE',
      authorityStateHintReason: reason,
      // The count follows the string/inverter topology, not a field measurement.
      quantitySource: 'topology-derived',
    }],
  };
}
