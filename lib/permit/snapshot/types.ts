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
  lengthIn: number | null; widthIn: number | null; weightLbs: number | null;
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
    systemEgc: { conductorId: string; basisOcpdA: number | null };
    poi: { method: string; busbarA: number | null; mainBreakerA: number | null;
           backfeedA: number | null; rulePasses: boolean | null };
    shadowParity: {                 // D-2 scaffold: computeSystem shadow vs engine-of-record
      shadowEngine: string; ran: boolean; divergences: string[];
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
