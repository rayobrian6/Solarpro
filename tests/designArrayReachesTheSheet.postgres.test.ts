// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ARRAY ON THE SHEET IS THE ARRAY DESIGN PLACED — WITH THE INVERTER FLEET RETIRED.
//
// Ray's live sheet, 2026-10-03, after "Inverter: None" finally reached the record:
//
//   PV INVERTER = NONE · PV DC COUPLED TO POWERWALL 3                      ← correct, must survive
//   20 × 400 W · 8.00 kW DC · 2 × 10 strings                               ← design is 37 × 440 W
//
// The chain that produced it, read in the source:
//
//   page.tsx    totalPanels = Σ config.inverters[].strings[].panelCount          → 0 (fleet retired)
//               panelData   = getPanelById(config.inverters[0].strings[0].panelId) → null
//   sld route   totalModules = Number(body.totalModules) || 20                    → 20
//               panelWatts   = Number(body.panelWatts)   || 400                   → 400
//
// The repair is on both sides of the handoff (writer AND consumer): the page describes the array
// from Design (`resolvePvArrayDesign`), and the canonical projection that both SLD routes call
// reads the array from the stores Design writes, so a stale page body cannot draw a different one.
// This file drives the CONSUMER through the real route handlers on real PostgreSQL, posting the
// exact body the page sent before its half of the repair — the worst case the routes must survive.
//
// Mutation proof is recorded in docs/gauntlet/SYSTEM-CONFIG-GAUNTLET.md: restoring
// `Number(body.totalModules) || 20` with the projection removed turns this file red.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const RAY = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const HOUSE = '5a1e7c2d-0c1b-4f7e-9d55-3a9b8c7d6e01';
// Ray's module: Philadelphia Solar Nexus PS-MNB108(HCBF)-440W, the SolFence panel.
const RAYS_MODULE = 'panel-fence-ps1';
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
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/sld/pdf/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
  ]);
}, 90_000);
afterAll(async () => { await db?.close(); });

/** `n` placed modules, as Design writes them — each stamped with its wattage. */
const placed = (n: number, wattage: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({
    id: `pnl-${i}`, layoutId: 'lo', lat: 0, lng: 0, x: 0, y: 0, tilt: 90, azimuth: 180,
    wattage, bifacialGain: 0, row: 0, col: i, systemType: 'fence',
  })));

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  for (const [id, name] of [[RAY, 'Hussey Ethos 400A'], [HOUSE, 'Normal Residence']]) {
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address)
       VALUES ($1, $2, $3, 'lead', 'fence', '238 N Warwick Ave, Peoria, IL')`, [id, USER_ID, name]);
  }
});

/**
 * Ray's row AFTER "Inverter: None" (4375ba3): the coupling is a recorded installer decision, the
 * standalone inverter is gone from both stores, the fleet is empty — and Design still holds
 * 37 × 440 W, which is the fact that went missing.
 */
async function writeRaysResolvedRow(opts?: { layout?: boolean; module?: string | null }) {
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(buildRaysIntendedJob().topology)));
  stored.topology.solarCoupling = 'dc-coupled-storage';
  const mod = opts?.module === undefined ? RAYS_MODULE : opts.module;
  const se = {
    batteryCount: 4, inverter: null, inverterId: null,
    ...(mod ? { panelId: mod } : {}),
    provenance: {
      architecture: { kind: 'USER_SELECTED', recordedAt: '2026-10-02T22:00:00.000Z',
        basis: 'Inverter: None — PV direct to Powerwall 3', by: 'ecosystem-picker' },
    },
  };
  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4 WHERE id = $1`,
    [RAY, JSON.stringify(stored), JSON.stringify(se),
     JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 400 })]);
  if (opts?.layout !== false) {
    await db.query(
      `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'fence',$3::jsonb,$4)`,
      [RAY, USER_ID, placed(37, 440), 37]);
  }
}

/**
 * 🚨 THE BODY THE PAGE POSTED BEFORE ITS HALF OF THE REPAIR — with the fleet retired it carried no
 * module count and no module, and the old fallbacks filled both in. The routes must draw Design's
 * array from this body, not a fabricated one.
 */
function stalePageBody(projectId: string, over: Record<string, unknown> = {}) {
  return {
    projectId,
    projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave, Peoria, IL',
    drawingDate: '2026-10-03', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: 'DC_COUPLED_STORAGE',
    totalModules: 0, totalStrings: 0,
    panelModel: 'Solar Panel',
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    acWireGauge: '#6 AWG', acConduitType: 'EMT', acWireLength: 60,
    mainPanelAmps: 400, utilityName: 'Ameren Illinois',
    hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
    ...over,
  };
}

async function postSld(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, format: 'json' }),
  }));
  const json = await res.json() as Record<string, any>;
  return { status: res.status, json, svg: String(json.svg ?? '') };
}

async function postPdfAsSvg(buildInput: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/sld/pdf/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildInput, format: 'svg' }),
  }));
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try { json = JSON.parse(text); } catch { /* svg */ }
  return { status: res.status, svg: json ? String(json.svg ?? '') : text, json };
}

