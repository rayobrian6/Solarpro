/**
 * tests/support/sldVariantMatrix.ts
 *
 * EVERY ONE-LINE RAY CAN SEE, as renderer input — the matrix the legibility
 * audit (tests/support/sldGeometry.ts) runs over.
 *
 * A collision count is only as good as the sheets it was counted on. Ray's
 * report was an IQ Combiner 5C supply-side job; a fix that clears that one
 * sheet and pushes the same label onto the MSP of a backfed 6C job, or onto a
 * CT lead of a standalone gateway, is not a fix. So the matrix crosses what
 * changes the drawing:
 *
 *   · Enphase micro: IQ Combiner 5C / 6C / 4C / standalone IQ Gateway
 *     × LOAD_SIDE / SUPPLY_SIDE_TAP / MAIN_BREAKER_DERATE (backfed)
 *     × every consumption-CT location that composes for that interconnection
 *       (the same list tests/sldStandaloneGatewayAndCtLeads.test.ts crosses)
 *   · 1, 3 and 5 branches; with and without IQ Battery 5P + IQ System Controller 3
 *   · SolarEdge SE7600H + optimizers; a plain string inverter (Fronius Primo)
 *   · hybrid multi-lane: roof Enphase micro + ground SolarEdge string, and the
 *     three-lane roof/ground/fence shape (tests/goldens/wave5a-sld.test.ts)
 *   · the permit path itself: buildSLDInputFromPermit on the roof / ground /
 *     fence fixtures (the ctPlacementReachesEveryArtefact job).
 *
 * …in BOTH render modes that print: 'sheet' is the Diagram tab and the SLD PDF
 * export (the full 24×18 sheet — title block and schedule band); 'e1' is the
 * permit E-1 embed, built exactly as generateLiveSLD(…, { embedded: true,
 * topologyOnly: true }) builds it; 'e11' is E-1.1 (schedules only).
 *
 * The inputs are made by the REAL composers, mirroring the Diagram route
 * (app/api/engineering/sld/route.ts): computeSystem → buildPermitSystemModel
 * for runs, branches, OCPDs and gauges; sldCombinerFields for the combiner;
 * resolveDesignMetering (the ONE metering composer) for the CTs and their
 * leads; hybridLaneMetering for the hybrid lanes' CTs where that composer
 * exists. Nothing here composes metering or picks a device on its own.
 */

import { renderSLDProfessional, type SLDProfessionalInput, type SLDSourceBranch } from '@/lib/sld-professional-renderer';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { buildPermitSystemModel } from '@/lib/plan-set/permit-system-model';
import * as combinerFields from '@/lib/equipment/sldCombinerFields';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import type { ConsumptionCtLocation } from '@/lib/equipment/currentTransformers';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '@/test-fixtures/roofProject';
import { groundProject } from '@/test-fixtures/groundProject';
import { fenceProject } from '@/test-fixtures/fenceProject';

export type SldRenderMode = 'sheet' | 'e1' | 'e11';
export type SldFamily = 'micro' | 'string' | 'optimizer' | 'hybrid' | 'permit';

export interface SldVariant {
  /** File-safe, stable: the baseline in tests/sldLegibility.test.ts is keyed by it. */
  id: string;
  family: SldFamily;
  mode: SldRenderMode;
  title: string;
  /** The renderer input BEFORE the mode flags (see applyRenderMode). */
  build: () => SLDProfessionalInput;
}

/**
 * The permit's embed flags, exactly as lib/permit/utils/sldAdapter.ts
 * generateLiveSLD sets them — E-1 is { embedded, topologyOnly }, E-1.1 is
 * { embedded, schedulesOnly }. tests/sldLegibility.test.ts proves this mirror
 * against generateLiveSLD itself on the permit fixtures.
 */
export function applyRenderMode(input: SLDProfessionalInput, mode: SldRenderMode): SLDProfessionalInput {
  if (mode === 'sheet') return input;
  const out: SLDProfessionalInput = { ...input, suppressTitleBlock: true, suppressScheduleBand: true };
  if (mode === 'e1') out.suppressCalcBand = true;
  else {
    out.schedulesOnly = true;
    out.calcBandStacked = true;
    out.suppressCalcBand = false;
    out.suppressScheduleBand = true;
  }
  return out;
}

