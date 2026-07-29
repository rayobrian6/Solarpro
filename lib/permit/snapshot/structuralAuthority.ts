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
  RoofEdgeClass, EquipmentRecord, ModuleSpec, Provenance, DrawingTransform, CoordinateMeta,
  FramingObservation, FramingCapacityAuthority,
} from './types';
import {
  buildFramingObservation, resolveFramingCapacityAuthority,
  type FramingCapacityDocumentEvidence, type FramingEngineerReviewEvidence,
} from './framingAuthority';
import {
  buildEnvironmentalLoadAuthority, type EnvironmentalLoadSourceEvidence,
} from './environmentalAuthority';
import type { StructuralResultV4, StructuralInputV4 } from '@/lib/structural-engine-v4';
import type { MountingSystemSpec } from '@/lib/mounting-hardware-db';
import { classifyMountTopology } from '@/lib/mounting-hardware-db';
import { buildDrawingTransform, coordMetaFor, dominantAxisDeg } from './coordinateAuthority';
import { buildRackingAssembly, type RackingCapacityDocumentEvidence } from './rackingAssembly';
import { getManufacturerAsset, evaluateDocumentApplicability, type DocumentRegistryFacts } from '@/lib/manufacturer-assets-db';
import {
  runSnapshotStructuralEngine, reconcileReactions, type FramingInputs,
  type StructuralReactionReconciliation,
} from './structuralEngine';
import {
  deriveStructuralBom, reconcileStructuralBom,
  type StructuralBomRow, type StructuralBomReconciliation,
} from './structuralBom';
import { contentRevision } from './digest';
import { resolveFastenerVerification, type FastenerVerificationResult } from './structuralProjection';
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
  /** §2 (BAR) — a wind/snow VALUE is present (operator-entered or default). This
   *  is NOT authority: presence never verifies. The blocker fires from the
   *  ENVIRONMENTAL LOAD AUTHORITY verification state, not from these flags. */
  windValuePresent: boolean; snowValuePresent: boolean;
  windSpeedMph: number | null; exposure: string | null; snowPsf: number | null;
  riskCategory: string | null;
  /** §2 (BAR) — async-resolved VERIFIED climate-hazard source (lib/documents) for
   *  the project. null ⇒ no archived source ⇒ operator-entered values stay
   *  UNVERIFIED ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED fires (the honest live
   *  outcome). */
  environmentalSource?: EnvironmentalLoadSourceEvidence | null;
  /** AAC WS-4 — the RETRIEVAL record behind that source (query inputs, returned
   *  values, override history, archival state). Null for an archived-document
   *  source or an unresolved run ⇒ the authority record is unchanged. */
  environmentalRetrieval?: import('./resolution/environmentalRetrieval').EnvironmentalRetrievalRecord | null;
  /** §2 (BAR) — the location basis the wind/snow values were (or should be) looked
   *  up against, printed with the values so no reader treats an operator entry as
   *  a resolved lookup. */
  environmentalCoordinates?: { lat: number | null; lng: number | null } | null;
  environmentalAddressUsed?: string | null;
  environmentalCapturedAtIso?: string | null;
  meanRoofHeightFt: number | null;
  asceEdition: string; asceSource: 'ahj-record' | 'pending-w4-ahj-authority' | 'default';
  ahjRidgeSetbackIn: number | null;
  roofCovering: string | null;
  /** §6 — fence wind engine input (solar_fence systems only). When present the
   *  fence-overturning check is emitted from the relocated fence engine so
   *  PV-4C / PE-1 / CERT all project ONE acceptance rule. */
  fenceWind: FenceWindInput | null;
  /** §9 (W4 closer) — the async-resolved VERIFIED racking-capacity document for
   *  the selected mount (lib/documents). null ⇒ none archived / DB unavailable ⇒
   *  RT-MINI blockers stay firing (fail-soft). */
  capacityDocument?: RackingCapacityDocumentEvidence | null;
  projectJurisdiction?: string | null;
  /** FRAMING-AUTHORITY GATE — the resolved evidence for the framing CAPACITY
   *  authority. The document path is resolved async THROUGH lib/documents (a
   *  verified + archived truss-drawing / manufacturer-calc / stamped-analysis
   *  covering the exact project); the engineer-review path is a licensed review
   *  bound to the current snapshot digest. null on both ⇒ capacity UNVERIFIED ⇒
   *  FRAMING-AUTHORITY-UNVERIFIED fires (the honest Braidon outcome). */
  framingCapacityDocument?: FramingCapacityDocumentEvidence | null;
  framingEngineerReview?: FramingEngineerReviewEvidence | null;
  /** the current snapshot digest — validates the engineer-review binding. Absent
   *  at pure build (circular) ⇒ the review path stays unverified there. */
  framingReviewDigest?: string | null;
  /** the exact project/building applicability key the framing document must cover. */
  framingProjectApplicabilityKey?: string | null;
  /** AAC WS-8 (audit §7.7) — REAL registry facts (archived / sha256 / status)
   *  keyed `${category}:${equipmentId}`, resolved by racking-documents@v1.
   *  Every prior call site passed `null` here, which made the AUTHORITATIVE
   *  document verdict structurally unreachable. Absent ⇒ unchanged behaviour. */
  documentRegistryFacts?: Record<string, DocumentRegistryFacts> | null;
  /** AAC WS-8 — the rail-selection trace. Present ⇒ PENDING-RACKING-ASSEMBLY-
   *  SELECTION is decided from it (a real design fact) rather than from the
   *  capacity-document echo it used to duplicate. */
  rackingAssemblySelection?: import('./resolution/railSelection').RailSelectionVerdict | null;
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
  framingObservation: FramingObservation | null;
  framingCapacityAuthority: FramingCapacityAuthority | null;
  bom: StructuralBomRow[];
  bomReconciliation: StructuralBomReconciliation;
  reactionReconciliation: StructuralReactionReconciliation;   // §8 attachment-reaction closure
  drawingTransforms: DrawingTransform[];   // §2 canonical→sheet transform authority
  blockers: { code: string; message: string }[];
}

const FT_PER_DEG_LAT = 364000; // ≈ ft per degree latitude
const PROV = (note?: string): Provenance => ({ source: 'W3 structural authority', note });

/**
 * TAC WS-4 — the ONE fastener verdict, reachable from both the blocker emission
 * and the BOM classification (they live in different scopes, so the predicate is
 * shared as a function rather than a variable). Delegates to
 * resolveFastenerVerification; this wrapper only supplies the document-
 * applicability fact for the SELECTED mount.
 */
