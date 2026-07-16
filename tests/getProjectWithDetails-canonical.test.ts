/** @vitest-environment node */
/**
 * E2E read-path proof: GET /api/projects/[id] -> getProjectWithDetails must return
 * the CANONICAL selected_equipment (what Engineering/Design last wrote) with
 * precedence over the stale productions.data_json snapshot. This is the fix for
 * the bug where an Engineering panel change (canonical-only write) never surfaced
 * to the Design Studio because this route only read the productions snapshot.
 */
import { describe, it, expect, vi } from 'vitest';
import { SOLAR_PANELS, BATTERIES } from '@/lib/equipment-db';

const NEW_PANEL = SOLAR_PANELS[0];
const OLD_PANEL = SOLAR_PANELS.find(p => p.id !== NEW_PANEL.id)!;
const BAT = BATTERIES[0];
const PROJECT_ID = '00000000-0000-0000-0000-0000000000dd';
const USER_ID = '00000000-0000-0000-0000-0000000000ee';

// Canonical column value — as the Engineering write-back would have stored it.
const canonical = {
  panelId: NEW_PANEL.id,
  panel: { id: NEW_PANEL.id, manufacturer: NEW_PANEL.manufacturer, model: NEW_PANEL.model, wattage: NEW_PANEL.watts, width: 1.13, height: 1.72, efficiency: NEW_PANEL.efficiency, bifacial: true, bifacialFactor: 1.2, temperatureCoeff: -0.34, pricePerWatt: 0 },
  batteries: [{ id: BAT.id, manufacturer: BAT.manufacturer, model: BAT.model, capacityKwh: BAT.usableCapacityKwh, powerKw: BAT.continuousPowerKw, roundTripEfficiency: BAT.roundTripEfficiencyPct, chemistry: 'LFP', pricePerUnit: 0 }],
  batteryCount: 2,
  source: 'engineering',
};

// Mock only getDbReady; keep the REAL hydrateCanonicalEquipment / rowToLayout / parseDbFloat.
vi.mock('@/lib/db/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/core')>();
  const sql = (strings: TemplateStringsArray) => {
    const q = strings.join(' ');
    if (q.includes('FROM projects p')) {
      return Promise.resolve([{
        id: PROJECT_ID, user_id: USER_ID, name: 'Braidon', status: 'design', system_type: 'roof',
        created_at: '2026-07-07', updated_at: '2026-07-07',
        selected_equipment: canonical,       // canonical column populated by the write-back
      }]);
    }
    if (q.includes('FROM layouts')) return Promise.resolve([]);
    if (q.includes('FROM productions')) {
      // Stale design-time snapshot still points at the OLD panel.
      return Promise.resolve([{ data_json: { production: { annualProductionKwh: 1 }, costEstimate: {}, selectedPanel: OLD_PANEL, selectedInverter: null } }]);
    }
    return Promise.resolve([]);
  };
  return { ...actual, getDbReady: async () => sql };
});

import { getProjectWithDetails } from '@/lib/db/production';

describe('getProjectWithDetails — canonical equipment wins over productions snapshot', () => {
  it('returns the CANONICAL panel + batteries, not the stale productions.data_json panel', async () => {
    const project = await getProjectWithDetails(PROJECT_ID, USER_ID);
    expect(project).not.toBeNull();
    // canonical NEW panel, not the OLD snapshot panel
    expect(project!.selectedPanel?.id).toBe(NEW_PANEL.id);
    expect(project!.selectedPanel?.id).not.toBe(OLD_PANEL.id);
    // battery flowed through too
    expect(project!.selectedBatteries).toHaveLength(1);
    expect(project!.selectedBatteries?.[0].manufacturer).toBe(BAT.manufacturer);
    expect(project!.batteryCount).toBe(2);
  });
});
