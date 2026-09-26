/**
 * tests/permitStandaloneGateway.test.ts
 *
 * THE PERMIT PACKAGE FOR A STANDALONE IQ GATEWAY — and proof that no existing
 * project's package moved to make room for it.
 *
 * On a standalone design the plan has TWO boxes where every permit sheet used to
 * assume one: the AC branch circuits land on 2-pole breakers in a PV AC combiner
 * panel, and the IQ Gateway is its own enclosure fed from its own 2-pole breaker
 * in that panel. Every sheet named `brains` as the combiner, and on this design
 * the brains is the gateway — so E-1, PV-4A, the snapshot and APP-A would all
 * have said the branches terminate inside a DIN-rail box with no busbar, and the
 * E-1 metering slice (which did not carry `gatewayPlacement`) printed
 * "NO CONS" beside a PV-4A that stated consumption CTs and a BOM that bought them.
 *
 * Three things are pinned here:
 *
 *   1. DIGEST SAFETY. The roof fixture's snapshot digests — with no combiner
 *      selection, with the 5C recorded, with the 6C recorded, and with a
 *      recorded CT location — are CONSTANTS recorded before the permit group
 *      changed anything (2026-09-26), and cross-checked against a `git archive
 *      HEAD` tree with none of the standalone work in it: all four digests were
 *      identical there. A digest move retires a live PE approval (memory:
 *      digest-moves-retire-pe-approvals); an existing design must never get one
 *      from a topology it did not choose.
 *
 *      These are whole-snapshot hashes, so an UNRELATED change that legitimately
 *      moves the roof fixture's snapshot will fail them too. That is the point of
 *      a digest pin — before regenerating a constant, prove with a leaf diff of
 *      the two snapshots that the move is the one you intended, and say so in the
 *      commit.
 *
 *   2. The standalone package itself: E-1 input, E-1.1, PV-4A, SCHED, the
 *      disconnect directory, APP-A, PV-0 and the snapshot all name the panel AND
 *      the gateway, and every CT fact on PV-4A is quoted from the one metering
 *      composer's drawing — the same object E-1 draws. And the standalone wording
 *      is micro-gated in ONE place: a string job with a leftover standalone pick
 *      has no AC branches, so no sheet may say they land on 20 A breakers while
 *      its E-1 and its snapshot describe no gateway.
 *
 *   3. tests/golden-path.test.ts pins Object.keys of the E-1 input for the roof
 *      fixture. It is unchanged for the fixture, and a standalone design gains
 *      exactly one key.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { roofProject } from '../test-fixtures/roofProject';
import { groundProject } from '../test-fixtures/groundProject';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { buildPermitDesignSnapshot } from '@/lib/permit/snapshot/build';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { generatePermitHTML } from '@/lib/permit/generatePermit';
import {
  buildIntegratedEquipment,
  planLandingDevice,
  permitStandaloneGateway,
} from '@/lib/permit/utils/integratedEquipment';
import { buildConductorAuthority } from '@/lib/permit/utils/conductorAuthority';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';

const STANDALONE = 'enphase-iq-gateway-standalone';
const FIVE_C = 'enphase-iq-combiner-5c';
const SIX_C = 'enphase-iq-combiner-6c';
const PANEL_LABEL = 'Generic 125A PV AC Combiner Panel';
const SUPPLY_CONDUCTOR = '#14 AWG CU THWN-2 (L1, L2, N) + #14 EGC';

const job = (over: Record<string, unknown> = {}, base: unknown = roofProject) => {
  const p = JSON.parse(JSON.stringify(base));
  Object.assign(p.project, over);
  return p;
};
const cadOf = (p: unknown) => generateCADLayout(p as any);
const snapOf = (p: any) =>
  buildPermitDesignSnapshot(p, cadOf(p), { projectId: 'p1', designVersionId: 'v1' }) as any;
const sldOf = (p: any) => buildSLDInputFromPermit(p, cadOf(p)) as any;

/** Whole permit packages are the expensive part — build each case once. */
const _pkg = new Map<string, { html: string; snap: any }>();
const pkgOf = (key: string, over: Record<string, unknown>, base: unknown = roofProject) => {
  if (!_pkg.has(key)) {
    const p = job(over, base);
    const html = generatePermitHTML(p);
    _pkg.set(key, { html, snap: (p as { _snapshot?: unknown })._snapshot });
  }
  return _pkg.get(key)!;
};

