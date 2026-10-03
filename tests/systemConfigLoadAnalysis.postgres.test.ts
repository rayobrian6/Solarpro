// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE OPTIONAL LOAD ANALYSIS, ALL THE WAY: answer → graph → PUT → GET (reload) → the engineering
//    the server computes → the interview. Through the real route handlers on real PostgreSQL.
//
// Writer + consumer law: the answer persists through the one write path the page uses
// (`PUT /api/projects/[id]/service-topology`) and is read back by its consumers — the evaluation the
// GET computes server-side from the stored graph, and the System Config interview built from the
// reloaded graph.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology, TopologyCheck } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '7c3e9a4f-2e3d-4b9a-9f77-5c1d0e9f8a13';
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
     VALUES ($1, $2, 'Two-panel Residence', 'lead', 'roof', '40 Oak St, Peoria, IL', $3)`,
    [HOUSE, USER_ID, JSON.stringify({ panelId: 'panel-std440', inverter: { id: 'enphase-iq8m', type: 'micro' } })]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };
const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};

async function persist(t: ServiceTopology) {
  const { PUT } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await PUT(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topology: t }),
  }), ctx);
  expect(res.status, JSON.stringify(await res.clone().json()).slice(0, 300)).toBe(200);
}

/** The page's own read — the reload — with the engineering the SERVER computed from the stored graph. */
async function reload(): Promise<{ topology: ServiceTopology; checks: TopologyCheck[] }> {
  const { GET } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`), ctx);
  const json = await res.json() as { available: boolean; topology: ServiceTopology; evaluation: { checks: TopologyCheck[] } };
  expect(json.available).toBe(true);
  return { topology: json.topology, checks: json.evaluation.checks };
}

const interviewOf = async (t: ServiceTopology) => {
  const { buildSystemConfigInterview } = await import('@/lib/electrical/systemConfigInterview');
  const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  const iv = buildSystemConfigInterview({
    pvArray: resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' }),
    topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });
  const all = iv.sections.flatMap(s => s.items);
  return { iv, item: (id: string) => all.find(i => i.id === id) };
};
const check = (checks: TopologyCheck[], id: string, scope = 'site') => checks.find(c => c.id === id && c.scope === scope);

/** 400 A → two 200 A main panels, persisted and reloaded, the way System Config builds it. */
async function twoPanelService(): Promise<ServiceTopology> {
  const { answerServiceRating, answerDistribution } = await import('@/lib/electrical/systemConfigAnswers');
  await persist(ok(answerServiceRating(null, 400)));
  await persist(ok(answerDistribution((await reload()).topology, 'two-main-panels')));
  return (await reload()).topology;
}

