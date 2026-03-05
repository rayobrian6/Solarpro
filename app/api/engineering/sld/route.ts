// ============================================================
// POST /api/engineering/sld
// Professional SLD generation — V11 + Segment-based conductor data
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
        inverterAcKw:                  acOutputKw,
        inverterMaxDcV:                Number(body.inverterMaxDcV ?? body.maxDcVoltage ?? 600),
        inverterMpptVmin:              Number(body.mpptVoltageMin ?? 100),
        inverterMpptVmax:              Number(body.mpptVoltageMax ?? 600),
        inverterMaxInputCurrentPerMppt: Number(body.maxInputCurrentPerMppt ?? 15),
        inverterMpptChannels:          Number(body.mpptChannels ?? 2),
        inverterAcCurrentMax:          acOutputAmps,
        inverterModulesPerDevice:      Number(body.inverterModulesPerDevice ?? 1),
        inverterBranchLimit:           Number(body.inverterBranchLimit ?? 16),
        designTempMin:                 designTempMin,
        ambientTempC:                  Number(body.ambientTempC ?? 30),
        rooftopTempAdderC:             Number(body.rooftopTempAdderC ?? 30),
        runLengths:                    body.runLengths ?? {},
        conduitType:                   String(body.conduitType ?? body.acConduitType ?? 'EMT'),
        mainPanelAmps:                 Number(body.mainPanelAmps ?? 200),
        mainPanelBrand:                String(body.mainPanelBrand ?? 'Square D'),
        panelBusRating:                Number(body.panelBusRating ?? body.mainPanelAmps ?? 200),
        maxACVoltageDropPct:           Number(body.maxACVoltageDropPct ?? 2),
        maxDCVoltageDropPct:           Number(body.maxDCVoltageDropPct ?? 3),
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
      interconnection:         String(body.interconnection ?? body.interconnectionType ?? 'Backfeed Breaker'),
      rapidShutdownIntegrated: !!(body.rapidShutdownIntegrated || body.rapidShutdown),
      hasProductionMeter:      body.hasProductionMeter !== false,
      hasBattery:              !!(body.hasBattery || body.batteryModel || body.batteryKwh),
      batteryModel:            String(body.batteryModel            ?? ''),
      batteryKwh:              Number(body.batteryKwh)             || 0,
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