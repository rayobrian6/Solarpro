/**
 * Phase 7 Regression Test — SLD Topology Template Selection Fix
 *
 * Tests that:
 * 1. SolarEdge optimizer project renders optimizer_string layout (not micro)
 * 2. APsystems micro project renders micro layout (not string)
 * 3. No cross-contamination between brand topologies
 * 4. Stale MICROINVERTER body value overridden when ecosystemTopology=optimizer
 * 5. APsystems/Enphase text never appears in SolarEdge SLD
 * 6. AC combiner never appears in optimizer_string layout
 * 7. String inverter never appears in micro layout
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { renderSLDProfessional } from '../lib/sld-professional-renderer';

// ── Base input factories ──────────────────────────────────────────────────────

function makeOptimizerInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — SolarEdge Optimizer Topology',
    clientName:              'Test Client',
    address:                 '123 Solar Lane, Phoenix AZ 85001',
    designer:                'AutoTest',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-002',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'STRING_WITH_OPTIMIZER',
    ecosystemTopology:       'optimizer',
    selectedBrand:           'solaredge',
    optimizerQty:            36,
    optimizerModel:          'P505',
    integratedDcDisconnect:  true,
    totalModules:            36,
    totalStrings:            3,
    panelModel:              'Generic 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10',
    dcConduitType:           'EMT',
    dcOCPD:                  20,
    inverterModel:           'SE11400H',
    inverterManufacturer:    'SolarEdge',
    acOutputKw:              11.4,
    acOutputAmps:            47.5,
    acWireGauge:             '#8',
    acConduitType:           'EMT',
    acOCPD:                  60,
    mainPanelAmps:           200,
    backfeedAmps:            60,
    utilityName:             'APS',
    interconnection:         'LOAD_SIDE',
    rapidShutdownIntegrated: true,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

function makeMicroInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — APsystems Micro Topology',
    clientName:              'Test Client',
    address:                 '456 Panel Ave, Phoenix AZ 85001',
    designer:                'AutoTest',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-003',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'MICROINVERTER',
    ecosystemTopology:       'micro',
    selectedBrand:           'apsystems',
    optimizerQty:            undefined,
    integratedDcDisconnect:  false,
    totalModules:            20,
    totalStrings:            0,
    deviceCount:             10,
    panelModel:              'Generic 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10',
    dcConduitType:           'EMT',
    dcOCPD:                  0,
    inverterModel:           'DS3-S',
    inverterManufacturer:    'APsystems',
    acOutputKw:              5.8,
    acOutputAmps:            24.2,
    acWireGauge:             '#6',
    acConduitType:           'EMT',
    acOCPD:                  40,
    mainPanelAmps:           200,
    backfeedAmps:            40,
    utilityName:             'APS',
    interconnection:         'LOAD_SIDE',
    rapidShutdownIntegrated: true,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

// ── SUITE 1: SolarEdge Optimizer String ───────────────────────────────────────

describe('SLD Topology — SolarEdge Optimizer String (36 modules)', () => {
  let svg: string;
  beforeAll(() => { svg = renderSLDProfessional(makeOptimizerInput()); });

  test('renders without errors', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('does NOT render AC combiner', () => {
    expect(svg.includes('AC COMBINER')).toBe(false);
  });

  test('does NOT render AC JUNCTION label', () => {
    expect(svg.includes('AC JUNCTION')).toBe(false);
  });

  test('renders DC JUNCTION label on J-Box', () => {
    expect(svg.includes('DC JUNCTION')).toBe(true);
  });

  test('renders STRING + OPTIMIZER topology label', () => {
    expect(svg.includes('STRING + OPTIMIZER')).toBe(true);
  });

  test('renders optimizer callout (36 optimizers)', () => {
    const hasOpt = svg.includes('36') && (
      svg.toLowerCase().includes('optimizer') ||
      svg.toLowerCase().includes('p505')
    );
    expect(hasOpt).toBe(true);
  });

  test('does NOT render APsystems or DS3-S text', () => {
    expect(svg.toLowerCase().includes('apsystems')).toBe(false);
    expect(svg.toLowerCase().includes('ds3')).toBe(false);
  });

  test('does NOT render Enphase text', () => {
    expect(svg.toLowerCase().includes('enphase')).toBe(false);
  });

  test('renders SolarEdge inverter model (SE11400H)', () => {
    expect(svg.includes('SE11400H')).toBe(true);
  });

  test('does NOT render external DC disconnect (integratedDcDisconnect=true)', () => {
    expect(svg.includes('(N) DC DISCONNECT')).toBe(false);
  });

  test('stale MICROINVERTER topologyType overridden by ecosystemTopology=optimizer', () => {
    const staleSvg = renderSLDProfessional(makeOptimizerInput({
      topologyType:      'MICROINVERTER',
      ecosystemTopology: 'optimizer',
    }));
    expect(staleSvg.includes('AC COMBINER')).toBe(false);
    expect(staleSvg.includes('AC JUNCTION')).toBe(false);
    expect(staleSvg.includes('STRING + OPTIMIZER')).toBe(true);
  });
});

// ── SUITE 2: APsystems Microinverter ─────────────────────────────────────────

describe('SLD Topology — APsystems DS3-S Micro (20 modules, 10 devices)', () => {
  let svg: string;
  beforeAll(() => { svg = renderSLDProfessional(makeMicroInput()); });

  test('renders without errors', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('renders AC COMBINER', () => {
    expect(svg.includes('AC COMBINER')).toBe(true);
  });

  test('renders AC JUNCTION label on J-Box', () => {
    expect(svg.includes('AC JUNCTION')).toBe(true);
  });

  test('does NOT render STRING + OPTIMIZER label', () => {
    expect(svg.includes('STRING + OPTIMIZER')).toBe(false);
  });

  test('does NOT render SolarEdge text', () => {
    expect(svg.toLowerCase().includes('solaredge')).toBe(false);
  });

  test('stale STRING_WITH_OPTIMIZER topologyType overridden by ecosystemTopology=micro', () => {
    const staleSvg = renderSLDProfessional(makeMicroInput({
      topologyType:      'STRING_WITH_OPTIMIZER',
      ecosystemTopology: 'micro',
    }));
    expect(staleSvg.includes('AC COMBINER')).toBe(true);
    expect(staleSvg.includes('AC JUNCTION')).toBe(true);
  });
});

// ── SUITE 3: Plain String Inverter (no optimizer) ─────────────────────────────

describe('SLD Topology — Plain String Inverter (Fronius, 36 modules)', () => {
  let svg: string;
  beforeAll(() => {
    svg = renderSLDProfessional(makeOptimizerInput({
      topologyType:           'STRING_INVERTER',
      ecosystemTopology:      'string',
      selectedBrand:          'fronius',
      optimizerQty:           undefined,
      integratedDcDisconnect: false,
      inverterModel:          'Primo 8.2-1',
      inverterManufacturer:   'Fronius',
    }));
  });

  test('renders without errors', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('renders STRING INVERTER topology label', () => {
    expect(svg.includes('STRING INVERTER')).toBe(true);
  });

  test('renders external DC disconnect', () => {
    expect(svg.includes('(N) DC DISCONNECT')).toBe(true);
  });

  test('does NOT render AC combiner', () => {
    expect(svg.includes('AC COMBINER')).toBe(false);
  });

  test('does NOT render optimizer callout', () => {
    expect(svg.toLowerCase().includes('optimizer')).toBe(false);
  });
});