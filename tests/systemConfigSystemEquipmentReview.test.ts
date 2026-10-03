// ═══════════════════════════════════════════════════════════════════════════
// The per-system equipment slice, after its adversarial review — each case is one verified finding.
//
//   · A system whose batteries are combined with the others' in ONE site-wide generation panel is
//     re-equipped on that panel: no second panel and no new connection nobody chose, and the shared
//     panel never keeps a circuit for a battery that is gone or lacks one for a battery that is new.
//   · Such a system is not asked "where do ITS batteries land?" — they land where the others' do.
//   · A new backed-up system is never built from a controller and a battery the catalogue does not
//     list together, and the page reads that pair from ONE system, not one half from each.
//   · One open landing is one release blocker, not one per system plus one for "all systems".
//   · "No controller fits" says WHY: no fact at all, or listed only with a device that is not a
//     backup controller (and names it).
//   · Taking a system's batteries to zero leaves no connection pointing at a battery that is gone.
//   · Different controllers on different systems are stated per product, never "2 × the first one".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSystemConfigInterview, type InterviewEquipment, type InterviewInput,
} from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerDistribution, answerSystemsArrangement, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  answerSystemEquipment, answerSystemLanding, answerBackedUpPanels, answerBackupChoice, controllersFor,
  systemLandingItemId, selectionPairOf, controllersByProduct, NOT_EVALUATED_MFR,
} from '@/lib/electrical/systemConfigSystemEquipment';
import { addBackupDomain, updateAggregationPanel } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const GW2 = 'tesla-backup-gateway-2';
const SC3 = 'enphase-iq-system-controller-3';
const IQ5P = 'enphase-iq-battery-5p';

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const PW3_EQ: InterviewEquipment = {
  pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: false, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Backup Gateway 3', count: 2 },
};
const iv = (topology: ServiceTopology, equipment: InterviewEquipment = PW3_EQ, over: Partial<InterviewInput> = {}) =>
  buildSystemConfigInterview({
    pvArray: pv20, topology, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment, evaluation: null, derivedStrings: null, ...over,
  });
type IV = ReturnType<typeof iv>;
const all = (x: IV) => x.sections.flatMap(s => s.items);
const item = (x: IV, id: string) => all(x).find(i => i.id === id);
const perSystemLanding = (x: IV) => all(x).filter(i => i.id.startsWith('equipment.system.landing.'));

const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};
const refusedText = (r: AnswerResult): string => (r.ok === false ? r.refused : '');
const inverterIds = (t: ServiceTopology) => t.storage.filter(u => u.role === 'inverter-unit').map(u => u.id);
const twoPanels = () => ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));

/** Two systems, two Powerwalls each, combined in ONE site-wide generation panel with one connection. */
const commonAggregation = () => ok(answerSystemsArrangement(
  buildTesla400ATwoGateway({ powerwallsPerSystem: 2, expansionsPerSystem: 0 }).topology, 'common-aggregation'));

