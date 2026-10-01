// ═══════════════════════════════════════════════════════════════════════════
// "400 AMP SERVICE, TWO 200 AMP PANELS" — SAID ONCE, BUILT CORRECTLY.
//
// Ray: "SolarPro should ask an electrician questions in the language an electrician thinks in.
// Ray should think: 400 amp service, two 200 amp panels, back up both, one Gateway/Powerwall stack
// per panel. SolarPro translates that into the graph. Ray should not have to think: create branch
// object → create panel object → create domain object → resolve semantic role."
//
// 🚨 A CONVENIENCE PRESET, NOT A NEW ELECTRICAL AUTHORITY — Ray's words. Every function here is a
// composition of `lib/electrical/topologyAuthoring.ts`; this file creates no graph object itself,
// looks up no catalogue row and states no ampere rating of its own. Delete it and the topology is
// still buildable by hand, which is the test of whether it is a shortcut or a second model.
// ═══════════════════════════════════════════════════════════════════════════

import {
  createServiceTopology, addServiceBranch, addPanel, updateBranch,
  addAggregationPanel, updateAggregationPanel, addPointOfInterconnection, setDerArrangement,
  placeDevice, recommendAggregationRatings, updatePointOfInterconnection,
  addProtectiveDevice, removeProtectiveDevice, removeAggregationPanel,
  type AggregationRecommendation,
} from '@/lib/electrical/topologyAuthoring';
import { derSources } from '@/lib/electrical/derSources';
import type {
  ServiceTopology, ServicePhase, DerArrangement, PoiRelationship, SolarCoupling,
} from '@/lib/electrical/serviceTopology';

/** The sizes the picker offers. `null` is "Custom" — the operator types the rating. */
export const SERVICE_SIZE_CHOICES: ReadonlyArray<number> = [100, 125, 150, 200, 320, 400, 600, 800];

/**
 * The rating each equal branch gets.
 *
 * 🚨 ONE FUNCTION, USED BY BOTH THE SENTENCE AND THE GRAPH. Written twice, they diverge on every
 * service size that does not divide evenly — 125 A over two panels described as "62.5 A" and built
 * as 62 A, 500 A over three described as 167 A and built as 166 A. A preset whose description and
 * whose result disagree is worse than no preset, because the operator stops reading it.
 */
export const presetBranchAmps = (serviceAmps: number, branches: number): number =>
  Math.floor(serviceAmps / Math.max(1, branches));

export interface DistributionPreset {
  id: string;
  /** What an electrician calls it. */
  label: string;
  /** What it will build, so the choice is not a surprise. */
  describe: (serviceAmps: number) => string;
  /** How many equal service branches, each with its own panel. `null` ⇒ operator-chosen. */
  branches: number | null;
}

/**
 * How the service is distributed.
 *
 * Each preset says how many EQUAL branches to create. The branch rating is the service rating
 * divided by that count — which is the arrangement the preset names, and nothing more. A service
 * whose branches are not equal is built with "Custom" (or by adding branches one at a time in
 * Advanced), because guessing an unequal split would be engineering by menu.
 */
export const DISTRIBUTION_PRESETS: ReadonlyArray<DistributionPreset> = [
  {
    id: 'one-main-panel',
    label: 'One main panel',
    describe: a => `One ${presetBranchAmps(a, 1)} A service branch feeding one `
      + `${presetBranchAmps(a, 1)} A main panel.`,
    branches: 1,
  },
  {
    id: 'two-main-panels',
    label: 'Two main panels',
    describe: a => `Two ${presetBranchAmps(a, 2)} A service branches, each feeding its own `
      + `${presetBranchAmps(a, 2)} A main panel.`,
    branches: 2,
  },
  {
    id: 'three-main-panels',
    label: 'Three main panels',
    describe: a => `Three ${presetBranchAmps(a, 3)} A service branches, each feeding its own panel.`,
    branches: 3,
  },
  {
    id: 'custom',
    label: 'Custom',
    describe: () => 'Start with the service only and add each branch and panel yourself.',
    branches: null,
  },
];

export interface ServicePresetOptions {
  ratedAmps: number;
  voltage?: number;
  phase?: ServicePhase;
  /** A preset id from `DISTRIBUTION_PRESETS`. `'custom'` creates the service and nothing else. */
  distribution: string;
  /** Used only when the preset is `'custom'`: how many equal branches to create (0 ⇒ none). */
  customBranches?: number;
  /** Per-branch rating override. Absent ⇒ the service rating divided equally. */
  branchAmps?: number | null;
}

