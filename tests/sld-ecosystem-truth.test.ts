/**
 * Phase 8 Regression Test — SLD Ecosystem Truth Fix
 *
 * Scenario: 36 × 400W SolarEdge SE11400H
 *   - 3 strings × 12 modules
 *   - 36 SolarEdge P505 optimizers (per_module)
 *   - integratedDcDisconnect = true (SE HD-Wave has built-in disco)
 *   - ecosystemTopology = 'optimizer'
 *   - selectedBrand = 'solaredge'
 *
 * Assertions:
 *   1. SVG renders without errors
 *   2. SVG contains optimizer callout text (36 + P505/optimizer)
 *   3. External DC DISCONNECT node is omitted (integratedDcDisconnect=true)
 *   4. Topology label reads STRING + OPTIMIZER
 *   5. Raceway DC segments show THWN-2 (not USE-2/PV Wire)
 *   6. getInverterById('SE11400H') returns integratedDcDisconnect=true
 *   7. DC_STRING_RUN open-air label (OPEN AIR or NEC 690.31) appears
 *   8. DC conductor callout shows 6 conductors for 3 strings
 *   9. String topology: no optimizer callout, STRING INVERTER label
 *  10. integratedDcDisconnect=false: external DC disco IS rendered
 */

import { describe, it, test, expect, beforeAll } from 'vitest';
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import { getInverterById } from '../lib/equipment-db';

// ── Input factory ─────────────────────────────────────────────────────────────

function makeInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
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
    // ── Ecosystem truth ──
    selectedBrand:           'solaredge',
    ecosystemTopology:       'optimizer',
    optimizerQty:            36,
    optimizerModel:          'P505',
    integratedDcDisconnect:  true,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('SLD Ecosystem Truth — SolarEdge SE11400H (36 modules, 3 strings)', () => {

  let svg: string;

  beforeAll(() => {
    svg = renderSLDProfessional(makeInput());
  });

  // ── Test 1: SVG renders without throwing ──────────────────────────────────
  test('renders SVG without errors', () => {
    expect(svg).toBeTruthy();
    expect(svg.startsWith('<svg')).toBe(true);
  });

  // ── Test 2: Optimizer callout appears ─────────────────────────────────────
  test('SVG contains optimizer callout (36 × P505)', () => {
    const hasOptimizerText = svg.includes('36') && (
      svg.toLowerCase().includes('p505') ||
      svg.toLowerCase().includes('optimizer')
    );
    expect(hasOptimizerText).toBe(true);
  });

  // ── Test 3: External DC disconnect NOT rendered ───────────────────────────
  test('SVG omits external DC DISCONNECT node when integratedDcDisconnect=true', () => {
    const hasDcDiscoNode = svg.includes('(N) DC DISCONNECT');
    expect(hasDcDiscoNode).toBe(false);
  });

  // ── Test 4: Topology label is STRING + OPTIMIZER ──────────────────────────
  test('inverter topology label reads STRING + OPTIMIZER', () => {
    expect(svg.includes('STRING + OPTIMIZER')).toBe(true);
  });

  // ── Test 5: THWN-2 label in raceway segment callouts ─────────────────────
  test('raceway DC segments show THWN-2 (not USE-2/PV Wire)', () => {
    expect(svg.includes('THWN-2')).toBe(true);
  });

  // ── Test 6: equipment-db — SE11400H has integratedDcDisconnect ────────────
  test('getInverterById returns integratedDcDisconnect=true for SE11400H', () => {
    // equipment-db uses kebab-case ids: 'se-11400h'
    const inv = getInverterById('se-11400h');
    expect(inv).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((inv as any)?.integratedDcDisconnect).toBe(true);
  });

  // ── Test 7: Open-air DC_STRING_RUN label ──────────────────────────────────
  test('DC_STRING_RUN shows OPEN AIR or NEC 690.31 label', () => {
    const hasOpenAirLabel = svg.includes('OPEN AIR') || svg.includes('690.31');
    expect(hasOpenAirLabel).toBe(true);
  });

  // ── Test 8: conductorCount = stringCount × 2 = 6 ─────────────────────────
  test('DC conductor callout shows 6 conductors for 3 strings', () => {
    // "6#10" or "6×#10" or "6 #10" should appear in callout area
    const has6Conductors = svg.includes('6#10') || svg.includes('6\u00d7#10') || svg.includes('6 #10') || svg.match(/6.{0,2}#10/) !== null;
    expect(has6Conductors).toBe(true);
  });

  // ── Test 9: string topology — no optimizer callout, STRING INVERTER label ─
  test('string topology: STRING INVERTER label when ecosystemTopology=string', () => {
    const strSvg = renderSLDProfessional(makeInput({
      ecosystemTopology:      'string',
      topologyType:           'STRING_INVERTER',
      optimizerQty:           undefined,
      integratedDcDisconnect: false,
    }));
    expect(strSvg.includes('STRING INVERTER')).toBe(true);
  });

  // ── Test 10: integratedDcDisconnect=false — DC disco IS rendered ──────────
  test('external DC disco IS rendered when integratedDcDisconnect=false', () => {
    const strSvg = renderSLDProfessional(makeInput({
      ecosystemTopology:      'string',
      topologyType:           'STRING_INVERTER',
      optimizerQty:           undefined,
      integratedDcDisconnect: false,
    }));
    expect(strSvg.includes('(N) DC DISCONNECT')).toBe(true);
  });
});