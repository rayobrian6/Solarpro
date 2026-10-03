// ═══════════════════════════════════════════════════════════════════════════
// 🚨 [Apply] ON A 120% REMEDY, ALL THE WAY: writer → PUT → GET → the SLD route → the BOM route.
//    Through the real route handlers on real PostgreSQL (PGlite).
//
// Ray (closure brief §5): "if the user explicitly clicks an Apply action, that action must write the
// actual engineering owner consumed by sizing, SLD, BOM, permit — and survive reload."
//
// The action is the writer the Service card's [Apply] hands to the page's one write path
// (`answerBusbarRemedy`); persistence is `PUT /api/projects/[id]/service-topology`; the reload is the
// page's own `GET`; the outputs are `POST /api/engineering/sld` and `POST /api/engineering/bom` with a
// STALE page body (the installed 200 A main, the legacy MAIN_BREAKER_DERATE token) — so the sheet and
// the parts list can only show the remedy if they read it from the store.
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
const HOUSE = '7c3e9a4f-2b1d-4c6e-8f77-5d1c0e9f8a03';
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
    `ALTER TABLE layouts ADD COLUMN IF NOT EXISTS design_electrical JSONB`,
  ]) await db.exec(c);
  await Promise.all([
    import('@/app/api/projects/[id]/service-topology/route'),
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/lib/electrical/loadElectricalProject'),
  ]);
}, 90_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  // A 200 A house, one Powerwall 3 landing on the main panel's busbar, PV DC-coupled to it — the
  // installer's recorded decision (no PV inverter), so no architecture is in dispute.
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment, engineering_config)
     VALUES ($1, $2, 'Normal Residence', 'lead', 'roof', '12 Elm St, Peoria, IL', $3, $4)`,
    [HOUSE, USER_ID,
     JSON.stringify({ panelId: MODULE, batteryCount: 1, inverter: null, inverterId: null,
       provenance: { architecture: { kind: 'USER_SELECTED', recordedAt: '2026-10-03T00:00:00.000Z',
         basis: 'Inverter: None — PV direct to Powerwall 3', by: 'ecosystem-picker' } } }),
     JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 200 })]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'roof',$3::jsonb,20)`,
    [HOUSE, USER_ID, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, wattage: 440 })))]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };

async function failingHouse(): Promise<ServiceTopology> {
  const { buildNormalResidence200A } = await import('@/lib/electrical/fixtures/normalResidence200a');
  return buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;
}

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

const textOf = (svg: string) => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The Diagram tab's request, with what the page held BEFORE the remedy: the installed main, the old token. */
async function sheet() {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: HOUSE, format: 'json', projectName: 'Normal Residence', address: '12 Elm St, Peoria, IL',
      drawingDate: '2026-10-03', drawingNumber: 'SLD-001', revision: 'A', topologyType: 'DC_COUPLED_STORAGE',
      totalModules: 20, totalStrings: 0, panelModel: 'Solar Panel', dcWireGauge: '#10 AWG', dcConduitType: 'EMT',
      dcOCPD: 20, acWireGauge: '#6 AWG', acConduitType: 'EMT', acWireLength: 60, utilityName: 'Ameren Illinois',
      mainPanelAmps: 200, panelBusRating: 200, interconnection: 'MAIN_BREAKER_DERATE',
      hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 1,
    }),
  }));
  const json = await res.json() as Record<string, any>;
  return { status: res.status, json, text: textOf(String(json.svg ?? '')) };
}

/** The BOM tab's request — a stale MAIN_BREAKER_DERATE scalar included. */
async function bom() {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: HOUSE, batteryId: 'tesla-powerwall-3', batteryCount: 1, panelId: MODULE,
      moduleCount: 20, totalPanels: 20, systemType: 'roof', mainPanelAmps: 200, panelBusRating: 200,
      interconnectionMethod: 'MAIN_BREAKER_DERATE',
    }),
  }));
  const json = await res.json() as Record<string, any>;
  type Line = { id: string; partNumber: string; quantity: number; model?: string; description?: string; nonOrderable?: boolean };
  return { status: res.status, json, items: (json.bom?.items ?? []) as Line[],
    notes: (json.summary?.complianceNotes ?? []) as string[] };
}

