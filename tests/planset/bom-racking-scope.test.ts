// ============================================================
// BOM racking scope — hybrid roof-subset scaling, single racking
// system, rail-less RT-MINI suppression, NONE-conduit junk filter
// tests/planset/bom-racking-scope.test.ts
//
// Evidence (Stowell hybrid CSV, 51 roof + 26 ground + 17 fence):
//   • ONE roof billed TWO racking brands: RT-MINI lot + pads ×96 AND
//     IronRidge L-Foot ×96 + XR100 rails + UFO clamps. Mechanism: the
//     'rooftech-mini' registry entry's own requiredAccessories default to
//     IronRidge rail hardware — in a hybrid payload those generic rail
//     formulas must not bill alongside the flashed pads.
//   • Per-module/per-string accessory formulas used PROJECT totals (WEEB ×94,
//     UFO mid (94−strings)×2) instead of the 51-module roof subset.
//   • '"N/A" NONE Conduit — NONE-N-A — 58 ft' billed $43.50 from the open-air
//     BRANCH_RUN (conduitType 'NONE').
// Legacy single-system payloads (no subSystemCounts) stay byte-identical —
// locked by the pre-change snapshot in the last describe block.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { generateBOMV4 } from '../../lib/bom-engine-v4';

// ── Route dependency mocks (auth / rate limit / DB are not under test) ──
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

async function postBom(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const req = new Request('http://solarpro.test/api/engineering/bom', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as any);
  const json = await res.json();
  return { status: res.status, json };
}

type AnyItem = {
  stageId: string; category: string; manufacturer: string; model: string;
  partNumber?: string; quantity: number; unit: string;
};
const structuralOf = (json: any): AnyItem[] =>
  (json.bom?.items ?? []).filter((i: AnyItem) => i.stageId === 'structural');
const structBy = (json: any, category: string, partNumber: string): AnyItem | undefined =>
  structuralOf(json).find(i => i.category === category && i.partNumber === partNumber);

// Stowell-shaped hybrid payload: winning systemType 'fence', 94 modules total,
// 51 on the roof. design_electrical carries a stale/conflicting rackingId.
const hybridBody = (overrides: Record<string, unknown> = {}) => ({
  systemType: 'fence',
  inverterId: 'fronius-primo-8.2',      // string inverter, NO integrated RSD
  panelId: 'rec-alpha-pure-r-405',
  moduleCount: 94,
  stringCount: 4,
  inverterCount: 1,
  systemKw: 38.1,
  mainPanelAmps: 200,
  acOCPD: 40,
  backfeedAmps: 40,
  attachmentCount: 0,
  railSections: 0,
  subSystemCounts: { roof: 51, ground: 26, fence: 17 },
  ...overrides,
});

