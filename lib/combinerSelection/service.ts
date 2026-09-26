// ═══════════════════════════════════════════════════════════════════════════
// PROJECT-SELECTED COMBINER: THE TRANSITIONS.
//
// PURE. No DB, no network, no clock — every transition takes the catalogue
// lookup, the current store and an instant, and returns the next store or a list
// of named refusals. The API route performs no validation of its own and no
// renderer performs any: a rule that lives in a route is a rule the next route
// forgets.
//
// (`combinerIdentity` is the one exception to "imports nothing": it is a static
// declared table with no imports of its own, not a catalogue reader, and the
// alternative — every caller carrying its own id reconciliation — is the defect
// this module exists to end.)
//
// THE BOUNDARY THIS KEEPS. This module does not choose a combiner — the
// installer does, and the installer is not questioned about it. Ray, 2026-09-25:
// "I don't like that I have to be questioned why I choose whatever Envoy I want
// to." ANY catalogue combiner is recorded on one pick, with no reason and no
// authority required. Compatibility is still JUDGED and RECORDED — as
// information on the record — and never as a gate. The only refusals left are
// the ones that mean there is nothing to record: no device, no actor, an id
// the catalogue does not know (the picker only offers catalogue devices), or a
// catalogue device that is not one of the selectable combiners (a bare IQ
// Gateway — the picker does not offer it either, because no consumer can draw
// and buy it as the combiner).
// ═══════════════════════════════════════════════════════════════════════════

import { canonicalCombinerId } from '@/lib/equipment/combinerIdentity';
import type {
  CombinerBasis,
  CombinerCompatibilityAuthority,
  CombinerCompatibilityOverride,
  CombinerSelectionOutcome,
  CombinerSelectionRecord,
  CombinerSelectionRefusal,
  CombinerSelectionStore,
} from './types';

export type {
  CombinerBasis,
  CombinerCompatibilityAuthority,
  CombinerCompatibilityOverride,
  CombinerSelectionOutcome,
  CombinerSelectionRecord,
  CombinerSelectionRefusal,
  CombinerSelectionStore,
} from './types';

/** The key the selection occupies inside `projects.selected_equipment`. */
export const COMBINER_SELECTION_KEY = 'combinerSelection';

/** What the caller must be able to tell us about a candidate device. */
export interface CombinerDeviceFacts {
  id: string;
  manufacturer: string;
  model: string;
  /** The permitting model number, when the catalogue carries one. Never invented. */
  modelNumber?: string | null;
  /**
   * 🚨 `false` ⇔ the catalogue knows this device but it is not one of the
   * combiners the picker offers — a bare IQ Gateway (Envoy), a meter collar, a
   * generic PV AC combiner panel. Recorded as the project's combiner, a bare
   * gateway is drawn as the AC COMBINER with the branch breakers inside it while
   * the BOM buys a gateway plus a fallback combiner, so it is declined rather
   * than stored (see `listCombiners` in lib/equipment/integratedBos.ts).
   *
   * Absent ⇔ the reader did not say, and nothing is refused on it: only an
   * explicit `false` refuses, so a reader that predates this fact behaves as it
   * always did.
   */
  isSelectableCombiner?: boolean;
}

/**
 * Read the selection out of a `selected_equipment` record.
 *
 * Returns `null` — never an empty store — when the key is absent, so "no
 * combiner selection has ever been made here" stays distinguishable from "one
 * was made and then cleared". Nothing is inferred from a bare id string
 * elsewhere in the record: a selection without an actor and a basis is not one
 * this module will vouch for, and `engineering_config.combinerId` is session
 * workspace, not an authority.
 */
