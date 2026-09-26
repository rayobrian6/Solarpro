/**
 * tests/engineeringRunRemembersItsEquipment.postgres.test.ts
 *
 * 🚨 THE STORED BOM COULD NOT SAY WHICH EQUIPMENT IT WAS BUILT FROM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MEASURES
 * ─────────────────────────────────────────────────────────────────────────────
 * `migrations/009_engineering_runs.sql` exists for one stated reason — "so files can be
 * traced back to the exact system configuration that generated them" — and defines the
 * columns to do it: `panel_id`, `inverter_id`, `mounting_id`, `system_type`, `roof_pitch`,
 * `rapid_shutdown`, `ac_disconnect`, `dc_disconnect`.
 *
 * `app/api/engineering/save-outputs/route.ts` wrote NONE of them. It even computed
 *     const firstInv = body.configSnapshot?.inverters?.[0] || null;
 * and then never referenced it in the INSERT. And the snapshot it stored was rebuilt from
 * scratch, copying exactly ONE key out of the client's configSnapshot
 * (`consumptionCtLocation`) and discarding the rest — including `inverters`, the array
 * that carries every `inverterId` and each string's `panelId`. So the selected-equipment
 * identity of the design was sent by the page and dropped at the database boundary.
 *
 * WHAT THAT COST, down the chain the campaign asked to be proved end to end:
 *
 *   selected equipment → the run record        : panel_id / inverter_id always NULL
 *   → the restore (`run-from-file`)            : returns null for both
 *   → app/engineering/page.tsx (~2425, ~2442)  : SUBSTITUTES. `STRING_INVERTERS[0]` or
 *                                                `MICROINVERTERS[0]` for the inverter,
 *                                                `qcells-peak-duo-400` for the panel
 *   → engineering recalc, device instances,
 *     SLD, permit, equipment schedule, BOM,
 *     pricing                                  : all recomputed from equipment nobody
 *                                                chose — sitting in Client Files beside
 *                                                the stored BOM CSV and SLD that describe
 *                                                the equipment that WAS chosen, both
 *                                                attached to the same engineering_run
 *
 * And one more, in the same INSERT: `system_type` was never written, while both readers
 * coalesced it to `'grid-tied'` — a value outside the page's SystemType
 * (`'roof' | 'ground' | 'fence'`), applied unguarded as `patches.systemType`. Reopening a
 * saved FENCE or GROUND design knocked it out of its own system type, and the next save
 * wrote back `mountType: 'Roof Mount'` — into the permit packet and the BOM's racking
 * profile. `inverter_qty` was coalesced to 1 the same way, asserting a single inverter for
 * every multi-inverter design ever saved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REAL DATABASE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Is the id in the row?" is a question about PostgreSQL, and the defect is precisely a
 * column that is created, read, and never written — invisible to any test that mocks the
 * insert. PGlite is PostgreSQL 16 in-process: no daemon, no credentials, nothing migrated
 * anywhere.
 *
 * SCHEMA PROVENANCE, stated because a hand-built fixture can accuse the product of the
 * fixture's own fault: `clients`/`projects` come from the real
 * `lib/migrations/001_initial_schema.sql`; `engineering_runs` from the real
 * `migrations/009_engineering_runs.sql` (the directory the batch runner does not scan);
 * and `project_files` is EXTRACTED FROM THE SHIPPED DDL in `app/api/migrate/route.ts`,
 * which is the only place in the repo that creates it. Nothing here is retyped by hand.
 *
 * WHAT IS NOT FIXED HERE, deliberately: the substitution itself lives in
 * `app/engineering/page.tsx`, which another session is mid-edit in. This file proves the
 * identity now reaches the row, so the substitution is unreachable for any run saved from
 * today — and `docs/gauntlet/NEEDS-RAY.md` carries the page-side half with line numbers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

/** The design under test: a FENCE system with TWO string inverters and a specific panel.
 *  Fence, because 'grid-tied' would overwrite it; two inverters, because 1 would be
 *  indistinguishable from the coalesced default; rapid shutdown OFF, because the column
 *  defaults to true. Every value here is chosen so a default cannot impersonate it. */
