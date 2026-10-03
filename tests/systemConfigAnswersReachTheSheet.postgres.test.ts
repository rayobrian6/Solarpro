// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AN INSTALLER'S ANSWER, ALL THE WAY: action → graph → persistence → reload → interview →
//    drawing. Through the real route handlers on real PostgreSQL.
//
// Ray's testing standard for configuration decisions:
//   "UI action → state mutation → persistence → reload → calculation → output request → output
//    artifact. A helper unit test is not enough."
//
// The UI action is the answer function the System Config card calls (`systemConfigAnswers.ts`); the
// persistence is the one write path the page uses (`PUT /api/projects/[id]/service-topology`); the
// reload is the page's own read (`GET` the same route); the output is `POST /api/engineering/sld`
// with a STALE page body, so the sheet can only be right if it read the answer from the store.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '6b2f8d3e-1d2c-4a8f-8e66-4b0c9d8e7f02';
const MODULE = 'panel-std440';   // Jinko Eagle Neo 440 W
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
     VALUES ($1, $2, 'Normal Residence', 'lead', 'roof', '12 Elm St, Peoria, IL', $3, $4)`,
    [HOUSE, USER_ID,
     JSON.stringify({ panelId: MODULE, inverter: { id: 'enphase-iq8m', type: 'micro' }, inverterId: 'enphase-iq8m' }),
     JSON.stringify({ schemaVersion: 2, inverters: [{ inverterId: 'enphase-iq8m', type: 'micro',
       strings: [{ panelId: MODULE, panelCount: 20 }] }] })]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'roof',$3::jsonb,20)`,
    [HOUSE, USER_ID, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, wattage: 440 })))]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };

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

async function sheet(over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: HOUSE, format: 'json', projectName: 'Normal Residence', address: '12 Elm St, Peoria, IL',
      topologyType: 'MICROINVERTER', inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
      inverterId: 'enphase-iq8m', totalModules: 20, deviceCount: 20,
      panelModel: 'Jinko Eagle Neo', panelWatts: 440, panelVoc: 39.6, panelIsc: 14.1, panelVmp: 33.0, panelImp: 13.3,
      // 🚨 STALE: what the page held before the answers. The sheet must not draw these.
      mainPanelAmps: 100, interconnection: 'UNRESOLVED', utilityName: 'Ameren Illinois',
      ...over,
    }),
  }));
  const json = await res.json() as Record<string, any>;
  return { status: res.status, json, text: String(json.svg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
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

describe('🚨 the 200 A house, answered in System Config, reaches the drawing', () => {
  it('service 200 A → persisted → reloaded → interview asks nothing about multiple systems', async () => {
    const { answerServiceRating } = await import('@/lib/electrical/systemConfigAnswers');
    const r = answerServiceRating(null, 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await persist(r.topology);
    const back = await reload();
    expect(back.service.ratedAmps).toBe(200);
    expect(back.panels).toHaveLength(1);
    const iv = await interviewOf(back);
    const asked = iv.sections.flatMap(s => s.items.map(i => i.id));
    expect(asked).not.toContain('service.distribution');
    expect(asked).not.toContain('behavior.systems');
    expect(asked).not.toContain('behavior.backup');
  });

  it('"a breaker in the panel" → persisted → the canonical model and the SLD read LOAD SIDE from the store', async () => {
    const { answerServiceRating, answerInterconnection } = await import('@/lib/electrical/systemConfigAnswers');
    const svc = answerServiceRating(null, 200);
    if (svc.ok === false) throw new Error(svc.refused);
    await persist(svc.topology);
    const ic = answerInterconnection(await reload(), 'load-side-busbar');
    if (ic.ok === false) throw new Error(ic.refused);
    await persist(ic.topology);

    const { loadElectricalProject, interconnectionMethodScalar } = await import('@/lib/electrical/loadElectricalProject');
    const loaded = await loadElectricalProject(HOUSE, USER_ID);
    expect(interconnectionMethodScalar(loaded!.model.topology)?.value).toBe('LOAD_SIDE');
    expect(loaded!.model.serviceRatedAmps).toBe(200);

    const s = await sheet();
    expect(s.status, JSON.stringify(s.json).slice(0, 300)).toBe(200);
    expect(s.text).toContain('20 × 440W');
    expect(s.text).toMatch(/LOAD SIDE/i);
    expect(s.text).toMatch(/Service Rating 200 A/);
    expect(s.text, 'the stale posted 100 A service was drawn').not.toMatch(/Service Rating 100 A/);
  });

  it('control: before the interconnection is answered, the sheet does NOT claim a load-side tap', async () => {
    const { answerServiceRating } = await import('@/lib/electrical/systemConfigAnswers');
    const svc = answerServiceRating(null, 200);
    if (svc.ok === false) throw new Error(svc.refused);
    await persist(svc.topology);
    const s = await sheet();
    expect(s.status).toBe(200);
    expect(s.text).not.toContain('LOAD SIDE TAP — NEC 705.12(B)');
  });
});

describe('🚨 400 A split into two 200 A main panels survives the round trip as two panels', () => {
  it('service 400 → distribution two-main-panels → persisted → reloaded: 400 A service, two 200 A busbars', async () => {
    const { answerServiceRating, answerDistribution, answerPanel } = await import('@/lib/electrical/systemConfigAnswers');
    const svc = answerServiceRating(null, 400);
    if (svc.ok === false) throw new Error(svc.refused);
    await persist(svc.topology);
    const two = answerDistribution(await reload(), 'two-main-panels');
    if (two.ok === false) throw new Error(two.refused);
    await persist(two.topology);
    let back = await reload();
    const named = answerPanel(back, back.panels[0].id, { manufacturer: 'Eaton' });
    if (named.ok === false) throw new Error(named.refused);
    await persist(named.topology);
    back = await reload();
    expect(back.service.ratedAmps).toBe(400);
    expect(back.panels.map(p => p.busbarRatingA)).toEqual([200, 200]);
    expect(back.panels[0].manufacturer, 'the panel manufacturer did not survive the reload').toBe('Eaton');
    const iv = await interviewOf(back);
    expect(iv.sections.find(s => s.id === 'service')!.summary).toContain('400 A');
    expect(iv.sections.find(s => s.id === 'service')!.items.filter(i => i.id.startsWith('service.panel.'))).toHaveLength(2);
  });
});
