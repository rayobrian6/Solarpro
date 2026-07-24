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

// ═══════════════════════════════════════════════════════════════════════════
// W3 §route-verification — the ONE RouteVerificationStatus authority. Every
// route note / conduit callout / trench label across the package projects THIS
// (no renderer literal). An estimated route can NEVER print "field-verified":
// that string is reachable only when the snapshot carries a recorded field
// measurement (lengthSource==='field-measurement') or an as-built record. The
// five allowed values are Ray's binding list; the accessor computes the WEAKEST
// (least-verified) status across all electrical run segments, because a route
// callout describes the whole run — one unverified segment governs the label.
// ═══════════════════════════════════════════════════════════════════════════
export type RouteVerificationStatus =
  | 'unverified-estimate'      // no segment authority / unknown length source
  | 'cad-derived-estimate'     // deriveRunLengths / CAD geometry, not field-checked
  | 'field-measured'           // a tech measured the run in the field
  | 'field-verified'           // measured AND verified against the installed route
  | 'as-built-verified';       // as-built record closes the loop

const ROUTE_STATUS_LABEL: Record<RouteVerificationStatus, string> = {
  'unverified-estimate': 'UNVERIFIED ESTIMATE — FIELD VERIFY',
  'cad-derived-estimate': 'CAD-DERIVED ESTIMATE — FIELD VERIFY',
  'field-measured': 'FIELD-MEASURED',
  'field-verified': 'FIELD-VERIFIED',
  'as-built-verified': 'AS-BUILT VERIFIED',
};

/** Order weakest→strongest so we can pick the governing (weakest) status. */
const ROUTE_STATUS_RANK: RouteVerificationStatus[] = [
  'unverified-estimate', 'cad-derived-estimate', 'field-measured', 'field-verified', 'as-built-verified',
];

/** Map a RouteSegmentRecord.lengthSource → a verification status. Conservative:
 *  operator-entry and cad-route are estimate-grade until field measurement is
 *  recorded (nothing short of a field measurement may claim "verified"). */
function statusForLengthSource(src: RouteSegmentRecord['lengthSource']): RouteVerificationStatus {
  switch (src) {
    case 'field-measurement': return 'field-measured';
    case 'cad-route':
    case 'cad-derived-estimate':
    case 'operator-entry': return 'cad-derived-estimate';
    case 'unknown':
    default: return 'unverified-estimate';
  }
}

/** W3 — THE canonical route verification status for the package. Weakest wins. */
export function routeVerificationStatus(snap: PermitDesignSnapshot | null | undefined): RouteVerificationStatus {
  const segs = snap?.electrical?.routeSegments ?? [];
  if (segs.length === 0) return 'unverified-estimate';
  // An active ROUTE-LENGTH-ESTIMATE blocker forces at most cad-derived-estimate
  // (can never resolve to field-verified while the blocker is live).
  const routeBlocked = (snap?.permitReadiness?.blockers ?? []).some(b => b.code === 'ROUTE-LENGTH-ESTIMATE');
  let governing: RouteVerificationStatus = 'as-built-verified';
  for (const s of segs) {
    // Prefer the segment's own recorded verification state (W1 build populates
    // it); fall back to deriving from lengthSource for older/partial snapshots.
    const st = (s.verificationStatus as RouteVerificationStatus | undefined)
      ?? statusForLengthSource(s.lengthSource);
    if (ROUTE_STATUS_RANK.indexOf(st) < ROUTE_STATUS_RANK.indexOf(governing)) governing = st;
  }
  if (routeBlocked && ROUTE_STATUS_RANK.indexOf(governing) > ROUTE_STATUS_RANK.indexOf('cad-derived-estimate')) {
    governing = 'cad-derived-estimate';
  }
  return governing;
}

export function routeVerificationLabel(status: RouteVerificationStatus): string {
  return ROUTE_STATUS_LABEL[status];
}

/** §6 ROUTE PROVENANCE — the two-state annotation every route/trench/conduit
 *  label prints. Projects the ONE RouteVerificationStatus authority collapsed to
 *  estimate-vs-verified: an ESTIMATE (unverified / CAD-derived) never prints
 *  "field-verified" (gate 2); only a recorded field measurement / verification /
 *  as-built promotes to "ROUTE FIELD-VERIFIED". Granular 5-state consumers use
 *  routeVerificationLabel(routeVerificationStatus(snap)) directly. */
