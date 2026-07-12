// ============================================================
// POST /api/engineering/sld
// Professional SLD generation — BUILD v25 — Single Source of Truth
// Last updated: 2026-03-11 — computeSystem() → PermitSystemModel → renderer
//
// ARCHITECTURE (v25 — Single Source of Truth):
//   computeSystem() → PermitSystemModel → renderSLDProfessional()
//
//   computeSystem() is called ONCE. All electrical values (OCPD,
//   wire gauges, backfeed breaker, EGC) come from the engine via
//   PermitSystemModel. No duplicate NEC calculations in this file.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { getInverterById } from '@/lib/equipment-db';
import { computeSystem, type ComputedSystemInput, type ComputedSystem } from '@/lib/computed-system';
import { buildPermitSystemModel, type PermitSystemModel } from '@/lib/plan-set/permit-system-model';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '@/lib/string-generator';
import {
  getBackupInterfaceById,
  getBatteryById,
  getGeneratorById,
} from '@/lib/equipment-db';
import { requireAuth } from '@/lib/security';
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';
import { sizeSystemFromBrand, type SystemSizingResult } from '@/lib/system/sizingEngine';
import type { LayoutCandidate } from '@/lib/system/inverterCapabilities';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { parseRunId } from '@/lib/computed-multi-system';

