// ═══════════════════════════════════════════════════════════════════════════
// 🚨 UTILITY FACTS AND DISCONNECTING MEANS, ALL THE WAY: answer → real PUT → real GET (the reload)
//    → the interview and `evaluateServiceTopology` read the answer back. Real PostgreSQL (PGlite).
//
// Writer + consumer law: an answer that does not survive the page's own write path, or that the
// engineering does not read after a reload, was never recorded.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '7c3e9a4f-2e3d-4b9a-9f77-5c1d0e9f8a13';
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
  await import('@/app/api/projects/[id]/service-topology/route');
}, 90_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment)
     VALUES ($1, $2, 'Normal Residence', 'lead', 'roof', '12 Elm St, Peoria, IL', $3)`,
    [HOUSE, USER_ID, JSON.stringify({ panelId: MODULE, inverterId: 'enphase-iq8m' })]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };

async function persist(r: AnswerResult | ServiceTopology) {
  const t = 'ok' in r ? (r.ok === false ? (() => { throw new Error(r.refused); })() : r.topology) : r;
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

async function interviewOf(t: ServiceTopology, rays = false) {
  const { buildSystemConfigInterview } = await import('@/lib/electrical/systemConfigInterview');
  const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  const iv = buildSystemConfigInterview({
    pvArray: rays ? resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' })
      : resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: MODULE }),
    topology: t, coupling: rays ? 'dc-coupled-storage' : null, couplingIsDecision: rays, architectureConflict: false,
    equipment: rays
      ? { pvInverter: { state: 'NONE' },
          storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
          gateway: { label: 'Tesla Gateway 3', count: 2 } }
      : { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });
  return { iv, item: (id: string) => iv.sections.flatMap(s => s.items).find(i => i.id === id) };
}
const check = async (t: ServiceTopology, id: string) => {
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  return evaluateServiceTopology(t).checks.filter(c => c.id === id);
};

describe('🚨 the meter-collar ruling survives the reload in all three states', () => {
  it('permitted → reload → permitted; then NOT ESTABLISHED → reload → null, not a stale "permitted"', async () => {
    const { answerServiceRating, answerInterconnection } = await import('@/lib/electrical/systemConfigAnswers');
    const { answerMeterCollarPermitted, METER_COLLAR_ITEM_ID } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    await persist(answerServiceRating(null, 200));
    await persist(answerMeterCollarPermitted(await reload(), true));
    let back = await reload();
    expect(back.interconnection.meterCollarPermitted).toBe(true);
    await persist(answerInterconnection(back, 'meter-collar'));
    back = await reload();
    let { item } = await interviewOf(back);
    expect(item(METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'answered', value: 'permitted' });
    expect(item('behavior.interconnection')).toMatchObject({ state: 'answered', answer: 'Meter collar adapter' });
    expect((await check(back, 'interconnection.meter-collar'))[0]?.conclusion).toBe('PASS');

    await persist(answerMeterCollarPermitted(back, null));
    back = await reload();
    expect(back.interconnection.meterCollarPermitted, 'null did not survive the round trip').toBeNull();
    ({ item } = await interviewOf(back));
    expect(item(METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'needs-verification', value: 'unknown' });
    expect(item('behavior.interconnection')?.state).toBe('needs-verification');
    expect((await check(back, 'interconnection.meter-collar'))[0]?.conclusion).toBe('NOT_EVALUATED');
  });

  it('NOT permitted over a chosen collar → reload → the collar is gone from the flag AND the points; nothing fails, the connection is asked again', async () => {
    const { answerServiceRating, answerInterconnection } = await import('@/lib/electrical/systemConfigAnswers');
    const { answerMeterCollarPermitted, METER_COLLAR_ITEM_ID } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    await persist(answerServiceRating(null, 200));
    await persist(answerInterconnection(await reload(), 'meter-collar'));
    await persist(answerMeterCollarPermitted(await reload(), false));
    const back = await reload();
    expect(back.interconnection).toMatchObject({ meterCollarPermitted: false, meterCollarSelected: false });
    expect(back.pointsOfInterconnection.map(p => p.relationship)).toEqual(['unresolved']);
    expect((await check(back, 'poi.relationship')).map(c => c.conclusion)).not.toContain('FAIL');
    const { item } = await interviewOf(back);
    expect(item(METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'answered', answer: 'Not permitted' });
    expect(item('behavior.interconnection')?.state).toBe('needs-answer');
    expect(item('behavior.interconnection')?.options?.map(o => o.value)).not.toContain('meter-collar');
  });
});

describe('🚨 a disconnecting means, added, placed and specified in System Config, is what the engineering reads after a reload', () => {
  it('service disconnect: add → place ahead of the panel → part, rating, SCCR — each through PUT/GET', async () => {
    const { answerServiceRating } = await import('@/lib/electrical/systemConfigAnswers');
    const {
      answerAddDisconnect, answerDisconnectPlacement, answerDisconnectPart, disconnectItemId,
    } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    const ID = disconnectItemId('service-disconnect');
    await persist(answerServiceRating(null, 200));
    let back = await reload();
    expect((await check(back, 'bonding.location'))[0]?.conclusion).toBe('NOT_EVALUATED');
    expect((await interviewOf(back)).item(ID)?.state).toBe('needs-answer');

    // Added — and stored WITHOUT a rating nobody read off a part.
    await persist(answerAddDisconnect(back, 'service-disconnect'));
    back = await reload();
    const dev = back.devices.find(d => d.roles.includes('service-disconnect'))!;
    expect(dev).toMatchObject({ label: 'Service disconnect', ratedAmps: null, sccrA: null });
    expect((await check(back, 'bonding.location'))[0]?.conclusion, 'the bond location did not read the recorded service disconnect').toBe('PASS');

    // Placed in line ahead of the panel: the engine now has a requirement, and reads it from the store.
    await persist(answerDisconnectPlacement(back, dev.id, back.panels[0].id));
    back = await reload();
    expect(back.devices.find(d => d.id === dev.id)?.inlineOnNodeId).toBe(back.panels[0].id);
    const inline = (await check(back, 'device.inline-rating'))[0];
    expect(inline?.conclusion).toBe('NOT_EVALUATED');
    expect(inline?.requires).toEqual(['device.ratedAmps']);
    let { item } = await interviewOf(back);
    expect(item(ID)?.answer).toContain('ahead of MSP #1 · requirement: 200 A — what MSP #1 carries');
    expect(item(ID)?.answer).toContain('part rating not stated · SCCR not established');

    // The part, its rating and its SCCR.
    await persist(answerDisconnectPart(back, dev.id, { productId: 'DU224RB', ratedAmps: 200, sccrA: 22000 }));
    back = await reload();
    expect(back.devices.find(d => d.id === dev.id)).toMatchObject({ productId: 'DU224RB', ratedAmps: 200, sccrA: 22000 });
    expect((await check(back, 'device.inline-rating'))[0]?.conclusion).toBe('PASS');
    expect(await check(back, 'device.selection'), 'the selected part did not reach the engineering').toHaveLength(0);
    ({ item } = await interviewOf(back));
    expect(item(ID)).toMatchObject({ state: 'answered' });
    expect(item(ID)?.answer).toContain('part DU224RB · rated 200 A · 22000 A SCCR');
  });

  it('🚨 the utility isolation switch seeded at 200 A: naming its part → reload → no rating, in-line rating NOT EVALUATED', async () => {
    const { answerServiceRating, answerInterconnection, answerIsolationRequired } = await import('@/lib/electrical/systemConfigAnswers');
    const { answerDisconnectPart, disconnectItemId } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    await persist(answerServiceRating(null, 200));
    await persist(answerInterconnection(await reload(), 'load-side-busbar'));
    await persist(answerIsolationRequired(await reload(), true));
    let back = await reload();
    const sw = back.devices.find(d => d.roles.includes('der-isolation-disconnect'))!;
    expect(sw.ratedAmps, 'precondition: the isolation arrangement seeds the path rating').toBe(200);
    expect((await check(back, 'device.inline-rating')).find(c => c.scope === `device:${sw.id}`)?.conclusion).toBe('PASS');

    await persist(answerDisconnectPart(back, sw.id, { productId: 'DU30', sccrA: 10000 }));
    back = await reload();
    expect(back.devices.find(d => d.id === sw.id)).toMatchObject({ productId: 'DU30', ratedAmps: null, sccrA: 10000 });
    const inline = (await check(back, 'device.inline-rating')).find(c => c.scope === `device:${sw.id}`);
    expect(inline?.conclusion, 'the in-line rating passed against the seeded copy of the path rating').toBe('NOT_EVALUATED');
    expect(inline?.requires).toEqual(['device.ratedAmps']);
    const { item } = await interviewOf(back);
    expect(item(disconnectItemId('der-isolation-disconnect'))?.answer).toContain('part DU30 · part rating not stated');
    expect(item(disconnectItemId('der-isolation-disconnect'))?.state).not.toBe('answered');
  });

  it('removing it → reload → gone, and the bond location is NOT EVALUATED again', async () => {
    const { answerServiceRating } = await import('@/lib/electrical/systemConfigAnswers');
    const { answerAddDisconnect, answerRemoveDisconnect } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    await persist(answerServiceRating(null, 200));
    await persist(answerAddDisconnect(await reload(), 'service-disconnect'));
    let back = await reload();
    await persist(answerRemoveDisconnect(back, back.devices[0].id));
    back = await reload();
    expect(back.devices).toHaveLength(0);
    expect((await check(back, 'bonding.location'))[0]?.conclusion).toBe('NOT_EVALUATED');
  });
});

describe('🚨 two gateways on one service: the manufacturer document is still required after a reload', () => {
  it('Ray’s job → PUT → GET → MANUFACTURER DOCUMENT REQUIRED, owned by the manufacturer, asked once', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { MULTI_GATEWAY_DOC_ITEM_ID, disconnectItemId } = await import('@/lib/electrical/systemConfigUtilityDisconnects');
    await persist({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' });
    const back = await reload();
    const { iv, item } = await interviewOf(back, true);
    expect(item(MULTI_GATEWAY_DOC_ITEM_ID)?.answer).toMatch(/^MANUFACTURER DOCUMENT REQUIRED/);
    expect(item(MULTI_GATEWAY_DOC_ITEM_ID)?.owner).toMatch(/^Manufacturer/);
    expect(iv.sections.flatMap(s => s.items).filter(i => /multi-gateway|Multiple Backup Gateways/i.test(i.id))).toHaveLength(1);
    // The per-path switches came back in line ahead of their gateways, and say so.
    expect(item(disconnectItemId('der-isolation-disconnect'))?.answer).toContain('ahead of Tesla Backup Gateway 3 (System 2)');
  });
});
