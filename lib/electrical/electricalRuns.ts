// ═══════════════════════════════════════════════════════════════════════════
// lib/electrical/electricalRuns.ts — THE CANONICAL ELECTRICAL RUN.
//
// Ray (SLD run authority): "DO NOT SIZE CONDUCTORS IN THE RENDERER… The renderer is a consumer.
//     SYSTEM CONFIG / EQUIPMENT / TOPOLOGY FACTS
//             ↓
//     CANONICAL ELECTRICAL RUN
//             ↓
//     CONDUCTOR + RACEWAY SIZING ENGINE
//             ↓
//     ENGINEERED RUN RESULT
//             ↓
//     SLD (and the SAME result feeds the conductor schedule, BOM, permit, voltage drop…)"
//
// This module is that chain for every conductor run the SERVICE GRAPH owns: the DER circuits into
// the generation panels / controllers, the generation feeders, the backup feeders and the service
// branch feeders. (PV source / string runs stay with the PV engine — lib/computed-system.ts via
// lib/segment-schedule.ts — which already engineers them.)
//
//   deriveServiceRuns(topology)          one RunSpec per real conductor run, terminal to terminal
//   engineerRun(spec, environment)       the NEC sizing, every input named with where it came from
//   engineerServiceRuns(topology, env)   both — what every consumer reads
//   runEnvironmentFrom(project facts)    the ONE way a route builds the environment
//   runCallout / runScheduleCells        the ONE wording every consumer prints
//
// 🚨 NOTHING IS DEFAULTED TO MAKE THE CALCULATOR RUN. An input SolarPro does not hold makes the part
// of the result it feeds NOT_EVALUATED and is named in `missingInputs`; Engineering Readiness lists
// it. The one rule applied to an unknown is NEC 110.14(C)(1) itself: when an equipment's terminal
// rating is not recorded the CODE prescribes the column (60 °C for a circuit of 100 A or less, 75 °C
// above) — that is the code's own answer for the unknown, and it is the conservative direction.
// It is stated on the run's provenance.
//
// Pure and isomorphic. Writes nothing.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  ServiceTopology, StorageUnit, BackupDomain, DerAggregationPanel, DerAggregationInput, PanelBoard,
} from '@/lib/electrical/serviceTopology';
import {
  servicePhaseInfo, storageUnitLabel, topologyNodeLabel, sizeAggregationPanel, effectivePanelRatings,
  sourcesForAggregationInput,
} from '@/lib/electrical/serviceTopology';
import {
  NEC_AWG_ORDER, NEC_310_16_COPPER_60C, NEC_310_16_COPPER_75C, NEC_310_16_COPPER_90C,
  necAmbientCorrection90C, necConductorCountAdjustment,
} from '@/lib/nec/ampacity';
import { conductorAreaIn2, selectSmallestConduit, normalizeConduitType } from '@/lib/nec/chapter9';
import { circularMils, dcResistanceOhmsPerKft } from '@/lib/nec/table8';
import { NEC_STANDARD_OCPD } from '@/lib/electrical/stdSizes';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { siteDesignHighC } from '@/lib/permit/utils/designTemps';

// ─── Terminals ──────────────────────────────────────────────────────────────

/**
 * The semantic terminal names a run lands on. The DEVICE ART owns where each one is drawn
 * (lib/sld-device-illustrations.ts / lib/sld-symbols.ts); the run owns which one it lands on; the
 * renderer only connects them. Never a layout coordinate.
 */
export const RUN_TERMINAL = {
  /** A backup controller's utility side. */
  GRID_IN: 'GRID_IN',
  /** A backup controller's backed-up (load) side. */
  LOAD_OUT: 'LOAD_OUT',
  /** Where DER lands inside a backup controller (its internal panelboard). */
  DER_IN: 'DER_IN',
  /** A storage unit's AC terminals. */
  BATTERY_AC: 'BATTERY_AC',
  /** A generation unit's AC output terminals. */
  AC_OUT: 'AC_OUT',
  /** A panelboard's main breaker or main lugs. */
  MAIN: 'MAIN',
  /** A protective device's line and load sides. */
  LINE: 'LINE',
  LOAD: 'LOAD',
  /** The point-of-interconnection node itself. */
  POI: 'POI',
} as const;
/** A branch position (breaker space) in a panelboard, by the graph id of what it serves. */
export const branchTerminal = (id: string) => `BRANCH:${id}`;
/** A feeder position in the service distribution. */
export const feederTerminal = (branchId: string) => `FEEDER:${branchId}`;
/** A unit's PV DC input, 1-based (the art numbers them as the manufacturer does). */
export const pvDcInputTerminal = (n: number) => `PV_DC_IN_${n}`;

export const SERVICE_DISTRIBUTION_ID = 'service-distribution';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunRole = 'der-circuit' | 'generation-feeder' | 'backup-feeder' | 'branch-feeder';
export type RunAspectStatus = 'ENGINEERED' | 'NOT_EVALUATED';

export interface RunTerminal {
  /** Graph node id ('service-distribution' for the service equipment's distribution). */
  deviceId: string;
  terminalId: string;
  deviceLabel: string;
  /** Catalogue id when the node is a catalogued product (for its terminal facts). */
  productId?: string | null;
}

/** How the run's minimum conductor ampacity is set. */
export type RunCurrentBasis =
  /** A DER output circuit: 125 % of the equipment's continuous output (NEC 705.28(B)). */
  | 'der-continuous'
  /** A feeder carrying several DER outputs: 125 % of their sum (NEC 705.28(B)). */
  | 'der-sum'
  /** A feeder sized to the device that protects it (NEC 240.4). */
  | 'ocpd';

/** The facts a run is derived from — everything the graph knows about it, nothing sized yet. */
export interface RunSpec {
  /** Stable: '<role>:<graph ids>'. */
  id: string;
  role: RunRole;
  /** 'ESS AC CIRCUIT', 'BACKUP FEEDER' … the run's name on a sheet. */
  name: string;
  source: RunTerminal;
  destination: RunTerminal;
  currentBasis: RunCurrentBasis;
  /** For a DER basis: the continuous current the conductors carry; null ⇒ not established. */
  continuousCurrentA: number | null;
  /** The device that protects the run from the primary (utility) source. */
  ocpdA: number | null;
  /** What `ocpdA` is, in words, for the readiness list ("the main breaker fitted in …"). */
  ocpdLabel: string;
  /**
   * NEC 705.12(B)(1) — a feeder with power sources at its supply end as well as the utility. Present
   * only on such a feeder: the OCPD at its load end (the panel's main breaker, after any applied
   * remedy) and the DER output current connected at its supply end.
   */
  feederSources?: {
    loadEndOcpdA: number | null;
    loadEndLabel: string;
    /** Σ continuous output of the DER connected at the supply end; null ⇒ not established. */
    derContinuousA: number | null;
    /** True when SolarPro knows no DER is connected at the supply end (then 240.4 alone governs). */
    noDer: boolean;
  };
  /** Ungrounded conductors (2 on split phase, 3 on a 3-phase system); null when the system is unknown. */
  hotCount: number | null;
  /** Whether a neutral is pulled with this run. */
  neutral: 'required' | 'not-required' | 'not-established';
  /** Who decides `neutral` when it is not established — named in the readiness list. */
  neutralAuthority?: string;
  nominalVoltageV: number | null;
  phaseConfiguration: string | null;
  /** The current voltage drop is computed at: DER continuous, or a feeder's calculated load. */
  voltageDropCurrentA: number | null;
}