const PANEL_ID = 'panel-fence-ps1';
const INV_A = 'se-7600h';
const INV_B = 'se-10000h';

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,…) text.
 *  The only translation in this file — everything it feeds is production code.
 *  Same shim as tests/stageChangeLeavesATrace.postgres.test.ts. */
function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') {
      const r = await pg.query(strings, (values[0] as unknown[]) ?? []);
      return r.rows;
    }
    let text = '';
    const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    const r = await pg.query(text, params);
    return r.rows;
  }) as unknown as never;
}

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Test', email: 't@e.st', company: 'T' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

// ── The shipped project_files DDL, extracted rather than retyped ──────────────

const MIGRATE_ROUTE = read('app', 'api', 'migrate', 'route.ts');
const RUNS_MIGRATION = read('migrations', '009_engineering_runs.sql');

function inlineTableDdl(table: string): string {
  const at = MIGRATE_ROUTE.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (at < 0) {
    throw new Error(
      `app/api/migrate/route.ts no longer creates ${table}. It was the ONLY place in the ` +
      `repo that did; find the new home before trusting this fixture.`);
  }
  let depth = 0;
  const open = MIGRATE_ROUTE.indexOf('(', at);
  for (let j = open; j < MIGRATE_ROUTE.length; j++) {
    if (MIGRATE_ROUTE[j] === '(') depth++;
    else if (MIGRATE_ROUTE[j] === ')') { depth--; if (depth === 0) return MIGRATE_ROUTE.slice(at, j + 1); }
  }
  throw new Error(`unbalanced DDL for ${table}`);
}

