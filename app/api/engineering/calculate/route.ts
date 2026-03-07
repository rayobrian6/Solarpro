import { NextRequest, NextResponse } from 'next/server';
import { runElectricalCalc, ElectricalCalcInput } from '@/lib/electrical-calc';
import { runStructuralCalc, StructuralInput } from '@/lib/structural-calc';
import { getJurisdictionInfo, getDesignTemperatures, getGroundSnowLoad, getDesignWindSpeed, parseStateFromAddress } from '@/lib/jurisdiction';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
  StringGeneratorResult,
} from '@/lib/string-generator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { electrical, structural, address, state, utilityId, ahjId } = body;

    // Jurisdiction detection: use explicit state code if provided, else parse from address
    // This fixes the "Unknown" state/jurisdiction issue when address is empty
    const stateCode = state || parseStateFromAddress(address || '');
    // Build a synthetic address for getJurisdictionInfo if we have an explicit state but no address
    const addressForJurisdiction = address || (state ? `, ${state}` : '');
    const jurisdiction = getJurisdictionInfo(addressForJurisdiction);
    const designTemps = getDesignTemperatures(stateCode);
    const groundSnowLoad = getGroundSnowLoad(stateCode);
    const windSpeed = getDesignWindSpeed(stateCode);

    // ── Auto String Generation (NEC 690.7) ──────────────────────────────────
    // ── Auto String Generation (NEC 690.7) ──────────────────────────────────
    // ONLY for string/optimizer topologies — microinverters convert DC→AC at each panel,
    // so there are no DC strings. Micro systems use AC trunk cable sizing instead.
    let stringConfig: StringGeneratorResult | null = null;
    if (electrical) {
      try {
        const firstInv = (electrical.inverters || [])[0];
        const isMicro = firstInv?.type === 'micro';

        if (!isMicro) {
          // String / Optimizer topology: run NEC 690.7 string generator
          const firstStr = (firstInv?.strings || [])[0];

          if (firstStr && firstInv) {
            const moduleSpecs = moduleSpecsFromRegistry({
              voc:               firstStr.panelVoc           ?? 49.6,
              vmp:               firstStr.panelVmp           ?? 41.8,
              isc:               firstStr.panelIsc           ?? 10.18,
              imp:               firstStr.panelImp           ?? 9.57,
              watts:             firstStr.panelWatts         ?? 400,
              tempCoeffVoc:      firstStr.tempCoeffVoc       ?? -0.27,
              tempCoeffVmp:      firstStr.tempCoeffVmp,
              maxSeriesFuseRating: firstStr.maxSeriesFuseRating ?? 20,
            });

            const inverterSpecs = inverterSpecsFromRegistry({
              maxDcVoltage:    firstInv.maxDcVoltage         ?? 600,
              mpptVoltageMin:  firstInv.mpptVoltageMin       ?? 100,
              mpptVoltageMax:  firstInv.mpptVoltageMax       ?? 600,
              mpptChannels:    firstInv.mpptChannels         ?? 2,
              maxInputCurrent: firstInv.maxInputCurrentPerMppt,
              acOutputKw:      firstInv.acOutputKw           ?? 8.2,
            });

            // Total modules across all inverters and strings
            const totalModules = (electrical.inverters || []).reduce(
              (sum: number, inv: any) =>
                sum + (inv.strings || []).reduce((s: number, str: any) => s + (str.panelCount || 0), 0),
              0
            );

            const designTempMinForCalc = electrical.designTempMin ?? designTemps.minTemp;

            stringConfig = generateStringConfig({
              totalModules,
              moduleSpecs,
              inverterSpecs,
              designTempMin: designTempMinForCalc,
            });
          }
        }
        // Microinverter: stringConfig stays null — AC trunk cable sizing handled by electrical-calc
      } catch (strErr) {
        console.warn('[calculate] String generation warning:', strErr);
      }
    }

    // Run electrical calculations
    let electricalResult = null;
    if (electrical) {
      // DIAGNOSTIC LOG: server-side topology path
      const invTypes = (electrical.inverters || []).map((inv: any) => inv.type);
      const isMicroPath = invTypes.every((t: string) => t === 'micro');
      console.log('[calculate] Topology path:', isMicroPath ? 'MICRO' : 'STRING/OPTIMIZER', '| inverter types:', invTypes);
      (electrical.inverters || []).forEach((inv: any, i: number) => {
        if (inv.type === 'micro') {
          console.log(`[calculate] Micro inverter ${i}: deviceCount=${inv.deviceCount}, strings=${(inv.strings||[]).length} (should be 0)`);
        } else {
          console.log(`[calculate] String inverter ${i}: strings=${(inv.strings||[]).length}`);
          (inv.strings || []).forEach((_: any, si: number) => {
            console.log(`[calculate]   Creating string object for inverter ${i}, string ${si}`);
          });
        }
      });

      const electricalInput: ElectricalCalcInput = {
        ...electrical,
        designTempMin: electrical.designTempMin ?? designTemps.minTemp,
        designTempMax: electrical.designTempMax ?? designTemps.maxTemp,
        rooftopTempAdder: electrical.rooftopTempAdder ?? 35,
        necVersion: jurisdiction.necVersion,
        // Battery NEC 705.12(B) — pass through from request body
        batteryBackfeedA:         electrical.batteryBackfeedA         ?? 0,
        batteryCount:             electrical.batteryCount             ?? 0,
        batteryContinuousOutputA: electrical.batteryContinuousOutputA ?? 0,
        batteryModel:             electrical.batteryModel             ?? undefined,
        batteryManufacturer:      electrical.batteryManufacturer      ?? undefined,
        // Generator NEC 702
        generatorKw:              electrical.generatorKw              ?? undefined,
        generatorOutputBreakerA:  electrical.generatorOutputBreakerA  ?? undefined,
        generatorModel:           electrical.generatorModel           ?? undefined,
        generatorManufacturer:    electrical.generatorManufacturer    ?? undefined,
        // ATS NEC 702.5
        atsAmpRating:             electrical.atsAmpRating             ?? undefined,
        atsModel:                 electrical.atsModel                 ?? undefined,
        // BUI NEC 706
        backupInterfaceMaxA:      electrical.backupInterfaceMaxA      ?? undefined,
        backupInterfaceModel:     electrical.backupInterfaceModel     ?? undefined,
        hasEnphaseIQSC3:          electrical.hasEnphaseIQSC3          ?? false,
      };
      electricalResult = runElectricalCalc(electricalInput);
    }

    // Run structural calculations
    let structuralResult = null;
    if (structural) {
      const structuralInput: StructuralInput = {
        ...structural,
        windSpeed: structural.windSpeed ?? windSpeed,
        groundSnowLoad: structural.groundSnowLoad ?? groundSnowLoad,
      };
      structuralResult = runStructuralCalc(structuralInput);
    }

    // Combined status
    let overallStatus: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
    if (electricalResult?.status === 'FAIL' || structuralResult?.status === 'FAIL') {
      overallStatus = 'FAIL';
    } else if (electricalResult?.status === 'WARNING' || structuralResult?.status === 'WARNING') {
      overallStatus = 'WARNING';
    }

    return NextResponse.json({
      success: true,
      overallStatus,
      jurisdiction,
      electrical: electricalResult,
      structural: structuralResult,
      stringConfig: stringConfig ? {
        totalStrings:           stringConfig.totalStrings,
        panelsPerString:        stringConfig.strings[0]?.panelsInString ?? 0,
        lastStringPanels:       stringConfig.strings[stringConfig.strings.length - 1]?.panelsInString ?? 0,
        maxPanelsPerString:     stringConfig.maxPanelsPerString,
        minPanelsPerString:     stringConfig.minPanelsPerString,
        recommendedPanelsPerString: stringConfig.recommendedPanelsPerString,
        designTempMin:          stringConfig.designTempMin,
        tempCorrectionFactor:   stringConfig.tempCorrectionFactor,
        vocCorrected:           stringConfig.vocCorrected,
        vmpCorrected:           stringConfig.vmpCorrected,
        stringVoc:              stringConfig.strings[0]?.stringVoc ?? 0,
        stringVmp:              stringConfig.strings[0]?.stringVmp ?? 0,
        stringIsc:              stringConfig.strings[0]?.stringIsc ?? 0,
        totalDcPower:           stringConfig.totalDcPower,
        totalDcVoltageMax:      stringConfig.totalDcVoltageMax,
        totalDcCurrentMax:      stringConfig.totalDcCurrentMax,
        ocpdPerString:          stringConfig.ocpdPerString,
        dcWireAmpacity:         stringConfig.dcWireAmpacity,
        combinerType:           stringConfig.combinerType,
        combinerLabel:          stringConfig.combinerLabel,
        mpptChannels:           stringConfig.mpptChannels.map(ch => ({
          channelIndex: ch.channelIndex,
          stringCount:  ch.strings.length,
          totalPower:   ch.totalPower,
          totalIsc:     ch.totalIsc,
        })),
        dcAcRatio:              stringConfig.totalDcPower / ((electrical?.inverters?.[0]?.acOutputKw ?? 8.2) * 1000),
        warnings:               stringConfig.warnings,
        errors:                 stringConfig.errors,
        isValid:                stringConfig.isValid,
      } : null,
      autoDetected: {
        stateCode,
        necVersion: jurisdiction.necVersion,
        designTempMin: designTemps.minTemp,
        designTempMax: designTemps.maxTemp,
        groundSnowLoad,
        windSpeed,
        utilityId: utilityId || '',
        ahjId: ahjId || '',
      },
    });

  } catch (error: any) {
    console.error('Engineering calculate error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Calculation failed' },
      { status: 500 }
    );
  }
}