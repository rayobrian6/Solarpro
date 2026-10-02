// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE PROJECT-LEVEL ELECTRICAL MODEL — THE ONLY SUPPORTED PRODUCTION READ PATH.
//
// Ray, after the authority audit in `docs/ELECTRICAL-AUTHORITY-MAP.md` proved that one saved
// project could show "TESLA ecosystem applied" beside "Enphase IQ8 / MICRO / 37 microinverters",
// and that the SLD could draw both architectures on one sheet:
//
//   "SolarPro must expose one project-level electrical model to production consumers. Do not solve
//    this with more synchronization contracts. Do not blindly create a fourth overlapping persisted
//    JSON blob either. The existing stores may remain physically separate if they have genuinely
//    different responsibilities, but their semantic ownership must become non-overlapping and
//    production must consume them through one canonical project model/resolver."
//
// ═══ WHAT THIS IS NOT ═══
//
// 🚨 IT PERSISTS NOTHING. There is no fourth blob. This module is a pure function over the stores
// that already exist, and it is the composition — not another copy — that makes the answer single.
// Every field it returns names where it came from, so "who decided this" is answerable at runtime
// instead of by reading five files.
//
// 🚨 AND IT IS NOT A SYNCHRONISER. Nothing here writes a value back into another store to keep two
// copies equal. Ray ruled that shape out explicitly — `engineering_config.subSystems` is "doctrine
// owner" and `selected_equipment`'s is "a mirror … kept in sync", and that arrangement is what the
// audit found at the bottom of the contradiction. A composition cannot drift from itself.
//
// ═══ OWNERSHIP, AS RAY SET IT ═══
//
//   selected_equipment   physical catalogue selections only — WHICH product
//   service_topology     the connection graph and relationships only — HOW it is connected,
//                        and therefore HOW MANY physical instances exist
//   engineering_config   engineering inputs and explicit overrides; never inventory, never topology
//   snapshots            immutable historical records; never an input to a new calculation
//   localStorage         UI draft only; never project authority
//
// So a count comes from the graph when there is a graph, because an instance is a thing in the
// graph; and a model name comes from the catalogue selection, because that is a product choice.
// Neither store answers the other's question.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  ServiceTopology, SolarCoupling, StorageUnit,
} from '@/lib/electrical/serviceTopology';
import { summariseStorage, solarCouplingLabel } from '@/lib/electrical/serviceTopology';
import type {
  StoredEquipmentProvenance, LegacyInverterClassification, EquipmentProvenanceKind,
} from '@/lib/electrical/equipmentProvenance';
import { isInstallerDecision, PROVENANCE_LABEL } from '@/lib/electrical/equipmentProvenance';

/** The stores a fact can come from, named so provenance is readable rather than a file path. */
export type ElectricalSource =
  | 'service-topology'
  | 'selected-equipment'
  | 'engineering-config'
  | 'derived'
  | 'none';

export interface ElectricalProvenance {
  source: ElectricalSource;
  /** One sentence an engineer can read: why this value, from this store. */
  basis: string;
}

/**
 * 🚨 A REAL PERSISTED DISAGREEMENT, SURFACED RATHER THAN RESOLVED.
 *
 * Ray, on the case where a project holds explicit Enphase equipment AND a DC-coupled Tesla graph:
 * "That is a real persisted conflict. Do not silently choose either side. Surface an
 * electrical-configuration conflict requiring resolution unless a documented migration rule can
 * prove which state is obsolete."
 *
 * So a conflict is a first-class result, not an exception and not a tie-break. The model still
 * returns everything else it could resolve — a conflict about the PV does not stop the service
 * engineering — and the consumer decides whether it can proceed.
 */
/**
 * 🚨 A MACHINE-READABLE NAME FOR THE DISAGREEMENT.
 *
 * `fact` is a sentence for a human and will be reworded; a consumer that must BLOCK on a specific
 * conflict cannot key off prose. Ray: "Do not generate a permit-grade SLD from an unresolved
 * architecture conflict" — that gate needs to know WHICH conflict, not how many there are.
 */
export type ElectricalConflictCode =
  /** Where the PV lands: a separate AC inverter, or the storage's DC inputs. Blocks the drawing. */
  | 'SOLAR_COUPLING_UNRESOLVED'
  /** The catalogue's battery count disagrees with the graph's instances. Does not block. */
  | 'STORAGE_COUNT_MIRROR_STALE';

