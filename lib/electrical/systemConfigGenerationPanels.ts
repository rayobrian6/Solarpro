// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE GENERATION / COMBINER PANEL THAT WAS BUILT — WHICH PANELBOARD, ITS BUSBAR AND ITS SCCR.
//
// Answering "AC aggregation: its own external generation / combiner panel" (Battery card) BUILDS a
// panel per system, sized from that system's own batteries (`applyPerSystemGenerationPanels`). The
// engine then waits on three facts about it that only the installer can state:
//
//   · aggregation.selection — which catalogue panelboard was chosen ("a calculated minimum is not a
//     purchase": nothing is ordered or drawn as a specific enclosure until one is);
//   · aggregation.sccr      — its interrupting rating, off that part's nameplate;
//   · aggregation.busbar    — its busbar, which is the part's, not the sizing's copy.
//
// Until Service Topology left the normal navigation these were answerable ONLY in its inspector
// ("Selected equipment", "Busbar rating", "Interrupting rating / SCCR"), so on Ray's job the readiness
// panel listed "Choose the generation panel part" and "Confirm the SCCR of Generation panel — System 1"
// with nothing to enter them in. This module is that box in System Config: ONE item, listing every
// generation panel, edited in the Battery card's [Select Equipment] dialog (or inline in Manual), in
// Review Engineering, and by [Answer Next].
//
// 🚨 A NEW PART BRINGS ITS OWN NUMBERS — the law `selectDeviceProduct` applies to disconnects
// (09bac7a), one node along. The busbar a panel carries before a part is chosen is the sizing's
// minimum copied in; the SCCR is whatever was there. Naming a different part resets both unless the
// same answer states them, so no check passes against a copy of its own requirement.
//
// Pure and isomorphic. Every write is an existing authoring function (`selectAggregationProduct`,
// `updateAggregationPanel`); nothing here builds a graph object or sizes anything.
// ═══════════════════════════════════════════════════════════════════════════

import type { InterviewInput, InterviewItem, ItemState } from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import type { DerAggregationPanel, ServiceTopology, TopologyEvaluation } from '@/lib/electrical/serviceTopology';
import { sizeAggregationPanel } from '@/lib/electrical/serviceTopology';
import { selectAggregationProduct, updateAggregationPanel } from '@/lib/electrical/topologyAuthoring';

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });

/** The one item: every generation / combiner panel on the service. */
export const GENERATION_PANELS_ITEM_ID = 'engineering.generation-panels';

const VERDICTS = new Set(['aggregation.busbar', 'aggregation.sccr', 'aggregation.output-ocpd']);

export interface GenerationPanelFacts {
  panel: DerAggregationPanel;
  /** "Generation panel — System 1" — what the card and the dialog call it. */
  label: string;
  /** The engine's requirement in words, or why it is not established. Never the service rating. */
  requirement: string;
  /** The engine's verdicts on this panel that FAIL, in its own words. */
  fails: string[];
  partChosen: boolean;
  busbarStated: boolean;
  sccrStated: boolean;
}

