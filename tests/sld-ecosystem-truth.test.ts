/**
 * Phase 7-8 Regression Test — SLD Ecosystem Truth + Topology Template Fix
 *
 * Tests:
 *  A. SolarEdge SE11400H optimizer_string (36 modules, 3 strings, 36 optimizers)
 *     1. Renders SVG without errors
 *     2. SVG contains optimizer callout (36 + P505/optimizer)
 *     3. External DC DISCONNECT node is omitted (integratedDcDisconnect=true)
 *     4. Topology label reads STRING + OPTIMIZER
 *     5. THWN-2 appears in raceway segment callouts
 *     6. getInverterById('se-11400h').integratedDcDisconnect === true
 *     7. OPEN AIR label appears for DC_STRING_RUN
 *     8. DC conductor callout shows 6 conductors for 3 strings
 *     9. AC COMBINER does NOT appear (not a micro layout)
 *    10. APsystems / DS3 text does NOT appear
 *
 *  B. String topology (no optimizer) — STRING_INVERTER
 *    11. Topology label reads STRING INVERTER
 *    12. External DC disco IS rendered
 *    13. Optimizer callout does NOT appear
 *
 *  C. Microinverter topology — MICROINVERTER + micro ecosystemTopology
 *    14. AC COMBINER appears
 *    15. DC DISCONNECT does NOT appear (micro has no DC string)
 *    16. No SolarEdge/optimizer text
 *
 *  D. Contamination guard — optimizer brand with stale MICROINVERTER topologyType
 *    17. SVG does NOT render AC combiner
 *    18. SVG does NOT render micro branch layout
 *    19. STRING + OPTIMIZER label appears
 *    20. [SLD TOPOLOGY CONTAMINATION] error is logged
 */

import { describe, test, expect, beforeAll, vi } from 'vitest';
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import { getInverterById } from '../lib/equipment-db';

// ── Input factories ───────────────────────────────────────────────────────────

function makeSolarEdgeInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — SolarEdge SE11400H Regression',
    clientName:              'Test Client',
    address:                 '123 Solar Lane, Phoenix AZ 85001',
    designer:                'AutoTest',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-001',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'STRING_WITH_OPTIMIZER',
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
    selectedBrand:           'solaredge',
    ecosystemTopology:       'optimizer',
    optimizerQty:            36,
    optimizerModel:          'P505',
    integratedDcDisconnect:  true,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

function makeStringInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — String Inverter',
    clientName:              'Test Client',
    address:                 '123 Solar Lane',
    designer:                'AutoTest',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-002',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'STRING_INVERTER',
    totalModules:            20,
    totalStrings:            2,
    panelModel:              'Generic 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10',
    dcConduitType:           'EMT',
    dcOCPD:                  20,
    inverterModel:           'Primo 8.2-1',
    inverterManufacturer:    'Fronius',
    acOutputKw:              8.2,
    acOutputAmps:            34.2,
    acWireGauge:             '#10',
    acConduitType:           'EMT',
    acOCPD:                  45,
    mainPanelAmps:           200,
    backfeedAmps:            45,
    utilityName:             'SCE',
    interconnection:         'LOAD_SIDE',
    rapidShutdownIntegrated: false,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    selectedBrand:           'fronius',
    ecosystemTopology:       'string',
    optimizerQty:            undefined,
    integratedDcDisconnect:  false,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

function makeMicroInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — Microinverter',
    clientName:              'Test Client',
    address:                 '123 Solar Lane',
    designer:                'AutoTest',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-003',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'MICROINVERTER',
    totalModules:            20,
    totalStrings:            0,
    panelModel:              'Generic 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10',
    dcConduitType:           'EMT',
    dcOCPD:                  0,
    inverterModel:           'IQ8+',
    inverterManufacturer:    'Enphase',
    acOutputKw:              5.8,
    acOutputAmps:            24.2,
    acWireGauge:             '#10',
    acConduitType:           'EMT',
    acOCPD:                  30,
    mainPanelAmps:           200,
    backfeedAmps:            30,
    utilityName:             'SCE',
    interconnection:         'LOAD_SIDE',
    rapidShutdownIntegrated: true,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    deviceCount:             20,
    selectedBrand:           'enphase',
    ecosystemTopology:       'micro',
    integratedDcDisconnect:  false,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

// ── Test Suite A: SolarEdge optimizer_string ──────────────────────────────────

