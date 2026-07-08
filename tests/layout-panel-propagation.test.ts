/** @vitest-environment node */
/**
 * Design→Engineering reciprocation: when the designer changes the panel, the
 * layout auto-save route must (1) write the canonical selected_equipment and
 * (2) update the saved engineering_config's per-string panelId so Engineering
 * reflects it on next load — without clobbering an engineering-only choice when
 * the design panel didn't actually change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SOLAR_PANELS } from '@/lib/equipment-db';
import { applyPanelToEngineeringConfig } from '@/lib/system/selectedEquipment';

const OLD = SOLAR_PANELS[0];
const NEW = SOLAR_PANELS.find(p => p.id !== OLD.id)!;
const PROJECT_ID = '00000000-0000-0000-0000-0000000000f0';
const USER_ID = '00000000-0000-0000-0000-0000000000f1';

// ── Pure helper ──────────────────────────────────────────────────────────────
describe('applyPanelToEngineeringConfig', () => {
  const cfg = { inverters: [{ id: 'i1', strings: [{ id: 's1', panelId: OLD.id }, { id: 's2', panelId: OLD.id }] }], batteryCount: 0 };

  it('updates every string panelId, preserving other fields', () => {
    const out = applyPanelToEngineeringConfig(cfg, NEW.id) as typeof cfg;
    expect(out).not.toBeNull();
    expect(out.inverters[0].strings.every(s => s.panelId === NEW.id)).toBe(true);
    expect(out.batteryCount).toBe(0); // untouched
  });
  it('returns null when every string already on the panel (no clobber)', () => {
    expect(applyPanelToEngineeringConfig(cfg, OLD.id)).toBeNull();
  });
  it('returns null for missing config/strings', () => {
    expect(applyPanelToEngineeringConfig(null, NEW.id)).toBeNull();
    expect(applyPanelToEngineeringConfig({}, NEW.id)).toBeNull();
  });
});

// ── Route integration ────────────────────────────────────────────────────────
const upsertEqSpy = vi.fn(async () => true);
const sqlSpy = vi.fn();

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: USER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/engineering/syncPipeline', () => ({
  syncProjectPipeline: async () => ({ panelCount: 1, artifactsWritten: 0, wasRebuilt: true, errors: [], files: [] }),
}));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getProjectById: async () => ({
    id: PROJECT_ID, systemType: 'roof',
    engineeringConfig: { inverters: [{ id: 'i1', strings: [{ id: 's1', panelId: OLD.id }] }] },
  }),
  getLayoutByProject: async () => ({ systemType: 'roof', designElectrical: { panelId: OLD.id } }),
  upsertLayout: async () => ({ id: 'lay1', panels: [{ id: 'p1' }], roofPlanes: [] }),
  saveProjectVersion: () => Promise.resolve(),
  getDbReady: async () => (strings: TemplateStringsArray, ...vals: unknown[]) => { sqlSpy(strings.join(' '), vals); return Promise.resolve([]); },
  upsertSelectedEquipment: (...a: unknown[]) => upsertEqSpy(...(a as [])),
}));

import { POST } from '@/app/api/projects/[id]/layout/route';

function makeReq(panelId: string) {
  return new Request(`http://localhost/api/projects/${PROJECT_ID}/layout`, {
    method: 'POST',
    body: JSON.stringify({ panels: [{ wattage: 440 }], systemType: 'roof', designElectrical: { panelId } }),
  }) as never;
}
const ctx = { params: Promise.resolve({ id: PROJECT_ID }) };

describe('POST layout route — design panel change propagation', () => {
  beforeEach(() => { upsertEqSpy.mockClear(); sqlSpy.mockClear(); });

  it('writes canonical + updates engineering_config when the design panel changes', async () => {
    const res = await POST(makeReq(NEW.id), ctx);
    expect((await res.json()).success).toBe(true);

    // canonical write with the NEW panel
    expect(upsertEqSpy).toHaveBeenCalledTimes(1);
    const patch = (upsertEqSpy.mock.calls[0] as unknown as unknown[])[2] as { panelId?: string; source?: string };
    expect(patch.panelId).toBe(NEW.id);
    expect(patch.source).toBe('design');

    // engineering_config UPDATE issued with the new panelId
    const engUpdate = sqlSpy.mock.calls.find(c => String(c[0]).includes('engineering_config'));
    expect(engUpdate).toBeDefined();
    expect(String(engUpdate![1])).toContain(NEW.id);
  });

  it('does NOT propagate when the design panel is unchanged (moving panels only)', async () => {
    const res = await POST(makeReq(OLD.id), ctx); // same as existing layout designElectrical.panelId
    expect((await res.json()).success).toBe(true);
    expect(upsertEqSpy).not.toHaveBeenCalled();
    expect(sqlSpy.mock.calls.find(c => String(c[0]).includes('engineering_config'))).toBeUndefined();
  });
});
