// ═══════════════════════════════════════════════════════════════════════════
// System Config — utility facts and disconnecting means (`systemConfigUtilityDisconnects.ts`).
//
// The Service Topology inspector's "INTERCONNECTION AND THE FOUR DISCONNECT ROLES", as questions:
//   · Meter collar permitted — a three-state utility / AHJ ruling. A collar is never offered where
//     prohibited and never 'answered' while permission is not established.
//   · The four disconnect roles — asked only where the role can exist; the requirement is the
//     engine's or "rating not established", never the seeded service rating; the part is the part.
//   · More than one gateway ⇒ MANUFACTURER DOCUMENT REQUIRED, owned by the manufacturer.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildSystemConfigInterview, type InterviewEquipment, type InterviewInput,
} from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerInterconnection, answerIsolationRequired, answerBackup, answerAvailableFaultCurrent,
} from '@/lib/electrical/systemConfigAnswers';
import {
  METER_COLLAR_ITEM_ID, MULTI_GATEWAY_DOC_ITEM_ID, disconnectItemId, describeDisconnect,
  answerMeterCollarPermitted, answerAddDisconnect, answerRemoveDisconnect,
  answerDisconnectPlacement, answerDisconnectPart, disconnectPlacements,
} from '@/lib/electrical/systemConfigUtilityDisconnects';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { buildServiceOverview } from '@/lib/electrical/topologyOverview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const MICROS: InterviewEquipment = {
  pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null,
};
const PW3: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const base = (over: Partial<InterviewInput>): InterviewInput => ({
  pvArray: pv20, topology: null, coupling: null, couplingIsDecision: false,
  architectureConflict: false, equipment: MICROS, evaluation: null, derivedStrings: null, ...over,
});
const interview = (t: ServiceTopology, over: Partial<InterviewInput> = {}) =>
  buildSystemConfigInterview(base({ topology: t, evaluation: evaluateServiceTopology(t), ...over }));
