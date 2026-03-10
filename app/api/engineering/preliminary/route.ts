// ============================================================
// POST /api/engineering/preliminary
// Automation Glue: Bill data → System size → Panel count →
//   Generic BOM + Preliminary SLD + Cost estimate
//
// This connects existing SolarPro modules into one automated
// workflow. NO manual panel placement required.
// NO new engineering systems built — only wiring existing ones.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { generateBOMV4, bomToMarkdown } from '@/lib/bom-engine-v4';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';

export const dynamic = 'force-dynamic';

// ── Default equipment for preliminary estimates ───────────────────────────────
// 440W Enphase microinverter system with IronRidge XR100 racking
// Contractors will customize later — this is for feasibility only
const PRELIMINARY_DEFAULTS = {
  panelWatts:          440,
  panelModel:          'Generic 440W Monocrystalline',
  panelVoc:            49.5,
  panelIsc:            11.2,
  panelId:             'qcells-peak-duo-400',       // closest registry match
  inverterId:          'enphase-iq8plus',            // microinverter
  inverterModel:       'IQ8+',
  inverterManufacturer: 'Enphase',
  rackingId:           'ironridge-xr100',
  topologyType:        'MICROINVERTER',
  roofType:            'shingle',
  mainPanelAmps:       200,
  dcWireGauge:         '#10 AWG',
  acWireGauge:         '#10 AWG',
  conduitType:         'EMT',
  acWireLength:        60,
};

// ── Cost estimate constants ───────────────────────────────────────────────────
const COST_PER_WATT_LOW  = 2.75;
const COST_PER_WATT_HIGH = 3.50;

