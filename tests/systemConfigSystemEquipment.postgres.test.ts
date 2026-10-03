// ═══════════════════════════════════════════════════════════════════════════
// 🚨 PER-SYSTEM EQUIPMENT, PARTIAL BACKUP AND PER-SYSTEM LANDING, ALL THE WAY: answer → graph →
//    real PUT → real GET (the reload) → the interview and the engine read the answer back.
//
// Writer + consumer law: an answer that does not survive the project's one write path and come back
// to the thing that consumes it was never recorded. The answers are the functions the System Config
// editors call (`systemConfigSystemEquipment.ts`); the persistence is the page's own route
// (`PUT /api/projects/[id]/service-topology`), the reload its `GET`, on real PostgreSQL.
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
     VALUES ($1, $2, 'Two Panel Residence', 'lead', 'roof', '40 Oak Ave, Peoria, IL', $3)`,
    [HOUSE, USER_ID, JSON.stringify({ panelId: MODULE, batteryId: 'tesla-powerwall-3', batteryCount: 4 })]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };

async function persist(r: AnswerResult) {
  if (r.ok === false) throw new Error(r.refused);
  const { PUT } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await PUT(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topology: r.topology }),
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

const interviewOf = async (t: ServiceTopology) => {
  const { buildSystemConfigInterview } = await import('@/lib/electrical/systemConfigInterview');
  const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  const iv = buildSystemConfigInterview({
    pvArray: resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: MODULE }),
    topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
      storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Tesla Backup Gateway 3', count: 1 },
    },
    evaluation: evaluateServiceTopology(t),
  });
  return { iv, item: (id: string) => iv.sections.flatMap(s => s.items).find(i => i.id === id) };
};

/** A 400 A service split into two 200 A main panels, answered and persisted. */
async function twoPanelService(): Promise<ServiceTopology> {
  const { answerServiceRating, answerDistribution } = await import('@/lib/electrical/systemConfigAnswers');
  await persist(answerServiceRating(null, 400));
  await persist(answerDistribution(await reload(), 'two-main-panels'));
  return reload();
}

const SEL = { gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 4 };

describe('🚨 "only MSP #2 is backed up", then that system re-equipped, survives the round trip', () => {
  it('partial backup → PUT → GET: one system behind MSP #2 holding exactly the 2 batteries named', async () => {
    const { answerBackedUpPanels } = await import('@/lib/electrical/systemConfigSystemEquipment');
    const two = await twoPanelService();
    await persist(answerBackedUpPanels(two, ['msp-2'], { ...SEL, unitsPerPanel: { 'msp-2': 2 } }));
    const back = await reload();
    expect(back.panels.map(p => [p.id, p.backedUp])).toEqual([['msp-1', false], ['msp-2', true]]);
    expect(back.domains).toHaveLength(1);
    expect(back.domains[0].backedUpPanelIds).toEqual(['msp-2']);

    const { iv, item } = await interviewOf(back);
    expect(item('behavior.backup')).toMatchObject({ state: 'answered', answer: 'MSP #2 backed up', value: 'panels' });
    expect(iv.release.blockers.join(' ')).not.toMatch(/What is backed up/);
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    expect(evaluateServiceTopology(back).storageSummary.inverterUnitCount).toBe(2);
  });

  it('controller, battery count and an expansion for that system → PUT → GET → the interview and the engine read them', async () => {
    const { answerBackedUpPanels, answerSystemEquipment, systemEquipmentItemId } =
      await import('@/lib/electrical/systemConfigSystemEquipment');
    const two = await twoPanelService();
    await persist(answerBackedUpPanels(two, ['msp-2'], { ...SEL, unitsPerPanel: { 'msp-2': 2 } }));
    const partial = await reload();
    const sys = partial.domains[0].id;

    await persist(answerSystemEquipment(partial, sys, {
      gatewayProductId: 'tesla-backup-gateway-2', storageUnits: 3,
      expansionProductId: 'tesla-powerwall-3-expansion', expansionUnits: 1,
    }));
    const back = await reload();
    const d = back.domains.find(x => x.id === sys)!;
    expect(d.gateway.productId, 'the controller answer did not survive the reload').toBe('tesla-backup-gateway-2');
    const units = d.storageUnitIds.map(id => back.storage.find(u => u.id === id)!);
    expect(units.filter(u => u.role === 'inverter-unit')).toHaveLength(3);
    const exp = units.filter(u => u.role === 'energy-expansion');
    expect(exp, 'the expansion answer did not survive the reload').toHaveLength(1);
    expect(units.some(u => u.id === exp[0].attachedToUnitId && u.role === 'inverter-unit')).toBe(true);

    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const ev = evaluateServiceTopology(back);
    expect(ev.storageSummary.inverterUnitCount).toBe(3);
    expect(ev.storageSummary.expansionUnitCount).toBe(1);
    expect(ev.checks.find(c => c.id === 'storage.expansion-has-a-host')?.conclusion ?? 'absent').not.toBe('FAIL');

    const { item } = await interviewOf(back);
    expect(item(systemEquipmentItemId(sys))).toMatchObject({
      state: 'answered',
      question: 'Which backup controller, batteries and expansion units are installed?',
      answer: 'Tesla Backup Gateway 2 · 3 × Tesla Powerwall 3 · 1 × Tesla Powerwall 3 Expansion',
    });
  });

  it('control: a controller the catalogue does not list for the battery is refused, and nothing is written', async () => {
    const { answerBackedUpPanels, answerSystemEquipment } = await import('@/lib/electrical/systemConfigSystemEquipment');
    const two = await twoPanelService();
    await persist(answerBackedUpPanels(two, ['msp-2'], { ...SEL, unitsPerPanel: { 'msp-2': 2 } }));
    const partial = await reload();
    const r = answerSystemEquipment(partial, partial.domains[0].id, { gatewayProductId: 'enphase-iq-system-controller-3' });
    expect(r.ok).toBe(false);
    expect((await reload()).domains[0].gateway.productId).toBe('tesla-backup-gateway-3');
  });
});

describe('🚨 one system\'s battery landing, answered alone, survives the round trip and leaves the other alone', () => {
  it('two systems → System 2 lands in its gateway → PUT → GET → System 2 answered, System 1 still open', async () => {
    const { answerBackupChoice, answerSystemLanding, systemLandingItemId } =
      await import('@/lib/electrical/systemConfigSystemEquipment');
    const two = await twoPanelService();
    await persist(answerBackupChoice(two, 'whole', { ...SEL, unitsPerPanel: { 'msp-1': 1, 'msp-2': 2 } }));
    const both = await reload();
    expect(both.domains.map(d => d.storageUnitIds.length)).toEqual([1, 2]);   // as named — never 2 + 2
    const [s1, s2] = both.domains.map(d => d.id);

    await persist(answerSystemLanding(both, s2, 'gateway-panelboard'));
    const back = await reload();
    expect(back.domains.map(d => d.storageConnection)).toEqual(['unresolved', 'gateway-panelboard']);

    const { iv, item } = await interviewOf(back);
    expect(item(systemLandingItemId(s2))).toMatchObject({ state: 'answered', value: 'gateway-panelboard' });
    expect(item(systemLandingItemId(s1))?.state).toBe('needs-answer');
    expect(iv.openQuestions.map(q => q.id)).toContain(systemLandingItemId(s1));
    expect(iv.openQuestions.map(q => q.id)).not.toContain(systemLandingItemId(s2));
  });
});