export function generationPanelFacts(
  t: ServiceTopology, panel: DerAggregationPanel, evaluation?: TopologyEvaluation | null,
): GenerationPanelFacts {
  const sizing = sizeAggregationPanel(t, panel);
  const requirement = sizing.standardOcpdA === null
    ? 'Requirement not established — the current entering it is not known yet'
    : `Requirement: ${sizing.standardOcpdA} A output OCPD and busbar for ${sizing.aggregateContinuousA} A of DER · `
      + `${panel.inputs.length} breaker position${panel.inputs.length === 1 ? '' : 's'}`;
  const fails = (evaluation?.checks ?? [])
    .filter(c => c.scope === `aggregation:${panel.id}` && VERDICTS.has(c.id) && c.conclusion === 'FAIL')
    .map(c => c.detail);
  return {
    panel,
    label: panel.label,
    requirement,
    fails,
    partChosen: !!panel.productId,
    busbarStated: typeof panel.busbarRatingA === 'number',
    sccrStated: typeof panel.sccrA === 'number',
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The item, when the service has any generation / combiner panel. Its state is the worst of its
 * panels': a FAILING busbar / SCCR / output verdict ⇒ fails; a panel with no part or no busbar ⇒
 * needs-answer; a panel with no SCCR ⇒ needs-verification; otherwise answered.
 */
export function buildGenerationPanelsItem(input: InterviewInput): InterviewItem | null {
  const t = input.topology;
  const panels = t?.aggregationPanels ?? [];
  if (!t || panels.length === 0) return null;
  const facts = panels.map(p => generationPanelFacts(t, p, input.evaluation));
  const state: ItemState = facts.some(f => f.fails.length > 0) ? 'fails'
    : facts.some(f => !f.partChosen || !f.busbarStated) ? 'needs-answer'
      : facts.some(f => !f.sccrStated) ? 'needs-verification' : 'answered';
  const chosen = facts.filter(f => f.partChosen).length;
  return {
    id: GENERATION_PANELS_ITEM_ID,
    section: 'engineering',
    question: panels.length === 1
      ? 'Generation panel: which panelboard, and its busbar and SCCR?'
      : `Generation panels (${panels.length}): which panelboard each, and its busbar and SCCR?`,
    state,
    answer: facts.map(f => `${f.label}: ${f.panel.productId ?? 'part not selected'}`
      + ` · bus ${f.busbarStated ? `${f.panel.busbarRatingA} A` : 'not stated'}`
      + ` · SCCR ${f.sccrStated ? `${f.panel.sccrA} A` : 'not established'}`).join(' · '),
    source: chosen === panels.length && state !== 'needs-verification' ? 'Installer entered' : 'Not established',
    why: state === 'fails'
      ? facts.flatMap(f => f.fails).join(' ')
      : 'A calculated minimum is not a purchase: nothing is ordered or drawn as a specific enclosure until a '
        + 'panelboard is chosen, and its busbar and interrupting rating (SCCR) are read off that part — '
        + `${plural(chosen, 'panel has', 'panels have')} a part of ${panels.length}.`,
    owner: 'Installer (choose the panelboard; read its busbar and SCCR off it)',
    blocks: state === 'answered' ? undefined : ['generation panel checks', 'SCCR checks', 'BOM'],
  };
}

/**
 * The generic "engineering still needs …" rows the item states in installer words. Dropped only
 * while the item exists — and the item's own state carries each of them, so nothing the engine
 * waits on disappears and nothing is asked twice.
 */
export function supersededByGenerationPanels(input: InterviewInput, items: InterviewItem[]): Set<string> {
  const drop = new Set<string>();
  const t = input.topology;
  if (!t || !items.some(i => i.id === GENERATION_PANELS_ITEM_ID)) return drop;
  drop.add('engineering.needs.aggregation.productId');
  drop.add('engineering.needs.aggregation.busbarRatingA');
  for (const p of t.aggregationPanels ?? []) drop.add(`engineering.needs.sccr:${p.id}`);
  return drop;
}

/**
 * The panelboard chosen for a generation / combiner panel, and what is read off it.
 *
 * Blank is "not stated" (null), never zero; a calculated requirement never fills these. Naming a
 * DIFFERENT part (or clearing it) resets the busbar and the SCCR unless this same answer states them.
 */
export function answerGenerationPanelPart(
  t: ServiceTopology, panelId: string,
  patch: { productId?: string | null; busbarRatingA?: number | null; sccrA?: number | null },
): AnswerResult {
  const p = (t.aggregationPanels ?? []).find(x => x.id === panelId);
  if (!p) return refuse(`No generation panel '${panelId}'.`);
  for (const [k, v] of [['busbar rating', patch.busbarRatingA], ['interrupting rating (SCCR)', patch.sccrA]] as const) {
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v <= 0)) {
      return refuse(`The panelboard’s ${k} must be a positive number of amperes, or left blank.`);
    }
  }
  let next = t;
  let partChanged = false;
  if (patch.productId !== undefined) {
    const part = patch.productId?.trim() || null;
    partChanged = part !== (p.productId ?? null);
    if (partChanged) {
      next = selectAggregationProduct(next, p.id, part);
      next = updateAggregationPanel(next, p.id, {
        busbarRatingA: patch.busbarRatingA !== undefined ? patch.busbarRatingA : null,
        sccrA: patch.sccrA !== undefined ? patch.sccrA : null,
      });
      if (part === null) return done(next, `${p.label}: part cleared — its busbar and SCCR cleared with it`);
      const unstated = patch.busbarRatingA === undefined || patch.sccrA === undefined;
      return done(next, `${p.label}: ${part} recorded${unstated
        ? ' — read its busbar and SCCR off the part; nothing the panel carried before is kept' : ''}`);
    }
  }
  const ratings: Partial<DerAggregationPanel> = {};
  if (patch.busbarRatingA !== undefined) ratings.busbarRatingA = patch.busbarRatingA;
  if (patch.sccrA !== undefined) ratings.sccrA = patch.sccrA;
  if (Object.keys(ratings).length === 0) return refuse(`Nothing to change on ${p.label}.`);
  return done(updateAggregationPanel(next, p.id, ratings),
    `${p.label}: ${[ratings.busbarRatingA !== undefined ? `busbar ${ratings.busbarRatingA ?? 'not stated'}` : null,
      ratings.sccrA !== undefined ? `SCCR ${ratings.sccrA ?? 'not established'}` : null].filter(Boolean).join(' · ')}`);
}