const noConcurrently = (s: string) => s.replace(/CONCURRENTLY/gi, '');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(inlineTableDdl('project_files'));
  // The atomic-upsert constraint the route's ON CONFLICT targets — same statement the
  // migrate route ships, so the fast path is exercised rather than its DELETE+INSERT
  // fallback.
  await db.exec(`ALTER TABLE project_files
    ADD CONSTRAINT project_files_project_user_name_unique UNIQUE (project_id, user_id, file_name)`);
  await db.exec(noConcurrently(RUNS_MIGRATION));
});

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`DELETE FROM project_files; DELETE FROM engineering_runs;
                 DELETE FROM projects; DELETE FROM clients;`);
  await db.query(
    `INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Fence Co','f@e.st')`,
    [CLIENT_ID, USER_ID]);
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, system_type) VALUES ($1,$2,$3,'Fence job','fence')`,
    [PROJECT, USER_ID, CLIENT_ID]);
});

/** The payload app/engineering/page.tsx actually posts (field for field, ~line 6363). */
function savePayload(over: Record<string, unknown> = {}) {
  const inverters = [
    { id: 'inv-1', inverterId: INV_A, type: 'string',
      strings: [{ id: 's1', label: 'String 1', panelId: PANEL_ID, panelCount: 12, tilt: 90, azimuth: 180,
                  roofType: 'shingle', mountingSystem: 'solfence-8ft', wireGauge: '#10 AWG THWN-2', wireLength: 60 }] },
    { id: 'inv-2', inverterId: INV_B, type: 'string',
      strings: [{ id: 's2', label: 'String 2', panelId: PANEL_ID, panelCount: 14, tilt: 90, azimuth: 180,
                  roofType: 'shingle', mountingSystem: 'solfence-8ft', wireGauge: '#10 AWG THWN-2', wireLength: 80 }] },
  ];
  return {
    projectId: PROJECT,
    clientId: CLIENT_ID,
    clientName: 'Fence Co',
    systemKw: 11.7,
    panelCount: 26,
    panelModel: 'SolFence PS1 450W',
    inverterType: 'string',
    inverterModel: 'SolarEdge SE7600H',
    annualProductionKwh: 16400,
    mountType: 'Fence Mount',
    stateCode: 'IL',
    electrical: { mainPanelBus: 200, backfeedBreaker: 40, interconnection: 'LOAD_SIDE', dcWireGauge: '#10 AWG' },
    structural: null,
    compliance: { necVersion: 'NEC 2023' },
    bomItems: [
      { stage: 1, category: 'module', manufacturer: 'SolFence', model: 'PS1', partNumber: 'PS1-450',
        quantity: 26, unit: 'ea', unitCost: 210, totalCost: 5460, necReference: 'NEC 690.4' },
      { stage: 2, category: 'inverter', manufacturer: 'SolarEdge', model: 'SE7600H', partNumber: 'SE7600H-US',
        quantity: 1, unit: 'ea', unitCost: 1450, totalCost: 1450, necReference: 'NEC 690.8' },
    ],
    sldSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    permit: { ahj: 'Madison County', utility: 'ameren-il', estimatedFee: 150 },
    runs: [],
    address: '1 Fence Row, IL',
    utilityId: 'ameren-il',
    conduitType: 'EMT',
    strings: inverters.flatMap(i => i.strings.map(s => ({
      panelId: s.panelId, panelCount: s.panelCount, tilt: s.tilt, azimuth: s.azimuth,
      roofType: s.roofType, mountingSystem: s.mountingSystem, wireGauge: s.wireGauge, wireLength: s.wireLength,
    }))),
    configSnapshot: {
      inverters,
      mainPanelAmps: 200,
      panelBusRating: 200,
      interconnectionMethod: 'LOAD_SIDE',
      rapidShutdown: false,      // deliberately OFF — the column DEFAULTs to true
      acDisconnect: true,
      dcDisconnect: false,
      wireGauge: '#10 AWG THWN-2',
      wireLength: 60,
      conduitType: 'EMT',
      systemType: 'fence',       // deliberately NOT 'grid-tied'
      roofPitch: 90,
      state: 'IL',
      utilityId: 'ameren-il',
      mountingId: 'solfence-8ft',
    },
    ...over,
  };
}

async function postSave(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/save-outputs/route');
  const res = await POST(new Request('http://t/api/engineering/save-outputs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never);
  return { status: res.status, json: await res.json() };
}

async function getRunFromFile(fileId: string) {
  const { GET } = await import('@/app/api/engineering/run-from-file/route');
  const res = await GET(new Request(`http://t/api/engineering/run-from-file?fileId=${fileId}`) as never);
  return { status: res.status, json: await res.json() };
}

const runRow = async () =>
  (await db.query(`SELECT * FROM engineering_runs ORDER BY created_at DESC LIMIT 1`)).rows[0] as Record<string, unknown>;
const fileRow = async (name: string) =>
  (await db.query(`SELECT * FROM project_files WHERE file_name = $1`, [name])).rows[0] as Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 PRECONDITION — the columns exist, and the migration says what they are for', () => {
  it('migration 009 defines the equipment identity and states its purpose', () => {
    // If this ever fails, the finding below is about a schema that no longer exists and
    // every assertion in this file is vacuous.
    for (const col of ['panel_id', 'inverter_id', 'mounting_id', 'system_type', 'roof_pitch',
      'rapid_shutdown', 'ac_disconnect', 'dc_disconnect']) {
      expect(RUNS_MIGRATION, `009 no longer defines ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(RUNS_MIGRATION).toMatch(/traced back to the exact system configuration/i);
  });

  it('the live table really has them — measured, not assumed', async () => {
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'engineering_runs'`
    )).rows.map((r: Record<string, unknown>) => r.column_name);
    for (const col of ['panel_id', 'inverter_id', 'system_type', 'roof_pitch', 'rapid_shutdown']) {
      expect(cols, `${col} is missing from the built table`).toContain(col);
    }
  });
});

