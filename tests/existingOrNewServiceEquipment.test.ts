// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EXISTING OR NEW SERVICE EQUIPMENT — THREE ANSWERS: UNANSWERED / EXISTING / NEW.
//
// Ray (engineering closure, §4): "Currently 'Existing or new equipment — not answered yet' cannot be
// persisted (`parseExistingEquipment` collapses absent and null to null; the interview then reports
// an unset answer as 'New service equipment … Installer entered'). Close this. If UNANSWERED is a
// legitimate semantic state, the persistence layer must preserve it. Do not force existing or new
// merely because the database cannot represent unanswered. Same class of defect as the earlier
// `None` PV inverter. Preserve UNANSWERED / EXISTING / NEW distinctly."
//
// The chain, each link below: writer (systemConfigAnswers / topologyAuthoring) → stored shape
// (lib/db parse, incl. legacy rows) → engine (`service.existing-equipment`) → interview + readiness
// → overview labels → permit requirement lines → SLD text → BOM.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  evaluateServiceTopology, serviceExistingOrNew, existingServiceReading, EXISTING_OR_NEW_TOKEN,
  BLANK_EXISTING_SERVICE_EQUIPMENT, type ExistingOrNew, type ServiceTopology,
} from '@/lib/electrical/serviceTopology';
import { hasItemEditor } from '@/components/engineering/systemConfig/ItemEditor';
import {
  createServiceTopology, setExistingServiceEquipment, setServiceExistingOrNew,
} from '@/lib/electrical/topologyAuthoring';
import {
  answerServiceRating, answerDistribution, answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { parseServiceTopology, serialiseServiceTopology, SERVICE_TOPOLOGY_SCHEMA_VERSION } from '@/lib/db/serviceTopology';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import {
  requiredQueue, findInterviewItem, homeOf, nextActionLabel, EXISTING_OR_NEW_NEED,
} from '@/lib/electrical/systemConfigPlacement';
import { buildServiceOverview, labelForToken } from '@/lib/electrical/topologyOverview';
import { serviceTopologyReleaseReadiness } from '@/lib/permit/utils/serviceTopologySchedule';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { bomFromServiceTopology } from '@/lib/bom/topologyBom';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const house200 = () => ok(answerServiceRating(null, 200));
const as = (t: ServiceTopology, a: ExistingOrNew) => setServiceExistingOrNew(t, a);

/** Exactly what the PUT route stores and the GET route reads: serialise → JSON → parse. */
const roundTrip = (t: ServiceTopology) =>
  parseServiceTopology(JSON.parse(JSON.stringify(serialiseServiceTopology(t))), 'as-sent')!.topology;
/** A stored row exactly as it sits in `projects.service_topology`, service object hand-written. */
const storedRow = (service: Record<string, unknown>, schemaVersion = 4) => {
  const t = house200();
  return { schemaVersion, updatedAt: '2026-09-01T00:00:00Z', topology: { ...t, service } };
};
const legacyService = { ratedAmps: 200, voltage: 240, phase: 'split-240', availableFaultCurrentA: null };
const existingCheck = (t: ServiceTopology) =>
  evaluateServiceTopology(t).checks.find(c => c.id === 'service.existing-equipment');

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const interviewOf = (t: ServiceTopology) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: evaluateServiceTopology(t),
});

// ── The writers ─────────────────────────────────────────────────────────────