export interface ElectricalConflict {
  /** 🚨 THE STABLE IDENTITY of this disagreement. Gates key off this, never off `fact`. */
  code: ElectricalConflictCode;
  /** The fact two stores disagree about. */
  fact: string;
  /** What each store claims, in the operator's words. */
  claims: Array<{ source: ElectricalSource; says: string }>;
  /** The question a human has to answer. Never rhetorical: it names both options. */
  question: string;
}

export interface ResolvedStorage {
  /** Inverter-bearing units. From the graph's instances where a graph exists. */
  invertingUnitCount: number;
  /** DC expansion units. Never folded into the count above. */
  expansionUnitCount: number;
  /** Controllers / gateways. */
  gatewayCount: number;
  /** Generation / combiner panels that belong to one system. */
  perSystemGenerationPanelCount: number;
  /** Distinct inverting-unit model names, as the graph recorded them. */
  models: string[];
  usableKwh: number | null;
  continuousOutputA: number | null;
  provenance: ElectricalProvenance;
}

/**
 * Where a separate PV inverter on this project came from, resolved from stored provenance when the
 * project has it and from legacy evidence when it does not.
 */
export interface ExternalInverterOrigin {
  /** The stored kind, or `'UNRECORDED'` when nothing was stored and evidence could not settle it. */
  kind: EquipmentProvenanceKind | 'UNRECORDED';
  /** A short label for a badge. */
  label: string;
  /** One sentence for an operator. */
  basis: string;
  /** The evidence lines, when this came from legacy analysis. Shown verbatim. */
  evidence: string[];
  /** 🚨 Does this origin stand as the installer's decision? */
  isInstallerDecision: boolean;
}

/** One answer to the architecture question, with the values a resolution would persist. */
export interface ArchitectureChoice {
  /** The coupling this choice records. */
  coupling: SolarCoupling;
  /** The button text. */
  label: string;
  /** What choosing it does to the project, stated before it is clicked. */
  consequence: string;
  /** Does choosing this retire the separate inverter selection from current design authority? */
  retiresExternalInverter: boolean;
}

export interface ElectricalProjectModel {
  /** The connection graph. null ⇒ none has been built. */
  topology: ServiceTopology | null;
  /** 🚨 THE PROJECT'S ONE ANSWER about the PV, canonical and provenanced. */
  solarCoupling: SolarCoupling | null;
  solarCouplingLabel: string;
  solarCouplingProvenance: ElectricalProvenance;
  /** Does this project have a separate AC PV inverter at all? */
  hasExternalInverter: boolean;
  /** Its catalogue id, when there is one. Exposed because a resolution has to NAME what it retires. */
  externalInverterId: string | null;
  externalInverterProvenance: ElectricalProvenance;
  /**
   * 🚨 WHERE THE SEPARATE INVERTER CAME FROM — null when there is no separate inverter.
   *
   * This is the field that answers Ray's "persisted equipment existence alone does not prove
   * installer intent". A surface that lists the inverter must read this before presenting it as the
   * installer's choice.
   */
  externalInverterOrigin: ExternalInverterOrigin | null;
  /**
   * 🚨 MUST A HUMAN CHOOSE THE ARCHITECTURE BEFORE THIS PROJECT CAN BE DRAWN?
   *
   * True only for the coupling conflict — the one disagreement where every downstream surface would
   * otherwise have to pick a side to render at all. A stale battery-count mirror does not set this:
   * Ray, "Other unrelated project engineering may continue."
   */
  architectureResolutionRequired: boolean;
  /**
   * The two answers the question has, ready for the dialog. Empty unless
   * `architectureResolutionRequired`. Carried on the model so every surface offers the SAME two
   * choices with the same wording and the same values.
   */
  architectureChoices: ArchitectureChoice[];
  /** Service rating. null ⇒ not established — which is NOT a reason to discard anything. */
  serviceRatedAmps: number | null;
  serviceProvenance: ElectricalProvenance;
  storage: ResolvedStorage;
  /**
   * 🚨 HOW MANY PV MODULES THE DESIGN PLACES — exposed because the model READS it.
   *
   * It decides the storage-only case below, and it is a real electrical fact besides: the DC string
   * sizing and the array table on the sheet both move with it. A value the resolver consumes but
   * hides is a value `electricalRevision` cannot fingerprint, which would let a 72-module sheet
   * survive a 36-module project with a green CURRENT badge. `null` ⇒ no design has been read.
   */
  moduleCount: number | null;
  /** Real persisted disagreements. Empty ⇒ the project is internally consistent. */
  conflicts: ElectricalConflict[];
  /**
   * 🚨 WHAT A MIGRATION WOULD WRITE, so the inference happens ONCE.
   *
   * Ray: "Treat that as a migration/canonicalization test, not as permission to infer forever."
   * When the resolver derives a coupling from unambiguous evidence, this carries the value the
   * save path should persist onto the graph. Null when nothing was derived, or when the evidence
   * was contradictory — a conflict is never silently written away.
   */
  canonicalizationPatch: { solarCoupling: SolarCoupling } | null;
}