function fastenerVerdictFor(
  ra: {
    fastenerElementsComplete?: boolean;
    screwLagModel?: string | null;
    screwLagQtyPerMount?: number | null;
    embedmentRequirementIn?: number | null;
    datasheetSource?: string | null;
    capacitySource?: string | null;
  } | null | undefined,
  ctx: StructuralAuthorityCtx,
): FastenerVerificationResult {
  if (!ra) {
    return { verified: false, sourceDocument: null, reason: 'no canonical racking assembly is recorded' };
  }
  const docApplicable = (() => {
    if (!ctx.mountSystem) return false;
    const asset = getManufacturerAsset(ctx.mountSystem.id, 'racking_detail');
    const facts = ctx.documentRegistryFacts?.[`racking_detail:${ctx.mountSystem.id}`] ?? null;
    return evaluateDocumentApplicability(ctx.mountSystem.model, asset, null, facts).applicabilityVerified === true;
  })();
  return resolveFastenerVerification({
    elementsComplete: ra.fastenerElementsComplete
      ?? !!(ra.screwLagModel && ra.screwLagQtyPerMount != null && ra.embedmentRequirementIn != null),
    citedSourceDocument: ra.datasheetSource ?? ra.capacitySource ?? null,
    documentApplicabilityVerified: docApplicable,
  });
}

export function buildStructuralAuthority(ctx: StructuralAuthorityCtx): StructuralAuthorityBundle {
  const roofRun = ctx.structuralRuns?.byKey['roof']
    ?? (ctx.structuralRuns ? Object.values(ctx.structuralRuns.byKey)[0] : undefined) ?? null;
  const roofInput = ctx.structuralRuns?.inputs['roof']
    ?? (ctx.structuralRuns ? Object.values(ctx.structuralRuns.inputs)[0] : undefined) ?? null;

  const rackingAssembly = buildRackingAssembly(ctx.mountSystem, {
    capacityDocument: ctx.capacityDocument ?? null,
    projectJurisdiction: ctx.projectJurisdiction ?? null,
  });
  // FRAMING-AUTHORITY GATE — the OBSERVED framing record + the verified CAPACITY
  // authority (or null). framingVerified is now driven by the CAPACITY AUTHORITY,
  // NEVER by operator-field completeness (Ray's ruling). Operator geometry rides
  // as OBSERVATION + preliminary modeling only.
  const framingObservation = buildFramingObservation({
    source: 'operator-entered',
    framingType: ctx.framing.framingType ?? null,
    rafterSize: ctx.framing.rafterSize ?? null,
    rafterSpacing: ctx.framing.rafterSpacing ?? null,
    rafterSpecies: ctx.framing.rafterSpecies ?? null,
    rafterSpan: ctx.framing.rafterSpan ?? null,
    roofCovering: ctx.roofCovering ?? null,
  });
  const framingCapacityAuthority = resolveFramingCapacityAuthority({
    documentEvidence: ctx.framingCapacityDocument ?? null,
    reviewEvidence: ctx.framingEngineerReview ?? null,
    currentDigest: ctx.framingReviewDigest ?? null,
    projectApplicabilityKey: ctx.framingProjectApplicabilityKey ?? null,
  });
  const framingVerified = !!(framingCapacityAuthority && framingCapacityAuthority.verified === true);

  // §2 — the canonical→sheet transform AUTHORITY. The snapshot OWNS the plan
  // rotation (the "squaring" geo-registration): DT-SITE is a plan-rotation whose
  // angle is the array's principal axis (PCA of the canonical module centroids)
  // and whose pivot is the array centroid — computed at BUILD time, with a
  // content digest. The renderer applies DT-SITE, then only a viewport
  // (scale/paper/flip); it does NOT compute rotation itself. Rails, attachments,
  // splices and module footprints are drawn as viewport∘DT-SITE(canonical).
  const planPts = modulePlanCentroids(ctx);
  const rotDeg = planPts.length >= 2 ? r6(-dominantAxisDeg(planPts)) : 0;
  const pivot = planPts.length
    ? { x: r6(avg(planPts.map(p => p.x))), y: r6(avg(planPts.map(p => p.y))) }
    : { x: 0, y: 0 };
  const siteTransform = buildDrawingTransform({
    transformId: 'DT-SITE', scope: 'site',
    kind: rotDeg !== 0 ? 'plan-rotation' : 'identity', rotationDeg: rotDeg, pivot,
    provenanceNote: rotDeg !== 0
      ? 'plan-rotation squares the array to the sheet (PCA of canonical module centroids about the array centroid) — snapshot-owned geo-registration'
      : 'no plan rotation resolvable from module geometry (identity)',
  });
  const planeTransforms = new Map<string, DrawingTransform>();
  for (const p of ctx.roofPlanes) {
    planeTransforms.set(p.planeId, siteTransform);  // planes register with the site transform
  }
  const drawingTransforms = [siteTransform];

  const moduleInstances = buildModuleInstances(ctx, framingVerified, siteTransform);
  const roofPlaneObjects = buildRoofPlaneObjects(ctx, framingVerified, planeTransforms, siteTransform);
  const { rails, attachments } = buildRailsAndAttachments(ctx, roofRun, roofInput, framingVerified, moduleInstances, siteTransform);
  const env = buildEnv(ctx, roofRun);
  // The roof rafter/truss structural engine is roof-scoped (W3). Ground/fence
  // structural remains an ESTIMATE on its own path — do NOT run the roof framing
  // engine on a non-roof run and manufacture a roof-framing review flag.
  const { engine, checks } = ctx.isRoofSystem
    ? runSnapshotStructuralEngine(roofRun, roofInput, ctx.framing, framingCapacityAuthority)
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
    // TAC WS-4 — the ONE fastener verdict; the BOM classifier no longer
    // re-derives it (that third predicate is what let an unverified assembly
    // produce an orderable fastener row).
    fastenerVerified: fastenerVerdictFor(rackingAssembly, ctx).verified,
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

  // §8 — reconcile the canonical attachment reactions back to the applied load.
  // The reaction-model count is the engine's calcMountLayout mountCount (what the
  // per-attachment reaction was computed against); addedDeadLoadPsf is the engine
  // gravity basis. Only meaningful on a roof system with attachment objects.
  const engineMountCount = (roofRun as unknown as { mountLayout?: { mountCount?: number } })?.mountLayout?.mountCount ?? null;
  const addedDeadPsf = engine.addedDeadLoadPsf
    ?? ((roofRun as unknown as { addedDeadLoadPsf?: number })?.addedDeadLoadPsf ?? null);
  // §8 — array area SCOPED to the modules the attachments actually support (union
  // of rail supportedModuleIds + direct-mount supportedModuleId), so a hybrid
  // roof run (roof-scoped attachments) reconciles against the roof modules, not
  // the whole multi-sub-array footprint. Falls back to all instances when no
  // supported-module relation is carried (single-system).
  const areaByRawId = new Map<string, number>();
  for (const mi of moduleInstances) areaByRawId.set(mi.instanceId.replace(/^mi-/, ''), mi.areaFt2 ?? 0);
  const supportedRaw = new Set<string>();
  for (const r of rails) for (const id of r.supportedModuleIds) supportedRaw.add(id);
  for (const at of attachments) if (at.supportedModuleId) supportedRaw.add(at.supportedModuleId.replace(/^mi-/, ''));
  const scopedArea = supportedRaw.size
    ? [...supportedRaw].reduce((s, id) => s + (areaByRawId.get(id) ?? 0), 0)
    : moduleInstances.reduce((s, m) => s + (m.areaFt2 ?? 0), 0);
  const reactionReconciliation = ctx.isRoofSystem
    ? reconcileReactions(attachments, scopedArea, env, engineMountCount, addedDeadPsf, scopeMatchesV4)
    : reconcileReactions([], 0, env, engineMountCount, addedDeadPsf, scopeMatchesV4);

  const blockers = collectBlockers(ctx, {
    moduleInstances, roofPlaneObjects, rackingAssembly, rails, attachments, engine, checks, bomReconciliation,
    reactionReconciliation, env,
  });

  return {
    moduleInstances, roofPlaneObjects, rackingAssembly, rails, attachments, env, checks, engine,
    framingObservation, framingCapacityAuthority,
    bom, bomReconciliation, reactionReconciliation, drawingTransforms, blockers,
  };
}

