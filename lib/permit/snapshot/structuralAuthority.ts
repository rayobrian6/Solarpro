// ═══════════════════════════════════════════════════════════════════════════
// W3 — Canonical structural authority orchestrator.
// Builds the snapshot-owned physical objects (module footprints, roof planes +
// setback polygons, rail objects, attachment objects, environmental authority),
// runs the honest structural engine, and returns the permit-readiness blockers
// (§12). Everything is derived from the ENGINE OF RECORD (V4 result stashed on
// input._structuralRuns) + equipment-db dims + the fire-setback engine — never
// from sheet literals (no invented 48" O.C., no generic 66×40, no hardcoded 90).
// ═══════════════════════════════════════════════════════════════════════════
import type {
  ModuleInstance, RoofPlaneObject, RailObject, AttachmentObject, StructuralEnv,
  StructuralCheck, StructuralEngineResult, RackingAssemblyRecord, Polygon2D,
  RoofEdgeClass, EquipmentRecord, ModuleSpec, Provenance,
} from './types';
import type { StructuralResultV4, StructuralInputV4 } from '@/lib/structural-engine-v4';
import type { MountingSystemSpec } from '@/lib/mounting-hardware-db';
import { buildRackingAssembly } from './rackingAssembly';
import { runSnapshotStructuralEngine, type FramingInputs } from './structuralEngine';
import {
  deriveStructuralBom, reconcileStructuralBom,
  type StructuralBomRow, type StructuralBomReconciliation,
} from './structuralBom';
import { contentRevision } from './digest';
import { resolveFireSetbackIn, arrayCoverageFrac } from '../utils/fireSetback';
import { analyzeFenceWind, type FenceWindInput } from '@/lib/structural/fenceWindEngine';

export interface StructuralRunsBundle {
  byKey: Record<string, StructuralResultV4>;
  inputs: Record<string, StructuralInputV4>;
}

export interface StructuralAuthorityCtx {
  isRoofSystem: boolean;
  moduleRecord: EquipmentRecord<ModuleSpec> | null;
  geoModules: {
    moduleId: string; planeKey: string; row: number | null; col: number | null;
    orientation: string | null; lat: number | null; lng: number | null;
  }[];
  microUnits: { deviceId: string; moduleId: string; branchId: string }[];
  roofPlanes: { planeId: string; pitchDeg: number | null; azimuthDeg: number | null; moduleCount: number }[];
  cadPlanes: any[];
  mountSystem: MountingSystemSpec | null;
  structuralRuns: StructuralRunsBundle | null;
  framing: FramingInputs;
  windAuthoritative: boolean; snowAuthoritative: boolean;
  windSpeedMph: number | null; exposure: string | null; snowPsf: number | null;
  riskCategory: string | null;
  meanRoofHeightFt: number | null;
  asceEdition: string; asceSource: 'ahj-record' | 'pending-w4-ahj-authority' | 'default';
  ahjRidgeSetbackIn: number | null;
  roofCovering: string | null;
  /** §6 — fence wind engine input (solar_fence systems only). When present the
   *  fence-overturning check is emitted from the relocated fence engine so
   *  PV-4C / PE-1 / CERT all project ONE acceptance rule. */
  fenceWind: FenceWindInput | null;
}

export interface StructuralAuthorityBundle {
  moduleInstances: ModuleInstance[];
  roofPlaneObjects: RoofPlaneObject[];
  rackingAssembly: RackingAssemblyRecord | null;
  rails: RailObject[];
  attachments: AttachmentObject[];
  env: StructuralEnv;
  checks: StructuralCheck[];
  engine: StructuralEngineResult;
  bom: StructuralBomRow[];
  bomReconciliation: StructuralBomReconciliation;
  blockers: { code: string; message: string }[];
}

const FT_PER_DEG_LAT = 364000; // ≈ ft per degree latitude
const PROV = (note?: string): Provenance => ({ source: 'W3 structural authority', note });

