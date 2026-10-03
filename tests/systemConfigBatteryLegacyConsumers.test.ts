// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BATTERY CARD'S CONTROLLER NEVER REACHES THE LEGACY BUI CONSUMERS.
//
// `config.backupInterfaceId` is the legacy BACKUP-INTERFACE UNIT. The page sends it to computeSystem
// (BUI_TO_MSP_RUN "BUI/CONTROLLER TO MSP" sized at the unit's continuous output, a BUI-1 schedule
// row), to the BOM (a "Backup Interface Unit" line, plus that run as wire through `runs`) and to the
// SLD request. A battery that needs a gateway already names it on the legacy schedule (GW-n), and
// the service graph's gateways reach the BOM from the graph.
//
// The review's probe on Ray's job (4 × Powerwall 3, 2 × Backup Gateway 3): the first graph write
// from ANY card mirrored the graph's gateway into backupInterfaceId, and computeSystem then drew a
// 3 × #4/0 feeder on a 250 A breaker into an MSP backfeed lug that does not exist on site, and put
// the same Gateway 3 on the schedule twice (GW-1 and BUI-1). These cases run the installer's flow —
// card controller pick, graph writes (the mirror), Battery OFF — and hand the engines exactly what
// the page derives from the resulting config.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { generateBOMV4, type BOMGenerationInputV4 } from '@/lib/bom-engine-v4';
import { getBackupInterfaceById, getBatteryById } from '@/lib/equipment-db';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import {
  batteryConfigMirror, batteryOffPatch, type BatterySelection,
} from '@/lib/electrical/systemConfigBatteryCard';
import { csStringInput, bomStringInput } from './goldens/wave0-fixtures';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';

type Cfg = BatterySelection & { atsId: string };

/**
 * What the page derives for the engines from `config` — the computeSystem input
 * (page.tsx `backupInterfaceMaxA` / `backupInterfaceId` / brand / model, POI subsystem) and the BOM
 * body (`backupInterfaceId: config.backupInterfaceId || undefined`, `backupInterfaceMaxA`). The
 * source guard at the end pins those page lines, so this mirror of them cannot drift silently.
 */
function pageBuiInputs(cfg: Cfg) {
  const ats = cfg.atsId.toLowerCase();
  const viaAts = ats.includes('enphase-iq-sc3') || ats.includes('enphase-iq-system-controller');
  const resolved = cfg.backupInterfaceId || (viaAts ? 'enphase-iq-system-controller-3' : '');
  const bi = resolved ? getBackupInterfaceById(resolved) : undefined;
  const named = cfg.backupInterfaceId ? getBackupInterfaceById(cfg.backupInterfaceId) : undefined;
  return {
    compute: {
      backupInterfaceMaxA: bi?.maxContinuousOutputA ?? undefined,
      backupInterfaceId: resolved || undefined,
      backupInterfaceBrand: named?.manufacturer ?? undefined,
      backupInterfaceModel: named?.model ?? undefined,
    },
    bom: {
      backupInterfaceId: cfg.backupInterfaceId || undefined,
      backupInterfaceMaxA: named?.maxContinuousOutputA ?? undefined,
    },
  };
}

function engines(cfg: Cfg) {
  const bui = pageBuiInputs(cfg);
  const bat = cfg.batteryId ? getBatteryById(cfg.batteryId) : undefined;
  const cs = computeSystem({
    ...csStringInput(),
    batteryIds: cfg.batteryId ? [cfg.batteryId] : [],
    batteryCount: cfg.batteryCount || undefined,
    batteryContinuousOutputA: bat?.maxContinuousOutputA ?? undefined,
    ...bui.compute,
  } as ComputedSystemInput);
  const bom = generateBOMV4({
    ...bomStringInput(),
    batteryId: cfg.batteryId || undefined,
    batteryCount: cfg.batteryCount,
    ...bui.bom,
  } as BOMGenerationInputV4);
  return {
    buiRun: cs.runs.find(r => r.id === 'BUI_TO_MSP_RUN'),
    tags: cs.equipmentSchedule.map(r => r.tag),
    buiLines: bom.items.filter(i => i.category === 'backup_interface'),
  };
}

