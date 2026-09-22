// ═══════════════════════════════════════════════════════════════════════════
// THE COMBINER SELECTION MUST SURVIVE THE WHOLE CHAIN.
//
// "The combiner selection worked on the SLD surface but did not successfully
//  propagate through everything else."
//
// The selection authority already existed and was already correct:
//   lib/combinerSelection/service.ts  records it (actor, basis, supersession)
//   lib/equipment/integratedBos.ts    honours it above every recommendation
// What did NOT exist was the plumbing between them and the artefacts a permit
// package is made of. Each `describe` below is one LINK in that chain, and each
// one was measured broken before it was repaired:
//
//   System Config selection
//     -> permit resolver     (buildIntegratedEquipment ignored it)
//     -> planset sheets      (E-1 / SCHED / PV-6 / directory named a guess)
//     -> permit BOM          (bomForPermit never forwarded it)
//     -> engineering BOM API (the route never read it off the body)
//     -> hybrid AC collection(resolveHybridAcCollection had no such input)
//     -> hybrid SLD + PDF    (the multi-lane branch returns before the
//                             single-lane combiner resolution ever runs)
//
// WHY THE 4C IS THE PROBE DEVICE. The fixture is an Enphase IQ8M micro job.
// equipment-db pairs IQ8 with the 5C, so the "recommended" answer is the 5C;
// the resolver's last-resort literal is the 6C. The 4C is NEITHER. A sheet that
// says "IQ Combiner 4C" can only have got there by honouring the selection —
// no fallback, no pairing and no default can produce it. Asserting on the 5C or
// the 6C would pass vacuously on some path.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../test-fixtures/roofProject';

import {
  resolveIntegratedEquipment,
  resolveHybridAcCollection,
} from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { generatePermitHTML } from '@/lib/permit';
import {
  acCollectionFromLanes,
  renderSLDProfessional,
  type SLDSourceBranch,
  type SLDProfessionalInput,
} from '@/lib/sld-professional-renderer';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import { buildPermitDesignSnapshot } from '@/lib/permit/snapshot/build';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';

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

/** The installer's answer. Neither the IQ8 pairing (5C) nor the fallback (6C). */
const SELECTED = 'enphase-iq-combiner-4c';
const SELECTED_MODEL = 'IQ Combiner 4C';
const SELECTED_SKU = 'X-IQ-AM1-240-4C';
/** What the pairing recommends for this fixture, i.e. the WRONG answer here. */
const RECOMMENDED_MODEL = 'IQ Combiner 5C';

const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;

/** A deep clone of the fixture, optionally carrying the project's selection. */
function fixture(selectedCombinerId?: string) {
  const p = JSON.parse(JSON.stringify(roofProject));
  if (selectedCombinerId) p.project.selectedCombinerId = selectedCombinerId;
  return p;
}

