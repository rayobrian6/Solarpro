// ============================================================================
// Wave 0 regression bar — see docs/ARCHITECTURE-per-subsystem-equipment.md
// (§3 Wave 0; Wave 1 adds schemaVersion:2 + server re-normalization to the
// save-config route, Wave 3 re-keys the selected_equipment reconcile per sub).
//
// Pins the PURE write-back helper the save-config route persists through:
// reconcileFromEngineeringConfig (lib/system/selectedEquipment.ts) on a legacy
// (untagged, single-system) ProjectConfig. The emitted SelectedEquipment patch
// shape — panel translation, battery translation, no-change null — must be
// unchanged for legacy configs after every wave.
// Snapshots live in tests/goldens/__snapshots__/ and are committed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { reconcileFromEngineeringConfig } from '../../lib/system/selectedEquipment';
import { getPanelById, getBatteryById } from '../../lib/equipment-db';

const NOW = '2026-07-11T00:00:00.000Z'; // injected clock — helper takes `now`

// Legacy single-system engineering config (same shape the save-config route
// receives today: flat scalars + inverters[].strings[], NO subSystems map).
const legacyConfig = (panelId: string) => ({
  projectName: 'Wave0 Golden', systemType: 'roof', mountingId: 'ironridge-xr100',
  batteryId: 'tesla-powerwall-3', batteryBrand: 'Tesla', batteryModel: 'Powerwall 3',
  batteryCount: 2, batteryKwh: 27,
  inverters: [
    {
      id: 'inv1', inverterId: 'enphase-iq8plus', type: 'micro',
      strings: [{
        id: 's1', label: 'S1', panelId, panelCount: 20, tilt: 20, azimuth: 180,
        roofType: 'shingle', mountingSystem: 'ironridge-xr100',
        wireGauge: '#10', wireLength: 50,
      }],
    },
  ],
});

// Design currently on a DIFFERENT panel and no battery → both blocks change.
const projectView = {
  selectedPanel: { id: 'sp-maxeon7-440' } as never,
  selectedInverter: null as never,
  selectedMounting: null as never,
  selectedBatteries: [] as never[],
  batteryCount: 0,
} as Parameters<typeof reconcileFromEngineeringConfig>[1];

describe('Wave 0 golden — save-config write-back (reconcileFromEngineeringConfig)', () => {
  it('fixture ids resolve in equipment-db (golden precondition)', () => {
    expect(getPanelById('tesla-tsp-420')).toBeTruthy();
    expect(getPanelById('sp-maxeon7-440')).toBeTruthy();
    expect(getBatteryById('tesla-powerwall-3')).toBeTruthy();
  });

  it('panel + battery change on a legacy config emits the pre-contract patch shape', () => {
    const patch = reconcileFromEngineeringConfig(legacyConfig('tesla-tsp-420'), projectView, NOW);
    expect(patch).not.toBeNull();
    // Whole persisted patch — this IS what upsertSelectedEquipment writes.
    expect(patch).toMatchSnapshot();
    // Load-bearing invariants, asserted explicitly as well:
    expect(patch!.source).toBe('engineering');
    expect(patch!.updatedAt).toBe(NOW);
    expect(patch!.panelId).toBe('tesla-tsp-420');
    expect(patch!.batteryId).toBe('tesla-powerwall-3');
    expect(patch!.batteryCount).toBe(2);
  });

  it('no-op when the design already matches (caller skips the DB write)', () => {
    const matchedView = {
      ...(projectView as object),
      selectedPanel: { id: 'tesla-tsp-420' },
      selectedBatteries: [{ id: 'tesla-powerwall-3' }],
      batteryCount: 2,
    } as Parameters<typeof reconcileFromEngineeringConfig>[1];
    expect(reconcileFromEngineeringConfig(legacyConfig('tesla-tsp-420'), matchedView, NOW)).toBeNull();
  });

  it('battery REMOVED in engineering clears the design battery (legacy clear-patch shape)', () => {
    const cfg = { ...legacyConfig('tesla-tsp-420'), batteryId: '', batteryCount: 0, batteryKwh: 0 };
    const viewWithBattery = {
      ...(projectView as object),
      selectedPanel: { id: 'tesla-tsp-420' }, // panel matches → only battery block emits
      selectedBatteries: [{ id: 'tesla-powerwall-3' }],
      batteryCount: 2,
    } as Parameters<typeof reconcileFromEngineeringConfig>[1];
    const patch = reconcileFromEngineeringConfig(cfg, viewWithBattery, NOW);
    expect(patch).toMatchSnapshot();
    expect(patch!.batteryId).toBe('');
    expect(patch!.batteryCount).toBe(0);
    expect(patch!.batteries).toEqual([]);
  });
});