/** The finished SVG the audit reads (renderSLDProfessional applies the type floor). */
export function renderSldVariant(v: SldVariant): string {
  return renderSLDProfessional(applyRenderMode(v.build(), v.mode));
}

// ── The two interconnection spellings a renderer is handed ──────────────────
/** app/api/engineering/sld/route.ts and …/sld/pdf/route.ts (identical maps):
 *  a derate or panel upgrade draws the load-side MSP on those sheets. */
export function sheetInterconnection(raw: string): string {
  const l = raw.toLowerCase();
  if (raw === 'LOAD_SIDE' || l.includes('load')) return 'Load Side Tap';
  if (raw === 'SUPPLY_SIDE_TAP' || l.includes('supply')) return 'Supply Side Tap';
  if (raw === 'MAIN_BREAKER_DERATE' || l.includes('derate')) return 'Load Side Tap';
  if (raw === 'PANEL_UPGRADE' || l.includes('upgrade')) return 'Load Side Tap';
  if (l.includes('line')) return 'Line Side Tap';
  return raw;
}
/** lib/permit/utils/sldAdapter.ts: a derate keeps its own token, which the
 *  renderer draws as the backfed-breaker MSP. Only E-1 prints that MSP. */
export function permitInterconnection(raw: string): string {
  if (raw === 'SUPPLY_SIDE_TAP') return 'Supply Side Tap';
  if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap';
  return raw;
}

// ── Shared project furniture ─────────────────────────────────────────────────
const PROJECT = {
  projectName: 'Legibility Audit', clientName: 'Jane Homeowner', address: '1 Test St, Pocahontas, IL 62275',
  designer: 'SolarPro Engineering', drawingDate: '2026-09-26', drawingNumber: 'SLD-001', revision: 'A',
  scale: 'NOT TO SCALE', mainPanelAmps: 200, panelBusRating: 200, utilityName: 'Ameren Illinois',
  hasProductionMeter: true, acWireLength: 50, designTempMin: -20,
};
const PANEL = {
  panelModel: 'Q.PEAK DUO BLK ML-G10+ 400W', panelManufacturer: 'Q CELLS',
  panelWatts: 400, panelVoc: 45.3, panelIsc: 11.14, panelVmp: 37.13, panelImp: 10.77,
};

