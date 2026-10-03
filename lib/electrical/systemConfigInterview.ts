// ═══════════════════════════════════════════════════════════════════════════
// 🚨 SYSTEM CONFIG IS THE HUMAN INTERFACE TO ENGINEERING — THIS DECIDES WHAT IT ASKS.
//
// Ray, the product direction (2026-10-03):
//
//   "The installer should not need to understand SolarPro's internal graph model. The installer
//    should answer real-world questions. SolarPro converts those answers into the internal
//    engineering model."
//
//   "Do not ask a question whose answer is already known. Do not offer an answer the selected
//    equipment cannot support."
//
// The page used to put every control on screen at once, and the one guided flow that existed (the
// Service Topology wizard) opened defaulted to the hardest job in the product — 400 A, two main
// panels — and asked "how do these systems connect?" of a house with one panel. This module is the
// interviewer: given what Design placed, what the service graph records, what equipment is chosen
// and what the engineering concluded, it returns the five installer sections, which questions are
// RELEVANT, which are ANSWERED (and where the answer came from), and what still blocks release.
//
// What it is NOT:
//   · A store. Every answer it reports is read from its real owner (the Design layout, the service
//     graph, the equipment selection, the recorded architecture decision). It writes nothing.
//   · Engineering. It reports the engines' conclusions; it computes no ampere and no voltage.
//   · Brand logic. Questions key on CAPABILITY — "the chosen storage publishes PV DC inputs",
//     "the chosen storage can back up loads" — never on a manufacturer name.
//
// Pure and isomorphic, so the page renders from it and a test can drive every branch of it.
// ═══════════════════════════════════════════════════════════════════════════

