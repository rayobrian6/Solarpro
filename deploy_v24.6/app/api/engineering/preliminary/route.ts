import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb, upsertLayout, upsertProduction, getProjectWithDetails } from '@/lib/db-neon';
import type { EngineeringSeed, PlacedPanel } from '@/types';

// ─── State-based production factors (kWh/kW/year) ────────────────────────────
const STATE_PRODUCTION_FACTORS: Record<string, number> = {
  AK: 900,  AL: 1350, AR: 1350, AZ: 1700, CA: 1550, CO: 1500,
  CT: 1150, DC: 1200, DE: 1200, FL: 1450, GA: 1350, HI: 1600,
  IA: 1250, ID: 1350, IL: 1200, IN: 1200, KS: 1400, KY: 1250,
  LA: 1400, MA: 1150, MD: 1200, ME: 1100, MI: 1150, MN: 1200,
  MO: 1300, MS: 1400, MT: 1350, NC: 1350, ND: 1250, NE: 1350,
  NH: 1100, NJ: 1200, NM: 1700, NV: 1700, NY: 1100, OH: 1150,
  OK: 1450, OR: 1250, PA: 1150, RI: 1150, SC: 1350, SD: 1300,
  TN: 1300, TX: 1500, UT: 1600, VA: 1250, VT: 1100, WA: 1150,
  WI: 1200, WV: 1150, WY: 1400,
};

// ─── Default panel specs (SunPower Maxeon 7 440W) ─────────────────────────────
const DEFAULT_PANEL = {
  id: 'sp-maxeon7-440',
  watts: 440,
  voc: 51.6,
  vmp: 43.4,
  isc: 10.89,
  imp: 10.14,
  tempCoeffVoc: -0.27,
  tempCoeffIsc: 0.05,
  maxSeriesFuseRating: 20,
};

// ─── Default microinverter specs (Enphase IQ8+) ───────────────────────────────
const DEFAULT_MICRO = {
  id: 'enphase-iq8plus',
  acOutputW: 295,
  maxDcVoltage: 60,
  mpptVoltageMin: 16,
  mpptVoltageMax: 60,
  acOutputCurrentMax: 1.21,
  modulesPerDevice: 1,
};

// ─── Layout constants ─────────────────────────────────────────────────────────
const LAYOUT = {
  panelsPerRow: 21,       // standard residential row width
  tilt: 20,               // degrees
  azimuth: 180,           // south-facing
  panelSpacingX: 1.1,     // meters between panel centers (portrait)
  panelSpacingY: 1.8,     // meters between row centers
};

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  panelWatts: 440,
  inverterType: 'micro' as const,
  inverterModel: 'Enphase IQ8+',
  systemType: 'roof' as const,
  pricePerWattLow: 2.80,
  pricePerWattHigh: 3.80,
  defaultProductionFactor: 1350,
  performanceRatio: 0.80,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractStateCode(address: string): string | null {
  if (!address) return null;
  const m = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?(?:\s*$|,)/);
  return m ? m[1] : null;
}

function getProductionFactor(stateCode: string | null): number {
  if (!stateCode) return DEFAULTS.defaultProductionFactor;
  return STATE_PRODUCTION_FACTORS[stateCode.toUpperCase()] ?? DEFAULTS.defaultProductionFactor;
}

function buildMonthlyProduction(annualKwh: number, stateCode: string | null): number[] {
  const state = stateCode?.toUpperCase() ?? '';
  const desertStates = ['AZ', 'NM', 'NV', 'CA', 'TX', 'FL', 'HI'];
  const northernStates = ['AK', 'ME', 'VT', 'NH', 'MN', 'WI', 'MI', 'NY', 'WA', 'OR'];

  let multipliers: number[];
  if (desertStates.includes(state)) {
    multipliers = [0.70, 0.80, 1.00, 1.10, 1.18, 1.22, 1.18, 1.15, 1.05, 0.90, 0.72, 0.65];
  } else if (northernStates.includes(state)) {
    multipliers = [0.50, 0.62, 0.85, 1.05, 1.20, 1.25, 1.22, 1.15, 0.95, 0.75, 0.52, 0.44];
  } else {
    multipliers = [0.60, 0.72, 0.92, 1.08, 1.18, 1.22, 1.20, 1.12, 0.98, 0.82, 0.62, 0.54];
  }

  const total = multipliers.reduce((a, b) => a + b, 0);
  return multipliers.map(m => Math.round((annualKwh * m) / total));
}

