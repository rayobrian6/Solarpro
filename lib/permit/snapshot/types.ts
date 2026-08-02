// ═══════════════════════════════════════════════════════════════════════════
// PermitDesignSnapshot — THE canonical engineering authority for a planset.
// Ray's mandate (2026-07-20): every sheet is a read-only projection of this
// object; generation fails closed on any invariant violation; the snapshot is
// immutable (deep-frozen) after validation; every derived field carries
// provenance; source inputs are preserved separately from normalized inputs
// and calculated outputs.
//
// W1 scope: the snapshot is BUILT + VALIDATED + STAMPED on every sheet.
// Sheets convert to projections in W2-W6; until a value class converts, the
// evidence harness (scripts/planset-evidence.mjs) measures sheet agreement
// against this authority instead of V9/V11 blocking.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuralBomRow, StructuralBomReconciliation } from './structuralBom';
export type { StructuralBomRow, StructuralBomReconciliation } from './structuralBom';
import type { StructuralReactionReconciliation } from './structuralEngine';
export type { StructuralReactionReconciliation } from './structuralEngine';
import type { CodeAuthorityRecord } from './codeAuthority';
export type { CodeAuthorityRecord, CodeEdition, CodeEditionKind, CodeVerificationStatus } from './codeAuthority';
import type { ProjectAuthorityRecord } from './projectAuthority';
export type { ProjectAuthorityRecord, ProjectIssueState } from './projectAuthority';
import type { GroundingAuthorityResult, GroundingDomainNode } from './groundingAuthority';
export type {
  GroundingAuthorityResult, GroundingDomainNode, GroundingOutcome,
  GroundingDocumentEvidence, GroundingApplicabilityVerification,
} from './groundingAuthority';

export const SNAPSHOT_SCHEMA_VERSION = '1.0.0';

/** Where a value came from — attached to every derived section (req. 5). */
export interface Provenance {
  /** e.g. 'runElectricalCalc', 'conductorAuthority', 'planMicroBranches',
   *  'structural-engine-v4', 'equipment-db', 'ahj-national', 'client-post',
   *  'default-unverified' */
  source: string;
  /** engine/module version or record id when meaningful */
  ref?: string;
  note?: string;
}

export interface EquipmentRecord<TSpec> {
  recordId: string;                 // stable within the snapshot
  catalogId: string | null;         // equipment-db / mounting-hardware-db id
  manufacturer: string;
  model: string;
  sku: string | null;
  datasheet: {
    revision: string | null;        // doc title/rev as known
    sourceUrl: string | null;
    capturedAtIso: string | null;
    assetId: string | null;         // manufacturer-assets library id
  };
  verified: boolean;                // false ⇒ FIELD-VERIFY marker on sheets
  spec: TSpec;
  provenance: Provenance;
}

export interface ModuleSpec {
  wattsStc: number; voc: number; isc: number; vmp: number | null; imp: number | null;
  tempCoeffVocPctC: number | null;
  lengthIn: number | null; widthIn: number | null; thicknessIn: number | null; weightLbs: number | null;
  ulListing: string | null;
}
export interface MicroInverterSpec {
  continuousOutputA: number;        // manufacturer continuous output current
  continuousVa: number | null;
  maxUnitsPerBranch: number;        // manufacturer branch max (D-1 authority)
  maxBranchOcpdA: number;           // manufacturer branch OCPD max (D-1)
  nominalV: number;
  ulListing: string | null;
}
export interface StringInverterSpec {
  continuousOutputA: number; acOutputKw: number; maxDcVoltage: number | null;
  ulListing: string | null;
}
export interface MountSpec {
  upliftAllowableLbs: number | null; capacityBasis: string | null;
  fastenersPerMount: number | null; fastenerDiaIn: number | null;
  fastenerEmbedIn: number | null; maxSpacingIn: number | null;
  iccEsReport: string | null; selfFlashing: boolean | null;
}
export interface RailSpec {
  maxSpanIn: number | null; spliceIntervalIn: number | null;
}

export interface ConductorRecord {
  conductorId: string;
  gauge: string;                    // '#10 AWG'
  material: 'Cu' | 'Al';
  insulation: string | null;        // 'THWN-2', 'PV Wire', …
  count: number | null;
  ampacityA: number | null;
  provenance: Provenance;
}

export interface BranchRecord {
  branchId: string; label: string;  // 'B1'…
  deviceIds: string[];
  moduleCount: number;
  currentA: number; continuousA: number; ocpdA: number;
  conductorId: string; egcConductorId: string | null;
}

/** W2.1 — grounding is modeled PER SEGMENT AND PURPOSE. There is no single
 *  "system EGC". A listed integrated grounding method that requires no
 *  separate conductor is represented EXPLICITLY, never as an invented gauge. */
/** P13 WS-1 — the semantic ROLE of a grounding/bonding path. The role is what a
 *  sheet, a schedule and a BOM line agree on; it can never be inferred from a
 *  conductor size. EGC, bonding conductor and GEC are DISTINCT roles and may not
 *  cross-map (a GEC is not an EGC that happens to reach an electrode). */
export type GroundingSegmentRole =
  | 'ARRAY_RACK_BONDING_EGC'   // bonded module/racking system → rooftop bonding point
  | 'BRANCH_EGC'               // AC branch circuit equipment grounding conductor
  | 'FEEDER_EGC'               // AC feeder equipment grounding conductor
  | 'RACEWAY_BOND'             // the raceway itself is the EGC (NEC 250.118)
  | 'SERVICE_BOND'             // bonding at/ahead of the service disconnect
  | 'GEC'                      // grounding ELECTRODE conductor (250.66) — not an EGC
  | 'INTEGRATED_LISTED_METHOD';// a listed assembly provides the path (UL 2703 etc.)

export interface GroundingRecord {
  groundingId: string;
  segmentId: string;                 // canonical run/segment this applies to
  purpose: 'branch-egc' | 'feeder-egc' | 'raceway-bond' | 'gec' | 'integrated-listed-method'
    | 'array-rack-bonding-egc';
  /** P13 WS-1 — the canonical semantic role (see GroundingSegmentRole). */
  segmentRole: GroundingSegmentRole;
  required: boolean;                 // false ⇒ explicitly not required (with basis)
  method: 'conductor' | 'raceway' | 'integrated-listed' | 'none-required';
  conductorMaterial: 'Cu' | 'Al' | null;
  /** THE INSTALLED size — what is ordered, drawn and inspected. Equal to
   *  `selectedDesignSize` when a design standard applies, else the calculated
   *  minimum. null when method !== 'conductor'. */
  conductorSize: string | null;
  // ── P13 WS-1: THE CODE MINIMUM AND THE DESIGN SELECTION ARE DIFFERENT FACTS ──
  // Conflating them produced the campaign's worst class of claim: a planset that
  // says "NEC 250.122 requires #10" for a 20 A branch, when the table requires
  // #12 and #10 is the installer's design standard. Both are legitimate; only one
  // is the code table's answer. They are stored — and rendered — separately, and
  // the snapshot validator refuses a record where the installed size is smaller
  // than the calculated minimum.
  /** what NEC 250.122 actually requires at `associatedOcpdA` */
  calculatedMinimumSize: string | null;
  /** what the project/company design standard selected (≥ the minimum), or null
   *  when no standard applies and the minimum governs */
  selectedDesignSize: string | null;
  /** where the SELECTED size came from — never 'nec-250-122' unless the selection
   *  IS the table minimum */
  selectionSource: 'nec-minimum' | 'project-design-standard' | 'manufacturer-requirement'
    | 'operator-selection' | null;
  /** why the selection differs from the minimum, in one sentence */
  selectionReason: string | null;
  sizingBasis: string | null;        // e.g. 'NEC 250.122 @ 20A OCPD'
  associatedOcpdA: number | null;
  /** the OCPD whose rating drove the minimum, described (e.g. '20 A branch OCPD') */
  ocpdBasis: string | null;
  associatedEquipment: string | null;
  // ── endpoints: a conductor with no ends cannot be drawn, ordered or inspected ─
  sourceNode: string | null;
  destinationNode: string | null;
  /** bare / insulated — a bonding conductor is commonly bare, an EGC in a raceway
   *  is commonly green-insulated; the BOM line differs. */
  insulationState: 'bare' | 'insulated-green' | 'insulated-other' | null;
  /** free-air, in-raceway, or integral to the assembly */
  installationMethod: 'free-air' | 'in-raceway' | 'integral-to-assembly' | null;
  /** the canonical route segment this conductor physically follows, when it has one */
  routeId: string | null;
  /** the racking assembly whose bonding method this path depends on */
  rackingAssemblyId: string | null;
  /** the assembly's bonding method label at snapshot time */
  bondingMethod: string | null;
  /** the manufacturer document establishing the bonding method, when one is bound */
  manufacturerEvidenceId: string | null;
  manufacturerListingBasis: string | null;  // record ref when integrated-listed
  codeBasis: string;                 // e.g. 'NEC 250.122', 'NEC 250.118(4)'
  /** stable id for the sizing calculation, so a sheet cell can cite it */
  calculationId: string | null;
  provenance: Provenance;
}

/** PPC §7 — THE canonical rendered grounding conductor object.
 *
 *  Every grounding/bonding conductor row a sheet prints must BE one of these.
 *  The defect this type retires: PV-4B appended a hardcoded `<tr>` ("EGC | Array
 *  → AC Disconnect (ground bus) | #10 AWG bare Cu | PVC Sch 80 1-1/4" | 20 ft")
 *  built from the FEEDER's EGC gauge and the FEEDER row's own conduit/length
 *  reprinted verbatim — a grounding run with no id, no segment, no raceway of its
 *  own, no BOM line and no authority state. It reconciled with nothing.
 *
 *  A GroundingSegment carries its identity (`groundingSegmentId`), its endpoints,
 *  the circuit/segment it parallels, its size + type, the PHYSICAL raceway it
 *  actually occupies (null ⇒ free air / not in a raceway — never another run's
 *  conduit), its length AND the provenance of that length, its NEC basis, its
 *  authority state, and the BOM line it derives. Projected (not stored) — see
 *  projectGroundingSegments() in electricalProjection.ts — so the snapshot digest
 *  is unchanged. */
export interface GroundingSegment {
  /** stable canonical id — gate 10: no rendered grounding row without one. */
  groundingSegmentId: string;
  /** the canonical GroundingRecord this projects (null for domain-only nodes AND
   *  for a GROUP-AUTHORITY node, which projects N records, not one). */
  groundingId: string | null;
  /** ECD §6 — IDENTITY KIND. A 'physical-segment' node IS one installed grounding
   *  path and its `groundingSegmentId` is a PHYSICAL segment identity (unique
   *  across the package, gate 11). A 'group-authority' node is the ONE authority
   *  result governing several physical segments; it carries its OWN id, is never
   *  counted as a physical segment, and renders visibly as a group-authority row.
   *  The defect this retires: the grouped branch-EGC authority was given
   *  `gnd-br-1` — a PHYSICAL segment's identity — which simultaneously appeared on
   *  all three E-1 branch rows, so the package rendered ONE grounding identity for
   *  three canonical objects (gnd-br-1 ×8, gnd-br-2/3 ×0). */
  identityKind: 'physical-segment' | 'group-authority';
  /** ECD §6 — the group-authority node this row reconciles to. On the group node
   *  itself this equals its own `groundingSegmentId`; on a physical segment
   *  governed by a group it points AT the group; null when the segment is its own
   *  authority. Every rendered grounding row reconciles to exactly one canonical
   *  object through (groundingId | groundingAuthorityGroupId). */
  groundingAuthorityGroupId: string | null;
  /** ECD §6 — on a group node: the branch labels the ONE authority result covers
   *  (e.g. ['B1','B2','B3']). Empty on physical segments. */
  branchScope: string[];
  /** ECD §6 — on a group node: the canonical GroundingRecord ids it groups
   *  (gnd-br-1/2/3). Empty on physical segments. */
  memberGroundingIds: string[];
  /** which of the SIX distinct grounding objects this is (Ray §1: kept separate). */
  purpose: GroundingRecord['purpose'] | 'module-racking-bonding';
  /** human label for the schedule row. */
  label: string;
  fromDeviceId: string;
  toDeviceId: string;
  /** the circuit / route segment this grounding conductor is associated with. */
  associatedSegmentId: string | null;
  associatedCircuitIds: string[];
  /** conductor size — null when the method installs no conductor, or when the
   *  authority has not established one (PENDING). NEVER borrowed from another
   *  object (the feeder-EGC-relabelled-as-array-EGC defect). */
  conductorSize: string | null;
  /** P13 WS-1 — the NEC 250.122 MINIMUM and the DESIGN SELECTION, projected
   *  separately so a rendered row can state both. When they differ the sheet
   *  must show "calculated minimum X · selected design Y", never one number
   *  attributed to the code table. Null on rows where no conductor is sized. */
  calculatedMinimumSize: string | null;
  selectedDesignSize: string | null;
  selectionSource: GroundingRecord['selectionSource'];
  selectionReason: string | null;
  /** the canonical semantic role, carried through to the rendered row. */
  segmentRole: GroundingSegmentRole | null;
  conductorMaterial: 'Cu' | 'Al' | null;
  /** insulation / conductor type ('bare', 'THWN-2 green', 'integral to the listed
   *  cable assembly', …). null ⇒ not established. */
  insulationType: string | null;
  /** the method (conductor / raceway / listed-integrated / none-required / pending). */
  method: GroundingRecord['method'] | 'pending';
  /** the PHYSICAL raceway this conductor occupies — null when free-air or when no
   *  raceway object carries it. Never another segment's conduit string. */
  physicalRacewayId: string | null;
  racewayLabel: string | null;
  lengthFt: number | null;
  /** where lengthFt came from — 'cable-path-geometry' | 'route-one-way' |
   *  'not-established'. A null length prints PENDING, never a borrowed number. */
  lengthSource: 'cable-path-geometry' | 'route-one-way' | 'field-measurement' | 'not-established';
  necBasis: string;
  /** the authority state of THIS object: verified | pending | not-required. */
  authorityState: 'verified' | 'pending-manufacturer-authority' | 'nec-derived' | 'not-required';
  /** true ⇒ the object exists but NO installed conductor may be asserted. */
  installedConductorAsserted: boolean;
  /** ECD W1-A — the STABLE BOM ROW ID (lib/bom/bomLineId.ts) this segment
   *  derives, or null when it orders nothing. This used to hold the row's PART
   *  NUMBER ('GRN-OPENAIR-12') because no stable row id existed; part numbers
   *  are not unique in general (three PVC-conduit rows share a family), so a
   *  "BOM line" pointer keyed on one could not be reconciled. The id is
   *  content-derived, so the pre-BOM projection can compute the SAME value the
   *  BOM stamping pass will produce. `bomLinePartNumber` keeps the old value
   *  for readers that want the human-facing part. */
  bomLineId: string | null;
  /** the part number the segment's BOM row carries (human-facing; not an id). */
  bomLinePartNumber?: string | null;
  bomRowState: 'no-row' | 'orderable' | 'design-quantity-non-orderable';
  provenance: string;
}

