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

export const dynamic = 'force-dynamic';
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Handle both old field names (inverterKw, inverterModel as combined string)
    // and new field names (acOutputKw, inverterManufacturer + inverterModel separate)
    const acOutputKw = Number(body.acOutputKw || body.inverterKw || (body.acOutputW ? body.acOutputW / 1000 : 0) || 8.2);

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

    // Derive AC output amps if not provided
    const acOutputAmps = Number(body.acOutputAmps) || Math.round(acOutputKw * 1000 / 240);

    // Wire length
    const acWireLength = Number(body.acWireLength || body.wireLength) || 60;

    const totalModules = Number(body.totalModules) || 20;
    const panelVoc     = Number(body.panelVoc)     || 49.6;
    const panelIsc     = Number(body.panelIsc)     || 10.18;
    const panelVmp     = Number(body.panelVmp)     || 41.8;
    const panelImp     = Number(body.panelImp)     || 9.57;
    const panelWatts   = Number(body.panelWatts)   || 400;
    const designTempMin = Number(body.designTempMin ?? -10);
    const topologyType  = String(body.topologyType ?? 'STRING_INVERTER');
    const isMicro       = topologyType === 'MICROINVERTER';

    // Auto String Generation (NEC 690.7)
    // SKIP for microinverter topology -- micros convert DC->AC at each panel, no DC strings
    const maxDcVoltage      = Number(body.inverterMaxDcV || body.maxDcVoltage) || 600;
    const mpptVoltageMin    = Number(body.mpptVoltageMin)    || 100;
    const mpptVoltageMax    = Number(body.mpptVoltageMax)    || 600;
    const mpptChannels      = Number(body.mpptChannels)      || 2;
    const maxInputCurrentPerMppt = Number(body.maxInputCurrentPerMppt) || undefined;
    const tempCoeffVoc      = Number(body.tempCoeffVoc)      || -0.27;
    const tempCoeffVmp      = Number(body.tempCoeffVmp)      || undefined;
    const maxSeriesFuse     = Number(body.maxSeriesFuse)     || 20;
    const deviceCount       = Number(body.deviceCount)       || totalModules;

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
        acOutputKw,
      });

      stringResult = generateStringConfig({
        totalModules,
        moduleSpecs,
        inverterSpecs,
        designTempMin,
      });

      // Build MPPT allocation label (e.g. "CH1: 3str, CH2: 3str")
      mpptAllocation = stringResult.mpptChannels
        .filter(ch => ch.strings.length > 0)
        .map(ch => `CH${ch.channelIndex + 1}:${ch.strings.length}str`)
        .join(' ');

      // Determine panels per string (may vary for last string)
      panelsPerString = stringResult.strings[0]?.panelsInString ?? Math.round(totalModules / Math.max(stringResult.totalStrings, 1));
      lastStringPanels = stringResult.strings[stringResult.strings.length - 1]?.panelsInString ?? panelsPerString;
    }

    // ─────────────────────────────────────────────────────────────────────────
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
      const csInput: ComputedSystemInput = {
        topology:                      isMicro ? 'micro' : 'string',
        totalPanels:                   totalModules,
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
      };

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
    } catch (csErr) {
      // Non-fatal: fall back to body values
      console.warn('[SLD] computeSystem failed, using body fallback values:', csErr);
      cs = null;
      systemModel = null;
      computedRuns = body.runs ?? undefined;
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
      topologyType:            String(body.topologyType            ?? 'STRING_INVERTER'),
      totalModules,
      totalStrings:            isMicro ? 0 : (stringResult?.totalStrings ?? 1),
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
      hasBattery:              !!(body.hasBattery || body.batteryModel || body.batteryKwh),
      batteryModel:            String(body.batteryModel            ?? ''),
      batteryKwh:              Number(body.batteryKwh)             || 0,
      batteryBackfeedA:        Number(body.batteryBackfeedA)       || undefined,
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

      // Micro-specific
      deviceCount:             isMicro ? deviceCount : undefined,
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
      dcAcRatio:               isMicro ? undefined : (stringResult ? stringResult.totalDcPower / (acOutputKw * 1000) : undefined),
      stringConfigWarnings:    stringResult?.warnings,

      // Engine system model — passed to renderer for enhanced display
      systemModel:             systemModel ?? undefined,

      // EGC gauge from engine (NEC 250.122)
      egcGauge:                resolvedEgcGauge,
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
        },
      });
    }

    return NextResponse.json({
      success: true,
      svg,
      systemModelUsed: systemModel ? 'computed' : 'fallback',
      topology: input.topologyType,
      stringConfig: isMicro ? null : (stringResult ? {
        totalStrings:         stringResult.totalStrings,
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
        dcAcRatio:            stringResult.totalDcPower / (acOutputKw * 1000),
        warnings:             stringResult.warnings,
        errors:               stringResult.errors,
        isValid:              stringResult.isValid,
      } : null),
      microConfig: isMicro ? {
        deviceCount,
        topology: 'MICROINVERTER',
        acBranchCircuits: Math.ceil(deviceCount / 16),
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
    const message = err instanceof Error ? err.message : 'SLD generation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}