export function routeProvenanceLabel(snap: PermitDesignSnapshot | null | undefined): string {
  const st = routeVerificationStatus(snap);
  const verified = st === 'field-measured' || st === 'field-verified' || st === 'as-built-verified';
  return verified ? 'ROUTE FIELD-VERIFIED' : 'CAD-DERIVED ESTIMATE — FIELD VERIFY';
}

// ═══════════════════════════════════════════════════════════════════════════
// W1c §branch-authority — THE canonical projection of the micro AC BRANCH run
// (the Q-Cable trunk + branch home-run). Both PV-4B and E-1 read THIS so they
// can never disagree ("OPEN AIR" on E-1 vs "60 ft EMT" on PV-4B). Micro AC
// branch conductors on the manufacturer trunk cable are FREE-AIR rated
// (NEC 690.31(C) — Q Cable is TC-ER, permitted in free air under the modules);
// the branch length comes from the canonical BRANCH_RUN segment, NEVER from the
// project-level feeder wireLength (the "60 ft on every circuit" bug).
// ═══════════════════════════════════════════════════════════════════════════
const BRANCH_SEGMENT_IDS = ['BRANCH_RUN'];

export interface CanonicalBranchProjection {
  segment: RouteSegmentRecord | null;
  raceway: string | null;
  tradeSizeIn: string | null;
  /** display: 'FREE AIR (Q-CABLE / TC-ER)' or 'EMT 3/4"'. */
  conduitLabel: string | null;
  oneWayFt: number | null;
  gauge: string | null;
  egcGauge: string | null;
  voltageDropPct: number | null;
  lengthSource: RouteSegmentRecord['lengthSource'] | null;
  isOpenAir: boolean;
}

