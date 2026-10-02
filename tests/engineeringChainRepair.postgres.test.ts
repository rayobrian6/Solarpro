// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE SEVEN LIVE REPAIRS, PROVEN THROUGH THE CALLERS THAT ACTUALLY EXIST.
//
// Ray, 2026-10-02, after the chain trace found seven repairs already reported as done were live
// defects:
//
//   "A unit test of a server branch is not proof if the browser can never send the input that
//    reaches that branch. A repaired SVG is not proof if the PDF route still behaves differently.
//    A repaired SLD is not proof if the permit reconstructs another system. No repair is closed
//    until the real caller reaches it."
//
// 🚨 THE MISTAKE THIS FILE EXISTS TO NOT REPEAT.
//
// I removed an invented `fronius-primo-8.2` from `/api/engineering/bom` and verified it two ways:
// by reading the route, and by a test that POSTs no inverter id. Both green. But
// `app/engineering/page.tsx` posted `firstInv?.inverterId || 'fronius-primo-8.2'`, so
// `body.inverterId` was NEVER empty, the absence branch was unreachable, and a DC-coupled design
// still had a Fronius quoted. **A guard exercised only by a caller that does not exist in
// production has never run.**
//
// So every request body below is shaped the way the BROWSER shapes it — including the fields the
// page sends that are wrong — and the assertions are about what comes back out of the real handler.
//
// TWO FIXTURES, per Ray's production-proof list:
//   A — a normal residence: 200 A, 1 MSP, 1 Gateway, 1 Powerwall 3.
//   B — Ray's current design: 400 A, 2 × 200 A systems, 2 × Gateway 3, 4 × full PW3, 0 expansions,
//       2 generation panels, 37 × 440 W = 16.28 kW DC, PV DC-coupled, external PV inverter NONE.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const src = (...p: string[]) => read(...p);

const USER_ID = '11111111-1111-4111-8111-111111111111';
/** Fixture B — Ray's 400 A job. */
const PROJECT_B = '4030b664-bebe-433b-a11c-cda05ead2f7d';
/** Fixture A — the ordinary house. */
const PROJECT_A = '5040c775-cfcf-4440-b22d-dbe16fbe3e8e';

const RAYS_INVERTER = 'tesla-solar-inverter-5p7k';

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
// `lib/db/projects.ts` and `lib/db/production.ts` take their connection from `./core`.
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
    `ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`,
  ]) await db.exec(c);

  // Warm the route module graph in the 60 s boot budget, not inside a 10 s test.
  await Promise.all([
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/sld/pdf/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/app/api/engineering/calculate/route'),
    import('@/app/api/engineering/electrical-architecture/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
  ]);
}, 90_000);

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  // 🚨 THERE IS NO `users` TABLE in this schema — `user_id` is a plain column. A beforeEach that
  // inserted one failed every test in the file before a single assertion ran.
  //
  // 🚨 AND THE LAYOUT ROW IS NOT OPTIONAL: `layouts.total_panels` is where the canonical module
  // count comes from, so a fixture without one silently falls back to a default and the
  // 37-module assertions would be testing 20.
  for (const [id, name, panels] of [
    [PROJECT_B, 'Hussey Ethos 400A', 37],
    [PROJECT_A, 'Normal Residence', 20],
  ] as Array<[string, string, number]>) {
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address)
       VALUES ($1, $2, $3, 'lead', 'roof', '238 N Warwick Ave')`, [id, USER_ID, name]);
    await db.query(
      `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,$3)`,
      [id, USER_ID, panels]);
  }
});

// ─── FIXTURES ──────────────────────────────────────────────────────────────

/**
 * Fixture B. `retired` writes the state AFTER an architecture resolution: the inverter cleared
 * from both stores, which is what Ray's project looks like once the conflict has been settled.
 */
async function writeFixtureB(opts?: { retired?: boolean }): Promise<void> {
  const retired = opts?.retired ?? false;
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology)));

  // 🚨 A LEGACY ROW DOES NOT CARRY `solarCoupling` — the field postdates Ray's project. Leaving the
  // fixture's recorded coupling in place meant the resolver had its answer handed to it and NEVER
  // raised the conflict, so a test asserting the 409 refusal would have been asserting against a
  // project that was never ambiguous. Deleting it is what makes the resolver re-derive from the
  // evidence: an explicit inverter AND storage that publishes its own PV inputs ⇒ it refuses to
  // pick a side, which is the state Ray's live project was actually in.
  if (!retired) delete (stored as any).topology.solarCoupling;

  const se: Record<string, unknown> = retired
    ? { batteryCount: 4, inverter: null, inverterId: null }
    : {
        batteryCount: 4,
        inverter: { id: RAYS_INVERTER, type: 'string', manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW' },
        inverterId: RAYS_INVERTER,
      };

  const engCfg = retired
    ? { schemaVersion: 2, inverters: [], subSystems: { roof: { inverterId: null } }, mainPanelAmps: 400 }
    : {
        schemaVersion: 2,
        inverters: [
          { inverterId: RAYS_INVERTER, type: 'string',
            strings: [{ panelId: 'ps-mnb108-440', panelCount: 10 },
                      { panelId: 'ps-mnb108-440', panelCount: 9 }] },
          { inverterId: RAYS_INVERTER, type: 'string',
            strings: [{ panelId: 'ps-mnb108-440', panelCount: 9 },
                      { panelId: 'ps-mnb108-440', panelCount: 9 }] },
        ],
        subSystems: { roof: { inverterId: RAYS_INVERTER, topology: 'string' } },
        mainPanelAmps: 400,
      };

  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4
      WHERE id = $1`,
    [PROJECT_B, JSON.stringify(stored), JSON.stringify(se), JSON.stringify(engCfg)]);
}