/** W1 §route-verification — the five allowed states for a run's length/route
 *  evidence. An estimate can NEVER be presented as field-verified (gate 2). */
export type RouteVerificationState =
  | 'unverified-estimate'
  | 'cad-derived-estimate'
  /** WS-5 — a length taken from ROUTED CAD GEOMETRY. Distinct from an estimate
   *  (the route really is in the model) and from field evidence (nobody measured
   *  it). Its absence is what forced BRANCH_RUN to contradict itself: the segment
   *  carried `lengthSource: 'cad-route'` beside
   *  `verificationStatus: 'cad-derived-estimate'`, because there was no state to
   *  express "geometry-derived, but not field evidence". */
  | 'geometry-derived'
  /** WS-5 — an operator-entered measurement that has NOT been verified. Entry is
   *  not authority: this may become the calculation length, and must NOT close a
   *  field-verification requirement. */
  | 'field-reported'
  | 'field-measured'
  | 'field-verified'
  | 'as-built-verified';

/** WS-5 — the SOURCE of a route length. Deliberately separate from
 *  RouteVerificationState: where a number came from and how strongly it has been
 *  verified are different questions, and collapsing them is what produced the
 *  BRANCH_RUN contradiction. */
export type RouteLengthSource =
  | 'cad-derived-estimate'
  | 'cad-route'
  | 'field-reported'
  | 'field-verified';

/** WS-5 — the ONLY legal (source, state) pairings. Anything else is a defect,
 *  not a variant: a `cad-route` length described as an estimate understates it,
 *  and a `field-reported` length described as verified overstates it — and the
 *  second is the one that puts an unverified number on a stamped drawing. */
export const ROUTE_LENGTH_AUTHORITY_PAIRS: ReadonlyArray<
  readonly [RouteLengthSource, RouteVerificationState]
> = [
  ['cad-derived-estimate', 'cad-derived-estimate'],
  ['cad-route', 'geometry-derived'],
  ['field-reported', 'field-reported'],
  ['field-verified', 'field-verified'],
];

/** Fail-closed validity check for a (source, state) pair. */
export function isValidRouteLengthAuthority(
  source: string | null | undefined,
  state: string | null | undefined,
): boolean {
  return ROUTE_LENGTH_AUTHORITY_PAIRS.some(([s, v]) => s === source && v === state);
}

/** WS-5 — does this length authority satisfy a FIELD-VERIFICATION requirement?
 *  Only field-verified evidence does. A geometry-derived route is more specific
 *  than an estimate but is still not field evidence, and a field REPORT is an
 *  operator's claim, not a verification. */
export function closesFieldVerification(state: RouteVerificationState | null | undefined): boolean {
  return state === 'field-verified' || state === 'as-built-verified';
}

/** W2.1 / W1 — canonical route-length + per-segment electrical authority: every
 *  physically distinct electrical section is a segment with ONE authoritative
 *  length, its OWN currents (operating / continuous / calculated SEPARATED from
 *  the OCPD rating), temperature basis, derating, installation method and
 *  verification status. Every sheet PROJECTS these fields; no sheet re-derives
 *  conductor/conduit/length/fill/VD/current for a given segmentId. Fields added
 *  in the 07-22 repair pass are optional so existing serialization/digest is
 *  unchanged until the build populates them. */
/** D1 (Planset 17) — WHO OWNS THIS RUN.
 *  Utility-owned service equipment (the main-panel → utility-meter run) is not
 *  the installer's to route, measure, procure or modify. It must stay visible in
 *  the electrical topology and be excluded from every PROJECT authority. */
export type RouteOwnership = 'PROJECT_OWNED' | 'UTILITY_OWNED';

/** D1 — whether PROJECT route authority applies to this run.
 *  EXCLUDED is a DECISION, carried explicitly, never inferred from a missing
 *  raceway object or from a segment-name regex. */
export type RouteAuthorityApplicability = 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE';

export interface RouteSegmentRecord {
  segmentId: string;                 // engine RunSegment id (e.g. 'COMBINER_TO_DISCO_RUN')
  from: string; to: string;
  /** D1 — ownership, from the engine's own `isUtilityOwned` assertion (set by
   *  computed-system.ts and segment-builder.ts). Optional so hand-built
   *  RouteSegmentRecord literals in tests keep compiling; every consumer reads it
   *  FAIL-CLOSED as `?? 'PROJECT_OWNED'`, so an unpopulated record is treated as
   *  the installer's responsibility rather than silently excused. */
  routeOwnership?: RouteOwnership;
  /** D1 — whether project route authority applies. Utility-owned runs are
   *  EXCLUDED: no field measurement, no raceway object, no procurement, and no
   *  contribution to project route completeness. */
  routeAuthorityApplicability?: RouteAuthorityApplicability;
  /** D1 — why, in one sentence, for the reader of the sheet. */
  routeApplicabilityReason?: string | null;
  /** what this physical section carries — e.g. 'micro AC branch (Q-Cable trunk)',
   *  'branch home-run', 'roof junction box', 'combiner feeder',
   *  'combiner→disconnect', 'disconnect→tap', 'tap conductors',
   *  'service connection'. */
  electricalFunction?: string | null;
  oneWayFt: number | null;
  lengthSource: 'cad-route' | 'cad-derived-estimate' | 'field-measurement' | 'operator-entry' | 'unknown';
  /** W1 — the ONE verification state derived from lengthSource + blockers. Route
   *  notes/callouts project THIS (never a renderer "field-verified" literal). */
  verificationStatus?: RouteVerificationState;
  raceway: string | null;            // 'EMT' | 'PVC' | 'FREE_AIR' …
  tradeSizeIn: string | null;
  fillPct: number | null;
  /** W1 — installation method (e.g. 'in-conduit', 'free-air (690.31(C))',
   *  'direct-burial', 'cable-tray'). Distinct from the raceway TYPE. */
  installationMethod?: string | null;
  conductorGauge: string | null;
  conductorCount?: number | null;    // current-carrying conductors in this run
  conductorMaterial?: 'Cu' | 'Al' | null;
  insulation?: string | null;        // 'THWN-2' | 'USE-2' | 'PV Wire' | 'TC-ER' …
  neutralPresent?: boolean | null;   // W1 — neutral status (grid-tied AC feeder)
  conductorCallout: string | null;
  egcGauge: string | null;           // the EGC carried IN this segment, if any
  /** W1 — how EGC/bonding is provided ('conductor' | 'raceway' | 'integrated-listed'). */
  bondingMethod?: 'conductor' | 'raceway' | 'integrated-listed' | 'none-required' | null;
  // ── §3/§4 (closeout 2026-07-23) PHYSICAL RACEWAY AUTHORITY (per segment) ──
  /** the shared physical raceway this in-conduit segment rides (null ⇒ open-air).
   *  Two segments with the SAME id share ONE conduit (bundled fill). */
  physicalRacewayId?: string | null;
  /** # circuits sharing this segment's raceway (1 dedicated; N shared home-run). */
  sharedCircuitCount?: number | null;
  /** smallest legal trade size at ≤40% fill (documents any discretionary upsize). */
  minimumCodeRacewaySize?: string | null;
  /** NEC article for the raceway TYPE — the ONLY code-citation source (§7). */
  racewayNecArticle?: string | null;
  /** documented rationale when selected raceway size exceeds the minimum. */
  upsizingReason?: string | null;
  // ── W1 — currents SEPARATED (operating vs continuous vs OCPD rating). PV-4B's
  //    "60 A next to a VD computed at ~45 A" was the OCPD printed where the
  //    operating current belonged; these three fields keep them distinct. ──
  operatingCurrentA?: number | null;   // the load current the VD formula uses
  continuousCurrentA?: number | null;  // operating × 1.25 (NEC 690.8(A))
  calculatedCurrentA?: number | null;  // engine sizing current (post-derate)
  // ── §10 (closeout 2026-07-23) CANONICAL LENGTH TAXONOMY ─────────────────────
  // One field per length MEANING so no sheet ever prints an unlabeled number that
  // silently mixes a design route, a calc basis and a procurement quantity. Every
  // printed length references THIS segment id + one of these fields (gate 10).
  // Optional so pre-closeout serialization/digest is unchanged until populated.
  /** the as-routed installed length derived from real geometry (coordinates). */
  geometricDesignLengthFt?: number | null;
  /** a heuristic field-length estimate when no geometry exists (plane widths, …). */
  estimatedFieldLengthFt?: number | null;
  /** a recorded field measurement (null until a tech measures the run). */
  verifiedFieldLengthFt?: number | null;
  /** the length the calc sheets (VD/ampacity) actually consumed. */
  calculationLengthFt?: number | null;
  /** the length the BOM orders (design/estimate × waste). */
  procurementLengthFt?: number | null;
  /** waste/slack multiplier applied to reach procurementLengthFt. */
  wasteFactor?: number | null;
  /** where oneWayFt / the taxonomy lengths came from (mirrors lengthSource but
   *  distinguishes a coordinate derivation from a plane-width estimate). */
  lengthProvenance?: 'geometry-derived' | 'estimated' | 'field-measured' | 'unknown';
  /** the ONE verification state for the length taxonomy (mirrors verificationStatus). */
  verificationState?: RouteVerificationState;
  voltageDropPct: number | null;
  /** which current the voltage-drop formula consumed (states the basis). */
  voltageDropCurrentBasis?: 'operating' | 'continuous' | 'calculated' | null;
  ocpdA: number | null;                // OCPD/breaker RATING — NOT a load current
  /** W1 — temperature basis for ampacity derate (ambient + rooftop adder).
   *  TAC WS-2: `ambientSource` and `effectiveAmbientTempC` make the derate
   *  ATTRIBUTABLE — the ampacity chain fails closed (PENDING) rather than
   *  applying a correction factor whose temperature is unrecorded. */
  ambientTempC?: number | null;
  rooftopAdderC?: number | null;
  ambientSource?: string | null;
  effectiveAmbientTempC?: number | null;
  tempDeratingFactor: number | null;
  provenance: Provenance;
}

/** §3/§4/§6 (closeout 2026-07-23) — one PHYSICAL raceway as a first-class
 *  snapshot record. The shared branch home-run appears ONCE with
 *  sharedCircuitCount>1 (all branches bundled). PV-4A/PV-4B fill reads THIS; the
 *  BOM §6/§7 pass iterates these (per-raceway material + the raceway's OWN NEC
 *  article — never a project-level 'all runs' roll-up or a hardcoded '358'). */
export interface PhysicalRacewayRecord {
  physicalRacewayId: string;
  racewayType: string;               // 'PVC Sch 80' | 'EMT' | …
  necArticle: string;                // '352' | '358' | … (raceway-type authority)
  supportArticle: string;            // '352.30' | '358.30' | …
  sharedCircuitCount: number;
  conductorCount: number;
  currentCarryingCount: number;
  conductorAreaIn2: number | null;
  minimumCodeRacewaySize: string | null;
  calculatedFillRacewaySize: string | null;
  selectedRacewaySize: string | null;
  fillPct: number | null;
  upsizingReason: string | null;
  deratingBasis: string | null;
  supportCondition: string | null;
  provenance: Provenance;
}

/** §6 (closeout 2026-07-23) — THE canonical LISTED CABLE ASSEMBLY authority for a
 *  microinverter AC branch trunk (Enphase Q Cable, APsystems AC Bus, …). The
 *  branch trunk is a manufacturer-listed factory-connectorized cable ASSEMBLY, not
 *  a field-run THWN conductor: PV-4B/E-1/SCHED/BOM/APP-A project THIS instead of a
 *  generic "#12 AWG THWN-2" row (gate 6 — never translated into generic THWN-2).
 *  Honest null on any field the catalog does not record (with a note), never a
 *  fabricated value. */