// ─── Generate synthetic panel array ──────────────────────────────────────────
// Creates a grid of PlacedPanel objects with row/col positions.
// No real lat/lng coordinates — uses relative x/y pixel positions.
// The Design Studio will replace these with real coordinates later.
function generateSyntheticPanels(
  panelCount: number,
  layoutId: string,
): PlacedPanel[] {
  const panelsPerRow = LAYOUT.panelsPerRow;
  const panels: PlacedPanel[] = [];

  for (let i = 0; i < panelCount; i++) {
    const row = Math.floor(i / panelsPerRow);
    const col = i % panelsPerRow;

    // Relative pixel positions (10px per panel unit for canvas rendering)
    const x = col * 50;
    const y = row * 90;

    panels.push({
      id: `prelim-panel-${i}`,
      layoutId,
      lat: 0,                          // no real coordinates — preliminary only
      lng: 0,
      x,
      y,
      tilt: LAYOUT.tilt,
      azimuth: LAYOUT.azimuth,
      wattage: DEFAULT_PANEL.watts,
      bifacialGain: 0,
      row,
      col,
      systemType: DEFAULTS.systemType,
      arrayId: 'prelim-array-0',
    });
  }

  return panels;
}

// ─── Build synthetic engineering config for the calculate endpoint ────────────
// This mirrors what buildCalcPayload() produces in the engineering page,
// so the preliminary endpoint can pre-run compliance/SLD/BOM without user input.
function buildSyntheticEngConfig(panelCount: number, stateCode: string | null) {
  return {
    inverterType: DEFAULTS.inverterType,
    inverterId: DEFAULT_MICRO.id,
    panelId: DEFAULT_PANEL.id,
    panelCount,
    panelWatts: DEFAULT_PANEL.watts,
    panelVoc: DEFAULT_PANEL.voc,
    panelVmp: DEFAULT_PANEL.vmp,
    panelIsc: DEFAULT_PANEL.isc,
    panelImp: DEFAULT_PANEL.imp,
    panelTempCoeffVoc: DEFAULT_PANEL.tempCoeffVoc,
    panelTempCoeffIsc: DEFAULT_PANEL.tempCoeffIsc,
    panelMaxSeriesFuse: DEFAULT_PANEL.maxSeriesFuseRating,
    microAcOutputW: DEFAULT_MICRO.acOutputW,
    microAcOutputCurrentMax: DEFAULT_MICRO.acOutputCurrentMax,
    microMaxDcVoltage: DEFAULT_MICRO.maxDcVoltage,
    microMpptVoltageMin: DEFAULT_MICRO.mpptVoltageMin,
    microMpptVoltageMax: DEFAULT_MICRO.mpptVoltageMax,
    stateCode,
    systemType: DEFAULTS.systemType,
    mainPanelAmps: 200,
    wireGauge: '#10 AWG THWN-2',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    interconnectionMethod: 'LOAD_SIDE',
    panelBusRating: 200,
  };
}