/** What the resolver needs from `projects.selected_equipment`, structurally. */
export interface SelectedEquipmentView {
  /** A catalogue id for a separate AC PV inverter, when the project has chosen one. */
  inverterId?: string | null;
  /** Its resolved type, when known: 'micro' | 'string' | 'optimizer' | … */
  inverterType?: string | null;
  batteryId?: string | null;
  batteryCount?: number | null;
  /** Modules placed. 0 ⇒ no PV on this project. */
  moduleCount?: number | null;
}

export interface ResolveElectricalInput {
  topology: ServiceTopology | null;
  selectedEquipment: SelectedEquipmentView | null;
  /** Engineering inputs and explicit overrides. Never inventory, never topology. */
  /**
   * 🚨 THE OVERRIDE CHANNEL IS GONE, BECAUSE NOTHING COULD EVER WRITE IT.
   *
   * `serviceRatedAmpsOverride` was read here and in `loadElectricalProject`, declared in this
   * interface, and set by exactly one TEST FIXTURE. An exhaustive search of the repository found no
   * production writer — no route, no page, no migration, no seed. The authority inspector and
   * `docs/ELECTRICAL-AUTHORITY-REAUDIT.md` both advertised it as the way `engineering_config` could
   * outrank the graph, and it could not be reached.
   *
   * That is worse than a missing feature: it is a documented answer to "can another store win?"
   * that describes a mechanism which does not exist, while the store that ACTUALLY competes
   * (`engineering_config.mainPanelAmps`, which the engineer's own control edits) went unnamed.
   *
   * So the graph is the only owner of the service rating, stated plainly. If an engineer ever needs
   * to override a wrong graph rating, that is a DECISION and must be built like one — with a
   * recorded provenance, exactly as the coupling now is. A silent scalar in a config blob is how
   * this whole class of defect started.
   */
  engineeringConfig?: null;
  /**
   * 🚨 HOW THE SELECTED EQUIPMENT CAME TO BE SELECTED, when the project recorded it.
   *
   * Absent on every project saved before provenance existed — which is exactly the case this
   * model must handle without guessing, so absence is a normal input and not a gap to fill.
   */
  equipmentProvenance?: StoredEquipmentProvenance | null;
  /**
   * The verdict of the legacy evidence analysis, for a row that recorded no provenance.
   *
   * Computed OUTSIDE the resolver because it needs the catalogue (what the auto-picker would have
   * chosen) and this function stays catalogue-free so the browser and the server agree. Null when
   * nothing needed classifying.
   */
  legacyInverter?: LegacyInverterClassification | null;
}

const NONE: ElectricalProvenance = { source: 'none', basis: 'Nothing in this project states it.' };

/**
 * Is this storage unit able to take PV on its own DC inputs?
 *
 * 🚨 READ OFF THE INSTANCE, NOT OFF A BRAND. The unit carries the manufacturer's published input
 * limits (resolved from its catalogue row when it was built), so "can this battery be DC coupled"
 * is a property of the equipment rather than a guess from the word Tesla.
 */
export const takesPvOnDc = (u: StorageUnit): boolean =>
  u.role === 'inverter-unit' && !!u.pvInputLimits;

/**
 * Compose the one electrical model from the stores that own its parts.
 *
 * Pure, synchronous, and it reads no catalogue: everything it needs was resolved onto the
 * instances when they were built. That is what lets the same function run on the server for the
 * permit and in the browser for the sidebar and give the same answer.
 */