/** The one planset page whose title block carries `title` and which embeds the
 *  SLD renderer (E-1 / E-1.1 are `sld-page`s) — so an assertion about E-1.1
 *  cannot be satisfied by the same words on PV-0 or SCHED. */
const sldPageOf = (html: string, title: string) => {
  const pages = html.split('<div class="page').filter(p => p.startsWith(' sld-page') && p.includes(title));
  expect(pages, `exactly one sld-page titled ${title}`).toHaveLength(1);
  return pages[0];
};

// ── 1. Digest safety ────────────────────────────────────────────────────────
// Recorded 2026-09-26 by a tsx probe (buildPermitDesignSnapshot on the roof
// fixture with generateCADLayout, opts { projectId: 'p1', designVersionId: 'v1' })
// BEFORE any permit-group edit, and reproduced byte-for-byte on a `git archive
// HEAD` tree. No-selection and a recorded 5C hash the same because the roof's
// IQ8M resolves to the 5C either way and the selection BASIS is not digested.
const HEAD_DIGESTS: Array<[string, Record<string, unknown>, string]> = [
  ['no combiner selection', {},
    '9a83dfabaf3070ced5882c7d08d571724d1a8f56ba5bffcc0ab047a2cba196ad'],
  ['recorded IQ Combiner 5C', { selectedCombinerId: FIVE_C },
    '9a83dfabaf3070ced5882c7d08d571724d1a8f56ba5bffcc0ab047a2cba196ad'],
  ['recorded IQ Combiner 6C', { selectedCombinerId: SIX_C },
    '3aa793bdede8620b7eb50b503bc1094801b90ddcca72d21ba4e5d0197cc5c0c8'],
  ['recorded 5C, supply-side tap, recorded CT location',
    { selectedCombinerId: FIVE_C, interconnectionMethod: 'SUPPLY_SIDE_TAP', consumptionCtLocation: 'main-breaker-load-side' },
    '13fc62bbbd43df909a2eef2eb2950e67d6cdd22a56cbb6b9b2cf821a0cd8a5d4'],
];

describe('an existing design does not move', () => {
  for (const [name, over, digest] of HEAD_DIGESTS) {
    it(`${name}: the snapshot digest is the one HEAD computes`, () => {
      expect(computeSnapshotDigest(snapOf(job(over)))).toBe(digest);
    });
  }

  it('carries no standalone key anywhere — absent, not null, not undefined-valued', () => {
    for (const [name, over] of HEAD_DIGESTS) {
      const s = snapOf(job(over));
      expect('gatewayTopology' in s.electrical, name).toBe(false);
      expect(s.equipment.combinerLabel, name).toMatch(/^Enphase IQ Combiner [56]C$/);
      expect(s.projectAuthority.equipmentSummary.combinerLabel, name).toBe(s.equipment.combinerLabel);
      const sld = sldOf(job(over));
      expect('standaloneGateway' in sld, name).toBe(false);
      expect(sld.combinerLabel, name).toBe(s.equipment.combinerLabel);
      const plan = buildIntegratedEquipment(job(over), cadOf(job(over)));
      expect(permitStandaloneGateway(job(over), cadOf(job(over)), plan), name).toBeUndefined();
      // The one rule returns exactly what every consumer used before.
      expect(planLandingDevice(plan), name).toBe(plan.brains ?? plan.devices[0]);
    }
  });

  it('the sheets still say what they said: one integrated device, no standalone wording', () => {
    const { html } = pkgOf('5c', { selectedCombinerId: FIVE_C });
    expect(html).toContain('<strong>AC AGGREGATION — ENPHASE IQ COMBINER 5C:</strong> The AC branch circuits terminate at the IQ Combiner 5C');
    expect(html).toContain('terminating at the AC combiner.');
    expect(html).toContain('<strong>AC Combiner / Gateway:</strong> Enphase IQ Combiner 5C');
    expect(html).not.toContain('STANDALONE GATEWAY');
    expect(html).not.toContain(PANEL_LABEL.toUpperCase());
  });
});