export interface ListedCableAssembly {
  assemblyId: string;                 // 'QCABLE-ASSEMBLY'
  manufacturer: string;               // 'Enphase'
  ecosystem: string;                  // 'IQ Q-Cable'
  /** exact factory model / SKU for the selected orientation (portrait 60/72-cell
   *  ⇒ Q-12-10-240). Null ⇒ genuinely unrecorded (see `skuNote`). */
  model: string | null;
  sku: string | null;
  skuNote: string | null;             // why null / caveat when the SKU is unverified
  /** conductor construction (e.g. 'two-wire, double-insulated'). */
  conductorConstruction: string | null;
  conductorCount: number | null;
  conductorGauge: string | null;      // '#12 AWG'
  /** insulation + listing basis (THHN/THWN-2, UL 9703/UL 3003; TC-ER / free-air). */
  insulationListing: string | null;
  /** the wiring-method label the sheets show for the open-air section. */
  wiringMethodLabel: string;          // 'ENPHASE Q CABLE (TC-ER)'
  /** P13 — THE branch cabling / connector ARCHITECTURE this assembly IS, carried
   *  from the canonical trunk-cable system (the same object that supplies the SKU,
   *  the branch system, the connector family, the terminator and the procurement
   *  inputs). It is an APPLICABILITY DIMENSION: a manufacturer document written
   *  for the integrated-MC4 architecture cannot establish the grounding method for
   *  a drop-connector Q-Cable branch, and vice versa. Null ⇒ the brand's trunk
   *  system is not catalogued, and the grounding authority stays PENDING — never
   *  a default. */
  connectorArchitecture: import('@/lib/equipment/trunkCable').TrunkConnectorArchitecture | null;
  /** molded connector drop spacing along the trunk (ft). */
  connectorSpacingFt: number | null;
  /** max branch current / OCPD the assembly is listed for (A). */
  maxBranchCurrentA: number | null;
  /** compatible micro models (per-model branch limits live on the electrical branch objects). */
  compatibleMicroModels: string[];
  /** total procurement cable length across all branches (ft) — mirrors the BOM. */
  cableLengthFt: number | null;
  /** connector-drops = one per micro (the real purchase unit). */
  dropCount: number | null;
  /** unused-connector sealing cap SKU (Q-SEAL-10) + branch-end terminator (Q-TERM-10). */
  unusedDropCapSku: string | null;
  terminatorSku: string | null;
  sourceDocument: string | null;
  /** 'catalog-sourced' (real SKU, per-model limits field-verify) | 'unverified'. */
  verificationStatus: 'catalog-sourced' | 'field-verified' | 'unverified';
  provenance: Provenance;
}

/** §7 (closeout 2026-07-23) — THE canonical per-branch CABLE-PATH object. The
 *  trunk length is DERIVED GEOMETRICALLY from the branch's module coordinates +
 *  branch assignment (order the micros along the branch, sum inter-module path
 *  distances + a lead-in drop + documented waste) — NOT the plane-width heuristic
 *  (deriveRunLengths BRANCH_RUN = Σ plane widths × slack, which produced the
 *  un-reconcilable 3×68≠152). PV-4B lengths, SCHED qty, BOM qty and the evidence
 *  harness all trace to these objects (gate 7). Four separated lengths per §10:
 *  designed-installed (geometry), drop count, procurement (drops × pitch × waste),
 *  waste allowance. */
export interface BranchCablePath {
  branchId: string;                   // 'br-1'
  branchLabel: string;                // 'B1'
  moduleCount: number;
  /** connector-drops on this branch = moduleCount (one drop per micro). */
  dropCount: number;
  /** as-routed installed trunk length (ft) from the geometric module path. */
  designedInstalledLengthFt: number | null;
  /** the per-drop pitch used for the procurement quantity (ft). */
  connectorSpacingFt: number | null;
  /** procurement length (ft) = dropCount × pitch × waste (the BOM footage basis). */
  procurementLengthFt: number | null;
  wasteFactor: number;
  /** 'geometry-derived' when module coordinates drove the path; 'estimated' fallback. */
  lengthProvenance: 'geometry-derived' | 'estimated';
  /** human-readable derivation (inter-module Σ + lead-in, or the estimate basis). */
  derivation: string;
  provenance: Provenance;
}

// ═══════════════════════════════════════════════════════════════════════════
// Q-CABLE PROCUREMENT SUFFICIENCY GATE (2026-07-24) — the FAIL-CLOSED deficit.
//
// The §7 geometric per-branch cable path (BranchCablePath.designedInstalledLengthFt)
// is the AS-ROUTED installed trunk length. The drop-based procurement footage
// (ListedCableAssembly.cableLengthFt = Σ ceil(drops × pitch × waste)) is what the
// BOM orders. When Σ designed-installed (+ any manufacturer-documented service-loop
// allowance) EXCEEDS the procurement footage, the ordered cable is SHORT of the
// installed path — a real procurement deficit. Ray's ruling: this is NOT a
// FIELD-VERIFY / "add jumpers" note by assertion; it is a BLOCKING condition
// (QCABLE-PROCUREMENT-INSUFFICIENT) that can only be cleared by a VERIFIED
// CableExtensionSolution (exact listed product + verified manufacturer document +
// system compatibility + quantity/location + drawings/schedules/BOM + recalculated
// VD/installation). An unverified free-text note can NEVER clear it.
// ═══════════════════════════════════════════════════════════════════════════

/** The verified manufacturer document evidence a CableExtensionSolution must carry
 *  to clear the QCABLE-PROCUREMENT-INSUFFICIENT blocker. Same discipline as the
 *  RT-MINI racking / framing document evidence: resolved THROUGH lib/documents and
 *  evaluated purely — verified + current + archived + hashed + exact-product. */
export interface CableExtensionDocumentEvidence {
  documentId: string | null;
  documentClass: string;
  documentIdentity: string | null;
  verificationState: string;                 // must be 'verified'
  status: string;                            // must be 'current'
  archivedInRepo: boolean;                    // must be true
  sha256: string | null;                     // must be present
  /** exact extension/jumper/cable product SKU the document covers. */
  coversExtensionSku: string | null;
  /** the micro/trunk system the document states compatibility with (IQ8A / Q-Cable). */
  compatibleSystem: string | null;
  revisionOrDate: string | null;
}

/** A canonical proposed resolution to a Q-Cable procurement deficit. It clears the
 *  blocker ONLY when EVERY field is satisfied (see evaluateCableExtensionClearance):
 *  an exact selected listed product, verified compatibility with the selected
 *  IQ8A/Q-Cable system, a VERIFIED manufacturer document, quantity/location as
 *  canonical data, representation in the drawings/schedules/BOM, and recalculated
 *  VD/installation. Solution objects are empty on a live design today (no operator
 *  selection path wired), so the blocker stays active — by design. */
export interface CableExtensionSolution {
  solutionId: string;
  /** which of the four enumerated resolution kinds this solution is. */
  kind: 'verified-jumper-extension' | 'alternate-listed-cable' | 'route-layout-revision' | 'field-wireable-connector';
  /** exact selected listed product SKU (null ⇒ not selected ⇒ cannot clear). */
  selectedSku: string | null;
  quantity: number | null;
  /** installed length this solution adds (ft) — must cover the deficit to clear. */
  addedLengthFt: number | null;
  /** branch ids / drop locations the solution is placed at (canonical data). */
  locations: string[];
  /** verified compatible with the selected IQ8A / Q-Cable system. */
  compatibilityVerified: boolean;
  compatibleSystemNote: string | null;
  /** the verified manufacturer document (via lib/documents). null ⇒ cannot clear. */
  manufacturerDocument: CableExtensionDocumentEvidence | null;
  representedInDrawings: boolean;
  representedInSchedules: boolean;
  representedInBom: boolean;
  vdInstallationRecalculated: boolean;
  note: string | null;
  provenance: Provenance;

