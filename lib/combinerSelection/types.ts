// ═══════════════════════════════════════════════════════════════════════════
// PROJECT-SELECTED COMBINER: THE RECORD.
//
// "The SLD is currently showing an IQ Combiner 6C. I am still installing IQ
// Combiner 5C." — the installer, on a live Dev review.
//
// The 6C was never chosen by anyone. It arrived because an inverter lookup
// missed, the compatibility list came back `undefined`, and a
// `?? getBosDevice('enphase-iq-combiner-6c')` last resort named a product. Three
// different concepts had been collapsed into one:
//
//   COMPATIBILITY   what CAN be used.        Validates a selection.
//   RECOMMENDATION  what SolarPro suggests.  Never binding.
//   SELECTION       what the installer is    THE ONLY THING DOWNSTREAM
//                   ACTUALLY INSTALLING.     MAY CONSUME.
//
// SolarPro may recommend. SolarPro validates. The installer selects. Once a
// selection exists, the SLD, the BOM, the equipment schedule, the plan set and
// the permit package CONSUME it and none of them may choose.
//
// 🚨 WHY AN ABSENT PAIRING IS NOT A REFUSAL. Enphase documents IDENTICAL
// IQ6/IQ7/IQ8 support on both the IQ Combiner 5/5C and the 6C, and both read
// "Yes" in the SOLAR ONLY column of the compatibility matrix. The catalogue's
// `compatibleWith: ['enphase-iq-combiner-5']` on the IQ8 rows is therefore
// INCOMPLETE, not wrong — microinverter family does not discriminate between
// them.
//
// 🚨 RAY'S RULING, 2026-09-25: THE INSTALLER IS NOT QUESTIONED. "I don't like
// that I have to be questioned why I choose whatever Envoy I want to." Any
// catalogue combiner is recorded on one pick — no reason, no authority. What
// the catalogue declares is recorded beside the pick as INFORMATION
// (`compatibility`) and never refuses it. Nothing is ever substituted.
//
// WHERE IT LIVES, AND WHY NO MIGRATION. `projects.selected_equipment` is the
// canonical design-equipment store (migration 101), JSONB with an existing
// merge-patch writer. A combiner IS design equipment, so it belongs there and
// needs no schema change. D12 Rail Selection established this pattern; this is
// the same shape, deliberately, so there is one way to record an equipment
// decision rather than two.
// ═══════════════════════════════════════════════════════════════════════════

/** What the catalogue says about this device against the selected inverter. */
export interface CombinerCompatibilityAuthority {
  /** The inverter the selection was validated against. */
  inverterId: string | null;
  /**
   * What the inverter's catalogue row declares it pairs with.
   *
   * `null` means NOTHING WAS DECLARED — which is not the same as "declared
   * incompatible", and is the common case, because the catalogue's pairings are
   * known to be incomplete. An empty array would be a declaration of no
   * compatible device and is treated the same as null for that reason: an empty
   * list is far more likely to be missing data than a manufacturer statement.
   */
  declaredCompatibleIds: string[] | null;
  /** true ⇔ a declaration exists AND it names this device. */
  declaredCompatible: boolean;
  /** Where both answers came from — never a summary, always the records. */
  source: string;
}

/**
 * LEGACY. Selections made before 2026-09-25 could carry a stated reason and
 * authority for a pairing the catalogue did not declare. They still load and
 * are kept verbatim; nothing requires one any more.
 */
export interface CombinerCompatibilityOverride {
  reason: string;
  /** The datasheet, technical brief or letter that admits the pairing. */
  authority: string;
}