export function projectCanonicalBranch(snap: PermitDesignSnapshot | null | undefined): CanonicalBranchProjection {
  const segs = snap?.electrical?.routeSegments ?? [];
  const segment =
    segs.find(r => BRANCH_SEGMENT_IDS.includes(r.segmentId))
    ?? segs.find(r => /branch/i.test(r.segmentId) || /branch/i.test(r.from) || /branch/i.test(r.to))
    ?? null;
  const raceway = segment?.raceway ?? null;
  const isOpenAir = raceway === 'FREE_AIR' || snap?.electrical?.topology === 'MICRO';
  const conduitLabel = raceway === 'FREE_AIR'
    ? 'FREE AIR (Q-CABLE / TC-ER)'
    : (raceway && segment?.tradeSizeIn ? `${raceway} ${segment.tradeSizeIn}` : (raceway ?? (isOpenAir ? 'FREE AIR (Q-CABLE / TC-ER)' : null)));
  return {
    segment,
    raceway,
    tradeSizeIn: segment?.tradeSizeIn ?? null,
    conduitLabel,
    oneWayFt: num(segment?.oneWayFt),
    gauge: segment?.conductorGauge ?? null,
    egcGauge: segment?.egcGauge ?? null,
    voltageDropPct: num(segment?.voltageDropPct),
    lengthSource: segment?.lengthSource ?? null,
    isOpenAir,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3/§4 (closeout 2026-07-23) — THE canonical projection of the SHARED branch
// home-run raceway (the jbox→combiner conduit that carries all N branches
// bundled). E-1's SEGMENT_2A conduit label and PV-4B's home-run row read THIS,
// while the branch CONDUCTORS themselves ride the open-air Q-Cable trunk
// (projectCanonicalBranch). Two physical sections, never one merged string.
// ═══════════════════════════════════════════════════════════════════════════
export interface SharedBranchRacewayProjection {
  present: boolean;
  physicalRacewayId: string | null;
  racewayType: string | null;        // 'PVC Sch 80' …
  tradeSizeIn: string | null;
  necArticle: string | null;         // raceway-type authority (§7)
  sharedCircuitCount: number | null;
  conductorCount: number | null;
  currentCarryingCount: number | null;
  fillPct: number | null;
  minimumCodeRacewaySize: string | null;
  selectedRacewaySize: string | null;
  upsizingReason: string | null;
  oneWayFt: number | null;
  /** display: 'PVC Sch 80 1-1/4" — 3 branches shared'. */
  conduitLabel: string | null;
}

export function projectSharedBranchRaceway(snap: PermitDesignSnapshot | null | undefined): SharedBranchRacewayProjection {
  const empty: SharedBranchRacewayProjection = {
    present: false, physicalRacewayId: null, racewayType: null, tradeSizeIn: null, necArticle: null,
    sharedCircuitCount: null, conductorCount: null, currentCarryingCount: null, fillPct: null,
    minimumCodeRacewaySize: null, selectedRacewaySize: null, upsizingReason: null, oneWayFt: null,
    conduitLabel: null,
  };
  const elec = snap?.electrical;
  if (!elec) return empty;
  const raceways = (elec.physicalRaceways ?? []);
  const rw = raceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId)) ?? null;
  const seg = (elec.routeSegments ?? []).find(r => r.segmentId === 'BRANCH_HOMERUN_RUN') ?? null;
  if (!rw && !seg) return empty;
  const racewayType = rw?.racewayType ?? seg?.raceway ?? null;
  const tradeSizeIn = rw?.selectedRacewaySize ?? seg?.tradeSizeIn ?? null;
  const sharedCircuitCount = rw?.sharedCircuitCount ?? num(seg?.sharedCircuitCount);
  const conduitLabel = (racewayType && tradeSizeIn)
    ? `${racewayType} ${tradeSizeIn}${sharedCircuitCount && sharedCircuitCount > 1 ? ` — ${sharedCircuitCount} branches shared` : ''}`
    : (racewayType ?? null);
  return {
    present: true,
    physicalRacewayId: rw?.physicalRacewayId ?? seg?.physicalRacewayId ?? null,
    racewayType, tradeSizeIn,
    necArticle: rw?.necArticle ?? seg?.racewayNecArticle ?? null,
    sharedCircuitCount,
    conductorCount: rw?.conductorCount ?? null,
    currentCarryingCount: rw?.currentCarryingCount ?? null,
    fillPct: num(rw?.fillPct) ?? num(seg?.fillPct),
    minimumCodeRacewaySize: rw?.minimumCodeRacewaySize ?? seg?.minimumCodeRacewaySize ?? null,
    selectedRacewaySize: rw?.selectedRacewaySize ?? tradeSizeIn,
    upsizingReason: rw?.upsizingReason ?? seg?.upsizingReason ?? null,
    oneWayFt: num(seg?.oneWayFt),
    conduitLabel,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 (closeout 2026-07-23) — THE ONE canonical route-description accessor for
// conduit type/article. PV-1 drawing labels/callouts/notes/legend AND the
// titleBlock construction note read THIS — never `project.conduitType || 'EMT'`.
// It projects the ACTUAL physical raceway objects; when none exist it returns an
// honest PENDING descriptor (never a fabricated 'EMT'). The NEC article is the
// raceway-type authority's article (PVC→352, EMT→358 …), so a PVC run can never
// print an EMT-only citation (§7). One entry per distinct raceway type+size.
// ═══════════════════════════════════════════════════════════════════════════
export interface RacewayDescriptorEntry {
  racewayType: string;               // 'PVC Sch 80'
  tradeSizeIn: string | null;        // '1-1/4"'
  necArticle: string | null;         // '352'
  supportArticle: string | null;     // '352.30'
  sharedCircuitCount: number | null;
}
export interface ConstructionRacewayDescriptor {
  present: boolean;                  // false ⇒ no raceway objects → PENDING
  entries: RacewayDescriptorEntry[];
  /** one-line construction-note sentence, honest PENDING when no raceways. */
  noteText: string;
}

const _SUPPORT_ARTICLE: Record<string, string> = {
  '352': '352.30', '358': '358.30', '344': '344.30', '342': '342.30',
  '350': '350.30', '356': '356.30', '348': '348.30',
};

export function projectRacewayDescriptor(snap: PermitDesignSnapshot | null | undefined): ConstructionRacewayDescriptor {
  const elec = snap?.electrical;
  const raceways = elec?.physicalRaceways ?? [];
  // Build one entry per distinct (type, size) from the physical raceway objects;
  // fall back to in-conduit route segments if the raceway array is absent.
  const seen = new Set<string>();
  const entries: RacewayDescriptorEntry[] = [];
  for (const rw of raceways) {
    const key = `${rw.racewayType}|${rw.selectedRacewaySize ?? ''}`;
    if (seen.has(key)) continue; seen.add(key);
    entries.push({
      racewayType: rw.racewayType,
      tradeSizeIn: rw.selectedRacewaySize ?? null,
      necArticle: rw.necArticle || null,
      supportArticle: rw.supportArticle || (_SUPPORT_ARTICLE[rw.necArticle] ?? null),
      sharedCircuitCount: rw.sharedCircuitCount ?? null,
    });
  }
  if (entries.length === 0) {
    for (const seg of (elec?.routeSegments ?? [])) {
      if (!seg.raceway || seg.raceway === 'FREE_AIR') continue;
      const key = `${seg.raceway}|${seg.tradeSizeIn ?? ''}`;
      if (seen.has(key)) continue; seen.add(key);
      entries.push({
        racewayType: seg.raceway, tradeSizeIn: seg.tradeSizeIn ?? null,
        necArticle: seg.racewayNecArticle ?? null,
        supportArticle: seg.racewayNecArticle ? (_SUPPORT_ARTICLE[seg.racewayNecArticle] ?? null) : null,
        sharedCircuitCount: num(seg.sharedCircuitCount),
      });
    }
  }
  if (entries.length === 0) {
    return {
      present: false, entries: [],
      noteText: 'Conduit type: PENDING — see the conductor & conduit schedule (PV-4B) once the raceway authority is resolved. '
        + 'Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.',
    };
  }
  const typePhrase = entries
    .map(e => `${e.racewayType}${e.tradeSizeIn ? ` (${e.tradeSizeIn})` : ''}`)
    .join('; ');
  const supportPhrase = entries
    .map(e => `${e.racewayType} per NEC ${e.supportArticle ?? (e.necArticle ? `${e.necArticle}.30` : 'the applicable article')}`)
    .join('; ');
  return {
    present: true,
    entries,
    noteText: `Conduit type: ${typePhrase}. Conduit supports: ${supportPhrase}. `
      + `Conduit fill shall not exceed 40% per NEC Chapter 9, Table 1.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// W3 §topology-description — the ONE canonical electrical-topology sentence for
// array/branch drawing captions (PV-1B) and any sheet that describes how the
// modules connect. Micro designs are PARALLELED on an AC branch circuit — never
// "wired in series" (gate 1). Brand-aware: Enphase micros ride an Enphase Q
// Cable AC trunk. No renderer may hardcode the connection topology string.
// ═══════════════════════════════════════════════════════════════════════════
export function topologyDescription(snap: PermitDesignSnapshot | null | undefined): string {
  const topo = snap?.electrical?.topology ?? null;
  const micro = snap?.equipment?.microInverters?.[0];
  const mfr = (micro?.manufacturer ?? '').trim();
  const isEnphase = /enphase/i.test(mfr);
  if (topo === 'MICRO') {
    const trunk = isEnphase ? 'ENPHASE Q CABLE AC BRANCH CIRCUIT'
      : (mfr ? `${mfr.toUpperCase()} AC BRANCH CIRCUIT` : 'AC BRANCH CIRCUIT');
    return `MICROINVERTERS CONNECTED IN PARALLEL ON ${trunk}`;
  }
  if (topo === 'OPTIMIZER') return 'DC POWER OPTIMIZERS ON A SERIES STRING TO A CENTRAL INVERTER';
  if (topo === 'STRING') return 'MODULES WIRED IN SERIES STRINGS TO A CENTRAL STRING INVERTER';
  if (topo === 'HYBRID') return 'HYBRID — SEE PER-SUBSYSTEM TOPOLOGY ON THE ELECTRICAL SHEETS';
  return 'SEE ELECTRICAL SHEETS FOR CIRCUIT TOPOLOGY';
}

/** Short caption form for PV-1B's module-shading key (no sheet-local literal). */
export function branchLayoutCaption(snap: PermitDesignSnapshot | null | undefined): string {
  const micro = snap?.equipment?.microInverters?.[0];
  const isEnphase = /enphase/i.test((micro?.manufacturer ?? '').trim());
  const dev = isEnphase ? 'IQ MICROINVERTER' : 'MICROINVERTER';
  const trunk = isEnphase ? 'ENPHASE Q CABLE AC BRANCH (COLORED)' : 'AC BRANCH CIRCUIT (COLORED)';
  return `${dev} (▪) UNDER EACH MODULE · CONNECTED IN PARALLEL ON ${trunk} · DASHED = HOMERUN TO JB · SEE LEGEND IN DATA RAIL`;
}