export function buildStructuralAuthority(ctx: StructuralAuthorityCtx): StructuralAuthorityBundle {
  const roofRun = ctx.structuralRuns?.byKey['roof']
    ?? (ctx.structuralRuns ? Object.values(ctx.structuralRuns.byKey)[0] : undefined) ?? null;
  const roofInput = ctx.structuralRuns?.inputs['roof']
    ?? (ctx.structuralRuns ? Object.values(ctx.structuralRuns.inputs)[0] : undefined) ?? null;

  const rackingAssembly = buildRackingAssembly(ctx.mountSystem);
  const framingVerified = !!(ctx.framing.framingType && ctx.framing.rafterSize
    && ctx.framing.rafterSpacing && ctx.framing.rafterSpecies && ctx.framing.rafterSpan);

  const moduleInstances = buildModuleInstances(ctx, framingVerified);
  const roofPlaneObjects = buildRoofPlaneObjects(ctx, framingVerified);
  const { rails, attachments } = buildRailsAndAttachments(ctx, roofRun, roofInput, framingVerified);
  const env = buildEnv(ctx, roofRun);
  // The roof rafter/truss structural engine is roof-scoped (W3). Ground/fence
  // structural remains an ESTIMATE on its own path — do NOT run the roof framing
  // engine on a non-roof run and manufacture a roof-framing review flag.
  const { engine, checks } = ctx.isRoofSystem
    ? runSnapshotStructuralEngine(roofRun, roofInput, ctx.framing)
    : {
        checks: buildFenceChecks(ctx),
        engine: {
          moduleDeadLoadLbs: null, rackingDeadLoadLbs: null, addedDeadLoadPsf: null,
          distributedRoofLoadPsf: null, totalRailLoadLbsPerFt: null,
          governingUtilization: null, governingLimitState: null, passes: null,
          engineeringReviewRequired: false,
          reviewReasons: ['non-roof system — W3 roof structural authority not applicable (ground/fence estimate path owns this)'],
          provenance: PROV('non-roof system'),
        } satisfies StructuralEngineResult,
      };

  // ── §10 structural BOM from the canonical objects (SOLE quantity source) ──
  const bomObjects = {
    rails, attachments, moduleInstances, rackingAssembly,
    mountSelfFlashing: ctx.mountSystem?.mount.selfFlashing ?? null,
    mountAttachmentMethod: ctx.mountSystem?.mount.attachmentMethod ?? null,
  };
  const bom = deriveStructuralBom(bomObjects);
  // The V4 calcRackingBOM result (historical producer) is the reconciliation
  // target: object quantities are authority, and any divergence fails § 10. The
  // cross-check is only valid when the producer covers the SAME panel scope as
  // the objects — on a hybrid the roof run is roof-scoped while the objects span
  // every sub-array, so scope-match is required (else object-internal only).
  const v4RackingBom = (roofRun as unknown as { rackingBOM?: unknown })?.rackingBOM ?? null;
  const v4PanelScope = (roofRun as unknown as { arrayGeometry?: { totalPanels?: number } })?.arrayGeometry?.totalPanels ?? null;
  const scopeMatchesV4 = v4PanelScope != null && v4PanelScope === moduleInstances.length;
  const bomReconciliation = reconcileStructuralBom(bom, bomObjects, v4RackingBom as any, { scopeMatchesV4 });

  const blockers = collectBlockers(ctx, {
    moduleInstances, roofPlaneObjects, rackingAssembly, rails, attachments, engine, checks, bomReconciliation,
  });

  return {
    moduleInstances, roofPlaneObjects, rackingAssembly, rails, attachments, env, checks, engine,
    bom, bomReconciliation, blockers,
  };
}