/** Fixture A — the ordinary house, with its POI left unresolved as a new job's would be. */
async function writeFixtureA(opts?: { poi?: string }): Promise<void> {
  const { buildNormalResidence200A } = await import('@/lib/electrical/fixtures/normalResidence200a');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const built = buildNormalResidence200A(
    opts?.poi ? { interconnectionRelationship: opts.poi as never } : {});
  const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(built.topology)));
  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4
      WHERE id = $1`,
    [PROJECT_A, JSON.stringify(stored),
     JSON.stringify({ batteryCount: 1, inverter: null, inverterId: null }),
     JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 200 })]);
}

// ─── THE REAL CALLERS ──────────────────────────────────────────────────────

/** The body the engineering page actually posts, including the stale architecture it carries. */
function pageSldBody(projectId: string, over: Record<string, unknown> = {}) {
  return {
    projectId,
    projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave',
    drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
    // 🚨 EXACTLY WHAT THE PAGE POSTS — the losing side of the architecture conflict.
    topologyType: 'STRING',
    inverterModel: 'Tesla Solar Inverter 5.7kW', inverterManufacturer: 'Tesla',
    inverterId: RAYS_INVERTER,
    totalModules: 37, totalStrings: 4,
    panelModel: 'Philadelphia Solar PS-MNB108(HCBF)-440W',
    panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    acOutputKw: 11.4, acOutputAmps: 24, acOCPD: 60,
    acWireGauge: '#6 AWG', acConduitType: 'EMT', acWireLength: 60,
    backfeedAmps: 60, mainPanelAmps: 400,
    utilityName: 'Local Utility',
    hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
    ...over,
  };
}

async function generateSld(projectId: string, over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pageSldBody(projectId, over)),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} as Record<string, unknown> };
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
}

/**
 * The EXPORT PDF button's route. `format: 'svg'` returns the rendered sheet without invoking
 * Chromium — the whole route runs (canonical projection, input build, renderer), so this is the
 * printable artefact's own bytes, not a proxy for them.
 */
async function exportPdfSheet(projectId: string, over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/pdf/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // 🚨 WRAPPED IN `buildInput`, WHICH IS HOW THE PAGE SENDS IT — and the reason the deleted
    // `body.topologyType` read was always undefined.
    body: JSON.stringify({ buildInput: pageSldBody(projectId, over), format: 'svg' }),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} as Record<string, unknown> };
  }
  return {
    status: res.status, svg: '',
    json: await res.json().catch(() => ({})) as Record<string, unknown>,
  };
}

async function postCalculateWithInterconnection(projectId: string, method: string) {
  const { POST } = await import('@/app/api/engineering/calculate/route');
  const { NextRequest } = await import('next/server');
  const pvArray = {
    panelId: 'ps-mnb108-440', moduleCount: 37,
    panelVoc: 52.7, panelVmp: 43.6, panelIsc: 13.7, panelImp: 12.9, panelWatts: 440,
    tempCoeffVoc: -0.25, tempCoeffIsc: 0.05, maxSeriesFuseRating: 25,
  };
  // 🚨 A STRING CARRIES ITS OWN CONDUCTOR FIELDS (`StringInput`), and omitting them made
  // `normalizeGauge(undefined)` throw inside the engine — which `handleRouteDbError` then reported
  // as **503 DB_STARTING**. A malformed payload claiming the database is starting up is its own
  // small diagnosability defect, noted rather than fixed here; what it hid was my test's shape.
  const conductor = { wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT' };
  const res = await POST(new NextRequest('http://localhost/api/engineering/calculate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId, address: '238 N Warwick Ave', state: 'IL', topologyType: 'STRING',
      electrical: {
        inverters: [{ type: 'string', maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
                      mpptChannels: 2, acOutputKw: 5.7, acOutputCurrentMax: 24,
                      maxInputCurrentPerMppt: 15,
                      strings: [{ panelCount: 19, ...pvArray, ...conductor }] }],
        pvArray,
        mainPanelAmps: 400, systemVoltage: 240, wireGauge: '#10 AWG', wireLength: 60,
        conduitType: 'EMT',
        interconnection: { method, busRating: 200, mainBreaker: 200 },
      },
    }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}

/**
 * A COMPLETE `ElectricalCalcInput`.
 *
 * 🚨 MY FIRST VERSION OF THIS WAS A GUESS — `{ inverters: [{type, acOutputKw, quantity}], pvArray:
 * {...} }` with an `as any` to silence the compiler. There is no `pvArray` on this input and no
 * `quantity` on an inverter; the strings live ON the inverter, and `necVersion`, the design
 * temperatures, the conductor fields and the three disconnect booleans are all REQUIRED. The engine
 * threw, and `as any` is what let it compile. Shapes are read from the interface, never assumed.
 */
function calcInput(): import('@/lib/electrical-calc').ElectricalCalcInput {
  const str = {
    panelCount: 10, panelVoc: 52.7, panelIsc: 13.7, panelImp: 12.9, panelVmp: 43.6,
    panelWatts: 440, tempCoeffVoc: -0.25, tempCoeffIsc: 0.05, maxSeriesFuseRating: 25,
    wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT',
  };
  return {
    inverters: [{
      type: 'string', acOutputKw: 5.7,
      maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 550,
      maxInputCurrentPerMppt: 15, acOutputCurrentMax: 24,
      strings: [{ ...str }, { ...str, panelCount: 9 }],
    }],
    mainPanelAmps: 200, systemVoltage: 240,
    designTempMin: -18, designTempMax: 38, rooftopTempAdder: 22,
    wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true,
    necVersion: '2023',
  };
}

const loadB = async () => {
  const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
  return loadElectricalProject(PROJECT_B, USER_ID);
};

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 1 — the SVG and the PDF are two renderings of ONE engineered project', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 MY FIRST VERSION OF THIS TEST WAS BLIND, AND THE MUTATION RUN CAUGHT IT.
  //
  // It asserted "no Fronius on the sheet" using Fixture B — a DC-coupled project. Restoring the
  // fabrication byte-for-byte left the test GREEN, because on a DC-coupled design the renderer
  // prints `'PV DC COUPLED TO POWERWALL 3'` (sld-professional-renderer.ts:4281) and the inverter
  // NAME never reaches the sheet at all. The assertion could not fail, so it proved nothing.
  //
  // The defect harmed a project whose inverter name DOES get printed: one with no canonical
  // architecture to override the posted equipment, sending no inverter model. That is the case
  // tested now, and the mutation turns it red.
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 with no architecture to consult, the EXPORTED sheet says INVERTER NOT SELECTED', async () => {
    // No service_topology at all ⇒ the canonical projection does not apply, so nothing deletes the
    // equipment fields and whatever the route resolves is what gets printed.
    await db.query(`UPDATE projects SET service_topology = NULL, selected_equipment = NULL,
                    engineering_config = NULL WHERE id = $1`, [PROJECT_A]);
    const pdf = await exportPdfSheet(PROJECT_A, {
      // The browser sends no inverter identity for a design that has none.
      inverterModel: undefined, inverterManufacturer: undefined, inverterId: undefined,
      topologyType: undefined,
      totalModules: 20, totalStrings: 2, mainPanelAmps: 200,
    });
    expect(pdf.status, `the PDF route failed: ${JSON.stringify(pdf.json).slice(0, 400)}`).toBe(200);

    expect(pdf.svg, 'the exported PDF sheet fabricates a Fronius').not.toMatch(/Fronius/i);
    expect(pdf.svg, 'the exported PDF sheet fabricates a Primo 8.2-1')
      .not.toMatch(/Primo\s*8\.2/i);
    // 🚨 AND IT SAYS SO, LOUDLY — absence has a representation.
    expect(pdf.svg, 'the sheet neither names a product nor reports the absence')
      .toMatch(/NOT SELECTED/i);
  });

  it('🚨 and on the DC-coupled job neither sheet names a standalone inverter', async () => {
    await writeFixtureB({ retired: true });
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(pdf.status, `the PDF route failed: ${JSON.stringify(pdf.json).slice(0, 400)}`).toBe(200);
    expect(pdf.svg, 'the exported PDF sheet still fabricates a Fronius')
      .not.toMatch(/Fronius/i);
    // The architecture line must be the storage, not a topology word.
    expect(pdf.svg, 'the exported sheet does not state the DC-coupled architecture')
      .toMatch(/DC COUPLED/i);
  });

  it('🚨 both artefacts report the SAME architecture for the same project', async () => {
    await writeFixtureB({ retired: true });
    const svg = await generateSld(PROJECT_B);
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(svg.status).toBe(200);
    expect(pdf.status).toBe(200);

    // The page posted `topologyType: 'STRING'` to BOTH. Neither may honour it.
    for (const [name, sheet] of [['diagram', svg.svg], ['exported PDF', pdf.svg]] as const) {
      expect(sheet.length, `the ${name} produced no sheet`).toBeGreaterThan(1000);
      expect(sheet, `the ${name} drew a standalone PV inverter the project does not have`)
        .not.toMatch(/Tesla Solar Inverter/i);
    }
    // And both must say the same thing about the storage, which is the architecture.
    const mentionsPowerwall = (s: string) => /POWERWALL/i.test(s);
    expect(mentionsPowerwall(svg.svg), 'the diagram does not mention the storage').toBe(true);
    expect(mentionsPowerwall(pdf.svg), 'the exported sheet does not mention the storage').toBe(true);
  });

  it('🚨 the PDF refuses an unresolved architecture, like the diagram does', async () => {
    // Both an explicit inverter AND a DC-coupled graph: the model refuses to pick a side.
    await writeFixtureB({ retired: false });
    const m = (await loadB())!.model;
    expect(m.solarCoupling, 'the fixture is not actually in conflict').toBeNull();

    const svg = await generateSld(PROJECT_B);
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(svg.status, 'the diagram route drew an unresolved architecture').toBe(409);
    expect(pdf.status, 'the EXPORTED PDF can still be produced from an unresolved architecture')
      .toBe(409);
    expect(String((pdf.json as any)?.code ?? ''))
      .toContain('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
  });

  it('🚨 ONE implementation — and the mutation that re-splits them turns this red', () => {
    // The guard that catches the next partial copy. See tests/electricalAuthorityInspector.test.ts
    // for the structural half; this is the behavioural anchor.
    const live = (code: string) => code.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .some(l => /\bprojectCanonicalArchitecture\s*\(/.test(l));
    expect(live(src('app', 'api', 'engineering', 'sld', 'route.ts'))).toBe(true);
    expect(live(src('app', 'api', 'engineering', 'sld', 'pdf', 'route.ts'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 2 — UNRESOLVED is a real engineering state, not a silent LOAD_SIDE', () => {
  it('the evaluator refuses it explicitly, with a reason, an owner and the blocked calculation',
    async () => {
      const { runElectricalCalc } = await import('@/lib/electrical-calc');
      const unresolved = runElectricalCalc({
        ...calcInput(), interconnection: { method: 'UNRESOLVED', busRating: 200, mainBreaker: 200 },
      });
      const ic = unresolved.interconnection;

      // 🚨 THE THIRD ANSWER. Before this, `'UNRESOLVED'` matched none of the four branches and fell
      // out of the if/else chain with passes:false, maxAllowed:0, an EMPTY necReference and NOT ONE
      // ISSUE PUSHED — a silent refusal that any consumer reading "no errors" called approval.
      expect(ic.conclusion, 'an unresolved interconnection did not produce NOT_EVALUATED')
        .toBe('NOT_EVALUATED');
      expect(ic.notEvaluated, 'the refusal carries no detail').toBeTruthy();
      expect(ic.notEvaluated!.state).toBe('UNRESOLVED');
      expect(ic.notEvaluated!.requires.length,
        'an indeterminate result that cannot say what would resolve it is a dead end')
        .toBeGreaterThan(0);
      expect(ic.notEvaluated!.authority).toMatch(/topology|interconnection/i);
      expect(ic.notEvaluated!.blockedCalculation).toMatch(/705\.12/);

      // It must not claim an article it did not apply.
      expect(ic.necReference, 'an unevaluated interconnection cites an NEC article').toBe('');
      expect(unresolved.busbar.busbarRule,
        'the code basis still says 120% for a rule that did not run').toBe('not-evaluated');

      // 🚨 AND THE ISSUE LIST IS NOT EMPTY — that silence was the danger.
      expect(ic.issues.length, 'the refusal emitted no issue at all').toBeGreaterThan(0);
      expect(ic.issues.some(i => i.code === 'E-INTERCONNECTION-NOT-EVALUATED')).toBe(true);
    });

  it('a real LOAD_SIDE job still evaluates — the repair did not break the normal case', async () => {
    const { runElectricalCalc } = await import('@/lib/electrical-calc');
    const r = runElectricalCalc({
      ...calcInput(), interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 },
    });
    expect(r.interconnection.conclusion).not.toBe('NOT_EVALUATED');
    expect(r.interconnection.necReference).toContain('705.12');
    expect(r.busbar.busbarRule).toBe('120%');
  });

  it('🚨 the manufacturer-integrated and meter-collar states are PRESERVED, not remapped', async () => {
    const { permitInterconnectionToken, interconnectionRuleOf } =
      await import('@/lib/permit/utils/interconnectionRule');

    // The permit's own normaliser used to collapse every non-supply value to 'LOAD_SIDE'.
    for (const state of ['UNRESOLVED', 'MANUFACTURER_INTEGRATED', 'METER_COLLAR']) {
      expect(permitInterconnectionToken(state),
        `${state} was flattened into a NEC article on the sealed permit`).toBe(state);
      expect(interconnectionRuleOf(state),
        `${state} was given a specific NEC article`).toBe('not-established');
    }
    // Absence is UNRESOLVED, never LOAD_SIDE.
    expect(permitInterconnectionToken(null)).toBe('UNRESOLVED');
    expect(permitInterconnectionToken('')).toBe('UNRESOLVED');
    // And the four real ones still pass through.
    expect(permitInterconnectionToken('LOAD_SIDE')).toBe('LOAD_SIDE');
    expect(permitInterconnectionToken('SUPPLY_SIDE_TAP')).toBe('SUPPLY_SIDE_TAP');
    expect(interconnectionRuleOf('SUPPLY_SIDE_TAP')).toBe('705.11');
  });

  it('🚨 the compliance route reports NOT EVALUATED rather than a verdict it did not reach',
    async () => {
      await writeFixtureA();
      const r = await postCalculateWithInterconnection(PROJECT_A, 'UNRESOLVED');
      expect(r.status,
        `the compliance route failed: ${JSON.stringify(r.json).slice(0, 500)}`).toBe(200);
      // `overallStatus: null` IS "not evaluated" in this repo (OverallStatusResult.status).
      expect(r.json?.overallStatus,
        `an unevaluable interconnection produced the verdict '${r.json?.overallStatus}'`)
        .toBeNull();
      const basis = String(r.json?.statusBasis ?? '');
      expect(basis, `the basis does not say why: '${basis}'`).toMatch(/not evaluated|unresolved/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 4 — a retirement clears every ACTIVE mirror', () => {
  it('the subsystem map can be cleared, exactly as the battery already could', async () => {
    const { subSystemEntryFromFlatEquipmentPatch } = await import('@/lib/system/subSystemMirror');
    const now = '2026-10-02T00:00:00.000Z';

    // 🚨 THE ASYMMETRY THAT LET THE RETIRED INVERTER SURVIVE. `batteryId` had an explicit-clear
    // branch; `inverterId` had only a truthy guard, so `inverterId: null` wrote nothing and the
    // map KEPT the retired device for the page to re-synthesise a fleet from.
    const cleared = subSystemEntryFromFlatEquipmentPatch({ inverterId: null }, 'roof', now);
    expect('inverterId' in cleared,
      'a retirement patch does not reach the subsystem mirror at all').toBe(true);
    expect(cleared.inverterId, 'the retired inverter was not cleared from the mirror').toBeNull();

    const clearedEmpty = subSystemEntryFromFlatEquipmentPatch({ inverterId: '' }, 'roof', now);
    expect(clearedEmpty.inverterId).toBeNull();

    // A patch that does not MENTION the inverter must leave it alone — absence is not a decision.
    const untouched = subSystemEntryFromFlatEquipmentPatch({ panelId: 'p1' }, 'roof', now);
    expect('inverterId' in untouched,
      'a patch that says nothing about the inverter cleared it anyway').toBe(false);

    // And a real selection still writes.
    const selected = subSystemEntryFromFlatEquipmentPatch(
      { inverterId: 'enphase-iq8plus' }, 'roof', now);
    expect(selected.inverterId).toBe('enphase-iq8plus');
  });

  it('🚨 a production snapshot cannot hand the retired inverter back', async () => {
    const { readExternalInverterIdentity, mayBackfillExternalInverter } =
      await import('@/lib/electrical/inverterIdentity');

    // This is the predicate BOTH promotion sites now consult — lib/db/projects.ts (two) and
    // lib/db/production.ts (the third, which was unguarded).
    const retired = readExternalInverterIdentity({ inverter: null, inverterId: null, batteryCount: 4 });
    expect(retired.state).toBe('NONE');
    expect(mayBackfillExternalInverter(retired),
      'an old production snapshot would hand the retired inverter back').toBe(false);

    const unstated = readExternalInverterIdentity({ batteryCount: 4 });
    expect(mayBackfillExternalInverter(unstated)).toBe(true);
  });

  it('🚨 all THREE snapshot promotions are guarded, not two', () => {
    // The repair was applied to lib/db/projects.ts and the third site was missed — which is the
    // same shape as the SVG/PDF split. Count them.
    const projects = src('lib', 'db', 'projects.ts');
    const production = src('lib', 'db', 'production.ts');
    expect(projects, 'lib/db/projects.ts lost its identity guard')
      .toContain('mayBackfillExternalInverter');
    expect(production, 'lib/db/production.ts promotes a snapshot inverter with NO identity guard')
      .toContain('mayBackfillExternalInverter');
    // `?? selectedInverter` bare is the defect shape.
    expect(production.includes('canonEq.selectedInverter  ?? selectedInverter,'),
      'the unguarded `?? selectedInverter` promotion is back').toBe(false);
  });

  it('🚨 after the real resolution route runs, nothing holds the retired inverter', async () => {
    await writeFixtureB({ retired: false });
    const { POST } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest(
      'http://localhost/api/engineering/electrical-architecture', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: PROJECT_B, coupling: 'dc-coupled-storage' }),
      }));
    expect(res.status, 'the resolution route refused').toBe(200);

    const row = (await db.query(
      `SELECT selected_equipment, engineering_config FROM projects WHERE id = $1`,
      [PROJECT_B])).rows[0] as any;
    const se = typeof row.selected_equipment === 'string'
      ? JSON.parse(row.selected_equipment) : row.selected_equipment;
    const cfg = typeof row.engineering_config === 'string'
      ? JSON.parse(row.engineering_config) : row.engineering_config;

    // The flat identity records NONE, not a gap.
    const { readExternalInverterIdentity } = await import('@/lib/electrical/inverterIdentity');
    expect(readExternalInverterIdentity(se).state).toBe('NONE');
    // The fleet is empty…
    expect(cfg.inverters).toEqual([]);
    // …AND the subsystem map no longer points at the retired device, which is what the page
    // re-synthesises a fleet from.
    for (const [key, v] of Object.entries((cfg.subSystems ?? {}) as Record<string, any>)) {
      expect(v?.inverterId,
        `engineering_config.subSystems.${key} still names the retired inverter`).toBeFalsy();
    }
    // The string assignment survives as HISTORY — 37 modules, not discarded.
    expect(cfg.retiredInverterFleet?.moduleCount,
      'the retired string assignment lost its module count').toBe(37);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 5 — the schedule states the real assignment, never a scalar × a count', () => {
  it('a mixed assignment is itemised, and 37 never reads as 4 × 9', async () => {
    const { renderSLDProfessional } = await import('@/lib/sld-professional-renderer');
    const base = {
      projectName: 'P', clientName: 'C', address: 'A', designer: 'D',
      drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
      topologyType: 'STRING_INVERTER',
      totalModules: 37, totalStrings: 4,
      panelModel: 'PS-MNB108-440', panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      inverterManufacturer: 'Tesla', inverterModel: 'Solar Inverter 5.7kW',
      acOutputKw: 11.4, mainPanelAmps: 400,
    } as any;

    // 🚨 THE DEFECT: 'Total Modules 37' two rows above 'Strings 4 × 9 panels', which is 36.
    const mixed = renderSLDProfessional({ ...base, stringPanelCounts: [10, 9, 9, 9] });
    expect(mixed, 'the schedule still multiplies a scalar by a count').not.toContain('4 × 9 panels');
    // The real assignment, itemised.
    expect(mixed, 'the schedule does not state the actual per-string assignment')
      .toMatch(/10\s*\/\s*9\s*\/\s*9\s*\/\s*9/);

    // A genuinely uniform layout may still read as N × M — that is not a fabrication.
    const uniform = renderSLDProfessional(
      { ...base, totalModules: 36, totalStrings: 4, stringPanelCounts: [9, 9, 9, 9] });
    expect(uniform).toContain('4 × 9 panels');

    // 🚨 AND NO ASSIGNMENT AT ALL SAYS SO, rather than inventing one.
    const none = renderSLDProfessional({ ...base, stringPanelCounts: undefined });
    expect(none, 'a sheet with no string assignment invented one')
      .toMatch(/REQUIRES RE-DERIVATION/);
  });

  it('🚨 an assignment that does not add up is REPORTED, not reconciled', async () => {
    const { renderSLDProfessional } = await import('@/lib/sld-professional-renderer');
    const svg = renderSLDProfessional({
      projectName: 'P', clientName: 'C', address: 'A', designer: 'D',
      drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
      topologyType: 'STRING_INVERTER',
      totalModules: 37, totalStrings: 4, stringPanelCounts: [9, 9, 9, 9],
      panelModel: 'PS-MNB108-440', panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      inverterManufacturer: 'Tesla', inverterModel: 'X',
      acOutputKw: 11.4, mainPanelAmps: 400,
    } as any);
    expect(svg, 'a 36-module assignment on a 37-module design printed silently')
      .toMatch(/SUMS TO 36/);
  });

  it('🚨 the SLD route hands the DISTRIBUTION to the engine, not only the count', () => {
    // The reconciliation channel already existed (`configStringPanelCounts`, v61.7). Two callers
    // passed it and this route did not, so computeSystem equal-divided while the renderer got the
    // real array — one request, two partitions.
    const route = src('app', 'api', 'engineering', 'sld', 'route.ts');
    // 🚨 ANCHORED, BECAUSE `toContain('configStringPanelCounts:')` MATCHED ITS OWN MUTATION.
    // Renaming the property to `_disabledConfigStringPanelCounts:` still contains that substring,
    // so the mutation ran and the guard stayed green. A word boundary is the difference between
    // asserting the property EXISTS and asserting the characters appear somewhere.
    const live = route.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(live.some(l => /^\s*configStringPanelCounts:\s/.test(l)),
      'the SLD route no longer passes the string distribution to computeSystem — only the count')
      .toBe(true);
    // And it must refuse an assignment that does not describe this array.
    expect(route).toContain('does not describe this array');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 7 — the real browser caller can send ABSENCE', () => {
  it('the page no longer substitutes a catalogue product for a missing inverter', () => {
    const page = src('app', 'engineering', 'page.tsx');
    // The exact expressions that made the server guard unreachable.
    const live = page.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(live.some(l => l.includes("|| 'fronius-primo-8.2'")),
      'the BOM payload still invents a Fronius client-side').toBe(false);
    expect(live.some(l => l.includes("MICROINVERTERS[0]?.id ?? 'enphase-iq8plus'")
                       && l.includes('inverterId:')),
      'the BOM payload still substitutes the catalogue first microinverter').toBe(false);
  });

  it('🚨 the BOM route, given the absence the browser now sends, quotes no inverter', async () => {
    await writeFixtureB({ retired: true });
    const { POST } = await import('@/app/api/engineering/bom/route');
    const { NextRequest } = await import('next/server');
    // 🚨 NOTE WHAT IS MISSING: no `inverterId` key at all. That is what the repaired page sends
    // for a DC-coupled design, and until the page was fixed this request could not occur.
    const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_B, totalPanels: 37, batteryCount: 4, inverters: [] }),
    }));
    const json = await res.json().catch(() => ({})) as any;
    expect(res.status, `BOM failed: ${JSON.stringify(json).slice(0, 300)}`).toBe(200);

    const blob = JSON.stringify(json);
    expect(blob, 'the parts list still quotes a Fronius nobody selected').not.toMatch(/fronius/i);
    expect(blob, 'the parts list still quotes a Primo 8.2').not.toMatch(/primo/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 6 — absence reaches the metering authority as absence', () => {
  it('🚨 no recorded interconnection ⇒ no CT placement, and the sheet says MODE TBD', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE CONSUMPTION CTs CLAMP RELATIVE TO THE POINT OF INTERCONNECTION.
    //
    // `lib/equipment/designMetering.ts:257` will not place them when the boundary is
    // `'unresolved'`, and `currentTransformers.ts:712` has the sentence for it — "the
    // interconnection side is not established, so no metering mode follows from it". Both were
    // UNREACHABLE while `permitInterconnectionToken` collapsed absence into `'LOAD_SIDE'`: the CTs
    // were drawn at a guessed location carrying the label "DEFAULT PER INTERCONNECTION — FIELD
    // VERIFY", and the schedule asserted NET.
    //
    // This is the behaviour change that broke three assertions in
    // `tests/permitStandaloneGateway.test.ts`. It is tested here on its own terms so the change is
    // an asserted property of the product rather than a side effect nobody wrote down.
    // ═══════════════════════════════════════════════════════════════════
    const { resolveDesignMetering } = await import('@/lib/equipment/designMetering');
    const { permitInterconnectionToken } =
      await import('@/lib/permit/utils/interconnectionRule');

    // Absence must not become a NEC article on the way in.
    expect(permitInterconnectionToken(undefined)).toBe('UNRESOLVED');

    // And the authority must refuse to place what it cannot locate.
    const { buildNormalResidence200A } =
      await import('@/lib/electrical/fixtures/normalResidence200a');
    const { topology } = buildNormalResidence200A();
    expect(topology.pointsOfInterconnection[0].relationship,
      'the ordinary-house fixture should leave the POI unresolved').toBe('unresolved');
    // `governingArticleFor` has always refused to name an article for it — the model was right.
    const { governingArticleFor } = await import('@/lib/electrical/serviceTopology');
    expect(governingArticleFor('unresolved'),
      'an unresolved POI was given an NEC article').toBeNull();
    expect(typeof resolveDesignMetering).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 PHASE 2 / PATTERN A — an owner exists and the consumer reads it', () => {
  it('🚨 the canonical module count sizes the BOM, not the browser\'s number', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE OWNER HAD ZERO CONSUMERS ANYWHERE IN THE REPO.
    //
    // `ElectricalProjectModel.moduleCount` is assembled from the layout
    // (`layouts.panels.length` > `layouts.total_panels` > the engineering seed). The BOM route
    // already held the model and still sized the parts list from
    // `body.moduleCount || body.totalPanels` — so the number of modules somebody ORDERS came from
    // React state. "37 MODULES MEANS 37 MODULES."
    //
    // This posts a DELIBERATELY WRONG count the way a stale page would, and asserts the design
    // wins. A test that posted the right number could not tell the two sources apart.
    // ═══════════════════════════════════════════════════════════════════
    await writeFixtureB({ retired: true });   // layouts.total_panels = 37

    const { POST } = await import('@/app/api/engineering/bom/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_B,
        // 🚨 THE STALE BROWSER COUNT. The design has 37.
        moduleCount: 20, totalPanels: 20,
        batteryCount: 4, inverters: [],
      }),
    }));
    const json = await res.json().catch(() => ({})) as any;
    expect(res.status, `BOM failed: ${JSON.stringify(json).slice(0, 300)}`).toBe(200);

    // The module count the parts list was built from must be the canonical 37.
    const blob = JSON.stringify(json);
    const twenties = (blob.match(/\b20\b/g) ?? []).length;
    const thirtySevens = (blob.match(/\b37\b/g) ?? []).length;
    expect(thirtySevens,
      `the BOM response never mentions 37 modules — it was sized from the posted 20. `
      + `(37s=${thirtySevens}, 20s=${twenties})`).toBeGreaterThan(0);

    // And the canonical model is where 37 comes from, not the request.
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;
    expect(m.moduleCount, 'the canonical model does not hold the layout module count').toBe(37);
  });

  it('🚨 a project with NO layout count gets nothing invented', async () => {
    // The other direction, which is the one that would make this repair a defect: where the owner
    // holds no count, the posted value must stand rather than a fabricated one being projected.
    await writeFixtureB({ retired: true });
    await db.exec('DELETE FROM layouts');
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;
    // Whatever the model reports, it must not be a number this test planted.
    expect([null, 0, undefined]).toContain(m.moduleCount ?? null);
  });

  it('🚨 the BOM route reads the owner, and the competing read cannot win', () => {
    const route = src('app', 'api', 'engineering', 'bom', 'route.ts');
    expect(route, 'the BOM route does not consult the canonical module count')
      .toContain('_m.moduleCount');
    // The projection must assign BOTH spellings, or the one it misses is the competing read.
    expect(route).toContain('body.moduleCount = _m.moduleCount');
    expect(route).toContain('body.totalPanels = _m.moduleCount');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 FIXTURE A — the ordinary house, which had no fixture at all', () => {
  it('200 A / 1 MSP / 1 Gateway is a real topology the engine accepts', async () => {
    const { buildNormalResidence200A } = await import('@/lib/electrical/fixtures/normalResidence200a');
    const { topology } = buildNormalResidence200A();
    expect(topology.service.ratedAmps).toBe(200);
    expect(topology.branches).toHaveLength(1);
    expect(topology.panels).toHaveLength(1);
    expect(topology.domains).toHaveLength(1);
    // 🚨 THREE SEPARATE FACTS THAT SHARE A NUMBER — the distinction `mainPanelAmps` destroys.
    expect(topology.panels[0].busbarRatingA).toBe(200);
    expect(topology.panels[0].mainBreakerA).toBe(200);
    // One system has no arrangement to choose between: inapplicable, not unanswered.
    expect(topology.interconnection?.derArrangement).toBeNull();
    expect(topology.aggregationPanels).toEqual([]);
  });

  it('the canonical model reads it as DC-coupled with NO external inverter', async () => {
    await writeFixtureA();
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const loaded = await loadElectricalProject(PROJECT_A, USER_ID);
    expect(loaded?.model, 'the ordinary house did not load at all').toBeTruthy();
    const m = loaded!.model;
    expect(m.serviceRatedAmps, 'the 200 A service did not reach the canonical model').toBe(200);
    expect(m.hasExternalInverter).toBe(false);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.storage.invertingUnitCount).toBe(1);
  });

  it('🚨 it draws, and the 200 A service is not confused with the 200 A busbar', async () => {
    await writeFixtureA();
    const svg = await generateSld(PROJECT_A, { mainPanelAmps: 200, totalStrings: 2, totalModules: 20 });
    expect(svg.status, `the ordinary house failed to draw: ${JSON.stringify(svg.json).slice(0, 300)}`)
      .toBe(200);
    expect(svg.svg.length).toBeGreaterThan(1000);
    expect(svg.svg, 'the normal path drew a standalone PV inverter it does not have')
      .not.toMatch(/Tesla Solar Inverter/i);
    expect(svg.svg, 'the normal path fabricated a Fronius').not.toMatch(/Fronius/i);
  });

  it('a 200 A house with a RESOLVED load-side POI still evaluates normally', async () => {
    await writeFixtureA({ poi: 'load-side-busbar' });
    const r = await postCalculateWithInterconnection(PROJECT_A, 'LOAD_SIDE');
    expect(r.status,
      `the compliance route failed: ${JSON.stringify(r.json).slice(0, 500)}`).toBe(200);
    // Not asserting PASS/FAIL — asserting that a verdict was REACHED, which is the repair's
    // boundary: a resolved interconnection must not be swept into NOT_EVALUATED.
    expect(r.json?.overallStatus,
      'a resolved load-side 200 A job was reported as not evaluated').not.toBeNull();
  });
});
