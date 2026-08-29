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
import type { PermitDesignSnapshot, RouteSegmentRecord, GroundingSegment } from './types';
import { ROUTE_VD_LIMIT_PCT } from '@/lib/electrical/routeLengthBound';
import { closesFieldVerification, type RouteVerificationState } from './types';
import { evaluateCompliance, type ComplianceResult } from './complianceState';
import { GROUNDING_PENDING_BONDING_CELL_LABEL } from './groundingAuthority';
// ECD W1-A — the stable, content-derived BOM row identity (same function the
// BOM stamping pass uses, so a pre-BOM projection can reference a real row id).
import { bomLineIdFor } from '@/lib/bom/bomLineId';
import { recalculateRouteVoltageDrop } from './routeVoltageDropRecalc';
import {
  ampacityTable75C, ampacityTable90C, ambientCorrectionFactor, conductorCountAdjustmentFactor,
} from '@/lib/computed-system';

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
  // ══ 2026-08-29 - THE PHYSICAL RACEWAY WINS ═══════════════════════════════
  // The precedence was backwards. `feeder.conduit.fillPct` comes from
  // electrical-calc.ts's own Chapter 9 tables - a parallel fill engine, computed
  // from a nominal conductor count - while `segment.fillPct` is read off the
  // PHYSICAL RACEWAY OBJECT, the same object E-1's sectioned schedule prints and
  // the same one the ampacity derations are taken against. They disagreed:
  // PV-4A's "Conduit Fill Analysis" read 32.0% while every raceway on the
  // package read 26.2% / 32.5% / 32.5%. 32.0% described no conduit in the design.
  //
  // A raceway's fill is a property OF THAT RACEWAY. The physical object answers;
  // the legacy feeder field is only a fallback for snapshots built before those
  // objects existed.
  const raceway = segment?.raceway ?? feeder?.conduit?.raceway ?? null;
  const tradeSizeIn = segment?.tradeSizeIn ?? feeder?.conduit?.tradeSizeIn ?? null;
  const fillPct = num(segment?.fillPct) ?? num(feeder?.conduit?.fillPct);
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
  | 'geometry-derived'         // WS-5: taken from ROUTED CAD geometry — stronger than
                               // an estimate, still not field evidence
  // 2026-08-29 — THE READER'S LIST WAS BEHIND THE WRITER'S. `build.ts` has been
  // stamping `verificationStatus: 'design-constraint'` on every route segment
  // whose length the DESIGN fixes (the NEC 705.11(C) tap span: "FIXED BY DESIGN
  // at the 10 ft maximum", state `pass-by-design`). This union never listed it,
  // so `ROUTE_STATUS_RANK.indexOf(...)` returned -1, which is lower than every
  // real rank — the value therefore won the weakest-status comparison outright
  // and governed the whole package, and `ROUTE_STATUS_LABEL[...]` returned
  // `undefined`, which SCHED printed verbatim:
  //     "ROUTE AUTHORITY: PENDING — undefined"
  // A length the drawing FIXES is not an unverified guess to be field-checked;
  // it is a design requirement the installation must follow. It ranks above the
  // estimates and below field evidence, because field inspection still confirms
  // the install matches the drawing.
  | 'design-constraint'        // the DESIGN fixes this length (NEC 705.11(C) tap span)
  | 'field-reported'           // WS-5: operator-entered, NOT yet verified
  | 'field-measured'           // a tech measured the run in the field
  | 'field-verified'           // measured AND verified against the installed route
  | 'as-built-verified';       // as-built record closes the loop

const ROUTE_STATUS_LABEL: Record<RouteVerificationStatus, string> = {
  'unverified-estimate': 'UNVERIFIED ESTIMATE — FIELD VERIFY',
  'cad-derived-estimate': 'CAD-DERIVED ESTIMATE — FIELD VERIFY',
  'geometry-derived': 'CAD ROUTE — GEOMETRY DERIVED — FIELD VERIFY',
  'design-constraint': 'FIXED BY DESIGN — INSTALL PER DRAWING',
  'field-reported': 'FIELD REPORTED — UNVERIFIED',
  'field-measured': 'FIELD-MEASURED',
  'field-verified': 'FIELD-VERIFIED',
  'as-built-verified': 'AS-BUILT VERIFIED',
};

/** Order weakest→strongest so we can pick the governing (weakest) status. */
const ROUTE_STATUS_RANK: RouteVerificationStatus[] = [
  // WS-5 — weakest→strongest. geometry-derived outranks a bare estimate (the
  // route is really in the model) but sits BELOW any field evidence; a
  // field REPORT outranks geometry but is not verification.
  'unverified-estimate', 'cad-derived-estimate', 'geometry-derived', 'design-constraint',
  'field-reported', 'field-measured', 'field-verified', 'as-built-verified',
];

/** THE predicate for "did somebody actually go and check this run". It was
 *  written out longhand in two places - here and in structuralPages' SCHED block
 *  - and the SCHED copy was wired straight into a release verdict, so a route
 *  whose length the design FIXES printed OVERALL RELEASE: BLOCKED on every
 *  branch. Provenance is not a release gate; ROUTE-LENGTH-ESTIMATE is the
 *  declared requirement that answers that, and it is resolved on this design. */
export function isRouteFieldVerified(status: RouteVerificationStatus): boolean {
  return status === 'field-measured' || status === 'field-verified' || status === 'as-built-verified';
}

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
  if (isRouteFieldVerified(st)) return 'ROUTE FIELD-VERIFIED';
  // A design-constraint length is not a CAD estimate awaiting a tape measure -
  // the drawing carries the placement requirement and the conductors are sized on
  // it. Calling it an estimate told the installer to go verify a number that is
  // theirs to ACHIEVE.
  if (st === 'design-constraint') return 'LENGTH FIXED BY DESIGN — INSTALL PER DRAWING';
  return 'CAD-DERIVED ESTIMATE — FIELD VERIFY';
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
// §6/§7/§10 (closeout 2026-07-23) — THE canonical projection of the micro AC
// branch trunk as a LISTED CABLE ASSEMBLY with GEOMETRY-DERIVED per-branch
// lengths. PV-4B/E-1/SCHED/BOM/APP-A read THIS instead of a generic "#12 AWG
// THWN-2" row for the open-air branch section (gate 6). The trunk description is
// the assembly (manufacturer + model/SKU + construction + listing), NEVER a
// translated THWN gauge. Lengths carry §10 taxonomy meaning + a segment/assembly
// id so no printed number mixes a design route with a procurement quantity.
// ═══════════════════════════════════════════════════════════════════════════
import type { ListedCableAssembly, BranchCablePath } from './types';

export interface ListedCableAssemblyProjection {
  present: boolean;
  assembly: ListedCableAssembly | null;
  /** the free-air branch CONDUCTOR cell — the assembly description, never THWN. */
  conductorCell: string;
  /** short label for tight cells ('ENPHASE Q CABLE Q-12-10-240'). */
  shortLabel: string;
  /** per-branch cable-path objects (geometry-derived designed-installed lengths). */
  branchPaths: BranchCablePath[];
  /** Σ procurement footage (BOM basis) + Σ designed-installed (route basis). */
  totalProcurementFt: number | null;
  totalDesignedInstalledFt: number | null;
  totalDrops: number | null;
  lengthProvenance: 'geometry-derived' | 'estimated' | null;
  /** §Q sanity — procurement (drop-count × pitch × waste) should envelope the
   *  geometric designed-installed path. When designed EXCEEDS procurement the
   *  module spacing outran the connector pitch (the drop-based order undershoots
   *  the installed path) — flagged honestly, never tuned away. */
  designedExceedsProcurement: boolean;
  /** one-line reconciliation sentence naming the two distinct quantities + the sanity result. */
  reconciliationNote: string | null;
}