// ── §2 module instances ────────────────────────────────────────────────────
function buildModuleInstances(ctx: StructuralAuthorityCtx, framingVerified: boolean): ModuleInstance[] {
  const rec = ctx.moduleRecord;
  const widthIn = rec?.spec.widthIn ?? null;
  const heightIn = rec?.spec.lengthIn ?? null;   // catalog LONG dim = module height
  if (!rec || widthIn == null || heightIn == null || widthIn <= 0 || heightIn <= 0) return [];

  const revision = contentRevision({
    catalogId: rec.catalogId, w: widthIn, h: heightIn, t: rec.spec.thicknessIn, watts: rec.spec.wattsStc,
  });
  const areaFt2 = (widthIn * heightIn) / 144;

  // Local projection frame: centroid of placed lat/lng (equirectangular → feet).
  const geo = ctx.geoModules;
  const withLL = geo.filter(g => isFin(g.lat) && isFin(g.lng));
  const useLL = withLL.length === geo.length && geo.length > 0;
  const clat = useLL ? avg(withLL.map(g => g.lat as number)) : 0;
  const clng = useLL ? avg(withLL.map(g => g.lng as number)) : 0;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((clat * Math.PI) / 180);

  const deviceByModule = new Map(ctx.microUnits.map(u => [u.moduleId, u]));

  return geo.map((g, i) => {
    const orientation = normOrient(g.orientation);
    const alongEaveFt = (orientation === 'portrait' ? widthIn : heightIn) / 12;
    const upSlopeFt = (orientation === 'portrait' ? heightIn : widthIn) / 12;
    let cx: number, cy: number, frame: Polygon2D['frame'];
    if (useLL) {
      cx = ((g.lng as number) - clng) * ftPerDegLng;
      cy = ((g.lat as number) - clat) * FT_PER_DEG_LAT;
      frame = 'plan-ft';
    } else {
      cx = (g.col ?? i) * (alongEaveFt + 0.04);
      cy = (g.row ?? 0) * (upSlopeFt + 0.5);
      frame = 'schematic-ft';
    }
    const hw = alongEaveFt / 2, hh = upSlopeFt / 2;
    const polygon: Polygon2D = {
      frame,
      points: [
        { x: r3(cx - hw), y: r3(cy - hh) }, { x: r3(cx + hw), y: r3(cy - hh) },
        { x: r3(cx + hw), y: r3(cy + hh) }, { x: r3(cx - hw), y: r3(cy + hh) },
      ],
    };
    const dev = deviceByModule.get(g.moduleId) ?? null;
    return {
      instanceId: `mi-${g.moduleId}`,
      moduleRecordId: rec.recordId, equipmentCatalogId: rec.catalogId, equipmentRevision: revision,
      widthIn, heightIn, thicknessIn: rec.spec.thicknessIn,
      orientation, roofPlaneId: g.planeKey,
      polygon, areaFt2: r3(areaFt2),
      row: g.row, col: g.col,
      clampZones: (g.col === 0 ? ['end', 'mid'] : ['mid']) as ('mid' | 'end')[],
      mountingEdgeOrientation: 'along-rail',
      electricalDeviceId: dev?.deviceId ?? null, branchId: dev?.branchId ?? null,
      provenance: PROV(useLL
        ? 'footprint = equipment-db exact dims × placed lat/lng (equirectangular local ft)'
        : 'footprint = equipment-db exact dims × row/col placement grid (schematic ft)'),
    };
  });
}

// ── §3 roof plane objects (with canonical fire-setback polygons) ────────────
function buildRoofPlaneObjects(ctx: StructuralAuthorityCtx, framingVerified: boolean): RoofPlaneObject[] {
  const rec = ctx.moduleRecord;
  const panelLenIn = rec?.spec.lengthIn ?? null;
  const panelWidIn = rec?.spec.widthIn ?? null;
  const framingSpacingIn = ctx.framing.rafterSpacing ?? null;

  return ctx.roofPlanes.map(plane => {
    const cad = ctx.cadPlanes.find((p: any) => String(p.id) === plane.planeId) ?? null;
    const proj = projectPlane(cad);
    const pitch = plane.pitchDeg;
    // Canonical fire-setback WIDTH from the shared slope-space engine (never a
    // sheet offset). Coverage uses the plan-projected basis (cos pitch).
    let fireSetbackIn: number | null = null;
    const planAreaFt2 = proj?.areaFt2 ?? null;
    if (panelLenIn != null && panelWidIn != null && planAreaFt2 && planAreaFt2 > 0) {
      const cov = arrayCoverageFrac(plane.moduleCount, panelLenIn, panelWidIn, planAreaFt2, pitch ?? undefined);
      fireSetbackIn = resolveFireSetbackIn(ctx.ahjRidgeSetbackIn, cov);
    }
    const edgeClasses = classifyEdges(cad);
    const fireSetbackPolygons = (proj && fireSetbackIn != null)
      ? setbackBands(proj.pointsFt, edgeClasses, fireSetbackIn / 12) : [];
    return {
      planeId: plane.planeId,
      polygon: proj ? { frame: proj.frame, points: proj.pointsFt } : null,
      pitchDeg: pitch, azimuthDeg: plane.azimuthDeg,
      framingDirection: framingVerified ? 'up-slope' : 'unknown',
      framingSpacingIn, framingVerified,
      covering: ctx.roofCovering,
      edgeClasses,
      fireSetbackIn,
      fireSetbackPolygons,
      pathwayPolygons: [],      // canonical pathway polygons pending true routed geometry (honest)
      obstructionPolygons: [],
      usableAreaPolygons: [],
      confidence: proj ? (framingVerified ? 'high' : 'medium') : 'low',
      provenance: PROV(proj
        ? 'plane polygon from cad.roof.planes; fire setback width from fireSetback engine (slope-space)'
        : 'plane geometry not available on cad.roof.planes — setback width only'),
    };
  });
}