// ── Production factor by state ────────────────────────────────────────────────
function getProductionFactor(stateCode?: string | null): number {
  const factors: Record<string, number> = {
    CA: 1600, AZ: 1650, NV: 1700, NM: 1650, TX: 1500, FL: 1500,
    HI: 1700, CO: 1550, UT: 1550, GA: 1400, SC: 1400, NC: 1350,
    VA: 1300, MD: 1250, DC: 1250, PA: 1200, NJ: 1150, NY: 1150,
    CT: 1150, MA: 1150, RI: 1150, NH: 1100, VT: 1100, ME: 1100,
    IL: 1280, IN: 1250, OH: 1200, MI: 1150, WI: 1200, MN: 1200,
    IA: 1250, MO: 1300, KS: 1350, NE: 1300, SD: 1300, ND: 1250,
    MT: 1300, WY: 1350, ID: 1350, OR: 1200, WA: 1150, AK: 1000,
  };
  return stateCode ? (factors[stateCode.toUpperCase()] ?? 1250) : 1250;
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // ── Inputs from bill upload ───────────────────────────────────────────────
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

    if (!annualKwh && !monthlyKwh) {
      return NextResponse.json({
        success: false,
        error: 'annualKwh or monthlyKwh required',
      }, { status: 400 });
    }

    // ── Step 1: Annual kWh ────────────────────────────────────────────────────
    const annualUsage = annualKwh || (monthlyKwh * 12);

    // ── Step 2: System size calculation ──────────────────────────────────────
    const productionFactor = getProductionFactor(stateCode);
    const systemKw = Math.round((annualUsage / productionFactor) * 10) / 10;

    // ── Step 3: Panel count ───────────────────────────────────────────────────
    const panelKw = PRELIMINARY_DEFAULTS.panelWatts / 1000;  // 0.44 kW
    const panelCount = Math.ceil(systemKw / panelKw);

    // ── Step 4: String configuration (microinverter = 1 module per inverter) ──
    const stringCount  = 1;
    const inverterCount = panelCount;  // 1 microinverter per panel
    const acOutputKw   = systemKw;
    const acOutputAmps = Math.round((acOutputKw * 1000) / 240);
    const acOCPD       = Math.ceil(acOutputAmps * 1.25 / 5) * 5;
    const backfeedAmps = acOCPD;

    // ── Step 5: Cost estimate ─────────────────────────────────────────────────
    const systemWatts  = systemKw * 1000;
    const costLow      = Math.round(systemWatts * COST_PER_WATT_LOW);
    const costHigh     = Math.round(systemWatts * COST_PER_WATT_HIGH);

    // ── Step 6: Generate BOM using existing BOM engine ───────────────────────
    let bomData: any = null;
    let bomMarkdown  = '';
    try {
      const bomInput = {
        inverterId:           PRELIMINARY_DEFAULTS.inverterId,
        rackingId:            PRELIMINARY_DEFAULTS.rackingId,
        panelId:              PRELIMINARY_DEFAULTS.panelId,
        moduleCount:          panelCount,
        deviceCount:          panelCount,   // microinverter: 1 per module
        stringCount:          stringCount,
        inverterCount:        inverterCount,
        systemKw:             systemKw,
        dcWireGauge:          PRELIMINARY_DEFAULTS.dcWireGauge,
        acWireGauge:          PRELIMINARY_DEFAULTS.acWireGauge,
        dcWireLength:         50,
        acWireLength:         PRELIMINARY_DEFAULTS.acWireLength,
        conduitType:          PRELIMINARY_DEFAULTS.conduitType,
        conduitSizeInch:      '3/4',
        roofType:             PRELIMINARY_DEFAULTS.roofType,
        attachmentCount:      Math.ceil(panelCount / 2) + 2,
        railSections:         Math.ceil(panelCount / 4),
        mainPanelAmps:        PRELIMINARY_DEFAULTS.mainPanelAmps,
        backfeedAmps:         backfeedAmps,
        acOCPD:               acOCPD,
        dcOCPD:               20,
        requiresACDisconnect: true,
        requiresDCDisconnect: false,   // microinverter: no DC disconnect
        requiresRapidShutdown: true,
        requiresWarningLabels: true,
        topologyType:         PRELIMINARY_DEFAULTS.topologyType,
        interconnectionMethod: 'LOAD_SIDE',
        panelBusRating:       PRELIMINARY_DEFAULTS.mainPanelAmps,
      };
      const bomResult = generateBOMV4(bomInput as any);
      bomData     = bomResult;
      bomMarkdown = bomToMarkdown(bomResult);
    } catch (bomErr: any) {
      console.warn('[preliminary] BOM generation failed:', bomErr.message);
    }

    // ── Step 7: Generate preliminary SLD using existing SLD renderer ──────────
    let sldSvg = '';
    try {
      const sldInput = {
        projectName:              projectName || `${clientName || 'Client'} — Solar`,
        clientName:               clientName  || 'Prospective Client',
        address:                  serviceAddress || '',
        designer:                 user.name || 'SolarPro',
        drawingDate:              new Date().toLocaleDateString('en-US'),
        drawingNumber:            `PRELIM-${Date.now().toString(36).toUpperCase()}`,
        revision:                 'P1',
        topologyType:             PRELIMINARY_DEFAULTS.topologyType,
        totalModules:             panelCount,
        totalStrings:             stringCount,
        panelModel:               PRELIMINARY_DEFAULTS.panelModel,
        panelWatts:               PRELIMINARY_DEFAULTS.panelWatts,
        panelVoc:                 PRELIMINARY_DEFAULTS.panelVoc,
        panelIsc:                 PRELIMINARY_DEFAULTS.panelIsc,
        dcWireGauge:              PRELIMINARY_DEFAULTS.dcWireGauge,
        dcConduitType:            PRELIMINARY_DEFAULTS.conduitType,
        dcOCPD:                   20,
        inverterModel:            PRELIMINARY_DEFAULTS.inverterModel,
        inverterManufacturer:     PRELIMINARY_DEFAULTS.inverterManufacturer,
        acOutputKw:               acOutputKw,
        acOutputAmps:             acOutputAmps,
        acWireGauge:              PRELIMINARY_DEFAULTS.acWireGauge,
        acConduitType:            PRELIMINARY_DEFAULTS.conduitType,
        acOCPD:                   acOCPD,
        mainPanelAmps:            PRELIMINARY_DEFAULTS.mainPanelAmps,
        backfeedAmps:             backfeedAmps,
        utilityName:              utilityName || 'Local Utility',
        interconnection:          'LOAD_SIDE',
        rapidShutdownIntegrated:  true,
        hasProductionMeter:       false,
        hasBattery:               false,
        batteryModel:             '',
        batteryKwh:               0,
        scale:                    'NTS',
        acWireLength:             PRELIMINARY_DEFAULTS.acWireLength,
        panelsPerString:          1,
      };
      sldSvg = renderSLDProfessional(sldInput as any);
    } catch (sldErr: any) {
      console.warn('[preliminary] SLD generation failed:', sldErr.message);
    }

    // ── Step 8: Build the preliminary engineering report text ─────────────────
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const reportText = buildPreliminaryReport({
      clientName:      clientName || 'Prospective Client',
      serviceAddress:  serviceAddress || 'Address on file',
      utilityName:     utilityName || 'Local Utility',
      annualKwh:       annualUsage,
      systemKw,
      panelCount,
      panelWatts:      PRELIMINARY_DEFAULTS.panelWatts,
      inverterModel:   `Enphase ${PRELIMINARY_DEFAULTS.inverterModel}`,
      racking:         'IronRidge XR100 Rail System',
      costLow,
      costHigh,
      electricityRate: electricityRate || null,
      productionFactor,
      stateCode:       stateCode || null,
      reportDate,
      bomMarkdown,
    });

    // ── Response ──────────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        // System sizing
        systemKw,
        panelCount,
        panelWatts:      PRELIMINARY_DEFAULTS.panelWatts,
        annualKwh:       annualUsage,
        productionFactor,

        // Cost estimate
        costEstimate: {
          low:       costLow,
          high:      costHigh,
          perWattLow:  COST_PER_WATT_LOW,
          perWattHigh: COST_PER_WATT_HIGH,
          label:     `$${costLow.toLocaleString()} – $${costHigh.toLocaleString()}`,
        },

        // Default equipment used
        equipment: {
          panel:      `${PRELIMINARY_DEFAULTS.panelWatts}W Monocrystalline Module`,
          inverter:   `Enphase ${PRELIMINARY_DEFAULTS.inverterModel} Microinverter`,
          racking:    'IronRidge XR100 Rail System',
          topology:   'Microinverter (1:1)',
        },

        // Generated outputs
        sldSvg:      sldSvg || null,
        bomData:     bomData || null,
        reportText,

        // Metadata
        generatedAt: new Date().toISOString(),
        disclaimer:  'PRELIMINARY ESTIMATE — Generated from utility bill data. Final design and pricing will be provided by a selected installation contractor.',
      },
    });

  } catch (err: any) {
    console.error('[engineering/preliminary] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── Build the preliminary report text ────────────────────────────────────────
function buildPreliminaryReport(p: {
  clientName: string;
  serviceAddress: string;
  utilityName: string;
  annualKwh: number;
  systemKw: number;
  panelCount: number;
  panelWatts: number;
  inverterModel: string;
  racking: string;
  costLow: number;
  costHigh: number;
  electricityRate: number | null;
  productionFactor: number;
  stateCode: string | null;
  reportDate: string;
  bomMarkdown: string;
}): string {
  const annualSavings = p.electricityRate
    ? Math.round(p.annualKwh * p.electricityRate)
    : null;

  const payback = annualSavings
    ? `${((p.costLow + p.costHigh) / 2 / annualSavings).toFixed(1)} years (estimated)`
    : 'Contact contractor for detailed financial analysis';

  return `
PRELIMINARY SOLAR FEASIBILITY REPORT
=====================================
⚠️  THIS IS A PRELIMINARY ENGINEERING ESTIMATE
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
Annual Usage:          ${p.annualKwh.toLocaleString()} kWh/year
Production Factor:     ${p.productionFactor} kWh/kW/year${p.stateCode ? ` (${p.stateCode})` : ''}
${p.electricityRate ? `Electricity Rate:      $${p.electricityRate.toFixed(3)}/kWh` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOMMENDED SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System Size:           ${p.systemKw} kW DC
Panel Count:           ${p.panelCount} modules × ${p.panelWatts}W
Offset Target:         100% annual usage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERIC EQUIPMENT (PRELIMINARY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Solar Panels:          ${p.panelCount} × ${p.panelWatts}W Monocrystalline
Microinverters:        ${p.panelCount} × ${p.inverterModel}
Racking System:        ${p.racking}
Topology:              Microinverter (1 inverter per panel)

NOTE: Equipment listed above is for preliminary feasibility only.
Contractors will select final equipment based on site conditions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COST ESTIMATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Estimated Range:       $${p.costLow.toLocaleString()} – $${p.costHigh.toLocaleString()}
Per Watt:              $${(p.costLow / (p.systemKw * 1000)).toFixed(2)} – $${(p.costHigh / (p.systemKw * 1000)).toFixed(2)}/W
${annualSavings ? `Est. Annual Savings:   $${annualSavings.toLocaleString()}/year` : ''}
${annualSavings ? `Simple Payback:        ${payback}` : `Payback Period:        ${payback}`}

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