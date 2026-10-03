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
//     a question. Empty or partial, it is still the installer's own entry ('answered'), never amber:
//     it adds no release blocker, no needs-answer and no needs-verification state of its own. When it
//     is present and a check reads it, the item states exactly what that check concluded.
//   · IT NEVER SILENTLY REPLACES A DEMAND RECORDED DIRECTLY. The engine reads the load model as soon
//     as it holds one figure, and from then on a demand recorded on the service, its paths or its
//     systems is not read at all. A partial model sums to nothing, so a recorded demand that FAILED
//     would simply stop failing. The item says so before the first figure and after it, in a
//     verdict-style row that carries the recorded figure's own FAIL.
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
import {
  evaluateServiceTopology, isOptionalCheck, resolveDemands, servicePhaseInfo,
} from '@/lib/electrical/serviceTopology';
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

/** The consumers that compare a demand against a rating. These are the ones a recorded demand can FAIL. */
const DEMAND_COMPARISON_CHECK_IDS: ReadonlySet<string> = new Set([
  'service.demand', 'branch.demand', 'domain.backed-up-load',
]);

/** The id of the row about a demand recorded directly, shown while a load analysis exists beside it. */
export const RECORDED_DEMAND_ITEM_ID = `${LOAD_ANALYSIS_ITEM_ID}.recorded`;

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
  /**
   * Every demand recorded directly on the service, its paths or its systems, in installer words
   * ("450.0 A service demand"), WHETHER OR NOT the engineering still reads it. Null when none is.
   */
  recordedDemand: string | null;
  /**
   * The load model holds a figure, so the engineering reads the model and no longer reads
   * `recordedDemand`. Only true when there is a recorded demand to supersede.
   */
  recordedSuperseded: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The demand recorded directly, read the way the engine reads it when there is no load model. */
function recordedDemandWords(t: ServiceTopology): string | null {
  const r = resolveDemands({ ...t, loads: null });
  if (r.source !== 'recorded') return null;
  const parts: string[] = [];
  if (r.serviceA !== null) parts.push(`${amps(r.serviceA)} service demand`);
  for (const b of t.branches) {
    const v = r.branchA[b.id];
    if (finite(v)) parts.push(`${amps(v)} on ${b.label}`);
  }
  for (const d of t.domains) {
    const v = r.domainBackedUpA[d.id];
    if (finite(v)) parts.push(`${amps(v)} backed-up load on ${d.label}`);
  }
  return parts.join(', ');
}

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
  const recorded = recordedDemandWords(t);
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
    recordedDemand: recorded,
    recordedSuperseded: recorded !== null && d.source === 'load-model',
  };
}

// ── The interview items ─────────────────────────────────────────────────────

const checkState = (c: TopologyCheck): ItemState =>
  c.conclusion === 'PASS' ? 'calculated' : c.conclusion === 'FAIL' ? 'fails' : 'needs-verification';