// ── §5/§6 rails + attachments (from the V4 engine-of-record result) ─────────
function buildRailsAndAttachments(
  ctx: StructuralAuthorityCtx, run: StructuralResultV4 | null, input: StructuralInputV4 | null,
  framingVerified: boolean,
): { rails: RailObject[]; attachments: AttachmentObject[] } {
  const sys = ctx.mountSystem;
  const railBased = !!sys && (sys.systemType === 'rail_based' || sys.systemType === 'standing_seam');
  if (!run || !railBased) return { rails: [], attachments: [] };

  const ag = run.arrayGeometry;
  const ml = run.mountLayout;
  const ra = run.railAnalysis;
  const railCount = ag.railCount;
  const railsPerRow = ag.railsPerRow || 2;
  const rowCount = ag.rowCount || Math.max(1, Math.round(railCount / railsPerRow));
  const colCount = ag.colCount || Math.ceil(ctx.geoModules.length / Math.max(1, rowCount));
  const railLenIn = ag.railLengthIn;
  const stockIn = sys?.rail ? sys.rail.spliceIntervalIn : 168; // 14 ft default
  const railsPerRun = Math.max(1, Math.ceil(railLenIn / stockIn));
  const spliceCount = Math.max(0, railsPerRun - 1);
  const spanLimitIn = sys?.rail?.maxSpanIn ?? null;
  const zone = `wind ${round0(ctx.windSpeedMph)}mph / exp ${ctx.exposure ?? '?'} / snow ${round0(ctx.snowPsf)}psf`;

  // module → row buckets (global order chunked by colCount)
  const sorted = [...ctx.geoModules];
  const rowModules: string[][] = Array.from({ length: rowCount }, () => []);
  sorted.forEach((g, i) => {
    const r = g.row != null ? Math.min(rowCount - 1, g.row) : Math.min(rowCount - 1, Math.floor(i / Math.max(1, colCount)));
    rowModules[r].push(g.moduleId);
  });

  const rails: RailObject[] = [];
  const attachments: AttachmentObject[] = [];
  const mountsPerRail = ml.mountsPerRail;
  const spacingFt = ml.mountSpacingIn / 12;
  const substrate = framingVerified
    ? `${input?.framingType === 'truss' ? 'truss' : 'rafter'} ${input?.rafterSize ?? ''}`.trim()
    : 'unverified-framing';

  for (let i = 0; i < railCount; i++) {
    const row = Math.floor(i / railsPerRow);
    const railId = `rail-${i + 1}`;
    const yBase = row * ((ag.railSpacingIn / 12) + 0.5) + (i % railsPerRow) * (ag.railSpacingIn / 24);
    const attIds: string[] = [];
    for (let k = 0; k < mountsPerRail; k++) {
      const attId = `att-${railId}-${k + 1}`;
      attIds.push(attId);
      const sf = ml.safetyFactor;
      attachments.push({
        attachmentId: attId, railId, roofPlaneId: ctx.roofPlanes[Math.min(row, ctx.roofPlanes.length - 1)]?.planeId ?? 'plane-1',
        xy: { x: r3(k * spacingFt), y: r3(yBase) },
        roofZone: run.wind.roofZone ?? null,
        substrateMember: substrate,
        attachmentMethod: sys?.mount.attachmentMethod ?? null,
        fastenerModel: sys?.hardware.lagBolt ?? null,
        fastenerCount: sys?.mount.fastenersPerMount ?? null,
        embedmentIn: sys?.mount.fastenerEmbedmentIn ?? null,
        tributaryAreaFt2: r3(ml.tributaryAreaPerMountFt2),
        upliftReactionLbs: r3(ml.upliftPerMountLbs),
        downwardReactionLbs: r3(ml.downwardPerMountLbs),
        lateralReactionLbs: null,
        allowableCapacityLbs: r3(ml.mountCapacityLbs),
        adjustmentFactors: { omegaUltimateToAllowable: sys?.mount.capacityBasis === 'allowable' ? 1 : 3.0 },
        utilization: sf > 0 ? r3(1 / sf) : null, safetyFactor: r3(sf),
        provenance: PROV('reaction/capacity from structural-engine-v4 calcMountLayout; coordinate from array-geometry grid'),
      });
    }
    rails.push({
      railId, roofPlaneId: ctx.roofPlanes[Math.min(row, ctx.roofPlanes.length - 1)]?.planeId ?? 'plane-1',
      startXY: { x: 0, y: r3(yBase) }, endXY: { x: r3(railLenIn / 12), y: r3(yBase) },
      physicalLengthIn: r3(railLenIn), stockLengthIn: stockIn, spanConfigIn: ml.mountSpacingIn,
      cantileverIn: r3n(ra?.cantileverIn ?? null), spliceCount,
      supportedModuleIds: rowModules[row] ?? [],
      attachmentIds: attIds,
      manufacturerSpanLimitIn: spanLimitIn,
      governingWindSnowZone: zone,
      utilization: r3n(ra?.utilizationRatio ?? null),
      provenance: PROV(sys?.rail
        ? 'rail geometry from array-geometry engine; span limit from mounting-hardware-db rail spec'
        : 'rail geometry from array-geometry engine; COMPATIBLE rail (no span-limit authority on mount record)'),
    });
  }
  return { rails, attachments };
}

