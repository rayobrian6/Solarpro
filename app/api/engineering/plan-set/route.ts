// ============================================================
// /api/engineering/plan-set
// POST — Generate a permit-grade plan set PDF from engineering data.
// Assembles all sheets into a single HTML document, converts to PDF
// using wkhtmltopdf (installed on server), saves to project_files.
//
// Sheets generated:
//   G-1  Cover Sheet
//   E-1  Electrical — Single-Line Diagram + Wire Schedule
//   E-2  Equipment Schedule + BOM
//   S-1  Structural Engineering
//   C-1  Code Compliance Checklist
//
// GET — Check if a plan set exists for a project
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { buildCoverSheet, type CoverSheetInput } from '@/lib/plan-set/cover-sheet';
import { buildElectricalSheet, type ElectricalSheetInput } from '@/lib/plan-set/electrical-sheet';
import { buildStructuralSheet, type StructuralSheetInput } from '@/lib/plan-set/structural-sheet';
import { buildEquipmentSchedule, buildDefaultEquipmentItems, type EquipmentScheduleInput } from '@/lib/plan-set/equipment-schedule';
import { buildComplianceSheet, type ComplianceSheetInput } from '@/lib/plan-set/compliance-sheet';
import { wrapDocument, type TitleBlockData, fmtDate } from '@/lib/plan-set/title-block';
import { searchAhj } from '@/lib/jurisdictions/ahj-national';
import { calcFireSetbacks } from '@/lib/engineering/fire-setbacks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── GET — check if plan set exists ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });

    const sql = await getDb();
    const rows = await sql`
      SELECT id, file_name, file_size, upload_date
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type = 'plan_set'
      ORDER BY upload_date DESC
      LIMIT 5
    `;

    return NextResponse.json({ success: true, planSets: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ─── POST — generate plan set ─────────────────────────────────────────────────
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
      inverterType,
      inverterModel,
      inverterManufacturer,
      inverterCount,
      inverterKw,
      inverterVacOut,
      inverterMaxDcV,
      inverterMaxAcA,
      mountType,
      roofType,
      roofPitchDeg,
      roofPitchRatio,
      rafterSize,
      rafterSpacingIn,
      rafterSpanFt,
      // Electrical
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
      contractorPhone,
      contractorEmail,
      designerName,
      annualKwh,
    } = body;

    // ── Validate required fields ──────────────────────────────────────────
    if (!systemKw || !panelCount) {
      return NextResponse.json({ success: false, error: 'Missing required fields: systemKw, panelCount' }, { status: 400 });
    }
    // projectId is optional — if missing, we generate and return the PDF directly (no DB save)</thinking>
    const saveToProject = !!projectId;

    // ── Look up AHJ data ──────────────────────────────────────────────────
    let ahjData: any = null;
    try {
      const ahjResults = searchAhj({ stateCode: state, city, text: ahj });
      if (ahjResults.length > 0) ahjData = ahjResults[0];
    } catch (_) {}

    // ── Calculate fire setbacks ───────────────────────────────────────────
    let setbacks: any = { ridgeSetbackIn: 18, eaveSetbackIn: 18, valleySetbackIn: 18, pathwayWidthIn: 36, pathwayRequired: true, codeReference: 'IRC R324.4' };
    try {
      setbacks = calcFireSetbacks({
        roofType: roofType || 'shingle',
        roofPitchDeg: roofPitchDeg || 20,
        stateCode: state || 'CA',
        fireZone: 'standard',
        systemSizeKw: systemKw,
        stories: 1,
        buildingType: 'residential',
      });
    } catch (_) {}

    // ── Derive computed values ────────────────────────────────────────────
    const safeStrings = (strings && strings.length > 0) ? strings : [{
      id: 'S1', label: 'S1',
      panelCount: panelCount,
      panelWatts: panelWatts || 400,
      wireGauge: dcWireGauge || '#10 AWG',
      conduitType: dcConduitType || '3/4" EMT',
      wireLength: 50,
      ocpdAmps: 15,
      stringVoc: (inverterMaxDcV || 600) * 0.8,
      stringVmp: (inverterMaxDcV || 600) * 0.7,
      stringIsc: 10,
      stringImp: 9.5,
    }];

    const firstString = safeStrings[0];
    const stringVoc   = firstString.stringVoc || 400;
    const stringIsc   = firstString.stringIsc || 10;

    // Wire ampacity lookup (simplified — #10=30A, #8=40A, #6=55A, #4=70A, #2=95A)
    const wireAmpacity: Record<string, number> = {
      '#10 AWG': 30, '#8 AWG': 40, '#6 AWG': 55, '#4 AWG': 70, '#2 AWG': 95, '#1 AWG': 110,
      '#1/0 AWG': 125, '#2/0 AWG': 145, '#3/0 AWG': 165, '#4/0 AWG': 195,
    };
    const dcWireAmpacity = wireAmpacity[dcWireGauge || '#10 AWG'] || 30;

    // Structural loads
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

    // Rafter capacity (simplified — 2×6@24"OC = ~35psf, 2×6@16"OC = ~52psf, 2×8@24"OC = ~55psf)
    const rafterCapacityMap: Record<string, Record<number, number>> = {
      '2×6': { 12: 75, 16: 52, 24: 35 },
      '2×8': { 12: 95, 16: 70, 24: 55 },
      '2×10': { 12: 120, 16: 90, 24: 70 },
      '2×12': { 12: 150, 16: 115, 24: 90 },
    };
    const rafterKey = rafterSize || '2×6';
    const spacingKey = rafterSpacingIn || 24;
    const rafterCapacityPsf = rafterCapacityMap[rafterKey]?.[spacingKey] ?? 35;
    const structuralStatus = governingLoadPsf <= rafterCapacityPsf ? 'PASS' : 'FAIL';

    // ── Build title block data ────────────────────────────────────────────
    const today = fmtDate();
    const safeNec = necVersion || (ahjData?.necVersion) || 'NEC 2020';
    const safeAhj = ahj || ahjData?.ahjName || `${city || ''}, ${state || ''} Building Dept.`;
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
      sheetTitle:     '',   // set per sheet
      sheetNumber:    '',   // set per sheet
      totalSheets:    5,
      revision:       '0',
      preparedBy:     designerName || 'SolarPro',
      preparedDate:   today,
      necVersion:     safeNec,
      ibcVersion:     'IBC 2021',
      asceVersion:    'ASCE 7-22',
    };

    // ── Sheet index ───────────────────────────────────────────────────────
    const sheetIndex = [
      { number: 'G-1', title: 'Cover Sheet',         description: 'Project summary, AHJ info, scope of work, general notes' },
      { number: 'E-1', title: 'Electrical / SLD',    description: 'Single-line diagram, wire schedule, NEC compliance' },
      { number: 'E-2', title: 'Equipment Schedule',  description: 'Bill of materials, cut sheet references, installation notes' },
      { number: 'S-1', title: 'Structural',          description: 'Roof loading analysis, attachment schedule, fire setbacks' },
      { number: 'C-1', title: 'Compliance',          description: 'NEC 690/705, structural, fire access compliance checklist' },
    ];

    // ── Build each sheet ──────────────────────────────────────────────────
    const pages: string[] = [];

    // G-1 Cover Sheet
    const coverInput: CoverSheetInput = {
      tb: { ...tb, sheetTitle: 'Cover Sheet', sheetNumber: 'G-1' },
      projectName:      projectName || `${clientName} Solar PV System`,
      clientName:       clientName || 'Client',
      siteAddress:      address || '',
      city:             city || '',
      state:            state || '',
      zip:              zip || '',
      county:           county || '',
      parcelNumber,
      projectDate:      today,
      systemKw,
      panelCount,
      panelModel:       panelModel || 'Solar Panel',
      panelWatts:       panelWatts || 400,
      inverterType:     inverterType || 'String',
      inverterModel:    inverterModel || 'Inverter',
      mountType:        mountType || 'Roof Mount',
      roofType,
      batteryModel:     hasBattery ? batteryModel : undefined,
      batteryKwh:       hasBattery ? batteryKwh : undefined,
      annualKwh,
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
      contractorPhone,
      contractorEmail,
      designerName:     designerName || 'SolarPro',
      sheets:           sheetIndex,
    };
    pages.push(buildCoverSheet(coverInput));

    // E-1 Electrical / SLD
    const elecInput: ElectricalSheetInput = {
      tb: { ...tb, sheetTitle: 'Electrical / SLD', sheetNumber: 'E-1' },
      inverterType:          inverterType || 'string',
      inverterModel:         inverterModel || 'Inverter',
      inverterCount:         inverterCount || 1,
      inverterKw:            inverterKw || systemKw,
      inverterVacOut:        inverterVacOut || 240,
      inverterMaxDcV:        inverterMaxDcV || 600,
      inverterMaxAcA:        inverterMaxAcA || (systemKw * 1000 / 240),
      strings:               safeStrings,
      dcDisconnectAmps:      dcDisconnectAmps || 30,
      dcDisconnectVoltage:   dcDisconnectVoltage || 600,
      dcWireGauge:           dcWireGauge || '#10 AWG',
      dcConduitType:         dcConduitType || '3/4" EMT',
      acWireGauge:           acWireGauge || '#8 AWG',
      acConduitType:         acConduitType || '1" EMT',
      acBreakerAmps:         acBreakerAmps || 20,
      acDisconnectAmps:      acDisconnectAmps || 30,
      mainPanelBusAmps:      mainPanelBusAmps || 200,
      mainPanelBreakerAmps:  mainPanelBreakerAmps || 200,
      backfeedBreakerAmps:   backfeedBreakerAmps || 20,
      interconnectionType:   interconnectionType || 'load-side',
      interconnectionMethod: interconnectionMethod || 'Backfeed Breaker',
      rapidShutdownRequired: rapidShutdownRequired !== false,
      rapidShutdownDevice:   rapidShutdownDevice || 'Per Manufacturer Spec',
      hasBattery:            !!hasBattery,
      batteryModel,
      batteryKwh,
      batteryBreakerAmps,
      groundWireGauge:       groundWireGauge || '#8 AWG',
      groundingElectrode:    "Ground Rod (2 × 5/8&quot; × 8')",
      necVersion:            safeNec,
      systemKw,
      panelCount,
      panelModel:            panelModel || 'Solar Panel',
      stateCode:             state || 'CA',
      utilityName:           safeUtility,
    };
    pages.push(buildElectricalSheet(elecInput));

    // E-2 Equipment Schedule
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
      dcWireGauge:          dcWireGauge || '#10 AWG',
      acWireGauge:          acWireGauge || '#8 AWG',
      groundWireGauge:      groundWireGauge || '#8 AWG',
      dcConduitType:        dcConduitType || '3/4" EMT',
      acConduitType:        acConduitType || '1" EMT',
      dcDisconnectAmps:     dcDisconnectAmps || 30,
      acDisconnectAmps:     acDisconnectAmps || 30,
      acBreakerAmps:        acBreakerAmps || 20,
      backfeedBreakerAmps:  backfeedBreakerAmps || 20,
      rapidShutdownDevice:  rapidShutdownRequired !== false ? (rapidShutdownDevice || 'Rapid Shutdown Device') : undefined,
      stringCount:          safeStrings.length,
    });

    const equipInput: EquipmentScheduleInput = {
      tb: { ...tb, sheetTitle: 'Equipment Schedule', sheetNumber: 'E-2' },
      systemKw,
      panelCount,
      stateCode:            state || 'CA',
      necVersion:           safeNec,
      items:                equipItems,
      dcWireGauge:          dcWireGauge || '#10 AWG',
      acWireGauge:          acWireGauge || '#8 AWG',
      groundWireGauge:      groundWireGauge || '#8 AWG',
      dcConduitType:        dcConduitType || '3/4" EMT',
      acConduitType:        acConduitType || '1" EMT',
      dcDisconnectAmps:     dcDisconnectAmps || 30,
      acDisconnectAmps:     acDisconnectAmps || 30,
      acBreakerAmps:        acBreakerAmps || 20,
      backfeedBreakerAmps:  backfeedBreakerAmps || 20,
      mainPanelBusAmps:     mainPanelBusAmps || 200,
    };
    pages.push(buildEquipmentSchedule(equipInput));

    // S-1 Structural
    const structInput: StructuralSheetInput = {
      tb: { ...tb, sheetTitle: 'Structural Engineering', sheetNumber: 'S-1' },
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
      sheathingType:        '7/16" OSB',
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
      panelThicknessIn:     1.5,
      mountingSystem:       mountType || 'Roof Mount Racking',
      railWeightLbsPerFt:   0.5,
      attachmentType:       'Lag Bolt to Rafter',
      lagBoltSize:          '5/16" × 3"',
      lagBoltSpacingFt:     4,
      flashingType:         'Flashed L-Foot',
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

    // C-1 Compliance
    const compInput: ComplianceSheetInput = {
      tb: { ...tb, sheetTitle: 'Code Compliance', sheetNumber: 'C-1' },
      systemKw,
      panelCount,
      necVersion:           safeNec,
      stateCode:            state || 'CA',
      stringVoc,
      stringIsc,
      dcWireAmpacity,
      acBreakerAmps:        acBreakerAmps || 20,
      backfeedBreakerAmps:  backfeedBreakerAmps || 20,
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
      groundWireGauge:      groundWireGauge || '#8 AWG',
      groundingElectrode:   "Ground Rod (2 × 5/8&quot; × 8')",
      pvSystemLabeled:      true,
      acDisconnectLabeled:  true,
      dcDisconnectLabeled:  true,
      backfeedBreakerLabeled: true,
    };
    pages.push(buildComplianceSheet(compInput));

    // ── Assemble HTML document ────────────────────────────────────────────
    const docTitle = `${clientName || 'Client'} — Solar PV Plan Set — ${today}`;
    const html = wrapDocument(pages, docTitle);

    // ── Convert to PDF via wkhtmltopdf ────────────────────────────────────
    const uid = randomUUID();
    const htmlPath = join(tmpdir(), `planset_${uid}.html`);
    const pdfPath  = join(tmpdir(), `planset_${uid}.pdf`);
    tmpFiles.push(htmlPath, pdfPath);

    writeFileSync(htmlPath, html, 'utf8');

    let pdfBuffer: Buffer;
    let pdfMethod = 'wkhtmltopdf';

    try {
      // Try wkhtmltopdf first (best quality)
      execSync(
        `wkhtmltopdf --page-size Letter --orientation Landscape --margin-top 0 --margin-bottom 0 --margin-left 0 --margin-right 0 --print-media-type --enable-local-file-access --quiet "${htmlPath}" "${pdfPath}"`,
        { timeout: 45000 }
      );
      pdfBuffer = readFileSync(pdfPath);
    } catch (wkErr: any) {
      // Fallback: return HTML as the "PDF" (client can print-to-PDF)
      console.warn('[plan-set] wkhtmltopdf failed, returning HTML:', wkErr.message);
      pdfBuffer = Buffer.from(html, 'utf8');
      pdfMethod = 'html';
    }

    // ── Prepare file metadata ─────────────────────────────────────────────
    const safeClient = (clientName || 'SolarPro').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr    = new Date().toISOString().slice(0, 10);
    const ext        = pdfMethod === 'html' ? 'html' : 'pdf';
    const fileName   = `Plan_Set_${safeClient}_${dateStr}.${ext}`;
    const mimeType   = pdfMethod === 'html' ? 'text/html' : 'application/pdf';

    // ── No projectId → return file directly as download ────────────────────────
    if (!saveToProject) {
      return new Response(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type':        mimeType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length':      String(pdfBuffer.length),
          'X-Plan-Set-Sheets':   String(sheetIndex.length),
          'X-Structural-Status': structuralStatus,
          'X-Pdf-Method':        pdfMethod,
        },
      });
    }

    // ── Save to project_files ─────────────────────────────────────────────
    const sql = await getDb();

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
           ${'Auto-generated permit plan set — ' + today})
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
           ${'Auto-generated permit plan set — ' + today})
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
      fileName,
      fileId,
      pdfMethod,
      sheets:            sheetIndex.length,
      sheetList:         sheetIndex,
      systemKw,
      panelCount,
      structuralStatus,
      overallCompliance: compInput.rapidShutdownRequired ? 'REVIEW' : 'PASS',
      message:           pdfMethod === 'html'
        ? 'Plan set generated as HTML — open in browser and print to PDF'
        : 'Plan set PDF generated and saved to project files',
    });

  } catch (err: any) {
    console.error('[plan-set] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    // Cleanup temp files
    for (const f of tmpFiles) {
      try { if (existsSync(f)) unlinkSync(f); } catch (_) {}
    }
  }
}