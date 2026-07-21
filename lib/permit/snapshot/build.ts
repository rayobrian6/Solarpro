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
  const branches: BranchRecord[] = auth.microBranches.map((b, i) => ({
    branchId: `br-${i + 1}`, label: `B${b.index}`,
    deviceIds: plan ? positions.filter(p => plan.assign.get(String(p.id)) === i).map(p => String(p.id)) : [],
    moduleCount: b.deviceCount,
    currentA: b.branchCurrentA, continuousA: b.continuousA, ocpdA: b.ocpdAmps,
    conductorId: addConductor(b.wireGauge, 'THWN-2', 'conductorAuthority.microBranchRow'),
    egcConductorId: b.egcGauge ? addConductor(b.egcGauge, null, 'conductorAuthority (NEC 250.122)') : null,
  }));
  const microUnits = isMicro ? geoModules.map(g => ({
    deviceId: `mi-${g.moduleId}`, moduleId: g.moduleId,
    inverterRecordId: invRecord?.recordId ?? 'inv-1',
    branchId: plan ? `br-${(plan.assign.get(g.moduleId) ?? 0) + 1}` : (branches[0]?.branchId ?? 'br-1'),
  })) : [];

  const feederConductorId = addConductor(auth.acFeeder.wireGauge, 'THWN-2', 'electrical-engine/conductorAuthority', auth.acFeeder.ampacityA ?? null);
  const egcId = addConductor(auth.egc.gauge, null, auth.egc.source === 'engine' ? 'electrical-engine' : 'nec-250.122');

  // D-2 shadow: computeSystem parity probe (report-only, never authority —
  // "never two authoritative electrical results"). Every compared output
  // lands in the parity MATRIX; disagreements also go to `divergences`.
  const shadowDivergences: string[] = [];
  const shadowChecks: { name: string; engineOfRecord: string; shadow: string; agree: boolean }[] = [];
  let shadowRan = false;
  const _chk = (name: string, eor: unknown, sh: unknown, agree?: boolean) => {
    const a = agree ?? String(eor) === String(sh);
    shadowChecks.push({ name, engineOfRecord: String(eor ?? '—'), shadow: String(sh ?? '—'), agree: a });
    if (!a) shadowDivergences.push(`${name}: engineOfRecord=${eor} computeSystem=${sh}`);
  };
  try {
    const shadow: any = buildComputeSystemShadow(input, cad);
    if (shadow) {
      shadowRan = true;
      const sBf = shadow.backfeedBreakerAmps;
      if (isFinite(sBf) && auth.acFeeder.ocpdAmps != null) _chk('feeder OCPD (A)', auth.acFeeder.ocpdAmps, sBf);
      const sBr = shadow.microBranches?.length;
      if (isMicro && isFinite(sBr)) _chk('branch count', branches.length, sBr);
      const runs: any[] = shadow.runs ?? [];
      const feederRun = runs.find((r: any) => ['COMBINER_TO_DISCO_RUN', 'INV_TO_DISCO_RUN'].includes(String(r?.id)));
      if (feederRun?.wireGauge && auth.acFeeder.wireGauge) _chk('feeder gauge', auth.acFeeder.wireGauge, feederRun.wireGauge);
      if (feederRun?.egcGauge && auth.egc.gauge) _chk('system EGC', auth.egc.gauge, feederRun.egcGauge);
      if (isFinite(feederRun?.voltageDropPct) && isFinite(auth.acFeeder.voltageDropPct as number)) {
        _chk('feeder V-drop (%)', auth.acFeeder.voltageDropPct, feederRun.voltageDropPct,
          Math.abs(Number(auth.acFeeder.voltageDropPct) - Number(feederRun.voltageDropPct)) <= 0.5);
      }
      if (isMicro && shadow.microBranches?.length) {
        const shMax = Math.max(...shadow.microBranches.map((b: any) => Number(b?.ocpdAmps) || 0));
        const eorMax = Math.max(0, ...auth.microBranches.map(b => b.ocpdAmps));
        if (shMax > 0) _chk('governing branch OCPD (A)', eorMax, shMax);
      }
    }
  } catch (e: any) {
    shadowDivergences.push(`computeSystem shadow failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }

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
        ...(() => {
          // Stored-authority conflict detector: §1.1 subSystems map panelId vs
          // the fleet model. Mismatch = a data-integrity finding for Ray.
          const out: string[] = [];
          for (const [k, sub] of Object.entries((proj.subSystems ?? {}) as Record<string, any>)) {
            const mapped: any = sub?.panelId ? getPanelById(sub.panelId) : null;
            if (mapped && modules[0] && mapped.id !== modules[0].catalogId) {
              out.push(`EQUIPMENT IDENTITY CONFLICT: subSystems.${k}.panelId='${sub.panelId}' (${mapped.manufacturer} ${mapped.model}) vs fleet module '${modules[0].model}' — reconcile (migration 110 territory)`);
            }
          }
          return out;
        })(),
      ],
    },
    electrical: {
      topology: auth.isHybrid ? 'HYBRID' : topology,
      engineOfRecord: 'runElectricalCalc',
      microInverterUnits: microUnits, branches, conductors,
      feeder: {
        conductorId: feederConductorId,
        ocpdA: auth.acFeeder.ocpdAmps, continuousA: auth.poi?.requiredA ?? null,
        currentA: auth.poi?.continuousA ?? null,
        voltageDropPct: auth.acFeeder.voltageDropPct,
        conduit: { raceway: auth.acFeeder.conduitType ?? null, tradeSizeIn: auth.acFeeder.conduitSize ?? null,
                   fillPct: (elec?.conduitFill as any)?.fillPercent ?? null },
      },
      systemEgc: { conductorId: egcId, basisOcpdA: auth.egc.basisOcpd ?? null },
      poi: {
        method: proj.interconnectionMethod ?? 'LOAD_SIDE',
        busbarA: proj.panelBusRating ?? proj.mainPanelAmps ?? null,
        mainBreakerA: proj.mainPanelAmps ?? null,
        backfeedA: proj.backfeedBreakerA ?? null,
        rulePasses: (elec?.busbar as any)?.passes ?? null,
      },
      shadowParity: { shadowEngine: 'computeSystem', ran: shadowRan, divergences: shadowDivergences, checks: shadowChecks },
      provenance: { source: 'runElectricalCalc + conductorAuthority + planMicroBranches(D-1)' },
      gaps: ['per-segment conduit model arrives with computeSystem engine-of-record (W2)'],
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
      feederContinuousA: auth.poi?.requiredA ?? null,
      provenance: { source: 'snapshot builder (Σ over snapshot objects)' },
    },
    certification: { engineeringReviewApproved: false, engineer: null },
  };

  const digest = computeSnapshotDigest(snapshot as unknown as Record<string, unknown>);
  (snapshot.meta as { digest: string }).digest = digest;
  (snapshot.meta as { snapshotId: string }).snapshotId = snapshotIdFromDigest(digest);
  return snapshot;
}

export { deepFreeze };