describe('[blocking] re-equipping a system whose batteries share ONE generation panel with the others', () => {
  it('a count change keeps one panel and one connection, and the shared panel takes exactly the batteries there are', () => {
    const base = commonAggregation();
    expect(base.aggregationPanels).toHaveLength(1);
    expect(base.aggregationPanels[0].domainId).toBeUndefined();
    expect(base.pointsOfInterconnection).toHaveLength(1);
    const shared = base.aggregationPanels[0];
    // An enclosure the installer chose for it, to prove the panel is the same panel afterwards.
    const t = updateAggregationPanel(base, shared.id, { productId: 'chosen-enclosure' });

    const three = ok(answerSystemEquipment(t, 'domain-a', { storageUnits: 3 }));
    expect(three.aggregationPanels, 'a second, per-system panel was built that nobody chose').toHaveLength(1);
    expect(three.pointsOfInterconnection, 'a connection was added that nobody chose').toHaveLength(1);
    const p = three.aggregationPanels[0];
    expect(p).toMatchObject({
      id: shared.id, productId: 'chosen-enclosure',
      busbarRatingA: shared.busbarRatingA, outputOcpdA: shared.outputOcpdA, feedsNodeId: shared.feedsNodeId,
    });
    expect(p.inputs.map(i => i.sourceId).sort(), 'the shared panel kept stale battery circuits')
      .toEqual(inverterIds(three).sort());
    expect(new Set(p.inputs.map(i => i.id)).size).toBe(p.inputs.length);
    expect(three.domains.map(d => d.storageConnection)).toEqual(['der-aggregation-panel', 'der-aggregation-panel']);

    // And down again: a circuit for a battery that is gone is not left on the panel.
    const one = ok(answerSystemEquipment(three, 'domain-a', { storageUnits: 1 }));
    expect(one.aggregationPanels).toHaveLength(1);
    expect(one.pointsOfInterconnection).toHaveLength(1);
    expect(one.aggregationPanels[0].inputs.map(i => i.sourceId).sort()).toEqual(inverterIds(one).sort());
  });

  it('an empty system on the combined job: its new batteries go on the shared panel, not a new one', () => {
    const base = commonAggregation();
    const t = ok(answerSystemEquipment(base, 'domain-b', { storageUnits: 0 }));
    expect(t.aggregationPanels[0].inputs.map(i => i.sourceId).sort()).toEqual(inverterIds(t).sort());
    const back = ok(answerSystemEquipment(t, 'domain-b', { storageProductId: PW3, storageUnits: 2 }));
    expect(back.aggregationPanels).toHaveLength(1);
    expect(back.pointsOfInterconnection).toHaveLength(1);
    expect(back.aggregationPanels[0].inputs.map(i => i.sourceId).sort(), 'the new batteries land nowhere')
      .toEqual(inverterIds(back).sort());
  });

  it('only SOME of a system\'s batteries on the shared panel ⇒ a new set is refused, not guessed', () => {
    const base = commonAggregation();
    const t = { ...base, aggregationPanels: base.aggregationPanels.map(a => ({
      ...a, inputs: a.inputs.filter(i => i.sourceId !== 'domain-a-ess-2') })) };
    const r = answerSystemEquipment(t, 'domain-a', { storageUnits: 3 });
    expect(r.ok).toBe(false);
    expect(refusedText(r)).toMatch(/Only some of System 1’s batteries land in DER aggregation panel.*Advanced/);
    // A controller change leaves the batteries as they are, so it is not refused.
    expect(answerSystemEquipment(t, 'domain-a', { gatewayProductId: GW2 }).ok).toBe(true);
  });

  it('a system with its OWN generation panel still gets that panel rebuilt (unchanged behaviour)', () => {
    const rays = buildRaysIntendedJob().topology;
    const three = ok(answerSystemEquipment(rays, 'domain-a', { storageUnits: 3 }));
    const own = (three.aggregationPanels ?? []).filter(a => a.domainId === 'domain-a');
    expect(own).toHaveLength(1);
    expect(own[0].inputs).toHaveLength(3);
    expect(three.aggregationPanels).toHaveLength(rays.aggregationPanels.length);
    expect(three.pointsOfInterconnection).toHaveLength(rays.pointsOfInterconnection.length);
  });
});

describe('[should-fix] a system combined with the others is not asked where ITS batteries land', () => {
  it('common aggregation ⇒ no per-system landing question, and a per-system answer is refused', () => {
    const t = commonAggregation();
    expect(perSystemLanding(iv(t)).map(i => i.question)).toEqual([]);
    const r = answerSystemLanding(t, 'domain-b', 'gateway-panelboard');
    expect(r.ok, 'a per-system answer stranded the system\'s batteries on the shared panel').toBe(false);
    expect(refusedText(r)).toMatch(/combined with the other systems/);
    expect(refusedText(r)).toMatch(/DER aggregation panel/);
  });

  it('the same when the shared panel holds the batteries under a custom arrangement', () => {
    const base = commonAggregation();
    const t = { ...base, interconnection: { ...base.interconnection, derArrangement: 'custom' as const } };
    expect(perSystemLanding(iv(t))).toEqual([]);
    expect(answerSystemLanding(t, 'domain-a', 'backed-up-panel-busbar').ok).toBe(false);
  });

  it('control: independent systems are still asked, each on its own', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 0 }).topology;
    expect(perSystemLanding(iv(t)).map(i => i.id))
      .toEqual([systemLandingItemId('domain-a'), systemLandingItemId('domain-b')]);
    expect(answerSystemLanding(t, 'domain-a', 'gateway-panelboard').ok).toBe(true);
  });
});

