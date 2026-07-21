# PermitDesignSnapshot — Schema (Deliverable B) + Implementation Plan (C–G)

**Status: AWAITING RAY'S APPROVAL — no code changed.** Companion:
`docs/AUTHORITY-FLOW-AUDIT-PLANSET.md` (Deliverable A, dev `4fb21d2f`).

---

## B. Schema

One frozen, serializable, content-addressed object built server-side BEFORE any sheet
renders. Engines run ONCE, inside the builder. Sheets are typed to receive ONLY
`Readonly<PermitDesignSnapshot>` + page numbers — no PermitInput, no CADModel, no DB.

```ts
interface PermitDesignSnapshot {
  meta: {
    snapshotId: string;                 // uuid, minted per build
    digest: string;                     // SHA-256 of canonical JSON (meta.digest excluded)
    schemaVersion: string;              // snapshot schema semver
    engineVersion: string;              // planset pipeline version
    generatedAtIso: string;
    projectId: string;
    designVersionId: string | null;     // links to engineering pipeline design hash
  };

  // 1 ── PROJECT AUTHORITY
  project: {
    clientName: string;
    address: { line1: string; city: string; state: string; zip: string };
    parcelApn: string | null;
    lat: number; lng: number;
    utility: { name: string; id: string | null };
    ahj: {
      name: string; jurisdictionId: string | null;
      adoptedCodes: { nec: string; ibc: string; irc: string; ifc: string; asce: string };
      codesSource: 'ahj-record' | 'registry' | 'default';   // 'default' renders UNVERIFIED marker
      localAmendments: string[];
      permitRequirements: string[];
      recordCapturedAtIso: string;      // AHJ data frozen INTO the snapshot (no regen drift)
    };
    interconnection: { method: 'LOAD_SIDE'|'SUPPLY_SIDE_TAP'; rule: '705.12(B)'|'705.11' };
    thermal: {                          // ONE thermal basis for engines AND sheets
      designTempMinC: number; designTempHighC: number; rooftopAdderC: number;
      source: 'ashrae-envelope'|'ahj-override';
    };
  };

  // 2 ── VERSIONED EQUIPMENT AUTHORITY (records copied INTO the snapshot, not id refs)
  equipment: {
    modules: EquipmentRecord<ModuleSpec>[];       // one per distinct model in the design
    inverters: EquipmentRecord<InverterSpec>[];
    batteries: EquipmentRecord<BatterySpec>[];
    combiner: EquipmentRecord<CombinerSpec> | null;
    disconnects: EquipmentRecord<DisconnectSpec>[];
    racking: { mount: EquipmentRecord<MountSpec>; rail: EquipmentRecord<RailSpec> | null };
  };
  // EquipmentRecord<T> = { recordId; catalogId; manufacturer; model; sku;
  //   datasheet: { revision: string; sourceUrl: string; capturedAtIso: string;
  //                assetId: string | null };
  //   verified: boolean;                        // false ⇒ sheet marks FIELD-VERIFY
  //   spec: T }
  // ModuleSpec: wattsStc, voc, isc, vmp, imp, tempCoeffVocPctC, lengthIn, widthIn,
  //             depthIn, weightLbs, ulListing
  // InverterSpec (micro): continuousOutputA, continuousVa, maxUnitsPerBranch,
  //             maxBranchOcpdA, nominalV, ulListing        // manufacturer figures
  // MountSpec: upliftAllowableLbs, capacityBasis, fastenersPerMount, fastenerDiaIn,
  //             fastenerEmbedIn, maxSpacingIn, iccEsReport, selfFlashing
  // RailSpec: maxSpanIn, spliceIntervalIn, momentCapacityInLbs

  // 3 ── SITE & GEOMETRY AUTHORITY
  geometry: {
    roofPlanes: { planeId; polygon: LatLng[]; pitchDeg: number /* DEGREES ONLY — one unit law */;
                  azimuthDeg; areaSqFt;
                  framing: { type: 'rafter'|'truss'|'unknown'; sizeNominal; spacingInOC;
                             spanFt; species; source: 'survey'|'default-unverified' } }[];
    modules: { moduleId; planeId; moduleRecordId; centroid: LatLng; row; col;
               orientation; azimuthDeg; tiltDeg }[];     // EVERY physical module
    setbacks: { planeId; bands: { edgeType; widthIn; basisCode }[] }[];
    pathways: { planeId; widthIn; basisCode }[];
    parcel: { polygon: LatLng[]; source } | null;
  };

  // 4 ── ELECTRICAL TOPOLOGY AUTHORITY
  electrical: {
    topology: 'MICRO'|'STRING'|'OPTIMIZER' | Record<SubKey, ...>;   // per-sub for hybrids
    microinverters: { deviceId; moduleId; inverterRecordId; branchId }[];  // explicit 1:1 + branch
    branches: { branchId; label; deviceIds: string[]; moduleCount;
                continuousA; ocpdA; conductor: ConductorRecord; egc: ConductorRecord;
                conduitSegmentIds: string[]; terminatesAt: NodeRef }[];
    dcStrings: [...] (string/optimizer subs);
    conduitSegments: { segmentId; from: NodeRef; to: NodeRef; raceway: 'EMT'|'PVC'|'FREE_AIR';
                       tradeSizeIn; fillPct; oneWayFt; conductorRecordIds }[];
    combinerNodeId: string | null;
    feeder: { conductor: ConductorRecord; ocpdA; continuousA; conduitSegmentId; voltageDropPct };
    disconnect: { ratingA; fused: boolean; location };
    poi: { method; busbarA; mainBreakerA; backfeedA; rulePasses: boolean; calc: {...} };
    grounding: { systemEgc: ConductorRecord; gec?: ConductorRecord };
    engineOfRecord: 'runElectricalCalc' | 'computeSystem';   // ONE engine (decision D-2)
  };
  // ConductorRecord = { gauge; material; insulation; count; ampacityA; basis } — referenced
  // by id from every sheet; never re-stated.

  // 5 ── STRUCTURAL AUTHORITY
  structural: {
    assembly: { mountRecordId; railRecordId | null; pattern: 'rail'|'rail-less' };
    railLines: { railId; planeId; line: [LatLng, LatLng]; lengthFt; spliceCount }[];
    attachments: { attachmentId; railId|planeId; coord: LatLng;
                   fastener: { count; diaIn; embedIn; torqueFtLbs } }[];
    tributary: { attachmentId; areaSqFt }[];
    loads: { windSpeedMph; exposure; snowPsf; deadPsf; source: 'ahj-record'|'asce'|'default-unverified' };
    windZones: { planeId; zone; pressurePsf }[];
    reactions: { attachmentId; upliftLbs; downLbs; shearLbs }[];
    capacity: { upliftAllowableLbs; basis; sourceDoc };     // FROM mount record, one copy
    governing: { attachmentId; utilization; safetyFactor; passes: boolean };
  };

  // 6 ── DERIVED SYSTEM AUTHORITY (builder-computed, from the objects above ONLY)
  derived: {
    moduleCount; dcWattsStc;            // Σ module records via geometry.modules
    acWattsContinuous;                  // Σ inverter continuous outputs
    branchCount; feederContinuousA;
    roofCoverageByPlane: { planeId; pct }[];
    railTotalFt; attachmentCount;       // counts of structural objects, nothing else
    bom: { rowId; sku; description; qty; unit;
           derivation: { kind: 'count-of'|'per-module'|'per-branch'|'length-of';
                         objectIds: string[] } }[];   // every row cites drawn objects
  };

  certification: {
    engineeringReviewApproved: boolean;      // stays false until a review workflow exists
    engineer: { name; licenseNo; licenseState; expiresIso; sealAssetId } | null;
  };
}
```

