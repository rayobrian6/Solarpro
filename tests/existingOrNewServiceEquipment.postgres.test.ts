// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EXISTING OR NEW — UNANSWERED / EXISTING / NEW survive the real write path, distinctly.
//
// Ray (engineering closure, §4): "If UNANSWERED is a legitimate semantic state, the persistence
// layer must preserve it. Do not force existing or new merely because the database cannot represent
// unanswered... Preserve UNANSWERED / EXISTING / NEW distinctly."
//
// The UI action is the answer the Service card's existing-or-new control writes
// (`answerExistingService`); the persistence is the page's one write path (`PUT
// /api/projects/[id]/service-topology`); the reload is the page's own read (`GET` the same route) and
// the server's (`loadElectricalProject`, which the SLD / BOM / permit routes read); the output is
// `POST /api/engineering/sld`. Real route handlers, real PostgreSQL (PGlite), the real JSONB column.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ExistingOrNew, ServiceTopology } from '@/lib/electrical/serviceTopology';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '7c3e9f4a-2e3d-4b9a-9f77-5c1d0e9f8a03';
const MODULE = 'panel-std440';
let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') return (await pg.query(strings, (values[0] as unknown[]) ?? [])).rows;
    let text = ''; const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    return (await pg.query(text, params)).rows;
  }) as unknown as never;
}
vi.mock('@/lib/db-neon', async (o) => ({
  ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/db/core', async (o) => ({
  ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/auth', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, email: 'ray@example.com', name: 'Ray' }),
}));

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  const nc = (s: string) => s.replace(/CONCURRENTLY/gi, '');
  await db.exec(nc(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(nc(read('lib', 'migrations', '002_project_coordinates.sql')));
  for (const c of [
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`,
  ]) await db.exec(c);
  await Promise.all([
    import('@/app/api/projects/[id]/service-topology/route'),
    import('@/app/api/engineering/sld/route'),
    import('@/lib/electrical/loadElectricalProject'),
  ]);
}, 90_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment, engineering_config)
     VALUES ($1, $2, 'Existing Or New', 'lead', 'roof', '12 Elm St, Peoria, IL', $3, $4)`,
    [HOUSE, USER_ID,
     JSON.stringify({ panelId: MODULE, inverter: { id: 'enphase-iq8m', type: 'micro' }, inverterId: 'enphase-iq8m' }),
     JSON.stringify({ schemaVersion: 2, inverters: [{ inverterId: 'enphase-iq8m', type: 'micro',
       strings: [{ panelId: MODULE, panelCount: 20 }] }] })]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'roof',$3::jsonb,20)`,
    [HOUSE, USER_ID, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, wattage: 440 })))]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };

/** The page's one write path. */
async function persist(t: ServiceTopology) {
  const { PUT } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await PUT(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topology: t }),
  }), ctx);
  expect(res.status, JSON.stringify(await res.clone().json()).slice(0, 300)).toBe(200);
}

/** The page's own read — the reload. */
async function reload(): Promise<ServiceTopology> {
  const { GET } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`), ctx);
  const json = await res.json() as { available: boolean; topology: ServiceTopology };
  expect(json.available).toBe(true);
  return json.topology;
}

/** The bytes in the column, exactly. */
async function storedService(): Promise<Record<string, unknown>> {
  const rows = (await db.query<{ service_topology: { topology: { service: Record<string, unknown> } } }>(
    'SELECT service_topology FROM projects WHERE id = $1', [HOUSE])).rows;
  return rows[0].service_topology.topology.service;
}

/** The sheet, through the real SLD route, with a page body that knows nothing about the service. */
async function sheetText(): Promise<string> {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: HOUSE, format: 'json', projectName: 'Existing Or New', address: '12 Elm St, Peoria, IL',
      topologyType: 'MICROINVERTER', inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
      inverterId: 'enphase-iq8m', totalModules: 20, deviceCount: 20,
      panelModel: 'Jinko Eagle Neo', panelWatts: 440, panelVoc: 39.6, panelIsc: 14.1, panelVmp: 33.0, panelImp: 13.3,
      mainPanelAmps: 200, interconnection: 'UNRESOLVED', utilityName: 'Ameren Illinois',
    }),
  }));
  expect(res.status).toBe(200);
  const json = await res.json() as Record<string, unknown>;
  return String(json.svg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const interviewOf = async (t: ServiceTopology) => {
  const { buildSystemConfigInterview } = await import('@/lib/electrical/systemConfigInterview');
  const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  return buildSystemConfigInterview({
    pvArray: resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: MODULE }),
    topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });
};
const existingItem = async (t: ServiceTopology) =>
  (await interviewOf(t)).sections.flatMap(s => s.items).find(i => i.id === 'service.existing')!;

/** A 200 A house answered through the card's writers: the rating, then the existing-or-new answer. */
async function answered(existing: boolean | null): Promise<ServiceTopology> {
  const { answerServiceRating, answerExistingService } = await import('@/lib/electrical/systemConfigAnswers');
  const svc = answerServiceRating(null, 200);
  if (svc.ok === false) throw new Error(svc.refused);
  await persist(svc.topology);
  const r = answerExistingService(await reload(), { existing, ...(existing ? { manufacturer: 'Eaton' } : {}) });
  if (r.ok === false) throw new Error(r.refused);
  await persist(r.topology);
  return reload();
}

