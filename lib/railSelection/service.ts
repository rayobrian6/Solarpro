// ═══════════════════════════════════════════════════════════════════════════
// D12 — RAIL SELECTION: THE TRANSITIONS.
//
// PURE. No DB, no network, no clock — every transition takes the derived
// verdict, the current store and an instant, and returns the next store or a
// list of named refusals. The API route performs no validation of its own and
// the renderer performs none: a rule that lives in a route is a rule that the
// next route forgets.
//
// THE BOUNDARY THIS KEEPS. WS-8's finding stands: the engine does not choose a
// rail. What it does is REFUSE A CHOICE IT CANNOT JUSTIFY — a rail the mount's
// own documented compatibility statement never admitted, or one whose published
// span is short with nothing stated to admit it. That is not selecting; it is
// declining to record an unsupported claim.
// ═══════════════════════════════════════════════════════════════════════════

import type { RailSelectionVerdict } from '@/lib/permit/snapshot/resolution/railSelection';
import type {
  RailPinOutcome, RailPinRefusal, RailSelectionRecord, RailSelectionStore, RailSpanOverride,
} from './types';

export type {
  RailPinOutcome, RailPinRefusal, RailSelectionRecord, RailSelectionStore, RailSpanOverride,
} from './types';

/** The key the selection occupies inside `projects.selected_equipment`. */
export const RAIL_SELECTION_KEY = 'railSelection';

const EMPTY: RailSelectionStore = { active: null, superseded: [] };

/**
 * Read the selection out of a `selected_equipment` record.
 *
 * Returns `null` — never an empty store — when the key is absent, so "no rail
 * selection has ever been made here" stays distinguishable from "a selection was
 * made and then unpinned". Nothing is inferred from a bare `railId` string: a
 * selection without an actor and a basis is not one this module will vouch for.
 */
