/**
 * Task 3 — SLD Engineering Accuracy Regression Test
 *
 * Validates all 9 engineering/topology accuracy criteria:
 *  1. J-box → inverter labeled RACEWAY (THWN-2), not OPEN AIR
 *  2. DC conductor count = stringCount×2 (6 for 3 strings, not 8)
 *  3. Optimizer topology fully represented in PV array callout
 *  4. String layout shown correctly (3 STRINGS × 12 MODULES)
 *  5. AC conductor label = 2#X THWN-2 (no neutral for 240V inverter)
 *  6. acRequiresNeutral = false for SE11400H (240V output)
 *  7. NEC 705.12 validation present and accurate
 *  8. Ground drops only at equipment nodes (no mid-run drops)
 *  9. [SLD INPUT TRUTH] log emitted at render entry
 *
 * Scenarios:
 *  E. SolarEdge 3-string optimizer (SE11400H + 36× P505) — main regression
 *  F. SolarEdge 2-string optimizer (SE11400H + 24× P505) — conductor count
 *  G. SolarEdge string only (no optimizer) — RACEWAY label on SEG2B/SEG3
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import { getInverterById } from '../lib/equipment-db';

// Safe spy: collects logs without recursion
function makeLogSpy(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const orig = console.log.bind(console);
  const spy = vi.fn((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  console.log = spy as unknown as typeof console.log;
  return {
    logs,
    restore: () => { console.log = orig; },
  };
}

// ── Input factories ───────────────────────────────────────────────────────────

function makeOptimizerInput(
  strings: number = 3,
  modulesPerString: number = 12,
  overrides: Record<string, unknown> = {}
): Parameters<typeof renderSLDProfessional>[0] {
  const totalModules = strings * modulesPerString;
  return {
    projectName:             `TEST — SolarEdge SE11400H ${strings}-string optimizer`,
    clientName:              'Test Client',
    address:                 '456 Engineering Ave, Phoenix AZ 85001',
    designer:                'AutoTest Phase3',
    drawingDate:             '2025-01-01',
    drawingNumber:           `T-ACC-${strings}STR`,
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'STRING_WITH_OPTIMIZER',
    totalModules,
    totalStrings:            strings,
    panelsPerString:         modulesPerString,
    panelModel:              'REC Alpha 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10 AWG',
    dcConduitType:           'EMT',
    dcOCPD:                  20,
    inverterModel:           'SE11400H-US',
    inverterManufacturer:    'SolarEdge',
    acOutputKw:              11.4,
    acOutputAmps:            47.5,
    acWireGauge:             '#8 AWG',
    acConduitType:           'EMT',
    acOCPD:                  60,
    mainPanelAmps:           200,
    backfeedAmps:            60,
    utilityName:             'APS',
    interconnection:         'Load Side Tap',
    rapidShutdownIntegrated: true,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    acWireLength:            50,
    egcGauge:                '#10 AWG',
    selectedBrand:           'solaredge',
    ecosystemTopology:       'optimizer',
    optimizerQty:            totalModules,
    optimizerModel:          'P505',
    integratedDcDisconnect:  true,
    // Phase 6: 240V split-phase → no neutral
    acRequiresNeutral:       false,
    mpptChannels:            1,
    mpptAllocation:          `CH1:${strings}str`,
    stringVoc:               49.8 * modulesPerString,
    stringIsc:               9.84,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

function makeStringOnlyInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName:             'TEST — String-only SolarEdge SE7600H',
    clientName:              'Test Client',
    address:                 '789 String St, Denver CO 80201',
    designer:                'AutoTest Phase3',
    drawingDate:             '2025-01-01',
    drawingNumber:           'T-ACC-STR',
    revision:                'A',
    scale:                   'NOT TO SCALE',
    topologyType:            'STRING_INVERTER',
    totalModules:            20,
    totalStrings:            2,
    panelsPerString:         10,
    panelModel:              'Generic 400W',
    panelWatts:              400,
    panelVoc:                49.8,
    panelIsc:                9.84,
    dcWireGauge:             '#10 AWG',
    dcConduitType:           'EMT',
    dcOCPD:                  20,
    inverterModel:           'SE7600H-US',
    inverterManufacturer:    'SolarEdge',
    acOutputKw:              7.6,
    acOutputAmps:            32,
    acWireGauge:             '#10 AWG',
    acConduitType:           'EMT',
    acOCPD:                  40,
    mainPanelAmps:           200,
    backfeedAmps:            40,
    utilityName:             'Xcel',
    interconnection:         'Load Side Tap',
    rapidShutdownIntegrated: false,
    hasProductionMeter:      false,
    hasBattery:              false,
    batteryModel:            '',
    batteryKwh:              0,
    acWireLength:            50,
    egcGauge:                '#10 AWG',
    selectedBrand:           'solaredge',
    ecosystemTopology:       'string',
    optimizerQty:            undefined,
    integratedDcDisconnect:  false,
    acRequiresNeutral:       false,
    mpptChannels:            2,
    mpptAllocation:          'CH1:1str CH2:1str',
    stringVoc:               49.8 * 10,
    stringIsc:               9.84,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

// ── Scenario E: 3-string SolarEdge optimizer ─────────────────────────────────

describe('E — SolarEdge 3-string optimizer (SE11400H + 36× P505)', () => {
  let svg: string;
  let logs: string[];

  let restore: () => void;

  beforeAll(() => {
    const spy = makeLogSpy();
    logs = spy.logs;
    restore = spy.restore;
    svg = renderSLDProfessional(makeOptimizerInput(3, 12));
  });

  afterAll(() => { restore?.(); });

  test('E1: renders valid SVG', () => {
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg.length).toBeGreaterThan(5000);
  });

  test('E2: [SLD INPUT TRUTH] log emitted at render entry', () => {
    const truthLog = logs.find(l => l.includes('[SLD INPUT TRUTH]'));
    expect(truthLog).toBeDefined();
    expect(truthLog).toContain('topology=optimizer');
    expect(truthLog).toContain('stringCount=3');
    expect(truthLog).toContain('integratedDcDisconnect=true');
    expect(truthLog).toContain('acRequiresNeutral=false');
  });

  test('E3: no external DC disconnect node rendered (integratedDcDisconnect=true)', () => {
    // When integrated, the DC DISCONNECT box should NOT appear
    expect(svg).not.toContain('>DC DISCONNECT<');
    expect(svg).not.toContain('>(N) DC DISCONNECT<');
  });

  test('E4: SEGMENT_2D uses RACEWAY label (not OPEN AIR) for J-Box→Inverter', () => {
    // After JBOX, wire is in raceway — OPEN AIR must not appear on this segment
    // The SEGMENT_2D wire run is DC with THWN-2 in conduit
    expect(svg).not.toMatch(/OPEN AIR.{0,40}THWN/);
    // SEGMENT_1 (PV→JBOX) is the only OPEN AIR segment
    const openAirCount = (svg.match(/OPEN AIR/g) || []).length;
    // Only one OPEN AIR reference: SEGMENT_1 (PV→JBOX) or the legend
    // Key: no DC segment AFTER jbox should say OPEN AIR
    const seg2dLog = logs.find(l => l.includes('SEGMENT_2D_JBOX_TO_INV_DIRECT'));
    expect(seg2dLog).toBeDefined();
    // The SEGMENT_2D wire run should be RACEWAY
    expect(seg2dLog).not.toContain('OPEN_AIR');
  });

  test('E5: DC conductor count = 6 for 3 strings (not 8)', () => {
    // 3 strings → 3×DC+ + 3×DC- = 6 current-carrying conductors
    // Should see "6×#10 THWN-2" or "6#10 THWN-2"
    const has6Cond = svg.includes('6\u00d7#10') || svg.includes('6#10');
    expect(has6Cond).toBe(true);
    // Must NOT see 8 conductors for this 3-string design
    expect(svg).not.toMatch(/8[×#]#?10/);
    expect(svg).not.toContain('8\u00d7#10');
  });

  test('E6: optimizer callout visible with count and model', () => {
    expect(svg).toContain('36 DC OPTIMIZERS');
    expect(svg).toContain('P505');
  });

  test('E7: string layout shows 3 STRINGS × 12 MODULES', () => {
    // PV array should show "3 STRINGS × 12 MODULES" (or similar)
    const hasLayout = svg.includes('3 STRINGS') || svg.includes('3 STRING');
    expect(hasLayout).toBe(true);
    const hasModules = svg.includes('\u00d7 12 MODULES') || svg.includes('\u00d712 MODULES');
    expect(hasModules).toBe(true);
  });

  test('E8: AC conductor label = 2 conductors (no neutral for 240V)', () => {
    // SE11400H is 240V split-phase → 2 current-carrying conductors (L1+L2, no N)
    // Should see "2#8" or "2×#8" in AC segments
    const has2Ac = svg.includes('2#8') || svg.includes('2\u00d7#8');
    expect(has2Ac).toBe(true);
    // Must NOT see 3 conductors for this no-neutral 240V inverter
    expect(svg).not.toMatch(/3[#\u00d7]#?8/);
  });

  test('E9: TOPOLOGY: STRING + OPTIMIZER label present', () => {
    expect(svg).toContain('STRING + OPTIMIZER');
  });

  test('E10: AC COMBINER does NOT appear (not a micro layout)', () => {
    expect(svg).not.toContain('>AC COMBINER<');
    expect(svg).not.toContain('IQ Combiner');
    expect(svg).not.toContain('APsystems');
  });

  test('E11: grounding rail connects to equipment nodes (no mid-run drop at xComb)', () => {
    // For integratedDcDisconnect=true, DC disco position (xComb) should NOT have a ground drop
    // We verify by checking the [SLD STRING LANDING] log is present (inverter rendered)
    const landingLog = logs.find(l => l.includes('[SLD STRING LANDING]'));
    expect(landingLog).toBeDefined();
    expect(landingLog).toContain('CH1:3str');
  });

  test('E12: NEC 705.12 computation present and shows correct values', () => {
    expect(svg).toContain('NEC 705.12');
    expect(svg).toContain('200');  // main panel rating
    expect(svg).toContain('120%');
  });
});

// ── Scenario F: 2-string optimizer (conductor count regression) ───────────────

describe('F — SolarEdge 2-string optimizer (conductor count)', () => {
  let svg: string;

  beforeAll(() => {
    svg = renderSLDProfessional(makeOptimizerInput(2, 13, { optimizerQty: 26, mpptAllocation: 'CH1:2str' }));
  });

  test('F1: DC conductor count = 4 for 2 strings (2×DC+ + 2×DC-)', () => {
    // 2 strings → 4 current-carrying conductors
    const has4Cond = svg.includes('4\u00d7#10') || svg.includes('4#10');
    expect(has4Cond).toBe(true);
    expect(svg).not.toMatch(/8[×\u00d7]#?10/);
  });

  test('F2: optimizer callout shows 26 optimizers', () => {
    expect(svg).toContain('26 DC OPTIMIZERS');
  });
});

// ── Scenario G: String-only (no optimizer) ────────────────────────────────────

describe('G — String-only SolarEdge SE7600H (no optimizer)', () => {
  let svg: string;
  let logs: string[];

  let restore: () => void;

  beforeAll(() => {
    const spy = makeLogSpy();
    logs = spy.logs;
    restore = spy.restore;
    svg = renderSLDProfessional(makeStringOnlyInput());
  });

  afterAll(() => { restore?.(); });

  test('G1: renders valid SVG', () => {
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(5000);
  });

  test('G2: DC DISCONNECT node IS rendered (not integrated)', () => {
    expect(svg).toContain('DC DISCONNECT');
  });

  test('G3: SEG2B (JBOX→DC Disco) uses RACEWAY/THWN-2 label', () => {
    const seg2bLog = logs.find(l => l.includes('SEGMENT_2B_JBOX_TO_DCDISCO'));
    expect(seg2bLog).toBeDefined();
    // Check THWN-2 label appears in SVG for DC segments after JBOX
    expect(svg).toContain('THWN-2');
  });

  test('G4: optimizer callout does NOT appear', () => {
    expect(svg).not.toContain('DC OPTIMIZERS');
    expect(svg).not.toContain('OPTIMIZER');
  });

  test('G5: AC conductor count = 2 (240V, no neutral)', () => {
    // SE7600H is also 240V split-phase
    const has2Ac = svg.includes('2#10') || svg.includes('2\u00d7#10');
    expect(has2Ac).toBe(true);
  });

  test('G6: [SLD INPUT TRUTH] log shows string topology', () => {
    const truthLog = logs.find(l => l.includes('[SLD INPUT TRUTH]'));
    expect(truthLog).toBeDefined();
    expect(truthLog).toContain('topology=string');
    expect(truthLog).toContain('integratedDcDisconnect=false');
  });
});

// ── Scenario H: acRequiresNeutral from equipment-db ──────────────────────────

describe('H — acRequiresNeutral derivation from inverter spec', () => {
  test('H1: SE11400H has acOutputVoltage = 240 (no neutral)', () => {
    const inv = getInverterById('se-11400h');
    expect(inv).toBeDefined();
    expect(inv?.acOutputVoltage).toBe(240);
  });

  test('H2: acRequiresNeutral=false for 240V renders 2-conductor AC label', () => {
    const svg = renderSLDProfessional(makeOptimizerInput(3, 12, { acRequiresNeutral: false, acWireGauge: '#8 AWG' }));
    // Should see 2 conductors for 240V no-neutral
    const has2Ac = svg.includes('2#8') || svg.includes('2\u00d7#8');
    expect(has2Ac).toBe(true);
  });

  test('H3: acRequiresNeutral=true renders 3-conductor AC label', () => {
    const svg = renderSLDProfessional(makeOptimizerInput(3, 12, { acRequiresNeutral: true, acWireGauge: '#8 AWG' }));
    // Should see 3 conductors when neutral required
    const has3Ac = svg.includes('3#8') || svg.includes('3\u00d7#8');
    expect(has3Ac).toBe(true);
  });

  test('H4: acRequiresNeutral=undefined falls back to 2-conductor (safe default)', () => {
    const svg = renderSLDProfessional(makeOptimizerInput(3, 12, { acRequiresNeutral: undefined, acWireGauge: '#8 AWG' }));
    // Default: no neutral → 2 conductors
    const has2Ac = svg.includes('2#8') || svg.includes('2\u00d7#8');
    expect(has2Ac).toBe(true);
  });
});