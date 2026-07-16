// ═══════════════════════════════════════════════════════════════
// Conductor Authority — ONE source of truth for every conductor,
// EGC, OCPD and conduit value printed anywhere in the planset.
//
// Root cause it fixes (EL-2 / EL-4): PV-4A, PV-4B, E-1 (SLD), the
// equipment schedule and the BOM each independently re-derived (or
// hardcoded) branch OCPD, conductor gauge and EGC — so the same
// system printed #10/20A on one sheet, a `Isc×1.25×1.25` inline EGC
// table on another, and `groundingConductor` on a third. They could
// not agree because there was no shared authority.
//
// This module is a PURE, DETERMINISTIC function: given the same
// PermitInput + CAD it always returns the same values, so every
// consumer that reads it is guaranteed to match. It does NOT run a
// second electrical engine — it sources the already-computed feeder
// values from `compliance.electrical` (the engineering-page result
// that flows into the permit route) and only centralizes the
// per-branch / per-EGC derivation that was previously scattered.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, ResolvedEquipment } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { necNextStandardOcpd, resolveEquipmentBySubSystem } from './helpers';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { balancedBranchSizes, microBranchCount, planMicroBranches, type BranchPlanPanel } from './branching';
import { partitionSubSystems, toSubSystemKey, isSubSystemKey, effectiveInverterSubKey, type SubSystemKey, type SubSystemPanel } from './subSystems';

export type ConductorTopology = 'MICRO' | 'STRING' | 'OPTIMIZER';

export interface MicroBranch {
  index: number;            // 1-based branch number (B1..Bn)
  deviceCount: number;      // microinverters on this branch
  branchCurrentA: number;   // devices × per-micro AC output amps
  continuousA: number;      // branchCurrentA × 1.25 (NEC 690.8(A))
  ocpdAmps: number;         // next standard OCPD protecting the branch
  wireGauge: string;        // e.g. '#10 AWG'
  conductorCallout: string; // e.g. '#10 AWG THWN-2 + EGC'
  egcGauge: string;         // EGC for this branch (NEC 250.122 on branch OCPD)
}

export interface DcStringRun {
  index: number;            // 1-based
  invIdx: number;
  strIdx: number;
  label: string;            // 'DC 1-1'
  wireGauge: string;        // e.g. '#10 AWG'
  ampacityA: number | null; // Isc × 1.25
  ocpdAmps: number | null;  // Isc × 1.56 → next standard
  voltageDropPct: number | null;
  lengthFt: number | null;
}

/**
 * Wave 2d — ONE sub-system's conductor authority (contract §1.7:
 * `conductorAuthority.subSystems[key]`). Each sub derives its topology,
 * branch plan, perMicroA and EGC from ITS OWN panels + equipment — never
 * from the project-wide winner. Wave 5 sheet workers consume this set.
 */
export interface SubSystemConductorAuthority {
  key: SubSystemKey;
  topology: ConductorTopology;
  isMicro: boolean;
  /** Panels stamped to this sub (membership authority = placement stamps). */
  panelCount: number;
  /** Micro devices on THIS sub (0 for string/optimizer subs). */
  deviceCount: number;
  /** Per-device AC output amps — from the SUB's own per-device kW, never
   *  totalAcKw/totalPanels (the Stowell-class mis-sizing this wave kills). */
  perMicroA: number | null;
  /** The sub's own resolved equipment (resolveEquipmentBySubSystem). */
  equipment: ResolvedEquipment;
  /** MICRO subs only — AC branch circuits over THIS sub's panels. */
  microBranches: MicroBranch[];
  /** STRING/OPTIMIZER subs only — DC strings of THIS sub's inverters. */
  dcStrings: DcStringRun[];
  /** Governing branch/string OCPD of THIS sub (EGC basis). */
  governingOcpd: number;
  egc: { gauge: string; basisOcpd: number; source: 'engine' | 'nec-250.122' };
  /** The sub's AC output feeder toward the POI (per-sub OCPD basis). */
  acSubFeeder: {
    currentA: number;      // Σ device/inverter AC output amps for this sub
    continuousA: number;   // × 1.25 (NEC 690.8(A))
    ocpdAmps: number | null;
    wireGauge: string;
  };
}