## Validation engine (Deliverable D) — fails BEFORE rendering

`validatePermitDesignSnapshot(snapshot): Violation[]` — pure; generation throws on any
violation (fail-closed), with the machine-readable violation list persisted.

- V1  Σ modules per plane == geometry.modules.length == derived.moduleCount
- V2  microinverters.length == moduleCount (1:1 topologies)
- V3  Σ branches[].moduleCount == microinverters.length
- V4  every deviceId in exactly one branch (partition)
- V5  every branch ≤ inverterRecord.maxUnitsPerBranch AND ocpdA ≤ maxBranchOcpdA
- V5a IQ8A-72-2-US: ≤ 11 units, OCPD ≤ 20 A
      ── ⚠ RULING CONFLICT: reverses the 2026-07-20 single-branch-per-plane allowance
         (12 units @ 30 A, Braidon B3). As written, Braidon becomes 4 branches all ≤11
         @ 20 A. IMPLEMENTED AS WRITTEN unless Ray keeps the 30 A allowance.
- V6  derived.dcWattsStc == Σ module record wattsStc over geometry.modules
- V7  derived.acWattsContinuous == Σ inverter continuous
- V8  every geometric module footprint uses its module record lengthIn/widthIn
- V9  conductor/conduit RECORDS are referenced by id — E-1, PV-4A, PV-4B, SCHED, BOM,
      labels, PV-6 all project the same records (enforced by truth-matrix test, E)
- V10 railTotalFt/attachmentCount/BOM racking rows == counts of structural objects;
      every BOM row's derivation.objectIds resolve
- V11 every displayed code edition == project.ahj.adoptedCodes.* ; codesSource='default'
      ⇒ visible UNVERIFIED marker
- V12 every sheet prints meta.snapshotId + digest (title block)
- V13 certification language renders ONLY if engineeringReviewApproved && engineer
      complete; otherwise CERT/PE sheets render PENDING ENGINEERING REVIEW placeholders