  // ── ECD §4 (W1-E) — the fields the PROMOTION contract needs on top of the
  // deficit-CLEARANCE contract above. A solution may clear the length deficit
  // and still not be the authority that turns a specific connector BOM row from
  // CANDIDATE_NON_ORDERABLE into VERIFIED_ORDERABLE: promotion additionally
  // requires the operator to have SELECTED it and the solution to name the exact
  // BOM line ids it supplies. All optional/additive so an existing solution
  // object (and the empty live array) serializes unchanged. Absent ⇒ NO
  // promotion — fail-closed, which is the honest live outcome today.
  /** the operator SELECTED this solution (a candidate is not a selection). */
  selected?: boolean;
  /** the extension product's manufacturer (exact, never inferred from a name). */
  manufacturer?: string | null;
  /** canonical cable-segment / branch-cable-path ids the solution is placed on. */
  cableSegmentIds?: string[];
  /** the project/system applicability boundary the solution is verified for. */
  applicability?: string | null;
  /** the solution record's own verification state ('verified' promotes). */
  verificationState?: 'verified' | 'unverified' | 'pending-document' | 'candidate';
  /** the EXACT BOM line ids (lib/bom/bomLineId.ts) this solution supplies. Only
   *  a row named here can ever be promoted by it. */
  bomLineIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-5 (2026-07-27) — THE DETERMINISTIC Q-CABLE TOPOLOGY OBJECT.
//
// The directive's field list, derived ONCE from the canonical layout geometry
// (module centres + branch assignment + roof-plane ids + row indices) and the
// brand catalog. Every downstream reader — the procurement-sufficiency gate, the
// BOM trunk/terminator/sealing-cap rows, PV-4B / E-1 / SCHED, RS-1 — consumes
// THIS object; nothing re-derives a cable length from a renderer estimate.
// ═══════════════════════════════════════════════════════════════════════════

/** The transition class of the cable segment ARRIVING at a drop. Derived from
 *  the canonical geometry, never from a length threshold guess: a roof-plane id
 *  change is an ARRAY transition, a row-index change within a plane is a ROW
 *  transition, everything else is a plain in-row hop. */
export type QCableTransitionClass = 'in-row' | 'row-transition' | 'array-transition' | 'branch-start';

/** One micro connection point (drop) on a branch cable, in cable order. */
export interface QCableDropRecord {
  /** 1-based position along the branch cable. */
  index: number;
  moduleInstanceId: string | null;
  roofPlaneId: string | null;
  row: number | null;
  col: number | null;
  /** canonical plan-feet centre of the module this micro is mounted under. */
  xFt: number;
  yFt: number;
  /** centre-to-centre cable distance from the PREVIOUS drop (null at the start). */
  segmentFromPreviousFt: number | null;
  transition: QCableTransitionClass;
  /** molded connector sections the arriving segment consumes (ceil(len ÷ pitch)). */
  sectionsFromPrevious: number;
  /** molded connectors landing INSIDE the arriving segment with no micro to serve
   *  — the DEAD DROPS. Each is closed with the manufacturer's listed sealing cap. */
  deadDropsInSegment: number;
}

/** A physical end of a branch cable and how it is closed out. */
export interface QCableEndRecord {
  endId: string;
  branchId: string;
  kind: 'homerun-transition' | 'far-end';
  atDropIndex: number;
  xFt: number;
  yFt: number;
  /** 'field-wireable-connector' at the home-run transition, 'terminator' at the
   *  far end (the manufacturer's single-use watertight cable-end cap). */
  treatment: 'terminator' | 'homerun-transition' | 'not-established';
  treatmentSku: string | null;
  basis: string;
}

/** A sub-array / roof-plane BRIDGE inside a branch: a hop whose gap exceeds the
 *  molded connector pitch AND crosses to another plane. The manufacturer's
 *  documented method for this case is NOT more molded cable — it is a
 *  custom-length JUMPER fabricated from raw cable with a field-wireable
 *  connector pair (the same datasheet that documents the service-loop + sealing
 *  cap treatment for a within-plane transition). */
export interface QCableBridgeRequirement {
  branchId: string;
  atDropIndex: number;
  gapFt: number;
  fromRoofPlaneId: string | null;
  toRoofPlaneId: string | null;
  /** raw cable the jumper consumes (gap × waste). */
  rawCableFt: number;
  rawCableSku: string | null;
  connectorPairs: number;
  connectorMaleSku: string | null;
  connectorFemaleSku: string | null;
  /** the manufacturer rule this requirement comes from. */
  basis: string;
  /** a jumper is a SEPARATE listed product added to the design: per the standing
   *  ECD W1-E ruling it is ESTABLISHED only by a verified cable-extension
   *  solution, never by the engine's own assertion. */
  established: boolean;
}

export interface QCableBranchTopology {
  branchId: string;
  branchLabel: string;
  moduleCount: number;
  dropCount: number;
  /** the cable ORDER — module instance ids, first to last. */
  orderedModuleIds: string[];
  drops: QCableDropRecord[];
  /** the per-hop centre-to-centre distances, in cable order. */
  interModuleSegmentsFt: number[];
  rowTransitionCount: number;
  rowTransitionFt: number;
  arrayTransitionCount: number;
  arrayTransitionFt: number;
  branchStartDropIndex: number;
  branchEndDropIndex: number;
  /** the home-run transition (which cable end leaves the array for the J-box).
   *  `established:false` when the transition POINT is not carried in the CAD
   *  model — the lead-in is then the manufacturer pitch, stated as such. */
  homerunTransition: {
    atEnd: 'start' | 'end';
    leadInFt: number;
    established: boolean;
    basis: string;
  };
  cableEnds: QCableEndRecord[];
  /** the branch's share of the DOCUMENTED service-loop allowance (path-
   *  proportional; Σ over branches equals the total exactly — counted ONCE). */
  serviceLoopAllowanceShareFt: number;
  /** sub-array / roof-plane bridges inside this branch (documented jumper). */
  bridgeRequirements: QCableBridgeRequirement[];
  /** Σ inter-module segments + the home-run lead-in — the AS-ROUTED length. */
  installedLengthFt: number;
  /** the portion of the as-routed length the MOLDED cable carries: installed
   *  minus the bridge gaps a documented jumper spans. */
  moldedPathLengthFt: number;
  /** molded path × waste + allowance share — what the ordered cable must cover. */
  requiredLengthFt: number;
  /** ordered connector sections = max(dropCount, ceil(required ÷ pitch)). */
  orderedSections: number;
  /** ordered sections × pitch — the procurement footage for this branch. */
  procurementLengthFt: number;
  /** ordered sections − drops: connectors with no micro ⇒ sealing caps. */
  deadDropCount: number;
  sealingCapsRequired: number;
  terminatorsRequired: number;
  /** true when this branch's ordered cable covers its own requirement. An
   *  aggregate that covers Σ while one branch is short is NOT sufficient. */
  sufficient: boolean;
  geometryCoverage: 'geometry-derived' | 'estimated' | 'none';
  confidence: number;
  derivation: string;
}

export interface QCableTopology {
  present: boolean;
  assemblyId: string | null;
  /** the SELECTED listed cable variant. */
  sku: string | null;
  systemBrand: string | null;
  ecosystem: string | null;
  connectorSpacingFt: number | null;
  wasteFactor: number;
  /** the array's module centre-to-centre pitch (the reach a connector must span). */
  modulePitchFt: number | null;
  orientation: 'portrait' | 'landscape';
  branches: QCableBranchTopology[];
  /** every sub-array / plane bridge in the design (the jumper requirements). */
  bridgeRequirements: QCableBridgeRequirement[];
  totals: {
    branchCount: number;
    dropCount: number;
    installedLengthFt: number;
    /** the molded-cable portion (installed − Σ bridge gaps). */
    moldedPathLengthFt: number;
    requiredLengthFt: number;
    bridgeCount: number;
    bridgeGapFt: number;
    jumperRawCableFt: number;
    jumperConnectorPairs: number;
    orderedSections: number;
    procurementLengthFt: number;
    /** Σ dropCount × pitch × waste — the DROP-COUNT lower bound of the same
     *  derivation (what the BOM ordered before the topology existed). */
    dropBasisProcurementLengthFt: number;
    deadDropCount: number;
    sealingCapsRequired: number;
    terminatorsRequired: number;
    rowTransitionCount: number;
    arrayTransitionCount: number;
  };
  serviceLoopAllowanceFt: number;
  allowanceProvenance: string;
  /** the manufacturer's documented dead-drop treatment, or null when the brand
   *  publishes none (in which case dead drops are NOT treated as cappable). */
  deadDropTreatment: {
    established: boolean;
    method: 'listed-sealing-cap' | 'not-established';
    sku: string | null;
    basis: string;
  };
  /** extension stock the brand publishes (raw cable + field-wireable pair). */
  extensionStock: {
    rawCableSku: string | null;
    fieldWireableMaleSku: string | null;
    fieldWireableFemaleSku: string | null;
    basis: string | null;
  };
  geometryCoverage: 'geometry-derived' | 'partial' | 'estimated' | 'none';
  confidence: number;
  /** the portion of the topology that genuinely depends on field observation. */
  fieldDependentPortion: string[];
  derivation: string;
  provenance: Provenance;
}

/** ONE evaluated resolution option for a Q-Cable procurement deficit. Every
 *  option carries its PER-BRANCH and AGGREGATE verdicts — an option that covers
 *  the aggregate while leaving one branch short is NOT viable. */
export interface QCableSolutionOption {
  optionId: string;
  kind:
    | 'stock-as-ordered'
    | 'derived-stock-order-composition'
    | 'alternate-listed-cable'
    | 'verified-listed-extension'
    | 'raw-cable-jumper'
    | 'cable-end-placement'
    | 'branch-reassignment'
    | 'field-route-residual';
  title: string;
  description: string;
  viable: boolean;
  /** true ⇔ adopting it changes NOTHING physical about the design (an order
   *  composition, not a layout / product / branch change). */
  autoAdoptable: boolean;
  adopted: boolean;
  changesPhysicalDesign: boolean;
  perBranch: { branchId: string; requiredFt: number; providedFt: number; sufficient: boolean }[];
  aggregateRequiredFt: number;
  aggregateProvidedFt: number;
  aggregateSufficient: boolean;
  /** the exact operator/design action adoption would require (null when none). */
  requiresAction: string | null;
  blockingReasons: string[];
  evidenceRefs: string[];
  /** lower ranks first; null ⇒ not ranked (non-viable). */
  rank: number | null;
  payload: Record<string, unknown> | null;
}

/** THE option-space evaluation for a Q-Cable procurement deficit. This is what
 *  replaces "announce the shortage": the engine states every option, its exact
 *  numbers, which one it recommends, what it adopted, and the precise residual. */
export interface QCableSolutionEvaluation {
  evaluated: boolean;
  /** the deficit measured against the CURRENT (drop-count) order. */
  measuredDeficitFt: number;
  /** the ORDER-SIZING requirement: Σ per-branch (as-routed installed × waste) +
   *  the documented service-loop allowance. It is STRICTER than the sufficiency
   *  gate's own threshold (Σ installed + allowance, no waste), which remains the
   *  minimum the ordered cable must cover — an option that satisfies this
   *  satisfies the gate by construction. */
  sizingRequirementFt: number;
  currentProcurementFt: number;
  options: QCableSolutionOption[];
  recommendedOptionId: string | null;
  adoptedOptionId: string | null;
  /** a complete solution is established (adopted, or a verified selected one). */
  resolved: boolean;
  /** null when resolved; otherwise the PRECISE reason (never a bare deficit). */
  unresolvedReason: string | null;
  residualFieldDependent: string[];
  derivation: string;
}

/** One of the enumerated resolution options for the deficit, each honestly marked
 *  SELECTED / NOT SELECTED. Rendered on RS-1 as the blocker's resolution menu. */
export interface ProcurementResolutionOption {
  kind: CableExtensionSolution['kind'];
  description: string;
  selected: boolean;
}

/** §Q (2026-07-24) — THE canonical Q-Cable procurement-sufficiency authority. One
 *  object per micro design; PV-4B / BOM / RS-1 / evidence all project it. When
 *  `insufficient` is true and no verified solution clears it, the build emits the
 *  BLOCKING QCABLE-PROCUREMENT-INSUFFICIENT registry entry (carrying `payload`). */
export interface ProcurementSufficiency {
  present: boolean;
  assemblyId: string | null;
  sku: string | null;
  connectorSpacingFt: number | null;
  wasteFactor: number | null;
  perBranch: {
    branchId: string; branchLabel: string; dropCount: number;
    designedInstalledLengthFt: number | null; procurementLengthFt: number | null;
    /** TAC WS-1 — this branch's OWN shortfall (>0) … */
    deficitFt?: number;
    /** … and its own stranded surplus (>0), which can never serve another
     *  branch because each branch is one continuous cable assembly. */
    nonRedistributableSurplusFt?: number;
  }[];
  /** Σ geometric designed-installed cable path (ft) — the installed-length truth. */
  totalDesignedInstalledFt: number | null;
  /** Σ drop-based procurement footage (ft) — the BOM base cable quantity. */
  procurementLengthFt: number | null;
  /** the shown derivation: "Σ drops × pitch × waste = N ft". */
  procurementDerivation: string | null;
  /** honest service-loop/transition allowance (ft). 0 unless a manufacturer/design
   *  rule is recorded in-repo — see allowanceProvenance. */
  requiredServiceLoopAllowanceFt: number;
  /** 'no-allowance-authority-recorded' when 0 (no in-repo Q-Cable allowance rule). */
  allowanceProvenance: string;
  allowanceNote: string;
  /** designed-installed + allowance — the sufficiency threshold. */
  thresholdFt: number | null;
  /** TAC WS-1 — the GOVERNING deficit = max(aggregate, topology-constrained).
   *  Read `deficitBasis` to know WHICH, and print `deficitArithmeticNote`
   *  rather than composing a sentence from the aggregate operands (doing that
   *  produced "152 short of 166.5 by 24.2", which is arithmetically false). */
  deficitFt: number;
  /** designed + allowance − procured. The pure footage subtraction. */
  aggregateFootageDeficitFt: number;
  /** Σ per-branch shortfalls. Exceeds the aggregate figure whenever a
   *  non-short branch holds surplus that cannot be moved to a short one. */
  topologyConstrainedDeficitFt: number;
  /** Σ surplus stranded on non-short branches (a cable assembly is a
   *  continuous run per branch, so this can never offset a shortfall). */
  nonRedistributableSurplusFt: number;
  /** the minimum ADDITIONAL cable that must actually be purchased. */
  requiredAdditionalPurchasableLengthFt: number;
  /** which deficit governs — so no surface mixes the two bases. */
  deficitBasis: 'aggregate-footage' | 'topology-constrained' | 'none';
  /** the exact, deterministic arithmetic for BOTH bases, ready to print. */
  deficitArithmeticNote: string | null;
  /** procurement < designed-installed + allowance. */
  insufficient: boolean;
  affectedBranchIds: string[];
  resolutionOptions: ProcurementResolutionOption[];
  /** ALWAYS null — no manufacturer-documented extension authority is archived. */
  manufacturerDocumentAuthority: null;
  verificationStatus: 'sufficient' | 'insufficient-unresolved' | 'resolved-by-verified-solution'
    /** AAC WS-5 — the measured deficit is covered by an AUTO-ADOPTED order
     *  composition of the SAME listed cable (more connector sections + the
     *  manufacturer's listed sealing caps for the resulting dead drops). Nothing
     *  physical about the design changes; only the ordered quantity. */
    | 'resolved-by-derived-order-composition';
  solutions: CableExtensionSolution[];
  clearedBySolutionId: string | null;
  // ── AAC WS-5 (2026-07-27) — the OPTION EVALUATION. Optional/additive so every
  //    existing construction site and every pre-AAC snapshot serialises
  //    unchanged. ────────────────────────────────────────────────────────────
  /** Σ dropCount × pitch × waste — the drop-count basis the BOM ordered before
   *  the topology engine existed. Present so the two numbers reconcile through
   *  ONE derivation on the artifact itself. */
  dropBasisProcurementLengthFt?: number | null;
  /** the engine's evaluation of the whole option space (never a bare deficit). */
  solutionEvaluation?: QCableSolutionEvaluation | null;
  /** the option the engine ADOPTED (auto-adoptable only), or null. */
  adoptedOptionId?: string | null;
  /** the clearance evaluation of the clearing solution (null when none attempted). */
  clearance: { cleared: boolean; missing: string[]; reasons: string[] } | null;
  provenance: Provenance;
}

/** §5 (07-22) — a code constraint attached to a service-topology object. The
 *  compliance `state` is HONESTLY derived from the object's own length state:
 *  a ≤N-ft rule on an object with an unknown length is 'pending', never 'pass'. */
export interface ServiceTopologyConstraint {
  code: string;                      // e.g. 'NEC-705.11(C)-TAP-10FT'
  description: string;
  limitFt: number | null;           // the numeric limit (null = non-length rule)
  state: 'pass' | 'fail' | 'pending';
}

/** §5 — one canonical object in the supply-/load-side service chain. The tap
 *  point, tap conductors, fused OCPD, utility disconnect, meter and service
 *  disconnect are SEPARATE objects, each with its own (honest) length + rules,
 *  so a sheet can never conflate the ≤10-ft tap-conductor rule with the
 *  downstream feeder run length. Digest-covered. */
export interface ServiceTopologyObject {
  objectId: string;
  type: 'combiner' | 'combiner-load-break' | 'rsd-initiator' | 'tap-point' | 'tap-conductors'
      | 'fused-ocpd' | 'utility-disconnect' | 'meter' | 'service-disconnect';
  label: string;
  description: string | null;
  conductorSpec: string | null;      // where applicable (tap conductors / feeders)
  ocpdRatingA: number | null;        // where applicable (fused OCPD / service disco)
  lengthFt: number | null;           // per-object run length (null ⇒ PENDING)
  lengthSource: 'known-design' | 'cad-derived-estimate' | 'field-measurement' | 'unknown' | 'not-applicable';
  constraints: ServiceTopologyConstraint[];
  // ── §9 (closeout 2026-07-23) PHYSICAL-ORDER GRAPH + DEVICE-ROLE AUTHORITY ──
  /** upstream (PV-source-side) neighbor objectId — proves physical order. */
  upstreamObjectId?: string | null;
  /** downstream (grid-side) neighbor objectId. */
  downstreamObjectId?: string | null;
  /** exact mfr/model when a physical device is selected (else null = PENDING). */
  deviceModel?: string | null;
  /** electrical role in the PV interconnection (e.g. 'overcurrent-protection'). */
  electricalRole?: string | null;
  /** utility role when applicable (e.g. 'utility-accessible-disconnect'). */
  utilityRole?: string | null;
  fusedState?: 'fused' | 'non-fused' | 'not-applicable' | null;
  lockable?: boolean | null;
  rsdRole?: 'initiator' | 'none' | null;
  /** §9 — when TRUE this single LISTED device serves MULTIPLE roles (e.g. the
   *  fused AC disconnect IS the utility-accessible lockable means); the roles it
   *  covers are listed in dualPurposeRoles. Prevents a phantom duplicate device. */
  dualPurposeListing?: boolean | null;
  dualPurposeRoles?: string[] | null;
  provenance: Provenance;
}

export type ParityClassification =
  | 'agree'
  | 'legacy-engine-defect'
  | 'computeSystem-defect'
  | 'missing-input'
  | 'model-definition-difference'
  | 'intentional-supersession';

export interface ParityCheck {
  name: string;
  segmentId: string | null;          // object-level scope, null = project-level
  canonical: string;                 // computeSystem (engine of record)
  legacyShadow: string;              // runElectricalCalc
  agree: boolean;
  classification: ParityClassification;
  resolution: string;                // REQUIRED for every non-agree row
}

// ═══════════════════════════════════════════════════════════════════════════
// W3 — CANONICAL STRUCTURAL / ROOF-LAYOUT / RACKING AUTHORITY
// Every object below is the SOLE authority for its physical fact; sheets project
// it (Phase B). Every object carries Provenance; missing/defaulted authority is
// recorded honestly (never fabricated to pass) and surfaced as a permit blocker.
// ═══════════════════════════════════════════════════════════════════════════

/** Plan-projected 2-D polygon. Coordinates are LOCAL FEET on a plane frame
 *  (module footprints = slope-plane rectangles; roof/setback polygons =
 *  plan-projected). `null` points list ⇒ geometry authority unavailable. */
export interface Polygon2D {
  points: { x: number; y: number }[];
  frame: 'slope-plane-ft' | 'plan-ft' | 'schematic-ft';
}

// ═══════════════════════════════════════════════════════════════════════════
// W3.1 §2 — CANONICAL COORDINATE AUTHORITY
// Every physical object (module footprint, rail, splice, attachment, roof-plane
// polygon, setback/pathway polygon) is expressed in ONE canonical coordinate
// system and carries the transform that maps it into sheet space. There is no
// second frame: the pre-W3.1 split (module polygons in plan-ft while rails /
// attachments lived in an abstract V4 grid) is eliminated — all objects share
// CANONICAL_COORDINATE_SYSTEM_ID. Renderers PLACE objects by applying the
// snapshot-carried transform; they may compute viewport scaling/paper layout
// but may NOT independently geo-register or re-derive positions.
// ═══════════════════════════════════════════════════════════════════════════

/** The ONE canonical coordinate system. Site-plan feet: equirectangular local
 *  feet, origin = array centroid, +x = east, +y = north; plan-projected, NOT
 *  plan-rotated and NOT display-regularized. Modules, rails, attachments,
 *  plane polygons and setbacks all live here. */
export const CANONICAL_COORDINATE_SYSTEM_ID = 'CS-SITE-PLAN-FT';

/** §2 — coordinate provenance stamped on every physical object. */
export interface CoordinateMeta {
  coordinateSystemId: string;       // === CANONICAL_COORDINATE_SYSTEM_ID
  units: 'ft';
  /** how THIS object's coordinate was derived into the canonical frame */
  sourceFrame: 'plan-ft' | 'schematic-ft' | 'slope-plane-ft';
  /** resolves into geometry.drawingTransforms[] (the sheet-registration map) */
  transformId: string;
  transformRevision: string;        // === the referenced transform's revision
  transformProvenance: Provenance;
}

/** §2 — snapshot-carried transform mapping the canonical coordinate system →
 *  the sheet REGISTRATION frame (feet, pre-viewport). The renderer applies this
 *  affine, then its own viewport scale/paper offset; it never geo-registers.
 *  matrix is 2×3: x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export interface DrawingTransform {
  transformId: string;
  revision: string;                 // contentRevision of {matrix, params}
  scope: string;                    // 'site' or a specific planeId
  fromCoordinateSystemId: string;   // === CANONICAL_COORDINATE_SYSTEM_ID
  toFrame: 'registration-ft';
  units: 'ft';
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number };
  params: {
    kind: 'identity' | 'plan-rotation';
    rotationDeg: number;
    pivot: { x: number; y: number };
  };
  /** stable hash of {matrix, params} — the evidence-exposed transform digest;
   *  any parameter change flips this (and, via the snapshot, the design digest). */
  transformDigest: string;
  provenance: Provenance;
}

