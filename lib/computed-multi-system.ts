// ═══════════════════════════════════════════════════════════════
// computeMultiSystem — Wave 2a of
// docs/ARCHITECTURE-per-subsystem-equipment.md (FROZEN CONTRACT v1.0, §1.7).
//
// Runs the EXISTING computeSystem() once per subsystem (each sub's OWN
// topology / panel / per-DEVICE inverter kW / runLengths / rooftopTempAdderC
// — 30 roof, 0 ground+fence) and aggregates at the POI:
//
//   • ONE service: the shared service tail (DISCO_TO_METER_RUN →
//     MSP_TO_UTILITY_RUN) is emitted exactly ONCE by the aggregate, sized at
//     Σ acOutputCurrentA. Per-sub calls get emitSharedServiceRuns=false so
//     the tributary double-count class is structurally dead.
//   • Run ids namespaced `${subKey}:${RunSegmentId}` ONLY at N>1; the N=1
//     path returns output deep-equal to plain computeSystem(input) — bare
//     ids, no subSystem stamps (I-1 / the Wave-0 golden basis).
//   • Aggregator OWNS NEC 705.12(B): backfeed = Σ over each PHYSICAL
//     inverter's nextStandardOCPD(inverterAmps × 1.25) within each sub,
//     summed across subs + battery — never one combined rounded breaker
//     (contract §1.7 judge fix). Per-sub 120% issues are suppressed in the
//     aggregate; exactly one POI check exists regardless of N (I-6).
//   • Equipment tags suffixed PV-R1 / INV-G1 / COMB-F1 only at N>1; shared
//     service gear (AC disco / meter / MSP) appears once.
//   • Addendum B ruling 1: when ≥2 buried subsystems (ground/fence) carry
//     trenchRunLengthFt, the result exposes `sharedTrenchFt` metadata — ONE
//     combinable trench — but conduits stay per-subsystem (no raceway merge,
//     no shared-raceway derating scenario in v1).
//
// The `aggregate` is a ComputedSystem-COMPATIBLE facade: Wave 3 aliases
// `cs = result.aggregate` for the ~15 legacy page.tsx consumers. At N>1 its
// run ids are namespaced strings at runtime (cast to RunSegmentId for drop-in
// typing) and `segments`/`segmentIssues` are absent — the single-lane SLD
// path must never render a plausible-wrong hybrid diagram (I-8; Wave 5 owns
// multi-lane).
// ═══════════════════════════════════════════════════════════════

import {
  computeSystem,
  nextStandardOCPD,
  type BomQuantities,
  type ComputedSystem,
  type ComputedSystemInput,
  type ConduitScheduleRow,
  type EquipmentScheduleRow,
  type RunSegment,
  type RunSegmentId,
  type ValidationIssue,
} from './computed-system';
import { calcDcAcRatio } from './system/calcDcAcRatio';
import { SUB_SYSTEM_KEYS, type SubSystemKey } from './system/subSystemEquipment';

// ─── Contract types ──────────────────────────────────────────────────────────

/** One subsystem's compute input: the legacy ComputedSystemInput carrying its
 *  OWN equipment/env (per-device kW, its rooftopTempAdderC, its runLengths)
 *  plus the SubSystemKey it belongs to. */
export interface MultiSubSystemInput extends ComputedSystemInput {
  subSystemKey: SubSystemKey;
  /**
   * Ground/fence only — the sub's buried run toward the POI
   * (SubSystemEquipment.trenchRunLengthFt). Drives the sharedTrenchFt
   * metadata ONLY; it never merges conduits (Addendum B ruling 1).
   */
  trenchRunLengthFt?: number;
}

/** POI (point-of-interconnection) facts. Every field optional — defaults come
 *  from the primary subsystem's own input (they are identical on every sub in
 *  a well-formed project; the override exists for explicit POI authority). */
export interface MultiSystemPoi {
  mainPanelAmps?: number;
  busRating?: number;
  interconnectionMethod?: string;
  /** POI-level battery backfeed (A) NOT attached to any subsystem input.
   *  Sub-level batteries are already counted inside their sub's
   *  backfeedBreakerAmps — never pass the same battery in both places. */
  batteryBackfeedA?: number;
}

/** Run ids on the aggregate at N>1: `${subKey}:${RunSegmentId}` for per-sub
 *  runs, bare RunSegmentId for the once-emitted shared service runs. */
export type MultiRunSegmentId = RunSegmentId | `${SubSystemKey}:${RunSegmentId}`;