const start = (): Cfg => ({
  batteryId: PW3, batteryCount: 4, batteryKwh: 13.5, batteryBrand: 'Tesla', batteryModel: 'Powerwall 3',
  backupControllerId: '', backupInterfaceId: '', atsId: '',
});

describe('control: what the legacy consumers do with a backupInterfaceId on a Powerwall 3 / Gateway 3 job', () => {
  it('a 250 A BUI → MSP feeder, Gateway 3 on the schedule twice, and a Backup Interface Unit BOM line', () => {
    // This is what the pre-fix mirror produced — the cases below go red if any path writes it again.
    const e = engines({ ...start(), backupInterfaceId: GW3 });
    expect(e.buiRun?.ocpdAmps).toBe(250);
    expect(e.buiRun?.to).toBe('MAIN SERVICE PANEL');
    expect(e.tags).toEqual(expect.arrayContaining(['GW-1', 'BUI-1']));
    expect(e.buiLines).toHaveLength(1);
  });
});

describe('🚨 [blocking] the installer\'s flow never hands the engines a BUI', () => {
  it('Ray\'s job: controller chosen in the card, then graph writes — no BUI feeder, one gateway row, no BUI line', () => {
    // The card's pre-graph controller pick (BatteryStorageCard → onSelectionChange) …
    let cfg: Cfg = { ...start(), backupControllerId: GW3 };
    // … then two graph writes from any card on Ray's job, each followed by the page's mirror.
    const rays = buildRaysIntendedJob().topology;
    for (let i = 0; i < 2; i++) cfg = { ...cfg, ...batteryConfigMirror(rays, cfg, { batteryEnabled: true }) };
    expect(cfg.backupInterfaceId, 'the graph\'s gateway was mirrored into the legacy BUI field').toBe('');
    expect(cfg.backupControllerId).toBe(GW3);
    expect(cfg.batteryCount).toBe(4);

    const e = engines(cfg);
    expect(e.buiRun, 'a BUI → MSP feeder that does not exist on site').toBeUndefined();
    expect(e.tags.filter(t => t === 'GW-1' || t === 'BUI-1'), 'the same gateway twice on the schedule').toEqual(['GW-1']);
    expect(e.buiLines, 'a Backup Interface Unit priced on the BOM').toHaveLength(0);
  });

  it('[should-fix] Battery OFF after picking a controller: nothing of the battery or its controller reaches the engines', () => {
    // Even a project carrying the legacy field from an earlier recording is cleared by OFF.
    const cfg: Cfg = { ...start(), backupControllerId: GW3, backupInterfaceId: GW3, ...batteryOffPatch() };
    const e = engines(cfg);
    expect(e.buiRun).toBeUndefined();
    expect(e.tags).not.toContain('BUI-1');
    expect(e.tags).not.toContain('GW-1');
    expect(e.buiLines).toHaveLength(0);
  });
});

describe('the page lines this test mirrors', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');

  it('the engines still read the legacy field — and only the legacy field', () => {
    // computeSystem input
    expect(page).toContain("const _resolvedBuiId = config.backupInterfaceId || (_isIQSC3viaATS ? 'enphase-iq-system-controller-3' : '');");
    expect(page).toContain("return config.backupInterfaceId || (_isIQSC3viaATS ? 'enphase-iq-system-controller-3' : undefined);");
    // BOM body
    expect(page).toContain('backupInterfaceId:    config.backupInterfaceId || undefined,');
    expect(page).toMatch(/backupInterfaceMaxA: config\.backupInterfaceId \? \(\(\) => \{ const b = getBackupInterfaceById\(config\.backupInterfaceId\)/);
    // No consumer reads the card's controller.
    expect(page).not.toMatch(/backupInterfaceId:\s*config\.backupControllerId/);
  });
});
