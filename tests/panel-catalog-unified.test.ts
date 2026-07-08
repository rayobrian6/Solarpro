/** @vitest-environment node */
/**
 * Single source of truth for the panel catalog: every panel the DESIGN offers
 * (the unified /api/hardware list) must resolve in ENGINEERING's SOLAR_PANELS,
 * so a panel picked in Design is renderable/selectable in Engineering (and the
 * canonical panelId resolves on both sides).
 */
import { describe, it, expect } from 'vitest';
import { SOLAR_PANELS, getPanelById } from '@/lib/equipment-db';
import { getAllUnifiedPanels } from '@/lib/equipment-library';
import db from '@/lib/db';

describe('panel catalog is single-source (design ⊆ engineering)', () => {
  const engIds = new Set(SOLAR_PANELS.map(p => p.id));
  const designPanels = getAllUnifiedPanels(db.getPanels());

  it('every design panel id resolves in engineering', () => {
    const missing = designPanels.filter(p => !engIds.has(p.id));
    expect(missing.map(p => `${p.id} (${p.model})`)).toEqual([]);
  });

  it('REC 405 exists in the single source', () => {
    const rec405 = SOLAR_PANELS.find(p => p.manufacturer === 'REC Group' && p.watts === 405);
    expect(rec405).toBeDefined();
    expect(getPanelById(rec405!.id)).toBeDefined();
  });

  it('curated design panels (e.g. Jinko Eagle Neo 440) are engineering-resolvable', () => {
    for (const id of ['panel-std440', 'panel-jk2', 'panel-cs2', 'panel-fence1']) {
      expect(getPanelById(id), `getPanelById(${id})`).toBeDefined();
    }
  });
});
