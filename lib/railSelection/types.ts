// ═══════════════════════════════════════════════════════════════════════════
// D12 — RAIL SELECTION: THE RECORD.
//
// WS-8 established that for a mixed-manufacturer mount the rail is GENUINELY
// UNSELECTED — choosing one is a design + procurement decision with real
// commercial consequences, and the engine may not make it. What WS-8 could not
// establish was anywhere for the operator's answer to LAND: every store was
// probed and none has a rail slot, so PENDING-RACKING-ASSEMBLY-SELECTION was
// structurally unclosable.
//
// This is that slot. It is a full authority record, not a string: a rail that
// closes a release requirement must carry WHO chose it, WHEN, WHY, and what
// span authority admits it — the same standard every other authority act in
// this codebase is held to.
//
// WHERE IT LIVES, AND WHY NO MIGRATION. `projects.selected_equipment` is the
// canonical design-equipment store (migration 101) and it is JSONB with an
// existing merge-patch writer. A rail IS design equipment, so it belongs there,
// and adding it needs no schema change — which matters, because applying a
// migration is blocked on the unrotated credential and this is not. History is
// still never overwritten: a re-pin SUPERSEDES into the same record.
// ═══════════════════════════════════════════════════════════════════════════

/** What admits this rail at the mount's attachment spacing. */
export interface RailSpanAuthority {
  /** the mount's maximum attachment spacing, from mounting-hardware-db. */
  requiredSpanIn: number | null;
  /** the rail's published maximum span, from its catalog RailSpec. */
  publishedMaxSpanIn: number | null;
  /** true ⇔ published span covers the required spacing with no override. */
  coversSpan: boolean;
  /** where both numbers came from — never a summary, always the records. */
  source: string;
}

/** Pinning a rail whose published span does NOT cover the mount's spacing is
 *  permitted, and ONLY with stated engineering authority. There is deliberately
 *  no boolean "force" flag: an override that cannot name its authority is
 *  indistinguishable from a mistake. */
export interface RailSpanOverride {
  reason: string;
  /** the document, letter or stamped record that admits the shorter span. */
  authority: string;
}

export interface RailSelectionRecord {
  schemaVersion: 1;
  /** the catalog mounting system the rail belongs to. */
  railSystemId: string;
  manufacturer: string;
  railModel: string;
  /** The mount this rail is pinned TO. A selection is only ever valid for the
   *  assembly it was made for — the compatibility statement that admitted it
   *  belongs to THAT mount. Changing the mount does not silently carry it over. */
  mountingSystemId: string;
  /** NULL, always, today: mounting-hardware-db carries no rail part numbers at
   *  all. Stated rather than invented — the orderable SKU comes from the
   *  distributor line item, and fabricating one here would be a procurement
   *  instruction the design never made. */
  railSku: string | null;
  selectedBy: string;
  selectedByKind: 'user' | 'service';
  selectedAtIso: string;
  /** WHY this rail. Required, and required to be non-empty. */
  basis: string;
  spanAuthority: RailSpanAuthority;
  spanOverride: RailSpanOverride | null;
  /** set when this record was retired, so a superseded entry says how it ended. */
  supersededAtIso?: string;
  supersededBy?: string;
  supersededReason?: string;
}

/** The whole selection state for one project, as it sits in the JSONB. */
export interface RailSelectionStore {
  /** the selection in force, or null when the rail is open. */
  active: RailSelectionRecord | null;
  /** every retired selection, oldest first. Never pruned, never rewritten. */
  superseded: RailSelectionRecord[];
}

export interface RailPinRefusal {
  code:
    | 'RAIL_NOT_SELECTABLE'   // the mount has no open rail question
    | 'RAIL_NOT_A_CANDIDATE'  // the mount's compatibility statement does not admit it
    | 'SPAN_NOT_COVERED'      // published span is short and no authority was supplied
    | 'BASIS_REQUIRED'        // no stated reason
    | 'ACTOR_REQUIRED'
    | 'NO_ACTIVE_SELECTION'   // nothing to unpin
    | 'MOUNT_REQUIRED';
  message: string;
}

/** Both fields are always present, deliberately.
 *
 *  A discriminated union would be tighter, but this repository compiles with
 *  `strict: false`, so control-flow narrowing on the `ok` discriminant does not
 *  hold and every consumer would need a cast to reach `refusals` — which is
 *  exactly the kind of cast that hid D12's own `storedRecord` phantom from the
 *  compiler. A uniform shape needs no narrowing and no cast: a successful pin
 *  carries an empty `refusals`, a refused one carries a null `next`. */
export interface RailPinOutcome {
  ok: boolean;
  /** the store to persist. Null ⇔ the pin was refused; nothing is written. */
  next: RailSelectionStore | null;
  /** empty ⇔ accepted. Never empty when `ok` is false. */
  refusals: RailPinRefusal[];
}
