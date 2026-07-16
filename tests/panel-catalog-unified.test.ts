/** @vitest-environment node */
/**
 * Single source of truth for the equipment catalog: every panel / inverter /
 * battery the DESIGN offers must resolve in ENGINEERING's equipment-db, so a
 * pick in Design is renderable/selectable in Engineering and resolves in the
 * planset (the canonical id syncs both sides).
 */
import { describe, it, expect } from 'vitest';
import {
  SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, OPTIMIZERS, BATTERIES,
  getPanelById, getInverterById, getBatteryById,
} from '@/lib/equipment-db';
import { getAllUnifiedPanels, getAllUnifiedInverters } from '@/lib/equipment-library';
import db from '@/lib/db';

describe('equipment catalog is single-source (design ⊆ engineering)', () => {
  it('every design PANEL resolves in engineering', () => {
    const engIds = new Set(SOLAR_PANELS.map(p => p.id));
    const missing = getAllUnifiedPanels(db.getPanels()).filter(p => !engIds.has(p.id));
    expect(missing.map(p => `${p.id} (${p.model})`)).toEqual([]);
  });

  it('every design INVERTER resolves in engineering', () => {
    const engIds = new Set([...STRING_INVERTERS, ...MICROINVERTERS, ...OPTIMIZERS].map(i => i.id));
    // /api/hardware now serves inverters from the engineering DB directly.
    const missing = getAllUnifiedInverters([]).filter(i => !engIds.has(i.id));
    expect(missing.map(i => `${i.id} (${i.model})`)).toEqual([]);
    expect(getAllUnifiedInverters([]).length).toBeGreaterThan(30);
  });

  it('every design BATTERY resolves in engineering', () => {
    const engIds = new Set(BATTERIES.map(b => b.id));
    const designBatteries = db.getBatteries ? db.getBatteries() : [];
    const missing = designBatteries.filter((b: { id: string }) => !engIds.has(b.id));
    expect(missing.map((b: { id: string; model: string }) => `${b.id} (${b.model})`)).toEqual([]);
  });

  it('curated items are engineering-resolvable by id', () => {
    expect(getPanelById('panel-std440')).toBeDefined();          // Jinko Eagle Neo 440
    expect(getPanelById('rec-alpha-pure-405')).toBeDefined();    // REC 405
    expect(getBatteryById('bat-lg1')).toBeDefined();             // LG RESU16H (migrated)
    expect(getBatteryById('bat-fp1')).toBeDefined();             // Fortress eVault (migrated)
    expect(getInverterById('se-7600h')).toBeDefined();           // SolarEdge
  });
});
