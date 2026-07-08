/** @vitest-environment node */
/**
 * The Design Studio's immediate canonical write on panel selection.
 * POST /api/projects/[id]/equipment must persist the full panel object to the
 * canonical selected_equipment store so Engineering reads it on next load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = '00000000-0000-0000-0000-0000000000c1';
const PROJECT_ID = '00000000-0000-0000-0000-0000000000c2';
const upsertSpy = vi.fn(async () => true);

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: USER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  upsertSelectedEquipment: (...a: unknown[]) => upsertSpy(...(a as [])),
}));

import { POST } from '@/app/api/projects/[id]/equipment/route';

const ctx = { params: Promise.resolve({ id: PROJECT_ID }) };
function req(body: unknown) {
  return new Request(`http://localhost/api/projects/${PROJECT_ID}/equipment`, {
    method: 'POST', body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/projects/[id]/equipment', () => {
  beforeEach(() => upsertSpy.mockClear());

  it('writes the full panel to canonical as source=design', async () => {
    const panel = { id: 'jinko-tiger-neo-580', manufacturer: 'Jinko', model: 'Tiger Neo 580W', wattage: 580 };
    const res = await POST(req({ selectedPanel: panel }), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.panelId).toBe('jinko-tiger-neo-580');
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const patch = (upsertSpy.mock.calls[0] as unknown as unknown[])[2] as { panelId?: string; panel?: unknown; source?: string };
    expect(patch.panelId).toBe('jinko-tiger-neo-580');
    expect(patch.panel).toEqual(panel);
    expect(patch.source).toBe('design');
  });

  it('rejects when no equipment is provided', async () => {
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