/** §2 render-parity — a renderer's placement record for ONE physical object.
 *  Produced at RENDER time (not stored on the immutable snapshot); consumed by
 *  the render-parity checker (checkRenderParity) and the evidence harness. */
export interface PlacementEntry {
  objectId: string;
  kind: 'module' | 'rail' | 'attachment' | 'plane' | 'setback' | 'splice';
  /** the canonical coordinate the renderer CONSUMED from the snapshot */
  canonicalXY: { x: number; y: number };
  /** the final sheet-space coordinate the renderer DREW */
  sheetXY: { x: number; y: number };
}

/** §2 — a sheet's full placement manifest (objectId → sheet coords), plus the
 *  viewport affine the renderer applied after the snapshot transform. */
export interface PlacementManifest {
  sheetId: string;
  transformId: string;              // the DrawingTransform the renderer consumed
  /** registration-ft → sheet-px affine (viewport scale/paper); renderer-owned */
  viewport: { a: number; b: number; c: number; d: number; e: number; f: number };
  entries: PlacementEntry[];
}

/** §2 — one canonical module footprint, dims taken EXACTLY from the selected
 *  versioned equipment record (never a generic 66×40). */
export interface ModuleInstance {
  instanceId: string;
  moduleRecordId: string;           // equipment.modules[].recordId
  equipmentCatalogId: string | null;
  equipmentRevision: string;        // content hash of the versioned record — equipment change ⇒ digest change
  widthIn: number; heightIn: number; thicknessIn: number | null;
  orientation: 'portrait' | 'landscape' | null;
  roofPlaneId: string;
  /** RAW canonical footprint (axis-aligned rectangle at the raw placed centroid).
   *  PHYSICAL TRUTH — feeds the area invariant (V21) and Σ-area. */
  polygon: Polygon2D;
  /** §2 — the DISPLAY-straightened drawn footprint: the same raw centroid, but
   *  the rectangle ORIENTED to the plane azimuth and FORESHORTENED up-slope by
   *  cos(pitch) — i.e. the linework the renderer draws. Trace-regularization
   *  lives HERE (in the snapshot build), not in the renderer; the renderer draws
   *  module outlines as viewport∘DT(drawnPolygon). Position/count/adjacency are
   *  unchanged (raw placement) — no panel is moved, dropped or re-placed. */
  drawnPolygon: Polygon2D;
  areaFt2: number;                  // exact catalog footprint (w×h/144) — from `polygon`
  row: number | null; col: number | null;
  clampZones: ('mid' | 'end')[];    // clamp zones on this module's mounting edges
  mountingEdgeOrientation: 'along-rail' | 'across-slope' | null;
  electricalDeviceId: string | null;
  branchId: string | null;
  /** §10 DIRECT-MOUNT ONLY — the canonical attachment objects that directly
   *  support this module (the module frame is the load path; there is no rail
   *  carrying the relation). Undefined on rail-based systems, where the module→
   *  attachment relation is carried by RailObject.supportedModuleIds/attachmentIds.
   *  Kept optional so rail-based ModuleInstance serialization (and its digest) is
   *  unchanged. */
  attachmentIds?: string[];
  coord: CoordinateMeta;            // §2 canonical coordinate authority
  provenance: Provenance;
}

export type RoofEdgeClass = 'eave' | 'ridge' | 'hip' | 'valley' | 'rake' | 'unknown';

/** §3 — canonical roof plane. Setbacks/pathways are CANONICAL POLYGONS from the
 *  slope-space fire-setback engine, never sheet offsets. */
export interface RoofPlaneObject {
  planeId: string;
  polygon: Polygon2D | null;
  pitchDeg: number | null; azimuthDeg: number | null;
  framingDirection: 'up-slope' | 'across-slope' | 'unknown';
  framingSpacingIn: number | null;
  framingVerified: boolean;         // false ⇒ size/spacing/species/span defaulted
  covering: string | null;
  edgeClasses: { edgeIndex: number; class: RoofEdgeClass }[];
  fireSetbackIn: number | null;
  fireSetbackPolygons: Polygon2D[];
  pathwayPolygons: Polygon2D[];
  obstructionPolygons: Polygon2D[];
  usableAreaPolygons: Polygon2D[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  coord: CoordinateMeta;            // §2 canonical coordinate authority
  provenance: Provenance;
}

/** §4 — one versioned racking assembly record. Capacity authority is the
 *  ALLOWABLE from mounting-hardware-db (RT-MINI: 600 lb PE-letter allowable — the
 *  900 lb "ultimate" registry entries are NOT authority; the discrepancy is
 *  recorded in `notes`). */
/** P13 WS-4 — how modules attach to the mount. Rail-paired systems need a rail
 *  SKU; rail-less systems must NEVER have one invented for them. */
export type RackingArchitecture = 'rail-paired' | 'rail-less' | 'unresolved';

/** P13 WS-4 — what the fastener penetrates. The RT-MINI rafter condition is 2
 *  structural wood screws; the DECK condition is a 5-screw pattern with its own
 *  capacity and its own manufacturer instructions. They are different designs
 *  with different authority and may never be shown interchangeably. */
export type AttachmentMode = 'rafter' | 'structural-deck' | 'unresolved';

export interface RackingAssemblyRecord {
  assemblyId: string;
  recordRevision: string;           // content hash — assembly change ⇒ digest change
  mountManufacturer: string; mountModel: string; mountSku: string | null;
  railManufacturer: string | null; railModel: string | null; railSku: string | null;
  // ── P13 WS-4 — the architecture / attachment facts the catalog DOES carry ────
  // These were derivable from mounting-hardware-db all along and were not
  // projected, so downstream surfaces inferred them (or printed a deck-mount
  // instruction the design never made). `mountSku`/`railSku` stay null because no
  // SolarPro source carries an orderable part number — that is a real gap, and it
  // is NOT the same fact as "the mount is unselected".
  architectureType: RackingArchitecture;
  architectureBasis: string | null;
  attachmentMode: AttachmentMode;
  attachmentModeBasis: string | null;
  /** fasteners per mount for the SELECTED attachment mode (rafter 2 / deck 5) */
  fastenersPerMount: number | null;
  /** the manufacturer maximum this design's spacing was taken from */
  attachmentSpacingSourceIn: number | null;
  attachmentSpacingSource: string | null;
  lFootOrAdapter: string | null;
  tBoltFastener: string | null;
  midClamp: string | null; endClamp: string | null; splice: string | null;
  groundingBonding: string | null;
  compatibleModuleThicknessInRange: [number, number] | null;
  /** TAC WS-5 — the manufacturer's COMPATIBLE ROOF COVERING list
   *  ('asphalt_shingle, wood_shake'). A COVERING compatibility statement, NEVER
   *  a structural substrate: nothing may render it as the fastener's embedment
   *  target (the canonical embedment substrate is
   *  `structural.attachments[].substrateMember`). */
  installationCondition: string | null;
  /** the same covering list, structured — display/compatibility only. */
  compatibleRoofCoverings?: string[];
  rafterDeckAttachmentMethod: string | null;
  /** TAC WS-4 — the fastener ELEMENTS (model + count + embedment) are all
   *  present on the mount record. Presence is not verification: an applicable,
   *  evidence-bearing installation document is additionally required, and that
   *  decision is made once in projectFastenerAssemblyFromSnapshot. */
  fastenerElementsComplete?: boolean;
  screwLagModel: string | null; screwLagQtyPerMount: number | null;
  embedmentRequirementIn: number | null;
  pilotHoleRequired: boolean | null;
  // capacity authority (single-sourced)
  publishedCapacityAllowableLbs: number | null;
  capacityBasis: 'allowable' | 'ultimate' | null;
  capacitySource: string | null;    // e.g. 'Roof Tech RT-MINI II PE letter — 613.2 lb weakest assembly'
  datasheetRevision: string | null;
  datasheetSource: string | null;
  ul2703ListingBasis: string | null;
  iccEsReport: string | null;
  mixedManufacturer: boolean;       // rail brand ≠ mount brand (compatible-rail mounts)
  assemblySupported: boolean;       // false ⇒ unsupported mixed assembly → blocker
  provenance: Provenance;
  notes: string[];
}

/** §5 — canonical rail object. BOM rail quantities derive from these. */
export interface RailObject {
  railId: string;
  roofPlaneId: string;
  startXY: { x: number; y: number }; endXY: { x: number; y: number };
  /** §2 — canonical splice-marker coordinates along the rail (in the canonical
   *  frame), one per splice at each stock-section boundary. Drawn from these. */
  splicePointsXY: { x: number; y: number }[];
  physicalLengthIn: number;
  stockLengthIn: number | null;
  spanConfigIn: number | null;
  cantileverIn: number | null;
  spliceCount: number;
  supportedModuleIds: string[];
  attachmentIds: string[];
  manufacturerSpanLimitIn: number | null;
  governingWindSnowZone: string | null;
  utilization: number | null;
  coord: CoordinateMeta;            // §2 canonical coordinate authority (startXY/endXY frame)
  provenance: Provenance;
}

/** §6 — canonical attachment object. Drawing places feet from `xy`; the data
 *  table, structural calc, BOM and drawing all reference `attachmentId`. */
export interface AttachmentObject {
  attachmentId: string;
  railId: string; roofPlaneId: string;
  /** §10 DIRECT-MOUNT ONLY — the module instance this attachment directly
   *  supports (there is no rail; the module frame is the load path). Undefined
   *  on rail-based attachments, whose relation is carried by the rail. Promoted
   *  from the former local AttachmentObjectExt (W4 closer) — digest-neutral: the
   *  field was already serialized on direct-mount attachments. */
  supportedModuleId?: string | null;
  xy: { x: number; y: number };
  roofZone: string | null;            // ASCE C&C zone
  substrateMember: string | null;     // rafter/truss — 'unverified-framing' when defaulted
  attachmentMethod: string | null;
  fastenerModel: string | null; fastenerCount: number | null;
  embedmentIn: number | null;
  tributaryAreaFt2: number | null;
  upliftReactionLbs: number | null;
  downwardReactionLbs: number | null;   // §8 gravity reaction = dead + snow at this attachment
  /** §8 — separated gravity components for the attachment-ID reaction schedule.
   *  deadReactionLbs = added dead-load psf × tributary; snowReactionLbs = roof
   *  snow psf × tributary. downwardReactionLbs = deadReactionLbs + snowReactionLbs. */
  deadReactionLbs: number | null;
  snowReactionLbs: number | null;
  lateralReactionLbs: number | null;
  allowableCapacityLbs: number | null;
  adjustmentFactors: Record<string, number>;
  utilization: number | null;
  safetyFactor: number | null;
  /** W7 — net C&C zone pressure (psf) applied to this attachment's tributary
   *  (the reaction basis). Optional; honest null when no engine pressure. */
  zonePressurePsf?: number | null;
  /** W7 — the design method the reaction/capacity are stated in. Both demand and
   *  allowable are ASD here, so no ASD-vs-strength comparison is ever presented. */
  loadBasis?: 'ASD' | 'LRFD' | null;
  /** W7 — the zone/tributary model label. The uniform corner-zone / full-interior
   *  tributary is a CONSERVATIVE SCREENING ENVELOPE, not an exact per-position
   *  classification — labeled so no reader treats it as the real distribution. */
  zoneModel?: string | null;
  coord: CoordinateMeta;            // §2 canonical coordinate authority (xy frame)
  provenance: Provenance;
}

/** §7 — structural environmental authority. No hardcoded 90/115: values come
 *  from canonical project authority with a recorded source. ASCE edition is
 *  exposed via a code-authority interface; AHJ population is W4. */
export interface StructuralEnv {
  ultimateWindSpeedMph: number | null;
  windSpeedSource: string;
  exposureCategory: string | null;
  riskCategory: string | null;
  groundSnowPsf: number | null;
  roofSnowPsf: number | null;
  buildingHeightFt: number | null;
  componentCladdingZones: string[];
  upliftPressurePsf: number | null;
  downforcePressurePsf: number | null;
  codeAuthority: {
    asceEdition: string | null;
    source: 'ahj-record' | 'pending-w4-ahj-authority' | 'default';
  };
  /** §2 (BAR) — the canonical ENVIRONMENTAL LOAD AUTHORITY record. Operator-entered
   *  wind/snow/exposure are OBSERVATIONS/OVERRIDES, never verified design criteria
   *  without an archived provenance source (mirrors the framing observation-vs-
   *  capacity gate). `verificationStatus` drives ENVIRONMENTAL-LOAD-AUTHORITY-
   *  UNVERIFIED and every sheet prints the values WITH this provenance/state. */
  environmentalLoadAuthority: EnvironmentalLoadAuthority;
  provenance: Provenance;
}

/** §2 (BAR, 2026-07-25) — how an environmental design value was established. An
 *  operator entry is an OBSERVATION/OVERRIDE (never verified authority); a bare
 *  code default is PRELIMINARY only; only an archived, currency-reviewed source is
 *  verified design criteria. */
export type EnvironmentalLoadBasis =
  'verified-source' | 'operator-entered' | 'code-minimum-default' | 'unavailable';
export type EnvironmentalVerificationStatus = 'verified' | 'unverified' | 'unknown';

/** §2 (BAR) — THE canonical environmental load authority. Presence of a value is
 *  NOT authority: `verificationStatus === 'verified'` requires an archived,
 *  currency-reviewed source covering wind + snow + exposure/risk for this project.
 *  On the live design the values are operator-entered ⇒ basis 'operator-entered',
 *  verificationStatus 'unverified', source null — and the values are printed WITH
 *  that state, never as verified design criteria. */
export interface EnvironmentalLoadAuthority {
  // ── wind ──
  ultimateWindSpeedMph: number | null;
  windSpeedBasis: EnvironmentalLoadBasis;
  riskCategory: string | null;
  exposureCategory: string | null;
  // ── snow ──
  groundSnowLoadPsf: number | null;
  snowLoadBasis: EnvironmentalLoadBasis;
  snowLoadSource: string | null;
  // ── location basis the values were (or should be) looked up against ──
  coordinates: { lat: number | null; lng: number | null } | null;
  addressUsed: string | null;
  // ── source document / dataset ──
  sourceDocumentId: string | null;
  sourceDataset: string | null;            // e.g. 'ASCE 7 Hazard Tool', 'AHJ climate ordinance'
  sourceVersionOrDate: string | null;
  lookupTimestampIso: string | null;
  // ── operator overrides (fields the operator posted without a verified source) ──
  operatorOverrides: string[];
  // ── verification ──
  verificationStatus: EnvironmentalVerificationStatus;
  /** the exact project/AHJ this authority record applies to. */
  projectOrAhj: string | null;
  /** archived-evidence reference (documentId/hash) when a verified source exists. */
  evidenceRef: string | null;
  provenance: Provenance;