// ── §6 fence-overturning check (relocated fence engine → snapshot) ──────────
function buildFenceChecks(ctx: StructuralAuthorityCtx): StructuralCheck[] {
  if (!ctx.fenceWind) return [];
  const r = analyzeFenceWind(ctx.fenceWind);
  // Acceptance basis = provided embedment ÷ required embedment (overturning SF).
  return [{
    checkId: 'chk-fence-overturning',
    limitState: 'fence-overturning',
    demand: r3(r.requiredEmbedmentFt), capacity: r3(r.providedEmbedmentFt),
    dcRatio: r.overturningSafetyFactor > 0 ? r3(1 / r.overturningSafetyFactor) : null,
    safetyFactor: r3(r.overturningSafetyFactor),
    requiredThreshold: r.minOverturningSF, thresholdKind: 'min-safety-factor',
    passes: r.overturningSafetyFactor >= r.minOverturningSF,
    governingSource: 'fenceWindEngine analyzeFenceWind (ASCE 7-22 §29.4 overturning; Broms embedment)',
    provenance: PROV('fence wind/overturning from lib/structural/fenceWindEngine (relocated from PV-4C renderer)'),
  }];
}

// ── §7 environmental authority ──────────────────────────────────────────────
function buildEnv(ctx: StructuralAuthorityCtx, run: StructuralResultV4 | null): StructuralEnv {
  const windSource = ctx.windAuthoritative
    ? 'canonical project/AHJ wind authority'
    : 'code-minimum default (ASCE 7-22 §26.5) — UNVERIFIED, no AHJ wind authority';
  return {
    ultimateWindSpeedMph: ctx.windSpeedMph,
    windSpeedSource: windSource,
    exposureCategory: ctx.exposure,
    riskCategory: ctx.riskCategory,
    groundSnowPsf: ctx.snowPsf,
    roofSnowPsf: run ? r3(run.snow.roofSnowLoadPsf) : null,
    buildingHeightFt: ctx.meanRoofHeightFt,
    componentCladdingZones: run?.wind.roofZone ? [String(run.wind.roofZone)] : [],
    upliftPressurePsf: run ? r3(run.wind.netUpliftPressurePsf) : null,
    downforcePressurePsf: run ? r3(run.wind.netDownwardPressurePsf) : null,
    codeAuthority: { asceEdition: ctx.asceEdition, source: ctx.asceSource },
    provenance: PROV('wind/snow/exposure from canonical site → structural-engine-v4; '
      + 'ASCE edition via code-authority interface (AHJ population = W4)'),
  };
}