// ── §2 module instances ────────────────────────────────────────────────────
function buildModuleInstances(ctx: StructuralAuthorityCtx, framingVerified: boolean, transform: DrawingTransform): ModuleInstance[] {
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
  const planeMap = new Map(ctx.roofPlanes.map(p => [p.planeId, p]));

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
    // RAW footprint: axis-aligned rectangle at the raw centroid (PHYSICAL truth → V21/area).
    const polygon: Polygon2D = {
      frame,
      points: [
        { x: r3(cx - hw), y: r3(cy - hh) }, { x: r3(cx + hw), y: r3(cy - hh) },
        { x: r3(cx + hw), y: r3(cy + hh) }, { x: r3(cx - hw), y: r3(cy + hh) },
      ],
    };
    // §2 DRAWN footprint (display linework straightening, moved OUT of the
    // renderer): SAME raw centroid, but the rectangle oriented to the plane
    // azimuth and foreshortened up-slope by cos(pitch). NO position change.
    const plane = planeMap.get(g.planeKey);
    const azDeg = plane?.azimuthDeg ?? 180;
    const pitchDeg = plane?.pitchDeg ?? null;
    const cosP = (pitchDeg != null && pitchDeg > 0 && pitchDeg < 89) ? Math.cos((pitchDeg * Math.PI) / 180) : 1;
    const th = (azDeg * Math.PI) / 180;
    const uHalf = (upSlopeFt * cosP) / 2;                                   // foreshortened up-slope
    const u = { x: Math.sin(th) * uHalf, y: Math.cos(th) * uHalf };         // fall-line axis
    const v = { x: Math.cos(th) * (alongEaveFt / 2), y: -Math.sin(th) * (alongEaveFt / 2) }; // along-eave axis
    const drawnPolygon: Polygon2D = {
      frame,
      points: [
        { x: r3(cx - u.x - v.x), y: r3(cy - u.y - v.y) },
        { x: r3(cx + u.x - v.x), y: r3(cy + u.y - v.y) },
        { x: r3(cx + u.x + v.x), y: r3(cy + u.y + v.y) },
        { x: r3(cx - u.x + v.x), y: r3(cy - u.y + v.y) },
      ],
    };
    const dev = deviceByModule.get(g.moduleId) ?? null;
    return {
      instanceId: `mi-${g.moduleId}`,
      moduleRecordId: rec.recordId, equipmentCatalogId: rec.catalogId, equipmentRevision: revision,
      widthIn, heightIn, thicknessIn: rec.spec.thicknessIn,
      orientation, roofPlaneId: g.planeKey,
      polygon, drawnPolygon, areaFt2: r3(areaFt2),
      row: g.row, col: g.col,
      clampZones: (g.col === 0 ? ['end', 'mid'] : ['mid']) as ('mid' | 'end')[],
      mountingEdgeOrientation: 'along-rail',
      electricalDeviceId: dev?.deviceId ?? null, branchId: dev?.branchId ?? null,
      coord: coordMetaFor(transform, frame, useLL ? 'footprint centroid in canonical site-plan-ft' : 'footprint centroid in schematic-ft'),
      provenance: PROV(useLL
        ? 'footprint = equipment-db exact dims × placed lat/lng (equirectangular local ft); drawnPolygon = azimuth-oriented + cos(pitch) foreshortened (display linework)'
        : 'footprint = equipment-db exact dims × row/col placement grid (schematic ft)'),
    };
  });
}

// ── §3 roof plane objects (with canonical fire-setback polygons) ────────────
function buildRoofPlaneObjects(
  ctx: StructuralAuthorityCtx, framingVerified: boolean,
  planeTransforms: Map<string, DrawingTransform>, siteTransform: DrawingTransform,
): RoofPlaneObject[] {
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
    const planeTransform = planeTransforms.get(plane.planeId) ?? siteTransform;
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
      coord: coordMetaFor(planeTransform, proj?.frame ?? 'plan-ft', 'plane + setback polygons in canonical site-plan-ft'),
      provenance: PROV(proj
        ? 'plane polygon from cad.roof.planes; fire setback width from fireSetback engine (slope-space)'
        : 'plane geometry not available on cad.roof.planes — setback width only'),
    };
  });
}

