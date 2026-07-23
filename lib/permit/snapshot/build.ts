// ═══════════════════════════════════════════════════════════════════════════
// buildPermitDesignSnapshot — assembles THE canonical authority object from
// the fully-enriched PermitInput + CADModel, AFTER the server engines have
// run (structural V4, electrical engine, conductor authority). Engines are
// consumed HERE, once; sheets project the result (W2+).
//
// D-3: client-posted electrical values are captured under sourceInputs as
// provenance and are NEVER authority.
// D-2: engineOfRecord = 'runElectricalCalc' (current permit engine);
// computeSystem runs in SHADOW and divergences are recorded for the parity
// campaign. Never two authoritative results — the shadow only reports.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import {
  SNAPSHOT_SCHEMA_VERSION, CANONICAL_COORDINATE_SYSTEM_ID,
  type PermitDesignSnapshot, type EquipmentRecord,
  type ModuleSpec, type MicroInverterSpec, type StringInverterSpec, type MountSpec,
  type RailSpec, type ConductorRecord, type BranchRecord,
  type PermitReadinessBlocker,
} from './types';
import { computeSnapshotDigest, snapshotIdFromDigest, deepFreeze } from './digest';
import { buildCodeAuthority, resolveAhjRecord } from './codeAuthority';
import {
  buildProjectAuthority, classifyBlockerDomain,
  type IssueStateReview, type IssuedForPermitGateInput,
} from './projectAuthority';
import { computePlansetManifest } from '../plansetManifest';
import { hybridSheetSections, SUB_LABEL } from '../sections/subSystemSheets';
import { buildStructuralAuthority, type StructuralRunsBundle } from './structuralAuthority';
import type { RackingCapacityDocumentEvidence } from './rackingAssembly';
import { buildConductorAuthority } from '../utils/conductorAuthority';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { utilityDisplayName } from '../utils/helpers';   // §15(b) — human utility name, never a slug
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { planMicroBranches, microMaxPerBranch, microBranchMaxOcpdA, type BranchPlanPanel } from '../utils/branching';
import { getDesignTemps } from '../utils/designTemps';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, getPanelById } from '@/lib/equipment-db';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { getManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { buildComputeSystemShadow } from '../utils/computedRuns';
import { collectEquipmentDocumentBlockers } from './equipmentProjection';
import { PLANSET_ENGINE_VERSION } from '../constants';

const fuzz = <T extends { model: string }>(list: T[], model?: string | null): T | undefined => {
  const m = (model ?? '').toLowerCase().trim();
  if (!m) return undefined;
  return list.find(e => e.model.toLowerCase() === m)
    ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
};

export function buildPermitDesignSnapshot(
  input: PermitInput,
  cad: CADModel,
  opts?: {
    projectId?: string | null; designVersionId?: string | null;
    // W4 §8/§9 closer wiring — resolved by the ASYNC caller (generatePermit)
    // BEFORE this pure/sync build, then threaded in so the build stays
    // deterministic. All default to the pre-wiring behaviour (no document ⇒
    // RT-MINI blockers stay; docs-archived null ⇒ ISSUED-FOR-PERMIT gate not
    // satisfied), so a DB-unavailable harness/test run is byte-identical.
    /** VERIFIED racking-capacity document (lib/documents) for the selected mount
     *  — clears the RT-MINI blockers only when it covers the exact assembly. */
    capacityDocument?: RackingCapacityDocumentEvidence | null;
    /** project jurisdiction (AHJ applicability) for the racking clearance check. */
    projectJurisdiction?: string | null;
    /** §12 ISSUED-FOR-PERMIT gate: required manufacturer documents archived.
     *  null ⇒ unresolved (DB unavailable / not read) ⇒ precondition NOT satisfied. */
    manufacturerDocumentsArchived?: boolean | null;
    /** §12 gate: a snapshot_digest_invalidations ledger entry forces the review-
     *  coverage precondition false. Conservative default when unresolved. */
    digestInvalidatedByLedger?: boolean;
  },
): PermitDesignSnapshot {
  const { project, system, compliance } = input;
  const proj = project as Record<string, any>;
  const elec = compliance?.electrical as Record<string, any> | undefined;
  const struct = compliance?.structural as Record<string, any> | undefined;

  const auth = buildConductorAuthority(input, cad);
  const eq = getEquipmentContext(input, cad);
  const topology = topologyToLegacy(getInverterTopology(input, cad)) as 'MICRO'|'STRING'|'OPTIMIZER';
  const isMicro = topology === 'MICRO';

  // ── equipment records ──────────────────────────────────────────────────
  const moduleModels = new Set<string>();
  for (const inv of system?.inverters ?? []) for (const s of inv.strings ?? []) {
    if (s?.panelModel) moduleModels.add(s.panelModel);
  }
  if (!moduleModels.size && eq.panelModel && eq.panelModel !== '—') moduleModels.add(eq.panelModel);

  const modules: EquipmentRecord<ModuleSpec>[] = [...moduleModels].map((m, i) => {
    // Identity = the fleet's own model string resolved against the catalog.
    // The §1.1 subSystems map panelId is CROSS-CHECKED, never blindly trusted:
    // on Braidon it points at a DIFFERENT module (rec-alpha-pure-405) than the
    // fleet strings (Q.PEAK DUO 400W) — a stored-authority conflict the
    // snapshot must SURFACE (equipmentIdentityConflicts), not silently pick.
    const db: any = fuzz(SOLAR_PANELS as any[], m);
    const asset = db ? getManufacturerAsset(db.id, 'module_spec') : null;
    return {
      recordId: `mod-${i + 1}`, catalogId: db?.id ?? null,
      // W5 (RP-C): the exact SKU lives on `partNumber` (equipment-db canonical
      // field); the legacy `sku` read was always undefined, so the snapshot
      // equipment record dropped IQ8A-72-2-US / the module part number.
      manufacturer: db?.manufacturer ?? '', model: db?.model ?? m, sku: db?.partNumber ?? db?.sku ?? null,
      datasheet: { revision: asset?.docTitle ?? null, sourceUrl: asset?.sourceUrl ?? db?.datasheetUrl ?? null,
                   capturedAtIso: null, assetId: asset?.id ?? null },
      verified: !!asset?.verified,
      spec: {
        wattsStc: db?.watts ?? proj.panelWattage ?? 0,
        voc: db?.voc ?? proj.panelVoc ?? 0, isc: db?.isc ?? proj.panelIsc ?? 0,
        vmp: db?.vmp ?? null, imp: db?.imp ?? null,
        tempCoeffVocPctC: db?.tempCoeffVoc ?? null,
        lengthIn: db?.length ?? proj.panelLengthIn ?? null,
        widthIn: db?.width ?? proj.panelWidthIn ?? null,
        thicknessIn: db?.thickness ?? null,
        weightLbs: db?.weight ?? proj.panelWeightLbs ?? null,
        ulListing: db?.ulListing ?? null,
      },
      provenance: { source: db ? 'equipment-db' : 'project-scalars', ref: db?.id },
    };
  });

  const microInverters: EquipmentRecord<MicroInverterSpec>[] = [];
  const stringInverters: EquipmentRecord<StringInverterSpec>[] = [];
  const invModels = new Set<string>();
  for (const inv of system?.inverters ?? []) if (inv?.model) invModels.add(inv.model);
  if (!invModels.size && eq.inverterModel && eq.inverterModel !== '—') invModels.add(eq.inverterModel);
  [...invModels].forEach((m, i) => {
    const micro: any = fuzz(MICROINVERTERS as any[], m);
    const str: any = micro ? undefined : fuzz(STRING_INVERTERS as any[], m);
    const db: any = micro ?? str;
    const asset = db ? (getManufacturerAsset(db.id, 'microinverter_spec') ?? getManufacturerAsset(db.id, 'inverter_spec')) : null;
    const base = {
      recordId: `inv-${i + 1}`, catalogId: db?.id ?? null,
      // W5 (RP-C): the exact SKU lives on `partNumber` (equipment-db canonical
      // field); the legacy `sku` read was always undefined, so the snapshot
      // equipment record dropped IQ8A-72-2-US / the module part number.
      manufacturer: db?.manufacturer ?? '', model: db?.model ?? m, sku: db?.partNumber ?? db?.sku ?? null,
      datasheet: { revision: asset?.docTitle ?? null, sourceUrl: asset?.sourceUrl ?? db?.datasheetUrl ?? null,
                   capturedAtIso: null, assetId: asset?.id ?? null },
      verified: !!asset?.verified,
      provenance: { source: db ? 'equipment-db' : 'system.inverters', ref: db?.id },
    };
    if (isMicro || micro) {
      const contVa = micro?.acOutputVa ?? (micro?.acOutputW ?? null);
      const contA = micro?.acOutputCurrentA ?? (contVa ? contVa / 240 : (eq.inverterAcOutputKw > 0 ? eq.inverterAcOutputKw * 1000 / 240 : 0));
      microInverters.push({ ...base, spec: {
        continuousOutputA: contA, continuousVa: contVa,
        maxUnitsPerBranch: microMaxPerBranch(m), maxBranchOcpdA: microBranchMaxOcpdA(m),
        nominalV: 240, ulListing: db?.ulListing ?? null,
      }});
    } else {
      const kw = db?.acOutputKw ?? 0;
      stringInverters.push({ ...base, spec: {
        continuousOutputA: kw > 0 ? kw * 1000 / 240 : 0, acOutputKw: kw,
        maxDcVoltage: db?.maxDcVoltage ?? null, ulListing: db?.ulListing ?? null,
      }});
    }
  });

  const mountDb: any = proj.mountingSystemId ? getMountingSystemById(proj.mountingSystemId) : undefined;
  const mountAsset = proj.mountingSystemId ? getManufacturerAsset(proj.mountingSystemId, 'racking_detail') : null;
  const mount: EquipmentRecord<MountSpec> | null = mountDb ? {
    recordId: 'mount-1', catalogId: mountDb.id, manufacturer: mountDb.manufacturer, model: mountDb.model,
    sku: null,
    datasheet: { revision: mountAsset?.docTitle ?? null, sourceUrl: mountAsset?.sourceUrl ?? null,
                 capturedAtIso: null, assetId: mountAsset?.id ?? null },
    verified: !!mountAsset?.verified,
    spec: {
      upliftAllowableLbs: mountDb.mount?.upliftCapacityLbs ?? null,
      capacityBasis: mountDb.mount?.capacityBasis ?? null,
      fastenersPerMount: mountDb.mount?.fastenersPerMount ?? null,
      fastenerDiaIn: mountDb.mount?.fastenerDiameterIn ?? null,
      fastenerEmbedIn: mountDb.mount?.fastenerEmbedmentIn ?? null,
      maxSpacingIn: mountDb.mount?.maxSpacingIn ?? null,
      iccEsReport: mountDb.iccEsReport ?? null,
      selfFlashing: mountDb.mount?.selfFlashing ?? null,
    },
    provenance: { source: 'mounting-hardware-db', ref: mountDb.id },
  } : null;

  const bos = buildIntegratedEquipment(input, cad);
  const bosBrains = bos.brains ?? bos.devices[0];

  // ── geometry ───────────────────────────────────────────────────────────
  const positions = ((proj.panelPositions ?? []) as BranchPlanPanel[]);
  const modRecordId = modules[0]?.recordId ?? 'mod-1';
  const geoModules = positions.map((p: any, i: number) => ({
    moduleId: String(p.id ?? `m${i}`),
    planeKey: String(p.planeId ?? p.arrayId ?? (isFinite(Number(p.azimuth)) ? 'az' + Math.round(Number(p.azimuth)) : '')),
    moduleRecordId: modRecordId,
    lat: isFinite(p.lat) ? p.lat : null, lng: isFinite(p.lng) ? p.lng : null,
    row: p.row ?? null, col: p.col ?? null, orientation: p.orientation ?? null,
  }));
  const planeCounts = new Map<string, number>();
  for (const g of geoModules) planeCounts.set(g.planeKey, (planeCounts.get(g.planeKey) ?? 0) + 1);
  const cadPlanes = ((cad as any)?.roof?.planes ?? []) as any[];
  const roofPlanes = [...planeCounts.entries()].map(([planeKey, n]) => {
    const cp = cadPlanes.find(p => String(p.id) === planeKey);
    return { planeId: planeKey, pitchDeg: isFinite(cp?.pitch) ? cp.pitch : null,
             azimuthDeg: isFinite(cp?.azimuth) ? cp.azimuth : null, moduleCount: n };
  });

  // ── electrical topology (branch plan is THE plan — D-1 planner) ───────
  const conductors: ConductorRecord[] = [];
  const addConductor = (gauge: string, insulation: string | null, source: string, ampacityA: number | null = null): string => {
    const id = `c-${conductors.length + 1}`;
    conductors.push({ conductorId: id, gauge, material: 'Cu', insulation, count: null, ampacityA,
                      provenance: { source } });
    return id;
  };

  const invRecord = microInverters[0];
  const plan = isMicro && positions.length
    ? planMicroBranches(positions, eq.inverterModel, eq.inverterManufacturer) : null;

  // ═══ W2.1: computeSystem is CANONICAL ═══════════════════════════════════
  const cs: any = (input as unknown as { _computeSystem?: unknown })._computeSystem ?? null;
  const legacyShadow: any = (input as unknown as { _legacyElectricalShadow?: unknown })._legacyElectricalShadow ?? null;
  const runMap: Record<string, any> = cs?.runMap ?? {};
  const feederRun = runMap['COMBINER_TO_DISCO_RUN'] ?? runMap['INV_TO_DISCO_RUN'] ?? null;
  const branchRun = runMap['BRANCH_RUN'] ?? null;

  // Branch DEVICE ASSIGNMENT = D-1 routing planner (geometry authority);
  // branch ELECTRICALS = computeSystem's own branch rows, matched by size.
  // A size-multiset mismatch is a blocking violation (V16) — never patched.
  const csBranchPool: any[] = [...(cs?.microBranches ?? [])];
  const takeCsBranch = (n: number) => {
    const i = csBranchPool.findIndex(b => Number(b?.deviceCount) === n);
    return i >= 0 ? csBranchPool.splice(i, 1)[0] : null;
  };
  let branchEngineMismatch = false;
  const branches: BranchRecord[] = (plan?.sizes ?? auth.microBranches.map(b => b.deviceCount)).map((size, i) => {
    const csRow = takeCsBranch(size);
    if (!csRow) branchEngineMismatch = true;
    const currentA = csRow ? Number(csRow.branchCurrentA) : NaN;
    const gauge = csRow?.conductorCallout?.match(/#\d+(?:\/0)?(?:\s*AWG)?/)?.[0] ?? null;
    return {
      branchId: `br-${i + 1}`, label: `B${i + 1}`,
      deviceIds: plan ? positions.filter(p => plan.assign.get(String(p.id)) === i).map(p => String(p.id)) : [],
      moduleCount: size,
      currentA: isFinite(currentA) ? currentA : 0,
      continuousA: isFinite(currentA) ? currentA * 1.25 : 0,
      ocpdA: csRow ? Number(csRow.ocpdAmps) : 0,
      conductorId: addConductor(gauge ? (gauge.includes('AWG') ? gauge : `${gauge} AWG`) : (branchRun?.wireGauge ?? '—'),
        'THWN-2', 'computeSystem.microBranches'),
      egcConductorId: branchRun?.egcGauge ? addConductor(branchRun.egcGauge, null, 'computeSystem BRANCH_RUN (NEC 250.122)') : null,
    };
  });
  const microUnits = isMicro ? geoModules.map(g => ({
    deviceId: `mi-${g.moduleId}`, moduleId: g.moduleId,
    inverterRecordId: invRecord?.recordId ?? 'inv-1',
    branchId: plan ? `br-${(plan.assign.get(g.moduleId) ?? 0) + 1}` : (branches[0]?.branchId ?? 'br-1'),
  })) : [];

  // Feeder conductor from the CANONICAL engine's own feeder segment.
  const feederConductorId = addConductor(
    feederRun?.wireGauge ?? auth.acFeeder.wireGauge, 'THWN-2',
    'computeSystem feeder segment', feederRun?.effectiveAmpacity ?? auth.acFeeder.ampacityA ?? null);

  // ═══ W2.1 GROUNDING OBJECTS — per segment + purpose (no "system EGC") ═══
  const groundingObjects: import('./types').GroundingRecord[] = [];
  if (isMicro && branchRun) {
    branches.forEach((b) => groundingObjects.push({
      groundingId: `gnd-${b.branchId}`, segmentId: 'BRANCH_RUN', purpose: 'branch-egc',
      required: true, method: 'conductor', conductorMaterial: 'Cu',
      conductorSize: branchRun.egcGauge ?? null,
      sizingBasis: `NEC 250.122 @ ${b.ocpdA}A branch OCPD`,
      associatedOcpdA: b.ocpdA, associatedEquipment: `AC branch ${b.label}`,
      manufacturerListingBasis: null, codeBasis: 'NEC 250.122',
      provenance: { source: 'computeSystem BRANCH_RUN' },
    }));
  }
  if (feederRun) {
    groundingObjects.push({
      groundingId: 'gnd-feeder', segmentId: String(feederRun.id), purpose: 'feeder-egc',
      required: true, method: 'conductor', conductorMaterial: 'Cu',
      conductorSize: feederRun.egcGauge ?? null,
      sizingBasis: `NEC 250.122 @ ${feederRun.ocpdAmps ?? cs?.acOcpdAmps ?? '?'}A feeder OCPD`,
      associatedOcpdA: feederRun.ocpdAmps ?? cs?.acOcpdAmps ?? null,
      associatedEquipment: 'AC feeder (combiner → disconnect → POI)',
      manufacturerListingBasis: null, codeBasis: 'NEC 250.122',
      provenance: { source: 'computeSystem feeder segment' },
    });
    const raceway = String(feederRun.conduitType ?? '').toUpperCase();
    if (raceway.includes('EMT')) {
      groundingObjects.push({
        groundingId: 'gnd-raceway', segmentId: String(feederRun.id), purpose: 'raceway-bond',
        required: true, method: 'raceway', conductorMaterial: null, conductorSize: null,
        sizingBasis: null, associatedOcpdA: null, associatedEquipment: 'EMT raceway + listed fittings',
        manufacturerListingBasis: null,
        codeBasis: 'NEC 250.118(4) — EMT is a permitted equipment grounding conductor; bonding via listed fittings',
        provenance: { source: 'computeSystem feeder segment (raceway type)' },
      });
    }
  }
  groundingObjects.push({
    groundingId: 'gnd-gec', segmentId: 'SERVICE', purpose: 'gec',
    required: false, method: 'none-required', conductorMaterial: null, conductorSize: null,
    sizingBasis: null, associatedOcpdA: null, associatedEquipment: 'Existing service grounding electrode system',
    manufacturerListingBasis: null,
    codeBasis: 'NEC 250.64 / 690.47 — interconnected system bonds to the existing GES; no separate GEC added',
    provenance: { source: 'design rule', note: 'explicit not-required record — never an invented conductor' },
  });

  // ═══ W2.1 CANONICAL ROUTE-LENGTH AUTHORITY ═════════════════════════════
  // deriveRunLengths(cad) is a DOCUMENTED CAD-DERIVED ESTIMATE, not routed
  // geometry — recorded as such, and it BLOCKS permit-ready status below.
  // W1 — describe each physical section's electrical function from its run id so
  // the schema self-documents (Q-Cable trunk / branch home-run / roof JB /
  // combiner feeder / combiner→disco / disco→tap / tap conductors / service).
  const _elecFunction = (id: string, isOpenAir: boolean): string => {
    const s = id.toUpperCase();
    if (/BRANCH/.test(s)) return isOpenAir ? 'micro AC branch (Q-Cable trunk, open air)' : 'branch home-run raceway';
    if (/JBOX|J_BOX|JB/.test(s)) return 'roof junction box';
    if (/PV_TO/.test(s)) return isOpenAir ? 'array wiring (open air, 690.31(C))' : 'array wiring in raceway';
    if (/COMBINER_TO_DISCO|INV_TO_DISCO/.test(s)) return 'combiner/inverter feeder → disconnect';
    if (/DISCO_TO_(MSP|TAP|POI)/.test(s)) return 'disconnect → point of interconnection / tap';
    if (/TAP/.test(s)) return 'tap conductors';
    if (/SERVICE|MSP/.test(s)) return 'service equipment connection';
    return 'electrical run';
  };
  const routeSegments: import('./types').RouteSegmentRecord[] = ((cs?.runs ?? []) as any[]).map((r: any) => {
    const _isOpenAir = !!r.isOpenAir;
    const _opA = isFinite(r.operatingCurrentA) ? r.operatingCurrentA
      : (isFinite(r.currentA) ? r.currentA : null);
    const _contA = isFinite(r.continuousCurrentA) ? r.continuousCurrentA
      : (_opA != null ? Math.round(_opA * 1.25 * 100) / 100 : null);
    return {
      segmentId: String(r.id), from: String(r.fromLabel ?? r.from ?? ''), to: String(r.toLabel ?? r.to ?? ''),
      electricalFunction: _elecFunction(String(r.id), _isOpenAir),
      oneWayFt: isFinite(r.onewayLengthFt) ? r.onewayLengthFt : null,
      lengthSource: 'cad-derived-estimate',
      // W1 — CAD-derived length ⇒ cad-derived-estimate verification state (never
      // field-verified without a recorded measurement). Mirrors the canonical
      // RouteVerificationStatus accessor's mapping.
      verificationStatus: 'cad-derived-estimate',
      raceway: _isOpenAir ? 'FREE_AIR' : (r.conduitType ?? null),
      tradeSizeIn: r.conduitSize ?? null,
      fillPct: isFinite(r.conduitFillPercent) ? r.conduitFillPercent : null,
      installationMethod: _isOpenAir ? 'free-air (NEC 690.31(C))' : (r.conduitType ? 'in-conduit' : null),
      conductorGauge: r.wireGauge ?? null,
      conductorCount: isFinite(r.conductorCount) ? r.conductorCount : null,
      conductorMaterial: 'Cu',
      insulation: r.insulation ?? (_isOpenAir && isMicro ? 'TC-ER' : (r.isDc ? 'USE-2' : 'THWN-2')),
      neutralPresent: typeof r.neutralPresent === 'boolean' ? r.neutralPresent : null,
      conductorCallout: r.conductorCallout ?? null,
      egcGauge: r.egcGauge ?? null,
      bondingMethod: r.egcGauge ? 'conductor' : (String(r.conduitType ?? '').toUpperCase().includes('EMT') ? 'raceway' : null),
      operatingCurrentA: _opA,
      continuousCurrentA: _contA,
      calculatedCurrentA: isFinite(r.effectiveCurrentA) ? r.effectiveCurrentA : _contA,
      voltageDropPct: isFinite(r.voltageDropPct) ? r.voltageDropPct : null,
      // The VD formula uses the OPERATING current (Vd = 2·L·I·R/1000); recorded
      // so a sheet can never present the OCPD rating as the VD current.
      voltageDropCurrentBasis: 'operating',
      ocpdA: isFinite(r.ocpdAmps) ? r.ocpdAmps : null,
      ambientTempC: isFinite(r.ambientTempC) ? r.ambientTempC : null,
      rooftopAdderC: isFinite(r.rooftopAdderC) ? r.rooftopAdderC : null,
      tempDeratingFactor: isFinite(r.tempDeratingFactor) ? r.tempDeratingFactor : null,
      provenance: { source: 'computeSystem runs (deriveRunLengths cad estimate)' },
    };
  });

  // ═══ §5 (07-22) CANONICAL SERVICE-INTERCONNECTION TOPOLOGY ═════════════════
  // The tap point, tap conductors, fused OCPD, utility disconnect, meter and
  // service disconnect are SEPARATE objects with their OWN honest length. The
  // ≤10-ft 705.11(C) rule attaches to the TAP-CONDUCTOR object only, and its
  // compliance state derives from that object's length state — an unknown
  // tap-conductor length is PENDING (never a fabricated compliant 10-ft claim),
  // and is reflected in ROUTE-LENGTH-ESTIMATE. The 60-ft PV feeder run lives on
  // the feeder route segment, NOT on any tap object (the conflation the audit hit).
  const serviceTopology: import('./types').ServiceTopologyObject[] = (() => {
    const method = String(proj.interconnectionMethod ?? 'LOAD_SIDE');
    const isSupply = /SUPPLY|LINE/i.test(method);
    const feederOcpd = cs?.backfeedBreakerAmps ?? cs?.acOcpdAmps ?? feederRun?.ocpdAmps ?? null;
    const feederGauge = feederRun?.wireGauge ?? auth.acFeeder.wireGauge ?? null;
    const pvOutA = cs?.acOutputCurrentA ?? null;
    const pvContA = cs?.acContinuousCurrentA ?? (pvOutA != null ? pvOutA * 1.25 : null);
    const mainA = proj.mainPanelAmps ?? proj.mainBreakerA ?? null;
    const objs: import('./types').ServiceTopologyObject[] = [];
    if (isSupply) {
      objs.push({
        objectId: 'svc-tap-point', type: 'tap-point',
        label: 'Supply-side tap point', description: 'Line side of the service disconnecting means (NEC 705.11)',
        conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
        constraints: [], provenance: { source: 'interconnection method (supply-side)' },
      });
      objs.push({
        objectId: 'svc-tap-conductors', type: 'tap-conductors',
        label: 'Tap conductors', description: 'Tap point → fused AC disconnect; sized ≥ 125% of PV output current',
        conductorSpec: feederGauge ? `${feederGauge} THWN-2${pvContA != null ? ` (≥ ${pvContA.toFixed(1)}A)` : ''}` : null,
        ocpdRatingA: null,
        // No CAD datum for the short tap run → honest PENDING (participates in
        // ROUTE-LENGTH-ESTIMATE via the length-source below).
        lengthFt: null, lengthSource: 'unknown',
        constraints: [{
          code: 'NEC-705.11(C)-TAP-10FT',
          description: 'Fused disconnect within 10 ft of the tap; tap-conductor length ≤ 10 ft',
          limitFt: 10,
          state: 'pending',   // unknown length ⇒ never a compliant 10-ft claim
        }],
        provenance: { source: 'design rule (tap-conductor length not measured)', note: 'FIELD-VERIFY ≤10ft' },
      });
      objs.push({
        objectId: 'svc-fused-ocpd', type: 'fused-ocpd',
        label: 'Fused AC disconnect (tap OCPD)', description: 'NEC 705.11 supply-side overcurrent device',
        conductorSpec: null, ocpdRatingA: feederOcpd, lengthFt: null, lengthSource: 'not-applicable',
        constraints: [], provenance: { source: 'computeSystem tap OCPD' },
      });
      objs.push({
        objectId: 'svc-utility-disconnect', type: 'utility-disconnect',
        label: 'Utility/AC disconnect', description: 'Lockable AC disconnect ahead of the point of interconnection (per utility)',
        conductorSpec: null, ocpdRatingA: feederOcpd, lengthFt: null, lengthSource: 'not-applicable',
        constraints: [], provenance: { source: 'interconnection requirements' },
      });
    }
    // meter + service disconnect exist on every design (supply- and load-side).
    objs.push({
      objectId: 'svc-meter', type: 'meter',
      label: 'Utility revenue meter', description: 'Existing utility service meter',
      conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], provenance: { source: 'existing service' },
    });
    objs.push({
      objectId: 'svc-service-disconnect', type: 'service-disconnect',
      label: 'Main service disconnect', description: 'Existing main service disconnecting means',
      conductorSpec: null, ocpdRatingA: mainA, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], provenance: { source: 'project service rating' },
    });
    return objs;
  })();

  // ═══ W2.1 CLASSIFIED PARITY — canonical (computeSystem) vs legacy shadow ═
  const parityChecks: import('./types').ParityCheck[] = [];
  const _par = (name: string, segmentId: string | null, canonical: unknown, legacy: unknown,
                classification: import('./types').ParityClassification, resolution: string, agree?: boolean) => {
    parityChecks.push({
      name, segmentId,
      canonical: String(canonical ?? '—'), legacyShadow: String(legacy ?? '—'),
      agree: agree ?? String(canonical) === String(legacy),
      classification: (agree ?? String(canonical) === String(legacy)) ? 'agree' : classification,
      resolution,
    });
  };
  const legacyRan = !!legacyShadow;
  if (cs) {
    _par('feeder OCPD (A)', String(feederRun?.id ?? 'FEEDER'), cs.backfeedBreakerAmps,
      legacyShadow?.busbar?.backfeedBreakerRequired, 'legacy-engine-defect',
      'both engines apply NEC 690.8×1.25→240.6; any difference is a defect to fix in the diverging engine');
    _par('feeder conductor', String(feederRun?.id ?? 'FEEDER'), feederRun?.wireGauge,
      legacyShadow?.acWireGauge, 'model-definition-difference',
      'canonical sizes on routed length + unified thermal basis');
    _par('feeder EGC', String(feederRun?.id ?? 'FEEDER'), feederRun?.egcGauge,
      legacyShadow?.groundingConductor, 'legacy-engine-defect',
      'legacy "groundingConductor" was an unscoped system EGC and undersized vs NEC 250.122 on the feeder OCPD; '
      + 'grounding is now modeled per segment+purpose (groundingObjects); legacy value shadow-only');
    _par('feeder V-drop (%)', String(feederRun?.id ?? 'FEEDER'), feederRun?.voltageDropPct?.toFixed?.(2),
      legacyShadow?.acVoltageDrop?.toFixed?.(2), 'intentional-supersession',
      'canonical routed segment length (route-length authority) replaces the legacy flat project-level length',
      false);
    _par('branch count', 'BRANCH_RUN', cs.microBranches?.length, '(no per-branch model)',
      'model-definition-difference', 'legacy engine has no per-branch model; canonical owns branches',
      undefined);
    _par('branch device assignment', 'BRANCH_RUN', 'D-1 routing planner (geometry-aware)', '(none)',
      'model-definition-difference',
      'assignment is owned by the D-1 planner (geometry authority); canonical engine sizes must match the plan '
      + `(verified: ${branchEngineMismatch ? 'MISMATCH — V16 blocks' : 'sizes match'})`,
      !branchEngineMismatch);
    {
      const _canonMethod = String(proj.interconnectionMethod ?? 'LOAD_SIDE');
      const _legMethod = String(legacyShadow?.busbar?.method ?? _canonMethod);
      const _bothSupply = /SUPPLY/i.test(_canonMethod) === /SUPPLY/i.test(_legMethod);
      _par('interconnection method', null, _canonMethod, _legMethod,
        'model-definition-difference',
        'method is a design decision on the project record — neither engine decides it; legacy stores a display label',
        _bothSupply);
    }
    _par('temperature correction basis', String(feederRun?.id ?? 'FEEDER'),
      `ASHRAE ${String((input as any)._engineThermal?.designTempMin ?? '')}°C`,
      'legacy flat -10°C regime (retired W2)', 'intentional-supersession',
      'V15 thermal unification — one ASHRAE basis for engines and sheets', false);
  }
  const parityUnresolved = parityChecks
    .filter(c => !c.agree && !['intentional-supersession', 'model-definition-difference', 'legacy-engine-defect'].includes(c.classification))
    .map(c => c.name);

  // ── thermal (ONE basis; engines converge on it in W2 — gap recorded) ──
  const temps = getDesignTemps(proj.lat, proj.lng, typeof proj.state === 'string' && /^[A-Za-z]{2}$/.test(proj.state) ? proj.state : undefined);

  // ── AHJ / codes ───────────────────────────────────────────────────────
  const necRaw = String(compliance?.jurisdiction?.necVersion ?? '').replace(/^NEC\s*/i, '');
  const necFromRecord = /^(2017|2020|2023)$/.test(necRaw);

  const totalsPanels = geoModules.length || system?.totalPanels || 0;
  const dcWattsStc = geoModules.length && modules[0]?.spec.wattsStc
    ? geoModules.length * modules[0].spec.wattsStc
    : Math.round((system?.totalDcKw ?? 0) * 1000);
  const acWattsContinuous = isMicro
    ? Math.round(totalsPanels * (invRecord?.spec.continuousVa ?? (invRecord?.spec.continuousOutputA ?? 0) * 240))
    : Math.round(stringInverters.reduce((s, r) => s + r.spec.acOutputKw * 1000, 0));

  // Req. 7 — stored-authority equipment identity conflicts (surfaced AND
  // permit-ready-blocking; never silently reconciled in production data).
  const equipmentIdentityConflicts: string[] = [];
  for (const [k, sub] of Object.entries((proj.subSystems ?? {}) as Record<string, any>)) {
    const mapped: any = sub?.panelId ? getPanelById(sub.panelId) : null;
    if (mapped && modules[0] && mapped.id !== modules[0].catalogId) {
      equipmentIdentityConflicts.push(
        `subSystems.${k}.panelId='${sub.panelId}' (${mapped.manufacturer} ${mapped.model}) vs fleet module '${modules[0].model}' — operator reconciliation required (migration 110 territory)`);
    }
  }

  // ═══ W3 CANONICAL STRUCTURAL AUTHORITY ═════════════════════════════════
  // Built from the ENGINE OF RECORD (V4 runs stashed on input._structuralRuns
  // by generatePermit) + equipment-db module dims + mounting-hardware-db +
  // fire-setback engine. Never from sheet literals.
  const structRuns = ((input as unknown as { _structuralRuns?: StructuralRunsBundle })._structuralRuns) ?? null;
  const roofSInput = structRuns?.inputs?.roof ?? (structRuns ? Object.values(structRuns.inputs)[0] : undefined) ?? null;
  const isRoofSystem = !!structRuns?.byKey?.roof || (cad as any)?.systemType === 'roof';
  const windAuthoritative = proj.ahjWindSpeedMph != null;
  const snowAuthoritative = proj.ahjGroundSnowPsf != null;
  // §6 — fence wind engine input (solar_fence systems). Sourced from canonical
  // structure + cad.fence geometry — the SAME inputs the former inline renderer
  // math used, now feeding the relocated engine → snapshot check.
  const _cadAny = cad as any;
  const _cStruct = (proj._canonical as any)?.structure;
  const _cSite = (proj._canonical as any)?.site;
  const _fenceWindSpeed = _cSite?.windSpeed ?? (struct?.wind as any)?.windSpeed ?? proj.windSpeedMph ?? null;
  const _isFenceSystem = String(_cadAny?.systemType) === 'solar_fence' || !!_cadAny?.fence;
  const fenceWind = (_isFenceSystem && !isRoofSystem && _fenceWindSpeed != null) ? {
    windSpeedMph: _fenceWindSpeed,
    exposure: _cSite?.exposureCategory ?? (struct?.wind as any)?.exposureCategory ?? proj.windExposure ?? 'C',
    panelHeightFt: _cStruct?.panelHeightFt ?? (_cadAny?.fence?.panelHeightM ? _cadAny.fence.panelHeightM * 3.28084 : 6.0),
    postSpacingFt: _cStruct?.postSpacingFt ?? (_cadAny?.fence?.postSpacingM ? _cadAny.fence.postSpacingM * 3.28084 : 8.0),
    postEmbedFt: _cStruct?.postEmbedFt ?? 3.5,
    soilResistancePsf: _cStruct?.soilResistance ?? 200,
    groundSnowPsf: _cSite?.groundSnowLoad ?? (struct?.snow as any)?.groundSnowLoad ?? proj.ahjGroundSnowPsf ?? 0,
  } : null;
  const structAuth = buildStructuralAuthority({
    isRoofSystem,
    moduleRecord: modules[0] ?? null,
    geoModules,
    microUnits,
    roofPlanes,
    cadPlanes,
    mountSystem: mountDb ?? null,
    structuralRuns: structRuns,
    framing: {
      framingType: proj.framingType ?? null,
      rafterSize: proj.rafterSize ?? null,
      rafterSpacing: proj.rafterSpacing ?? null,
      rafterSpecies: proj.rafterSpecies ?? null,
      rafterSpan: proj.rafterSpan ?? null,
    },
    windAuthoritative, snowAuthoritative,
    windSpeedMph: (struct?.wind as any)?.windSpeed ?? proj.windSpeedMph ?? null,
    exposure: (struct?.wind as any)?.exposureCategory ?? proj.windExposure ?? null,
    snowPsf: (struct?.snow as any)?.groundSnowLoad ?? proj.ahjGroundSnowPsf ?? null,
    riskCategory: proj.riskCategory ?? null,
    meanRoofHeightFt: roofSInput?.meanRoofHeight ?? null,
    asceEdition: `ASCE ${necFromRecord ? '7-22' : '7-22'}`,
    asceSource: necFromRecord ? 'ahj-record' : 'pending-w4-ahj-authority',
    ahjRidgeSetbackIn: (proj.ahjRidgeSetbackIn ?? proj.fireSetbackRidgeIn) ?? null,
    roofCovering: proj.roofType ?? null,
    fenceWind,
    // W4 §9 — the async-resolved VERIFIED racking-capacity document (or null when
    // none/DB-unavailable). buildRackingAssembly evaluates it against the exact
    // selected assembly; a non-matching doc (brochure) or null leaves RT-MINI
    // blockers firing (fail-soft).
    capacityDocument: opts?.capacityDocument ?? null,
    projectJurisdiction: opts?.projectJurisdiction ?? null,
  });

  // ═══ W4 §1 CANONICAL CODE AUTHORITY ════════════════════════════════════
  // THE single source for every printed edition. NEC comes from the best real
  // adoption authority (resolved AHJ record / server-enriched jurisdiction);
  // IBC/IRC/IFC are NOT carried by the AHJ DB → left null (no inference); ASCE
  // is sourced from the structural engine's computational basis. Nothing is
  // `verified` (no archived adoption ordinance) — the honest state that drives
  // CODE-AUTHORITY-INCOMPLETE below and PENDING editions on the sheets.
  const _capturedIso = (input as any).generatedAtIso ?? proj.date ?? '';
  const _ahjRecord = resolveAhjRecord({
    ahjRecordId: proj.ahjRecordId ?? proj.ahjId ?? null,
    stateCode: typeof proj.state === 'string' ? proj.state : null,
    county: proj.county ?? null,
    city: proj.city ?? null,
    address: proj.address ?? null,
  });
  const codeAuthority = buildCodeAuthority({
    ahjRecord: _ahjRecord,
    necVersionEnriched: (compliance?.jurisdiction as any)?.necVersion ?? proj.ahjNecVersion ?? null,
    ahjNameHint: (compliance?.jurisdiction as any)?.ahj ?? proj.ahjName ?? null,
    stateCodeHint: typeof proj.state === 'string' ? proj.state : null,
    asceEngineBasis: structAuth.env.codeAuthority.asceEdition ?? null,
    utilityName: proj.utilityName ?? null,
    utilityId: null,
    capturedAtIso: _capturedIso,
  });
  // adoptedCodes MUST mirror the code-authority record (single source). A null
  // (unknown) adoption becomes '—' — never a fabricated year (V11 forbids a
  // sheet or the snapshot substituting an edition the authority does not carry).
  const _ce = codeAuthority.editions;
  const adoptedCodes = {
    nec: _ce.nec.edition ?? '—', ibc: _ce.ibc.edition ?? '—', irc: _ce.irc.edition ?? '—',
    ifc: _ce.ifc.edition ?? '—', asce: _ce.asce.edition ?? '—',
  };

  // §14 — project legal authority is NEVER verified from an official source here
  // (no document-registry / operator verification path is wired into this pure
  // build). Postal inference is not verification, so this stays false and the
  // per-field states resolve to 'unverified-derived'. Never fabricate true.
  const _projectAuthorityVerified = false;

  // ═══ W4 §12 / W10 (RP-D) PERMIT-READINESS REGISTRY ═════════════════════════
  // ONE canonical, structured registry of EVERY active release blocker
  // (blocking + advisory), from which the back-compat code/message list is
  // single-sourced (BLOCKING entries only, preserving the issue-state / gate
  // semantics). The renderer surfaces the FULL registry (RS-1 review-status
  // sheet + union banners) so nothing is hidden by the old structural-else
  // ternary. createdAtIso/createdVersion use the snapshot generation
  // meta (NOT Date.now) so pure/digest paths stay deterministic.
  const _permitReadiness: {
    ready: boolean;
    blockers: { code: string; message: string }[];
    registry: PermitReadinessBlocker[];
  } = (() => {
    const registry: PermitReadinessBlocker[] = [];
    // Static authority metadata per code (severity / where it lives / which
    // sheets must show it / how to resolve it). Dynamic codes (structural /
    // racking / equipment-document) fall back to sensible defaults.
    const META: Record<string, { severity: 'blocking' | 'warning'; authorityPath: string; sheets: string[]; resolution: string }> = {
      'ROUTE-LENGTH-ESTIMATE': { severity: 'blocking', authorityPath: 'electrical.routeSegments[].lengthSource', sheets: ['PV-1', 'PV-4B', 'E-1', 'SCHED'], resolution: 'Provide CAD-routed geometry or field-measured run lengths (no estimate as authority).' },
      'EQUIPMENT-IDENTITY-CONFLICT': { severity: 'blocking', authorityPath: 'project.subSystems[*].panelId vs equipment.modules[0]', sheets: ['SCHED', 'APP-A', 'DS-1'], resolution: 'Operator must reconcile the stored panelId with the fleet module (migration 110) — never auto-resolved.' },
      'FEEDER-RACEWAY-AUTHORITY': { severity: 'blocking', authorityPath: 'electrical.feeder.conduit', sheets: ['PV-4B', 'E-1', 'SCHED'], resolution: 'Resolve the feeder raceway/conduit type + bonding authority on the canonical feeder segment.' },
      'CONDUIT-FILL-PENDING': { severity: 'warning', authorityPath: 'electrical.feeder.conduit.fillPct', sheets: ['PV-4A', 'PV-4B'], resolution: 'Compute conduit fill for the feeder raceway (NEC Ch.9, Table 1) — no zero-error claim while PENDING.' },
      'TAP-CONDUCTOR-LENGTH-PENDING': { severity: 'warning', authorityPath: 'electrical.serviceTopology[svc-tap-conductors].constraints', sheets: ['PV-4B', 'PV-6', 'E-1'], resolution: 'Field-measure the tap-conductor run and confirm ≤10 ft (NEC 705.11(C)).' },
      'CODE-AUTHORITY-INCOMPLETE': { severity: 'blocking', authorityPath: 'codeAuthority.editions', sheets: ['PV-0', 'CERT', 'PE-1'], resolution: 'Archive + verify the AHJ adoption ordinance (W4-D); no edition inference.' },
      'PROJECT-AUTHORITY-UNVERIFIED': { severity: 'blocking', authorityPath: 'projectAuthority', sheets: ['PV-0', 'CERT'], resolution: 'Verify address / APN / municipal boundary / AHJ / fire authority via the document registry (no postal inference).' },
      'PROJECT-NAME-NONPRODUCTION': { severity: 'blocking', authorityPath: 'project.projectName', sheets: ['PV-0'], resolution: 'Replace the non-production ("TEST") project name with the real project identity before issue.' },
      'DESIGNER-OF-RECORD-MISSING': { severity: 'blocking', authorityPath: 'project.designer', sheets: ['PV-0', 'CERT'], resolution: 'Assign the designer / engineer-of-record before issue.' },
      'ENGINEERING-REVIEW-PENDING': { severity: 'blocking', authorityPath: 'certification.engineeringReviewApproved', sheets: ['CERT', 'PE-1'], resolution: 'Obtain an approved engineering-review record covering the current snapshot digest (D-6).' },
    };
    const STRUCT_DEFAULT = { authorityPath: 'structural (structural-engine-v4 objects)', sheets: ['PV-4C', 'PV-3', 'PE-1', 'CERT'], resolution: 'Establish the verified structural authority (capacity / framing / fastener / assembly) before a structural PASS.' };
    const push = (code: string, explanation: string, over?: Partial<PermitReadinessBlocker>): void => {
      const m = META[code];
      const domain = classifyBlockerDomain(code);
      const isStruct = domain === 'structural';
      registry.push({
        code,
        severity: over?.severity ?? m?.severity ?? 'blocking',
        domain,
        authorityPath: over?.authorityPath ?? m?.authorityPath ?? (isStruct ? STRUCT_DEFAULT.authorityPath : `snapshot (${domain})`),
        affectedSheets: over?.affectedSheets ?? m?.sheets ?? (isStruct ? STRUCT_DEFAULT.sheets : []),
        explanation,
        resolutionAction: over?.resolutionAction ?? m?.resolution ?? (isStruct ? STRUCT_DEFAULT.resolution : 'Resolve the missing authority before permit-ready.'),
        provenance: over?.provenance ?? { source: 'snapshot build (permitReadiness)', ref: null },
        createdAtIso: _capturedIso,
        createdVersion: String(PLANSET_ENGINE_VERSION),
        resolved: false,
        resolutionAuditRef: null,
      });
    };

    // Req. 3: no authoritative routed geometry exists — segment lengths are
    // CAD-derived ESTIMATES. Identified, never silently used as authority-grade.
    if (routeSegments.some(r => r.lengthSource !== 'cad-route' && r.lengthSource !== 'field-measurement')) {
      push('ROUTE-LENGTH-ESTIMATE',
        'Electrical run lengths are CAD-derived estimates — authoritative routed geometry or field measurement required for permit-ready status');
    }
    // Req. 7: stored equipment-identity conflict (e.g. Braidon subSystems
    // panelId vs fleet model) BLOCKS permit-ready until operator reconciliation.
    // W10b: this conflict was NEVER reconciled — it must stay VISIBLE (first-class
    // registry entry), never hidden by a renderer ternary.
    for (const c of equipmentIdentityConflicts) push('EQUIPMENT-IDENTITY-CONFLICT', c);
    // §14 carry-forward: missing feeder raceway/conduit type authority stays
    // visible and blocking (never weakened by W3).
    if (cs && !(feederRun?.conduitType)) {
      push('FEEDER-RACEWAY-AUTHORITY',
        'Feeder raceway/conduit type not resolved on the canonical feeder segment — raceway + bonding authority required');
    }
    // W10a: conduit fill PENDING was only ever a schedule-cell literal (counted as
    // "0 errors" on PV-4A). Emit it as an ADVISORY blocker so it is enumerated.
    if (cs && ((elec?.conduitFill as any)?.fillPercent == null)) {
      push('CONDUIT-FILL-PENDING',
        'Feeder conduit fill is PENDING (not computed) — it must never be presented as a passing zero-error result on PV-4A/PV-4B');
    }
    // W10a: tap-conductor length is PENDING (no CAD/field datum) — the ≤10-ft
    // NEC 705.11(C) rule cannot be evaluated. Surface it as an advisory blocker
    // rather than only a service-topology PENDING cell.
    if (serviceTopology.some(o => o.type === 'tap-conductors'
      && (o.constraints ?? []).some(k => k.state === 'pending'))) {
      push('TAP-CONDUCTOR-LENGTH-PENDING',
        'Supply-side tap-conductor length is not measured — NEC 705.11(C) ≤10-ft rule is PENDING (never a compliant claim without a length)');
    }
    // §12: W3 canonical structural blockers (framing unverified, missing
    // capacity/fastener source, unsupported mixed assembly, wind/snow
    // authority, untraceable reactions/rails, utilization failures, missing
    // site geometry, PENDING-RACKING-ASSEMBLY-SELECTION). Honest blockers are
    // the correct Braidon outcome.
    for (const sb of structAuth.blockers) push(sb.code, sb.message, { provenance: { source: 'structuralAuthority', ref: null } });
    // §4 (W3.1): promote BLOCKING racking-capacity structural-authority gaps
    // (RT-MINI capacity provenance: RACKING-CAPACITY-SOURCE-NOT-ARCHIVED +
    // RACKING-CAPACITY-APPLICABILITY-GAP) into the readiness registry. Enforced by V32.
    const _rackGaps = ((structAuth.rackingAssembly as unknown as {
      structuralAuthorityGaps?: { code: string; severity: 'blocking' | 'warning'; message: string }[];
    } | null)?.structuralAuthorityGaps) ?? [];
    for (const g of _rackGaps) {
      if (g.severity === 'blocking') push(g.code, g.message, { provenance: { source: 'rackingAssembly.structuralAuthorityGaps', ref: null } });
    }
    // W4 §1/§2: code authority must be VERIFIED and CURRENT for the project
    // jurisdiction. An unverified or edition-incomplete record blocks permit-ready.
    if (codeAuthority.verificationStatus !== 'verified') {
      const _missing = codeAuthority.incompleteEditions.map(k => k.toUpperCase());
      const _detail = _missing.length
        ? `unknown adopted edition for ${_missing.join(', ')} (printed PENDING — no inference)`
        : `code authority unverified (no archived adoption document)`;
      push('CODE-AUTHORITY-INCOMPLETE',
        `Code authority is ${codeAuthority.verificationStatus} for `
          + `${codeAuthority.ahjName ?? 'the project jurisdiction'} — ${_detail}. `
          + `Archive + verify the adoption document (W4-D) before permit-ready.`);
    }
    // §14 — PROJECT LEGAL AUTHORITY VERIFICATION (postal inference is NOT
    // verification). Any unverified-derived field blocks permit-ready.
    if (!_projectAuthorityVerified && (proj.address || proj.city || proj.county || codeAuthority.ahjName)) {
      push('PROJECT-AUTHORITY-UNVERIFIED',
        'Project legal authority (address, APN, municipal boundary, AHJ and fire authority) is operator-posted / postally inferred and not verified from an official source — '
          + 'county/city/AHJ must not be assumed from postal code alone. Verify via the document registry before permit-ready.');
    }
    // §15(d) — production IDENTITY blockers. Previously these only gated the
    // ISSUED-FOR-PERMIT step silently (_projectIdentityValid); now they are
    // first-class registry entries so the reviewer sees WHY the set is not
    // production-ready (Braidon's "…Solar TEST" name + blank designer).
    if (proj.projectName && /\bTEST\b/i.test(String(proj.projectName))) {
      push('PROJECT-NAME-NONPRODUCTION',
        `Project name "${String(proj.projectName)}" contains "TEST" — a non-production identity can never reach an ISSUED/production state`);
    }
    if (!(proj.designer && String(proj.designer).trim())) {
      push('DESIGNER-OF-RECORD-MISSING',
        'No designer / engineer-of-record is assigned — required before a production/issued set');
    }
    // W5 (RP-C): equipment / document readiness (advisory) — a micro with no
    // verified datasheet, or a family/range module page instead of the exact
    // wattage. Structured records carry their own authority path + resolution.
    for (const e of collectEquipmentDocumentBlockers(input)) {
      push(e.code, e.explanation, {
        severity: e.severity,
        authorityPath: e.authorityPath,
        affectedSheets: e.affectedSheets,
        resolutionAction: e.resolutionAction,
        provenance: { source: e.provenance.source, ref: e.provenance.equipmentRecordId ?? e.provenance.documentRecordId ?? null },
      });
    }
    // D-6: engineering review is ALWAYS pending at build (no approved record).
    push('ENGINEERING-REVIEW-PENDING',
      'No approved engineering-review record covering this snapshot digest (D-6)');

    // Back-compat: the code/message list is the BLOCKING subset, single-sourced
    // from the registry — the issue-state derivation, gates, and prior consumers
    // see EXACTLY the blocking authority gaps they always did (advisory warnings
    // are surfaced by the renderer but never gate readiness).
    const blockers = registry
      .filter(r => r.severity === 'blocking' && !r.resolved)
      .map(r => ({ code: r.code, message: r.explanation }));
    return { ready: blockers.length === 0, blockers, registry };
  })();

  // ═══ W4 §3/§12 CANONICAL PROJECT + COVER AUTHORITY ═════════════════════════
  // THE single source for every project-facing value + the derived issue state.
  // No vendor/EOR default is injected here (a missing designer/contractor stays
  // null); the sheet index is the ACTUAL generated manifest; governing codes are
  // a reference to codeAuthority (no edition literal); the issue state derives
  // from the blockers above by domain.
  const _paSections = hybridSheetSections(cad);
  const _paHybrid = _paSections.length > 1;
  const _paSystemType = _paHybrid
    ? `HYBRID — ${_paSections.map(s => SUB_LABEL[s.key]).join(' + ')}`
    : (() => {
        const t = String((cad as any).systemType ?? '').toLowerCase();
        if (t.includes('fence')) return 'SOLAR FENCE';
        if (t.includes('ground')) return 'GROUND MOUNT';
        return 'ROOF MOUNT';
      })();
  const _paInvRec = microInverters[0] ?? stringInverters[0] ?? null;
  const _paHasBattery = (proj.batteryCount ?? 0) > 0 && !!proj.batteryModel;
  // Engineering-review record (certification): always absent at build (the D-6
  // gate). deriveIssueState reads it → currently PENDING; the pure function is
  // tested across all 8 states + the digest-invalidation case independently.
  const _paReview: IssueStateReview | null = null;
  const _paAuthGapBlockers = _permitReadiness.blockers.filter(b => classifyBlockerDomain(b.code) !== 'review');
  // §15(d) — production identity: the project name must NOT contain "TEST" and a
  // designer/engineer-of-record must be present, or the ISSUED-FOR-PERMIT gate
  // fails (Braidon's name is "...Solar TEST" ⇒ this precondition is false).
  const _projectIdentityValid = !!(proj.projectName
    && !/\bTEST\b/i.test(String(proj.projectName))
    && proj.designer && String(proj.designer).trim());
  const _paGateInput: IssuedForPermitGateInput = {
    projectIdentityValid: _projectIdentityValid,
    // Real enforcement is generatePermit's throw on blocking validators; at build
    // we proxy "no known authority gaps" as the blocking-validator signal.
    blockingValidatorsPass: _paAuthGapBlockers.length === 0,
    noEquipmentIdentityConflict: !_permitReadiness.blockers.some(b => b.code === 'EQUIPMENT-IDENTITY-CONFLICT'),
    codeAuthorityVerified: codeAuthority.verificationStatus === 'verified',
    // W4 §8 (closer-wired): manufacturer-document archival is resolved by the
    // ASYNC caller (generatePermit → lib/documents) and threaded in via opts.
    // null ⇒ unresolved (no document / DB unavailable) ⇒ precondition not
    // satisfied (fail-soft). ISSUED FOR PERMIT stays impossible today.
    manufacturerDocumentsArchived: opts?.manufacturerDocumentsArchived ?? null,
    structuralApplicabilityEstablished: !structAuth.engine.engineeringReviewRequired
      && !_paAuthGapBlockers.some(b => classifyBlockerDomain(b.code) === 'structural'),
    engineerReviewCoversCurrentDigest: false,   // no review record at build
    // W4 §12 (closer-wired): a snapshot_digest_invalidations ledger entry (from
    // lib/reconciliation.listActiveInvalidations, resolved async upstream) forces
    // the review-coverage precondition false. Unavailable ⇒ conservative true
    // ('unknown' must NOT satisfy the gate). No effect on today's outcome (review
    // is always null at build) but keeps the gate honest once reviews are wired.
    digestInvalidatedByLedger: opts?.digestInvalidatedByLedger ?? false,
    signatureSealSatisfied: false,               // certification.engineer === null at build
  };
  const projectAuthority = buildProjectAuthority({
    projectName: proj.projectName ?? null,
    customer: proj.clientName ?? null,
    installationAddress: proj.address ?? null,
    city: proj.city ?? null,
    stateCode: typeof proj.state === 'string' ? proj.state : null,
    zip: proj.zip ?? null,
    parcelApn: proj.apn ?? null,
    ahjName: codeAuthority.ahjName,          // single-sourced from code authority
    // §15(b) — the human utility name ("Ameren Illinois"), never the registry
    // slug ("il-ameren-illinois"). Humanized at the single source so every sheet
    // that projects projectAuthority.utility gets the display name.
    utilityName: utilityDisplayName(proj.utilityName ?? '') || null,
    systemType: _paSystemType,
    dcKw: system?.totalDcKw ?? (dcWattsStc > 0 ? dcWattsStc / 1000 : null),
    acKw: system?.totalAcKw ?? (acWattsContinuous > 0 ? acWattsContinuous / 1000 : null),
    moduleCount: system?.totalPanels ?? totalsPanels ?? null,
    equipmentSummary: {
      moduleManufacturer: modules[0]?.manufacturer || null,
      moduleModel: modules[0]?.model || null,
      moduleWatts: modules[0]?.spec.wattsStc ?? null,
      inverterManufacturer: _paInvRec?.manufacturer || null,
      inverterModel: _paInvRec?.model || null,
      inverterType: isMicro ? 'MICROINVERTER' : (topology === 'OPTIMIZER' ? 'POWER OPTIMIZER' : 'STRING INVERTER'),
      mountManufacturer: mount?.manufacturer || null,
      mountModel: mount?.model || null,
      batteryBrand: _paHasBattery ? (proj.batteryBrand ?? null) : null,
      batteryModel: _paHasBattery ? (proj.batteryModel ?? null) : null,
      batteryCount: _paHasBattery ? (proj.batteryCount ?? null) : null,
      combinerLabel: bosBrains ? `${bosBrains.brand} ${bosBrains.model}` : null,
    },
    designer: proj.designer ?? null,          // NO default engineer name
    contractor: proj.contractor ?? proj.installerName ?? proj.installer ?? null,
    issueDate: proj.date ?? null,
    county: proj.county ?? null,                        // §14 municipal-boundary provenance
    authorityVerified: _projectAuthorityVerified,       // §14 — false (no official-source path)
    sheetIndex: computePlansetManifest(input, cad),
    governingCodes: {
      schemaVersion: codeAuthority.schemaVersion,
      verificationStatus: codeAuthority.verificationStatus,
      ahjName: codeAuthority.ahjName,
    },
    generalNotes: [
      'ALL DIMENSIONS ARE NOMINAL. FIELD VERIFY PRIOR TO INSTALLATION.',
      'DO NOT SCALE FROM DRAWINGS.',
      'CONTRACTOR RESPONSIBLE FOR VERIFICATION OF ALL SITE CONDITIONS.',
      'PE STAMP REQUIRED FOR PERMIT SUBMISSION PER AHJ.',
      'SUBSTITUTIONS REQUIRE WRITTEN ENGINEER APPROVAL.',
    ],
    hasDesign: geoModules.length > 0 || (totalsPanels ?? 0) > 0,
    blockers: _permitReadiness.blockers,
    review: _paReview,
    currentDigest: '',                         // review === null ⇒ digest unused
    gateInput: _paGateInput,
    capturedAtIso: _capturedIso,
  });

  const snapshot: PermitDesignSnapshot = {
    codeAuthority,
    projectAuthority,
    meta: {
      snapshotId: '', digest: '', schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      engineVersion: String(PLANSET_ENGINE_VERSION),
      generatedAtIso: (input as any).generatedAtIso ?? proj.date ?? '',
      projectId: opts?.projectId ?? (input as any).projectId ?? null,
      designVersionId: opts?.designVersionId ?? null,
    },
    sourceInputs: {
      clientElectrical: (input as any)._clientElectrical ?? null,
      clientBackfeedBreakerA: (input as any)._clientBackfeedBreakerA ?? null,
      clientWireGauge: proj.wireGauge ?? null,
      clientTotals: {
        totalPanels: (input as any)._clientTotals?.totalPanels ?? null,
        totalDcKw: (input as any)._clientTotals?.totalDcKw ?? null,
        totalAcKw: (input as any)._clientTotals?.totalAcKw ?? null,
      },
    },
    project: {
      clientName: proj.clientName ?? null, address: proj.address ?? null,
      parcelApn: proj.apn ?? null, lat: proj.lat ?? null, lng: proj.lng ?? null,
      utility: { name: proj.utilityName ?? null, id: null },
      ahj: {
        name: codeAuthority.ahjName,
        // W4 §1: adopted editions are PROJECTED from codeAuthority (single
        // source). Unknown adoptions are '—', never inferred. codesSource is
        // 'ahj-record' only when the authority is verified; otherwise 'default'
        // (⇒ UNVERIFIED marker) — matching the honest verification state.
        adoptedCodes,
        codesSource: codeAuthority.verificationStatus === 'verified' ? 'ahj-record' : 'default',
        localAmendments: codeAuthority.localAmendments,
        recordCapturedAtIso: _capturedIso,
      },
      interconnection: {
        method: proj.interconnectionMethod ?? 'LOAD_SIDE',
        rule: String(proj.interconnectionMethod ?? '').toUpperCase().includes('SUPPLY') ? '705.11' : '705.12(B)',
      },
      thermal: (() => {
        const minC = proj.designTempMin ?? temps.ashraeExtremeLowC;
        // V15 (W2): the electrical engine stashes the thermal basis it ACTUALLY
        // ran with; any mismatch with the snapshot basis is a blocking
        // violation — one thermal regime per package, verified not assumed.
        const engT = (input as unknown as { _engineThermal?: { designTempMin?: number } })._engineThermal;
        const mismatch = engT?.designTempMin != null && engT.designTempMin !== minC;
        return {
          designTempMinC: minC,
          designTempHighC: temps.ashrae2pctHighC ?? 35,
          rooftopAdderC: 33,
          source: proj.designTempMin != null ? 'ahj-override' : 'ashrae-envelope',
          provenance: {
            source: 'designTemps.ts',
            note: mismatch
              ? `ENGINE THERMAL MISMATCH: engine ran at ${engT!.designTempMin}°C vs snapshot ${minC}°C`
              : (engT ? undefined : 'engine thermal basis not reported this generation'),
          },
        };
      })(),
      provenance: { source: 'permit-route enrichment' },
    },
    equipment: {
      modules, microInverters, stringInverters, mount, rail: null,
      combinerLabel: bosBrains ? `${bosBrains.brand} ${bosBrains.model}` : null,
    },
    geometry: {
      roofPlanes, modules: geoModules,
      moduleInstances: structAuth.moduleInstances,
      roofPlaneObjects: structAuth.roofPlaneObjects,
      coordinateSystem: {
        id: CANONICAL_COORDINATE_SYSTEM_ID, units: 'ft',
        description: 'site-plan feet — equirectangular local ft, origin = array centroid, +x east / +y north, plan-projected (not plan-rotated, not display-regularized). Every physical object shares this frame.',
      },
      drawingTransforms: structAuth.drawingTransforms,
      provenance: { source: 'project.panelPositions + cad.roof.planes + W3 structural authority' },
      gaps: [
        ...(structAuth.moduleInstances.length ? [] : ['module footprints unavailable — exact record dims missing (W3 blocker)']),
        ...(structAuth.roofPlaneObjects.some(p => p.pathwayPolygons.length) ? []
            : ['access-pathway polygons pending true routed roof geometry (width authority carried on plane object)']),
        // §2: module outlines, rails, attachment feet + splice markers are ALL
        // drawn as PURE PROJECTIONS of the canonical coordinates
        // (viewport∘DT-SITE) with BLOCKING drawn==transform(canonical) parity
        // (V30/V31). Module display-straightening (azimuth orientation + cos-pitch
        // foreshorten) lives in `moduleInstances[].drawnPolygon` (snapshot build),
        // NOT the renderer; positions stay raw canonical (no panel moved). The RAW
        // `polygon` remains the area/physical-truth basis (V21). Remaining honest
        // gap: RAIL-LESS direct-mount products (RT-APEX / E-Mount AIR / S-5 /
        // EcoFasten) have no canonical attachment objects yet, so their mounts are
        // drawn on the legacy path and are NOT projected from canonical — recorded
        // here + in structural.gaps ('no canonical rail objects … rail-less').
        // W4 closer: a canonical DIRECT-MOUNT array has attachment objects but no
        // rails — gate on rails OR attachments so a rail-less array whose mounts
        // ARE canonical (att-dm-*) is not falsely reported as un-derived.
        ...((structAuth.rails.length || structAuth.attachments.length) ? [] : ['rail-less direct-mount placement not yet canonical (mount coordinates un-derived) — mounts drawn on legacy path, not projected from canonical (recorded gap)']),
        ...equipmentIdentityConflicts.map(c => `EQUIPMENT IDENTITY CONFLICT: ${c}`),
      ],
    },
    electrical: {
      topology: auth.isHybrid ? 'HYBRID' : topology,
      engineOfRecord: 'computeSystem',
      microInverterUnits: microUnits, branches, conductors,
      groundingObjects,
      routeSegments,
      serviceTopology,
      feeder: {
        conductorId: feederConductorId,
        ocpdA: cs?.backfeedBreakerAmps ?? cs?.acOcpdAmps ?? null,
        continuousA: cs?.acContinuousCurrentA ?? null,
        currentA: cs?.acOutputCurrentA ?? null,
        voltageDropPct: feederRun?.voltageDropPct ?? null,
        conduit: { raceway: feederRun?.conduitType ?? null, tradeSizeIn: feederRun?.conduitSize ?? null,
                   fillPct: (elec?.conduitFill as any)?.fillPercent ?? null },
      },
      poi: {
        method: proj.interconnectionMethod ?? 'LOAD_SIDE',
        busbarA: proj.panelBusRating ?? proj.mainPanelAmps ?? null,
        mainBreakerA: proj.mainPanelAmps ?? null,
        backfeedA: cs?.backfeedBreakerAmps ?? proj.backfeedBreakerA ?? null,
        rulePasses: (elec?.busbar as any)?.passes ?? null,
      },
      parity: { legacyEngine: 'runElectricalCalc', legacyRan, checks: parityChecks, unresolved: parityUnresolved },
      provenance: { source: 'computeSystem (canonical) + planMicroBranches(D-1 assignment)' },
      gaps: cs ? [] : ['canonical engine result missing — generation should have failed closed'],
    },
    structural: {
      mountRecordId: mount?.recordId ?? null,
      // W3: these scalars now DERIVE from the canonical rail/attachment objects
      // (single source), replacing the null/estimate mirror.
      attachmentCount: structAuth.attachments.length || (proj.attachmentCount ?? null),
      attachmentSpacingIn: structAuth.attachments.length
        ? ((structAuth.rails[0]?.spanConfigIn) ?? (struct?.attachment as any)?.maxAllowedSpacing ?? null)
        : ((struct?.attachment as any)?.maxAllowedSpacing ?? null),
      railTotalFt: structAuth.rails.length
        ? Math.round(structAuth.rails.reduce((s, r) => s + r.physicalLengthIn, 0) / 12 * 100) / 100 : null,
      railCount: structAuth.rails.length || null,
      spliceCount: structAuth.rails.length
        ? structAuth.rails.reduce((s, r) => s + r.spliceCount, 0) : null,
      loads: {
        windSpeedMph: (struct?.wind as any)?.windSpeed ?? proj.windSpeedMph ?? null,
        exposure: (struct?.wind as any)?.exposureCategory ?? null,
        snowPsf: (struct?.snow as any)?.groundSnowLoad ?? null,
        source: (struct?.wind as any)?.windSpeed != null ? 'structural-engine-v4' : 'default-unverified',
      },
      governing: {
        utilization: structAuth.engine.governingUtilization ?? (struct?.rafter as any)?.utilizationRatio ?? null,
        safetyFactor: (struct?.attachment as any)?.safetyFactor ?? null,
        passes: structAuth.engine.passes,
      },
      // ── W3 canonical structural authority ──────────────────────────────
      rackingAssembly: structAuth.rackingAssembly,
      rails: structAuth.rails,
      attachments: structAuth.attachments,
      env: structAuth.env,
      checks: structAuth.checks,
      engine: structAuth.engine,
      // §10 — structural BOM rows + reconciliation, derived from the objects.
      bom: structAuth.bom,
      bomReconciliation: structAuth.bomReconciliation,
      reactionReconciliation: structAuth.reactionReconciliation,
      provenance: { source: 'W3 structural authority (structural-engine-v4 objects + mounting-hardware-db + fire-setback engine)' },
      gaps: [
        // W4 closer: rails OR direct-mount attachments count as canonical
        // placement; only a truly rail-less array with NO attachment objects is
        // an un-derived gap here.
        ...((structAuth.rails.length || structAuth.attachments.length) ? [] : ['no canonical rail objects (non-roof or rail-less/unresolved mount)']),
        ...(structAuth.engine.engineeringReviewRequired
          ? ['STRUCTURAL ENGINEERING REVIEW REQUIRED — ' + (structAuth.engine.reviewReasons[0] ?? 'framing unverified')] : []),
      ],
    },
    derived: {
      moduleCount: totalsPanels,
      dcWattsStc,
      acWattsContinuous,
      branchCount: branches.length,
      feederContinuousA: cs?.acContinuousCurrentA ?? auth.poi?.requiredA ?? null,
      provenance: { source: 'snapshot builder (Σ over snapshot objects)' },
    },
    certification: { engineeringReviewApproved: false, engineer: null },
    permitReadiness: _permitReadiness,
  };

  const digest = computeSnapshotDigest(snapshot as unknown as Record<string, unknown>);
  (snapshot.meta as { digest: string }).digest = digest;
  (snapshot.meta as { snapshotId: string }).snapshotId = snapshotIdFromDigest(digest);
  return snapshot;
}

export { deepFreeze };
