// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE RECORDED MODULE MUST BE THE ONE DESIGN PLACED — read on the server, from real PostgreSQL.
//
// Production-build finding (Ray's job): an automatic panel swap rewrote `selected_equipment` to a
// Canadian Solar 620 W under 37 placed Philadelphia Solar 440 W modules, and every surface drew 620 W.
// The swap is now withheld (tests/moduleAuthority.test.ts); a project already rewritten must SAY so.
// `loadElectricalProject` supplies the placed wattage only when every placed module carries the same
// one, so a mixed roof / fence design is never flagged.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB = '7c3e9a4f-2e3d-4b9f-9f77-5c1d0e9f8a03';
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
  await import('@/lib/electrical/loadElectricalProject');
}, 90_000);
afterAll(async () => { await db?.close(); });


async function job(panelId: string, wattages: number[]) {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment)
     VALUES ($1, $2, 'Fence job', 'lead', 'fence', 'Peoria, IL', $3)`,
    [JOB, USER_ID, JSON.stringify({ panelId, source: 'engineering' })]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'fence',$3::jsonb,$4)`,
    [JOB, USER_ID, JSON.stringify(wattages.map((w, i) => ({ id: `p${i}`, wattage: w }))), wattages.length]);
  const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
  const loaded = await loadElectricalProject(JOB, USER_ID);
  return loaded!.pvArray;
}

describe('🚨 the server reads the placed modules and reports a record that disagrees with them', () => {
  it('37 placed 440 W modules under a 620 W record (the auto-heal casualty) → conflict, naming both', async () => {
    const pv = await job('panel-cs2', Array.from({ length: 37 }, () => 440));
    expect(pv.moduleCount).toBe(37);
    expect(pv.moduleConflict).toMatch(/Design placed 440 W modules.*\(620 W\)/);
  });

  it('control: the record matches the placed modules → no conflict', async () => {
    const pv = await job('panel-fence-ps1', Array.from({ length: 37 }, () => 440));
    expect(pv.moduleConflict).toBeNull();
    expect(pv.dcStcKw).toBe(16.28);
  });

  it('a mixed design (two wattages placed) has no single placed figure, so it is never flagged', async () => {
    const pv = await job('panel-cs2', [...Array.from({ length: 20 }, () => 440), ...Array.from({ length: 17 }, () => 620)]);
    expect(pv.moduleConflict).toBeNull();
  });
});
