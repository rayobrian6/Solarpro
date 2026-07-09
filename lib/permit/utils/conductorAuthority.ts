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

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { necNextStandardOcpd } from './helpers';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { balancedBranchSizes, microBranchCount, planMicroBranches, type BranchPlanPanel } from './branching';

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
  return '#2/0 AWG';
}

/**
 * Build the shared conductor authority. PURE — no I/O, no engine run.
 * Safe to call from every consumer; identical inputs → identical output.
 */
export function buildConductorAuthority(input: PermitInput, cad?: CADModel | null): ConductorAuthority {
  const { project, system, compliance } = input;
  const elec = compliance?.electrical as any;
  const topology = topologyToLegacy(getInverterTopology(input, cad ?? undefined)) as ConductorTopology;
  const isMicro = topology === 'MICRO';

  const eq = getEquipmentContext(input, cad ?? undefined);
  const totalPanels = system?.totalPanels || cad?.totalPanels || 0;
  const totalAcKw = system?.totalAcKw || 0;

  // ── Micro branches ─────────────────────────────────────────────
  const microBranches: MicroBranch[] = [];
  if (isMicro && totalPanels > 0) {
    const positions = ((project as any).panelPositions ?? []) as BranchPlanPanel[];
    const plan = positions.length ? planMicroBranches(positions, eq.inverterModel) : null;
    const sizes = plan?.sizes?.length
      ? plan.sizes
      : balancedBranchSizes(totalPanels, microBranchCount(totalPanels, eq.inverterModel));
    // Per-micro AC output amps. Prefer the true per-device figure from the
    // system total; only if that is missing does the branch collapse to 0A.
    const perMicroA = totalAcKw > 0 ? (totalAcKw * 1000 / totalPanels) / 240 : 0;
    sizes.forEach((n, i) => {
      const branchCurrentA = n * perMicroA;
      const continuousA = branchCurrentA * 1.25;
      const ocpdAmps = necNextStandardOcpd(continuousA) || 20;
      const wireGauge = wireGaugeForOcpd(ocpdAmps);
      microBranches.push({
        index: i + 1,
        deviceCount: n,
        branchCurrentA,
        continuousA,
        ocpdAmps,
        wireGauge,
        conductorCallout: `${wireGauge} THWN-2 + EGC`,
        egcGauge: getEGCSize(ocpdAmps),
      });
    });
  }

  // ── DC strings (string / optimizer) ────────────────────────────
  const dcStrings: DcStringRun[] = [];
  if (!isMicro) {
    (system?.inverters ?? []).forEach((inv: any, invIdx: number) => {
      (inv.strings ?? []).forEach((str: any, strIdx: number) => {
        const isc = Number(str.isc) || 0;
        dcStrings.push({
          index: dcStrings.length + 1,
          invIdx,
          strIdx,
          label: `DC ${invIdx + 1}-${strIdx + 1}`,
          wireGauge: plainGauge(str.wireGauge, '#10 AWG'),
          ampacityA: isc ? Math.ceil(isc * 1.25 * 100) / 100 : (str.ampacity ?? null),
          ocpdAmps: isc ? necNextStandardOcpd(isc * 1.56) : (str.ocpd ?? null),
          voltageDropPct: str.voltageDrop != null ? Number(str.voltageDrop) : null,
          lengthFt: str.wireLength != null ? Number(str.wireLength) : null,
        });
      });
    });
  }

  // ── Governing OCPD for EGC sizing (largest branch / string OCPD) ─
  const branchOcpds = isMicro
    ? microBranches.map(b => b.ocpdAmps)
    : dcStrings.map(s => s.ocpdAmps ?? 0);
  const governingOcpd = branchOcpds.length ? Math.max(...branchOcpds) : 20;

  // ── AC feeder (from the upstream engine result) ────────────────
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

  // ── The one authoritative system EGC ───────────────────────────
  // Prefer the engine value E-1 already prints; fall back to NEC 250.122
  // on the governing OCPD so the two can never diverge again.
  const engineEgc = elec?.groundingConductor ? plainGauge(elec.groundingConductor, '') : '';
  const egc = engineEgc
    ? { gauge: engineEgc, basisOcpd: governingOcpd, source: 'engine' as const }
    : { gauge: getEGCSize(governingOcpd), basisOcpd: governingOcpd, source: 'nec-250.122' as const };

  return {
    topology,
    isMicro,
    microBranches,
    dcStrings,
    acFeeder,
    egc,
    governingOcpd,
  };
}
