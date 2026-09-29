// ═══════════════════════════════════════════════════════════════════════════
// "400 AMP SERVICE, TWO 200 AMP PANELS" — SAID ONCE, BUILT CORRECTLY.
//
// Ray: "SolarPro should ask an electrician questions in the language an electrician thinks in.
// Ray should think: 400 amp service, two 200 amp panels, back up both, one Gateway/Powerwall stack
// per panel. SolarPro translates that into the graph. Ray should not have to think: create branch
// object → create panel object → create domain object → resolve semantic role."
//
// 🚨 A CONVENIENCE PRESET, NOT A NEW ELECTRICAL AUTHORITY — Ray's words. Every function here is a
// composition of `lib/electrical/topologyAuthoring.ts`; this file creates no graph object itself,
// looks up no catalogue row and states no ampere rating of its own. Delete it and the topology is
// still buildable by hand, which is the test of whether it is a shortcut or a second model.
// ═══════════════════════════════════════════════════════════════════════════

import {
  createServiceTopology, addServiceBranch, addPanel, updateBranch,
} from '@/lib/electrical/topologyAuthoring';
import type { ServiceTopology, ServicePhase } from '@/lib/electrical/serviceTopology';

/** The sizes the picker offers. `null` is "Custom" — the operator types the rating. */
export const SERVICE_SIZE_CHOICES: ReadonlyArray<number> = [100, 125, 150, 200, 320, 400, 600, 800];

/**
 * The rating each equal branch gets.
 *
 * 🚨 ONE FUNCTION, USED BY BOTH THE SENTENCE AND THE GRAPH. Written twice, they diverge on every
 * service size that does not divide evenly — 125 A over two panels described as "62.5 A" and built
 * as 62 A, 500 A over three described as 167 A and built as 166 A. A preset whose description and
 * whose result disagree is worse than no preset, because the operator stops reading it.
 */
export const presetBranchAmps = (serviceAmps: number, branches: number): number =>
  Math.floor(serviceAmps / Math.max(1, branches));

export interface DistributionPreset {
  id: string;
  /** What an electrician calls it. */
  label: string;
  /** What it will build, so the choice is not a surprise. */
  describe: (serviceAmps: number) => string;
  /** How many equal service branches, each with its own panel. `null` ⇒ operator-chosen. */
  branches: number | null;
}

/**
 * How the service is distributed.
 *
 * Each preset says how many EQUAL branches to create. The branch rating is the service rating
 * divided by that count — which is the arrangement the preset names, and nothing more. A service
 * whose branches are not equal is built with "Custom" (or by adding branches one at a time in
 * Advanced), because guessing an unequal split would be engineering by menu.
 */
export const DISTRIBUTION_PRESETS: ReadonlyArray<DistributionPreset> = [
  {
    id: 'one-main-panel',
    label: 'One main panel',
    describe: a => `One ${presetBranchAmps(a, 1)} A service branch feeding one `
      + `${presetBranchAmps(a, 1)} A main panel.`,
    branches: 1,
  },
  {
    id: 'two-main-panels',
    label: 'Two main panels',
    describe: a => `Two ${presetBranchAmps(a, 2)} A service branches, each feeding its own `
      + `${presetBranchAmps(a, 2)} A main panel.`,
    branches: 2,
  },
  {
    id: 'three-main-panels',
    label: 'Three main panels',
    describe: a => `Three ${presetBranchAmps(a, 3)} A service branches, each feeding its own panel.`,
    branches: 3,
  },
  {
    id: 'custom',
    label: 'Custom',
    describe: () => 'Start with the service only and add each branch and panel yourself.',
    branches: null,
  },
];

export interface ServicePresetOptions {
  ratedAmps: number;
  voltage?: number;
  phase?: ServicePhase;
  /** A preset id from `DISTRIBUTION_PRESETS`. `'custom'` creates the service and nothing else. */
  distribution: string;
  /** Used only when the preset is `'custom'`: how many equal branches to create (0 ⇒ none). */
  customBranches?: number;
  /** Per-branch rating override. Absent ⇒ the service rating divided equally. */
  branchAmps?: number | null;
}

export interface ServicePresetResult {
  topology: ServiceTopology;
  /** Human sentences describing exactly what was created, for the wizard's confirmation. */
  created: string[];
}