// ── §12 blockers ─────────────────────────────────────────────────────────────
function collectBlockers(
  ctx: StructuralAuthorityCtx,
  a: Pick<StructuralAuthorityBundle, 'moduleInstances' | 'roofPlaneObjects' | 'rackingAssembly' | 'rails' | 'attachments' | 'engine' | 'checks' | 'bomReconciliation'>,
): { code: string; message: string }[] {
  const b: { code: string; message: string }[] = [];
  // §10 — a BOM that does not reconcile with the structural objects is a
  // quantity-authority failure regardless of system type.
  if (!a.bomReconciliation.ok) {
    b.push({ code: 'STRUCTURAL-BOM-RECONCILIATION-FAILED',
      message: `Structural BOM quantities do not reconcile with the canonical objects: `
        + a.bomReconciliation.checks.filter(c => !c.ok).map(c => c.name).join(', ') });
  }
  if (!ctx.isRoofSystem) return b;
  const railBased = !!ctx.mountSystem
    && (ctx.mountSystem.systemType === 'rail_based' || ctx.mountSystem.systemType === 'standing_seam');

  if (a.engine.engineeringReviewRequired) {
    b.push({ code: 'STRUCTURAL-FRAMING-UNVERIFIED',
      message: a.engine.reviewReasons[0]
        ?? 'Roof framing authority insufficient — licensed structural review required before permit submission' });
  }
  if (!a.rackingAssembly || a.rackingAssembly.publishedCapacityAllowableLbs == null || a.rackingAssembly.capacitySource == null) {
    b.push({ code: 'ATTACHMENT-CAPACITY-SOURCE-MISSING',
      message: 'No published allowable attachment-capacity source resolved for the racking assembly' });
  }
  if (a.rackingAssembly && (a.rackingAssembly.screwLagModel == null
      || a.rackingAssembly.screwLagQtyPerMount == null || a.rackingAssembly.embedmentRequirementIn == null)) {
    b.push({ code: 'FASTENER-CONFIG-MISSING',
      message: 'Exact fastener configuration (model / count / embedment) incomplete on the racking assembly' });
  }
  if (a.rackingAssembly?.mixedManufacturer && !a.rackingAssembly.assemblySupported) {
    b.push({ code: 'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED',
      message: `Mixed-manufacturer racking assembly without documented compatibility/capacity authority: ${a.rackingAssembly.mountModel}` });
  }
  if (!ctx.windAuthoritative || !ctx.snowAuthoritative) {
    b.push({ code: 'WIND-SNOW-AUTHORITY-UNRESOLVED',
      message: `Wind/snow design authority unresolved (wind ${ctx.windAuthoritative ? 'ok' : 'code-minimum default'}, `
        + `snow ${ctx.snowAuthoritative ? 'ok' : 'unverified'}) — AHJ-confirmed values required` });
  }
  if (a.moduleInstances.length > 0 && a.attachments.length === 0) {
    b.push({ code: 'REACTIONS-UNTRACEABLE',
      message: 'Module instances present but no canonical attachment objects — reactions not traceable' });
  }
  if (railBased && a.rails.length === 0) {
    b.push({ code: 'RAIL-QUANTITY-UNTRACEABLE',
      message: 'Rail-based assembly but no canonical rail objects — BOM rail quantities not traceable' });
  }
  if (a.checks.some(c => c.passes === false)) {
    b.push({ code: 'STRUCTURAL-UTILIZATION-EXCEEDED',
      message: `Structural check failed: ${a.checks.filter(c => c.passes === false).map(c => c.limitState).join(', ')}` });
  }
  if (a.roofPlaneObjects.length === 0) {
    b.push({ code: 'SITE-GEOMETRY-MISSING', message: 'No canonical roof-plane geometry available' });
  }
  if (a.moduleInstances.length === 0 && (!ctx.moduleRecord
      || ctx.moduleRecord.spec.lengthIn == null || ctx.moduleRecord.spec.widthIn == null)) {
    b.push({ code: 'MODULE-DIMENSIONS-UNVERIFIED',
      message: 'Selected module record lacks exact catalog dimensions — module footprints cannot be built (no generic size permitted)' });
  }
  return b;
}

