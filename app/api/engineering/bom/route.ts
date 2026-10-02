// ============================================================
// POST /api/engineering/bom
// Registry-driven BOM generation — V4 + Structural Merge
//
// ARCHITECTURE (MASTER TASK):
//   V4 engine  → electrical BOM (inverters, wiring, conduit, breakers, labels)
//   Structural → geometry BOM  (posts, rails, clamps, bracing — fence/ground)
//   mergeBOM() → combined final BOM
//
// V4 owns electrical. Structural is separate. Merge layer combines.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
import { generateBOMV4, bomToMarkdown, bomToCSV, BOMGenerationInputV4 } from '@/lib/bom-engine-v4';
import { deriveStructuralBOMForSubsystems, type BOMSystemType, type StructuralBOMItem, type SubSystemPanelCounts } from '@/lib/bom-system-profiles';
import type { BOMGenerationResultV4, BOMLineItemV4, BOMStageResult, BOMStageId } from '@/lib/bom-engine-v4';
import { validateBOMInputs } from '@/lib/bom-validation';
import { readProductionMeterFlag } from '@/lib/equipment/currentTransformers';
import { deriveEcoFlowBOM, MICRO_ONLY_CATEGORIES } from '@/lib/ecoflow-bom';
import { isEcoFlowInverter } from '@/lib/ecoflow-system';
import { requireAuth } from '@/lib/security';
// Phase 9 — brand-driven sizing engine integration
import { sizeSystemFromBrand, type SystemSizingResult } from '@/lib/system/sizingEngine';
import { sizingResultToBomItems, shouldStripMicroItems } from '@/lib/system/sizingToBom';
import { applyDistributorPricing, type DistributorPriceOverride } from '@/lib/bom/distributorPricing';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { readStoredCombinerSelection, effectiveCombinerId, isReadableProjectId } from '@/lib/combinerSelection/storedRead';

// ── Helper: Inject structural items into V4 result (preserves manufacturer/model/partNumber) ──
// This is the MASTER TASK merge: V4 owns electrical, structural profile owns structural.
// We inject structural items directly into V4's stages WITHOUT going through the lossy
// BOMItem intermediate (which strips manufacturer). V4-owned categories always win.
const V4_OWNED_CATEGORIES = new Set([
  'solar_panel', 'microinverter', 'optimizer', 'string_inverter',
  'hybrid_inverter', 'inverter', 'battery',
  'generator', 'ats', 'backup_interface',
  'wire', 'trunk_cable', 'terminator', 'conduit',
  'disconnect', 'breaker', 'rapid_shutdown', 'combiner', 'junction_box',
  'meter', 'gateway', 'monitoring', 'label', 'racking',
  // V4 Stage 5 always emits one grounding-electrode system (category 'grounding'
  // for the rod/clamp, 'wire' for the GEC). The structural BOM profiles emit
  // their own ground_rod/ground_wire/ground_clamp, which duplicated it for
  // ground/fence systems. V4 is the single grounding authority — skip the
  // structural-profile copies so exactly one electrode system survives.
  'grounding', 'ground_rod', 'ground_wire', 'ground_clamp',
  // FIX: monitoring_gateway is the sizing-engine category for the same IQ Gateway
  // that V4 already emits via inverterEntry.requiredAccessories (category='gateway').
  // Without this, sizingToBom injects a second IQ Gateway into Stage 6.
  'monitoring_gateway',
  // FIX: dc_disconnect and ac_disconnect from SolarEdge brand profile BOS families
  // are duplicates of V4's dedicated Stage 2 (DC) and Stage 4 (AC) disconnect items.
  // Without these, sizing engine injects unnamed "dc_disconnect"/"ac_disconnect" entries.
  'dc_disconnect', 'ac_disconnect',
]);

let _structuralIdCounter = 0;
function nextStructuralId(): string {
  return `bom-struct-${(++_structuralIdCounter).toString().padStart(4, '0')}`;
}

function structuralToV4Item(si: StructuralBOMItem): BOMLineItemV4 {
  return {
    id: nextStructuralId(),
    stageId: si.stageId as BOMStageId,
    stageLabel: 'Stage 5 — Structural',
    category: si.category,
    manufacturer: si.manufacturer,   // PRESERVED (e.g., 'SolFence', 'Unirac')
    model: si.model,                  // PRESERVED
    partNumber: si.partNumber,        // PRESERVED
    description: si.description,
    quantity: si.quantity,
    unit: (si.unit === 'bag' || si.unit === 'kit') ? 'ea' : si.unit as BOMLineItemV4['unit'],
    necReference: 'IBC 2021',
    derivedFrom: `geometry: ${si.derivedFrom}`,
    formula: si.derivedFrom,
    required: si.required,
  };
}

function injectStructuralIntoV4(
  v4: BOMGenerationResultV4,
  structuralItems: StructuralBOMItem[],
  // HYBRID (P3): a partitioned project legitimately carries BOTH roof racking
  // lines (V4 registry: 'rail'/'mid_clamp'/'end_clamp' for the roof subset) AND
  // ground-mount structural lines of the SAME category names (Unirac RM10 rails/
  // clamps for the ground subset). The category-collision dedup below exists to
  // stop double-billing the SAME physical hardware in single-type projects (e.g.
  // pure-ground: registry GFT rails vs profile RM10 rails) — in hybrid mode those
  // are DIFFERENT physical assemblies, so skip only the V4-owned (electrical
  // authority) check. Legacy callers omit the flag → behavior unchanged.
  allowStructuralCoexist = false,
): BOMGenerationResultV4 {
  _structuralIdCounter = 0;
  const v4Categories = new Set(v4.items.map(i => i.category));
  const overlapsSkipped: string[] = [];

  // Filter: skip V4-owned categories, skip overlaps, skip zero qty
  const toAdd: BOMLineItemV4[] = [];
  for (const si of structuralItems) {
    if (V4_OWNED_CATEGORIES.has(si.category)) {
      overlapsSkipped.push(`${si.category}: V4 wins (electrical authority)`);
      continue;
    }
    if (!allowStructuralCoexist && v4Categories.has(si.category)) {
      overlapsSkipped.push(`${si.category}: V4 wins (existing item)`);
      continue;
    }
    if (si.quantity <= 0) continue;
    toAdd.push(structuralToV4Item(si));
  }

  if (overlapsSkipped.length > 0) {
    console.log('[BOM MERGE] Overlaps resolved:', overlapsSkipped);
  }

  // Inject into V4's structural stage
  const mergedItems = [...v4.items, ...toAdd];

  // Rebuild stages
  const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
  for (const item of mergedItems) {
    if (!stageMap.has(item.stageId)) stageMap.set(item.stageId, []);
    stageMap.get(item.stageId)!.push(item);
  }

  const stages: BOMStageResult[] = v4.stages.map(stage => ({
    ...stage,
    items: stageMap.get(stage.id) ?? stage.items,
    itemCount: (stageMap.get(stage.id) ?? stage.items).length,
  }));

  return {
    ...v4,
    items: mergedItems,
    stages,
    totalLineItems: mergedItems.length,
  };
}