const all = (iv: ReturnType<typeof buildSystemConfigInterview>) => iv.sections.flatMap(s => s.items);
const item = (iv: ReturnType<typeof buildSystemConfigInterview>, id: string) => all(iv).find(i => i.id === id);
const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};
const house200 = () => ok(answerServiceRating(null, 200));
const rays = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });
const raysInterview = (t: ServiceTopology) => interview(t, {
  pvArray: pv37, coupling: 'dc-coupled-storage', couplingIsDecision: true, equipment: PW3,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('meter collar — a utility / AHJ ruling, three states, never assumed', () => {
  it('asked while the connection is open, owned by the utility / AHJ, and NOT an open question for the installer', () => {
    const iv = interview(house200());
    const q = item(iv, METER_COLLAR_ITEM_ID);
    expect(q?.section).toBe('behavior');
    expect(q?.state).toBe('needs-verification');
    expect(q?.answer, 'nothing is recorded, so nothing is stated as the answer').toBeUndefined();
    expect(q?.owner).toBe('Utility / AHJ');
    expect(q?.options?.map(o => o.value)).toEqual(['permitted', 'not-permitted', 'unknown']);
    // A ruling is owed by the utility, not answered by the installer: the release banner's open
    // questions are unchanged.
    expect(iv.openQuestions.map(o => o.id)).toEqual(['behavior.interconnection', 'behavior.isolation']);
  });

  it('not asked once the system connects some other way and nobody recorded a ruling', () => {
    const t = ok(answerInterconnection(house200(), 'load-side-busbar'));
    expect(item(interview(t), METER_COLLAR_ITEM_ID)).toBeUndefined();
  });

  it('not asked where there is nothing to connect', () => {
    const iv = interview(house200(), { pvArray: resolvePvArrayDesign({ placedModuleCount: 0, selectedPanelId: 'panel-std440' }) });
    expect(item(iv, METER_COLLAR_ITEM_ID)).toBeUndefined();
  });

  it('recorded as NOT permitted: answered, never offered, and refused if chosen', () => {
    const t = ok(answerMeterCollarPermitted(house200(), false));
    expect(t.interconnection.meterCollarPermitted).toBe(false);
    const iv = interview(t);
    expect(item(iv, METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'answered', answer: 'Not permitted', source: 'Installer entered' });
    expect(item(iv, 'behavior.interconnection')?.options?.map(o => o.value)).not.toContain('meter-collar');
    expect(answerInterconnection(t, 'meter-collar').ok).toBe(false);
  });

  it('🚨 a collar chosen while permission is NOT ESTABLISHED reads needs-verification — never answered', () => {
    const iv0 = interview(house200());
    const offer = item(iv0, 'behavior.interconnection')?.options?.find(o => o.value === 'meter-collar');
    expect(offer?.detail, 'the collar was offered without saying permission is not established').toMatch(/NEEDS VERIFICATION/);
    const t = ok(answerInterconnection(house200(), 'meter-collar'));
    const iv = interview(t);
    const ic = item(iv, 'behavior.interconnection');
    expect(ic?.state, 'a collar nobody has permitted was presented as an answered connection').toBe('needs-verification');
    expect(ic?.answer).toBe('Meter collar adapter — utility / AHJ permission not established');
    expect(ic?.source).toBe('Utility / AHJ ruling required');
    expect(item(iv, METER_COLLAR_ITEM_ID)?.blocks).toContain('meter-collar connection');
  });

  it('permitted ⇒ the collar is an answered connection, with no caveat on the option', () => {
    const t = ok(answerInterconnection(ok(answerMeterCollarPermitted(house200(), true)), 'meter-collar'));
    const iv = interview(t);
    expect(item(iv, 'behavior.interconnection')).toMatchObject({ state: 'answered', answer: 'Meter collar adapter' });
    expect(item(iv, METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'answered', value: 'permitted' });
    expect(item(iv, 'behavior.interconnection')?.options?.find(o => o.value === 'meter-collar')?.detail).toBeUndefined();
  });

  it('recording NOT permitted withdraws a chosen collar (flag and points) — the connection is asked again, nothing chosen in its place', () => {
    const chosen = ok(answerInterconnection(house200(), 'meter-collar'));
    expect(chosen.pointsOfInterconnection.every(p => p.relationship === 'meter-collar')).toBe(true);
    const r = answerMeterCollarPermitted(chosen, false);
    const t = ok(r);
    expect(r.ok && r.did).toMatch(/withdrawn/);
    expect(t.interconnection.meterCollarSelected).toBe(false);
    expect(t.pointsOfInterconnection.map(p => p.relationship)).toEqual(['unresolved']);
    const iv = interview(t);
    expect(item(iv, 'behavior.interconnection')?.state).toBe('needs-answer');
    expect(evaluateServiceTopology(t).checks.filter(c => c.conclusion === 'FAIL').map(c => c.id))
      .not.toContain('poi.relationship');
  });

  it('a collar written elsewhere under a prohibition FAILS — it is not shown as an answered connection', () => {
    const t = ok(answerInterconnection(house200(), 'meter-collar'));
    t.interconnection = { ...t.interconnection, meterCollarPermitted: false };
    expect(item(interview(t), 'behavior.interconnection')).toMatchObject({
      state: 'fails', answer: 'Meter collar adapter — NOT PERMITTED on this project',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the four disconnecting means — asked where they can exist, keyed on what is on site', () => {
  it('the 200 A micro house is asked for its service disconnect only — no gateway, battery or isolation switch questions', () => {
    const iv = interview(house200());
    const asked = all(iv).filter(i => i.id.startsWith('engineering.disconnect.')).map(i => i.id);
    expect(asked).toEqual([disconnectItemId('service-disconnect')]);
    expect(item(iv, disconnectItemId('service-disconnect'))).toMatchObject({
      section: 'engineering', state: 'needs-answer', answer: 'None recorded',
    });
    // The engine's jargon row ("A device carrying the service-disconnect role") is replaced, not repeated.
    expect(all(iv).map(i => i.id)).not.toContain('engineering.needs.device.role:service-disconnect');
    // The engineering card's summary is still the overall verdict.
    const eng = iv.sections.find(s => s.id === 'engineering')!;
    expect(eng.items[eng.items.length - 1].id).toBe('engineering.overall');
  });

  it('🚨 the utility isolation switch follows behavior.isolation and never re-asks "is it required?"', () => {
    const t = ok(answerIsolationRequired(ok(answerInterconnection(house200(), 'load-side-busbar')), true));
    const iv = interview(t);
    const sw = item(iv, disconnectItemId('der-isolation-disconnect'));
    expect(sw?.options, 'the requirement was asked a second time').toBeUndefined();
    expect(item(iv, 'behavior.isolation')?.options?.map(o => o.value)).toEqual(['yes', 'no', 'unknown']);
    // The switch the isolation answer placed: in line ahead of the panel, so the engine has a requirement.
    expect(sw?.answer).toContain('ahead of MSP #1');
    expect(sw?.answer).toContain('requirement: 200 A — what MSP #1 carries');
    expect(sw?.answer).toContain('part not selected');
    expect(sw?.answer).toContain('SCCR not established');
    expect(sw?.state).toBe('needs-answer');
    // …and not shown at all while the utility has not required one and none exists.
    expect(item(interview(house200()), disconnectItemId('der-isolation-disconnect'))).toBeUndefined();
  });

  it('Ray’s job: every role is asked; the seeded 400 A is the PART’s recorded rating, never the requirement', () => {
    const iv = raysInterview(rays());
    const svc = item(iv, disconnectItemId('service-disconnect'));
    expect(svc?.answer).toContain('400 A service disconnect — on the service conductors');
    expect(svc?.answer).toContain('requirement: rating not established');
    expect(svc?.answer).toContain('recorded rating 400 A — not from a part');
    expect(svc?.answer).not.toMatch(/requirement: 400 A/);
    // The per-path switches: the engine's requirement is the path they are in line with.
    const iso = item(iv, disconnectItemId('der-isolation-disconnect'));
    expect(iso?.answer).toContain('ahead of Tesla Backup Gateway 3 (System 1)');
    expect(iso?.answer).toMatch(/requirement: 200 A — what Tesla Backup Gateway 3 carries/);
    // Gateway isolation: optional, none in the design — stated, not demanded.
    expect(item(iv, disconnectItemId('gateway-isolation'))).toMatchObject({ state: 'answered' });
    // Battery disconnect: SolarPro does not decide it, and does not assume the answer is no.
    expect(item(iv, disconnectItemId('ess-disconnect'))).toMatchObject({
      state: 'needs-verification', answer: 'None recorded — NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED',
    });
  });

  it('capability, not brand: a battery disconnect is asked when storage is selected, never without storage', () => {
    expect(item(interview(house200(), { equipment: { ...MICROS, storage: { label: 'Any battery', count: 1,
      pvInput: false, backupCapable: false, requiresGateway: false } } }), disconnectItemId('ess-disconnect'))).toBeDefined();
    expect(item(interview(house200()), disconnectItemId('ess-disconnect'))).toBeUndefined();
    expect(item(interview(house200()), disconnectItemId('gateway-isolation'))).toBeUndefined();
  });

  it('🚨 a device added here carries NO rating — the service rating is not seeded and not presented as a requirement', () => {
    const t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const d = t.devices.find(x => x.roles.includes('service-disconnect'))!;
    expect(d.ratedAmps, 'the service rating was seeded onto the device as if somebody had read it').toBeNull();
    expect(d).toMatchObject({ label: 'Service disconnect', lockableOpen: true, sccrA: null });
    const f = describeDisconnect(t, d);
    expect(f.requirement).toBe('rating not established');
    expect(f.rating).toBe('part rating not stated');
    expect(f.sccr).toBe('SCCR not established');
    // A second one gets its own label — the engine titles its per-device checks by label.
    const two = ok(answerAddDisconnect(t, 'service-disconnect'));
    expect(two.devices.map(x => x.label)).toEqual(['Service disconnect', 'Service disconnect 2']);
  });

  it('placement is the inspector’s two writes: in line ahead of a gateway takes that system’s feed', () => {
    let t = ok(answerAddDisconnect(rays(), 'gateway-isolation'));
    const id = t.devices[t.devices.length - 1].id;
    expect(disconnectPlacements(t).map(p => p.value)).toEqual(['', 'domain-a-gateway', 'domain-b-gateway', 'msp-1', 'msp-2']);
    t = ok(answerDisconnectPlacement(t, id, 'domain-b-gateway'));
    expect(t.devices.find(d => d.id === id)).toMatchObject({ inlineOnNodeId: 'domain-b-gateway', feedsNodeId: 'branch-b' });
    t = ok(answerDisconnectPlacement(t, id, null));
    expect(t.devices.find(d => d.id === id)).toMatchObject({ inlineOnNodeId: null, feedsNodeId: null });
    expect(answerDisconnectPlacement(t, id, 'not-a-node').ok).toBe(false);
    expect(answerDisconnectPlacement(t, 'no-such-device', null).ok).toBe(false);
  });

  it('the part, its rating and its SCCR are recorded as stated; blank is not stated, zero is refused', () => {
    let t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const id = t.devices[0].id;
    expect(answerDisconnectPart(t, id, { ratedAmps: 0 }).ok).toBe(false);
    expect(answerDisconnectPart(t, id, { sccrA: -1 }).ok).toBe(false);
    t = ok(answerDisconnectPart(t, id, { productId: '  DU224RB ', ratedAmps: 200, sccrA: 22000 }));
    expect(t.devices[0]).toMatchObject({ productId: 'DU224RB', ratedAmps: 200, sccrA: 22000 });
    let iv = interview(t);
    expect(item(iv, disconnectItemId('service-disconnect'))).toMatchObject({ state: 'answered' });
    expect(item(iv, disconnectItemId('service-disconnect'))?.answer).toContain('part DU224RB · rated 200 A · 22000 A SCCR');
    // Clearing the part clears what was read off it: the 200 A was DU224RB's, not the device's.
    t = ok(answerDisconnectPart(t, id, { sccrA: null, productId: '' }));
    expect(t.devices[0]).toMatchObject({ sccrA: null, ratedAmps: null });
    expect(t.devices[0].productId ?? null).toBeNull();
    iv = interview(t);
    expect(item(iv, disconnectItemId('service-disconnect'))?.state).toBe('needs-answer');
  });

  it('the engine’s verdict is read, not recomputed: a 100 A part in line ahead of a 200 A panel FAILS', () => {
    let t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const id = t.devices[0].id;
    t = ok(answerDisconnectPlacement(t, id, t.panels[0].id));
    t = ok(answerDisconnectPart(t, id, { productId: 'X', ratedAmps: 100, sccrA: 10000 }));
    const sd = item(interview(t), disconnectItemId('service-disconnect'));
    expect(sd?.state).toBe('fails');
    expect(sd?.answer).toContain('requirement: 200 A — what MSP #1 carries');
    // Without the engine's evaluation, no verdict is invented.
    expect(item(buildSystemConfigInterview(base({ topology: t })), disconnectItemId('service-disconnect'))?.state)
      .not.toBe('fails');
  });

  it('refusals: no gateway to isolate; no such device', () => {
    expect(answerAddDisconnect(house200(), 'gateway-isolation').ok).toBe(false);
    expect(answerRemoveDisconnect(house200(), 'nope').ok).toBe(false);
    const t = ok(answerAddDisconnect(house200(), 'ess-disconnect'));
    expect(ok(answerRemoveDisconnect(t, t.devices[0].id)).devices).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('more than one gateway on one service — MANUFACTURER DOCUMENT REQUIRED', () => {
  it('Ray’s two gateways: an engineering item owned by the manufacturer, asked once', () => {
    const iv = raysInterview(rays());
    const doc = item(iv, MULTI_GATEWAY_DOC_ITEM_ID);
    expect(doc?.section).toBe('engineering');
    expect(doc?.state).toBe('needs-verification');
    expect(doc?.answer).toMatch(/^MANUFACTURER DOCUMENT REQUIRED — Multiple Backup Gateways on a Single Site/);
    expect(doc?.owner).toMatch(/^Manufacturer/);
    expect(doc?.blocks).toContain('CT assignment');
    expect(all(iv).filter(i => i.id.startsWith('engineering.needs.manufacturer-document:Multiple Backup')),
      'the same document was asked for twice').toHaveLength(0);
  });

  it('one gateway ⇒ not asked; the document registered ⇒ answered', () => {
    const one = ok(answerBackup(house200(), 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 1,
    }));
    expect(item(interview(one, { equipment: PW3 }), MULTI_GATEWAY_DOC_ITEM_ID)).toBeUndefined();
    const t = rays();
    t.interconnection = { ...t.interconnection,
      multiGatewayMeteringDoc: { ...t.interconnection.multiGatewayMeteringDoc!, present: true } };
    expect(item(raysInterview(t), MULTI_GATEWAY_DOC_ITEM_ID)?.state).toBe('answered');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Review findings — each test here was RED against the slice as first written.
// ═══════════════════════════════════════════════════════════════════════════
const inlineChecks = (t: ServiceTopology) => evaluateServiceTopology(t).checks.filter(c => c.id === 'device.inline-rating');
const isoSwitch = (t: ServiceTopology) => t.devices.find(d => d.roles.includes('der-isolation-disconnect'))!;
const isolatedHouse = () => ok(answerIsolationRequired(ok(answerInterconnection(house200(), 'load-side-busbar')), true));

describe('🚨 a rating nobody read off the part never becomes the part’s rating', () => {
  it('(a) 200 A house, isolation required: typing part DU30 + SCCR with no rating does NOT keep the seeded 200 A', () => {
    const t0 = isolatedHouse();
    expect(isoSwitch(t0).ratedAmps, 'precondition: the isolation arrangement seeds the path rating').toBe(200);
    const t = ok(answerDisconnectPart(t0, isoSwitch(t0).id, { productId: 'DU30', sccrA: 10000 }));
    expect(isoSwitch(t)).toMatchObject({ productId: 'DU30', ratedAmps: null, sccrA: 10000 });
    const sw = item(interview(t), disconnectItemId('der-isolation-disconnect'));
    expect(sw?.answer).toContain('part DU30 · part rating not stated');
    expect(sw?.answer).not.toMatch(/rated 200 A/);
    expect(sw?.state, 'a part with no stated rating was presented as answered').not.toBe('answered');
    const c = inlineChecks(t).find(x => x.title.startsWith(isoSwitch(t).label));
    expect(c?.conclusion, 'the in-line rating passed against a copy of the path rating').toBe('NOT_EVALUATED');
    expect(c?.requires).toEqual(['device.ratedAmps']);
  });

  it('(b) Ray’s job: the seeded 400 A on the service disconnect is not the rating of part ABC123', () => {
    const t = ok(answerDisconnectPart(rays(), 'svc-disco', { productId: 'ABC123' }));
    expect(t.devices.find(d => d.id === 'svc-disco')).toMatchObject({ productId: 'ABC123', ratedAmps: null, sccrA: null });
    const svc = item(raysInterview(t), disconnectItemId('service-disconnect'));
    expect(svc?.answer).toContain('part ABC123 · part rating not stated');
    expect(svc?.answer).not.toMatch(/rated 400 A/);
  });

  it('(c) a part changed from BIG-200 to SMALL-60 does not keep BIG-200’s 200 A / 22000 A', () => {
    let t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const id = t.devices[0].id;
    t = ok(answerDisconnectPlacement(t, id, t.panels[0].id));
    t = ok(answerDisconnectPart(t, id, { productId: 'BIG-200', ratedAmps: 200, sccrA: 22000 }));
    // The same part re-sent is not a change: nothing is reset.
    expect(ok(answerDisconnectPart(t, id, { productId: 'BIG-200' })).devices[0]).toMatchObject({ ratedAmps: 200, sccrA: 22000 });
    t = ok(answerDisconnectPart(t, id, { productId: 'SMALL-60' }));
    expect(t.devices[0]).toMatchObject({ productId: 'SMALL-60', ratedAmps: null, sccrA: null });
    expect(inlineChecks(t)[0]?.conclusion).toBe('NOT_EVALUATED');
    // A rating stated WITH the new part is the new part's.
    t = ok(answerDisconnectPart(t, id, { productId: 'MID-100', ratedAmps: 100 }));
    expect(t.devices[0]).toMatchObject({ productId: 'MID-100', ratedAmps: 100, sccrA: null });
  });

  it('a number recorded with no part reads as recorded, not as a part’s — rating and SCCR alike', () => {
    const t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const d = { ...t.devices[0], ratedAmps: 200, sccrA: 10000 };
    const f = describeDisconnect(t, d);
    expect(f.rating).toBe('recorded rating 200 A — not from a part');
    expect(f.sccr).toBe('recorded SCCR 10000 A — not from a part');
  });
});

describe('🚨 each device gets its own engine verdict — never a namesake’s', () => {
  it('two devices labelled alike, the second too small: the FAIL is not hidden behind the first one’s PASS', () => {
    const t0 = house200();
    const dev = (id: string, ratedAmps: number) => ({
      id, label: 'Main disconnect', roles: ['service-disconnect' as const], ratedAmps, sccrA: 22000,
      lockableOpen: true, visibleOpen: true, productId: `P-${ratedAmps}`, inlineOnNodeId: t0.panels[0].id,
    });
    const t: ServiceTopology = { ...t0, devices: [dev('dev-big', 200), dev('dev-small', 100)] };
    const ev = evaluateServiceTopology(t);
    expect(ev.checks.filter(c => c.id === 'device.inline-rating').map(c => [c.scope, c.conclusion]))
      .toEqual([['device:dev-big', 'PASS'], ['device:dev-small', 'FAIL']]);
    expect(describeDisconnect(t, t.devices[0], ev).verdict).toBe('PASS');
    expect(describeDisconnect(t, t.devices[1], ev).verdict).toBe('FAIL');
    const sd = item(interview(t), disconnectItemId('service-disconnect'));
    expect(sd?.state, 'a failing device was read as its namesake’s PASS').toBe('fails');
    expect(sd?.answer).toMatch(/P-100 · rated 100 A · 22000 A SCCR · FAILS/);
  });

  it('scoping the check to its device changes nothing the overview reports: same inputs, same order, same reasons', () => {
    let t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    t = ok(answerDisconnectPlacement(t, t.devices[0].id, t.panels[0].id));
    const ev = evaluateServiceTopology(t);
    expect(ev.checks.some(c => c.scope.startsWith('device:') && c.conclusion === 'NOT_EVALUATED'), 'precondition').toBe(true);
    const asSite = { ...ev, checks: ev.checks.map(c => (c.scope.startsWith('device:') ? { ...c, scope: 'site' } : c)) };
    const strip = (o: ReturnType<typeof buildServiceOverview>) => o.requiredInputs.map(r => [r.key, r.because, r.owner]);
    expect(strip(buildServiceOverview(t, ev))).toEqual(strip(buildServiceOverview(t, asSite)));
  });
});

describe('🚨 an SCCR below the available fault current FAILS the disconnect item', () => {
  it('service disconnect: sccr.chain names it ⇒ fails, and says why in installer words', () => {
    let t = ok(answerAvailableFaultCurrent(ok(answerAddDisconnect(house200(), 'service-disconnect')), 22000));
    t = ok(answerDisconnectPart(t, t.devices[0].id, { productId: 'DU224RB', ratedAmps: 200, sccrA: 10000 }));
    expect(evaluateServiceTopology(t).checks.find(c => c.id === 'sccr.chain')?.conclusion).toBe('FAIL');
    const sd = item(interview(t), disconnectItemId('service-disconnect'));
    expect(sd?.state).toBe('fails');
    expect(sd?.answer).toContain('SCCR below the available fault current');
    // At or above the available fault current: this device is not failed by the chain.
    const fine = ok(answerDisconnectPart(t, t.devices[0].id, { sccrA: 22000 }));
    expect(item(interview(fine), disconnectItemId('service-disconnect'))?.answer).not.toContain('SCCR below');
  });

  it('another device’s low SCCR does not fail this one — not even a device whose label contains this one’s', () => {
    let t = ok(answerAvailableFaultCurrent(ok(answerAddDisconnect(house200(), 'service-disconnect')), 22000));
    t = ok(answerAddDisconnect(t, 'service-disconnect'));
    t = ok(answerDisconnectPart(t, t.devices[0].id, { productId: 'A', ratedAmps: 200, sccrA: 22000 }));
    t = ok(answerDisconnectPart(t, t.devices[1].id, { productId: 'B', ratedAmps: 200, sccrA: 10000 }));
    expect(t.devices.map(d => d.label)).toEqual(['Service disconnect', 'Service disconnect 2']);
    const ev = evaluateServiceTopology(t);
    expect(ev.checks.find(c => c.id === 'sccr.chain')?.detail).toMatch(/^Service disconnect 2 \(10000 A\)/);
    const sd = item(interview(t), disconnectItemId('service-disconnect'));
    expect(sd?.state).toBe('fails');
    const lines = sd!.answer!.split(' | ');
    expect(lines[0]).not.toContain('SCCR below');
    expect(lines[1]).toContain('SCCR below the available fault current');
  });

  it('utility isolation switch: the interconnection.der-isolation FAIL that names it is read', () => {
    let t = ok(answerAvailableFaultCurrent(isolatedHouse(), 22000));
    t = ok(answerDisconnectPart(t, isoSwitch(t).id, { productId: 'DU30', ratedAmps: 200, sccrA: 10000 }));
    const ev = evaluateServiceTopology(t);
    expect(ev.checks.find(c => c.id === 'interconnection.der-isolation')?.conclusion).toBe('FAIL');
    // Read on its own: the chain check withheld, the isolation check still fails the switch.
    const onlyIso = { ...ev, checks: ev.checks.filter(c => c.id !== 'sccr.chain') };
    const sw = item(buildSystemConfigInterview(base({ topology: t, evaluation: onlyIso })), disconnectItemId('der-isolation-disconnect'));
    expect(sw?.state).toBe('fails');
    expect(sw?.answer).toContain('SCCR below the available fault current');
  });
});

describe('claims the slice made, now held by a test', () => {
  it('a part with no SCCR, or a requirement nobody established, is NEEDS VERIFICATION — not answered', () => {
    let t = ok(answerAddDisconnect(house200(), 'service-disconnect'));
    const id = t.devices[0].id;
    t = ok(answerDisconnectPart(t, id, { productId: 'DU224RB', ratedAmps: 200 }));
    expect(item(interview(t), disconnectItemId('service-disconnect'))?.state, 'no SCCR').toBe('needs-verification');
    // In line ahead of a panel whose rating nobody has stated: the requirement is open.
    let open = ok(answerDisconnectPart(t, id, { sccrA: 22000 }));
    open = ok(answerDisconnectPlacement(open, id, open.panels[0].id));
    open = { ...open, panels: open.panels.map(p => ({ ...p, mainBreakerA: null, busbarRatingA: null })) };
    expect(describeDisconnect(open, open.devices[0]).requirementOpen).toBe(true);
    expect(item(interview(open), disconnectItemId('service-disconnect'))?.state, 'requirement open').toBe('needs-verification');
  });

  it('asked once: the engine’s device.* and sccr:<device> rows give way when every device is listed under a role', () => {
    let t = ok(answerAvailableFaultCurrent(ok(answerAddDisconnect(house200(), 'service-disconnect')), 22000));
    const id = t.devices[0].id;
    t = ok(answerDisconnectPlacement(t, id, t.panels[0].id));
    const ev = evaluateServiceTopology(t);
    const keys = buildServiceOverview(t, ev).requiredInputs.map(r => r.key);
    const superseded = ['device.productId', 'device.ratedAmps', `sccr:${id}`];
    for (const k of superseded) expect(keys, `precondition: the engine asks for ${k}`).toContain(k);
    const ids = all(interview(t)).map(i => i.id);
    for (const k of superseded) expect(ids, `${k} was asked twice`).not.toContain(`engineering.needs.${k}`);
    // A device under no role is not listed here — its rows stay.
    const roleless: ServiceTopology = { ...t, devices: [...t.devices, { ...t.devices[0], id: 'loose', label: 'Loose switch', roles: [] }] };
    expect(all(interview(roleless)).map(i => i.id)).toContain('engineering.needs.device.productId');
  });

  it('asked once: a collar chosen with permission NOT ESTABLISHED drops the engine’s meterCollarPermitted row', () => {
    const t = ok(answerInterconnection(house200(), 'meter-collar'));
    const ev = evaluateServiceTopology(t);
    expect(buildServiceOverview(t, ev).requiredInputs.map(r => r.key), 'precondition').toContain('interconnection.meterCollarPermitted');
    const ids = all(interview(t)).map(i => i.id);
    expect(ids).toContain(METER_COLLAR_ITEM_ID);
    expect(ids).not.toContain('engineering.needs.interconnection.meterCollarPermitted');
  });

  it('a recorded ruling stays visible after the system connects some other way', () => {
    const t = ok(answerInterconnection(ok(answerMeterCollarPermitted(house200(), true)), 'load-side-busbar'));
    expect(item(interview(t), METER_COLLAR_ITEM_ID)).toMatchObject({ state: 'answered', value: 'permitted' });
  });
});

describe('nits: what an empty answer says', () => {
  it('a ruling not established leaves the answer empty — the Behavior card summary does not read "Not established"', () => {
    const iv = interview(house200());
    expect(item(iv, METER_COLLAR_ITEM_ID)?.answer).toBeUndefined();
    expect(iv.sections.find(s => s.id === 'behavior')?.summary).not.toMatch(/Not established/);
  });

  it('a collar under a RECORDED prohibition is sourced as entered — the ruling exists', () => {
    const t = ok(answerInterconnection(house200(), 'meter-collar'));
    t.interconnection = { ...t.interconnection, meterCollarPermitted: false };
    expect(item(interview(t), 'behavior.interconnection')?.source).toBe('Installer entered');
  });

  it('no battery disconnect recorded reads NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED', () => {
    expect(item(raysInterview(rays()), disconnectItemId('ess-disconnect'))?.answer)
      .toContain('NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED');
  });
});
