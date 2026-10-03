// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BOM ORDERS, AND PRICES, THE ARRAY DESIGN PLACED. THE PERMIT IS COMPARED, NOT CORRECTED.
//
// Ray, gauntlet step 11: "SLD, BOM, permit, planset and pricing are consumers… An output generator
// must never say: I don't know the inverter, so I'll use Fronius… The BOM orders that same result.
// The permit describes that same result. Pricing prices that same result."
//
// Measured on Ray's resolved row through the real BOM route BEFORE this file's repair, with the body
// a stale page sends (20 modules, Q.PEAK 400 W, 8.0 kW):
//
//   solar_panel | Q CELLS | Q.PEAK DUO BLK ML-G10+ 400W | qty 37     ← right count, WRONG module, priced
//   [SIZING ENGINE] panelWattage = 8.0 kW / 37 = 216 W                ← the 8.0 kW default
//
// The count was already Design's (the canonical model owned it); the module and the DC size were the
// browser's. Both now come from `loadElectricalProject().pvArray` — the same resolver output both SLD
// routes project — via `projectPvArrayOntoBom`.
//
// 🚨 THE PERMIT IS DELIBERATELY NOT CORRECTED. Its body becomes the sealed snapshot in the same pass
// and the array facts are inside `meta.digest`; measured on the roof permit fixture, correcting the DC
// size, the module or the count each moves the digest, while a no-op projection does not. A digest
// move retires the design's live PE approval, so the permit route only COMPARES and logs.
//
// Pricing: the BOM's distributor pricing prices the BOM lines, so it prices the design's module now.
// The customer price (`/api/production`, the proposals) is computed from the Design layout itself —
// `layout.systemSizeKw`, `layout.totalPanels` and the selected panel Design saved — and a proposal
// prices a frozen snapshot that may already be signed, so neither is re-sourced here.
//
// Mutation proofs for every guard in this file are listed in the commit message.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { stripComments } from './support/stripSource';

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
    import('@/app/api/engineering/bom/route'),
    import('@/app/api/engineering/sld/route'),
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
  for (const [id, name, type] of [[RAY, 'Hussey Ethos 400A', 'fence'], [HOUSE, 'Normal Residence', 'roof']]) {
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address)
       VALUES ($1, $2, $3, 'lead', $4, '238 N Warwick Ave, Peoria, IL')`, [id, USER_ID, name, type]);
  }
});

/**
 * Ray's row AFTER "Inverter: None": the coupling is a recorded installer decision, the standalone
 * inverter is gone from both stores, the fleet is empty — and Design holds 37 × 440 W.
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
 * 🚨 A STALE PAGE BODY — the browser's memory of an array Design does not hold: 20 modules, the
 * page's 400 W default panel, an 8.0 kW system, and the retired fleet's Fronius still in the tab.
 */
function staleBomBody(projectId: string, over: Record<string, unknown> = {}) {
  return {
    projectId, systemType: 'fence',
    moduleCount: 20, totalPanels: 20,
    panelId: 'qcells-peak-duo-400', panelWatts: 400,
    systemKw: 8.0,
    inverterId: 'fronius-primo-8.2', stringCount: 2,
    batteryId: 'tesla-powerwall-3', batteryCount: 1, batteryEnabled: true,
    mainPanelAmps: 200,
    ...over,
  };
}

async function postBom(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Record<string, any> };
}

type Line = { category: string; manufacturer?: string; model?: string; partNumber?: string;
  description?: string; quantity: number; unitCost?: number; totalCost?: number };
const lines = (json: Record<string, any>): Line[] => (json.bom?.items ?? []) as Line[];
const panelLines = (json: Record<string, any>) => lines(json).filter(i => i.category === 'solar_panel');
const textOf = (i: Line) => [i.manufacturer, i.model, i.partNumber, i.description].join(' ');
const check = (json: Record<string, any>, id: string) =>
  (json.validation?.checks as Array<{ id: string; detail: string }> | undefined)?.find(c => c.id === id)?.detail;
/** Every way a phantom PV product has been spelled on a Ray sheet. */
const PHANTOM = /Fronius|Primo|SE7600H|SE-7600H|Q\.PEAK|Q CELLS/i;
/** Standalone PV conversion equipment — none exists on a DC-coupled Powerwall 3 design. */
const PV_CONVERSION = new Set(['string_inverter', 'inverter', 'hybrid_inverter', 'microinverter', 'optimizer']);

describe('🚨 Ray\'s resolved DC-coupled job — the BOM orders the array Design placed', () => {
  it('a stale page body orders 37 × the 440 W module at 16.28 kW, and no PV inverter', async () => {
    await writeRaysResolvedRow();
    const r = await postBom(staleBomBody(RAY));
    expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);

    // The modules ordered: one line, 37 of them, Ray's module.
    const pl = panelLines(r.json);
    expect(pl.map(textOf), 'exactly one module line').toHaveLength(1);
    expect(pl[0].quantity).toBe(37);
    expect(pl[0].manufacturer).toBe('Philadelphia Solar');
    expect(textOf(pl[0])).toContain('440W');

    // The system size the engine sized from: its own sanity check divides the kW it received by the
    // module count it received. 16.28 kW / 37 = 440 W — the 8.0 kW default gives 216 W.
    expect(check(r.json, 'module-count')).toBe('37 modules');
    expect(check(r.json, 'kw-sanity')).toBe('440W per panel');

    // No phantom product, and no standalone PV conversion line, anywhere on the order.
    const phantoms = lines(r.json).filter(i => PHANTOM.test(textOf(i))).map(textOf);
    expect(phantoms, `phantom products ordered: ${phantoms.join(' | ')}`).toEqual([]);
    const conv = lines(r.json).filter(i => PV_CONVERSION.has(i.category)).map(textOf);
    expect(conv, `standalone PV conversion equipment ordered: ${conv.join(' | ')}`).toEqual([]);

    // The rest of the canonical projection still holds: four Powerwall 3 cabinets, from the graph.
    const pw = lines(r.json).filter(i => i.category === 'battery');
    expect(pw.reduce((n, i) => n + i.quantity, 0)).toBe(4);

    // And the response says what it ordered and what it overrode.
    const pv = r.json.electrical?.pvArray;
    expect(pv).toMatchObject({
      moduleCount: 37, moduleCountSource: 'design-placed-modules',
      panelId: RAYS_MODULE, moduleWatts: 440, dcStcKw: 16.28, missing: [],
    });
    const corrected = (pv.corrected as string[]).join('\n');
    expect(corrected).toMatch(/module count: posted 20 → design 37/);
    expect(corrected).toMatch(/module: posted qcells-peak-duo-400 400 W → project panel-fence-ps1 440 W/);
    expect(corrected).toMatch(/DC size: posted 8 kW → design 16\.28 kW/);
  });

  it('the Diagram and the parts list describe the same array from the same stale state', async () => {
    await writeRaysResolvedRow();
    const bom = await postBom(staleBomBody(RAY));
    const { POST } = await import('@/app/api/engineering/sld/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: RAY, format: 'json', projectName: 'Hussey Ethos', topologyType: 'DC_COUPLED_STORAGE',
        totalModules: 20, totalStrings: 2, panelWatts: 400, panelId: 'qcells-peak-duo-400',
        panelModel: 'Q CELLS Q.PEAK DUO BLK ML-G10+ 400W', mainPanelAmps: 200, utilityName: 'Ameren Illinois',
        hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 1,
      }),
    }));
    const sld = await res.json() as Record<string, any>;
    expect(res.status, JSON.stringify(sld).slice(0, 300)).toBe(200);
    const sheet = String(sld.svg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const pl = panelLines(bom.json)[0];
    expect(sheet).toContain(`${pl.quantity} × 440W`);
    expect(pl.quantity).toBe(37);
  });

  it('a body that already agrees with Design is ordered as posted, and nothing is reported as corrected', async () => {
    // The no-op case. Without it, a projection that rewrote every request would pass the case above.
    await writeRaysResolvedRow();
    const r = await postBom(staleBomBody(RAY, {
      moduleCount: 37, totalPanels: 37, panelId: RAYS_MODULE, panelWatts: 440, systemKw: 16.28,
      inverterId: undefined,
    }));
    expect(r.status).toBe(200);
    expect(r.json.electrical?.pvArray?.corrected).toEqual([]);
    expect(panelLines(r.json)[0]).toMatchObject({ quantity: 37, manufacturer: 'Philadelphia Solar' });
    expect(check(r.json, 'kw-sanity')).toBe('440W per panel');
  });

  it('pricing prices the design\'s modules: the stale and the agreeing body buy the same priced module line', async () => {
    await writeRaysResolvedRow();
    const stale = panelLines((await postBom(staleBomBody(RAY))).json)[0];
    const agreeing = panelLines((await postBom(staleBomBody(RAY, {
      moduleCount: 37, totalPanels: 37, panelId: RAYS_MODULE, panelWatts: 440, systemKw: 16.28, inverterId: undefined,
    }))).json)[0];
    expect(stale.partNumber).toBe(agreeing.partNumber);
    expect(stale.quantity).toBe(37);
    expect(typeof stale.unitCost).toBe('number');
    expect(stale.unitCost).toBe(agreeing.unitCost);
    expect(stale.totalCost).toBe(agreeing.totalCost);
    expect(stale.totalCost).toBeCloseTo((stale.unitCost as number) * 37, 2);
  });
});

describe('🚨 nothing is invented when Design has not placed the array', () => {
  it('control — no layout and no recorded module: the posted array, and its string inverter, stand', async () => {
    // HOUSE has no layout, no selected module and no service graph: the store has no answer, so the
    // request is the manual entry and is ordered exactly as posted. Without this control a projection
    // that overwrote everything would also pass every case above.
    const r = await postBom({
      projectId: HOUSE, systemType: 'roof', moduleCount: 20, totalPanels: 20,
      panelId: 'qcells-peak-duo-400', systemKw: 8.0, inverterId: 'se-7600h', stringCount: 2,
      mainPanelAmps: 200, rackingId: 'ironridge-xr100',
    });
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    const pl = panelLines(r.json);
    expect(pl).toHaveLength(1);
    expect(pl[0].quantity).toBe(20);
    expect(textOf(pl[0])).toMatch(/Q\.PEAK/);
    expect(check(r.json, 'kw-sanity')).toBe('400W per panel');
    // The coupling arm only strips inverters from projects that record a DC-coupled architecture.
    expect(lines(r.json).some(i => PV_CONVERSION.has(i.category)), 'the posted string inverter was dropped')
      .toBe(true);
    const pv = r.json.electrical?.pvArray;
    expect(pv?.moduleCount).toBeNull();
    expect(pv?.corrected).toEqual([]);
    expect((pv?.missing as Array<{ fact: string }>).map(f => f.fact)).toContain('PV module count');
  });

  it('Design placed 37 and no store names the module: Design\'s count and size, no module ordered, the gap reported', async () => {
    await writeRaysResolvedRow({ module: null });
    const r = await postBom(staleBomBody(RAY));
    expect(r.status).toBe(200);
    const pl = panelLines(r.json);
    expect(pl).toHaveLength(1);
    expect(pl[0].quantity).toBe(37);
    // Not the page's default panel — a TBD line the installer has to resolve.
    expect(pl[0].partNumber).toBe('PANEL-TBD');
    expect(lines(r.json).filter(i => PHANTOM.test(textOf(i))).map(textOf)).toEqual([]);
    // The DC size is Design's own stamped wattage, 37 × 440 W.
    expect(check(r.json, 'kw-sanity')).toBe('440W per panel');
    expect(r.json.electrical?.pvArray?.dcSizeSource).toBe('design-placed-wattage');
    expect((r.json.electrical?.pvArray?.missing as Array<{ fact: string }>).map(f => f.fact))
      .toContain('PV module model');
    expect((r.json.summary?.warnings as string[]).some(w => /^PV module model not established/.test(w)),
      'the missing module is not reported on the BOM').toBe(true);
  });

  it('no DC size anywhere: the placeholder is reported, never passed off as the system size', async () => {
    const r = await postBom({
      projectId: HOUSE, systemType: 'roof', moduleCount: 20, panelId: 'qcells-peak-duo-400',
      inverterId: 'se-7600h', stringCount: 2, mainPanelAmps: 200,
    });
    expect(r.status).toBe(200);
    expect((r.json.summary?.warnings as string[]).some(w => /^PV DC size not established/.test(w)),
      'an 8.0 kW placeholder sized this BOM without saying so').toBe(true);
  });
});

describe('🚨 a corrected module count does not leave a micro count describing a different array', () => {
  // Same defect the SLD projection found on the brand-family fixtures: correct the modules from 21 to
  // 24 and leave the posted 21 micros, and the order contradicts itself. Pure — no route needed.
  const design24 = async () => {
    const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
    return resolvePvArrayDesign({ placedModuleCount: 24, layoutTotalPanels: 24, selectedPanelId: RAYS_MODULE });
  };

  it('the micro count is re-derived from the RECORDED micro\'s ratio, and the stale branch count withdrawn', async () => {
    const { projectPvArrayOntoBom } = await import('@/lib/electrical/outputPvArrayProjection');
    const one = { moduleCount: 21, deviceCount: 21, branchCount: 2 } as Record<string, unknown>;
    projectPvArrayOntoBom(one, await design24(), 't', { microModulesPerDevice: 1 });
    expect(one).toMatchObject({ moduleCount: 24, totalPanels: 24, deviceCount: 24 });
    expect('branchCount' in one, 'a branch count derived from 21 modules survived').toBe(false);
    // A dual-module micro is not 1:1.
    const dual = { moduleCount: 21, deviceCount: 11 } as Record<string, unknown>;
    projectPvArrayOntoBom(dual, await design24(), 't', { microModulesPerDevice: 2 });
    expect(dual.deviceCount).toBe(12);
  });

  it('with no recorded micro the posted device count is left, never guessed 1:1', async () => {
    const { projectPvArrayOntoBom } = await import('@/lib/electrical/outputPvArrayProjection');
    const b = { moduleCount: 21, deviceCount: 21 } as Record<string, unknown>;
    projectPvArrayOntoBom(b, await design24(), 't', { microModulesPerDevice: null });
    expect(b).toMatchObject({ moduleCount: 24, deviceCount: 21 });
  });

  it('a count that already agrees touches neither', async () => {
    const { projectPvArrayOntoBom } = await import('@/lib/electrical/outputPvArrayProjection');
    const b = { moduleCount: 24, deviceCount: 24, branchCount: 2 } as Record<string, unknown>;
    const r = projectPvArrayOntoBom(b, await design24(), 't', { microModulesPerDevice: 1 });
    expect(b).toMatchObject({ deviceCount: 24, branchCount: 2 });
    expect(r.corrected.some(c => /count/.test(c))).toBe(false);
  });
});

describe('🚨 the permit reads the same array — and is compared, not corrected, because its digest is sealed', () => {
  it('the permit body the page posts for Ray\'s job disagrees with Design, and the comparison names it', async () => {
    await writeRaysResolvedRow();
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const { comparePermitArrayWithDesign } = await import('@/lib/electrical/outputPvArrayProjection');
    const pv = (await loadElectricalProject(RAY, USER_ID))!.pvArray;
    // What app/engineering/page.tsx posts with the fleet retired: the layout's 37, a DC size of
    // 37 × its 0.4 kW fallback, no strings and no project-level module.
    const body = deepFreeze({ system: { totalPanels: 37, totalDcKw: 14.8, inverters: [] }, project: {} });
    const d = comparePermitArrayWithDesign(body, pv);
    expect(d.join('\n')).toMatch(/module: the permit names none .* design panel-fence-ps1 Philadelphia Solar .* 440 W/);
    expect(d.join('\n')).toMatch(/DC size: permit 14\.8 kW — design 16\.28 kW/);
    expect(d.some(x => /module count/.test(x)), 'the counts agree and must not be reported').toBe(false);
  });

  it('a permit body that agrees with Design reports nothing', async () => {
    await writeRaysResolvedRow();
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const { comparePermitArrayWithDesign } = await import('@/lib/electrical/outputPvArrayProjection');
    const pv = (await loadElectricalProject(RAY, USER_ID))!.pvArray;
    expect(comparePermitArrayWithDesign({
      system: { totalPanels: 37, totalDcKw: 16.28,
        inverters: [{ strings: [{ panelId: RAYS_MODULE, panelModel: 'Nexus PS-MNB108(HCBF)-440W', panelWatts: 440 }] }] },
    }, pv)).toEqual([]);
  });

  it('the permit route compares the design array and writes none of it into the body it seals', () => {
    const route = stripComments(read('app', 'api', 'engineering', 'permit', 'route.ts'));
    expect(route).toContain('comparePermitArrayWithDesign(body, _electrical.pvArray)');
    // The ONLY use of the design array on the permit path is that comparison. Any other reference —
    // an assignment, a projector — is a digest rotation and needs the operator's decision first.
    const uses = route.match(/pvArray/g) ?? [];
    expect(uses, 'the permit route uses the design array for more than the comparison').toHaveLength(1);
    expect(route).not.toMatch(/projectPvArray(OntoBom)?\s*\(/);
  });
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