// ── §5/§6 rails + attachments (from the V4 engine-of-record result) ─────────
// §2 (W3.1): rails + attachments are placed in the SAME canonical site-plan-ft
// frame as the module footprints (co-located from the module centroids), NOT an
// abstract V4 grid — the pre-W3.1 frame split is eliminated. Rail LENGTHS /
// COUNTS / SPLICES stay engine-of-record (V4); only the coordinate FRAME is
// unified so every physical object shares one coordinate system.
function buildRailsAndAttachments(
  ctx: StructuralAuthorityCtx, run: StructuralResultV4 | null, input: StructuralInputV4 | null,
  framingVerified: boolean, moduleInstances: ModuleInstance[], transform: DrawingTransform,
): { rails: RailObject[]; attachments: AttachmentObject[] } {
  const sys = ctx.mountSystem;
  // W4.1 §1/§2 — the rail-paired vs rail-less decision is GUARDED ON THE MOUNTING
  // TOPOLOGY VALUE (classifyMountTopology), never on the systemType/product name.
  const topology = sys ? classifyMountTopology(sys).topology : null;
  const railBased = !!sys && (sys.systemType === 'rail_based' || sys.systemType === 'standing_seam'
    || sys.mountTopology === 'rail_paired');
  // §10 — genuine RAIL-LESS / DIRECT-MOUNT roof products (topology === 'rail_less',
  // the corrected authority): each module is fastened DIRECTLY to the roof at per-
  // module mount points (the module frame is the load path — there is NO rail). We
  // derive canonical attachment objects + CS-SITE-PLAN-FT coordinates from the
  // module footprints × the product's attachment pattern. railObjects stay EMPTY
  // (no phantom rails); the module→attachment relation is carried on each
  // attachment (`supportedModuleId`). RT-MINI-class rail-PAIRED mounts and
  // topology-'unknown' mounts NEVER come here — the guard is the topology VALUE,
  // so a mislabeled 'rail_less' systemType (unverified RT-MINI alias → 'unknown')
  // cannot enter this path (W4.1 §2, Ray directive).
  const directMount = !!sys && topology === 'rail_less' && ctx.isRoofSystem;
  if (run && directMount) {
    const dmAttachments = buildDirectMountAttachments(ctx, run, input, framingVerified, moduleInstances, transform);
    // W4 closer — back-fill the module→attachment relation onto each supported
    // ModuleInstance (there is no rail carrying it for direct-mount). Only
    // populated here (direct-mount); rail-based modules keep attachmentIds
    // undefined so their serialization/digest is unchanged.
    const byModule = new Map<string, string[]>();
    for (const at of dmAttachments) {
      if (!at.supportedModuleId) continue;
      const arr = byModule.get(at.supportedModuleId) ?? [];
      arr.push(at.attachmentId);
      byModule.set(at.supportedModuleId, arr);
    }
    for (const mi of moduleInstances) {
      const ids = byModule.get(mi.instanceId);
      if (ids && ids.length) mi.attachmentIds = ids;
    }
    return { rails: [], attachments: dmAttachments };
  }
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

  // module → row buckets (global order chunked by colCount).
  // Explicit design-tool row indices are honored ONLY when they exactly cover the
  // engine's rail-grid rows (0..rowCount-1). On a MULTI-PLANE array (front/back
  // gable: two planes at opposing azimuths) the explicit rows collapse to 0..1
  // while V4's single-array grid has more rows — honoring them left the upper
  // engine rows empty, producing phantom rails with zero supported modules (V22).
  // When the explicit rows don't fill the grid, fall back to positional bucketing
  // (global order ÷ colCount), which populates every engine row so no rail is
  // module-less. Rectangular single-plane arrays (rows cover the grid) are
  // unchanged.
  const sorted = [...ctx.geoModules];
  const rowModules: string[][] = Array.from({ length: rowCount }, () => []);
  const explicitRows = sorted.length > 0 && sorted.every(g => g.row != null);
  const distinctRows = new Set(sorted.map(g => g.row));
  const rowsCoverGrid = explicitRows && distinctRows.size === rowCount
    && Math.max(...[...distinctRows].map(Number)) === rowCount - 1;
  sorted.forEach((g, i) => {
    const r = rowsCoverGrid
      ? Math.min(rowCount - 1, g.row as number)
      : Math.min(rowCount - 1, Math.floor(i / Math.max(1, colCount)));
    rowModules[r].push(g.moduleId);
  });

  // §2 — module centroids in the CANONICAL frame (unified coordinate source).
  const centroidByModule = new Map<string, { x: number; y: number }>();
  let anyLL = false;
  for (const mi of moduleInstances) {
    const pts = mi.polygon.points;
    if (!pts.length) continue;
    centroidByModule.set(mi.instanceId.replace(/^mi-/, ''), {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    });
    if (mi.polygon.frame === 'plan-ft') anyLL = true;
  }
  const coordFrame: CoordinateMeta['sourceFrame'] = anyLL ? 'plan-ft' : 'schematic-ft';

  const rails: RailObject[] = [];
  const attachments: AttachmentObject[] = [];
  const mountsPerRail = ml.mountsPerRail;
  const spacingFt = ml.mountSpacingIn / 12;
  const railSpacingFt = ag.railSpacingIn / 12;
  const halfLenFt = railLenIn / 24;
  const substrate = framingVerified
    ? `${input?.framingType === 'truss' ? 'truss' : 'rafter'} ${input?.rafterSize ?? ''}`.trim()
    : 'unverified-framing';

  // §8 — gravity reactions per mount = applied gravity psf × the SAME per-mount
  // tributary the engine used for uplift, so all reaction rows share one basis
  // and sum back to applied load × array area. Uniform across mounts.
  const tribPerMount = ml.tributaryAreaPerMountFt2;
  const snowPerMount = run.snow?.roofSnowLoadPsf != null ? run.snow.roofSnowLoadPsf * tribPerMount : null;
  const deadPerMount = run.addedDeadLoadPsf != null ? run.addedDeadLoadPsf * tribPerMount : null;
  const downPerMount = (snowPerMount ?? 0) + (deadPerMount ?? 0);

  for (let i = 0; i < railCount; i++) {
    const row = Math.floor(i / railsPerRow);
    const idxInRow = i % railsPerRow;
    const railId = `rail-${i + 1}`;
    // Row geometry in the canonical frame from the supported modules' centroids.
    const rowCentroids = (rowModules[row] ?? []).map(id => centroidByModule.get(id)).filter(Boolean) as { x: number; y: number }[];
    // along-axis (u) = direction of greatest spread of the row; n = perpendicular.
    let u = { x: 1, y: 0 }, center = { x: 0, y: 0 };
    if (rowCentroids.length) {
      center = { x: avg(rowCentroids.map(p => p.x)), y: avg(rowCentroids.map(p => p.y)) };
      const spanX = Math.max(...rowCentroids.map(p => p.x)) - Math.min(...rowCentroids.map(p => p.x));
      const spanY = Math.max(...rowCentroids.map(p => p.y)) - Math.min(...rowCentroids.map(p => p.y));
      u = spanY > spanX ? { x: 0, y: 1 } : { x: 1, y: 0 };
    } else {
      // schematic fallback keeps the SAME frame (no separate grid space)
      center = { x: halfLenFt, y: row * (railSpacingFt + 0.5) };
    }
    const n = { x: -u.y, y: u.x };
    const nOff = (idxInRow - (railsPerRow - 1) / 2) * railSpacingFt;
    const cx = center.x + n.x * nOff, cy = center.y + n.y * nOff;
    const startXY = { x: r3(cx - u.x * halfLenFt), y: r3(cy - u.y * halfLenFt) };
    const endXY   = { x: r3(cx + u.x * halfLenFt), y: r3(cy + u.y * halfLenFt) };

    const attIds: string[] = [];
    for (let k = 0; k < mountsPerRail; k++) {
      const attId = `att-${railId}-${k + 1}`;
      attIds.push(attId);
      const sf = ml.safetyFactor;
      // attachment along the rail at the engine-resolved O.C. spacing, centered.
      const offAlong = mountsPerRail > 1
        ? (k - (mountsPerRail - 1) / 2) * spacingFt
        : 0;
      const ax = cx + u.x * offAlong, ay = cy + u.y * offAlong;
      attachments.push({
        attachmentId: attId, railId, roofPlaneId: ctx.roofPlanes[Math.min(row, ctx.roofPlanes.length - 1)]?.planeId ?? 'plane-1',
        xy: { x: r3(ax), y: r3(ay) },
        roofZone: run.wind.roofZone ?? null,
        substrateMember: substrate,
        attachmentMethod: sys?.mount.attachmentMethod ?? null,
        fastenerModel: sys?.hardware.lagBolt ?? null,
        fastenerCount: sys?.mount.fastenersPerMount ?? null,
        embedmentIn: sys?.mount.fastenerEmbedmentIn ?? null,
        tributaryAreaFt2: r3(ml.tributaryAreaPerMountFt2),
        upliftReactionLbs: r3(ml.upliftPerMountLbs),
        downwardReactionLbs: r3(downPerMount),
        deadReactionLbs: r3n(deadPerMount),
        snowReactionLbs: r3n(snowPerMount),
        lateralReactionLbs: null,
        allowableCapacityLbs: r3(ml.mountCapacityLbs),
        adjustmentFactors: { omegaUltimateToAllowable: sys?.mount.capacityBasis === 'allowable' ? 1 : 3.0 },
        utilization: sf > 0 ? r3(1 / sf) : null, safetyFactor: r3(sf),
        // W7 artifact — zone pressure basis + design method + honest model label.
        zonePressurePsf: r3n(run.wind.netUpliftPressurePsf ?? null),
        loadBasis: 'ASD',
        zoneModel: 'CONSERVATIVE SCREENING ENVELOPE — governing corner (Zone 3) C&C pressure + full interior tributary applied uniformly (not an exact per-position classification)',
        coord: coordMetaFor(transform, coordFrame, 'attachment coordinate in canonical site-plan-ft (co-located from module centroids)'),
        provenance: PROV('reaction/capacity from structural-engine-v4 calcMountLayout; coordinate co-located in canonical site-plan-ft'),
      });
    }
    // §2 — canonical splice-marker coordinates at each stock-section boundary.
    const splicePointsXY: { x: number; y: number }[] = [];
    for (let sIdx = 1; sIdx <= spliceCount; sIdx++) {
      const t = (sIdx * stockIn) / railLenIn;   // fraction along start→end
      splicePointsXY.push({ x: r3(startXY.x + (endXY.x - startXY.x) * t), y: r3(startXY.y + (endXY.y - startXY.y) * t) });
    }
    rails.push({
      railId, roofPlaneId: ctx.roofPlanes[Math.min(row, ctx.roofPlanes.length - 1)]?.planeId ?? 'plane-1',
      startXY, endXY, splicePointsXY,
      physicalLengthIn: r3(railLenIn), stockLengthIn: stockIn, spanConfigIn: ml.mountSpacingIn,
      cantileverIn: r3n(ra?.cantileverIn ?? null), spliceCount,
      supportedModuleIds: rowModules[row] ?? [],
      attachmentIds: attIds,
      manufacturerSpanLimitIn: spanLimitIn,
      governingWindSnowZone: zone,
      utilization: r3n(ra?.utilizationRatio ?? null),
      coord: coordMetaFor(transform, coordFrame, 'rail start/end in canonical site-plan-ft (co-located from module centroids)'),
      provenance: PROV(sys?.rail
        ? 'rail geometry from array-geometry engine; span limit from mounting-hardware-db rail spec'
        : 'rail geometry from array-geometry engine; rail SKU PENDING SELECTION — no span-limit authority on the mount record (NOT FOR PERMIT SUBMISSION)'),
    });
  }
  return { rails, attachments };
}