export const SHARED_SERVICE_RUN_IDS: readonly RunSegmentId[] = [
  'DISCO_TO_METER_RUN',
  'MSP_TO_UTILITY_RUN',
];

export function namespacedRunId(key: SubSystemKey, id: RunSegmentId): MultiRunSegmentId {
  return `${key}:${id}`;
}

/** Split a (possibly namespaced) aggregate run id back into its parts. */
export function parseRunId(id: string): { subSystem: SubSystemKey | null; baseId: RunSegmentId } {
  const m = /^(roof|ground|fence):(.+)$/.exec(id);
  if (m) return { subSystem: m[1] as SubSystemKey, baseId: m[2] as RunSegmentId };
  return { subSystem: null, baseId: id as RunSegmentId };
}

export interface ComputedMultiSystem {
  /** Per-subsystem engine outputs, keyed by SubSystemKey. Each is a plain
   *  computeSystem result (bare run ids inside; subSystem stamped at N>1). */
  subSystems: Partial<Record<SubSystemKey, ComputedSystem>>;
  /** Present keys in the fixed contract order roof > ground > fence. */
  subSystemKeys: SubSystemKey[];
  /** §1.4 deterministic primary — first present key in roof > ground > fence. */
  primaryKey: SubSystemKey;
  /**
   * ComputedSystem-compatible facade (the legacy `cs` alias):
   *  N=1 → EXACTLY the plain computeSystem output (deep-equal, bare ids).
   *  N>1 → totalAcKw/backfeed/panels/branches summed; runs = namespaced
   *        per-sub runs + shared service runs; bomQuantities merged;
   *        runMap findable by namespaced id.
   */
  aggregate: ComputedSystem;
  /** The once-emitted shared service tail (also present in aggregate.runs). */
  sharedServiceRuns: RunSegment[];
  /**
   * Addendum B ruling 1 metadata — ONE combinable trench when ≥2 buried
   * subsystems (ground/fence) declared trenchRunLengthFt. Heuristic:
   * max(trench lengths) — both runs converge on the POI, so the shorter
   * run's path is assumed to fully overlap the longer's (the trench is dug
   * once along the longest path). Conduits remain per-subsystem; this field
   * never merges raceways and implies no conduit-fill/derating change.
   */
  sharedTrenchFt?: number;
}

// ─── Internals ───────────────────────────────────────────────────────────────

const TAG_LETTER: Record<SubSystemKey, string> = { roof: 'R', ground: 'G', fence: 'F' };

/** Service-level equipment rows shared at the POI — emitted once (I-6). */
const SHARED_EQUIPMENT_TAGS = new Set(['AC-DISC-1', 'METER-1', 'MSP-1']);

function stripMultiFields(sub: MultiSubSystemInput): ComputedSystemInput {
  const { subSystemKey: _k, trenchRunLengthFt: _t, ...core } = sub;
  return core;
}

/** `PV-1` → `PV-R1` (contract §1.7: tags suffixed only at N>1). */
function suffixTag(tag: string, key: SubSystemKey): string {
  const m = /^(.*-)(\d+)$/.exec(tag);
  return m ? `${m[1]}${TAG_LETTER[key]}${m[2]}` : `${tag}-${TAG_LETTER[key]}`;
}

/**
 * §1.7 judge fix — the sub's contribution to the POI 120% check equals its
 * PHYSICAL breaker schedule: per-inverter rounded OCPD × unit count for
 * string/optimizer/hybrid subs (never one combined rounded breaker), the
 * combiner backfeed breaker for micro subs, plus the sub's own battery bus
 * impact (already inside cs.backfeedBreakerAmps).
 */
function subBackfeedA(input: MultiSubSystemInput, cs: ComputedSystem): number {
  const batteryImpactA = Math.max(0, cs.backfeedBreakerAmps - cs.acOcpdAmps);
  if (cs.isMicro) return cs.acOcpdAmps + batteryImpactA;
  const units = Math.max(1, input.inverterCount ?? 1);
  const perInverterAmps = (input.inverterAcKw * 1000) / 240;
  return nextStandardOCPD(perInverterAmps * 1.25) * units + batteryImpactA;
}

const WASTE_FACTOR = 1.15;