/** computeSystem's input as the Diagram route fills it (its defaults kept). */
function csInput(o: Partial<ComputedSystemInput> & Pick<ComputedSystemInput, 'topology' | 'totalPanels'
  | 'inverterManufacturer' | 'inverterModel' | 'inverterAcKw' | 'inverterAcCurrentMax' | 'interconnectionMethod'>): ComputedSystemInput {
  return {
    panelWatts: PANEL.panelWatts, panelVoc: PANEL.panelVoc, panelIsc: PANEL.panelIsc, panelVmp: PANEL.panelVmp,
    panelImp: PANEL.panelImp, panelTempCoeffVoc: -0.27, panelTempCoeffIsc: 0.05, panelMaxSeriesFuse: 20,
    panelModel: PANEL.panelModel, panelManufacturer: PANEL.panelManufacturer,
    inverterMaxDcV: 600, inverterMpptVmin: 100, inverterMpptVmax: 600, inverterMaxInputCurrentPerMppt: 15,
    inverterMpptChannels: 2, inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: PROJECT.designTempMin, ambientTempC: 30, rooftopTempAdderC: 30, runLengths: {},
    conduitType: 'EMT', mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200,
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
    ...o,
  } as ComputedSystemInput;
}
function engine(input: ComputedSystemInput, raw: string) {
  const cs = computeSystem(input);
  const model = buildPermitSystemModel(cs, {
    mainPanelBusAmps: 200, mainPanelBreakerAmps: 200,
    interconnectionMethod: raw === 'SUPPLY_SIDE_TAP' ? 'supply-side' : 'load-side',
    dcConduitType: 'EMT', acConduitType: 'EMT',
  });
  return { cs, model };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENPHASE MICRO — the Diagram route's single-lane path
// ═══════════════════════════════════════════════════════════════════════════
export const COMBINERS = {
  '5c': 'enphase-iq-combiner-5c',
  '6c': 'enphase-iq-combiner-6c',
  '4c': 'enphase-iq-combiner-4c',
  gw: 'enphase-iq-gateway-standalone',
} as const;
export type CombinerKey = keyof typeof COMBINERS;
export type Interconnection = 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE';

/**
 * The consumption-CT locations that compose for each interconnection — null is
 * "no record" (the interconnection default). 'between-tap-and-main' on a job
 * with no tap refuses and draws nothing, so it is not a drawing to audit.
 * SUPPLY_SIDE_TAP × 'sec-line-side-of-main' is mode-indeterminate but drawn.
 */
export const CT_LOCATIONS: Record<Interconnection, Array<ConsumptionCtLocation | null>> = {
  LOAD_SIDE: [null, 'main-breaker-load-side'],
  SUPPLY_SIDE_TAP: [null, 'main-breaker-load-side', 'sec-line-side-of-main'],
  MAIN_BREAKER_DERATE: [null, 'main-breaker-load-side'],
};
/** 1 branch of 11; 3 of 11/11/10 (Ray's screenshot); 5 of 12/12/12/11/11. */
const DEVICES_FOR_BRANCHES: Record<number, number> = { 1: 11, 3: 32, 5: 58 };
const IQ8PLUS = { inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', kw: 0.29, amps: 1.21 };

export interface MicroOptions {
  combiner: CombinerKey;
  interconnection: Interconnection;
  ct: ConsumptionCtLocation | null;
  branches: 1 | 3 | 5;
  battery?: boolean;
  mode: SldRenderMode;
}

export function microInput(o: MicroOptions): SLDProfessionalInput {
  const n = DEVICES_FOR_BRANCHES[o.branches];
  const bat = o.battery
    ? { batteryIds: ['enphase-iq-battery-5p'], batteryBackfeedA: 20, batteryContinuousOutputA: 16, backupInterfaceMaxA: 64, hasEnphaseIQSC3: true }
    : {};
  const { cs, model } = engine(csInput({
    topology: 'micro', totalPanels: n, inverterManufacturer: IQ8PLUS.inverterManufacturer, inverterModel: IQ8PLUS.inverterModel,
    inverterAcKw: IQ8PLUS.kw, inverterAcCurrentMax: IQ8PLUS.amps, inverterMaxDcV: 60, inverterMpptVmin: 27, inverterMpptVmax: 45,
    inverterMaxInputCurrentPerMppt: 14, inverterMpptChannels: 1, inverterBranchLimit: 13,
    interconnectionMethod: o.interconnection, branchCount: o.branches, ...bat,
  }), o.interconnection);
  const f = combinerFields.sldCombinerFields({
    inverterManufacturer: IQ8PLUS.inverterManufacturer, inverterModel: IQ8PLUS.inverterModel, inverterId: IQ8PLUS.inverterId,
    isMicro: true, totalDevices: n, branchCount: o.branches, hasBattery: !!o.battery,
    selectedCombinerId: COMBINERS[o.combiner], interconnectionRaw: o.interconnection,
    consumptionCtLocation: o.ct,
  });
  // The route composes metering from the resolved plan with the service voltage
  // (route.ts, the single-lane `resolveDesignMetering` call) — the same composer.
  const met = resolveDesignMetering({
    plan: f.plan, interconnectionRaw: o.interconnection, consumptionCtLocation: o.ct, systemVoltage: 240,
  });
  return {
    ...PROJECT,
    topologyType: 'MICROINVERTER', totalModules: n, totalStrings: 0,
    panelModel: PANEL.panelModel, panelWatts: PANEL.panelWatts, panelVoc: PANEL.panelVoc, panelIsc: PANEL.panelIsc,
    dcWireGauge: model.dcWireGauge, dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: IQ8PLUS.inverterModel, inverterManufacturer: IQ8PLUS.inverterManufacturer,
    acOutputKw: +(n * IQ8PLUS.kw).toFixed(2), acOutputAmps: +(n * IQ8PLUS.amps).toFixed(1),
    acWireGauge: model.acWireGauge, acConduitType: 'EMT', acOCPD: model.acOcpdAmps, backfeedAmps: model.backfeedBreakerAmps,
    interconnection: o.mode === 'sheet' ? sheetInterconnection(o.interconnection) : permitInterconnection(o.interconnection),
    rapidShutdownIntegrated: true,
    hasBattery: !!o.battery,
    batteryModel: o.battery ? 'IQ Battery 5P' : '', batteryKwh: o.battery ? 10 : 0,
    ...(o.battery ? {
      batteryBrand: 'Enphase', batteryCount: 2, batteryBackfeedA: 20,
      backupInterfaceId: 'enphase-iq-system-controller-3', backupInterfaceBrand: 'Enphase',
      backupInterfaceModel: 'IQ System Controller 3', hasEnphaseIQSC3: true,
    } : {}),
    deviceCount: n, microBranches: cs.microBranches, runs: cs.runs,
    panelsPerString: 1, lastStringPanels: 1, mpptChannels: n, mpptAllocation: `${n} microinverters`, combinerType: 'DIRECT',
    combinerLabel: f.combinerLabel, combinerModel: f.combinerModel,
    combinerHasIntegratedGateway: f.combinerHasIntegratedGateway,
    combinerProvidesAcDisconnect: f.combinerProvidesAcDisconnect,
    combinerSelectionIsDecided: f.combinerSelectionIsDecided,
    ...(f.standaloneGateway ? { standaloneGateway: f.standaloneGateway } : {}),
    meteringChannels: met.scheduleValue, meteringDrawing: met.drawing ?? undefined,
    ocpdPerString: 0, systemModel: model, egcGauge: model.egcGauge,
    selectedBrand: 'enphase', ecosystemTopology: 'micro', integratedDcDisconnect: false,
  } as SLDProfessionalInput;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRING / OPTIMIZER — the same route, the string path
// ═══════════════════════════════════════════════════════════════════════════
export function solarEdgeInput(interconnection: Interconnection, mode: SldRenderMode): SLDProfessionalInput {
  const { cs, model } = engine(csInput({
    topology: 'optimizer', totalPanels: 20, totalStrings: 2, optimizerMaxOutputCurrent: 15,
    inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', inverterAcKw: 7.6, inverterAcCurrentMax: 32,
    inverterMaxDcV: 480, inverterMpptVmin: 200, inverterMpptVmax: 480, inverterMaxInputCurrentPerMppt: 20,
    inverterMpptChannels: 1, interconnectionMethod: interconnection,
  }), interconnection);
  return {
    ...PROJECT,
    topologyType: 'STRING_WITH_OPTIMIZER', totalModules: 20, totalStrings: 2,
    panelModel: PANEL.panelModel, panelWatts: PANEL.panelWatts, panelVoc: PANEL.panelVoc, panelIsc: PANEL.panelIsc,
    dcWireGauge: model.dcWireGauge, dcConduitType: 'EMT', dcOCPD: model.stringOcpdAmps,
    inverterModel: 'SE7600H-US', inverterManufacturer: 'SolarEdge', acOutputKw: 7.6, acOutputAmps: 32,
    acWireGauge: model.acWireGauge, acConduitType: 'EMT', acOCPD: model.acOcpdAmps, backfeedAmps: model.backfeedBreakerAmps,
    interconnection: mode === 'sheet' ? sheetInterconnection(interconnection) : permitInterconnection(interconnection),
    rapidShutdownIntegrated: true, hasBattery: false, batteryModel: '', batteryKwh: 0,
    runs: cs.runs, panelsPerString: 10, lastStringPanels: 10, mpptChannels: 1, mpptAllocation: '2 strings on 1 input',
    stringVoc: model.stringVoc, stringIsc: model.stringIsc, ocpdPerString: model.stringOcpdAmps,
    systemModel: model, egcGauge: model.egcGauge,
    selectedBrand: 'solaredge', ecosystemTopology: 'optimizer', optimizerQty: 20, optimizerModel: 'S440',
    integratedDcDisconnect: true,
  } as SLDProfessionalInput;
}

export function stringInverterInput(interconnection: Interconnection, mode: SldRenderMode): SLDProfessionalInput {
  const { cs, model } = engine(csInput({
    topology: 'string', totalPanels: 20, totalStrings: 2,
    inverterManufacturer: 'Fronius', inverterModel: 'Primo 7.6-1', inverterAcKw: 7.6, inverterAcCurrentMax: 31.7,
    inverterMaxDcV: 600, inverterMpptVmin: 80, inverterMpptVmax: 480, inverterMaxInputCurrentPerMppt: 18,
    inverterMpptChannels: 2, interconnectionMethod: interconnection,
  }), interconnection);
  return {
    ...PROJECT,
    topologyType: 'STRING_INVERTER', totalModules: 20, totalStrings: 2,
    panelModel: PANEL.panelModel, panelWatts: PANEL.panelWatts, panelVoc: PANEL.panelVoc, panelIsc: PANEL.panelIsc,
    dcWireGauge: model.dcWireGauge, dcConduitType: 'EMT', dcOCPD: model.stringOcpdAmps,
    inverterModel: 'Primo 7.6-1', inverterManufacturer: 'Fronius', acOutputKw: 7.6, acOutputAmps: 31.7,
    acWireGauge: model.acWireGauge, acConduitType: 'EMT', acOCPD: model.acOcpdAmps, backfeedAmps: model.backfeedBreakerAmps,
    interconnection: mode === 'sheet' ? sheetInterconnection(interconnection) : permitInterconnection(interconnection),
    rapidShutdownIntegrated: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
    runs: cs.runs, panelsPerString: 10, lastStringPanels: 10, mpptChannels: 2, mpptAllocation: '1 string per MPPT',
    stringVoc: model.stringVoc, stringIsc: model.stringIsc, ocpdPerString: model.stringOcpdAmps,
    systemModel: model, egcGauge: model.egcGauge,
    selectedBrand: 'fronius', ecosystemTopology: 'string', integratedDcDisconnect: false,
  } as SLDProfessionalInput;
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID MULTI-LANE — the Diagram route's `sources` branch
// ═══════════════════════════════════════════════════════════════════════════
/** Roof Enphase micro + ground SolarEdge string — tests/combinerSelectionPropagation.test.ts's body. */
const TWO_LANES = (): SLDSourceBranch[] => [
  {
    key: 'roof', topologyType: 'MICROINVERTER', inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
    totalModules: 12, deviceCount: 12, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
    acOutputKw: 3.84, acOutputAmps: 16, backfeedAmps: 20, acOCPD: 20,
    microBranches: [{ ocpdAmps: 20, branchCurrentA: 12.8, deviceCount: 12 }],
  } as unknown as SLDSourceBranch,
  {
    key: 'ground', topologyType: 'STRING_INVERTER', inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H',
    totalModules: 20, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9, totalStrings: 2,
    acOutputKw: 7.6, acOutputAmps: 32, backfeedAmps: 40, acOCPD: 40,
  } as unknown as SLDSourceBranch,
];
/** Roof micro + ground string + SolFence — tests/goldens/wave5a-sld.test.ts's I-3 shape. */
const THREE_LANES = (): SLDSourceBranch[] => [
  {
    key: 'roof', label: 'ROOF — 48 × Maxeon 6 400W', topologyType: 'MICROINVERTER', systemType: 'roof',
    totalModules: 48, panelModel: 'Maxeon 6 400W', panelWatts: 400, panelVoc: 42.1, panelIsc: 12.1,
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', acKwPerDevice: 0.33, acOutputKw: 15.84, acOutputAmps: 66,
    acWireGauge: '#4 AWG', acConduitType: 'EMT', acOCPD: 90, backfeedAmps: 90, deviceCount: 48, rapidShutdownIntegrated: true,
    microBranches: [
      { branchIndex: 1, deviceCount: 13, branchCurrentA: 17.9, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
      { branchIndex: 2, deviceCount: 13, branchCurrentA: 17.9, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
      { branchIndex: 3, deviceCount: 12, branchCurrentA: 16.5, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
      { branchIndex: 4, deviceCount: 10, branchCurrentA: 13.8, ocpdAmps: 20, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
    ],
  },
  {
    key: 'ground', label: 'GROUND — 20 × Tesla TSP-420', topologyType: 'STRING_INVERTER', systemType: 'ground',
    totalModules: 20, totalStrings: 2, panelsPerString: 10, panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92,
    panelIsc: 13.03, inverterManufacturer: 'Solis', inverterModel: 'S6-GR1P6K', inverterCount: 1, acOutputKw: 6.0,
    acOutputAmps: 25, acWireGauge: '#8 AWG', acConduitType: 'PVC Sch 40', acOCPD: 35, backfeedAmps: 35, dcOCPD: 20,
  },
  {
    key: 'fence', label: 'FENCE — 17 × SolFence SF-BIF-400', topologyType: 'STRING_WITH_OPTIMIZER', systemType: 'fence',
    totalModules: 17, totalStrings: 1, panelsPerString: 17, panelModel: 'SolFence SF-BIF-400', panelWatts: 400,
    panelVoc: 37.1, panelIsc: 13.6, inverterManufacturer: 'SolFence', inverterModel: 'SF-OPT-3800', inverterCount: 1,
    acOutputKw: 3.8, acOutputAmps: 15.8, acWireGauge: '#10 AWG', acConduitType: 'PVC Sch 40', acOCPD: 20, backfeedAmps: 20,
    integratedDcDisconnect: true, optimizerQty: 17, optimizerModel: 'SF-OPT',
  },
];

type HybridMeteringFn = (i: {
  lanes: readonly SLDSourceBranch[]; selectedCombinerId?: string | null; interconnectionRaw: string | null;
  consumptionCtLocation?: string | null; systemVoltage?: number | null;
}) => { lanes: SLDSourceBranch[] };

/**
 * The lanes as the hybrid route hands them to the renderer. When the hybrid
 * metering composer exists (sldCombinerFields `hybridLaneMetering` — the CTs
 * on hybrid SLDs, Ray 2026-09-26) the route passes ITS lanes, CTs attached, and
 * so does this; until then the lanes go through bare, exactly as the route did.
 * Looked up by name so this matrix never has to change when it lands.
 */
export function hybridLanes(lanes: SLDSourceBranch[], selectedCombinerId: string | null, interconnection: Interconnection): SLDSourceBranch[] {
  const fn = (combinerFields as unknown as Record<string, unknown>).hybridLaneMetering as HybridMeteringFn | undefined;
  if (typeof fn !== 'function') return lanes;
  return fn({ lanes, selectedCombinerId, interconnectionRaw: interconnection, consumptionCtLocation: null, systemVoltage: 240 }).lanes;
}
export const hybridMeteringComposerPresent = (): boolean =>
  typeof (combinerFields as unknown as Record<string, unknown>).hybridLaneMetering === 'function';

export function hybridInput(o: { lanes: 'two' | 'three'; selected: CombinerKey | null; interconnection: Interconnection;
  battery?: boolean; mode: SldRenderMode }): SLDProfessionalInput {
  const raw = o.lanes === 'two' ? TWO_LANES() : THREE_LANES();
  const selectedCombinerId = o.selected ? COMBINERS[o.selected] : null;
  const sources = hybridLanes(raw, selectedCombinerId, o.interconnection);
  const sumBackfeed = sources.reduce((s, b) => s + (b.backfeedAmps ?? b.acOCPD ?? 0), 0);
  // route.ts `_mlInput`, field for field, with the page's usual body values.
  return {
    ...PROJECT,
    topologyType: 'HYBRID_MULTI_SOURCE', selectedCombinerId,
    totalModules: sources.reduce((s, b) => s + (b.totalModules ?? 0), 0), totalStrings: 0,
    panelModel: sources[0].panelModel ?? 'PV Module', panelWatts: sources[0].panelWatts ?? 400,
    panelVoc: sources[0].panelVoc ?? 0, panelIsc: sources[0].panelIsc ?? 0,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: sources[0].inverterModel ?? 'Inverter', inverterManufacturer: sources[0].inverterManufacturer ?? '',
    acOutputKw: sources.reduce((s, b) => s + (b.acOutputKw ?? 0), 0),
    acOutputAmps: Math.round(sources.reduce((s, b) => s + (b.acOutputAmps ?? 0), 0)),
    acWireGauge: '#6 AWG', acConduitType: 'EMT', acOCPD: sumBackfeed, backfeedAmps: sumBackfeed,
    panelBusRating: o.lanes === 'three' ? 225 : 200,
    interconnection: o.interconnection,
    rapidShutdownIntegrated: true,
    hasBattery: !!o.battery, batteryModel: o.battery ? 'IQ Battery 5P' : '', batteryKwh: o.battery ? 10 : 0,
    ...(o.battery ? { batteryBrand: 'Enphase', batteryCount: 2, batteryBackfeedA: 20,
      backupInterfaceBrand: 'Enphase', backupInterfaceModel: 'IQ System Controller 3' } : {}),
    sources,
  } as SLDProfessionalInput;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PERMIT PATH — buildSLDInputFromPermit on the shipped fixtures
// ═══════════════════════════════════════════════════════════════════════════
const ROOF_CAD = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
/** The roof fixture as tests/ctPlacementReachesEveryArtefact.test.ts's `job()` builds it. */
export function roofPermitJob(combiner: CombinerKey, interconnection: Interconnection) {
  const p = clone(roofProject) as typeof roofProject & { project: Record<string, unknown> };
  p.project.selectedCombinerId = COMBINERS[combiner];
  p.project.interconnectionMethod = interconnection;
  return p;
}
export function permitCase(which: 'roof' | 'ground' | 'fence', combiner: CombinerKey = '5c',
  interconnection: Interconnection = 'SUPPLY_SIDE_TAP'): { input: typeof roofProject; cad: CADModel } {
  if (which === 'roof') return { input: roofPermitJob(combiner, interconnection), cad: ROOF_CAD };
  const fx = which === 'ground' ? groundProject : fenceProject;
  return { input: clone(fx), cad: generateCADLayout(fx as never) };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MATRIX
// ═══════════════════════════════════════════════════════════════════════════
const IC_CODE: Record<Interconnection, string> = { LOAD_SIDE: 'load', SUPPLY_SIDE_TAP: 'tap', MAIN_BREAKER_DERATE: 'derate' };
const CT_CODE = (ct: ConsumptionCtLocation | null): string =>
  ct === null ? 'dflt' : ct === 'main-breaker-load-side' ? 'mbl' : ct === 'sec-line-side-of-main' ? 'sec' : 'btm';
const COMBINER_NAME: Record<CombinerKey, string> = {
  '5c': 'IQ Combiner 5C', '6c': 'IQ Combiner 6C', '4c': 'IQ Combiner 4C', gw: 'IQ Gateway (standalone) + PV AC panel',
};
const MODES: SldRenderMode[] = ['sheet', 'e1'];

export function buildSldVariantMatrix(): SldVariant[] {
  const out: SldVariant[] = [];
  const micro = (o: Omit<MicroOptions, 'mode'>, tag = '') => {
    for (const mode of MODES) {
      out.push({
        id: `micro-${o.combiner}-${IC_CODE[o.interconnection]}-${CT_CODE(o.ct)}-${o.branches}br${o.battery ? '-bat' : ''}-${mode}`,
        family: 'micro', mode,
        title: `Enphase IQ8+ ×${DEVICES_FOR_BRANCHES[o.branches]} (${o.branches} br) · ${COMBINER_NAME[o.combiner]} · `
          + `${o.interconnection} · CTs ${o.ct ?? 'default'}${o.battery ? ' · IQ Battery 5P ×2 + IQ SC3' : ''}${tag}`,
        build: () => microInput({ ...o, mode }),
      });
    }
  };
  // 1. Every combiner × every interconnection × every CT location (3 branches).
  for (const combiner of Object.keys(COMBINERS) as CombinerKey[]) {
    for (const ic of Object.keys(CT_LOCATIONS) as Interconnection[]) {
      for (const ct of CT_LOCATIONS[ic]) {
        const ray = combiner === '5c' && ic === 'SUPPLY_SIDE_TAP' && ct === null ? ' · RAY\'S REPORTED JOB' : '';
        micro({ combiner, interconnection: ic, ct, branches: 3 }, ray);
      }
    }
  }
  // 2. Branch count sweep.
  for (const branches of [1, 5] as const) {
    for (const combiner of ['5c', 'gw'] as CombinerKey[]) {
      for (const ic of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP'] as Interconnection[]) micro({ combiner, interconnection: ic, ct: null, branches });
    }
  }
  // 3. Battery + backup interface.
  for (const combiner of ['5c', 'gw'] as CombinerKey[]) {
    for (const ic of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP'] as Interconnection[]) micro({ combiner, interconnection: ic, ct: null, branches: 3, battery: true });
  }
  // 4. String and optimizer jobs.
  for (const mode of MODES) {
    for (const ic of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP'] as Interconnection[]) {
      out.push({ id: `optimizer-se7600h-${IC_CODE[ic]}-${mode}`, family: 'optimizer', mode,
        title: `SolarEdge SE7600H-US + 20 × S440 · 2 strings · ${ic}`, build: () => solarEdgeInput(ic, mode) });
    }
    out.push({ id: `string-primo-load-${mode}`, family: 'string', mode,
      title: 'Fronius Primo 7.6-1 · 2 strings × 10 · external DC disconnect · LOAD_SIDE', build: () => stringInverterInput('LOAD_SIDE', mode) });
  }
  // 5. Hybrid multi-lane.
  const hybrid = (lanes: 'two' | 'three', selected: CombinerKey | null, ic: Interconnection, battery = false) => {
    for (const mode of MODES) {
      out.push({
        id: `hybrid-${lanes === 'two' ? '2lane' : '3lane'}-${selected ?? 'paired'}-${IC_CODE[ic]}${battery ? '-bat' : ''}-${mode}`,
        family: 'hybrid', mode,
        title: `Hybrid ${lanes === 'two' ? 'roof IQ8M micro + ground SE7600H' : 'roof IQ8M + ground Solis + SolFence'} · `
          + `${selected ? COMBINER_NAME[selected] : 'combiner by pairing'} · ${ic}${battery ? ' · IQ Battery 5P ×2 + IQ SC3' : ''}`,
        build: () => hybridInput({ lanes, selected, interconnection: ic, battery, mode }),
      });
    }
  };
  for (const selected of [null, 'gw'] as Array<CombinerKey | null>) {
    for (const ic of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP'] as Interconnection[]) hybrid('two', selected, ic);
  }
  hybrid('two', null, 'LOAD_SIDE', true);
  hybrid('three', null, 'LOAD_SIDE');
  // 6. The permit path, through buildSLDInputFromPermit.
  const permit = (id: string, title: string, mode: SldRenderMode, which: 'roof' | 'ground' | 'fence',
    combiner: CombinerKey = '5c', ic: Interconnection = 'SUPPLY_SIDE_TAP') => out.push({
    id: `permit-${id}-${mode}`, family: 'permit', mode, title: `PERMIT ${mode === 'e11' ? 'E-1.1' : 'E-1'} · ${title}`,
    build: () => { const c = permitCase(which, combiner, ic); return buildSLDInputFromPermit(c.input as never, c.cad); },
  });
  permit('roof-5c-tap', 'roofProject · IQ Combiner 5C · SUPPLY_SIDE_TAP', 'e1', 'roof', '5c', 'SUPPLY_SIDE_TAP');
  permit('roof-5c-tap', 'roofProject · IQ Combiner 5C · SUPPLY_SIDE_TAP', 'e11', 'roof', '5c', 'SUPPLY_SIDE_TAP');
  permit('roof-gw-load', 'roofProject · IQ Gateway (standalone) · LOAD_SIDE', 'e1', 'roof', 'gw', 'LOAD_SIDE');
  permit('roof-6c-derate', 'roofProject · IQ Combiner 6C · MAIN_BREAKER_DERATE (backfed MSP)', 'e1', 'roof', '6c', 'MAIN_BREAKER_DERATE');
  permit('ground', 'groundProject · SolarEdge SE7600H string', 'e1', 'ground');
  permit('fence', 'fenceProject · Enphase IQ8A SolFence', 'e1', 'fence');
  return out;
}
