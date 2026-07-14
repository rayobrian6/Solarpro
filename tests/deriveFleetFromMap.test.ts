import { describe, it, expect } from 'vitest';
import { deriveFleetFromMap } from '../lib/system/deriveFleetFromMap';
import type { InverterConfig } from '../lib/system/buildInverterConfig';

// The Stowell-class hybrid: roof Enphase micro / ground Solis string / fence EcoFlow.
const STOWELL_MAP = {
  roof:   { inverterId: 'enphase-iq8plus',        panelId: 'rec-alpha-pure-405',  ecosystemBrand: 'ecoflow' /* STALE on purpose */ },
  ground: { inverterId: 'solis-s6-eh1p-7p6k-us',  panelId: 'longi-himo6-580',     ecosystemBrand: 'ecoflow' },
  fence:  { inverterId: 'ecoflow-ocean-pro-11kw', panelId: 'panel-fence-ps1',     ecosystemBrand: 'ecoflow' },
};
const STAMPS = { roof: 48, ground: 16, fence: 17 };

const bySub = (fleet: InverterConfig[], key: string) => fleet.filter(i => i.subSystemKey === key);
const totalPanels = (invs: InverterConfig[]) =>
  invs.reduce((s, inv) => s + (inv.strings ?? []).reduce((a, x) => a + (x.panelCount || 0), 0), 0);
const maxPerString = (invs: InverterConfig[]) =>
  Math.max(0, ...invs.flatMap(inv => (inv.strings ?? []).map(x => x.panelCount || 0)));

describe('deriveFleetFromMap — the projector contract', () => {
  it('projects each sub to ITS layout stamp count (stamp is the authority)', () => {
    const fleet = deriveFleetFromMap({ subSystems: STOWELL_MAP, stampCounts: STAMPS });
    expect(totalPanels(bySub(fleet, 'roof'))).toBe(48);
    expect(totalPanels(bySub(fleet, 'ground'))).toBe(16);
    expect(totalPanels(bySub(fleet, 'fence'))).toBe(17);
  });

  it('derives brand/topology from the inverter, NOT the stale ecosystemBrand tag', () => {
    const fleet = deriveFleetFromMap({ subSystems: STOWELL_MAP, stampCounts: STAMPS });
    // roof carries a stale ecosystemBrand='ecoflow' but its inverter is Enphase micro
    expect(bySub(fleet, 'roof')[0].type).toBe('micro');
    expect(bySub(fleet, 'roof')[0].inverterId).toBe('enphase-iq8plus');
    expect(bySub(fleet, 'ground')[0].inverterId).toBe('solis-s6-eh1p-7p6k-us');
    expect(bySub(fleet, 'fence')[0].inverterId).toBe('ecoflow-ocean-pro-11kw');
  });

  it('enforces the NEC 690.7 cold-Voc ceiling per sub (fence ≤ 10/string)', () => {
    const fleet = deriveFleetFromMap({ subSystems: STOWELL_MAP, stampCounts: STAMPS });
    expect(maxPerString(bySub(fleet, 'fence'))).toBeLessThanOrEqual(10);
  });

  it('IGNORES a stale prior fleet count — a 45-panel prev fence still projects to 17', () => {
    const stalePrev: InverterConfig[] = [{
      id: 'inv-stale', inverterId: 'ecoflow-ocean-pro-11kw', type: 'ecoflow',
      stringsPerInverter: 5, modulesPerString: 9, subSystemKey: 'fence',
      strings: Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`, label: `S${i}`, panelCount: 9, panelId: 'panel-fence-ps1',
        tilt: 25, azimuth: 200, roofType: 'ground', mountingSystem: 'solfence-8ft',
        wireGauge: '#8 AWG', wireLength: 60, subSystemKey: 'fence' as const,
      })),
    }];
    const fleet = deriveFleetFromMap({ subSystems: STOWELL_MAP, stampCounts: STAMPS, prev: stalePrev });
    expect(totalPanels(bySub(fleet, 'fence'))).toBe(17); // stamp wins, not the stale 45
  });

  it('CARRIES prior per-string geometry (tilt/azimuth/wire/mounting) through the projection', () => {
    const prev: InverterConfig[] = [{
      id: 'inv-r', inverterId: 'enphase-iq8plus', type: 'micro',
      stringsPerInverter: 1, modulesPerString: 48, subSystemKey: 'roof',
      strings: [{
        id: 's-r', label: 'S1', panelCount: 48, panelId: 'rec-alpha-pure-405',
        tilt: 33, azimuth: 170, roofType: 'metal', mountingSystem: 'roof-tech-rt-mini',
        wireGauge: '#8 AWG', wireLength: 42, subSystemKey: 'roof' as const,
      }],
    }];
    const fleet = deriveFleetFromMap({ subSystems: STOWELL_MAP, stampCounts: STAMPS, prev });
    const rs = bySub(fleet, 'roof')[0].strings[0];
    expect(rs.tilt).toBe(33);
    expect(rs.azimuth).toBe(170);
    expect(rs.wireGauge).toBe('#8 AWG');
    expect(rs.mountingSystem).toBe('roof-tech-rt-mini');
  });

  it('excludes a sub with no inverterId or zero stamp (no phantom fleet)', () => {
    const fleet = deriveFleetFromMap({
      subSystems: { roof: STOWELL_MAP.roof, ground: { panelId: 'longi-himo6-580' } },
      stampCounts: { roof: 48, ground: 16 },
    });
    expect(bySub(fleet, 'roof').length).toBeGreaterThan(0);
    expect(bySub(fleet, 'ground').length).toBe(0); // no inverterId → excluded
  });
});