- V14 pitch is degrees everywhere (builder normalizes rise:12 inputs once)
- V15 exactly one thermal basis: engines and sheets both read project.thermal

---

## C. Removal plan (sheet-local calculations & literals)

Wave order (each wave = one commit series, tests green throughout; sheets converted to
projections of the snapshot; every deleted local calc/literal maps to a snapshot field —
the audit register is the checklist, ~300 items):

- **W1 — Snapshot core (no sheet changes):** `lib/permit/snapshot/` — types, builder
  (wraps existing engines: canonical → CAD → branch plan → conductor sizing →
  structural V4 → BOM derivation), digest, validation engine + unit tests. Builder runs
  inside generatePermitHTML after input enrichment; VAL-1 gains the violation report.
  Fail-closed switch ON from the start (Ray's rule).
- **W2 — Electrical projections:** E-1 (single+multi lane), PV-4A, PV-4B, PV-5 labels,
  PV-6 directory read ONLY snapshot.electrical/equipment. Deletes: 6× 120% copies, all
  conductor/OCPD/EGC fallback ladders, interconnection string-sniffing, renderer sizing
  ladders, fabricated 220.82 block (replaced by a snapshot-computed service check or
  dropped — Ray decision D-4), buildSLD tier-3 literals.
- **W3 — Structural projections:** PV-3, PV-4C, PE letters read snapshot.structural +
  equipment.racking. Deletes: template fence engine ×3 copies, framing/embed/spacing
  default forests, foundation-type contradiction, SF prose, drawn-feet-vs-resolved
  spacing split (drawings render structural.attachments coordinates).
- **W4 — Project/cover/title:** title block, cover, notes read snapshot.project.ahj
  (adoptedCodes everywhere; UNVERIFIED marker when defaulted), snapshotId+digest in every
  title block; buildPermitCoverSheet either retired or converted (D-5).
- **W5 — Derived/BOM/datasheets:** SCHED/SCHED-2/BOM rows from derived.bom (derivations
  cite drawn objects); DS pages selected by equipment recordId (no fuzzy matching);
  APP-A spec tables from records only.
- **W6 — Certification gate:** engineer fields added to schema/DB (nullable), V13
  placeholders, retire vendor-EOR defaults and unconditional VERIFIED/PASS badges.

Guardrail: an ESLint-style grep gate (CI test) banning `?? <literal spec>`, `|| 200`,
`'#10 AWG'`, `'NEC 20xx'`-class literals inside lib/permit/sections/** after each wave.

## D. Validation engine — see schema section above (ships in W1, fail-closed).

## E. Cross-sheet truth-matrix tests

`tests/planset/truth-matrix.test.ts`: renders the full package once, extracts every
printed instance of each canonical value (regex/DOM anchors per sheet), asserts ALL
instances equal the snapshot value: backfeed A, feeder conductor, branch OCPDs, EGC,
code editions, wind/snow/exposure, module dims/watts, attachment count/spacing, rail ft,
totals, snapshotId/digest presence per sheet. Runs on Braidon-shaped + hybrid fixtures.

## F. Regenerated Braidon planset

Full regen via the faithful harness after W1–W6; every sheet from the snapshot;
pixel-verified per the visual mandate.

## G. Machine-verifiable evidence

`scripts/planset-evidence.mjs`: parses the rendered HTML, emits
`planset-evidence.json` — for each canonical value: snapshot value, every sheet's
printed value, agree:true/false; plus invariant results and the digest. Exit non-zero
on any disagreement. Committed alongside the Braidon regen as the acceptance artifact.

---

## Decisions needed from Ray before code starts

- **D-1 (V5a):** IQ8A ≤11 units/≤20 A as written (reverses the 12@30A ruling) — or keep
  the 30 A single-branch-per-plane allowance?
- **D-2:** electrical engine-of-record: `runElectricalCalc` (current permit path) or
  `computeSystem` (richer per-segment model, powers the app SLD)? One must win; the
  other becomes non-permit-only.
- **D-3:** client-posted `compliance.electrical` will be IGNORED by the snapshot builder
  (server engine always runs). Confirm.
- **D-4:** PV-4A's fabricated NEC 220.82 dwelling load calc: drop the section, or keep it
  visibly marked ESTIMATE — FIELD VERIFY with inputs surfaced?
- **D-5:** `buildPermitCoverSheet.ts` (legacy standalone cover with vendor-EOR defaults):
  retire, or convert to a projection?
- **D-6:** With V13, CERT/PE sheets render as PENDING ENGINEERING REVIEW placeholders
  until review workflow + engineer identity exist — the GreenLancer copy will visibly
  change. Confirm.
- **Scale:** W1–W6 is a multi-session campaign touching ~25 files and most goldens.
  Waves land individually with the board green; the truth-matrix suite is the
  non-regression wall from W2 on.