describe('the writers record each answer as itself', () => {
  it('a new graph has NOT answered — it is not "new"', () => {
    expect(createServiceTopology({ ratedAmps: 200 }).service.existingOrNew).toBe('unanswered');
    expect(serviceExistingOrNew(house200().service)).toBe('unanswered');
  });

  it('answerExistingService: true ⇒ existing (blank reading), false ⇒ new, null ⇒ not answered', () => {
    const existing = ok(answerExistingService(house200(), { existing: true }));
    expect(existing.service.existingOrNew).toBe('existing');
    expect(existing.service.existingEquipment).toEqual({
      manufacturer: null, catalogNumber: null, mainArrangement: null, feederArrangement: null, sccrA: null, verified: false,
    });
    const fresh = ok(answerExistingService(existing, { existing: false }));
    expect([fresh.service.existingOrNew, fresh.service.existingEquipment]).toEqual(['new', null]);
    const back = answerExistingService(fresh, { existing: null });
    expect(back.ok && back.did).toBe('Service equipment: existing or new not answered');
    expect([ok(back).service.existingOrNew, ok(back).service.existingEquipment]).toEqual(['unanswered', null]);
  });

  it('🚨 taking a READ assembly back to "not answered" discards the reading — it never survives under another answer', () => {
    const read = ok(answerExistingService(house200(), { existing: true, manufacturer: 'Eaton', sccrA: 22_000 }));
    for (const a of ['unanswered', 'new'] as const) {
      const t = as(read, a);
      expect(t.service.existingEquipment).toBeNull();
      expect(serviceExistingOrNew(t.service)).toBe(a);
    }
    // …and declaring it existing again starts from what is still on the graph (nothing, here).
    expect(as(as(read, 'new'), 'existing').service.existingEquipment?.manufacturer).toBeNull();
  });

  it('setExistingServiceEquipment: null is "new" (an answer), a patch is "existing"', () => {
    expect(setExistingServiceEquipment(house200(), null).service.existingOrNew).toBe('new');
    expect(setExistingServiceEquipment(house200(), { manufacturer: 'Eaton' }).service.existingOrNew).toBe('existing');
  });

  it('🚨 rebuilding the distribution carries the ANSWER — "new" and "not answered" do not swap', () => {
    for (const a of ['unanswered', 'existing', 'new'] as const) {
      const t = ok(answerDistribution(as(ok(answerServiceRating(null, 400)), a), 'two-main-panels'));
      expect(serviceExistingOrNew(t.service), a).toBe(a);
    }
  });
});

// ── The stored shape ────────────────────────────────────────────────────────

describe('🚨 the stored graph reads back UNANSWERED / EXISTING / NEW distinctly', () => {
  it('each answer survives serialise → JSON → parse as itself', () => {
    const read = ok(answerExistingService(house200(), { existing: true, manufacturer: 'Eaton', catalogNumber: 'CH42B200' }));
    expect(roundTrip(house200()).service).toMatchObject({ existingOrNew: 'unanswered', existingEquipment: null });
    expect(roundTrip(as(house200(), 'new')).service).toMatchObject({ existingOrNew: 'new', existingEquipment: null });
    expect(roundTrip(read).service).toMatchObject({
      existingOrNew: 'existing', existingEquipment: { manufacturer: 'Eaton', catalogNumber: 'CH42B200', verified: false },
    });
    expect(SERVICE_TOPOLOGY_SCHEMA_VERSION).toBe(5);
  });

  it('🚨 legacy rows: a null or absent reading is UNANSWERED — the bytes cannot prove "new"', () => {
    // Since schema 3 the write path stored the PARSED graph, and the old parse emitted `null` for an
    // absent field — so "the installer chose new" and "nobody asked" are the same bytes on these rows.
    const nullRow = parseServiceTopology(storedRow({ ...legacyService, existingEquipment: null }), 'as-sent')!;
    const absentRow = parseServiceTopology(storedRow({ ...legacyService }), 'as-sent')!;
    for (const r of [nullRow, absentRow]) {
      expect(r.topology.service.existingOrNew).toBe('unanswered');
      expect(r.topology.service.existingEquipment).toBeNull();
    }
  });

  it('legacy rows: a stored reading is EXISTING, every field kept', () => {
    const r = parseServiceTopology(storedRow({
      ...legacyService, existingEquipment: { manufacturer: 'Eaton', catalogNumber: null, verified: false },
    }), 'as-sent')!;
    expect(r.topology.service.existingOrNew).toBe('existing');
    expect(r.topology.service.existingEquipment).toMatchObject({ manufacturer: 'Eaton', verified: false });
  });

  it('explicit answers are read as stated; a contradiction keeps the reading; an unknown word is not an answer', () => {
    const read = (service: Record<string, unknown>) =>
      parseServiceTopology(storedRow({ ...legacyService, ...service }, 5), 'as-sent')!.topology.service;
    expect(read({ existingOrNew: 'new', existingEquipment: null })).toMatchObject({ existingOrNew: 'new', existingEquipment: null });
    expect(read({ existingOrNew: 'unanswered' })).toMatchObject({ existingOrNew: 'unanswered', existingEquipment: null });
    // 'existing' with nothing read yet — a blank reading, so the engine asks for all five.
    expect(read({ existingOrNew: 'existing' }).existingEquipment).toMatchObject({ catalogNumber: null, verified: false });
    // A reading beside a "new" flag is a contradiction: the reading is never thrown away for it.
    expect(read({ existingOrNew: 'new', existingEquipment: { manufacturer: 'Eaton' } }).existingOrNew).toBe('existing');
    expect(read({ existingOrNew: 'maybe', existingEquipment: null }).existingOrNew).toBe('unanswered');
    expect(read({ existingOrNew: true }).existingOrNew).toBe('unanswered');
  });
});