// ── geometry helpers ─────────────────────────────────────────────────────────
function projectPlane(cad: any): { pointsFt: { x: number; y: number }[]; areaFt2: number; frame: Polygon2D['frame'] } | null {
  if (!cad) return null;
  // polygon in local meters
  const poly = cad.polygon ?? cad.vertices ?? null;
  if (!Array.isArray(poly) || poly.length < 3) return null;
  let ptsFt: { x: number; y: number }[];
  let frame: Polygon2D['frame'];
  if (isFin(poly[0]?.lat) && isFin(poly[0]?.lng)) {
    const clat = avg(poly.map((p: any) => p.lat)), clng = avg(poly.map((p: any) => p.lng));
    const fLng = FT_PER_DEG_LAT * Math.cos((clat * Math.PI) / 180);
    ptsFt = poly.map((p: any) => ({ x: r3((p.lng - clng) * fLng), y: r3((p.lat - clat) * FT_PER_DEG_LAT) }));
    frame = 'plan-ft';
  } else if (isFin(poly[0]?.x) && isFin(poly[0]?.y)) {
    ptsFt = poly.map((p: any) => ({ x: r3(p.x * 3.28084), y: r3(p.y * 3.28084) }));
    frame = 'plan-ft';
  } else return null;
  return { pointsFt: ptsFt, areaFt2: Math.abs(shoelace(ptsFt)), frame };
}

function classifyEdges(cad: any): { edgeIndex: number; class: RoofEdgeClass }[] {
  const types: string[] = cad?.edgeTypes ?? cad?.edgeClasses ?? [];
  if (!Array.isArray(types) || !types.length) return [];
  return types.map((t, i) => ({ edgeIndex: i, class: normEdge(t) }));
}

/** Setback band = inward-offset strip adjacent to each ridge/hip edge. */
function setbackBands(
  ptsFt: { x: number; y: number }[], edges: { edgeIndex: number; class: RoofEdgeClass }[], dFt: number,
): Polygon2D[] {
  if (dFt <= 0 || ptsFt.length < 3) return [];
  const cx = avg(ptsFt.map(p => p.x)), cy = avg(ptsFt.map(p => p.y));
  const bands: Polygon2D[] = [];
  for (const e of edges) {
    if (e.class !== 'ridge' && e.class !== 'hip') continue;
    const a = ptsFt[e.edgeIndex], bpt = ptsFt[(e.edgeIndex + 1) % ptsFt.length];
    if (!a || !bpt) continue;
    const ex = bpt.x - a.x, ey = bpt.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // unit normal candidates; pick the one pointing toward the centroid (inward)
    let nx = -ey / len, ny = ex / len;
    const mx = (a.x + bpt.x) / 2, my = (a.y + bpt.y) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }
    bands.push({
      frame: 'plan-ft',
      points: [
        { x: r3(a.x), y: r3(a.y) }, { x: r3(bpt.x), y: r3(bpt.y) },
        { x: r3(bpt.x + nx * dFt), y: r3(bpt.y + ny * dFt) }, { x: r3(a.x + nx * dFt), y: r3(a.y + ny * dFt) },
      ],
    });
  }
  return bands;
}

function shoelace(pts: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return s / 2;
}

function normEdge(t: string): RoofEdgeClass {
  const s = String(t).toLowerCase();
  if (s.includes('eave')) return 'eave';
  if (s.includes('ridge')) return 'ridge';
  if (s.includes('hip')) return 'hip';
  if (s.includes('valley')) return 'valley';
  if (s.includes('rake') || s.includes('gable')) return 'rake';
  return 'unknown';
}
function normOrient(o: string | null): 'portrait' | 'landscape' | null {
  const s = String(o ?? '').toLowerCase();
  return s === 'portrait' || s === 'landscape' ? s : null;
}
const isFin = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
const avg = (a: number[]): number => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r3n = (n: number | null | undefined): number | null =>
  (n == null || !isFinite(n)) ? null : Math.round(n * 1000) / 1000;
const round0 = (n: number | null | undefined): string => n == null ? '?' : String(Math.round(n));
