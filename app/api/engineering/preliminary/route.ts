// ============================================================
// POST /api/engineering/preliminary
// Full Client Engineering Pipeline — Bill Upload → Auto-Workspace
//
// When a bill is uploaded this endpoint:
//   1. Calculates system size + panel count from kWh
//   2. Generates BOM (generateBOMV4)
//   3. Generates preliminary SLD (renderSLDProfessional)
//   4. Saves a synthetic layout record → proposal shows real data
//   5. Saves a synthetic production record → proposal shows production
//   6. Saves engineering workspace files to project_files:
//      - Bill Data summary
//      - System Estimate
//      - Engineering Packet (full text report)
//      - SLD SVG
//      - BOM
//   7. Returns full structured data for the modal
//
// NO manual panel placement required.
// Contractors open the workspace and modify before final submission.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { generateBOMV4, bomToMarkdown } from '@/lib/bom-engine-v4';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { upsertLayout, upsertProduction, getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// ── Default equipment for preliminary estimates ──────────────────────────────
const DEFAULTS = {
  panelWatts:           440,
  panelModel:           'Generic 440W Monocrystalline',
  panelVoc:             49.5,
  panelIsc:             11.2,
  panelId:              'qcells-peak-duo-400',
  inverterId:           'enphase-iq8plus',
  inverterModel:        'IQ8+',
  inverterManufacturer: 'Enphase',
  rackingId:            'ironridge-xr100',
  topologyType:         'MICROINVERTER' as const,
  roofType:             'shingle',
  mainPanelAmps:        200,
  dcWireGauge:          '#10 AWG',
  acWireGauge:          '#10 AWG',
  conduitType:          'EMT',
  acWireLength:         60,
};

const COST_LOW  = 2.75;  // $/W
const COST_HIGH = 3.50;  // $/W

// ── Production factor by state (kWh/kW/year) ─────────────────────────────────
function getProductionFactor(stateCode?: string | null): number {
  const f: Record<string, number> = {
    CA: 1600, AZ: 1650, NV: 1700, NM: 1650, TX: 1500, FL: 1500,
    HI: 1700, CO: 1550, UT: 1550, GA: 1400, SC: 1400, NC: 1350,
    VA: 1300, MD: 1250, DC: 1250, PA: 1200, NJ: 1150, NY: 1150,
    CT: 1150, MA: 1150, RI: 1150, NH: 1100, VT: 1100, ME: 1100,
    IL: 1280, IN: 1250, OH: 1200, MI: 1150, WI: 1200, MN: 1200,
    IA: 1250, MO: 1300, KS: 1350, NE: 1300, SD: 1300, ND: 1250,
    MT: 1300, WY: 1350, ID: 1350, OR: 1200, WA: 1150, AK: 1000,
  };
  return stateCode ? (f[stateCode.toUpperCase()] ?? 1250) : 1250;
}

// ── Monthly production distribution by state ─────────────────────────────────
function getMonthlyDistribution(stateCode?: string | null): number[] {
  // Normalized monthly factors (sum = 12) — IL/Midwest default
  const midwest = [0.55, 0.65, 0.85, 1.00, 1.10, 1.15, 1.15, 1.10, 1.00, 0.85, 0.60, 0.50];
  const south   = [0.75, 0.80, 0.95, 1.05, 1.10, 1.10, 1.05, 1.05, 1.00, 0.95, 0.80, 0.70];
  const west    = [0.70, 0.80, 1.00, 1.10, 1.15, 1.15, 1.10, 1.10, 1.05, 0.95, 0.75, 0.65];
  const ne      = [0.50, 0.60, 0.80, 1.00, 1.15, 1.20, 1.20, 1.15, 1.00, 0.80, 0.55, 0.45];

  const sc = (stateCode || '').toUpperCase();
  if (['CA','AZ','NV','NM','UT','CO','OR','WA','ID','MT','WY'].includes(sc)) return west;
  if (['TX','FL','GA','SC','NC','VA','AL','MS','LA','AR','TN'].includes(sc)) return south;
  if (['NY','NJ','CT','MA','RI','NH','VT','ME','PA','MD','DC'].includes(sc)) return ne;
  return midwest;
}