/**
 * "Is there a full load analysis?" plus, where the engineering read figures from it, each consuming
 * check's verdict, and — while an analysis exists beside a demand recorded directly — what happens to
 * that recorded demand.
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

  // 🚨 A DEMAND RECORDED DIRECTLY, BESIDE AN ANALYSIS. What it concludes is the engine's: the live
  // evaluation while it is still read; once the model supersedes it, the engine run on this same graph
  // as it reads with no model. Those are the recorded figures' own verdicts, not a comparison made here.
  const recorded = pic.present ? pic.recordedDemand : null;
  const recordedFails = recorded === null ? []
    : (pic.recordedSuperseded ? evaluateServiceTopology({ ...t, loads: null }).checks : consuming)
        .filter(c => DEMAND_COMPARISON_CHECK_IDS.has(c.id) && c.conclusion === 'FAIL');
  // The analysis replaces the recorded figures only once the engineering evaluates it whole.
  const replaced = pic.complete && !pic.methodOutOfScope;
  // Per recorded FAIL: is that same path (check id + scope) now evaluated from the analysis, or is it
  // simply no longer read? A path whose panelboards all have figures is evaluated again — saying
  // "nothing evaluates this demand" there contradicted the engine's own row beneath it.
  const liveOf = (c: { id: string; scope: string }) => consuming.find(x => x.id === c.id && x.scope === c.scope);
  const unreadFails = recordedFails.filter(c => { const live = liveOf(c); return !live || live.conclusion === 'NOT_EVALUATED'; });
  const reEvaluated = recordedFails.filter(c => !unreadFails.includes(c));
  /** A recorded FAIL the engineering no longer reads, with nothing yet in its place. */
  const failNoLongerRead = pic.recordedSuperseded && unreadFails.length > 0 && !replaced;

  // 🚨 EMPTY OR PARTIAL IS THE INSTALLER'S OWN ENTRY, NEVER AN AMBER STATE. An optional analysis
  // half filled in holds nothing up, so it must not turn the Engineering card amber by itself.
  // Needs-verification is kept for what needs it: a method this system cannot use, a required check
  // left open, or no evaluation in hand. (A recorded FAIL it hid is amber on its own row, below.)
  const state: ItemState = nothing ? 'answered'
    : fails.length > 0 ? 'fails'
      : !input.evaluation || pic.methodOutOfScope || requiredOpen.length > 0 ? 'needs-verification'
        : pic.present && !pic.complete ? 'answered'
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
          recorded === null ? null
            : pic.recordedSuperseded ? `supersedes the demand recorded directly (${recorded})`
              : `the demand recorded directly (${recorded}) is read until the first figure`,
        ].filter(Boolean).join(' · ');

  const why = pic.methodOutOfScope
    ? pic.methodOutOfScope
    : pic.present && pic.panels.length === 0
      ? 'Calculated demand is entered per panelboard, and this service has no panelboard recorded yet.'
      : pic.present && !pic.complete
        ? `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no figure. A partial load `
          + 'analysis is not a smaller load, so the aggregate, service-path and backed-up demand cannot '
          + 'be summed until every panelboard has one.'
          // "Nothing waits on it" is said only where it is true: no FAIL, and no recorded FAIL it hid.
          + (fails.length > 0 ? ''
            : failNoLongerRead ? ' The demand recorded directly failed, and it is no longer read: see below.'
              : ' Optional: nothing waits on it.')
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
    // A FAIL is not optional to fix, so it is not labelled so.
    owner: state === 'fails' ? 'Installer or engineer' : 'Installer or engineer — optional',
  }];

  // 🚨 THE RECORDED DEMAND, BEFORE AND AFTER THE FIRST FIGURE — never replaced in silence.
  if (recorded !== null) {
    const verdicts = (pic.recordedSuperseded ? unreadFails : recordedFails).map(c => c.detail).join(' ');
    // A recorded FAIL on a path the analysis now evaluates is still disclosed — with what the analysis
    // concludes for that path beside it.
    const nowEvaluated = pic.recordedSuperseded && reEvaluated.length > 0
      ? ` It failed — ${reEvaluated.map(c => c.detail).join(' ')} Now evaluated from the analysis: ${
          reEvaluated.map(c => { const live = liveOf(c)!; return `${live.title} — ${live.conclusion}`; }).join('; ')}.`
      : '';
    items.push({
      id: RECORDED_DEMAND_ITEM_ID,
      section: 'engineering',
      question: 'Demand recorded directly on the service',
      state: !pic.recordedSuperseded ? (recordedFails.length > 0 ? 'fails' : 'answered')
        : failNoLongerRead ? 'needs-verification' : 'answered',
      answer: pic.recordedSuperseded
        ? `The demand recorded directly (${recorded}) is superseded by this analysis and no longer read.`
          + (unreadFails.length > 0 ? ` It failed, and nothing evaluates that now — ${verdicts}` : '')
          + nowEvaluated
        : `The demand recorded directly (${recorded}) is read until the first panelboard figure is entered, `
          + 'which supersedes it.' + (recordedFails.length > 0 ? ` It fails — ${verdicts}` : ''),
      source: 'Installer entered',
      why: !pic.recordedSuperseded
        ? 'The first panelboard figure switches the engineering from this recorded demand to the analysis. '
          + 'From then on this figure is not read, and until every panelboard has a figure nothing evaluates '
          + 'the demand' + (recordedFails.length > 0 ? ', so this FAIL would stop being reported without being '
            + 'resolved.' : '.')
        : failNoLongerRead
          ? 'Nothing evaluates this demand now. The recorded figure that failed is no longer read, and this '
            + 'analysis does not replace it until '
            + (!pic.complete ? 'every panelboard has a figure. Enter the remaining panelboard figures'
              : `its method applies to ${system.label}. Choose a method that applies`)
            + ', or remove the analysis and the recorded demand is read again.'
          : replaced
            ? 'The engineering reads this analysis, summed from every panelboard, in its place.'
            : 'The engineering reads this analysis in its place. Until every panelboard has a figure, nothing '
              + 'evaluates the demand.',
    });
  }

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
