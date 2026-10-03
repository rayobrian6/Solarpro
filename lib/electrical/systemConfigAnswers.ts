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
  setStoragePvInput,
} from '@/lib/electrical/topologyAuthoring';
import {
  buildServiceFromPreset, applyDerArrangement, applyIsolationArrangement,
  applyPerSystemGenerationPanels, clearPerSystemGenerationPanels,
} from '@/lib/electrical/topologyPresets';
import type {
  ServiceTopology, ServicePhase, PoiRelationship, DerArrangement, BackupDomain,
} from '@/lib/electrical/serviceTopology';
import { isServicePhase, servicePhaseInfo } from '@/lib/electrical/serviceTopology';

export type AnswerResult =
  | { ok: true; topology: ServiceTopology; did: string }
  | { ok: false; refused: string };

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });

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
 * delete equipment the installer authored. That edit belongs in Advanced, deliberately.
 */
export function answerDistribution(
  t: ServiceTopology, presetId: 'one-main-panel' | 'two-main-panels' | 'three-main-panels' | 'custom',
  customBranches = 0,
): AnswerResult {
  if (t.service.ratedAmps === null) return refuse('Enter the service rating first.');
  if (hasAuthoredEquipment(t)) {
    return refuse('This service already has backup systems or generation panels on it. Changing how '
      + 'the service is distributed would remove them — change it in Advanced, where each piece is edited '
      + 'deliberately.');
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

/** A panel card: main breaker, busbar, manufacturer. Never the service rating. */
export function answerPanel(
  t: ServiceTopology, panelId: string,
  patch: { mainBreakerA?: number | null; busbarRatingA?: number | null; manufacturer?: string | null },
): AnswerResult {
  const p = t.panels.find(x => x.id === panelId);
  if (!p) return refuse(`No panel '${panelId}'.`);
  const clean: Record<string, unknown> = {};
  if (patch.mainBreakerA !== undefined) clean.mainBreakerA = patch.mainBreakerA;
  if (patch.busbarRatingA !== undefined) clean.busbarRatingA = patch.busbarRatingA;
  if (patch.manufacturer !== undefined) clean.manufacturer = patch.manufacturer?.trim() || null;
  return done(updatePanel(t, panelId, clean as never), `${p.label} updated`);
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
export function answerStorageLanding(
  t: ServiceTopology,
  value: Exclude<BackupDomain['storageConnection'], 'unresolved'>,
  domainIds?: string[],
): AnswerResult {
  const ids = domainIds ?? t.domains.map(d => d.id);
  if (ids.length === 0) return refuse('There is no backed-up system to answer this for.');
  let next = value === 'der-aggregation-panel'
    ? applyPerSystemGenerationPanels(t, ids).topology
    : clearPerSystemGenerationPanels(t, ids);
  for (const id of ids) next = updateDomain(next, id, { storageConnection: value });
  return done(next, `Battery circuits: ${value}`);
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

  const where = (d: BackupDomain | null): string | null => {
    if (relationship === 'load-side-busbar') return d?.backedUpPanelIds[0] ?? next.panels[0]?.id ?? null;
    if (relationship === 'manufacturer-integrated') return d?.gateway.id ?? null;
    if (relationship === 'load-side-feeder-tap') return d?.branchId ?? next.branches[0]?.id ?? null;
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
