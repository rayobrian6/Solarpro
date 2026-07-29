// ═══════════════════════════════════════════════════════════════════════════
// W2.1 (Ray, binding): computeSystem is THE canonical electrical engine.
// This module projects its result into the `compliance.electrical` shape the
// sheets/authority layer consume — so every downstream reader is fed by
// computeSystem and ONLY computeSystem. runElectricalCalc is shadow-only.
//
// Grounding note: the old single `groundingConductor` ("system EGC") carried
// two different meanings. Here it is EXPLICITLY the FEEDER equipment-
// grounding conductor (NEC 250.122 on the feeder OCPD, per-segment from the
// engine's own run model). Branch/raceway/GEC grounding are modeled as
// per-purpose objects on the snapshot (see build.ts groundingObjects).
// ═══════════════════════════════════════════════════════════════════════════
import type { ElectricalCompliance } from '../types';
import type { computeSystem } from '@/lib/computed-system';

type CS = ReturnType<typeof computeSystem>;

export interface ComplianceProjectionCtx {
  busRatingA: number | null;
  mainBreakerA: number | null;
  interconnectionMethod: string;
}

export function mapComputedSystemToCompliance(cs: CS, ctx: ComplianceProjectionCtx): ElectricalCompliance {
  const runMap: Record<string, any> = (cs as any).runMap ?? {};
  const feeder = runMap['COMBINER_TO_DISCO_RUN'] ?? runMap['INV_TO_DISCO_RUN'] ?? null;
  const dcRun = runMap['DC_STRING_RUN'] ?? null;
  const isSupply = String(ctx.interconnectionMethod).toUpperCase().includes('SUPPLY');

  // AAC WS-7 (2026-07-27) — THE FOUR FIELD-NAME MISMATCHES THAT DISCARDED A
  // CORRECTLY COMPUTED NEC Ch.9 TABLE 1 FILL (audit §2.14 / §7.1).
  //
  // A `ConduitScheduleRow` (computed-system.ts:330-345) carries `raceway / from /
  // to / conduitType / conduitSize / fillPct / pass`. It has NEITHER `contains`
  // NOR `segments`, so the old find() never matched and `conduitRow` was ALWAYS
  // null; the fallback then read `feeder.conduitFillPercent` and
  // `conduitRow.passes`, neither of which exists either (`RunSegment` carries
  // `conduitFillPct` / `conduitFillPass`, the row carries `pass`). The projected
  // fill was therefore always undefined and CONDUIT-FILL-PENDING fired on a
  // calculation that HAD RUN. The row is now located the only way the schedule
  // makes possible — by the feeder run's own from/to endpoints, which
  // computeSystem copies verbatim into the row (computed-system.ts:2406-2419) —
  // and every field is read by its REAL name.
  const conduitRow = feeder
    ? (((cs as any).conduitSchedule ?? []).find((r: any) =>
        String(r?.from ?? '') === String(feeder.from ?? '')
        && String(r?.to ?? '') === String(feeder.to ?? '')) ?? null)
    : null;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  /** the computed NEC Ch.9 Table 1 fill for the feeder raceway (row first, then
   *  the run segment that produced the row — ONE derivation, two carriers). */
  const feederFillPct = num(conduitRow?.fillPct) ?? num(feeder?.conduitFillPct);
  /** the FILL verdict specifically (≤40 %), never the run's overall pass. */
  const feederFillPass: boolean | undefined =
    typeof feeder?.conduitFillPass === 'boolean' ? feeder.conduitFillPass
      : (typeof conduitRow?.pass === 'boolean' ? conduitRow.pass : undefined);

  return {
    acConductorCallout: feeder?.conductorCallout ?? (feeder?.wireGauge ? `${feeder.wireGauge} THWN-2` : undefined),
    dcConductorCallout: dcRun?.conductorCallout ?? dcRun?.wireGauge,
    acWireGauge: feeder?.wireGauge,
    acWireAmpacity: feeder?.effectiveAmpacity,
    acVoltageDrop: feeder?.voltageDropPct,           // canonical ROUTED length basis
    groundingConductor: feeder?.egcGauge,            // FEEDER EGC (250.122 on feeder OCPD)
    busbar: {
      backfeedBreakerRequired: cs.backfeedBreakerAmps,
      passes: isSupply ? true : cs.interconnectionPass,
      busbarRule: isSupply ? 'supply-side' : '120%',
      busRating: ctx.busRatingA ?? undefined,
      mainBreaker: ctx.mainBreakerA ?? undefined,
      solarBreakerRequired: cs.backfeedBreakerAmps,
      maxAllowedSolarBreaker: ctx.busRatingA != null && ctx.mainBreakerA != null
        ? Math.round(ctx.busRatingA * 1.2 - ctx.mainBreakerA) : undefined,
      method: ctx.interconnectionMethod,
      necReference: isSupply ? 'NEC 705.11' : 'NEC 705.12(B)',
    },
    conduitFill: {
      conduitType: feeder?.conduitType,
      conduitSize: feeder?.conduitSize,
      fillPercent: feederFillPct,
      passes: feederFillPass,
    },
    summary: { totalDcKw: cs.totalDcKw, totalAcKw: cs.totalAcKw, dcAcRatio: cs.dcAcRatio },
    acSizing: {
      ocpdAmps: cs.acOcpdAmps,
      conductorGauge: feeder?.wireGauge,
      conductorAmpacity: feeder?.effectiveAmpacity,
      conduitSize: feeder?.conduitSize,
      conduitFillPct: feederFillPct,
      groundingConductor: feeder?.egcGauge,
    },
    inverters: cs.strings?.length ? [{
      type: cs.topology,
      acOutputKw: cs.totalAcKw,
      strings: cs.strings.map((s: any, i: number) => ({
        stringId: i + 1,
        panelCount: s.panelCount,
        vocSTC: s.vocSTC ?? s.voc,
        vocCorrected: s.vocCorrected,
        iscSTC: s.iscSTC ?? s.isc,
        iscCorrected: s.iscCorrected ?? s.maxCurrentNEC,
        maxCurrentNEC: s.maxCurrentNEC,
        ocpdRating: s.ocpdAmps ?? s.ocpdRating,
        wireGauge: s.wireGauge ?? dcRun?.wireGauge,
        voltageDrop: s.voltageDrop ?? dcRun?.voltageDropPct,
      })),
    }] : undefined,
    status: cs.errorCount > 0 ? 'FAIL' : cs.warningCount > 0 ? 'WARNING' : 'PASS',
  };
}
