// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE FULL LOAD ANALYSIS — OPTIONAL, ASKED ONCE, ENTERED PER PANELBOARD.
//
// Ray, the product decision this slice obeys (recorded on `LoadModel` in serviceTopology.ts):
//
//   "Ray is not going to verify every load in every house just to create a valid design. Full load
//    calculations remain available for users/projects that want or require them. But they are
//    optional."
//
//   "DO NOT ASK FOR THE SAME LOAD MULTIPLE TIMES. If a user chooses Full Load Analysis, one load
//    model should derive: aggregate service demand, Branch A demand, Branch B demand, backed-up load
//    per domain. Do not independently ask for four amperage values."
//
// This brings the Service Topology inspector's "Full load analysis — optional" box
// (`inspector-loads` in components/engineering/ServiceNodeInspector.tsx) into System Config as an
// installer question. It uses the inspector's own writers (`setLoadModel`, `setPanelLoad`) and the
// engine's one reader of load (`resolveDemands`). It adds no graph logic, no store and no
// calculation of its own.
//
// What it promises:
//   · ONE FIGURE PER PANELBOARD. Never per service path, never per system: those are SUMS of the
//     panelboard figures, shown by SolarPro and never typed.
//   · A PARTIAL MODEL IS NOT A SMALLER LOAD. The sums are shown only when every panelboard has a
//     figure. Until then the item says they cannot be summed. It never shows a subtotal.
//   · OPTIONAL MEANS IT NEVER HOLDS THE JOB UP. Absent, it is a known fact ("none — optional"), not
//     a question. It adds no release blocker and no needs-answer state of its own. When it is present
//     and a check reads it, the item states exactly what that check concluded.
//   · THE METHOD IS NEVER ASSUMED AND NEVER OFFERED WHERE IT CANNOT APPLY. The installer chooses it
//     when adding the analysis (the inspector, and `setPanelLoad` on its own, default to NEC 220.82).
//     A method the electrical system cannot use is not offered, and the item says why. The gate is
//     the one the engine applies (`loadMethodOutOfScope` in `evaluateServiceTopology`), and a test
//     holds the two together.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  InterviewInput, InterviewItem, InterviewOption, ItemState,
} from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import type {
  ServiceTopology, LoadCalculationMethod, ServicePhase, TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { isOptionalCheck, resolveDemands, servicePhaseInfo } from '@/lib/electrical/serviceTopology';
import { setLoadModel, setPanelLoad } from '@/lib/electrical/topologyAuthoring';

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });
const amps = (v: number) => `${v.toFixed(1)} A`;

/** The item's id. Its consumers' verdicts follow it as `engineering.loads.check.<check>.<scope>`. */
export const LOAD_ANALYSIS_ITEM_ID = 'engineering.loads';

/**
 * Every check in `evaluateServiceTopology` that reads `resolveDemands`. These are the load model's
 * consumers. A test asserts each one exists in the engine, so a rename cannot quietly hide a verdict.
 */
export const LOAD_CONSUMING_CHECK_IDS: ReadonlySet<string> = new Set([
  'load.calculation', 'service.demand', 'branch.demand', 'domain.backed-up-load',
]);

// ── The methods, and which electrical systems they apply to ─────────────────

interface LoadMethod {
  value: LoadCalculationMethod;
  label: string;
  detail: string;
}

/** Every method the store accepts (`LOAD_METHODS` in lib/db/serviceTopology.ts), as an installer reads it. */
const LOAD_METHODS: readonly LoadMethod[] = [
  { value: 'standard-220-part-iii', label: 'Standard calculation — NEC 220 Part III',
    detail: 'The general feeder and service load calculation.' },
  { value: 'optional-220-82', label: 'Optional dwelling calculation — NEC 220.82',
    detail: 'For a dwelling served at 120/240 V (NEC 220.82(A)).' },
  // NEC 220.87 sets no voltage or system limit, and the engine does not gate it, so it is offered on
  // every system. It is named for what it is: a year of the building's measured demand.
  { value: 'existing-dwelling-220-87', label: 'Existing loads — NEC 220.87 (a year of measured demand)',
    detail: 'Built from the building’s recorded maximum demand rather than an inventory of loads.' },
  { value: 'engineer-supplied', label: 'Engineer supplied',
    detail: 'A calculation an engineer ran and stands behind.' },
];