/** One thing SolarPro needs before it can engineer part of a run. */
export interface RunMissingInput {
  /** What kind of input it is. */
  key:
    | 'ocpd' | 'der-current' | 'ambient' | 'wiring-method' | 'raceway-type' | 'system'
    | 'neutral' | 'load-end-ocpd' | 'run-length' | 'vd-target' | 'feeder-load' | 'table-range'
    | 'raceway-table';
  /** The fact needed, without the run ("Tesla Powerwall 3 — whether its AC terminals take a
   *  neutral"): the readiness list shows each once, with the runs waiting on it. */
  need: string;
  /** The run waiting on it ("Tesla Powerwall 3 #1 → Generation panel — System 1"). */
  run: string;
  /** `${run}: ${need}`. */
  text: string;
  /** false ⇒ only the voltage-drop check waits on it; the conductors and raceway do not. */
  blocking: boolean;
}

/** A catalogued product's manufacturer terminal facts, as the catalogue records them. */
export interface TerminalFacts {
  /** The temperature the AC terminals are listed and identified for (NEC 110.14(C)(1)(a)(3)). */
  acTerminalTempC?: 60 | 75 | 90 | null;
  /** Whether the AC terminals take a neutral conductor. */
  acNeutral?: 'required' | 'not-required' | null;
  /** The document the facts were read from. */
  basis?: string;
}

/** Where every engineering input comes from — built once per request by `runEnvironmentFrom`. */
export interface RunEnvironment {
  /** Site design high ambient (ASHRAE 2 %); null when the site location is not established. */
  ambient: { designHighC: number; source: string } | null;
  /** The wiring method for the run's NEW conductors. */
  wiringMethod: {
    material: 'copper' | 'aluminum' | null;
    insulation: string | null;
    /** The 310.16 column the insulation is rated for. */
    insulationTempC: 60 | 75 | 90 | null;
    racewayType: string | null;
    source: string;
  };
  /** The design's AC voltage-drop target, %; null ⇒ none set. */
  voltageDropTargetPct: number | null;
  /** One-way lengths the installer recorded, by run id. Absent ⇒ voltage drop not evaluated. */
  runLengthsFt?: Readonly<Record<string, number>>;
  /** Manufacturer terminal facts by catalogue id. Absent ⇒ not recorded. */
  terminalFacts?: Readonly<Record<string, TerminalFacts>>;
}

export interface EngineeredRun extends RunSpec {
  conductor: {
    status: RunAspectStatus;
    material: 'copper' | 'aluminum' | null;
    insulation: string | null;
    /** Conductors in the raceway other than the EGC: ungrounded + neutral (when pulled). */
    count: number | null;
    /** Ungrounded conductor size, '#4 AWG'. */
    size: string | null;
    neutralSize: string | null;
    egcSize: string | null;
    /** The 310.16 column the terminations limit the conductor to (NEC 110.14(C)). */
    terminalTempC: 60 | 75 | 90 | null;
    terminalBasis: string | null;
    ambientC: number | null;
    ambientFactor: number | null;
    currentCarryingCount: number | null;
    cccFactor: number | null;
    /** min(insulation ampacity × factors, terminal-column ampacity) — what the OCPD protects. */
    allowableAmpacityA: number | null;
    /** The minimum ampacity the run's own rules require (125 % of continuous, 705.12(B)(1)); null when
     *  only NEC 240.4 (protection by its OCPD) governs. */
    requiredAmpacityA: number | null;
    /** True when the ungrounded conductors were upsized for voltage drop (EGC follows, 250.122(B)). */
    upsizedForVoltageDrop: boolean;
    necReferences: string[];
  };
  raceway: {
    status: RunAspectStatus;
    type: string | null;
    tradeSize: string | null;
    fillPct: number | null;
  };
  voltageDrop: {
    status: RunAspectStatus;
    lengthFt: number | null;
    pct: number | null;
    targetPct: number | null;
    pass: boolean | null;
  };
  /** ENGINEERED only when the conductors AND the raceway are; voltage drop is reported on its own. */
  evaluationStatus: RunAspectStatus;
  missingInputs: RunMissingInput[];
  /** One line per input: what was used and where it came from. */
  provenance: string[];
}

// ─── Run derivation (from the graph) ────────────────────────────────────────

interface SystemFacts {
  hotCount: number | null;
  hasNeutral: boolean | null;
  voltageV: number | null;
  label: string | null;
}

function systemOf(t: ServiceTopology): SystemFacts {
  const info = servicePhaseInfo(t.service.phase);
  return {
    hotCount: info.phaseCount === 1 ? 2 : info.phaseCount === 3 ? 3 : null,
    hasNeutral: info.hasNeutral,
    voltageV: info.lineToLineV,
    label: info.phaseCount === null ? null : info.label,
  };
}

type Common = Pick<RunSpec, 'hotCount' | 'nominalVoltageV' | 'phaseConfiguration'>;

const feederNeutral = (sys: SystemFacts): RunSpec['neutral'] =>
  sys.hasNeutral == null ? 'not-established' : sys.hasNeutral ? 'required' : 'not-required';

const sumOrNull = (xs: Array<number | null>): number | null =>
  xs.length > 0 && xs.every((v): v is number => typeof v === 'number' && Number.isFinite(v))
    ? xs.reduce((a, b) => a + b, 0) : null;

const panelMain = (p: PanelBoard): RunTerminal =>
  ({ deviceId: p.id, terminalId: RUN_TERMINAL.MAIN, deviceLabel: p.label });

/**
 * Every conductor run the service graph owns, terminal to terminal. Order follows the graph, so ids
 * and sheet positions do not shuffle between renders.
 *
 * A DER circuit's neutral is the manufacturer's (`terminalFacts`); the derivation leaves it
 * 'not-established' and `engineerRun` resolves it, so the graph walk needs no catalogue.
 */