describe('[should-fix] a new backed-up system is built only from a pair the catalogue lists together', () => {
  const MISMATCH = { gatewayProductId: SC3, storageProductId: PW3, totalUnits: 4 };
  const unlisted = () => {
    const base = ok(answerServiceRating(null, 200));
    const one = addBackupDomain(base, {
      branchId: base.branches[0].id, panelIds: [base.panels[0].id], gatewayProductId: GW3,
      storageProductIds: [PW3, PW3],
    }).topology;
    return refusedText(answerSystemEquipment(one, 'domain-1', { gatewayProductId: SC3 }));
  };

  it('"only MSP #2" with an unlisted controller + battery is refused, with the same words as re-equipping', () => {
    const r = answerBackedUpPanels(twoPanels(), ['msp-2'], { ...MISMATCH, unitsPerPanel: { 'msp-2': 2 } });
    expect(r.ok, 'a system was built around a controller the catalogue does not list for its battery').toBe(false);
    expect(refusedText(r)).toBe(unlisted());
    expect(refusedText(answerBackupChoice(twoPanels(), 'whole', { ...MISMATCH, unitsPerPanel: { 'msp-1': 1 } })))
      .toBe(unlisted());
    expect(refusedText(answerBackupChoice(ok(answerServiceRating(null, 200)), 'whole', MISMATCH))).toBe(unlisted());
  });

  it('control: a listed pair still builds; a system given no batteries forms no pair to refuse', () => {
    expect(answerBackedUpPanels(twoPanels(), ['msp-2'], {
      gatewayProductId: GW3, storageProductId: PW3, unitsPerPanel: { 'msp-2': 2 },
    }).ok).toBe(true);
    expect(answerBackedUpPanels(twoPanels(), ['msp-2'], MISMATCH).ok).toBe(true);
  });

  it('the page\'s pair is read from ONE system — never one system\'s controller with another\'s battery', () => {
    // System 1 moves to another family; its rebuilt units go to the END of the storage list, so the
    // first battery in the graph is now System 2's while the first controller is still System 1's.
    const rays = buildRaysIntendedJob().topology;
    const moved = ok(answerSystemEquipment(rays, 'domain-a', { gatewayProductId: SC3, storageProductId: IQ5P }));
    expect(moved.storage.find(u => u.role === 'inverter-unit')?.productId).toBe(PW3);
    expect(moved.domains[0].gateway.productId).toBe(SC3);

    const pair = selectionPairOf(moved);
    expect([pair.gateway?.productId, pair.unit?.productId]).toEqual([SC3, IQ5P]);
    expect(controllersFor(pair.unit!.productId).options.map(o => o.value)).toContain(pair.gateway!.productId);
    expect(selectionPairOf(null)).toEqual({ gateway: null, unit: null });
  });

  it('the page builds its equipment from that one pair, and states controllers per product', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
    const memo = page.slice(page.indexOf('const interviewEquipment = useMemo'), page.indexOf('const systemConfigInterview = useMemo'));
    expect(memo).toContain('selectionPairOf(svcTopology)');
    expect(memo).toContain('controllersByProduct(svcTopology)');
    expect(memo, 'the battery is still read from the first unit in the graph').not.toContain('graphUnits[0]?.productId');
    expect(memo, 'the controller is still read from the first system').not.toContain('graphGateways[0]?.productId');
  });
});

describe('[should-fix] one open landing is ONE release blocker', () => {
  const landingBlockers = (x: IV) => x.release.blockers.filter(b => /battery AC circuits/.test(b));

  it('two unresolved systems ⇒ exactly two blockers, one each; the all-systems question points below', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 0 }).topology;
    let x = iv(t);
    expect(landingBlockers(x), landingBlockers(x).join(' | ')).toHaveLength(2);
    expect(landingBlockers(x).every(b => /^System [12]:/.test(b))).toBe(true);
    expect(item(x, 'behavior.storage-landing')).toMatchObject({ state: 'answered', answer: 'Asked per system below' });

    x = iv(ok(answerSystemLanding(t, 'domain-b', 'gateway-panelboard')));
    expect(landingBlockers(x)).toEqual(['System 1: where do its battery AC circuits land? — not answered.']);

    x = iv(ok(answerSystemLanding(ok(answerSystemLanding(t, 'domain-b', 'gateway-panelboard')), 'domain-a', 'gateway-panelboard')));
    expect(landingBlockers(x)).toEqual([]);
    expect(item(x, 'behavior.storage-landing')).toMatchObject({ state: 'answered', value: 'gateway-panelboard' });
  });

  it('control: one system ⇒ the all-systems question is the only one, and it still blocks', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 0 }).topology;
    const one = { ...t, domains: t.domains.slice(0, 1), storage: t.storage.filter(u => t.domains[0].storageUnitIds.includes(u.id)) };
    const x = iv(one);
    expect(item(x, 'behavior.storage-landing')?.state).toBe('needs-answer');
    expect(landingBlockers(x)).toHaveLength(1);
  });
});