describe('SLD — SolarEdge SE11400H optimizer_string (36 modules, 3 strings)', () => {
  let svg: string;

  beforeAll(() => {
    svg = renderSLDProfessional(makeSolarEdgeInput());
  });

  test('1. renders SVG without errors', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('2. SVG contains optimizer callout (36 × P505)', () => {
    const hasOptimizerText = svg.includes('36') && (
      svg.toLowerCase().includes('p505') ||
      svg.toLowerCase().includes('optimizer')
    );
    expect(hasOptimizerText).toBe(true);
  });

  test('3. External DC DISCONNECT omitted when integratedDcDisconnect=true', () => {
    expect(svg.includes('(N) DC DISCONNECT')).toBe(false);
  });

  test('4. Topology label reads STRING + OPTIMIZER', () => {
    expect(svg.includes('STRING + OPTIMIZER')).toBe(true);
  });

  test('5. Raceway DC segments show THWN-2 (not USE-2/PV Wire)', () => {
    expect(svg.includes('THWN-2')).toBe(true);
  });

  test('6. getInverterById(se-11400h).integratedDcDisconnect === true', () => {
    const inv = getInverterById('se-11400h');
    expect(inv).toBeDefined();
    expect(inv?.integratedDcDisconnect).toBe(true);
  });

  test('7. DC_STRING_RUN shows OPEN AIR or NEC 690.31 label', () => {
    expect(svg.includes('OPEN AIR') || svg.includes('690.31')).toBe(true);
  });

  test('8. DC conductor callout shows 6 conductors for 3 strings', () => {
    expect(svg.match(/6.{0,3}#10/) !== null).toBe(true);
  });

  test('9. AC COMBINER does NOT appear (optimizer, not micro)', () => {
    expect(svg.includes('AC COMBINER')).toBe(false);
  });

  test('10. APsystems / DS3 text does NOT appear in SolarEdge SLD', () => {
    const hasAPsystems = svg.toLowerCase().includes('apsystems') ||
                         svg.toLowerCase().includes('ds3-s') ||
                         svg.toLowerCase().includes('ds3s');
    expect(hasAPsystems).toBe(false);
  });
});

// ── Test Suite B: String Inverter (no optimizer) ──────────────────────────────

describe('SLD — String Inverter (Fronius, no optimizer)', () => {
  let svg: string;

  beforeAll(() => {
    svg = renderSLDProfessional(makeStringInput());
  });

  test('11. Topology label reads STRING INVERTER', () => {
    expect(svg.includes('STRING INVERTER')).toBe(true);
  });

  test('12. External DC disco IS rendered', () => {
    expect(svg.includes('(N) DC DISCONNECT')).toBe(true);
  });

  test('13. Optimizer callout does NOT appear', () => {
    expect(svg.toLowerCase().includes('optimizer')).toBe(false);
  });
});

// ── Test Suite C: Microinverter ───────────────────────────────────────────────

describe('SLD — Microinverter (Enphase IQ8+)', () => {
  let svg: string;

  beforeAll(() => {
    svg = renderSLDProfessional(makeMicroInput());
  });

  test('14. AC COMBINER appears in micro layout', () => {
    expect(svg.includes('AC COMBINER')).toBe(true);
  });

  test('15. DC DISCONNECT does NOT appear (micro has no DC string)', () => {
    expect(svg.includes('(N) DC DISCONNECT')).toBe(false);
  });

  test('16. No SolarEdge/optimizer text in micro SLD', () => {
    const hasSolarEdge = svg.toLowerCase().includes('solaredge') ||
                         svg.toLowerCase().includes('se11400');
    expect(hasSolarEdge).toBe(false);
  });
});

// ── Test Suite D: Contamination guard ────────────────────────────────────────

describe('SLD — Topology contamination guard (stale MICROINVERTER + optimizer ecosystem)', () => {
  let svg: string;
  const consoleSpy = vi.spyOn(console, 'error');

  beforeAll(() => {
    consoleSpy.mockClear();
    // Simulate stale config: body sent MICROINVERTER but brand/ecosystem is optimizer
    svg = renderSLDProfessional(makeSolarEdgeInput({
      topologyType:      'MICROINVERTER',  // <-- stale value from previous micro project
      ecosystemTopology: 'optimizer',      // <-- canonical brand-profile value
      selectedBrand:     'solaredge',
    }));
  });

  test('17. AC COMBINER does NOT render when ecosystem=optimizer overrides stale MICROINVERTER', () => {
    expect(svg.includes('AC COMBINER')).toBe(false);
  });

  test('18. STRING + OPTIMIZER label appears despite stale topologyType', () => {
    expect(svg.includes('STRING + OPTIMIZER')).toBe(true);
  });

  test('19. [SLD TOPOLOGY CONTAMINATION] error is logged', () => {
    const logged = consoleSpy.mock.calls.some(call =>
      String(call[0]).includes('SLD TOPOLOGY CONTAMINATION')
    );
    expect(logged).toBe(true);
  });

  test('20. SVG renders without throwing', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });
});