// ════════════════════════════════════════════════════════════════════
// LINK 0 — the control. The selection is NOT what this fixture would
// otherwise resolve, so every assertion below is a real discriminator.
// ════════════════════════════════════════════════════════════════════
describe('control — the probe device is not reachable by any default', () => {
  it('the IQ8M pairing recommends the 5C, so an unselected project names the 5C', () => {
    const plan = buildIntegratedEquipment(fixture(), cad);
    expect(plan.brains?.model).toBe(RECOMMENDED_MODEL);
    expect(plan.combinerBasis).toBe('declared-compatibility');
    expect(plan.brains?.model).not.toBe(SELECTED_MODEL);
  });

  it('no fallback in the resolver can produce the 4C on its own', () => {
    // No pairing at all → the last-resort literal. Still not the 4C.
    const bare = resolveIntegratedEquipment({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', isMicro: true,
      totalDevices: 12, branchCount: 3, hasBattery: false,
    });
    expect(bare.brains?.model).toBe('IQ Combiner 6C');
    expect(bare.brains?.model).not.toBe(SELECTED_MODEL);
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 1 — the permit-side resolver. ONE adapter feeds E-1, SCHED, PV-6,
// PV-0, APP-A, PV-4A, the snapshot and the BOM reconcile. It read
// `project.combinerId` (session workspace) and never the recorded selection.
// ════════════════════════════════════════════════════════════════════
describe('link 1 — buildIntegratedEquipment honours the project selection', () => {
  it('resolves the SELECTED device, not the recommended one', () => {
    const plan = buildIntegratedEquipment(fixture(SELECTED), cad);
    expect(plan.brains?.model).toBe(SELECTED_MODEL);
    expect(plan.brains?.partNumber).toBe(SELECTED_SKU);
  });

  it('reports the basis as project-selected, so a sheet may assert it unqualified', () => {
    expect(buildIntegratedEquipment(fixture(SELECTED), cad).combinerBasis).toBe('project-selected');
  });

  it('the recorded selection OUTRANKS a stale session override (config.combinerId)', () => {
    // The SLD tab's old toolbar wrote `combinerId` into engineering_config. It
    // must not be able to beat the project's recorded answer — otherwise the
    // SLD still owns a separate override, which is the defect being closed.
    const p = fixture(SELECTED);
    p.project.combinerId = 'enphase-iq-combiner-6c';
    const plan = buildIntegratedEquipment(p, cad);
    expect(plan.brains?.model).toBe(SELECTED_MODEL);
    expect(plan.combinerBasis).toBe('project-selected');
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 2 — the rendered planset. This is the artefact that reaches the AHJ.
// ════════════════════════════════════════════════════════════════════
describe('link 2 — the rendered planset names the selected combiner', () => {
  it('the selected device appears and the recommended one does not', () => {
    const html = generatePermitHTML(fixture(SELECTED));
    expect(html).toContain(SELECTED_MODEL);
    expect(html).not.toContain(RECOMMENDED_MODEL);
    expect(html).not.toContain('IQ Combiner 6C');
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 3 — the permit BOM. bomForPermit builds the V4 input and never put
// the selection in it, so generateBOMV4's per-sub hybrid path (the one the
// 5b reconcile deliberately does NOT overwrite) shipped a different device.
// ════════════════════════════════════════════════════════════════════
describe('link 3 — the permit BOM orders the selected combiner', () => {
  it('the combiner line is the SELECTED device with its real SKU', () => {
    const bom = generateBOMForPermit(fixture(SELECTED), cad);
    const combiners = bom.filter(i => i.category === 'combiner' || i.category === 'gateway');
    expect(combiners.length, 'the BOM must carry a combiner line').toBeGreaterThan(0);
    const models = combiners.map(i => `${i.manufacturer ?? ''} ${i.model ?? ''}`.trim());
    expect(models.join(' | ')).toContain(SELECTED_MODEL);
    expect(models.join(' | ')).not.toContain(RECOMMENDED_MODEL);
    expect(combiners.some(i => i.partNumber === SELECTED_SKU)).toBe(true);
  });

  it('bomForPermit forwards the selection into the V4 engine input', async () => {
    // The 5b reconcile can mask an unforwarded selection on a single-system
    // job, because it rewrites the combiner line from buildIntegratedEquipment
    // afterwards. On the per-sub hybrid path it does NOT rewrite it, so the
    // engine input itself has to carry the selection. Assert the CONTRACT.
    const seen: Array<Record<string, unknown>> = [];
    const real = await vi.importActual<typeof import('@/lib/bom-engine-v4')>('@/lib/bom-engine-v4');
    vi.doMock('@/lib/bom-engine-v4', () => ({
      ...real,
      generateBOMV4: (input: Record<string, unknown>) => { seen.push(input); return real.generateBOMV4(input as never); },
    }));
    vi.resetModules();
    const { generateBOMForPermit: gen } = await import('@/lib/permit/utils/bomForPermit');
    gen(fixture(SELECTED), cad);
    vi.doUnmock('@/lib/bom-engine-v4');
    vi.resetModules();
    expect(seen.length, 'generateBOMV4 must have been called').toBeGreaterThan(0);
    expect(seen[0].selectedCombinerId).toBe(SELECTED);
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 4 — the engineering BOM API. bom-engine-v4 already READ
// `input.selectedCombinerId` at two call sites; no production caller set it.
// ════════════════════════════════════════════════════════════════════
describe('link 4 — /api/engineering/bom forwards the selection', () => {
  async function postBom(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/engineering/bom/route');
    const req = new Request('http://solarpro.test/api/engineering/bom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req as never);
    return { status: res.status, json: await res.json() };
  }

  const microBody = (over: Record<string, unknown> = {}) => ({
    inverterId: 'enphase-iq8plus',
    panelId: 'qcells-peak-duo-400',
    moduleCount: 12,
    deviceCount: 12,
    stringCount: 0,
    inverterCount: 12,
    systemKw: 5.16,
    topologyType: 'MICROINVERTER',
    systemType: 'roof',
    ...over,
  });

  it('a selected combiner reaches the generated BOM', async () => {
    const { status, json } = await postBom(microBody({ selectedCombinerId: SELECTED }));
    expect(status).toBe(200);
    const items = (json.bom?.items ?? []) as Array<{ model?: string; partNumber?: string; category?: string }>;
    expect(items.length, 'the route must return a BOM').toBeGreaterThan(0);
    expect(items.some(i => i.model === SELECTED_MODEL)).toBe(true);
    expect(items.some(i => i.model === RECOMMENDED_MODEL)).toBe(false);
  });

  it('with NO selection the route still resolves the recommended device (no regression)', async () => {
    const { status, json } = await postBom(microBody());
    expect(status).toBe(200);
    const items = (json.bom?.items ?? []) as Array<{ model?: string }>;
    expect(items.some(i => i.model === RECOMMENDED_MODEL)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 5 — the hybrid AC collection. E-1's multi-lane drawing AND the permit
// BOM's shared-panel block both read resolveHybridAcCollection, which had no
// way to be told what the installer selected.
// ════════════════════════════════════════════════════════════════════
describe('link 5 — the hybrid AC collection honours the selection', () => {
  const sources = [
    {
      key: 'roof', inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
      isMicro: true, branchCount: 3, deviceCount: 12, backfeedA: 40,
      compatibleCombinerIds: combinerCompatibilityFor('Enphase', 'IQ8M'),
    },
    {
      key: 'ground', inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H',
      isMicro: false, branchCount: 2, deviceCount: 0, backfeedA: 40,
    },
  ];

  it('without a selection the micro lane names the paired device (control)', () => {
    const plan = resolveHybridAcCollection(sources);
    expect(plan.perSource.find(s => s.key === 'roof')?.combiner?.model).toBe(RECOMMENDED_MODEL);
  });

  it('a per-source selection names the SELECTED device on the micro lane', () => {
    const plan = resolveHybridAcCollection(
      sources.map(s => ({ ...s, selectedCombinerId: s.isMicro ? SELECTED : null })),
    );
    expect(plan.perSource.find(s => s.key === 'roof')?.combiner?.model).toBe(SELECTED_MODEL);
    // The string lane still has no combiner — a selection must not invent one.
    expect(plan.perSource.find(s => s.key === 'ground')?.combiner).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 6 — the hybrid SLD. `acCollectionFromLanes` is the ONE lanes ->
// HybridSourceInput mapping site, and the multi-lane renderer draws what it
// returns. The selection has to reach it.
// ════════════════════════════════════════════════════════════════════
describe('link 6 — the multi-lane SLD draws the selected combiner', () => {
  // `topologyType` is what laneTopology() reads; without it a lane is STRING and
  // resolveHybridAcCollection gives it no combiner at all. The control test
  // below is what caught that in the fixture.
  const lanes: SLDSourceBranch[] = [
    {
      key: 'roof', topologyType: 'MICROINVERTER',
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
      totalModules: 12, deviceCount: 12, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
      acOutputKw: 3.84, acOutputAmps: 16, backfeedAmps: 20, acOCPD: 20,
      microBranches: [{ ocpdAmps: 20, branchCurrentA: 12.8, deviceCount: 12 }],
    } as unknown as SLDSourceBranch,
    {
      key: 'ground', topologyType: 'STRING_INVERTER',
      inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H',
      totalModules: 20, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9, totalStrings: 2,
      acOutputKw: 7.6, acOutputAmps: 32, backfeedAmps: 40, acOCPD: 40,
    } as unknown as SLDSourceBranch,
  ];

  it('acCollectionFromLanes accepts the project selection and applies it', () => {
    const withSel = acCollectionFromLanes(lanes, SELECTED);
    expect(withSel.perSource.find(s => s.key === 'roof')?.combiner?.model).toBe(SELECTED_MODEL);
    // Control: the same lanes with no selection name the paired device.
    const without = acCollectionFromLanes(lanes);
    expect(without.perSource.find(s => s.key === 'roof')?.combiner?.model).toBe(RECOMMENDED_MODEL);
  });

  it('the rendered multi-lane SVG names the selected combiner', () => {
    const base: SLDProfessionalInput = {
      projectName: 'Hybrid', clientName: 'Jane Doe', address: '123 Sunshine Ave',
      designer: 'SolarPro', drawingDate: '2026-09-22', drawingNumber: 'SLD-001', revision: 'A',
      topologyType: 'HYBRID_MULTI_SOURCE',
      totalModules: 32, totalStrings: 2, panelModel: 'Q.PEAK 430', panelWatts: 430,
      panelVoc: 37.2, panelIsc: 13.9, dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
      inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
      acOutputKw: 11.44, acOutputAmps: 48, acWireGauge: '#6 AWG', acConduitType: 'EMT', acOCPD: 60,
      mainPanelAmps: 200, panelBusRating: 200, backfeedAmps: 60,
      utilityName: 'APS', interconnection: 'LOAD_SIDE',
      rapidShutdownIntegrated: true, hasProductionMeter: true, hasBattery: false,
      batteryModel: '', batteryKwh: 0, scale: 'NOT TO SCALE', acWireLength: 60,
      sources: lanes,
    } as unknown as SLDProfessionalInput;

    const withSel = renderSLDProfessional({ ...base, selectedCombinerId: SELECTED } as never);
    expect(withSel.toUpperCase()).toContain(SELECTED_MODEL.toUpperCase());
    expect(withSel.toUpperCase()).not.toContain(RECOMMENDED_MODEL.toUpperCase());

    // Control: the same drawing without a selection names the paired device.
    const without = renderSLDProfessional(base);
    expect(without.toUpperCase()).toContain(RECOMMENDED_MODEL.toUpperCase());
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 7 — the SLD route's hybrid branch RETURNS before the single-lane
// combiner resolution ever runs, so a hybrid diagram/export was drawn from a
// payload that carried no combiner facts at all.
// ════════════════════════════════════════════════════════════════════
describe('link 7 — /api/engineering/sld hybrid branch carries the selection', () => {
  async function postSld(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/engineering/sld/route');
    const req = new Request('http://solarpro.test/api/engineering/sld', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req as never);
    return { status: res.status, text: await res.text() };
  }

  const hybridBody = (over: Record<string, unknown> = {}) => ({
    format: 'svg',
    projectName: 'Hybrid',
    topologyType: 'HYBRID_MULTI_SOURCE',
    totalModules: 32,
    sources: [
      {
        key: 'roof', topologyType: 'MICROINVERTER',
        inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
        totalModules: 12, deviceCount: 12, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
        acOutputKw: 3.84, acOutputAmps: 16, backfeedAmps: 20, acOCPD: 20,
        microBranches: [{ ocpdAmps: 20, branchCurrentA: 12.8, deviceCount: 12 }],
      },
      {
        key: 'ground', topologyType: 'STRING_INVERTER',
        inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H',
        totalModules: 20, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9, totalStrings: 2,
        acOutputKw: 7.6, acOutputAmps: 32, backfeedAmps: 40, acOCPD: 40,
      },
    ],
    ...over,
  });

  it('a hybrid render honours the selected combiner', async () => {
    const { status, text } = await postSld(hybridBody({ selectedCombinerId: SELECTED }));
    expect(status).toBe(200);
    expect(text.toUpperCase()).toContain(SELECTED_MODEL.toUpperCase());
    expect(text.toUpperCase()).not.toContain(RECOMMENDED_MODEL.toUpperCase());
  });

  it('a hybrid render with no selection still names the paired device (no regression)', async () => {
    const { status, text } = await postSld(hybridBody());
    expect(status).toBe(200);
    expect(text.toUpperCase()).toContain(RECOMMENDED_MODEL.toUpperCase());
  });
});

// ════════════════════════════════════════════════════════════════════
// THE COST OF THIS CHANGE TO EVERY DESIGN THAT HAS NOT MADE A SELECTION.
//
// A permit snapshot digest identifies the DESIGN. Moving it re-dates issued
// packages and retires live PE approvals, and a digest moves for ANY shape
// change — adding a field and removing a `null` leaf move it identically. So
// threading a new authority through buildIntegratedEquipment (which the
// snapshot builder calls) has to be proven inert for the designs that predate
// it, or this repair silently invalidates every approval in the system.
//
// It is inert because `selectedCombinerId: null` takes the SAME branch the
// resolver took before it existed, and the snapshot reads only `bos.brains` —
// never the basis. A selected project's digest DOES move, and must: the
// equipment genuinely changed.
// ════════════════════════════════════════════════════════════════════
describe('digest stability — an unselected design is untouched by this work', () => {
  const digestOf = (p: ReturnType<typeof fixture>) =>
    computeSnapshotDigest(
      buildPermitDesignSnapshot(p, cad, { projectId: 'p1', designVersionId: 'v1' }) as unknown as Record<string, unknown>,
    );

  it('field ABSENT and field EXPLICITLY NULL produce the same digest', () => {
    const absent = fixture();
    const nulled = fixture();
    nulled.project.selectedCombinerId = null;
    expect(digestOf(nulled)).toBe(digestOf(absent));
  });

  it('an empty-string selection is treated as no selection, not as a device', () => {
    const blank = fixture();
    blank.project.selectedCombinerId = '   ';
    expect(digestOf(blank)).toBe(digestOf(fixture()));
  });

  it('a REAL selection does move the digest — the design changed', () => {
    expect(digestOf(fixture(SELECTED))).not.toBe(digestOf(fixture()));
  });
});

// ════════════════════════════════════════════════════════════════════
// LINK 8 — the shared SLD adapter already honoured the selection. Pinned so a
// future edit cannot quietly drop it, and so the chain's one WORKING link is
// on the record next to the seven that were not.
// ════════════════════════════════════════════════════════════════════
describe('link 8 — sldCombinerFields (SVG + PDF surfaces) — regression pin', () => {
  it('maps the selected device and marks the selection decided', () => {
    const f = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', inverterId: 'enphase-iq8plus',
      isMicro: true, totalDevices: 12, branchCount: 3, hasBattery: false,
      selectedCombinerId: SELECTED,
    });
    expect(f.combinerModel).toContain(SELECTED_MODEL);
    expect(f.combinerSelectionIsDecided).toBe(true);
  });

  it('an unselected project is NOT decided, so the sheet must qualify it', () => {
    const f = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', inverterId: 'enphase-iq8plus',
      isMicro: true, totalDevices: 12, branchCount: 3, hasBattery: false,
    });
    expect(f.combinerSelectionIsDecided).toBe(false);
  });
});