export function resolveElectricalProject(
  input: ResolveElectricalInput,
): ElectricalProjectModel {
  const t = input.topology ?? null;
  const sel = input.selectedEquipment ?? null;
  const conflicts: ElectricalConflict[] = [];

  // ── IS THERE A SEPARATE AC PV INVERTER? ─────────────────────────────────
  //
  // 🚨 THE ABSENCE OF ONE IS A FACT, NOT A GAP TO FILL. This is the question the load path used to
  // answer by taking the first microinverter out of the catalogue.
  const explicitInverterId = (sel?.inverterId ?? '').trim();
  const hasExternalInverter = explicitInverterId.length > 0;
  const externalInverterProvenance: ElectricalProvenance = hasExternalInverter
    ? { source: 'selected-equipment',
        basis: `The project has selected '${explicitInverterId}' as a separate PV inverter.` }
    : { source: 'selected-equipment',
        basis: 'No separate PV inverter has been selected. That is a state, not a missing value.' };

  // ── WHERE DID THAT INVERTER COME FROM? ───────────────────────────────────
  //
  // 🚨 ASKED BEFORE THE COUPLING IS DERIVED, because the answer changes what the derivation is
  // allowed to conclude. A stored `USER_SELECTED` is an installer decision and the conflict names it
  // as one; an `AUTO_SUGGESTED_LEGACY` verdict means the inverter is a suggestion nobody confirmed,
  // and the conflict says THAT instead — which is the difference between asking Ray to adjudicate
  // between two of his own decisions and telling him one side was never his.
  const storedInvProv = input.equipmentProvenance?.inverter ?? null;
  const legacy = input.legacyInverter ?? null;
  const externalInverterOrigin: ExternalInverterOrigin | null = !hasExternalInverter ? null
    : storedInvProv
      ? {
          kind: storedInvProv.kind,
          label: PROVENANCE_LABEL[storedInvProv.kind],
          basis: storedInvProv.basis
            || `Recorded as ${PROVENANCE_LABEL[storedInvProv.kind]}`
               + `${storedInvProv.by ? ` by ${storedInvProv.by}` : ''}.`,
          evidence: [],
          isInstallerDecision: isInstallerDecision(storedInvProv),
        }
      : legacy && legacy.verdict === 'AUTO_SUGGESTED_LEGACY'
        ? {
            kind: 'AUTO_SUGGESTED_LEGACY',
            label: PROVENANCE_LABEL.AUTO_SUGGESTED_LEGACY,
            basis: legacy.basis,
            evidence: legacy.evidence,
            isInstallerDecision: false,
          }
        : {
            // 🚨 UNRECORDED IS ITS OWN ANSWER. Not `USER_SELECTED` with low confidence — a surface
            // that renders this must not print "selected by the installer" over a row that never
            // said so.
            kind: 'UNRECORDED',
            label: 'Origin not recorded',
            basis: legacy?.basis
              ?? 'This project was saved before SolarPro recorded how equipment was chosen, so how '
                 + 'this inverter was selected is not known.',
            evidence: legacy?.evidence ?? [],
            isInstallerDecision: false,
          };

  // ── THE PV COUPLING ──────────────────────────────────────────────────────
  const recorded = t?.solarCoupling ?? null;
  const pvCapableUnits = (t?.storage ?? []).filter(takesPvOnDc);
  const moduleCount = typeof sel?.moduleCount === 'number' ? sel.moduleCount : null;

  let solarCoupling: SolarCoupling | null = null;
  let solarCouplingProvenance: ElectricalProvenance = NONE;
  let canonicalizationPatch: { solarCoupling: SolarCoupling } | null = null;

  // ══════════════════════════════════════════════════════════════════════════
  // 🚨 "RECORDED" IS NOT THE SAME AS "DECIDED" — AND THIS IS WHAT RAY'S THIRD RUN FOUND.
  //
  // His project failed acceptance for a THIRD time, on a build that refuses to draw an unresolved
  // architecture. Both facts were true at once because the architecture is not unresolved on his
  // row: `solarCoupling = 'ac-coupled-inverter'` is RECORDED on it.
  //
  // Nobody chose that. Three automatic steps wrote it:
  //   1. `EcosystemPicker` auto-selected a Tesla string inverter with no click.
  //   2. `projectModel` (at 921b23a7) reached `else if (hasExternalInverter)` BEFORE the DC-capable
  //      check and returned `canonicalizationPatch = { solarCoupling: 'ac-coupled-inverter' }`.
  //   3. `sld/route.ts` called `persistElectricalCanonicalization`, which WROTE it.
  //
  // So SolarPro derived an architecture from its own suggestion and stored it in the slot a designer
  // writes to. This branch then read it back and called it "Recorded on the project by the designer"
  // — and because the conflict check only questioned `dc-coupled-storage`, nothing ever asked again.
  // A correction that writes a falsehood and then makes itself invisible is worse than the defect.
  //
  // 🚨 THE RULE, which is Ray's RULE FOUR: A PROJECTION MAY NEVER REPAIR, FILL OR OVERRIDE ITS
  // OWNER. A derived coupling is a projection. Written into the owner's slot it became indistinguish-
  // able from a decision — so the slot now has to say WHICH, and a value that is merely derived is
  // re-tested against the evidence instead of outranking it.
  //
  // `provenance.architecture` is that record. It is written when a human answers: the resolution
  // endpoint writes it, and the service-topology PUT writes it when a designer submits a coupling
  // through the wizard. Its ABSENCE beside a recorded coupling means the value got there by
  // derivation, because nothing else could have put it there without recording itself.
  // ══════════════════════════════════════════════════════════════════════════
  const architectureIsDecision = !!input.equipmentProvenance?.architecture;

  if (recorded) {
    solarCoupling = recorded;
    solarCouplingProvenance = architectureIsDecision
      ? {
          source: 'service-topology',
          basis: 'Recorded on the project by the designer'
            + (input.equipmentProvenance!.architecture!.recordedAt
                ? ` on ${input.equipmentProvenance!.architecture!.recordedAt.slice(0, 10)}`
                : '')
            + '.',
        }
      : {
          // 🚨 NOT `service-topology`. Reporting a derivation as the designer's word is the
          // misstatement that kept this alive through two acceptance runs.
          source: 'derived',
          basis: `The project records '${recorded}', but nothing records who decided it — so it was `
            + 'written by a derivation rather than stated by a designer.',
        };
    // ── CASE B — A REAL PERSISTED CONFLICT ────────────────────────────────
    //
    // The graph says the strings terminate on the batteries' DC inputs, and the equipment store
    // holds a separate AC inverter. Both are explicit; neither is a default. Nothing here picks a
    // winner, because picking one silently is how the drawing came to contain both.
    if (recorded === 'dc-coupled-storage' && hasExternalInverter) {
      conflicts.push({
        code: 'SOLAR_COUPLING_UNRESOLVED',
        fact: 'How the PV is coupled',
        claims: [
          { source: 'service-topology',
            says: 'The strings terminate on the batteries\' own DC inputs — no separate inverter.' },
          { source: 'selected-equipment',
            says: `A separate PV inverter is selected: '${explicitInverterId}'.` },
        ],
        question: 'Does this project have a separate AC PV inverter, or does the PV land on the '
          + 'batteries? Remove the inverter selection, or change the coupling to "PV on its own AC '
          + 'inverter".',
      });
    } else if (
      // ══════════════════════════════════════════════════════════════════════
      // 🚨 THE COMBINATION NOTHING ASKED ABOUT — RAY'S LIVE ROW.
      //
      // A recorded `ac-coupled-inverter`, on a graph whose storage takes PV on its own DC inputs,
      // where NO human recorded the architecture and the inverter the architecture rests on is not
      // an installer decision either. Every link in that chain is automatic, so the recorded value
      // carries no more authority than the derivation that produced it — and the derivation is the
      // one `923b23a7` got wrong.
      //
      // Scoped tightly, because Ray's standing constraint is that other brands and other scenarios
      // must not change:
      //   · a designer who answers the wizard records `provenance.architecture` and never sees this;
      //   · an inverter the installer actually chose (`USER_SELECTED`) never sees this;
      //   · storage that publishes no PV input never sees this — only the PW3 class does today.
      // ══════════════════════════════════════════════════════════════════════
      !architectureIsDecision
      && recorded === 'ac-coupled-inverter'
      && pvCapableUnits.length > 0
      // 🚨 AND THE EQUIPMENT MUST BE A SUGGESTION TOO — not merely "not proven to be a decision".
      //
      // The first cut of this tested `isInstallerDecision !== true`, which is also false for
      // `UNRECORDED` — and `UNRECORDED` is every pre-provenance project. That immediately re-opened
      // a legitimately AC-coupled Tesla job carrying Enphase micros beside four Powerwalls, which is
      // a real design Ray named explicitly: "Do not assume Tesla storage always eliminates Enphase."
      // Its own suite caught it.
      //
      // The claim this branch is entitled to make is narrow: BOTH links in the chain were automatic
      // — a coupling no human recorded, derived from an inverter the ecosystem picker suggested.
      // An Enphase inverter on a Tesla graph is not reachable from the Tesla auto-pick, so it is
      // `INDETERMINATE`, and an unknown origin is not evidence of anything.
      && externalInverterOrigin?.kind === 'AUTO_SUGGESTED_LEGACY'
    ) {
      conflicts.push({
        code: 'SOLAR_COUPLING_UNRESOLVED',
        fact: 'How the PV is coupled',
        claims: [
          { source: 'service-topology',
            says: "The project records 'PV on its own AC inverter' — but nothing records who decided "
              + 'it, so it was written by a derivation and not stated by a designer.' },
          { source: 'selected-equipment',
            says: hasExternalInverter
              ? `The inverter that architecture rests on ('${explicitInverterId}') is not an `
                + `installer decision either: ${externalInverterOrigin?.label.toLowerCase() ?? 'origin not recorded'}.`
              : 'No separate PV inverter is on the project at all, so there is nothing for the PV to '
                + 'be AC coupled through.' },
          { source: 'service-topology',
            says: `${pvCapableUnits.length} storage unit(s) publish their own PV DC inputs, so the `
              + 'strings could terminate there instead.' },
        ],
        question: 'Nothing in this project states where the strings land — the recorded answer was '
          + 'derived from an inverter nobody chose. Does the PV run through a separate inverter on '
          + 'AC, or land on the batteries’ DC inputs?',
      });
    }
  } else if (hasExternalInverter && pvCapableUnits.length > 0) {
    // ══════════════════════════════════════════════════════════════════════
    // 🚨 CASE B, IN THE DERIVATION PATH — AND THIS WAS THE LIVE DEFECT.
    //
    // A separate inverter is selected AND the storage publishes its own PV inputs. BOTH placements
    // are physically possible, so the persisted evidence does not settle where the strings land.
    //
    // This branch used to be `else if (hasExternalInverter)` ALONE, checked before the DC case — so
    // the ordering decided it, silently, every time. On Ray's real project that produced the
    // reported failure: a graph holding four Powerwall 3 resolved to `ac-coupled-inverter` because
    // an inverter was selected, the sheet drew an AC chain beside the Tesla hardware, and the
    // derivation emitted a canonicalization patch that would have PERMANENTLY RECORDED the wrong
    // architecture on the first generate.
    //
    // Ray drew this line himself: "If the persisted evidence is sufficient and non-contradictory,
    // canonicalize… That is a real persisted conflict. Do not silently choose either side." An
    // ordering is not evidence.
    //
    // 🚨 AND IT IS NOT "TESLA WINS" EITHER. A legitimately AC-coupled Tesla install is real — Ray:
    // "Do not assume Tesla storage always eliminates Enphase." Preferring the storage here would be
    // the same sin facing the other way. Neither side is chosen; the designer is asked, exactly as
    // `derArrangement` asks. Once they record it, the recorded value wins and this never fires again.
    // ══════════════════════════════════════════════════════════════════════
    conflicts.push({
      code: 'SOLAR_COUPLING_UNRESOLVED',
      fact: 'How the PV is coupled',
      claims: [
        // 🚨 THE CLAIM REPORTS ITS OWN STANDING. Ray's live row holds an inverter nobody clicked, so
        // "a separate PV inverter is selected" was itself a misleading sentence — it describes the
        // bytes accurately and the act wrongly.
        { source: 'selected-equipment',
          says: externalInverterOrigin && !externalInverterOrigin.isInstallerDecision
            ? `A separate PV inverter is on the project ('${explicitInverterId}'), but its origin `
              + `does not stand as a decision: ${externalInverterOrigin.label.toLowerCase()}.`
            : `A separate PV inverter is selected: '${explicitInverterId}'.` },
        { source: 'service-topology',
          says: `${pvCapableUnits.length} storage unit(s) publish their own PV DC inputs, so the `
            + 'strings could terminate there instead.' },
      ],
      question: 'Does the PV run through the separate inverter on AC, or land on the batteries\' DC '
        + 'inputs? Record the coupling on the project, or remove the inverter selection if the '
        + 'strings go to the batteries.',
    });
    solarCouplingProvenance = {
      source: 'none',
      basis: 'A separate inverter is selected and the storage also takes PV on DC. Both are '
        + 'possible, so nothing is derived — see the conflict.',
    };
  } else if (hasExternalInverter) {
    // ── CASE A(i) — unambiguous: an inverter, and no storage that could take the strings ────
    solarCoupling = 'ac-coupled-inverter';
    solarCouplingProvenance = {
      source: 'derived',
      basis: `Derived: the project has selected a separate PV inverter ('${explicitInverterId}') `
        + 'and no storage in this project takes PV on its DC inputs, so the PV reaches the premises '
        + 'on AC. Nothing recorded a coupling before this.',
    };
    canonicalizationPatch = { solarCoupling: 'ac-coupled-inverter' };
  } else if (moduleCount === 0) {
    // ── CASE A(ii) — no modules at all ────────────────────────────────────
    solarCoupling = 'storage-only';
    solarCouplingProvenance = {
      source: 'derived',
      basis: 'Derived: the project places no PV modules, so there is no PV to couple.',
    };
    canonicalizationPatch = { solarCoupling: 'storage-only' };
  } else if (pvCapableUnits.length > 0) {
    // ── CASE A(iii) — the batteries take PV and nothing else can ──────────
    //
    // This is Ray's real job before `solarCoupling` existed: no separate inverter has been
    // selected, and the storage in the graph publishes its own PV inputs. The evidence is
    // sufficient and non-contradictory, so it canonicalises ONCE and the patch records it.
    solarCoupling = 'dc-coupled-storage';
    solarCouplingProvenance = {
      source: 'derived',
      basis: `Derived: no separate PV inverter is selected and ${pvCapableUnits.length} storage `
        + 'unit(s) publish their own PV inputs, so the strings can only terminate there.',
    };
    canonicalizationPatch = { solarCoupling: 'dc-coupled-storage' };
  } else {
    // 🚨 AND WHEN THE EVIDENCE IS NOT SUFFICIENT, NOTHING IS DERIVED. A project with modules, no
    // inverter and no PV-capable storage is genuinely unanswerable from what is persisted — and
    // guessing here is exactly the habit this module exists to end.
    solarCouplingProvenance = {
      source: 'none',
      basis: 'No coupling is recorded, no separate inverter is selected, and no storage in this '
        + 'project publishes a PV input — so the evidence does not settle it.',
    };
  }

  // ── STORAGE: INSTANCES FROM THE GRAPH, CATALOGUE COUNTS ONLY WITHOUT ONE ──
  //
  // 🚨 A COUNT IS A PROPERTY OF THE GRAPH. Four Powerwalls is four nodes; `batteryCount: 0` beside
  // them was the audit's C1, and it reached the cover sheet and the BOM. Where a graph exists it
  // answers, and `selected_equipment.batteryCount` becomes a legacy projection of it.
  let storage: ResolvedStorage;
  if (t) {
    const s = summariseStorage(t);
    storage = {
      invertingUnitCount: s.inverterUnitCount,
      expansionUnitCount: s.expansionUnitCount,
      gatewayCount: t.domains.length,
      perSystemGenerationPanelCount: (t.aggregationPanels ?? []).filter(p => p.domainId).length,
      models: [...new Set(t.storage
        .filter(u => u.role === 'inverter-unit')
        .map(u => u.label ?? u.productId))],
      usableKwh: s.totalUsableKwh,
      continuousOutputA: s.totalContinuousOutputA,
      provenance: {
        source: 'service-topology',
        basis: 'Counted from the physical instances in the connection graph.',
      },
    };
    // A catalogue count that disagrees with the instances is a stale mirror, not a second opinion.
    const sc = typeof sel?.batteryCount === 'number' ? sel.batteryCount : null;
    if (sc !== null && sc !== s.inverterUnitCount + s.expansionUnitCount) {
      conflicts.push({
        code: 'STORAGE_COUNT_MIRROR_STALE',
        fact: 'How many storage units this project has',
        claims: [
          { source: 'service-topology',
            says: `${s.inverterUnitCount} inverting unit(s) and ${s.expansionUnitCount} expansion(s) `
              + 'are placed in the graph.' },
          { source: 'selected-equipment', says: `batteryCount is ${sc}.` },
        ],
        question: 'The graph holds the physical instances; the catalogue count is a legacy mirror '
          + 'of it. Rebuild the mirror from the graph, or correct the graph.',
      });
    }
  } else {
    const sc = typeof sel?.batteryCount === 'number' ? sel.batteryCount : 0;
    storage = {
      invertingUnitCount: sc,
      expansionUnitCount: 0,
      gatewayCount: 0,
      perSystemGenerationPanelCount: 0,
      models: sel?.batteryId ? [sel.batteryId] : [],
      usableKwh: null,
      continuousOutputA: null,
      provenance: sel
        ? { source: 'selected-equipment',
            basis: 'No connection graph exists, so the catalogue selection is all there is.' }
        : NONE,
    };
  }

  // ── THE SERVICE RATING ───────────────────────────────────────────────────
  //
  // 🚨 ONE OWNER: THE GRAPH. See `engineeringConfig` above — the override this used to consult had
  // no writer anywhere in the codebase, so "overridable by engineering_config" was a documented
  // mechanism that did not exist.
  const serviceRatedAmps = typeof t?.service.ratedAmps === 'number' ? t.service.ratedAmps : null;
  const serviceProvenance: ElectricalProvenance =
    serviceRatedAmps !== null
      ? { source: 'service-topology', basis: 'The service rating recorded on the graph.' }
      : { source: 'none',
          basis: 'No service rating has been established. The graph is still evaluated; the '
            + 'conclusions that need the rating report NOT_EVALUATED naming it.' };

  // ── THE GATE ─────────────────────────────────────────────────────────────
  //
  // 🚨 ONLY THE COUPLING BLOCKS. Ray: "Until the conflict is resolved, downstream production
  // surfaces must not pretend STRING INVERTER is authoritative… Other unrelated project engineering
  // may continue." A stale `batteryCount` mirror is a real conflict and it must NOT stop a drawing,
  // so the gate names the one code it blocks on instead of counting conflicts.
  const architectureResolutionRequired =
    conflicts.some(c => c.code === 'SOLAR_COUPLING_UNRESOLVED');

  const architectureChoices: ArchitectureChoice[] = !architectureResolutionRequired ? [] : [
    {
      coupling: 'dc-coupled-storage',
      label: 'PV connects directly to the batteries (DC coupled)',
      consequence: 'The strings terminate on the storage DC inputs. The separate inverter stops '
        + 'counting as design authority — it stays on the record as history, and the strings are '
        + 'resized against the published PV input limits. No module is added or removed.',
      retiresExternalInverter: true,
    },
    {
      coupling: 'ac-coupled-inverter',
      label: `PV uses the separate inverter${explicitInverterId ? ` (${explicitInverterId})` : ''}`,
      consequence: 'The strings run through the separate inverter and reach the premises on AC. The '
        + 'inverter is recorded as a decision the installer made and stops being reported as a '
        + 'suggestion.',
      retiresExternalInverter: false,
    },
  ];

  return {
    topology: t,
    solarCoupling,
    solarCouplingLabel: solarCouplingLabel(solarCoupling, t ?? undefined),
    solarCouplingProvenance,
    hasExternalInverter,
    externalInverterId: hasExternalInverter ? explicitInverterId : null,
    externalInverterProvenance,
    externalInverterOrigin,
    architectureResolutionRequired,
    architectureChoices,
    serviceRatedAmps,
    serviceProvenance,
    storage,
    moduleCount,
    conflicts,
    // 🚨 NEVER WRITE A CANONICALISATION AWAY FROM A CONFLICT. If the stores disagree, the decision
    // belongs to a human, and persisting a derived value would make the disagreement invisible.
    canonicalizationPatch: conflicts.length === 0 ? canonicalizationPatch : null,
  };
}

/**
 * Does this model have an unresolved electrical conflict a human must settle?
 *
 * Named so a consumer asks the question rather than testing `conflicts.length` and inventing its
 * own threshold.
 */
export const hasElectricalConflict = (m: ElectricalProjectModel): boolean =>
  m.conflicts.length > 0;
