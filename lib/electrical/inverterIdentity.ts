// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE REPRESENTATION OF "IS THERE A STANDALONE PV INVERTER, AND WHICH ONE?"
//
// Ray: "Identify the three keys that all mean: current active external PV inverter. Choose one
// writable canonical representation. Legacy names: migration/read compatibility only, no independent
// writes, cannot win. Required active state must distinguish NONE / UNKNOWN / SELECTED(product).
// NONE is valid for PW3 DC-coupled solar. UNKNOWN is not permission to invent equipment."
//
// The three spellings, all meaning the same fact:
//
//   1. `selected_equipment.inverter.id`   — the object form. CANONICAL.
//   2. `selected_equipment.inverterId`    — the flat scalar, written by the Design Studio route.
//   3. `project.selectedInverter`         — a hydrated object that `enrichProjectRow` PROMOTES from
//                                            `productions.data_json` when the project has none.
//
// 🚨 THE THIRD IS THE DANGEROUS ONE. It reads from a store nothing in the authority table lists, and
// it fills a gap — so a DC-coupled project whose inverter was deliberately retired gets one handed
// back to it from an old production snapshot. That is a legacy mirror winning against its owner.
//
// 🚨 AND THE DISTINCTION THAT MAKES IT FIXABLE: an explicit `null` is not a missing key.
//
//   `{ inverter: null, inverterId: null }`  → NONE     — a decision was recorded. Do not fill.
//   `{}` / no selected_equipment            → UNKNOWN  — nobody has said. Still do not invent.
//   `{ inverter: { id: 'x' } }`             → SELECTED
//
// Collapsing those two into "falsy" is what let a gap-filler treat a retirement as an omission.
// ═══════════════════════════════════════════════════════════════════════════

export type ExternalInverterState = 'NONE' | 'UNKNOWN' | 'SELECTED';

export interface ExternalInverterIdentity {
  state: ExternalInverterState;
  /** The catalogue id, only when `state === 'SELECTED'`. */
  productId: string | null;
  /** Which spelling answered, for the authority inspector. */
  readFrom: 'selected_equipment.inverter.id' | 'selected_equipment.inverterId' | 'none-recorded'
    | 'absent';
  /** One sentence an engineer can read. */
  basis: string;
}

const asObject = (v: unknown): Record<string, unknown> | null => {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null;
};

/**
 * 🚨 THE ONE READER. Every consumer asks this instead of reaching for whichever spelling it knows.
 *
 * Order is deliberate: the object form is canonical, the flat scalar is the legacy mirror, and an
 * explicit null in EITHER is a recorded absence that outranks the other being merely missing.
 */
export function readExternalInverterIdentity(selectedEquipmentRaw: unknown): ExternalInverterIdentity {
  const se = asObject(selectedEquipmentRaw);
  if (!se) {
    return {
      state: 'UNKNOWN', productId: null, readFrom: 'absent',
      basis: 'This project has no equipment selection record, so whether it has a separate PV '
        + 'inverter has not been stated.',
    };
  }

  const invObj = asObject(se.inverter);
  const objId = invObj?.id != null ? String(invObj.id).trim() : '';
  if (objId) {
    return {
      state: 'SELECTED', productId: objId, readFrom: 'selected_equipment.inverter.id',
      basis: `The project selects '${objId}' as a separate PV inverter.`,
    };
  }

  const flatId = se.inverterId != null ? String(se.inverterId).trim() : '';
  if (flatId) {
    return {
      state: 'SELECTED', productId: flatId, readFrom: 'selected_equipment.inverterId',
      basis: `The project selects '${flatId}' as a separate PV inverter (from the legacy flat key).`,
    };
  }

  // 🚨 AN EXPLICIT NULL IS A DECISION. `'inverter' in se` distinguishes "recorded as none" from
  // "never mentioned" — which is the difference between a retirement and an omission, and the
  // reason a gap-filler could hand a retired inverter back to a DC-coupled project.
  const recordedNone =
    ('inverter' in se && se.inverter === null) || ('inverterId' in se && se.inverterId === null);
  if (recordedNone) {
    return {
      state: 'NONE', productId: null, readFrom: 'none-recorded',
      basis: 'This project records that it has NO separate PV inverter. That is a state, not a '
        + 'missing value — it is what a PV-DC-coupled design looks like.',
    };
  }

  return {
    state: 'UNKNOWN', productId: null, readFrom: 'absent',
    basis: 'The equipment selection does not mention a separate PV inverter either way.',
  };
}

/**
 * 🚨 MAY A GAP-FILLER SUPPLY AN INVERTER FOR THIS PROJECT?
 *
 * Only when nobody has said. `NONE` is an answer and must be left alone; `SELECTED` needs nothing.
 * Named as a question so a caller asks it rather than testing a falsy value and treating a recorded
 * absence as an omission.
 *
 * 🚨 AND `true` IS NOT PERMISSION TO INVENT ONE. It permits reading a RECORDED value from another
 * store — a design snapshot the installer made. Ray: "UNKNOWN is not permission to invent equipment."
 */
export const mayBackfillExternalInverter = (id: ExternalInverterIdentity): boolean =>
  id.state === 'UNKNOWN';
