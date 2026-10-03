/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 STRING ASSIGNMENT, ALL THE WAY: [Review] → [Accept] → PUT service-topology → reload → the card
//    still reads "Assigned". Through the real route handlers on real PostgreSQL (PGlite).
//
// The card's component tests use a mocked `apply`; this one gives the card the page's write path —
// the route the page PUTs to — and rebuilds the card from what the route's GET returns, the way a
// browser reload does. Ray's standard: "UI action → state mutation → persistence → reload".
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '7c3e9a4f-2e3d-4b9a-9f77-5c1dae9f8a13';
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
     VALUES ($1, $2, 'Ray — DC coupled', 'lead', 'fence', 'Peoria, IL', $3)`,
    [HOUSE, USER_ID, JSON.stringify({ panelId: 'panel-fence-ps1', batteryId: 'tesla-powerwall-3', batteryCount: 4 })]);
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const ctx = { params: Promise.resolve({ id: HOUSE }) };

/** The page's one write path: `writeTopology` PUTs the whole graph to this route. */
async function persist(t: ServiceTopology): Promise<boolean> {
  const { PUT } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await PUT(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topology: t }),
  }), ctx);
  return res.status === 200;
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

const RAYS_STRINGS = [9, 9, 9, 8, 2];

async function mountFromStore(writes: ServiceTopology[]) {
  const { buildSystemConfigInterview } = await import('@/lib/electrical/systemConfigInterview');
  const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
  const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
  const { applyVia } = await import('@/components/engineering/systemConfig/ItemEditor');
  const { InvertersStringsDecisions } = await import('@/components/engineering/systemConfig/cards/InvertersStringsCard');
  const t = await reload();
  const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
  const iv = buildSystemConfigInterview({
    pvArray: pv37, topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'NONE' },
      storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Tesla Gateway 3', count: 2 },
    },
    evaluation: evaluateServiceTopology(t), derivedStrings: RAYS_STRINGS.map(panelCount => ({ panelCount })),
  });
  return render(
    <InvertersStringsDecisions topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} busy={false}
                               equipment={{ gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3',
                                 storageLabel: 'Tesla Powerwall 3', totalUnits: 4 }}
                               apply={applyVia(async n => { const ok = await persist(n); if (ok) writes.push(n); return ok; })}
                               interview={iv} coupling="dc-coupled-storage" pvInverterState="NONE" />);
}

describe('🚨 Ray\'s DC-coupled job: the accepted string assignment survives the store and a reload', () => {
  it('[Review] → [Accept] → PUT service-topology → reload → "Assigned — 4 of 4 units carry PV", read back into the rows', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { invertingUnits } = await import('@/lib/electrical/storageStringAssignment');
    expect(await persist({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' })).toBe(true);

    const writes: ServiceTopology[] = [];
    const first = await mountFromStore(writes);
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Not assigned');
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.click(screen.getByTestId('inv-string-accept'));
    await waitFor(() => expect(writes).toHaveLength(1));
    first.unmount();

    // The reload: everything below is rebuilt from what the route returns, not from React state.
    const back = await reload();
    expect(invertingUnits(back).map(u => u.pvDcStcKw)).toEqual([3.96, 3.96, 3.96, 4.4]);
    await mountFromStore([]);
    expect(screen.getByTestId('inv-string-status').getAttribute('data-state')).toBe('answered');
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Assigned — 4 of 4 units carry PV');
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const ids = invertingUnits(back).map(u => u.id);
    expect([1, 2, 3, 4, 5].map(i => (screen.getByTestId(`inv-string-${i}`) as HTMLSelectElement).value))
      .toEqual([ids[0], ids[1], ids[2], ids[3], ids[3]]);
    expect(screen.getByTestId('inv-string-recommendation').getAttribute('data-matches-recorded')).toBe('true');
  });
});