export function deriveServiceRuns(t: ServiceTopology): RunSpec[] {
  const sys = systemOf(t);
  const runs: RunSpec[] = [];
  const storageById = new Map(t.storage.map(u => [u.id, u]));
  const generationById = new Map((t.generation ?? []).map(g => [g.id, g]));
  const common: Common = { hotCount: sys.hotCount, nominalVoltageV: sys.voltageV, phaseConfiguration: sys.label };
  const domainByGateway = new Map(t.domains.map(d => [d.gateway.id, d]));
  /** Two systems with the same controller model read "Tesla Backup Gateway 3 — System 1 / 2". */
  const gatewayLabel = (d: BackupDomain) =>
    t.domains.filter(x => x.gateway.label === d.gateway.label).length > 1 ? `${d.gateway.label} — ${d.label}` : d.gateway.label;
  const gatewayEnd = (d: BackupDomain, terminalId: string): RunTerminal =>
    ({ deviceId: d.gateway.id, terminalId, deviceLabel: gatewayLabel(d), productId: d.gateway.productId });

  /** The terminal a run lands on at a graph node, by what kind of node it is. */
  const landingAt = (nodeId: string, branchKey: string): RunTerminal | null => {
    const deviceLabel = topologyNodeLabel(t, nodeId);
    const dom = domainByGateway.get(nodeId);
    if (dom) return gatewayEnd(dom, RUN_TERMINAL.DER_IN);
    if (t.panels.some(p => p.id === nodeId)) return { deviceId: nodeId, terminalId: branchTerminal(branchKey), deviceLabel };
    const agg = (t.aggregationPanels ?? []).find(a => a.id === nodeId);
    if (agg) return { deviceId: nodeId, terminalId: branchTerminal(branchKey), deviceLabel, productId: agg.productId ?? null };
    const dev = t.devices.find(d => d.id === nodeId);
    if (dev) return { deviceId: nodeId, terminalId: RUN_TERMINAL.LINE, deviceLabel, productId: dev.productId ?? null };
    if ((t.pointsOfInterconnection ?? []).some(p => p.id === nodeId)) return { deviceId: nodeId, terminalId: RUN_TERMINAL.POI, deviceLabel };
    return null;
  };

  /** A storage inverter unit's AC output circuit to where it lands. */
  const essCircuit = (id: string, unit: StorageUnit, dest: RunTerminal, ocpdA: number | null, ocpdLabel: string): RunSpec => ({
    id,
    role: 'der-circuit',
    name: 'ESS AC CIRCUIT',
    source: { deviceId: unit.id, terminalId: RUN_TERMINAL.BATTERY_AC, deviceLabel: storageUnitLabel(t, unit), productId: unit.productId },
    destination: dest,
    currentBasis: 'der-continuous',
    continuousCurrentA: unit.continuousOutputA,
    ocpdA,
    ocpdLabel,
    neutral: 'not-established',
    neutralAuthority: `${unit.label ?? unit.productId} — whether its AC terminals take a neutral (manufacturer installation manual)`,
    voltageDropCurrentA: unit.continuousOutputA,
    ...common,
  });

  // ── Aggregation / generation panels: their input circuits and their output feeder ──
  for (const agg of t.aggregationPanels ?? []) {
    for (const input of agg.inputs) {
      const dest: RunTerminal = { deviceId: agg.id, terminalId: branchTerminal(input.id), deviceLabel: agg.label, productId: agg.productId ?? null };
      const ocpdLabel = `the breaker in ${agg.label} for this circuit`;
      const unit = storageById.get(input.sourceId);
      if (unit) {
        if (unit.role === 'inverter-unit') runs.push(essCircuit(`der-circuit:${agg.id}:${input.id}`, unit, dest, input.ocpdA, ocpdLabel));
        continue;
      }
      const gen = generationById.get(input.sourceId);
      if (gen) {
        runs.push({
          id: `der-circuit:${agg.id}:${input.id}`,
          role: 'der-circuit',
          name: gen.kind === 'pv-inverter' ? 'PV INVERTER AC CIRCUIT' : gen.kind === 'generator' ? 'GENERATOR CIRCUIT' : 'DER AC CIRCUIT',
          source: { deviceId: gen.id, terminalId: RUN_TERMINAL.AC_OUT, deviceLabel: gen.label, productId: gen.productId ?? null },
          destination: dest,
          currentBasis: 'der-continuous',
          continuousCurrentA: gen.continuousOutputA,
          ocpdA: input.ocpdA,
          ocpdLabel,
          neutral: 'not-established',
          neutralAuthority: `${gen.label} — whether its AC terminals take a neutral (manufacturer installation manual)`,
          voltageDropCurrentA: gen.continuousOutputA,
          ...common,
        });
        continue;
      }
      const dom = t.domains.find(d => d.id === input.sourceId);
      if (dom) runs.push(domainDerFeeder(t, agg, input, dom, gatewayEnd(dom, input.tap === 'gateway-grid-side' ? RUN_TERMINAL.GRID_IN : RUN_TERMINAL.LOAD_OUT), dest, ocpdLabel, common));
    }

    if (!agg.feedsNodeId) continue;
    const dest = landingAt(agg.feedsNodeId, agg.id);
    if (!dest) continue;
    const sizing = sizeAggregationPanel(t, agg);
    const derOnly = agg.carriesPremisesLoad !== true;
    // The neutral question for a DER-only panel's feeder IS its sources' question — the same words,
    // so the readiness list asks it once.
    const sourceAuthorities = [...new Set(runs
      .filter(r => r.role === 'der-circuit' && r.destination.deviceId === agg.id && r.neutralAuthority)
      .map(r => r.neutralAuthority as string))];
    runs.push({
      id: `generation-feeder:${agg.id}`,
      role: 'generation-feeder',
      name: 'GENERATION FEEDER',
      source: { deviceId: agg.id, terminalId: RUN_TERMINAL.MAIN, deviceLabel: agg.label, productId: agg.productId ?? null },
      destination: dest,
      currentBasis: 'der-sum',
      continuousCurrentA: sizing.aggregateContinuousA,
      ocpdA: agg.outputOcpdA,
      ocpdLabel: `the output OCPD of ${agg.label}`,
      // A load-carrying panel's feeder carries the premises neutral. A DER-only panel's feeder
      // carries one exactly when the equipment landing in it does — resolved in
      // engineerServiceRuns from the circuits landing in it.
      neutral: derOnly ? 'not-established' : feederNeutral(sys),
      ...(derOnly ? { neutralAuthority: sourceAuthorities.length === 1 ? sourceAuthorities[0]
        : `the equipment landing in ${agg.label} — whether its AC terminals take a neutral (manufacturer installation manual)` } : {}),
      voltageDropCurrentA: sizing.aggregateContinuousA,
      ...common,
    });
  }

  // ── Storage that lands directly in its controller or in the one panel it backs up ──
  for (const d of t.domains) {
    let dest: ((u: StorageUnit) => RunTerminal) | null = null;
    let host = '';
    if (d.storageConnection === 'gateway-panelboard') {
      dest = () => gatewayEnd(d, RUN_TERMINAL.DER_IN);
      host = gatewayLabel(d);
    } else if (d.storageConnection === 'backed-up-panel-busbar' && d.backedUpPanelIds.length === 1) {
      const p = t.panels.find(x => x.id === d.backedUpPanelIds[0]);
      if (p) { dest = u => ({ deviceId: p.id, terminalId: branchTerminal(u.id), deviceLabel: p.label }); host = p.label; }
    }
    if (!dest) continue;
    for (const id of d.storageUnitIds) {
      const u = storageById.get(id);
      if (!u || u.role !== 'inverter-unit') continue;
      runs.push(essCircuit(`der-circuit:${d.id}:${u.id}`, u, dest(u), u.ocpdA,
        `the breaker in ${host} for ${storageUnitLabel(t, u)}`));
    }
  }

  // ── Backup feeders: each controller's backed-up terminals to each panel it backs up ──
  for (const d of t.domains) {
    for (const pid of d.backedUpPanelIds) {
      const p = t.panels.find(x => x.id === pid);
      if (!p) continue;
      const der = derAtController(t, d);
      runs.push({
        id: `backup-feeder:${d.id}:${p.id}`,
        role: 'backup-feeder',
        name: 'BACKUP FEEDER',
        source: gatewayEnd(d, RUN_TERMINAL.LOAD_OUT),
        destination: panelMain(p),
        currentBasis: 'ocpd',
        continuousCurrentA: null,
        ocpdA: d.gateway.mainBreakerA,
        ocpdLabel: `the main breaker fitted in ${gatewayLabel(d)}`,
        feederSources: {
          loadEndOcpdA: effectivePanelRatings(p).mainBreakerA,
          loadEndLabel: `the main breaker in ${p.label}`,
          derContinuousA: der.continuousA,
          noDer: der.none,
        },
        neutral: feederNeutral(sys),
        voltageDropCurrentA: d.backedUpDemandA,
        ...common,
      });
    }
  }

  // ── Service branch feeders: the distribution's branch OCPD to what the branch feeds, through every
  //    device placed in line on it ──
  for (const b of t.branches) {
    const d = t.domains.find(x => x.branchId === b.id);
    const fed = (b.panelIds ?? []).map(id => t.panels.find(p => p.id === id)).filter((p): p is PanelBoard => !!p);
    const finalNodeId = d ? d.gateway.id : fed.length === 1 ? fed[0].id : null;
    if (!finalNodeId) continue;
    const finalEnd: RunTerminal = d ? gatewayEnd(d, RUN_TERMINAL.GRID_IN) : panelMain(fed[0]);
    // The chain of in-line devices: each names the branch (or the device before it) as its utility
    // side and the final node as the node whose supply it interrupts.
    const chain: Array<{ id: string; label: string; productId: string | null }> = [];
    let upstream = b.id;
    for (let guard = 0; guard < t.devices.length; guard++) {
      const next = t.devices.find(x => x.inlineOnNodeId === finalNodeId && x.feedsNodeId === upstream
        && !chain.some(c => c.id === x.id));
      if (!next) break;
      chain.push({ id: next.id, label: next.label, productId: next.productId ?? null });
      upstream = next.id;
    }
    const ends: RunTerminal[] = [
      { deviceId: SERVICE_DISTRIBUTION_ID, terminalId: feederTerminal(b.id), deviceLabel: topologyNodeLabel(t, SERVICE_DISTRIBUTION_ID) },
      ...chain.flatMap(c => [
        { deviceId: c.id, terminalId: RUN_TERMINAL.LINE, deviceLabel: c.label, productId: c.productId },
        { deviceId: c.id, terminalId: RUN_TERMINAL.LOAD, deviceLabel: c.label, productId: c.productId },
      ]),
      finalEnd,
    ];
    for (let i = 0; i + 1 < ends.length; i += 2) {
      runs.push({
        id: `branch-feeder:${b.id}${chain.length > 0 ? `:${i / 2 + 1}` : ''}`,
        role: 'branch-feeder',
        name: 'SERVICE BRANCH FEEDER',
        source: ends[i],
        destination: ends[i + 1],
        currentBasis: 'ocpd',
        continuousCurrentA: null,
        ocpdA: b.ocpdAmps,
        ocpdLabel: `the overcurrent device protecting ${b.label}`,
        // DER on this branch connects at the far end from the branch OCPD, so NEC 705.12(B)(1) adds
        // nothing: the feeder is protected by its own OCPD (240.4).
        neutral: feederNeutral(sys),
        voltageDropCurrentA: b.calculatedDemandA,
        ...common,
      });
    }
  }
  return runs;
}