describe('🚨 the run records the equipment the design was built with', () => {
  it('writes panel_id and inverter_id — the whole point of the table', async () => {
    const r = await postSave(savePayload());
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    const run = await runRow();
    expect(run, 'no engineering_run row was created at all').toBeTruthy();
    expect(run.panel_id, 'the selected panel is still not recorded on the run').toBe(PANEL_ID);
    expect(run.inverter_id, 'the selected inverter is still not recorded on the run').toBe(INV_A);
    expect(run.mounting_id).toBe('solfence-8ft');
  });

  it('🚨 records system_type as FENCE, and does not invent grid-tied', async () => {
    await postSave(savePayload());
    const run = await runRow();
    expect(run.system_type, 'the design system type is still unrecorded').toBe('fence');
    expect(run.roof_pitch).toBe(90);
  });

  it('🚨 records rapid shutdown as OFF, against a column that defaults to true', async () => {
    // The direction that matters: never writing it meant a design with 690.12 rapid
    // shutdown deliberately excluded restored with it enabled — and with it the
    // rapid-shutdown devices in the BOM.
    await postSave(savePayload());
    const run = await runRow();
    expect(run.rapid_shutdown, 'rapid shutdown OFF still restores as ON').toBe(false);
    expect(run.dc_disconnect).toBe(false);
    expect(run.ac_disconnect).toBe(true);
  });

  it('🚨 keeps the whole topology in the snapshot — BOTH inverters, not just the first', async () => {
    await postSave(savePayload());
    const run = await runRow();
    const snap = run.config_snapshot as { inverters?: Array<{ inverterId: string }> };
    expect(snap.inverters, 'the client configSnapshot is still being discarded').toBeTruthy();
    expect(snap.inverters!.map(i => i.inverterId)).toEqual([INV_A, INV_B]);
  });

  it('🚨 does not store a device count — `inverter_qty INTEGER DEFAULT 1` wrote a 1 for every design', async () => {
    // Two inverters in the topology, and the column used to hold 1 — not because anything
    // counted, but because nothing wrote it and the DDL default filled it in. The count is
    // a conclusion of the topology read against manufacturer capacity, so NULL is passed
    // EXPLICITLY here to bypass that default: "ask the authority" is recoverable, a stored
    // 1 is not, and deriving a second number from `inverters.length` would be both a second
    // quantity authority and wrong for microinverters.
    await postSave(savePayload());
    const run = await runRow();
    expect(run.inverter_qty ?? null, 'a device count is still being invented by the column default')
      .toBeNull();
    // And the topology it must be read from is present and complete.
    expect((run.config_snapshot as { inverters: unknown[] }).inverters).toHaveLength(2);
  });

  it('the route still preserves the one key it always preserved', async () => {
    await postSave(savePayload({
      configSnapshot: { ...savePayload().configSnapshot, consumptionCtLocation: 'LOAD_SIDE_OF_MAIN' },
    }));
    const run = await runRow();
    expect((run.config_snapshot as { consumptionCtLocation?: string }).consumptionCtLocation)
      .toBe('LOAD_SIDE_OF_MAIN');
  });

  it('an absent id is left NULL rather than guessed', async () => {
    // A null identity is recoverable — the restore can say "this run predates identity
    // capture" and refuse to substitute. A guessed identity is not.
    const p = savePayload();
    await postSave({ ...p, configSnapshot: { ...(p.configSnapshot as object), inverters: [] } });
    const run = await runRow();
    expect(run.panel_id ?? null).toBeNull();
    expect(run.inverter_id ?? null).toBeNull();
  });
});

