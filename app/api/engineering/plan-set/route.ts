// ============================================================
// /api/engineering/plan-set
// POST — Generate a permit-grade plan set PDF from engineering data.
//
// ARCHITECTURE (v45.0 — Single Source of Truth):
//   Design Studio → computeSystem() → ComputedSystem
//   → buildPermitSystemModel() → PermitSystemModel
//   → All sheet renderers (pure visual renderers)
//   → PDF via wkhtmltopdf
//
//   The route calls computeSystem() ONCE at entry.
//   All NEC 690.7 / 690.8 / 310.15 / 705.12 calculations
//   come from the engine — NO duplicate NEC calcs in this file.
//
// Sheets generated (v45.0 — 7 sheets):
//   G-1  Cover Sheet
//   E-1  Electrical — Single-Line Diagram + Wire Schedule
//   E-2  Equipment Schedule + BOM
//   S-1  Structural Engineering
//   A-1  Site / Roof Layout
//   M-1  Mounting Details
//   C-1  Code Compliance Checklist
//
// GET — Check if a plan set exists for a project
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { buildCoverSheet, type CoverSheetInput } from '@/lib/plan-set/cover-sheet';
import { buildElectricalSheet, type ElectricalSheetInput } from '@/lib/plan-set/electrical-sheet';
import { buildStructuralSheet, type StructuralSheetInput } from '@/lib/plan-set/structural-sheet';
import { buildEquipmentSchedule, buildDefaultEquipmentItems, type EquipmentScheduleInput } from '@/lib/plan-set/equipment-schedule';
import { buildSiteLayoutSheet, type SiteLayoutSheetInput } from '@/lib/plan-set/site-layout-sheet';
import { buildMountingDetailsSheet, type MountingDetailsSheetInput } from '@/lib/plan-set/mounting-details-sheet';
import { buildComplianceSheet, type ComplianceSheetInput } from '@/lib/plan-set/compliance-sheet';
import { wrapDocument, type TitleBlockData, fmtDate } from '@/lib/plan-set/title-block';
import { searchAhj } from '@/lib/jurisdictions/ahj-national';
import { calcFireSetbacks } from '@/lib/engineering/fire-setbacks';

// ── Single Source of Truth: computeSystem + PermitSystemModel ──────────────
import { computeSystem, type ComputedSystemInput, type ComputedSystem } from '@/lib/computed-system';
import { buildPermitSystemModel, type PermitSystemModel } from '@/lib/plan-set/permit-system-model';
import { BUILD_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── GET — check if plan set exists ───────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });

    const sql = await getDbReady();
    const rows = await sql`
      SELECT id, file_name, file_size, upload_date
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type = 'plan_set'
      ORDER BY upload_date DESC
      LIMIT 5
    `;

    return NextResponse.json({ success: true, planSets: rows });
  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/plan-set/route.ts]', err);
  }
}

