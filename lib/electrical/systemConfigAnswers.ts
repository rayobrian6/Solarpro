// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AN INSTALLER'S ANSWER, TURNED INTO THE ENGINEERING MODEL — THROUGH THE EXISTING AUTHORING.
//
// System Config asks real-world questions ("400 A service", "two 200 A main panels", "back up the
// whole home", "a breaker in the panel"). These functions translate one answer into one edit of the
// service graph — the owner every drawing, BOM and permit already reads — using the authoring and
// preset functions the Service Topology wizard used (`lib/electrical/topologyAuthoring.ts`,
// `lib/electrical/topologyPresets.ts`). Nothing here is a new authority, a new store, or a second
// description of the service.
//
// Each function is pure: (graph, answer) → { topology } or { refused }. The page persists the result
// through the one write path (`PUT /api/projects/[id]/service-topology`), so "UI action → state
// mutation → persistence → reload" is one function plus a route, and both are testable.
//
// 🚨 A REFUSAL IS A RESULT. Where an answer would destroy equipment the installer already authored
// (rebuilding the distribution under a system that has gateways and batteries on it), the function
// refuses and says why instead of quietly rebuilding.
// ═══════════════════════════════════════════════════════════════════════════

import {
  createServiceTopology, addBackupDomain, removeBackupDomain, setDomainEquipment, updatePanel,
  updateDomain, setInterconnection, addPointOfInterconnection, updatePointOfInterconnection,
  setStoragePvInput, setExistingServiceEquipment, setSolarCoupling, setServiceExistingOrNew,
} from '@/lib/electrical/topologyAuthoring';
import {
  buildServiceFromPreset, applyDerArrangement, applyIsolationArrangement,
  applyPerSystemGenerationPanels, clearPerSystemGenerationPanels,
} from '@/lib/electrical/topologyPresets';
import type {
  ServiceTopology, ServicePhase, PoiRelationship, DerArrangement, BackupDomain, SolarCoupling, PanelBoard,
} from '@/lib/electrical/serviceTopology';
import { isServicePhase, servicePhaseInfo, serviceExistingOrNew, existingServiceReading } from '@/lib/electrical/serviceTopology';

export type AnswerResult =
  | { ok: true; topology: ServiceTopology; did: string }
  | { ok: false; refused: string };

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });

/**
 * 🚨 WHERE "ADVANCED" IS. A refusal that sends an edit to the graph editor has to name a place the
 * installer can actually reach. Service Topology is no longer a tab (Ray: "Remove Service Topology from
 * normal Engineering navigation"); the graph editor survives only as a diagnostic surface inside
 * Engineering Readiness → Review Engineering. Every refusal says that, in these words.
 */
export const ADVANCED_EDITOR = 'the Advanced service model editor (Engineering Readiness → Review Engineering)';

/**
 * 🚨 ONE UNIT FOR AN INTERRUPTING RATING ON EVERY SCREEN: kA, as nameplates print it (the fault
 * current and the Verify AIC are entered in kA too). Stored in amperes. A panel's SCCR and a
 * generation panel's SCCR go through these two — an installer copying "10" off a 10 kA generation
 * panel label recorded 10 A when that field alone took amperes.
 */
export const sccrAmpsFromKa = (ka: number): number => Math.round(ka * 1000);
export const sccrKaFromAmps = (amps: number): number => amps / 1000;

/** Services above this are commonly split; at or below it a service IS one main panel. */
export const SINGLE_PANEL_MAX_A = 225;

/** The voltage a known electrical system runs at, line to line. Null ⇒ not a system SolarPro models. */
export function voltageForPhase(phase: string): number | null {
  return isServicePhase(phase) ? servicePhaseInfo(phase).lineToLineV : null;
}

/** Keep the decisions a graph already records when its distribution is (re)built. */
function carryDecisions(from: ServiceTopology | null, to: ServiceTopology): ServiceTopology {
  if (!from) return to;
  return {
    ...to,
    service: {
      ...to.service,
      availableFaultCurrentA: from.service.availableFaultCurrentA,
      // 🚨 The existing-or-new ANSWER is carried, not just the reading: rebuilding the
      // distribution must not turn "new" (or "not answered") into the other.
      existingOrNew: serviceExistingOrNew(from.service),
      existingEquipment: from.service.existingEquipment ?? null,
    },
    solarCoupling: from.solarCoupling ?? null,
    interconnection: { ...to.interconnection, ...from.interconnection, derArrangement: null },
    loads: from.loads ?? null,
    calculatedServiceDemandA: from.calculatedServiceDemandA,
  };
}