describe('🚨 the restore reads the real equipment back', () => {
  it('🚨 run-from-file returns the designed panel and inverter, not a catalogue default', async () => {
    await postSave(savePayload());
    const bom = await fileRow('BOM_Fence_Co.csv');
    expect(bom, 'the BOM file was not saved').toBeTruthy();
    const r = await getRunFromFile(String(bom.id));
    expect(r.status).toBe(200);
    expect(r.json.run.panelId, 'the restore would substitute qcells-peak-duo-400 here').toBe(PANEL_ID);
    expect(r.json.run.inverterId, 'the restore would substitute STRING_INVERTERS[0] here').toBe(INV_A);
    expect(r.json.run.systemType).toBe('fence');
    expect(r.json.equipmentIdentity.complete,
      'the restore cannot tell whether it is about to substitute').toBe(true);
    expect(r.json.equipmentIdentity.reason).toBeNull();
  });

  it('🚨 a legacy run says it CANNOT be restored, instead of reading as grid-tied', async () => {
    // A row exactly as the old route left it: no identity, no system type. This is what
    // every engineering_run in the product looks like today.
    // inverter_qty is written as 1 on purpose: that is what the DDL default put in every
    // legacy row, and the point is that the reader cannot tell it from a measured 1.
    await db.query(
      `INSERT INTO engineering_runs (id, project_id, user_id, client_id, panel_count, inverter_type, inverter_qty)
       VALUES ('legacy-run-1', $1, $2, $3, 26, 'string', 1)`, [PROJECT, USER_ID, CLIENT_ID]);
    await db.query(
      `INSERT INTO project_files (project_id, client_id, user_id, file_name, file_type, engineering_run_id)
       VALUES ($1, $2, $3, 'BOM_Legacy.csv', 'engineering', 'legacy-run-1')`,
      [PROJECT, CLIENT_ID, USER_ID]);
    const f = await fileRow('BOM_Legacy.csv');
    const r = await getRunFromFile(String(f.id));
    expect(r.status).toBe(200);
    expect(r.json.run.systemType, "'grid-tied' is not a SystemType and must not be invented").toBeNull();
    // The stored 1 passes through — it cannot be told apart from a measured 1, which is
    // precisely why the identity verdict below has to exist and be read instead.
    expect(r.json.run.inverterQty).toBe(1);
    expect(r.json.equipmentIdentity.complete).toBe(false);
    expect(r.json.equipmentIdentity.reason, 'nothing tells the caller why this cannot be trusted')
      .toMatch(/cannot reproduce the original equipment/i);
  });
});

describe('🚨 the stored BOM can never be attributed to equipment it was not built from', () => {
  it('the saved BOM is linked to the run that produced it', async () => {
    await postSave(savePayload());
    const bom = await fileRow('BOM_Fence_Co.csv');
    const run = await runRow();
    expect(bom.engineering_run_id, 'the BOM is not traceable to any run').toBe(run.id);
  });

  it('🚨 changing the inverter moves the BOM to a run whose identity is the NEW inverter', async () => {
    // The staleness property, end to end: selected equipment → run identity → the stored
    // BOM's own link. Before the identity was written, both runs carried inverter_id NULL,
    // so no consumer could tell which equipment the CSV in Client Files described — and the
    // restore would have re-equipped either of them with the first catalogue entry.
    await postSave(savePayload());
    const firstRun = await runRow();

    const p2 = savePayload();
    const swapped = (p2.configSnapshot as { inverters: Array<{ inverterId: string }> });
    swapped.inverters = [{ ...swapped.inverters[0], inverterId: INV_B }];
    await postSave({ ...p2, inverterModel: 'SolarEdge SE10000H' });

    const secondRun = await runRow();
    expect(secondRun.id, 'the second save did not create a new run').not.toBe(firstRun.id);
    expect(secondRun.inverter_id).toBe(INV_B);

    // One BOM file (upsert by name), now pointing at the run that actually built it.
    const bom = await fileRow('BOM_Fence_Co.csv');
    expect(bom.engineering_run_id).toBe(secondRun.id);
    const r = await getRunFromFile(String(bom.id));
    expect(r.json.run.inverterId, 'the stored BOM still resolves to the superseded inverter')
      .toBe(INV_B);
  });
});
