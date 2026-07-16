import { describe, it, expect } from 'vitest';
import { rowToProject } from './core';

// Minimal projects row (only the columns rowToProject reads).
function baseRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    name: 'Test',
    status: 'design',
    system_type: 'roof',
    created_at: '2026-07-07T00:00:00.000Z',
    updated_at: '2026-07-07T00:00:00.000Z',
    ...extra,
  };
}

const CANON = {
  panelId: 'panel-fence-ps1',
  panel: { id: 'panel-fence-ps1', manufacturer: 'Philadelphia Solar', model: 'Nexus PS-MNB108(HCBF)-440W', wattage: 440, width: 1.133, height: 1.722, efficiency: 22.57, bifacial: true, bifacialFactor: 1.2, temperatureCoeff: -0.34, pricePerWatt: 0 },
  batteries: [{ id: 'bat-1', manufacturer: 'Tesla', model: 'PW3', capacityKwh: 13.5, powerKw: 11.5, roundTripEfficiency: 90, chemistry: 'LFP', pricePerUnit: 0 }],
  batteryCount: 2,
  source: 'engineering',
};

describe('rowToProject: canonical selected_equipment hydration (migration 101)', () => {
  it('hydrates panel + batteries from a JSONB object', () => {
    const p = rowToProject(baseRow({ selected_equipment: CANON }));
    expect(p.selectedPanel?.id).toBe('panel-fence-ps1');
    expect(p.selectedPanel?.wattage).toBe(440);
    expect(p.selectedBatteries).toHaveLength(1);
    expect(p.batteryCount).toBe(2);
  });

  it('parses selected_equipment when the driver returns it as a JSON string', () => {
    const p = rowToProject(baseRow({ selected_equipment: JSON.stringify(CANON) }));
    expect(p.selectedPanel?.id).toBe('panel-fence-ps1');
    expect(p.batteryCount).toBe(2);
  });

  it('leaves equipment undefined when the column is absent (pre-migration / legacy fallback)', () => {
    const p = rowToProject(baseRow());
    expect(p.selectedPanel).toBeUndefined();
    expect(p.selectedBatteries).toBeUndefined();
    expect(p.batteryCount).toBeUndefined();
  });

  it('never throws on malformed JSON — degrades to undefined', () => {
    let p!: ReturnType<typeof rowToProject>;
    expect(() => { p = rowToProject(baseRow({ selected_equipment: '{not valid json' })); }).not.toThrow();
    expect(p.selectedPanel).toBeUndefined();
  });
});