export function readCombinerSelection(
  selectedEquipment: Record<string, unknown> | null | undefined,
): CombinerSelectionStore | null {
  const raw = selectedEquipment?.[COMBINER_SELECTION_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CombinerSelectionStore>;
  return {
    active: (s.active as CombinerSelectionRecord | null) ?? null,
    superseded: Array.isArray(s.superseded) ? (s.superseded as CombinerSelectionRecord[]) : [],
  };
}

/**
 * The device id the project has actually selected, or null.
 *
 * This is the one function every downstream consumer should call. It returns
 * null rather than a default on purpose: the caller must decide what to do with
 * "nobody has chosen yet", and that decision must be visible in its output.
 */
export function selectedCombinerDeviceId(
  store: CombinerSelectionStore | null | undefined,
): string | null {
  return store?.active?.combinerDeviceId ?? null;
}

/** The merge-patch to hand `upsertSelectedEquipment`. `selected_equipment` is
 *  JSONB with an existing `||` merge writer, so this is the whole persistence
 *  story and no migration is involved. */
export function combinerSelectionPatch(store: CombinerSelectionStore): Record<string, unknown> {
  return { [COMBINER_SELECTION_KEY]: store };
}

function refuse(...refusals: CombinerSelectionRefusal[]): CombinerSelectionOutcome {
  return { ok: false, next: null, refusals };
}

/**
 * Judge a candidate against the inverter's declared pairing.
 *
 * 🚨 `declaredCompatibleIds` NULL OR EMPTY IS NOT INCOMPATIBILITY. The catalogue's
 * pairings are known to be incomplete — Enphase documents identical IQ6/IQ7/IQ8
 * support on both the 5/5C and the 6C — so an absent declaration means "the
 * catalogue does not say", which is a fact about SolarPro, not about the roof.
 * An empty array is treated the same, because an empty list is far more likely
 * to be missing data than a manufacturer statement that nothing is compatible.
 *
 * 🚨 THE TWO SIDES OF THIS COMPARISON COME FROM DIFFERENT CATALOGUES, AND THEY
 * USED TO BE COMPARED AS RAW STRINGS. `deviceId` is a BOS-catalogue id, because
 * that is what the picker offers and what a selection is recorded under;
 * `declaredCompatibleIds` is whatever equipment-db's `compatibleWith` says. For
 * the one product they both carry those spellings differ by a single character
 * ('enphase-iq-combiner-5c' vs 'enphase-iq-combiner-5'), so `declared.includes()`
 * was false for EVERY candidate on EVERY Enphase project: the installer could
 * not record the 5C they were fitting, nor the 6C, without citing engineering
 * authority to admit a pairing the manufacturer already declares. Both sides are
 * now resolved to a product identity first, through one declared table
 * (lib/equipment/combinerIdentity.ts) that names which catalogue each spelling
 * comes from. An id that table does not know canonicalises to null and therefore
 * does NOT match — a refusal, never a pass, and never a suffix-matching guess.
 */
export function judgeCombinerCompatibility(args: {
  deviceId: string;
  inverterId: string | null;
  declaredCompatibleIds: string[] | null | undefined;
}): CombinerCompatibilityAuthority {
  const declared = Array.isArray(args.declaredCompatibleIds) && args.declaredCompatibleIds.length > 0
    ? args.declaredCompatibleIds
    : null;
  if (!declared) {
    return {
      inverterId: args.inverterId ?? null,
      declaredCompatibleIds: null,
      declaredCompatible: false,
      source: args.inverterId
        ? `equipment-db declares no combiner pairing for inverter ${args.inverterId}; the catalogue's pairings are known to be incomplete, so this is "not stated", not "not compatible".`
        : 'No inverter was identified, so no declared pairing could be consulted.',
    };
  }
  // The identity of the device being judged. null ⇒ no declared table row names
  // this spelling, so nothing below can establish that the declaration means it.
  const wanted = canonicalCombinerId(args.deviceId);
  // Each declared id beside the product it resolves to. Non-combiner entries
  // ride in these arrays too ('enphase-iq-gateway', 'enphase-iq-battery-5p') and
  // resolve to null, which is correct: they are not this device.
  const reconciled = declared.map(id => ({ raw: String(id), canonical: canonicalCombinerId(id) }));
  const ok = wanted != null && reconciled.some(d => d.canonical === wanted);
  // The source line carries BOTH spellings for every entry, because the whole
  // failure was invisible while it printed only one of them: an operator reading
  // "[enphase-iq-combiner-5] does not name enphase-iq-combiner-5c" had no way to
  // know those are the same box.
  const shown = reconciled
    .map(d => (d.canonical && d.canonical !== d.raw ? `${d.raw} (= ${d.canonical})` : d.raw))
    .join(', ');
  return {
    inverterId: args.inverterId ?? null,
    declaredCompatibleIds: [...declared],
    declaredCompatible: ok,
    source: `equipment-db pairing for inverter ${args.inverterId ?? '(unidentified)'}: [${shown}]`
      + (wanted == null
        ? `; ${args.deviceId || '(no device)'} matches no combiner product identity, so the declaration cannot be shown to name it.`
        : `; judged against product identity ${wanted}.`),
  };
}

/**
 * Select a combiner for the project.
 *
 * `lookupDevice` is the caller's catalogue reader — this module does not import
 * the BOS catalogue, so it stays pure and cycle-free and can be tested against a
 * fixture rather than against whatever the catalogue happens to contain today.
 */
export function planCombinerSelection(args: {
  deviceId: string;
  lookupDevice: (id: string) => CombinerDeviceFacts | null | undefined;
  inverterId: string | null;
  declaredCompatibleIds: string[] | null | undefined;
  actor: { id: string; kind: 'user' | 'service' } | null;
  atIso: string;
  /** Optional note. Never required (Ray, 2026-09-25). */
  basis?: string | null;
  /** Legacy. Recorded when complete, ignored when not — never a refusal. */
  compatibilityOverride?: CombinerCompatibilityOverride | null;
  current: CombinerSelectionStore | null;
}): CombinerSelectionOutcome {
  const refusals: CombinerSelectionRefusal[] = [];

  const deviceId = (args.deviceId ?? '').trim();
  if (!deviceId) {
    refusals.push({ code: 'DEVICE_REQUIRED', message: 'No combiner was chosen.' });
  }
  if (!args.actor?.id?.trim()) {
    refusals.push({ code: 'ACTOR_REQUIRED', message: 'A combiner selection must name the person or service that made it.' });
  }
  // A legacy override is kept only when it is complete; a blank or partial one
  // is simply not recorded. Nothing about it can refuse the pick.
  const _ov = args.compatibilityOverride ?? null;
  const ov = _ov && _ov.reason?.trim() && _ov.authority?.trim() ? _ov : null;

  const device = deviceId ? args.lookupDevice(deviceId) : null;
  if (deviceId && !device) {
    refusals.push({
      code: 'UNKNOWN_DEVICE',
      message: `${deviceId} is not in the BOS catalogue, so nothing is known about what it is or what it provides.`,
    });
  }
  // A device CLASS fact, not a judgement of the installer: nothing is asked and
  // no pairing is consulted. A gateway with no busbar cannot be the box the
  // branch circuits land in, and recording it as one draws what the BOM does not
  // buy. For Enphase each IQ Combiner has the IQ Gateway built in; that is the
  // Envoy choice. The pointer is brand-specific because the refused set is not:
  // a Tesla Backup Switch or a generic PV AC combiner panel is declined here
  // too, and Enphase advice is no answer to either.
  if (device && device.isSelectableCombiner === false) {
    const pointer = /enphase/i.test(device.manufacturer)
      ? 'Choose the IQ Combiner being fitted — each has the IQ Gateway (Envoy) built in.'
      : 'Choose one of the offered combiners.';
    refusals.push({
      code: 'NOT_A_SELECTABLE_COMBINER',
      message: `${device.manufacturer} ${device.model} is not one of the combiners the drawings and the BOM can carry `
        + `as this project's combiner, so it cannot be recorded as one. ${pointer}`,
    });
  }

  const compatibility = judgeCombinerCompatibility({
    deviceId,
    inverterId: args.inverterId,
    declaredCompatibleIds: args.declaredCompatibleIds,
  });

  // `compatibility` is RECORDED, never enforced: a device the inverter's
  // declaration does not name is still the installer's pick, recorded exactly
  // as chosen and never substituted (Ray, 2026-09-25).

  if (refusals.length > 0) return refuse(...refusals);

  const cur = args.current ?? { active: null, superseded: [] };
  // Re-picking the device already in force writes nothing new.
  if (cur.active?.combinerDeviceId === deviceId) {
    return { ok: true, next: args.current ?? cur, refusals: [] };
  }

  const record: CombinerSelectionRecord = {
    schemaVersion: 1,
    combinerDeviceId: deviceId,
    manufacturer: device!.manufacturer,
    model: device!.model,
    modelNumber: device!.modelNumber ?? null,
    inverterId: args.inverterId ?? null,
    selectedBy: args.actor!.id,
    selectedByKind: args.actor!.kind,
    selectedAtIso: args.atIso,
    basis: args.basis?.trim() || null,
    compatibility,
    compatibilityOverride: ov,
  };

  // Supersession, never overwrite: the package has to be able to say what was
  // selected before and why it stopped being the answer.
  const superseded = cur.active
    ? [...cur.superseded, {
        ...cur.active,
        supersededAtIso: args.atIso,
        supersededBy: args.actor!.id,
        supersededReason: `Replaced by ${deviceId}.`,
      }]
    : [...cur.superseded];

  return { ok: true, next: { active: record, superseded }, refusals: [] };
}

/**
 * Clear the selection — the combiner becomes an open question again.
 *
 * It does NOT revert to a recommendation. Downstream consumers see "nothing is
 * selected" and must report that, which is the whole point: an unanswered
 * question must look unanswered.
 */
export function planCombinerClear(args: {
  actor: { id: string; kind: 'user' | 'service' } | null;
  atIso: string;
  reason: string;
  current: CombinerSelectionStore | null;
}): CombinerSelectionOutcome {
  const refusals: CombinerSelectionRefusal[] = [];
  if (!args.actor?.id?.trim()) {
    refusals.push({ code: 'ACTOR_REQUIRED', message: 'Clearing the combiner selection must name who did it.' });
  }
  if (!args.current?.active) {
    refusals.push({ code: 'NO_ACTIVE_SELECTION', message: 'No combiner is selected on this project.' });
  }
  if (refusals.length > 0) return refuse(...refusals);

  return {
    ok: true,
    next: {
      active: null,
      superseded: [...args.current!.superseded, {
        ...args.current!.active!,
        supersededAtIso: args.atIso,
        supersededBy: args.actor!.id,
        supersededReason: args.reason?.trim() || 'Selection cleared.',
      }],
    },
    refusals: [],
  };
}

/**
 * Which basis a consumer should report, given what it was handed.
 *
 * Kept here rather than repeated at each consumer so that "how did we come to
 * name this device" has one answer. The ordering IS the authority rule: a
 * project selection outranks a session override outranks a catalogue
 * recommendation outranks nothing at all.
 */
export function combinerBasisFor(args: {
  projectSelectedId: string | null | undefined;
  sessionOverrideId: string | null | undefined;
  declaredCompatibleIds: string[] | null | undefined;
}): CombinerBasis {
  if (args.projectSelectedId) return 'project-selected';
  if (args.sessionOverrideId) return 'session-override';
  if (Array.isArray(args.declaredCompatibleIds) && args.declaredCompatibleIds.length > 0) {
    return 'declared-compatibility';
  }
  return 'unresolved-default';
}

/** Is this basis one a permit package may assert without qualification? */
export function combinerBasisIsDecided(basis: CombinerBasis): boolean {
  return basis === 'project-selected' || basis === 'session-override';
}
