// ═══════════════════════════════════════════════════════════════════════════
// HOW MANY ENPHASE GATEWAY TOPOLOGIES (IQ COMBINERS / STANDALONE ENVOYS) A
// DESIGN NEEDS, AND WHICH BRANCH CIRCUITS LAND ON EACH — the first proven
// implementation of lib/equipment/equipmentMultiplicity.ts.
//
// Ray, 2026-09-26: "one Envoy/Gateway topology supports a maximum of 80 A
// export … requiredGatewayCount = ceil(requiredSupportedCurrent /
// selectedGatewayCapacity) subject to the actual selected Enphase equipment
// topology and any more restrictive manufacturer limits." Not one per site, not
// one per array, not one per brand.
//
// THE CURRENT a gateway supports is the Σ of the RATED CONTINUOUS AC OUTPUT
// CURRENT of the microinverters whose branch circuits land on it — the NEC
// 690.8(A)(1)(e) inverter output current — taken from the manufacturer's
// per-unit rating (ENPHASE_CAPABILITY_PROFILES.acOutputCurrentPerUnit: IQ8+
// 1.21 A, IQ8M 1.39 A …) on the same balanced branch split computeSystem and
// planMicroBranches use. Every consumer (drawings, permit, BOM, page) can form
// exactly these numbers from the model, the device count and the branch count,
// so every consumer gets the same count and the same assignment. A model with
// no rating on file counts each branch at 80 % of its OCPD (16 A on a 20 A
// branch) — the most that branch may carry — rather than guessing low.
//
// THE LIMITS: Ray's 80 A on every gateway topology, and each device's own,
// tighter, datasheet limits (branch positions; 64 A continuous and 80 A of
// branch breakers on the IQ Combiner 4/4C and 5/5C). The table lives here, not
// on the catalogue rows, so no resolved device object gains a key.
//
// Branch circuits are never split between gateways; an array stays on one
// gateway when that costs no extra gateway; one array may need two gateways,
// and two arrays may share one.
// ═══════════════════════════════════════════════════════════════════════════

import {
  solveMultiplicity,
  explainMultiplicity,
  type CapacityLimit,
  type CapacityLoad,
  type CapacityProfile,
  type MultiplicitySolution,
} from '@/lib/equipment/equipmentMultiplicity';
import { ENPHASE_CAPABILITY_PROFILES } from '@/lib/system/brandCapabilities/enphase';
import { balancedBranchSizes, microBranchMaxOcpdA } from '@/lib/permit/utils/branching';
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';

/** Ray's rule (2026-09-26): the most export current ONE Envoy / IQ Gateway
 *  topology supports. */
export const ENPHASE_GATEWAY_MAX_EXPORT_A = 80;

const RAY_GATEWAY_RULE: CapacityLimit = {
  dimension: 'continuousCurrentA',
  max: ENPHASE_GATEWAY_MAX_EXPORT_A,
  basis: 'installer-rule',
  source: 'installer rule (Ray, 2026-09-26): one Envoy / IQ Gateway topology supports at most 80 A',
};

/**
 * Each topology's own datasheet limits (tighter than, or in addition to, the
 * 80 A rule). Cited to the documents recorded in
 * lib/data/equipment/bos-devices-research.json.
 */
