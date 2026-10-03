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
  answerServiceRating, answerInterconnection, answerIsolationRequired, answerBackup,
} from '@/lib/electrical/systemConfigAnswers';
import {
  METER_COLLAR_ITEM_ID, MULTI_GATEWAY_DOC_ITEM_ID, disconnectItemId, describeDisconnect,
  answerMeterCollarPermitted, answerAddDisconnect, answerRemoveDisconnect,
  answerDisconnectPlacement, answerDisconnectPart, disconnectPlacements,
} from '@/lib/electrical/systemConfigUtilityDisconnects';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
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
    expect(q?.answer).toBe('Not established');
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
    expect(svc?.answer).toContain('recorded rating 400 A — no part chosen');
    expect(svc?.answer).not.toMatch(/requirement: 400 A/);
    // The per-path switches: the engine's requirement is the path they are in line with.
    const iso = item(iv, disconnectItemId('der-isolation-disconnect'));
    expect(iso?.answer).toContain('ahead of Tesla Backup Gateway 3 (System 1)');
    expect(iso?.answer).toMatch(/requirement: 200 A — what Tesla Backup Gateway 3 carries/);
    // Gateway isolation: optional, none in the design — stated, not demanded.
    expect(item(iv, disconnectItemId('gateway-isolation'))).toMatchObject({ state: 'answered' });
    // Battery disconnect: SolarPro does not decide it, and does not assume the answer is no.
    expect(item(iv, disconnectItemId('ess-disconnect'))).toMatchObject({
      state: 'needs-verification', answer: 'None recorded — NOT EVALUATED',
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
    t = ok(answerDisconnectPart(t, id, { sccrA: null, productId: '' }));
    expect(t.devices[0]).toMatchObject({ sccrA: null, ratedAmps: 200 });
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