// Coerce an untrusted payload value to a finite number, or undefined.
const _finiteOrUndef = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const body = await req.json();

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 HOW MANY DEVICES ARE THERE? THE GRAPH ANSWERS, NOT THE POST BODY.
    //
    // `docs/ELECTRICAL-AUTHORITY-MAP.md` found `lib/bom-engine-v4.ts` with zero references to the
    // service graph, and this route taking `batteryCount` straight off the request — a scalar the
    // Engineering page computed from `selected_equipment`. Ray's standing ruling on this exact
    // class: "Device COUNT = capacity, never array/brand count", and on the attack list: "price
    // engine counting catalog selection rather than physical instances."
    //
    // A catalogue selection says WHICH Powerwall. It cannot say how many are installed, which
    // Gateway each pair lands in, or that there are two generation panels — those are relationships,
    // and relationships live in the graph. So the canonical model supplies the counts and the posted
    // scalar becomes what it should always have been: a fallback for a project with no graph.
    //
    // 🚨 AND THE COUNT IS NOT COPIED BETWEEN SURFACES. Ray prohibited "copying ServiceTopology
    // values into System Config". This is not that: nothing is written back, the override is
    // in-memory for this one generation, and `reconcileQuantities` below PROVES the lines agree with
    // the graph rather than trusting that they do.
    // ═══════════════════════════════════════════════════════════════════════
    let _electrical: Awaited<ReturnType<
      typeof import('@/lib/electrical/loadElectricalProject')['loadElectricalProject']
    >> = null;
    if (isReadableProjectId(body?.projectId)) {
      try {
        const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
        _electrical = await loadElectricalProject(String(body.projectId), _auth.user.id);
        const _m = _electrical?.model;
        if (_m?.topology) {
          const _posted = Number(body.batteryCount) || 0;
          // Inverting units are the AC-producing cabinets; expansions are energy only and are
          // emitted as their own lines by `bomFromServiceTopology` (with their harnesses), so they
          // must NOT be added here or the engine would order a Powerwall per expansion.
          const _canonical = _m.storage.invertingUnitCount;
          if (_canonical !== _posted) {
            console.warn('[bom/POST] battery count corrected from the service graph:'
              + ` posted=${_posted} canonical=${_canonical}`
              + ` (${_m.storage.provenance.source}) — the graph owns physical multiplicity.`);
          }
          body.batteryCount = _canonical;
          console.log('[bom/POST] canonical electrical model:'
            + ` revision=${_electrical!.revision}`
            + ` coupling=${_m.solarCoupling ?? 'UNRESOLVED'}`
            + ` storage=${_canonical} expansions=${_m.storage.expansionUnitCount}`
            + ` gateways=${_m.storage.gatewayCount}`
            + ` genPanels=${_m.storage.perSystemGenerationPanelCount}`
            + ` conflicts=${_m.conflicts.length}`);
          for (const c of _m.conflicts) {
            console.warn(`[bom/POST] ELECTRICAL CONFLICT — ${c.fact}: `
              + c.claims.map(x => `${x.source} says ${x.says}`).join(' | '));
          }
        }
      } catch (e) {
        console.warn('[bom/POST] canonical electrical read skipped (non-fatal):', (e as Error)?.message);
      }
    }

    // ── The RECORDED combiner, from the project store ─────────────────────────
    // The page posts its own copy of the installer's pick, and its read of the
    // store fails open — one dropped GET and it posts nothing. The permit route
    // reads the store itself, so this drawing must too, or the two name
    // different devices (lib/combinerSelection/storedRead). A store that cannot
    // be read leaves the posted value: only the permit, the sealed package, refuses.
    if (isReadableProjectId(body?.projectId)) {
      const { getDbReady } = await import('@/lib/db-neon');
      const _stored = await readStoredCombinerSelection(getDbReady, body.projectId);
      if (_stored.kind === 'stored') {
        const _id = effectiveCombinerId(body.selectedCombinerId, _stored, 'bom/POST');
        if (_id) body.selectedCombinerId = _id; else delete body.selectedCombinerId;
      } else effectiveCombinerId(body.selectedCombinerId, _stored, 'bom/POST');
    }

    // v58.8 GUARD: if inverterId is an optimizer peripheral (e.g. 'se-p505'),
      // the frontend sent the wrong field. Resolve to correct central inverter via brand profile,
      // and use the peripheral as the optimizerId instead.
      let resolvedInverterId: string = body.inverterId ?? 'fronius-primo-8.2';
      let resolvedOptimizerId: string | undefined = body.optimizerId;
      {
        const { getRegistryEntryV4: _reg } = await import('@/lib/equipment-registry-v4');
        const { getBrandProfile: _bp } = await import('@/lib/system/brandProfiles');
        const _invEntry = _reg(resolvedInverterId);
        if (_invEntry?.category === 'optimizer') {
          const _mfr = (_invEntry.manufacturer ?? '').toLowerCase();
          const _brandKey = _mfr.includes('solaredge') ? 'solaredge'
            : _mfr.includes('tigo') ? 'tigo' : undefined;
          const _profile = _brandKey ? _bp(_brandKey) : undefined;
          const _models = _profile?.supportedInverterModels ?? [];
          const _central = _models.length > 0 ? _models[_models.length - 1].equipmentDbId : undefined;
          if (_central) {
            console.warn('[BOM ROUTE v58.8] inverterId', resolvedInverterId,
              'is optimizer peripheral — resolving central inverter:', _central);
            resolvedOptimizerId = resolvedOptimizerId ?? resolvedInverterId;
            resolvedInverterId = _central;
          }
        }
      }

      // ── HYBRID (P3): optional multi-system payload fields ─────────────────
      // ALL optional — legacy payloads (none of these present) behave identically.
      //   subSystemCounts        → per-mount-type panel partition (roof/ground/fence)
      //   fenceData.fencePanelCount → fence SUBSET count (drives section math fix)
      //   roofData               → roof SUBSET structural quantities + mounting system
      //   groundData             → may now arrive even when systemType !== 'ground'
      const _ssc: SubSystemPanelCounts | undefined = (() => {
        const s = body.subSystemCounts;
        if (!s || typeof s !== 'object') return undefined;
        const roof   = _finiteOrUndef(s.roof);
        const ground = _finiteOrUndef(s.ground);
        const fence  = _finiteOrUndef(s.fence);
        if (roof === undefined && ground === undefined && fence === undefined) return undefined;
        return { roof: roof ?? 0, ground: ground ?? 0, fence: fence ?? 0 };
      })();
      const _roofData = (body.roofData && typeof body.roofData === 'object') ? body.roofData : undefined;
      const _roofAttach      = _finiteOrUndef(_roofData?.attachmentCount);
      const _roofRails       = _finiteOrUndef(_roofData?.railSections);
      const _fencePanelCount = _finiteOrUndef(body.fenceData?.fencePanelCount);

      const input: BOMGenerationInputV4 = {
        inverterId:         resolvedInverterId,
        optimizerId:        resolvedOptimizerId,
        // 🚨 THE PROJECT'S RECORDED COMBINER SELECTION
        // (projects.selected_equipment.combinerSelection, sent by the client).
        //
        // bom-engine-v4 has read `selectedCombinerId` at both of its integrated-
        // BOS call sites since the field was added, and NO PRODUCTION CALLER
        // EVER SET IT — this route builds the engine input and never looked for
        // it on the body. The engine therefore fell through to the catalogue
        // pairing on every real request, so the BOM the estimator priced and the
        // drawing the installer approved could name different hardware. A field
        // that only a test sets is not plumbing.
        selectedCombinerId: typeof body.selectedCombinerId === 'string' && body.selectedCombinerId.trim()
                              ? body.selectedCombinerId.trim()
                              : null,
      // HYBRID: V4's racking stage is roof-only by design — when the client sends
      // a roof subset (roofData.mountingSystemId), that id is the roof racking
      // authority even if the project-level rackingId is a fence/ground system.
      // Exactly ONE roof racking system per BOM. Precedence:
      //   roofData.mountingSystemId > body.rackingId > body.mountingSystemId
      // (a conflicting design_electrical rackingId like 'ironridge-xr100' must
      // never coexist with the config mounting system 'rooftech-mini').
      rackingId:          (typeof _roofData?.mountingSystemId === 'string' && _roofData.mountingSystemId)
                            ? _roofData.mountingSystemId
                            : (body.rackingId
                                ?? ((typeof body.mountingSystemId === 'string' && body.mountingSystemId)
                                      ? body.mountingSystemId : undefined)),
      batteryId:          body.batteryId,
      batteryCount:       Number(body.batteryCount) || undefined,  // C6 fix: was dropped → bom-engine forced battery qty to 1
      panelId:            body.panelId,
      moduleCount:        Number(body.moduleCount)        || Number(body.totalPanels) || 0,  // FIX: was defaulting to 20; now reads totalPanels as fallback
      deviceCount:        body.deviceCount !== undefined ? Number(body.deviceCount) : undefined,
      // Micro AC-branch count from the client's computeSystem (the SLD's
      // branches). Absent ⇒ the trunk-cable resolver's per-model estimate.
      branchCount:        Number(body.branchCount) > 0 ? Number(body.branchCount) : undefined,
      stringCount:       Number(body.stringCount)        || 2,
      // FIX v57.4: inverterCount safety guard.
      // For micro topology (stringCount=0), inverterCount is always 1 (system-level).
      // For optimizer topology (STRING_WITH_OPTIMIZER), inverterCount is the number
      // of central inverter UNITS -- optimizers are per-module, NOT per inverter.
      // For string topology, cap if inverterCount >= moduleCount (leaked value).
      //
      // FIX v57.5: EXTENDED OPTIMIZER GUARD.
      // The v57.4 guard only caught inverterCount >= moduleCount (e.g. 141 >= 141).
      // But a stale config can have inverterCount=36 for a 141-panel system (36 strings
      // x 1 string per inverter card, never "Apply"d through sizing engine).
      // 36 x SE11400H x $1,500 = $54,000 -- obviously wrong.
      // For optimizer topology, the physical max inverters = ceil(moduleCount / maxPPS).
      // SolarEdge maxPPS=25 -> max inverters for 141 panels = ceil(141/25) = 6.
      inverterCount: (() => {
        const rawInvCount  = Number(body.inverterCount) || 1;
        const rawModules   = Number(body.moduleCount) || Number(body.totalPanels) || 0;
        const rawStrings   = Number(body.stringCount) || 0;
        const topoType     = String(body.topologyType ?? '').toUpperCase();
        const isOptimizer  = topoType === 'STRING_WITH_OPTIMIZER' || topoType === 'OPTIMIZER';
        const isMicro      = topoType === 'MICROINVERTER' || topoType === 'MICRO' || rawStrings === 0;

        // Micro topology: always 1 system-level inverter entry
        if (isMicro) return 1;

        // Optimizer topology: inverterCount = number of central string inverter UNITS.
        // Per-module optimizers are NEVER counted as inverters.
        if (isOptimizer && rawModules > 0) {
          // Guard 1 (v57.4 / v58.6 fix): inverterCount >= moduleCount means string count leaked in.
          // v58.6: Use physMax = ceil(modules / OPTIMIZER_MAX_PPS) as the cap — NOT ceil(strings/2).
          // The old formula ceil(max(strings,2)/2) returned 18 for 36 strings (wrong for 1-inverter system).
          // physMax correctly returns ceil(36/25)=2 for 36 panels, which Guard 2 then further validates.
          if (rawInvCount >= rawModules) {
            const OPTIMIZER_MAX_PPS_G1 = 25;
            const cappedInvCount = Math.max(1, Math.ceil(rawModules / OPTIMIZER_MAX_PPS_G1));
            console.warn(
              `[BOM ROUTE] OPTIMIZER GUARD v1 (v58.6): inverterCount=${rawInvCount} >= moduleCount=${rawModules} ` +
              `for optimizer system (stringCount=${rawStrings}) - capping to physMax=${cappedInvCount} (ceil(${rawModules}/25))`
            );
            return cappedInvCount;
          }

          // Guard 2 (v57.5): inverterCount > physical max for optimizer topology.
          // Physical max inverters = ceil(moduleCount / OPTIMIZER_MAX_PPS).
          // Using maxPPS=25 (SolarEdge standard / conservative floor for all optimizer brands).
          // Example: ceil(141/25) = 6 max inverters. If we see 36, it is stale string-count.
          const OPTIMIZER_MAX_PPS = 25;
          const maxPhysicalInverters = Math.max(1, Math.ceil(rawModules / OPTIMIZER_MAX_PPS));
          if (rawInvCount > maxPhysicalInverters) {
            const finalCap = maxPhysicalInverters;
            console.warn(
              `[BOM ROUTE] OPTIMIZER GUARD v2: inverterCount=${rawInvCount} > physical max ${maxPhysicalInverters} ` +
              `(ceil(${rawModules}/${OPTIMIZER_MAX_PPS})) for optimizer system ` +
              `(stringCount=${rawStrings}, moduleCount=${rawModules}) - capping to ${finalCap}`
            );
            return finalCap;
          }
        }

        // String topology: if inverterCount >= moduleCount, moduleCount leaked in
        if (!isOptimizer && rawModules > 0 && rawInvCount >= rawModules && rawStrings > 0) {
          const cappedInvCount = Math.max(1, Math.ceil(rawStrings / 2));
          console.warn(
            `[BOM ROUTE] STRING GUARD: inverterCount=${rawInvCount} >= moduleCount=${rawModules} ` +
            `for string system (stringCount=${rawStrings}) - capping to ${cappedInvCount}`
          );
          return cappedInvCount;
        }
        return rawInvCount;
      })(),
      systemKw:           Number(body.systemKw)           || 8.0,
      dcWireGauge:        body.dcWireGauge        ?? '#10 AWG',
      // FIX: was '#8 AWG' hardcoded — wrong for 60A runs (need #6 AWG per NEC 310.16 75°C).
      // If frontend sends acWireGauge (from computed-system auto-sizer) use it; otherwise derive from OCPD.
      acWireGauge:        body.acWireGauge ?? (() => {
        const ocpd = Number(body.acOCPD) || Number(body.backfeedAmps) || 40;
        if (ocpd <= 40)  return '#8 AWG';
        if (ocpd <= 65)  return '#6 AWG';
        if (ocpd <= 85)  return '#4 AWG';
        if (ocpd <= 100) return '#3 AWG';
        return '#2 AWG';
      })(),
      dcWireLength:       Number(body.dcWireLength)       || 50,
      trenchRunLengthFt:  Number(body.trenchRunLengthFt)  || 0,  // buried ground/fence run → NEC 300.5 PVC conduit
      acWireLength:       Number(body.acWireLength)       || 60,
      conduitType:        body.conduitType        ?? 'EMT',
      conduitSizeInch:    body.conduitSizeInch    ?? '3/4',
      roofType:           body.roofType           ?? 'shingle',
      // HYBRID: roofData carries the roof SUBSET structural quantities. On a
      // fence/ground-typed hybrid the page historically sent 0 for these, which
      // suppressed the V4 roof racking lines entirely — the roofData values win
      // when present and > 0.
      attachmentCount:    (_roofAttach !== undefined && _roofAttach > 0) ? _roofAttach
                            : (body.attachmentCount !== undefined ? Number(body.attachmentCount) : 12),
      railSections:       (_roofRails !== undefined && _roofRails > 0) ? _roofRails
                            : (body.railSections !== undefined ? Number(body.railSections) : 4),
      // Phase 3 - Layout fields
      rowCount:           body.rowCount !== undefined ? Number(body.rowCount) : undefined,
      columnCount:        body.columnCount !== undefined ? Number(body.columnCount) : undefined,
      layoutOrientation:  body.layoutOrientation,
      // Trunk-cable install logic: sub-arrays force bridge splices; spliceAtRows
      // = installer cut-at-rows preference (vs cheapest-option service loop).
      subArrayCount:      body.subArrayCount !== undefined ? Number(body.subArrayCount) : undefined,
      spliceAtRows:       body.spliceAtRows === true,
      mainPanelAmps:      Number(body.mainPanelAmps)      || 200,
      backfeedAmps:       Number(body.backfeedAmps)       || 0,   // FIX: was 40A hardcoded default — now 0 forces correct calculation
      // 🚨 THE PV-ONLY FIGURE, AND ONLY WHEN THE CALLER STATES IT. `backfeedAmps` is
      // ambiguous across this route's callers — the engineering page's hybrid path sends
      // `cs.backfeedBreakerAmps`, which INCLUDES the battery branch, while its single-system
      // path sends a PV-only AC OCPD. NEC 705.12(B)'s allowance is a sum over every device
      // other than the main, so the BOM cannot subtract the battery from the allowance while
      // sizing against a figure that may already include it. Forwarded rather than guessed:
      // absent, the BOM sizes the breaker and declines to certify it
      // (`lib/nec/loadSideBackfeed.ts`).
      pvOnlyBackfeedA:    Number(body.pvOnlyBackfeedA) > 0 ? Number(body.pvOnlyBackfeedA) : undefined,
      acOCPD:             Number(body.acOCPD)             || 0,   // FIX: was 40A hardcoded default — frontend now sends correct value
      dcOCPD:             Number(body.dcOCPD)             || 20,
      jurisdiction:       body.jurisdiction,
      // 🚨 THE OTHER HALF OF THE INERT TOGGLE. The engineering page posts
      // `productionMeter`; this read `body.requiresProductionMeter`, which the
      // page has never sent, so `?? false` was FALSE on every request — the same
      // control the SLD route hard-wired to TRUE. The two routes disagreed about
      // the same switch and neither was listening to it. ONE key name now.
      requiresProductionMeter: readProductionMeterFlag(body, false),
      requiresACDisconnect:    body.requiresACDisconnect    ?? true,
      requiresDCDisconnect:    body.requiresDCDisconnect    ?? true,
      requiresRapidShutdown:   body.requiresRapidShutdown   ?? true,
      requiresWarningLabels:   body.requiresWarningLabels   ?? true,
      // Interconnection method — controls whether backfed breaker appears in BOM
      interconnectionMethod:   body.interconnectionMethod ?? body.interconnection ?? 'LOAD_SIDE',
      consumptionCtLocation:   typeof body.consumptionCtLocation === 'string' ? body.consumptionCtLocation : undefined,
      panelBusRating:          Number(body.panelBusRating) || Number(body.mainPanelAmps) || 200,
      runs:                    body.runs,
      // Pre-calculated quantities from ComputedSystem.bomQuantities (exact match with summary cards)
      bomQuantities:            body.bomQuantities,

      // System type — used for topology detection and merge layer routing
      systemType:               body.systemType,         // 'roof' | 'ground' | 'fence'
      // HYBRID (P3): per-mount-type panel partition. Drives NEC 690.12 RSD qty
      // for the ROOF subset inside generateBOMV4 even when the project's winning
      // systemType is fence/ground (Stowell: 51 on-roof modules need module-level
      // RSD despite the fence project tag).
      subSystemCounts:          _ssc,
      // HYBRID (P3): optional explicit roof-subset string/row count. When
      // absent the engine pro-rates project rows by the roof module share.
      roofStringCount:          _finiteOrUndef(_roofData?.stringCount),
      // fenceData/groundData still accepted for structural derivation (passed to merge layer)
      fenceData:                body.fenceData,
      groundData:               body.groundData,

      // Standby power — pass-through to BOMGenerationInputV4 (consumed by the
      // gen/ATS/BUI/whip emission blocks in bom-engine-v4.ts). All optional; the
      // engine emits no items when these are absent. Non-numeric payload values
      // drop to undefined (raw Number() let NaN flow into BOM item labels).
      generatorId:              body.generatorId,
      atsId:                    body.atsId,
      backupInterfaceId:        body.backupInterfaceId,
      generatorKw:              _finiteOrUndef(body.generatorKw),
      atsAmpRating:             _finiteOrUndef(body.atsAmpRating),
      backupInterfaceMaxA:      _finiteOrUndef(body.backupInterfaceMaxA),
      generatorWireLength:      _finiteOrUndef(body.generatorWireLength),
    };

    // MASTER TASK: Payload fields map 1:1 to SystemDefinition:
    //   systemType  → sd.systemType
    //   panelId     → sd.panel.id
    //   inverterId  → sd.electrical.inverterModel
    //   moduleCount → sd.layout.totalPanels
    //   systemKw    → sd.electrical.totalDcKw
    //   rackingId   → sd.structure.mountingSystemId
    //   roofType    → sd.structure.roofType
    // Full SystemDefinition integration deferred until engineering page uses CAD engine.
    console.log('[BOM API INPUT]', JSON.stringify(input, null, 2));

    // ── VALIDATION: Check inputs for consistency (warnings only, never blocking) ──
    const validation = validateBOMInputs({
      systemType: input.systemType,
      panelId: input.panelId,
      inverterId: input.inverterId,
      moduleCount: input.moduleCount,
      inverterCount: input.inverterCount,
      stringCount: input.stringCount,
      systemKw: input.systemKw,
      rackingId: input.rackingId,
      fenceData: input.fenceData,
      groundData: input.groundData,
      roofType: input.roofType,
      generatorId: input.generatorId,
      atsId: input.atsId,
      backupInterfaceId: input.backupInterfaceId,
    });
    if (validation.warnings.length > 0) {
      console.log('[BOM VALIDATION]', validation.warnings);
    }

    // ── STEP 1: V4 BOM — electrical only (STAGE 5b removed) ──
    const v4Result = generateBOMV4(input);

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 THE SERVICE-GRAPH EQUIPMENT, AND THE RECONCILIATION THAT PROVES IT.
    //
    // `generateBOMV4` builds racking, conductors, conduit and the PV equipment it knows about. It
    // has never known about a backup gateway, a per-system generation/combiner panel or an inline
    // utility isolation switch, because those are relationships in the graph rather than catalogue
    // picks on a project. `bomFromServiceTopology` has existed for exactly this and had ZERO
    // production callers — Ray: "The test named topologyReachesEveryOutput is not allowed to remain
    // a helper-level fiction."
    //
    // 🚨 THEN IT IS RECONCILED, NOT TRUSTED. `reconcileQuantities` compares what the lines say
    // against what the graph says, product by product. Ray's output-consistency law: "There must not
    // be drawing = 2, BOM = 1 ever again." A disagreement is REPORTED with both numbers — not
    // rounded toward the graph, not warned about once and forgotten — and travels in the response so
    // the BOM tab can show it.
    //
    // Deduplicated by part number: where the engine already emitted a product the graph also names,
    // the graph's instance count wins, because it counts things that exist.
    let _topologyBomLines = 0;
    const _quantityDisagreements: Array<{ productId: string; topology: number; consumer: number }> = [];
    if (_electrical?.model.topology) {
      try {
        const { bomFromServiceTopology, pricedQuantitiesFromBom } = await import('@/lib/bom/topologyBom');
        const { reconcileQuantities } = await import('@/lib/electrical/topologyEquipment');
        const _t = _electrical.model.topology;
        const _tBom = bomFromServiceTopology(_t);

        // 🚨 MATCHED ON PRODUCT IDENTITY, NOT ON THE PART-NUMBER STRING.
        //
        // Found by probing the real route output, and it was a double count I had just introduced:
        // `lib/bom-engine-v4.ts` keys its storage line by the CATALOGUE part number ('PW3-US') while
        // `lib/bom/topologyBom.ts` keys by the PRODUCT ID ('tesla-powerwall-3'). Comparing
        // partNumber to partNumber found no collision, so the sheet got four Powerwalls as PW3-US
        // AND four as tesla-powerwall-3 — eight cabinets on one BOM, both priced. That is exactly
        // the "duplicate battery counts" failure on Ray's own attack list, arriving through the fix
        // for it.
        //
        // Both sides fill `manufacturer` and `model` from the same catalogue, so that pair IS the
        // product identity and it bridges the two keying schemes.
        //
        // WHICH LINE SURVIVES: the ENGINE's. It carries the orderable catalogue part number and the
        // pricing hooks a distributor row matches on. The graph supplies the COUNT and the basis —
        // ownership exactly as Ray set it: the catalogue says which product, the graph says how many.
        const identity = (i: { partNumber: string; manufacturer?: string; model?: string }): string =>
          `${String(i.manufacturer ?? '').trim().toLowerCase()}|${String(i.model ?? '').trim().toLowerCase()}`;
        const _byPart = new Map(v4Result.items.map(i => [i.partNumber, i]));
        const _byIdentity = new Map<string, typeof v4Result.items[number]>();
        for (const i of v4Result.items) {
          const key = identity(i);
          // Only a real identity counts — a line with no manufacturer/model must not match another.
          if (key !== '|' && !_byIdentity.has(key)) _byIdentity.set(key, i);
        }

        const _added: typeof _tBom.items = [];
        for (const line of _tBom.items) {
          const prior = _byPart.get(line.partNumber)
            ?? (identity(line) !== '|' ? _byIdentity.get(identity(line)) : undefined);
          if (!prior) { _added.push(line); continue; }
          if (prior.partNumber !== line.partNumber) {
            console.log('[bom/POST] service-graph line folded into the engine\'s catalogue line:'
              + ` ${line.partNumber} → ${prior.partNumber}`
              + ` (same product: ${line.manufacturer} ${line.model})`);
          }
          if (prior.quantity !== line.quantity) {
            console.warn('[bom/POST] quantity corrected from the service graph:'
              + ` ${prior.partNumber} engine=${prior.quantity} graph=${line.quantity}`);
            prior.quantity = line.quantity;
            prior.derivedFrom = line.derivedFrom;
          }
        }
        if (_added.length > 0) {
          v4Result.items.push(..._added);
          v4Result.totalLineItems = v4Result.items.length;
          _topologyBomLines = _added.length;
          console.log('[bom/POST] service-graph equipment added:', _added.length, 'line(s) —',
            _added.map(i => `${i.partNumber}×${i.quantity}`).join(', '));
        }

        // 🚨 THE PROOF. Pricing multiplies these exact quantities, so if they disagree with the
        // graph, pricing disagrees with the drawing.
        _quantityDisagreements.push(...reconcileQuantities(_t, pricedQuantitiesFromBom(_tBom)));
        if (_quantityDisagreements.length > 0) {
          console.error('[bom/POST] 🚨 QUANTITY DISAGREEMENT — the BOM and the service graph do not'
            + ' agree:', _quantityDisagreements
              .map(d => `${d.productId}: graph=${d.topology} bom=${d.consumer}`).join('; '));
        }
      } catch (e) {
        console.warn('[bom/POST] service-graph BOM skipped (non-fatal):', (e as Error)?.message);
      }
    }

    // ── STEP 2: Structural BOM — fence/ground geometry (if applicable) ──
    // MASTER TASK: Inject structural items directly into V4 result, preserving
    // manufacturer/model/partNumber. V4 still owns electrical. Structural comes
    // from bom-system-profiles.ts (canonical SolFence/Unirac specs).
    const sysType = (input.systemType || 'roof') as BOMSystemType;
    let finalResult = v4Result;
    let structuralCount = 0;
    let overlapsSkipped: string[] = [];

    // HYBRID (P3): partition-aware structural derivation. When the client sends
    // subsystem fields (subSystemCounts / fenceData.fencePanelCount), the fence
    // AND ground branches each run for their own panel subset — a single project
    // may get SolFence sections AND ground piles. Legacy payloads (no subsystem
    // fields) reduce to the old single-branch call for sysType fence/ground.
    const hybridPartition = _ssc !== undefined || _fencePanelCount !== undefined;

    if (sysType !== 'roof' || hybridPartition) {
      try {
        const structuralResult = deriveStructuralBOMForSubsystems({
          systemType: sysType,
          moduleCount: input.moduleCount,
          subSystemCounts: _ssc,
          fencePanelCount: _fencePanelCount,
          fence: input.fenceData || undefined,
          ground: input.groundData || undefined,
        });

        console.log(`[BOM MERGE] ${sysType}${hybridPartition ? ' (hybrid partition)' : ''}: ` +
          `${structuralResult.items.length} structural items from profile ` +
          `(branches: ${structuralResult.subsystemsRun.join('+') || 'none'})`);
        if (structuralResult.derivationLog.length > 0) {
          console.log('[BOM MERGE] Structural derivation:', structuralResult.derivationLog);
        }

        // Capture overlaps for response (mirror injectStructuralIntoV4's rules:
        // in hybrid mode only the V4-owned check applies — roof racking lines and
        // ground-mount lines of the same category coexist intentionally)
        const v4Categories = new Set(v4Result.items.map(i => i.category));
        for (const si of structuralResult.items) {
          if (V4_OWNED_CATEGORIES.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (electrical authority)`);
          else if (!hybridPartition && v4Categories.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (existing item)`);
        }

        // Inject structural into V4 (preserves manufacturer/model/partNumber)
        finalResult = injectStructuralIntoV4(v4Result, structuralResult.items, hybridPartition);
        structuralCount = finalResult.totalLineItems - v4Result.totalLineItems;
        console.log(`[BOM MERGE] Final: ${finalResult.totalLineItems} items (V4=${v4Result.totalLineItems}, structural added=${structuralCount})`);
      } catch (mergeErr) {
        console.error('[BOM MERGE] Structural injection failed, returning V4-only:', mergeErr);
      }
    }

    // ================================================================
    // PHASE 9 — BRAND-DRIVEN SIZING ENGINE INTEGRATION
    // ================================================================
    // Flow:
    //   1. Run sizing engine to get canonical topology + requiredComponents.
    //   2. If topology != 'micro' → strip any micro-only items that leaked in.
    //   3. Adapter converts sizing.requiredComponents → StructuralBOMItem[],
    //      skipping V4-owned categories to avoid duplication.
    //   4. Inject adapter items via the existing merge helper.
    //   5. If sizing engine fails unexpectedly → fall back to legacy
    //      EcoFlow branch (backward compatibility safety net).
    //
    // HARD RULES enforced:
    //   - Battery only emitted when batteryEnabled === true (engine gate).
    //   - V4 still owns electrical counting/rendering from inverterId.
    //   - BOM does NOT infer brand/topology from string IDs anymore.
    // ================================================================
    let sizingEngineItemCount = 0;
    const microItemsRemoved: string[] = [];
    let sizingDebug: {
      brand?: string;
      topology?: string;
      componentCount?: number;
      skippedV4Owned?: number;
      warnings?: number;
      fallbackUsed?: boolean;
    } = {};
    let sizingResult: SystemSizingResult | null = null;

    try {
      // ── 1. Run sizing engine ───────────────────────────────────────
      const panelWattage = input.moduleCount > 0
        ? Math.max(50, Math.round((input.systemKw * 1000) / input.moduleCount))
        : 400;
      const batteryEnabledFlag = Boolean(body.batteryEnabled);

      sizingResult = sizeSystemFromBrand({
        systemType: (input.systemType ?? 'roof') as 'roof' | 'ground' | 'fence',
        panelCount: input.moduleCount,
        panelWattage,
        selectedInverterId: input.inverterId,
        batteryEnabled: batteryEnabledFlag,
        batteryMode: body.batteryMode === 'manual' ? 'manual' : 'auto',
        batteryGoal: (body.batteryGoal ?? 'backup') as 'backup' | 'self_consumption' | 'max_energy',
        batteryTargetKwh: body.targetBatteryKwh ?? (body.batteryKwh ? Number(body.batteryKwh) : undefined),
        batteryUsePro: Boolean(body.batteryUsePro),
      });

      sizingDebug = {
        brand: sizingResult.brand.id,
        topology: sizingResult.topology,
        componentCount: sizingResult.requiredComponents.length,
        warnings: sizingResult.warnings.length,
      };

      console.log(
        `[SIZING ENGINE] brand=${sizingResult.brand.id} ` +
        `topology=${sizingResult.topology} ` +
        `components=${sizingResult.requiredComponents.length} ` +
        `warnings=${sizingResult.warnings.length}`,
      );

      // ── 2. Micro-strip (topology-gated, brand-agnostic) ────────────
      if (shouldStripMicroItems(sizingResult)) {
        const beforeCount = finalResult.items.length;
        const keptItems: BOMLineItemV4[] = [];
        for (const item of finalResult.items) {
          if (MICRO_ONLY_CATEGORIES.has(item.category)) {
            microItemsRemoved.push(`${item.category}: ${item.model ?? item.description ?? item.id}`);
            continue;
          }
          keptItems.push(item);
        }
        if (beforeCount !== keptItems.length) {
          const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
          for (const it of keptItems) {
            if (!stageMap.has(it.stageId)) stageMap.set(it.stageId, []);
            stageMap.get(it.stageId)!.push(it);
          }
          const newStages: BOMStageResult[] = finalResult.stages.map(s => ({
            ...s,
            items: stageMap.get(s.id) ?? [],
            itemCount: (stageMap.get(s.id) ?? []).length,
          }));
          finalResult = {
            ...finalResult,
            items: keptItems,
            stages: newStages,
            totalLineItems: keptItems.length,
          };
          console.log(
            `[SIZING ENGINE] Stripped ${microItemsRemoved.length} micro-only items ` +
            `(topology=${sizingResult.topology}):`,
            microItemsRemoved,
          );
        }
      }

      // ── 3. Adapter: sizing.requiredComponents → injectable BOM items ─
      const adapterResult = sizingResultToBomItems(sizingResult);

      // Deduplicate candidate battery item vs V4-owned battery line.
      // If V4 already received batteryId → V4 emitted a battery line →
      // drop the adapter's battery candidate to avoid double-counting.
      let adapterItems = adapterResult.items;
      const v4HasBattery = finalResult.items.some(i => i.category === 'battery');
      if (v4HasBattery) {
        adapterItems = adapterItems.filter(i => i.category !== 'battery');
      }

      sizingDebug.skippedV4Owned = adapterResult.skippedV4Owned.length;

      // ── 4. Inject via the existing structural merge helper ─────────
      if (adapterItems.length > 0) {
        finalResult = injectStructuralIntoV4(finalResult, adapterItems);
        sizingEngineItemCount = adapterItems.length;
        console.log(`[SIZING ENGINE] Injected ${sizingEngineItemCount} BOS items from sizing engine`);
      }
    } catch (sizingErr) {
      // ── 5. Fallback: preserve legacy EcoFlow behavior ───────────────
      console.error('[SIZING ENGINE] Failed, falling back to legacy EcoFlow path:', sizingErr);
      sizingDebug.fallbackUsed = true;

      if (isEcoFlowInverter(input.inverterId)) {
        try {
          const beforeCount = finalResult.items.length;
          const keptItems: BOMLineItemV4[] = [];
          for (const item of finalResult.items) {
            if (MICRO_ONLY_CATEGORIES.has(item.category)) {
              microItemsRemoved.push(`${item.category}: ${item.model ?? item.description ?? item.id}`);
              continue;
            }
            keptItems.push(item);
          }
          if (beforeCount !== keptItems.length) {
            const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
            for (const it of keptItems) {
              if (!stageMap.has(it.stageId)) stageMap.set(it.stageId, []);
              stageMap.get(it.stageId)!.push(it);
            }
            const newStages: BOMStageResult[] = finalResult.stages.map(s => ({
              ...s,
              items: stageMap.get(s.id) ?? [],
              itemCount: (stageMap.get(s.id) ?? []).length,
            }));
            finalResult = {
              ...finalResult,
              items: keptItems,
              stages: newStages,
              totalLineItems: keptItems.length,
            };
          }
          const batteryEnabled = Boolean(body.batteryEnabled);
          const ecoResult = deriveEcoFlowBOM({
            inverterId: input.inverterId,
            batteryEnabled,
            targetBatteryKwh: body.targetBatteryKwh ?? (body.batteryKwh ? Number(body.batteryKwh) : undefined),
            usePro: Boolean(body.batteryUsePro),
            moduleCount: input.moduleCount,
          });
          if (ecoResult.items.length > 0) {
            finalResult = injectStructuralIntoV4(finalResult, ecoResult.items);
            sizingEngineItemCount = ecoResult.items.length;
          }
        } catch (ecoErr) {
          console.error('[LEGACY ECOFLOW FALLBACK] Also failed:', ecoErr);
        }
      }
    }
    // ================================================================
    // END PHASE 9 INTEGRATION
    // ================================================================

    // ================================================================
    // DISTRIBUTOR PRICING — stamp unitCost + totalCost onto every line item
    // Resolution: DB overrides → static catalog → category fallback → zero
    // Wrapped in try/catch — pricing failure must never block BOM delivery.
    // ================================================================
    let pricingResult: ReturnType<typeof applyDistributorPricing> | null = null;
    try {
      const { getDbReady } = await import('@/lib/db-neon');
      let dbOverrides: DistributorPriceOverride[] = [];
      try {
        const sql = await getDbReady();
        const userId = _auth.user?.id ?? null;
        const overrideRows = await sql`
          SELECT part_number, category, unit_cost
          FROM distributor_prices
          WHERE active = TRUE
            AND (user_id IS NULL OR user_id = ${userId}::uuid)
          ORDER BY
            CASE WHEN user_id IS NULL THEN 1 ELSE 0 END
        `;
        dbOverrides = overrideRows.map(r => ({
          partNumber: r.part_number as string,
          category:   r.category   as string | undefined,
          unitCost:   Number(r.unit_cost),
        }));
      } catch (dbErr) {
        console.warn('[BOM PRICING] DB override fetch failed, using catalog only:', dbErr);
      }

      pricingResult = applyDistributorPricing(finalResult.items, dbOverrides);

      const pricedStageMap = new Map<string, typeof pricingResult.items>();
      for (const item of pricingResult.items) {
        if (!pricedStageMap.has(item.stageId)) pricedStageMap.set(item.stageId, []);
        pricedStageMap.get(item.stageId)!.push(item);
      }
      finalResult = {
        ...finalResult,
        items: pricingResult.items,
        totalCost: pricingResult.totalBomCost,
        stages: finalResult.stages.map(s => ({
          ...s,
          items: pricedStageMap.get(s.id) ?? s.items,
        })),
      };

      console.log(
        `[BOM PRICING] catalog=${pricingResult.catalogMatches} ` +
        `overrides=${pricingResult.overrideMatches} ` +
        `fallback=${pricingResult.fallbackMatches} ` +
        `unpriced=${pricingResult.unpriced} ` +
        `total=$${pricingResult.totalBomCost.toFixed(2)}`,
      );
    } catch (pricingErr) {
      console.error('[BOM PRICING] Pricing step failed, returning unpriced BOM:', pricingErr);
    }
    // ================================================================
    // END DISTRIBUTOR PRICING
    // ================================================================

    // Format & Return
    const format = body.format ?? 'json';

    if (format === 'csv') {
      return new NextResponse(bomToCSV(finalResult), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bom.csv"' },
      });
    }
    if (format === 'markdown') {
      return new NextResponse(bomToMarkdown(finalResult), {
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    return NextResponse.json({
      success: true,
      bom: finalResult,
      summary: {
        topology: finalResult.topology,
        topologyLabel: finalResult.topologyLabel,
        totalLineItems: finalResult.totalLineItems,
        stageCount: finalResult.stages.filter(s => s.itemCount > 0).length,
        complianceNotes: finalResult.complianceNotes,
        warnings: [...finalResult.warnings, ...validation.warnings],
      },
      // 🚨 THE ELECTRICAL STATE THIS BOM WAS BUILT FROM, and whether it agrees with the graph.
      // `quantityDisagreements` is empty on a healthy project; non-empty it is a failure somebody
      // has to resolve, which is why it is reported rather than silently corrected.
      electrical: _electrical ? {
        revision: _electrical.revision,
        coupling: _electrical.model.solarCoupling,
        storageUnits: _electrical.model.storage.invertingUnitCount,
        expansionUnits: _electrical.model.storage.expansionUnitCount,
        gateways: _electrical.model.storage.gatewayCount,
        generationPanels: _electrical.model.storage.perSystemGenerationPanelCount,
        topologyBomLines: _topologyBomLines,
        quantityDisagreements: _quantityDisagreements,
        conflicts: _electrical.model.conflicts,
      } : undefined,
      merge: (sysType !== 'roof' || hybridPartition) ? {
        v4ItemCount: v4Result.totalLineItems,
        structuralItemCount: structuralCount,
        totalItemCount: finalResult.totalLineItems,
        overlapsSkipped,
      } : undefined,
      // Phase 9: sizing-engine debug + back-compat ecoflow field
      sizing: sizingResult ? {
        brand: sizingResult.brand,
        topology: sizingResult.topology,
        inverterCount: sizingResult.inverterCount,
        microDeviceCount: sizingResult.microDeviceCount,
        battery: sizingResult.battery,
        itemsInjected: sizingEngineItemCount,
        microItemsRemoved,
        componentCount: sizingResult.requiredComponents.length,
        warnings: sizingResult.warnings,
        fallbackUsed: sizingDebug.fallbackUsed ?? false,
      } : undefined,
      // Backward-compat: preserve ecoflow field shape for existing clients.
      ecoflow: isEcoFlowInverter(input.inverterId) ? {
        inverterId: input.inverterId,
        itemsInjected: sizingEngineItemCount,
        microItemsRemoved,
      } : undefined,
      validation: {
        warnings: validation.warnings,
        checks: validation.checks,
      },
      // Distributor pricing summary
      pricing: pricingResult ? {
        totalBomCost:     pricingResult.totalBomCost,
        catalogMatches:   pricingResult.catalogMatches,
        overrideMatches:  pricingResult.overrideMatches,
        fallbackMatches:  pricingResult.fallbackMatches,
        unpriced:         pricingResult.unpriced,
        pricingApplied:   true,
      } : {
        pricingApplied: false,
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/bom/route.ts]', err);
  }
}