describe('(a) hybrid + RT-MINI roof authority — ONE racking system, roof-subset quantities', () => {
  // RAY RULING (2026-07-11): "RT Mini gets a rail. We personally pair with
  // IronRidge. The added L-foot has many different pairings." The IronRidge
  // rail set on the rooftech-mini registry entry is the intended default
  // PAIRING — it must EMIT, scaled to the roof subset (the original CSV
  // defect was the 94-module project-wide scaling, not the pairing itself).
  it('emits RT-MINI pads + the paired IronRidge rail set, all scaled to the 51-module roof subset', async () => {
    const { status, json } = await postBom(hybridBody({
      rackingId: 'ironridge-xr100',     // conflicting design_electrical id — must LOSE as the PRIMARY
      roofData: { attachmentCount: 96, railSections: 8, mountingSystemId: 'rooftech-mini', panelCount: 51 },
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);

    const struct = structuralOf(json);

    // Exactly ONE roof racking system lot: the resolved primary (roofData wins).
    const lots = struct.filter(i => i.category === 'racking');
    expect(lots).toHaveLength(1);
    expect(lots[0].manufacturer).toBe('Roof Tech');
    // 2026-08-29 - the BOM names the product that SHIPS. `rooftech-mini` is
    // superseded by RT-MINI II (mounting-hardware-db, which every structural
    // fact already followed), so the equipment-registry row's gen-1 name and
    // its gen-1 part number no longer describe this mount. Roof Tech publishes
    // no gen-2 part number we hold, and TBD is this engine's token for that.
    expect(lots[0].partNumber).toBe('TBD');

    // RT-MINI's own hardware: pads per attachment, 2 lags per pad.
    expect(structBy(json, 'attachment', 'RT-MINI-ASSY')?.quantity).toBe(96);
    expect(structBy(json, 'lag_bolt', 'LAG-516-3-SS')?.quantity).toBe(192);

    // The paired rail set EMITS, scaled to the ROOF SUBSET (51), never the
    // project total (94): mid clamps (51−rows)×2 basis, not (94−2)×2=184.
    const mid = structBy(json, 'mid_clamp', 'UFO-MID-01');
    expect(mid).toBeDefined();
    expect(mid!.quantity).toBeLessThan(184);
    expect(mid!.quantity).toBeGreaterThan(0);
    expect(structBy(json, 'rail', 'XR-100-168B')).toBeDefined();
    expect(structBy(json, 'l_foot', 'LFT-001-B')?.quantity).toBe(96);

    // Grounding lugs are per-ROOF-module: 51, not the project total 94.
    expect(structBy(json, 'grounding', 'WEEB-LUG-6.7')?.quantity).toBe(51);

    // Sanity: roof subset still drives NEC 690.12 RSD.
    const rsd = (json.bom?.items ?? []).find((i: AnyItem) => i.partNumber === '481-00252-32');
    expect(rsd?.quantity).toBe(51);
  });
});

describe('(b) hybrid + rail-based roof system — rails/clamps scale to the roof subset', () => {
  it('IronRidge XR100: mid clamps use the 51-module basis, rails/ends use pro-rated roof rows, no RT-MINI', async () => {
    const { status, json } = await postBom(hybridBody({
      rackingId: 'rooftech-mini',       // stale conflicting id — must LOSE to roofData
      roofData: { attachmentCount: 96, railSections: 8, mountingSystemId: 'ironridge-xr100', panelCount: 51 },
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);

    const struct = structuralOf(json);

    // Exactly ONE roof racking system, and it is the rail-based XR100.
    const lots = struct.filter(i => i.category === 'racking');
    expect(lots).toHaveLength(1);
    expect(lots[0].manufacturer).toBe('IronRidge');

    // No RT-MINI hardware.
    expect(struct.some(i => i.partNumber === 'RT-MINI-ASSY')).toBe(false);
    expect(struct.some(i => i.partNumber === 'RT-MINI-01')).toBe(false);

    // Roof-subset scaling. Project: 94 modules / 4 strings → 23.5 modules/row.
    // Roof subset: 51 modules → rows = ceil(51 / 23.5) = 3.
    //   mid clamps = (51 − 3) × 2 = 96   (NOT (94 − 4) × 2 = 180)
    //   rails      = 3 × 2 = 6           (NOT 4 × 2 = 8)
    //   end clamps = 3 × 4 = 12          (NOT 16)
    expect(structBy(json, 'mid_clamp', 'UFO-MID-01')?.quantity).toBe(96);
    expect(structBy(json, 'rail', 'XR-100-168B')?.quantity).toBe(6);
    expect(structBy(json, 'end_clamp', 'UFO-END-01')?.quantity).toBe(12);
    // Per-attachment lines use the roofData attachment count directly.
    expect(structBy(json, 'attachment', 'LFT-001-B')?.quantity).toBe(96);
  });
});

describe('(c) open-air runs (conduitType NONE) never bill conduit or fittings', () => {
  const baseInput: any = {
    inverterId: 'fronius-primo-8.2', panelId: 'rec-alpha-pure-r-405', moduleCount: 20,
    stringCount: 2, inverterCount: 1, systemKw: 8.1, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 10, railSections: 4, mainPanelAmps: 200, backfeedAmps: 40, acOCPD: 40, dcOCPD: 20,
    systemType: 'roof', rackingId: 'ironridge-xr100', interconnectionMethod: 'LOAD_SIDE',
    panelBusRating: 200, includeTruckStock: false, includeSuggestedTools: false,
  };
  const emtRun: any = {
    id: 'INV_TO_DISCO_RUN', label: 'INVERTER → AC DISCO', from: 'INVERTER', to: 'AC DISCONNECT',
    conductorCount: 3, wireGauge: '#8 AWG', egcGauge: '#10 AWG', onewayLengthFt: 40,
    conduitType: 'EMT', conduitSize: '3/4"',
  };
  const openAirRun: any = {
    id: 'BRANCH_RUN', label: 'BRANCH RUN (AC Trunk)', from: 'MICROINVERTERS', to: 'AC COMBINER',
    conductorCount: 2, wireGauge: '#10 AWG', egcGauge: '#10 AWG', onewayLengthFt: 50,
    conduitType: 'NONE', conduitSize: 'N/A', isOpenAir: true,
  };

  it('emits no NONE/N-A conduit line item and excludes open-air footage from the per-raceway conduit + fittings', () => {
    const bom = generateBOMV4({ ...baseInput, runs: [emtRun, openAirRun] });

    // No junk conduit line ('"N/A" NONE Conduit — NONE-N-A'), and no "all runs".
    const conduits = bom.items.filter(i => i.category === 'conduit');
    expect(conduits.some(i => i.partNumber.startsWith('NONE'))).toBe(false);
    expect(conduits.some(i => i.model.includes('NONE'))).toBe(false);
    expect(conduits.every(i => !/—\s*all runs/i.test(i.description ?? ''))).toBe(true);

    // §6 — the real EMT run bills ONE per-physical-raceway AC conduit row (its
    // own physicalRacewayId), 40 ft × 1.15 = 46 ft; the open-air run adds NO
    // conduit. (A separate DC home-run conduit line exists on the string DC
    // stage — that is pre-existing and cites the PV wiring-method article.)
    const acConduits = conduits.filter(i => i.stageId === 'ac');
    expect(acConduits.length).toBe(1);
    const acConduit = acConduits[0];
    expect(acConduit.quantity).toBe(46);
    expect(acConduit.description).toMatch(/RW-INV_TO_DISCO_RUN/);
    expect(acConduit.necReference).toMatch(/NEC 358/); // §7 — EMT article

    // §6 — fittings derive from the 46-ft EMT raceway ONLY (open-air excluded):
    //   connectors = 2 (both ends), couplings = ceil(46/10)-1 = 4,
    //   straps = ceil(46/10)+1 = 6, bushings = 2, 90° sweep allowance = 2.
    const fitting = (pnPrefix: string) =>
      bom.items.find(i => i.category === 'conduit_fitting' && i.partNumber.startsWith(pnPrefix));
    expect(fitting('EMT-CONN')?.quantity).toBe(2);
    expect(fitting('EMT-COUP')?.quantity).toBe(4);
    expect(fitting('EMT-STRAP')?.quantity).toBe(6);
    expect(fitting('BUSH-INS')?.quantity).toBe(2);
    // every fitting cites the EMT support article (§7) — never a template 352
    for (const f of bom.items.filter(i => i.category === 'conduit_fitting'
        && /EMT/.test(i.model))) expect(f.necReference).not.toMatch(/352/);

    // §5 — the open-air Q-Cable trunk is NEVER billed as THWN field conductor
    // (it is trunk cable). The old model double-billed it as #10 THWN alongside
    // the trunk drops; the reconciliation now records it as an open-air segment.
    expect(bom.branchWireReconciliation?.openAirTrunkSegments).toContain('BRANCH_RUN');
    const openAirThwn = bom.items.find(i =>
      i.category === 'wire' && (i.description ?? '').includes('BRANCH_RUN'));
    expect(openAirThwn).toBeUndefined();
    // the in-conduit EMT run's own conductors DO bill (hot #8 + shared EGC #10).
    expect(bom.items.some(i => i.category === 'wire' && i.model.startsWith('#8 AWG THWN-2'))).toBe(true);
  });
});

describe('(d) legacy single-system BOMs (no subSystemCounts) are byte-identical', () => {
  // Snapshot of Stage-5 racking/grounding lines captured from the engine
  // BEFORE this change (2026-07-11, dev HEAD) — locks legacy behavior,
  // including the historical RT-MINI rail-based output.
  const RACK_CATS = new Set(['racking', 'attachment', 'flashing', 'rail', 'splice',
    'mid_clamp', 'end_clamp', 'l_foot', 'lag_bolt', 'mount_hardware', 'grounding']);

  const legacyInput = (rackingId: string): any => ({
    inverterId: 'fronius-primo-8.2', panelId: 'rec-alpha-pure-r-405', moduleCount: 20,
    stringCount: 2, inverterCount: 1, systemKw: 8.1, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
    attachmentCount: 10, railSections: 4, mainPanelAmps: 200, backfeedAmps: 40, acOCPD: 40, dcOCPD: 20,
    systemType: 'roof', interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
    includeTruckStock: false, includeSuggestedTools: false, rackingId,
  });

  const lines = (rackingId: string) =>
    generateBOMV4(legacyInput(rackingId)).items
      .filter(i => i.stageId === 'structural' && RACK_CATS.has(i.category))
      .map(i => `${i.category}|${i.manufacturer}|${i.model}|${i.partNumber}|${i.quantity}|${i.unit}`);

  it('ironridge-xr100 legacy racking lines match the pre-change snapshot', () => {
    expect(lines('ironridge-xr100')).toEqual([
      'racking|IronRidge|XR100 Rail System|XR-100-168B|1|lot',
      'attachment|IronRidge|L-Foot with Lag Bolt|LFT-001-B|10|ea',
      'flashing|QuickMount PV|Classic Mount Flashing|QM-CLASSIC-1|10|ea',
      'rail|IronRidge|XR100 Rail 168"|XR-100-168B|4|ea',
      'mid_clamp|IronRidge|UFO Mid Clamp|UFO-MID-01|36|ea',
      'end_clamp|IronRidge|UFO End Clamp|UFO-END-01|8|ea',
      'splice|IronRidge|XR100 Splice|XR-100-SPLICE|4|ea',
      // §7 (07-22): the auto ground rod + acorn clamp are REMOVED — a grid-tied
      // interconnection bonds to the existing GES (NEC 250.64 / 690.47), it does
      // not add a new electrode unless input.requiresGroundingElectrode is set.
    ]);
  });

  it('rooftech-mini legacy racking lines match the pre-change snapshot (rail lines INTACT)', () => {
    expect(lines('rooftech-mini')).toEqual([
      'racking|Roof Tech|RT-MINI II|TBD|1|lot',
      'attachment|Roof Tech|RT-MINI Pad Assembly|RT-MINI-ASSY|10|ea',
      'lag_bolt|Generic|5/16" × 3" Lag Bolt SS|LAG-516-3-SS|20|ea',
      'l_foot|IronRidge|L-Foot Universal|LFT-001-B|10|ea',
      'rail|IronRidge|XR100 Rail 168"|XR-100-168B|4|ea',
      'mid_clamp|IronRidge|UFO Mid Clamp|UFO-MID-01|36|ea',
      'end_clamp|IronRidge|UFO End Clamp|UFO-END-01|8|ea',
      'grounding|Wiley Electronics|WEEB Lug 6.7|WEEB-LUG-6.7|20|ea',
      // §7 (07-22): auto ground rod + acorn clamp REMOVED (bonds to existing GES;
      // no new electrode unless requiresGroundingElectrode). Module bonding
      // (WEEB Lug) stays — it is frame-to-rail bonding, not an electrode.
    ]);
  });
});