describe('[nit] "no controller fits" says which kind of gap it is', () => {
  it('listed only with a device that is not a backup controller ⇒ named, and said so', () => {
    const note = controllersFor('solaredge-home-battery-10').note ?? '';
    expect(note).toContain(NOT_EVALUATED_MFR);
    expect(note).toContain('only with SolarEdge Home Hub SE7600H-US and SolarEdge Home Hub SE10000H-US');
    expect(note).toMatch(/hybrid inverter \/ gateway/);
    expect(note).not.toMatch(/lists no backup controller/);
  });

  it('no compatibility fact at all ⇒ said as exactly that', () => {
    const note = controllersFor('franklin-apower-15').note ?? '';
    expect(note).toContain(NOT_EVALUATED_MFR);
    expect(note).toMatch(/no compatibility fact/);
  });
});

describe('[nit] batteries to zero leave no connection pointing at a battery that is gone', () => {
  const independent = () => buildTesla400ATwoGateway({
    powerwallsPerSystem: 2, expansionsPerSystem: 0, derArrangement: 'independent-branch', storageConnection: 'gateway-panelboard',
  }).topology;
  const dangling = (t: ServiceTopology) => {
    const nodes = new Set([...t.storage.map(u => u.id), ...t.aggregationPanels.map(a => a.id), ...t.devices.map(d => d.id),
      ...t.domains.map(d => d.gateway.id)]);
    return t.pointsOfInterconnection.filter(p => p.derNodeId !== null && !nodes.has(p.derNodeId)).map(p => `${p.label} → ${p.derNodeId}`);
  };

  it('zero batteries ⇒ the system\'s connection names no battery (not the one that was removed)', () => {
    const t = independent();
    expect(t.pointsOfInterconnection.find(p => p.id === 'poi-domain-a')?.derNodeId).toBe('domain-a-ess-1');
    const zero = ok(answerSystemEquipment(t, 'domain-a', { storageUnits: 0 }));
    expect(dangling(zero)).toEqual([]);
    expect(zero.pointsOfInterconnection.find(p => p.id === 'poi-domain-a')?.derNodeId).toBeNull();
    expect(zero.pointsOfInterconnection.find(p => p.id === 'poi-domain-b')?.derNodeId).toBe('domain-b-ess-1');
  });

  it('fewer batteries ⇒ a connection on a removed battery moves to the system\'s first remaining one', () => {
    const base = independent();
    const t = { ...base, pointsOfInterconnection: base.pointsOfInterconnection.map(p =>
      p.id === 'poi-domain-a' ? { ...p, derNodeId: 'domain-a-ess-2' } : p) };
    const one = ok(answerSystemEquipment(t, 'domain-a', { storageUnits: 1 }));
    expect(dangling(one)).toEqual([]);
    expect(one.pointsOfInterconnection.find(p => p.id === 'poi-domain-a')?.derNodeId).toBe('domain-a-ess-1');
  });
});

