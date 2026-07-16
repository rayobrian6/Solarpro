import { describe, it, expect } from 'vitest';
import { reconcileFromEngineeringConfig, batterySystemToBattery } from './selectedEquipment';
import { SOLAR_PANELS, BATTERIES, getPanelById } from '@/lib/equipment-db';

const NOW = '2026-07-07T00:00:00.000Z';

// Two real panels that both exist in the DB, for change detection.
const PANEL_A = SOLAR_PANELS[0];
const PANEL_B = SOLAR_PANELS.find(p => p.id !== PANEL_A.id)!;

function cfgWithPanel(panelId: string, extra: Record<string, unknown> = {}) {
  return {
    inverters: [
      { id: 'inv1', inverterId: 'enphase-iq8plus', type: 'micro',
        strings: [{ id: 's1', panelId, panelCount: 10 }] },
    ],
    ...extra,
  };
}

describe('reconcileFromEngineeringConfig', () => {
  it('returns a resolved panel patch when the engineering panel differs from design', () => {
    const patch = reconcileFromEngineeringConfig(
      cfgWithPanel(PANEL_B.id),
      { selectedPanel: PANEL_A } as never,
      NOW,
    );
    expect(patch).not.toBeNull();
    expect(patch!.panelId).toBe(PANEL_B.id);
    expect(patch!.panel?.id).toBe(PANEL_B.id);
    // Mapped equipment-db.watts -> @/types.wattage, and inches -> meters.
    expect(patch!.panel?.wattage).toBe(PANEL_B.watts);
    expect(patch!.panel?.width).toBeCloseTo(PANEL_B.width * 0.0254, 3);
    expect(patch!.panel?.height).toBeCloseTo(PANEL_B.length * 0.0254, 3);
    expect(patch!.source).toBe('engineering');
  });

  it('returns null when the panel already matches design (no needless rebuild)', () => {
    const patch = reconcileFromEngineeringConfig(
      cfgWithPanel(PANEL_A.id),
      { selectedPanel: PANEL_A } as never,
      NOW,
    );
    expect(patch).toBeNull();
  });

  it('fail-safe: unresolvable panelId writes nothing (never corrupts design)', () => {
    const patch = reconcileFromEngineeringConfig(
      cfgWithPanel('not-a-real-panel-id'),
      { selectedPanel: PANEL_A } as never,
      NOW,
    );
    expect(patch).toBeNull();
  });

  it('picks the DOMINANT panel across strings (weighted by count)', () => {
    const cfg = {
      inverters: [
        { id: 'i1', inverterId: 'enphase-iq8plus', type: 'micro', strings: [
          { id: 's1', panelId: PANEL_A.id, panelCount: 4 },
          { id: 's2', panelId: PANEL_B.id, panelCount: 20 },
        ] },
      ],
    };
    const patch = reconcileFromEngineeringConfig(cfg, { selectedPanel: undefined } as never, NOW);
    expect(patch!.panelId).toBe(PANEL_B.id);
  });

  it('writes back a resolved battery + count when engineering adds one', () => {
    const bat = BATTERIES[0];
    const patch = reconcileFromEngineeringConfig(
      cfgWithPanel(PANEL_A.id, { batteryId: bat.id, batteryCount: 2, batteryKwh: bat.usableCapacityKwh }),
      { selectedPanel: PANEL_A } as never, // panel unchanged -> only battery drives the patch
      NOW,
    );
    expect(patch).not.toBeNull();
    expect(patch!.batteryId).toBe(bat.id);
    expect(patch!.batteryCount).toBe(2);
    expect(patch!.batteries).toHaveLength(1);
    expect(patch!.batteries![0].manufacturer).toBe(bat.manufacturer);
  });

  it('clears the battery from design when engineering removes it', () => {
    const patch = reconcileFromEngineeringConfig(
      cfgWithPanel(PANEL_A.id, { batteryId: '', batteryCount: 0 }),
      { selectedPanel: PANEL_A, selectedBatteries: [{ id: 'old-bat' }], batteryCount: 3 } as never,
      NOW,
    );
    expect(patch).not.toBeNull();
    expect(patch!.batteryCount).toBe(0);
    expect(patch!.batteries).toEqual([]);
  });

  it('returns null for empty/garbage config', () => {
    expect(reconcileFromEngineeringConfig(null, { selectedPanel: PANEL_A } as never, NOW)).toBeNull();
    expect(reconcileFromEngineeringConfig({}, { selectedPanel: PANEL_A } as never, NOW)).toBeNull();
  });
});

describe('batterySystemToBattery', () => {
  it('maps spec fields and collapses NCA chemistry to NMC', () => {
    const src = { ...BATTERIES[0], chemistry: 'NCA' as const };
    const b = batterySystemToBattery(src);
    expect(b.id).toBe(src.id);
    expect(b.capacityKwh).toBe(src.usableCapacityKwh);
    expect(b.chemistry).toBe('NMC');
  });
});