/** Text content of an SVG with tags stripped, so assertions read what a human reads. */
const textOf = (svg: string) => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('🚨 Ray\'s resolved DC-coupled job — the array survives the retired inverter', () => {
  it('the Diagram route draws 37 × 440 W and 16.28 kW from Design, from a body that carried neither', async () => {
    await writeRaysResolvedRow();
    const r = await postSld(stalePageBody(RAY));
    expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
    const t = textOf(r.svg);
    expect(t).toContain('37 × 440W');
    expect(t).toMatch(/16\.28 kW/);
    expect(t).toContain('Total Modules 37');
    // The phantom array is gone in every spelling it used to take.
    expect(t).not.toContain('20 × 400W');
    expect(t).not.toMatch(/\b8\.00 kW\b/);
    // …and the half of the sheet that was already right stays right.
    expect(t).toContain('DC COUPLED');
    expect(t).not.toContain('Tesla Solar Inverter');
    expect(t).not.toMatch(/Fronius|SE7600H|Q\.PEAK DUO/);
  });

  it('every string the sheet draws covers the 37 real modules, against the Powerwall 3 window', async () => {
    await writeRaysResolvedRow();
    const r = await postSld(stalePageBody(RAY));
    const t = textOf(r.svg);
    const m = t.match(/Strings\s+(\d+):\s*([\d\s/]+)\s*panels/);
    expect(m, 'the schedule states the real per-string array').not.toBeNull();
    const counts = m![2].split('/').map(x => Number(x.trim())).filter(n => n > 0);
    expect(counts.reduce((a, b) => a + b, 0), `strings ${m![2]} must cover exactly 37 modules`).toBe(37);
    // Not the phantom's 2 × 10.
    expect(counts).not.toEqual([10, 10]);
  });

  it('the exported PDF route draws the same array from the same body', async () => {
    await writeRaysResolvedRow();
    const r = await postPdfAsSvg(stalePageBody(RAY));
    expect(r.status, JSON.stringify(r.json ?? {}).slice(0, 400)).toBe(200);
    const t = textOf(r.svg);
    expect(t).toContain('37 × 440W');
    expect(t).not.toContain('20 × 400W');
    expect(t).toContain('Total Modules 37');
  });

  it('a stale module the page still had in memory does not outrank the project\'s recorded module', async () => {
    await writeRaysResolvedRow();
    const r = await postSld(stalePageBody(RAY, {
      totalModules: 20, panelWatts: 400, panelVoc: 41.6, panelIsc: 12.26, panelVmp: 34.5, panelImp: 11.59,
      panelModel: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 400W', panelId: 'qcells-peak-duo-400',
    }));
    expect(r.status).toBe(200);
    const t = textOf(r.svg);
    expect(t).toContain('37 × 440W');
    expect(t).not.toContain('20 × 400W');
  });
});

describe('🚨 nothing is invented when Design has not placed the array', () => {
  it('no layout and no count anywhere ⇒ INPUT REQUIRED naming what, why, whose and what it blocks', async () => {
    await writeRaysResolvedRow({ layout: false });
    const r = await postSld(stalePageBody(RAY));
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('PV_ARRAY_INPUT_REQUIRED');
    const missing = r.json.missing as Array<{ fact: string; why: string; owner: string; blocks: string[] }>;
    expect(missing.map(m => m.fact)).toContain('PV module count');
    for (const m of missing) {
      expect(m.why.length).toBeGreaterThan(10);
      expect(m.owner).toMatch(/Design/);
      expect(m.blocks).toContain('SLD');
    }
  });

  it('a count with no recorded module ⇒ INPUT REQUIRED for the module, never a 400 W default', async () => {
    await writeRaysResolvedRow({ module: null });
    const r = await postSld(stalePageBody(RAY));
    expect(r.status).toBe(422);
    expect((r.json.missing as Array<{ fact: string }>).map(m => m.fact)).toContain('PV module model');
  });

  it('the PDF route refuses the same way', async () => {
    await writeRaysResolvedRow({ layout: false });
    const r = await postPdfAsSvg(stalePageBody(RAY));
    expect(r.status).toBe(422);
    expect(r.json?.code).toBe('PV_ARRAY_INPUT_REQUIRED');
  });
});

describe('control — a design the old path drew correctly is unchanged', () => {
  it('a body that already carries its array, on a project with no stored array, is drawn as posted', async () => {
    // No layout, no selected module: the store has no answer, so the posted array stands exactly as
    // before. Without this control a projection that overwrote everything would also pass the cases above.
    const r = await postSld({
      projectId: HOUSE, projectName: 'Normal Residence', topologyType: 'STRING_INVERTER',
      inverterModel: 'SolarEdge SE7600H', inverterManufacturer: 'SolarEdge',
      totalModules: 20, totalStrings: 2,
      panelModel: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 400W', panelWatts: 400,
      panelVoc: 45.3, panelIsc: 11.14, panelVmp: 37.13, panelImp: 10.77,
      mainPanelAmps: 200, utilityName: 'Ameren Illinois',
    });
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    expect(textOf(r.svg)).toContain('20 × 400W');
  });
});