// ── 2. The standalone package ───────────────────────────────────────────────
describe('a standalone IQ Gateway design — every artefact names the panel AND the gateway', () => {
  const over = { selectedCombinerId: STANDALONE };

  it('the plan the permit resolves is the standalone topology', () => {
    const p = job(over);
    const plan = buildIntegratedEquipment(p, cadOf(p));
    expect(plan.gatewayPlacement).toBe('standalone');
    expect(planLandingDevice(plan)?.kind).toBe('ac_combiner');
    expect(plan.brains?.id).toBe('enphase-iq-gateway');
    // With and without a pre-resolved plan: the default argument resolves the same one.
    expect(permitStandaloneGateway(p, cadOf(p))).toEqual(permitStandaloneGateway(p, cadOf(p), plan));
    expect(permitStandaloneGateway(p, cadOf(p), plan)).toEqual({
      label: 'Enphase IQ Gateway',
      partNumber: 'ENV2-IQ-AM1-240',
      supplyBreakerA: 15,
      supplyConductor: SUPPLY_CONDUCTOR,
      landingLabel: PANEL_LABEL,
    });
  });

  it('the 2-pole branch breaker the sheets name is the OCPD the conductor authority sized for every branch', () => {
    // PV-4A / SCHED / PV-6 / PV-0 print the plan's `branchBreakerA` (Enphase's
    // 20 A IQ Cable breaker); the AC branch rating tables beside them print the
    // conductor authority's per-branch OCPD. Two sources for one breaker — so
    // they are pinned to agree rather than trusted to.
    const p = job(over);
    const plan = buildIntegratedEquipment(p, cadOf(p));
    const branches = buildConductorAuthority(p, cadOf(p)).microBranches;
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) expect(b.ocpdAmps, `branch ${b.index}`).toBe(plan.branchBreakerA);
  });

  it('E-1: the combiner is the panel, the gateway travels as standaloneGateway, and the CTs are drawn', () => {
    const sld = sldOf(job(over));
    expect(sld.combinerLabel).toBe(PANEL_LABEL);
    expect(sld.combinerModel).toBe(PANEL_LABEL);
    expect(sld.combinerHasIntegratedGateway).toBe(false);
    expect(sld.standaloneGateway).toEqual({
      label: 'Enphase IQ Gateway',
      partNumber: 'ENV2-IQ-AM1-240',
      supplyBreakerA: 15,
      supplyConductor: SUPPLY_CONDUCTOR,
      landingLabel: PANEL_LABEL,
    });
    // The metering slice now carries gatewayPlacement: consumption is required
    // and drawn, the production CT clamps L1 in the PV panel, both leads exist.
    expect(sld.meteringChannels).toBe('PROD (CT) · CONS (NET)');
    expect(sld.meteringDrawing.production.where).toBe('landing-panel-field');
    expect(sld.meteringDrawing.consumption).toMatchObject({ ctCount: 2, supplied: 'order-separately' });
    expect(sld.meteringDrawing.leads.map((l: { channel: string }) => l.channel)).toEqual(['production', 'consumption']);
  });

  it('E-1 states the same metering PV-4A states (PV-4A hands the composer the whole plan)', () => {
    const p = job(over);
    const pv4a = resolveDesignMetering({
      plan: buildIntegratedEquipment(p, cadOf(p)),
      interconnectionRaw: 'LOAD_SIDE',
      consumptionCtLocation: null,
      systemVoltage: 240,
    });
    const sld = sldOf(p);
    expect(sld.meteringChannels).toBe(pv4a.scheduleValue);
    expect(sld.meteringDrawing).toEqual(pv4a.drawing);
  });

  it('the permit E-1 and the Diagram tab / SLD PDF describe the same gateway and the same CTs', () => {
    // sldCombinerFields is what the engineering SLD and the SLD PDF spread into
    // the renderer. SAME DESIGN, taken from the same authority the permit reads
    // — the roof fixture is 12 × IQ8M in two 6-module branches — never a typed
    // count: a hand-typed `branchCount: 1` once passed here only because one and
    // two branches both happen to fit the 125 A panel, so any branch-dependent
    // field would have compared two different designs. Two ungrounded
    // conductors is what the SLD PDF route and the engineering page pass for
    // 120/240 V 1Ø; the permit E-1 hands the composer 240 V, which resolves to
    // the same two.
    const p = job(over);
    const cad = cadOf(p);
    const auth = buildConductorAuthority(p, cad);
    const devices = auth.subSystems.filter(s => s.isMicro).reduce((n, s) => n + (s.deviceCount || 0), 0);
    expect(auth.microBranches.map(b => b.deviceCount)).toEqual([6, 6]);
    expect(devices).toBe(12);
    const f = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', isMicro: true,
      totalDevices: devices, branchCount: auth.microBranches.length, hasBattery: false,
      selectedCombinerId: STANDALONE, interconnectionRaw: 'LOAD_SIDE',
      ungroundedConductorCount: 2,
    });
    const permitPlan = buildIntegratedEquipment(p, cad);
    expect(f.plan.branchSlots).toBe(permitPlan.branchSlots);
    expect(f.plan.branchSlotWarning).toBe(permitPlan.branchSlotWarning);
    expect(planLandingDevice(f.plan)?.id).toBe(planLandingDevice(permitPlan)?.id);
    const sld = sldOf(p);
    expect(sld.standaloneGateway).toEqual(f.standaloneGateway);
    expect(sld.combinerLabel).toBe(f.combinerLabel);
    expect(sld.meteringChannels).toBe(f.combinerMeteringSummary);
    expect(sld.meteringDrawing).toEqual(f.meteringDrawing);
  });

  it('PV-4A: branches on 2P 20 A breakers in the panel, the gateway on its own 2P 15 A breaker, every CT fact quoted from the composer', () => {
    const { html } = pkgOf('standalone', over);
    const sld = sldOf(job(over));
    expect(html).toContain('<strong>AC AGGREGATION — GENERIC 125A PV AC COMBINER PANEL + ENPHASE IQ GATEWAY (STANDALONE GATEWAY):</strong>');
    expect(html).toContain('The AC branch circuits land on 2-pole 20 A breakers in the 125A PV AC Combiner Panel');
    expect(html).toContain('The Enphase IQ Gateway (ENV2-IQ-AM1-240) is a separate enclosure');
    expect(html).toContain(`supplied from its own 2-pole 15 A breaker in that panel (${SUPPLY_CONDUCTOR})`);
    // Verbatim from the drawing E-1 draws — never re-worded on the sheet.
    expect(html).toContain(sld.meteringDrawing.production.label);
    for (const l of sld.meteringDrawing.leads as Array<{ label: string }>) expect(html).toContain(l.label);
    // The 5 ft / do-not-extend fact is stated ONCE, by the composer's label
    // above; the sentence after it gives only the consequence for the gateway.
    expect(html).toContain("Every CT lead lands on the Enphase IQ Gateway, which mounts within the production CT lead's reach of the panel's L1.");
    expect(html).not.toContain('the production CT lead is 5 ft and may not be extended');
    // The defect this replaces.
    expect(html).not.toContain('terminate at the IQ Gateway');
    expect(html).not.toContain('AC AGGREGATION — ENPHASE IQ GATEWAY:');
  });

  it('SCHED, the disconnect directory, APP-A and PV-0 name both boxes', () => {
    const { html } = pkgOf('standalone', over);
    // SCHED — the note under the aggregation table, and where the trunks
    // terminate. The gateway's supply is stated once on the sheet (the note),
    // not again in the termination sentence.
    expect(html).toContain('<strong>STANDALONE GATEWAY:</strong> AC branches land on 2-pole 20 A breakers in the 125A PV AC Combiner Panel');
    expect(html).toContain('terminating on 2-pole 20 A breakers in the 125A PV AC Combiner Panel.');
    expect(html).not.toContain('(the Enphase IQ Gateway is a separate enclosure fed from its own');
    // PV-6 disconnecting-means directory.
    expect(html).toContain('20 A 2P branch + 15 A 2P gateway breakers');
    expect(html).toContain('ENPHASE IQ GATEWAY (ENV2-IQ-AM1-240)');
    expect(html).toContain('Beside the 125A PV AC Combiner Panel — fed from its 15 A 2P breaker');
    // APP-A — one data-sheet row per box.
    expect(html).toContain(`<strong>AC Combiner Panel:</strong> ${PANEL_LABEL}`);
    expect(html).toContain('<strong>Gateway:</strong> Enphase IQ Gateway (ENV2-IQ-AM1-240)');
    expect(html).not.toContain('<strong>AC Combiner / Gateway:</strong>');
    // PV-0.
    expect(html).toContain('1 × GENERIC 125A PV AC COMBINER PANEL — COMBINER — AC BRANCHES ON 20A 2P BREAKERS');
    expect(html).toContain('1 × ENPHASE IQ GATEWAY — GATEWAY · METERING · RAPID SHUTDOWN — STANDALONE (ENV2-IQ-AM1-240), 15A 2P SUPPLY IN PV PANEL');
  });

  it('E-1.1 lists the gateway beside the panel, and E-1 draws the gateway supply conductor', () => {
    // E-1.1 is the renderer's schedule band on its own sheet; the facts are
    // asserted, not the renderer's row caption, so the renderer may word its
    // row as it likes — but the permit's E-1.1 may not drop the gateway while
    // PV-0, SCHED, PV-6, APP-A and the BOM all list it.
    const { html } = pkgOf('standalone', over);
    const sg = sldOf(job(over)).standaloneGateway;
    const e11 = sldPageOf(html, 'ELECTRICAL SCHEDULES');
    expect(e11).toContain(PANEL_LABEL);
    expect(e11).toContain(`${sg.label} (${sg.partNumber})`);
    expect(e11).toContain(`${sg.supplyBreakerA}A 2P`);
    const e1 = sldPageOf(html, 'SINGLE-LINE ELECTRICAL DIAGRAM');
    expect(e1).toContain(SUPPLY_CONDUCTOR);
    expect(e1).toContain(sg.partNumber);
  });

  it('the snapshot records the topology, names the panel as the combiner, and moves only its own digest', () => {
    const s = snapOf(job(over));
    expect(s.electrical.gatewayTopology).toEqual({
      placement: 'standalone',
      gatewayModel: 'IQ Gateway',
      gatewayPartNumber: 'ENV2-IQ-AM1-240',
      landingModel: '125A PV AC Combiner Panel',
      supplyBreakerA: 15,
      branchBreakerA: 20,
    });
    expect(s.equipment.combinerLabel).toBe(PANEL_LABEL);
    expect(s.projectAuthority.equipmentSummary.combinerLabel).toBe(PANEL_LABEL);
    const d = computeSnapshotDigest(s);
    for (const [, , existing] of HEAD_DIGESTS) expect(d).not.toBe(existing);
  });

  it('a recorded CT location on a standalone design reaches the snapshot (gatewayPlacement rides the metering slice)', () => {
    const s = snapOf(job({ ...over, interconnectionMethod: 'SUPPLY_SIDE_TAP', consumptionCtLocation: 'main-breaker-load-side' }));
    expect(s.electrical.meteringTopology).toMatchObject({ consumptionCtLocation: 'main-breaker-load-side', basis: 'designer-recorded' });
    expect(s.electrical.gatewayTopology?.placement).toBe('standalone');
  });
});