describe('🚨 PUT → GET reads UNANSWERED / EXISTING / NEW back distinctly', () => {
  it.each([
    [null, 'unanswered', 'needs-answer', 'Not established'],
    [true, 'existing', 'needs-verification', 'Not established'],
    [false, 'new', 'answered', 'Installer entered'],
  ] as const)('answer %s → stored and reloaded as %s (%s, %s)', async (existing, want, state, source) => {
    const back = await answered(existing);
    const { serviceExistingOrNew } = await import('@/lib/electrical/serviceTopology');
    expect(serviceExistingOrNew(back.service)).toBe<ExistingOrNew>(want);
    expect(back.service.existingOrNew).toBe(want);
    // The column holds the answer itself — not a null that two answers share.
    expect((await storedService()).existingOrNew).toBe(want);
    expect(back.service.existingEquipment?.manufacturer ?? null).toBe(want === 'existing' ? 'Eaton' : null);
    const i = await existingItem(back);
    expect([i.state, i.source]).toEqual([state, source]);
    if (want === 'unanswered') expect(i.answer ?? '').not.toMatch(/new/i);
  });

  it('🚨 "not answered" survives an unrelated save — it does not become "new" on the next PUT', async () => {
    const { answerAvailableFaultCurrent } = await import('@/lib/electrical/systemConfigAnswers');
    const before = await answered(null);
    const r = answerAvailableFaultCurrent(before, 10_000);
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const back = await reload();
    expect(back.service.availableFaultCurrentA).toBe(10_000);
    expect(back.service.existingOrNew).toBe('unanswered');
  });

  it('taking a recorded answer back to "not answered" is persisted as not answered — the reading discarded', async () => {
    const { answerExistingService } = await import('@/lib/electrical/systemConfigAnswers');
    const existing = await answered(true);
    const r = answerExistingService(existing, { existing: null });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const back = await reload();
    expect([back.service.existingOrNew, back.service.existingEquipment]).toEqual(['unanswered', null]);
  });

  it('the server\'s own read (loadElectricalProject — the SLD / BOM / permit routes) agrees with the page\'s', async () => {
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    for (const existing of [null, true, false] as const) {
      const back = await answered(existing);
      const loaded = await loadElectricalProject(HOUSE, USER_ID);
      expect(loaded!.model.topology!.service.existingOrNew).toBe(back.service.existingOrNew);
    }
  });
});

describe('🚨 rows written before the answer existed', () => {
  const legacy = async (service: Record<string, unknown>) => {
    const { answerServiceRating } = await import('@/lib/electrical/systemConfigAnswers');
    const svc = answerServiceRating(null, 200);
    if (svc.ok === false) throw new Error(svc.refused);
    // The bytes a schema-4 build stored: no `existingOrNew`, and `existingEquipment` as it left it.
    const row = { schemaVersion: 4, updatedAt: '2026-09-01T00:00:00Z', topology: { ...svc.topology, service } };
    await db.query('UPDATE projects SET service_topology = $1::jsonb WHERE id = $2', [JSON.stringify(row), HOUSE]);
  };
  const OLD = { ratedAmps: 200, voltage: 240, phase: 'split-240', availableFaultCurrentA: null };

  it('🚨 a stored null reading reloads as NOT ANSWERED — "needs-answer", "Not established", never "New … Installer entered"', async () => {
    await legacy({ ...OLD, existingEquipment: null });
    const back = await reload();
    expect(back.service.existingOrNew).toBe('unanswered');
    const i = await existingItem(back);
    expect([i.state, i.source, i.answer]).toEqual(['needs-answer', 'Not established', undefined]);
  });

  it('an absent field reloads as NOT ANSWERED too', async () => {
    await legacy({ ...OLD });
    expect((await reload()).service.existingOrNew).toBe('unanswered');
  });

  it('a stored reading reloads as EXISTING, everything read kept', async () => {
    await legacy({ ...OLD, existingEquipment: { manufacturer: 'Eaton', catalogNumber: 'CH42B200', verified: false } });
    const back = await reload();
    expect(back.service.existingOrNew).toBe('existing');
    expect(back.service.existingEquipment).toMatchObject({ manufacturer: 'Eaton', catalogNumber: 'CH42B200', verified: false });
  });
});

describe('🚨 the sheet says what was answered — read from the store, not the page', () => {
  it('UNANSWERED: "EXISTING OR NEW — NOT ESTABLISHED"; no "CONFIGURATION TO VERIFY" dropped or invented', async () => {
    await answered(null);
    const text = await sheetText();
    expect(text).toContain('EXISTING OR NEW — NOT ESTABLISHED');
    expect(text).not.toContain('NEW SERVICE EQUIPMENT');
  });

  it('EXISTING: "EXISTING 200 A SERVICE EQUIPMENT — CONFIGURATION TO VERIFY"', async () => {
    await answered(true);
    const text = await sheetText();
    expect(text).toContain('EXISTING 200 A SERVICE EQUIPMENT');
    expect(text).toContain('CONFIGURATION TO VERIFY');
    expect(text).not.toContain('EXISTING OR NEW — NOT ESTABLISHED');
  });

  it('NEW: "NEW SERVICE EQUIPMENT" — and nothing to verify, and no existing-or-new question', async () => {
    await answered(false);
    const text = await sheetText();
    expect(text).toContain('NEW SERVICE EQUIPMENT');
    expect(text).not.toContain('CONFIGURATION TO VERIFY');
    expect(text).not.toContain('EXISTING OR NEW — NOT ESTABLISHED');
  });
});