/** A backup domain's DER carried out of its controller to an aggregation panel. */
function domainDerFeeder(
  t: ServiceTopology, agg: DerAggregationPanel, input: DerAggregationInput, dom: BackupDomain,
  source: RunTerminal, dest: RunTerminal, ocpdLabel: string, common: Common,
): RunSpec {
  const current = sumOrNull(sourcesForAggregationInput(t, input).map(s => s.continuousOutputA));
  return {
    id: `der-circuit:${agg.id}:${input.id}`,
    role: 'der-circuit',
    name: 'DER FEEDER',
    source,
    destination: dest,
    currentBasis: 'der-sum',
    continuousCurrentA: current,
    ocpdA: input.ocpdA,
    ocpdLabel,
    neutral: 'not-established',
    neutralAuthority: `${source.deviceLabel} — whether this connection carries a neutral (manufacturer installation manual)`,
    voltageDropCurrentA: current,
    ...common,
  };
}

/** The DER connected INSIDE a controller — at the supply end of its backup feeder. */
function derAtController(t: ServiceTopology, d: BackupDomain): { continuousA: number | null; none: boolean } {
  const inverting = d.storageUnitIds
    .map(id => t.storage.find(x => x.id === id))
    .filter((u): u is StorageUnit => !!u && u.role === 'inverter-unit');
  // Storage whose landing nobody has stated may be in the controller: not established, not none.
  if (d.storageConnection === 'unresolved' && inverting.length > 0) return { continuousA: null, none: false };
  const parts: Array<number | null> = [];
  if (d.storageConnection === 'gateway-panelboard') for (const u of inverting) parts.push(u.continuousOutputA);
  for (const a of (t.aggregationPanels ?? []).filter(x => x.feedsNodeId === d.gateway.id)) {
    parts.push(sizeAggregationPanel(t, a).aggregateContinuousA);
  }
  if (parts.length === 0) return { continuousA: 0, none: true };
  return { continuousA: sumOrNull(parts), none: false };
}

