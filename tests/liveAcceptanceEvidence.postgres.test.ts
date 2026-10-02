// ═══════════════════════════════════════════════════════════════════════════
// 🚨 RULE EIGHTEEN — THE ACTUAL APPLICATION OUTPUT, BEFORE AND AFTER THE RESOLUTION.
//
// Ray: "I do not want: 362 tests green, route passes, helper correct, canonicalizer correct, while
// the browser still shows Tesla Solar Inverter 5.7kW / STRING INVERTER. Your next meaningful
// completion report must include the actual current application output after the legacy-resolution
// action. If you cannot access Ray's database, use the byte-for-byte PostgreSQL fixture to drive the
// real production handlers, but status remains: NEEDS RAY — LIVE ACCEPTANCE until Ray sees it."
//
// So this file is not a guard. It PRINTS what the production handlers return for the row Ray's
// project is actually in — the badge text, the state dump, the sheet's own words — before the click
// and after it, to `_live-acceptance-evidence.txt`. Every value comes from a real handler; nothing
// here is composed for the report.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const RAYS_INVERTER = 'tesla-solar-inverter-5p7k';
let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') return (await pg.query(strings, (values[0] as unknown[]) ?? [])).rows;
    let text = ''; const params: unknown[] = [];
    strings.forEach((s, i) => { text += s; if (i < values.length) { params.push(values[i]); text += `$${params.length}`; } });
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
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`);
  await db.exec(`ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`);
  await Promise.all([
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/electrical-architecture/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/electrical/stateDump'),
  ]);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address)
     VALUES ($1,$2,'Hussey Ethos','lead','roof','238 N Warwick Ave')`, [PROJECT, USER_ID]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,37)`, [PROJECT, USER_ID]);
});

/** Ray's row: the coupling SolarPro's own canonicalization wrote, plus the fleet it derived it from. */
async function writeRaysRow(): Promise<void> {
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology))) as
    { schemaVersion: number; topology: Record<string, unknown> };
  stored.topology.solarCoupling = 'ac-coupled-inverter';
  stored.schemaVersion = 3;
  for (const u of (stored.topology.storage as Array<Record<string, unknown>>) ?? []) {
    delete u.pvInputLimits; delete u.pvDcStcKw; delete u.outputConfigKw;
    if (u.role === 'inverter-unit') u.ocpdA = 50;
  }
  await db.query(
    `UPDATE projects SET service_topology=$2, selected_equipment=$3, engineering_config=$4
      WHERE id=$1`,
    [PROJECT,
     JSON.stringify(stored),
     JSON.stringify({ batteryCount: 4,
       inverter: { id: RAYS_INVERTER, type: 'string', manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW' },
       inverterId: RAYS_INVERTER }),
     JSON.stringify({ schemaVersion: 2, mainPanelAmps: 400, inverters: [
       { inverterId: RAYS_INVERTER, type: 'string', strings: [
         { panelId: 'ps-mnb108-440', panelCount: 10 }, { panelId: 'ps-mnb108-440', panelCount: 9 }] },
       { inverterId: RAYS_INVERTER, type: 'string', strings: [
         { panelId: 'ps-mnb108-440', panelCount: 9 }, { panelId: 'ps-mnb108-440', panelCount: 9 }] },
     ] })]);
}

async function generateSld(): Promise<{ status: number; svg: string; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT, format: 'json',
      projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave',
      drawingDate: '2026-07-29', drawingNumber: 'SLD-001', revision: 'A',
      // 🚨 EXACTLY WHAT RAY'S PAGE POSTED.
      topologyType: 'STRING', inverterModel: 'Tesla Solar Inverter 5.7kW',
      inverterManufacturer: 'Tesla', inverterId: RAYS_INVERTER,
      totalModules: 37, totalStrings: 4,
      panelModel: 'Philadelphia Solar PS-MNB108(HCBF)-440W',
      panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      acOutputKw: 11.4, acOutputAmps: 24, acOCPD: 60, mainPanelAmps: 400,
      utilityName: 'Local Utility', interconnection: 'SUPPLY_SIDE_TAP',
      hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
    }),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} };
  }
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
}

const sheetSays = (svg: string) => {
  const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const find = (re: RegExp) => texts.filter(t => re.test(t));
  return {
    architectureWords: find(/STRING INVERTER|DC COUPLED|MICROINVERTER|ARCHITECTURE/i),
    anyTeslaInverter: find(/Solar Inverter 5\.7|Tesla Solar Inverter/i),
    anyFronius: find(/Fronius|Primo/i),
    arrayLine: find(/STRING.*MODULES|ACCOUNTS FOR/i),
    acDisconnect: find(/AC DISCONNECT|DC Disconnect/i),
  };
};

describe('🚨 LIVE ACCEPTANCE EVIDENCE — real handlers, Ray’s row', () => {
  it('prints the application output before and after the one click', async () => {
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const { electricalStateDump } = await import('@/lib/electrical/stateDump');
    const { topologyBadge } = await import('@/lib/electrical/architectureLabel');
    const { POST: RESOLVE } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');

    const out: string[] = [];
    const section = (t: string) => out.push('', '═'.repeat(78), t, '═'.repeat(78));

    // ── BEFORE ────────────────────────────────────────────────────────────
    await writeRaysRow();
    const before = (await loadElectricalProject(PROJECT, USER_ID))!;
    const beforeDump = (await electricalStateDump(PROJECT, USER_ID))!;
    const beforeBadge = topologyBadge({
      architectureResolutionRequired: before.model.architectureResolutionRequired,
      solarCoupling: before.model.solarCoupling, isHybrid: false, firstInverterType: 'string',
    });
    const beforeSld = await generateSld();

    section('BEFORE — the row Ray’s project is in');
    out.push(`Engineering Intelligence badge : ${beforeBadge.label}`);
    out.push(`architecture.coupling          : ${beforeDump.architecture.coupling}`);
    out.push(`architecture.provenanceSource  : ${beforeDump.architecture.provenanceSource}`);
    out.push(`resolutionRequired             : ${beforeDump.architecture.resolutionRequired}`);
    out.push(`pv.externalInverter            : ${beforeDump.pv.externalInverter}`);
    out.push(`pv.externalInverterOrigin      : ${beforeDump.pv.externalInverterOrigin}`);
    out.push(`pv.modules                     : ${beforeDump.pv.modules}`);
    out.push(`storage                        : ${beforeDump.storage.invertingUnits} inverting, `
      + `${beforeDump.storage.gateways} gateways, ${beforeDump.storage.usableKwh} kWh`);
    out.push(`topology.serviceRatedAmps      : ${beforeDump.topology.serviceRatedAmps}`);
    out.push(`conflicts                      : `
      + (beforeDump.conflicts.map(c => c.code).join(', ') || 'none'));
    out.push('mirrorsThatCouldWin:');
    for (const r of beforeDump.mirrorsThatCouldWin) out.push(`  - ${r.field} = ${r.value}`);
    out.push(`GENERATE SLD                   : HTTP ${beforeSld.status} `
      + `${beforeSld.json.code ?? ''}`);
    out.push(`  error                        : ${beforeSld.json.error ?? '(none)'}`);
    const choices = (beforeSld.json.choices ?? []) as Array<{ label: string }>;
    for (const c of choices) out.push(`  choice                       : ${c.label}`);

    // ── THE CLICK ─────────────────────────────────────────────────────────
    const resolved = await RESOLVE(
      new NextRequest('http://localhost/api/engineering/electrical-architecture', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: PROJECT, coupling: 'dc-coupled-storage' }),
      }));
    const rj = await resolved.json() as Record<string, unknown>;
    section('THE ONE CLICK — "PV connects directly to the batteries"');
    out.push(`HTTP ${resolved.status}`);
    out.push(`summary                        : ${rj.summary}`);
    out.push(`retiredExternalInverter        : ${rj.retiredExternalInverter}`);
    out.push(`clearedFleetEntries            : ${rj.clearedFleetEntries}`);
    out.push(`resolutionRequired (read back) : ${rj.resolutionRequired}`);

    // ── AFTER ─────────────────────────────────────────────────────────────
    const after = (await loadElectricalProject(PROJECT, USER_ID))!;
    const afterDump = (await electricalStateDump(PROJECT, USER_ID))!;
    const afterBadge = topologyBadge({
      architectureResolutionRequired: after.model.architectureResolutionRequired,
      solarCoupling: after.model.solarCoupling, isHybrid: false, firstInverterType: null,
    });
    const afterSld = await generateSld();
    const says = sheetSays(afterSld.svg);

    section('AFTER — reloaded from the database, nothing patched in memory');
    out.push(`Engineering Intelligence badge : ${afterBadge.label}`);
    out.push(`architecture.coupling          : ${afterDump.architecture.coupling}`);
    out.push(`architecture.provenanceSource  : ${afterDump.architecture.provenanceSource}`);
    out.push(`resolutionRequired             : ${afterDump.architecture.resolutionRequired}`);
    out.push(`pv.externalInverter            : ${afterDump.pv.externalInverter}`);
    out.push(`pv.modules                     : ${afterDump.pv.modules}`);
    out.push(`storage                        : ${afterDump.storage.invertingUnits} inverting, `
      + `${afterDump.storage.gateways} gateways`);
    out.push(`topology.generationPanels      : ${afterDump.topology.generationPanels}`);
    out.push(`conflicts                      : `
      + (afterDump.conflicts.map(c => c.code).join(', ') || 'none'));
    out.push(`mirrorsThatCouldWin            : `
      + (afterDump.mirrorsThatCouldWin.map(r => r.field).join(', ') || '[] — EMPTY'));

    section('AFTER — the sheet the real route returned (posting STRING + a Tesla inverter)');
    out.push(`GENERATE SLD                   : HTTP ${afterSld.status}`);
    const arch = afterSld.json.architecture as Record<string, unknown> | undefined;
    out.push(`architecture.resolved          : ${arch?.resolved}`);
    out.push(`architecture.source            : ${arch?.source}`);
    out.push(`topologyType posted / used     : ${arch?.topologyTypePosted} / ${arch?.topologyTypeUsed}`);
    out.push(`overrodeRequestBody            : ${arch?.overrodeRequestBody}`);
    out.push(`architecture words on sheet    : ${says.architectureWords.join(' | ') || '(none)'}`);
    out.push(`Tesla Solar Inverter on sheet  : ${says.anyTeslaInverter.join(' | ') || '(none)'}`);
    out.push(`Fronius / Primo on sheet       : ${says.anyFronius.join(' | ') || '(none)'}`);
    out.push(`array line                     : ${says.arrayLine.join(' | ') || '(none)'}`);
    out.push(`disconnect rows                : ${says.acDisconnect.join(' | ') || '(none)'}`);

    writeFileSync(join(ROOT, '_live-acceptance-evidence.txt'), out.join('\n') + '\n');

    // Assertions, so this file is evidence AND a guard.
    expect(beforeSld.status).toBe(409);
    expect(afterSld.status).toBe(200);
    expect(afterBadge.label).toBe('PV DC COUPLED TO STORAGE');
    expect(afterDump.pv.externalInverter).toBe('NONE');
    expect(afterDump.pv.modules).toBe(37);
    expect(afterDump.mirrorsThatCouldWin).toEqual([]);
    expect(says.anyTeslaInverter).toEqual([]);
    expect(says.anyFronius).toEqual([]);
  });
});
