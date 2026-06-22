import { describe, it, expect } from 'vitest';
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import { SLD_SYMBOL_MAP } from '../lib/sld-symbols';

// A SolFence (vertical bifacial) system should render with its own PV glyph and
// fence labels on the SLD instead of the generic roof "PV ARRAY" symbol.
function makeInput(overrides: Record<string, unknown> = {}): Parameters<typeof renderSLDProfessional>[0] {
  return {
    projectName: 'TEST — Fence', clientName: 'Test', address: '1 Fence Rd',
    designer: 'AutoTest', drawingDate: '2026-01-01', drawingNumber: 'T-FENCE',
    revision: 'A', scale: 'NOT TO SCALE',
    topologyType: 'MICROINVERTER',
    totalModules: 16, totalStrings: 0, panelsPerString: 1,
    panelModel: 'Nexus PS-MNB108-440W', panelWatts: 440, panelVoc: 51.2, panelIsc: 10.92,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: 'IQ8A', inverterManufacturer: 'Enphase',
    acOutputKw: 5.3, acOutputAmps: 22, acWireGauge: '#10 AWG', acConduitType: 'EMT', acOCPD: 40,
    mainPanelAmps: 200, backfeedAmps: 40, utilityName: 'Ameren', interconnection: 'Load Side Tap',
    rapidShutdownIntegrated: true, hasProductionMeter: false, hasBattery: false,
    batteryModel: '', batteryKwh: 0, acWireLength: 50, deviceCount: 16,
    ...overrides,
  } as Parameters<typeof renderSLDProfessional>[0];
}

describe('SolFence SLD symbol', () => {
  it('registers a dedicated pv-fence emblem with the same anchors as pv-array', () => {
    const fence = SLD_SYMBOL_MAP['pv-fence'];
    const array = SLD_SYMBOL_MAP['pv-array'];
    expect(fence).toBeDefined();
    expect(fence.height).toBe(array.height);   // same box → wiring/layout unaffected
    const dc = fence.connections.find(c => c.id === 'dc_pos');
    expect(dc).toMatchObject({ x: 200, y: 60 });  // identical to pv-array's dc_pos
    const svg = fence.svg();
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(100);
  });

  it('renders SOLAR FENCE ARRAY + FENCE J-BOX for systemType "fence"', () => {
    const svg = renderSLDProfessional(makeInput({ systemType: 'fence' }));
    expect(svg).toContain('SOLAR FENCE ARRAY');
    expect(svg).toContain('FENCE J-BOX');
    expect(svg).not.toContain('PV ARRAY');
  });

  it('keeps the generic PV ARRAY + ROOF J-BOX for roof systems', () => {
    const roof = renderSLDProfessional(makeInput({ systemType: 'roof' }));
    expect(roof).toContain('PV ARRAY');
    expect(roof).toContain('ROOF J-BOX');
    expect(roof).not.toContain('SOLAR FENCE ARRAY');

    // systemType omitted → defaults to roof behavior (back-compat)
    const dflt = renderSLDProfessional(makeInput());
    expect(dflt).toContain('PV ARRAY');
    expect(dflt).toContain('ROOF J-BOX');
  });
});