// ── 2b. The micro gate — one place, every artefact ──────────────────────────
// The plan honours a recorded selection unconditionally, so a STRING job with a
// leftover standalone pick still resolves a panel and a gateway (sized for zero
// branches). E-1 and the snapshot gated that on the micro topology; PV-0, SCHED
// and the PV-6 directory did not, and printed "AC branches land on 2-pole 20 A
// breakers" for a design with no AC branch circuits. The gate now lives in
// `permitStandaloneGateway`, which all of them — and PV-4A — call.
describe('a string job with a leftover standalone pick', () => {
  const over = { selectedCombinerId: STANDALONE };

  it('still resolves both boxes, but no permit artefact carries the standalone topology', () => {
    const p = job(over, groundProject);
    const cad = cadOf(p);
    const plan = buildIntegratedEquipment(p, cad);
    expect(plan.gatewayPlacement).toBe('standalone');
    expect(buildConductorAuthority(p, cad).microBranches).toHaveLength(0);
    expect(permitStandaloneGateway(p, cad, plan)).toBeUndefined();
    expect('standaloneGateway' in sldOf(job(over, groundProject))).toBe(false);
    expect('gatewayTopology' in snapOf(job(over, groundProject)).electrical).toBe(false);
  });

  it('no sheet says AC branches land on breakers; APP-A still lists one data sheet per box', () => {
    const { html } = pkgOf('ground-standalone', over, groundProject);
    expect(html).not.toContain('STANDALONE GATEWAY');           // SCHED note, PV-4A heading
    expect(html).not.toContain('AC BRANCHES ON');               // PV-0
    expect(html).not.toContain('2P SUPPLY IN PV PANEL');        // PV-0
    expect(html).not.toContain('AC branch circuits land here'); // PV-6 directory
    expect(html).not.toContain('gateway breakers');             // PV-6 directory
    // APP-A names data sheets, not a topology: both boxes are still in the plan
    // (and on PV-0, SCHED and the BOM), and the snapshot records the PANEL as
    // the combiner — so the gateway is never printed as "AC Combiner / Gateway".
    expect(html).toContain(`<strong>AC Combiner Panel:</strong> ${PANEL_LABEL}`);
    expect(html).toContain('<strong>Gateway:</strong> Enphase IQ Gateway (ENV2-IQ-AM1-240)');
    expect(html).not.toContain('<strong>AC Combiner / Gateway:</strong>');
  });
});

// ── 3. The E-1 key set golden-path pins ─────────────────────────────────────
describe("golden-path's E-1 key set", () => {
  const golden = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../test-fixtures/golden/golden.json'), 'utf-8'));
  const goldenKeys: string[] = golden['sld-input-roof'].topLevelKeys;

  it('is unchanged for the roof fixture (the exact call golden-path makes)', () => {
    const keys = Object.keys(buildSLDInputFromPermit(roofProject, generateCADLayout(roofProject as any))).sort();
    expect(keys).toEqual(goldenKeys);
    expect(keys).not.toContain('standaloneGateway');
  });

  it('gains exactly `standaloneGateway` on a standalone design', () => {
    const keys = Object.keys(sldOf(job({ selectedCombinerId: STANDALONE }))).sort();
    expect(keys.filter(k => !goldenKeys.includes(k))).toEqual(['standaloneGateway']);
    expect(goldenKeys.filter(k => !keys.includes(k))).toEqual([]);
  });
});