  // ── AAC WS-4 (2026-07-27) — the directive's EnvironmentalAuthorityRecord field
  //    set, added ADDITIVELY to the record that already existed rather than as a
  //    second record (audit §2.6: "The record model already satisfies WS-4
  //    completely. Do not rebuild the record."). Every field is OPTIONAL and is
  //    OMITTED when no retrieval ran, so canonicalJson drops it and an unresolved
  //    build hashes exactly as before. ─────────────────────────────────────────
  /** SHA-256 of the retrieval payload — the record's own integrity anchor. */
  sourceHash?: string | null;
  /** 0..1 provider confidence in the retrieved values. */
  confidence?: number | null;
  /** the EXACT inputs the hazard services were queried with. */
  queryInputs?: {
    lat: number; lng: number; asceEdition: string; riskCategory: string;
    riskCategorySource: string; riskCategoryBasis: string; siteClass: string; addressUsed: string | null;
  } | null;
  /** the EXACT values the services returned, unrounded and before any override. */
  returnedValues?: {
    windSpeedMph: number | null; windMriYears: number; groundSnowLoadPsf: number | null;
    seismicSdc: string | null; seismicSs: number | null; seismicS1: number | null;
    seismicSds: number | null; seismicSd1: number | null; elevationFt: number | null;
  } | null;
  /** STRUCTURED override history. `operatorOverrides` above stays as the flat
   *  field-name list every existing consumer reads; this is the audited detail:
   *  value, retrieved value (never destroyed), reason, authority source, actor,
   *  timestamp, and whether the operator value was the stricter of the two. */
  overrideHistory?: import('./resolution/environmentalRetrieval').EnvironmentalOverrideEntry[];
  /** why the source is CURRENT (a live read is current by construction; an
   *  archived document needs a recorded review). */
  currencyBasis?: string | null;
  /** live retrieval vs documented fixture replay — stated, never implied. */
  retrievalProof?: 'live-retrieval' | 'fixture' | null;
  /** the durable registry copy of the retrieval, when one could be written. */
  archivedDocumentId?: string | null;
}

export type LimitState =
  | 'attachment-uplift' | 'rail-bending' | 'rail-span' | 'rail-cantilever'
  | 'rafter-bending' | 'rafter-shear' | 'rafter-deflection'
  | 'pile-uplift' | 'fence-overturning' | 'framing-capacity';

/** §9 — one acceptance rule per check. The SAME result projects identically. */
export interface StructuralCheck {
  checkId: string;
  limitState: LimitState;
  demand: number | null;
  capacity: number | null;
  dcRatio: number | null;             // demand / capacity
  safetyFactor: number | null;        // when SF is the acceptance basis
  requiredThreshold: number;
  thresholdKind: 'max-dc-ratio' | 'min-safety-factor';
  passes: boolean | null;             // null ⇒ not verifiable (e.g. framing unverified)
  governingSource: string;
  /** W7 — the explicit load basis this check states, so no reader ever compares
   *  an ASD reaction to a strength pressure. Optional; populated by the snapshot
   *  structural engine. Every field is honest-null when not computable. */
  loadBasis?: {
    designMethod: 'ASD' | 'LRFD';
    windPressureBasis: string | null;   // e.g. 'ASCE 7 §26/29 C&C, governing corner zone (screening envelope)'
    loadCombination: string | null;     // e.g. '0.6D + 0.6W (uplift)'
    zonePressurePsf: number | null;     // net C&C zone pressure applied
    tributaryAreaFt2: number | null;    // tributary the reaction was computed over
    reactionLbs: number | null;         // the demand reaction at this basis
    capacityBasis: string | null;       // e.g. 'ASD allowable (Ω-normalized)' | 'manufacturer max span'
    adjustments: string | null;         // e.g. 'Ω=3.0 ultimate→allowable' | 'n/a (published allowable)'
    tributaryModel: string | null;      // e.g. 'uniform conservative screening envelope (full interior tributary at all mounts)'
  };
  provenance: Provenance;
}

/** FRAMING-AUTHORITY GATE (2026-07-23) — the OBSERVED framing record. Operator-
 *  entered / site-survey / field-measured / photo geometry + material descriptions.
 *  This establishes OBSERVED geometry ONLY; it can NEVER independently verify
 *  framing CAPACITY (Ray's ruling: operator-entered completeness is OBSERVATION,
 *  never capacity authority). `geometryComplete` records field completeness for
 *  provenance — it does NOT mean the framing is capacity-verified. */
export type FramingObservationSource =
  'operator-entered' | 'site-survey' | 'field-measurement' | 'photo-evidence';
export interface FramingObservation {
  source: FramingObservationSource | null;
  framingType: string | null;              // 'truss' | 'rafter' | …
  nominalMemberSizeIn: string | null;      // e.g. '2x6'
  spacingIn: number | null;                // member spacing, inches
  apparentSpeciesGrade: string | null;     // e.g. 'Douglas Fir-Larch'
  measuredSpanFt: number | null;           // clear span, feet
  roofCovering: string | null;
  bearingObservations: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  observer: string | null;                 // honest null when the source is a bare DB row
  observedAtIso: string | null;            // honest null when unrecorded
  evidenceRefs: string[];
  /** true when every geometry field is populated. OBSERVATION completeness ONLY —
   *  never a capacity-verification signal (the whole point of this gate). */
  geometryComplete: boolean;
  provenance: Provenance;
}

/** FRAMING-AUTHORITY GATE — the CAPACITY authority record. A FramingCapacity-
 *  Authority record EXISTS ONLY when a valid, verified capacity source cleared:
 *  either (a) a verified + archived, project-applicable document resolved THROUGH
 *  lib/documents (truss design drawing / manufacturer structural calc / stamped
 *  analysis), or (b) a licensed-engineer review record bound to the CURRENT
 *  snapshot digest. A generic BCSI table, operator-entered dimensions, or assumed
 *  species/grade can NEVER construct one. Presence == verification (`verified`
 *  is always true; a null record ⇒ unverified). */
export type FramingCapacityAuthorityKind = 'archived-document' | 'engineer-review';
export interface FramingCapacityAuthority {
  kind: FramingCapacityAuthorityKind;
  verified: true;
  verifiedAtIso: string | null;
  // ── archived-document path (resolved through lib/documents) ──
  documentId: string | null;
  documentClass: string | null;            // a framing-capacity document class
  documentHash: string | null;             // sha256 of the archived file
  issuer: string | null;
  revisionOrDate: string | null;
  projectApplicability: string | null;     // exact project/building applicability
  memberOrTrussIdentity: string | null;
  designLoads: string | null;
  allowableCapacities: string | null;
  bearingConditions: string | null;
  deflectionLimits: string | null;
  engineerOrManufacturerVerification: string | null;
  // ── engineer-review path ──
  reviewedSnapshotDigest: string | null;   // MUST equal the current snapshot digest
  reviewerName: string | null;
  reviewerLicense: string | null;
  provenance: Provenance;
}

/** §8 — structural engine result computed from the canonical objects. Framing
 *  honesty: when no verified framing CAPACITY authority exists the engine emits
 *  engineeringReviewRequired and NEVER derives a pass from a fabricated truss-
 *  capacity default or from operator-entered geometry (which is observation). */
export interface StructuralEngineResult {
  moduleDeadLoadLbs: number | null;
  rackingDeadLoadLbs: number | null;
  addedDeadLoadPsf: number | null;
  distributedRoofLoadPsf: number | null;
  totalRailLoadLbsPerFt: number | null;
  governingUtilization: number | null;
  governingLimitState: LimitState | null;
  passes: boolean | null;
  engineeringReviewRequired: boolean;
  reviewReasons: string[];
  provenance: Provenance;
}

export interface PermitDesignSnapshot {
  /** W4 §1 — THE canonical AHJ + code-authority record. Every printed code
   *  edition (NEC/IBC/IRC/IFC/ASCE) projects from here (codeAuthorityProjection).
   *  Unknown adoptions are honestly null and drive CODE-AUTHORITY-INCOMPLETE. */
  codeAuthority: CodeAuthorityRecord;

  /** W4 §3/§12 — THE canonical project/cover authority. Every project-facing
   *  value (project name, customer, address, APN, AHJ, utility, system type,
   *  capacities, equipment summary, designer, contractor, engineer-review
   *  status, ISSUE STATUS, revision history, SHEET INDEX, governing-codes ref,
   *  general notes) projects from here (projectAuthorityProjection). The issue
   *  state is derived from permitReadiness blockers by domain + the review
   *  record; the sheet index is the ACTUAL generated manifest. */
  projectAuthority: ProjectAuthorityRecord;

  meta: {
    snapshotId: string;             // content-derived: 'PDS-' + digest prefix
    digest: string;                 // SHA-256 hex of canonical JSON (digest+snapshotId excluded)
    schemaVersion: string;
    engineVersion: string;
    generatedAtIso: string;
    projectId: string | null;
    designVersionId: string | null;
  };

  /** Req. 6: raw source inputs preserved verbatim (client-posted values that
   *  are PROVENANCE ONLY, never authority — D-3). */
  sourceInputs: {
    clientElectrical: unknown | null;   // client-posted compliance.electrical
    clientBackfeedBreakerA: number | null;
    clientWireGauge: string | null;
    clientTotals: { totalPanels: number | null; totalDcKw: number | null; totalAcKw: number | null };
  };

  project: {
    clientName: string | null;
    address: string | null;
    parcelApn: string | null;
    lat: number | null; lng: number | null;
    utility: { name: string | null; id: string | null };
    ahj: {
      name: string | null;
      adoptedCodes: { nec: string; ibc: string; irc: string; ifc: string; asce: string };
      codesSource: 'ahj-record' | 'default';   // 'default' ⇒ UNVERIFIED marker (V11, W4)
      localAmendments: string[];
      recordCapturedAtIso: string;
    };
    interconnection: { method: string; rule: '705.12(B)' | '705.11' };
    /** W4 §1 — reference to the canonical code-authority record's edition
     *  projection. adoptedCodes are DERIVED from snapshot.codeAuthority (single
     *  source); a null adoption prints '—'/PENDING, never a fabricated year. */
    thermal: {
      designTempMinC: number; designTempHighC: number; rooftopAdderC: number;
      source: string;
      provenance: Provenance;
    };
    provenance: Provenance;
  };