/**
 * Build a service and its distribution in one step.
 *
 * 🚨 THE DIVISION IS EXACT OR IT IS NOT DONE. `400 / 2 = 200` is a real arrangement. `400 / 3` is
 * not a standard panel rating, so a non-integer split is rounded DOWN to the nearest whole ampere
 * and the remainder is simply left unallocated — the overview then shows "N A unassigned" and asks
 * the operator, rather than silently inventing a rating that no breaker is made in.
 */
export function buildServiceFromPreset(opts: ServicePresetOptions): ServicePresetResult {
  const created: string[] = [];
  let t = createServiceTopology({
    ratedAmps: opts.ratedAmps, voltage: opts.voltage, phase: opts.phase,
  });
  created.push(`${opts.ratedAmps} A service`);

  const preset = DISTRIBUTION_PRESETS.find(p => p.id === opts.distribution);
  const count = preset?.branches ?? Math.max(0, Math.floor(opts.customBranches ?? 0));
  if (count <= 0) return { topology: t, created };

  const per = opts.branchAmps ?? presetBranchAmps(opts.ratedAmps, count);
  for (let i = 0; i < count; i++) {
    const branch = addServiceBranch(t, { ratedAmps: per });
    t = branch.topology;
    const panel = addPanel(t, { busbarRatingA: per, mainBreakerA: per });
    // The feed is RECORDED, not left to be inferred later from ordinal position.
    t = updateBranch(panel.topology, branch.branch.id, { panelIds: [panel.panel.id] });
    created.push(`${branch.branch.label} — ${per} A → ${panel.panel.label} (${per} A bus, ${per} A main)`);
  }
  return { topology: t, created };
}

/**
 * Add one more equal branch-and-panel pair to an existing service.
 *
 * This is the "+ Add second 200 A branch" action the overview offers when a 400 A service has only
 * 200 A allocated. It takes the rating explicitly: the caller has already computed and SHOWN the
 * number, so the action cannot do something other than what the button says.
 */
export function addBranchWithPanel(
  t: ServiceTopology, ratedAmps: number,
): { topology: ServiceTopology; created: string[] } {
  const branch = addServiceBranch(t, { ratedAmps });
  const panel = addPanel(branch.topology, { busbarRatingA: ratedAmps, mainBreakerA: ratedAmps });
  return {
    topology: updateBranch(panel.topology, branch.branch.id, { panelIds: [panel.panel.id] }),
    created: [`${branch.branch.label} — ${ratedAmps} A → ${panel.panel.label}`],
  };
}

/**
 * The four disconnect ROLES, described where they sit.
 *
 * Ray: "Show the semantic roles clearly... Do not expose four vague buttons without showing where
 * they sit in the topology." So the wizard and the advanced strip both render from this list, and
 * a role's meaning is written once.
 */
export interface DisconnectRoleSpec {
  role: 'service-disconnect' | 'der-isolation-disconnect' | 'gateway-isolation' | 'ess-disconnect';
  label: string;
  /** Where it sits in the chain. */
  where: string;
  /** What it is for. */
  purpose: string;
  /** Sensible defaults for the device this role creates. Ratings still come from the topology. */
  lockableOpen: boolean;
  visibleOpen: boolean;
}

export const DISCONNECT_ROLES: ReadonlyArray<DisconnectRoleSpec> = [
  {
    role: 'service-disconnect',
    label: 'Service disconnect',
    where: 'Between the revenue meter and the service distribution.',
    purpose: 'Disconnects the premises wiring from the service conductors. Its location is what '
      + 'decides where the neutral-ground bond belongs.',
    lockableOpen: true,
    visibleOpen: false,
  },
  {
    role: 'der-isolation-disconnect',
    label: 'Utility DER isolation',
    where: 'Adjacent to the revenue meter, accessible to the utility.',
    purpose: 'Isolates every on-site generator and storage device from the utility. Required by '
      + 'some utilities and not by others — the project\'s interconnection authority decides.',
    lockableOpen: true,
    visibleOpen: true,
  },
  {
    role: 'gateway-isolation',
    label: 'Gateway isolation',
    where: 'Ahead of a backup gateway / controller.',
    purpose: 'Isolates one gateway for service without dropping the rest of the site.',
    lockableOpen: true,
    visibleOpen: false,
  },
  {
    role: 'ess-disconnect',
    label: 'ESS disconnect / OCPD',
    where: 'At the energy storage equipment.',
    purpose: 'Overcurrent protection and disconnecting means for the storage itself. It is not the '
      + 'service disconnect and it is not the utility\'s isolation device.',
    lockableOpen: true,
    visibleOpen: false,
  },
];