// ── §10 direct-mount attachment objects (rail-less; NO rail objects) ────────
// W4 closer: the module→attachment relation is now carried by the PROMOTED
// canonical fields — AttachmentObject.supportedModuleId (the module a direct-
// mount attachment supports) and ModuleInstance.attachmentIds (back-filled
// below). Rail-based systems continue to carry the relation on the rail
// (supportedModuleIds/attachmentIds); the former local AttachmentObjectExt is
// retired. Both fields are optional so rail-based serialization/digest is
// unchanged; direct-mount serialization is byte-identical to the prior Ext form.
function buildDirectMountAttachments(
  ctx: StructuralAuthorityCtx, run: StructuralResultV4, input: StructuralInputV4 | null,
  framingVerified: boolean, moduleInstances: ModuleInstance[], transform: DrawingTransform,
): AttachmentObject[] {
  const sys = ctx.mountSystem;
  if (!sys) return [];
  const ml = run.mountLayout ?? null;
  const coordFrame: CoordinateMeta['sourceFrame'] =
    moduleInstances.some(m => m.polygon.frame === 'plan-ft') ? 'plan-ft' : 'schematic-ft';
  const substrate = framingVerified
    ? `${input?.framingType === 'truss' ? 'truss' : 'rafter'} ${input?.rafterSize ?? ''}`.trim()
    : 'unverified-framing';
  // §10 manufacturer attachment pattern (single source = mounting-hardware-db):
  // per-module mount POINTS derived from the module's up-slope span and the
  // product's max mount spacing — min 2 supports per long frame edge (the two
  // frame rails), 2 edges. Fastener model/count/embedment/method + capacity
  // basis all read from the SAME mount record. Nothing invented.
  const maxSpacingIn = sys.mount.maxSpacingIn && sys.mount.maxSpacingIn > 0 ? sys.mount.maxSpacingIn : 48;
  const fastenerCount = sys.mount.fastenersPerMount ?? null;
  const capBasis = sys.mount.capacityBasis;
  // Design PRESSURE basis is the engine of record (V4 mountLayout): per-mount
  // reaction ÷ its tributary = the ASD design pressure; we re-apply that SAME
  // pressure to the geometry-honest per-attachment tributary (module footprint ÷
  // mounts-on-module), so the load basis is single-sourced while the count +
  // coordinates are geometry-derived. Capacity = the mount record allowable
  // (count-independent). Absent an engine layout, reactions are honestly null.
  const pUplift = ml && ml.tributaryAreaPerMountFt2 > 0 ? ml.upliftPerMountLbs / ml.tributaryAreaPerMountFt2 : null;
  const pDown = ml && ml.tributaryAreaPerMountFt2 > 0 ? ml.downwardPerMountLbs / ml.tributaryAreaPerMountFt2 : null;
  // §8 gravity pressures (roof snow + added dead) applied to the geometry-honest
  // per-attachment tributary so reaction sums close on the array footprint.
  const snowPsf = run.snow?.roofSnowLoadPsf ?? null;
  const deadPsf = run.addedDeadLoadPsf ?? null;
  const capacity = ml && ml.mountCapacityLbs > 0
    ? ml.mountCapacityLbs
    : (sys.mount.upliftCapacityLbs && sys.mount.upliftCapacityLbs > 0 ? sys.mount.upliftCapacityLbs : null);

  const out: AttachmentObject[] = [];
  for (const mi of moduleInstances) {
    const poly = (mi.drawnPolygon?.points?.length ? mi.drawnPolygon : mi.polygon)?.points ?? [];
    if (poly.length < 4) continue;   // no footprint → no attachment (honest skip)
    const C = { x: avg(poly.map(p => p.x)), y: avg(poly.map(p => p.y)) };
    // half-axes from the oriented footprint corners [(-u-v),(+u-v),(+u+v),(-u+v)]
    const uH = { x: (poly[1].x - poly[0].x) / 2, y: (poly[1].y - poly[0].y) / 2 }; // up-slope half-axis
    const vH = { x: (poly[3].x - poly[0].x) / 2, y: (poly[3].y - poly[0].y) / 2 }; // along-eave half-axis
    const upSlopeIn = mi.orientation === 'portrait' ? mi.heightIn : mi.widthIn;
    const perEdge = Math.max(2, Math.ceil(upSlopeIn / maxSpacingIn));   // supports per long frame edge
    const perModule = perEdge * 2;                                       // two frame edges
    const tributaryFt2 = perModule > 0 ? mi.areaFt2 / perModule : null;
    const upliftLbs = pUplift != null && tributaryFt2 != null ? r3(pUplift * tributaryFt2) : null;
    const snowLbs = snowPsf != null && tributaryFt2 != null ? r3(snowPsf * tributaryFt2) : null;
    const deadLbs = deadPsf != null && tributaryFt2 != null ? r3(deadPsf * tributaryFt2) : null;
    const downwardLbs = ((snowLbs ?? 0) + (deadLbs ?? 0)) || (pDown != null && tributaryFt2 != null ? r3(pDown * tributaryFt2) : null);
    const sf = upliftLbs != null && upliftLbs > 0 && capacity != null ? r3(capacity / upliftLbs) : null;
    const rawModuleId = mi.instanceId.replace(/^mi-/, '');
    let n = 0;
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < perEdge; i++) {
        n++;
        const upFrac = 2 * ((i + 0.5) / perEdge - 0.5);   // ±0.5 @ perEdge=2 (module quarter points)
        const ax = C.x + s * 0.5 * vH.x + upFrac * uH.x;
        const ay = C.y + s * 0.5 * vH.y + upFrac * uH.y;
        out.push({
          attachmentId: `att-dm-${rawModuleId}-${n}`,
          railId: '',                                     // no rail (direct-mount) — honest empty
          roofPlaneId: mi.roofPlaneId,
          supportedModuleId: mi.instanceId,               // module→attachment relation (Ext)
          xy: { x: r3(ax), y: r3(ay) },
          roofZone: run.wind.roofZone ?? null,
          substrateMember: substrate,
          attachmentMethod: sys.mount.attachmentMethod ?? null,
          fastenerModel: sys.hardware.lagBolt ?? null,
          fastenerCount,
          embedmentIn: sys.mount.fastenerEmbedmentIn ?? null,
          tributaryAreaFt2: tributaryFt2 != null ? r3(tributaryFt2) : null,
          upliftReactionLbs: upliftLbs,
          downwardReactionLbs: downwardLbs,
          deadReactionLbs: deadLbs,
          snowReactionLbs: snowLbs,
          lateralReactionLbs: null,
          allowableCapacityLbs: capacity != null ? r3(capacity) : null,
          adjustmentFactors: { omegaUltimateToAllowable: capBasis === 'allowable' ? 1 : 3.0 },
          utilization: sf != null && sf > 0 ? r3(1 / sf) : null, safetyFactor: sf,
          // W7 artifact — zone pressure basis + design method + honest model label.
          zonePressurePsf: r3n(run.wind.netUpliftPressurePsf ?? null),
          loadBasis: 'ASD',
          zoneModel: 'CONSERVATIVE SCREENING ENVELOPE — governing corner (Zone 3) C&C pressure + geometry-honest per-attachment tributary (design pressure re-applied from the engine of record)',
          coord: coordMetaFor(transform, coordFrame, 'direct-mount attachment coordinate in canonical site-plan-ft (per-module mount point from module footprint × product pattern)'),
          provenance: PROV(`direct-mount attachment: coordinate from module footprint × mounting-hardware-db pattern (${sys.id}: ${sys.mount.attachmentMethod}, maxSpacing ${maxSpacingIn}", ${fastenerCount ?? '?'} fastener/mount, ${perEdge}/edge); reaction = engine-of-record design pressure × geometry tributary; capacity = mount-record allowable`),
        });
      }
    }
  }
  return out;
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
  // §2 (BAR) — the canonical ENVIRONMENTAL LOAD AUTHORITY. Operator-entered
  // wind/snow/exposure are OBSERVATIONS/OVERRIDES; a bare code default is
  // PRELIMINARY. The record is verified ONLY via an archived, currency-reviewed
  // climate-hazard source. windSpeedSource is now DERIVED from the authority's
  // verification state (never "canonical … authority" for a bare operator entry).
  const environmentalLoadAuthority = buildEnvironmentalLoadAuthority({
    windSpeedMph: ctx.windSpeedMph,
    exposureCategory: ctx.exposure,
    riskCategory: ctx.riskCategory,
    groundSnowPsf: ctx.snowPsf,
    windOperatorEntered: ctx.windValuePresent,
    snowOperatorEntered: ctx.snowValuePresent,
    coordinates: ctx.environmentalCoordinates ?? null,
    addressUsed: ctx.environmentalAddressUsed ?? null,
    projectOrAhj: ctx.projectJurisdiction ?? null,
    sourceEvidence: ctx.environmentalSource ?? null,
    capturedAtIso: ctx.environmentalCapturedAtIso ?? null,
    retrievalRecord: ctx.environmentalRetrieval ?? null,
  });
  const verified = environmentalLoadAuthority.verificationStatus === 'verified';
  const windSource = verified
    ? `verified climate-hazard source (${environmentalLoadAuthority.sourceDataset ?? environmentalLoadAuthority.sourceDocumentId})`
    : ctx.windValuePresent
      ? 'OPERATOR-ENTERED — NOT VERIFIED (observation/override; no archived climate-hazard source)'
      : 'code-minimum default (ASCE 7-22 §26.5) — UNVERIFIED, no AHJ wind authority';
  // AAC WS-4 — DISPLAYED VALUES DERIVE FROM THE RECORD. Before this, StructuralEnv
  // echoed the raw ctx scalars while environmentalLoadAuthority carried the
  // verified-source values, so a verified retrieval could disagree with the number
  // printed beside it. The authority record is now the single source for all four
  // scalars; with no verified source it returns exactly the ctx values, so an
  // unresolved build is byte-identical.
  return {
    ultimateWindSpeedMph: environmentalLoadAuthority.ultimateWindSpeedMph,
    windSpeedSource: windSource,
    exposureCategory: environmentalLoadAuthority.exposureCategory,
    riskCategory: environmentalLoadAuthority.riskCategory,
    groundSnowPsf: environmentalLoadAuthority.groundSnowLoadPsf,
    roofSnowPsf: run ? r3(run.snow.roofSnowLoadPsf) : null,
    buildingHeightFt: ctx.meanRoofHeightFt,
    componentCladdingZones: run?.wind.roofZone ? [String(run.wind.roofZone)] : [],
    upliftPressurePsf: run ? r3(run.wind.netUpliftPressurePsf) : null,
    downforcePressurePsf: run ? r3(run.wind.netDownwardPressurePsf) : null,
    codeAuthority: { asceEdition: ctx.asceEdition, source: ctx.asceSource },
    environmentalLoadAuthority,
    provenance: PROV('wind/snow/exposure = canonical ENVIRONMENTAL LOAD AUTHORITY (basis + verification state); '
      + 'roof pressures from structural-engine-v4; ASCE edition via code-authority interface (AHJ population = W4)'),
  };
}