  equipment: {
    modules: EquipmentRecord<ModuleSpec>[];
    microInverters: EquipmentRecord<MicroInverterSpec>[];
    stringInverters: EquipmentRecord<StringInverterSpec>[];
    mount: EquipmentRecord<MountSpec> | null;
    rail: EquipmentRecord<RailSpec> | null;
    combinerLabel: string | null;   // resolved BOS brains (record upgrade in W5)
  };

  geometry: {
    roofPlanes: { planeId: string; pitchDeg: number | null; azimuthDeg: number | null;
                  moduleCount: number }[];
    modules: { moduleId: string; planeKey: string; moduleRecordId: string;
               lat: number | null; lng: number | null; row: number | null; col: number | null;
               orientation: string | null }[];
    /** W3 §2 — canonical module footprints (exact catalog dims × placement). */
    moduleInstances: ModuleInstance[];
    /** W3 §3 — canonical roof planes with setback/pathway polygons. */
    roofPlaneObjects: RoofPlaneObject[];
    /** W3.1 §2 — the ONE canonical coordinate system every physical object is
     *  expressed in. */
    coordinateSystem: { id: string; units: 'ft'; description: string };
    /** W3.1 §2 — snapshot-carried transforms mapping the canonical frame → sheet
     *  registration space (matrix + params + transformDigest). Renderers apply
     *  these; they never geo-register independently. */
    drawingTransforms: DrawingTransform[];
    provenance: Provenance;
    gaps: string[];                 // e.g. 'setback polygons not snapshot-owned until W3'
  };

  electrical: {
    topology: 'MICRO' | 'STRING' | 'OPTIMIZER' | 'HYBRID';
    engineOfRecord: string;         // D-2: 'runElectricalCalc' now; computeSystem after parity
    microInverterUnits: { deviceId: string; moduleId: string; inverterRecordId: string; branchId: string }[];
    branches: BranchRecord[];
    conductors: ConductorRecord[];
    feeder: { conductorId: string; ocpdA: number | null; continuousA: number | null;
              currentA: number | null; voltageDropPct: number | null;
              conduit: { raceway: string | null; tradeSizeIn: string | null; fillPct: number | null } };
    /** W2.1: per-purpose grounding objects — replaces the retired
     *  "system EGC" abstraction entirely. */
    groundingObjects: GroundingRecord[];
    /** W2.1: canonical route-length + per-segment conductor authority
     *  (computeSystem runs — sheets/engines may not substitute lengths). */
    routeSegments: RouteSegmentRecord[];
    /** §3/§4/§6 (closeout 07-23): every PHYSICAL raceway as a first-class object.
     *  The shared branch home-run appears ONCE (sharedCircuitCount>1). Optional
     *  so pre-closeout snapshots/digests are unchanged until the build populates. */
    physicalRaceways?: PhysicalRacewayRecord[];
    /** §6 (closeout 07-23): the canonical LISTED CABLE ASSEMBLY (micro AC trunk).
     *  Null for non-micro topologies / unknown trunk brand. Sheets project this
     *  instead of a generic #12 THWN row for the open-air branch section. */
    listedCableAssembly?: ListedCableAssembly | null;
    /** §7 (closeout 07-23): per-branch geometric cable-path objects. BOM sums
     *  them; PV-4B/SCHED/evidence reconcile against them. Empty when no coords. */
    branchCablePaths?: BranchCablePath[];
    /** §Q (2026-07-24): Q-Cable procurement-sufficiency authority. When
     *  `insufficient` and unresolved, the build emits the BLOCKING
     *  QCABLE-PROCUREMENT-INSUFFICIENT registry entry. Null for non-micro. */
    procurementSufficiency?: ProcurementSufficiency | null;
    /** AAC WS-5 (2026-07-27): THE deterministic Q-Cable topology object — ordered
     *  drops, inter-module segments, row/array transitions, cable ends, dead
     *  drops, installed vs procurement length, geometry coverage and the
     *  field-dependent portion. Procurement, the BOM trunk/terminator/cap rows
     *  and every sheet length CONSUME it (one derivation). Null for non-micro /
     *  unknown trunk brand. */
    qcableTopology?: QCableTopology | null;
    /** WS-2 — THE canonical procurement design (installed vs purchased vs
     *  remainder, branch allocation, accessories). Renderers PROJECT this; no
     *  sheet recalculates a purchase. */
    qcableProcurement?: import('./qcableProcurement').QCableProcurementResolution | null;
    /** AAC WS-7 (2026-07-27): the COMPUTED NEC Chapter 9 Table 1 conduit-fill
     *  authority for the canonical feeder raceway — raceway identity, conductor
     *  set, insulation, adopted code edition, the percentage and the ≤40 %
     *  verdict. `state:'incomplete'` names the missing input instead of a silent
     *  null (which is what fired CONDUIT-FILL-PENDING on a calculation that had
     *  already run). Null when no canonical engine result exists. */
    conduitFillAuthority?: import('./conduitFillAuthority').ConduitFillAuthorityRecord | null;
    /** GROUNDING AUTHORITY CORRECTION (2026-07-25): THE canonical, DOCUMENT-BASED
     *  three-outcome grounding authority for the OPEN-AIR microinverter branch /
     *  listed-cable-assembly section ONLY. Conductor count can never select an
     *  outcome; without a verified, exactly-applicable manufacturer document the
     *  outcome is PENDING_MANUFACTURER_AUTHORITY and the BLOCKING
     *  QCABLE-GROUNDING-AUTHORITY-UNVERIFIED registry entry fires. Null for
     *  non-micro / no modeled open-air branch grounding. */
    openAirGroundingAuthority?: GroundingAuthorityResult | null;
    /** ECD §5 (W1-F, 2026-07-26): THE supply-side tap CONNECTION authority. The
     *  Polaris IPLD350-3 rows carried their own caveat as prose ("Verify lug
     *  range against actual service conductor size") with no object behind it,
     *  while being counted as orderable. This record holds the facts that caveat
     *  is about — honestly null while unknown. Null for non-supply-side designs. */
    supplySideTapConnection?: SupplySideTapConnectionAuthority | null;
    /** §5 SEPARATION: the five DISTINCT grounding/bonding domains as explicit
     *  objects (open-air branch cable section, in-raceway home-run EGC, racking /
     *  module-frame bonding, GEC, service bonding). The open-air grounding outcome
     *  governs exactly ONE of them — no domain inherits another's result. */
    groundingDomainGraph?: GroundingDomainNode[];
    /** §5 (07-22): canonical service-interconnection objects (tap point, tap
     *  conductors, fused OCPD, utility disconnect, meter, service disconnect) —
     *  each with its OWN honest length + attached code rules. Supply-side designs
     *  MUST carry the full chain (V42). Sheets project these; they do not restate. */
    serviceTopology: ServiceTopologyObject[];
    poi: { method: string; busbarA: number | null; mainBreakerA: number | null;
           backfeedA: number | null; rulePasses: boolean | null };
    parity: {                       // W2.1: canonical=computeSystem vs legacy shadow
      legacyEngine: string; legacyRan: boolean;
      checks: ParityCheck[];
      unresolved: string[];         // MUST be empty for permit-critical rows
    };
    provenance: Provenance;
    gaps: string[];
  };

  structural: {
    mountRecordId: string | null;
    attachmentCount: number | null;
    attachmentSpacingIn: number | null;     // engine-RESOLVED spacing
    railTotalFt: number | null;
    railCount: number | null; spliceCount: number | null;
    loads: { windSpeedMph: number | null; exposure: string | null; snowPsf: number | null;
             source: string };
    governing: { utilization: number | null; safetyFactor: number | null; passes: boolean | null };
    // ── W3 canonical structural authority (§4–§9) ──────────────────────────
    rackingAssembly: RackingAssemblyRecord | null;
    /** ECD §7 — the canonical bonding REQUIREMENT-vs-METHOD authority. Every
     *  sheet that says anything about bonding projects THIS (see
     *  lib/permit/snapshot/rackingBonding.ts). */
    rackingBonding: RackingBondingAuthority;
    rails: RailObject[];
    attachments: AttachmentObject[];
    env: StructuralEnv;
    checks: StructuralCheck[];
    engine: StructuralEngineResult;
    // ── FRAMING-AUTHORITY GATE (2026-07-23) ─────────────────────────────────
    /** The OBSERVED framing record (operator-entered / surveyed geometry). Never
     *  a capacity-verification signal on its own. Null when no observation exists. */
    framingObservation: FramingObservation | null;
    /** The verified framing CAPACITY authority (archived project-applicable
     *  document via lib/documents, OR a digest-bound licensed-engineer review).
     *  Null ⇒ capacity UNVERIFIED ⇒ FRAMING-AUTHORITY-UNVERIFIED fires and the
     *  framing check renders PRELIMINARY / NON-AUTHORITATIVE (passes:null). */
    framingCapacityAuthority: FramingCapacityAuthority | null;
    // ── W3 §10 — structural BOM derived FROM the objects above ──────────────
    /** Every structural/racking BOM row, quantity traceable to module/rail/
     *  attachment objects (source IDs or auditable aggregation). SOLE quantity
     *  source; the three producers project these. */
    bom: StructuralBomRow[];
    /** §10 reconciliation report (rails/mounts/splices/clamps/fasteners/bonding
     *  vs the objects and the V4 producer). `ok:false` ⇒ V10 blocking. */
    bomReconciliation: StructuralBomReconciliation;
    /** §8 attachment-reaction reconciliation: object count vs the engine reaction
     *  model, Σ tributary areas vs the canonical array footprint, and Σ uplift /
     *  snow / dead reactions vs applied load × area (per limit state). `ok:false`
     *  ⇒ a blocking permit-readiness gap (reactions not traceable to the load). */
    reactionReconciliation: StructuralReactionReconciliation;
    provenance: Provenance;
    gaps: string[];                 // e.g. 'attachment coordinates not derived (W3)'
  };

  derived: {
    moduleCount: number;
    dcWattsStc: number;             // Σ module record wattsStc over geometry.modules
    acWattsContinuous: number;      // Σ inverter continuous outputs
    branchCount: number;
    feederContinuousA: number | null;
    provenance: Provenance;
  };

  certification: {
    engineeringReviewApproved: false | { reviewedDigest: string; approvedAtIso: string };
    engineer: { name: string; licenseNo: string; licenseState: string;
                expiresIso: string; sealAssetId: string } | null;
  };

  /** W2.1 req. 3/7: unresolved authority gaps BLOCK permit-ready status —
   *  never silently degraded. (Distinct from validation violations: these are
   *  known-missing authorities, e.g. no true routed geometry, unreconciled
   *  stored equipment identity.)
   *
   *  W10 (RP-D): `registry` is the CANONICAL structured record of every active
   *  release blocker (blocking + advisory). `blockers` is the back-compat
   *  code/string list — SINGLE-SOURCED from the registry's BLOCKING entries so
   *  the many existing code-string consumers (issue-state derivation, gates,
   *  banners) keep working byte-identically while renderers surface the full
   *  registry (RS-1 review-status sheet + the union banners).
   *
   *  RGM §9 (2026-07-26): the HIERARCHICAL RELEASE-GATE MODEL — seven ROOT release
   *  gates that CONTAIN these individual requirements — is a DETERMINISTIC
   *  PROJECTION of this registry, NOT a stored field. `releaseGates`,
   *  `releaseRequirements`, `releaseSummary` and `readinessAxes` are obtained
   *  through `releaseGates.projectReleaseGates(snapshot)` /
   *  `projectReleaseGatesFromInput(input)` — the same read-accessor pattern as
   *  codeAuthorityProjection / structuralProjection / projectIssueStateLanguage.
   *  Projecting at read keeps `blockers` + `registry` byte-identical and leaves the
   *  snapshot digest untouched (verified: the frozen Braidon fixture still hashes to
   *  PDS-09765A24D723), so the gate model implies no DB migration and cannot
   *  invalidate a digest-bound engineering approval. */
  permitReadiness: {
    ready: boolean;
    blockers: { code: string; message: string }[];
    registry: PermitReadinessBlocker[];
  };

  /** AAC WS-9 — THE equipment-document applicability verdicts, decided ONCE in
   *  the pure build and projected by every sheet.
   *
   *  Retires the WS-9 violation the audit found (§7.12): five renderer files
   *  independently re-deciding document applicability inside the render pass,
   *  each with its own selected-model argument and every one of them passing
   *  `null` for the registry facts — which is what made the AUTHORITATIVE
   *  verdict structurally unreachable (§7.7). One determination, real facts,
   *  frozen with the snapshot. */
  equipmentDocumentAuthority: import('./documentAuthority').EquipmentDocumentAuthority;