export interface CombinerSelectionRecord {
  schemaVersion: 1;
  /** The BOS catalogue id of the device the installer is fitting — or, for a
   *  gateway in its own enclosure, of the topology that names it together with
   *  the panel the branches land in ('enphase-iq-gateway-standalone'). One id
   *  either way: the id carries the topology, so no second field can disagree
   *  with it. */
  combinerDeviceId: string;
  manufacturer: string;
  model: string;
  /**
   * The number the manufacturer says to use for interconnection and permitting,
   * where one is known. Enphase is explicit that the MODEL NUMBER is used for
   * permitting and not the ordering SKU. `null` rather than a guess.
   */
  modelNumber: string | null;
  /**
   * The inverter this was pinned FOR. A selection is only valid for the system
   * it was made for — the compatibility statement that admitted it belongs to
   * THAT inverter. Changing the inverter does not silently carry it over.
   */
  inverterId: string | null;
  selectedBy: string;
  selectedByKind: 'user' | 'service';
  selectedAtIso: string;
  /** An optional note on why this device. `null` ⇔ none stated — and none is
   *  required (Ray, 2026-09-25). Legacy records carry the text they had. */
  basis: string | null;
  compatibility: CombinerCompatibilityAuthority;
  compatibilityOverride: CombinerCompatibilityOverride | null;
  /** Set when this record was retired, so a superseded entry says how it ended. */
  supersededAtIso?: string;
  supersededBy?: string;
  supersededReason?: string;
}

/** The whole selection state for one project, as it sits in the JSONB. */
export interface CombinerSelectionStore {
  /** The selection in force, or null when the combiner is an open question. */
  active: CombinerSelectionRecord | null;
  /** Every retired selection, oldest first. Never pruned, never rewritten. */
  superseded: CombinerSelectionRecord[];
}

export interface CombinerSelectionRefusal {
  code:
    | 'DEVICE_REQUIRED'      // nothing was chosen
    | 'UNKNOWN_DEVICE'       // not in the BOS catalogue
    | 'NOT_A_SELECTABLE_COMBINER' // in the catalogue, but not a combiner the picker offers (a bare IQ Gateway — the standalone TOPOLOGY is offered)
    | 'ACTOR_REQUIRED'       // nobody owns the decision
    | 'NO_ACTIVE_SELECTION'; // nothing to clear
    // (NOT_A_CANDIDATE / BASIS_REQUIRED / OVERRIDE_INCOMPLETE were removed on
    //  2026-09-25: the installer's pick is not interrogated. NOT_A_SELECTABLE_
    //  COMBINER is not one of those — it asks nothing of the installer and judges
    //  no pairing; it declines to record a device class the drawings and the BOM
    //  cannot carry as the combiner, e.g. a bare gateway the SLD would draw with
    //  the branch breakers inside it.)
  message: string;
}

/**
 * Both fields are always present, deliberately.
 *
 * A discriminated union would be tighter, but this repository compiles with
 * `strict: false`, so control-flow narrowing on an `ok` discriminant does not
 * hold and every consumer would need a cast to reach `refusals` — the kind of
 * cast that hides a phantom from the compiler. A uniform shape needs neither.
 */
export interface CombinerSelectionOutcome {
  ok: boolean;
  /** The store to persist. Null ⇔ refused; nothing is written. */
  next: CombinerSelectionStore | null;
  /** Empty ⇔ accepted. Never empty when `ok` is false. */
  refusals: CombinerSelectionRefusal[];
}

/**
 * How a consumer came to be naming this combiner.
 *
 * 🚨 THE POINT OF THIS TYPE IS THAT `unresolved-default` IS VISIBLE. A drawing
 * that names a product because a fallback fired must be able to SAY so, so the
 * package can print "selection required" instead of quietly asserting a product
 * nobody chose. Unknown stays unknown; it does not become the newest product,
 * and it does not become the 5C either.
 */
export type CombinerBasis =
  /** The installer selected it and it is recorded against the project. */
  | 'project-selected'
  /** An operator override for this one artefact (legacy `overrideDeviceIds`). */
  | 'session-override'
  /** Derived from the inverter's declared pairing — a recommendation, not a choice. */
  | 'declared-compatibility'
  /** Nothing chose it. The last-resort device, and it must be reported as such. */
  | 'unresolved-default';