describe('🚨 the applied remedy is the engineering owner, and survives the save', () => {
  it('[Apply] → PUT → GET: the remedy reloads exactly, beside the installed 200 A reading', async () => {
    const { answerBusbarRemedy } = await import('@/lib/electrical/systemConfigAnswers');
    const t = await failingHouse();
    const r = answerBusbarRemedy(t, 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 150 });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const back = await reload();
    expect(back.panels[0].remedy).toEqual({ kind: 'replace-main-breaker', mainBreakerA: 150 });
    expect([back.panels[0].mainBreakerA, back.panels[0].busbarRatingA]).toEqual([200, 200]);
    // …and the engine, on the reloaded graph, checks the panel AFTER the work.
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const checks = evaluateServiceTopology(back).checks;
    expect(checks.find(c => c.id === 'domain.busbar-705-12')!.conclusion).toBe('PASS');
    expect(checks.find(c => c.id === 'panel.remedy-load-calculation')!.conclusion).toBe('NOT_EVALUATED');
  });

  it('[Remove] → PUT → GET: the key is gone from the store and the FAIL is back', async () => {
    const { answerBusbarRemedy, answerRemoveBusbarRemedy } = await import('@/lib/electrical/systemConfigAnswers');
    const t = await failingHouse();
    const a = answerBusbarRemedy(t, 'msp-1', { kind: 'replace-panelboard', busbarRatingA: 225 });
    if (a.ok === false) throw new Error(a.refused);
    await persist(a.topology);
    const r = answerRemoveBusbarRemedy(await reload(), 'msp-1');
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const raw = (await db.query<{ t: any }>('SELECT service_topology AS t FROM projects WHERE id = $1', [HOUSE])).rows[0].t;
    expect('remedy' in raw.topology.panels[0]).toBe(false);
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    expect(evaluateServiceTopology(await reload()).checks.find(c => c.id === 'domain.busbar-705-12')!.conclusion).toBe('FAIL');
  });
});

describe('🚨 the SLD route draws it from the store — as NEW WORK', () => {
  it('without [Apply] the sheet draws the installed main and says the 120% rule FAILS — the stale derate token changes nothing', async () => {
    await persist(await failingHouse());
    const s = await sheet();
    expect(s.status, JSON.stringify(s.json).slice(0, 400)).toBe(200);
    expect(s.text).toContain('200 A MAIN');
    expect(s.text).not.toContain('(N)');
    expect(s.text).not.toContain('NEW WORK');
    expect(s.text).toMatch(/120% Rule FAIL/);
  });

  it('after [Apply] → reload, the sheet draws (N) 150 A MAIN beside the (E) 200 A one, and the 120% row re-runs on it', async () => {
    const { answerBusbarRemedy } = await import('@/lib/electrical/systemConfigAnswers');
    const r = answerBusbarRemedy(await failingHouse(), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 150 });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    await reload();
    const s = await sheet();
    expect(s.status, JSON.stringify(s.json).slice(0, 400)).toBe(200);
    expect(s.text).toContain('(N) 150 A MAIN');
    expect(s.text).toContain('(E) 200 A MAIN — REPLACED');
    expect(s.text).toContain('NEW WORK — MAIN BREAKER DERATE');
    expect(s.text).toContain('(E) 200 A → (N) 150 A main');
    expect(s.text).toMatch(/120% Rule PASS/);
  });
});

describe('🚨 the BOM route lists it — and never honours the stale token as a derate', () => {
  it('without [Apply]: no replacement breaker line, and no "main OCPD derated" note from the posted MAIN_BREAKER_DERATE', async () => {
    await persist(await failingHouse());
    const b = await bom();
    expect(b.status, JSON.stringify(b.json).slice(0, 400)).toBe(200);
    expect(b.items.some(i => i.id.startsWith('topology-remedy-'))).toBe(false);
    expect(b.notes.join(' | ')).not.toMatch(/Main breaker derate/i);
  });

  it('after [Apply] → reload: the replacement main breaker is on the parts list, as a requirement line', async () => {
    const { answerBusbarRemedy } = await import('@/lib/electrical/systemConfigAnswers');
    const r = answerBusbarRemedy(await failingHouse(), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 150 });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    await reload();
    const b = await bom();
    expect(b.status, JSON.stringify(b.json).slice(0, 400)).toBe(200);
    const line = b.items.find(i => i.id === 'topology-remedy-main-breaker-msp-1');
    expect(line, b.items.map(i => i.id).join(', ')).toBeTruthy();
    expect(line!.quantity).toBe(1);
    expect(line!.nonOrderable).toBe(true);
    expect(line!.description).toContain('NEW WORK (NEC 705.12(B) remedy) — Replacement main breaker 150 A');
    expect(b.json.electrical.quantityDisagreements).toEqual([]);
    expect(b.notes.join(' | ')).not.toMatch(/Main breaker derate — main OCPD derated/i);
  });

  it('a replacement panelboard reaches the BOM the same way', async () => {
    const { answerBusbarRemedy } = await import('@/lib/electrical/systemConfigAnswers');
    const r = answerBusbarRemedy(await failingHouse(), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: 225 });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const b = await bom();
    expect(b.items.find(i => i.id === 'topology-remedy-panelboard-msp-1')!.model)
      .toBe('225 A bus panelboard, 200 A main — replacement for Main service panel');
  });
});
