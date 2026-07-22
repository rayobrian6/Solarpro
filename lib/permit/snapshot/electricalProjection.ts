// ═══════════════════════════════════════════════════════════════════════════
// electricalProjection — THE single canonical read of snapshot.electrical for
// the sheets/adapters (§3 SEGMENT AUTHORITY, post-campaign correction 07-22).
//
// Before this, E-1, PV-4A, PV-4B, SCHED and the BOM each derived their own
// feeder raceway size, voltage drop, run length and conductor callout — which
// is how one package printed "3/4" EMT" on E-1, "1-1/4" 3/4" EMT" on PV-4B's
// callout, "PVC Sch 80 1-1/4"" on the fill table, and 1.11% (legacy flat-
// length) vs 0.37% (routed) voltage drop on the SAME feeder. Every sheet now
// projects THIS object, which reads ONLY the canonical snapshot.electrical
// feeder + its route segment. Same field, same rounding, everywhere.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot, RouteSegmentRecord } from './types';

export interface CanonicalFeederProjection {
  /** the canonical feeder route segment (undefined ⇒ segment authority absent). */
  segment: RouteSegmentRecord | null;
  raceway: string | null;            // 'EMT' | 'PVC' … (ONE source, no fallback literal)
  tradeSizeIn: string | null;        // '1"' … (ONE source)
  /** display string 'EMT 1"' — the SAME string every sheet's conduit column shows. */
  conduitLabel: string | null;
  fillPct: number | null;
  voltageDropPct: number | null;     // canonical ROUTED basis (kills the 1.11% legacy number)
  oneWayFt: number | null;
  gauge: string | null;              // '#6 AWG'
  egcGauge: string | null;
  ocpdA: number | null;
  continuousA: number | null;
  currentA: number | null;
  /** clean multi-fact callout built from the canonical segment ONLY — never the
   *  legacy elec.acConductorCallout that concatenated two conduit computations. */
  conductorCallout: string | null;
  lengthSource: RouteSegmentRecord['lengthSource'] | null;
  /** true ⇒ any consumed electrical value is NaN/undefined/null — the sheet must
   *  render honest PENDING and generation must block (never PASS on a hole). */
  hasHole: boolean;
  holes: string[];
}

const FEEDER_SEGMENT_IDS = ['COMBINER_TO_DISCO_RUN', 'INV_TO_DISCO_RUN'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Resolve THE canonical feeder projection from a validated snapshot. Pure. */
export function projectCanonicalFeeder(snap: PermitDesignSnapshot | null | undefined): CanonicalFeederProjection {
  const empty: CanonicalFeederProjection = {
    segment: null, raceway: null, tradeSizeIn: null, conduitLabel: null, fillPct: null,
    voltageDropPct: null, oneWayFt: null, gauge: null, egcGauge: null, ocpdA: null,
    continuousA: null, currentA: null, conductorCallout: null, lengthSource: null,
    hasHole: true, holes: ['no snapshot'],
  };
  const elec = snap?.electrical;
  if (!elec) return empty;

  const segs = elec.routeSegments ?? [];
  const segment =
    segs.find(r => FEEDER_SEGMENT_IDS.includes(r.segmentId))
    // else: the segment carrying the feeder EGC gauge, else the max-VD in-conduit run
    ?? segs.find(r => r.egcGauge && r.voltageDropPct != null && r.raceway && r.raceway !== 'FREE_AIR')
    ?? null;

  const feeder = elec.feeder;
  // Raceway + size single-source from the feeder conduit (which the build derives
  // from the same feederRun the segment mirrors). The segment is the length/callout
  // carrier; feeder.conduit is the raceway/size carrier — one underlying run.
  const raceway = feeder?.conduit?.raceway ?? segment?.raceway ?? null;
  const tradeSizeIn = feeder?.conduit?.tradeSizeIn ?? segment?.tradeSizeIn ?? null;
  const fillPct = num(feeder?.conduit?.fillPct) ?? num(segment?.fillPct);
  const voltageDropPct = num(feeder?.voltageDropPct) ?? num(segment?.voltageDropPct);
  const oneWayFt = num(segment?.oneWayFt);
  const gauge = elec.conductors?.find(c => c.conductorId === feeder?.conductorId)?.gauge
    ?? segment?.conductorGauge ?? null;
  const egcGauge = elec.groundingObjects?.find(g => g.purpose === 'feeder-egc')?.conductorSize
    ?? segment?.egcGauge ?? null;
  const ocpdA = num(feeder?.ocpdA) ?? num(segment?.ocpdA);
  const continuousA = num(feeder?.continuousA);
  const currentA = num(feeder?.currentA);

  const conduitLabel = (raceway && tradeSizeIn)
    ? (raceway === 'FREE_AIR' ? 'FREE AIR' : `${raceway} ${tradeSizeIn}`)
    : (raceway ?? null);

  // Clean callout — built HERE from canonical parts, never the legacy string.
  const conductorCallout = gauge
    ? `3×${gauge} THWN-2`
      + (egcGauge ? ` + 1×${egcGauge} EGC` : '')
      + (conduitLabel && conduitLabel !== 'FREE AIR' ? ` IN ${conduitLabel}` : '')
    : null;

  // Hole detection — §3: undefined/NaN/null in any DISPLAYED feeder value is a
  // blocking condition. We report the raceway/size/VD/OCPD/gauge quartet the
  // sheets print; length is estimate-grade (blocked elsewhere) so not a hole.
  const holes: string[] = [];
  if (!raceway) holes.push('feeder raceway');
  if (!tradeSizeIn) holes.push('feeder conduit trade size');
  if (voltageDropPct == null) holes.push('feeder voltage drop');
  if (ocpdA == null) holes.push('feeder OCPD');
  if (!gauge) holes.push('feeder conductor gauge');

  return {
    segment, raceway, tradeSizeIn, conduitLabel, fillPct, voltageDropPct, oneWayFt,
    gauge, egcGauge, ocpdA, continuousA, currentA, conductorCallout,
    lengthSource: segment?.lengthSource ?? null,
    hasHole: holes.length > 0, holes,
  };
}

/** §6 ROUTE PROVENANCE — the annotation every route/trench label must print
 *  while any electrical run length is a CAD-derived estimate (not routed CAD
 *  geometry / field measurement). Drives PV-1's trench text off the real state. */
export function routeProvenanceLabel(snap: PermitDesignSnapshot | null | undefined): string {
  const segs = snap?.electrical?.routeSegments ?? [];
  const estimate = segs.some(r => r.lengthSource === 'cad-derived-estimate' || r.lengthSource === 'unknown')
    || (snap?.permitReadiness?.blockers ?? []).some(b => b.code === 'ROUTE-LENGTH-ESTIMATE')
    || segs.length === 0;   // no segment authority ⇒ estimate, never "verified"
  return estimate ? 'CAD-DERIVED ESTIMATE — FIELD VERIFY' : 'ROUTE FIELD-VERIFIED';
}
