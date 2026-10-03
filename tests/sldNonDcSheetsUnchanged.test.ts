// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE COMPACT DC-COUPLED LAYOUT MOVES ONE KIND OF SHEET, AND ONLY THAT ONE.
//
// Ray, on the live 400 A sheet: "much better architecturally but too spread out and visually
// primitive on the storage side... Do not leave huge whitespace because an inverter block was
// removed." The repair is a different arrangement for a DC-COUPLED service graph that has backup
// domains — PV on top, the systems side by side, converging on the service. Every other sheet the
// renderer draws (micro, string, legacy battery, AC-coupled graphs, the hybrid multi-lane sheet,
// a DC graph with no domain, the schedules-only E-1.1) was already accepted as it is, and a layout
// change that leaks into them is a regression on sheets nobody asked to change.
//
// So each of them is pinned BYTE FOR BYTE to what the renderer produced on the commit before the
// compact layout existed (85535c6). A hash per sheet, not a structural marker: "byte-identical" is
// the claim, and a marker test would let a 2 uu shift through.
//
// The build badge comment is stripped first — it is a version string, not drawing — so bumping
// BUILD_VERSION does not read as a layout change.
//
// IF THIS FAILS after a DELIBERATE change to one of these sheets, regenerate the baseline with
//     SLD_NON_DC_BASELINE=write npx vitest run tests/sldNonDcSheetsUnchanged.test.ts
// and say in the commit which sheet changed and why. If it fails after a change that was meant to
// touch only the DC-coupled compact layout, the gate leaked — fix the gate, not the baseline.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import { removeBackupDomain } from '@/lib/electrical/topologyAuthoring';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const BASELINE = path.join(__dirname, 'goldens', 'sld-non-dc-sheets.sha256.json');
const WRITE = process.env.SLD_NON_DC_BASELINE === 'write';