export function readRailSelection(
  selectedEquipment: Record<string, unknown> | null | undefined,
): RailSelectionStore | null {
  const raw = selectedEquipment?.[RAIL_SELECTION_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<RailSelectionStore>;
  return {
    active: (s.active as RailSelectionRecord | null) ?? null,
    superseded: Array.isArray(s.superseded) ? (s.superseded as RailSelectionRecord[]) : [],
  };
}

/** The merge-patch to hand `updateSelectedEquipment`. `selected_equipment` is
 *  JSONB with an existing `||` merge writer, so this is the whole persistence
 *  story and no migration is involved. */
export function railSelectionPatch(store: RailSelectionStore): Record<string, unknown> {
  return { [RAIL_SELECTION_KEY]: store };
}

function refuse(...refusals: RailPinRefusal[]): RailPinOutcome {
  return { ok: false, next: null, refusals };
}

/**
 * Pin a rail to the assembly.
 *
 * The verdict is the AUTHORITY on what may be pinned — it is derived from the
 * mount's own compatibility statement and its published attachment spacing, and
 * this function never widens it.
 */
export function planRailPin(args: {
  /** the derived verdict for THIS mount (deriveRailSelection). */
  verdict: RailSelectionVerdict;
  mountingSystemId: string | null;
  /** the catalog system id of the chosen rail. */
  railSystemId: string;
  actor: { id: string; kind: 'user' | 'service' } | null;
  atIso: string;
  basis: string;
  spanOverride?: RailSpanOverride | null;
  current: RailSelectionStore | null;
}): RailPinOutcome {
  const refusals: RailPinRefusal[] = [];

  if (!args.mountingSystemId) {
    refusals.push({ code: 'MOUNT_REQUIRED', message: 'No mounting system is selected, so there is no assembly to pin a rail to.' });
  }
  if (!args.actor?.id?.trim()) {
    refusals.push({ code: 'ACTOR_REQUIRED', message: 'A rail selection must name the person or service that made it.' });
  }
  if (!args.basis?.trim()) {
    refusals.push({
      code: 'BASIS_REQUIRED',
      message: 'A rail selection must state WHY this rail — brand availability, distributor stock, splice hardware, '
        + 'warranty. It closes a release requirement, so an unexplained pick is not enough.',
    });
  }

  // Only an OPEN rail question can be answered.
  if (args.verdict.state === 'inherent') {
    refusals.push({
      code: 'RAIL_NOT_SELECTABLE',
      message: `The rail is inherent in the selected mount (${args.verdict.selectedRailModel}) — it is part of the `
        + 'product, so there is nothing to pin. Change the mount to change the rail.',
    });
  } else if (args.verdict.state === 'no-rail-required') {
    refusals.push({
      code: 'RAIL_NOT_SELECTABLE',
      message: 'The selected mount routes a rail-less load path — no rail is part of this assembly.',
    });
  } else if (args.verdict.state === 'selected') {
    // already pinned; re-pinning is legal and supersedes. Not a refusal.
  }

  const candidate = args.verdict.candidates.find(c => c.systemId === args.railSystemId) ?? null;
  if (!candidate && args.verdict.state !== 'inherent' && args.verdict.state !== 'no-rail-required') {
    refusals.push({
      code: 'RAIL_NOT_A_CANDIDATE',
      message: `'${args.railSystemId}' is not among the rails the mount's own documented compatibility statement admits `
        + `(${args.verdict.candidates.map(c => c.systemId).join(', ') || 'none'}). Pinning a rail the manufacturer does `
        + 'not name would be a compatibility claim this repository cannot support.',
    });
  }

  if (candidate && candidate.refusedReason != null && !args.spanOverride?.authority?.trim()) {
    refusals.push({
      code: 'SPAN_NOT_COVERED',
      message: `${candidate.manufacturer} ${candidate.railModel}: ${candidate.refusedReason}. It may still be pinned, `
        + 'but only with a stated span authority — the document or stamped record that admits it at this spacing.',
    });
  }

  if (refusals.length) return refuse(...refusals);

  const c = candidate!;
  const record: RailSelectionRecord = {
    schemaVersion: 1,
    railSystemId: c.systemId,
    manufacturer: c.manufacturer,
    railModel: c.railModel,
    mountingSystemId: args.mountingSystemId!,
    // mounting-hardware-db carries no rail part numbers. Stated, never invented.
    railSku: null,
    selectedBy: args.actor!.id,
    selectedByKind: args.actor!.kind,
    selectedAtIso: args.atIso,
    basis: args.basis.trim(),
    spanAuthority: {
      requiredSpanIn: c.requiredSpanIn,
      publishedMaxSpanIn: c.maxSpanIn,
      coversSpan: c.refusedReason == null,
      source: `mounting-hardware-db mount.maxSpacingIn=${c.requiredSpanIn ?? 'unstated'} vs `
        + `${c.manufacturer} ${c.railModel} rail.maxSpanIn=${c.maxSpanIn}`,
    },
    spanOverride: args.spanOverride ?? null,
  };

  const prev = args.current?.active ?? null;
  const superseded = [...(args.current?.superseded ?? [])];
  if (prev) {
    superseded.push({
      ...prev,
      supersededAtIso: args.atIso,
      supersededBy: args.actor!.id,
      supersededReason: `replaced by ${c.manufacturer} ${c.railModel} — ${args.basis.trim()}`,
    });
  }
  return { ok: true, next: { active: record, superseded }, refusals: [] };
}

/** Retire the active selection. The record is kept — a rail that WAS specified
 *  and then withdrawn is part of the design history, and an empty store would
 *  read as "never chosen". */
export function planRailUnpin(args: {
  current: RailSelectionStore | null;
  actor: { id: string; kind: 'user' | 'service' } | null;
  atIso: string;
  reason: string;
}): RailPinOutcome {
  const refusals: RailPinRefusal[] = [];
  if (!args.actor?.id?.trim()) {
    refusals.push({ code: 'ACTOR_REQUIRED', message: 'Retiring a rail selection must name the person or service doing it.' });
  }
  if (!args.reason?.trim()) {
    refusals.push({ code: 'BASIS_REQUIRED', message: 'Retiring a rail selection must state why.' });
  }
  const active = args.current?.active ?? null;
  if (!active) {
    refusals.push({
      code: 'NO_ACTIVE_SELECTION',
      message: 'There is no rail selection in force to retire. Reporting success here would claim an act that did not happen.',
    });
  }
  if (refusals.length) return refuse(...refusals);
  return {
    ok: true,
    refusals: [],
    next: {
      active: null,
      superseded: [...(args.current?.superseded ?? []), {
        ...active!,
        supersededAtIso: args.atIso,
        supersededBy: args.actor!.id,
        supersededReason: args.reason.trim(),
      }],
    },
  };
}

/** An empty store, for a caller that needs one to start from. */
export function emptyRailSelectionStore(): RailSelectionStore {
  return { ...EMPTY, superseded: [] };
}