  /** AAC WS-2 / WS-6 — the AUTOMATIC-RESOLUTION AUTHORITIES.
   *
   *  A requirement that the resolver lifecycle CLEARED produces no blocker, so
   *  its evidence would otherwise vanish from the artifact. These records are the
   *  evidence-per-auto-cleared-requirement the directive demands: the canonical
   *  equipment identity with its superseded audit history and the reconciliation
   *  audit id, the per-module exact-datasheet coverage + the registry binding
   *  attempt, and the configured personnel roles (designer only — never an EOR,
   *  licence, signature or seal).
   *
   *  OPTIONAL and OMITTED when no lifecycle resolved anything (harness / test /
   *  DB-unavailable run): canonicalJson drops undefined, so the snapshot digest
   *  of an unresolved build is byte-identical to the pre-AAC-2 digest. When a
   *  reconciliation DOES occur the digest legitimately moves — that is exactly
   *  what snapshot_digest_invalidations records. */
  resolutionAuthority?: {
    canonicalEquipment: import('./resolution/equipmentSelection').CanonicalEquipmentAuthority | null;
    moduleDatasheetBinding: import('./resolution/datasheetBinding').ModuleDatasheetBindingAuthority | null;
    projectPersonnel: import('@/lib/personnel/types').ProjectPersonnelAuthority | null;
    /** AAC WS-3 — the project's LEGAL identity retrieved from an official source
     *  (normalised address, parcel/APN, county + FIPS, municipal boundary), with
     *  per-field verification states, the boundary evidence sentence, the exact
     *  endpoints queried, the retrieval timestamp, a payload SHA-256 and a
     *  confidence. THE evidence for a cleared PROJECT-AUTHORITY-UNVERIFIED. */
    projectLegalAuthority?: import('./resolution/jurisdictionAuthority').ProjectLegalAuthorityRecord | null;
    /** AAC WS-3 — the ADOPTED code editions (NEC/IBC/IRC/IFC) retrieved from the
     *  AHJ registry, each with the registry field it came from, the raw
     *  enumeration, its corroborator and any conflicting source. THE evidence for
     *  a cleared CODE-AUTHORITY-INCOMPLETE. */
    codeAdoptionAuthority?: import('./resolution/jurisdictionAuthority').CodeAdoptionAuthorityRecord | null;
    /** AAC WS-4 — the climate-hazard RETRIEVAL record: query inputs (coordinates,
     *  ASCE edition, risk category + its basis, site class), returned values
     *  (wind, snow, seismic, elevation), every dataset with its endpoint, the
     *  exposure basis, the override history (originals preserved) and the
     *  registry-archival state. THE evidence for a cleared
     *  ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED. */
    environmentalRetrieval?: import('./resolution/environmentalRetrieval').EnvironmentalRetrievalRecord | null;
    /** AAC WS-8 — the published-document RETRIEVAL record: every source
     *  attempted with its exact HTTP outcome, the content hash of what came
     *  back, the archival result, whether the document covers the SELECTED
     *  model, and the cross-reference research finding that explains why no
     *  alias was created. THE evidence for the racking document requirements —
     *  and, when one legitimately remains, for exactly why. */
    structuralDocumentRetrieval?: import('./resolution/structuralDocuments').StructuralDocumentRetrievalRecord | null;
    /** AAC WS-8 — the rail-selection trace: which stores were probed for a rail
     *  and what each held, whether the rail is inherent in the mount product or
     *  genuinely unselected, and the span-screened candidate shortlist that
     *  bounds the operator's remaining pick to ONE choice. */
    rackingAssemblySelection?: import('./resolution/railSelection').RailSelectionVerdict | null;
    /** AAC WS-8 — the framing-capacity retrieval ATTEMPT and its honest
     *  AUTO_RETRIEVED → PROFESSIONAL_APPROVAL mode transition, with the reason
     *  each document class is not publicly obtainable for this building. */
    framingRetrieval?: import('./resolution/types').SnapshotAuthorityInputs['framingRetrieval'];
    /** AAC WS-9 — the digest-bound engineering-review coverage read from
     *  migration 116: who approved, under which licence, for which digest. */
    engineeringReview?: import('@/lib/engineeringReview/types').EngineeringReviewCoverage | null;
  };
}

/** W10 (RP-D) — a canonical, structured permit-readiness blocker. Every release
 *  blocker (electrical, structural, code, project/document, equipment-identity,
 *  equipment/document, electrical-PENDING, project-identity) is emitted as one
 *  of these into `permitReadiness.registry`, so the rendered package can surface
 *  ALL of them (never the structural-else-everything ternary that hid the
 *  REC-405-vs-Qcells-400 conflict + the code/tap/fill/identity blockers). */
export interface PermitReadinessBlocker {
  /** stable machine code, e.g. 'EQUIPMENT-IDENTITY-CONFLICT'. */
  code: string;
  /** blocking = prevents permit-ready / issue; warning = advisory (surfaced, not gating). */
  severity: 'blocking' | 'warning';
  /** §17 severity policy — the written justification REQUIRED for any ADVISORY
   *  classification (why the missing fact cannot affect safety, code compliance,
   *  procurement, engineering approval, or permit acceptance). Empty string for
   *  BLOCKING entries. Rendered on RS-1. Single-sourced from severityPolicy.ts. */
  justification: string;
  /** authority domain (electrical/structural/code/equipment/document/review/other). */
  domain: string;
  /** the authority record / path whose gap this represents. */
  authorityPath: string;
  /** sheets whose rendered content is affected / must show the PENDING state. */
  affectedSheets: string[];
  /** human-readable explanation (also used as the back-compat `message`). */
  explanation: string;
  /** the concrete action that resolves the blocker. */
  resolutionAction: string;
  /** OPTIONAL structured payload for blockers that carry machine-readable detail
   *  beyond the human explanation (e.g. QCABLE-PROCUREMENT-INSUFFICIENT: SKU,
   *  spacing, per-branch paths, procurement derivation, deficit, resolution
   *  options, verification status). Rendered on RS-1; consumed by the evidence
   *  harness. Null for blockers with no structured payload. */
  payload?: Record<string, unknown> | null;
  /** where the blocker was detected. */
  provenance: { source: string; ref: string | null };
  /** snapshot generation time (meta.generatedAtIso) — NOT Date.now (pure/digest-safe). */
  createdAtIso: string;
  /** engine version that emitted it (meta.engineVersion). */
  createdVersion: string;
  /** always false at build (no in-pipeline reconciliation path); an operator
   *  workflow / migration flips it with a resolutionAuditRef. */
  resolved: boolean;
  /** audit reference for the resolution (null until resolved). */
  resolutionAuditRef: string | null;
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ ECD WS-1 ADDITIVE TYPES REGION — BEGIN (procurement authority, 07-26)     ║
// ║ Owned by WS-1 (BOM/procurement). WS-2's authority types go in the WS-2    ║
// ║ region immediately below this one — do not interleave.                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/** ECD §5 — the tap-connection facts a supply-side connector row's orderability
 *  actually depends on. Every field is HONESTLY NULL while unknown: the existing
 *  service-entrance conductors have not been surveyed on this project, so the
 *  connector cannot be a verified selection and the row cannot be orderable.
 *  Nothing here is ever inferred from a product name or a service ampacity. */
export interface SupplySideTapConnectionAuthority {
  /** the design's interconnection method this record belongs to. */
  interconnectionMethod: string;
  // ── the EXISTING service conductors the connector must land on ────────────
  existingServiceConductorMaterial: 'Cu' | 'Al' | null;
  /** e.g. '4/0 AWG', '350 kcmil'. null ⇒ NOT SURVEYED. */
  existingServiceConductorSize: string | null;
  existingServiceConductorInsulation: string | null;
  /** how many ungrounded + grounded conductors the tap lands on (L1/L2/N = 3). */
  existingServiceConductorCount: number | null;
  /** how the sizes above were established ('field-survey' | 'utility-record' |
   *  … ). null ⇒ nothing established them. */
  existingServiceConductorSource: string | null;
  // ── the TAP conductors leaving the connector ──────────────────────────────
  tapConductorMaterial: 'Cu' | 'Al' | null;
  tapConductorSize: string | null;
  /** NEC 705.11(C) ≤10 ft verification — the measured length, null while
   *  TAP-CONDUCTOR-LENGTH-PENDING is open. */
  tapConductorLengthFt: number | null;
  tapConductorLengthAuthority: string | null;
  // ── the CANDIDATE connector product ───────────────────────────────────────
  connectorManufacturer: string | null;
  connectorSku: string | null;
  /** the connector's LISTED conductor range, verbatim from its listing. */
  listedConductorRange: string | null;
  /** number of ports/taps the connector provides. */
  connectorPorts: number | null;
  /** does the listed range cover the EXISTING service conductor? null ⇒ cannot
   *  be evaluated because the existing conductor is unknown. NEVER default true. */
  lugRangeCompatibility: boolean | null;
  enclosureCompatibility: boolean | null;
  installationSpaceVerified: boolean | null;
  connectionMethod: string | null;
  /** the manufacturer document / listing evidence backing the above. */
  manufacturerDocumentId: string | null;
  listingEvidence: string | null;
  // ── the resulting verification state ──────────────────────────────────────
  verificationStatus: 'verified' | 'unverified';
  /** every fact that is missing, enumerated (rendered, never summarized away). */
  unresolvedFacts: string[];
  /** the ONE rendered label for the connector row while unverified. */
  candidateLabel: string;
  provenance: Provenance;
}

/** ECD §5 — the ONE rendered label for an unverified supply-side tap connector.
 *  Every sheet/row/export reads this constant; no renderer may re-word it. */
export const SUPPLY_SIDE_TAP_CANDIDATE_LABEL =
  'CANDIDATE CONNECTOR — VERIFY EXISTING SERVICE CONDUCTOR AND LUG COMPATIBILITY';

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ ECD WS-1 ADDITIVE TYPES REGION — END                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ ECD WS-2 ADDITIVE TYPES REGION — BEGIN (reserved: RackingBondingAuthority,║
// ║ widened DocumentApplicability). WS-2 appends here.                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/** ECD §7 — the three possible BONDING-METHOD outcomes.
 *
 *  INTEGRATED_LISTED_BONDING_VERIFIED   the exact selected assembly is listed to
 *                                       UL 2703 with INTEGRATED bonding, and the
 *                                       listing covers the selected module frame
 *                                       + rail/mount. Only then may a sheet say
 *                                       "UL 2703 INTEGRATED".
 *  SEPARATE_BONDING_COMPONENTS_VERIFIED bonding is achieved by SELECTED, verified
 *                                       separate components (WEEB / jumper / lug).
 *                                       Only then may a sheet name a jumper.
 *  METHOD_PENDING_ASSEMBLY_SELECTION    the bonding REQUIREMENT stands, but no
 *                                       verified exact assembly establishes the
 *                                       METHOD. Nothing about the method renders.
 */
export type RackingBondingResult =
  | 'INTEGRATED_LISTED_BONDING_VERIFIED'
  | 'SEPARATE_BONDING_COMPONENTS_VERIFIED'
  | 'METHOD_PENDING_ASSEMBLY_SELECTION';

/** ECD §7 — the canonical RACKING BONDING authority.
 *
 *  The defect this retires: PV-3's FASTENER & HARDWARE SCHEDULE printed the
 *  renderer-local literal `['BONDING', 'UL 2703 INTEGRATED — NEC 690.43']` in
 *  BOTH the verified-assembly branch AND the assembly-PENDING branch — on the same
 *  table that says FASTENER ASSEMBLY: PENDING VERIFIED SELECTION and
 *  EMBEDMENT / TORQUE / PILOT: WITHHELD — NO VERIFIED SOURCE. Three companion
 *  literals said the same thing elsewhere (a "BONDING JUMPER" callout, a
 *  "MODULE RAIL — BONDED (UL 2703)" SVG label, and an APP-A "UL 2703" listing
 *  row that fail-OPEN defaulted to UL 2703 unless a flag said otherwise). None of
 *  them consulted any authority.
 *
 *  The REQUIREMENT (bond module frames + racking per NEC 250.134 / 690.43) is
 *  code, is always true for a metal racking system, and is preserved verbatim.
 *  What is gated is the METHOD: the specific listing/components that satisfy it.
 *
 *  Every field is an honest null while pending — nothing here is inferred from a
 *  product NAME (the standing rule), and no bonding component is invented. */
export interface RackingBondingAuthority {
  /** the bonding REQUIREMENT (NEC) — independent of the method. */
  bondingRequired: boolean;
  /** the code basis of the REQUIREMENT (always stated, never gated). */
  requirementCodeBasis: string;
  /** the resolved method outcome. */
  result: RackingBondingResult;
  /** 'integrated-listed' | 'separate-components' | null while pending. */
  bondingMethod: 'integrated-listed' | 'separate-components' | null;
  /** the exact assembly the method is established FOR (null ⇒ none selected). */
  selectedAssemblyId: string | null;
  /** the exact bonding components selected + verified (empty while pending). */
  selectedBondingComponents: string[];
  /** the UL 2703 listing source that establishes INTEGRATED bonding, or null.
   *  A product's marketing claim is not a listing source. */
  ul2703ListingSource: string | null;
  /** the manufacturer document the method is read from (null ⇒ none applicable). */
  manufacturerDocument: string | null;
  /** ECD §8 document state of that manufacturer document (null ⇒ no document). */
  documentApplicabilityState: string | null;
  /** whether that document is APPLICABLE to the selected products. */
  documentApplicable: boolean;
  /** the module frame the listing is verified against (null ⇒ not established). */
  compatibleModuleFrame: string | null;
  /** the rail / mount the listing is verified against (null ⇒ not established). */
  compatibleRailOrMount: string | null;
  /** honest tri-state verification of the METHOD. */
  verificationState: 'verified' | 'pending' | 'unverified';
  /** the BOM rows that carry the bonding material, when any are orderable. */
  bomLineIds: string[];
  /** the ONE line every sheet prints for the METHOD (never a literal). */
  methodLabel: string;
  /** short form for dense schedules. */
  methodShortLabel: string;
  /** the shortest form (in-drawing SVG labels, ≤32 chars) — same meaning. */
  methodCompactLabel: string;
  /** the ONE line every sheet prints for the REQUIREMENT. */
  requirementLabel: string;
  /** why the result is what it is (the reasons, in order). */
  reasons: string[];
  provenance: Provenance;
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ ECD WS-2 ADDITIVE TYPES REGION — END                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
// NOTE (ECD §8): the WIDENED `DocumentApplicability` (7 document states) lives
// with its evaluator in `lib/manufacturer-assets-db.ts` — the module that owns
// the asset library and the applicability logic — rather than being split from
// it here. See DOCUMENT_APPLICABILITY_STATES there.

export interface SnapshotViolation {
  invariant: string;                // 'V5a'
  authorityPath: string;            // 'electrical.branches[2].ocpdA'
  offendingValue: unknown;
  sourceRecord: string;             // record/engine that produced the value
  affectedProjections: string[];    // sheets that would print it
  message: string;
  enforcement: 'blocking' | 'deferred';  // deferred = measured by evidence until its wave lands
}
