import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { runElectricalCalc, ElectricalCalcInput } from '@/lib/electrical-calc';
import { runStructuralCalcV4, type StructuralInputV4 } from '@/lib/structural-engine-v4';
import { getJurisdictionInfo, getDesignTemperatures, getGroundSnowLoad, getDesignWindSpeed, parseStateFromAddress } from '@/lib/jurisdiction';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
  StringGeneratorResult,
} from '@/lib/string-generator';
import { requireAuth } from '@/lib/security';
import { calcDcAcRatio } from '@/lib/system/calcDcAcRatio';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

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
    const { structural, address, state, utilityId, ahjId } = body;

    // v57.5 — Topology guard: if topologyType says optimizer, force inv.type='optimizer'
    // on all inverters so NEC 690.7 Voc check is correctly skipped. This prevents false
    // E-VOC-EXCEED errors when the client sends type:'string' for a SolarEdge optimizer
    // system (e.g. SE-11400H with category:'string_inverter' in equipment-db).
    const bodyTopologyType = String(body.topologyType ?? '').toUpperCase();
    const isOptimizerTopology = bodyTopologyType === 'STRING_WITH_OPTIMIZER'
      || bodyTopologyType === 'STRING_OPTIMIZER'
      || bodyTopologyType === 'OPTIMIZER';

    let electrical = body.electrical;
    if (electrical && isOptimizerTopology && electrical.inverters?.length > 0) {
      const fixedCount = electrical.inverters.filter((inv: any) => inv.type !== 'optimizer').length;
      if (fixedCount > 0) {
        console.log(`[calculate] v57.5 topology guard: forcing ${fixedCount} inverter(s) to type='optimizer' (topologyType=${bodyTopologyType})`);
        electrical = {
          ...electrical,
          inverters: electrical.inverters.map((inv: any) =>
            inv.type === 'optimizer' ? inv : { ...inv, type: 'optimizer' }
          ),
        };
      }
    }

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
        // v47.408 — Detect optimizer topology so string-generator can use
        // NEC 690.8(A)(2) optimizer-output method instead of panel Isc × 1.25.
        // SolarEdge brand profile sets inverterType: 'optimizer'; the client
        // also sends type: 'optimizer' on the inverter when the Optimizer
        // topology button is selected in the UI (System Config tab).
        const topologyFamily: 'string' | 'optimizer' | 'hybrid' =
          firstInv?.type === 'optimizer' ? 'optimizer'
          : firstInv?.type === 'hybrid'   ? 'hybrid'
          : 'string';

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

            // Total MPPT channels across all inverter units (e.g. 2x sg7.6rs = 4 channels).
            const totalMpptChannels = (electrical.inverters || []).reduce(
              (sum: number, inv: any) => sum + (inv.mpptChannels ?? 2),
              0,
            );

            // Total AC kW across all inverter units (for correct DC/AC ratio in string generator).
            const totalInverterAcKw = (electrical.inverters || []).reduce(
              (sum: number, inv: any) => sum + (inv.acOutputKw ?? 0),
              0,
            );

            const inverterSpecs = inverterSpecsFromRegistry({
              maxDcVoltage:              firstInv.maxDcVoltage              ?? 600,
              mpptVoltageMin:            firstInv.mpptVoltageMin            ?? 100,
              mpptVoltageMax:            firstInv.mpptVoltageMax            ?? 600,
              mpptChannels:              totalMpptChannels,
              // v47.415 — nominal DC bus voltage for optimizer operating-current math
              nominalDcVoltage:          firstInv.nominalDcVoltage,
              maxInputCurrent:           firstInv.maxInputCurrentPerMppt,
              // Phase 13.4 — forward parallel-strings cap to the allocator.
              maxParallelStringsPerMppt: firstInv.maxParallelStringsPerMppt,
              // Use total AC across all units so string generator DC/AC warning is accurate.
              acOutputKw:                totalInverterAcKw > 0 ? totalInverterAcKw : (firstInv.acOutputKw ?? 8.2),
              // v47.420 — forward brand maxPanelsPerString for optimizer topology string-length ceiling
              maxPanelsPerString:        firstInv.maxPanelsPerString,
            });

            // Total modules across all inverters and strings
            const totalModules = (electrical.inverters || []).reduce(
              (sum: number, inv: any) =>
                sum + (inv.strings || []).reduce((s: number, str: any) => s + (str.panelCount || 0), 0),
              0
            );

            const designTempMinForCalc = electrical.designTempMin ?? designTemps.minTemp;

            // v47.408 — Optional client-supplied optimizer max output current.
            // If the client sends `optimizerMaxOutputCurrent` (e.g. derived
            // from the selected optimizer SKU), use it; otherwise the string
            // generator falls back to a safe 15.0 A default that covers all
            // current SolarEdge P-series + Tigo TS4-A-O SKUs in the DB.
            const optimizerMaxOutputCurrent: number | undefined =
              typeof firstInv?.optimizerMaxOutputCurrent === 'number' &&
              firstInv.optimizerMaxOutputCurrent > 0
                ? firstInv.optimizerMaxOutputCurrent
                : undefined;

            stringConfig = generateStringConfig({
              totalModules,
              moduleSpecs,
              inverterSpecs,
              designTempMin: designTempMinForCalc,
              // v47.408 — topology-aware per-string design current.
              topology: topologyFamily,
              optimizerMaxOutputCurrent,
            });

            // ──────────────────────────────────────────────────────────────
            // v47.409 — Optimizer-system merge hint.
            // When the compliance tab is evaluating an INFEASIBLE optimizer
            // layout (MPPT_CURRENT_EXCEEDED), and the client has sent a
            // `recommendedLayout` from the Sizing Recommendation with FEWER
            // (= longer) strings, surface an actionable advisory that
            // merging strings would reduce the MPPT count and fit existing
            // hardware. Reuses the sizing recommendation — no separate merge
            // solver here.
            //
            // Scope (per user directive): NO auto-apply, NO auto-collapse.
            // Pure advisory string appended to stringConfig.warnings. The
            // existing rose layout-drift banner (v47.408) continues to point
            // the user at Apply Recommended Configuration.
            //
            // Composition logic lives in lib/system/optimizerMergeHint.ts
            // so it can be unit-tested in isolation.
            // ──────────────────────────────────────────────────────────────
            if (stringConfig && !stringConfig.isValid && stringConfig.mpptAllocation) {
              const { composeOptimizerMergeHint } = await import(
                '@/lib/system/optimizerMergeHint'
              );

              const hasCurrentExceeded = stringConfig.mpptAllocation.violations.some(
                v => v.code === 'MPPT_CURRENT_EXCEEDED',
              );
              const recLayout: any = (body as any)?.recommendedLayout;
              const currentCounts: number[] = stringConfig.strings.map(
                s => (s as any).panelsInString ?? 0,
              );
              const perStringCurrentA =
                optimizerMaxOutputCurrent && optimizerMaxOutputCurrent > 0
                  ? optimizerMaxOutputCurrent
                  : 15.0;

              const hint = composeOptimizerMergeHint({
                topology: topologyFamily,
                hasCurrentExceeded,
                currentStringPanelCounts: currentCounts,
                recommendedStringPanelCounts: Array.isArray(recLayout?.stringPanelCounts)
                  ? recLayout.stringPanelCounts
                  : undefined,
                perStringCurrentA,
                mpptChannels: inverterSpecs.mpptChannels ?? 0,
                maxInputCurrentPerMpptA: inverterSpecs.maxInputCurrentPerMppt ?? 0,
              });

              if (hint) {
                stringConfig = {
                  ...stringConfig,
                  warnings: [...stringConfig.warnings, hint],
                };
              }
            }
          }
        }
        // Microinverter: stringConfig stays null — AC trunk cable sizing handled by electrical-calc
      } catch (strErr: unknown) {
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

    // Run structural calculations (V4 engine)
    let structuralResult = null;
    if (structural) {
      try {
        const structuralInput: StructuralInputV4 = {
          installationType: structural.installationType ?? 'roof_residential',
          windSpeed:        Number(structural.windSpeed ?? windSpeed),
          windExposure:     structural.windExposure ?? 'C',
          groundSnowLoad:   Number(structural.groundSnowLoad ?? groundSnowLoad),
          meanRoofHeight:   Number(structural.meanRoofHeight ?? 15),
          roofPitch:        Number(structural.roofPitch ?? 20),
          framingType:      structural.framingType ?? 'unknown',
          rafterSize:       structural.rafterSize ?? '2x6',
          rafterSpacingIn:  Number(structural.rafterSpacing ?? structural.rafterSpacingIn ?? 24),
          rafterSpanFt:     Number(structural.rafterSpan ?? structural.rafterSpanFt ?? 16),
          woodSpecies:      structural.rafterSpecies ?? structural.woodSpecies ?? 'Douglas Fir-Larch',
          panelCount:       Number(structural.panelCount ?? 24),
          panelLengthIn:    Number(structural.panelLength ?? structural.panelLengthIn ?? 73.0),
          panelWidthIn:     Number(structural.panelWidth ?? structural.panelWidthIn ?? 41.0),
          panelWeightLbs:   Number(structural.panelWeight ?? structural.panelWeightLbs ?? 45.0),
          panelOrientation: structural.panelOrientation ?? 'portrait',
          rowCount:         structural.rowCount,
          colCount:         structural.colCount,
          moduleGapIn:      structural.moduleGapIn ?? 0.5,
          rowGapIn:         structural.rowGapIn ?? 6,
          mountingSystemId: structural.mountingSystem ?? structural.mountingSystemId ?? 'ironridge-xr100',
          rackingWeightPerPanelLbs: structural.rackingWeight ?? structural.rackingWeightPerPanelLbs ?? 4.0,
          roofDeadLoadPsf:  structural.roofDeadLoadPsf ?? 15,
          soilType:         structural.soilType,
          frostDepthIn:     structural.frostDepthIn,
        };
        structuralResult = runStructuralCalcV4(structuralInput);
      } catch (structErr: unknown) {
        console.warn('[calculate] V4 structural engine warning:', structErr);
        // Fallback: return PASS with warning rather than crashing
        structuralResult = { status: 'WARNING', errors: [], warnings: [{ code: 'ENGINE_ERROR', message: String(structErr), severity: 'warning', suggestion: 'Check structural inputs' }] };
      }
    }

    // ── Deterministic overall status ──────────────────────────────────────
    // Rule: if ALL engines return PASS (or no errors after auto-fixes), overall = PASS
    // Only FAIL if there are unresolved errors after auto-fix
    const electricalStatus = electricalResult?.status ?? 'PASS';
    const structuralStatus = structuralResult?.status ?? 'PASS';

    // Check for unresolved errors (not auto-fixed)
    const electricalErrors = electricalResult?.errors?.filter((e: any) => !e.autoFixed) ?? [];
    const structuralErrors = (structuralResult as any)?.errors?.filter((e: any) => e.severity === 'error') ?? [];

    let overallStatus: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
    if (electricalErrors.length > 0 || structuralErrors.length > 0) {
      overallStatus = 'FAIL';
    } else if (electricalStatus === 'WARNING' || structuralStatus === 'WARNING') {
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
        dcAcRatio:              (() => {
          const totalAcKw = (electrical?.inverters ?? []).reduce(
            (sum: number, inv: any) => sum + (inv.acOutputKw ?? 0),
            0,
          );
          return calcDcAcRatio(stringConfig.totalDcPower / 1000, totalAcKw);
        })(),
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

  } catch (error: unknown) {
    return handleRouteDbError('[Engineering calc]', error);
  }
}