import type { PvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { pvModuleCountSourceLabel } from '@/lib/electrical/pvArrayDesign';
import type {
  ServiceTopology, SolarCoupling, TopologyEvaluation, PoiRelationship,
} from '@/lib/electrical/serviceTopology';
import { isOptionalCheck, servicePhaseInfo, type ServicePhase } from '@/lib/electrical/serviceTopology';
import { buildServiceOverview, REQUIREMENT_OWNERS } from '@/lib/electrical/topologyOverview';
import { buildUtilityDisconnectsItems, supersededByUtilityDisconnects } from '@/lib/electrical/systemConfigUtilityDisconnects';
import { buildSystemEquipmentItems, placeSystemEquipmentItems } from '@/lib/electrical/systemConfigSystemEquipment';
import { buildLoadAnalysisItems } from '@/lib/electrical/systemConfigLoadAnalysis';
import { buildGenerationPanelsItem, supersededByGenerationPanels } from '@/lib/electrical/systemConfigGenerationPanels';

// ── The vocabulary an installer reads ───────────────────────────────────────

/** Where a fact came from, in words a person cares about. Never a store name. */
export type FactSource =
  | 'From Design'
  | 'Installer entered'
  | 'Installer decision'
  | 'Selected equipment'
  | 'Manufacturer specification'
  | 'SolarPro calculation'
  | 'Utility / AHJ ruling required'
  | 'Not established';

export type SectionId = 'design' | 'service' | 'equipment' | 'behavior' | 'engineering';

export type ItemState =
  /** Answered by its owner. */
  | 'answered'
  /** Relevant, and nobody has answered it. */
  | 'needs-answer'
  /** Answered, but by a derivation rather than a person — shown for confirmation. */
  | 'derived'
  /** A conclusion the engines reached. */
  | 'calculated'
  /** Answered as far as SolarPro can; a ruling from outside (utility, AHJ, field) is still owed. */
  | 'needs-verification'
  /** The engineering concluded FAIL. */
  | 'fails';

export interface InterviewOption {
  value: string;
  label: string;
  detail?: string;
}

export interface InterviewItem {
  id: string;
  section: SectionId;
  /** The question, in the installer's words. */
  question: string;
  state: ItemState;
  /** The current answer, in the installer's words. Absent ⇒ unanswered. */
  answer?: string;
  source?: FactSource;
  /** The choices, already filtered to what the chosen equipment can support. */
  options?: InterviewOption[];
  /** The option value currently recorded, when the item has options. */
  value?: string | null;
  /** Why it matters — shown beside an unanswered question. */
  why?: string;
  /** Who supplies the answer. */
  owner?: string;
  /** What it blocks while unanswered. */
  blocks?: string[];
}

export type SectionStatus = 'complete' | 'needs-answer' | 'needs-verification' | 'fails';

export interface InterviewSection {
  id: SectionId;
  title: string;
  status: SectionStatus;
  /** One line, for the collapsed card: "37 modules · 16.28 kW DC". */
  summary: string;
  items: InterviewItem[];
}

export interface ReleaseState {
  /** Enough is known to draw a diagnostic sheet. */
  drawable: boolean;
  /** Nothing fails and nothing required is unanswered. */
  releaseReady: boolean;
  /** Why it is not release-ready, one line each. */
  blockers: string[];
}

/** One line of the engineered project's summary — each read from its owner, never recomputed here. */
export interface SummaryFact {
  label: string;
  value: string;
  source: FactSource;
}

export interface SystemConfigInterview {
  /**
   * The engineered project in installer language — the Engineering Summary card reads THESE, so it
   * cannot say "0 panels · 0.00 kW" over a 37-module design or call four Powerwalls an inverter.
   */
  summaryFacts: SummaryFact[];
  sections: InterviewSection[];
  /** Every relevant, unanswered question, in the order an installer should answer them. */
  openQuestions: InterviewItem[];
  release: ReleaseState;
  /**
   * The engine's verdicts this interview was built from (`evaluateServiceTopology`), passed through
   * unchanged so the Engineering Readiness panel counts PASS / FAIL / NOT EVALUATED from the same
   * evaluation the questions were read against — never a second run. Null ⇒ nothing evaluated yet.
   */
  evaluation: TopologyEvaluation | null;
}

// ── What the interviewer is told ────────────────────────────────────────────

/** A piece of equipment's decision state. Distinct states — an empty string is none of them. */
export type EquipmentDecision = 'UNDECIDED' | 'NONE' | 'SELECTED' | 'CONFLICT';

export interface InterviewEquipment {
  pvInverter: {
    state: EquipmentDecision;
    label?: string | null;
    kind?: 'micro' | 'string' | 'optimizer' | 'hybrid' | null;
    count?: number;
    /**
     * Σ rated AC output of the chosen PV inverters, kW, from their catalogue rows. Null / absent ⇒
     * not established (never a default). Read only when `state === 'SELECTED'`.
     */
    acKw?: number | null;
  };
  /** Null ⇒ no storage on this project (a legitimate answer, not a gap). */
  storage: {
    label: string | null;
    count: number;
    /** The unit publishes its own PV DC inputs. */
    pvInput: boolean;
    /** The unit can island and carry loads. */
    backupCapable: boolean;
    /** The manufacturer requires a gateway / controller with it. */
    requiresGateway: boolean;
    /**
     * Each battery product installed and how many — where the systems use different ones, storage is
     * stated per product ("2 × A · 2 × B"), never as the first one times the total.
     */
    products?: ReadonlyArray<{ label: string | null; count: number }>;
  } | null;
  gateway: {
    label: string | null;
    count: number;
    /**
     * Each controller product installed and how many — where the systems use different ones, the
     * controllers are stated per product ("1 × A · 1 × B"), never as the first one times the count.
     */
    products?: ReadonlyArray<{ label: string | null; count: number }>;
  } | null;
}

/** The backup controllers in words: one product ⇒ "2 × A"; several ⇒ "1 × A · 1 × B". */
const controllersInWords = (gw: NonNullable<InterviewEquipment['gateway']>): string =>
  gw.products && gw.products.length > 1
    ? gw.products.map(p => `${p.count} × ${p.label ?? 'gateway'}`).join(' · ')
    : `${gw.count} × ${gw.label ?? 'gateway'}`;

/** The batteries in words: one product ⇒ "4 × A"; several ⇒ "2 × A · 2 × B". */
const storageInWords = (st: NonNullable<InterviewEquipment['storage']>): string =>
  st.products && st.products.length > 1
    ? st.products.map(p => `${p.count} × ${p.label ?? 'battery'}`).join(' · ')
    : `${st.count} × ${st.label ?? 'battery'}`;

export interface InterviewInput {
  pvArray: PvArrayDesign;
  topology: ServiceTopology | null;
  coupling: SolarCoupling | null;
  /** The coupling was stated by a person (provenance recorded), not derived. */
  couplingIsDecision: boolean;
  /** The stores contradict each other about the architecture. */
  architectureConflict: boolean;
  equipment: InterviewEquipment;
  evaluation?: TopologyEvaluation | null;
  /** The engine's derived strings for this array, for the landing question. */
  derivedStrings?: ReadonlyArray<{ panelCount: number }> | null;
}

// ── Constants an installer would recognise ──────────────────────────────────

/** Services above this are commonly split across more than one main panel, so the split is asked. */
const SPLITTABLE_ABOVE_A = 225;

const POI_ANSWER: Record<PoiRelationship, string> = {
  'load-side-busbar': 'Breaker in the panel (load side)',
  'load-side-feeder-tap': 'Feeder tap, load side',
  'supply-side': 'Line-side tap ahead of the main (supply side)',
  'aggregation-to-supply-side': 'Generation panel to a supply-side tap',
  'manufacturer-integrated': 'Inside the listed gateway / controller',
  'meter-collar': 'Meter collar adapter',
  'unresolved': 'Not established',
};

const STORAGE_LANDING_LABEL: Record<string, string> = {
  'der-aggregation-panel': 'External generation / combiner panel — one per system',
  'gateway-panelboard': 'Inside the gateway’s own panelboard',
  'backed-up-panel-busbar': 'On the backed-up panel’s busbar',
};

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const countWord = (n: number) => COUNT_WORD[n] ?? String(n);

/** One vocabulary for electrical systems — the descriptor the service model owns. */
function phaseLabel(phase: string | undefined | null): string {
  return phase ? servicePhaseInfo(phase as ServicePhase).label : 'Not established';
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INTERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export function buildSystemConfigInterview(input: InterviewInput): SystemConfigInterview {
  const { pvArray, topology: t, equipment: eq } = input;
  const hasPv = (pvArray.moduleCount ?? 0) > 0;
  const hasStorage = !!eq.storage && eq.storage.count > 0;

  // ── 1 · PROJECT & DESIGN ─────────────────────────────────────────────────
  const design: InterviewItem[] = [];
  {
    const m = pvArray.module;
    const count = pvArray.moduleCount;
    const established = count !== null && (count === 0 || (!!m && pvArray.dcStcKw !== null));
    design.push({
      id: 'design.pv-array',
      section: 'design',
      question: 'What PV array did Design place?',
      state: established ? 'answered' : 'needs-answer',
      answer: count === null
        ? undefined
        : count === 0
          ? 'No PV modules'
          : `${count} modules${m ? ` · ${m.watts} W` : ''}${pvArray.dcStcKw !== null ? ` · ${pvArray.dcStcKw.toFixed(2)} kW DC` : ''}`
            + (m ? ` · ${m.manufacturer} ${m.model}` : ''),
      source: count === null ? 'Not established' : (pvModuleCountSourceLabel(pvArray.moduleCountSource) === 'From Design'
        ? 'From Design' : 'Installer entered'),
      why: pvArray.missing[0]?.why,
      owner: pvArray.missing[0]?.owner,
      blocks: pvArray.missing[0]?.blocks,
    });
    if (pvArray.moduleConflict) {
      const f = pvArray.missing.find(x => x.why.startsWith(pvArray.moduleConflict!));
      design.push({
        id: 'design.module-conflict',
        section: 'design',
        question: 'Is the recorded module the one Design placed?',
        state: 'fails',
        answer: `No — ${pvArray.moduleConflict}.`,
        source: 'SolarPro calculation',
        why: f?.why,
        owner: f?.owner,
        blocks: f?.blocks,
      });
    }
    if (hasPv && pvArray.assignmentState === 'DIFFERS_FROM_DESIGN') {
      design.push({
        id: 'design.assignment-stale',
        section: 'design',
        question: 'Does the string assignment still cover the design?',
        state: 'needs-answer',
        answer: `The recorded strings cover ${pvArray.assignedModuleCount} modules; Design placed ${count}.`,
        source: 'SolarPro calculation',
        why: 'A string assignment that does not represent every placed module exactly once cannot be '
          + 'drawn or checked. It is re-derived against the real input limits rather than trusted.',
        owner: 'Engineering (re-derive strings)',
        blocks: ['string design', 'SLD'],
      });
    }
  }

  // ── 2 · EXISTING ELECTRICAL SERVICE ──────────────────────────────────────
  const service: InterviewItem[] = [];
  const rated = t?.service.ratedAmps ?? null;
  service.push({
    id: 'service.rating',
    section: 'service',
    question: 'What is the existing service rating?',
    state: rated !== null ? 'answered' : 'needs-answer',
    answer: rated !== null ? `${rated} A` : undefined,
    source: rated !== null ? 'Installer entered' : 'Not established',
    why: 'The service rating bounds everything that connects to it, and the busbar and service '
      + 'checks cannot run without it.',
    owner: 'Installer (read the service equipment)',
    blocks: ['service checks', 'SLD service section', 'permit'],
  });
  if (t) {
    service.push({
      id: 'service.system',
      section: 'service',
      question: 'What is the electrical system?',
      state: t.service.phase === 'custom' ? 'needs-verification' : 'answered',
      answer: phaseLabel(t.service.phase),
      source: 'Installer entered',
      ...(t.service.phase === 'custom'
        ? { why: 'SolarPro has no calculation method for this electrical system yet; the checks that '
            + 'depend on it report NOT EVALUATED rather than running a residential formula.' }
        : {}),
    });
  }
  if (t) {
    const afc = t.service.availableFaultCurrentA;
    service.push({
      id: 'service.fault-current',
      section: 'service',
      question: 'Available fault current at the service?',
      state: afc !== null ? 'answered' : 'needs-verification',
      answer: afc !== null ? `${(afc / 1000).toFixed(afc % 1000 === 0 ? 0 : 1)} kA` : 'Not provided',
      source: afc !== null ? 'Installer entered' : 'Utility / AHJ ruling required',
      why: 'Every interrupting-rating (SCCR) check compares a device against this number. Until the '
        + 'utility provides it, those checks report NOT EVALUATED — they are never assumed adequate.',
      owner: 'Utility (request it)',
      blocks: ['SCCR checks', 'release'],
    });
  }
  if (t) {
    const ex = t.service.existingEquipment ?? null;
    service.push({
      id: 'service.existing',
      section: 'service',
      question: 'Is this existing service equipment, and has it been read on site?',
      state: ex === null ? 'answered' : ex.verified ? 'answered' : 'needs-verification',
      answer: ex === null ? 'New service equipment (engineered by SolarPro)'
        : `Existing${ex.manufacturer ? ` ${ex.manufacturer}` : ''} equipment — `
          + (ex.verified ? 'read on site' : 'configuration to verify on site'),
      source: ex?.verified ? 'Installer entered' : ex ? 'Not established' : 'Installer entered',
      why: ex && !ex.verified
        ? 'Existing equipment is connected to, never replaced or priced, and its internal breaker '
          + 'arrangement must be read on site rather than assumed.'
        : undefined,
      owner: 'Field verification',
    });
  }
  // The split is asked only where a split is physically plausible. A 200 A service is one panel.
  if (rated !== null && rated > SPLITTABLE_ABOVE_A && t) {
    const n = t.branches.length;
    service.push({
      id: 'service.distribution',
      section: 'service',
      question: `How is the ${rated} A service distributed?`,
      state: n > 0 ? 'answered' : 'needs-answer',
      answer: n === 0 ? undefined
        : n === 1 ? `One ${t.branches[0].ratedAmps} A main panel`
          : (() => {
              const sizes = [...new Set(t.branches.map(b => b.ratedAmps))];
              return sizes.length === 1
                ? `${countWord(n)} ${sizes[0]} A main panels`
                : `${countWord(n)} main panels (${t.branches.map(b => `${b.ratedAmps} A`).join(' + ')})`;
            })(),
      source: n > 0 ? 'Installer entered' : 'Not established',
      options: [
        { value: 'one-main-panel', label: `One ${rated} A main panel` },
        { value: 'two-main-panels', label: `Two ${Math.floor(rated / 2)} A main panels` },
        { value: 'custom', label: 'Other / custom' },
      ],
      value: n === 0 ? null : n === 1 ? 'one-main-panel' : n === 2 ? 'two-main-panels' : 'custom',
      why: 'Each main panel is its own busbar — the 120% rule and every backup decision are per panel.',
      owner: 'Installer',
      blocks: ['busbar checks', 'backup', 'SLD'],
    });
  }
  for (const p of t?.panels ?? []) {
    const ok = p.busbarRatingA !== null && p.mainBreakerA !== null;
    service.push({
      id: `service.panel.${p.id}`,
      section: 'service',
      question: `${p.label}: main breaker and busbar rating?`,
      state: ok ? 'answered' : 'needs-answer',
      answer: `Main ${p.mainBreakerA ?? '—'} A · Bus ${p.busbarRatingA ?? '—'} A`,
      source: ok ? 'Installer entered' : 'Not established',
      why: 'NEC 705.12(B) is evaluated on THIS panel’s busbar and main breaker — never the service’s.',
      owner: 'Installer (panel label)',
      blocks: ['busbar check'],
    });
  }

  // ── 3 · EQUIPMENT ────────────────────────────────────────────────────────
  const equipment: InterviewItem[] = [];
  {
    const inv = eq.pvInverter;
    const dcDecided = input.coupling === 'dc-coupled-storage' && input.couplingIsDecision;
    const noPvDecided = input.coupling === 'storage-only';
    const state: ItemState = inv.state === 'CONFLICT' ? 'fails'
      : inv.state === 'SELECTED' ? 'answered'
        : inv.state === 'NONE' || dcDecided || noPvDecided ? 'answered'
          : hasPv ? 'needs-answer' : 'answered';
    equipment.push({
      id: 'equipment.pv-inverter',
      section: 'equipment',
      question: 'What PV inverter are we installing?',
      state,
      answer: inv.state === 'CONFLICT'
        ? 'Conflict — the project records an inverter AND an architecture with no inverter'
        : inv.state === 'SELECTED'
          ? `${inv.count && inv.count > 1 ? `${inv.count} × ` : ''}${inv.label ?? 'Selected'}`
          : (inv.state === 'NONE' || dcDecided)
            ? `None${input.coupling === 'dc-coupled-storage' ? ' — DC coupled to storage' : ''}`
            : noPvDecided ? 'None — no PV on this project'
              : hasPv ? undefined : 'None — no PV on this project',
      source: inv.state === 'SELECTED' ? 'Selected equipment'
        : (inv.state === 'NONE' || dcDecided) ? 'Installer decision' : undefined,
      why: hasPv && state === 'needs-answer'
        ? 'Every PV module lands on something: a PV inverter, or a battery’s own PV inputs. Until that '
          + 'is chosen, the strings, the AC circuit and the drawing are all undecided.'
        : undefined,
      owner: 'Installer (equipment selection)',
      blocks: state === 'needs-answer' || state === 'fails' ? ['string design', 'SLD', 'BOM'] : undefined,
    });
    equipment.push({
      id: 'equipment.storage',
      section: 'equipment',
      question: 'Is storage being installed?',
      state: 'answered',
      // No battery in the selection is "none selected" — not a recorded decision that there is none.
      answer: hasStorage ? storageInWords(eq.storage!) : 'None selected',
      source: 'Selected equipment',
    });
    if (hasStorage && eq.storage!.requiresGateway) {
      const gw = eq.gateway;
      equipment.push({
        id: 'equipment.gateway',
        section: 'equipment',
        question: 'Which backup controller / gateway?',
        state: gw && gw.count > 0 ? 'answered' : 'needs-answer',
        answer: gw && gw.count > 0 ? controllersInWords(gw) : undefined,
        source: gw && gw.count > 0 ? 'Selected equipment' : 'Not established',
        why: 'The manufacturer requires a gateway / controller with this storage.',
        owner: 'Installer (equipment selection)',
        blocks: ['backup', 'SLD', 'BOM'],
      });
    }
  }

  // ── 4 · SYSTEM BEHAVIOR / CONNECTION ─────────────────────────────────────
  const behavior: InterviewItem[] = [];
  const storageLabel = eq.storage?.label ?? 'the batteries';

  // 4a — Where does the PV connect? Asked ONLY when the answer is genuinely open: PV exists, the
  // chosen storage can take PV on DC, and no standalone inverter has been explicitly chosen (an
  // explicitly chosen microinverter is not secretly DC coupled to anything).
  const pvQuestionOpen = hasPv && hasStorage && eq.storage!.pvInput && eq.pvInverter.state !== 'SELECTED';
  if (pvQuestionOpen || (input.coupling && hasPv && hasStorage)) {
    const options: InterviewOption[] = [];
    if (eq.storage?.pvInput) {
      options.push({
        value: 'dc-coupled-storage',
        label: `Directly to ${storageLabel} PV inputs`,
        detail: 'The strings land on the battery’s own DC inputs. No separate PV inverter, no PV '
          + 'combiner and no PV AC disconnect exist on this job.',
      });
    }
    options.push({
      value: 'ac-coupled-inverter',
      label: 'Through an external PV inverter',
      detail: 'The PV has its own inverter and connects on AC — an ordinary arrangement beside a battery.',
    });
    const answered = !!input.coupling && (input.couplingIsDecision || eq.pvInverter.state === 'SELECTED');
    behavior.push({
      id: 'behavior.pv-connection',
      section: 'behavior',
      question: 'Where does the PV connect?',
      state: input.architectureConflict ? 'fails'
        : answered ? 'answered'
          : input.coupling ? 'derived' : 'needs-answer',
      answer: input.coupling === 'dc-coupled-storage' ? `Directly to ${storageLabel} PV inputs`
        : input.coupling === 'ac-coupled-inverter' ? 'Through an external PV inverter'
          : input.coupling === 'storage-only' ? 'No PV' : undefined,
      source: answered ? (input.couplingIsDecision ? 'Installer decision' : 'Selected equipment')
        : input.coupling ? 'SolarPro calculation' : 'Not established',
      options: pvQuestionOpen ? options : undefined,
      value: input.coupling,
      why: 'Where the strings terminate decides which equipment exists, which limits size the strings, '
        + 'and what the drawing shows. SolarPro does not infer it from what the battery could do.',
      owner: 'Installer',
      blocks: ['string design', 'SLD', 'BOM', 'permit'],
    });
  }

  // 4b — What is backed up? Only when the storage can back up loads.
  if (hasStorage && eq.storage!.backupCapable && t) {
    const domains = t.domains;
    const backed = t.panels.filter(p => p.backedUp);
    behavior.push({
      id: 'behavior.backup',
      section: 'behavior',
      question: t.panels.length > 1 ? 'What is backed up, panel by panel?' : 'What is backed up?',
      state: domains.length > 0 ? 'answered' : 'needs-answer',
      answer: domains.length === 0 ? undefined
        : backed.length === t.panels.length
          ? (t.panels.length > 1 ? `Whole panel — ${backed.map(p => p.label).join(' and ')}` : 'Whole main panel')
          : backed.length === 0 ? 'No backup'
            : `${backed.map(p => p.label).join(', ')} backed up`,
      source: domains.length > 0 ? 'Installer entered' : 'Not established',
      options: [
        { value: 'whole', label: t.panels.length > 1 ? 'Every panel — whole home' : 'Whole main panel' },
        { value: 'none', label: 'No backup' },
      ],
      why: 'Backup decides where each gateway sits and which panel is inside the island.',
      owner: 'Installer',
      blocks: ['gateway placement', 'SLD', 'BOM'],
    });

    // 4c — How do the battery AC circuits land / combine? Per system, only where a system has storage.
    const withStorage = domains.filter(d => d.storageUnitIds.some(id =>
      t.storage.find(u => u.id === id)?.role === 'inverter-unit'));
    if (withStorage.length > 0) {
      const units = (d: typeof withStorage[number]) => d.storageUnitIds
        .filter(id => t.storage.find(u => u.id === id)?.role === 'inverter-unit').length;
      const multi = withStorage.some(d => units(d) > 1);
      const unresolved = withStorage.filter(d => d.storageConnection === 'unresolved');
      const values = [...new Set(withStorage.map(d => d.storageConnection))];
      behavior.push({
        id: 'behavior.storage-landing',
        section: 'behavior',
        question: multi ? 'How are the battery AC circuits combined?' : 'Where do the battery AC circuits land?',
        state: unresolved.length > 0 ? 'needs-answer' : 'answered',
        answer: unresolved.length > 0 ? undefined
          : values.length === 1 ? STORAGE_LANDING_LABEL[values[0]] ?? values[0]
            : withStorage.map(d => `${d.label}: ${STORAGE_LANDING_LABEL[d.storageConnection] ?? d.storageConnection}`).join(' · '),
        source: unresolved.length > 0 ? 'Not established' : 'Installer entered',
        options: Object.entries(STORAGE_LANDING_LABEL).map(([value, label]) => ({ value, label })),
        value: values.length === 1 && values[0] !== 'unresolved' ? values[0] : null,
        why: 'Each answer selects a different governing check: the generation panel’s own busbar, the '
          + 'manufacturer’s panelboard limits, or the backed-up panel’s 120% rule.',
        owner: 'Installer',
        blocks: ['busbar check', 'SLD', 'BOM'],
      });
    }

    // 4d — How do the systems reach the service? ONLY with more than one system.
    if (domains.length > 1) {
      const arr = t.interconnection.derArrangement;
      behavior.push({
        id: 'behavior.systems',
        section: 'behavior',
        question: `How do the ${countWord(domains.length).toLowerCase()} systems connect to the service?`,
        state: arr ? 'answered' : 'needs-answer',
        answer: arr === 'independent-branch' ? 'Independently — each system on its own path'
          : arr === 'common-aggregation' ? 'Combined in one generation panel, one connection'
            : arr === 'custom' ? 'Custom engineered arrangement' : undefined,
        source: arr ? 'Installer entered' : 'Not established',
        options: [
          { value: 'independent-branch', label: 'Independently — each system on its own path' },
          { value: 'common-aggregation', label: 'Combined in one generation panel, one connection' },
          { value: 'custom', label: 'Custom' },
        ],
        value: arr,
        owner: 'Installer',
        blocks: ['interconnection', 'SLD'],
      });
    }

    // 4e — Which battery receives which strings? DC coupled with more than one inverting unit.
    const inverting = t.storage.filter(u => u.role === 'inverter-unit');
    if (input.coupling === 'dc-coupled-storage' && hasPv && inverting.length > 1) {
      const assigned = inverting.filter(u => u.pvDcStcKw !== null && u.pvDcStcKw !== undefined);
      const total = assigned.reduce((s, u) => s + (u.pvDcStcKw ?? 0), 0);
      const complete = assigned.length === inverting.length && pvArray.dcStcKw !== null
        && Math.abs(total - pvArray.dcStcKw) < 0.01;
      behavior.push({
        id: 'behavior.pv-landing',
        section: 'behavior',
        question: `Which ${storageLabel} receives each PV string?`,
        state: complete ? 'answered' : 'needs-answer',
        answer: complete
          ? inverting.filter(u => (u.pvDcStcKw ?? 0) > 0)
              .map(u => `${u.label ?? u.productId} ${u.id.replace(/^.*-/, '#')}: ${(u.pvDcStcKw ?? 0).toFixed(2)} kW`)
              .join(' · ')
          : undefined,
        source: complete ? 'Installer entered' : 'Not established',
        why: `${inverting.length} units each publish their own PV inputs. Which strings land on which unit `
          + 'is a wiring decision — SolarPro does not split the array evenly to fill this in.',
        owner: 'Installer',
        blocks: ['PV input check per unit', 'DC home runs on the SLD'],
      });
    }
  }

  // 4f — Where does the system connect to the service? Asked when there is anything to connect.
  if ((hasPv || hasStorage) && t) {
    const pois = t.pointsOfInterconnection;
    const collar = t.interconnection.meterCollarSelected;
    const resolved = collar || (pois.length > 0 && pois.every(p => p.relationship !== 'unresolved'));
    const rels = [...new Set(pois.map(p => p.relationship))];
    const options: InterviewOption[] = [
      { value: 'load-side-busbar', label: POI_ANSWER['load-side-busbar'],
        detail: 'A backfed breaker in a panel. The 120% busbar rule governs.' },
      { value: 'supply-side', label: POI_ANSWER['supply-side'],
        detail: 'A tap on the service conductors ahead of the main. The supply-side rules govern.' },
      { value: 'load-side-feeder-tap', label: POI_ANSWER['load-side-feeder-tap'] },
    ];
    if (t.domains.length > 0) {
      options.push({ value: 'manufacturer-integrated', label: POI_ANSWER['manufacturer-integrated'],
        detail: 'Governed by the manufacturer’s listing, which SolarPro must hold to evaluate.' });
    }
    // 🚨 A meter collar is the utility's / AHJ's to allow (behavior.utility.meter-collar): never offered
    // where prohibited, and never 'answered' while that permission is not established.
    const permitted = t.interconnection.meterCollarPermitted;
    const collarRuling: ItemState | null = !(collar || rels.includes('meter-collar')) || permitted === true ? null
      : permitted === false ? 'fails' : 'needs-verification';
    const collarNote = collarRuling === 'fails' ? ' — NOT PERMITTED on this project'
      : collarRuling ? ' — utility / AHJ permission not established' : '';
    if (permitted !== false) {
      options.push({ value: 'meter-collar', label: POI_ANSWER['meter-collar'], ...(permitted === true ? {} : {
        detail: 'The utility / AHJ has not said whether a meter collar is permitted here — chosen now, it '
          + 'reads NEEDS VERIFICATION until that is recorded.' }) });
    }
    behavior.push({
      id: 'behavior.interconnection',
      section: 'behavior',
      question: 'Where does the system connect to the service?',
      state: resolved ? collarRuling ?? 'answered' : 'needs-answer',
      answer: collar ? POI_ANSWER['meter-collar'] + collarNote
        : resolved ? rels.map(r => POI_ANSWER[r]).join(' · ') + collarNote : undefined,
      // A recorded prohibition IS a ruling: only a ruling still owed reads "ruling required".
      source: collarRuling === 'needs-verification' ? 'Utility / AHJ ruling required'
        : resolved ? 'Installer entered' : 'Not established',
      options,
      value: collar ? 'meter-collar' : rels.length === 1 && rels[0] !== 'unresolved' ? rels[0] : null,
      why: 'The physical connection decides which part of the code applies. SolarPro never assumes a '
        + 'load-side breaker because a calculator needs a value.',
      owner: 'Installer',
      blocks: ['interconnection check', 'SLD', 'permit'],
    });

    // 4g — Utility isolation. A ruling SolarPro cannot make, asked as a three-state fact.
    const req = t.interconnection.externalDerIsolationRequired;
    const isolators = t.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    const accepted = t.interconnection.isolationArrangementAccepted ?? null;
    behavior.push({
      id: 'behavior.isolation',
      section: 'behavior',
      question: 'Does the utility require an external, lockable disconnect?',
      state: req === null ? 'needs-answer'
        : req === false ? 'answered'
          : isolators.length === 0 ? 'needs-answer'
            : accepted === true ? 'answered' : 'needs-verification',
      answer: req === null ? undefined
        : req === false ? 'Not required'
          : isolators.length === 0 ? 'Required — no switch placed yet'
            : `${isolators.length} switch${isolators.length === 1 ? '' : 'es'}`
              + (accepted === true ? ' · accepted by the utility / AHJ' : ' · utility / AHJ acceptance to verify'),
      source: req === null ? 'Not established'
        : accepted === true ? 'Installer entered' : 'Utility / AHJ ruling required',
      options: [
        { value: 'yes', label: 'Yes — required' },
        { value: 'no', label: 'No — not required' },
        { value: 'unknown', label: 'Not established yet' },
      ],
      value: req === true ? 'yes' : req === false ? 'no' : 'unknown',
      why: 'A utility rule, quoted from the utility — never assumed. SolarPro records the arrangement you '
        + 'intend and never states that the utility accepted it.',
      owner: 'Utility / AHJ',
      blocks: ['isolation check', 'permit'],
    });
  }

  // ── 5 · ENGINEERING RESULT ───────────────────────────────────────────────
  const engineering: InterviewItem[] = [];
  const checks = input.evaluation?.checks ?? [];
  // The busbar verdicts the graph's engine reached, per panel / per generation panel — read, never
  // recomputed. (The page's old "Max PV" strip did its own `bus × 1.2 − main` over `?? 200`.)
  const BUSBAR_CHECKS = new Set(['domain.busbar-705-12', 'aggregation.busbar']);
  for (const c of checks.filter(x => BUSBAR_CHECKS.has(x.id))) {
    engineering.push({
      id: `engineering.${c.id}.${c.scope}`,
      section: 'engineering',
      question: c.title,
      state: c.conclusion === 'PASS' ? 'calculated' : c.conclusion === 'FAIL' ? 'fails' : 'needs-verification',
      answer: c.conclusion === 'NOT_EVALUATED' ? `NOT EVALUATED — ${c.detail}` : `${c.conclusion} — ${c.detail}`,
      source: 'SolarPro calculation',
    });
  }
  // 🚨 WHAT THE ENGINEERING STILL NEEDS, AND FROM WHOM. A check that is NOT EVALUATED names the
  // input it is waiting on; an installer must be told what that is and who owes it, or "release
  // blocked" is a verdict with no next step. Read from the overview the Service Topology tab already
  // computed (deduplicated, installer-labelled, owner-classified) — not re-derived here.
  if (t && input.evaluation) {
    const overview = buildServiceOverview(t, input.evaluation);
    // 🚨 "HOW DOES THE NEW SOLAR CONNECT?" WHERE NO QUESTION ASKS IT. `behavior.pv-connection` is asked
    // only beside storage; on any other job the engine's `pv.coupling` check still waits on the graph's
    // coupling, and the Service Topology inspector was the only place to record it. The need carries the
    // answers the equipment supports (capability, never brand), and is answered where it stands.
    const couplingOptions = (): InterviewOption[] | undefined => {
      const ac: InterviewOption = { value: 'ac-coupled-inverter', label: 'Through an external PV inverter',
        detail: 'The PV has its own inverter and connects on AC.' };
      if (hasPv) {
        if (eq.pvInverter.state === 'CONFLICT') return undefined;   // resolved where the conflict is raised
        if (eq.pvInverter.state === 'SELECTED') return [ac];
        return [...(eq.storage?.pvInput ? [{ value: 'dc-coupled-storage', label: `Directly to ${storageLabel} PV inputs`,
          detail: 'The strings land on the battery’s own DC inputs; no separate PV inverter.' }] : []), ac];
      }
      return hasStorage ? [{ value: 'storage-only', label: 'No PV — storage only' }] : undefined;
    };
    for (const r of overview.requiredInputs.filter(x => x.owner !== 'optional-calculation')) {
      const owner = REQUIREMENT_OWNERS.find(o => o.owner === r.owner);
      const options = r.key === 'interconnection.solarCoupling' ? couplingOptions() : undefined;
      engineering.push({
        ...(options ? { options, value: null } : {}),
        id: `engineering.needs.${r.key}`,
        section: 'engineering',
        question: r.label,
        state: 'needs-verification',
        answer: 'Needed',
        source: r.owner === 'utility-must-provide' || r.owner === 'jurisdiction-authority'
          ? 'Utility / AHJ ruling required'
          : r.owner === 'manufacturer-authority' ? 'Manufacturer specification' : 'Not established',
        why: r.because,
        owner: owner ? `${owner.heading} — ${owner.action}` : undefined,
      });
    }
  }
  const fails = checks.filter(c => c.conclusion === 'FAIL');
  const requiredUnknown = checks.filter(c => c.conclusion === 'NOT_EVALUATED' && !isOptionalCheck(c));
  engineering.push({
    id: 'engineering.overall',
    section: 'engineering',
    question: 'Does the engineered service pass?',
    state: fails.length > 0 ? 'fails' : requiredUnknown.length > 0 ? 'needs-verification'
      : checks.length > 0 ? 'calculated' : 'needs-answer',
    answer: checks.length === 0 ? (t ? 'Not evaluated yet' : 'No service recorded yet')
      : `${checks.filter(c => c.conclusion === 'PASS').length} pass · ${fails.length} fail · `
        + `${requiredUnknown.length} not evaluated`,
    source: 'SolarPro calculation',
  });

  // Utility facts & disconnecting means — lib/electrical/systemConfigUtilityDisconnects.ts
  const udItems = buildUtilityDisconnectsItems(input), udDrop = supersededByUtilityDisconnects(input, udItems);
  for (let k = engineering.length - 1; k >= 0; k--) if (udDrop.has(engineering[k].id)) engineering.splice(k, 1);
  for (const i of udItems) { const a = ({ service, equipment, behavior, engineering } as Record<string, InterviewItem[]>)[i.section]; a?.splice(i.section === 'engineering' ? a.length - 1 : a.length, 0, i); }
  // Per system: its controller / batteries / expansions, where its batteries land, and which panels
  // are backed up (adds "Only the panels I choose" to 4b) — lib/electrical/systemConfigSystemEquipment.ts.
  placeSystemEquipmentItems({ equipment, behavior }, buildSystemEquipmentItems(input), input);
  // Optional full load analysis — lib/electrical/systemConfigLoadAnalysis.ts (before the overall verdict, which is the card's summary)
  engineering.splice(engineering.findIndex(i => i.id === 'engineering.overall'), 0, ...buildLoadAnalysisItems(input));
  // The generation / combiner panels' part, busbar and SCCR — lib/electrical/systemConfigGenerationPanels.ts
  const gpItem = buildGenerationPanelsItem(input);
  if (gpItem) {
    const gpDrop = supersededByGenerationPanels(input, [gpItem]);
    for (let k = engineering.length - 1; k >= 0; k--) if (gpDrop.has(engineering[k].id)) engineering.splice(k, 1);
    engineering.splice(engineering.findIndex(i => i.id === 'engineering.overall'), 0, gpItem);
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  const sectionOf = (id: SectionId, title: string, items: InterviewItem[], summary: string): InterviewSection => ({
    id, title, items, summary,
    status: items.some(i => i.state === 'fails') ? 'fails'
      : items.some(i => i.state === 'needs-answer') ? 'needs-answer'
        : items.some(i => i.state === 'needs-verification' || i.state === 'derived') ? 'needs-verification'
          : 'complete',
  });

  const sections: InterviewSection[] = [
    sectionOf('design', 'PV Design', design, design[0].answer ?? 'Not established — place the modules in Design'),
    sectionOf('service', 'Existing Electrical Service', service, rated === null
      ? 'Service rating not entered'
      : `${rated} A${t && t.branches.length > 1
          ? ` · ${countWord(t.branches.length)} × ${[...new Set(t.branches.map(b => b.ratedAmps))].join('/')} A main panels`
          : t && t.panels.length === 1 ? ` · one ${t.panels[0].busbarRatingA ?? '—'} A bus main panel` : ''}`
        + (t ? ` · ${phaseLabel(t.service.phase)}` : '')),
    sectionOf('equipment', 'Equipment', equipment, [
      equipment[0].answer ? `PV inverter: ${equipment[0].answer}` : 'PV inverter not chosen',
      hasStorage ? storageInWords(eq.storage!) : 'No storage selected',
      eq.gateway && eq.gateway.count > 0 ? controllersInWords(eq.gateway) : null,
    ].filter(Boolean).join(' · ')),
    sectionOf('behavior', 'System Behavior & Connection', behavior,
      behavior.length === 0 ? 'Nothing to connect yet'
        : behavior.filter(i => i.answer).map(i => i.answer).slice(0, 3).join(' · ') || 'Questions open'),
    sectionOf('engineering', 'Engineering Result', engineering,
      engineering[engineering.length - 1].answer ?? ''),
  ];

  const order: SectionId[] = ['design', 'service', 'equipment', 'behavior', 'engineering'];
  const openQuestions = sections
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .flatMap(s => s.items.filter(i => i.state === 'needs-answer' && s.id !== 'engineering'));

  // ── Drawable vs release-ready ────────────────────────────────────────────
  const drawable = !input.architectureConflict
    && (pvArray.moduleCount === 0 || (hasPv && !!pvArray.module));
  const blockers: string[] = [];
  if (input.architectureConflict) blockers.push('The electrical architecture is in conflict and must be resolved.');
  for (const q of openQuestions) blockers.push(`${q.question} — not answered.`);
  // A contradiction in the physical design is not a question waiting for an answer — it is wrong.
  for (const d of design.filter(x => x.state === 'fails')) blockers.push(`${d.question} ${d.answer ?? ''}`.trim());
  if (fails.length > 0) blockers.push(`${fails.length} engineering check${fails.length === 1 ? '' : 's'} fail.`);
  if (requiredUnknown.length > 0) {
    blockers.push(`${requiredUnknown.length} required check${requiredUnknown.length === 1 ? '' : 's'} not evaluated.`);
  }
  // ── The engineered project, stated precisely ─────────────────────────────
  // 🚨 PV PRODUCTION CAPACITY IS NOT ESS DISCHARGE CAPACITY. "INVERTER: 4 × Powerwall 3" is the
  // summary Ray rejected: the PV inverter on a DC-coupled job is NONE, and the batteries' AC output is
  // a separate fact with its own number.
  const facts: SummaryFact[] = [];
  facts.push({ label: 'PV modules', value: pvArray.moduleCount === null ? 'Not established' : String(pvArray.moduleCount),
    source: pvArray.moduleCount === null ? 'Not established' : 'From Design' });
  facts.push({ label: 'PV DC size', value: pvArray.dcStcKw === null ? 'Not established' : `${pvArray.dcStcKw.toFixed(2)} kW`,
    source: pvArray.dcStcKw === null ? 'Not established' : 'From Design' });
  facts.push({
    label: 'PV architecture',
    value: input.coupling === 'dc-coupled-storage' ? `DC coupled to ${storageLabel}`
      : input.coupling === 'ac-coupled-inverter' ? 'PV on its own AC inverter'
        : input.coupling === 'storage-only' ? 'No PV — storage only'
          : eq.pvInverter.state === 'SELECTED' ? 'PV on its own AC inverter' : 'Not decided',
    source: input.couplingIsDecision ? 'Installer decision'
      : input.coupling || eq.pvInverter.state === 'SELECTED' ? 'Selected equipment' : 'Not established',
  });
  facts.push({ label: 'PV inverter', value: equipment[0].answer ?? 'Not chosen',
    source: equipment[0].source ?? 'Not established' });
  // 🚨 PV AC OUTPUT EXISTS ONLY WHERE A PV INVERTER DOES. On a DC-coupled job the strings land on the
  // batteries' own inputs: there is no PV AC rating to state, and the batteries' AC output is the ESS
  // line below, never this one. An inverter chosen with no catalogue rating is "not evaluated", not 0.
  {
    const inv = eq.pvInverter;
    const decidedSource: FactSource = input.couplingIsDecision ? 'Installer decision' : 'Selected equipment';
    const pvAc: Pick<SummaryFact, 'value' | 'source'> = inv.state === 'CONFLICT'
      ? { value: 'Not established — the architecture is in conflict', source: 'Not established' }
      : input.coupling === 'dc-coupled-storage' && inv.state !== 'SELECTED'
        ? { value: 'N/A — DC coupled', source: decidedSource }
        : !hasPv || input.coupling === 'storage-only'
          ? { value: 'N/A — no PV', source: pvArray.moduleCount === null ? 'Not established' : 'From Design' }
          : inv.state === 'NONE'
            ? { value: 'N/A — no PV inverter', source: 'Installer decision' }
            : inv.state === 'SELECTED'
              ? (typeof inv.acKw === 'number' && inv.acKw > 0
                ? { value: `${inv.acKw.toFixed(2)} kW`, source: 'Manufacturer specification' }
                : { value: 'Not evaluated — no catalogue AC rating', source: 'Not established' })
              : { value: 'Not established — no PV inverter chosen', source: 'Not established' };
    facts.push({ label: 'PV AC output', ...pvAc });
  }
  // 🚨 A STRING IS SIZED AGAINST THE INPUT IT LANDS ON. With no PV inverter chosen and the strings
  // not landed on a battery's own PV inputs, the engine's partition was sized against nothing the
  // project contains — stating it as "SolarPro calculation" would present a fabricated design.
  const stringsHaveALanding = eq.pvInverter.state === 'SELECTED' || input.coupling === 'dc-coupled-storage';
  if (hasPv && !stringsHaveALanding) {
    facts.push({ label: 'PV strings', value: 'Not derived — nothing is chosen for the strings to land on',
      source: 'Not established' });
  } else if (input.derivedStrings && input.derivedStrings.length > 0 && hasPv) {
    const counts = input.derivedStrings.map(x => x.panelCount);
    facts.push({ label: 'PV strings', value: `${counts.length} (${counts.join(' / ')})`, source: 'SolarPro calculation' });
  }
  facts.push({ label: 'Storage', value: hasStorage ? storageInWords(eq.storage!) : 'None selected',
    source: 'Selected equipment' });
  const essA = input.evaluation?.storageSummary.totalContinuousOutputA ?? null;
  if (hasStorage) {
    // A × V is the single-phase relationship; on any other electrical system it is not computed here.
    const v = t?.service.phase === 'split-240' ? 240 : null;
    facts.push({
      label: 'ESS max continuous AC output',
      value: essA !== null && v !== null ? `${(essA * v / 1000).toFixed(2)} kW (${essA} A)`
        : essA !== null ? `${essA} A` : 'Not evaluated',
      source: essA !== null ? 'Manufacturer specification' : 'Not established',
    });
  }
  if (eq.gateway && eq.gateway.count > 0) {
    facts.push({ label: 'Backup controllers', value: controllersInWords(eq.gateway),
      source: 'Selected equipment' });
  } else if (hasStorage) {
    // Storage with no controller recorded is stated, not left out: required-but-missing is a gap the
    // Battery card answers; not required is the catalogue's statement about this battery.
    facts.push(eq.storage!.requiresGateway
      ? { label: 'Backup controllers', value: 'None selected — the storage requires one', source: 'Not established' }
      : { label: 'Backup controllers', value: 'None — not required by the storage', source: 'Manufacturer specification' });
  }
  facts.push({ label: 'Service', value: rated !== null ? `${rated} A` : 'Not entered',
    source: rated !== null ? 'Installer entered' : 'Not established' });
  if (t && t.panels.length > 0) {
    const sizes = [...new Set(t.panels.map(p => p.busbarRatingA))];
    const noun = `main panel${t.panels.length === 1 ? '' : 's'}`;
    facts.push({
      label: 'Distribution',
      // A bus rating nobody has entered is said so — never drawn as "— A".
      value: sizes.length === 1
        ? (sizes[0] == null ? `${t.panels.length} ${noun} — bus rating not entered` : `${t.panels.length} × ${sizes[0]} A ${noun}`)
        : t.panels.map(p => `${p.label} ${p.busbarRatingA != null ? `${p.busbarRatingA} A` : 'bus not entered'}`).join(' · '),
      source: 'Installer entered',
    });
  }

  return {
    summaryFacts: facts,
    sections,
    openQuestions,
    release: { drawable, releaseReady: drawable && blockers.length === 0, blockers },
    evaluation: input.evaluation ?? null,
  };
}