// ─── The sizing engine ──────────────────────────────────────────────────────

const STD = NEC_STANDARD_OCPD as readonly number[];

/** NEC 240.4(B): protected when ampacity ≥ OCPD, or the OCPD is the next standard rating above an
 *  ampacity that is not itself a standard rating, at 800 A or less. */
function protectedBy(ampacityA: number, ocpdA: number): boolean {
  if (ampacityA >= ocpdA) return true;
  if (ocpdA > 800 || STD.includes(ampacityA)) return false;
  const next = STD.find(s => s > ampacityA);
  return next != null && next >= ocpdA;
}

/** NEC 240.4(D): small-conductor maximum OCPD, copper. */
const SMALL_CONDUCTOR_MAX_OCPD: Record<string, number> = { '#14 AWG': 15, '#12 AWG': 20, '#10 AWG': 30 };

const gaugeIndex = (g: string) => (NEC_AWG_ORDER as readonly string[]).indexOf(g);
const COLUMN: Record<60 | 75 | 90, Record<string, number>> = {
  60: NEC_310_16_COPPER_60C, 75: NEC_310_16_COPPER_75C, 90: NEC_310_16_COPPER_90C,
};

/**
 * NEC 110.14(C): the column the run's terminations allow — the LOWER of its two ends. An end whose
 * listing is recorded uses it; an end whose listing is not recorded takes the code's own column for
 * the circuit rating (110.14(C)(1)(a) 60 °C at 100 A or less, (b) 75 °C above).
 */
function terminalColumn(spec: RunSpec, ocpdA: number, env: RunEnvironment): { col: 60 | 75 | 90; basis: string } {
  const codeCol: 60 | 75 = ocpdA <= 100 ? 60 : 75;
  const codeText = ocpdA <= 100
    ? 'NEC 110.14(C)(1)(a): 60 °C column — circuit ≤ 100 A'
    : 'NEC 110.14(C)(1)(b): 75 °C column — circuit > 100 A';
  const ends = [spec.source, spec.destination].map(e => {
    const f = e.productId ? env.terminalFacts?.[e.productId] : undefined;
    return f?.acTerminalTempC
      ? { col: f.acTerminalTempC, listed: true, text: `${e.deviceLabel} terminals listed ${f.acTerminalTempC} °C (${f.basis ?? 'catalogue'})` }
      : { col: codeCol as 60 | 75 | 90, listed: false, text: `${e.deviceLabel} terminal listing not recorded` };
  });
  const col = Math.min(ends[0].col, ends[1].col) as 60 | 75 | 90;
  const head = ends.some(e => e.listed) ? `NEC 110.14(C)(1): ${col} °C column — the lower termination` : codeText;
  return { col, basis: `${head} (${ends.map(e => e.text).join('; ')})` };
}

/** Voltage drop, %, from NEC Chapter 9 Table 8 DC resistance (uncoated copper, 75 °C). */
function voltageDropPct(currentA: number, lengthFt: number, gauge: string, voltageV: number, hotCount: number): number | null {
  const r = dcResistanceOhmsPerKft(gauge);
  if (r == null || !(voltageV > 0)) return null;
  const k = hotCount === 3 ? Math.sqrt(3) : 2;
  return ((k * currentA * r * lengthFt) / 1000 / voltageV) * 100;
}

/** NEC 250.122(B): an EGC increased in proportion to the ungrounded conductors' increase in area. */
function proportionalEgc(minEgc: string, minPhase: string, chosenPhase: string): string {
  const a0 = circularMils(minPhase), a1 = circularMils(chosenPhase), e0 = circularMils(minEgc);
  if (a0 == null || a1 == null || e0 == null || a1 <= a0) return minEgc;
  const needed = e0 * (a1 / a0);
  return NEC_AWG_ORDER.find(x => (circularMils(x) ?? 0) >= needed) ?? chosenPhase;
}

/** The smaller of two gauges (by area). */
const smallerGauge = (a: string, b: string) => (gaugeIndex(a) <= gaugeIndex(b) ? a : b);

/**
 * Engineer one run. Every input is taken from `spec` (the graph) or `env` (the project's authorities);
 * an input neither holds makes the part it feeds NOT_EVALUATED and is named in `missingInputs`.
 */