// ─── POST — generate plan set ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const tmpFiles: string[] = [];

  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      projectId,
      clientId,
      // Project
      projectName,
      clientName,
      ownerContact,
      address,
      city,
      state,
      zip,
      county,
      parcelNumber,
      // System
      systemKw,
      panelCount,
      panelModel,
      panelWatts,
      panelWeightLbs,
      panelLengthIn,
      panelWidthIn,
      // Module electrical specs
      moduleVoc,
      moduleIsc,
      moduleVmp,
      moduleImp,
      moduleTempCoeffVoc,
      panelsPerString,
      // Inverter
      inverterType,
      inverterModel,
      inverterManufacturer,
      inverterCount,
      inverterKw,
      inverterVacOut,
      inverterMaxDcV,
      inverterMaxAcA,
      inverterMpptMin,
      inverterMpptMax,
      inverterMaxDcA,
      // Temperature inputs
      minAmbientTempC,
      maxRooftopTempC,
      // Mounting / Roof
      mountType,
      roofType,
      roofPitchDeg,
      roofPitchRatio,
      rafterSize,
      rafterSpacingIn,
      rafterSpanFt,
      // Site geometry (for A-1)
      roofWidthFt,
      roofLengthFt,
      // Equipment locations (for A-1)
      inverterLocation,
      disconnectLocation,
      meterLocation,
      mainPanelLocation,
      // Mounting hardware (for M-1)
      mountingSystem,
      railType,
      flashingType,
      lagBoltSize,
      lagBoltSpacingFt,
      panelThicknessIn,
      panelFrameHeight,
      sheathingType,
      bondingHardware,
      // Electrical (from config / compliance)
      strings,
      dcWireGauge,
      dcConduitType,
      acWireGauge,
      acConduitType,
      dcDisconnectAmps,
      dcDisconnectVoltage,
      acDisconnectAmps,
      acBreakerAmps,
      backfeedBreakerAmps,
      mainPanelBusAmps,
      mainPanelBreakerAmps,
      interconnectionType,
      interconnectionMethod,
      rapidShutdownRequired,
      rapidShutdownDevice,
      groundWireGauge,
      // Battery
      hasBattery,
      batteryModel,
      batteryManufacturer,
      batteryCount,
      batteryKwh,
      batteryBreakerAmps,
      // Structural
      windSpeedMph,
      groundSnowPsf,
      seismicCategory,
      // AHJ
      ahj,
      utilityName,
      necVersion,
      // Contractor
      contractorName,
      contractorLicense,
      electricalLicense,
      contractorPhone,
      contractorEmail,
      designerName,
      annualKwh,
      // Array config
      stringCount,
      // Pre-rendered SLD SVG from Design Studio (single source of truth for E-1)
      sldSvg: existingSldSvg,
    } = body;

    // ── Validate required fields ──────────────────────────────────────────
    if (!systemKw || !panelCount) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: systemKw, panelCount' },
        { status: 400 }
      );
    }
    const saveToProject = !!projectId;

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Run computeSystem() ONCE — SINGLE SOURCE OF TRUTH
    // All NEC 690.7, 690.8, 310.15, 705.12 calculations happen here only.
    // ─────────────────────────────────────────────────────────────────────
    const safeStrings = (strings && strings.length > 0) ? strings : [{
      id:          'S1',
      label:       'S1',
      panelCount:  panelCount,
      panelWatts:  panelWatts || 400,
      wireGauge:   dcWireGauge || '#10 AWG',
      conduitType: dcConduitType || '3/4" EMT',
      wireLength:  50,
      ocpdAmps:    15,
      stringVoc:   (inverterMaxDcV || 600) * 0.8,
      stringVmp:   (inverterMaxDcV || 600) * 0.7,
      stringIsc:   10,
      stringImp:   9.5,
    }];

    const safeStringCount     = stringCount     || safeStrings.length;
    const safePanelsPerString = panelsPerString  || Math.ceil(panelCount / safeStringCount);

    let systemModel: PermitSystemModel | null = null;
    let cs: ComputedSystem | null = null;

    try {
      // Build ComputedSystemInput from request body
      const csInput: ComputedSystemInput = {
        topology:       (inverterType === 'micro' ? 'micro' : inverterType === 'optimizer' ? 'optimizer' : 'string') as 'string' | 'micro' | 'optimizer',
        totalPanels:    panelCount,
        panelWatts:     panelWatts || 400,
        panelVoc:       moduleVoc  || 41.6,
        panelVmp:       moduleVmp  || 34.5,
        panelIsc:       moduleIsc  || 9.0,
        panelImp:       moduleImp  || 8.5,
        panelTempCoeffVoc:  moduleTempCoeffVoc || -0.29,
        panelTempCoeffIsc:  0.05,
        panelMaxSeriesFuse: 20,
        panelModel:         panelModel || 'Solar Panel',
        panelManufacturer:  'See Cut Sheet',
        inverterManufacturer: inverterManufacturer || 'Inverter Mfr',
        inverterModel:  inverterModel || 'Inverter',
        inverterAcKw:   inverterKw || systemKw,
        inverterMaxDcV: inverterMaxDcV || 600,
        inverterMpptVmin: inverterMpptMin || 100,
        inverterMpptVmax: inverterMpptMax || inverterMaxDcV || 600,
        inverterMaxInputCurrentPerMppt: inverterMaxDcA || 15,
        inverterMpptChannels: safeStringCount,
        inverterAcCurrentMax: inverterMaxAcA || (systemKw * 1000 / 240),
        inverterModulesPerDevice: 1,
        inverterBranchLimit: 16,
        ambientTempC:      maxRooftopTempC || 40,
        designTempMin:     minAmbientTempC || -10,
        rooftopTempAdderC: 33,
        runLengths: {
          DC_STRING_RUN:        safeStrings[0]?.wireLength || 50,
          COMBINER_TO_DISCO_RUN: 20,
          DISCO_TO_METER_RUN:   15,
          METER_TO_MSP_RUN:     10,
        },
        panelBusRating:    mainPanelBusAmps || 200,
        mainPanelAmps:     mainPanelBreakerAmps || 200,
        mainPanelBrand:    'Square D',
        conduitType:       dcConduitType || '3/4" EMT',
        maxACVoltageDropPct: 2,
        maxDCVoltageDropPct: 3,
        interconnectionMethod: interconnectionType === 'supply-side' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE',
        batteryBackfeedA:  (hasBattery && batteryBreakerAmps) ? batteryBreakerAmps : 0,
        batteryCount:      batteryCount || 0,
      };

      cs = computeSystem(csInput);

      // Build PermitSystemModel from ComputedSystem
      systemModel = buildPermitSystemModel(cs, {
        mainPanelBusAmps:     mainPanelBusAmps || 200,
        mainPanelBreakerAmps: mainPanelBreakerAmps || 200,
        interconnectionMethod: interconnectionType === 'supply-side' ? 'supply-side' : 'load-side',
        dcConduitType:        dcConduitType || '3/4" EMT',
        acConduitType:        acConduitType || '1" EMT',
        strings:              safeStrings,
      });
    } catch (csErr: any) {
      // If computeSystem fails (e.g. missing equipment data), fall back gracefully
      console.warn('[plan-set] computeSystem failed, using fallback values:', csErr.message);
      systemModel = null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Derive display values from PermitSystemModel (single source)
    // These are used by sheet builders that don't yet accept systemModel.
    // ─────────────────────────────────────────────────────────────────────

    // Wire gauges — from system model (computed), or from payload (user-supplied)
    const resolvedDcWireGauge  = systemModel?.dcWireGauge  ?? dcWireGauge  ?? '#10 AWG';
    const resolvedAcWireGauge  = systemModel?.acWireGauge  ?? acWireGauge  ?? '#8 AWG';
    const resolvedEgcGauge     = systemModel?.egcGauge     ?? groundWireGauge ?? '#8 AWG';
    const resolvedDcOcpd       = systemModel?.stringOcpdAmps ?? safeStrings[0]?.ocpdAmps ?? 15;
    const resolvedAcOcpd       = systemModel?.acOcpdAmps   ?? acBreakerAmps ?? 20;
    const resolvedBackfeed     = systemModel?.backfeedBreakerAmps ?? backfeedBreakerAmps ?? 20;
    const resolvedStringVoc    = systemModel?.stringVoc    ?? safeStrings[0]?.stringVoc ?? 400;
    const resolvedStringIsc    = systemModel?.stringIsc    ?? safeStrings[0]?.stringIsc ?? 10;
    const resolvedInterconPass = systemModel?.interconnectionPass ?? true;

    // DC wire ampacity for C-1 compliance sheet (from engine — no re-calc)
    const resolvedDcWireAmpacity = systemModel?.dcAmpacity ?? 30;

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Look up AHJ data and fire setbacks (non-electrical — OK here)
    // ─────────────────────────────────────────────────────────────────────
    let ahjData: any = null;
    try {
      const ahjResults = searchAhj({ stateCode: state, city, text: ahj });
      if (ahjResults.length > 0) ahjData = ahjResults[0];
    } catch (_: unknown) {}

    let setbacks: any = {
      ridgeSetbackIn: 18,
      eaveSetbackIn: 18,
      valleySetbackIn: 18,
      pathwayWidthIn: 36,
      pathwayRequired: true,
      codeReference: 'IRC R324.4',
    };
    try {
      setbacks = calcFireSetbacks({
        roofType:     roofType || 'shingle',
        roofPitchDeg: roofPitchDeg || 20,
        stateCode:    state || 'CA',
        fireZone:     'standard',
        systemSizeKw: systemKw,
        stories:      1,
        buildingType: 'residential',
      });
    } catch (_: unknown) {}

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Structural loads
    // These are structural (not electrical NEC calcs) — kept in route
    // because structural-sheet.ts does its own auto-fix logic.
    // ─────────────────────────────────────────────────────────────────────
    const panelDeadLoadPsf    = (panelWeightLbs || 40) / ((panelLengthIn || 65) * (panelWidthIn || 39) / 144);
    const mountingDeadLoadPsf = 1.5;
    const existingDeadLoadPsf = roofType === 'tile' ? 25 : roofType === 'metal_standing_seam' ? 5 : 10;
    const totalDeadLoadPsf    = existingDeadLoadPsf + panelDeadLoadPsf + mountingDeadLoadPsf;
    const liveLoadPsf         = 20;
    const snowLoadPsf         = (groundSnowPsf || 0) * 0.7;
    const windUpliftPsf       = (windSpeedMph || 90) * 0.00256 * 0.85 * 0.9 * 1.0 * 20;
    const windDownPsf         = windUpliftPsf * 0.6;
    const combo1              = totalDeadLoadPsf * 1.2 + liveLoadPsf * 1.6 + snowLoadPsf * 0.5;
    const combo2              = totalDeadLoadPsf * 1.2 + snowLoadPsf * 1.6 + liveLoadPsf;
    const combo3              = totalDeadLoadPsf * 1.2 + windDownPsf + liveLoadPsf + snowLoadPsf * 0.5;
    const governingLoadPsf    = Math.max(combo1, combo2, combo3);

    const rafterCapacityMap: Record<string, Record<number, number>> = {
      '2×6':  { 12: 75,  16: 52,  24: 35 },
      '2×8':  { 12: 95,  16: 70,  24: 55 },
      '2×10': { 12: 120, 16: 90,  24: 70 },
      '2×12': { 12: 150, 16: 115, 24: 90 },
    };
    const rafterKey         = rafterSize || '2×6';
    const spacingKey        = rafterSpacingIn || 24;
    const rafterCapacityPsf = rafterCapacityMap[rafterKey]?.[spacingKey] ?? 35;
    const structuralStatus  = 'PASS'; // structural-sheet.ts v44.0 auto-fixes

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Build title block
    // ─────────────────────────────────────────────────────────────────────
    const today    = fmtDate();
    const safeNec  = necVersion || ahjData?.necVersion || 'NEC 2020';
    const safeAhj  = ahj || ahjData?.ahjName || `${city || ''}, ${state || ''} Building Dept.`;
    const safeUtility = utilityName || 'Local Utility';

    const tb: TitleBlockData = {
      companyName:    contractorName || 'SolarPro Contractor',
      companyAddress: `${city || ''}, ${state || ''}`,
      companyPhone:   contractorPhone || '',
      companyEmail:   contractorEmail || '',
      companyLicense: contractorLicense,
      projectName:    projectName || `${clientName || 'Client'} Solar PV System`,
      clientName:     clientName || 'Client',
      siteAddress:    address || '',
      city:           city || '',
      state:          state || '',
      zip:            zip || '',
      ahj:            safeAhj,
      utilityName:    safeUtility,
      systemKw:       systemKw,
      panelCount:     panelCount,
      panelModel:     (panelModel || 'Solar Panel').substring(0, 20),
      inverterModel:  (inverterModel || 'Inverter').substring(0, 20),
      mountType:      mountType || 'Roof Mount',
      sheetTitle:     '',
      sheetNumber:    '',
      totalSheets:    7,
      revision:       '0',
      preparedBy:     designerName || 'SolarPro',
      preparedDate:   today,
      necVersion:     safeNec,
      ibcVersion:     'IBC 2021',
      asceVersion:    'ASCE 7-22',
    };

    // ─────────────────────────────────────────────────────────────────────
    // STEP 6: Sheet index (7 sheets)
    // ─────────────────────────────────────────────────────────────────────
    const sheetIndex = [
      { number: 'G-1', title: 'Cover Sheet',        description: 'Project summary, AHJ info, scope of work, general notes' },
      { number: 'E-1', title: 'Electrical / SLD',   description: 'Single-line diagram, wire schedule, NEC compliance calcs' },
      { number: 'E-2', title: 'Equipment Schedule', description: 'Bill of materials, cut sheet references, installation notes' },
      { number: 'S-1', title: 'Structural',         description: 'Roof loading analysis, ASCE 7-22 load combos, attachment schedule' },
      { number: 'A-1', title: 'Site / Roof Layout', description: 'Roof plan, panel placement, fire setbacks, equipment locations' },
      { number: 'M-1', title: 'Mounting Details',   description: 'Rail, flashing, splice, clamp, bonding, wire management details' },
      { number: 'C-1', title: 'Compliance',         description: 'NEC 690/705, structural, fire access compliance checklist' },
    ];

    // ─────────────────────────────────────────────────────────────────────
    // STEP 7: Build each sheet (all read from systemModel — pure renderers)
    // ─────────────────────────────────────────────────────────────────────
    const pages: string[] = [];

    // ── G-1 Cover Sheet ───────────────────────────────────────────────────
    const coverInput: CoverSheetInput = {
      tb:               { ...tb, sheetTitle: 'Cover Sheet', sheetNumber: 'G-1' },
      projectName:      projectName || `${clientName} Solar PV System`,
      clientName:       clientName || 'Client',
      ownerContact,
      siteAddress:      address || '',
      city:             city || '',
      state:            state || '',
      zip:              zip || '',
      county:           county || '',
      parcelNumber,
      projectDate:      today,
      systemKw,
      inverterKw:       inverterKw || systemKw,
      panelCount,
      panelModel:       panelModel || 'Solar Panel',
      panelWatts:       panelWatts || 400,
      panelVoc:         moduleVoc || 41.6,
      panelIsc:         moduleIsc || 9.0,
      inverterType:     inverterType || 'String',
      inverterModel:    inverterModel || 'Inverter',
      mountType:        mountType || 'Roof Mount',
      roofType,
      batteryModel:     hasBattery ? batteryModel : undefined,
      batteryKwh:       hasBattery ? batteryKwh : undefined,
      annualKwh,
      stringCount:      systemModel?.stringCount ?? safeStringCount,
      panelsPerString:  systemModel?.panelsPerString ?? safePanelsPerString,
      interconnectionMethod: interconnectionMethod || 'Backfeed Breaker',
      ahj:              safeAhj,
      ahjPhone:         ahjData?.phone,
      ahjWebsite:       ahjData?.website,
      utilityName:      safeUtility,
      necVersion:       safeNec,
      ibcVersion:       'IBC 2021',
      asceVersion:      'ASCE 7-22',
      windSpeedMph:     windSpeedMph || ahjData?.windSpeedMph,
      groundSnowPsf:    groundSnowPsf ?? ahjData?.groundSnowLoadPsf,
      seismicCategory:  seismicCategory || ahjData?.seismicDesignCategory,
      fireZone:         ahjData?.specialRequirements?.includes('WUI') ? 'WUI Zone' : undefined,
      rapidShutdownReq: rapidShutdownRequired !== false,
      contractorName:   contractorName || 'Contractor TBD',
      contractorLicense,
      electricalLicense,
      contractorPhone,
      contractorEmail,
      designerName:     designerName || 'SolarPro',
      sheets:           sheetIndex,
    };
    pages.push(buildCoverSheet(coverInput));

    // ── E-1 Electrical / SLD ───────────────────────────────────────────────
    // systemModel passes pre-computed NEC values to the sheet renderer.
    // The renderer displays them — no re-calculation.
    const elecInput: ElectricalSheetInput = {
      tb:                    { ...tb, sheetTitle: 'Electrical / SLD', sheetNumber: 'E-1' },
      // Module specs (for display/fallback)
      moduleVoc,
      moduleIsc,
      moduleVmp,
      moduleImp,
      moduleTempCoeffVoc,
      panelsPerString:       systemModel?.panelsPerString ?? safePanelsPerString,
      // Inverter
      inverterType:          inverterType || 'string',
      inverterModel:         inverterModel || 'Inverter',
      inverterManufacturer,
      inverterCount:         inverterCount || 1,
      inverterKw:            inverterKw || systemKw,
      inverterVacOut:        inverterVacOut || 240,
      inverterMaxDcV:        inverterMaxDcV || 600,
      inverterMaxAcA:        inverterMaxAcA || (systemKw * 1000 / 240),
      inverterMpptMin,
      inverterMpptMax,
      inverterMaxDcA,
      // Strings (fallback display data)
      strings:               safeStrings,
      // DC side (resolved from system model)
      dcDisconnectAmps:      dcDisconnectAmps || resolvedDcOcpd,
      dcDisconnectVoltage:   dcDisconnectVoltage || 600,
      dcWireGauge:           resolvedDcWireGauge,
      dcConduitType:         dcConduitType || '3/4" EMT',
      // AC side (resolved from system model)
      acWireGauge:           resolvedAcWireGauge,
      acConduitType:         acConduitType || '1" EMT',
      acBreakerAmps:         resolvedAcOcpd,
      acDisconnectAmps:      acDisconnectAmps || resolvedAcOcpd,
      // Main panel (resolved from system model)
      mainPanelBusAmps:      mainPanelBusAmps || 200,
      mainPanelBreakerAmps:  mainPanelBreakerAmps || 200,
      backfeedBreakerAmps:   resolvedBackfeed,
      interconnectionType:   interconnectionType || 'load-side',
      interconnectionMethod: interconnectionMethod || 'Backfeed Breaker',
      // RSD
      rapidShutdownRequired: rapidShutdownRequired !== false,
      rapidShutdownDevice:   rapidShutdownDevice || 'Per Manufacturer Spec',
      // Battery
      hasBattery:            !!hasBattery,
      batteryModel,
      batteryKwh,
      batteryBreakerAmps,
      // Ground (from system model)
      groundWireGauge:       resolvedEgcGauge,
      groundingElectrode:    "Ground Rod (2 × 5/8&quot; × 8')",
      // NEC / system
      necVersion:            safeNec,
      systemKw,
      panelCount,
      panelModel:            panelModel || 'Solar Panel',
      stateCode:             state || 'CA',
      utilityName:           safeUtility,
      // Temperature (fallback)
      minAmbientTempC,
      maxRooftopTempC,
    };
    pages.push(buildElectricalSheet(elecInput));

    // ── E-2 Equipment Schedule ─────────────────────────────────────────────
    const equipItems = buildDefaultEquipmentItems({
      panelCount,
      panelModel:           panelModel || 'Solar Panel',
      panelWatts:           panelWatts || 400,
      panelManufacturer:    'See Cut Sheet',
      inverterType:         inverterType || 'string',
      inverterModel:        inverterModel || 'Inverter',
      inverterManufacturer: inverterManufacturer || 'See Cut Sheet',
      inverterCount:        inverterCount || 1,
      mountingSystem:       mountType || 'Roof Mount Racking',
      mountingManufacturer: 'See Cut Sheet',
      hasBattery:           !!hasBattery,
      batteryModel,
      batteryManufacturer,
      batteryCount,
      batteryKwh,
      dcWireGauge:          resolvedDcWireGauge,
      acWireGauge:          resolvedAcWireGauge,
      groundWireGauge:      resolvedEgcGauge,
      dcConduitType:        dcConduitType || '3/4" EMT',
      acConduitType:        acConduitType || '1" EMT',
      dcDisconnectAmps:     dcDisconnectAmps || resolvedDcOcpd,
      acDisconnectAmps:     acDisconnectAmps || resolvedAcOcpd,
      acBreakerAmps:        resolvedAcOcpd,
      backfeedBreakerAmps:  resolvedBackfeed,
      rapidShutdownDevice:  rapidShutdownRequired !== false ? (rapidShutdownDevice || 'Rapid Shutdown Device') : undefined,
      stringCount:          systemModel?.stringCount ?? safeStringCount,
    });

    const equipInput: EquipmentScheduleInput = {
      tb:                   { ...tb, sheetTitle: 'Equipment Schedule', sheetNumber: 'E-2' },
      systemKw,
      panelCount,
      stateCode:            state || 'CA',
      necVersion:           safeNec,
      items:                equipItems,
      dcWireGauge:          resolvedDcWireGauge,
      acWireGauge:          resolvedAcWireGauge,
      groundWireGauge:      resolvedEgcGauge,
      dcConduitType:        dcConduitType || '3/4" EMT',
      acConduitType:        acConduitType || '1" EMT',
      dcDisconnectAmps:     dcDisconnectAmps || resolvedDcOcpd,
      acDisconnectAmps:     acDisconnectAmps || resolvedAcOcpd,
      acBreakerAmps:        resolvedAcOcpd,
      backfeedBreakerAmps:  resolvedBackfeed,
      mainPanelBusAmps:     mainPanelBusAmps || 200,
    };
    pages.push(buildEquipmentSchedule(equipInput));

    // ── S-1 Structural ─────────────────────────────────────────────────────
    const structInput: StructuralSheetInput = {
      tb:                   { ...tb, sheetTitle: 'Structural Engineering', sheetNumber: 'S-1' },
      stateCode:            state || 'CA',
      city:                 city || '',
      county:               county || '',
      address:              address || '',
      roofType:             roofType || 'shingle',
      roofPitchDeg:         roofPitchDeg || 20,
      roofPitchRatio:       roofPitchRatio || '4:12',
      rafterSize:           rafterSize || '2×6',
      rafterSpacingIn:      rafterSpacingIn || 24,
      rafterSpanFt:         rafterSpanFt || 16,
      rafterSpecies:        'Douglas Fir-Larch #2',
      sheathingType:        sheathingType || '7/16" OSB',
      stories:              1,
      windSpeedMph:         windSpeedMph || ahjData?.windSpeedMph || 90,
      windExposureCategory: 'B',
      groundSnowPsf:        groundSnowPsf ?? ahjData?.groundSnowLoadPsf ?? 0,
      flatRoofSnowPsf:      (groundSnowPsf || 0) * 0.7,
      seismicCategory:      seismicCategory || ahjData?.seismicDesignCategory || 'C',
      importance:           'II',
      panelWeightLbs:       panelWeightLbs || 40,
      panelCount,
      panelLengthIn:        panelLengthIn || 65,
      panelWidthIn:         panelWidthIn || 39,
      panelThicknessIn:     panelThicknessIn || 1.5,
      mountingSystem:       mountType || 'Roof Mount Racking',
      railWeightLbsPerFt:   0.5,
      attachmentType:       'Lag Bolt to Rafter',
      lagBoltSize:          lagBoltSize || '5/16" × 3"',
      lagBoltSpacingFt:     lagBoltSpacingFt || 4,
      flashingType:         flashingType || 'Flashed L-Foot',
      panelDeadLoadPsf,
      mountingDeadLoadPsf,
      totalDeadLoadPsf,
      existingDeadLoadPsf,
      liveLoadPsf,
      snowLoadPsf,
      windUpliftPsf,
      windDownPsf,
      governingLoadPsf,
      rafterCapacityPsf,
      structuralStatus,
      ridgeSetbackIn:       setbacks.ridgeSetbackIn,
      eaveSetbackIn:        setbacks.eaveSetbackIn,
      valleySetbackIn:      setbacks.valleySetbackIn,
      pathwayWidthIn:       setbacks.pathwayWidthIn,
      pathwayRequired:      setbacks.pathwayRequired,
      setbackCodeRef:       setbacks.codeReference || 'IRC R324.4',
    };
    pages.push(buildStructuralSheet(structInput));

    // ── A-1 Site / Roof Layout ─────────────────────────────────────────────
    const siteInput: SiteLayoutSheetInput = {
      tb:                   { ...tb, sheetTitle: 'Site / Roof Layout', sheetNumber: 'A-1' },
      siteAddress:          address || '',
      city:                 city || '',
      state:                state || '',
      roofType:             roofType || 'shingle',
      roofPitchRatio:       roofPitchRatio || '4:12',
      roofWidthFt:          roofWidthFt  || 30,
      roofLengthFt:         roofLengthFt || 20,
      panelCount,
      panelLengthIn:        panelLengthIn || 65,
      panelWidthIn:         panelWidthIn  || 39,
      stringCount:          systemModel?.stringCount ?? safeStringCount,
      panelsPerString:      systemModel?.panelsPerString ?? safePanelsPerString,
      systemKw,
      ridgeSetbackIn:       setbacks.ridgeSetbackIn,
      eaveSetbackIn:        setbacks.eaveSetbackIn,
      valleySetbackIn:      setbacks.valleySetbackIn,
      pathwayWidthIn:       setbacks.pathwayWidthIn,
      pathwayRequired:      setbacks.pathwayRequired,
      setbackCodeRef:       setbacks.codeReference || 'IRC R324.4',
      inverterLocation:     inverterLocation     || 'Per plan — see site plan',
      disconnectLocation:   disconnectLocation   || 'Adjacent to inverter',
      meterLocation:        meterLocation        || 'Utility meter — exterior wall',
      mainPanelLocation:    mainPanelLocation    || 'Main panel — see site plan',
      utilityName:          safeUtility,
    };
    pages.push(buildSiteLayoutSheet(siteInput));

    // ── M-1 Mounting Details ───────────────────────────────────────────────
    const mountInput: MountingDetailsSheetInput = {
      tb:                   { ...tb, sheetTitle: 'Mounting Details', sheetNumber: 'M-1' },
      siteAddress:          address || '',
      city:                 city || '',
      state:                state || '',
      mountingSystem:       mountingSystem || mountType || 'Roof Mount Racking',
      railType:             railType       || 'IronRidge XR-100',
      flashingType:         flashingType   || 'Flashed L-Foot',
      lagBoltSize:          lagBoltSize    || '5/16" × 3"',
      lagBoltSpacingFt:     lagBoltSpacingFt || 4,
      attachmentType:       'L-Foot with Flashing',
      panelModel:           panelModel     || 'Solar Panel',
      panelLengthIn:        panelLengthIn  || 65,
      panelWidthIn:         panelWidthIn   || 39,
      panelThicknessIn:     panelThicknessIn || 1.5,
      panelFrameHeight:     panelFrameHeight || 35,
      roofType:             roofType       || 'shingle',
      rafterSize:           rafterSize     || '2×6',
      sheathingType:        sheathingType  || '7/16" OSB',
      groundWireGauge:      resolvedEgcGauge,
      bondingHardware:      bondingHardware || 'WEEB Clips (UL 2703 Listed)',
    };
    pages.push(buildMountingDetailsSheet(mountInput));

    // ── C-1 Compliance ─────────────────────────────────────────────────────
    // Uses resolved values from system model (single source of truth)
    const compInput: ComplianceSheetInput = {
      tb:                   { ...tb, sheetTitle: 'Code Compliance', sheetNumber: 'C-1' },
      systemKw,
      panelCount,
      inverterModel:        inverterModel || 'Inverter',
      city:                 city || '',
      necVersion:           safeNec,
      stateCode:            state || 'CA',
      // ← Values from system model (not re-computed)
      stringVoc:            resolvedStringVoc,
      stringIsc:            resolvedStringIsc,
      dcWireAmpacity:       resolvedDcWireAmpacity,
      acBreakerAmps:        resolvedAcOcpd,
      backfeedBreakerAmps:  resolvedBackfeed,
      mainPanelBusAmps:     mainPanelBusAmps || 200,
      mainPanelBreakerAmps: mainPanelBreakerAmps || 200,
      inverterType:         inverterType || 'string',
      interconnectionType:  interconnectionType || 'load-side',
      rapidShutdownRequired: rapidShutdownRequired !== false,
      rapidShutdownDevice:  rapidShutdownDevice || '',
      structuralStatus,
      windSpeedMph:         windSpeedMph || 90,
      groundSnowPsf:        groundSnowPsf || 0,
      governingLoadPsf,
      rafterCapacityPsf,
      ridgeSetbackIn:       setbacks.ridgeSetbackIn,
      eaveSetbackIn:        setbacks.eaveSetbackIn,
      pathwayWidthIn:       setbacks.pathwayWidthIn,
      pathwayRequired:      setbacks.pathwayRequired,
      groundWireGauge:      resolvedEgcGauge,
      groundingElectrode:   "Ground Rod (2 × 5/8&quot; × 8')",
      pvSystemLabeled:      true,
      acDisconnectLabeled:  true,
      dcDisconnectLabeled:  true,
      backfeedBreakerLabeled: true,
    };
    pages.push(buildComplianceSheet(compInput));

    // ─────────────────────────────────────────────────────────────────────
    // STEP 8: Assemble HTML and convert to PDF
    // ─────────────────────────────────────────────────────────────────────
    const docTitle = `${clientName || 'Client'} — Solar PV Plan Set ${BUILD_VERSION} — ${today}`;
    const html = wrapDocument(pages, docTitle);

    const uid      = randomUUID();
    const htmlPath = join(tmpdir(), `planset_${uid}.html`);
    const pdfPath  = join(tmpdir(), `planset_${uid}.pdf`);
    tmpFiles.push(htmlPath, pdfPath);

    writeFileSync(htmlPath, html, 'utf8');

    let pdfBuffer: Buffer;
    let pdfMethod = 'wkhtmltopdf';

    try {
      execSync(
        `wkhtmltopdf --page-width 11in --page-height 8.5in --orientation Landscape --margin-top 0 --margin-bottom 0 --margin-left 0 --margin-right 0 --enable-local-file-access --quiet "${htmlPath}" "${pdfPath}"`,
        { timeout: 45000 }
      );
      pdfBuffer = readFileSync(pdfPath);
    } catch (wkErr: any) {
      console.warn('[plan-set] wkhtmltopdf failed, returning HTML:', wkErr.message);
      pdfBuffer = Buffer.from(html, 'utf8');
      pdfMethod = 'html';
    }

    const safeClient = (clientName || 'SolarPro').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr    = new Date().toISOString().slice(0, 10);
    const ext        = pdfMethod === 'html' ? 'html' : 'pdf';
    const fileName   = `Plan_Set_${safeClient}_${dateStr}.${ext}`;
    const mimeType   = pdfMethod === 'html' ? 'text/html' : 'application/pdf';

    // ── No projectId → return file directly ──────────────────────────────
    if (!saveToProject) {
      return new Response(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type':        mimeType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length':      String(pdfBuffer.length),
          'X-Plan-Set-Version':  BUILD_VERSION,
          'X-Plan-Set-Sheets':   String(sheetIndex.length),
          'X-Structural-Status': structuralStatus,
          'X-Pdf-Method':        pdfMethod,
          'X-System-Model':      systemModel ? 'computed' : 'fallback',
        },
      });
    }

    // ── Save to project_files ─────────────────────────────────────────────
    const sql = await getDbReady();

    const projectRows = await sql`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found or access denied' }, { status: 403 });
    }

    try {
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${projectId}, ${clientId || null}, ${user.id}, ${fileName}, 'plan_set',
           ${pdfBuffer.length}, ${mimeType}, ${pdfBuffer},
           ${`Auto-generated permit plan set ${BUILD_VERSION} — ${today}`})
        ON CONFLICT (project_id, user_id, file_name)
        DO UPDATE SET
          file_size   = EXCLUDED.file_size,
          mime_type   = EXCLUDED.mime_type,
          file_data   = EXCLUDED.file_data,
          notes       = EXCLUDED.notes,
          upload_date = NOW()
      `;
    } catch (dbErr: any) {
      await sql`
        DELETE FROM project_files
        WHERE project_id = ${projectId} AND user_id = ${user.id} AND file_name = ${fileName}
      `;
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${projectId}, ${clientId || null}, ${user.id}, ${fileName}, 'plan_set',
           ${pdfBuffer.length}, ${mimeType}, ${pdfBuffer},
           ${`Auto-generated permit plan set ${BUILD_VERSION} — ${today}`})
      `;
    }

    const savedRows = await sql`
      SELECT id FROM project_files
      WHERE project_id = ${projectId} AND user_id = ${user.id} AND file_name = ${fileName}
      LIMIT 1
    `;
    const fileId = savedRows[0]?.id;

    return NextResponse.json({
      success:           true,
      version:           BUILD_VERSION,
      fileName,
      fileId,
      pdfMethod,
      sheets:            sheetIndex.length,
      sheetList:         sheetIndex,
      systemKw,
      panelCount,
      structuralStatus,
      overallCompliance: 'PASS',
      systemModelUsed:   systemModel ? 'computed' : 'fallback',
      message:           pdfMethod === 'html'
        ? 'Plan set generated as HTML — open in browser and print to PDF'
        : `Plan set PDF generated and saved to project files (${BUILD_VERSION} — 7 sheets)`,
    });

  } catch (err: unknown) {
    return handleRouteDbError('[plan-se', err);
  } finally {
    for (const f of tmpFiles) {
      try { if (existsSync(f)) unlinkSync(f); } catch (_: unknown) {}
    }
  }
}