const methodLabel = (m: LoadCalculationMethod) => LOAD_METHODS.find(x => x.value === m)?.label ?? m;

/**
 * Why `method` cannot be used on this electrical system, or null when it can.
 *
 * Mirrors the engine exactly: `evaluateServiceTopology` reports an NEC 220.82 model on any system
 * other than 120/240 V split phase as CALCULATION METHOD NOT YET SUPPORTED and runs no demand check
 * from it. Offering it here would let an installer record a calculation the engineering then refuses.
 */
export function loadMethodUnavailableBecause(
  method: LoadCalculationMethod, phase: ServicePhase | string,
): string | null {
  const system = servicePhaseInfo(phase as ServicePhase);
  if (method === 'optional-220-82' && !system.residentialSplitPhase) {
    return 'NEC 220.82(A) limits the optional dwelling calculation to a dwelling served by a 120/240 V '
      + `or 208Y/120 V three-wire service. This service is ${system.label}, so SolarPro does not apply `
      + 'it here and runs no check from it.';
  }
  return null;
}

/** The methods to offer on this electrical system, and those not offered, each with its reason. */
export function loadMethodChoices(phase: ServicePhase | string): {
  available: InterviewOption[];
  unavailable: Array<InterviewOption & { why: string }>;
} {
  const available: InterviewOption[] = [];
  const unavailable: Array<InterviewOption & { why: string }> = [];
  for (const m of LOAD_METHODS) {
    const why = loadMethodUnavailableBecause(m.value, phase);
    if (why) unavailable.push({ value: m.value, label: m.label, why });
    else available.push({ value: m.value, label: m.label, detail: m.detail });
  }
  return { available, unavailable };
}

// ── What the project holds, read once ───────────────────────────────────────