const hasAuthoredEquipment = (t: ServiceTopology) =>
  t.domains.length > 0 || t.storage.length > 0 || t.aggregationPanels.length > 0;

// ── 2 · EXISTING ELECTRICAL SERVICE ─────────────────────────────────────────

/**
 * "What is the existing service rating?"
 *
 * No graph yet ⇒ the graph comes into existence here. At or below 225 A the service IS one main
 * panel, so it is built with one (main = bus = rating, editable on the panel card) and nobody is
 * asked how a 200 A service is distributed. Above it the service is created on its own and the
 * distribution question follows.
 *
 * A graph that exists keeps everything it has: only `service.ratedAmps` moves. The panel's main and
 * busbar are different facts and are never rewritten by the service rating.
 */
export function answerServiceRating(t: ServiceTopology | null, amps: number): AnswerResult {
  if (!Number.isFinite(amps) || amps <= 0) return refuse('A service rating must be a positive number of amperes.');
  if (t) {
    return done({ ...t, service: { ...t.service, ratedAmps: amps } }, `Service rating set to ${amps} A`);
  }
  if (amps <= SINGLE_PANEL_MAX_A) {
    const built = buildServiceFromPreset({ ratedAmps: amps, distribution: 'one-main-panel' });
    return done(built.topology, `${amps} A service with one ${amps} A main panel`);
  }
  return done(createServiceTopology({ ratedAmps: amps }), `${amps} A service created`);
}

/** "What is the electrical system?" — recorded as stated; the checks decide what they can evaluate. */
export function answerElectricalSystem(t: ServiceTopology, phase: string): AnswerResult {
  const v = voltageForPhase(phase);
  return done({
    ...t,
    service: {
      ...t.service,
      phase: phase as ServicePhase,
      // An unmodelled system keeps whatever voltage was recorded; it is never rewritten to 240.
      voltage: v ?? t.service.voltage,
    },
  }, `Electrical system set to ${phase}`);
}

/**
 * "How is the N A service distributed?"
 *
 * Builds the branches and main panels with `buildServiceFromPreset`. Refuses when the existing
 * distribution already carries gateways, batteries or generation panels — rebuilding it would
 * delete equipment the installer authored. That edit belongs in the Advanced service model editor
 * (Review Engineering), deliberately.
 */
export function answerDistribution(
  t: ServiceTopology, presetId: 'one-main-panel' | 'two-main-panels' | 'three-main-panels' | 'custom',
  customBranches = 0,
): AnswerResult {
  if (t.service.ratedAmps === null) return refuse('Enter the service rating first.');
  if (hasAuthoredEquipment(t)) {
    return refuse('This service already has backup systems or generation panels on it. Changing how '
      + `the service is distributed would remove them — change it in ${ADVANCED_EDITOR}, where each piece `
      + 'is edited deliberately.');
  }
  const built = buildServiceFromPreset({
    ratedAmps: t.service.ratedAmps, voltage: t.service.voltage, phase: t.service.phase,
    distribution: presetId, customBranches,
  });
  return done(carryDecisions(t, built.topology), built.created.join('; '));
}

/**
 * "Available fault current at the service" — the utility's number, in amperes. It is the one input
 * the whole SCCR chain waits on; null is "not provided", never zero and never assumed.
 */
export function answerAvailableFaultCurrent(t: ServiceTopology, amps: number | null): AnswerResult {
  if (amps !== null && (!Number.isFinite(amps) || amps <= 0)) {
    return refuse('Available fault current must be a positive number of amperes, or left blank.');
  }
  return done({ ...t, service: { ...t.service, availableFaultCurrentA: amps } },
    amps === null ? 'Available fault current cleared' : `Available fault current ${amps} A`);
}