export interface ServicePresetResult {
  topology: ServiceTopology;
  /** Human sentences describing exactly what was created, for the wizard's confirmation. */
  created: string[];
}

/**
 * Build a service and its distribution in one step.
 *
 * 🚨 THE DIVISION IS EXACT OR IT IS NOT DONE. `400 / 2 = 200` is a real arrangement. `400 / 3` is
 * not a standard panel rating, so a non-integer split is rounded DOWN to the nearest whole ampere
 * and the remainder is simply left unallocated — the overview then shows "N A unassigned" and asks
 * the operator, rather than silently inventing a rating that no breaker is made in.
 */
export function buildServiceFromPreset(opts: ServicePresetOptions): ServicePresetResult {
  const created: string[] = [];
  let t = createServiceTopology({
    ratedAmps: opts.ratedAmps, voltage: opts.voltage, phase: opts.phase,
  });
  created.push(`${opts.ratedAmps} A service`);

  const preset = DISTRIBUTION_PRESETS.find(p => p.id === opts.distribution);
  const count = preset?.branches ?? Math.max(0, Math.floor(opts.customBranches ?? 0));
  if (count <= 0) return { topology: t, created };

  const per = opts.branchAmps ?? presetBranchAmps(opts.ratedAmps, count);
  for (let i = 0; i < count; i++) {
    const branch = addServiceBranch(t, { ratedAmps: per });
    t = branch.topology;
    const panel = addPanel(t, { busbarRatingA: per, mainBreakerA: per });
    // The feed is RECORDED, not left to be inferred later from ordinal position.
    t = updateBranch(panel.topology, branch.branch.id, { panelIds: [panel.panel.id] });
    created.push(`${branch.branch.label} — ${per} A → ${panel.panel.label} (${per} A bus, ${per} A main)`);
  }
  return { topology: t, created };
}

/**
 * Add one more equal branch-and-panel pair to an existing service.
 *
 * This is the "+ Add second 200 A branch" action the overview offers when a 400 A service has only
 * 200 A allocated. It takes the rating explicitly: the caller has already computed and SHOWN the
 * number, so the action cannot do something other than what the button says.
 */