// ── The engine ──────────────────────────────────────────────────────────────

describe('the engine: unanswered is NOT EVALUATED, existing asks the field verification, new asks nothing', () => {
  it('UNANSWERED: one required (non-optional) item naming the question — never silently dropped', () => {
    const c = existingCheck(house200())!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.requires).toEqual([EXISTING_OR_NEW_TOKEN]);
    expect(c.detail).toMatch(/^EXISTING OR NEW 200 A SERVICE EQUIPMENT — NOT ESTABLISHED\./);
  });

  it('EXISTING: CONFIGURATION TO VERIFY, naming all five readings', () => {
    const c = existingCheck(as(house200(), 'existing'))!;
    expect(c.detail).toContain('EXISTING 200 A SERVICE EQUIPMENT — CONFIGURATION TO VERIFY');
    expect(c.requires).toEqual([
      'service.existingEquipment.catalogNumber', 'service.existingEquipment.mainArrangement',
      'service.existingEquipment.feederArrangement', 'service.existingEquipment.sccrA',
      'service.existingEquipment.verified',
    ]);
  });

  it('NEW: nothing old to verify — no item', () => {
    expect(existingCheck(as(house200(), 'new'))).toBeUndefined();
  });

  it('🚨 an "existing" answer with no reading on it yet is verified the same way EVERYWHERE — one reading', () => {
    // A graph that says 'existing' and carries no reading (nothing has been read off it yet). The
    // engine, the interview, the question dialog and the card all read it through ONE function, so
    // none of them can treat it as "nothing to verify" while another asks for five readings.
    const t: ServiceTopology = { ...house200(), service: { ...house200().service, existingOrNew: 'existing', existingEquipment: null } };
    expect(existingServiceReading(t.service)).toEqual(BLANK_EXISTING_SERVICE_EQUIPMENT);
    expect(existingServiceReading(as(house200(), 'new').service)).toBeNull();
    expect(existingServiceReading(house200().service)).toBeNull();
    expect(existingCheck(t)?.requires).toHaveLength(5);
    expect(findInterviewItem(interviewOf(t), 'service.existing')?.state).toBe('needs-verification');
    const need = findInterviewItem(interviewOf(t), 'engineering.needs.service.existingEquipment.sccrA')!;
    expect(hasItemEditor(need, t)).toBe(true);
  });
});

// ── The interview, readiness and the overview ───────────────────────────────

describe('the interview never answers "new" for the installer', () => {
  const existingItem = (t: ServiceTopology) => findInterviewItem(interviewOf(t), 'service.existing')!;

  it('UNANSWERED: needs-answer, "Not established", no answer text, an open question that blocks release', () => {
    const iv = interviewOf(house200());
    const i = existingItem(house200());
    expect(i).toMatchObject({ state: 'needs-answer', source: 'Not established' });
    expect(i.answer).toBeUndefined();
    expect(iv.openQuestions.map(q => q.id)).toContain('service.existing');
    expect(iv.release.blockers.some(b => b.startsWith('Is this existing service equipment'))).toBe(true);
    expect(nextActionLabel(i)).toBe('Say whether the service equipment is existing or new');
  });

  it('the engine\'s need is asked ONCE — by the Service card\'s own item, homed on the Service card', () => {
    const iv = interviewOf(house200());
    expect(findInterviewItem(iv, EXISTING_OR_NEW_NEED)?.question)
      .toBe('Whether the service equipment is existing (connected to) or new');
    expect(homeOf(EXISTING_OR_NEW_NEED)).toBe('service');
    const q = requiredQueue(iv).map(i => i.id);
    expect(q).toContain('service.existing');
    expect(q).not.toContain(EXISTING_OR_NEW_NEED);
  });

  it('NEW: answered, "Installer entered", and it claims nothing about the new gear', () => {
    const i = existingItem(as(house200(), 'new'));
    expect(i).toMatchObject({ state: 'answered', source: 'Installer entered', answer: 'New service equipment' });
    expect(interviewOf(as(house200(), 'new')).openQuestions.map(q => q.id)).not.toContain('service.existing');
  });

  it('EXISTING: needs-verification until read on site; the five readings are ONE Verify action', () => {
    const t = ok(answerExistingService(house200(), { existing: true, manufacturer: 'Eaton' }));
    expect(existingItem(t)).toMatchObject({ state: 'needs-verification', answer: 'Existing Eaton equipment — configuration to verify on site' });
    const ee = requiredQueue(interviewOf(t)).filter(i => i.id.startsWith('engineering.needs.service.existingEquipment.'));
    expect(ee.map(nextActionLabel)).toEqual(['Verify the existing service equipment (5 items)']);
  });

  it('the overview names who owes it and where it is answered', () => {
    const r = buildServiceOverview(house200()).requiredInputs.find(x => x.key === EXISTING_OR_NEW_TOKEN)!;
    expect(r.owner).toBe('design-decision');
    expect(r.focus).toEqual({ kind: 'service', nodeId: 'service', field: 'existingOrNew' });
    expect(labelForToken(EXISTING_OR_NEW_TOKEN, house200())).not.toBe(EXISTING_OR_NEW_TOKEN);
    expect(buildServiceOverview(as(house200(), 'existing')).summary.serviceEquipmentIsExisting).toBe(true);
    expect(buildServiceOverview(house200()).summary.serviceExistingOrNew).toBe('unanswered');
  });
});