/** What the installer reads off an existing service assembly — every field separately optional. */
export interface ExistingServiceAnswer {
  /**
   * The answer to "existing or new?": true ⇒ existing, false ⇒ new, null ⇒ not answered (takes a
   * recorded answer back). Three answers, each recorded as itself — see `ExistingOrNew`.
   */
  existing: boolean | null;
  manufacturer?: string | null;
  /** Model / catalog number, off the door label. */
  catalogNumber?: string | null;
  /** The internal main / disconnect arrangement, in the words of whoever read it. */
  mainArrangement?: string | null;
  /** How the outgoing feeders leave the assembly. */
  feederArrangement?: string | null;
  /** AIC / SCCR from its nameplate, in AMPERES. Null ⇒ not read; never inferred from the rating. */
  sccrA?: number | null;
  verified?: boolean;
}

const EXISTING_FIELD_WORDS: ReadonlyArray<[keyof ExistingServiceAnswer, string]> = [
  ['manufacturer', 'manufacturer'], ['catalogNumber', 'catalog number'], ['mainArrangement', 'main arrangement'],
  ['feederArrangement', 'feeder arrangement'], ['sccrA', 'AIC / SCCR'],
];

/**
 * "Is the service already on the wall, and has somebody read it?" — existing equipment is CONNECTED
 * TO, never priced or replaced, and whether its internals were read on site is a field fact the
 * installer states. `verified` is never derived from the fields being filled in.
 *
 * The Service card's [Verify] dialog records everything read off the assembly in ONE answer: the
 * catalog number, the main / feeder arrangement, the AIC / SCCR and whether it was read on site.
 * A blank text field is "not read" (null), never an empty string the check would count as read; an
 * AIC that is not a positive number of amperes is refused rather than stored.
 */
/**
 * 🚨 ON A ONE-PANEL SERVICE THE SERVICE ASSEMBLY *IS* MSP #1 — ONE NAMEPLATE, ONE SCCR.
 *
 * The Verify dialog's "AIC / SCCR — from its nameplate" (`service.existingEquipment.sccrA`) and the
 * panel row's "SCCR off the panel label" (`panels[0].sccrA`, which the engine's fault-current chain
 * reads) are the same figure off the same label when the service is one main panel with no separate
 * service disconnect recorded. Each writer therefore writes both, so it is asked once: answering the
 * Verify dialog satisfies the chain, and the panel row reads it back answered. Null ⇒ more than one
 * panel, or a separate service disconnect (then they are different assemblies with their own labels).
 */
export function soleServicePanel(t: ServiceTopology): PanelBoard | null {
  if (t.panels.length !== 1) return null;
  if (t.devices.some(d => d.roles.includes('service-disconnect') && !d.inlineOnNodeId)) return null;
  return t.panels[0];
}

export function answerExistingService(t: ServiceTopology, patch: ExistingServiceAnswer): AnswerResult {
  // 🚨 "NOT ANSWERED" IS AN ANSWER THE GRAPH CAN HOLD. It used to be indistinguishable from "new",
  // so taking the answer back recorded "new" — the fabricated decision this distinction exists for.
  if (patch.existing == null || patch.existing === false) {
    const answer = patch.existing === false ? 'new' : 'unanswered';
    // The old assembly's reading goes with it: the sole panel's SCCR that was copied off the OLD
    // assembly's label is not a new assembly's, nor anyone's once the answer is taken back.
    const sole = soleServicePanel(t);
    const oldSccr = existingServiceReading(t.service)?.sccrA ?? null;
    let next = setServiceExistingOrNew(t, answer);
    if (sole && oldSccr !== null && sole.sccrA === oldSccr) next = updatePanel(next, sole.id, { sccrA: null });
    return done(next, answer === 'new' ? 'Service equipment: new' : 'Service equipment: existing or new not answered');
  }
  if (patch.sccrA !== undefined && patch.sccrA !== null && (!Number.isFinite(patch.sccrA) || patch.sccrA <= 0)) {
    return refuse('The AIC / SCCR must be a positive number read off the nameplate, or left blank until it is read.');
  }
  const text = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() || null : null);
  let next = setExistingServiceEquipment(t, {
    ...(patch.manufacturer !== undefined ? { manufacturer: text(patch.manufacturer) } : {}),
    ...(patch.catalogNumber !== undefined ? { catalogNumber: text(patch.catalogNumber) } : {}),
    ...(patch.mainArrangement !== undefined ? { mainArrangement: text(patch.mainArrangement) } : {}),
    ...(patch.feederArrangement !== undefined ? { feederArrangement: text(patch.feederArrangement) } : {}),
    ...(patch.sccrA !== undefined ? { sccrA: patch.sccrA } : {}),
    ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
  });
  const sole = soleServicePanel(next);
  if (sole && patch.sccrA !== undefined) next = updatePanel(next, sole.id, { sccrA: patch.sccrA });
  const ex = next.service.existingEquipment;
  const recorded = EXISTING_FIELD_WORDS
    .filter(([k]) => patch[k] !== undefined && ex?.[k as keyof typeof ex] != null)
    .map(([, w]) => w);
  return done(next, `Existing service equipment${recorded.length ? ` — ${recorded.join(', ')} recorded` : ''}`
    + `${patch.verified ? ' — read on site' : ''}`);
}