// ── Wave 3.7 — versioned client-passthrough guard (contract §3 Wave 3 item 7)
// A per-subsystem-aware client (engineering_config schemaVersion 2) namespaces
// per-sub run ids `${sub}:${RunSegmentId}` at N>1. This route's renderer keys
// off BARE ids; when the compute-failure fallback consumes client-passed runs,
// namespaced ids must resolve to the PRIMARY sub's runs (fixed roof > ground >
// fence order — first prefix seen wins) + the shared service runs, re-keyed to
// base ids — never a silent resolve-to-nothing (I-8). Legacy bare-id payloads
// pass through IDENTICALLY (same array reference).
function sanitizeClientRuns<T extends { id: string }>(runs: T[] | undefined | null): T[] | undefined {
  if (!Array.isArray(runs) || runs.length === 0) return runs ?? undefined;
  const RANK: Record<string, number> = { roof: 0, ground: 1, fence: 2 };
  let primary: string | null = null;
  for (const r of runs) {
    const { subSystem } = parseRunId(String(r?.id ?? ''));
    if (subSystem && (primary === null || RANK[subSystem] < RANK[primary])) primary = subSystem;
  }
  if (primary === null) return runs; // legacy bare-id payload — untouched by reference
  console.warn('[SLD] hybrid client passthrough detected — resolving primary-sub runs to bare ids (Wave 3.7 guard)');
  return runs.flatMap(r => {
    const parsed = parseRunId(String(r?.id ?? ''));
    if (parsed.subSystem === null) return [r];
    if (parsed.subSystem === primary) return [{ ...r, id: parsed.baseId } as T];
    return [];
  });
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

    // Handle both old field names (inverterKw, inverterModel as combined string)
    // and new field names (acOutputKw, inverterManufacturer + inverterModel separate)
    // NOTE: acOutputKw is re-declared below after B3 sizing — this value is the body fallback.
    const _bodyAcOutputKw = Number(body.acOutputKw || body.inverterKw || (body.acOutputW ? body.acOutputW / 1000 : 0) || 8.2);

    // If inverterModel contains manufacturer (e.g. "Fronius Primo 8.2-1"), split it
    let inverterManufacturer = String(body.inverterManufacturer ?? '');
    let inverterModel = String(body.inverterModel ?? '');
    if (!inverterManufacturer && inverterModel.includes(' ')) {
      const parts = inverterModel.split(' ');
      inverterManufacturer = parts[0];
      inverterModel = parts.slice(1).join(' ');
    }
    // Default manufacturer based on topology
    const topoForDefault = String(body.topologyType ?? 'STRING_INVERTER');
    if (!inverterManufacturer) {
      inverterManufacturer = topoForDefault === 'MICROINVERTER' ? 'Enphase' : 'Fronius';
    }
    if (!inverterModel) {
      inverterModel = topoForDefault === 'MICROINVERTER' ? 'IQ8+' : 'Primo 8.2-1';
    }

    // Derive AC output amps if not provided — uses _bodyAcOutputKw here since acOutputKw
    // is resolved later (after B3 sizing engine call). Re-resolved after B3 block if needed.
    const acOutputAmps = Number(body.acOutputAmps) || Math.round(_bodyAcOutputKw * 1000 / 240);

    // Wire length
    const acWireLength = Number(body.acWireLength || body.wireLength) || 60;

    const totalModules = Number(body.totalModules) || 20;
    const panelVoc     = Number(body.panelVoc)     || 49.6;
    const panelIsc     = Number(body.panelIsc)     || 10.18;
    const panelVmp     = Number(body.panelVmp)     || 41.8;
    const panelImp     = Number(body.panelImp)     || 9.57;
    const panelWatts   = Number(body.panelWatts)   || 400;
    const designTempMin = Number(body.designTempMin ?? -10);
    // Phase 7 Topology Fix: body.topologyType is the INITIAL value from the client.
    // It may be STALE (e.g. 'MICROINVERTER' from a previous APsystems project when
    // the user has since switched to SolarEdge optimizer).
    // After sizeSystemFromBrand() runs, we override with sizingResult.topology
    // (the canonical brand-profile topology). See _canonicalTopologyType below.
    const _bodyTopologyType = String(body.topologyType ?? 'STRING_INVERTER');
    // Temporary booleans from body — will be re-derived after sizingResult
    let topologyType  = _bodyTopologyType;
    let isMicro       = _bodyTopologyType === 'MICROINVERTER';
    // v47.410 — Distinguish optimizer vs plain-string topology so ComputedSystem
    // can apply NEC 690.8(A)(2) to conductor/OCPD sizing for SolarEdge/Tigo
    // systems. Prior to v47.410 both collapsed to 'string', which caused the
    // SLD to print panel-Isc ampacity for optimizer systems.
    let isOptimizer   = _bodyTopologyType === 'OPTIMIZER' || _bodyTopologyType === 'STRING_OPTIMIZER'
                     || _bodyTopologyType === 'STRING_WITH_OPTIMIZER';

    // Auto String Generation (NEC 690.7)
    // SKIP for microinverter topology -- micros convert DC->AC at each panel, no DC strings
    const maxDcVoltage      = Number(body.inverterMaxDcV || body.maxDcVoltage) || 600;
    const mpptVoltageMin    = Number(body.mpptVoltageMin)    || 100;
    const mpptVoltageMax    = Number(body.mpptVoltageMax)    || 600;
    const mpptChannels      = Number(body.mpptChannels)      || 2;
    const maxInputCurrentPerMppt = Number(body.maxInputCurrentPerMppt) || undefined;
    // v47.415 — nominal DC bus voltage for optimizer operating-current math
    const nominalDcVoltage = Number(body.nominalDcVoltage) || undefined;
    // Phase 13.4 — explicit parallel-strings cap per MPPT (from inverter model).
    // When undefined, the allocator defaults to the safe value of 1.
    const maxParallelStringsPerMppt = Number(body.maxParallelStringsPerMppt) || undefined;
    // v47.420 — brand profile ceiling for optimizer topology string length
    const maxPanelsPerString = Number(body.maxPanelsPerString) || undefined;
    const tempCoeffVoc      = Number(body.tempCoeffVoc)      || -0.27;
    const tempCoeffVmp      = Number(body.tempCoeffVmp)      || undefined;
    const maxSeriesFuse     = Number(body.maxSeriesFuse)     || 20;
    const deviceCount       = Number(body.deviceCount)       || totalModules;

    // ─────────────────────────────────────────────────────────────────────────
    // Phase B3 — SLD Truth Alignment
    // Call sizeSystemFromBrand() using the same inputs as the UI so the SLD
    // reflects the SAME LayoutCandidate the engineering page already shows.
    // When a valid layoutCandidate is obtained its inverter count, string
    // layout, and AC output override the independently-derived body values.
    // Falls back transparently to the existing generateStringConfig() path.
    // ─────────────────────────────────────────────────────────────────────────
    let sizingResult: SystemSizingResult | null = null;
    let layoutCandidate: LayoutCandidate | null = null;
    let sldDegraded = false;

    const _selectedBrand     = body.selectedBrand      ? String(body.selectedBrand)      : undefined;
    const _selectedInvId     = body.selectedInverterId  ? String(body.selectedInverterId)  : undefined;
    const _panelId           = body.panelId             ? String(body.panelId)             : undefined;
    const _systemType        = body.systemType          ? String(body.systemType)          : 'roof';

    if (totalModules > 0 && (_selectedBrand || _selectedInvId)) {
      try {
        sizingResult = sizeSystemFromBrand({
          systemType:         _systemType as any,
          panelCount:         totalModules,
          panelWattage:       panelWatts,
          panelVoc:           panelVoc,
          panelIsc:           panelIsc,
          panelVmp:           panelVmp,
          panelTempCoeffVoc:  Number(body.panelTempCoeffVoc ?? body.tempCoeffVoc ?? -0.27),
          designTempMin:      designTempMin,
          selectedBrand:      _selectedBrand,
          selectedInverterId: _selectedInvId,
          panelId:            _panelId,
          // Battery fields — required for sizing engine to include battery in result.
          // Previously omitted, causing the engine to return no-battery result even when
          // the user had configured a battery system.
          batteryEnabled:       body.batteryEnabled === true || body.batteryEnabled === 'true'
                                || !!(body.hasBattery || body.batteryModel || body.batteryKwh || body.batteryBrand || body.batteryId),
          batteryMode:          body.batteryMode ? String(body.batteryMode) as any : undefined,
          batteryGoal:          body.batteryGoal ? String(body.batteryGoal) as any : undefined,
          batteryTargetKwh:     body.batteryTargetKwh ? Number(body.batteryTargetKwh) : undefined,
          selectedBatteryBrand: body.selectedBatteryBrand ? String(body.selectedBatteryBrand)
                                : (body.batteryBrand ? String(body.batteryBrand) : undefined),
          batteryUsePro:        body.batteryUsePro === true || body.batteryUsePro === 'true',
        });
        layoutCandidate = sizingResult.selectedLayoutCandidate ?? null;
        console.log('[SLD B3] sizeSystemFromBrand success:', {
          inverterCount:  sizingResult.inverterCount,
          strings:        sizingResult.strings.length,
          totalAcKw:      layoutCandidate?.totalAcKw ?? sizingResult.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0),
          hasCandidate:   !!layoutCandidate,
        });
      } catch (szErr) {
        sldDegraded = true;
        console.warn('[SLD B3] sizeSystemFromBrand failed — falling back to body values:', szErr);
      }
    } else {
      sldDegraded = true;
      console.warn('[SLD B3] No selectedBrand/selectedInverterId in request — SLD layout derived from body only');
    }

    // ── Canonical topology override (Phase 7 Topology Fix) ──────────────────
    // sizingResult.topology is authoritative: it comes from the brand profile
    // (e.g. solaredge → 'optimizer', enphase → 'micro', fronius → 'string').
    // body.topologyType may be stale (e.g. 'MICROINVERTER' from prev project).
    // Priority: sizingResult.topology > body.topologyType
    if (sizingResult?.topology) {
      const _engTopo = sizingResult.topology; // 'optimizer' | 'micro' | 'string' | 'hybrid'
      const _bodyIsMicro = _bodyTopologyType === 'MICROINVERTER';
      const _bodyIsOpt   = _bodyTopologyType === 'OPTIMIZER'
                        || _bodyTopologyType === 'STRING_OPTIMIZER'
                        || _bodyTopologyType === 'STRING_WITH_OPTIMIZER';
      // Only override when engine contradicts body (prevents false override when body is correct)
      if (_engTopo === 'optimizer' && _bodyIsMicro) {
        topologyType = 'STRING_WITH_OPTIMIZER';
        isMicro      = false;
        isOptimizer  = true;
        console.warn('[SLD TOPOLOGY OVERRIDE] body=MICROINVERTER overridden by engine=optimizer' +
          ' (selectedBrand=' + (_selectedBrand ?? 'none') + ')' +
          ' — stale micro config replaced with optimizer_string');
      } else if (_engTopo === 'string' && (_bodyIsMicro || _bodyIsOpt)) {
        topologyType = 'STRING_INVERTER';
        isMicro      = false;
        isOptimizer  = false;
        console.warn('[SLD TOPOLOGY OVERRIDE] body=' + _bodyTopologyType + ' overridden by engine=string' +
          ' (selectedBrand=' + (_selectedBrand ?? 'none') + ')');
      } else if (_engTopo === 'micro' && !_bodyIsMicro) {
        topologyType = 'MICROINVERTER';
        isMicro      = true;
        isOptimizer  = false;
        console.warn('[SLD TOPOLOGY OVERRIDE] body=' + _bodyTopologyType + ' overridden by engine=micro' +
          ' (selectedBrand=' + (_selectedBrand ?? 'none') + ')');
      } else {
        // Body and engine agree — no override needed
        console.log('[SLD TOPOLOGY] body=' + _bodyTopologyType + ' engine=' + _engTopo + ' — agree, no override');
      }
    } else {
      // No sizingResult — warn but keep body value
      if (_bodyTopologyType === 'MICROINVERTER') {
        // If body says micro but brand suggests optimizer, guard against contamination
        const _brandIsOptimizer = !!(_selectedBrand && ['solaredge', 'tigo', 'huawei-optimizer'].includes(_selectedBrand.toLowerCase()));
        if (_brandIsOptimizer) {
          topologyType = 'STRING_WITH_OPTIMIZER';
          isMicro      = false;
          isOptimizer  = true;
          console.warn('[SLD TOPOLOGY GUARD] No sizingResult but selectedBrand=' + _selectedBrand +
            ' is optimizer brand — body MICROINVERTER overridden to STRING_WITH_OPTIMIZER');
        }
      }
    }
    // Log final canonical topology
    console.log('[SLD TOPOLOGY TRACE] stage=route_final' +
      ' bodyTopology=' + _bodyTopologyType +
      ' canonicalTopology=' + topologyType +
      ' isMicro=' + isMicro +
      ' isOptimizer=' + isOptimizer +
      ' selectedBrand=' + (_selectedBrand ?? 'none') +
      ' engineTopology=' + (sizingResult?.topology ?? 'none'));

    // Resolved layout values: prefer sizing-engine truth, fall back to body
    const layoutInverterCount = sizingResult?.inverterCount ?? null;
    const layoutStrings       = sizingResult?.strings        ?? null;
    const layoutTotalAcKw     = layoutCandidate?.totalAcKw
      ?? (sizingResult ? sizingResult.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0) : null);
    const layoutMicroCount    = sizingResult?.microDeviceCount ?? null;

    // ── Ecosystem truth: optimizerQty + integratedDcDisconnect ──
    const _optimizerComponent = sizingResult?.requiredComponents?.find(c => c.category === 'optimizer');
    const _resolvedOptimizerQty: number | undefined =
      _optimizerComponent?.qty
      ?? (isOptimizer ? totalModules : undefined);

    const _invSpec = _selectedInvId ? getInverterById(_selectedInvId) : undefined;
    const _integratedDcDisconnect: boolean =
      _invSpec?.integratedDcDisconnect === true
      || (isOptimizer && !_selectedInvId);

    const _optimizerModel: string | undefined = _optimizerComponent?.equipmentDbId
      ? _optimizerComponent.equipmentDbId.toUpperCase().replace(/^SE-?/i, '')
      : undefined;

      // Phase 3.6 — Derive acRequiresNeutral from inverter output voltage spec
      // FIX v58.17: 240V split-phase US residential DOES require a neutral conductor
      // (L1+L2+N+EGC) because the AC output supplies both 240V (L1-L2) and 120V (L1-N, L2-N)
      // loads. NEC 200.3 and 310.15 require the neutral for all residential feeders.
      // We no longer hard-code false for 240V. Instead we leave acRequiresNeutral=undefined
      // so the renderer defers to the topology-engine run data (neutralRequired=true) which
      // is already correctly set by computed-system.ts for all string/micro/hybrid topologies.
      // Explicit override only for 208V 3-phase commercial systems (not residential).
      const _acOutputVoltage: number | undefined = _invSpec?.acOutputVoltage;
      const _acRequiresNeutral: boolean | undefined =
        _acOutputVoltage === 208 ? true  // 208V wye — always needs neutral
        : undefined; // 240V split-phase: defer to topology engine run data (neutralRequired=true)

    console.log('[SLD TRUTH CHECK] stage=route selectedBrand=' + (_selectedBrand ?? 'none') +
      ' topology=' + topologyType + ' (isOptimizer=' + isOptimizer + ' isMicro=' + isMicro + ')' +
      ' optimizerQty=' + (_resolvedOptimizerQty ?? 0) +
      ' integratedDcDisconnect=' + _integratedDcDisconnect +
      ' stringCount=' + (layoutStrings?.length ?? 0) +
      ' batteryQty=' + (sizingResult?.battery ? 1 : 0));

    // Override acOutputKw when the sizing engine gives a cleaner value
    const acOutputKw: number = layoutTotalAcKw ?? _bodyAcOutputKw;

    let stringResult: ReturnType<typeof generateStringConfig> | null = null;
    let mpptAllocation = '';
    let panelsPerString = 1;
    let lastStringPanels = 1;

    if (!isMicro) {
      const moduleSpecs = moduleSpecsFromRegistry({
        voc: panelVoc, vmp: panelVmp, isc: panelIsc, imp: panelImp,
        watts: panelWatts, tempCoeffVoc, tempCoeffVmp,
        maxSeriesFuseRating: maxSeriesFuse,
      });

      const inverterSpecs = inverterSpecsFromRegistry({
        maxDcVoltage, mpptVoltageMin, mpptVoltageMax,
        mpptChannels, maxInputCurrent: maxInputCurrentPerMppt,
        maxParallelStringsPerMppt,
        nominalDcVoltage,  // v47.415 — optimizer operating-current math
        acOutputKw,
        // v47.420 — forward brand maxPanelsPerString for optimizer topology string-length ceiling
        maxPanelsPerString,
      });

      // v47.412 — Plumb topology + optimizer cap into string-generator so
      // the SLD path applies the same topology-aware Voc × N / MPPT-current
      // bypass that the compliance route uses. Without this the SLD would
      // still render 10-panel SolarEdge strings and the plan-set would
      // show a different layout than the compliance tab.
      const optimizerMaxOutputCurrentForSG: number | undefined =
        typeof (body as any).optimizerMaxOutputCurrent === 'number' &&
        (body as any).optimizerMaxOutputCurrent > 0
          ? (body as any).optimizerMaxOutputCurrent
          : undefined;

      stringResult = generateStringConfig({
        totalModules,
        moduleSpecs,
        inverterSpecs,
        designTempMin,
        topology: isOptimizer ? 'optimizer' : 'string',
        optimizerMaxOutputCurrent: optimizerMaxOutputCurrentForSG,
      });

      // Build MPPT allocation label (e.g. "CH1: 3str, CH2: 3str")
      mpptAllocation = stringResult.mpptChannels
        .filter(ch => ch.strings.length > 0)
        .map(ch => `CH${ch.channelIndex + 1}:${ch.strings.length}str`)
        .join(' ');

      // Determine panels per string (may vary for last string)
      panelsPerString = stringResult.strings[0]?.panelsInString ?? Math.round(totalModules / Math.max(stringResult.totalStrings, 1));
      lastStringPanels = stringResult.strings[stringResult.strings.length - 1]?.panelsInString ?? panelsPerString;

      // Phase B3: Override layout-count fields from sizing engine.
      // generateStringConfig() above is kept for NEC 690.7 Voc/current math.
      // But the STRING COUNT and PANELS-PER-STRING come from the sizing engine
      // (the same source the UI uses) when a valid sizingResult is available.
      if (layoutStrings && layoutStrings.length > 0) {
        const panelCounts = layoutStrings.map(s => s.panelCount);
        panelsPerString  = panelCounts[0] ?? panelsPerString;
        lastStringPanels = panelCounts[panelCounts.length - 1] ?? panelsPerString;

        // Rebuild mpptAllocation from sizing engine strings
        const mpptGroups: Record<number, number> = {};
        for (const s of layoutStrings) {
          mpptGroups[s.mpptIndex] = (mpptGroups[s.mpptIndex] ?? 0) + 1;
        }
        mpptAllocation = Object.entries(mpptGroups)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([ch, cnt]) => `CH${Number(ch) + 1}:${cnt}str`)
          .join(' ');
      }
    }

    // Resolved device count: prefer sizing engine for both string and micro
    const resolvedDeviceCount = isMicro
      ? (layoutMicroCount ?? layoutInverterCount ?? Number(body.deviceCount) ?? totalModules)
      : (layoutInverterCount ?? Number(body.deviceCount) ?? 1);

    // Resolved total strings: prefer sizing engine string count
    const resolvedTotalStrings = !isMicro
      ? (layoutStrings ? layoutStrings.length : (stringResult?.totalStrings ?? 1))
      : 0;

    // SINGLE SOURCE OF TRUTH: computeSystem() → PermitSystemModel
    // All NEC electrical values (OCPD, wire gauges, backfeed, EGC) come from
    // the engine. No duplicate calculations below this point.
    // ─────────────────────────────────────────────────────────────────────────

    // BUILD v24: Look up equipment specs for battery/gen/ATS conductor sizing
    const _buiId = body.backupInterfaceId ? String(body.backupInterfaceId) : undefined;
    const _buiSpec = _buiId ? getBackupInterfaceById(_buiId) : undefined;
    const _batId = body.batteryId ? String(body.batteryId) : undefined;
    const _batSpec = _batId ? getBatteryById(_batId) : undefined;
    const _genId = body.generatorId ? String(body.generatorId) : undefined;
    const _genSpec = _genId ? getGeneratorById(_genId) : undefined;

    // Derive hasEnphaseIQSC3
    const _buiModel = String(body.backupInterfaceModel ?? _buiSpec?.model ?? '');
    const _buiIdStr = String(body.backupInterfaceId ?? '').toLowerCase();
    const _atsIdStr = String(body.atsId ?? body.atsModel ?? '').toLowerCase();
    const _hasEnphaseIQSC3 =
      _buiIdStr === 'enphase-iq-system-controller-3' ||
      _buiIdStr === 'enphase-iq-sc3-ats' ||
      _atsIdStr.includes('enphase-iq-sc3') ||
      _atsIdStr.includes('enphase-iq-system-controller') ||
      _buiModel.toUpperCase().includes('IQ SYSTEM CONTROLLER 3') ||
      _buiModel.toUpperCase().includes('IQ SC3');

    const _buiMaxA = _buiSpec?.maxContinuousOutputA ??
      (body.backupInterfaceMaxA ? Number(body.backupInterfaceMaxA) : undefined);

    const _batBackfeedA = _batSpec?.backfeedBreakerA ??
      (body.batteryBackfeedA ? Number(body.batteryBackfeedA) : undefined);
    const _batContinuousA = _batSpec?.maxContinuousOutputA ??
      (body.batteryContinuousOutputA ? Number(body.batteryContinuousOutputA) : undefined);

    const _genKw = body.generatorKw ? Number(body.generatorKw) : (_genSpec?.ratedOutputKw ?? 0);
    // Generator breaker sizing comes from spec; fallback only if no spec exists
    const _genOutputBreakerA = _genSpec?.outputBreakerA ??
      (body.generatorOutputBreakerA ? Number(body.generatorOutputBreakerA) :
        (_genKw > 0 ? Math.ceil((_genKw * 1000 / 240) * 1.25 / 5) * 5 : undefined));

    const _atsAmpRating = body.atsAmpRating ? Number(body.atsAmpRating) :
      (body.mainPanelAmps ? Number(body.mainPanelAmps) : undefined);

    // ── Run computeSystem() — single call, all electrical values derived here ──
    let cs: ComputedSystem | null = null;
    let systemModel: PermitSystemModel | null = null;
    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;

    try {
      // v47.410 — Optional optimizer SKU cap forwarded from the client.
      // Falls back to the computed-system default (15.0 A) when omitted.
      const optimizerMaxOutputCurrent: number | undefined =
        typeof body.optimizerMaxOutputCurrent === 'number' &&
        body.optimizerMaxOutputCurrent > 0
          ? body.optimizerMaxOutputCurrent
          : undefined;

      const csInput: ComputedSystemInput = {
        topology:                      isMicro ? 'micro' : (isOptimizer ? 'optimizer' : 'string'),
        optimizerMaxOutputCurrent,
        totalPanels:                   totalModules,
        // Pass resolved string count so computeSystem() uses the same
        // count as the SLD renderer (avoids conductor count mismatch).
        totalStrings:                  !isMicro ? resolvedTotalStrings : undefined,
        panelWatts:                    panelWatts,
        panelVoc:                      panelVoc,
        panelIsc:                      panelIsc,
        panelVmp:                      panelVmp,
        panelImp:                      panelImp,
        panelTempCoeffVoc:             Number(body.panelTempCoeffVoc ?? body.tempCoeffVoc ?? -0.27),
        panelTempCoeffIsc:             Number(body.panelTempCoeffIsc ?? 0.05),
        panelMaxSeriesFuse:            Number(body.panelMaxSeriesFuse ?? body.maxSeriesFuse ?? 20),
        panelModel:                    String(body.panelModel ?? 'Q.PEAK DUO BLK ML-G10+ 400W'),
        panelManufacturer:             String(body.panelManufacturer ?? 'Q CELLS'),
        inverterManufacturer:          inverterManufacturer,
        inverterModel:                 inverterModel,
        inverterAcKw:                  isMicro
          ? (Number(body.inverterAcKwPerDevice ?? body.perMicroKw) || (acOutputKw / Math.max(deviceCount, 1)))
          : acOutputKw,
        inverterAcCurrentMax:          isMicro
          ? (Number(body.inverterAcCurrentMax ?? body.perMicroAmps) || (acOutputAmps / Math.max(deviceCount, 1)))
          : acOutputAmps,
        inverterMaxDcV:                Number(body.inverterMaxDcV ?? body.maxDcVoltage ?? 600),
        inverterMpptVmin:              Number(body.mpptVoltageMin ?? 100),
        inverterMpptVmax:              Number(body.mpptVoltageMax ?? 600),
        inverterMaxInputCurrentPerMppt: Number(body.maxInputCurrentPerMppt ?? 15),
        inverterMpptChannels:          Number(body.mpptChannels ?? 2),
        inverterModulesPerDevice:      Number(body.inverterModulesPerDevice ?? 1),
        inverterBranchLimit:           Number(body.inverterBranchLimit ?? 16),
        manufacturerMaxPerBranch20A:   body.manufacturerMaxPerBranch20A ? Number(body.manufacturerMaxPerBranch20A) : undefined,
        manufacturerMaxPerBranch30A:   body.manufacturerMaxPerBranch30A ? Number(body.manufacturerMaxPerBranch30A) : undefined,
        designTempMin:                 designTempMin,
        ambientTempC:                  Number(body.ambientTempC ?? 30),
        rooftopTempAdderC:             Number(body.rooftopTempAdderC ?? 30),
        runLengths:                    body.runLengths ?? {},
        conduitType:                   String(body.conduitType ?? body.acConduitType ?? 'EMT'),
        mainPanelAmps:                 Number(body.mainPanelAmps ?? 200),
        mainPanelBrand:                String(body.mainPanelBrand ?? 'Square D'),
        panelBusRating:                Number(body.panelBusRating ?? body.mainPanelAmps ?? 200),
        interconnectionMethod:         String(body.interconnection ?? body.interconnectionType ?? body.interconnectionMethod ?? 'LOAD_SIDE'),
        branchCount:                   isMicro ? (Number(body.microBranches) || Number(body.branchCount) || undefined) : undefined,
        maxACVoltageDropPct:           Number(body.maxACVoltageDropPct ?? 2),
        maxDCVoltageDropPct:           Number(body.maxDCVoltageDropPct ?? 3),

        // Battery/BUI/Generator/ATS segment sizing inputs
        batteryBackfeedA:              _batBackfeedA,
        batteryContinuousOutputA:      _batContinuousA,
        batteryIds:                    _batId ? [_batId] : (body.batteryIds ?? undefined),
        generatorOutputBreakerA:       _genOutputBreakerA,
        generatorKw:                   _genKw > 0 ? _genKw : undefined,
        atsAmpRating:                  _atsAmpRating,
        backupInterfaceMaxA:           _buiMaxA,
        hasEnphaseIQSC3:               _hasEnphaseIQSC3 || undefined,
        runLengthsBatteryGen:          body.runLengthsBatteryGen ?? undefined,
        systemType:                    _systemType,   // fence → SolFence mounting row in the equipment schedule
      };

      // Phase 4: Battery pipeline stage 1 diagnostic
      const _batStage1 = !!(csInput.batteryBackfeedA || csInput.batteryIds?.length);
      if (!_batStage1 && (body.hasBattery || body.batteryModel || body.batteryKwh || body.batteryBrand)) {
        console.warn('[SLD BATTERY MISSING AT STAGE 1] battery fields in request body but not forwarded to computeSystem');
      }
      cs = computeSystem(csInput);
      computedRuns = cs.runs;

      // Build PermitSystemModel — single source of truth for all display values
      systemModel = buildPermitSystemModel(cs, {
        mainPanelBusAmps:      Number(body.panelBusRating ?? body.mainPanelAmps ?? 200),
        mainPanelBreakerAmps:  Number(body.mainPanelAmps ?? 200),
        interconnectionMethod: (() => {
          const raw = String(body.interconnection ?? body.interconnectionType ?? body.interconnectionMethod ?? 'LOAD_SIDE');
          return (raw === 'SUPPLY_SIDE_TAP' || raw.toLowerCase().includes('supply')) ? 'supply-side' : 'load-side';
        })(),
        dcConduitType: String(body.dcConduitType ?? body.conduitType ?? '3/4" EMT'),
        acConduitType: String(body.acConduitType ?? body.conduitType ?? '1" EMT'),
      });
    } catch (csErr: unknown) {
      // Non-fatal: fall back to body values
      console.warn('[SLD] computeSystem failed, using body fallback values:', csErr);
      cs = null;
      systemModel = null;
      // Wave 3.7 — client-passthrough guard: namespaced (hybrid) run ids are
      // resolved to the primary sub's bare ids; legacy payloads untouched.
      computedRuns = sanitizeClientRuns(body.runs) ?? undefined;
    }

    // ── Resolve all electrical display values from PermitSystemModel (engine) ──
    // These replace all independent OCPD/wire calculations that previously existed here.
    const resolvedAcOCPD       = systemModel?.acOcpdAmps      ?? (Math.ceil(acOutputAmps * 1.25 / 5) * 5);
    const resolvedBackfeedAmps = systemModel?.backfeedBreakerAmps ?? resolvedAcOCPD;
    const resolvedDcWireGauge  = systemModel?.dcWireGauge     ?? String(body.dcWireGauge ?? '#10 AWG');
    const resolvedAcWireGauge  = systemModel?.acWireGauge     ?? String(body.acWireGauge ?? body.wireGauge ?? '#8 AWG');
    const resolvedEgcGauge     = systemModel?.egcGauge        ?? '#8 AWG';
    const resolvedDcOCPD       = isMicro ? 0 : (systemModel?.stringOcpdAmps ?? stringResult?.ocpdPerString ?? (Number(body.dcOCPD) || 20));
    const resolvedStringVoc    = systemModel?.stringVoc       ?? stringResult?.strings[0]?.stringVoc ?? (stringResult?.vocCorrected ? stringResult.vocCorrected * panelsPerString : undefined);
    const resolvedStringIsc    = systemModel?.stringIsc       ?? stringResult?.strings[0]?.stringIsc ?? panelIsc;

    const input: SLDProfessionalInput = {
      projectName:             String(body.projectName             ?? 'Solar PV System'),
      clientName:              String(body.clientName              ?? 'Homeowner'),
      address:                 String(body.address                 ?? '123 Main St'),
      designer:                String(body.designer                ?? 'SolarPro Engineering'),
      drawingDate:             String(body.drawingDate ?? body.date ?? new Date().toLocaleDateString()),
      drawingNumber:           String(body.drawingNumber           ?? 'SLD-001'),
      revision:                String(body.revision                ?? 'A'),
      topologyType:            topologyType,  // Phase 7: canonical (engine-overridden) topology
      totalModules,
      totalStrings:            resolvedTotalStrings,
      panelModel:              String(body.panelModel              ?? 'Q.PEAK DUO BLK ML-G10+ 400W'),
      panelWatts,
      panelVoc,
      panelIsc,

      // ── Engine-sourced electrical values (single source of truth) ──
      dcWireGauge:             resolvedDcWireGauge,
      dcConduitType:           String(body.dcConduitType ?? body.conduitType ?? 'EMT'),
      dcOCPD:                  resolvedDcOCPD,
      inverterModel,
      inverterManufacturer,
      acOutputKw,
      acOutputAmps,
      acWireGauge:             resolvedAcWireGauge,
      acConduitType:           String(body.acConduitType ?? body.conduitType ?? 'EMT'),
      acOCPD:                  resolvedAcOCPD,
      acWireLength,
      backfeedAmps:            resolvedBackfeedAmps,
      // ──────────────────────────────────────────────────────────────────

      mainPanelAmps:           Number(body.mainPanelAmps)          || 200,
      panelBusRating:          Number(body.panelBusRating ?? body.mainPanelAmps) || 200,  // C1: busbar rating for the 120% rule
      utilityName:             String(body.utilityName ?? body.utilityCompany ?? body.utility ?? 'Local Utility'),
      interconnection:         (() => {
        const raw = String(body.interconnection ?? body.interconnectionType ?? 'LOAD_SIDE');
        if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap';
        if (raw === 'SUPPLY_SIDE_TAP' || raw.toLowerCase().includes('supply')) return 'Supply Side Tap';
        if (raw === 'MAIN_BREAKER_DERATE' || raw.toLowerCase().includes('derate')) return 'Load Side Tap';
        if (raw === 'PANEL_UPGRADE' || raw.toLowerCase().includes('upgrade')) return 'Load Side Tap';
        if (raw.toLowerCase().includes('line')) return 'Line Side Tap';
        return raw;
      })(),
      rapidShutdownIntegrated: !!(body.rapidShutdownIntegrated || body.rapidShutdown),
      hasProductionMeter:      body.hasProductionMeter !== false,
      hasBattery:              !!(body.hasBattery || body.batteryModel || body.batteryKwh || body.batteryBrand || (body.batteryCount && Number(body.batteryCount) > 0)),
      batteryModel:            String(body.batteryModel || body.batteryBrand || ''),
      batteryKwh:              Number(body.batteryKwh)             || 0,
      batteryBrand:            body.batteryBrand   ? String(body.batteryBrand)   : undefined,
      batteryCount:            body.batteryCount   ? Number(body.batteryCount)   : undefined,
      batteryBackfeedA:        _batBackfeedA,  // C9: datasheet-derived backfeed (same value the model uses), not the raw body field
      generatorBrand:          body.generatorBrand  ? String(body.generatorBrand)  : undefined,
      generatorModel:          body.generatorModel  ? String(body.generatorModel)  : undefined,
      generatorKw:             body.generatorKw     ? Number(body.generatorKw)     : undefined,
      atsBrand:                body.atsBrand        ? String(body.atsBrand)        : undefined,
      atsModel:                body.atsModel        ? String(body.atsModel)        : undefined,
      atsAmpRating:            body.atsAmpRating    ? Number(body.atsAmpRating)    : undefined,
      hasBackupPanel:          !!(body.hasBackupPanel || body.backupPanelBrand),
      backupPanelAmps:         body.backupPanelAmps  ? Number(body.backupPanelAmps)  : undefined,
      backupPanelBrand:        body.backupPanelBrand ? String(body.backupPanelBrand) : undefined,
      backupInterfaceId:       body.backupInterfaceId   ? String(body.backupInterfaceId)   : undefined,
      backupInterfaceBrand:    body.backupInterfaceBrand ? String(body.backupInterfaceBrand) : undefined,
      backupInterfaceModel:    body.backupInterfaceModel ? String(body.backupInterfaceModel) : undefined,
      backupInterfaceIsATS:    body.backupInterfaceIsATS ? !!(body.backupInterfaceIsATS)    : undefined,
      hasEnphaseIQSC3:         _hasEnphaseIQSC3 || undefined,
      scale:                   String(body.scale                   ?? 'NOT TO SCALE'),

      // Micro-specific — use resolvedDeviceCount (sizing engine truth when available)
      deviceCount:             isMicro ? resolvedDeviceCount : undefined,
      microBranches:           isMicro ? (body.microBranches ?? undefined) : undefined,
      branchWireGauge:         isMicro ? (body.branchWireGauge ?? undefined) : undefined,
      branchConduitSize:       isMicro ? (body.branchConduitSize ?? undefined) : undefined,
      branchOcpdAmps:          isMicro ? (Number(body.branchOcpdAmps) || undefined) : undefined,

      // String-specific
      stringDetails:           !isMicro ? (body.stringDetails ?? undefined) : undefined,

      // ComputedSystem.runs — single source of truth for conduit schedule
      runs:                    computedRuns,

      // Auto string generation results
      panelsPerString:         isMicro ? 1 : panelsPerString,
      lastStringPanels:        isMicro ? 1 : lastStringPanels,
      designTempMin,
      vocCorrected:            stringResult?.vocCorrected,
      vmpCorrected:            stringResult?.vmpCorrected,
      stringVoc:               resolvedStringVoc,
      stringVmp:               stringResult ? (stringResult.strings[0]?.stringVmp ?? (stringResult.vmpCorrected ? stringResult.vmpCorrected * panelsPerString : undefined)) : undefined,
      stringIsc:               resolvedStringIsc,
      maxPanelsPerString:      stringResult?.maxPanelsPerString,
      minPanelsPerString:      stringResult?.minPanelsPerString,
      mpptChannels:            isMicro ? deviceCount : (stringResult?.mpptChannels.length ?? mpptChannels),
      mpptAllocation:          isMicro ? `${deviceCount} microinverters` : mpptAllocation,
      combinerType:            isMicro ? 'DIRECT' : stringResult?.combinerType,
      combinerLabel:           isMicro ? 'AC Trunk Cable' : stringResult?.combinerLabel,
      ocpdPerString:           isMicro ? 0 : (systemModel?.stringOcpdAmps ?? stringResult?.ocpdPerString),
      dcAcRatio:               isMicro ? undefined : (stringResult ? calcDcAcRatio(stringResult.totalDcPower / 1000, acOutputKw) : undefined),
      stringConfigWarnings:    stringResult?.warnings,

      // Engine system model — passed to renderer for enhanced display
      systemModel:             systemModel ?? undefined,

      // EGC gauge from engine (NEC 250.122)
      egcGauge:                resolvedEgcGauge,

      // ── Ecosystem / optimizer truth (Phase 2-5 SLD fix) ──
      selectedBrand:           _selectedBrand,
      ecosystemTopology:       isOptimizer ? 'optimizer' : (isMicro ? 'micro' : 'string'),
      optimizerQty:            _resolvedOptimizerQty,
      optimizerModel:          _optimizerModel,
      integratedDcDisconnect:  _integratedDcDisconnect,
      acRequiresNeutral:       _acRequiresNeutral,
    };

    const svg = renderSLDProfessional(input);

    // Response includes X-System-Model header to confirm engine usage
    const format = (body.format ?? 'svg') as string;

    if (format === 'svg') {
      return new NextResponse(svg, {
        headers: {
          'Content-Type':        'image/svg+xml',
          'Content-Disposition': 'inline; filename="sld.svg"',
          'X-System-Model':      systemModel ? 'computed' : 'fallback',
          'X-Layout-Source':     sizingResult ? (layoutCandidate ? 'layoutCandidate' : 'sizingResult') : 'body',
          'X-Sld-Degraded':      sldDegraded ? 'true' : 'false',
        },
      });
    }

    return NextResponse.json({
      success: true,
      svg,
      systemModelUsed: systemModel ? 'computed' : 'fallback',
      // Phase B3: report layout source in API response for debugging
      layoutSource: sizingResult ? (layoutCandidate ? 'layoutCandidate' : 'sizingResult') : 'body',
      sldDegraded,
      topology: input.topologyType,
      stringConfig: isMicro ? null : (stringResult ? {
        totalStrings:         resolvedTotalStrings,
        panelsPerString,
        lastStringPanels,
        maxPanelsPerString:   stringResult.maxPanelsPerString,
        minPanelsPerString:   stringResult.minPanelsPerString,
        vocCorrected:         stringResult.vocCorrected,
        designTempMin,
        combinerType:         stringResult.combinerType,
        combinerLabel:        stringResult.combinerLabel,
        mpptAllocation,
        ocpdPerString:        resolvedDcOCPD,
        dcAcRatio:            calcDcAcRatio(stringResult.totalDcPower / 1000, acOutputKw),
        warnings:             stringResult.warnings,
        errors:               stringResult.errors,
        isValid:              stringResult.isValid,
      } : null),
      microConfig: isMicro ? {
        deviceCount:      resolvedDeviceCount,
        topology: 'MICROINVERTER',
        acBranchCircuits: Math.ceil(resolvedDeviceCount / 16),
        note: 'Microinverters convert DC to AC at each panel. No DC strings.',
      } : null,
      // Resolved electrical values (from engine)
      resolvedValues: {
        acOCPD:         resolvedAcOCPD,
        backfeedAmps:   resolvedBackfeedAmps,
        dcWireGauge:    resolvedDcWireGauge,
        acWireGauge:    resolvedAcWireGauge,
        egcGauge:       resolvedEgcGauge,
        dcOCPD:         resolvedDcOCPD,
      },
      dimensions: { width: 2304, height: 1728, format: 'ANSI C 24×18"' },
      generatedAt: new Date().toISOString(),
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/sld/route.ts]', err);
  }
}