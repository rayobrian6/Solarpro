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
export interface ElectricalConflict {
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

export interface ElectricalProjectModel {
  /** The connection graph. null ⇒ none has been built. */
  topology: ServiceTopology | null;
  /** 🚨 THE PROJECT'S ONE ANSWER about the PV, canonical and provenanced. */
  solarCoupling: SolarCoupling | null;
  solarCouplingLabel: string;
  solarCouplingProvenance: ElectricalProvenance;
  /** Does this project have a separate AC PV inverter at all? */
  hasExternalInverter: boolean;
  externalInverterProvenance: ElectricalProvenance;
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
  engineeringConfig?: { serviceRatedAmpsOverride?: number | null } | null;
}

const NONE: ElectricalProvenance = { source: 'none', basis: 'Nothing in this project states it.' };

/**
 * Is this storage unit able to take PV on its own DC inputs?
 *
 * 🚨 READ OFF THE INSTANCE, NOT OFF A BRAND. The unit carries the manufacturer's published input
 * limits (resolved from its catalogue row when it was built), so "can this battery be DC coupled"
 * is a property of the equipment rather than a guess from the word Tesla.
 */
const takesPvOnDc = (u: StorageUnit): boolean =>
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

  // ── THE PV COUPLING ──────────────────────────────────────────────────────
  const recorded = t?.solarCoupling ?? null;
  const pvCapableUnits = (t?.storage ?? []).filter(takesPvOnDc);
  const moduleCount = typeof sel?.moduleCount === 'number' ? sel.moduleCount : null;

  let solarCoupling: SolarCoupling | null = null;
  let solarCouplingProvenance: ElectricalProvenance = NONE;
  let canonicalizationPatch: { solarCoupling: SolarCoupling } | null = null;

  if (recorded) {
    solarCoupling = recorded;
    solarCouplingProvenance = {
      source: 'service-topology',
      basis: 'Recorded on the project by the designer.',
    };
    // ── CASE B — A REAL PERSISTED CONFLICT ────────────────────────────────
    //
    // The graph says the strings terminate on the batteries' DC inputs, and the equipment store
    // holds a separate AC inverter. Both are explicit; neither is a default. Nothing here picks a
    // winner, because picking one silently is how the drawing came to contain both.
    if (recorded === 'dc-coupled-storage' && hasExternalInverter) {
      conflicts.push({
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
      fact: 'How the PV is coupled',
      claims: [
        { source: 'selected-equipment',
          says: `A separate PV inverter is selected: '${explicitInverterId}'.` },
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
  // The graph owns it. An engineering override is an explicit, recorded decision and outranks it;
  // `engineering_config` is where overrides belong and the only thing it may own here.
  const override = input.engineeringConfig?.serviceRatedAmpsOverride ?? null;
  const graphRating = typeof t?.service.ratedAmps === 'number' ? t.service.ratedAmps : null;
  const serviceRatedAmps = typeof override === 'number' ? override : graphRating;
  const serviceProvenance: ElectricalProvenance =
    typeof override === 'number'
      ? { source: 'engineering-config', basis: 'An explicit engineering override is recorded.' }
      : graphRating !== null
        ? { source: 'service-topology', basis: 'The service rating recorded on the graph.' }
        : { source: 'none',
            basis: 'No service rating has been established. The graph is still evaluated; the '
              + 'conclusions that need the rating report NOT_EVALUATED naming it.' };

  return {
    topology: t,
    solarCoupling,
    solarCouplingLabel: solarCouplingLabel(solarCoupling, t ?? undefined),
    solarCouplingProvenance,
    hasExternalInverter,
    externalInverterProvenance,
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
