// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHERE A PIECE OF EQUIPMENT CAME FROM — because EXISTENCE IS NOT INTENT.
//
// Ray's live project, on the second acceptance run:
//
//   "You previously proved that EcosystemPicker silently auto-selected the Tesla Solar Inverter and
//    autosaved it. Therefore persisted equipment existence alone does not prove installer intent.
//    … Do not simply say: persisted inverter = intentional inverter, because this live project
//    proves that statement false."
//
// Everything electrical in this codebase reads `selected_equipment.inverter.id` and treats its mere
// presence as the installer's decision. For a project saved before `cdebde10` that is demonstrably
// false: `EcosystemPicker.tsx:152` wrote `kit.stringInverters[0]` with no click, the sizing engine
// upsized it to 2 × 5.7 kW, and autosave persisted both. The record that came out is the record a
// deliberate click would have produced.
//
// 🚨 AND THAT LAST SENTENCE IS THE WHOLE DIFFICULTY, SO IT IS STATED AS A LAW RATHER THAN A CAVEAT:
//
//        FOR A LEGACY ROW, "AUTO-PICKED" AND "DELIBERATELY CHOSEN" ARE THE SAME BYTES.
//
// No amount of analysis recovers a distinction that was never written down. So this module does not
// pretend to recover it. It does two separate things, and keeping them separate is the point:
//
//   1. RECORD provenance from now on, at every write, so the question is answerable for every
//      project saved after this ships and never needs analysis again.
//   2. For rows written before that, CLASSIFY the evidence — and where the evidence cannot settle
//      intent, say so in those words, so the caller asks the installer ONE question instead of
//      inferring an architecture from catalogue ordering.
//
// What this module must never become is a rule that deletes equipment because it looks suggested.
// "NO EQUIPMENT MAY APPEAR FROM ABSENCE" has a mirror image, and it is just as bad: no equipment
// may VANISH from an inference. A classification is an input to a question, not a licence to edit
// the design.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How a piece of equipment came to be on a project.
 *
 * These are kinds of ACT, not degrees of confidence. `AUTO_SUGGESTED_LEGACY` does not mean "we are
 * fairly sure nobody chose it" — it means "the act that put it here was a suggestion being saved,
 * and the installer was never asked".
 */
export type EquipmentProvenanceKind =
  /** An installer chose this product, deliberately, and the act was recorded. */
  | 'USER_SELECTED'
  /** A topology/architecture operation created it (a gateway's internal panelboard, a generation
   *  panel created by applying an aggregation arrangement). Real equipment, authored by a
   *  structural decision rather than picked off a list. */
  | 'ARCHITECTURE_CREATED'
  /** A picker default that was autosaved without the installer acting. NOT a decision. */
  | 'AUTO_SUGGESTED_LEGACY'
  /** Written by a migration, from an earlier shape. Traceable to the migration, not to a person. */
  | 'MIGRATED';

export interface EquipmentProvenanceRecord {
  kind: EquipmentProvenanceKind;
  /** ISO timestamp of the act. */
  recordedAt: string;
  /** One sentence an engineer can read. */
  basis: string;
  /**
   * The code path that performed the act — `'ecosystem-apply'`, `'equipment-picker'`,
   * `'topology-authoring'`, `'migration:solar-coupling'`. Present so "which writer did this" is
   * answerable without reading git history.
   */
  by?: string;
}

/** The provenance block as it is stored on `projects.selected_equipment`. */
export interface StoredEquipmentProvenance {
  inverter?: EquipmentProvenanceRecord;
  battery?: EquipmentProvenanceRecord;
  panel?: EquipmentProvenanceRecord;
  /**
   * 🚨 NOT A PIECE OF EQUIPMENT — the ARCHITECTURE decision itself.
   *
   * Recorded when an installer answers the coupling question, so "a person settled this, on this
   * date" survives even when the answer retired the equipment the question was about. Without it,
   * a project resolved to DC coupling would hold a recorded coupling and no trace of who recorded
   * it, which is the same unanswerable state the auto-picker left behind.
   */
  architecture?: EquipmentProvenanceRecord;
}