/**
 * A panel card: main breaker, busbar, manufacturer — and its interrupting rating (SCCR), read off the
 * panel's label. Never the service rating.
 *
 * 🚨 THE SCCR IS THE PANEL'S OWN NAMEPLATE FIGURE. Once the utility's fault current is known the
 * engine's chain check names every panel with no rating; this is the one place an installer states
 * it (it used to be the Service Topology inspector's panel box). Blank is "not read" (null), never zero.
 */
export function answerPanel(
  t: ServiceTopology, panelId: string,
  patch: { mainBreakerA?: number | null; busbarRatingA?: number | null; manufacturer?: string | null; sccrA?: number | null },
): AnswerResult {
  const p = t.panels.find(x => x.id === panelId);
  if (!p) return refuse(`No panel '${panelId}'.`);
  if (patch.sccrA !== undefined && patch.sccrA !== null && (!Number.isFinite(patch.sccrA) || patch.sccrA <= 0)) {
    return refuse(`${p.label}: the interrupting rating (SCCR) is a positive number read off the panel label, or left blank until it is read.`);
  }
  const clean: Record<string, unknown> = {};
  if (patch.mainBreakerA !== undefined) clean.mainBreakerA = patch.mainBreakerA;
  if (patch.busbarRatingA !== undefined) clean.busbarRatingA = patch.busbarRatingA;
  if (patch.manufacturer !== undefined) clean.manufacturer = patch.manufacturer?.trim() || null;
  if (patch.sccrA !== undefined) clean.sccrA = patch.sccrA;
  let next = updatePanel(t, panelId, clean as never);
  // The same nameplate as the existing service assembly's on a one-panel service (`soleServicePanel`).
  if (patch.sccrA !== undefined && soleServicePanel(t)?.id === panelId && t.service.existingEquipment) {
    next = setExistingServiceEquipment(next, { sccrA: patch.sccrA });
  }
  return done(next, `${p.label} updated`);
}

// ── 4 · SYSTEM BEHAVIOR / CONNECTION ────────────────────────────────────────

/**
 * "What is backed up?"
 *
 * 'whole' ⇒ every panel is inside the island, one system (gateway + its batteries) per panel, on the
 * branch that feeds it. The batteries per system are the installer's: `unitsPerPanel` names them.
 * A single panel takes every unit (there is nowhere else for them to go); with more than one panel a
 * missing count is ZERO for that system rather than an even split nobody chose.
 *
 * 'none' ⇒ no panel is backed up and the systems are removed (the storage stays a selection, but it
 * is no longer drawn behind a gateway).
 */
export function answerBackup(
  t: ServiceTopology,
  choice: 'whole' | 'none',
  equipment: {
    gatewayProductId: string | null;
    storageProductId: string | null;
    totalUnits: number;
    unitsPerPanel?: Record<string, number>;
  },
): AnswerResult {
  if (choice === 'none') {
    let next = t;
    for (const d of [...next.domains]) next = removeBackupDomain(next, d.id);
    for (const p of next.panels) next = updatePanel(next, p.id, { backedUp: false });
    return done(next, 'No backup');
  }
  if (!equipment.gatewayProductId) {
    return refuse('Choose the backup controller / gateway in Equipment first — each backed-up system '
      + 'needs one.');
  }
  if (t.panels.length === 0) return refuse('This service has no main panel yet. Answer the distribution first.');
  let next = t;
  for (const p of t.panels) {
    next = updatePanel(next, p.id, { backedUp: true });
    if (next.domains.some(d => d.backedUpPanelIds.includes(p.id))) continue;
    const branch = next.branches.find(b => (b.panelIds ?? []).includes(p.id))
      ?? next.branches.find(b => !next.domains.some(d => d.branchId === b.id));
    if (!branch) continue;
    const units = t.panels.length === 1
      ? equipment.totalUnits
      : Math.max(0, Math.floor(equipment.unitsPerPanel?.[p.id] ?? 0));
    const r = addBackupDomain(next, {
      branchId: branch.id,
      panelIds: [p.id],
      gatewayProductId: equipment.gatewayProductId,
      storageProductIds: equipment.storageProductId
        ? Array.from({ length: units }, () => equipment.storageProductId as string) : [],
    });
    next = r.topology;
  }
  return done(next, `Whole ${t.panels.length > 1 ? 'home' : 'main panel'} backed up`);
}