export interface LoadAnalysisPicture {
  /** A load model is recorded on the graph. */
  present: boolean;
  method: LoadCalculationMethod | null;
  methodLabel: string | null;
  /** Why the recorded method does not apply to this electrical system. Null when it does. */
  methodOutOfScope: string | null;
  /** Every panelboard on the service, with its figure (null ⇒ not entered). */
  panels: Array<{ id: string; label: string; demandA: number | null }>;
  /** Panelboards with a figure. */
  entered: number;
  /** Every panelboard has a figure. The ONLY condition under which `sums` exists. */
  complete: boolean;
  /** SolarPro's sums, from `resolveDemands`. Null unless `complete`. Never a subtotal. */
  sums: null | {
    aggregateA: number;
    /** Load outside every panelboard, when one is recorded. Already inside `aggregateA`. */
    otherA: number | null;
    paths: Array<{ id: string; label: string; demandA: number | null }>;
    systems: Array<{ id: string; label: string; demandA: number | null }>;
  };
  /**
   * With no load model (or one with no figure yet), the engineering reads demand recorded directly
   * on the service, its paths or its systems. That is what `resolveDemands` calls 'recorded'.
   */
  readsRecordedDemand: boolean;
  recordedServiceA: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function describeLoadAnalysis(t: ServiceTopology): LoadAnalysisPicture {
  const loads = t.loads ?? null;
  const byPanel = new Map((loads?.byPanel ?? []).map(l => [l.panelId, l.calculatedDemandA]));
  const panels = t.panels.map(p => {
    const v = byPanel.get(p.id);
    return { id: p.id, label: p.label, demandA: finite(v) ? v : null };
  });
  const entered = panels.filter(p => p.demandA !== null).length;
  // 🚨 THE ONE GATE ON THE SUMS: every panelboard on the service has a figure.
  const everyPanelEntered = !!loads && panels.length > 0 && entered === panels.length;
  const d = resolveDemands(t);
  const sums = everyPanelEntered && d.source === 'load-model' && d.serviceA !== null
    ? {
        aggregateA: d.serviceA,
        otherA: finite(loads?.otherDemandA) ? loads!.otherDemandA as number : null,
        paths: t.branches.map(b => ({ id: b.id, label: b.label, demandA: d.branchA[b.id] ?? null })),
        systems: t.domains.map(x => ({ id: x.id, label: x.label, demandA: d.domainBackedUpA[x.id] ?? null })),
      }
    : null;
  return {
    present: !!loads,
    method: loads?.method ?? null,
    methodLabel: loads ? methodLabel(loads.method) : null,
    methodOutOfScope: loads ? loadMethodUnavailableBecause(loads.method, t.service.phase) : null,
    panels,
    entered,
    complete: sums !== null,
    sums,
    readsRecordedDemand: d.source === 'recorded',
    recordedServiceA: d.source === 'recorded' ? d.serviceA : null,
  };
}

// ── The interview items ─────────────────────────────────────────────────────

const checkState = (c: TopologyCheck): ItemState =>
  c.conclusion === 'PASS' ? 'calculated' : c.conclusion === 'FAIL' ? 'fails' : 'needs-verification';

/**
 * "Is there a full load analysis?" plus, where the engineering read figures from it, each consuming
 * check's verdict.
 *
 * Asked only once the service exists: until then there is no panelboard to enter demand against,
 * and the service rating is the question.
 */
export function buildLoadAnalysisItems(input: InterviewInput): InterviewItem[] {
  const t = input.topology;
  if (!t) return [];
  const pic = describeLoadAnalysis(t);
  const system = servicePhaseInfo(t.service.phase);
  const consuming = (input.evaluation?.checks ?? []).filter(c => LOAD_CONSUMING_CHECK_IDS.has(c.id));

  // Which verdicts to state. A FAIL is never hidden. A required check the load model has left NOT
  // EVALUATED is never hidden either (e.g. a method the system cannot use). A PASS is stated only
  // where the figures it read are whole: every panelboard entered, or demand recorded directly. An
  // optional NOT EVALUATED is the absence of an optional calculation, which is not news.
  const figuresWhole = pic.complete || pic.readsRecordedDemand;
  const stated = consuming.filter(c => c.conclusion === 'FAIL'
    || (c.conclusion === 'NOT_EVALUATED' && !isOptionalCheck(c))
    || (c.conclusion === 'PASS' && figuresWhole));

  const nothing = !pic.present && !pic.readsRecordedDemand;
  const fails = stated.filter(c => c.conclusion === 'FAIL');
  const requiredOpen = stated.filter(c => c.conclusion === 'NOT_EVALUATED');
  const state: ItemState = nothing ? 'answered'
    : fails.length > 0 ? 'fails'
      : !input.evaluation || pic.methodOutOfScope || requiredOpen.length > 0 ? 'needs-verification'
        : pic.present && !pic.complete ? 'needs-verification'
          : 'calculated';

  const missing = pic.panels.filter(p => p.demandA === null).map(p => p.label);
  const answer = nothing
    ? 'None — optional. The design, drawing and permit are completed without it.'
    : !pic.present
      ? `No load analysis — ${pic.recordedServiceA !== null ? `${amps(pic.recordedServiceA)} service demand`
          : 'demand'} recorded directly`
      : [
          pic.methodLabel + (pic.methodOutOfScope ? ` (does not apply to ${system.label})` : ''),
          pic.panels.length === 0 ? 'no panelboard recorded yet'
            : `${pic.entered} of ${pic.panels.length} panelboard${pic.panels.length === 1 ? '' : 's'} with a figure`,
          pic.sums ? `${amps(pic.sums.aggregateA)} aggregate`
            : pic.panels.length > 0 ? 'cannot be summed until every panelboard has a figure' : null,
        ].filter(Boolean).join(' · ');

  const why = pic.methodOutOfScope
    ? pic.methodOutOfScope
    : pic.present && pic.panels.length === 0
      ? 'Calculated demand is entered per panelboard, and this service has no panelboard recorded yet.'
      : pic.present && !pic.complete
        ? `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no figure. A partial load `
          + 'analysis is not a smaller load, so the aggregate, service-path and backed-up demand cannot '
          + 'be summed until every panelboard has one. Optional: nothing waits on it.'
          + (pic.readsRecordedDemand ? ' Until a panelboard has a figure, the engineering still reads the '
            + 'demand recorded directly.' : '')
        : !input.evaluation
          ? 'The engineering has not been evaluated against these figures yet.'
          : requiredOpen.length > 0
            ? `Not every check that reads these figures could be evaluated: ${requiredOpen.map(c => c.title).join(', ')}.`
            : undefined;

  const choices = loadMethodChoices(t.service.phase);
  const items: InterviewItem[] = [{
    id: LOAD_ANALYSIS_ITEM_ID,
    section: 'engineering',
    question: 'Is there a full load analysis? (optional)',
    state,
    answer,
    source: nothing ? 'Not established' : 'Installer entered',
    options: choices.available,
    value: pic.method,
    why,
    owner: 'Installer or engineer — optional',
  }];

  for (const c of stated) {
    items.push({
      id: `${LOAD_ANALYSIS_ITEM_ID}.check.${c.id}.${c.scope}`,
      section: 'engineering',
      question: c.title,
      state: checkState(c),
      answer: c.conclusion === 'NOT_EVALUATED' ? `NOT EVALUATED — ${c.detail}` : `${c.conclusion} — ${c.detail}`,
      source: 'SolarPro calculation',
    });
  }
  return items;
}

// ── The answers ─────────────────────────────────────────────────────────────

/**
 * "Add a full load analysis, using this method" or "change its method". It is one answer: the
 * analysis uses this method.
 *
 * The method is always the installer's. A method this electrical system cannot use is refused with
 * the reason. Adding one where there is no panelboard is refused too: demand is entered per
 * panelboard, so there would be nowhere to put it. Changing the method keeps every figure entered.
 */
export function answerLoadAnalysisMethod(t: ServiceTopology, method: LoadCalculationMethod): AnswerResult {
  if (!LOAD_METHODS.some(m => m.value === method)) {
    return refuse(`'${method}' is not a load calculation method SolarPro records.`);
  }
  const why = loadMethodUnavailableBecause(method, t.service.phase);
  if (why) return refuse(why);
  const current = t.loads ?? null;
  if (!current && t.panels.length === 0) {
    return refuse('Calculated demand is entered per panelboard, and this service has no panelboard yet. '
      + 'Answer how the service is distributed first.');
  }
  return done(setLoadModel(t, {
    method,
    basis: current?.basis ?? '',
    byPanel: current?.byPanel ?? [],
    otherDemandA: current?.otherDemandA ?? null,
  }), current ? `Load analysis method: ${methodLabel(method)}` : `Full load analysis added — ${methodLabel(method)}`);
}

/**
 * "MSP #1 — calculated demand (A)". One figure per panelboard. Blank (null) removes that
 * panelboard's figure, which makes the sums unknown again. It never makes them zero.
 *
 * Refused until the analysis exists: on its own `setPanelLoad` would create the model under a
 * default method nobody chose.
 */
export function answerPanelDemand(t: ServiceTopology, panelId: string, demandA: number | null): AnswerResult {
  if (!t.loads) {
    return refuse('Add the load analysis and choose its method first. SolarPro does not assume a method.');
  }
  const p = t.panels.find(x => x.id === panelId);
  if (!p) return refuse(`No panelboard '${panelId}'.`);
  if (demandA !== null && (!Number.isFinite(demandA) || demandA <= 0)) {
    return refuse('Calculated demand must be a positive number of amperes. Leave it blank to remove this '
      + 'panelboard’s figure.');
  }
  return done(setPanelLoad(t, panelId, demandA),
    demandA === null ? `${p.label}: demand figure removed` : `${p.label}: ${demandA} A calculated demand`);
}

/** "Remove the load analysis." A legitimate state, not a regression: the design completes without it. */
export function answerRemoveLoadAnalysis(t: ServiceTopology): AnswerResult {
  if (!t.loads) return refuse('There is no load analysis to remove.');
  return done(setLoadModel(t, null), 'Load analysis removed');
}