/**
 * 🚨 THE RECORD OF A RESOLUTION, kept so the choice is permanent and traceable.
 *
 * Ray: "After Ray resolves it once, persist the canonical architecture and provenance permanently."
 * And, on the equipment the resolution retires: "those standalone inverter instances disappear from
 * current design authority; old history remains traceable."
 *
 * So a resolution never deletes the inverter record. It moves it out of the authority the design
 * reads and leaves it here, with what it was and when it stopped counting.
 */
export interface RetiredEquipmentRecord {
  /** The catalogue id that was in `selected_equipment.inverter.id`. */
  id: string;
  /** Whatever else the stored record held, verbatim. */
  record: Record<string, unknown> | null;
  /** When the resolution retired it. */
  retiredAt: string;
  /** The architecture decision that retired it. */
  retiredBecause: string;
  /**
   * What this equipment's origin was judged to be at the moment it was retired, INCLUDING the
   * honest `'UNRECORDED'` — a retirement must not upgrade an unknown origin into a stored kind.
   */
  originAtRetirement: {
    kind: EquipmentProvenanceKind | 'UNRECORDED';
    basis: string;
    evidence: string[];
  };
}

export const PROVENANCE_LABEL: Record<EquipmentProvenanceKind, string> = {
  USER_SELECTED: 'Selected by the installer',
  ARCHITECTURE_CREATED: 'Created by the system architecture',
  AUTO_SUGGESTED_LEGACY: 'Suggested automatically — never confirmed',
  MIGRATED: 'Written by a migration',
};

/**
 * 🚨 DOES THIS PROVENANCE STAND AS AN INSTALLER DECISION?
 *
 * The one question every consumer actually wants to ask, named so nobody re-derives it by testing
 * `kind === 'USER_SELECTED'` and forgetting that `ARCHITECTURE_CREATED` is also deliberate.
 */
export const isInstallerDecision = (p: EquipmentProvenanceRecord | null | undefined): boolean =>
  p?.kind === 'USER_SELECTED' || p?.kind === 'ARCHITECTURE_CREATED';

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The evidence a legacy row can actually offer about its inverter selection.
 *
 * Every field here is something READ, never guessed. `autoPickWouldHaveChosen` is the one that
 * needs a catalogue, which is why this interface exists at all: the model is catalogue-free, so the
 * load path gathers the evidence and the classifier judges it.
 */
export interface LegacyInverterEvidence {
  /** Was a provenance block stored at all? false ⇒ the row predates provenance. */
  provenanceRecorded: boolean;
  /** The inverter id on the record, or null. */
  inverterId: string | null;
  /**
   * What `EcosystemPicker`'s auto-select WOULD have written for this project's ecosystem, resolved
   * from the catalogue as it reads today — `kit.stringInverters[0]?.id`. null when the ecosystem is
   * unknown or publishes no string inverter.
   */
  autoPickWouldHaveChosen: string | null;
  /**
   * 🚨 EVERY STRING INVERTER THE ECOSYSTEM PUBLISHES — the closed set the auto-pick can REACH.
   *
   * The auto-pick is only the first half of what the legacy path did. `EcosystemPicker` wrote
   * `kit.stringInverters[0]` (`tesla-solar-inverter-3p8k`), and then `sizingEngine` saw that one
   * unit would not carry the array and UPSIZED — to a bigger model IN THE SAME BRAND
   * (`lib/system/sizingEngine.ts`, "Try to UPSIZE to a bigger model in the same brand"). Ray's live
   * row therefore holds `5.7 kW × 2`, which is NOT the auto-pick's id.
   *
   * So comparing against the single default would have cleared this project, and that is precisely
   * the mistake: the id on the row is the auto-pick's OUTPUT, not the auto-pick. The reachable set
   * is the ecosystem's own string-inverter list, because the upsize never leaves the brand.
   */
  ecosystemStringInverterIds: string[];
  /** The ecosystem brand the evidence above was resolved for. */
  ecosystemBrand: string | null;
  /**
   * Does the storage in the graph publish its own PV DC inputs? When it does, a separate PV
   * inverter is electrically redundant — which is what makes the architecture ambiguous rather
   * than merely unusual.
   */
  storageTakesPvOnDc: boolean;
  /** How many storage units publish PV inputs. */
  pvCapableUnitCount: number;
}

