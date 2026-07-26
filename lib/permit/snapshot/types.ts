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
export interface GroundingRecord {
  groundingId: string;
  segmentId: string;                 // canonical run/segment this applies to
  purpose: 'branch-egc' | 'feeder-egc' | 'raceway-bond' | 'gec' | 'integrated-listed-method';
  required: boolean;                 // false ⇒ explicitly not required (with basis)
  method: 'conductor' | 'raceway' | 'integrated-listed' | 'none-required';
  conductorMaterial: 'Cu' | 'Al' | null;
  conductorSize: string | null;      // null when method !== 'conductor'
  sizingBasis: string | null;        // e.g. 'NEC 250.122 @ 20A OCPD'
  associatedOcpdA: number | null;
  associatedEquipment: string | null;
  manufacturerListingBasis: string | null;  // record ref when integrated-listed
  codeBasis: string;                 // e.g. 'NEC 250.122', 'NEC 250.118(4)'
  provenance: Provenance;
}

/** W1 §route-verification — the five allowed states for a run's length/route
 *  evidence. An estimate can NEVER be presented as field-verified (gate 2). */
export type RouteVerificationState =
  | 'unverified-estimate'
  | 'cad-derived-estimate'
  | 'field-measured'
  | 'field-verified'
  | 'as-built-verified';

/** W2.1 / W1 — canonical route-length + per-segment electrical authority: every
 *  physically distinct electrical section is a segment with ONE authoritative
 *  length, its OWN currents (operating / continuous / calculated SEPARATED from
 *  the OCPD rating), temperature basis, derating, installation method and
 *  verification status. Every sheet PROJECTS these fields; no sheet re-derives
 *  conductor/conduit/length/fill/VD/current for a given segmentId. Fields added
 *  in the 07-22 repair pass are optional so existing serialization/digest is
 *  unchanged until the build populates them. */
export interface RouteSegmentRecord {
  segmentId: string;                 // engine RunSegment id (e.g. 'COMBINER_TO_DISCO_RUN')
  from: string; to: string;
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
  /** W1 — temperature basis for ampacity derate (ambient + rooftop adder). */
  ambientTempC?: number | null;
  rooftopAdderC?: number | null;
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
  /** max(0, threshold − procurement). >0 ⇒ short. */
  deficitFt: number;
  /** procurement < designed-installed + allowance. */
  insufficient: boolean;
  affectedBranchIds: string[];
  resolutionOptions: ProcurementResolutionOption[];
  /** ALWAYS null — no manufacturer-documented extension authority is archived. */
  manufacturerDocumentAuthority: null;
  verificationStatus: 'sufficient' | 'insufficient-unresolved' | 'resolved-by-verified-solution';
  solutions: CableExtensionSolution[];
  clearedBySolutionId: string | null;
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
export interface RackingAssemblyRecord {
  assemblyId: string;
  recordRevision: string;           // content hash — assembly change ⇒ digest change
  mountManufacturer: string; mountModel: string; mountSku: string | null;
  railManufacturer: string | null; railModel: string | null; railSku: string | null;
  lFootOrAdapter: string | null;
  tBoltFastener: string | null;
  midClamp: string | null; endClamp: string | null; splice: string | null;
  groundingBonding: string | null;
  compatibleModuleThicknessInRange: [number, number] | null;
  installationCondition: string | null;   // roof type / substrate condition
  rafterDeckAttachmentMethod: string | null;
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
   *  registry (RS-1 review-status sheet + the union banners). */
  permitReadiness: {
    ready: boolean;
    blockers: { code: string; message: string }[];
    registry: PermitReadinessBlocker[];
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

export interface SnapshotViolation {
  invariant: string;                // 'V5a'
  authorityPath: string;            // 'electrical.branches[2].ocpdA'
  offendingValue: unknown;
  sourceRecord: string;             // record/engine that produced the value
  affectedProjections: string[];    // sheets that would print it
  message: string;
  enforcement: 'blocking' | 'deferred';  // deferred = measured by evidence until its wave lands
}