export function addBranchWithPanel(
  t: ServiceTopology, ratedAmps: number,
): { topology: ServiceTopology; created: string[] } {
  const branch = addServiceBranch(t, { ratedAmps });
  const panel = addPanel(branch.topology, { busbarRatingA: ratedAmps, mainBreakerA: ratedAmps });
  return {
    topology: updateBranch(panel.topology, branch.branch.id, { panelIds: [panel.panel.id] }),
    created: [`${branch.branch.label} — ${ratedAmps} A → ${panel.panel.label}`],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// "HOW DO THESE DER SYSTEMS INTERCONNECT?" — THE ANSWER, TURNED INTO A GRAPH.
//
// Ray: "After Ray builds 400 A → 2 × 200 A MSP → 2 backup domains, the next step should not be a
// pile of unresolved text. Ask: HOW DO THESE DER SYSTEMS INTERCONNECT? Show only topology choices
// SolarPro can represent... Do not claim either standard option is permitted until
// manufacturer/jurisdiction rules validate it."
//
// 🚨 SO THIS BUILDS THE SHAPE AND CLAIMS NOTHING ABOUT ITS LEGALITY. It creates the nodes; the
// governed relationship at the point of interconnection is left 'unresolved' for the designer, and
// the manufacturer and jurisdiction authorities that decide whether the shape is allowed stay
// exactly as unresolved as they were.
// ═══════════════════════════════════════════════════════════════════════════

export interface DerArrangementChoice {
  id: DerArrangement;
  label: string;
  describe: string;
  /** What it will build, so the choice is not a surprise. */
  builds: string;
}

/**
 * 🚨 THE QUESTION IN THE WORDS OF THE PERSON ANSWERING IT.
 *
 * Ray, after live-testing: "Installer-facing language should be: 400 A service / Two 200 A systems /
 * MSP #1 / MSP #2 / Gateway #1 / Gateway #2 / Powerwall + Expansion / Safety switch. Avoid leading
 * with terms like DER, graph node, aggregation topology, domain semantics. Those may remain in
 * Advanced/engineering internals."
 *
 * So the choice reads "Two independent 200 A systems" — composed from the branches actually in the
 * graph, not from a hard-coded 200 — while the node it builds is still the generic
 * `DER_AGGREGATION_PANEL` the engineering, the schedule and the sheet already speak about. One
 * vocabulary for the installer, one for the drawing, one model underneath.
 */
export const DER_ARRANGEMENT_CHOICES: ReadonlyArray<DerArrangementChoice> = [
  {
    id: 'independent-branch',
    label: 'Independent systems',
    describe: 'Each path keeps its own gateway, its own panel and its own connection to the '
      + 'service. Nothing is combined downstream.',
    builds: 'One point of connection per system, at that system\'s own equipment.',
  },
  {
    id: 'common-aggregation',
    label: 'One combined generation panel',
    describe: 'Both systems\' outputs land in one shared generation panel, which then makes a '
      + 'single connection to the service.',
    builds: 'A generation panel taking every source, one shared point of connection, and the '
      + 'utility isolation switch on the combined feeder.',
  },
  {
    id: 'custom',
    label: 'Custom engineered topology',
    describe: 'Something neither option describes — build it piece by piece in Advanced.',
    builds: 'Nothing. The arrangement is recorded and the equipment is yours to add.',
  },
];

/**
 * The same choice, described with the sizes actually in this graph.
 *
 * "Two independent 200 A systems" is the sentence Ray wants to read; it is composed here so it can
 * never disagree with the branches, and so a 600 A / 3 × 200 A service reads correctly too.
 */
export function describeArrangementFor(
  t: ServiceTopology, id: DerArrangement,
): string {
  const COUNT = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const n = t.branches.length;
  const sizes = [...new Set(t.branches.map(b => b.ratedAmps))];
  const word = COUNT[n] ?? String(n);
  const sized = sizes.length === 1 ? `${word} ${sizes[0]} A` : `${word}`;
  if (id === 'independent-branch') {
    return n === 0
      ? 'Independent systems — one connection each.'
      : `${sized} system${n === 1 ? '' : 's'}, independent — each with its own gateway, panel and `
        + 'point of connection.';
  }
  if (id === 'common-aggregation') {
    return n === 0
      ? 'One combined generation panel ahead of a single point of connection.'
      : `${sized} system${n === 1 ? '' : 's'} combined in one generation panel, then a single `
        + `connection to the ${t.service.ratedAmps} A service.`;
  }
  return 'Built piece by piece in Advanced.';
}

/**
 * How the utility's DER isolation is arranged — one switch for the whole service, or one per path.
 *
 * 🚨 NEITHER IS SELECTED FOR THE OPERATOR AND NEITHER IS CLAIMED TO BE ACCEPTABLE. Ray's intended
 * design on the real job is two independent knife switches, one per 200 A path, and his own note is
 * that "Utility/AHJ acceptance of the two-switch arrangement remains something to verify." So this
 * builds what the designer chooses and the jurisdiction ruling stays exactly as unresolved as it was.
 */
export interface IsolationArrangementChoice {
  id: 'one-per-path' | 'common-service';
  label: string;
  describe: string;
  builds: string;
}

export const ISOLATION_ARRANGEMENTS: ReadonlyArray<IsolationArrangementChoice> = [
  {
    id: 'one-per-path',
    label: 'One safety switch per system',
    describe: 'A separate lockable, visible-open switch in each path, ahead of that path\'s '
      + 'gateway. Each system is isolated on its own.',
    builds: 'One isolation switch per path, in line with the feeder, rated for that path.',
  },
  {
    id: 'common-service',
    label: 'One safety switch for the whole service',
    describe: 'A single switch on the service conductors, isolating everything on site at once.',
    builds: 'One isolation switch on the service chain, rated for the service.',
  },
];

export interface ApplyIsolationResult {
  topology: ServiceTopology;
  created: string[];
  /** What acceptance still has to be established, said out loud rather than assumed. */
  unresolved: string[];
}

/**
 * Build the chosen isolation arrangement, replacing whatever isolation devices exist.
 *
 * 🚨 IN LINE, NOT BESIDE. Each per-path switch names the node it interrupts, so the connection
 * graph re-routes that path's conductor through it and DER ISOLATION COVERAGE can actually answer
 * the question. A switch that merely pointed at the branch would leave the original conductor in
 * place and coverage would report — correctly — that opening it disconnects nothing.
 */
export function applyIsolationArrangement(
  t: ServiceTopology, id: IsolationArrangementChoice['id'],
): ApplyIsolationResult {
  const created: string[] = [];
  let next = t;
  // Replace the existing isolation devices: two arrangements both present would be two answers.
  for (const d of t.devices.filter(x => x.roles.includes('der-isolation-disconnect'))) {
    next = removeProtectiveDevice(next, d.id);
  }

  if (id === 'common-service') {
    const r = addProtectiveDevice(next, {
      label: `${next.service.ratedAmps} A utility isolation switch`,
      roles: ['der-isolation-disconnect'],
      ratedAmps: next.service.ratedAmps,
      lockableOpen: true, visibleOpen: true,
      locationNote: 'On the service conductors, accessible to the utility.',
    });
    next = r.topology;
    created.push(`${r.device.label} on the service conductors`);
    return {
      topology: next, created,
      unresolved: ['Utility / AHJ acceptance of a single common isolation switch is not established.'],
    };
  }

  // One per path. The path is the branch; the node it interrupts is that branch's gateway where the
  // branch has one, and the branch's panel where it does not.
  for (const b of next.branches) {
    const domain = next.domains.find(d => d.branchId === b.id);
    const inlineOn = domain?.gateway.id
      ?? (b.panelIds ?? [])[0]
      ?? null;
    const r = addProtectiveDevice(next, {
      label: `Utility isolation switch — ${b.label}`,
      roles: ['der-isolation-disconnect'],
      ratedAmps: b.ratedAmps,
      lockableOpen: true, visibleOpen: true,
      locationNote: `In line in ${b.label}, ahead of `
        + `${domain ? domain.gateway.label : 'the panelboard it feeds'}.`,
      ...(inlineOn ? { inlineOnNodeId: inlineOn, feedsNodeId: b.id } : {}),
    });
    next = r.topology;
    created.push(inlineOn
      ? `${r.device.label}, in line ahead of `
        + `${domain ? domain.gateway.label : 'its panelboard'}`
      // No node to interrupt: the device exists and says so rather than claiming a placement.
      : `${r.device.label} — nothing established for it to be in line with yet`);
  }

  return {
    topology: next, created,
    unresolved: [
      `Utility / AHJ acceptance of ${next.branches.length} independent isolation switches (one per `
      + 'path) rather than a single common device is not established.',
    ],
  };
}

export interface ApplyArrangementResult {
  topology: ServiceTopology;
  /** Human sentences describing exactly what was created. */
  created: string[];
  /** What SolarPro computed, so the operator sees the arithmetic rather than a number. */
  recommendation: AggregationRecommendation | null;
}

/**
 * Apply an interconnection arrangement to a topology that already has its domains.
 *
 * 🚨 THE AGGREGATION PANEL IS SIZED FROM ITS SOURCES. `recommendAggregationRatings` reads the DER
 * that actually feeds it — on a 400 A service with two 48 A inverting units that is 96 A, 125% of
 * it, and the next standard OCPD. The service rating is not an input to it anywhere.
 */
export function applyDerArrangement(
  t: ServiceTopology, arrangement: DerArrangement,
): ApplyArrangementResult {
  const created: string[] = [];
  let next = setDerArrangement(t, arrangement);

  if (arrangement === 'custom') {
    created.push('Recorded a custom engineered arrangement.');
    return { topology: next, created, recommendation: null };
  }

  if (arrangement === 'independent-branch') {
    for (const d of next.domains) {
      // The relationship IS the domain's storage connection, where that has been established.
      const relationship: PoiRelationship =
        d.storageConnection === 'backed-up-panel-busbar' ? 'load-side-busbar'
          : d.storageConnection === 'gateway-panelboard' ? 'manufacturer-integrated'
            : 'unresolved';
      const connectedTo = d.storageConnection === 'backed-up-panel-busbar'
        ? (d.backedUpPanelIds[0] ?? null)
        : d.storageConnection === 'gateway-panelboard' ? d.gateway.id : null;
      const r = addPointOfInterconnection(next, {
        label: `${d.label} point of interconnection`,
        relationship,
        derNodeId: d.storageUnitIds[0] ?? null,
        connectedToNodeId: connectedTo,
      });
      next = r.topology;
      created.push(`${r.poi.label}${relationship === 'unresolved'
        ? ' — arrangement still to be decided' : ` — ${relationship.replace(/-/g, ' ')}`}`);
    }
    return { topology: next, created, recommendation: null };
  }

  // ── COMMON AGGREGATION ────────────────────────────────────────────────────
  const sources = derSources(next);
  const added = addAggregationPanel(next, {
    label: 'DER aggregation panel',
    // A generation panel serving no premises load. Stated, because which kind of panel it is
    // decides which calculation governs its busbar.
    carriesPremisesLoad: false,
    mainLugOnly: true,
    inputs: sources.map(s => ({ sourceId: s.id, tap: 'der-output' as const, ocpdA: s.ocpdA })),
  });
  next = added.topology;
  created.push(`${added.panel.label} taking ${sources.length} DER source(s)`);

  // Storage that leaves its domain for the aggregation panel is no longer on its panel's busbar.
  next = {
    ...next,
    domains: next.domains.map(d => ({ ...d, storageConnection: 'der-aggregation-panel' as const })),
  };

  const recommendation = recommendAggregationRatings(next, added.panel.id);
  if (recommendation.outputOcpdA !== null) {
    next = updateAggregationPanel(next, added.panel.id, {
      busbarRatingA: recommendation.busbarRatingA,
      outputOcpdA: recommendation.outputOcpdA,
      outputConductorGauge: recommendation.outputConductorGauge,
    });
    created.push(`${recommendation.aggregateContinuousA} A aggregated → `
      + `${recommendation.outputOcpdA} A output OCPD, ${recommendation.outputConductorGauge} feeder, `
      + `${recommendation.busbarRatingA} A busbar`);
  }

  // One shared point of interconnection. Its governed relationship is the designer's to choose.
  const poiAdded = addPointOfInterconnection(next, {
    label: 'Point of interconnection',
    relationship: 'unresolved',
    derNodeId: added.panel.id,
    connectedToNodeId: null,
  });
  next = poiAdded.topology;
  created.push(`${poiAdded.poi.label} — arrangement still to be decided`);

  // The utility isolation device, where one exists, moves onto the aggregated feeder: that is what
  // makes opening it disconnect every source, and it is what the coverage check verifies.
  const isolator = next.devices.find(d => d.roles.includes('der-isolation-disconnect'));
  if (isolator) {
    next = updateAggregationPanel(next, added.panel.id, { feedsNodeId: isolator.id });
    next = placeDevice(next, isolator.id, poiAdded.poi.id);
    // 🚨 AND THE POINT OF INTERCONNECTION'S DER SIDE MOVES TO THE ISOLATOR.
    //
    // Left pointing at the panel it produced a SECOND edge, panel → POI, running straight past the
    // disconnect that was just inserted between them — a parallel path around the isolation. The
    // DER-isolation-coverage check reported FAIL on this very preset, which is precisely what it is
    // for: a drawing that looks right and a switch that does not open everything.
    next = updatePointOfInterconnection(next, poiAdded.poi.id, { derNodeId: isolator.id });
    created.push(`${isolator.label} placed on the aggregated DER feeder`);
  } else {
    next = updateAggregationPanel(next, added.panel.id, { feedsNodeId: poiAdded.poi.id });
  }

  return { topology: next, created, recommendation };
}

/**
 * How the new solar connects, in the words Ray's own flow uses.
 *
 * 🚨 THE LABEL NAMES THE ACTUAL BATTERY, THE MEMBER DOES NOT. `dc-coupled-storage` is the generic
 * architecture; "DC directly to Tesla Powerwall 3" is what the installer picking it reads, composed
 * from the units in the graph. One model, two vocabularies — the same split the DER arrangement
 * choices already use.
 */
export interface SolarCouplingChoice {
  id: SolarCoupling;
  labelFor: (t: ServiceTopology) => string;
  describe: string;
}

export const SOLAR_COUPLING_CHOICES: ReadonlyArray<SolarCouplingChoice> = [
  {
    id: 'dc-coupled-storage',
    labelFor: t => {
      const models = [...new Set(t.storage.filter(u => u.role === 'inverter-unit')
        .map(u => u.label ?? u.productId))];
      return `DC directly to ${models.length === 1 ? models[0] : 'the batteries'}`;
    },
    describe: 'The strings land on the batteries\' own DC inputs. No microinverters, no separate '
      + 'solar inverter, no PV combiner and no PV AC disconnect — none of that equipment is '
      + 'installed.',
  },
  {
    id: 'ac-coupled-inverter',
    labelFor: () => 'Existing or new AC solar inverter',
    describe: 'The PV has its own inverter and connects on the AC side. A perfectly ordinary '
      + 'arrangement alongside a battery, and not ruled out by one being present.',
  },
  {
    id: 'storage-only',
    labelFor: () => 'No solar on this project',
    describe: 'Storage only. Nothing on the sheet shows PV.',
  },
];

export interface GenerationPanelResult {
  topology: ServiceTopology;
  created: string[];
  /** One recommendation per panel built, so the operator sees the arithmetic. */
  recommendations: AggregationRecommendation[];
}

/**
 * ONE GENERATION / COMBINER PANEL PER SYSTEM — a physical panelboard, not a note.
 *
 * Ray's real job: "Each pair of Powerwall 3 units must first land in a generation / combiner panel
 * before feeding its Gateway... These are two separate combiner/generation panels. Do not create
 * one common generation panel shared by both Gateways."
 *
 * 🚨 SO IT IS BUILT PER DOMAIN AND IT CARRIES ITS DOMAIN'S ID. Each panel takes only that system's
 * inverter units, each feeds only that system's gateway, and `domainId` is what keeps Domain A and
 * Domain B apart on a BOM where both rows say the same model. The one shared panel remains
 * buildable — it is `applyDerArrangement('common-aggregation')` — and nothing here reaches for it
 * because two Gateways exist.
 *
 * 🚨 AND IT IS SIZED FROM ITS OWN TWO POWERWALLS. Ray: "Do not hard-code a combiner size merely
 * because two 60 A breakers exist." Two 48 A units give 96 A, 125% of that is 120 A, and the next
 * standard device is 125 A — which is the number `recommendAggregationRatings` returns from the
 * instances. Change the configuration to 10 kW and it moves on its own.
 */
export function applyPerSystemGenerationPanels(t: ServiceTopology): GenerationPanelResult {
  const created: string[] = [];
  const recommendations: AggregationRecommendation[] = [];
  let next = t;

  // Replace any per-system panels already built, so re-running the step does not accumulate them.
  // A site-wide panel (no domainId) belongs to the other arrangement and is left alone.
  for (const existing of (t.aggregationPanels ?? []).filter(p => p.domainId)) {
    next = removeAggregationPanel(next, existing.id);
  }

  for (const d of next.domains) {
    const units = d.storageUnitIds
      .map(id => next.storage.find(u => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.role === 'inverter-unit');
    const added = addAggregationPanel(next, {
      label: `Generation panel — ${d.label}`,
      domainId: d.id,
      // A DER-only generation panel: it serves no premises load, so the 120% allowance is not its
      // governing rule and its busbar simply has to carry the aggregated output.
      carriesPremisesLoad: false,
      mainLugOnly: true,
      inputs: units.map(u => ({ sourceId: u.id, tap: 'der-output' as const, ocpdA: u.ocpdA })),
      // Into that system's own controller, and no further.
      feedsNodeId: d.gateway.id,
    });
    next = added.topology;
    created.push(`${added.panel.label} with ${units.length} branch breaker(s), feeding `
      + `${d.gateway.label}`);

    const rec = recommendAggregationRatings(next, added.panel.id);
    recommendations.push(rec);
    if (rec.outputOcpdA !== null) {
      next = updateAggregationPanel(next, added.panel.id, {
        busbarRatingA: rec.busbarRatingA,
        outputOcpdA: rec.outputOcpdA,
        outputConductorGauge: rec.outputConductorGauge,
      });
      created.push(`${rec.aggregateContinuousA} A aggregated → ${rec.outputOcpdA} A output OCPD, `
        + `${rec.outputConductorGauge} feeder, ${rec.busbarRatingA} A busbar`);
    }

    // The storage no longer lands on the backed-up busbar or in the controller directly: it lands
    // in this panel. Saying otherwise would leave the 120% check pointed at the wrong bus.
    next = {
      ...next,
      domains: next.domains.map(x => x.id === d.id
        ? { ...x, storageConnection: 'der-aggregation-panel' as const } : x),
    };

    // The point of interconnection for this system is the panel's output landing in the gateway.
    // Listed equipment, so the governed relationship is the manufacturer's, not an NEC article.
    const poi = next.pointsOfInterconnection.find(p => p.connectedToNodeId === d.gateway.id
      || p.derNodeId === (d.storageUnitIds[0] ?? ''));
    if (poi) {
      next = updatePointOfInterconnection(next, poi.id, {
        derNodeId: added.panel.id,
        connectedToNodeId: d.gateway.id,
        relationship: 'manufacturer-integrated',
      });
    } else {
      const r = addPointOfInterconnection(next, {
        label: `${d.label} point of interconnection`,
        relationship: 'manufacturer-integrated',
        derNodeId: added.panel.id,
        connectedToNodeId: d.gateway.id,
      });
      next = r.topology;
      created.push(`${r.poi.label} — the generation panel's output into ${d.gateway.label}`);
    }
  }

  return { topology: next, created, recommendations };
}

/**
 * Take the per-system generation panels back out.
 *
 * 🚨 AND PUT THE STORAGE BACK TO UNRESOLVED, NOT TO A LANDING NOBODY CHOSE. The panel was where
 * the Powerwalls landed; with it gone, where they land is an open question again. Silently
 * reverting them to the gateway or to the panel busbar would answer it on the operator's behalf —
 * and one of those two answers FAILS 705.12(B) on this job.
 */
export function clearPerSystemGenerationPanels(t: ServiceTopology): ServiceTopology {
  let next = t;
  for (const p of (t.aggregationPanels ?? []).filter(x => x.domainId)) {
    next = removeAggregationPanel(next, p.id);
  }
  return {
    ...next,
    domains: next.domains.map(d => d.storageConnection === 'der-aggregation-panel'
      ? { ...d, storageConnection: 'unresolved' as const } : d),
    pointsOfInterconnection: (next.pointsOfInterconnection ?? []).map(poi =>
      poi.derNodeId === null && poi.relationship === 'manufacturer-integrated'
        ? { ...poi, relationship: 'unresolved' as const } : poi),
  };
}

/**
 * The four disconnect ROLES, described where they sit.
 *
 * Ray: "Show the semantic roles clearly... Do not expose four vague buttons without showing where
 * they sit in the topology." So the wizard and the advanced strip both render from this list, and
 * a role's meaning is written once.
 */
export interface DisconnectRoleSpec {
  role: 'service-disconnect' | 'der-isolation-disconnect' | 'gateway-isolation' | 'ess-disconnect';
  label: string;
  /** Where it sits in the chain. */
  where: string;
  /** What it is for. */
  purpose: string;
  /** Sensible defaults for the device this role creates. Ratings still come from the topology. */
  lockableOpen: boolean;
  visibleOpen: boolean;
}

export const DISCONNECT_ROLES: ReadonlyArray<DisconnectRoleSpec> = [
  {
    role: 'service-disconnect',
    label: 'Service disconnect',
    where: 'Between the revenue meter and the service distribution.',
    purpose: 'Disconnects the premises wiring from the service conductors. Its location is what '
      + 'decides where the neutral-ground bond belongs.',
    lockableOpen: true,
    visibleOpen: false,
  },
  {
    role: 'der-isolation-disconnect',
    label: 'Utility DER isolation',
    where: 'Adjacent to the revenue meter, accessible to the utility.',
    purpose: 'Isolates every on-site generator and storage device from the utility. Required by '
      + 'some utilities and not by others — the project\'s interconnection authority decides.',
    lockableOpen: true,
    visibleOpen: true,
  },
  {
    role: 'gateway-isolation',
    label: 'Gateway isolation',
    where: 'Ahead of a backup gateway / controller.',
    purpose: 'Isolates one gateway for service without dropping the rest of the site.',
    lockableOpen: true,
    visibleOpen: false,
  },
  {
    role: 'ess-disconnect',
    label: 'ESS disconnect / OCPD',
    where: 'At the energy storage equipment.',
    purpose: 'Overcurrent protection and disconnecting means for the storage itself. It is not the '
      + 'service disconnect and it is not the utility\'s isolation device.',
    lockableOpen: true,
    visibleOpen: false,
  },
];