/** "How many batteries in this system?" — the per-system count, edited after backup is answered. */
export function answerSystemBatteries(
  t: ServiceTopology, domainId: string, storageProductId: string, units: number,
): AnswerResult {
  const d = t.domains.find(x => x.id === domainId);
  if (!d) return refuse(`No system '${domainId}'.`);
  const n = Math.max(0, Math.floor(units));
  const r = setDomainEquipment(t, domainId, {
    storageProductIds: Array.from({ length: n }, () => storageProductId),
  });
  return done(r.topology, `${d.label}: ${n} batter${n === 1 ? 'y' : 'ies'}`);
}

/**
 * "How are the battery AC circuits combined?" / "Where do they land?"
 *
 * The three answers ARE `BackupDomain.storageConnection`, and the generation panel is BUILT (one per
 * system, sized from that system's own batteries) or removed exactly as the wizard did.
 */
/**
 * 🚨 A SITE-WIDE GENERATION PANEL IS NOT ONE SYSTEM'S PANEL. The common-aggregation arrangement
 * builds ONE panel (no `domainId`) taking the systems' battery circuits, with ONE connection. A system
 * whose batteries (or whose bus) land there is combined with the others: where its batteries land is
 * not its own question, and re-equipping it changes that panel's circuits — never builds it a second.
 *
 * Only a system the site-wide panel ACTUALLY takes is combined — a common-aggregation job that
 * aggregates only some systems leaves the others theirs to answer. A system with no batteries yet,
 * recorded as landing in a generation panel on a job combined in the one site-wide panel, lands there.
 */
export function landsOnSharedPanel(t: ServiceTopology, d: BackupDomain): boolean {
  const siteWide = (t.aggregationPanels ?? []).filter(a => !a.domainId);
  if (siteWide.length === 0) return false;
  const owned = new Set([d.id, ...d.storageUnitIds]);
  if (siteWide.some(a => a.inputs.some(i => owned.has(i.sourceId)))) return true;
  const hasBatteries = d.storageUnitIds.some(id => t.storage.find(u => u.id === id)?.role === 'inverter-unit');
  return !hasBatteries && d.storageConnection === 'der-aggregation-panel'
    && t.interconnection.derArrangement === 'common-aggregation' && siteWide.length === 1;
}

export function answerStorageLanding(
  t: ServiceTopology,
  value: Exclude<BackupDomain['storageConnection'], 'unresolved'>,
  domainIds?: string[],
): AnswerResult {
  const ids = domainIds ?? t.domains.map(d => d.id);
  if (ids.length === 0) return refuse('There is no backed-up system to answer this for.');
  // The all-systems answer obeys the same rule as the per-system one: a system combined in the
  // site-wide panel cannot be landed elsewhere (its circuits would stay on the shared panel) nor
  // given a second panel beside it.
  const combined = ids.map(id => t.domains.find(d => d.id === id))
    .filter((d): d is BackupDomain => !!d && landsOnSharedPanel(t, d));
  if (combined.length > 0) {
    const shared = (t.aggregationPanels ?? []).find(a => !a.domainId);
    return refuse(`${combined.map(d => d.label).join(' and ')} ${combined.length === 1 ? 'is' : 'are'} combined `
      + `with the other systems in ${shared ? shared.label : 'one generation panel'}, so where the batteries `
      + `land is decided by how the systems connect to the service. Change that, or edit it in ${ADVANCED_EDITOR}.`);
  }
  let next = value === 'der-aggregation-panel'
    ? applyPerSystemGenerationPanels(t, ids).topology
    : clearPerSystemGenerationPanels(t, ids);
  for (const id of ids) next = updateDomain(next, id, { storageConnection: value });
  return done(next, `Battery circuits: ${value}`);
}