// ── §12 blockers ─────────────────────────────────────────────────────────────
function collectBlockers(
  ctx: StructuralAuthorityCtx,
  a: Pick<StructuralAuthorityBundle, 'moduleInstances' | 'roofPlaneObjects' | 'rackingAssembly' | 'rails' | 'attachments' | 'engine' | 'checks' | 'bomReconciliation' | 'reactionReconciliation' | 'env'>,
): { code: string; message: string }[] {
  const b: { code: string; message: string }[] = [];
  // §10 — a BOM that does not reconcile with the structural objects is a
  // quantity-authority failure regardless of system type.
  if (!a.bomReconciliation.ok) {
    b.push({ code: 'STRUCTURAL-BOM-RECONCILIATION-FAILED',
      message: `Structural BOM quantities do not reconcile with the canonical objects: `
        + a.bomReconciliation.checks.filter(c => !c.ok).map(c => c.name).join(', ') });
  }
  // §8 — attachment reactions that do not reconcile with the applied load
  // (object count ≠ reaction model, Σ tributary ≉ array area, or Σ reactions ≉
  // applied × area) are not traceable — the per-attachment reaction cannot be
  // presented as authoritative. Blocks permit-ready.
  if (a.reactionReconciliation.present && !a.reactionReconciliation.ok) {
    b.push({ code: 'STRUCTURAL-REACTION-RECONCILIATION-FAILED',
      message: 'Attachment reactions do not reconcile with the applied load: '
        + a.reactionReconciliation.checks.filter(c => !c.ok).map(c => c.name).join(', ')
        + ' — per-attachment reaction not traceable to the array footprint / object set.' });
  }
  if (!ctx.isRoofSystem) return b;
  // W4.1 §1 — an UNKNOWN mounting topology (neither verified rail-paired nor
  // verified rail-less — e.g. an unconfirmed RT-MINI alias) must ACTIVELY BLOCK
  // permit-ready generation. Guarded on the topology VALUE (classifyMountTopology),
  // never the product name. This flows into permitReadiness.blockers (build.ts)
  // and is cross-checked by the V36 validator.
  const mountTopo = ctx.mountSystem ? classifyMountTopology(ctx.mountSystem) : null;
  if (ctx.mountSystem && mountTopo?.topology === 'unknown') {
    b.push({ code: 'MOUNT-TOPOLOGY-UNKNOWN',
      message: `Mounting product ${ctx.mountSystem.manufacturer} ${ctx.mountSystem.model} has an UNRESOLVED `
        + `mounting topology (neither verified rail-paired nor verified rail-less) — ${mountTopo.basis} `
        + `Permit-ready generation is blocked until the product's mounting topology is confirmed.` });
  }
  const railBased = !!ctx.mountSystem
    && (ctx.mountSystem.systemType === 'rail_based' || ctx.mountSystem.systemType === 'standing_seam'
      || ctx.mountSystem.mountTopology === 'rail_paired');
  const directMount = !!ctx.mountSystem && mountTopo?.topology === 'rail_less';

  if (a.engine.engineeringReviewRequired) {
    // FRAMING-AUTHORITY GATE — canonical code FRAMING-AUTHORITY-UNVERIFIED
    // (successor to STRUCTURAL-FRAMING-UNVERIFIED). Fires whenever no verified
    // framing CAPACITY authority exists — INCLUDING the live Braidon row whose
    // operator-entered fields are complete (observation is not capacity authority).
    b.push({ code: 'FRAMING-AUTHORITY-UNVERIFIED',
      message: a.engine.reviewReasons[0]
        ?? 'No verified framing CAPACITY authority — a project-specific structural review (archived truss '
           + 'drawing / manufacturer calc / stamped analysis, or a digest-bound engineer review) is required '
           + 'before permit submission. Operator-entered framing geometry is OBSERVATION, not capacity authority.' });
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
  // W6 — NO verified EXACT rail assembly. When the rail SKU is unpinned (rail-based
  // mount carrying no own rail spec), OR the assembly's per-element verification is
  // not fully cleared (capacity source unarchived / span source unresolved), the
  // racking assembly is NOT permit-ready: emit the explicit PENDING blocker so the
  // banner prints "PENDING RACKING ASSEMBLY SELECTION / NOT FOR PERMIT SUBMISSION"
  // and structural PASS is prevented. Guarded on the record's honest verification
  // states — never fabricated.
  const _rk = a.rackingAssembly as unknown as {
    assemblyVerification?: { railSku?: string; overall?: string };
    railSku?: string | null; railModel?: string | null;
  } | null;
  // ── AAC WS-8 STRUCTURAL SEPARATION (audit §2.8) ──────────────────────────
  // This code used to fire on `_railUnpinned || _assemblyPending`. The
  // `_assemblyPending` leg was a pure DUPLICATE of the capacity-document
  // predicate that RACKING-CAPACITY-SOURCE-NOT-ARCHIVED / -APPLICABILITY-GAP
  // already emit — one document, three codes, and a SELECTION-typed requirement
  // that a document could satisfy. WS-8 forbids bundling: this requirement is
  // now the RAIL SELECTION and nothing else, and a document can never clear it.
  //
  // The verdict comes from the rail-selection trace when the resolver ran (it
  // probes every store a rail could live in), and falls back to the record's own
  // honest unpinned flags when it did not — identical behaviour for the
  // rail leg, so no golden moves on that account.
  const _railUnpinned = !!a.rackingAssembly?.mixedManufacturer
    && (a.rackingAssembly?.railSku == null)
    && (a.rackingAssembly?.railModel == null || /PENDING/i.test(a.rackingAssembly.railModel));
  const _sel = ctx.rackingAssemblySelection ?? null;
  const _railUnselected = _sel ? _sel.state === 'unselected' : _railUnpinned;
  if (a.rackingAssembly && _railUnselected) {
    const _shortlist = _sel && _sel.eligibleCandidateCount > 0
      ? ' Span-screened listed candidates: '
        + _sel.candidates.filter(c => c.refusedReason == null)
          .map(c => `${c.manufacturer} ${c.railModel} (${c.maxSpanIn}" max span)`).join(', ')
        + '. The catalog carries no rail part number, so the orderable SKU comes from the distributor line item.'
      : '';
    b.push({ code: 'PENDING-RACKING-ASSEMBLY-SELECTION',
      message: 'Rail / splice SKU is UNSELECTED for this mixed-manufacturer assembly — PENDING RACKING ASSEMBLY '
        + 'SELECTION, NOT FOR PERMIT SUBMISSION. This is a design + procurement decision, not a document: no rail is '
        + 'recorded in the project record, the canonical equipment store or the mount product, and the engine does not '
        + 'choose between compatible manufacturers.' + _shortlist });
  }
  // §13 (CO-C) — FASTENER-ASSEMBLY-UNVERIFIED. The roof-attachment fastener
  // assembly is mount-BASE hardware, verifiable independent of the rail selection,
  // so it carries its OWN blocker code (NOT a child of PENDING-RACKING-ASSEMBLY-
  // SELECTION — a relationship note is rendered on RS-1). The fastener is VERIFIED
  // only when it is NOT capacity-gated AND the assembly's own fastener element is
  // verified (model + count + embedment present) AND a source document exists —
  // the SAME condition projectFastenerAssembly uses to render the certLabel, so
  // the visible "PENDING VERIFIED FASTENER ASSEMBLY" label always maps to this
  // registry code (gate 13). Deterministic; no fabricated evidence.
  {
    const ra = a.rackingAssembly as unknown as {
      datasheetSource?: string | null; capacitySource?: string | null;
      assemblyVerification?: { fastener?: string };
      structuralAuthorityGaps?: { code: string; severity: string }[];
    } | null;
    if (ra) {
      // ── AAC WS-8 (audit §2.11) — THE `_capGated` ECHO IS DELETED. ─────────
      // This block used to AND in `_capGated`: whether any RACKING-CAPACITY-*
      // gap was open. That made a requirement documented — here and in
      // severityPolicy — as "mount-BASE hardware, verifiable independent of the
      // rail selection" into a pure downstream echo of the rail-capacity
      // document. It fired on assemblies whose fastener element was already
      // fully verified (model + count + embedment + an ICC-ES evaluation
      // report), inflating the RG-4 count with a duplicate of §2.9/§2.10.
      //
      // The predicate is now what the documentation always claimed: the mount's
      // OWN fastener element must be complete AND carry a source document. The
      // capacity-document question stays with the two codes that own it.
      // TAC WS-4 — THE ONE PREDICATE (resolveFastenerVerification). This block
      // used to carry its own two-term test while structuralProjection carried a
      // different one and structuralBom a third — the reason one package could
      // print "VERIFIED FASTENER ASSEMBLY" and "INSTALLATION DETAILS: NOT
      // ESTABLISHED" at the same time. A flashing/water-resistance evaluation
      // report is not fastener authority, and the document must be APPLICABLE to
      // the selected product version.
      const _fv = fastenerVerdictFor(ra, ctx);
      if (!_fv.verified) {
        b.push({ code: 'FASTENER-ASSEMBLY-UNVERIFIED',
          message: `Roof-attachment fastener assembly UNVERIFIED — ${_fv.reason}. Mount-BASE authority, decided independently of `
            + 'the rail selection and of the rail-capacity document.' });
      }
    }
  }
  // §12 (CO-C) — EQUIPMENT-DOCUMENT-APPLICABILITY. The manufacturer install/detail
  // document cited on PV-3 / DS-3 / APP-A must cover the SELECTED mount's exact
  // product version. When the on-file document is for a DIFFERENT version
  // (RT-MINI II manual vs the selected RT-MINI) and no VERIFIED cross-reference /
  // alias evidence record establishes applicability, the citation is not
  // authoritative — block permit-ready. No alias record is fabricated here.
  if (ctx.mountSystem) {
    const _asset = getManufacturerAsset(ctx.mountSystem.id, 'racking_detail');
    // AAC WS-8 (audit §7.7) — REAL registry facts, so AUTHORITATIVE is reachable.
    // Every call site used to pass `null` for the 4th argument, which meant the
    // strictest document verdict could never be produced no matter what was
    // archived. racking-documents@v1 supplies facts ONLY for a VERSION-EXACT
    // archived document, so this can never manufacture a verdict.
    const _facts = ctx.documentRegistryFacts?.[`racking_detail:${ctx.mountSystem.id}`] ?? null;
    const _appl = evaluateDocumentApplicability(ctx.mountSystem.model, _asset, null, _facts);
    // ECD §8 — fires on the 7-state verdict: applicability NOT established.
    if (_asset && !_appl.applicabilityVerified) {
      b.push({ code: 'EQUIPMENT-DOCUMENT-APPLICABILITY',
        message: `Manufacturer document applicability UNVERIFIED — cited ${_appl.documentProduct ?? 'document'} covers a different `
          + `product version than the selected mount ${ctx.mountSystem.model}; no verified alias evidence. Provide the version-exact document.` });
    }
  }
  // §2 (BAR) — ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED (successor to WIND-SNOW-
  // AUTHORITY-UNRESOLVED). Fires whenever the canonical ENVIRONMENTAL LOAD
  // AUTHORITY is not VERIFIED — subsuming BOTH the null/code-minimum-default case
  // AND the operator-entered-without-provenance case (the live Braidon row: 110
  // mph / Exposure C / 20 psf are OPERATOR-ENTERED, an observation/override, never
  // verified design criteria absent an archived, currency-reviewed climate-hazard
  // source). One code, no duplicate. Values still drive the preliminary analysis
  // and print WITH their basis/verification state.
  const _env = a.env.environmentalLoadAuthority;
  if (_env.verificationStatus !== 'verified') {
    const _windLbl = _env.windSpeedBasis === 'operator-entered' ? 'operator-entered'
      : _env.windSpeedBasis === 'code-minimum-default' ? 'code-minimum default' : 'not provided';
    const _snowLbl = _env.snowLoadBasis === 'operator-entered' ? 'operator-entered'
      : _env.snowLoadBasis === 'code-minimum-default' ? 'code-minimum default' : 'not provided';
    // Concise one-line explanation (the CERT gate banner + cover render this); the
    // full observation-vs-verified rationale lives in the registry resolutionAction,
    // shown on RS-1 — the same split QCABLE-PROCUREMENT-INSUFFICIENT uses.
    b.push({ code: 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
      message: `Environmental load authority UNVERIFIED — wind ${_windLbl}, snow ${_snowLbl}, exposure/risk carry no `
        + `archived climate-hazard source; values are PRELIMINARY design criteria, not verified.` });
  }
  if (a.moduleInstances.length > 0 && a.attachments.length === 0) {
    // §10 — direct-mount geometry that could not be derived (product pattern
    // unknown or plane unresolved) is an HONEST BLOCKING GAP; other systems keep
    // the generic reactions-untraceable blocker. Both block permit-ready.
    if (directMount) {
      b.push({ code: 'DIRECT-MOUNT-GEOMETRY-MISSING',
        message: 'Rail-less/direct-mount system but no canonical attachment objects could be derived '
          + '(module footprint or attachment pattern unresolved) — mount coordinates and reactions not traceable' });
    } else {
      b.push({ code: 'REACTIONS-UNTRACEABLE',
        message: 'Module instances present but no canonical attachment objects — reactions not traceable' });
    }
  }
  // §11 (V25) — an attachment reaction exceeding its allowable capacity must
  // actively block permit-ready (rail-based or direct-mount alike).
  if (a.attachments.some(at => at.upliftReactionLbs != null && at.allowableCapacityLbs != null
      && at.upliftReactionLbs > at.allowableCapacityLbs)
      && !b.some(x => x.code === 'STRUCTURAL-UTILIZATION-EXCEEDED')) {
    b.push({ code: 'STRUCTURAL-UTILIZATION-EXCEEDED',
      message: 'Attachment uplift reaction exceeds allowable capacity — structural review required before permit' });
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
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** §2 — module centroids in the canonical plan-ft frame (SAME projection as
 *  buildModuleInstances), used to derive the DT-SITE plan-rotation authority. */
function modulePlanCentroids(ctx: StructuralAuthorityCtx): { x: number; y: number }[] {
  const geo = ctx.geoModules;
  const withLL = geo.filter(g => isFin(g.lat) && isFin(g.lng));
  if (withLL.length !== geo.length || geo.length === 0) return [];
  const clat = avg(withLL.map(g => g.lat as number));
  const clng = avg(withLL.map(g => g.lng as number));
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((clat * Math.PI) / 180);
  return geo.map(g => ({
    x: ((g.lng as number) - clng) * ftPerDegLng,
    y: ((g.lat as number) - clat) * FT_PER_DEG_LAT,
  }));
}
const r3n = (n: number | null | undefined): number | null =>
  (n == null || !isFinite(n)) ? null : Math.round(n * 1000) / 1000;
const round0 = (n: number | null | undefined): string => n == null ? '?' : String(Math.round(n));
