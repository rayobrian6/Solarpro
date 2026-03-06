// ============================================================
// POST /api/engineering/sld
// Professional SLD generation — BUILD v24 — NEC Conductor Sizing Engine
// Last updated: 2026-03-06 — battery/gen/ATS segments, IQ SC3 routing fix
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { renderSLDProfessional, SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
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

    // OCPD: use explicit or derive (125% of output amps, rounded to next 5A)
    const acOCPD = Number(body.acOCPD) || Math.ceil(acOutputAmps * 1.25 / 5) * 5;

    // Backfeed breaker: use explicit or same as acOCPD
    const backfeedAmps = Number(body.backfeedAmps || body.acOCPD) || acOCPD;

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

        // ── Compute RunSegments via computeSystem() ─────────────────────────────
    // This is the single source of truth for conductor bundles, conduit sizing,
    // fill percentages, and all electrical data shown on the SLD.
    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;

    // BUILD v24: Look up equipment specs for battery/gen/ATS conductor sizing
    // These are used to populate the new csInput fields for NEC-based segment sizing.
    const _buiId = body.backupInterfaceId ? String(body.backupInterfaceId) : undefined;
    const _buiSpec = _buiId ? getBackupInterfaceById(_buiId) : undefined;
    const _batId = body.batteryId ? String(body.batteryId) : undefined;
    const _batSpec = _batId ? getBatteryById(_batId) : undefined;
    const _genId = body.generatorId ? String(body.generatorId) : undefined;
    const _genSpec = _genId ? getGeneratorById(_genId) : undefined;

    // Derive hasEnphaseIQSC3: true if BUI/ATS is the Enphase IQ System Controller 3
    // Equipment-db IDs: 'enphase-iq-system-controller-3' (BUI) or 'enphase-iq-sc3-ats' (ATS)
    // The IQ SC3 IS the ATS — no separate standalone ATS needed when this device is present.
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

    // Derive backupInterfaceMaxA: from spec or body override
    const _buiMaxA = _buiSpec?.maxContinuousOutputA ??
      (body.backupInterfaceMaxA ? Number(body.backupInterfaceMaxA) : undefined);

    // Derive batteryBackfeedA and batteryContinuousOutputA: from spec or body
    const _batBackfeedA = _batSpec?.backfeedBreakerA ??
      (body.batteryBackfeedA ? Number(body.batteryBackfeedA) : undefined);
    const _batContinuousA = _batSpec?.maxContinuousOutputA ??
      (body.batteryContinuousOutputA ? Number(body.batteryContinuousOutputA) : undefined);

    // Derive generatorOutputBreakerA: from spec or body override
    // Fallback: estimate from kW (kW / 0.24 for 240V single-phase, rounded up to std OCPD)
    const _genKw = body.generatorKw ? Number(body.generatorKw) : (_genSpec?.ratedOutputKw ?? 0);
    const _genOutputBreakerA = _genSpec?.outputBreakerA ??
      (body.generatorOutputBreakerA ? Number(body.generatorOutputBreakerA) :
        (_genKw > 0 ? Math.ceil((_genKw * 1000 / 240) * 1.25 / 5) * 5 : undefined));

    // Derive atsAmpRating: from body or default to mainPanelAmps
    const _atsAmpRating = body.atsAmpRating ? Number(body.atsAmpRating) :
      (body.mainPanelAmps ? Number(body.mainPanelAmps) : undefined);

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
        // For micro: inverterAcKw must be PER-DEVICE kW, not total system kW
        // For string: inverterAcKw is the single inverter rated kW (= total system kW)
        inverterAcKw:                  isMicro
          ? (Number(body.inverterAcKwPerDevice ?? body.perMicroKw) || (acOutputKw / Math.max(deviceCount, 1)))
          : acOutputKw,
        // For micro: inverterAcCurrentMax is PER-DEVICE amps, not total system amps
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

        // BUILD v24: Battery/BUI/Generator/ATS segment sizing inputs
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
      const cs = computeSystem(csInput);
      computedRuns = cs.runs;
    } catch (csErr) {
      // Non-fatal: fall back to body.runs or undefined
      console.warn('[SLD] computeSystem failed, falling back to body.runs:', csErr);
      computedRuns = body.runs ?? undefined;
    }

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
      // For micro: totalStrings = 0 (no DC strings); for string/optimizer: use generated count
      totalStrings:            isMicro ? 0 : (stringResult?.totalStrings ?? 1),
      panelModel:              String(body.panelModel              ?? 'Q.PEAK DUO BLK ML-G10+ 400W'),
      panelWatts,
      panelVoc,
      panelIsc,
      dcWireGauge:             String(body.dcWireGauge             ?? '#10 AWG'),
      dcConduitType:           String(body.dcConduitType ?? body.conduitType ?? 'EMT'),
      dcOCPD:                  isMicro ? 0 : (stringResult?.ocpdPerString ?? (Number(body.dcOCPD) || 20)),
      inverterModel,
      inverterManufacturer,
      acOutputKw,
      acOutputAmps,
      acWireGauge:             String(body.acWireGauge ?? body.wireGauge ?? '#8 AWG'),
      acConduitType:           String(body.acConduitType ?? body.conduitType ?? 'EMT'),
      acOCPD,
      acWireLength,
      backfeedAmps,
      mainPanelAmps:           Number(body.mainPanelAmps)          || 200,
      utilityName:             String(body.utilityName ?? body.utilityCompany ?? body.utility ?? 'Local Utility'),
      // Map interconnection method to renderer-friendly string
      // Renderer checks .includes('load'), .includes('supply'), .includes('line')
      interconnection:         (() => {
        const raw = String(body.interconnection ?? body.interconnectionType ?? 'LOAD_SIDE');
        if (raw === 'LOAD_SIDE' || raw.toLowerCase().includes('load')) return 'Load Side Tap';
        if (raw === 'SUPPLY_SIDE_TAP' || raw.toLowerCase().includes('supply')) return 'Supply Side Tap';
        if (raw === 'MAIN_BREAKER_DERATE' || raw.toLowerCase().includes('derate')) return 'Load Side Tap';
        if (raw === 'PANEL_UPGRADE' || raw.toLowerCase().includes('upgrade')) return 'Load Side Tap';
        if (raw.toLowerCase().includes('line')) return 'Line Side Tap';
        return raw; // pass through (e.g. 'Backfeed Breaker')
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
      // BUILD v24: Pass IQ SC3 flag to renderer for correct generator routing
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
      // computedRuns is populated by computeSystem() above with full conductorBundle[] data
      runs:                   computedRuns,

      // Auto string generation results (null for micro topology)
      panelsPerString:         isMicro ? 1 : panelsPerString,
      lastStringPanels:        isMicro ? 1 : lastStringPanels,
      designTempMin,
      vocCorrected:            stringResult?.vocCorrected,
      vmpCorrected:            stringResult?.vmpCorrected,
      stringVoc:               stringResult ? (stringResult.strings[0]?.stringVoc ?? (stringResult.vocCorrected * panelsPerString)) : undefined,
      stringVmp:               stringResult ? (stringResult.strings[0]?.stringVmp ?? (stringResult.vmpCorrected * panelsPerString)) : undefined,
      stringIsc:               stringResult ? (stringResult.strings[0]?.stringIsc ?? panelIsc) : undefined,
      maxPanelsPerString:      stringResult?.maxPanelsPerString,
      minPanelsPerString:      stringResult?.minPanelsPerString,
      mpptChannels:            isMicro ? deviceCount : (stringResult?.mpptChannels.length ?? mpptChannels),
      mpptAllocation:          isMicro ? `${deviceCount} microinverters` : mpptAllocation,
      combinerType:            isMicro ? 'DIRECT' : stringResult?.combinerType,
      combinerLabel:           isMicro ? 'AC Trunk Cable' : stringResult?.combinerLabel,
      ocpdPerString:           isMicro ? 0 : stringResult?.ocpdPerString,
      dcAcRatio:               isMicro ? undefined : (stringResult ? stringResult.totalDcPower / (acOutputKw * 1000) : undefined),
      stringConfigWarnings:    stringResult?.warnings,
    };

    const svg = renderSLDProfessional(input);

    const format = (body.format ?? 'svg') as string;

    if (format === 'svg') {
      return new NextResponse(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': 'inline; filename="sld.svg"',
        },
      });
    }

    return NextResponse.json({
      success: true,
      svg,
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
        ocpdPerString:        stringResult.ocpdPerString,
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
      dimensions: { width: 2304, height: 1728, format: 'ANSI C 24×18"' },
      generatedAt: new Date().toISOString(),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'SLD generation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}