// ── Save file to project_files table ─────────────────────────────────────────
async function saveProjectFile(sql: any, params: {
  projectId: string;
  clientId:  string | null;
  userId:    string;
  fileName:  string;
  fileType:  string;
  mimeType:  string;
  content:   string;   // text content
  notes:     string;
}) {
  try {
    const buf = Buffer.from(params.content, 'utf8');
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${params.projectId}, ${params.clientId}, ${params.userId},
         ${params.fileName}, ${params.fileType}, ${buf.length},
         ${params.mimeType}, ${buf}, ${params.notes})
    `;
    return true;
  } catch (e: any) {
    console.warn('[preliminary] saveProjectFile failed:', e.message);
    return false;
  }
}

// ── Save SVG file to project_files ───────────────────────────────────────────
async function saveSvgFile(sql: any, params: {
  projectId: string;
  clientId:  string | null;
  userId:    string;
  fileName:  string;
  svg:       string;
  notes:     string;
}) {
  try {
    const buf = Buffer.from(params.svg, 'utf8');
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${params.projectId}, ${params.clientId}, ${params.userId},
         ${params.fileName}, 'engineering', ${buf.length},
         'image/svg+xml', ${buf}, ${params.notes})
    `;
    return true;
  } catch (e: any) {
    console.warn('[preliminary] saveSvgFile failed:', e.message);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      annualKwh,
      monthlyKwh,
      utilityName,
      serviceAddress,
      clientName,
      projectName,
      stateCode,
      electricityRate,
      projectId,
      clientId,
    } = body;

    // ── Step 1: Resolve annual kWh ────────────────────────────────────────────
    const annualUsage: number =
      (annualKwh && annualKwh > 0) ? annualKwh :
      (monthlyKwh && monthlyKwh > 0) ? monthlyKwh * 12 : 0;

    if (annualUsage === 0) {
      return NextResponse.json({ success: false, error: 'annualKwh or monthlyKwh required' }, { status: 400 });
    }

    // ── Step 2: System sizing ─────────────────────────────────────────────────
    const productionFactor = getProductionFactor(stateCode);
    const systemKw         = Math.round((annualUsage / productionFactor) * 10) / 10;
    const panelKw          = DEFAULTS.panelWatts / 1000;
    const panelCount       = Math.ceil(systemKw / panelKw);
    const systemWatts      = systemKw * 1000;

    // ── Step 3: Electrical sizing ─────────────────────────────────────────────
    const acOutputAmps = Math.round((systemKw * 1000) / 240);
    const acOCPD       = Math.ceil(acOutputAmps * 1.25 / 5) * 5;
    const backfeedAmps = acOCPD;

    // ── Step 4: Cost estimate ─────────────────────────────────────────────────
    const costLow  = Math.round(systemWatts * COST_LOW);
    const costHigh = Math.round(systemWatts * COST_HIGH);

    // ── Step 5: Monthly production breakdown ──────────────────────────────────
    const dist = getMonthlyDistribution(stateCode);
    const distSum = dist.reduce((a, b) => a + b, 0);
    const monthlyProduction = dist.map(d =>
      Math.round((annualUsage * (d / distSum)))
    );
    // Adjust for rounding
    const prodSum = monthlyProduction.reduce((a, b) => a + b, 0);
    monthlyProduction[6] += (annualUsage - prodSum);

    // ── Step 6: Generate BOM ──────────────────────────────────────────────────
    let bomData: any = null;
    let bomMarkdown  = '';
    try {
      const bomInput = {
        inverterId:            DEFAULTS.inverterId,
        rackingId:             DEFAULTS.rackingId,
        panelId:               DEFAULTS.panelId,
        moduleCount:           panelCount,
        deviceCount:           panelCount,
        stringCount:           1,
        inverterCount:         panelCount,
        systemKw,
        dcWireGauge:           DEFAULTS.dcWireGauge,
        acWireGauge:           DEFAULTS.acWireGauge,
        dcWireLength:          50,
        acWireLength:          DEFAULTS.acWireLength,
        conduitType:           DEFAULTS.conduitType,
        conduitSizeInch:       '3/4',
        roofType:              DEFAULTS.roofType,
        attachmentCount:       Math.ceil(panelCount / 2) + 2,
        railSections:          Math.ceil(panelCount / 4),
        mainPanelAmps:         DEFAULTS.mainPanelAmps,
        backfeedAmps,
        acOCPD,
        dcOCPD:                20,
        requiresACDisconnect:  true,
        requiresDCDisconnect:  false,
        requiresRapidShutdown: true,
        requiresWarningLabels: true,
        topologyType:          DEFAULTS.topologyType,
        interconnectionMethod: 'LOAD_SIDE',
        panelBusRating:        DEFAULTS.mainPanelAmps,
      };
      const bomResult = generateBOMV4(bomInput as any);
      bomData     = bomResult;
      bomMarkdown = bomToMarkdown(bomResult);
    } catch (e: any) {
      console.warn('[preliminary] BOM failed:', e.message);
    }

    // ── Step 7: Generate SLD ──────────────────────────────────────────────────
    let sldSvg = '';
    try {
      sldSvg = renderSLDProfessional({
        projectName:             projectName || `${clientName || 'Client'} — Solar`,
        clientName:              clientName  || 'Prospective Client',
        address:                 serviceAddress || '',
        designer:                user.name || 'SolarPro',
        drawingDate:             new Date().toLocaleDateString('en-US'),
        drawingNumber:           `PRELIM-${Date.now().toString(36).toUpperCase()}`,
        revision:                'P1',
        topologyType:            DEFAULTS.topologyType,
        totalModules:            panelCount,
        totalStrings:            1,
        panelModel:              DEFAULTS.panelModel,
        panelWatts:              DEFAULTS.panelWatts,
        panelVoc:                DEFAULTS.panelVoc,
        panelIsc:                DEFAULTS.panelIsc,
        dcWireGauge:             DEFAULTS.dcWireGauge,
        dcConduitType:           DEFAULTS.conduitType,
        dcOCPD:                  20,
        inverterModel:           DEFAULTS.inverterModel,
        inverterManufacturer:    DEFAULTS.inverterManufacturer,
        acOutputKw:              systemKw,
        acOutputAmps,
        acWireGauge:             DEFAULTS.acWireGauge,
        acConduitType:           DEFAULTS.conduitType,
        acOCPD,
        mainPanelAmps:           DEFAULTS.mainPanelAmps,
        backfeedAmps,
        utilityName:             utilityName || 'Local Utility',
        interconnection:         'LOAD_SIDE',
        rapidShutdownIntegrated: true,
        hasProductionMeter:      false,
        hasBattery:              false,
        batteryModel:            '',
        batteryKwh:              0,
        scale:                   'NTS',
        acWireLength:            DEFAULTS.acWireLength,
        panelsPerString:         1,
      } as any);
    } catch (e: any) {
      console.warn('[preliminary] SLD failed:', e.message);
    }

    // ── Step 8: Build report text ─────────────────────────────────────────────
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const annualSavings = electricityRate
      ? Math.round(annualUsage * electricityRate)
      : null;
    const paybackYears = annualSavings
      ? ((costLow + costHigh) / 2 / annualSavings).toFixed(1)
      : null;

    const reportText = buildReportText({
      clientName:      clientName || 'Prospective Client',
      serviceAddress:  serviceAddress || 'Address on file',
      utilityName:     utilityName || 'Local Utility',
      annualUsage,
      systemKw,
      panelCount,
      costLow,
      costHigh,
      electricityRate: electricityRate || null,
      annualSavings,
      paybackYears,
      productionFactor,
      stateCode:       stateCode || null,
      reportDate,
      bomMarkdown,
    });

    // ── Step 9: Save synthetic layout + production records ────────────────────
    // This makes the proposal page show real data immediately
    const savedFiles: string[] = [];

    if (projectId && user.id) {
      try {
        // Save synthetic layout (no actual panel coordinates — just sizing)
        await upsertLayout({
          projectId,
          userId:        user.id,
          systemType:    'roof',
          panels:        [],          // no placed panels yet
          totalPanels:   panelCount,
          systemSizeKw:  systemKw,
          groundTilt:    20,
          groundAzimuth: 180,
          rowSpacing:    1.5,
          groundHeight:  0.6,
          bifacialOptimized: false,
        });
        savedFiles.push('layout');
      } catch (e: any) {
        console.warn('[preliminary] layout save failed:', e.message);
      }

      try {
        // Save synthetic production record
        const co2Tons = Math.round(annualUsage * 0.000386 * 10) / 10;
        await upsertProduction({
          projectId,
          userId:      user.id,
          systemSizeKw: systemKw,
          panelCount,
          production: {
            id:                   '',
            projectId,
            layoutId:             '',
            annualProductionKwh:  annualUsage,
            monthlyProductionKwh: monthlyProduction,
            specificYield:        Math.round(annualUsage / systemKw),
            performanceRatio:     0.80,
            capacityFactor:       Math.round((annualUsage / (systemKw * 8760)) * 100) / 100,
            co2OffsetTons:        co2Tons,
            treesEquivalent:      Math.round(co2Tons * 16.5),
            offsetPercentage:     100,
            calculatedAt:         new Date().toISOString(),
          },
          costEstimate: {
            systemSizeKw:      systemKw,
            grossCost:         Math.round((costLow + costHigh) / 2),
            fixedCosts:        0,
            totalBeforeCredit: Math.round((costLow + costHigh) / 2),
            taxCredit:         Math.round((costLow + costHigh) / 2 * 0.30),
            netCost:           Math.round((costLow + costHigh) / 2 * 0.70),
            annualSavings:     annualSavings || Math.round(annualUsage * 0.13),
            paybackYears:      paybackYears ? parseFloat(paybackYears) : 8,
            lifetimeSavings:   (annualSavings || Math.round(annualUsage * 0.13)) * 25,
            roi:               0,
          },
        });
        savedFiles.push('production');
      } catch (e: any) {
        console.warn('[preliminary] production save failed:', e.message);
      }

      // ── Step 10: Save engineering workspace files ─────────────────────────
      const sql = getDb();

      // 10a. Bill Data summary
      const billDataText = buildBillDataSummary({
        clientName:      clientName || 'Prospective Client',
        serviceAddress:  serviceAddress || '',
        utilityName:     utilityName || '',
        annualUsage,
        monthlyKwh:      monthlyKwh || Math.round(annualUsage / 12),
        electricityRate: electricityRate || null,
        reportDate,
      });
      const billSaved = await saveProjectFile(sql, {
        projectId,
        clientId:  clientId || null,
        userId:    user.id,
        fileName:  `Bill_Data_${(clientName || 'client').replace(/[^a-z0-9]/gi, '_')}.txt`,
        fileType:  'utility_bill',
        mimeType:  'text/plain',
        content:   billDataText,
        notes:     'Auto-extracted bill data summary',
      });
      if (billSaved) savedFiles.push('bill_data');

      // 10b. System Estimate
      const estimateText = buildSystemEstimate({
        clientName:      clientName || 'Prospective Client',
        systemKw,
        panelCount,
        costLow,
        costHigh,
        annualUsage,
        annualSavings,
        paybackYears,
        reportDate,
      });
      const estimateSaved = await saveProjectFile(sql, {
        projectId,
        clientId:  clientId || null,
        userId:    user.id,
        fileName:  `System_Estimate_${systemKw}kW.txt`,
        fileType:  'engineering',
        mimeType:  'text/plain',
        content:   estimateText,
        notes:     'Auto-generated system size and cost estimate',
      });
      if (estimateSaved) savedFiles.push('system_estimate');

      // 10c. Full Engineering Packet
      const packetSaved = await saveProjectFile(sql, {
        projectId,
        clientId:  clientId || null,
        userId:    user.id,
        fileName:  `Engineering_Packet_${(clientName || 'client').replace(/[^a-z0-9]/gi, '_')}_${new Date().getFullYear()}.txt`,
        fileType:  'engineering',
        mimeType:  'text/plain',
        content:   reportText,
        notes:     'Preliminary engineering packet — auto-generated from bill upload',
      });
      if (packetSaved) savedFiles.push('engineering_packet');

      // 10d. SLD
      if (sldSvg) {
        const sldSaved = await saveSvgFile(sql, {
          projectId,
          clientId:  clientId || null,
          userId:    user.id,
          fileName:  `SLD_${(clientName || 'client').replace(/[^a-z0-9]/gi, '_')}_Preliminary.svg`,
          svg:       sldSvg,
          notes:     'Preliminary single-line diagram — auto-generated',
        });
        if (sldSaved) savedFiles.push('sld');
      }

      // 10e. BOM
      if (bomMarkdown) {
        const bomSaved = await saveProjectFile(sql, {
          projectId,
          clientId:  clientId || null,
          userId:    user.id,
          fileName:  `BOM_${(clientName || 'client').replace(/[^a-z0-9]/gi, '_')}_Preliminary.txt`,
          fileType:  'engineering',
          mimeType:  'text/plain',
          content:   bomMarkdown,
          notes:     'Preliminary bill of materials — auto-generated',
        });
        if (bomSaved) savedFiles.push('bom');
      }
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        systemKw,
        panelCount,
        panelWatts:      DEFAULTS.panelWatts,
        annualKwh:       annualUsage,
        productionFactor,
        monthlyProduction,

        costEstimate: {
          low:         costLow,
          high:        costHigh,
          perWattLow:  COST_LOW,
          perWattHigh: COST_HIGH,
          label:       `$${costLow.toLocaleString()} – $${costHigh.toLocaleString()}`,
        },

        equipment: {
          panel:    `${DEFAULTS.panelWatts}W Monocrystalline Module`,
          inverter: `Enphase ${DEFAULTS.inverterModel} Microinverter`,
          racking:  'IronRidge XR100 Rail System',
          topology: 'Microinverter (1:1)',
        },

        sldSvg:      sldSvg || null,
        bomData:     bomData || null,
        reportText,

        savedFiles,   // list of what was actually saved
        generatedAt:  new Date().toISOString(),
        disclaimer:   'PRELIMINARY ESTIMATE — Generated from utility bill data. Final design and pricing will be provided by a selected installation contractor.',
      },
    });

  } catch (err: any) {
    console.error('[engineering/preliminary] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── Bill Data Summary ─────────────────────────────────────────────────────────
function buildBillDataSummary(p: {
  clientName: string;
  serviceAddress: string;
  utilityName: string;
  annualUsage: number;
  monthlyKwh: number;
  electricityRate: number | null;
  reportDate: string;
}): string {
  return `UTILITY BILL DATA SUMMARY
==========================
Client:           ${p.clientName}
Service Address:  ${p.serviceAddress}
Utility Provider: ${p.utilityName}
Extracted:        ${p.reportDate}

USAGE DATA
──────────────────────────────────────
Annual Usage:     ${p.annualUsage.toLocaleString()} kWh/year
Monthly Average:  ${p.monthlyKwh.toLocaleString()} kWh/month
${p.electricityRate ? `Electricity Rate: $${p.electricityRate.toFixed(3)}/kWh` : ''}
${p.electricityRate ? `Annual Bill Est:  $${Math.round(p.annualUsage * p.electricityRate).toLocaleString()}/year` : ''}

Source: Auto-extracted from uploaded utility bill
Generated by SolarPro | ${p.reportDate}`.trim();
}

// ── System Estimate ───────────────────────────────────────────────────────────
function buildSystemEstimate(p: {
  clientName: string;
  systemKw: number;
  panelCount: number;
  costLow: number;
  costHigh: number;
  annualUsage: number;
  annualSavings: number | null;
  paybackYears: string | null;
  reportDate: string;
}): string {
  return `SYSTEM SIZE & COST ESTIMATE
============================
Client:           ${p.clientName}
Date:             ${p.reportDate}

RECOMMENDED SYSTEM
──────────────────────────────────────
System Size:      ${p.systemKw} kW DC
Panel Count:      ${p.panelCount} × 440W modules
Offset Target:    100% annual usage (${p.annualUsage.toLocaleString()} kWh/yr)
Topology:         Microinverter (Enphase IQ8+)
Racking:          IronRidge XR100

COST ESTIMATE (PRELIMINARY)
──────────────────────────────────────
Price Range:      $${p.costLow.toLocaleString()} – $${p.costHigh.toLocaleString()}
Per Watt:         $${(p.costLow / (p.systemKw * 1000)).toFixed(2)} – $${(p.costHigh / (p.systemKw * 1000)).toFixed(2)}/W
After 30% ITC:    $${Math.round(p.costLow * 0.70).toLocaleString()} – $${Math.round(p.costHigh * 0.70).toLocaleString()}
${p.annualSavings ? `Annual Savings:   $${p.annualSavings.toLocaleString()}/year` : ''}
${p.paybackYears ? `Simple Payback:   ${p.paybackYears} years` : ''}

⚠ PRELIMINARY ESTIMATE — Subject to site assessment
Generated by SolarPro | ${p.reportDate}`.trim();
}

// ── Full Engineering Report Text ──────────────────────────────────────────────
function buildReportText(p: {
  clientName: string;
  serviceAddress: string;
  utilityName: string;
  annualUsage: number;
  systemKw: number;
  panelCount: number;
  costLow: number;
  costHigh: number;
  electricityRate: number | null;
  annualSavings: number | null;
  paybackYears: string | null;
  productionFactor: number;
  stateCode: string | null;
  reportDate: string;
  bomMarkdown: string;
}): string {
  return `
PRELIMINARY SOLAR FEASIBILITY REPORT
=====================================
⚠  THIS IS A PRELIMINARY ENGINEERING ESTIMATE
   Generated from utility bill data only.
   Final design and pricing will be provided by a selected installation contractor.

Prepared for: ${p.clientName}
Service Address: ${p.serviceAddress}
Utility Provider: ${p.utilityName}
Report Date: ${p.reportDate}
${p.stateCode ? `State: ${p.stateCode}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENERGY ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Annual Usage:          ${p.annualUsage.toLocaleString()} kWh/year
Production Factor:     ${p.productionFactor} kWh/kW/year${p.stateCode ? ` (${p.stateCode})` : ''}
${p.electricityRate ? `Electricity Rate:      $${p.electricityRate.toFixed(3)}/kWh` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDED SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System Size:           ${p.systemKw} kW DC
Panel Count:           ${p.panelCount} modules × 440W
Offset Target:         100% annual usage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRELIMINARY EQUIPMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Solar Panels:          ${p.panelCount} × 440W Monocrystalline
Microinverters:        ${p.panelCount} × Enphase IQ8+
Racking System:        IronRidge XR100 Rail System
Topology:              Microinverter (1 inverter per panel)

NOTE: Equipment listed above is for preliminary feasibility only.
Contractors will select final equipment based on site conditions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COST ESTIMATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Estimated Range:       $${p.costLow.toLocaleString()} – $${p.costHigh.toLocaleString()}
Per Watt:              $${(p.costLow / (p.systemKw * 1000)).toFixed(2)} – $${(p.costHigh / (p.systemKw * 1000)).toFixed(2)}/W
${p.annualSavings ? `Est. Annual Savings:   $${p.annualSavings.toLocaleString()}/year` : ''}
${p.paybackYears ? `Simple Payback:        ${p.paybackYears} years (estimated)` : ''}

Note: Federal ITC (30%) and state incentives not included above.
After 30% ITC: $${Math.round(p.costLow * 0.70).toLocaleString()} – $${Math.round(p.costHigh * 0.70).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRELIMINARY BILL OF MATERIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${p.bomMarkdown || 'BOM will be generated by contractor during final design.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Site assessment by licensed contractor
2. Roof structural evaluation
3. Shading analysis
4. Electrical panel evaluation
5. Final system design and permitting
6. Utility interconnection application

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is a preliminary engineering estimate generated from utility bill data.
Final design and pricing will be provided by a selected installation contractor.
Actual system size, equipment, and costs may vary based on site conditions,
roof orientation, shading, structural requirements, and local utility rules.
This report does not constitute a contract or guarantee of performance.

Generated by SolarPro | ${p.reportDate}
`.trim();
}