const BASE = {
  projectName: 'NON-DC SHEET', clientName: 'Golden', address: '1 Golden Way, Chicago IL',
  designer: 'SolarPro', drawingDate: '2026-10-03', drawingNumber: 'E-1', revision: 'A',
  scale: 'NOT TO SCALE',
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT',
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const MICRO = {
  ...BASE,
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
  dcOCPD: 0, inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
  acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
};
const STRING = {
  ...BASE,
  topologyType: 'STRING_INVERTER', ecosystemTopology: 'string', selectedBrand: 'fronius',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 2, deviceCount: 2,
  dcOCPD: 20, inverterModel: 'Primo 8.2-1', inverterManufacturer: 'Fronius',
  acOutputKw: 7.6, acOutputAmps: 31.7, acWireGauge: '#8', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: false,
};
const STRING_INTEGRATED = { ...STRING, integratedDcDisconnect: true };
const E1 = { suppressTitleBlock: true, suppressScheduleBand: true, suppressCalcBand: true };
const E11 = {
  suppressTitleBlock: true, suppressScheduleBand: true, schedulesOnly: true,
  calcBandStacked: true, suppressCalcBand: false,
};
const LEGACY_BATTERY = {
  hasBattery: true, batteryModel: 'IQ Battery 5P', batteryKwh: 10, batteryBrand: 'Enphase',
  batteryBackfeedA: 40, backupInterfaceBrand: 'Enphase', backupInterfaceModel: 'IQ System Controller 3',
  hasBackupPanel: true, backupPanelAmps: 100,
};
const TWO_GATEWAYS = {
  gateways: [
    { id: 'gw-1', label: 'Gateway 1', branches: [{ ocpdA: 20, deviceCount: 15 }] },
    { id: 'gw-2', label: 'Gateway 2', branches: [{ ocpdA: 20, deviceCount: 15 }] },
  ],
};

/** A DC-coupled graph with no backup domain at all — outside the compact layout's gate. */
const dcWithoutDomains = (): ServiceTopology => {
  const t = buildNormalResidence200A().topology;
  return removeBackupDomain(t, t.domains[0].id);
};

/**
 * Ray's job with each generation panel's `domainId` removed: the panels become a SITE-WIDE DER group,
 * which the compact layout does not draw — that sheet keeps the column layout and its shared chain.
 */
const sharedGenerationPanels = (): ServiceTopology => {
  const t = buildRaysIntendedJob().topology;
  return {
    ...t,
    aggregationPanels: (t.aggregationPanels ?? []).map(({ domainId: _drop, ...a }) => a),
  } as ServiceTopology;
};

const SHEETS: Array<[string, () => Record<string, unknown>]> = [
  // ── no service graph: the legacy single-service sheets ──
  ['micro / no graph / sheet', () => ({ ...MICRO })],
  ['micro / no graph / E-1', () => ({ ...MICRO, ...E1 })],
  ['micro + legacy battery / no graph / sheet', () => ({ ...MICRO, ...LEGACY_BATTERY })],
  ['string ext DC disco / no graph / sheet', () => ({ ...STRING })],
  ['string integrated DC disco / no graph / sheet', () => ({ ...STRING_INTEGRATED })],
  ['micro two gateways (multi-source) / no graph', () => ({ ...MICRO, ...TWO_GATEWAYS })],
  // ── an AC-coupled (or uncoupled) service graph: the column layout, not the compact one ──
  ['Ray 400 A AC-coupled / micro sheet',
    () => ({ ...MICRO, serviceTopology: buildRaysIntendedJob({ solarCoupling: 'ac-coupled-inverter' }).topology })],
  ['Ray 400 A AC-coupled / string ext sheet',
    () => ({ ...STRING, serviceTopology: buildRaysIntendedJob({ solarCoupling: 'ac-coupled-inverter' }).topology })],
  ['Ray 400 A AC-coupled / string integrated / E-1',
    () => ({ ...STRING_INTEGRATED, ...E1, serviceTopology: buildRaysIntendedJob({ solarCoupling: 'ac-coupled-inverter' }).topology })],
  ['Tesla 400 A two gateway, coupling unrecorded, expansions',
    () => ({ ...MICRO, serviceTopology: buildTesla400ATwoGateway().topology })],
  ['normal 200 A residence AC-coupled, 1 PW3',
    () => ({ ...MICRO, serviceTopology: buildNormalResidence200A({ solarCoupling: 'ac-coupled-inverter' }).topology })],
  ['normal 200 A residence AC-coupled, 2 PW3 / string',
    () => ({ ...STRING, serviceTopology: buildNormalResidence200A({ powerwalls: 2, solarCoupling: 'ac-coupled-inverter' }).topology })],
  // ── DC-coupled, but not the compact layout's shape or not a drawn topology ──
  ['DC-coupled graph with NO domain', () => ({ ...MICRO, serviceTopology: dcWithoutDomains() })],
  ['Tesla 400 A DC-coupled, ONE common DER aggregation panel (site-wide group)',
    () => ({ ...MICRO, serviceTopology: buildTesla400ATwoGateway({
      derArrangement: 'common-aggregation', solarCoupling: 'dc-coupled-storage',
      aggregationOutputOcpdA: 125, aggregationBusbarA: 225,
    }).topology })],
  ['Ray 400 A DC-coupled, generation panels detached from their systems (site-wide group)',
    () => ({ ...MICRO, serviceTopology: sharedGenerationPanels() })],
  ['Ray 400 A DC-coupled / multi-source sheet (two gateways)',
    () => ({ ...MICRO, ...TWO_GATEWAYS, serviceTopology: buildRaysIntendedJob().topology })],
  ['Ray 400 A DC-coupled / E-1.1 schedules only',
    () => ({ ...MICRO, ...E11, serviceTopology: buildRaysIntendedJob().topology })],
];

const digest = (svg: string) => {
  const drawing = svg.replace(/<!-- [^>]*? \| SLD [^>]*?-->/g, '');
  return { sha256: createHash('sha256').update(drawing).digest('hex'), bytes: drawing.length };
};

const quietly = <T>(fn: () => T): T => {
  const log = console.log, warn = console.warn, error = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const baseline: Record<string, { sha256: string; bytes: number }> =
  existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const written: Record<string, { sha256: string; bytes: number }> = {};

describe('🚨 every sheet outside the compact DC-coupled layout is byte-identical to before it', () => {
  it('the baseline covers every sheet in this list, and nothing else', () => {
    if (WRITE) return;
    expect(Object.keys(baseline).sort()).toEqual(SHEETS.map(([id]) => id).sort());
  });

  for (const [id, build] of SHEETS) {
    it(id, () => {
      const got = digest(quietly(() => renderSLDProfessional(build() as unknown as SLDProfessionalInput)));
      if (WRITE) { written[id] = got; return; }
      expect(baseline[id], `no baseline for '${id}'`).toBeTruthy();
      expect(got, `'${id}' no longer renders byte-for-byte as it did before the compact layout`)
        .toEqual(baseline[id]);
    });
  }

  afterAll(() => {
    if (WRITE) writeFileSync(BASELINE, `${JSON.stringify(written, null, 2)}\n`);
  });
});
