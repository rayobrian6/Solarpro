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
  SNAPSHOT_SCHEMA_VERSION, type PermitDesignSnapshot, type EquipmentRecord,
  type ModuleSpec, type MicroInverterSpec, type StringInverterSpec, type MountSpec,
  type RailSpec, type ConductorRecord, type BranchRecord,
} from './types';
import { computeSnapshotDigest, snapshotIdFromDigest, deepFreeze } from './digest';
import { buildConductorAuthority } from '../utils/conductorAuthority';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { planMicroBranches, microMaxPerBranch, microBranchMaxOcpdA, type BranchPlanPanel } from '../utils/branching';
import { getDesignTemps } from '../utils/designTemps';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, getPanelById } from '@/lib/equipment-db';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { getManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { buildComputeSystemShadow } from '../utils/computedRuns';
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
  opts?: { projectId?: string | null; designVersionId?: string | null },
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
      manufacturer: db?.manufacturer ?? '', model: db?.model ?? m, sku: db?.sku ?? null,
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
      manufacturer: db?.manufacturer ?? '', model: db?.model ?? m, sku: db?.sku ?? null,
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
  const routeSegments: import('./types').RouteSegmentRecord[] = ((cs?.runs ?? []) as any[]).map((r: any) => ({
    segmentId: String(r.id), from: String(r.fromLabel ?? r.from ?? ''), to: String(r.toLabel ?? r.to ?? ''),
    oneWayFt: isFinite(r.onewayLengthFt) ? r.onewayLengthFt : null,
    lengthSource: 'cad-derived-estimate',
    raceway: r.isOpenAir ? 'FREE_AIR' : (r.conduitType ?? null),
    tradeSizeIn: r.conduitSize ?? null,
    fillPct: isFinite(r.conduitFillPercent) ? r.conduitFillPercent : null,
    conductorGauge: r.wireGauge ?? null,
    conductorCallout: r.conductorCallout ?? null,
    egcGauge: r.egcGauge ?? null,
    voltageDropPct: isFinite(r.voltageDropPct) ? r.voltageDropPct : null,
    ocpdA: isFinite(r.ocpdAmps) ? r.ocpdAmps : null,
    tempDeratingFactor: isFinite(r.tempDeratingFactor) ? r.tempDeratingFactor : null,
    provenance: { source: 'computeSystem runs (deriveRunLengths cad estimate)' },
  }));

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
  const nec = /^(2017|2020|2023)$/.test(necRaw) ? necRaw : '2023';
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

  const snapshot: PermitDesignSnapshot = {
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
        name: (compliance?.jurisdiction as any)?.ahj ?? proj.ahjName ?? null,
        adoptedCodes: { nec, ibc: '2021', irc: '2021', ifc: nec === '2023' ? '2024' : '2021', asce: '7-22' },
        codesSource: necFromRecord ? 'ahj-record' : 'default',
        localAmendments: [],
        recordCapturedAtIso: (input as any).generatedAtIso ?? '',
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
      provenance: { source: 'project.panelPositions + cad.roof.planes' },
      gaps: [
        'setback/pathway polygons remain sheet-computed until W3',
        'module footprints (record dims × coordinates) not yet snapshot-owned (V8 deferred to W3)',
        ...equipmentIdentityConflicts.map(c => `EQUIPMENT IDENTITY CONFLICT: ${c}`),
      ],
    },
    electrical: {
      topology: auth.isHybrid ? 'HYBRID' : topology,
      engineOfRecord: 'computeSystem',
      microInverterUnits: microUnits, branches, conductors,
      groundingObjects,
      routeSegments,
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
      attachmentCount: proj.attachmentCount ?? null,
      attachmentSpacingIn: (struct?.attachment as any)?.maxAllowedSpacing ?? null,
      railTotalFt: null, railCount: null,
      spliceCount: null,
      loads: {
        windSpeedMph: (struct?.wind as any)?.windSpeed ?? proj.windSpeedMph ?? null,
        exposure: (struct?.wind as any)?.exposureCategory ?? null,
        snowPsf: (struct?.snow as any)?.groundSnowLoad ?? null,
        source: (struct?.wind as any)?.windSpeed != null ? 'structural-engine-v4' : 'default-unverified',
      },
      governing: {
        utilization: (struct?.rafter as any)?.utilizationRatio ?? null,
        safetyFactor: (struct?.attachment as any)?.safetyFactor ?? null,
        passes: (struct?.rafter as any)?.utilizationRatio != null
          ? (struct as any).rafter.utilizationRatio <= 1.0 : null,
      },
      provenance: { source: 'structural-engine-v4 via compliance.structural' },
      gaps: [
        'attachment/rail coordinates not engine-derived (drawings place feet independently) — W3',
        'rail totals live in rackingBOM (BOM path) and are not yet snapshot-carried — W3',
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
    permitReadiness: (() => {
      const blockers: { code: string; message: string }[] = [];
      // Req. 3: no authoritative routed geometry exists — segment lengths are
      // CAD-derived ESTIMATES. Identified, never silently used as authority-grade.
      if (routeSegments.some(r => r.lengthSource !== 'cad-route' && r.lengthSource !== 'field-measurement')) {
        blockers.push({ code: 'ROUTE-LENGTH-ESTIMATE',
          message: 'Electrical run lengths are CAD-derived estimates — authoritative routed geometry or field measurement required for permit-ready status' });
      }
      // Req. 7: stored equipment-identity conflict (e.g. Braidon subSystems
      // panelId vs fleet model) BLOCKS permit-ready until operator reconciliation.
      for (const c of equipmentIdentityConflicts) blockers.push({ code: 'EQUIPMENT-IDENTITY-CONFLICT', message: c });
      blockers.push({ code: 'ENGINEERING-REVIEW-PENDING',
        message: 'No approved engineering-review record covering this snapshot digest (D-6)' });
      return { ready: blockers.length === 0, blockers };
    })(),
  };

  const digest = computeSnapshotDigest(snapshot as unknown as Record<string, unknown>);
  (snapshot.meta as { digest: string }).digest = digest;
  (snapshot.meta as { snapshotId: string }).snapshotId = snapshotIdFromDigest(digest);
  return snapshot;
}

export { deepFreeze };
