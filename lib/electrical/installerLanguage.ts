// ═══════════════════════════════════════════════════════════════════════════
// 🚨 INSTALLER LANGUAGE — the primary UI does not speak SolarPro's internals.
//
// Ray: "SolarPro must remain usable by a competent solar installer who does not know SolarPro's
// internal model. Primary UI must use installer language. Do not expose internal concepts unless
// under Advanced/Developer."
//
//   instead of          prefer
//   ────────────────────────────────────────────
//   selected-equipment  Equipment selection
//   service-topology    Service topology
//   derived             Calculated by SolarPro
//   unresolved          Not answered yet
//
// The electrical conflict panel printed `selected-equipment: A separate PV inverter is on the
// project…` — a store name, in the primary UI, on the one screen an installer reads when something
// is wrong. The sentence after the colon was written for a person; the word before it was not.
//
// 🚨 AND THE SOURCE IS STILL THE SOURCE. This maps for DISPLAY only. The model's `ElectricalSource`
// values are unchanged, every test still asserts them, and the developer inspector still prints the
// raw names — because a diagnostic that renames things is harder to use, not easier.
// ═══════════════════════════════════════════════════════════════════════════

import type { ElectricalSource } from '@/lib/electrical/projectModel';

/** What an installer would call each store. */
export const SOURCE_LABEL: Record<ElectricalSource, string> = {
  'service-topology': 'Service topology',
  'selected-equipment': 'Equipment selection',
  'engineering-config': 'Engineering settings',
  'derived': 'Calculated by SolarPro',
  'none': 'Not recorded',
};

export const sourceLabel = (s: ElectricalSource): string => SOURCE_LABEL[s] ?? String(s);

/**
 * 🚨 WHAT A "NEEDS INPUT" ITEM MUST SAY. Ray: "Every NEEDS INPUT item must explain: what information
 * is needed; why it matters; who supplies it; whether it blocks the current task. Do not dump
 * internal requirements at the user."
 *
 * A shape rather than a string, so a surface cannot render three of the four and call it explained.
 */
export interface NeedsInput {
  /** The question, in the installer's words. */
  what: string;
  /** Why it matters — the engineering consequence, not the implementation. */
  why: string;
  /** Who supplies it. */
  who: string;
  /** Does this stop the task in hand? */
  blocks: boolean;
  /** What is blocked, when it blocks. */
  blocksWhat?: string;
}

/**
 * The architecture conflict, as a NEEDS INPUT item.
 *
 * One place, so the sidebar, System Config and the SLD refusal cannot word the same question three
 * ways — which is how an installer ends up believing they are three different problems.
 */
export const ARCHITECTURE_NEEDS_INPUT: NeedsInput = {
  what: 'Where do the PV strings land — on a separate inverter, or straight into the batteries?',
  why: 'The two designs are wired differently and are checked against different equipment limits. '
    + 'Until it is answered, the string sizing, the conductor schedule and the busbar check have no '
    + 'single system to evaluate.',
  who: 'The installer or designer who knows what is physically on the wall. SolarPro cannot read it '
    + 'from the saved project, because the equipment on it was suggested automatically rather than '
    + 'chosen.',
  blocks: true,
  blocksWhat: 'the single-line diagram, the bill of materials and the permit package. The rest of '
    + 'the project — service, storage, structural — keeps working.',
};

/** The generation-panel question, for the topology wizard. */
export const AGGREGATION_NEEDS_INPUT: NeedsInput = {
  what: 'How are the battery AC circuits combined before the gateway?',
  why: 'Each answer is governed by a different code rule, so the busbar check cannot be evaluated '
    + 'until one is chosen.',
  who: 'Whoever specified the install — it is a physical arrangement, not a preference.',
  blocks: false,
  blocksWhat: 'the 120% busbar conclusion reports NOT EVALUATED until it is answered; nothing else '
    + 'stops.',
};
