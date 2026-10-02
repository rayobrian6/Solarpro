// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ARCHITECTURE BADGE — one projection, and it is a FUNCTION so it can be proven.
//
// Ray's second live acceptance run found the Engineering Intelligence badge still printing
// STRING INVERTER on a project whose canonical model had refused to pick a side. The model was
// right; the badge was a ternary chain inside an 18,000-line component:
//
//     const topologyLabel = couplingIsDc ? 'PV DC COUPLED TO STORAGE'
//       : isHybrid        ? 'HYBRID SYSTEM'
//       : type === 'micro'? 'MICROINVERTER'
//       : ...
//       : 'STRING INVERTER';          // ← `solarCoupling === null` landed HERE
//
// A null coupling means "the project does not say". The chain converted that into one of the two
// answers it would not give — and because the chain lived in JSX, nothing could test it. Every green
// test in the electrical slice passed while this line was wrong, which is what
// `live-acceptance-outranks-green-tests` means in practice.
//
// So the decision moved here. The page calls it. A test can state the whole truth table.
// ═══════════════════════════════════════════════════════════════════════════

import type { SolarCoupling } from '@/lib/electrical/serviceTopology';

export interface TopologyBadgeInput {
  /** 🚨 FIRST, ALWAYS. True ⇒ no equipment-derived label may be shown. */
  architectureResolutionRequired: boolean;
  /** The canonical coupling. null ⇒ the project does not say — which is NOT a kind of system. */
  solarCoupling: SolarCoupling | null;
  isHybrid: boolean;
  /** `'micro' | 'optimizer' | 'string' | …` off the page's first inverter entry. */
  firstInverterType: string | null | undefined;
}

export interface TopologyBadge {
  label: string;
  /** Tailwind classes for the badge, kept beside the label so the two cannot disagree. */
  tone: string;
}

export const ARCHITECTURE_UNRESOLVED_LABEL = 'ARCHITECTURE REQUIRES RESOLUTION';

/**
 * What the Engineering Intelligence badge says.
 *
 * The ORDER is the whole content of this function, so it is written as a sequence of returns rather
 * than a ternary chain: an unresolved architecture is not the last arm of anything.
 */
export function topologyBadge(input: TopologyBadgeInput): TopologyBadge {
  // 🚨 A CONFLICT OUTRANKS EVERY DERIVED LABEL. Nothing below this line is reachable while the
  // project holds two architectures, because every one of those labels is a claim about which.
  if (input.architectureResolutionRequired) {
    return {
      label: ARCHITECTURE_UNRESOLVED_LABEL,
      tone: 'text-rose-300 border-rose-500/50 bg-rose-500/15',
    };
  }
  if (input.solarCoupling === 'dc-coupled-storage') {
    return {
      label: 'PV DC COUPLED TO STORAGE',
      tone: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
    };
  }
  if (input.isHybrid) {
    return {
      label: 'HYBRID SYSTEM',
      tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
    };
  }
  if (input.firstInverterType === 'micro') {
    return {
      label: 'MICROINVERTER',
      tone: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
    };
  }
  if (input.firstInverterType === 'optimizer') {
    return {
      label: 'STRING + OPTIMIZER',
      tone: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
    };
  }
  return {
    label: 'STRING INVERTER',
    tone: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  };
}