export interface ConductorAuthority {
  topology: ConductorTopology;
  isMicro: boolean;
  /** Populated for MICRO systems only. */
  microBranches: MicroBranch[];
  /** Populated for STRING / OPTIMIZER systems only. */
  dcStrings: DcStringRun[];
  /** AC feeder (inverter/combiner → point of interconnection). */
  acFeeder: {
    conductorCallout: string; // full callout as computed upstream (e.g. '3#8 THWN-2 …') or plain gauge
    wireGauge: string;        // plain gauge, e.g. '#8 AWG'
    ampacityA: number | null;
    ocpdAmps: number | null;  // backfeed breaker / tap OCPD
    voltageDropPct: number | null;
    conduitType: string;
    conduitSize: string | null;
    lengthFt: number | null;
  };
  /**
   * The ONE authoritative system Equipment Grounding Conductor (array → panel).
   * Prefers the engine-computed `compliance.electrical.groundingConductor`
   * (the value E-1 already trusts); falls back to NEC 250.122 on the governing
   * branch/string OCPD. Every sheet must print THIS — never re-derive.
   */
  egc: {
    gauge: string;
    basisOcpd: number;
    source: 'engine' | 'nec-250.122';
  };
  /** Governing branch/string OCPD used as the EGC-sizing basis. */
  governingOcpd: number;
  /** Wave 2d — per-sub authority set (roof → ground → fence order). ALWAYS
   *  present: N=1 yields a single entry mirroring the top level, so consumers
   *  can iterate unconditionally. At N>1, every top-level field above is
   *  DERIVED from this set (aggregate view for legacy consumers). */
  subSystems: SubSystemConductorAuthority[];
  /** True when the design spans more than one sub-system. */
  isHybrid: boolean;
}