/** Merge numeric BomQuantities (sum) + model strings (join distinct). */
function mergeBomQuantities(parts: BomQuantities[]): BomQuantities {
  const joinDistinct = (vals: string[]): string =>
    Array.from(new Set(vals.filter(Boolean))).join(' + ');
  const sum = (pick: (b: BomQuantities) => number): number =>
    parts.reduce((s, b) => s + (pick(b) || 0), 0);
  return {
    panels: sum(b => b.panels),
    panelModel: joinDistinct(parts.map(b => b.panelModel)),
    inverters: sum(b => b.inverters),
    inverterModel: joinDistinct(parts.map(b => b.inverterModel)),
    acCombiner: sum(b => b.acCombiner),
    trunkCable: sum(b => b.trunkCable),
    trunkCableTerminators: sum(b => b.trunkCableTerminators),
    acBranchOcpd: sum(b => b.acBranchOcpd),
    dcDisconnect: sum(b => b.dcDisconnect),
    dcOcpd: sum(b => b.dcOcpd),
    // Shared at the POI (I-6): one AC disco + one production meter set,
    // regardless of subsystem count.
    acDisconnect: 1,
    productionMeter: 1,
    conduitEMT: sum(b => b.conduitEMT),
    conduitPVC: sum(b => b.conduitPVC),
    wire10AWG: sum(b => b.wire10AWG),
    wire8AWG: sum(b => b.wire8AWG),
    wire6AWG: sum(b => b.wire6AWG),
    wire4AWG: sum(b => b.wire4AWG),
    railSections: sum(b => b.railSections),
    midClamps: sum(b => b.midClamps),
    endClamps: sum(b => b.endClamps),
    lFeet: sum(b => b.lFeet),
    lagBolts: sum(b => b.lagBolts),
    flashings: sum(b => b.flashings),
  };
}

/** Fold the shared service runs' wire/conduit footage into the merged BOM
 *  (per-sub quantities exclude the service tail by construction). The
 *  utility-owned MSP→utility run is excluded, as on the legacy path. */
function addSharedServiceFootage(bom: BomQuantities, sharedRuns: RunSegment[]): void {
  for (const run of sharedRuns) {
    if (run.isUtilityOwned) continue;
    const wireFt = Math.round(run.onewayLengthFt * run.conductorCount * WASTE_FACTOR);
    if (run.wireGauge === '#10 AWG') bom.wire10AWG += wireFt;
    else if (run.wireGauge === '#8 AWG') bom.wire8AWG += wireFt;
    else if (run.wireGauge === '#6 AWG') bom.wire6AWG += wireFt;
    else if (run.wireGauge === '#4 AWG') bom.wire4AWG += wireFt;
    if (!run.isOpenAir && run.conduitType !== 'NONE') {
      const conduitFt = Math.round(run.onewayLengthFt * WASTE_FACTOR);
      if (run.conduitType === 'EMT') bom.conduitEMT += conduitFt;
      else if (run.conduitType.startsWith('PVC')) bom.conduitPVC += conduitFt;
    }
  }
}

/** Rebuild the conduit schedule from the aggregate run set — same row shape
 *  and filter as computeSystem's own conduitSchedule derivation. */