const SOLAR_COUPLINGS: readonly SolarCoupling[] = ['dc-coupled-storage', 'ac-coupled-inverter', 'storage-only'];

/**
 * "How does the new solar connect?" — the project's one PV coupling, recorded on the graph.
 *
 * 🚨 THIS WAS ONLY EVER ASKED IN THE SERVICE TOPOLOGY TAB once a designer had recorded it. The
 * architecture route records the FIRST decision (and retires a separate PV inverter on a DC answer),
 * then refuses every later one ("Change the coupling through the service topology"); and a job with
 * no storage is never asked at all, while the engine's `pv.coupling` check waits on it. With the tab
 * gone, this is that write: the graph's own writer (`setSolarCoupling`) through the page's one write
 * path, whose PUT records the designer as the one who decided it.
 */
export function answerSolarCoupling(t: ServiceTopology, coupling: SolarCoupling): AnswerResult {
  if (!SOLAR_COUPLINGS.includes(coupling)) return refuse(`'${coupling}' is not a PV coupling.`);
  return done(setSolarCoupling(t, coupling), `PV coupling: ${coupling}`);
}

/**
 * Which writer records a PV-connection answer.
 *
 *  · 'graph' — the graph's own coupling through the page's one write path (its PUT records the
 *    designer's decision in `provenance.architecture`): "storage only" (the route does not accept
 *    it), and EVERY answer when no separate PV inverter is on file — there is nothing to retire or
 *    confirm, and the route is the only writer of `provenance.inverter`, which it must never write for
 *    an inverter that does not exist (a later auto-pick would read as the installer's decision).
 *  · 'architecture-route' — a separate PV inverter IS on file: the route records the coupling AND
 *    retires that inverter (DC) or confirms it (AC), clearing the page's fleet with it. `change` when
 *    a designer's decision is already recorded: the route refuses to overwrite one unless the request
 *    says it is a deliberate change. Changing DC on the graph alone left the inverter on file, the
 *    architecture unresolved and the SLD refused — with every resolve button refused too.
 *  · null — no graph: nothing can record it.
 */
export function pvCouplingWritePath(opts: {
  coupling: SolarCoupling; decisionOnFile: boolean; hasGraph: boolean; hasExternalInverter: boolean;
}): { writer: 'graph' } | { writer: 'architecture-route'; change: boolean } | null {
  if (!opts.hasGraph) return null;
  if (opts.coupling === 'storage-only' || !opts.hasExternalInverter) return { writer: 'graph' };
  return { writer: 'architecture-route', change: opts.decisionOnFile };
}

/** "How do the systems connect to the service?" — only asked with more than one system. */
export function answerSystemsArrangement(t: ServiceTopology, value: DerArrangement): AnswerResult {
  if (t.domains.length < 2) return refuse('There is only one system, so there is nothing to combine.');
  return done(applyDerArrangement(t, value).topology, `Systems: ${value}`);
}

/**
 * "Where does the system connect to the service?"
 *
 * The physical connection, recorded on the point(s) of interconnection the graph already has, or on
 * new ones where it has none (one per system, or one for the service when there is no system). The
 * code article is DERIVED from it (`governingArticleFor`) — never chosen here.
 */