/** Normalize a conductor callout / gauge string down to a plain '#N AWG'. */
export function plainGauge(callout?: string | null, fallback = '#10 AWG'): string {
  if (!callout) return fallback;
  const t = String(callout).trim();
  if (/^#\d+(\/0)?\s*AWG$/i.test(t)) return t;
  const m = t.match(/#(\d+(?:\/0)?)/);
  return m ? `#${m[1]} AWG` : fallback;
}

/**
 * Size a copper THWN branch/feeder conductor from its OCPD (75°C column,
 * NEC 310.16). Kept intentionally small — covers the residential/light-
 * commercial range these sheets actually render. Matches the historical
 * default (#10 for a 20A micro branch) but sizes up correctly when a
 * branch/feeder OCPD demands it, instead of hardcoding #10 everywhere.
 */
export function wireGaugeForOcpd(ocpdAmps: number): string {
  if (ocpdAmps <= 20) return '#12 AWG';
  if (ocpdAmps <= 30) return '#10 AWG';
  if (ocpdAmps <= 50) return '#8 AWG';
  if (ocpdAmps <= 65) return '#6 AWG';
  if (ocpdAmps <= 85) return '#4 AWG';
  if (ocpdAmps <= 100) return '#3 AWG';
  if (ocpdAmps <= 115) return '#2 AWG';
  if (ocpdAmps <= 130) return '#1 AWG';
  if (ocpdAmps <= 150) return '#1/0 AWG';
  if (ocpdAmps <= 175) return '#2/0 AWG';
  if (ocpdAmps <= 200) return '#3/0 AWG';
  return '#4/0 AWG'; // 230A @ 75°C — top of the residential service range
}

/** One micro branch row from a device count + per-device amps — the ONE
 *  formula both the legacy top level and the per-sub set use. */
function microBranchRow(index: number, deviceCount: number, perMicroA: number): MicroBranch {
  const branchCurrentA = deviceCount * perMicroA;
  const continuousA = branchCurrentA * 1.25;
  const ocpdAmps = necNextStandardOcpd(continuousA) || 20;
  const wireGauge = wireGaugeForOcpd(ocpdAmps);
  return {
    index,
    deviceCount,
    branchCurrentA,
    continuousA,
    ocpdAmps,
    wireGauge,
    conductorCallout: `${wireGauge} THWN-2 + EGC`,
    egcGauge: getEGCSize(ocpdAmps),
  };
}

/** One DC string row — same derivation both paths (legacy + per-sub). */
function dcStringRow(index: number, invIdx: number, strIdx: number, str: any): DcStringRun {
  const isc = Number(str.isc) || 0;
  return {
    index,
    invIdx,
    strIdx,
    label: `DC ${invIdx + 1}-${strIdx + 1}`,
    wireGauge: plainGauge(str.wireGauge, '#10 AWG'),
    ampacityA: isc ? Math.ceil(isc * 1.25 * 100) / 100 : (str.ampacity ?? null),
    ocpdAmps: isc ? necNextStandardOcpd(isc * 1.56) : (str.ocpd ?? null),
    voltageDropPct: str.voltageDrop != null ? Number(str.voltageDrop) : null,
    lengthFt: str.wireLength != null ? Number(str.wireLength) : null,
  };
}

/** Resolve ONE sub-system's topology from ITS OWN equipment — never from
 *  inverters[0] or a project-wide vote (Invariant I-3). */
function topologyForSub(eq: ResolvedEquipment, fallback: ConductorTopology): ConductorTopology {
  const t = (eq.inverterType || '').toLowerCase();
  if (t.includes('micro')) return 'MICRO';
  if (t.includes('optimizer')) return 'OPTIMIZER';
  if (t.includes('string')) return 'STRING';
  const bm = `${eq.inverterManufacturer} ${eq.inverterModel}`.toLowerCase();
  if (bm.includes('enphase') || bm.includes('iq8') || bm.includes('iq7')) return 'MICRO';
  if (bm.includes('solaredge') || bm.includes('optimizer')) return 'OPTIMIZER';
  if (bm.includes('solis') || bm.includes('sol-ark') || bm.includes('solark') || bm.includes('sma')
    || bm.includes('fronius') || bm.includes('growatt') || bm.includes('huawei')) return 'STRING';
  return fallback;
}

/**
 * Build the shared conductor authority. PURE — no I/O, no engine run.
 * Safe to call from every consumer; identical inputs → identical output.
 *
 * Wave 2d: the authority is now a PER-SUB SET plus a derived aggregate.
 * Single-system inputs take the exact pre-Wave-2d code path (top-level output
 * byte-identical; the one `subSystems` entry mirrors it). Hybrid inputs get
 * one authority per sub — each sub's topology, branch plan and perMicroA from
 * its OWN panels + equipment, killing the 94-panel single-topology
 * contamination (one `planMicroBranches` over ALL panels with ONE inverter
 * model, perMicroA = totalAcKw/totalPanels across sub boundaries).
 */
export function buildConductorAuthority(input: PermitInput, cad?: CADModel | null): ConductorAuthority {
  const { project, system, compliance } = input;
  const elec = compliance?.electrical as any;
  const legacyTopology = topologyToLegacy(getInverterTopology(input, cad ?? undefined)) as ConductorTopology;

  const eq = getEquipmentContext(input, cad ?? undefined);
  const totalPanels = system?.totalPanels || cad?.totalPanels || 0;
  const totalAcKw = system?.totalAcKw || 0;
  const positions = ((project as any).panelPositions ?? []) as BranchPlanPanel[];

  // ── Wave 2d sub-system detection ───────────────────────────────
  // Membership authority = panel placement stamps (contract §1.1); the CAD
  // hybrid sections corroborate when positions are absent from the payload.
  const partition = positions.length ? partitionSubSystems(positions as unknown as SubSystemPanel[]) : [];
  const sectionKeys = ((cad?.hybrid?.sections ?? []).map(s => s.key)).filter(isSubSystemKey);
  const orderedKeys = (['roof', 'ground', 'fence'] as const).filter(k =>
    partition.some(s => s.key === k && s.panelCount > 0) || sectionKeys.includes(k));
  const isHybrid = orderedKeys.length > 1;

  // ── Shared AC feeder + engine EGC (identical both paths) ───────
  const acAmps = totalAcKw > 0 ? (totalAcKw * 1000 / 240) : 0;
  const feederOcpd = elec?.busbar?.backfeedBreakerRequired
    ?? project.backfeedBreakerA
    ?? (acAmps > 0 ? (necNextStandardOcpd(acAmps * 1.25) || null) : null);
  const acFeeder = {
    conductorCallout: elec?.acConductorCallout || project.wireGauge || '#8 AWG',
    wireGauge: plainGauge(elec?.acConductorCallout ?? elec?.acWireGauge ?? project.wireGauge, '#8 AWG'),
    ampacityA: typeof elec?.acWireAmpacity === 'number' ? elec.acWireAmpacity : null,
    ocpdAmps: feederOcpd,
    voltageDropPct: typeof elec?.acVoltageDrop === 'number' ? elec.acVoltageDrop : null,
    conduitType: elec?.conduitFill?.conduitType || project.conduitType || 'EMT',
    conduitSize: elec?.conduitFill?.conduitSize ?? null,
    lengthFt: project.wireLength != null ? Number(project.wireLength) : null,
  };
  const engineEgc = elec?.groundingConductor ? plainGauge(elec.groundingConductor, '') : '';

  if (!isHybrid) {
    // ═════ LEGACY SINGLE-SYSTEM PATH — byte-identical to pre-Wave-2d ═════
    const topology = legacyTopology;
    const isMicro = topology === 'MICRO';

    // ── Micro branches ─────────────────────────────────────────────
    const microBranches: MicroBranch[] = [];
    // Per-micro AC output amps. Prefer the true per-device figure from the
    // system total; only if that is missing does the branch collapse to 0A.
    const perMicroA = totalAcKw > 0 && totalPanels > 0 ? (totalAcKw * 1000 / totalPanels) / 240 : 0;
    if (isMicro && totalPanels > 0) {
      const plan = positions.length ? planMicroBranches(positions, eq.inverterModel) : null;
      const sizes = plan?.sizes?.length
        ? plan.sizes
        : balancedBranchSizes(totalPanels, microBranchCount(totalPanels, eq.inverterModel));
      sizes.forEach((n, i) => microBranches.push(microBranchRow(i + 1, n, perMicroA)));
    }

    // ── DC strings (string / optimizer) ────────────────────────────
    const dcStrings: DcStringRun[] = [];
    if (!isMicro) {
      (system?.inverters ?? []).forEach((inv: any, invIdx: number) => {
        (inv.strings ?? []).forEach((str: any, strIdx: number) => {
          dcStrings.push(dcStringRow(dcStrings.length + 1, invIdx, strIdx, str));
        });
      });
    }

    // ── Governing OCPD for EGC sizing (largest branch / string OCPD) ─
    const branchOcpds = isMicro
      ? microBranches.map(b => b.ocpdAmps)
      : dcStrings.map(s => s.ocpdAmps ?? 0);
    const governingOcpd = branchOcpds.length ? Math.max(...branchOcpds) : 20;

    // ── The one authoritative system EGC ───────────────────────────
    // Prefer the engine value E-1 already prints; fall back to NEC 250.122
    // on the governing OCPD so the two can never diverge again.
    const egc = engineEgc
      ? { gauge: engineEgc, basisOcpd: governingOcpd, source: 'engine' as const }
      : { gauge: getEGCSize(governingOcpd), basisOcpd: governingOcpd, source: 'nec-250.122' as const };

    // Single-entry sub view MIRRORS the top level (derived, never re-computed).
    const soloKey: SubSystemKey = orderedKeys[0]
      ?? toSubSystemKey((project as any).systemType ?? cad?.systemType ?? 'roof');
    const subSystems: SubSystemConductorAuthority[] = [{
      key: soloKey,
      topology,
      isMicro,
      panelCount: totalPanels,
      deviceCount: isMicro ? totalPanels : 0,
      perMicroA: isMicro ? perMicroA : null,
      equipment: eq,
      microBranches,
      dcStrings,
      governingOcpd,
      egc,
      acSubFeeder: {
        currentA: acAmps,
        continuousA: acAmps * 1.25,
        ocpdAmps: feederOcpd,
        wireGauge: acFeeder.wireGauge,
      },
    }];

    return { topology, isMicro, microBranches, dcStrings, acFeeder, egc, governingOcpd, subSystems, isHybrid: false };
  }

  // ═════ HYBRID (N>1) — one authority per sub, aggregate derived ═════
  const inverters = (system?.inverters ?? []) as any[];
  const primaryKey = orderedKeys[0];
  // Tag rule (§1.5): tagged inverters belong to their tag; untagged inverters
  // inherit the PRIMARY sub (deterministic roof>ground>fence — never a vote).
  // Effective key: own tag → majority string tag (survives a reload that drops
  // the inverter-level tag) → primary sub. Keeps dcStrings + AC-feeder grouping
  // aligned with the equipment resolver's effective-tag logic.
  const effKey = (inv: any): SubSystemKey =>
    effectiveInverterSubKey(inv, primaryKey) ?? primaryKey;

  const subSystems: SubSystemConductorAuthority[] = orderedKeys.map((key) => {
    const subPanels = (partition.find(s => s.key === key)?.panels ?? []) as unknown as BranchPlanPanel[];
    const section = cad?.hybrid?.sections?.find(s => s.key === key);
    const panelCount = subPanels.length || section?.totalPanels || 0;
    const subEq = resolveEquipmentBySubSystem(input, key, cad);
    const topo = topologyForSub(subEq, legacyTopology);
    const isM = topo === 'MICRO';

    // Micro branches — THIS sub's panels, THIS sub's inverter model, and
    // perMicroA from THIS sub's per-device kW (acKwPerDevice contract).
    const microBranches: MicroBranch[] = [];
    let perMicroA: number | null = null;
    let deviceCount = 0;
    if (isM && panelCount > 0) {
      deviceCount = panelCount;
      perMicroA = subEq.inverterAcOutputKw > 0 ? (subEq.inverterAcOutputKw * 1000) / 240 : 0;
      const plan = subPanels.length
        ? planMicroBranches(subPanels, subEq.inverterModel, subEq.inverterManufacturer)
        : null;
      const sizes = plan?.sizes?.length
        ? plan.sizes
        : balancedBranchSizes(panelCount, microBranchCount(panelCount, subEq.inverterModel, subEq.inverterManufacturer));
      sizes.forEach((n, i) => microBranches.push(microBranchRow(i + 1, n, perMicroA!)));
    }

    // DC strings — ONLY this sub's inverters (string/optimizer subs produce
    // string groupings, never fake AC branches).
    const dcStrings: DcStringRun[] = [];
    if (!isM) {
      inverters.forEach((inv: any, invIdx: number) => {
        if (effKey(inv) !== key) return;
        (inv.strings ?? []).forEach((str: any, strIdx: number) => {
          dcStrings.push(dcStringRow(dcStrings.length + 1, invIdx, strIdx, str));
        });
      });
    }

    // Sub AC feeder — Σ of THIS sub's device/inverter output amps.
    // (Computed BEFORE the EGC so the feeder OCPD can govern it — see below.)
    let subAcA = 0;
    if (isM) {
      subAcA = deviceCount * (perMicroA ?? 0);
    } else {
      subAcA = inverters
        .filter(inv => effKey(inv) === key)
        .reduce((s, inv) => s + (((inv.acOutputKw || 0) * 1000) / 240), 0);
      if (subAcA <= 0 && subEq.inverterAcOutputKw > 0) subAcA = (subEq.inverterAcOutputKw * 1000) / 240;
    }
    const subContA = subAcA * 1.25;
    const subOcpd = subAcA > 0 ? (necNextStandardOcpd(subContA) || null) : null;

    // Governing OCPD for the per-sub EGC = the AC FEEDER's OCPD (it sits next
    // to the "AC FEEDER → POI" column). The old branch-max basis broke on
    // string subs: DC strings with ≤2 strings carry NO per-string OCPD, so
    // max(0,0)=0 printed "GOVERNING OCPD 0A" and getEGCSize(0) → #14 AWG on a
    // 60A-protected feeder (NEC 250.122 requires #10). Branch-level EGCs
    // (#12 @ 20A micro branches) still live on the branch rows themselves.
    const branchOcpds = (isM ? microBranches.map(b => b.ocpdAmps) : dcStrings.map(s => s.ocpdAmps ?? 0)).filter(n => n > 0);
    const governingOcpd = subOcpd ?? (branchOcpds.length ? Math.max(...branchOcpds) : 20);
    const egc = { gauge: getEGCSize(governingOcpd), basisOcpd: governingOcpd, source: 'nec-250.122' as const };

    return {
      key,
      topology: topo,
      isMicro: isM,
      panelCount,
      deviceCount,
      perMicroA: isM ? perMicroA : null,
      equipment: subEq,
      microBranches,
      dcStrings,
      governingOcpd,
      egc,
      acSubFeeder: {
        currentA: subAcA,
        continuousA: subContA,
        ocpdAmps: subOcpd,
        wireGauge: subOcpd ? wireGaugeForOcpd(subOcpd) : '#10 AWG',
      },
    };
  });

  // ── Aggregate view for legacy consumers (derived from the set) ──
  const microBranches: MicroBranch[] = [];
  for (const s of subSystems) for (const b of s.microBranches) microBranches.push({ ...b, index: microBranches.length + 1 });
  const dcStrings: DcStringRun[] = [];
  for (const s of subSystems) for (const d of s.dcStrings) dcStrings.push({ ...d, index: dcStrings.length + 1 });

  const primary = subSystems[0];
  const allOcpds = subSystems.map(s => s.governingOcpd);
  const governingOcpd = allOcpds.length ? Math.max(...allOcpds) : 20;
  const egc = engineEgc
    ? { gauge: engineEgc, basisOcpd: governingOcpd, source: 'engine' as const }
    : { gauge: getEGCSize(governingOcpd), basisOcpd: governingOcpd, source: 'nec-250.122' as const };

  return {
    topology: primary.topology,
    isMicro: primary.isMicro,
    microBranches,
    dcStrings,
    acFeeder,
    egc,
    governingOcpd,
    subSystems,
    isHybrid: true,
  };
}
