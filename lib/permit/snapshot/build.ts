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
import { buildCodeAuthority, resolveAhjRecordTraced } from './codeAuthority';
import {
  buildProjectAuthority, classifyBlockerDomain,
  type IssueStateReview, type IssuedForPermitGateInput,
  type ProjectAuthorityBuildArgs, type ProjectAuthorityRecord,
} from './projectAuthority';
import { decideReviewCoverage, type DigestInvalidationFact } from './reviewCoverage';
import { computePlansetManifest } from '../plansetManifest';
import { hybridSheetSections, SUB_LABEL } from '../sections/subSystemSheets';
import { buildStructuralAuthority, type StructuralRunsBundle } from './structuralAuthority';
import type { RackingCapacityDocumentEvidence } from './rackingAssembly';
import type { FramingCapacityDocumentEvidence, FramingEngineerReviewEvidence } from './framingAuthority';
import type { EnvironmentalLoadSourceEvidence } from './environmentalAuthority';
import { buildConductorAuthority } from '../utils/conductorAuthority';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { utilityDisplayName } from '../utils/helpers';   // §15(b) — human utility name, never a slug
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { planMicroBranches, microMaxPerBranch, microBranchMaxOcpdA, type BranchPlanPanel } from '../utils/branching';
import { getDesignTemps } from '../utils/designTemps';
import { resolveTrunkCablePlan, findTrunkCableSystem } from '@/lib/equipment/trunkCable';
import { deriveBranchCablePaths } from '@/lib/bom/deriveRunLengths';
// WS-5 §13 — the ITEMISED procurement allowance policy for a field-measured
// route. Kept out of this file so the allowances are reviewable in one place and
// so nobody adds a bare percentage next to a length.
import { deriveFieldMeasuredProcurement } from './routeProcurementPolicy';
// WS-5 §12 — the voltage drop is RECOMPUTED from the new length (conductor
// resistance re-read from the gauge), never carried over from the prior length.
import { recalculateRouteVoltageDrop } from './routeVoltageDropRecalc';
// WS-5 §14 — the NAMED closure policy for ROUTE-LENGTH-ESTIMATE, shared with the
// derived resolver so the two emitters cannot drift.
import { sourceClosesRouteLengthRequirement } from '@/lib/fieldMeasurement/resolver';
// AAC WS-5 — the deterministic Q-Cable topology + procurement SOLUTION engine.
import { buildQCableTopology, evaluateQCableSolutions } from './qcableTopology';
import { resolveQCableProcurement } from './qcableProcurement';
import { enphaseFieldTerminationAuthority } from './enphaseFieldTerminationEvidence';
// AAC WS-7 — the conduit-fill completeness + result authority (NEC Ch.9 T1).
import { evaluateConduitFillAuthority, type ConduitFillEvaluation } from './conduitFillAuthority';
// AAC WS-5/WS-7 — the SYNC design-geometry resolver stage (framework contract).
import { runDerivedResolutionStage, mergeResolutionStates } from './resolution/derived';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, getPanelById } from '@/lib/equipment-db';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { getManufacturerAsset, evaluateDocumentApplicability } from '@/lib/manufacturer-assets-db';
import { buildEquipmentDocumentAuthority } from './documentAuthority';
// ECD §7 (WS-2) — racking BONDING authority (requirement vs method).
import { buildRackingBondingAuthority } from './rackingBonding';
// P13 WS-1 — the NEC 250.122 table + the array/racking bonding DESIGN standard,
// kept as separate, separately-sourced facts.
import { getEGCSize } from '@/lib/manufacturer-specs';
import { ARRAY_RACK_BONDING_DESIGN_SIZE, conductorAreaRank } from './groundingDesignStandard';
// P13 — archived Enphase IQ8-series product-grounding evidence (hash-bound).
import { enphaseProductGroundingEvidence } from './enphaseProductGroundingEvidence';
import { buildComputeSystemShadow } from '../utils/computedRuns';
import { collectEquipmentDocumentBlockers } from './equipmentProjection';
import { classifyBlockerSeverity } from './severityPolicy';
import { buildProcurementSufficiency, procurementInsufficiencyPayload, type QCableServiceLoopAllowance } from './procurementSufficiency';
// ECD §5 (W1-F) — supply-side tap CONNECTION authority (honest nulls).
import { buildSupplySideTapConnectionAuthority } from './supplySideTap';
import {
  resolveOpenAirGroundingAuthority, buildGroundingDomainGraph,
  GROUNDING_AUTHORITY_BLOCKER_CODE, type GroundingDocumentEvidence,
} from './groundingAuthority';
import type { CableExtensionSolution, ProcurementSufficiency } from './types';
// AAC WS-1 — resolution state → blocker payload (existing RS-1 machinery).
import type { RequirementResolutionState } from './resolution/types';
import { resolutionStatePayload } from './resolution/evidence';
// AAC WS-2 / WS-6 — the automatic-resolution authority records (evidence for the
// requirements the lifecycle CLEARED; a cleared requirement emits no blocker).
import type { CanonicalEquipmentAuthority } from './resolution/equipmentSelection';
import type { ModuleDatasheetBindingAuthority } from './resolution/datasheetBinding';
import type { ProjectPersonnelAuthority } from '@/lib/personnel/types';
import type { ProjectLegalAuthorityRecord, CodeAdoptionAuthorityRecord } from './resolution/jurisdictionAuthority';
import type { EnvironmentalRetrievalRecord } from './resolution/environmentalRetrieval';
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
    /** PRR §2 — the ACTIVE invalidation ROWS, so an entry can be scoped to the
     *  digest (or approval instant) it names instead of latching the whole
     *  project. `null` ⇒ the ledger read failed ⇒ fail closed; `[]` ⇒ read OK,
     *  nothing active; absent ⇒ no ledger authority in play (pure build/tests). */
    digestInvalidations?: DigestInvalidationFact[] | null;
    /** FRAMING-AUTHORITY GATE — resolved evidence for the framing CAPACITY
     *  authority (async-resolved THROUGH lib/documents / the review record by the
     *  caller). null ⇒ capacity UNVERIFIED ⇒ FRAMING-AUTHORITY-UNVERIFIED fires. */
    framingCapacityDocument?: FramingCapacityDocumentEvidence | null;
    framingEngineerReview?: FramingEngineerReviewEvidence | null;
    framingReviewDigest?: string | null;
    framingProjectApplicabilityKey?: string | null;
    /** AAC WS-8 — the published-document RETRIEVAL record (every source
     *  attempted, HTTP outcome, content hash, archival result, whether the
     *  document covers the SELECTED model, and the cross-reference finding).
     *  Evidence only: it never clears a requirement by itself. */
    structuralDocumentRetrieval?: import('./resolution/structuralDocuments').StructuralDocumentRetrievalRecord | null;
    /** AAC WS-8 (audit §7.7) — REAL DocumentRegistryFacts keyed
     *  `${category}:${equipmentId}`. Absent ⇒ the AUTHORITATIVE verdict stays
     *  unreachable, exactly as before this seam. */
    documentRegistryFacts?: Record<string, import('@/lib/manufacturer-assets-db').DocumentRegistryFacts> | null;
    /** AAC WS-8 — the rail-selection trace (probes, inherent-vs-unselected,
     *  span-screened candidates). Decides PENDING-RACKING-ASSEMBLY-SELECTION. */
    rackingAssemblySelection?: import('./resolution/railSelection').RailSelectionVerdict | null;
    /** AAC WS-8 — the framing retrieval attempt + its AUTO_RETRIEVED →
     *  PROFESSIONAL_APPROVAL mode transition. Evidence only. */
    framingRetrieval?: import('./resolution/types').SnapshotAuthorityInputs['framingRetrieval'];
    /** AAC WS-9 — the digest-bound engineering-review coverage READ from
     *  migration 116. The ONLY thing that can make ENGINEERING-REVIEW-PENDING
     *  clearable, and it is never written by the engine. */
    engineeringReview?: import('@/lib/engineeringReview/types').EngineeringReviewCoverage | null;
    /** WS-5 — the ACTIVE field route measurements READ from migration 118, one
     *  authority per route segment, already reduced by the deterministic
     *  selection rule. The build PROJECTS this; it never produces it. Absent or
     *  null ⇒ every route keeps its CAD length source, exactly as before. */
    fieldRouteMeasurements?: import('@/lib/fieldMeasurement/resolver').FieldRouteMeasurementAuthority | null;
    /** §Q — canonical Q-Cable procurement-deficit resolution solutions, async-
     *  resolved by the caller (operator selection + verified lib/documents record).
     *  Empty/undefined ⇒ no solution ⇒ QCABLE-PROCUREMENT-INSUFFICIENT stays firing
     *  when the design is short (the honest live outcome today). */
    cableExtensionSolutions?: CableExtensionSolution[] | null;
    /** §Q — a DOCUMENTED Q-Cable service-loop / transition allowance. STRICTER-
     *  ONLY: it raises the sufficiency threshold and can never clear a deficit.
     *  null/undefined ⇒ allowance 0 with provenance
     *  `no-allowance-authority-recorded` (byte-identical to before this seam, so
     *  a design without one keeps its digest). */
    qcableServiceLoopAllowance?: QCableServiceLoopAllowance | null;
    /** §2 (BAR) — VERIFIED climate-hazard source (ASCE 7 Hazard-Tool report / AHJ
     *  climate ordinance) resolved by the caller through lib/documents. null ⇒ no
     *  archived source ⇒ operator-entered wind/snow stay UNVERIFIED ⇒
     *  ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED fires (the honest live outcome). */
    environmentalSource?: EnvironmentalLoadSourceEvidence | null;
    /** GROUNDING AUTHORITY (2026-07-25) — the manufacturer document that
     *  EXPLICITLY states the equipment grounding/bonding method for the open-air
     *  branch section of the EXACT selected microinverter + cable assembly,
     *  resolved by the caller through lib/documents. null/undefined ⇒ no such
     *  document ⇒ the outcome is PENDING_MANUFACTURER_AUTHORITY and
     *  QCABLE-GROUNDING-AUTHORITY-UNVERIFIED fires (the honest live outcome). */
    groundingDocumentEvidence?: GroundingDocumentEvidence | null;
    /** WS-2 — THE Q-Cable field-termination authority socket. `undefined` ⇒ use
     *  the archived accessor (the live behaviour). An explicit `null` REFUSES it,
     *  so a caller can exercise the fail-closed path without forcing this project
     *  to be unresolved. Same shape of socket as groundingDocumentEvidence. */
    qcableFieldTerminationAuthority?:
      import('./enphaseFieldTerminationEvidence').EnphaseFieldTerminationAuthority | null;
    /** AAC WS-1 — the per-requirement RequirementResolutionState produced by the
     *  async resolution lifecycle, keyed by requirement code. Attached to each
     *  registry record's PAYLOAD (rendered by the existing RS-1 payload
     *  machinery — no visual redesign). Absent ⇒ payloads unchanged ⇒ the
     *  snapshot digest of a harness/test build is byte-identical. */
    resolutionStates?: Record<string, RequirementResolutionState> | null;
    /** AAC WS-2 / WS-6 — the automatic-resolution AUTHORITY records (canonical
     *  equipment identity + superseded history + reconciliation audit id, module
     *  exact-datasheet coverage, configured personnel). Recorded on the snapshot
     *  as the evidence for the requirements the lifecycle CLEARED (a cleared
     *  requirement emits no blocker, so its evidence needs a home). Absent ⇒ the
     *  field is omitted entirely ⇒ digest unchanged. */
    canonicalEquipment?: CanonicalEquipmentAuthority | null;
    moduleDatasheetBinding?: ModuleDatasheetBindingAuthority | null;
    projectPersonnel?: ProjectPersonnelAuthority | null;
    /** AAC WS-3 / WS-4 — the RETRIEVED authority records. Each carries its
     *  source URL, retrieval timestamp, payload SHA-256 and confidence, and each
     *  is the evidence for a requirement the lifecycle CLEARED. All absent ⇒ the
     *  snapshot field is omitted entirely ⇒ digest unchanged. */
    projectLegalAuthority?: ProjectLegalAuthorityRecord | null;
    codeAdoptionAuthority?: CodeAdoptionAuthorityRecord | null;
    environmentalRetrieval?: EnvironmentalRetrievalRecord | null;
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
  //
  // P13 WS-1 - every record now carries its ROLE, its ENDPOINTS, and the code
  // MINIMUM separately from the DESIGN SELECTION. _gndAtMinimum supplies the
  // honest defaults (selection == the NEC minimum) so a record that does NOT
  // apply a design standard cannot accidentally imply one.
  const groundingObjects: import('./types').GroundingRecord[] = [];
  /** Build a grounding record whose INSTALLED size IS the NEC 250.122 minimum. */
  const _gndAtMinimum = (r: {
    groundingId: string; segmentId: string;
    purpose: import('./types').GroundingRecord['purpose'];
    segmentRole: import('./types').GroundingSegmentRole;
    size: string | null; ocpdA: number | null; ocpdBasis: string;
    sourceNode: string; destinationNode: string;
    insulationState: import('./types').GroundingRecord['insulationState'];
    installationMethod: import('./types').GroundingRecord['installationMethod'];
    routeId: string | null; associatedEquipment: string; provenanceSource: string;
  }): import('./types').GroundingRecord => ({
    groundingId: r.groundingId, segmentId: r.segmentId, purpose: r.purpose,
    segmentRole: r.segmentRole,
    required: true, method: 'conductor', conductorMaterial: 'Cu',
    conductorSize: r.size,
    // The selection IS the minimum here - stated explicitly rather than left to
    // be inferred from equality.
    calculatedMinimumSize: r.size,
    selectedDesignSize: null,
    selectionSource: 'nec-minimum',
    selectionReason: null,
    sizingBasis: `NEC 250.122 @ ${r.ocpdBasis}`,
    associatedOcpdA: r.ocpdA, ocpdBasis: r.ocpdBasis,
    associatedEquipment: r.associatedEquipment,
    sourceNode: r.sourceNode, destinationNode: r.destinationNode,
    insulationState: r.insulationState, installationMethod: r.installationMethod,
    routeId: r.routeId,
    rackingAssemblyId: null, bondingMethod: null, manufacturerEvidenceId: null,
    manufacturerListingBasis: null, codeBasis: 'NEC 250.122',
    calculationId: `calc:egc-250.122:${r.groundingId}`,
    provenance: { source: r.provenanceSource },
  });
  if (isMicro && branchRun) {
    branches.forEach((b) => groundingObjects.push(_gndAtMinimum({
      groundingId: `gnd-${b.branchId}`, segmentId: 'BRANCH_RUN',
      purpose: 'branch-egc', segmentRole: 'BRANCH_EGC',
      size: branchRun.egcGauge ?? null,
      ocpdA: b.ocpdA, ocpdBasis: `${b.ocpdA}A branch OCPD`,
      // The AC BRANCH CIRCUIT equipment grounding conductor - NOT a
      // "microinverter EGC". No claim is made here about whether the selected
      // Enphase equipment requires a separate product grounding conductor; that
      // is the openAirGroundingAuthority question, on its own evidence.
      sourceNode: `AC branch ${b.label} (microinverter output)`,
      destinationNode: 'Rooftop junction box equipment-ground bus',
      insulationState: 'insulated-green', installationMethod: 'free-air',
      routeId: 'BRANCH_RUN',
      associatedEquipment: `AC branch ${b.label}`,
      provenanceSource: 'computeSystem BRANCH_RUN',
    })));
  }
  if (feederRun) {
    groundingObjects.push(_gndAtMinimum({
      groundingId: 'gnd-feeder', segmentId: String(feederRun.id),
      purpose: 'feeder-egc', segmentRole: 'FEEDER_EGC',
      size: feederRun.egcGauge ?? null,
      ocpdA: feederRun.ocpdAmps ?? cs?.acOcpdAmps ?? null,
      ocpdBasis: `${feederRun.ocpdAmps ?? cs?.acOcpdAmps ?? '?'}A feeder OCPD`,
      sourceNode: 'PV AC combiner panel equipment-ground bus',
      destinationNode: 'AC disconnect → point of interconnection ground bus',
      insulationState: 'insulated-green', installationMethod: 'in-raceway',
      routeId: String(feederRun.id),
      associatedEquipment: 'AC feeder (combiner → disconnect → POI)',
      provenanceSource: 'computeSystem feeder segment',
    }));
    const raceway = String(feederRun.conduitType ?? '').toUpperCase();
    if (raceway.includes('EMT')) {
      groundingObjects.push({
        groundingId: 'gnd-raceway', segmentId: String(feederRun.id), purpose: 'raceway-bond',
        segmentRole: 'RACEWAY_BOND',
        required: true, method: 'raceway', conductorMaterial: null, conductorSize: null,
        calculatedMinimumSize: null, selectedDesignSize: null,
        selectionSource: null, selectionReason: null,
        sizingBasis: null, associatedOcpdA: null, ocpdBasis: null,
        associatedEquipment: 'EMT raceway + listed fittings',
        sourceNode: 'PV AC combiner panel enclosure',
        destinationNode: 'AC disconnect enclosure',
        insulationState: null, installationMethod: 'integral-to-assembly',
        routeId: String(feederRun.id),
        rackingAssemblyId: null, bondingMethod: 'listed metallic raceway + fittings',
        manufacturerEvidenceId: null,
        calculationId: null,
        manufacturerListingBasis: null,
        codeBasis: 'NEC 250.118(4) — EMT is a permitted equipment grounding conductor; bonding via listed fittings',
        provenance: { source: 'computeSystem feeder segment (raceway type)' },
      });
    }
  }
  groundingObjects.push({
    groundingId: 'gnd-gec', segmentId: 'SERVICE', purpose: 'gec', segmentRole: 'GEC',
    required: false, method: 'none-required', conductorMaterial: null, conductorSize: null,
    calculatedMinimumSize: null, selectedDesignSize: null,
    selectionSource: null, selectionReason: null,
    sizingBasis: null, associatedOcpdA: null, ocpdBasis: null,
    associatedEquipment: 'Existing service grounding electrode system',
    sourceNode: null, destinationNode: null,
    insulationState: null, installationMethod: null, routeId: null,
    rackingAssemblyId: null, bondingMethod: null, manufacturerEvidenceId: null,
    calculationId: null,
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
  // WS-5 §12 — the per-segment SYSTEM VOLTAGE, captured here because it is the
  // one voltage-drop input the RouteSegmentRecord does not carry and the
  // recalculation cannot be honest without it. Captured from the engine's own
  // run model at mapping time so a re-derivation never has to guess 240 V.
  const _segSystemVoltage = new Map<string, number>();
  // …and the CURRENT the engine's own voltage-drop call consumed. The engine
  // names this field `continuousCurrent` (computed-system RunSegment:196) and
  // the snapshot's `continuousCurrentA` / `operatingCurrentA` read
  // `r.continuousCurrentA` / `r.currentA`, which the engine never emits — so
  // those two segment fields are null on EVERY run today. That pre-existing
  // projection gap is NOT repaired here (populating them changes what PV-4B
  // prints on every project, which is its own change with its own regression
  // surface); it is captured so the WS-5 recalculation uses the SAME current the
  // original result was computed from, and named in the provenance it writes.
  const _segCurrentA = new Map<string, number>();
  const routeSegments: import('./types').RouteSegmentRecord[] = ((cs?.runs ?? []) as any[]).map((r: any) => {
    const _isOpenAir = !!r.isOpenAir;
    if (isFinite(r.systemVoltage)) _segSystemVoltage.set(String(r.id), r.systemVoltage);
    {
      const _engineCurrent = isFinite(r.continuousCurrent) ? r.continuousCurrent
        : isFinite(r.continuousCurrentA) ? r.continuousCurrentA
        : isFinite(r.operatingCurrentA) ? r.operatingCurrentA
        : isFinite(r.currentA) ? r.currentA : null;
      if (_engineCurrent != null) _segCurrentA.set(String(r.id), _engineCurrent);
    }
    const _opA = isFinite(r.operatingCurrentA) ? r.operatingCurrentA
      : (isFinite(r.currentA) ? r.currentA : null);
    const _contA = isFinite(r.continuousCurrentA) ? r.continuousCurrentA
      : (_opA != null ? Math.round(_opA * 1.25 * 100) / 100 : null);
    // §7 — the NEC article comes from the raceway TYPE authority (never a
    // hardcoded literal). Open-air carries no raceway article.
    const _rwArticle = _isOpenAir ? null
      : (r.physicalRaceway?.necArticle
         ?? (String(r.conduitType ?? '').toUpperCase().includes('PVC') ? '352'
             : String(r.conduitType ?? '').toUpperCase().includes('EMT') ? '358'
             : String(r.conduitType ?? '').toUpperCase().includes('RMC') ? '344'
             : null));

    // ── WS-3 — THE CALLOUT IS DERIVED FROM THIS RECORD'S OWN RACEWAY ────────
    // The engine's `run.conductorCallout` is a legacy concatenation that carries
    // a SECOND, hard-coded raceway: every in-conduit run arrived here reading
    // `IN 1-1/4" 3/4" EMT` — two trade sizes, and `EMT` contradicting the same
    // record's `raceway: 'PVC Sch 80'`. `projectCanonicalFeeder` already refused
    // that string and rebuilt the sheets' callout from canonical parts
    // (electricalProjection.ts §3), which is why nothing corrupt PRINTS — but
    // the snapshot is the digest-bound archive of record, and it was storing a
    // conduit statement that contradicted its own raceway authority. Fixing it
    // downstream left the authority itself wrong.
    //
    // So it is derived HERE, from the very fields this record publishes, and the
    // legacy string is never trusted. When the canonical parts are absent the
    // callout is null: a missing statement is honest, a contradicting one is not.
    const _calloutRaceway = _isOpenAir ? null : (r.conduitType ?? null);
    const _calloutSize = _isOpenAir ? null : (r.conduitSize ?? null);
    const _calloutGauge = r.wireGauge ?? null;
    const _calloutEgc = r.egcGauge ?? null;
    // The callout describes WHAT IS IN THE RACEWAY, so its conductor count is the
    // RACEWAY's, not the segment's. `run.conductorCount` is PER CIRCUIT: the
    // shared branch home-run reports 2 while three branch circuits share that
    // raceway — 6 current-carrying #10s plus one #12 EGC, which is exactly what
    // the raceway authority publishes (conductorCount 7, currentCarrying 6).
    // Deriving from the segment alone would trade a wrong RACEWAY for a wrong
    // CONDUCTOR COUNT. Total minus the single EGC gives the hot/neutral count
    // the callout names; segments with no raceway object (utility-owned service
    // equipment) keep their own count.
    const _rwConductorTotal = isFinite(r.physicalRaceway?.conductorCount) ? r.physicalRaceway.conductorCount : null;
    const _segConductorCount = isFinite(r.conductorCount) ? r.conductorCount : null;
    const _calloutCount = (!_isOpenAir && _rwConductorTotal != null)
      ? Math.max(1, _rwConductorTotal - (r.egcGauge ? 1 : 0))
      : _segConductorCount;
    const _calloutInsul = r.insulation ?? (_isOpenAir && isMicro ? 'TC-ER' : (r.isDc ? 'USE-2' : 'THWN-2'));
    const _derivedCallout: string | null = (_calloutGauge && _calloutCount != null)
      ? [
          `${_calloutCount}×${_calloutGauge} ${_calloutInsul}`,
          _calloutEgc ? `1×${_calloutEgc} GRN EGC` : null,
          _isOpenAir
            ? 'OPEN AIR — NEC 690.31'
            : (_calloutRaceway && _calloutSize ? `IN ${_calloutSize} ${_calloutRaceway}` : null),
        ].filter(Boolean).join('\n')
      : null;

    // ── D1 (Planset 17) — OWNERSHIP CROSSES THE SNAPSHOT BOUNDARY ──────────
    // The engine has always known this: `isUtilityOwned: true` is set on the
    // MSP → utility run by computed-system.ts:1886 AND segment-builder.ts:582,
    // and the BOM/raceway layers honour it (computed-system.ts:2434 skips it
    // when building physicalRaceways). But the run→record mapper never copied
    // it, so the fact DIED HERE — and the two route counters downstream then
    // treated all six segments as one homogeneous population and reported
    // "5 of 6 electrical run(s) … require a field-measured route", directing the
    // operator to field-measure a run the installer does not own.
    //
    // Carried explicitly rather than re-derived: consumers must not infer
    // exclusion from a missing raceway object (a project run with no raceway is
    // a DEFECT, not an exclusion) nor from the segment id.
    const _utilityOwned = r.isUtilityOwned === true;
    return {
      segmentId: String(r.id), from: String(r.fromLabel ?? r.from ?? ''), to: String(r.toLabel ?? r.to ?? ''),
      routeOwnership: _utilityOwned ? 'UTILITY_OWNED' : 'PROJECT_OWNED',
      routeAuthorityApplicability: _utilityOwned ? 'EXCLUDED' : 'REQUIRED',
      routeApplicabilityReason: _utilityOwned
        ? 'Utility-owned service equipment — routed, owned and maintained by the serving utility; not within the PV project scope for route measurement, raceway authority or procurement.'
        : null,
      // §3 — prefer the engine's explicit electrical function (the sectioned
      // branch model tags open-air Q-Cable vs shared home-run raceway).
      electricalFunction: r.electricalFunction ?? _elecFunction(String(r.id), _isOpenAir),
      physicalRacewayId: r.physicalRacewayId ?? null,
      sharedCircuitCount: isFinite(r.sharedCircuitCount) ? r.sharedCircuitCount : null,
      minimumCodeRacewaySize: r.minimumCodeRacewaySize ?? null,
      racewayNecArticle: _rwArticle,
      upsizingReason: r.upsizingReason ?? null,
      oneWayFt: isFinite(r.onewayLengthFt) ? r.onewayLengthFt : null,
      // ── WS-5 — THE LENGTH AUTHORITY, POPULATED ────────────────────────────
      // These four fields used to be two hardcoded literals and five undefineds.
      // `lengthSource` and `verificationStatus` were BOTH pinned to
      // 'cad-derived-estimate' here, and one later mutation set `lengthSource`
      // (only) to 'cad-route' for the branch run — which is how BRANCH_RUN came
      // to say its length was routed geometry while its verification said
      // estimate. Source and verification are different questions and are now
      // resolved together, from ONE place, so they cannot drift apart.
      //
      // Everything the engine gives us today is estimate-grade; the branch run
      // is upgraded to geometry-derived below, where the geometry is known. No
      // path here produces field evidence — that requires a recorded, verified
      // measurement, which is a domain record, not a mapper default.
      lengthSource: 'cad-derived-estimate',
      verificationStatus: 'cad-derived-estimate',
      lengthProvenance: 'estimated',
      verificationState: 'cad-derived-estimate',
      // the length ELECTRICAL CALCULATIONS use (voltage drop, resistance). Kept
      // distinct from procurementLengthFt: a conductor is sized on the run it
      // actually covers, but purchased with slack and terminations.
      calculationLengthFt: isFinite(r.onewayLengthFt) ? r.onewayLengthFt : null,
      raceway: _isOpenAir ? 'FREE_AIR' : (r.conduitType ?? null),
      tradeSizeIn: r.conduitSize ?? null,
      // AAC WS-7 — the SAME field-name mismatch class as computeSystemProjection:
      // `RunSegment` carries `conduitFillPct` (computed-system.ts:186), never
      // `conduitFillPercent`, so every routeSegment fill was nulled while the
      // NEC Ch.9 Table 1 value sat on the run. Open-air runs legitimately carry
      // no fill (0 % is meaningless without a raceway) ⇒ null.
      fillPct: _isOpenAir ? null
        : (isFinite(r.conduitFillPct) ? Math.round(r.conduitFillPct * 10) / 10
          : (isFinite(r.physicalRaceway?.fillPct) ? r.physicalRaceway.fillPct : null)),
      installationMethod: _isOpenAir ? 'free-air (NEC 690.31(C))' : (r.conduitType ? 'in-conduit' : null),
      conductorGauge: r.wireGauge ?? null,
      conductorCount: isFinite(r.conductorCount) ? r.conductorCount : null,
      conductorMaterial: 'Cu',
      insulation: r.insulation ?? (_isOpenAir && isMicro ? 'TC-ER' : (r.isDc ? 'USE-2' : 'THWN-2')),
      neutralPresent: typeof r.neutralPresent === 'boolean' ? r.neutralPresent : null,
      conductorCallout: _derivedCallout,
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
      // TAC WS-2 — these are now genuinely emitted by computeSystem (they were
      // read off RunSegment before the segment carried them, so every ampacity
      // chain in the package derated by a factor with no stated temperature).
      ambientTempC: isFinite(r.ambientTempC) ? r.ambientTempC : null,
      rooftopAdderC: isFinite(r.rooftopAdderC) ? r.rooftopAdderC : null,
      // KDP WS-10 — the adder's BASIS travels with the segment. A null adder with
      // no basis reads as an unresolved required input; the basis proves it is a
      // resolved code question (deleted from the adopted edition / not a rooftop
      // conductor / open-air rather than a raceway on a roof).
      rooftopAdderBasis: (r as { rooftopAdderBasis?: string | null }).rooftopAdderBasis ?? null,
      ambientSource: r.ambientSource ?? null,
      effectiveAmbientTempC: isFinite(r.effectiveAmbientTempC) ? r.effectiveAmbientTempC : null,
      tempDeratingFactor: isFinite(r.tempDeratingFactor) ? r.tempDeratingFactor : null,
      provenance: { source: 'computeSystem runs (deriveRunLengths cad estimate)' },
    };
  });

  // ═══ §3/§4/§6 CANONICAL PHYSICAL-RACEWAY AUTHORITY (closeout 07-23) ════════
  // Project the engine's per-raceway objects verbatim. The shared branch home-run
  // appears ONCE with sharedCircuitCount>1; PV-4A/PV-4B fill + the BOM §6 pass
  // read THESE (single source), never a project-level 'all runs' roll-up.
  const physicalRaceways: import('./types').PhysicalRacewayRecord[] =
    ((cs?.physicalRaceways ?? []) as any[]).map((rw: any) => ({
      physicalRacewayId: String(rw.physicalRacewayId),
      racewayType: String(rw.racewayType ?? ''),
      necArticle: String(rw.necArticle ?? ''),
      supportArticle: String(rw.supportArticle ?? ''),
      sharedCircuitCount: isFinite(rw.sharedCircuitCount) ? rw.sharedCircuitCount : 1,
      conductorCount: isFinite(rw.conductorCount) ? rw.conductorCount : 0,
      currentCarryingCount: isFinite(rw.currentCarryingCount) ? rw.currentCarryingCount : 0,
      conductorAreaIn2: isFinite(rw.conductorAreaIn2) ? rw.conductorAreaIn2 : null,
      minimumCodeRacewaySize: rw.minimumCodeRacewaySize ?? null,
      calculatedFillRacewaySize: rw.calculatedFillRacewaySize ?? null,
      selectedRacewaySize: rw.selectedRacewaySize ?? null,
      fillPct: isFinite(rw.fillPct) ? rw.fillPct : null,
      upsizingReason: rw.upsizingReason ?? null,
      deratingBasis: rw.deratingBasis ?? null,
      supportCondition: rw.supportCondition ?? null,
      provenance: { source: String(rw.provenance ?? 'computeSystem physicalRaceways') },
    }));

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
    const isMicroTopo = !!cs?.isMicro;
    const rsd = proj.rapidShutdown === true || proj.rapidShutdownIntegrated === true;
    // §9 ONE-vs-TWO device DETERMINATION. Nothing in the design asserts a SECOND
    // physical lockable disconnect distinct from the fused AC disconnect: no
    // project field specifies a separate utility-disconnect device/model, and a
    // residential 705.11 tap uses a single listed fused AC disconnect that IS the
    // utility-accessible lockable means. So we model ONE dual-purpose LISTED
    // device (tap OCPD + utility-accessible lockable disconnect) — never two — and
    // only split when the project explicitly specifies a distinct device.
    const _separateUtilityDisconnect =
      proj.separateUtilityDisconnect === true ||
      proj.utilityLockableDisconnect === true ||
      (typeof proj.utilityDisconnectModel === 'string' && proj.utilityDisconnectModel.trim().length > 0);
    const _fusedModel = (typeof proj.acDisconnectModel === 'string' && proj.acDisconnectModel.trim())
      ? proj.acDisconnectModel.trim()
      : (typeof proj.fusedDisconnectModel === 'string' && proj.fusedDisconnectModel.trim())
        ? proj.fusedDisconnectModel.trim() : null;
    const objs: import('./types').ServiceTopologyObject[] = [];
    // Combiner (PV source side) — micro AC combiner / string DC combiner.
    objs.push({
      objectId: 'svc-combiner', type: 'combiner',
      label: isMicroTopo ? 'AC combiner (branch aggregation)' : 'Combiner / inverter output',
      description: isMicroTopo ? 'Micro AC branch circuits terminate here; integral load-break where listed' : 'Inverter AC output aggregation',
      conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], upstreamObjectId: null, downstreamObjectId: 'svc-combiner-loadbreak',
      deviceModel: null, electricalRole: 'pv-output-aggregation', utilityRole: null,
      fusedState: 'not-applicable', lockable: null, rsdRole: 'none',
      provenance: { source: 'computeSystem topology (combiner)' },
    });
    objs.push({
      objectId: 'svc-combiner-loadbreak', type: 'combiner-load-break',
      label: 'Combiner load-break', description: 'Integral load-break disconnecting means at the combiner (NEC 690.13) where listed',
      conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], upstreamObjectId: 'svc-combiner',
      // D10 — the fused OCPD is the next device in BOTH interconnection modes now;
      // the tap conductors follow it rather than preceding it.
      downstreamObjectId: rsd ? 'svc-rsd-initiator' : 'svc-fused-ocpd',
      deviceModel: null, electricalRole: 'pv-system-disconnect', utilityRole: null,
      fusedState: 'non-fused', lockable: true, rsdRole: 'none',
      provenance: { source: 'design (combiner integral load-break)' },
    });
    if (rsd) {
      objs.push({
        objectId: 'svc-rsd-initiator', type: 'rsd-initiator',
        label: 'Rapid-shutdown initiator', description: 'PV rapid-shutdown initiation device (NEC 690.12) at the service location',
        conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
        constraints: [], upstreamObjectId: 'svc-combiner-loadbreak',
        // D10 — see above: the fused OCPD, then the tap conductors.
        downstreamObjectId: 'svc-fused-ocpd',
        deviceModel: null, electricalRole: 'rapid-shutdown', utilityRole: 'emergency-shutdown',
        fusedState: 'not-applicable', lockable: null, rsdRole: 'initiator',
        provenance: { source: 'design (NEC 690.12 rapid shutdown)' },
      });
    }
    const _afterRsd = rsd ? 'svc-rsd-initiator' : 'svc-combiner-loadbreak';
    // ── D10 — THE TAP CONDUCTORS ARE THE EDGE THEIR OWN DESCRIPTION NAMES ────
    // `svc-tap-conductors` is the object that OWNS the NEC 705.11(C) ≤10-ft
    // constraint, and it described itself as "Tap point → fused AC disconnect".
    // Its graph edges said something else: it was wired
    //   rsd → tap-conductors → fused-ocpd → tap-point
    // which places the tap conductors on the PV side of the fused disconnect
    // rather than between the tap point and that disconnect. The constraint was
    // therefore attached to a span that is not the tap run.
    //
    // Nothing rendered a wrong NUMBER, because the length is null and every
    // consumer finds these objects by `type` / `objectId` — no code in the tree
    // walks upstreamObjectId/downstreamObjectId, which is precisely why the
    // mis-wiring survived. It would have produced a wrong length the moment any
    // route derivation started traversing the chain.
    //
    // Corrected export-flow order (PV → utility), matching the direction the
    // rest of this chain already uses:
    //   … → rsd → fused-ocpd → tap-conductors → [utility-disconnect] → tap-point → meter → …
    //
    // The objects are also EMITTED in that order now, so the array reads as the
    // chain it represents. This is digest-affecting: the edges are part of the
    // signed design projection.
    // The length stays null and the constraint stays `pending` — this repair
    // does not, and must not, close TAP-CONDUCTOR-LENGTH-PENDING.
    // §9 — the SINGLE listed fused AC disconnect. When no separate utility
    // disconnect is specified (the residential norm), it is DUAL-PURPOSE: the
    // 705.11 tap OCPD AND the utility-accessible lockable disconnect. No phantom
    // second device is emitted.
    objs.push({
      objectId: 'svc-fused-ocpd', type: 'fused-ocpd',
      label: isSupply ? 'Fused AC disconnect (tap OCPD + utility-accessible)' : 'AC disconnect',
      description: isSupply
        ? (_separateUtilityDisconnect
            ? 'NEC 705.11 supply-side overcurrent device (a separate utility disconnect is specified)'
            : 'Single listed lockable fused AC disconnect — serves BOTH the NEC 705.11 tap OCPD and the utility-accessible disconnecting means (no separate device)')
        : 'PV-system AC disconnecting means (NEC 690.13)',
      conductorSpec: null, ocpdRatingA: feederOcpd, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [],
      // D10 — the fused OCPD now sits directly after the RSD/load-break in both
      // cases; the tap conductors follow it, on the way to the tap point.
      upstreamObjectId: _afterRsd,
      downstreamObjectId: isSupply ? 'svc-tap-conductors' : 'svc-meter',
      deviceModel: _fusedModel, electricalRole: 'overcurrent-protection',
      utilityRole: (isSupply && !_separateUtilityDisconnect) ? 'utility-accessible-disconnect' : null,
      fusedState: 'fused', lockable: true, rsdRole: 'none',
      dualPurposeListing: isSupply && !_separateUtilityDisconnect ? true : null,
      dualPurposeRoles: isSupply && !_separateUtilityDisconnect
        ? ['705.11-tap-ocpd', 'utility-accessible-lockable-disconnect'] : null,
      provenance: { source: 'computeSystem tap OCPD', note: (isSupply && !_separateUtilityDisconnect) ? 'ONE listed device, dual role (no duplicate utility disconnect)' : undefined },
    });
    // D10 — the tap conductors: the span from the fused AC disconnect to the tap
    // point. Emitted here so the array order matches the electrical chain.
    if (isSupply) {
      objs.push({
        objectId: 'svc-tap-conductors', type: 'tap-conductors',
        label: 'Tap conductors', description: 'Tap point → fused AC disconnect; sized ≥ 125% of PV output current',
        conductorSpec: feederGauge ? `${feederGauge} THWN-2${pvContA != null ? ` (≥ ${pvContA.toFixed(1)}A)` : ''}` : null,
        ocpdRatingA: null,
        lengthFt: null, lengthSource: 'unknown',
        constraints: [{
          code: 'NEC-705.11(C)-TAP-10FT',
          description: 'Fused disconnect within 10 ft of the tap; tap-conductor length ≤ 10 ft',
          limitFt: 10,
          state: 'pending',
        }],
        upstreamObjectId: 'svc-fused-ocpd',
        downstreamObjectId: _separateUtilityDisconnect ? 'svc-utility-disconnect' : 'svc-tap-point',
        deviceModel: null, electricalRole: 'tap-conductors', utilityRole: null,
        fusedState: 'not-applicable', lockable: null, rsdRole: 'none',
        provenance: { source: 'design rule (tap-conductor length not measured)', note: 'FIELD-VERIFY ≤10ft' },
      });
    }
    // Optional SEPARATE utility disconnect — ONLY when the project specifies it.
    if (isSupply && _separateUtilityDisconnect) {
      objs.push({
        objectId: 'svc-utility-disconnect', type: 'utility-disconnect',
        label: 'Utility-accessible AC disconnect (separate)', description: 'Distinct lockable AC disconnect ahead of the point of interconnection (specified by the project/utility)',
        conductorSpec: null, ocpdRatingA: feederOcpd, lengthFt: null, lengthSource: 'not-applicable',
        // D10 — follows the tap conductors, still immediately ahead of the tap point.
        constraints: [], upstreamObjectId: 'svc-tap-conductors', downstreamObjectId: 'svc-tap-point',
        deviceModel: (typeof proj.utilityDisconnectModel === 'string' ? proj.utilityDisconnectModel : null),
        electricalRole: 'disconnecting-means', utilityRole: 'utility-accessible-disconnect',
        fusedState: 'non-fused', lockable: true, rsdRole: 'none',
        provenance: { source: 'project (separate utility disconnect specified)' },
      });
    }
    if (isSupply) {
      objs.push({
        objectId: 'svc-tap-point', type: 'tap-point',
        label: 'Supply-side tap point', description: 'Line side of the service disconnecting means (NEC 705.11)',
        conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
        constraints: [],
        // D10 — the tap point is reached THROUGH the tap conductors.
        upstreamObjectId: _separateUtilityDisconnect ? 'svc-utility-disconnect' : 'svc-tap-conductors',
        downstreamObjectId: 'svc-meter',
        deviceModel: null, electricalRole: 'interconnection-point', utilityRole: 'supply-side-tap',
        fusedState: 'not-applicable', lockable: null, rsdRole: 'none',
        provenance: { source: 'interconnection method (supply-side)' },
      });
    }
    objs.push({
      objectId: 'svc-meter', type: 'meter',
      label: 'Utility revenue meter', description: 'Existing utility service meter',
      conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], upstreamObjectId: isSupply ? 'svc-tap-point' : 'svc-fused-ocpd',
      downstreamObjectId: 'svc-service-disconnect',
      deviceModel: null, electricalRole: 'metering', utilityRole: 'revenue-metering',
      fusedState: 'not-applicable', lockable: null, rsdRole: 'none',
      provenance: { source: 'existing service' },
    });
    objs.push({
      objectId: 'svc-service-disconnect', type: 'service-disconnect',
      label: 'Main service disconnect', description: 'Existing main service disconnecting means',
      conductorSpec: null, ocpdRatingA: mainA, lengthFt: null, lengthSource: 'not-applicable',
      constraints: [], upstreamObjectId: 'svc-meter', downstreamObjectId: null,
      deviceModel: null, electricalRole: 'service-disconnect', utilityRole: 'service-equipment',
      fusedState: 'not-applicable', lockable: true, rsdRole: 'none',
      provenance: { source: 'project service rating' },
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
  // §2 (BAR) — a VALUE being present is NOT authority. proj.ahjWindSpeedMph /
  // ahjGroundSnowPsf being non-null means the operator/AHJ TYPED a value (an
  // OBSERVATION/OVERRIDE), NOT that a verified climate-hazard source exists. The
  // ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED blocker fires from the authority's
  // verification state (unverified unless an archived, currency-reviewed source is
  // threaded in via opts.environmentalSource), never from mere presence.
  const windValuePresent = proj.ahjWindSpeedMph != null;
  const snowValuePresent = proj.ahjGroundSnowPsf != null;
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
    windValuePresent, snowValuePresent,
    windSpeedMph: (struct?.wind as any)?.windSpeed ?? proj.windSpeedMph ?? null,
    exposure: (struct?.wind as any)?.exposureCategory ?? proj.windExposure ?? null,
    snowPsf: (struct?.snow as any)?.groundSnowLoad ?? proj.ahjGroundSnowPsf ?? null,
    riskCategory: proj.riskCategory ?? null,
    // §2 (BAR) — the verified climate-hazard source (async-resolved by the caller
    // through lib/documents). null on live ⇒ operator-entered values stay
    // UNVERIFIED ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED fires.
    environmentalSource: opts?.environmentalSource ?? null,
    // AAC WS-4 — the retrieval detail behind that source (query inputs, returned
    // values, override history, archival state). Null ⇒ record unchanged.
    environmentalRetrieval: opts?.environmentalRetrieval ?? null,
    environmentalCoordinates: (proj.lat != null || proj.lng != null)
      ? { lat: proj.lat ?? null, lng: proj.lng ?? null } : null,
    environmentalAddressUsed: proj.address ?? null,
    // D6 NOTE — digested; see meta.generatedAtIso below for why this keeps the
    // `proj.date` fallback despite it being a localised date, not an ISO instant.
    environmentalCapturedAtIso: (input as any).generatedAtIso ?? proj.date ?? null,
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
    // FRAMING-AUTHORITY GATE — evidence for the framing CAPACITY authority.
    framingCapacityDocument: opts?.framingCapacityDocument ?? null,
    framingEngineerReview: opts?.framingEngineerReview ?? null,
    framingReviewDigest: opts?.framingReviewDigest ?? null,
    framingProjectApplicabilityKey: opts?.framingProjectApplicabilityKey
      ?? (opts?.projectId ?? (proj.projectId ?? null)),
    // AAC WS-8 — real registry facts (AUTHORITATIVE becomes reachable) + the
    // rail-selection trace (PENDING-RACKING-ASSEMBLY-SELECTION stops echoing the
    // capacity document and becomes the design question it always was).
    documentRegistryFacts: opts?.documentRegistryFacts ?? null,
    rackingAssemblySelection: opts?.rackingAssemblySelection ?? null,
  });

  // ═══ P13 WS-1 — THE ARRAY / RACKING BONDING EGC ════════════════════════════
  //
  // THE GAP THIS CLOSES: the package modelled the AC branch EGC, the feeder EGC,
  // the raceway bond and the (not-required) GEC — and NOTHING for the path that
  // actually bonds the bonded module/racking system to the rooftop equipment-
  // ground. So the planset could not explain its own array bonding path, and the
  // #10 conductor the design installs had no object to belong to.
  //
  // THE TWO SIZES ARE DIFFERENT FACTS AND ARE STORED SEPARATELY:
  //   calculatedMinimumSize — what NEC 250.122 requires at the branch OCPD. For a
  //                           20 A branch that is #12 Cu. This is the CODE answer.
  //   selectedDesignSize    — what the project design standard installs (#10 Cu).
  //                           Larger than the minimum, which 250.122 permits.
  // No sheet may say the code table produced #10. The snapshot validator refuses
  // a record whose installed size is SMALLER than the calculated minimum.
  //
  // Topology modelled (module frames → racking → bonding EGC → rooftop JB → the
  // equipment-ground path already modelled by the branch/feeder EGCs → service).
  // Nothing here asserts a microinverter PRODUCT grounding requirement: that is
  // openAirGroundingAuthority's question, decided on its own manufacturer
  // evidence, and it stays untouched.
  {
    const _ra = structAuth.rackingAssembly as unknown as {
      assemblyId?: string | null; ul2703ListingBasis?: string | null;
      groundingBonding?: string | null;
      assemblyVerification?: { overall?: string };
    } | null;
    // The governing OCPD for the array bonding conductor is the BRANCH OCPD (the
    // largest overcurrent device ahead of the bonded equipment), not the feeder's.
    const _branchOcpd = branches.length
      ? Math.max(...branches.map(b => Number(b.ocpdA) || 0))
      : (cs?.acOcpdAmps ?? null);
    const _minimum = _branchOcpd ? getEGCSize(_branchOcpd) : null;
    // The company/project design standard for array + racking bonding. Recorded
    // as a DESIGN SELECTION with its own source — never as a code result.
    //
    // A DESIGN STANDARD IS A FLOOR, NOT A CEILING. On a larger array the code
    // minimum can EXCEED the standard (an 80 A ground-mount branch requires #8,
    // above the #10 standard) — installing the standard there would be an
    // under-sized equipment grounding conductor. The installed conductor is
    // therefore the LARGER of the two, and the selection source follows suit.
    // (V45 refuses the alternative, which is how this was caught.)
    const _standard = ARRAY_RACK_BONDING_DESIGN_SIZE;
    const _standardExceeds = _minimum !== null
      && conductorAreaRank(_standard) > conductorAreaRank(_minimum);
    const _designStandard = _minimum === null ? _standard : (_standardExceeds ? _standard : _minimum);
    const _exceedsMinimum = _standardExceeds;
    const _bondingPending = (_ra?.assemblyVerification?.overall ?? 'pending') !== 'verified';
    groundingObjects.push({
      groundingId: 'gnd-array-bond',
      segmentId: 'ROOF_RUN',
      purpose: 'array-rack-bonding-egc',
      segmentRole: 'ARRAY_RACK_BONDING_EGC',
      required: true,
      method: 'conductor',
      conductorMaterial: 'Cu',
      // INSTALLED = the design selection (which is ≥ the code minimum).
      conductorSize: _designStandard,
      calculatedMinimumSize: _minimum,
      selectedDesignSize: _exceedsMinimum ? _designStandard : null,
      selectionSource: _exceedsMinimum ? 'project-design-standard' : 'nec-minimum',
      selectionReason: _exceedsMinimum
        ? `project design standard installs ${_designStandard} for array/racking bonding — larger than the `
          + `NEC 250.122 minimum of ${_minimum}, which the code permits (250.122 sets a MINIMUM). `
          + 'The larger conductor is a durability/handling choice, not a code requirement.'
        : null,
      sizingBasis: _minimum
        ? (_exceedsMinimum
            ? `NEC 250.122 minimum ${_minimum} @ ${_branchOcpd}A branch OCPD; installed ${_designStandard} per project design standard`
            : `NEC 250.122 ${_minimum} @ ${_branchOcpd}A branch OCPD (governs — exceeds the ${_standard} project standard)`)
        : null,
      associatedOcpdA: _branchOcpd,
      ocpdBasis: _branchOcpd ? `${_branchOcpd}A branch OCPD (largest device ahead of the bonded array)` : null,
      associatedEquipment: 'Bonded module frames + racking system',
      sourceNode: 'Bonded module frames and racking system (listed bonding method)',
      destinationNode: 'Rooftop junction box equipment-ground bus',
      insulationState: 'bare',
      installationMethod: 'free-air',
      routeId: 'ROOF_RUN',
      rackingAssemblyId: _ra?.assemblyId ?? null,
      // The METHOD by which frames/rails are bonded is the racking assembly's
      // authority. While that assembly is unverified this stays null rather than
      // asserting UL 2703 integration the record cannot substantiate.
      bondingMethod: _bondingPending ? null : (_ra?.groundingBonding ?? null),
      manufacturerEvidenceId: _bondingPending ? null : (_ra?.ul2703ListingBasis ?? null),
      manufacturerListingBasis: _bondingPending ? null : (_ra?.ul2703ListingBasis ?? null),
      codeBasis: 'NEC 690.43 (array equipment bonding) sized per NEC 250.122',
      calculationId: 'calc:egc-250.122:gnd-array-bond',
      provenance: {
        source: 'P13 WS-1 array/racking bonding topology (branch OCPD + project design standard)',
        ref: _ra?.assemblyId ?? null,
      },
    });
  }

  // ═══ §6/§7 (closeout 07-23) LISTED CABLE ASSEMBLY + GEOMETRIC CABLE PATHS ══
  // The micro AC branch trunk is a manufacturer-LISTED factory-connectorized
  // cable ASSEMBLY (Enphase Q Cable, …), and its length is derived GEOMETRICALLY
  // from each branch's module coordinates — not the plane-width heuristic that
  // could never reconcile with the BOM drops×pitch footage (3×68 ≠ 152). Both are
  // built here (moduleInstances + branches now available) and projected on
  // PV-4B/E-1/SCHED/BOM/APP-A. Non-micro / unknown-trunk-brand ⇒ null/[].
  let listedCableAssembly: import('./types').ListedCableAssembly | null = null;
  let branchCablePaths: import('./types').BranchCablePath[] = [];
  let procurementSufficiency: ProcurementSufficiency | null = null;
  /** AAC WS-5 — THE deterministic Q-Cable topology object + its option-space
   *  evaluation. Procurement, the BOM and every sheet length consume THESE. */
  let qcableTopology: import('./types').QCableTopology | null = null;
  let qcableEvaluation: import('./types').QCableSolutionEvaluation | null = null;
  /** WS-2 — THE canonical procurement design derived from the topology + the
   *  archived field-termination authority. */
  let qcableProcurement: import('./qcableProcurement').QCableProcurementResolution | null = null;
  /** the EXACT selected micro SKU/model the grounding authority must be resolved
   *  for (never a family label) — hoisted out of the micro block below. */
  let _selectedMicroSku: string | null = null;
  if (isMicro && branches.length > 0) {
    const _microMfr = eq.inverterManufacturer ?? microInverters[0]?.manufacturer ?? '';
    const _microModel = eq.inverterModel ?? microInverters[0]?.model ?? '';
    // the EXACT SKU (equipment-db partNumber, e.g. IQ8A-72-2-US) — a model label
    // ('IQ8A') is a family name and can never carry document applicability.
    _selectedMicroSku = microInverters[0]?.sku ?? null;
    // dominant module orientation → trunk cable spacing variant (portrait 60/72-cell).
    const _oCount = { portrait: 0, landscape: 0 };
    for (const mi of structAuth.moduleInstances) {
      if (mi.orientation === 'landscape') _oCount.landscape++;
      else _oCount.portrait++;
    }
    const _orient: 'portrait' | 'landscape' = _oCount.landscape > _oCount.portrait ? 'landscape' : 'portrait';
    const _microDeviceCount = branches.reduce((s, b) => s + b.moduleCount, 0) || microUnits.length;
    const _trunkPlan = resolveTrunkCablePlan({
      brand: _microMfr, model: _microModel, deviceCount: _microDeviceCount,
      orientation: _orient, branchCountOverride: branches.length,
    });
    const _pitch = _trunkPlan?.cable.connectorSpacingFt ?? null;
    // module centre coordinates grouped by branch (canonical plan-ft frame).
    // AAC WS-5 — the SAME grouping now also carries each device's identity, roof
    // plane and row/col index, so the topology engine can classify a row vs an
    // array transition from the canonical layout indices instead of guessing at
    // a length threshold. `_centersByBranch` stays the exact {x,y} shape
    // deriveBranchCablePaths consumes (byte-identical lengths).
    const _centersByBranch = new Map<string, { x: number; y: number }[]>();
    const _devicesByBranch = new Map<string, import('./qcableTopology').QCableModulePoint[]>();
    for (const mi of structAuth.moduleInstances) {
      const pts = mi.polygon?.points ?? [];
      if (!pts.length || !mi.branchId) continue;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      (_centersByBranch.get(mi.branchId) ?? _centersByBranch.set(mi.branchId, []).get(mi.branchId)!).push({ x: cx, y: cy });
      (_devicesByBranch.get(mi.branchId) ?? _devicesByBranch.set(mi.branchId, []).get(mi.branchId)!).push({
        moduleInstanceId: mi.instanceId, roofPlaneId: mi.roofPlaneId ?? null,
        row: mi.row ?? null, col: mi.col ?? null, xFt: cx, yFt: cy,
      });
    }
    const _paths = deriveBranchCablePaths(
      branches.map(b => ({ branchId: b.branchId, branchLabel: b.label, moduleCount: b.moduleCount,
        moduleCentersFt: _centersByBranch.get(b.branchId) ?? [] })),
      _pitch,
    );
    branchCablePaths = _paths.map(p => ({
      branchId: p.branchId, branchLabel: p.branchLabel, moduleCount: p.moduleCount, dropCount: p.dropCount,
      designedInstalledLengthFt: p.designedInstalledLengthFt, connectorSpacingFt: p.connectorSpacingFt,
      procurementLengthFt: p.procurementLengthFt, wasteFactor: p.wasteFactor,
      lengthProvenance: p.lengthProvenance, derivation: p.derivation,
      provenance: { source: 'deriveBranchCablePaths (geometry)', note: p.lengthProvenance },
    }));
    if (_trunkPlan) {
      const _cbl = _trunkPlan.cable;
      const _sys = _trunkPlan.system;
      const _totalDrops = branchCablePaths.reduce((s, p) => s + p.dropCount, 0) || _microDeviceCount;
      const _totalProc = branchCablePaths.reduce((s, p) => s + (p.procurementLengthFt ?? 0), 0) || _trunkPlan.approxFeet;
      const _isEnphase = /enphase/i.test(_microMfr);
      listedCableAssembly = {
        assemblyId: 'QCABLE-ASSEMBLY',
        manufacturer: _sys.brand,
        ecosystem: _sys.ecosystem,
        model: _cbl.sku ?? null,
        sku: _cbl.sku ?? null,
        skuNote: null,
        conductorConstruction: _isEnphase ? 'two-wire, double-insulated (factory-connectorized)' : `${_cbl.conductors}-conductor factory-connectorized cable`,
        conductorCount: _cbl.conductors ?? null,
        conductorGauge: Number.isFinite(_cbl.gaugeAwg) ? `#${_cbl.gaugeAwg} AWG` : null,
        insulationListing: _isEnphase
          ? 'THHN/THWN-2 conductors; UL 9703 (cable assemblies) / UL 3003 (raw cable); permitted in free air per NEC 690.31(C)'
          : 'listed AC trunk cable assembly; permitted in free air per NEC 690.31(C)',
        wiringMethodLabel: _isEnphase ? 'ENPHASE Q CABLE (TC-ER)' : `${_sys.brand.toUpperCase()} AC TRUNK (TC-ER)`,
        // P13 — carried from THE canonical trunk-cable system, never inferred from
        // a brand string, a product name or a document title.
        connectorArchitecture: _sys.connectorArchitecture,
        connectorSpacingFt: _cbl.connectorSpacingFt ?? null,
        maxBranchCurrentA: _sys.branchOcpdA ?? null,
        compatibleMicroModels: Object.keys(_sys.deviceBranchLimits ?? {}),
        cableLengthFt: _totalProc > 0 ? Math.round(_totalProc) : null,
        dropCount: _totalDrops,
        unusedDropCapSku: _sys.connectors.sealingCap?.sku ?? null,
        terminatorSku: _sys.connectors.terminator?.sku ?? null,
        sourceDocument: _isEnphase
          ? 'Enphase IQ Cable accessories Data Sheet DSH-00247-1.0 (2024-07-03)'
          : `${_sys.brand} AC trunk cable datasheet`,
        verificationStatus: 'catalog-sourced',
        provenance: { source: 'resolveTrunkCablePlan + trunk-cable catalog', ref: _cbl.sku ?? null },
      };
    }
    // §Q (2026-07-24) — Q-CABLE PROCUREMENT SUFFICIENCY. Compare the Σ geometric
    // designed-installed cable path against the drop-based procurement footage.
    // procurement < Σ designed + allowance(0) ⇒ the ordered cable is SHORT of the
    // installed path ⇒ QCABLE-PROCUREMENT-INSUFFICIENT (pushed below). Cleared only
    // by a VERIFIED CableExtensionSolution (opts.cableExtensionSolutions — empty on
    // live today ⇒ the blocker stays active). Pure/deterministic → digest-safe.
    // ═══ AAC WS-5 (2026-07-27) — THE DETERMINISTIC TOPOLOGY + SOLUTION ENGINE ══
    // Built BEFORE the sufficiency gate, because the gate now inspects a
    // COMPLETED resolution instead of announcing a shortage. The topology is the
    // one derivation every consumer reads (procurement, BOM, PV-4B, E-1, SCHED).
    const _trunkSystem = _trunkPlan?.system ?? findTrunkCableSystem(_microMfr);
    // the array's module centre-to-centre pitch — the reach a molded connector
    // must span. Taken from the canonical module footprint + the dominant
    // orientation (portrait ⇒ the module WIDTH is the along-row dimension).
    const _mi0 = structAuth.moduleInstances[0] ?? null;
    const _modulePitchFt = _mi0
      ? (_orient === 'portrait' ? (_mi0.widthIn ?? 0) : (_mi0.heightIn ?? 0)) / 12
      : null;
    const _wasteFactor = branchCablePaths[0]?.wasteFactor ?? 1.15;
    if (_trunkSystem && _trunkPlan?.cable) {
      qcableTopology = buildQCableTopology({
        system: _trunkSystem,
        cable: _trunkPlan.cable,
        orientation: _orient,
        modulePitchFt: _modulePitchFt && _modulePitchFt > 0 ? _modulePitchFt : null,
        branches: branches.map(b => ({
          branchId: b.branchId, branchLabel: b.label, moduleCount: b.moduleCount,
          modules: _devicesByBranch.get(b.branchId) ?? [],
        })),
        wasteFactor: _wasteFactor,
        serviceLoopAllowance: opts?.qcableServiceLoopAllowance ?? null,
        assemblyId: listedCableAssembly?.assemblyId ?? null,
      });
    }
    if (qcableTopology && _trunkSystem) {
      qcableEvaluation = evaluateQCableSolutions({
        topology: qcableTopology,
        system: _trunkSystem,
        selectedSystem: `${_microMfr} ${_microModel}`.trim() || (listedCableAssembly?.wiringMethodLabel ?? 'micro AC trunk'),
        cableExtensionSolutions: opts?.cableExtensionSolutions ?? [],
        maxDevicesPerBranch: microMaxPerBranch(_microModel, _microMfr)
          ?? _trunkSystem.maxDevicesPerBranch,
        extensionLookupNote: (opts?.cableExtensionSolutions ?? []).length === 0
          ? 'no operator-selected listed extension product, and the document registry returned no verified extension document (manufacturer_document_registry — migration 113)'
          : null,
        // D-1 (2026-07-20): plane containment is a PREFERENCE; the branch count
        // stays at the manufacturer minimum and a chunk-boundary crossing is permitted.
        planeContainmentPreferred: true,
      });
    }
    // §Q — the sufficiency gate. When the engine ADOPTED an auto-adoptable order
    // composition (same listed cable, same layout, same branch assignment — only
    // the ordered section count and the listed sealing caps change), the
    // procurement basis IS that composition, and the gate is measured against
    // it. Nothing physical changed, so this is a procurement decision the engine
    // may take; every other option requires a design/product action and is
    // reported, ranked, in the payload instead.
    const _adopted = qcableEvaluation?.options.find(o => o.adopted) ?? null;
    const _adoptedPerBranch = new Map((_adopted?.perBranch ?? []).map(p => [p.branchId, p.providedFt]));
    procurementSufficiency = buildProcurementSufficiency({
      assembly: listedCableAssembly,
      branchPaths: _adopted
        ? branchCablePaths.map(p => ({ ...p, procurementLengthFt: _adoptedPerBranch.get(p.branchId) ?? p.procurementLengthFt }))
        : branchCablePaths,
      selectedSystem: `${_microMfr} ${_microModel}`.trim() || (listedCableAssembly?.wiringMethodLabel ?? 'micro / Q Cable'),
      solutions: opts?.cableExtensionSolutions ?? [],
      serviceLoopAllowance: opts?.qcableServiceLoopAllowance ?? null,
      topology: qcableTopology,
      evaluation: qcableEvaluation,
    });
    // ONLY when the composition was ADOPTED does the ordered footage change; the
    // assembly's own claim then states the SAME number (one derivation, no second
    // basis). With no adoption the drop-count order stands, unchanged.
    if (listedCableAssembly && _adopted && procurementSufficiency?.procurementLengthFt != null) {
      listedCableAssembly.cableLengthFt = Math.round(procurementSufficiency.procurementLengthFt);
    }

    // ═══ WS-2 — THE CANONICAL PROCUREMENT RESOLUTION ═════════════════════════
    // The gate above MEASURES the shortage. This RESOLVES it: per-branch
    // allocation (never netted across branches), the purchase expressed in the
    // manufacturer's own package unit, the remainder, and every accessory derived
    // from an actual branch modification — all from the archived, hash-bound
    // IOM-00068-3.0-EN field-termination authority. With no authority covering
    // the selected micro + architecture the resolution is INCOMPLETE and the
    // requirement stays open, fail-closed.
    qcableProcurement = resolveQCableProcurement({
      topology: qcableTopology,
      assembly: listedCableAssembly,
      system: _trunkSystem,
      // `undefined` (the normal case) ⇒ the archived accessor. An explicit null
      // from a caller refuses the authority and exercises the fail-closed path.
      authority: opts?.qcableFieldTerminationAuthority !== undefined
        ? opts.qcableFieldTerminationAuthority
        : enphaseFieldTerminationAuthority(
          (microInverters[0]?.model ?? null) as string | null,
          listedCableAssembly?.connectorArchitecture ?? null,
        ),
      sufficiency: procurementSufficiency,
    });

    // §7/§10 — patch the canonical BRANCH_RUN route segment length taxonomy so
    // PV-4B/E-1 project the geometric designed-installed length (not the 68-ft
    // plane-width estimate) and reference the per-branch cable-path objects.
    const _branchSeg = routeSegments.find(r => r.segmentId === 'BRANCH_RUN');
    if (_branchSeg && branchCablePaths.length) {
      const _geom = branchCablePaths.every(p => p.lengthProvenance === 'geometry-derived');
      const _sumDesigned = branchCablePaths.reduce((s, p) => s + (p.designedInstalledLengthFt ?? 0), 0);
      const _sumProc = branchCablePaths.reduce((s, p) => s + (p.procurementLengthFt ?? 0), 0);
      const _maxDesigned = Math.max(...branchCablePaths.map(p => p.designedInstalledLengthFt ?? 0));
      // oneWayFt = the LONGEST branch (the VD/calc basis); taxonomy carries the rest.
      if (_maxDesigned > 0) _branchSeg.oneWayFt = Math.round(_maxDesigned);
      _branchSeg.geometricDesignLengthFt = _geom && _sumDesigned > 0 ? Math.round(_sumDesigned * 10) / 10 : null;
      _branchSeg.estimatedFieldLengthFt = _geom ? null : (_sumDesigned > 0 ? Math.round(_sumDesigned * 10) / 10 : null);
      _branchSeg.verifiedFieldLengthFt = null;
      _branchSeg.calculationLengthFt = _maxDesigned > 0 ? Math.round(_maxDesigned) : null;
      _branchSeg.procurementLengthFt = _sumProc > 0 ? Math.round(_sumProc) : null;
      _branchSeg.wasteFactor = branchCablePaths[0]?.wasteFactor ?? null;
      _branchSeg.lengthProvenance = _geom ? 'geometry-derived' : 'estimated';
      _branchSeg.verificationState = 'cad-derived-estimate';
      // AAC WS-5/§2.13 — TRUTHFUL PER-SEGMENT SOURCE. The open-air branch trunk
      // has no raceway to route around: its physical path IS the ordered chain
      // through the micro positions the CAD model carries, so its length source
      // is a CAD ROUTE, not a heuristic estimate. (The VERIFICATION state stays
      // 'cad-derived-estimate' — nothing short of a field measurement is
      // verified — so no downstream claim is strengthened by this.) Only the
      // runs whose route genuinely is not in the model keep the estimate source,
      // and ROUTE-LENGTH-ESTIMATE now names exactly those.
      // WS-5 — set the SOURCE and the VERIFICATION STATE together. Setting only
      // `lengthSource` here is what produced the BRANCH_RUN contradiction:
      // `cad-route` beside a `cad-derived-estimate` verification. A routed CAD
      // geometry is more specific than an estimate, so it earns its own state —
      // but it is NOT field evidence and must never satisfy a field-verification
      // requirement (see closesFieldVerification).
      if (_geom) {
        _branchSeg.lengthSource = 'cad-route';
        _branchSeg.verificationStatus = 'geometry-derived';
        _branchSeg.verificationState = 'geometry-derived';
        _branchSeg.lengthProvenance = 'geometry-derived';
      }
    }
  }

  // ═══ WS-5 — FIELD MEASUREMENT AUTHORITY OVERRIDES THE CAD SOURCE ══════════
  // This runs AFTER the branch-geometry patch above, and that order is the
  // precedence rule made physical:
  //
  //     active FIELD_VERIFIED > active FIELD_REPORTED > CAD_ROUTE > CAD_ESTIMATE
  //
  // A person who walked the run knows more than a heuristic AND more than a
  // coordinate chain, so a field measurement becomes the CALCULATION length even
  // while it is unverified. What an unverified report does NOT do is close a
  // field-verification requirement or upgrade a voltage-drop conclusion — those
  // are decided by `closesFieldVerification` and `gradeVoltageDrop`, from the
  // VERIFICATION STATE this block writes, not from the fact that a number moved.
  //
  // The selection itself already happened (one active record per segment, by the
  // deterministic rule in lib/fieldMeasurement/resolver.ts). This block only
  // PROJECTS it, so there is no second opinion about which measurement won.
  //
  // THE FEEDER RECORD IS PATCHED IN STEP. `electrical.feeder.voltageDropPct` is a
  // SECOND carrier of the same result (built from the engine run below, and
  // preferred over the segment by projectCanonicalFeeder). Updating only the
  // segment produced exactly the defect this workstream is about: PV-4B printed
  // "Vd = 0.37% over 89 ft" — the OLD 20-ft percentage beside the NEW measured
  // length, which reads as derived and is not. `_fieldVoltageDrop` carries the
  // recalculation forward to that record.
  const _fieldVoltageDrop = new Map<string, number | null>();
  {
    const _fm = opts?.fieldRouteMeasurements ?? null;
    if (_fm && Object.keys(_fm.bySegmentId).length > 0) {
      for (const seg of routeSegments) {
        const a = _fm.bySegmentId[seg.segmentId];
        if (!a) continue;
        // D1 — a measurement on a run the project does not own is refused at the
        // API, but a stale row must never take effect here either. Fail-closed.
        if ((seg.routeAuthorityApplicability ?? 'REQUIRED') !== 'REQUIRED') continue;

        seg.lengthSource = a.lengthSource === 'field-verified' ? 'field-measurement' : 'operator-entry';
        seg.verificationStatus = a.verificationState;
        seg.verificationState = a.verificationState;
        seg.lengthProvenance = 'field-measured';
        seg.calculationLengthFt = a.calculationLengthFt;
        // The taxonomy keeps BOTH numbers: `verifiedFieldLengthFt` is populated
        // only by a VERIFIED record, so a sheet can never read an unverified
        // number out of a field named "verified".
        seg.verifiedFieldLengthFt = a.closesFieldVerification ? a.calculationLengthFt : null;
        // oneWayFt is what the voltage-drop projection reads when no explicit
        // calculation length is present; keeping it in step is what makes the
        // recalculation actually happen rather than merely being declared.
        seg.oneWayFt = a.calculationLengthFt;

        // §13 — the procurement length is the measured length PLUS ITEMISED,
        // DOCUMENTED allowances, never a blanket percentage.
        const _proc = deriveFieldMeasuredProcurement(a.calculationLengthFt);
        seg.procurementLengthFt = _proc.procurementLengthFt;
        seg.wasteFactor = _proc.wasteFactor;

        // §12 — THE PERCENTAGE IS RECOMPUTED, NOT RETAINED. Keeping the prior
        // 0.369% beside a length that just changed is the quiet failure this
        // whole workstream is about: arithmetic that is correct about a length
        // nobody is using. The conductor resistance is re-read from the gauge.
        const _vd = recalculateRouteVoltageDrop({
          lengthFt: a.calculationLengthFt,
          // The ENGINE's own current (see _segCurrentA above) first, so the
          // recalculation rests on the same basis the original result did; the
          // segment's declared fields are the fallback.
          continuousCurrentA: _segCurrentA.get(seg.segmentId) ?? seg.continuousCurrentA,
          operatingCurrentA: seg.operatingCurrentA,
          conductorGauge: seg.conductorGauge,
          systemVoltage: _segSystemVoltage.get(seg.segmentId) ?? null,
        });
        // null is written through deliberately: an un-recomputable voltage drop
        // is INDETERMINATE, and leaving the stale number would be worse.
        seg.voltageDropPct = _vd.voltageDropPct;
        if (_vd.currentBasis) seg.voltageDropCurrentBasis = _vd.currentBasis;
        _fieldVoltageDrop.set(seg.segmentId, _vd.voltageDropPct);

        seg.provenance = {
          source: `field route measurement (migration 118) — ${a.provenance}. `
            + `Procurement: ${_proc.derivation} Voltage drop: ${_vd.derivation}`,
          ref: `authority:fieldRouteMeasurement#${a.measurementId}`,
        } as typeof seg.provenance;
      }
    }
  }

  // ═══ W4 §1 CANONICAL CODE AUTHORITY ════════════════════════════════════
  // THE single source for every printed edition. NEC comes from the best real
  // adoption authority (resolved AHJ record / server-enriched jurisdiction);
  // IBC/IRC/IFC are NOT carried by the AHJ DB → left null (no inference); ASCE
  // is sourced from the structural engine's computational basis. Nothing is
  // `verified` (no archived adoption ordinance) — the honest state that drives
  // CODE-AUTHORITY-INCOMPLETE below and PENDING editions on the sheets.
  // D6 NOTE — digested; see meta.generatedAtIso for why the `proj.date` fallback
  // stands (byte-identical-render invariant vs a sub-second instant).
  const _capturedIso = (input as any).generatedAtIso ?? proj.date ?? '';
  // KDP WS-12 — resolve from the identity the project ALREADY carries, in
  // most-specific-first order, and record HOW it matched. The stored
  // `ahjName` / `compliance.jurisdiction.ahj` is a server enrichment written
  // from this same dataset, so it is an identity hint, not decoration: without
  // it (and with county ahead of city) the live Braidon site inside Granite City
  // bound the county's UNINCORPORATED record.
  const _ahjResolution = resolveAhjRecordTraced({
    ahjRecordId: proj.ahjRecordId ?? proj.ahjId ?? null,
    ahjName: (compliance?.jurisdiction as any)?.ahj ?? proj.ahjName ?? null,
    stateCode: typeof proj.state === 'string' ? proj.state : null,
    county: proj.county ?? null,
    city: proj.city ?? null,
    address: proj.address ?? null,
    // The official boundary determination OUTRANKS the stored name and the postal
    // city — a Granite City mailing address can sit in unincorporated Madison
    // County, and only the boundary layer knows which.
    boundary: opts?.projectLegalAuthority
      ? {
          resolved: opts.projectLegalAuthority.fields.municipalBoundary.state === 'verified',
          unincorporated: opts.projectLegalAuthority.unincorporated,
          incorporatedPlace: opts.projectLegalAuthority.normalized.incorporatedPlace,
        }
      : null,
  });
  const _ahjRecord = _ahjResolution.record;
  const codeAuthority = buildCodeAuthority({
    ahjRecord: _ahjRecord,
    ahjResolution: _ahjResolution,
    necVersionEnriched: (compliance?.jurisdiction as any)?.necVersion ?? proj.ahjNecVersion ?? null,
    ahjNameHint: (compliance?.jurisdiction as any)?.ahj ?? proj.ahjName ?? null,
    stateCodeHint: typeof proj.state === 'string' ? proj.state : null,
    asceEngineBasis: structAuth.env.codeAuthority.asceEdition ?? null,
    utilityName: proj.utilityName ?? null,
    utilityId: null,
    capturedAtIso: _capturedIso,
    // AAC WS-3 — the RETRIEVED adopted-code authority (code-authority@v1). Null
    // ⇒ IBC/IRC/IFC stay unknown, verifiedBy/sourceHash stay null and the record
    // stays `incomplete` — byte-identical to the pre-AAC-3 behaviour.
    codeAdoption: opts?.codeAdoptionAuthority ?? null,
  });
  // adoptedCodes MUST mirror the code-authority record (single source). A null
  // (unknown) adoption becomes '—' — never a fabricated year (V11 forbids a
  // sheet or the snapshot substituting an edition the authority does not carry).
  const _ce = codeAuthority.editions;
  const adoptedCodes = {
    nec: _ce.nec.edition ?? '—', ibc: _ce.ibc.edition ?? '—', irc: _ce.irc.edition ?? '—',
    ifc: _ce.ifc.edition ?? '—', asce: _ce.asce.edition ?? '—',
  };

  // ═══ OPEN-AIR MICRO / Q-CABLE GROUNDING AUTHORITY (2026-07-25) ═════════════
  // THE document-based, three-outcome resolution. The outcome is selected by
  // outcomeFromDocument(document, applicability) ALONE — the conductor count and
  // conductor-construction prose below are RECORDED as non-determinative facts and
  // are NOT passed to the selector. With no verified, exactly-applicable
  // manufacturer document archived (the live state), the outcome is
  // PENDING_MANUFACTURER_AUTHORITY and QCABLE-GROUNDING-AUTHORITY-UNVERIFIED fires.
  const _branchEgcObjs = groundingObjects.filter(g => g.purpose === 'branch-egc');
  const _gndPresent = isMicro && _branchEgcObjs.length > 0;
  const _gndPaths = branchCablePaths;
  const _gndDesignedFt = _gndPaths.length
    ? Math.round(_gndPaths.reduce((s, p) => s + (p.designedInstalledLengthFt ?? 0), 0) * 10) / 10
    : null;
  const _gndGeom = _gndPaths.length > 0 && _gndPaths.every(p => p.lengthProvenance === 'geometry-derived');
  const _gndWaste = 1.15;
  const _gndHomerunRw = (physicalRaceways ?? []).find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId)) ?? null;
  const _gndGecObj = groundingObjects.find(g => g.purpose === 'gec') ?? null;
  const openAirGroundingAuthority = _gndPresent
    ? resolveOpenAirGroundingAuthority({
        present: true,
        selection: {
          microSku: _selectedMicroSku,
          cableSku: listedCableAssembly?.sku ?? null,
          moduleSku: modules[0]?.sku ?? null,
          mountingBondingSystem: (mountDb as { id?: string; model?: string } | null)?.model
            ?? (mountDb as { id?: string } | null)?.id ?? null,
          jurisdiction: codeAuthority.ahjName ?? null,
          // P13 — the branch cabling architecture is a verified applicability
          // dimension (a document written for the integrated-MC4 architecture
          // cannot establish the method for a drop-connector Q-Cable branch).
          //
          // DERIVED FROM THE CANONICAL SELECTED CABLE ASSEMBLY — the same object
          // that supplies the cable SKU, the branch system, the connector family,
          // the terminator, the field-wireable connector compatibility and the
          // procurement inputs. Not from a display string, not from the document
          // title, and with NO default: a project whose micro brand has no
          // catalogued trunk system yields null here and the authority stays
          // PENDING, exactly as it must.
          connectorArchitecture: listedCableAssembly?.connectorArchitecture ?? null,
        },
        equipmentFacts: {
          // RECORDED, NON-DETERMINATIVE (never reaches the outcome selector).
          cableConductorConstruction: listedCableAssembly?.conductorConstruction ?? null,
          cableConductorCount: listedCableAssembly?.conductorCount ?? null,
          equipmentInsulationClassification: null,   // no in-repo document records one
        },
        // P13 — the ARCHIVED, HASH-BOUND Enphase IQ8 Series Installation and
        // Operation Manual (IOM-00068-3.0-EN, sha256 65167d4d…) retrieved from the
        // official documentation centre. It names the exact selected SKUs in its
        // own bytes (§8.4 IQ8A-72-2-US; §6.4/§8 Q-12-10-240, part 840-00387), and
        // §2.2 states the method EXPLICITLY: the listed models "do not require
        // grounding electrode conductors (GEC), equipment grounding conductors
        // (EGC), or grounded conductors (neutral)"; the microinverter carries a
        // Class II double-insulated rating with integrated GFP.
        //
        // FAIL-CLOSED BY CONSTRUCTION: the accessor returns null unless the
        // SELECTED model is one the document lists AND the connector architecture
        // matches, so a different micro (IQ8AC, IQ7) or the MC4 architecture keeps
        // this PENDING. An explicitly-supplied resolver evidence wins if present.
        documentEvidence: opts?.groundingDocumentEvidence
          ?? enphaseProductGroundingEvidence(
            (microInverters[0]?.model ?? null) as string | null),
        conductorMaterial: _branchEgcObjs[0]?.conductorMaterial ?? 'Cu',
        conductorSizeNecDerived: _branchEgcObjs[0]?.conductorSize ?? null,
        conductorSizingBasis: _branchEgcObjs[0]?.sizingBasis ?? null,
        branchIds: _gndPaths.length ? _gndPaths.map(p => p.branchId) : branches.map((b, i) => b.branchId ?? `br-${i + 1}`),
        segmentIds: ['BRANCH_RUN'],
        pathBasis: 'Σ per-branch BranchCablePath (same designed-installed geometry as the trunk)',
        designedInstalledFt: _gndDesignedFt,
        lengthProvenance: _gndPaths.length ? (_gndGeom ? 'geometry-derived' : 'estimated') : null,
        wasteFactor: _gndWaste,
        quantityFt: _gndDesignedFt != null ? Math.ceil(_gndDesignedFt * _gndWaste) : null,
        bondingMethod: mountDb
          ? `${(mountDb as { manufacturer?: string }).manufacturer ?? ''} ${(mountDb as { model?: string }).model ?? ''}`.trim()
            + ' listed mounting assembly bonding path (UL 2703) — module frames + racking'
          : null,
      })
    : null;
  // §5 SEPARATION — the five DISTINCT grounding/bonding domains as objects. No
  // domain inherits the open-air outcome; each states its own independent basis.
  const groundingDomainGraph = openAirGroundingAuthority
    ? buildGroundingDomainGraph({
        outcome: openAirGroundingAuthority.outcome,
        openAirLabel: openAirGroundingAuthority.renderLabel,
        homeRunEgcSize: (routeSegments.find(r => r.segmentId === 'BRANCH_HOMERUN_RUN')?.egcGauge) ?? null,
        homeRunRacewayLabel: _gndHomerunRw
          ? `${_gndHomerunRw.racewayType ?? 'raceway'} ${_gndHomerunRw.selectedRacewaySize ?? ''}`.trim()
          : null,
        homeRunPresent: !!_gndHomerunRw,
        bonding: openAirGroundingAuthority.rackingModuleBondingRequirement,
        gecRequired: _gndGecObj?.required ?? false,
        gecBasis: _gndGecObj?.codeBasis ?? 'NEC 250.64 / 690.47',
      })
    : [];

  // §14 / AAC WS-3 — project legal authority. The pure build still never
  // verifies anything itself: postal inference is not verification. What CAN
  // verify it is the async retrieval resolver (project-authority@v1), whose
  // record is threaded in through opts. With no retrieval this is `false`, the
  // per-field states resolve to 'unverified-derived' and the behaviour is
  // byte-identical to before. Never fabricated true.
  const _projectAuthorityVerified = opts?.projectLegalAuthority?.verified === true;

  // ═══ AAC WS-9 — DIGEST-BOUND ENGINEERING REVIEW ════════════════════════════
  // `certification.engineeringReviewApproved` was the literal `false` and
  // ENGINEERING-REVIEW-PENDING was pushed with no `if`, so the requirement could
  // not be cleared by any workflow that existed. It is now decided from the
  // migration-116 review store, READ (never written) by
  // engineering-review-record@v1 and threaded in through opts.
  //
  // THE COVERAGE RULE, fail-closed at every step: an approval must be ACTIVE,
  // recorded by a LICENSED role, and bound to a digest. `covered` here means the
  // resolver matched the project's PRIOR snapshot digest — the CURRENT digest
  // does not exist until this build finishes — and the existing consumers
  // (certPages, validate V13, the issue-state gate) re-check
  // `reviewedDigest === meta.digest`, so a review of a stale set never releases
  // a changed one. Absent opts ⇒ null ⇒ uncovered ⇒ byte-identical to before.
  const _reviewCoverage = opts?.engineeringReview ?? null;
  // ═══ PRR §1 — THIS BUILD IS TWO PASSES, AND PASS 1 IS REVIEW-NEUTRAL ════════
  // WS-9 projected the review here, at build time, into `certification`, the
  // issue state and the release registry — all of which are DIGESTED. So
  // recording an approval for digest D produced a snapshot whose digest was
  // D′ ≠ D, and `reviewedDigest === meta.digest` (the test validate V33/V34,
  // certPages, plansetProfile.certificationIsCompleted and peLetterIdentity all
  // apply) could never be true for ANY approval. Signing a document may not
  // change the document it signs.
  //
  // So: PASS 1 below builds the snapshot exactly as if UNREVIEWED and digests
  // it. That digest is the DESIGN DIGEST — it identifies the design, is
  // invariant to whether anyone has approved it, and is byte-identical to what
  // this function produced before this change for every unapproved build.
  // PASS 2 (after the digest, at the foot of this function) decides coverage
  // against that digest and projects the approval.
  //
  // Nothing between here and the digest may read the coverage record.
  const _engineeringReviewCovered = false;

  // ═══ AAC WS-7 — CONDUIT-FILL AUTHORITY (the computed NEC Ch.9 T1 result) ════
  // The calculation runs in the canonical engine; the projection seam now
  // carries it (four field-name mismatches fixed). This evaluator decides the
  // requirement from that result plus the completeness of its inputs — the ONE
  // place CONDUIT-FILL-PENDING is decided.
  const _feederSeg = routeSegments.find(r => r.segmentId === String(feederRun?.id ?? ''))
    ?? routeSegments.find(r => /COMBINER_TO_DISCO|INV_TO_DISCO/.test(r.segmentId))
    ?? null;
  const conduitFillEvaluation: ConduitFillEvaluation | null = cs
    ? evaluateConduitFillAuthority({
        segmentId: _feederSeg?.segmentId ?? (feederRun ? String(feederRun.id) : null),
        racewayType: (elec?.conduitFill as { conduitType?: string } | undefined)?.conduitType
          ?? feederRun?.conduitType ?? _feederSeg?.raceway ?? null,
        racewaySize: (elec?.conduitFill as { conduitSize?: string } | undefined)?.conduitSize
          ?? feederRun?.conduitSize ?? _feederSeg?.tradeSizeIn ?? null,
        conductorCount: (isFinite(feederRun?.conductorCount) ? feederRun.conductorCount : null)
          ?? _feederSeg?.conductorCount ?? null,
        conductorGauge: feederRun?.wireGauge ?? _feederSeg?.conductorGauge ?? null,
        insulation: feederRun?.insulation ?? _feederSeg?.insulation ?? null,
        egcGauge: feederRun?.egcGauge ?? _feederSeg?.egcGauge ?? null,
        codeEdition: codeAuthority.editions.nec.edition ?? null,
        computedFillPct: (elec?.conduitFill as { fillPercent?: number } | undefined)?.fillPercent
          ?? (isFinite(feederRun?.conduitFillPct) ? feederRun.conduitFillPct : null) ?? null,
        computedPass: (elec?.conduitFill as { passes?: boolean } | undefined)?.passes
          ?? feederRun?.conduitFillPass ?? null,
      })
    : null;

  // ═══ AAC WS-5/WS-7 — the RG-5 raceway verdicts, decided ONCE (the derived
  // resolver records them as evidence and the registry below consumes the same
  // booleans — one derivation, two consumers). ════════════════════════════════
  const _feederRacewayResolved = !!(feederRun?.conduitType);
  const _branchRacewayVerdict = ((): { ambiguous: boolean; reasons: string[] } => {
    if (!cs?.isMicro) return { ambiguous: false, reasons: [] };
    const openAir = routeSegments.find(r => r.segmentId === 'BRANCH_RUN');
    const homerun = physicalRaceways.find(rw => /BRANCH-HOMERUN/.test(rw.physicalRacewayId));
    const homerunSeg = routeSegments.find(r => r.segmentId === 'BRANCH_HOMERUN_RUN');
    const reasons: string[] = [];
    if (!homerun) reasons.push('no shared branch home-run raceway object');
    else {
      if (!(homerun.sharedCircuitCount >= 1)) reasons.push('the shared home-run raceway carries no shared-circuit count');
      if (homerun.fillPct == null) reasons.push('the shared home-run raceway carries no computed fill (NEC Ch.9, Table 1)');
    }
    if (openAir != null && openAir.raceway != null && openAir.raceway !== 'FREE_AIR') {
      reasons.push('the open-air Q-Cable trunk is stamped in-conduit');
    }
    if (homerunSeg != null && (homerunSeg.raceway == null || homerunSeg.raceway === 'FREE_AIR')) {
      reasons.push('the home-run section is not modeled in-conduit');
    }
    return { ambiguous: reasons.length > 0, reasons };
  })();
  const _racewaySegmentConflicts = ((): string[] => {
    const bySeg = new Map<string, Set<string>>();
    for (const r of routeSegments) {
      const key = `${r.raceway ?? '—'}|${r.tradeSizeIn ?? '—'}`;
      const s = bySeg.get(r.segmentId) ?? new Set<string>();
      s.add(key); bySeg.set(r.segmentId, s);
    }
    return [...bySeg.entries()].filter(([, s]) => s.size > 1).map(([id]) => id);
  })();

  // ═══ AAC WS-5/WS-7 — THE DERIVED (DESIGN-GEOMETRY) RESOLVER STAGE ══════════
  // Runs BEFORE the registry is built, on the framework's own contract (same
  // ClearanceResult, same evidence record, same audit-ref rule). Its states
  // merge OVER the async lifecycle's states, so a requirement whose owning
  // resolver runs here is never reported as "resolver not implemented" and its
  // clearance carries a real audit reference.
  const _derivedResolution = runDerivedResolutionStage({
    nowIso: String(_capturedIso || ''),
    conduitFill: conduitFillEvaluation,
    routeSegments,
    physicalRaceways,
    feederRacewayResolved: _feederRacewayResolved,
    isMicro: !!cs?.isMicro,
    branchRacewayAmbiguous: _branchRacewayVerdict.ambiguous,
    branchRacewayReasons: _branchRacewayVerdict.reasons,
    racewaySegmentConflicts: _racewaySegmentConflicts,
    qcableTopology,
    qcableEvaluation,
    qcableProcurement,
    procurementSufficiency,
  });
  const _resolutionStates = mergeResolutionStates(opts?.resolutionStates ?? null, _derivedResolution.states);

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
      'BRANCH-RACEWAY-AUTHORITY': { severity: 'blocking', authorityPath: 'electrical.physicalRaceways[branch home-run]', sheets: ['PV-4A', 'PV-4B', 'E-1', 'SCHED'], resolution: 'Model the branch route as explicit sections (open-air Q-Cable + shared home-run raceway); the shared jbox→combiner raceway must carry documented shared-circuit count + fill (NEC Ch.9, Table 1).' },
      'RACEWAY-SEGMENT-CONFLICT': { severity: 'blocking', authorityPath: 'electrical.routeSegments[].raceway', sheets: ['PV-1', 'PV-4B', 'E-1', 'SCHED'], resolution: 'A single physical segment id resolves to more than one raceway type/size — reconcile to ONE raceway per physical run (gate 3).' },
      // §17 — PROMOTED to BLOCKING (permit-critical). The authoritative severity is
      // set by severityPolicy.ts; these META fields are documentary and kept in sync.
      'CONDUIT-FILL-PENDING': { severity: 'blocking', authorityPath: 'electrical.feeder.conduit.fillPct', sheets: ['PV-4A', 'PV-4B'], resolution: 'Compute conduit fill for the feeder raceway (NEC Ch.9, Table 1) — no zero-error claim while PENDING.' },
      'TAP-CONDUCTOR-LENGTH-PENDING': { severity: 'blocking', authorityPath: 'electrical.serviceTopology[svc-tap-conductors].constraints', sheets: ['PV-4B', 'E-1'], resolution: 'Field-measure the tap-conductor run and confirm ≤10 ft (NEC 705.11(C)).' },
      // GROUNDING AUTHORITY (2026-07-25) — the open-air branch grounding method is
      // not established by any verified, exactly-applicable manufacturer document.
      'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': { severity: 'blocking', authorityPath: 'electrical.openAirGroundingAuthority', sheets: ['E-1', 'PV-1B', 'PV-4B', 'SCHED'], resolution: 'Archive + verify (document registry) the manufacturer installation document that EXPLICITLY states the grounding/bonding method for the open-air branch section of the EXACT selected equipment (micro + cable + module + mount SKUs, this jurisdiction), with SHA-256, revision, current status and exact section/page. A family/series/product-line document or a conductor-count inference can never clear this.' },
      'QCABLE-PROCUREMENT-INSUFFICIENT': { severity: 'blocking', authorityPath: 'electrical.procurementSufficiency', sheets: ['PV-4B', 'SCHED', 'E-1'], resolution: 'Procurement: select a VERIFIED listed cable-extension/jumper product (exact SKU + verified manufacturer document via the document registry + IQ8A/Q-Cable compatibility + quantity/location + represented in the drawings/schedules/BOM + recalculated VD/installation), OR an alternate listed cable whose procurement footage envelopes the designed-installed path, OR revise the route/layout to reduce the path. "Jumpers required" by assertion does NOT clear this.' },
      'QCABLE-STOCK-PACKAGING-UNVERIFIED': { severity: 'blocking', authorityPath: 'electrical.qcableProcurement.stockUnitConnectorSections', sheets: ['PV-4B', 'SCHED', 'BOM'], resolution: 'Archive the manufacturer document that tables the purchasable package (connector sections per box) for the selected cable, or select a cable the archived table already lists.' },
      'QCABLE-FIELD-CONNECTOR-SKU-MISSING': { severity: 'blocking', authorityPath: 'electrical.qcableProcurement.accessories', sheets: ['PV-4B', 'SCHED', 'BOM'], resolution: 'Archive the manufacturer document naming the field-termination accessory for the selected cable assembly; an accessory with no established SKU may not be ordered.' },
      'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED': { severity: 'blocking', authorityPath: 'electrical.qcableProcurement.accessories', sheets: ['PV-4B', 'SCHED', 'BOM'], resolution: 'Establish the terminator SKU and its documented per-branch-circuit quantity from an archived manufacturer document for the selected cable assembly.' },
      // §2 (BAR) — the environmental-load authority gate. Subsumes the retired
      // WIND-SNOW-AUTHORITY-UNRESOLVED (null / code-minimum-default case) AND the
      // operator-entered-without-provenance case. Cleared ONLY by a verified,
      // archived, currency-reviewed climate-hazard source covering this project.
      'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': { severity: 'blocking', authorityPath: 'structural.env.environmentalLoadAuthority', sheets: ['PV-0', 'PV-4C', 'PE-1'], resolution: 'Resolve the design wind speed, exposure category, risk category and ground snow load from an ARCHIVED climate-hazard source for this exact site (ASCE 7 Hazard-Tool report or the AHJ climate/design-criteria ordinance): archive the document through the document registry (hash + verified state), record its dataset, version/date, the coordinates/address looked up, and the lookup timestamp, and confirm its CURRENCY (no automatic staleness rule exists — verification requires a recorded currency review). Operator-entered values are an OBSERVATION/OVERRIDE and can never clear this; a code-minimum default is preliminary only.' },
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
      // §17 — severity + advisory justification come from the CANONICAL severity
      // policy (single source). A blocker is advisory ONLY with an explicit,
      // justified policy entry; every unmapped code fails closed to BLOCKING. The
      // emitter's requested severity (over/META) is advisory INTENT only and can
      // never downgrade a code the policy classifies blocking.
      const _sev = classifyBlockerSeverity(code);
      // AAC WS-1 — a requirement's RESOLUTION STATE travels with the requirement.
      // It rides in the EXISTING payload slot (renderBlockerPayload → the generic
      // component prints honest key/value pairs), so nothing about RS-1's layout
      // changes; the payload SCHEMA gains the resolution fields. When no
      // lifecycle ran (harness / test / GET without authority) the payload is
      // exactly what it was, so the digest does not churn.
      const _resState = _resolutionStates[code] ?? null;
      const _basePayload = over?.payload ?? null;
      const _payload = _resState
        ? { ...(_basePayload ?? {}), ...resolutionStatePayload(_resState) }
        : _basePayload;
      registry.push({
        code,
        severity: _sev.severity,
        justification: _sev.justification,
        domain,
        authorityPath: over?.authorityPath ?? m?.authorityPath ?? (isStruct ? STRUCT_DEFAULT.authorityPath : `snapshot (${domain})`),
        affectedSheets: over?.affectedSheets ?? m?.sheets ?? (isStruct ? STRUCT_DEFAULT.sheets : []),
        explanation,
        resolutionAction: over?.resolutionAction ?? m?.resolution ?? (isStruct ? STRUCT_DEFAULT.resolution : 'Resolve the missing authority before permit-ready.'),
        payload: _payload,
        provenance: over?.provenance ?? { source: 'snapshot build (permitReadiness)', ref: null },
        createdAtIso: _capturedIso,
        createdVersion: String(PLANSET_ENGINE_VERSION),
        // ═══ MCC §1 — THE LIFECYCLE'S CLEARANCE IS AUTHORITY, NOT PROSE ═══════
        // These two were the literals `false` and `null` on EVERY record. The
        // resolution state carrying the answer is `_resState`, in scope 18 lines
        // above — and it was consumed ONLY to decorate the rendered payload. So a
        // resolver could do the real registry read, return RESOLVED with an audit
        // reference, have the lifecycle mark the requirement `cleared`… and the
        // requirement still shipped OPEN, because the record that the release
        // gate actually reads was hardcoded unresolved.
        //
        // This is the same defect class as the review-coverage circularity: an
        // authority result is computed and then discarded at the consumer. It was
        // not specific to the module datasheet — it silently voided EVERY
        // resolver clearance in the system.
        //
        // FAIL-CLOSED, and deliberately the SAME two-part predicate
        // `deriveRequirementStatus` applies (releaseGates.ts) — a `cleared` flag
        // with no audit reference is not a clearance, so the registry can never
        // claim a resolution the gate would reject:
        resolved: _resState?.cleared === true && !!_resState?.resolutionAuditRef?.trim(),
        resolutionAuditRef: _resState?.resolutionAuditRef?.trim() ? _resState.resolutionAuditRef : null,
      });
    };

    // AAC WS-5/§2.13 SPLIT — the requirement is NARROWED to its honest residual.
    // The branch cable path IS routed geometry (module coordinates → ordered
    // cable chain), and its segment now says so (lengthSource 'cad-route'). What
    // remains is the feeder / home-run / service runs whose physical route no
    // record carries — named segment by segment, never "all run lengths".
    {
      // ── D1 — PROJECT route authority applies to PROJECT-OWNED runs only ────
      // Fail-closed: an unpopulated record counts as the installer's.
      const _projectRoutes = routeSegments.filter(r =>
        (r.routeAuthorityApplicability ?? 'REQUIRED') === 'REQUIRED');
      const _excludedRoutes = routeSegments.filter(r =>
        (r.routeAuthorityApplicability ?? 'REQUIRED') !== 'REQUIRED');
      // WS-5 §14 — the SAME named closure policy the derived resolver uses, so
      // the permit-set banner and the internal-set requirement cannot disagree.
      // 'operator-entry' (an UNVERIFIED field report) is deliberately residual:
      // it has already become the calculation length and it closes nothing.
      const _residual = _projectRoutes.filter(r => !sourceClosesRouteLengthRequirement(r.lengthSource));
      const _derivedSegs = _projectRoutes.filter(r => sourceClosesRouteLengthRequirement(r.lengthSource));
      if (_residual.length > 0) {
        push('ROUTE-LENGTH-ESTIMATE',
          `${_residual.length} of ${_projectRoutes.length} PROJECT-OWNED electrical run(s) have no routed geometry in the CAD model and require a field-measured route: `
            + `${_residual.map(r => `${r.segmentId} (${r.electricalFunction ?? 'run'})`).join(', ')}`
            + (_derivedSegs.length ? `. ${_derivedSegs.length} run(s) ARE geometry-derived and are not blocked: ${_derivedSegs.map(r => r.segmentId).join(', ')}.` : '')
            + (_excludedRoutes.length
              ? ` ${_excludedRoutes.length} run(s) are EXCLUDED from project route authority: ${_excludedRoutes.map(r => `${r.segmentId} (${r.routeOwnership === 'UTILITY_OWNED' ? 'utility-owned service equipment' : 'not applicable'})`).join(', ')}.`
              : ''),
          {
            payload: {
              residualSegmentIds: _residual.map(r => r.segmentId),
              residualSegments: _residual.map(r => ({ segmentId: r.segmentId, electricalFunction: r.electricalFunction ?? null, oneWayFt: r.oneWayFt, lengthSource: r.lengthSource })),
              geometryDerivedSegmentIds: _derivedSegs.map(r => r.segmentId),
            },
            resolutionAction:
              'Record a CAD-routed or field-measured length for the NAMED runs only (the branch cable path is already derived from the module coordinates).',
          });
      }
    }
    // Req. 7: stored equipment-identity conflict (e.g. Braidon subSystems
    // panelId vs fleet model) BLOCKS permit-ready until operator reconciliation.
    // W10b: this conflict was NEVER reconciled — it must stay VISIBLE (first-class
    // registry entry), never hidden by a renderer ternary.
    for (const c of equipmentIdentityConflicts) push('EQUIPMENT-IDENTITY-CONFLICT', c);
    // §14 carry-forward: missing feeder raceway/conduit type authority stays
    // visible and blocking (never weakened by W3).
    if (cs && !_feederRacewayResolved) {
      push('FEEDER-RACEWAY-AUTHORITY',
        'Feeder raceway/conduit type not resolved on the canonical feeder segment — raceway + bonding authority required');
    }
    // W10a: conduit fill PENDING was only ever a schedule-cell literal (counted as
    // "0 errors" on PV-4A). §17 — emit it as a BLOCKING blocker (unresolved required
    // conduit fill can hide a thermal-derating/ampacity violation; never a pass).
    // AAC WS-7 — decided by the conduit-fill AUTHORITY (the computed NEC Ch.9
    // Table 1 result + input completeness), never by a projection field that was
    // silently null. A PRESENT computed fill clears it; a genuinely missing
    // input fires it and NAMES the input.
    if (cs && conduitFillEvaluation && !conduitFillEvaluation.cleared) {
      push('CONDUIT-FILL-PENDING',
        `Feeder conduit fill is NOT ESTABLISHED — ${conduitFillEvaluation.reasons.join('; ')}. `
          + 'It must never be presented as a passing zero-error result on PV-4A/PV-4B.',
        {
          payload: {
            missingInputs: conduitFillEvaluation.missing,
            racewayType: conduitFillEvaluation.record.racewayType,
            racewaySize: conduitFillEvaluation.record.racewaySize,
            conductorSet: conduitFillEvaluation.record.conductorSet,
            codeEdition: conduitFillEvaluation.record.codeEdition,
            necBasis: conduitFillEvaluation.record.necBasis,
          },
          resolutionAction:
            'Supply the named raceway / conductor / code-edition input — the fill itself is COMPUTED (NEC Chapter 9, Tables 1/4/5), never field-measured.',
        });
    }
    // §4 BRANCH-RACEWAY coverage gate. A micro design's AC branch route is TWO
    // physical sections: the open-air Q-Cable trunk (no raceway) and the shared
    // jbox→combiner home-run raceway that carries ALL branches bundled. If the
    // canonical model does not carry that shared raceway (with a documented
    // shared-circuit count + fill), the branch grouping is AMBIGUOUS — block
    // (never let a sheet describe a multi-method branch with one merged string).
    // AAC WS-5 — the verdict is computed ONCE above (raceway-authority@v1 records
    // the same booleans as evidence); the registry consumes it.
    if (cs?.isMicro && _branchRacewayVerdict.ambiguous) {
      push('BRANCH-RACEWAY-AUTHORITY',
        'Micro AC branch raceway model is incomplete/ambiguous — the shared jbox→combiner home-run raceway (with documented shared-circuit count + fill) and the open-air Q-Cable trunk must be modeled as distinct physical sections: '
          + _branchRacewayVerdict.reasons.join('; '));
    }
    // §2/gate 3 — a single physical segment id must resolve to exactly ONE raceway
    // type + size. Defends against a merged segment re-introducing two wiring
    // methods (the PVC-vs-EMT / open-air-vs-conduit contradiction) at the source.
    if (_racewaySegmentConflicts.length > 0) {
      push('RACEWAY-SEGMENT-CONFLICT',
        `Segment id(s) ${_racewaySegmentConflicts.join(', ')} resolve to more than one raceway type/size — one physical run must carry ONE raceway`);
    }
    // W10a: tap-conductor length is PENDING (no CAD/field datum) — the ≤10-ft
    // NEC 705.11(C) rule cannot be evaluated. §17 — surface it as a BLOCKING
    // blocker (no compliant claim without a length) rather than only a
    // service-topology PENDING cell.
    if (serviceTopology.some(o => o.type === 'tap-conductors'
      && (o.constraints ?? []).some(k => k.state === 'pending'))) {
      push('TAP-CONDUCTOR-LENGTH-PENDING',
        'Supply-side tap-conductor length is not measured — NEC 705.11(C) ≤10-ft rule is PENDING (never a compliant claim without a length)');
    }
    // §Q — Q-CABLE PROCUREMENT INSUFFICIENCY. The Σ geometric designed-installed
    // cable path exceeds the drop-based procurement footage (+ allowance 0): the
    // ordered listed cable is SHORT of the as-routed installed path. This is a
    // FAIL-CLOSED blocker (procurement + engineering approval + permit acceptance),
    // never a FIELD-VERIFY/"jumpers required" note. Only a VERIFIED
    // CableExtensionSolution clears it (none wired on live ⇒ it stays firing).
    // WS-2 — a MEASURED shortage is answered by a RESOLVED procurement design.
    // When resolveQCableProcurement returns VERIFIED, the purchase exists: the
    // per-branch allocation, the stock item in the manufacturer's own package
    // unit, the integer package count, the remainder and every accessory are all
    // established from the archived IOM. The broad blocker then has nothing left
    // to say and is replaced by whatever scoped residual (if any) the resolution
    // itself raises — never by silence, and never by a rename.
    const _qpResolved = qcableProcurement?.present === true
      && qcableProcurement.compatibilityStatus === 'VERIFIED';
    if (qcableProcurement?.present && qcableProcurement.residuals.length > 0) {
      for (const res of qcableProcurement.residuals) {
        if (res.code === 'QCABLE-PROCUREMENT-INSUFFICIENT') continue;  // handled below
        push(res.code, res.message, {
          payload: {
            selectedCableAssemblySku: qcableProcurement.selectedCableAssemblySku,
            connectorArchitecture: qcableProcurement.connectorArchitecture,
            topologyConstrainedInstalledDeficitFt: qcableProcurement.topologyConstrainedInstalledDeficitFt,
            selectedStockSku: qcableProcurement.selectedStockSku,
            stockUnitDescription: qcableProcurement.stockUnitDescription,
            unresolved: qcableProcurement.unresolved,
            evidenceIds: qcableProcurement.evidenceIds,
          },
          provenance: { source: 'electrical.qcableProcurement', ref: qcableProcurement.resolutionId },
        });
      }
    }
    if (procurementSufficiency?.insufficient && !_qpResolved) {
      const ps = procurementSufficiency;
      // Concise one-line explanation (banner/cover render this); the full per-branch
      // + resolution detail lives in resolutionAction + payload, shown on RS-1.
      // TAC WS-1 — the sentence states the GOVERNING basis with ITS OWN
      // operands. It used to read "procurement 152 ft is SHORT of the 166.5 ft
      // designed path by 24.2 ft", pairing the aggregate operands with the
      // topology-constrained result: 166.5 − 152 = 14.5, so the printed
      // arithmetic was false even though both numbers were individually right.
      const _govTopology = ps.deficitBasis === 'topology-constrained';
      push('QCABLE-PROCUREMENT-INSUFFICIENT',
        _govTopology
          ? `Q-Cable procurement is SHORT by ${ps.topologyConstrainedDeficitFt} ft on a PER-BRANCH basis `
            + `(Σ per-branch shortfall; aggregate footage alone is short by only ${ps.aggregateFootageDeficitFt} ft because `
            + `${ps.nonRedistributableSurplusFt} ft of surplus sits on a branch that cannot supply another) — `
            + `minimum additional purchasable cable ${ps.requiredAdditionalPurchasableLengthFt} ft. `
            + `Base cable quantity NON-ORDERABLE / PENDING a VERIFIED listed cable-extension solution.`
          : `Q-Cable procurement ${ps.procurementLengthFt} ft is SHORT of the ${ps.totalDesignedInstalledFt} ft designed-installed path `
            + `(+${ps.requiredServiceLoopAllowanceFt} ft allowance) by ${ps.aggregateFootageDeficitFt} ft — `
            + `base cable quantity NON-ORDERABLE / PENDING a VERIFIED listed cable-extension solution.`,
        { payload: procurementInsufficiencyPayload(ps), provenance: { source: 'electrical.procurementSufficiency', ref: ps.assemblyId } });
    }
    // GROUNDING AUTHORITY (2026-07-25) — the equipment grounding/bonding method
    // for the OPEN-AIR branch section is not established by a verified,
    // exactly-applicable manufacturer document ⇒ FAIL CLOSED. Neither outcome may
    // be asserted, the candidate EGC quantity is a non-orderable design quantity,
    // and permit/procurement readiness is blocked. Never cleared by a conductor
    // count, a family document or an engineering opinion.
    if (openAirGroundingAuthority?.blocking) {
      const ga = openAirGroundingAuthority;
      push(GROUNDING_AUTHORITY_BLOCKER_CODE,
        `Open-air branch grounding method NOT ESTABLISHED for the selected `
          + `${ga.selectedMicroinverterSku ?? 'microinverter'} + ${ga.selectedCableAssemblySku ?? 'cable assembly'} `
          + `(no applicable manufacturer document) — candidate ${ga.quantityFt ?? '—'} ft EGC is a design quantity, non-orderable.`,
        {
          payload: {
            outcome: ga.outcome,
            selectedMicroinverterSku: ga.selectedMicroinverterSku,
            selectedCableAssemblySku: ga.selectedCableAssemblySku,
            selectedModuleSku: ga.selectedModuleSku,
            selectedMountingBondingSystem: ga.selectedMountingBondingSystem,
            projectJurisdiction: ga.projectJurisdiction,
            equipmentInsulationClassification: ga.equipmentInsulationClassification,
            cableConductorConstruction: ga.cableConductorConstruction,
            cableConductorCount: ga.cableConductorCount,
            conductorCountIsNonDeterminative: ga.conductorCountIsNonDeterminative,
            documentId: ga.documentId,
            documentHash: ga.documentHash,
            documentSectionOrPage: ga.documentSectionOrPage,
            applicabilityVerification: ga.applicabilityVerification,
            necBasis: ga.necBasis,
            rackingModuleBondingRequirement: ga.rackingModuleBondingRequirement,
            candidateQuantityFt: ga.quantityFt,
            bomRowState: ga.bomRowState,
            verificationStatus: ga.verificationStatus,
            // PPC §2 — Ray's RS-1 field list requires the AFFECTED SEGMENT IDS on
            // the grounding payload (the schema-typed component renders them).
            affectedSegmentIds: ga.segmentIds,
            affectedBranchIds: ga.branchIds,
            resolutionRequirement: ga.resolutionRequirement,
          },
          provenance: { source: 'electrical.openAirGroundingAuthority', ref: ga.selectedCableAssemblySku },
        });
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
    // ── D-6 · AAC WS-9 — ENGINEERING REVIEW IS NOW CONDITIONAL ──────────────
    // It used to be pushed with NO `if` at all, matching a hardcoded
    // `certification.engineeringReviewApproved: false`. That made a legitimate
    // PROFESSIONAL_APPROVAL requirement structurally UNCLEARABLE — no table, no
    // API, no UI existed to record the approval that would clear it.
    //
    // Migration 116 (engineering_review_records) + the admin API give a licensed
    // engineer of record a real way to record a digest-bound approval, and
    // engineering-review-record@v1 READS it. The requirement now fires unless an
    // ACTIVE approval by a LICENSED reviewer covers this project's snapshot.
    //
    // FAIL-CLOSED, three ways: an unreadable store is never coverage; an
    // approval for a DIFFERENT digest is never coverage (checked again at
    // certPages / validate against meta.digest); and the engine can never write
    // an approval — it only reads one.
    // PASS 1 is review-neutral, so this requirement always fires here and its
    // message may not vary with the coverage record (the message is digested —
    // a basis string that mentions the approver would put the approval back
    // inside the design digest). PASS 2 resolves the entry, with the reviewer's
    // identity as its evidence, when a licensed approval covers the design
    // digest; when it does not, PASS 2 replaces this message with the precise
    // refusal (stale digest / unlicensed role / ledger invalidation / …).
    push('ENGINEERING-REVIEW-PENDING',
      'No approved engineering-review record covering this snapshot digest (D-6).');

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
  // ── AAC WS-9 — the engineering-review record is no longer HARDCODED absent ──
  // It used to be the literal `null` (with the comment "always absent at build"),
  // which is what made the review requirement unclearable and forced
  // deriveIssueState permanently to PENDING. It now projects the SAME
  // digest-bound coverage the requirement itself is decided from, so the stored
  // issue state and the registry can never disagree (validator V33).
  //
  // Still fail-closed: null unless a LICENSED reviewer's active approval names a
  // digest, and deriveIssueState independently re-checks that digest against the
  // one the sheets carry.
  // PASS 1: no review record (see the PRR §1 block above). PASS 2 rebuilds this
  // record — and the whole projectAuthority with it — once the design digest an
  // approval must name actually exists.
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
    // PASS 1 neutral values. These two were HARDCODED `false` with the stale
    // comments "no review record at build" / "certification.engineer === null at
    // build" — both untrue since WS-9 wired the coverage record 24 lines above,
    // and together they made the ISSUED-FOR-PERMIT gate unreachable for every
    // project regardless of what any engineer recorded. PASS 2 supplies the
    // decided values from decideReviewCoverage().
    engineerReviewCoversCurrentDigest: false,
    digestInvalidatedByLedger: opts?.digestInvalidatedByLedger ?? false,
    signatureSealSatisfied: false,
  };
  const _paArgs: ProjectAuthorityBuildArgs = {
    projectName: proj.projectName ?? null,
    customer: proj.clientName ?? null,
    installationAddress: proj.address ?? null,
    city: proj.city ?? null,
    stateCode: typeof proj.state === 'string' ? proj.state : null,
    // The canonical state is DERIVED inside buildProjectAuthority from these
    // candidates, in this precedence. The AHJ record and the posted compliance
    // jurisdiction are offered so a project record with an empty (or 'Unknown')
    // state can still resolve — but neither may outrank the project's own state
    // or its postal address, and neither may introduce a state the address
    // contradicts (recorded as a conflict and caught by V46).
    ahjStateCode: _ahjRecord?.stateCode ?? null,
    complianceState: (compliance?.jurisdiction as { state?: string } | undefined)?.state ?? null,
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
    authorityVerified: _projectAuthorityVerified,       // §14 / AAC WS-3
    // AAC WS-3 — the RETRIEVED per-field verification states. Absent (no
    // retrieval) ⇒ the §14 all-or-nothing behaviour is byte-identical.
    authorityFieldVerification: opts?.projectLegalAuthority
      ? {
          address: opts.projectLegalAuthority.fields.address.state,
          apn: opts.projectLegalAuthority.fields.apn.state,
          municipalBoundary: opts.projectLegalAuthority.fields.municipalBoundary.state,
          ahjName: opts.projectLegalAuthority.fields.ahjName.state,
          fireAuthority: opts.projectLegalAuthority.fields.fireAuthority.state,
        }
      : undefined,
    authorityFieldBasis: opts?.projectLegalAuthority
      ? {
          address: opts.projectLegalAuthority.fields.address.basis,
          apn: opts.projectLegalAuthority.fields.apn.basis,
          municipalBoundary: opts.projectLegalAuthority.fields.municipalBoundary.basis,
          ahjName: opts.projectLegalAuthority.fields.ahjName.basis,
          fireAuthority: opts.projectLegalAuthority.fields.fireAuthority.basis,
        }
      : undefined,
    // RGM §5 — the sheet index must include the RS-1.n review-status
    // continuation sheets, whose count depends on THIS registry. The snapshot is
    // still being assembled here, so the FINAL registry is handed over
    // explicitly rather than read back through peekSnapshot.
    sheetIndex: computePlansetManifest(input, cad, { releaseRegistry: _permitReadiness.registry }),
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
    // PASS 1: review === null, so this is genuinely unused. It was NOT unused
    // once WS-9 started supplying a review here: a 64-hex reviewedDigest never
    // equals '', so deriveIssueState read every real approval as a digest
    // MISMATCH and reported REVISED — "prior approval invalidated by a design
    // change" — for a design that had not changed. PASS 2 passes the real digest.
    currentDigest: '',
    gateInput: _paGateInput,
    capturedAtIso: _capturedIso,
  };
  const projectAuthority = buildProjectAuthority(_paArgs);

  const snapshot: PermitDesignSnapshot = {
    codeAuthority,
    projectAuthority,
    meta: {
      snapshotId: '', digest: '', schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      engineVersion: String(PLANSET_ENGINE_VERSION),
      // D6 NOTE — this field is DIGESTED, and the digest is pinned byte-identical
      // across two renders of the same input (aac-ws3-ws4, wave6-legacy-sweep).
      // Substituting the resolved context's true sub-second UTC instant here made
      // every unfrozen render produce a new snapshot id, so it is deliberately NOT
      // done. The known defect stands and is recorded rather than papered over:
      // with no injected `generatedAtIso`, this stores the localised 'M/D/YYYY'
      // issue date in a slot the schema declares as ISO. Fixing it needs the
      // digest to stop covering the generation instant — a snapshot-contract
      // change, out of scope for an artifact-projection repair.
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
      openAirGroundingAuthority,
      groundingDomainGraph,
      routeSegments,
      physicalRaceways,
      listedCableAssembly,
      branchCablePaths,
      procurementSufficiency,
      qcableProcurement,
      // AAC WS-5 — THE deterministic Q-Cable topology object (ordered drops,
      // transitions, cable ends, dead drops, installed vs procurement length,
      // geometry coverage, field-dependent portion). Every consumer reads THIS.
      qcableTopology,
      // AAC WS-7 — the computed NEC Ch.9 Table 1 conduit-fill authority record.
      conduitFillAuthority: conduitFillEvaluation?.record ?? null,
      // ECD §5 (W1-F) — the tap-CONNECTION authority. Null for load-side designs.
      supplySideTapConnection: buildSupplySideTapConnectionAuthority({
        interconnectionMethod: String(proj.interconnectionMethod ?? 'LOAD_SIDE'),
        serviceTopology,
        project: proj as Record<string, unknown>,
      }),
      serviceTopology,
      feeder: {
        conductorId: feederConductorId,
        ocpdA: cs?.backfeedBreakerAmps ?? cs?.acOcpdAmps ?? null,
        continuousA: cs?.acContinuousCurrentA ?? null,
        currentA: cs?.acOutputCurrentA ?? null,
        // WS-5 §12 — when the canonical feeder run carries a FIELD MEASUREMENT,
        // its voltage drop is the RECALCULATED one, not the engine's estimate
        // result. projectCanonicalFeeder prefers THIS field over the segment's,
        // so leaving it on the old value is what printed "Vd = 0.37% over 89 ft"
        // on PV-4B — the previous length's percentage beside the measured
        // length. `_fieldVoltageDrop` holds a value ONLY for segments the
        // measurement authority actually moved, so an unmeasured project is
        // byte-identical.
        voltageDropPct: (feederRun?.id != null && _fieldVoltageDrop.has(String(feederRun.id)))
          ? _fieldVoltageDrop.get(String(feederRun.id)) ?? null
          : (feederRun?.voltageDropPct ?? null),
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
      // ╔═══════════════════════════════════════════════════════════════════╗
      // ║ ECD §7 (WS-2) RACKING BONDING AUTHORITY — its own region.         ║
      // ╚═══════════════════════════════════════════════════════════════════╝
      // The bonding REQUIREMENT (NEC 250.134 / 690.43) is code and always
      // rendered; the bonding METHOD is gated on the exact verified assembly.
      // Four renderer-local literals used to assert "UL 2703 INTEGRATED" /
      // "BONDING JUMPER" with no authority at all — including inside the
      // assembly-PENDING branch of PV-3's own hardware schedule. This is the ONE
      // object all four now project. Built from the ALREADY-COMPUTED racking
      // assembly + the cited document's ECD §8 applicability state; every field
      // is an honest null while the method is pending.
      rackingBonding: buildRackingBondingAuthority({
        assembly: structAuth.rackingAssembly,
        documentApplicability: mountAsset
          ? (() => {
              const _a = evaluateDocumentApplicability(
                mountDb?.model ?? mountAsset.model, mountAsset, null);
              return {
                state: _a.state,
                applicabilityVerified: _a.applicabilityVerified,
                documentTitle: mountAsset.docTitle ?? null,
              };
            })()
          : null,
        moduleFrame: modules[0]?.model ?? null,
        // No bonding BOM row is orderable while the assembly is unselected (the
        // racking lot is class-B non-orderable) — so nothing is claimed here.
        orderableBondingBomLineIds: [],
      }),
      rails: structAuth.rails,
      attachments: structAuth.attachments,
      env: structAuth.env,
      checks: structAuth.checks,
      engine: structAuth.engine,
      // FRAMING-AUTHORITY GATE — OBSERVED framing (operator-entered geometry) +
      // the verified CAPACITY authority (or null ⇒ FRAMING-AUTHORITY-UNVERIFIED).
      framingObservation: structAuth.framingObservation,
      framingCapacityAuthority: structAuth.framingCapacityAuthority,
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
    // ── AAC WS-9 · EQUIPMENT-DOCUMENT AUTHORITY (renderer purity) ────────────
    // Five renderer files used to call getManufacturerAsset +
    // evaluateDocumentApplicability INSIDE the render pass, each re-deciding an
    // applicability question the snapshot had already decided, each with its own
    // choice of selected model, and every one of them passing `null` for
    // registryFacts — which is exactly why AUTHORITATIVE was unreachable. The
    // determination now happens ONCE, here, with the REAL facts the retrieval
    // resolver established, and the sheets project it.
    equipmentDocumentAuthority: buildEquipmentDocumentAuthority(
      [
        { category: 'module_spec', equipmentId: modules[0]?.catalogId ?? null, selectedModel: modules[0]?.model ?? null },
        {
          category: 'inverter_spec',
          equipmentId: (microInverters[0] ?? stringInverters[0])?.catalogId ?? null,
          selectedModel: (microInverters[0] ?? stringInverters[0])?.model ?? null,
          fallbackCategories: ['microinverter_spec', 'optimizer_spec'],
        },
        {
          category: 'racking_detail',
          equipmentId: (proj.mountingSystemId as string | undefined) ?? null,
          selectedModel: mountDb?.model ?? null,
        },
      ],
      opts?.documentRegistryFacts ?? null,
      null,   // the alias store stays EMPTY: no cross-reference is fabricated.
    ),
    // AAC WS-9 / PRR §1 — the certification record PROJECTS the digest-bound
    // review, in the `false | { reviewedDigest; approvedAtIso }` shape certPages /
    // validate V13 / plansetProfile.certificationIsCompleted / peLetterIdentity
    // already consume. Every one of them re-checks `reviewedDigest === meta.digest`,
    // so a review recorded against a different design still fails closed — which
    // is the whole point of binding an approval to bytes.
    //
    // PASS 1 neutral here; PASS 2 (foot of this function) writes the approved
    // projection once the design digest exists to check the approval against.
    // ONE predicate decides the certification, the release requirement AND the
    // issue state, so validator V33 (stored issue state must equal the derived
    // one) can never be tripped by a partially-accepted review record.
    certification: {
      engineeringReviewApproved: false,
      engineer: null,
    },
    permitReadiness: _permitReadiness,
    // AAC WS-2 / WS-6 — evidence for the AUTO-CLEARED requirements. OMITTED
    // entirely when the lifecycle resolved nothing, so canonicalJson drops it and
    // an unresolved (harness / no-DB) build hashes exactly as before.
    // PRR §1 — `engineeringReview` is deliberately NOT one of the presence tests
    // and is null below: this block is DIGESTED, so letting the approval record
    // decide whether it exists put the approval back inside the design digest
    // (which is exactly how the circularity survived the first repair attempt).
    // PASS 2 attaches the coverage record as evidence, after the digest.
    ...(opts?.canonicalEquipment || opts?.moduleDatasheetBinding || opts?.projectPersonnel
      || opts?.projectLegalAuthority || opts?.codeAdoptionAuthority || opts?.environmentalRetrieval
      || opts?.structuralDocumentRetrieval || opts?.rackingAssemblySelection || opts?.framingRetrieval
      ? {
          resolutionAuthority: {
            canonicalEquipment: opts?.canonicalEquipment ?? null,
            moduleDatasheetBinding: opts?.moduleDatasheetBinding ?? null,
            projectPersonnel: opts?.projectPersonnel ?? null,
            // AAC WS-3 / WS-4 — the retrieved authority records live in the SAME
            // evidence home AAC-2 established, so every auto-cleared requirement
            // has exactly one place a reviewer looks for its proof.
            projectLegalAuthority: opts?.projectLegalAuthority ?? null,
            codeAdoptionAuthority: opts?.codeAdoptionAuthority ?? null,
            environmentalRetrieval: opts?.environmentalRetrieval ?? null,
            // AAC WS-8 / WS-9 — the STRUCTURAL evidence lands in the same home:
            // what was retrieved and hashed, what the rail trace found, why the
            // framing retrieval could not succeed, and who (if anyone) approved
            // this digest. A requirement the lifecycle cleared leaves its proof
            // here; a requirement that legitimately remains leaves its exact
            // reason here too.
            structuralDocumentRetrieval: opts?.structuralDocumentRetrieval ?? null,
            rackingAssemblySelection: opts?.rackingAssemblySelection ?? null,
            framingRetrieval: opts?.framingRetrieval ?? null,
            engineeringReview: null,   // PASS 2 (PRR §1)
          },
        }
      : {}),
  };

  // ═══ THE DESIGN DIGEST ═════════════════════════════════════════════════════
  // Computed over the REVIEW-NEUTRAL snapshot above, so it identifies the DESIGN
  // and not the approval state of the design. For an unapproved package this is
  // byte-identical to the digest this function produced before PRR §1.
  const digest = computeSnapshotDigest(snapshot as unknown as Record<string, unknown>);
  (snapshot.meta as { digest: string }).digest = digest;
  (snapshot.meta as { snapshotId: string }).snapshotId = snapshotIdFromDigest(digest);

  // ═══ PASS 2 — PROJECT THE LICENSED APPROVAL ════════════════════════════════
  // The design digest now exists, so the question an approval answers ("do you
  // accept responsibility for EXACTLY these bytes?") is finally askable. This is
  // the ONLY place that decides it, and the decision is a pure function of the
  // review record + the authority ledger. Nothing here can invent an approval:
  // decideReviewCoverage refuses on a missing, unreadable, unlicensed, unscoped,
  // identity-incomplete, digest-mismatched or ledger-invalidated record, and the
  // engine never writes to the review store.
  {
    const _decision = decideReviewCoverage({
      coverage: _reviewCoverage,
      designDigest: digest,
      // A caller that supplied only the legacy boolean still fails closed: `true`
      // is read as "the ledger says invalidated" (null ⇒ fail closed in
      // invalidationApplies). Absent socket ⇒ no ledger authority in play.
      invalidations: opts?.digestInvalidations !== undefined
        ? opts.digestInvalidations
        : (opts?.digestInvalidatedByLedger ? null : []),
    });

    // The coverage record is EVIDENCE, attached after the digest: what was
    // looked up, who (if anyone) approved, and — when it does not release the
    // package — the exact facts that refused. It sits in the same evidence home
    // every other resolved requirement uses.
    if (_reviewCoverage) {
      const _ra = (snapshot as { resolutionAuthority?: Record<string, unknown> }).resolutionAuthority;
      if (_ra) _ra.engineeringReview = _reviewCoverage;
      else {
        (snapshot as { resolutionAuthority?: Record<string, unknown> }).resolutionAuthority = {
          canonicalEquipment: null, moduleDatasheetBinding: null, projectPersonnel: null,
          projectLegalAuthority: null, codeAdoptionAuthority: null, environmentalRetrieval: null,
          structuralDocumentRetrieval: null, rackingAssemblySelection: null, framingRetrieval: null,
          engineeringReview: _reviewCoverage,
        };
      }
    }

    const _reviewEntry = _permitReadiness.registry.find(r => r.code === 'ENGINEERING-REVIEW-PENDING');
    if (_decision.covers) {
      // The requirement is CLOSED by the record, with the reviewer as evidence.
      if (_reviewEntry) {
        (_reviewEntry as { resolved: boolean }).resolved = true;
        (_reviewEntry as { justification: string }).justification = _decision.basis;
        (_reviewEntry as { explanation: string }).explanation =
          `Approved engineering review covers design digest ${digest.slice(0, 12)}… — ${_decision.basis}`;
      }
      (_permitReadiness as { blockers: { code: string; message: string }[] }).blockers =
        _permitReadiness.blockers.filter(b => b.code !== 'ENGINEERING-REVIEW-PENDING');
      (_permitReadiness as { ready: boolean }).ready = _permitReadiness.blockers.length === 0;
      (snapshot as { certification: PermitDesignSnapshot['certification'] }).certification = {
        engineeringReviewApproved: {
          reviewedDigest: digest,
          approvedAtIso: _reviewCoverage?.approvedAtIso ?? '',
        },
        engineer: {
          name: _reviewCoverage?.reviewerName,
          license: _reviewCoverage?.reviewerLicense,
          state: _reviewCoverage?.reviewerLicenseState,
          role: _reviewCoverage?.reviewerRole,
        } as never,
      };
    } else if (_reviewEntry && _reviewCoverage && !_reviewCoverage.storeUnavailable && _reviewCoverage.covered) {
      // A record EXISTS but does not release this package. Say exactly why —
      // "pending" would hide a stale or invalidated approval from the reviewer.
      (_reviewEntry as { explanation: string }).explanation =
        `Engineering review does not cover this package: ${_decision.basis}`;
    }

    // The issue state, the gate and the cover record are all functions of the
    // decision, so projectAuthority is rebuilt rather than patched — one
    // derivation, no field left disagreeing with another (validator V33).
    (snapshot as { projectAuthority: ProjectAuthorityRecord }).projectAuthority = buildProjectAuthority({
      ..._paArgs,
      // The manifest depends on the registry: resolving the review requirement
      // can drop an RS-1.n continuation sheet, so the stored sheet index must be
      // recomputed or it would disagree with the pages actually rendered.
      sheetIndex: _decision.covers
        ? computePlansetManifest(input, cad, { releaseRegistry: _permitReadiness.registry })
        : _paArgs.sheetIndex,
      blockers: _permitReadiness.blockers,
      review: _decision.covers ? { reviewedDigest: digest } : null,
      currentDigest: digest,
      gateInput: {
        ..._paGateInput,
        blockingValidatorsPass: _permitReadiness.blockers
          .filter(b => classifyBlockerDomain(b.code) !== 'review').length === 0,
        engineerReviewCoversCurrentDigest: _decision.covers,
        signatureSealSatisfied: _decision.signatureSealSatisfied,
        digestInvalidatedByLedger: _decision.invalidatedByLedger,
      },
    });
  }

  return snapshot;
}

export { deepFreeze };
