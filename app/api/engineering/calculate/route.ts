import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { runElectricalCalc, ElectricalCalcInput } from '@/lib/electrical-calc';
import { resolveOverallStatus, notEvaluated } from '@/lib/engineering/engineeringStatus';
import { runStructuralCalcV4, type StructuralInputV4 } from '@/lib/structural-engine-v4';
import { buildStructuralInputV4, runSubSystemStructural } from './subSystemStructural';
import { getJurisdictionInfo, getGroundSnowLoad, getDesignWindSpeed, parseStateFromAddress } from '@/lib/jurisdiction';
// ONE THERMAL BASIS PER PACKAGE. getThermalDesignBasis is the sanctioned single
// source of design temperatures (NEC 690.7(A) cold-Voc, NEC 310.15 ampacity
// derating). lib/permit/generatePermit.ts and the snapshot builder already read
// it; routing this route through it is what makes the number the DESIGNER sees
// and the number the STAMPED PLAN SET is engineered to the same number.
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';
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

    // ══════════════════════════════════════════════════════════════════════
    // 🚨 THE SIZING TAB CONSUMES THE CANONICAL PROJECT — Ray's §11.
    //
    //   "computeSystem / sizing are still evidently reconstructing an older electrical architecture.
    //    They must consume canonical architecture rather than independently deriving."
    //
    // This route had no `projectId` AT ALL: everything it knew came from the page's POST body. On a
    // DC-coupled job that meant the string generator never ran — `if (firstStr && firstInv)` below,
    // and `firstInv` is absent by design when the PV lands on the batteries — so the Electrical
    // Sizing tab produced NOTHING while the drawing showed 5 strings of 9. Two surfaces, one array,
    // and only one of them had an answer.
    //
    // 🚨 IT IS NOT GATED ON THE ARCHITECTURE CONFLICT. Ray: "Other unrelated project engineering may
    // continue." This tab is a working view, not a permit-grade artefact — it refuses nothing, it
    // just has to stop sizing against equipment that is not in the design.
    //
    // Architecture comes from the model; the arithmetic below is untouched.
    let _canonicalCoupling: string | null = null;
    let _dcLimits: import('@/lib/electrical/dcStringLimits').DcStringLimits | null = null;
    if (typeof body.projectId === 'string' && body.projectId) {
      try {
        const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
        const { dcStringLimits, dcStringLimitsNote } = await import('@/lib/electrical/dcStringLimits');
        const _loaded = await loadElectricalProject(String(body.projectId), _auth.user.id);
        if (_loaded) {
          _canonicalCoupling = _loaded.model.solarCoupling;
          _dcLimits = dcStringLimits(_loaded.model.topology, _loaded.model.solarCoupling);
          if (_dcLimits) {
            console.log('[calculate] DC-coupled: string limits from the storage, not an inverter: '
              + dcStringLimitsNote(_dcLimits));
          }
        }
      } catch (e) {
        // A read failure leaves the posted body in charge, which is today's behaviour — never a 500
        // on the compliance tab because one query failed.
        console.warn('[calculate] canonical electrical read skipped (non-fatal):',
          (e as Error)?.message);
      }
    }

    // Jurisdiction detection: use explicit state code if provided, else parse from address
    // This fixes the "Unknown" state/jurisdiction issue when address is empty
    const stateCode = state || parseStateFromAddress(address || '');
    // Build a synthetic address for getJurisdictionInfo if we have an explicit state but no address
    const addressForJurisdiction = address || (state ? `, ${state}` : '');
    const jurisdiction = getJurisdictionInfo(addressForJurisdiction);
    // Thermal design basis — resolved ONCE, from the sanctioned authority, and
    // used by every consumer below. An AHJ / project design-low is the only
    // admissible override and travels on its own explicit field so a stale
    // client-side default can never masquerade as one.
    const _overrideRaw = (body as { designTempMinOverrideC?: unknown }).designTempMinOverrideC
      ?? (body as { project?: { designTempMin?: unknown } }).project?.designTempMin;
    const designTempMinOverrideC =
      typeof _overrideRaw === 'number' && Number.isFinite(_overrideRaw) ? _overrideRaw : null;
    const thermalBasis = getThermalDesignBasis({
      lat: typeof body.lat === 'number' ? body.lat : null,
      lng: typeof body.lng === 'number' ? body.lng : null,
      state: stateCode || null,
      address: address || null,
      designTempMinOverrideC,
    });
    const designTemps = { minTemp: thermalBasis.minDesignTempC, maxTemp: thermalBasis.maxDesignTempC };
    const groundSnowLoad = getGroundSnowLoad(stateCode);
    const windSpeed = getDesignWindSpeed(stateCode);

    // ── Auto String Generation (NEC 690.7) ──────────────────────────────────
    // ── Auto String Generation (NEC 690.7) ──────────────────────────────────
    // ONLY for string/optimizer topologies — microinverters convert DC→AC at each panel,
    // so there are no DC strings. Micro systems use AC trunk cable sizing instead.
    let stringConfig: StringGeneratorResult | null = null;
    let stringConfigError: string | null = null; // audit: surface a thrown string-gen error instead of silently returning null
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

          // 🚨 `firstInv` IS LEGITIMATELY ABSENT ON A DC-COUPLED JOB. `_dcLimits` is non-null only
          // when the canonical model says the strings terminate on storage that publishes its own PV
          // input, so this opens the generator for exactly that case and for nothing else.
          // 🚨 THE ARRAY, FROM THE ARRAY — not from an inverter's string list.
          //
          // On a DC-coupled job `firstInv` is absent by design, so `firstStr` is absent with it and
          // the generator below could not run. `electrical.pvArray` carries the module specs and the
          // module count as facts about the design; it is used ONLY when there is no inverter fleet
          // to read them from, so every existing job keeps reading exactly what it read before.
          const _pvArray = (electrical.pvArray ?? null) as null | {
            moduleCount: number; panelVoc: number; panelVmp: number; panelIsc: number;
            panelImp: number; panelWatts: number; tempCoeffVoc: number; tempCoeffVmp?: number;
            maxSeriesFuseRating?: number;
          };
          const _arraySrc = firstStr ?? (_dcLimits ? _pvArray : null);

          if (_arraySrc && (firstInv || _dcLimits)) {
            const firstStrOrArray = _arraySrc;
            const moduleSpecs = moduleSpecsFromRegistry({
              voc:               firstStrOrArray.panelVoc    ?? 49.6,
              vmp:               firstStrOrArray.panelVmp    ?? 41.8,
              isc:               firstStrOrArray.panelIsc    ?? 10.18,
              imp:               firstStrOrArray.panelImp    ?? 9.57,
              watts:             firstStrOrArray.panelWatts  ?? 400,
              tempCoeffVoc:      firstStrOrArray.tempCoeffVoc ?? -0.27,
              tempCoeffVmp:      firstStrOrArray.tempCoeffVmp,
              maxSeriesFuseRating: firstStrOrArray.maxSeriesFuseRating ?? 20,
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

            // ══════════════════════════════════════════════════════════════
            // 🚨 THE DC WINDOW COMES FROM THE DEVICE THE STRINGS LAND ON.
            //
            // This is the A-8 defect, in its second home. `?? 600` is a standalone PV inverter's
            // maximum; a Powerwall 3's published PV input is 60–550 V. Sizing an array against the
            // defaults produced String Voc × 1.25 = 1345.8 V into a 550 V device on the drawing, and
            // would have produced the same number here the moment this generator started running for
            // DC-coupled jobs.
            //
            // `dcStringLimits` is the SAME projection the SLD route consumes — one derivation, so the
            // sizing tab and the sheet cannot disagree about one device.
            // ══════════════════════════════════════════════════════════════
            const inverterSpecs = inverterSpecsFromRegistry(_dcLimits ? {
              maxDcVoltage:              _dcLimits.maxDcVoltage,
              mpptVoltageMin:            _dcLimits.mpptVoltageMin,
              mpptVoltageMax:            _dcLimits.mpptVoltageMax,
              mpptChannels:              _dcLimits.mpptChannels,
              maxInputCurrent:           _dcLimits.maxInputCurrentPerMppt,
              // The storage's own AC output is the system's AC rating; there is no PV inverter.
              acOutputKw:                totalInverterAcKw > 0 ? totalInverterAcKw : _dcLimits.maxStcKw,
            } : {
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

            // Total modules across all inverters and strings — or off the array itself when there
            // is no inverter fleet to carry them. 🚨 NEVER DEFAULTED: a module count guessed here
            // would size an array nobody designed.
            const _fleetModules = (electrical.inverters || []).reduce(
              (sum: number, inv: any) =>
                sum + (inv.strings || []).reduce((s: number, str: any) => s + (str.panelCount || 0), 0),
              0
            );
            const totalModules = _fleetModules > 0
              ? _fleetModules
              : (_dcLimits && _pvArray ? _pvArray.moduleCount : 0);

            // The canonical basis, not whatever the client happened to post.
            // A client-side default is not an AHJ ruling; the only admissible
            // override arrives as designTempMinOverrideC and is already folded
            // into thermalBasis above.
            const designTempMinForCalc = designTemps.minTemp;

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

            // v61.7: Collect actual per-string panel counts from config.inverters[].strings.
            // This anchors NEC 690.7 Voc checks to the real committed string layout
            // instead of re-deriving equal-division strings from totalModules.
            const actualStringPanelCounts: number[] = (electrical.inverters || []).flatMap(
              (inv: any) => (inv.strings || []).map((str: any) => str.panelCount as number)
            ).filter((n: number) => n > 0);

            stringConfig = generateStringConfig({
              totalModules,
              moduleSpecs,
              inverterSpecs,
              designTempMin: designTempMinForCalc,
              // v47.408 — topology-aware per-string design current.
              topology: topologyFamily,
              optimizerMaxOutputCurrent,
              // v61.7 — pass actual string layout to avoid re-deriving from totalModules.
              configStringPanelCounts: actualStringPanelCounts.length > 0
                ? actualStringPanelCounts
                : undefined,
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
        // Don't swallow: record so the client can show "string sizing failed"
        // instead of treating a null stringConfig as "not applicable" (audit).
        stringConfigError = strErr instanceof Error ? strErr.message : String(strErr);
        console.warn('[calculate] String generation error:', strErr);
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
        // Thermal basis is route-owned (see thermalBasis above). Spread-in
        // client values are deliberately overwritten so the engine and the
        // stamped plan set cannot run at two different temperatures.
        designTempMin: designTemps.minTemp,
        designTempMax: designTemps.maxTemp,
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
    // The legacy payload → StructuralInputV4 mapping lives in ./subSystemStructural
    // (buildStructuralInputV4) so the whole-project run and the hybrid per-sub
    // runs share ONE mapping. Legacy behavior is byte-identical.
    let structuralResult = null;
    let subSystemStructural: ReturnType<typeof runSubSystemStructural> = null;
    if (structural) {
      try {
        const structuralInput: StructuralInputV4 = buildStructuralInputV4(structural, { windSpeed, groundSnowLoad });
        structuralResult = runStructuralCalcV4(structuralInput);
      } catch (structErr: unknown) {
        console.error('[calculate] V4 structural engine crashed:', structErr);
        // FAIL CLOSED: a thrown engine must never read as a passing stamp.
        // The overall-status aggregator (below) only escalates to FAIL on an
        // errors[] entry with severity 'error' — so emit one, not a warning.
        structuralResult = {
          status: 'FAIL',
          errors: [{ code: 'ENGINE_ERROR', message: `Structural engine error: ${String(structErr)}`, severity: 'error', suggestion: 'Structural analysis could not be completed — do not treat as engineered. Check inputs and retry.' }],
          warnings: [],
        };
      }

      // ── Hybrid multi-system: per-sub-system structural runs ──────────────
      // When the client sends structural.subSystems[] (roof/ground/fence
      // partition), run the V4 engine once per entry so each subset gets its
      // OWN analysis (roof rafters, ground piles, fence posts) instead of the
      // whole project being sized as one system. Additive: the legacy
      // whole-project result above is untouched; results are attached as
      // structural.subSystems + structural.subSystemMeta on the response.
      // Per-entry engine crashes are caught inside (key logged + omitted).
      try {
        subSystemStructural = runSubSystemStructural(structural, { windSpeed, groundSnowLoad });
      } catch (subErr: unknown) {
        console.error('[calculate] sub-system structural partition failed:', subErr);
        subSystemStructural = null;
      }
    }

    // ── Deterministic overall status ──────────────────────────────────────
    // 🚨 AN ENGINE THAT DID NOT RUN IS NOT A PASS.
    //
    // This used to read:
    //     const electricalStatus = electricalResult?.status ?? 'PASS';
    //     const structuralStatus = structuralResult?.status ?? 'PASS';
    //     let overallStatus: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
    // so a request that carried no `electrical` block — or no `structural` —
    // was answered "PASS", and PASS was also the value the variable simply
    // started at. The structural crash handler above already knew the rule
    // ("FAIL CLOSED: a thrown engine must never read as a passing stamp");
    // the aggregator did not apply it to absence.
    //
    // `null` means NOT EVALUATED. It is deliberate rather than a new enum
    // member: lib/engineering-helpers.ts, lib/system-state.ts and
    // app/engineering/page.tsx already declare `… | null`, and StatusBadge
    // already renders it as "Not calculated". The honest value existed; nothing
    // produced it.
    const electricalErrors = electricalResult?.errors?.filter((e: any) => !e.autoFixed) ?? [];
    const structuralErrors = (structuralResult as any)?.errors?.filter((e: any) => e.severity === 'error') ?? [];

    const _overall = resolveOverallStatus({
      electrical: electricalResult
        ? { evaluated: true, status: electricalResult.status, errorCount: electricalErrors.length }
        : notEvaluated(electrical ? 'engine-error' : 'no-input'),
      structural: structuralResult
        ? { evaluated: true, status: (structuralResult as any).status, errorCount: structuralErrors.length }
        : notEvaluated(structural ? 'engine-error' : 'no-input'),
    });
    const overallStatus = _overall.status;

    return NextResponse.json({
      success: true,
      overallStatus,
      /** Present whenever `overallStatus` is null: which engines produced no
       *  verdict and why. A consumer must not read a null status as a pass. */
      statusNotEvaluated: _overall.notEvaluated,
      statusBasis: _overall.basis,
      jurisdiction,
      electrical: electricalResult,
      // Hybrid: attach per-sub-system results WITHOUT touching the legacy
      // top-level result. Legacy payloads (no subSystems) get the exact
      // pre-hybrid object — no subSystems/subSystemMeta keys at all.
      structural: structuralResult && subSystemStructural
        ? {
            ...structuralResult,
            subSystems: subSystemStructural.subSystems,
            subSystemMeta: subSystemStructural.subSystemMeta,
          }
        : structuralResult,
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
      stringConfigError,
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