export function answerInterconnection(
  t: ServiceTopology, value: PoiRelationship | 'meter-collar',
): AnswerResult {
  if (value === 'meter-collar' && t.interconnection.meterCollarPermitted === false) {
    return refuse('A meter collar is not permitted on this project.');
  }
  const relationship: PoiRelationship = value === 'meter-collar' ? 'meter-collar' : value;
  let next = setInterconnection(t, { meterCollarSelected: value === 'meter-collar' });

  // 🚨 A METER COLLAR AND A SUPPLY-SIDE TAP LAND AT THE SERVICE ENTRANCE — that is what the two
  // relationships ARE (the meter socket; the service conductors ahead of the service disconnect), so
  // the landing is determined by the answer, not a second question. It used to be left null, and the
  // engine's "where on the premises wiring it lands" need then had no System Config editor at all —
  // only the Service Topology tab's "Lands on" select could answer it. The entrance is the one
  // service disconnect where one is recorded, else the one main panel, else the service distribution
  // ahead of every main (the node the drawing and the connection graph already have for it).
  const serviceEntrance = (): string => {
    const disconnects = next.devices.filter(x => x.roles.includes('service-disconnect') && !x.inlineOnNodeId);
    if (disconnects.length === 1) return disconnects[0].id;
    if (next.panels.length === 1) return next.panels[0].id;
    return 'service-distribution';
  };
  const where = (d: BackupDomain | null): string | null => {
    if (relationship === 'load-side-busbar') return d?.backedUpPanelIds[0] ?? next.panels[0]?.id ?? null;
    if (relationship === 'manufacturer-integrated') return d?.gateway.id ?? null;
    if (relationship === 'load-side-feeder-tap') return d?.branchId ?? next.branches[0]?.id ?? null;
    if (relationship === 'supply-side' || relationship === 'meter-collar') return serviceEntrance();
    return null;
  };

  if (next.pointsOfInterconnection.length === 0) {
    const scopes: Array<BackupDomain | null> = next.domains.length > 0 ? next.domains : [null];
    for (const d of scopes) {
      next = addPointOfInterconnection(next, {
        label: d ? `${d.label} point of interconnection` : 'Point of interconnection',
        relationship,
        derNodeId: d?.storageUnitIds[0] ?? null,
        connectedToNodeId: where(d),
      }).topology;
    }
  } else {
    for (const poi of next.pointsOfInterconnection) {
      const d = next.domains.find(x => x.storageUnitIds.includes(poi.derNodeId ?? '')
        || x.gateway.id === poi.connectedToNodeId) ?? null;
      next = updatePointOfInterconnection(next, poi.id, {
        relationship,
        connectedToNodeId: where(d) ?? poi.connectedToNodeId,
      });
    }
  }
  return done(next, `Interconnection: ${relationship}`);
}

/**
 * "Does the utility require an external, lockable disconnect?" — three states, never a checkbox.
 *
 * Required on a single-path service ⇒ the one switch is placed in line on that path (there is only
 * one place it can go). On a multi-path service the arrangement is a separate question.
 */
export function answerIsolationRequired(t: ServiceTopology, required: boolean | null): AnswerResult {
  let next = setInterconnection(t, { externalDerIsolationRequired: required });
  const hasIsolator = next.devices.some(d => d.roles.includes('der-isolation-disconnect'));
  if (required === true && !hasIsolator && next.branches.length <= 1) {
    next = applyIsolationArrangement(next, 'one-per-path').topology;
  }
  return done(next, `External disconnect required: ${required === null ? 'not established' : required ? 'yes' : 'no'}`);
}

export function answerIsolationArrangement(
  t: ServiceTopology, id: 'one-per-path' | 'common-service',
): AnswerResult {
  return done(applyIsolationArrangement(t, id).topology, `Isolation: ${id}`);
}

/** The utility / AHJ ruling on the arrangement — recorded only when the installer has it. */
export function answerIsolationAccepted(t: ServiceTopology, accepted: boolean | null): AnswerResult {
  return done(setInterconnection(t, { isolationArrangementAccepted: accepted }),
    `Utility / AHJ acceptance: ${accepted === null ? 'needs verification' : accepted ? 'accepted' : 'not accepted'}`);
}

/**
 * "Which battery receives each PV string?" — recorded as the PV STC each unit's own inputs carry.
 *
 * Every inverting unit gets an explicit value: 0 means "no PV lands on this unit", which is a
 * decision, not an absence. The total must equal the array — a landing that loses or invents a
 * module is refused.
 */
export function answerPvLanding(
  t: ServiceTopology,
  stringsPerUnit: Record<string, number[]>,
  moduleWatts: number,
  designModuleCount: number,
): AnswerResult {
  const units = t.storage.filter(u => u.role === 'inverter-unit');
  if (units.length === 0) return refuse('There is no battery with PV inputs to land the strings on.');
  const landed = Object.values(stringsPerUnit).flat().reduce((a, b) => a + b, 0);
  if (landed !== designModuleCount) {
    return refuse(`The strings assigned cover ${landed} modules; Design placed ${designModuleCount}. Every `
      + 'string must land on exactly one unit.');
  }
  let next = t;
  for (const u of units) {
    const modules = (stringsPerUnit[u.id] ?? []).reduce((a, b) => a + b, 0);
    next = setStoragePvInput(next, u.id, Math.round(modules * moduleWatts) / 1000);
  }
  return done(next, 'PV strings landed on the batteries');
}