export type LegacyInverterVerdict =
  | 'USER_SELECTED'
  | 'AUTO_SUGGESTED_LEGACY'
  | 'INDETERMINATE'
  | 'NO_INVERTER';

export interface LegacyInverterClassification {
  verdict: LegacyInverterVerdict;
  /** One sentence for the operator. */
  basis: string;
  /** Each piece of evidence, as a readable line. The UI shows these verbatim. */
  evidence: string[];
  /**
   * 🚨 CAN THE ARCHITECTURE BE DECIDED FROM THIS ALONE?
   *
   * false for every legacy row where both placements remain possible — which is the honest answer,
   * and the one that routes the project to one explicit question instead of to an inference.
   */
  settlesIntent: boolean;
}

/**
 * 🚨 CLASSIFY A LEGACY INVERTER SELECTION FROM EVIDENCE. Deterministic: same row, same verdict,
 * no clock, no randomness, no catalogue lookup of its own.
 *
 * The asymmetry in here is deliberate and is the whole reason the function is not a one-liner:
 *
 *   · BEING REACHABLE from the auto-pick is strong evidence the auto-picker wrote it. The picker
 *     wrote `kit.stringInverters[0]` and the sizing engine upsized within the brand, so the whole
 *     ecosystem list is reachable — and Ray's live row is the proof that testing the single default
 *     is not enough, because the id it holds is the UPSIZED one.
 *   · NOT being reachable is NOT evidence that an installer chose it. Catalogue membership is not
 *     stable over time: `STRING_INVERTERS` has been appended to and re-sorted and products have
 *     been retired, so an older auto-pick may have written a product the ecosystem no longer
 *     publishes. Treating "not in the list today" as "a human chose it" would convict on a changed
 *     list.
 *
 * So a non-match returns INDETERMINATE, not USER_SELECTED. Both verdicts carry
 * `settlesIntent: false` and both route to the same single question. What differs is what the
 * operator is TOLD about where the equipment came from — which is what Ray asked for: "For legacy
 * auto-created equipment, show its provenance/conflict and allow one intentional resolution."
 */