// ── The outputs: permit, SLD, BOM ───────────────────────────────────────────

describe('🚨 the outputs say what the installer said — and nothing they did not', () => {
  const tesla = () => buildTesla400ATwoGateway().topology;

  it('permit: UNANSWERED is a design input in its own words; EXISTING is a field verify; NEW is neither', () => {
    const req = (t: ServiceTopology) => serviceTopologyReleaseReadiness(t).requirements;
    const ASK = 'DESIGN INPUT REQUIRED — EXISTING OR NEW SERVICE EQUIPMENT NOT ESTABLISHED';
    const VERIFY = 'FIELD VERIFY — EXISTING SERVICE EQUIPMENT CONFIGURATION TO VERIFY';
    expect(req(tesla())).toContain(ASK);
    expect(req(tesla()).join(' ')).not.toMatch(/EXISTINGORNEW/i);
    expect(req(as(tesla(), 'existing'))).toContain(VERIFY);
    expect(req(as(tesla(), 'existing'))).not.toContain(ASK);
    for (const line of [ASK, VERIFY]) expect(req(as(tesla(), 'new'))).not.toContain(line);
  });

  it('SLD: amber "NOT ESTABLISHED" while unanswered, "CONFIGURATION TO VERIFY" when existing, "NEW" when new', () => {
    const svg = (t: ServiceTopology) => renderSLDProfessional({
      projectName: 'EXISTING OR NEW', clientName: 'Ray', address: 'Chicago IL', designer: 'SolarPro',
      drawingDate: '2026-10-03', drawingNumber: 'E-1', revision: 'A', scale: 'NOT TO SCALE',
      topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
      integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
      panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
      dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
      inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
      acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
      acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
      mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
      hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
      serviceTopology: t,
    } as unknown as Parameters<typeof renderSLDProfessional>[0])
      // The words on the sheet: a long line wraps onto a second <text>, so read it as text, not markup.
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const unanswered = svg(tesla());
    expect(unanswered).toContain('EXISTING OR NEW — NOT ESTABLISHED');
    expect(unanswered).not.toContain('CONFIGURATION TO VERIFY');
    expect(unanswered).not.toContain('NEW SERVICE EQUIPMENT');

    const existing = svg(ok(answerExistingService(tesla(), { existing: true, manufacturer: 'Eaton' })));
    expect(existing).toContain('EXISTING 400 A SERVICE EQUIPMENT');
    expect(existing).toContain('CONFIGURATION TO VERIFY');
    expect(existing).toContain('EXISTING — NOT IN SCOPE OF SUPPLY');
    expect(existing).not.toContain('EXISTING OR NEW — NOT ESTABLISHED');

    const fresh = svg(as(tesla(), 'new'));
    expect(fresh).toContain('NEW SERVICE EQUIPMENT');
    expect(fresh).not.toContain('CONFIGURATION TO VERIFY');
    expect(fresh).not.toContain('EXISTING OR NEW — NOT ESTABLISHED');
    expect(fresh).not.toContain('NOT IN SCOPE OF SUPPLY');
  });

  it('BOM: no answer invents service equipment to buy — the lines are the same for all three', () => {
    const lines = (t: ServiceTopology) => bomFromServiceTopology(t).items
      .map(i => `${i.partNumber}×${i.quantity}`).sort();
    const unanswered = lines(tesla());
    expect(lines(as(tesla(), 'new'))).toEqual(unanswered);
    expect(lines(as(tesla(), 'existing'))).toEqual(unanswered);
    expect(unanswered.join(' ')).not.toMatch(/panelboard|service/i);
  });
});