export function engineerRun(spec: RunSpec, env: RunEnvironment): EngineeredRun {
  const missing: RunMissingInput[] = [];
  const provenance: string[] = [];
  const refs = new Set<string>();
  const who = `${spec.source.deviceLabel} → ${spec.destination.deviceLabel}`;
  const need = (key: RunMissingInput['key'], what: string, blocking = true) =>
    missing.push({ key, need: what, run: who, text: `${who}: ${what}`, blocking });

  // ── Neutral: the manufacturer decides for a DER circuit; the system for a feeder ──
  let neutral = spec.neutral;
  if (neutral === 'not-established') {
    const src = spec.source.productId ? env.terminalFacts?.[spec.source.productId] : undefined;
    if (src?.acNeutral) {
      neutral = src.acNeutral;
      provenance.push(`Neutral ${src.acNeutral === 'required' ? 'pulled' : 'not pulled'} — ${spec.source.deviceLabel} (${src.basis ?? 'catalogue'})`);
    }
  }

  // ── Inputs ─────────────────────────────────────────────────────────────────
  const ocpd = spec.ocpdA;
  if (ocpd == null) need('ocpd', `${spec.ocpdLabel} — rating not recorded`);
  else provenance.push(`OCPD ${ocpd} A — ${spec.ocpdLabel} (service model)`);

  const cont = spec.continuousCurrentA;
  if (spec.currentBasis !== 'ocpd') {
    if (cont == null) need('der-current', `the continuous output current of ${spec.source.deviceLabel}`);
    else provenance.push(`Continuous current ${cont} A — ${spec.currentBasis === 'der-sum'
      ? 'Σ of the connected units\' continuous output (catalogue, as commissioned)'
      : 'the unit\'s continuous output (catalogue, as commissioned)'}`);
  }

  const fs = spec.feederSources;
  let feederRequiredA: number | null = null;
  let feederRuleOk = true;
  if (fs && ocpd != null) {
    if (fs.loadEndOcpdA != null) {
      // 705.12(B)(1)(b): an OCPD at the feeder's load end rated not more than the feeder ampacity.
      feederRequiredA = fs.loadEndOcpdA;
      provenance.push(`NEC 705.12(B)(1)(b): ${fs.loadEndLabel} (${fs.loadEndOcpdA} A) protects the feeder at its load end`);
      refs.add('NEC 705.12(B)(1)(b)');
    } else if (fs.noDer) {
      provenance.push('No power source at the feeder\'s supply end besides the utility — NEC 240.4 governs');
    } else if (fs.derContinuousA != null) {
      // 705.12(B)(1)(a): ampacity ≥ the primary source OCPD + 125 % of the power-source output.
      feederRequiredA = +(ocpd + 1.25 * fs.derContinuousA).toFixed(2);
      provenance.push(`NEC 705.12(B)(1)(a): ${ocpd} A + 125 % × ${fs.derContinuousA} A DER = ${feederRequiredA} A (no main breaker at the load end)`);
      refs.add('NEC 705.12(B)(1)(a)');
    } else {
      feederRuleOk = false;
      need('load-end-ocpd', `${fs.loadEndLabel}, or where the storage lands — NEC 705.12(B)(1)`);
    }
  }

  const ambient = env.ambient;
  if (!ambient) need('ambient', 'the site design temperature — the project location (state) is not established');
  else provenance.push(`Ambient ${ambient.designHighC} °C — ${ambient.source}`);

  const wm = env.wiringMethod;
  const wiringOk = wm.material === 'copper' && !!wm.insulation && wm.insulationTempC != null;
  if (!wm.material || !wm.insulation || wm.insulationTempC == null) need('wiring-method', 'the conductor material and insulation');
  else if (wm.material !== 'copper') need('wiring-method', 'aluminum conductors — the sizing engine holds the copper tables only');
  else provenance.push(`Conductors ${wm.insulation} copper — ${wm.source}`);

  if (spec.hotCount == null) need('system', 'the service\'s electrical system (phase / voltage)');

  // ── Conductors ─────────────────────────────────────────────────────────────
  const inputsOk = ocpd != null && (spec.currentBasis === 'ocpd' || cont != null)
    && ambient != null && wiringOk && spec.hotCount != null && feederRuleOk;
  let size: string | null = null, minSize: string | null = null;
  let termCol: 60 | 75 | 90 | null = null, termBasis: string | null = null;
  let ambientFactor: number | null = null, cccFactor: number | null = null, ccc: number | null = null;
  let allowable: number | null = null, required: number | null = null;
  let conductorStatus: RunAspectStatus = 'NOT_EVALUATED';

  if (inputsOk) {
    // Current-carrying conductors in the run's own raceway (one run per raceway): the ungrounded
    // conductors, and a neutral only where it is not an imbalance-only neutral — a split-phase
    // neutral is not counted (310.15(E)(1)); on a 3-phase 4-wire system it is (load mix unrecorded).
    ccc = spec.hotCount! + (neutral === 'required' && spec.hotCount === 3 ? 1 : 0);
    ambientFactor = necAmbientCorrection90C(ambient!.designHighC);
    cccFactor = necConductorCountAdjustment(ccc);
    const { col, basis } = terminalColumn(spec, ocpd!, env);
    termCol = col; termBasis = basis;
    const insCol = wm.insulationTempC!;
    const continuousReq = spec.currentBasis !== 'ocpd' && cont != null ? +(cont * 1.25).toFixed(2) : null;
    required = Math.max(continuousReq ?? 0, feederRequiredA ?? 0) || null;
    refs.add('NEC 310.16'); refs.add('NEC 310.15(B)(1)'); refs.add('NEC 310.15(C)(1)');
    refs.add('NEC 110.14(C)'); refs.add('NEC 240.4');
    if (continuousReq != null) refs.add('NEC 705.28(B)');

    for (const g of NEC_AWG_ORDER) {
      const colAmp = COLUMN[col][g];
      const insAmp = COLUMN[insCol][g];
      if (colAmp == null || insAmp == null) continue;
      const smallMax = SMALL_CONDUCTOR_MAX_OCPD[g];
      if (smallMax != null && ocpd! > smallMax) continue;                  // 240.4(D)
      const adjusted = insAmp * ambientFactor * cccFactor;
      const allow = Math.min(adjusted, colAmp);
      // 125 % of the continuous current against the terminal column, unadjusted (705.28(B)(1));
      // the continuous current against the adjusted ampacity (705.28(B)(2)).
      if (continuousReq != null && colAmp < continuousReq) continue;
      if (spec.currentBasis !== 'ocpd' && cont != null && adjusted < cont) continue;
      // 705.12(B)(1): the feeder's own minimum, against what the conductor may carry.
      if (feederRequiredA != null && allow < feederRequiredA) continue;
      // 240.4: protected by its OCPD.
      if (!protectedBy(allow, ocpd!)) continue;
      size = g; minSize = g; allowable = +allow.toFixed(2);
      break;
    }
    if (size == null) need('table-range', 'conductors larger than #4/0 copper — kcmil or parallel sets are outside the sizing engine');
    else { conductorStatus = 'ENGINEERED'; provenance.push(basis); }
  }

  // ── Voltage drop (reported; upsizes the conductors when the target is exceeded) ──
  const lengthFt = env.runLengthsFt?.[spec.id] ?? null;
  const vdTarget = env.voltageDropTargetPct;
  const vdCurrent = spec.voltageDropCurrentA;
  let vdPct: number | null = null, vdPass: boolean | null = null, vdStatus: RunAspectStatus = 'NOT_EVALUATED';
  let upsized = false;
  if (lengthFt == null) need('run-length', 'the one-way run length', false);
  if (vdTarget == null) need('vd-target', 'the design voltage-drop target', false);
  if (vdCurrent == null && spec.currentBasis === 'ocpd') {
    need('feeder-load', 'the calculated load on the feeder (voltage drop is computed at the load, never at the breaker rating)', false);
  }
  if (conductorStatus === 'ENGINEERED' && lengthFt != null && vdTarget != null && vdCurrent != null
      && spec.nominalVoltageV != null && spec.hotCount != null) {
    let g = size!;
    vdPct = voltageDropPct(vdCurrent, lengthFt, g, spec.nominalVoltageV, spec.hotCount);
    while (vdPct != null && vdPct > vdTarget && gaugeIndex(g) < NEC_AWG_ORDER.length - 1) {
      g = NEC_AWG_ORDER[gaugeIndex(g) + 1];
      vdPct = voltageDropPct(vdCurrent, lengthFt, g, spec.nominalVoltageV, spec.hotCount);
    }
    if (vdPct != null) {
      if (g !== size) { upsized = true; size = g; }
      vdPass = vdPct <= vdTarget;
      vdStatus = 'ENGINEERED';
      provenance.push(`Voltage drop at ${vdCurrent} A over ${lengthFt} ft — NEC Ch. 9 Table 8 resistance; design target ${vdTarget} %`);
    }
  }

  // ── Neutral and EGC ────────────────────────────────────────────────────────
  let egc: string | null = null, neutralSize: string | null = null;
  if (conductorStatus === 'ENGINEERED') {
    const minEgc = getEGCSize(ocpd!);
    // 250.122(A): never required larger than the circuit conductors; (B): increased in proportion
    // when the ungrounded conductors were increased for voltage drop.
    egc = smallerGauge(upsized && minSize ? proportionalEgc(minEgc, minSize, size!) : minEgc, size!);
    refs.add(upsized ? 'NEC 250.122(B)' : 'NEC 250.122(A)');
    // The neutral is the size of the ungrounded conductors: the unbalanced load that would let a
    // feeder neutral be reduced (220.61) is not recorded.
    if (neutral === 'required') neutralSize = size;
    if (neutral === 'not-established') need('neutral', spec.neutralAuthority ?? 'whether the run carries a neutral');
  }

  // ── Raceway ────────────────────────────────────────────────────────────────
  let racewayStatus: RunAspectStatus = 'NOT_EVALUATED';
  let tradeSize: string | null = null, fillPct: number | null = null;
  const racewayType = normalizeConduitType(wm.racewayType);
  if (!racewayType) need('raceway-type', 'the raceway type (wiring method)');
  if (conductorStatus === 'ENGINEERED' && racewayType && neutral !== 'not-established') {
    const pieces: string[] = [
      ...Array.from({ length: spec.hotCount! }, () => size!),
      ...(neutralSize ? [neutralSize] : []),
      egc!,
    ];
    const areas = pieces.map(conductorAreaIn2);
    if (areas.every((a): a is number => a != null)) {
      const total = areas.reduce((a, b) => a + b, 0);
      const pick = selectSmallestConduit(racewayType, total, pieces.length);
      if (pick) {
        tradeSize = pick.tradeSize;
        fillPct = +((total / pick.totalAreaIn2) * 100).toFixed(1);
        racewayStatus = 'ENGINEERED';
        refs.add('NEC Ch. 9 Tables 1, 4, 5');
        provenance.push(`Raceway ${racewayType} — the project's wiring method; one run per raceway`);
      } else {
        need('raceway-table', `a ${racewayType} trade size larger than the tables hold`);
      }
    }
  }

  const engineered = conductorStatus === 'ENGINEERED';
  return {
    ...spec,
    neutral,
    conductor: {
      status: conductorStatus,
      material: wm.material,
      insulation: wm.insulation,
      count: engineered && neutral !== 'not-established' ? spec.hotCount! + (neutralSize ? 1 : 0) : null,
      size: engineered ? size : null,
      neutralSize: engineered ? neutralSize : null,
      egcSize: engineered ? egc : null,
      terminalTempC: termCol,
      terminalBasis: termBasis,
      ambientC: ambient?.designHighC ?? null,
      ambientFactor,
      currentCarryingCount: ccc,
      cccFactor,
      allowableAmpacityA: engineered ? allowable : null,
      requiredAmpacityA: required,
      upsizedForVoltageDrop: upsized,
      necReferences: [...refs],
    },
    raceway: { status: racewayStatus, type: racewayType, tradeSize, fillPct },
    voltageDrop: {
      status: vdStatus, lengthFt,
      pct: vdPct != null ? +vdPct.toFixed(2) : null,
      targetPct: vdTarget, pass: vdPass,
    },
    evaluationStatus: engineered && racewayStatus === 'ENGINEERED' ? 'ENGINEERED' : 'NOT_EVALUATED',
    missingInputs: missing,
    provenance,
  };
}