// ─── POST /api/engineering/preliminary ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      annualKwh,
      monthlyKwh,
      electricityRate,
      utilityName,
      stateCode: bodyStateCode,
      address,
    } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 });
    }

    // Verify project belongs to user (use getProjectWithDetails to get client name)
    const project = await getProjectWithDetails(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // ─── 1. Resolve usage data ─────────────────────────────────────────────
    const annualUsage: number = annualKwh
      || (monthlyKwh ? monthlyKwh * 12 : 0)
      || 12000;

    const monthlyUsage: number = monthlyKwh
      || Math.round(annualUsage / 12);

    // ─── 2. Resolve location ───────────────────────────────────────────────
    const stateCode: string | null =
      bodyStateCode
      || extractStateCode(address || project.address || '')
      || null;

    // ─── 3. System sizing ──────────────────────────────────────────────────
    const productionFactor = getProductionFactor(stateCode);
    const systemKw = Math.round((annualUsage / productionFactor) * 10) / 10;
    const panelCount = Math.ceil((systemKw * 1000) / DEFAULTS.panelWatts);
    const actualSystemKw = Math.round((panelCount * DEFAULTS.panelWatts) / 100) / 10;

    // ─── 4. Production estimate ────────────────────────────────────────────
    const annualProductionKwh = Math.round(actualSystemKw * productionFactor);
    const monthlyProductionKwh = buildMonthlyProduction(annualProductionKwh, stateCode);
    const co2TonsPerYear = Math.round(annualProductionKwh * 0.000709 * 10) / 10;

    // ─── 5. Pricing estimate ───────────────────────────────────────────────
    const systemWatts = actualSystemKw * 1000;
    const costLow = Math.round(systemWatts * DEFAULTS.pricePerWattLow / 100) * 100;
    const costHigh = Math.round(systemWatts * DEFAULTS.pricePerWattHigh / 100) * 100;

    // ─── 6. Generate synthetic panel layout ───────────────────────────────
    // Use a placeholder layoutId for panel generation — will be replaced by DB
    const tempLayoutId = `prelim-layout-${projectId}`;
    const syntheticPanels = generateSyntheticPanels(panelCount, tempLayoutId);

    const rowCount = Math.ceil(panelCount / LAYOUT.panelsPerRow);
    const colCount = Math.min(panelCount, LAYOUT.panelsPerRow);

    // ─── 7. Build engineering seed ─────────────────────────────────────────
    const syntheticEngConfig = buildSyntheticEngConfig(panelCount, stateCode);

    const engineeringSeed: EngineeringSeed = {
      annual_kwh: annualUsage,
      monthly_kwh: monthlyUsage,
      electricity_rate: electricityRate ?? null,
      utility: utilityName || '',
      system_kw: actualSystemKw,
      panel_watt: DEFAULTS.panelWatts,
      panel_count: panelCount,
      inverter_type: DEFAULTS.inverterType,
      inverter_model: DEFAULTS.inverterModel,
      system_type: DEFAULTS.systemType,
      tilt: LAYOUT.tilt,
      azimuth: LAYOUT.azimuth,
      production_factor: productionFactor,
      annual_production_kwh: annualProductionKwh,
      cost_low: costLow,
      cost_high: costHigh,
      state_code: stateCode,
      client_name: project.client?.name ?? undefined,
      service_address: address || project.address || undefined,
      // Synthetic layout + eng config — consumed directly by engineering engine
      synthetic_layout: syntheticPanels,
      synthetic_eng_config: syntheticEngConfig,
      generated_at: new Date().toISOString(),
    };

    // ─── 8. Save seed to project ───────────────────────────────────────────
    const sql = getDb();
    try {
      await sql`
        UPDATE projects
        SET engineering_seed = ${JSON.stringify(engineeringSeed)}::jsonb,
            updated_at = NOW()
        WHERE id = ${projectId}
          AND user_id = ${user.id}
      `;
    } catch (seedErr) {
      console.warn('[preliminary] Could not save engineering_seed (run migration):', seedErr);
    }

    // ─── 9. Upsert layout WITH synthetic panels ────────────────────────────
    // panels[] now contains a full grid of PlacedPanel objects with row/col/tilt/azimuth.
    // The Design Studio will replace these with real GPS-positioned panels later.
    const savedLayout = await upsertLayout({
      projectId,
      userId: user.id,
      systemType: DEFAULTS.systemType,
      panels: syntheticPanels,
      totalPanels: panelCount,
      systemSizeKw: actualSystemKw,
      groundTilt: LAYOUT.tilt,
      groundAzimuth: LAYOUT.azimuth,
      mapCenter: { lat: 0, lng: 0 },
      mapZoom: 18,
    });

    // ─── 10. Upsert synthetic production ──────────────────────────────────
    const productionResult = {
      id: `prod-prelim-${Date.now()}`,
      projectId,
      layoutId: savedLayout.id,
      annualProductionKwh,
      monthlyProductionKwh,
      performanceRatio: DEFAULTS.performanceRatio,
      specificYield: Math.round(annualProductionKwh / actualSystemKw),
      co2OffsetTons: co2TonsPerYear,
      treesEquivalent: Math.round(co2TonsPerYear * 1000 / 21),
      offsetPercentage: Math.min(Math.round((annualProductionKwh / annualUsage) * 100), 100),
      capacityFactor: Math.round((annualProductionKwh / (actualSystemKw * 8760)) * 100) / 100,
      calculatedAt: new Date().toISOString(),
    };

    const rate = electricityRate ?? 0.13;
    const costEstimate = {
      systemSizeKw: actualSystemKw,
      grossCost: costHigh,
      laborCost: Math.round(costHigh * 0.25),
      equipmentCost: Math.round(costHigh * 0.55),
      fixedCosts: 2000,
      totalBeforeCredit: costHigh,
      taxCredit: Math.round(costHigh * 0.30),
      netCost: Math.round(costHigh * 0.70),
      annualSavings: Math.round(annualProductionKwh * rate),
      paybackYears: Math.round((costHigh * 0.70) / Math.round(annualProductionKwh * rate) * 10) / 10,
      lifetimeSavings: Math.round(annualProductionKwh * rate * 25),
      roi: Math.round(((annualProductionKwh * rate * 25 - costHigh * 0.70) / (costHigh * 0.70)) * 100),
    };

    await upsertProduction({
      projectId,
      userId: user.id,
      production: productionResult,
      costEstimate,
      systemSizeKw: actualSystemKw,
      panelCount,
    });

    // ─── 11. Pre-run engineering compliance (non-blocking) ─────────────────
    // Build the same payload that buildCalcPayload() produces in the engineering page
    // so the compliance result is cached before the user opens the engineering module.
    let complianceResult: any = null;
    try {
      const calcPayload = {
        address: project.address || '',
        state: stateCode || undefined,
        electrical: {
          inverters: [{
            type: 'micro',
            modulesPerDevice: 1,
            deviceCount: panelCount,
            acOutputKw: DEFAULT_MICRO.acOutputW / 1000,
            acOutputCurrentMax: DEFAULT_MICRO.acOutputCurrentMax,
            maxDcVoltage: DEFAULT_MICRO.maxDcVoltage,
            mpptVoltageMin: DEFAULT_MICRO.mpptVoltageMin,
            mpptVoltageMax: DEFAULT_MICRO.mpptVoltageMax,
            mpptChannels: panelCount,
            strings: [{
              panelCount,
              panelVoc: DEFAULT_PANEL.voc,
              panelIsc: DEFAULT_PANEL.isc,
              panelImp: DEFAULT_PANEL.imp,
              panelVmp: DEFAULT_PANEL.vmp,
              panelWatts: DEFAULT_PANEL.watts,
              tempCoeffVoc: DEFAULT_PANEL.tempCoeffVoc,
              tempCoeffIsc: DEFAULT_PANEL.tempCoeffIsc,
              maxSeriesFuseRating: DEFAULT_PANEL.maxSeriesFuseRating,
              wireGauge: '#10 AWG THWN-2',
              wireLength: 50,
              conduitType: 'EMT',
            }],
          }],
          mainPanelAmps: 200,
          systemVoltage: 240,
          wireGauge: '#10 AWG THWN-2',
          wireLength: 50,
          conduitType: 'EMT',
          rapidShutdown: true,
          acDisconnect: true,
          dcDisconnect: true,
          engineeringMode: 'AUTO',
          interconnection: {
            method: 'LOAD_SIDE',
            busRating: 200,
            mainBreaker: 200,
          },
          batteryBackfeedA: 0,
          batteryCount: 0,
          batteryContinuousOutputA: 0,
        },
        structural: {
          windSpeed: 115,
          windExposure: 'C',
          groundSnowLoad: 20,
          roofType: 'shingle',
          roofPitch: 20,
          rafterSpacing: 24,
          rafterSpan: 16,
          rafterSize: '2x6',
          rafterSpecies: 'Douglas Fir-Larch',
          panelLength: 70.9,
          panelWidth: 41.7,
          panelWeight: 44,
          panelCount,
          rackingWeight: 8,
          attachmentSpacing: 48,
          railSpan: 60,
          rowSpacing: 12,
          arrayTilt: 20,
          systemType: DEFAULTS.systemType,
        },
      };

      // Use internal fetch to the calculate endpoint
      const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      const calcRes = await fetch(`${baseUrl}/api/engineering/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calcPayload),
      });

      if (calcRes.ok) {
        complianceResult = await calcRes.json();
      }
    } catch (calcErr) {
      // Non-fatal — engineering page will run calc when opened
      console.warn('[preliminary] Pre-run compliance failed (non-fatal):', calcErr);
    }

    // ─── 12. Return full result ────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        engineeringSeed,
        syntheticEngConfig,
        layout: {
          id: savedLayout.id,
          totalPanels: panelCount,
          systemSizeKw: actualSystemKw,
          rowCount,
          colCount,
          panelsPerRow: LAYOUT.panelsPerRow,
          tilt: LAYOUT.tilt,
          azimuth: LAYOUT.azimuth,
          panelsSaved: syntheticPanels.length,
        },
        production: {
          annualProductionKwh,
          monthlyProductionKwh,
          specificYield: Math.round(annualProductionKwh / actualSystemKw),
        },
        pricing: { costLow, costHigh },
        compliance: complianceResult,
        summary: `${actualSystemKw} kW · ${panelCount} panels · ${rowCount} rows × ${colCount} cols · ${annualProductionKwh.toLocaleString()} kWh/yr`,
      },
    });

  } catch (error: unknown) {
    console.error('[POST /api/engineering/preliminary]', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}