describe('🚨 the optional load analysis, answered in System Config, survives the reload and is what the engineering reads', () => {
  it('add (method chosen) → one figure per panel → PUT → GET: the stored model, the server\'s checks and the interview all read it', async () => {
    const { answerLoadAnalysisMethod, answerPanelDemand } = await import('@/lib/electrical/systemConfigLoadAnalysis');
    let back = await twoPanelService();
    const [p1, p2] = back.panels.map(p => p.id);

    // Before: optional and absent — answered, no blocker, the server's model check is NOT EVALUATED.
    const before = await interviewOf(back);
    expect(before.item('engineering.loads')?.state).toBe('answered');
    expect(before.item('engineering.loads')?.answer).toMatch(/^None — optional/);
    const blockersWithout = before.iv.release.blockers;

    // Add it, method chosen by the installer.
    await persist(ok(answerLoadAnalysisMethod(back, 'standard-220-part-iii')));
    back = (await reload()).topology;
    expect(back.loads?.method, 'the chosen method did not survive the reload').toBe('standard-220-part-iii');

    // One panel entered: partial. Reloaded, it says so; no subtotal; no new blocker.
    await persist(ok(answerPanelDemand(back, p1, 92)));
    let r = await reload();
    back = r.topology;
    expect(back.loads?.byPanel).toEqual([{ panelId: p1, calculatedDemandA: 92 }]);
    expect(check(r.checks, 'load.calculation')?.conclusion).toBe('NOT_EVALUATED');
    let iv = await interviewOf(back);
    expect(iv.item('engineering.loads')?.answer).toContain('cannot be summed until every panelboard has a figure');
    expect(iv.item('engineering.loads')?.answer).not.toMatch(/aggregate/);
    expect(iv.iv.release.blockers, 'a partial optional analysis added a release blocker').toEqual(blockersWithout);

    // Both panels entered: the server sums them and the interview states its verdict.
    await persist(ok(answerPanelDemand(back, p2, 80)));
    r = await reload();
    back = r.topology;
    expect(back.loads?.byPanel).toEqual([
      { panelId: p1, calculatedDemandA: 92 }, { panelId: p2, calculatedDemandA: 80 }]);
    expect(check(r.checks, 'load.calculation')?.conclusion).toBe('PASS');
    expect(check(r.checks, 'service.demand')?.detail).toBe('172.0 A calculated demand against a 400 A service.');
    expect(check(r.checks, 'branch.demand', `branch:${back.branches[0].id}`)?.detail).toMatch(/^92\.0 A on a 200 A branch, summed from the load model/);
    iv = await interviewOf(back);
    expect(iv.item('engineering.loads')?.state).toBe('calculated');
    expect(iv.item('engineering.loads')?.answer).toContain('172.0 A aggregate');
    expect(iv.item('engineering.loads.check.service.demand.site')?.answer).toBe(`PASS — ${check(r.checks, 'service.demand')?.detail}`);
  });

  it('a figure over the service persists and FAILS on the server; the interview states that FAIL', async () => {
    const { answerLoadAnalysisMethod, answerPanelDemand } = await import('@/lib/electrical/systemConfigLoadAnalysis');
    let back = await twoPanelService();
    const [p1, p2] = back.panels.map(p => p.id);
    let t = ok(answerLoadAnalysisMethod(back, 'engineer-supplied'));
    t = ok(answerPanelDemand(t, p1, 350));
    t = ok(answerPanelDemand(t, p2, 80));
    await persist(t);
    const r = await reload();
    back = r.topology;
    expect(check(r.checks, 'service.demand')?.conclusion).toBe('FAIL');
    const iv = await interviewOf(back);
    expect(iv.item('engineering.loads')?.state).toBe('fails');
    expect(iv.item('engineering.loads.check.service.demand.site')?.answer).toBe('FAIL — 430.0 A calculated demand exceeds the 400 A service.');
  });

  it('remove → PUT → GET: the model is gone after the reload and the item is "None — optional" again', async () => {
    const { answerLoadAnalysisMethod, answerPanelDemand, answerRemoveLoadAnalysis } =
      await import('@/lib/electrical/systemConfigLoadAnalysis');
    const back = await twoPanelService();
    await persist(ok(answerPanelDemand(ok(answerLoadAnalysisMethod(back, 'standard-220-part-iii')), back.panels[0].id, 60)));
    const withModel = (await reload()).topology;
    expect(withModel.loads).not.toBeNull();
    await persist(ok(answerRemoveLoadAnalysis(withModel)));
    const r = await reload();
    expect(r.topology.loads ?? null, 'the removed analysis came back on reload').toBeNull();
    expect(check(r.checks, 'load.calculation')?.detail).toMatch(/^LOAD CALCULATION NOT PROVIDED/);
    expect((await interviewOf(r.topology)).item('engineering.loads')?.answer).toMatch(/^None — optional/);
  });

  it('after the electrical system is changed to 3φ (persisted), NEC 220.82 is neither offered nor accepted', async () => {
    const { answerElectricalSystem } = await import('@/lib/electrical/systemConfigAnswers');
    const { answerLoadAnalysisMethod } = await import('@/lib/electrical/systemConfigLoadAnalysis');
    const back = await twoPanelService();
    await persist(ok(answerElectricalSystem(back, 'wye-208')));
    const t3 = (await reload()).topology;
    expect(t3.service.phase).toBe('wye-208');
    expect((await interviewOf(t3)).item('engineering.loads')?.options?.map(o => o.value)).not.toContain('optional-220-82');
    const r = answerLoadAnalysisMethod(t3, 'optional-220-82');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toContain('NEC 220.82(A)');
  });
});