function buildConduitSchedule(runs: RunSegment[]): ConduitScheduleRow[] {
  return runs
    .filter(r => !r.isOpenAir && r.conduitType !== 'NONE' && r.conduitSize !== 'N/A')
    .map((run, idx) => ({
      raceway: `C-${idx + 1}`,
      from: run.from,
      to: run.to,
      conduitType: run.conduitType,
      conduitSize: run.conduitSize,
      conductors: `${run.conductorCount}#${run.wireGauge.replace('#', '').replace(' AWG', '')} AWG ${run.insulation}`,
      egc: `1#${run.egcGauge.replace('#', '').replace(' AWG', '')} AWG GND`,
      neutral: run.neutralRequired ? `1#${run.wireGauge.replace('#', '').replace(' AWG', '')} AWG N` : 'N/A',
      lengthFt: run.onewayLengthFt,
      fillPct: Math.round(run.conduitFillPct),
      ampacity: `${run.effectiveAmpacity.toFixed(0)}A`,
      ocpd: `${run.ocpdAmps}A`,
      voltageDrop: `${run.voltageDropPct.toFixed(1)}%`,
      pass: run.overallPass,
    }));
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function computeMultiSystem(
  subInputs: MultiSubSystemInput[],
  poi?: MultiSystemPoi,
): ComputedMultiSystem {
  if (!Array.isArray(subInputs) || subInputs.length === 0) {
    throw new Error('computeMultiSystem: at least one subsystem input is required');
  }
  const seen = new Set<SubSystemKey>();
  for (const s of subInputs) {
    if (!SUB_SYSTEM_KEYS.includes(s.subSystemKey)) {
      throw new Error(`computeMultiSystem: invalid subSystemKey '${String(s.subSystemKey)}'`);
    }
    if (seen.has(s.subSystemKey)) {
      throw new Error(`computeMultiSystem: duplicate subSystemKey '${s.subSystemKey}' — one input per subsystem`);
    }
    seen.add(s.subSystemKey);
  }

  // Fixed contract order roof > ground > fence (§1.4) — deterministic runs
  // concat, deterministic primary, regardless of caller array order.
  const orderedKeys = SUB_SYSTEM_KEYS.filter(k => seen.has(k));
  const byKey = new Map<SubSystemKey, MultiSubSystemInput>(
    subInputs.map(s => [s.subSystemKey, s]),
  );
  const primaryKey = orderedKeys[0];

  // ── N=1: the I-1 golden basis — EXACTLY plain computeSystem ───────────────
  // subSystemKey/trenchRunLengthFt are stripped so no run is stamped and the
  // output is deep-equal to computeSystem(legacyInput): bare ids, unsuffixed
  // tags, byte-identical serialization (per the Wave-1a RunSegment.subSystem
  // doc: "stamped by computeMultiSystem only when N>1").
  if (subInputs.length === 1) {
    const only = subInputs[0];
    const cs = computeSystem(stripMultiFields(only));
    return {
      subSystems: { [only.subSystemKey]: cs },
      subSystemKeys: [only.subSystemKey],
      primaryKey: only.subSystemKey,
      aggregate: cs,
      sharedServiceRuns: cs.runs.filter(r => SHARED_SERVICE_RUN_IDS.includes(r.id)),
      sharedTrenchFt: undefined,
    };
  }

  // ── N>1: per-sub engine passes (service tail suppressed, runs stamped) ────
  const subSystems: Partial<Record<SubSystemKey, ComputedSystem>> = {};
  for (const key of orderedKeys) {
    const sub = byKey.get(key)!;
    subSystems[key] = computeSystem({
      ...stripMultiFields(sub),
      subSystemKey: key,
      emitSharedServiceRuns: false,
    });
  }
  const subList = orderedKeys.map(k => ({ key: k, input: byKey.get(k)!, cs: subSystems[k]! }));
  const primary = subList[0];

  // ── POI facts ──────────────────────────────────────────────────────────────
  const mainPanelAmps = poi?.mainPanelAmps ?? primary.input.mainPanelAmps;
  const busRating = poi?.busRating ?? primary.input.panelBusRating ?? mainPanelAmps;
  const interconnectionMethod =
    poi?.interconnectionMethod ?? primary.input.interconnectionMethod ?? 'LOAD_SIDE';
  const poiBatteryA = poi?.batteryBackfeedA ?? 0;

  const acOutputCurrentA = subList.reduce((s, x) => s + x.cs.acOutputCurrentA, 0);
  const totalAcKw = subList.reduce((s, x) => s + x.cs.totalAcKw, 0);
  const totalDcKw = subList.reduce((s, x) => s + x.cs.totalDcKw, 0);
  const totalPanels = subList.reduce((s, x) => s + x.cs.totalPanels, 0);

  // ── Shared service tail: ONE emission, sized at Σ acOutputCurrentA ────────
  // A synthetic single-string POI pass through the same engine yields the two
  // service runs with genuine legacy shape (segment-schedule back-population,
  // conductorBundle, callouts). inverterAcKw is chosen so the pass's
  // acOutputCurrentA equals the exact subsystem sum. Service-tail sizing uses
  // ambient only (POI is at grade — no rooftop adder by construction).
  const svcLen = (id: RunSegmentId): number | undefined =>
    subList.reduce<number | undefined>((best, x) => {
      const v = x.input.runLengths?.[id];
      return typeof v === 'number' ? Math.max(best ?? 0, v) : best;
    }, undefined);
  const poiPass = computeSystem({
    ...stripMultiFields(primary.input),
    topology: 'string',
    totalPanels,
    totalStrings: 1,
    configStringPanelCounts: undefined,
    inverterAcKw: (acOutputCurrentA * 240) / 1000,
    inverterCount: 1,
    inverterAcCurrentMax: acOutputCurrentA,
    rooftopTempAdderC: 0,
    runLengths: {
      ...(svcLen('DISCO_TO_METER_RUN') !== undefined ? { DISCO_TO_METER_RUN: svcLen('DISCO_TO_METER_RUN')! } : {}),
      ...(svcLen('MSP_TO_UTILITY_RUN') !== undefined ? { MSP_TO_UTILITY_RUN: svcLen('MSP_TO_UTILITY_RUN')! } : {}),
    },
    mainPanelAmps,
    panelBusRating: busRating,
    interconnectionMethod,
    batteryIds: undefined,
    batteryBackfeedA: 0,
    subSystemKey: undefined,
    emitSharedServiceRuns: true,
  });
  const sharedServiceRuns: RunSegment[] = poiPass.runs
    .filter(r => SHARED_SERVICE_RUN_IDS.includes(r.id))
    .map(r => ({ ...r, subSystem: undefined }));
  const sharedServiceSegRows = poiPass.segmentSchedule.filter(
    s => s.segmentType === 'DISCO_TO_METER' || s.segmentType === 'MSP_TO_UTILITY',
  );

  // ── Aggregate-owned NEC 705.12(B) (§1.7 / I-6) ─────────────────────────────
  const backfeedBreakerAmps =
    subList.reduce((s, x) => s + subBackfeedA(x.input, x.cs), 0) + poiBatteryA;
  const methodU = String(interconnectionMethod).toUpperCase();
  const isSupplySide = methodU.includes('SUPPLY') || methodU.includes('LINE_SIDE');
  const interconnectionPass = isSupplySide
    ? true
    : backfeedBreakerAmps + mainPanelAmps <= busRating * 1.2;

  // ── Issues: per-sub (120% checks suppressed — aggregator owns the POI),
  //    tagged with their subsystem, + exactly one aggregate POI issue ────────
  const issues: ValidationIssue[] = subList.flatMap(x =>
    x.cs.issues
      .filter(i => i.code !== 'NEC_705_12B_120PCT')
      .map(i => ({ ...i, message: `[${x.key}] ${i.message}` })),
  );
  if (!interconnectionPass) {
    issues.push({
      severity: 'error',
      code: 'NEC_705_12B_120PCT',
      message:
        `POI interconnection: Σ per-inverter backfeed ${backfeedBreakerAmps}A across ` +
        `${subList.length} sub-systems (${orderedKeys.join('+')})` +
        `${poiBatteryA > 0 ? ` incl. ${poiBatteryA}A POI battery` : ''} + ${mainPanelAmps}A main = ` +
        `${backfeedBreakerAmps + mainPanelAmps}A > 120% of ${busRating}A bus (${Math.round(busRating * 1.2)}A max)`,
      necReference: 'NEC 705.12(B)',
      autoFixed: false,
      suggestion: 'Consider a supply-side connection (NEC 705.11) — insulated tap ' +
        'ahead of the main, or a utility-approved meter-socket lug adapter — or a panel upgrade',
    });
  }
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const autoFixCount = issues.filter(i => i.autoFixed).length;

  // ── Runs: namespaced per-sub + shared service (once) ──────────────────────
  const runs: RunSegment[] = [
    ...subList.flatMap(x =>
      x.cs.runs.map(r => ({ ...r, id: namespacedRunId(x.key, r.id) as RunSegmentId })),
    ),
    ...sharedServiceRuns,
  ];
  const runMap = {} as Record<RunSegmentId, RunSegment>;
  for (const run of runs) runMap[run.id] = run;

  // ── Equipment schedule: per-sub rows tag-suffixed; POI gear once ──────────
  const equipmentSchedule: EquipmentScheduleRow[] = subList.flatMap(x =>
    x.cs.equipmentSchedule
      .filter(row => !SHARED_EQUIPMENT_TAGS.has(row.tag))
      .map(row => ({ ...row, tag: suffixTag(row.tag, x.key) })),
  );
  for (const row of primary.cs.equipmentSchedule) {
    if (SHARED_EQUIPMENT_TAGS.has(row.tag)) equipmentSchedule.push({ ...row });
  }

  // ── BOM quantities: merged per-sub + shared-service footage ───────────────
  const bomQuantities = mergeBomQuantities(subList.map(x => x.cs.bomQuantities));
  addSharedServiceFootage(bomQuantities, sharedServiceRuns);

  // ── String/micro facade blocks ─────────────────────────────────────────────
  const stringSubs = subList.filter(x => x.cs.isString);
  const microSubs = subList.filter(x => x.cs.isMicro);
  const strings = stringSubs
    .flatMap(x => x.cs.strings)
    .map((s, i) => ({ ...s, stringIndex: i }));
  const microBranches = microSubs
    .flatMap(x => x.cs.microBranches)
    .map((b, i) => ({ ...b, branchIndex: i }));
  const firstString = stringSubs[0]?.cs;
  const firstMicro = microSubs[0]?.cs;

  const acContinuousCurrentA = acOutputCurrentA * 1.25;
  const roofSub = subSystems.roof;

  // ── Addendum B ruling 1: shared trench metadata (never a raceway merge) ───
  const buriedTrenches = subList
    .filter(x => x.key !== 'roof' && typeof x.input.trenchRunLengthFt === 'number' && x.input.trenchRunLengthFt! > 0)
    .map(x => x.input.trenchRunLengthFt!);
  const sharedTrenchFt = buriedTrenches.length >= 2 ? Math.max(...buriedTrenches) : undefined;

  // ── The ComputedSystem-compatible facade ───────────────────────────────────
  // Identity fields (topology/specs) mirror the PRIMARY subsystem (§1.4 fixed
  // roof > ground > fence — never a panel-count vote); quantities are sums.
  const aggregate: ComputedSystem = {
    topology: primary.cs.topology,
    isMicro: primary.cs.isMicro,
    isString: primary.cs.isString,
    isOptimizer: primary.cs.isOptimizer,
    inverterSpec: primary.cs.inverterSpec,
    panelSpec: primary.cs.panelSpec,
    totalPanels,
    totalDcKw,
    totalAcKw,
    dcAcRatio: calcDcAcRatio(totalDcKw, totalAcKw),
    stringCount: stringSubs.reduce((s, x) => s + x.cs.stringCount, 0),
    panelsPerString: firstString?.panelsPerString ?? primary.cs.panelsPerString,
    lastStringPanels: firstString?.lastStringPanels ?? primary.cs.lastStringPanels,
    maxPanelsPerString: firstString?.maxPanelsPerString ?? primary.cs.maxPanelsPerString,
    strings,
    microDeviceCount: subList.reduce((s, x) => s + x.cs.microDeviceCount, 0),
    acBranchCount: subList.reduce((s, x) => s + x.cs.acBranchCount, 0),
    microBranches,
    acBranchCurrentA: firstMicro?.acBranchCurrentA ?? 0,
    acBranchOcpdAmps: firstMicro?.acBranchOcpdAmps ?? 0,
    systemVoltageAC: 240,
    acOutputCurrentA,
    acContinuousCurrentA,
    acOcpdAmps: nextStandardOCPD(acContinuousCurrentA),
    backfeedBreakerAmps,
    interconnectionPass,
    runs,
    runMap,
    segmentSchedule: [
      ...subList.flatMap(x => x.cs.segmentSchedule),
      ...sharedServiceSegRows,
    ],
    conduitSchedule: buildConduitSchedule(runs),
    // §3/§4 — per-sub physical raceways, namespaced so a roof-branch home-run and
    // a ground-branch home-run stay distinct objects (I-1: identical to the base
    // list at N=1 since namespacedRunId is a no-op for a single sub).
    physicalRaceways: subList.flatMap(x =>
      x.cs.physicalRaceways.map(rw => ({
        ...rw,
        physicalRacewayId: `${x.key}:${rw.physicalRacewayId}`,
      }))),
    equipmentSchedule,
    bomQuantities,
    issues,
    errorCount,
    warningCount,
    autoFixCount,
    isValid: errorCount === 0,
    computedAt: new Date().toISOString(),
    designTempMin: Math.min(...subList.map(x => x.cs.designTempMin)),
    ambientTempC: Math.max(...subList.map(x => x.cs.ambientTempC)),
    // Roof-only semantics: the adder belongs to the roof sub (I-7); an
    // aggregate without a roof sub carries 0.
    rooftopTempAdderC: roofSub?.rooftopTempAdderC ?? 0,
    // Deliberately ABSENT at N>1 (I-8): the single-lane segment-builder view
    // cannot represent a hybrid; Wave 5's multi-lane SLD owns this surface.
    segments: undefined,
    segmentIssues: undefined,
    segmentInterconnectionPass: interconnectionPass,
  };

  return {
    subSystems,
    subSystemKeys: orderedKeys,
    primaryKey,
    aggregate,
    sharedServiceRuns,
    sharedTrenchFt,
  };
}