const TOPOLOGY_LIMITS: Record<string, CapacityLimit[]> = {
  'enphase-iq-combiner-6c': [
    { dimension: 'branchPositions', max: 5, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 6C data sheet DSH-00585-3.0: 4 × 2-pole 20 A PV branches, 5 with a quadplex breaker' },
    { dimension: 'continuousCurrentA', max: 80, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 6C data sheet DSH-00585-3.0: 80 A max continuous PV current' },
  ],
  'enphase-iq-combiner-5c': [
    { dimension: 'branchPositions', max: 4, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 5/5C data sheet IQC-5-5C-DSH-00007-1.0: up to four 2-pole branch breakers' },
    { dimension: 'continuousCurrentA', max: 64, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 5/5C data sheet IQC-5-5C-DSH-00007-1.0: 64 A max continuous input current' },
    { dimension: 'branchOcpdSumA', max: 80, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 5/5C data sheet IQC-5-5C-DSH-00007-1.0: 80 A max total branch breaker rating' },
  ],
  'enphase-iq-combiner-4c': [
    { dimension: 'branchPositions', max: 4, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 4/4C data sheet IQC-4-4C-DSH-00217-5.0: up to four 2-pole branch breakers' },
    { dimension: 'continuousCurrentA', max: 64, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 4/4C data sheet IQC-4-4C-DSH-00217-5.0: 64 A max continuous input current' },
    { dimension: 'branchOcpdSumA', max: 80, basis: 'manufacturer',
      source: 'Enphase IQ Combiner 4/4C data sheet IQC-4-4C-DSH-00217-5.0: 80 A max total branch breaker rating' },
  ],
};

/** The device (or standalone topology) one gateway instance is. */
export interface GatewayTopologyDevice {
  id: string;
  brand: string;
  model: string;
  /** Branch positions the catalogue records — used only for an Enphase
   *  topology this table does not know. */
  branchSlots?: number;
}

/**
 * The capacity profile of one instance of `topology`: Ray's 80 A plus the
 * device's own limits, plus any the caller derives from its catalogue (the
 * standalone topology's landing panel).
 */
export function enphaseGatewayProfile(
  topology: GatewayTopologyDevice,
  extraLimits: readonly CapacityLimit[] = [],
): CapacityProfile {
  const own = TOPOLOGY_LIMITS[topology.id]
    ?? (topology.branchSlots && topology.branchSlots > 0
      ? [{ dimension: 'branchPositions' as const, max: topology.branchSlots, basis: 'manufacturer' as const,
          source: `${topology.brand} ${topology.model}: ${topology.branchSlots} branch positions (catalogue)` }]
      : []);
  return {
    deviceId: topology.id,
    deviceLabel: `${topology.brand} ${topology.model}`,
    instanceNoun: 'GATEWAY',
    limits: [RAY_GATEWAY_RULE, ...own, ...extraLimits],
  };
}

const _norm = (s: string) => s.toLowerCase().replace(/plus/g, '+').replace(/[^a-z0-9+]/g, '');

/** The manufacturer's rated continuous AC output current per unit (A), or null
 *  when no rating is on file for the model. Longest model-name match wins
 *  ('IQ8AC' must not resolve via 'IQ8A') — the rule microMaxPerBranch uses. */
export function enphaseUnitContinuousCurrentA(inverterModel: string | null | undefined): number | null {
  const m = _norm(String(inverterModel ?? ''));
  if (!m) return null;
  let best: number | null = null;
  let bestLen = -1;
  for (const prof of ENPHASE_CAPABILITY_PROFILES) {
    const key = _norm(prof.modelName);
    const v = prof.branchCircuit?.acOutputCurrentPerUnit;
    if (key && m.includes(key) && key.length > bestLen && typeof v === 'number' && v > 0) {
      best = v;
      bestLen = key.length;
    }
  }
  return best;
}

/** One array's (lane's) branch circuits, as every consumer can state them. */
export interface EnphaseBranchSource {
  /** 'roof' | 'ground' | 'fence' on a hybrid; '' on a single system. */
  laneKey: string;
  inverterModel: string;
  /** Microinverters on this array. */
  deviceCount: number;
  /** AC branch circuits on this array. */
  branchCount: number;
}

export interface GatewayBranch {
  /** 'B3' on a single system, 'ground:B1' on a hybrid lane. */
  id: string;
  laneKey: string;
  /** 1-based, within its lane — the number the drawing prints. */
  branchNumber: number;
  deviceCount: number;
  /** Σ rated continuous output current of its micros (A). */
  continuousA: number;
  /** Its branch OCPD (A). */
  ocpdA: number;
}

/** The branch circuits of one array, as capacity loads. */
export function enphaseBranches(src: EnphaseBranchSource): GatewayBranch[] {
  const n = Math.max(0, Math.floor(src.branchCount || 0));
  if (n === 0) return [];
  const sizes = balancedBranchSizes(Math.max(0, Math.floor(src.deviceCount || 0)), n);
  const unitA = enphaseUnitContinuousCurrentA(src.inverterModel);
  const ocpdA = microBranchMaxOcpdA(src.inverterModel, 'Enphase');
  return sizes.map((size, i) => ({
    id: src.laneKey ? `${src.laneKey}:B${i + 1}` : `B${i + 1}`,
    laneKey: src.laneKey,
    branchNumber: i + 1,
    deviceCount: size,
    continuousA: unitA != null ? Math.round(size * unitA * 1e6) / 1e6 : ocpdA * 0.8,
    ocpdA,
  }));
}

const toLoad = (b: GatewayBranch): CapacityLoad => ({
  id: b.id,
  group: b.laneKey,
  demand: { continuousCurrentA: b.continuousA, branchOcpdSumA: b.ocpdA, branchPositions: 1, devices: b.deviceCount },
});

export interface GatewayInstance {
  /** 1-based, site-wide (a hybrid numbers across its topologies). */
  index: number;
  /** 'GATEWAY 1' — what every artefact calls this instance. */
  label: string;
  deviceId: string;
  /** e.g. 'Enphase IQ Combiner 5C'. */
  deviceLabel: string;
  /** In design order. */
  branches: GatewayBranch[];
  /** The arrays whose branches land here, in design order. */
  laneKeys: string[];
  deviceCount: number;
  /** Σ branch continuous current (A) — what Ray's 80 A is checked against. */
  continuousCurrentA: number;
  /** Σ branch OCPD (A). */
  branchOcpdSumA: number;
  /** The breaker this instance's output lands on when it feeds a shared PV
   *  panel: next standard size ≥ 125 % of its continuous current (NEC 690.8(B)). */
  outputOcpdA: number;
  /** One service ⇒ one set of consumption CTs, read by ONE gateway. Set by the
   *  collection (the first instance whose device can read consumption). */
  readsSiteConsumption: boolean;
}

export interface GatewayMultiplicity {
  deviceId: string;
  deviceLabel: string;
  count: number;
  instances: GatewayInstance[];
  solution: MultiplicitySolution;
  /** One sentence: why this many. */
  explanation: string;
}

/** Branch-range text for a list of branches of one lane: 'B1–B4', 'B1, B3'. */
export function branchRangeText(branches: ReadonlyArray<Pick<GatewayBranch, 'branchNumber'>>): string {
  const nums = branches.map(b => b.branchNumber);
  if (!nums.length) return '—';
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (contiguous) return nums.length === 1 ? `B${nums[0]}` : `B${nums[0]}–B${nums[nums.length - 1]}`;
  return nums.map(n => `B${n}`).join(', ');
}

/**
 * Solve one topology's gateway instances over the arrays that share it.
 * `indexOffset` numbers the instances after those of another topology on the
 * same site (hybrid). Instance 1 of the site is marked `readsSiteConsumption`
 * only by the collection, which knows every topology; here it is false.
 */
export function resolveGatewayMultiplicity(args: {
  topology: GatewayTopologyDevice;
  sources: readonly EnphaseBranchSource[];
  extraLimits?: readonly CapacityLimit[];
  indexOffset?: number;
}): GatewayMultiplicity {
  const profile = enphaseGatewayProfile(args.topology, args.extraLimits ?? []);
  const branches = args.sources.flatMap(enphaseBranches);
  const byId = new Map(branches.map(b => [b.id, b]));
  const solution = solveMultiplicity(profile, branches.map(toLoad));
  const offset = Math.max(0, Math.floor(args.indexOffset ?? 0));
  const instances: GatewayInstance[] = solution.instances.map(inst => {
    const bs = inst.loadIds.map(id => byId.get(id)!);
    const continuous = Math.round(bs.reduce((s, b) => s + b.continuousA, 0) * 1e6) / 1e6;
    return {
      index: offset + inst.index,
      label: `GATEWAY ${offset + inst.index}`,
      deviceId: profile.deviceId,
      deviceLabel: profile.deviceLabel,
      branches: bs,
      laneKeys: [...new Set(bs.map(b => b.laneKey))],
      deviceCount: bs.reduce((s, b) => s + b.deviceCount, 0),
      continuousCurrentA: continuous,
      branchOcpdSumA: bs.reduce((s, b) => s + b.ocpdA, 0),
      outputOcpdA: continuous > 0 ? nextStandardOcpd(continuous * 1.25) : 0,
      readsSiteConsumption: false,
    };
  });
  return {
    deviceId: profile.deviceId,
    deviceLabel: profile.deviceLabel,
    count: instances.length,
    instances,
    solution,
    explanation: explainMultiplicity(solution),
  };
}