/** Every service-graph run, engineered — what every consumer reads. */
export function engineerServiceRuns(t: ServiceTopology | null | undefined, env: RunEnvironment): EngineeredRun[] {
  if (!t) return [];
  const specs = deriveServiceRuns(t);
  const first = specs.map(s => engineerRun(s, env));
  // A DER-only generation panel's feeder carries a neutral exactly when the circuits landing in it
  // do: all of them pull one ⇒ it does; none does ⇒ it does not; otherwise it stays not established.
  return first.map((r, i) => {
    if (r.role !== 'generation-feeder' || specs[i].neutral !== 'not-established') return r;
    const into = first.filter(c => c.role === 'der-circuit' && c.destination.deviceId === r.source.deviceId);
    if (into.length === 0) return r;
    const resolved: RunSpec['neutral'] | null = into.every(c => c.neutral === 'required') ? 'required'
      : into.every(c => c.neutral === 'not-required') ? 'not-required' : null;
    return resolved ? engineerRun({ ...specs[i], neutral: resolved }, env) : r;
  });
}

// ─── The environment (one builder for every route) ──────────────────────────

/**
 * No facts at all: what a consumer that was handed no engineered runs uses. Every run comes back
 * NOT EVALUATED — the same runs, terminal to terminal, with nothing sized.
 */
export const NO_FACTS_RUN_ENVIRONMENT: RunEnvironment = Object.freeze({
  ambient: null,
  wiringMethod: Object.freeze({ material: null, insulation: null, insulationTempC: null, racewayType: null, source: 'not supplied' }),
  voltageDropTargetPct: null,
}) as RunEnvironment;

/**
 * 🚨 SolarPro's design basis for NEW AC conductors: copper, THWN-2 (90 °C). The same basis the PV
 * conductor schedule prints on every AC row. It is a DESIGN decision SolarPro makes as the designer
 * — not a site fact — and it is stated on every run's provenance.
 */
export const SOLARPRO_AC_CONDUCTOR_BASIS = {
  material: 'copper' as const,
  insulation: 'THWN-2',
  insulationTempC: 90 as const,
  source: 'SolarPro design basis for new AC conductors (copper THWN-2)',
};

/** The AC voltage-drop design target SolarPro's PV AC conductor sizing uses (lib/electrical-calc.ts). */
export const SOLARPRO_AC_VOLTAGE_DROP_TARGET_PCT = 2;

/**
 * Build the environment from the project's own facts. Every route calls this, so the SLD, the PDF,
 * the BOM and the permit engineer the same runs from the same inputs.
 */
