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

/** W2.1 — canonical route-length authority: every electrical run is a
 *  segment with ONE authoritative length and a recorded source. */
export interface RouteSegmentRecord {
  segmentId: string;                 // engine RunSegment id (e.g. 'COMBINER_TO_DISCO_RUN')
  from: string; to: string;
  oneWayFt: number | null;
  lengthSource: 'cad-route' | 'cad-derived-estimate' | 'field-measurement' | 'operator-entry' | 'unknown';
  raceway: string | null;            // 'EMT' | 'PVC' | 'FREE_AIR' …
  tradeSizeIn: string | null;
  fillPct: number | null;
  conductorGauge: string | null;
  conductorCallout: string | null;
  egcGauge: string | null;           // the EGC carried IN this segment, if any
  voltageDropPct: number | null;
  ocpdA: number | null;
  tempDeratingFactor: number | null;
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
  xy: { x: number; y: number };
  roofZone: string | null;            // ASCE C&C zone
  substrateMember: string | null;     // rafter/truss — 'unverified-framing' when defaulted
  attachmentMethod: string | null;
  fastenerModel: string | null; fastenerCount: number | null;
  embedmentIn: number | null;
  tributaryAreaFt2: number | null;
  upliftReactionLbs: number | null;
  downwardReactionLbs: number | null;
  lateralReactionLbs: number | null;
  allowableCapacityLbs: number | null;
  adjustmentFactors: Record<string, number>;
  utilization: number | null;
  safetyFactor: number | null;
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
  provenance: Provenance;
}

/** §8 — structural engine result computed from the canonical objects. Framing
 *  honesty: when framing/truss/species/grade/span authority is insufficient the
 *  engine emits engineeringReviewRequired and NEVER derives a pass from a
 *  fabricated truss-capacity default. */
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
    // ── W3 §10 — structural BOM derived FROM the objects above ──────────────
    /** Every structural/racking BOM row, quantity traceable to module/rail/
     *  attachment objects (source IDs or auditable aggregation). SOLE quantity
     *  source; the three producers project these. */
    bom: StructuralBomRow[];
    /** §10 reconciliation report (rails/mounts/splices/clamps/fasteners/bonding
     *  vs the objects and the V4 producer). `ok:false` ⇒ V10 blocking. */
    bomReconciliation: StructuralBomReconciliation;
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
   *  stored equipment identity.) */
  permitReadiness: {
    ready: boolean;
    blockers: { code: string; message: string }[];
  };
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
