// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (§3 Wave 0; Wave 5 Lane A rewrites the SLD into renderSourceLane lanes and
// I-1 requires the no-sources[] legacy path untouched).
//
// Deliberately does NOT snapshot the whole SVG (fragile). Pins stable
// STRUCTURAL markers of renderSLDProfessional's legacy single-source path:
// canvas dims from the <svg> tag, presence/count of key node labels, and a
// source-branch count of exactly ONE (one PV ARRAY node header per canvas).
// Snapshots live in tests/goldens/__snapshots__/ and are committed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { renderSLDProfessional } from '../../lib/sld-professional-renderer';

type SLDInput = Parameters<typeof renderSLDProfessional>[0];

const BASE = {
  projectName: 'WAVE0 GOLDEN', clientName: 'Golden Client',
  address: '1 Golden Way, Phoenix AZ 85001', designer: 'Wave0',
  drawingDate: '2026-07-11', drawingNumber: 'W0-001', revision: 'A',
  scale: 'NOT TO SCALE',
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT',
  mainPanelAmps: 200, utilityName: 'APS', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};

const microInput = (): SLDInput => ({
  ...BASE,
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 0, deviceCount: 20,
  dcOCPD: 0, inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
  acOutputKw: 5.8, acOutputAmps: 24.2, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: true,
} as SLDInput);

const stringInput = (): SLDInput => ({
  ...BASE,
  topologyType: 'STRING_INVERTER', ecosystemTopology: 'string', selectedBrand: 'fronius',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 2,
  dcOCPD: 20, inverterModel: 'Primo 8.2-1', inverterManufacturer: 'Fronius',
  acOutputKw: 7.6, acOutputAmps: 31.7, acWireGauge: '#8', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: false,
} as SLDInput);

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

/** Structural markers only — never the raw SVG. */
function markers(svg: string) {
  const tag = /^<svg[^>]*>/.exec(svg)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  return {
    isSvg: svg.startsWith('<svg'),
    canvas: { width: attr('width'), height: attr('height'), viewBox: attr('viewBox') },
    counts: {
      title: count(svg, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM'),
      pvArrayNode: count(svg, 'PV ARRAY'),          // source-branch node header (+schedule refs)
      solarFenceNode: count(svg, 'SOLAR FENCE ARRAY'),
      acCombiner: count(svg, 'AC COMBINER'),
      stringInverterHdr: count(svg, 'STRING INVERTER'),
      optimizerHdr: count(svg, 'STRING + OPTIMIZER'),
      externalDcDisconnect: count(svg, '(N) DC DISCONNECT'),
      mainServicePanel: count(svg, 'MAIN SERVICE PANEL'),
      utilityGrid: count(svg, 'UTILITY GRID'),
    },
  };
}

describe('Wave 0 golden — SLD legacy MICRO baseline (structural markers)', () => {
  const svg = renderSLDProfessional(microInput());
  const m = markers(svg);

  it('renders one canvas with exactly one source branch and one service tail', () => {
    expect(m.isSvg).toBe(true);
    expect(m.counts.title).toBe(1);          // one canvas
    expect(m.counts.utilityGrid).toBe(1);    // one shared service tail
    expect(count(svg, 'PV ARRAY')).toBeGreaterThanOrEqual(1); // exactly-one pinned via snapshot
    expect(m.counts.acCombiner).toBeGreaterThanOrEqual(1);    // micro path
    expect(m.counts.optimizerHdr).toBe(0);
  });

  it('canvas dims + marker counts match the pre-contract snapshot', () => {
    expect(m).toMatchSnapshot();
  });
});

describe('Wave 0 golden — SLD legacy STRING baseline (structural markers)', () => {
  const svg = renderSLDProfessional(stringInput());
  const m = markers(svg);

  it('renders one canvas with exactly one source branch and one service tail', () => {
    expect(m.isSvg).toBe(true);
    expect(m.counts.title).toBe(1);
    expect(m.counts.utilityGrid).toBe(1);
    expect(m.counts.acCombiner).toBe(0);                       // never on string path
    expect(m.counts.externalDcDisconnect).toBeGreaterThanOrEqual(1);
    expect(m.counts.stringInverterHdr).toBeGreaterThanOrEqual(1);
  });

  it('canvas dims + marker counts match the pre-contract snapshot', () => {
    expect(m).toMatchSnapshot();
  });
});
