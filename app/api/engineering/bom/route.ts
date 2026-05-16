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
import { deriveStructuralBOM, type BOMSystemType, type StructuralBOMItem } from '@/lib/bom-system-profiles';
import type { BOMGenerationResultV4, BOMLineItemV4, BOMStageResult, BOMStageId } from '@/lib/bom-engine-v4';
import { validateBOMInputs } from '@/lib/bom-validation';
import { deriveEcoFlowBOM, MICRO_ONLY_CATEGORIES } from '@/lib/ecoflow-bom';
import { isEcoFlowInverter } from '@/lib/ecoflow-system';
import { requireAuth } from '@/lib/security';
// Phase 9 — brand-driven sizing engine integration
import { sizeSystemFromBrand, type SystemSizingResult } from '@/lib/system/sizingEngine';
import { sizingResultToBomItems, shouldStripMicroItems } from '@/lib/system/sizingToBom';
import { applyDistributorPricing, type DistributorPriceOverride } from '@/lib/bom/distributorPricing';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

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
    if (v4Categories.has(si.category)) {
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

      const input: BOMGenerationInputV4 = {
        inverterId:         resolvedInverterId,
        optimizerId:        resolvedOptimizerId,
      rackingId:          body.rackingId,
      batteryId:          body.batteryId,
      panelId:            body.panelId,
      moduleCount:        Number(body.moduleCount)        || Number(body.totalPanels) || 0,  // FIX: was defaulting to 20; now reads totalPanels as fallback
      deviceCount:        body.deviceCount !== undefined ? Number(body.deviceCount) : undefined,
      stringCount:        Number(body.stringCount)        || 2,
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
      acWireLength:       Number(body.acWireLength)       || 60,
      conduitType:        body.conduitType        ?? 'EMT',
      conduitSizeInch:    body.conduitSizeInch    ?? '3/4',
      roofType:           body.roofType           ?? 'shingle',
      attachmentCount:    body.attachmentCount !== undefined ? Number(body.attachmentCount) : 12,
      railSections:       body.railSections !== undefined ? Number(body.railSections) : 4,
      // Phase 3 - Layout fields
      rowCount:           body.rowCount !== undefined ? Number(body.rowCount) : undefined,
      columnCount:        body.columnCount !== undefined ? Number(body.columnCount) : undefined,
      layoutOrientation:  body.layoutOrientation,
      mainPanelAmps:      Number(body.mainPanelAmps)      || 200,
      backfeedAmps:       Number(body.backfeedAmps)       || 0,   // FIX: was 40A hardcoded default — now 0 forces correct calculation
      acOCPD:             Number(body.acOCPD)             || 0,   // FIX: was 40A hardcoded default — frontend now sends correct value
      dcOCPD:             Number(body.dcOCPD)             || 20,
      jurisdiction:       body.jurisdiction,
      requiresProductionMeter: body.requiresProductionMeter ?? false,
      requiresACDisconnect:    body.requiresACDisconnect    ?? true,
      requiresDCDisconnect:    body.requiresDCDisconnect    ?? true,
      requiresRapidShutdown:   body.requiresRapidShutdown   ?? true,
      requiresWarningLabels:   body.requiresWarningLabels   ?? true,
      // Interconnection method — controls whether backfed breaker appears in BOM
      interconnectionMethod:   body.interconnectionMethod ?? body.interconnection ?? 'LOAD_SIDE',
      panelBusRating:          Number(body.panelBusRating) || Number(body.mainPanelAmps) || 200,
      runs:                    body.runs,
      // Pre-calculated quantities from ComputedSystem.bomQuantities (exact match with summary cards)
      bomQuantities:            body.bomQuantities,

      // System type — used for topology detection and merge layer routing
      systemType:               body.systemType,         // 'roof' | 'ground' | 'fence'
      // fenceData/groundData still accepted for structural derivation (passed to merge layer)
      fenceData:                body.fenceData,
      groundData:               body.groundData,
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
    });
    if (validation.warnings.length > 0) {
      console.log('[BOM VALIDATION]', validation.warnings);
    }

    // ── STEP 1: V4 BOM — electrical only (STAGE 5b removed) ──
    const v4Result = generateBOMV4(input);

    // ── STEP 2: Structural BOM — fence/ground geometry (if applicable) ──
    // MASTER TASK: Inject structural items directly into V4 result, preserving
    // manufacturer/model/partNumber. V4 still owns electrical. Structural comes
    // from bom-system-profiles.ts (canonical SolFence/Unirac specs).
    const sysType = (input.systemType || 'roof') as BOMSystemType;
    let finalResult = v4Result;
    let structuralCount = 0;
    let overlapsSkipped: string[] = [];

    if (sysType !== 'roof') {
      try {
        const structuralResult = deriveStructuralBOM({
          systemType: sysType,
          moduleCount: input.moduleCount,
          fence: input.fenceData || undefined,
          ground: input.groundData || undefined,
        });

        console.log(`[BOM MERGE] ${sysType}: ${structuralResult.items.length} structural items from profile`);

        // Capture overlaps for response
        const v4Categories = new Set(v4Result.items.map(i => i.category));
        for (const si of structuralResult.items) {
          if (V4_OWNED_CATEGORIES.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (electrical authority)`);
          else if (v4Categories.has(si.category)) overlapsSkipped.push(`${si.category}: V4 wins (existing item)`);
        }

        // Inject structural into V4 (preserves manufacturer/model/partNumber)
        finalResult = injectStructuralIntoV4(v4Result, structuralResult.items);
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
      merge: sysType !== 'roof' ? {
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