export function runEnvironmentFrom(facts: {
  lat?: number | null;
  lng?: number | null;
  state?: string | null;
  address?: string | null;
  /** The project's recorded raceway type (System Config wiring method). null ⇒ not recorded. */
  racewayType?: string | null;
  runLengthsFt?: Record<string, number> | null;
  terminalFacts?: Record<string, TerminalFacts> | null;
}): RunEnvironment {
  const high = siteDesignHighC(facts);
  const lengths: Record<string, number> = {};
  for (const [k, v] of Object.entries(facts.runLengthsFt ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) lengths[k] = v;
  }
  return {
    ambient: high ? { designHighC: high.highC, source: high.source } : null,
    wiringMethod: {
      material: SOLARPRO_AC_CONDUCTOR_BASIS.material,
      insulation: SOLARPRO_AC_CONDUCTOR_BASIS.insulation,
      insulationTempC: SOLARPRO_AC_CONDUCTOR_BASIS.insulationTempC,
      racewayType: typeof facts.racewayType === 'string' && facts.racewayType.trim() ? facts.racewayType : null,
      source: SOLARPRO_AC_CONDUCTOR_BASIS.source,
    },
    voltageDropTargetPct: SOLARPRO_AC_VOLTAGE_DROP_TARGET_PCT,
    runLengthsFt: lengths,
    terminalFacts: facts.terminalFacts ?? {},
  };
}

// ─── The one wording ────────────────────────────────────────────────────────

const bare = (g: string) => g.replace(/^#/, '').replace(/\s*AWG$/, '');
const RACEWAY_ABBR: Record<string, string> = { 'PVC Sch 40': 'PVC SCH 40', 'PVC Sch 80': 'PVC SCH 80' };

/** "2 #4 CU THWN-2 + #10 EGC" / "2 #3/0 CU THWN-2 + #3/0 N + #6 EGC" — null when not engineered. */
export function runConductorText(r: EngineeredRun): string | null {
  const c = r.conductor;
  if (c.status !== 'ENGINEERED' || !c.size || r.hotCount == null) return null;
  const mat = c.material === 'copper' ? 'CU' : 'AL';
  return [
    `${r.hotCount} #${bare(c.size)} ${mat} ${c.insulation ?? ''}`.trim(),
    ...(c.neutralSize ? [`#${bare(c.neutralSize)} N`] : []),
    ...(c.egcSize ? [`#${bare(c.egcSize)} EGC`] : []),
  ].join(' + ');
}

/** '2" EMT' (+ ' · 45 FT' when the length is recorded) — null when the raceway is not engineered. */
export function runRacewayText(r: EngineeredRun): string | null {
  if (r.raceway.status !== 'ENGINEERED' || !r.raceway.type || !r.raceway.tradeSize) return null;
  const t = RACEWAY_ABBR[r.raceway.type] ?? r.raceway.type;
  return `${r.raceway.tradeSize} ${t}${r.voltageDrop.lengthFt != null ? ` · ${r.voltageDrop.lengthFt} FT` : ''}`;
}

/**
 * The callout the SLD prints along the run — the SAME words the schedule and the BOM use.
 *   engineered:      ['2 #3/0 CU THWN-2 + #3/0 N + #6 EGC', '2" EMT', '200 A OCPD']
 *   conductors only: ['2 #4 CU THWN-2 + #10 EGC', 'NEUTRAL / RACEWAY — INPUT REQUIRED', '60 A OCPD']
 *   not engineered:  ['200 A BACKUP FEEDER', 'CONDUCTORS / RACEWAY — NOT EVALUATED']
 */
/** What the raceway line says: the engineered raceway, or why it is not one yet. */
function racewayLine(r: EngineeredRun): string {
  return runRacewayText(r)
    ?? (r.conductor.status !== 'ENGINEERED' ? 'NOT EVALUATED'
      : r.neutral === 'not-established' ? 'NEUTRAL / RACEWAY — INPUT REQUIRED' : 'RACEWAY — INPUT REQUIRED');
}

export function runCallout(r: EngineeredRun): string[] {
  const conductors = runConductorText(r);
  if (!conductors) {
    return [`${r.ocpdA != null ? `${r.ocpdA} A ` : ''}${r.name}`, 'CONDUCTORS / RACEWAY — NOT EVALUATED'];
  }
  return [conductors, racewayLine(r), ...(r.ocpdA != null ? [`${r.ocpdA} A OCPD`] : [])];
}

/** The schedule's cells for this run — the callout's own words. */
export function runScheduleCells(r: EngineeredRun): { conductors: string; raceway: string } {
  return {
    conductors: runConductorText(r) ?? 'NOT EVALUATED',
    raceway: racewayLine(r),
  };
}

/**
 * The run's tag on every sheet — E-n (DER circuits), G-n (generation feeders), B-n (backup feeders),
 * F-n (service branch feeders), numbered in run order. One function, so the SLD schedule and the
 * permit schedule call a run by the same name.
 */
export function runTags(runs: readonly EngineeredRun[]): string[] {
  const prefix: Record<RunRole, string> = {
    'der-circuit': 'E', 'generation-feeder': 'G', 'backup-feeder': 'B', 'branch-feeder': 'F',
  };
  const seq: Record<string, number> = {};
  return runs.map(r => {
    const p = prefix[r.role];
    seq[p] = (seq[p] ?? 0) + 1;
    return `${p}-${seq[p]}`;
  });
}

export interface RunReadinessItem {
  key: RunMissingInput['key'];
  /** The fact needed, once. */
  need: string;
  /** The runs waiting on it. */
  runs: string[];
}

/** Readiness: every missing input across the runs, each fact once with the runs waiting on it —
 *  what blocks the conductors / raceway first, then what only voltage drop waits on. */
export function runReadiness(runs: readonly EngineeredRun[]): {
  engineered: number;
  notEvaluated: number;
  blocking: RunReadinessItem[];
  voltageDrop: RunReadinessItem[];
} {
  const group = (blocking: boolean): RunReadinessItem[] => {
    const by = new Map<string, RunReadinessItem>();
    for (const r of runs) {
      for (const m of r.missingInputs) {
        if (m.blocking !== blocking) continue;
        const k = `${m.key}\u0000${m.need}`;
        const item = by.get(k) ?? { key: m.key, need: m.need, runs: [] };
        if (!item.runs.includes(m.run)) item.runs.push(m.run);
        by.set(k, item);
      }
    }
    return [...by.values()];
  };
  return {
    engineered: runs.filter(r => r.evaluationStatus === 'ENGINEERED').length,
    notEvaluated: runs.filter(r => r.evaluationStatus !== 'ENGINEERED').length,
    blocking: group(true),
    voltageDrop: group(false),
  };
}