describe('different controllers on different systems are stated per product', () => {
  it('System 2 on another controller ⇒ "1 × A · 1 × B" in the answer, the card summary and the project summary', () => {
    const rays = buildRaysIntendedJob().topology;
    const mixed = ok(answerSystemEquipment(rays, 'domain-b', { gatewayProductId: GW2 }));
    const products = controllersByProduct(mixed);
    expect(products.map(p => [p.productId, p.count])).toEqual([[GW3, 1], [GW2, 1]]);
    expect(controllersByProduct(rays).map(p => [p.productId, p.count])).toEqual([[GW3, 2]]);

    const x = iv(mixed, { ...PW3_EQ, gateway: { label: 'Tesla Backup Gateway 3', count: 2, products } });
    const said = '1 × Tesla Backup Gateway 3 · 1 × Tesla Backup Gateway 2';
    expect(item(x, 'equipment.gateway')?.answer).toBe(said);
    expect(x.summaryFacts.find(f => f.label === 'Backup controllers')?.value).toBe(said);
    expect(x.sections.find(s => s.id === 'equipment')?.summary).toContain(said);

    // One product ⇒ unchanged wording.
    const same = iv(rays, { ...PW3_EQ, gateway: { label: 'Tesla Backup Gateway 3', count: 2, products: controllersByProduct(rays) } });
    expect(same.summaryFacts.find(f => f.label === 'Backup controllers')?.value).toBe('2 × Tesla Backup Gateway 3');
  });
});

// ── Second verification round (the fix's own reviewer) ─────────────────────────────────────────────
describe('🚨 second review round — a shared panel never keeps a battery that is gone', () => {
  it('own panel AND a site-wide panel holding the batteries: a count change rebuilds BOTH', async () => {
    const { answerStorageLanding } = await import('@/lib/electrical/systemConfigAnswers');
    void answerStorageLanding;
    const ca = ok(answerSystemsArrangement(buildRaysIntendedJob().topology, 'common-aggregation'));
    const t = ok(answerSystemEquipment(ca, 'domain-a', { storageUnits: 1 }));
    const units = new Set(t.storage.map(u => u.id));
    const dangling = (t.aggregationPanels ?? []).flatMap(p => p.inputs
      .filter(i => i.sourceId.startsWith('domain-a-ess') && !units.has(i.sourceId))
      .map(i => `${p.id}:${i.sourceId}`));
    expect(dangling, 'a generation panel kept a circuit for a battery that no longer exists').toEqual([]);
  });

  it('a common-aggregation job that aggregates only System 1 leaves System 2 its own landing question', async () => {
    const { landsOnSharedPanel } = await import('@/lib/electrical/systemConfigAnswers');
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 2, derArrangement: 'common-aggregation', aggregateOnlyFirstDomain: true }).topology;
    const b = t.domains.find(d => d.id === 'domain-b')!;
    expect(landsOnSharedPanel(t, b), 'System 2 was called combined though no shared panel takes its batteries').toBe(false);
    expect(answerSystemLanding(t, 'domain-b', 'gateway-panelboard').ok).toBe(true);
    // Control: System 1 IS on the shared panel.
    expect(landsOnSharedPanel(t, t.domains.find(d => d.id === 'domain-a')!)).toBe(true);
  });

  it('the all-systems landing answer obeys the same rule — it cannot strand batteries on the shared panel', async () => {
    const { answerStorageLanding } = await import('@/lib/electrical/systemConfigAnswers');
    const ca = ok(answerSystemsArrangement(buildRaysIntendedJob().topology, 'common-aggregation'));
    for (const v of ['gateway-panelboard', 'der-aggregation-panel'] as const) {
      const r = answerStorageLanding(ca, v);
      expect(r.ok, `all-systems '${v}' was accepted on a common-aggregation job`).toBe(false);
      expect(refusedText(r)).toMatch(/combined with the other systems/);
    }
  });
});

describe('🚨 second review round — different batteries per system are stated per product', () => {
  it('2 × IQ Battery 5P on System 1 and 2 × Powerwall 3 on System 2 read "2 × … · 2 × …", never "4 × first"', async () => {
    const { storageByProduct } = await import('@/lib/electrical/systemConfigSystemEquipment');
    const t = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-a',
      { gatewayProductId: SC3, storageProductId: IQ5P, storageUnits: 2 }));
    const products = storageByProduct(t);
    expect(products.map(p => p.count)).toEqual([2, 2]);
    const x = iv(t, { ...PW3_EQ, storage: { ...PW3_EQ.storage!, count: 4, products } });
    const fact = x.summaryFacts.find(f => f.label === 'Storage')?.value ?? '';
    expect(fact).toMatch(/^2 × .* · 2 × .*$/);
    expect(fact).not.toMatch(/^4 ×/);
    expect(item(x, 'equipment.storage')?.answer).toBe(fact);
  });
});
