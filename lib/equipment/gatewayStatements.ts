// ═══════════════════════════════════════════════════════════════════════════
// WHAT EVERY SHEET SAYS ABOUT A DESIGN'S GATEWAYS — once, here.
//
// Ray, 2026-09-26: "Once the solver determines 2 Envoys, every consumer must
// see 2 Envoys" — the Engineering page, E-1, PV-4A, SCHED, the disconnecting-
// means directory, the BOM and the commissioning notes. The count, the branches
// each gateway takes, its output breaker and its metering role are the solver's
// (lib/equipment/enphaseGatewayMultiplicity.ts); this module only words them,
// so no sheet can word them differently.
//
// Pure; safe on the client.
// ═══════════════════════════════════════════════════════════════════════════

import { branchRangeText, type GatewayInstance, type GatewayMultiplicity } from '@/lib/equipment/enphaseGatewayMultiplicity';

const LANE_WORD: Record<string, string> = { roof: 'ROOF', ground: 'GROUND', fence: 'FENCE' };

/** The branches a gateway takes: 'B1–B4' on a single system, 'ROOF B1–B2 + GROUND B1' on a hybrid. */
export function gatewayBranchesText(branches: ReadonlyArray<{ laneKey: string; branchNumber: number }>): string {
  const byLane = new Map<string, Array<{ branchNumber: number }>>();
  for (const b of branches) byLane.set(b.laneKey, [...(byLane.get(b.laneKey) ?? []), b]);
  return [...byLane.entries()]
    .map(([k, bs]) => (k ? `${LANE_WORD[k] ?? k.toUpperCase()} ` : '') + branchRangeText(bs))
    .join(' + ');
}

/** The arrays a gateway serves, for a heading: 'ROOF + GROUND SUB-SYSTEMS'. */
export function gatewayLanesText(laneKeys: readonly string[]): string {
  const words = laneKeys.filter(Boolean).map(k => LANE_WORD[k] ?? k.toUpperCase());
  return words.length ? `${words.join(' + ')} SUB-SYSTEM${words.length > 1 ? 'S' : ''}` : '';
}

const fmtA = (a: number) => (Math.abs(a - Math.round(a)) < 0.05 ? String(Math.round(a)) : a.toFixed(1));

/** One schedule row per gateway — the SCHED table, the page and PV-4A read these. */
export interface GatewayScheduleRow {
  /** 'GATEWAY 1'. */
  label: string;
  /** 'B1–B4' | 'ROOF B1–B2 + GROUND B1'. */
  branches: string;
  /** Microinverters on those branches. */
  devices: number;
  /** Σ rated continuous output of those micros (A) — what its capacity was checked against. */
  continuousA: number;
  /** The breaker its output lands on (A). */
  outputOcpdA: number;
  /** 'SITE CONSUMPTION + PRODUCTION' on the primary, 'PRODUCTION' on the rest. */
  metering: string;
}

/**
 * The schedule rows of a design's gateways. `primaryIndex` is the gateway that
 * reads the site's consumption CTs (one service, one set) — null when no
 * gateway reads consumption.
 */
export function gatewayScheduleRows(instances: readonly GatewayInstance[], primaryIndex: number | null): GatewayScheduleRow[] {
  return instances.map(g => ({
    label: g.label,
    branches: gatewayBranchesText(g.branches),
    devices: g.deviceCount,
    continuousA: g.continuousCurrentA,
    outputOcpdA: g.outputOcpdA,
    metering: g.index === primaryIndex ? 'SITE CONSUMPTION + PRODUCTION' : 'PRODUCTION',
  }));
}

/**
 * One paragraph for PV-4A / SCHED: how many, why that many, and which branches
 * land on which — every number the solver's.
 */
export function gatewayMultiplicityStatement(m: GatewayMultiplicity, primaryIndex: number | null): string {
  const parts = m.instances.map(g =>
    `${g.label}: ${gatewayBranchesText(g.branches)} (${g.deviceCount} microinverters, ${fmtA(g.continuousCurrentA)} A continuous) → ${g.outputOcpdA} A breaker`);
  return `${m.explanation} Branch circuits are never split between gateways. ${parts.join('; ')}.`
    + (primaryIndex != null
      ? ` The site's consumption CTs are read by GATEWAY ${primaryIndex} only (one set per service); every gateway meters its own production.`
      : ' Every gateway meters its own production.');
}

/**
 * Commissioning, per gateway: what the installer provisions on each and which
 * one carries the site's consumption metering. One line per gateway.
 */
export function gatewayCommissioningLines(instances: readonly GatewayInstance[], primaryIndex: number | null): string[] {
  return instances.map(g =>
    `${g.label} — provision only the ${g.deviceCount} microinverters on ${gatewayBranchesText(g.branches)}; `
    + `enable its production metering`
    + (g.index === primaryIndex
      ? '; enable the site consumption CTs on THIS gateway (one set per service)'
      : '; no consumption CTs on this gateway — the site\'s are read by GATEWAY ' + (primaryIndex ?? '—'))
    + '.');
}