export function classifyLegacyInverterSelection(
  ev: LegacyInverterEvidence,
): LegacyInverterClassification {
  const evidence: string[] = [];

  if (!ev.inverterId) {
    return {
      verdict: 'NO_INVERTER',
      basis: 'No separate PV inverter is selected on this project.',
      evidence: ['`selected_equipment.inverter` is empty.'],
      settlesIntent: true,
    };
  }

  // A row that recorded provenance is not legacy, and this function should not have been asked.
  if (ev.provenanceRecorded) {
    return {
      verdict: 'USER_SELECTED',
      basis: 'This project records how its equipment was chosen, so no analysis is needed — read '
        + 'the stored provenance instead of inferring one.',
      evidence: ['`selected_equipment.provenance` is present.'],
      settlesIntent: true,
    };
  }

  evidence.push(
    'No provenance was stored with this selection, so the record itself cannot say whether an '
    + 'installer chose it or a picker default was autosaved.',
  );

  // 🚨 REACHABILITY, NOT EQUALITY. See `ecosystemStringInverterIds`: the recorded id is the
  // auto-pick AFTER the sizing engine's brand-internal upsize, so an equality test against
  // `kit.stringInverters[0]` clears the very project that proved the defect.
  const isExactAutoPick =
    ev.autoPickWouldHaveChosen != null && ev.autoPickWouldHaveChosen === ev.inverterId;
  const reachableByAutoPick =
    isExactAutoPick || ev.ecosystemStringInverterIds.includes(ev.inverterId);

  if (isExactAutoPick) {
    evidence.push(
      `The inverter on the record (\`${ev.inverterId}\`) is exactly what the ecosystem auto-select `
      + `writes for ${ev.ecosystemBrand ?? 'this ecosystem'} — the first string inverter the `
      + 'catalogue publishes for that brand.',
    );
  } else if (reachableByAutoPick) {
    evidence.push(
      `The inverter on the record (\`${ev.inverterId}\`) is one of the `
      + `${ev.ecosystemStringInverterIds.length} string inverters the `
      + `${ev.ecosystemBrand ?? 'this'} ecosystem publishes, which is the closed set the auto-select `
      + `can produce: it wrote \`${ev.autoPickWouldHaveChosen ?? 'the first entry'}\` and the sizing `
      + 'engine then upsized within the same brand.',
    );
  } else if (ev.autoPickWouldHaveChosen) {
    evidence.push(
      `The inverter on the record (\`${ev.inverterId}\`) is not one the `
      + `${ev.ecosystemBrand ?? 'this'} ecosystem publishes, so the ecosystem auto-select could not `
      + 'have produced it — though that does not by itself record who chose it.',
    );
  } else {
    evidence.push(
      'The catalogue publishes no string inverter for this ecosystem, so what the auto-select would '
      + 'have written cannot be reconstructed.',
    );
  }

  if (ev.storageTakesPvOnDc) {
    evidence.push(
      `${ev.pvCapableUnitCount} storage unit(s) in this project publish their own PV DC inputs, so `
      + 'a separate PV inverter is electrically redundant here — both placements remain physically '
      + 'possible.',
    );
  } else {
    evidence.push(
      'No storage in this project takes PV on its DC inputs, so a separate inverter is the only '
      + 'coherent placement for the strings.',
    );
  }

  // ── The storage cannot take the strings: there is no ambiguity to resolve. ──────────
  if (!ev.storageTakesPvOnDc) {
    return {
      verdict: 'INDETERMINATE',
      basis: 'How this inverter was chosen is not recorded, but nothing else in the project could '
        + 'carry the strings, so the architecture is not in question.',
      evidence,
      settlesIntent: true,   // the ARCHITECTURE is settled; the provenance is simply unknown
    };
  }

  if (reachableByAutoPick) {
    return {
      verdict: 'AUTO_SUGGESTED_LEGACY',
      basis: 'This selection is reachable from the value the ecosystem auto-select wrote without a '
        + 'click, on a project whose storage takes PV on DC — so it cannot stand as the '
        + "installer's decision. It is also what a deliberate click would have stored, so the "
        + 'evidence does not prove the opposite either. The architecture needs one explicit answer.',
      evidence,
      settlesIntent: false,
    };
  }

  return {
    verdict: 'INDETERMINATE',
    basis: 'Nothing recorded how this inverter was chosen, and the storage in this project can also '
      + 'take the strings on DC. Both architectures remain possible from what is persisted.',
    evidence,
    settlesIntent: false,
  };
}

/**
 * Read a stored provenance block defensively. Unknown kinds are dropped rather than coerced: a
 * value this build does not understand must not read as `USER_SELECTED`.
 */
export function parseStoredProvenance(raw: unknown): StoredEquipmentProvenance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: StoredEquipmentProvenance = {};
  for (const slot of ['inverter', 'battery', 'panel', 'architecture'] as const) {
    const rec = src[slot];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const r = rec as Record<string, unknown>;
    const kind = String(r.kind ?? '');
    if (!(kind in PROVENANCE_LABEL)) continue;
    out[slot] = {
      kind: kind as EquipmentProvenanceKind,
      recordedAt: typeof r.recordedAt === 'string' ? r.recordedAt : '',
      basis: typeof r.basis === 'string' ? r.basis : '',
      by: typeof r.by === 'string' ? r.by : undefined,
    };
  }
  return Object.keys(out).length ? out : null;
}

/** Build a record for a write path. `by` names the writer so the act is traceable. */
export function provenanceRecord(
  kind: EquipmentProvenanceKind, by: string, basis: string, now: Date,
): EquipmentProvenanceRecord {
  return { kind, by, basis, recordedAt: now.toISOString() };
}
