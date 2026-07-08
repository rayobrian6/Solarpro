/**
 * Route-level integration test for the Engineering→Design equipment write-back.
 * Drives the REAL POST handler with the DB + auth mocked, proving the full
 * server pipeline: save engineering_config → reconcile the new panel → write the
 * canonical selected_equipment store. No browser cache in the way — a
 * deterministic yes/no on "is the duplex pipeline functional".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SOLAR_PANELS } from '@/lib/equipment-db';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const PROJECT_ID = '00000000-0000-0000-0000-0000000000bb';

const OLD_PANEL = SOLAR_PANELS[0];
const NEW_PANEL = SOLAR_PANELS.find(p => p.id !== OLD_PANEL.id)!;

// ── Mocks ────────────────────────────────────────────────────────────────────
const upsertSpy = vi.fn(async () => true);
let projectPanelId = OLD_PANEL.id; // the design's CURRENT panel (what we diff against)

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: () => ({ id: USER_ID }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  // The route calls sql`ALTER ...` twice, then sql`UPDATE ... engineering_config ...`.
  getDbReady: async () => {
    const sql = (strings: TemplateStringsArray) => {
      const q = strings.join(' ');
      if (q.includes('engineering_config') && q.includes('UPDATE')) {
        return Promise.resolve([{ id: PROJECT_ID, engineering_updated_at: '2026-07-07T00:00:00Z' }]);
      }
      return Promise.resolve([]);
    };
    return sql;
  },
  getProjectById: async () => ({ selectedPanel: { id: projectPanelId } }),
  upsertSelectedEquipment: (...args: unknown[]) => upsertSpy(...(args as [])),
}));

import { POST } from '@/app/api/engineering/save-config/route';

function makeReq(config: unknown, projectId: string = PROJECT_ID) {
  return new Request('http://localhost/api/engineering/save-config', {
    method: 'POST',
    body: JSON.stringify({ projectId, config }),
  }) as never;
}

function realisticConfig(panelId: string) {
  return {
    projectName: 'Braidon', systemType: 'roof', mountingId: 'rt-mini',
    batteryId: '', batteryBrand: '', batteryModel: '', batteryCount: 0, batteryKwh: 0,
    inverters: [
      { id: 'inv1', inverterId: 'enphase-iq8plus', type: 'micro',
        strings: [{ id: 's1', label: 'S1', panelId, panelCount: 52, tilt: 20, azimuth: 180, roofType: 'shingle', mountingSystem: 'rt-mini', wireGauge: '#10', wireLength: 50 }] },
    ],
  };
}

describe('POST /api/engineering/save-config — equipment write-back pipeline', () => {
  beforeEach(() => { upsertSpy.mockClear(); projectPanelId = OLD_PANEL.id; });

  it('writes the NEW panel to the canonical store when the engineer changes it', async () => {
    const res = await POST(makeReq(realisticConfig(NEW_PANEL.id)));
    const json = await res.json();
    expect(json.success).toBe(true);

    // The write-back fired with the resolved NEW panel.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [pid, uid, patch] = upsertSpy.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(pid).toBe(PROJECT_ID);
    expect(uid).toBe(USER_ID);
    expect((patch as { panelId?: string }).panelId).toBe(NEW_PANEL.id);
    expect((patch as { panel?: { wattage?: number } }).panel?.wattage).toBe(NEW_PANEL.watts);
    expect((patch as { source?: string }).source).toBe('engineering');
  });

  it('does NOT write when the engineering panel already matches the design (no needless rebuild)', async () => {
    projectPanelId = NEW_PANEL.id; // design already on the new panel
    const res = await POST(makeReq(realisticConfig(NEW_PANEL.id)));
    expect((await res.json()).success).toBe(true);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('still succeeds (save is not blocked) even if the write-back path finds nothing to change', async () => {
    projectPanelId = NEW_PANEL.id;
    const res = await POST(makeReq(realisticConfig(NEW_PANEL.id)));
    expect(res.status).toBe(200);
  });
});