export function projectListedCableAssembly(snap: PermitDesignSnapshot | null | undefined): ListedCableAssemblyProjection {
  const asm = snap?.electrical?.listedCableAssembly ?? null;
  const paths = snap?.electrical?.branchCablePaths ?? [];
  const empty: ListedCableAssemblyProjection = {
    present: false, assembly: null,
    conductorCell: 'PENDING — branch cable assembly authority incomplete',
    shortLabel: 'AC TRUNK CABLE', branchPaths: [],
    totalProcurementFt: null, totalDesignedInstalledFt: null, totalDrops: null, lengthProvenance: null,
    designedExceedsProcurement: false, reconciliationNote: null,
  };
  if (!asm) return empty;
  const gauge = asm.conductorGauge ?? '';
  const cnt = asm.conductorCount ?? null;
  // conductor cell = the LISTED ASSEMBLY, never a bare THWN gauge (gate 6).
  const conductorCell = `${asm.wiringMethodLabel}`
    + (asm.sku ? ` · ${asm.sku}` : '')
    + (cnt && gauge ? ` · ${cnt}×${gauge}` : gauge ? ` · ${gauge}` : '')
    + (asm.maxBranchCurrentA ? ` · ${asm.maxBranchCurrentA}A branch (listed)` : '');
  const shortLabel = `${asm.manufacturer.toUpperCase()} ${asm.ecosystem}`.trim() + (asm.sku ? ` ${asm.sku}` : '');
  const totalProc = paths.reduce((s, p) => s + (p.procurementLengthFt ?? 0), 0);
  const totalDesigned = paths.reduce((s, p) => s + (p.designedInstalledLengthFt ?? 0), 0);
  const totalDrops = paths.reduce((s, p) => s + (p.dropCount ?? 0), 0) || asm.dropCount;
  const geom = paths.length > 0 && paths.every(p => p.lengthProvenance === 'geometry-derived');
  const _proc = totalProc > 0 ? Math.round(totalProc) : (asm.cableLengthFt ?? null);
  const _designed = totalDesigned > 0 ? Math.round(totalDesigned * 10) / 10 : null;
  // §Q sanity — the two quantities are DIFFERENT (design geometry vs drop-count
  // procurement); procurement should envelope the designed path. designed >
  // procurement ⇒ module spacing outran the connector pitch (order undershoots).
  const _exceeds = _designed != null && _proc != null && _designed > _proc;
  const _note = (_designed != null && _proc != null)
    ? `designed-installed ${_designed} ft (Σ geometric per-branch cable path, BranchCablePath objects) `
      + `vs procurement ${_proc} ft (Σ drops × ${asm.connectorSpacingFt ?? '—'} ft pitch × waste — drop-count basis, not designed×waste). `
      + (_exceeds
        ? `⚠ designed EXCEEDS procurement — module spacing outran the connector pitch; FIELD-VERIFY Q-Cable length / add jumpers (not tuned).`
        : `designed ≤ procurement (sanity OK).`)
    : null;
  return {
    present: true, assembly: asm, conductorCell, shortLabel, branchPaths: paths,
    totalProcurementFt: _proc,
    totalDesignedInstalledFt: _designed,
    totalDrops: totalDrops ?? null,
    lengthProvenance: paths.length ? (geom ? 'geometry-derived' : 'estimated') : null,
    designedExceedsProcurement: _exceeds,
    reconciliationNote: _note,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPEN-AIR BRANCH GROUNDING — THE PROJECTION of the canonical, DOCUMENT-BASED
// grounding authority (electrical.openAirGroundingAuthority, groundingAuthority.ts).
//
// CORRECTED 2026-07-25 (Ray's ruling). This projection previously CONCLUDED
// "separate EGC required" from `conductorCount === 2`. Conductor count alone is
// not manufacturer or code authority: a listed two-conductor assembly serving a
// double-insulated (Class II) microinverter system may intentionally require no
// additional grounding conductor. The outcome now comes from the resolver, which
// can only reach outcome A or B from a VERIFIED, EXACTLY-APPLICABLE manufacturer
// document for the selected micro SKU + cable SKU + module + mounting/bonding
// system + jurisdiction. No document ⇒ PENDING_MANUFACTURER_AUTHORITY (fail-closed).
//
// This projection derives NOTHING about the method — it reads the snapshot's one
// authority object and exposes it (plus the route/quantity taxonomy) to the seven
// surfaces. It applies ONLY to the open-air branch section (§5 separation).
// ═══════════════════════════════════════════════════════════════════════════
export interface OpenAirBranchGroundingAuthority {
  present: boolean;
  /** true only under (B); false under (A); NULL under (C) — a PENDING method is
   *  NOT "not required". Never render this as a boolean claim on its own. */
  required: boolean | null;
  /** the canonical three-outcome result (the truth every surface reads). */
  outcome: import('./groundingAuthority').GroundingOutcome;
  /** the full authority record (document, applicability, NEC basis, separation). */
  authority: import('./groundingAuthority').GroundingAuthorityResult | null;
  /** the ONE label every sheet prints for this section. */
  renderLabel: string;
  /** BOM behaviour driven by the outcome: A no row, B orderable, C design-quantity. */
  bomRowState: 'no-row' | 'orderable' | 'design-quantity-non-orderable';
  nonOrderable: boolean;
  /** back-compat method mapping — A ⇒ integrated-listed, B ⇒ separate-conductor,
   *  C ⇒ pending. Derived from `outcome`; never independently decided. */
  groundingMethod: 'separate-conductor' | 'integrated-listed' | 'none-required' | 'pending';
  conductorMaterial: string | null;   // 'Cu'
  conductorSize: string | null;        // '#10 AWG'
  /** the branch objects the open-air EGC parallels (branch ids / segment id). */
  segmentIds: string[];
  branchIds: string[];
  pathBasis: string;
  /** Σ geometric designed-installed cable path (ft) — SAME geometry as the trunk. */
  designedInstalledFt: number | null;
  lengthProvenance: 'geometry-derived' | 'estimated' | null;
  wasteFactor: number;
  /** Σ designed-installed × waste — the BOM procurement footage for the open-air EGC. */
  bomFootageFt: number | null;
  /** the DOCUMENT authority for the method (never a conductor-count inference).
   *  Under (C) this states the fail-closed pending condition. */
  sourceAuthority: string;
  codeBasis: string;
  equipmentCompatibility: string;
  verificationState: string;
  provenance: string;
}

export function projectOpenAirBranchGrounding(snap: PermitDesignSnapshot | null | undefined): OpenAirBranchGroundingAuthority {
  const empty: OpenAirBranchGroundingAuthority = {
    present: false, required: null, outcome: 'PENDING_MANUFACTURER_AUTHORITY', authority: null,
    renderLabel: 'GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY',
    bomRowState: 'no-row', nonOrderable: false, groundingMethod: 'pending',
    conductorMaterial: null, conductorSize: null, segmentIds: [], branchIds: [],
    pathBasis: 'branch cable paths', designedInstalledFt: null, lengthProvenance: null,
    wasteFactor: 1.15, bomFootageFt: null,
    sourceAuthority: 'PENDING — no applicable manufacturer document',
    codeBasis: 'NEC 110.3(B)',
    equipmentCompatibility: 'PENDING', verificationState: 'pending', provenance: 'no snapshot / non-micro',
  };
  const elec = snap?.electrical;
  if (!elec || elec.topology !== 'MICRO') return empty;
  const branchGnd = (elec.groundingObjects ?? []).filter(g => g.purpose === 'branch-egc');
  if (branchGnd.length === 0) return empty;

  // THE authority object built by the snapshot. If it is absent (a legacy/partial
  // snapshot), we FAIL CLOSED to pending — we never re-derive a method here.
  const auth = elec.openAirGroundingAuthority ?? null;
  if (!auth) {
    return { ...empty, present: true, provenance: 'no openAirGroundingAuthority on this snapshot — fail-closed pending' };
  }

  const asm = elec.listedCableAssembly ?? null;
  const outcome = auth.outcome;
  const groundingMethod: OpenAirBranchGroundingAuthority['groundingMethod'] =
    outcome === 'SEPARATE_EGC_REQUIRED' ? 'separate-conductor'
      : outcome === 'NO_SEPARATE_EGC_REQUIRED' ? 'integrated-listed'
        : 'pending';

  return {
    present: true,
    required: outcome === 'SEPARATE_EGC_REQUIRED' ? true
      : outcome === 'NO_SEPARATE_EGC_REQUIRED' ? false : null,
    outcome,
    authority: auth,
    renderLabel: auth.renderLabel,
    bomRowState: auth.bomRowState,
    nonOrderable: auth.bomRowState === 'design-quantity-non-orderable',
    groundingMethod,
    conductorMaterial: auth.conductorMaterial,
    conductorSize: auth.conductorSizeNecDerived,
    segmentIds: auth.segmentIds,
    branchIds: auth.branchIds,
    pathBasis: auth.pathBasis,
    designedInstalledFt: auth.designedInstalledFt,
    lengthProvenance: auth.lengthProvenance,
    wasteFactor: auth.wasteFactor,
    bomFootageFt: auth.quantityFt,
    sourceAuthority: outcome === 'PENDING_MANUFACTURER_AUTHORITY'
      ? `NOT ESTABLISHED — ${auth.applicabilityVerification.failures[0] ?? 'no applicable manufacturer document'}`
      : `${auth.documentId ?? 'verified document'} ${auth.documentSectionOrPage ?? ''}`.trim()
        + ` (SHA-256 ${auth.documentHash ? auth.documentHash.slice(0, 12) : '—'}) — applicable to the exact selected `
        + `${auth.selectedMicroinverterSku ?? 'microinverter'} + ${auth.selectedCableAssemblySku ?? 'cable assembly'}`,
    codeBasis: auth.necBasis,
    equipmentCompatibility: asm
      ? `open-air branch section = ${asm.wiringMethodLabel} (TC-ER, free-air 690.31(C))`
      : 'open-air branch section = listed AC trunk cable (free-air 690.31(C))',
    verificationState: outcome === 'PENDING_MANUFACTURER_AUTHORITY'
      ? 'PENDING MANUFACTURER AUTHORITY — fail-closed; no grounding conclusion is drawn for this section'
      : 'verified manufacturer document (exact-SKU applicability confirmed)',
    provenance: `electrical.openAirGroundingAuthority (${auth.provenance.source}); `
      + `groundingObjects[purpose=branch-egc] × ${branchGnd.length} branches`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PPC §7 — THE canonical GroundingSegment projection.
//
// This replaces the legacy PV-4B project-level EGC row: a hardcoded `<tr>` that
// relabelled the FEEDER's EGC gauge "Array → AC Disconnect (ground bus)" and
// reprinted the FEEDER row's own conduit + length as if they were the grounding
// run's. It had no id, no segment, no raceway of its own, no BOM line and no
// authority state — it reconciled with nothing.
//
// Every grounding conductor a sheet renders is now ONE of these objects, built
// from the per-purpose canonical `groundingObjects` + their `routeSegments` +
// `physicalRaceways` + the open-air grounding authority. The six domains Ray
// requires kept separate stay separate: nothing borrows another object's size,
// raceway, length or authority state. Gate 10: no rendered grounding row without
// a `groundingSegmentId`.
//
// PROJECTED, not stored — the snapshot digest is unchanged.
// ═══════════════════════════════════════════════════════════════════════════
const _PURPOSE_LABEL: Record<string, string> = {
  'branch-egc': 'Open-air branch (listed cable assembly) equipment grounding',
  'feeder-egc': 'Feeder equipment grounding conductor (in raceway)',
  'raceway-bond': 'Raceway / enclosure bonding',
  'gec': 'Grounding electrode conductor (GEC)',
  'integrated-listed-method': 'Listed integrated grounding method',
  'module-racking-bonding': 'Module-frame + racking bonding (UL 2703)',
  // P13 WS-1 — the array/racking bonding EGC: the conductor from the bonded
  // module/racking system to the rooftop equipment-ground point.
  'array-rack-bonding-egc': 'Array / racking bonding equipment grounding conductor',
};

/** ECD §6 — the id of the ONE grouped branch-EGC authority node. It is deliberately
 *  NOT any physical segment's id: `gnd-br-1` used to be used here, which made a
 *  physical identity double as the grouped-authority identity (and then that one id
 *  was stamped on all three E-1 branch rows). The grouped node is an AUTHORITY, not
 *  an installed path — it is never counted as a physical grounding segment. */
export const BRANCH_EGC_AUTHORITY_GROUP_ID = 'gnd-branch-egc-authority';

/** ── WS-5 — VOLTAGE-DROP CONCLUSION GRADE ─────────────────────────────────
 *  A voltage-drop result has THREE separable parts: the arithmetic, the
 *  authority of the length it was computed from, and the release conclusion.
 *  The sheet used to print an unqualified `✓ PASS` for a 0.369% result derived
 *  from a 20 ft CAD ESTIMATE — correct arithmetic presented at the grade of a
 *  measured conclusion.
 *
 *  A failure stays a failure at every grade: an over-limit result computed from
 *  an estimate is still over the limit, and softening it to "provisional" would
 *  be the same defect pointed the other way. */
export type VoltageDropConclusion =
  | 'VERIFIED_PASS'
  | 'PROVISIONAL_PASS'
  | 'FAIL'
  | 'INDETERMINATE';

export interface VoltageDropGrade {
  conclusion: VoltageDropConclusion;
  /** what a sheet prints: 'VERIFIED PASS' / 'PROVISIONAL PASS' / 'FAIL' / … */
  label: string;
  /** one sentence naming the length the number rests on. */
  basis: string;
  pct: number | null;
  limitPct: number;
  lengthFt: number | null;
  lengthSource: string | null;
  verificationState: string | null;
  // ── D5 (Planset 19) — THE RELEASE STATE, PROJECTED SEPARATELY ─────────────
  // The conclusion above answers "is the arithmetic within the criterion, and at
  // what grade". These two answer "what is the length authority, and does a
  // field-verification requirement remain open". PV-4B.1 used to print ONE badge
  // that answered only the second question — `PENDING — REVIEW REQ’D` on the very
  // same 20 ft / 0.37% feeder PV-4B graded `PROVISIONAL PASS`. A sheet must never
  // have to infer one of these facts from the other, and must never substitute
  // one for the other.
  /** the length authority, as a sheet prints it: 'CAD-DERIVED ESTIMATE' |
   *  'CAD ROUTE — GEOMETRY DERIVED' | 'FIELD VERIFIED' | 'FIELD-REPORTED (UNVERIFIED)' |
   *  'NOT ESTABLISHED'. Never a conclusion — purely where the number came from. */
  lengthAuthorityLabel: string;
  /** true while a FIELD-VERIFICATION requirement on this length is still open.
   *  Independent of the conclusion: a PROVISIONAL_PASS and a FAIL can both carry
   *  an open field requirement, and closing the requirement never upgrades a FAIL. */
  fieldVerificationPending: boolean;
}

export function gradeVoltageDrop(args: {
  pct: number | null | undefined;
  limitPct?: number;
  lengthFt?: number | null;
  lengthSource?: string | null;
  verificationState?: string | null;
}): VoltageDropGrade {
  const limitPct = args.limitPct ?? 3;
  const pct = num(args.pct);
  const lengthFt = num(args.lengthFt);
  const lengthSource = args.lengthSource ?? null;
  const verificationState = args.verificationState ?? null;
  // D5 — the ONE canonical predicate (types.ts). The literal pair it replaces was
  // a second copy of the same rule, and a second copy is a future divergence.
  const verified = closesFieldVerification(verificationState as RouteVerificationState | null);

  // D5 — this sentence is fed BOTH length-source vocabularies: the resolver's
  // `RouteLengthSource` ('cad-route' | 'field-verified' | …) and the value the
  // snapshot actually stamps on a segment, `RouteSegmentRecord.lengthSource`
  // ('field-measurement' | 'operator-entry' | …). It used to enumerate only the
  // first, so the two values the field-measurement applier WRITES both fell
  // through to the default — a walked 87 ft run was described on the sheet as a
  // "CAD-derived estimate". The verification STATE decides how strongly a
  // measurement is claimed; the source only says what kind of thing it is.
  const sourceLabel = lengthSource === 'cad-route' ? 'CAD-routed geometry'
    : lengthSource === 'field-verified' ? 'FIELD-VERIFIED measurement'
    : lengthSource === 'field-reported' ? 'field-reported measurement (UNVERIFIED)'
    : lengthSource === 'field-measurement' || lengthSource === 'operator-entry'
      ? (verified ? 'FIELD-VERIFIED measurement' : 'field-reported measurement (UNVERIFIED)')
    // 2026-08-29 - `known-design` fell through to "CAD-derived estimate" here and
    // to 'CAD-DERIVED ESTIMATE' below, so PV-4B.1's DISCO_TO_METER_RUN row printed
    // `design-constraint` in its provenance column and CAD-DERIVED ESTIMATE two
    // columns to the right. One row, one length, two accounts of where it came
    // from - and the wrong one told the installer to go field-verify a distance
    // the drawing REQUIRES them to achieve (NEC 705.11(C), 10 ft maximum).
    : lengthSource === 'known-design' ? 'a length FIXED BY DESIGN'
    : 'CAD-derived estimate';

  // D5 — the LENGTH AUTHORITY, stated on its own terms. It reads the canonical
  // (source, state) pair, so a `cad-route` length is never flattened into
  // "estimate" and a `field-reported` one is never promoted to "verified".
  const lengthAuthorityLabel = lengthFt == null ? 'NOT ESTABLISHED'
    : verified ? 'FIELD VERIFIED'
    : verificationState === 'field-reported' || verificationState === 'field-measured'
      || lengthSource === 'field-measurement' || lengthSource === 'field-reported'
      || lengthSource === 'operator-entry'
      ? 'FIELD-REPORTED (UNVERIFIED)'
    : verificationState === 'design-constraint' || lengthSource === 'known-design'
      ? 'FIXED BY DESIGN — INSTALL PER DRAWING'
    : verificationState === 'geometry-derived' || lengthSource === 'cad-route'
      ? 'CAD ROUTE — GEOMETRY DERIVED'
    : 'CAD-DERIVED ESTIMATE';
  const _designFixed = verificationState === 'design-constraint' || lengthSource === 'known-design';
  // Open while nothing FIELD-VERIFIED backs the length. A length that does not
  // exist yet cannot have a satisfied field requirement either.
  //
  // 2026-08-29 - EXCEPT a length the DESIGN fixes. The tap span is not an estimate
  // waiting on a tape measure: the drawing states the maximum, the conductors are
  // sized on it, and the installer's job is to MEET it. Flagging it pending said
  // we owed a measurement on a number that is a requirement, not an observation.
  const fieldVerificationPending = !verified && !_designFixed;
  const rest = {
    pct, limitPct, lengthFt, lengthSource, verificationState,
    lengthAuthorityLabel, fieldVerificationPending,
  };

  if (pct == null || lengthFt == null) {
    return {
      conclusion: 'INDETERMINATE', label: 'INDETERMINATE',
      basis: 'No usable route length or incomplete electrical inputs — no voltage-drop conclusion can be drawn.',
      ...rest,
    };
  }
  if (pct > limitPct) {
    // over the limit at ANY grade — an estimate does not soften a failure
    return {
      conclusion: 'FAIL', label: '✗ FAIL',
      basis: `${pct.toFixed(2)}% exceeds the ${limitPct.toFixed(1)}% criterion. Length basis: ${lengthFt} ft ${sourceLabel}.`,
      ...rest,
    };
  }
  if (verified) {
    return {
      conclusion: 'VERIFIED_PASS', label: '✓ VERIFIED PASS',
      basis: `Length basis: ${lengthFt} ft FIELD-VERIFIED.`,
      ...rest,
    };
  }
  return {
    conclusion: 'PROVISIONAL_PASS', label: 'PROVISIONAL PASS',
    // A design-fixed length is still PROVISIONAL - inspection confirms the install
    // follows the drawing - but the outstanding step is compliance with a stated
    // requirement, not the supply of a measurement we are missing.
    basis: _designFixed
      ? `Length basis: ${lengthFt} ft ${sourceLabel}. The drawing carries this as a requirement; `
        + `inspection confirms the installation follows it.`
      : `Length basis: ${lengthFt} ft ${sourceLabel}. Field-verified route length required for final acceptance.`,
    ...rest,
  };
}

/** D5 (Planset 19) — the ONE sheet-facing renderer of the two separated facts.
 *  Any sheet printing a voltage-drop verdict prints THESE two lines, so PV-4B and
 *  PV-4B.1 cannot word the same result differently. Returns plain strings; the
 *  caller owns the markup. */
export function voltageDropDisplayFields(g: VoltageDropGrade): {
  calculation: string; lengthAuthority: string;
} {
  const calculation = g.pct == null
    ? `${g.label} — no usable voltage-drop input`
    : `${g.label} — ${g.pct.toFixed(2)}% ${g.pct > g.limitPct ? '>' : '≤'} ${g.limitPct.toFixed(1)}%`;
  const lengthAuthority = g.fieldVerificationPending && g.lengthFt != null
    ? `${g.lengthAuthorityLabel} — FIELD VERIFICATION PENDING`
    : g.lengthAuthorityLabel;
  return { calculation, lengthAuthority };
}

/** D5 — the ONE colour ramp for a voltage-drop conclusion (was inlined in PV-4B's
 *  template, which is how a second sheet could have picked different colours). */
export function voltageDropConclusionColor(c: VoltageDropConclusion): string {
  return c === 'FAIL' ? '#cc0000' : c === 'INDETERMINATE' ? '#cc6600'
    : c === 'PROVISIONAL_PASS' ? '#b45309' : '#127a3e';
}

/** ── THE CANONICAL GROUNDING SUMMARY (Planset 17 D2) ──────────────────────
 *  Grounding on a PV package is SEGMENT-SPECIFIC. There is no project-wide EGC
 *  minimum, and printing one is a false statement about a life-safety conductor:
 *  a single gauge presented as "the minimum" simultaneously over-states the
 *  branch (whose canonical EGC is #12) and mis-attributes the feeder's #10 to
 *  the whole package — while the selected microinverter's own product authority
 *  may require no separate EGC at all.
 *
 *  This is the ONE object a general note may summarise from. It derives every
 *  value from the canonical grounding objects and never re-sizes anything. */
export interface GroundingSummaryProjection {
  /** the manufacturer product-grounding conclusion, verbatim from the authority. */
  productGroundingOutcome: string | null;
  /** always true for a PV package — stated explicitly so a renderer cannot
   *  quietly assume otherwise. */
  segmentSpecificSizing: true;
  /** always false — the fact this object exists to assert. */
  projectWideMinimumApplies: false;
  /** where a reader goes for the per-segment numbers. */
  scheduleSheetRefs: readonly string[];
  /** the canonical per-domain sizes, for a note that wants to enumerate rather
   *  than merely point. Null where the authority has not established one. */
  branchEgcSize: string | null;
  feederEgcSize: string | null;
  arrayBondCalculatedMinimum: string | null;
  arrayBondSelectedDesign: string | null;
}

export function projectGroundingSummary(
  snap: PermitDesignSnapshot | null | undefined,
): GroundingSummaryProjection {
  const oa = projectOpenAirBranchGrounding(snap) as unknown as { outcome?: string | null };
  const segs = projectGroundingSegments(snap);
  const byRole = (role: string): GroundingSegment | undefined =>
    segs.find(s => String((s as unknown as { domain?: string }).domain ?? s.segmentRole ?? '') === role);
  const arrayBond = byRole('array-rack-bonding-egc');
  return {
    productGroundingOutcome: oa?.outcome ?? null,
    segmentSpecificSizing: true,
    projectWideMinimumApplies: false,
    scheduleSheetRefs: ['PV-4B', 'PV-4B.1'],
    branchEgcSize: projectSharedBranchRaceway(snap).egcGauge ?? null,
    feederEgcSize: projectCanonicalFeeder(snap).egcGauge ?? null,
    arrayBondCalculatedMinimum: arrayBond?.calculatedMinimumSize ?? null,
    arrayBondSelectedDesign: arrayBond?.selectedDesignSize ?? arrayBond?.conductorSize ?? null,
  };
}

export function projectGroundingSegments(
  snap: PermitDesignSnapshot | null | undefined,
): GroundingSegment[] {
  const elec = snap?.electrical;
  if (!elec) return [];
  const objs = elec.groundingObjects ?? [];
  if (objs.length === 0) return [];
  const segs = elec.routeSegments ?? [];
  const raceways = elec.physicalRaceways ?? [];
  const oa = projectOpenAirBranchGrounding(snap);
  const asm = projectListedCableAssembly(snap);
  const branches = elec.branches ?? [];

  const out: GroundingSegment[] = [];
  // The OPEN-AIR branch section is ONE authority domain over all branches (the
  // canonical model stores one branch-egc record per branch). It is rendered as
  // ONE object naming every branch — not N near-identical rows that would read as
  // N independent authorities.
  //
  // ECD §6 — that grouped object is a GROUP-AUTHORITY node and it now carries its
  // OWN id (BRANCH_EGC_AUTHORITY_GROUP_ID). It used to be emitted with
  // `g.groundingId` — i.e. the FIRST branch record's PHYSICAL id, `gnd-br-1` — so a
  // physical segment identity was simultaneously the grouped-authority identity and
  // (via the E-1 stamp below) the identity of all three physical branch rows. The
  // three physical identities gnd-br-1/2/3 are preserved and rendered by the E-1
  // sectioned schedule; this node is the ONE authority they all reference.
  const _branchEgcIds = objs.filter(g => g.purpose === 'branch-egc').map(g => g.groundingId);
  const _branchEgcScope = objs.filter(g => g.purpose === 'branch-egc')
    .map(g => (g.associatedEquipment ?? '').replace(/^AC branch\s*/i, '').trim() || g.groundingId);
  let _branchEgcEmitted = false;
  for (const g of objs) {
    if (g.purpose === 'branch-egc') {
      if (_branchEgcEmitted) continue;
      _branchEgcEmitted = true;
    }
    const seg = segs.find(r => r.segmentId === g.segmentId) ?? null;
    const rw = seg?.physicalRacewayId
      ? raceways.find(r => r.physicalRacewayId === seg.physicalRacewayId) ?? null
      : null;
    const inRaceway = !!(seg?.raceway && seg.raceway !== 'FREE_AIR');
    const racewayLabel = rw
      ? `${rw.racewayType ?? 'raceway'}${rw.selectedRacewaySize ? ` ${rw.selectedRacewaySize}` : ''}`
      : (inRaceway ? `${seg!.raceway}${seg!.tradeSizeIn ? ` ${seg!.tradeSizeIn}` : ''}` : null);
    const isOpenAirBranch = g.purpose === 'branch-egc';

    // The open-air branch object is the ONE domain the grounding authority
    // governs. Its size / method / length / BOM state come from the authority —
    // NOT from the raw record (whose conductorSize is an NEC-derived CANDIDATE).
    if (isOpenAirBranch && oa.present) {
      const pending = oa.outcome === 'PENDING_MANUFACTURER_AUTHORITY';
      const noRow = oa.outcome === 'NO_SEPARATE_EGC_REQUIRED';
      out.push({
        // ECD §6 — the GROUP-AUTHORITY identity (never a physical segment id).
        groundingSegmentId: BRANCH_EGC_AUTHORITY_GROUP_ID,
        // null: this node projects THREE canonical records, not one. The members
        // are enumerated in memberGroundingIds.
        groundingId: null,
        identityKind: 'group-authority',
        groundingAuthorityGroupId: BRANCH_EGC_AUTHORITY_GROUP_ID,
        branchScope: _branchEgcScope,
        memberGroundingIds: _branchEgcIds,
        purpose: 'branch-egc',
        label: `${_PURPOSE_LABEL['branch-egc']} — GROUP AUTHORITY`,
        fromDeviceId: branches.length ? `${branches.map(b => b.label).join('/')} MICROINVERTERS` : 'ARRAY MICROINVERTERS',
        toDeviceId: 'ROOF J-BOX (branch transition)',
        associatedSegmentId: g.segmentId,
        associatedCircuitIds: oa.branchIds.length ? oa.branchIds : branches.map(b => b.branchId),
        // PENDING ⇒ NO size is asserted; (A) ⇒ no conductor exists; (B) ⇒ the
        // authority's NEC-derived size.
        conductorSize: pending || noRow ? null : oa.conductorSize,
        // P13 WS-1 — a GROUP-AUTHORITY node is a manufacturer-authority result,
        // not a 250.122 table computation, so it carries no minimum/selection
        // split. The physical member segments each carry their own.
        calculatedMinimumSize: null, selectedDesignSize: null,
        selectionSource: null, selectionReason: null, segmentRole: null,
        conductorMaterial: pending || noRow ? null : (oa.conductorMaterial === 'Al' ? 'Al' : 'Cu'),
        insulationType: pending
          ? null
          : noRow
            ? 'integral to the listed cable assembly (no additional conductor)'
            : 'green insulated Cu, open-air along the branch trunk',
        method: pending ? 'pending' : noRow ? 'integrated-listed' : 'conductor',
        // FREE AIR — never the home-run/feeder conduit (the §7 defect).
        physicalRacewayId: null,
        racewayLabel: 'FREE AIR — NEC 690.31(C)',
        lengthFt: pending || noRow ? null : oa.designedInstalledFt,
        lengthSource: pending || noRow
          ? 'not-established'
          : (oa.lengthProvenance === 'geometry-derived' ? 'cable-path-geometry' : 'route-one-way'),
        necBasis: oa.codeBasis,
        authorityState: pending ? 'pending-manufacturer-authority' : 'verified',
        installedConductorAsserted: oa.outcome === 'SEPARATE_EGC_REQUIRED',
        // ECD W1-A — the REAL, stable BOM row id (was the row's part number).
        // The id is CONTENT-derived, so this pre-BOM projection computes exactly
        // the value bomForPermit's stamping pass will assign to that row: the
        // open-air branch EGC is emitted at stage 'ac', category 'wire', unit
        // 'ft', unstamped sub-system, with this part number.
        bomLineId: noRow ? null : bomLineIdFor({
          stageId: 'ac', category: 'wire', unit: 'ft',
          partNumber: `GRN-OPENAIR-${(oa.conductorSize ?? '#12 AWG').replace('#', '').replace(' AWG', '').trim()}`,
        }),
        bomLinePartNumber: noRow
          ? null
          : `GRN-OPENAIR-${(oa.conductorSize ?? '#12 AWG').replace('#', '').replace(' AWG', '').trim()}`,
        bomRowState: oa.bomRowState,
        provenance: `electrical.openAirGroundingAuthority + groundingObjects[${_branchEgcIds.join(', ')}]`
          + `${asm.present ? ` + ${asm.assembly!.assemblyId}` : ''}`,
      });
      continue;
    }

    // Every other domain: NEC wiring-method / electrode authority on its OWN
    // basis, with its OWN raceway + its OWN length provenance.
    const noneRequired = g.method === 'none-required' || g.required === false;
    out.push({
      groundingSegmentId: g.groundingId,
      groundingId: g.groundingId,
      // ECD §6 — a real installed path: its own physical identity, its own
      // authority (no group governs it).
      identityKind: 'physical-segment',
      groundingAuthorityGroupId: null,
      branchScope: [],
      memberGroundingIds: [],
      purpose: g.purpose,
      label: _PURPOSE_LABEL[g.purpose] ?? g.purpose,
      // P13 WS-1 — the record's OWN endpoints win. A bonding conductor that runs
      // from the bonded racking system to the rooftop junction box must not be
      // labelled with the route segment's endpoints ("PV ARRAY→MICROINVERTERS"),
      // which describe a different circuit that merely shares the route.
      fromDeviceId: g.sourceNode ?? seg?.from ?? (g.associatedEquipment ?? '—'),
      toDeviceId: g.destinationNode ?? seg?.to ?? (g.associatedEquipment ?? '—'),
      associatedSegmentId: g.segmentId,
      associatedCircuitIds: seg ? [seg.segmentId] : [],
      conductorSize: g.method === 'conductor' ? g.conductorSize : null,
      // P13 WS-1 — the code MINIMUM and the DESIGN SELECTION travel to the sheet
      // as separate facts. A renderer that prints one number can therefore never
      // attribute a design choice to NEC 250.122.
      calculatedMinimumSize: g.method === 'conductor' ? g.calculatedMinimumSize : null,
      selectedDesignSize: g.method === 'conductor' ? g.selectedDesignSize : null,
      selectionSource: g.selectionSource,
      selectionReason: g.selectionReason,
      segmentRole: g.segmentRole,
      conductorMaterial: g.conductorMaterial,
      insulationType: g.method === 'conductor'
        // P13 WS-1 — the record states bare vs insulated; an array bonding
        // conductor is bare and must not inherit the raceway conductor's THWN-2.
        ? (g.insulationState === 'bare' ? `bare ${g.conductorMaterial ?? 'Cu'}`
          : g.purpose === 'gec' ? 'bare Cu' : (seg?.insulation ?? 'THWN-2 green'))
        : (g.method === 'raceway' ? 'raceway as the equipment grounding conductor (NEC 250.118)' : null),
      method: g.method,
      physicalRacewayId: inRaceway ? (seg?.physicalRacewayId ?? null) : null,
      racewayLabel: inRaceway ? racewayLabel : (seg ? 'FREE AIR' : null),
      lengthFt: noneRequired ? null : num(seg?.oneWayFt),
      lengthSource: noneRequired
        ? 'not-established'
        : seg?.lengthSource === 'field-measurement'
          ? 'field-measurement'
          : seg?.oneWayFt != null ? 'route-one-way' : 'not-established',
      necBasis: g.codeBasis,
      authorityState: noneRequired ? 'not-required' : 'nec-derived',
      installedConductorAsserted: g.method === 'conductor' && !noneRequired,
      bomLineId: null,
      bomRowState: noneRequired ? 'no-row' : 'orderable',
      provenance: `groundingObjects['${g.groundingId}']`
        + `${seg ? ` + routeSegments['${seg.segmentId}']` : ''}`
        + `${rw ? ` + physicalRaceways['${rw.physicalRacewayId}']` : ''}`,
    });
  }
  return out;
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
  /** §1 — the home-run PHASE conductor gauge (from BRANCH_HOMERUN_RUN — the #10
   *  the SVG/E-1 must print, NEVER the legacy #12-from-OCPD branch gauge). */
  conductorGauge: string | null;
  egcGauge: string | null;
  fillPct: number | null;
  minimumCodeRacewaySize: string | null;
  selectedRacewaySize: string | null;
  upsizingReason: string | null;
  oneWayFt: number | null;
  /** TAC WS-8 � the home-run segment's VOLTAGE DROP. The PV-4B row's V-Drop %
   *  cell had no voltage-drop field to read and printed `fillPct` instead (a
   *  conduit-fill percentage under a voltage-drop heading). Distinct field, so
   *  the two percentages can never be interchanged again. */
  voltageDropPct: number | null;
  /** display: 'PVC Sch 80 1-1/4" — 3 branches shared'. */
  conduitLabel: string | null;
}

export function projectSharedBranchRaceway(snap: PermitDesignSnapshot | null | undefined): SharedBranchRacewayProjection {
  const empty: SharedBranchRacewayProjection = {
    present: false, physicalRacewayId: null, racewayType: null, tradeSizeIn: null, necArticle: null,
    sharedCircuitCount: null, conductorCount: null, currentCarryingCount: null,
    conductorGauge: null, egcGauge: null, fillPct: null,
    minimumCodeRacewaySize: null, selectedRacewaySize: null, upsizingReason: null, oneWayFt: null,
    voltageDropPct: null, conduitLabel: null,
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
    conductorGauge: seg?.conductorGauge ?? null,
    egcGauge: seg?.egcGauge ?? null,
    fillPct: num(rw?.fillPct) ?? num(seg?.fillPct),
    minimumCodeRacewaySize: rw?.minimumCodeRacewaySize ?? seg?.minimumCodeRacewaySize ?? null,
    selectedRacewaySize: rw?.selectedRacewaySize ?? tradeSizeIn,
    upsizingReason: rw?.upsizingReason ?? seg?.upsizingReason ?? null,
    oneWayFt: num(seg?.oneWayFt),
    voltageDropPct: num(seg?.voltageDropPct),
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

// ═══════════════════════════════════════════════════════════════════════════
// §1 (closeout 2026-07-23) — THE E-1 SECTIONED PHYSICAL SCHEDULE. E-1 renders
// the CANONICAL section objects DIRECTLY: the open-air Q-Cable branch trunks
// (per branch), the shared jbox→combiner home-run raceway (with its FULL current-
// carrying-conductor inventory from the physicalRaceway object — 6 CCC for a
// 3-branch design, NOT the fictitious #12 THWN the legacy microBranchRow OCPD-
// sized), the combiner feeder, the disconnect→tap run, and the tap conductors.
// Every §1 field is projected from the canonical snapshot — NEVER re-derived, and
// the sections are NEVER merged into one generalized row. The compliance state of
// each section is the ONE shared tri-state result (fail-closed on pending length /
// blank fill / unmeasured tap length — no PASS on a hole, gate 3).
//
// Note: the branch trunks are the LISTED Enphase Q Cable assembly (TC-ER), not
// THWN — a round-2 agent builds the full ListedCableAssembly object; this
// projection renders the canonical branch/segment data as-is (labeled 'ENPHASE Q
// CABLE (TC-ER)'), inventing no THWN translations.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// §4 (BAR closeout 2026-07-25) — THE canonical AmpacityAdjustmentResult. E-1's
// old bare "derate 0.96" hid the fact that the shared 6-CCC home-run raceway
// carries TWO independent adjustments (the 0.80 conductor-count factor AND the
// 0.96 ambient factor) plus a 75 °C terminal cap. This object itemizes EVERY
// factor from computed-system's own NEC tables (ampacityTable90C/75C,
// conductorCountAdjustmentFactor, ambientCorrectionFactor) — never a lone
// multiplied scalar. E-1 / PV-4A / PV-4B / evidence render THIS. Any missing
// input ⇒ state 'PENDING', never a synthesized PASS (gate 5).
// ═══════════════════════════════════════════════════════════════════════════
export interface AmpacityAdjustmentResult {
  present: boolean;
  conductorMaterial: string | null;      // 'Cu'
  insulation: string | null;             // 'THWN-2'
  insulationRatingC: number;             // 90 (conductor insulation temp rating)
  conductorSize: string | null;          // '#10 AWG'
  /** NEC 310.16 90 °C base ampacity (adjustment/correction base). */
  baseTableAmpacityA: number | null;
  baseTableTempC: number;                // 90
  /** NEC 110.14(C) terminal temperature limitation. */
  terminalTempLimitC: number;            // 75
  /** NEC 310.16 75 °C ampacity — the terminal-temperature ceiling. */
  terminalTableAmpacityA: number | null;
  /** current-carrying conductor count in the raceway (free air ⇒ ≤3 ⇒ no adjustment). */
  currentCarryingCount: number | null;
  /** NEC 310.15(C)(1) conductor-count adjustment factor (6 CCC → 0.80). */
  countAdjustmentFactor: number | null;
  countAdjustmentBasis: string | null;
  ambientTempC: number | null;
  rooftopAdderC: number | null;
  effectiveAmbientTempC: number | null;
  /** NEC 310.15(B)(1) ambient correction factor (30–35 °C → 0.96). */
  ambientCorrectionFactor: number | null;
  ambientCorrectionBasis: string | null;
  /** base90 × countAdj × ambientCorr (before the terminal cap). */
  correctedAmpacityA: number | null;
  /** min(corrected, 75 °C terminal) — the code ampacity of record. */
  finalAllowableAmpacityA: number | null;
  finalAllowableBasis: string | null;
  /** the continuous load the conductor must carry (per raceway / per conductor). */
  requiredContinuousA: number | null;
  requiredContinuousBasis: string | null;
  ocpdA: number | null;
  /** ampacity-specific tri-state (independent of the section's route-length state). */
  state: 'PASS' | 'FAIL' | 'PENDING';
  necReferences: string[];
  provenance: string;
}

/** The empty PENDING AmpacityAdjustmentResult (gate 5 — a hole is never PASS). */
function _pendingAmpacity(reason: string): AmpacityAdjustmentResult {
  return {
    present: false, conductorMaterial: null, insulation: null, insulationRatingC: 90,
    conductorSize: null, baseTableAmpacityA: null, baseTableTempC: 90, terminalTempLimitC: 75,
    terminalTableAmpacityA: null, currentCarryingCount: null, countAdjustmentFactor: null,
    countAdjustmentBasis: null, ambientTempC: null, rooftopAdderC: null, effectiveAmbientTempC: null,
    ambientCorrectionFactor: null, ambientCorrectionBasis: null, correctedAmpacityA: null,
    finalAllowableAmpacityA: null, finalAllowableBasis: null, requiredContinuousA: null,
    requiredContinuousBasis: null, ocpdA: null, state: 'PENDING',
    necReferences: ['NEC 310.16', 'NEC 310.15(B)(1)', 'NEC 310.15(C)(1)', 'NEC 110.14(C)'],
    provenance: reason,
  };
}

export interface AmpacityInput {
  conductorGauge: string | null;
  insulation: string | null;
  conductorMaterial?: string | null;
  /** current-carrying conductor count in the raceway (undefined/≤3 ⇒ no count adjustment). */
  currentCarryingCount: number | null;
  /** true ⇒ free-air installation (NEC 690.31(C)) — 310.15(C)(1) fill adjustment N/A. */
  freeAir: boolean;
  ambientTempC: number | null;
  rooftopAdderC?: number | null;
  /** TAC WS-2 — where the design ambient came from (ASHRAE 2% high / AHJ
   *  override). Printed in the chain so the derate is attributable. */
  ambientSource?: string | null;
  /** the canonical ambient factor the sizer already resolved (segment.tempDeratingFactor);
   *  used verbatim so the itemized chain equals the sizer's number, never a re-derivation.
   *  TAC WS-2: it is used ONLY when `ambientTempC` is recorded — a factor with
   *  no stated temperature cannot establish an ampacity result. */
  tempDeratingFactor?: number | null;
  /** the continuous load this conductor set must carry. */
  requiredContinuousA: number | null;
  requiredContinuousBasis: string;
  ocpdA?: number | null;
}

/** Assemble the canonical AmpacityAdjustmentResult from computed-system's own NEC
 *  table accessors. Every factor is itemized; any missing input ⇒ PENDING. Pure. */
export function projectAmpacityAdjustment(inp: AmpacityInput): AmpacityAdjustmentResult {
  const gauge = inp.conductorGauge;
  if (!gauge) return _pendingAmpacity('conductor gauge not resolved');
  const base90 = ampacityTable90C(gauge);
  const term75 = ampacityTable75C(gauge);
  if (base90 == null || term75 == null) return _pendingAmpacity(`ampacity table has no entry for ${gauge}`);

  const ccc = inp.currentCarryingCount;
  const countAdj = inp.freeAir
    ? 1.0
    : (ccc != null ? conductorCountAdjustmentFactor(ccc) : null);
  const countAdjBasis = inp.freeAir
    ? 'free air — NEC 310.15(C)(1) conduit-fill adjustment N/A (NEC 690.31(C))'
    : (ccc != null ? `${ccc} CCC → ${countAdj?.toFixed(2)} (NEC 310.15(C)(1))` : null);

  const rooftopAdder = inp.rooftopAdderC ?? 0;
  // TAC WS-2 — the EFFECTIVE ambient is ambient + any applicable rooftop adder
  // (it was previously just the ambient, so an adder could never reach the
  // table lookup).
  const effAmbient = inp.ambientTempC != null ? inp.ambientTempC + rooftopAdder : null;
  // TAC WS-2 — FAIL CLOSED ON A SOURCELESS CORRECTION FACTOR. The sizer's
  // already-resolved factor is preferred so the itemized chain equals the number
  // the wire-sizer used — but ONLY when the temperature it was derived from is
  // recorded. A factor with `ambientTempC: null` is an unverifiable derate
  // (the package printed "× 0.96 (NEC 310.15(B)(1))" beside three null inputs
  // on a feeder with a 1.25 A margin); it now yields a PENDING chain instead of
  // a PASS, exactly like any other missing authority input.
  const ambientCF = effAmbient != null
    ? (inp.tempDeratingFactor ?? ambientCorrectionFactor(effAmbient))
    : null;
  // NOTE: the basis strings deliberately avoid the "@ NN °C" form — that shape is
  // reserved for DESIGN-LOW temperature annotations (NEC 690.7) elsewhere in the
  // package, and a conductor RATING/ambient printed that way reads as a second
  // design temperature (the W5 §4 singular-thermal-basis gate).
  // A basis string without a temperature is no longer reachable (ambientCF is
  // null whenever the temperature is), so the chain always states what it
  // derated FROM — including the source of the design ambient.
  const ambientBasis = ambientCF == null
    ? (inp.tempDeratingFactor != null
        ? 'AMBIENT NOT ESTABLISHED — a correction factor cannot be applied without a recorded design ambient temperature (NEC 310.15(B)(1))'
        : null)
    : `NEC 310.15(B)(1) at ${effAmbient} °C ambient`
      + `${rooftopAdder ? ` (${inp.ambientTempC} °C design + ${rooftopAdder} °C rooftop adder)` : ''}`
      + `${inp.ambientSource ? ` · source: ${inp.ambientSource}` : ''} → ${ambientCF.toFixed(2)}`;

  const corrected = (countAdj != null && ambientCF != null)
    ? Math.round(base90 * countAdj * ambientCF * 100) / 100
    : null;
  const finalAllowable = corrected != null ? Math.min(corrected, term75) : null;
  const finalBasis = corrected != null
    ? `min(corrected ${corrected.toFixed(2)} A [90 °C base], ${term75} A [75 °C terminal, NEC 110.14(C)]) = ${finalAllowable?.toFixed(2)} A`
    : null;

  const req = inp.requiredContinuousA;
  let state: AmpacityAdjustmentResult['state'];
  if (countAdj == null || ambientCF == null || finalAllowable == null || req == null) {
    state = 'PENDING';
  } else {
    state = finalAllowable >= req ? 'PASS' : 'FAIL';
  }

  return {
    present: true,
    conductorMaterial: inp.conductorMaterial ?? 'Cu',
    insulation: inp.insulation ?? 'THWN-2',
    insulationRatingC: 90,
    conductorSize: gauge,
    baseTableAmpacityA: base90,
    baseTableTempC: 90,
    terminalTempLimitC: 75,
    terminalTableAmpacityA: term75,
    currentCarryingCount: inp.freeAir ? (ccc ?? null) : ccc,
    countAdjustmentFactor: countAdj,
    countAdjustmentBasis: countAdjBasis,
    ambientTempC: inp.ambientTempC,
    rooftopAdderC: rooftopAdder || null,
    effectiveAmbientTempC: effAmbient,
    ambientCorrectionFactor: ambientCF,
    ambientCorrectionBasis: ambientBasis,
    correctedAmpacityA: corrected,
    finalAllowableAmpacityA: finalAllowable,
    finalAllowableBasis: finalBasis,
    requiredContinuousA: req,
    requiredContinuousBasis: inp.requiredContinuousBasis,
    ocpdA: inp.ocpdA ?? null,
    state,
    necReferences: ['NEC 310.16', 'NEC 310.15(B)(1)', 'NEC 310.15(C)(1)', 'NEC 110.14(C)', 'NEC 690.8(B)'],
    provenance: inp.freeAir
      ? 'computed-system NEC tables (free-air branch, 690.31(C))'
      : 'computed-system NEC tables (shared raceway CCC adjustment)',
  };
}

/** §4 — a compact multi-line human string of the full ampacity chain for a table
 *  cell. Replaces the bare "derate 0.96". PENDING ⇒ an explicit PENDING line. */
export function ampacityChainLines(a: AmpacityAdjustmentResult | null): string[] {
  if (!a || !a.present) return ['ampacity PENDING'];
  const f = (n: number | null, d = 2) => n == null ? '—' : n.toFixed(d);
  const lines: string[] = [];
  // "NN °C col." / "amb NN °C" — never the "@ NN °C" design-low-temp shape.
  lines.push(`base ${f(a.baseTableAmpacityA, 0)}A (${a.baseTableTempC}°C col.)`);
  if (a.countAdjustmentFactor != null) lines.push(`×${f(a.countAdjustmentFactor)} (${a.currentCarryingCount ?? '≤3'} CCC)`);
  if (a.ambientCorrectionFactor != null) lines.push(`×${f(a.ambientCorrectionFactor)} amb${a.effectiveAmbientTempC != null ? ` ${a.effectiveAmbientTempC}°C` : ''}`);
  if (a.finalAllowableAmpacityA != null) lines.push(`= ${f(a.finalAllowableAmpacityA)}A allow (75°C cap ${f(a.terminalTableAmpacityA, 0)}A)`);
  if (a.requiredContinuousA != null) lines.push(`req ${f(a.requiredContinuousA)}A cont · ${a.state}`);
  return lines;
}

export interface E1PhysicalSection {
  /** the CANONICAL section id (segmentId or serviceTopology objectId) — gate 1. */
  sectionId: string;
  sectionLabel: string;
  fromDevice: string;
  toDevice: string;
  /** cable/conductor type ('ENPHASE Q CABLE (TC-ER)' | 'THWN-2' | conductorSpec). */
  cableType: string;
  /** current-carrying conductor count — for the shared run this EQUALS the
   *  physicalRaceway inventory exactly (gate 2). */
  conductorCount: number | null;
  /** total conductors incl. EGC where the raceway object carries it. */
  totalConductorCount: number | null;
  conductorSize: string | null;
  /** grounding / bonding method + EGC size. PPC §1 — for the OPEN-AIR branch
   *  sections this is DERIVED FROM projectOpenAirBranchGrounding() (the canonical
   *  document-based authority), NEVER from groundingObjects[].conductorSize. */
  bonding: string | null;
  /** PPC §7/gate 10 — the canonical GroundingSegment this row's bonding cell
   *  reconciles to. null ⇒ the section models no grounding object (never a row
   *  that prints a conductor without an id). */
  groundingSegmentId: string | null;
  /** ECD §6 — the GROUP-AUTHORITY node this section's grounding cell reconciles to,
   *  when its physical segment is governed by one (the three open-air branch EGCs
   *  share ONE authority result). null ⇒ the physical segment is its own authority.
   *  The defect this retires: `groundingSegmentId` was computed ONCE from
   *  `branchGnd[0].groundingId` and stamped on EVERY branch row, so B1/B2/B3 all
   *  printed `gnd-br-1`. The physical id is now per-branch and the shared authority
   *  is named separately, so one id never has to mean both things. */
  groundingAuthorityGroupId: string | null;
  /** PPC §1 — true ⇒ the grounding authority for this section is PENDING, so the
   *  cell asserts NO installed EGC. Machine-checkable by the rendered gate. */
  bondingPendingAuthority: boolean;
  physicalRacewayId: string | null;
  racewayType: string | null;
  racewaySize: string | null;
  operatingCurrentA: number | null;
  continuousCurrentA: number | null;
  ocpdA: number | null;
  lengthFt: number | null;
  /** §Q (2026-07-24 Q-Cable reconciliation) — WHAT QUANTITY lengthFt is, so the
   *  one shared "Length" column never mixes a geometric cable-path with a route
   *  one-way estimate under one unlabeled number. 'cable-path-geometry' = the
   *  BranchCablePath designed-installed path (Σ inter-module + lead-in); 'route-
   *  one-way' = the segment's oneWayFt route estimate; 'tap-measured-estimate' =
   *  a supply-side tap run (measured or pending). */
  lengthKind: 'cable-path-geometry' | 'route-one-way' | 'tap-measured-estimate' | null;
  /** short human label printed next to the figure ('cable path (geometry)'). */
  lengthLabel: string | null;
  /** the SOURCE object the figure traces to ('QCABLE-ASSEMBLY:B1' | segmentId | tap objectId). */
  lengthObjectId: string | null;
  lengthSource: string | null;
  verificationStatus: string | null;
  /** null ⇒ fill not applicable (open-air) OR not computed (pending). */
  fillPct: number | null;
  fillApplicable: boolean;
  deratingFactor: number | null;
  deratingBasis: string | null;
  voltageDropPct: number | null;
  vdLimitPct: number;
  /** D5 (Planset 19) — the length the VOLTAGE-DROP arithmetic actually consumed.
   *  Distinct from `lengthFt`, which is the section's printed physical quantity
   *  (a Q-Cable branch prints its cable-path geometry). PV-4B grades the feeder
   *  from `calculationLengthFt`; PV-4B.1 must grade from the same field or the
   *  two sheets can print the same percentage against different lengths. */
  vdCalculationLengthFt: number | null;
  /** §4 — the FULL itemized ampacity chain for this section (replaces the bare
   *  0.96). Every in-conduit and free-air section carries one; PENDING on a hole. */
  ampacity: AmpacityAdjustmentResult | null;
  // ── D5 (Planset 19) — TWO INDEPENDENT VERDICTS, NEVER ONE BADGE ───────────
  // `voltageDrop` is the CANONICAL calculation grade — the identical
  // `gradeVoltageDrop` object PV-4B consumes, so the two sheets cannot word the
  // same result differently. `compliance` is the RELEASE / review state, which
  // additionally covers conductor-size holes, conduit fill and the NEC 705.11(C)
  // tap rule. PV-4B.1 previously printed ONLY `compliance` in the verdict
  // position, so an open route-length requirement silently overwrote the
  // voltage-drop conclusion: 20 ft / 0.37% / ≤3% read `PENDING — REVIEW REQ’D`
  // on PV-4B.1 and `PROVISIONAL PASS` on PV-4B — the same circuit, same numbers.
  voltageDrop: VoltageDropGrade;
  compliance: ComplianceResult;
}

const _VERIFIED_ROUTE = new Set(['field-measured', 'field-verified', 'as-built-verified']);

function _seg(snap: PermitDesignSnapshot, id: string): RouteSegmentRecord | null {
  return (snap.electrical?.routeSegments ?? []).find(r => r.segmentId === id) ?? null;
}

/** D5 — the length the voltage-drop arithmetic consumed, read the SAME way PV-4B
 *  reads it (`calculationLengthFt` first, the one-way route as the fallback). One
 *  accessor, so the calc basis behind a percentage cannot differ by sheet. */
function _vdLenOf(seg: RouteSegmentRecord | null | undefined): number | null {
  return num(seg?.calculationLengthFt) ?? num(seg?.oneWayFt);
}

/** D5 — grade a section's voltage drop through the ONE canonical resolver, with
 *  the segment's own length authority. Renderers never re-decide a conclusion and
 *  PV-4B.1 never gets a resolver of its own. */
function _gradeSeg(
  seg: RouteSegmentRecord | null | undefined,
  pct: number | null,
  limitPct: number,
): VoltageDropGrade {
  return gradeVoltageDrop({
    pct,
    limitPct,
    lengthFt: _vdLenOf(seg),
    lengthSource: seg?.lengthSource ?? null,
    verificationState: seg?.verificationState ?? seg?.verificationStatus ?? null,
  });
}

/** THE E-1 sectioned physical schedule (micro AC path). Returns [] for non-micro
 *  topologies (E-1 keeps its per-sub source zone there). Pure. */
export function projectE1PhysicalSchedule(snap: PermitDesignSnapshot | null | undefined): E1PhysicalSection[] {
  const elec = snap?.electrical;
  if (!elec || elec.topology !== 'MICRO') return [];
  const sections: E1PhysicalSection[] = [];

  const branchSeg = _seg(snap!, 'BRANCH_RUN');
  const micro = snap!.equipment?.microInverters?.[0];
  const isEnphase = /enphase/i.test((micro?.manufacturer ?? '').trim());
  // §6 — the branch trunk cable TYPE is the LISTED ASSEMBLY (manufacturer + SKU),
  // never a generic THWN gauge; §7 — its length is the per-branch geometric path.
  const _asmProj = projectListedCableAssembly(snap);
  const qCableLabel = _asmProj.present
    ? `${_asmProj.assembly!.wiringMethodLabel}${_asmProj.assembly!.sku ? ` · ${_asmProj.assembly!.sku}` : ''}`
    : (isEnphase ? 'ENPHASE Q CABLE (TC-ER)' : 'LISTED AC TRUNK CABLE (TC-ER)');
  const _pathByBranch = new Map(_asmProj.branchPaths.map(p => [p.branchId, p]));
  const branches = elec.branches ?? [];
  const branchGnd = (elec.groundingObjects ?? []).filter(g => g.purpose === 'branch-egc');
  // ── PPC §1 ROOT FIX ────────────────────────────────────────────────────────
  // The open-air branch bonding cell PROJECTS the canonical, document-based
  // grounding authority. It previously read groundingObjects[].conductorSize and
  // printed `#12 AWG Cu EGC (NEC 250.122 @ 20A) — with circuit conductors` — an
  // INSTALLED-conductor assertion, on the same sheet whose prose said PENDING
  // MANUFACTURER AUTHORITY. The raw canonical object carries the NEC-DERIVED
  // CANDIDATE size, which is not an installation. Only the authority decides
  // whether anything is installed, so the authority is now the ONLY input here.
  const _oaGnd = projectOpenAirBranchGrounding(snap);
  // ── ECD §6 ROOT FIX ────────────────────────────────────────────────────────
  // Each branch section carries ITS OWN physical grounding segment identity. This
  // was previously ONE id computed from `branchGnd[0]` and stamped on every branch
  // row inside branches.forEach — so the package rendered `gnd-br-1` three times
  // and never rendered gnd-br-2 / gnd-br-3 at all (artifact: gnd-br-1 ×8,
  // gnd-br-2/3 ×0), collapsing three canonical objects into one rendered identity
  // and making the uniqueness gate vacuous. The ONE shared authority result is
  // named separately by `groundingAuthorityGroupId`, so a physical id never has to
  // double as an authority id.
  const _branchGndById = new Map(branchGnd.map(g => [g.groundingId, g]));
  const _oaSegmentIdFor = (branchId: string): string | null => {
    if (!_oaGnd.present) return null;
    const id = `gnd-${branchId}`;
    // Fail-closed on identity: only an id that resolves to a canonical
    // GroundingRecord may be rendered. No synthesized per-branch id.
    if (_branchGndById.has(id)) return id;
    return branchGnd.length ? null : 'GRN-OPENAIR-BRANCH';
  };
  const _oaGroupId = _oaGnd.present && branchGnd.length
    ? BRANCH_EGC_AUTHORITY_GROUP_ID
    : null;
  const _branchBondingCell = (b: { ocpdA: number }): string | null => {
    if (!_oaGnd.present) return null;
    switch (_oaGnd.outcome) {
      // (C) fail-closed: state the pending method and explicitly DENY the
      // installed-EGC assertion. No size, no 250.122 conclusion, no PASS.
      case 'PENDING_MANUFACTURER_AUTHORITY':
        return GROUNDING_PENDING_BONDING_CELL_LABEL;
      // (A) the listed method installs no additional conductor in this section.
      case 'NO_SEPARATE_EGC_REQUIRED':
        return 'OPEN-AIR GROUNDING METHOD: LISTED INTEGRATED METHOD (NEC 690.43(C) / 110.3(B)) '
          + '— NO ADDITIONAL OPEN-AIR EGC INSTALLED IN THIS SECTION';
      // (B) an additional conductor IS installed — the honest assertion, with the
      // size that the authority (not the raw object) established.
      case 'SEPARATE_EGC_REQUIRED':
        return `OPEN-AIR GROUNDING METHOD: ADDITIONAL EGC INSTALLED — `
          + `${_oaGnd.conductorSize ?? 'NEC 250.122 size'} ${_oaGnd.conductorMaterial ?? 'Cu'} `
          + `(NEC 250.122 @ ${b.ocpdA}A), run open-air along the branch trunk`;
    }
  };

  // ── Q-Cable branch trunks (one canonical section per branch) ───────────────
  branches.forEach((b, i) => {
    const _bPath = _pathByBranch.get(b.branchId) ?? null;
    void i;
    const verified = branchSeg ? _VERIFIED_ROUTE.has(String(branchSeg.verificationStatus)) : false;
    const pending: string[] = [];
    if (branchSeg && !verified) pending.push('branch route length is a CAD-derived estimate (not field-verified)');
    // ══ THE DROP IS DERIVED FROM THIS BRANCH (2026-08-29) ═══════════════════
    // `branchSeg` is ONE shared BRANCH_RUN segment read inside a per-branch loop,
    // so all three rows printed the SAME voltage drop - 0.08% on the audited
    // package - beside three different lengths (64 / 63.2 / 39.3 ft) and three
    // different currents (16.0 / 14.5 / 14.5 A) taken from the per-branch model.
    // One row assembled from two incompatible sources, and each still carried its
    // own "PROVISIONAL PASS - 0.08% <= 2.0%", so the margin claimed on the sheet
    // was not the margin the branch has.
    //
    // The shared segment's own percentage was computed from a length that appears
    // nowhere on the sheet: build.ts moves the LENGTH onto that segment from the
    // cable paths and never recomputes the percentage - the exact failure the
    // field-measurement block one screen away was written to prevent ("THE
    // PERCENTAGE IS RECOMPUTED, NOT RETAINED").
    //
    // A branch's drop is a function of ITS length and ITS current, so it is
    // computed here from the two per-branch facts this row already prints, through
    // the same recalculator the field-measurement path uses. It falls back to the
    // shared segment only when this branch has no geometry of its own.
    const _bLengthFt = _bPath?.designedInstalledLengthFt ?? num(branchSeg?.oneWayFt);
    const _bVd = recalculateRouteVoltageDrop({
      lengthFt: _bLengthFt,
      continuousCurrentA: num(b.continuousA),
      operatingCurrentA: num(b.currentA),
      conductorGauge: _asmProj.assembly?.conductorGauge ?? branchSeg?.conductorGauge ?? null,
      systemVoltage: 240,   // micro AC branch, split-phase 240 V
    });
    const vd = _bVd.voltageDropPct ?? num(branchSeg?.voltageDropPct);
    const compliance = evaluateCompliance({
      requiredValues: [
        { label: 'branch conductor size', value: branchSeg?.conductorGauge },
        { label: 'branch OCPD', value: b.ocpdA, numeric: true },
        { label: 'branch operating current', value: b.currentA, numeric: true },
      ],
      checks: [
        { label: 'continuous ≤ OCPD (NEC 240.4)', pass: Number.isFinite(b.continuousA) && Number.isFinite(b.ocpdA) ? b.continuousA <= b.ocpdA : null },
        { label: 'branch VD ≤ 2%', pass: vd == null ? null : vd <= 2 },
      ],
      pending,
    });
    sections.push({
      sectionId: 'BRANCH_RUN',
      sectionLabel: `AC BRANCH ${b.label} — Q-CABLE TRUNK (OPEN AIR)`,
      fromDevice: `${b.label}: ${b.moduleCount} × MICROINVERTER`,
      toDevice: 'ROOF J-BOX',
      cableType: qCableLabel,
      // §6 — the assembly's own conductor count/gauge (Q Cable = 2×#12), never the
      // legacy segment gauge (the shared home-run's #10 belongs to a DIFFERENT run).
      conductorCount: _asmProj.assembly?.conductorCount ?? num(branchSeg?.conductorCount),
      totalConductorCount: (_asmProj.assembly?.conductorCount ?? branchSeg?.conductorCount) != null
        ? (_asmProj.assembly?.conductorCount ?? branchSeg!.conductorCount!) + 1 : null,
      conductorSize: _asmProj.assembly?.conductorGauge ?? branchSeg?.conductorGauge ?? null,
      // §1 — authority-projected (see _branchBondingCell above); never the raw
      // groundingObjects[].conductorSize installed-conductor string.
      bonding: _branchBondingCell(b),
      // ECD §6 — THIS branch's own physical grounding segment (gnd-br-1/2/3).
      groundingSegmentId: _oaSegmentIdFor(b.branchId),
      groundingAuthorityGroupId: _oaGroupId,
      bondingPendingAuthority: _oaGnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY',
      physicalRacewayId: null,
      racewayType: 'FREE AIR — NEC 690.31(C)',
      racewaySize: null,
      operatingCurrentA: num(b.currentA),
      continuousCurrentA: num(b.continuousA),
      ocpdA: num(b.ocpdA),
      // §7 — per-branch geometric designed-installed length (not the shared 68-ft
      // plane-width estimate); falls back to the segment length when no geometry.
      lengthFt: _bPath?.designedInstalledLengthFt ?? num(branchSeg?.oneWayFt),
      // §Q — NAME the quantity + its source object so the Length column never mixes
      // a geometric cable-path with a route estimate under one unlabeled number.
      lengthKind: _bPath?.designedInstalledLengthFt != null ? 'cable-path-geometry' : 'route-one-way',
      lengthLabel: _bPath?.designedInstalledLengthFt != null ? 'cable path (geometry)' : 'route (one-way est.)',
      lengthObjectId: _bPath?.designedInstalledLengthFt != null
        ? `${_asmProj.assembly?.assemblyId ?? 'QCABLE-ASSEMBLY'}:${b.branchId}`
        : 'BRANCH_RUN',
      lengthSource: branchSeg?.lengthSource ?? null,
      verificationStatus: branchSeg?.verificationStatus ?? branchSeg?.lengthSource ?? null,
      fillPct: null,
      fillApplicable: false,
      deratingFactor: num(branchSeg?.tempDeratingFactor),
      deratingBasis: 'free-air (no raceway fill adjustment)',
      voltageDropPct: vd,
      vdLimitPct: ROUTE_VD_LIMIT_PCT.branch,
      vdCalculationLengthFt: _vdLenOf(branchSeg),
      // D5 — the SAME canonical resolver PV-4B uses. Not a PV-4B.1 variant.
      voltageDrop: _gradeSeg(branchSeg, vd, 2),
      // §4 — free-air branch ampacity chain (Q-Cable conductor gauge, 690.31(C));
      // the CCC conduit-fill adjustment is N/A in free air.
      ampacity: projectAmpacityAdjustment({
        conductorGauge: _asmProj.assembly?.conductorGauge ?? branchSeg?.conductorGauge ?? null,
        insulation: branchSeg?.insulation ?? 'TC-ER (Q-Cable)',
        currentCarryingCount: num(branchSeg?.conductorCount) ?? 2,
        freeAir: true,
        ambientTempC: num(branchSeg?.ambientTempC),
        rooftopAdderC: num(branchSeg?.rooftopAdderC),
        ambientSource: branchSeg?.ambientSource ?? null,
        tempDeratingFactor: num(branchSeg?.tempDeratingFactor),
        requiredContinuousA: num(b.continuousA),
        requiredContinuousBasis: `branch continuous = ${num(b.currentA) ?? '—'}A op × 1.25 (NEC 690.8(A))`,
        ocpdA: num(b.ocpdA),
      }),
      compliance,
    });
  });

  // ── Shared branch home-run raceway (ALL branches bundled — the 6-CCC row) ───
  const hr = projectSharedBranchRaceway(snap);
  const hrSeg = _seg(snap!, 'BRANCH_HOMERUN_RUN');
  if (hr.present) {
    const verified = hrSeg ? _VERIFIED_ROUTE.has(String(hrSeg.verificationStatus)) : false;
    const pending: string[] = [];
    if (!verified) pending.push('home-run route length is a CAD-derived estimate (not field-verified)');
    const vd = num(hrSeg?.voltageDropPct);
    const opA = branches.reduce((s, b) => s + (Number.isFinite(b.currentA) ? b.currentA : 0), 0);
    const contA = branches.reduce((s, b) => s + (Number.isFinite(b.continuousA) ? b.continuousA : 0), 0);
    // §4 — each #10 home-run conductor carries ONE branch; the governing
    // per-conductor continuous is the MAX single-branch continuous (not the Σ).
    const maxBranchContA = branches.reduce((m, b) => Number.isFinite(b.continuousA) && b.continuousA > m ? b.continuousA : m, 0);
    const maxBranchOcpdA = branches.reduce((m, b) => Number.isFinite(b.ocpdA) && b.ocpdA > m ? b.ocpdA : m, 0);
    const compliance = evaluateCompliance({
      requiredValues: [
        { label: 'home-run conductor size', value: hr.conductorGauge },
        { label: 'shared raceway type', value: hr.racewayType },
        { label: 'current-carrying conductor count', value: hr.currentCarryingCount, numeric: true },
        { label: 'conduit fill %', value: hr.fillPct, numeric: true },
      ],
      checks: [
        { label: 'conduit fill ≤ 40%', pass: hr.fillPct == null ? null : hr.fillPct <= 40 },
        { label: 'home-run VD ≤ 2%', pass: vd == null ? null : vd <= 2 },
      ],
      pending,
    });
    sections.push({
      sectionId: 'BRANCH_HOMERUN_RUN',
      sectionLabel: `SHARED BRANCH HOME-RUN RACEWAY (${hr.sharedCircuitCount ?? '—'} BRANCHES BUNDLED)`,
      fromDevice: `ROOF J-BOX (${hr.sharedCircuitCount ?? '—'} branches)`,
      toDevice: 'AC COMBINER',
      cableType: hrSeg?.insulation ?? 'THWN-2',
      conductorCount: hr.currentCarryingCount,
      totalConductorCount: hr.conductorCount,
      conductorSize: hr.conductorGauge,
      // The in-raceway home-run EGC is a DISTINCT object with its OWN independent
      // basis (a raceway wiring method needs an EGC regardless of the open-air
      // outcome) — it never inherits, and never lends, the open-air state.
      bonding: hr.egcGauge ? `${hr.egcGauge} Cu EGC in raceway (NEC 250.122)` : null,
      groundingSegmentId: hr.egcGauge ? 'GRN-HOMERUN-RACEWAY-EGC' : null,
      // ECD §6 — its own authority; no group governs this raceway EGC.
      groundingAuthorityGroupId: null,
      bondingPendingAuthority: false,
      physicalRacewayId: hr.physicalRacewayId,
      racewayType: hr.racewayType,
      racewaySize: hr.selectedRacewaySize ?? hr.tradeSizeIn,
      operatingCurrentA: opA > 0 ? Math.round(opA * 100) / 100 : null,
      continuousCurrentA: contA > 0 ? Math.round(contA * 100) / 100 : null,
      ocpdA: null,   // branches individually protected upstream; the raceway carries no single OCPD
      lengthFt: hr.oneWayFt,
      lengthKind: 'route-one-way',
      lengthLabel: 'route (one-way)',
      lengthObjectId: 'BRANCH_HOMERUN_RUN',
      lengthSource: hrSeg?.lengthSource ?? null,
      verificationStatus: hrSeg?.verificationStatus ?? hrSeg?.lengthSource ?? null,
      fillPct: hr.fillPct,
      fillApplicable: true,
      deratingFactor: num(hrSeg?.tempDeratingFactor),
      deratingBasis: null,
      voltageDropPct: vd,
      vdLimitPct: ROUTE_VD_LIMIT_PCT.branch,
      vdCalculationLengthFt: _vdLenOf(hrSeg),
      voltageDrop: _gradeSeg(hrSeg, vd, 2),
      // §4 — THE shared 6-CCC ampacity chain (the row that used to print a lone
      // "0.96"): base 90 °C × 310.15(C)(1) count-adjustment (6 CCC → 0.80) ×
      // 310.15(B)(1) ambient, capped at the 75 °C terminal ampacity (110.14(C)).
      ampacity: projectAmpacityAdjustment({
        conductorGauge: hr.conductorGauge,
        insulation: hrSeg?.insulation ?? 'THWN-2',
        currentCarryingCount: hr.currentCarryingCount,
        freeAir: false,
        ambientTempC: num(hrSeg?.ambientTempC),
        rooftopAdderC: num(hrSeg?.rooftopAdderC),
        ambientSource: hrSeg?.ambientSource ?? null,
        tempDeratingFactor: num(hrSeg?.tempDeratingFactor),
        requiredContinuousA: maxBranchContA > 0 ? Math.round(maxBranchContA * 100) / 100 : null,
        requiredContinuousBasis: `each #10 carries one branch; governing = max branch continuous (${maxBranchOcpdA || 20}A-OCPD branch, ×1.25 basis)`,
        ocpdA: maxBranchOcpdA || null,
      }),
      compliance,
    });
  }

  // ── Combiner feeder + downstream service runs (COMBINER→DISCO, DISCO→TAP) ───
  const feed = projectCanonicalFeeder(snap);
  const raceways = elec.physicalRaceways ?? [];
  const runRow = (
    segId: string, label: string, applicableFillFromRw?: string,
    extra?: {
      label?: string;
      checks?: Array<{ label: string; pass: boolean | null }>;
      pending?: string[];
      requiredValues?: Array<{ label: string; value: unknown; numeric?: boolean }>;
    },
  ): void => {
    const seg = _seg(snap!, segId);
    if (!seg) return;
    const rw = applicableFillFromRw ? raceways.find(r => r.physicalRacewayId === applicableFillFromRw) : null;
    const fillPct = num(rw?.fillPct) ?? num(seg.fillPct);
    const fillApplicable = (seg.raceway ?? '') !== 'FREE_AIR' && seg.raceway != null;
    const verified = _VERIFIED_ROUTE.has(String(seg.verificationStatus));
    const vd = num(seg.voltageDropPct);
    const pending: string[] = [];
    if (!verified) pending.push('feeder route length is a CAD-derived estimate (not field-verified)');
    const compliance = evaluateCompliance({
      requiredValues: [
        { label: 'conductor size', value: seg.conductorGauge },
        { label: 'raceway type', value: seg.raceway },
        ...(fillApplicable ? [{ label: 'conduit fill %', value: fillPct, numeric: true }] : []),
        ...(extra?.requiredValues ?? []),
      ],
      checks: [
        { label: 'conduit fill ≤ 40%', pass: !fillApplicable ? true : (fillPct == null ? null : fillPct <= 40) },
        { label: 'feeder VD ≤ 3%', pass: vd == null ? null : vd <= 3 },
        ...(extra?.checks ?? []),
      ],
      pending: [...pending, ...(extra?.pending ?? [])],
    });
    sections.push({
      sectionId: segId,
      sectionLabel: extra?.label ?? label,
      fromDevice: seg.from,
      toDevice: seg.to,
      cableType: seg.insulation ?? 'THWN-2',
      conductorCount: num(seg.conductorCount),
      totalConductorCount: seg.conductorCount != null ? seg.conductorCount + 1 : null,
      conductorSize: seg.conductorGauge,
      bonding: seg.egcGauge ? `${seg.egcGauge} Cu EGC in raceway (NEC 250.122)` : null,
      groundingSegmentId: seg.egcGauge ? `GRN-${segId}-EGC` : null,
      groundingAuthorityGroupId: null,
      bondingPendingAuthority: false,
      physicalRacewayId: seg.physicalRacewayId ?? null,
      racewayType: seg.raceway === 'FREE_AIR' ? 'FREE AIR — NEC 690.31(C)' : seg.raceway,
      racewaySize: seg.tradeSizeIn === 'NONE' || seg.tradeSizeIn === 'N/A' ? null : seg.tradeSizeIn,
      operatingCurrentA: segId === 'COMBINER_TO_DISCO_RUN' ? feed.currentA : null,
      continuousCurrentA: segId === 'COMBINER_TO_DISCO_RUN' ? feed.continuousA : null,
      ocpdA: num(seg.ocpdA),
      lengthFt: num(seg.oneWayFt),
      lengthKind: 'route-one-way',
      lengthLabel: 'route (one-way)',
      lengthObjectId: segId,
      lengthSource: seg.lengthSource ?? null,
      verificationStatus: seg.verificationStatus ?? seg.lengthSource ?? null,
      fillPct,
      fillApplicable,
      deratingFactor: num(seg.tempDeratingFactor),
      deratingBasis: rw?.deratingBasis ?? null,
      voltageDropPct: vd,
      vdLimitPct: ROUTE_VD_LIMIT_PCT.feeder,
      vdCalculationLengthFt: _vdLenOf(seg),
      voltageDrop: _gradeSeg(seg, vd, 3),
      // §4 — feeder / downstream service run ampacity chain.
      ampacity: projectAmpacityAdjustment({
        conductorGauge: seg.conductorGauge,
        insulation: seg.insulation ?? 'THWN-2',
        currentCarryingCount: num(rw?.currentCarryingCount) ?? num(seg.conductorCount),
        freeAir: (seg.raceway ?? '') === 'FREE_AIR',
        ambientTempC: num(seg.ambientTempC),
        rooftopAdderC: num(seg.rooftopAdderC),
        tempDeratingFactor: num(seg.tempDeratingFactor),
        requiredContinuousA: segId === 'COMBINER_TO_DISCO_RUN' ? feed.continuousA : num(seg.continuousCurrentA),
        requiredContinuousBasis: segId === 'COMBINER_TO_DISCO_RUN'
          ? 'feeder continuous = PV output × 1.25 (NEC 690.8(A))'
          : 'segment continuous current',
        ocpdA: num(seg.ocpdA),
      }),
      compliance,
    });
  };
  runRow('COMBINER_TO_DISCO_RUN', 'COMBINER FEEDER → AC DISCONNECT', 'RW-COMBINER_TO_DISCO_RUN');

  // ── THE DISCONNECT↔TAP SPAN — ONE SECTION, NOT TWO ──────────────────────
  // E-1 used to print this physical run TWICE: once as the DISCO_TO_METER_RUN
  // route row (PVC Sch 80 1-1/4", EGC in raceway, route length) and again as a
  // free-standing "TAP CONDUCTORS" row (raceway "PER SERVICE ENTRANCE", bonding
  // "EGC with the service conductors", tap length). Same two devices, two
  // raceway treatments, two EGC treatments, two length authorities — the reader
  // had no way to tell they were one conduit.
  //
  // `svc-tap-conductors` is a COMPLIANCE VIEW of that route segment (it carries
  // `physicalRouteSegmentId`). So the 705.11(C) rule now rides ON the physical
  // section as one of its checks, and no second physical row is emitted. The
  // service-object table on PV-4B still lists the tap object in the chain — that
  // table is explicitly a topology view, not a conductor schedule.
  const tap = (elec.serviceTopology ?? []).find(o => o.type === 'tap-conductors');
  const tapRule = (tap?.constraints ?? []).find(c => c.code === 'NEC-705.11(C)-TAP-10FT');
  const tapIsViewOfRun = tap?.physicalRouteSegmentId === 'DISCO_TO_METER_RUN';
  runRow(
    'DISCO_TO_METER_RUN',
    'FUSED DISCONNECT → SERVICE / TAP',
    'RW-DISCO_TO_METER_RUN',
    tap && tapIsViewOfRun
      ? {
          label: 'FUSED DISCONNECT → SUPPLY-SIDE TAP POINT (tap conductors, NEC 705.11(C))',
          checks: [{
            label: 'tap conductors ≤ 10 ft (NEC 705.11(C))',
            pass: tapRule?.state === 'pass' ? true : tapRule?.state === 'fail' ? false : null,
          }],
          pending: tapRule?.state === 'pending'
            ? ['supply-side tap span is not constrained by the design — NEC 705.11(C) ≤10-ft rule cannot be inspected against']
            : [],
        }
      : undefined,
  );

  // A tap object that is NOT a view of the route segment (an older snapshot, or a
  // design that models the tap separately) keeps its own honest section rather
  // than being silently dropped.
  if (tap && !tapIsViewOfRun) {
    const rule = tapRule;
    const pending: string[] = [];
    if (rule?.state === 'pending') pending.push('tap-conductor length not measured — NEC 705.11(C) ≤10-ft rule PENDING');
    const failures = rule?.state === 'fail' ? [{ label: 'tap conductors > 10 ft (NEC 705.11(C))', pass: false as const }] : [];
    const compliance = evaluateCompliance({
      requiredValues: [
        { label: 'tap conductor spec', value: tap.conductorSpec },
        { label: 'tap conductor length', value: tap.lengthFt, numeric: true },
      ],
      checks: failures,
      pending,
    });
    sections.push({
      sectionId: tap.objectId,
      sectionLabel: 'TAP CONDUCTORS — SUPPLY-SIDE (NEC 705.11(C))',
      fromDevice: 'SUPPLY-SIDE TAP POINT',
      toDevice: 'FUSED AC DISCONNECT',
      cableType: tap.conductorSpec ?? 'THWN-2',
      conductorCount: null,
      totalConductorCount: null,
      conductorSize: tap.conductorSpec?.match(/#\d+(?:\/0)?\s*AWG/i)?.[0] ?? null,
      bonding: 'EGC with the service conductors (NEC 250.122) — service/enclosure bonding domain',
      groundingSegmentId: 'GRN-SERVICE-BOND',
      groundingAuthorityGroupId: null,
      bondingPendingAuthority: false,
      physicalRacewayId: null,
      racewayType: 'PER SERVICE ENTRANCE',
      racewaySize: null,
      operatingCurrentA: null,
      continuousCurrentA: null,
      ocpdA: null,
      lengthFt: num(tap.lengthFt),
      lengthKind: 'tap-measured-estimate',
      lengthLabel: tap.lengthFt != null ? 'tap run (measured)' : 'tap run (≤10 ft PENDING)',
      lengthObjectId: tap.objectId,
      lengthSource: tap.lengthSource ?? null,
      verificationStatus: tap.lengthSource === 'field-measurement' ? 'field-measured' : 'unverified-estimate',
      fillPct: null,
      fillApplicable: false,
      deratingFactor: null,
      deratingBasis: null,
      voltageDropPct: null,
      vdLimitPct: ROUTE_VD_LIMIT_PCT.feeder,
      vdCalculationLengthFt: num(tap.lengthFt),
      voltageDrop: gradeVoltageDrop({
        pct: null, limitPct: 3, lengthFt: num(tap.lengthFt),
        lengthSource: tap.lengthSource ?? null,
        verificationState: tap.lengthSource === 'field-measurement' ? 'field-measured' : 'unverified-estimate',
      }),
      ampacity: projectAmpacityAdjustment({
        conductorGauge: tap.conductorSpec?.match(/#\d+(?:\/0)?\s*AWG/i)?.[0] ?? null,
        insulation: 'THWN-2',
        currentCarryingCount: null,
        freeAir: false,
        ambientTempC: null,
        requiredContinuousA: null,
        requiredContinuousBasis: 'supply-side tap — sizing per service authority (PENDING)',
        ocpdA: num(tap.ocpdRatingA),
      }),
      compliance,
    });
  }

  // ══ THE DESIGN LENGTH BOUND, STATED ON EVERY SECTION THAT HAS ONE ══════
  // Applied HERE rather than in each section builder, because "the drawing
  // states the limit the installation is bound by" has to hold for every run,
  // and four builders each remembering to do it is four chances to forget.
  //
  // Pass-by-design is only honest if the construction set carries the
  // requirement. The estimate keeps its own label and stays an estimate.
  for (const sec of sections) {
    const seg = (elec.routeSegments ?? []).find(r => r.segmentId === sec.sectionId);
    if (!seg || seg.designMaxOneWayFt == null) continue;
    if (seg.lengthBoundState === 'bounded') {
      sec.lengthLabel = `${sec.lengthLabel} — MAX ${seg.designMaxOneWayFt} FT BY DESIGN`;
    } else if (seg.lengthBoundState === 'exceeds-bound') {
      sec.lengthLabel = `${sec.lengthLabel} — EXCEEDS THE ${seg.designMaxOneWayFt} FT MAX FOR THIS CONDUCTOR`;
    }
  }

  return sections;
}
